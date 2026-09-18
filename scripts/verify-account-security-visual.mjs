// ★ PM tool revamp, part 8 — Account security, in a real browser (register row 238).
//
// What this suite exists to prove, beyond "it renders":
//   1. THE NAVIGATION IS ACTUALLY THERE. Row 228: the approval gate shipped reachable and
//      inescapable, and a 69-assertion visual suite passed straight over it. The rail, its
//      active item and a reachable Log out are read off the real rendered DOM — the half jsdom
//      cannot do, since admin-sidebar.js gates rendering on a real getSession().
//   2. Contrast with the .glass::before sheen composited, across three profiles: the page, the
//      strength meter's LABEL (whose colour changes per level and whose old palette used the
//      BAR's saturated fill as text — #F59E0B and #10B981 both fail as text), and the error
//      card, which is the one surface that only exists when a read has failed.
//   3. A REAL PHONE at 320/375/390 — mobile: true, DPR 3, touch — proven by matchMedia rather
//      than inferred from width (row 229). 320px goes through a real same-origin iframe,
//      because the top-level metrics override floors at ~348px on this build (row 170).
//   4. ★ NARROW WIDTHS RESTACK RATHER THAN HIDE (row 229 again). A session row a PM cannot
//      identify is one they cannot decide about, so the device, the location and the
//      last-active line must all still be VISIBLE at 375px — asserted as real rendered boxes,
//      never as "the layout collapsed".
import { execSync, spawnSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const URL_ = BASE + '/admin-security.html';
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
  const out = runChild('audit-fonts.mjs', { AUDIT_URL: URL_, AUDIT_BOOTSTRAP_JS: bootstrap }, 'audit-fonts');
  check('no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check('no monospace family anywhere — the scheme is Inter (row 192)',
    !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}

// audit-glass-sheen.mjs already lists admin-security.html among its ADMIN_PAGES and signs
// itself in as the local bootstrap PM, so it needs the page name and nothing else.
function runSheen() {
  const out = runChild('audit-glass-sheen.mjs', {
    SHEEN_PAGES: 'admin-security.html', SHEEN_BASE: BASE
  }, 'audit-glass-sheen');
  const m = out.match(/(\d+) measured/);
  check('sheen audit measured real text under a .glass sheen', !!m && Number(m[1]) > 0,
    out.split('\n').slice(-6).join(' | '));
  check('no text under the sheen falls below 4.5:1',
    !/FAIL|UNMEASURED/.test(out), out.split('\n').filter((l) => /FAIL|UNMEASURED/.test(l)).join(' | '));
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
    if (document.querySelectorAll('.sec-row[data-sec-session]').length > 0 &&
        document.readyState === 'complete') break;
    await nap(200);
  }
  await nap(700);
  return true;
})()`;

const READ = `(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
    const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // ★ The atmospheric blob is deliberately hung past the right edge and is deliberately
  // clipped by <main>'s own overflow-x:hidden — it reports a rect at 1500 on a 1440 viewport
  // while nothing actually scrolls. It is aria-hidden, which is exactly the signal that it is
  // decoration rather than content, so decorative subtrees are excluded here and
  // document.body.scrollWidth remains the real "does anything scroll" answer (row 211).
  const els = [...document.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]'));
  const rects = els.map(e => e.getBoundingClientRect());
  // ★ Name the widest offender rather than reporting a bare number: "maxRight 381" sends you
  // reasoning about CSS, "SPAN.sec-ua @381" sends you to the element.
  let worst = null, worstRight = -1;
  els.forEach((e, i) => { if (rects[i].width > 0 && rects[i].right > worstRight) { worstRight = rects[i].right; worst = e; } });
  const row = document.querySelector('.sec-row[data-sec-session]');
  return {
    worst: worst ? (worst.tagName + '.' + String(worst.className).slice(0, 40) + '#' + worst.id + ' @' + Math.round(worstRight)) : null,
    inner: window.innerWidth,
    bodyScroll: document.body.scrollWidth,
    maxRight: Math.max(0, ...rects.map(r => r.right)),
    dpr: window.devicePixelRatio,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    noHover: window.matchMedia('(hover: none)').matches,
    touchPoints: navigator.maxTouchPoints,
    sessions: document.querySelectorAll('.sec-row[data-sec-session]').length,
    // Row 240: the activity panel was removed outright. Absence is asserted, not just a zero count.
    activityPresent: !!(document.getElementById('sec-activity') || document.getElementById('sec-activity-h') || document.getElementById('sec-activity-gap')),
    cards: document.querySelectorAll('.sec-card').length,
    logRowDisplay: (() => { const r = document.querySelector('#log-list tbody tr'); return r ? getComputedStyle(r).display : null; })(),
    logCells: document.querySelectorAll('#log-list tbody tr:first-child td').length,
    glassCount: document.querySelectorAll('.glass, .glass-subtle, .glass-dark, .glass-slate, .glass-on-dark').length,
    // Row 229: narrow widths RESTACK, they do not HIDE.
    titleVis: row ? vis(row.querySelector('.sec-title')) : false,
    metaVis: row ? vis(row.querySelector('.sec-meta')) : false,
    uaVis: row ? vis(row.querySelector('.sec-ua')) : false,
    kvVis: vis(document.querySelector('.sec-kv dd')),
    consequenceVis: vis(document.getElementById('sec-password-consequence')),
    scopeVis: vis(document.getElementById('sec-sessions-note')),
    twofaControls: document.querySelectorAll('#sec-2fa-h ~ * button, #sec-2fa-h ~ * input, #sec-2fa-h ~ * [role="switch"]').length
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

  const anon = createClient(st.API_URL, st.ANON_KEY);
  const signed = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (signed.error) throw new Error('admin sign-in: ' + signed.error.message);

  // ★ A SECOND, non-current session so the "Script" pill genuinely has a row to sit on. The
  // page shows that pill only on a row that is NOT the current device, so one session would
  // render the "This device" pill alone and the script-pill assertion would measure nothing.
  const second = createClient(st.API_URL, st.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const secondSignIn = await second.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (secondSignIn.error) throw new Error('second session sign-in: ' + secondSignIn.error.message);

  // The client security-actions log is genuinely local (no Supabase table exists for it —
  // confirmed by grep in the Admin UI Wiring Final Stage and again for part 8), so a log row
  // has to be seeded into the browser's own storage for the table to be measurable at all.
  const LOG_ROW = JSON.stringify([{
    id: 'SEC-9001', clientId: 'CLIENT-0001', clientName: 'Visual Check Client',
    type: 'PASSWORD_RESET', reason: 'Client called in; identity confirmed.',
    performedAt: '2026-09-17', performedBy: 'pm@marketswave.local'
  }, {
    id: 'SEC-9002', clientId: null, clientName: null,
    type: 'PM_PASSWORD_CHANGE', reason: 'Self-service password change.',
    performedAt: '2026-09-17', performedBy: 'pm@marketswave.local'
  }]);

  const bootstrap =
    'localStorage.setItem("sb-marketswave-admin-auth-token", ' +
    JSON.stringify(JSON.stringify(signed.data.session)) + '); ' +
    'localStorage.setItem("marketswave_security_actions_log", ' + JSON.stringify(LOG_ROW) + '); true';

  // ★ EVERY PREPARE HOOK MUST WAIT FOR THE PAGE ITSELF FIRST. verify-contrast runs
  // CONTRAST_PREPARE_JS after a FIXED CONTRAST_SETTLE_MS (1800ms by default), and an
  // authenticated admin page is still navigating at that point — `document.body` was
  // genuinely null when the first drafts of the two hooks below ran, so a
  // `getElementById(...).value = ...` threw and the whole profile reported a confident
  // "0 measurements". The main profile only escaped it because its own hook polls.
  const READY = `const nap = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 300; i++) {
      if (document.body && document.querySelectorAll('.sec-row[data-sec-session]').length > 0) break;
      await nap(200);
    }
    await nap(600);`;

  const SETTLE = '(async () => { ' + READY + ' return true; })()';

  // The strength label's colour is per level; "weak" is the red end, which is the one a
  // careless palette gets wrong (the bar's own saturated fill fails as text).
  const PREP_STRENGTH = '(async () => { ' + READY + ` 
    const el = document.getElementById('new-password');
    el.value = 'aaaaaaaa';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await nap(300);
    return true;
  })()`;

  // ★ The error card only exists when a read has genuinely failed, so it is provoked here
  // rather than styled into existence: the page's own real error path paints it.
  const PREP_ERROR = '(async () => { ' + READY + ` 
    window.MarketswaveData.callFunction = function () { return Promise.reject(new Error('simulated read failure')); };
    await window.__secReload();
    await nap(600);
    return true;
  })()`;

  const profile = await makeTempDir('mw-accsec-');
  let cdp = null;
  try {
    console.log('\n--- Contrast, fonts and the sheen ---\n');
    const nMain = runContrast('account-security', 'the page', bootstrap, SETTLE);
    const nStrength = runContrast('account-security-strength', 'the strength label (weak)', bootstrap, PREP_STRENGTH);
    const nError = runContrast('account-security-error', '★ the error card', bootstrap, PREP_ERROR);
    console.log('  (' + (nMain + nStrength + nError) + ' composited-pixel measurements across three profiles)');
    runFonts(bootstrap);
    runSheen();

    console.log('\n--- Desktop 1440, then a REAL phone at 390 / 375, then a real 320px iframe ---\n');
    cdp = await connect(profile);
    // No localStorage.clear() here: the profile is a fresh temp dir, and about:blank is an
    // opaque origin where touching localStorage throws outright.
    await desktop(cdp, 1440);
    await cdp.send('Page.navigate', { url: BASE + '/admin-login.html' });
    await sleep(1200);
    await cdp.evaluate(bootstrap);
    await cdp.send('Page.navigate', { url: URL_ });
    await cdp.evaluate(WAIT);

    // ---- the chrome (row 228) ---------------------------------------------------------------
    const nav = await cdp.evaluate(NAV);
    check('★ the shared admin nav rail is genuinely rendered', nav.missing === false, JSON.stringify(nav));
    check('★ ...with "Security" as its active item',
      !nav.missing && nav.on.length === 1 && /security/i.test(nav.on[0] || ''), JSON.stringify(nav.on));
    check('★ ...and a reachable Log out', !nav.missing && nav.logout === true);
    check('the rail is the PM tool\'s own colour, not a client-tool navy',
      !nav.missing && nav.railBg === 'rgb(15, 23, 42)', nav.railBg);

    const d = await cdp.evaluate(READ);
    check('GUARD: 1440px is genuinely 1440', d.inner === 1440, String(d.inner));
    check('real session rows render', d.sessions >= 2, String(d.sessions));
    check('★ the activity panel is absent from the rendered page (register row 239)', d.activityPresent === false);
    check('all six cards render (Task B added the identity-document access log)', d.cards === 6, String(d.cards));
    check('the page genuinely uses .glass (so the sheen audit above was not vacuous)',
      d.glassCount >= 4, String(d.glassCount));
    check('★ the 2FA panel carries NO interactive control in the rendered page',
      d.twofaControls === 0, String(d.twofaControls));
    check('1440px: nothing escapes the viewport', d.bodyScroll <= 1441 && d.maxRight <= 1441,
      JSON.stringify({ b: d.bodyScroll, m: d.maxRight, worst: d.worst }));
    check('GUARD: the client security log rendered real rows to measure',
      d.logCells >= 5, JSON.stringify({ cells: d.logCells }));
    check('1440px: the log is still a real table', d.logRowDisplay === 'table-row', String(d.logRowDisplay));

    for (const w of [390, 375]) {
      await phone(cdp, w);
      await cdp.send('Page.navigate', { url: URL_ });
      await cdp.evaluate(WAIT);
      const p = await cdp.evaluate(READ);
      check(w + 'px: the viewport is genuinely ' + w + ' (integrity guard)', p.inner === w, String(p.inner));
      check(w + 'px: a REAL phone profile — coarse pointer, no hover, DPR 3, touch points',
        p.coarse && p.noHover && p.dpr === 3 && p.touchPoints >= 5, JSON.stringify(p));
      check(w + 'px: nothing scrolls horizontally', p.bodyScroll <= w + 1 && p.maxRight <= w + 1,
        JSON.stringify({ b: p.bodyScroll, m: p.maxRight, worst: p.worst }));
      check(w + 'px: GUARD — real session rows rendered', p.sessions >= 2, String(p.sessions));
      // ★ Row 229: the row RESTACKS. Every part a PM decides on must still be visible.
      check(w + 'px: ★ the device, the location and the last-active line all SURVIVE',
        p.titleVis && p.metaVis && p.uaVis, JSON.stringify({ t: p.titleVis, m: p.metaVis, u: p.uaVis }));
      check(w + 'px: the identity rows survive', p.kvVis === true);
      check(w + 'px: the password consequence and the sessions scope note both survive',
        p.consequenceVis && p.scopeVis, JSON.stringify({ c: p.consequenceVis, s: p.scopeVis }));
      check(w + 'px: ★ the five-column log becomes self-labelling CARDS, not an off-screen scroller',
        p.logRowDisplay === 'block' && p.logCells >= 5,
        JSON.stringify({ display: p.logRowDisplay, cells: p.logCells }));
    }

    // 320px through a real same-origin iframe: the top-level override floors at ~348px here.
    await phone(cdp, 390);
    // ★ The HOST for the iframe is the origin root, never admin-login.html: with a session
    // already seeded that page redirects, and the redirect tears the inspected target out from
    // under the evaluate ("Inspected target navigated or closed").
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(1200);
    const iframe = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 60 && !document.body; i++) await nap(100);
      const f = document.createElement('iframe');
      f.style.cssText = 'width:320px;height:900px;border:0';
      f.src = ${JSON.stringify(URL_)};
      document.body.appendChild(f);
      await new Promise(r => f.addEventListener('load', r, { once: true }));
      const w = f.contentWindow, doc = w.document;
      for (let i = 0; i < 300; i++) {
        if (doc.querySelectorAll('.sec-row[data-sec-session]').length > 0) break;
        await nap(200);
      }
      await nap(700);
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
        const s = w.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const els = [...doc.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]'));
      const rects = els.map(e => e.getBoundingClientRect());
      let worst = null, worstRight = -1;
      els.forEach((e, i) => { if (rects[i].width > 0 && rects[i].right > worstRight) { worstRight = rects[i].right; worst = e; } });
      const row = doc.querySelector('.sec-row[data-sec-session]');
      return {
        inner: w.innerWidth,
        bodyScroll: doc.body.scrollWidth,
        maxRight: Math.max(0, ...rects.map(r => r.right)),
        worst: worst ? (worst.tagName + '.' + String(worst.className).slice(0, 40) + ' @' + Math.round(worstRight)) : null,
        sessions: doc.querySelectorAll('.sec-row[data-sec-session]').length,
        titleVis: row ? vis(row.querySelector('.sec-title')) : false,
        metaVis: row ? vis(row.querySelector('.sec-meta')) : false,
        uaVis: row ? vis(row.querySelector('.sec-ua')) : false,
        scopeVis: vis(doc.getElementById('sec-sessions-note'))
      };
    })()`);
    check('320px (real iframe): the viewport is genuinely 320 (integrity guard)', iframe.inner === 320, String(iframe.inner));
    check('320px: GUARD — real session rows rendered', iframe.sessions >= 2, String(iframe.sessions));
    check('★ 320px: nothing scrolls horizontally', iframe.bodyScroll <= 321 && iframe.maxRight <= 321,
      JSON.stringify({ b: iframe.bodyScroll, m: iframe.maxRight, worst: iframe.worst }));
    check('320px: the device, location and last-active line all still survive',
      iframe.titleVis && iframe.metaVis && iframe.uaVis, JSON.stringify(iframe));
    check('320px: the sessions scope note (what this list covers) survives', iframe.scopeVis === true);

  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (_e) { /* closing anyway */ } try { cdp.chrome.kill(); } catch (_e) { /* already gone */ } }
    await releaseTempDir(profile);
    try { await second.auth.signOut({ scope: 'local' }); } catch (_e) { /* best effort */ }
    void admin;
  }

  console.log('\n' + passed + '/' + (passed + fails.length) + ' assertions passed.\n');
  console.log('ACCOUNT SECURITY VISUAL: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
  process.exit(0);
}

runVerifyMain(main, { watchdogMs: 1200000 });
