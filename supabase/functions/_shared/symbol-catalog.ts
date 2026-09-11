// ★ THE SHARED SYMBOL -> PRODUCT PRIMITIVE (2026-09-11).
//
// "Is this symbol in the catalog?" is asked by the merged Market Snapshot + Watchlist (to
// decide whether a row gets a real Allocate action or reads "Tracking only"). The SAME
// mapping, read in the opposite direction, is what the live-priced product catalog work
// needs ("what does this catalog product currently trade at?"). They are one mapping, so
// it lives here once, backed by products.ticker, rather than being re-derived per feature.
//
// If you are implementing live-priced products: call productsWithTickers() to get every
// catalog product that has a real symbol, then read public.market_data_cache for those
// symbols. Do NOT add a second lookup table — extend this module.
//
// Deliberately a thin module over one column, not a cache: a PM can set or clear a ticker
// from admin-products.html at any moment, and a stale in-memory map would silently show a
// client an Allocate button for a product that no longer claims that symbol.

export interface CatalogMatch {
  productId: string;
  name: string;
  assetClass: string;
  minimumInvestment: number;
  unitPrice: number;
}

// Tickers are compared case-insensitively everywhere (the unique index on
// upper(ticker) enforces the same rule in the database), so every entry point normalises
// through this one function rather than each caller choosing its own .toUpperCase().
export function normalizeSymbol(symbol: unknown): string {
  return String(symbol ?? '').trim().toUpperCase();
}

// symbol -> CatalogMatch for the symbols that ARE in the catalog. A symbol with no
// matching product is simply absent from the returned map; callers treat absence as
// "tracking only" rather than as an error, because most real symbols a client watches
// genuinely are not products this firm offers.
export async function resolveSymbols(
  admin: any,
  symbols: string[]
): Promise<Record<string, CatalogMatch>> {
  const wanted = Array.from(new Set(symbols.map(normalizeSymbol).filter((s) => s.length > 0)));
  if (wanted.length === 0) return {};

  // Filtered in SQL by the same uppercase comparison the unique index uses, so a product
  // stored as "eth" still matches a watchlist row stored as "ETH".
  const { data, error } = await admin
    .from('products')
    .select('id, name, asset_class, minimum_investment, unit_price, ticker')
    .not('ticker', 'is', null);
  if (error) throw new Error('Could not read the product catalog: ' + error.message);

  const out: Record<string, CatalogMatch> = {};
  for (const row of data || []) {
    const ticker = normalizeSymbol(row.ticker);
    if (wanted.indexOf(ticker) === -1) continue;
    out[ticker] = {
      productId: row.id,
      name: row.name,
      assetClass: row.asset_class,
      minimumInvestment: Number(row.minimum_investment),
      unitPrice: Number(row.unit_price)
    };
  }
  return out;
}

// The reverse direction, for the live-priced product catalog work: every catalog product
// that genuinely carries a symbol. Returns [] rather than throwing when no product has a
// ticker yet — that is the honest state of a catalog whose PM has not mapped any product,
// not a failure.
export async function productsWithTickers(
  admin: any
): Promise<Array<CatalogMatch & { ticker: string }>> {
  const { data, error } = await admin
    .from('products')
    .select('id, name, asset_class, minimum_investment, unit_price, ticker')
    .not('ticker', 'is', null);
  if (error) throw new Error('Could not read the product catalog: ' + error.message);

  return (data || []).map((row: Record<string, unknown>) => ({
    ticker: normalizeSymbol(row.ticker),
    productId: row.id as string,
    name: row.name as string,
    assetClass: row.asset_class as string,
    minimumInvestment: Number(row.minimum_investment),
    unitPrice: Number(row.unit_price)
  }));
}

// Validation shared by add-product/edit-product. A ticker is optional; when present it
// must look like a real instrument symbol rather than free text, because it is the key a
// client's Allocate button resolves through.
export function validateTicker(ticker: unknown): string | null {
  if (ticker == null || ticker === '') return null;
  if (typeof ticker !== 'string') return 'ticker must be a string.';
  const normalized = normalizeSymbol(ticker);
  if (normalized.length > 12) return 'ticker must be 12 characters or fewer.';
  if (!/^[A-Z0-9.\-]+$/.test(normalized)) {
    return 'ticker may only contain letters, digits, dots and hyphens.';
  }
  return null;
}
