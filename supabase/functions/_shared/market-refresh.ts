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
