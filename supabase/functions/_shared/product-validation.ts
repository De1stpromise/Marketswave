// Products Catalog Fix (2026-09-03). Shared by add-product/edit-product — a genuine single
// source of truth for the Product Catalog's validation rules, the same drift-prevention
// discipline `_shared/hys-engine.ts` (getHYSRate()/computeHysWithdrawalAmount()) and
// `_shared/portfolio-engine.ts` (round2() etc.) already established for other domains,
// applied here from the start rather than duplicated once across two files and cleaned up
// later. A faithful port of engine-core.js's own PRODUCT_ASSET_CLASSES/PRODUCT_RISK_TIERS/
// validateProductFields() — read that real source in full before writing this, not
// reinvented.

// The 5 locked asset classes from CLAUDE.md, minus a 6th "value" that was never meant to be
// one — 'Unallocated / Cash' is the catalog's synthetic representation of the Unallocated
// bucket (exactly one instance, seeded once, never meant to be multiplied), included here
// only because the local validateProductFields() itself accepts it (e.g. round-tripping the
// one existing Cash row through edit-product) — the admin UI's own Add form dropdown still
// excludes it, unchanged.
export const ASSET_CLASSES = ['Private Equity', 'Real Assets', 'Stocks & ETFs', 'Crypto', 'Unallocated / Cash'];
export const RISK_TIERS = ['conservative', 'balanced', 'aggressive'];

// Mirrors validateProductFields(fields) exactly — shared by add-product (validates the full
// new-product object, unitPrice checked separately via requireUnitPrice since it's the one
// field add-product needs but edit-product forbids) and edit-product (validates the MERGED
// existing+patch object, so a partial patch still gets full-object validation against a
// real, already-valid product rather than false-failing on untouched fields).
export function validateProductFields(fields: Record<string, unknown>, requireUnitPrice: boolean): string | null {
  if (!fields.name || !String(fields.name).trim()) {
    return 'Product name is required.';
  }
  if (ASSET_CLASSES.indexOf(fields.assetClass as string) === -1) {
    return 'assetClass must be one of: ' + ASSET_CLASSES.join(', ') + '.';
  }
  if (!fields.investmentType || !String(fields.investmentType).trim()) {
    return 'Investment type is required.';
  }
  if (RISK_TIERS.indexOf(fields.riskTier as string) === -1) {
    return 'riskTier must be one of: ' + RISK_TIERS.join(', ') + '.';
  }
  const minInv = fields.minimumInvestment as number;
  if (typeof minInv !== 'number' || !isFinite(minInv) || minInv < 0) {
    return 'minimumInvestment must be a non-negative number.';
  }
  // All three optional — undefined/null is fine (existing seeded products predate these
  // fields entirely), but if present, must actually be a string.
  if (fields.description != null && typeof fields.description !== 'string') {
    return 'description must be a string.';
  }
  if (fields.extendedDescription != null && typeof fields.extendedDescription !== 'string') {
    return 'extendedDescription must be a string.';
  }
  if (fields.logoUrl != null && typeof fields.logoUrl !== 'string') {
    return 'logoUrl must be a string.';
  }
  if (requireUnitPrice) {
    const unitPrice = fields.unitPrice as number;
    if (typeof unitPrice !== 'number' || !isFinite(unitPrice) || unitPrice <= 0) {
      return 'Starting unit price must be a positive number.';
    }
  }
  return null;
}

// The 8 fields edit-product may ever change — byte-for-byte the same list as
// engine-core.js's own PRODUCT_EDITABLE_FIELDS. unitPrice is deliberately absent: the
// returns engine's own deterministic tick mechanic is the only thing that should ever move
// a product's price, confirmed still true by reading editProduct()'s own current source
// before porting this rule, not assumed carried over from an earlier investigation.
// 'ticker' joined this list on 2026-09-11 (the merged Market Snapshot + Watchlist). It is
// genuinely editable — a real instrument can be delisted, renamed or re-ticketed, and a
// product mapped to the wrong symbol would put an Allocate button on the wrong row. Its
// own validation lives in _shared/symbol-catalog.ts alongside the mapping it feeds, not
// here, so the read side and the write side of products.ticker cannot drift apart.
// Product catalog — live pricing, part 1 (2026-09-11): `ticker` LEFT this list — the symbol
// is part of the pricing model, chosen at creation and immutable afterwards (a remapped
// symbol would silently re-price every holder). `maximumInvestment` joined it.
export const PRODUCT_EDITABLE_FIELDS = ['name', 'assetClass', 'investmentType', 'riskTier', 'minimumInvestment', 'maximumInvestment', 'description', 'extendedDescription', 'logoUrl'];

export const PRICING_MODELS = ['market', 'appraisal'];          // the two a PM can choose
export const APPRAISAL_ASSET_CLASSES = ['Private Equity', 'Real Assets'];

// Asset class is DERIVED from the symbol's provider, never chosen, so BTC can't be filed
// under Real Assets: Finnhub prices listed equities/ETFs, CoinGecko prices coins.
export function assetClassForSource(source: string): string | null {
  if (source === 'finnhub') return 'Stocks & ETFs';
  if (source === 'coingecko') return 'Crypto';
  return null;
}

export function validateMaximumInvestment(fields: Record<string, unknown>): string | null {
  const max = fields.maximumInvestment;
  if (max == null || max === '') return null;
  if (typeof max !== 'number' || !isFinite(max) || max <= 0) return 'maximumInvestment must be a positive number when given.';
  const min = typeof fields.minimumInvestment === 'number' ? fields.minimumInvestment : 0;
  if (max < min) return 'maximumInvestment must not be below minimumInvestment.';
  return null;
}

// Maps a real `products` row (snake_case columns) to the same camelCase shape
// getAllProducts()/getProduct()/addProduct()/editProduct() already return locally — so
// admin-products.html's own toast/error copy (`result.name + ' (' + result.id + ')'`) works
// unchanged against a real Edge Function response.
export function toProductClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    assetClass: row.asset_class,
    investmentType: row.investment_type,
    riskTier: row.risk_tier,
    minimumInvestment: row.minimum_investment,
    unitPrice: row.unit_price,
    inceptionUnitPrice: row.inception_unit_price,
    createdAt: row.created_at,
    lastTickDate: row.last_tick_date,
    description: row.description,
    extendedDescription: row.extended_description,
    logoUrl: row.logo_url,
    ticker: row.ticker,
    pricingModel: row.pricing_model,
    priceSource: row.price_source,
    providerId: row.provider_id,
    priceAsOf: row.price_as_of,
    priceChangePercent: row.price_change_percent,
    priceStatus: row.price_status,
    priceFailureReason: row.price_failure_reason,
    priceLastFailedAt: row.price_last_failed_at,
    maximumInvestment: row.maximum_investment,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    updatedBy: row.updated_by,
    updatedByEmail: row.updated_by_email
  };
}
