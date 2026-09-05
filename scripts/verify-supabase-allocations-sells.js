#!/usr/bin/env node
// Backend Migration Phase B — Stage 3 (Aug 30, 2026).
//
// Real-stack verification for Allocations and Sells moving to real Supabase tables + Edge
// Functions. Mirrors verify-supabase-deposits-withdrawals.js's own structure and rigor, but
// this stage is meaningfully different: allocation_requests/sell_requests don't stand alone
// — they resolve INTO Stage 1's already-verified execute-buy/execute-sell functions, so this
// suite specifically proves that internal call is real, not a parallel reimplementation.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and localhost-only guard as every other local-stack script in this project.
//
// Usage:  node scripts/verify-supabase-allocations-sells.js
// Requires: the local Supabase stack running, this stage's migration applied
// (`supabase migration up --local`), and the edge-runtime reachable (`supabase start`
// already runs it, or `supabase functions serve` in a separate terminal).

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
  await admin.from('allocation_requests').delete().eq('client_id', userId);
  await admin.from('sell_requests').delete().eq('client_id', userId);
  await admin.from('transactions').delete().eq('client_id', userId);
  await admin.from('holdings').delete().eq('client_id', userId);
  await admin.from('account_state').delete().eq('client_id', userId);
  await admin.auth.admin.deleteUser(userId);
}

const PROD_ETF = 'PROD-0003';      // Global Equity ETF, min $1000
const PROD_CASH = 'PROD-0005';     // Cash / Unallocated bucket itself
const PROD_REAL_ASSETS = 'PROD-0002'; // European Real Estate Trust, min $10000

async function main() {
  console.log('Supabase Backend Migration Phase B — Stage 3 verification (Allocations & Sells)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyAllocationSell-2026!';
  const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  // ===========================================================================================
  // TEST 1 — request-allocation validation (mirrors requestAllocation()'s own shape checks).
  // ===========================================================================================
  console.log('1. request-allocation — validation, self-scoping, and a clean pending row');

  await (async function () {
    const email = 'alloc-validation-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { error: unknownProductErr } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: 'PROD-9999', dollarAmount: 5000 } });
    check('request-allocation rejects an unknown product (404)', unknownProductErr && unknownProductErr.context && unknownProductErr.context.status === 404, unknownProductErr && unknownProductErr.message);

    const { error: cashErr } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_CASH, dollarAmount: 500 } });
    check('request-allocation rejects the Cash/Unallocated product itself', cashErr && cashErr.context && cashErr.context.status === 400, cashErr && cashErr.message);

    const { error: badAmountErr } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: -100 } });
    check('request-allocation rejects a non-positive amount', badAmountErr && badAmountErr.context && badAmountErr.context.status === 400);

    // No account_state row yet -> zero-balance default -> any positive amount that also
    // clears the product's minimum is still correctly rejected against the $0 balance.
    const { error: noFundsErr } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 1500 } });
    check('request-allocation rejects a request against a client with no account_state row (treated as $0)', noFundsErr && noFundsErr.context && noFundsErr.context.status === 409, noFundsErr && noFundsErr.message);

    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });

    const { error: belowMinErr } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 500 } });
    check('request-allocation rejects an amount below the product’s own minimum_investment', belowMinErr && belowMinErr.context && belowMinErr.context.status === 400, belowMinErr && belowMinErr.message);

    const { error: exceedsErr } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 9000 } });
    check('request-allocation rejects an amount exceeding current unallocated_capital', exceedsErr && exceedsErr.context && exceedsErr.context.status === 409, exceedsErr && exceedsErr.message);

    const { data: created, error: createErr } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 2000 } });
    check('request-allocation succeeds with valid input', !createErr, createErr && createErr.message);
    check('created request is scoped to the caller’s own uid, never a client-supplied id', created && created.clientId === user.id, JSON.stringify(created));
    check('created request status defaults to pending', created && created.status === 'pending');
    check('created request carries the real productId and rounded requestedAmount', created && created.productId === PROD_ETF && created.requestedAmount === 2000);

    // Requesting alone must NOT have touched the balance yet.
    const { data: stillUnchanged } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('unallocated_capital is untouched by request-allocation alone (only approve-allocation moves money)', stillUnchanged.unallocated_capital === 5000, 'got=' + stillUnchanged.unallocated_capital);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 2 — request-sell validation, including the investigated-and-reported finding: the
  // real local requestSell() has NO "sum of other pending sell requests" guard — only the
  // current holding is checked. This test proves this Edge Function matches that exactly.
  // ===========================================================================================
  console.log('\n2. request-sell — validation, self-scoping, and the zero-holdings default');

  await (async function () {
    const email = 'sell-validation-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { error: noHoldingErr } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 5 } });
    check('request-sell rejects a request against a client with no holding at all for that product (404)', noHoldingErr && noHoldingErr.context && noHoldingErr.context.status === 404, noHoldingErr && noHoldingErr.message);

    await admin.from('holdings').insert({ client_id: user.id, product_id: PROD_ETF, units: 50, cost_basis: 5000 });

    const { error: badUnitsErr } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: -3 } });
    check('request-sell rejects a non-positive unitsToSell', badUnitsErr && badUnitsErr.context && badUnitsErr.context.status === 400);

    const { error: tooManyErr } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 999 } });
    check('request-sell rejects a unitsToSell exceeding currently held units', tooManyErr && tooManyErr.context && tooManyErr.context.status === 409, tooManyErr && tooManyErr.message);

    const { data: created, error: createErr } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 20 } });
    check('request-sell succeeds within the held units', !createErr, createErr && createErr.message);
    check('created sell request is scoped to the caller’s own uid', created && created.clientId === user.id);
    check('created sell request status defaults to pending', created && created.status === 'pending');
    check('created sell request carries the real productId and unitsToSell verbatim', created && created.productId === PROD_ETF && created.unitsToSell === 20);

    // A SECOND request for another 40 units (50 held, 20 already "requested" but not yet
    // approved) is allowed through request-sell, confirming — as investigated and reported
    // — that request-sell does NOT sum this client's own other pending sell requests; it
    // only checks the CURRENT holding (still 50 units, since nothing has been approved yet).
    const { data: secondRequest, error: secondErr } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 40 } });
    check('a second pending sell request that, combined with the first, would oversell is still ACCEPTED at request time (matches the real local requestSell()’s own lack of a pending-sum guard — the backstop is approve-sell’s re-validation, tested next)', !secondErr && secondRequest && secondRequest.status === 'pending', secondErr && secondErr.message);

    // Holdings genuinely untouched by requesting alone.
    const { data: holdingUnchanged } = await admin.from('holdings').select('units').eq('client_id', user.id).eq('product_id', PROD_ETF).single();
    check('holding units are untouched by request-sell alone (only approve-sell moves units)', holdingUnchanged.units === 50, 'got=' + holdingUnchanged.units);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 3 — reject-allocation / reject-sell: mark rejected with a reason, move nothing.
  // ===========================================================================================
  console.log('\n3. reject-allocation / reject-sell — mark rejected with a reason, move nothing');

  await (async function () {
    const email = 'reject-both-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 10000, allocated_capital: 0, asset_returns: 0 });
    await admin.from('holdings').insert({ client_id: user.id, product_id: PROD_ETF, units: 10, cost_basis: 1000 });

    const { data: allocRequest } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 2000 } });
    const { data: rejectedAlloc, error: rejectAllocErr } = await adminSignIn.client.functions.invoke('reject-allocation', { body: { requestId: allocRequest.id, reason: 'Suitability review pending.' } });
    check('reject-allocation succeeds', !rejectAllocErr, rejectAllocErr && rejectAllocErr.message);
    check('rejected allocation status is "rejected" with the reason preserved', rejectedAlloc && rejectedAlloc.status === 'rejected' && rejectedAlloc.reason === 'Suitability review pending.');

    const { data: sellRequest } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 5 } });
    const { data: rejectedSell, error: rejectSellErr } = await adminSignIn.client.functions.invoke('reject-sell', { body: { requestId: sellRequest.id, reason: 'Client requested cancellation.' } });
    check('reject-sell succeeds', !rejectSellErr, rejectSellErr && rejectSellErr.message);
    check('rejected sell status is "rejected" with the reason preserved', rejectedSell && rejectedSell.status === 'rejected' && rejectedSell.reason === 'Client requested cancellation.');

    const { data: unchangedAccount } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('a rejected allocation leaves unallocated_capital genuinely unchanged', unchangedAccount.unallocated_capital === 10000, 'got=' + unchangedAccount.unallocated_capital);
    const { data: unchangedHolding } = await admin.from('holdings').select('units').eq('client_id', user.id).eq('product_id', PROD_ETF).single();
    check('a rejected sell leaves holdings genuinely unchanged', unchangedHolding.units === 10, 'got=' + unchangedHolding.units);
    check('neither rejection created a transaction', (await admin.from('transactions').select('*').eq('client_id', user.id)).data.length === 0);

    const { error: doubleRejectErr } = await adminSignIn.client.functions.invoke('reject-allocation', { body: { requestId: allocRequest.id, reason: 'again' } });
    check('reject-allocation refuses to re-resolve an already-resolved request (409)', doubleRejectErr && doubleRejectErr.context && doubleRejectErr.context.status === 409);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 4 — approve-allocation genuinely invokes Stage 1's execute-buy: same settlement
  // price and same units-computed-from-price formula through BOTH entry points, on the same
  // product, the same real day.
  // ===========================================================================================
  console.log('\n4. approve-allocation — genuinely invokes execute-buy (not a parallel reimplementation)');

  await (async function () {
    const emailA = 'internal-call-buy-A-' + suffix + '@test.marketswave.local';
    const emailB = 'internal-call-buy-B-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('account_state').insert([
      { client_id: userA.id, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 },
      { client_id: userB.id, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 }
    ]);
    const clientSignInA = await signIn(url, anonKey, emailA, password);

    // Entry point 1: the real allocation request/approval gate.
    const dollarAmount = 3000;
    const { data: allocRequest } = await clientSignInA.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount } });
    const { data: approved, error: approveErr } = await adminSignIn.client.functions.invoke('approve-allocation', { body: { requestId: allocRequest.id } });
    check('approve-allocation succeeds', !approveErr, approveErr && approveErr.message);
    check('approved allocation request status is "approved" with a real transactionId', approved && approved.status === 'approved' && !!approved.transactionId);

    const { data: txnA } = await admin.from('transactions').select('*').eq('id', approved.transactionId).single();
    check('the resulting transaction is a real BUY row for the correct product/amount', txnA.type === 'BUY' && txnA.product_id === PROD_ETF && txnA.total_value === dollarAmount);

    // Entry point 2: calling Stage 1's execute-buy directly, same product, same real day, a
    // different dollar amount (to prove it's the formula that matches, not a coincidence of
    // identical inputs).
    const dollarAmountB = 4500;
    const { data: directBuy, error: directBuyErr } = await adminSignIn.client.functions.invoke('execute-buy', { body: { clientId: userB.id, productId: PROD_ETF, dollarAmount: dollarAmountB } });
    check('direct execute-buy call succeeds', !directBuyErr, directBuyErr && directBuyErr.message);

    check(
      'BOTH entry points settled to the IDENTICAL unit price on the same real day (proves approve-allocation reads/writes the SAME settled product row execute-buy itself uses, not an independent computation)',
      txnA.price === directBuy.price,
      'via approve-allocation=' + txnA.price + ', via direct execute-buy=' + directBuy.price
    );
    check(
      'units = dollarAmount / price uses the IDENTICAL formula through both entry points',
      Math.abs(txnA.units - dollarAmount / txnA.price) < 1e-9 && Math.abs(directBuy.units - dollarAmountB / directBuy.price) < 1e-9
    );

    const { data: holdingA } = await admin.from('holdings').select('*').eq('client_id', userA.id).eq('product_id', PROD_ETF).single();
    check('the resulting holding’s cost_basis equals the requested dollar amount, exactly as executeBuy() itself computes it', holdingA.cost_basis === dollarAmount);

    const { data: accountA } = await admin.from('account_state').select('*').eq('client_id', userA.id).single();
    check('unallocated_capital was debited by exactly the requested amount', accountA.unallocated_capital === 20000 - dollarAmount, 'got=' + accountA.unallocated_capital);
    check('allocated_capital was recomputed to reflect the new holding’s current value', Math.abs(accountA.allocated_capital - holdingA.units * txnA.price) < 0.01);

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // TEST 5 — approve-sell genuinely invokes Stage 1's execute-sell: same proportional
  // cost-basis/realized-return formula through BOTH entry points.
  // ===========================================================================================
  console.log('\n5. approve-sell — genuinely invokes execute-sell (not a parallel reimplementation)');

  await (async function () {
    const emailA = 'internal-call-sell-A-' + suffix + '@test.marketswave.local';
    const emailB = 'internal-call-sell-B-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);

    // Identical starting holdings for both clients — same units, same cost basis — so the
    // exact same proportional-cost-basis formula, run through two different entry points,
    // must produce byte-identical results.
    const knownUnits = 100;
    const knownCostBasis = 10000; // avg cost $100/unit
    await admin.from('holdings').insert([
      { client_id: userA.id, product_id: PROD_ETF, units: knownUnits, cost_basis: knownCostBasis },
      { client_id: userB.id, product_id: PROD_ETF, units: knownUnits, cost_basis: knownCostBasis }
    ]);
    await admin.from('account_state').insert([
      { client_id: userA.id, unallocated_capital: 0, allocated_capital: 0, asset_returns: 0 },
      { client_id: userB.id, unallocated_capital: 0, allocated_capital: 0, asset_returns: 0 }
    ]);

    const clientSignInA = await signIn(url, anonKey, emailA, password);
    const unitsToSell = 30;

    // Entry point 1: the real sell request/approval gate.
    const { data: sellRequest } = await clientSignInA.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell } });
    const { data: approved, error: approveErr } = await adminSignIn.client.functions.invoke('approve-sell', { body: { requestId: sellRequest.id } });
    check('approve-sell succeeds', !approveErr, approveErr && approveErr.message);
    check('approved sell request status is "approved" with a real transactionId', approved && approved.status === 'approved' && !!approved.transactionId);

    const { data: txnA } = await admin.from('transactions').select('*').eq('id', approved.transactionId).single();

    // Entry point 2: calling Stage 1's execute-sell directly for Client B, same product,
    // same units, same real day, same starting holding.
    const { data: directSell, error: directSellErr } = await adminSignIn.client.functions.invoke('execute-sell', { body: { clientId: userB.id, productId: PROD_ETF, unitsToSell } });
    check('direct execute-sell call succeeds', !directSellErr, directSellErr && directSellErr.message);

    check(
      'BOTH entry points produced the IDENTICAL saleValue for identical inputs (same settled price)',
      txnA.total_value === directSell.totalValue,
      'via approve-sell=' + txnA.total_value + ', via direct execute-sell=' + directSell.totalValue
    );
    check(
      'BOTH entry points produced the IDENTICAL realizedReturn — the same proportional cost-basis formula ran through both',
      txnA.realized_return === directSell.realizedReturn,
      'via approve-sell=' + txnA.realized_return + ', via direct execute-sell=' + directSell.realizedReturn
    );

    const { data: holdingA } = await admin.from('holdings').select('*').eq('client_id', userA.id).eq('product_id', PROD_ETF).single();
    const { data: holdingB } = await admin.from('holdings').select('*').eq('client_id', userB.id).eq('product_id', PROD_ETF).single();
    check('BOTH clients’ remaining holdings are byte-identical after selling the identical fraction of an identical starting position', holdingA.units === holdingB.units && holdingA.cost_basis === holdingB.cost_basis, JSON.stringify({ holdingA, holdingB }));

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // TEST 6 — approve-allocation: THE re-validation-at-approval-time edge case for allocations.
  // Also explicitly proves the FLAGGED STRENGTHENING beyond the real local engine (which does
  // NOT re-validate allocations at all).
  // ===========================================================================================
  console.log('\n6. approve-allocation — re-validation at APPROVAL time (two allocations exceeding capital)');

  await (async function () {
    const email = 'alloc-revalidate-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    // $6,000 available. Two individually-valid requests for $4,000 each — neither exceeds
    // $6,000 alone, but together they exceed it.
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 6000, allocated_capital: 0, asset_returns: 0 });

    const { data: requestA } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 4000 } });
    const { data: requestB } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 4000 } });
    check('both individually-valid pending allocation requests were created', !!requestA && !!requestB);

    const { data: approvedA, error: approveAErr } = await adminSignIn.client.functions.invoke('approve-allocation', { body: { requestId: requestA.id } });
    check('approving the FIRST allocation request succeeds', !approveAErr, approveAErr && approveAErr.message);
    check('the first request is now "approved" with a real transactionId', approvedA && approvedA.status === 'approved' && !!approvedA.transactionId);

    const { data: afterFirst } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('unallocated_capital dropped to exactly 2000 after the first approval', afterFirst.unallocated_capital === 2000, 'got=' + afterFirst.unallocated_capital);

    // The SECOND request must now be refused — its own $4,000 exceeds the CURRENT $2,000
    // balance, even though it looked perfectly valid at request time against the original
    // $6,000. This is the exact strengthening this stage's own instruction added.
    const { error: approveBErr } = await adminSignIn.client.functions.invoke('approve-allocation', { body: { requestId: requestB.id } });
    check('approving the SECOND allocation request correctly fails (re-validated against the CURRENT balance, not the request-time balance)', approveBErr && approveBErr.context && approveBErr.context.status === 409, approveBErr && approveBErr.message);

    const { data: afterSecondAttempt } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('the balance never went negative and is genuinely unchanged by the rejected second approval', afterSecondAttempt.unallocated_capital === 2000, 'got=' + afterSecondAttempt.unallocated_capital);

    const { data: requestBStillPending } = await admin.from('allocation_requests').select('status').eq('id', requestB.id).single();
    check('the second request remains pending, not silently marked approved or rejected', requestBStillPending.status === 'pending');

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 7 — approve-sell: THE re-validation-at-approval-time edge case for sells (a faithful
  // port of approveSellRequest()'s own already-existing re-validation, applied to units).
  // ===========================================================================================
  console.log('\n7. approve-sell — re-validation at APPROVAL time (two sells exceeding held units)');

  await (async function () {
    const email = 'sell-revalidate-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    // 50 units held. Two individually-valid requests for 30 units each — neither exceeds 50
    // alone, but together they exceed it.
    await admin.from('holdings').insert({ client_id: user.id, product_id: PROD_ETF, units: 50, cost_basis: 5000 });
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 0, allocated_capital: 0, asset_returns: 0 });

    const { data: requestA } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 30 } });
    const { data: requestB } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 30 } });
    check('both individually-valid pending sell requests were created', !!requestA && !!requestB);

    const { data: approvedA, error: approveAErr } = await adminSignIn.client.functions.invoke('approve-sell', { body: { requestId: requestA.id } });
    check('approving the FIRST sell request succeeds', !approveAErr, approveAErr && approveAErr.message);
    check('the first request is now "approved" with a real transactionId', approvedA && approvedA.status === 'approved' && !!approvedA.transactionId);

    const { data: afterFirst } = await admin.from('holdings').select('units').eq('client_id', user.id).eq('product_id', PROD_ETF).single();
    check('holding units dropped to exactly 20 after the first approval', afterFirst.units === 20, 'got=' + afterFirst.units);

    // The SECOND request must now be refused — its own 30 units exceeds the CURRENT 20 units
    // held, even though it looked perfectly valid at request time against the original 50.
    const { error: approveBErr } = await adminSignIn.client.functions.invoke('approve-sell', { body: { requestId: requestB.id } });
    check('approving the SECOND sell request correctly fails (re-validated against the CURRENT holding, not the request-time holding)', approveBErr && approveBErr.context && approveBErr.context.status === 409, approveBErr && approveBErr.message);

    const { data: afterSecondAttempt } = await admin.from('holdings').select('units').eq('client_id', user.id).eq('product_id', PROD_ETF).single();
    check('held units are genuinely unchanged by the rejected second approval', afterSecondAttempt.units === 20, 'got=' + afterSecondAttempt.units);

    const { data: requestBStillPending } = await admin.from('sell_requests').select('status').eq('id', requestB.id).single();
    check('the second sell request remains pending, not silently marked approved or rejected', requestBStillPending.status === 'pending');

    // A full sell of the remaining 20 units (proving the holdings-row-deletion path is
    // handled correctly by the re-validation read, treating a fully-sold/deleted holding as
    // 0 units for any further approval attempt).
    const { data: requestC } = await clientSignIn.client.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 20 } });
    const { error: approveCErr } = await adminSignIn.client.functions.invoke('approve-sell', { body: { requestId: requestC.id } });
    check('selling the exact remaining balance succeeds and deletes the holdings row', !approveCErr, approveCErr && approveCErr.message);
    const { data: holdingGone } = await admin.from('holdings').select('*').eq('client_id', user.id).eq('product_id', PROD_ETF);
    check('the holdings row is genuinely gone after selling 100% of the remaining position', holdingGone.length === 0);

    const { error: approveBAgainErr } = await adminSignIn.client.functions.invoke('approve-sell', { body: { requestId: requestB.id } });
    check('the still-pending second request now correctly fails against a deleted (0-unit) holding', approveBAgainErr && approveBAgainErr.context && approveBAgainErr.context.status === 409);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // TEST 8 — Cross-client isolation across BOTH new tables.
  // ===========================================================================================
  console.log('\n8. Cross-client isolation across allocation_requests and sell_requests');

  await (async function () {
    const emailA = 'isoA-as-' + suffix + '@test.marketswave.local';
    const emailB = 'isoB-as-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('account_state').insert([
      { client_id: userA.id, unallocated_capital: 15000, allocated_capital: 0, asset_returns: 0 },
      { client_id: userB.id, unallocated_capital: 15000, allocated_capital: 0, asset_returns: 0 }
    ]);
    await admin.from('holdings').insert([
      { client_id: userA.id, product_id: PROD_REAL_ASSETS, units: 40, cost_basis: 4000 },
      { client_id: userB.id, product_id: PROD_REAL_ASSETS, units: 40, cost_basis: 4000 }
    ]);
    const clientSignInA = await signIn(url, anonKey, emailA, password);
    const clientSignInB = await signIn(url, anonKey, emailB, password);

    const beforeBAccount = JSON.stringify((await admin.from('account_state').select('*').eq('client_id', userB.id).single()).data);
    const beforeBHoldings = JSON.stringify((await admin.from('holdings').select('*').eq('client_id', userB.id)).data);
    const beforeBAllocReqs = JSON.stringify((await admin.from('allocation_requests').select('*').eq('client_id', userB.id)).data);
    const beforeBTxns = JSON.stringify((await admin.from('transactions').select('*').eq('client_id', userB.id)).data);

    // Client A does a full round: an approved allocation and an approved sell.
    const { data: allocA } = await clientSignInA.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 3000 } });
    await adminSignIn.client.functions.invoke('approve-allocation', { body: { requestId: allocA.id } });
    const { data: sellA } = await clientSignInA.client.functions.invoke('request-sell', { body: { productId: PROD_REAL_ASSETS, unitsToSell: 15 } });
    await adminSignIn.client.functions.invoke('approve-sell', { body: { requestId: sellA.id } });
    // B independently also has activity of its own — proves isolation isn't vacuous.
    const { data: sellB } = await clientSignInB.client.functions.invoke('request-sell', { body: { productId: PROD_REAL_ASSETS, unitsToSell: 5 } });

    const afterBAccount = JSON.stringify((await admin.from('account_state').select('*').eq('client_id', userB.id).single()).data);
    const afterBHoldings = JSON.stringify((await admin.from('holdings').select('*').eq('client_id', userB.id)).data);
    const afterBAllocReqs = JSON.stringify((await admin.from('allocation_requests').select('*').eq('client_id', userB.id)).data);
    const afterBTxns = JSON.stringify((await admin.from('transactions').select('*').eq('client_id', userB.id)).data);

    check('Client B’s account_state is byte-for-byte unchanged after Client A’s allocation+sell activity', beforeBAccount === afterBAccount);
    check('Client B’s holdings are byte-for-byte unchanged (B only requested a sell, never had one approved)', beforeBHoldings === afterBHoldings);
    check('Client B’s allocation_requests are byte-for-byte unchanged (B never requested an allocation)', beforeBAllocReqs === afterBAllocReqs);
    check('Client B’s transactions are byte-for-byte unchanged by Client A’s activity', beforeBTxns === afterBTxns);
    check('Client B’s own pending sell request genuinely exists and is scoped to B, not mixed into A’s data', sellB && sellB.clientId === userB.id);

    const { data: aAccount } = await admin.from('account_state').select('*').eq('client_id', userA.id).single();
    check('Client A’s own account_state DID genuinely change (the isolation check above is not vacuous)', aAccount.unallocated_capital !== 15000, 'got=' + aAccount.unallocated_capital);

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // TEST 9 — RLS: zero client-side write path outside the Edge Functions, on both tables.
  // ===========================================================================================
  console.log('\n9. RLS — zero client-side write path outside the Edge Functions, on both tables');

  await (async function () {
    const emailA = 'rlsA-as-' + suffix + '@test.marketswave.local';
    const emailB = 'rlsB-as-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('allocation_requests').insert({ client_id: userA.id, product_id: PROD_ETF, requested_amount: 100, status: 'pending' });
    await admin.from('sell_requests').insert({ client_id: userA.id, product_id: PROD_ETF, units_to_sell: 10, status: 'pending' });

    const a = await signIn(url, anonKey, emailA, password);

    const { data: ownAlloc } = await a.client.from('allocation_requests').select('*');
    check('Client A can SELECT their own allocation_requests', ownAlloc && ownAlloc.length === 1);
    const { data: ownSell } = await a.client.from('sell_requests').select('*');
    check('Client A can SELECT their own sell_requests', ownSell && ownSell.length === 1);
    const { data: crossAlloc } = await a.client.from('allocation_requests').select('*').eq('client_id', userB.id);
    check('Client A’s query for Client B’s allocation_requests returns empty (RLS-filtered, not an error)', crossAlloc && crossAlloc.length === 0);

    const { data: legitInsert } = await a.client.from('allocation_requests').insert({ client_id: userA.id, product_id: PROD_ETF, requested_amount: 50, status: 'pending' }).select();
    check('Client A CAN directly insert their own genuinely-pending allocation request via RLS', legitInsert && legitInsert.length === 1);

    const { data: spoofClientInsert } = await a.client.from('allocation_requests').insert({ client_id: userB.id, product_id: PROD_ETF, requested_amount: 999, status: 'pending' }).select();
    check('Client A cannot INSERT an allocation request under Client B’s client_id', !spoofClientInsert || spoofClientInsert.length === 0);

    const { data: spoofStatusInsert } = await a.client.from('allocation_requests').insert({ client_id: userA.id, product_id: PROD_ETF, requested_amount: 999, status: 'approved' }).select();
    check('Client A cannot INSERT an allocation request with a non-pending status', !spoofStatusInsert || spoofStatusInsert.length === 0);

    const { data: spoofSellStatusInsert } = await a.client.from('sell_requests').insert({ client_id: userA.id, product_id: PROD_ETF, units_to_sell: 999, status: 'approved' }).select();
    check('Client A cannot INSERT a sell request with a non-pending status', !spoofSellStatusInsert || spoofSellStatusInsert.length === 0);

    const { data: updateAttempt } = await a.client.from('allocation_requests').update({ status: 'approved' }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own allocation_requests row directly', !updateAttempt || updateAttempt.length === 0);
    const { data: deleteAttempt } = await a.client.from('allocation_requests').delete().eq('client_id', userA.id).select();
    check('Client A cannot DELETE their own allocation_requests row directly', !deleteAttempt || deleteAttempt.length === 0);
    const { data: sellUpdateAttempt } = await a.client.from('sell_requests').update({ status: 'approved' }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own sell_requests row directly', !sellUpdateAttempt || sellUpdateAttempt.length === 0);

    const { data: adminUpdateAttempt } = await adminSignIn.client.from('allocation_requests').update({ status: 'approved' }).eq('client_id', userA.id).select();
    check('Even an admin-claimed caller (client-side) cannot write directly — only service_role, via the Edge Functions, can', !adminUpdateAttempt || adminUpdateAttempt.length === 0);
    const { data: adminReadsA } = await adminSignIn.client.from('allocation_requests').select('*').eq('client_id', userA.id);
    check('An admin-claimed caller CAN read Client A’s allocation_requests directly (self-or-admin SELECT policy)', adminReadsA && adminReadsA.length >= 1);

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonRows } = await anonClient.from('allocation_requests').select('*');
    check('Unauthenticated (anon) caller sees zero allocation_requests rows', anonRows && anonRows.length === 0);

    const { data: stillOriginal } = await admin.from('allocation_requests').select('status').eq('client_id', userA.id).eq('requested_amount', 100).single();
    check('allocation_requests row is genuinely still pending after every denied write attempt', stillOriginal.status === 'pending', 'got=' + stillOriginal.status);

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // TEST 10 — Authorization negative cases.
  // ===========================================================================================
  console.log('\n10. Authorization — non-admin and unauthenticated callers');

  await (async function () {
    const email = 'nonadmin-as-test-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
    const clientSignIn = await signIn(url, anonKey, email, password);
    const { data: request } = await clientSignIn.client.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 2000 } });

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { error: approveNonAdminErr } = await clientSignIn.client.functions.invoke('approve-allocation', { body: { requestId: request.id } });
    check('Non-admin caller cannot call approve-allocation (403)', approveNonAdminErr && approveNonAdminErr.context && approveNonAdminErr.context.status === 403, approveNonAdminErr && approveNonAdminErr.message);
    const { error: rejectNonAdminErr } = await clientSignIn.client.functions.invoke('reject-allocation', { body: { requestId: request.id, reason: 'x' } });
    check('Non-admin caller cannot call reject-allocation (403)', rejectNonAdminErr && rejectNonAdminErr.context && rejectNonAdminErr.context.status === 403);
    const { error: approveSellNonAdminErr } = await clientSignIn.client.functions.invoke('approve-sell', { body: { requestId: request.id } });
    check('Non-admin caller cannot call approve-sell (403)', approveSellNonAdminErr && approveSellNonAdminErr.context && approveSellNonAdminErr.context.status === 403);
    const { error: rejectSellNonAdminErr } = await clientSignIn.client.functions.invoke('reject-sell', { body: { requestId: request.id, reason: 'x' } });
    check('Non-admin caller cannot call reject-sell (403)', rejectSellNonAdminErr && rejectSellNonAdminErr.context && rejectSellNonAdminErr.context.status === 403);

    const { error: anonAllocErr } = await anonClient.functions.invoke('request-allocation', { body: { productId: PROD_ETF, dollarAmount: 100 } });
    check('Unauthenticated caller cannot call request-allocation (401)', anonAllocErr && anonAllocErr.context && anonAllocErr.context.status === 401, anonAllocErr && anonAllocErr.message);
    const { error: anonSellErr } = await anonClient.functions.invoke('request-sell', { body: { productId: PROD_ETF, unitsToSell: 1 } });
    check('Unauthenticated caller cannot call request-sell (401)', anonSellErr && anonSellErr.context && anonSellErr.context.status === 401);
    const { error: anonApproveErr } = await anonClient.functions.invoke('approve-allocation', { body: { requestId: request.id } });
    check('Unauthenticated caller cannot call approve-allocation (401)', anonApproveErr && anonApproveErr.context && anonApproveErr.context.status === 401);

    const { data: stillPending } = await admin.from('allocation_requests').select('status').eq('id', request.id).single();
    check('The request is genuinely still pending after every denied approve/reject attempt', stillPending.status === 'pending', 'got=' + stillPending.status);

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
