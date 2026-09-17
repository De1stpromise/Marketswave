#!/usr/bin/env node
// ★ Asset logos (2026-09-13, row 207) — the shared mark, verified in a real DOM.
//
//   PART 1  asset-mark.js on its own: the initials rule (every clause the header states,
//           each with the case it exists for), ticker precedence, the 4-character cap,
//           deterministic hues, escaping, and the storage-path prefix.
//   PART 2  supabase-data.js hands the resolved client's own project URL to AssetMark the
//           moment the client resolves — the only way a stored PATH can become a real URL.
//   PART 3  The REAL pages' own scripts in jsdom, signed in as a real client: every catalog
//           card carries exactly one well; Nordic Growth Fund (Private Equity, no ticker)
//           renders NGF; a market product renders the stored path prefixed with the real
//           project URL; the watchlist card and the holdings row do the same; a real
//           `error` event on a well's <img> is swapped to the monogram in place.
//   PART 4  admin-products.html (a real PM session): the same mark a client sees, per row.
//
// The visual half — real decoded pixels, contrast under the sheen, centring at four sizes,
// 320/375/390 — is verify-asset-logos-visual.mjs. Requires the local stack and
// `supabase functions serve`.

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

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

async function main() {
  console.log('Asset logos — the shared mark, real-DOM verification\n');
  const root = new URL('../', import.meta.url);
  const assetMarkSource = readFileSync(fileURLToPath(new URL('asset-mark.js', root)), 'utf8');
  const engineCoreSource = readFileSync(fileURLToPath(new URL('engine-core.js', root)), 'utf8');
  const formatHelpersSource = readFileSync(fileURLToPath(new URL('format-helpers.js', root)), 'utf8');

  // ===== PART 1: the rule, in isolation =====
  console.log('=== PART 1: asset-mark.js — the monogram rule, hues, escaping ===\n');
  const bare = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  bare.window.eval(assetMarkSource);
  const AM = bare.window.AssetMark;
  check('asset-mark.js defines window.AssetMark with html/configure/monogram/initials/hue', !!AM && ['html', 'configure', 'monogram', 'initials', 'hue'].every((k) => typeof AM[k] === 'function'));

  const rule = [
    ['Nordic Growth Fund', 'NGF', 'the brief\'s own example — "Fund" is generic but only two letters remain without it, so it is kept'],
    ['European Real Estate Trust', 'ERE', 'a generic word (Trust) dropped because three letters remain without it'],
    ['Global Infrastructure Partners', 'GIP', 'Partners kept: two letters would be thinner than the name deserves'],
    ['Nordic Growth Fund III', 'NGI', 'roman numerals are ordinary words; Fund dropped since three remain'],
    ['Real Estate Fund 3', 'RE3', 'an all-digit word contributes the whole number'],
    ['Vintage 2024 Partners', 'V202', 'a digit run is kept whole, then the 4-character cap applies'],
    ['Meridian', 'MER', 'a one-word name: first three letters'],
    ['The Fund', 'FUN', 'articles always dropped; the one surviving word is treated as one-word'],
    ['Harbour Logistics Real Assets LP', 'HLRA', 'four significant words fill the well exactly'],
    ['The Bank of England Holdings', 'BEH', 'articles and connectives dropped, Holdings kept (two letters otherwise)'],
    ['A', 'A', 'a single one-letter word: the raw-name fallback yields the same single letter'],
    ['', '?', 'an empty name never renders an empty well'],
    ['---', '?', 'a name with no letters or digits at all']
  ];
  for (const [name, want, why] of rule) {
    const got = AM.initials(name);
    check('initials: ' + JSON.stringify(name) + ' → ' + want + ' (' + why + ')', got === want, 'got ' + JSON.stringify(got));
  }
  check('a ticker always wins over the name, upper-cased and capped at 4', AM.monogram('Nordic Growth Fund', 'spy') === 'SPY' && AM.monogram('x', 'abcdef') === 'ABCD');
  check('an empty ticker falls through to the initials rule', AM.monogram('Nordic Growth Fund', '') === 'NGF' && AM.monogram('Nordic Growth Fund', null) === 'NGF');
  const hues = ['SPY', 'VGK', 'GLD', 'NGF', 'BTC', 'NVDA', 'ETH', 'SOL', 'QQQ', 'AGG', 'DIA', 'XLRE', 'ERE', 'TLT', 'IWM', 'AAPL'].map((t) => AM.hue(t));
  check('hue is a pure function of the text (same input, same 0..6 output, twice)', ['SPY', 'NGF', 'AAPL'].every((t) => AM.hue(t) === AM.hue(t) && AM.hue(t) >= 0 && AM.hue(t) <= 6));
  check('the seven hues are genuinely spread across the real catalog\'s tickers (≥ 5 distinct of 7 over 16 tickers)', new Set(hues).size >= 5, JSON.stringify(hues));
  check('the hue changes when the text does (a different mark is a different hue somewhere in this set)', new Set(hues).size > 1);

  const mono = AM.html({ name: 'Nordic Growth Fund', ticker: null, logoUrl: null, size: 'm' });
  check('a monogram well: .mk .mk-m .mk-mono .mk-hN with the text in .mk-t.mk-len3, aria-hidden, and the text/hue carried as data attributes',
    /^<span class="mk mk-m mk-mono mk-h[0-6]" aria-hidden="true" data-mk-mono="NGF" data-mk-hue="mk-h[0-6]"><span class="mk-t mk-len3">NGF<\/span><\/span>$/.test(mono), mono);
  check('a 4-character monogram carries mk-len4; a 2-character one carries neither step-down class',
    /mk-t mk-len4/.test(AM.html({ ticker: 'NVDA', size: 's' })) && /class="mk-t"/.test(AM.html({ ticker: 'AB', size: 's' })));
  check('every size maps to its class, and an unknown size falls back to the 40px medium',
    ['l', 'm', 's', 'xs'].every((s) => new RegExp('class="mk mk-' + s + ' ').test(AM.html({ ticker: 'X', size: s }))) && /class="mk mk-m /.test(AM.html({ ticker: 'X', size: 'huge' })));
  check('the monogram text is HTML-escaped (a hostile ticker cannot inject markup; a hostile name only ever contributes letters and digits)',
    /data-mk-mono="&lt;B&gt;"/.test(AM.html({ ticker: '<b>', size: 'm' })) && /<span class="mk-t mk-len3">&lt;B&gt;<\/span>/.test(AM.html({ ticker: '<b>', size: 'm' })) &&
    AM.initials('<img src=x onerror=alert(1)>') === 'ISXO');
  check('a PM-typed absolute logo URL is used as-is', /src="https:\/\/example\.test\/a\.png"/.test(AM.html({ ticker: 'X', logoUrl: 'https://example.test/a.png' })));
  check('a stored storage PATH is left bare until configure() supplies the origin', /src="\/storage\/v1\/object\/public\/asset-logos\/ticker\/SPY\.png"/.test(AM.html({ ticker: 'SPY', logoUrl: '/storage/v1/object/public/asset-logos/ticker/SPY.png' })));
  AM.configure({ storageBase: 'http://127.0.0.1:54321/' });
  check('...and prefixed with it afterwards (trailing slash normalised, never a double slash)', /src="http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/public\/asset-logos\/ticker\/SPY\.png"/.test(AM.html({ ticker: 'SPY', logoUrl: '/storage/v1/object/public/asset-logos/ticker/SPY.png' })));
  check('the well is aria-hidden (the name is always adjacent; a screen reader must not hear the ticker twice)', /aria-hidden="true"/.test(AM.html({ ticker: 'SPY', logoUrl: 'https://x/y.png' })) && /aria-hidden="true"/.test(mono));
  check('the attribution line names Elbstream with a real link', /Logos provided by/.test(AM.creditHTML()) && /href="https:\/\/elbstream\.com"/.test(AM.creditHTML()));

  // A real `error` event on a well's <img>, in a real DOM: the document-level capture
  // listener asset-mark.js installed when it ran must swap the well in place.
  bare.window.document.body.innerHTML = AM.html({ name: 'Broken Co', ticker: 'BRK', logoUrl: 'https://example.test/missing.png', size: 'l' });
  const well = bare.window.document.querySelector('.mk');
  well.querySelector('img').dispatchEvent(new bare.window.Event('error'));
  check('★ a real error event on the <img> swaps the well to its monogram in place — same node, same size class, no <img> left, text and hue from the data attributes',
    well.classList.contains('mk-mono') && well.classList.contains('mk-l') && !well.querySelector('img') && well.querySelector('.mk-t') && well.querySelector('.mk-t').textContent === 'BRK' && well.classList.contains(well.getAttribute('data-mk-hue')), well.outerHTML);

  // ===== PART 2: supabase-data.js configures the mark =====
  console.log('\n=== PART 2: supabase-data.js hands the resolved project URL to AssetMark ===\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  // asset-mark.js must be on the window BEFORE supabase-data.js resolves its client, exactly
  // as the pages load it (script order: asset-mark.js, then supabase-data.js).
  { const w = globalThis.window; const fn = new Function('window', 'document', assetMarkSource); fn(w, undefined); }
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded and defined window.MarketswaveData', !!MarketswaveData);
  const client = await MarketswaveData.getSupabaseClient();
  const configuredSrc = globalThis.window.AssetMark.src('/storage/v1/object/public/asset-logos/ticker/SPY.png');
  check('★ once the client resolves, AssetMark prefixes a stored path with THAT client\'s own supabaseUrl (' + client.supabaseUrl + ')',
    configuredSrc === String(client.supabaseUrl).replace(/\/$/, '') + '/storage/v1/object/public/asset-logos/ticker/SPY.png', configuredSrc);

  // ===== PART 3: the real pages =====
  console.log('\n=== PART 3: the real pages\' own scripts, a real client session ===\n');
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyAssetLogosUI-2026!';
  const email = 'alui-' + suffix + '@test.marketswave.local';
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw new Error(cErr.message);
  const clientId = created.user.id;
  await admin.from('clients').insert({ id: clientId, name: 'Asset Logos UI', email: 'alui-' + clientId, phone: '+1', account_type: 'Individual Account', status: 'active' });
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 });
  const spy = (await admin.from('products').select('id, ticker, logo_url').eq('id', 'PROD-0006').single()).data;
  const btc = (await admin.from('products').select('id, ticker, logo_url').eq('id', 'PROD-0026').single()).data;
  const brokenSymbol = 'ZY' + suffix.slice(0, 2).toUpperCase();

  try {
    await admin.from('holdings').insert([
      { client_id: clientId, product_id: 'PROD-0001', units: 10, cost_basis: 6000 },
      { client_id: clientId, product_id: 'PROD-0026', units: 0.05, cost_basis: 3500 }
    ]);
    await admin.from('market_data_cache').upsert({ symbol: brokenSymbol, value: 5, change_percent: 0, source: 'finnhub', name: 'No Provider Corp', provider_id: null, asset_type: 'stock', last_updated: new Date().toISOString(), logo_url: null }, { onConflict: 'symbol' });
    await admin.from('watchlist_symbols').insert([
      { client_id: clientId, symbol: 'BTC', name: 'Bitcoin', source: 'coingecko', provider_id: 'bitcoin', asset_type: 'crypto' },
      { client_id: clientId, symbol: brokenSymbol, name: 'No Provider Corp', source: 'finnhub', provider_id: null, asset_type: 'stock' }
    ]);
    await admin.from('clients').update({ watchlist_seeded_at: new Date().toISOString() }).eq('id', clientId);

    const { error: sErr } = await client.auth.signInWithPassword({ email, password });
    check('real client sign-in on the shared client', !sErr, sErr && sErr.message);
    const origin = String(client.supabaseUrl).replace(/\/$/, '');
    // In a real browser there is ONE window: asset-mark.js runs once and supabase-data.js
    // configures that one copy when the client resolves (Part 2 proved that hand-off). Each
    // jsdom page here is its own window with its own fresh copy of asset-mark.js, while
    // MarketswaveData (and its already-resolved client) is shared across them — so the
    // configure step is replayed per window with the SAME value the real hand-off used.
    function loadAssetMark(win) { win.eval(assetMarkSource); win.AssetMark.configure({ storageBase: client.supabaseUrl }); }

    // ---- asset-collection.html ----
    const acPath = fileURLToPath(new URL('asset-collection.html', root));
    const acDom = buildPageDom(acPath);
    acDom.window.MarketswaveData = MarketswaveData;
    acDom.window.getAuthenticatedClientId = () => clientId;
    acDom.window.eval(engineCoreSource);
    loadAssetMark(acDom.window);
    acDom.window.eval(extractInlineScript(acPath, 'UI Wiring — Stage 2'));
    const C = acDom.window.document;
    await pollUntil(() => C.querySelectorAll('[data-product-id]').length > 0 && !/animate-pulse/.test(C.getElementById('asset-cards-grid').innerHTML), 30000);
    { const lm = C.getElementById('load-more-btn'); for (let i = 0; i < 40 && lm && !lm.classList.contains('hidden'); i++) { lm.click(); await new Promise((r) => setTimeout(r, 100)); } }
    const cards = [...C.querySelectorAll('#asset-cards-grid [data-product-id]')];
    check('the catalog rendered real product cards', cards.length >= 10, String(cards.length));
    check('★ EVERY card carries exactly one well — Private Equity, Real Assets, ETFs and crypto alike', cards.every((c) => c.querySelectorAll('.mk').length === 1), cards.filter((c) => c.querySelectorAll('.mk').length !== 1).map((c) => c.getAttribute('data-product-id')).join(','));
    check('every well on the catalog is the 40px medium', cards.every((c) => c.querySelector('.mk').classList.contains('mk-m')));
    const ngfCard = C.querySelector('[data-product-id="PROD-0001"]');
    const ngfWell = ngfCard && ngfCard.querySelector('.mk');
    check('Nordic Growth Fund (no ticker) renders the NGF monogram, hue class present, no <img>', !!ngfWell && ngfWell.classList.contains('mk-mono') && ngfWell.querySelector('.mk-t').textContent === 'NGF' && !ngfWell.querySelector('img') && /mk-h[0-6]/.test(ngfWell.className), ngfWell && ngfWell.outerHTML);
    const spyCard = C.querySelector('[data-product-id="PROD-0006"]');
    const spyImg = spyCard && spyCard.querySelector('.mk img');
    check('SPY renders its STORED path prefixed with the real project URL (' + origin + ')', !!spyImg && spyImg.getAttribute('src') === origin + spy.logo_url, spyImg && spyImg.getAttribute('src'));
    check('...and the well still carries the monogram text/hue it would fall back to (data-mk-mono="SPY")', !!spyCard && spyCard.querySelector('.mk').getAttribute('data-mk-mono') === 'SPY');
    check('the old initials box is gone (no .product-logo-fallback / getClientInitials rendering)', !C.querySelector('.product-logo-fallback') && !C.querySelector('.product-logo-img'));
    check('the Elbstream attribution is in the page markup once', C.querySelectorAll('.asset-logo-credit').length === 1 && /elbstream\.com/.test(C.querySelector('.asset-logo-credit a').getAttribute('href')));
    // The broken-image path through the REAL page: dispatch error on SPY's real <img>.
    spyImg.dispatchEvent(new acDom.window.Event('error'));
    const spyWellAfter = spyCard.querySelector('.mk');
    check('★ a failed load on a REAL catalog well becomes the SPY monogram in place — never a broken image, never a gap', spyWellAfter.classList.contains('mk-mono') && spyWellAfter.classList.contains('mk-m') && !spyWellAfter.querySelector('img') && spyWellAfter.querySelector('.mk-t').textContent === 'SPY', spyWellAfter.outerHTML);

    // ---- dashboard.html watchlist ----
    const dashPath = fileURLToPath(new URL('dashboard.html', root));
    const dDom = buildPageDom(dashPath);
    dDom.window.MarketswaveData = MarketswaveData;
    loadAssetMark(dDom.window);
    dDom.window.eval(extractInlineScript(dashPath, 'MARKET SNAPSHOT + WATCHLIST'));
    const D = dDom.window.document;
    const rows = D.getElementById('wl-rows');
    await pollUntil(() => rows.querySelector('.wl-card[data-wl-card]') && !/animate-pulse/.test(rows.innerHTML), 30000);
    const wlCards = [...rows.querySelectorAll('.wl-card[data-wl-card]')];
    check('the watchlist rendered real cards', wlCards.length === 2, String(wlCards.length));
    check('every watchlist card carries one 34px well, left of the ticker/name pair', wlCards.every((c) => c.querySelectorAll('.mk').length === 1 && c.querySelector('.mk').classList.contains('mk-s') && c.querySelector('.wl-card-head .mk + .wl-card-id .wl-tag')));
    const btcCard = wlCards.find((c) => c.querySelector('.wl-tag').textContent === 'BTC');
    check('BTC on the watchlist renders get-watchlist\'s logoUrl (the cache row\'s stored path), prefixed with the project URL', !!btcCard && btcCard.querySelector('.mk img') && btcCard.querySelector('.mk img').getAttribute('src') === origin + '/storage/v1/object/public/asset-logos/crypto/BTC.png', btcCard && btcCard.querySelector('.mk').outerHTML);
    const noneCard = wlCards.find((c) => c.querySelector('.wl-tag').textContent === brokenSymbol);
    check('a symbol no provider has (logo_url null) renders its 4-character ticker monogram with the len4 step-down', !!noneCard && noneCard.querySelector('.mk').classList.contains('mk-mono') && noneCard.querySelector('.mk-t').textContent === brokenSymbol && noneCard.querySelector('.mk-t').classList.contains('mk-len4'), noneCard && noneCard.querySelector('.mk').outerHTML);
    btcCard.click();
    const drawer = rows.querySelector('.wl-drawer');
    check('the open drawer repeats the mark at 28px beside the name', !!drawer && drawer.querySelector('.wl-drawer-top .mk.mk-xs img') && drawer.querySelector('.wl-drawer-top .mk').getAttribute('data-mk-mono') === 'BTC', drawer && drawer.innerHTML.slice(0, 300));

    // ---- asset-performance.html Return Table ----
    const apPath = fileURLToPath(new URL('asset-performance.html', root));
    const apDom = buildPageDom(apPath);
    apDom.window.MarketswaveData = MarketswaveData;
    apDom.window.getAuthenticatedClientId = () => clientId;
    apDom.window.clientScopedKey = (k) => k + ':' + clientId;
    apDom.window.eval(engineCoreSource);
    apDom.window.eval(formatHelpersSource);
    loadAssetMark(apDom.window);
    apDom.window.eval(extractInlineScript(apPath, 'get-returns-summary'));
    const P = apDom.window.document;
    const tbody = P.getElementById('return-table-body');
    await pollUntil(() => tbody.querySelector('.mk') && !/animate-pulse/.test(tbody.innerHTML), 30000);
    const holdingRows = [...tbody.querySelectorAll('tr')].filter((r) => r.querySelector('.mk'));
    check('the Return Table renders a 28px well on every holding row', holdingRows.length === 2 && holdingRows.every((r) => r.querySelectorAll('.mk').length === 1 && r.querySelector('.mk').classList.contains('mk-xs')), String(holdingRows.length));
    const ngfRow = holdingRows.find((r) => /Nordic Growth Fund/.test(r.textContent));
    const btcRow = holdingRows.find((r) => /Bitcoin/.test(r.textContent));
    check('...Nordic Growth Fund → NGF monogram, the SAME hue class as on the catalog', !!ngfRow && ngfRow.querySelector('.mk-t').textContent === 'NGF' && ngfRow.querySelector('.mk').getAttribute('data-mk-hue') === ngfWell.getAttribute('data-mk-hue'));
    check('...Bitcoin → the real stored logo, prefixed', !!btcRow && btcRow.querySelector('.mk img') && btcRow.querySelector('.mk img').getAttribute('src') === origin + btc.logo_url);
    check('the old 3px class swatch is gone from the holding cell', !tbody.querySelector('[style*="width:3px"]'));
    check('the class/type line still reads in words beneath the name (nothing depended on the swatch colour)', !!ngfRow && /Private Equity/.test(ngfRow.querySelector('.rt-meta').textContent));

    // ===== PART 4: admin-products.html =====
    console.log('\n=== PART 4: admin-products.html — the same mark a client sees, per row ===\n');
    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: pmErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    check('real PM sign-in', !pmErr, pmErr && pmErr.message);
    await MarketswaveData.useAdminClient();
    const adPath = fileURLToPath(new URL('admin-products.html', root));
    const adDom = buildPageDom(adPath);
    adDom.window.MarketswaveData = MarketswaveData;
    adDom.window.eval(formatHelpersSource);
    loadAssetMark(adDom.window);
    // ★ PM tool revamp part 6 (2026-09-16): admin-products.html moved to an EXTERNAL
    // admin-products-page.js and its rows are `.pr-tr` over a paged table, so the catalogue is
    // searched for the two products this part checks rather than assumed to be on page one.
    adDom.window.eval(readFileSync(new URL('../admin-products-page.js', import.meta.url), 'utf8'));
    const A = adDom.window.document;
    await pollUntil(() => A.querySelectorAll('.pr-tr').length > 0, 30000);
    const prodRows = [...A.querySelectorAll('.pr-tr')];
    check('the admin catalog list rendered', prodRows.length >= 10, String(prodRows.length));
    check('every row carries one 28px well beside the name', prodRows.every((r) => r.querySelectorAll('.mk').length === 1 && r.querySelector('.mk').classList.contains('mk-xs')));
    const findAdminRow = async (id) => {
      const search = A.getElementById('pr-search');
      search.value = id;
      search.dispatchEvent(new adDom.window.Event('input', { bubbles: true }));
      // The page searches by NAME or TICKER, never the PROD id, so fall back to paging.
      if (!A.querySelector('.pr-tr[data-id="' + id + '"]')) {
        search.value = '';
        search.dispatchEvent(new adDom.window.Event('input', { bubbles: true }));
        for (let i = 0; i < 20 && !A.querySelector('.pr-tr[data-id="' + id + '"]'); i++) {
          const more = A.getElementById('pr-more');
          if (!more) break;
          more.click();
          await new Promise((r) => setTimeout(r, 30));
        }
      }
      return A.querySelector('.pr-tr[data-id="' + id + '"]');
    };
    const adNgf = await findAdminRow('PROD-0001');
    const adSpy = await findAdminRow('PROD-0006');
    check('...Nordic Growth Fund → NGF, the same hue the client sees', !!adNgf && adNgf.querySelector('.mk-t').textContent === 'NGF' && adNgf.querySelector('.mk').getAttribute('data-mk-hue') === ngfWell.getAttribute('data-mk-hue'));
    check('...SPY → the same stored path, prefixed with the admin client\'s own project URL', !!adSpy && adSpy.querySelector('.mk img') && adSpy.querySelector('.mk img').getAttribute('src') === origin + spy.logo_url);
    check('the attribution line is on the admin page too', A.querySelectorAll('.asset-logo-credit').length === 1);
  } finally {
    await admin.from('watchlist_symbols').delete().eq('client_id', clientId);
    await admin.from('market_data_cache').delete().eq('symbol', brokenSymbol);
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    const { error: dErr } = await admin.auth.admin.deleteUser(clientId);
    if (dErr) console.log('  cleanup: ' + dErr.message);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
}

runVerifyMain(main);
