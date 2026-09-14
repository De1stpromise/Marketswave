#!/usr/bin/env node
// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — visual verification.
//
// Contrast on every new text surface (both badge styles included, measured separately —
// they are two genuinely different colour stacks), the font audit on the touched page, and
// the narrow-viewport behaviour the card genuinely changes: it gained a scrolling list and
// inline row actions, which is exactly the shape that overflows at 320px if it is wrong.
//
// Real headless Chrome over CDP, this project's own established substitute when no browser
// automation tool is available. Every measurement sits behind a viewport-integrity guard —
// Batch 1's first run reported a clean PASS "at 375px" while the browser had silently
// clamped to 492px, and 320px still needs a real same-origin iframe because the top-level
// override floors at 348px on this build.
//
// Requires: the local Supabase stack, `supabase functions serve`, and a static server on
// http://127.0.0.1:8765 serving the project root.

import { execSync, spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WL_BASE || 'http://127.0.0.1:8765';
const PORT = Number(process.env.WL_PORT || 9478);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PASSWORD = 'VerifyWatchlistVisual-2026!';

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
  const profile = makeTempDir('mw-wlvis-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions',
    '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  // Row 172's lesson: a stale cached copy of a just-edited file reported a correct batch as
  // broken. Never measure through the cache.
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  return { send, evaluate, close: () => releaseTempDir(profile) };
}

async function main() {
  console.log('Merged Market Snapshot + Watchlist — visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'wlvis-' + suffix + '@test.marketswave.local';

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (cErr) throw new Error('createUser: ' + cErr.message);
  const clientId = created.user.id;
  await admin.from('clients').insert({
    id: clientId, name: 'Watchlist Visual Verify', email: 'wlvis-verify-' + clientId,
    phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
  });
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 });

  let cdp = null;
  try {
    // Seed the watchlist directly so BOTH badge styles and BOTH change directions are
    // genuinely on screen — a real market that happens to be all-green on the day would
    // otherwise leave .wl-dn unmeasured and the run would pass on an absence.
    await admin.from('watchlist_symbols').insert([
      { client_id: clientId, symbol: 'ETH', name: 'Ethereum', source: 'coingecko', provider_id: 'ethereum', asset_type: 'crypto' },
      { client_id: clientId, symbol: 'SPY', name: 'S&P 500 ETF', source: 'finnhub', provider_id: null, asset_type: 'stock' },
      { client_id: clientId, symbol: 'BTC', name: 'Bitcoin', source: 'coingecko', provider_id: 'bitcoin', asset_type: 'crypto' },
      // Since the seeded catalog (2026-09-12, row 202) every base symbol is Offered; SHOP
      // (in place of QQQ) is owned by no product, so it is what puts a real Tracking-only
      // badge on screen. Four cards, deliberately: at three columns that is two ROWS, which
      // is what the drawer-placement proof needs (a top-row card must open beneath row one,
      // not below the grid), and the grid still fits inside .wl-rows' own scroll height.
      { client_id: clientId, symbol: 'SHOP', name: 'Shopify Inc.', source: 'finnhub', provider_id: null, asset_type: 'stock' }
    ]);
    // Fixture symbols must provably NOT be in the real catalog (row 211): since the 2026-09-14
    // seed a hand-picked symbol may be a real product, and a write to its cache row — or a
    // storage delete of its logo — reaches a live product. Check products.ticker before choosing.
    await admin.from('market_data_cache').upsert({ symbol: 'SHOP', value: 200, change_percent: 0.5, source: 'finnhub', name: 'Shopify Inc.', provider_id: null, asset_type: 'stock', last_updated: new Date().toISOString() }, { onConflict: 'symbol' });
    await admin.from('clients').update({ watchlist_seeded_at: new Date().toISOString() }).eq('id', clientId);
    // Force one row genuinely negative and one genuinely positive in the cache, so both
    // tones are painted. These are real cache rows, overwritten by the next scheduled
    // refresh — nothing about the feature depends on them staying this way.
    await admin.from('market_data_cache').update({ change_percent: -1.24 }).eq('symbol', 'SPY');
    await admin.from('market_data_cache').update({ change_percent: 2.41 }).eq('symbol', 'BTC');

    const alertRow = (await admin.from('watchlist_symbols').select('id').eq('client_id', clientId).eq('symbol', 'BTC').single()).data;
    await admin.from('price_alerts').insert({
      client_id: clientId, watchlist_symbol_id: alertRow.id, symbol: 'BTC',
      direction: 'above', target_price: 999999, status: 'active'
    });

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

    // Opens the add panel (so .wl-src is painted) and the alert modal (so its own two text
    // surfaces are). Without this most of the profile is display:none and the run would
    // report a confident pass over nothing.
    // Opens the add panel so .wl-src is genuinely painted. It deliberately does NOT open
    // the alert modal: that covers the page with a blurred scrim, and every row behind it
    // would then be sampled THROUGH the scrim — which is exactly how the first run of this
    // reported .wl-name at 3.6:1 on a mid-grey ground. The modal is measured in its own run.
    // Also opens the FIRST card (ETH, Offered) so the open-state face is painted and the
    // drawer's own profile has something to measure.
    const prepareCard = [
      '(() => {',
      '  const c = document.querySelector("#wl-rows .wl-card[data-wl-card]"); if (c && !document.querySelector(".wl-drawer")) c.click();',
      '  const t = document.getElementById("wl-add-toggle"); if (t && document.getElementById("wl-addpanel").hidden) t.click();',
      '  const r = document.getElementById("wl-results");',
      '  if (r) r.innerHTML = \'<button type=\\"button\\" class=\\"wl-res\\"><span class=\\"wl-tag\\">ETH</span><span class=\\"wl-name\\">Ethereum</span><span class=\\"wl-src\\">Crypto</span></button>\';',
      '  return true;',
      '})()'
    ].join('');

    function prepareDrawerFor(sym) {
      return [
        '(() => {',
        '  const card = [...document.querySelectorAll("#wl-rows .wl-card[data-wl-card]")].find(c => c.querySelector(".wl-tag").textContent === ' + JSON.stringify(sym) + ');',
        '  if (card && card.getAttribute("aria-expanded") !== "true") card.click();',
        '  return !!document.querySelector(".wl-drawer");',
        '})()'
      ].join('');
    }

    // The bell lives in the drawer now, so the drawer is opened first.
    const prepareModal = [
      '(() => {',
      '  const c = document.querySelector("#wl-rows .wl-card[data-wl-card]"); if (c && !document.querySelector(".wl-drawer")) c.click();',
      '  const bell = document.querySelector("[data-wl-bell]"); if (bell) bell.click();',
      '  const err = document.getElementById("wl-alert-error");',
      '  if (err) { err.textContent = "Enter a target price greater than zero."; err.hidden = false; }',
      '  return true;',
      '})()'
    ].join('');

    // ===================================================================================
    console.log('=== CONTRAST — every new text surface, real composited pixels ===\n');
    // ===================================================================================
    function runContrast(profile, prepare, label) {
      const r = spawnSync(process.execPath, ['verify-contrast.mjs'], {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
          CONTRAST_PROFILE: profile,
          CONTRAST_URL: BASE + '/dashboard.html',
          CONTRAST_BOOTSTRAP_JS: bootstrap,
          CONTRAST_PREPARE_JS: prepare,
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
      o.split('\n').filter((l) => /FAIL\s+\d|UNMEASURED\s/.test(l)).forEach((l) => console.log('      ' + l.trim()));
      return o;
    }

    const out = runContrast('watchlist', prepareCard, 'the card faces');
    // BTC carries the seeded alert and is Offered: Allocate, an armed bell and the alert
    // line are all on screen in its drawer. SHOP is Tracking-only: its drawer badge is the
    // other colour stack and its bell is unarmed.
    const drawerOffered = runContrast('watchlist-drawer', prepareDrawerFor('BTC'), 'the drawer (Offered, armed alert)');
    const drawerTracking = runContrast('watchlist-drawer', prepareDrawerFor('SHOP'), 'the drawer (Tracking only)');
    runContrast('watchlist-modal', prepareModal, 'the alert modal');

    // Both badge styles are two genuinely different colour stacks; neither may be skipped —
    // on the face AND inside the drawer.
    check('the Offered badge was genuinely measured on a card face', /badge Offered/.test(out));
    check('the Tracking only badge was genuinely measured on a card face', /badge Tracking only/.test(out));
    check('the open card\'s own face was measured (the sheen-composited top-left corner, opened)',
      /OPEN card ticker/.test(out) && /OPEN card name/.test(out));
    check('both change directions were measured (a green-only market would hide the loss tone)',
      /card change \(gain\)/.test(out) && /card change \(loss\)/.test(out));
    check('the Offered badge was measured inside the drawer', /drawer badge Offered/.test(drawerOffered));
    check('the Tracking only badge was measured inside the drawer', /drawer badge Tracking only/.test(drawerTracking));
    check('the armed bell and the alert line were measured inside the drawer',
      /drawer bell \(armed\)/.test(drawerOffered) && /armed alert line/.test(drawerOffered));
    check('the unarmed bell and Remove were measured inside the drawer',
      /drawer bell \(unarmed\)/.test(drawerTracking) && /drawer Remove/.test(drawerTracking));
    check('Allocate was measured inside the Offered drawer', /drawer Allocate/.test(drawerOffered));

    // ===================================================================================
    console.log('\n=== FONTS — the touched page, by real advance width ===\n');
    // ===================================================================================
    const fontRes = spawnSync(process.execPath, ['audit-fonts.mjs'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        AUDIT_URL: BASE + '/dashboard.html',
        AUDIT_BOOTSTRAP_JS: bootstrap,
        AUDIT_PORT: String(PORT + 20)
      })
    });
    forwardChildTeardown(fontRes, 'audit-fonts');
    const fontOut = fontRes.stdout || '';
    console.log(fontOut.trim().split('\n').slice(-6).join('\n'));
    check('no family on the touched page falls back', !/FALLBACK/.test(fontOut), fontOut.slice(-400));
    check('the new card introduces no second family — Inter only',
      !/JetBrains|monospace/i.test(fontOut), fontOut.slice(-400));

    // ===================================================================================
    console.log('\n=== LAYOUT — three, two and one columns; the drawer beneath the card\'s own row ===\n');
    // ===================================================================================
    cdp = await connectChrome();
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(900);
    await cdp.evaluate(bootstrap);

    // 560px is where the card's own width lands between the container-query breakpoints:
    // two columns, with the sidebar collapsed to a drawer. The expected column count per
    // width is asserted, not just read, so a broken container query cannot pass as "1".
    const EXPECTED_COLS = { 1440: 3, 560: 2, 390: 1, 375: 1 };
    // Column count and row membership are read from REAL layout (card top edges), which is
    // the same signal placeDrawer() uses — so this proves the rule against the geometry a
    // client sees, not against the script's own idea of it.
    const GEOM_JS =
      '(() => { const card = document.getElementById("watchlist-card"); const rows = document.getElementById("wl-rows");' +
      ' const cards = [...rows.querySelectorAll(".wl-card[data-wl-card]")]; const tops = [...new Set(cards.map(c => Math.round(c.getBoundingClientRect().top)))];' +
      ' const cols = cards.filter(c => Math.round(c.getBoundingClientRect().top) === tops[0]).length;' +
      ' const d = rows.querySelector(".wl-drawer");' +
      ' const rowOf = (c) => tops.indexOf(Math.round(c.getBoundingClientRect().top));' +
      ' return { rendered: cards.length > 0, cards: cards.length, cols, rowCount: tops.length, bodyScroll: document.body.scrollWidth, inner: window.innerWidth,' +
      '   cardRight: Math.round(card.getBoundingClientRect().right), overflowY: getComputedStyle(rows).overflowY,' +
      '   maxRowRight: Math.max.apply(null, [...rows.querySelectorAll(".wl-card[data-wl-card], .wl-drawer")].map(r => Math.round(r.getBoundingClientRect().right))),' +
      '   drawers: rows.querySelectorAll(".wl-drawer").length,' +
      '   drawer: d ? { top: Math.round(d.getBoundingClientRect().top), bottom: Math.round(d.getBoundingClientRect().bottom), prevIsCard: !!(d.previousElementSibling && d.previousElementSibling.classList.contains("wl-card")), isLast: !d.nextElementSibling, forSym: d.querySelector(".wl-drawer-top b").textContent } : null,' +
      '   rowBottoms: tops.map(t => Math.max.apply(null, cards.filter(c => Math.round(c.getBoundingClientRect().top) === t).map(c => Math.round(c.getBoundingClientRect().bottom)))),' +
      '   rowTops: tops, openRows: cards.filter(c => c.classList.contains("is-open")).map(rowOf), openCount: cards.filter(c => c.getAttribute("aria-expanded") === "true").length };})()';

    for (const width of [1440, 560, 390, 375]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
      await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
      let ready = false;
      for (let i = 0; i < 80 && !ready; i++) {
        await sleep(400);
        ready = await cdp.evaluate('!!document.querySelector("#wl-rows .wl-card[data-wl-card]")');
      }
      // VIEWPORT-INTEGRITY GUARD. A silently clamped viewport reports a clean pass over a
      // width that was never tested.
      const real = await cdp.evaluate('window.innerWidth');
      check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);

      const geom = await cdp.evaluate(GEOM_JS);
      check(width + 'px: the card genuinely rendered real cards', geom.rendered && geom.cards === 4, JSON.stringify(geom));
      check(width + 'px: the grid is ' + EXPECTED_COLS[width] + ' column(s) wide', geom.cols === EXPECTED_COLS[width], 'cols=' + geom.cols + ' rows=' + geom.rowCount);
      check(width + 'px: no horizontal overflow on the page', geom.bodyScroll <= geom.inner + 1, JSON.stringify(geom));
      check(width + 'px: no card escapes the card', geom.maxRowRight <= geom.cardRight + 1, JSON.stringify(geom));
      check(width + 'px: the list scrolls rather than growing without limit', geom.overflowY === 'auto', geom.overflowY);
      check(width + 'px: no drawer is open at rest', geom.drawers === 0 && geom.openCount === 0, JSON.stringify(geom.drawer));

      // ---- The drawer inserts beneath the tapped card's OWN row, one at a time ----------
      // Tap the FIRST card (top row) with a real pointer event at its centre — the primary
      // interaction is a tap, so this is a real click, not a synthetic .click().
      async function tapCard(index) {
        const r = await cdp.evaluate('(() => { const c = document.querySelectorAll("#wl-rows .wl-card[data-wl-card]")[' + index + ']; c.scrollIntoView({block: "center"}); const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()');
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
        await sleep(250);
        return cdp.evaluate(GEOM_JS);
      }
      const g1 = await tapCard(0);
      check(width + 'px: tapping a top-row card opens exactly one drawer', g1.drawers === 1 && g1.openCount === 1, JSON.stringify({ drawers: g1.drawers, open: g1.openCount }));
      check(width + 'px: ...for that card', !!g1.drawer && /ETH/.test(g1.drawer.forSym), g1.drawer && g1.drawer.forSym);
      check(width + 'px: ...inserted directly after a card of row 1, beneath that row (drawer.top >= row-1 bottom)',
        !!g1.drawer && g1.drawer.prevIsCard && g1.drawer.top >= g1.rowBottoms[0] - 1, JSON.stringify({ drawer: g1.drawer, rowBottoms: g1.rowBottoms }));
      if (g1.rowCount > 1) {
        check(width + 'px: ...and ABOVE row 2 — not below the whole grid (drawer.bottom <= row-2 top)',
          g1.drawer.bottom <= g1.rowTops[1] + 1 && !g1.drawer.isLast, JSON.stringify({ drawer: g1.drawer, rowTops: g1.rowTops }));
      } else {
        check(width + 'px: ...(single-row grid: the drawer is the last child, beneath the only row)', g1.drawer.isLast, JSON.stringify(g1.drawer));
      }
      // The last card is on the last row at every column count seeded here (4 cards).
      const g2 = await tapCard(3);
      check(width + 'px: tapping a last-row card moves the ONE drawer beneath the last row', g2.drawers === 1 && g2.openCount === 1 && g2.openRows[0] === g2.rowCount - 1 && !!g2.drawer && g2.drawer.top >= g2.rowBottoms[g2.rowCount - 1] - 1 && g2.drawer.isLast, JSON.stringify({ drawer: g2.drawer, rowBottoms: g2.rowBottoms, openRows: g2.openRows }));
      check(width + 'px: ...and the first card is no longer open', g2.openRows.length === 1 && /SHOP/.test(g2.drawer.forSym), JSON.stringify(g2.openRows));
      const g3 = await tapCard(3);
      check(width + 'px: tapping the open card again closes its drawer', g3.drawers === 0 && g3.openCount === 0, JSON.stringify({ drawers: g3.drawers, open: g3.openCount }));

      // Row 171's floor still holds on the card's own controls.
      if (width < 1024) {
        const small = await cdp.evaluate(
          '(() => { const bad = []; document.querySelectorAll("#watchlist-card button, #watchlist-card a.mw-btn, #watchlist-card input, #watchlist-card [role=button]")' +
          '.forEach(el => { const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;' +
          ' if (r.width < 44 || r.height < 44) bad.push(el.className + " " + Math.round(r.width) + "x" + Math.round(r.height)); });' +
          ' return bad; })()'
        );
        check(width + 'px: every control on the card is at least 44x44', small.length === 0, JSON.stringify(small));
      }
    }

    // 320px through a real same-origin iframe — the top-level override floors at 348 here.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
    // A readiness poll, not a fixed sleep: under load (a second headless Chrome running
    // alongside) 2.5s was not enough for the host document to even have a <body>.
    for (let i = 0; i < 80; i++) {
      await sleep(400);
      if (await cdp.evaluate('!!(document.body && document.getElementById("wl-rows"))')) break;
    }
    const narrow = await cdp.evaluate(
      '(async () => {' +
      '  const f = document.createElement("iframe");' +
      '  f.style.cssText = "width:320px;height:800px;border:0;position:fixed;left:0;top:0;z-index:99999";' +
      '  f.src = "/dashboard.html";' +
      '  document.body.appendChild(f);' +
      '  for (let i = 0; i < 120; i++) {' +
      '    await new Promise(r => setTimeout(r, 400));' +
      '    const d = f.contentDocument;' +
      '    if (d && d.querySelector("#wl-rows .wl-card[data-wl-card]")) {' +
      '      const card = d.getElementById("watchlist-card");' +
      '      const rows = [...d.querySelectorAll("#wl-rows .wl-card[data-wl-card]")];' +
      '      rows[0].click(); await new Promise(r => setTimeout(r, 600));' +
      // Every rect is read AFTER the tap and one settle, never split across it — a first
      // draft read the card tops before tapping and compared after, and the web font
      // finishing loading between the two reads shifted every top by a pixel (cols: 0).
      '      const tops = [...new Set(rows.map(c => Math.round(c.getBoundingClientRect().top)))];' +
      '      const dr = d.querySelector(".wl-drawer");' +
      '      return { inner: f.contentWindow.innerWidth, bodyScroll: d.body.scrollWidth,' +
      '        cardRight: Math.round(card.getBoundingClientRect().right),' +
      '        cols: rows.filter(c => Math.round(c.getBoundingClientRect().top) === tops[0]).length,' +
      '        maxRowRight: Math.max.apply(null, [...d.querySelectorAll("#wl-rows .wl-card[data-wl-card], #wl-rows .wl-drawer")].map(r => Math.round(r.getBoundingClientRect().right))),' +
      '        drawerBelowFirst: !!dr && Math.round(dr.getBoundingClientRect().top) >= Math.round(rows[0].getBoundingClientRect().bottom) - 1 && Math.round(dr.getBoundingClientRect().bottom) <= Math.round(rows[1].getBoundingClientRect().top) + 1,' +
      '        rows: rows.length };' +
      '    }' +
      '  }' +
      '  return { timedOut: true };' +
      '})()'
    );
    check('320px: the iframe genuinely reports 320px (real narrow viewport, not a clamped one)',
      narrow.inner === 320, JSON.stringify(narrow));
    check('320px: the card genuinely rendered real cards', narrow.rows > 0, JSON.stringify(narrow));
    check('320px: the grid collapses to one column', narrow.cols === 1, JSON.stringify(narrow));
    check('320px: no horizontal overflow', narrow.bodyScroll <= narrow.inner + 1, JSON.stringify(narrow));
    check('320px: no card or drawer escapes the card', narrow.maxRowRight <= narrow.cardRight + 1, JSON.stringify(narrow));
    check('320px: the drawer opens directly beneath the tapped card, above the next one', narrow.drawerBelowFirst === true, JSON.stringify(narrow));
  } finally {
    if (cdp) await cdp.close();
    await admin.from('price_alerts').delete().eq('client_id', clientId);
    await admin.from('watchlist_symbols').delete().eq('client_id', clientId);
    await admin.from('market_data_cache').delete().eq('symbol', 'SHOP');
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    await admin.auth.admin.deleteUser(clientId);
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
