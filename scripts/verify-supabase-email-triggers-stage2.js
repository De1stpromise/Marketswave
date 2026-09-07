#!/usr/bin/env node
// Backend Migration Phase D — Stage 2 (2026-09-06).
//
// Real-stack verification for the 15 remaining real email trigger points wired this stage
// (the 13 high-value candidates named in Stage 1's own report, plus the 2 lower-urgency ones,
// update-support-ticket/publish-document). LOCAL STACK ONLY.
//
// Same discipline as Stage 1's own verify-supabase-email-notifications.js: uses a
// deliberately unreachable "@invalid.test" recipient domain, which Resend genuinely rejects,
// to prove the real failure-logging path (correct recipient/subject/relatedEntity, honestly
// logged 'failed') without spamming a real inbox on every regression run. The actual "did a
// real human receive a real email" proof for a representative sample across every domain was
// done once, manually, against a real inbox the user controls, during this stage's own
// interactive verification — see CLAUDE.md's Tech Stack entry for that result.
//
// Usage:  node scripts/verify-supabase-email-triggers-stage2.js
// Requires: the local Supabase stack running, RESEND_API_KEY set in
// supabase/functions/.env, and a fresh `supabase start` so all 15 edited function
// directories are picked up by the local edge-runtime.

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

async function createTestClient(admin, email, password, opts) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('createUser(' + email + ') failed: ' + error.message);
  await admin.from('clients').insert(Object.assign({
    id: data.user.id, name: 'Stage 2 Email Test Client', email, phone: '+1-555-0900',
    account_type: 'Individual Account', status: 'active'
  }, opts || {}));
  return data.user;
}

async function main() {
  console.log('Backend Migration Phase D — Stage 2 verification (15 new real email triggers)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pm = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: pmErr } = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('PM sign-in failed: ' + pmErr.message);

  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'Stage2EmailVerify2026!';
  const unreachableDomain = 'stage2-email-verify-' + suffix + '@invalid.test';
  // Real-failure recipient (2026-09-07 fix, Branded HTML Emails task): marketswave.net is now
  // a verified Resend sending domain, which lifted the old onboarding@resend.dev sandbox's
  // "only deliver to the account's own registered address" restriction — that restriction,
  // not real DNS/domain unreachability, was what made unreachableDomain synchronously fail
  // before. Confirmed directly against the real Resend API: a verified-domain sender now
  // genuinely queues a send to @invalid.test as 'sent' (a real resend_id, no synchronous
  // rejection) — Resend does not validate deliverability synchronously, only request format.
  // A malformed (no "@") recipient DOES still trigger a real, synchronous 422 regardless of
  // sender-domain verification, so every createTestClient() call below now overrides
  // clients.email to this value via its own opts param, decoupled from unreachableDomain
  // (which stays the real, valid-format email used for Auth signup — a malformed address
  // there would break signup itself, a different concern).
  const malformedRecipient = 'stage2-email-verify-malformed-' + suffix;

  async function checkLogged(label, relatedEntityType, relatedEntityId, subjectPattern, since) {
    const { data: logRows } = await admin.from('email_log').select('*').eq('related_entity_type', relatedEntityType).eq('related_entity_id', relatedEntityId).gte('sent_at', since);
    check(label + ' — a real email_log row was written', logRows && logRows.length === 1, JSON.stringify(logRows));
    if (logRows && logRows.length === 1) {
      check(label + ' — recipient is genuinely this client\'s own email', logRows[0].recipient === malformedRecipient);
      check(label + ' — subject matches the expected real content', subjectPattern.test(logRows[0].subject), logRows[0].subject);
      check(label + ' — a real send failure (unreachable domain) is honestly logged as failed', logRows[0].status === 'failed' && !!logRows[0].error_message);
    }
  }

  // ===========================================================================================
  // 1. reject-deposit
  // ===========================================================================================
  console.log('1. reject-deposit\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: req } = await admin.from('deposit_requests').insert({ client_id: user.id, method: 'bank', requested_amount: 2000, currency: 'USD', status: 'pending', details: {} }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('reject-deposit', { body: { requestId: req.id, reason: 'Unable to verify source of funds.' } });
    check('reject-deposit succeeds', !error && data.status === 'rejected', error && error.message);
    await checkLogged('reject-deposit', 'deposit_request', req.id, /update on your Marketswave deposit/i, before);
    await admin.from('deposit_requests').delete().eq('id', req.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // 2 & 3. approve-withdrawal / reject-withdrawal
  // ===========================================================================================
  console.log('\n2. approve-withdrawal\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
    const { data: req } = await admin.from('withdrawal_requests').insert({ client_id: user.id, method: 'bank', requested_amount: 1000, currency: 'USD', destination_details: {}, status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('approve-withdrawal', { body: { requestId: req.id, approvedAmount: 1000 } });
    check('approve-withdrawal succeeds', !error && data.status === 'approved', error && error.message);
    await checkLogged('approve-withdrawal', 'withdrawal_request', req.id, /withdrawal has been approved/i, before);
    await admin.from('withdrawal_requests').delete().eq('id', req.id);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n3. reject-withdrawal\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
    const { data: req } = await admin.from('withdrawal_requests').insert({ client_id: user.id, method: 'bank', requested_amount: 1000, currency: 'USD', destination_details: {}, status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('reject-withdrawal', { body: { requestId: req.id, reason: 'Destination account could not be verified.' } });
    check('reject-withdrawal succeeds', !error && data.status === 'rejected', error && error.message);
    await checkLogged('reject-withdrawal', 'withdrawal_request', req.id, /update on your Marketswave withdrawal/i, before);
    await admin.from('withdrawal_requests').delete().eq('id', req.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // 4 & 5. approve-allocation / reject-allocation
  // ===========================================================================================
  console.log('\n4. approve-allocation\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 });
    const { data: req } = await admin.from('allocation_requests').insert({ client_id: user.id, product_id: 'PROD-0003', requested_amount: 5000, status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('approve-allocation', { body: { requestId: req.id } });
    check('approve-allocation succeeds', !error && data.status === 'approved', error && error.message);
    await checkLogged('approve-allocation', 'allocation_request', req.id, /allocation request has been approved/i, before);
    await admin.from('holdings').delete().eq('client_id', user.id);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('allocation_requests').delete().eq('id', req.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n5. reject-allocation\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 });
    const { data: req } = await admin.from('allocation_requests').insert({ client_id: user.id, product_id: 'PROD-0003', requested_amount: 5000, status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('reject-allocation', { body: { requestId: req.id, reason: 'Product currently oversubscribed.' } });
    check('reject-allocation succeeds', !error && data.status === 'rejected', error && error.message);
    await checkLogged('reject-allocation', 'allocation_request', req.id, /update on your Marketswave allocation/i, before);
    await admin.from('allocation_requests').delete().eq('id', req.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // 6 & 7. approve-sell / reject-sell
  // ===========================================================================================
  console.log('\n6. approve-sell\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 0, allocated_capital: 0, asset_returns: 0 });
    await admin.from('holdings').insert({ client_id: user.id, product_id: 'PROD-0003', units: 20, cost_basis: 2000 });
    const { data: req } = await admin.from('sell_requests').insert({ client_id: user.id, product_id: 'PROD-0003', units_to_sell: 5, status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('approve-sell', { body: { requestId: req.id } });
    check('approve-sell succeeds', !error && data.status === 'approved', error && error.message);
    await checkLogged('approve-sell', 'sell_request', req.id, /sell request has been approved/i, before);
    await admin.from('holdings').delete().eq('client_id', user.id);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('sell_requests').delete().eq('id', req.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n7. reject-sell\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('holdings').insert({ client_id: user.id, product_id: 'PROD-0003', units: 20, cost_basis: 2000 });
    const { data: req } = await admin.from('sell_requests').insert({ client_id: user.id, product_id: 'PROD-0003', units_to_sell: 5, status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('reject-sell', { body: { requestId: req.id, reason: 'Please contact your advisor before selling this position.' } });
    check('reject-sell succeeds', !error && data.status === 'rejected', error && error.message);
    await checkLogged('reject-sell', 'sell_request', req.id, /update on your Marketswave sell/i, before);
    await admin.from('holdings').delete().eq('client_id', user.id);
    await admin.from('sell_requests').delete().eq('id', req.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // 8 & 9. credit-hys-deposit / reject-hys-deposit
  // ===========================================================================================
  console.log('\n8. credit-hys-deposit\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: req } = await admin.from('hys_deposit_requests').insert({ client_id: user.id, pocket_type: 'ayw', requested_amount: 1000, method: 'bank', currency: 'USD', status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('credit-hys-deposit', { body: { requestId: req.id, confirmedAmount: 1000 } });
    check('credit-hys-deposit succeeds', !error && data.status === 'credited', error && error.message);
    await checkLogged('credit-hys-deposit', 'hys_deposit_request', req.id, /High Yield Savings deposit has been credited/i, before);
    await admin.from('hys_pockets').delete().eq('client_id', user.id);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('hys_deposit_requests').delete().eq('id', req.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n9. reject-hys-deposit\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: req } = await admin.from('hys_deposit_requests').insert({ client_id: user.id, pocket_type: 'fixed', term_mode: 'short', term_months: 6, term_label: '6-Month Fixed Deposit', rate: 8.5, term_in_years: 0.5, requested_amount: 6000, method: 'bank', currency: 'USD', status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('reject-hys-deposit', { body: { requestId: req.id, reason: 'Minimum funding period not met.' } });
    check('reject-hys-deposit succeeds', !error && data.status === 'rejected', error && error.message);
    await checkLogged('reject-hys-deposit', 'hys_deposit_request', req.id, /update on your Marketswave High Yield Savings/i, before);
    await admin.from('hys_deposit_requests').delete().eq('id', req.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // 10 & 11. approve-hys-withdrawal / reject-hys-withdrawal
  // ===========================================================================================
  console.log('\n10. approve-hys-withdrawal\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: pocket } = await admin.from('hys_pockets').insert({ client_id: user.id, pocket_type: 'ayw', amount: 1000, status: 'active', funding_method: 'bank account' }).select().single();
    const { data: req } = await admin.from('hys_withdrawal_requests').insert({ client_id: user.id, pocket_id: pocket.id, pocket_type: 'ayw', term_label: null, forfeit: false, receive_amount: 1000, method: 'bank', destination_details: {}, status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('approve-hys-withdrawal', { body: { requestId: req.id } });
    check('approve-hys-withdrawal succeeds', !error && data.status === 'approved', error && error.message);
    await checkLogged('approve-hys-withdrawal', 'hys_withdrawal_request', req.id, /High Yield Savings withdrawal has been approved/i, before);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('hys_withdrawal_requests').delete().eq('id', req.id);
    await admin.from('hys_pockets').delete().eq('id', pocket.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n11. reject-hys-withdrawal\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: pocket } = await admin.from('hys_pockets').insert({ client_id: user.id, pocket_type: 'ayw', amount: 1000, status: 'active', funding_method: 'bank account' }).select().single();
    const { data: req } = await admin.from('hys_withdrawal_requests').insert({ client_id: user.id, pocket_id: pocket.id, pocket_type: 'ayw', term_label: null, forfeit: false, receive_amount: 1000, method: 'bank', destination_details: {}, status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('reject-hys-withdrawal', { body: { requestId: req.id, reason: 'Please contact support to confirm your identity first.' } });
    check('reject-hys-withdrawal succeeds', !error && data.status === 'rejected', error && error.message);
    await checkLogged('reject-hys-withdrawal', 'hys_withdrawal_request', req.id, /update on your Marketswave High Yield Savings withdrawal/i, before);
    await admin.from('hys_withdrawal_requests').delete().eq('id', req.id);
    await admin.from('hys_pockets').delete().eq('id', pocket.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // 12 & 13. approve-profile-change / reject-profile-change
  // ===========================================================================================
  console.log('\n12. approve-profile-change\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: req } = await admin.from('profile_change_requests').insert({ client_id: user.id, field: 'legalName', current_value: 'Old Name', requested_value: 'New Name', reason: 'Legal name change.', status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('approve-profile-change', { body: { requestId: req.id } });
    check('approve-profile-change succeeds', !error && data.status === 'approved', error && error.message);
    await checkLogged('approve-profile-change', 'profile_change_request', req.id, /profile update has been approved/i, before);
    await admin.from('client_profiles').delete().eq('client_id', user.id);
    await admin.from('profile_change_requests').delete().eq('id', req.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  console.log('\n13. reject-profile-change\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: req } = await admin.from('profile_change_requests').insert({ client_id: user.id, field: 'address', current_value: 'Old Address', requested_value: 'New Address', reason: 'Moved recently.', status: 'pending' }).select().single();
    const before = new Date().toISOString();
    const { data, error } = await pm.functions.invoke('reject-profile-change', { body: { requestId: req.id, resolutionNote: 'Please provide a recent proof of address.' } });
    check('reject-profile-change succeeds', !error && data.status === 'rejected', error && error.message);
    await checkLogged('reject-profile-change', 'profile_change_request', req.id, /update on your Marketswave profile update/i, before);
    await admin.from('profile_change_requests').delete().eq('id', req.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // 14. update-support-ticket — both a plain status move AND a Resolved move, distinct subjects
  // ===========================================================================================
  console.log('\n14. update-support-ticket\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: ticket } = await admin.from('support_requests').insert({ client_id: user.id, display_id: 'DISP-STAGE2TEST', category: 'Other', description: 'Test ticket.', status: 'Open', date_opened: new Date().toISOString().slice(0, 10) }).select().single();

    const before1 = new Date().toISOString();
    const { data: d1, error: e1 } = await pm.functions.invoke('update-support-ticket', { body: { clientId: user.id, requestId: 'DISP-STAGE2TEST', status: 'In Progress', pmNote: 'We are looking into this.' } });
    check('update-support-ticket (In Progress) succeeds', !e1 && d1.status === 'In Progress', e1 && e1.message);
    await checkLogged('update-support-ticket (In Progress)', 'support_request', ticket.id, /update on your Marketswave support request/i, before1);

    const before2 = new Date().toISOString();
    const { data: d2, error: e2 } = await pm.functions.invoke('update-support-ticket', { body: { clientId: user.id, requestId: 'DISP-STAGE2TEST', status: 'Resolved', pmNote: 'Fixed — let us know if you have further questions.' } });
    check('update-support-ticket (Resolved) succeeds', !e2 && d2.status === 'Resolved', e2 && e2.message);
    await checkLogged('update-support-ticket (Resolved)', 'support_request', ticket.id, /support request has been resolved/i, before2);

    await admin.from('support_requests').delete().eq('id', ticket.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // 15. publish-document — both a plain document AND a signature-required one, distinct subjects
  // ===========================================================================================
  console.log('\n15. publish-document\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const fileBase64 = Buffer.from('Stage 2 email trigger test document content.').toString('base64');

    const before1 = new Date().toISOString();
    const { data: d1, error: e1 } = await pm.functions.invoke('publish-document', { body: { clientId: user.id, filename: 'Statement.pdf', category: 'Statements & Reports', signatureRequired: false, fileBase64 } });
    check('publish-document (plain) succeeds', !e1 && d1.id, e1 && e1.message);
    await checkLogged('publish-document (plain)', 'document', d1 && d1.id, /new document is available/i, before1);

    const before2 = new Date().toISOString();
    const { data: d2, error: e2 } = await pm.functions.invoke('publish-document', { body: { clientId: user.id, filename: 'Agreement.pdf', category: 'Signature Required', signatureRequired: true, dueDate: '2026-12-31', fileBase64 } });
    check('publish-document (signature required) succeeds', !e2 && d2.id, e2 && e2.message);
    await checkLogged('publish-document (signature required)', 'document', d2 && d2.id, /requires your signature/i, before2);

    await admin.storage.from('documents').remove([user.id + '/published/' + d1.id + '/Statement.pdf', user.id + '/published/' + d2.id + '/Agreement.pdf']);
    await admin.from('documents').delete().eq('client_id', user.id);
    await admin.from('clients').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
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
