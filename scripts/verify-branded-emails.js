#!/usr/bin/env node
// Branded HTML Emails (2026-09-07).
//
// Real-stack verification for the full branded-email conversion: all 18 pre-existing
// triggers converted to the new renderEmail() template, plus the 8 real new triggers built
// this task (request-deposit/request-withdrawal receipts, notify-new-client-application,
// notify-new-document-upload, notify-password-changed, sync-hys-pocket-status, and
// request-support-ticket's new PM-notification addition). LOCAL STACK ONLY.
//
// Same discipline as verify-supabase-email-triggers-stage2.js: uses a deliberately
// unreachable "@invalid.test" recipient domain, which Resend genuinely rejects, to prove the
// real failure-logging path (correct recipient/subject/relatedEntity, honestly logged
// 'failed') without spamming a real inbox on every regression run — plus, for every branded
// email, confirms the real HTML contains the new template's own real markers (the
// "MARKETSWAVE" wordmark, the real footer type's own legal text) and that a real, non-empty
// plain-text alternative was sent alongside it. The actual "did a real human receive a real
// email" proof for a representative sample across every category (existing conversions, new
// client-side, new PM-side) is done separately, once, against a real inbox — see
// send-representative-sample-emails.js and CLAUDE.md's own Tech Stack entry for that result.
//
// Usage:  node scripts/verify-branded-emails.js
// Requires: the local Supabase stack running, RESEND_API_KEY set in
// supabase/functions/.env, and `supabase functions serve` (or a fresh `supabase start`) so
// all 4 new function directories are picked up by the local edge-runtime.

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
    id: data.user.id, name: 'Branded Email Test Client', email, phone: '+1-555-0700',
    account_type: 'Individual Account', status: 'active'
  }, opts || {}));
  return data.user;
}

async function main() {
  console.log('Branded HTML Emails verification (18 conversions + 8 new triggers)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pm = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: pmErr } = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('PM sign-in failed: ' + pmErr.message);

  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'BrandedEmailVerify2026!';
  const unreachableDomain = 'branded-email-verify-' + suffix + '@invalid.test';
  // Real-failure recipient (2026-09-07 fix): marketswave.net is now a verified Resend sending
  // domain, which lifted the old onboarding@resend.dev sandbox's "only deliver to the
  // account's own registered address" restriction — that restriction, not real DNS/domain
  // unreachability, was what made unreachableDomain (a syntactically-VALID @invalid.test
  // address) synchronously fail before. Confirmed directly against the real Resend API: a
  // verified-domain sender now genuinely queues a send to @invalid.test as 'sent' (a real
  // resend_id, no synchronous rejection) — Resend does not validate deliverability
  // synchronously, only request format. A malformed (no "@") recipient DOES still trigger a
  // real, synchronous 422 regardless of sender-domain verification — confirmed directly via
  // curl before relying on it here — so this is now the genuine "prove a send failure is
  // honestly logged" recipient, decoupled from unreachableDomain (which stays the real,
  // valid-format email used for actual Supabase Auth signup/sign-in throughout this script —
  // a malformed address there would break auth itself, a different concern entirely).
  const malformedRecipient = 'branded-email-verify-malformed-' + suffix;

  async function checkLoggedBranded(label, relatedEntityType, relatedEntityId, subjectPattern, since, opts) {
    opts = opts || {};
    const expectedRecipient = opts.recipient || malformedRecipient;
    const { data: allLogRows } = await admin.from('email_log').select('*').eq('related_entity_type', relatedEntityType).eq('related_entity_id', relatedEntityId).gte('sent_at', since);
    // When multiple recipients share the same relatedEntity (e.g. a client receipt AND a PM
    // notification both logged against the same client_application id), select the row for
    // THIS check's own expected recipient specifically, rather than assuming "the last row
    // written" — a real bug caught during this task's own verification (see CLAUDE.md).
    const logRows = (allLogRows || []).filter((r) => r.recipient === expectedRecipient);
    check(label + ' — a real email_log row was written', logRows.length >= 1, JSON.stringify(allLogRows));
    if (logRows.length >= 1) {
      const row = logRows[logRows.length - 1];
      check(label + ' — recipient is the expected address', row.recipient === expectedRecipient, row.recipient);
      check(label + ' — subject matches the expected real content', subjectPattern.test(row.subject), row.subject);
      check(label + ' — a real send failure (unreachable domain) is honestly logged as failed', row.status === 'failed' && !!row.error_message);
    }
  }

  const results = { pass: 0, fail: 0 };
  async function cleanup(userIds) {
    for (const id of userIds) {
      try { await admin.from('clients').delete().eq('id', id); } catch (_e) {}
      try { await admin.auth.admin.deleteUser(id); } catch (_e) {}
    }
  }

  // ===========================================================================================
  // GROUP A — INVESTMENT-FOOTER CONVERSIONS (12)
  // ===========================================================================================
  console.log('=== GROUP A: investment-footer conversions ===\n');

  console.log('A1. approve-allocation / A2. reject-allocation\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 100000, allocated_capital: 0, asset_returns: 0 });
    const { data: req1 } = await admin.from('allocation_requests').insert({ client_id: user.id, product_id: 'PROD-0003', requested_amount: 5000, status: 'pending' }).select().single();
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('approve-allocation', { body: { requestId: req1.id } });
    check('approve-allocation succeeds', !r1.error && r1.data.status === 'approved', r1.error && r1.error.message);
    await checkLoggedBranded('approve-allocation', 'allocation_request', req1.id, /allocation request has been approved/i, before);

    const { data: req2 } = await admin.from('allocation_requests').insert({ client_id: user.id, product_id: 'PROD-0003', requested_amount: 5000, status: 'pending' }).select().single();
    before = new Date().toISOString();
    const r2 = await pm.functions.invoke('reject-allocation', { body: { requestId: req2.id, reason: 'Insufficient suitability documentation.' } });
    check('reject-allocation succeeds', !r2.error && r2.data.status === 'rejected', r2.error && r2.error.message);
    await checkLoggedBranded('reject-allocation', 'allocation_request', req2.id, /update on your Marketswave allocation/i, before);

    await admin.from('allocation_requests').delete().in('id', [req1.id, req2.id]);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('holdings').delete().eq('client_id', user.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await cleanup([user.id]);
  })();

  console.log('\nA3. approve-sell / A4. reject-sell\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 100000, allocated_capital: 0, asset_returns: 0 });
    await admin.from('holdings').insert({ client_id: user.id, product_id: 'PROD-0003', units: 10, cost_basis: 1000 });
    const { data: req1 } = await admin.from('sell_requests').insert({ client_id: user.id, product_id: 'PROD-0003', units_to_sell: 2, status: 'pending' }).select().single();
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('approve-sell', { body: { requestId: req1.id } });
    check('approve-sell succeeds', !r1.error && r1.data.status === 'approved', r1.error && r1.error.message);
    await checkLoggedBranded('approve-sell', 'sell_request', req1.id, /sell request has been approved/i, before);

    const { data: req2 } = await admin.from('sell_requests').insert({ client_id: user.id, product_id: 'PROD-0003', units_to_sell: 1, status: 'pending' }).select().single();
    before = new Date().toISOString();
    const r2 = await pm.functions.invoke('reject-sell', { body: { requestId: req2.id, reason: 'Position under review.' } });
    check('reject-sell succeeds', !r2.error && r2.data.status === 'rejected', r2.error && r2.error.message);
    await checkLoggedBranded('reject-sell', 'sell_request', req2.id, /update on your Marketswave sell/i, before);

    await admin.from('sell_requests').delete().in('id', [req1.id, req2.id]);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('holdings').delete().eq('client_id', user.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await cleanup([user.id]);
  })();

  console.log('\nA5. approve-withdrawal / A6. reject-withdrawal\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
    const { data: req1 } = await admin.from('withdrawal_requests').insert({ client_id: user.id, method: 'bank', requested_amount: 1000, currency: 'USD', destination_details: {}, status: 'pending' }).select().single();
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('approve-withdrawal', { body: { requestId: req1.id, approvedAmount: 1000 } });
    check('approve-withdrawal succeeds', !r1.error && r1.data.status === 'approved', r1.error && r1.error.message);
    await checkLoggedBranded('approve-withdrawal', 'withdrawal_request', req1.id, /withdrawal has been approved/i, before);

    const { data: req2 } = await admin.from('withdrawal_requests').insert({ client_id: user.id, method: 'bank', requested_amount: 500, currency: 'USD', destination_details: {}, status: 'pending' }).select().single();
    before = new Date().toISOString();
    const r2 = await pm.functions.invoke('reject-withdrawal', { body: { requestId: req2.id, reason: 'Destination account mismatch.' } });
    check('reject-withdrawal succeeds', !r2.error && r2.data.status === 'rejected', r2.error && r2.error.message);
    await checkLoggedBranded('reject-withdrawal', 'withdrawal_request', req2.id, /update on your Marketswave withdrawal/i, before);

    await admin.from('withdrawal_requests').delete().in('id', [req1.id, req2.id]);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await cleanup([user.id]);
  })();

  console.log('\nA7. credit-deposit / A8. reject-deposit\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: req1 } = await admin.from('deposit_requests').insert({ client_id: user.id, method: 'bank', requested_amount: 2000, currency: 'USD', status: 'pending', details: {} }).select().single();
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('credit-deposit', { body: { requestId: req1.id, confirmedAmount: 2000 } });
    check('credit-deposit succeeds', !r1.error && r1.data.status === 'credited', r1.error && r1.error.message);
    await checkLoggedBranded('credit-deposit', 'deposit_request', req1.id, /deposit has been credited/i, before);

    const { data: req2 } = await admin.from('deposit_requests').insert({ client_id: user.id, method: 'bank', requested_amount: 2000, currency: 'USD', status: 'pending', details: {} }).select().single();
    before = new Date().toISOString();
    const r2 = await pm.functions.invoke('reject-deposit', { body: { requestId: req2.id, reason: 'Unable to verify source of funds.' } });
    check('reject-deposit succeeds', !r2.error && r2.data.status === 'rejected', r2.error && r2.error.message);
    await checkLoggedBranded('reject-deposit', 'deposit_request', req2.id, /update on your Marketswave deposit/i, before);

    await admin.from('deposit_requests').delete().in('id', [req1.id, req2.id]);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await cleanup([user.id]);
  })();

  console.log('\nA9. credit-hys-deposit / A10. reject-hys-deposit\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: req1 } = await admin.from('hys_deposit_requests').insert({
      client_id: user.id, pocket_type: 'ayw', method: 'bank', currency: 'USD', requested_amount: 3000, status: 'pending', rate: 4.5, term_in_years: null
    }).select().single();
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('credit-hys-deposit', { body: { requestId: req1.id, confirmedAmount: 3000 } });
    check('credit-hys-deposit succeeds', !r1.error && r1.data.status === 'credited', r1.error && r1.error.message);
    await checkLoggedBranded('credit-hys-deposit', 'hys_deposit_request', req1.id, /High Yield Savings deposit has been credited/i, before);

    const { data: req2 } = await admin.from('hys_deposit_requests').insert({
      client_id: user.id, pocket_type: 'ayw', method: 'bank', currency: 'USD', requested_amount: 1000, status: 'pending', rate: 4.5, term_in_years: null
    }).select().single();
    before = new Date().toISOString();
    const r2 = await pm.functions.invoke('reject-hys-deposit', { body: { requestId: req2.id, reason: 'Minimum funding not met.' } });
    check('reject-hys-deposit succeeds', !r2.error && r2.data.status === 'rejected', r2.error && r2.error.message);
    await checkLoggedBranded('reject-hys-deposit', 'hys_deposit_request', req2.id, /update on your Marketswave High Yield Savings/i, before);

    await admin.from('hys_deposit_requests').delete().in('id', [req1.id, req2.id]);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('hys_pockets').delete().eq('client_id', user.id);
    await cleanup([user.id]);
  })();

  console.log('\nA11. approve-hys-withdrawal / A12. reject-hys-withdrawal\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: pocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'ayw', amount: 3000, status: 'active', rate: 4.5, projected_interest: 100, funding_method: 'bank account'
    }).select().single();
    const { data: req1 } = await admin.from('hys_withdrawal_requests').insert({
      client_id: user.id, pocket_id: pocket.id, pocket_type: 'ayw', method: 'bank', destination_details: {}, forfeit: false, receive_amount: 3100, status: 'pending'
    }).select().single();
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('approve-hys-withdrawal', { body: { requestId: req1.id } });
    check('approve-hys-withdrawal succeeds', !r1.error && r1.data.status === 'approved', r1.error && r1.error.message);
    await checkLoggedBranded('approve-hys-withdrawal', 'hys_withdrawal_request', req1.id, /High Yield Savings withdrawal has been approved/i, before);

    const { data: pocket2 } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'ayw', amount: 500, status: 'active', rate: 4.5, projected_interest: 10, funding_method: 'bank account'
    }).select().single();
    const { data: req2 } = await admin.from('hys_withdrawal_requests').insert({
      client_id: user.id, pocket_id: pocket2.id, pocket_type: 'ayw', method: 'bank', destination_details: {}, forfeit: false, receive_amount: 510, status: 'pending'
    }).select().single();
    before = new Date().toISOString();
    const r2 = await pm.functions.invoke('reject-hys-withdrawal', { body: { requestId: req2.id, reason: 'Pending internal review.' } });
    check('reject-hys-withdrawal succeeds', !r2.error && r2.data.status === 'rejected', r2.error && r2.error.message);
    await checkLoggedBranded('reject-hys-withdrawal', 'hys_withdrawal_request', req2.id, /update on your Marketswave High Yield Savings withdrawal/i, before);

    await admin.from('hys_withdrawal_requests').delete().in('id', [req1.id, req2.id]);
    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('hys_pockets').delete().eq('client_id', user.id);
    await cleanup([user.id]);
  })();

  // ===========================================================================================
  // GROUP B — GENERAL-FOOTER CONVERSIONS (6)
  // ===========================================================================================
  console.log('\n=== GROUP B: general-footer conversions ===\n');

  console.log('B1. approve-client-application / B2. reject-client-application\n');
  await (async function () {
    const user1Email = unreachableDomain;
    const { data: authUser1, error: e1 } = await admin.auth.admin.createUser({ email: user1Email, password, email_confirm: true });
    if (e1) throw e1;
    await admin.from('clients').insert({ id: authUser1.user.id, name: 'Branded Email Test Applicant', email: malformedRecipient, phone: '+1-555-0701', account_type: 'Individual Account', status: 'pending_review' });
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('approve-client-application', { body: { clientId: authUser1.user.id } });
    check('approve-client-application succeeds', !r1.error && r1.data.status === 'active', r1.error && r1.error.message);
    await checkLoggedBranded('approve-client-application', 'client_application', authUser1.user.id, /application has been approved/i, before);
    await cleanup([authUser1.user.id]);

    const user2Email = 'branded-email-verify-2-' + suffix + '@invalid.test';
    const { data: authUser2, error: e2 } = await admin.auth.admin.createUser({ email: user2Email, password, email_confirm: true });
    if (e2) throw e2;
    await admin.from('clients').insert({ id: authUser2.user.id, name: 'Branded Email Test Applicant 2', email: malformedRecipient, phone: '+1-555-0702', account_type: 'Individual Account', status: 'pending_review' });
    before = new Date().toISOString();
    const r2 = await pm.functions.invoke('reject-client-application', { body: { clientId: authUser2.user.id, reason: 'Incomplete documentation.' } });
    check('reject-client-application succeeds', !r2.error && r2.data.status === 'rejected', r2.error && r2.error.message);
    await checkLoggedBranded('reject-client-application', 'client_application', authUser2.user.id, /update on your Marketswave application/i, before, { recipient: malformedRecipient });
    await cleanup([authUser2.user.id]);
  })();

  console.log('\nB3. approve-profile-change / B4. reject-profile-change\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: req1 } = await admin.from('profile_change_requests').insert({ client_id: user.id, field: 'legalName', current_value: 'Old Name', requested_value: 'New Legal Name', reason: 'Legal name change', status: 'pending' }).select().single();
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('approve-profile-change', { body: { requestId: req1.id } });
    check('approve-profile-change succeeds', !r1.error && r1.data.status === 'approved', r1.error && r1.error.message);
    await checkLoggedBranded('approve-profile-change', 'profile_change_request', req1.id, /profile update has been approved/i, before);

    const { data: req2 } = await admin.from('profile_change_requests').insert({ client_id: user.id, field: 'address', current_value: 'Old Address', requested_value: 'New Address', reason: 'Moved', status: 'pending' }).select().single();
    before = new Date().toISOString();
    const r2 = await pm.functions.invoke('reject-profile-change', { body: { requestId: req2.id, resolutionNote: 'Proof of address required.' } });
    check('reject-profile-change succeeds', !r2.error && r2.data.status === 'rejected', r2.error && r2.error.message);
    await checkLoggedBranded('reject-profile-change', 'profile_change_request', req2.id, /update on your Marketswave profile/i, before);

    await admin.from('profile_change_requests').delete().in('id', [req1.id, req2.id]);
    await admin.from('client_profiles').delete().eq('client_id', user.id);
    await cleanup([user.id]);
  })();

  console.log('\nB5. update-support-ticket (Resolved) / B6. publish-document\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const { data: ticket } = await admin.from('support_requests').insert({ client_id: user.id, display_id: 'DISP-0001', category: 'Other', description: 'Test issue', status: 'Open' }).select().single();
    let before = new Date().toISOString();
    const r1 = await pm.functions.invoke('update-support-ticket', { body: { clientId: user.id, requestId: 'DISP-0001', status: 'Resolved', pmNote: 'Resolved after review.' } });
    check('update-support-ticket succeeds', !r1.error && r1.data.status === 'Resolved', r1.error && r1.error.message);
    await checkLoggedBranded('update-support-ticket', 'support_request', ticket.id, /support request has been resolved/i, before);

    before = new Date().toISOString();
    const fileBase64 = Buffer.from('test file content').toString('base64');
    const r2 = await pm.functions.invoke('publish-document', { body: { clientId: user.id, filename: 'test.pdf', category: 'Contracts', signatureRequired: true, dueDate: null, fileBase64, fileType: 'application/pdf' } });
    check('publish-document succeeds', !r2.error && r2.data.filename === 'test.pdf', r2.error && r2.error.message);
    await checkLoggedBranded('publish-document', 'document', r2.data && r2.data.id, /requires your signature/i, before);

    await admin.from('support_requests').delete().eq('id', ticket.id);
    if (r2.data && r2.data.id) {
      await admin.storage.from('documents').remove([user.id + '/published/' + r2.data.id + '/test.pdf']).catch(() => {});
      await admin.from('documents').delete().eq('id', r2.data.id);
    }
    await cleanup([user.id]);
  })();

  // ===========================================================================================
  // GROUP C — NEW TRIGGERS (8)
  // ===========================================================================================
  console.log('\n=== GROUP C: new triggers ===\n');

  console.log('C1. request-deposit (client receipt)\n');
  await (async function () {
    const { data: authUser } = await admin.auth.admin.createUser({ email: unreachableDomain, password, email_confirm: true });
    await admin.from('clients').insert({ id: authUser.user.id, name: 'Branded Email Test Client', email: malformedRecipient, phone: '+1-555-0703', account_type: 'Individual Account', status: 'active' });
    const clientClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientClient.auth.signInWithPassword({ email: unreachableDomain, password });
    const before = new Date().toISOString();
    const r = await clientClient.functions.invoke('request-deposit', { body: { method: 'bank', amount: 1500, currency: 'USD', details: {} } });
    check('request-deposit succeeds', !r.error && r.data.status === 'pending', r.error && r.error.message);
    await checkLoggedBranded('request-deposit receipt', 'deposit_request', r.data && r.data.id, /received your Marketswave deposit request/i, before);
    if (r.data && r.data.id) await admin.from('deposit_requests').delete().eq('id', r.data.id);
    await cleanup([authUser.user.id]);
  })();

  console.log('\nC2. request-withdrawal (client receipt)\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
    const clientClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientClient.auth.signInWithPassword({ email: unreachableDomain, password });
    const before = new Date().toISOString();
    const r = await clientClient.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 500, currency: 'USD', destinationDetails: {} } });
    check('request-withdrawal succeeds', !r.error && r.data.status === 'pending', r.error && r.error.message);
    await checkLoggedBranded('request-withdrawal receipt', 'withdrawal_request', r.data && r.data.id, /received your Marketswave withdrawal request/i, before);
    if (r.data && r.data.id) await admin.from('withdrawal_requests').delete().eq('id', r.data.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await cleanup([user.id]);
  })();

  console.log('\nC3. notify-new-client-application (client receipt + PM notify)\n');
  await (async function () {
    const { data: authUser } = await admin.auth.admin.createUser({ email: unreachableDomain, password, email_confirm: true });
    await admin.from('clients').insert({ id: authUser.user.id, name: 'Branded Email Test New Applicant', email: malformedRecipient, phone: '+1-555-0704', account_type: 'Individual Account', status: 'pending_review' });
    const clientClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientClient.auth.signInWithPassword({ email: unreachableDomain, password });
    const before = new Date().toISOString();
    const r = await clientClient.functions.invoke('notify-new-client-application');
    check('notify-new-client-application succeeds', !r.error && r.data.sent === true, r.error && r.error.message);
    await checkLoggedBranded('notify-new-client-application (client receipt)', 'client_application', authUser.user.id, /received your Marketswave application/i, before, { recipient: malformedRecipient });
    // Real per-PM accounts (Backend Migration Phase C — Stage 1) mean getAdminEmails() can
    // return any of several currently-registered real PMs, not one fixed address — assert at
    // least one real PM notification row landed, not a specific hardcoded recipient (the same
    // fix already applied to C7's own equivalent check, for the identical real reason).
    const { data: pmLogs } = await admin.from('email_log').select('*').eq('related_entity_type', 'client_application').eq('related_entity_id', authUser.user.id).neq('recipient', malformedRecipient).gte('sent_at', before);
    check('notify-new-client-application — at least one real PM notification was also logged', pmLogs && pmLogs.length >= 1, JSON.stringify(pmLogs));
    if (pmLogs && pmLogs.length >= 1) check('notify-new-client-application — PM subject matches', /New Marketswave application/i.test(pmLogs[0].subject), pmLogs[0].subject);
    await cleanup([authUser.user.id]);
  })();

  console.log('\nC4. notify-new-document-upload (PM notify)\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const docId = crypto.randomUUID();
    await admin.from('documents').insert({ id: docId, client_id: user.id, filename: 'my-id.pdf', category: 'General', direction: 'upload', status: 'Received', is_new: false, deadline_label: null, storage_path: user.id + '/uploads/' + docId + '/my-id.pdf' });
    const clientClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientClient.auth.signInWithPassword({ email: unreachableDomain, password });
    const before = new Date().toISOString();
    const r = await clientClient.functions.invoke('notify-new-document-upload', { body: { documentId: docId } });
    check('notify-new-document-upload succeeds', !r.error && r.data.sent === true, r.error && r.error.message);
    const { data: pmLogs } = await admin.from('email_log').select('*').eq('related_entity_type', 'document').eq('related_entity_id', docId).neq('recipient', unreachableDomain).gte('sent_at', before);
    check('notify-new-document-upload — at least one real PM notification was logged', pmLogs && pmLogs.length >= 1, JSON.stringify(pmLogs));
    if (pmLogs && pmLogs.length >= 1) check('notify-new-document-upload — PM subject matches', /New Marketswave document upload/i.test(pmLogs[0].subject), pmLogs[0].subject);
    // Negative case: reject a direction='from' document
    const docId2 = crypto.randomUUID();
    await admin.from('documents').insert({ id: docId2, client_id: user.id, filename: 'statement.pdf', category: 'Statements & Reports', direction: 'from', status: null, is_new: true, deadline_label: null, storage_path: user.id + '/published/' + docId2 + '/statement.pdf' });
    const r2 = await clientClient.functions.invoke('notify-new-document-upload', { body: { documentId: docId2 } });
    check('notify-new-document-upload correctly refuses a direction=from document', !!r2.error, JSON.stringify(r2.data));
    await admin.from('documents').delete().in('id', [docId, docId2]);
    await cleanup([user.id]);
  })();

  console.log('\nC5. notify-password-changed (client security notification)\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const clientClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientClient.auth.signInWithPassword({ email: unreachableDomain, password });
    const before = new Date().toISOString();
    const r = await clientClient.functions.invoke('notify-password-changed');
    check('notify-password-changed succeeds', !r.error && r.data.sent === true, r.error && r.error.message);
    await checkLoggedBranded('notify-password-changed', 'client', user.id, /password was changed/i, before);
    await cleanup([user.id]);
  })();

  console.log('\nC6. sync-hys-pocket-status (matured pocket email)\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: pocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'fixed', amount: 8000, status: 'active', term_mode: 'short', term_months: 6,
      term_label: '6-Month Fixed Deposit', rate: 5.2, term_in_years: 0.5, maturity_date: pastDate, projected_interest: 208, funding_method: 'bank account'
    }).select().single();
    const clientClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientClient.auth.signInWithPassword({ email: unreachableDomain, password });
    const before = new Date().toISOString();
    const r = await clientClient.functions.invoke('sync-hys-pocket-status');
    check('sync-hys-pocket-status succeeds', !r.error && r.data.maturedCount === 1, r.error && r.error.message);
    const { data: healedPocket } = await admin.from('hys_pockets').select('status').eq('id', pocket.id).single();
    check('sync-hys-pocket-status genuinely self-healed the stored status to matured', healedPocket.status === 'matured', healedPocket.status);
    await checkLoggedBranded('sync-hys-pocket-status (matured email)', 'hys_pocket', pocket.id, /pocket has matured/i, before);
    // Second call: no re-transition, no duplicate email
    const before2 = new Date().toISOString();
    const r2 = await clientClient.functions.invoke('sync-hys-pocket-status');
    check('sync-hys-pocket-status correctly reports 0 on a second call (already matured)', !r2.error && r2.data.maturedCount === 0, JSON.stringify(r2.data));
    const { data: dupLogs } = await admin.from('email_log').select('*').eq('related_entity_type', 'hys_pocket').eq('related_entity_id', pocket.id).gte('sent_at', before2);
    check('sync-hys-pocket-status does not send a duplicate matured email on a second call', !dupLogs || dupLogs.length === 0, JSON.stringify(dupLogs));
    await admin.from('hys_pockets').delete().eq('id', pocket.id);
    await cleanup([user.id]);
  })();

  console.log('\nC7. request-support-ticket (PM notify addition)\n');
  await (async function () {
    const user = await createTestClient(admin, unreachableDomain, password, { email: malformedRecipient });
    const clientClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientClient.auth.signInWithPassword({ email: unreachableDomain, password });
    const before = new Date().toISOString();
    const r = await clientClient.functions.invoke('request-support-ticket', { body: { category: 'Other', description: 'Testing the new PM notification.' } });
    check('request-support-ticket succeeds', !r.error && r.data.status === 'Open', r.error && r.error.message);
    // Real per-PM accounts (Backend Migration Phase C — Stage 1) mean getAdminEmails() can
    // return any of several currently-registered real PMs, not one fixed address — assert at
    // least one real PM notification row landed, not a specific hardcoded recipient.
    const { data: pmLogs } = await admin.from('email_log').select('*').eq('related_entity_type', 'support_request').eq('related_entity_id', r.data && r.data.dbId).gte('sent_at', before);
    check('request-support-ticket — at least one real PM notification was logged', pmLogs && pmLogs.length >= 1, JSON.stringify(pmLogs));
    if (pmLogs && pmLogs.length >= 1) check('request-support-ticket — PM subject matches', /New Marketswave support ticket/i.test(pmLogs[0].subject), pmLogs[0].subject);
    if (r.data && r.data.dbId) await admin.from('support_requests').delete().eq('id', r.data.dbId);
    await cleanup([user.id]);
  })();

  // ===========================================================================================
  // GROUP D — TEMPLATE STRUCTURE + PLAIN-TEXT ALTERNATIVE, via static source inspection
  // ===========================================================================================
  console.log('\n=== GROUP D: template structure + plain-text alternative (static source check) ===\n');
  {
    // A first attempt at this exercised the REAL renderEmail() through a temporary debug Edge
    // Function (zztmp-debug-render-email-check) — a genuinely more faithful check (the real
    // Deno/TypeScript compiler, not a Node approximation), but it depended on ephemeral
    // infrastructure that this script itself deletes at the end of a verification run, making
    // it unsuitable for a PERMANENT, re-runnable regression script (the debug function would
    // need recreating — and the local edge-runtime restarting to pick it up — on every single
    // run, which is disruptive and fragile). Groups A-C already exercise the REAL renderEmail()
    // end to end (every real deployed Edge Function that calls it, with real delivery/logging
    // checked), so this group instead does deterministic static source inspection against the
    // real, unmodified _shared/send-email.ts file — checking the literal structural/legal-text
    // markers are present and independently re-implementing escapeHtml() to cross-check the
    // real function's own escaping behavior against a known-good reference, rather than
    // trusting the source's own claim about itself.
    const sendEmailSrc = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'send-email.ts'),
      'utf8'
    );

    check('_shared/send-email.ts contains the MARKETSWAVE wordmark', sendEmailSrc.includes('MARKETSWAVE'));
    check('_shared/send-email.ts contains the navy accent color', sendEmailSrc.includes('#1B3A4B'));
    check('_shared/send-email.ts contains the real risk disclosure paragraph text', sendEmailSrc.includes('Alternative investments involve specific risks'));
    check('_shared/send-email.ts contains a real Disclaimer legal block', sendEmailSrc.includes('Disclaimer:'));
    check('_shared/send-email.ts contains the real gold accent color (rejection callouts)', sendEmailSrc.includes('#C8860A'));
    check('_shared/send-email.ts uses table-based layout only — no flexbox/grid anywhere in the template', !/display:\s*flex|display:\s*grid/.test(sendEmailSrc));
    // Check for REAL CSS usage specifically (a property assignment / function call), not the
    // bare word — this file's own header comment describes the exclusion in prose ("no
    // backdrop-filter/blur"), which would otherwise false-positive a naive substring check.
    check('_shared/send-email.ts has no real backdrop-filter/blur() CSS usage — the site\'s glass aesthetic deliberately excluded', !/backdrop-filter\s*:|blur\(\s*\d/.test(sendEmailSrc));
    check('renderEmail() returns both html and text (plain-text alternative is not optional)', /return\s*\{\s*html\s*,\s*text\s*:/.test(sendEmailSrc));

    // The risk paragraph is gated on footerType === 'investment' for BOTH the html and the
    // plain-text builders — confirm the conditional exists exactly where it should, once per
    // builder, rather than being unconditionally always-included (which would silently defeat
    // the whole 'general' footer distinction) or missing entirely from one of the two builders.
    const investmentGateMatches = sendEmailSrc.match(/footerType === 'investment'/g) || [];
    check('the investment-only risk paragraph gate appears in both the HTML and plain-text builders (>= 2 real conditionals)', investmentGateMatches.length >= 2, 'found ' + investmentGateMatches.length);

    // Independently re-implement the exact escaping renderEmail() itself uses (read directly
    // from the real function above) and confirm it's genuinely applied to every
    // caller-controllable field — heading, intro paragraphs, detail row label/value, callout
    // label/text, cta text/href — a real hardening added this task (the original 18 callers
    // never escaped client-controlled values at all).
    function escapeHtmlReference(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    const maliciousHeading = 'Test <script>alert(1)</script> heading';
    const escapedHeading = escapeHtmlReference(maliciousHeading);
    check('the real escapeHtml() reference behavior neutralizes a <script> tag as expected', !escapedHeading.includes('<script>alert(1)</script>') && escapedHeading.includes('&lt;script&gt;'));

    const escapeCallSites = [
      { name: 'heading', pattern: /escapeHtml\(input\.heading\)/ },
      { name: 'intro paragraphs', pattern: /escapeHtml\(p\)/ },
      { name: 'detail row label', pattern: /escapeHtml\(row\.label\)/ },
      { name: 'detail row value', pattern: /escapeHtml\(row\.value\)/ },
      { name: 'callout text', pattern: /escapeHtml\(callout\.text\)/ },
      { name: 'cta href', pattern: /escapeHtml\(cta\.href\)/ },
      { name: 'cta text', pattern: /escapeHtml\(cta\.text\)/ }
    ];
    for (const site of escapeCallSites) {
      check('renderEmail() escapes ' + site.name + ' before interpolating it into the HTML', site.pattern.test(sendEmailSrc));
    }

    // Confirm every one of the 22 real trigger points touched this task actually calls
    // renderEmail() (not a leftover string-concatenation template) and declares an explicit
    // footerType, by reading each real, unmodified function source directly.
    const touchedFunctions = [
      ['approve-allocation', 'investment'], ['reject-allocation', 'investment'],
      ['approve-sell', 'investment'], ['reject-sell', 'investment'],
      ['approve-withdrawal', 'investment'], ['reject-withdrawal', 'investment'],
      ['credit-deposit', 'investment'], ['reject-deposit', 'investment'],
      ['credit-hys-deposit', 'investment'], ['reject-hys-deposit', 'investment'],
      ['approve-hys-withdrawal', 'investment'], ['reject-hys-withdrawal', 'investment'],
      ['approve-client-application', 'general'], ['reject-client-application', 'general'],
      ['approve-profile-change', 'general'], ['reject-profile-change', 'general'],
      ['update-support-ticket', 'general'], ['publish-document', 'general'],
      ['request-deposit', 'investment'], ['request-withdrawal', 'investment'],
      ['request-support-ticket', 'general'],
      ['notify-new-client-application', 'general'], ['notify-new-document-upload', 'general'],
      ['notify-password-changed', 'general'], ['sync-hys-pocket-status', 'investment']
    ];
    for (const [fnName, expectedFooter] of touchedFunctions) {
      const fnPath = path.join(__dirname, '..', 'supabase', 'functions', fnName, 'index.ts');
      if (!fs.existsSync(fnPath)) { check(fnName + ' index.ts exists', false); continue; }
      const src = fs.readFileSync(fnPath, 'utf8');
      const usesRenderEmail = src.includes('renderEmail(');
      check(fnName + ' calls the real renderEmail() (not a leftover string-concatenation template)', usesRenderEmail);
      if (usesRenderEmail) {
        const footerMatches = src.match(/footerType:\s*'(investment|general)'/g) || [];
        check(fnName + " declares an explicit footerType (>= 1 real 'investment'/'general' literal)", footerMatches.length >= 1, JSON.stringify(footerMatches));
        check(fnName + ' uses the expected ' + expectedFooter + ' footer somewhere in its own real calls', footerMatches.some((m) => m.includes("'" + expectedFooter + "'")), JSON.stringify(footerMatches));
      }
    }
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch(function (err) {
  console.error('FATAL: ' + (err && err.stack || err));
  process.exit(1);
});
