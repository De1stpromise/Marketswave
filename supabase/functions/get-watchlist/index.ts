// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — the card's single read.
//
// Returns everything one render of the card needs in one round trip: the client's own
// watched symbols, each with its cached price, whether it is a catalog product (which
// decides Offered vs Tracking only, and therefore whether the row carries a real Allocate
// action), and its one active price alert if it has one.
//
// AUTHORIZATION: self-only. clientId always comes from the caller's own verified JWT, never
// from the request body — there is no "read someone else's watchlist" shape here at all.
//
// TWO THINGS THIS DOES BESIDES READING, both deliberate:
//   1. SEEDS THE DEFAULTS on a client's genuinely first call. The six symbols the card used
//      to hardcode become that client's starting watchlist, editable from the first click.
//      Guarded on "this client has never had a row" rather than "has no rows now", so a
//      client who deliberately empties their watchlist gets the honest empty state instead
//      of having the six silently reappear on the next page load.
//   2. TOPS UP symbols that have NO cache row at all — never merely stale ones. Since the
//      round-robin refresh (2026-09-12) a price older than 15 minutes is a normal state, not
//      a gap: the scheduler prices the oldest N stocks each cycle and the card labels the
//      rest as delayed. Topping up "stale" here would turn every dashboard load into up to
//      25 Finnhub calls, unbounded by client count — the exact spend the rotation exists to
//      bound. A missing row is different (add-watchlist-symbol writes one on add, so this is
//      the rare recovery case), and it stays bounded to this client's own symbols.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { resolveSymbols, normalizeSymbol } from '../_shared/symbol-catalog.ts';
import { BASE_SYMBOLS, refreshSymbols, CacheEntry } from '../_shared/market-refresh.ts';
import { PER_CLIENT_SYMBOL_LIMIT } from '../_shared/market-providers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }
    const clientId = claimsData.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceRoleKey);

    let { data: rows, error: readErr } = await admin
      .from('watchlist_symbols')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    if (readErr) return jsonResponse({ error: readErr.message }, 500);

    if ((rows || []).length === 0) {
      const seeded = await seedDefaultsIfNeverSeeded(admin, clientId);
      if (seeded) {
        const reread = await admin
          .from('watchlist_symbols')
          .select('*')
          .eq('client_id', clientId)
          .order('created_at', { ascending: true });
        if (reread.error) return jsonResponse({ error: reread.error.message }, 500);
        rows = reread.data;
      }
    }

    const watched = rows || [];
    const symbols = watched.map((r: Record<string, unknown>) => normalizeSymbol(r.symbol));

    const { data: cacheRows, error: cacheErr } = symbols.length
      ? await admin.from('market_data_cache').select('*').in('symbol', symbols)
      : { data: [], error: null };
    if (cacheErr) return jsonResponse({ error: cacheErr.message }, 500);

    const cacheBySymbol: Record<string, Record<string, unknown>> = {};
    for (const row of cacheRows || []) cacheBySymbol[row.symbol as string] = row;

    // Top-up: only the rows this client watches that have no cache row at all (see header).
    const staleEntries: CacheEntry[] = watched
      .filter((r: Record<string, unknown>) => !cacheBySymbol[normalizeSymbol(r.symbol)])
      .map((r: Record<string, unknown>) => ({
        symbol: normalizeSymbol(r.symbol),
        name: r.name as string,
        source: r.source as 'finnhub' | 'coingecko',
        provider_id: (r.provider_id as string) || null,
        asset_type: r.asset_type as 'stock' | 'crypto'
      }));

    let refreshed = 0;
    if (staleEntries.length > 0) {
      try {
        const outcome = await refreshSymbols(admin, staleEntries);
        refreshed = outcome.updated;
        if (outcome.updated > 0) {
          const reread = await admin.from('market_data_cache').select('*').in('symbol', symbols);
          for (const row of reread.data || []) cacheBySymbol[row.symbol as string] = row;
        }
      } catch (_err) {
        // A provider being unreachable must not blank the card — every row still renders
        // from whatever the cache last held, which the "Delayed" label already describes.
      }
    }

    const catalog = await resolveSymbols(admin, symbols);

    const { data: alerts, error: alertErr } = await admin
      .from('price_alerts')
      .select('*')
      .eq('client_id', clientId)
      .eq('status', 'active');
    if (alertErr) return jsonResponse({ error: alertErr.message }, 500);

    const alertBySymbolId: Record<string, Record<string, unknown>> = {};
    for (const a of alerts || []) alertBySymbolId[a.watchlist_symbol_id as string] = a;

    return jsonResponse({
      limit: PER_CLIENT_SYMBOL_LIMIT,
      count: watched.length,
      refreshed,
      symbols: watched.map((r: Record<string, unknown>) => {
        const symbol = normalizeSymbol(r.symbol);
        const cached = cacheBySymbol[symbol];
        const offered = catalog[symbol] || null;
        const alert = alertBySymbolId[r.id as string] || null;
        return {
          id: r.id,
          symbol,
          name: r.name,
          source: r.source,
          assetType: r.asset_type,
          price: cached ? Number(cached.value) : null,
          changePercent: cached && cached.change_percent != null ? Number(cached.change_percent) : null,
          lastUpdated: cached ? cached.last_updated : null,
          offered: offered
            ? {
                productId: offered.productId,
                productName: offered.name,
                minimumInvestment: offered.minimumInvestment
              }
            : null,
          alert: alert
            ? {
                id: alert.id,
                direction: alert.direction,
                targetPrice: Number(alert.target_price)
              }
            : null
        };
      })
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// "Never seeded" is a real stamp on the client row (clients.watchlist_seeded_at), not
// "has zero rows right now" — a client who deliberately empties their watchlist must get
// the honest empty state rather than watch the six defaults silently reappear.
//
// A caller with no clients row at all (a bare auth user, which only happens in test
// fixtures — every real client is created with one) has nowhere to carry the stamp, so it
// falls back to seed-when-empty. Stated plainly rather than papered over: for that caller
// only, emptying the watchlist does re-seed on the next read.
async function seedDefaultsIfNeverSeeded(admin: any, clientId: string): Promise<boolean> {
  const { data: seedMarker, error: markerErr } = await admin
    .from('clients')
    .select('watchlist_seeded_at')
    .eq('id', clientId)
    .maybeSingle();
  if (markerErr) throw new Error(markerErr.message);
  if (seedMarker && seedMarker.watchlist_seeded_at) return false;

  const { error: insertErr } = await admin.from('watchlist_symbols').insert(
    BASE_SYMBOLS.map((s) => ({
      client_id: clientId,
      symbol: s.symbol,
      name: s.name,
      source: s.source,
      provider_id: s.provider_id,
      asset_type: s.asset_type
    }))
  );
  if (insertErr) throw new Error(insertErr.message);

  await admin.from('clients').update({ watchlist_seeded_at: new Date().toISOString() }).eq('id', clientId);
  return true;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
