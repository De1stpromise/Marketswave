// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — add one symbol to the caller's own
// watchlist.
//
// AUTHORIZATION: self-only. clientId comes from the caller's own verified JWT.
//
// WHY THIS IS AN EDGE FUNCTION RATHER THAN AN RLS-GATED INSERT (the pattern Documents uses
// for its own client writes): adding a symbol is not a bare row write. It has to
//   - confirm the symbol GENUINELY PRICES at a real provider, so a typo never becomes a
//     permanently blank row (Finnhub answers an unknown symbol with c:0 and HTTP 200, not
//     a 404 — an RLS check could not possibly catch that);
//   - take the real display name from the provider rather than whatever the caller typed;
//   - enforce the per-client ceiling, which exists to protect a shared, rate-limited
//     provider budget and therefore cannot be a client-side check;
//   - seed a price immediately so the new row renders with a figure, not a dash.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizeSymbol } from '../_shared/symbol-catalog.ts';
import { lookupStockQuote, lookupCrypto, PER_CLIENT_SYMBOL_LIMIT } from '../_shared/market-providers.ts';
import { refreshSymbols } from '../_shared/market-refresh.ts';

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

    const body = await req.json().catch(() => ({}));
    const symbol = normalizeSymbol(body?.symbol);
    const source = body?.source;
    const providerId = body?.providerId ? String(body.providerId) : null;

    if (!symbol) {
      return jsonResponse({ error: 'symbol is required.' }, 400);
    }
    if (source !== 'finnhub' && source !== 'coingecko') {
      return jsonResponse({ error: "source must be 'finnhub' or 'coingecko'." }, 400);
    }
    if (source === 'coingecko' && !providerId) {
      return jsonResponse({ error: 'providerId is required for a CoinGecko symbol.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: existingRows, error: readErr } = await admin
      .from('watchlist_symbols')
      .select('id, symbol')
      .eq('client_id', clientId);
    if (readErr) return jsonResponse({ error: readErr.message }, 500);

    const existing = existingRows || [];
    if (existing.some((r: { symbol: string }) => normalizeSymbol(r.symbol) === symbol)) {
      return jsonResponse({ error: symbol + ' is already on your watchlist.' }, 409);
    }
    if (existing.length >= PER_CLIENT_SYMBOL_LIMIT) {
      return jsonResponse({
        error: 'You can track up to ' + PER_CLIENT_SYMBOL_LIMIT + ' symbols. Remove one to add another.'
      }, 409);
    }

    // The real existence check — a live provider call, before anything is stored.
    let name: string;
    let assetType: 'stock' | 'crypto';
    let resolvedSymbol = symbol;
    let resolvedProviderId: string | null = null;

    if (source === 'coingecko') {
      let coin;
      try {
        coin = await lookupCrypto(providerId as string);
      } catch (err) {
        return jsonResponse({ error: 'Could not reach the market data provider. Please try again.' }, 502);
      }
      if (!coin) {
        return jsonResponse({ error: 'That coin could not be found or is not currently priced.' }, 400);
      }
      name = coin.name;
      resolvedSymbol = normalizeSymbol(coin.symbol);
      resolvedProviderId = providerId;
      assetType = 'crypto';
    } else {
      let quote;
      try {
        quote = await lookupStockQuote(symbol);
      } catch (err) {
        return jsonResponse({ error: 'Could not reach the market data provider. Please try again.' }, 502);
      }
      if (!quote) {
        return jsonResponse({ error: symbol + ' is not a symbol we can price.' }, 400);
      }
      // Finnhub's /quote carries no name, so the caller's own search result supplies it —
      // still not free text: search-symbols is the only thing that produces it, and it
      // comes straight from the provider's own search response.
      name = body?.name && String(body.name).trim() ? String(body.name).trim().slice(0, 120) : symbol;
      assetType = 'stock';
    }

    // Re-check the normalised symbol: a CoinGecko id can resolve to a ticker that differs
    // from what the caller sent, and that resolved ticker is what actually gets stored.
    if (resolvedSymbol !== symbol &&
        existing.some((r: { symbol: string }) => normalizeSymbol(r.symbol) === resolvedSymbol)) {
      return jsonResponse({ error: resolvedSymbol + ' is already on your watchlist.' }, 409);
    }

    const { data: inserted, error: insertErr } = await admin
      .from('watchlist_symbols')
      .insert({
        client_id: clientId,
        symbol: resolvedSymbol,
        name,
        source,
        provider_id: resolvedProviderId,
        asset_type: assetType
      })
      .select()
      .single();
    if (insertErr) {
      if ((insertErr.code || '') === '23505') {
        return jsonResponse({ error: resolvedSymbol + ' is already on your watchlist.' }, 409);
      }
      return jsonResponse({ error: insertErr.message }, 500);
    }

    // Price it now rather than leaving the row blank until the next scheduled refresh.
    // Best-effort: the row is genuinely added either way, and the card renders a dash for a
    // price it does not have yet rather than pretending to a number.
    try {
      await refreshSymbols(admin, [{
        symbol: resolvedSymbol,
        name,
        source,
        provider_id: resolvedProviderId,
        asset_type: assetType
      }]);
    } catch (_err) { /* see above */ }

    return jsonResponse({
      id: inserted.id,
      symbol: inserted.symbol,
      name: inserted.name,
      source: inserted.source,
      assetType: inserted.asset_type,
      count: existing.length + 1,
      limit: PER_CLIENT_SYMBOL_LIMIT
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
