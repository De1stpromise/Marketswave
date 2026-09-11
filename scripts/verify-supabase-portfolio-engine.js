#!/usr/bin/env node
// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Real-stack verification for the portfolio engine's move to Supabase — the highest-risk
// category of work in this migration project, since it touches real money figures directly.
// Mirrors the rigor already established for Stage 1's own verify-supabase-schema.js and the
// Approval Gate unification's own cross-client isolation discipline, extended here with a
// genuine settlement-determinism cross-check against the REAL, unmodified engine-core.js
// source (not just the ported TypeScript trusted on its own) — the strongest possible proof
// that this is a faithful port, not a plausible-looking reimplementation.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and localhost-only guard as every other local-stack script in this project.
//
// Usage:  node scripts/verify-supabase-portfolio-engine.js
// Requires: the local Supabase stack running, this stage's migration applied
// (`supabase migration up --local`), `supabase functions serve` running, and
// `node scripts/supabase-seed-portfolio.js` already run at least once.

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { loadEngine, createSharedStorage } = require('./lib/engine-harness');

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

async function main() {
  console.log('Supabase Backend Migration Phase B — Stage 1 verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyPortfolio-2026!';

  // ===========================================================================================
  // TEST 1 — Settlement determinism, cross-checked against the REAL engine-core.js source
  // (not just the ported TypeScript trusted on its own). Same product + same lastTickDate +
  // same starting price should produce the EXACT same settled price on both sides, since the
  // seeded PRNG only depends on (productId, calendar date) — never which store the product
  // data happens to live in.
  // ===========================================================================================
  console.log('1. Settlement determinism (cross-checked against real engine-core.js)');

  // Backend Migration Phase D — NAV feature (2026-09-06): swapped from PROD-0001 (Nordic
  // Growth Fund, Private Equity) to PROD-0003 (Global Equity ETF, Stocks & ETFs) — PROD-0001
  // is now one of the two asset classes carved OUT of the simulated tick entirely (its price
  // only moves via a real published NAV, never this mechanic), so forcing it backward in time
  // and expecting it to tick forward would no longer hold; the determinism PROPERTY under
  // test — same product + same lastTickDate + same starting price -> same settled price on
  // both the real engine-core.js source and the real deployed Edge Function stack — is
  // completely unaffected by the carve-out for any product the tick mechanic still applies
  // to, so this is a like-for-like swap, not a weakened test.
  // Product catalog — live pricing, part 1 (2026-09-11): PROD-0003 is market-priced now and
  // never ticks, so the determinism/cost-basis/round-trip tests below run against a
  // temporary, genuinely-simulated product (see lib/simulated-test-product.mjs) — the SAME
  // id on both sides, since the tick's seed is `productId|date`. The properties under test
  // are unchanged; only the product carrying them moved.
  const { createSimulatedTestProduct, deleteSimulatedTestProduct } = await import('./lib/simulated-test-product.mjs');
  const simProduct = await createSimulatedTestProduct(admin, suffix, { unit_price: 118.40, last_tick_date: '2026-08-20' });
  const testProductId = simProduct.id;
  const pastDate = '2026-08-20'; // several real days before "today" in this environment
  const startingPrice = 118.40; // an arbitrary, manufactured test starting price

  await (async function () {
    // Capture PROD-0003's REAL pre-test state so it can be restored exactly afterward —
    // deliberately not a hardcoded guess (the prior version of this test hardcoded PROD-0001's
    // own price back, which only worked because that value happened to match its real seeded
    // state at authoring time; a genuine real product's live price drifts day to day via its
    // own real tick, so capture-then-restore is the only correct approach here).
    const { data: originalRow } = await admin.from('products').select('unit_price, last_tick_date').eq('id', testProductId).single();

    // ---- Side A: the REAL, unmodified engine-core.js, sandboxed -----------------------------
    const storages = createSharedStorage();
    const engine = loadEngine(storages); // seeds its own local catalog/account/holdings normally
    // Force the test product's stored lastTickDate/unitPrice to the exact controlled scenario —
    // engine-core.js's own settleProduct() reads from its module-level `catalog` array, so we
    // rewrite the underlying localStorage-polyfill catalog key directly, then reload so the
    // engine picks up the rewritten data.
    const catalogRaw = JSON.parse(storages.localStorage.getItem('marketswave_product_catalog'));
    // The local engine has no idea about the temporary Supabase product; give it the same
    // row (same id, same tier) so both sides settle the identical seed series.
    catalogRaw.push({ id: testProductId, name: simProduct.name, assetClass: 'Stocks & ETFs', investmentType: 'Index Fund', riskTier: 'balanced', minimumInvestment: 100, unitPrice: startingPrice, inceptionUnitPrice: 100, createdAt: '2026-08-01', lastTickDate: pastDate });
    const idx = catalogRaw.findIndex((p) => p.id === testProductId);
    catalogRaw[idx].lastTickDate = pastDate;
    catalogRaw[idx].unitPrice = startingPrice;
    storages.localStorage.setItem('marketswave_product_catalog', JSON.stringify(catalogRaw));

    const engine2 = loadEngine(storages); // fresh "page load" against the rewritten catalog
    const settledReal = engine2.settleProduct(testProductId);

    // ---- Side B: the REAL deployed Edge Function stack (Postgres + the ported TS module) ---
    const { error: setErr } = await admin.from('products').update({ last_tick_date: pastDate, unit_price: startingPrice }).eq('id', testProductId);
    if (setErr) throw new Error('Failed to set up Postgres product for determinism test: ' + setErr.message);

    // get-total-portfolio-value triggers settleAllProducts() internally, which settles
    // the test product among every other product — the real code path a real client call takes.
    const demoSignIn = await signIn(url, anonKey, 'demo-portfolio@marketswave.local', 'DemoPortfolio-Local-2026!');
    await demoSignIn.client.functions.invoke('get-total-portfolio-value', { body: {} });

    const { data: settledPg } = await admin.from('products').select('unit_price, last_tick_date').eq('id', testProductId).single();

    check(
      'Real engine-core.js and the real deployed Edge Function stack settle PROD-0003 to the IDENTICAL price for the identical (productId, lastTickDate, startingPrice) scenario',
      settledReal.unitPrice === settledPg.unit_price,
      'engine-core.js=' + settledReal.unitPrice + ', Edge Function stack=' + settledPg.unit_price
    );
    check(
      'Both sides advanced lastTickDate to the same "today"',
      settledReal.lastTickDate === settledPg.last_tick_date,
      'engine-core.js=' + settledReal.lastTickDate + ', Edge Function stack=' + settledPg.last_tick_date
    );

    // Idempotency: calling settlement again the SAME day must be a genuine no-op (price
    // unchanged) — proves "same product + same date -> same Z, always" holds through the real
    // deployed stack, not just in isolation.
    const priceBeforeSecondCall = settledPg.unit_price;
    await demoSignIn.client.functions.invoke('get-total-portfolio-value', { body: {} });
    const { data: settledPgAgain } = await admin.from('products').select('unit_price').eq('id', testProductId).single();
    check(
      'Re-settling the same product on the same real day is a genuine no-op (idempotent)',
      settledPgAgain.unit_price === priceBeforeSecondCall,
      'before=' + priceBeforeSecondCall + ', after=' + settledPgAgain.unit_price
    );

    // Restore PROD-0003 to its REAL captured pre-test state, THEN force a fresh recompute of
    // the demo client's own allocated_capital against the restored price — this test
    // deliberately ticked the test product forward across several real days to prove
    // determinism, and recomputeAllocatedCapital() ran against that TEMPORARILY-ticked price
    // during the calls above; without this second recompute, the demo client's stored
    // allocated_capital would stay stale at the ticked value even after the product's own
    // price is restored. A real, disclosed test-hygiene detail, not a port bug — the
    // determinism assertions above already passed correctly before this cleanup runs.
    await admin.from('products').update({ unit_price: originalRow.unit_price, last_tick_date: originalRow.last_tick_date }).eq('id', testProductId);
    await demoSignIn.client.functions.invoke('get-total-portfolio-value', { body: {} });
  })();

  // ===========================================================================================
  // TEST 2 — Proportional cost-basis math on a partial sell, verified against the exact
  // formula, not just "it ran without error."
  // ===========================================================================================
  console.log('\n2. Proportional cost-basis math on a partial sell');

  await (async function () {
    const email = 'costbasis-test-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 0, allocated_capital: 0, asset_returns: 0 });

    // Controlled scenario: a known holding at a known cost basis, sell a known fraction.
    const knownUnits = 200;
    const knownCostBasis = 20000; // avg cost $100/unit
    await admin.from('holdings').insert({ client_id: user.id, product_id: testProductId, units: knownUnits, cost_basis: knownCostBasis });

    const { data: product } = await admin.from('products').select('unit_price').eq('id', testProductId).single();
    const unitPrice = product.unit_price;

    const unitsToSell = 75; // an arbitrary, non-round fraction of 200
    const expectedSaleValue = Math.round(unitsToSell * unitPrice * 100) / 100;
    const expectedCostBasisPortion = Math.round(knownCostBasis * (unitsToSell / knownUnits) * 100) / 100;
    const expectedRealizedReturn = Math.round((expectedSaleValue - expectedCostBasisPortion) * 100) / 100;

    const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');
    const { data: sellResult, error: sellErr } = await adminSignIn.client.functions.invoke('execute-sell', {
      body: { clientId: user.id, productId: testProductId, unitsToSell }
    });

    check('execute-sell succeeded', !sellErr, sellErr && sellErr.message);
    check('saleValue matches the exact formula (unitsToSell * unitPrice, rounded)', sellResult && sellResult.totalValue === expectedSaleValue, JSON.stringify(sellResult));
    check('realizedReturn matches the exact formula (saleValue - proportional costBasis)', sellResult && sellResult.realizedReturn === expectedRealizedReturn, 'expected=' + expectedRealizedReturn + ' got=' + (sellResult && sellResult.realizedReturn));

    const { data: holdingAfter } = await admin.from('holdings').select('*').eq('client_id', user.id).eq('product_id', testProductId).single();
    const expectedRemainingUnits = knownUnits - unitsToSell;
    const expectedRemainingCostBasis = Math.round((knownCostBasis - expectedCostBasisPortion) * 100) / 100;
    check('remaining holding units are exactly units - unitsToSell', Math.abs(holdingAfter.units - expectedRemainingUnits) < 1e-9, 'got=' + holdingAfter.units);
    check('remaining holding cost_basis is exactly costBasis - proportional portion sold', Math.abs(holdingAfter.cost_basis - expectedRemainingCostBasis) < 1e-9, 'got=' + holdingAfter.cost_basis);

    const { data: accountAfter } = await admin.from('account_state').select('*').eq('client_id', user.id).single();
    check(
      'unallocated_capital was credited with the COST-BASIS PORTION, NOT the full sale value',
      Math.abs(accountAfter.unallocated_capital - expectedCostBasisPortion) < 1e-9,
      'expected=' + expectedCostBasisPortion + ' got=' + accountAfter.unallocated_capital
    );
    check(
      'asset_returns was credited with exactly the realized gain/loss, separately from unallocated_capital',
      Math.abs(accountAfter.asset_returns - expectedRealizedReturn) < 1e-9,
      'expected=' + expectedRealizedReturn + ' got=' + accountAfter.asset_returns
    );

    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('holdings').delete().eq('client_id', user.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // TEST 3 — Round-trip buy-then-sell Total Portfolio Value conservation.
  // ===========================================================================================
  console.log('\n3. Round-trip buy-then-sell — Total Portfolio Value conserved exactly');

  await (async function () {
    const email = 'roundtrip-test-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const startingUnallocated = 50000;
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: startingUnallocated, allocated_capital: 0, asset_returns: 0 });
    const startingTotal = startingUnallocated;

    const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

    const { data: buyResult, error: buyErr } = await adminSignIn.client.functions.invoke('execute-buy', {
      body: { clientId: user.id, productId: testProductId, dollarAmount: 10000 }
    });
    check('round-trip: execute-buy succeeded', !buyErr, buyErr && buyErr.message);

    const { data: sellResult, error: sellErr } = await adminSignIn.client.functions.invoke('execute-sell', {
      body: { clientId: user.id, productId: testProductId, unitsToSell: buyResult.units }
    });
    check('round-trip: execute-sell (100% of the just-bought units) succeeded', !sellErr, sellErr && sellErr.message);

    const { data: finalState } = await admin.from('account_state').select('*').eq('client_id', user.id).single();
    const finalTotal = finalState.unallocated_capital + finalState.allocated_capital + finalState.asset_returns;
    check(
      'Total Portfolio Value is exactly conserved through a same-price buy-then-sell round trip',
      Math.abs(finalTotal - startingTotal) < 0.01,
      'started=' + startingTotal + ', ended=' + finalTotal
    );
    check('No holding remains after selling 100% of the just-bought units', (await admin.from('holdings').select('*').eq('client_id', user.id)).data.length === 0);

    await admin.from('transactions').delete().eq('client_id', user.id);
    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  // ===========================================================================================
  // TEST 4 — Cross-client isolation: one client's Edge Function calls never affect another
  // client's rows. Same standard as the Approval Gate unification (byte-for-byte diff).
  // ===========================================================================================
  console.log('\n4. Cross-client isolation');

  await (async function () {
    const emailA = 'isoA-test-' + suffix + '@test.marketswave.local';
    const emailB = 'isoB-test-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('account_state').insert([
      { client_id: userA.id, unallocated_capital: 30000, allocated_capital: 0, asset_returns: 0 },
      { client_id: userB.id, unallocated_capital: 30000, allocated_capital: 0, asset_returns: 0 }
    ]);

    const beforeB = JSON.stringify(await admin.from('account_state').select('*').eq('client_id', userB.id).single());
    const beforeBHoldings = JSON.stringify(await admin.from('holdings').select('*').eq('client_id', userB.id));
    const beforeBTxns = JSON.stringify(await admin.from('transactions').select('*').eq('client_id', userB.id));

    const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');
    await adminSignIn.client.functions.invoke('execute-buy', { body: { clientId: userA.id, productId: 'PROD-0002', dollarAmount: 5000 } });
    await adminSignIn.client.functions.invoke('execute-sell', { body: { clientId: userA.id, productId: 'PROD-0002', unitsToSell: 10 } });

    const afterB = JSON.stringify(await admin.from('account_state').select('*').eq('client_id', userB.id).single());
    const afterBHoldings = JSON.stringify(await admin.from('holdings').select('*').eq('client_id', userB.id));
    const afterBTxns = JSON.stringify(await admin.from('transactions').select('*').eq('client_id', userB.id));

    check('Client B\'s account_state is byte-for-byte unchanged after Client A\'s buy+sell', beforeB === afterB);
    check('Client B\'s holdings are byte-for-byte unchanged after Client A\'s buy+sell', beforeBHoldings === afterBHoldings);
    check('Client B\'s transactions are byte-for-byte unchanged after Client A\'s buy+sell', beforeBTxns === afterBTxns);

    const { data: aState } = await admin.from('account_state').select('*').eq('client_id', userA.id).single();
    check('Client A\'s own account_state DID genuinely change (the isolation check above is not vacuous)', aState.allocated_capital !== 0 || aState.asset_returns !== 0);

    await admin.from('transactions').delete().in('client_id', [userA.id, userB.id]);
    await admin.from('holdings').delete().in('client_id', [userA.id, userB.id]);
    await admin.from('account_state').delete().in('client_id', [userA.id, userB.id]);
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  })();

  // ===========================================================================================
  // TEST 5 — RLS: the core security property. A client can SELECT only their own rows across
  // account_state/holdings/transactions/products/advisory_fee_rate. NO client-side
  // INSERT/UPDATE/DELETE path exists on any of these tables for any role, including admin.
  // ===========================================================================================
  console.log('\n5. RLS — self-only reads, zero client-side write path, on every table');

  await (async function () {
    const emailA = 'rlsA-test-' + suffix + '@test.marketswave.local';
    const emailB = 'rlsB-test-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('account_state').insert([
      { client_id: userA.id, unallocated_capital: 1000, allocated_capital: 0, asset_returns: 0 },
      { client_id: userB.id, unallocated_capital: 2000, allocated_capital: 0, asset_returns: 0 }
    ]);
    await admin.from('holdings').insert({ client_id: userA.id, product_id: 'PROD-0004', units: 5, cost_basis: 500 });
    await admin.from('transactions').insert({ client_id: userA.id, product_id: 'PROD-0004', type: 'BUY', units: 5, price: 100, total_value: 500 });

    const a = await signIn(url, anonKey, emailA, password);

    // ---- Self-reads succeed, cross-client reads return empty ----------------------------
    const { data: ownState } = await a.client.from('account_state').select('*');
    check('Client A can SELECT their own account_state row', ownState && ownState.length === 1 && ownState[0].client_id === userA.id);
    const { data: ownHoldings } = await a.client.from('holdings').select('*');
    check('Client A can SELECT their own holdings', ownHoldings && ownHoldings.length === 1);
    const { data: ownTxns } = await a.client.from('transactions').select('*');
    check('Client A can SELECT their own transactions', ownTxns && ownTxns.length === 1);
    const { data: catalog } = await a.client.from('products').select('*');
    check('Client A can SELECT the full product catalog (global, everyone reads it)', catalog && catalog.length >= 5);
    const { data: feeRate } = await a.client.from('advisory_fee_rate').select('*');
    check('Client A can SELECT the global advisory_fee_rate', feeRate && feeRate.length === 1);

    const { data: crossState } = await a.client.from('account_state').select('*').eq('client_id', userB.id);
    check('Client A\'s query for Client B\'s account_state returns empty (RLS-filtered, not an error)', crossState && crossState.length === 0);

    // ---- No client-side write path for ANY role, on ANY of the 3 core tables ------------
    const { data: insertAttempt } = await a.client.from('account_state').insert({ client_id: userA.id, unallocated_capital: 999999, allocated_capital: 0, asset_returns: 0 }).select();
    check('Client A cannot INSERT into account_state (already exists, but even a fresh insert has no policy)', !insertAttempt || insertAttempt.length === 0);
    const { data: updateAttempt } = await a.client.from('account_state').update({ unallocated_capital: 999999 }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own account_state row', !updateAttempt || updateAttempt.length === 0);
    const { data: deleteAttempt } = await a.client.from('account_state').delete().eq('client_id', userA.id).select();
    check('Client A cannot DELETE their own account_state row', !deleteAttempt || deleteAttempt.length === 0);

    const { data: holdingInsertAttempt } = await a.client.from('holdings').insert({ client_id: userA.id, product_id: 'PROD-0001', units: 1, cost_basis: 100 }).select();
    check('Client A cannot INSERT into holdings', !holdingInsertAttempt || holdingInsertAttempt.length === 0);
    const { data: holdingDeleteAttempt } = await a.client.from('holdings').delete().eq('client_id', userA.id).select();
    check('Client A cannot DELETE their own holding', !holdingDeleteAttempt || holdingDeleteAttempt.length === 0);

    const { data: txnInsertAttempt } = await a.client.from('transactions').insert({ client_id: userA.id, type: 'BUY', total_value: 1 }).select();
    check('Client A cannot INSERT a fabricated transaction', !txnInsertAttempt || txnInsertAttempt.length === 0);

    const { data: productUpdateAttempt } = await a.client.from('products').update({ unit_price: 1 }).eq('id', 'PROD-0001').select();
    check('Client A cannot UPDATE a product\'s price directly', !productUpdateAttempt || productUpdateAttempt.length === 0);

    const { data: feeUpdateAttempt } = await a.client.from('advisory_fee_rate').update({ rate: 99 }).eq('id', true).select();
    check('Client A cannot UPDATE the global advisory fee rate', !feeUpdateAttempt || feeUpdateAttempt.length === 0);

    // Confirmed still genuinely unchanged after every denied attempt above.
    const { data: stillOriginal } = await admin.from('account_state').select('unallocated_capital').eq('client_id', userA.id).single();
    check('account_state.unallocated_capital is genuinely still the original seeded value after every denied write attempt', stillOriginal.unallocated_capital === 1000, 'got=' + stillOriginal.unallocated_capital);

    // ---- Admin-claimed caller CAN read any client's rows (self-or-admin SELECT policy) ----
    const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');
    const { data: adminReadsB } = await adminSignIn.client.from('account_state').select('*').eq('client_id', userB.id);
    check('Admin-claimed caller CAN read Client B\'s account_state directly (self-or-admin policy)', adminReadsB && adminReadsB.length === 1);

    // ...but even an admin-claimed caller still has NO client-side write path — only
    // service_role (via the Edge Functions) can write, unconditionally, admin claim or not.
    const { data: adminWriteAttempt } = await adminSignIn.client.from('account_state').update({ unallocated_capital: 1 }).eq('client_id', userB.id).select();
    check('Admin-claimed caller (client-side) still cannot write directly — no write policy exists for anyone but service_role', !adminWriteAttempt || adminWriteAttempt.length === 0);

    // ---- Unauthenticated (anon) caller: denied everything ---------------------------------
    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonRows } = await anonClient.from('account_state').select('*');
    check('Unauthenticated (anon) caller sees zero account_state rows', anonRows && anonRows.length === 0);

    await admin.from('transactions').delete().in('client_id', [userA.id, userB.id]);
    await admin.from('holdings').delete().in('client_id', [userA.id, userB.id]);
    await admin.from('account_state').delete().in('client_id', [userA.id, userB.id]);
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  })();

  // ===========================================================================================
  // TEST 6 — Edge Function authorization negative cases for execute-buy/execute-sell.
  // ===========================================================================================
  console.log('\n6. execute-buy/execute-sell authorization — non-admin and unauthenticated callers');

  await (async function () {
    const email = 'nonadmin-portfolio-test-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    await admin.from('account_state').insert({ client_id: user.id, unallocated_capital: 10000, allocated_capital: 0, asset_returns: 0 });

    const nonAdmin = await signIn(url, anonKey, email, password);
    const { error: buyErr } = await nonAdmin.client.functions.invoke('execute-buy', { body: { clientId: user.id, productId: 'PROD-0001', dollarAmount: 1000 } });
    check('Non-admin caller cannot call execute-buy (403)', buyErr && buyErr.context && buyErr.context.status === 403, buyErr && buyErr.message);
    const { error: sellErr } = await nonAdmin.client.functions.invoke('execute-sell', { body: { clientId: user.id, productId: 'PROD-0001', unitsToSell: 1 } });
    check('Non-admin caller cannot call execute-sell (403)', sellErr && sellErr.context && sellErr.context.status === 403, sellErr && sellErr.message);

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: anonBuyErr } = await anonClient.functions.invoke('execute-buy', { body: { clientId: user.id, productId: 'PROD-0001', dollarAmount: 1000 } });
    check('Unauthenticated caller cannot call execute-buy (401)', anonBuyErr && anonBuyErr.context && anonBuyErr.context.status === 401, anonBuyErr && anonBuyErr.message);

    // Confirm no state changed despite the denied attempts.
    const { data: state } = await admin.from('account_state').select('unallocated_capital').eq('client_id', user.id).single();
    check('Account state genuinely unchanged after every denied execute-buy/execute-sell attempt', state.unallocated_capital === 10000, 'got=' + state.unallocated_capital);

    await admin.from('account_state').delete().eq('client_id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  })();

  await deleteSimulatedTestProduct(admin, testProductId);
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
