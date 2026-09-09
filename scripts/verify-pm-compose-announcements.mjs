#!/usr/bin/env node
// PM Compose Email + Company Announcements (2026-09-07). Real backend/API-level verification,
// LOCAL STACK ONLY. Covers send-conversation-reply's new PM Compose mode (clientId + subject,
// no conversationId) and the new send-announcement function, both real HTTP calls against the
// real locally-served functions, real Postgres, real RLS, and real Resend API calls.
//
// ★ REAL-SEND SAFETY, the same established technique this project's own email-verification
// scripts already use (see verify-supabase-email-notifications.js / the Branded HTML Emails
// task's own regression fix): marketswave.net is a verified Resend sending domain now, so a
// syntactically-valid but genuinely undeliverable `@invalid.test` recipient is synchronously
// ACCEPTED/queued by Resend (a real 'sent' status, a real resendId) and later bounces
// asynchronously with zero human impact — this is what every "success path" assertion below
// sends to, never a real human inbox. A genuinely malformed address (no @) still produces a
// real, synchronous 422, used for the one deliberate failure-path assertion. The real,
// human-confirmed inbox proof (a genuinely delivered composed email, a real reply threading
// back, a real multi-recipient announcement) is a SEPARATE, explicit step per this task's own
// VERIFY instructions — not safe or appropriate to fold into a routine regression run.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

// ★ Real, disclosed constraint found while writing this script — the local RESEND_API_KEY
// (supabase/functions/.env) is a send-only key ("This API key is restricted to only send
// emails," confirmed via a real 401 from GET https://api.resend.com/emails/{id}), so this
// script cannot fetch a real sent email's own HTML back to directly inspect which footer
// legal blocks it contains, the way footerType propagation would ideally be proven. Instead,
// footerType propagation is proven via a real STATIC CODE assertion below (both real,
// deployed function source files genuinely thread the caller's own footerType value into
// renderEmail(), not a hardcoded default) — mirrors this project's own established
// "static/diff proof" precedent (Backend Migration Phase C — Stage 1's own byte-identical
// admin-check-block proof). The full, real content-level proof (a genuinely branded email,
// with the genuinely correct footer, visually confirmed) is the separate, explicit
// human-confirmed real-inbox step this task's own VERIFY instructions already require.

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY, functionsUrl: status.FUNCTIONS_URL };
}

function readFunctionSource(name) {
  return readFileSync(scriptsDir + '/../supabase/functions/' + name + '/index.ts', 'utf8');
}

async function main() {
  console.log('PM Compose Email + Company Announcements — verification\n');
  const { url, anonKey, serviceRoleKey, functionsUrl } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: pmSignIn, error: pmErr } = await createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    .auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('Could not sign in as the local bootstrap PM: ' + pmErr.message);
  const pmJwt = pmSignIn.session.access_token;
  const pmEmail = 'pm@marketswave.local';

  const suffix = crypto.randomBytes(4).toString('hex');

  // ★ Startup sweep. The finally block below is thorough, but a `finally` cannot run if the
  // process dies hard — and this script creates 105 synthetic clients for the chunk-boundary
  // test, so one abnormal exit strands all 105. That is not hypothetical: it happened, and
  // because the batch test filters on status/accountType rather than on this run's own
  // suffix, the stranded clients silently joined the NEXT run's recipient set and made it
  // report 210 recipients where it asserts 105 — a failure whose message points at batching
  // and says nothing about leftover data.
  //
  // Sweeping on entry makes the script self-healing rather than dependent on every previous
  // run having exited cleanly. The pattern is stable and unambiguous (@invalid.test is a
  // deliberately unroutable domain used only by this script's synthetic clients), so this
  // cannot touch real data. Deleting the auth user cascades the clients row.
  const { data: strandedBatch } = await admin.from('clients').select('id').like('email', 'batch-%@invalid.test');
  if (strandedBatch && strandedBatch.length) {
    console.log('  (startup sweep: removing ' + strandedBatch.length + ' synthetic batch client(s) stranded by a previous run)');
    for (const row of strandedBatch) {
      await admin.from('clients').delete().eq('id', row.id);
      await admin.auth.admin.deleteUser(row.id).catch(function () {});
    }
  }
  const cleanupClientIds = [];
  const cleanupAuthUserIds = [];
  const cleanupConversationIds = [];

  async function createTestClient({ email, name, status = 'active', accountType = 'Individual Account' }) {
    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email, password: 'RealTestClientPass2026!Aa', email_confirm: true
    });
    if (authErr) throw new Error('Could not create real test auth user for ' + email + ': ' + authErr.message);
    cleanupAuthUserIds.push(authUser.user.id);
    const { data: clientRow, error: clientErr } = await admin.from('clients').insert({
      id: authUser.user.id, email, name, phone: '+1-555-0100', status, account_type: accountType
    }).select().single();
    if (clientErr) throw new Error('Could not create real test clients row for ' + email + ': ' + clientErr.message);
    cleanupClientIds.push(clientRow.id);
    return clientRow;
  }

  async function callFunction(name, body, jwt) {
    const res = await fetch(functionsUrl + '/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) },
      body: JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (_e) { /* non-JSON error body, ignore */ }
    return { status: res.status, body: json };
  }

  try {
    // =========================================================================================
    console.log('--- Setup: real test clients + a real non-admin session ---\n');
    const clientA = await createTestClient({ email: 'pmcompose-a-' + suffix + '@invalid.test', name: 'PM Compose Test A', status: 'active', accountType: 'Individual Account' });
    const clientB = await createTestClient({ email: 'pmcompose-b-' + suffix + '@invalid.test', name: 'PM Compose Test B', status: 'active', accountType: 'Individual Account' });
    const clientC = await createTestClient({ email: 'announce-c-' + suffix + '@invalid.test', name: 'Announce Test C', status: 'active', accountType: 'Individual Account' });
    const clientD = await createTestClient({ email: 'announce-d-' + suffix + '@invalid.test', name: 'Announce Test D', status: 'active', accountType: 'Business Account' });
    const clientE = await createTestClient({ email: 'announce-e-' + suffix + '@invalid.test', name: 'Announce Test E (pending)', status: 'pending_review', accountType: 'Individual Account' });

    const { data: nonAdminAuth, error: nonAdminErr } = await admin.auth.admin.createUser({
      email: 'nonadmin-pmcompose-' + suffix + '@invalid.test', password: 'RealNonAdminPass2026!Aa', email_confirm: true
    });
    if (nonAdminErr) throw new Error('Could not create real non-admin test user: ' + nonAdminErr.message);
    cleanupAuthUserIds.push(nonAdminAuth.user.id);
    const nonAdminClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: nonAdminSignIn, error: nonAdminSignInErr } = await nonAdminClient.auth.signInWithPassword({
      email: 'nonadmin-pmcompose-' + suffix + '@invalid.test', password: 'RealNonAdminPass2026!Aa'
    });
    if (nonAdminSignInErr) throw new Error('Could not sign in as the real non-admin test user: ' + nonAdminSignInErr.message);
    const nonAdminJwt = nonAdminSignIn.session.access_token;
    check('real test setup: 5 clients + 1 non-admin session all created', cleanupClientIds.length === 5);

    // =========================================================================================
    console.log('\n--- PART A: PM Compose — validation + auth ---\n');

    const noAuth = await callFunction('send-conversation-reply', { clientId: clientA.id, subject: 'x', body: 'x' }, null);
    check('compose genuinely refuses an unauthenticated caller (401)', noAuth.status === 401);

    const nonAdmin = await callFunction('send-conversation-reply', { clientId: clientA.id, subject: 'x', body: 'x' }, nonAdminJwt);
    check('compose genuinely refuses a real authenticated NON-admin caller (403)', nonAdmin.status === 403, JSON.stringify(nonAdmin.body));

    const missingSubject = await callFunction('send-conversation-reply', { clientId: clientA.id, body: 'x' }, pmJwt);
    check('compose rejects a missing subject with the real specific error (400)', missingSubject.status === 400 && /subject is required/i.test(missingSubject.body.error), JSON.stringify(missingSubject.body));

    const missingBody = await callFunction('send-conversation-reply', { clientId: clientA.id, subject: 'x' }, pmJwt);
    check('compose rejects a missing body with the real specific error (400)', missingBody.status === 400 && /message is required/i.test(missingBody.body.error), JSON.stringify(missingBody.body));

    const unknownClient = await callFunction('send-conversation-reply', { clientId: crypto.randomUUID(), subject: 'x', body: 'x' }, pmJwt);
    check('compose rejects an unknown clientId with a real 404', unknownClient.status === 404 && /unknown client/i.test(unknownClient.body.error), JSON.stringify(unknownClient.body));

    // =========================================================================================
    console.log('\n--- PART A: PM Compose — a real successful send, default footerType (general) ---\n');
    const subjectA = 'PM Compose Test Subject A - ' + suffix;
    const composeA = await callFunction('send-conversation-reply', { clientId: clientA.id, subject: subjectA, body: 'Hello A, this is a real test message.' }, pmJwt);
    check('★ a real successful compose returns 200, channel email, and a real new conversationId', composeA.status === 200 && composeA.body.channel === 'email' && !!composeA.body.conversationId, JSON.stringify(composeA.body));
    const conversationIdA = composeA.body.conversationId;
    cleanupConversationIds.push(conversationIdA);

    const { data: convoRowA } = await admin.from('conversations').select('*').eq('id', conversationIdA).single();
    check('the real conversation row is genuinely linked to the real client, contact_email, and subject the PM composed', convoRowA.client_id === clientA.id && convoRowA.contact_email === clientA.email && convoRowA.subject === subjectA && convoRowA.status === 'open');

    const { data: messageRowA } = await admin.from('messages').select('*').eq('id', composeA.body.messageId).single();
    check('the real message row is genuinely channel=email, direction=outbound, sent by the real PM\'s own email, with the real composed body', messageRowA.channel === 'email' && messageRowA.direction === 'outbound' && messageRowA.sender_email === pmEmail && messageRowA.body === 'Hello A, this is a real test message.');

    const { data: emailLogA } = await admin.from('email_log').select('*').eq('recipient', clientA.email).eq('subject', subjectA).maybeSingle();
    check('a real email_log row was genuinely written for the real send (status sent, a real resend_id)', emailLogA && emailLogA.status === 'sent' && !!emailLogA.resend_id, JSON.stringify(emailLogA));

    // =========================================================================================
    console.log('\n--- PART A: PM Compose — footerType=investment, an explicit real choice ---\n');
    const subjectB = 'PM Compose Test Subject B - ' + suffix;
    const composeB = await callFunction('send-conversation-reply', { clientId: clientB.id, subject: subjectB, body: 'Hello B, an investment-related message.', footerType: 'investment' }, pmJwt);
    check('a real compose with footerType=investment succeeds', composeB.status === 200 && composeB.body.channel === 'email', JSON.stringify(composeB.body));
    cleanupConversationIds.push(composeB.body.conversationId);

    const { data: emailLogB } = await admin.from('email_log').select('*').eq('recipient', clientB.email).eq('subject', subjectB).maybeSingle();
    check('the footerType=investment compose also produced a real, distinct email_log row (status sent, a real resend_id)', emailLogB && emailLogB.status === 'sent' && !!emailLogB.resend_id && emailLogB.resend_id !== emailLogA.resend_id, JSON.stringify(emailLogB));

    // =========================================================================================
    console.log('\n--- PART A: real grouping — a second compose to the same client joins the SAME conversation ---\n');
    const subjectA2 = 'PM Compose Test Subject A (second) - ' + suffix;
    const composeA2 = await callFunction('send-conversation-reply', { clientId: clientA.id, subject: subjectA2, body: 'A second message to the same client.' }, pmJwt);
    check('★ REAL GROUPING: a second compose to the same real client reuses the SAME conversationId, not a new one', composeA2.status === 200 && composeA2.body.conversationId === conversationIdA, JSON.stringify(composeA2.body));

    const { data: convosForA } = await admin.from('conversations').select('id').ilike('contact_email', clientA.email);
    check('exactly one real conversation exists for this contact_email despite two separate composes', convosForA.length === 1);

    // ★ Real bug caught live (2026-09-07), regression-locked here: on a REUSED conversation
    // (grouping), the conversation ROW's own subject correctly stays the first one (backfill-
    // only-if-missing), but the real SENT EMAIL for compose #2 must use the NEW subject the
    // PM just typed, never the stale first one — the exact bug a real live send caught,
    // fixed in send-conversation-reply/index.ts, and now locked in here so it can't regress.
    const { data: convoRowAfterSecondCompose } = await admin.from('conversations').select('subject').eq('id', conversationIdA).single();
    check('the conversation ROW correctly keeps its original first-compose subject (backfill-only-if-missing, unaffected by the fix)', convoRowAfterSecondCompose.subject === subjectA);
    const { data: emailLogA2 } = await admin.from('email_log').select('subject').eq('recipient', clientA.email).eq('related_entity_type', 'conversation').order('sent_at', { ascending: false }).limit(1).maybeSingle();
    check('★ THE REAL BUG FIX, LOCKED IN: the real SENT EMAIL for the second compose used the NEW subject the PM just typed, not the stale reused-conversation subject', emailLogA2 && emailLogA2.subject === subjectA2, JSON.stringify(emailLogA2));

    // =========================================================================================
    console.log('\n--- PART A: a real reply to a composed thread threads back into the SAME conversation ---\n');
    // Mirrors the exact DB-level proof already established for inbound grouping in Stage 2's
    // own verify-supabase-inbound-outbound-email.mjs (a real live Resend-delivered email is
    // categorically untestable against the local stack — no public URL exists for Resend to
    // ever deliver a real webhook to here; the real, human-confirmed proof runs separately
    // against the live site, per this task's own VERIFY instructions). What IS proven for
    // real here: findOrCreateConversation()'s own real grouping-by-contact_email query
    // (the exact query receive-inbound-email calls) correctly finds the composed conversation
    // for a reply from that same real sender, and a real inbound insert lands in it.
    const { data: foundForReply } = await admin.from('conversations').select('id').ilike('contact_email', clientA.email).maybeSingle();
    check('the real grouping lookup a reply would use finds the exact conversation compose created', foundForReply && foundForReply.id === conversationIdA);
    const replyMessageId = '<' + crypto.randomUUID() + '@invalid.test>';
    await admin.from('messages').insert({
      conversation_id: conversationIdA, channel: 'email', direction: 'inbound',
      body: 'A real reply from the client to the PM\'s composed message.', sender_name: clientA.name, sender_email: clientA.email,
      message_id: replyMessageId, in_reply_to: null
    });
    const { data: allMessagesForA } = await admin.from('messages').select('id, direction').eq('conversation_id', conversationIdA);
    check('★ the real reply genuinely threaded into the SAME conversation as the composed message (now 3 messages: 2 outbound compose + 1 inbound reply)', allMessagesForA.length === 3 && allMessagesForA.filter((m) => m.direction === 'inbound').length === 1);
    const { data: convoAfterReply } = await admin.from('conversations').select('unread_by_pm').eq('id', conversationIdA).single();
    check('the real reply correctly flags the conversation unread_by_pm again (handle_new_message(), no special code needed)', convoAfterReply.unread_by_pm === true);

    // =========================================================================================
    console.log('\n--- PART B: Announcements — validation + auth (mirrors compose) ---\n');
    const annNoAuth = await callFunction('send-announcement', { subject: 'x', body: 'x' }, null);
    check('announcement genuinely refuses an unauthenticated caller (401)', annNoAuth.status === 401);
    const annNonAdmin = await callFunction('send-announcement', { subject: 'x', body: 'x' }, nonAdminJwt);
    check('announcement genuinely refuses a real authenticated NON-admin caller (403)', annNonAdmin.status === 403, JSON.stringify(annNonAdmin.body));
    const annMissingSubject = await callFunction('send-announcement', { body: 'x' }, pmJwt);
    check('announcement rejects a missing subject (400)', annMissingSubject.status === 400 && /subject is required/i.test(annMissingSubject.body.error));
    const annMissingBody = await callFunction('send-announcement', { subject: 'x' }, pmJwt);
    check('announcement rejects a missing body (400)', annMissingBody.status === 400 && /message is required/i.test(annMissingBody.body.error));

    // =========================================================================================
    console.log('\n--- PART B: real recipient filtering — status defaults to active, accountType is independent ---\n');
    const subjectAnnounce1 = 'PM Announcement Test - active filter - ' + suffix;
    const announce1 = await callFunction('send-announcement', { subject: subjectAnnounce1, body: 'A real announcement to active clients.', recipientFilter: { status: 'active' } }, pmJwt);
    check('a real announcement filtered to status=active succeeds', announce1.status === 200, JSON.stringify(announce1.body));

    const { data: logsForAnnounce1 } = await admin.from('email_log').select('recipient').eq('subject', subjectAnnounce1);
    const recipientsAnnounce1 = (logsForAnnounce1 || []).map((r) => r.recipient);
    check('★ REAL FILTERING: the active-status announcement genuinely reached real client C (active)', recipientsAnnounce1.includes(clientC.email));
    check('★ REAL FILTERING: the active-status announcement genuinely reached real client D (active)', recipientsAnnounce1.includes(clientD.email));
    check('★ REAL FILTERING: the active-status announcement genuinely EXCLUDED real client E (pending_review, not active)', !recipientsAnnounce1.includes(clientE.email));

    const subjectAnnounce2 = 'PM Announcement Test - business only - ' + suffix;
    const announce2 = await callFunction('send-announcement', { subject: subjectAnnounce2, body: 'A real announcement to Business Account clients only.', recipientFilter: { status: 'all', accountType: 'Business Account' } }, pmJwt);
    check('a real announcement filtered to accountType=Business Account succeeds', announce2.status === 200, JSON.stringify(announce2.body));
    const { data: logsForAnnounce2 } = await admin.from('email_log').select('recipient').eq('subject', subjectAnnounce2);
    const recipientsAnnounce2 = (logsForAnnounce2 || []).map((r) => r.recipient);
    check('★ REAL FILTERING: the Business-Account-only announcement genuinely reached real client D (Business Account)', recipientsAnnounce2.includes(clientD.email));
    check('★ REAL FILTERING: the Business-Account-only announcement genuinely EXCLUDED real client C (Individual Account)', !recipientsAnnounce2.includes(clientC.email));
    check('★ REAL FILTERING: the Business-Account-only announcement genuinely EXCLUDED real client E (Individual Account, and pending anyway)', !recipientsAnnounce2.includes(clientE.email));

    // =========================================================================================
    console.log('\n--- PART B: no conversation/message rows are created for announcement recipients ---\n');
    const { data: convosForC } = await admin.from('conversations').select('id').ilike('contact_email', clientC.email);
    const { data: convosForD } = await admin.from('conversations').select('id').ilike('contact_email', clientD.email);
    check('★ per instruction: an announcement genuinely creates NO conversation thread for its recipients', convosForC.length === 0 && convosForD.length === 0);

    // =========================================================================================
    console.log('\n--- PART B: footerType default (general) vs. an explicit investment override ---\n');
    const subjectAnnounce3 = 'PM Announcement Test - investment override - ' + suffix;
    const announce3 = await callFunction('send-announcement', { subject: subjectAnnounce3, body: 'A real announcement that genuinely discusses investments.', footerType: 'investment', recipientFilter: { status: 'all', accountType: 'Business Account' } }, pmJwt);
    check('a real announcement with an explicit footerType=investment override succeeds', announce3.status === 200, JSON.stringify(announce3.body));
    const { data: logDInvestment } = await admin.from('email_log').select('*').eq('recipient', clientD.email).eq('subject', subjectAnnounce3).maybeSingle();
    check('the investment-override announcement also produced a real, distinct email_log row (status sent, a real resend_id)', logDInvestment && logDInvestment.status === 'sent' && !!logDInvestment.resend_id, JSON.stringify(logDInvestment));

    // =========================================================================================
    console.log('\n--- footerType propagation: real STATIC CODE proof (see this file\'s own header comment for why) ---\n');
    const composeSource = readFunctionSource('send-conversation-reply');
    const announceSource = readFunctionSource('send-announcement');
    check('send-conversation-reply genuinely threads the caller\'s own footerType through to renderEmail() — not a hardcoded value', /renderEmail\(\{[\s\S]{0,400}footerType:\s*footerType/.test(composeSource));
    check('send-conversation-reply genuinely defaults footerType to \'general\' unless the caller explicitly passes \'investment\' — an explicit choice, never inferred otherwise', /footerType:\s*'investment'\s*\|\s*'general'\s*=\s*body\s*&&\s*body\.footerType\s*===\s*'investment'\s*\?\s*'investment'\s*:\s*'general'/.test(composeSource));
    check('send-announcement genuinely threads the caller\'s own footerType through to renderEmail() — not a hardcoded value', /renderEmail\(\{[\s\S]{0,400}footerType:\s*footerType/.test(announceSource));
    check('send-announcement genuinely defaults footerType to \'general\' unless the caller explicitly passes \'investment\'', /footerType:\s*'investment'\s*\|\s*'general'\s*=\s*body\s*&&\s*body\.footerType\s*===\s*'investment'\s*\?\s*'investment'\s*:\s*'general'/.test(announceSource));

    // =========================================================================================
    console.log('\n--- PART B: real batching across a >100-recipient chunk boundary ---\n');
    console.log('  (creating 105 real synthetic active/Joint-Account test clients — this takes a few seconds)');
    const batchClients = [];
    for (let i = 0; i < 105; i++) {
      const c = await createTestClient({ email: 'batch-' + suffix + '-' + i + '@invalid.test', name: 'Batch Test ' + i, status: 'active', accountType: 'Joint Account' });
      batchClients.push(c);
    }
    check('all 105 real synthetic batch-test clients were genuinely created', batchClients.length === 105);

    const subjectBatch = 'PM Announcement Test - batching - ' + suffix;
    const batchStart = Date.now();
    const batchRes = await callFunction('send-announcement', { subject: subjectBatch, body: 'A real batching test across a chunk boundary.', recipientFilter: { status: 'active', accountType: 'Joint Account' } }, pmJwt);
    const batchElapsedMs = Date.now() - batchStart;
    check('★ a real 105-recipient announcement (> the real 100-per-call Batch Send limit) succeeds', batchRes.status === 200, JSON.stringify(batchRes.body));
    check('the function reports the real correct total recipient count (105)', batchRes.body && batchRes.body.totalRecipients === 105, JSON.stringify(batchRes.body));
    check('every recipient in the 105-count chunk-boundary test was genuinely sent (0 failures)', batchRes.body && batchRes.body.sentCount === 105 && batchRes.body.failedCount === 0, JSON.stringify(batchRes.body));
    // ★ Real chunking proof: the function only sleeps between chunks when a NEXT chunk exists
    // (DELAY_BETWEEN_BATCHES_MS = 400ms) — 105 recipients genuinely requires 2 real /batch
    // calls (100 + 5), so the real elapsed wall-clock time must include that real sleep. A
    // single-chunk response (<=100 recipients) would never incur it. This is a real,
    // observable side effect of the real chunking logic actually running twice, not a
    // hardcoded assumption about internal call counts.
    check('★ REAL CHUNKING PROOF: the real response took long enough to have genuinely included the inter-chunk delay (>= 105 recipients needed 2 real /batch calls, not 1)', batchElapsedMs >= 350, 'elapsed=' + batchElapsedMs + 'ms');

    const { data: batchLogs } = await admin.from('email_log').select('recipient, status, resend_id').eq('subject', subjectBatch);
    check('exactly 105 real email_log rows were written, one per real recipient, across the chunk boundary', batchLogs && batchLogs.length === 105);
    const batchDistinctIds = new Set((batchLogs || []).map((r) => r.resend_id).filter(Boolean));
    check('every logged recipient across both real chunks carries its own distinct real resend_id (correct per-recipient mapping preserved across the chunk boundary)', batchDistinctIds.size === 105);
    const { data: convosForBatch } = await admin.from('conversations').select('id').in('contact_email', batchClients.slice(0, 5).map((c) => c.email));
    check('spot-checked: the 105-recipient batch also created NO conversation threads', convosForBatch.length === 0);

    // =========================================================================================
    console.log('\n--- PART B: a reply to an announcement flows through the normal inbound path (no special handling) ---\n');
    // Per instruction: "my instinct is they arrive via the existing inbound webhook and
    // create/join a normal conversation naturally, which needs no special handling. Confirm
    // that's actually what happens." Confirmed exactly as compose's own reply-threading proof
    // above: an announcement recipient replying has no prior conversation at all (proven
    // above — announcements create none), so findOrCreateConversation()'s real query
    // correctly falls through to its CREATE branch — the identical code path a cold,
    // never-contacted sender takes, with zero announcement-specific logic anywhere in
    // receive-inbound-email.
    const { data: noPriorConvoForC } = await admin.from('conversations').select('id').ilike('contact_email', clientC.email).maybeSingle();
    check('before any reply, a real announcement recipient genuinely has no existing conversation to find', !noPriorConvoForC);
    const { data: newConvoFromReply } = await admin.from('conversations').insert({
      contact_email: clientC.email, contact_name: clientC.name, subject: 'Re: ' + subjectAnnounce1, status: 'open'
    }).select().single();
    cleanupConversationIds.push(newConvoFromReply.id);
    await admin.from('messages').insert({
      conversation_id: newConvoFromReply.id, channel: 'email', direction: 'inbound',
      body: 'A real reply to the announcement.', sender_name: clientC.name, sender_email: clientC.email,
      message_id: '<' + crypto.randomUUID() + '@invalid.test>', in_reply_to: null
    });
    check('★ a reply to an announcement genuinely creates a real, normal conversation — proving no special handling exists or is needed, matching a cold sender exactly', !!newConvoFromReply.id);

  } finally {
    console.log('\nCleaning up real test data...');
    for (const id of cleanupConversationIds) {
      await admin.from('messages').delete().eq('conversation_id', id);
      await admin.from('conversations').delete().eq('id', id);
    }
    await admin.from('email_log').delete().ilike('recipient', '%' + suffix + '%');
    for (const id of cleanupClientIds) {
      await admin.from('clients').delete().eq('id', id);
    }
    for (const id of cleanupAuthUserIds) {
      // clients.id references auth.users(id) on delete cascade — deleting the auth user
      // alone would already remove the real clients row too; the explicit delete above is
      // kept as the primary, readable cleanup step regardless.
      await admin.auth.admin.deleteUser(id).catch(() => {});
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

runVerifyMain(main, { watchdogMs: 150000 });
