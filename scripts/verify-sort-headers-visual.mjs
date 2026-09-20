// ★ Sortable column headers — the shared .mw-sort vocabulary, in a real browser (register row 252).
//
// One markup shape (format-helpers.js's sortHeaderHTML) and one stylesheet section
// (control-patterns.css) now serve every sortable table in the PM tool: the client list, the
// approval gate's history, the products page and the documents page. This suite measures the
// three things that were wrong on the old headers, on all four pages, rather than trusting that
// a shared class means a shared result:
//   1. THE HIT AREA IS A REAL BOX — 28px tall on desktop and the 44px floor on a phone — read
//      from the rendered rect, never from the stylesheet. The old headers were the glyph box
//      (14.3px) and the row-171 sweep never saw them: they are rendered by an async data load
//      and that sweep reads the DOM ~900ms after readyState. This suite waits for the rows.
//   2. THE LABEL'S EDGE STAYS PUT. A start-aligned label's text begins at its column's left
//      edge and an end-aligned label's text ends at its column's right edge, active or not, and
//      activating a header does not change the label's width (the old ▾ was appended INTO the
//      label text). Measured with a Range over the text node, not the button box.
//   3. THE STATE IS VISIBLE AND SPOKEN: an always-present indicator (a 10px ::after) in a real
//      colour, the active one in the accent, rotated for ascending, and an accessible name
//      carrying "sorted ascending/descending" or "not sorted".
// Plus the nav (row 228), contrast with hover, and the phone profile at 390/375 with a real
// 320px iframe. The three pages whose head hides below their own restack breakpoint are
// asserted HIDDEN there (their rows restack; that is their documented design), and the client
// list — the one head that stays visible on a phone — is asserted at the 44px floor.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

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
  const res = spawnSync(process.execPath, [script], { cwd: HERE, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 900000 });
  forwardChildTeardown(res, label);
  return (res.stdout || '') + (res.stderr || '');
}

function runContrast(profile, label, bootstrap, prepare, url) {
  const out = runChild('verify-contrast.mjs', {
    CONTRAST_PROFILE: profile, CONTRAST_URL: url, CONTRAST_BOOTSTRAP_JS: bootstrap,
    CONTRAST_PREPARE_JS: prepare || '', CONTRAST_WIDTHS: '1440'
  }, 'verify-contrast(' + profile + ')');
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ');
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  return m ? Number(m[1]) : 0;
}

// --- CDP ------------------------------------------------------------------------------------
async function connect(profile) {
  const PORT = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250);
    } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
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

// The four tables. `pre` opens whatever tab the head sits behind; `ready` is the row selector
// the suite waits for, because the head is rendered by the same async load as the rows.
const PAGES = [
  { url: '/admin-clients.html', nav: 'Clients', head: '.cl-th', ready: '.cl-tr', headOnPhone: true, extraProfile: 'client-list' },
  { url: '/admin-approvals.html', nav: 'Approvals', head: '#ag-hhead', ready: '#ag-hrows .ag-hrow, #ag-hhead .mw-sort', headOnPhone: false,
    pre: `for (let i = 0; i < 150; i++) { if (document.querySelector('.ag-vt') && document.querySelectorAll('#ag-queue .ag-row, #ag-queue .ag-empty').length) break; await nap(200); }
          await nap(300); document.getElementById('ag-view-history').click();` },
  { url: '/admin-products.html', nav: 'Products', head: '.pr-th', ready: '.pr-tr', headOnPhone: false },
  { url: '/admin-documents.html', nav: 'Documents', head: '.doc-th', ready: '.doc-th .mw-sort', headOnPhone: false }
];

function waitFor(p) {
  return `(async () => {
    const nap = (ms) => new Promise(r => setTimeout(r, ms));
    ${p.pre || ''}
    for (let i = 0; i < 200; i++) {
      if (document.querySelector(${JSON.stringify(p.ready)}) && document.querySelector(${JSON.stringify(p.head + ' .mw-sort')}) && document.readyState === 'complete') break;
      await nap(200);
    }
    await nap(700);
    return !!document.querySelector(${JSON.stringify(p.head + ' .mw-sort')});
  })()`;
}
function prepFor(p) {
  return `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
    ${p.pre || ''}
    for (let i = 0; i < 200; i++) { if (document.querySelector(${JSON.stringify(p.ready)}) && document.querySelector(${JSON.stringify(p.head + ' .mw-sort')})) break; await nap(200); }
    await nap(900); })()`;
}

const NAV = `(() => {
  const aside = document.getElementById('admin-sidebar-aside');
  if (!aside) return { missing: true };
  const items = [...aside.querySelectorAll('.an-item')];
  return { missing: false, count: items.length, on: items.filter(i => i.classList.contains('is-on')).map(i => (i.querySelector('.an-lb') || {}).textContent),
    logout: !!document.getElementById('admin-logout-btn'), asideW: Math.round(aside.getBoundingClientRect().width) };
})()`;

// Every header button as a real rendered box, its text node's own edges, its indicator, its name.
// Decorative blobs are aria-hidden and clipped by <main>'s own overflow-x: hidden — they report a
// rect past the viewport while nothing scrolls (row 238); excluded, body.scrollWidth stays the answer.
function readHeads(head) {
  return `(() => {
    const head = document.querySelector(${JSON.stringify(head)});
    const hs = head ? getComputedStyle(head) : null;
    const btns = [...document.querySelectorAll(${JSON.stringify(head + ' .mw-sort')})];
    const rects = [...document.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
    return {
      inner: window.innerWidth, bodyScroll: document.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)),
      dpr: window.devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches, noHover: matchMedia('(hover: none)').matches,
      headDisplay: hs ? hs.display : null, headH: head ? Math.round(head.getBoundingClientRect().height * 10) / 10 : null,
      btns: btns.map(b => {
        const r = b.getBoundingClientRect(); const cell = b.parentElement.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(b); const tr = range.getBoundingClientRect();
        const after = getComputedStyle(b, '::after');
        return {
          label: b.textContent.trim(), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
          end: b.classList.contains('mw-sort-end'), dir: b.getAttribute('data-dir'), aria: b.getAttribute('aria-label'),
          textLeftVsCell: Math.round((tr.left - cell.left) * 10) / 10, textRightVsCell: Math.round((cell.right - tr.right) * 10) / 10,
          textW: Math.round(tr.width * 10) / 10,
          afterW: after.width, afterBg: after.backgroundColor, afterTransform: after.transform, color: getComputedStyle(b).color
        };
      })
    };
  })()`;
}

async function main() {
  const st = localStack();
  const anon = createClient(st.API_URL, st.ANON_KEY);
  const signed = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (signed.error) throw new Error('admin sign-in: ' + signed.error.message);
  const bootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(signed.data.session)) + '); true';

  let server = null, profile = null, cdp = null;
  try {
    // Harmless if the root already serves 8765 (the bind fails silently and that server is used).
    server = spawn('python', ['-m', 'http.server', '8765'], { cwd: ROOT, stdio: 'ignore' });
    await sleep(1500);

    console.log('\n--- Contrast: both states and hover, on all four pages ---\n');
    for (const p of PAGES) {
      const url = BASE + p.url;
      runContrast('sort-headers', p.url + ' sort headers', bootstrap, prepFor(p), url);
      if (p.extraProfile) runContrast(p.extraProfile, p.url + ' (' + p.extraProfile + ')', bootstrap, prepFor(p), url);
    }

    console.log('\n--- Desktop 1440: nav, hit area, alignment, state ---\n');
    profile = makeTempDir('mw-sorthead-');
    cdp = await connect(profile);
    await desktop(cdp, 1440);

    for (const p of PAGES) {
      const url = BASE + p.url;
      await cdp.send('Page.navigate', { url });
      await cdp.evaluate('(async()=>{ ' + bootstrap + ' })()').catch(() => {});
      await cdp.send('Page.navigate', { url });
      const ready = await cdp.evaluate(waitFor(p));
      check('GUARD ' + p.url + ': the head rendered real sort buttons (otherwise everything below is vacuous)', ready === true);

      const nav = await cdp.evaluate(NAV);
      check('★ ' + p.url + ': mounts the shared admin nav, "' + p.nav + '" active, Log out reachable (row 228)',
        !nav.missing && nav.count === 10 && nav.on.join() === p.nav && nav.logout && nav.asideW > 0, JSON.stringify(nav));

      const d = await cdp.evaluate(readHeads(p.head));
      check(p.url + ': viewport is genuinely 1440 and nothing overflows', d.inner === 1440 && d.bodyScroll <= 1440 && d.maxRight <= 1441,
        JSON.stringify({ b: d.bodyScroll, m: d.maxRight }));
      check('GUARD ' + p.url + ': at least three sortable headers measured', d.btns.length >= 3, d.btns.length + ' buttons');
      check('★ ' + p.url + ': every header is a REAL 28px hit box on desktop — not the 14.3px glyph box the old headers were',
        d.btns.every((b) => b.h >= 28 && b.w >= 28), JSON.stringify(d.btns.map((b) => b.label + ' ' + b.w + 'x' + b.h)));
      check(p.url + ': every header is the SAME height — one word or three', new Set(d.btns.map((b) => b.h)).size === 1,
        JSON.stringify(d.btns.map((b) => b.h)));
      check('★ ' + p.url + ': every header carries an always-present 10px indicator, none of it inside the label text',
        d.btns.every((b) => b.afterW === '10px' && !/[▴▾▲▼]/.test(b.label)), JSON.stringify(d.btns.map((b) => b.afterW + ' "' + b.label + '"')));
      const active = d.btns.filter((b) => b.dir);
      check('★ ' + p.url + ': exactly ONE header is active, in the accent, and its name says which way it sorts',
        active.length === 1 && /rgb\(180, 83, 9\)/.test(active[0].afterBg) && /rgb\(15, 23, 42\)/.test(active[0].color) &&
        new RegExp(', sorted ' + (active[0].dir === 'asc' ? 'ascending' : 'descending') + '$').test(active[0].aria || ''),
        JSON.stringify(active));
      check(p.url + ': an ascending header rotates its indicator; a descending one does not',
        active.every((b) => (b.dir === 'asc') === /matrix\(-1, 0, 0, -1/.test(b.afterTransform)), JSON.stringify(active.map((b) => b.dir + ' ' + b.afterTransform)));
      check(p.url + ': every inactive header\'s indicator is a real colour (#64748B), and its name says "not sorted"',
        d.btns.filter((b) => !b.dir).every((b) => /rgb\(100, 116, 139\)/.test(b.afterBg) && /, not sorted$/.test(b.aria || '')),
        JSON.stringify(d.btns.filter((b) => !b.dir).map((b) => b.afterBg + ' ' + b.aria)));
      // ★ ALIGNMENT, measured on the TEXT, not the button: the label's own edge sits on its
      // column's edge, so the head lines up with the cells beneath it whether the indicator leads
      // (an end-aligned figures column) or trails (a start-aligned one). Half a pixel of slack.
      check('★ ' + p.url + ': every start-aligned label BEGINS at its column\'s left edge (text measured, not the box)',
        d.btns.filter((b) => !b.end).every((b) => Math.abs(b.textLeftVsCell) <= 0.6),
        JSON.stringify(d.btns.filter((b) => !b.end).map((b) => b.label + ' ' + b.textLeftVsCell)));
      const endCols = d.btns.filter((b) => b.end);
      if (endCols.length) {
        check('★ ' + p.url + ': every end-aligned label ENDS at its column\'s right edge — flush with the figures beneath it',
          endCols.every((b) => Math.abs(b.textRightVsCell) <= 0.6), JSON.stringify(endCols.map((b) => b.label + ' ' + b.textRightVsCell)));
      }

      // ★ ACTIVATING A HEADER MUST NOT CHANGE THE LABEL'S WIDTH — the old ▾ was appended into
      // the label text, so "Portfolio" grew from 55px to 73px and its left edge jumped 18px.
      const target = d.btns.find((b) => !b.dir) || d.btns[0];
      const before = target.textW;
      const clicked = await cdp.evaluate(`(async () => {
        const nap = (ms) => new Promise(r => setTimeout(r, ms));
        const btn = [...document.querySelectorAll(${JSON.stringify(p.head + ' .mw-sort')})].find(b => b.textContent.trim() === ${JSON.stringify(target.label)});
        const cellBefore = btn.parentElement.getBoundingClientRect(); const h0 = document.querySelector(${JSON.stringify(p.head)}).getBoundingClientRect().height;
        btn.click(); await nap(600);
        const b2 = [...document.querySelectorAll(${JSON.stringify(p.head + ' .mw-sort')})].find(b => b.textContent.trim() === ${JSON.stringify(target.label)});
        const range = document.createRange(); range.selectNodeContents(b2); const tr = range.getBoundingClientRect();
        const cell = b2.parentElement.getBoundingClientRect();
        return { dir: b2.getAttribute('data-dir'), aria: b2.getAttribute('aria-label'), textW: Math.round(tr.width * 10) / 10,
          cellSame: Math.abs(cell.left - cellBefore.left) < 0.6 && Math.abs(cell.right - cellBefore.right) < 0.6,
          headH: document.querySelector(${JSON.stringify(p.head)}).getBoundingClientRect().height, h0,
          textLeftVsCell: Math.round((tr.left - cell.left) * 10) / 10, textRightVsCell: Math.round((cell.right - tr.right) * 10) / 10, end: b2.classList.contains('mw-sort-end') };
      })()`);
      check('★ ' + p.url + ': clicking "' + target.label + '" activates it — data-dir set, the name now says the direction',
        !!clicked.dir && new RegExp(', sorted ' + (clicked.dir === 'asc' ? 'ascending' : 'descending') + '$').test(clicked.aria || ''), JSON.stringify(clicked));
      check('★ ' + p.url + ': ...and the label\'s width is UNCHANGED by activation (' + before + 'px before, ' + clicked.textW + 'px after)',
        Math.abs(clicked.textW - before) <= 0.6, before + ' -> ' + clicked.textW);
      check(p.url + ': ...and its text edge stays on the column edge, and the head row keeps its height',
        (clicked.end ? Math.abs(clicked.textRightVsCell) <= 0.6 : Math.abs(clicked.textLeftVsCell) <= 0.6) && Math.abs(clicked.headH - clicked.h0) < 0.6 && clicked.cellSame,
        JSON.stringify(clicked));
    }

    console.log('\n--- A REAL phone at 390 / 375 ---\n');
    for (const w of [390, 375]) {
      await phone(cdp, w);
      for (const p of PAGES) {
        await cdp.send('Page.navigate', { url: BASE + p.url });
        await cdp.evaluate(waitFor(p));
        const m = await cdp.evaluate(readHeads(p.head));
        check('★ ' + w + 'px ' + p.url + ': a REAL PHONE PROFILE (DPR 3, coarse pointer, no hover), viewport genuinely ' + w,
          m.dpr === 3 && m.coarse && m.noHover && m.inner === w, JSON.stringify({ dpr: m.dpr, coarse: m.coarse, inner: m.inner }));
        check(w + 'px ' + p.url + ': nothing scrolls horizontally', m.bodyScroll <= w && m.maxRight <= w + 1, JSON.stringify({ b: m.bodyScroll, m: m.maxRight }));
        if (p.headOnPhone) {
          const vis = m.btns.filter((b) => b.w > 0);
          check('★ ' + w + 'px ' + p.url + ': the head stays visible and every visible header meets the 44px floor (row 171)',
            m.headDisplay !== 'none' && vis.length >= 2 && vis.every((b) => b.h >= 44 && b.w >= 44), JSON.stringify(vis.map((b) => b.label + ' ' + b.w + 'x' + b.h)));
          check(w + 'px ' + p.url + ': the head row grows only to the floor, not past it', m.headH <= 46, String(m.headH));
        } else {
          check(w + 'px ' + p.url + ': the head is hidden here by design — the rows restack (documented on each page)', m.headDisplay === 'none', m.headDisplay);
        }
      }
    }

    console.log('\n--- 320px through a real same-origin iframe (the client list, the one head visible on a phone) ---\n');
    await desktop(cdp, 1440);
    await cdp.send('Page.navigate', { url: BASE + '/admin-clients.html' });
    await cdp.evaluate(waitFor(PAGES[0]));
    const iframe = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelectorAll('#mw320').forEach(n => n.remove());
      const f = document.createElement('iframe');
      f.id = 'mw320'; f.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:760px;border:0;z-index:99999';
      f.src = '/admin-clients.html';
      document.body.appendChild(f);
      for (let i = 0; i < 300; i++) { try { const dd = f.contentDocument; if (dd && dd.querySelector('.cl-tr') && dd.querySelector('.cl-th .mw-sort')) break; } catch (e) {} await nap(200); }
      await nap(1200);
      const dd = f.contentDocument, w = f.contentWindow;
      const rects = [...dd.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
      const btns = [...dd.querySelectorAll('.cl-th .mw-sort')].map(b => { const r = b.getBoundingClientRect(); return { label: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(b => b.w > 0);
      return { inner: w.innerWidth, bodyScroll: dd.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)), btns };
    })()`);
    check('320px (real iframe): the viewport is genuinely 320 (integrity guard)', iframe.inner === 320, String(iframe.inner));
    check('★ 320px: nothing scrolls horizontally', iframe.bodyScroll <= 321 && iframe.maxRight <= 321, JSON.stringify({ b: iframe.bodyScroll, m: iframe.maxRight }));
    check('★ 320px: the visible headers meet the 44px floor', iframe.btns.length >= 2 && iframe.btns.every((b) => b.h >= 44 && b.w >= 44), JSON.stringify(iframe.btns));
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (e) {} try { cdp.chrome.kill(); } catch (e) {} }
    if (profile) await releaseTempDir(profile);
    if (server) { try { server.kill(); } catch (e) {} }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('SORT HEADERS VISUAL: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 1200000 });
