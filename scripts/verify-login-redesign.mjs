/**
 * verify-login-redesign.mjs — the login gate and sign-in loading screen.
 *
 * This page is a REAL authentication flow, so the redesign is only acceptable if the auth
 * behaviour is unchanged. The checks below therefore fall into two halves:
 *
 *   1. VISUAL — the split gate, the loading screen, mobile, reduced motion.
 *   2. BEHAVIOURAL — the real sign-in against the local Supabase stack, including the
 *      pending_review and rejected status gates and the generic-credential-failure message.
 *      These are driven through the ACTUAL form, not by calling functions directly.
 *
 * The status line is asserted to be driven by real stages rather than a timer: with the
 * network stalled, it must sit on "Authenticating" and NOT cycle.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.LG_PORT || 9343);
const URL_ = process.env.LG_URL || 'http://127.0.0.1:8765/login.html';
const SHOTS = process.env.LG_SHOTS || null;

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

function localCreds() {
  const raw = execSync('supabase status -o json', { cwd: process.cwd() + '/..', encoding: 'utf8' });
  const st = JSON.parse(raw.replace(/^[^{]*/, ''));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) throw new Error('non-local API_URL');
  return { url: st.API_URL, service: st.SERVICE_ROLE_KEY };
}

const TESTEMAIL = /^(login-[a-z_]+|nobody)-[0-9a-f]{8}@test[.]marketswave[.]local$/;

async function main(ctx) {
  const { url, service } = localCreds();
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'LoginRedesign-2026!';
  const made = ctx.made;
  ctx.admin = admin;

  async function makeClient(status) {
    const email = 'login-' + status.replace('_', '') + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    await admin.from('clients').insert({
      id: data.user.id, name: 'Login Redesign ' + status, email, phone: '+1-555-0199',
      account_type: 'Individual Account', status
    });
    made.push(data.user.id);
    return email;
  }

  const activeEmail = await makeClient('active');
  const pendingEmail = await makeClient('pending_review');
  const rejectedEmail = await makeClient('rejected');

  const profile = mkdtempSync(join(tmpdir(), 'mw-login-'));
  ctx.profile = profile;
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });
  ctx.chrome = chrome;

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const pg = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pg) wsUrl = pg.webSocketDebuggerUrl; else await sleep(250);
    } catch (e) { await sleep(250); }
  }
  if (!wsUrl) { chrome.kill(); throw new Error('no page target'); }
  const ws = new WebSocket(wsUrl);
  ctx.ws = ws;
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  // The auth module's listeners attach only once firebase-config.js's four static
  // gstatic.com imports resolve — measured at ~4s, and confirmed identical on clean HEAD, so
  // it is a pre-existing property of the page rather than anything this redesign introduced.
  // Submitting before then dispatches into a form with no handler and silently proves nothing,
  // so every navigation waits for the module to be live. The probe uses the forgot-password
  // listener because it is non-destructive; probing with a submit event would fire a real
  // sign-in attempt and pollute the very state under test.
  async function waitAuthReady() {
    for (let i = 0; i < 80; i++) {
      const ready = await cdp.eval(`(() => {
        const link = document.getElementById('forgot-password-link');
        const panel = document.getElementById('forgot-panel');
        if (!link || !panel) return false;
        link.click();
        const shown = panel.style.display === 'block';
        if (shown) { const b = document.getElementById('back-to-login-1'); if (b) b.click(); }
        return shown;
      })()`);
      if (ready) return true;
      await sleep(250);
    }
    return false;
  }
  const goto = async (u) => {
    await cdp.send('Page.navigate', { url: u || URL_ });
    await sleep(900);
    await waitAuthReady();
  };
  const setW = (w) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });

  // ---------------------------------------------------------------- 1. the gate, desktop
  console.log('\n=== GATE — desktop 1440 ===');
  await setW(1440); await goto();
  ok((await cdp.eval('window.innerWidth')) === 1440, 'viewport integrity', '1440');

  const g = await cdp.eval(`(() => {
    const gate = document.querySelector('.login-gate');
    const env = document.querySelector('.gate-env');
    const pane = document.querySelector('.gate-pane');
    const cv = document.getElementById('gate-canvas');
    const gs = getComputedStyle(gate);
    return {
      cols: gs.gridTemplateColumns.split(/\\s+/).filter(Boolean).length,
      envDark: getComputedStyle(env).backgroundImage.indexOf('gradient') !== -1,
      paneBg: getComputedStyle(pane).backgroundColor,
      darkGrainBlend: getComputedStyle(document.querySelector('.gate-grain-dark')).mixBlendMode,
      lightGrainBlend: getComputedStyle(document.querySelector('.gate-grain-light')).mixBlendMode,
      gridMask: getComputedStyle(document.querySelector('.gate-grid')).maskImage || getComputedStyle(document.querySelector('.gate-grid')).webkitMaskImage,
      glows: document.querySelectorAll('.gate-glow').length,
      canvasW: cv.width, canvasH: cv.height,
      // Nothing below the headline — the tail must carry no content.
      tailText: document.querySelector('.gate-tail').textContent.trim(),
      tailKids: document.querySelector('.gate-tail').children.length,
      hasFloatingLabels: document.querySelectorAll('.fld input + label').length,
      inputH: Math.round(document.querySelector('.fld input').getBoundingClientRect().height),
      inputRadius: getComputedStyle(document.querySelector('.fld input')).borderTopLeftRadius,
      backMinH: Math.round(document.getElementById('gate-back').getBoundingClientRect().height),
      bodyScroll: document.body.scrollWidth, inner: window.innerWidth
    };
  })()`);
  ok(g.cols === 2, 'split layout: two columns', g.cols + ' tracks');
  ok(g.envDark, 'left column is the dark environment');
  ok(g.darkGrainBlend === 'screen', 'dark side grain is SCREEN (row 174)', g.darkGrainBlend);
  ok(g.lightGrainBlend === 'multiply', 'cream side grain is MULTIPLY', g.lightGrainBlend);
  ok(/radial-gradient/.test(g.gridMask || ''), 'grid texture masked to fade at the edges');
  ok(g.glows === 2, 'two blurred light fields', String(g.glows));
  ok(g.canvasW > 0 && g.canvasH > 0, 'canvas sized', g.canvasW + 'x' + g.canvasH);
  ok(g.tailText === '' && g.tailKids === 0, 'area below the headline is genuinely EMPTY (no stats/ticker/badges)');
  ok(g.hasFloatingLabels === 3, 'floating-label inputs (email, password, reset-email)', String(g.hasFloatingLabels));
  ok(g.inputH === 54 && g.inputRadius === '12px', 'inputs 54px / 12px radius', g.inputH + 'px / ' + g.inputRadius);
  ok(g.backMinH >= 44, 'back control meets the 44px floor', g.backMinH + 'px');
  ok(g.bodyScroll <= g.inner, 'no horizontal overflow', g.bodyScroll + ' <= ' + g.inner);

  // canvas genuinely animating + seeded stable
  const anim = await cdp.eval(`(async () => {
    const cv = document.getElementById('gate-canvas');
    // Sample the band the curves actually occupy (y ~= .5-.7 of height). Reading the top of
    // the canvas finds only empty space and looks like a blank canvas that is drawing fine.
    const y = Math.floor(cv.height * 0.45), h = Math.max(1, Math.floor(cv.height * 0.35));
    const px = () => cv.getContext('2d').getImageData(0, y, cv.width, h).data.join(',');
    const a = px(); await new Promise(r => setTimeout(r, 700)); const b = px();
    return { moved: a !== b, painted: /[1-9]/.test(a) };
  })()`);
  ok(anim.painted, 'canvas is genuinely painted (not blank)');
  ok(anim.moved, 'curves genuinely drift over time');

  // magnetic
  const mag = await cdp.eval(`(() => {
    const b = document.getElementById('gate-submit');
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width - 4, clientY: r.top + 4, bubbles: true }));
    const t = b.style.transform;
    b.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    return { moved: /translate\\(/.test(t), reset: b.style.transform === '' };
  })()`);
  ok(mag.moved && mag.reset, 'sign-in button is magnetic and resets on leave');

  if (SHOTS) {
    const s1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'login-gate-1440.png'), Buffer.from(s1.data, 'base64'));
  }

  // ---------------------------------------------------------------- 2. real auth behaviour
  console.log('\n=== AUTH — real sign-in against the local stack ===');

  async function submit(email, pw) {
    await cdp.eval(`(() => {
      document.getElementById('email').value = ${JSON.stringify(email)};
      document.getElementById('password').value = ${JSON.stringify(pw)};
      document.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    })()`);
  }
  // Navigation-tolerant: on the success path the page redirects to the dashboard mid-poll,
  // which makes an in-flight evaluate throw. That is the expected end of the flow, not a
  // failure, so a throw here resolves to a "navigated" marker instead of killing the run.
  const state = () => cdp.eval(`(() => ({
    err: document.getElementById('login-error').classList.contains('is-visible'),
    msg: document.getElementById('login-error').textContent.trim(),
    loading: document.getElementById('loading-screen').classList.contains('is-active'),
    status: document.getElementById('loading-status').textContent.trim(),
    href: location.pathname
  }))()`).catch(() => ({ err: false, msg: '', loading: false, status: '', href: '/navigated' }));

  // wrong password -> generic message, loading screen taken back down
  await goto(); await submit(activeEmail, 'WrongPassword123!');
  for (let i = 0; i < 40; i++) { const s = await state(); if (s.err) break; await sleep(250); }
  let st = await state();
  ok(st.err && /Incorrect email or password/.test(st.msg), 'wrong password → generic message', st.msg.slice(0, 40));
  ok(!st.loading, '★ loading screen is hidden again after failure (the risk of showing it early)');

  // unknown email -> IDENTICAL message (no enumeration)
  await goto(); await submit('nobody-' + suffix + '@test.marketswave.local', password);
  for (let i = 0; i < 40; i++) { const s = await state(); if (s.err) break; await sleep(250); }
  const unknown = await state();
  ok(unknown.msg === st.msg, 'unknown email produces the IDENTICAL message (no enumeration)');
  ok(!unknown.loading, 'loading screen hidden after unknown-email failure');

  // pending_review gate
  await goto(); await submit(pendingEmail, password);
  for (let i = 0; i < 40; i++) { const s = await state(); if (s.err) break; await sleep(250); }
  const pend = await state();
  ok(pend.err && /application is under review/.test(pend.msg), 'pending_review still blocks with its own message', pend.msg.slice(0, 40));
  ok(!pend.loading, 'loading screen hidden on the pending_review gate');

  // rejected gate
  await goto(); await submit(rejectedEmail, password);
  for (let i = 0; i < 40; i++) { const s = await state(); if (s.err) break; await sleep(250); }
  const rej = await state();
  ok(rej.err && /unable to approve/.test(rej.msg), 'rejected still blocks with its own message', rej.msg.slice(0, 40));
  ok(!rej.loading, 'loading screen hidden on the rejected gate');

  // success -> loading screen with REAL stages, then redirect
  await goto(); await submit(activeEmail, password);
  let sawLoading = false, stages = [];
  for (let i = 0; i < 60; i++) {
    const s = await state();
    if (s.loading) { sawLoading = true; if (!stages.includes(s.status)) stages.push(s.status); }
    if (/dashboard/.test(s.href)) break;
    await sleep(150);
  }
  ok(sawLoading, 'successful sign-in raises the loading screen');
  ok(stages.length > 0 && stages.every((x) => ['Authenticating', 'Verifying account status', 'Opening your portal'].includes(x)),
     'status line shows only REAL stages', stages.join(' → '));
  await sleep(1200);
  const landed = await cdp.eval('location.pathname').catch(() => 'unknown');
  ok(/dashboard\.html$/.test(landed), 'redirects to the dashboard on success', landed);

  // ---------------------------------------------------------------- 3. status line is not a timer
  console.log('\n=== STATUS LINE — real stages, not a timer ===');
  await goto();
  // Block the auth endpoint so stage 1 never resolves. An honest status line stays put; a
  // timer-driven one would cycle regardless.
  await cdp.send('Network.setBlockedURLs', { urls: ['*/auth/v1/token*'] });
  await submit(activeEmail, password);
  await sleep(600);
  const s1 = await cdp.eval(`document.getElementById('loading-status').textContent.trim()`);
  await sleep(3200);
  const s2 = await cdp.eval(`document.getElementById('loading-status').textContent.trim()`);
  ok(s1 === 'Authenticating' && s2 === 'Authenticating',
     '★ with the auth call stalled the line STAYS on Authenticating — it is not on a timer', s1 + ' → ' + s2);
  await cdp.send('Network.setBlockedURLs', { urls: [] });

  // ---------------------------------------------------------------- 4. loading screen visuals
  console.log('\n=== LOADING SCREEN ===');
  await goto();
  const L = await cdp.eval(`(() => {
    const el = document.getElementById('loading-screen');
    el.classList.add('is-active');
    const ticks = document.querySelectorAll('#load-ticks i').length;
    const rings = document.querySelectorAll('.ringset .ring').length;
    const cs = getComputedStyle(document.querySelector('.ring-2'));
    return {
      visible: getComputedStyle(el).display,
      ticks, rings,
      ringAnim: cs.animationName,
      grainBlend: getComputedStyle(document.querySelector('.load-grain')).mixBlendMode,
      lockAnim: getComputedStyle(document.querySelector('.load-shackle')).animationName,
      barAnim: getComputedStyle(document.querySelector('.load-bar i')).animationName,
      monoFamily: getComputedStyle(document.getElementById('loading-status')).fontFamily
    };
  })()`);
  ok(L.visible === 'flex', 'loading screen shows when .is-active is set', L.visible);
  ok(L.ticks === 36, 'instrument dial has 36 tick marks', String(L.ticks));
  ok(L.rings === 4, 'four orbital rings', String(L.rings));
  ok(L.ringAnim === 'ringOrb', 'rings orbit', L.ringAnim);
  ok(L.lockAnim === 'lockOpen', 'lock shackle lifts on a cycle', L.lockAnim);
  ok(L.barAnim === 'barSlide', 'indeterminate progress bar animates', L.barAnim);
  ok(L.grainBlend === 'screen', 'loading grain is SCREEN (dark surface)', L.grainBlend);
  ok(/JetBrains Mono/.test(L.monoFamily), 'status line uses JetBrains Mono', L.monoFamily.split(',')[0]);
  if (SHOTS) {
    const s2b = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'login-loading-1440.png'), Buffer.from(s2b.data, 'base64'));
  }

  // ---------------------------------------------------------------- 5. reduced motion
  console.log('\n=== REDUCED MOTION — still complete, nothing moving ===');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await goto();
  const R = await cdp.eval(`(async () => {
    document.getElementById('loading-screen').classList.add('is-active');
    const cv = document.getElementById('gate-canvas');
    const y = Math.floor(cv.height * 0.45), h = Math.max(1, Math.floor(cv.height * 0.35));
    const px = () => cv.getContext('2d').getImageData(0, y, cv.width, h).data.join(',');
    // The canvas legitimately repaints ONCE around the point the loading screen is shown
    // (activating it perturbs layout enough to run the resize handler's draw). Measured
    // directly: exactly 2 distinct frames ever, then completely stable - so a two-sample
    // comparison that straddles that single repaint reports movement that is not there.
    // Take several samples and require the LATER ones to be identical, which is what "not
    // animating" actually means and cannot be fooled by one settle.
    const frames = [];
    for (let i = 0; i < 5; i++) { frames.push(px()); await new Promise(r => setTimeout(r, 500)); }
    const a = frames[1];
    const b = frames[4];
    const settled = frames.slice(1).every((f) => f === frames[1]);
    return {
      canvasPainted: /[1-9]/.test(a),
      canvasStill: settled,
      ringAnim: getComputedStyle(document.querySelector('.ring-2')).animationName,
      lockAnim: getComputedStyle(document.querySelector('.load-shackle')).animationName,
      barW: getComputedStyle(document.querySelector('.load-bar i')).width,
      barBox: document.querySelector('.load-bar').getBoundingClientRect().width,
      lockStroke: getComputedStyle(document.querySelector('.load-body')).stroke,
      glowAnim: getComputedStyle(document.querySelector('.gate-glow-1')).animationName
    };
  })()`);
  ok(R.canvasPainted, '★ canvas is still DRAWN under reduced motion (not a blank rectangle)');
  ok(R.canvasStill, 'canvas does not animate under reduced motion');
  ok(R.ringAnim === 'none' && R.lockAnim === 'none' && R.glowAnim === 'none', 'no orbit, no lock cycle, no drifting fields',
     [R.ringAnim, R.lockAnim, R.glowAnim].join('/'));
  ok(Math.abs(parseFloat(R.barW) - R.barBox) < 2, '★ progress bar shows its SETTLED full state, not an empty track',
     R.barW + ' of ' + Math.round(R.barBox) + 'px');
  ok(/79|4FD1A3|rgb\(79, 209, 163\)/.test(R.lockStroke), 'lock shown already open and green (settled state)', R.lockStroke);
  if (SHOTS) {
    const s3 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'login-reduced-motion.png'), Buffer.from(s3.data, 'base64'));
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

  // ---------------------------------------------------------------- 6. mobile
  for (const w of [390, 375, 320]) {
    console.log('\n=== MOBILE ' + w + 'px ===');
    cdp.events.length = 0;
    await setW(w); await goto();
    const real = await cdp.eval('window.innerWidth');
    ok(real === w, 'viewport integrity', 'got ' + real);
    if (real !== w) continue;
    const M = await cdp.eval(`(() => {
      const gate = document.querySelector('.login-gate');
      const env = document.querySelector('.gate-env');
      const back = document.getElementById('gate-back');
      const br = back.getBoundingClientRect();
      document.getElementById('loading-screen').classList.add('is-active');
      const ring = document.querySelector('.ringset').getBoundingClientRect();
      document.getElementById('loading-screen').classList.remove('is-active');
      return {
        cols: getComputedStyle(gate).gridTemplateColumns.split(/\\s+/).filter(Boolean).length,
        envH: Math.round(env.getBoundingClientRect().height),
        envTop: Math.round(env.getBoundingClientRect().top),
        backW: Math.round(br.width), backH: Math.round(br.height),
        backBottom: Math.round(br.bottom),
        backInBand: br.bottom <= env.getBoundingClientRect().bottom + 1,
        canvasPainted: document.getElementById('gate-canvas').width > 0,
        ringW: Math.round(ring.width),
        bodyScroll: document.body.scrollWidth, inner: window.innerWidth,
        formVisible: document.querySelector('.gate-pane .login-card').getBoundingClientRect().height > 100
      };
    })()`);
    ok(M.cols === 1, 'collapses to one column', M.cols + ' track');
    ok(M.envH >= 160 && M.envH <= 185, 'environment recedes to a ~170px band', M.envH + 'px');
    ok(M.envTop <= 1, '★ the band sits at the very top, with no gap above it', 'top ' + M.envTop);
    ok(M.canvasPainted, 'canvas still running inside the band');
    ok(M.backW >= 44 && M.backH >= 44, 'circular back button meets 44x44', M.backW + 'x' + M.backH);
    ok(M.backInBand, '★ back button sits INSIDE the environment band, not over the form',
       'back bottom ' + M.backBottom + ' <= band ' + M.envH);
    ok(M.formVisible, 'the form takes the rest of the screen');
    ok(M.ringW >= 140 && M.ringW <= 160, 'loading ring set scales to ~150px', M.ringW + 'px');
    ok(M.bodyScroll <= M.inner, 'no horizontal overflow', M.bodyScroll + ' <= ' + M.inner);
    const errs = cdp.events.filter((e) =>
      ((e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || e.method === 'Runtime.exceptionThrown') &&
      !/favicon\.ico/.test(((e.params.entry && (e.params.entry.url || e.params.entry.text)) || '')));
    ok(errs.length === 0, 'no console errors', String(errs.length));
    if (SHOTS && (w === 320 || w === 390)) {
      const sm = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, 'login-gate-' + w + '.png'), Buffer.from(sm.data, 'base64'));
    }
  }

  // ---------------------------------------------------------------- 7. forgot-password flow
  console.log('\n=== FORGOT PASSWORD — panel swap still works ===');
  await setW(1440); await goto();
  const F = await cdp.eval(`(() => {
    const card = document.querySelector('.login-card');
    const panel = document.getElementById('forgot-panel');
    document.getElementById('forgot-password-link').click();
    // Captured HERE, while the panel is genuinely open. Reading these in the returned object
    // read them AFTER the back click below and always reported 'none'.
    const panelShown = panel.style.display === 'block';
    const cardHidden = card.style.display === 'none';
    const step1 = document.querySelector('.forgot-step[data-forgot-step="1"]').classList.contains('is-active');
    document.getElementById('back-to-login-1').click();
    return { cardHidden, panelShown, step1, backWorks: panel.style.display === 'none' };
  })()`);
  ok(F.panelShown && F.step1 && F.cardHidden, 'forgot link opens the panel at step 1 and hides the sign-in card');
  ok(F.backWorks, 'back-to-login returns to the sign-in card');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'LOGIN REDESIGN: FAIL' : 'LOGIN REDESIGN: PASS');
  return fail ? 1 : 0;
}

/* Teardown runs on EVERY exit path, not just the happy one.
 *
 * These same calls used to sit at the tail of main(), which meant a failed assertion, a
 * CDP timeout or a Chrome spawn failure skipped cleanup entirely and left a full set of
 * test clients behind - two such runs are what leaked six of them. Three things changed:
 * it lives in a finally, a failed delete is reported rather than swallowed by
 * .catch(() => {}), and it sweeps by email shape so residue from an older crashed run is
 * collected too instead of waiting for someone to notice it. Note that main() must not
 * call process.exit() any more: exiting from inside the try is what would skip a finally.
 */
async function cleanup(ctx) {
  if (ctx.ws) { try { ctx.ws.close(); } catch (e) {} }
  if (ctx.chrome) { try { ctx.chrome.kill(); } catch (e) {} }
  if (ctx.profile) { try { rmSync(ctx.profile, { recursive: true, force: true }); } catch (e) {} }
  if (!ctx.admin) return;

  const ids = new Set(ctx.made);
  // listUsers is paged, so walk it rather than trusting that page one holds everything.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await ctx.admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error('CLEANUP: listUsers failed: ' + error.message); ctx.leaked = true; break; }
    const users = (data && data.users) || [];
    for (const u of users) {
      if (TESTEMAIL.test(u.email || '')) ids.add(u.id);
    }
    if (users.length < 200) break;
  }

  for (const id of ids) {
    const { error } = await ctx.admin.auth.admin.deleteUser(id);
    if (error) { console.error('CLEANUP: could not delete ' + id + ': ' + error.message); ctx.leaked = true; }
  }

  // Confirm rather than assume - a teardown that quietly did nothing is the actual bug.
  const { count, error: cErr } = await ctx.admin
    .from('clients').select('id', { count: 'exact', head: true })
    .like('email', 'login-%@test.marketswave.local');
  if (cErr) { console.error('CLEANUP: residue check failed: ' + cErr.message); ctx.leaked = true; }
  else if (count) { console.error('CLEANUP: ' + count + ' test client rows still present'); ctx.leaked = true; }
  else if (ids.size) console.log('cleanup: removed ' + ids.size + ' test account(s), none remaining');
}

const ctx = { admin: null, made: [], chrome: null, ws: null, profile: null, leaked: false };
let code = 1;
main(ctx)
  .then((c) => { code = c; })
  .catch((e) => { console.error('ERROR:', e.message); code = 1; })
  .finally(async () => {
    await cleanup(ctx).catch((e) => { console.error('CLEANUP: ' + e.message); ctx.leaked = true; });
    if (ctx.leaked) console.error('LOGIN REDESIGN: teardown left test data behind');
    process.exit(ctx.leaked ? 1 : code);
  });
