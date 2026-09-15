// ★ PM tool revamp, part 4 — the client profile, in a real browser.
//
// What this suite exists to prove, beyond "it renders":
//   1. THE NAVIGATION IS ACTUALLY THERE. Row 228: the approval gate shipped reachable and
//      inescapable, and a 69-assertion visual suite passed straight over it because every
//      assertion was about the feature. The rail, its active item and a reachable Log out are
//      asserted here from the real rendered DOM — this is the half jsdom cannot do, because
//      admin-sidebar.js gates rendering on a real getSession().
//   2. CONTRAST with the .glass::before sheen COMPOSITED, on real pixels.
//   3. A REAL PHONE at 320/375/390 — mobile: true, DPR 3, touch — proven by matchMedia rather
//      than inferred from width (row 229). 320px goes through a real same-origin iframe,
//      because the top-level metrics override floors at ~348px on this build (row 170).
import { execSync, spawnSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
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

function runContrast(profile, label, bootstrap, prepare, url) {
  const out = runChild('verify-contrast.mjs', {
    CONTRAST_PROFILE: profile, CONTRAST_URL: url,
    CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare || '',
    CONTRAST_WIDTHS: '1440'
  }, 'verify-contrast(' + profile + ')');
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ');
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1 with the sheen composited', /CONTRAST: PASS/.test(out), tail);
  return out;
}

function runFonts(bootstrap, url) {
  const out = runChild('audit-fonts.mjs', { AUDIT_URL: url, AUDIT_BOOTSTRAP_JS: bootstrap }, 'audit-fonts');
  check('no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check('no monospace family anywhere — the scheme is Inter (row 192)',
    !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}

// --- CDP ------------------------------------------------------------------------------------
async function connect(profile) {
  // ★ Attach to a PAGE target, never the browser-level endpoint the stderr banner advertises:
  // Page.enable does not exist there, and the failure ("'Page.enable' wasn't found") reads like
  // a protocol problem rather than like the wrong target, which is how it cost time here.
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
  // maxTouchPoints must be 1-16 even when disabling; 0 is a protocol error.
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}

const WAIT = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) {
    const painted = document.querySelector('#cp-identity .cp-strip');
    const nav = document.querySelectorAll('.an-item').length === 10;
    if (painted && nav && document.readyState === 'complete') break;
    await nap(200);
  }
  await nap(700);
  return true;
})()`;

const READ = `(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
    const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const rects = [...document.querySelectorAll('body *')].map(e => e.getBoundingClientRect());
  return {
    inner: window.innerWidth,
    bodyScroll: document.body.scrollWidth,
    docScroll: document.documentElement.scrollWidth,
    maxRight: Math.max(0, ...rects.map(r => r.right)),
    dpr: window.devicePixelRatio,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    noHover: window.matchMedia('(hover: none)').matches,
    touchPoints: navigator.maxTouchPoints,
    stripCols: getComputedStyle(document.querySelector('.cp-strip')).gridTemplateColumns.split(' ').length,
    bodyCols: getComputedStyle(document.querySelector('.cp-body')).gridTemplateColumns.split(' ').length,
    name: (document.querySelector('.cp-idt h1') || {}).textContent,
    nameVis: vis(document.querySelector('.cp-idt h1')),
    metaVis: vis(document.querySelector('.cp-meta')),
    metaText: (document.querySelector('.cp-meta') || {}).textContent,
    strips: [...document.querySelectorAll('.cp-st')].map(s => ({
      k: s.querySelector('.cp-k').textContent, v: s.querySelector('.cp-v').textContent, vis: vis(s)
    })),
    holdings: [...document.querySelectorAll('[data-cp-holding]')].map(h => ({
      name: (h.querySelector('.cp-hn b') || {}).textContent,
      mark: !!h.querySelector('.mk'),
      gain: (h.querySelector('.cp-hv span') || {}).textContent, vis: vis(h)
    })),
    panels: document.querySelectorAll('.cp-card').length,
    absences: document.querySelectorAll('[data-cp-absent]').length,
    locked: !!document.querySelector('[data-cp-locked]')
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

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);
  const { data: gary } = await admin.from('clients').select('id, name').ilike('name', '%Gary%').maybeSingle();
  if (!gary) { console.log('Gary is not seeded — run `node seed-client-gary.mjs` first.'); process.exit(1); }
  const URL_ = BASE + '/admin-client-profile.html?client=' + gary.id;

  const anon = createClient(st.API_URL, st.ANON_KEY);
  const signed = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (signed.error) throw new Error('admin sign-in: ' + signed.error.message);
  const bootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' +
    JSON.stringify(JSON.stringify(signed.data.session)) + '); true';

  let server = null, profile = null, cdp = null;
  try {
    server = spawn('python', ['-m', 'http.server', '8765'], { cwd: ROOT, stdio: 'ignore' });
    await sleep(1500);

    console.log('\n--- Contrast: real composited pixels, sheen ON ---\n');
    const PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { if (document.querySelector('#cp-identity .cp-strip') && document.querySelectorAll('.cp-card').length >= 10) break; await nap(200); }
      await nap(900); })()`;
    runContrast('client-profile', 'the profile', bootstrap, PREP, URL_);

    console.log('\n--- Sheen audit ---\n');
    const sheen = runChild('audit-glass-sheen.mjs', { SHEEN_PAGES: 'admin-client-profile.html?client=' + gary.id, SHEEN_BOOTSTRAP_JS: bootstrap }, 'audit-glass-sheen');
    check('the sheen audit ran against this page and passed with the sheen composited',
      /SHEEN SWEEP: PASS/.test(sheen), sheen.slice(-400));

    console.log('\n--- Fonts ---\n');
    runFonts(bootstrap, URL_);

    console.log('\n--- Desktop 1440, then a REAL phone at 390 / 375, then a real 320px iframe ---\n');
    profile = makeTempDir('mw-cliprof-');
    cdp = await connect(profile);

    await desktop(cdp, 1440);
    await cdp.send('Page.navigate', { url: BASE + '/admin-client-profile.html' });
    await cdp.evaluate('(async()=>{ ' + bootstrap + ' })()').catch(() => {});
    await cdp.send('Page.navigate', { url: URL_ });
    await cdp.evaluate(WAIT);

    const nav = await cdp.evaluate(NAV);
    check('★ 1440px: THE PROFILE MOUNTS THE SHARED ADMIN NAV — ten items, a real rail with width',
      !nav.missing && nav.count === 10 && nav.asideW > 0, JSON.stringify(nav));
    check('★ 1440px: "Clients" is the active item — a client profile is a detail view of that list',
      !nav.missing && nav.on.join() === 'Clients', JSON.stringify(nav.on));
    check('★ 1440px: Log out is reachable from this page', nav.logout === true, String(nav.logout));
    check('1440px: the rail is the vocabulary\'s #0F172A', /15, 23, 42/.test(nav.railBg || ''), nav.railBg);

    const d = await cdp.evaluate(READ);
    check('1440px: the viewport is genuinely 1440 (integrity guard)', d.inner === 1440, String(d.inner));
    check('1440px: no horizontal overflow', d.bodyScroll <= 1440 && d.docScroll <= 1440 && d.maxRight <= 1441,
      JSON.stringify({ b: d.bodyScroll, m: d.maxRight }));
    check('GUARD: real content is on screen — otherwise every assertion below is vacuous',
      d.holdings.length > 0 && d.panels >= 10, d.holdings.length + ' holdings / ' + d.panels + ' panels');
    check('1440px: the money strip is five cells across', d.stripCols === 5, String(d.stripCols));
    check('1440px: the body is two columns', d.bodyCols === 2, String(d.bodyCols));
    check('1440px: every holding carries a real asset mark', d.holdings.every((h) => h.mark),
      d.holdings.filter((h) => !h.mark).map((h) => h.name).join(','));
    check('★ 1440px: both honest-absence notes are on screen (onboarding, advisory fee)',
      d.absences >= 2, String(d.absences));
    check('★ 1440px: the access-logging warning is on screen', d.locked === true, String(d.locked));

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
      check('★ ' + w + 'px: THE CLIENT NAME SURVIVES — read from the DOM, not assumed',
        m.nameVis && /Gary/.test(m.name || ''), m.name);
      check('★ ' + w + 'px: the identity facts survive — email and account type are still on screen',
        m.metaVis && /Individual Account/.test(m.metaText || ''), (m.metaText || '').slice(0, 90));
      check('★ ' + w + 'px: all five money figures survive, none hidden',
        m.strips.length === 5 && m.strips.every((s) => s.vis), JSON.stringify(m.strips.map((s) => s.k + ':' + s.vis)));
      check('★ ' + w + 'px: every holding still shows its name, mark and gain',
        m.holdings.length > 0 && m.holdings.every((h) => h.vis && h.mark && /[+−]\d/.test(h.gain || '')),
        JSON.stringify(m.holdings.map((h) => h.name + '|' + h.mark + '|' + h.gain)));
      check(w + 'px: the body is one column and the strip has collapsed', m.bodyCols === 1 && m.stripCols <= 2,
        'body ' + m.bodyCols + ' / strip ' + m.stripCols);
      check('★ ' + w + 'px: both absence notes and the access-log warning are still shown, not dropped',
        m.absences >= 2 && m.locked === true, m.absences + ' absences, locked=' + m.locked);
    }

    // 320px through a real same-origin iframe: the top-level override floors at ~348px here.
    await desktop(cdp, 1440);
    await cdp.send('Page.navigate', { url: BASE + '/admin-client-profile.html?client=' + gary.id });
    await cdp.evaluate(WAIT);
    const iframe = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelectorAll('#mw320').forEach(n => n.remove());
      const f = document.createElement('iframe');
      f.id = 'mw320'; f.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:760px;border:0;z-index:99999';
      f.src = ${JSON.stringify('/admin-client-profile.html?client=' + gary.id)};
      document.body.appendChild(f);
      for (let i = 0; i < 300; i++) {
        try { const dd = f.contentDocument; if (dd && dd.querySelector('#cp-identity .cp-strip')) break; } catch (e) {}
        await nap(200);
      }
      await nap(1200);
      const dd = f.contentDocument, w = f.contentWindow;
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = w.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const rects = [...dd.querySelectorAll('body *')].map(e => e.getBoundingClientRect());
      return {
        inner: w.innerWidth,
        bodyScroll: dd.body.scrollWidth,
        maxRight: Math.max(0, ...rects.map(r => r.right)),
        nameVis: vis(dd.querySelector('.cp-idt h1')),
        name: (dd.querySelector('.cp-idt h1') || {}).textContent,
        strips: [...dd.querySelectorAll('.cp-st')].map(s => vis(s)),
        holdings: [...dd.querySelectorAll('[data-cp-holding]')].length,
        absences: dd.querySelectorAll('[data-cp-absent]').length
      };
    })()`);
    check('320px (real iframe): the viewport is genuinely 320 (integrity guard)', iframe.inner === 320, String(iframe.inner));
    check('★ 320px: nothing scrolls horizontally', iframe.bodyScroll <= 321 && iframe.maxRight <= 321,
      JSON.stringify({ b: iframe.bodyScroll, m: iframe.maxRight }));
    check('★ 320px: the client name survives', iframe.nameVis && /Gary/.test(iframe.name || ''), iframe.name);
    check('★ 320px: all five money figures survive', iframe.strips.length === 5 && iframe.strips.every(Boolean),
      JSON.stringify(iframe.strips));
    check('★ 320px: holdings and the absence notes are still rendered',
      iframe.holdings > 0 && iframe.absences >= 2, iframe.holdings + ' holdings / ' + iframe.absences + ' absences');

  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (e) {} try { cdp.chrome.kill(); } catch (e) {} }
    if (profile) await releaseTempDir(profile);
    if (server) { try { server.kill(); } catch (e) {} }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('CLIENT PROFILE VISUAL: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 900000 });
