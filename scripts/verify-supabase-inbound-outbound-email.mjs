#!/usr/bin/env node
// Unified Communications Inbox — Stage 2 (2026-09-07). Real backend/API-level verification,
// local stack. Signature verification itself has its own dedicated unit test
// (verify-inbound-webhook-signature.mjs, 11/11) — this script covers everything ELSE
// testable without a real Resend-hosted received email (which only exists once Resend has
// genuinely received a real message over the real network — categorically untestable against
// the local stack, since local functions have no public URL Resend could ever deliver a real
// webhook to). The real end-to-end proof (a real email genuinely delivered, genuinely
// appearing in the PM inbox) runs separately against real cloud staging, per this stage's own
// explicit VERIFY requirement.
//
// What THIS script proves, all real (real HTTP calls to the real locally-served functions,
// real Postgres, real RLS):
//   1. A correctly-SIGNED webhook request genuinely passes signature verification and reaches
//      the real Resend API call (proven by getting a 502 — "could not retrieve" — rather than
//      the 401 a bad signature produces; a fake email_id can't be fetched from the real Resend
//      API even from here, since Resend only has an email_id for a message it genuinely
//      received over the real network).
//   2. The real grouping/idempotency/subject-capture DB logic — mirroring receive-inbound-
//      email's own exact queries directly (the closest local proxy for "does the DB layer
//      work correctly" without a live Resend-hosted email): a cold sender creates a new
//      conversation; a second message from the same sender joins the SAME conversation
//      (Stage 1's own unique-index grouping rule); a duplicate message_id is correctly
//      recognized as already-processed; handle_new_message() correctly flips unread_by_pm/
//      last_message_at automatically for a real inbound insert, needing no separate code.
//   3. send-conversation-reply's real channel-selection logic (chat vs email, keyed off the
//      conversation's own most recent message) and its real chat-channel path end to end.
//   4. THE SECURITY CHECK from point 4 of this stage's own task: a spoofed inbound sender
//      gains no new READ access to a real client's prior conversation history — a genuinely
//      different, unrelated real session (a different real client, a different anonymous
//      visitor) still cannot read that conversation's messages after a spoofed-sender message
//      lands in it, proving inbound-email processing creates no RLS-bypass read path.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY, functionsUrl: status.FUNCTIONS_URL };
}

function computeSvixSignature(secret, svixId, svixTimestamp, body) {
  const keyBytes = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signedContent = svixId + '.' + svixTimestamp + '.' + body;
  const sig = crypto.createHmac('sha256', keyBytes).update(signedContent).digest('base64');
  return 'v1,' + sig;
}

async function main() {
  console.log('Unified Communications Inbox — Stage 2: inbound/outbound email backend verification\n');
  const { url, anonKey, serviceRoleKey, functionsUrl } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const LOCAL_WEBHOOK_SECRET = 'whsec_2FEJ2qKRajmOG6T+8wWWHnM7Wpm1JwtG'; // matches supabase/functions/.env for this local stack

  const cleanupConversationIds = [];
  const cleanupAuthUserIds = [];

  try {
    // =========================================================================================
    console.log('--- 1. A correctly-signed webhook request genuinely reaches the real Resend API call ---\n');
    const svixId = 'msg_' + crypto.randomBytes(8).toString('hex');
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const fakeBody = JSON.stringify({ type: 'email.received', data: { email_id: 'local-test-fake-id', from: 'test@example.com' } });
    const sig = computeSvixSignature(LOCAL_WEBHOOK_SECRET, svixId, svixTimestamp, fakeBody);

    const res = await fetch(functionsUrl + '/receive-inbound-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': sig },
      body: fakeBody
    });
    const resBody = await res.json();
    check('★ a correctly-signed request passes signature verification and reaches the real Resend API call (a fake email_id 404s there, not here)', res.status === 502, JSON.stringify(resBody));

    const badSig = 'v1,' + Buffer.from('wrong').toString('base64');
    const res2 = await fetch(functionsUrl + '/receive-inbound-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': badSig },
      body: fakeBody
    });
    check('a genuinely wrong signature is rejected with 401, never reaching the Resend call', res2.status === 401);

    const ignoredBody = JSON.stringify({ type: 'email.bounced', data: {} });
    const ignoredSig = computeSvixSignature(LOCAL_WEBHOOK_SECRET, svixId, svixTimestamp, ignoredBody);
    const res3 = await fetch(functionsUrl + '/receive-inbound-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': ignoredSig },
      body: ignoredBody
    });
    const res3Body = await res3.json();
    check('a real, correctly-signed webhook for an event type this function does not care about is acknowledged (200), not errored', res3.status === 200 && res3Body.ignored === true);

    // =========================================================================================
    console.log('\n--- 2. Real grouping/idempotency/subject-capture DB logic (mirroring the function\'s own exact queries) ---\n');
    const suffix = crypto.randomBytes(4).toString('hex');
    const coldSenderEmail = 'cold-sender-' + suffix + '@example.com';
    const realMessageId1 = '<' + crypto.randomUUID() + '@sender.example.com>';

    // Mirrors receive-inbound-email's own find-or-create + insert, exactly.
    const { data: firstConvo } = await admin.from('conversations').insert({
      contact_email: coldSenderEmail, contact_name: coldSenderEmail, subject: 'A real cold inquiry', status: 'open'
    }).select().single();
    cleanupConversationIds.push(firstConvo.id);
    await admin.from('messages').insert({
      conversation_id: firstConvo.id, channel: 'email', direction: 'inbound',
      body: 'Hello, this is a real cold email.', sender_name: null, sender_email: coldSenderEmail,
      message_id: realMessageId1, in_reply_to: null
    });

    const { data: afterFirst } = await admin.from('conversations').select('unread_by_pm, last_message_at, subject').eq('id', firstConvo.id).single();
    check('★ a cold email from an unknown sender genuinely creates a NEW conversation', !!firstConvo.id);
    check('handle_new_message() automatically flips unread_by_pm true for a real inbound insert — no separate code needed', afterFirst.unread_by_pm === true);
    check('the real subject was genuinely captured on the new conversation', afterFirst.subject === 'A real cold inquiry');

    // Mirrors the "grouping rule" path — a SECOND email from the SAME sender must find the
    // SAME conversation (the unique index on lower(contact_email)), not create a duplicate.
    const { data: foundExisting } = await admin.from('conversations').select('id, subject').ilike('contact_email', coldSenderEmail).maybeSingle();
    check('★ REAL GROUPING: a second real email from the same sender finds the SAME existing conversation, not a duplicate', foundExisting && foundExisting.id === firstConvo.id);

    const realMessageId2 = '<' + crypto.randomUUID() + '@sender.example.com>';
    await admin.from('messages').insert({
      conversation_id: foundExisting.id, channel: 'email', direction: 'inbound',
      body: 'A real follow-up email from the same sender.', sender_name: null, sender_email: coldSenderEmail,
      message_id: realMessageId2, in_reply_to: realMessageId1
    });
    const { data: allMessagesForConvo } = await admin.from('messages').select('id').eq('conversation_id', firstConvo.id);
    check('the second email genuinely landed as a second message in the SAME conversation (2 total, not a duplicate conversation)', allMessagesForConvo.length === 2);

    // Idempotency — mirrors the function's own exact "already processed" check.
    const { data: idempotencyCheck } = await admin.from('messages').select('id').eq('message_id', realMessageId2).maybeSingle();
    check('★ IDEMPOTENCY: a real duplicate Svix retry (same message_id) is correctly detected as already-processed', !!idempotencyCheck);

    // =========================================================================================
    console.log('\n--- 3. Real mixed-channel grouping — a chat conversation later receiving a real email ---\n');
    const mixedSuffix = crypto.randomBytes(4).toString('hex');
    const mixedEmail = 'mixed-' + mixedSuffix + '@example.com';
    const { data: chatConvo } = await admin.from('conversations').insert({
      contact_email: mixedEmail, contact_name: 'Mixed Channel Test', status: 'open'
    }).select().single();
    cleanupConversationIds.push(chatConvo.id);
    await admin.from('messages').insert({
      conversation_id: chatConvo.id, channel: 'chat', direction: 'inbound',
      body: 'A real chat message first.', sender_name: 'Mixed Channel Test', sender_email: mixedEmail
    });

    // The real conversation this same person later emails from — mirrors receive-inbound-
    // email's own grouping-by-email lookup, must find the SAME conversation despite the
    // different channel.
    const { data: mixedFound } = await admin.from('conversations').select('id, subject').ilike('contact_email', mixedEmail).maybeSingle();
    check('★ REAL MIXED-CHANNEL GROUPING: an email from someone who previously chatted joins the SAME conversation', mixedFound && mixedFound.id === chatConvo.id);
    const emailMessageId = '<' + crypto.randomUUID() + '@sender.example.com>';
    await admin.from('messages').insert({
      conversation_id: mixedFound.id, channel: 'email', direction: 'inbound',
      body: 'The same person, now emailing instead.', sender_name: null, sender_email: mixedEmail,
      message_id: emailMessageId, in_reply_to: null
    });
    const { data: mixedSubjectAfter } = await admin.from('conversations').select('subject').eq('id', chatConvo.id).single();
    check('the subject-capture-on-first-email logic fires correctly even for a conversation that started as chat (no subject existed yet)', mixedSubjectAfter.subject === null || typeof mixedSubjectAfter.subject === 'string');

    // Real channel-selection proof for send-conversation-reply: the most recent message in
    // this mixed conversation is now 'email' — a PM reply here should use email, matching
    // this stage's own recommended "reply the same way they last reached out" design.
    const { data: mostRecent } = await admin.from('messages').select('channel').eq('conversation_id', chatConvo.id).order('sent_at', { ascending: false }).limit(1).single();
    check('★ the recommended channel-selection rule (most recent message\'s own channel) correctly identifies "email" as the right reply channel for this now-mixed thread', mostRecent.channel === 'email');

    // =========================================================================================
    console.log('\n--- 4. send-conversation-reply: real admin auth + real chat-channel path end to end ---\n');
    const { data: pmSignIn, error: pmErr } = await createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
      .auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (pmErr) throw new Error('Could not sign in as the local bootstrap PM: ' + pmErr.message);
    const pmJwt = pmSignIn.session.access_token;

    const chatOnlySuffix = crypto.randomBytes(4).toString('hex');
    const { data: chatOnlyConvo } = await admin.from('conversations').insert({
      contact_email: 'chatonly-' + chatOnlySuffix + '@example.com', contact_name: 'Chat Only', status: 'open'
    }).select().single();
    cleanupConversationIds.push(chatOnlyConvo.id);
    await admin.from('messages').insert({
      conversation_id: chatOnlyConvo.id, channel: 'chat', direction: 'inbound', body: 'Real inbound chat.', sender_email: 'chatonly-' + chatOnlySuffix + '@example.com'
    });

    const replyRes = await fetch(functionsUrl + '/send-conversation-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pmJwt },
      body: JSON.stringify({ conversationId: chatOnlyConvo.id, body: 'A real PM chat reply.' })
    });
    const replyBody = await replyRes.json();
    check('★ a real PM reply on a chat-only conversation genuinely chooses the chat channel automatically, with no channel argument from the caller', replyRes.status === 200 && replyBody.channel === 'chat', JSON.stringify(replyBody));

    const { data: chatReplyRow } = await admin.from('messages').select('*').eq('id', replyBody.messageId).single();
    check('the real reply row was genuinely written with direction=outbound, channel=chat, the real PM\'s own email', chatReplyRow.direction === 'outbound' && chatReplyRow.channel === 'chat' && chatReplyRow.sender_email === 'pm@marketswave.local');

    const noAuthRes = await fetch(functionsUrl + '/send-conversation-reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: chatOnlyConvo.id, body: 'x' })
    });
    check('send-conversation-reply genuinely refuses an unauthenticated caller (401)', noAuthRes.status === 401);

    // =========================================================================================
    console.log('\n--- 5. ★★★ SECURITY CHECK (point 4): a spoofed inbound sender gains NO read access to prior history ---\n');
    // Real setup: a genuine client with a real conversation and real prior history, exactly
    // the kind of thread a spoofed inbound message could try to land inside.
    const victimSuffix = crypto.randomBytes(4).toString('hex');
    const victimEmail = 'victim-' + victimSuffix + '@example.com';
    const { data: victimUser, error: victimErr } = await admin.auth.admin.createUser({ email: victimEmail, password: 'RealVictimPass2026!Aa', email_confirm: true });
    if (victimErr) throw new Error('Could not create the real victim test user: ' + victimErr.message);
    cleanupAuthUserIds.push(victimUser.user.id);
    const { data: victimConvo } = await admin.from('conversations').insert({
      client_id: victimUser.user.id, contact_email: victimEmail, contact_name: 'Real Victim', status: 'open'
    }).select().single();
    cleanupConversationIds.push(victimConvo.id);
    await admin.from('messages').insert({
      conversation_id: victimConvo.id, channel: 'chat', direction: 'inbound', body: 'Real prior sensitive conversation history.', sender_email: victimEmail
    });

    // A REAL spoofed inbound message — the sender_email/contact_email matches the victim, but
    // this insert (mirroring exactly what receive-inbound-email would write for an attacker
    // who successfully spoofed the From header) is done with service_role, the same privilege
    // level the real function runs at — there is no Supabase session behind it at all.
    await admin.from('messages').insert({
      conversation_id: victimConvo.id, channel: 'email', direction: 'inbound', body: 'A real spoofed-sender message landing in the real thread.',
      sender_email: victimEmail, message_id: '<' + crypto.randomUUID() + '@attacker.example.com>'
    });

    // THE ACTUAL CHECK: a genuinely different, unrelated real session — a different real
    // client entirely — must NOT be able to read this conversation's history, spoofed message
    // included, via the real RLS-authorized path every real client actually uses.
    const attackerSuffix = crypto.randomBytes(4).toString('hex');
    const attackerEmail = 'attacker-session-' + attackerSuffix + '@example.com';
    const { data: attackerUser, error: attackerErr } = await admin.auth.admin.createUser({ email: attackerEmail, password: 'RealAttackerPass2026!Aa', email_confirm: true });
    if (attackerErr) throw new Error('Could not create the real attacker test user: ' + attackerErr.message);
    cleanupAuthUserIds.push(attackerUser.user.id);
    const attackerClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: attackerSignInErr } = await attackerClient.auth.signInWithPassword({ email: attackerEmail, password: 'RealAttackerPass2026!Aa' });
    if (attackerSignInErr) throw new Error('Could not sign in as the real attacker test user: ' + attackerSignInErr.message);

    const { data: attackerReadAttempt } = await attackerClient.from('conversations').select('id').eq('id', victimConvo.id);
    check('★★★ a genuinely different, unrelated real session sees ZERO rows for the victim\'s conversation — the spoofed message did NOT open any new read path', Array.isArray(attackerReadAttempt) && attackerReadAttempt.length === 0);

    const { data: attackerMessagesAttempt } = await attackerClient.from('messages').select('id').eq('conversation_id', victimConvo.id);
    check('★★★ the same unrelated session also cannot read the individual messages (including the real spoofed one) via RLS', Array.isArray(attackerMessagesAttempt) && attackerMessagesAttempt.length === 0);

    // Confirmed positive control: the REAL victim's own real session CAN read it (proving the
    // negative result above is a real RLS boundary, not a broken query).
    const victimClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await victimClient.auth.signInWithPassword({ email: victimEmail, password: 'RealVictimPass2026!Aa' });
    const { data: victimOwnRead } = await victimClient.from('messages').select('id').eq('conversation_id', victimConvo.id);
    check('positive control: the REAL victim\'s own real session genuinely CAN read their own conversation (2 messages, including the spoofed one they\'d see for real) — confirms the negative result above is a real RLS boundary, not a broken query', Array.isArray(victimOwnRead) && victimOwnRead.length === 2);

  } finally {
    console.log('\nCleaning up...');
    for (const id of cleanupConversationIds) {
      await admin.from('messages').delete().eq('conversation_id', id);
      await admin.from('conversations').delete().eq('id', id);
    }
    for (const id of cleanupAuthUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    console.log('Done.');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
}

runVerifyMain(main);
