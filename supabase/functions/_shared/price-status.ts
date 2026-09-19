// ★ Price status for client-facing reads (2026-09-19, register row 251).
//
// WHY THIS EXISTS. products.price_status ('ok' | 'quote_failed') and products.price_as_of were
// read by exactly four server modules — the refresh, the PM briefing, the PM catalog and
// product validation — and by NO client-facing function. get-returns-summary, get-holdings and
// get-portfolio-overview all built their figures on unit_price and carried no signal that a
// price was failed or old, so during the 19 Sep 2026 outage every crypto holder's dashboard
// showed a total labelled "Updated just now" whose crypto inputs had failed to price two hours
// earlier. That is register row 235's class — a failed read rendering as a normal value — on
// the most important figure in the product. This module is the one place the per-product
// status and the totals-level flag are derived, so the three functions cannot disagree.
//
// TWO DISTINCT CONDITIONS, never conflated:
//   failed  — price_status === 'quote_failed': the last refresh could not price this symbol and
//             unit_price is the LAST GOOD price, kept deliberately (market-refresh.ts).
//   stale   — a market-priced product whose price_as_of is older than the scheduler should
//             ever leave it: the round-robin worst case for the current stock union plus two
//             cycles of grace (row 202: ceil(stocks/30) x 5 min; a symbol older than that has
//             been skipped by at least one full rotation, which only happens when the refresh
//             itself is not running or is halting on the rate limit every cycle). Crypto is
//             refreshed as one batch every cycle, so a crypto price past the same threshold is
//             stale by the same arithmetic. A market product with NO price_as_of at all has
//             never been reached by a refresh ("awaiting refresh") and is stale by definition.
//   Appraisal-, fixed- and simulated-priced products are never stale or failed: an appraisal
//   moves only on a published NAV (row 143) and its priceAsOf is the last valuation date
//   (products.last_tick_date), which is the honest age of that figure, not a defect.
//
// The threshold is DERIVED from the live union size, not a constant: the catalog grew from 29
// to 330 products in one day (row 211) and a fixed number would have gone wrong that morning.
import { REFRESH_INTERVAL_MINUTES, worstCaseStalenessMinutes } from './market-providers.ts';

export type PriceStatus = 'ok' | 'quote_failed';

export interface PricedProductRow {
  id: string;
  name?: string;
  ticker?: string | null;
  pricing_model?: string | null;
  price_status?: string | null;
  price_as_of?: string | null;
  last_tick_date?: string | null;
  price_last_failed_at?: string | null;
}

export interface ProductPricing {
  pricingModel: string;                 // 'market' | 'appraisal' | 'fixed' | 'simulated'
  priceStatus: PriceStatus;             // products.price_status, defaulting to 'ok'
  priceAsOf: string | null;             // market: price_as_of; otherwise last_tick_date
  priceStale: boolean;                  // see the header; false for non-market products
  priceAgeMinutes: number | null;       // now - priceAsOf, for market products with a timestamp
}

export interface PricingSummary {
  positions: number;                    // held positions considered
  marketPriced: number;                 // of which market-priced
  failed: number;                       // quote_failed
  stale: number;                        // ok but older than the threshold (or never priced)
  affected: number;                     // failed + stale (a product is counted once)
  affectedValue: number;                // current value carried by affected positions
  oldestPriceAsOf: string | null;       // among market-priced held positions
  newestPriceAsOf: string | null;
  staleAfterMinutes: number;            // the threshold used, so the page can state it
  affectedProducts: Array<{ productId: string; name: string; ticker: string | null; status: 'failed' | 'stale'; priceAsOf: string | null; currentValue: number }>;
}

const GRACE_CYCLES = 2;

// The stock union the refresh rotates through IS the set of finnhub rows in market_data_cache
// (every product ticker and every watched stock gets a cache row on add — row 202), so its
// size is the worst-case input without re-deriving the union.
export async function staleAfterMinutes(admin: any): Promise<number> {
  const { count, error } = await admin
    .from('market_data_cache')
    .select('symbol', { count: 'exact', head: true })
    .eq('source', 'finnhub');
  if (error) throw new Error('Could not size the stock union: ' + error.message);
  return worstCaseStalenessMinutes(Number(count || 0)) + GRACE_CYCLES * REFRESH_INTERVAL_MINUTES;
}

export function productPricing(p: PricedProductRow, staleAfter: number, now: Date = new Date()): ProductPricing {
  const model = p.pricing_model || 'simulated';
  const status: PriceStatus = p.price_status === 'quote_failed' ? 'quote_failed' : 'ok';
  if (model !== 'market') {
    return { pricingModel: model, priceStatus: 'ok', priceAsOf: p.last_tick_date || null, priceStale: false, priceAgeMinutes: null };
  }
  const asOf = p.price_as_of || null;
  const age = asOf ? Math.max(0, (now.getTime() - new Date(asOf).getTime()) / 60000) : null;
  const stale = status === 'ok' && (age === null || age > staleAfter);
  return {
    pricingModel: model,
    priceStatus: status,
    priceAsOf: asOf,
    priceStale: stale,
    priceAgeMinutes: age === null ? null : Math.round(age * 10) / 10
  };
}

export function summarisePricing(
  rows: Array<{ product: PricedProductRow; currentValue: number }>,
  staleAfter: number,
  now: Date = new Date()
): PricingSummary {
  const out: PricingSummary = {
    positions: rows.length, marketPriced: 0, failed: 0, stale: 0, affected: 0, affectedValue: 0,
    oldestPriceAsOf: null, newestPriceAsOf: null, staleAfterMinutes: staleAfter, affectedProducts: []
  };
  for (const r of rows) {
    const pr = productPricing(r.product, staleAfter, now);
    if (pr.pricingModel !== 'market') continue;
    out.marketPriced++;
    if (pr.priceAsOf) {
      if (!out.oldestPriceAsOf || pr.priceAsOf < out.oldestPriceAsOf) out.oldestPriceAsOf = pr.priceAsOf;
      if (!out.newestPriceAsOf || pr.priceAsOf > out.newestPriceAsOf) out.newestPriceAsOf = pr.priceAsOf;
    }
    let status: 'failed' | 'stale' | null = null;
    if (pr.priceStatus === 'quote_failed') { out.failed++; status = 'failed'; }
    else if (pr.priceStale) { out.stale++; status = 'stale'; }
    if (status) {
      out.affected++;
      out.affectedValue = Math.round((out.affectedValue + r.currentValue) * 100) / 100;
      out.affectedProducts.push({
        productId: r.product.id, name: r.product.name || r.product.id, ticker: r.product.ticker || null,
        status, priceAsOf: pr.priceAsOf, currentValue: r.currentValue
      });
    }
  }
  return out;
}
