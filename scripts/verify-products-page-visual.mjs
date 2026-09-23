// ★ PM tool revamp, part 6 — the products page, in a real browser.
//
// What this suite exists to prove, beyond "it renders":
//   1. THE NAVIGATION IS ACTUALLY THERE. Row 228: the approval gate shipped reachable and
//      inescapable, and a 69-assertion visual suite passed straight over it because every
//      assertion was about the feature. The rail, its active item and a reachable Log out are
//      read off the real rendered DOM — the half jsdom cannot do, since admin-sidebar.js gates
//      rendering on a real getSession().
//   2. ★ THE RETIRED ROW. Row 233 found 2.59:1 once by DIMMING THE WORDS to signal absence.
//      A retired product is dimmed in its CHROME only — its name, its price and the sentence
//      explaining what retirement means all stay full-contrast. A throwaway retired product is
//      created for this run specifically so the row genuinely exists to measure, rather than
//      the assertion quietly passing on an empty selector.
//   3. Contrast with the .glass::before sheen COMPOSITED, on real pixels, plus the sheen audit.
//   4. A REAL PHONE at 320/375/390 — mobile: true, DPR 3, touch — proven by matchMedia rather
//      than inferred from width (row 229). 320px goes through a real same-origin iframe,
//      because the top-level metrics override floors at ~348px on this build (row 170).
import { execSync, spawnSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';
import { adminNavItemCount } from './lib/admin-nav-count.mjs';

// ★ Derived from admin-sidebar.js's own NAV_ITEMS, never retyped: this literal was '10' in
// seven suites, and adding one rail item broke four assertions and left three polling until
// they timed out, which reads as 'the page never rendered' (2026-09-23).
const NAV_COUNT = adminNavItemCount();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const URL_ = BASE + '/admin-products.html';
const SUF = crypto.randomBytes(3).toString('hex');
const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

function runChild(script, env, label) {
  const res = spawnSync(process.execPath, [script], {
    cwd: HERE, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 900000
  });
  forwardChildTeardown(res, label);
  return (res.stdout || '') + (res.stderr || '');
}

function runContrast(profile, label, bootstrap, prepare) {
  const out = runChild('verify-contrast.mjs', {
    CONTRAST_PROFILE: profile, CONTRAST_URL: URL_,
    CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare || '',
    CONTRAST_WIDTHS: '1440'
  }, 'verify-contrast(' + profile + ')');
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ');
  // ★ A profile that measured NOTHING would otherwise report a confident pass — the vacuity
  // class this project has hit four separate ways. Count first, then judge.
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1 with the sheen composited', /CONTRAST: PASS/.test(out), tail);
  return m ? Number(m[1]) : 0;
}

function runFonts(bootstrap) {
  const out = runChild('verify-fonts.mjs', { AUDIT_URL: URL_, AUDIT_BOOTSTRAP_JS: bootstrap }, 'verify-fonts');
  check('no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check('no monospace family anywhere — the scheme is Inter (row 192)',
    !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}

// --- CDP ------------------------------------------------------------------------------------
async function connect(profile) {
  // Attach to a PAGE target, never the browser-level endpoint: Page.enable does not exist there.
  const PORT = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; });
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250);
    } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
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
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { chrome, ws, send, evaluate };
}

// A REAL phone, not a narrow desktop window — proven by matchMedia below, never by width.
async function phone(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function desktop(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}

const WAIT = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) {
    if (document.querySelectorAll('.pr-tr').length > 0 &&
        document.querySelectorAll('.pr-hc').length === 5 &&
        document.readyState === 'complete') break;
    await nap(200);
  }
  await nap(700);
  return true;
})()`;

const READ = `(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
    const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const rects = [...document.querySelectorAll('body *')].map(e => e.getBoundingClientRect());
  const row = document.querySelector('.pr-tr');
  return {
    inner: window.innerWidth,
    bodyScroll: document.body.scrollWidth,
    docScroll: document.documentElement.scrollWidth,
    maxRight: Math.max(0, ...rects.map(r => r.right)),
    dpr: window.devicePixelRatio,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    noHover: window.matchMedia('(hover: none)').matches,
    touchPoints: navigator.maxTouchPoints,
    rows: document.querySelectorAll('.pr-tr').length,
    health: [...document.querySelectorAll('.pr-hc')].map(c => ({ k: c.querySelector('.k').textContent, vis: vis(c) })),
    healthCols: getComputedStyle(document.getElementById('pr-health')).gridTemplateColumns.split(' ').length,
    pills: [...document.querySelectorAll('.pr-pill')].map(p => vis(p)),
    searchVis: vis(document.getElementById('pr-search')),
    firstName: row ? (row.querySelector('.pr-nm b') || {}).textContent : null,
    firstNameVis: row ? vis(row.querySelector('.pr-nm b')) : false,
    firstPriceVis: row ? vis(row.querySelector('.pr-px-cell')) : false,
    firstClassVis: row ? vis(row.querySelector('.pr-cls')) : false,
    firstHoldVis: row ? vis(row.querySelector('.pr-hold')) : false,
    firstSrcVis: row ? vis(row.querySelector('.pr-src')) : false,
    pagingVis: vis(document.querySelector('.pr-more .cnt'))
  };
})()`;

// ★ The detail panel at a narrow width. This is where the old page's own modal-geometry
// checks moved when PM tool revamp part 6 replaced its two modals with one overlay panel
// (verify-live-pricing-visual.mjs's retirement note points here). The impact table is the
// densest thing the panel ever shows — four columns per holder — so it is what gets measured.
const PANEL_NARROW = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.pr-tr').length > 0) break; await nap(200); }
  const s = document.getElementById('pr-search');
  s.value = 'Nordic Growth Fund';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  await nap(500);
  const row = document.querySelector('.pr-tr');
  if (!row) return { missing: true };
  row.click();
  await nap(400);
  const pct = document.getElementById('pr-nav-pct');
  if (pct) { pct.value = '4.2'; pct.dispatchEvent(new Event('input', { bubbles: true })); }
  await nap(700);
  const panel = document.getElementById('pr-panel');
  if (!panel) return { missing: true };
  const pr = panel.getBoundingClientRect();
  const over = [];
  panel.querySelectorAll('*').forEach(function (el) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.right > pr.right + 0.5) over.push((el.className || el.tagName).toString().slice(0, 28) + ' ' + Math.round(b.right) + '>' + Math.round(pr.right));
  });
  const impactRows = [...panel.querySelectorAll('.pr-impact-row')];
  const buttons = [...panel.querySelectorAll('.pr-pf .mw-btn')].map(function (b) { return Math.round(b.getBoundingClientRect().height); });
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  return {
    missing: false,
    inner: window.innerWidth,
    panelScrollW: panel.scrollWidth, panelClientW: panel.clientWidth,
    bodyScroll: document.body.scrollWidth,
    over: over.slice(0, 6),
    impactRows: impactRows.length,
    impactVis: impactRows.length > 0 && impactRows.every(function (r) { return vis(r); }),
    retireVis: vis(document.getElementById('pr-retire')),
    publishVis: vis(document.getElementById('pr-publish')),
    editVis: vis(document.getElementById('pr-edit')),
    closeVis: vis(document.getElementById('pr-close')),
    buttons: buttons
  };
})()`;

const NAV = `(() => {
  const aside = document.getElementById('admin-sidebar-aside');
  if (!aside) return { missing: true, path: location.pathname, title: document.title };
  const items = [...aside.querySelectorAll('.an-item')];
  return {
    missing: false,
    count: items.length,
    on: items.filter(i => i.classList.contains('is-on')).map(i => (i.querySelector('.an-lb') || {}).textContent),
    logout: !!document.getElementById('admin-logout-btn'),
    railBg: getComputedStyle(aside).backgroundColor,
    asideW: Math.round(aside.getBoundingClientRect().width)
  };
})()`;

// Click the Retired pill and read the retired row back — its own tinted ground.
const RETIRED = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  // ★ Read the LIVE row's colour BEFORE filtering — the Retired pill removes every non-retired
  // row from the DOM, so a comparison taken afterwards has nothing to compare against and
  // reports null, which reads as a page bug rather than as a test one.
  const liveEl = document.querySelector('.pr-tr:not(.is-retired) .pr-nm b');
  const liveNameColor = liveEl ? getComputedStyle(liveEl).color : null;
  const pill = document.querySelector('[data-filter="retired"]');
  if (pill) pill.click();
  await nap(500);
  const row = document.querySelector('.pr-tr.is-retired');
  if (!row) return { missing: true };
  const cs = (el) => el ? getComputedStyle(el) : null;
  const rs = cs(row);
  const nameEl = row.querySelector('.pr-nm b');
  const metaEl = row.querySelector('.pr-meta > span:last-child');
  return {
    missing: false,
    rowOpacity: rs.opacity,
    rowFilter: rs.filter,
    rowBg: rs.backgroundColor,
    nameOpacity: cs(nameEl).opacity,
    nameColor: cs(nameEl).color,
    metaText: metaEl ? metaEl.textContent : '',
    metaOpacity: metaEl ? cs(metaEl).opacity : null,
    flag: !!row.querySelector('.f-ret'),
    // Captured above, on a NON-retired row, for a like-for-like comparison.
    liveNameColor: liveNameColor
  };
})()`;

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);

  const anon = createClient(st.API_URL, st.ANON_KEY);
  const signed = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (signed.error) throw new Error('admin sign-in: ' + signed.error.message);
  const bootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' +
    JSON.stringify(JSON.stringify(signed.data.session)) + '); true';

  // ★ A retired product must genuinely exist, or every retired-row assertion below passes on an
  // empty selector — the vacuity failure this project has now found four separate ways.
  const retiredId = 'PROD-TEST-VIS-' + SUF.toUpperCase();
  const { error: seedErr } = await admin.from('products').insert({
    id: retiredId, name: 'Retired Visual Fund ' + SUF, asset_class: 'Private Equity',
    investment_type: 'Growth Fund', risk_tier: 'balanced', minimum_investment: 1000,
    unit_price: 300, inception_unit_price: 300, pricing_model: 'appraisal',
    status: 'retired', last_tick_date: '2026-06-30',
    retired_at: new Date().toISOString(), retired_by_email: 'pm@marketswave.local',
    retired_reason: 'visual verification fixture'
  });
  if (seedErr) throw new Error('could not seed the retired fixture: ' + seedErr.message);

  let server = null, profile = null, cdp = null;
  try {
    server = spawn('python', ['-m', 'http.server', '8765'], { cwd: ROOT, stdio: 'ignore' });
    await sleep(1500);

    console.log('\n--- Contrast: real composited pixels, sheen ON ---\n');
    const SETTLE = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.pr-tr').length > 0 && document.querySelectorAll('.pr-hc').length === 5) break; await nap(200); }
      await nap(900); })()`;
    const nTable = runContrast('products', 'the catalogue table', bootstrap, SETTLE);

    // ★ THE RETIRED ROW, on its own tinted ground.
    const PREP_RET = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.pr-tr').length > 0) break; await nap(200); }
      document.querySelector('[data-filter="retired"]').click();
      for (let i = 0; i < 100; i++) { if (document.querySelector('.pr-tr.is-retired')) break; await nap(100); }
      await nap(900); })()`;
    const nRet = runContrast('products-retired', '★ the RETIRED row', bootstrap, PREP_RET);
    check('★ the retired profile genuinely measured a retired row (row 233 was a 2.59:1 miss)',
      nRet >= 5, nRet + ' measurements');

    // The detail panel of the appraisal-valued product, with the impact table open.
    const PREP_PANEL = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.pr-tr').length > 0) break; await nap(200); }
      const s = document.getElementById('pr-search');
      s.value = 'Nordic Growth Fund';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      await nap(400);
      const row = document.querySelector('.pr-tr');
      if (row) row.click();
      await nap(400);
      const pct = document.getElementById('pr-nav-pct');
      if (pct) { pct.value = '4.2'; pct.dispatchEvent(new Event('input', { bubbles: true })); }
      await nap(900); })()`;
    runContrast('products-panel', 'the detail panel (appraisal, impact table open)', bootstrap, PREP_PANEL);
    check('GUARD: the table profile measured a real spread of surfaces, not one row',
      nTable >= 40, nTable + ' measurements');

    console.log('\n--- Sheen audit ---\n');
    const sheen = runChild('verify-glass-sheen.mjs', { SHEEN_PAGES: 'admin-products.html', SHEEN_BOOTSTRAP_JS: bootstrap }, 'verify-glass-sheen');
    check('the sheen audit ran against this page and passed with the sheen composited',
      /SHEEN SWEEP: PASS/.test(sheen), sheen.slice(-400));

    console.log('\n--- Fonts ---\n');
    runFonts(bootstrap);

    console.log('\n--- Desktop 1440, then a REAL phone at 390 / 375, then a real 320px iframe ---\n');
    profile = makeTempDir('mw-products-');
    cdp = await connect(profile);

    await desktop(cdp, 1440);
    await cdp.send('Page.navigate', { url: URL_ });
    await cdp.evaluate('(async()=>{ ' + bootstrap + ' })()').catch(() => {});
    await cdp.send('Page.navigate', { url: URL_ });
    await cdp.evaluate(WAIT);

    const nav = await cdp.evaluate(NAV);
    check('★ 1440px: THE PRODUCTS PAGE MOUNTS THE SHARED ADMIN NAV — every item, a real rail with width',
      !nav.missing && nav.count === NAV_COUNT && nav.asideW > 0, JSON.stringify(nav));
    check('★ 1440px: "Products" is the active item',
      !nav.missing && nav.on.join() === 'Products', JSON.stringify(nav.on));
    check('★ 1440px: Log out is reachable from this page', nav.logout === true, String(nav.logout));
    check('1440px: the rail is the vocabulary\'s #0F172A', /15, 23, 42/.test(nav.railBg || ''), nav.railBg);

    const d = await cdp.evaluate(READ);
    check('1440px: the viewport is genuinely 1440 (integrity guard)', d.inner === 1440, String(d.inner));
    check('1440px: no horizontal overflow', d.bodyScroll <= 1440 && d.docScroll <= 1440 && d.maxRight <= 1441,
      JSON.stringify({ b: d.bodyScroll, m: d.maxRight }));
    check('GUARD: real rows are on screen — otherwise every assertion below is vacuous',
      d.rows >= 20, d.rows + ' rows');
    check('1440px: the health strip is five cards across', d.healthCols === 5, String(d.healthCols));
    check('1440px: all five health cards are visible', d.health.length === 5 && d.health.every((h) => h.vis),
      JSON.stringify(d.health.map((h) => h.k + ':' + h.vis)));
    check('1440px: all eight filter pills are visible', d.pills.length === 8 && d.pills.every(Boolean), JSON.stringify(d.pills));
    check('1440px: every cell of a row renders — name, class, price, holders, source',
      d.firstNameVis && d.firstClassVis && d.firstPriceVis && d.firstHoldVis && d.firstSrcVis,
      JSON.stringify(d));

    console.log('\n--- ★ THE RETIRED ROW: dimmed in its chrome, never in its words ---\n');
    const ret = await cdp.evaluate(RETIRED);
    check('GUARD: a retired row is genuinely on screen', ret.missing !== true, JSON.stringify(ret));
    check('★ the retired row is tinted, not faded — no opacity, no filter on the row itself',
      ret.rowOpacity === '1' && (ret.rowFilter === 'none' || !ret.rowFilter),
      'opacity ' + ret.rowOpacity + ', filter ' + ret.rowFilter);
    check('★ ...its tint is a real background, which is what signals the state',
      /248, 250, 252/.test(ret.rowBg || ''), ret.rowBg);
    check('★ its NAME is painted at full strength, identical to a live row — row 233\'s 2.59:1',
      ret.nameOpacity === '1' && !!ret.liveNameColor && ret.nameColor === ret.liveNameColor,
      ret.nameColor + ' vs live ' + ret.liveNameColor);
    check('★ the sentence explaining what retirement means is not faded either',
      ret.metaOpacity === '1' && /no new allocations/i.test(ret.metaText || ''), ret.metaText);
    check('...and the row carries a real Retired flag', ret.flag === true, String(ret.flag));

    for (const w of [390, 375]) {
      await phone(cdp, w);
      await cdp.send('Page.navigate', { url: URL_ });
      await cdp.evaluate(WAIT);
      const m = await cdp.evaluate(READ);
      check('★ ' + w + 'px: a REAL PHONE PROFILE, not a narrow desktop window — DPR 3, coarse pointer, no hover, real touch points',
        m.dpr === 3 && m.coarse === true && m.noHover === true && m.touchPoints >= 1,
        JSON.stringify({ dpr: m.dpr, coarse: m.coarse, noHover: m.noHover, tp: m.touchPoints }));
      check(w + 'px: the viewport is genuinely ' + w + ' (integrity guard)', m.inner === w, String(m.inner));
      check(w + 'px: nothing scrolls horizontally', m.bodyScroll <= w && m.maxRight <= w + 1,
        JSON.stringify({ b: m.bodyScroll, m: m.maxRight }));
      // ★ Row 229: narrow widths RESTACK, they do not HIDE. A PM on a phone still needs to
      // know which product a row is, what it costs and who holds it.
      check('★ ' + w + 'px: the row RESTACKS — name, class, price, holders and source all survive',
        m.firstNameVis && m.firstClassVis && m.firstPriceVis && m.firstHoldVis && m.firstSrcVis,
        JSON.stringify({ n: m.firstNameVis, c: m.firstClassVis, p: m.firstPriceVis, h: m.firstHoldVis, s: m.firstSrcVis }));
      check('★ ' + w + 'px: every health card survives — the strip is the filter set',
        m.health.length === 5 && m.health.every((h) => h.vis), JSON.stringify(m.health.map((h) => h.vis)));
      check('★ ' + w + 'px: search and every filter pill survive',
        m.searchVis && m.pills.length === 8 && m.pills.every(Boolean), JSON.stringify(m.pills));
      check(w + 'px: the paging count is still stated', m.pagingVis === true, String(m.pagingVis));

      const pnl = await cdp.evaluate(PANEL_NARROW);
      check('GUARD: ' + w + 'px: the detail panel opened with its impact table', pnl.missing !== true && pnl.impactRows > 0,
        JSON.stringify(pnl));
      check('★ ' + w + 'px: the panel does not scroll horizontally, and nothing escapes it',
        pnl.panelScrollW <= pnl.panelClientW + 1 && pnl.over.length === 0 && pnl.bodyScroll <= w + 1,
        JSON.stringify({ s: pnl.panelScrollW, c: pnl.panelClientW, over: pnl.over }));
      check('★ ' + w + 'px: every impact row stays on screen — a holder is never dropped to fit',
        pnl.impactVis === true, pnl.impactRows + ' rows');
      check('★ ' + w + 'px: all four panel actions survive — Retire, Publish, Edit details, Close',
        pnl.retireVis && pnl.publishVis && pnl.editVis && pnl.closeVis,
        JSON.stringify({ r: pnl.retireVis, p: pnl.publishVis, e: pnl.editVis, c: pnl.closeVis }));
      check(w + 'px: every panel action meets the 44px tap floor',
        pnl.buttons.length >= 4 && pnl.buttons.every((h) => h >= 44), JSON.stringify(pnl.buttons));
    }

    // 320px through a real same-origin iframe: the top-level override floors at ~348px here.
    await desktop(cdp, 1440);
    await cdp.send('Page.navigate', { url: URL_ });
    await cdp.evaluate(WAIT);
    const iframe = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelectorAll('#mw320').forEach(n => n.remove());
      const f = document.createElement('iframe');
      f.id = 'mw320'; f.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:760px;border:0;z-index:99999';
      f.src = '/admin-products.html';
      document.body.appendChild(f);
      for (let i = 0; i < 300; i++) {
        try { const dd = f.contentDocument; if (dd && dd.querySelectorAll('.pr-tr').length > 0) break; } catch (e) {}
        await nap(200);
      }
      await nap(1200);
      const dd = f.contentDocument, w = f.contentWindow;
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = w.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const rects = [...dd.querySelectorAll('body *')].map(e => e.getBoundingClientRect());
      const row = dd.querySelector('.pr-tr');
      return {
        inner: w.innerWidth,
        bodyScroll: dd.body.scrollWidth,
        maxRight: Math.max(0, ...rects.map(r => r.right)),
        rows: dd.querySelectorAll('.pr-tr').length,
        health: [...dd.querySelectorAll('.pr-hc')].map(c => vis(c)),
        pills: [...dd.querySelectorAll('.pr-pill')].map(p => vis(p)),
        nameVis: row ? vis(row.querySelector('.pr-nm b')) : false,
        priceVis: row ? vis(row.querySelector('.pr-px-cell')) : false,
        holdVis: row ? vis(row.querySelector('.pr-hold')) : false,
        name: row ? (row.querySelector('.pr-nm b') || {}).textContent : null
      };
    })()`);
    check('320px (real iframe): the viewport is genuinely 320 (integrity guard)', iframe.inner === 320, String(iframe.inner));
    check('★ 320px: nothing scrolls horizontally', iframe.bodyScroll <= 321 && iframe.maxRight <= 321,
      JSON.stringify({ b: iframe.bodyScroll, m: iframe.maxRight }));
    check('GUARD: 320px rendered real rows', iframe.rows >= 20, iframe.rows + ' rows');
    check('★ 320px: the product name, its price and its holders all survive',
      iframe.nameVis && iframe.priceVis && iframe.holdVis, JSON.stringify(iframe));
    check('★ 320px: the health strip and every filter pill survive',
      iframe.health.length === 5 && iframe.health.every(Boolean) &&
      iframe.pills.length === 8 && iframe.pills.every(Boolean),
      JSON.stringify({ h: iframe.health, p: iframe.pills }));

  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (e) {} try { cdp.chrome.kill(); } catch (e) {} }
    if (profile) await releaseTempDir(profile);
    if (server) { try { server.kill(); } catch (e) {} }
    await admin.from('products').delete().eq('id', retiredId);
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('PRODUCTS PAGE VISUAL: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 1200000 });
