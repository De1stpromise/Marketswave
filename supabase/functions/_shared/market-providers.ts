// ★ Shared market-data provider access (2026-09-11) — the one place this project talks to
// Finnhub and CoinGecko. Used by refresh-market-data (the scheduled cache refresh),
// add-watchlist-symbol (validate a symbol genuinely exists before storing it),
// search-symbols (the Add-symbol search) and get-watchlist (a just-in-time top-up for a
// symbol the scheduler has not reached yet).
//
// ★ THE MEASURED FACTS THAT SHAPE EVERYTHING HERE — taken from real calls against the real
// free tiers before this file was written, not from documentation:
//
//   FINNHUB /quote IS ONE SYMBOL PER CALL, AND BATCHING FAILS SILENTLY.
//     /quote?symbol=AAPL,MSFT does not error. It returns {"c":0,"d":null,...} — a
//     well-formed response carrying a zero price. A batching "optimisation" here would
//     therefore write zeros into market_data_cache and every watchlist row would show
//     $0.00 with nothing anywhere reporting a failure. Never comma-join a Finnhub symbol.
//
//   FINNHUB'S FREE RATE LIMIT IS 60 REQUESTS PER MINUTE — read from a real response's own
//     X-Ratelimit-Limit header, not assumed. That is the budget the per-client symbol
//     ceiling is derived from (see PER_CLIENT_SYMBOL_LIMIT below).
//
//   COINGECKO /simple/price GENUINELY BATCHES. Five ids in one call returned all five.
//     Crypto therefore costs exactly one request regardless of how many coins are watched,
//     which is why the ceiling maths only ever counts DISTINCT STOCK symbols.
//
//   BOTH PROVIDERS' /search ENDPOINTS WORK ON THE FREE TIER. CoinGecko returns no rate
//     limit headers at all, so its budget cannot be measured the way Finnhub's can — the
//     conservative pacing below is the response to not knowing, not a measured figure.

export const FINNHUB_RATE_LIMIT_PER_MINUTE = 60;

// Half the per-minute budget is deliberately left unspent by the scheduled refresh. The
// same key serves interactive symbol search and add-symbol validation, which a client
// triggers at an unpredictable moment; a refresh that consumed the whole minute would make
// the search box fail exactly when someone is using it.
export const FINNHUB_REFRESH_BUDGET_PER_MINUTE = 30;

export const REFRESH_INTERVAL_MINUTES = 15;

// DERIVED, NOT GUESSED. Sustainable distinct stock symbols platform-wide is
//   FINNHUB_REFRESH_BUDGET_PER_MINUTE * REFRESH_INTERVAL_MINUTES = 30 * 15 = 450,
// because the refresh spends its whole cycle, not one minute of it, and one call covers one
// symbol for EVERY client watching it (the refresh works over the union of symbols, never
// per client). 25 per client would need 18 clients with zero overlap in their watchlists to
// reach 450; real overlap on the obvious names (SPY, BTC, AAPL) means the true number of
// clients supported is considerably higher. refresh-market-data reports the real distinct
// stock count on every run so the remaining headroom is observable rather than assumed.
export const PER_CLIENT_SYMBOL_LIMIT = 25;
export const PLATFORM_STOCK_SYMBOL_CEILING =
  FINNHUB_REFRESH_BUDGET_PER_MINUTE * REFRESH_INTERVAL_MINUTES;

// Live pricing, part 1 (2026-09-11): a provider's 429 is a distinct, transient condition a PM
// can act on ("try again in a minute") — surfaced as its own error class so callers return a
// clear 503 rather than a generic 500.
export class RateLimitedError extends Error {
  constructor(message: string) { super(message); this.name = 'RateLimitedError'; }
}

export interface Quote {
  price: number;
  changePercent: number | null;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  source: 'finnhub' | 'coingecko';
  assetType: 'stock' | 'crypto';
  providerId: string | null;
}

function finnhubKey(): string {
  const key = Deno.env.get('FINNHUB_API_KEY');
  if (!key) throw new Error('FINNHUB_API_KEY is not configured on this server.');
  return key;
}

// One symbol per call, by necessity (see the header). Concurrency is capped so a large
// refresh cannot burst past the per-minute limit in its first second — 6 at a time against
// a 30-per-minute budget leaves real headroom even if every request is fast.
const FINNHUB_CONCURRENCY = 6;

export async function fetchStockQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const key = finnhubKey();
  const out: Record<string, Quote> = {};
  const queue = symbols.slice();

  async function worker() {
    while (queue.length > 0) {
      const symbol = queue.shift()!;
      try {
        const quote = await fetchStockQuote(symbol, key);
        if (quote) out[symbol] = quote;
      } catch (_err) {
        // A single symbol failing must not abandon the other 24 — the row simply keeps its
        // previous cached price and last_updated, which the UI already renders honestly as
        // a delayed figure. refresh-market-data reports the failures it saw.
      }
    }
  }

  await Promise.all(new Array(Math.min(FINNHUB_CONCURRENCY, Math.max(1, symbols.length))).fill(0).map(worker));
  return out;
}

async function fetchStockQuote(symbol: string, key: string): Promise<Quote | null> {
  const res = await fetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol) + '&token=' + key);
  if (res.status === 429) throw new RateLimitedError('Finnhub is rate-limiting requests right now. Try again in a minute.');
  if (!res.ok) throw new Error('Finnhub quote for ' + symbol + ' failed: HTTP ' + res.status);
  const data = await res.json();
  if (data && data.error) throw new Error('Finnhub error for ' + symbol + ': ' + data.error);
  if (typeof data?.c !== 'number') throw new Error('Finnhub returned an unexpected shape for ' + symbol);
  // A real, genuinely unknown symbol comes back as c:0 rather than a 404 — the same
  // zero-shaped response a comma-joined batch produces. Treating 0 as "no such symbol" is
  // what stops a typo being stored as a permanently $0.00 watchlist row.
  if (data.c === 0) return null;
  return { price: data.c, changePercent: typeof data.dp === 'number' ? data.dp : null };
}

// Exposed separately from fetchStockQuotes so add-watchlist-symbol can distinguish
// "this symbol does not exist" (null) from "the provider is down" (throws).
export async function lookupStockQuote(symbol: string): Promise<Quote | null> {
  return await fetchStockQuote(symbol, finnhubKey());
}

// One call for every coin, always — CoinGecko's own batching, confirmed real.
export async function fetchCryptoQuotes(providerIds: string[]): Promise<Record<string, Quote>> {
  const ids = Array.from(new Set(providerIds.filter(Boolean)));
  if (ids.length === 0) return {};
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' +
    ids.map(encodeURIComponent).join(',') + '&vs_currencies=usd&include_24hr_change=true';
  const res = await fetch(url);
  if (res.status === 429) throw new RateLimitedError('CoinGecko is rate-limiting requests right now. Try again in a minute.');
  if (!res.ok) throw new Error('CoinGecko request failed: HTTP ' + res.status);
  const data = await res.json();
  const out: Record<string, Quote> = {};
  for (const id of ids) {
    const row = data?.[id];
    if (!row || typeof row.usd !== 'number') continue;
    out[id] = { price: row.usd, changePercent: typeof row.usd_24h_change === 'number' ? row.usd_24h_change : null };
  }
  return out;
}

export async function searchStocks(query: string): Promise<SymbolSearchResult[]> {
  const key = finnhubKey();
  const res = await fetch('https://finnhub.io/api/v1/search?q=' + encodeURIComponent(query) + '&exchange=US&token=' + key);
  if (!res.ok) throw new Error('Finnhub search failed: HTTP ' + res.status);
  const data = await res.json();
  const results: SymbolSearchResult[] = [];
  for (const item of data?.result || []) {
    // Finnhub's US search returns option/warrant lines and foreign listings alongside the
    // plain ticker; anything carrying a dot or a space is not a symbol /quote can price,
    // and offering an unpriceable row would produce a watchlist entry with no price.
    const symbol = String(item.displaySymbol || item.symbol || '').trim().toUpperCase();
    if (!symbol || /[^A-Z0-9.\-]/.test(symbol) || symbol.indexOf('.') !== -1) continue;
    if (item.type && ['Common Stock', 'ETP', 'ETF', 'ADR', 'REIT', 'Mutual Fund'].indexOf(String(item.type)) === -1) continue;
    results.push({
      symbol,
      name: String(item.description || symbol),
      source: 'finnhub',
      assetType: 'stock',
      providerId: null
    });
    if (results.length >= 8) break;
  }
  return results;
}

export async function searchCrypto(query: string): Promise<SymbolSearchResult[]> {
  const res = await fetch('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(query));
  if (!res.ok) throw new Error('CoinGecko search failed: HTTP ' + res.status);
  const data = await res.json();
  const results: SymbolSearchResult[] = [];
  for (const coin of data?.coins || []) {
    const symbol = String(coin.symbol || '').trim().toUpperCase();
    const id = String(coin.id || '');
    if (!symbol || !id) continue;
    results.push({
      symbol,
      name: String(coin.name || symbol),
      source: 'coingecko',
      assetType: 'crypto',
      providerId: id
    });
    if (results.length >= 6) break;
  }
  return results;
}

// Confirms a CoinGecko id genuinely prices, and returns its real display name — the crypto
// counterpart of lookupStockQuote(), used before a symbol is stored.
export async function lookupCrypto(providerId: string): Promise<{ name: string; symbol: string; quote: Quote } | null> {
  const res = await fetch('https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(providerId) +
    '?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('CoinGecko lookup failed: HTTP ' + res.status);
  const data = await res.json();
  const price = data?.market_data?.current_price?.usd;
  if (typeof price !== 'number') return null;
  return {
    name: String(data.name || providerId),
    symbol: String(data.symbol || providerId).toUpperCase(),
    quote: {
      price,
      changePercent: typeof data.market_data?.price_change_percentage_24h === 'number'
        ? data.market_data.price_change_percentage_24h
        : null
    }
  };
}
