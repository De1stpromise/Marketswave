#!/usr/bin/env node
// ★★ Catalog expansion (2026-09-14, row 211) — the browsing surface at ~250 products.
//
// PART A (jsdom, the REAL asset-collection.html script in a real DOM, real Supabase calls):
//   four-up compact cards with a held/unheld footer; search by name OR ticker across the
//   WHOLE catalog (a match beyond page one is the first card of a search); class chips with
//   live counts that respect the search; a real sort control; "Continue browsing" paging at
//   24 with "Showing N of M"; the allocation panel's three states with every row present in
//   every state, quick amounts as percentages of available, the held product's "position
//   becomes", a real below-minimum error on a real Private Equity product, Escape/Cancel.
// PART B (headless Chrome over CDP, real composited pixels):
//   every card identical in both dimensions across the real catalog's longest and shortest
//   names and largest and smallest prices; the grid stepping 4 -> 3 -> 2 -> 1 columns by
//   CONTAINER width (1440 / 1280 / 1100 / 390 / 375, and a real 320px iframe); contrast on
//   the card face and on the panel in all three states, with the sheen composited
//   (verify-glass-sheen on this page); fonts Inter only.
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
// Usage (from scripts/): npm run verify-catalog-expansion
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'VerifyCatalogExpansion-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9452;
const PAGE_SIZE = 24;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { if (await test()) return true; await sleep(150); }
  return test();
}
function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}
function buildPageDom(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  return new JSDOM('<!doctype html><html><body>' + body + '</body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
}

// ---- CDP ------------------------------------------------------------------------------
async function connectChrome() {
  const profile = makeTempDir('mw-catx-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); } }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  return { send, evaluate, close: () => releaseTempDir(profile) };
}
const WAIT_CARDS = `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<200;i++){ const g=document.getElementById('asset-cards-grid'); if (g && g.querySelectorAll('[data-product-id]').length>0 && !/animate-pulse/.test(g.innerHTML)) { await s(300); return true; } await s(250);} return false; })()`;
const SHOW_ALL = `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<20;i++){ const b=document.getElementById('load-more-btn'); if (!b || b.classList.contains('hidden')) break; b.click(); await s(150);} await s(400); return document.querySelectorAll('#asset-cards-grid [data-product-id]').length; })()`;
const GEOM = `(() => { const cards=[...document.querySelectorAll('#asset-cards-grid [data-product-id]')]; const rects=cards.map(c=>{ const r=c.getBoundingClientRect(); return { id:c.dataset.productId, w:r.width, h:r.height, l:r.left, top:r.top }; }); const ws=rects.map(r=>r.w), hs=rects.map(r=>r.h); const over=[]; for (const c of cards){ const cr=c.getBoundingClientRect(); for (const el of c.querySelectorAll('*')) { const r=el.getBoundingClientRect(); if (r.width && (r.right>cr.right+0.5 || r.left<cr.left-0.5 || r.bottom>cr.bottom+0.5)) over.push(c.dataset.productId+' '+(el.className||el.tagName)); } } const names=[...document.querySelectorAll('.cat-name')]; const clipped=names.filter(n=>n.scrollWidth>n.clientWidth+0.5).length; return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, cards: cards.length, wMin: Math.min(...ws), wMax: Math.max(...ws), hMin: Math.min(...hs), hMax: Math.max(...hs), cols: new Set(rects.map(r=>Math.round(r.l))).size, shell: document.querySelector('.cat-shell').getBoundingClientRect().width, over: [...new Set(over)].slice(0,8), clipped, rects }; })()`;
const MODAL_GEOM = `(() => { const m=document.querySelector('#alloc-modal .cat-modal'); const r=m.getBoundingClientRect(); const rows=['.cat-fieldlbl','.cat-amt','.cat-err','.cat-quick','.cat-result','.cat-after','.cat-gate','.cat-mf'].map(s=>!!m.querySelector(s)); return { h: r.height, w: r.width, rows, inner: window.innerWidth, scrollW: m.scrollWidth, clientW: m.clientWidth, err: !document.getElementById('alloc-error').classList.contains('is-hidden'), disabled: document.getElementById('alloc-submit').disabled }; })()`;
function openPanelJs(name, amount) {
  return `(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); await ${WAIT_CARDS}; const box=document.getElementById('asset-search'); box.value=${JSON.stringify(name)}; box.dispatchEvent(new Event('input',{bubbles:true})); await s(200); const card=[...document.querySelectorAll('#asset-cards-grid [data-product-id]')].find(c=>c.querySelector('.cat-name').textContent===${JSON.stringify(name)}); if(!card) return 'no card for ' + ${JSON.stringify(name)}; card.querySelector('.request-allocation-btn').click(); await s(150); const a=document.getElementById('alloc-amount'); a.value=${JSON.stringify(String(amount))}; a.dispatchEvent(new Event('input',{bubbles:true})); a.blur(); await s(250); return true; })()`;
}
function runContrast(profile, page, label, bootstrap, prepare) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/' + page, CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare, CONTRAST_SETTLE_MS: '25000', CONTRAST_PORT: '9333' })
  });
  forwardChildTeardown(res, 'verify-contrast');
  let out = (res.stdout || '') + (res.stderr || '');
  // A child that printed NOTHING is reported with its spawn status rather than read as a silent failure (row 210).
  if (!out.trim()) out = 'verify-contrast printed nothing: status ' + res.status + ' signal ' + res.signal + ' error ' + (res.error && res.error.message);
  const tail = out.trim().split('\n').slice(-2).join(' | ');
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + tail);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  out.split('\n').filter((l) => /FAIL\s+\d|UNMEASURED\s/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}

async function main() {
  console.log('Catalog expansion — verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const email = 'catx-' + suffix + '@test.marketswave.local';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (cErr) throw new Error(cErr.message);
  const clientId = created.user.id;
  let chrome = null;
  try {
    const { data: all } = await admin.from('products').select('id,name,asset_class,unit_price,minimum_investment,ticker,pricing_model').neq('asset_class', 'Unallocated / Cash');
    const byName = all.slice().sort((a, b) => a.name.localeCompare(b.name));
    const nordic = all.find((p) => p.name === 'Nordic Growth Fund');
    const etf = all.find((p) => p.name === 'Global Equity ETF');
    const eth = all.find((p) => p.name === 'Ethereum');
    check('the catalog has more than one page of products (' + all.length + ')', all.length > PAGE_SIZE, String(all.length));
    check('the three seeded products this suite leans on exist', !!nordic && !!etf && !!eth);
    const longest = all.reduce((a, b) => (b.name.length > a.name.length ? b : a));
    const shortest = all.reduce((a, b) => (b.name.length < a.name.length ? b : a));
    const priciest = all.reduce((a, b) => (Number(b.unit_price) > Number(a.unit_price) ? b : a));
    const cheapest = all.reduce((a, b) => (Number(b.unit_price) < Number(a.unit_price) ? b : a));
    console.log('  longest name: "' + longest.name + '" (' + longest.name.length + ') · shortest: "' + shortest.name + '" · priciest: ' + priciest.name + ' $' + priciest.unit_price + ' · cheapest: ' + cheapest.name + ' $' + cheapest.unit_price);
    // A product beyond page one under the default sort, with a ticker — the search-beyond-page-one target.
    const beyond = byName.slice(PAGE_SIZE).find((p) => p.ticker && p.id !== etf.id && p.id !== eth.id);
    check('a ticker-bearing product exists beyond page one under the default sort', !!beyond, String(byName.length));

    const UNALLOCATED = 12345.67;
    await admin.from('clients').insert({ id: clientId, name: 'Catalog Expansion', email: 'catx-' + clientId, phone: '+1', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: UNALLOCATED, allocated_capital: 0, asset_returns: 0 });
    // A winner (ETF, cheap cost basis) and a loser (ETH, expensive cost basis) so both footer tones render.
    await admin.from('holdings').insert([
      { client_id: clientId, product_id: etf.id, units: 20.5, cost_basis: 200 },
      { client_id: clientId, product_id: eth.id, units: 0.25, cost_basis: 5000 }
    ]);

    // =========================================================================================
    console.log('\n=== PART A: the real page script in a real DOM ===\n');
    const client = await MarketswaveData.getSupabaseClient();
    const { error: sErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    check('real signInWithPassword succeeds', !sErr, sErr && sErr.message);
    const pagePath = fileURLToPath(new URL('../asset-collection.html', import.meta.url));
    const dom = buildPageDom(pagePath);
    const W = dom.window, D = W.document;
    W.MarketswaveData = MarketswaveData;
    W.getClientInitials = (name) => name.slice(0, 2).toUpperCase();
    W.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8'));
    W.eval(extractInlineScript(pagePath, 'Catalog expansion (2026-09-14'));
    const grid = D.getElementById('asset-cards-grid');
    const cards = () => [...grid.querySelectorAll('[data-product-id]')];
    const cardFor = (id) => grid.querySelector('[data-product-id="' + id + '"]');
    const countEl = D.getElementById('cat-count');
    const more = D.getElementById('load-more-btn');
    const search = D.getElementById('asset-search');
    const type = (v) => { search.value = v; search.dispatchEvent(new W.Event('input', { bubbles: true })); };
    const chipCount = (cls) => Number(D.querySelector('.cat-chip-n[data-count-for="' + cls + '"]').textContent);
    await pollUntil(() => !/animate-pulse/.test(grid.innerHTML) && cards().length > 0, 40000);

    console.log('-- paging');
    check('the first page renders exactly 24 cards, never the whole catalog', cards().length === PAGE_SIZE, String(cards().length));
    check('"Showing 24 of M" states the real total', countEl.textContent === 'Showing 24 of ' + all.length, countEl.textContent);
    check('the control reads "Continue browsing" and is visible', /Continue browsing/.test(more.textContent) && !more.classList.contains('hidden'));
    check('every card carries exactly one asset mark and a ticker slot', cards().every((c) => c.querySelectorAll('.mk').length === 1 && !!c.querySelector('.cat-slot')));
    more.click();
    check('Continue browsing appends the next 24 (or the remainder)', cards().length === Math.min(48, all.length) && countEl.textContent === 'Showing ' + Math.min(48, all.length) + ' of ' + all.length, countEl.textContent);
    for (let i = 0; i < 20 && !more.classList.contains('hidden'); i++) more.click();
    check('paging reaches the whole catalog and the control hides at the end', cards().length === all.length && more.classList.contains('hidden'), cards().length + ' vs ' + all.length);

    console.log('-- held vs unheld footer');
    check('the held ETF card is tinted, carries the position and says "Add"', cardFor(etf.id).classList.contains('is-held') && !!cardFor(etf.id).querySelector('.cat-pos') && !cardFor(etf.id).querySelector('.cat-min') && cardFor(etf.id).querySelector('.request-allocation-btn').textContent.trim() === 'Add', cardFor(etf.id).textContent);
    check('the held ETH position shows a real loss tone (the seeded cost basis is above its value)', !!cardFor(eth.id).querySelector('.cat-g.dn'), cardFor(eth.id).querySelector('.cat-pos') && cardFor(eth.id).querySelector('.cat-pos').textContent);
    check('the held ETF position shows a real gain tone', !!cardFor(etf.id).querySelector('.cat-g.up'));
    check('an unheld card carries the minimum only and says "Allocate"', !!cardFor(nordic.id).querySelector('.cat-min') && !cardFor(nordic.id).querySelector('.cat-pos') && cardFor(nordic.id).querySelector('.request-allocation-btn').textContent.trim() === 'Allocate');
    check('no card carries BOTH a minimum and a position', cards().every((c) => !(c.querySelector('.cat-min') && c.querySelector('.cat-pos'))));

    console.log('-- search across the whole catalog');
    type(beyond.ticker.toLowerCase());
    check('★ a ticker search finds a product that lives beyond page one (' + beyond.ticker + ')', !!cardFor(beyond.id) && cards().length < PAGE_SIZE, cards().length + ' cards; count ' + countEl.textContent);
    check('the count reflects the search, not the page', countEl.textContent === 'Showing ' + cards().length + ' of ' + cards().length, countEl.textContent);
    const nameFrag = beyond.name.split(' ').slice(-1)[0];
    type(nameFrag.toUpperCase());
    check('a name search is case-insensitive and finds the same product', !!cardFor(beyond.id), nameFrag);
    type('zzzz-no-such-product');
    check('no matches shows the empty state and hides the paging control', !D.getElementById('no-results').classList.contains('hidden') && more.classList.contains('hidden') && cards().length === 0);
    type('');
    check('clearing the search restores the first page', cards().length === PAGE_SIZE && D.getElementById('no-results').classList.contains('hidden'));

    console.log('-- class chips with live counts');
    const classes = ['Stocks & ETFs', 'Crypto', 'Private Equity', 'Real Assets'];
    const expected = Object.fromEntries(classes.map((c) => [c, all.filter((p) => p.asset_class === c).length]));
    check('with an empty search the four class counts sum to the whole catalog and each matches the real class', classes.every((c) => chipCount(c) === expected[c]) && chipCount('') === all.length, classes.map((c) => c + ':' + chipCount(c) + '/' + expected[c]).join(' '));
    type('eth');
    const ethMatches = all.filter((p) => /eth/i.test(p.name) || /eth/i.test(p.ticker || ''));
    check('chip counts follow the search (they say where the matches are)', chipCount('') === ethMatches.length && chipCount('Crypto') === ethMatches.filter((p) => p.asset_class === 'Crypto').length, chipCount('') + '/' + ethMatches.length);
    type('');
    const cryptoChip = [...D.querySelectorAll('.category-tab')].find((t) => t.dataset.category === 'Crypto');
    cryptoChip.click();
    check('the Crypto chip becomes the pressed one and filters the grid to crypto only', cryptoChip.getAttribute('aria-pressed') === 'true' && cards().length > 0 && cards().every((c) => /Crypto/.test(c.querySelector('.cat-cl').textContent)) && countEl.textContent.endsWith('of ' + expected['Crypto']), countEl.textContent);
    [...D.querySelectorAll('.category-tab')].find((t) => t.dataset.category === '').click();

    console.log('-- sort');
    const sortEl = D.getElementById('catalog-sort');
    const setSort = (v) => { sortEl.value = v; sortEl.dispatchEvent(new W.Event('change', { bubbles: true })); };
    const price = (c) => Number(c.querySelector('.product-price').textContent.replace(/[^0-9.]/g, ''));
    setSort('price-desc');
    check('Price high–low: the first card is the priciest product', cards()[0].dataset.productId === priciest.id && price(cards()[0]) >= price(cards()[1]), cards()[0].querySelector('.cat-name').textContent);
    setSort('price-asc');
    check('Price low–high: the first card is the cheapest product', cards()[0].dataset.productId === cheapest.id, cards()[0].querySelector('.cat-name').textContent);
    setSort('held-first');
    check('Held first: both held products lead, then the rest alphabetically', cards().slice(0, 2).every((c) => c.classList.contains('is-held')) && !cards()[2].classList.contains('is-held'));
    setSort('name-desc');
    check('Name Z–A: the first card is the last name alphabetically', cards()[0].dataset.productId === byName[byName.length - 1].id);
    setSort('name-asc');

    console.log('-- the allocation panel');
    const modal = D.getElementById('alloc-modal'), amount = D.getElementById('alloc-amount'), submit = D.getElementById('alloc-submit');
    const errEl = D.getElementById('alloc-error'), errText = D.getElementById('alloc-error-text');
    const typeAmount = (v) => { amount.value = v; amount.dispatchEvent(new W.Event('input', { bubbles: true })); };
    const ROWS = ['.cat-fieldlbl', '.cat-amt', '.cat-err', '.cat-quick', '.cat-result', '.cat-after', '.cat-gate', '.cat-mf'];
    const rowsPresent = () => ROWS.every((s) => !!modal.querySelector(s)) && modal.querySelectorAll('.cat-after').length === 2;
    const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
    const unitsFmt = (u) => u.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: u < 1 ? 5 : 2 }) + ' units'; // the page's own rule
    // State 1: a new position on an unheld ETF-class product.
    const unheldEtf = all.find((p) => p.asset_class === 'Stocks & ETFs' && p.id !== etf.id && Number(p.minimum_investment) <= 1000);
    type(unheldEtf.name);
    cardFor(unheldEtf.id).querySelector('.request-allocation-btn').click();
    check('state 1 (new position): opens with every row present, "This would be", the button disabled, the error reserved but hidden', modal.hidden === false && rowsPresent() && D.getElementById('alloc-after1-k').textContent === 'This would be' && submit.disabled && errEl.classList.contains('is-hidden'));
    check('the Available figure sits in the field label, with the real balance', D.getElementById('alloc-available').textContent === fmt(UNALLOCATED), D.getElementById('alloc-available').textContent);
    check('the gate note for an ETF is the standard review note (no illiquidity language)', /reviews this before it executes/.test(D.getElementById('alloc-gate').textContent) && !/illiquid/.test(D.getElementById('alloc-gate').textContent));
    D.querySelector('.cat-quick [data-quick="25"]').click();
    check('25% sets a quarter of AVAILABLE and lights that button', Math.abs(Number(amount.value.replace(/,/g, '')) - Math.floor(UNALLOCATED * 25) / 100) < 0.011 && D.querySelector('.cat-quick [data-quick="25"]').classList.contains('is-on'), amount.value);
    D.querySelector('.cat-quick [data-quick="50"]').click();
    check('50% sets half of available and the result names the units', Math.abs(Number(amount.value.replace(/,/g, '')) - Math.floor(UNALLOCATED * 50) / 100) < 0.011 && /units/.test(D.getElementById('alloc-units').textContent) && !submit.disabled, amount.value + ' / ' + D.getElementById('alloc-units').textContent);
    D.querySelector('.cat-quick [data-quick="max"]').click();
    check('Max sets the whole available balance and "Unallocated after" reads $0', Math.abs(Number(amount.value.replace(/,/g, '')) - Math.floor(UNALLOCATED * 100) / 100) < 0.011 && D.getElementById('alloc-after2-v').textContent === '$0', D.getElementById('alloc-after2-v').textContent);
    D.querySelector('.cat-quick [data-quick="min"]').click();
    check('Min sets the product\'s own minimum and the result gets its own units figure', Number(amount.value.replace(/,/g, '')) === Number(unheldEtf.minimum_investment) && D.getElementById('alloc-units').textContent === unitsFmt(Number(unheldEtf.minimum_investment) / Number(unheldEtf.unit_price)), amount.value + ' / ' + D.getElementById('alloc-units').textContent);
    typeAmount('999999');
    check('above available: a real error, muted result, disabled button — and every row still present', !errEl.classList.contains('is-hidden') && /available/.test(errText.textContent) && D.getElementById('alloc-result').classList.contains('is-muted') && submit.disabled && rowsPresent(), errText.textContent);
    D.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes the panel', modal.hidden === true);
    // State 2: adding to the held ETF.
    type(etf.name);
    cardFor(etf.id).querySelector('.request-allocation-btn').click();
    typeAmount('1000');
    const unitsNow = 1000 / Number(etf.unit_price);
    check('state 2 (held): the title says "Add to", the row reads "Position becomes" with the SUMMED units', /^Add to /.test(D.getElementById('alloc-title').textContent) && D.getElementById('alloc-after1-k').textContent === 'Position becomes' && D.getElementById('alloc-after1-v').textContent === unitsFmt(20.5 + unitsNow) && rowsPresent(), D.getElementById('alloc-after1-v').textContent);
    check('"Unallocated after" is available minus the amount', D.getElementById('alloc-after2-v').textContent === fmt(UNALLOCATED - 1000), D.getElementById('alloc-after2-v').textContent);
    D.getElementById('alloc-cancel').click();
    // State 3: below the minimum on a real Private Equity product.
    type(nordic.name);
    cardFor(nordic.id).querySelector('.request-allocation-btn').click();
    typeAmount('500');
    check('★ state 3 (below minimum, real PE product): a real error naming the minimum, muted result, disabled button, every row present', !errEl.classList.contains('is-hidden') && errText.textContent.indexOf('$' + Number(nordic.minimum_investment).toLocaleString('en-US')) !== -1 && D.getElementById('alloc-result').classList.contains('is-muted') && submit.disabled && rowsPresent() && D.getElementById('alloc-units').textContent === '—', errText.textContent);
    check('the PE gate note mentions illiquidity and the full term', /illiquid/.test(D.getElementById('alloc-gate').textContent) && /full term/.test(D.getElementById('alloc-gate').textContent), D.getElementById('alloc-gate').textContent);
    D.getElementById('alloc-modal-close').click();
    type('');

    console.log('-- suite hooks that other suites depend on');
    check('every card exposes .product-price, .price-source[data-source], .price-change, .product-ticker (market) and .request-allocation-btn', cards().every((c) => c.querySelector('.product-price') && c.querySelector('.price-source[data-source]') && c.querySelector('.price-change') && c.querySelector('.request-allocation-btn')) && cards().filter((c) => c.querySelector('.product-ticker')).length > 0);

    // =========================================================================================
    console.log('\n=== PART B: real composited pixels (headless Chrome) ===\n');
    const anon = createClient(url, anonKey);
    const { data: signed, error: s2 } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (s2) throw new Error(s2.message);
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const clientBootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + '); sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + '); sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + '); true';

    console.log('-- equal cards and the column steps');
    chrome = await connectChrome();
    await chrome.send('Page.navigate', { url: BASE + '/' }); await sleep(600); await chrome.evaluate(clientBootstrap);
    await chrome.send('Page.navigate', { url: BASE + '/asset-collection.html' }); await chrome.evaluate(WAIT_CARDS); // warm-up (cold functions)
    const expectCols = { 1440: 4, 1280: 3, 1100: 2, 390: 1, 375: 1 };
    for (const width of [1440, 1280, 1100, 390, 375]) {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
      await chrome.send('Page.navigate', { url: BASE + '/asset-collection.html' }); await sleep(1500); await chrome.evaluate(WAIT_CARDS);
      const real = await chrome.evaluate('document.documentElement.clientWidth');
      check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);
      const shown = await chrome.evaluate(SHOW_ALL);
      const g = await chrome.evaluate(GEOM);
      check(width + 'px: the whole catalog is on the page after Continue browsing (' + shown + ')', g.cards === all.length, g.cards + ' vs ' + all.length);
      check(width + 'px: ★ every card is identical in width AND height (' + g.wMin.toFixed(1) + '×' + g.hMin.toFixed(1) + ')', g.wMax - g.wMin < 0.6 && g.hMax - g.hMin < 0.6, 'w ' + g.wMin + '–' + g.wMax + ' h ' + g.hMin + '–' + g.hMax);
      const four = [longest, shortest, priciest, cheapest].map((p) => g.rects.find((r) => r.id === p.id));
      check(width + 'px: the longest/shortest name and largest/smallest price cards are all rendered and equal', four.every((r) => r && Math.abs(r.w - g.wMin) < 0.6 && Math.abs(r.h - g.hMin) < 0.6), JSON.stringify(four.map((r) => r && [r.w, r.h])));
      check(width + 'px: grid is ' + expectCols[width] + ' column(s) (container ' + Math.round(g.shell) + 'px)', g.cols === expectCols[width], String(g.cols));
      check(width + 'px: nothing escapes its card, no horizontal overflow', g.over.length === 0 && g.bodyScroll <= g.inner + 1, JSON.stringify(g.over) + ' body ' + g.bodyScroll + '/' + g.inner);
      if (width === 1440) check('1440px: the longest name is ellipsised rather than wrapping (at least one clipped name)', g.clipped >= 1, String(g.clipped));
    }
    // 320px through a real same-origin iframe (the top-level override floors above 320 on this build).
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
    await chrome.send('Page.navigate', { url: BASE + '/asset-collection.html' }); await sleep(1500);
    const narrow = await chrome.evaluate(`(async () => { const nap=(ms)=>new Promise(r=>setTimeout(r,ms)); for (let i=0;i<80&&!document.body;i++) await nap(100); const f=document.createElement('iframe'); f.style.cssText='width:320px;height:900px;border:0'; f.src='/asset-collection.html'; document.body.appendChild(f); await new Promise(r=>f.addEventListener('load',r)); const d=f.contentDocument,w=f.contentWindow; for (let i=0;i<200;i++){ const g=d.getElementById('asset-cards-grid'); if (g && g.querySelectorAll('[data-product-id]').length>0 && !/animate-pulse/.test(g.innerHTML)) break; await nap(250);} await nap(400); const cards=[...d.querySelectorAll('#asset-cards-grid [data-product-id]')]; const over=[]; const ws=[],hs=[]; for (const c of cards){ const cr=c.getBoundingClientRect(); ws.push(cr.width); hs.push(cr.height); for (const el of c.querySelectorAll('*')) { const r=el.getBoundingClientRect(); if (r.width && r.right>cr.right+0.5) over.push(c.dataset.productId+' '+(el.className||el.tagName)); } } return { reported: d.documentElement.clientWidth, cards: cards.length, bodyScroll: d.body.scrollWidth, inner: w.innerWidth, over:[...new Set(over)].slice(0,6), cols: new Set(cards.map(c=>Math.round(c.getBoundingClientRect().left))).size, wSpread: Math.max(...ws)-Math.min(...ws), hSpread: Math.max(...hs)-Math.min(...hs) }; })()`);
    check('320px: the iframe genuinely reports 320px', narrow.reported === 320, JSON.stringify(narrow));
    check('320px: one column, equal cards, nothing escapes, no horizontal overflow', narrow.cols === 1 && narrow.wSpread < 0.6 && narrow.hSpread < 0.6 && narrow.over.length === 0 && narrow.bodyScroll <= narrow.inner + 1, JSON.stringify(narrow));

    console.log('-- the panel keeps one height across its three states');
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const heights = {};
    for (const [state, name, amt] of [['new', unheldEtf.name, 1000], ['held', etf.name, 1000], ['below', nordic.name, 500]]) {
      await chrome.send('Page.navigate', { url: BASE + '/asset-collection.html' }); await sleep(800);
      const ok = await chrome.evaluate(openPanelJs(name, amt));
      const mg = await chrome.evaluate(MODAL_GEOM);
      heights[state] = mg.h;
      check('panel ' + state + ': opened with all rows (' + Math.round(mg.h) + 'px tall)' + (state === 'below' ? ', error visible, button disabled' : ''), ok === true && mg.rows.every(Boolean) && (state !== 'below' || (mg.err && mg.disabled)) && (state === 'below' || (!mg.err && !mg.disabled)), JSON.stringify(mg));
    }
    check('★ the panel is the same height in all three states', Math.abs(heights.new - heights.held) < 0.6 && Math.abs(heights.new - heights.below) < 0.6, JSON.stringify(heights));
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await chrome.send('Page.navigate', { url: BASE + '/asset-collection.html' }); await sleep(800);
    await chrome.evaluate(openPanelJs(nordic.name, 500));
    const mg390 = await chrome.evaluate(MODAL_GEOM);
    check('390px: the panel fits the viewport with no internal horizontal scroll', mg390.w <= mg390.inner && mg390.scrollW <= mg390.clientW + 1, JSON.stringify(mg390));
    await chrome.close(); chrome = null;

    console.log('\n-- contrast, real composited pixels (sheen composited: the shell carries .glass-lift)');
    runContrast('catalog-card', 'asset-collection.html', 'card face — held and unheld, both tones, chips, count, Continue browsing', clientBootstrap, WAIT_CARDS);
    runContrast('catalog-modal', 'asset-collection.html', 'panel, new position', clientBootstrap, openPanelJs(unheldEtf.name, 1000));
    runContrast('catalog-modal', 'asset-collection.html', 'panel, adding to a held position', clientBootstrap, openPanelJs(etf.name, 1000));
    runContrast('catalog-modal', 'asset-collection.html', 'panel, below the minimum (real PE product)', clientBootstrap, openPanelJs(nordic.name, 500));
    {
      const res = spawnSync(process.execPath, ['verify-glass-sheen.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', env: Object.assign({}, process.env, { SHEEN_PAGES: 'asset-collection.html', SHEEN_PORT: '9453' }) });
      forwardChildTeardown(res, 'verify-glass-sheen');
      const out = (res.stdout || '') + (res.stderr || '');
      const m = out.match(/(\d+) measured, (\d+) below/);
      console.log('  sheen audit -> ' + (out.split('\n').find((l) => /measured, \d+ below/.test(l)) || out.trim().split('\n').slice(-1)[0]));
      check('sheen audit on asset-collection.html: measured elements, none below 4.5:1 with the sheen composited, none UNMEASURED', !!m && Number(m[1]) > 0 && Number(m[2]) === 0 && !/UNMEASURED/.test(out) && res.status === 0, out.trim().split('\n').slice(-3).join(' | '));
    }
    {
      const res = spawnSync(process.execPath, ['verify-fonts.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', env: Object.assign({}, process.env, { AUDIT_URL: BASE + '/asset-collection.html', AUDIT_BOOTSTRAP_JS: clientBootstrap }) });
      forwardChildTeardown(res, 'verify-fonts');
      const out = (res.stdout || '') + (res.stderr || '');
      check('fonts: no fallback, no monospace family', !/FALLBACK/.test(out) && !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /FALLBACK|monospace/i.test(l)).join(' | '));
    }
  } finally {
    if (chrome) await chrome.close();
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('allocation_requests').delete().eq('client_id', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('conversations').update({ client_id: null }).eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    const { error: dErr } = await admin.auth.admin.deleteUser(clientId);
    if (dErr) console.log('  TEARDOWN WARNING: could not delete the test user ' + clientId + ': ' + dErr.message);
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  console.log('VERIFY: ' + (failed === 0 ? 'PASS' : 'FAIL'));
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
