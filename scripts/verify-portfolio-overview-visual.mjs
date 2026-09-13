#!/usr/bin/env node
// ★ Portfolio overview (2026-09-12) — visual verification in a real browser.
//
// What the jsdom suite cannot prove, proven here: a REAL Chart.js instance whose dataset
// equals the rows in portfolio_value_snapshots (cross-checked against the table itself, not
// against the payload the page was handed); a real hover producing the tooltip with the exact
// value and date; the range controls redrawing the real chart; contrast on every new text
// surface, measured composited on the glass card in both change tones and the new-client
// state; fonts (Inter only, figures tabular by real advance width); and 1440/390/375 plus a
// real 320px iframe — the chart and the two-up grid being the layout risks the brief named.
//
// Three real clients are seeded through the real writer (snapshot-portfolio-values with a
// monthStartDate — never a direct insert): an established gaining client, a losing client,
// and a new client under the threshold. Every measurement sits behind a viewport-integrity
// guard; 320px goes through a real same-origin iframe because the top-level override floors
// at 348px on this build.
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
const WAIT_OVERVIEW = (needChart) => '(async()=>{for(let i=0;i<200;i++){const v=document.getElementById("po-change");const p=document.getElementById("po-pending");const ok=v&&p&&!/animate-pulse/.test(v.innerHTML)&&!/animate-pulse/.test(p.innerHTML)' + (needChart ? '&&window.Chart&&Chart.getChart("po-chart")' : '') + ';if(ok)return true;await new Promise(r=>setTimeout(r,250));}return false;})()';

function runContrast(profile, label, bootstrap) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      CONTRAST_PROFILE: profile,
      CONTRAST_URL: BASE + '/dashboard.html',
      CONTRAST_BOOTSTRAP_JS: bootstrap,
      CONTRAST_PREPARE_JS: WAIT_OVERVIEW(false),
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

const GEOM = `(() => {
  const card = document.getElementById('po-value-card').getBoundingClientRect();
  const cv = document.getElementById('po-chart').getBoundingClientRect();
  const pend = document.getElementById('po-pending-card').getBoundingClientRect();
  const mat = document.getElementById('po-maturities-card').getBoundingClientRect();
  const rows = [...document.querySelectorAll('#po-pending .po-row, #po-maturities .po-mat')].map(r => r.getBoundingClientRect().right);
  const rg = [...document.querySelectorAll('.po-rg')].map(b => Math.round(b.getBoundingClientRect().height));
  return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, canvasW: Math.round(cv.width), canvasRight: cv.right, cardRight: card.right, cardLeft: card.left,
    pend: { l: pend.left, t: pend.top, b: pend.bottom, r: pend.right }, mat: { l: mat.left, t: mat.top, r: mat.right }, maxRowRight: Math.max(...rows), rangeHeights: rg,
    chartPts: (Chart.getChart('po-chart') || { data: { datasets: [{ data: [] }] } }).data.datasets[0].data.length };
})()`;

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

  try {
    const A = await makeClient('a', 'Overview Visual A', 100000);
    await anchors(A, [[3, 100000], [2, 104000], [1, 101500], [0, 110000]]);
    await admin.from('account_state').update({ unallocated_capital: 120000 }).eq('client_id', A.id);
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

    const L = await makeClient('l', 'Overview Visual L', 120000);
    await anchors(L, [[2, 120000], [1, 115000], [0, 112000]]);
    await admin.from('account_state').update({ unallocated_capital: 100000 }).eq('client_id', L.id);

    const N = await makeClient('n', 'Overview Visual N', 52000);
    await anchors(N, [[0, 52000]]);

    console.log('\n=== CONTRAST — real composited pixels on the glass card ===\n');
    runContrast('portfolio-overview', 'established client (gain)', A.bootstrap);
    runContrast('portfolio-overview-loss', 'established client (loss)', L.bootstrap);
    runContrast('portfolio-overview-new', 'new client + empty states', N.bootstrap);

    console.log('\n=== FONTS — Inter only ===\n');
    runFonts('dashboard.html', A.bootstrap);

    console.log('\n=== REAL CHART.JS — dataset vs the snapshot table, hover, ranges ===\n');
    const { data: rows } = await admin.from('portfolio_value_snapshots').select('month_start_date, value_at_anchor').eq('client_id', A.id).order('month_start_date');
    const tableValues = rows.map((r) => Number(r.value_at_anchor));
    check('seed: the table holds four real anchors for the established client', tableValues.length === 4, JSON.stringify(rows));

    const cdp = await connectChrome();
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

      const live = await cdp.evaluate('Chart.getChart("po-chart").data.datasets[0].data');
      const labels = await cdp.evaluate('Chart.getChart("po-chart").data.labels');
      // The live value is read from the Total portfolio value card — the ONLY place the page
      // states it (2026-09-12): the overview card itself carries no figure. That card counts
      // up (Motion), so wait for it to settle on the real figure.
      await cdp.evaluate('(async()=>{for(let i=0;i<40;i++){const t=document.getElementById("tpv-amount").textContent.trim();if(t==="$120,000"||t==="$120,000.00")return true;await new Promise(r=>setTimeout(r,100));}return false;})()');
      const value = await cdp.evaluate('document.getElementById("tpv-amount").textContent.trim()');
      const liveValue = Number(value.replace(/[^0-9.]/g, ''));
      check('★ the real chart dataset equals the table rows + today\'s live value', JSON.stringify(live) === JSON.stringify(tableValues.concat([liveValue])), JSON.stringify({ live, tableValues, liveValue }));
      check('the live value is stated once, in the Total portfolio value card, at the account\'s real $120,000', liveValue === 120000, value);
      const figures = await cdp.evaluate('(()=>{const card=document.getElementById("po-value-card");const top=card.querySelector(".po-top").textContent.replace(/[+\\u2212]\\$[\\d,]+ \\u00b7 [+\\u2212]?[\\d.]+%/g,"");return {title:card.querySelector(".ret-k").textContent.trim(),dollarsInHead:(top.match(/\\$/g)||[]).length,hasValueEl:!!document.getElementById("po-value")};})()');
      check('★ the overview card is titled "Portfolio value over time" and repeats no dollar figure', figures.title === 'Portfolio value over time' && figures.dollarsInHead === 0 && !figures.hasValueEl, JSON.stringify(figures));
      check('labels: one per point, last is Today', labels.length === live.length && labels[labels.length - 1] === 'Today', JSON.stringify(labels));
      const chartType = await cdp.evaluate('Chart.getChart("po-chart").config.type');
      const gridShown = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");return {y:c.options.scales.y.grid.color, ticks:c.scales.y.ticks.map(t=>t.label)};})()');
      check('a line chart with y gridlines and real compact-dollar tick labels', chartType === 'line' && /rgba/.test(gridShown.y) && gridShown.ticks.length >= 3 && gridShown.ticks.every((t) => /^\$/.test(t)), JSON.stringify(gridShown));

      // Hover: move the real pointer onto the second anchor's own pixel and read the tooltip
      // Chart.js actually built — not a callback called by hand.
      const pt = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");const e=c.getDatasetMeta(0).data[1];const r=c.canvas.getBoundingClientRect();return {x:r.left+e.x,y:r.top+e.y};})()');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      await sleep(600);
      const tip = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");const t=c.tooltip;return {opacity:t.opacity,title:t.title,body:(t.body||[]).map(b=>b.lines.join("")),active:c.getActiveElements().map(a=>a.index),radius:c.getActiveElements().length?c.getDatasetMeta(0).data[c.getActiveElements()[0].index].options.radius:null};})()');
      const secondDate = new Date(rows[1].month_start_date + 'T00:00:00Z');
      const expectTitle = secondDate.getUTCDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][secondDate.getUTCMonth()] + ' ' + secondDate.getUTCFullYear();
      check('★ hovering a point shows the tooltip with that point\'s exact date and value', tip.opacity === 1 && tip.title[0] === expectTitle && tip.body[0] === '$' + tableValues[1].toLocaleString('en-US'), JSON.stringify({ tip, expectTitle }));
      check('...and the hover marker is drawn (point radius grows from 0)', tip.active.length === 1 && tip.active[0] === 1 && tip.radius > 0, JSON.stringify(tip));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });

      // Ranges: a REAL click on 3M redraws the real chart with fewer points.
      const btn = await cdp.evaluate('(()=>{const b=document.querySelector(".po-rg[data-range=\\"3\\"]");const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:b.disabled};})()');
      check('the 3M control is enabled (two anchors fall within 3 months)', btn.disabled === false);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
      await sleep(500);
      const after = await cdp.evaluate('(()=>{const c=Chart.getChart("po-chart");return {data:c.data.datasets[0].data,on:document.querySelector(".po-rg.is-on").dataset.range,pressed:document.querySelector(".po-rg[data-range=\\"3\\"]").getAttribute("aria-pressed")};})()');
      const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
      const expect3 = rows.filter((r) => new Date(r.month_start_date + 'T00:00:00Z') >= cutoff).map((r) => Number(r.value_at_anchor)).concat([liveValue]);
      check('★ a real click on 3M redraws the real chart with only the anchors in range + today', JSON.stringify(after.data) === JSON.stringify(expect3) && after.data.length < live.length && after.on === '3' && after.pressed === 'true', JSON.stringify({ after, expect3 }));

      // Tabular figures, by real rendered advance width (a declaration alone proves nothing).
      const tab = await cdp.evaluate('(()=>{const f=document.querySelector(".po-mv");const cs=getComputedStyle(f);const c=document.createElement("canvas").getContext("2d");c.font=cs.fontWeight+" "+cs.fontSize+" "+cs.fontFamily;const w=(s)=>c.measureText(s).width;const s=document.createElement("span");s.style.cssText="position:absolute;visibility:hidden;font:"+cs.font+";font-variant-numeric:"+cs.fontVariantNumeric;document.body.appendChild(s);s.textContent="1111111";const a=s.getBoundingClientRect().width;s.textContent="0000000";const b=s.getBoundingClientRect().width;s.remove();return {a,b,fvn:cs.fontVariantNumeric,family:cs.fontFamily};})()');
      check('the pocket value figures render tabular (1111111 and 0000000 the same width)', Math.abs(tab.a - tab.b) < 0.5 && /tabular/.test(tab.fvn), JSON.stringify(tab));

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
        } else {
          check(width + 'px: pending and maturities stack in one column', g.mat.t >= g.pend.b - 1 && Math.abs(g.mat.l - g.pend.l) < 2, JSON.stringify(g));
          check(width + 'px: range controls meet the 44px floor', g.rangeHeights.every((h) => h >= 44), JSON.stringify(g.rangeHeights));
        }
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
        for (let i = 0; i < 200; i++) { const v = d.getElementById('po-change'); const p = d.getElementById('po-pending'); if (v && p && !/animate-pulse/.test(v.innerHTML) && !/animate-pulse/.test(p.innerHTML) && w.Chart && w.Chart.getChart('po-chart')) break; await nap(250); }
        const c = w.Chart && w.Chart.getChart('po-chart');
        const card = d.getElementById('po-value-card').getBoundingClientRect();
        const cv = d.getElementById('po-chart').getBoundingClientRect();
        const pend = d.getElementById('po-pending-card').getBoundingClientRect();
        const mat = d.getElementById('po-maturities-card').getBoundingClientRect();
        const rows = [...d.querySelectorAll('#po-pending .po-row, #po-maturities .po-mat')].map(r => r.getBoundingClientRect().right);
        return { reported: d.documentElement.clientWidth, inner: w.innerWidth, bodyScroll: d.body.scrollWidth, pts: c ? c.data.datasets[0].data.length : 0, canvasRight: cv.right, cardRight: card.right, stacked: mat.top >= pend.bottom - 1, maxRowRight: Math.max(...rows) };
      })()`);
      check('320px: the iframe genuinely reports 320px', narrow.reported === 320, JSON.stringify(narrow));
      check('320px: the chart rendered with the full series', narrow.pts === live.length, JSON.stringify(narrow));
      check('320px: no horizontal overflow', narrow.bodyScroll <= narrow.inner + 1, JSON.stringify(narrow));
      check('320px: the chart canvas stays inside its card', narrow.canvasRight <= narrow.cardRight + 1, JSON.stringify(narrow));
      check('320px: the two panels stack and no row escapes the viewport', narrow.stacked && narrow.maxRowRight <= narrow.inner + 1, JSON.stringify(narrow));
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
