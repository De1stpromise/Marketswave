#!/usr/bin/env node
// ★ Asset logos (2026-09-13, row 207) — visual verification, in a real headless Chrome.
//
// What this proves, on the REAL pages with REAL data:
//   1. Real logos render for real catalog symbols — the <img> inside the well genuinely
//      decoded (complete + naturalWidth > 0), from this project's own asset-logos bucket.
//   2. The monogram path for a Private Equity product that has no ticker (Nordic Growth
//      Fund → NGF), with the SAME hue class on every page it appears on.
//   3. A deliberately broken image URL — a real cache row pointing at a storage path that
//      does not exist — falls back to the monogram in the real render path: no broken
//      image, no gap, the well keeps its size.
//   4. Monogram centring and length scaling at all four sizes (46/40/34/28) for 2-, 3- and
//      4-character text: the label's box is centred in the well to the pixel and never
//      crowds its edge.
//   5. Contrast: every monogram on each real page, AND a synthetic strip on a plain .glass
//      card with the ::before sheen composited over the marks (the real cards carry
//      .glass-lift, so the sheen sits beneath them — the strip is what answers the
//      question the brief actually asked).
//   6. Mobile at 320/375/390: no overflow, every well at its designed size.
//
// Real headless Chrome over CDP, this project's established substitute when no browser
// automation tool is available. Every measurement sits behind a viewport-integrity guard;
// 320px goes through a real same-origin iframe (the top-level override floors at 348px on
// this build). Requires the local stack, `supabase functions serve`, and a static server on
// http://127.0.0.1:8765.

import { execSync, spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.AL_BASE || 'http://127.0.0.1:8765';
const PORT = Number(process.env.AL_PORT || 9498);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PASSWORD = 'VerifyAssetLogos-2026!';

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function connectChrome() {
  const profile = makeTempDir('mw-alvis-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions',
    '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250);
    } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '') + ' :: ' + expr.slice(0, 120));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  // AL_SHOTS=<dir>: save a screenshot of each page visited — for a human look, never an
  // assertion. Off by default so a routine run leaves nothing behind.
  const shot = async (name, sel) => {
    if (!process.env.AL_SHOTS) return;
    mkdirSync(process.env.AL_SHOTS, { recursive: true });
    if (sel) await evaluate('(() => { const el = document.querySelector(' + JSON.stringify(sel) + '); if (el) el.scrollIntoView({ block: "start" }); return true; })()');
    await sleep(300);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.AL_SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  return { send, evaluate, shot, close: () => releaseTempDir(profile) };
}

async function main() {
  console.log('Asset logos — visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'alvis-' + suffix + '@test.marketswave.local';
  const brokenSymbol = 'ZZ' + suffix.slice(0, 2).toUpperCase(); // a 4-char ticker no provider has

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (cErr) throw new Error('createUser: ' + cErr.message);
  const clientId = created.user.id;
  await admin.from('clients').insert({
    id: clientId, name: 'Asset Logos Visual Verify', email: 'alvis-verify-' + clientId,
    phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
  });
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 });

  // The seeded catalog carries real stored logos for every market product (row 207's
  // backfill); PROD-0001 Nordic Growth Fund is Private Equity with no ticker — the monogram
  // that is a permanent answer, not a fallback.
  const products = (await admin.from('products').select('id, name, ticker, asset_class, logo_url, unit_price').in('id', ['PROD-0001', 'PROD-0006', 'PROD-0026'])).data || [];
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  if (!byId['PROD-0001'] || !byId['PROD-0006'] || !byId['PROD-0026']) throw new Error('expected seeded products PROD-0001/0006/0026 on the local stack');
  check('the seeded catalog carries a REAL stored logo path for SPY and BTC (row 207 backfill)',
    /^\/storage\/v1\/object\/public\/asset-logos\//.test(byId['PROD-0006'].logo_url || '') && /^\/storage\/v1\/object\/public\/asset-logos\//.test(byId['PROD-0026'].logo_url || ''),
    JSON.stringify({ spy: byId['PROD-0006'].logo_url, btc: byId['PROD-0026'].logo_url }));
  check('Nordic Growth Fund genuinely has no ticker and no logo (the monogram-only case)',
    !byId['PROD-0001'].ticker && !byId['PROD-0001'].logo_url);

  let cdp = null;
  try {
    // Holdings on all three, so the Return Table shows a real logo, a monogram from
    // initials, and the ticker/logo pair side by side at 28px.
    await admin.from('holdings').insert([
      { client_id: clientId, product_id: 'PROD-0001', units: 10, cost_basis: 6000 },
      { client_id: clientId, product_id: 'PROD-0006', units: 5, cost_basis: 2500 },
      { client_id: clientId, product_id: 'PROD-0026', units: 0.05, cost_basis: 3500 }
    ]);
    // The watchlist: two real logos (BTC, SPY), one symbol no provider has (a real cache row
    // with NO logo → monogram from the ticker), and one whose stored path is DELIBERATELY
    // BROKEN — a storage path nothing was ever uploaded to. That is the real render path
    // (get-watchlist → wlCardHTML → <img src=…>) meeting a real 400 from Storage.
    const brokenPath = '/storage/v1/object/public/asset-logos/ticker/NOPE-' + suffix + '.png';
    await admin.from('market_data_cache').upsert([
      { symbol: 'AAPL', value: 200, change_percent: 0.5, source: 'finnhub', name: 'Apple Inc.', provider_id: null, asset_type: 'stock', last_updated: new Date().toISOString(), logo_url: brokenPath },
      { symbol: brokenSymbol, value: 12.5, change_percent: -0.4, source: 'finnhub', name: 'No Provider Corp', provider_id: null, asset_type: 'stock', last_updated: new Date().toISOString(), logo_url: null }
    ], { onConflict: 'symbol' });
    await admin.from('watchlist_symbols').insert([
      { client_id: clientId, symbol: 'BTC', name: 'Bitcoin', source: 'coingecko', provider_id: 'bitcoin', asset_type: 'crypto' },
      { client_id: clientId, symbol: 'SPY', name: 'S&P 500 ETF', source: 'finnhub', provider_id: null, asset_type: 'stock' },
      { client_id: clientId, symbol: 'AAPL', name: 'Apple Inc.', source: 'finnhub', provider_id: null, asset_type: 'stock' },
      { client_id: clientId, symbol: brokenSymbol, name: 'No Provider Corp', source: 'finnhub', provider_id: null, asset_type: 'stock' }
    ]);
    await admin.from('clients').update({ watchlist_seeded_at: new Date().toISOString() }).eq('id', clientId);

    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error('signIn: ' + sErr.message);
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const bootstrap = [
      'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');',
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');',
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + ');',
      'true'
    ].join('');

    // ===================================================================================
    console.log('=== 1–3. Real logos, the PE monogram, and a broken URL — on the real pages ===\n');
    // ===================================================================================
    cdp = await connectChrome();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(900);
    await cdp.evaluate(bootstrap);

    // Reads every well on the page: size, whether it holds a decoded image or a monogram,
    // the monogram text/hue, and the geometry of the label inside the well.
    const MARKS_JS = [
      '(() => [...document.querySelectorAll(".mk")].filter(m => m.getBoundingClientRect().width > 0).map(m => {',
      '  const r = m.getBoundingClientRect(); const img = m.querySelector("img"); const t = m.querySelector(".mk-t");',
      '  const tr = t ? t.getBoundingClientRect() : null;',
      '  return { mono: m.getAttribute("data-mk-mono"), hue: m.getAttribute("data-mk-hue"), cls: m.className,',
      '    w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,',
      '    img: img ? { complete: img.complete, nw: img.naturalWidth, src: img.getAttribute("src") } : null,',
      '    isMono: m.classList.contains("mk-mono"), text: t ? t.textContent : null,',
      '    label: tr ? { cx: (tr.left + tr.right) / 2 - (r.left + r.right) / 2, cy: (tr.top + tr.bottom) / 2 - (r.top + r.bottom) / 2, w: tr.width, h: tr.height, fs: parseFloat(getComputedStyle(t).fontSize) } : null,',
      '    radius: getComputedStyle(m).borderRadius };',
      '}))()'
    ].join('');

    async function loadAndWait(path, readySel) {
      await cdp.send('Page.navigate', { url: BASE + path });
      let ready = false;
      for (let i = 0; i < 100 && !ready; i++) {
        await sleep(400);
        ready = await cdp.evaluate('!!document.querySelector(' + JSON.stringify(readySel) + ')');
      }
      // Let every <img> settle — decoded or errored — before reading.
      await cdp.evaluate('(async () => { const imgs = [...document.querySelectorAll(".mk img")]; for (let i = 0; i < 50; i++) { if (imgs.every(im => im.complete || !im.isConnected)) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()');
      await sleep(400);
      return ready;
    }

    // ---- asset-collection.html: catalog cards at 40px ----
    const acReady = await loadAndWait('/asset-collection.html', '#asset-cards-grid [data-product-id] .mk');
    check('asset-collection.html rendered real product cards with marks', acReady);
    // Load More until the whole catalog is on the page (PAGE_SIZE is 9; BTC is PROD-0026),
    // then let the newly added <img>s settle.
    await cdp.evaluate('(async () => { for (let i = 0; i < 10; i++) { const b = document.getElementById("load-more-btn"); if (!b || b.classList.contains("hidden")) break; b.click(); await new Promise(r => setTimeout(r, 300)); } return true; })()');
    await cdp.evaluate('(async () => { const imgs = [...document.querySelectorAll(".mk img")]; for (let i = 0; i < 50; i++) { if (imgs.every(im => im.complete)) return true; await new Promise(r => setTimeout(r, 200)); } return false; })()');
    await sleep(400);
    await cdp.shot('catalog-1440', '#asset-cards-grid');
    const acMarks = await cdp.evaluate(MARKS_JS);
    const acReal = acMarks.filter((m) => m.img && m.img.complete && m.img.nw > 0);
    check('real logos genuinely decoded on the catalog (≥ 20 wells hold a real, non-zero-size image from the asset-logos bucket — 21 ETFs + 8 coins were backfilled)',
      acReal.length >= 20 && acReal.every((m) => /\/storage\/v1\/object\/public\/asset-logos\//.test(m.img.src)),
      JSON.stringify({ real: acReal.length, sample: acReal.slice(0, 3).map((m) => m.img.src) }));
    const acBtc = acMarks.find((m) => m.mono === 'BTC');
    const acSpy = acMarks.find((m) => m.mono === 'SPY');
    check('BTC and SPY each show a REAL decoded logo on the catalog, not a monogram',
      !!acBtc && !!acSpy && !acBtc.isMono && !acSpy.isMono && acBtc.img.nw > 0 && acSpy.img.nw > 0, JSON.stringify({ acBtc, acSpy }));
    check('...served from this project\'s own bucket, prefixed with the project origin the page is configured with (never a provider URL)',
      !!acBtc && acBtc.img.src === url.replace(/\/$/, '') + byId['PROD-0026'].logo_url, acBtc && acBtc.img.src);
    const acNgf = acMarks.find((m) => m.mono === 'NGF');
    check('Nordic Growth Fund (Private Equity, no ticker) renders a MONOGRAM from its initials: NGF',
      !!acNgf && acNgf.isMono && acNgf.text === 'NGF' && !acNgf.img, JSON.stringify(acNgf));
    check('...at the catalog size, 40×40, a real circle', !!acNgf && acNgf.w === 40 && acNgf.h === 40 && acNgf.radius === '50%', JSON.stringify(acNgf));
    check('every catalog card carries exactly one well (PE, Real Assets, ETFs and crypto alike — nothing is skipped)',
      await cdp.evaluate('[...document.querySelectorAll("#asset-cards-grid [data-product-id]")].every(c => c.querySelectorAll(".mk").length === 1)'));
    check('no <img> in any well is broken (errored images were swapped, not left)',
      acMarks.every((m) => !m.img || (m.img.complete && m.img.nw > 0)), JSON.stringify(acMarks.filter((m) => m.img && !(m.img.complete && m.img.nw > 0))));
    check('the Elbstream attribution is on the page at ≥ 16px (12pt) with a real link',
      await cdp.evaluate('(() => { const c = document.querySelector(".asset-logo-credit"); const a = c && c.querySelector("a[href*=\\"elbstream\\"]"); return !!c && !!a && parseFloat(getComputedStyle(c).fontSize) >= 16 && c.getBoundingClientRect().height > 0 && /Logos provided by/.test(c.textContent); })()'));

    // ---- dashboard.html: watchlist cards at 34px, the broken path, the no-provider symbol ----
    const dbReady = await loadAndWait('/dashboard.html', '#wl-rows .wl-card[data-wl-card] .mk');
    check('dashboard.html rendered the watchlist cards with marks', dbReady);
    await cdp.evaluate('(() => { const c = [...document.querySelectorAll("#wl-rows .wl-card[data-wl-card]")].find(x => x.querySelector(".wl-tag").textContent === "AAPL"); if (c) c.click(); return true; })()');
    await sleep(400);
    await cdp.shot('watchlist-1440', '#watchlist-card');
    const dbMarks = await cdp.evaluate(MARKS_JS);
    const wlBtc = dbMarks.find((m) => m.mono === 'BTC');
    check('BTC on the watchlist shows the same real decoded logo, at 34×34', !!wlBtc && !wlBtc.isMono && wlBtc.img.nw > 0 && wlBtc.w === 34 && wlBtc.h === 34, JSON.stringify(wlBtc));
    const wlBroken = dbMarks.find((m) => m.mono === 'AAPL');
    check('★ the BROKEN stored path (a real 400 from Storage) fell back to the monogram in the real render path — no broken image, no gap',
      !!wlBroken && wlBroken.isMono && wlBroken.text === 'AAPL' && !wlBroken.img && wlBroken.w === 34 && wlBroken.h === 34, JSON.stringify(wlBroken));
    check('...with the 4-character step-down (76%, tighter tracking) so AAPL sits inside the well',
      !!wlBroken && /mk-len4/.test(await cdp.evaluate('(() => { const m = [...document.querySelectorAll(".mk")].find(x => x.getAttribute("data-mk-mono") === "AAPL"); return m ? m.querySelector(".mk-t").className : ""; })()')));
    const wlNone = dbMarks.find((m) => m.mono === brokenSymbol);
    check('a symbol no provider has (null logo_url) renders its ticker monogram straight away', !!wlNone && wlNone.isMono && wlNone.text === brokenSymbol, JSON.stringify(wlNone));
    // Broken-URL fallback the other way too: the page's own listener handles an <img>
    // added at ANY time, so inject a well with a src the static server 404s.
    const injected = await cdp.evaluate(
      '(async () => { const host = document.createElement("div"); host.id = "mk-inject"; document.body.appendChild(host);' +
      ' host.innerHTML = AssetMark.html({ name: "Injected Test", ticker: "INJ", logoUrl: "' + BASE + '/definitely-missing-' + suffix + '.png", size: "l" });' +
      ' for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 150)); const m = host.querySelector(".mk"); if (m.classList.contains("mk-mono")) return { mono: true, text: m.querySelector(".mk-t").textContent, img: !!m.querySelector("img"), w: m.getBoundingClientRect().width }; }' +
      ' return { mono: false }; })()');
    check('an <img> that 404s at ANY time (injected after load) is swapped to its monogram by the document-level listener', injected.mono && injected.text === 'INJ' && !injected.img && injected.w === 46, JSON.stringify(injected));

    // Hue determinism across pages: the same text → the same hue class everywhere.
    const hueOnDashboard = { AAPL: wlBroken && wlBroken.hue, SPY: (dbMarks.find((m) => m.mono === 'SPY') || {}).hue };
    const hueOnCatalog = { SPY: acSpy && acSpy.hue, NGF: acNgf && acNgf.hue };
    check('SPY carries the same hue class on the watchlist and the catalog (deterministic from the text, never re-rolled)',
      !!hueOnDashboard.SPY && hueOnDashboard.SPY === hueOnCatalog.SPY, JSON.stringify({ hueOnDashboard, hueOnCatalog }));

    // ---- asset-performance.html: holdings rows at 28px ----
    const apReady = await loadAndWait('/asset-performance.html', '#return-table-body .mk');
    check('asset-performance.html rendered the Return Table with marks', apReady);
    await cdp.shot('holdings-1440', '#return-table-body');
    const apMarks = await cdp.evaluate(MARKS_JS);
    const apNgf = apMarks.find((m) => m.mono === 'NGF');
    const apBtc = apMarks.find((m) => m.mono === 'BTC');
    check('the holdings row for Nordic Growth Fund shows NGF at 28×28, the same hue as on the catalog', !!apNgf && apNgf.isMono && apNgf.w === 28 && apNgf.hue === hueOnCatalog.NGF, JSON.stringify({ apNgf, hueOnCatalog }));
    check('the holdings row for Bitcoin shows the real decoded logo at 28×28', !!apBtc && !apBtc.isMono && apBtc.img.nw > 0 && apBtc.w === 28, JSON.stringify(apBtc));
    check('the old 3px asset-class swatch is gone from the name cell', await cdp.evaluate('!document.querySelector("#return-table-body [style*=\\"width:3px\\"]")'));

    // ===================================================================================
    console.log('\n=== 4. Centring and length scaling — four sizes × three lengths, measured ===\n');
    // ===================================================================================
    // Rendered on the dashboard (real page, real fonts) as an injected strip. The label's
    // box centre must sit on the well's centre, and the label must stay clear of the edge:
    // a 4-character ticker that touches the circle is exactly what the step-down exists to
    // prevent. line-height:1 is what makes the vertical centre hold — the box IS the em box.
    const STRIP_JS = [
      '(() => { const host = document.createElement("div"); host.id = "mk-strip"; host.style.cssText = "position:fixed;left:40px;top:40px;background:#fff;padding:12px;display:flex;gap:10px;flex-wrap:wrap;width:520px;z-index:9999";',
      '  const out = []; for (const size of ["l","m","s","xs"]) for (const t of ["AB","SPY","NVDA"]) host.insertAdjacentHTML("beforeend", AssetMark.html({ name: t, ticker: t, logoUrl: null, size }));',
      '  document.body.appendChild(host);',
      '  return [...host.querySelectorAll(".mk")].map(m => { const r = m.getBoundingClientRect(); const t = m.querySelector(".mk-t"); const tr = t.getBoundingClientRect();',
      '    const range = document.createRange(); range.selectNodeContents(t); const ir = range.getBoundingClientRect();',
      '    return { size: m.className.match(/mk-(l|m|s|xs)/)[1], text: t.textContent, w: r.width, h: r.height, fs: Math.round(parseFloat(getComputedStyle(t).fontSize) * 100) / 100,',
      '      dx: Math.round(((tr.left + tr.right) / 2 - (r.left + r.right) / 2) * 100) / 100, dy: Math.round(((tr.top + tr.bottom) / 2 - (r.top + r.bottom) / 2) * 100) / 100,',
      '      inkW: Math.round(ir.width * 10) / 10, inkH: Math.round(ir.height * 10) / 10, margin: Math.round(((r.width - ir.width) / 2) * 10) / 10 }; });',
      '})()'
    ].join('');
    const strip = await cdp.evaluate(STRIP_JS);
    await cdp.shot('strip-sizes');
    const SIZE_PX = { l: 46, m: 40, s: 34, xs: 28 };
    const BASE_FS = { l: 15.2, m: 13, s: 11.4, xs: 9.8 };
    for (const m of strip) {
      const want = SIZE_PX[m.size];
      const wantFs = Math.round(BASE_FS[m.size] * (m.text.length === 3 ? 0.92 : (m.text.length >= 4 ? 0.76 : 1)) * 100) / 100;
      check(m.size + ' ' + m.text + ': the well is ' + want + '×' + want, m.w === want && m.h === want, m.w + 'x' + m.h);
      check(m.size + ' ' + m.text + ': the label is stepped by length (' + wantFs + 'px)', Math.abs(m.fs - wantFs) <= 0.05, String(m.fs));
      check(m.size + ' ' + m.text + ': centred in the well (|dx| ≤ 1, |dy| ≤ 1.5) — dx=' + m.dx + ' dy=' + m.dy, Math.abs(m.dx) <= 1 && Math.abs(m.dy) <= 1.5, 'dx=' + m.dx + ' dy=' + m.dy);
      // The ink must clear the circle: at the well's mid-height the circle is full width, so
      // a margin of ≥ 12% of the well on each side keeps every glyph inside the curve.
      check(m.size + ' ' + m.text + ': the glyphs stay clear of the circle (margin ≥ ' + Math.round(want * 0.12) + 'px each side) — ink ' + m.inkW + 'px, margin ' + m.margin + 'px', m.margin >= want * 0.12, 'ink ' + m.inkW + 'px in ' + m.w + 'px, margin ' + m.margin);
    }
    await cdp.evaluate('(() => { const s = document.getElementById("mk-strip"); if (s) s.remove(); return true; })()');

    // ===================================================================================
    console.log('\n=== 5. Contrast — every monogram on each real page, then the sheen strip ===\n');
    // ===================================================================================
    function runContrast(profile, page, prepare, label) {
      const r = spawnSync(process.execPath, ['verify-contrast.mjs'], {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
          CONTRAST_PROFILE: profile,
          CONTRAST_URL: BASE + page,
          CONTRAST_BOOTSTRAP_JS: bootstrap,
          CONTRAST_PREPARE_JS: prepare || '',
          CONTRAST_SETTLE_MS: '18000',
          CONTRAST_PORT: String(PORT + 10)
        })
      });
      forwardChildTeardown(r, 'verify-contrast');
      const o = r.stdout || '';
      const m = o.match(/(\d+) measurements, (\d+) below/);
      console.log('  ' + label + ' -> ' + o.trim().split('\n').slice(-2).join(' | '));
      check(label + ': contrast measured real elements (not an empty run)', !!m && Number(m[1]) > 0, o.slice(-400));
      check(label + ': every measured figure clears 4.5:1', /CONTRAST: PASS/.test(o), o.slice(-400));
      o.split('\n').filter((l) => /FAIL\s+\d/.test(l)).forEach((l) => console.log('      ' + l.trim()));
      // The lowest figure of the run, so the writeup carries a real number, not just PASS.
      const lowest = o.split('\n').filter((l) => /(PASS|FAIL)\s+[\d.]+:1/.test(l))
        .sort((a, b) => parseFloat(a.match(/([\d.]+):1/)[1]) - parseFloat(b.match(/([\d.]+):1/)[1]))[0];
      if (lowest) console.log('      lowest: ' + lowest.trim());
      return o;
    }
    const acOut = runContrast('asset-marks', '/asset-collection.html', '', 'catalog monograms (40px) + credit');
    check('the catalog run measured monograms AND both credit surfaces', /monogram/.test(acOut) && /logo credit link/.test(acOut));
    // Open the AAPL card's drawer so the 28px drawer mark is on screen too.
    const openDrawer = '(() => { const c = [...document.querySelectorAll("#wl-rows .wl-card[data-wl-card]")].find(x => x.querySelector(".wl-tag").textContent === "AAPL"); if (c && !document.querySelector(".wl-drawer")) c.click(); return true; })()';
    runContrast('asset-marks', '/dashboard.html', openDrawer, 'watchlist monograms (34px + 28px drawer) + credit');
    runContrast('asset-marks', '/asset-performance.html', '', 'holdings monograms (28px) + credit');
    // The sheen strip: a plain .glass card, NO .glass-lift, its top-left under the sheen's
    // brightest part, holding every size at 3 and 4 characters for every hue.
    const sheenStrip = [
      '(() => { const host = document.createElement("div"); host.id = "mk-sheen-strip"; host.className = "glass";',
      '  host.style.cssText = "position:fixed;left:24px;top:24px;width:420px;padding:10px 12px;display:flex;gap:8px;flex-wrap:wrap;z-index:9999;border-radius:16px";',
      '  const texts = ["SPY","VGK","GLD","NGF","BTC","NVDA","ETH","SOL","QQQ","AGG","XLRE","ERE"];',
      '  for (const size of ["xs","s"]) for (const t of texts) host.insertAdjacentHTML("beforeend", AssetMark.html({ name: t, ticker: t, logoUrl: null, size }));',
      '  document.body.appendChild(host); return host.querySelectorAll(".mk").length; })()'
    ].join('');
    const sheenOut = runContrast('asset-marks-sheen', '/dashboard.html', sheenStrip, 'monograms UNDER the .glass::before sheen (28px and 34px, every hue)');
    check('the sheen run measured the smallest wells (the hardest case) across every hue', (sheenOut.match(/sheen monogram/g) || []).length >= 14, String((sheenOut.match(/sheen monogram/g) || []).length));

    // ===================================================================================
    console.log('\n=== FONTS — the touched pages, by real advance width ===\n');
    // ===================================================================================
    const fontRes = spawnSync(process.execPath, ['audit-fonts.mjs'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      env: Object.assign({}, process.env, { AUDIT_URL: BASE + '/asset-collection.html', AUDIT_BOOTSTRAP_JS: bootstrap, AUDIT_PORT: String(PORT + 20) })
    });
    forwardChildTeardown(fontRes, 'audit-fonts');
    const fontOut = fontRes.stdout || '';
    console.log(fontOut.trim().split('\n').slice(-5).join('\n'));
    check('no family on asset-collection.html falls back (the monogram declares Inter 700 explicitly)', !/FALLBACK/.test(fontOut), fontOut.slice(-400));
    check('the mark introduces no second family — Inter only', !/JetBrains|monospace/i.test(fontOut), fontOut.slice(-400));

    // ===================================================================================
    console.log('\n=== 6. Mobile — 390 / 375 (top-level) and 320 (real iframe) ===\n');
    // ===================================================================================
    const GEOM_JS = '(() => { const grid = document.getElementById("asset-cards-grid"); const cards = [...grid.querySelectorAll("[data-product-id]")];' +
      ' const marks = [...grid.querySelectorAll(".mk")].map(m => Math.round(m.getBoundingClientRect().width));' +
      ' const names = cards.map(c => c.querySelector("p.font-medium")); const gridRight = Math.round(grid.getBoundingClientRect().right);' +
      ' return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, cards: cards.length, markWidths: [...new Set(marks)], gridRight,' +
      '   maxCardRight: Math.max.apply(null, cards.map(c => Math.round(c.getBoundingClientRect().right))),' +
      '   nameClearsMark: cards.every(c => { const m = c.querySelector(".mk"); const n = c.querySelector("p.font-medium"); return m && n && n.getBoundingClientRect().left >= m.getBoundingClientRect().right + 8; }) }; })()';
    for (const width of [390, 375]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
      const mobileReady = await loadAndWait('/asset-collection.html', '#asset-cards-grid [data-product-id] .mk');
      check(width + 'px: the catalog rendered', mobileReady);
      if (!mobileReady) continue;
      const real = await cdp.evaluate('window.innerWidth');
      check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);
      await cdp.shot('catalog-' + width, '#asset-cards-grid');
      const g = await cdp.evaluate(GEOM_JS);
      check(width + 'px: catalog cards rendered', g.cards > 0, JSON.stringify(g));
      check(width + 'px: every well keeps its designed 40px (never squeezed by the card)', g.markWidths.length === 1 && g.markWidths[0] === 40, JSON.stringify(g.markWidths));
      check(width + 'px: no horizontal overflow', g.bodyScroll <= g.inner + 1 && g.maxCardRight <= g.gridRight + 1, JSON.stringify(g));
      check(width + 'px: the name never runs into the well (≥ 8px clear)', g.nameClearsMark, JSON.stringify(g));

      const wlReady = await loadAndWait('/dashboard.html', '#wl-rows .wl-card[data-wl-card] .mk');
      check(width + 'px: the watchlist rendered', wlReady);
      if (!wlReady) continue;
      const wg = await cdp.evaluate('(() => { const rows = document.getElementById("wl-rows"); const cards = [...rows.querySelectorAll(".wl-card[data-wl-card]")];' +
        ' return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, cards: cards.length, marks: [...new Set(cards.map(c => Math.round(c.querySelector(".mk").getBoundingClientRect().width)))],' +
        ' nameFits: cards.every(c => c.querySelector(".wl-card-id").getBoundingClientRect().right <= c.getBoundingClientRect().right + 1) }; })()');
      check(width + 'px: watchlist wells keep their 34px and the ticker/name pair stays inside the card', wg.cards > 0 && wg.marks.length === 1 && wg.marks[0] === 34 && wg.nameFits && wg.bodyScroll <= wg.inner + 1, JSON.stringify(wg));
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.navigate', { url: BASE + '/asset-collection.html' });
    for (let i = 0; i < 80; i++) { await sleep(400); if (await cdp.evaluate('!!(document.body && document.getElementById("asset-cards-grid"))')) break; }
    const narrow = await cdp.evaluate(
      '(async () => { const f = document.createElement("iframe"); f.style.cssText = "width:320px;height:800px;border:0;position:fixed;left:0;top:0;z-index:99999"; f.src = "/asset-collection.html"; document.body.appendChild(f);' +
      ' for (let i = 0; i < 120; i++) { await new Promise(r => setTimeout(r, 400)); const d = f.contentDocument;' +
      '   if (d && d.querySelector("#asset-cards-grid [data-product-id] .mk")) { await new Promise(r => setTimeout(r, 800)); const grid = d.getElementById("asset-cards-grid"); const cards = [...grid.querySelectorAll("[data-product-id]")];' +
      '     return { inner: f.contentWindow.innerWidth, bodyScroll: d.body.scrollWidth, cards: cards.length, markWidths: [...new Set(cards.map(c => Math.round(c.querySelector(".mk").getBoundingClientRect().width)))],' +
      '       maxCardRight: Math.max.apply(null, cards.map(c => Math.round(c.getBoundingClientRect().right))), gridRight: Math.round(grid.getBoundingClientRect().right),' +
      '       nameClearsMark: cards.every(c => c.querySelector("p.font-medium").getBoundingClientRect().left >= c.querySelector(".mk").getBoundingClientRect().right + 8) }; } }' +
      ' return { timedOut: true }; })()');
    check('320px: the iframe genuinely reports 320px', narrow.inner === 320, JSON.stringify(narrow));
    check('320px: catalog cards rendered with their wells at 40px', narrow.cards > 0 && narrow.markWidths.length === 1 && narrow.markWidths[0] === 40, JSON.stringify(narrow));
    check('320px: no horizontal overflow and no card escapes the grid', narrow.bodyScroll <= narrow.inner + 1 && narrow.maxCardRight <= narrow.gridRight + 1, JSON.stringify(narrow));
    check('320px: the name never runs into the well', narrow.nameClearsMark === true, JSON.stringify(narrow));
  } finally {
    if (cdp) await cdp.close();
    await admin.from('watchlist_symbols').delete().eq('client_id', clientId);
    await admin.from('market_data_cache').delete().in('symbol', ['AAPL', brokenSymbol]);
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    const { error: dErr } = await admin.auth.admin.deleteUser(clientId);
    if (dErr) console.log('  TEARDOWN WARNING: could not delete the test user: ' + dErr.message);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err && err.stack);
  process.exit(1);
});
