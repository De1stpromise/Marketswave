#!/usr/bin/env node
// UI Wiring — Stage 2 (2026-09-03): asset-collection.html and asset-performance.html move
// from engine-core.js/localStorage to real Supabase calls (local stack). Same substitute-for-
// an-unavailable-browser-tool discipline as Stage 1's verify-dashboard-ui-wiring.mjs — NO
// BROWSER AUTOMATION TOOL IS AVAILABLE IN THIS SESSION (checked again, not assumed carried
// over from last time) — but this stage's real write actions (Request Allocation, Sell) are
// driven by delegated click handlers with real `closest()` DOM traversal, which Stage 1's own
// hand-rolled minimal FakeElement stub can't faithfully simulate. Rather than hand-roll a
// bigger, increasingly-fragile fake DOM, this script uses `jsdom` (installed as a real
// devDependency in scripts/package.json — a persistent addition, not install-then-remove,
// since every future UI-wiring stage will need the exact same real-click-simulation
// capability) — a REAL DOM implementation, so `closest()`/`querySelectorAll()`/`.click()`/
// event bubbling all work exactly as a real browser's would, with zero custom stub logic.
//
// Both real HTML files' own <body> markup is extracted VERBATIM (not hand-reconstructed) and
// loaded into jsdom; both real inline <script> blocks are extracted VERBATIM and run via
// `window.eval()` inside that real DOM. The one seam substituted, same as Stage 1, disclosed
// plainly: supabase-config.js's own CDN import is redirected to the local npm package via
// lib/esm-loader-supabase-cdn.mjs — every other line of every real file runs unmodified.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-asset-pages-ui-wiring.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

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

// Extracts a real inline <script> block verbatim by a unique marker string inside it — not
// retyped, not paraphrased.
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
  const target = scripts.find(function (s) { return s.indexOf(marker) !== -1; });
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}

// Extracts the real <body>...</body> markup verbatim, with all <script> tags stripped (each
// page's real scripts are extracted and run separately, deliberately, not auto-executed by
// jsdom itself) — the DOM structure a real browser would build from this file, unmodified.
function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!bodyMatch) throw new Error('Could not find <body> in ' + htmlPath);
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

function buildPageDom(htmlPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only'
  });
  return dom;
}

async function main() {
  console.log('UI Wiring — Stage 2 verification (asset-collection.html + asset-performance.html), substituting for an unavailable browser tool\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'assetwiring-' + suffix + '@test.marketswave.local';
  const password = 'VerifyAssetWiring-2026!';

  // ---- Load the real supabase-data.js ONCE, exactly as Stage 1 does, capturing whichever
  // window it attaches MarketswaveData to — reassigned onto each page's own jsdom window
  // below, without re-running supabase-data.js's own module code a second time. ----
  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;

  try {

  const { data: productsRow } = await admin.from('products').select('id,name,minimum_investment').in('name', ['Nordic Growth Fund', 'Global Equity ETF', 'Ethereum']);
  const nordicFund = productsRow.find(function (p) { return p.name === 'Nordic Growth Fund'; });
  const equityEtf = productsRow.find(function (p) { return p.name === 'Global Equity ETF'; });
  const ethereum = productsRow.find(function (p) { return p.name === 'Ethereum'; });
  check('all 3 real seeded products this test needs exist', !!nordicFund && !!equityEtf && !!ethereum, JSON.stringify(productsRow));

  const UNALLOCATED = 12345.67;
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: UNALLOCATED, allocated_capital: 0, asset_returns: 0 });
  // Real holdings on the ETF and Ethereum, seeded upfront (not added mid-test) — deliberately,
  // so both real Sell buttons exist from the very first real page render.
  // reloadTableAndRequests() is a private closure inside asset-performance.html's own IIFE,
  // unreachable from outside it (confirmed directly, not assumed) — there is no way for this
  // test to trigger a real mid-test reload itself, so both holdings this test needs must be
  // present before the page script ever runs. Deliberately NOT Nordic Growth Fund for the
  // second holding — Part 1's own "a real unheld product shows No position" check needs
  // Nordic to stay genuinely unheld throughout, and Part 1's own "below minimum investment"
  // rejection test also targets Nordic specifically; using it here too would silently
  // contradict both (a real bug caught on the first run of this exact script, not assumed
  // safe).
  const ETF_UNITS = 20.5;
  const ETHEREUM_UNITS = 5;
  await admin.from('holdings').insert([
    { client_id: clientId, product_id: equityEtf.id, units: ETF_UNITS, cost_basis: 2000 },
    { client_id: clientId, product_id: ethereum.id, units: ETHEREUM_UNITS, cost_basis: 500 }
  ]);

  const client = await MarketswaveData.getSupabaseClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  check('real signInWithPassword against the local stack succeeds', !signInErr, signInErr && signInErr.message);

  // ===========================================================================================
  // PART 1 — asset-collection.html
  // ===========================================================================================
  console.log('\n=== PART 1: asset-collection.html ===\n');

  const collectionPath = fileURLToPath(new URL('../asset-collection.html', import.meta.url));
  const collectionDom = buildPageDom(collectionPath);
  collectionDom.window.MarketswaveData = MarketswaveData;
  collectionDom.window.getClientInitials = function (name) { return name.slice(0, 2).toUpperCase(); };

  const collectionScript = extractInlineScript(collectionPath, 'UI Wiring — Stage 2');
  const grid = collectionDom.window.document.getElementById('asset-cards-grid');

  collectionDom.window.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8')); // asset-mark.js: the page's own <script src> in a real browser (row 207)
  collectionDom.window.eval(collectionScript);
  check('the loading skeleton genuinely appears immediately (asset-collection.html grid)', /animate-pulse/.test(grid.innerHTML), grid.innerHTML.slice(0, 200));

  await pollUntil(function () { return !/animate-pulse/.test(grid.innerHTML); }, 20000);
  // The seeded catalog (row 202) has more products than one page of nine: page through
  // Load More so the cards this test looks for are rendered wherever they fall.
  { const lm = collectionDom.window.document.getElementById('load-more-btn'); for (let i = 0; i < 40 && lm && !lm.classList.contains('hidden'); i++) { lm.click(); await new Promise(function (r) { setTimeout(r, 100); }); } }
  check('real products render as cards after the real load completes', grid.innerHTML.indexOf('Nordic Growth Fund') !== -1 && grid.innerHTML.indexOf('Global Equity ETF') !== -1, grid.innerHTML.slice(0, 400));

  const etfCard = grid.querySelector('[data-product-id="' + equityEtf.id + '"]');
  const nordicCard = grid.querySelector('[data-product-id="' + nordicFund.id + '"]');
  // Catalog expansion (2026-09-14, row 211): the card footer carries EITHER the minimum
  // (unheld) OR the position (held), never both — the old "No position" text is gone.
  check('the real held product (Global Equity ETF) shows its real position in the footer (.cat-pos), not a minimum', etfCard && !!etfCard.querySelector('.cat-pos') && !etfCard.querySelector('.cat-min') && etfCard.classList.contains('is-held'), etfCard && etfCard.textContent);
  check('a real unheld product (Nordic Growth Fund) shows its minimum in the footer (.cat-min), no position', nordicCard && !!nordicCard.querySelector('.cat-min') && !nordicCard.querySelector('.cat-pos') && !nordicCard.classList.contains('is-held'), nordicCard && nordicCard.textContent);
  check('the held card\'s button reads "Add", the unheld card\'s "Allocate"', etfCard.querySelector('.request-allocation-btn').textContent.trim() === 'Add' && nordicCard.querySelector('.request-allocation-btn').textContent.trim() === 'Allocate');

  const toastEl = collectionDom.window.document.getElementById('allocation-toast');
  const toastTitleEl = collectionDom.window.document.getElementById('allocation-toast-title');
  const toastBodyEl = collectionDom.window.document.getElementById('allocation-toast-body');
  const CD = collectionDom.window.document;
  const modal = CD.getElementById('alloc-modal');
  const amount = CD.getElementById('alloc-amount');
  const submit = CD.getElementById('alloc-submit');
  const errEl = CD.getElementById('alloc-error');
  const errText = CD.getElementById('alloc-error-text');
  function typeAmount(v) { amount.value = v; amount.dispatchEvent(new collectionDom.window.Event('input', { bubbles: true })); }

  // ---- WRITE TEST 1 — a real successful allocation request round trip, through the modal. ----
  console.log('\n1. Request Allocation — a real successful round trip through the allocation panel');
  await (async function () {
    etfCard.querySelector('.request-allocation-btn').click();
    check('clicking Add opens the allocation panel over the catalog (no page change)', modal.hidden === false && CD.getElementById('alloc-title').textContent.indexOf('Global Equity ETF') !== -1, CD.getElementById('alloc-title').textContent);
    check('the field label carries the real Available figure', CD.getElementById('alloc-available').textContent === '$12,346', CD.getElementById('alloc-available').textContent);
    check('with no amount typed the button is disabled and the error line is reserved but hidden', submit.disabled === true && errEl.classList.contains('is-hidden'));
    typeAmount('1500');
    check('a valid amount enables the button, shows the units and what the position becomes', submit.disabled === false && /units/.test(CD.getElementById('alloc-units').textContent) && CD.getElementById('alloc-after1-k').textContent === 'Position becomes' && CD.getElementById('alloc-after2-v').textContent === '$10,846', CD.getElementById('alloc-units').textContent + ' / ' + CD.getElementById('alloc-after1-v').textContent + ' / ' + CD.getElementById('alloc-after2-v').textContent);
    var bodyBefore = toastBodyEl.textContent;
    submit.click();
    check('the button shows a genuine busy state immediately after clicking (withButtonBusy)', submit.disabled === true, submit.outerHTML);

    // Polls for the toast BODY to genuinely change from its prior value, not just "not
    // hidden" — a still-visible toast left over from an earlier test could otherwise satisfy
    // that condition immediately, before this test's own click has done anything at all.
    await pollUntil(function () { return !toastEl.classList.contains('hidden') && toastBodyEl.textContent !== bodyBefore; }, 15000);
    check('the toast shows the real success message', toastTitleEl.textContent === 'Allocation Request Sent' && toastBodyEl.textContent.indexOf('$1,500') !== -1, toastTitleEl.textContent + ' / ' + toastBodyEl.textContent);
    check('the panel closes on success', modal.hidden === true);

    const { data: rows } = await admin.from('allocation_requests').select('*').eq('client_id', clientId).eq('product_id', equityEtf.id);
    check('a real, single pending allocation_requests row was genuinely created', rows && rows.length === 1 && rows[0].status === 'pending' && rows[0].requested_amount === 1500, JSON.stringify(rows));
  })();

  // ---- WRITE TEST 2 — below the product's minimum: validated BEFORE submit, in the panel. ----
  console.log('\n2. Request Allocation — below the minimum investment is caught before submit');
  await (async function () {
    nordicCard.querySelector('.request-allocation-btn').click();
    check('clicking Allocate on an unheld product opens the panel in the new-position state', modal.hidden === false && CD.getElementById('alloc-after1-k').textContent === 'This would be' && /Allocate to Nordic Growth Fund/.test(CD.getElementById('alloc-title').textContent));
    check('a Private Equity product\'s gate note mentions illiquidity and the full term', /illiquid/.test(CD.getElementById('alloc-gate').textContent) && /full term/.test(CD.getElementById('alloc-gate').textContent), CD.getElementById('alloc-gate').textContent);
    const heightBefore = modal.querySelector('.cat-modal').childElementCount; // every row exists in every state
    typeAmount('500'); // below Nordic Growth Fund's real minimum
    check('a below-minimum amount shows a REAL error naming the minimum, mutes the result and disables the button', !errEl.classList.contains('is-hidden') && /minimum/.test(errText.textContent) && errText.textContent.indexOf('$' + Number(nordicFund.minimum_investment).toLocaleString('en-US')) !== -1 && CD.getElementById('alloc-result').classList.contains('is-muted') && submit.disabled === true, errText.textContent);
    check('the error line is the same element that was reserved while hidden — no row appeared or vanished', modal.querySelector('.cat-modal').childElementCount === heightBefore && CD.getElementById('alloc-after1-v').textContent === '—');
    submit.click();
    const { data: rows } = await admin.from('allocation_requests').select('*').eq('client_id', clientId).eq('product_id', nordicFund.id);
    check('genuinely ZERO allocation_requests rows were created — the disabled button never submitted', rows && rows.length === 0, JSON.stringify(rows));
    CD.getElementById('alloc-cancel').click();
    check('Cancel closes the panel', modal.hidden === true);
  })();

  // ---- WRITE TEST 3 — real server-side rejection via a genuine concurrent change: the panel
  // validated against the Available figure it loaded, the real balance moved underneath it. ----
  console.log('\n3. Request Allocation — genuinely rejected server-side (capital moved after the panel loaded)');
  await (async function () {
    etfCard.querySelector('.request-allocation-btn').click();
    typeAmount('9000'); // within the $12,345.67 the panel was loaded with
    check('the amount passes the panel\'s own validation against the figure it loaded', submit.disabled === false && errEl.classList.contains('is-hidden'));
    // The real balance drops from a separate path between validation and submit.
    await admin.from('account_state').update({ unallocated_capital: 1000 }).eq('client_id', clientId);
    submit.click();
    await pollUntil(function () { return !errEl.classList.contains('is-hidden') && /exceeds current unallocated capital/.test(errText.textContent); }, 15000);
    check('the REAL "exceeds current unallocated capital" server message is shown inline in the panel, which stays open', modal.hidden === false && /exceeds current unallocated capital/.test(errText.textContent), errText.textContent);
    check('the amount was NOT cleared on failure (so the client can see/fix their own input)', /^9,?000$/.test(amount.value), amount.value);
    const { data: rows } = await admin.from('allocation_requests').select('*').eq('client_id', clientId).eq('product_id', equityEtf.id).eq('requested_amount', 9000);
    check('genuinely ZERO allocation_requests rows were created for this rejected attempt', rows && rows.length === 0, JSON.stringify(rows));
    await admin.from('account_state').update({ unallocated_capital: UNALLOCATED }).eq('client_id', clientId);
    CD.getElementById('alloc-modal-close').click();
  })();

  // ===========================================================================================
  // PART 2 — asset-performance.html
  // ===========================================================================================
  console.log('\n=== PART 2: asset-performance.html ===\n');

  const performancePath = fileURLToPath(new URL('../asset-performance.html', import.meta.url));
  const performanceDom = buildPageDom(performancePath);
  performanceDom.window.MarketswaveData = MarketswaveData;

  const performanceScript = extractInlineScript(performancePath, 'UI Wiring — Stage 2');
  const tableBody = performanceDom.window.document.getElementById('return-table-body');
  // The summary cards became Total portfolio value / Unrealised / Realised gains on
  // 2026-09-09 (row 187); 'Total Allocated Capital' no longer exists on this page. The
  // check below moved to the Total portfolio value card, which is the figure on this row
  // that is still independently computable from the seeded holdings.
  // Row 250 (2026-09-19): the Total portfolio value card became the Total ACCOUNT value card,
  // which adds savings pockets and realised gains to the same figure; this client has neither,
  // so the same independently-computed number is what must render (now to the cent).
  const tpvEl = performanceDom.window.document.getElementById('ap-total-amount');
  const myRequestsListEl = performanceDom.window.document.getElementById('my-requests-list');

  performanceDom.window.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8')); // asset-mark.js (row 207)
  performanceDom.window.eval(performanceScript);
  check('the loading skeleton genuinely appears immediately (Return Table)', /animate-pulse/.test(tableBody.innerHTML), tableBody.innerHTML.slice(0, 200));
  check('the loading skeleton genuinely appears immediately (summary cards)', /animate-pulse/.test(tpvEl.innerHTML), tpvEl.innerHTML);

  await pollUntil(function () { return !/animate-pulse/.test(tableBody.innerHTML); }, 20000);

  const { data: liveEtf } = await admin.from('products').select('unit_price').eq('id', equityEtf.id).single();
  const { data: liveEthereum } = await admin.from('products').select('unit_price').eq('id', ethereum.id).single();
  const expectedAllocated = Math.round(ETF_UNITS * liveEtf.unit_price + ETHEREUM_UNITS * liveEthereum.unit_price);
  // Total portfolio value is allocated + unallocated, so this still checks the same
  // thing the allocated-capital assertion did: a real money figure computed here from
  // the seeded holdings and the live unit prices, not read back from the page's own call.
  const expectedTpv = Math.round(ETF_UNITS * liveEtf.unit_price + ETHEREUM_UNITS * liveEthereum.unit_price + UNALLOCATED);
  // Per-position rounded, THEN summed — the engine's own order (rows 185/250). A raw sum differs
  // by a cent at some prices, which is a latent flake, not a page bug.
  const r2c = (n) => Math.round(n * 100) / 100;
  const expectedAccountValue = r2c(r2c(ETF_UNITS * liveEtf.unit_price) + r2c(ETHEREUM_UNITS * liveEthereum.unit_price) + UNALLOCATED);
  check('the Total account value card shows the real, independently-computed figure (both real holdings + unallocated; no pockets, no realised for this client)', tpvEl.textContent === '$' + expectedAccountValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), tpvEl.textContent + ' vs expected $' + expectedAccountValue.toFixed(2));
  check('Return Table shows a real row for the seeded ETF holding, with a real Sell button', tableBody.textContent.indexOf('Global Equity ETF') !== -1 && !!tableBody.querySelector('.sell-request-btn'), tableBody.innerHTML.slice(0, 400));

  const perfToastEl = performanceDom.window.document.getElementById('allocation-toast');
  const perfToastTitleEl = performanceDom.window.document.getElementById('allocation-toast-title');
  const perfToastBodyEl = performanceDom.window.document.getElementById('allocation-toast-body');
  const sellModal = performanceDom.window.document.getElementById('sell-modal');

  // ---- WRITE TEST 4 — a real successful sell request round trip. ----
  console.log('\n4. Sell — a real successful round trip');
  await (async function () {
    const sellBtn = tableBody.querySelector('.sell-request-btn');
    sellBtn.click();
    check('the Sell modal genuinely opens', !sellModal.classList.contains('hidden'));

    const submitBtn = performanceDom.window.document.getElementById('sell-submit');
    submitBtn.click();
    check('the submit button shows a genuine busy state immediately', submitBtn.disabled === true);

    await pollUntil(function () { return !perfToastEl.classList.contains('hidden'); }, 15000);
    check('the toast shows the real success message', perfToastTitleEl.textContent === 'Sell Request Sent' && perfToastBodyEl.textContent.indexOf('Global Equity ETF') !== -1, perfToastTitleEl.textContent + ' / ' + perfToastBodyEl.textContent);
    check('the Sell modal genuinely closes on success', sellModal.classList.contains('hidden'));

    const { data: rows } = await admin.from('sell_requests').select('*').eq('client_id', clientId).eq('product_id', equityEtf.id);
    check('a real, single pending sell_requests row was genuinely created, for the FULL held units (Sell All)', rows && rows.length === 1 && rows[0].status === 'pending' && Math.abs(rows[0].units_to_sell - ETF_UNITS) < 1e-9, JSON.stringify(rows));

    await pollUntil(function () { return !/animate-pulse/.test(tableBody.innerHTML); }, 20000);
    // Scoped to the ETF's own row specifically — Ethereum's own real, untouched Sell button
    // is expected to still be present elsewhere in the same table (a real bug in this exact
    // check, caught on this script's own first run: an unscoped query found Ethereum's button
    // and wrongly treated the whole table as "still has an enabled Sell button" for the ETF).
    // The disabled-button variant carries no data-product-id at all (confirmed by reading
    // asset-performance.html's own renderReturnTable() directly), so its ABSENCE for this
    // specific id is the correct signal.
    check('the Return Table genuinely refreshed after the real sell request — the ETF row’s own Sell button is now disabled (pending covers its full position)', !tableBody.querySelector('.sell-request-btn[data-product-id="' + equityEtf.id + '"]'), tableBody.innerHTML.slice(0, 800));
    check('My Requests genuinely refreshed and shows the real new Sell request', myRequestsListEl.textContent.indexOf('Sell') !== -1 && myRequestsListEl.textContent.indexOf('Pending') !== -1, myRequestsListEl.textContent.slice(0, 300));
  })();

  // ---- WRITE TEST 5 — real server-side rejection: a genuine race (units held drop below
  // what the client's own already-open modal still believes is available). ----
  console.log('\n5. Sell — genuinely rejected server-side (a real concurrent-change race)');
  await (async function () {
    // The Ethereum holding was seeded upfront alongside the ETF one (see the setup above) and
    // is genuinely untouched by WRITE TEST 4 (which only ever sold the ETF) — its own Sell
    // button already exists in the real, already-refreshed Return Table from test 4's own
    // internal reloadTableAndRequests(true) call, re-queried fresh here since the table's
    // DOM was rebuilt by that refresh.
    const ethereumSellBtn = [...tableBody.querySelectorAll('.sell-request-btn')].find(function (b) { return b.dataset.productId === ethereum.id; });
    check('a real Sell button exists for the seeded Ethereum holding', !!ethereumSellBtn);
    const bodyBeforeRace = perfToastBodyEl.textContent;
    ethereumSellBtn.click();
    check('the Sell modal opens showing the full 5 units as available (the client’s own current understanding)', /^5\.00(00)? units$/.test(performanceDom.window.document.getElementById('sell-available-units').textContent.trim()), performanceDom.window.document.getElementById('sell-available-units').textContent);

    // A genuine concurrent change — e.g. a real admin-approved partial sell via a completely
    // separate path — reduces the REAL holding out from under the client's own already-open
    // modal, which still holds the STALE, now-too-high 5-unit figure.
    await admin.from('holdings').update({ units: 2 }).eq('client_id', clientId).eq('product_id', ethereum.id);

    const submitBtn = performanceDom.window.document.getElementById('sell-submit');
    submitBtn.click();

    // Poll for the toast body to genuinely CHANGE from whatever it showed before this click —
    // not just "not hidden", which a still-visible toast from an earlier test could already
    // satisfy (a real timing bug this exact check caught on this script's own first run).
    await pollUntil(function () { return !perfToastEl.classList.contains('hidden') && perfToastBodyEl.textContent !== bodyBeforeRace; }, 15000);
    check('the toast shows "Request Not Sent"', perfToastTitleEl.textContent === 'Request Not Sent', perfToastTitleEl.textContent);
    check('the toast shows the REAL server rejection message for the real race (not a generic error)', perfToastBodyEl.textContent.indexOf('Cannot request to sell more units than are currently held') !== -1, perfToastBodyEl.textContent);
    check('the Sell modal stays OPEN on a genuine failure (not silently closed)', !sellModal.classList.contains('hidden'));

    const { data: rows } = await admin.from('sell_requests').select('*').eq('client_id', clientId).eq('product_id', ethereum.id);
    check('genuinely ZERO sell_requests rows were created for the rejected (raced) attempt', rows && rows.length === 0, JSON.stringify(rows));
  })();

  } finally {
    // ---- Cleanup — runs even if an assertion above threw. ----
    await admin.from('allocation_requests').delete().eq('client_id', clientId);
    await admin.from('sell_requests').delete().eq('client_id', clientId);
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
