/**
 * verify-resources-redesign.mjs - structural + responsive checks for the Resources redesign.
 *
 * Contrast is measured separately by verify-contrast.mjs (real composited pixels); this one
 * covers everything else: that the copy is intact in the DOM, that the arrow is genuinely
 * gone rather than just hidden, that the grain is actually compositing, that the layout
 * collapses at the documented breakpoint, and that nothing overflows horizontally.
 *
 * Overflow is asserted on document.body, never on <main>: a section hosting .blob children
 * legitimately reports a larger scrollWidth of its own because those blobs sit at negative
 * offsets inside an overflow:hidden parent, and reading the inner element instead of the
 * body produces a false positive (already learned once, mobile fixes Batch 3).
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { makeTempDir, trackChild, releaseTempDir } from './lib/harness-teardown.mjs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VERIFY_PORT || 9334);
const PAGE_URL = process.env.VERIFY_URL || 'http://127.0.0.1:8765/resources.html';
const SHOT_DIR = process.env.VERIFY_SHOTS || null;

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
};

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method) this.events.push(m);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = makeTempDir('mw-resverify-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });
  trackChild(profile, chrome);

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const pg = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pg) wsUrl = pg.webSocketDebuggerUrl; else await sleep(250);
    } catch (e) { await sleep(250); }
  }
  if (!wsUrl) { await releaseTempDir(profile); throw new Error('no page target'); }

  const ws = new WebSocket(wsUrl);
  trackChild(profile, chrome, ws);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');

  for (const width of [1440, 390, 375, 320]) {
    console.log('\n=== viewport ' + width + 'px ===');
    cdp.events.length = 0;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(1800);

    const real = await cdp.eval('window.innerWidth');
    ok(real === width, 'viewport integrity', 'asked ' + width + ', got ' + real);
    if (real !== width) continue;

    const d = await cdp.eval(`(() => {
      const cs = (el) => el ? getComputedStyle(el) : null;
      const grain = document.querySelector('.page-grain');
      const gs = cs(grain);
      const item = document.querySelector('.res-item');
      const is = cs(item);
      return {
        items: document.querySelectorAll('.res-item').length,
        steps: document.querySelectorAll('.res-st').length,
        arrows: document.querySelectorAll('.res-arw, [class*="res-arw"]').length,
        grainPos: gs && gs.position,
        grainBlend: gs && gs.mixBlendMode,
        grainImg: !!(gs && gs.backgroundImage && gs.backgroundImage !== 'none'),
        grainZ: gs && gs.zIndex,
        cols: is && is.gridTemplateColumns,
        colCount: is ? is.gridTemplateColumns.split(/\\s+/).filter(Boolean).length : 0,
        bodyScrollW: document.body.scrollWidth,
        innerW: window.innerWidth,
        spineBefore: !!document.querySelector('.res-steps'),
        headings: [...document.querySelectorAll('.res-item h3')].map(h => h.textContent.trim()),
        stepHeads: [...document.querySelectorAll('.res-st h3')].map(h => h.textContent.trim()),
        bodyLens: [...document.querySelectorAll('.res-item p')].map(p => p.textContent.trim().length),
        stepLens: [...document.querySelectorAll('.res-st p')].map(p => p.textContent.trim().length),
        hues: [...document.querySelectorAll('.res-item')].map(e => (e.style.getPropertyValue('--hue') || '').trim()),
        hueTexts: [...document.querySelectorAll('.res-item')].map(e => (e.style.getPropertyValue('--hue-text') || '').trim()),
      };
    })()`);

    ok(d.items === 6, 'six strategy rows', String(d.items));
    ok(d.steps === 6, 'six workflow steps', String(d.steps));
    ok(d.arrows === 0, 'arrow removed from the DOM entirely', String(d.arrows) + ' found');
    ok(d.grainPos === 'fixed' && d.grainBlend === 'multiply' && d.grainImg,
       'page grain compositing', d.grainPos + ' / ' + d.grainBlend + ' / img=' + d.grainImg);
    ok(d.hues.every(Boolean) && d.hueTexts.every(Boolean), 'every row carries --hue and --hue-text');
    ok(d.bodyScrollW <= d.innerW, 'no horizontal overflow', d.bodyScrollW + ' <= ' + d.innerW);
    ok(d.headings.length === 6 && d.headings.every((h) => h.length > 3), 'strategy headings present');
    ok(d.bodyLens.every((n) => n > 250), 'full strategy copy retained', 'min ' + Math.min(...d.bodyLens) + ' chars');
    ok(d.stepLens.every((n) => n > 250), 'full step copy retained', 'min ' + Math.min(...d.stepLens) + ' chars');

    // The documented breakpoint: 3 grid tracks above 900px, 2 at or below.
    if (width > 900) ok(d.colCount === 3, 'desktop grid = 3 tracks (arrow track dropped)', d.cols);
    else ok(d.colCount === 2, 'narrow grid = 2 tracks', d.cols);

    // Excludes the automatic /favicon.ico request only. This project has never shipped a
    // favicon and no page declares one, so Chrome auto-requests it and 404s on EVERY page of
    // the site - pre-existing, site-wide, and nothing to do with this page. Every other
    // network error, console error and uncaught exception still fails the check.
    const isFavicon = (e) => {
      const en = e.params && e.params.entry;
      return !!en && (/\/favicon\.ico\b/.test(en.url || '') || /\/favicon\.ico\b/.test(en.text || ''));
    };
    const errs = cdp.events.filter((e) =>
      ((e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
       e.method === 'Runtime.exceptionThrown') && !isFavicon(e));
    ok(errs.length === 0, 'no console errors', errs.length ? JSON.stringify(errs.map(e=>(e.params&&e.params.entry&&(e.params.entry.url||e.params.entry.text))||'?')) : '0');

    if (SHOT_DIR) {
      await cdp.eval('document.querySelector(".res-list").scrollIntoView({block:"start",behavior:"instant"})');
      await sleep(400);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOT_DIR, 'resources-' + width + '.png'), Buffer.from(shot.data, 'base64'));
      console.log('  ....  screenshot -> resources-' + width + '.png');
    }
  }

  await releaseTempDir(profile);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'RESOURCES REDESIGN: FAIL' : 'RESOURCES REDESIGN: PASS');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
