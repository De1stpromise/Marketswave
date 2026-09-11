// ★ Product catalog — live pricing, part 1 (2026-09-11).
//
// The PM creation flow's symbol search, admin-only. Two modes on one function:
//
//   { query }                        — search BOTH providers (the same searchStocks()/
//                                      searchCrypto() the client watchlist uses), then price
//                                      the results so a PM sees live figures before picking:
//                                      all crypto results in ONE CoinGecko call, and the top
//                                      STOCK_PRICE_LIMIT stock results one Finnhub call each.
//   { symbol, source, providerId }   — the pick: a fresh quote plus, for a stock, the exchange
//                                      from Finnhub's profile2.
//
// ★ THE EXCHANGE IS REPORTED HONESTLY OR NOT AT ALL. Finnhub's profile2 returns {} for ETFs on
// the free tier (confirmed directly: VT -> {}), so for those there is no verified exchange.
// The response carries `exchange` (a string) and `exchangeVerified` (a boolean): when
// profile2 gave nothing, exchange is 'US listing' and exchangeVerified is FALSE, and the UI
// renders that visibly as a fallback ("US listing · unverified") rather than as a confident
// label a PM might read as checked data. Crypto has no exchange; it carries 'Crypto'.
//
// Rate budget: a search costs 1 CoinGecko call + up to STOCK_PRICE_LIMIT Finnhub calls (the
// per-minute interactive budget is 30 — see market-providers.ts); a PM searching a handful
// of times a minute stays comfortably inside it, and the client-side debounce keeps each
// keystroke from being a search.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { searchStocks, searchCrypto, fetchStockQuotes, fetchCryptoQuotes, lookupStockQuote, lookupCrypto, SymbolSearchResult } from '../_shared/market-providers.ts';
import { resolveSymbols, normalizeSymbol } from '../_shared/symbol-catalog.ts';
import { assetClassForSource } from '../_shared/product-validation.ts';

const STOCK_PRICE_LIMIT = 4;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // ---- pick mode ----
    if (body && typeof body.symbol === 'string' && body.symbol) {
      const source = body.source;
      const symbol = normalizeSymbol(body.symbol);
      if (source !== 'finnhub' && source !== 'coingecko') return jsonResponse({ error: 'source must be finnhub or coingecko.' }, 400);
      const taken = await resolveSymbols(admin, [symbol]);
      if (source === 'coingecko') {
        const providerId = typeof body.providerId === 'string' ? body.providerId : '';
        if (!providerId) return jsonResponse({ error: 'providerId is required for a crypto symbol.' }, 400);
        const coin = await lookupCrypto(providerId);
        if (!coin) return jsonResponse({ error: 'CoinGecko returned no price for ' + providerId + '.' }, 404);
        return jsonResponse({
          symbol, name: coin.name, source, providerId, assetClass: assetClassForSource(source),
          price: coin.quote.price, changePercent: coin.quote.changePercent,
          exchange: 'Crypto', exchangeVerified: true,
          alreadyOffered: !!taken[symbol]
        }, 200);
      }
      const quote = await lookupStockQuote(symbol);
      if (!quote) return jsonResponse({ error: 'Finnhub returned no price for ' + symbol + ' (an unknown symbol comes back as a zero, which is refused).' }, 404);
      const exch = await stockExchange(symbol);
      return jsonResponse({
        symbol, name: typeof body.name === 'string' ? body.name : symbol, source, providerId: null, assetClass: assetClassForSource(source),
        price: quote.price, changePercent: quote.changePercent,
        exchange: exch || 'US listing', exchangeVerified: !!exch,
        alreadyOffered: !!taken[symbol]
      }, 200);
    }

    // ---- search mode ----
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (query.length < 1) return jsonResponse({ query: '', results: [], providerErrors: [] }, 200);

    const settled = await Promise.allSettled([searchStocks(query), searchCrypto(query)]);
    const providerErrors: string[] = [];
    let stocks: SymbolSearchResult[] = [];
    let cryptos: SymbolSearchResult[] = [];
    if (settled[0].status === 'fulfilled') stocks = settled[0].value; else providerErrors.push('Stock search is temporarily unavailable.');
    if (settled[1].status === 'fulfilled') cryptos = settled[1].value; else providerErrors.push('Crypto search is temporarily unavailable.');

    const exact = query.toUpperCase();
    const byExact = (a: SymbolSearchResult, b: SymbolSearchResult) => (a.symbol === exact ? 0 : 1) - (b.symbol === exact ? 0 : 1);
    stocks.sort(byExact);
    cryptos.sort(byExact);
    stocks = stocks.slice(0, STOCK_PRICE_LIMIT);
    cryptos = cryptos.slice(0, 6);

    const [stockQuotes, cryptoQuotes] = await Promise.all([
      stocks.length ? fetchStockQuotes(stocks.map((s) => s.symbol)).catch(() => ({})) : Promise.resolve({}),
      cryptos.length ? fetchCryptoQuotes(cryptos.map((c) => c.providerId as string)).catch(() => ({})) : Promise.resolve({})
    ]);

    const all = cryptos.concat(stocks).sort(byExact);
    const taken = await resolveSymbols(admin, all.map((r) => r.symbol));
    const results = all.map((r) => {
      const q = r.source === 'coingecko'
        ? (cryptoQuotes as Record<string, { price: number; changePercent: number | null }>)[r.providerId as string]
        : (stockQuotes as Record<string, { price: number; changePercent: number | null }>)[r.symbol];
      return {
        symbol: r.symbol, name: r.name, source: r.source, providerId: r.providerId,
        assetClass: assetClassForSource(r.source),
        price: q ? q.price : null, changePercent: q ? q.changePercent : null,
        // Search results never claim a verified exchange: that costs a profile2 call per row.
        // The pick step verifies the one the PM chooses.
        exchange: r.source === 'coingecko' ? 'Crypto' : 'US listing', exchangeVerified: r.source === 'coingecko',
        alreadyOffered: !!taken[r.symbol]
      };
    });
    return jsonResponse({ query, providerErrors, results }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Finnhub profile2: returns { exchange: "NASDAQ NMS - GLOBAL MARKET", ... } for a listed
// company and {} for an ETF on the free tier. Null means "not verified", never a guess.
async function stockExchange(symbol: string): Promise<string | null> {
  const key = Deno.env.get('FINNHUB_API_KEY');
  if (!key) return null;
  try {
    const res = await fetch('https://finnhub.io/api/v1/stock/profile2?symbol=' + encodeURIComponent(symbol) + '&token=' + key);
    if (!res.ok) return null;
    const data = await res.json();
    const exch = data && typeof data.exchange === 'string' && data.exchange.trim() ? data.exchange.trim() : null;
    if (!exch) return null;
    // "NASDAQ NMS - GLOBAL MARKET" -> "NASDAQ"; "NEW YORK STOCK EXCHANGE, INC." -> "NYSE".
    if (/NASDAQ/i.test(exch)) return 'NASDAQ';
    if (/NEW YORK STOCK EXCHANGE/i.test(exch)) return 'NYSE';
    if (/NYSE ARCA/i.test(exch)) return 'NYSE Arca';
    return exch.split(/[-,]/)[0].trim();
  } catch (_e) {
    return null;
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
