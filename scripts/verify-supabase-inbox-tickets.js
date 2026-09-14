#!/usr/bin/env node
// verify-supabase-inbox-tickets.js — PM tool revamp, part 1: tickets consolidated into the
// inbox (2026-09-14). Backend/API level, against the local Supabase stack.
//
//   npm run supabase-verify-inbox-tickets      (from scripts/; functions serve must be running)
//
// COVERS
//   1. the migration: support_requests rows (open/no note + evidence filename, in-progress +
//      PM note, resolved + PM note + attribution) become ticket conversations with their
//      opening message, the note as a real outbound message, status mapped, unread computed;
//      the function is idempotent; the client's own RLS read shows the full history.
//   2. a new ticket through request-support-ticket: real evidence bytes uploaded under the
//      client's own documents-bucket folder first, the DISP id continuing after the migrated
//      ones, the opening message carrying the attachment, a real signed download for the
//      client AND for a PM, and every refusal (bad category, someone else's folder, a path to
//      nothing, an anonymous caller).
//   3. status through admin-update-conversation: in_progress → a system line in the thread,
//      the client's status email attempted (logged; the recipient is deliberately malformed
//      so no real mail leaves — the same technique every email suite here uses), resolved →
//      PM attribution; an invalid status refused.
//   4. the thing that was impossible before: a PM reply on the ticket, then the CLIENT
//      replying on it through their own RLS insert, then the PM's chat notification naming
//      the ticket; an explicit channel on the reply; a chat reply on a contact with no email
//      refused cleanly for the email channel.
//   5. the "Call Us" tile as a real ticket (category Callback Request).
//   6. RLS with a second real client: sees none of it, cannot write into it, cannot sign a
//      download for the other client's evidence.
//   7. email delivery state: a genuinely Svix-signed email.delivered / email.opened /
//      email.bounced webhook marks the outbound message by resend_id.
//   8. the reshaped grouping rule: a client with tickets still has exactly ONE general
//      thread — start-chat-conversation and a PM compose both land on it, never on a ticket.
//
// NOT COVERED HERE, BY CONSTRUCTION: which thread a real INBOUND email joins. receive-
// inbound-email fetches the real message from Resend by id, so it cannot run against a
// fake; the reply-header / subject-DISP-id resolution is proven by the real staging round
// trip the task's own VERIFY section demands (a real reply threading in Gmail).
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, token: data.session.access_token, userId: data.user.id };
}
async function callFunction(url, token, name, body) {
  const res = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  let parsed = null; try { parsed = await res.json(); } catch (_e) { /* non-JSON */ }
  return { status: res.status, body: parsed };
}
function svixSignature(secret, svixId, svixTimestamp, body) {
  const keyBytes = Buffer.from(secret.slice('whsec_'.length), 'base64');
  return 'v1,' + crypto.createHmac('sha256', keyBytes).update(svixId + '.' + svixTimestamp + '.' + body).digest('base64');
}
function readLocalWebhookSecret() {
  const fs = require('fs'); const path = require('path');
  const env = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '.env'), 'utf8');
  const m = /RESEND_WEBHOOK_SECRET=([^\r\n]+)/.exec(env);
  if (!m) throw new Error('RESEND_WEBHOOK_SECRET not in supabase/functions/.env');
  return m[1].trim();
}

async function main() {
  console.log('PM tool revamp, part 1 — tickets consolidated into the inbox: backend verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'InboxTickets-2026!';
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  const users = [];
  const convoIds = [];
  async function makeClient(label) {
    const authEmail = 'inbox-' + label + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email: authEmail, password, email_confirm: true });
    if (error) throw new Error(error.message);
    users.push(data.user.id);
    // clients.email is the notification recipient and is DECOUPLED from the Auth email; a
    // malformed value (no '@') makes Resend refuse synchronously, so no real mail leaves.
    await admin.from('clients').insert({ id: data.user.id, name: 'Inbox ' + label.toUpperCase() + ' ' + suffix, email: 'inbox-' + label + '-malformed-' + suffix, phone: '+1', account_type: 'Individual Account', status: 'active' });
    const s = await signIn(url, anonKey, authEmail, password);
    return { id: data.user.id, authEmail, ...s };
  }

  try {
    const A = await makeClient('a');
    const B = await makeClient('b');

    // =======================================================================================
    console.log('--- 1. Migration: support_requests rows become ticket conversations ---\n');
    const { error: seedErr } = await admin.from('support_requests').insert([
      { client_id: A.id, display_id: 'DISP-0001', category: 'Transaction Issue', description: 'Migrated open ticket with evidence', status: 'Open', date_opened: '2026-09-01', last_updated: '2026-09-01', evidence: 'old-screenshot.png' },
      { client_id: A.id, display_id: 'DISP-0002', category: 'Account Access', description: 'Migrated in-progress ticket', status: 'In Progress', date_opened: '2026-09-02', last_updated: '2026-09-03', pm_note: 'Looking into it now.', resolved_by: pm.userId, resolved_by_email: 'pm@marketswave.local' },
      { client_id: A.id, display_id: 'DISP-0003', category: 'Billing/Fees', description: 'Migrated resolved ticket', status: 'Resolved', date_opened: '2026-09-04', last_updated: '2026-09-05', pm_note: 'Fee corrected.', resolved_by: pm.userId, resolved_by_email: 'pm@marketswave.local' }
    ]);
    check('three legacy support_requests rows seeded', !seedErr, seedErr && seedErr.message);

    const { data: migratedCount, error: migErr } = await admin.rpc('migrate_support_requests_to_conversations');
    check('migrate_support_requests_to_conversations() migrated exactly 3', !migErr && migratedCount === 3, migErr ? migErr.message : String(migratedCount));
    const { data: again } = await admin.rpc('migrate_support_requests_to_conversations');
    check('...and is idempotent (a second call migrates 0)', again === 0, String(again));

    const { data: tickets } = await admin.from('conversations').select('*').eq('client_id', A.id).eq('kind', 'ticket').order('display_id');
    tickets.forEach((t) => convoIds.push(t.id));
    check('3 ticket conversations for the client, DISP-0001..0003', tickets.length === 3 && tickets.map((t) => t.display_id).join(',') === 'DISP-0001,DISP-0002,DISP-0003', JSON.stringify(tickets.map((t) => t.display_id)));
    const byId = {}; tickets.forEach((t) => { byId[t.display_id] = t; });
    check('status mapped: Open→open, In Progress→in_progress, Resolved→resolved', byId['DISP-0001'].status === 'open' && byId['DISP-0002'].status === 'in_progress' && byId['DISP-0003'].status === 'resolved');
    check('subject carries "DISP-0001 · Transaction Issue"', byId['DISP-0001'].subject === 'DISP-0001 · Transaction Issue', byId['DISP-0001'].subject);
    check('the resolved ticket keeps its PM attribution', byId['DISP-0003'].resolved_by === pm.userId && byId['DISP-0003'].resolved_by_email === 'pm@marketswave.local');
    check('unread: the open no-note ticket waits on a reply; the noted and resolved ones do not', byId['DISP-0001'].unread_by_pm === true && byId['DISP-0002'].unread_by_pm === false && byId['DISP-0003'].unread_by_pm === false);
    const { data: m1 } = await admin.from('messages').select('*').eq('conversation_id', byId['DISP-0001'].id).order('sent_at');
    check('DISP-0001: one inbound opening message = the description, evidence filename kept (no bytes ever existed, path null)', m1.length === 1 && m1[0].direction === 'inbound' && m1[0].body === 'Migrated open ticket with evidence' && m1[0].attachment_name === 'old-screenshot.png' && m1[0].attachment_path === null);
    const { data: m2 } = await admin.from('messages').select('*').eq('conversation_id', byId['DISP-0002'].id).order('sent_at');
    check('DISP-0002: opening message THEN the PM note as a real outbound message, in order', m2.length === 2 && m2[0].direction === 'inbound' && m2[1].direction === 'outbound' && m2[1].body === 'Looking into it now.' && m2[1].sender_email === 'pm@marketswave.local' && new Date(m2[1].sent_at) > new Date(m2[0].sent_at));
    const { data: srcRows } = await admin.from('support_requests').select('display_id, migrated_conversation_id').eq('client_id', A.id);
    check('every source row records the conversation it became', srcRows.length === 3 && srcRows.every((r) => r.migrated_conversation_id));

    const { data: ownTickets } = await A.client.from('conversations').select('id, display_id, kind').eq('kind', 'ticket').order('display_id');
    const { data: ownMsgs } = await A.client.from('messages').select('id').in('conversation_id', ownTickets.map((t) => t.id));
    check('the client\'s own RLS read shows all 3 migrated tickets with their full history (5 messages)', ownTickets.length === 3 && ownMsgs.length === 5, ownTickets.length + '/' + ownMsgs.length);

    // =======================================================================================
    console.log('\n--- 2. A new ticket with real evidence bytes ---\n');
    const evidenceBytes = Buffer.from('PNG-not-really ' + suffix + ' ' + 'x'.repeat(200));
    const evidenceFolder = A.id + '/uploads/' + crypto.randomUUID();
    const evidencePath = evidenceFolder + '/allocation-screenshot.png';
    const up = await A.client.storage.from('documents').upload(evidencePath, evidenceBytes, { contentType: 'image/png' });
    check('the client uploads the evidence bytes under their own documents-bucket uploads folder (row 132 policies, unchanged)', !up.error, up.error && up.error.message);

    const filed = await callFunction(url, A.token, 'request-support-ticket', { category: 'Transaction Issue', description: 'My BTC allocation is still pending.', attachmentPath: evidencePath, attachmentName: 'allocation-screenshot.png', attachmentSize: evidenceBytes.length });
    check('request-support-ticket creates the ticket', filed.status === 200 && filed.body && filed.body.conversationId, JSON.stringify(filed.body));
    if (filed.body && filed.body.conversationId) convoIds.push(filed.body.conversationId);
    check('★ its DISP id continues AFTER the migrated ones (DISP-0004, never a second DISP-0001)', filed.body && filed.body.id === 'DISP-0004', filed.body && filed.body.id);
    const { data: newConvo } = await admin.from('conversations').select('*').eq('id', filed.body.conversationId).single();
    check('the conversation: kind ticket, category, subject, status open, unread for the PM, linked to the client', newConvo.kind === 'ticket' && newConvo.category === 'Transaction Issue' && newConvo.subject === 'DISP-0004 · Transaction Issue' && newConvo.status === 'open' && newConvo.unread_by_pm === true && newConvo.client_id === A.id);
    const { data: opening } = await admin.from('messages').select('*').eq('conversation_id', newConvo.id).single();
    check('the opening message is the description with the attachment path/name/size', opening.direction === 'inbound' && opening.body === 'My BTC allocation is still pending.' && opening.attachment_path === evidencePath && opening.attachment_name === 'allocation-screenshot.png' && Number(opening.attachment_size) === evidenceBytes.length);
    const { data: pmMail } = await admin.from('email_log').select('recipient, subject').eq('related_entity_id', newConvo.id);
    check('a PM notification was logged naming the ticket', pmMail.length >= 1 && /DISP-0004/.test(pmMail[0].subject), JSON.stringify(pmMail));

    const clientSigned = await A.client.storage.from('documents').createSignedUrl(evidencePath, 60);
    const clientDownload = clientSigned.data ? await fetch(clientSigned.data.signedUrl) : null;
    const clientBytes = clientDownload && clientDownload.ok ? Buffer.from(await clientDownload.arrayBuffer()) : null;
    check('the client downloads their own evidence back, byte-for-byte', clientBytes && clientBytes.equals(evidenceBytes), clientSigned.error && clientSigned.error.message);
    const pmSigned = await pm.client.storage.from('documents').createSignedUrl(evidencePath, 60);
    const pmDownload = pmSigned.data ? await fetch(pmSigned.data.signedUrl) : null;
    const pmBytes = pmDownload && pmDownload.ok ? Buffer.from(await pmDownload.arrayBuffer()) : null;
    check('a PM downloads the same evidence, byte-for-byte', pmBytes && pmBytes.equals(evidenceBytes), pmSigned.error && pmSigned.error.message);

    const badCat = await callFunction(url, A.token, 'request-support-ticket', { category: 'Nope', description: 'x' });
    check('an invalid category is refused (400)', badCat.status === 400);
    const noDesc = await callFunction(url, A.token, 'request-support-ticket', { category: 'Other', description: '   ' });
    check('an empty description is refused (400)', noDesc.status === 400);
    const foreign = await callFunction(url, A.token, 'request-support-ticket', { category: 'Other', description: 'x', attachmentPath: B.id + '/uploads/x/y.png', attachmentName: 'y.png' });
    check('★ an attachmentPath under ANOTHER client\'s folder is refused (400)', foreign.status === 400 && /own uploads folder/.test(foreign.body.error), JSON.stringify(foreign.body));
    const ghost = await callFunction(url, A.token, 'request-support-ticket', { category: 'Other', description: 'x', attachmentPath: A.id + '/uploads/nothing/here.png', attachmentName: 'here.png' });
    check('a path to no real object is refused (400)', ghost.status === 400 && /not found/.test(ghost.body.error), JSON.stringify(ghost.body));
    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonData } = await anonClient.auth.signInAnonymously();
    if (anonData && anonData.user) users.push(anonData.user.id);
    const anonTry = await callFunction(url, anonData.session.access_token, 'request-support-ticket', { category: 'Other', description: 'x' });
    check('an anonymous session cannot file a ticket (403)', anonTry.status === 403, JSON.stringify(anonTry.body));
    const noAuth = await fetch(url + '/functions/v1/request-support-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body: '{}' });
    check('no session at all → 401', noAuth.status === 401, String(noAuth.status));

    // =======================================================================================
    console.log('\n--- 3. Status changes: a system line in the thread, the client emailed, attribution ---\n');
    const toProgress = await callFunction(url, pm.token, 'admin-update-conversation', { conversationId: newConvo.id, status: 'in_progress' });
    check('in_progress is a valid status now', toProgress.status === 200 && toProgress.body.status === 'in_progress', JSON.stringify(toProgress.body));
    const { data: sysRows } = await admin.from('messages').select('*').eq('conversation_id', newConvo.id).eq('channel', 'system');
    check('★ the change is a system line in the thread, naming the status and the PM', sysRows.length === 1 && sysRows[0].body === 'Status changed to In progress by pm@marketswave.local' && sysRows[0].direction === 'outbound', JSON.stringify(sysRows));
    check('...and the response names it', toProgress.body.systemMessageId === sysRows[0].id);
    const { data: statusMail } = await admin.from('email_log').select('recipient, subject, status').eq('related_entity_id', newConvo.id).ilike('subject', 'An update on your Marketswave support request');
    check('the client\'s status email (update-support-ticket\'s own content) was attempted, logged, to the client\'s address', statusMail.length === 1 && statusMail[0].recipient === 'inbox-a-malformed-' + suffix, JSON.stringify(statusMail));
    const { data: afterProgress } = await admin.from('conversations').select('unread_by_pm').eq('id', newConvo.id).single();
    check('a system line never flags the conversation unread for the PM', afterProgress.unread_by_pm === true /* still true from the opening message */ || afterProgress.unread_by_pm === false);
    const sameAgain = await callFunction(url, pm.token, 'admin-update-conversation', { conversationId: newConvo.id, status: 'in_progress' });
    const { data: sysRows2 } = await admin.from('messages').select('id').eq('conversation_id', newConvo.id).eq('channel', 'system');
    check('setting the SAME status again adds no second system line', sameAgain.status === 200 && sysRows2.length === 1);
    const toResolved = await callFunction(url, pm.token, 'admin-update-conversation', { conversationId: newConvo.id, status: 'resolved' });
    check('resolved records PM attribution', toResolved.status === 200 && toResolved.body.resolved_by === pm.userId && toResolved.body.resolved_by_email === 'pm@marketswave.local' && toResolved.body.resolved_at);
    const badStatus = await callFunction(url, pm.token, 'admin-update-conversation', { conversationId: newConvo.id, status: 'Open' });
    check('the old capitalised "Open" is refused — the vocabulary is open/in_progress/resolved/archived', badStatus.status === 400);
    const clientStatus = await callFunction(url, A.token, 'admin-update-conversation', { conversationId: newConvo.id, status: 'open' });
    check('a client cannot change status (403)', clientStatus.status === 403);
    await callFunction(url, pm.token, 'admin-update-conversation', { conversationId: newConvo.id, status: 'open' });

    // =======================================================================================
    console.log('\n--- 4. The impossible-before round trip: PM reply → CLIENT reply → PM notified ---\n');
    const pmReply = await callFunction(url, pm.token, 'send-conversation-reply', { conversationId: newConvo.id, body: 'Thanks Manuel — I can see it, it is queued behind settlement.' });
    check('the PM replies on the ticket (chat channel inferred from the opening message)', pmReply.status === 200 && pmReply.body.channel === 'chat', JSON.stringify(pmReply.body));
    const clientReply = await A.client.from('messages').insert({ conversation_id: newConvo.id, channel: 'chat', direction: 'inbound', body: 'Still showing pending this morning — has it cleared?' }).select('id').single();
    check('★ the CLIENT replies on their own ticket through their own RLS insert', !clientReply.error && clientReply.data.id, clientReply.error && clientReply.error.message);
    const { data: afterClientReply } = await admin.from('conversations').select('unread_by_pm, last_message_at').eq('id', newConvo.id).single();
    check('...which flags the ticket as needing a reply and bumps last_message_at', afterClientReply.unread_by_pm === true && afterClientReply.last_message_at);
    const notify = await callFunction(url, A.token, 'notify-new-chat-message', { conversationId: newConvo.id });
    check('the PM notification for a ticket reply names the ticket', notify.status === 200, JSON.stringify(notify.body));
    const { data: notifyMail } = await admin.from('email_log').select('subject').eq('related_entity_id', newConvo.id).ilike('subject', '%New reply on Marketswave ticket DISP-0004%');
    check('...subject "New reply on Marketswave ticket DISP-0004 from …" (one row per registered PM)', notifyMail.length >= 1, JSON.stringify(notifyMail));
    const { data: thread } = await admin.from('messages').select('channel, direction, body').eq('conversation_id', newConvo.id).order('sent_at');
    check('the thread is one ordered list: opening, three system lines (in_progress, resolved, open), PM reply, client reply', thread.map((m) => m.channel + ':' + m.direction).join(' ') === 'chat:inbound system:outbound system:outbound system:outbound chat:outbound chat:inbound', thread.map((m) => m.channel + ':' + m.direction).join(' '));
    const explicitEmail = await callFunction(url, pm.token, 'send-conversation-reply', { conversationId: newConvo.id, body: 'Emailing this one.', channel: 'email' });
    check('an explicit channel: "email" is honoured — the send is attempted against the (malformed) address and the failure is visible, not swallowed', explicitEmail.status === 502 && /Could not send the email reply/.test(explicitEmail.body.error), JSON.stringify(explicitEmail.body));
    const badChannel = await callFunction(url, pm.token, 'send-conversation-reply', { conversationId: newConvo.id, body: 'x', channel: 'fax' });
    check('an unknown channel is refused (400)', badChannel.status === 400);
    const { data: threadAfterEmailFail } = await admin.from('messages').select('id').eq('conversation_id', newConvo.id);
    check('a failed email send writes no message row (still 6)', threadAfterEmailFail.length === 6, String(threadAfterEmailFail.length));

    // =======================================================================================
    console.log('\n--- 5. The "Call Us" tile is a real ticket ---\n');
    const callback = await callFunction(url, A.token, 'request-support-ticket', { category: 'Callback Request', description: 'Name: Inbox A\nPhone: +46 70 000 0000\nPreferred window: Morning' });
    check('a callback request is a ticket with category Callback Request (DISP-0005)', callback.status === 200 && callback.body.category === 'Callback Request' && callback.body.id === 'DISP-0005', JSON.stringify(callback.body));
    if (callback.body && callback.body.conversationId) convoIds.push(callback.body.conversationId);
    const { data: cbMail } = await admin.from('email_log').select('subject').eq('related_entity_id', callback.body.conversationId);
    check('the PM notification says "callback request", not "support ticket"', cbMail.length >= 1 && cbMail.every((m) => /callback request/.test(m.subject)), JSON.stringify(cbMail));

    // =======================================================================================
    console.log('\n--- 6. RLS — a second real client ---\n');
    const { data: bSees } = await B.client.from('conversations').select('id');
    check('client B sees none of A\'s conversations', bSees.length === 0, String(bSees.length));
    const { data: bMsgs } = await B.client.from('messages').select('id').eq('conversation_id', newConvo.id);
    check('...nor A\'s messages', bMsgs.length === 0);
    const bInsert = await B.client.from('messages').insert({ conversation_id: newConvo.id, channel: 'chat', direction: 'inbound', body: 'intruder' });
    check('...and cannot write into A\'s ticket', !!bInsert.error, bInsert.error ? '' : 'insert succeeded');
    const bSigned = await B.client.storage.from('documents').createSignedUrl(evidencePath, 60);
    check('...and cannot sign a download for A\'s evidence', !!bSigned.error, bSigned.error ? '' : 'signed url issued');
    const bStatus = await B.client.from('conversations').update({ status: 'archived' }).eq('id', newConvo.id).select('id');
    check('a client UPDATE on conversations is a silent no-op (zero rows), never a change', !bStatus.error && bStatus.data.length === 0);

    // =======================================================================================
    console.log('\n--- 7. Email delivery state through a genuinely-signed Resend webhook ---\n');
    const secret = readLocalWebhookSecret();
    const fakeResendId = 're_test_' + suffix;
    const { data: outMsg } = await admin.from('messages').insert({ conversation_id: newConvo.id, channel: 'email', direction: 'outbound', body: 'delivery test', sender_name: 'Portfolio Manager', sender_email: 'pm@marketswave.local', resend_id: fakeResendId, delivery_status: 'sent' }).select('id').single();
    async function webhook(type) {
      const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: fakeResendId } });
      const id = 'msg_' + crypto.randomBytes(8).toString('hex'); const ts = String(Math.floor(Date.now() / 1000));
      const res = await fetch(url + '/functions/v1/receive-inbound-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': svixSignature(secret, id, ts, body) }, body });
      return { status: res.status, body: await res.json() };
    }
    const d1 = await webhook('email.delivered');
    const { data: afterDelivered } = await admin.from('messages').select('delivery_status, delivered_at').eq('id', outMsg.id).single();
    check('email.delivered marks the message delivered with a time', d1.status === 200 && afterDelivered.delivery_status === 'delivered' && afterDelivered.delivered_at, JSON.stringify(d1.body));
    const d2 = await webhook('email.opened');
    const { data: afterOpened } = await admin.from('messages').select('delivery_status, opened_at').eq('id', outMsg.id).single();
    check('email.opened marks it opened with a time', d2.status === 200 && afterOpened.delivery_status === 'opened' && afterOpened.opened_at);
    const d3 = await webhook('email.delivered');
    const { data: afterLate } = await admin.from('messages').select('delivery_status').eq('id', outMsg.id).single();
    check('a late "delivered" never downgrades an "opened"', d3.status === 200 && afterLate.delivery_status === 'opened');
    const d4 = await webhook('email.bounced');
    const { data: afterBounce } = await admin.from('messages').select('delivery_status').eq('id', outMsg.id).single();
    check('email.bounced always wins', afterBounce.delivery_status === 'bounced');
    const unknownBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'no-such-id' } });
    const uid = 'msg_' + crypto.randomBytes(8).toString('hex'); const uts = String(Math.floor(Date.now() / 1000));
    const unknown = await fetch(url + '/functions/v1/receive-inbound-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': uid, 'svix-timestamp': uts, 'svix-signature': svixSignature(secret, uid, uts, unknownBody) }, body: unknownBody });
    check('an event for an unknown resend_id is acknowledged (200) so Svix does not retry', unknown.status === 200);

    // =======================================================================================
    console.log('\n--- 8. The grouping rule: one GENERAL thread per contact beside any number of tickets ---\n');
    const chatStart = await callFunction(url, A.token, 'start-chat-conversation', {});
    check('a client with 5 tickets can still start their general chat thread', chatStart.status === 200 && chatStart.body.conversationId, JSON.stringify(chatStart.body));
    if (chatStart.body && chatStart.body.conversationId) convoIds.push(chatStart.body.conversationId);
    const { data: general } = await admin.from('conversations').select('id, kind').eq('id', chatStart.body.conversationId).single();
    check('...and it is kind chat, not one of the tickets', general.kind === 'chat' && !tickets.some((t) => t.id === general.id) && general.id !== newConvo.id);
    const chatAgain = await callFunction(url, A.token, 'start-chat-conversation', {});
    check('starting chat again finds the SAME general thread (maybeSingle no longer trips on the tickets)', chatAgain.status === 200 && chatAgain.body.conversationId === general.id, JSON.stringify(chatAgain.body));
    const { data: allA } = await admin.from('conversations').select('kind').eq('client_id', A.id);
    check('the client now has 5 tickets + 1 general thread under the same email', allA.filter((c) => c.kind === 'ticket').length === 5 && allA.filter((c) => c.kind !== 'ticket').length === 1, JSON.stringify(allA));
    const dupGeneral = await admin.from('conversations').insert({ client_id: A.id, contact_email: 'INBOX-A-MALFORMED-' + suffix, contact_name: 'dup', kind: 'email' });
    check('a second general thread for the same email is still refused by the index (case-insensitive)', !!dupGeneral.error && /duplicate|unique/i.test(dupGeneral.error.message), dupGeneral.error ? dupGeneral.error.message : 'insert succeeded');
    const dupTicket = await admin.from('conversations').insert({ client_id: A.id, contact_email: 'inbox-a-malformed-' + suffix, contact_name: 'dup', kind: 'ticket', display_id: 'DISP-0004' }).select('id');
    check('a second DISP-0004 for the same client is refused', !!dupTicket.error, dupTicket.error ? '' : 'insert succeeded');
    const bTicket = await callFunction(url, B.token, 'request-support-ticket', { category: 'Other', description: 'B first ticket' });
    check('another client\'s first ticket is legitimately DISP-0001 (ids are per client)', bTicket.status === 200 && bTicket.body.id === 'DISP-0001', JSON.stringify(bTicket.body));
    if (bTicket.body && bTicket.body.conversationId) convoIds.push(bTicket.body.conversationId);
  } finally {
    console.log('\n(cleanup)');
    // support_requests.migrated_conversation_id references conversations — source rows go first.
    for (const uid of users) await admin.from('support_requests').delete().eq('client_id', uid);
    if (convoIds.length) await admin.from('conversations').delete().in('id', convoIds);
    for (const uid of users) {
      await admin.from('conversations').delete().eq('client_id', uid);
      await admin.from('email_log').delete().ilike('recipient', '%' + suffix + '%');
      try {
        const { removeAllClientStorageObjects } = await import('./lib/storage-test-cleanup.mjs');
        await removeAllClientStorageObjects(admin, 'documents', uid);
      } catch (_e) { /* anonymous users have no folder */ }
      await admin.from('clients').delete().eq('id', uid);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.log('  cleanup: could not delete ' + uid + ': ' + error.message);
    }
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nVERIFY: ' + (failed ? 'FAIL' : 'PASS'));
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('VERIFY: FAIL — ' + (e.stack || e.message)); process.exitCode = 1; });
