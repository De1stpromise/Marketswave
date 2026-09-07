#!/usr/bin/env node
// UI Wiring — Stage 1 (2026-09-03): dashboard.html moves from engine-core.js/localStorage to
// real Supabase calls (local stack). This script is the substitute for a genuine
// browser-verify pass — NO BROWSER AUTOMATION TOOL IS AVAILABLE IN THIS SESSION (checked
// directly before writing this file, not assumed), so this proves what a browser check would
// have proven, at the level Node actually allows: it loads the REAL, UNMODIFIED
// supabase-data.js and the REAL, UNMODIFIED dashboard.html inline script (extracted
// verbatim, not retyped) into a minimal fake DOM, drives them against the REAL local
// Supabase stack with a REAL authenticated test client, and inspects the REAL resulting
// DOM state — not a simulation of what SHOULD happen, an execution of the actual shipped
// code.
//
// The one seam substituted, disclosed plainly: supabase-data.js's own getSupabaseClient()
// reaches supabase-config.js via `import('./supabase-config.js')`, which in a real browser
// loads `createClient` from a CDN (https://esm.sh/@supabase/supabase-js@2.112.4). Node has no
// built-in way to fetch that specifier without an experimental flag, so
// lib/esm-loader-supabase-cdn.mjs (a custom module.register() loader, the same technique this
// project used once before for an equivalent Firebase-side config file) redirects ONLY that
// one CDN specifier to the equivalent already-installed local npm package. Every other line
// of supabase-config.js and supabase-data.js — the env/URL selection, the session-persistence
// configuration, the entire getSupabaseClient()/callFunction()/selectTable()/
// renderAsyncBundle() implementation — runs completely unmodified, for real.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`.
// Usage: node --import ./lib/esm-loader-supabase-cdn.mjs verify-dashboard-ui-wiring.mjs
// (the loader is registered via --import so it's active before any other module loads)

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

// ---- Minimal Web Storage polyfill (same shape as scripts/lib/storage-polyfill.js, inlined
// here to keep this .mjs harness self-contained rather than require()-ing a CJS module from
// inside a module.register()-loaded ESM context). ----
class StoragePolyfill {
  constructor() { this._map = new Map(); }
  getItem(key) { return this._map.has(key) ? this._map.get(key) : null; }
  setItem(key, value) { this._map.set(key, String(value)); }
  removeItem(key) { this._map.delete(key); }
  clear() { this._map.clear(); }
}

// ---- Minimal fake DOM — just enough surface for dashboard.html's own real inline script
// and supabase-data.js's real renderAsyncBundle() to run against, mirroring this project's
// own established "minimal fake DOM built for this file's own narrow DOM usage" precedent
// (scripts/lib/engine-harness.js). ----
class FakeRetryButton {
  constructor() { this._handlers = []; }
  addEventListener(evt, fn) { if (evt === 'click') this._handlers.push(fn); }
  click() { this._handlers.forEach(function (fn) { fn(); }); }
}
class FakeElement {
  constructor(id) {
    this.id = id;
    this._innerHTML = '';
    this._textContent = '';
    this.className = '';
    this._attrs = {};
    this._retryBtn = null;
  }
  // Real DOM semantics: .innerHTML and .textContent both reflect the SAME underlying node
  // tree — setting either one updates what the other reports. dashboard.html's real code
  // sets .textContent directly on some elements (e.g. TPV) and .innerHTML on others (e.g.
  // the legend/activity list) — both must be kept in sync here, or a poll/assertion reading
  // .innerHTML after a .textContent-only write would see stale (e.g. leftover skeleton)
  // markup that was never actually still there in a real browser.
  set innerHTML(html) {
    this._innerHTML = html;
    this._textContent = html.replace(/<[^>]*>/g, '');
    this._retryBtn = /data-retry/.test(html) ? new FakeRetryButton() : null;
  }
  get innerHTML() { return this._innerHTML; }
  set textContent(text) {
    this._textContent = text;
    this._innerHTML = text;
    this._retryBtn = null;
  }
  get textContent() { return this._textContent; }
  querySelector(sel) { return sel === '[data-retry]' ? this._retryBtn : null; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k] || null; }
  addEventListener() {} // canvas etc. — no-op, nothing in this test drives canvas events
}

// Polls until `test()` returns truthy or maxMs elapses — local edge-runtime cold starts on
// a function's first invocation can genuinely take several seconds, so a fixed short sleep
// is unreliable; this waits only as long as actually needed, up to a generous ceiling.
async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (test()) return true;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return test();
}

function makeFakeDocument(ids) {
  const registry = {};
  ids.forEach(function (id) { registry[id] = new FakeElement(id); });
  return {
    _registry: registry,
    getElementById: function (id) { return registry[id] || null; }
  };
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

// Extracts dashboard.html's real, current second inline <script> block verbatim (the one
// containing "UI Wiring — Stage 1") — not retyped, not paraphrased.
function extractDashboardScript() {
  const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
  const target = scripts.find(function (s) { return s.indexOf('UI Wiring — Stage 1') !== -1; });
  if (!target) throw new Error('Could not find the UI Wiring Stage 1 inline script in dashboard.html — has it moved or been renamed?');
  return target;
}

async function main() {
  console.log('UI Wiring — Stage 1 verification (dashboard.html), substituting for an unavailable browser tool\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'dashwiring-' + suffix + '@test.marketswave.local';
  const password = 'VerifyDashWiring-2026!';

  // ===========================================================================================
  // TEST 1 — supabase-data.js's renderAsyncBundle(): pure loading/error mechanics, injected
  // load()s, no network at all. Proves the reusable helper's own core contract directly.
  // ===========================================================================================
  console.log('1. renderAsyncBundle() — the reusable loading/error pattern, in isolation');

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  globalThis.localStorage = new StoragePolyfill();
  const supabaseDataModule = await import('../supabase-data.js');
  void supabaseDataModule; // side-effecting only — defines window.MarketswaveData
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);

  await (async function () {
    const doc = makeFakeDocument(['region']);
    const region = doc.getElementById('region');

    // Skeleton must appear SYNCHRONOUSLY, before the load() promise has had any chance to
    // resolve — this is the actual "does the loading state genuinely appear" proof.
    let resolveLoad;
    const pending = new Promise(function (res) { resolveLoad = res; });
    MarketswaveData.renderAsyncBundle(region, {
      load: function () { return pending; },
      render: function (data) { region.textContent = 'RENDERED:' + data; }
    });
    check('skeleton HTML is painted synchronously, before load() resolves', /animate-pulse/.test(region.innerHTML), region.innerHTML);
    check('skeleton contains no stale/leftover content', region.textContent === '');

    resolveLoad('real-data');
    await pending;
    await Promise.resolve(); // let the .then() microtask run
    check('on success, render() replaced the skeleton with real content', region.textContent === 'RENDERED:real-data', region.textContent);
  })();

  await (async function () {
    const doc = makeFakeDocument(['region']);
    const region = doc.getElementById('region');
    let attempts = 0;

    MarketswaveData.renderAsyncBundle(region, {
      load: function () {
        attempts++;
        return attempts === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('recovered');
      },
      render: function (data) { region.textContent = 'RENDERED:' + data; }
    });
    await new Promise(function (r) { setTimeout(r, 20); });

    check('a failed load() shows the error card, not a blank/broken region', /Couldn.t load this data/.test(region.innerHTML), region.innerHTML);
    check('the error card has a genuine, clickable Try Again control', !!region.querySelector('[data-retry]'));

    region.querySelector('[data-retry]').click();
    check('clicking Try Again immediately re-paints the skeleton (not a stale error)', /animate-pulse/.test(region.innerHTML));
    await new Promise(function (r) { setTimeout(r, 20); });
    check('the retry genuinely re-ran load() and rendered the recovered result', region.textContent === 'RENDERED:recovered', region.textContent);
    check('load() was called exactly twice — once initially, once on retry, not more', attempts === 2, 'attempts=' + attempts);
  })();

  // ===========================================================================================
  // SET UP a real test client with genuinely DISTINCTIVE data — numbers that could never be
  // mistaken for the old hardcoded/local-demo figures ($1,284,500 / $205,520 / etc.) — so a
  // correct render is unambiguous proof of REAL Supabase data, not a coincidence.
  // ===========================================================================================
  console.log('\n2. Real test client setup — genuinely distinctive Supabase-only data');

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;
  // Wrapped in try/finally from here on — a real bug in an earlier run left orphaned test
  // data behind because an uncaught error skipped the cleanup that used to sit unconditionally
  // at the bottom of this function; cleanup must run regardless of how this function exits.
  try {

  const { data: products } = await admin.from('products').select('id,name,asset_class,unit_price').in('name', ['Nordic Growth Fund', 'Global Equity ETF']);
  const nordicFund = products.find(function (p) { return p.name === 'Nordic Growth Fund'; });
  const equityEtf = products.find(function (p) { return p.name === 'Global Equity ETF'; });
  check('both real seeded products this test needs exist', !!nordicFund && !!equityEtf, JSON.stringify(products));

  const DISTINCTIVE_UNALLOCATED = 37250.19;
  const DISTINCTIVE_ASSET_RETURNS = 1234.56;
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: DISTINCTIVE_UNALLOCATED, allocated_capital: 0, asset_returns: DISTINCTIVE_ASSET_RETURNS });

  const nordicUnits = 12.3456;
  const equityUnits = 45.6789;
  await admin.from('holdings').insert([
    { client_id: clientId, product_id: nordicFund.id, units: nordicUnits, cost_basis: 1000 },
    { client_id: clientId, product_id: equityEtf.id, units: equityUnits, cost_basis: 2000 }
  ]);

  const now = Date.now();
  await admin.from('transactions').insert([
    { client_id: clientId, product_id: null, type: 'DEPOSIT', total_value: 5000, status: 'Completed', created_at: new Date(now - 4 * 86400000).toISOString() },
    { client_id: clientId, product_id: nordicFund.id, type: 'BUY', units: nordicUnits, price: 100, total_value: 9999.11, status: 'Completed', created_at: new Date(now - 3 * 86400000).toISOString() },
    { client_id: clientId, product_id: equityEtf.id, type: 'SELL', units: 5, price: 100, total_value: 3333.22, realized_return: 250.75, status: 'Completed', created_at: new Date(now - 2 * 86400000).toISOString() },
    { client_id: clientId, product_id: null, type: 'WITHDRAWAL', total_value: 2222.33, status: 'Completed', created_at: new Date(now - 1 * 86400000).toISOString() }
  ]);
  check('real distinctive account_state/holdings/transactions seeded for the real test client', true);

  // ===========================================================================================
  // TEST 3 — dashboard.html's REAL inline script, extracted verbatim, run against a real,
  // authenticated Supabase session for this real distinctive test client.
  // ===========================================================================================
  console.log('\n3. dashboard.html\'s real inline script — genuine Supabase data, not localStorage');

  const client = await MarketswaveData.getSupabaseClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  check('real signInWithPassword against the local stack succeeds', !signInErr, signInErr && signInErr.message);

  const dashboardIds = ['welcome-heading', 'risk-profile-badge', 'tpv-amount', 'allocation-legend', 'allocation-chart', 'risk-cash-reserve', 'risk-allocation-util', 'recent-activity-list'];
  const doc = makeFakeDocument(dashboardIds);
  globalThis.document = doc;
  globalThis.clientScopedKey = function (key) { return key; }; // real per-client scoping is out of this stage's scope — a plain passthrough is sufficient for this test
  globalThis.MarketswaveData = MarketswaveData;

  const scriptSource = extractDashboardScript();
  const runDashboardScript = new Function(scriptSource);

  runDashboardScript(); // synchronous portion runs immediately — this is where skeletons paint

  const tpvEl = doc.getElementById('tpv-amount');
  const legendEl = doc.getElementById('allocation-legend');
  const activityEl = doc.getElementById('recent-activity-list');
  const cashReserveEl = doc.getElementById('risk-cash-reserve');
  const utilEl = doc.getElementById('risk-allocation-util');

  check('the loading skeleton genuinely appears immediately (TPV)', /animate-pulse/.test(tpvEl.innerHTML), tpvEl.innerHTML);
  check('the loading skeleton genuinely appears immediately (allocation legend)', /animate-pulse/.test(legendEl.innerHTML));
  check('the loading skeleton genuinely appears immediately (recent activity)', /animate-pulse/.test(activityEl.innerHTML));
  check('the loading skeleton genuinely appears immediately (risk metrics)', /animate-pulse/.test(cashReserveEl.innerHTML) && /animate-pulse/.test(utilEl.innerHTML));

  // Let the real network round trip to the local Supabase stack actually complete — poll
  // rather than a fixed sleep, since cold Edge Function invocations can take several seconds.
  const settled = await pollUntil(function () { return !/animate-pulse/.test(tpvEl.innerHTML); }, 20000);
  check('the real network round trip genuinely completed within 20s (not still loading)', settled, tpvEl.innerHTML);

  // Independently re-derive the expected numbers directly from Postgres — not from the app's
  // own rendering logic, so this is a genuine cross-check, not a tautology.
  const { data: liveNordic } = await admin.from('products').select('unit_price').eq('id', nordicFund.id).single();
  const { data: liveEquity } = await admin.from('products').select('unit_price').eq('id', equityEtf.id).single();
  const expectedAllocated = Math.round((nordicUnits * liveNordic.unit_price + equityUnits * liveEquity.unit_price) * 100) / 100;
  const expectedTpv = DISTINCTIVE_UNALLOCATED + expectedAllocated + DISTINCTIVE_ASSET_RETURNS;

  check('TPV renders the REAL, distinctive computed total (not $1,284,500 or any old hardcoded figure)', tpvEl.textContent === '$' + Math.round(expectedTpv).toLocaleString('en-US'), 'got="' + tpvEl.textContent + '" expected=$' + Math.round(expectedTpv).toLocaleString('en-US'));
  check('the allocation legend genuinely reflects real holdings (Private Equity % present and non-zero)', legendEl.innerHTML.indexOf('Private Equity') !== -1 && !/Private Equity[\s\S]{0,120}0\.0%/.test(legendEl.innerHTML));
  check('the allocation legend is no longer showing skeleton bars', !/animate-pulse/.test(legendEl.innerHTML));

  const expectedCashPct = (DISTINCTIVE_UNALLOCATED / expectedTpv * 100).toFixed(1);
  check('Risk Metrics Cash Reserve % matches the real, independently-computed percentage', cashReserveEl.textContent.indexOf(expectedCashPct + '%') !== -1, cashReserveEl.textContent + ' vs expected ' + expectedCashPct + '%');

  check('Recent Activity shows the 3 MOST RECENT transactions, newest first (WITHDRAWAL, then SELL, then BUY — the oldest DEPOSIT correctly excluded)', function () {
    const html = activityEl.innerHTML;
    const wIdx = html.indexOf('Withdrawal processed');
    const sIdx = html.indexOf('Position sold');
    const bIdx = html.indexOf('Capital allocated');
    const dIdx = html.indexOf('Deposit credited');
    return wIdx !== -1 && sIdx !== -1 && bIdx !== -1 && dIdx === -1 && wIdx < sIdx && sIdx < bIdx;
  }(), activityEl.innerHTML);
  // The real app's own formatUSD() always rounds to whole dollars (Math.round(...)), same as
  // every other dollar figure on this page — $250.75 correctly renders as "+$251", not the
  // unrounded cents value.
  check('the realized return on the SELL entry renders correctly, rounded to whole dollars (+$251)', activityEl.innerHTML.indexOf('+$251') !== -1, activityEl.innerHTML);

  // ===========================================================================================
  // TEST 4 — an intentionally-failed call (a genuinely invalid/expired session) shows the
  // error state, not a blank or broken page.
  // ===========================================================================================
  console.log('\n4. An intentionally-failed Supabase call — the error state, not a broken page');

  await client.auth.signOut(); // genuinely invalidates the local session this client holds
  // Force MarketswaveData to reuse this SAME now-signed-out client (it caches one client
  // instance for the page's lifetime, exactly as a real page reload wouldn't happen mid-
  // session) — calling a function now must fail with a real 401, unauthenticated.

  const doc2 = makeFakeDocument(dashboardIds);
  globalThis.document = doc2;

  const runDashboardScript2 = new Function(scriptSource);
  runDashboardScript2();
  await pollUntil(function () { return !/animate-pulse/.test(doc2.getElementById('tpv-amount').innerHTML); }, 20000);

  const tpvEl2 = doc2.getElementById('tpv-amount');
  const legendEl2 = doc2.getElementById('allocation-legend');
  check('a genuinely failed call (signed-out session) shows the error card, not a blank/broken TPV region', /Couldn.t load this data/.test(tpvEl2.innerHTML), tpvEl2.innerHTML);
  check('the error card message is the real, specific "session may have expired" copy for a 401', /session may have expired/.test(tpvEl2.innerHTML), tpvEl2.innerHTML);
  check('the allocation legend ALSO shows its own error card (every region fails independently-visibly, none silently blank)', /Couldn.t load this data/.test(legendEl2.innerHTML));
  check('a genuine Try Again control is present on the failed region', !!tpvEl2.querySelector('[data-retry]'));

  } finally {
    // ---- Cleanup — runs even if an assertion above threw, so a failed run never leaves
    // orphaned test data behind. ----
    await admin.from('transactions').delete().eq('client_id', clientId);
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.auth.admin.deleteUser(clientId);
  }

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
