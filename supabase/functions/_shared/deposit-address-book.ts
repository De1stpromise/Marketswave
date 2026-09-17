// ★ PM tool revamp, part 7 (2026-09-17) — the deposit address book, composed server-side.
//
// ★ EVERY READ THAT FEEDS A DISPLAY CHECKS ITS ERROR (register row 233's rule). On this page
// the stakes are specific: "no deposits received" and "the query failed" would render as the
// SAME em dash, and "this client has no address" is the input to the amber banner that tells a
// PM someone cannot deposit at all. A swallowed read would either invent a blocked client who
// is fine, or — worse — hide one who genuinely cannot deposit. must() below throws rather than
// returning partial data, and the page paints a real error card with a retry.
//
// ★ WHY THIS IS A FUNCTION AND NOT FIVE selectTable() CALLS IN THE BROWSER, which is what the
// page did before. Two of the figures are genuine aggregations across tables — received per
// address, and the blocked-client set (every active client CROSSED with every route, minus the
// active assignments) — and doing that in the browser means five independent reads whose
// individual failures the page has to reason about one at a time. One function, one error.

export interface AddressBookDeps {
  // deno-lint-ignore no-explicit-any
  admin: any;
}

// deno-lint-ignore no-explicit-any
async function must<T>(p: Promise<{ data: T; error: any }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error('could not read ' + what + ': ' + error.message);
  return data;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// deno-lint-ignore no-explicit-any
export async function buildDepositAddressBook(admin: any) {
  const [routes, addresses, assignments, clients, deposits] = await Promise.all([
    must(admin.from('deposit_routes').select('*').order('display_order'), 'the deposit routes'),
    must(admin.from('deposit_addresses').select('*').order('created_at'), 'the deposit addresses'),
    must(admin.from('deposit_address_assignments').select('*').order('assigned_at'), 'the address assignments'),
    must(admin.from('clients').select('id, name, email, status, created_at'), 'the clients'),
    // Only CREDITED crypto deposits carry a real received figure: a pending request is money a
    // client says they sent, not money the PM has acknowledged arriving.
    must(admin.from('deposit_requests').select('*').eq('method', 'crypto'), 'the crypto deposit requests')
  ]);

  const clientById: Record<string, Record<string, unknown>> = {};
  for (const c of clients as Record<string, unknown>[]) clientById[c.id as string] = c;

  // ---- received, per address and per (address, client) -------------------------------------
  const receivedByAddress: Record<string, { total: number; count: number }> = {};
  const receivedByAddressClient: Record<string, { total: number; count: number; last: string | null }> = {};
  const depositsByAddress: Record<string, Record<string, unknown>[]> = {};
  for (const d of deposits as Record<string, unknown>[]) {
    const addrId = d.deposit_address_id as string | null;
    if (!addrId) continue;
    if (d.status !== 'credited') continue;
    const amount = Number(d.credited_amount || 0);
    const a = receivedByAddress[addrId] || (receivedByAddress[addrId] = { total: 0, count: 0 });
    a.total = round2(a.total + amount);
    a.count += 1;
    const k = addrId + '|' + (d.client_id as string);
    const ac = receivedByAddressClient[k] || (receivedByAddressClient[k] = { total: 0, count: 0, last: null });
    ac.total = round2(ac.total + amount);
    ac.count += 1;
    const when = (d.resolved_at || d.requested_at) as string;
    if (!ac.last || when > ac.last) ac.last = when;
    (depositsByAddress[addrId] || (depositsByAddress[addrId] = [])).push({
      id: d.id,
      clientId: d.client_id,
      clientName: (clientById[d.client_id as string] || {}).name || 'Unknown client',
      amount: amount,
      at: when,
      txHash: d.tx_hash || null
    });
  }
  for (const id of Object.keys(depositsByAddress)) {
    depositsByAddress[id].sort((x, y) => String(y.at).localeCompare(String(x.at)));
  }

  // ---- assignments, grouped per address ------------------------------------------------------
  const assignedByAddress: Record<string, Record<string, unknown>[]> = {};
  const everByAddress: Record<string, Set<string>> = {};
  const activeByClientRoute: Record<string, string> = {};   // clientId|CUR|NET -> addressId
  for (const a of assignments as Record<string, unknown>[]) {
    const addrId = a.address_id as string;
    (everByAddress[addrId] || (everByAddress[addrId] = new Set())).add(a.client_id as string);
    if (a.removed_at) continue;
    const k = addrId + '|' + (a.client_id as string);
    const rc = receivedByAddressClient[k];
    (assignedByAddress[addrId] || (assignedByAddress[addrId] = [])).push({
      assignmentId: a.id,
      clientId: a.client_id,
      name: (clientById[a.client_id as string] || {}).name || 'Unknown client',
      assignedAt: a.assigned_at,
      assignedByEmail: a.assigned_by_email,
      received: rc ? rc.total : 0,
      depositCount: rc ? rc.count : 0,
      lastDepositAt: rc ? rc.last : null
    });
    activeByClientRoute[(a.client_id as string) + '|' + a.currency + '|' + a.network] = addrId;
  }

  // ---- the addresses themselves --------------------------------------------------------------
  const shaped = (addresses as Record<string, unknown>[]).map((row) => {
    const id = row.id as string;
    const recv = receivedByAddress[id] || { total: 0, count: 0 };
    const holders = assignedByAddress[id] || [];
    const ever = everByAddress[id] || new Set();
    return {
      id: id,
      currency: row.currency,
      network: row.network,
      address: row.address,
      label: row.label || null,
      status: row.status,
      createdAt: row.created_at,
      createdByEmail: row.created_by_email || null,
      retiredAt: row.retired_at || null,
      clients: holders,
      clientCount: holders.length,
      everClientCount: ever.size,
      received: recv.total,
      depositCount: recv.count,
      // The deposit list the single-client panel leads with. Capped for payload size; the
      // count above is the real total either way, so a truncated list never reads as complete.
      deposits: (depositsByAddress[id] || []).slice(0, 12)
    };
  });

  // ---- groups: currency + network, in the routes' own display order ---------------------------
  const groups = (routes as Record<string, unknown>[]).map((r) => {
    const mine = shaped.filter((a) => a.currency === r.currency && a.network === r.network);
    const clientIds = new Set<string>();
    mine.forEach((a) => a.clients.forEach((c: Record<string, unknown>) => clientIds.add(c.clientId as string)));
    return {
      currency: r.currency,
      network: r.network,
      currencyName: r.currency_name,
      networkLabel: r.network_label,
      addressFormat: r.address_format,
      addresses: mine,
      addressCount: mine.length,
      clientCount: clientIds.size,
      received: round2(mine.reduce((s, a) => s + a.received, 0))
    };
  });

  // ---- BLOCKED CLIENTS: the amber banner ------------------------------------------------------
  // ★ A client with NO address on a route cannot deposit that currency at all — deploy-capital
  // shows them an honest empty state where an address should be. This is the set the Overview's
  // own "clients with no deposit address assigned" line counts, and this page is where it is
  // fixed, so the two must agree: both are "active clients with no ACTIVE assignment", and a
  // removed assignment stops counting the moment it is removed.
  const activeClients = (clients as Record<string, unknown>[])
    .filter((c) => c.status === 'active')
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const blocked = activeClients.map((c) => {
    const missing = (routes as Record<string, unknown>[])
      .filter((r) => !activeByClientRoute[(c.id as string) + '|' + r.currency + '|' + r.network])
      .map((r) => ({ currency: r.currency, network: r.network, networkLabel: r.network_label }));
    const has = (routes as Record<string, unknown>[]).length - missing.length;
    return {
      clientId: c.id,
      name: c.name,
      email: c.email,
      createdAt: c.created_at,
      missing: missing,
      missingCount: missing.length,
      hasAny: has > 0
    };
  }).filter((c) => c.missingCount > 0);

  const assignedCount = shaped.filter((a) => a.status === 'assigned').length;
  const servedClients = new Set<string>();
  shaped.forEach((a) => a.clients.forEach((c: Record<string, unknown>) => servedClients.add(c.clientId as string)));

  return {
    routes: routes,
    groups: groups,
    addresses: shaped,
    blocked: blocked,
    strip: {
      addresses: shaped.length,
      networks: groups.filter((g) => g.addressCount > 0).length,
      routeCount: (routes as Record<string, unknown>[]).length,
      assigned: assignedCount,
      servedClients: servedClients.size,
      received: round2(shaped.reduce((s, a) => s + a.received, 0)),
      depositCount: shaped.reduce((s, a) => s + a.depositCount, 0),
      retired: shaped.filter((a) => a.status === 'retired').length,
      blockedClients: blocked.length
    }
  };
}
