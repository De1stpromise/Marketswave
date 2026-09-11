#!/usr/bin/env node
// ★ Crypto deposit routing (2026-09-11) — visual verification.
//
// Contrast on every new text surface (the client address card + pending card + empty
// state, the PM address book, the queue's amount-less row), a font audit (Inter only, row
// 192), and the narrow viewports this project standardises on. Delegates the sampling to
// verify-contrast.mjs / audit-fonts.mjs via their own CONTRAST_PROFILE /
// CONTRAST_BOOTSTRAP_JS / CONTRAST_PREPARE_JS hooks — the same delegation
// verify-hys-internal-visual.mjs uses.
//
// ★ THE ADDRESS CARD IS THE BREAK-PRONE ELEMENT: a 42–62 character case-sensitive string
// with no natural break points. Every viewport measures the address VALUE's own right edge
// against its card, not merely the page's scrollWidth — a page can report zero overflow
// while the address quietly overflows its own box and gets clipped by the card's rounded
// corner.
//
// Every measurement sits behind a viewport-integrity guard; 320px goes through a real
// same-origin iframe (the top-level override floors at 348px on this build).
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'VerifyDepositRoutingVisual-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9445;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BTC_ADDRESS = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'; // 62-char P2WSH — the longest shape
const TRON_ADDRESS = 'TJRyWwiGxN5ZM2YbqLdcUbvvqkaGgNpDnc';

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

// Drives the real crypto option; waits for the routed panel to have rendered its choices.
const PREPARE_CLIENT_BTC = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 160 && !document.querySelector('.option-card[data-method="crypto"]'); i++) await sleep(250);
  document.querySelector('.option-card[data-method="crypto"]').click();
  for (let i = 0; i < 160; i++) {
    if (document.querySelectorAll('.dep-choice').length === 4 && document.getElementById('crypto-address-value')) break;
    await sleep(250);
  }
  await sleep(400);
  return true;
})()`;
const PREPARE_CLIENT_EMPTY = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 160 && !document.querySelector('.option-card[data-method="crypto"]'); i++) await sleep(250);
  document.querySelector('.option-card[data-method="crypto"]').click();
  for (let i = 0; i < 160; i++) {
    if (document.querySelectorAll('.dep-choice').length === 4) break;
    await sleep(250);
  }
  document.querySelector('.dep-choice[data-currency="ETH"]').click();
  await sleep(300);
  return true;
})()`;
const PREPARE_ADMIN_BOOK = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 160; i++) {
    if (document.querySelectorAll('.manage-btn').length > 0) break;
    await sleep(250);
  }
  document.querySelectorAll('.manage-btn').forEach(b => b.click());
  await sleep(300);
  return true;
})()`;
const PREPARE_QUEUE = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 160; i++) {
    if (document.querySelectorAll('#pending-list .credit-btn').length > 0) break;
    await sleep(250);
  }
  return true;
})()`;

const GEOM_EXPR = `(() => {
  const card = document.getElementById('crypto-address-card');
  const val = document.getElementById('crypto-address-value');
  const box = val ? val.closest('.rounded-xl') : null;
  const choices = [...document.querySelectorAll('.dep-choice')];
  const chip = document.getElementById('crypto-network-chip');
  const qr = document.getElementById('crypto-qr');
  const submit = document.getElementById('submit-crypto');
  const copy = document.getElementById('crypto-copy-btn');
  const rect = (el) => el ? el.getBoundingClientRect() : null;
  const v = rect(val), b = rect(box), c = rect(card);
  return {
    rendered: !!card && !!val,
    address: val ? val.textContent : null,
    inner: window.innerWidth,
    bodyScroll: document.body.scrollWidth,
    valueRight: v ? v.right : null, boxRight: b ? b.right : null, cardRight: c ? c.right : null,
    valueLines: v ? Math.round(v.height / parseFloat(getComputedStyle(val).lineHeight)) : null,
    chipRight: chip ? chip.getBoundingClientRect().right : null,
    choiceCols: choices.length ? new Set(choices.map(x => Math.round(x.getBoundingClientRect().left))).size : 0,
    maxChoiceRight: choices.length ? Math.max(...choices.map(x => x.getBoundingClientRect().right)) : null,
    qrOk: !!qr && (qr.querySelector('canvas') || qr.querySelector('img')) ? qr.getBoundingClientRect().width : null,
    submitH: submit ? Math.round(submit.getBoundingClientRect().height) : null,
    copyH: copy ? Math.round(copy.getBoundingClientRect().height) : null
  };
})()`;

const NARROW_EXPR = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 80 && !document.body; i++) await nap(100);
  const f = document.createElement('iframe');
  f.style.cssText = 'width:320px;height:900px;border:0';
  f.src = '/deploy-capital.html';
  document.body.appendChild(f);
  await new Promise(r => f.addEventListener('load', r));
  const d = f.contentDocument, w = f.contentWindow;
  for (let i = 0; i < 80; i++) { if (d.querySelector('.option-card[data-method="crypto"]')) break; await nap(250); }
  d.querySelector('.option-card[data-method="crypto"]').click();
  for (let i = 0; i < 160; i++) { if (d.getElementById('crypto-address-value')) break; await nap(250); }
  await nap(400);
  const val = d.getElementById('crypto-address-value');
  const box = val ? val.closest('.rounded-xl') : null;
  return {
    reported: d.documentElement.clientWidth,
    rendered: !!val,
    bodyScroll: d.body.scrollWidth,
    inner: w.innerWidth,
    valueRight: val ? val.getBoundingClientRect().right : null,
    boxRight: box ? box.getBoundingClientRect().right : null
  };
})()`;

const ADMIN_NARROW_EXPR = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 160; i++) { if (document.querySelectorAll('.manage-btn').length > 0) break; await nap(250); }
  document.querySelectorAll('.manage-btn').forEach(b => b.click());
  await nap(300);
  const addrs = [...document.querySelectorAll('#addresses-list .dep-addr')];
  return {
    inner: window.innerWidth,
    bodyScroll: document.body.scrollWidth,
    rows: document.querySelectorAll('.address-row').length,
    maxAddrRight: addrs.length ? Math.max(...addrs.map(a => a.getBoundingClientRect().right)) : null,
    cardMode: getComputedStyle(document.querySelector('.address-row')).display
  };
})()`;

function runContrast(profile, page, label, bootstrap, prepare) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/' + page,
      CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare,
      CONTRAST_SETTLE_MS: '25000', CONTRAST_PORT: '9333'
    })
  });
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
    cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8',
    env: Object.assign({}, process.env, { AUDIT_URL: BASE + '/' + page, AUDIT_BOOTSTRAP_JS: bootstrap })
  });
  const out = (res.stdout || '') + (res.stderr || '');
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family anywhere — the scheme is Inter (row 192)', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}

async function connectChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'mw-deprt-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { send, evaluate, close: () => { ws.close(); chrome.kill(); } };
}

async function main() {
  console.log('Crypto deposit routing — visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');

  async function makeClient(tag, name) {
    const email = 'deprtvis-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    await admin.from('clients').insert({ id: data.user.id, name, email: 'deprtvis-' + tag + '-' + data.user.id, phone: '+1 555 0100', account_type: 'Individual Account', status: 'active' });
    return { id: data.user.id, email };
  }
  const A = await makeClient('a', 'Visual Client Alpha');
  const B = await makeClient('b', 'Visual Client Bravo');
  const ids = [A.id, B.id];
  const addressIds = [];

  try {
    // A 62-char BTC address shared by two clients; a TRON address A alone holds; a retired one.
    const { data: btc } = await admin.from('deposit_addresses').insert({ currency: 'BTC', network: 'Bitcoin', address: BTC_ADDRESS, label: 'Visual BTC ' + suffix }).select().single();
    const { data: tron } = await admin.from('deposit_addresses').insert({ currency: 'USDT', network: 'TRC-20', address: TRON_ADDRESS, label: 'Visual TRON ' + suffix }).select().single();
    addressIds.push(btc.id, tron.id);
    await admin.from('deposit_address_assignments').insert([{ address_id: btc.id, client_id: A.id, currency: 'BTC', network: 'Bitcoin' }, { address_id: btc.id, client_id: B.id, currency: 'BTC', network: 'Bitcoin' }]);
    const { data: tronAsg } = await admin.from('deposit_address_assignments').insert({ address_id: tron.id, client_id: B.id, currency: 'USDT', network: 'TRC-20' }).select().single();
    await admin.from('deposit_address_assignments').update({ removed_at: new Date().toISOString() }).eq('id', tronAsg.id); // -> retired
    // A pending amount-less request for A (with a hash) and one for B (without), so the
    // pending card and the queue's amount-less row both have something to render.
    await admin.from('deposit_requests').insert([
      { client_id: A.id, method: 'crypto', requested_amount: null, currency: 'BTC', network: 'Bitcoin', deposit_address_id: btc.id, tx_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', status: 'pending' },
      { client_id: B.id, method: 'crypto', requested_amount: null, currency: 'BTC', network: 'Bitcoin', deposit_address_id: btc.id, tx_hash: null, status: 'pending' }
    ]);

    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email: A.email, password: PASSWORD });
    if (sErr) throw new Error('signIn: ' + sErr.message);
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const clientBootstrap = [
      'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');',
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(A.id) + ');',
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(A.id) + ');',
      'true'
    ].join('');
    const adminSigned = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (adminSigned.error) throw new Error('admin signIn: ' + adminSigned.error.message);
    const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(adminSigned.data.session)) + '); true';

    console.log('\n=== CONTRAST — real composited pixels on every new surface ===\n');
    runContrast('deposit-routing-client', 'deploy-capital.html', 'client address card + pending', clientBootstrap, PREPARE_CLIENT_BTC);
    runContrast('deposit-routing-empty', 'deploy-capital.html', 'client empty state', clientBootstrap, PREPARE_CLIENT_EMPTY);
    runContrast('deposit-routing-admin', 'admin-deposit-addresses.html', 'PM address book', adminBootstrap, PREPARE_ADMIN_BOOK);
    runContrast('deposit-routing-queue', 'admin-deposits.html', 'deposits queue', adminBootstrap, PREPARE_QUEUE);

    console.log('\n=== FONTS — Inter only ===\n');
    runFonts('deploy-capital.html', 'deploy-capital.html', clientBootstrap);
    runFonts('admin-deposit-addresses.html', 'admin-deposit-addresses.html', adminBootstrap);

    console.log('\n=== MOBILE — 1440/390/375/320 ===\n');
    const cdp = await connectChrome();
    try {
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(600);
      await cdp.evaluate(clientBootstrap);
      // Warm-up load (cold Edge Functions compile on first call — see the standing convention).
      await cdp.send('Page.navigate', { url: BASE + '/deploy-capital.html' });
      await sleep(2000);
      await cdp.evaluate(PREPARE_CLIENT_BTC);

      for (const width of [1440, 390, 375]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
        await cdp.send('Page.navigate', { url: BASE + '/deploy-capital.html' });
        await sleep(2500);
        const real = await cdp.evaluate('document.documentElement.clientWidth');
        check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);
        await cdp.evaluate(PREPARE_CLIENT_BTC);
        const g = await cdp.evaluate(GEOM_EXPR);
        check(width + 'px: the address card rendered with the real 62-char address', g.rendered && g.address === BTC_ADDRESS, JSON.stringify(g));
        check(width + 'px: no horizontal overflow on the page', g.bodyScroll <= g.inner + 1, JSON.stringify(g));
        check(width + 'px: ★ the address stays inside its own box (wraps, never clips)', g.valueRight <= g.boxRight + 0.5 && g.boxRight <= g.cardRight + 0.5, JSON.stringify({ valueRight: g.valueRight, boxRight: g.boxRight, cardRight: g.cardRight }));
        check(width + 'px: the network chip stays inside the card', g.chipRight <= g.cardRight + 0.5, JSON.stringify({ chipRight: g.chipRight, cardRight: g.cardRight }));
        check(width + 'px: no currency choice escapes the viewport', g.maxChoiceRight <= g.inner + 1, JSON.stringify(g));
        check(width + 'px: the QR rendered (real canvas/img)', typeof g.qrOk === 'number' && g.qrOk >= 100, JSON.stringify(g.qrOk));
        if (width < 1024) {
          check(width + 'px: the choices stack in one column', g.choiceCols === 1, String(g.choiceCols));
          check(width + 'px: submit and copy controls meet the 44px floor', g.submitH >= 44 && g.copyH >= 44, JSON.stringify({ submitH: g.submitH, copyH: g.copyH }));
        } else {
          check(width + 'px: the choices sit in two columns', g.choiceCols === 2, String(g.choiceCols));
        }
      }

      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Page.navigate', { url: BASE + '/deploy-capital.html' });
      await sleep(2500);
      const narrow = await cdp.evaluate(NARROW_EXPR);
      check('320px: the iframe genuinely reports 320px', narrow.reported === 320, JSON.stringify(narrow));
      check('320px: the address card renders', narrow.rendered === true, JSON.stringify(narrow));
      check('320px: no horizontal overflow', narrow.bodyScroll <= narrow.inner + 1, JSON.stringify(narrow));
      check('320px: ★ the 62-char address still stays inside its own box', narrow.valueRight <= narrow.boxRight + 0.5, JSON.stringify(narrow));

      // The PM address book at a narrow viewport: the table becomes cards, the address wraps.
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(400);
      await cdp.evaluate(adminBootstrap);
      for (const width of [390, 1440]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
        await cdp.send('Page.navigate', { url: BASE + '/admin-deposit-addresses.html' });
        await sleep(2500);
        const a = await cdp.evaluate(ADMIN_NARROW_EXPR);
        check('address book ' + width + 'px: rows rendered', a.rows >= 2, JSON.stringify(a));
        check('address book ' + width + 'px: no horizontal overflow', a.bodyScroll <= a.inner + 1, JSON.stringify(a));
        check('address book ' + width + 'px: no address escapes the viewport', a.maxAddrRight <= a.inner + 1, JSON.stringify(a));
        if (width < 1024) check('address book 390px: the table has become cards', a.cardMode !== 'table-row', a.cardMode);
      }
    } finally {
      cdp.close();
    }
  } finally {
    await admin.from('deposit_requests').delete().in('client_id', ids);
    await admin.from('transactions').delete().in('client_id', ids);
    await admin.from('account_state').delete().in('client_id', ids);
    if (addressIds.length) {
      await admin.from('deposit_address_assignments').delete().in('address_id', addressIds);
      await admin.from('deposit_addresses').delete().in('id', addressIds);
    }
    for (const id of ids) { await admin.from('clients').delete().eq('id', id); await admin.auth.admin.deleteUser(id); }
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
