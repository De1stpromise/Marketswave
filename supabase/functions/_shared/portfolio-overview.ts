// ★ Portfolio overview (2026-09-12) — the ONE place the overview's figures are computed:
// the value history, the cross-domain pending-request union, and the savings-pocket
// maturity figures. Every one of them is server-side by design (row 185: asset-collection's
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

export interface ValueHistory {
  currentValue: number;
  anchors: { date: string; value: number }[];      // oldest first, real stored rows only
  anchorCount: number;
  chartReady: boolean;
  minAnchors: number;
  firstAnchor: { date: string; value: number } | null;
  changeSinceFirst: { amount: number; percent: number | null } | null;
  clientSince: string | null;
}

export async function valueHistory(admin: any, clientId: string): Promise<ValueHistory> {
  const currentValue = round2(await computeTotalPortfolioValue(admin, clientId));
  const { data: rows, error } = await admin
    .from('portfolio_value_snapshots')
    .select('month_start_date, value_at_anchor')
    .eq('client_id', clientId)
    .order('month_start_date', { ascending: true });
  if (error) throw new Error('Could not read portfolio_value_snapshots: ' + error.message);
  const anchors = (rows || []).map((r: any) => ({ date: String(r.month_start_date), value: round2(Number(r.value_at_anchor)) }));
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
  return {
    currentValue,
    anchors,
    anchorCount: anchors.length,
    chartReady,
    minAnchors: CHART_MIN_ANCHORS,
    firstAnchor: first,
    changeSinceFirst: change,
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
