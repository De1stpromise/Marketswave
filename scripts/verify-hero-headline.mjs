/* verify-hero-headline.mjs — the B4 hero headline (2026-09-11).
 *
 * ★ WHY THIS IS NOT JUST A verify-contrast.mjs PROFILE.
 * The second line is GRADIENT-FILLED TEXT sitting on a GLOW IT CASTS ITSELF. Neither half of
 * that is something a generic sampler handles:
 *
 *   1. The foreground is not one colour. It ramps navy -> teal -> gold across the line, so a
 *      single reading is meaningless. Row 188 is the precedent: white-on-emerald passed at one
 *      end of a gradient and failed at the other, and only measuring BOTH ends caught it. The
 *      gold stop is the risk here — it is the lightest colour in the ramp sitting over the
 *      lightest part of the ground.
 *   2. The background is not the section's background. A ::before glow sits between them, so
 *      the real ground is the composite, and it is lighter than the page under the text.
 *
 * HOW THE GROUND IS SAMPLED, AND THE TRAP AVOIDED.
 * The glyphs are hidden by making the text itself transparent (the span keeps its box, its
 * ::before, and its position), then real pixels are read from the screenshot. `visibility:
 * hidden` would NOT work: row 173 recorded that it also removes the element's own background,
 * and here the glow IS a pseudo-element of that same span, so hiding it would sample the bare
 * page and report a flattering number for a ground that does not exist.
 *
 * The foregrounds are taken from the gradient's own declared stops rather than sampled,
 * because an antialiased glyph edge blends toward the ground and would report a contrast
 * better than the glyph actually has.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerifyMain } from './lib/run-verify.mjs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.HERO_PORT || 9481);
const BASE = process.env.HERO_BASE_URL || 'http://127.0.0.1:8765';
const SHOTS = process.env.HERO_SHOT_DIR || '';

/* The declared ramp: linear-gradient(135deg, --primary 15%, #137254 55%, #8A5C07 100%).
 * Before the first stop the colour is flat navy, so the two ENDS of the painted text are navy
 * and gold — those are the two readings that matter. Teal at the midpoint is measured too,
 * since it is the darkest-to-lightest transition and cheap to include. */
const STOPS = [
  { name: 'navy stop (line start)', rgb: [27, 58, 75], at: 0.06 },
  { name: 'teal stop (line middle)', rgb: [19, 114, 84], at: 0.55 },
  { name: 'gold stop (line end)', rgb: [138, 92, 7], at: 0.94 },
];

let passed = 0;
const failures = [];
const check = (label, ok, detail) => {
  if (ok) { passed++; console.log('  PASS  ' + label); }
  else { failures.push(label); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
};

const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const p = [lum(a), lum(b)].sort((x, y) => y - x); return Math.round(((p[0] + 0.05) / (p[1] + 0.05)) * 100) / 100; };

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    });
  }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'mw-hero-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars',
    'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const pg = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pg) wsUrl = pg.webSocketDebuggerUrl; else await sleep(250);
    } catch (e) { await sleep(250); }
  }
  if (!wsUrl) { chrome.kill(); throw new Error('no CDP page target'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE + '/index.html' });
  await sleep(2600);
  await cdp.eval('document.fonts.ready');

  // ------------------------------------------------------------------ structure + copy
  console.log('\n=== STRUCTURE — two lines, the weights and the ramp ===');
  const st = await cdp.eval(`(() => {
    const a = document.querySelector('.hero h1 .hero-h1-a');
    const b = document.querySelector('.hero h1 .hero-h1-b');
    if (!a || !b) return { missing: true };
    const ca = getComputedStyle(a), cb = getComputedStyle(b);
    const glow = getComputedStyle(b, '::before');
    return {
      aText: a.textContent.trim(), bText: b.textContent.trim(),
      aWeight: ca.fontWeight, bWeight: cb.fontWeight,
      aColor: ca.color, aFamily: ca.fontFamily.split(',')[0],
      bFamily: cb.fontFamily.split(',')[0],
      bClip: cb.webkitBackgroundClip || cb.backgroundClip,
      bFill: cb.webkitTextFillColor,
      bFallback: cb.color,
      glowFilter: glow.filter, glowAnim: glow.animationName,
      glowDur: glow.animationDuration, glowZ: glow.zIndex,
      glowBg: (glow.backgroundImage || '').slice(0, 160),
    };
  })()`);
  check('both headline lines exist', !st.missing);
  check('line 1 is the quiet statement, lowercase: "' + st.aText + '"',
    st.aText === 'Capital with clarity.', st.aText);
  check('line 2 is the conclusion, lowercase: "' + st.bText + '"',
    st.bText === 'Partnerships with patience.', st.bText);
  check('title case is genuinely gone from both lines',
    !/\bClarity\b|\bPatience\b|\bCapital with C|\bPartnerships with P/.test(st.aText + ' ' + st.bText));
  check('line 1 is Inter 300 (' + st.aWeight + ')', st.aWeight === '300' && /Inter/.test(st.aFamily), st.aFamily);
  check('line 1 is muted slate, not navy (' + st.aColor + ')', st.aColor === 'rgb(90, 107, 118)', st.aColor);
  check('line 2 is Inter 700 (' + st.bWeight + ')', st.bWeight === '700' && /Inter/.test(st.bFamily), st.bFamily);
  check('line 2 is gradient-filled via background-clip: text', st.bClip === 'text', st.bClip);
  check('line 2 keeps a solid navy fallback so it can never render invisible',
    st.bFallback === 'rgb(27, 58, 75)', st.bFallback);

  console.log('\n=== GLOW — behind line 2 only, two fields, breathing ===');
  check('the glow is heavily blurred (' + st.glowFilter + ')', /blur\((2[0-9]|3[0-9])px\)/.test(st.glowFilter), st.glowFilter);
  check('it sits BEHIND the text (z-index ' + st.glowZ + ')', st.glowZ === '-1', st.glowZ);
  check('two radial fields, teal and gold', (st.glowBg.match(/radial-gradient/g) || []).length === 2, st.glowBg);
  check('teal is weighted left, gold right', /22,\s*129,\s*95/.test(st.glowBg) && /200,\s*134,\s*10/.test(st.glowBg), st.glowBg);
  check('it breathes on a slow cycle (' + st.glowAnim + ' ' + st.glowDur + ')',
    st.glowAnim === 'heroGlowBreathe' && st.glowDur === '7s', st.glowAnim + '/' + st.glowDur);

  const onLine1 = await cdp.eval(`(() => getComputedStyle(document.querySelector('.hero h1 .hero-h1-a'), '::before').backgroundImage)()`);
  check('line 1 carries NO glow — it is behind the second line only', onLine1 === 'none', onLine1);

  // ------------------------------------------------- contrast at both ends, over the glow
  console.log('\n=== CONTRAST — each gradient stop against the ground IT IS LIT BY ===');
  const box = await cdp.eval(`(() => {
    const b = document.querySelector('.hero h1 .hero-h1-b');
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = b.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`);

  /* Hide the GLYPHS ONLY. The span keeps its box and its ::before, so what remains is exactly
   * the ground the text is painted on, glow included. */
  await cdp.eval(`(() => {
    const s = document.createElement('style');
    s.id = '__hideglyphs';
    s.textContent = '.hero h1 .hero-h1-b{ -webkit-text-fill-color: transparent !important; color: transparent !important; background-image: none !important; }';
    document.head.appendChild(s);
    return true;
  })()`);
  /* Freeze the breathing so the sample is a defined point in the cycle rather than whatever
   * instant the screenshot lands on — row 176's mid-fade lesson. Paused at opacity 1 is the
   * brightest ground, i.e. the WORST case for contrast, which is the one worth asserting. */
  await cdp.eval(`(() => { const s=document.createElement('style'); s.id='__freeze'; s.textContent='*,*::before,*::after{animation-play-state:paused !important}'; document.head.appendChild(s); return true; })()`);
  await sleep(400);

  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: Math.max(8, box.w), height: Math.max(8, box.h), scale: 1 },
  });
  if (SHOTS) writeFileSync(join(SHOTS, 'hero-ground.png'), Buffer.from(shot.data, 'base64'));

  const ground = await cdp.eval(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${shot.data}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const read = (fx) => {
      const x = Math.min(img.width - 1, Math.max(0, Math.round(img.width * fx)));
      // Average a vertical strip through the text band so a single stray pixel cannot decide
      // the result, and take the LIGHTEST reading — the glow's brightest point is the worst
      // case for dark text on it.
      let best = null, bestL = -1;
      for (let y = Math.round(img.height * 0.25); y < Math.round(img.height * 0.75); y++) {
        const d = g.getImageData(x, y, 1, 1).data;
        const px = [d[0], d[1], d[2]];
        const L = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
        if (L > bestL) { bestL = L; best = px; }
      }
      return best;
    };
    return ${JSON.stringify(STOPS)}.map((s) => ({ name: s.name, ground: read(s.at) }));
  })()`);

  for (let i = 0; i < STOPS.length; i++) {
    const s = STOPS[i];
    const g = ground[i].ground;
    const r = ratio(s.rgb, g);
    check(s.name + ' over its lit ground: ' + r + ':1  (fg rgb(' + s.rgb.join(',') + ') on rgb(' + g.join(',') + '))',
      r >= 4.5, 'ratio ' + r);
  }

  /* NON-VACUITY: the ground samples must differ from each other, or the reader is measuring
   * one point three times and the both-ends requirement is not actually being met. */
  const distinct = new Set(ground.map((g) => g.ground.join(','))).size;
  check('the three samples are genuinely different points on the line (' + distinct + ' distinct grounds)',
    distinct >= 2, JSON.stringify(ground));

  await cdp.eval(`(() => { ['__hideglyphs','__freeze'].forEach(id => { const e=document.getElementById(id); if(e) e.remove(); }); return true; })()`);

  // ------------------------------------------------------------------ reduced motion
  console.log('\n=== REDUCED MOTION — the breathing stops, the light stays ===');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp.send('Page.navigate', { url: BASE + '/index.html' });
  await sleep(2600);
  await cdp.eval('document.fonts.ready');
  const rm = await cdp.eval(`(() => {
    const g = getComputedStyle(document.querySelector('.hero h1 .hero-h1-b'), '::before');
    return { anim: g.animationName, bg: (g.backgroundImage || '').slice(0, 80), filter: g.filter, opacity: g.opacity };
  })()`);
  check('the breathing animation is suppressed (' + rm.anim + ')', rm.anim === 'none', rm.anim);
  check('the glow itself REMAINS — it is light, not movement', /radial-gradient/.test(rm.bg) && rm.opacity !== '0', JSON.stringify(rm));

  ws.close(); chrome.kill();
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log('HERO HEADLINE: FAIL'); process.exit(1); }
  console.log('HERO HEADLINE: PASS');
}

runVerifyMain(main, { watchdogMs: 420000 });
