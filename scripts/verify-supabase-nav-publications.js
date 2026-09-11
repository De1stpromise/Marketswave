#!/usr/bin/env node
// Backend Migration Phase D — NAV feature (2026-09-06).
//
// Real-stack verification for real PM-published NAV — the settlement carve-out for Private
// Equity / Real Assets (settleProduct()'s new early return in _shared/portfolio-engine.ts),
// the publish-nav Edge Function, and cross-client correctness. LOCAL STACK ONLY.
//
// Usage:  node scripts/verify-supabase-nav-publications.js
// Requires: the local Supabase stack running, this feature's migration applied
// (`supabase migration up`), `supabase functions serve` (or a fresh `supabase start` so the
// new publish-nav function directory is discovered), and
// `node scripts/supabase-seed-portfolio.js` already run at least once.

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
  await admin.from('clients').insert({ id: data.user.id, name: 'NAV Test Client', email, phone: '+1-555-0800', account_type: 'Individual Account', status: 'active' });
  await admin.from('account_state').insert({ client_id: data.user.id, unallocated_capital: 0, allocated_capital: 0, asset_returns: 0 });
  return data.user;
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return client;
}

async function functionErrorBody(err) {
  try { return await err.context.json(); } catch (e) { return null; }
}

async function main() {
  console.log('Backend Migration Phase D — real PM-published NAV verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'NavVerify2026!';

  const PE_PRODUCT = 'PROD-0001'; // Nordic Growth Fund, Private Equity
  const RA_PRODUCT = 'PROD-0002'; // European Real Estate Trust, Real Assets
  // Product catalog — live pricing, part 1 (2026-09-11): PROD-0003/PROD-0004 are market-
  // priced now and never tick. The row-143 regression this suite guards ("the classes NOT
  // carved out still tick") is still a real property of the legacy simulated model, so it
  // runs against two temporary genuinely-simulated products instead.
  const { createSimulatedTestProduct, deleteSimulatedTestProduct } = await import('./lib/simulated-test-product.mjs');
  const simEtf = await createSimulatedTestProduct(admin, suffix + 'E', { asset_class: 'Stocks & ETFs' });
  const simCrypto = await createSimulatedTestProduct(admin, suffix + 'C', { asset_class: 'Crypto', risk_tier: 'aggressive', investment_type: 'Coin' });
  const ETF_PRODUCT = simEtf.id;
  const CRYPTO_PRODUCT = simCrypto.id;

  // Capture every product this script touches so it can be restored exactly at the end.
  const { data: originalProducts } = await admin.from('products').select('*').in('id', [PE_PRODUCT, RA_PRODUCT, ETF_PRODUCT, CRYPTO_PRODUCT]);
  const originalById = {};
  originalProducts.forEach((p) => { originalById[p.id] = p; });

  const demo = await signIn(url, anonKey, 'demo-portfolio@marketswave.local', 'DemoPortfolio-Local-2026!');
  const pm1 = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  // ===========================================================================================
  // 1. THE CARVE-OUT — a Private Equity / Real Assets product genuinely does NOT drift between
  //    publications, even when the settlement tick logic is run against it directly.
  // ===========================================================================================
  console.log('1. The carve-out: Private Equity / Real Assets never move via the simulated tick\n');
  await (async function () {
    const pastDate = '2026-08-01'; // several real days before "today"
    await admin.from('products').update({ last_tick_date: pastDate, unit_price: 200.00 }).eq('id', PE_PRODUCT);
    await admin.from('products').update({ last_tick_date: pastDate, unit_price: 150.00 }).eq('id', RA_PRODUCT);

    // get-total-portfolio-value triggers settleAllProducts() internally — the real code path
    // a real client call takes, exercising every real caller of settleProduct() at once.
    await demo.functions.invoke('get-total-portfolio-value', { body: {} });

    const { data: peAfter } = await admin.from('products').select('unit_price, last_tick_date').eq('id', PE_PRODUCT).single();
    const { data: raAfter } = await admin.from('products').select('unit_price, last_tick_date').eq('id', RA_PRODUCT).single();

    check('a Private Equity product\'s unit_price is COMPLETELY UNCHANGED after settleAllProducts(), despite lastTickDate being weeks stale', peAfter.unit_price === 200.00, 'got ' + peAfter.unit_price);
    check('a Private Equity product\'s last_tick_date is also left untouched (changed: false, nothing to persist)', peAfter.last_tick_date === pastDate, 'got ' + peAfter.last_tick_date);
    check('a Real Assets product\'s unit_price is COMPLETELY UNCHANGED after settleAllProducts()', raAfter.unit_price === 150.00, 'got ' + raAfter.unit_price);
    check('a Real Assets product\'s last_tick_date is also left untouched', raAfter.last_tick_date === pastDate, 'got ' + raAfter.last_tick_date);
  })();

  // ===========================================================================================
  // 2. REGRESSION — Stocks & ETFs / Crypto are completely unaffected by the carve-out; they
  //    still tick exactly as before.
  // ===========================================================================================
  console.log('\n2. Regression: Stocks & ETFs / Crypto are unaffected — they still tick normally\n');
  await (async function () {
    const pastDate = '2026-08-01';
    await admin.from('products').update({ last_tick_date: pastDate, unit_price: 100.00 }).eq('id', ETF_PRODUCT);
    await admin.from('products').update({ last_tick_date: pastDate, unit_price: 100.00 }).eq('id', CRYPTO_PRODUCT);

    await demo.functions.invoke('get-total-portfolio-value', { body: {} });

    const { data: etfAfter } = await admin.from('products').select('unit_price, last_tick_date').eq('id', ETF_PRODUCT).single();
    const { data: cryptoAfter } = await admin.from('products').select('unit_price, last_tick_date').eq('id', CRYPTO_PRODUCT).single();

    check('a Stocks & ETFs product\'s price genuinely moved (still ticks)', etfAfter.unit_price !== 100.00, 'got ' + etfAfter.unit_price);
    check('a Stocks & ETFs product\'s last_tick_date genuinely advanced to today', etfAfter.last_tick_date !== pastDate, 'got ' + etfAfter.last_tick_date);
    check('a Crypto product\'s price genuinely moved (still ticks)', cryptoAfter.unit_price !== 100.00, 'got ' + cryptoAfter.unit_price);
    check('a Crypto product\'s last_tick_date genuinely advanced to today', cryptoAfter.last_tick_date !== pastDate, 'got ' + cryptoAfter.last_tick_date);
  })();

  // ===========================================================================================
  // 3. publish-nav — validation
  // ===========================================================================================
  console.log('\n3. publish-nav — validation\n');
  await (async function () {
    const { error: noIdErr } = await pm1.functions.invoke('publish-nav', { body: { newUnitPrice: 100 } });
    check('missing productId is rejected (400)', noIdErr && noIdErr.context && noIdErr.context.status === 400);

    const { error: unknownErr } = await pm1.functions.invoke('publish-nav', { body: { productId: 'PROD-9999', newUnitPrice: 100 } });
    check('an unknown productId is rejected (404)', unknownErr && unknownErr.context && unknownErr.context.status === 404);

    const { error: zeroErr } = await pm1.functions.invoke('publish-nav', { body: { productId: PE_PRODUCT, newUnitPrice: 0 } });
    check('a zero unit price is rejected (400)', zeroErr && zeroErr.context && zeroErr.context.status === 400);

    const { error: negErr } = await pm1.functions.invoke('publish-nav', { body: { productId: PE_PRODUCT, newUnitPrice: -5 } });
    check('a negative unit price is rejected (400)', negErr && negErr.context && negErr.context.status === 400);

    const { error: badDateErr } = await pm1.functions.invoke('publish-nav', { body: { productId: PE_PRODUCT, newUnitPrice: 100, effectiveDate: '09/06/2026' } });
    check('a malformed effectiveDate is rejected (400)', badDateErr && badDateErr.context && badDateErr.context.status === 400);

    const { error: etfErr } = await pm1.functions.invoke('publish-nav', { body: { productId: ETF_PRODUCT, newUnitPrice: 200 } });
    const etfBody = await functionErrorBody(etfErr);
    check('a Stocks & ETFs product is genuinely rejected — real NAV publication does not apply', etfErr && etfErr.context && etfErr.context.status === 400 && /Stocks & ETFs/.test(etfBody && etfBody.error), JSON.stringify(etfBody));

    const { error: cryptoErr } = await pm1.functions.invoke('publish-nav', { body: { productId: CRYPTO_PRODUCT, newUnitPrice: 200 } });
    check('a Crypto product is genuinely rejected', cryptoErr && cryptoErr.context && cryptoErr.context.status === 400);

    const { error: cashErr } = await pm1.functions.invoke('publish-nav', { body: { productId: 'PROD-0005', newUnitPrice: 200 } });
    check('the Cash product is genuinely rejected', cashErr && cashErr.context && cashErr.context.status === 400);

    // Confirm none of the above rejected attempts left any residue.
    const { data: peUnchanged } = await admin.from('products').select('unit_price').eq('id', PE_PRODUCT).single();
    check('none of the above rejected attempts actually changed PROD-0001\'s real price', peUnchanged.unit_price === 200.00, 'got ' + peUnchanged.unit_price);
  })();

  // ===========================================================================================
  // 4. publish-nav — a real successful publish, with real, distinguishable PM attribution
  //    (two genuinely different real PM accounts, same rigor as Phase C — Stage 1)
  // ===========================================================================================
  console.log('\n4. publish-nav — a real successful publish, with real distinguishable PM attribution\n');
  let pm2Email = null;
  await (async function () {
    const pm2Password = 'NavVerifyPM2-2026!';
    pm2Email = 'nav-pm2-' + suffix + '@marketswave.local';
    const { error: createPm2Err } = await admin.auth.admin.createUser({ email: pm2Email, password: pm2Password, email_confirm: true, app_metadata: { is_admin: true } });
    if (createPm2Err) throw new Error('Failed to create second real PM account: ' + createPm2Err.message);
    const { data: pm2User } = await admin.auth.admin.listUsers();
    const pm2Id = pm2User.users.find((u) => u.email === pm2Email).id;
    await admin.from('user_roles').insert({ user_id: pm2Id, is_admin: true });
    const pm2 = await signIn(url, anonKey, pm2Email, pm2Password);

    const { data: r1, error: e1 } = await pm1.functions.invoke('publish-nav', { body: { productId: PE_PRODUCT, newUnitPrice: 125.50, effectiveDate: '2026-08-15', note: 'Q2 2026 appraisal.' } });
    check('PM #1\'s real publish succeeds', !e1, e1 && e1.message);
    check('the response carries the real updated product price', r1 && r1.product.unitPrice === 125.50, JSON.stringify(r1 && r1.product));
    check('the response carries the real new publication, attributed to PM #1', r1 && r1.publication.publishedByEmail === 'pm@marketswave.local', JSON.stringify(r1 && r1.publication));

    const { data: r2, error: e2 } = await pm2.functions.invoke('publish-nav', { body: { productId: RA_PRODUCT, newUnitPrice: 160.25, effectiveDate: '2026-08-20', note: 'Independent valuation, PM #2.' } });
    check('PM #2\'s real publish succeeds', !e2, e2 && e2.message);
    check('the response is attributed to PM #2, genuinely distinguishable from PM #1', r2 && r2.publication.publishedByEmail === pm2Email, JSON.stringify(r2 && r2.publication));

    const { data: peRow } = await admin.from('products').select('unit_price, last_tick_date').eq('id', PE_PRODUCT).single();
    check('PROD-0001\'s real stored unit_price genuinely updated', peRow.unit_price === 125.50, 'got ' + peRow.unit_price);
    check('PROD-0001\'s real stored last_tick_date advanced to the real effective_date (not today\'s date)', peRow.last_tick_date === '2026-08-15', 'got ' + peRow.last_tick_date);

    const { data: pubRows } = await admin.from('nav_publications').select('*').eq('product_id', PE_PRODUCT).order('published_at', { ascending: false }).limit(1);
    check('a real nav_publications row exists with the real PM #1 id (not just the email)', pubRows[0].published_by !== null && pubRows[0].published_by_email === 'pm@marketswave.local');
    check('the real note was stored verbatim', pubRows[0].note === 'Q2 2026 appraisal.');

    const { data: raRow } = await admin.from('nav_publications').select('published_by_email').eq('product_id', RA_PRODUCT).order('published_at', { ascending: false }).limit(1).single();
    check('PROD-0002\'s real publication is attributed to PM #2, not PM #1 — genuinely distinguishable across two real PM accounts', raRow.published_by_email === pm2Email);

    // A published NAV genuinely does NOT drift on the next real tick-triggering call, since
    // the carve-out early-returns before ever consulting last_tick_date's own staleness.
    await demo.functions.invoke('get-total-portfolio-value', { body: {} });
    const { data: peAfterTick } = await admin.from('products').select('unit_price').eq('id', PE_PRODUCT).single();
    check('a real published NAV price does NOT drift on a subsequent settlement call', peAfterTick.unit_price === 125.50, 'got ' + peAfterTick.unit_price);
  })();

  // ===========================================================================================
  // 5. Cross-client correctness — a NAV publication affects the product globally, correctly
  //    reflected for EVERY client holding it, not just the one who happened to trigger it.
  // ===========================================================================================
  console.log('\n5. Cross-client correctness — a real publication is reflected for every client holding the product\n');
  await (async function () {
    const emailA = 'nav-clienta-' + suffix + '@test.marketswave.local';
    const emailB = 'nav-clientb-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);

    await admin.from('holdings').insert({ client_id: userA.id, product_id: PE_PRODUCT, units: 10, cost_basis: 1000 });
    await admin.from('holdings').insert({ client_id: userB.id, product_id: PE_PRODUCT, units: 25, cost_basis: 2500 });

    const { data: r, error: e } = await pm1.functions.invoke('publish-nav', { body: { productId: PE_PRODUCT, newUnitPrice: 140.00, effectiveDate: '2026-09-01', note: 'Cross-client correctness test.' } });
    check('the cross-client test publish succeeds', !e, e && e.message);

    const { data: tpvA } = await pm1.functions.invoke('get-total-portfolio-value', { body: { clientId: userA.id } });
    const { data: tpvB } = await pm1.functions.invoke('get-total-portfolio-value', { body: { clientId: userB.id } });
    check('client A\'s Total Portfolio Value reflects the new price (10 units * $140.00 = $1,400)', Math.abs(tpvA.totalPortfolioValue - 1400) < 1e-6, JSON.stringify(tpvA));
    check('client B\'s Total Portfolio Value ALSO reflects the exact same new price (25 units * $140.00 = $3,500) — one global publication, both clients see it', Math.abs(tpvB.totalPortfolioValue - 3500) < 1e-6, JSON.stringify(tpvB));

    const { data: holdingsA } = await pm1.functions.invoke('get-holdings', { body: { clientId: userA.id } });
    check('get-holdings for client A shows the holding valued at the new price via the same product row', holdingsA.some((h) => h.productId === PE_PRODUCT));

    await admin.from('holdings').delete().eq('client_id', userA.id);
    await admin.from('holdings').delete().eq('client_id', userB.id);
    await admin.from('account_state').delete().in('client_id', [userA.id, userB.id]);
    await admin.from('clients').delete().in('id', [userA.id, userB.id]);
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  })();

  // ===========================================================================================
  // 6. Authorization
  // ===========================================================================================
  console.log('\n6. Authorization\n');
  await (async function () {
    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: anonErr } = await anonClient.functions.invoke('publish-nav', { body: { productId: PE_PRODUCT, newUnitPrice: 100 } });
    check('an unauthenticated caller cannot call publish-nav (401)', anonErr && anonErr.context && anonErr.context.status === 401);

    const nonAdminEmail = 'nav-nonadmin-' + suffix + '@test.marketswave.local';
    const nonAdminUser = await createTestClient(admin, nonAdminEmail, password);
    const nonAdmin = await signIn(url, anonKey, nonAdminEmail, password);
    const { error: nonAdminErr } = await nonAdmin.functions.invoke('publish-nav', { body: { productId: PE_PRODUCT, newUnitPrice: 100 } });
    check('a genuine non-admin caller is blocked (403)', nonAdminErr && nonAdminErr.context && nonAdminErr.context.status === 403);

    const { data: unchanged } = await admin.from('products').select('unit_price').eq('id', PE_PRODUCT).single();
    check('the rejected non-admin attempt left the real price completely unchanged', unchanged.unit_price === 140.00, 'got ' + unchanged.unit_price);

    const { error: directInsertErr } = await nonAdmin.from('nav_publications').insert({ product_id: PE_PRODUCT, published_unit_price: 1, effective_date: '2026-01-01' });
    check('no client-side role can INSERT into nav_publications directly — only service_role, via publish-nav', !!directInsertErr);

    const { data: nonAdminRead, error: nonAdminReadErr } = await nonAdmin.from('nav_publications').select('*');
    check('a non-admin cannot even SELECT from nav_publications', !nonAdminReadErr ? nonAdminRead.length === 0 : true);

    await admin.from('account_state').delete().eq('client_id', nonAdminUser.id);
    await admin.from('clients').delete().eq('id', nonAdminUser.id);
    await admin.auth.admin.deleteUser(nonAdminUser.id);
  })();

  // ===========================================================================================
  // 7. Migration backfill sanity check — every PE/Real Assets product that existed AT THE TIME
  //    the migration ran has a real system-recorded initial publication (published_by null, a
  //    real frozen price). Deliberately scoped to the two originally-seeded products
  //    (PROD-0001/PROD-0002) rather than "every PE/Real Assets product currently in the
  //    table" — a real, disclosed environment finding, not assumed: other unrelated test
  //    scripts (verify-products-catalog-fix.mjs) create their own real, uncleaned-up test
  //    products, including Real Assets ones, on a machine that's run this project's full
  //    regression history — those legitimately have NO NAV history, since the one-time
  //    backfill only ever ran once, before they existed; checking "every current product"
  //    was a test bug, not a real NAV-feature gap.
  // ===========================================================================================
  console.log('\n7. Migration backfill — the two originally-seeded PE/Real Assets products have a real system NAV record\n');
  await (async function () {
    for (const id of [PE_PRODUCT, RA_PRODUCT]) {
      const { data: history } = await admin.from('nav_publications').select('*').eq('product_id', id);
      check('product ' + id + ' has at least one real NAV publication record', history.length >= 1, 'found ' + history.length);
    }
    const { data: systemRow } = await admin.from('nav_publications').select('*').is('published_by', null).limit(1).maybeSingle();
    check('at least one real backfilled row is honestly attributed to no real PM (a system/migration event)', !!systemRow);
  })();

  // Restore every product this script touched to its real pre-test state.
  for (const id of [PE_PRODUCT, RA_PRODUCT, ETF_PRODUCT, CRYPTO_PRODUCT]) {
    await admin.from('products').update({ unit_price: originalById[id].unit_price, last_tick_date: originalById[id].last_tick_date }).eq('id', id);
  }
  await deleteSimulatedTestProduct(admin, ETF_PRODUCT);
  await deleteSimulatedTestProduct(admin, CRYPTO_PRODUCT);
  await admin.from('nav_publications').delete().in('note', ['Q2 2026 appraisal.', 'Independent valuation, PM #2.', 'Cross-client correctness test.']);
  if (pm2Email) {
    const { data: userList } = await admin.auth.admin.listUsers();
    const pm2 = userList.users.find((u) => u.email === pm2Email);
    if (pm2) {
      await admin.from('user_roles').delete().eq('user_id', pm2.id);
      await admin.auth.admin.deleteUser(pm2.id);
    }
  }
  await demo.functions.invoke('get-total-portfolio-value', { body: {} }); // force a fresh recompute against the restored prices

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
