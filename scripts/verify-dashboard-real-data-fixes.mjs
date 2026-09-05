#!/usr/bin/env node
// Dashboard Real-Data Fixes (2026-09-03): closes 4 real fabricated/incomplete figures on
// dashboard.html.
//   1. "+4.2% this month" was a hardcoded label — now a real per-client monthly anchor
//      (new portfolio_value_snapshots table + get-portfolio-monthly-change Edge Function).
//   2. "Asset Returns"/"Best Performing Class" were hardcoded — now read the real
//      account_state.asset_returns column directly, and reuse the exact per-class grouping
//      the pie chart already computes (extended with a real per-class return).
//   3. The pie chart rendered blank for a genuinely $0 client — now a real empty state
//      (message + "Deploy Capital" link), while real unallocated-cash-only clients still
//      render normally (a real 100% Unallocated slice).
//   4. settings.html's Legal Name/Address/ID Document fields, investigated for a real
//      reported client (stormarem@gmail.com) — confirmed genuinely empty (no client_profiles
//      row, zero profile_change_requests ever submitted), not a bug; a small helper hint was
//      added so the honest empty state doesn't read as broken.
//
// Same jsdom-based real-DOM harness every prior UI-wiring script uses. LOCAL STACK ONLY.
// Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-dashboard-real-data-fixes.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

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

async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await test()) return true;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return test();
}

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
  const target = scripts.find(function (s) { return s.indexOf(marker) !== -1; });
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}

function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!bodyMatch) throw new Error('Could not find <body> in ' + htmlPath);
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

const forwardingConsole = new VirtualConsole();
forwardingConsole.forwardTo(console);

function buildPageDom(htmlPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: forwardingConsole
  });
  return dom;
}

async function createTestClient(admin, label, suffix) {
  const email = 'dashfix-' + label.toLowerCase() + '-' + suffix + '@test.marketswave.local';
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: email, password: 'VerifyDashFix-2026!', email_confirm: true
  });
  if (createErr) throw new Error('createUser (' + label + ') failed: ' + createErr.message);
  const id = created.user.id;
  const name = 'Dashboard Fix Test Client ' + label + ' ' + suffix;
  await admin.from('clients').insert({
    id: id, name: name, email: email, phone: '+1-555-0166', account_type: 'Individual Account', status: 'active'
  });
  return { id: id, name: name, email: email };
}

async function main() {
  console.log('Dashboard Real-Data Fixes verification\n');
  const { url, serviceRoleKey, anonKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);

  const suffix = crypto.randomBytes(4).toString('hex');
  const createdClientIds = [];

  try {

  // ===========================================================================================
  // PART 1 — Real monthly change %, across a real "multi-day" scenario (state manipulated
  // directly between real calls, standing in for real days passing — the system clock itself
  // can't be mocked for a real Deno Edge Function's own new Date(), same discipline already
  // established for the HYS pocket maturity-transition fix, row 124).
  // ===========================================================================================
  console.log('\n=== PART 1: get-portfolio-monthly-change — real anchor creation + multi-day stability ===\n');

  const clientM = await createTestClient(admin, 'Monthly', suffix);
  createdClientIds.push(clientM.id);
  await admin.from('account_state').insert({ client_id: clientM.id, unallocated_capital: 10000, allocated_capital: 0, asset_returns: 0 });

  // Sign in as this real client to call the function with their own real session.
  const clientMAuth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await clientMAuth.auth.signInWithPassword({ email: clientM.email, password: 'VerifyDashFix-2026!' });
  async function callAsClientM(fnName, body) {
    const { data: sess } = await clientMAuth.auth.getSession();
    const res = await fetch(url + '/functions/v1/' + fnName, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + sess.session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const json = await res.json();
    return { status: res.status, body: json };
  }

  console.log('1a. First real call this month — creates a real anchor using the real current value');
  const r1 = await callAsClientM('get-portfolio-monthly-change');
  check('the real first call succeeds', r1.status === 200, JSON.stringify(r1));
  check('anchorValue === currentValue === 10000 on the real first call', r1.body.anchorValue === 10000 && r1.body.currentValue === 10000, JSON.stringify(r1.body));
  check('changePercent is genuinely 0 on the real first call — never a fabricated number', r1.body.changePercent === 0, r1.body.changePercent);

  const { data: snapshotRow } = await admin.from('portfolio_value_snapshots').select('*').eq('client_id', clientM.id).single();
  check('a real portfolio_value_snapshots row genuinely exists with the correct anchor', snapshotRow && Math.abs(snapshotRow.value_at_anchor - 10000) < 1e-9, JSON.stringify(snapshotRow));
  const realMonthStart = snapshotRow.month_start_date;
  check('month_start_date is genuinely the first of the real current UTC calendar month', /-01$/.test(realMonthStart), realMonthStart);

  console.log('\n1b. Simulating a later day THE SAME MONTH — a real deposit arrives, anchor must stay stable');
  await admin.from('account_state').update({ unallocated_capital: 15000 }).eq('client_id', clientM.id);
  const r2 = await callAsClientM('get-portfolio-monthly-change');
  check('the real second call succeeds', r2.status === 200, JSON.stringify(r2));
  check('anchorValue is COMPLETELY UNCHANGED across the two real calls — still 10000, not silently reset to the new current value', r2.body.anchorValue === 10000, r2.body.anchorValue);
  check('currentValue genuinely reflects the new real balance (15000)', r2.body.currentValue === 15000, r2.body.currentValue);
  check('changeAmount/changePercent are real, correctly computed against the STABLE anchor (5000 / 50.0%)', Math.abs(r2.body.changeAmount - 5000) < 1e-9 && Math.abs(r2.body.changePercent - 50) < 1e-9, JSON.stringify(r2.body));

  const { data: snapshotRowsAfter } = await admin.from('portfolio_value_snapshots').select('*').eq('client_id', clientM.id);
  check('still genuinely only ONE snapshot row exists for this client/month — the second call did not create a duplicate', snapshotRowsAfter.length === 1, snapshotRowsAfter.length);

  console.log('\n1c. Cross-month isolation — a real stale row from a DIFFERENT month must not leak into the current month\'s anchor');
  const clientM2 = await createTestClient(admin, 'MonthlyCrossMonth', suffix);
  createdClientIds.push(clientM2.id);
  await admin.from('account_state').insert({ client_id: clientM2.id, unallocated_capital: 7777, allocated_capital: 0, asset_returns: 0 });
  // A real row for a genuinely different (past) month, seeded directly — standing in for real
  // history from a prior month, the same "manipulate real stored state to represent time
  // having passed" technique already established for the HYS maturity-transition fix.
  const pastMonth = realMonthStart.slice(0, 8) === realMonthStart.slice(0, 8) ? (function () {
    var d = new Date(realMonthStart + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 8) + '01';
  })() : null;
  await admin.from('portfolio_value_snapshots').insert({ client_id: clientM2.id, month_start_date: pastMonth, value_at_anchor: 999999 });
  const clientM2Auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await clientM2Auth.auth.signInWithPassword({ email: clientM2.email, password: 'VerifyDashFix-2026!' });
  const { data: sessM2 } = await clientM2Auth.auth.getSession();
  const resM2 = await fetch(url + '/functions/v1/get-portfolio-monthly-change', { method: 'POST', headers: { 'Authorization': 'Bearer ' + sessM2.session.access_token, 'Content-Type': 'application/json' }, body: '{}' });
  const bodyM2 = await resM2.json();
  check('the stale past-month anchor (999999) is genuinely IGNORED — this counts as this client\'s first real check THIS month', bodyM2.anchorValue === 7777 && bodyM2.changePercent === 0, JSON.stringify(bodyM2));
  check('the real current month_start_date is used, distinct from the seeded past month', bodyM2.monthStartDate === realMonthStart && bodyM2.monthStartDate !== pastMonth, JSON.stringify({ current: bodyM2.monthStartDate, past: pastMonth }));

  console.log('\n1d. A genuinely $0 anchor, then real money arriving the same month — honest null%, never NaN/Infinity');
  const clientM3 = await createTestClient(admin, 'MonthlyZeroAnchor', suffix);
  createdClientIds.push(clientM3.id);
  const clientM3Auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await clientM3Auth.auth.signInWithPassword({ email: clientM3.email, password: 'VerifyDashFix-2026!' });
  async function sessionHeaderFor(authClient) {
    const { data: s } = await authClient.auth.getSession();
    return 'Bearer ' + s.session.access_token;
  }
  const zeroRes = await fetch(url + '/functions/v1/get-portfolio-monthly-change', { method: 'POST', headers: { 'Authorization': await sessionHeaderFor(clientM3Auth), 'Content-Type': 'application/json' }, body: '{}' });
  const zeroBody = await zeroRes.json();
  check('a genuinely $0 client (no account_state row at all yet) shows changePercent 0, anchor 0 — real, not fabricated', zeroBody.anchorValue === 0 && zeroBody.currentValue === 0 && zeroBody.changePercent === 0, JSON.stringify(zeroBody));

  await admin.from('account_state').insert({ client_id: clientM3.id, unallocated_capital: 2500, allocated_capital: 0, asset_returns: 0 });
  const afterDepositRes = await fetch(url + '/functions/v1/get-portfolio-monthly-change', { method: 'POST', headers: { 'Authorization': await sessionHeaderFor(clientM3Auth), 'Content-Type': 'application/json' }, body: '{}' });
  const afterDepositBody = await afterDepositRes.json();
  check('after real money arrives against a real $0 anchor, changePercent is honestly null — never NaN/Infinity/a guessed number', afterDepositBody.anchorValue === 0 && afterDepositBody.currentValue === 2500 && afterDepositBody.changePercent === null && Math.abs(afterDepositBody.changeAmount - 2500) < 1e-9, JSON.stringify(afterDepositBody));

  console.log('\n1e. Real dashboard.html UI — the badge renders the real positive % with real up-styling');
  await (async function () {
    const path = fileURLToPath(new URL('../dashboard.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientM.id; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 1');
    const D = dom.window.document;
    const badge = D.getElementById('tpv-monthly-change');

    // This context's own MarketswaveData still resolves the ADMIN-independent local bootstrap
    // client session used throughout this file (a plain client session, not admin) — reuse it
    // directly since dashboard.html only ever reads its OWN caller's data (no clientId param).
    // Sign in as clientM through the shared client so the page's own real calls authenticate
    // as clientM specifically.
    const sharedClient = await MarketswaveData.getSupabaseClient();
    await sharedClient.auth.signInWithPassword({ email: clientM.email, password: 'VerifyDashFix-2026!' });

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(badge.innerHTML); }, 20000);
    check('the real badge shows the real +50.0% figure (clientM\'s own real current state)', badge.textContent.trim() === '+50.0% this month', badge.textContent);
    check('the real badge uses the real "up" styling (emerald)', badge.className.indexOf('emerald') !== -1, badge.className);
  })();

  // ===========================================================================================
  // PART 2 — Asset Returns / Best Performing Class, real deliberately-varied holdings mix
  // ===========================================================================================
  console.log('\n=== PART 2: Asset Returns + Best Performing Class — real, deliberately-varied holdings ===\n');

  const { data: productsForTest } = await admin.from('products').select('id,name,asset_class,unit_price').in('name', ['Global Equity ETF', 'Ethereum', 'Nordic Growth Fund']);
  const equityEtf = productsForTest.find(function (p) { return p.name === 'Global Equity ETF'; });
  const ethereum = productsForTest.find(function (p) { return p.name === 'Ethereum'; });
  const nordic = productsForTest.find(function (p) { return p.name === 'Nordic Growth Fund'; });
  check('all 3 real seeded products this test needs exist', !!equityEtf && !!ethereum && !!nordic, JSON.stringify(productsForTest));

  const clientR = await createTestClient(admin, 'Returns', suffix);
  createdClientIds.push(clientR.id);
  const REALIZED_RETURNS = 2500;
  await admin.from('account_state').insert({ client_id: clientR.id, unallocated_capital: 3000, allocated_capital: 0, asset_returns: REALIZED_RETURNS });
  // Stocks & ETFs: +10.9% unrealized. Crypto: -8.24% unrealized (a genuine loser, proving
  // "best" isn't just "first with any holding"). Private Equity: +18.4% unrealized — the
  // deliberate real winner.
  const equityUnits = 100, equityCostBasis = 10000;
  const ethUnits = 50, ethCostBasis = 6000;
  const nordicUnits = 20, nordicCostBasis = 2000;
  await admin.from('holdings').insert([
    { client_id: clientR.id, product_id: equityEtf.id, units: equityUnits, cost_basis: equityCostBasis },
    { client_id: clientR.id, product_id: ethereum.id, units: ethUnits, cost_basis: ethCostBasis },
    { client_id: clientR.id, product_id: nordic.id, units: nordicUnits, cost_basis: nordicCostBasis }
  ]);
  const expectedNordicPct = ((nordicUnits * nordic.unit_price - nordicCostBasis) / nordicCostBasis) * 100;
  const expectedEquityPct = ((equityUnits * equityEtf.unit_price - equityCostBasis) / equityCostBasis) * 100;
  const expectedEthPct = ((ethUnits * ethereum.unit_price - ethCostBasis) / ethCostBasis) * 100;
  check('the real seeded mix genuinely has Private Equity as the mathematically correct best performer (test sanity check, not app behavior)', expectedNordicPct > expectedEquityPct && expectedNordicPct > expectedEthPct, JSON.stringify({ expectedNordicPct, expectedEquityPct, expectedEthPct }));

  await (async function () {
    const path = fileURLToPath(new URL('../dashboard.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientR.id; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 1');
    const D = dom.window.document;
    const assetReturnsEl = D.getElementById('asset-returns-amount');
    const bestClassEl = D.getElementById('best-performing-class');
    const bestReturnEl = D.getElementById('best-performing-return');

    const sharedClient = await MarketswaveData.getSupabaseClient();
    await sharedClient.auth.signInWithPassword({ email: clientR.email, password: 'VerifyDashFix-2026!' });

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(assetReturnsEl.innerHTML) && !/animate-pulse/.test(bestClassEl.innerHTML); }, 20000);

    check('Asset Returns shows the EXACT real account_state.asset_returns figure ($2,500), realized-only, not blended with any unrealized figure', assetReturnsEl.textContent === '$2,500', assetReturnsEl.textContent);
    check('Best Performing Class correctly identifies Private Equity — the real mathematically-best real class, not the first/hardcoded one', bestClassEl.textContent === 'Private Equity', bestClassEl.textContent);
    check('Best Performing Class shows the real, correctly-computed unrealized % (+18.4%)', bestReturnEl.textContent.indexOf('+18.4%') === 0 && bestReturnEl.textContent.indexOf('unrealized') !== -1, bestReturnEl.textContent);
    check('the real losing class (Crypto, ' + expectedEthPct.toFixed(1) + '%) was correctly NOT chosen as best', bestClassEl.textContent !== 'Crypto');
  })();

  console.log('\n2a. A real client with NO holdings at all — honest "—" / "No holdings yet", not a fabricated best class');
  const clientR2 = await createTestClient(admin, 'ReturnsNoHoldings', suffix);
  createdClientIds.push(clientR2.id);
  await admin.from('account_state').insert({ client_id: clientR2.id, unallocated_capital: 4000, allocated_capital: 0, asset_returns: 0 });
  await (async function () {
    const path = fileURLToPath(new URL('../dashboard.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientR2.id; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 1');
    const D = dom.window.document;
    const assetReturnsEl = D.getElementById('asset-returns-amount');
    const bestClassEl = D.getElementById('best-performing-class');
    const bestReturnEl = D.getElementById('best-performing-return');

    const sharedClient = await MarketswaveData.getSupabaseClient();
    await sharedClient.auth.signInWithPassword({ email: clientR2.email, password: 'VerifyDashFix-2026!' });

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(bestClassEl.innerHTML); }, 20000);
    check('Asset Returns shows a real, honest $0 for a client who has never sold anything', assetReturnsEl.textContent === '$0', assetReturnsEl.textContent);
    check('Best Performing Class shows an honest "—", never a fabricated class', bestClassEl.textContent === '—', bestClassEl.textContent);
    check('the sub-line honestly says "No holdings yet"', bestReturnEl.textContent === 'No holdings yet', bestReturnEl.textContent);
  })();

  // ===========================================================================================
  // PART 3 — Empty-state pie chart: genuine $0 vs. real unallocated-cash-only
  // ===========================================================================================
  console.log('\n=== PART 3: Empty-state pie chart — genuine $0 vs. real unallocated-cash-only ===\n');

  console.log('3a. A genuinely $0 client (nothing deposited at all) — honest empty state, not a blank chart');
  const clientZ = await createTestClient(admin, 'ZeroTotal', suffix);
  createdClientIds.push(clientZ.id);
  // Deliberately NO account_state row at all — the real "nothing deposited, ever" case.
  await (async function () {
    const path = fileURLToPath(new URL('../dashboard.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientZ.id; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 1');
    const D = dom.window.document;
    const legendEl = D.getElementById('allocation-legend');
    const chartWrapper = D.getElementById('allocation-chart-wrapper');

    const sharedClient = await MarketswaveData.getSupabaseClient();
    await sharedClient.auth.signInWithPassword({ email: clientZ.email, password: 'VerifyDashFix-2026!' });

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(legendEl.innerHTML); }, 20000);
    check('the real chart canvas wrapper is genuinely hidden for a $0 client', chartWrapper.classList.contains('hidden'), chartWrapper.className);
    check('a real, honest empty-state message renders ("No capital deployed yet.")', legendEl.textContent.indexOf('No capital deployed yet.') !== -1, legendEl.textContent);
    const deployLink = legendEl.querySelector('a[href="deploy-capital.html"]');
    check('a real "Deploy Capital" link pointing at deploy-capital.html renders', !!deployLink && deployLink.textContent.trim() === 'Deploy Capital', legendEl.innerHTML);
  })();

  console.log('\n3b. Real unallocated cash, nothing allocated yet — normal render, real 100% Unallocated slice');
  const clientU = await createTestClient(admin, 'UnallocatedOnly', suffix);
  createdClientIds.push(clientU.id);
  await admin.from('account_state').insert({ client_id: clientU.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
  await (async function () {
    const path = fileURLToPath(new URL('../dashboard.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientU.id; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 1');
    const D = dom.window.document;
    const legendEl = D.getElementById('allocation-legend');
    const chartWrapper = D.getElementById('allocation-chart-wrapper');

    const sharedClient = await MarketswaveData.getSupabaseClient();
    await sharedClient.auth.signInWithPassword({ email: clientU.email, password: 'VerifyDashFix-2026!' });

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(legendEl.innerHTML); }, 20000);
    check('the real chart canvas wrapper is genuinely NOT hidden — this is not the empty-state case', !chartWrapper.classList.contains('hidden'), chartWrapper.className);
    check('the real legend shows a genuine 100.0% Unallocated / Cash slice, no empty-state message', legendEl.textContent.indexOf('Unallocated / Cash') !== -1 && legendEl.textContent.indexOf('100.0%') !== -1 && legendEl.textContent.indexOf('No capital deployed yet') === -1, legendEl.textContent);
  })();

  // ===========================================================================================
  // PART 4 — settings.html: real investigation result (stormarem@gmail.com), real hint
  // behavior for both the genuinely-empty and genuinely-populated cases
  // ===========================================================================================
  console.log('\n=== PART 4: settings.html — real Legal Name/Address/ID Document investigation + hint ===\n');

  const { data: realClientRow } = await admin.from('clients').select('*').eq('email', 'stormarem@gmail.com').maybeSingle();
  if (realClientRow) {
    const { data: realProfileRow } = await admin.from('client_profiles').select('*').eq('client_id', realClientRow.id).maybeSingle();
    const { data: realRequests } = await admin.from('profile_change_requests').select('id').eq('client_id', realClientRow.id);
    console.log('  REAL INVESTIGATION RESULT for stormarem@gmail.com (client ' + realClientRow.id + '):');
    console.log('    client_profiles row exists: ' + (!!realProfileRow));
    console.log('    real profile_change_requests ever submitted: ' + (realRequests ? realRequests.length : 0));
    check('CONFIRMED: this real client genuinely has no client_profiles row and zero profile_change_requests ever — the "—" display is honest, not a bug', !realProfileRow && realRequests && realRequests.length === 0, JSON.stringify({ realProfileRow, requestCount: realRequests && realRequests.length }));
  } else {
    console.log('  stormarem@gmail.com not found on this local stack instance — reporting, not asserting (see the write-up for what was found when this was directly investigated).');
  }

  const clientS = await createTestClient(admin, 'SettingsHint', suffix);
  createdClientIds.push(clientS.id);
  await (async function () {
    const path = fileURLToPath(new URL('../settings.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.eval(readFileSync(fileURLToPath(new URL('../format-helpers.js', import.meta.url)), 'utf8'));
    dom.window.getAuthenticatedClientId = function () { return clientS.id; };
    dom.window.getClient = function () { return null; };
    dom.window.clientScopedKey = function (key) { return key + ':' + clientS.id; };
    dom.window.getClientSecurityState = function () { return { forcePasswordReset: false }; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 5');
    const S = dom.window.document;

    const sharedClient = await MarketswaveData.getSupabaseClient();
    await sharedClient.auth.signInWithPassword({ email: clientS.email, password: 'VerifyDashFix-2026!' });

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(S.getElementById('legalName-display').innerHTML); }, 20000);

    check('a real client with no client_profiles row shows the honest "—" for Legal Name', S.getElementById('legalName-display').textContent === '—');
    check('the real new helper hint is genuinely VISIBLE for the genuinely-empty Legal Name field', !S.getElementById('legalName-empty-hint').classList.contains('hidden'));
    check('the real new helper hint is genuinely VISIBLE for the genuinely-empty Address field', !S.getElementById('address-empty-hint').classList.contains('hidden'));
    check('the real new helper hint is genuinely VISIBLE for the genuinely-empty ID Document field', !S.getElementById('idDocument-empty-hint').classList.contains('hidden'));

    // A real approved change, standing in directly (the approve-profile-change round trip
    // itself is already proven end-to-end by verify-admin-final-wiring.mjs — this test's own
    // job is the hint's correctness, not re-proving that flow a third time).
    await admin.from('client_profiles').insert({ client_id: clientS.id, legal_name: { firstName: 'Real', lastName: 'Name' } });

    const path2 = fileURLToPath(new URL('../settings.html', import.meta.url));
    const dom2 = buildPageDom(path2);
    dom2.window.MarketswaveData = MarketswaveData;
    dom2.window.eval(readFileSync(fileURLToPath(new URL('../format-helpers.js', import.meta.url)), 'utf8'));
    dom2.window.getAuthenticatedClientId = function () { return clientS.id; };
    dom2.window.getClient = function () { return null; };
    dom2.window.clientScopedKey = function (key) { return key + ':' + clientS.id; };
    dom2.window.getClientSecurityState = function () { return { forcePasswordReset: false }; };
    const script2 = extractInlineScript(path2, 'UI Wiring — Stage 5');
    const S2 = dom2.window.document;
    dom2.window.eval(script2);
    await pollUntil(function () { return S2.getElementById('legalName-display').textContent === 'Real Name'; }, 20000);

    check('a real, now-populated Legal Name genuinely hides its own hint', S2.getElementById('legalName-empty-hint').classList.contains('hidden'), S2.getElementById('legalName-empty-hint').className);
    check('Address (still genuinely empty) keeps showing its own hint — per-field independence, not a global toggle', !S2.getElementById('address-empty-hint').classList.contains('hidden'));
  })();

  } finally {
    for (const id of createdClientIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }

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
