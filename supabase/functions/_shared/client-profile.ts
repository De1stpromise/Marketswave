// ★ PM tool revamp, part 4 (2026-09-15) — the client profile, in one read (register row 233).
//
// admin-client-profile.html calls get-client-profile once per load and RENDERS the payload.
// Every figure here is computed from the real tables; the page formats and never computes
// (row 185). The money that returns already owns — the unrealised/realised split, per-position
// gain, capitalDeployed — is deliberately NOT recomputed here: the page calls the existing
// get-returns-summary for that, because duplicating money math is the one thing this codebase
// has repeatedly refused to do.
//
// ★★ WHAT THIS PAYLOAD DELIBERATELY DOES NOT CARRY, AND WHY — read before "fixing" a gap.
// The approved mockup showed three things that have NO data source anywhere in this project.
// None is rendered as a value, because a placeholder that reads as data is worse than an
// absence that reads as an absence (register row 224, and this project's own history of
// removing fabricated figures from support.html and settings.html).
//
//   1. ONBOARDING — date of birth, nationality, tax residence, risk profile, source of funds,
//      experience, horizon. These are collected by signup.html and written to
//      `marketswave_client_onboarding:<clientId>` in the BROWSER'S OWN localStorage. There is
//      no server-side onboarding table (checked: no migration and no function mentions it), so
//      a PM on a different machine genuinely cannot read them. `client_profiles` holds exactly
//      three fields — legal_name, address, id_document — and those three ARE returned below.
//      The panel renders the real three and says plainly that the rest is not readable here.
//   2. ADVISORY FEE CHARGED TO DATE — there is no invoice concept anywhere in this project
//      (project-wide grep for "invoice": zero hits). The RATE is real and is returned; the
//      charged figure is not returned at all.
//   3. KYC STATUS — `clients` has no KYC column. `status` is pending_review|active|rejected,
//      which is APPLICATION status. Rendering that as "KYC verified" would fabricate a
//      compliance claim, which is worse than fabricating a number. The real status is
//      returned and the profile labels it as what it is.
//
// Also absent and also not faked: "next statement" (nothing in this project generates
// statements — see the briefing's own Coming up panel, which says the same).
import { computeTotalPortfolioValue, round2 } from './portfolio-engine.ts';

type Admin = any;

// A session is live if it has been seen inside this window — the same figure the presence
// work uses, so the dot here and the dot on admin-presence.html can never disagree.
export const LIVE_WINDOW_SECONDS = 45;

function must(res: { data: any; error: any }, what: string): any {
  if (res.error) throw new Error('Could not read ' + what + ': ' + res.error.message);
  return res.data;
}

export async function buildClientProfile(admin: Admin, clientId: string, pmId: string) {
  const client = must(await admin.from('clients').select('*').eq('id', clientId).maybeSingle(), 'clients');
  if (!client) return null;

  const now = new Date();
  const [profile, account, pockets, docs, convs, watch, assignments, routes, notes] = await Promise.all([
    admin.from('client_profiles').select('legal_name, address, id_document, updated_at').eq('client_id', clientId).maybeSingle(),
    admin.from('account_state').select('unallocated_capital, allocated_capital, asset_returns').eq('client_id', clientId).maybeSingle(),
    admin.from('hys_pockets').select('id, pocket_type, term_label, amount, projected_interest, maturity_date, status').eq('client_id', clientId).neq('status', 'withdrawn'),
    admin.from('documents').select('id, filename, category, direction, status, is_new, storage_path, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    admin.from('conversations').select('id, kind, subject, display_id, status, last_message_at, unread_by_pm').eq('client_id', clientId).order('last_message_at', { ascending: false }),
    admin.from('watchlist_symbols').select('symbol, name, asset_type').eq('client_id', clientId),
    admin.from('deposit_address_assignments').select('id, currency, network, address_id, assigned_at').eq('client_id', clientId).is('removed_at', null),
    admin.from('deposit_routes').select('currency, network'),
    // ★ The PM's OWN notes only. RLS on pm_client_notes enforces this independently; scoping
    // here as well means the service-role read cannot leak a colleague's note even by mistake.
    admin.from('pm_client_notes').select('id, body, created_at').eq('client_id', clientId).eq('author_id', pmId).order('created_at', { ascending: false })
  ]);

  // ★ EVERY ONE OF THE READS ABOVE IS ERROR-CHECKED HERE, AND THAT IS NOT DEFENSIVE NOISE.
  // The first cut read `(x.data || [])` and never looked at `x.error`, so two genuinely wrong
  // column names — watchlist_symbols.kind and deposit_address_assignments.deposit_address_id,
  // neither of which exists — came back as EMPTY PANELS rather than as errors. Gary has 5
  // watchlist symbols and 2 assigned addresses; the page would have rendered "no watchlist"
  // and "no addresses" for him and looked entirely plausible doing it. A swallowed read is the
  // silent-failure class this codebase keeps paying for: it does not look like a bug, it looks
  // like a client with no data.
  const named: Array<[string, any]> = [
    ['client_profiles', profile], ['account_state', account], ['hys_pockets', pockets],
    ['documents', docs], ['conversations', convs], ['watchlist_symbols', watch],
    ['deposit_address_assignments', assignments], ['deposit_routes', routes],
    ['pm_client_notes', notes]
  ];
  for (const entry of named) {
    if (entry[1] && entry[1].error) throw new Error('Could not read ' + entry[0] + ': ' + entry[1].error.message);
  }

  // ---- money -------------------------------------------------------------------------------
  const acct = account.data || { unallocated_capital: 0, allocated_capital: 0, asset_returns: 0 };
  const portfolioValue = await computeTotalPortfolioValue(admin, clientId);

  const txns = must(await admin.from('transactions').select('id, type, product_id, units, price, total_value, realized_return, created_at').eq('client_id', clientId).order('created_at', { ascending: false }), 'transactions');
  const deposited = round2(txns.filter(function (t: any) { return t.type === 'DEPOSIT'; }).reduce(function (s: number, t: any) { return s + Number(t.total_value || 0); }, 0));

  const pocketRows = (pockets.data || []);
  const pocketTotal = round2(pocketRows.reduce(function (s: number, p: any) { return s + Number(p.amount || 0); }, 0));
  const fixedUpcoming = pocketRows
    .filter(function (p: any) { return p.pocket_type === 'fixed' && p.maturity_date; })
    .sort(function (a: any, b: any) { return String(a.maturity_date).localeCompare(String(b.maturity_date)); })[0] || null;

  // ---- pending across every queue, per client ----------------------------------------------
  const pendingSpecs: Array<Array<string>> = [
    ['allocation_requests', 'allocation', 'requested_amount'],
    ['sell_requests', 'sell', 'units'],
    ['deposit_requests', 'deposit', 'requested_amount'],
    ['withdrawal_requests', 'withdrawal', 'requested_amount'],
    ['hys_deposit_requests', 'hys_deposit', 'requested_amount'],
    ['hys_withdrawal_requests', 'hys_withdrawal', 'receive_amount'],
    ['profile_change_requests', 'profile_change', 'field']
  ];
  const pending: any[] = [];
  for (const spec of pendingSpecs) {
    const table = spec[0], kind = spec[1], amountCol = spec[2];
    const rows = must(await admin.from(table).select('*').eq('client_id', clientId).eq('status', 'pending'), table);
    for (const r of rows) {
      pending.push({
        kind: kind,
        id: r.id,
        amount: amountCol === 'field' ? null : (r[amountCol] === null || r[amountCol] === undefined ? null : Number(r[amountCol])),
        field: kind === 'profile_change' ? r.field : null,
        productId: r.product_id || null,
        method: r.method || null,
        requestedAt: r.requested_at || r.created_at || null
      });
    }
  }
  pending.sort(function (a, b) { return String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')); });

  // ---- product names for holdings/activity/pending ------------------------------------------
  // ★ Holdings' products are included here on purpose. get-returns-summary owns the holdings
  // MATH and returns positions without a ticker or a logo — and widening that function would
  // mean redeploying something four client-facing pages depend on, to add presentation fields
  // it has no other use for. The profile returns a product-meta map instead and the page joins
  // on productId, so the asset marks are real without touching returns at all.
  const heldRows = must(await admin.from('holdings').select('product_id').eq('client_id', clientId), 'holdings');
  const productIds = Array.from(new Set(txns.map(function (t: any) { return t.product_id; })
    .concat(pending.map(function (p: any) { return p.productId; }))
    .concat(heldRows.map(function (h: any) { return h.product_id; }))
    .filter(function (x: any) { return !!x; })));
  const products = productIds.length
    ? must(await admin.from('products').select('id, name, asset_class, ticker, logo_url').in('id', productIds), 'products')
    : [];
  const pName: Record<string, any> = {};
  for (const p of products) pName[p.id] = p;
  for (const p of pending) {
    p.product = p.productId && pName[p.productId]
      ? { name: pName[p.productId].name, ticker: pName[p.productId].ticker, logoUrl: pName[p.productId].logo_url }
      : null;
  }

  // ---- crypto addresses, assigned and NOT ---------------------------------------------------
  const addrIds = (assignments.data || []).map(function (a: any) { return a.address_id; });
  const addrRows = addrIds.length
    ? must(await admin.from('deposit_addresses').select('id, currency, network, address, status').in('id', addrIds), 'deposit_addresses')
    : [];
  const addrById: Record<string, any> = {};
  for (const a of addrRows) addrById[a.id] = a;
  const assigned = (assignments.data || []).map(function (a: any) {
    const row = addrById[a.address_id];
    return {
      currency: a.currency,
      network: a.network,
      address: row ? row.address : null,
      retired: row ? row.status === 'retired' : false,
      assignedAt: a.assigned_at
    };
  });
  const assignedKey = new Set(assigned.map(function (a: any) { return a.currency + '|' + a.network; }));
  const unassigned = (routes.data || [])
    .filter(function (r: any) { return !assignedKey.has(r.currency + '|' + r.network); })
    .map(function (r: any) { return { currency: r.currency, network: r.network }; });

  // ---- presence: live now? ------------------------------------------------------------------
  const since = new Date(now.getTime() - LIVE_WINDOW_SECONDS * 1000).toISOString();
  const live = must(await admin.from('visitor_sessions').select('id, current_path, started_at').eq('client_id', clientId).gte('last_seen_at', since).is('ended_at', null), 'visitor_sessions');

  // ---- last sign-in (real, and caveated where it is rendered) --------------------------------
  let lastSignIn: string | null = null;
  try {
    const u = await admin.auth.admin.getUserById(clientId);
    lastSignIn = u && u.data && u.data.user ? (u.data.user.last_sign_in_at || null) : null;
  } catch (_e) { lastSignIn = null; }

  const feeRow = await admin.from('advisory_fee_rate').select('rate').eq('id', true).maybeSingle();

  return {
    client: {
      id: client.id, name: client.name, email: client.email, phone: client.phone,
      accountType: client.account_type, status: client.status,
      createdAt: client.created_at, resolvedAt: client.application_resolved_at
    },
    // The three fields client_profiles genuinely holds. Anything else the mockup showed is
    // absent by design — see this file's header.
    profile: {
      legalName: profile.data ? profile.data.legal_name : null,
      address: profile.data ? profile.data.address : null,
      idDocument: profile.data ? profile.data.id_document : null,
      updatedAt: profile.data ? profile.data.updated_at : null
    },
    onboardingAvailable: false,
    money: {
      portfolioValue: round2(portfolioValue),
      unallocated: round2(Number(acct.unallocated_capital || 0)),
      assetReturns: round2(Number(acct.asset_returns || 0)),
      deposited: deposited,
      pocketTotal: pocketTotal,
      pocketCount: pocketRows.length,
      nextMaturity: fixedUpcoming ? { date: fixedUpcoming.maturity_date, label: fixedUpcoming.term_label } : null
    },
    pending: pending,
    activity: txns.slice(0, 6).map(function (t: any) {
      return {
        id: t.id, type: t.type, createdAt: t.created_at,
        totalValue: t.total_value === null ? null : Number(t.total_value),
        units: t.units === null ? null : Number(t.units),
        price: t.price === null ? null : Number(t.price),
        product: t.product_id && pName[t.product_id] ? { name: pName[t.product_id].name, ticker: pName[t.product_id].ticker } : null
      };
    }),
    addresses: { assigned: assigned, unassigned: unassigned },
    documents: (docs.data || []).map(function (d: any) {
      return {
        id: d.id, filename: d.filename, category: d.category, direction: d.direction,
        status: d.status, isNew: d.is_new, createdAt: d.created_at,
        // ★ An identity document is request-and-log, never open-freely — and separately, the
        // bytes may genuinely not exist (a row predating Storage carries a null path). Both
        // states are reported so the page can render the truthful control rather than a View
        // button that opens nothing.
        restricted: /passport|identity|id document|licence|license|national id/i.test(String(d.filename || '')),
        hasFile: !!d.storage_path
      };
    }),
    conversations: (convs.data || []).map(function (c: any) {
      return {
        id: c.id, kind: c.kind, subject: c.subject, displayId: c.display_id,
        status: c.status, lastMessageAt: c.last_message_at, unread: !!c.unread_by_pm
      };
    }),
    // productId -> presentation fields, so the page can render a real asset mark beside a
    // position without get-returns-summary having to carry them.
    productMeta: Object.keys(pName).reduce(function (acc: Record<string, any>, id: string) {
      acc[id] = { name: pName[id].name, ticker: pName[id].ticker || null, logoUrl: pName[id].logo_url || null, assetClass: pName[id].asset_class || null };
      return acc;
    }, {}),
    watchlist: (watch.data || []).map(function (w: any) { return { symbol: w.symbol, name: w.name || null, assetType: w.asset_type || null }; }),
    notes: (notes.data || []).map(function (n: any) { return { id: n.id, body: n.body, createdAt: n.created_at }; }),
    presence: { live: live.length > 0, path: live.length > 0 ? live[0].current_path : null },
    health: {
      status: client.status,
      lastReviewedAt: client.application_resolved_at,
      advisoryFeeRate: feeRow.data ? Number(feeRow.data.rate) : null,
      // No invoice concept exists, so there is no amount-charged figure to report.
      advisoryFeeChargedAvailable: false,
      lastSignInAt: lastSignIn,
      statementsAvailable: false
    },
    counts: {
      requests: pending.length,
      documents: (docs.data || []).length,
      conversations: (convs.data || []).length,
      notes: (notes.data || []).length
    }
  };
}
