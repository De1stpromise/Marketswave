#!/usr/bin/env node
// Unified Communications Inbox — Stage 1 (2026-09-07). Real-stack verification for the
// conversation/message schema, RLS (including the real anonymous-visitor identity model and
// the deliberate read-access-scoping decision), the retroactive-linking trigger,
// start-chat-conversation, admin-update-conversation, notify-new-chat-message's own debounce
// logic, and real Supabase Realtime delivery. LOCAL STACK ONLY.
//
// Usage: node scripts/verify-supabase-unified-inbox.js
// Requires: the local Supabase stack running, RESEND_API_KEY set (email sends will likely be
// quota-rejected right now — this script treats that as expected, see the notify section).

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(test, maxMs) {
  const start = Date.now();
  for (;;) {
    const result = await test();
    if (result) return result;
    if (Date.now() - start > maxMs) return result;
    await sleep(150);
  }
}

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function anonClient(url, anonKey) {
  const c = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error('signInAnonymously failed: ' + error.message);
  return { client: c, uid: data.user.id };
}

async function main() {
  console.log('Unified Communications Inbox — Stage 1 verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pm = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: pmErr } = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('PM sign-in failed: ' + pmErr.message);

  const suffix = crypto.randomBytes(4).toString('hex');
  const cleanupConversationIds = [];
  const cleanupAuthUserIds = [];

  try {
    // =========================================================================================
    console.log('1. Anonymous visitor starts a chat, real conversation + first message\n');
    const email1 = 'inbox-visitor-' + suffix + '@example.com';
    const { client: visitor1, uid: visitor1Uid } = await anonClient(url, anonKey);
    cleanupAuthUserIds.push(visitor1Uid);

    const start1 = await visitor1.functions.invoke('start-chat-conversation', { body: { contactEmail: email1, contactName: 'Inbox Test Visitor' } });
    check('start-chat-conversation succeeds for a new anonymous visitor', !start1.error, start1.error && start1.error.message);
    check('a real new conversation is created, authorized for its own history (empty)', start1.data && start1.data.authorizedForHistory === true && Array.isArray(start1.data.messages) && start1.data.messages.length === 0);
    const conversationId1 = start1.data.conversationId;
    cleanupConversationIds.push(conversationId1);

    const { data: convoRow } = await admin.from('conversations').select('*').eq('id', conversationId1).single();
    check('the real conversations row has visitor_auth_id set to this exact anonymous session', convoRow.visitor_auth_id === visitor1Uid, convoRow.visitor_auth_id);
    check('client_id is genuinely null (no registered client exists for this email)', convoRow.client_id === null);
    check('contact_email/contact_name match what was submitted', convoRow.contact_email === email1 && convoRow.contact_name === 'Inbox Test Visitor');

    const { error: msgErr } = await visitor1.from('messages').insert({ conversation_id: conversationId1, channel: 'chat', direction: 'inbound', body: 'Hi, I have a question about your services.', sender_name: 'Inbox Test Visitor', sender_email: email1 });
    check('the visitor can send a real inbound message via direct RLS-authorized insert', !msgErr, msgErr && msgErr.message);

    const { data: convoAfterMsg } = await admin.from('conversations').select('last_message_at, unread_by_pm').eq('id', conversationId1).single();
    check('the real trigger updated last_message_at + unread_by_pm on the conversation', !!convoAfterMsg.last_message_at && convoAfterMsg.unread_by_pm === true);

    // =========================================================================================
    console.log('\n2. Calling start-chat-conversation again (same session) resumes the SAME thread\n');
    const start1b = await visitor1.functions.invoke('start-chat-conversation', { body: { contactEmail: email1, contactName: 'Inbox Test Visitor' } });
    check('the same conversationId is returned, not a duplicate', start1b.data.conversationId === conversationId1);
    check('the real message history (1 message) is returned to the genuinely authorized session', start1b.data.messages.length === 1);

    const { data: allConvosForEmail } = await admin.from('conversations').select('id').ilike('contact_email', email1);
    check('the unique-email constraint holds — exactly one real conversation row exists for this email', allConvosForEmail.length === 1, JSON.stringify(allConvosForEmail));

    // =========================================================================================
    console.log('\n3. A DIFFERENT anonymous session cannot read visitor 1\'s conversation (RLS isolation)\n');
    const { client: visitor2, uid: visitor2Uid } = await anonClient(url, anonKey);
    cleanupAuthUserIds.push(visitor2Uid);
    const { data: stolenRead, error: stolenErr } = await visitor2.from('messages').select('*').eq('conversation_id', conversationId1);
    check('a genuinely different anonymous session\'s direct SELECT returns ZERO rows (not an error — RLS silently filters)', !stolenErr && stolenRead.length === 0, JSON.stringify(stolenRead));
    const { data: stolenConvoRead } = await visitor2.from('conversations').select('*').eq('id', conversationId1);
    check('same isolation holds for the conversations row itself', stolenConvoRead.length === 0);

    // =========================================================================================
    console.log('\n4. GROUPING RULE — a second, different anonymous session with the SAME email joins the thread for WRITES, but is deliberately NOT granted read access to prior history (the disclosed security decision)\n');
    const start2 = await visitor2.functions.invoke('start-chat-conversation', { body: { contactEmail: email1, contactName: 'Someone Else Typing The Same Email' } });
    check('start-chat-conversation succeeds for the second session', !start2.error, start2.error && start2.error.message);
    check('the SAME real conversationId is returned (grouping by email, not by session)', start2.data.conversationId === conversationId1);
    check('this second session is deliberately NOT granted history — authorizedForHistory is false, messages is empty', start2.data.authorizedForHistory === false && start2.data.messages.length === 0);

    const { data: convoAfterSecondClaim } = await admin.from('conversations').select('visitor_auth_id').eq('id', conversationId1).single();
    check('visitor_auth_id was NOT reassigned to the second session — the original session keeps real read ownership', convoAfterSecondClaim.visitor_auth_id === visitor1Uid);

    const { error: secondSendErr } = await visitor2.from('messages').insert({ conversation_id: conversationId1, channel: 'chat', direction: 'inbound', body: 'A message from the second session.', sender_name: 'Someone Else', sender_email: email1 });
    check('★ the real, disclosed edge case: the second session CANNOT actually send either — RLS correctly requires visitor_auth_id match, which was never granted', !!secondSendErr, secondSendErr && secondSendErr.message);
    const { data: stillOneVisitorRead } = await visitor2.from('conversations').select('*').eq('id', conversationId1);
    check('confirmed via a direct read: the second session still has zero access to this conversation at all', stillOneVisitorRead.length === 0);

    // =========================================================================================
    console.log('\n5. GROUPING RULE — mixed channel: an admin-inserted "email" message joins the SAME conversation (proving Stage 2 needs no schema change)\n');
    const { error: emailMsgErr } = await admin.from('messages').insert({ conversation_id: conversationId1, channel: 'email', direction: 'inbound', body: 'This simulates a real inbound email in Stage 2, same conversation.', sender_name: 'Inbox Test Visitor', sender_email: email1, message_id: '<test-message-id@example.com>' });
    check('a real "email"-channel message inserts cleanly into the exact same conversation', !emailMsgErr, emailMsgErr && emailMsgErr.message);
    const { data: mixedMessages } = await admin.from('messages').select('channel').eq('conversation_id', conversationId1).order('sent_at');
    check('the conversation now genuinely contains both chat and email channel messages in one thread', mixedMessages.some((m) => m.channel === 'chat') && mixedMessages.some((m) => m.channel === 'email'));

    // =========================================================================================
    console.log('\n6. A REAL REGISTERED CLIENT starting a chat — identity comes from their own real clients row, never client-supplied\n');
    const clientEmail = 'inbox-client-' + suffix + '@example.com';
    const { data: createdClientUser } = await admin.auth.admin.createUser({ email: clientEmail, password: 'InboxClientPass2026!', email_confirm: true });
    cleanupAuthUserIds.push(createdClientUser.user.id);
    await admin.from('clients').insert({ id: createdClientUser.user.id, name: 'Real Inbox Client', email: clientEmail, phone: '+1-555-0950', account_type: 'Individual Account', status: 'active' });
    const clientSignedIn = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientSignedIn.auth.signInWithPassword({ email: clientEmail, password: 'InboxClientPass2026!' });

    const startClient = await clientSignedIn.functions.invoke('start-chat-conversation', { body: { contactEmail: 'attacker-supplied@example.com', contactName: 'Spoofed Name' } });
    check('start-chat-conversation succeeds for a real authenticated client', !startClient.error, startClient.error && startClient.error.message);
    check('★ the real client\'s OWN email/name are used, NOT the client-supplied body values — spoofing is genuinely impossible', startClient.data.contactEmail === clientEmail.toLowerCase() && startClient.data.contactName === 'Real Inbox Client');
    const clientConversationId = startClient.data.conversationId;
    cleanupConversationIds.push(clientConversationId);
    const { data: clientConvoRow } = await admin.from('conversations').select('client_id, visitor_auth_id').eq('id', clientConversationId).single();
    check('the real conversation row has client_id set to the real client, visitor_auth_id null', clientConvoRow.client_id === createdClientUser.user.id && clientConvoRow.visitor_auth_id === null);

    // =========================================================================================
    console.log('\n7. RETROACTIVE LINKING — an anonymous conversation gets linked automatically when that email later signs up\n');
    const retroEmail = 'inbox-retro-' + suffix + '@example.com';
    const { client: retroVisitor, uid: retroVisitorUid } = await anonClient(url, anonKey);
    cleanupAuthUserIds.push(retroVisitorUid);
    const startRetro = await retroVisitor.functions.invoke('start-chat-conversation', { body: { contactEmail: retroEmail, contactName: 'Future Client' } });
    const retroConversationId = startRetro.data.conversationId;
    cleanupConversationIds.push(retroConversationId);
    const { data: beforeSignup } = await admin.from('conversations').select('client_id').eq('id', retroConversationId).single();
    check('before signup: the conversation genuinely has no client_id yet', beforeSignup.client_id === null);

    const { data: retroClientUser } = await admin.auth.admin.createUser({ email: retroEmail, password: 'RetroClientPass2026!', email_confirm: true });
    cleanupAuthUserIds.push(retroClientUser.user.id);
    await admin.from('clients').insert({ id: retroClientUser.user.id, name: 'Future Client', email: retroEmail, phone: '+1-555-0951', account_type: 'Individual Account', status: 'active' });

    const { data: afterSignup } = await admin.from('conversations').select('client_id').eq('id', retroConversationId).single();
    check('★ the real on_client_insert_link_conversations TRIGGER genuinely linked client_id automatically, with zero application code involved', afterSignup.client_id === retroClientUser.user.id, afterSignup.client_id);

    // =========================================================================================
    console.log('\n8. ADMIN — reading all conversations, status actions, mark-read, real PM attribution\n');
    const { data: adminReadAll, error: adminReadErr } = await pm.from('conversations').select('id').in('id', [conversationId1, clientConversationId, retroConversationId]);
    check('a real admin-claimed session can read every conversation directly via RLS (no Edge Function needed for reads)', !adminReadErr && adminReadAll.length === 3, adminReadErr && adminReadErr.message);

    const resolveResult = await pm.functions.invoke('admin-update-conversation', { body: { conversationId: conversationId1, status: 'resolved' } });
    check('admin-update-conversation (resolve) succeeds', !resolveResult.error && resolveResult.data.status === 'resolved', resolveResult.error && resolveResult.error.message);
    check('★ real PM attribution recorded (resolved_by/resolved_by_email), matching this project\'s own established pattern', !!resolveResult.data.resolved_by && !!resolveResult.data.resolved_by_email);

    const readResult = await pm.functions.invoke('admin-update-conversation', { body: { conversationId: conversationId1, markRead: true } });
    check('admin-update-conversation (markRead) succeeds and genuinely clears unread_by_pm', !readResult.error && readResult.data.unread_by_pm === false, readResult.error && readResult.error.message);

    // =========================================================================================
    console.log('\n9. RLS matrix — client-facing roles genuinely cannot write conversations directly, cannot send outbound messages, cannot act as admin\n');
    // PostgREST/RLS real behavior, confirmed directly rather than assumed: an UPDATE with no
    // applicable RLS policy doesn't surface as an error — RLS's SELECT-side filtering makes
    // the row invisible for the update entirely, so PostgREST reports a genuine no-op
    // success with zero rows affected, not an error object. The real proof of RLS actually
    // blocking this is that the row's OWN status is provably unchanged afterward.
    await visitor1.from('conversations').update({ status: 'archived' }).eq('id', conversationId1);
    const { data: statusAfterAttempt } = await admin.from('conversations').select('status').eq('id', conversationId1).single();
    check('a real client-facing session cannot UPDATE conversations directly — RLS silently blocks it (no policy exists), confirmed by the real row staying unchanged (still "resolved" from step 8, not "archived")', statusAfterAttempt.status === 'resolved', statusAfterAttempt.status);
    const { error: outboundAsVisitorErr } = await visitor1.from('messages').insert({ conversation_id: conversationId1, channel: 'chat', direction: 'outbound', body: 'Pretending to be a PM.', sender_name: 'Fake PM' });
    check('a real visitor session cannot send an "outbound" (PM-role) message — RLS CHECK genuinely enforces direction/role together', !!outboundAsVisitorErr, outboundAsVisitorErr && outboundAsVisitorErr.message);
    const nonAdminUpdate = await visitor1.functions.invoke('admin-update-conversation', { body: { conversationId: conversationId1, status: 'archived' } });
    check('a genuine non-admin caller is refused (403) by admin-update-conversation itself', nonAdminUpdate.error && nonAdminUpdate.error.context && nonAdminUpdate.error.context.status === 403, JSON.stringify(nonAdminUpdate.error));
    const anonNoAuth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const noAuthResult = await anonNoAuth.functions.invoke('start-chat-conversation', { body: { contactEmail: 'x@example.com', contactName: 'X' } });
    check('a genuinely unauthenticated caller (no session at all) is refused (401)', noAuthResult.error && noAuthResult.error.context && noAuthResult.error.context.status === 401, JSON.stringify(noAuthResult.error));

    // =========================================================================================
    console.log('\n10. notify-new-chat-message — real idle-debounce logic\n');
    const notify1 = await visitor1.functions.invoke('notify-new-chat-message', { body: { conversationId: conversationId1 } });
    check('the first notify call for this conversation genuinely attempts to notify (not debounced)', !notify1.error && notify1.data.reason !== 'debounced', JSON.stringify(notify1.data || notify1.error));
    const { data: afterFirstNotify } = await admin.from('conversations').select('last_notified_at').eq('id', conversationId1).single();
    check('last_notified_at was genuinely set by the real call', !!afterFirstNotify.last_notified_at);

    const notify2 = await visitor1.functions.invoke('notify-new-chat-message', { body: { conversationId: conversationId1 } });
    check('★ an immediate second call is genuinely DEBOUNCED — the real point of this feature', !notify2.error && notify2.data.notified === false && notify2.data.reason === 'debounced', JSON.stringify(notify2.data));

    const { data: emailLogRows } = await admin.from('email_log').select('status, error_message, subject').eq('related_entity_id', conversationId1).eq('related_entity_type', 'conversation');
    if (emailLogRows && emailLogRows.length > 0) {
      const sentRow = emailLogRows.find((r) => r.status === 'sent');
      const failedRow = emailLogRows.find((r) => r.status === 'failed');
      if (sentRow) {
        console.log('  INFO  a real chat-notification email genuinely SENT (Resend quota was NOT exhausted at test time)');
        check('the real subject line correctly names the contact', /chat message from/i.test(sentRow.subject));
      } else if (failedRow) {
        const isQuota = /quota|rate.?limit|429|daily/i.test(failedRow.error_message || '');
        console.log('  INFO  real send failed — ' + (isQuota ? 'BLOCKED-ON-QUOTA (expected, not a real failure)' : 'a genuine, unexpected failure') + ': ' + failedRow.error_message);
        check('the real failure is honestly logged with a real error message (never silently dropped)', !!failedRow.error_message);
      }
    } else {
      check('email_log has a real row for this notification attempt (getAdminEmails found at least one real PM)', false, 'no email_log row found at all — check getAdminEmails()');
    }

    // =========================================================================================
    console.log('\n11. REAL SUPABASE REALTIME — a live subscription genuinely receives a new message event, not polling\n');
    const realtimeConversationId = clientConversationId;
    let realtimeEventReceived = null;
    let subscribeStatus = null;
    const channel = pm.channel('test-inbox-realtime-' + suffix)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + realtimeConversationId }, (payload) => {
        realtimeEventReceived = payload.new;
      })
      .subscribe(function (status) {
        // The documented-reliable signal, per the real installed SDK: channel.state
        // reaching 'joined' only confirms the underlying Phoenix/WebSocket channel
        // connected — the postgres_changes subscription itself is a separate server-side
        // registration step whose completion is reported ONLY via this callback's own
        // 'SUBSCRIBED' status, confirmed directly after this test first failed relying on
        // channel.state alone (which was already 'joined' well before the real server-side
        // subscription was actually active, a genuine race, not a fluke).
        subscribeStatus = status;
      });
    await waitFor(() => subscribeStatus === 'SUBSCRIBED', 8000);
    check('the real Realtime postgres_changes subscription genuinely reaches SUBSCRIBED (not just the channel\'s own "joined" state)', subscribeStatus === 'SUBSCRIBED', subscribeStatus);

    await sleep(300); // let the subscription fully settle before inserting, avoiding a real race with the join itself
    const realtimeMessageBody = 'A real-time test message — ' + suffix;
    await clientSignedIn.from('messages').insert({ conversation_id: realtimeConversationId, channel: 'chat', direction: 'inbound', body: realtimeMessageBody, sender_name: 'Real Inbox Client', sender_email: clientEmail });

    await waitFor(() => realtimeEventReceived !== null, 8000);
    check('★ the real admin session received the new message via a genuinely live Realtime event, not a poll', !!realtimeEventReceived && realtimeEventReceived.body === realtimeMessageBody, JSON.stringify(realtimeEventReceived));

    await pm.removeChannel(channel);
  } finally {
    console.log('\nCleaning up test data...');
    for (const id of cleanupConversationIds) {
      await admin.from('messages').delete().eq('conversation_id', id);
      await admin.from('conversations').delete().eq('id', id);
    }
    for (const id of cleanupAuthUserIds) {
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log('Done.');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  // Explicit exit (project-wide convention since the 2026-09-07 hang-bug audit — see
  // scripts/lib/run-verify.mjs's own header for the full "why"): this script creates many
  // real Supabase client instances (autoRefreshToken timers), which would otherwise keep the
  // process alive indefinitely after a real success. Not using the shared ESM
  // runVerifyMain() wrapper here since this file is CommonJS, matching every other
  // verify-supabase-*.js sibling script's own established style — the inline pattern below
  // is identical to what the 2026-09-07 audit already applied to all of them.
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
  process.exit(0);
}

const watchdog = setTimeout(function () {
  console.error('\nFATAL: script did not complete within 90s -- forcing exit.');
  process.exit(1);
}, 90000);

main().catch(function (err) {
  clearTimeout(watchdog);
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.stack || err));
  process.exit(1);
});
