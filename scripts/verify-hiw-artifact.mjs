/**
 * verify-hiw-artifact.mjs - the How It Works portfolio-assembly artifact.
 *
 * The point of this script is to prove the artifact BUILDS. A screenshot of the finished
 * state proves nothing on its own - an artifact hardcoded to "complete" would produce an
 * identical picture. So the desktop pass steps through six real scroll positions and asserts
 * the state STRICTLY INCREASES, capturing a screenshot at each one.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { makeTempDir, trackChild, releaseTempDir } from './lib/harness-teardown.mjs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.HIW_PORT || 9338);
const URL_ = process.env.HIW_URL || 'http://127.0.0.1:8765/resources.html';
const SHOTS = process.env.HIW_SHOTS || null;

let pass = 0, fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
};

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.p = new Map(); this.events = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method) this.events.push(m);
      if (m.id && this.p.has(m.id)) {
        const q = this.p.get(m.id); this.p.delete(m.id);
        if (m.error) q.reject(new Error(m.error.message)); else q.resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.p.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const READ_STATE = `(() => ({
  pct: document.getElementById('hiw-pct').textContent,
  layersOn: document.querySelectorAll('.hiw-lay.is-on').length,
  rowsOn: document.querySelectorAll('.hiw-readout .hiw-row.is-on').length,
  past: document.querySelectorAll('.res-st.is-past').length,
  now: document.querySelectorAll('.res-st.is-now').length,
  fill: parseFloat(getComputedStyle(document.querySelector('.res-steps')).getPropertyValue('--hiw-fill')) || 0,
  ringClosed: (document.getElementById('hiw-ring').style.strokeDashoffset || '189') === '0',
  beamOn: document.getElementById('hiw-beam').classList.contains('is-on'),
  scrollY: Math.round(window.scrollY)
}))()`;

async function main() {
  const profile = makeTempDir('mw-hiw-');
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
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  // ---------------------------------------------------------------- desktop: the build
  console.log('\n=== DESKTOP 1440 — does it genuinely BUILD? ===');
  cdp.events.length = 0;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: URL_ });
  await sleep(2200);
  ok((await cdp.eval('window.innerWidth')) === 1440, 'viewport integrity', '1440');

  const states = [];
  for (let i = 0; i < 6; i++) {
    // Put step i comfortably ABOVE the script's own 55% activation line. Landing exactly on
    // it left step 1 a hair below and reported active=-1, which looked like the artifact
    // failing to start when it was only the test's scroll position.
    // behavior:'instant' is REQUIRED, not tidiness: this site sets scroll-behavior:smooth
    // globally, so a plain scrollBy animates over several hundred ms and every read below
    // lands mid-flight. Absolute scrollTo + waiting for scrollY to actually arrive makes the
    // position deterministic before any state is sampled.
    const targetY = await cdp.eval(`(() => {
      const s = document.querySelectorAll('.res-st')[${i}];
      const r = s.getBoundingClientRect();
      const y = Math.round(window.scrollY + r.top - window.innerHeight * 0.40);
      window.scrollTo({ top: y, behavior: 'instant' });
      return y;
    })()`);
    for (let t = 0; t < 40; t++) {
      const y = await cdp.eval('Math.round(window.scrollY)');
      if (Math.abs(y - targetY) <= 2) break;
      await sleep(100);
    }
    // Poll until the handler has actually PROCESSED this scroll position, with a real
    // timeout - the same pollUntil discipline the rest of this project's verification uses.
    // A plain sleep, and even a "has it stopped changing" check, can both sample while the
    // rAF-throttled handler is still pending: the previous step's state is itself perfectly
    // stable, so it reads as settled and the test reports a lag the artifact does not have.
    // This is NOT tautological - if the artifact genuinely failed to advance, the poll times
    // out and the assertions below fail on the stale value exactly as they should.
    let st = await cdp.eval(READ_STATE);
    for (let t = 0; t < 60 && st.rowsOn !== i + 1; t++) {
      await sleep(100);
      st = await cdp.eval(READ_STATE);
    }
    await sleep(150);            // let the in-flight transition finish before reading fill
    st = await cdp.eval(READ_STATE);
    states.push(st);
    console.log('    step ' + (i + 1) + ': pct=' + st.pct + ' layers=' + st.layersOn +
      ' rows=' + st.rowsOn + ' past=' + st.past + ' fill=' + st.fill.toFixed(0) + 'px');
    if (SHOTS) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, 'hiw-step-' + (i + 1) + '.png'), Buffer.from(shot.data, 'base64'));
    }
  }

  // THE core assertions: monotonic growth, not just a finished picture.
  const layersMono = states.every((s, i) => i === 0 || s.layersOn >= states[i - 1].layersOn);
  const layersGrew = states[5].layersOn > states[0].layersOn;
  ok(layersMono && layersGrew, 'SVG layers accumulate monotonically as you scroll',
     states.map((s) => s.layersOn).join(' -> '));
  ok(states[0].layersOn === 1 && states[5].layersOn === 6, 'exactly one layer at step 1, all six at step 6',
     states[0].layersOn + ' .. ' + states[5].layersOn);
  ok(states.every((s, i) => s.rowsOn === i + 1), 'readout lights one row per step',
     states.map((s) => s.rowsOn).join(' -> '));
  ok(states[0].pct === '17%' && states[5].pct === '100%', 'percentage runs 17% -> 100%',
     states.map((s) => s.pct).join(' '));
  ok(states.every((s, i) => i === 0 || s.fill >= states[i - 1].fill) && states[5].fill > states[0].fill,
     'spine fill grows behind the reader', states.map((s) => Math.round(s.fill)).join(' -> '));
  ok(states.every((s, i) => s.past === i && s.now === 1), 'dots: i passed + exactly one current at every step',
     states.map((s) => s.past + '/' + s.now).join(' '));
  ok(!states[3].ringClosed && states[5].ringClosed, 'reporting ring closes only at step 6',
     'step4=' + states[3].ringClosed + ' step6=' + states[5].ringClosed);
  ok(!states[2].beamOn && states[4].beamOn, 'monitoring beam lights only from step 5',
     'step3=' + states[2].beamOn + ' step5=' + states[4].beamOn);

  // Not in a card - verify by computed style, not by reading the CSS.
  const chrome_ = await cdp.eval(`(() => {
    const f = document.querySelector('.hiw-frame'), r = document.querySelector('.hiw-rig');
    const cs = getComputedStyle(f), rs = getComputedStyle(r);
    const art = getComputedStyle(document.querySelector('.hiw-art'));
    return { fBg: cs.backgroundColor, fBorder: cs.borderTopWidth, fShadow: cs.boxShadow,
             rBg: rs.backgroundColor, rBorder: rs.borderTopWidth,
             artFilter: art.filter, sticky: rs.position,
             capRule: getComputedStyle(document.querySelector('.hiw-cap')).borderBottomWidth,
             readRule: getComputedStyle(document.querySelector('.hiw-readout')).borderTopWidth };
  })()`);
  const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
  ok(transparent(chrome_.fBg) && transparent(chrome_.rBg), 'no background fill (not a card)',
     chrome_.fBg + ' / ' + chrome_.rBg);
  ok(chrome_.fBorder === '0px' && chrome_.rBorder === '0px', 'no border (not a card)',
     chrome_.fBorder + ' / ' + chrome_.rBorder);
  ok(chrome_.fShadow === 'none', 'no panel shadow — the shadow is on the drawing itself', chrome_.fShadow);
  ok(/drop-shadow/.test(chrome_.artFilter), 'cast shadow present on the drawing', chrome_.artFilter.slice(0, 40));
  ok(chrome_.capRule === '1px' && chrome_.readRule === '1px', 'exactly the two hairline rules',
     'cap ' + chrome_.capRule + ', readout ' + chrome_.readRule);
  ok(chrome_.sticky === 'sticky', 'artifact is sticky on desktop', chrome_.sticky);

  // rAF throttling: fire a burst of scroll events, count how many frames actually ran.
  // The orbit is itself a rAF loop, so a raw rAF count conflates orbit frames with handler
  // frames. Measure an identical no-scroll window first and compare the delta - that isolates
  // what the 60 scroll events actually cost.
  const throttle = await cdp.eval(`(async () => {
    const origRAF = window.requestAnimationFrame;
    const countOver = (dispatch) => new Promise((resolve) => {
      let n = 0;
      window.requestAnimationFrame = function (cb) { n++; return origRAF.call(window, cb); };
      if (dispatch) for (let i = 0; i < 60; i++) window.dispatchEvent(new Event('scroll'));
      origRAF.call(window, () => origRAF.call(window, () => {
        window.requestAnimationFrame = origRAF; resolve(n);
      }));
    });
    const baseline = await countOver(false);
    const withScroll = await countOver(true);
    return { baseline, withScroll, attributable: withScroll - baseline };
  })()`);
  ok(throttle.attributable <= 2,
     '60 scroll events cost ' + throttle.attributable + ' extra frame(s), not 60 (rAF-throttled)',
     'baseline ' + throttle.baseline + ' vs ' + throttle.withScroll + ' with scroll');

  const errs = cdp.events.filter((e) =>
    ((e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || e.method === 'Runtime.exceptionThrown') &&
    !/favicon\.ico/.test(((e.params.entry && (e.params.entry.url || e.params.entry.text)) || '')));
  ok(errs.length === 0, 'no console errors', errs.length ? JSON.stringify(errs[0]).slice(0, 130) : '0');

  // ---------------------------------------------------------------- reduced motion
  console.log('\n=== REDUCED MOTION — complete state, no animation ===');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp.send('Page.navigate', { url: URL_ });

  await sleep(2000);
  const rm = await cdp.eval(READ_STATE);
  ok(rm.layersOn === 6, 'ALL six layers shown without scrolling (not an empty baseplate)', String(rm.layersOn));
  ok(rm.rowsOn === 6, 'all six readout rows lit', String(rm.rowsOn));
  ok(rm.pct === '100%', 'percentage shows 100%', rm.pct);
  ok(rm.ringClosed, 'reporting ring drawn closed', String(rm.ringClosed));
  const rmMotion = await cdp.eval(`(() => {
    const t = getComputedStyle(document.querySelector('.hiw-lay')).transitionDuration;
    const before = document.getElementById('hiw-sat').getAttribute('cx');
    return { t, before };
  })()`);
  await sleep(900);
  const satAfter = await cdp.eval(`document.getElementById('hiw-sat').getAttribute('cx')`);
  ok(rmMotion.t === '0s', 'transitions disabled', rmMotion.t);
  ok(rmMotion.before === satAfter, 'satellite genuinely does not orbit', rmMotion.before + ' -> ' + satAfter);
  if (SHOTS) {
    // Frame the artifact, not the page top - the whole point of this shot is showing that a
    // reduced-motion reader still gets the COMPLETE assembly rather than a bare baseplate.
    await cdp.eval('document.querySelector(".hiw-rig").scrollIntoView({block:"center",behavior:"instant"})');
    await sleep(400);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'hiw-reduced-motion.png'), Buffer.from(shot.data, 'base64'));
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

  // ---------------------------------------------------------------- mobile
  for (const w of [390, 375, 320]) {
    console.log('\n=== MOBILE ' + w + 'px ===');
    cdp.events.length = 0;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(2000);
    const real = await cdp.eval('window.innerWidth');
    ok(real === w, 'viewport integrity', 'asked ' + w + ', got ' + real);
    if (real !== w) continue;

    const m = await cdp.eval(`(() => {
      const rig = document.querySelector('.hiw-rig'), lay = document.querySelector('.hiw-layout');
      const rs = getComputedStyle(rig);
      return Object.assign(${READ_STATE}, {
        position: rs.position,
        cols: getComputedStyle(lay).gridTemplateColumns.split(/\\s+/).filter(Boolean).length,
        rigW: Math.round(rig.getBoundingClientRect().width),
        bodyScroll: document.body.scrollWidth, inner: window.innerWidth
      });
    })()`);
    ok(m.cols === 1, 'collapses to one column', m.cols + ' track(s)');
    ok(m.position === 'static', 'no longer sticky', m.position);
    ok(m.rigW <= Math.min(320, w), 'constrained width, centred', m.rigW + 'px');
    ok(m.layersOn === 6 && m.rowsOn === 6 && m.pct === '100%',
       'shows the complete assembled state (reported choice: no scroll-build in one column)',
       'layers ' + m.layersOn + ', rows ' + m.rowsOn + ', ' + m.pct);
    ok(m.bodyScroll <= m.inner, 'no horizontal overflow', m.bodyScroll + ' <= ' + m.inner);
    const merr = cdp.events.filter((e) =>
      ((e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || e.method === 'Runtime.exceptionThrown') &&
      !/favicon\.ico/.test(((e.params.entry && (e.params.entry.url || e.params.entry.text)) || '')));
    ok(merr.length === 0, 'no console errors', String(merr.length));
    if (SHOTS) {
      // Scroll the artifact into frame first - a viewport shot of the page top proves nothing
      // about how the artifact itself reads at this width.
      await cdp.eval('document.querySelector(".hiw-rig").scrollIntoView({block:"center",behavior:"instant"})');
      await sleep(500);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, 'hiw-mobile-' + w + '.png'), Buffer.from(shot.data, 'base64'));
    }
  }

  await releaseTempDir(profile);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'HIW ARTIFACT: FAIL' : 'HIW ARTIFACT: PASS');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
