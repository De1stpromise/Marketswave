#!/usr/bin/env node
// ★ Product catalog — fund documents, part 2 of 2 (2026-09-12) — visual verification.
//
// Real headless Chrome over CDP against the real local stack:
//   - the Valuation history chart is a REAL Chart.js instance whose dataset equals the
//     product's actual nav_publications, point for point (jsdom cannot see a canvas; this can)
//   - contrast on every text surface of the client document (a gaining AND a losing product,
//     so both chart tones are measured) and of the PM authoring page, sampled on real
//     composited pixels via verify-contrast.mjs's profiles
//   - fonts: Inter only, tabular-nums on every figure (audit-fonts.mjs + a real advance-width
//     check)
//   - 1440/390/375 real viewports + a real 320px iframe on both pages, with the two named
//     risks seeded on purpose: a 60-character unbroken token inside long prose, and the
//     two-column terms table, which must become one column below 760px.
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'VerifyFundDocVisual-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9448;
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
  const res = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, body: json };
}
const p = (text, marks) => ({ type: 'p', runs: [Object.assign({ t: text }, marks || {})] });
const LONG_TOKEN = 'Unbrokentokenthatisexactlysixtycharacterslongtotestwrappingxx';
function content(opts) {
  return { sections: [
    { key: 'overview', body: { blocks: [p('Nordic Growth Fund invests in growth-stage private companies across Sweden, Norway, Denmark and Finland. The fund targets businesses with proven revenue and a clear path to profitability, typically at Series B and beyond.')] } },
    { key: 'strategy', body: { blocks: [p('We take minority positions of 10–25% and hold for five to seven years. Capital is deployed across 12–18 companies to limit single-company exposure.'), { type: 'ul', items: [[{ t: 'Revenue above €5m at entry', b: true }], [{ t: 'Founder-led or founder-adjacent management' }], [{ t: 'Domestic market leadership with ' }, { t: 'export potential', i: true }]] }] } },
    { key: 'terms', horizon: '5–7 years', valuationFrequency: 'Quarterly', fees: '2% annual, 20% carried' },
    { key: 'valuation' },
    { key: 'custom', heading: 'Portfolio companies', body: { blocks: [p('The fund currently holds fourteen positions. Its three largest are a Stockholm logistics software business, a Copenhagen medical devices manufacturer, and an Oslo marine engineering group — together representing roughly 38% of committed capital. ' + LONG_TOKEN + ' No single position exceeds 12% of the fund at cost, and the portfolio is reviewed for concentration at each quarterly valuation.'.repeat(1))] } },
    { key: 'custom', heading: 'Track record', body: { blocks: [p('The team has managed three prior Nordic vehicles since 2011, with eleven full exits to date. Prior performance is not indicative of this fund\'s results and is provided for background only.')] } },
    { key: 'risks', body: { blocks: [p('Capital is committed for the full horizon and cannot be withdrawn early. Valuations are appraisals, not market prices, and may not reflect what a position would realise if sold. Concentration in a single region carries currency and policy exposure.')] } },
    { key: 'documents', attachment: opts.attachment || null }
  ] };
}

function runContrast(profile, page, label, bootstrap, prepare) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8',
    env: Object.assign({}, process.env, { CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/' + page, CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare, CONTRAST_SETTLE_MS: '25000', CONTRAST_PORT: '9333' })
  });
  forwardChildTeardown(res, 'verify-contrast');
  const out = (res.stdout || '') + (res.stderr || '');
  const tail = out.trim().split('\n').slice(-2).join(' | ');
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + tail);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  out.split('\n').filter((l) => /FAIL\s+\d/.test(l)).forEach((l) => console.log('      ' + l.trim()));
  return m ? Number(m[1]) : 0;
}
function runFonts(page, label, bootstrap) {
  const res = spawnSync(process.execPath, ['audit-fonts.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', env: Object.assign({}, process.env, { AUDIT_URL: BASE + '/' + page, AUDIT_BOOTSTRAP_JS: bootstrap }) });
  forwardChildTeardown(res, 'audit-fonts');
  const out = (res.stdout || '') + (res.stderr || '');
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family — the scheme is Inter (row 192)', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}
async function connectChrome() {
  const profile = makeTempDir('mw-fdvis-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); } }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  return { send, evaluate, errors, close: () => releaseTempDir(profile) };
}

const WAIT_DOC = `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<160;i++){ if (document.querySelector('#fund-document-root .fd-doc')) { await s(400); return true; } await s(250);} return false; })()`;
const WAIT_ADMIN = `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<160;i++){ const f=document.getElementById('doc-form'); if (f && !f.classList.contains('hidden')) { await s(300); return true; } await s(250);} return false; })()`;
// Prepare the admin page for contrast: make the overview counter genuinely OVER its cap and
// provoke the real inline server error, so both states are on screen.
const PREPARE_ADMIN = WAIT_ADMIN.replace('return true; }', `const b=document.querySelector('#ed-overview .rte-body'); b.innerHTML='<p>'+'a'.repeat(300)+'</p><p>'+'b'.repeat(302)+'</p>'; b.dispatchEvent(new Event('input')); document.getElementById('doc-save-btn').click(); for (let j=0;j<80;j++){ if (!document.getElementById('doc-error').classList.contains('hidden')) break; await s(250);} await s(300); return true; }`);

const DOC_GEOM = `(() => { const doc=document.querySelector('.fd-doc'); const dr=doc.getBoundingClientRect(); const over=[]; for (const el of doc.querySelectorAll('*')) { const r=el.getBoundingClientRect(); if (r.width>0 && r.right>dr.right+0.5 && !el.closest('.fd-hero-glow')) over.push(el.tagName.toLowerCase()+'.'+String(el.className).slice(0,30)+' '+Math.round(r.right)+'>'+Math.round(dr.right)); } const termsCols=new Set([...document.querySelectorAll('.fd-terms > div')].map(d=>Math.round(d.getBoundingClientRect().left))).size; const metaRows=new Set([...document.querySelectorAll('.fd-meta > div')].map(d=>Math.round(d.getBoundingClientRect().top))).size; return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, docW: Math.round(dr.width), over: over.slice(0,6), termsCols, metaRows, sections: document.querySelectorAll('.fd-section').length, canvas: !!document.querySelector('.fd-chart canvas') }; })()`;
const ADMIN_GEOM = `(() => { const box=document.getElementById('doc-editor'); const br=box.getBoundingClientRect(); const over=[]; for (const el of box.querySelectorAll('*')) { const r=el.getBoundingClientRect(); if (r.width>0 && r.right>br.right+0.5) over.push(el.tagName.toLowerCase()+'.'+String(el.className).slice(0,30)+' '+Math.round(r.right)+'>'+Math.round(br.right)); } const btns=[...document.querySelectorAll('.rte-btn, .ib, #doc-save-btn, #doc-publish-btn, #add-section-btn')].map(b=>{const r=b.getBoundingClientRect(); return [Math.round(r.width),Math.round(r.height)];}); const small=btns.filter(([w,h])=>w<44||h<44); return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, over: over.slice(0,6), controls: btns.length, small }; })()`;
const NARROW = (page, waitSel) => `(async () => { const nap=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<80&&!document.body;i++) await nap(100); const f=document.createElement('iframe'); f.style.cssText='width:320px;height:1200px;border:0'; f.src=${JSON.stringify(page)}; document.body.appendChild(f); await new Promise(r=>f.addEventListener('load',r)); const d=f.contentDocument,w=f.contentWindow; for (let i=0;i<160;i++){ if (d.querySelector(${JSON.stringify(waitSel)})) { await nap(500); break; } await nap(250);} const root=d.querySelector(${JSON.stringify(waitSel)}); const rr=root.getBoundingClientRect(); const over=[]; for (const el of root.querySelectorAll('*')) { const r=el.getBoundingClientRect(); if (r.width>0 && r.right>rr.right+0.5 && !el.closest('.fd-hero-glow')) over.push(el.tagName.toLowerCase()+'.'+String(el.className).slice(0,30)+' '+Math.round(r.right)+'>'+Math.round(rr.right)); } const termsCols=new Set([...d.querySelectorAll('.fd-terms > div')].map(x=>Math.round(x.getBoundingClientRect().left))).size; return { reported: d.documentElement.clientWidth, inner: w.innerWidth, bodyScroll: d.body.scrollWidth, over: over.slice(0,6), termsCols }; })()`;

async function main() {
  console.log('Product catalog — fund documents, part 2: visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const email = 'fdvis-' + suffix + '@test.marketswave.local';
  const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (cuErr) throw new Error(cuErr.message);
  const clientId = cu.user.id;
  const gainId = 'PROD-FG' + suffix.toUpperCase();
  const lossId = 'PROD-FL' + suffix.toUpperCase();
  const gainNavs = [['2025-03-31', 500], ['2025-06-30', 512.4], ['2025-09-30', 538.1], ['2025-12-31', 571.9], ['2026-03-31', 602.3], ['2026-06-30', 646.04]];
  const lossNavs = [['2025-12-31', 100], ['2026-06-30', 91.5]];
  let attPath = null;

  try {
    await admin.from('clients').insert({ id: clientId, name: 'Fund Doc Visual', email: 'fdvis-' + clientId, phone: '+1', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 50000, allocated_capital: 0, asset_returns: 0 });
    await admin.from('products').insert([
      { id: gainId, name: 'Nordic Growth Fund (visual ' + suffix + ')', asset_class: 'Private Equity', investment_type: 'Growth Fund', risk_tier: 'aggressive', minimum_investment: 10000, unit_price: 646.04, inception_unit_price: 500, created_at: '2025-03-31', last_tick_date: '2026-06-30', pricing_model: 'appraisal' },
      { id: lossId, name: 'Baltic Real Estate (visual ' + suffix + ')', asset_class: 'Real Assets', investment_type: 'REIT', risk_tier: 'balanced', minimum_investment: 25000, unit_price: 91.5, inception_unit_price: 100, created_at: '2025-12-31', last_tick_date: '2026-06-30', pricing_model: 'appraisal' }
    ]);
    await admin.from('nav_publications').insert(gainNavs.map(([d, v]) => ({ product_id: gainId, published_unit_price: v, effective_date: d, note: 'seed' })).concat(lossNavs.map(([d, v]) => ({ product_id: lossId, published_unit_price: v, effective_date: d, note: 'seed' }))));

    const anon = createClient(url, anonKey);
    const pmSigned = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (pmSigned.error) throw new Error(pmSigned.error.message);
    const pmToken = pmSigned.data.session.access_token;
    attPath = gainId + '/' + crypto.randomUUID() + '/Nordic-Growth-Fund-Factsheet-Q2-2026.pdf';
    const up = await pmSigned.data.session && (await createClient(url, anonKey, { global: { headers: { Authorization: 'Bearer ' + pmToken } } }).storage.from('fund-documents').upload(attPath, Buffer.from('%PDF-1.4 visual ' + suffix), { contentType: 'application/pdf' }));
    if (up.error) throw new Error('attachment upload: ' + up.error.message);
    const pubG = await callFunction(url, pmToken, 'save-product-document', { productId: gainId, action: 'publish', content: content({ attachment: { path: attPath, name: 'Nordic-Growth-Fund-Factsheet-Q2-2026.pdf', size: 1258291, contentType: 'application/pdf' } }) });
    const pubL = await callFunction(url, pmToken, 'save-product-document', { productId: lossId, action: 'publish', content: content({}) });
    if (pubG.status !== 200 || pubL.status !== 200) throw new Error('publish failed: ' + JSON.stringify(pubG.body) + JSON.stringify(pubL.body));
    const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(pmSigned.data.session)) + '); true';
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error(sErr.message);
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const clientBootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + '); sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + '); sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + '); true';
    const clientPage = 'fund-document.html?product=' + gainId;
    const lossPage = 'fund-document.html?product=' + lossId;
    const adminPage = 'admin-fund-document.html?product=' + gainId;

    console.log('=== THE CHART — a real Chart.js instance equal to nav_publications ===\n');
    const cdp = await connectChrome();
    try {
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(600); await cdp.evaluate(clientBootstrap);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: BASE + '/' + clientPage }); await cdp.evaluate(WAIT_DOC); // warm-up (cold function)
      await cdp.send('Page.navigate', { url: BASE + '/' + clientPage }); await sleep(1500); await cdp.evaluate(WAIT_DOC); await sleep(800);
      const chart = await cdp.evaluate(`(() => { const c=document.querySelector('.fd-chart canvas'); if (!c) return null; const ch=Chart.getChart(c); if (!ch) return { canvas: true, chart: false }; return { canvas: true, chart: true, data: ch.data.datasets[0].data, labels: ch.data.labels, type: ch.config.type, ariaLabel: c.getAttribute('aria-label') }; })()`);
      check('★ the Valuation history is a real Chart.js line chart on a real canvas', !!chart && chart.chart && chart.type === 'line', JSON.stringify(chart));
      check('★ ...whose dataset equals the product\'s nav_publications, point for point, oldest first', !!chart && JSON.stringify(chart.data) === JSON.stringify(gainNavs.map((n) => n[1])), chart && JSON.stringify(chart.data));
      check('...with one label per publication (Mar 25 … Jun 26)', !!chart && chart.labels.length === 6 && chart.labels[0] === 'Mar 25' && chart.labels[5] === 'Jun 26', chart && JSON.stringify(chart.labels));
      check('...and an accessible description naming the first and last valuation', !!chart && /6 published valuations/.test(chart.ariaLabel) && /\$500\.00/.test(chart.ariaLabel) && /\$646\.04/.test(chart.ariaLabel), chart && chart.ariaLabel);
      const head = await cdp.evaluate(`document.querySelector('.fd-chart-b').textContent`);
      check('...the header states +29.2% since first valuation (646.04 / 500)', head === '+29.2%', head);
      const dbNavs = (await admin.from('nav_publications').select('published_unit_price').eq('product_id', gainId).order('effective_date')).data.map((r) => Number(r.published_unit_price));
      check('...cross-checked against the table itself', JSON.stringify(dbNavs) === JSON.stringify(chart.data));
      const figs = await cdp.evaluate(`[...document.querySelectorAll('.fd-meta .fd-fig, .fd-term-v, .fd-chart-b')].map(e=>getComputedStyle(e).fontVariantNumeric)`);
      check('every figure carries tabular-nums (computed)', figs.length >= 8 && figs.every((f) => f === 'tabular-nums'), JSON.stringify(figs));
      const tab = await cdp.evaluate(`(() => { const s=document.createElement('span'); s.className='fd-fig'; s.style.fontSize='19px'; s.style.fontWeight='600'; /* not the font shorthand: it resets font-variant-numeric */ document.querySelector('.fd-doc').appendChild(s); s.textContent='1111111'; const a=s.getBoundingClientRect().width; s.textContent='0000000'; const b=s.getBoundingClientRect().width; s.remove(); return Math.abs(a-b); })()`);
      check('...and tabular figures genuinely render at equal advance width (measured, |1s − 0s| = ' + tab.toFixed(2) + 'px)', tab < 0.5, String(tab));
      check('no uncaught errors on the client page', cdp.errors.length === 0, cdp.errors.join(' | '));

      console.log('\n=== MOBILE — 1440/390/375 + a real 320px iframe, both pages ===\n');
      for (const width of [1440, 390, 375]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 1024 });
        await cdp.send('Page.navigate', { url: BASE + '/' + clientPage }); await sleep(1500); await cdp.evaluate(WAIT_DOC);
        const real = await cdp.evaluate('document.documentElement.clientWidth');
        check(width + 'px client: the browser genuinely reports that width', real === width, 'got ' + real);
        const g = await cdp.evaluate(DOC_GEOM);
        check(width + 'px client: all 8 sections and the chart canvas rendered', g.sections === 8 && g.canvas, JSON.stringify(g));
        check(width + 'px client: no horizontal overflow on the page', g.bodyScroll <= g.inner + 1, JSON.stringify(g));
        check(width + 'px client: nothing (long prose, the 60-char token, the terms table, the download row) escapes the document', g.over.length === 0, JSON.stringify(g.over));
        check(width + 'px client: the terms table is ' + (width > 760 ? 'two columns' : 'ONE column'), width > 760 ? g.termsCols === 2 : g.termsCols === 1, 'cols=' + g.termsCols);
        if (width < 760) check(width + 'px client: the four hero figures wrap onto more than one row rather than shrinking', g.metaRows >= 2, 'rows=' + g.metaRows);
      }
      await cdp.evaluate('localStorage.clear(); sessionStorage.clear(); true'); await cdp.evaluate(adminBootstrap);
      for (const width of [1440, 390, 375]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 1024 });
        await cdp.send('Page.navigate', { url: BASE + '/' + adminPage }); await sleep(1500); await cdp.evaluate(WAIT_ADMIN);
        const real = await cdp.evaluate('document.documentElement.clientWidth');
        check(width + 'px admin: the browser genuinely reports that width', real === width, 'got ' + real);
        const g = await cdp.evaluate(ADMIN_GEOM);
        check(width + 'px admin: no horizontal overflow, nothing escapes the editor card', g.bodyScroll <= g.inner + 1 && g.over.length === 0, JSON.stringify(g));
        check(width + 'px admin: every toolbar/section/action control is at least 44×44 (' + g.controls + ' measured)', g.controls >= 15 && g.small.length === 0, JSON.stringify(g.small));
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.evaluate('localStorage.clear(); sessionStorage.clear(); true'); await cdp.evaluate(clientBootstrap);
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(800);
      const n = await cdp.evaluate(NARROW('/' + clientPage, '.fd-doc'));
      check('320px client (real iframe): the frame genuinely measures 320', n.reported === 320 && n.inner === 320, JSON.stringify(n));
      check('320px client: no horizontal overflow, nothing escapes the document, terms in one column', n.bodyScroll <= 321 && n.over.length === 0 && n.termsCols === 1, JSON.stringify(n));
      await cdp.evaluate('localStorage.clear(); sessionStorage.clear(); true'); await cdp.evaluate(adminBootstrap);
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(800);
      const na = await cdp.evaluate(NARROW('/' + adminPage, '#doc-form:not(.hidden)'));
      check('320px admin (real iframe): genuinely 320, no overflow, nothing escapes the form', na.reported === 320 && na.bodyScroll <= 321 && na.over.length === 0, JSON.stringify(na));
    } finally { await cdp.close(); }

    console.log('\n=== CONTRAST — real composited pixels ===\n');
    const m1 = runContrast('fund-document-client', clientPage, 'client document (gaining product, attachment, two custom sections)', clientBootstrap, WAIT_DOC);
    const m2 = runContrast('fund-document-client', lossPage, 'client document (losing product — the loss tone)', clientBootstrap, WAIT_DOC);
    const m3 = runContrast('fund-document-admin', adminPage, 'PM authoring page (counter over cap, inline server error on screen)', adminBootstrap, PREPARE_ADMIN);
    console.log('  total measurements: ' + (m1 + m2 + m3));

    console.log('\n=== FONTS — Inter only ===\n');
    runFonts(clientPage, 'fund-document.html', clientBootstrap);
    runFonts(adminPage, 'admin-fund-document.html', adminBootstrap);
  } finally {
    if (attPath) await admin.storage.from('fund-documents').remove([attPath]);
    await admin.from('product_documents').delete().in('product_id', [gainId, lossId]);
    await admin.from('nav_publications').delete().in('product_id', [gainId, lossId]);
    await admin.from('products').delete().in('id', [gainId, lossId]);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    const { error: delErr } = await admin.auth.admin.deleteUser(clientId);
    if (delErr) console.log('  cleanup: could not delete test user: ' + delErr.message);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}
main().catch((err) => { console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err)); console.error(err && err.stack); process.exit(1); });
