#!/usr/bin/env node
// ★ Product catalog — live pricing, part 1 (2026-09-11) — visual verification.
//
// Contrast on every new text surface (client card price block + the three source states +
// both change tones; the admin list's four source colours; the New product modal after a
// real search; the Publish valuation modal with a populated impact table in both delta
// tones), a font audit (Inter only, tabular-nums for figures — no second family, row 192),
// and 1440/390/375 + a real 320px iframe. Delegates the sampling to verify-contrast.mjs /
// audit-fonts.mjs via their CONTRAST_PROFILE / _BOOTSTRAP_JS / _PREPARE_JS hooks.
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
const PASSWORD = 'VerifyLivePricingVisual-2026!';
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

const WAIT_CARDS = `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<160;i++){ const g=document.getElementById('asset-cards-grid'); if (g && g.querySelectorAll('[data-product-id]').length>0 && !/animate-pulse/.test(g.innerHTML)) return true; await s(250);} return false; })()`;
const PREPARE_ADMIN_LIST = `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<160;i++){ if (document.querySelectorAll('.product-row').length>0) break; await s(250);} const flagged=[...document.querySelectorAll('.product-row')].find(r=>/Quote failed/.test(r.textContent)); if (flagged) flagged.click(); await s(300); return true; })()`;
const PREPARE_ADMIN_ADD = `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<160;i++){ if (document.querySelectorAll('.product-row').length>0) break; await s(250);} document.getElementById('open-add-modal').click(); const inp=document.getElementById('add-symbol-search'); inp.value='aapl'; inp.dispatchEvent(new Event('input')); for (let i=0;i<120;i++){ if (document.querySelectorAll('.symbol-result').length>0) break; await s(250);} const row=[...document.querySelectorAll('.symbol-result')].find(b=>b.dataset.symbol==='AAPL'); if (row) row.click(); for (let i=0;i<120;i++){ if (/Price will track/.test(document.getElementById('add-live-preview-label').textContent)) break; await s(250);} await s(300); return true; })()`;
const PREPARE_ADMIN_NAV = (pct) => `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<160;i++){ if (document.querySelectorAll('.product-row').length>0) break; await s(250);} [...document.querySelectorAll('.product-row')].find(r=>r.dataset.id==='PROD-0001').click(); await s(200); [...document.querySelectorAll('.publish-nav-btn')].find(b=>b.dataset.id==='PROD-0001').click(); for (let i=0;i<120;i++){ if (document.querySelectorAll('.nav-impact-row').length>0) break; await s(250);} const f=document.getElementById('nav-change-percent'); f.value='${pct}'; f.dispatchEvent(new Event('input')); await s(300); return true; })()`;

function runContrast(profile, page, label, bootstrap, prepare) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8',
    env: Object.assign({}, process.env, { CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/' + page, CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare, CONTRAST_SETTLE_MS: '25000', CONTRAST_PORT: '9333' })
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
  const res = spawnSync(process.execPath, ['audit-fonts.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', env: Object.assign({}, process.env, { AUDIT_URL: BASE + '/' + page, AUDIT_BOOTSTRAP_JS: bootstrap }) });
  const out = (res.stdout || '') + (res.stderr || '');
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family — the scheme is Inter (row 192)', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}
async function connectChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'mw-lpvis-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); } }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { send, evaluate, close: () => { ws.close(); chrome.kill(); } };
}

const CARD_GEOM = `(() => { const cards=[...document.querySelectorAll('#asset-cards-grid [data-product-id]')]; const inner=window.innerWidth; const out={ inner, bodyScroll: document.body.scrollWidth, cards: cards.length, overflow: [] }; for (const c of cards){ const cr=c.getBoundingClientRect(); for (const sel of ['.product-price','.product-ticker','.price-source','.fractional-note','.price-change']) { const el=c.querySelector(sel); if(!el) continue; const r=el.getBoundingClientRect(); if (r.right > cr.right+0.5 || r.left < cr.left-0.5) out.overflow.push(c.dataset.productId+' '+sel+' '+Math.round(r.right)+'>'+Math.round(cr.right)); } } out.cols=new Set(cards.map(c=>Math.round(c.getBoundingClientRect().left))).size; return out; })()`;
const NARROW_CLIENT = `(async () => { const nap=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<80&&!document.body;i++) await nap(100); const f=document.createElement('iframe'); f.style.cssText='width:320px;height:900px;border:0'; f.src='/asset-collection.html'; document.body.appendChild(f); await new Promise(r=>f.addEventListener('load',r)); const d=f.contentDocument,w=f.contentWindow; for (let i=0;i<160;i++){ const g=d.getElementById('asset-cards-grid'); if (g && g.querySelectorAll('[data-product-id]').length>0 && !/animate-pulse/.test(g.innerHTML)) break; await nap(250);} const cards=[...d.querySelectorAll('#asset-cards-grid [data-product-id]')]; const overflow=[]; for (const c of cards){ const cr=c.getBoundingClientRect(); for (const sel of ['.product-price','.product-ticker','.price-source','.price-change']) { const el=c.querySelector(sel); if(!el) continue; const r=el.getBoundingClientRect(); if (r.right>cr.right+0.5) overflow.push(c.dataset.productId+' '+sel); } } return { reported: d.documentElement.clientWidth, cards: cards.length, bodyScroll: d.body.scrollWidth, inner: w.innerWidth, overflow }; })()`;
const NAV_GEOM = `(() => { const m=document.querySelector('#nav-modal .relative'); const mr=m.getBoundingClientRect(); const rows=[...document.querySelectorAll('.nav-impact-row')]; const over=[]; for (const r of rows){ for (const el of r.children){ const b=el.getBoundingClientRect(); if (b.right>mr.right+0.5) over.push(el.className.slice(0,30)+' '+Math.round(b.right)+'>'+Math.round(mr.right)); } } const seg=[...document.querySelectorAll('.nav-mode-btn')].map(b=>Math.round(b.getBoundingClientRect().height)); return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, modalRight: mr.right, rows: rows.length, over, segH: seg, modalScrollW: m.scrollWidth, modalClientW: m.clientWidth }; })()`;
const ADD_GEOM = `(() => { const m=document.querySelector('#add-modal .relative'); const rows=[...document.querySelectorAll('.symbol-result')]; const mr=m.getBoundingClientRect(); const over=[]; for (const r of rows){ const b=r.getBoundingClientRect(); if (b.right>mr.right+0.5) over.push('row'); } const seg=[...document.querySelectorAll('.add-model-btn')].map(b=>Math.round(b.getBoundingClientRect().height)); return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, rows: rows.length, over, segH: seg, modalScrollW: m.scrollWidth, modalClientW: m.clientWidth }; })()`;

async function main() {
  console.log('Product catalog — live pricing, part 1: visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const email = 'lpvis-' + suffix + '@test.marketswave.local';
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (cErr) throw new Error(cErr.message);
  const clientId = created.user.id;
  const badId = 'PROD-' + String(9700 + parseInt(suffix.slice(0, 2), 16)).padStart(4, '0');
  const ethBefore = (await admin.from('products').select('price_change_percent, price_as_of').eq('id', 'PROD-0004').single()).data;
  const vtBefore = (await admin.from('products').select('price_change_percent').eq('id', 'PROD-0003').single()).data;
  const ethCacheBefore = (await admin.from('market_data_cache').select('last_updated').eq('symbol', 'ETH').single()).data;
  try {
    await admin.from('clients').insert({ id: clientId, name: 'Pricing Visual', email: 'lpvis-' + clientId, phone: '+1', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0001', units: 120.5, cost_basis: 15000 });
    // A winner and a loser so both change tones are measured; ETH stale (grey) so all three
    // source states are on screen; a quote-failed product for the red admin line.
    await admin.from('products').update({ price_change_percent: 1.34 }).eq('id', 'PROD-0003');
    const staleIso = new Date(Date.now() - 2 * 3600e3).toISOString();
    await admin.from('market_data_cache').update({ last_updated: staleIso }).eq('symbol', 'ETH');
    await admin.from('products').update({ price_change_percent: -0.64, price_as_of: staleIso }).eq('id', 'PROD-0004');
    await admin.from('products').insert({ id: badId, name: 'Flag Visual ' + suffix, asset_class: 'Stocks & ETFs', investment_type: 'ETF', risk_tier: 'balanced', minimum_investment: 100, unit_price: 42.42, inception_unit_price: 42.42, created_at: '2026-09-11', last_tick_date: '2026-09-11', pricing_model: 'market', ticker: 'ZV' + suffix.slice(0, 4).toUpperCase(), price_source: 'finnhub', price_as_of: staleIso, price_status: 'quote_failed', price_failure_reason: 'The provider returned no usable price on the last refresh. The last known good price is retained.', price_last_failed_at: new Date().toISOString() });

    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error(sErr.message);
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const clientBootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + '); sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + '); sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + '); true';
    const adminSigned = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (adminSigned.error) throw new Error(adminSigned.error.message);
    const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(adminSigned.data.session)) + '); true';

    console.log('\n=== CONTRAST — real composited pixels ===\n');
    runContrast('live-pricing-client', 'asset-collection.html', 'client cards (3 source states, both change tones)', clientBootstrap, WAIT_CARDS);
    runContrast('live-pricing-admin-list', 'admin-products.html', 'admin list + quote-failed block', adminBootstrap, PREPARE_ADMIN_LIST);
    runContrast('live-pricing-admin-add', 'admin-products.html', 'New product modal after a real search', adminBootstrap, PREPARE_ADMIN_ADD);
    runContrast('live-pricing-admin-nav', 'admin-products.html', 'Publish valuation modal, +4.2% (gain tone)', adminBootstrap, PREPARE_ADMIN_NAV('4.2'));
    runContrast('live-pricing-admin-nav', 'admin-products.html', 'Publish valuation modal, -3% (loss tone)', adminBootstrap, PREPARE_ADMIN_NAV('-3'));

    console.log('\n=== FONTS — Inter only ===\n');
    runFonts('asset-collection.html', 'asset-collection.html', clientBootstrap);
    runFonts('admin-products.html', 'admin-products.html', adminBootstrap);

    console.log('\n=== MOBILE — 1440/390/375/320 ===\n');
    const cdp = await connectChrome();
    try {
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(600); await cdp.evaluate(clientBootstrap);
      await cdp.send('Page.navigate', { url: BASE + '/asset-collection.html' }); await cdp.evaluate(WAIT_CARDS); // warm-up
      for (const width of [1440, 390, 375]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
        await cdp.send('Page.navigate', { url: BASE + '/asset-collection.html' }); await sleep(2000); await cdp.evaluate(WAIT_CARDS);
        const real = await cdp.evaluate('document.documentElement.clientWidth');
        check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);
        const g = await cdp.evaluate(CARD_GEOM);
        check(width + 'px: cards rendered', g.cards >= 4, JSON.stringify(g));
        check(width + 'px: no horizontal overflow on the page', g.bodyScroll <= g.inner + 1, JSON.stringify(g));
        check(width + 'px: ★ price, ticker chip, change and source line all stay inside their card', g.overflow.length === 0, JSON.stringify(g.overflow));
        if (width < 1024) check(width + 'px: cards stack in one column', g.cols === 1, String(g.cols));
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Page.navigate', { url: BASE + '/asset-collection.html' }); await sleep(2000);
      const narrow = await cdp.evaluate(NARROW_CLIENT);
      check('320px: the iframe genuinely reports 320px', narrow.reported === 320, JSON.stringify(narrow));
      check('320px: cards rendered, no horizontal overflow', narrow.cards >= 4 && narrow.bodyScroll <= narrow.inner + 1, JSON.stringify(narrow));
      check('320px: ★ nothing in the price block escapes its card', narrow.overflow.length === 0, JSON.stringify(narrow.overflow));

      // Admin modals at 390px.
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(400); await cdp.evaluate(adminBootstrap);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Page.navigate', { url: BASE + '/admin-products.html' }); await sleep(2500);
      await cdp.evaluate(PREPARE_ADMIN_NAV('4.2'));
      const nv = await cdp.evaluate(NAV_GEOM);
      check('390px: the Publish valuation modal does not scroll horizontally', nv.modalScrollW <= nv.modalClientW + 1 && nv.bodyScroll <= nv.inner + 1, JSON.stringify(nv));
      check('390px: ★ every impact-row cell stays inside the modal (' + nv.rows + ' rows)', nv.rows > 0 && nv.over.length === 0, JSON.stringify(nv.over));
      check('390px: the mode segment meets the 44px floor', nv.segH.every((h) => h >= 44), JSON.stringify(nv.segH));
      await cdp.send('Page.navigate', { url: BASE + '/admin-products.html' }); await sleep(2500);
      await cdp.evaluate(PREPARE_ADMIN_ADD);
      const ad = await cdp.evaluate(ADD_GEOM);
      check('390px: the New product modal with live search results does not scroll horizontally', ad.rows > 0 && ad.over.length === 0 && ad.modalScrollW <= ad.modalClientW + 1, JSON.stringify(ad));
      check('390px: the model segment meets the 44px floor', ad.segH.every((h) => h >= 44), JSON.stringify(ad.segH));
    } finally { cdp.close(); }
  } finally {
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('transactions').delete().eq('client_id', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('products').delete().eq('id', badId);
    await admin.from('products').update({ price_change_percent: vtBefore ? vtBefore.price_change_percent : null }).eq('id', 'PROD-0003');
    await admin.from('products').update({ price_change_percent: ethBefore ? ethBefore.price_change_percent : null, price_as_of: ethBefore ? ethBefore.price_as_of : null }).eq('id', 'PROD-0004');
    if (ethCacheBefore) await admin.from('market_data_cache').update({ last_updated: ethCacheBefore.last_updated }).eq('symbol', 'ETH');
    await admin.from('clients').delete().eq('id', clientId);
    await admin.auth.admin.deleteUser(clientId);
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS'); process.exit(0);
}
main().catch((err) => { console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err)); console.error(err && err.stack); process.exit(1); });
