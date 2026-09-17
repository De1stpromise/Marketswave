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
  const freshId = 'PROD-TEST-FRESH-' + suffix.toUpperCase();
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
    // A market product priced RIGHT NOW, for the green live state below.
    await admin.from('products').insert({ id: freshId, name: 'Fresh Quote ' + suffix, asset_class: 'Stocks & ETFs', investment_type: 'ETF', risk_tier: 'balanced', minimum_investment: 100, unit_price: 88.88, inception_unit_price: 88.88, created_at: '2026-09-11', last_tick_date: '2026-09-11', pricing_model: 'market', ticker: 'ZF' + suffix.slice(0, 4).toUpperCase(), price_source: 'finnhub', price_as_of: new Date().toISOString(), price_status: 'ok', price_change_percent: 1.34 });
    createdProductIds.push(freshId);

    // ===== PART A: RETIRED (2026-09-16) =====
    // ★ PART A drove admin-products.html's own inline script, which no longer exists: PM tool
    // revamp part 6 rebuilt that page onto an external admin-products-page.js with a wholly
    // different control set (one dense table, a health strip, a detail panel shaped by pricing
    // model). Every assertion it carried now lives in verify-products-page-ui-wiring.mjs, and
    // was ported rather than dropped — the mapping, so a future reader can check:
    //
    //   the list states each product's price source          → its PART 2 / PART 7
    //   the quote-failed flag, and the panel's explanation    → its PART 11
    //   the creation flow: model first, locked, class derived → its PART 10 / PART 12
    //   the real symbol search, price, unverified exchange    → its PART 12
    //   Create product, end to end, tracking a real symbol    → its PART 12
    //   Edit: no price field, no symbol field, class locked   → its PART 13
    //   publish by percentage, with the impact table          → its PART 9
    //   the CROSS-CHECK of holders' values after publishing   → its PART 9, read through
    //                                                            get-holdings rather than off
    //                                                            account_state directly
    //
    // What stays here is the publication ITSELF, because PART B below asserts the client cards
    // show the resulting +4.20% — so it is still performed, just through the real Edge Function
    // rather than through a page that no longer has that control.
    console.log('=== PART A: retired — see verify-products-page-ui-wiring.mjs (the page was rebuilt) ===\n');
    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: pmErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    check('real PM sign-in', !pmErr, pmErr && pmErr.message);
    await MarketswaveData.useAdminClient();

    const current = Number(peBefore.unit_price);
    const expectedNew = round2(current * 1.042);
    const pub = await MarketswaveData.callFunction('publish-nav', {
      productId: 'PROD-0001', changePercent: 4.2, note: 'Q2 UI test ' + suffix
    });
    check('publishing +4.2% on the PE product succeeds (the page-level proof moved, the effect has not)',
      !!pub && Math.abs(Number(pub.product.unitPrice) - expectedNew) < 0.011,
      pub && String(pub.product.unitPrice) + ' vs ' + expectedNew);

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
    acDom.window.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8')); // asset-mark.js (row 207)
    acDom.window.eval(extractInlineScript(acPath, 'UI Wiring — Stage 2'));
    const C = acDom.window.document;
    await pollUntil(() => C.querySelectorAll('[data-product-id]').length > 0 && !/animate-pulse/.test(C.getElementById('asset-cards-grid').innerHTML), 30000);
    // The seeded catalog (row 202) has more products than one page of nine: page through
    // Load More so the cards this test looks for are rendered wherever they fall.
    { const lm = C.getElementById('load-more-btn'); for (let i = 0; i < 40 && lm && !lm.classList.contains('hidden'); i++) { lm.click(); await new Promise((r) => setTimeout(r, 100)); } }
    const card = (id) => C.querySelector('[data-product-id="' + id + '"]');
    const eth = card('PROD-0004'), nordic = card('PROD-0001');
    // Catalog expansion (row 211): the compact card has no "Fractional units" line — fractional
    // units are stated by the allocation panel's own units figure instead.
    check('Ethereum\'s card shows its ticker chip and a per-unit price', !!eth && eth.querySelector('.product-ticker') && eth.querySelector('.product-ticker').textContent === 'ETH' && /per unit/.test(eth.textContent), eth && eth.textContent.slice(0, 200));
    check('★ ...and its source line is the GREY stale state, shown WITH its timestamp and still allocatable', !!eth && eth.querySelector('.price-source').dataset.source === 'stale' && /Market price · as of/.test(eth.querySelector('.price-source').textContent) && /awaiting refresh/.test(eth.querySelector('.price-source').textContent) && !!eth.querySelector('.request-allocation-btn'), eth && eth.querySelector('.price-source').textContent);
    // ★ The GREEN state is asserted on a product this suite SEEDS fresh, never on a real
    // catalogue symbol. VT is genuinely refreshed in rotation — 283 stock symbols at 30 per
    // 5-minute run — so during a long full-suite pass its real price can legitimately be 45
    // minutes old and the card correctly reads "awaiting refresh". Asserting the live state on
    // it made this test fail for a reason that was the system working, not a regression; and
    // writing a fresh timestamp onto VT's own row to force it would be the shared-fixture
    // collision class register row 212 exists for.
    const freshCard = card(freshId);
    check('a freshly-priced product shows the GREEN live state ("Market price · as of HH:MM")', !!freshCard && freshCard.querySelector('.price-source').dataset.source === 'live' && /as of \d\d:\d\d/.test(freshCard.querySelector('.price-source').textContent), freshCard && freshCard.querySelector('.price-source').textContent);
    check('Nordic Growth Fund\'s card shows the AMBER appraisal state with the last-valued date, no ticker, no fractional note', !!nordic && nordic.querySelector('.price-source').dataset.source === 'appraisal' && /Valued by appraisal · \d{2} \w{3,4} \d{4}/.test(nordic.querySelector('.price-source').textContent) && !nordic.querySelector('.product-ticker'), nordic && nordic.querySelector('.price-source').textContent);
    check('...Nordic shows the +4.20% just published', !!nordic && nordic.querySelector('.price-change') && nordic.querySelector('.price-change').textContent === '+4.20%', nordic && nordic.querySelector('.price-change') && nordic.querySelector('.price-change').textContent);
    check('the quote-failed product shows its last good price, honestly stale, never $0.00', !!card(badId) && /\$42\.42/.test(card(badId).textContent) && card(badId).querySelector('.price-source').dataset.source === 'stale', card(badId) && card(badId).textContent.slice(0, 160));

    // asset-performance.html: fractional units per asset
    const apPath2 = fileURLToPath(new URL('asset-performance.html', root));
    const apDom = buildPageDom(apPath2);
    apDom.window.MarketswaveData = MarketswaveData;
    apDom.window.getAuthenticatedClientId = () => A.id;
    apDom.window.eval(engineCoreSource);
    apDom.window.eval(formatHelpersSource);
    apDom.window.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8')); // asset-mark.js (row 207)
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
      await admin.from('market_data_cache').delete().eq('symbol', 'ADI');
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
