// verify-help-center-visual.mjs — the Help Center's four pages, measured (2026-09-23, Phase 1).
//
// Contrast is measured with the SHEEN COMPOSITED: the landing's cards are the shared .glass
// primitive, and .glass::before is a positioned radial highlight over a card's top-left corner
// that paints over in-flow text (row 204). Every card carries .glass-lift for that reason, and
// these measurements are what prove it worked rather than a comment claiming it did.
//
// Mobile is a REAL phone profile — mobile: true, DPR 3, touch enabled, proven by matchMedia
// rather than inferred from width (row 229). 320px goes through a real same-origin iframe
// because the top-level metrics override floors at ~348px on this build (row 228).
import { spawn, spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, releaseTempDir, forwardChildTeardown, reportSilentChild } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0; const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail === undefined ? '' : ' — ' + detail)); }
}
function section(t) { console.log('\n' + t); }

// ★ THE PAGE IS CLIENT-RENDERED FROM THE DATABASE, so verify-contrast's fixed settle can fire
// before a single card exists — and a run that measures nothing reports "0 measurements", which
// the non-vacuity guard below correctly refuses. That happened on the first run of this suite
// (cold) while a standalone run passed (warm). CONTRAST_PREPARE_JS runs after the settle, so it
// carries its own READY preamble (row 188) rather than assuming the page has arrived.
const READY = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 400; i++) { if (document.querySelector('.hc-cat') || document.querySelector('.ha-p')) break; await nap(150); }
  await nap(700); })()`;

function runContrast(profile, label, url) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: HERE, encoding: 'utf8', timeout: 900000,
    env: { ...process.env, CONTRAST_PROFILE: profile, CONTRAST_URL: url, CONTRAST_WIDTHS: '1440',
           CONTRAST_PREPARE_JS: READY },
  });
  forwardChildTeardown(res, 'verify-contrast(' + profile + ')');
  if (typeof reportSilentChild === 'function') reportSilentChild(res, 'verify-contrast(' + profile + ')', /CONTRAST: (PASS|FAIL)/);
  const out = (res.stdout || '') + (res.stderr || '');
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ').slice(0, 400);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  return m ? Number(m[1]) : 0;
}

async function connect(profile) {
  const PORT = 9100 + Math.floor(Math.random() * 180);
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--disable-gpu', 'about:blank',
  ], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const p = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) wsUrl = p.webSocketDebuggerUrl; else await sleep(250);
    } catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('could not reach headless Chrome on ' + PORT);
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + String(expr).slice(0, 110));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const go = async (url, waitFor, seconds = 30) => {
    await send('Page.navigate', { url: BASE + url });
    return evaluate(`(async()=>{const nap=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<${seconds * 7};i++){ if(document.querySelector(${JSON.stringify(waitFor)})) return true; await nap(150);} return false;})()`);
  };
  return { chrome, send, evaluate, go };
}

async function phone(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function desktop(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}

async function signInAsPm(cdp) {
  await cdp.go('/admin-login.html', '#admin-login-submit', 20);
  for (let i = 0; i < 6; i++) {
    let r;
    try {
      r = await cdp.evaluate(`(async()=>{const nap=ms=>new Promise(r=>setTimeout(r,ms));
        const e=document.getElementById('admin-email-input'), p=document.getElementById('admin-password-input'),
              b=document.getElementById('admin-login-submit');
        if(!e||!p||!b) return 'missing';
        e.value='pm@marketswave.local'; e.dispatchEvent(new Event('input',{bubbles:true}));
        p.value='MarketswavePM-Local-2026!'; p.dispatchEvent(new Event('input',{bubbles:true}));
        b.click();
        for(let i=0;i<40;i++){ if(!/admin-login/.test(location.pathname)) return 'ok'; await nap(250);} return 'stuck';})()`);
    } catch (e) { r = /navigated|closed/.test(e.message) ? 'ok' : e.message; }
    if (r === 'ok') { await sleep(700); return true; }
    await sleep(1200);
  }
  return false;
}

const ART = '/help.html?a=depositing-crypto';

async function main() {
  // =========================================================================================
  section('1. CONTRAST, with the sheen composited');
  // =========================================================================================
  const nLanding = runContrast('helpLanding', 'the landing', BASE + '/help.html');
  const nArticle = runContrast('helpArticle', 'the article', BASE + ART);
  console.log('    (' + nLanding + ' + ' + nArticle + ' real composited-pixel measurements)');

  const profile = await makeTempDir('mw-hcv-');
  const pmProfile = await makeTempDir('mw-hcv-pm-');
  let cdp = null, pmCdp = null;
  try {
    cdp = await connect(profile);

    // =========================================================================================
    section('2. MOBILE \u2014 a real phone profile, 390 / 375, then 320 through a real iframe');
    // =========================================================================================
    for (const w of [390, 375]) {
      await phone(cdp, w);
      // The viewport-integrity guard: a probe that silently ran at another width would pass
      // while measuring nothing relevant (row 228's own lesson from Batch 1).
      await cdp.go('/help.html', '.hc-cats');
      const m = await cdp.evaluate(`({
        inner: window.innerWidth,
        coarse: matchMedia('(pointer: coarse)').matches,
        noHover: matchMedia('(hover: none)').matches,
        dpr: devicePixelRatio,
        touch: navigator.maxTouchPoints,
        scrollW: document.body.scrollWidth,
        cols: getComputedStyle(document.querySelector('.hc-cats')).gridTemplateColumns.split(' ').length,
        searchVisible: !!document.getElementById('hc-q') && document.getElementById('hc-q').getBoundingClientRect().width > 100,
        contactRows: document.querySelectorAll('.hc-contact .hc-ch').length
      })`);
      check(w + 'px: the viewport is genuinely ' + w + ' on a REAL phone profile (integrity guard)',
        m.inner === w && m.coarse === true && m.noHover === true && m.dpr === 3 && m.touch > 0, JSON.stringify(m));
      check(w + 'px landing: nothing scrolls horizontally', m.scrollW <= w + 1, String(m.scrollW));
      check(w + 'px landing: the topic grid has collapsed to one column', m.cols === 1, String(m.cols));
      check(w + 'px landing: the search box is still usable', m.searchVisible, String(m.searchVisible));
      check(w + 'px landing: all three contact routes survive', m.contactRows === 3, String(m.contactRows));

      await cdp.go(ART, '.hc-art h1');
      const a = await cdp.evaluate(`({
        scrollW: document.body.scrollWidth,
        sidebar: getComputedStyle(document.querySelector('.hc-side')).display,
        h1: !!document.querySelector('.hc-art h1'),
        steps: document.querySelectorAll('.ha-st').length,
        stuck: document.querySelectorAll('.hc-ask-actions .btn').length,
        widest: Math.max(0, ...[...document.querySelectorAll('.hc-art *')].map(e=>e.getBoundingClientRect().right))
      })`);
      check(w + 'px article: nothing scrolls horizontally', a.scrollW <= w + 1, String(a.scrollW));
      check(w + 'px article: the topic sidebar is hidden, the article is not',
        a.sidebar === 'none' && a.h1 === true, JSON.stringify({ side: a.sidebar, h1: a.h1 }));
      check(w + 'px article: the steps and the "Still stuck?" actions survive',
        a.steps === 4 && a.stuck === 2, JSON.stringify({ steps: a.steps, stuck: a.stuck }));
      check(w + 'px article: nothing inside the article escapes the viewport', a.widest <= w + 1, String(Math.round(a.widest)));
    }

    // 320 through a real same-origin iframe.
    await desktop(cdp, 1440);
    for (const url of ['/help.html', ART]) {
      await cdp.go(url, url === '/help.html' ? '.hc-cats' : '.hc-art h1');
      const f = await cdp.evaluate(`(async()=>{
        const nap=ms=>new Promise(r=>setTimeout(r,ms));
        document.querySelectorAll('#mw320').forEach(n=>n.remove());
        const fr=document.createElement('iframe'); fr.id='mw320';
        fr.style.cssText='position:fixed;left:0;top:0;width:320px;height:760px;border:0;z-index:99999';
        fr.src=${JSON.stringify(url)};
        document.body.appendChild(fr);
        for(let i=0;i<300;i++){ try{ const d=fr.contentDocument;
          if(d && (d.querySelector('.hc-cat') || d.querySelector('.hc-art h1'))) break; }catch(e){} await nap(200); }
        await nap(1200);
        const d=fr.contentDocument, w=fr.contentWindow;
        const rects=[...d.querySelectorAll('body *')].filter(e=>!e.closest('[aria-hidden="true"]') && !e.classList.contains('blob'))
          .map(e=>e.getBoundingClientRect());
        return { inner: w.innerWidth, scrollW: d.body.scrollWidth, maxRight: Math.max(0,...rects.map(r=>r.right)),
                 rendered: !!(d.querySelector('.hc-cat')||d.querySelector('.hc-art h1')) };
      })()`);
      const name = url === '/help.html' ? 'landing' : 'article';
      check('320px ' + name + ': the iframe viewport is genuinely 320 (integrity guard)', f.inner === 320, String(f.inner));
      check('320px ' + name + ': the page genuinely rendered (not an empty measurement)', f.rendered === true, String(f.rendered));
      check('320px ' + name + ': nothing scrolls horizontally', f.scrollW <= 321 && f.maxRight <= 321,
        JSON.stringify({ scrollW: f.scrollW, maxRight: Math.round(f.maxRight) }));
    }

    // =========================================================================================
    section('3. THE PM PAGES ON A PHONE');
    // =========================================================================================
    pmCdp = await connect(pmProfile);
    check('GUARD: signed in as the local bootstrap PM', await signInAsPm(pmCdp));
    for (const w of [390, 375]) {
      await phone(pmCdp, w);
      await pmCdp.go('/admin-help.html', '.hl-tr, .hl-empty');
      const l = await pmCdp.evaluate(`({
        inner: window.innerWidth,
        scrollW: document.body.scrollWidth,
        health: document.querySelectorAll('.hl-hc').length,
        rows: document.querySelectorAll('.hl-tr').length,
        // ★ The table restacks into cards rather than hiding columns (row 172): on a phone the
        // Views and Tickets figures are the reason a manager opened this page at all.
        labelled: [...document.querySelectorAll('.hl-tr [data-label]')].length,
        headHidden: getComputedStyle(document.querySelector('.hl-th')).display === 'none'
      })`);
      check(w + 'px list: the viewport is genuinely ' + w + ' (integrity guard)', l.inner === w, String(l.inner));
      check(w + 'px list: nothing scrolls horizontally', l.scrollW <= w + 1, String(l.scrollW));
      check(w + 'px list: the head is hidden and every cell carries its own label instead',
        l.headHidden === true && l.labelled >= 6, JSON.stringify({ head: l.headHidden, labelled: l.labelled }));
      check(w + 'px list: the health strip survives', l.health === 4, String(l.health));

      await pmCdp.go('/admin-help-article.html', '#hl-title');
      await pmCdp.evaluate(`(async()=>{const nap=ms=>new Promise(r=>setTimeout(r,ms));
        for(let i=0;i<200;i++){const c=document.getElementById('hl-check-count'); if(c&&c.textContent.trim())return true; await nap(150);} return false;})()`);
      const e = await pmCdp.evaluate(`({
        scrollW: document.body.scrollWidth,
        sections: document.querySelectorAll('.hl-sech b').length,
        cols: getComputedStyle(document.querySelector('.hl-edgrid')).gridTemplateColumns.split(' ').length,
        checklist: document.querySelectorAll('#hl-checklist .hl-chk').length
      })`);
      check(w + 'px editor: nothing scrolls horizontally', e.scrollW <= w + 1, String(e.scrollW));
      check(w + 'px editor: the settings column has stacked under the form', e.cols === 1, String(e.cols));
      check(w + 'px editor: all seven sections and the full checklist survive',
        e.sections === 7 && e.checklist === 7, JSON.stringify({ sections: e.sections, checks: e.checklist }));
    }
  } finally {
    if (cdp) { try { cdp.chrome.kill(); } catch { /* gone */ } }
    if (pmCdp) { try { pmCdp.chrome.kill(); } catch { /* gone */ } }
    await releaseTempDir(profile);
    await releaseTempDir(pmProfile);
  }

  console.log('\n' + passed + ' passed, ' + fails.length + ' failed');
  if (fails.length) fails.forEach((f) => console.log('  - ' + f));
  console.log(fails.length === 0 ? 'HELP CENTER VISUAL: PASS' : 'HELP CENTER VISUAL: FAIL');
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 20 * 60 * 1000 });
