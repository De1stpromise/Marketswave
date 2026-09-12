#!/usr/bin/env node
// ★ Round-robin market refresh + the seeded catalog (2026-09-12).
//
// Run from scripts/:  npm run verify-round-robin-refresh   (needs the local stack,
// `supabase functions serve`, a seeded catalog — `node supabase-seed-market-catalog.js` —
// and REAL provider calls: this suite spends ~7 minutes, mostly waiting out Finnhub's
// per-minute window between simulated cycles so the runs are genuinely independent).
//
// What it proves:
//   A. the SEEDED CATALOG: every market-priced product carries a real live price, the
//      asset class DERIVED from its provider, a real name and description, and none is
//      quote_failed; reports the distinct stock-symbol count and headroom.
//   B. a NEWLY CREATED product prices IMMEDIATELY — product row and cache row both carry a
//      live price within seconds, with no refresh run in between.
//   C. ROTATION genuinely cycles: with the union pushed past one run's capacity (30), six
//      simulated cycles show the reported oldest-symbol age stabilising at the theoretical
//      worst case rather than growing, every symbol refreshed in every full cycle, and
//      never the same subset twice in a row.
//   D. the RATE-LIMIT HALT: a second run inside the same minute stops short, records no
//      failures for the symbols it did not reach, and leaves them oldest for next time.
//   E. the CLIENT CATALOG renders every seeded product with its price (through Load More).

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
async function callFunction(url, token, name, body) {
  const r = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  let json = null; try { json = await r.json(); } catch (_e) {}
  return { status: r.status, body: json };
}
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}
function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
}
const vc = new VirtualConsole(); vc.forwardTo(console);
function buildPageDom(htmlPath) {
  return new JSDOM('<!doctype html><html><body>' + extractBodyMarkup(htmlPath) + '</body></html>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
}

// The local stack's REAL pg_cron jobs fire on the quarter hour and this proof spans several
// of them. A scheduled refresh landing mid-proof refreshes the very symbols a simulated cycle
// deliberately left oldest (found on this proof's second run: an "oldest age" of 0.9 min
// that the rotation alone cannot produce, and two consecutive runs picking the same subset
// because the cron run had rotated between them). Both jobs are paused for the duration
// and restored in the finally — local Docker stack only, which is all this script runs on.
function setSchedulerActive(active) {
  // cron.alter_job() as the job owner (the migration scheduled them as postgres) — a direct
  // UPDATE on cron.job is refused to that role on this stack.
  const sql = "select cron.alter_job(jobid, active := " + (active ? 'true' : 'false') + ") from cron.job where jobname like 'marketswave-%'";
  execSync('docker exec supabase_db_Marketswave psql -U postgres -d postgres -At -c "' + sql + '"', { encoding: 'utf8' });
}

const N = 30; // STOCK_SYMBOLS_PER_REFRESH_RUN, asserted against the function's own report below
const INTERVAL_MIN = 15;
const MINUTE_WINDOW_MS = 66000; // one full Finnhub window between real runs, so each run's budget is its own

async function main() {
  console.log('Round-robin market refresh + seeded catalog\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const { data: pm, error: pmErr } = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('PM sign-in failed: ' + pmErr.message);
  const pmToken = pm.session.access_token;

  const cleanup = { productIds: [], cacheSymbols: [], clientId: null };
  setSchedulerActive(false);
  console.log('(local pg_cron jobs paused for the duration — restored in the finally)');
  // Cache timestamps are manipulated in Part C; the real ones are restored afterwards.
  const cacheBefore = (await admin.from('market_data_cache').select('symbol, last_updated')).data || [];

  try {
    // ===================================================================================
    console.log('A. the seeded catalog');
    // ===================================================================================
    const { data: products } = await admin.from('products').select('*').order('id');
    const market = products.filter((p) => p.pricing_model === 'market');
    const stocks = market.filter((p) => p.price_source === 'finnhub');
    const cryptos = market.filter((p) => p.price_source === 'coingecko');
    check('at least 20 market-priced products exist (seeded through the real path)', market.length >= 20, String(market.length));
    check('every market product has a real ticker and provider', market.every((p) => p.ticker && p.price_source), market.filter((p) => !p.ticker || !p.price_source).map((p) => p.id).join(','));
    check('every market product carries a real live price (> 0) with an as-of timestamp', market.every((p) => Number(p.unit_price) > 0 && !!p.price_as_of), market.filter((p) => !(Number(p.unit_price) > 0) || !p.price_as_of).map((p) => p.id + '=' + p.unit_price).join(','));
    check('NONE is flagged quote_failed', market.every((p) => p.price_status !== 'quote_failed'), market.filter((p) => p.price_status === 'quote_failed').map((p) => p.id).join(','));
    check('every Finnhub product derived Stocks & ETFs, every CoinGecko product derived Crypto', stocks.every((p) => p.asset_class === 'Stocks & ETFs') && cryptos.every((p) => p.asset_class === 'Crypto'));
    check('every seeded product carries a real name (never just the ticker) and a description of what it holds', market.filter((p) => p.id >= 'PROD-0006').every((p) => p.name !== p.ticker && p.description && p.description.length > 20), market.filter((p) => p.id >= 'PROD-0006' && !(p.name !== p.ticker && p.description)).map((p) => p.id).join(','));
    check('the fixed-income and commodity ETFs derived Stocks & ETFs too — the engine has no bond/commodity class, and the class is derived from the provider, never typed', ['AGG', 'TLT', 'LQD', 'GLD', 'SLV', 'DBC'].every((t) => { const p = market.find((m) => m.ticker === t); return p && p.asset_class === 'Stocks & ETFs'; }));
    check('each ticker maps to exactly ONE product (the unique index)', new Set(market.map((p) => p.ticker)).size === market.length);
    const cacheRows = (await admin.from('market_data_cache').select('symbol, value, last_updated').in('symbol', market.map((p) => p.ticker))).data || [];
    check('every market product\'s symbol has a cache row with a positive value', market.every((p) => { const c = cacheRows.find((r) => r.symbol === p.ticker); return c && Number(c.value) > 0; }), market.filter((p) => !cacheRows.find((r) => r.symbol === p.ticker)).map((p) => p.ticker).join(','));

    // ===================================================================================
    console.log('\nB. a newly created product prices immediately (no refresh run)');
    // ===================================================================================
    const before = Date.now();
    const created = await callFunction(url, pmToken, 'add-product', { pricingModel: 'market', source: 'finnhub', symbol: 'VXUS', name: 'Vanguard Total International Stock ETF', investmentType: 'ETF', riskTier: 'balanced', minimumInvestment: 1000, description: 'Tracks the FTSE Global All Cap ex US index: stocks outside the United States, developed and emerging.' });
    check('add-product created VXUS through the real path', created.status === 200 && created.body && created.body.id, JSON.stringify(created.body));
    if (created.status === 200) {
      cleanup.productIds.push(created.body.id); cleanup.cacheSymbols.push('VXUS');
      const row = (await admin.from('products').select('unit_price, price_as_of, price_status, asset_class').eq('id', created.body.id).single()).data;
      check('★ the product row carries a live price immediately, not $0 and not awaiting a refresh', Number(row.unit_price) > 0 && row.price_as_of && (Date.now() - new Date(row.price_as_of).getTime()) < 30000 && row.price_status === 'ok', JSON.stringify(row));
      const cache = (await admin.from('market_data_cache').select('value, last_updated').eq('symbol', 'VXUS').maybeSingle()).data;
      check('★ the cache row was written from the SAME quote, at the same moment — no second provider call, no waiting for its turn', cache && Number(cache.value) === Number(row.unit_price) && new Date(cache.last_updated).getTime() >= before - 1000, JSON.stringify(cache));
      check('asset class derived from the provider (Stocks & ETFs)', row.asset_class === 'Stocks & ETFs');
    }
    const zero = await callFunction(url, pmToken, 'add-product', { pricingModel: 'market', source: 'finnhub', symbol: 'ZZQQX' + suffix.slice(0, 2).toUpperCase(), name: 'Nope', investmentType: 'ETF', riskTier: 'balanced', minimumInvestment: 1000 });
    check('a symbol Finnhub answers with a zero is refused at creation (never a permanently quote_failed product)', zero.status === 400 && /no price/.test(zero.body.error), JSON.stringify(zero.body));

    // ===================================================================================
    console.log('\nC. rotation genuinely cycles — union pushed past one run\'s capacity');
    // ===================================================================================
    // A test client watching enough real symbols to exceed N stocks in the union.
    const { data: cu } = await admin.auth.admin.createUser({ email: 'rr-' + suffix + '@test.marketswave.local', password: 'RoundRobin-2026!', email_confirm: true });
    cleanup.clientId = cu.user.id;
    await admin.from('clients').insert({ id: cu.user.id, name: 'Round Robin Client', email: 'rr-' + cu.user.id, phone: '+1', account_type: 'Individual Account', status: 'active', watchlist_seeded_at: new Date().toISOString() });
    const { data: cs } = await anon.auth.signInWithPassword({ email: 'rr-' + suffix + '@test.marketswave.local', password: 'RoundRobin-2026!' });
    const clientToken = cs.session.access_token;
    const extra = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'JNJ', 'WMT', 'PG', 'XOM', 'KO', 'PEP'];
    let added = 0;
    for (const sym of extra) {
      const r = await callFunction(url, clientToken, 'add-watchlist-symbol', { symbol: sym, source: 'finnhub', name: sym });
      if (r.status === 200) { added++; cleanup.cacheSymbols.push(sym); }
      else console.log('    (could not add ' + sym + ': ' + JSON.stringify(r.body) + ')');
      await sleep(1500);
    }
    check('the test client added enough real symbols to push the union past one run (' + added + ' added)', added >= 10, String(added));
    // Let the minute window pass so the first measured run has its own full budget.
    console.log('    (waiting one rate-limit window before the measured runs)');
    await sleep(MINUTE_WINDOW_MS);

    // Discover the union's stock set from a first run's own report.
    const probe = await callFunction(url, pmToken, 'refresh-market-data');
    check('the refresh reports N per run = 30, derived from the measured 60/min limit at a 50% share', probe.body.stockSymbolsPerRun === N, JSON.stringify(probe.body));
    const S = probe.body.distinctStockSymbols;
    const cycles = Math.ceil(S / N);
    check('the union now exceeds one run (' + S + ' distinct stock symbols > ' + N + ')', S > N, String(S));
    check('the report derives ' + cycles + ' cycles to cover them and a worst-case staleness of ' + (cycles * INTERVAL_MIN) + ' min', probe.body.cyclesToCoverAllStocks === cycles && probe.body.worstCaseStalenessMinutes === cycles * INTERVAL_MIN, JSON.stringify({ c: probe.body.cyclesToCoverAllStocks, w: probe.body.worstCaseStalenessMinutes }));
    check('headroom = symbols addable before the worst case grows by a cycle', probe.body.headroom === cycles * N - S, String(probe.body.headroom));
    check('a run past capacity refreshed exactly N and skipped the rest', probe.body.stockSymbolsSelected === N && probe.body.stockSymbolsSkippedThisRun === S - N, JSON.stringify({ sel: probe.body.stockSymbolsSelected, skip: probe.body.stockSymbolsSkippedThisRun }));

    // The stock symbols in the union = every stock cache row the run can see. Read them
    // from the function's own selection rather than re-deriving: base + watchlist + products.
    const unionStocks = new Set();
    for (const s of ['SPY', 'QQQ', 'DIA']) unionStocks.add(s);
    (await admin.from('watchlist_symbols').select('symbol, asset_type')).data.filter((r) => r.asset_type === 'stock').forEach((r) => unionStocks.add(r.symbol));
    (await admin.from('products').select('ticker, price_source').eq('pricing_model', 'market')).data.filter((r) => r.price_source === 'finnhub').forEach((r) => unionStocks.add(r.ticker));
    check('the union derived here matches the function\'s own count', unionStocks.size === S, unionStocks.size + ' vs ' + S);
    const symbols = Array.from(unionStocks);

    // Stagger every stock row to a distinct, LARGE age (10, 20, 30 ... minutes) so the
    // ordering is fully determined and the first run's leftover is genuinely old, then
    // simulate cycles: after each run, push every row 15 minutes into the past. The
    // function's report is computed against real time, so the oldest age it reports after
    // run k is exactly what a real deployment would report k cycles in — it should START
    // high (the staggered leftover) and SETTLE at (cycles - 1) x 15 minutes, never climb.
    const t0 = Date.now();
    for (let i = 0; i < symbols.length; i++) {
      await admin.from('market_data_cache').update({ last_updated: new Date(t0 - (i + 1) * 10 * 60000).toISOString() }).eq('symbol', symbols[i]);
    }
    const refreshedCount = {}; symbols.forEach((s) => { refreshedCount[s] = 0; });
    const runs = [];
    let prevSelected = null;
    const totalRuns = cycles * 3;
    for (let k = 1; k <= totalRuns; k++) {
      await sleep(MINUTE_WINDOW_MS);
      const beforeTs = {};
      ((await admin.from('market_data_cache').select('symbol, last_updated').in('symbol', symbols)).data || []).forEach((r) => { beforeTs[r.symbol] = r.last_updated; });
      const r = await callFunction(url, pmToken, 'refresh-market-data');
      const afterTs = {};
      ((await admin.from('market_data_cache').select('symbol, last_updated').in('symbol', symbols)).data || []).forEach((r2) => { afterTs[r2.symbol] = r2.last_updated; });
      const selected = symbols.filter((s) => afterTs[s] !== beforeTs[s]);
      selected.forEach((s) => { refreshedCount[s]++; });
      const sameAsPrev = prevSelected && selected.length === prevSelected.length && selected.every((s) => prevSelected.indexOf(s) !== -1);
      runs.push({ k, status: r.status, refreshed: r.body.stockSymbolsRefreshed, oldest: r.body.oldestStockAfterRun, selected, sameAsPrev, halted: r.body.haltedForRateLimit });
      console.log('    run ' + k + ': refreshed ' + r.body.stockSymbolsRefreshed + '/' + S + ', oldest after run = ' + r.body.oldestStockAfterRun.symbol + ' @ ' + r.body.oldestStockAfterRun.ageMinutes + ' min' + (r.body.haltedForRateLimit ? '  [halted]' : ''));
      prevSelected = selected;
      // A cycle passes: every row ages by one interval.
      for (const s of symbols) {
        const cur = afterTs[s];
        await admin.from('market_data_cache').update({ last_updated: new Date(new Date(cur).getTime() - INTERVAL_MIN * 60000).toISOString() }).eq('symbol', s);
      }
    }
    check('every run completed with its full budget (no rate-limit halt inside the measured runs)', runs.every((r) => r.status === 200 && !r.halted), JSON.stringify(runs.map((r) => [r.status, r.halted])));
    check('every run refreshed exactly N stocks', runs.every((r) => r.refreshed === N && r.selected.length === N), JSON.stringify(runs.map((r) => r.refreshed)));
    check('★ never the same subset twice in a row — the rotation moves', runs.slice(1).every((r) => !r.sameAsPrev));
    // No starvation: in EVERY window of `cycles` consecutive runs (one full rotation),
    // every symbol is refreshed at least once — the property a "same subset every time"
    // bug would break. Over 3 full rotations that is at least 3 refreshes per symbol.
    let starved = [];
    for (let start = 0; start + cycles <= runs.length; start++) {
      const seen = new Set(); for (let j = start; j < start + cycles; j++) runs[j].selected.forEach((sym) => seen.add(sym));
      symbols.filter((sym) => !seen.has(sym)).forEach((sym) => starved.push('run' + (start + 1) + ':' + sym));
    }
    check('★ every one of the ' + S + ' symbols is refreshed in EVERY full rotation (' + cycles + ' consecutive runs) — none starved', starved.length === 0, starved.slice(0, 10).join(','));
    check('...at least ' + (totalRuns / cycles) + ' refreshes per symbol over ' + totalRuns + ' runs', symbols.every((sym) => refreshedCount[sym] >= totalRuns / cycles), JSON.stringify(Object.entries(refreshedCount).filter(([, c]) => c < totalRuns / cycles)));
    const ages = runs.map((r) => r.oldest.ageMinutes);
    const steady = ages.slice(cycles);
    // The reported age is (cycles - 1) x 15 min of simulated ageing PLUS the real seconds
    // that elapsed since the previous run stamped the row — the inter-run wait and the run
    // itself — so the allowance is that real interval, not a rounding margin.
    const realGapMin = MINUTE_WINDOW_MS / 60000 + 0.5;
    check('★ the reported oldest-symbol age STABILISES at the theoretical worst case (' + ((cycles - 1) * INTERVAL_MIN) + ' min after a run, plus the real inter-run gap) rather than growing without bound', steady.every((a) => a <= (cycles - 1) * INTERVAL_MIN + realGapMin) && steady[steady.length - 1] <= steady[0] + 0.5, JSON.stringify(ages));
    check('...and the FIRST run\'s reported oldest age is the larger, staggered figure (the metric is real, not a constant)', ages[0] > (cycles - 1) * INTERVAL_MIN + 1, JSON.stringify(ages));

    // ===================================================================================
    console.log('\nD. the rate-limit halt: a second run inside the same minute stops short, loses nothing');
    // ===================================================================================
    await sleep(MINUTE_WINDOW_MS);
    const first = await callFunction(url, pmToken, 'refresh-market-data');
    const second = await callFunction(url, pmToken, 'refresh-market-data');
    check('the first run in a fresh window spent its full budget', first.body.stockSymbolsRefreshed === N && !first.body.haltedForRateLimit, JSON.stringify({ r: first.body.stockSymbolsRefreshed, h: first.body.haltedForRateLimit, low: first.body.lowestRateLimitRemainingSeen }));
    check('★ the second run, inside the same minute, halted once the remaining budget was inside the interactive reserve', second.body.haltedForRateLimit === true && second.body.stockSymbolsAttempted < N, JSON.stringify({ attempted: second.body.stockSymbolsAttempted, low: second.body.lowestRateLimitRemainingSeen }));
    check('...it recorded NO failures for the symbols it did not reach (deferred, not failed)', (second.body.failed || []).length === 0, JSON.stringify(second.body.failed));
    check('...and no product was flagged quote_failed by the halt', (second.body.productsFlagged || []).length === 0, JSON.stringify(second.body.productsFlagged));

    // ===================================================================================
    console.log('\nE. the client catalog renders every seeded product with its price');
    // ===================================================================================
    globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
    await import('../supabase-data.js');
    const MarketswaveData = globalThis.window.MarketswaveData;
    const pageClient = await MarketswaveData.getSupabaseClient();
    const { error: cErr } = await pageClient.auth.signInWithPassword({ email: 'rr-' + suffix + '@test.marketswave.local', password: 'RoundRobin-2026!' });
    check('client sign-in on the page own data client', !cErr, cErr && cErr.message);
    const root = new URL('../', import.meta.url);
    const acPath = fileURLToPath(new URL('asset-collection.html', root));
    const dom = buildPageDom(acPath);
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.getAuthenticatedClientId = () => cu.user.id;
    dom.window.eval(readFileSync(fileURLToPath(new URL('engine-core.js', root)), 'utf8'));
    dom.window.eval(extractInlineScript(acPath, 'UI Wiring — Stage 2'));
    const D = dom.window.document;
    await pollUntil(() => D.querySelectorAll('[data-product-id]').length > 0 && !/animate-pulse/.test(D.getElementById('asset-cards-grid').innerHTML), 30000);
    const loadMore = D.getElementById('load-more-btn');
    for (let i = 0; i < 10 && !loadMore.classList.contains('hidden'); i++) { loadMore.click(); await sleep(100); }
    const expected = (await admin.from('products').select('id').neq('asset_class', 'Unallocated / Cash')).data.length;
    const cards = [...D.querySelectorAll('[data-product-id]')];
    check('every non-cash product renders as a card after Load More (' + cards.length + ' of ' + expected + ')', cards.length === expected, cards.length + ' vs ' + expected);
    const marketCards = cards.filter((c) => c.querySelector('.product-ticker'));
    check('every market product card shows its ticker chip and a per-unit price, none $0.00', marketCards.length >= 20 && marketCards.every((c) => /per unit/.test(c.textContent) && !/\$0\.00/.test(c.textContent)), marketCards.filter((c) => /\$0\.00/.test(c.textContent)).map((c) => c.dataset.productId).join(','));
    check('every market card carries a live or honestly-stale market-price source line (never appraisal)', marketCards.every((c) => { const s = c.querySelector('.price-source'); return s && (s.dataset.source === 'live' || s.dataset.source === 'stale'); }));
    const spyCard = cards.find((c) => c.querySelector('.product-ticker') && c.querySelector('.product-ticker').textContent === 'SPY');
    check('the SPY card shows its real fund name and what it holds', !!spyCard && /SPDR S&P 500 ETF Trust/.test(spyCard.textContent), spyCard && spyCard.textContent.slice(0, 120));
    const finalReport = await callFunction(url, pmToken, 'refresh-market-data');
    console.log('\n    FINAL: ' + finalReport.body.distinctStockSymbols + ' distinct stock symbols (' + finalReport.body.distinctCryptoSymbols + ' crypto), ' + finalReport.body.cyclesToCoverAllStocks + ' cycle(s), worst case ' + finalReport.body.worstCaseStalenessMinutes + ' min, headroom ' + finalReport.body.headroom + ' before the next cycle (includes this suite\'s ' + added + ' temporary watchlist symbols)');
  } finally {
    try { setSchedulerActive(true); console.log('(local pg_cron jobs restored)'); } catch (e) { console.error('CLEANUP: could not restore the pg_cron jobs: ' + e.message); }
    if (cleanup.clientId) {
      await admin.from('price_alerts').delete().eq('client_id', cleanup.clientId);
      await admin.from('watchlist_symbols').delete().eq('client_id', cleanup.clientId);
      await admin.from('clients').delete().eq('id', cleanup.clientId);
      const { error } = await admin.auth.admin.deleteUser(cleanup.clientId);
      if (error) console.error('CLEANUP: could not delete test client: ' + error.message);
    }
    if (cleanup.productIds.length) {
      const { error } = await admin.from('products').delete().in('id', cleanup.productIds);
      if (error) console.error('CLEANUP: could not delete test product: ' + error.message);
    }
    if (cleanup.cacheSymbols.length) await admin.from('market_data_cache').delete().in('symbol', cleanup.cacheSymbols);
    // Put the real cache timestamps back (Part C staggered and aged them).
    for (const r of cacheBefore) await admin.from('market_data_cache').update({ last_updated: r.last_updated }).eq('symbol', r.symbol);
    const residue = (await admin.from('watchlist_symbols').select('id', { count: 'exact', head: true }).eq('client_id', cleanup.clientId || '00000000-0000-0000-0000-000000000000')).count;
    if (residue) console.error('CLEANUP: ' + residue + ' watchlist rows left behind');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed) { console.log('ROUND-ROBIN REFRESH: FAIL'); process.exit(1); }
  console.log('ROUND-ROBIN REFRESH: PASS');
}

runVerifyMain(main, { watchdogMs: 1500000 });
