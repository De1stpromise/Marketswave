// ★ The one implementation of "go and get fresh prices for these symbols, and write them
// into market_data_cache" (2026-09-11). Shared by refresh-market-data (the scheduled run,
// over the union of everything anyone watches) and get-watchlist (a bounded top-up for a
// symbol added between two scheduled runs, so a brand-new row is never blank).
//
// Kept separate from _shared/market-providers.ts because that module is deliberately pure
// provider access with no database dependency — a future provider swap changes that file
// and not this one.
import { fetchStockQuotes, fetchCryptoQuotes, Quote } from './market-providers.ts';

export interface CacheEntry {
  symbol: string;
  name: string | null;
  source: 'finnhub' | 'coingecko';
  provider_id: string | null;
  asset_type: 'stock' | 'crypto';
}

export interface RefreshOutcome {
  requested: number;
  stockSymbols: number;
  cryptoSymbols: number;
  updated: number;
  failed: string[];
}

export const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

// The six symbols the card used to hardcode. They keep two jobs after this change:
//   - they are the DEFAULT watchlist a client starts with (editable from the first click —
//     the point of the merge is that this set is a starting position, not the feature);
//   - they are refreshed on every scheduled run whether or not anyone watches them,
//     because get-public-market-snapshot serves the homepage ticker out of exactly these
//     rows and an unwatched symbol going stale would quietly stop the ticker.
export const BASE_SYMBOLS: CacheEntry[] = [
  { symbol: 'SPY', name: 'S&P 500 ETF', source: 'finnhub', provider_id: null, asset_type: 'stock' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', source: 'finnhub', provider_id: null, asset_type: 'stock' },
  { symbol: 'DIA', name: 'Dow Jones ETF', source: 'finnhub', provider_id: null, asset_type: 'stock' },
  { symbol: 'BTC', name: 'Bitcoin', source: 'coingecko', provider_id: 'bitcoin', asset_type: 'crypto' },
  { symbol: 'ETH', name: 'Ethereum', source: 'coingecko', provider_id: 'ethereum', asset_type: 'crypto' },
  { symbol: 'SOL', name: 'Solana', source: 'coingecko', provider_id: 'solana', asset_type: 'crypto' }
];

export function isStale(lastUpdated: string | null | undefined, now = Date.now()): boolean {
  if (!lastUpdated) return true;
  return now - new Date(lastUpdated).getTime() >= CACHE_MAX_AGE_MS;
}

export async function refreshSymbols(admin: any, entries: CacheEntry[]): Promise<RefreshOutcome> {
  const stocks = entries.filter((e) => e.asset_type === 'stock');
  const cryptos = entries.filter((e) => e.asset_type === 'crypto' && e.provider_id);

  const outcome: RefreshOutcome = {
    requested: entries.length,
    stockSymbols: stocks.length,
    cryptoSymbols: cryptos.length,
    updated: 0,
    failed: []
  };
  if (entries.length === 0) return outcome;

  // One Finnhub call per stock (it cannot batch — see market-providers.ts), one CoinGecko
  // call for every coin at once. Run the two providers in parallel: one being slow or down
  // must not delay or fail the other.
  let stockQuotes: Record<string, Quote> = {};
  let cryptoQuotes: Record<string, Quote> = {};

  const results = await Promise.allSettled([
    stocks.length ? fetchStockQuotes(stocks.map((s) => s.symbol)) : Promise.resolve({}),
    cryptos.length ? fetchCryptoQuotes(cryptos.map((c) => c.provider_id as string)) : Promise.resolve({})
  ]);
  if (results[0].status === 'fulfilled') stockQuotes = results[0].value as Record<string, Quote>;
  else outcome.failed.push('finnhub: ' + String((results[0] as PromiseRejectedResult).reason));
  if (results[1].status === 'fulfilled') cryptoQuotes = results[1].value as Record<string, Quote>;
  else outcome.failed.push('coingecko: ' + String((results[1] as PromiseRejectedResult).reason));

  const nowIso = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];

  for (const entry of stocks) {
    const quote = stockQuotes[entry.symbol];
    if (!quote) {
      if (outcome.failed.indexOf(entry.symbol) === -1) outcome.failed.push(entry.symbol);
      continue;
    }
    rows.push(toRow(entry, quote, nowIso));
  }
  for (const entry of cryptos) {
    const quote = cryptoQuotes[entry.provider_id as string];
    if (!quote) {
      if (outcome.failed.indexOf(entry.symbol) === -1) outcome.failed.push(entry.symbol);
      continue;
    }
    rows.push(toRow(entry, quote, nowIso));
  }

  if (rows.length > 0) {
    const { error } = await admin.from('market_data_cache').upsert(rows, { onConflict: 'symbol' });
    if (error) throw new Error('Could not write market_data_cache: ' + error.message);
    outcome.updated = rows.length;
  }

  return outcome;
}

function toRow(entry: CacheEntry, quote: Quote, nowIso: string) {
  return {
    symbol: entry.symbol,
    value: quote.price,
    change_percent: quote.changePercent,
    source: entry.source,
    name: entry.name,
    provider_id: entry.provider_id,
    asset_type: entry.asset_type,
    last_updated: nowIso
  };
}

// ============================================================================
// ★ Product catalog — live pricing, part 1 (2026-09-11).
//
// A market-priced product's unit_price IS the market price of its ticker. Two paths keep
// that true, and both live here so they cannot drift apart:
//
//   1. productCacheEntries() — the product tickers the SCHEDULED REFRESH must cover. It is
//      unioned with the base symbols and every client's watchlist inside refresh-market-data,
//      keyed on symbol, so a product and a watchlist row sharing BTC still cost one call.
//      Products on Finnhub count toward the same 450-distinct-stock ceiling; the refresh
//      reports the product share separately so the accounting stays observable.
//
//   2. readThroughMarketPrice() — called by settleAllProducts()/settleOneProduct() for every
//      market-priced product. It copies the cache's current value onto the product row only
//      when the cache is NEWER than the price already on the row, which means every existing
//      settlement caller — get-holdings, get-account-state, computeTotalPortfolioValue, and
//      execute-buy/execute-sell behind approve-allocation/approve-sell — re-reads the latest
//      market price at the moment it runs. An allocation approved an hour after it was
//      requested therefore executes at the approval-time price, never the request's figure.
//
// ★ A ZERO PRICE IS NOT A STALE PRICE, AND IT NEVER OVERWRITES A GOOD ONE. The provider layer
// already turns Finnhub's {"c":0} into "no quote" (market-providers.ts), so a zero never
// reaches market_data_cache. syncMarketPricedProducts() is the second half: a product whose
// symbol the refresh could not price is marked price_status = 'quote_failed' with the reason
// and the time — its unit_price keeps the last known good value — and is marked 'ok' again
// the moment a real quote lands. The PM sees the flag on admin-products.html; the client
// keeps seeing the last good price with its honest timestamp.
// ============================================================================

export interface MarketPricedProductRow {
  id: string;
  ticker: string | null;
  name: string;
  pricing_model: string;
  price_source: 'finnhub' | 'coingecko' | null;
  provider_id: string | null;
  unit_price: number;
  price_as_of: string | null;
  price_status?: string;
}

export function productToCacheEntry(p: MarketPricedProductRow): CacheEntry | null {
  if (p.pricing_model !== 'market' || !p.ticker || !p.price_source) return null;
  return {
    symbol: String(p.ticker).trim().toUpperCase(),
    name: p.name,
    source: p.price_source,
    provider_id: p.price_source === 'coingecko' ? p.provider_id : null,
    asset_type: p.price_source === 'coingecko' ? 'crypto' : 'stock'
  };
}

export async function productCacheEntries(admin: any): Promise<CacheEntry[]> {
  const { data, error } = await admin
    .from('products')
    .select('id, ticker, name, pricing_model, price_source, provider_id, unit_price, price_as_of')
    .eq('pricing_model', 'market');
  if (error) throw new Error('Could not read market-priced products: ' + error.message);
  const out: CacheEntry[] = [];
  for (const row of (data || []) as MarketPricedProductRow[]) {
    const entry = productToCacheEntry(row);
    if (entry) out.push(entry);
  }
  return out;
}

// Copies the cache price onto one product row if (and only if) the cache is newer than the
// price the row already carries. Returns the row's current unit price either way. A missing
// cache row (a symbol the refresh has not reached yet) leaves the product exactly as it is —
// that is the "awaiting refresh" state, not an error.
export async function readThroughMarketPrice(admin: any, product: MarketPricedProductRow): Promise<{ unitPrice: number; priceAsOf: string | null; changePercent: number | null; changed: boolean }> {
  const symbol = String(product.ticker || '').trim().toUpperCase();
  const current = { unitPrice: Number(product.unit_price), priceAsOf: product.price_as_of, changePercent: null as number | null, changed: false };
  if (product.pricing_model !== 'market' || !symbol) return current;

  const { data: cached, error } = await admin
    .from('market_data_cache')
    .select('value, change_percent, last_updated')
    .eq('symbol', symbol)
    .maybeSingle();
  if (error) throw new Error('Could not read market_data_cache for ' + symbol + ': ' + error.message);
  if (!cached || !(Number(cached.value) > 0)) return current;
  const cacheTime = new Date(cached.last_updated).getTime();
  const rowTime = product.price_as_of ? new Date(product.price_as_of).getTime() : 0;
  if (cacheTime <= rowTime) return current;

  const { error: updateErr } = await admin
    .from('products')
    .update({
      unit_price: Number(cached.value),
      price_as_of: cached.last_updated,
      price_change_percent: cached.change_percent == null ? null : Number(cached.change_percent),
      price_status: 'ok',
      price_failure_reason: null
    })
    .eq('id', product.id);
  if (updateErr) throw new Error('Could not sync market price onto ' + product.id + ': ' + updateErr.message);
  return { unitPrice: Number(cached.value), priceAsOf: cached.last_updated, changePercent: cached.change_percent == null ? null : Number(cached.change_percent), changed: true };
}

// After a refresh: sync every market-priced product from the cache, and flag the ones whose
// symbol could not be priced. `failed` is refreshSymbols()'s own list (symbols and provider
// messages); a product is flagged when its own symbol is in it.
export async function syncMarketPricedProducts(
  admin: any,
  failed: string[]
): Promise<{ synced: number; flagged: string[]; cleared: string[] }> {
  const { data, error } = await admin
    .from('products')
    .select('id, ticker, name, pricing_model, price_source, provider_id, unit_price, price_as_of, price_status')
    .eq('pricing_model', 'market');
  if (error) throw new Error('Could not read market-priced products: ' + error.message);

  const failedSymbols = new Set(failed.map((f) => String(f).trim().toUpperCase()));
  // A provider-level failure (refreshSymbols() records it as 'finnhub: ...' / 'coingecko: ...')
  // is a different situation from a symbol the provider does not know: it is transient (a
  // rate limit, an outage) and the reason should say so, so a PM does not go hunting for a
  // typo in a ticker that was fine ten minutes ago.
  const providerFailure: Record<string, string> = {};
  for (const f of failed) {
    const m = /^(finnhub|coingecko):\s*(.*)$/i.exec(String(f));
    if (m) providerFailure[m[1].toLowerCase()] = m[2];
  }
  const result = { synced: 0, flagged: [] as string[], cleared: [] as string[] };
  for (const row of (data || []) as MarketPricedProductRow[]) {
    const symbol = String(row.ticker || '').trim().toUpperCase();
    if (failedSymbols.has(symbol)) {
      const providerMsg = row.price_source ? providerFailure[row.price_source] : undefined;
      const reason = providerMsg
        ? (row.price_source === 'coingecko' ? 'CoinGecko' : 'Finnhub') + ' could not be reached on the last refresh (' + providerMsg.slice(0, 160) + '). This is a provider-side failure, not a problem with the symbol; the last known good price is retained and the flag clears on the next successful refresh.'
        : 'The provider returned no usable price for ' + symbol + ' on the last refresh — for Finnhub that is what an unknown symbol looks like (a zero with HTTP 200). The last known good price is retained.';
      const { error: flagErr } = await admin
        .from('products')
        .update({
          price_status: 'quote_failed',
          price_failure_reason: reason,
          price_last_failed_at: new Date().toISOString()
        })
        .eq('id', row.id);
      if (flagErr) throw new Error('Could not flag ' + row.id + ': ' + flagErr.message);
      result.flagged.push(row.id);
      continue;
    }
    const outcome = await readThroughMarketPrice(admin, row);
    if (outcome.changed) {
      result.synced++;
      if (row.price_status === 'quote_failed') result.cleared.push(row.id);
    }
  }
  return result;
}
