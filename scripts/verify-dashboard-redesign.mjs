#!/usr/bin/env node
// ★ Client dashboard redesign (2026-09-19, register row 251) — the redesign's own verification,
// in a REAL browser (headless Chrome over CDP) against the real local stack, the brief's own
// VERIFY list item by item:
//
//   1. every figure cross-checked against its SOURCE (the two overview payloads and the
//      tables), not merely rendered;
//   2. the stale-price path PROVEN: every held product forced fresh (the green pill), then one
//      forced to quote_failed — the pill turns amber, the payload's flag names it, the affected
//      figure is reported — then cleared and confirmed back to baseline;
//   3. Total account value matching Asset & performance TO THE CENT, both pages read in the
//      same run, in the same browser;
//   4. a client with no holdings, one class, and no pockets each render correctly;
//   5. pending ages correct against the real requested_at;
//   6. contrast with the sheen composited (the amber pill, the in-band donut labels, the metric
//      badges are the named risks), the sheen audit, fonts;
//   7. mobile at 320/375/390 on a REAL phone profile (mobile:true, DPR 3, touch — proven by
//      matchMedia, never inferred from width), tablet two-up, every tap target 44px.
//
// Gary (seed-client-gary.mjs) is the established client: eight real holdings across two
// classes, two pockets (one matured), a real six-day-old pending allocation, realised gains.
// Two throwaway clients cover the edge states.
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765 serving
// the PROJECT ROOT (a 200 on /index.html — never kill one that answers that).
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { createSimulatedTestProduct, deleteSimulatedTestProduct } from './lib/simulated-test-product.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';
import { findFixtureClient } from './lib/fixture-client.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'VerifyDashRedesign-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9449;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail !== undefined ? ' — ' + String(detail).slice(0, 400) : '')); }
}
function localStack() {
  const raw = execSync('supabase status -o json', { cwd: ROOT, encoding: 'utf8' });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(j.API_URL)) throw new Error('refusing a non-local API_URL');
  return j;
}
async function callFunction(url, token, name, body) {
  // The first call after a gate (or an edge-runtime restart) can answer a cold 5xx; the
  // read functions are idempotent, so a non-2xx is retried twice with a pause and reported.
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
    let json = null; try { json = await r.json(); } catch (_e) {}
    last = { status: r.status, body: json };
    if (r.status < 500) return last;
    console.log('      (' + name + ' answered ' + r.status + ' — ' + JSON.stringify(json).slice(0, 160) + ' — retrying)');
    await sleep(2500);
  }
  return last;
}
const usd2 = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (n) => '$' + Math.round(n).toLocaleString('en-US');
const r2 = (n) => Math.round(n * 100) / 100;

// The whole page rendered: every async region past its skeleton and the watchlist grid painted.
const WAIT_ALL = '(async()=>{const ids=["tpv-amount","po-pending","po-maturities","total-return-split","allocation-legend","recent-activity-list","risk-cash-desc"];for(let i=0;i<240;i++){const ok=ids.every(id=>{const e=document.getElementById(id);return e&&!/animate-pulse/.test(e.innerHTML)&&e.textContent.trim().length>0})&&document.querySelector(".wl-card[data-wl-card]");if(ok)return true;await new Promise(r=>setTimeout(r,250));}return false;})()';
const WAIT_AP = '(async()=>{for(let i=0;i<240;i++){const e=document.getElementById("ap-total-amount");if(e&&!/animate-pulse/.test(e.innerHTML)&&/\\$/.test(e.textContent))return true;await new Promise(r=>setTimeout(r,250));}return false;})()';
// Count-ups (Motion) settle on the real figure; wait for a given element to read a given text.
const WAIT_TEXT = (id, text) => '(async()=>{for(let i=0;i<60;i++){if(document.getElementById(' + JSON.stringify(id) + ').textContent.trim()===' + JSON.stringify(text) + ')return true;await new Promise(r=>setTimeout(r,100));}return document.getElementById(' + JSON.stringify(id) + ').textContent.trim();})()';

function runChild(script, label, env) {
  let out = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = spawnSync(process.execPath, [script], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', env: Object.assign({}, process.env, env) });
    forwardChildTeardown(res, script);
    out = (res.stdout || '') + (res.stderr || '');
    if (out.trim()) return out;
    // A child that printed NOTHING is not a result of any kind. The Windows libuv abort (row
    // 198, exit 0xC0000409) normally lands AFTER the output; one that lands before it is
    // retried once, and the retry is reported so it is never mistaken for a first-run pass.
    console.log('  ' + label + ' -> child printed nothing: status=' + res.status + ' signal=' + res.signal + ' error=' + (res.error ? res.error.message : 'none') + (attempt === 1 ? ' — retrying once' : ''));
  }
  return out;
}
function runContrast(profile, label, bootstrap, prepare) {
  const out = runChild('verify-contrast.mjs', label, { CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/dashboard.html', CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare || WAIT_ALL, CONTRAST_SETTLE_MS: '4000', CONTRAST_PORT: '9333' });
  const tail = out.trim().split('\n').slice(-2).join(' | ');
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + tail);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  out.split('\n').filter((l) => /FAIL\s+\d|UNMEASURED\s/.test(l)).forEach((l) => console.log('      ' + l.trim()));
  return m ? Number(m[1]) : 0;
}
function runFonts(label, bootstrap) {
  const out = runChild('verify-fonts.mjs', label, { AUDIT_URL: BASE + '/dashboard.html', AUDIT_BOOTSTRAP_JS: bootstrap });
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back (every requested family genuinely loads)', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family anywhere — the scheme is Inter (row 192)', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}
function runSheen() {
  const out = runChild('verify-glass-sheen.mjs', 'sheen audit', { SHEEN_PAGES: 'dashboard.html', SHEEN_PORT: '9448' });
  const tail = out.split('\n').filter((l) => /dashboard\.html\s+\d+ measured|SHEEN SWEEP/.test(l)).join(' | ').trim();
  console.log('  sheen -> ' + tail);
  const m = out.match(/dashboard\.html\s+(\d+) measured, (\d+) below 4\.5:1/);
  check('sheen audit on dashboard.html: text under the sheen measured (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check('sheen audit: nothing under the sheen falls below 4.5:1 and nothing UNMEASURED', !!m && Number(m[2]) === 0 && /SHEEN SWEEP: PASS/.test(out) && !/UNMEASURED/.test(out) && !/did not settle/.test(out), tail);
}

async function connectChrome() {
  const profile = makeTempDir('mw-dashrd-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + String((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + ((r.exceptionDetails.exception || {}).description || '') + ' :: ' + expr.slice(0, 120));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true }); // row 172: never measure through the cache
  trackChild(profile, chrome, ws);
  return { send, evaluate, errors, close: () => releaseTempDir(profile) };
}

// Desktop vs a REAL phone profile (row 228): DPR 3, touch, coarse pointer — asserted via
// matchMedia, never inferred from width.
async function setViewport(cdp, width, phone) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: phone ? 780 : 900, deviceScaleFactor: phone ? 3 : 1, mobile: !!phone, screenWidth: width, screenHeight: phone ? 780 : 900 });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!phone, maxTouchPoints: phone ? 5 : 1 });
  if (phone) await cdp.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  else await cdp.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' });
}
const PHONE_PROBE = '(()=>({w:document.documentElement.clientWidth,coarse:matchMedia("(pointer: coarse)").matches,nohover:matchMedia("(hover: none)").matches,dpr:window.devicePixelRatio,touch:navigator.maxTouchPoints}))()';

const GEOM = `(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const q = (s) => document.querySelector(s);
  const cells = [...document.querySelectorAll('.po-cell')].map(R);
  const cardR = R(q('#po-value-card'));
  const alloc = R(q('#allocation-card')), pockets = R(q('#po-maturities-card')), risk = R(q('#risk-card')), conv = R(q('#converter-card')), pend = R(q('#po-pending-card')), act = R(q('#activity-card')), wl = R(q('#watchlist-card'));
  const donut = R(q('#allocation-donut'));
  const tap = [...document.querySelectorAll('main a[href], main button, main select, main input, .po-rg')].filter((e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('[hidden]'); }).map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName, id: e.id || e.className.split(' ')[0], w: Math.round(r.width), h: Math.round(r.height), text: (e.textContent || '').trim().slice(0, 20) }; }).filter((t) => t.w > 0 && t.h > 0);
  const whenShown = [...document.querySelectorAll('.ac-when')].some((e) => getComputedStyle(e).display !== 'none');
  const whenFolded = q('.ac-s') ? getComputedStyle(q('.ac-s'), '::after').content : '(no activity row rendered)';
  const rightEdges = [...document.querySelectorAll('.po-cell, .po-row, .po-mat, .rm-row, .ac-row, .wl-card, .ad-row')].map((e) => e.getBoundingClientRect().right);
  const order = ['po-value-card', 'allocation-card', 'po-maturities-card', 'risk-card', 'converter-card', 'po-pending-card', 'activity-card', 'watchlist-card'].map((id) => Math.round(q('#' + id).getBoundingClientRect().top));
  return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, cells, cardR, alloc, pockets, risk, conv, pend, act, wl, donut: { w: donut.w, h: donut.h }, tap, whenShown, whenFolded, maxRight: Math.max(...rightEdges), order,
    chartH: R(q('#po-chart-wrap')).h, rangesW: R(q('#po-ranges')).w, cardW: cardR.w, sparkShown: !q('#po-spark').hasAttribute('hidden') && getComputedStyle(q('#po-spark')).display !== 'none',
    pillTop: R(q('#po-asof')).t, pillBottom: R(q('#po-asof')).b, pillRight: R(q('#po-asof')).r, maturedTop: q('.po-mat.is-matured') ? R(q('.po-mat.is-matured')).t : null, wlCols: (() => { const cs = [...document.querySelectorAll('.wl-card[data-wl-card]')]; if (!cs.length) return 0; const top = cs[0].getBoundingClientRect().top; return cs.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 2).length; })() };
})()`;

async function main() {
  console.log('Client dashboard redesign — real-browser verification (row 251)\n');
  const st = localStack();
  const url = st.API_URL;
  const admin = createClient(url, st.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(url, st.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
  const ids = [], simIds = [];
  const productRestore = [];
  const shotsDir = process.env.DR_SHOTS || null;
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  function bootstrapFor(session, clientId) {
    return 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(session)) + ');sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + ');';
  }
  async function makeClient(tag, name, cash) {
    const email = 'dashrd-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error(error.message);
    ids.push(data.user.id);
    await admin.from('clients').insert({ id: data.user.id, name, email: 'dashrd-' + tag + '-' + data.user.id, phone: '+1', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: data.user.id, unallocated_capital: cash, allocated_capital: 0, asset_returns: 0 });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error(sErr.message);
    return { id: data.user.id, email, token: s.session.access_token, bootstrap: bootstrapFor(s.session, data.user.id) };
  }
  async function shot(cdp, name) {
    if (!shotsDir) return;
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotsDir + '/' + name + '.png', Buffer.from(r.data, 'base64'));
  }
  async function loadDash(cdp, bootstrap, path) {
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(500);
    await cdp.evaluate(bootstrap);
    await cdp.send('Page.navigate', { url: BASE + '/' + (path || 'dashboard.html') });
    return cdp.evaluate(path === 'asset-performance.html' ? WAIT_AP : WAIT_ALL);
  }

  // ---- Gary, the established client ----------------------------------------------------
  const garyRow = await findFixtureClient(admin); // never an address literal in a suite (row 256)
  if (!garyRow) throw new Error('Gary is not seeded — run: node seed-client-gary.mjs');
  const garyPw = (process.env.GARY_SEED_PASSWORD || readFileSync(ROOT + 'supabase/functions/.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('GARY_SEED_PASSWORD=')).slice(19).trim().replace(/^["']|["']$/g, ''));
  const { data: gs, error: gErr } = await anon.auth.signInWithPassword({ email: garyRow.email, password: garyPw });
  if (gErr) throw new Error('Gary sign-in: ' + gErr.message);
  const gary = { id: garyRow.id, token: gs.session.access_token, bootstrap: bootstrapFor(gs.session, garyRow.id) };

  let cdp = null;
  try {
    // ---- E: nothing at all. S: one class, no pockets, one holding in a simulated product. ----
    const E = await makeClient('e', 'Redesign Empty', 0);
    const S = await makeClient('s', 'Redesign Single', 5000);
    const sim = await createSimulatedTestProduct(admin, suffix + 'S');
    simIds.push(sim.id);
    const sUnits = 6000 / Number(sim.unit_price);
    await admin.from('holdings').insert({ client_id: S.id, product_id: sim.id, units: sUnits, cost_basis: 5000 });
    await admin.from('transactions').insert([
      { client_id: S.id, type: 'DEPOSIT', total_value: 10000, status: 'completed', created_at: new Date(Date.now() - 20 * 86400000).toISOString() },
      { client_id: S.id, product_id: sim.id, type: 'BUY', units: sUnits, price: 5000 / sUnits, total_value: 5000, status: 'completed', created_at: new Date(Date.now() - 10 * 86400000).toISOString() }
    ]);

    // =====================================================================================
    console.log('1. Every figure against its source — Gary, server payloads vs the rendered page');
    // =====================================================================================
    const LED = await admin.from('transactions').select('type, total_value').eq('client_id', gary.id);
    const GH = (await admin.from('holdings').select('product_id, units, products(name, unit_price, asset_class)').eq('client_id', gary.id)).data;
    const pendRows = [];
    const ov0 = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
    const rs0 = (await callFunction(url, gary.token, 'get-returns-summary', {})).body;
    check('the overview carries the account in three parts (row 264) and the totals-level pricing summary', ov0.account && typeof ov0.account.total === 'number' && ov0.pricing && typeof ov0.pricing.affected === 'number', JSON.stringify(ov0.account));
    {
    const ov = ov0, rs = rs0, acct = ov.account;
    // Row 264: realised is NOT a fourth part. A sale credits its full proceeds to unallocated, so
    // the tally is already inside `unallocated` — a fourth segment would sum past the total.
    check('★ the identity holds server-side: total = deployed + unallocated + pockets = portfolio value + pockets, to the cent', Math.abs(acct.total - r2(acct.deployed + acct.unallocated + acct.pockets)) < 0.005 && Math.abs(acct.total - r2(ov.history.currentValue + acct.pockets)) < 0.005, JSON.stringify({ acct, portfolio: ov.history.currentValue }));
    check('★ ...and adding the realised tally on top would genuinely overstate it — proof the double-count is gone', acct.realised === 0 || Math.abs(acct.total - r2(acct.deployed + acct.unallocated + acct.pockets + acct.realised)) > 0.005, JSON.stringify({ total: acct.total, realised: acct.realised }));
    check('...and deployed equals get-returns-summary\'s currentValue (the same per-position rounding), realised equals its realized', Math.abs(acct.deployed - rs.currentValue) < 0.005 && Math.abs(acct.realised - rs.realized) < 0.005, JSON.stringify({ deployed: acct.deployed, rsCv: rs.currentValue, realised: acct.realised, rsR: rs.realized }));
    // Deposited: an independent ledger sum, external flows only.
    const { data: led } = LED;
    const depSum = r2(led.reduce((s, t) => s + (t.type === 'DEPOSIT' || t.type === 'HYS_DEPOSIT' ? Number(t.total_value) : t.type === 'WITHDRAWAL' || t.type === 'HYS_WITHDRAWAL' ? -Number(t.total_value) : 0), 0));
    check('deposited is the ledger\'s external flows (DEPOSIT + HYS_DEPOSIT − WITHDRAWAL − HYS_WITHDRAWAL), and NOT capitalIn.current', Math.abs(acct.deposited - depSum) < 0.005 && acct.deposited !== ov.history.capitalIn.current, JSON.stringify({ deposited: acct.deposited, ledger: depSum, capitalIn: ov.history.capitalIn.current }));
    // Pending ages against the REAL requested_at rows.
    for (const [t, type] of [['allocation_requests', 'allocation'], ['sell_requests', 'sell'], ['deposit_requests', 'deposit'], ['withdrawal_requests', 'withdrawal'], ['hys_deposit_requests', 'hys_deposit'], ['hys_withdrawal_requests', 'hys_withdrawal'], ['profile_change_requests', 'profile_change']]) {
      const { data } = await admin.from(t).select('id, requested_at').eq('client_id', gary.id).eq('status', 'pending');
      (data || []).forEach((r) => pendRows.push({ id: r.id, type, at: r.requested_at }));
    }
    check('★ every pending row\'s ageSeconds is now − its real requested_at (within the read\'s own seconds), and Gary\'s real allocation is days old', ov.pending.length === pendRows.length && ov.pending.every((p) => { const db = pendRows.find((x) => x.id === p.id); return db && Math.abs(p.ageSeconds - (Date.now() - new Date(db.at).getTime()) / 1000) < 90; }) && ov.pending.some((p) => p.ageSeconds > 86400), JSON.stringify(ov.pending.map((p) => [p.type, p.ageSeconds])));
    // Largest position: independently from holdings × prices.
    const posVals = GH.map((h) => ({ name: h.products.name, v: r2(Number(h.units) * Number(h.products.unit_price)), cls: h.products.asset_class }));
    const top = posVals.slice().sort((a, b) => b.v - a.v)[0];
    // Row 264: the tally is inside `unallocated` already, so it is not added here either.
    const tpvIndep = r2(acct.unallocated + r2(posVals.reduce((s, p) => s + p.v, 0)));
    check('largestPosition is the biggest holding as a share of TOTAL portfolio value (the PM briefing\'s own rule, 40% / $10k), not of deployed', rs.largestPosition && rs.largestPosition.name === top.name && Math.abs(rs.largestPosition.shareOfPortfolio - top.v / tpvIndep) < 0.0005 && rs.largestPosition.threshold === 0.4 && rs.largestPosition.minTpv === 10000, JSON.stringify(rs.largestPosition));
    }

    cdp = await connectChrome();
    await setViewport(cdp, 1440, false);
    // One throwaway warm-up load: the first invocation of every Edge Function pays its
    // compile cost, and the CDN scripts are cold too (the full-suite warm-up convention).
    await loadDash(cdp, gary.bootstrap);
    // ★ The catalog is LIVE-priced and the refresh cron lands every five minutes: a payload
    // read before the render and the page's own read can straddle a refresh (seen: $34,560.68
    // against $34,563.25 in one run). So: read, render, read again, and only compare once the
    // two reads agree — a disagreement means a refresh landed between and the render repeats.
    let ready = false, ov = null, rs = null, acct = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
      ready = await loadDash(cdp, gary.bootstrap);
      await sleep(1200);
      const after = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
      rs = (await callFunction(url, gary.token, 'get-returns-summary', {})).body;
      if (before.account.total === after.account.total && Math.abs(rs.currentValue - after.account.deployed) < 0.005) { ov = after; acct = ov.account; break; }
      console.log('      (a price refresh landed between the two reads — rendering again)');
    }
    if (!ov) throw new Error('could not get two agreeing overview reads around a render in four attempts');
    if (!ready) console.log('      DIAG errors: ' + JSON.stringify(cdp.errors.slice(-12)));
    check('the whole page rendered in the real browser — every async region past its skeleton', ready === true);
    await cdp.evaluate(WAIT_TEXT('tpv-amount', usd2(acct.total)));
    await shot(cdp, '01-gary-1440');
    let page = await cdp.evaluate(`(()=>{const g=(id)=>document.getElementById(id);const t=(id)=>g(id).textContent.replace(/\\s+/g,' ').trim();return {
      total:t('tpv-amount'), portfolio:t('po-portfolio-value'), pockets:t('po-pockets-value'), pocketsSub:t('po-pockets-sub'), change:t('po-change'), tm:t('tpv-monthly-change'),
      ret:t('total-return-amount'), retPct:t('total-return-pct'), split:t('total-return-split'), best:t('best-performing-class'), bestLabel:t('best-performing-label'), bestSub:t('best-performing-return'),
      title:document.querySelector('.po-title').textContent, chartTitle:document.querySelector('.po-ch-title').textContent, scope:document.querySelector('.po-ch-scope').textContent,
      pill:t('po-asof'), pillStale:g('po-asof').classList.contains('is-stale'), pillTitle:g('po-asof').getAttribute('title')||'',
      tbar:[...document.querySelectorAll('#po-tbar i')].map(i=>[i.dataset.part, parseFloat(i.style.width)]),
      legend:[...document.querySelectorAll('.ad-row')].map(r=>({name:r.querySelector('.ad-nm b').textContent, amt:r.querySelector('.ad-amt b').textContent, pct:parseFloat(r.querySelector('.ad-amt span').textContent)})),
      bands:[...document.querySelectorAll('.ad-val')].map(v=>v.textContent),
      cash:{sig:t('risk-cash-reserve'), v:t('risk-cash-value'), d:t('risk-cash-desc'), bar:parseFloat(g('risk-cash-bar').querySelector('i').style.width), mark:g('risk-cash-bar').querySelector('.rm-mark').style.left},
      util:{sig:t('risk-util-sig'), v:t('risk-allocation-util'), d:t('risk-util-desc')},
      largest:{sig:t('risk-largest-sig'), v:t('risk-largest-value'), name:t('risk-largest-name'), d:t('risk-largest-desc'), mark:g('risk-largest-bar').querySelector('.rm-mark').style.left},
      profile:{sig:t('risk-profile-badge'), d:t('risk-profile-desc'), link:t('risk-profile-link')},
      pending:[...document.querySelectorAll('#po-pending .po-row')].map(r=>({id:r.dataset.requestId, age:r.querySelector('.po-age').textContent, ageS:Number(r.querySelector('.po-age').dataset.ageSeconds)})), pendMeta:t('po-pending-meta'),
      mats:[...document.querySelectorAll('#po-maturities .po-mat')].map(m=>({status:m.dataset.status, kind:m.dataset.kind, name:m.querySelector('.po-mn').textContent, v:m.querySelector('.po-mv').textContent, md:m.querySelector('.po-md').textContent, act:!!m.querySelector('.po-mact')})), matMeta:t('po-maturities-meta'),
      activity:[...document.querySelectorAll('.ac-row')].map(r=>r.dataset.txnType), convert:t('convert-result'), convNote:t('convert-rate-note'),
      wlAges:[...document.querySelectorAll('.wl-card[data-wl-card] .wl-age')].map(a=>({t:a.textContent, iso:a.dataset.wlAge})),
      updatedJustNow:/Updated just now/.test(document.body.textContent)
    };})()`);
    check('★ the headline is the account total to the cent, titled "Total account value"; "Updated just now" appears nowhere on the page', page.total === usd2(acct.total) && page.title === 'Total account value' && !page.updatedJustNow, page.total);
    check('the THREE-part bar carries deployed / unallocated / pockets at their real shares of the total (row 264: no realised segment)', page.tbar.length === 3 && !page.tbar.some(([part]) => part === 'realised') && page.tbar.every(([part, w]) => Math.abs(w - (acct[part] / acct.total) * 100) < 0.02), JSON.stringify(page.tbar));
    check('growth since joining: +$' + Math.round(acct.growth).toLocaleString('en-US') + ' against ' + usd2(acct.deposited) + ' deposited', page.change.indexOf(usd0(acct.growth).replace('$', '+$') + ' since you joined') !== -1 && page.change.indexOf(usd2(acct.deposited) + ' deposited') !== -1, page.change);
    check('the band: Portfolio = the chart\'s measure, Savings pockets = the pockets total, with "one matured · one at 4.8%"', page.portfolio === usd2(ov.history.currentValue) && page.pockets === usd2(acct.pockets) && /2 pockets · one matured · one at 4\.8%/.test(page.pocketsSub), page.portfolio + ' | ' + page.pockets + ' | ' + page.pocketsSub);
    check('the band: Total return equals get-returns-summary\'s total with its percentage, unrealised and realised stated separately', page.ret === '+' + usd0(rs.total) && page.retPct === '+' + rs.totalPercent.toFixed(1) + '%' && page.split.indexOf('+' + usd0(rs.unrealized) + ' unrealised') !== -1 && page.split.indexOf(usd0(rs.realized) + ' realised') !== -1, JSON.stringify([page.ret, page.retPct, page.split]));
    check('the band: Best performing class is the server\'s bestClass with "of 2 classes" (Gary holds two)', page.best === rs.bestClass.assetClass && /of 2 classes/.test(page.bestSub) && page.bestLabel === 'Best performing class', page.bestLabel + ' ' + page.best + ' ' + page.bestSub);
    check('the chart is titled "Portfolio value over time" and states its scope (savings sit outside it)', page.chartTitle === 'Portfolio value over time' && /Charts the portfolio only/.test(page.scope) && /savings pockets sit outside/i.test(page.scope), page.scope);
    // Priced pill against the payload — whichever state this machine is in (row 213 can starve
    // the local rotation, which is a real amber reading, not a defect).
    if (ov.pricing.affected > 0) check('the priced pill matches the payload: AMBER, "' + ov.pricing.affected + ' of ' + ov.pricing.marketPriced + ' holdings …", naming every affected product', page.pillStale && page.pill.indexOf(ov.pricing.affected + ' of ' + ov.pricing.marketPriced + ' holdings') !== -1 && ov.pricing.affectedProducts.every((p) => page.pillTitle.indexOf(p.name) !== -1), page.pill + ' | ' + page.pillTitle);
    else check('the priced pill matches the payload: green, "Priced N min ago" from the oldest held market price', !page.pillStale && /^Priced .* ago$/.test(page.pill), page.pill);
    // Donut from byClass: each legend row's amount and percentage against the payload.
    const allocTotal = r2(rs.byClass.reduce((s, c) => s + c.currentValue, 0) + acct.unallocated);
    const legendOk = page.legend.every((row) => { const v = row.name === 'Unallocated' ? acct.unallocated : (rs.byClass.find((c) => c.assetClass === row.name) || {}).currentValue; return v !== undefined && row.amt === usd0(v) && Math.abs(row.pct - (v / allocTotal) * 100) < 0.06; });
    const pctSum = page.legend.reduce((s, r) => s + r.pct, 0);
    check('★ the donut legend is get-returns-summary.byClass + unallocated, every amount and percentage matching, summing to 100% (row 226\'s denominator; three one-decimal roundings)', legendOk && Math.abs(pctSum - 100) < 0.31 && page.legend.length === rs.byClass.filter((c) => c.currentValue > 0).length + (acct.unallocated > 0 ? 1 : 0), JSON.stringify(page.legend) + ' sum=' + pctSum);
    check('in-band labels: one per segment at or above 3%, none for a segment under 3% (Gary\'s 0.3% unallocated band carries none)', page.bands.length === page.legend.filter((r) => r.pct >= 3).length, JSON.stringify(page.bands));
    // Risk metrics, each against the payload.
    const portfolio = ov.history.currentValue;
    const cashPct = (acct.unallocated / portfolio) * 100, utilPct = (acct.deployed / portfolio) * 100, lpPct = rs.largestPosition.shareOfPortfolio * 100;
    check('Cash reserve: unallocated / portfolio (' + cashPct.toFixed(1) + '%) against the 20% target — the mark drawn at 20%, the badge a word', page.cash.v === cashPct.toFixed(1) + '%' && page.cash.sig === (cashPct < 20 ? 'Low' : 'Adequate') && page.cash.mark === '20%' && Math.abs(page.cash.bar - cashPct) < 0.06 && page.cash.d.indexOf(usd2(acct.unallocated)) !== -1, JSON.stringify(page.cash));
    check('Allocation utilisation: deployed / portfolio (' + utilPct.toFixed(1) + '%)', page.util.v === utilPct.toFixed(1) + '%' && page.util.d.indexOf(usd0(acct.deployed)) !== -1, JSON.stringify(page.util));
    check('★ Largest position: ' + rs.largestPosition.name + ' at ' + lpPct.toFixed(1) + '% of the portfolio, the 40% mark on its bar, the rule stated', page.largest.v === lpPct.toFixed(1) + '%' && page.largest.name === rs.largestPosition.name && page.largest.mark === '40%' && /Above 40%/.test(page.largest.d) && page.largest.sig === (rs.largestPosition.concentrated ? 'Concentrated' : lpPct >= 30 ? 'Watch' : 'OK'), JSON.stringify(page.largest));
    check('Risk profile with none set on this device: says so, "Not set", and the link reads "Set profile" — never a fabricated Balanced', page.profile.sig === 'Not set' && /No risk profile is set on this device/.test(page.profile.d) && page.profile.link === 'Set profile', JSON.stringify(page.profile));
    // Pending ages on screen vs the DB rows.
    const ageWord = (sec) => { if (sec < 60) return 'just now'; const m = Math.floor(sec / 60); if (m < 60) return m + ' min'; const h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour' : ' hours'); const d = Math.floor(h / 24); if (d < 14) return d + (d === 1 ? ' day' : ' days'); const w = Math.floor(d / 7); if (d < 60) return w + (w === 1 ? ' week' : ' weeks'); const mo = Math.floor(d / 30); return mo + (mo === 1 ? ' month' : ' months'); };
    check('★ every pending row\'s age on screen is derived from the real requested_at (' + page.pending.map((p) => p.age).join(', ') + ')', page.pending.length === pendRows.length && page.pending.every((p) => { const db = pendRows.find((x) => x.id === p.id); const sec = (Date.now() - new Date(db.at).getTime()) / 1000; return p.age === ageWord(sec) && Math.abs(p.ageS - sec) < 120; }) && page.pendMeta === pendRows.length + ' with your manager', JSON.stringify(page.pending));
    // Pockets vs hys_pockets.
    const { data: pk } = await admin.from('hys_pockets').select('id, status, amount, pocket_type, maturity_date').eq('client_id', gary.id).neq('status', 'withdrawn');
    const maturedRow = page.mats.find((m) => m.status === 'matured');
    check('★ the pockets panel: both live pockets, the MATURED one first, marked "earning nothing" with its action, header "2 pockets"', page.mats.length === pk.length && page.mats[0].status === 'matured' && maturedRow && /earning nothing/.test(maturedRow.md) && maturedRow.act && page.matMeta === '2 pockets', JSON.stringify(page.mats));
    check('each pocket\'s value is principal + accrued (the overview\'s own maturities figures) and they sum to the band\'s Savings cell', page.mats.every((m) => { const sv = ov.maturities.find((x) => x.name === m.name.split(' · ')[0] && (x.status === m.status)); return sv && m.v === usd2(sv.amount + (sv.interestAccrued || 0)); }) && Math.abs(ov.maturities.reduce((s, x) => s + x.amount + (x.interestAccrued || 0), 0) - acct.pockets) < 0.005, JSON.stringify(page.mats));
    check('Activity is transactions only, newest first, four rows', page.activity.length === 4 && page.activity.every((t) => /^(DEPOSIT|WITHDRAWAL|BUY|SELL|HYS_DEPOSIT|HYS_WITHDRAWAL|HYS_TRANSFER_IN)$/.test(t)), JSON.stringify(page.activity));
    check('the converter made no call on load: "—" and a prompt', page.convert === '—' && /Change the amount or a currency/.test(page.convNote), page.convert + ' ' + page.convNote);
    // Watchlist ages against get-watchlist's own lastUpdated.
    const wl = (await callFunction(url, gary.token, 'get-watchlist', {})).body;
    const wlRows = wl.symbols || wl.rows || wl;
    check('★ every market-snapshot card renders its OWN price age from get-watchlist\'s lastUpdated (' + page.wlAges.map((a) => a.t).join(', ') + ')', page.wlAges.length > 0 && page.wlAges.every((a) => a.iso && wlRows.some((r) => r.lastUpdated === a.iso) && /^(just now|\d+ min ago|\d+ h ago|\d+ d ago)$/.test(a.t)), JSON.stringify(page.wlAges));
    check('no console errors or uncaught exceptions on the real page', cdp.errors.length === 0, JSON.stringify(cdp.errors.slice(0, 5)));

    // =====================================================================================
    console.log('\n2. Total account value matches Asset & performance TO THE CENT — both pages, same run');
    // =====================================================================================
    // Same discipline: the two pages are compared against each other only when no refresh
    // landed between their renders (the payload read after the second page agrees with the
    // one that fed the first).
    let apTotal = null, apParts = null, apReady = false, apAcct = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      apReady = await loadDash(cdp, gary.bootstrap, 'asset-performance.html');
      await sleep(1500);
      apTotal = await cdp.evaluate('document.getElementById("ap-total-amount").textContent.trim()');
      apParts = await cdp.evaluate('[...document.querySelectorAll("#ap-total-parts .ap-tpv")].map(e=>e.textContent.trim())');
      apAcct = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body.account;
      if (apAcct.total === acct.total) break;
      console.log('      (a price refresh landed between the two pages — rendering the dashboard and Asset & performance again)');
      await loadDash(cdp, gary.bootstrap); await sleep(1200);
      const again = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
      acct = again.account; page.total = await cdp.evaluate('document.getElementById("tpv-amount").textContent.trim()');
    }
    check('asset-performance.html rendered its Total account value', apReady === true);
    check('★ ' + page.total + ' on the dashboard = ' + apTotal + ' on Asset & performance, to the cent, in the same browser session, against the same server read', apTotal === page.total && apTotal === usd2(acct.total) && apAcct.total === acct.total, page.total + ' vs ' + apTotal + ' vs ' + usd2(acct.total));
    check('...and its three parts are the same three figures the dashboard\'s bar and band are drawn from', apParts.length === 3 && apParts[0] === usd2(acct.deployed) && apParts[1] === usd2(acct.unallocated) && apParts[2] === usd2(acct.pockets), JSON.stringify(apParts) + ' vs ' + JSON.stringify(acct));

    // =====================================================================================
    console.log('\n3. The stale-price path — forced fresh, forced failed, cleared');
    // =====================================================================================
    // Snapshot every held market product's pricing columns, then force them all FRESH (the
    // green path is provable regardless of row 213's starvation on this machine).
    const heldIds = GH.map((h) => h.product_id);
    const { data: heldProducts } = await admin.from('products').select('id, ticker, pricing_model, price_status, price_as_of, price_last_failed_at, price_failure_reason').in('id', heldIds);
    heldProducts.forEach((p) => productRestore.push(p));
    const marketHeld = heldProducts.filter((p) => p.pricing_model === 'market');
    const freshIso = new Date().toISOString();
    await admin.from('products').update({ price_status: 'ok', price_as_of: freshIso, price_failure_reason: null }).in('id', marketHeld.map((p) => p.id));
    const ovFresh = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
    check('forced fresh: the payload reports 0 affected of ' + marketHeld.length + ' market-priced, oldest = the forced timestamp', ovFresh.pricing.affected === 0 && ovFresh.pricing.marketPriced === marketHeld.length && ovFresh.pricing.oldestPriceAsOf && Math.abs(new Date(ovFresh.pricing.oldestPriceAsOf) - new Date(freshIso)) < 2000, JSON.stringify(ovFresh.pricing));
    await loadDash(cdp, gary.bootstrap);
    const greenPill = await cdp.evaluate('(()=>{const p=document.getElementById("po-asof");return {t:p.textContent.trim(),stale:p.classList.contains("is-stale"),hidden:p.hidden}})()');
    check('★ GREEN: the pill reads "Priced just now" and is not amber', !greenPill.stale && !greenPill.hidden && greenPill.t === 'Priced just now', JSON.stringify(greenPill));
    await shot(cdp, '02-pill-green');
    runContrast('portfolio-overview', 'Gary, gain, priced pill green', gary.bootstrap);
    runContrast('allocation-donut', 'Gary, in-band donut labels (dark ink on the pale fills)', gary.bootstrap);
    runContrast('watchlist', 'Gary, market snapshot with per-card ages', gary.bootstrap);

    // Force ONE stock to quote_failed (a stock, not a coin: the crypto batch would clear it
    // on the next 5-minute cycle; a stock at the FRONT of the rotation's age order is last
    // in line). price_as_of stays fresh so no cache row is newer to clear it either.
    const victim = marketHeld.find((p) => /^[A-Z.]+$/.test(String(p.ticker)) && !/BTC|ETH|SOL/.test(p.ticker)) || marketHeld[0];
    await admin.from('products').update({ price_status: 'quote_failed', price_last_failed_at: new Date().toISOString(), price_failure_reason: 'forced by verify-dashboard-redesign' }).eq('id', victim.id);
    const ovFail = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
    const rsFail = (await callFunction(url, gary.token, 'get-returns-summary', {})).body;
    const holdFail = (await callFunction(url, gary.token, 'get-holdings', {})).body;
    const victimPos = rsFail.positions.find((p) => p.productId === victim.id);
    check('★ FORCED: get-portfolio-overview reports failed 1, affected 1, naming the product and carrying its value', ovFail.pricing.failed === 1 && ovFail.pricing.affected === 1 && ovFail.pricing.affectedProducts.length === 1 && ovFail.pricing.affectedProducts[0].productId === victim.id && ovFail.pricing.affectedProducts[0].status === 'failed' && ovFail.pricing.affectedValue === victimPos.currentValue, JSON.stringify(ovFail.pricing));
    check('★ ...get-returns-summary carries the same summary AND the position itself reads priceStatus quote_failed with its last good price kept', rsFail.pricing.failed === 1 && rsFail.pricing.affectedProducts[0].productId === victim.id && victimPos.priceStatus === 'quote_failed' && victimPos.priceStale === false && victimPos.unitPrice > 0 && rsFail.positions.filter((p) => p.productId !== victim.id).every((p) => p.priceStatus === 'ok'), JSON.stringify(victimPos));
    check('...get-holdings carries priceStatus quote_failed on that row and ok on every other', holdFail.find((h) => h.productId === victim.id).priceStatus === 'quote_failed' && holdFail.filter((h) => h.productId !== victim.id).every((h) => h.priceStatus === 'ok' || h.pricingModel !== 'market'), JSON.stringify(holdFail.map((h) => [h.productId, h.priceStatus])));
    await loadDash(cdp, gary.bootstrap);
    await cdp.evaluate(WAIT_TEXT('tpv-amount', usd2(ovFail.account.total)));
    const amber = await cdp.evaluate('(()=>{const p=document.getElementById("po-asof");return {t:p.textContent.trim(),stale:p.classList.contains("is-stale"),title:p.getAttribute("title")||"",total:document.getElementById("tpv-amount").textContent.trim()}})()');
    check('★ AMBER: the pill turns amber and states "1 of ' + marketHeld.length + ' holdings failed to price — total may be out of date", naming ' + (victim.ticker || victim.id) + ' in its detail', amber.stale && amber.t === '1 of ' + marketHeld.length + ' holdings failed to price \u2014 total may be out of date' && amber.title.indexOf('last refresh failed') !== -1 && amber.title.indexOf('(' + victim.ticker + ')') !== -1, JSON.stringify(amber));
    check('...and the total still renders (the LAST GOOD price is kept, never a $0) — the flag is the disclosure, not a blank', amber.total === usd2(ovFail.account.total) && ovFail.account.total > 0, amber.total);
    await shot(cdp, '03-pill-amber');
    runContrast('portfolio-overview-stale', 'Gary, the AMBER pill composited under the sheen', gary.bootstrap);

    // Clear: restore every held product's original columns and confirm the baseline returns.
    for (const p of heldProducts) await admin.from('products').update({ price_status: p.price_status, price_as_of: p.price_as_of, price_last_failed_at: p.price_last_failed_at, price_failure_reason: p.price_failure_reason }).eq('id', p.id);
    productRestore.length = 0;
    const ovClear = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
    // The machine's own stale set can move during a ten-minute run (a real refresh cycle
    // lands, a symbol crosses the threshold) — what is asserted is that the FORCED failure is
    // gone, and that the pill agrees with whatever the payload now says.
    check('★ CLEARED: the payload no longer reports the forced failure (failed 0; ' + (victim.ticker || victim.id) + ' is not listed as failed — it may legitimately be STALE again on this machine, a different condition)', ovClear.pricing.failed === 0 && !ovClear.pricing.affectedProducts.some((p) => p.productId === victim.id && p.status === 'failed'), JSON.stringify(ovClear.pricing));
    // The pill against a payload read AFTER the render (the refresh cron can re-price the
    // restored products between two reads a minute apart — seen: "3 stale" then a green
    // "Priced 55 min ago"); a straddle is rendered again rather than argued with.
    let cleared = null, ovAfter = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await loadDash(cdp, gary.bootstrap);
      cleared = await cdp.evaluate('(()=>{const p=document.getElementById("po-asof");return {t:p.textContent.trim(),stale:p.classList.contains("is-stale")}})()');
      ovAfter = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
      if (cleared.stale === (ovAfter.pricing.affected > 0)) break;
      console.log('      (a price refresh landed between the render and the read — rendering again)');
    }
    check('...and the pill no longer says "failed" — it reads whatever the payload now reports (' + (ovAfter.pricing.affected > 0 ? ovAfter.pricing.affected + ' stale' : 'green') + ')', cleared.t.indexOf('failed') === -1 && cleared.stale === (ovAfter.pricing.affected > 0), JSON.stringify({ cleared, pricing: ovAfter.pricing }));

    // =====================================================================================
    console.log('\n4. Edge states — no holdings; one class with no pockets');
    // =====================================================================================
    const eReady = await loadDash(cdp, E.bootstrap);
    await sleep(600);
    await shot(cdp, '04-empty');
    const ep = await cdp.evaluate(`(()=>{const g=(id)=>document.getElementById(id);const t=(id)=>g(id).textContent.replace(/\\s+/g,' ').trim();return {ready:true,total:t('tpv-amount'),change:g('po-change').hidden,pill:t('po-asof'),best:t('best-performing-class'),bestSub:t('best-performing-return'),legend:t('allocation-legend'),deploy:!!document.querySelector('#allocation-legend a[href="deploy-capital.html"]'),ring:document.querySelectorAll('#allocation-ring path').length,pockets:t('po-pockets-sub'),mats:t('po-maturities'),pending:t('po-pending'),activity:t('recent-activity-list'),cash:t('risk-cash-reserve'),largest:t('risk-largest-value'),largestD:t('risk-largest-desc'),profile:t('risk-profile-badge'),tbar:document.querySelectorAll('#po-tbar i').length};})()`);
    check('★ no holdings, nothing deposited: $0.00 total, no growth line, "No holdings to price", class "—", the donut empty state with Deploy Capital, "No savings pockets yet", both panels\' empty states, risk rows honest', eReady === true && ep.total === '$0.00' && ep.change === true && ep.pill === 'No holdings to price' && ep.best === '\u2014' && /No holdings yet/.test(ep.bestSub) && /No capital deployed yet/.test(ep.legend) && ep.deploy && ep.ring === 0 && /No savings pockets yet/.test(ep.pockets) && /No savings pockets yet/.test(ep.mats) && /Nothing pending/.test(ep.pending) && /No activity yet/.test(ep.activity) && ep.cash === 'Empty' && ep.largest === '\u2014' && /No positions held yet/.test(ep.largestD) && ep.profile === 'Not set' && ep.tbar === 0, JSON.stringify(ep));
    runContrast('portfolio-overview-new', 'empty client — empty states and flat badges', E.bootstrap);

    const sReady = await loadDash(cdp, S.bootstrap);
    await sleep(600);
    await shot(cdp, '05-single-class');
    const sOv = (await callFunction(url, S.token, 'get-portfolio-overview', {})).body;
    const sRs = (await callFunction(url, S.token, 'get-returns-summary', {})).body;
    const sp = await cdp.evaluate(`(()=>{const g=(id)=>document.getElementById(id);const t=(id)=>g(id).textContent.replace(/\\s+/g,' ').trim();return {total:t('tpv-amount'),change:t('po-change'),pill:t('po-asof'),bestLabel:t('best-performing-label'),best:t('best-performing-class'),bestSub:t('best-performing-return'),ring:document.querySelectorAll('#allocation-ring path').length,evenodd:!!document.querySelector('#allocation-ring path[fill-rule="evenodd"]'),legend:[...document.querySelectorAll('.ad-row')].length,pockets:t('po-pockets-value'),pocketsSub:t('po-pockets-sub'),mats:t('po-maturities'),largest:t('risk-largest-value'),largestSig:t('risk-largest-sig'),tbar:[...document.querySelectorAll('#po-tbar i')].map(i=>i.dataset.part)};})()`);
    const sTpv = sOv.account.total;
    check('★ one class, no pockets: total = deployed + unallocated (no pockets segment, no realised segment), "Asset class" with no comparison, no "of N classes"', sReady === true && sp.total === usd2(sTpv) && sp.tbar.join(',') === 'deployed,unallocated' && sp.bestLabel === 'Asset class' && sp.best === 'Stocks & ETFs' && !/of \d+ classes/.test(sp.bestSub) && !/every class/.test(sp.bestSub), JSON.stringify(sp));
    check('...the donut is TWO bands (the class and unallocated), the pockets cell $0.00 "No savings pockets yet"', sp.ring === 2 && sp.legend === 2 && sp.pockets === '$0.00' && /No savings pockets yet/.test(sp.pocketsSub) && /No savings pockets yet/.test(sp.mats), JSON.stringify(sp));
    check('...a simulated (non-market) holding: the pill says "No market-priced holdings", and Largest position is that one holding at its real share', sp.pill === 'No market-priced holdings' && sOv.pricing.marketPriced === 0 && sp.largest === (sRs.largestPosition.shareOfPortfolio * 100).toFixed(1) + '%' && sRs.largestPosition.concentrated === (sTpv >= 10000 && sRs.largestPosition.shareOfPortfolio >= 0.4) && sp.largestSig === (sRs.largestPosition.concentrated ? 'Concentrated' : sRs.largestPosition.shareOfPortfolio >= 0.3 ? 'Watch' : 'OK'), JSON.stringify({ sp, lp: sRs.largestPosition }));
    check('growth since joining for the single client: total − $10,000 deposited = the $1,000 unrealised gain', sp.change.indexOf('+$1,000 since you joined') !== -1 && sp.change.indexOf('$10,000.00 deposited') !== -1 && Math.abs(sOv.account.growth - (sTpv - 10000)) < 0.005 && Math.abs(sOv.account.growth - 1000) < 0.005, sp.change);

    console.log('\n=== FONTS + SHEEN ===\n');
    runFonts('dashboard.html (Gary)', gary.bootstrap);
    runSheen();

    // =====================================================================================
    console.log('\n5. Layout — 1440 desktop, 900 tablet, 390/375 on a real phone profile, 320 via iframe');
    // =====================================================================================
    for (const [width, phone] of [[1440, false], [900, false], [390, true], [375, true]]) {
      await setViewport(cdp, width, phone);
      let ok = await loadDash(cdp, gary.bootstrap);
      await sleep(1200); // the count-up settles
      // A region that answered with its error card (a cold 5xx under load) is not a layout
      // result: reload once and say so, rather than measure a Try Again button as the row.
      if (await cdp.evaluate('document.querySelectorAll("[data-retry]").length') > 0) {
        console.log('      (' + width + 'px: a region showed its error card — ' + JSON.stringify(await cdp.evaluate('[...document.querySelectorAll("[data-retry]")].map(b=>b.closest("[id]")&&b.closest("[id]").id)')) + ' — reloading once)');
        ok = await loadDash(cdp, gary.bootstrap);
        await sleep(1200);
      }
      const probe = await cdp.evaluate(PHONE_PROBE);
      check(width + 'px: the browser genuinely reports that width' + (phone ? ', on a REAL phone profile (coarse pointer, no hover, DPR 3, touch)' : ''), probe.w === width && (!phone || (probe.coarse && probe.nohover && probe.dpr === 3 && probe.touch > 0)), JSON.stringify(probe));
      const g = await cdp.evaluate(GEOM);
      if (!ok) console.log('      DIAG ' + width + 'px errors: ' + JSON.stringify(cdp.errors.slice(-8)));
      check(width + 'px: the page rendered; no horizontal overflow; nothing escapes the viewport', ok === true && g.bodyScroll <= g.inner + 1 && g.maxRight <= g.inner + 1, JSON.stringify({ bodyScroll: g.bodyScroll, inner: g.inner, maxRight: g.maxRight }));
      check(width + 'px: the page order is portfolio → allocation/pockets → risk/converter → pending/activity → market snapshot last', g.order.every((t, i) => i === 0 || t >= g.order[i - 1] - 1), JSON.stringify(g.order));
      const under = g.tap.filter((t) => t.h < 44 || t.w < 44);
      if (width < 1024) check(width + 'px: every tap target holds 44px (' + g.tap.length + ' controls)', under.length === 0, JSON.stringify(under.slice(0, 8)));
      if (width === 1440) {
        check('1440px: the band is FOUR cells in one row, the sparkline shown', g.cells.length === 4 && g.cells.every((c) => Math.abs(c.t - g.cells[0].t) < 2) && g.sparkShown, JSON.stringify(g.cells));
        check('1440px: allocation beside pockets, risk beside the converter, pending beside activity (two-up rows)', Math.abs(g.alloc.t - g.pockets.t) < 2 && g.pockets.l > g.alloc.r - 1 && Math.abs(g.risk.t - g.conv.t) < 2 && Math.abs(g.pend.t - g.act.t) < 2, JSON.stringify([g.alloc, g.pockets, g.risk, g.conv]));
        check('1440px: ★ the matured pocket is on screen without scrolling at 1440×900 — its row\'s top is inside the viewport', g.maturedTop !== null && g.maturedTop < 900 - 24, JSON.stringify({ maturedTop: g.maturedTop, pockets: g.pockets }));
        check('1440px: activity shows its date column', g.whenShown === true);
        check('1440px: the market snapshot is three-up', g.wlCols === 3, String(g.wlCols));
      } else if (width === 900) {
        check('900px (tablet): the band goes TWO-up — two rows of two cells', g.cells.length === 4 && Math.abs(g.cells[0].t - g.cells[1].t) < 2 && g.cells[2].t >= g.cells[0].b - 1 && Math.abs(g.cells[2].t - g.cells[3].t) < 2, JSON.stringify(g.cells));
        check('900px: the card rows stack to one column', g.pockets.t >= g.alloc.b - 1 && g.conv.t >= g.risk.b - 1, JSON.stringify([g.alloc, g.pockets]));
      } else {
        check(width + 'px: the band STACKS — one cell per row, the sparkline hidden', g.cells.length === 4 && g.cells[1].t >= g.cells[0].b - 1 && g.cells[2].t >= g.cells[1].b - 1 && g.cells[3].t >= g.cells[2].b - 1 && !g.sparkShown, JSON.stringify(g.cells));
        check(width + 'px: the chart is shorter (≤ 160px) with full-width range controls', g.chartH <= 160 && g.rangesW >= g.cardW - 60, JSON.stringify({ chartH: g.chartH, rangesW: g.rangesW, cardW: g.cardW }));
        check(width + 'px: the donut grows on its own row (≥ 150px)', g.donut.w >= 150, JSON.stringify(g.donut));
        check(width + 'px: activity folds its date into the sub-line rather than dropping it', g.whenShown === false && /\d{4}/.test(g.whenFolded), JSON.stringify({ whenShown: g.whenShown, whenFolded: g.whenFolded }));
        check(width + 'px: the priced pill wraps beneath the title and stays inside the card', g.pillRight <= g.cardR.r + 1 && g.pillBottom <= g.cells[0].t + 1, JSON.stringify({ pill: [g.pillTop, g.pillBottom, g.pillRight], card: g.cardR }));
        check(width + 'px: the market snapshot is one-up (row 206\'s measured decision at 390 — the mockup\'s two-up is a reported deviation)', g.wlCols === 1, String(g.wlCols));
      }
      await shot(cdp, '06-layout-' + width);
    }

    // 320px through a real same-origin iframe (the top-level override floors at ~348px).
    await setViewport(cdp, 900, true);
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(1500);
    const narrow = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 80 && !document.body; i++) await nap(100);
      const f = document.createElement('iframe');
      f.style.cssText = 'width:320px;height:900px;border:0';
      f.src = '/dashboard.html';
      document.body.appendChild(f);
      await new Promise(r => f.addEventListener('load', r));
      const d = f.contentDocument, w = f.contentWindow;
      const ids=["tpv-amount","po-pending","po-maturities","total-return-split","allocation-legend","recent-activity-list","risk-cash-desc"];
      for (let i = 0; i < 240; i++) { if (ids.every(id=>{const e=d.getElementById(id);return e&&!/animate-pulse/.test(e.innerHTML)&&e.textContent.trim().length>0}) && d.querySelector('.wl-card[data-wl-card]')) break; await nap(250); }
      for (let i = 0; i < 40; i++) { if (/^\\$[\\d,]+\\.\\d{2}$/.test(d.getElementById('tpv-amount').textContent.trim()) && !d.getElementById('tpv-amount').querySelector('span')) { await nap(1200); break; } await nap(100); }
      const R = (el) => el.getBoundingClientRect();
      const cells = [...d.querySelectorAll('.po-cell')].map(R);
      const edges = [...d.querySelectorAll('.po-cell, .po-row, .po-mat, .rm-row, .ac-row, .wl-card, .ad-row, #tpv-amount, #po-asof')].map(e => R(e).right);
      const tap = [...d.querySelectorAll('main a[href], main button, main select, main input, .po-rg')].filter((e) => { const cs = w.getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('[hidden]'); }).map((e) => { const r = R(e); return { id: e.id || e.className.split(' ')[0], w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.w > 0 && t.h > 0);
      const wlCards = [...d.querySelectorAll('.wl-card[data-wl-card]')];
      return { reported: d.documentElement.clientWidth, inner: w.innerWidth, bodyScroll: d.body.scrollWidth, maxRight: Math.max(...edges), value: d.getElementById('tpv-amount').textContent.trim(),
        stacked: cells.length === 4 && cells[1].top >= cells[0].bottom - 1 && cells[3].top >= cells[2].bottom - 1, under: tap.filter((t) => t.h < 44 || t.w < 44), donutW: R(d.getElementById('allocation-donut')).width,
        wlCols: wlCards.length ? wlCards.filter((c) => Math.abs(R(c).top - R(wlCards[0]).top) < 2).length : 0 };
    })()`);
    const ovNow = (await callFunction(url, gary.token, 'get-portfolio-overview', {})).body;
    check('320px: the iframe genuinely reports 320px and the page rendered the real total to the cent (read beside it — live prices move during a run)', narrow.reported === 320 && /^\$[\d,]+\.\d{2}$/.test(narrow.value) && (narrow.value === usd2(ovNow.account.total) || narrow.value === usd2(acct.total)), JSON.stringify({ narrow, now: ovNow.account.total, start: acct.total }));
    check('320px: no horizontal overflow; nothing escapes the viewport', narrow.bodyScroll <= narrow.inner + 1 && narrow.maxRight <= narrow.inner + 1, JSON.stringify(narrow));
    check('320px: the band stacks, the donut still ≥ 140px, the market snapshot one-up', narrow.stacked && narrow.donutW >= 140 && narrow.wlCols === 1, JSON.stringify(narrow));
    check('320px: every tap target holds 44px', narrow.under.length === 0, JSON.stringify(narrow.under.slice(0, 8)));
  } finally {
    if (cdp) await cdp.close();
    // Any product forced mid-run and not yet restored (a throw between force and clear).
    for (const p of productRestore) await admin.from('products').update({ price_status: p.price_status, price_as_of: p.price_as_of, price_last_failed_at: p.price_last_failed_at, price_failure_reason: p.price_failure_reason }).eq('id', p.id);
    for (const t of ['portfolio_value_snapshots', 'holdings', 'transactions', 'account_state', 'client_profiles', 'watchlist_symbols']) await admin.from(t).delete().in('client_id', ids);
    await admin.from('clients').delete().in('id', ids);
    for (const id of ids) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.error('CLEANUP: ' + error.message); }
    for (const id of simIds) await deleteSimulatedTestProduct(admin, id);
    await anon.auth.signOut({ scope: 'local' }).catch(() => {});
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
}

runVerifyMain(main, { watchdogMs: 20 * 60 * 1000 });
