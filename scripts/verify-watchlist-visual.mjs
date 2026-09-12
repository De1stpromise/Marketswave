#!/usr/bin/env node
// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — visual verification.
//
// Contrast on every new text surface (both badge styles included, measured separately —
// they are two genuinely different colour stacks), the font audit on the touched page, and
// the narrow-viewport behaviour the card genuinely changes: it gained a scrolling list and
// inline row actions, which is exactly the shape that overflows at 320px if it is wrong.
//
// Real headless Chrome over CDP, this project's own established substitute when no browser
// automation tool is available. Every measurement sits behind a viewport-integrity guard —
// Batch 1's first run reported a clean PASS "at 375px" while the browser had silently
// clamped to 492px, and 320px still needs a real same-origin iframe because the top-level
// override floors at 348px on this build.
//
// Requires: the local Supabase stack, `supabase functions serve`, and a static server on
// http://127.0.0.1:8765 serving the project root.

import { execSync, spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WL_BASE || 'http://127.0.0.1:8765';
const PORT = Number(process.env.WL_PORT || 9478);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PASSWORD = 'VerifyWatchlistVisual-2026!';

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  // Row 172's lesson: a stale cached copy of a just-edited file reported a correct batch as
  // broken. Never measure through the cache.
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  return { send, evaluate, close: () => releaseTempDir(profile) };
}

async function main() {
  console.log('Merged Market Snapshot + Watchlist — visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'wlvis-' + suffix + '@test.marketswave.local';

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (cErr) throw new Error('createUser: ' + cErr.message);
  const clientId = created.user.id;
  await admin.from('clients').insert({
    id: clientId, name: 'Watchlist Visual Verify', email: 'wlvis-verify-' + clientId,
    phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
  });
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 });

  let cdp = null;
  try {
    // Seed the watchlist directly so BOTH badge styles and BOTH change directions are
    // genuinely on screen — a real market that happens to be all-green on the day would
    // otherwise leave .wl-dn unmeasured and the run would pass on an absence.
    await admin.from('watchlist_symbols').insert([
      { client_id: clientId, symbol: 'ETH', name: 'Ethereum', source: 'coingecko', provider_id: 'ethereum', asset_type: 'crypto' },
      { client_id: clientId, symbol: 'SPY', name: 'S&P 500 ETF', source: 'finnhub', provider_id: null, asset_type: 'stock' },
      { client_id: clientId, symbol: 'BTC', name: 'Bitcoin', source: 'coingecko', provider_id: 'bitcoin', asset_type: 'crypto' },
      { client_id: clientId, symbol: 'QQQ', name: 'Nasdaq 100 ETF', source: 'finnhub', provider_id: null, asset_type: 'stock' }
    ]);
    await admin.from('clients').update({ watchlist_seeded_at: new Date().toISOString() }).eq('id', clientId);
    // Force one row genuinely negative and one genuinely positive in the cache, so both
    // tones are painted. These are real cache rows, overwritten by the next scheduled
    // refresh — nothing about the feature depends on them staying this way.
    await admin.from('market_data_cache').update({ change_percent: -1.24 }).eq('symbol', 'SPY');
    await admin.from('market_data_cache').update({ change_percent: 2.41 }).eq('symbol', 'BTC');

    const alertRow = (await admin.from('watchlist_symbols').select('id').eq('client_id', clientId).eq('symbol', 'BTC').single()).data;
    await admin.from('price_alerts').insert({
      client_id: clientId, watchlist_symbol_id: alertRow.id, symbol: 'BTC',
      direction: 'above', target_price: 999999, status: 'active'
    });

    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error('signIn: ' + sErr.message);
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const bootstrap = [
      'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');',
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');',
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + ');',
      'true'
    ].join('');

    // Opens the add panel (so .wl-src is painted) and the alert modal (so its own two text
    // surfaces are). Without this most of the profile is display:none and the run would
    // report a confident pass over nothing.
    // Opens the add panel so .wl-src is genuinely painted. It deliberately does NOT open
    // the alert modal: that covers the page with a blurred scrim, and every row behind it
    // would then be sampled THROUGH the scrim — which is exactly how the first run of this
    // reported .wl-name at 3.6:1 on a mid-grey ground. The modal is measured in its own run.
    const prepareCard = [
      '(() => {',
      '  const t = document.getElementById("wl-add-toggle"); if (t && document.getElementById("wl-addpanel").hidden) t.click();',
      '  const r = document.getElementById("wl-results");',
      '  if (r) r.innerHTML = \'<button type=\\"button\\" class=\\"wl-res\\"><span class=\\"wl-tag\\">ETH</span><span class=\\"wl-name\\">Ethereum</span><span class=\\"wl-src\\">Crypto</span></button>\';',
      '  return true;',
      '})()'
    ].join('');

    const prepareModal = [
      '(() => {',
      '  const bell = document.querySelector("[data-wl-bell]"); if (bell) bell.click();',
      '  const err = document.getElementById("wl-alert-error");',
      '  if (err) { err.textContent = "Enter a target price greater than zero."; err.hidden = false; }',
      '  return true;',
      '})()'
    ].join('');

    // ===================================================================================
    console.log('=== CONTRAST — every new text surface, real composited pixels ===\n');
    // ===================================================================================
    function runContrast(profile, prepare, label) {
      const r = spawnSync(process.execPath, ['verify-contrast.mjs'], {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
          CONTRAST_PROFILE: profile,
          CONTRAST_URL: BASE + '/dashboard.html',
          CONTRAST_BOOTSTRAP_JS: bootstrap,
          CONTRAST_PREPARE_JS: prepare,
          CONTRAST_SETTLE_MS: '18000',
          CONTRAST_PORT: String(PORT + 10)
        })
      });
      forwardChildTeardown(r, 'verify-contrast');
      const o = r.stdout || '';
      const m = o.match(/(\d+) measurements, (\d+) below/);
      console.log('  ' + label + ' -> ' + o.trim().split('\n').slice(-2).join(' | '));
      check(label + ': contrast measured real elements (not an empty run)', !!m && Number(m[1]) > 0, o.slice(-400));
      check(label + ': every measured figure clears 4.5:1', /CONTRAST: PASS/.test(o), o.slice(-400));
      o.split('\n').filter((l) => /FAIL\s+\d/.test(l)).forEach((l) => console.log('      ' + l.trim()));
      return o;
    }

    const out = runContrast('watchlist', prepareCard, 'the card');
    runContrast('watchlist-modal', prepareModal, 'the alert modal');

    // Both badge styles are two genuinely different colour stacks; neither may be skipped.
    check('the Offered badge was genuinely measured', /badge Offered/.test(out));
    check('the Tracking only badge was genuinely measured separately', /badge Tracking only/.test(out));
    check('both change directions were measured (a green-only market would hide the loss tone)',
      /row change \(gain\)/.test(out) && /row change \(loss\)/.test(out));

    // ===================================================================================
    console.log('\n=== FONTS — the touched page, by real advance width ===\n');
    // ===================================================================================
    const fontRes = spawnSync(process.execPath, ['audit-fonts.mjs'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        AUDIT_URL: BASE + '/dashboard.html',
        AUDIT_BOOTSTRAP_JS: bootstrap,
        AUDIT_PORT: String(PORT + 20)
      })
    });
    forwardChildTeardown(fontRes, 'audit-fonts');
    const fontOut = fontRes.stdout || '';
    console.log(fontOut.trim().split('\n').slice(-6).join('\n'));
    check('no family on the touched page falls back', !/FALLBACK/.test(fontOut), fontOut.slice(-400));
    check('the new card introduces no second family — Inter only',
      !/JetBrains|monospace/i.test(fontOut), fontOut.slice(-400));

    // ===================================================================================
    console.log('\n=== MOBILE — the card gained a scrolling list and inline row actions ===\n');
    // ===================================================================================
    cdp = await connectChrome();
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(900);
    await cdp.evaluate(bootstrap);

    for (const width of [1440, 390, 375]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
      await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
      let ready = false;
      for (let i = 0; i < 80 && !ready; i++) {
        await sleep(400);
        ready = await cdp.evaluate('!!document.querySelector("#wl-rows .wl-row")');
      }
      // VIEWPORT-INTEGRITY GUARD. A silently clamped viewport reports a clean pass over a
      // width that was never tested.
      const real = await cdp.evaluate('window.innerWidth');
      check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);

      const geom = await cdp.evaluate(
        '(() => { const card = document.getElementById("watchlist-card"); const rows = document.getElementById("wl-rows");' +
        ' return { rendered: !!rows.querySelector(".wl-row"), bodyScroll: document.body.scrollWidth, inner: window.innerWidth,' +
        '   cardRight: Math.round(card.getBoundingClientRect().right), overflowY: getComputedStyle(rows).overflowY,' +
        '   maxRowRight: Math.max.apply(null, [...rows.querySelectorAll(".wl-row")].map(r => Math.round(r.getBoundingClientRect().right))) };})()'
      );
      check(width + 'px: the card genuinely rendered real rows', geom.rendered, JSON.stringify(geom));
      check(width + 'px: no horizontal overflow on the page', geom.bodyScroll <= geom.inner + 1, JSON.stringify(geom));
      check(width + 'px: no row escapes the card', geom.maxRowRight <= geom.cardRight + 1, JSON.stringify(geom));
      check(width + 'px: the list scrolls rather than growing without limit', geom.overflowY === 'auto', geom.overflowY);

      // Row 171's floor still holds on the card's own controls.
      if (width < 1024) {
        const small = await cdp.evaluate(
          '(() => { const bad = []; document.querySelectorAll("#watchlist-card button, #watchlist-card a.mw-btn, #watchlist-card input")' +
          '.forEach(el => { const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;' +
          ' if (r.width < 44 || r.height < 44) bad.push(el.className + " " + Math.round(r.width) + "x" + Math.round(r.height)); });' +
          ' return bad; })()'
        );
        check(width + 'px: every control on the card is at least 44x44', small.length === 0, JSON.stringify(small));
      }
    }

    // 320px through a real same-origin iframe — the top-level override floors at 348 here.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
    await sleep(2500);
    const narrow = await cdp.evaluate(
      '(async () => {' +
      '  const f = document.createElement("iframe");' +
      '  f.style.cssText = "width:320px;height:800px;border:0;position:fixed;left:0;top:0;z-index:99999";' +
      '  f.src = "/dashboard.html";' +
      '  document.body.appendChild(f);' +
      '  for (let i = 0; i < 120; i++) {' +
      '    await new Promise(r => setTimeout(r, 400));' +
      '    const d = f.contentDocument;' +
      '    if (d && d.querySelector("#wl-rows .wl-row")) {' +
      '      const card = d.getElementById("watchlist-card");' +
      '      const rows = [...d.querySelectorAll("#wl-rows .wl-row")];' +
      '      return { inner: f.contentWindow.innerWidth, bodyScroll: d.body.scrollWidth,' +
      '        cardRight: Math.round(card.getBoundingClientRect().right),' +
      '        maxRowRight: Math.max.apply(null, rows.map(r => Math.round(r.getBoundingClientRect().right))),' +
      '        rows: rows.length };' +
      '    }' +
      '  }' +
      '  return { timedOut: true };' +
      '})()'
    );
    check('320px: the iframe genuinely reports 320px (real narrow viewport, not a clamped one)',
      narrow.inner === 320, JSON.stringify(narrow));
    check('320px: the card genuinely rendered real rows', narrow.rows > 0, JSON.stringify(narrow));
    check('320px: no horizontal overflow', narrow.bodyScroll <= narrow.inner + 1, JSON.stringify(narrow));
    check('320px: no row escapes the card', narrow.maxRowRight <= narrow.cardRight + 1, JSON.stringify(narrow));
  } finally {
    if (cdp) await cdp.close();
    await admin.from('price_alerts').delete().eq('client_id', clientId);
    await admin.from('watchlist_symbols').delete().eq('client_id', clientId);
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
