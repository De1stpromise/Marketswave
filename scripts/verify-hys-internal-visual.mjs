#!/usr/bin/env node
// ★ Savings deposit from unallocated capital (2026-09-11) — visual verification.
//
// Contrast on every genuinely new text surface, a font audit (Inter only — the type scheme
// has one family, see row 192), and the narrow viewports this project has standardised on.
// Seeds a real client with real unallocated capital and a real pending internal transfer,
// then drives verify-contrast.mjs / audit-fonts.mjs against the real pages via their own
// CONTRAST_PROFILE / CONTRAST_BOOTSTRAP_JS / CONTRAST_PREPARE_JS hooks rather than
// reimplementing the sampling — the same delegation verify-returns-display-visual.mjs uses.
//
// ★ CONTRAST_PREPARE_JS is load-bearing here, not a convenience: the internal funding step
// does not exist in the DOM until a client has actually walked the modal to it, so without a
// prepare step the run would sample nothing and report a confident zero.
//
// Every measurement sits behind a viewport-integrity guard, and 320px goes through a real
// same-origin iframe because the top-level override floors at 348px on this build (Batch 1's
// own finding, reused rather than rediscovered).
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'VerifyHysInternalVisual-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9444;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

// Drives the real modal to the internal funding step. Waits for the page's own async load to
// settle first — clicking before the real balance has arrived would sample a $0.00 placeholder
// and measure a state no client ever sees.
const PREPARE_CLIENT = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 180; i++) {
    const grid = document.getElementById('pockets-grid');
    if (grid && !/animate-pulse/.test(grid.innerHTML)) break;
    await sleep(250);
  }
  document.getElementById('open-new-pocket-btn').click();
  document.querySelector('.np-type-card[data-type="ayw"]').click();
  document.getElementById('np-ayw-amount').value = '12000';
  document.getElementById('np-ayw-continue').click();
  document.querySelector('.np-funding-card[data-method="internal"]').click();
  await sleep(400);
  return true;
})()`;


const GEOM_EXPR = `(() => {
  const step = document.querySelector('[data-step="funding-internal"]');
  const cards = [...document.querySelectorAll('.np-funding-card')];
  const btn = document.getElementById('np-internal-confirm').getBoundingClientRect();
  return {
    visible: !!step && !step.classList.contains('hidden'),
    available: (document.getElementById('np-internal-available') || {}).textContent,
    bodyScroll: document.body.scrollWidth,
    inner: window.innerWidth,
    maxCardRight: Math.max(...cards.map(c => c.getBoundingClientRect().right)),
    confirmH: Math.round(btn.height)
  };
})()`;

const NARROW_EXPR = `(async () => {
  const nap0 = (ms) => new Promise(r => setTimeout(r, ms));
  // The host page may still be parsing when this runs, and document.body is null until it is
  // not — appending to null throws in a way that reads like a broken test rather than a race.
  for (let i = 0; i < 80 && !document.body; i++) await nap0(100);
  const f = document.createElement('iframe');
  f.style.cssText = 'width:320px;height:900px;border:0';
  f.src = '/high-yield-savings.html';
  document.body.appendChild(f);
  await new Promise(r => f.addEventListener('load', r));
  const d = f.contentDocument, w = f.contentWindow;
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) {
    const g = d.getElementById('pockets-grid');
    if (g && !/animate-pulse/.test(g.innerHTML)) break;
    await nap(250);
  }
  d.getElementById('open-new-pocket-btn').click();
  d.querySelector('.np-type-card[data-type="ayw"]').click();
  d.getElementById('np-ayw-amount').value = '12000';
  d.getElementById('np-ayw-continue').click();
  d.querySelector('.np-funding-card[data-method="internal"]').click();
  await nap(400);
  const step = d.querySelector('[data-step="funding-internal"]');
  return {
    reported: d.documentElement.clientWidth,
    visible: !!step && !step.classList.contains('hidden'),
    bodyScroll: d.body.scrollWidth,
    inner: w.innerWidth
  };
})()`;

function runContrast(profile, page, label, bootstrap, prepare) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      CONTRAST_PROFILE: profile,
      CONTRAST_URL: BASE + '/' + page,
      CONTRAST_BOOTSTRAP_JS: bootstrap,
      CONTRAST_PREPARE_JS: prepare,
      CONTRAST_SETTLE_MS: '25000',
      CONTRAST_PORT: '9333'
    })
  });
  forwardChildTeardown(res, 'verify-contrast');
  const out = (res.stdout || '') + (res.stderr || '');
  const tail = out.trim().split('\n').slice(-2).join(' | ');
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + tail);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  out.split('\n').filter((l) => /FAIL\s+\d/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}

function runFonts(page, label, bootstrap) {
  const res = spawnSync(process.execPath, ['audit-fonts.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      AUDIT_URL: BASE + '/' + page,
      AUDIT_BOOTSTRAP_JS: bootstrap
    })
  });
  forwardChildTeardown(res, 'audit-fonts');
  const out = (res.stdout || '') + (res.stderr || '');
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back (every requested family genuinely loads)',
    !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family anywhere — the scheme is Inter (row 192)',
    !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}

async function connectChrome() {
  const profile = makeTempDir('mw-wlvis-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions',
    '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250);
    } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + String((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300));
    if (m.method === 'Network.loadingFailed') errors.push('NETFAIL ' + m.params.requestId + ' ' + m.params.errorText);
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
  // Row 172's lesson: a stale cached copy of a just-edited file reported a correct batch as
  // broken. Never measure through the cache.
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  return { send, evaluate, errors, close: () => releaseTempDir(profile) };
}

async function main() {
  console.log('Savings deposit from unallocated capital — visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'hysvis-' + suffix + '@test.marketswave.local';

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;

  try {
    await admin.from('clients').insert({
      id: clientId, name: 'HYS Visual', email: 'hysvis-verify-' + clientId,
      phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
    });
    await admin.from('account_state').insert({
      client_id: clientId, unallocated_capital: 45000, allocated_capital: 0, asset_returns: 0
    });
    // A real pending INTERNAL request so the admin queue has one to render and measure.
    await admin.from('hys_deposit_requests').insert({
      client_id: clientId, pocket_type: 'ayw', requested_amount: 12000,
      method: 'internal', currency: 'USD', details: null, status: 'pending', term_in_years: 0
    });

    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error('signIn: ' + sErr.message);

    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const clientBootstrap = [
      'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');',
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');',
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + ');',
      'true'
    ].join('');

    const adminSigned = await anon.auth.signInWithPassword({
      email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!'
    });
    if (adminSigned.error) throw new Error('admin signIn: ' + adminSigned.error.message);
    // admin-supabase-config.js uses its own explicit storageKey (Admin Auth Consolidation,
    // row 134) precisely so the two personas cannot clobber each other — so the admin page's
    // session goes under that key, not the client's.
    const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' +
      JSON.stringify(JSON.stringify(adminSigned.data.session)) + '); true';

    console.log('\n=== CONTRAST — real composited pixels on every new surface ===\n');
    runContrast('hys-internal', 'high-yield-savings.html', 'client funding step', clientBootstrap, PREPARE_CLIENT);
    runContrast('hys-internal-admin', 'admin-hys.html', 'admin queue', adminBootstrap, '');

    console.log('\n=== FONTS — Inter only ===\n');
    runFonts('high-yield-savings.html', 'high-yield-savings.html', clientBootstrap);
    runFonts('admin-hys.html', 'admin-hys.html', adminBootstrap);

    console.log('\n=== MOBILE — 1440/390/375/320 ===\n');
    const cdp = await connectChrome();
    try {
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(600);
      await cdp.evaluate(clientBootstrap);

      // ★ One throwaway warm-up load before any measurement, for the same reason the full-suite
      // warm-up convention exists (CLAUDE.md, 2026-09-09): `supabase functions serve` compiles
      // each Edge Function on its FIRST invocation, so the first page load pays that cost and
      // its own data never arrives inside a fixed wait. Measuring it produced a real-looking
      // failure at 1440px — a page that had simply not finished loading — while 390/375 passed
      // purely because they came second and third. Discarding one load is the honest fix; a
      // longer timeout would only have hidden which load was cold.
      await cdp.send('Page.navigate', { url: BASE + '/high-yield-savings.html' });
      await cdp.evaluate('(async()=>{for(let i=0;i<160;i++){const g=document.getElementById("pockets-grid");if(g&&!/animate-pulse/.test(g.innerHTML))return true;await new Promise(r=>setTimeout(r,250));}return false;})()');

      for (const width of [1440, 390, 375]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
        await cdp.send('Page.navigate', { url: BASE + '/high-yield-savings.html' });
        await sleep(3500);
        // Viewport-integrity guard (Batch 1): a run that silently measures a clamped viewport
        // reports a confident PASS on something that was never actually tested.
        // The FIRST navigation of the run is a cold load (module fetch + auth + the page's own
        // Edge Function calls), so it is given a real settle rather than the same fixed wait as
        // the warm ones that follow — otherwise the prepare step clicks into a page that has not
        // finished loading and measures a state no client ever sees.
        await cdp.evaluate('(async()=>{for(let i=0;i<120;i++){const g=document.getElementById("pockets-grid");if(g&&!/animate-pulse/.test(g.innerHTML)&&document.querySelectorAll(".np-funding-card").length===3)return true;await new Promise(r=>setTimeout(r,250));}return false;})()');
        const real = await cdp.evaluate('document.documentElement.clientWidth');
        check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);
        await cdp.evaluate(PREPARE_CLIENT);
        const geom = await cdp.evaluate(GEOM_EXPR);
        if (geom.visible !== true) {
          const diag = await cdp.evaluate('JSON.stringify({url:location.pathname,grid:(document.getElementById("pockets-grid")||{}).innerHTML.slice(0,120),cards:document.querySelectorAll(".np-funding-card").length,net:performance.getEntriesByType("resource").filter(function(r){return r.name.indexOf("/v1/")!==-1;}).map(function(r){return [r.name.slice(r.name.indexOf("/v1/")+4).split("?")[0].slice(0,40),Math.round(r.duration),r.responseStatus];})})');
          console.log('      DIAG ' + width + 'px: ' + diag);
          console.log('      DIAG errors: ' + JSON.stringify(cdp.errors.slice(-12)));
          console.log('      DIAG resources: ' + await cdp.evaluate('JSON.stringify(performance.getEntriesByType("resource").map(function(r){var n=r.name; var k=n.indexOf("//"); n=k>=0?n.slice(n.indexOf("/",k+2)):n; return n.slice(0,50)+":"+Math.round(r.duration)+":"+r.responseStatus;}))') + ' readyState=' + await cdp.evaluate('document.readyState') + ' scripts=' + await cdp.evaluate('document.scripts.length') + ' hasData=' + await cdp.evaluate('typeof window.MarketswaveData'));
        }
        check(width + 'px: the internal funding step genuinely rendered', geom.visible === true, JSON.stringify(geom));
        check(width + 'px: the real balance is shown, not a placeholder', geom.available === '$45,000.00', geom.available);
        check(width + 'px: no horizontal overflow on the page', geom.bodyScroll <= geom.inner + 1, JSON.stringify(geom));
        check(width + 'px: no funding card escapes the viewport', geom.maxCardRight <= geom.inner + 1, JSON.stringify(geom));
        if (width < 1024) {
          check(width + 'px: the confirm control still meets the 44px floor', geom.confirmH >= 44, String(geom.confirmH));
        }
      }

      // 320px through a real same-origin iframe — the top-level override floors at 348 here.
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Page.navigate', { url: BASE + '/high-yield-savings.html' });
      await sleep(2500);
      const narrow = await cdp.evaluate(NARROW_EXPR);
      check('320px: the iframe genuinely reports 320px (a real narrow viewport, not a clamped one)',
        narrow.reported === 320, JSON.stringify(narrow));
      check('320px: the internal funding step still renders', narrow.visible === true, JSON.stringify(narrow));
      check('320px: no horizontal overflow', narrow.bodyScroll <= narrow.inner + 1, JSON.stringify(narrow));
    } finally {
      await cdp.close();
    }

  } finally {
    await admin.from('hys_deposit_requests').delete().eq('client_id', clientId);
    await admin.from('hys_pockets').delete().eq('client_id', clientId);
    await admin.from('transactions').delete().eq('client_id', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    await admin.auth.admin.deleteUser(clientId);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err && err.stack);
  process.exit(1);
});
