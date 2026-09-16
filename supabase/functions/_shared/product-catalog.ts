// ★ THE PM PRODUCT CATALOGUE, IN ONE READ (2026-09-16, PM tool revamp part 6).
//
// The catalogue is 331 products on a page that was built for five. This module answers the
// whole page in one call: every row, who holds it and for how much, its document state, and
// the health counts the strip needs.
//
// ★ IT REUSES THE EXISTING SOURCES RATHER THAN ADDING A SECOND ONE.
//   * settleAllProducts() (portfolio-engine.ts) settles the catalogue ONCE — the same
//     function every read path already goes through, so a price shown here is the price a
//     client sees, not a second derivation of it.
//   * Holder value is units x that same settled unit price, exactly as _shared/client-list.ts
//     computes a client's allocated figure. There is no second price lookup anywhere here.
//
// ★ EVERY READ IS ERROR-CHECKED. On this page an empty holder list and a failed holdings
// query look identical, and "nobody holds this" is the input to a retirement decision — so a
// swallowed error would hand a PM a false all-clear. Same finding as register row 233's own
// two empty panels; the `must()` wrapper below is why it cannot repeat here.
import { settleAllProducts, round2, type ProductRow } from './portfolio-engine.ts';
import { STOCK_SYMBOLS_PER_REFRESH_RUN } from './market-providers.ts';

type Admin = any;

// The scheduled refresh runs every 5 minutes and prices the N oldest stock symbols, so a
// symbol's worst-case age is ceil(stocks / N) x 5 minutes. A price older than that has
// genuinely missed its turn rather than merely waiting for it — which is the difference
// between "stale" and "normal" under a rotation (register row 202).
const REFRESH_INTERVAL_MINUTES = 5;
const STALE_MARGIN_MINUTES = 5;

function must(res: { data: any; error: any }, what: string): any {
  if (res.error) throw new Error('Could not read ' + what + ': ' + res.error.message);
  return res.data;
}

export function staleAfterMinutes(distinctStockSymbols: number): number {
  const cycles = Math.max(1, Math.ceil(distinctStockSymbols / STOCK_SYMBOLS_PER_REFRESH_RUN));
  return cycles * REFRESH_INTERVAL_MINUTES + STALE_MARGIN_MINUTES;
}

export async function buildProductCatalog(admin: Admin) {
  const now = Date.now();

  // ---- settle ONCE, the same call every client read path makes -------------------------
  const products: ProductRow[] = await settleAllProducts(admin);

  const holdings = must(
    await admin.from('holdings').select('client_id, product_id, units, cost_basis'),
    'holdings'
  );
  const clients = must(await admin.from('clients').select('id, name, email'), 'clients');
  const documents = must(
    await admin.from('product_documents').select('product_id, status, published_at, updated_at'),
    'product_documents'
  );

  const clientById: Record<string, any> = {};
  for (const c of clients) clientById[c.id] = c;

  const docByProduct: Record<string, any> = {};
  for (const d of documents) docByProduct[d.product_id] = d;

  // ---- holders per product -------------------------------------------------------------
  const holdersByProduct: Record<string, Array<{ clientId: string; name: string; units: number; value: number; costBasis: number }>> = {};
  const priceById: Record<string, number> = {};
  for (const p of products) priceById[p.id] = Number(p.unit_price);

  for (const h of holdings) {
    const price = priceById[h.product_id];
    if (price === undefined) continue; // a holding whose product is gone is a separate problem
    const c = clientById[h.client_id];
    (holdersByProduct[h.product_id] = holdersByProduct[h.product_id] || []).push({
      clientId: h.client_id,
      // A holding whose client row has been removed is real leftover state, not a person.
      name: c ? c.name : 'Unknown client',
      units: Number(h.units),
      value: round2(Number(h.units) * price),
      costBasis: round2(Number(h.cost_basis))
    });
  }
  for (const id of Object.keys(holdersByProduct)) {
    holdersByProduct[id].sort((a, b) => b.value - a.value);
  }

  // ---- the staleness threshold, derived from the real rotation --------------------------
  const distinctStockSymbols = new Set(
    products
      .filter((p: any) => p.pricing_model === 'market' && p.price_source === 'finnhub' && p.ticker)
      .map((p: any) => String(p.ticker).toUpperCase())
  ).size;
  const staleMinutes = staleAfterMinutes(distinctStockSymbols);
  const staleBefore = now - staleMinutes * 60000;

  const rows = products.map(function (p: any) {
    const holders = holdersByProduct[p.id] || [];
    const heldValue = round2(holders.reduce((s, h) => s + h.value, 0));
    const doc = docByProduct[p.id] || null;
    const isAppraisal = p.pricing_model === 'appraisal';
    const isMarket = p.pricing_model === 'market';
    const priceAsOfMs = p.price_as_of ? new Date(p.price_as_of).getTime() : null;

    return {
      id: p.id,
      name: p.name,
      assetClass: p.asset_class,
      investmentType: p.investment_type,
      riskTier: p.risk_tier,
      ticker: p.ticker || null,
      logoUrl: p.logo_url || null,
      description: p.description || null,
      extendedDescription: p.extended_description || null,
      minimumInvestment: Number(p.minimum_investment),
      maximumInvestment: p.maximum_investment == null ? null : Number(p.maximum_investment),
      unitPrice: Number(p.unit_price),
      inceptionUnitPrice: Number(p.inception_unit_price),
      createdAt: p.created_at,
      lastTickDate: p.last_tick_date,
      pricingModel: p.pricing_model,
      priceSource: p.price_source || null,
      priceAsOf: p.price_as_of || null,
      changePercent: p.price_change_percent == null ? null : Number(p.price_change_percent),
      priceStatus: p.price_status,
      priceFailureReason: p.price_failure_reason || null,
      priceLastFailedAt: p.price_last_failed_at || null,
      // ★ "stale" is only meaningful for a market-priced product. An appraisal product's
      // price is SUPPOSED to sit still between valuations; calling that stale would flag
      // every PE fund permanently. Its own overdue-ness is a NAV question, not a feed one.
      priceStale: !!(isMarket && p.price_status === 'ok' && (priceAsOfMs === null || priceAsOfMs < staleBefore)),
      status: p.status || 'active',
      retiredAt: p.retired_at || null,
      retiredReason: p.retired_reason || null,
      // Attribution is written and kept; it is deliberately NOT rendered (part 3's rule).
      holderCount: holders.length,
      heldValue,
      holders,
      document: doc ? { status: doc.status, publishedAt: doc.published_at, updatedAt: doc.updated_at } : null,
      // A fund document belongs to an appraisal-valued product; a market-priced tracker has
      // no fund behind it to document. Only the former can be "missing" one.
      documentApplicable: isAppraisal
    };
  });

  const strip = {
    total: rows.length,
    livePriced: rows.filter((r: any) => r.pricingModel === 'market' && r.priceStatus === 'ok' && !r.priceStale).length,
    priceStale: rows.filter((r: any) => r.priceStale).length,
    quoteFailed: rows.filter((r: any) => r.priceStatus === 'quote_failed').length,
    noLogo: rows.filter((r: any) => !r.logoUrl).length,
    noDocument: rows.filter((r: any) => r.documentApplicable && !r.document).length,
    appraisalTotal: rows.filter((r: any) => r.documentApplicable).length,
    retired: rows.filter((r: any) => r.status === 'retired').length,
    held: rows.filter((r: any) => r.holderCount > 0).length,
    staleAfterMinutes: staleMinutes,
    distinctStockSymbols
  };

  return { products: rows, strip };
}
