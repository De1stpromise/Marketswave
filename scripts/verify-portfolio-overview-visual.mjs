#!/usr/bin/env node
// ★ Portfolio overview (2026-09-12; bundled card 2026-09-13) — visual verification in a real
// browser.
//
// What the jsdom suite cannot prove, proven here: a REAL Chart.js instance whose portfolio
// dataset equals the rows in portfolio_value_snapshots (cross-checked against the table
// itself), whose capital-in dataset steps at the real ledger dates, and whose event dots sit
// on the drawn line; a real hover producing the three-row HTML tooltip with the exact date,
// value, capital in and return; the range controls redrawing the real chart AND recomputing
// the period-stats footer; contrast on every text surface of the bundled card measured
// composited on the glass — the 38px value figure under the sheen corner included — in both
// change tones, in the new-client state, and inside the open tooltip; the split bar, the
// sparkline, the capital-in line and the event dots measured as graphical objects (3:1);
// fonts (Inter only, figures tabular by real advance width); and 1440/390/375 plus a real
// 320px iframe — the band collapsing to one column being the layout risk the brief named.
//
// Three real clients are seeded through the real writer (snapshot-portfolio-values with a
// monthStartDate — never a direct insert) with real ledger rows placed in time: an
// established gaining client, a losing client, and a new client under the threshold. Every
// measurement sits behind a viewport-integrity guard; 320px goes through a real same-origin
// iframe because the top-level override floors at 348px on this build.
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
// Set PO_SHOTS=<dir> to also save screenshots of each state for a human look.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'VerifyOverviewVisual-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9446;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function callFunction(url, token, name, body) {
  const r = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  let json = null; try { json = await r.json(); } catch (_e) {}
  return { status: r.status, body: json };
}
const monthStart = (offset) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1)).toISOString().slice(0, 10); };

// Waits for the overview bundle to have rendered — the value figure no longer a skeleton and,
// when a chart is expected, a real Chart.js instance bound to the canvas.
const WAIT_OVERVIEW = (needChart) => '(async()=>{for(let i=0;i<200;i++){const v=document.getElementById("tpv-monthly-change");const p=document.getElementById("po-pending");const t=document.getElementById("total-return-split");const a=document.getElementById("tpv-amount");const ok=v&&p&&t&&a&&!/animate-pulse/.test(v.innerHTML)&&!/animate-pulse/.test(p.innerHTML)&&!/animate-pulse/.test(t.innerHTML)&&!/animate-pulse/.test(a.innerHTML)' + (needChart ? '&&window.Chart&&Chart.getChart("po-chart")' : '') + ';if(ok)return true;await new Promise(r=>setTimeout(r,250));}return false;})()';
// Hover the second anchor of the real chart with a real DOM mouse event so the external
// tooltip opens before the contrast run samples it.
const HOVER_TIP = '(async()=>{const ok=await ' + WAIT_OVERVIEW(true) + ';if(!ok)return false;const c=Chart.getChart("po-chart");const e=c.getDatasetMeta(0).data[1];const r=c.canvas.getBoundingClientRect();c.canvas.dispatchEvent(new MouseEvent("mousemove",{clientX:r.left+e.x,clientY:r.top+e.y,bubbles:true}));await new Promise(r=>setTimeout(r,700));return document.querySelector(".po-tip.is-on")!==null;})()';

function runContrast(profile, label, bootstrap, prepare) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      CONTRAST_PROFILE: profile,
      CONTRAST_URL: BASE + '/dashboard.html',
      CONTRAST_BOOTSTRAP_JS: bootstrap,
      CONTRAST_PREPARE_JS: prepare || WAIT_OVERVIEW(false),
      CONTRAST_SETTLE_MS: '4000',
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

function runFonts(label, bootstrap) {
  const res = spawnSync(process.execPath, ['audit-fonts.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { AUDIT_URL: BASE + '/dashboard.html', AUDIT_BOOTSTRAP_JS: bootstrap })
  });
  forwardChildTeardown(res, 'audit-fonts');
  const out = (res.stdout || '') + (res.stderr || '');
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back (every requested family genuinely loads)', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family anywhere — the scheme is Inter (row 192)', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}

async function connectChrome() {
  const profile = makeTempDir('mw-povis-');
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
  let bindingHandler = null;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.bindingCalled' && m.params.name === '__mwShot' && bindingHandler) bindingHandler(m.params.payload);
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
  // Installed on every new document: __shotUri() posts to the binding and waits for Node.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__shotUri = () => new Promise((res) => { window.__mwShotResolve = res; window.__mwShot("shot"); });' });
  return { send, evaluate, errors, onBinding: (fn) => { bindingHandler = fn; }, close: () => releaseTempDir(profile) };
}

const GEOM = `(() => {
  const card = document.getElementById('po-value-card').getBoundingClientRect();
  const cv = document.getElementById('po-chart').getBoundingClientRect();
  const pend = document.getElementById('po-pending-card').getBoundingClientRect();
  const mat = document.getElementById('po-maturities-card').getBoundingClientRect();
  const rows = [...document.querySelectorAll('#po-pending .po-row, #po-maturities .po-mat')].map(r => r.getBoundingClientRect().right);
  const rg = [...document.querySelectorAll('.po-rg')].map(b => Math.round(b.getBoundingClientRect().height));
  const cells = [...document.querySelectorAll('.po-cell')].map(c => { const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  const stats = [...document.querySelectorAll('#po-stats > div')].map(c => { const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right }; });
  const figs = [...document.querySelectorAll('#tpv-amount, #total-return-amount, .ret-class, #tpv-monthly-change, #total-return-split, #best-performing-return')].map(e => e.getBoundingClientRect().right);
  return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, canvasW: Math.round(cv.width), canvasRight: cv.right, cardRight: card.right, cardLeft: card.left, cardW: card.width,
    pend: { l: pend.left, t: pend.top, b: pend.bottom, r: pend.right }, mat: { l: mat.left, t: mat.top, r: mat.right }, maxRowRight: Math.max(...rows), rangeHeights: rg,
    cells, stats, maxFigRight: Math.max(...figs), noExport: !document.getElementById('po-export') && !document.querySelector('.po-hd button'),
    sparkShown: !document.getElementById('po-spark').hidden && getComputedStyle(document.getElementById('po-spark')).display !== 'none',
    chartPts: (Chart.getChart('po-chart') || { data: { datasets: [{ data: [] }] } }).data.datasets[0].data.length };
})()`;


// The same in-page pixel sampler verify-contrast.mjs uses; the screenshot itself comes from
// CDP, handed in as a data URI by __shotUri (bound below once the CDP session exists).
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

async function main() {
  console.log('Portfolio overview — visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: pmSess, error: pmErr } = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('PM sign-in: ' + pmErr.message);
  const pmToken = pmSess.session.access_token;
  const suffix = crypto.randomBytes(3).toString('hex');
  const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
  const ids = [], pocketIds = [];

  async function makeClient(tag, name, cash) {
    const email = 'povis-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error(error.message);
    ids.push(data.user.id);
    await admin.from('clients').insert({ id: data.user.id, name, email: 'povis-' + tag + '-' + data.user.id, phone: '+1', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: data.user.id, unallocated_capital: cash, allocated_capital: 0, asset_returns: 0 });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error(sErr.message);
    const bootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(s.session)) + ');sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(data.user.id) + ');sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(data.user.id) + ');true';
    return { id: data.user.id, email, token: s.session.access_token, bootstrap };
  }
  async function anchors(client, plan) {
    for (const [offset, cash] of plan) {
      await admin.from('account_state').update({ unallocated_capital: cash }).eq('client_id', client.id);
      const r = await callFunction(url, pmToken, 'snapshot-portfolio-values', { monthStartDate: monthStart(offset), clientId: client.id });
      if (r.status !== 200) throw new Error('snapshot writer: ' + JSON.stringify(r.body));
    }
  }

  const msAt = (offset, day) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, day)).toISOString(); };
  async function backdateAnchors(client, offsets) {
    for (const off of offsets) await admin.from('portfolio_value_snapshots').update({ created_at: msAt(off, 1) }).eq('client_id', client.id).eq('month_start_date', monthStart(off));
  }
  const shotsDir = process.env.PO_SHOTS || null;
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  async function shot(cdp, name) {
    if (!shotsDir) return;
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotsDir + '/' + name + '.png', Buffer.from(r.data, 'base64'));
  }

  try {
    // A: gaining. Four anchors, each backdated to its own month start, with the same real
    // ledger shape the ui-wiring suite uses — a deposit before the first anchor, a withdrawal,
    // a transfer to savings, an EXCLUDED external pocket deposit, a deposit this month — and a
    // consistent end state (110,000 net capital in as unallocated + 18,000 realised).
    const A = await makeClient('a', 'Overview Visual A', 100000);
    await anchors(A, [[3, 100000], [2, 112000], [1, 109500], [0, 118000]]);
    await backdateAnchors(A, [3, 2, 1, 0]);
    await admin.from('account_state').update({ unallocated_capital: 110000, asset_returns: 18000 }).eq('client_id', A.id);
    await admin.from('transactions').insert([
      { client_id: A.id, type: 'DEPOSIT', total_value: 100000, status: 'completed', created_at: msAt(4, 20) },
      { client_id: A.id, type: 'WITHDRAWAL', total_value: 2000, status: 'completed', created_at: msAt(2, 10) },
      { client_id: A.id, type: 'HYS_TRANSFER_IN', total_value: 3000, status: 'completed', created_at: msAt(1, 12) },
      { client_id: A.id, type: 'HYS_DEPOSIT', total_value: 5000, status: 'completed', created_at: msAt(1, 15) },
      { client_id: A.id, type: 'DEPOSIT', total_value: 15000, status: 'completed', created_at: msAt(0, 3) }
    ]);
    for (const [fn, body] of [
      ['request-withdrawal', { method: 'bank', amount: 2500, currency: 'USD', destinationDetails: { bank: 'Test Bank', account: '123' } }],
      ['request-allocation', { productId: 'PROD-0003', dollarAmount: 3000 }],
      ['request-hys-deposit', { pocketType: 'fixed', term: { mode: 'short', value: 6 }, amount: 6000, method: 'internal', details: {} }]
    ]) { const r = await callFunction(url, A.token, fn, body); if (r.status !== 200) throw new Error(fn + ': ' + JSON.stringify(r.body)); }
    const now = Date.now(), day = 86400000;
    const { data: pk } = await admin.from('hys_pockets').insert([
      { client_id: A.id, pocket_type: 'fixed', amount: 52400, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5, maturity_date: new Date(now + 60 * day).toISOString(), projected_interest: 2227, funding_method: 'bank account', created_at: new Date(now - 120 * day).toISOString() },
      { client_id: A.id, pocket_type: 'ayw', amount: 18300, status: 'active', funding_method: 'crypto wallet', projected_interest: 0, created_at: new Date(now - 30 * day).toISOString() }
    ]).select('id');
    pk.forEach((p) => pocketIds.push(p.id));

    // L: losing. 120,000 deposited before the first anchor; a real position that has lost
    // value (a holding at half its cost basis) plus a realised loss, so the return figure,
    // the unrealised figure, the best-class pill ("Most resilient class") and the worst-month
    // stat are all genuinely negative on screen.
    const L = await makeClient('l', 'Overview Visual L', 120000);
    await anchors(L, [[3, 120000], [2, 115000], [1, 112000], [0, 104000]]);
    await backdateAnchors(L, [3, 2, 1, 0]);
    await admin.from('transactions').insert([{ client_id: L.id, type: 'DEPOSIT', total_value: 120000, status: 'completed', created_at: msAt(4, 15) }]);
    const { data: prod } = await admin.from('products').select('id, unit_price').eq('id', 'PROD-0003').single();
    const lUnits = 20000 / Number(prod.unit_price);
    await admin.from('holdings').insert({ client_id: L.id, product_id: 'PROD-0003', units: lUnits, cost_basis: 40000 });
    await admin.from('account_state').update({ unallocated_capital: 70000, allocated_capital: 20000, asset_returns: -10000 }).eq('client_id', L.id);

    // N: new — one $0 anchor written before the account was funded, funded this month.
    const N = await makeClient('n', 'Overview Visual N', 0);
    await anchors(N, [[0, 0]]);
    await admin.from('account_state').update({ unallocated_capital: 52000 }).eq('client_id', N.id);
    await admin.from('transactions').insert([{ client_id: N.id, type: 'DEPOSIT', total_value: 52000, status: 'completed' }]);

    console.log('\n=== CONTRAST — real composited pixels on the glass card ===\n');
    runContrast('portfolio-overview', 'established client (gain)', A.bootstrap);
    runContrast('portfolio-overview-loss', 'established client (loss)', L.bootstrap);
    runContrast('portfolio-overview-tip', 'three-row tooltip, hovered', A.bootstrap, HOVER_TIP);
    runContrast('portfolio-overview-new', 'new client + empty states', N.bootstrap);

    console.log('\n=== FONTS — Inter only ===\n');
    runFonts('dashboard.html', A.bootstrap);

    console.log('\n=== REAL CHART.JS — dataset vs the snapshot table, hover, ranges ===\n');
    const { data: rows } = await admin.from('portfolio_value_snapshots').select('month_start_date, value_at_anchor').eq('client_id', A.id).order('month_start_date');
    const tableValues = rows.map((r) => Number(r.value_at_anchor));
    check('seed: the table holds four real anchors for the established client', tableValues.length === 4 && tableValues[1] === 112000, JSON.stringify(rows));

    const cdp = await connectChrome();
    // window.__shotUri(): the page asks Node for a screenshot through a CDP binding; Node
    // captures it and resolves the page-side promise with the data URI.
    await cdp.send('Runtime.addBinding', { name: '__mwShot' });
    cdp.onBinding((payload) => {
      cdp.send('Page.captureScreenshot', { format: 'png' }).then((r) => cdp.evaluate('window.__mwShotResolve(' + JSON.stringify('data:image/png;base64,' + r.data) + ')'));
    });
    try {
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(600);
      await cdp.evaluate(A.bootstrap);
      // One throwaway warm-up load: the first invocation of every Edge Function pays its
      // compile cost (the full-suite warm-up convention), and the CDN scripts are cold too.
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
      await cdp.evaluate(WAIT_OVERVIEW(true));

      await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
      const ready = await cdp.evaluate(WAIT_OVERVIEW(true));
      if (!ready) console.log('      DIAG errors: ' + JSON.stringify(cdp.errors.slice(-12)));
      check('a real Chart.js instance is bound to #po-chart', ready === true);

      await shot(cdp, '01-established-1440');
      const ds = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");return c.data.datasets.map(d=>({label:d.label,type:d.type||c.config.type,data:d.data,dash:d.borderDash||null,tension:d.tension,bg:d.pointBackgroundColor}));})()');
      const live = ds[0].data.map((p) => p.y);
      // The live value is read from the band's lead cell — the ONLY place the page states it.
      // That cell counts up (Motion), so wait for it to settle on the real figure.
      await cdp.evaluate('(async()=>{for(let i=0;i<40;i++){const t=document.getElementById("tpv-amount").textContent.trim();if(t==="$128,000"||t==="$128,000.00")return true;await new Promise(r=>setTimeout(r,100));}return false;})()');
      const value = await cdp.evaluate('document.getElementById("tpv-amount").textContent.trim()');
      const liveValue = Number(value.replace(/[^0-9.]/g, ''));
      check('★ the real portfolio dataset equals the table rows + today\'s live value', JSON.stringify(live) === JSON.stringify(tableValues.concat([liveValue])), JSON.stringify({ live, tableValues, liveValue }));
      check('the live value is stated once, in the band\'s lead cell, at the account\'s real $128,000', liveValue === 128000 && (await cdp.evaluate('document.querySelectorAll("#tpv-amount").length')) === 1, value);
      const band = await cdp.evaluate('(()=>{const g=(id)=>document.getElementById(id);return {title:document.querySelector(".po-title").textContent,asof:g("po-asof").textContent,change:g("po-change").textContent,tm:g("tpv-monthly-change").textContent,ret:g("total-return-amount").textContent.trim(),retCls:g("total-return-amount").className,pct:g("total-return-pct").textContent,split:[...g("po-split").children].map(i=>i.style.width),splitHidden:g("po-split").hidden,cls:g("best-performing-class").textContent.trim(),clsSub:g("best-performing-return").textContent,chartTitle:document.querySelector(".po-ch-title").textContent,legend:[...document.querySelectorAll(".po-leg > span")].filter(e=>!e.hidden).map(e=>e.textContent),dollarsInChartHead:(document.querySelector(".po-ch-h").textContent.match(/\\$/g)||[]).length,glassLift:g("po-value-card").classList.contains("glass-lift")};})()');
      check('★ ONE card, .glass-lift, titled "Portfolio", "Updated just now", chart section titled "Value over time" with no dollar figure in its head', band.title === 'Portfolio' && /Updated just now/.test(band.asof) && band.chartTitle === 'Value over time' && band.dollarsInChartHead === 0 && band.glassLift === true, JSON.stringify(band));
      check('the band: since pill +$28,000 · +28.0%, this month +$10,000 (+8.5%), return +$18,000 gain-toned, split 0%/100%, class "—"', /\+\$28,000 · \+28\.0%/.test(band.change) && /\+\$10,000/.test(band.tm) && /\+8\.5%/.test(band.tm) && band.ret === '+$18,000' && /is-gain/.test(band.retCls) && !band.splitHidden && parseFloat(band.split[0]) === 0 && parseFloat(band.split[1]) === 100 && band.cls === '\u2014', JSON.stringify(band));
      check('the legend lists Portfolio, Capital in, Deposit and the outflow entry (a withdrawal and a transfer are in range)', band.legend.length === 4 && /Capital in/.test(band.legend[1]) && /Deposit/.test(band.legend[2]) && /Withdrawal/.test(band.legend[3]), JSON.stringify(band.legend));
      check('three datasets: the portfolio line (tension 0), the dashed capital-in line, the event dots', ds.length === 3 && ds[0].tension === 0 && ds[1].dash && ds[1].dash.length === 2 && ds[2].type === 'scatter', JSON.stringify(ds.map((d) => [d.label, d.type, d.dash])));
      check('★ the capital-in dataset steps at the ledger dates: 100,000 → 98,000 → 95,000 → 110,000', JSON.stringify(ds[1].data.map((p) => p.y)) === JSON.stringify([100000, 100000, 98000, 98000, 95000, 95000, 110000, 110000]), JSON.stringify(ds[1].data));
      check('three event dots (white-filled for the two outflows, gold for this month\'s deposit), each drawn ON the portfolio line', ds[2].data.length === 3 && ds[2].bg.join(',') === '#ffffff,#ffffff,#C8860A', JSON.stringify(ds[2]));
      const dotOnLine = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");const line=c.getDatasetMeta(0).data;const dots=c.getDatasetMeta(2).data;return dots.map(d=>{let best=1e9;for(let i=0;i<line.length-1;i++){const a=line[i],b=line[i+1];if(d.x<Math.min(a.x,b.x)-0.5||d.x>Math.max(a.x,b.x)+0.5)continue;const t=(d.x-a.x)/((b.x-a.x)||1);const y=a.y+(b.y-a.y)*t;best=Math.min(best,Math.abs(y-d.y));}return Math.round(best*100)/100;});})()');
      check('...within a pixel of the drawn line at each dot\'s own x', dotOnLine.length === 3 && dotOnLine.every((d) => d <= 1), JSON.stringify(dotOnLine));
      const chartType = await cdp.evaluate('Chart.getChart("po-chart").config.type');
      const gridShown = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");return {y:c.options.scales.y.grid.color, ticks:c.scales.y.ticks.map(t=>t.label)};})()');
      check('a line chart with y gridlines and real compact-dollar tick labels', chartType === 'line' && /rgba/.test(gridShown.y) && gridShown.ticks.length >= 3 && gridShown.ticks.every((t) => /^\$/.test(t)), JSON.stringify(gridShown));

      // Hover: move the real pointer onto the second anchor's own pixel and read the HTML
      // tooltip the page actually built — not a callback called by hand.
      const pt = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");const e=c.getDatasetMeta(0).data[1];const r=c.canvas.getBoundingClientRect();return {x:r.left+e.x,y:r.top+e.y};})()');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      await sleep(700);
      await shot(cdp, '02-tooltip-hover');
      const tip = await cdp.evaluate('(()=>{const t=document.getElementById("po-tip");const c=Chart.getChart("po-chart");return {on:t.classList.contains("is-on"),date:(t.querySelector(".po-td")||{}).textContent,rows:[...t.querySelectorAll(".po-tr")].map(r=>r.textContent),active:c.getActiveElements().map(a=>[a.datasetIndex,a.index]),opacity:getComputedStyle(t).opacity};})()');
      const secondDate = new Date(rows[1].month_start_date + 'T00:00:00Z');
      const expectTitle = secondDate.getUTCDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][secondDate.getUTCMonth()] + ' ' + secondDate.getUTCFullYear();
      check('★ hovering an anchor opens the three-row tooltip: its date, Portfolio $112,000, Capital in $100,000, Return +$12,000', tip.on && tip.opacity === '1' && tip.date === expectTitle && tip.rows.length === 3 && /Portfolio\$112,000/.test(tip.rows[0]) && /Capital in\$100,000/.test(tip.rows[1]) && /Return\+\$12,000/.test(tip.rows[2]), JSON.stringify({ tip, expectTitle }));
      check('...and the hovered anchor is the active element on the portfolio dataset', tip.active.length === 1 && tip.active[0][0] === 0 && tip.active[0][1] === 1, JSON.stringify(tip.active));
      // Hover an event dot: a deposit tooltip instead.
      const dotPt = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");const e=c.getDatasetMeta(2).data[2];const r=c.canvas.getBoundingClientRect();return {x:r.left+e.x,y:r.top+e.y};})()');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dotPt.x, y: dotPt.y });
      await sleep(700);
      const dotTip = await cdp.evaluate('(()=>{const t=document.getElementById("po-tip");return {on:t.classList.contains("is-on"),rows:[...t.querySelectorAll(".po-tr")].map(r=>r.textContent)};})()');
      check('hovering the deposit dot shows the deposit itself: +$15,000 and capital in after $110,000', dotTip.on && /Deposit\+\$15,000/.test(dotTip.rows[0]) && /\$110,000/.test(dotTip.rows[1]), JSON.stringify(dotTip));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
      await sleep(300);
      check('moving away closes the tooltip', (await cdp.evaluate('document.getElementById("po-tip").classList.contains("is-on")')) === false);

      // Graphical objects, measured on real composited pixels (3:1, WCAG 1.4.11): the split
      // bar's realised segment, the sparkline stroke, the capital-in line, the deposit dot.
      await cdp.evaluate(SAMPLER);
      const gfx = await cdp.evaluate(`(async()=>{
        const shot=async()=>window.__shotUri();
        const L=(p)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(p[0])+0.7152*f(p[1])+0.0722*f(p[2])};
        const ratio=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
        const out={};
        const uri=await shot();
        const r=(el)=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}};
        const split=document.getElementById('po-split');
        const seg=r(split.children[1]); const under={x:seg.x,y:seg.y+seg.h+6,w:seg.w,h:6};
        const segPx=await window.__sample(uri,seg), underPx=await window.__sample(uri,under);
        out.split=Math.round(ratio(segPx.median,underPx.median)*100)/100;
        const sp=r(document.getElementById('po-spark'));
        const spPx=await window.__sample(uri,sp);
        out.spark=Math.round(ratio(spPx.darkest,spPx.median)*100)/100;
        const c=Chart.getChart('po-chart'); const cr=c.canvas.getBoundingClientRect();
        const cap=c.getDatasetMeta(1).data; const a=cap[cap.length-2], b=cap[cap.length-1];
        const capBox={x:cr.left+Math.min(a.x,b.x)+4,y:cr.top+a.y-3,w:Math.max(8,Math.abs(b.x-a.x)-8),h:6};
        const capPx=await window.__sample(uri,capBox);
        out.capital=Math.round(ratio(capPx.darkest,capPx.lightest)*100)/100;
        const d=c.getDatasetMeta(2).data[2]; const dot={x:cr.left+d.x-2,y:cr.top+d.y-2,w:4,h:4}; const around={x:cr.left+d.x-14,y:cr.top+d.y-14,w:28,h:28};
        const dotPx=await window.__sample(uri,dot), aroundPx=await window.__sample(uri,around);
        out.dot=Math.round(ratio(dotPx.median,aroundPx.lightest)*100)/100;
        return out;
      })()`);
      check('★ graphical objects clear 3:1 on the composited card: split bar ' + gfx.split + ', sparkline ' + gfx.spark + ', capital-in line ' + gfx.capital + ', deposit dot ' + gfx.dot, gfx.split >= 3 && gfx.spark >= 3 && gfx.capital >= 3 && gfx.dot >= 3, JSON.stringify(gfx));

      // Ranges: a REAL click on 3M redraws the real chart with fewer points AND recomputes the
      // period stats beneath it.
      const statsBefore = await cdp.evaluate('[...document.querySelectorAll("#po-stats > div")].map(d=>d.textContent.replace(/\\s+/g," ").trim())');
      check('★ period stats (1Y): high $128,000 Today, low $100,000, best month +12.0%, worst −0.5%', statsBefore.length === 4 && /Period high\$128,000Today/.test(statsBefore[0]) && /Period low\$100,000/.test(statsBefore[1]) && /Best month\+12\.0%/.test(statsBefore[2]) && /Worst month−0\.5%/.test(statsBefore[3]), JSON.stringify(statsBefore));
      const btn = await cdp.evaluate('(()=>{const b=document.querySelector(".po-rg[data-range=\\"3\\"]");const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:b.disabled};})()');
      check('the 3M control is enabled', btn.disabled === false);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await sleep(500);
      await shot(cdp, '03-range-3m');
      const after = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");return {data:c.data.datasets[0].data.map(p=>p.y),cap:c.data.datasets[1].data.map(p=>p.y),on:document.querySelector(".po-rg.is-on").dataset.range,pressed:document.querySelector(".po-rg[data-range=\\"3\\"]").getAttribute("aria-pressed"),stats:[...document.querySelectorAll("#po-stats > div")].map(d=>d.textContent.replace(/\\s+/g," ").trim())};})()');
      const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
      const expect3 = rows.filter((r) => new Date(r.month_start_date + 'T00:00:00Z') >= cutoff).map((r) => Number(r.value_at_anchor)).concat([liveValue]);
      check('★ a real click on 3M redraws the real chart with only the anchors in range + today', JSON.stringify(after.data) === JSON.stringify(expect3) && after.data.length < live.length && after.on === '3' && after.pressed === 'true', JSON.stringify({ after, expect3 }));
      check('★ ...and the period stats RECOMPUTE for 3M: best month +10.5%, low $109,500', /Best month\+10\.5%/.test(after.stats[2]) && /Period low\$109,500/.test(after.stats[1]), JSON.stringify(after.stats));
      check('...the capital-in line for 3M starts at 100,000 and still ends at 110,000', after.cap[0] === 100000 && after.cap[after.cap.length - 1] === 110000, JSON.stringify(after.cap));

      // Tabular figures, by real rendered advance width (a declaration alone proves nothing).
      const tab = await cdp.evaluate('(()=>{const out={};for(const sel of ["#tpv-amount","#total-return-amount",".po-pv",".po-mv"]){const f=document.querySelector(sel);const cs=getComputedStyle(f);const s=document.createElement("span");s.style.cssText="position:absolute;visibility:hidden;font:"+cs.font+";font-variant-numeric:"+cs.fontVariantNumeric;document.body.appendChild(s);s.textContent="1111111";const a=s.getBoundingClientRect().width;s.textContent="0000000";const b=s.getBoundingClientRect().width;s.remove();out[sel]={a,b,fvn:cs.fontVariantNumeric,size:cs.fontSize,family:cs.fontFamily};}return out;})()');
      check('every figure renders tabular (1111111 and 0000000 the same width): the 38px value, the return, the period stats, the pocket values', Object.values(tab).every((t) => Math.abs(t.a - t.b) < 0.5 && /tabular/.test(t.fvn)), JSON.stringify(tab));
      check('the value figure is 38px and the return figure 24px, both Inter', tab['#tpv-amount'].size === '38px' && tab['#total-return-amount'].size === '24px' && /Inter/.test(tab['#tpv-amount'].family), JSON.stringify(tab));

      // The losing client on screen: every negative figure carries an explicit minus sign.
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(400);
      await cdp.evaluate(L.bootstrap);
      await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
      await cdp.evaluate(WAIT_OVERVIEW(true));
      await sleep(600);
      await shot(cdp, '04-losing-client');
      const lb = await cdp.evaluate('(()=>{const g=(id)=>document.getElementById(id);return {ret:g("total-return-amount").textContent.trim(),retCls:g("total-return-amount").className,label:g("best-performing-label").textContent,clsSub:g("best-performing-return").textContent,pill:g("po-change").textContent,tm:g("tpv-monthly-change").textContent,stats:[...document.querySelectorAll("#po-stats > div")].map(d=>d.textContent.replace(/\\s+/g," ").trim()),spark:document.getElementById("po-spark").querySelector("path").getAttribute("stroke")};})()');
      check('★ the losing client: return −$30,000 loss-toned, "Most resilient class · every class is down" with a loss pill, since pill and this-month negative, worst month negative, sparkline loss-toned', lb.ret === '\u2212$30,000' && /is-loss/.test(lb.retCls) && lb.label === 'Most resilient class' && /every class is down/.test(lb.clsSub) && /\u2212/.test(lb.pill) && /\u2212/.test(lb.tm) && /Worst month\u2212/.test(lb.stats[3]) && lb.spark === '#A8452F', JSON.stringify(lb));

      // The new client on screen: the band renders, the chart area explains, nothing else.
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(400);
      await cdp.evaluate(N.bootstrap);
      await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
      await cdp.evaluate(WAIT_OVERVIEW(false));
      await sleep(800);
      await shot(cdp, '05-new-client');
      const nb = await cdp.evaluate('(()=>{const g=(id)=>document.getElementById(id);const vis=(el)=>el&&getComputedStyle(el).display!=="none"&&!el.hidden;return {value:g("tpv-amount").textContent.trim(),tm:g("tpv-monthly-change").textContent.trim(),change:vis(g("po-change")),chart:vis(g("po-chart-wrap")),newc:vis(g("po-newc")),stats:vis(g("po-stats")),spark:vis(g("po-spark")),legend:vis(g("po-legend")),ranges:vis(g("po-ranges")),newcText:g("po-newc").textContent};})()');
      check('★ the new client: $52,000 in the band, "New this month", no since pill, chart/legend/ranges/stats/sparkline hidden, the explanation shown', nb.value === '$52,000' && nb.tm === 'New this month' && !nb.change && !nb.chart && nb.newc && !nb.stats && !nb.spark && !nb.legend && !nb.ranges && /1 so far/.test(nb.newcText), JSON.stringify(nb));

      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(400);
      await cdp.evaluate(A.bootstrap);

      console.log('\n=== LAYOUT — 1440/390/375 ===\n');
      for (const width of [1440, 390, 375]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
        await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
        const ok = await cdp.evaluate(WAIT_OVERVIEW(true));
        if (!ok) console.log('      DIAG ' + width + 'px errors: ' + JSON.stringify(cdp.errors.slice(-12)));
        const real = await cdp.evaluate('document.documentElement.clientWidth');
        check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);
        const g = await cdp.evaluate(GEOM);
        check(width + 'px: the chart rendered with the full series', ok === true && g.chartPts === live.length, JSON.stringify(g));
        check(width + 'px: no horizontal overflow on the page', g.bodyScroll <= g.inner + 1, JSON.stringify(g));
        check(width + 'px: the chart canvas stays inside its card', g.canvasRight <= g.cardRight + 1 && g.canvasW > 100, JSON.stringify(g));
        check(width + 'px: no request or pocket row escapes the viewport', g.maxRowRight <= g.inner + 1, JSON.stringify(g));
        if (width >= 1024) {
          check(width + 'px: pending and maturities sit side by side (two-up)', Math.abs(g.pend.t - g.mat.t) < 2 && g.mat.l > g.pend.r - 1, JSON.stringify(g));
          check(width + 'px: ★ the band is three cells across, the value cell the widest, the sparkline shown', g.cells.length === 3 && Math.abs(g.cells[0].t - g.cells[1].t) < 2 && Math.abs(g.cells[1].t - g.cells[2].t) < 2 && g.cells[1].l > g.cells[0].r - 1 && (g.cells[0].r - g.cells[0].l) > (g.cells[1].r - g.cells[1].l) && g.sparkShown, JSON.stringify(g.cells));
          check(width + 'px: the four period stats sit in one row', g.stats.length === 4 && g.stats.every((c) => Math.abs(c.t - g.stats[0].t) < 2), JSON.stringify(g.stats));
          check(width + 'px: the header carries no export control', g.noExport === true);
        } else {
          check(width + 'px: pending and maturities stack in one column', g.mat.t >= g.pend.b - 1 && Math.abs(g.mat.l - g.pend.l) < 2, JSON.stringify(g));
          check(width + 'px: ★ the band collapses to ONE column — each cell below the last, the sparkline hidden', g.cells.length === 3 && g.cells[1].t >= g.cells[0].b - 1 && g.cells[2].t >= g.cells[1].b - 1 && Math.abs(g.cells[1].l - g.cells[0].l) < 2 && !g.sparkShown, JSON.stringify(g.cells));
          check(width + 'px: the period stats wrap to two rows of two', g.stats.length === 4 && Math.abs(g.stats[0].t - g.stats[1].t) < 2 && g.stats[2].t > g.stats[0].t + 10, JSON.stringify(g.stats));
          check(width + 'px: no figure in the band escapes the card', g.maxFigRight <= g.cardRight + 1, JSON.stringify({ maxFigRight: g.maxFigRight, cardRight: g.cardRight }));
          check(width + 'px: range controls meet the 44px floor', g.rangeHeights.every((h) => h >= 44), JSON.stringify(g.rangeHeights));
        }
        await shot(cdp, '06-layout-' + width);
      }

      // 320px through a real same-origin iframe.
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
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
        for (let i = 0; i < 200; i++) { const v = d.getElementById('tpv-monthly-change'); const p = d.getElementById('po-pending'); const a = d.getElementById('tpv-amount'); if (v && p && a && !/animate-pulse/.test(v.innerHTML) && !/animate-pulse/.test(p.innerHTML) && !/animate-pulse/.test(a.innerHTML) && w.Chart && w.Chart.getChart('po-chart')) break; await nap(250); }
        for (let i = 0; i < 40; i++) { if (d.getElementById('tpv-amount').textContent.trim() === '$128,000') break; await nap(100); } // the count-up settles
        const c = w.Chart && w.Chart.getChart('po-chart');
        const card = d.getElementById('po-value-card').getBoundingClientRect();
        const cv = d.getElementById('po-chart').getBoundingClientRect();
        const pend = d.getElementById('po-pending-card').getBoundingClientRect();
        const mat = d.getElementById('po-maturities-card').getBoundingClientRect();
        const rows = [...d.querySelectorAll('#po-pending .po-row, #po-maturities .po-mat')].map(r => r.getBoundingClientRect().right);
        const cells = [...d.querySelectorAll('.po-cell')].map(x => { const r = x.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
        const figs = [...d.querySelectorAll('#tpv-amount, #total-return-amount, .ret-class, #tpv-monthly-change, #total-return-split')].map(e => e.getBoundingClientRect().right);
        return { reported: d.documentElement.clientWidth, inner: w.innerWidth, bodyScroll: d.body.scrollWidth, pts: c ? c.data.datasets[0].data.length : 0, canvasRight: cv.right, cardRight: card.right, stacked: mat.top >= pend.bottom - 1, maxRowRight: Math.max(...rows),
          bandStacked: cells.length === 3 && cells[1].t >= cells[0].b - 1 && cells[2].t >= cells[1].b - 1, maxFigRight: Math.max(...figs), value: d.getElementById('tpv-amount').textContent.trim() };
      })()`);
      check('320px: the iframe genuinely reports 320px', narrow.reported === 320, JSON.stringify(narrow));
      check('320px: the chart rendered with the full series', narrow.pts === live.length, JSON.stringify(narrow));
      check('320px: no horizontal overflow', narrow.bodyScroll <= narrow.inner + 1, JSON.stringify(narrow));
      check('320px: the chart canvas stays inside its card', narrow.canvasRight <= narrow.cardRight + 1, JSON.stringify(narrow));
      check('320px: the two panels stack and no row escapes the viewport', narrow.stacked && narrow.maxRowRight <= narrow.inner + 1, JSON.stringify(narrow));
      check('320px: ★ the band is one column and the 38px figure ($128,000) stays inside the card', narrow.bandStacked && narrow.maxFigRight <= narrow.cardRight + 1 && narrow.value === '$128,000', JSON.stringify(narrow));
    } finally {
      await cdp.close();
    }
  } finally {
    if (pocketIds.length) await admin.from('hys_pockets').delete().in('id', pocketIds);
    for (const t of ['withdrawal_requests', 'allocation_requests', 'hys_deposit_requests', 'portfolio_value_snapshots', 'holdings', 'transactions', 'account_state']) await admin.from(t).delete().in('client_id', ids);
    await admin.from('clients').delete().in('id', ids);
    for (const id of ids) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.error('CLEANUP: ' + error.message); }
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch((err) => { console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err)); console.error(err && err.stack); process.exit(1); });
