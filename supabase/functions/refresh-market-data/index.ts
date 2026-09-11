// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — THE SCHEDULED CACHE REFRESH.
//
// Runs every 15 minutes from pg_cron (see the migration's own scheduler section). This is
// what makes market_data_cache dynamic: it refreshes the UNION of
//   - the six base symbols the public homepage ticker is served from, always, whether or
//     not any client watches them; and
//   - every distinct symbol any client currently has on their watchlist.
//
// ★ THE UNION IS THE WHOLE POINT AND IT IS WHAT MAKES THE CEILING WORK. Ten clients
// watching SPY cost one Finnhub call, not ten. The refresh has no per-client loop anywhere,
// and adding one would silently multiply the provider cost by the client count.
//
// COST PER RUN, in the terms the free tiers actually charge in:
//   crypto  — exactly ONE CoinGecko call, no matter how many coins (it genuinely batches).
//   stocks  — one Finnhub call PER DISTINCT SYMBOL (it genuinely cannot batch; a
//             comma-joined request returns a zero price with HTTP 200 rather than failing).
// So distinct stock symbols is the only quantity that matters, which is why the reported
// headroom below counts those and nothing else.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeScheduledCall } from '../_shared/scheduler-auth.ts';
import { BASE_SYMBOLS, refreshSymbols, CacheEntry } from '../_shared/market-refresh.ts';
import { PLATFORM_STOCK_SYMBOL_CEILING } from '../_shared/market-providers.ts';
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

    const entries = Object.values(bySymbol);
    const outcome = await refreshSymbols(admin, entries);

    // Reported on every run so the remaining headroom against the derived ceiling is an
    // observable number rather than an assumption that was true when this was written.
    return jsonResponse({
      distinctSymbols: entries.length,
      distinctStockSymbols: outcome.stockSymbols,
      distinctCryptoSymbols: outcome.cryptoSymbols,
      stockSymbolCeiling: PLATFORM_STOCK_SYMBOL_CEILING,
      headroom: PLATFORM_STOCK_SYMBOL_CEILING - outcome.stockSymbols,
      updated: outcome.updated,
      failed: outcome.failed,
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
