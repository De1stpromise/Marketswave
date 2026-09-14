#!/usr/bin/env node
// ★ Asset logos (2026-09-13, row 207) — the backend, against the local stack.
//
// What this proves, with REAL provider calls:
//   1. resolve-asset-logos is admin-only: 401 unauthenticated, 403 for a real client.
//   2. The asset-logos bucket is PUBLIC to read (a plain <img> needs no signed URL — a real
//      anon fetch returns image bytes with a week-long cache header) and closed to every
//      client-side write: a signed-in client can neither upload into it nor delete from it.
//   3. The backfill is resumable and honest: `symbols` + `limit` bound one call and report
//      `remaining`; a catalog whose rows already carry a stored logo reports `kept`; a
//      symbol NO provider has resolves to null — the record stays null (the page renders
//      the monogram), never a placeholder URL.
//   4. `diagnose` walks every provider in the chain and reports what each answered.
//   5. add-watchlist-symbol resolves a coin's mark AT CREATION (the client's own path —
//      no PM, no backfill) and get-watchlist hands the stored PATH back as logoUrl.
//   6. The scheduled refresh's upsert never clobbers a stored logo_url (its payload never
//      carries the column — PostgREST only SETs the columns present).
//   7. add-product resolves a market product's mark at creation (admin path).
//
// Requires: the local stack, `supabase functions serve`, and the local bootstrap PM
// (scripts/supabase-bootstrap-admin.js). Every row and object this creates is removed.

const { execSync } = require('child_process');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function invoke(client, body) {
  const { data, error } = await client.functions.invoke('resolve-asset-logos', { body });
  if (error) {
    let text = '';
    try { text = error.context ? await error.context.text() : ''; } catch (_e) { /* ignore */ }
    return { status: error.context ? error.context.status : 0, error: text || error.message };
  }
  return { status: 200, data };
}

async function main() {
  console.log('Asset logos — backend verification (local stack, real providers)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyAssetLogosBackend-2026!';
  const email = 'albe-' + suffix + '@test.marketswave.local';

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw new Error(cErr.message);
  const clientId = created.user.id;
  await admin.from('clients').insert({ id: clientId, name: 'Asset Logos Backend', email: 'albe-' + clientId, phone: '+1', account_type: 'Individual Account', status: 'active' });
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 1000, allocated_capital: 0, asset_returns: 0 });
  await admin.from('clients').update({ watchlist_seeded_at: new Date().toISOString() }).eq('id', clientId);

  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pm = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const createdProductIds = [];
  // PEPE, not LTC (2026-09-14): Litecoin became a real product (PROD-0296) in the row-211 seed, so
  // the fake-value upsert, the cache delete and the storage removes below were all landing on a
  // real product's rows — found by verify-fixture-symbols on its first run, missed by the row-212
  // sweep. A meme coin is the safe crypto fixture: the catalog excludes them by policy, so this
  // symbol cannot become a product later. DOGE/SHIB are already other suites' fixtures.
  const testCoinSymbol = 'PEPE';
  const testCoinId = 'pepe';
  const nonsense = 'ZQ' + suffix.slice(0, 3).toUpperCase(); // a 5-char ticker no provider has
  let vxusCacheBefore = null;

  try {
    const { error: sErr } = await client.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const { error: pErr } = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (pErr) throw new Error('local PM sign-in: ' + pErr.message);

    // ---- 1. authorization ----
    console.log('1. Authorization\n');
    const noAuth = await invoke(anon, { action: 'diagnose', kind: 'ticker', symbol: 'SPY' });
    check('unauthenticated → 401', noAuth.status === 401, JSON.stringify(noAuth));
    const asClient = await invoke(client, { action: 'diagnose', kind: 'ticker', symbol: 'SPY' });
    check('a real signed-in CLIENT → 403 (Portfolio Manager access required)', asClient.status === 403, JSON.stringify(asClient));

    // ---- 2. the bucket ----
    console.log('\n2. The asset-logos bucket: public to read, closed to client writes\n');
    const spy = (await admin.from('products').select('logo_url').eq('id', 'PROD-0006').single()).data;
    check('the seeded catalog carries a stored PATH for SPY (the backfill ran)', !!spy && /^\/storage\/v1\/object\/public\/asset-logos\/ticker\/SPY\.png$/.test(spy.logo_url || ''), spy && spy.logo_url);
    const pub = await fetch(url.replace(/\/$/, '') + spy.logo_url);
    const bytes = Buffer.from(await pub.arrayBuffer());
    check('a plain, unauthenticated fetch of the stored path returns the image (200, image/png, real PNG bytes)',
      pub.status === 200 && /^image\/png/.test(pub.headers.get('content-type') || '') && bytes.slice(1, 4).toString() === 'PNG' && bytes.length > 100,
      pub.status + ' ' + pub.headers.get('content-type') + ' ' + bytes.length + 'B');
    check('...with a week-long cache header (a dashboard load makes zero provider requests, and repeat loads zero storage requests)',
      /max-age=604800/.test(pub.headers.get('cache-control') || ''), pub.headers.get('cache-control'));
    const upload = await client.storage.from('asset-logos').upload('ticker/HACK-' + suffix + '.png', bytes, { contentType: 'image/png' });
    check('a signed-in client CANNOT upload into the bucket', !!upload.error, JSON.stringify(upload));
    // fixture-symbols-allow: SPY — negative RLS test: a signed-in CLIENT session must be refused this delete; the next line proves the real object survived
    const del = await client.storage.from('asset-logos').remove(['ticker/SPY.png']);
    const stillThere = await fetch(url.replace(/\/$/, '') + spy.logo_url);
    check('a signed-in client CANNOT delete a stored mark (the object is still served afterwards)', stillThere.status === 200 && (!!del.error || !del.data || del.data.length === 0), JSON.stringify(del));

    // ---- 3. backfill ----
    console.log('\n3. Backfill — resumable, honest\n');
    const kept = await invoke(pm, { action: 'backfill', symbols: ['SPY', 'QQQ', 'DIA'] });
    check('a plain backfill over rows that already carry a stored logo reports every one as kept, none processed, remaining 0',
      kept.status === 200 && kept.data.processed === 0 && kept.data.remaining === 0 && kept.data.symbols.every((r) => r.outcome === 'kept') && kept.data.symbols.length === 3, JSON.stringify(kept.data));
    const bounded = await invoke(pm, { action: 'backfill', force: true, limit: 1, symbols: ['QQQ', 'DIA'] });
    check('`force` + `limit: 1` over two symbols processes exactly one and reports remaining 1 (the resumable contract)',
      bounded.status === 200 && bounded.data.processed === 1 && bounded.data.remaining === 1 && bounded.data.symbols.filter((r) => r.outcome === 'resolved').length === 1, JSON.stringify(bounded.data));
    check('...and the re-resolved row still points at the same stored path (an overwrite in place, not a second object)',
      bounded.data.symbols.find((r) => r.outcome === 'resolved').logoUrl === '/storage/v1/object/public/asset-logos/ticker/DIA.png', JSON.stringify(bounded.data.symbols));
    // A symbol no provider has: a real cache row, resolved for real, stays null.
    await admin.from('market_data_cache').upsert({ symbol: nonsense, value: 1, change_percent: 0, source: 'finnhub', name: 'Nobody Has This', provider_id: null, asset_type: 'stock', last_updated: new Date().toISOString(), logo_url: null }, { onConflict: 'symbol' });
    const none = await invoke(pm, { action: 'backfill', symbols: [nonsense] });
    const noneRow = (await admin.from('market_data_cache').select('logo_url').eq('symbol', nonsense).single()).data;
    check('★ a symbol NO provider has resolves to `monogram`: the record stays null — never a placeholder URL, never an error',
      none.status === 200 && none.data.symbols.length === 1 && none.data.symbols[0].outcome === 'monogram' && none.data.symbols[0].logoUrl === null && noneRow.logo_url === null, JSON.stringify(none.data));

    // ---- 4. diagnose ----
    console.log('\n4. Diagnose — every provider in the chain, what it answered\n');
    const diag = await invoke(pm, { action: 'diagnose', kind: 'ticker', symbol: 'SPY' });
    const steps = (diag.data && diag.data.steps) || [];
    check('the chain is reported in order: coingecko (skipped — not a coin), elbstream, brandfetch-logo-api',
      steps.map((s) => s.provider).join(',') === 'coingecko,elbstream,brandfetch-logo-api', JSON.stringify(steps));
    check('CoinGecko is skipped for a stock ("does not cover this kind"), never called', !!steps[0] && /does not cover/.test(steps[0].skipped || ''));
    check('Elbstream answers SPY with a real image (200, image/png, non-trivial bytes)', !!steps[1] && steps[1].status === 200 && /^image\/png/.test(steps[1].contentType || '') && steps[1].bytes > 100, JSON.stringify(steps[1]));
    check('Brandfetch offers nothing under the current credential (a Brand API key stays out of the chain) or a URL under a Logo API client ID — either way it is reported, not silent',
      !!steps[2] && (steps[2].offered === 'nothing' || !!steps[2].url), JSON.stringify(steps[2]));
    const diagNone = await invoke(pm, { action: 'diagnose', kind: 'ticker', symbol: nonsense });
    check('for a symbol nobody has, Elbstream answers a genuine 404 (not a placeholder image)', !!diagNone.data && diagNone.data.steps[1].status === 404, JSON.stringify(diagNone.data));

    // ---- 5. add-watchlist-symbol resolves at creation; get-watchlist exposes it ----
    console.log('\n5. A client adds a coin: the mark is resolved at creation, no PM involved\n');
    await admin.from('watchlist_symbols').delete().eq('symbol', testCoinSymbol).eq('client_id', clientId);
    await admin.from('market_data_cache').delete().eq('symbol', testCoinSymbol);
    await admin.storage.from('asset-logos').remove(['crypto/' + testCoinSymbol + '.png', 'crypto/' + testCoinSymbol + '.jpg']);
    const { data: added, error: addErr } = await client.functions.invoke('add-watchlist-symbol', { body: { symbol: testCoinSymbol, source: 'coingecko', providerId: testCoinId } });
    check('add-watchlist-symbol (pepe) succeeds for the client', !addErr, addErr && (addErr.context ? await addErr.context.text() : addErr.message));
    const cacheRow = (await admin.from('market_data_cache').select('logo_url').eq('symbol', testCoinSymbol).maybeSingle()).data;
    check('★ the cache row now carries a stored PATH — resolved at creation, from CoinGecko\'s own image', !!cacheRow && /^\/storage\/v1\/object\/public\/asset-logos\/crypto\/PEPE\.(png|jpg)$/.test(cacheRow.logo_url || ''), JSON.stringify(cacheRow));
    const ltc = cacheRow && cacheRow.logo_url ? await fetch(url.replace(/\/$/, '') + cacheRow.logo_url) : null;
    const ltcBytes = ltc ? Buffer.from(await ltc.arrayBuffer()) : Buffer.alloc(0);
    const isPng = ltcBytes.slice(1, 4).toString() === 'PNG';
    check('...and the object is served publicly; a PNG is CoinGecko\'s 250px mark, not a 128px Elbstream fallback', !!ltc && ltc.status === 200 && ltcBytes.length > 500 && (!isPng || ltcBytes.readUInt32BE(16) >= 200), (ltc && ltc.status) + ' ' + ltcBytes.length + 'B' + (isPng ? ' ' + ltcBytes.readUInt32BE(16) + 'px' : ''));
    const { data: wl, error: wlErr } = await client.functions.invoke('get-watchlist');
    const ltcRow = wl && wl.symbols && wl.symbols.find((r) => r.symbol === testCoinSymbol);
    check('get-watchlist hands the stored path back as logoUrl on the row', !wlErr && !!ltcRow && ltcRow.logoUrl === cacheRow.logo_url, JSON.stringify(ltcRow));
    check('...every row carries logoUrl as a path or an explicit null (the page renders its monogram for null)', !wlErr && wl.symbols.every((r) => r.logoUrl === null || typeof r.logoUrl === 'string'));

    // ---- 6. the refresh upsert never clobbers ----
    console.log('\n6. The refresh upsert leaves a stored logo_url alone\n');
    await admin.from('market_data_cache').upsert({ symbol: testCoinSymbol, value: 99.5, change_percent: 1.1, source: 'coingecko', name: 'Pepe', provider_id: testCoinId, asset_type: 'crypto', last_updated: new Date().toISOString() }, { onConflict: 'symbol' });
    const afterUpsert = (await admin.from('market_data_cache').select('logo_url, value').eq('symbol', testCoinSymbol).single()).data;
    check('★ an upsert of the refresh\'s own row shape (no logo_url in the payload) updates the price and keeps the stored logo_url', afterUpsert.value === 99.5 && afterUpsert.logo_url === cacheRow.logo_url, JSON.stringify(afterUpsert));

    // ---- 7. add-product resolves at creation (admin path) ----
    console.log('\n7. A PM adds a market product: the mark is resolved at creation\n');
    // Fixture symbols must provably NOT be in the real catalog (row 211): since the 2026-09-14
    // seed a hand-picked symbol may be a real product, and a write to its cache row — or a
    // storage delete of its logo — reaches a live product. Check products.ticker before choosing.
    // Only this suite's own leftover (a hard death last run), never a real VXF product.
    await admin.from('products').delete().eq('ticker', 'VXF').ilike('name', '%verify %');
    vxusCacheBefore = (await admin.from('market_data_cache').select('symbol').eq('symbol', 'VXF').maybeSingle()).data;
    const { data: prod, error: prodErr } = await pm.functions.invoke('add-product', { body: {
      name: 'Vanguard Extended Market ETF (verify ' + suffix + ')', investmentType: 'ETF', riskTier: 'balanced',
      minimumInvestment: 1000, pricingModel: 'market', symbol: 'VXF', source: 'finnhub', description: 'verify-supabase-asset-logos test product'
    } });
    if (prod && prod.id) createdProductIds.push(prod.id);
    const prodRow = prod && prod.id ? (await admin.from('products').select('logo_url, ticker').eq('id', prod.id).single()).data : null;
    check('add-product (VXF, Finnhub) succeeds', !prodErr && !!prodRow, prodErr && (prodErr.context ? await prodErr.context.text() : prodErr.message));
    check('★ the new product row carries a stored PATH the moment it is created (Elbstream\'s Vanguard mark), no backfill needed', !!prodRow && prodRow.logo_url === '/storage/v1/object/public/asset-logos/ticker/VXF.png', JSON.stringify(prodRow));
  } finally {
    for (const id of createdProductIds) await admin.from('products').delete().eq('id', id);
    if (createdProductIds.length && !vxusCacheBefore) await admin.from('market_data_cache').delete().eq('symbol', 'VXF');
    await admin.storage.from('asset-logos').remove(['ticker/VXF.png', 'crypto/' + testCoinSymbol + '.png', 'crypto/' + testCoinSymbol + '.jpg', 'ticker/HACK-' + suffix + '.png']);
    await admin.from('watchlist_symbols').delete().eq('client_id', clientId);
    await admin.from('market_data_cache').delete().in('symbol', [testCoinSymbol, nonsense]);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    const { error: dErr } = await admin.auth.admin.deleteUser(clientId);
    if (dErr) console.log('  cleanup: ' + dErr.message);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
