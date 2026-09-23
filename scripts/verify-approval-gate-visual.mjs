#!/usr/bin/env node
// verify-approval-gate-visual.mjs — the approval gate in a real browser (2026-09-15).
//
//   npm run verify-approval-gate-visual      (from scripts/)
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
//
// PM tool revamp, part 3 (register row 228), step 4. Two things this suite exists to prove,
// and both of them have bitten this project before:
//
//   1. CONTRAST WITH THE SHEEN COMPOSITED. Text in a .glass card's top-left corner sits under
//      .glass::before, a positioned radial white highlight that composites OVER in-flow
//      content — navy measured 4.02:1 with it and 11.48:1 without, same glyphs, same card
//      (row 203). verify-contrast.mjs measures real composited pixels, and verify-glass-sheen.mjs
//      measures every text element under a sheen with it ON and OFF and reports the delta.
//
//   2. A REAL PHONE, NOT A NARROW DESKTOP WINDOW. mobile: true + deviceScaleFactor: 3 +
//      touch emulation, proven active by matchMedia rather than assumed from the width, and
//      then — row 229's lesson — the assertions say the CONTENT EXISTS AND READS: the client
//      name, the age, the amount, the type chip, the panel's own controls. "The layout
//      collapsed to one column" is not evidence that anything survived the collapse. The
//      first cut of the gate's own narrow-width rule hid .ag-who and .ag-age outright, which
//      is exactly the failure this shape of assertion catches and a collapse check does not.
//
// 320px goes through a real same-origin iframe: the top-level metrics override floors at
// ~348px on this build (row 170), and a measurement taken at a width the browser did not
// actually adopt is worse than no measurement.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { adminNavItemCount } from './lib/admin-nav-count.mjs';

// ★ Derived from admin-sidebar.js's own NAV_ITEMS, never retyped: this literal was '10' in
// seven suites, and adding one rail item broke four assertions and left three polling until
// they timed out, which reads as 'the page never rendered' (2026-09-23).
const NAV_COUNT = adminNavItemCount();

const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'GateVis-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9461;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: SCRIPTS_DIR + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
function runChild(script, label, env) {
  const res = spawnSync(process.execPath, [script], { cwd: SCRIPTS_DIR, encoding: 'utf8', env: Object.assign({}, process.env, env) });
  forwardChildTeardown(res, label);
  const out = (res.stdout || '') + (res.stderr || '');
  if (!out.trim()) console.log('  ' + label + ' -> (no output; status ' + res.status + ', signal ' + res.signal + ')');
  return out;
}
function runContrast(profile, label, bootstrap, prepare) {
  const out = runChild('verify-contrast.mjs', 'verify-contrast', {
    CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/admin-approvals.html',
    CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare || '',
    CONTRAST_SETTLE_MS: '30000', CONTRAST_PORT: '9338'
  });
  const tail = out.trim().split('\n').slice(-2).join(' | ');
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + tail);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1 with the sheen composited', /CONTRAST: PASS/.test(out), tail);
  out.split('\n').filter((l) => /FAIL\s+\d|UNMEASURED\s/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}
function runFonts(bootstrap) {
  const out = runChild('verify-fonts.mjs', 'verify-fonts', { AUDIT_URL: BASE + '/admin-approvals.html', AUDIT_BOOTSTRAP_JS: bootstrap });
  console.log('  fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check('no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check('no monospace family anywhere — the scheme is Inter (row 192)', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}
// The sheen audit's own finding on this page is that there is nothing for it to measure: the
// gate is built from white .ag-* cards, not .glass panels, so no text sits under a
// .glass::before highlight. That is a real result, not a skipped check - but "0 measured" is
// exactly the shape a vacuous pass takes, so it is only accepted when the page's own .glass
// count, read independently from the real DOM, is also zero. If the gate ever gains a glass
// surface, glassCount stops being 0 and the audit has to carry it.
function runSheen(glassCount) {
  const out = runChild('verify-glass-sheen.mjs', 'verify-glass-sheen', { SHEEN_PAGES: 'admin-approvals.html', SHEEN_PORT: '9462' });
  const lines = out.trim().split('\n');
  const tail = lines.filter((l) => /measurements under the sheen|SHEEN SWEEP|glass element/.test(l)).join(' | ') || lines.slice(-1)[0];
  console.log('  sheen -> ' + tail);
  const m = out.match(/(\d+) measurements under the sheen across (\d+) pages, (\d+) below/);
  const pageLine = out.match(/admin-approvals\.html [^\n]*?(\d+) \.glass element/);
  check('the sheen audit ran against the gate and reported its own .glass count', !!m && !!pageLine, tail);
  if (glassCount === 0) {
    check('the gate carries NO .glass surface at all - counted in the real DOM, and the audit agrees, so no text can sit under a sheen',
      !!pageLine && Number(pageLine[1]) === 0 && !!m && Number(m[1]) === 0,
      'DOM=' + glassCount + ', audit=' + (pageLine ? pageLine[1] : '?'));
  } else {
    check('every text element under a .glass sheen on the gate clears 4.5:1 with it composited',
      !!m && Number(m[1]) > 0 && Number(m[3]) === 0 && !/UNMEASURED/.test(out), tail);
  }
  lines.filter((l) => /UNMEASURED/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}

async function connectChrome() {
  const profile = makeTempDir('mw-gatevis-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  return { send, evaluate, close: () => releaseTempDir(profile) };
}

// A real phone, not a narrow window: mobile viewport, DPR 3, touch. Proven by matchMedia below.
async function phone(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function desktop(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  // maxTouchPoints must be 1-16 even when disabling; passing 0 is a protocol error.
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}

const WAIT = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) {
    const q = document.getElementById('ag-queue');
    if (document.querySelectorAll('.an-item').length === ${NAV_COUNT} && q && !/animate-pulse/.test(q.innerHTML)
        && (q.querySelectorAll('.ag-row').length > 0 || q.querySelector('.ag-empty'))) break;
    await nap(200);
  }
  await nap(500); return true;
})()`;

// Reads the QUEUE as a phone user genuinely sees it: for each row, the rendered text of every
// part a PM triages by, plus whether its box is actually on screen and how wide it is.
const READ = `(() => {
  const seen = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { t: (el.textContent || '').replace(/\\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height),
             vis: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0, right: Math.round(r.right) }; };
  const rows = [...document.querySelectorAll('#ag-queue .ag-row')].map((r) => ({
    kind: r.getAttribute('data-kind'), id: r.getAttribute('data-id'),
    box: seen(r), chip: seen(r.querySelector('.ag-kind')), title: seen(r.querySelector('.ag-what b')),
    sub: seen(r.querySelector('.ag-what span')), client: seen(r.querySelector('.ag-nm b')),
    amount: seen(r.querySelector('.ag-amt b')), age: seen(r.querySelector('.ag-age')),
    urgent: r.classList.contains('is-urgent')
  }));
  const pills = [...document.querySelectorAll('#ag-filters .ag-fp')].map((b) => ({ t: (b.textContent || '').replace(/\\s+/g, ' ').trim(), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }));
  const all = [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().width > 0 && !e.classList.contains('blob'));
  return {
    inner: window.innerWidth, dpr: window.devicePixelRatio,
    coarse: matchMedia('(pointer: coarse)').matches, noHover: matchMedia('(hover: none)').matches,
    touchPoints: navigator.maxTouchPoints,
    bodyScroll: document.body.scrollWidth, docScroll: document.documentElement.scrollWidth,
    maxRight: Math.max(...all.map((e) => Math.round(e.getBoundingClientRect().right))),
    rows, pills, groups: [...document.querySelectorAll('#ag-queue .ag-grp')].map((g) => g.textContent.trim()),
    oldest: (document.getElementById('ag-oldest-text') || {}).textContent || ''
  };
})()`;

// Opens the FIRST row and reads the panel the same way.
const OPEN = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  const row = document.querySelector('#ag-queue .ag-row');
  if (!row) return { opened: false };
  row.click();
  for (let i = 0; i < 60; i++) { if (!document.getElementById('ag-scrim').hidden && document.getElementById('ag-pane').innerHTML.length > 0) break; await nap(100); }
  await nap(300);
  const pane = document.getElementById('ag-pane');
  const r = (el) => el ? { t: (el.textContent || '').replace(/\\s+/g, ' ').trim(), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), vis: el.getBoundingClientRect().height > 0 } : null;
  const pr = pane.getBoundingClientRect();
  return {
    opened: !document.getElementById('ag-scrim').hidden,
    title: r(document.getElementById('ag-pane-title')),
    kvs: [...pane.querySelectorAll('.ag-kv')].map((k) => ({ k: ((k.querySelector('.ag-k') || {}).textContent || '').trim(), v: ((k.querySelector('.ag-v') || {}).textContent || '').trim() })),
    approve: r(document.getElementById('ag-approve')), reject: r(document.getElementById('ag-reject')),
    close: r(document.getElementById('ag-close')),
    amount: document.getElementById('ag-amount') ? { w: Math.round(document.getElementById('ag-amount').getBoundingClientRect().width), h: Math.round(document.getElementById('ag-amount').getBoundingClientRect().height) } : null,
    note: r(pane.querySelector('.ag-warn p')),
    paneW: Math.round(pr.width), paneRight: Math.round(pr.right), paneLeft: Math.round(pr.left), paneBottom: Math.round(pr.bottom),
    innerH: window.innerHeight
  };
})()`;

const CLOSE = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); const b = document.getElementById('ag-close'); if (b) b.click(); await nap(300); return document.getElementById('ag-scrim').hidden; })()`;

const HISTORY = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  document.getElementById('ag-view-history').click();
  for (let i = 0; i < 120; i++) { if (document.querySelectorAll('#ag-hrows .ag-hrow').length > 0) break; await nap(150); }
  await nap(300);
  const rows = [...document.querySelectorAll('#ag-hrows .ag-hrow')].map((r) => ({
    title: ((r.querySelector('.ag-what b') || {}).textContent || '').trim(),
    client: ((r.querySelector('.ag-nm b') || {}).textContent || '').trim(),
    amount: ((r.querySelector('.ag-amt b') || {}).textContent || '').replace(/\\s+/g, ' ').trim(),
    differs: !!r.querySelector('.ag-differs'),
    outcome: ((r.querySelector('.ag-outc') || {}).textContent || '').trim(),
    when: ((r.querySelector('.ag-when') || {}).textContent || '').trim(),
    right: Math.round(r.getBoundingClientRect().right)
  }));
  const all = [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().width > 0 && !e.classList.contains('blob'));
  return { rows, hpills: document.querySelectorAll('#ag-hfilters .ag-fp').length,
           maxRight: Math.max(...all.map((e) => Math.round(e.getBoundingClientRect().right))),
           bodyScroll: document.body.scrollWidth, headHidden: getComputedStyle(document.getElementById('ag-hhead')).display === 'none' };
})()`;

const NARROW = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 80 && !document.body; i++) await nap(100);
  const f = document.createElement('iframe'); f.style.cssText = 'width:320px;height:1400px;border:0'; f.src = '/admin-approvals.html';
  document.body.appendChild(f); await new Promise(r => f.addEventListener('load', r));
  const d = f.contentDocument, w = f.contentWindow;
  for (let i = 0; i < 300; i++) { const q = d.getElementById('ag-queue'); if (d.querySelectorAll('.an-item').length === ${NAV_COUNT} && q && !/animate-pulse/.test(q.innerHTML) && (q.querySelectorAll('.ag-row').length > 0 || q.querySelector('.ag-empty'))) break; await nap(200); }
  await nap(500);
  const seen = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = w.getComputedStyle(el);
    return { t: (el.textContent || '').replace(/\\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height), vis: cs.display !== 'none' && r.width > 0 && r.height > 0, right: Math.round(r.right) }; };
  const rows = [...d.querySelectorAll('#ag-queue .ag-row')].map((r) => ({
    client: seen(r.querySelector('.ag-nm b')), age: seen(r.querySelector('.ag-age')),
    title: seen(r.querySelector('.ag-what b')), amount: seen(r.querySelector('.ag-amt b')), box: seen(r)
  }));
  const all = [...d.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().width > 0 && !e.classList.contains('blob'));
  const before = { reported: d.documentElement.clientWidth, coarse: w.matchMedia('(pointer: coarse)').matches, dpr: w.devicePixelRatio,
    bodyScroll: d.body.scrollWidth, maxRight: Math.max(...all.map((e) => Math.round(e.getBoundingClientRect().right))),
    rows, pills: [...d.querySelectorAll('#ag-filters .ag-fp')].map((b) => Math.round(b.getBoundingClientRect().height)) };
  const row = d.querySelector('#ag-queue .ag-row');
  if (row) { row.click(); for (let i = 0; i < 60; i++) { if (!d.getElementById('ag-scrim').hidden && d.getElementById('ag-pane').innerHTML.length > 0) break; await nap(100); } await nap(300); }
  const pane = d.getElementById('ag-pane'); const pr = pane.getBoundingClientRect();
  const after = { opened: !d.getElementById('ag-scrim').hidden, paneW: Math.round(pr.width), paneLeft: Math.round(pr.left), paneRight: Math.round(pr.right),
    kvs: pane.querySelectorAll('.ag-kv').length,
    approveH: Math.round((d.getElementById('ag-approve') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
    rejectH: Math.round((d.getElementById('ag-reject') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
    closeH: Math.round((d.getElementById('ag-close') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
    title: ((d.getElementById('ag-pane-title') || {}).textContent || '').trim() };
  return { before, after };
})()`;

async function main() {
  console.log('The approval gate — contrast with the sheen composited, and a real phone profile\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const users = [];
  const now = Date.now(); const H = 3600e3; const iso = (t) => new Date(t).toISOString();

  const anonForPm = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const adminSigned = await anonForPm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (adminSigned.error) throw new Error('admin sign-in: ' + adminSigned.error.message);
  const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(adminSigned.data.session)) + '); true';

  async function makeClient(name, unallocated) {
    const email = 'gatevis-' + name.toLowerCase().replace(/\s+/g, '-') + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error(error.message);
    users.push(data.user.id);
    const ins = await admin.from('clients').insert({ id: data.user.id, name, email: 'gatevis-malformed-' + suffix + '-' + name.toLowerCase().replace(/\s+/g, '-'), phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    if (ins.error) throw new Error(ins.error.message);
    const st = await admin.from('account_state').insert({ client_id: data.user.id, unallocated_capital: unallocated, allocated_capital: 0, asset_returns: 0 });
    if (st.error) throw new Error(st.error.message);
    return { id: data.user.id, name };
  }

  // A seed that fails silently shows up as a confusing assertion failure much further
  // down — so every one is checked at the point of insertion.
  const ins = async (table, row) => { const { error } = await admin.from(table).insert(row); if (error) throw new Error('seed ' + table + ': ' + error.message); };

  try {
    // ---- seed: enough real pending state that every part of a row has something to render,
    //      and enough resolved state that history has both outcomes AND a real (differs).
    const A = await makeClient('Annika Bergqvist', 40000);
    const B = await makeClient('Rasmus Olofsson', 12000);

    // Urgent (3 days old) withdrawal, so the urgent group and the hot age both render.
    await ins('withdrawal_requests', { client_id: A.id, method: 'bank', requested_amount: 9000, currency: 'USD', destination_details: { bankName: 'SEB', accountNumber: '1234' }, status: 'pending', requested_at: iso(now - 72 * H) });
    // Amount-less crypto deposit: the row's amount cell renders an em dash and "PM sets amount".
    await ins('deposit_requests', { client_id: B.id, method: 'crypto', currency: 'BTC', network: 'Bitcoin', tx_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', details: {}, status: 'pending', requested_at: iso(now - 5 * H) });
    // Internal HYS transfer: the one HYS deposit that DOES touch unallocated capital.
    await ins('hys_deposit_requests', { client_id: A.id, pocket_type: 'fixed', term_mode: 'short', term_months: 12, term_label: '12 months', rate: 12, term_in_years: 1, requested_amount: 6000, method: 'internal', currency: 'USD', status: 'pending', requested_at: iso(now - 2 * H) });
    // A profile change, for a seventh-type row with a client-supplied reason.
    await ins('profile_change_requests', { client_id: B.id, field: 'address', current_value: null, requested_value: { line1: '4 Storgatan', city: 'Uppsala', country: 'Sweden' }, reason: 'Moved in July', status: 'pending', requested_at: iso(now - 30 * 60000) });

    // Resolved: one approved at a DIVERGENT amount (the (differs) marker) and one rejected.
    await ins('withdrawal_requests', { client_id: A.id, method: 'bank', requested_amount: 700, approved_amount: 650, currency: 'USD', destination_details: {}, status: 'approved', requested_at: iso(now - 96 * H), resolved_at: iso(now - 90 * H) });
    await ins('deposit_requests', { client_id: B.id, method: 'bank', requested_amount: 1500, currency: 'USD', details: {}, status: 'rejected', reason: 'No matching transfer received.', requested_at: iso(now - 120 * H), resolved_at: iso(now - 1 * H) });
    // Resolved an hour ago on purpose: history is newest-first and capped, so a rejection
    // resolved days back can legitimately sort below other suites' leftover rows and the
    // "both outcome tones are on screen" check would fail on ordering, not on rendering.

    const PREP_QUEUE = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { const q = document.getElementById('ag-queue'); if (q && !/animate-pulse/.test(q.innerHTML) && q.querySelectorAll('.ag-row').length > 0 && document.querySelectorAll('#ag-filters .ag-fp').length > 0) break; await nap(200); } await nap(800); })()`;
    const PREP_PANEL = PREP_QUEUE.replace('await nap(800); })()',
      `await nap(500); document.querySelector('#ag-queue .ag-row').click(); for (let i = 0; i < 60; i++) { if (!document.getElementById('ag-scrim').hidden && document.getElementById('ag-pane').innerHTML.length > 0) break; await nap(100); } await nap(700); })()`);
    const PREP_HISTORY = PREP_QUEUE.replace('await nap(800); })()',
      `await nap(300); document.getElementById('ag-view-history').click(); for (let i = 0; i < 120; i++) { if (document.querySelectorAll('#ag-hrows .ag-hrow').length > 0) break; await nap(150); } await nap(700); })()`);

    console.log('--- Contrast: real composited pixels, sheen ON ---\n');
    runContrast('approval-gate', 'the queue', adminBootstrap, PREP_QUEUE);
    runContrast('approval-gate-panel', 'the detail panel', adminBootstrap, PREP_PANEL);
    runContrast('approval-gate-history', 'history', adminBootstrap, PREP_HISTORY);

    console.log('\n--- Fonts ---\n');
    runFonts(adminBootstrap);

    console.log('\n--- Desktop 1440px, then a REAL phone at 390 / 375, then a real 320px iframe ---\n');
    const cdp = await connectChrome();
    try {
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(800);
      await cdp.evaluate(adminBootstrap);

      // ---- 1440px: the full six-column row, every part on screen -------------------------
      await desktop(cdp, 1440);
      await cdp.send('Page.navigate', { url: BASE + '/admin-approvals.html' }); await cdp.evaluate(WAIT);
      const d = await cdp.evaluate(READ);
      check('1440px: the viewport is genuinely 1440 (integrity guard)', d.inner === 1440, String(d.inner));
      const glassCount = await cdp.evaluate(`document.querySelectorAll('.glass, .glass-subtle, .glass-lift').length`);
      runSheen(glassCount);
      check('GUARD: real pending rows are on screen — otherwise every assertion below is vacuous', d.rows.length >= 4, d.rows.length + ' rows');

      // ★ THE GATE MUST MOUNT THE SHARED ADMIN NAV, and this suite has to say so out loud.
      // The gate shipped WITHOUT its initAdminSidebar('approvals') call: the busiest page in the
      // PM tool rendered with no navigation and no Log out control, and this suite passed 69/69
      // straight over it because every assertion looked at the QUEUE and none looked at the
      // chrome around it. A real browser render missed it for the same reason — "it rendered"
      // is not evidence when you only looked at the part you were building. Assert the nav, its
      // own active item, and a reachable Log out, all read from the real DOM.
      const nav = await cdp.evaluate(`(() => {
        const aside = document.getElementById('admin-sidebar-aside');
        if (!aside) return { mounted: false, path: location.pathname };
        const items = [...aside.querySelectorAll('.an-item')];
        return {
          mounted: true,
          count: items.length,
          on: items.filter(i => i.classList.contains('is-on')).map(i => (i.querySelector('.an-lb') || {}).textContent),
          logout: !!document.getElementById('admin-logout-btn'),
          asideW: Math.round(aside.getBoundingClientRect().width)
        };
      })()`);
      check('★ 1440px: THE GATE MOUNTS THE SHARED ADMIN NAV — every item, a real rail with width',
        nav.mounted && nav.count === NAV_COUNT && nav.asideW > 0,
        JSON.stringify(nav));
      check('★ 1440px: the gate is its own active nav item, and Log out is reachable from it',
        nav.mounted && nav.on.join() === 'Approvals' && nav.logout === true,
        JSON.stringify({ on: nav.on, logout: nav.logout }));
      check('1440px: no horizontal overflow', d.bodyScroll <= 1440 && d.docScroll <= 1440 && d.maxRight <= 1441, JSON.stringify({ b: d.bodyScroll, m: d.maxRight }));
      const seededA = d.rows.filter((r) => r.client && r.client.t === A.name);
      const seededB = d.rows.filter((r) => r.client && r.client.t === B.name);
      check('★ 1440px: every row names its real client — both seeded names are on screen, read from the DOM',
        seededA.length >= 2 && seededB.length >= 2, A.name + '=' + seededA.length + ', ' + B.name + '=' + seededB.length);
      check('1440px: every row shows its type chip, title, amount cell and age, all with real text',
        d.rows.every((r) => r.chip && r.chip.vis && r.chip.t.length > 0 && r.title && r.title.t.length > 0 && r.amount && r.amount.vis && r.age && r.age.vis && r.age.t.length > 0),
        JSON.stringify(d.rows.map((r) => [r.kind, !!(r.chip && r.chip.vis), !!(r.age && r.age.vis)])));
      check('★ 1440px: the amount-less crypto deposit renders an em dash and says the PM sets the amount, not "null"',
        d.rows.some((r) => r.kind === 'dep' && /—/.test(r.amount.t) && !/null|undefined|NaN/.test(r.amount.t)),
        JSON.stringify(d.rows.filter((r) => r.kind === 'dep').map((r) => r.amount.t)));
      check('1440px: the 3-day-old withdrawal is in the urgent group, and both group headings are present',
        d.rows.some((r) => r.kind === 'wd' && r.urgent) && d.groups.length === 2 && /Waiting more than a day/.test(d.groups.join(' ')), JSON.stringify(d.groups));
      check('1440px: eight filter pills (All + the seven types), each with a count', d.pills.length === 8, JSON.stringify(d.pills.map((p) => p.t)));
      check('1440px: the oldest-waiting badge names a real age', /\d/.test(d.oldest), d.oldest);

      const p1440 = await cdp.evaluate(OPEN);
      check('1440px: clicking a row opens the panel with a title, at least four detail rows and both controls',
        p1440.opened && p1440.title.t.length > 0 && p1440.kvs.length >= 4 && p1440.approve.vis && p1440.reject.vis,
        JSON.stringify({ title: p1440.title && p1440.title.t, kvs: p1440.kvs.length }));
      check('1440px: no detail row renders an empty, null or undefined value',
        p1440.kvs.every((k) => k.v.length > 0 && !/^(null|undefined|NaN)$/.test(k.v)), JSON.stringify(p1440.kvs));
      check('1440px: the panel states which re-validation runs at approval', !!p1440.note && p1440.note.t.length > 20, p1440.note && p1440.note.t.slice(0, 90));
      check('1440px: the panel is a centred dialog, not full-bleed', p1440.paneW <= 470 && p1440.paneLeft > 0, String(p1440.paneW));
      await cdp.evaluate(CLOSE);

      const h1440 = await cdp.evaluate(HISTORY);
      check('GUARD: real resolved rows are on screen', h1440.rows.length >= 2, h1440.rows.length + ' rows');
      check('★ 1440px: history shows the client, the amount, the outcome AND the date on every row',
        h1440.rows.every((r) => r.client.length > 0 && r.amount.length > 0 && /Approved|Rejected|Credited/i.test(r.outcome) && r.when.length > 0),
        JSON.stringify(h1440.rows));
      check('★ 1440px: the (differs) marker renders on the withdrawal approved at $650 against $700 requested',
        h1440.rows.some((r) => r.differs && /650/.test(r.amount)), JSON.stringify(h1440.rows.map((r) => [r.amount, r.differs])));
      check('1440px: both outcome tones are on screen — an approval and a rejection',
        h1440.rows.some((r) => /Rejected/i.test(r.outcome)) && h1440.rows.some((r) => !/Rejected/i.test(r.outcome)), JSON.stringify(h1440.rows.map((r) => r.outcome)));

      // ---- a REAL phone at 390 and 375 ---------------------------------------------------
      for (const width of [390, 375]) {
        await phone(cdp, width);
        await cdp.send('Page.navigate', { url: BASE + '/admin-approvals.html' }); await cdp.evaluate(WAIT);
        const m = await cdp.evaluate(READ);
        check(width + 'px: the viewport is genuinely ' + width + ' (integrity guard)', m.inner === width, String(m.inner));
        check('★ ' + width + 'px: this is a REAL PHONE PROFILE, not a narrow desktop window — DPR 3, coarse pointer, no hover, real touch points',
          m.dpr === 3 && m.coarse === true && m.noHover === true && m.touchPoints >= 1,
          JSON.stringify({ dpr: m.dpr, coarse: m.coarse, noHover: m.noHover, touch: m.touchPoints }));
        check(width + 'px: no horizontal overflow', m.bodyScroll <= width && m.docScroll <= width && m.maxRight <= width + 1, JSON.stringify({ b: m.bodyScroll, m: m.maxRight }));
        check('GUARD: real rows are on screen at ' + width + 'px', m.rows.length >= 4, m.rows.length + ' rows');
        check('★ ' + width + 'px: THE CLIENT NAME SURVIVES — every row still names its real client, read from the DOM',
          m.rows.every((r) => r.client && r.client.vis && r.client.t.length > 0) && m.rows.some((r) => r.client.t === A.name) && m.rows.some((r) => r.client.t === B.name),
          JSON.stringify(m.rows.map((r) => r.client && [r.client.t, r.client.vis])));
        check('★ ' + width + 'px: THE AGE SURVIVES — the one signal the whole queue is ordered by',
          m.rows.every((r) => r.age && r.age.vis && /\d/.test(r.age.t)), JSON.stringify(m.rows.map((r) => r.age && [r.age.t, r.age.vis])));
        check(width + 'px: the type chip, the title and the amount are all still rendered and readable',
          m.rows.every((r) => r.chip.vis && r.chip.t.length > 0 && r.title.vis && r.title.t.length > 0 && r.amount.vis && !/null|undefined|NaN/.test(r.amount.t)),
          JSON.stringify(m.rows.map((r) => [r.chip.t, r.title.t.slice(0, 18), r.amount.t])));
        check(width + 'px: nothing inside a row escapes its own right edge',
          m.rows.every((r) => r.box.right <= width + 1 && r.amount.right <= r.box.right + 1 && r.client.right <= r.box.right + 1),
          JSON.stringify(m.rows.map((r) => [r.box.right, r.amount.right, r.client.right])));
        check(width + 'px: all eight filter pills are still there and are real tap targets (>= 44px tall)',
          m.pills.length === 8 && m.pills.every((p) => p.h >= 44), JSON.stringify(m.pills.map((p) => p.h)));

        const pm = await cdp.evaluate(OPEN);
        check('★ ' + width + 'px: tapping a row opens the panel, full-bleed, with its real detail rows and both controls present',
          pm.opened && pm.kvs.length >= 4 && pm.approve.vis && pm.reject.vis && pm.close.vis, JSON.stringify({ kvs: pm.kvs.length, ok: pm.opened }));
        check(width + 'px: the panel fills the width instead of being a cramped dialog, and stays inside the viewport',
          pm.paneW >= width - 2 && pm.paneLeft >= -1 && pm.paneRight <= width + 1, JSON.stringify({ w: pm.paneW, l: pm.paneLeft, r: pm.paneRight }));
        check(width + 'px: Approve, Reject and Close are all real tap targets (>= 44px)',
          pm.approve.h >= 44 && pm.reject.h >= 44 && pm.close.h >= 44, JSON.stringify({ a: pm.approve.h, r: pm.reject.h, c: pm.close.h }));
        if (pm.amount) check(width + 'px: the amount field is a real tap target too', pm.amount.h >= 44, String(pm.amount.h));
        check(width + 'px: no detail row renders an empty, null or undefined value',
          pm.kvs.every((k) => k.v.length > 0 && !/^(null|undefined|NaN)$/.test(k.v)), JSON.stringify(pm.kvs));
        await cdp.evaluate(CLOSE);

        const hm = await cdp.evaluate(HISTORY);
        check('★ ' + width + 'px: HISTORY KEEPS ITS CONTENT — client, amount, outcome and date on every row, only the column header goes',
          hm.rows.length >= 2 && hm.rows.every((r) => r.client.length > 0 && r.amount.length > 0 && r.outcome.length > 0 && r.when.length > 0) && hm.headHidden,
          JSON.stringify(hm.rows));
        check(width + 'px: the (differs) marker is still rendered', hm.rows.some((r) => r.differs), JSON.stringify(hm.rows.map((r) => r.differs)));
        check(width + 'px: history introduces no horizontal overflow', hm.bodyScroll <= width && hm.maxRight <= width + 1, JSON.stringify({ b: hm.bodyScroll, m: hm.maxRight }));
      }

      // ---- a real 320px iframe, inside the phone profile --------------------------------
      await phone(cdp, 390);
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(800);
      const n = await cdp.evaluate(NARROW);
      check('320px: the iframe genuinely reports 320px and inherits the phone profile', n.before.reported === 320 && n.before.coarse === true && n.before.dpr === 3, JSON.stringify(n.before.reported + '/' + n.before.coarse + '/' + n.before.dpr));
      check('GUARD: real rows render at 320px', n.before.rows.length >= 4, n.before.rows.length + ' rows');
      check('320px: no horizontal overflow', n.before.bodyScroll <= 320 && n.before.maxRight <= 321, JSON.stringify({ b: n.before.bodyScroll, m: n.before.maxRight }));
      check('★ 320px: the client name and the age are still rendered on every row',
        n.before.rows.every((r) => r.client && r.client.vis && r.client.t.length > 0 && r.age && r.age.vis && /\d/.test(r.age.t)),
        JSON.stringify(n.before.rows.map((r) => [r.client && r.client.t, r.age && r.age.t])));
      check('320px: the title and amount are still rendered, and nothing escapes its row',
        n.before.rows.every((r) => r.title.vis && r.amount.vis && r.box.right <= 321), JSON.stringify(n.before.rows.map((r) => [r.title.t.slice(0, 16), r.amount.t, r.box.right])));
      check('320px: the eight filter pills are still real tap targets', n.before.pills.length === 8 && n.before.pills.every((h) => h >= 44), JSON.stringify(n.before.pills));
      check('★ 320px: the panel still opens with its real content and full-width controls',
        n.after.opened && n.after.kvs >= 4 && n.after.title.length > 0 && n.after.paneW >= 318 && n.after.paneRight <= 321,
        JSON.stringify(n.after));
      check('320px: Approve, Reject and Close remain real tap targets', n.after.approveH >= 44 && n.after.rejectH >= 44 && n.after.closeH >= 44, JSON.stringify([n.after.approveH, n.after.rejectH, n.after.closeH]));
    } finally {
      await cdp.close();
    }
  } finally {
    console.log('\n(cleanup)');
    for (const uid of users) {
      for (const t of ['withdrawal_requests', 'deposit_requests', 'hys_deposit_requests', 'hys_withdrawal_requests', 'allocation_requests', 'sell_requests', 'profile_change_requests', 'account_state', 'transactions', 'conversations']) {
        await admin.from(t).delete().eq('client_id', uid);
      }
      await admin.from('clients').delete().eq('id', uid);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.log('  cleanup: could not delete ' + uid + ': ' + error.message);
    }
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nVERIFY: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY: FAIL — ' + (e.stack || e.message)); process.exit(1); });
