// ★ PM tool revamp, part 7 — the deposit address book, at the API level (register row 237).
//
// What this suite exists to prove, beyond "the function returns something":
//   1. PYUSD END TO END through the REAL paths — the route, a real address added through
//      add-deposit-address (which looks its format up from the route, so this also CONFIRMS
//      rather than assumes that 'evm' already covers it), assigned to a real client, visible
//      to that client through the same RLS-scoped read deploy-capital does, and a real deposit
//      acknowledged against it.
//   2. A REAL STRUCTURAL REJECTION, not just the happy path — a TRON address refused on an
//      ERC-20 route, by the real server, with no row created.
//   3. THE BLOCKED SET is the thing the amber banner is built from, so it must appear when a
//      client has no address and DISAPPEAR the moment one is assigned.
//   4. A RETIRED address keeps its history and refuses a new assignment.
//   5. Gary's two real addresses report their real received figures, cross-checked against an
//      independent sum over the deposit_requests table rather than against the function's own.
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'AddrBook-2026!';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: '..', encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

async function callAs(url, token, name, body) {
  const r = await fetch(url + '/functions/v1/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {})
  });
  let json = null;
  try { json = await r.json(); } catch (_e) {}
  return { status: r.status, body: json };
}

// ★ A real EVM address for the PYUSD route. 0x + 40 hex, structurally valid and not one of the
// addresses any other fixture uses — the row-212 discipline applied to an address rather than a
// symbol: this suite creates and deletes it, so it must not collide with real data.
const PYUSD_ADDRESS = '0x' + crypto.randomBytes(20).toString('hex');
const TRON_ADDRESS = 'TQm7xKp2VrN8sLd4Wf9Yc3Hj6Bk1Rt5Zab'.slice(0, 34);

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);
  const anon = createClient(st.API_URL, st.ANON_KEY);

  const { data: pm, error: pmErr } = await anon.auth.signInWithPassword({
    email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!'
  });
  if (pmErr) throw new Error('PM sign-in: ' + pmErr.message);
  const pmToken = pm.session.access_token;

  const created = { clients: [], addresses: [], deposits: [] };

  // ★ SWEEP ON ENTRY. A teardown can only remove what it RECORDED, and an earlier run of this
  // suite recorded nothing because its assumption about add-deposit-address's response shape
  // was wrong — so the address it created outlived it and skewed the next run's group totals.
  // The same reasoning as the harness-teardown helper's own entry sweep: a hard failure between
  // "created" and "recorded" is exactly when cleanup is most needed and least likely to happen.
  {
    const { data: stale } = await admin.from('deposit_addresses').select('id').like('label', 'Address book test %');
    for (const row of stale || []) {
      await admin.from('deposit_address_assignments').delete().eq('address_id', row.id);
      await admin.from('deposit_requests').delete().eq('deposit_address_id', row.id);
      await admin.from('deposit_addresses').delete().eq('id', row.id);
    }
    if ((stale || []).length) console.log('sweep: cleared ' + stale.length + ' leftover test address(es)');
  }

  try {
    console.log('\n=== PART 1: authorization ===\n');
    const noAuth = await fetch(st.API_URL + '/functions/v1/get-deposit-address-book', { method: 'POST', body: '{}' });
    check('an unauthenticated caller is refused (401)', noAuth.status === 401, String(noAuth.status));

    const email = 'addrbook-' + SUF + '@invalid.test';
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (cuErr) throw cuErr;
    created.clients.push(cu.user.id);
    await admin.from('clients').insert({
      id: cu.user.id, name: 'Address Book Client ' + SUF, email, phone: '+46 70 555 5555',
      account_type: 'Individual Account', status: 'active'
    });
    const { data: cs } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const clientToken = cs.session.access_token;
    const forbidden = await callAs(st.API_URL, clientToken, 'get-deposit-address-book');
    check('a real signed-in CLIENT is refused (403) — the book is admin-only',
      forbidden.status === 403, String(forbidden.status));

    console.log('\n=== PART 2: PYUSD is a real route, and the format is CONFIRMED not assumed ===\n');
    const { data: routes, error: rErr } = await admin.from('deposit_routes').select('*').order('display_order');
    check('the routes read cleanly', !rErr, rErr && rErr.message);
    const pyusd = routes.filter((r) => r.currency === 'PYUSD')[0];
    check('★ PYUSD exists as a real route', !!pyusd, routes.map((r) => r.currency + '/' + r.network).join(', '));
    check('★ ...on ERC-20 only — PayPal USD also exists on Solana, which has no address format here',
      !!pyusd && pyusd.network === 'ERC-20' && routes.filter((r) => r.currency === 'PYUSD').length === 1);
    check('★ ...and its address_format is the SAME evm rule ETH and USDT-ERC-20 already use',
      !!pyusd && pyusd.address_format === 'evm' &&
      routes.filter((r) => r.address_format === 'evm').map((r) => r.currency).sort().join(',') === 'ETH,PYUSD,USDT',
      pyusd && pyusd.address_format);
    check('...with a real display name a client will see', !!pyusd && pyusd.currency_name === 'PayPal USD');

    console.log('\n=== PART 3: ★ A REAL STRUCTURAL REJECTION, before the happy path ===\n');
    const { count: before } = await admin.from('deposit_addresses').select('id', { count: 'exact', head: true });
    const rejected = await callAs(st.API_URL, pmToken, 'add-deposit-address', {
      currency: 'PYUSD', network: 'ERC-20', address: TRON_ADDRESS
    });
    check('★ a TRON address on the PYUSD (ERC-20) route is refused by the REAL server',
      rejected.status === 400, rejected.status + ' ' + JSON.stringify(rejected.body));
    check('★ ...and the reason names the real rule, not a generic failure',
      /starts with 0x|ERC-20/i.test(String(rejected.body && rejected.body.error)),
      String(rejected.body && rejected.body.error));
    const { count: after } = await admin.from('deposit_addresses').select('id', { count: 'exact', head: true });
    check('★ ...and NOTHING was created — a refused address leaves no row behind',
      after === before, before + ' → ' + after);

    const truncated = await callAs(st.API_URL, pmToken, 'add-deposit-address', {
      currency: 'PYUSD', network: 'ERC-20', address: PYUSD_ADDRESS.slice(0, 40)
    });
    check('a truncated paste is refused too (the realistic error, not an exotic one)',
      truncated.status === 400, truncated.status + ' ' + JSON.stringify(truncated.body));

    console.log('\n=== PART 4: PYUSD end to end — add, assign, the client sees it, a deposit lands ===\n');
    const added = await callAs(st.API_URL, pmToken, 'add-deposit-address', {
      currency: 'PYUSD', network: 'ERC-20', address: PYUSD_ADDRESS, label: 'Address book test ' + SUF
    });
    // add-deposit-address returns toAddressClientShape(row) FLAT, not wrapped.
    check('★ a real PYUSD address is added through the REAL function — the evm rule genuinely covers it',
      added.status === 200 && added.body && added.body.id, JSON.stringify(added.body).slice(0, 160));
    const addrId = added.body && added.body.id;
    if (addrId) created.addresses.push(addrId);
    check('...and it starts life available, never assigned',
      added.body && added.body.status === 'available', added.body && added.body.status);

    let book = (await callAs(st.API_URL, pmToken, 'get-deposit-address-book')).body;
    const blockedBefore = book.blocked.filter((b) => b.clientId === cu.user.id)[0];
    check('★ the client appears in the BLOCKED set while they have no address',
      !!blockedBefore && blockedBefore.missingCount === routes.length,
      blockedBefore ? blockedBefore.missingCount + ' of ' + routes.length : 'not blocked');
    check('...and PYUSD is named among what they are missing',
      !!blockedBefore && blockedBefore.missing.some((m) => m.currency === 'PYUSD'));

    const assigned = await callAs(st.API_URL, pmToken, 'assign-deposit-address', {
      addressId: addrId, clientId: cu.user.id
    });
    check('★ the PYUSD address is assigned to a real client', assigned.status === 200,
      assigned.status + ' ' + JSON.stringify(assigned.body).slice(0, 140));

    book = (await callAs(st.API_URL, pmToken, 'get-deposit-address-book')).body;
    const blockedAfter = book.blocked.filter((b) => b.clientId === cu.user.id)[0];
    check('★ the blocked entry SHRINKS the moment they are assigned — the banner is live, not a snapshot',
      !!blockedAfter && blockedAfter.missingCount === routes.length - 1 &&
      !blockedAfter.missing.some((m) => m.currency === 'PYUSD'),
      blockedAfter ? blockedAfter.missingCount + ' missing' : 'gone entirely');
    check('...and the address now reads assigned, serving exactly this client',
      book.addresses.filter((a) => a.id === addrId)[0].status === 'assigned' &&
      book.addresses.filter((a) => a.id === addrId)[0].clients.map((c) => c.clientId).join() === cu.user.id);

    // ★ THE CLIENT'S OWN VIEW — the same RLS-scoped read deploy-capital.html makes. A PM's own
    // read proving an address exists says nothing about whether the client can SEE it.
    const clientSide = createClient(st.API_URL, st.ANON_KEY);
    await clientSide.auth.signInWithPassword({ email, password: PASSWORD });
    const { data: theirRoutes } = await clientSide.from('deposit_routes').select('*');
    const { data: theirAddresses, error: taErr } = await clientSide.from('deposit_addresses').select('*');
    check('★ the client sees PYUSD in their own deposit picker options',
      !taErr && theirRoutes.some((r) => r.currency === 'PYUSD'), taErr && taErr.message);
    check('★ ...and sees THEIR OWN PYUSD address, through RLS, exactly as deploy-capital reads it',
      theirAddresses.some((a) => a.id === addrId && a.address === PYUSD_ADDRESS),
      theirAddresses.map((a) => a.currency).join(','));
    check('...and sees no address that is not theirs',
      theirAddresses.every((a) => a.id === addrId), String(theirAddresses.length));

    // A real deposit acknowledged against it, through the real client-callable function.
    const dep = await callAs(st.API_URL, clientToken, 'request-deposit', {
      method: 'crypto', currency: 'PYUSD', network: 'ERC-20', txHash: '0x' + crypto.randomBytes(32).toString('hex')
    });
    check('★ the client can raise a real PYUSD deposit request against it',
      dep.status === 200 && dep.body && dep.body.id, dep.status + ' ' + JSON.stringify(dep.body).slice(0, 140));
    if (dep.body && dep.body.id) created.deposits.push(dep.body.id);
    check('...and the request records the address they were shown, not just a currency',
      dep.body && dep.body.depositAddressId === addrId, dep.body && String(dep.body.depositAddressId));

    const credited = await callAs(st.API_URL, pmToken, 'credit-deposit', {
      requestId: dep.body.id, confirmedAmount: 2500
    });
    check('★ the PM credits it — a real PYUSD deposit, acknowledged end to end',
      credited.status === 200, credited.status + ' ' + JSON.stringify(credited.body).slice(0, 140));

    book = (await callAs(st.API_URL, pmToken, 'get-deposit-address-book')).body;
    const pyRow = book.addresses.filter((a) => a.id === addrId)[0];
    check('★ the address book reports the real received figure for it',
      pyRow.received === 2500 && pyRow.depositCount === 1, pyRow.received + ' / ' + pyRow.depositCount);
    check('...attributed to the right client, on the address\'s own deposit list',
      pyRow.deposits.length === 1 && pyRow.deposits[0].clientId === cu.user.id && pyRow.deposits[0].amount === 2500);
    const pyGroup = book.groups.filter((g) => g.currency === 'PYUSD')[0];
    check('...and the PYUSD group\'s own totals follow',
      pyGroup.addressCount === 1 && pyGroup.clientCount === 1 && pyGroup.received === 2500,
      JSON.stringify({ a: pyGroup.addressCount, c: pyGroup.clientCount, r: pyGroup.received }));

    console.log('\n=== PART 5: Gary\'s real addresses, cross-checked against an independent sum ===\n');
    const { data: gary } = await admin.from('clients').select('id, name').ilike('name', '%Gary%').maybeSingle();
    if (!gary) {
      console.log('  SKIP  Gary is not seeded — run `node seed-client-gary.mjs` first.');
    } else {
      // The oracle is the deposit_requests table itself, never the function's own arithmetic.
      const { data: garyDeps } = await admin.from('deposit_requests')
        .select('deposit_address_id, credited_amount, status, method')
        .eq('client_id', gary.id).eq('method', 'crypto').eq('status', 'credited');
      const expected = {};
      garyDeps.forEach((d) => {
        if (!d.deposit_address_id) return;
        const e = expected[d.deposit_address_id] || (expected[d.deposit_address_id] = { total: 0, n: 0 });
        e.total = Math.round((e.total + Number(d.credited_amount)) * 100) / 100;
        e.n += 1;
      });
      const ids = Object.keys(expected);
      check('GUARD: Gary genuinely has deposit history on more than one address — otherwise this proves little',
        ids.length >= 2, ids.length + ' addresses with credited deposits');
      let mismatches = 0;
      ids.forEach((id) => {
        const row = book.addresses.filter((a) => a.id === id)[0];
        if (!row || row.received !== expected[id].total || row.depositCount !== expected[id].n) {
          mismatches++;
          console.log('      ' + id + ': ' + (row ? row.received + '/' + row.depositCount : 'missing') +
            ' vs ' + expected[id].total + '/' + expected[id].n);
        }
      });
      check('★ every one of Gary\'s addresses reports the received figure the LEDGER says, to the cent',
        mismatches === 0, mismatches + ' mismatch(es)');
      const garyRows = book.addresses.filter((a) => a.clients.some((c) => c.clientId === gary.id));
      check('★ ...and his per-client figure on each address matches too',
        garyRows.length >= 2 && garyRows.every((a) => {
          const mine = a.clients.filter((c) => c.clientId === gary.id)[0];
          return mine && mine.received === (expected[a.id] ? expected[a.id].total : 0);
        }), garyRows.map((a) => a.currency + ':' + (a.clients.filter((c) => c.clientId === gary.id)[0] || {}).received).join(' '));
    }

    console.log('\n=== PART 6: one address per client per route, and a retired address ===\n');
    const second = await callAs(st.API_URL, pmToken, 'add-deposit-address', {
      currency: 'PYUSD', network: 'ERC-20', address: '0x' + crypto.randomBytes(20).toString('hex'),
      label: 'Address book test ' + SUF + ' second'
    });
    const secondId = second.body && second.body.id;
    if (secondId) created.addresses.push(secondId);
    const dupe = await callAs(st.API_URL, pmToken, 'assign-deposit-address', {
      addressId: secondId, clientId: cu.user.id
    });
    check('★ a client cannot hold two addresses on the SAME route — refused server-side',
      dupe.status >= 400, dupe.status + ' ' + JSON.stringify(dupe.body).slice(0, 120));

    // Retire the second address by removing its only client — first give it one.
    const tmpEmail = 'addrbook-tmp-' + SUF + '@invalid.test';
    const { data: tu } = await admin.auth.admin.createUser({ email: tmpEmail, password: PASSWORD, email_confirm: true });
    created.clients.push(tu.user.id);
    await admin.from('clients').insert({
      id: tu.user.id, name: 'Retire Test ' + SUF, email: tmpEmail, phone: '+46 70 666 6666',
      account_type: 'Individual Account', status: 'active'
    });
    const tmpAssign = await callAs(st.API_URL, pmToken, 'assign-deposit-address', { addressId: secondId, clientId: tu.user.id });
    check('GUARD: the second address has a client to remove', tmpAssign.status === 200, String(tmpAssign.status));
    const { data: asgRow } = await admin.from('deposit_address_assignments')
      .select('id').eq('address_id', secondId).eq('client_id', tu.user.id).is('removed_at', null).maybeSingle();
    const removed = await callAs(st.API_URL, pmToken, 'remove-deposit-address-assignment', { assignmentId: asgRow.id });
    check('removing the LAST client succeeds', removed.status === 200, String(removed.status));

    book = (await callAs(st.API_URL, pmToken, 'get-deposit-address-book')).body;
    const retiredRow = book.addresses.filter((a) => a.id === secondId)[0];
    check('★ ...and RETIRES the address — a server-side trigger owns that, not the UI',
      retiredRow.status === 'retired', retiredRow.status);
    check('★ the retired address KEEPS its history — it still knows how many it ever served',
      retiredRow.everClientCount === 1 && retiredRow.clientCount === 0,
      retiredRow.everClientCount + ' ever / ' + retiredRow.clientCount + ' now);');
    const reassign = await callAs(st.API_URL, pmToken, 'assign-deposit-address', {
      addressId: secondId, clientId: tu.user.id
    });
    check('★ a retired address REFUSES a new assignment, server-side',
      reassign.status >= 400, reassign.status + ' ' + JSON.stringify(reassign.body).slice(0, 120));
    const { data: stillRetired } = await admin.from('deposit_addresses').select('status').eq('id', secondId).single();
    check('...and is provably untouched by the refused attempt', stillRetired.status === 'retired', stillRetired.status);

    console.log('\n=== PART 7: the strip, and every read error-checked ===\n');
    const fs = require('fs');
    const src = fs.readFileSync('../supabase/functions/_shared/deposit-address-book.ts', 'utf8');
    check('★ the shared module contains no unchecked `.data || []` — every read goes through must()',
      !/\.data\s*\|\|\s*\[\]/.test(src));
    check('...and must() genuinely wraps every one of its reads',
      (src.match(/must\(admin/g) || []).length >= 5,
      String((src.match(/must\(admin/g) || []).length) + ' must() calls');
    const indepAddr = (await admin.from('deposit_addresses').select('id', { count: 'exact', head: true })).count;
    check('the strip\'s address count equals an independent Postgres count',
      book.strip.addresses === indepAddr, book.strip.addresses + ' vs ' + indepAddr);
    check('the strip\'s blocked count equals the blocked list it is built from',
      book.strip.blockedClients === book.blocked.length);
    check('every group carries its route\'s own label, so USDT never appears without its network',
      book.groups.every((g) => !!g.networkLabel && !!g.currencyName) &&
      book.groups.filter((g) => g.currency === 'USDT').length === 2);

  } finally {
    // ---- cleanup. Assignments and deposits reference BOTH a client and an address, so the
    // CLIENTS go before the addresses; nothing here references the PM.
    for (const id of created.clients) {
      await admin.from('deposit_address_assignments').delete().eq('client_id', id);
      await admin.from('deposit_requests').delete().eq('client_id', id);
      await admin.from('transactions').delete().eq('client_id', id);
      await admin.from('account_state').delete().eq('client_id', id);
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const id of created.addresses) {
      await admin.from('deposit_address_assignments').delete().eq('address_id', id);
      await admin.from('deposit_addresses').delete().eq('id', id);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('DEPOSIT ADDRESS BOOK: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('\nVERIFY FAILED WITH AN ERROR: ' + (e && e.message)); process.exit(1); });
