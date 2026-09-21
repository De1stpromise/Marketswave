// ★ PM tool revamp, part 7 — the deposit address book, in a real browser (register row 237).
//
// What this suite exists to prove, beyond "it renders":
//   1. THE NAVIGATION IS ACTUALLY THERE. Row 228: the approval gate shipped reachable and
//      inescapable, and a 69-assertion visual suite passed straight over it. The rail, its
//      active item and a reachable Log out are read off the real rendered DOM — the half jsdom
//      cannot do, since admin-sidebar.js gates rendering on a real getSession().
//   2. ★ THE RETIRED ROW. Row 233 found 2.59:1 once by DIMMING THE WORDS to signal absence, and
//      the mockup this page was built from does exactly that (opacity:.5 on the whole row). On
//      THIS page the faded thing would be a 62-character address — the one thing worth reading
//      on a retired row, since its history is why it is still on screen. A throwaway retired
//      address is created for this run so the row genuinely exists to measure.
//   3. Contrast with the .glass::before sheen composited (there is no glass here, and that is
//      asserted rather than assumed), plus the sheen audit.
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const URL_ = BASE + '/admin-deposit-addresses.html';
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
  // class this project has hit four separate ways (§V). Count first, then judge.
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
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
    if (document.querySelectorAll('.da-ar').length > 0 &&
        document.querySelectorAll('.da-gh').length > 0 &&
        document.readyState === 'complete') break;
    await nap(200);
  }
  await nap(700);
  return true;
})()`;

const READ = `(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
    const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('body *')];
  const rects = els.map(e => e.getBoundingClientRect());
  // ★ Name the widest offender rather than reporting a bare number: "maxRight 377" sends you
  // reasoning about CSS, "the toast at 377" sends you to the element.
  let worst = null, worstRight = -1;
  els.forEach((e, i) => { if (rects[i].width > 0 && rects[i].right > worstRight) { worstRight = rects[i].right; worst = e; } });
  const row = document.querySelector('.da-ar:not(.is-retired)');
  return {
    worst: worst ? (worst.tagName + '.' + String(worst.className).slice(0, 40) + '#' + worst.id + ' @' + Math.round(worstRight)) : null,
    inner: window.innerWidth,
    bodyScroll: document.body.scrollWidth,
    docScroll: document.documentElement.scrollWidth,
    maxRight: Math.max(0, ...rects.map(r => r.right)),
    dpr: window.devicePixelRatio,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    noHover: window.matchMedia('(hover: none)').matches,
    touchPoints: navigator.maxTouchPoints,
    rows: document.querySelectorAll('.da-ar').length,
    groups: document.querySelectorAll('.da-gh').length,
    stripCards: document.querySelectorAll('.da-hc').length,
    stripCols: getComputedStyle(document.querySelector('.da-hs')).gridTemplateColumns.split(' ').length,
    pills: [...document.querySelectorAll('.da-pill')].map(p => vis(p)),
    blockedVis: vis(document.querySelector('.da-blocked')),
    blockedChips: document.querySelectorAll('.da-miss').length,
    glassCount: document.querySelectorAll('.glass, .glass-subtle, .glass-dark, .glass-slate, .glass-on-dark').length,
    // Row 229: narrow widths RESTACK, they do not HIDE.
    addrVis: row ? vis(row.querySelector('.da-addr')) : false,
    whoVis: row ? vis(row.querySelector('.da-who')) : false,
    recvVis: row ? vis(row.querySelector('.da-recv')) : false,
    statusVis: row ? vis(row.querySelector('.da-stp')) : false,
    groupCountsVis: vis(document.querySelector('.da-gh .cnt')),
    addBtnVis: vis(document.querySelector('.da-gh .addb'))
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

// Filter to Retired and read the row back on its own tinted ground.
const RETIRED = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  // ★ Read the LIVE row's colour BEFORE filtering — the Retired pill removes every live row
  // from the DOM, so a comparison taken afterwards has nothing to compare against and reports
  // null, which reads as a page bug rather than as a test one.
  const liveEl = document.querySelector('.da-ar:not(.is-retired) .da-addr');
  const liveColor = liveEl ? getComputedStyle(liveEl).color : null;
  const pill = document.querySelector('[data-filter="retired"]');
  if (pill) pill.click();
  await nap(500);
  const row = document.querySelector('.da-ar.is-retired');
  if (!row) return { missing: true };
  const cs = (el) => el ? getComputedStyle(el) : null;
  const rs = cs(row);
  const addrEl = row.querySelector('.da-addr');
  const histEl = row.querySelector('.da-who .ct');
  return {
    missing: false,
    rowOpacity: rs.opacity,
    rowFilter: rs.filter,
    rowBg: rs.backgroundColor,
    addrOpacity: cs(addrEl).opacity,
    addrColor: cs(addrEl).color,
    addrText: addrEl ? addrEl.textContent : '',
    histText: histEl ? histEl.textContent : '',
    histOpacity: histEl ? cs(histEl).opacity : null,
    liveColor: liveColor
  };
})()`;

const PANEL_NARROW = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.da-ar').length > 0) break; await nap(200); }
  const row = [...document.querySelectorAll('.da-ar')].find(r => /deposit/.test(r.textContent) || true);
  if (!row) return { missing: true };
  row.click();
  await nap(700);
  const panel = document.getElementById('da-panel');
  if (!panel || !panel.children.length) return { missing: true };
  const pr = panel.getBoundingClientRect();
  const over = [];
  panel.querySelectorAll('*').forEach(function (el) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.right > pr.right + 0.5) over.push((el.className || el.tagName).toString().slice(0, 26) + ' ' + Math.round(b.right) + '>' + Math.round(pr.right));
  });
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  return {
    missing: false,
    inner: window.innerWidth,
    panelScrollW: panel.scrollWidth, panelClientW: panel.clientWidth,
    bodyScroll: document.body.scrollWidth,
    over: over.slice(0, 6),
    addressVis: vis(panel.querySelector('.da-ph .tx span')),
    addressText: (panel.querySelector('.da-ph .tx span') || {}).textContent || '',
    noteVis: vis(panel.querySelector('.da-note.is-info')),
    buttons: [...panel.querySelectorAll('.da-pf .mw-btn')].map(function (b) { return Math.round(b.getBoundingClientRect().height); })
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

  // ★ A RETIRED ADDRESS MUST GENUINELY EXIST, or every retired-row assertion below passes on an
  // empty selector — the vacuity failure this project has now found four separate ways.
  const retiredAddress = '0x' + crypto.randomBytes(20).toString('hex');
  const { data: retiredRow, error: seedErr } = await admin.from('deposit_addresses').insert({
    currency: 'PYUSD', network: 'ERC-20', address: retiredAddress,
    label: 'Address visual test ' + SUF, status: 'retired',
    created_by_email: 'pm@marketswave.local', retired_at: new Date().toISOString()
  }).select().single();
  if (seedErr) throw new Error('could not seed the retired fixture: ' + seedErr.message);

  let server = null, profile = null, cdp = null;
  try {
    server = spawn('python', ['-m', 'http.server', '8765'], { cwd: ROOT, stdio: 'ignore' });
    await sleep(1500);

    console.log('\n--- Contrast: real composited pixels ---\n');
    const SETTLE = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.da-ar').length > 0 && document.querySelectorAll('.da-hc').length === 4) break; await nap(200); }
      await nap(900); })()`;
    const nBook = runContrast('address-book', 'the book', bootstrap, SETTLE);

    const PREP_RET = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.da-ar').length > 0) break; await nap(200); }
      document.querySelector('[data-filter="retired"]').click();
      for (let i = 0; i < 100; i++) { if (document.querySelector('.da-ar.is-retired')) break; await nap(100); }
      await nap(900); })()`;
    const nRet = runContrast('address-book-retired', '★ the RETIRED row', bootstrap, PREP_RET);
    check('★ the retired profile genuinely measured a retired row (row 233 was a 2.59:1 miss)',
      nRet >= 4, nRet + ' measurements');

    const PREP_PANEL = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.da-ar').length > 0) break; await nap(200); }
      const rows = [...document.querySelectorAll('.da-ar')];
      const withDeposits = rows.find(r => !/none/.test((r.querySelector('.da-recv') || {}).textContent || 'none')) || rows[0];
      withDeposits.click();
      await nap(900); })()`;
    runContrast('address-book-panel', 'the detail panel', bootstrap, PREP_PANEL);
    check('GUARD: the book profile measured a real spread of surfaces, not one row',
      nBook >= 30, nBook + ' measurements');

    console.log('\n--- Sheen audit ---\n');
    const sheen = runChild('verify-glass-sheen.mjs', { SHEEN_PAGES: 'admin-deposit-addresses.html', SHEEN_BOOTSTRAP_JS: bootstrap }, 'verify-glass-sheen');
    check('the sheen audit ran against this page and passed',
      /SHEEN SWEEP: PASS/.test(sheen), sheen.slice(-400));

    console.log('\n--- Fonts ---\n');
    runFonts(bootstrap);

    console.log('\n--- Desktop 1440, then a REAL phone at 390 / 375, then a real 320px iframe ---\n');
    profile = makeTempDir('mw-addrbook-');
    cdp = await connect(profile);

    await desktop(cdp, 1440);
    await cdp.send('Page.navigate', { url: URL_ });
    await cdp.evaluate('(async()=>{ ' + bootstrap + ' })()').catch(() => {});
    await cdp.send('Page.navigate', { url: URL_ });
    await cdp.evaluate(WAIT);

    const nav = await cdp.evaluate(NAV);
    check('★ 1440px: THE ADDRESS BOOK MOUNTS THE SHARED ADMIN NAV — ten items, a real rail with width',
      !nav.missing && nav.count === 10 && nav.asideW > 0, JSON.stringify(nav));
    check('★ 1440px: "Deposit addresses" is the active item',
      !nav.missing && nav.on.join() === 'Deposit addresses', JSON.stringify(nav.on));
    check('★ 1440px: Log out is reachable from this page', nav.logout === true, String(nav.logout));
    check('1440px: the rail is the vocabulary\'s #0F172A', /15, 23, 42/.test(nav.railBg || ''), nav.railBg);

    const d = await cdp.evaluate(READ);
    check('1440px: the viewport is genuinely 1440 (integrity guard)', d.inner === 1440, String(d.inner));
    check('1440px: no horizontal overflow', d.bodyScroll <= 1440 && d.docScroll <= 1440 && d.maxRight <= 1441,
      JSON.stringify({ b: d.bodyScroll, m: d.maxRight }));
    check('GUARD: real rows and groups are on screen — otherwise every assertion below is vacuous',
      d.rows >= 2 && d.groups >= 5, d.rows + ' rows / ' + d.groups + ' groups');
    check('★ 1440px: there is NO glass on this page — the address is the thing being read',
      d.glassCount === 0, String(d.glassCount));
    check('1440px: the strip is four cards across', d.stripCards === 4 && d.stripCols === 4,
      d.stripCards + ' cards / ' + d.stripCols + ' cols');
    check('1440px: all four filter pills are visible', d.pills.length === 4 && d.pills.every(Boolean), JSON.stringify(d.pills));
    check('1440px: every cell of a row renders — address, clients, received, status',
      d.addrVis && d.whoVis && d.recvVis && d.statusVis, JSON.stringify(d));

    console.log('\n--- ★ THE RETIRED ROW: dimmed in its chrome, never in its words ---\n');
    const ret = await cdp.evaluate(RETIRED);
    check('GUARD: a retired row is genuinely on screen', ret.missing !== true, JSON.stringify(ret));
    check('★ the retired row is tinted, not faded — no opacity, no filter on the row itself',
      ret.rowOpacity === '1' && (ret.rowFilter === 'none' || !ret.rowFilter),
      'opacity ' + ret.rowOpacity + ', filter ' + ret.rowFilter);
    check('★ ...its tint is a real background, which is what signals the state',
      /248, 250, 252/.test(ret.rowBg || ''), ret.rowBg);
    check('★★ THE ADDRESS is painted at full strength, identical to a live row — the mockup faded '
      + 'it, and on this page the faded thing would be the one text worth reading',
      ret.addrOpacity === '1' && !!ret.liveColor && ret.addrColor === ret.liveColor,
      ret.addrColor + ' vs live ' + ret.liveColor);
    check('★ ...and it is the full address, not truncated to a stub',
      (ret.addrText || '').length >= 40, String((ret.addrText || '').length) + ' chars');
    check('★ the history it keeps is not faded either',
      ret.histOpacity === '1' && /Previously|Never assigned/.test(ret.histText || ''), ret.histText);

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
        JSON.stringify({ b: m.bodyScroll, m: m.maxRight, worst: m.worst }));
      // ★ Row 229: narrow widths RESTACK, they do not HIDE. A PM on a phone still needs to know
      // which address a row is, who it serves and what has arrived on it.
      check('★ ' + w + 'px: the row RESTACKS — address, clients, received and status all survive',
        m.addrVis && m.whoVis && m.recvVis && m.statusVis,
        JSON.stringify({ a: m.addrVis, w: m.whoVis, r: m.recvVis, s: m.statusVis }));
      check('★ ' + w + 'px: the blocked banner survives — it is the reason to be on this page',
        m.blockedVis === true && m.blockedChips > 0, m.blockedChips + ' chips');
      check('★ ' + w + 'px: every group keeps its counts and its Add action',
        m.groupCountsVis && m.addBtnVis, JSON.stringify({ c: m.groupCountsVis, a: m.addBtnVis }));
      check(w + 'px: the strip collapses to two columns rather than hiding cards',
        m.stripCards === 4 && m.stripCols === 2, m.stripCards + ' cards / ' + m.stripCols + ' cols');
      check('★ ' + w + 'px: all four filter pills survive', m.pills.length === 4 && m.pills.every(Boolean));

      const pnl = await cdp.evaluate(PANEL_NARROW);
      check('GUARD: ' + w + 'px: the detail panel opened', pnl.missing !== true, JSON.stringify(pnl));
      check('★ ' + w + 'px: the panel does not scroll horizontally, and nothing escapes it',
        pnl.panelScrollW <= pnl.panelClientW + 1 && pnl.over.length === 0 && pnl.bodyScroll <= w + 1,
        JSON.stringify({ s: pnl.panelScrollW, c: pnl.panelClientW, over: pnl.over }));
      check('★ ' + w + 'px: THE FULL ADDRESS is on screen, wrapped rather than clipped',
        pnl.addressVis && pnl.addressText.length >= 26, pnl.addressText);
      check('★ ' + w + 'px: the honest "we do not watch the chain" note survives', pnl.noteVis === true);
      check(w + 'px: every panel action meets the 44px tap floor',
        pnl.buttons.length >= 1 && pnl.buttons.every((h) => h >= 44), JSON.stringify(pnl.buttons));
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
      f.src = '/admin-deposit-addresses.html';
      document.body.appendChild(f);
      for (let i = 0; i < 300; i++) {
        try { const dd = f.contentDocument; if (dd && dd.querySelectorAll('.da-ar').length > 0) break; } catch (e) {}
        await nap(200);
      }
      await nap(1200);
      const dd = f.contentDocument, w = f.contentWindow;
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = w.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const rects = [...dd.querySelectorAll('body *')].map(e => e.getBoundingClientRect());
      const row = dd.querySelector('.da-ar:not(.is-retired)');
      return {
        inner: w.innerWidth,
        bodyScroll: dd.body.scrollWidth,
        maxRight: Math.max(0, ...rects.map(r => r.right)),
        rows: dd.querySelectorAll('.da-ar').length,
        groups: dd.querySelectorAll('.da-gh').length,
        blockedVis: vis(dd.querySelector('.da-blocked')),
        pills: [...dd.querySelectorAll('.da-pill')].map(p => vis(p)),
        addrVis: row ? vis(row.querySelector('.da-addr')) : false,
        recvVis: row ? vis(row.querySelector('.da-recv')) : false,
        statusVis: row ? vis(row.querySelector('.da-stp')) : false
      };
    })()`);
    check('320px (real iframe): the viewport is genuinely 320 (integrity guard)', iframe.inner === 320, String(iframe.inner));
    check('★ 320px: nothing scrolls horizontally', iframe.bodyScroll <= 321 && iframe.maxRight <= 321,
      JSON.stringify({ b: iframe.bodyScroll, m: iframe.maxRight }));
    check('GUARD: 320px rendered real rows', iframe.rows >= 2, iframe.rows + ' rows');
    check('★ 320px: the address, its received figure and its status all survive',
      iframe.addrVis && iframe.recvVis && iframe.statusVis, JSON.stringify(iframe));
    check('★ 320px: the blocked banner and every filter pill survive',
      iframe.blockedVis && iframe.pills.length === 4 && iframe.pills.every(Boolean),
      JSON.stringify({ b: iframe.blockedVis, p: iframe.pills }));
    check('320px: every route still has its own group header', iframe.groups >= 5, String(iframe.groups));

  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (e) {} try { cdp.chrome.kill(); } catch (e) {} }
    if (profile) await releaseTempDir(profile);
    if (server) { try { server.kill(); } catch (e) {} }
    await admin.from('deposit_addresses').delete().eq('id', retiredRow.id);
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('ADDRESS BOOK VISUAL: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 1200000 });
