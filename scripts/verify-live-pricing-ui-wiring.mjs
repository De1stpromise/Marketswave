#!/usr/bin/env node
// ★ Product catalog — live pricing, part 1 (2026-09-11) — UI verification.
//
// Drives the REAL, unmodified inline scripts of admin-products.html, asset-collection.html,
// asset-performance.html and transactions.html in real jsdom DOMs against the real local
// stack, real Edge Functions and real providers — the harness every UI-wiring stage has used.
//
// ★ WHAT MATTERS MOST HERE:
//   - the PM creation flow: model chosen first (and the copy says it cannot change), symbol
//     search with live prices, the exchange visibly a FALLBACK when unverified, the asset
//     class DERIVED and locked, the first price live.
//   - the impact table: built from real holders before publishing, then CROSS-CHECKED against
//     what each holder's real allocated value actually became after publishing.
//   - a quote_failed product is flagged to the PM on the real page.
//   - client cards state their price source explicitly, with the ticker and "Fractional
//     units" on market-priced products only, and fractional units render per asset.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-live-pricing-ui-wiring.mjs
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { if (await test()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return test();
}
function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}
function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  return m[1].replace(/<script[\s\S]*?<\/script>/g, '');
}
const vc = new VirtualConsole(); vc.forwardTo(console);
function buildPageDom(htmlPath) {
  return new JSDOM('<!doctype html><html><body>' + extractBodyMarkup(htmlPath) + '</body></html>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
}
const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  console.log('Product catalog — live pricing, part 1: real UI verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyLivePricingUI-2026!';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  const root = new URL('../', import.meta.url);
  const engineCoreSource = readFileSync(fileURLToPath(new URL('engine-core.js', root)), 'utf8');
  const formatHelpersSource = readFileSync(fileURLToPath(new URL('format-helpers.js', root)), 'utf8');

  async function makeClient(tag, name, cash) {
    const email = 'lpui-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await admin.from('clients').insert({ id: data.user.id, name, email: 'lpui-' + tag + '-' + data.user.id, phone: '+1', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: data.user.id, unallocated_capital: cash, allocated_capital: 0, asset_returns: 0 });
    return { id: data.user.id, name, email };
  }
  const A = await makeClient('a', 'Pricing UI Alpha', 10000);
  const B = await makeClient('b', 'Pricing UI Bravo', 10000);
  const ids = [A.id, B.id];
  const createdProductIds = [];
  const pe = (await admin.from('products').select('*').eq('id', 'PROD-0001').single()).data;
  const peBefore = { unit_price: pe.unit_price, last_tick_date: pe.last_tick_date, price_change_percent: pe.price_change_percent, price_as_of: pe.price_as_of };
  const navBefore = ((await admin.from('nav_publications').select('id').eq('product_id', 'PROD-0001')).data || []).map((r) => r.id);
  const badId = 'PROD-' + String(9500 + parseInt(suffix.slice(0, 2), 16)).padStart(4, '0');
  // This test renders the LIVE (green) and STALE (grey) states on real products. A transient
  // provider failure during a heavy suite run can leave Ethereum flagged quote_failed (which
  // is correct behaviour, covered by its own assertions below on a seeded product) — that
  // real state is captured and put back afterwards, so the rendering assertions here test
  // the page, not CoinGecko's mood at the moment the suite happened to run.
  const ethStatusBefore = (await admin.from('products').select('price_status, price_failure_reason, price_last_failed_at').eq('id', 'PROD-0004').single()).data;
  await admin.from('products').update({ price_status: 'ok', price_failure_reason: null }).eq('id', 'PROD-0004');

  try {
    // Seed: two holders on the PE product (for the impact table) and A holding some Ethereum.
    await admin.from('holdings').insert([
      { client_id: A.id, product_id: 'PROD-0001', units: 500, cost_basis: 60000 },
      { client_id: B.id, product_id: 'PROD-0001', units: 120.5, cost_basis: 15000 },
      { client_id: A.id, product_id: 'PROD-0004', units: 1.85118324, cost_basis: 5000 }
    ]);
    await admin.from('transactions').insert({ client_id: A.id, product_id: 'PROD-0004', type: 'BUY', units: 1.85118324, price: 2700.77, total_value: 5000, status: 'Completed' });
    // A product whose last refresh could not price it.
    await admin.from('products').insert({ id: badId, name: 'Flag Test ' + suffix, asset_class: 'Stocks & ETFs', investment_type: 'ETF', risk_tier: 'balanced', minimum_investment: 100, unit_price: 42.42, inception_unit_price: 42.42, created_at: '2026-09-11', last_tick_date: '2026-09-11', pricing_model: 'market', ticker: 'ZQ' + suffix.slice(0, 4).toUpperCase(), price_source: 'finnhub', price_as_of: new Date(Date.now() - 3600e3).toISOString(), price_status: 'quote_failed', price_failure_reason: 'The provider returned no usable price on the last refresh. The last known good price is retained.', price_last_failed_at: new Date().toISOString() });
    createdProductIds.push(badId);

    // ===== PART A: admin-products.html =====
    console.log('=== PART A: admin-products.html — creation flow, quote flag, publish by percentage ===\n');
    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: pmErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    check('real PM sign-in', !pmErr, pmErr && pmErr.message);
    await MarketswaveData.useAdminClient();

    const apPath = fileURLToPath(new URL('admin-products.html', root));
    function loadAdminProducts() {
      const dom = buildPageDom(apPath);
      dom.window.MarketswaveData = MarketswaveData;
      dom.window.eval(formatHelpersSource);
      dom.window.eval(extractInlineScript(apPath, 'Products Catalog Fix'));
      return dom;
    }
    let dom = loadAdminProducts();
    let D = dom.window.document;
    await pollUntil(() => D.querySelectorAll('.product-row').length > 0, 30000);

    // --- the list states each product's price source ---
    const rowText = (id) => { const r = [...D.querySelectorAll('.product-row')].find((x) => x.dataset.id === id); return r ? r.textContent : ''; };
    check('the list shows Ethereum as market-priced with its ticker and an as-of time', /ETH · as of/.test(rowText('PROD-0004')), rowText('PROD-0004').slice(0, 160));
    check('...Nordic Growth Fund as valued by appraisal with a last-valued date', /Appraisal · last valued/.test(rowText('PROD-0001')), rowText('PROD-0001').slice(0, 160));
    check('★ the quote-failed product is flagged in the list ("Quote failed · last good …")', /Quote failed/.test(rowText(badId)), rowText(badId).slice(0, 160));
    [...D.querySelectorAll('.product-row')].find((x) => x.dataset.id === badId).click();
    const flagBlock = D.getElementById('quote-failed-' + badId);
    check('...and its expanded row explains it to the PM: last good price retained, nothing overwritten with a zero', !!flagBlock && /last good price retained/i.test(flagBlock.textContent) && /\$42\.42/.test(flagBlock.textContent) && /nothing was overwritten with a zero/i.test(flagBlock.textContent), flagBlock && flagBlock.textContent.slice(0, 200));

    // --- creation flow ---
    D.getElementById('open-add-modal').click();
    check('the New product modal opens on Market-priced by default and says the model cannot be changed later', D.querySelector('.add-model-btn[data-model="market"]').getAttribute('aria-checked') === 'true' && /cannot be changed later/i.test(D.getElementById('add-modal').textContent));
    check('...the asset class select is locked (derived from the symbol) in market mode', D.getElementById('add-asset-class').disabled === true);
    check('...no starting-price field is offered for a market-priced product', D.getElementById('add-appraisal-section').classList.contains('hidden'));
    D.querySelector('.add-model-btn[data-model="appraisal"]').click();
    check('switching to Valued by appraisal reveals the PM-entered starting price and hides the search', !D.getElementById('add-appraisal-section').classList.contains('hidden') && D.getElementById('add-market-section').classList.contains('hidden') && D.getElementById('add-asset-class').disabled === false);
    check('...and the class choices are constrained to PE / Real Assets in the copy', /Private Equity and Real Assets only/.test(D.getElementById('add-asset-class-hint').textContent));
    D.querySelector('.add-model-btn[data-model="market"]').click();

    const search = D.getElementById('add-symbol-search');
    search.value = 'aapl';
    search.dispatchEvent(new dom.window.Event('input'));
    await pollUntil(() => D.querySelectorAll('.symbol-result').length > 0, 30000);
    const results = [...D.querySelectorAll('.symbol-result')];
    const aaplRow = results.find((b) => b.dataset.symbol === 'AAPL' && b.dataset.source === 'finnhub');
    check('the real symbol search lists AAPL with a live price', !!aaplRow && /\$\d/.test(aaplRow.textContent), aaplRow && aaplRow.textContent);
    check('★ a stock result\'s exchange reads as a VISIBLE fallback ("US listing · unverified"), never a confident label', !!aaplRow && /US listing/.test(aaplRow.textContent) && /unverified/.test(aaplRow.textContent), aaplRow && aaplRow.textContent);
    aaplRow.click();
    await pollUntil(() => /Price will track AAPL/.test(D.getElementById('add-live-preview-label').textContent), 30000);
    const previewLabel = D.getElementById('add-live-preview-label').textContent;
    check('picking it shows the live preview with the refresh cadence and the VERIFIED exchange (NASDAQ)', /refreshed every 15 minutes/.test(previewLabel) && /NASDAQ/.test(previewLabel) && /\$\d/.test(D.getElementById('add-live-preview-price').textContent), previewLabel + ' | ' + D.getElementById('add-live-preview-price').textContent);
    check('...and derives the asset class (Stocks & ETFs), still locked', D.getElementById('add-asset-class').value === 'Stocks & ETFs' && D.getElementById('add-asset-class').disabled === true);
    D.getElementById('add-name').value = 'Apple UI Test ' + suffix;
    D.getElementById('add-investment-type').value = 'Stock';
    D.getElementById('add-minimum-investment').value = '500';
    D.getElementById('add-maximum-investment').value = '20000';
    D.getElementById('add-description').value = 'Direct exposure to Apple.';
    const toastBefore = D.getElementById('admin-toast-body').textContent;
    D.getElementById('add-submit').click();
    await pollUntil(() => D.getElementById('admin-toast-body').textContent !== toastBefore, 30000);
    const toast = D.getElementById('admin-toast-body').textContent;
    check('★ Create product succeeds through the real UI, tracking AAPL at a live price', /tracking AAPL/.test(toast) && /\$\d/.test(toast), toast);
    const createdRow = (await admin.from('products').select('*').eq('name', 'Apple UI Test ' + suffix).maybeSingle()).data;
    check('...the real row: market model, AAPL on Finnhub, class derived, live price, max recorded', !!createdRow && createdRow.pricing_model === 'market' && createdRow.ticker === 'AAPL' && createdRow.price_source === 'finnhub' && createdRow.asset_class === 'Stocks & ETFs' && Number(createdRow.unit_price) > 1 && Number(createdRow.maximum_investment) === 20000, JSON.stringify(createdRow));
    if (createdRow) createdProductIds.push(createdRow.id);

    // --- edit: immutable model/symbol, class locked ---
    await pollUntil(() => [...D.querySelectorAll('.product-row')].some((x) => x.dataset.id === createdRow.id), 30000);
    [...D.querySelectorAll('.product-row')].find((x) => x.dataset.id === createdRow.id).click();
    [...D.querySelectorAll('.edit-btn')].find((b) => b.dataset.id === createdRow.id).click();
    check('Edit shows the pricing model as fixed at creation (read-only) — no symbol input exists', /Market-priced · tracks AAPL/.test(D.getElementById('edit-pricing-display').textContent) && !D.getElementById('edit-ticker'), D.getElementById('edit-pricing-display').textContent);
    check('...and the asset class is locked for a market-priced product', D.getElementById('edit-asset-class').disabled === true);
    D.getElementById('edit-modal-close').click();

    // --- publish by percentage with the impact table ---
    [...D.querySelectorAll('.product-row')].find((x) => x.dataset.id === 'PROD-0001').click();
    [...D.querySelectorAll('.publish-nav-btn')].find((b) => b.dataset.id === 'PROD-0001').click();
    check('the Publish valuation modal opens in percentage mode by default', D.querySelector('.nav-mode-btn[data-mode="percent"]').getAttribute('aria-checked') === 'true' && !D.getElementById('nav-percent-field').classList.contains('hidden') && D.getElementById('nav-price-field').classList.contains('hidden'));
    await pollUntil(() => D.querySelectorAll('.nav-impact-row').length >= 2, 30000);
    const current = Number(peBefore.unit_price);
    D.getElementById('nav-change-percent').value = '4.2';
    D.getElementById('nav-change-percent').dispatchEvent(new dom.window.Event('input'));
    const expectedNew = round2(current * 1.042);
    const fmt = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check('★ the live preview computes the new unit price: ' + fmt(current) + ' → ' + fmt(expectedNew), D.getElementById('nav-preview').textContent.indexOf(fmt(expectedNew)) !== -1, D.getElementById('nav-preview').textContent);
    const rows = [...D.querySelectorAll('.nav-impact-row')];
    const rowA = rows.find((r) => r.dataset.clientId === A.id), rowB = rows.find((r) => r.dataset.clientId === B.id);
    const expA = { from: round2(500 * current), to: round2(500 * expectedNew) }, expB = { from: round2(120.5 * current), to: round2(120.5 * expectedNew) };
    const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
    check('★ the impact table lists both real holders with units, current value, new value and change', !!rowA && !!rowB && rowA.textContent.indexOf('500.00 units') !== -1 && rowA.textContent.indexOf(usd(expA.from)) !== -1 && rowA.querySelector('.nav-impact-to').textContent === usd(expA.to) && rowB.querySelector('.nav-impact-to').textContent === usd(expB.to), (rowA && rowA.textContent) + ' || ' + (rowB && rowB.textContent));
    // The table lists EVERY real holder, not only this test's two — the local demo client
    // also holds Nordic Growth Fund — so the expected total is computed from the real holdings
    // table, the same source the page reads.
    const allHolders = (await admin.from('holdings').select('client_id, units').eq('product_id', 'PROD-0001')).data || [];
    const expTotal = round2(allHolders.reduce((sum, h) => sum + (round2(Number(h.units) * expectedNew) - round2(Number(h.units) * current)), 0));
    check('...with the total across ALL real holders (' + allHolders.length + ', including the demo client)', D.getElementById('nav-impact-total').textContent === '+' + usd(expTotal) && rows.length === allHolders.length, D.getElementById('nav-impact-total').textContent + ' vs +' + usd(expTotal) + ' | rows ' + rows.length);
    check('...heading counts the holders', new RegExp(allHolders.length + ' clients holding').test(D.getElementById('nav-impact-heading').textContent), D.getElementById('nav-impact-heading').textContent);
    D.querySelector('.nav-mode-btn[data-mode="price"]').click();
    D.getElementById('nav-unit-price').value = String(expectedNew);
    D.getElementById('nav-unit-price').dispatchEvent(new dom.window.Event('input'));
    check('the by-unit-price mode produces the same preview for the same resulting price', D.getElementById('nav-preview').textContent.indexOf(fmt(expectedNew)) !== -1);
    D.querySelector('.nav-mode-btn[data-mode="percent"]').click();
    D.getElementById('nav-note').value = 'Q2 UI test ' + suffix;
    const toastBefore2 = D.getElementById('admin-toast-body').textContent;
    D.getElementById('nav-submit').click();
    await pollUntil(() => D.getElementById('admin-toast-body').textContent !== toastBefore2, 30000);
    check('publishing by +4.2% succeeds with the resulting price and % in the toast', /\+4\.2%/.test(D.getElementById('admin-toast-body').textContent) && D.getElementById('admin-toast-body').textContent.indexOf(fmt(expectedNew)) !== -1, D.getElementById('admin-toast-body').textContent);
    // ★ Cross-check the impact table against what ACTUALLY happened after publishing.
    const anonA = createClient(url, anonKey, { auth: { persistSession: false } });
    const anonB = createClient(url, anonKey, { auth: { persistSession: false } });
    await anonA.auth.signInWithPassword({ email: A.email, password });
    await anonB.auth.signInWithPassword({ email: B.email, password });
    await anonA.functions.invoke('get-holdings'); await anonB.functions.invoke('get-holdings');
    const stA = (await admin.from('account_state').select('allocated_capital').eq('client_id', A.id).single()).data;
    const stB = (await admin.from('account_state').select('allocated_capital').eq('client_id', B.id).single()).data;
    const ethPrice = Number((await admin.from('products').select('unit_price').eq('id', 'PROD-0004').single()).data.unit_price);
    const aPe = round2(Number(stA.allocated_capital) - round2(1.85118324 * ethPrice));
    check('★ CROSS-CHECK: A\'s real PE value after publishing equals the impact table\'s "new value" (' + usd(expA.to) + ')', Math.abs(aPe - expA.to) < 0.011, 'got ' + aPe);
    check('★ CROSS-CHECK: B\'s real PE value after publishing equals the impact table\'s "new value" (' + usd(expB.to) + ')', Math.abs(Number(stB.allocated_capital) - expB.to) < 0.011, 'got ' + stB.allocated_capital);

    // ===== PART B: the client pages =====
    console.log('\n=== PART B: client cards, fractional units ===\n');
    // Make Ethereum's quote deliberately STALE (cache and product both 2 hours old) so the
    // grey state is exercised; the final refresh restores it.
    const staleIso = new Date(Date.now() - 2 * 3600e3).toISOString();
    await admin.from('market_data_cache').update({ last_updated: staleIso }).eq('symbol', 'ETH');
    await admin.from('products').update({ price_as_of: staleIso }).eq('id', 'PROD-0004');

    const { error: cErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: A.email, password });
    check('client A sign-in on the shared singleton', !cErr, cErr && cErr.message);
    const acPath = fileURLToPath(new URL('asset-collection.html', root));
    const acDom = buildPageDom(acPath);
    acDom.window.MarketswaveData = MarketswaveData;
    acDom.window.getAuthenticatedClientId = () => A.id;
    acDom.window.eval(engineCoreSource);
    acDom.window.eval(extractInlineScript(acPath, 'UI Wiring — Stage 2'));
    const C = acDom.window.document;
    await pollUntil(() => C.querySelectorAll('[data-product-id]').length > 0 && !/animate-pulse/.test(C.getElementById('asset-cards-grid').innerHTML), 30000);
    // The seeded catalog (row 202) has more products than one page of nine: page through
    // Load More so the cards this test looks for are rendered wherever they fall.
    { const lm = C.getElementById('load-more-btn'); for (let i = 0; i < 12 && lm && !lm.classList.contains('hidden'); i++) { lm.click(); await new Promise((r) => setTimeout(r, 100)); } }
    const card = (id) => C.querySelector('[data-product-id="' + id + '"]');
    const eth = card('PROD-0004'), nordic = card('PROD-0001'), vt = card('PROD-0003');
    check('Ethereum\'s card shows its ticker chip, a per-unit price and "Fractional units"', !!eth && eth.querySelector('.product-ticker') && eth.querySelector('.product-ticker').textContent === 'ETH' && /per unit/.test(eth.textContent) && !!eth.querySelector('.fractional-note'), eth && eth.textContent.slice(0, 200));
    check('★ ...and its source line is the GREY stale state, shown WITH its timestamp and still allocatable', !!eth && eth.querySelector('.price-source').dataset.source === 'stale' && /Market price · as of/.test(eth.querySelector('.price-source').textContent) && /awaiting refresh/.test(eth.querySelector('.price-source').textContent) && !!eth.querySelector('.request-allocation-btn'), eth && eth.querySelector('.price-source').textContent);
    check('VT\'s card shows the GREEN live state ("Market price · as of HH:MM")', !!vt && vt.querySelector('.price-source').dataset.source === 'live' && /as of \d\d:\d\d/.test(vt.querySelector('.price-source').textContent), vt && vt.querySelector('.price-source').textContent);
    check('Nordic Growth Fund\'s card shows the AMBER appraisal state with the last-valued date, no ticker, no fractional note', !!nordic && nordic.querySelector('.price-source').dataset.source === 'appraisal' && /Valued by appraisal · last valued/.test(nordic.querySelector('.price-source').textContent) && !nordic.querySelector('.product-ticker') && !nordic.querySelector('.fractional-note'), nordic && nordic.querySelector('.price-source').textContent);
    check('...Nordic shows the +4.20% just published', !!nordic && nordic.querySelector('.price-change') && nordic.querySelector('.price-change').textContent === '+4.20%', nordic && nordic.querySelector('.price-change') && nordic.querySelector('.price-change').textContent);
    check('the quote-failed product shows its last good price, honestly stale, never $0.00', !!card(badId) && /\$42\.42/.test(card(badId).textContent) && card(badId).querySelector('.price-source').dataset.source === 'stale', card(badId) && card(badId).textContent.slice(0, 160));

    // asset-performance.html: fractional units per asset
    const apPath2 = fileURLToPath(new URL('asset-performance.html', root));
    const apDom = buildPageDom(apPath2);
    apDom.window.MarketswaveData = MarketswaveData;
    apDom.window.getAuthenticatedClientId = () => A.id;
    apDom.window.eval(engineCoreSource);
    apDom.window.eval(formatHelpersSource);
    apDom.window.eval(extractInlineScript(apPath2, 'Returns Display'));
    const P = apDom.window.document;
    await pollUntil(() => /Ethereum/.test(P.body.textContent) && !/animate-pulse/.test(P.getElementById('return-table-body') ? P.getElementById('return-table-body').innerHTML : ''), 30000);
    const ethRow = [...P.querySelectorAll('tr')].find((r) => /Ethereum/.test(r.textContent));
    check('★ the holdings table renders the crypto position at its real fractional precision (1.85118324), not 1.85 and not 1.85118324000', !!ethRow && /1\.85118324/.test(ethRow.textContent) && !/1\.851183240/.test(ethRow.textContent), ethRow && ethRow.textContent.replace(/\s+/g, ' ').slice(0, 200));
    const peRow = [...P.querySelectorAll('tr')].find((r) => /Nordic Growth Fund/.test(r.textContent));
    check('...while the PE position keeps 2dp (500.00) — precision is per asset, not global', !!peRow && /500\.00/.test(peRow.textContent) && !/500\.0000/.test(peRow.textContent), peRow && peRow.textContent.replace(/\s+/g, ' ').slice(0, 200));

    // transactions.html: the ledger quantity
    const txPath = fileURLToPath(new URL('transactions.html', root));
    const txDom = buildPageDom(txPath);
    txDom.window.MarketswaveData = MarketswaveData;
    txDom.window.Chart = function () { return { destroy() {} }; }; txDom.window.Chart.getChart = () => null;
    txDom.window.eval(formatHelpersSource);
    txDom.window.eval(extractInlineScript(txPath, 'UI Wiring — Stage 3'));
    const T = txDom.window.document;
    await pollUntil(() => /Ethereum/.test(T.getElementById('ledger-body').textContent), 30000);
    check('the ledger quantity for the BUY renders the fractional units per asset (1.85118324)', /1\.85118324/.test(T.getElementById('ledger-body').textContent), T.getElementById('ledger-body').textContent.replace(/\s+/g, ' ').slice(0, 200));
  } finally {
    await admin.from('holdings').delete().in('client_id', ids);
    await admin.from('transactions').delete().in('client_id', ids);
    await admin.from('allocation_requests').delete().in('client_id', ids);
    await admin.from('account_state').delete().in('client_id', ids);
    await admin.from('nav_publications').delete().eq('product_id', 'PROD-0001').not('id', 'in', '(' + (navBefore.length ? navBefore.map((i) => '"' + i + '"').join(',') : '"00000000-0000-0000-0000-000000000000"') + ')');
    await admin.from('products').update(peBefore).eq('id', 'PROD-0001');
    if (createdProductIds.length) {
      await admin.from('holdings').delete().in('product_id', createdProductIds);
      await admin.from('nav_publications').delete().in('product_id', createdProductIds);
      await admin.from('market_data_cache').delete().eq('symbol', 'AAPL');
      const { error } = await admin.from('products').delete().in('id', createdProductIds);
      if (error) console.log('  cleanup: ' + error.message);
    }
    for (const id of ids) { await admin.from('clients').delete().eq('id', id); await admin.auth.admin.deleteUser(id); }
    if (ethStatusBefore) await admin.from('products').update(ethStatusBefore).eq('id', 'PROD-0004');
    // Restore ETH's freshness with a real refresh (PM token).
    const pmMod = await import('../admin-supabase-config.js');
    const { data: pmS } = await pmMod.supabase.auth.signInWithPassword({ email: pmMod.LOCAL_ADMIN_EMAIL, password: pmMod.LOCAL_ADMIN_PASSWORD });
    if (pmS && pmS.session) await fetch(url + '/functions/v1/refresh-market-data', { method: 'POST', headers: { Authorization: 'Bearer ' + pmS.session.access_token, 'Content-Type': 'application/json' }, body: '{}' });
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}
main().catch((err) => { console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err)); console.error(err && err.stack); process.exit(1); });
