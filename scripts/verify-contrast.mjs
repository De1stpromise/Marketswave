/**
 * verify-contrast.mjs - real composited-pixel contrast measurement.
 *
 * WHY THIS EXISTS, and why a getComputedStyle-based check is useless here:
 * resources.html carries .page-grain - a full-viewport SVG-turbulence overlay at
 * mix-blend-mode: multiply, z-index 40. It sits ABOVE the content, so it darkens both the
 * text and the surface beneath it, and it has no background-color for anything to read.
 * Reading authored colours and compositing them arithmetically cannot model per-pixel
 * multiply noise. So this samples the ACTUAL RENDERED PIXELS.
 *
 * Three traps this project has already paid for, all handled here:
 *   1. Page.captureScreenshot's `clip` is in PAGE coordinates, not viewport coordinates.
 *      Avoided entirely: we capture the plain viewport and sample with viewport-relative
 *      rects from getBoundingClientRect().
 *   2. `visibility: hidden` also removes the element's OWN background, so an element hidden
 *      that way reports whatever sits behind its container instead of its own surface.
 *      Avoided: the background pass uses `color: transparent` (plus transparent
 *      -webkit-text-fill-color and text-shadow), which removes the glyphs while leaving the
 *      box painted.
 *   3. Long-cycle opacity animations catch text mid-fade and produce meaningless readings.
 *      Avoided: prefers-reduced-motion: reduce is emulated for the whole run.
 *
 * Background is the MEDIAN pixel of the text box with the glyphs removed. Foreground is the
 * glyph core - whichever of the box's darkest/lightest pixel sits furthest from that
 * background in luminance. That polarity check is load-bearing, not defensive: this page has
 * light-on-dark surfaces (the hero, the workflow table head, the footer) as well as
 * dark-on-light ones, and taking "darkest" unconditionally measures the dark background
 * against itself and reports a meaningless ~1.0:1 for every one of them.
 *
 * Antialiasing can only pull the sampled glyph core back toward the background, so the
 * measurement errs pessimistic - it never flatters a failing colour.
 *
 * Usage:  node scripts/verify-contrast.mjs
 *         CONTRAST_URL=... CONTRAST_WIDTHS=1440,390 node scripts/verify-contrast.mjs
 * Requires a static server already serving the project (default http://127.0.0.1:8765).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CONTRAST_PORT || 9333);
const PAGE_URL = process.env.CONTRAST_URL || 'http://127.0.0.1:8765/resources.html';
const THRESHOLD = 4.5;

const SELECTORS = [
  // --- the redesigned components (rest state) ---
  { label: 'res-item h3', sel: '.res-item h3', limit: 6 },
  { label: 'res-item kind', sel: '.res-kind', limit: 6 },
  { label: 'res-item body', sel: '.res-item p', limit: 6 },
  { label: 'res-item numeral', sel: '.res-n', limit: 6 },
  { label: 'res-step h3', sel: '.res-st h3', limit: 6 },
  { label: 'res-step body', sel: '.res-st p', limit: 6 },
  { label: 'res-step dot', sel: '.res-dot', limit: 6 },
  // How It Works portfolio-assembly artifact (2026-09-09). The readout rows sit at opacity
  // .22 until their step is reached, so these are measured with the artifact scrolled into
  // view, which is also the only state in which a reader can actually read them.
  { label: 'artifact label', sel: '.hiw-cap b', limit: 1 },
  { label: 'artifact percentage', sel: '.hiw-cap i', limit: 1 },
  { label: 'readout key', sel: '.hiw-readout .hiw-row.is-on .hiw-k', limit: 6 },
  { label: 'readout value', sel: '.hiw-readout .hiw-row.is-on .hiw-v', limit: 6 },
  // --- hover state: greyscale-at-rest only pays off if the engaged row is legible ---
  // Every row is measured, not a sample: the six accents differ per row, and a
  // 2-row sample originally hid four genuine failures behind two passes.
  { label: 'HOVER res-item numeral', sel: '.res-n', limit: 6, hover: true },
  { label: 'HOVER res-step dot', sel: '.res-dot', limit: 6, hover: true },
  { label: 'HOVER res-item h3', sel: '.res-item h3', limit: 6, hover: true },
  { label: 'HOVER res-item kind', sel: '.res-kind', limit: 6, hover: true },
  { label: 'HOVER res-item body', sel: '.res-item p', limit: 6, hover: true },
  { label: 'HOVER res-step h3', sel: '.res-st h3', limit: 6, hover: true },
  // --- the rest of the page: the grain is NEW and page-wide, so sections this redesign
  //     never touched are now composited differently than when they were last measured ---
  { label: 'page-hero h1', sel: '.page-hero h1', limit: 1 },
  { label: 'page-hero lede', sel: '.page-hero p', limit: 1 },
  { label: 'section h2', sel: '.section-header h2', limit: 4 },
  { label: 'section lede', sel: '.section-header p', limit: 4 },
  { label: 'table cell', sel: '.workflow-table-wrap td', limit: 4 },
  { label: 'table head', sel: '.workflow-table-wrap th', limit: 3 },
  { label: 'help card h3', sel: '#help h3', limit: 4 },
  { label: 'help card body', sel: '#help p', limit: 4 },
  { label: 'blog card h3', sel: '#blog h3', limit: 3 },
  { label: 'blog card body', sel: '#blog p', limit: 3 },
  { label: 'footer link', sel: '.site-footer a', limit: 4 },
  { label: 'footer text', sel: '.site-footer p', limit: 2 },
  // Condensed disclosures (2026-09-09): small muted type on the footer's dark, grain-screened
  // surface - exactly the combination that fails, and it appears on all eight footer pages.
  { label: 'disclosure text', sel: '.footer-disclosures p', limit: 3 },
  { label: 'full-disclosures link', sel: '.footer-disclosures-more a', limit: 1 },
];

// WCAG relative luminance + contrast ratio.
const lum = (c) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const pair = [lum(a), lum(b)].sort((p, q) => q - p);
  return (pair[0] + 0.05) / (pair[1] + 0.05);
};

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.text + ' :: ' + ((d.exception && d.exception.description) || ''));
    }
    return r.result.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLER = [
  'window.__sample = (dataUri, rect) => new Promise((resolve) => {',
  '  const img = new Image();',
  '  img.onload = () => {',
  '    const c = document.createElement("canvas");',
  '    c.width = img.width; c.height = img.height;',
  '    const g = c.getContext("2d", { willReadFrequently: true });',
  '    g.drawImage(img, 0, 0);',
  '    const x = Math.max(0, Math.round(rect.x)), y = Math.max(0, Math.round(rect.y));',
  '    const w = Math.max(1, Math.min(Math.round(rect.w), img.width - x));',
  '    const h = Math.max(1, Math.min(Math.round(rect.h), img.height - y));',
  '    const d = g.getImageData(x, y, w, h).data;',
  '    const px = [];',
  '    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i+1], d[i+2]]);',
  '    const L = (p) => 0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2];',
  '    px.sort((a, b) => L(a) - L(b));',
  '    resolve({ darkest: px[0], lightest: px[px.length-1], median: px[Math.floor(px.length/2)], n: px.length });',
  '  };',
  '  img.src = dataUri;',
  '});',
].join('\n');

async function measure(cdp, t) {
  const pick = 'document.querySelectorAll(' + JSON.stringify(t.sel) + ')[' + t.idx + ']';

  const rect = await cdp.eval([
    '(async () => {',
    '  const el = ' + pick + '; if (!el) return null;',
    '  el.scrollIntoView({ block: "center", behavior: "instant" });',
    '  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));',
    '  const r = el.getBoundingClientRect();',
    '  return { x: r.x, y: r.y, w: r.width, h: r.height };',
    '})()',
  ].join('\n'));
  if (!rect) return null;

  // Hovering a row shifts it (.res-item:hover adds padding-left), so the rect captured above
  // describes where the glyphs WERE, not where they are once hovered. Re-read the box in the
  // hovered state; sampling the stale rect reads mostly background and fakes a ~1.0:1 pass
  // failure that has nothing to do with the colours under test.
  let box = rect;
  if (t.hover) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    await sleep(450);
    box = await cdp.eval([
      '(() => { const el = ' + pick + '; if (!el) return null;',
      '  const r = el.getBoundingClientRect();',
      '  return { x: r.x, y: r.y, w: r.width, h: r.height }; })()',
    ].join('\n')) || rect;
  }

  const shot = async () => 'data:image/png;base64,' + (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;

  // Pass 1 - normal render. Darkest pixel in the box is the glyph core.
  const fg = await cdp.eval('window.__sample(' + JSON.stringify(await shot()) + ', ' + JSON.stringify(box) + ')');

  // Pass 2 - Trap 2: remove the glyphs only, never the box.
  await cdp.eval([
    '(() => { const el = ' + pick + ';',
    '  el.dataset.savedStyle = el.style.cssText;',
    '  el.style.setProperty("color", "transparent", "important");',
    '  el.style.setProperty("-webkit-text-fill-color", "transparent", "important");',
    '  el.style.setProperty("text-shadow", "none", "important"); })()',
  ].join('\n'));
  await sleep(120);
  const bg = await cdp.eval('window.__sample(' + JSON.stringify(await shot()) + ', ' + JSON.stringify(box) + ')');
  await cdp.eval('(() => { const el = ' + pick + '; el.style.cssText = el.dataset.savedStyle || ""; delete el.dataset.savedStyle; })()');

  if (t.hover) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });

  // Polarity matters: on a light surface the glyph core is the DARKEST pixel, but on a dark
  // surface (the hero, the table head, the footer) it is the LIGHTEST. Picking "darkest"
  // unconditionally reports the background against itself and yields a meaningless ~1.0:1.
  // Choose whichever extreme sits furthest from the measured background luminance.
  const bgc = bg.median;
  const dDark = Math.abs(lum(fg.darkest) - lum(bgc));
  const dLight = Math.abs(lum(fg.lightest) - lum(bgc));
  const fgc = dLight > dDark ? fg.lightest : fg.darkest;
  return { fg: fgc, bg: bgc, polarity: dLight > dDark ? 'light-on-dark' : 'dark-on-light',
           ratio: Math.round(ratio(fgc, bgc) * 100) / 100 };
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'mw-contrast-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  // Connect to a PAGE target, not the browser target - the browser-level endpoint does not
  // implement Page/Runtime/Input, and reports them as "wasn't found".
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl;
      else await sleep(250);
    } catch (e) { await sleep(250); }
  }
  if (!wsUrl) { chrome.kill(); throw new Error('Chrome did not expose a page debugging endpoint'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // Trap 3: pin reduced motion so nothing is sampled mid-transition.
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const widths = (process.env.CONTRAST_WIDTHS || '1440').split(',').map(Number);
  const results = [];

  for (const width of widths) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(1800);

    // Viewport-integrity guard: this project has had a run report a clean PASS while the
    // browser was silently clamped to a different width. Fail loudly instead.
    const real = await cdp.eval('window.innerWidth');
    if (real !== width) throw new Error('viewport integrity: asked ' + width + ', got ' + real);

    await cdp.eval(SAMPLER);

    const targets = await cdp.eval([
      '(() => {',
      '  const sels = ' + JSON.stringify(SELECTORS) + ';',
      '  const out = [];',
      '  for (const s of sels) {',
      '    document.querySelectorAll(s.sel).forEach((el, i) => {',
      '      if (s.limit != null && i >= s.limit) return;',
      '      const r = el.getBoundingClientRect();',
      '      if (r.width < 4 || r.height < 4) return;',
      '      const cs = getComputedStyle(el);',
      '      if (cs.visibility === "hidden" || cs.display === "none") return;',
      '      if (!el.textContent.trim()) return;',
      '      out.push({ label: s.label + (i ? " #" + (i+1) : ""), sel: s.sel, idx: i, hover: !!s.hover });',
      '    });',
      '  }',
      '  return out;',
      '})()',
    ].join('\n'));

    for (const t of targets) {
      const m = await measure(cdp, t);
      if (m) results.push(Object.assign({ width }, t, m));
    }
  }

  ws.close();
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  report(results);
}

function report(rows) {
  const fail = rows.filter((r) => r.ratio < THRESHOLD);
  for (const w of [...new Set(rows.map((r) => r.width))]) {
    console.log('\n=== viewport ' + w + 'px ===');
    const set = rows.filter((x) => x.width === w).sort((a, b) => a.ratio - b.ratio);
    for (const r of set) {
      const rgb = (c) => 'rgb(' + c.join(',') + ')';
      console.log('  ' + (r.ratio >= THRESHOLD ? 'PASS' : 'FAIL') +
        '  ' + String(r.ratio).padStart(6) + ':1  ' + r.label.padEnd(26) +
        ' fg=' + rgb(r.fg).padEnd(18) + ' bg=' + rgb(r.bg));
    }
  }
  console.log('\n' + rows.length + ' measurements, ' + fail.length + ' below ' + THRESHOLD + ':1');
  console.log(fail.length ? 'CONTRAST: FAIL' : 'CONTRAST: PASS');
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
