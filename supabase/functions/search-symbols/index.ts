// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — the Add-symbol search.
//
// Searches BOTH providers on every query and merges the results, because a client typing
// "eth" means either Ethereum or one of several real ETFs and has no reason to know which
// provider owns which. Every result is marked with its real source AND with whether it is
// a catalog product, so the badge on a search row means exactly what the same badge means
// on a watchlist row.
//
// AUTHORIZATION: any signed-in client. Deliberately NOT public, unlike
// get-public-market-snapshot: this one spends real Finnhub rate-limit budget per call, and
// an unauthenticated endpoint doing that is a way to have the whole platform's market data
// go stale from outside.
//
// One provider failing does not fail the search — the other provider's results are still
// genuinely useful, and reporting "search is down" when half of it works would be false.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { searchStocks, searchCrypto, SymbolSearchResult } from '../_shared/market-providers.ts';
import { resolveSymbols } from '../_shared/symbol-catalog.ts';

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

    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (query.length < 1) {
      return jsonResponse({ query: '', results: [], providerErrors: [] }, 200);
    }

    const settled = await Promise.allSettled([searchStocks(query), searchCrypto(query)]);
    const providerErrors: string[] = [];
    const results: SymbolSearchResult[] = [];

    if (settled[0].status === 'fulfilled') results.push(...settled[0].value);
    else providerErrors.push('Stock search is temporarily unavailable.');
    if (settled[1].status === 'fulfilled') results.push(...settled[1].value);
    else providerErrors.push('Crypto search is temporarily unavailable.');

    // Crypto first when the query looks like a coin ticker match, otherwise provider order.
    // Kept simple deliberately: a heavier relevance model here would be guesswork dressed
    // up as ranking, and both providers already order their own results by relevance.
    const exact = query.toUpperCase();
    results.sort((a, b) => {
      const aExact = a.symbol === exact ? 0 : 1;
      const bExact = b.symbol === exact ? 0 : 1;
      return aExact - bExact;
    });

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const catalog = await resolveSymbols(admin, results.map((r) => r.symbol));

    return jsonResponse({
      query,
      providerErrors,
      results: results.slice(0, 10).map((r) => ({
        symbol: r.symbol,
        name: r.name,
        source: r.source,
        assetType: r.assetType,
        providerId: r.providerId,
        offered: !!catalog[r.symbol]
      }))
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
