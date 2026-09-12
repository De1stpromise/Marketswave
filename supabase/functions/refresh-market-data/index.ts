// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — THE SCHEDULED CACHE REFRESH.
// ★★ ROUND-ROBIN since 2026-09-12 — see _shared/market-providers.ts for the derivation.
//
// Runs every 15 minutes from pg_cron (see the migration's own scheduler section). This is
// what makes market_data_cache dynamic: it works over the UNION of
//   - the six base symbols the public homepage ticker is served from, always;
//   - every distinct symbol any client currently has on their watchlist; and
//   - every market-priced product's ticker.
//
// ★ THE UNION IS THE WHOLE POINT. Ten clients watching SPY cost one Finnhub call, not ten.
// The refresh has no per-client loop anywhere, and adding one would silently multiply the
// provider cost by the client count.
//
// WHAT ONE RUN DOES, in the terms the free tiers actually charge in:
//   crypto  — exactly ONE CoinGecko call, for EVERY coin in the union, every run (it
//             genuinely batches, so there is nothing to ration).
//   stocks  — one Finnhub call PER SYMBOL, for the N symbols whose cached price is OLDEST
//             (N = STOCK_SYMBOLS_PER_REFRESH_RUN, derived from the measured rate limit).
//             The rest keep their older timestamp and are naturally first in line next run.
//
// So there is no ceiling on distinct stock symbols any more; what grows with the count is
// the worst-case staleness, and this run reports the REAL figure — the age of the oldest
// stock symbol after the run — so the rotation is observable, not assumed. A figure that
// stabilises run over run is the proof the rotation cycles; one that keeps growing means a
// subset is being starved.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeScheduledCall } from '../_shared/scheduler-auth.ts';
import { BASE_SYMBOLS, refreshSymbols, CacheEntry, productCacheEntries, syncMarketPricedProducts, selectStocksForRefresh, oldestStockAfterRun } from '../_shared/market-refresh.ts';
import { STOCK_SYMBOLS_PER_REFRESH_RUN, REFRESH_INTERVAL_MINUTES, cyclesToCoverStocks, worstCaseStalenessMinutes } from '../_shared/market-providers.ts';
import { normalizeSymbol } from '../_shared/symbol-catalog.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = await authorizeScheduledCall(req);
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: watched, error: readErr } = await admin
      .from('watchlist_symbols')
      .select('symbol, name, source, provider_id, asset_type');
    if (readErr) return jsonResponse({ error: readErr.message }, 500);

    // De-duplicate across every client's watchlist AND the base set, keyed on the symbol.
    const bySymbol: Record<string, CacheEntry> = {};
    for (const entry of BASE_SYMBOLS) bySymbol[entry.symbol] = entry;
    for (const row of watched || []) {
      const symbol = normalizeSymbol(row.symbol);
      if (bySymbol[symbol]) continue;
      bySymbol[symbol] = {
        symbol,
        name: row.name as string,
        source: row.source as 'finnhub' | 'coingecko',
        provider_id: (row.provider_id as string) || null,
        asset_type: row.asset_type as 'stock' | 'crypto'
      };
    }

    // Every market-priced PRODUCT's ticker joins the same union, keyed on symbol, so a
    // product and a watchlist row on the same symbol still cost one call.
    const productEntries = await productCacheEntries(admin);
    let productSymbols = 0;
    let productStockSymbolsNew = 0;
    for (const entry of productEntries) {
      productSymbols++;
      if (bySymbol[entry.symbol]) continue;
      if (entry.asset_type === 'stock') productStockSymbolsNew++;
      bySymbol[entry.symbol] = entry;
    }

    const entries = Object.values(bySymbol);
    const allStocks = entries.filter((e) => e.asset_type === 'stock');
    const allCryptos = entries.filter((e) => e.asset_type === 'crypto');

    // ROTATION: the N oldest stocks this run, every coin every run.
    const { selected, skipped } = await selectStocksForRefresh(admin, allStocks, STOCK_SYMBOLS_PER_REFRESH_RUN);
    const outcome = await refreshSymbols(admin, selected.concat(allCryptos));

    // Copy fresh prices onto the market-priced products and flag any whose symbol could
    // not be priced (a zero/absent quote never overwrites the last good price). A product
    // whose symbol was simply not selected this run is untouched — its last good price
    // and honest timestamp stay exactly as they are.
    const productSync = await syncMarketPricedProducts(admin, outcome.failed);

    // THE HEALTH METRIC: the oldest stock symbol's real age, measured after this run.
    const oldest = await oldestStockAfterRun(admin, allStocks);
    const selectedSet = new Set(selected.map((e) => e.symbol));
    const refreshedStocks = outcome.updatedSymbols.filter((sym) => selectedSet.has(sym)).length;

    return jsonResponse({
      distinctSymbols: entries.length,
      distinctStockSymbols: allStocks.length,
      distinctCryptoSymbols: allCryptos.length,
      // Rotation
      stockSymbolsPerRun: STOCK_SYMBOLS_PER_REFRESH_RUN,
      stockSymbolsSelected: selected.length,
      stockSymbolsRefreshed: refreshedStocks,
      stockSymbolsSkippedThisRun: skipped.length,
      stockSymbolsAttempted: outcome.stockFetch.attempted,
      haltedForRateLimit: outcome.stockFetch.haltedForRateLimit,
      lowestRateLimitRemainingSeen: outcome.stockFetch.lowestRemainingSeen,
      cyclesToCoverAllStocks: cyclesToCoverStocks(allStocks.length),
      refreshIntervalMinutes: REFRESH_INTERVAL_MINUTES,
      worstCaseStalenessMinutes: worstCaseStalenessMinutes(allStocks.length),
      oldestStockAfterRun: oldest,   // { symbol, lastUpdated, ageMinutes } — ageMinutes null = never priced
      // How many more distinct stock symbols fit before the worst case grows by one cycle.
      headroom: cyclesToCoverStocks(allStocks.length) * STOCK_SYMBOLS_PER_REFRESH_RUN - allStocks.length,
      // Counts
      updated: outcome.updated,
      failed: outcome.failed,
      productSymbols,
      productStockSymbolsNotAlreadyWatched: productStockSymbolsNew,
      productsSynced: productSync.synced,
      productsFlagged: productSync.flagged,
      productsCleared: productSync.cleared,
      via: auth.via
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
