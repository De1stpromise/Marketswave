#!/usr/bin/env node
// Backend Migration Phase B — Stage 4 (2026-09-02).
//
// Real-stack verification for HYS pockets and the HYS Deposit/Withdrawal Approval Queues
// moving to real Supabase tables + Edge Functions. Mirrors verify-supabase-deposits-
// withdrawals.js's own rigor and structure (same credential/sign-in helpers, same
// byte-for-byte cross-client isolation diff technique) — this is the Approval Gate's 5th and
// 6th queues (HYS Deposits, plus the HYS Withdrawal queue this stage's own EDGE FUNCTIONS
// section required as a necessary addition) going server-side.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and localhost-only guard as every other local-stack script in this project.
//
// Standing convention as of this task (2026-09-02): Node/API-level verification only, no
// browser automation — this script IS that verification.
//
// Usage:  node scripts/verify-supabase-hys.js
// Requires: the local Supabase stack running, this stage's migration applied
// (`supabase migration up --local`), and the edge-runtime container (`supabase start` already
// runs it) reachable.

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

async function createTestClient(admin, email, password) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('createUser(' + email + ') failed: ' + error.message);
  return data.user;
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, session: data.session };
}

async function cleanupClient(admin, userId) {
  await admin.from('hys_withdrawal_requests').delete().eq('client_id', userId);
  await admin.from('hys_deposit_requests').delete().eq('client_id', userId);
  await admin.from('hys_pockets').delete().eq('client_id', userId);
  await admin.from('transactions').delete().eq('client_id', userId);
  await admin.from('account_state').delete().eq('client_id', userId);
  await admin.auth.admin.deleteUser(userId);
}

async function main() {
  console.log('Supabase Backend Migration Phase B — Stage 4 verification (HYS Deposits & Withdrawals)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyHys-2026!';
  const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  // ===========================================================================================
  // TEST 1 — request-hys-deposit validation (mirrors requestHYSDeposit()'s own shape checks).
  // ===========================================================================================
  console.log('1. request-hys-deposit — validation, self-scoping, and clean pending rows (fixed + AYW)');

  await (async function () {
    const email = 'hysdep-validation-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { error: badPocketTypeErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'other', amount: 6000, method: 'bank' } });
    check('rejects an invalid pocketType', badPocketTypeErr && badPocketTypeErr.context && badPocketTypeErr.context.status === 400, badPocketTypeErr && badPocketTypeErr.message);

    const { error: badMethodErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: 100, method: 'paypal' } });
    check('rejects an invalid method', badMethodErr && badMethodErr.context && badMethodErr.context.status === 400);

    const { error: badAmountErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: -5, method: 'bank' } });
    check('rejects a non-positive amount', badAmountErr && badAmountErr.context && badAmountErr.context.status === 400);

    const { error: belowMinErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'fixed', amount: 4999, method: 'bank', term: { mode: 'short', value: 3 } } });
    check('rejects a Fixed Deposit below the real $5,000 minimum', belowMinErr && belowMinErr.context && belowMinErr.context.status === 400, belowMinErr && belowMinErr.message);

    const { error: noTermErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'fixed', amount: 10000, method: 'bank' } });
    check('rejects a Fixed Deposit with no term', noTermErr && noTermErr.context && noTermErr.context.status === 400);

    const { error: badTermModeErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'fixed', amount: 10000, method: 'bank', term: { mode: 'weekly', value: 3 } } });
    check('rejects an invalid term.mode', badTermModeErr && badTermModeErr.context && badTermModeErr.context.status === 400);

    const { error: badShortRangeErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'fixed', amount: 10000, method: 'bank', term: { mode: 'short', value: 13 } } });
    check('rejects a short-term months value outside 1-12', badShortRangeErr && badShortRangeErr.context && badShortRangeErr.context.status === 400);

    const { error: badLockedRangeErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'fixed', amount: 10000, method: 'bank', term: { mode: 'locked', value: 6 } } });
    check('rejects a locked-term years value outside 1-5', badLockedRangeErr && badLockedRangeErr.context && badLockedRangeErr.context.status === 400);

    // Real success path — a 6-month short-term Fixed Deposit, matching this project's own
    // HYS_SHORT_TERM_BRACKETS rate (max:6 -> 8.5%).
    const { data: fixedCreated, error: fixedErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', {
      body: { pocketType: 'fixed', amount: 15000, method: 'bank', term: { mode: 'short', value: 6 }, details: { bankName: 'Test Bank', accountNumber: '999' } }
    });
    check('a valid Fixed Deposit (6mo) request succeeds', !fixedErr, fixedErr && fixedErr.message);
    check('created request is scoped to the caller’s own uid, never a client-supplied id', fixedCreated && fixedCreated.clientId === user.id, JSON.stringify(fixedCreated));
    check('created request status defaults to pending', fixedCreated && fixedCreated.status === 'pending');
    check('the 6-month rate resolves to exactly 8.5, matching HYS_SHORT_TERM_BRACKETS', fixedCreated && fixedCreated.rate === 8.5, JSON.stringify(fixedCreated));
    check('termLabel is "6 Months" (plural correctly applied)', fixedCreated && fixedCreated.termLabel === '6 Months');
    check('termInYears is exactly 0.5 (6/12)', fixedCreated && fixedCreated.termInYears === 0.5);
    check('currency defaults to USD for a bank-method request', fixedCreated && fixedCreated.currency === 'USD');

    // Real success path — a 3-year locked-term Fixed Deposit (HYS_LOCKED_RATES[3] = 17.5).
    const { data: lockedCreated, error: lockedErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', {
      body: { pocketType: 'fixed', amount: 20000, method: 'crypto', term: { mode: 'locked', value: 3 }, details: { asset: 'ETH' } }
    });
    check('a valid Fixed Deposit (3yr locked) request succeeds', !lockedErr, lockedErr && lockedErr.message);
    check('the 3-year locked rate resolves to exactly 17.5, matching HYS_LOCKED_RATES', lockedCreated && lockedCreated.rate === 17.5, JSON.stringify(lockedCreated));
    check('termLabel is "3 Years"', lockedCreated && lockedCreated.termLabel === '3 Years');
    check('currency reflects the crypto asset (ETH), not USD', lockedCreated && lockedCreated.currency === 'ETH');

    // Real success path — an As You Want pocket: no term, no rate, no minimum.
    const { data: aywCreated, error: aywErr } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: 250, method: 'bank' } });
    check('a valid AYW request below the $5,000 Fixed minimum still succeeds (AYW has no minimum)', !aywErr, aywErr && aywErr.message);
    check('AYW request carries no term/rate at all', aywCreated && aywCreated.termMode === null && aywCreated.rate === null && aywCreated.termLabel === null, JSON.stringify(aywCreated));

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 2 — credit-hys-deposit: PM-editable confirmed amount, maturity computed from the
  // credit date (not the request date), projected interest from the confirmed amount.
  // ===========================================================================================
  console.log('\n2. credit-hys-deposit — PM-editable amount, maturity/interest from confirmed amount + credit date');

  await (async function () {
    const email = 'hysdep-credit-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    // 1-year locked-term (rate 14%), requested for $8,000 but PM confirms a different amount,
    // $7,500 — the actual point of this queue having a two-step flow.
    const { data: request } = await clientSignIn.client.functions.invoke('request-hys-deposit', {
      body: { pocketType: 'fixed', amount: 8000, method: 'bank', term: { mode: 'locked', value: 1 }, details: { bankName: 'Test Bank' } }
    });
    check('deposit request created for the credit test', !!request, JSON.stringify(request));

    const confirmedAmount = 7500;
    const beforeCredit = new Date();
    const { data: credited, error: creditErr } = await adminSignIn.client.functions.invoke('credit-hys-deposit', { body: { requestId: request.id, confirmedAmount } });
    check('credit-hys-deposit succeeds', !creditErr, creditErr && creditErr.message);
    check('credited request status is now "credited"', credited && credited.status === 'credited');
    check('creditedAmount is the PM-entered confirmedAmount, NOT the original requestedAmount', credited && credited.creditedAmount === confirmedAmount && credited.requestedAmount === 8000, JSON.stringify(credited));
    check('credit-hys-deposit links a real pocketId and transactionId onto the resolved request', credited && !!credited.pocketId && !!credited.transactionId);

    const { data: pocket } = await admin.from('hys_pockets').select('*').eq('id', credited.pocketId).single();
    check('the real pocket amount is the CONFIRMED amount (7500), not the requested amount (8000)', pocket.amount === confirmedAmount, 'got=' + pocket.amount);
    check('the pocket is created active', pocket.status === 'active');
    check('the pocket funding_method reflects "bank account" for a bank-method request', pocket.funding_method === 'bank account');

    // Maturity computed from the CREDIT date, not the (earlier) request date.
    const maturity = new Date(pocket.maturity_date);
    const expectedYear = beforeCredit.getUTCFullYear() + 1;
    check('maturity_date is computed from the CREDIT date (now + 1 year), not the request date', maturity.getUTCFullYear() === expectedYear, 'got year=' + maturity.getUTCFullYear() + ' expected=' + expectedYear);

    // projected_interest computed from the CONFIRMED amount (7500), not requested (8000):
    // 7500 * 0.14 * 1 = 1050.
    check('projected_interest is computed from the CONFIRMED amount (7500 * 14% * 1yr = 1050), not the requested amount', pocket.projected_interest === 1050, 'got=' + pocket.projected_interest);

    const { data: txn } = await admin.from('transactions').select('*').eq('id', credited.transactionId).single();
    check('the linked transaction is a real HYS_DEPOSIT row with no product_id/units/price', txn.type === 'HYS_DEPOSIT' && txn.product_id === null && txn.units === null && txn.price === null);
    check('the linked transaction total_value matches the confirmed amount', txn.total_value === confirmedAmount);

    // HYS deliberately never touches account_state — the actual "own pool" property.
    const { data: accountRows } = await admin.from('account_state').select('*').eq('client_id', user.id);
    check('credit-hys-deposit never creates/touches an account_state row for this client (HYS is its own pool)', accountRows.length === 0, JSON.stringify(accountRows));

    // Double-credit refused.
    const { error: doubleCreditErr } = await adminSignIn.client.functions.invoke('credit-hys-deposit', { body: { requestId: request.id, confirmedAmount: 500 } });
    check('credit-hys-deposit refuses to re-credit an already-resolved request (409)', doubleCreditErr && doubleCreditErr.context && doubleCreditErr.context.status === 409, doubleCreditErr && doubleCreditErr.message);
    const { count: pocketCountAfterDouble } = await admin.from('hys_pockets').select('*', { count: 'exact', head: true }).eq('client_id', user.id);
    check('a rejected double-credit attempt creates no second pocket', pocketCountAfterDouble === 1, 'got=' + pocketCountAfterDouble);

    // confirmedAmount below the real Fixed minimum is refused even on credit (not just request).
    const { data: request2 } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'fixed', amount: 5000, method: 'bank', term: { mode: 'short', value: 1 } } });
    const { error: belowMinCreditErr } = await adminSignIn.client.functions.invoke('credit-hys-deposit', { body: { requestId: request2.id, confirmedAmount: 4000 } });
    check('credit-hys-deposit refuses a confirmedAmount below the $5,000 Fixed minimum', belowMinCreditErr && belowMinCreditErr.context && belowMinCreditErr.context.status === 400);

    // AYW pocket: no maturity, no projected interest, but a real pocket still created.
    const { data: aywRequest } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: 300, method: 'bank' } });
    const { data: aywCredited, error: aywCreditErr } = await adminSignIn.client.functions.invoke('credit-hys-deposit', { body: { requestId: aywRequest.id, confirmedAmount: 300 } });
    check('credit-hys-deposit succeeds for an AYW request', !aywCreditErr, aywCreditErr && aywCreditErr.message);
    const { data: aywPocket } = await admin.from('hys_pockets').select('*').eq('id', aywCredited.pocketId).single();
    check('an AYW pocket has no maturity_date and zero projected_interest', aywPocket.maturity_date === null && aywPocket.projected_interest === 0, JSON.stringify(aywPocket));

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 3 — reject-hys-deposit: marks rejected with a reason, moves nothing.
  // ===========================================================================================
  console.log('\n3. reject-hys-deposit — marks rejected with a reason, moves nothing');

  await (async function () {
    const email = 'hysdep-reject-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { data: request } = await clientSignIn.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: 900, method: 'crypto', details: { asset: 'BTC' } } });
    const { data: rejected, error: rejectErr } = await adminSignIn.client.functions.invoke('reject-hys-deposit', { body: { requestId: request.id, reason: 'Unverifiable source of funds.' } });
    check('reject-hys-deposit succeeds', !rejectErr, rejectErr && rejectErr.message);
    check('rejected request status is "rejected" with the reason preserved', rejected && rejected.status === 'rejected' && rejected.reason === 'Unverifiable source of funds.');
    check('a rejected HYS deposit never creates a pocket', (await admin.from('hys_pockets').select('*').eq('client_id', user.id)).data.length === 0);
    check('a rejected HYS deposit never creates a transaction', (await admin.from('transactions').select('*').eq('client_id', user.id)).data.length === 0);

    const { error: doubleRejectErr } = await adminSignIn.client.functions.invoke('reject-hys-deposit', { body: { requestId: request.id, reason: 'again' } });
    check('reject-hys-deposit refuses to re-resolve an already-resolved request (409)', doubleRejectErr && doubleRejectErr.context && doubleRejectErr.context.status === 409);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 4 — request-hys-withdrawal validation: unknown pocket, already-withdrawn, the locked-
  // pocket-blocks-early-withdrawal rule (short-term is NOT blocked, only locked), duplicate
  // pending, and the forfeiture-vs-matured distinction via computeHysWithdrawalAmount().
  // ===========================================================================================
  console.log('\n4. request-hys-withdrawal — validation, the locked-pocket rule, and forfeiture vs. matured');

  await (async function () {
    const email = 'hyswd-validation-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { error: unknownPocketErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: '00000000-0000-0000-0000-000000000000', method: 'bank' } });
    check('rejects an unknown pocketId (404)', unknownPocketErr && unknownPocketErr.context && unknownPocketErr.context.status === 404, unknownPocketErr && unknownPocketErr.message);

    // Seed pockets directly (service_role), bypassing the request/credit flow — this test is
    // about withdrawal behavior against a range of pocket STATES, not the deposit flow again.
    const { data: aywPocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'ayw', amount: 1000, status: 'active',
      funding_method: 'bank account', projected_interest: 0
    }).select().single();

    const { data: shortActivePocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'fixed', amount: 6000, status: 'active',
      term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5,
      maturity_date: new Date(Date.now() + 90 * 86400000).toISOString(), projected_interest: 255,
      funding_method: 'bank account'
    }).select().single();

    const { data: lockedActivePocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'fixed', amount: 12000, status: 'active',
      term_mode: 'locked', term_years: 2, term_label: '2 Years', rate: 16, term_in_years: 2,
      maturity_date: new Date(Date.now() + 400 * 86400000).toISOString(), projected_interest: 3840,
      funding_method: 'bank account'
    }).select().single();

    const { data: lockedMaturedPocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'fixed', amount: 9000, status: 'matured',
      term_mode: 'locked', term_years: 1, term_label: '1 Year', rate: 14, term_in_years: 1,
      maturity_date: new Date(Date.now() - 5 * 86400000).toISOString(), projected_interest: 1260,
      funding_method: 'bank account'
    }).select().single();

    const { data: withdrawnPocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'ayw', amount: 500, status: 'withdrawn',
      funding_method: 'bank account', projected_interest: 0
    }).select().single();

    const { error: alreadyWithdrawnErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: withdrawnPocket.id, method: 'bank' } });
    check('rejects a request against an already-withdrawn pocket (409)', alreadyWithdrawnErr && alreadyWithdrawnErr.context && alreadyWithdrawnErr.context.status === 409);

    const { error: lockedBlockedErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: lockedActivePocket.id, method: 'bank' } });
    check('a still-active LOCKED-term pocket cannot be withdrawn before maturity (409)', lockedBlockedErr && lockedBlockedErr.context && lockedBlockedErr.context.status === 409, lockedBlockedErr && lockedBlockedErr.message);

    // The core "short-term is NOT blocked the same way" distinction — an active short-term
    // pocket CAN be withdrawn early (it just forfeits interest, checked below), unlike a
    // locked-term pocket which is hard-blocked.
    const { data: shortActiveRequest, error: shortActiveErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: shortActivePocket.id, method: 'bank', destinationDetails: { bankName: 'X', accountNumber: '1' } } });
    check('a still-active SHORT-term pocket CAN be requested for early withdrawal (not hard-blocked)', !shortActiveErr, shortActiveErr && shortActiveErr.message);
    check('the active short-term withdrawal correctly forfeits interest (receiveAmount = principal only, 6000)', shortActiveRequest && shortActiveRequest.forfeit === true && shortActiveRequest.receiveAmount === 6000, JSON.stringify(shortActiveRequest));

    // A MATURED locked pocket (status transitioned away from 'active' by the client-side
    // maturity check) is genuinely withdrawable and does NOT forfeit interest.
    const { data: maturedRequest, error: maturedErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: lockedMaturedPocket.id, method: 'crypto', destinationDetails: { asset: 'ETH', walletAddress: '0xTest' } } });
    check('a MATURED locked-term pocket can be withdrawn (not blocked)', !maturedErr, maturedErr && maturedErr.message);
    check('a matured pocket does NOT forfeit interest (receiveAmount = principal + projectedInterest = 9000 + 1260 = 10260)', maturedRequest && maturedRequest.forfeit === false && maturedRequest.receiveAmount === 10260, JSON.stringify(maturedRequest));

    // AYW always returns the full balance, forfeit always false — no interest concept at all.
    const { data: aywRequest, error: aywReqErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: aywPocket.id, method: 'bank', destinationDetails: { bankName: 'X', accountNumber: '2' } } });
    check('an AYW pocket withdrawal succeeds', !aywReqErr, aywReqErr && aywReqErr.message);
    check('an AYW pocket never forfeits and always returns its own full balance (1000)', aywRequest && aywRequest.forfeit === false && aywRequest.receiveAmount === 1000, JSON.stringify(aywRequest));

    // A second pending request against the SAME pocket is refused.
    const { error: duplicatePendingErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: aywPocket.id, method: 'bank', destinationDetails: { bankName: 'X', accountNumber: '3' } } });
    check('a second pending withdrawal request against the SAME pocket is refused (409)', duplicatePendingErr && duplicatePendingErr.context && duplicatePendingErr.context.status === 409, duplicatePendingErr && duplicatePendingErr.message);

    // None of the above touched any pocket's own stored status/amount yet — only
    // approve-hys-withdrawal does that.
    const { data: pocketsStillUntouched } = await admin.from('hys_pockets').select('id,status').in('id', [aywPocket.id, shortActivePocket.id, lockedMaturedPocket.id]);
    check('requesting alone never mutates any pocket’s own status ("request now, execute later")', pocketsStillUntouched.every((p) => p.status === 'active' || p.status === 'matured'), JSON.stringify(pocketsStillUntouched));

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 4b — Backend Requirements Register row 124 (2026-09-03): the real maturity-transition
  // fix. Before this fix, a pocket that had genuinely passed its real maturity_date but whose
  // stored `status` was still 'active' (the exact real-world state every pocket sits in between
  // credit-hys-deposit creating it and someone eventually touching it — nothing previously
  // transitioned it) had its withdrawal evaluated against pre-maturity rules: a short-term
  // pocket would wrongly forfeit interest it shouldn't, and a LOCKED pocket would be wrongly
  // BLOCKED from withdrawal entirely — a real, indefinite access denial, not just a display bug.
  // TEST 4's own lockedMaturedPocket above never actually exercised this real bug, since it
  // seeded status: 'matured' directly, already correct — these new pockets deliberately seed
  // status: 'active' with a maturity_date in the past, the real state the fix must self-heal.
  // ===========================================================================================
  console.log('\n4b. The real maturity-transition fix — a pocket stored "active" with a past maturity_date');

  await (async function () {
    const email = 'hyswd-maturity-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    // Genuinely past maturity_date, but stored status is still 'active' — the real, ordinary
    // state a pocket sits in once its term elapses, since nothing transitions it automatically.
    const { data: staleShortPocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'fixed', amount: 5000, status: 'active',
      term_mode: 'short', term_months: 3, term_label: '3 Months', rate: 7, term_in_years: 0.25,
      maturity_date: new Date(Date.now() - 3 * 86400000).toISOString(), projected_interest: 87.5,
      funding_method: 'bank account'
    }).select().single();

    const { data: staleLockedPocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'fixed', amount: 8000, status: 'active',
      term_mode: 'locked', term_years: 1, term_label: '1 Year', rate: 14, term_in_years: 1,
      maturity_date: new Date(Date.now() - 1 * 86400000).toISOString(), projected_interest: 1120,
      funding_method: 'bank account'
    }).select().single();

    // Control: a GENUINELY still-active pocket (real future maturity_date) must keep behaving
    // exactly as before — the fix must not over-fire on a pocket that hasn't actually matured.
    const { data: genuinelyActivePocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'fixed', amount: 6000, status: 'active',
      term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5,
      maturity_date: new Date(Date.now() + 90 * 86400000).toISOString(), projected_interest: 255,
      funding_method: 'bank account'
    }).select().single();

    // ---- The genuinely-matured LOCKED pocket, previously an indefinite access denial ----
    const { data: lockedWithdrawal, error: lockedErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: staleLockedPocket.id, method: 'bank', destinationDetails: { bankName: 'X', accountNumber: '1' } } });
    check('a LOCKED pocket stored "active" but genuinely past maturity_date is NO LONGER wrongly blocked', !lockedErr, lockedErr && lockedErr.message);
    check('the real receiveAmount correctly does NOT forfeit interest (8000 + 1120 = 9120)', lockedWithdrawal && lockedWithdrawal.forfeit === false && lockedWithdrawal.receiveAmount === 9120, JSON.stringify(lockedWithdrawal));

    const { data: lockedPocketAfter } = await admin.from('hys_pockets').select('status').eq('id', staleLockedPocket.id).single();
    check('the real stored pocket row was genuinely self-healed to status=matured', lockedPocketAfter && lockedPocketAfter.status === 'matured', JSON.stringify(lockedPocketAfter));

    // ---- The genuinely-matured SHORT-term pocket, previously wrongly forfeiting interest ----
    const { data: shortWithdrawal, error: shortErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: staleShortPocket.id, method: 'bank', destinationDetails: { bankName: 'X', accountNumber: '2' } } });
    check('a SHORT-term pocket stored "active" but genuinely past maturity_date requests successfully', !shortErr, shortErr && shortErr.message);
    check('the real receiveAmount correctly does NOT forfeit interest (5000 + 87.5 = 5087.5, not the old wrong 5000)', shortWithdrawal && shortWithdrawal.forfeit === false && shortWithdrawal.receiveAmount === 5087.5, JSON.stringify(shortWithdrawal));

    const { data: shortPocketAfter } = await admin.from('hys_pockets').select('status').eq('id', staleShortPocket.id).single();
    check('this real stored pocket row was also genuinely self-healed to status=matured', shortPocketAfter && shortPocketAfter.status === 'matured', JSON.stringify(shortPocketAfter));

    // ---- Control: a genuinely still-active pocket keeps its existing pre-maturity behavior ----
    const { data: activeWithdrawal, error: activeErr } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: genuinelyActivePocket.id, method: 'bank', destinationDetails: { bankName: 'X', accountNumber: '3' } } });
    check('a genuinely still-active pocket (real future maturity_date) is unaffected by the fix', !activeErr, activeErr && activeErr.message);
    check('it still correctly forfeits interest (receiveAmount = principal only, 6000)', activeWithdrawal && activeWithdrawal.forfeit === true && activeWithdrawal.receiveAmount === 6000, JSON.stringify(activeWithdrawal));

    const { data: activePocketAfter } = await admin.from('hys_pockets').select('status').eq('id', genuinelyActivePocket.id).single();
    check('the genuinely still-active pocket’s stored status is untouched, still "active" (no false self-heal)', activePocketAfter && activePocketAfter.status === 'active', JSON.stringify(activePocketAfter));

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 5 — approve-hys-withdrawal: re-validation against the pocket's CURRENT state at
  // approval time, and the symmetric external-payout behavior (account_state never touched).
  // ===========================================================================================
  console.log('\n5. approve-hys-withdrawal — re-validation at approval time + symmetric external payout');

  await (async function () {
    const email = 'hyswd-approve-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { data: pocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'ayw', amount: 2500, status: 'active',
      funding_method: 'bank account', projected_interest: 0
    }).select().single();

    const { data: request } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: pocket.id, method: 'bank', destinationDetails: { bankName: 'Y', accountNumber: '9' } } });
    check('withdrawal request created for the approve test', !!request, JSON.stringify(request));

    const { data: approved, error: approveErr } = await adminSignIn.client.functions.invoke('approve-hys-withdrawal', { body: { requestId: request.id } });
    check('approve-hys-withdrawal succeeds', !approveErr, approveErr && approveErr.message);
    check('approved request status is "approved" with a real transactionId', approved && approved.status === 'approved' && !!approved.transactionId);

    const { data: pocketAfter } = await admin.from('hys_pockets').select('*').eq('id', pocket.id).single();
    check('the pocket is now marked withdrawn with the correct withdrawn_amount', pocketAfter.status === 'withdrawn' && pocketAfter.withdrawn_amount === 2500, JSON.stringify(pocketAfter));
    check('withdrawal_method reflects "bank account" for a bank-method withdrawal', pocketAfter.withdrawal_method === 'bank account');

    const { data: txn } = await admin.from('transactions').select('*').eq('id', approved.transactionId).single();
    check('the linked transaction is a real HYS_WITHDRAWAL row with total_value = receiveAmount, realized_return null', txn.type === 'HYS_WITHDRAWAL' && txn.total_value === 2500 && txn.realized_return === null, JSON.stringify(txn));

    // THE symmetric-external-payout property — account_state is never touched, exactly
    // mirroring credit-hys-deposit's own never-touches-account_state behavior.
    const { data: accountRows } = await admin.from('account_state').select('*').eq('client_id', user.id);
    check('approve-hys-withdrawal never creates/touches an account_state row (symmetric with credit-hys-deposit)', accountRows.length === 0, JSON.stringify(accountRows));

    // Double-approve refused.
    const { error: doubleApproveErr } = await adminSignIn.client.functions.invoke('approve-hys-withdrawal', { body: { requestId: request.id } });
    check('approve-hys-withdrawal refuses to re-approve an already-resolved request (409)', doubleApproveErr && doubleApproveErr.context && doubleApproveErr.context.status === 409);

    // ---- THE re-validation-at-approval-time edge case: a pocket that was independently
    // withdrawn (e.g. via another resolved request) between request time and approval time
    // must correctly fail approval, not silently double-withdraw it.
    const { data: pocket2 } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'ayw', amount: 800, status: 'active',
      funding_method: 'bank account', projected_interest: 0
    }).select().single();
    const { data: request2 } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: pocket2.id, method: 'bank', destinationDetails: { bankName: 'Z', accountNumber: '1' } } });
    // Simulate the pocket having been withdrawn out from under this pending request by some
    // other real path, between request time and approval time.
    await admin.from('hys_pockets').update({ status: 'withdrawn', withdrawn_at: new Date().toISOString(), withdrawn_amount: 800, withdrawal_method: 'bank account' }).eq('id', pocket2.id);

    const { error: staleApproveErr } = await adminSignIn.client.functions.invoke('approve-hys-withdrawal', { body: { requestId: request2.id } });
    check('approving a request whose pocket was ALREADY withdrawn in the meantime correctly fails (409), re-validated at approval time', staleApproveErr && staleApproveErr.context && staleApproveErr.context.status === 409, staleApproveErr && staleApproveErr.message);
    const { data: request2StillPending } = await admin.from('hys_withdrawal_requests').select('status').eq('id', request2.id).single();
    check('the second request remains pending, not silently marked approved', request2StillPending.status === 'pending');

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 6 — reject-hys-withdrawal: marks rejected with a reason, moves nothing.
  // ===========================================================================================
  console.log('\n6. reject-hys-withdrawal — marks rejected with a reason, moves nothing');

  await (async function () {
    const email = 'hyswd-reject-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { data: pocket } = await admin.from('hys_pockets').insert({
      client_id: user.id, pocket_type: 'ayw', amount: 1200, status: 'active',
      funding_method: 'crypto wallet', projected_interest: 0
    }).select().single();
    const { data: request } = await clientSignIn.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: pocket.id, method: 'crypto', destinationDetails: { asset: 'BTC', walletAddress: '1TestAddr' } } });

    const { data: rejected, error: rejectErr } = await adminSignIn.client.functions.invoke('reject-hys-withdrawal', { body: { requestId: request.id, reason: 'Destination wallet could not be verified.' } });
    check('reject-hys-withdrawal succeeds', !rejectErr, rejectErr && rejectErr.message);
    check('rejected withdrawal status is "rejected" with the reason preserved', rejected && rejected.status === 'rejected' && rejected.reason === 'Destination wallet could not be verified.');

    const { data: pocketUnchanged } = await admin.from('hys_pockets').select('status').eq('id', pocket.id).single();
    check('a rejected HYS withdrawal leaves the pocket genuinely still active', pocketUnchanged.status === 'active');
    check('a rejected HYS withdrawal never creates a transaction', (await admin.from('transactions').select('*').eq('client_id', user.id)).data.length === 0);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 7 — Cross-client isolation across all 3 new tables, same byte-for-byte diff standard
  // as every prior stage.
  // ===========================================================================================
  console.log('\n7. Cross-client isolation across hys_pockets, hys_deposit_requests, hys_withdrawal_requests');

  await (async function () {
    const emailA = 'isoA-hys-' + suffix + '@test.marketswave.local';
    const emailB = 'isoB-hys-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    const clientSignInA = await signIn(url, anonKey, emailA, password);
    const clientSignInB = await signIn(url, anonKey, emailB, password);

    // B has its own real pocket/activity so the isolation check below isn't vacuous.
    const { data: pocketB } = await admin.from('hys_pockets').insert({
      client_id: userB.id, pocket_type: 'ayw', amount: 400, status: 'active',
      funding_method: 'bank account', projected_interest: 0
    }).select().single();

    const beforeBPockets = JSON.stringify(await admin.from('hys_pockets').select('*').eq('client_id', userB.id));
    const beforeBDeposits = JSON.stringify(await admin.from('hys_deposit_requests').select('*').eq('client_id', userB.id));
    const beforeBWithdrawals = JSON.stringify(await admin.from('hys_withdrawal_requests').select('*').eq('client_id', userB.id));
    const beforeBTxns = JSON.stringify(await admin.from('transactions').select('*').eq('client_id', userB.id));

    // Client A does a full round of real activity: a credited HYS deposit and an approved HYS
    // withdrawal.
    const { data: depA } = await clientSignInA.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: 3000, method: 'bank' } });
    const { data: creditedA } = await adminSignIn.client.functions.invoke('credit-hys-deposit', { body: { requestId: depA.id, confirmedAmount: 3000 } });
    const { data: wdReqA } = await clientSignInA.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: creditedA.pocketId, method: 'bank', destinationDetails: { bankName: 'A', accountNumber: '1' } } });
    await adminSignIn.client.functions.invoke('approve-hys-withdrawal', { body: { requestId: wdReqA.id } });
    // B independently also has activity of its own.
    const { data: depB } = await clientSignInB.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: 750, method: 'crypto', details: { asset: 'BTC' } } });

    const afterBPockets = JSON.stringify(await admin.from('hys_pockets').select('*').eq('client_id', userB.id));
    const afterBDeposits = JSON.stringify(await admin.from('hys_deposit_requests').select('*').eq('client_id', userB.id));
    const afterBWithdrawals = JSON.stringify(await admin.from('hys_withdrawal_requests').select('*').eq('client_id', userB.id));
    const afterBTxns = JSON.stringify(await admin.from('transactions').select('*').eq('client_id', userB.id));

    check('Client B’s hys_pockets are byte-for-byte unchanged after Client A’s full deposit+withdrawal activity', beforeBPockets === afterBPockets);
    check('Client B’s hys_withdrawal_requests are byte-for-byte unchanged (B never withdrew)', beforeBWithdrawals === afterBWithdrawals);
    check('Client B’s transactions are byte-for-byte unchanged by Client A’s activity', beforeBTxns === afterBTxns);
    check('Client B’s own deposit request genuinely exists and is scoped to B, not mixed into A’s data', depB && depB.clientId === userB.id);
    check('beforeBDeposits differs from afterBDeposits only via B’s OWN request (not A’s)', JSON.parse(afterBDeposits).data.length === JSON.parse(beforeBDeposits).data.length + 1);

    const { data: aPockets } = await admin.from('hys_pockets').select('*').eq('client_id', userA.id);
    check('Client A’s own hys_pockets DID genuinely change (the isolation check above is not vacuous)', aPockets.length >= 1 && aPockets[0].status === 'withdrawn', JSON.stringify(aPockets));

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // TEST 8 — RLS — full matrix, zero client-side write path outside the Edge Functions, on
  // all 3 new tables, for every role including admin.
  // ===========================================================================================
  console.log('\n8. RLS — full matrix, zero client-side write path outside the Edge Functions');

  await (async function () {
    const emailA = 'rlsA-hys-' + suffix + '@test.marketswave.local';
    const emailB = 'rlsB-hys-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);

    const { data: pocketA } = await admin.from('hys_pockets').insert({
      client_id: userA.id, pocket_type: 'ayw', amount: 500, status: 'active',
      funding_method: 'bank account', projected_interest: 0
    }).select().single();
    await admin.from('hys_deposit_requests').insert({ client_id: userA.id, pocket_type: 'ayw', requested_amount: 100, method: 'bank', currency: 'USD', status: 'pending' });
    await admin.from('hys_withdrawal_requests').insert({ client_id: userA.id, pocket_id: pocketA.id, pocket_type: 'ayw', receive_amount: 100, forfeit: false, method: 'bank', status: 'pending' });

    const a = await signIn(url, anonKey, emailA, password);

    // ---- Self-reads succeed, cross-client reads return empty --------------------------------
    const { data: ownPockets } = await a.client.from('hys_pockets').select('*');
    check('Client A can SELECT their own hys_pockets', ownPockets && ownPockets.length === 1);
    const { data: ownDeposits } = await a.client.from('hys_deposit_requests').select('*');
    check('Client A can SELECT their own hys_deposit_requests', ownDeposits && ownDeposits.length === 1);
    const { data: ownWithdrawals } = await a.client.from('hys_withdrawal_requests').select('*');
    check('Client A can SELECT their own hys_withdrawal_requests', ownWithdrawals && ownWithdrawals.length === 1);
    const { data: crossPockets } = await a.client.from('hys_pockets').select('*').eq('client_id', userB.id);
    check('Client A’s query for Client B’s hys_pockets returns empty (RLS-filtered, not an error)', crossPockets && crossPockets.length === 0);

    // ---- hys_pockets: NO insert policy for the client at all, even a "genuinely own" one ----
    const { data: pocketInsertAttempt } = await a.client.from('hys_pockets').insert({ client_id: userA.id, pocket_type: 'ayw', amount: 999, status: 'active', funding_method: 'bank account', projected_interest: 0 }).select();
    check('Client A cannot INSERT a hys_pockets row directly at all — even a genuinely own one (pockets are created only via credit-hys-deposit)', !pocketInsertAttempt || pocketInsertAttempt.length === 0);

    // ---- hys_deposit_requests INSERT: only a genuinely own, genuinely pending row is allowed
    const { data: legitDepositInsert, error: legitDepositErr } = await a.client.from('hys_deposit_requests').insert({ client_id: userA.id, pocket_type: 'ayw', requested_amount: 50, method: 'bank', currency: 'USD', status: 'pending' }).select();
    check('Client A CAN directly insert their own genuinely-pending hys_deposit_requests row via RLS', legitDepositInsert && legitDepositInsert.length === 1, legitDepositErr && legitDepositErr.message);
    const { data: spoofClientDepositInsert } = await a.client.from('hys_deposit_requests').insert({ client_id: userB.id, pocket_type: 'ayw', requested_amount: 999, method: 'bank', currency: 'USD', status: 'pending' }).select();
    check('Client A cannot INSERT a hys_deposit_requests row under Client B’s client_id', !spoofClientDepositInsert || spoofClientDepositInsert.length === 0);
    const { data: spoofStatusDepositInsert } = await a.client.from('hys_deposit_requests').insert({ client_id: userA.id, pocket_type: 'ayw', requested_amount: 999, method: 'bank', currency: 'USD', status: 'credited' }).select();
    check('Client A cannot INSERT a hys_deposit_requests row with a non-pending status', !spoofStatusDepositInsert || spoofStatusDepositInsert.length === 0);

    // ---- hys_withdrawal_requests INSERT: same shape ----------------------------------------
    const { data: legitWithdrawalInsert, error: legitWithdrawalErr } = await a.client.from('hys_withdrawal_requests').insert({ client_id: userA.id, pocket_id: pocketA.id, pocket_type: 'ayw', receive_amount: 25, forfeit: false, method: 'bank', status: 'pending' }).select();
    check('Client A CAN directly insert their own genuinely-pending hys_withdrawal_requests row via RLS', legitWithdrawalInsert && legitWithdrawalInsert.length === 1, legitWithdrawalErr && legitWithdrawalErr.message);
    const { data: spoofStatusWithdrawalInsert } = await a.client.from('hys_withdrawal_requests').insert({ client_id: userA.id, pocket_id: pocketA.id, pocket_type: 'ayw', receive_amount: 999, forfeit: false, method: 'bank', status: 'approved' }).select();
    check('Client A cannot INSERT a hys_withdrawal_requests row with a non-pending status', !spoofStatusWithdrawalInsert || spoofStatusWithdrawalInsert.length === 0);

    // ---- No UPDATE/DELETE path for any role but service_role, on all 3 tables --------------
    const { data: pocketUpdateAttempt } = await a.client.from('hys_pockets').update({ status: 'withdrawn', withdrawn_amount: 999999 }).eq('id', pocketA.id).select();
    check('Client A cannot UPDATE their own hys_pockets row directly', !pocketUpdateAttempt || pocketUpdateAttempt.length === 0);
    const { data: pocketDeleteAttempt } = await a.client.from('hys_pockets').delete().eq('id', pocketA.id).select();
    check('Client A cannot DELETE their own hys_pockets row directly', !pocketDeleteAttempt || pocketDeleteAttempt.length === 0);
    const { data: depositUpdateAttempt } = await a.client.from('hys_deposit_requests').update({ status: 'credited', credited_amount: 999999 }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own hys_deposit_requests row directly', !depositUpdateAttempt || depositUpdateAttempt.length === 0);
    const { data: withdrawalUpdateAttempt } = await a.client.from('hys_withdrawal_requests').update({ status: 'approved' }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own hys_withdrawal_requests row directly', !withdrawalUpdateAttempt || withdrawalUpdateAttempt.length === 0);

    const { data: adminUpdateAttempt } = await adminSignIn.client.from('hys_pockets').update({ status: 'withdrawn' }).eq('id', pocketA.id).select();
    check('Even an admin-claimed caller (client-side) cannot write directly — only service_role, via the Edge Functions, can', !adminUpdateAttempt || adminUpdateAttempt.length === 0);
    const { data: adminReadsA } = await adminSignIn.client.from('hys_pockets').select('*').eq('client_id', userA.id);
    check('An admin-claimed caller CAN read Client A’s hys_pockets directly (self-or-admin SELECT policy)', adminReadsA && adminReadsA.length >= 1);

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonPockets } = await anonClient.from('hys_pockets').select('*');
    check('Unauthenticated (anon) caller sees zero hys_pockets rows', anonPockets && anonPockets.length === 0);
    const { data: anonDeposits } = await anonClient.from('hys_deposit_requests').select('*');
    check('Unauthenticated (anon) caller sees zero hys_deposit_requests rows', anonDeposits && anonDeposits.length === 0);

    // Confirmed genuinely unchanged after every denied attempt above.
    const { data: pocketStillOriginal } = await admin.from('hys_pockets').select('status,amount').eq('id', pocketA.id).single();
    check('hys_pockets row is genuinely still active/original after every denied write attempt', pocketStillOriginal.status === 'active' && pocketStillOriginal.amount === 500, 'got=' + JSON.stringify(pocketStillOriginal));

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // TEST 9 — Authorization negative cases: non-admin/unauthenticated callers of the 4
  // admin-only functions; unauthenticated callers of the 2 client-callable ones.
  // ===========================================================================================
  console.log('\n9. Authorization — non-admin and unauthenticated callers');

  await (async function () {
    const email = 'nonadmin-hys-test-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const nonAdmin = await signIn(url, anonKey, email, password);
    const { data: request } = await nonAdmin.client.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: 100, method: 'bank' } });

    const { data: pocket } = await admin.from('hys_pockets').insert({ client_id: user.id, pocket_type: 'ayw', amount: 100, status: 'active', funding_method: 'bank account', projected_interest: 0 }).select().single();
    const { data: wdRequest } = await nonAdmin.client.functions.invoke('request-hys-withdrawal', { body: { pocketId: pocket.id, method: 'bank', destinationDetails: { bankName: 'X', accountNumber: '1' } } });

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { error: creditNonAdminErr } = await nonAdmin.client.functions.invoke('credit-hys-deposit', { body: { requestId: request.id, confirmedAmount: 100 } });
    check('Non-admin caller cannot call credit-hys-deposit (403)', creditNonAdminErr && creditNonAdminErr.context && creditNonAdminErr.context.status === 403, creditNonAdminErr && creditNonAdminErr.message);
    const { error: rejectDepositNonAdminErr } = await nonAdmin.client.functions.invoke('reject-hys-deposit', { body: { requestId: request.id, reason: 'x' } });
    check('Non-admin caller cannot call reject-hys-deposit (403)', rejectDepositNonAdminErr && rejectDepositNonAdminErr.context && rejectDepositNonAdminErr.context.status === 403);
    const { error: approveWdNonAdminErr } = await nonAdmin.client.functions.invoke('approve-hys-withdrawal', { body: { requestId: wdRequest.id } });
    check('Non-admin caller cannot call approve-hys-withdrawal (403)', approveWdNonAdminErr && approveWdNonAdminErr.context && approveWdNonAdminErr.context.status === 403);
    const { error: rejectWdNonAdminErr } = await nonAdmin.client.functions.invoke('reject-hys-withdrawal', { body: { requestId: wdRequest.id, reason: 'x' } });
    check('Non-admin caller cannot call reject-hys-withdrawal (403)', rejectWdNonAdminErr && rejectWdNonAdminErr.context && rejectWdNonAdminErr.context.status === 403);

    const { error: anonDepositErr } = await anonClient.functions.invoke('request-hys-deposit', { body: { pocketType: 'ayw', amount: 100, method: 'bank' } });
    check('Unauthenticated caller cannot call request-hys-deposit (401)', anonDepositErr && anonDepositErr.context && anonDepositErr.context.status === 401, anonDepositErr && anonDepositErr.message);
    const { error: anonWithdrawalErr } = await anonClient.functions.invoke('request-hys-withdrawal', { body: { pocketId: pocket.id, method: 'bank' } });
    check('Unauthenticated caller cannot call request-hys-withdrawal (401)', anonWithdrawalErr && anonWithdrawalErr.context && anonWithdrawalErr.context.status === 401);
    const { error: anonCreditErr } = await anonClient.functions.invoke('credit-hys-deposit', { body: { requestId: request.id, confirmedAmount: 100 } });
    check('Unauthenticated caller cannot call credit-hys-deposit (401)', anonCreditErr && anonCreditErr.context && anonCreditErr.context.status === 401);

    // Confirm no state changed despite every denied attempt.
    const { data: stillPendingDeposit } = await admin.from('hys_deposit_requests').select('status').eq('id', request.id).single();
    check('The deposit request is genuinely still pending after every denied credit/reject attempt', stillPendingDeposit.status === 'pending', 'got=' + stillPendingDeposit.status);
    const { data: stillActivePocket } = await admin.from('hys_pockets').select('status').eq('id', pocket.id).single();
    check('The pocket is genuinely still active after every denied approve/reject attempt', stillActivePocket.status === 'active', 'got=' + stillActivePocket.status);

    await cleanupClient(admin, user.id);
  })();

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
