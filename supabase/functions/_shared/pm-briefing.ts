// ★ PM tool revamp, part 2 (2026-09-14) — the Overview as a daily briefing.
//
// Every figure the briefing shows is computed HERE, server-side, from the real tables, and
// handed to admin.html as a finished payload; the page only formats (row 185's rule, applied
// to the PM tool). EVERY FIGURE IS REAL OR ABSENT: where a figure cannot be computed yet the
// payload carries `null` plus a `reason` the panel shows in its place — never a placeholder
// number, never a guess dressed as a value.
//
// THE THRESHOLDS, stated rather than buried (the brief asked for them to be reported):
//   OVERDUE_HOURS          24   an approval pending longer than a day is overdue (amber).
//   HOT_HOURS              24   the same line: a Needs-you-first row older than a day is hot.
//   CONCENTRATION_SHARE    0.40 one holding worth 40%+ of the client's total portfolio value
//   CONCENTRATION_MIN_TPV  10000 …and the portfolio is at least $10k (a $500 account with one
//                               position is 100% concentrated by construction; not a finding).
//   DORMANT_DAYS           60   no activity of any kind for 60 days while still holding value.
//                               "Activity" is the LATEST of: a password sign-in
//                               (auth.users.last_sign_in_at), any request of any type, any
//                               transaction, any site visit in the 30-day presence window.
//   IDLE_MIN               1    idle capital is reported whenever any client holds any.
//   UNSIGNED_MIN_DAYS      0    every sent-but-unsigned document is listed, oldest first.
//   PM_SESSION_GAP_MINUTES 30   two reads more than 30 min apart are different sessions.
//
// WHAT WAS OMITTED, and why (the panel says the same in place):
//   - Last backup: no backup mechanism exists on this project (the free tier has none, and
//     nothing here schedules one). Reported as "not configured", amber.
//   - Statements: nothing generates client statements. The nearest real scheduled event is
//     the monthly portfolio-value snapshot (snapshot-portfolio-values, 00:05 UTC on the 1st),
//     which is what the Coming-up panel lists — labelled as what it is.
//   - Email bounces: counted from messages.delivery_status = 'bounced' (written by the Resend
//     webhook) plus email_log.status = 'failed' (a send Resend refused synchronously). Bounce
//     events reach us only if the Resend webhook is subscribed to email.bounced — register
//     row 218 — so "0 bounces" means "none reported", and the panel wording says so.
//   - NAV overdue needs a stated frequency: it comes from the product's fund document
//     (terms.valuationFrequency, published or draft). An appraisal product with no stated
//     frequency cannot be told overdue and is listed under Needs a look instead.

import { settleAllProducts, recomputeAllocatedCapital, type ProductRow } from './portfolio-engine.ts';
import { STOCK_SYMBOLS_PER_REFRESH_RUN, REFRESH_INTERVAL_MINUTES, cyclesToCoverStocks, worstCaseStalenessMinutes } from './market-providers.ts';
import { LIVE_WINDOW_SECONDS } from './visitor-presence.ts';
import { CONCENTRATION_SHARE, CONCENTRATION_MIN_TPV } from './concentration.ts';

export const OVERDUE_HOURS = 24;
export const HOT_HOURS = 24;
// Concentration thresholds moved to _shared/concentration.ts (row 251) so the client dashboard's
// "Largest position" row and this briefing cannot disagree; re-exported here unchanged.
export { CONCENTRATION_SHARE, CONCENTRATION_MIN_TPV } from './concentration.ts';
export const DORMANT_DAYS = 60;
export const PM_SESSION_GAP_MINUTES = 30;
export const COMING_UP_DAYS = 30;

// Days a stated valuation frequency allows between publications (fund-document.ts's own list).
export const VALUATION_FREQUENCY_DAYS: Record<string, number> = {
  'Daily': 1, 'Monthly': 31, 'Quarterly': 92, 'Semi-annual': 183, 'Annual': 366
};

const REQUEST_TABLES = ['deposit_requests', 'withdrawal_requests', 'allocation_requests', 'sell_requests', 'hys_deposit_requests', 'hys_withdrawal_requests', 'profile_change_requests'];

type Admin = any;

function hoursBetween(a: string | Date, b: Date): number { return (b.getTime() - new Date(a).getTime()) / 3600e3; }
function daysBetween(a: string | Date, b: Date): number { return hoursBetween(a, b) / 24; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function must<T>(r: { data: T; error: any }, what: string): T { if (r.error) throw new Error('Could not read ' + what + ': ' + r.error.message); return r.data; }

// ---------------------------------------------------------------------------------------
// 1. The PM's own visit — the ONLY source of "since you last looked".
// ---------------------------------------------------------------------------------------
export interface VisitRecord { lastLooked: string | null; sessionStartedAt: string; firstBriefing: boolean }

export async function recordPmVisit(admin: Admin, pmId: string, pmEmail: string | null, now: Date): Promise<VisitRecord> {
  const { data: row, error } = await admin.from('pm_visits').select('*').eq('user_id', pmId).maybeSingle();
  if (error) throw new Error('Could not read pm_visits: ' + error.message);
  const nowIso = now.toISOString();
  if (!row) {
    const ins = await admin.from('pm_visits').insert({ user_id: pmId, email: pmEmail, session_started_at: nowIso, last_seen_at: nowIso, previous_session_last_seen_at: null });
    if (ins.error) throw new Error('Could not record the visit: ' + ins.error.message);
    return { lastLooked: null, sessionStartedAt: nowIso, firstBriefing: true };
  }
  const gapMin = (now.getTime() - new Date(row.last_seen_at).getTime()) / 60000;
  const newSession = gapMin > PM_SESSION_GAP_MINUTES;
  const patch: Record<string, unknown> = { last_seen_at: nowIso, email: pmEmail || row.email };
  if (newSession) { patch.previous_session_last_seen_at = row.last_seen_at; patch.session_started_at = nowIso; }
  const upd = await admin.from('pm_visits').update(patch).eq('user_id', pmId);
  if (upd.error) throw new Error('Could not record the visit: ' + upd.error.message);
  const lastLooked = newSession ? row.last_seen_at : row.previous_session_last_seen_at;
  return { lastLooked: lastLooked || null, sessionStartedAt: newSession ? nowIso : row.session_started_at, firstBriefing: !lastLooked };
}

// ---------------------------------------------------------------------------------------
// 2. Approvals — every pending request of every type, cross-client, with its age.
// ---------------------------------------------------------------------------------------
export interface PendingApproval {
  id: string; type: string; typeLabel: string; clientId: string | null; clientName: string;
  detail: string; amount: number | null; requestedAt: string; ageHours: number; hot: boolean; href: string;
}
// PM tool revamp part 3 (2026-09-15): the seven queue pages are retired and every approval
// lands on the one gate. The map is kept rather than collapsed to a constant because the type
// is still what the briefing knows, and a future gate that deep-links per type (?type=deposit)
// changes only these values.
const HREF: Record<string, string> = {
  application: 'admin-approvals.html', deposit: 'admin-approvals.html', withdrawal: 'admin-approvals.html',
  allocation: 'admin-approvals.html', sell: 'admin-approvals.html', hys_deposit: 'admin-approvals.html',
  hys_withdrawal: 'admin-approvals.html', profile_change: 'admin-approvals.html'
};
const METHOD_LABEL: Record<string, string> = { bank: 'Bank transfer', crypto: 'Crypto', internal: 'Internal transfer' };
const FIELD_LABEL: Record<string, string> = { legalName: 'Legal name', address: 'Address', idDocument: 'ID document' };

export async function pendingApprovals(admin: Admin, clientNames: Record<string, string>, productNames: Record<string, string>, now: Date): Promise<PendingApproval[]> {
  const q = (t: string, cols: string) => admin.from(t).select(cols).eq('status', 'pending');
  const [apps, dep, wd, alo, sell, hdep, hwd, prof] = await Promise.all([
    admin.from('clients').select('id, name, created_at, account_type').eq('status', 'pending_review'),
    q('deposit_requests', 'id, client_id, method, requested_amount, currency, network, tx_hash, requested_at'),
    q('withdrawal_requests', 'id, client_id, method, requested_amount, requested_at'),
    q('allocation_requests', 'id, client_id, product_id, requested_amount, requested_at'),
    q('sell_requests', 'id, client_id, product_id, units_to_sell, requested_at'),
    q('hys_deposit_requests', 'id, client_id, pocket_type, term_label, requested_amount, method, requested_at'),
    q('hys_withdrawal_requests', 'id, client_id, pocket_type, term_label, receive_amount, method, requested_at'),
    q('profile_change_requests', 'id, client_id, field, requested_at')
  ]);
  for (const r of [apps, dep, wd, alo, sell, hdep, hwd, prof]) if (r.error) throw new Error('Could not read pending approvals: ' + r.error.message);
  const out: PendingApproval[] = [];
  const push = (type: string, typeLabel: string, r: any, detail: string, amount: number | null, clientId: string | null, name?: string) => {
    const requestedAt = r.requested_at || r.created_at;
    const ageHours = hoursBetween(requestedAt, now);
    out.push({ id: r.id, type, typeLabel, clientId, clientName: name || (clientId && clientNames[clientId]) || 'Unknown client', detail, amount, requestedAt, ageHours: round2(ageHours), hot: ageHours >= HOT_HOURS, href: HREF[type] });
  };
  for (const r of apps.data || []) push('application', 'Client application', r, (r.account_type || 'Application') + ' · awaiting review', null, r.id, r.name);
  for (const r of dep.data || []) push('deposit', (r.method === 'crypto' ? 'Crypto deposit' : 'Deposit'), r, r.method === 'crypto' ? ((r.currency || 'Crypto') + (r.network ? ' · ' + r.network : '') + (r.tx_hash ? ' · hash provided' : ' · no hash yet')) : (METHOD_LABEL[r.method] || r.method), r.requested_amount == null ? null : Number(r.requested_amount), r.client_id);
  for (const r of wd.data || []) push('withdrawal', 'Withdrawal', r, METHOD_LABEL[r.method] || r.method, Number(r.requested_amount), r.client_id);
  for (const r of alo.data || []) push('allocation', 'Allocation', r, productNames[r.product_id] || r.product_id, Number(r.requested_amount), r.client_id);
  for (const r of sell.data || []) push('sell', 'Sell', r, (productNames[r.product_id] || r.product_id) + ' · ' + Number(r.units_to_sell) + ' units', null, r.client_id);
  for (const r of hdep.data || []) push('hys_deposit', 'Savings deposit', r, (r.pocket_type === 'ayw' ? 'Flexible' : (r.term_label || 'Fixed term')) + ' · ' + (r.method === 'internal' ? 'from unallocated capital' : (METHOD_LABEL[r.method] || r.method).toLowerCase()), Number(r.requested_amount), r.client_id);
  for (const r of hwd.data || []) push('hys_withdrawal', 'Savings withdrawal', r, (r.pocket_type === 'ayw' ? 'Flexible' : (r.term_label || 'Fixed term')) + ' · ' + (METHOD_LABEL[r.method] || r.method).toLowerCase(), Number(r.receive_amount), r.client_id);
  for (const r of prof.data || []) push('profile_change', 'Profile update', r, FIELD_LABEL[r.field] || r.field, null, r.client_id);
  out.sort((a, b) => b.ageHours - a.ageHours); // oldest first: the most urgent
  return out;
}

// ---------------------------------------------------------------------------------------
// 3. Unread by channel — the inbox's own placement rule (kind ticket → ticket; otherwise the
//    most recent real message's channel), so this figure agrees with the inbox rail.
// ---------------------------------------------------------------------------------------
export async function unreadByChannel(admin: Admin): Promise<{ total: number; chats: number; tickets: number; email: number }> {
  const convos = must(await admin.from('conversations').select('id, kind, status, unread_by_pm').eq('unread_by_pm', true).neq('status', 'archived'), 'conversations');
  const out = { total: 0, chats: 0, tickets: 0, email: 0 };
  if (!convos.length) return out;
  const msgs = must(await admin.from('messages').select('conversation_id, channel, sent_at').in('conversation_id', convos.map((c: any) => c.id)).neq('channel', 'system').order('sent_at', { ascending: true }), 'messages');
  const last: Record<string, string> = {};
  for (const m of msgs) last[m.conversation_id] = m.channel;
  for (const c of convos) {
    out.total++;
    if (c.kind === 'ticket') out.tickets++;
    else if ((last[c.id] || c.kind) === 'email') out.email++;
    else out.chats++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 4. The firm today — one settlement pass, every client's portfolio value from it.
//    AUM is the sum of total portfolio value (unallocated + allocated + realised returns —
//    the same computeTotalPortfolioValue() figure every client page shows), EXCLUDING savings
//    pockets, which are their own pool and are reported on their own line.
// ---------------------------------------------------------------------------------------
export interface FirmToday {
  clientsActive: number; clientsPending: number; clientsTotal: number;
  aum: number; unallocated: number; savings: number; savingsPockets: number;
  feeRate: number | null; feesThisMonth: number | null; feesReason: string | null;
  tpvByClient: Record<string, number>; unallocatedByClient: Record<string, number>;
}

export async function firmToday(admin: Admin, clients: any[], products: ProductRow[], now: Date): Promise<FirmToday> {
  const holdings = must(await admin.from('holdings').select('client_id, product_id, units, cost_basis'), 'holdings');
  const byClient: Record<string, any[]> = {};
  for (const h of holdings) (byClient[h.client_id] = byClient[h.client_id] || []).push(h);
  for (const cid of Object.keys(byClient)) await recomputeAllocatedCapital(admin, cid, byClient[cid], products);
  // Only rows that belong to a real clients row count — an account_state row whose client has
  // been deleted (a leftover) is not a client the firm manages.
  const known = new Set(clients.map((c) => c.id));
  const states = must(await admin.from('account_state').select('client_id, unallocated_capital, allocated_capital, asset_returns'), 'account_state').filter((s: any) => known.has(s.client_id));
  const tpvByClient: Record<string, number> = {}; const unallocatedByClient: Record<string, number> = {};
  let aum = 0, unallocated = 0, allocated = 0;
  for (const s of states) {
    const tpv = Number(s.unallocated_capital) + Number(s.allocated_capital) + Number(s.asset_returns);
    tpvByClient[s.client_id] = round2(tpv); unallocatedByClient[s.client_id] = Number(s.unallocated_capital);
    aum += tpv; unallocated += Number(s.unallocated_capital); allocated += Number(s.allocated_capital);
  }
  const pockets = must(await admin.from('hys_pockets').select('amount, status').in('status', ['active', 'matured']), 'hys_pockets');
  const savings = pockets.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const rateRow = must(await admin.from('advisory_fee_rate').select('rate').eq('id', true).maybeSingle(), 'advisory_fee_rate');
  const feeRate = rateRow ? Number(rateRow.rate) : null;
  // Accrued so far this month: allocated capital × annual rate × elapsed days / 365 — the same
  // accrual formula the client's own transactions.html card uses, taken up to today.
  const dayOfMonth = now.getUTCDate();
  const feesThisMonth = feeRate == null ? null : round2(allocated * (feeRate / 100) * (dayOfMonth / 365));
  return {
    clientsActive: clients.filter((c) => c.status === 'active').length,
    clientsPending: clients.filter((c) => c.status === 'pending_review').length,
    clientsTotal: clients.length,
    aum: round2(aum), unallocated: round2(unallocated), savings: round2(savings), savingsPockets: pockets.length,
    feeRate, feesThisMonth, feesReason: feeRate == null ? 'No advisory fee rate has been set yet' : null,
    tpvByClient, unallocatedByClient
  };
}

// The month's change in AUM: current AUM minus the sum of this month's real anchors. Only
// shown when every client that has a portfolio also has this month's anchor — a partial sum
// would read as a real change that never happened.
export function aumMonthChange(anchors: any[], tpvByClient: Record<string, number>, monthStart: string): { change: number | null; anchoredClients: number; clientsWithPortfolio: number; reason: string | null } {
  const clientIds = Object.keys(tpvByClient);
  const anchored = anchors.filter((a) => a.month_start_date === monthStart && tpvByClient[a.client_id] !== undefined);
  if (clientIds.length === 0) return { change: null, anchoredClients: 0, clientsWithPortfolio: 0, reason: 'No client portfolios yet' };
  if (anchored.length < clientIds.length) return { change: null, anchoredClients: anchored.length, clientsWithPortfolio: clientIds.length, reason: 'Month anchors exist for ' + anchored.length + ' of ' + clientIds.length + ' portfolios' };
  const anchorSum = anchored.reduce((s, a) => s + Number(a.value_at_anchor), 0);
  const current = clientIds.reduce((s, id) => s + tpvByClient[id], 0);
  return { change: round2(current - anchorSum), anchoredClients: anchored.length, clientsWithPortfolio: clientIds.length, reason: null };
}

// ---------------------------------------------------------------------------------------
// 5. Since you last looked.
// ---------------------------------------------------------------------------------------
export interface SinceItem { kind: 'reply' | 'matured' | 'application'; title: string; detail: string; at: string; href: string }

export async function sinceLastLooked(admin: Admin, lastLooked: string | null, clientNames: Record<string, string>, now: Date): Promise<{ items: SinceItem[]; yesterday: { visitors: number; returning: number; reachedSignup: number; date: string } }> {
  const items: SinceItem[] = [];
  if (lastLooked) {
    const msgs = must(await admin.from('messages').select('conversation_id, sent_at, body, sender_name').eq('direction', 'inbound').neq('channel', 'system').gt('sent_at', lastLooked).order('sent_at', { ascending: false }), 'messages');
    const seen = new Set<string>();
    const convoIds = Array.from(new Set(msgs.map((m: any) => m.conversation_id)));
    const convos = convoIds.length ? must(await admin.from('conversations').select('id, client_id, contact_name, contact_email, kind, display_id, status').in('id', convoIds), 'conversations') : [];
    const convoById: Record<string, any> = {}; for (const c of convos) convoById[c.id] = c;
    for (const m of msgs) {
      if (seen.has(m.conversation_id)) continue; seen.add(m.conversation_id);
      const c = convoById[m.conversation_id]; if (!c) continue;
      const who = (c.client_id && clientNames[c.client_id]) || c.contact_name || c.contact_email || 'A visitor';
      const title = c.kind === 'ticket' ? who + ' replied on ' + (c.display_id || 'a ticket') : who + ' wrote';
      const detail = (c.kind === 'ticket' ? 'Ticket · ' + String(c.status || '').replace('_', ' ') + ' · ' : '') + String(m.body || '').replace(/\s+/g, ' ').slice(0, 80);
      items.push({ kind: 'reply', title, detail, at: m.sent_at, href: 'admin-inbox.html?c=' + c.id });
    }
    const pockets = must(await admin.from('hys_pockets').select('id, client_id, pocket_type, term_label, amount, projected_interest, maturity_date, status').eq('pocket_type', 'fixed').neq('status', 'withdrawn').gt('maturity_date', lastLooked).lte('maturity_date', now.toISOString()), 'hys_pockets');
    for (const p of pockets) items.push({ kind: 'matured', title: 'Savings pocket matured · ' + (clientNames[p.client_id] || 'Unknown client'), detail: (p.term_label || 'Fixed') + ' · $' + Number(p.amount).toLocaleString('en-US') + ' + $' + Number(p.projected_interest).toLocaleString('en-US') + ' interest at term', at: new Date(p.maturity_date).toISOString(), href: 'admin-approvals.html' });
    const apps = must(await admin.from('clients').select('id, name, status, created_at, account_type').gt('created_at', lastLooked), 'clients');
    // A signup lands as pending_review (an application); a client a PM created directly is
    // active from the start (a new client, not an application to review).
    for (const a of apps) items.push({ kind: 'application', title: (a.status === 'pending_review' ? 'New application · ' : 'New client · ') + a.name, detail: (a.account_type || 'Application') + (a.status === 'pending_review' ? ' · awaiting review' : ' · ' + String(a.status).replace('_', ' ')), at: a.created_at, href: a.status === 'pending_review' ? 'admin-approvals.html' : 'admin-clients.html?client=' + a.id });
    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }
  // Yesterday (UTC): sessions that started within the day, distinct visitors.
  const y0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const y1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sessions = must(await admin.from('visitor_sessions').select('visitor_id, visit_number, journey, current_path').gte('started_at', y0.toISOString()).lt('started_at', y1.toISOString()), 'visitor_sessions');
  const visitors = new Set<string>(); const returning = new Set<string>(); const signup = new Set<string>();
  for (const s of sessions) {
    visitors.add(s.visitor_id);
    if (Number(s.visit_number) >= 2) returning.add(s.visitor_id);
    const paths = [String(s.current_path || ''), ...((Array.isArray(s.journey) ? s.journey : []).map((j: any) => String((j && (j.path || j.p)) || '')))];
    if (paths.some((p) => /signup/.test(p))) signup.add(s.visitor_id);
  }
  return { items, yesterday: { visitors: visitors.size, returning: returning.size, reachedSignup: signup.size, date: y0.toISOString().slice(0, 10) } };
}

// ---------------------------------------------------------------------------------------
// 6. Coming up, next 30 days.
// ---------------------------------------------------------------------------------------
export interface DueItem { kind: 'maturity' | 'nav' | 'unsigned' | 'snapshot'; title: string; detail: string; amount: number | null; when: string; whenLabel: string; soon: boolean; href: string; daysOverdue?: number }

function frequencyFromDocument(doc: any): string | null {
  const content = doc && (doc.published_content || doc.content);
  const sections = content && Array.isArray(content.sections) ? content.sections : [];
  const terms = sections.find((s: any) => s && s.key === 'terms');
  return terms && terms.valuationFrequency ? String(terms.valuationFrequency) : null;
}

export async function comingUp(admin: Admin, products: ProductRow[], clientNames: Record<string, string>, now: Date): Promise<{ items: DueItem[]; navNoFrequency: { id: string; name: string }[] }> {
  const items: DueItem[] = [];
  const horizon = new Date(now.getTime() + COMING_UP_DAYS * 86400e3);
  // The same rule the engine applies (resolveEffectivePocketStatus): matured once
  // maturity_date <= now; so "coming up" is strictly after now.
  const pockets = must(await admin.from('hys_pockets').select('id, client_id, term_label, amount, projected_interest, maturity_date, status').eq('pocket_type', 'fixed').eq('status', 'active').gt('maturity_date', now.toISOString()).lte('maturity_date', horizon.toISOString()), 'hys_pockets');
  for (const p of pockets) {
    const days = Math.round(daysBetween(now, new Date(p.maturity_date)));
    items.push({ kind: 'maturity', title: 'Savings pocket matures · ' + (clientNames[p.client_id] || 'Unknown client'), detail: (p.term_label || 'Fixed') + ' · $' + Number(p.projected_interest).toLocaleString('en-US') + ' interest at term', amount: Number(p.amount), when: new Date(p.maturity_date).toISOString(), whenLabel: days <= 0 ? 'today' : 'in ' + days + ' day' + (days === 1 ? '' : 's'), soon: days <= 7, href: 'admin-approvals.html' });
  }
  // NAV publications against the stated frequency (fund document terms).
  const appraisal = products.filter((p) => p.pricing_model === 'appraisal');
  const navNoFrequency: { id: string; name: string }[] = [];
  if (appraisal.length) {
    const docs = must(await admin.from('product_documents').select('product_id, content, published_content').in('product_id', appraisal.map((p) => p.id)), 'product_documents');
    const docBy: Record<string, any> = {}; for (const d of docs) docBy[d.product_id] = d;
    for (const p of appraisal) {
      const freq = frequencyFromDocument(docBy[p.id]);
      const allowed = freq ? VALUATION_FREQUENCY_DAYS[freq] : undefined;
      if (!allowed) { navNoFrequency.push({ id: p.id, name: p.name }); continue; }
      const lastValued = p.last_tick_date; // publish-nav sets this to the real effective_date (row 143)
      const dueOn = new Date(new Date(lastValued + 'T00:00:00Z').getTime() + allowed * 86400e3);
      const daysToDue = Math.round(daysBetween(now, dueOn));
      if (dueOn > horizon) continue;
      const overdue = daysToDue < 0;
      items.push({ kind: 'nav', title: (overdue ? 'NAV publication overdue · ' : 'NAV publication due · ') + p.name, detail: 'Valued ' + freq.toLowerCase() + ' · last ' + lastValued, amount: Number(p.unit_price), when: dueOn.toISOString().slice(0, 10), whenLabel: overdue ? (-daysToDue) + ' days overdue' : (daysToDue === 0 ? 'today' : 'in ' + daysToDue + ' days'), soon: overdue || daysToDue <= 7, href: 'admin-products.html', daysOverdue: overdue ? -daysToDue : 0 });
    }
  }
  // Documents sent but unsigned, oldest first.
  const docsUnsigned = must(await admin.from('documents').select('id, client_id, filename, category, created_at, deadline_label').eq('direction', 'from').eq('status', 'Signature Required').order('created_at', { ascending: true }), 'documents');
  for (const d of docsUnsigned) {
    const days = Math.floor(daysBetween(d.created_at, now));
    items.push({ kind: 'unsigned', title: 'Document unsigned · ' + (clientNames[d.client_id] || 'Unknown client'), detail: d.filename + ' · sent ' + String(d.created_at).slice(0, 10) + (d.deadline_label ? ' · ' + d.deadline_label : ''), amount: null, when: d.created_at, whenLabel: days + ' day' + (days === 1 ? '' : 's') + ' unsigned', soon: days >= 7, href: 'admin-documents.html' });
  }
  // The monthly value snapshot — the real scheduled event (00:05 UTC on the 1st). No
  // statements are generated anywhere in this project; this is labelled as what it is.
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 5));
  if (next <= horizon) {
    items.push({ kind: 'snapshot', title: 'Monthly portfolio value snapshot', detail: 'Every active client · scheduled (no client statements are generated yet)', amount: null, when: next.toISOString(), whenLabel: next.toISOString().slice(0, 10), soon: false, href: 'admin-clients.html' });
  }
  items.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  return { items, navNoFrequency };
}

// ---------------------------------------------------------------------------------------
// 7. Worth acting on.
// ---------------------------------------------------------------------------------------
export interface Opportunity { kind: 'idle' | 'concentration' | 'alerts' | 'dormant'; title: string; detail: string; href: string; clientId?: string }

export async function worthActingOn(admin: Admin, clients: any[], firm: FirmToday, products: ProductRow[], now: Date): Promise<{ items: Opportunity[]; thresholds: Record<string, number> }> {
  const items: Opportunity[] = [];
  const names: Record<string, string> = {}; for (const c of clients) names[c.id] = c.name;
  // Idle capital.
  const idleEntries = Object.entries(firm.unallocatedByClient).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (idleEntries.length) {
    const [topId, topAmt] = idleEntries[0];
    items.push({ kind: 'idle', title: '$' + Math.round(firm.unallocated).toLocaleString('en-US') + ' sitting unallocated', detail: 'Across ' + idleEntries.length + ' client' + (idleEntries.length === 1 ? '' : 's') + ' · ' + (names[topId] || 'Unknown client') + ' holds $' + Math.round(topAmt).toLocaleString('en-US') + ' of it', href: 'admin-clients.html?client=' + topId, clientId: topId });
  }
  // Concentration: one holding ≥ CONCENTRATION_SHARE of total portfolio value, TPV ≥ min.
  const holdings = must(await admin.from('holdings').select('client_id, product_id, units'), 'holdings');
  const priceBy: Record<string, ProductRow> = {}; for (const p of products) priceBy[p.id] = p;
  const byClient: Record<string, { product: string; value: number }[]> = {};
  for (const h of holdings) (byClient[h.client_id] = byClient[h.client_id] || []).push({ product: h.product_id, value: Number(h.units) * (priceBy[h.product_id] ? Number(priceBy[h.product_id].unit_price) : 0) });
  for (const [cid, list] of Object.entries(byClient)) {
    const tpv = firm.tpvByClient[cid] || 0;
    if (tpv < CONCENTRATION_MIN_TPV) continue;
    const top = list.slice().sort((a, b) => b.value - a.value)[0];
    const share = top.value / tpv;
    if (share >= CONCENTRATION_SHARE) items.push({ kind: 'concentration', title: 'Concentration · ' + (names[cid] || 'Unknown client'), detail: Math.round(share * 100) + '% of portfolio in ' + (priceBy[top.product] ? priceBy[top.product].name : top.product), href: 'admin-clients.html?client=' + cid, clientId: cid });
  }
  // Price alerts fired in the last 7 days.
  const since = new Date(now.getTime() - 7 * 86400e3).toISOString();
  const fired = must(await admin.from('price_alerts').select('client_id, symbol, direction, target_price, fired_at, fired_price').eq('status', 'fired').gte('fired_at', since).order('fired_at', { ascending: false }), 'price_alerts');
  if (fired.length) {
    const named = fired.slice(0, 3).map((a: any) => ((names[a.client_id] || 'A client').split(' ')[0]) + ' on ' + a.symbol).join(' · ');
    items.push({ kind: 'alerts', title: fired.length + ' price alert' + (fired.length === 1 ? '' : 's') + ' fired this week', detail: named + (fired.length > 3 ? ' · +' + (fired.length - 3) + ' more' : '') + ' · each emailed once', href: 'admin-clients.html' });
  }
  // Dormant: no activity of any kind in DORMANT_DAYS while holding value.
  const active = clients.filter((c) => c.status === 'active');
  if (active.length) {
    const lastActivity: Record<string, number> = {};
    const bump = (cid: string, ts: string | null | undefined) => { if (!cid || !ts) return; const t = new Date(ts).getTime(); if (!lastActivity[cid] || t > lastActivity[cid]) lastActivity[cid] = t; };
    // Sign-ins (auth.users.last_sign_in_at) — paged, never page one alone (row 155).
    let page = 1;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error('Could not list users: ' + error.message);
      for (const u of data.users || []) bump(u.id, u.last_sign_in_at);
      if (!data.users || data.users.length < 200) break;
      page++;
    }
    for (const t of REQUEST_TABLES) for (const r of must(await admin.from(t).select('client_id, requested_at'), t)) bump(r.client_id, r.requested_at);
    for (const r of must(await admin.from('transactions').select('client_id, created_at'), 'transactions')) bump(r.client_id, r.created_at);
    for (const r of must(await admin.from('visitor_sessions').select('client_id, last_seen_at').not('client_id', 'is', null), 'visitor_sessions')) bump(r.client_id, r.last_seen_at);
    for (const c of active) {
      const held = firm.tpvByClient[c.id] || 0;
      if (held <= 0) continue;
      const last = lastActivity[c.id];
      const days = last ? Math.floor((now.getTime() - last) / 86400e3) : null;
      if (days !== null && days < DORMANT_DAYS) continue;
      items.push({ kind: 'dormant', title: c.name + ' · ' + (days === null ? 'no activity on record' : 'no activity in ' + days + ' days'), detail: (days === null ? 'Never signed in' : 'Last activity ' + new Date(last).toISOString().slice(0, 10)) + ' · $' + Math.round(held).toLocaleString('en-US') + ' held', href: 'admin-clients.html?client=' + c.id, clientId: c.id });
    }
  }
  return { items, thresholds: { overdueHours: OVERDUE_HOURS, concentrationShare: CONCENTRATION_SHARE, concentrationMinTpv: CONCENTRATION_MIN_TPV, dormantDays: DORMANT_DAYS } };
}

// ---------------------------------------------------------------------------------------
// 8. On the site now — the presence page's own live rule (seen within 45 s, not ended).
// ---------------------------------------------------------------------------------------
export async function onSiteNow(admin: Admin, now: Date): Promise<{ id: string; who: string; kind: 'client' | 'returning' | 'new'; countryCode: string | null; place: string; path: string; seconds: number; visitNumber: number }[]> {
  const since = new Date(now.getTime() - LIVE_WINDOW_SECONDS * 1000).toISOString();
  const rows = must(await admin.from('visitor_sessions').select('id, client_name, visit_number, started_at, country_code, country, city, current_path').gte('last_seen_at', since).is('ended_at', null).order('started_at', { ascending: true }), 'visitor_sessions');
  return rows.map((r: any) => ({
    id: r.id,
    who: r.client_name || ('Visitor' + (r.city ? ' · ' + r.city : (r.country ? ' · ' + r.country : ''))),
    kind: r.client_name ? 'client' : (Number(r.visit_number) >= 2 ? 'returning' : 'new'),
    countryCode: r.country_code || null, place: [r.city, r.country].filter(Boolean).join(', ') || 'Unknown location',
    path: r.current_path || '/', seconds: Math.max(0, Math.round((now.getTime() - new Date(r.started_at).getTime()) / 1000)), visitNumber: Number(r.visit_number) || 1
  }));
}

// ---------------------------------------------------------------------------------------
// 9. Needs a look.
// ---------------------------------------------------------------------------------------
export async function needsALook(admin: Admin, clients: any[], products: ProductRow[], navNoFrequency: { id: string; name: string }[]): Promise<{ productsWithoutLogo: { id: string; name: string; ticker: string | null }[]; clientsWithoutAddress: { id: string; name: string }[]; quoteFailed: { id: string; name: string; ticker: string | null; reason: string | null }[]; navNoFrequency: { id: string; name: string }[] }> {
  const productsWithoutLogo = (products as any[]).filter((p) => p.pricing_model === 'market' && !p.logo_url).map((p) => ({ id: p.id, name: p.name, ticker: p.ticker || null }));
  const quoteFailed = (products as any[]).filter((p) => p.price_status === 'quote_failed').map((p) => ({ id: p.id, name: p.name, ticker: p.ticker || null, reason: p.price_failure_reason || null }));
  const assignments = must(await admin.from('deposit_address_assignments').select('client_id').is('removed_at', null), 'deposit_address_assignments');
  const withAddress = new Set(assignments.map((a: any) => a.client_id));
  const clientsWithoutAddress = clients.filter((c) => c.status === 'active' && !withAddress.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
  return { productsWithoutLogo, clientsWithoutAddress, quoteFailed, navNoFrequency };
}

// ---------------------------------------------------------------------------------------
// 10. System health.
// ---------------------------------------------------------------------------------------
export interface HealthLine { key: string; label: string; value: string | null; state: 'ok' | 'warn' | 'bad' | 'none'; detail?: string }

export async function systemHealth(admin: Admin, products: ProductRow[], now: Date): Promise<{ lines: HealthLine[]; raw: Record<string, unknown> }> {
  const { data: sched, error: schedErr } = await admin.rpc('scheduler_health');
  if (schedErr) throw new Error('Could not read scheduler health: ' + schedErr.message);
  const jobs: any[] = (sched && sched.jobs) || [];
  const responses: any[] = (sched && sched.responses) || [];
  const job = (name: string) => jobs.find((j) => j.jobname === name);
  const latestResponse = (marker: string) => { for (const r of responses) { if (typeof r.content === 'string' && r.content.indexOf(marker) !== -1) { try { return { at: r.created, status: r.status_code, body: JSON.parse(r.content) }; } catch { return { at: r.created, status: r.status_code, body: null }; } } } return null; };
  const agoLabel = (iso: string | null | undefined) => { if (!iso) return null; const m = (now.getTime() - new Date(iso).getTime()) / 60000; if (m < 1) return 'just now'; if (m < 60) return Math.round(m) + ' min ago'; if (m < 48 * 60) return Math.round(m / 60) + ' h ago'; return Math.round(m / 1440) + ' days ago'; };
  const lines: HealthLine[] = [];

  // Price refresh: the last cron run + the last real response body.
  const refreshJob = job('marketswave-refresh-market-data');
  const refreshRun = refreshJob && refreshJob.last_run;
  const refreshResp = latestResponse('distinctSymbols');
  const refreshAgeMin = refreshRun ? (now.getTime() - new Date(refreshRun.start_time).getTime()) / 60000 : null;
  if (!refreshJob) lines.push({ key: 'refresh', label: 'Price refresh', value: 'Not scheduled', state: 'bad' });
  else if (!refreshRun) lines.push({ key: 'refresh', label: 'Price refresh', value: 'Never run', state: 'warn', detail: refreshJob.active ? 'Scheduled ' + refreshJob.schedule + ' — has not fired yet; is the scheduler configured?' : 'Job is paused' });
  else {
    const late = refreshAgeMin !== null && refreshAgeMin > REFRESH_INTERVAL_MINUTES * 2;
    const failed = refreshRun.status !== 'succeeded' || (refreshResp && refreshResp.status !== 200);
    lines.push({ key: 'refresh', label: 'Price refresh', value: 'Ran ' + agoLabel(refreshRun.start_time), state: failed ? 'bad' : (late ? 'warn' : 'ok'), detail: failed ? 'Last run ' + refreshRun.status + (refreshResp ? ' · HTTP ' + refreshResp.status : '') : (refreshResp && refreshResp.body && refreshResp.body.haltedForRateLimit ? 'Last run halted early for the rate limit (' + refreshResp.body.stockSymbolsRefreshed + ' of ' + refreshResp.body.stockSymbolsSelected + ' refreshed)' : undefined) });
  }
  // Oldest price: stock symbols only (crypto refreshes every run).
  const stocks = must(await admin.from('market_data_cache').select('symbol, last_updated').eq('asset_type', 'stock'), 'market_data_cache');
  const stockCount = stocks.length;
  let oldest: { symbol: string; ageMin: number } | null = null;
  for (const s of stocks) { const age = (now.getTime() - new Date(s.last_updated).getTime()) / 60000; if (!oldest || age > oldest.ageMin) oldest = { symbol: s.symbol, ageMin: age }; }
  const worst = worstCaseStalenessMinutes(stockCount);
  if (!oldest) lines.push({ key: 'oldest', label: 'Oldest price', value: 'No cached prices', state: 'none' });
  else lines.push({ key: 'oldest', label: 'Oldest price', value: Math.round(oldest.ageMin) + ' min', state: oldest.ageMin > worst * 2 ? 'bad' : (oldest.ageMin > worst ? 'warn' : 'ok'), detail: oldest.symbol + ' · the rotation allows ' + worst + ' min for ' + stockCount + ' stock symbols' });
  // Quote failures.
  const failedProducts = (products as any[]).filter((p) => p.price_status === 'quote_failed');
  const marketProducts = (products as any[]).filter((p) => p.pricing_model === 'market');
  lines.push({ key: 'quotes', label: 'Quote failures', value: failedProducts.length + ' of ' + marketProducts.length, state: failedProducts.length ? 'warn' : 'ok', detail: failedProducts.length ? failedProducts.slice(0, 4).map((p) => p.ticker || p.id).join(', ') : undefined });
  // Provider budget: the rotation's own accounting (not a live provider call).
  const cycles = cyclesToCoverStocks(stockCount);
  const headroom = cycles * STOCK_SYMBOLS_PER_REFRESH_RUN - stockCount;
  lines.push({ key: 'budget', label: 'Provider budget', value: STOCK_SYMBOLS_PER_REFRESH_RUN + ' of 60 per min · ' + cycles + ' cycles', state: (refreshResp && refreshResp.body && refreshResp.body.haltedForRateLimit) ? 'warn' : 'ok', detail: headroom + ' more stock symbols before the worst case grows by ' + REFRESH_INTERVAL_MINUTES + ' min' + ((refreshResp && refreshResp.body && typeof refreshResp.body.lowestRateLimitRemainingSeen === 'number') ? ' · lowest remaining seen ' + refreshResp.body.lowestRateLimitRemainingSeen : '') });
  // Alert sweep.
  const sweepJob = job('marketswave-check-price-alerts');
  const sweepRun = sweepJob && sweepJob.last_run;
  const sweepResp = latestResponse('"checked"');
  if (!sweepJob) lines.push({ key: 'sweep', label: 'Alert sweep', value: 'Not scheduled', state: 'bad' });
  else if (!sweepRun) lines.push({ key: 'sweep', label: 'Alert sweep', value: 'Never run', state: 'warn' });
  else {
    const ageMin = (now.getTime() - new Date(sweepRun.start_time).getTime()) / 60000;
    lines.push({ key: 'sweep', label: 'Alert sweep', value: 'Ran ' + agoLabel(sweepRun.start_time), state: sweepRun.status !== 'succeeded' ? 'bad' : (ageMin > REFRESH_INTERVAL_MINUTES * 2 ? 'warn' : 'ok'), detail: sweepResp && sweepResp.body ? (sweepResp.body.checked + ' active alert' + (sweepResp.body.checked === 1 ? '' : 's') + ' checked · ' + sweepResp.body.fired + ' fired') : undefined });
  }
  // Email: send failures (email_log) and bounces (messages.delivery_status), last 7 days.
  const since7 = new Date(now.getTime() - 7 * 86400e3).toISOString();
  const countRows = async (table: string, apply: (q: any) => any) => { const r = await apply(admin.from(table).select('id', { count: 'exact', head: true })); if (r.error) throw new Error('Could not count ' + table + ': ' + r.error.message); return r.count || 0; };
  const failedSends = await countRows('email_log', (q) => q.eq('status', 'failed').gte('sent_at', since7));
  const bounced = await countRows('messages', (q) => q.eq('delivery_status', 'bounced').gte('sent_at', since7));
  const emailBad = failedSends + bounced;
  lines.push({ key: 'email', label: 'Email · 7 days', value: emailBad ? (failedSends + ' failed · ' + bounced + ' bounced') : 'No failures reported', state: emailBad ? 'warn' : 'ok', detail: 'Bounces arrive only via the Resend webhook (row 218)' });
  // Monthly snapshot job and the visitor purge — the other two scheduled jobs.
  const snapJob = job('marketswave-snapshot-portfolio-values');
  lines.push({ key: 'snapshot', label: 'Monthly value snapshot', value: snapJob ? (snapJob.last_run ? 'Ran ' + agoLabel(snapJob.last_run.start_time) : 'Not yet run') : 'Not scheduled', state: !snapJob ? 'bad' : (snapJob.last_run && snapJob.last_run.status !== 'succeeded' ? 'bad' : (snapJob.last_run ? 'ok' : 'none')), detail: snapJob ? 'Next 1st of the month, 00:05 UTC' : undefined });
  // Backup — nothing exists.
  lines.push({ key: 'backup', label: 'Last backup', value: 'Not configured', state: 'warn', detail: 'No backup runs on this project — nothing to report' });
  return { lines, raw: { refreshResp: refreshResp && refreshResp.body, sweepResp: sweepResp && sweepResp.body, stockCount, worstCaseStalenessMinutes: worst } };
}

// ---------------------------------------------------------------------------------------
// The whole briefing.
// ---------------------------------------------------------------------------------------
export async function buildBriefing(admin: Admin, opts: { pmId: string; pmEmail: string | null; now?: Date; recordVisit?: boolean }) {
  const now = opts.now || new Date();
  const visit = opts.recordVisit === false
    ? { lastLooked: null, sessionStartedAt: now.toISOString(), firstBriefing: true }
    : await recordPmVisit(admin, opts.pmId, opts.pmEmail, now);
  const products = await settleAllProducts(admin);
  const clients = must(await admin.from('clients').select('id, name, email, status, created_at, account_type'), 'clients');
  const clientNames: Record<string, string> = {}; for (const c of clients) clientNames[c.id] = c.name;
  const productNames: Record<string, string> = {}; for (const p of products) productNames[p.id] = p.name;
  const firm = await firmToday(admin, clients, products, now);
  const monthStart = now.toISOString().slice(0, 8) + '01';
  const anchors = must(await admin.from('portfolio_value_snapshots').select('client_id, month_start_date, value_at_anchor').eq('month_start_date', monthStart), 'portfolio_value_snapshots');
  const [approvals, unread, since, due, acting, onSite, health] = await Promise.all([
    pendingApprovals(admin, clientNames, productNames, now),
    unreadByChannel(admin),
    sinceLastLooked(admin, visit.lastLooked, clientNames, now),
    comingUp(admin, products, clientNames, now),
    worthActingOn(admin, clients, firm, products, now),
    onSiteNow(admin, now),
    systemHealth(admin, products, now)
  ]);
  const look = await needsALook(admin, clients, products, due.navNoFrequency);
  const overdue = approvals.filter((a) => a.ageHours >= OVERDUE_HOURS);
  const oldest = approvals.length ? approvals[0] : null;
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { tpvByClient, unallocatedByClient, ...firmPublic } = firm;
  return {
    asOf: now.toISOString(),
    pm: { id: opts.pmId, email: opts.pmEmail },
    visit,
    attention: {
      overdue: { count: overdue.length, oldestAgeHours: oldest ? oldest.ageHours : null, thresholdHours: OVERDUE_HOURS },
      waiting: { count: approvals.length, today: approvals.filter((a) => new Date(a.requestedAt) >= todayStart).length },
      unread,
      aum: { value: firm.aum, monthChange: aumMonthChange(anchors, tpvByClient, monthStart), monthStart }
    },
    approvals,
    since,
    comingUp: due.items,
    acting,
    onSite,
    firm: firmPublic,
    look,
    health
  };
}
