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

// Page profiles. This file began as resources.html's own contrast check; the Returns
// Display work (2026-09-09) needed the same real-composited-pixel measurement on two
// AUTHENTICATED pages, so the selector list became a profile chosen by CONTRAST_PROFILE and
// an optional CONTRAST_BOOTSTRAP_JS hook seeds a real session before the target page loads.
// Default behaviour is unchanged: no env vars means the resources profile, exactly as before.
const PROFILES = {};

PROFILES.resources = [
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
  // Login gate + loading screen (2026-09-09). Small muted text on a dark environment and a
  // teal eyebrow on cream are both the shapes that fail, so all of them are measured.
  { label: 'gate headline', sel: '.gate-headline h1', limit: 1 },
  { label: 'gate sub', sel: '.gate-sub', limit: 1 },
  { label: 'gate brand', sel: '.gate-brand', limit: 1 },
  { label: 'gate eyebrow', sel: '.gate-eyebrow', limit: 1 },
  { label: 'gate title', sel: '.login-title', limit: 1 },
  { label: 'gate lead', sel: '.login-lead', limit: 1 },
  { label: 'field label', sel: '.fld label', limit: 2 },
  { label: 'forgot link', sel: '.gate-row a', limit: 1 },
  { label: 'back pill', sel: '.gate-back', limit: 1 },
  { label: 'gate alt', sel: '.gate-alt', limit: 1 },
  // Condensed disclosures (2026-09-09): small muted type on the footer's dark, grain-screened
  // surface - exactly the combination that fails, and it appears on all eight footer pages.
  { label: 'disclosure text', sel: '.footer-disclosures p', limit: 3 },
  { label: 'full-disclosures link', sel: '.footer-disclosures-more a', limit: 1 },
];

// Returns Display (2026-09-09). Every NEW coloured figure is measured — gain green, loss
// red, realised blue — in BOTH tones, because a returns display that has only ever been
// measured green is only half measured. Row 177 found five of six accent hues fail as text
// on these grounds, so none of these three is assumed safe from having been used elsewhere.
PROFILES['returns-dashboard'] = [
  { label: 'card label', sel: '.ret-k', limit: 3 },
  { label: 'total return figure', sel: '.ret-v', limit: 1 },
  { label: 'percentage pill', sel: '.ret-pc', limit: 1 },
  { label: 'context line', sel: '.ret-sub', limit: 3 },
  { label: 'unrealised figure', sel: '#total-unrealized-amount', limit: 1 },
  { label: 'realised figure (blue)', sel: '#asset-returns-amount', limit: 1 },
  { label: 'best class name', sel: '.ret-class', limit: 1 },
  { label: 'best class pct', sel: '#best-performing-return .ret-u', limit: 1 },
];

// asset-performance.html. `.rt` now matches BOTH tables — the Return Table and the
// closed-positions panel — which is deliberate: they are styled as siblings, so measuring
// them through one selector is what proves they really are. Limits are set above the real
// element counts so nothing is silently sampled out.
PROFILES['returns-holdings'] = [
  // Summary cards. The two returns cards colour the DISPLAY figure by sign, which the
  // dashboard's own card does not, so these are new surfaces rather than known ones.
  { label: 'card label', sel: '.ret-k', limit: 3 },
  { label: 'card figure', sel: '.ret-v', limit: 3 },
  { label: 'card sub-line', sel: '.ret-sub', limit: 3 },
  { label: 'card sub figure', sel: '.ret-sub .ret-u', limit: 2 },
  // Both tables
  { label: 'column head', sel: '.rt th', limit: 14 },
  { label: 'holding name', sel: '.rt tbody b', limit: 8 },
  { label: 'holding meta', sel: '.rt tbody .rt-meta', limit: 8 },
  // The partial-sale marker takes the realised blue rather than the meta grey, so it is a
  // genuinely different measurement from the meta line it sits under.
  { label: 'partial-sale marker', sel: '.rt-partial', limit: 6 },
  { label: 'units/cost figure', sel: '.rt .rt-num', limit: 14 },
  { label: 'current value', sel: '.rt .rt-val', limit: 10 },
  { label: 'gain amount', sel: '.rt .rt-gain .a', limit: 10 },
  { label: 'gain percent', sel: '.rt .rt-gain .p', limit: 10 },
  { label: 'totals label', sel: '.rt-total-lab', limit: 2 },
  { label: 'legend text', sel: '.rt-legend div', limit: 2 },
  { label: 'legend term', sel: '.rt-legend b', limit: 2 },
];

// The same page for a client who has never sold — the state MOST clients are in, so its
// copy is measured for real rather than assumed to inherit a tone measured elsewhere.
PROFILES['returns-holdings-empty'] = [
  { label: 'card label', sel: '.ret-k', limit: 3 },
  { label: 'card figure', sel: '.ret-v', limit: 3 },
  { label: 'card sub-line', sel: '.ret-sub', limit: 3 },
  { label: 'empty-state copy', sel: '.rt-empty-copy', limit: 1 },
];

/* The converged control vocabulary (Button and Control Modernisation, 2026-09-10).
 * Both label colours are NEW surfaces: Tier B puts #475569 on a translucent white that
 * sits over whatever the page's own glass/blob background happens to be, and Tier C is
 * the same at 13px. Hover is measured too, because .mw-btn-secondary:hover CHANGES both
 * the ground (#F5F3EF) and the text (#1A1C1E) — a hover state that fails is still a
 * failure, and rest-state alone would never have measured it. */
PROFILES.controls = [
  { label: 'Tier A label (gradient ground)', sel: '.mw-btn-primary', limit: 4 },
  { label: 'Tier A admin label', sel: '.mw-btn-admin', limit: 4 },
  { label: 'Tier A approve label', sel: '.mw-btn-approve', limit: 4 },
  { label: 'Tier A danger label', sel: '.mw-btn-danger', limit: 4 },
  { label: 'Tier B label (translucent ground)', sel: '.mw-btn-secondary', limit: 6 },
  // Scoped so no element is measured twice under two labels: a Tier C button that is
  // ALSO secondary is measured once, as Tier B. Measuring one button under both labels
  // produced 7.44:1 and 4.1:1 in the SAME run for the SAME element (the second sample
  // caught an antialiased edge pixel) - a permanent false failure if left in.
  { label: 'Tier C label', sel: '.mw-btn-sm:not(.mw-btn-secondary):not(.mw-btn-outline)', limit: 8 },
  { label: 'Tier B outline label', sel: '.mw-btn-outline', limit: 4 },
  { label: 'field text', sel: '.mw-field', limit: 6 },
  // --- hover: the secondary treatment changes BOTH ground and text on hover ---
  { label: 'HOVER Tier B label', sel: '.mw-btn-secondary', limit: 6, hover: true },
  { label: 'HOVER Tier C label', sel: '.mw-btn-sm:not(.mw-btn-secondary):not(.mw-btn-outline)', limit: 8, hover: true },
  { label: 'HOVER Tier A label', sel: '.mw-btn-primary', limit: 4, hover: true },
  { label: 'HOVER Tier A admin label', sel: '.mw-btn-admin', limit: 4, hover: true },
];

/* The accessible upload component and the floating-label pattern (rows 189/190,
 * 2026-09-10). The floated label is 11px uppercase on the field's own ground, which is a
 * genuinely new and genuinely small text surface — exactly the kind that passes by eye and
 * fails when measured. Focus states are included because both the label colour AND the
 * field ground change on focus. */
PROFILES['controls-fields'] = [
  { label: 'floating label (resting)', sel: '.mw-fld > label', limit: 10 },
  { label: 'field value text', sel: '.mw-fld > .mw-field', limit: 10 },
  { label: 'upload face', sel: '.mw-upload-face', limit: 4 },
  { label: 'upload hint', sel: '.mw-upload-hint', limit: 4 },
  { label: 'upload state', sel: '.mw-upload-state', limit: 4 },
  { label: 'upload clear', sel: '.mw-upload-clear', limit: 4 },
  { label: 'HOVER upload face', sel: '.mw-upload-face', limit: 4, hover: true },
  { label: 'HOVER upload clear', sel: '.mw-upload-clear', limit: 4, hover: true },
];

/* Merged Market Snapshot + Watchlist (2026-09-11). Every text surface on the new card,
 * measured on real composited pixels over the glass it actually sits on — the mockup's own
 * #7C868C / #8A9298 greys measure roughly 4.0:1 and 3.4:1 there and are not used.
 * BOTH badge styles are measured, not one as a stand-in for the other: Offered is green on
 * a green tint and Tracking only is slate on a navy tint, two genuinely different stacks.
 * The add panel and the alert modal are opened by CONTRAST_PREPARE_JS before sampling —
 * without that most of this profile is display:none and the run passes on nothing. */
PROFILES.watchlist = [
  { label: 'row ticker', sel: '.wl-tag', limit: 8 },
  { label: 'row name', sel: '.wl-name', limit: 8 },
  { label: 'badge Offered', sel: '.wl-badge:not(.wl-track)', limit: 6 },
  { label: 'badge Tracking only', sel: '.wl-badge.wl-track', limit: 6 },
  { label: 'row price', sel: '.wl-px-v', limit: 8 },
  { label: 'row change (gain)', sel: '.wl-px-c.wl-up', limit: 6 },
  { label: 'row change (loss)', sel: '.wl-px-c.wl-dn', limit: 6 },
  { label: 'Delayed label', sel: '.wl-delayed', limit: 1 },
  { label: 'symbol count', sel: '.wl-count', limit: 1 },
  { label: 'ceiling caption', sel: '.wl-cap', limit: 1 },
  { label: 'armed alert line', sel: '.wl-alertline', limit: 4 },
  { label: 'search result source', sel: '.wl-src', limit: 6 },
  { label: 'HOVER row name', sel: '.wl-name', limit: 6, hover: true },
  { label: 'HOVER row price', sel: '.wl-px-v', limit: 6, hover: true },
];

/* The alert modal is measured in its OWN run, not alongside the card. It covers the page
 * with a blurred scrim, so anything behind it is sampled THROUGH that scrim — which is
 * exactly how the first run of this profile reported .wl-name at 3.6:1 with a white
 * foreground on a mid-grey ground. Those were real measurements of a genuinely obscured
 * surface, not a real contrast failure, and splitting the runs is what makes both honest. */
PROFILES['watchlist-modal'] = [
  { label: 'alert modal title', sel: '.wl-modal-title', limit: 1 },
  { label: 'alert modal copy', sel: '.wl-modal-sub', limit: 1 },
  { label: 'alert modal field label', sel: 'label[for="wl-alert-target"]', limit: 1 },
  { label: 'alert modal error', sel: '.wl-modal-error:not([hidden])', limit: 2 },
];


const SELECTORS = PROFILES[process.env.CONTRAST_PROFILE || 'resources'];
if (!SELECTORS) throw new Error('unknown CONTRAST_PROFILE: ' + process.env.CONTRAST_PROFILE);

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
    // An authenticated target needs its session in place BEFORE the page's own script runs,
    // so seed it on the same origin first, then navigate for real.
    if (process.env.CONTRAST_BOOTSTRAP_JS) {
      const origin = new URL(PAGE_URL).origin + '/';
      await cdp.send('Page.navigate', { url: origin });
      await sleep(600);
      await cdp.eval(process.env.CONTRAST_BOOTSTRAP_JS);
    }
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(Number(process.env.CONTRAST_SETTLE_MS || 1800));

    // CONTRAST_PREPARE_JS runs AFTER the page has settled, unlike CONTRAST_BOOTSTRAP_JS,
    // which must run BEFORE navigation to seed a session. It exists because some controls
    // only come into being once the page is live and something has been opened - a
    // conditionally-revealed form panel, a modal. Without it those controls are never
    // measured at all and the run reports a confident zero.
    if (process.env.CONTRAST_PREPARE_JS) {
      await cdp.eval(process.env.CONTRAST_PREPARE_JS);
      await sleep(Number(process.env.CONTRAST_PREPARE_SETTLE_MS || 900));
    }

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
  // A run that measured NOTHING is not a pass. It means the page never loaded, or no selector
  // matched anything - and reporting PASS there is a vacuous green that would hide a real
  // regression rather than catch it. Seen intermittently on login.html, whose auth module is
  // slow to settle, which is exactly the kind of page where a silent zero is most misleading.
  if (rows.length === 0) {
    console.log('CONTRAST: FAIL (no measurements taken — page did not load, or no selector matched)');
    process.exit(1);
  }
  console.log(fail.length ? 'CONTRAST: FAIL' : 'CONTRAST: PASS');
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
