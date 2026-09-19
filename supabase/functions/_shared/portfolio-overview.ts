// ★ Portfolio overview (2026-09-12) — the ONE place the overview's figures are computed:
// the value history (and, since the bundled card of 2026-09-13, the capital-in reference
// series, per-anchor return, this-month change and per-range period stats), the
// cross-domain pending-request union, and the savings-pocket maturity figures. Every one of them is server-side by design (row 185: asset-collection's
// card badge is the last client-side money computation and no new one is added).
//
// portfolio_value_snapshots holds ONE row per client per calendar month — `month_start_date`
// is the 1st of the month and `value_at_anchor` the total portfolio value recorded at that
// boundary (which is the value at the END of the previous month). Two writers agree on that
// row: the scheduled snapshot-portfolio-values run (00:05 UTC on the 1st, every client) and
// get-portfolio-monthly-change's lazy first-visit-of-the-month insert — both idempotent on
// the (client_id, month_start_date) unique index, so a visit never overwrites the schedule.
import { computeTotalPortfolioValue } from './portfolio-engine.ts';
import { resolveEffectivePocketStatus } from './hys-engine.ts';

// A line through two points is not a chart: the chart replaces the new-client explanation
// only once this many REAL stored anchors exist. Today's live value is appended as the
// terminal point for display but never counts toward it.
export const CHART_MIN_ANCHORS = 3;

function round2(n: number): number { return Math.round(n * 100) / 100; }

export interface ValuePoint {
  date: string;          // the anchor's month_start_date (the point's x position)
  value: number;         // value_at_anchor
  capitalIn: number;     // net capital in as of the moment the anchor was RECORDED (see below)
  return: number;        // value - capitalIn: the gap between the two chart lines at this point
}
export interface CapitalEvent {
  date: string;                                        // the ledger row's created_at
  kind: 'deposit' | 'withdrawal' | 'transfer_out';
  amount: number;                                      // always positive; kind carries direction
  cumulativeAfter: number;                             // net capital in once this row landed
}
export interface PeriodStats {
  points: number;                                      // anchors in range + today
  high: { date: string; value: number; live: boolean };
  low: { date: string; value: number; live: boolean };
  months: number;                                      // full anchor-to-anchor months in range
  bestMonth: { month: string; percent: number } | null;
  worstMonth: { month: string; percent: number } | null;
}
export interface ValueHistory {
  currentValue: number;
  anchors: ValuePoint[];                             // oldest first, real stored rows only
  anchorCount: number;
  chartReady: boolean;
  minAnchors: number;
  firstAnchor: { date: string; value: number } | null;
  changeSinceFirst: { amount: number; percent: number | null } | null;
  thisMonth: { anchorValue: number; amount: number; percent: number | null } | null;
  capitalIn: { current: number; events: CapitalEvent[] };
  // ★ Asset & Performance's Total ACCOUNT value card (2026-09-19). A DIFFERENT scope from
  // capitalIn: the account total INCLUDES savings pockets, so a transfer into a pocket does
  // not leave it and must not be subtracted, while an external pocket deposit/withdrawal
  // (HYS_DEPOSIT / HYS_WITHDRAWAL) DOES enter/leave it. Using capitalIn.current for that card
  // would have been a subtle wrong number that looked plausible — a client who moved $1,100
  // into a pocket would read $1,100 less "deposited" than they actually sent.
  //   deposited = ΣDEPOSIT + ΣHYS_DEPOSIT − ΣWITHDRAWAL − ΣHYS_WITHDRAWAL  (external flows only)
  accountDeposited: number;
  live: { date: string; value: number; capitalIn: number; return: number };
  periodStats: Record<'3' | '6' | '12' | 'all', PeriodStats | null>;
  clientSince: string | null;
}

// ---------------------------------------------------------------------------------------
// ★ CAPITAL IN (2026-09-13) — the chart's dashed reference line, derived from the ledger.
//
// The portfolio line is computeTotalPortfolioValue(): unallocated + allocated + asset_returns.
// It does NOT include savings pockets. "Capital in" is therefore the NET EXTERNAL CAPITAL
// THAT HAS ENTERED THE PORTFOLIO THAT LINE MEASURES, and only three ledger types move it:
//
//   DEPOSIT          +total_value   external money credited to unallocated capital
//   WITHDRAWAL       -total_value   external money paid out of unallocated capital
//   HYS_TRANSFER_IN  -total_value   unallocated capital moved INTO a savings pocket — it leaves
//                                   the measured portfolio, so it must leave this line too, or
//                                   the gap would show a "loss" of exactly the transferred
//                                   amount that never happened (a real staging client has
//                                   DEPOSIT 100,000 then HYS_TRANSFER_IN 5,000: capital in
//                                   must read 95,000)
//   HYS_DEPOSIT / HYS_WITHDRAWAL     EXCLUDED: external money into / out of a pool the
//                                   portfolio line never included (an external pocket deposit
//                                   moves TPV by exactly nothing)
//   BUY / SELL                       EXCLUDED: internal reallocations, TPV-conserving
//
// With that definition the gap is EXACTLY the return, by the engine's own accounting:
//   unallocated = ΣDEPOSIT - ΣWITHDRAWAL - ΣHYS_TRANSFER_IN - Σbuy cost + Σsold cost portion
//   allocated   = held cost basis + unrealised = (Σbuy cost - Σsold cost portion) + unrealised
//   TPV - capitalIn = unrealised + asset_returns = get-returns-summary's `total`
// The verification asserts that identity against the real functions, not just this comment.
//
// AS-OF TIME. An anchor's capitalIn is the sum of rows created BEFORE the anchor was RECORDED
// (portfolio_value_snapshots.created_at), not before its label date: the lazy writer records
// "the value now" under the 1st's label on a client's first visit of the month, so a deposit
// credited on the 3rd is already inside a value labelled the 1st. Pairing that value with the
// capital in as of the 1st would overstate the return at that point by the deposit.
// ---------------------------------------------------------------------------------------
const CAPITAL_IN_SIGN: Record<string, number> = { DEPOSIT: 1, WITHDRAWAL: -1, HYS_TRANSFER_IN: -1 };
const EVENT_KIND: Record<string, CapitalEvent['kind']> = { DEPOSIT: 'deposit', WITHDRAWAL: 'withdrawal', HYS_TRANSFER_IN: 'transfer_out' };

// External money in and out of the ACCOUNT as a whole (portfolio + savings pockets). See the
// `accountDeposited` note on ValueHistory. Internal transfers (HYS_TRANSFER_IN) and trades
// (BUY/SELL) are neither.
const ACCOUNT_FLOW_SIGN: Record<string, number> = { DEPOSIT: 1, HYS_DEPOSIT: 1, WITHDRAWAL: -1, HYS_WITHDRAWAL: -1 };
export async function accountDepositedTotal(admin: any, clientId: string): Promise<number> {
  const { data, error } = await admin
    .from('transactions')
    .select('type, total_value')
    .eq('client_id', clientId)
    .in('type', Object.keys(ACCOUNT_FLOW_SIGN));
  if (error) throw new Error('Could not read the ledger for account deposits: ' + error.message);
  let sum = 0;
  for (const r of data || []) sum = round2(sum + ACCOUNT_FLOW_SIGN[r.type] * Number(r.total_value || 0));
  return sum;
}

async function capitalInEvents(admin: any, clientId: string): Promise<CapitalEvent[]> {
  const { data, error } = await admin
    .from('transactions')
    .select('type, total_value, created_at')
    .eq('client_id', clientId)
    .in('type', Object.keys(CAPITAL_IN_SIGN))
    .order('created_at', { ascending: true });
  if (error) throw new Error('Could not read the ledger for capital in: ' + error.message);
  let cum = 0;
  const events: CapitalEvent[] = [];
  for (const r of data || []) {
    const amount = round2(Math.abs(Number(r.total_value)));
    cum = round2(cum + CAPITAL_IN_SIGN[r.type] * amount);
    events.push({ date: String(r.created_at), kind: EVENT_KIND[r.type], amount, cumulativeAfter: cum });
  }
  return events;
}

// Net capital in as of an instant: the cumulative after the last event strictly before it.
function capitalInAsOf(events: CapitalEvent[], at: Date): number {
  let cum = 0;
  const t = at.getTime();
  for (const e of events) {
    if (new Date(e.date).getTime() < t) cum = e.cumulativeAfter; else break;
  }
  return cum;
}

// The range filter, shared with portfolio-overview.js's pointsFor(): an anchor is in an N-month
// range when its label date is on or after today minus N months (same day of month).
export function rangeCutoff(months: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
}

const RANGE_MONTHS: Record<'3' | '6' | '12' | 'all', number | null> = { '3': 3, '6': 6, '12': 12, all: null };

// Period stats for one range: high and low over the points the chart shows for it (anchors in
// range plus today's live value), and the best and worst FULL month. A month's figure is its
// return NET OF CAPITAL FLOWS on the month's opening value — (V1 - V0 - flow) / V0 — so a month
// that grew only because a deposit landed does not read as the best month on the very card
// whose reference line exists to make that distinction. A month opening at $0 has no rate and
// is skipped; the partial current month (last anchor to today) is not a month and is excluded.
function periodStatsFor(points: ValuePoint[], live: ValueHistory['live']): PeriodStats | null {
  if (points.length === 0) return null;
  const all = points.map((p) => ({ date: p.date, value: p.value, live: false })).concat([{ date: live.date, value: live.value, live: true }]);
  let high = all[0], low = all[0];
  for (const p of all) { if (p.value > high.value) high = p; if (p.value < low.value) low = p; }
  let best: PeriodStats['bestMonth'] = null, worst: PeriodStats['worstMonth'] = null, months = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    // Only consecutive calendar months are "a month": a gap (a missing anchor) is skipped.
    const da = new Date(a.date + 'T00:00:00Z'), db = new Date(b.date + 'T00:00:00Z');
    const consecutive = (db.getUTCFullYear() * 12 + db.getUTCMonth()) - (da.getUTCFullYear() * 12 + da.getUTCMonth()) === 1;
    if (!consecutive || a.value <= 0) continue;
    months++;
    const flow = round2(b.capitalIn - a.capitalIn);
    const percent = Math.round(((b.value - a.value - flow) / a.value) * 10000) / 100;
    const month = a.date.slice(0, 7);
    if (best === null || percent > best.percent) best = { month, percent };
    if (worst === null || percent < worst.percent) worst = { month, percent };
  }
  return { points: all.length, high, low, months, bestMonth: best, worstMonth: worst };
}

export async function valueHistory(admin: any, clientId: string, opts?: { now?: Date }): Promise<ValueHistory> {
  const now = opts && opts.now ? opts.now : new Date();
  const currentValue = round2(await computeTotalPortfolioValue(admin, clientId));
  const [snap, events] = await Promise.all([
    admin
      .from('portfolio_value_snapshots')
      .select('month_start_date, value_at_anchor, created_at')
      .eq('client_id', clientId)
      .order('month_start_date', { ascending: true }),
    capitalInEvents(admin, clientId)
  ]);
  if (snap.error) throw new Error('Could not read portfolio_value_snapshots: ' + snap.error.message);
  const anchors: ValuePoint[] = (snap.data || []).map((r: any) => {
    const value = round2(Number(r.value_at_anchor));
    const capitalIn = capitalInAsOf(events, new Date(r.created_at));
    return { date: String(r.month_start_date), value, capitalIn, return: round2(value - capitalIn) };
  });
  const { data: client } = await admin.from('clients').select('created_at').eq('id', clientId).maybeSingle();
  const first = anchors.length ? anchors[0] : null;
  const chartReady = anchors.length >= CHART_MIN_ANCHORS;
  // The change figure is subject to the SAME threshold as the chart. Found on the live site
  // (2026-09-12): a client whose only anchor was the $0 snapshot written before their account
  // was funded read "+$94,874 since Sep 2026" — the entire portfolio presented as a gain. One
  // anchor cannot say how a portfolio has changed any more than it can draw a chart, so below
  // the threshold there is no change figure at all, never a number the page has to caveat.
  // Percent is null, never Infinity, when the first anchor was a genuine $0.
  const change = chartReady && first
    ? { amount: round2(currentValue - first.value), percent: first.value > 0 ? Math.round(((currentValue - first.value) / first.value) * 10000) / 100 : null }
    : null;

  // THIS MONTH: the current month's anchor against the live value — the horizon the old
  // get-portfolio-monthly-change badge answered, folded into the one overview read. Same rule
  // as that function: a $0 anchor with money now is "new this month" (percent null — and the
  // AMOUNT is withheld too, since "+$94,874 this month" is the row-205 bug on a shorter
  // horizon); a $0 anchor with $0 now is a flat 0%. No anchor row yet means null.
  const thisMonthRow = anchors.find((a) => a.date === monthStartIso(now)) || null;
  const thisMonth = thisMonthRow
    ? (thisMonthRow.value > 0
      ? { anchorValue: thisMonthRow.value, amount: round2(currentValue - thisMonthRow.value), percent: Math.round(((currentValue - thisMonthRow.value) / thisMonthRow.value) * 10000) / 100 }
      : (currentValue === 0 ? { anchorValue: 0, amount: 0, percent: 0 } : { anchorValue: 0, amount: round2(currentValue), percent: null }))
    : null;

  const capitalInNow = events.length ? events[events.length - 1].cumulativeAfter : 0;
  const accountDeposited = await accountDepositedTotal(admin, clientId);
  const live = { date: now.toISOString().slice(0, 10), value: currentValue, capitalIn: capitalInNow, return: round2(currentValue - capitalInNow) };

  // Period stats per range, computed only once the chart itself is shown — below the threshold
  // there is nothing to compute, and the card says so instead (brief point 4).
  const periodStats: ValueHistory['periodStats'] = { '3': null, '6': null, '12': null, all: null };
  if (chartReady) {
    for (const key of Object.keys(RANGE_MONTHS) as Array<keyof typeof RANGE_MONTHS>) {
      const months = RANGE_MONTHS[key];
      const pts = months === null ? anchors : anchors.filter((a) => new Date(a.date + 'T00:00:00Z') >= rangeCutoff(months, now));
      // A range with fewer than two anchors is disabled on the page; no stats for it either.
      periodStats[key] = pts.length >= 2 ? periodStatsFor(pts, live) : null;
    }
  }

  return {
    currentValue,
    anchors,
    anchorCount: anchors.length,
    chartReady,
    minAnchors: CHART_MIN_ANCHORS,
    firstAnchor: first ? { date: first.date, value: first.value } : null,
    changeSinceFirst: change,
    thisMonth,
    capitalIn: { current: capitalInNow, events },
    accountDeposited,
    live,
    periodStats,
    clientSince: client && client.created_at ? String(client.created_at) : null
  };
}

// Write this month's anchor for one client if it does not exist yet. Returns what happened
// so the scheduled run can report it. The value is computed the same way every read does.
export async function writeMonthAnchor(admin: any, clientId: string, monthStartDate: string): Promise<'inserted' | 'exists'> {
  const { data: existing } = await admin
    .from('portfolio_value_snapshots')
    .select('id')
    .eq('client_id', clientId)
    .eq('month_start_date', monthStartDate)
    .maybeSingle();
  if (existing) return 'exists';
  const value = round2(await computeTotalPortfolioValue(admin, clientId));
  const { error } = await admin
    .from('portfolio_value_snapshots')
    .insert({ client_id: clientId, month_start_date: monthStartDate, value_at_anchor: value });
  if (error) {
    if ((error.code || '') === '23505') return 'exists'; // the lazy writer got there first — same row
    throw new Error('Could not write the month anchor for ' + clientId + ': ' + error.message);
  }
  return 'inserted';
}

export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------
// Pending requests — the union of every request type awaiting PM review, for one client.
// Each row carries what the panel needs and a link to the page where the full history lives.
// ---------------------------------------------------------------------------------------
export interface PendingRequest {
  id: string;
  type: 'deposit' | 'withdrawal' | 'allocation' | 'sell' | 'hys_deposit' | 'hys_withdrawal' | 'profile_change';
  title: string;
  detail: string;
  requestedAt: string;
  amount: number | null;
  units: number | null;
  internalTransfer: boolean;
  href: string;
}

const METHOD_LABEL: Record<string, string> = { bank: 'Bank transfer', crypto: 'Crypto', internal: 'Internal transfer' };
const FIELD_LABEL: Record<string, string> = { legalName: 'Legal name', address: 'Address', idDocument: 'ID document' };

export async function pendingRequests(admin: any, clientId: string): Promise<PendingRequest[]> {
  const q = (table: string, cols: string) => admin.from(table).select(cols).eq('client_id', clientId).eq('status', 'pending');
  const [dep, wd, alo, sell, hdep, hwd, prof] = await Promise.all([
    q('deposit_requests', 'id, method, requested_amount, currency, requested_at, network'),
    q('withdrawal_requests', 'id, method, requested_amount, requested_at'),
    q('allocation_requests', 'id, product_id, requested_amount, requested_at'),
    q('sell_requests', 'id, product_id, units_to_sell, requested_at'),
    q('hys_deposit_requests', 'id, pocket_type, term_label, requested_amount, method, requested_at'),
    q('hys_withdrawal_requests', 'id, pocket_type, term_label, receive_amount, method, requested_at'),
    q('profile_change_requests', 'id, field, requested_at')
  ]);
  for (const r of [dep, wd, alo, sell, hdep, hwd, prof]) if (r.error) throw new Error('Could not read pending requests: ' + r.error.message);

  const productIds = Array.from(new Set([...(alo.data || []).map((r: any) => r.product_id), ...(sell.data || []).map((r: any) => r.product_id)]));
  const names: Record<string, string> = {};
  if (productIds.length) {
    const { data: prods } = await admin.from('products').select('id, name').in('id', productIds);
    for (const p of prods || []) names[p.id] = p.name;
  }

  const out: PendingRequest[] = [];
  for (const r of dep.data || []) out.push({
    id: r.id, type: 'deposit', title: 'Deposit · ' + (METHOD_LABEL[r.method] || r.method),
    detail: r.method === 'crypto' ? (r.currency ? String(r.currency) + (r.network ? ' (' + r.network + ')' : '') : 'Crypto') : 'Awaiting your transfer',
    requestedAt: r.requested_at, amount: r.requested_amount == null ? null : Number(r.requested_amount), units: null,
    internalTransfer: false, href: 'deploy-capital.html'
  });
  for (const r of wd.data || []) out.push({
    id: r.id, type: 'withdrawal', title: 'Withdrawal · ' + (METHOD_LABEL[r.method] || r.method), detail: 'From unallocated capital',
    requestedAt: r.requested_at, amount: Number(r.requested_amount), units: null, internalTransfer: false, href: 'deploy-capital.html'
  });
  for (const r of alo.data || []) out.push({
    id: r.id, type: 'allocation', title: 'Allocation · ' + (names[r.product_id] || r.product_id), detail: 'From unallocated capital',
    requestedAt: r.requested_at, amount: Number(r.requested_amount), units: null, internalTransfer: false, href: 'asset-performance.html'
  });
  for (const r of sell.data || []) out.push({
    id: r.id, type: 'sell', title: 'Sell · ' + (names[r.product_id] || r.product_id), detail: 'Executes at the approval-time price',
    requestedAt: r.requested_at, amount: null, units: Number(r.units_to_sell), internalTransfer: false, href: 'asset-performance.html'
  });
  for (const r of hdep.data || []) out.push({
    id: r.id, type: 'hys_deposit', title: 'Savings pocket · ' + (r.pocket_type === 'ayw' ? 'Flexible' : (r.term_label || 'Fixed term')),
    detail: r.method === 'internal' ? 'Internal transfer from unallocated capital' : 'Funded by ' + (METHOD_LABEL[r.method] || r.method).toLowerCase(),
    requestedAt: r.requested_at, amount: Number(r.requested_amount), units: null, internalTransfer: r.method === 'internal', href: 'high-yield-savings.html'
  });
  for (const r of hwd.data || []) out.push({
    id: r.id, type: 'hys_withdrawal', title: 'Pocket withdrawal · ' + (r.pocket_type === 'ayw' ? 'Flexible' : (r.term_label || 'Fixed term')),
    detail: 'Paid out by ' + (METHOD_LABEL[r.method] || r.method).toLowerCase(),
    requestedAt: r.requested_at, amount: Number(r.receive_amount), units: null, internalTransfer: false, href: 'high-yield-savings.html'
  });
  for (const r of prof.data || []) out.push({
    id: r.id, type: 'profile_change', title: 'Profile update · ' + (FIELD_LABEL[r.field] || r.field), detail: 'Identity change under review',
    requestedAt: r.requested_at, amount: null, units: null, internalTransfer: false, href: 'settings.html'
  });
  out.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  return out;
}

// ---------------------------------------------------------------------------------------
// Savings-pocket maturities. A fixed pocket's interest is simple interest paid AT MATURITY
// (credit-hys-deposit: amount x rate x years) and forfeited on early withdrawal, so the figure
// shown is the pro-rata share ACCRUED TOWARD TERM, never money already paid. A flexible (AYW)
// pocket has no term and, in this engine, no rate and no interest — it is reported as such.
// ---------------------------------------------------------------------------------------
export interface PocketMaturity {
  id: string;
  kind: 'fixed' | 'flexible';
  name: string;
  amount: number;
  status: string;
  openedAt: string;
  maturityDate: string | null;
  daysRemaining: number | null;
  progressPercent: number | null;   // 0-100 toward term; null for flexible
  interestAtMaturity: number | null;
  interestAccrued: number | null;   // pro-rata share of interestAtMaturity earned so far
  rate: number | null;
}

export async function pocketMaturities(admin: any, clientId: string, now = new Date()): Promise<PocketMaturity[]> {
  const { data, error } = await admin
    .from('hys_pockets')
    .select('id, pocket_type, amount, status, term_label, rate, term_in_years, maturity_date, projected_interest, created_at')
    .eq('client_id', clientId)
    .neq('status', 'withdrawn')
    .order('maturity_date', { ascending: true, nullsFirst: false });
  if (error) throw new Error('Could not read hys_pockets: ' + error.message);
  const out: PocketMaturity[] = [];
  for (const p of data || []) {
    const status = resolveEffectivePocketStatus(p);
    if (p.pocket_type === 'ayw') {
      out.push({ id: p.id, kind: 'flexible', name: 'Flexible pocket', amount: round2(Number(p.amount)), status, openedAt: p.created_at, maturityDate: null, daysRemaining: null, progressPercent: null, interestAtMaturity: null, interestAccrued: null, rate: null });
      continue;
    }
    const opened = new Date(p.created_at).getTime();
    const matures = p.maturity_date ? new Date(p.maturity_date).getTime() : null;
    const total = matures ? Math.max(1, matures - opened) : null;
    const elapsed = matures ? Math.min(Math.max(0, now.getTime() - opened), total as number) : null;
    const progress = total ? Math.round(((elapsed as number) / total) * 1000) / 10 : null;
    const interestAtMaturity = round2(Number(p.projected_interest || 0));
    out.push({
      id: p.id, kind: 'fixed', name: (p.term_label ? String(p.term_label) : 'Fixed-term') + ' pocket', amount: round2(Number(p.amount)), status,
      openedAt: p.created_at, maturityDate: p.maturity_date,
      daysRemaining: matures ? Math.max(0, Math.ceil((matures - now.getTime()) / 86400000)) : null,
      progressPercent: status === 'matured' ? 100 : progress,
      interestAtMaturity,
      interestAccrued: status === 'matured' ? interestAtMaturity : round2(interestAtMaturity * ((progress || 0) / 100)),
      rate: p.rate == null ? null : Number(p.rate)
    });
  }
  return out;
}
