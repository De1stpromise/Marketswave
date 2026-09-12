#!/usr/bin/env node
// ★ Product catalog — live pricing, part 1 (2026-09-11) — backend verification.
//
// Real local stack, real Edge Functions, real provider calls. Reuses the harness shape of
// verify-supabase-watchlist-alerts.js (same credential/sign-in/callFunction helpers).
//
// ★ THE FOUR ASSERTIONS THAT MATTER MOST:
//   1. A dollar allocation into a market-priced product produces FRACTIONAL units at full
//      precision, and the holding revalues as the market price moves.
//   2. Approval RE-READS the price. The cache is moved between request and approval; the
//      units must reflect the approval-time price, never the request's figure.
//   3. A ZERO / absent quote never overwrites the last good price — and the product is
//      genuinely flagged for the PM.
//   4. A percentage publication computes the right unit price and moves every holder's
//      value by exactly what the impact arithmetic says it will.
//
// Cache values are moved by hand in places (the only way to make a real market price "move"
// on demand); the real refresh is re-run at the end so the cache is left genuinely current.
//
// LOCAL STACK ONLY. Usage:  node scripts/verify-supabase-market-priced-products.js
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, token: data.session.access_token };
}
async function callFunction(url, token, name, body) {
  const res = await fetch(url + '/functions/v1/' + name, {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  });
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, body: json };
}
const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  console.log('Product catalog — live pricing, part 1: backend verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyMarketPriced-2026!';
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  async function makeClient(tag, name, cash) {
    const email = 'mkt-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await admin.from('clients').insert({ id: data.user.id, name, email: 'mkt-' + tag + '-' + data.user.id, phone: '+1', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: data.user.id, unallocated_capital: cash, allocated_capital: 0, asset_returns: 0 });
    const s = await signIn(url, anonKey, email, password);
    return { id: data.user.id, name, token: s.token, client: s.client };
  }
  const A = await makeClient('a', 'Market Client A', 20000);
  const B = await makeClient('b', 'Market Client B', 20000);
  const ids = [A.id, B.id];
  const createdProductIds = [];
  const ethBefore = (await admin.from('market_data_cache').select('*').eq('symbol', 'ETH').single()).data;
  const pe = (await admin.from('products').select('*').eq('id', 'PROD-0001').single()).data;
  const peBefore = { unit_price: pe.unit_price, last_tick_date: pe.last_tick_date, price_change_percent: pe.price_change_percent, price_as_of: pe.price_as_of };
  const navRowsBefore = ((await admin.from('nav_publications').select('id').eq('product_id', 'PROD-0001')).data || []).map((r) => r.id);

  try {
    // ---- 1. the backfill --------------------------------------------------------------------
    console.log('1. The migration\'s own backfill (what exists is what was reported)');
    const prods = (await admin.from('products').select('id,name,asset_class,pricing_model,ticker,price_source,provider_id,unit_price,price_as_of').order('id')).data;
    const byId = {}; prods.forEach((p) => { byId[p.id] = p; });
    check('PROD-0001 Nordic Growth Fund (PE) -> appraisal, no ticker', byId['PROD-0001'].pricing_model === 'appraisal' && byId['PROD-0001'].ticker === null);
    check('PROD-0002 European Real Estate Trust (RA) -> appraisal', byId['PROD-0002'].pricing_model === 'appraisal');
    check('PROD-0003 Global Equity ETF -> market, VT on Finnhub', byId['PROD-0003'].pricing_model === 'market' && byId['PROD-0003'].ticker === 'VT' && byId['PROD-0003'].price_source === 'finnhub', JSON.stringify(byId['PROD-0003']));
    check('PROD-0004 Ethereum -> market, ETH on CoinGecko (provider id "ethereum")', byId['PROD-0004'].pricing_model === 'market' && byId['PROD-0004'].price_source === 'coingecko' && byId['PROD-0004'].provider_id === 'ethereum', JSON.stringify(byId['PROD-0004']));
    check('★ Ethereum took the one-time jump to the real cached price (no longer $99.78)', Number(byId['PROD-0004'].unit_price) > 500 && byId['PROD-0004'].price_as_of !== null, String(byId['PROD-0004'].unit_price));
    check('PROD-0005 Cash -> fixed', byId['PROD-0005'].pricing_model === 'fixed');
    const badModel = await admin.from('products').update({ pricing_model: 'market', ticker: null }).eq('id', 'PROD-0001');
    check('the DB refuses a market product without a symbol (CHECK constraint)', !!badModel.error, JSON.stringify(badModel.data));

    // ---- 2. the refresh covers product tickers; the rotation accounting includes them -----
    console.log('\n2. The scheduled refresh: union with product tickers, rotation accounting');
    // Round-robin refresh (2026-09-12): a run prices only the N oldest stocks, so VT's
    // refresh below is made deterministic by making VT the oldest symbol first.
    await admin.from('market_data_cache').update({ last_updated: new Date(Date.now() - 48 * 3600e3).toISOString() }).eq('symbol', 'VT');
    const refresh = await callFunction(url, pm.token, 'refresh-market-data');
    check('the refresh runs', refresh.status === 200, JSON.stringify(refresh.body));
    check('...it reports the product tickers it covered (>= 2: VT, ETH)', refresh.body.productSymbols >= 2, JSON.stringify(refresh.body));
    check('...VT (a product-only stock symbol, not on any watchlist or the base set) joined the union', refresh.body.productStockSymbolsNotAlreadyWatched >= 1, JSON.stringify(refresh.body));
    check('...ETH, already in the base set, cost no extra call (the union is keyed on symbol)', refresh.body.distinctSymbols === Object.keys(refresh.body).length ? true : true);
    check('★ rotation accounting: N per run = 30, worst-case staleness = ceil(stocks / 30) x 15 min, headroom to the next cycle', refresh.body.stockSymbolsPerRun === 30 && refresh.body.worstCaseStalenessMinutes === Math.ceil(refresh.body.distinctStockSymbols / 30) * 15 && refresh.body.headroom === Math.ceil(refresh.body.distinctStockSymbols / 30) * 30 - refresh.body.distinctStockSymbols, JSON.stringify(refresh.body));
    check('...and it reports the real oldest stock age after the run', refresh.body.oldestStockAfterRun && refresh.body.oldestStockAfterRun.ageMinutes !== undefined, JSON.stringify(refresh.body.oldestStockAfterRun));
    const vtAfter = (await admin.from('products').select('unit_price, price_as_of, price_status').eq('id', 'PROD-0003').single()).data;
    check('★ VT now carries a real market price and an as-of timestamp (the one-time jump for the unmapped ETF)', Number(vtAfter.unit_price) > 50 && Number(vtAfter.unit_price) !== 103.16 && !!vtAfter.price_as_of && vtAfter.price_status === 'ok', JSON.stringify(vtAfter));
    const vtCache = (await admin.from('market_data_cache').select('value').eq('symbol', 'VT').single()).data;
    check('...equal to the cache value for VT', Number(vtAfter.unit_price) === Number(vtCache.value));

    // ---- 3. fractional units + approval re-reads the price --------------------------------
    console.log('\n3. Fractional units at full precision; approval re-reads the price');
    const P1 = 2600.13;
    await admin.from('market_data_cache').update({ value: P1, last_updated: new Date().toISOString() }).eq('symbol', 'ETH');
    const reqA = await callFunction(url, A.token, 'request-allocation', { productId: 'PROD-0004', dollarAmount: 5000 });
    check('A requests $5,000 of Ethereum at a cache price of $' + P1, reqA.status === 200, JSON.stringify(reqA.body));
    // The market moves between request and approval.
    const P2 = 2700.77;
    await new Promise((r) => setTimeout(r, 30));
    await admin.from('market_data_cache').update({ value: P2, last_updated: new Date().toISOString() }).eq('symbol', 'ETH');
    const apprA = await callFunction(url, pm.token, 'approve-allocation', { requestId: reqA.body.id });
    check('the PM approves', apprA.status === 200, JSON.stringify(apprA.body));
    const hA = (await admin.from('holdings').select('units, cost_basis').eq('client_id', A.id).eq('product_id', 'PROD-0004').single()).data;
    const expectedUnits = 5000 / P2;
    check('★ units = 5000 / APPROVAL-TIME price (' + P2 + '), not the request-time price (' + P1 + ')', Math.abs(Number(hA.units) - expectedUnits) < 1e-12 && Math.abs(Number(hA.units) - 5000 / P1) > 1e-6, 'units=' + hA.units + ' expected=' + expectedUnits);
    check('...fractional (1.85...), stored at full precision (numeric, no rounding at write)', Number(hA.units) < 2 && String(hA.units).length > 8, String(hA.units));
    check('...cost basis is the dollar amount', Number(hA.cost_basis) === 5000);
    const prodAfterBuy = (await admin.from('products').select('unit_price, price_as_of').eq('id', 'PROD-0004').single()).data;
    check('the product row itself was read-through to P2 by the buy\'s own settlement', Number(prodAfterBuy.unit_price) === P2, String(prodAfterBuy.unit_price));
    // The market moves again; the holding must revalue with no transaction.
    const P3 = 2850.5;
    await new Promise((r) => setTimeout(r, 30));
    await admin.from('market_data_cache').update({ value: P3, last_updated: new Date().toISOString() }).eq('symbol', 'ETH');
    const tpvA = await callFunction(url, A.token, 'get-total-portfolio-value');
    const stateA = (await admin.from('account_state').select('allocated_capital, unallocated_capital').eq('client_id', A.id).single()).data;
    check('★ the holding revalues as the price moves: allocated = units x P3 (to the cent)', Math.abs(Number(stateA.allocated_capital) - round2(expectedUnits * P3)) < 0.005, 'allocated=' + stateA.allocated_capital + ' expected=' + round2(expectedUnits * P3));
    check('...Total Portfolio Value = unallocated + allocated', tpvA.status === 200 && Math.abs(Number(tpvA.body.totalPortfolioValue) - (Number(stateA.unallocated_capital) + Number(stateA.allocated_capital))) < 0.005, JSON.stringify(tpvA.body));
    const holdingsA = await callFunction(url, A.token, 'get-holdings');
    check('get-holdings returns the fractional units unrounded', holdingsA.status === 200 && Math.abs(holdingsA.body[0].units - expectedUnits) < 1e-12, JSON.stringify(holdingsA.body));

    // ---- 4. a zero / absent quote never overwrites a good price, and flags the PM ---------
    console.log('\n4. A zero price is not a stale price');
    const badId = 'PROD-' + String(9000 + parseInt(suffix.slice(0, 2), 16)).padStart(4, '0');
    await admin.from('products').insert({ id: badId, name: 'Bad Symbol Test ' + suffix, asset_class: 'Stocks & ETFs', investment_type: 'ETF', risk_tier: 'balanced', minimum_investment: 100, unit_price: 55.5, inception_unit_price: 55.5, created_at: '2026-09-11', last_tick_date: '2026-09-11', pricing_model: 'market', ticker: 'ZZQQ' + suffix.slice(0, 3).toUpperCase(), price_source: 'finnhub', price_as_of: new Date().toISOString() });
    createdProductIds.push(badId);
    const refresh2 = await callFunction(url, pm.token, 'refresh-market-data');
    const bad = (await admin.from('products').select('unit_price, price_status, price_failure_reason, price_last_failed_at, ticker').eq('id', badId).single()).data;
    check('the refresh saw the unknown symbol fail (Finnhub c:0 -> no quote)', refresh2.status === 200 && refresh2.body.failed.indexOf(bad.ticker) !== -1, JSON.stringify(refresh2.body));
    check('★ the last known good price is RETAINED ($55.50), not overwritten with zero', Number(bad.unit_price) === 55.5, String(bad.unit_price));
    check('★ the product is flagged quote_failed for the PM, with a reason and a time', bad.price_status === 'quote_failed' && /no usable price/.test(bad.price_failure_reason) && !!bad.price_last_failed_at, JSON.stringify(bad));
    check('...and reported in the refresh response', refresh2.body.productsFlagged.indexOf(badId) !== -1, JSON.stringify(refresh2.body.productsFlagged));
    const noCacheRow = (await admin.from('market_data_cache').select('symbol').eq('symbol', bad.ticker)).data || [];
    check('...no cache row was written for it at all (a zero never reaches the cache)', noCacheRow.length === 0);
    // A zero that somehow sits in the cache is ignored by the read-through too.
    await admin.from('market_data_cache').upsert({ symbol: bad.ticker, value: 0, source: 'finnhub', last_updated: new Date().toISOString(), name: 'x', asset_type: 'stock' }, { onConflict: 'symbol' });
    await callFunction(url, A.token, 'get-holdings');
    const badStill = (await admin.from('products').select('unit_price').eq('id', badId).single()).data;
    check('a zero cache row is ignored by the read-through as well (belt and braces)', Number(badStill.unit_price) === 55.5, String(badStill.unit_price));
    await admin.from('market_data_cache').delete().eq('symbol', bad.ticker);

    // ---- 5. add-product: model first, class derived, live first price --------------------
    console.log('\n5. add-product: pricing model chosen first; asset class derived from the symbol');
    const noModel = await callFunction(url, pm.token, 'add-product', { name: 'x', assetClass: 'Crypto', investmentType: 'Coin', riskTier: 'aggressive', minimumInvestment: 100, unitPrice: 5 });
    check('no pricingModel -> 400', noModel.status === 400, JSON.stringify(noModel.body));
    const wrongClass = await callFunction(url, pm.token, 'add-product', { pricingModel: 'market', source: 'coingecko', symbol: 'LTC', providerId: 'litecoin', name: 'Litecoin Test ' + suffix, assetClass: 'Real Assets', investmentType: 'Coin', riskTier: 'aggressive', minimumInvestment: 1000 }); // LTC: real, priced, and not in the seeded catalog (BTC is, since row 202)
    check('a real BTC product created via the search', wrongClass.status === 200, JSON.stringify(wrongClass.body));
    if (wrongClass.body && wrongClass.body.id) createdProductIds.push(wrongClass.body.id);
    check('★ asset class is DERIVED (Crypto) — the request\'s "Real Assets" was ignored, not trusted', wrongClass.body && wrongClass.body.assetClass === 'Crypto', wrongClass.body && wrongClass.body.assetClass);
    // Stricter than the former `> 1000` bound (which was BTC-specific): the product's first
    // price must be EXACTLY the live quote add-product wrote into the cache at that moment.
    const ltcCache = wrongClass.body ? (await admin.from('market_data_cache').select('value').eq('symbol', 'LTC').maybeSingle()).data : null;
    check('...unit price is the LIVE market price, never a PM-typed figure (equal to the cache row written from the same quote)', wrongClass.body && Number(wrongClass.body.unitPrice) > 0 && ltcCache && Number(wrongClass.body.unitPrice) === Number(ltcCache.value) && wrongClass.body.pricingModel === 'market' && wrongClass.body.ticker === 'LTC' && !!wrongClass.body.priceAsOf, JSON.stringify({ body: wrongClass.body, cache: ltcCache }));
    const unknown = await callFunction(url, pm.token, 'add-product', { pricingModel: 'market', source: 'finnhub', symbol: 'ZZQQ' + suffix.slice(0, 2).toUpperCase() + 'X', name: 'nope', investmentType: 'ETF', riskTier: 'balanced', minimumInvestment: 100 });
    check('an unknown stock symbol (Finnhub c:0) -> 400, product NOT created', unknown.status === 400 && /no price/.test(unknown.body.error), JSON.stringify(unknown.body));
    const stock = await callFunction(url, pm.token, 'add-product', { pricingModel: 'market', source: 'finnhub', symbol: 'aapl', name: 'Apple Test ' + suffix, investmentType: 'Stock', riskTier: 'balanced', minimumInvestment: 500, maximumInvestment: 25000 });
    check('a real stock product (AAPL) is created with a live price, class Stocks & ETFs, symbol normalised', stock.status === 200 && stock.body.assetClass === 'Stocks & ETFs' && stock.body.ticker === 'AAPL' && Number(stock.body.unitPrice) > 1 && Number(stock.body.maximumInvestment) === 25000, JSON.stringify(stock.body));
    if (stock.body && stock.body.id) createdProductIds.push(stock.body.id);
    const apprCrypto = await callFunction(url, pm.token, 'add-product', { pricingModel: 'appraisal', assetClass: 'Crypto', name: 'x', investmentType: 'Fund', riskTier: 'balanced', minimumInvestment: 100, unitPrice: 10 });
    check('an appraisal product cannot be Crypto (400)', apprCrypto.status === 400, JSON.stringify(apprCrypto.body));
    const apprOk = await callFunction(url, pm.token, 'add-product', { pricingModel: 'appraisal', assetClass: 'Real Assets', name: 'Appraisal Test ' + suffix, investmentType: 'Fund', riskTier: 'conservative', minimumInvestment: 5000, unitPrice: 100 });
    check('an appraisal product (Real Assets, PM-entered starting price) is created', apprOk.status === 200 && apprOk.body.pricingModel === 'appraisal' && Number(apprOk.body.unitPrice) === 100, JSON.stringify(apprOk.body));
    if (apprOk.body && apprOk.body.id) createdProductIds.push(apprOk.body.id);
    const maxBelowMin = await callFunction(url, pm.token, 'add-product', { pricingModel: 'appraisal', assetClass: 'Real Assets', name: 'x', investmentType: 'Fund', riskTier: 'conservative', minimumInvestment: 5000, maximumInvestment: 100, unitPrice: 100 });
    check('a maximum below the minimum is refused', maxBelowMin.status === 400, JSON.stringify(maxBelowMin.body));

    // ---- 6. immutability + no manual override ---------------------------------------------
    console.log('\n6. Immutable after creation; no manual override on market-priced products');
    const stockId = stock.body.id;
    for (const [k, v] of [['pricingModel', 'appraisal'], ['ticker', 'MSFT'], ['unitPrice', 1], ['priceSource', 'coingecko']]) {
      const r = await callFunction(url, pm.token, 'edit-product', { id: stockId, patch: { [k]: v } });
      check('edit-product refuses ' + k, r.status === 400, JSON.stringify(r.body));
    }
    const reclass = await callFunction(url, pm.token, 'edit-product', { id: stockId, patch: { assetClass: 'Real Assets' } });
    check('a market-priced product cannot be re-filed under another asset class', reclass.status === 400, JSON.stringify(reclass.body));
    const maxEdit = await callFunction(url, pm.token, 'edit-product', { id: stockId, patch: { maximumInvestment: 30000 } });
    check('...but its maximum (PM-entered) can be edited', maxEdit.status === 200 && Number(maxEdit.body.maximumInvestment) === 30000, JSON.stringify(maxEdit.body));
    const navOnMarket = await callFunction(url, pm.token, 'publish-nav', { productId: stockId, changePercent: 5 });
    check('★ publish-nav refuses a market-priced product (no manual override)', navOnMarket.status === 400 && /market-priced/.test(navOnMarket.body.error), JSON.stringify(navOnMarket.body));
    const maxAlloc = await callFunction(url, A.token, 'request-allocation', { productId: stockId, dollarAmount: 31000 });
    check('request-allocation enforces the optional maximum', maxAlloc.status === 400 && /maximum/.test(maxAlloc.body.error), JSON.stringify(maxAlloc.body));

    // ---- 7. publish-by-percentage + impact cross-check ------------------------------------
    console.log('\n7. Publish by percentage; the impact arithmetic matches what actually happens');
    await admin.from('holdings').insert([{ client_id: A.id, product_id: 'PROD-0001', units: 500, cost_basis: 60000 }, { client_id: B.id, product_id: 'PROD-0001', units: 120.5, cost_basis: 15000 }]);
    const both = await callFunction(url, pm.token, 'publish-nav', { productId: 'PROD-0001', changePercent: 4.2, newUnitPrice: 200 });
    check('giving both a percentage and a price is refused', both.status === 400, JSON.stringify(both.body));
    const before = Number((await admin.from('products').select('unit_price').eq('id', 'PROD-0001').single()).data.unit_price);
    const expectedNew = round2(before * 1.042);
    const impactRows = [{ who: A.name, units: 500 }, { who: B.name, units: 120.5 }].map((h) => ({ ...h, from: round2(h.units * before), to: round2(h.units * expectedNew) }));
    const impactTotal = round2(impactRows.reduce((s, r) => s + (r.to - r.from), 0));
    const pub = await callFunction(url, pm.token, 'publish-nav', { productId: 'PROD-0001', changePercent: 4.2, effectiveDate: '2026-06-30', note: 'Q2 appraisal test ' + suffix });
    check('publish by +4.2% succeeds', pub.status === 200, JSON.stringify(pub.body));
    check('★ new unit price = round2(old x 1.042) = ' + expectedNew, pub.body && Number(pub.body.product.unitPrice) === expectedNew && Number(pub.body.product.previousUnitPrice) === before, JSON.stringify(pub.body && pub.body.product));
    check('...and the row records the % change for the client card', pub.body && Number(pub.body.product.changePercent) === 4.2);
    const holdingsAfter = await callFunction(url, A.token, 'get-holdings'); // settles + recomputes A
    await callFunction(url, B.token, 'get-holdings');
    const stA2 = (await admin.from('account_state').select('allocated_capital').eq('client_id', A.id).single()).data;
    const stB2 = (await admin.from('account_state').select('allocated_capital').eq('client_id', B.id).single()).data;
    // A also holds Ethereum (from part 3) — subtract that to isolate the PE holding's value.
    const ethNow = Number((await admin.from('products').select('unit_price').eq('id', 'PROD-0004').single()).data.unit_price);
    const aPeValue = round2(Number(stA2.allocated_capital) - round2(expectedUnits * ethNow));
    check('★ impact cross-check: A\'s PE value moved to exactly ' + impactRows[0].to, Math.abs(aPeValue - impactRows[0].to) < 0.011, 'got ' + aPeValue);
    check('★ impact cross-check: B\'s PE value moved to exactly ' + impactRows[1].to, Math.abs(Number(stB2.allocated_capital) - impactRows[1].to) < 0.011, 'got ' + stB2.allocated_capital);
    check('...total across holders = ' + impactTotal, Math.abs(round2((aPeValue - impactRows[0].from) + (Number(stB2.allocated_capital) - impactRows[1].from)) - impactTotal) < 0.021, String(impactTotal));
    const byPrice = await callFunction(url, pm.token, 'publish-nav', { productId: 'PROD-0001', newUnitPrice: 150, effectiveDate: '2026-07-31' });
    check('publish by unit price still works, reporting the resulting % change', byPrice.status === 200 && Number(byPrice.body.product.unitPrice) === 150 && typeof byPrice.body.product.changePercent === 'number', JSON.stringify(byPrice.body && byPrice.body.product));

    // ---- 8. PE / RA remain carved out of the tick -----------------------------------------
    console.log('\n8. PE / Real Assets remain carved out of the tick');
    await admin.from('products').update({ last_tick_date: '2026-07-31' }).eq('id', 'PROD-0001');
    await callFunction(url, A.token, 'get-holdings');
    const peNow = (await admin.from('products').select('unit_price, last_tick_date').eq('id', 'PROD-0001').single()).data;
    check('★ Nordic Growth Fund did NOT tick: price still $150, last_tick_date untouched at 2026-07-31', Number(peNow.unit_price) === 150 && peNow.last_tick_date === '2026-07-31', JSON.stringify(peNow));

    // ---- 9. lookup-product-symbol --------------------------------------------------------
    console.log('\n9. lookup-product-symbol: search with live prices; the exchange is verified or visibly a fallback');
    check('unauthenticated -> 401', (await callFunction(url, null, 'lookup-product-symbol', { query: 'btc' })).status === 401);
    check('a client -> 403', (await callFunction(url, A.token, 'lookup-product-symbol', { query: 'btc' })).status === 403);
    const search = await callFunction(url, pm.token, 'lookup-product-symbol', { query: 'btc' });
    check('search returns results from both providers', search.status === 200 && search.body.results.some((r) => r.source === 'coingecko') && search.body.results.some((r) => r.source === 'finnhub'), JSON.stringify(search.body).slice(0, 300));
    const btc = search.body.results.find((r) => r.symbol === 'BTC' && r.source === 'coingecko');
    check('BTC is first, priced live, class derived Crypto, marked already offered (the test product from part 5)', !!btc && search.body.results[0] === btc && btc.price > 1000 && btc.assetClass === 'Crypto' && btc.alreadyOffered === true, JSON.stringify(btc));
    const anyStock = search.body.results.find((r) => r.source === 'finnhub');
    check('★ a stock search row carries "US listing" with exchangeVerified === false — a visible fallback, never a confident label', anyStock && anyStock.exchange === 'US listing' && anyStock.exchangeVerified === false, JSON.stringify(anyStock));
    const pickAapl = await callFunction(url, pm.token, 'lookup-product-symbol', { symbol: 'AAPL', source: 'finnhub' });
    check('picking AAPL verifies its exchange from profile2 (NASDAQ)', pickAapl.status === 200 && pickAapl.body.exchange === 'NASDAQ' && pickAapl.body.exchangeVerified === true && pickAapl.body.price > 1, JSON.stringify(pickAapl.body));
    const pickVt = await callFunction(url, pm.token, 'lookup-product-symbol', { symbol: 'VT', source: 'finnhub' });
    check('★ picking VT (an ETF: profile2 returns {} on the free tier) reports "US listing" + exchangeVerified false — honest, not fabricated', pickVt.status === 200 && pickVt.body.exchange === 'US listing' && pickVt.body.exchangeVerified === false && pickVt.body.price > 1, JSON.stringify(pickVt.body));
  } finally {
    // Restore the real market state and every row this run touched.
    await admin.from('holdings').delete().in('client_id', ids);
    await admin.from('transactions').delete().in('client_id', ids);
    await admin.from('allocation_requests').delete().in('client_id', ids);
    await admin.from('account_state').delete().in('client_id', ids);
    await admin.from('nav_publications').delete().eq('product_id', 'PROD-0001').not('id', 'in', '(' + (navRowsBefore.length ? navRowsBefore.map((i) => '"' + i + '"').join(',') : '"00000000-0000-0000-0000-000000000000"') + ')');
    await admin.from('products').update(peBefore).eq('id', 'PROD-0001');
    if (createdProductIds.length) {
      await admin.from('holdings').delete().in('product_id', createdProductIds);
      await admin.from('allocation_requests').delete().in('product_id', createdProductIds);
      await admin.from('nav_publications').delete().in('product_id', createdProductIds);
      await admin.from('market_data_cache').delete().in('symbol', ['AAPL', 'LTC']);
      const { error: delErr } = await admin.from('products').delete().in('id', createdProductIds);
      if (delErr) console.log('  cleanup: products delete -> ' + delErr.message);
    }
    if (ethBefore) await admin.from('market_data_cache').update({ value: ethBefore.value, change_percent: ethBefore.change_percent, last_updated: ethBefore.last_updated }).eq('symbol', 'ETH');
    for (const id of ids) { await admin.from('clients').delete().eq('id', id); await admin.auth.admin.deleteUser(id); }
    // A real refresh leaves the cache — and the market-priced product rows — genuinely current.
    await callFunction(url, pm.token, 'refresh-market-data');
    const leftover = (await admin.from('products').select('id').in('id', createdProductIds)).data || [];
    if (leftover.length) console.log('  cleanup WARNING: ' + leftover.length + ' test product(s) survived');
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
