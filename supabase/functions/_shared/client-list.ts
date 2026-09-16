// ★ PM tool revamp, part 5 (2026-09-15) — the client list, in ONE read (register row 235).
//
// ★★ THIS FUNCTION EXISTS BECAUSE OF A REAL BUG, AND THE SHAPE IS THE FIX.
// The old list called get-total-portfolio-value once PER CLIENT and merged the results with a
// local-engine registry, with LOCAL WINNING the dedup. A client who had ever signed in in that
// PM's browser was mirrored into the local registry by mirrorAuthenticatedClientLocally(), so
// the local shadow shadowed their real Supabase record, the row read money out of localStorage
// where a PM's browser holds none, and a real portfolio rendered as $0. Reproduced exactly:
// mirroring Gary locally flipped his row from $32,013 to $0 and removed his "Supabase" badge,
// which is precisely the pair of symptoms reported.
//
// ★ THE PRECEDENCE RULE, which is the thing to preserve if this is ever refactored:
//   SUPABASE IS AUTHORITATIVE FOR ANY CLIENT WHO EXISTS THERE.
//   The local engine is a fallback ONLY for clients who exist nowhere else.
// The old code had this exactly backwards. This function answers only for Supabase clients;
// the page adds local-only clients (John Doe, whose money genuinely does live in localStorage)
// and never lets a local record shadow a Supabase one.
//
// ★ AND THE SECOND DEFECT, which had not fired yet: the old per-client call ended
// `.catch(() => 0)`, so a failed read was indistinguishable from an unfunded client. Nothing
// here converts a failure into a number — a client whose figures cannot be computed is returned
// with `valueAvailable: false` and the page renders "unavailable", never $0.
//
// Settlement runs ONCE for the whole catalogue rather than once per client (328 products on
// real staging), so this is one settle and a handful of set-based reads regardless of headcount.
import { settleAllProducts, round2 } from './portfolio-engine.ts';

type Admin = any;

// A client with real money who has done nothing for this long reads as dormant. Activity is the
// latest of: any transaction, any request of any kind, or a real sign-in.
export const DORMANT_DAYS = 60;

function must(res: { data: any; error: any }, what: string): any {
  if (res.error) throw new Error('Could not read ' + what + ': ' + res.error.message);
  return res.data;
}

const REQUEST_TABLES = [
  'allocation_requests', 'sell_requests', 'deposit_requests', 'withdrawal_requests',
  'hys_deposit_requests', 'hys_withdrawal_requests', 'profile_change_requests'
];

export async function buildClientList(admin: Admin) {
  const now = new Date();
  const clients = must(await admin.from('clients').select('*').order('created_at', { ascending: true }), 'clients');

  // ---- settle ONCE, then price every holding from the same catalogue ------------------------
  const products = await settleAllProducts(admin);
  const priceById: Record<string, number> = {};
  const productById: Record<string, any> = {};
  for (const p of products) { priceById[p.id] = Number(p.unit_price); productById[p.id] = p; }

  const holdings = must(await admin.from('holdings').select('client_id, product_id, units, cost_basis'), 'holdings');
  const states = must(await admin.from('account_state').select('client_id, unallocated_capital, asset_returns'), 'account_state');
  const pockets = must(await admin.from('hys_pockets').select('client_id, amount, status').neq('status', 'withdrawn'), 'hys_pockets');

  const byClient: Record<string, { value: number; cost: number; count: number }> = {};
  for (const h of holdings) {
    const price = priceById[h.product_id];
    const b = byClient[h.client_id] || (byClient[h.client_id] = { value: 0, cost: 0, count: 0 });
    // A holding whose product is missing from the catalogue cannot be priced. That is a real
    // condition, not a zero — it is surfaced per client below rather than quietly summed as 0.
    if (price === undefined || price === null) { b.count += 1; b.value = NaN; continue; }
    b.value += Number(h.units) * price;
    b.cost += Number(h.cost_basis);
    b.count += 1;
  }

  const stateBy: Record<string, any> = {};
  for (const s of states) stateBy[s.client_id] = s;
  const pocketBy: Record<string, number> = {};
  for (const p of pockets) pocketBy[p.client_id] = (pocketBy[p.client_id] || 0) + Number(p.amount || 0);

  // ---- pending across all seven queues, one read each ---------------------------------------
  const pendingBy: Record<string, number> = {};
  for (const table of REQUEST_TABLES) {
    const rows = must(await admin.from(table).select('client_id').eq('status', 'pending'), table);
    for (const r of rows) pendingBy[r.client_id] = (pendingBy[r.client_id] || 0) + 1;
  }

  // ---- last activity, for dormancy ----------------------------------------------------------
  const lastBy: Record<string, string> = {};
  const bump = (id: string, at: string | null) => {
    if (!id || !at) return;
    if (!lastBy[id] || String(at) > lastBy[id]) lastBy[id] = String(at);
  };
  for (const t of must(await admin.from('transactions').select('client_id, created_at'), 'transactions')) bump(t.client_id, t.created_at);
  for (const table of REQUEST_TABLES) {
    for (const r of must(await admin.from(table).select('client_id, requested_at'), table)) bump(r.client_id, r.requested_at);
  }
  // A real sign-in counts as activity — a client who logs in and reads is not dormant.
  try {
    let page = 1;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data || !data.users || data.users.length === 0) break;
      for (const u of data.users) bump(u.id, u.last_sign_in_at);
      if (data.users.length < 200) break;
      page += 1;
    }
  } catch (_e) { /* sign-in data is a refinement of dormancy, never the only source */ }

  // ---- per client ---------------------------------------------------------------------------
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const anchors = must(
    await admin.from('portfolio_value_snapshots').select('client_id, value_at_anchor').eq('month_start_date', monthStart),
    'portfolio_value_snapshots'
  );
  const anchorBy: Record<string, number> = {};
  for (const a of anchors) anchorBy[a.client_id] = Number(a.value_at_anchor);

  const rows = clients.map(function (c: any) {
    const h = byClient[c.id] || { value: 0, cost: 0, count: 0 };
    const st = stateBy[c.id] || null;
    const unpriced = Number.isNaN(h.value);
    const unallocated = st ? Number(st.unallocated_capital) : 0;
    const realised = st ? Number(st.asset_returns) : 0;
    const allocated = unpriced ? null : round2(h.value);
    const portfolioValue = unpriced ? null : round2(unallocated + (allocated || 0) + realised);
    const unrealised = unpriced ? null : round2(h.value - h.cost);
    const totalReturn = unpriced ? null : round2((unrealised || 0) + realised);
    // Percentage against capital deployed, not against the current value — the same denominator
    // the returns work settled on (rows 185-187).
    const deployed = round2(h.cost);
    const returnPercent = unpriced || deployed <= 0 ? null : round2((totalReturn! / deployed) * 100);

    const lastAt = lastBy[c.id] || null;
    const dormantDays = lastAt
      ? Math.floor((now.getTime() - new Date(lastAt).getTime()) / 86400000)
      : null;

    // A client with no money and no history has never been funded — which is a DIFFERENT state
    // from a value of zero, and from a value that could not be computed. All three are distinct
    // here so the page can say which one it is.
    const funded = h.count > 0 || (st !== null && (unallocated !== 0 || realised !== 0)) || !!pocketBy[c.id];

    const anchor = anchorBy[c.id];
    const monthChange = (!unpriced && anchor !== undefined && portfolioValue !== null)
      ? round2(portfolioValue - anchor) : null;

    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      accountType: c.account_type,
      status: c.status,
      createdAt: c.created_at,
      // ★ No client reference is returned, deliberately. `clients` has no such column, and
      // CLIENT-0001 is the LOCAL engine's own primary-key format, not a reference scheme —
      // inventing one here would put a fabricated identifier in front of a PM. See row 235.
      valueAvailable: !unpriced,
      portfolioValue,
      unallocated: round2(unallocated),
      pocketTotal: round2(pocketBy[c.id] || 0),
      holdingsCount: h.count,
      capitalDeployed: deployed,
      unrealised,
      realised: round2(realised),
      totalReturn,
      returnPercent,
      monthChange,
      idlePercent: (!unpriced && portfolioValue && portfolioValue > 0) ? round2((unallocated / portfolioValue) * 100) : null,
      pendingCount: pendingBy[c.id] || 0,
      lastActivityAt: lastAt,
      dormantDays,
      dormant: funded && dormantDays !== null && dormantDays >= DORMANT_DAYS,
      funded
    };
  });

  // ---- the strip ----------------------------------------------------------------------------
  const priced = rows.filter(function (r: any) { return r.valueAvailable; });
  const aum = round2(priced.reduce(function (s: number, r: any) { return s + (r.portfolioValue || 0); }, 0));
  const withAnchor = priced.filter(function (r: any) { return r.monthChange !== null; });
  const strip = {
    clients: rows.length,
    active: rows.filter(function (r: any) { return r.status === 'active'; }).length,
    pendingApproval: rows.filter(function (r: any) { return r.status === 'pending_review'; }).length,
    dormant: rows.filter(function (r: any) { return r.dormant; }).length,
    aum,
    // Only stated when EVERY priced client with a portfolio has this month's anchor — a partial
    // sum would read as a change that did not happen (row 208's own rule for the same figure).
    aumMonthChange: withAnchor.length === priced.filter(function (r: any) { return r.funded; }).length && withAnchor.length > 0
      ? round2(withAnchor.reduce(function (s: number, r: any) { return s + (r.monthChange || 0); }, 0))
      : null,
    aumAnchorCoverage: withAnchor.length + '/' + priced.filter(function (r: any) { return r.funded; }).length,
    pendingTotal: rows.reduce(function (s: number, r: any) { return s + r.pendingCount; }, 0),
    pendingClients: rows.filter(function (r: any) { return r.pendingCount > 0; }).length,
    unallocatedTotal: round2(rows.reduce(function (s: number, r: any) { return s + r.unallocated; }, 0)),
    valueUnavailable: rows.length - priced.length
  };

  return { clients: rows, strip, dormantDays: DORMANT_DAYS };
}
