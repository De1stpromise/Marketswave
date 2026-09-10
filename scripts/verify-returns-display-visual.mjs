// verify-returns-display-visual.mjs — Returns Display (2026-09-09), real-browser pass.
//
// jsdom has no layout and no paint, so the things that can only be checked in a real browser
// live here: composited contrast on every new coloured figure, and the narrow-viewport
// behaviour of a table that just gained three columns.
//
// Contrast itself is measured by verify-contrast.mjs — this script seeds a real portfolio,
// obtains a real session, and drives that tool against both pages via its CONTRAST_PROFILE /
// CONTRAST_BOOTSTRAP_JS hooks, rather than reimplementing the sampling.
//
// BOTH TONES ARE MEASURED. The seeded portfolio deliberately contains a winner AND a genuine
// loser, so the red state is measured for real rather than assumed to behave like the green
// one. A returns display that has only ever been measured green is only half measured.
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.RETURNS_VISUAL_PORT || 9344);
const BASE = process.env.RETURNS_BASE_URL || 'http://127.0.0.1:8765';

let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail !== undefined ? '  [' + detail + ']' : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.replace(/^[^{]*/, ''));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('non-local API_URL');
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY, anonKey: status.ANON_KEY };
}

// ---- minimal CDP client (same shape verify-contrast.mjs uses) ------------------------------
async function connect() {
  const profile = mkdtempSync(join(tmpdir(), 'mw-returns-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(300);
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const tabs = await r.json();
      const page = tabs.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
  }
  if (!wsUrl) throw new Error('Chrome did not expose a debug target');
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable');
  return { send, evaluate, close: () => { ws.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch (e) {} } };
}

async function main() {
  console.log('Returns Display — real-browser visual pass\n');
  const { url, serviceRoleKey, anonKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const suffix = crypto.randomBytes(4).toString('hex');
  const PASSWORD = 'ReturnsVisual-2026!';
  const email = 'returnsvis-' + suffix + '@test.marketswave.local';
  let clientId = null;
  let cdp = null;

  try {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (cErr) throw new Error('createUser: ' + cErr.message);
    clientId = created.user.id;
    await admin.from('clients').insert({
      id: clientId, name: 'Returns Visual ' + suffix, email, phone: '+1-555-0188',
      account_type: 'Individual Account', status: 'active'
    });

    const { data: prods } = await admin.from('products').select('*');
    const byId = Object.fromEntries(prods.map((p) => [p.id, p]));
    // A winner and a GENUINE loser, so both tones are on screen to be measured.
    await admin.from('account_state').insert({
      client_id: clientId, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 3400
    });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0001', units: 500, cost_basis: 50000 });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0003', units: 300, cost_basis: 30000 });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0004', units: 200, cost_basis: 40000 });
    await admin.from('transactions').insert({
      client_id: clientId, product_id: 'PROD-0003', type: 'SELL', units: 10,
      price: byId['PROD-0003'].unit_price, total_value: 1000, realized_return: 3400, status: 'completed'
    });

    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error('signIn: ' + sErr.message);

    // The SDK's default storageKey is derived from the project URL's own first hostname
    // label. A wrong key here cannot produce a false pass: the page would bounce to
    // login.html and the contrast run would report zero measurements, which it treats as a
    // hard failure rather than a clean sheet.
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const bootstrap = [
      'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');',
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');',
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + ');',
      'true'
    ].join('');

    // ===================================================================================
    console.log('\n=== CONTRAST — every new coloured figure, real composited pixels ===\n');
    for (const [profile, page] of [['returns-dashboard', 'dashboard.html'], ['returns-holdings', 'asset-performance.html']]) {
      const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
          CONTRAST_PROFILE: profile,
          CONTRAST_URL: BASE + '/' + page,
          CONTRAST_BOOTSTRAP_JS: bootstrap,
          CONTRAST_SETTLE_MS: '15000',
          CONTRAST_PORT: String(PORT + 10)
        })
      });
      const out = res.stdout || '';
      const tail = out.trim().split('\n').slice(-2).join(' | ');
      const m = out.match(/(\d+) measurements, (\d+) below/);
      console.log('  ' + page + ' -> ' + tail);
      check(page + ': contrast measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
      check(page + ': every measured figure clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
      // Print any failing lines so a regression names itself.
      out.split('\n').filter((l) => /FAIL\s+\d/.test(l)).forEach((l) => console.log('      ' + l.trim()));
    }

    // ===================================================================================
    console.log('\n=== MOBILE — the table gained three columns ===\n');
    cdp = await connect();
    for (const width of [1440, 390, 375, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
      if (width === 1440) {
        await cdp.send('Page.navigate', { url: BASE + '/' });
        await sleep(600);
        await cdp.evaluate(bootstrap);
      }
      await cdp.send('Page.navigate', { url: BASE + '/asset-performance.html' });
      // Poll for the real render rather than sleeping a fixed amount: the FIRST navigation
      // of a run is much slower than later ones (cold module fetch + a real settle pass), and
      // a fixed wait that happens to suit the warm case reads the skeleton on the cold one.
      // Wait for the DERIVED data-labels too, not just the rendered rows:
      // responsive-tables.js applies them from a DEBOUNCED MutationObserver that fires after
      // the render, so checking the instant the tfoot appears races it. That race is real but
      // harness-only — it showed up at one width and not the two narrower ones purely on
      // timing, which is exactly the shape of a flaky assertion rather than a real bug.
      for (let i = 0; i < 60; i++) {
        const done = await cdp.evaluate(
          "(() => { const f = document.querySelector('#return-table-foot tr');" +
          " const c = document.querySelector('#return-table-body tr td:nth-child(2)');" +
          " return !!f && !!c && c.hasAttribute('data-label'); })()"
        );
        if (done) break;
        await sleep(500);
      }

      const real = await cdp.evaluate('window.innerWidth');
      // Viewport-integrity guard — this project has had a run report a clean PASS while the
      // browser was silently clamped to a different width.
      check('viewport is genuinely ' + width + 'px', real === width, 'got ' + real);
      if (real !== width) continue;

      const r = await cdp.evaluate(`(() => {
        const t = document.querySelector('table.rt');
        const rows = document.querySelectorAll('#return-table-body tr');
        const trendTh = [...document.querySelectorAll('.rt th')].find(x => x.textContent.trim() === 'Trend');
        const foot = document.querySelector('#return-table-foot tr');
        return {
          rendered: !!foot && rows.length > 0,
          bodyScrollW: document.body.scrollWidth,
          innerW: window.innerWidth,
          trendDisplay: trendTh ? getComputedStyle(trendTh).display : 'missing',
          rowDisplay: rows.length ? getComputedStyle(rows[0]).display : 'none',
          firstCellLabel: rows.length ? (getComputedStyle(rows[0].children[1], '::before').content || '') : '',
          legendVisible: !!document.querySelector('.rt-legend') && getComputedStyle(document.querySelector('.rt-legend')).display !== 'none',
          footLabelled: foot ? [...foot.children].every(td => td.hasAttribute('data-label')) : false
        };
      })()`);

      check(width + 'px: the real table rendered', r.rendered, JSON.stringify(r));
      check(width + 'px: no horizontal page overflow', r.bodyScrollW <= r.innerW + 1, r.bodyScrollW + ' vs ' + r.innerW);
      check(width + 'px: legend stays visible', r.legendVisible);
      if (width >= 1024) {
        check(width + 'px: Trend column is shown on desktop', r.trendDisplay !== 'none', r.trendDisplay);
        check(width + 'px: rows stay real table rows on desktop', r.rowDisplay === 'table-row', r.rowDisplay);
      } else {
        check(width + 'px: Trend column is hidden rather than squeezing the figures', r.trendDisplay === 'none', r.trendDisplay);
        check(width + 'px: rows switch to the card layout from the mobile batches', r.rowDisplay === 'block', r.rowDisplay);
        check(width + 'px: cells still name their column in card mode', /Units/.test(r.firstCellLabel), r.firstCellLabel);
        check(width + 'px: the totals row keeps its labels too', r.footLabelled);
      }
    }

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log(fail ? 'RETURNS DISPLAY VISUAL: FAIL' : 'RETURNS DISPLAY VISUAL: PASS');
    if (fail) process.exit(1);
  } finally {
    if (cdp) cdp.close();
    if (clientId) {
      await admin.from('transactions').delete().eq('client_id', clientId);
      await admin.from('holdings').delete().eq('client_id', clientId);
      await admin.from('account_state').delete().eq('client_id', clientId);
      await admin.from('clients').delete().eq('id', clientId);
      const { error } = await admin.auth.admin.deleteUser(clientId);
      if (error) console.error('CLEANUP: could not delete ' + clientId + ': ' + error.message);
      else console.log('cleanup: test account removed');
    }
  }
}

// Two full Chrome spawns for contrast plus four real viewport navigations —
// legitimately longer than the shared 90s default.
runVerifyMain(main, { watchdogMs: 900000 });
