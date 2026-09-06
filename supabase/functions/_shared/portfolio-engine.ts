// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Faithful port of engine-core.js's NAV-tick settlement math, cost-basis math, and derived
// reads into TypeScript, shared by every portfolio Edge Function. "Faithful," not
// "reinterpreted": every function below is a line-for-line port of the real
// engine-core.js source (read directly before writing this file) — same formulas, same
// operator precedence, same rounding points. Ported into TypeScript/Deno rather than
// reimplemented in SQL/plpgsql specifically so the bitwise/32-bit-integer semantics
// (Math.imul, >>> 0 unsigned right shift) behave IDENTICALLY to the original — Deno runs
// V8, the same JS engine family as the browser this code originally ran in, so this is a
// verified-safe port, not a plausible-looking reimplementation. Stage 1's own
// verify-supabase-schema.js-style discipline applies here too: this module's own output is
// cross-checked against the REAL, unmodified engine-core.js source in
// scripts/verify-supabase-portfolio-engine.js, not just assumed equivalent from reading it.

// ---- Rounding — engine-core.js's round2() ------------------------------------------------
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Calendar-day string ('YYYY-MM-DD') in UTC — engine-core.js's formatDateUTC()/
// todayStrUTC(), avoids local-timezone/DST edge cases entirely, same as the original. ------
export function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function todayStrUTC(): string {
  return formatDateUTC(new Date());
}

// ---- Risk tier return config — engine-core.js's RISK_TIER_RETURN_CONFIG, byte-for-byte,
// including its own disclosed judgment call (Aggressive bundles Private Equity + Crypto
// under one volatility figure) — not revisited here, this stage ports the existing rule,
// it doesn't relitigate it. ------------------------------------------------------------
export const RISK_TIER_RETURN_CONFIG: Record<string, { annualReturnMean: number; annualVolatility: number }> = {
  conservative: { annualReturnMean: 0.06, annualVolatility: 0.04 },
  balanced: { annualReturnMean: 0.11, annualVolatility: 0.10 },
  aggressive: { annualReturnMean: 0.18, annualVolatility: 0.28 }
};

// ---- Seeded deterministic PRNG — engine-core.js's hashStringToSeed()/mulberry32()/
// seededStandardNormal(), byte-for-byte. Same product + same date -> same Z, always. -------
export function hashStringToSeed(str: string): number {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededStandardNormal(seedKey: string): number {
  const rng = mulberry32(hashStringToSeed(seedKey));
  let u1 = rng();
  if (u1 <= 0) u1 = 1e-9; // guard against log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---- Product row shape, matching the `products` table exactly (snake_case columns, as
// read from/written to Postgres) --------------------------------------------------------
export interface ProductRow {
  id: string;
  name: string;
  asset_class: string;
  investment_type: string;
  risk_tier: string;
  minimum_investment: number;
  unit_price: number;
  inception_unit_price: number;
  created_at: string;
  last_tick_date: string;
}

// ---- settleProduct() — engine-core.js's own function, ported line for line. Walks a
// single product's unit_price forward day-by-day (UTC calendar days) from its stored
// last_tick_date to today, applying one GBM log-return step per day:
//   dailyReturn = dailyMean - 0.5*dailyVariance + dailyVolatility*Z
//   newPrice    = oldPrice * exp(dailyReturn)
// Pure function — takes a product row, returns { unitPrice, lastTickDate, changed }; the
// caller (each Edge Function's own settleAllProducts() below) is responsible for actually
// persisting the result via service_role. Cash never ticks (par value, no riskTier
// volatility concept applies); products with an unrecognized riskTier are left untouched
// defensively rather than throwing — same as the original.
export function settleProduct(product: ProductRow): { unitPrice: number; lastTickDate: string; changed: boolean } {
  if (product.asset_class === 'Unallocated / Cash') {
    return { unitPrice: product.unit_price, lastTickDate: product.last_tick_date, changed: false };
  }
  // Backend Migration Phase D — NAV feature (2026-09-06): Private Equity / Real Assets are
  // carved out of the simulated tick entirely — their unit price only ever changes via a
  // real published NAV (see publish-nav), never this deterministic GBM mechanic, modeling
  // the real-world fact that an illiquid valuation stays flat between periodic appraisals.
  // Symmetric with the 'Unallocated / Cash' early return directly above — same shape, not a
  // new mechanism. Every caller of settleProduct() (settleAllProducts(), settleOneProduct())
  // inherits this for free; no call site needed to change.
  if (product.asset_class === 'Private Equity' || product.asset_class === 'Real Assets') {
    return { unitPrice: product.unit_price, lastTickDate: product.last_tick_date, changed: false };
  }
  const config = RISK_TIER_RETURN_CONFIG[product.risk_tier];
  if (!config) {
    return { unitPrice: product.unit_price, lastTickDate: product.last_tick_date, changed: false };
  }

  const dailyMean = config.annualReturnMean / 365;
  const dailyVolatility = config.annualVolatility / Math.sqrt(365);
  const dailyVariance = dailyVolatility * dailyVolatility;

  const today = todayStrUTC();
  const cursor = new Date(product.last_tick_date + 'T00:00:00Z');
  let price = product.unit_price;
  let ticked = false;

  while (formatDateUTC(cursor) < today) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dateStr = formatDateUTC(cursor);
    const z = seededStandardNormal(product.id + '|' + dateStr);
    const dailyReturn = dailyMean - 0.5 * dailyVariance + dailyVolatility * z;
    price = price * Math.exp(dailyReturn);
    ticked = true;
  }

  return { unitPrice: round2(price), lastTickDate: today, changed: ticked };
}

// ---- settleAllProducts() — reads every product row via the given (service_role) client,
// settles each via settleProduct() above, writes back only the ones that actually changed
// (lazy catch-up: a same-day call is a no-op for every product, exactly mirroring the local
// engine's "run once per engine load" philosophy — just triggered per Edge Function
// invocation instead of per page load, the one real architectural adaptation server-side
// statelessness requires; the settlement MATH itself is unchanged). Returns the full,
// now-current product list.
export async function settleAllProducts(supabaseAdmin: any): Promise<ProductRow[]> {
  const { data: products, error } = await supabaseAdmin.from('products').select('*');
  if (error) throw new Error('settleAllProducts: failed to read products: ' + error.message);

  const updated: ProductRow[] = [];
  for (const product of products as ProductRow[]) {
    const result = settleProduct(product);
    if (result.changed) {
      const { error: updateErr } = await supabaseAdmin
        .from('products')
        .update({ unit_price: result.unitPrice, last_tick_date: result.lastTickDate })
        .eq('id', product.id);
      if (updateErr) throw new Error('settleAllProducts: failed to update product ' + product.id + ': ' + updateErr.message);
      updated.push({ ...product, unit_price: result.unitPrice, last_tick_date: result.lastTickDate });
    } else {
      updated.push(product);
    }
  }
  return updated;
}

// ---- settleOneProduct() — reads and settles exactly ONE product via service_role, persists
// if changed, returns the current row. executeBuy()/executeSell() in the real engine call
// settleProduct(productId) for the SINGLE product being traded, not settleAllProducts() —
// this mirrors that precisely, since porting the wrong one would be a real behavior
// difference (a buy/sell would otherwise silently re-price every OTHER product too, which
// the original never does).
export async function settleOneProduct(supabaseAdmin: any, productId: string): Promise<ProductRow> {
  const { data: product, error } = await supabaseAdmin.from('products').select('*').eq('id', productId).single();
  if (error || !product) throw new Error('Unknown product: ' + productId);

  const result = settleProduct(product as ProductRow);
  if (result.changed) {
    const { error: updateErr } = await supabaseAdmin
      .from('products')
      .update({ unit_price: result.unitPrice, last_tick_date: result.lastTickDate })
      .eq('id', productId);
    if (updateErr) throw new Error('settleOneProduct: failed to update product ' + productId + ': ' + updateErr.message);
  }
  return { ...product, unit_price: result.unitPrice, last_tick_date: result.lastTickDate };
}

// ---- recomputeAllocatedCapital() — engine-core.js's own function, ported line for line:
// allocated_capital must always equal sum(holding.units * product.unitPrice). Takes the
// client's current holdings + the now-settled product list (avoids a redundant re-read),
// writes the result to account_state via service_role, and returns it.
export async function recomputeAllocatedCapital(
  supabaseAdmin: any,
  clientId: string,
  holdings: { product_id: string; units: number }[],
  products: ProductRow[]
): Promise<number> {
  const total = round2(
    holdings.reduce((sum, h) => {
      const product = products.find((p) => p.id === h.product_id);
      return sum + h.units * (product ? product.unit_price : 0);
    }, 0)
  );
  const { error } = await supabaseAdmin
    .from('account_state')
    .update({ allocated_capital: total, updated_at: new Date().toISOString() })
    .eq('client_id', clientId);
  if (error) throw new Error('recomputeAllocatedCapital: failed to update account_state: ' + error.message);
  return total;
}

// Dashboard Real-Data Fixes (2026-09-03). Extracted from get-total-portfolio-value/index.ts's
// own original inline logic — a genuine refactor, not a new computation: settle every
// product, recompute allocated_capital for the target client if they hold anything, then sum
// unallocated + allocated + assetReturns. Now shared by get-total-portfolio-value itself AND
// the new get-portfolio-monthly-change function (which needs the exact same "what is this
// client's real total portfolio value right now" figure to compare against a monthly anchor)
// — a single source of truth rather than two independently-maintained copies that could drift
// apart on a future change to the total-value formula.
export async function computeTotalPortfolioValue(supabaseAdmin: any, clientId: string): Promise<number> {
  const products = await settleAllProducts(supabaseAdmin);
  const { data: holdings } = await supabaseAdmin.from('holdings').select('product_id, units').eq('client_id', clientId);
  if (holdings && holdings.length > 0) {
    await recomputeAllocatedCapital(supabaseAdmin, clientId, holdings, products);
  }
  const { data: state, error } = await supabaseAdmin.from('account_state').select('*').eq('client_id', clientId).maybeSingle();
  if (error) throw new Error('computeTotalPortfolioValue: failed to read account_state: ' + error.message);
  if (!state) return 0;
  return state.unallocated_capital + state.allocated_capital + state.asset_returns;
}
