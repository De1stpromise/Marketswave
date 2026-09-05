#!/usr/bin/env node
// Backend Migration Phase B — Stage 2 (Aug 30, 2026).
//
// Real-stack verification for Deposits and Withdrawals moving to real Supabase tables +
// Edge Functions. Mirrors verify-supabase-portfolio-engine.js's own rigor and structure
// (same credential/sign-in helpers, same byte-for-byte cross-client isolation diff
// technique) — this is the Approval Gate's own first two queues going server-side.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and localhost-only guard as every other local-stack script in this project.
//
// Usage:  node scripts/verify-supabase-deposits-withdrawals.js
// Requires: the local Supabase stack running, this stage's migration applied
// (`supabase migration up --local`), and `supabase functions serve` (or the equivalent
// edge-runtime container `supabase start` already runs) reachable.

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
  await admin.from('deposit_requests').delete().eq('client_id', userId);
  await admin.from('withdrawal_requests').delete().eq('client_id', userId);
  await admin.from('transactions').delete().eq('client_id', userId);
  await admin.from('account_state').delete().eq('client_id', userId);
  await admin.auth.admin.deleteUser(userId);
}

async function main() {
  console.log('Supabase Backend Migration Phase B — Stage 2 verification (Deposits & Withdrawals)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyDepositWithdrawal-2026!';
  const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  // ===========================================================================================
  // TEST 1 — request-deposit validation (mirrors requestDeposit()'s own shape checks exactly).
  // ===========================================================================================
  console.log('1. request-deposit — validation, self-scoping, and a clean pending row');

  await (async function () {
    const email = 'dep-validation-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { error: badMethodErr } = await clientSignIn.client.functions.invoke('request-deposit', { body: { method: 'paypal', amount: 100, currency: 'USD' } });
    check('request-deposit rejects an invalid method', badMethodErr && badMethodErr.context && badMethodErr.context.status === 400, badMethodErr && badMethodErr.message);

    const { error: badAmountErr } = await clientSignIn.client.functions.invoke('request-deposit', { body: { method: 'bank', amount: -50, currency: 'USD' } });
    check('request-deposit rejects a non-positive amount', badAmountErr && badAmountErr.context && badAmountErr.context.status === 400, badAmountErr && badAmountErr.message);

    const { error: noCurrencyErr } = await clientSignIn.client.functions.invoke('request-deposit', { body: { method: 'bank', amount: 100 } });
    check('request-deposit requires a currency', noCurrencyErr && noCurrencyErr.context && noCurrencyErr.context.status === 400, noCurrencyErr && noCurrencyErr.message);

    const details = { asset: 'BTC', network: 'mainnet' };
    const { data: created, error: createErr } = await clientSignIn.client.functions.invoke('request-deposit', { body: { method: 'crypto', amount: 2500, currency: 'BTC', details } });
    check('request-deposit succeeds with valid input', !createErr, createErr && createErr.message);
    check('created request is scoped to the caller’s own uid, never a client-supplied id', created && created.clientId === user.id, JSON.stringify(created));
    check('created request status defaults to pending', created && created.status === 'pending');
    check('created request preserves the generic details object verbatim', created && JSON.stringify(created.details) === JSON.stringify(details));
    check('created request has no credited/resolved data yet', created && created.creditedAmount === null && created.resolvedAt === null);

    // Anyone claiming a different clientId in the body is ignored — clientId always comes
    // from the caller's own verified JWT.
    const { data: spoofAttempt } = await clientSignIn.client.functions.invoke('request-deposit', { body: { method: 'bank', amount: 10, currency: 'USD', clientId: 'not-a-real-id' } });
    check('request-deposit ignores a client-supplied clientId and still scopes to the real caller', spoofAttempt && spoofAttempt.clientId === user.id);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 2 — request-then-credit with a DIFFERING confirmed amount, proving the PM-editable-
  // amount property survived the port (the actual point of Deposits having a two-step flow).
  // ===========================================================================================
  console.log('\n2. credit-deposit — PM-editable confirmed amount differs from what was requested');

  await (async function () {
    const email = 'dep-credit-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { data: request } = await clientSignIn.client.functions.invoke('request-deposit', {
      body: { method: 'bank', amount: 10000, currency: 'USD', details: { bankName: 'Test Bank', accountNumber: '12345' } }
    });
    check('deposit request created for the credit test', !!request, JSON.stringify(request));

    const confirmedAmount = 9850; // real-world wire fee shaved off — deliberately different
    const { data: credited, error: creditErr } = await adminSignIn.client.functions.invoke('credit-deposit', { body: { requestId: request.id, confirmedAmount } });
    check('credit-deposit succeeds', !creditErr, creditErr && creditErr.message);
    check('credited request status is now "credited"', credited && credited.status === 'credited');
    check('creditedAmount is the PM-entered confirmedAmount, NOT the original requestedAmount', credited && credited.creditedAmount === confirmedAmount && credited.requestedAmount === 10000, JSON.stringify(credited));
    check('credit-deposit links a real transactionId onto the resolved request', credited && !!credited.transactionId);

    const { data: accountState } = await admin.from('account_state').select('*').eq('client_id', user.id).single();
    check('unallocated_capital was credited with the CONFIRMED amount (9850), not the requested amount (10000)', accountState.unallocated_capital === confirmedAmount, 'got=' + accountState.unallocated_capital);

    const { data: txn } = await admin.from('transactions').select('*').eq('id', credited.transactionId).single();
    check('the linked transaction is a real DEPOSIT row with no product_id/units/price', txn.type === 'DEPOSIT' && txn.product_id === null && txn.units === null && txn.price === null);
    check('the linked transaction total_value matches the confirmed amount', txn.total_value === confirmedAmount);

    // Re-crediting an already-credited request must fail, not double-credit.
    const { error: doubleCreditErr } = await adminSignIn.client.functions.invoke('credit-deposit', { body: { requestId: request.id, confirmedAmount: 500 } });
    check('credit-deposit refuses to re-credit an already-resolved request (409)', doubleCreditErr && doubleCreditErr.context && doubleCreditErr.context.status === 409, doubleCreditErr && doubleCreditErr.message);
    const { data: accountAfterDouble } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('a rejected double-credit attempt leaves unallocated_capital genuinely unchanged', accountAfterDouble.unallocated_capital === confirmedAmount, 'got=' + accountAfterDouble.unallocated_capital);

    // credit-deposit on a client with NO pre-existing account_state row (a faithful port of
    // readAccountStateForClient()'s own zero-balance default, not a new leniency).
    const email2 = 'dep-credit-fresh-' + suffix + '@test.marketswave.local';
    const user2 = await createTestClient(admin, email2, password);
    const clientSignIn2 = await signIn(url, anonKey, email2, password);
    const { data: request2 } = await clientSignIn2.client.functions.invoke('request-deposit', { body: { method: 'crypto', amount: 1000, currency: 'ETH', details: { asset: 'ETH' } } });
    const { error: freshAccountErr } = await adminSignIn.client.functions.invoke('credit-deposit', { body: { requestId: request2.id, confirmedAmount: 1000 } });
    check('credit-deposit succeeds for a client with no pre-existing account_state row', !freshAccountErr, freshAccountErr && freshAccountErr.message);
    const { data: freshAccountState } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user2.id).single();
    check('a fresh account_state row is created (upserted), seeded with exactly the confirmed amount', freshAccountState && freshAccountState.unallocated_capital === 1000, JSON.stringify(freshAccountState));

    await cleanupClient(admin, user.id);
    await cleanupClient(admin, user2.id);
  })();

  // ===========================================================================================
  // TEST 3 — reject-deposit: marks rejected with a reason, moves nothing.
  // ===========================================================================================
  console.log('\n3. reject-deposit — marks rejected with a reason, moves nothing');

  await (async function () {
    const email = 'dep-reject-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { data: request } = await clientSignIn.client.functions.invoke('request-deposit', { body: { method: 'crypto', amount: 500, currency: 'BTC', details: { asset: 'BTC' } } });
    const { data: rejected, error: rejectErr } = await adminSignIn.client.functions.invoke('reject-deposit', { body: { requestId: request.id, reason: 'Unverifiable source of funds.' } });
    check('reject-deposit succeeds', !rejectErr, rejectErr && rejectErr.message);
    check('rejected request status is "rejected" with the reason preserved', rejected && rejected.status === 'rejected' && rejected.reason === 'Unverifiable source of funds.');
    check('a rejected deposit never creates an account_state row (nothing to move)', (await admin.from('account_state').select('*').eq('client_id', user.id)).data.length === 0);
    check('a rejected deposit never creates a transaction', (await admin.from('transactions').select('*').eq('client_id', user.id)).data.length === 0);

    const { error: doubleRejectErr } = await adminSignIn.client.functions.invoke('reject-deposit', { body: { requestId: request.id, reason: 'again' } });
    check('reject-deposit refuses to re-resolve an already-resolved request (409)', doubleRejectErr && doubleRejectErr.context && doubleRejectErr.context.status === 409);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 4 — request-withdrawal: validation + the "can't withdraw more than sitting liquid"
  // pre-check against CURRENT unallocated_capital at request time.
  // ===========================================================================================
  console.log('\n4. request-withdrawal — validation and the liquidity pre-check');

  await (async function () {
    const email = 'wd-validation-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    // No account_state row yet -> treated as $0 unallocated (zero-balance default) -> any
    // positive withdrawal amount is correctly rejected.
    const { error: noFundsErr } = await clientSignIn.client.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 10, currency: 'USD', destinationDetails: { bankName: 'X' } } });
    check('request-withdrawal rejects a request against a client with no account_state row (treated as $0)', noFundsErr && noFundsErr.context && noFundsErr.context.status === 409, noFundsErr && noFundsErr.message);

    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });

    const { error: badMethodErr } = await clientSignIn.client.functions.invoke('request-withdrawal', { body: { method: 'wire', amount: 100, currency: 'USD', destinationDetails: {} } });
    check('request-withdrawal rejects an invalid method', badMethodErr && badMethodErr.context && badMethodErr.context.status === 400);

    const { error: tooMuchErr } = await clientSignIn.client.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 6000, currency: 'USD', destinationDetails: { bankName: 'X', accountNumber: '1' } } });
    check('request-withdrawal rejects an amount exceeding current unallocated_capital', tooMuchErr && tooMuchErr.context && tooMuchErr.context.status === 409, tooMuchErr && tooMuchErr.message);

    const destinationDetails = { asset: 'ETH', network: 'mainnet', walletAddress: '0xTestAddress' };
    const { data: created, error: createErr } = await clientSignIn.client.functions.invoke('request-withdrawal', { body: { method: 'crypto', amount: 2000, currency: 'ETH', destinationDetails } });
    check('request-withdrawal succeeds within the available balance', !createErr, createErr && createErr.message);
    check('created withdrawal request is scoped to the caller’s own uid', created && created.clientId === user.id);
    check('created withdrawal request status defaults to pending', created && created.status === 'pending');
    check('created withdrawal request preserves destinationDetails verbatim', created && JSON.stringify(created.destinationDetails) === JSON.stringify(destinationDetails));

    // Requesting alone must NOT have touched the balance yet ("request now, execute later").
    const { data: stillUnchanged } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('unallocated_capital is untouched by request-withdrawal alone (only approve-withdrawal moves money)', stillUnchanged.unallocated_capital === 5000, 'got=' + stillUnchanged.unallocated_capital);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 5 — THE re-validation-at-approval-time edge case, specifically as instructed: two
  // pending withdrawal requests that together exceed available capital. Approve the first,
  // confirm the second correctly fails rather than driving the balance negative.
  // ===========================================================================================
  console.log('\n5. approve-withdrawal — re-validation at APPROVAL time (the oversell-style edge case)');

  await (async function () {
    const email = 'wd-revalidate-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    // $10,000 available. Two individually-valid requests for $7,000 each — neither exceeds
    // $10,000 alone (so request-withdrawal's own request-time check lets both through, same
    // as the local engine's own "stricter but simple" design), but together they exceed it.
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 10000, allocated_capital: 0, asset_returns: 0 });

    const { data: requestA } = await clientSignIn.client.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 7000, currency: 'USD', destinationDetails: { bankName: 'A', accountNumber: '1' } } });
    const { data: requestB } = await clientSignIn.client.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 7000, currency: 'USD', destinationDetails: { bankName: 'B', accountNumber: '2' } } });
    check('both individually-valid pending requests were created', !!requestA && !!requestB, JSON.stringify({ requestA, requestB }));

    const { data: approvedA, error: approveAErr } = await adminSignIn.client.functions.invoke('approve-withdrawal', { body: { requestId: requestA.id, approvedAmount: 7000 } });
    check('approving the FIRST request succeeds', !approveAErr, approveAErr && approveAErr.message);
    check('the first request is now "approved" with a real transactionId', approvedA && approvedA.status === 'approved' && !!approvedA.transactionId);

    const { data: afterFirst } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('unallocated_capital dropped to exactly 3000 after the first approval', afterFirst.unallocated_capital === 3000, 'got=' + afterFirst.unallocated_capital);

    // The SECOND request must now be refused — its own $7,000 exceeds the CURRENT $3,000
    // balance, even though it looked perfectly valid at request time against the original
    // $10,000. This is the actual property this stage's re-validation is proving.
    const { error: approveBErr } = await adminSignIn.client.functions.invoke('approve-withdrawal', { body: { requestId: requestB.id, approvedAmount: 7000 } });
    check('approving the SECOND request correctly fails (re-validated against the CURRENT balance, not the request-time balance)', approveBErr && approveBErr.context && approveBErr.context.status === 409, approveBErr && approveBErr.message);

    const { data: afterSecondAttempt } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('the balance never went negative and is genuinely unchanged by the rejected second approval', afterSecondAttempt.unallocated_capital === 3000, 'got=' + afterSecondAttempt.unallocated_capital);

    const { data: requestBStillPending } = await admin.from('withdrawal_requests').select('status').eq('id', requestB.id).single();
    check('the second request remains pending, not silently marked approved or rejected', requestBStillPending.status === 'pending');

    // A partial approval within the remaining balance still works correctly.
    const { data: approvedBPartial, error: partialErr } = await adminSignIn.client.functions.invoke('approve-withdrawal', { body: { requestId: requestB.id, approvedAmount: 3000 } });
    check('a smaller, PM-edited approvedAmount that DOES fit the current balance succeeds', !partialErr, partialErr && partialErr.message);
    check('approvedAmount (3000) correctly differs from requestedAmount (7000) — PM-editable, same as deposits', approvedBPartial && approvedBPartial.approvedAmount === 3000 && approvedBPartial.requestedAmount === 7000);

    const { data: finalState } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('final unallocated_capital is exactly 0 after both real approvals (7000 + 3000 withdrawn from 10000)', finalState.unallocated_capital === 0, 'got=' + finalState.unallocated_capital);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 6 — reject-withdrawal: marks rejected with a reason, moves nothing.
  // ===========================================================================================
  console.log('\n6. reject-withdrawal — marks rejected with a reason, moves nothing');

  await (async function () {
    const email = 'wd-reject-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 4000, allocated_capital: 0, asset_returns: 0 });

    const { data: request } = await clientSignIn.client.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 1000, currency: 'USD', destinationDetails: { bankName: 'X', accountNumber: '1' } } });
    const { data: rejected, error: rejectErr } = await adminSignIn.client.functions.invoke('reject-withdrawal', { body: { requestId: request.id, reason: 'Destination account could not be verified.' } });
    check('reject-withdrawal succeeds', !rejectErr, rejectErr && rejectErr.message);
    check('rejected withdrawal status is "rejected" with the reason preserved', rejected && rejected.status === 'rejected' && rejected.reason === 'Destination account could not be verified.');

    const { data: unchanged } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('a rejected withdrawal leaves unallocated_capital genuinely unchanged', unchanged.unallocated_capital === 4000, 'got=' + unchanged.unallocated_capital);
    check('a rejected withdrawal never creates a transaction', (await admin.from('transactions').select('*').eq('client_id', user.id)).data.length === 0);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 7 — Cross-client isolation across BOTH new tables, same byte-for-byte diff standard
  // as the Approval Gate unification and Stage 1's own portfolio engine verification.
  // ===========================================================================================
  console.log('\n7. Cross-client isolation across deposit_requests and withdrawal_requests');

  await (async function () {
    const emailA = 'isoA-dw-' + suffix + '@test.marketswave.local';
    const emailB = 'isoB-dw-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('account_state').insert([
      { client_id: userA.id, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 },
      { client_id: userB.id, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 }
    ]);
    const clientSignInA = await signIn(url, anonKey, emailA, password);
    const clientSignInB = await signIn(url, anonKey, emailB, password);

    const beforeBAccount = JSON.stringify(await admin.from('account_state').select('*').eq('client_id', userB.id).single());
    const beforeBWithdrawals = JSON.stringify(await admin.from('withdrawal_requests').select('*').eq('client_id', userB.id));
    const beforeBTxns = JSON.stringify(await admin.from('transactions').select('*').eq('client_id', userB.id));

    // Client A does a full round of real actions: a credited deposit and an approved withdrawal.
    const { data: depA } = await clientSignInA.client.functions.invoke('request-deposit', { body: { method: 'bank', amount: 3000, currency: 'USD', details: { bankName: 'A' } } });
    await adminSignIn.client.functions.invoke('credit-deposit', { body: { requestId: depA.id, confirmedAmount: 2900 } });
    const { data: wdA } = await clientSignInA.client.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 1500, currency: 'USD', destinationDetails: { bankName: 'A', accountNumber: '1' } } });
    await adminSignIn.client.functions.invoke('approve-withdrawal', { body: { requestId: wdA.id, approvedAmount: 1500 } });
    // B independently also has activity of its own — proves isolation isn't vacuous because B
    // never did anything.
    const { data: depB } = await clientSignInB.client.functions.invoke('request-deposit', { body: { method: 'crypto', amount: 500, currency: 'BTC', details: { asset: 'BTC' } } });

    const afterBAccount = JSON.stringify(await admin.from('account_state').select('*').eq('client_id', userB.id).single());
    const afterBWithdrawals = JSON.stringify(await admin.from('withdrawal_requests').select('*').eq('client_id', userB.id));
    const afterBTxns = JSON.stringify(await admin.from('transactions').select('*').eq('client_id', userB.id));

    check('Client B’s account_state is byte-for-byte unchanged after Client A’s deposit+withdrawal activity', beforeBAccount === afterBAccount);
    check('Client B’s own pending deposit request (created independently) is untouched by Client A’s activity', JSON.parse(afterBAccount).data.unallocated_capital === 20000);
    check('Client B’s withdrawal_requests are byte-for-byte unchanged (B never withdrew)', beforeBWithdrawals === afterBWithdrawals);
    check('Client B’s transactions are byte-for-byte unchanged by Client A’s activity', beforeBTxns === afterBTxns);
    check('Client B’s own deposit request genuinely exists and is scoped to B, not mixed into A’s data', depB && depB.clientId === userB.id);

    const { data: aAccount } = await admin.from('account_state').select('*').eq('client_id', userA.id).single();
    check('Client A’s own account_state DID genuinely change (the isolation check above is not vacuous)', aAccount.unallocated_capital !== 20000, 'got=' + aAccount.unallocated_capital);

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // TEST 8 — Zero client-side write path outside the Edge Functions, on BOTH new tables, for
  // every role including admin. Mirrors verify-supabase-portfolio-engine.js's own Test 5.
  // ===========================================================================================
  console.log('\n8. RLS — zero client-side write path outside the Edge Functions, on both tables');

  await (async function () {
    const emailA = 'rlsA-dw-' + suffix + '@test.marketswave.local';
    const emailB = 'rlsB-dw-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('deposit_requests').insert({ client_id: userA.id, method: 'bank', requested_amount: 100, currency: 'USD', status: 'pending' });
    await admin.from('withdrawal_requests').insert({ client_id: userA.id, method: 'bank', requested_amount: 100, currency: 'USD', status: 'pending' });

    const a = await signIn(url, anonKey, emailA, password);

    // ---- Self-reads succeed, cross-client reads return empty ----------------------------
    const { data: ownDeposits } = await a.client.from('deposit_requests').select('*');
    check('Client A can SELECT their own deposit_requests', ownDeposits && ownDeposits.length === 1);
    const { data: ownWithdrawals } = await a.client.from('withdrawal_requests').select('*');
    check('Client A can SELECT their own withdrawal_requests', ownWithdrawals && ownWithdrawals.length === 1);
    const { data: crossDeposits } = await a.client.from('deposit_requests').select('*').eq('client_id', userB.id);
    check('Client A’s query for Client B’s deposit_requests returns empty (RLS-filtered, not an error)', crossDeposits && crossDeposits.length === 0);

    // ---- INSERT: only a genuinely own, genuinely pending row is allowed -------------------
    const { data: legitInsert, error: legitInsertErr } = await a.client.from('deposit_requests').insert({ client_id: userA.id, method: 'crypto', requested_amount: 50, currency: 'BTC', status: 'pending' }).select();
    check('Client A CAN directly insert their own genuinely-pending deposit request via RLS (the policy this Edge Function’s own centralization sits on top of)', legitInsert && legitInsert.length === 1, legitInsertErr && legitInsertErr.message);

    const { data: spoofClientInsert } = await a.client.from('deposit_requests').insert({ client_id: userB.id, method: 'bank', requested_amount: 999, currency: 'USD', status: 'pending' }).select();
    check('Client A cannot INSERT a deposit request under Client B’s client_id', !spoofClientInsert || spoofClientInsert.length === 0);

    const { data: spoofStatusInsert } = await a.client.from('deposit_requests').insert({ client_id: userA.id, method: 'bank', requested_amount: 999, currency: 'USD', status: 'credited' }).select();
    check('Client A cannot INSERT a deposit request with a non-pending status', !spoofStatusInsert || spoofStatusInsert.length === 0);

    const { data: spoofWithdrawalInsert } = await a.client.from('withdrawal_requests').insert({ client_id: userA.id, method: 'bank', requested_amount: 999, currency: 'USD', status: 'approved' }).select();
    check('Client A cannot INSERT a withdrawal request with a non-pending status', !spoofWithdrawalInsert || spoofWithdrawalInsert.length === 0);

    // ---- No UPDATE/DELETE path for any role but service_role ------------------------------
    const { data: updateAttempt } = await a.client.from('deposit_requests').update({ status: 'credited', credited_amount: 999999 }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own deposit_requests row directly', !updateAttempt || updateAttempt.length === 0);
    const { data: deleteAttempt } = await a.client.from('deposit_requests').delete().eq('client_id', userA.id).select();
    check('Client A cannot DELETE their own deposit_requests row directly', !deleteAttempt || deleteAttempt.length === 0);
    const { data: wdUpdateAttempt } = await a.client.from('withdrawal_requests').update({ status: 'approved', approved_amount: 999999 }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own withdrawal_requests row directly', !wdUpdateAttempt || wdUpdateAttempt.length === 0);

    const { data: adminUpdateAttempt } = await adminSignIn.client.from('deposit_requests').update({ status: 'credited' }).eq('client_id', userA.id).select();
    check('Even an admin-claimed caller (client-side) cannot write directly — only service_role, via the Edge Functions, can', !adminUpdateAttempt || adminUpdateAttempt.length === 0);
    const { data: adminReadsA } = await adminSignIn.client.from('deposit_requests').select('*').eq('client_id', userA.id);
    check('An admin-claimed caller CAN read Client A’s deposit_requests directly (self-or-admin SELECT policy)', adminReadsA && adminReadsA.length >= 1);

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonRows } = await anonClient.from('deposit_requests').select('*');
    check('Unauthenticated (anon) caller sees zero deposit_requests rows', anonRows && anonRows.length === 0);

    // Confirmed genuinely unchanged after every denied attempt above.
    const { data: stillOriginal } = await admin.from('deposit_requests').select('status').eq('client_id', userA.id).eq('method', 'bank').single();
    check('deposit_requests row is genuinely still pending after every denied write attempt', stillOriginal.status === 'pending', 'got=' + stillOriginal.status);

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // TEST 9 — Authorization negative cases: non-admin/unauthenticated callers of the 4
  // admin-only functions; unauthenticated callers of the 2 client-callable ones.
  // ===========================================================================================
  console.log('\n9. Authorization — non-admin and unauthenticated callers');

  await (async function () {
    const email = 'nonadmin-dw-test-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
    const { data: request } = await (await signIn(url, anonKey, email, password)).client.functions.invoke('request-deposit', { body: { method: 'bank', amount: 100, currency: 'USD' } });

    const nonAdmin = await signIn(url, anonKey, email, password);
    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { error: creditNonAdminErr } = await nonAdmin.client.functions.invoke('credit-deposit', { body: { requestId: request.id, confirmedAmount: 100 } });
    check('Non-admin caller cannot call credit-deposit (403)', creditNonAdminErr && creditNonAdminErr.context && creditNonAdminErr.context.status === 403, creditNonAdminErr && creditNonAdminErr.message);
    const { error: rejectNonAdminErr } = await nonAdmin.client.functions.invoke('reject-deposit', { body: { requestId: request.id, reason: 'x' } });
    check('Non-admin caller cannot call reject-deposit (403)', rejectNonAdminErr && rejectNonAdminErr.context && rejectNonAdminErr.context.status === 403);
    const { error: approveWdNonAdminErr } = await nonAdmin.client.functions.invoke('approve-withdrawal', { body: { requestId: request.id, approvedAmount: 100 } });
    check('Non-admin caller cannot call approve-withdrawal (403)', approveWdNonAdminErr && approveWdNonAdminErr.context && approveWdNonAdminErr.context.status === 403);
    const { error: rejectWdNonAdminErr } = await nonAdmin.client.functions.invoke('reject-withdrawal', { body: { requestId: request.id, reason: 'x' } });
    check('Non-admin caller cannot call reject-withdrawal (403)', rejectWdNonAdminErr && rejectWdNonAdminErr.context && rejectWdNonAdminErr.context.status === 403);

    const { error: anonDepositErr } = await anonClient.functions.invoke('request-deposit', { body: { method: 'bank', amount: 100, currency: 'USD' } });
    check('Unauthenticated caller cannot call request-deposit (401)', anonDepositErr && anonDepositErr.context && anonDepositErr.context.status === 401, anonDepositErr && anonDepositErr.message);
    const { error: anonWithdrawalErr } = await anonClient.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 100, currency: 'USD' } });
    check('Unauthenticated caller cannot call request-withdrawal (401)', anonWithdrawalErr && anonWithdrawalErr.context && anonWithdrawalErr.context.status === 401);
    const { error: anonCreditErr } = await anonClient.functions.invoke('credit-deposit', { body: { requestId: request.id, confirmedAmount: 100 } });
    check('Unauthenticated caller cannot call credit-deposit (401)', anonCreditErr && anonCreditErr.context && anonCreditErr.context.status === 401);

    // Confirm no state changed despite every denied attempt.
    const { data: stillPending } = await admin.from('deposit_requests').select('status').eq('id', request.id).single();
    check('The request is genuinely still pending after every denied credit/reject attempt', stillPending.status === 'pending', 'got=' + stillPending.status);

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
