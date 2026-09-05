// Backend Migration Phase B — Stage 4 (2026-09-02).
//
// Faithful port of engine-core.js's HYS rate schedule and withdrawal-amount calculation —
// read that source in full before writing this file, not reinvented. Kept in its own shared
// module, separate from portfolio-engine.ts, mirroring the real local engine's own physical
// separation (the "---- HYS Deposit Approval Queue ----" / "---- HYS Withdrawal Approval
// Queue ----" sections are a distinct block within engine-core.js, not folded into the
// settlement-math code above them).
//
// Single-source-of-truth discipline, carried forward from the local engine's own Backend
// Requirements Register row 34 fix (Aug 23, 2026): both request-hys-deposit and
// credit-hys-deposit import getHysRate() from here rather than each keeping their own copy
// of the rate tables — the exact drift risk row 34 closed once already on the local side.

// ---- Rate tables — byte-for-byte HYS_SHORT_TERM_BRACKETS / HYS_LOCKED_RATES. --------------
const HYS_SHORT_TERM_BRACKETS = [
  { max: 2, rate: 5 }, { max: 4, rate: 7 }, { max: 6, rate: 8.5 },
  { max: 8, rate: 9.5 }, { max: 10, rate: 10.5 }, { max: 12, rate: 12 }
];
const HYS_LOCKED_RATES: Record<number, number> = { 1: 14, 2: 16, 3: 17.5, 4: 19, 5: 20 };

function hysShortTermRate(months: number): number {
  const bracket = HYS_SHORT_TERM_BRACKETS.find((b) => months <= b.max);
  return bracket ? bracket.rate : HYS_SHORT_TERM_BRACKETS[HYS_SHORT_TERM_BRACKETS.length - 1].rate;
}

// termMode: 'short' (termValue = months, 1-12) or 'locked' (termValue = years, 1-5) — same
// signature and validation as the real getHYSRate(termMode, termValue).
export function getHysRate(termMode: string, termValue: number): number {
  if (termMode === 'short') {
    if (!Number.isInteger(termValue) || termValue < 1 || termValue > 12) {
      throw new Error('Short-term months must be an integer between 1 and 12.');
    }
    return hysShortTermRate(termValue);
  }
  if (termMode === 'locked') {
    if (!Number.isInteger(termValue) || termValue < 1 || termValue > 5) {
      throw new Error('Locked-term years must be an integer between 1 and 5.');
    }
    return HYS_LOCKED_RATES[termValue];
  }
  throw new Error('termMode must be either "short" or "locked".');
}

// ---- computeHysWithdrawalAmount() — byte-for-byte port of computeHYSWithdrawalAmount(pocket):
// an As-You-Want pocket always returns its own balance; a Fixed Deposit pocket still 'active'
// (not yet matured) forfeits its projected_interest on early withdrawal, a matured one does
// not. Takes the real stored pocket row (snake_case, as read from Postgres) — never trusted
// from the caller, same discipline as every other money-math function in this project.
//
// ★ Deliberately UNCHANGED by the maturity-transition fix below (Backend Requirements Register
// row 124, 2026-09-03) — this stays a faithful, byte-for-byte port of the real local
// computeHYSWithdrawalAmount(pocket), which never needed maturity-awareness of its own (the
// local engine's own updatePocketStatuses() self-heals `status` in localStorage BEFORE this is
// ever called). The equivalent real-Supabase self-heal is request-hys-withdrawal/index.ts's own
// explicit call to resolveEffectivePocketStatus() below, applied to `pocket.status` BEFORE
// calling this function — so this function always receives an already-correct status, exactly
// mirroring the local engine's own call order, rather than this function silently
// reinterpreting a caller's raw input.
export function computeHysWithdrawalAmount(pocket: { pocket_type: string; status: string; amount: number; projected_interest: number }): number {
  if (pocket.pocket_type === 'ayw') return round2(pocket.amount);
  const forfeit = pocket.status === 'active';
  return forfeit ? round2(pocket.amount) : round2(pocket.amount + pocket.projected_interest);
}

// ---- resolveEffectivePocketStatus() — closes the real gap disclosed in UI Wiring Stage 4 /
// Phase B Stage 4 (Backend Requirements Register row 124, 2026-09-03): nothing previously
// transitioned a real hys_pockets row from 'active' to 'matured' once its maturity_date passed
// (the local engine's own equivalent, updatePocketStatuses(), is a client-side-only mutation
// with no real Supabase counterpart — confirmed via a functions-directory grep before writing
// this, no such Edge Function existed). A fixed-term pocket still stored 'active' whose real
// maturity_date has passed is treated as genuinely matured; 'withdrawn' is a terminal state,
// never reinterpreted; an AYW pocket has no maturity concept at all. The single source of truth
// for this rule — called from request-hys-withdrawal/index.ts (the one real money/access
// decision point that reads a pocket's status) to self-heal the stored row lazily, on touch,
// the same "settle whenever something real happens to touch it" discipline this project's own
// portfolio engine already established for price ticks (settleProduct()/settleAllProducts()),
// deliberately NOT a scheduled sweep (pg_cron) — see the register for the full investigation of
// why. high-yield-savings.html's own client-side rendering applies the IDENTICAL deterministic
// rule for display (its own direct `selectTable('hys_pockets')` read never touches any Edge
// Function at all, so no server-side fix alone can cover a pure read) — safe to duplicate here
// specifically because the rule is a pure, deterministic function of real data (maturity_date,
// current time), not a stateful assumption that could drift between the two copies.
export function resolveEffectivePocketStatus(pocket: { pocket_type: string; status: string; maturity_date: string | null }): string {
  if (
    pocket.pocket_type === 'fixed' &&
    pocket.status === 'active' &&
    pocket.maturity_date &&
    new Date(pocket.maturity_date) <= new Date()
  ) {
    return 'matured';
  }
  return pocket.status;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
