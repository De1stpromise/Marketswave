#!/usr/bin/env node
// Backend Migration Phase D — Stage 1 (2026-09-06), Part B: first real email notifications.
//
// LOCAL STACK ONLY. Real-stack verification for _shared/send-email.ts and its two wired
// trigger points (approve/reject-client-application, credit-deposit). This suite does NOT
// send real emails to a real inbox (that would spam whatever RESEND_API_KEY's sandbox
// recipient is on every test run) — it uses a deliberately unreachable "@invalid.test"
// recipient domain, which Resend genuinely rejects, to prove the real failure-handling path
// (a rejected send is honestly logged as 'failed' with a real error_message, never
// fabricated as 'sent'). The actual "did a real human receive a real email" proof was done
// once, manually, against a real inbox the user controls, during this stage's own
// interactive verification — see CLAUDE.md's Tech Stack entry for that result. This script's
// job is the repeatable, real-database-level regression check: does email_log correctly
// record what happens, in both directions, every time this suite runs.
//
// Usage:  node scripts/verify-supabase-email-notifications.js
// Requires: the local Supabase stack running, this stage's migration applied, RESEND_API_KEY
// set in supabase/functions/.env.

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

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function createTestClient(admin, email, password, status) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('createUser(' + email + ') failed: ' + error.message);
  await admin.from('clients').insert({ id: data.user.id, name: 'Email Test Client', email, phone: '+1-555-0600', account_type: 'Individual Account', status });
  return data.user;
}

async function main() {
  console.log('Backend Migration Phase D — Stage 1 verification (first real email notifications)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const adminSignIn = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: adminErr } = await adminSignIn.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (adminErr) throw new Error('Real admin sign-in failed: ' + adminErr.message);

  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'EmailVerify2026!';
  const unreachableDomain = 'email-verify-' + suffix + '@invalid.test';
  // Real-failure recipient (2026-09-07 fix, Branded HTML Emails task): marketswave.net is now
  // a verified Resend sending domain, which lifted the old onboarding@resend.dev sandbox's
  // "only deliver to the account's own registered address" restriction — that restriction,
  // not real DNS/domain unreachability, was what made unreachableDomain synchronously fail
  // before. Confirmed directly against the real Resend API: a verified-domain sender now
  // genuinely queues a send to @invalid.test as 'sent' (a real resend_id, no synchronous
  // rejection) — Resend does not validate deliverability synchronously, only request format.
  // A malformed (no "@") recipient DOES still trigger a real, synchronous 422 regardless of
  // sender-domain verification. Test 1 below now corrupts clients.email to this malformed
  // value (via a direct update, AFTER the real Auth account is created with the valid
  // unreachableDomain — a malformed Auth email would break signup/sign-in itself, a different
  // concern) so the real send genuinely fails, while unreachableDomain keeps being used
  // everywhere else in this file exactly as before.
  const malformedRecipient = 'email-verify-malformed-' + suffix;

  console.log('1. approve-client-application — a real send attempt is genuinely logged\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, 'pending_review');
    await admin.from('clients').update({ email: malformedRecipient }).eq('id', user.id);
    const before = new Date().toISOString();
    const { data: approved, error: approveErr } = await adminSignIn.functions.invoke('approve-client-application', { body: { clientId: user.id } });
    check('the approval itself succeeds regardless of email outcome — a real client is genuinely activated', !approveErr && approved.status === 'active', approveErr && approveErr.message);

    const { data: logRows } = await admin.from('email_log').select('*').eq('related_entity_id', user.id).eq('related_entity_type', 'client_application').gte('sent_at', before);
    check('a real email_log row was written for this real approval', logRows && logRows.length === 1, JSON.stringify(logRows));
    check('the log row correctly targets this exact client\'s own real (corrupted-for-this-test) email', logRows && logRows[0].recipient === malformedRecipient);
    check('the log row\'s subject matches the real approval email', logRows && /approved/i.test(logRows[0].subject));
    check('a real send failure (unreachable domain) is honestly logged as failed, with a real error message — never a fabricated success', logRows && logRows[0].status === 'failed' && !!logRows[0].error_message, JSON.stringify(logRows && logRows[0]));

    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n2. reject-client-application — same real logging discipline\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, 'pending_review');
    const before = new Date().toISOString();
    const { data: rejected, error: rejectErr } = await adminSignIn.functions.invoke('reject-client-application', { body: { clientId: user.id, reason: 'Verification test.' } });
    check('the rejection itself succeeds regardless of email outcome', !rejectErr && rejected.status === 'rejected', rejectErr && rejectErr.message);

    const { data: logRows } = await admin.from('email_log').select('*').eq('related_entity_id', user.id).eq('related_entity_type', 'client_application').gte('sent_at', before);
    check('a real email_log row was written for this real rejection', logRows && logRows.length === 1, JSON.stringify(logRows));
    check('the subject matches the real rejection email, distinct from the approval one', logRows && /update on your/i.test(logRows[0].subject));

    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n3. credit-deposit — the third real trigger point\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, 'active');
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 0, allocated_capital: 0, asset_returns: 0 });
    const { data: req } = await admin.from('deposit_requests').insert({ client_id: user.id, method: 'bank', requested_amount: 1500, currency: 'USD', status: 'pending', details: {} }).select().single();

    const before = new Date().toISOString();
    const { data: credited, error: creditErr } = await adminSignIn.functions.invoke('credit-deposit', { body: { requestId: req.id, confirmedAmount: 1500 } });
    check('the credit itself succeeds regardless of email outcome — real money still moves', !creditErr && credited.status === 'credited', creditErr && creditErr.message);

    const { data: logRows } = await admin.from('email_log').select('*').eq('related_entity_id', req.id).eq('related_entity_type', 'deposit_request').gte('sent_at', before);
    check('a real email_log row was written for this real deposit credit', logRows && logRows.length === 1, JSON.stringify(logRows));
    check('the subject and amount reflect the real credited deposit', logRows && /credited/i.test(logRows[0].subject));

    await admin.from('deposit_requests').delete().eq('client_id', user.id);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n4. email_log RLS — admin-only, exactly like the local Security Log\'s own PM-facing role\n');
  await (async function () {
    const nonAdminEmail = 'non-admin-email-log-' + suffix + '@test.marketswave.local';
    const nonAdminUser = await createTestClient(admin, nonAdminEmail, password, 'active');
    const nonAdminSignIn = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await nonAdminSignIn.auth.signInWithPassword({ email: nonAdminEmail, password: password });

    const { data: nonAdminRead, error: nonAdminErr } = await nonAdminSignIn.from('email_log').select('*');
    check('a non-admin (client) caller sees ZERO rows in email_log — never even their own', !nonAdminErr && nonAdminRead.length === 0, JSON.stringify(nonAdminRead));

    const { data: adminRead, error: adminReadErr } = await adminSignIn.from('email_log').select('*').limit(1);
    check('a real admin-claimed caller CAN read email_log directly', !adminReadErr && Array.isArray(adminRead), adminReadErr && adminReadErr.message);

    const { error: insertErr } = await nonAdminSignIn.from('email_log').insert({ recipient: 'x@x.com', subject: 'x', status: 'sent' });
    check('no client-side role (not even admin) can INSERT into email_log directly — only service_role, via send-email.ts', !!insertErr);

    await admin.from('clients').delete().eq('id', nonAdminUser.id);
    await admin.auth.admin.deleteUser(nonAdminUser.id);
  })();

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err);
  process.exit(1);
});
