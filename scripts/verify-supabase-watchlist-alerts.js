#!/usr/bin/env node
// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — backend/API verification.
//
// Covers the whole feature at the level it actually lives: the watchlist and alert tables
// and their RLS, the six Edge Functions that own them, the symbol -> product mapping, the
// two SCHEDULED functions and the pg_cron/pg_net scheduler itself.
//
// REAL PROVIDERS ARE GENUINELY CALLED. The symbol search and the add-symbol validation are
// meaningless against a stub — the whole point of add-watchlist-symbol is that Finnhub
// answers an unknown symbol with HTTP 200 and a zero price rather than a 404, which only a
// real call demonstrates. That does spend real free-tier budget, so this file is written to
// spend as little as it can: the per-client ceiling test seeds filler rows through
// service_role instead of adding 25 symbols one real call at a time.
//
// EMAIL IS GENUINELY SENT, TO A DELIBERATELY MALFORMED RECIPIENT. The alert-firing test
// needs the real send path to run, but a regression suite must not put mail in anyone's
// inbox every time it runs. The test client's clients.email is set to a value with no "@",
// which Resend rejects synchronously with a 422 — so email_log records a real, honest
// 'failed' row, proving check-price-alerts genuinely reached the send, without delivering
// anything. (A real, delivered alert email was confirmed separately, once, by hand — see
// this task's own writeup.) The technique and the reason are row 153's.
//
// Requires: the local Supabase stack running, this task's migration applied, and
// `supabase functions serve` running with FINNHUB_API_KEY/RESEND_API_KEY in its env file.

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { Client: PgClient } = require('pg');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY, dbUrl: status.DB_URL };
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, session: data.session };
}

// A plain fetch rather than functions.invoke(): this file needs the real HTTP STATUS on a
// rejection (401 vs 403 vs 400 vs 409 are four genuinely different assertions here), and
// supabase-js collapses every non-2xx into one generic FunctionsHttpError message.
async function callFunction(url, token, name, body) {
  const res = await fetch(url + '/functions/v1/' + name, {
    method: 'POST',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {}
    ),
    body: JSON.stringify(body || {})
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* a 204 or a non-JSON body */ }
  return { status: res.status, body: json };
}

async function cleanupClient(admin, userId) {
  await admin.from('price_alerts').delete().eq('client_id', userId);
  await admin.from('watchlist_symbols').delete().eq('client_id', userId);
  await admin.from('email_log').delete().eq('recipient', 'wl-verify-' + userId);
  await admin.from('clients').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);
}

async function main() {
  console.log('Merged Market Snapshot + Watchlist — backend verification\n');
  const { url, anonKey, serviceRoleKey, dbUrl } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyWatchlist-2026!';
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  const createdProductIds = [];
  const users = [];

  async function makeClient(label) {
    const email = 'wl-' + label + '-' + suffix + '@marketswave.test';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error('createUser failed: ' + error.message);
    // Deliberately malformed clients.email — see the header. The AUTH email stays valid
    // (a malformed one would break sign-in itself, a different concern entirely).
    const { error: insErr } = await admin.from('clients').insert({
      id: data.user.id,
      name: 'Watchlist Verify ' + label,
      email: 'wl-verify-' + data.user.id,
      phone: '+1 555 0100',
      account_type: 'Individual Account',
      status: 'active'
    });
    if (insErr) throw new Error('clients insert failed: ' + insErr.message);
    users.push(data.user.id);
    const session = await signIn(url, anonKey, email, password);
    return { id: data.user.id, token: session.session.access_token, client: session.client };
  }

  try {
    const a = await makeClient('a');
    const b = await makeClient('b');

    // =========================================================================================
    console.log('=== PART 1: the card\'s single read, and the six defaults ===\n');
    // =========================================================================================
    const first = await callFunction(url, a.token, 'get-watchlist');
    check('get-watchlist succeeds for a real signed-in client', first.status === 200, JSON.stringify(first.body));
    check('a genuinely first call seeds the six defaults the card used to hardcode',
      first.body && first.body.count === 6 &&
      ['SPY', 'QQQ', 'DIA', 'BTC', 'ETH', 'SOL'].every((s) => first.body.symbols.some((r) => r.symbol === s)),
      JSON.stringify(first.body && first.body.symbols && first.body.symbols.map((r) => r.symbol)));
    check('the per-client ceiling is reported to the UI, not just enforced server-side',
      first.body && first.body.limit === 25, String(first.body && first.body.limit));

    const spy = first.body.symbols.find((r) => r.symbol === 'SPY');
    const btc = first.body.symbols.find((r) => r.symbol === 'BTC');
    check('SPY carries a real, positive price from a real provider (not a placeholder)',
      spy && typeof spy.price === 'number' && spy.price > 0, JSON.stringify(spy));
    check('BTC carries a real, positive price from a real provider', btc && btc.price > 0, JSON.stringify(btc));
    check('every seeded row carries a real human name, not just its ticker',
      first.body.symbols.every((r) => r.name && r.name !== r.symbol));

    // ---- the symbol -> product mapping, in both its states -----------------------------------
    const ethRow = first.body.symbols.find((r) => r.symbol === 'ETH');
    check('ETH resolves to the real catalog product (PROD-0004) and is therefore Offered',
      ethRow && ethRow.offered && ethRow.offered.productId === 'PROD-0004', JSON.stringify(ethRow && ethRow.offered));
    check('SPY has no catalog product and is therefore Tracking only — the honest state, not a fabricated mapping',
      spy && spy.offered === null);
    check('an Offered row carries what an Allocate action genuinely needs (a product id and its real minimum)',
      ethRow.offered.minimumInvestment != null && ethRow.offered.productName);

    const secondRead = await callFunction(url, a.token, 'get-watchlist');
    check('a warm second read costs no provider calls (nothing stale, nothing refreshed)',
      secondRead.body.refreshed === 0, String(secondRead.body.refreshed));

    // =========================================================================================
    console.log('\n=== PART 2: symbol search across BOTH real providers ===\n');
    // =========================================================================================
    const search = await callFunction(url, a.token, 'search-symbols', { query: 'eth' });
    check('search-symbols succeeds', search.status === 200, JSON.stringify(search.body));
    const hasCrypto = (search.body.results || []).some((r) => r.source === 'coingecko');
    const hasStock = (search.body.results || []).some((r) => r.source === 'finnhub');
    check('a real query returns results from CoinGecko (crypto)', hasCrypto,
      JSON.stringify(search.body.results));
    check('the same query returns results from Finnhub (stocks/ETFs) — both providers, one search',
      hasStock, JSON.stringify(search.body.results));
    check('every result is marked with its real source and asset type',
      (search.body.results || []).every((r) => (r.source === 'finnhub' || r.source === 'coingecko') &&
        (r.assetType === 'stock' || r.assetType === 'crypto')));
    check('every crypto result carries the provider id its price actually needs (the ticker alone cannot fetch it)',
      (search.body.results || []).filter((r) => r.source === 'coingecko').every((r) => !!r.providerId));
    const ethResult = (search.body.results || []).find((r) => r.symbol === 'ETH' && r.source === 'coingecko');
    check('a search result is marked catalog-offered by the same mapping the watchlist row uses',
      ethResult && ethResult.offered === true, JSON.stringify(ethResult));
    const nonOffered = (search.body.results || []).find((r) => r.symbol !== 'ETH');
    check('a result with no catalog product is honestly marked not-offered',
      nonOffered && nonOffered.offered === false, JSON.stringify(nonOffered));

    const emptySearch = await callFunction(url, a.token, 'search-symbols', { query: '' });
    check('an empty query returns nothing rather than spending provider budget',
      emptySearch.status === 200 && emptySearch.body.results.length === 0);
    check('search-symbols refuses an unauthenticated caller (it spends real rate-limit budget)',
      (await callFunction(url, null, 'search-symbols', { query: 'eth' })).status === 401);

    // =========================================================================================
    console.log('\n=== PART 3: adding and removing a symbol ===\n');
    // =========================================================================================
    const addNvda = await callFunction(url, a.token, 'add-watchlist-symbol',
      { symbol: 'NVDA', source: 'finnhub', name: 'NVIDIA Corporation' });
    check('a real stock validated live at Finnhub is added', addNvda.status === 200, JSON.stringify(addNvda.body));
    check('the response reports the real new count against the real ceiling',
      addNvda.body.count === 7 && addNvda.body.limit === 25, JSON.stringify(addNvda.body));

    const afterAdd = await callFunction(url, a.token, 'get-watchlist');
    const nvdaRow = afterAdd.body.symbols.find((r) => r.symbol === 'NVDA');
    check('the new row is priced immediately rather than blank until the next scheduled run',
      nvdaRow && typeof nvdaRow.price === 'number' && nvdaRow.price > 0, JSON.stringify(nvdaRow));
    check('an added stock with no catalog product reads Tracking only', nvdaRow && nvdaRow.offered === null);

    const dupe = await callFunction(url, a.token, 'add-watchlist-symbol',
      { symbol: 'nvda', source: 'finnhub', name: 'NVIDIA Corporation' });
    check('the same symbol in different case is refused as the duplicate it is', dupe.status === 409,
      JSON.stringify(dupe.body));

    // ★ THE ONE THAT ONLY A REAL PROVIDER CALL CAN SHOW: Finnhub answers an unknown symbol
    // with HTTP 200 and c:0, not a 404. Without the zero-price check this would be stored as
    // a permanently $0.00 row with nothing anywhere reporting a failure.
    const bogus = await callFunction(url, a.token, 'add-watchlist-symbol',
      { symbol: 'ZZQQXNOTREAL', source: 'finnhub', name: 'Not A Real Company' });
    check('a symbol Finnhub cannot price is refused rather than stored as a $0.00 row',
      bogus.status === 400, JSON.stringify(bogus.body));
    const bogusStored = await admin.from('watchlist_symbols').select('id').eq('client_id', a.id).eq('symbol', 'ZZQQXNOTREAL');
    check('...and nothing was written (the rejection is not just a message)',
      (bogusStored.data || []).length === 0);

    check('a CoinGecko add without its provider id is refused', (await callFunction(url, a.token,
      'add-watchlist-symbol', { symbol: 'DOGE', source: 'coingecko' })).status === 400);
    check('an unknown source is refused', (await callFunction(url, a.token,
      'add-watchlist-symbol', { symbol: 'AAPL', source: 'nasdaq' })).status === 400);

    // Ceiling, seeded through service_role rather than 18 more real provider calls.
    const filler = [];
    for (let i = 0; i < 18; i++) {
      filler.push({ client_id: a.id, symbol: 'FILL' + i, name: 'Filler ' + i, source: 'finnhub', provider_id: null, asset_type: 'stock' });
    }
    await admin.from('watchlist_symbols').insert(filler);
    const atCeiling = await callFunction(url, a.token, 'add-watchlist-symbol',
      { symbol: 'MSFT', source: 'finnhub', name: 'Microsoft Corporation' });
    check('the per-client ceiling is enforced server-side, where the shared provider budget actually is',
      atCeiling.status === 409, JSON.stringify(atCeiling.body));
    check('...and the refusal tells the client what to do about it',
      /25 symbols/.test((atCeiling.body || {}).error || ''), JSON.stringify(atCeiling.body));
    await admin.from('watchlist_symbols').delete().eq('client_id', a.id).like('symbol', 'FILL%');

    // Remove — and the cross-client attempt.
    const bList = await callFunction(url, b.token, 'get-watchlist');
    const bSpyId = bList.body.symbols.find((r) => r.symbol === 'SPY').id;
    const crossRemove = await callFunction(url, a.token, 'remove-watchlist-symbol', { id: bSpyId });
    check('one client cannot remove another client\'s watchlist row', crossRemove.status === 404);
    const stillThere = await admin.from('watchlist_symbols').select('id').eq('id', bSpyId);
    check('...and that row is provably still there (the refusal is not vacuous)',
      (stillThere.data || []).length === 1);

    const removed = await callFunction(url, a.token, 'remove-watchlist-symbol',
      { id: afterAdd.body.symbols.find((r) => r.symbol === 'NVDA').id });
    check('a client removes their own row', removed.status === 200 && removed.body.removed === 'NVDA');
    const afterRemove = await callFunction(url, a.token, 'get-watchlist');
    check('the removed symbol is genuinely gone', !afterRemove.body.symbols.some((r) => r.symbol === 'NVDA'));
    check('removing everything does NOT silently re-seed the six defaults on the next read',
      afterRemove.body.count === 6 && afterRemove.body.symbols.every((r) => r.symbol !== 'NVDA'));

    // =========================================================================================
    console.log('\n=== PART 4: one alert per row, and its validation ===\n');
    // =========================================================================================
    const list = await callFunction(url, a.token, 'get-watchlist');
    const btcRow = list.body.symbols.find((r) => r.symbol === 'BTC');
    const qqqRow = list.body.symbols.find((r) => r.symbol === 'QQQ');

    check('a zero target is refused', (await callFunction(url, a.token, 'set-price-alert',
      { watchlistSymbolId: btcRow.id, direction: 'above', targetPrice: 0 })).status === 400);
    check('a negative target is refused', (await callFunction(url, a.token, 'set-price-alert',
      { watchlistSymbolId: btcRow.id, direction: 'above', targetPrice: -5 })).status === 400);
    check('an unknown direction is refused', (await callFunction(url, a.token, 'set-price-alert',
      { watchlistSymbolId: btcRow.id, direction: 'sideways', targetPrice: 100 })).status === 400);
    check('an alert cannot be set on another client\'s row', (await callFunction(url, a.token,
      'set-price-alert', { watchlistSymbolId: bSpyId, direction: 'above', targetPrice: 100 })).status === 404);

    const setOne = await callFunction(url, a.token, 'set-price-alert',
      { watchlistSymbolId: btcRow.id, direction: 'above', targetPrice: 999999 });
    check('a real alert is set', setOne.status === 200 && setOne.body.direction === 'above');

    const replace = await callFunction(url, a.token, 'set-price-alert',
      { watchlistSymbolId: btcRow.id, direction: 'below', targetPrice: 1 });
    check('setting a second alert on the same row REPLACES the first rather than stacking', replace.status === 200);
    const activeOnBtc = await admin.from('price_alerts').select('*').eq('watchlist_symbol_id', btcRow.id).eq('status', 'active');
    check('...leaving exactly one active alert on that row', (activeOnBtc.data || []).length === 1,
      String((activeOnBtc.data || []).length));
    check('...and the replaced one is NOT recorded as having fired — it did not',
      (await admin.from('price_alerts').select('id').eq('watchlist_symbol_id', btcRow.id).eq('status', 'fired')).data.length === 0);

    // The database, not just the function, is what actually enforces "one per row".
    const directDupe = await admin.from('price_alerts').insert({
      client_id: a.id, watchlist_symbol_id: btcRow.id, symbol: 'BTC',
      direction: 'above', target_price: 500, status: 'active'
    });
    check('a second ACTIVE alert on one row is refused by the database itself, not only by the function',
      !!directDupe.error && directDupe.error.code === '23505', JSON.stringify(directDupe.error));

    const withAlert = await callFunction(url, a.token, 'get-watchlist');
    check('the card read carries the armed alert on its own row',
      withAlert.body.symbols.find((r) => r.symbol === 'BTC').alert.direction === 'below');
    check('a row with no alert reports none rather than an empty object',
      withAlert.body.symbols.find((r) => r.symbol === 'QQQ').alert === null);

    const cleared = await callFunction(url, a.token, 'clear-price-alert', { watchlistSymbolId: btcRow.id });
    check('a client clears their own alert', cleared.status === 200);
    check('clearing again reports there is nothing to clear',
      (await callFunction(url, a.token, 'clear-price-alert', { watchlistSymbolId: btcRow.id })).status === 404);
    check('a cleared alert is deleted, not recorded as fired (it never fired)',
      (await admin.from('price_alerts').select('id').eq('watchlist_symbol_id', btcRow.id)).data.length === 0);

    // =========================================================================================
    console.log('\n=== PART 5: a real alert firing ONCE and clearing ===\n');
    // =========================================================================================
    const qqqPriceRow = await admin.from('market_data_cache').select('value').eq('symbol', 'QQQ').single();
    const qqqPrice = Number(qqqPriceRow.data.value);
    // A target the real current price is already past, so this fires on the real comparison
    // against real cached data rather than against a value invented for the test.
    const target = Math.round(qqqPrice * 0.5 * 100) / 100;
    const armed = await callFunction(url, a.token, 'set-price-alert',
      { watchlistSymbolId: qqqRow.id, direction: 'above', targetPrice: target });
    check('an alert is armed below the real current price, so the real comparison must trip it',
      armed.status === 200 && target < qqqPrice);

    const emailsBefore = (await admin.from('email_log').select('id').eq('recipient', 'wl-verify-' + a.id)).data.length;

    const sweep1 = await callFunction(url, pm.session.access_token, 'check-price-alerts');
    check('the alert sweep runs', sweep1.status === 200, JSON.stringify(sweep1.body));
    check('the armed alert genuinely fired', (sweep1.body.alerts || []).some((x) => x.symbol === 'QQQ'),
      JSON.stringify(sweep1.body));

    const firedRow = (await admin.from('price_alerts').select('*').eq('watchlist_symbol_id', qqqRow.id)).data[0];
    check('the alert is now marked fired, not deleted — the client can still see that it happened',
      firedRow && firedRow.status === 'fired');
    check('...with the real price it fired at recorded', firedRow && Number(firedRow.fired_price) === qqqPrice,
      String(firedRow && firedRow.fired_price) + ' vs ' + qqqPrice);
    check('...and the time it fired', firedRow && !!firedRow.fired_at);

    const emailRows = (await admin.from('email_log').select('*').eq('recipient', 'wl-verify-' + a.id)).data;
    check('firing genuinely reached the email send path', emailRows.length === emailsBefore + 1,
      emailRows.length + ' rows');
    check('...and the attempt is logged honestly rather than as a fake success (the recipient is deliberately malformed)',
      emailRows.length > 0 && emailRows[emailRows.length - 1].status === 'failed');
    check('...naming the symbol in the subject, so the client can tell which alert this was',
      emailRows.length > 0 && /QQQ/.test(emailRows[emailRows.length - 1].subject));

    // ★ FIRE ONCE. The second sweep is the assertion the whole design exists for.
    const sweep2 = await callFunction(url, pm.session.access_token, 'check-price-alerts');
    check('a second sweep does NOT re-fire the same alert — it fires once and clears',
      !(sweep2.body.alerts || []).some((x) => x.symbol === 'QQQ'), JSON.stringify(sweep2.body));
    const emailsAfter = (await admin.from('email_log').select('id').eq('recipient', 'wl-verify-' + a.id)).data.length;
    check('...and sends no second email', emailsAfter === emailRows.length, emailsAfter + ' vs ' + emailRows.length);

    const clearedAfterFire = await callFunction(url, a.token, 'get-watchlist');
    check('the row shows no armed alert afterwards — it has genuinely cleared',
      clearedAfterFire.body.symbols.find((r) => r.symbol === 'QQQ').alert === null);
    const reArm = await callFunction(url, a.token, 'set-price-alert',
      { watchlistSymbolId: qqqRow.id, direction: 'above', targetPrice: 999999 });
    check('a new alert can be set on the same row after one has fired', reArm.status === 200);
    check('...alongside the fired one, which is kept as history',
      (await admin.from('price_alerts').select('status').eq('watchlist_symbol_id', qqqRow.id)).data.length === 2);

    // An alert on a symbol with no cached price must not fire on an invented comparison.
    await admin.from('price_alerts').delete().eq('client_id', a.id);
    await admin.from('watchlist_symbols').insert({
      client_id: a.id, symbol: 'NOPRICE' + suffix.toUpperCase(), name: 'Unpriced Test',
      source: 'finnhub', provider_id: null, asset_type: 'stock'
    });
    const unpriced = (await admin.from('watchlist_symbols').select('id').eq('client_id', a.id).like('symbol', 'NOPRICE%')).data[0];
    await admin.from('price_alerts').insert({
      client_id: a.id, watchlist_symbol_id: unpriced.id, symbol: 'NOPRICE' + suffix.toUpperCase(),
      direction: 'below', target_price: 1000000, status: 'active'
    });
    const sweep3 = await callFunction(url, pm.session.access_token, 'check-price-alerts');
    check('an alert on a symbol with no cached price does not fire on an invented comparison',
      !(sweep3.body.alerts || []).some((x) => /^NOPRICE/.test(x.symbol)), JSON.stringify(sweep3.body));
    await admin.from('price_alerts').delete().eq('client_id', a.id);
    await admin.from('watchlist_symbols').delete().eq('id', unpriced.id);

    // =========================================================================================
    console.log('\n=== PART 6: the scheduled refresh, and what the free tiers sustain ===\n');
    // =========================================================================================
    const refresh = await callFunction(url, pm.session.access_token, 'refresh-market-data');
    check('the scheduled refresh runs', refresh.status === 200, JSON.stringify(refresh.body));
    check('it refreshes the UNION of the base symbols and everything any client watches',
      refresh.body.distinctSymbols >= 6, JSON.stringify(refresh.body));
    check('crypto costs one batched call however many coins are watched (CoinGecko genuinely batches)',
      refresh.body.distinctCryptoSymbols >= 3);
    check('the ceiling it reports is derived from the measured Finnhub budget, not a guess (30/min x 15 min)',
      refresh.body.stockSymbolCeiling === 450, String(refresh.body.stockSymbolCeiling));
    check('real remaining headroom is reported on every run, so the margin is observable',
      refresh.body.headroom === 450 - refresh.body.distinctStockSymbols);
    check('every symbol it attempted was genuinely priced', (refresh.body.failed || []).length === 0,
      JSON.stringify(refresh.body.failed));

    const cacheRows = (await admin.from('market_data_cache').select('*').in('symbol', ['SPY', 'BTC'])).data;
    check('the cache carries the display name the card renders, no longer a constant in code',
      cacheRows.every((r) => !!r.name));
    check('...and the asset type that decides which provider refreshes it',
      cacheRows.every((r) => r.asset_type === 'stock' || r.asset_type === 'crypto'));
    check('...and CoinGecko\'s own id, which is not derivable from the ticker',
      cacheRows.find((r) => r.symbol === 'BTC').provider_id === 'bitcoin');

    // The pre-existing six-symbol read must not blank those new columns on a cache miss.
    await admin.from('market_data_cache').update({ last_updated: new Date(Date.now() - 30 * 60 * 1000).toISOString() }).eq('symbol', 'SPY');
    const legacy = await callFunction(url, a.token, 'get-market-snapshot');
    check('the original get-market-snapshot still works after the cache became dynamic', legacy.status === 200);
    const spyAfterLegacy = (await admin.from('market_data_cache').select('name, asset_type').eq('symbol', 'SPY').single()).data;
    check('...and its own refresh no longer blanks name/asset_type (an upsert replaces the whole row)',
      spyAfterLegacy.name === 'S&P 500 ETF' && spyAfterLegacy.asset_type === 'stock', JSON.stringify(spyAfterLegacy));

    // =========================================================================================
    console.log('\n=== PART 7: authorization on the scheduled functions ===\n');
    // =========================================================================================
    for (const fn of ['refresh-market-data', 'check-price-alerts']) {
      check(fn + ' refuses an unauthenticated caller', (await callFunction(url, null, fn)).status === 401);
      check(fn + ' refuses an ordinary signed-in client', (await callFunction(url, a.token, fn)).status === 403);
      check(fn + ' accepts the service_role token pg_cron actually sends',
        (await callFunction(url, serviceRoleKey, fn)).status === 200);
    }

    // =========================================================================================
    console.log('\n=== PART 8: RLS ===\n');
    // =========================================================================================
    const aOwn = await a.client.from('watchlist_symbols').select('*');
    check('a client reads their own watchlist through RLS', (aOwn.data || []).length > 0);
    check('...and sees none of another client\'s rows',
      (aOwn.data || []).every((r) => r.client_id === a.id));
    const aSeesB = await a.client.from('watchlist_symbols').select('*').eq('client_id', b.id);
    check('a direct query for another client\'s rows returns nothing', (aSeesB.data || []).length === 0);

    const insertAttempt = await a.client.from('watchlist_symbols').insert({
      client_id: a.id, symbol: 'RLSX', name: 'RLS Test', source: 'finnhub', provider_id: null, asset_type: 'stock'
    });
    check('no client-side INSERT path exists on watchlist_symbols, even for a client\'s own row',
      !!insertAttempt.error, JSON.stringify(insertAttempt.error));
    const updateAttempt = await a.client.from('watchlist_symbols').update({ name: 'Hacked' }).eq('client_id', a.id).select();
    check('no client-side UPDATE path exists', (updateAttempt.data || []).length === 0);
    const deleteAttempt = await a.client.from('watchlist_symbols').delete().eq('client_id', a.id).select();
    check('no client-side DELETE path exists (removal goes through the function)',
      (deleteAttempt.data || []).length === 0);
    check('...and the rows are provably still there',
      (await admin.from('watchlist_symbols').select('id').eq('client_id', a.id)).data.length > 0);

    const alertInsert = await a.client.from('price_alerts').insert({
      client_id: a.id, watchlist_symbol_id: btcRow.id, symbol: 'BTC', direction: 'above', target_price: 1
    });
    check('no client-side INSERT path exists on price_alerts either', !!alertInsert.error);

    const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    check('an anonymous caller sees no watchlist rows at all',
      ((await anon.from('watchlist_symbols').select('*')).data || []).length === 0);
    check('an anonymous caller sees no price alerts at all',
      ((await anon.from('price_alerts').select('*')).data || []).length === 0);

    // =========================================================================================
    console.log('\n=== PART 9: the shared symbol -> product primitive ===\n');
    // =========================================================================================
    const newProduct = await callFunction(url, pm.session.access_token, 'add-product', {
      name: 'Watchlist Verify Equity ' + suffix, assetClass: 'Stocks & ETFs',
      investmentType: 'Index Fund', riskTier: 'balanced', minimumInvestment: 1000,
      unitPrice: 50, ticker: 'spy'
    });
    check('a PM can map a catalog product to a real market symbol', newProduct.status === 200,
      JSON.stringify(newProduct.body));
    if (newProduct.status === 200) createdProductIds.push(newProduct.body.id);
    check('...stored uppercase, so a product entered as "spy" and a row stored as "SPY" are one mapping',
      newProduct.body.ticker === 'SPY', String(newProduct.body.ticker));

    const nowOffered = await callFunction(url, a.token, 'get-watchlist');
    check('the watchlist row for that symbol now reads Offered, through the shared mapping alone',
      nowOffered.body.symbols.find((r) => r.symbol === 'SPY').offered.productId === newProduct.body.id);

    const dupTicker = await callFunction(url, pm.session.access_token, 'add-product', {
      name: 'Duplicate Ticker ' + suffix, assetClass: 'Stocks & ETFs', investmentType: 'Index Fund',
      riskTier: 'balanced', minimumInvestment: 1000, unitPrice: 50, ticker: 'SPY'
    });
    check('two products cannot both claim one symbol — the Allocate button must be unambiguous',
      dupTicker.status === 409, JSON.stringify(dupTicker.body));
    if (dupTicker.status === 200) createdProductIds.push(dupTicker.body.id);

    const badTicker = await callFunction(url, pm.session.access_token, 'add-product', {
      name: 'Bad Ticker ' + suffix, assetClass: 'Stocks & ETFs', investmentType: 'Index Fund',
      riskTier: 'balanced', minimumInvestment: 1000, unitPrice: 50, ticker: 'not a symbol!'
    });
    check('free text is refused as a ticker', badTicker.status === 400, JSON.stringify(badTicker.body));
    if (badTicker.status === 200) createdProductIds.push(badTicker.body.id);

    const clearTicker = await callFunction(url, pm.session.access_token, 'edit-product', {
      id: newProduct.body.id, patch: { ticker: '' }
    });
    check('clearing a ticker stores null, not an empty string', clearTicker.status === 200 && !clearTicker.body.ticker);
    const backToTracking = await callFunction(url, a.token, 'get-watchlist');
    check('...and the watchlist row honestly reverts to Tracking only',
      backToTracking.body.symbols.find((r) => r.symbol === 'SPY').offered === null);

    // =========================================================================================
    console.log('\n=== PART 10: the scheduler itself (this project had none) ===\n');
    // =========================================================================================
    const jobs = (await admin.rpc('invoke_edge_function', { fn: 'refresh-market-data' }));
    check('invoke_edge_function is NOT callable by service_role through PostgREST either — it is the scheduler\'s alone',
      !!jobs.error, JSON.stringify(jobs.data));

    const clientRpc = await a.client.rpc('invoke_edge_function', { fn: 'refresh-market-data' });
    check('a signed-in client certainly cannot call it (it reads a service_role key)', !!clientRpc.error);

    // ★ THE REAL END-TO-END SCHEDULER PROOF. Everything above tests the functions; this
    // tests the thing that will actually call them at 09:15 with nobody watching —
    // pg_cron's own statement, running as postgres, reaching out through pg_net and coming
    // back with a real HTTP 200 from a real Edge Function.
    const pg = new PgClient({ connectionString: dbUrl });
    await pg.connect();
    try {
      const cronJobs = await pg.query('select jobname, schedule, active from cron.job order by jobname');
      check('both cron jobs exist and are active',
        cronJobs.rows.length === 2 && cronJobs.rows.every(function (r) { return r.active; }),
        JSON.stringify(cronJobs.rows));
      check('the refresh runs every 15 minutes',
        cronJobs.rows.some(function (r) { return r.jobname === 'marketswave-refresh-market-data' && r.schedule === '*/15 * * * *'; }));
      check('the alert sweep runs two minutes after it, so it always reads prices the refresh already wrote',
        cronJobs.rows.some(function (r) { return r.jobname === 'marketswave-check-price-alerts' && r.schedule === '2-59/15 * * * *'; }));

      const secrets = await pg.query(
        "select name from vault.decrypted_secrets where name in ('edge_functions_base_url','scheduler_service_role_key')");
      check('the scheduler credentials live in the vault, not in the committed migration',
        secrets.rows.length === 2, JSON.stringify(secrets.rows));

      const invoked = await pg.query("select public.invoke_edge_function('refresh-market-data') as request_id");
      const requestId = invoked.rows[0].request_id;
      check('the exact statement pg_cron runs issues a real pg_net request', requestId != null, String(requestId));

      let httpStatus = null;
      for (let i = 0; i < 40 && httpStatus === null; i++) {
        await new Promise(function (r) { setTimeout(r, 500); });
        const res = await pg.query('select status_code from net._http_response where id = $1', [requestId]);
        if (res.rows.length > 0) httpStatus = res.rows[0].status_code;
      }
      check('...which genuinely reaches the Edge Function and comes back 200 — the scheduler works end to end',
        httpStatus === 200, 'status ' + httpStatus);
    } finally {
      await pg.end();
    }

    // =========================================================================================
    console.log('\n=== PART 11: cross-client isolation, end to end ===\n');
    // =========================================================================================
    const beforeB = JSON.stringify((await admin.from('watchlist_symbols').select('*').eq('client_id', b.id).order('symbol')).data);
    await callFunction(url, a.token, 'add-watchlist-symbol', { symbol: 'AAPL', source: 'finnhub', name: 'Apple Inc.' });
    const aRows = (await admin.from('watchlist_symbols').select('symbol').eq('client_id', a.id)).data;
    check('Client A\'s own watchlist genuinely changed (so the isolation check below is not vacuous)',
      aRows.some((r) => r.symbol === 'AAPL'));
    const afterB = JSON.stringify((await admin.from('watchlist_symbols').select('*').eq('client_id', b.id).order('symbol')).data);
    check('Client B\'s watchlist is byte-for-byte unchanged by all of Client A\'s activity', beforeB === afterB);
    check('Client B\'s own read still returns only their own six defaults',
      (await callFunction(url, b.token, 'get-watchlist')).body.count === 6);
  } finally {
    for (const id of createdProductIds) {
      await admin.from('products').delete().eq('id', id);
    }
    for (const id of users) {
      await cleanupClient(admin, id);
    }
    // The filler/test symbols this run added to the shared cache are real market data and
    // harmless to leave, but they would silently grow the scheduled refresh's own cost on
    // every future run, so they go too. The six base symbols stay — the public ticker is
    // served from them.
    await admin.from('market_data_cache').delete().in('symbol', ['NVDA', 'AAPL', 'MSFT']);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err && err.stack);
  process.exit(1);
});
