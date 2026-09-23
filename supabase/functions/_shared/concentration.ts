// ★ Concentration signal — one definition, shared by the PM briefing and the client dashboard
// (2026-09-19, register row 251).
//
// The PM briefing has flagged "one holding ≥ 40% of total portfolio value, TPV ≥ $10k" since
// row 221. The client dashboard's Risk metrics card now shows the same "Largest position" row,
// and the two must agree on the arithmetic or a client is told their portfolio is fine while
// their PM is told it is concentrated. The constants therefore live here and pm-briefing.ts
// re-exports them; `largestPosition()` is the one computation.
//
// Share is measured against TOTAL PORTFOLIO VALUE = unallocated + allocated. Realised gains are
// NOT a separate term (row 264): a sale credits its full proceeds to unallocated_capital, and
// account_state.asset_returns is a reported lifetime tally that is never summed into a value.
// Adding it here would inflate the denominator and understate every share — which is exactly
// what get-returns-summary did for a week, breaking the agreement this file exists to keep.
// `shareOfHeld` (against deployed capital only) is carried alongside for the class-mix reading.

export const CONCENTRATION_SHARE = 0.40;
export const CONCENTRATION_MIN_TPV = 10000;

export interface PositionValue { productId: string; name: string; ticker?: string | null; assetClass?: string; currentValue: number; }

export interface LargestPosition {
  productId: string;
  name: string;
  ticker: string | null;
  assetClass: string | null;
  currentValue: number;
  shareOfPortfolio: number | null;   // currentValue / tpv, null when tpv is 0
  shareOfHeld: number | null;        // currentValue / Σ held value, null when nothing is held
  concentrated: boolean;             // shareOfPortfolio ≥ CONCENTRATION_SHARE and tpv ≥ CONCENTRATION_MIN_TPV
  threshold: number;                 // CONCENTRATION_SHARE, so a page can state the rule it is applying
  minTpv: number;                    // CONCENTRATION_MIN_TPV
}

export function largestPosition(positions: PositionValue[], tpv: number): LargestPosition | null {
  if (!positions.length) return null;
  const held = positions.reduce((s, p) => s + p.currentValue, 0);
  const top = positions.slice().sort((a, b) => b.currentValue - a.currentValue)[0];
  const shareOfPortfolio = tpv > 0 ? top.currentValue / tpv : null;
  return {
    productId: top.productId,
    name: top.name,
    ticker: top.ticker || null,
    assetClass: top.assetClass || null,
    currentValue: top.currentValue,
    shareOfPortfolio,
    shareOfHeld: held > 0 ? top.currentValue / held : null,
    concentrated: shareOfPortfolio !== null && tpv >= CONCENTRATION_MIN_TPV && shareOfPortfolio >= CONCENTRATION_SHARE,
    threshold: CONCENTRATION_SHARE,
    minTpv: CONCENTRATION_MIN_TPV
  };
}
