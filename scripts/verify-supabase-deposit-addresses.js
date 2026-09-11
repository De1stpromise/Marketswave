#!/usr/bin/env node
// ★ Crypto deposit routing (2026-09-11) — backend verification.
//
// The shared deposit address book, per-client assignments, the amount-less crypto request,
// and the credit path against it — all driven through the REAL Edge Functions on the REAL
// local stack. Reuses verify-hys-internal-funding.js's harness shape verbatim.
//
// ★ THE TWO ASSERTIONS THAT MATTER MOST:
//   - RETIREMENT IS SERVER-SIDE. An address removed from every client must be impossible to
//     reassign — not "the UI hides the button", not "the Edge Function refuses", but a direct
//     service_role INSERT into the assignments table is REFUSED by the database, and so is a
//     direct UPDATE flipping the status back. Both are tested with service_role specifically
//     because that is the one caller RLS cannot stop; only a trigger can.
//   - RLS ISOLATION. A client can only ever see an address assigned to them. Proven with a
//     SECOND real client, not a stubbed session: two clients on one address both see it, a
//     third client on nothing sees nothing, and the unassigned addresses are invisible to all.
//
// Recipients: every test client's clients.email is deliberately MALFORMED (no @) so the real
// email path exercises its honest failure logging without ever mailing anyone (row 153's
// technique).
//
// LOCAL STACK ONLY. Usage:  node scripts/verify-supabase-deposit-addresses.js
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, session: data.session };
}

async function callFunction(url, token, name, body) {
  const res = await fetch(url + '/functions/v1/' + name, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* non-JSON */ }
  return { status: res.status, body: json };
}

// Real, well-formed addresses (structurally — no funds, no keys; the BTC one is BIP-173's own
// published example).
const ADDR = {
  btc: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  btcLegacy: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  evm: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  evm2: '0x9f2C48b1E7A3d5c6B8e4F2a1D3c5E7b9A1d0e3B5',
  tron: 'TJRyWwiGxN5ZM2YbqLdcUbvvqkaGgNpDnc'
};

async function main() {
  console.log('Crypto deposit routing — backend verification, real local stack\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyDepositAddr-2026!';

  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');
  const pmToken = pm.session.access_token;

  async function makeClient(tag, name) {
    const email = 'depaddr-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    await admin.from('clients').insert({
      id: data.user.id, name, email: 'depaddr-' + tag + '-' + data.user.id, // malformed on purpose
      phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
    });
    const s = await signIn(url, anonKey, email, password);
    return { id: data.user.id, name, token: s.session.access_token, client: s.client };
  }

  const A = await makeClient('a', 'Deposit Client A');
  const B = await makeClient('b', 'Deposit Client B');
  const C = await makeClient('c', 'Deposit Client C');
  const ids = [A.id, B.id, C.id];
  const createdAddressIds = [];

  try {
    // ---- 1. Authorization ------------------------------------------------------------------
    console.log('\n1. Authorization on the three admin functions');
    for (const fn of ['add-deposit-address', 'assign-deposit-address', 'remove-deposit-address-assignment']) {
      const noAuth = await callFunction(url, null, fn, {});
      check(fn + ': no session -> 401', noAuth.status === 401, String(noAuth.status));
      const nonAdmin = await callFunction(url, A.token, fn, { currency: 'BTC', network: 'Bitcoin', address: ADDR.btc, addressId: 'x', clientId: 'y', assignmentId: 'z' });
      check(fn + ': a real client -> 403', nonAdmin.status === 403, String(nonAdmin.status));
    }

    // ---- 2. Add address: structural validation --------------------------------------------
    console.log('\n2. add-deposit-address: routes and structural validation');
    const badRoute = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'USDT', network: 'BEP-20', address: ADDR.evm });
    check('an unsupported route is refused (400)', badRoute.status === 400, JSON.stringify(badRoute.body));
    const truncated = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'BTC', network: 'Bitcoin', address: ADDR.btc.slice(0, 30) });
    check('a truncated bech32 Bitcoin address is refused', truncated.status === 400 && /Bitcoin/.test(truncated.body.error), JSON.stringify(truncated.body));
    const tronInBtc = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'BTC', network: 'Bitcoin', address: ADDR.tron });
    check('a TRON address in the Bitcoin slot is refused (the cross-network paste)', tronInBtc.status === 400, JSON.stringify(tronInBtc.body));
    const shortEvm = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'ETH', network: 'ERC-20', address: ADDR.evm.slice(0, 41) });
    check('a 41-character 0x address is refused', shortEvm.status === 400, JSON.stringify(shortEvm.body));
    const nonHex = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'ETH', network: 'ERC-20', address: '0x' + 'g'.repeat(40) });
    check('non-hex characters after 0x are refused', nonHex.status === 400, JSON.stringify(nonHex.body));
    const evmInTron = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'USDT', network: 'TRC-20', address: ADDR.evm });
    check('an 0x address in the TRC-20 slot is refused', evmInTron.status === 400, JSON.stringify(evmInTron.body));
    const spaced = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'BTC', network: 'Bitcoin', address: ADDR.btc + ' ' });
    check('trailing whitespace is refused rather than silently trimmed', spaced.status === 400 && /whitespace/.test(spaced.body.error), JSON.stringify(spaced.body));

    const btcAdd = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'BTC', network: 'Bitcoin', address: ADDR.btc, label: 'Treasury BTC 1' });
    check('a well-formed bech32 Bitcoin address is accepted', btcAdd.status === 200, JSON.stringify(btcAdd.body));
    check('...created as "available" — status is derived, not caller-set', btcAdd.body && btcAdd.body.status === 'available');
    check('...with real PM attribution', btcAdd.body && btcAdd.body.createdByEmail === 'pm@marketswave.local', btcAdd.body && btcAdd.body.createdByEmail);
    const btcLegacyAdd = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'BTC', network: 'Bitcoin', address: ADDR.btcLegacy });
    check('a legacy base58 Bitcoin address is accepted too', btcLegacyAdd.status === 200, JSON.stringify(btcLegacyAdd.body));
    const tronAdd = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'USDT', network: 'TRC-20', address: ADDR.tron });
    check('a TRON address on USDT TRC-20 is accepted', tronAdd.status === 200, JSON.stringify(tronAdd.body));
    const usdtErcAdd = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'USDT', network: 'ERC-20', address: ADDR.evm });
    check('an 0x address on USDT ERC-20 is accepted', usdtErcAdd.status === 200, JSON.stringify(usdtErcAdd.body));
    const ethAdd = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'ETH', network: 'ERC-20', address: ADDR.evm });
    check('the SAME 0x address on ETH is accepted — two routes, two rows, by design', ethAdd.status === 200, JSON.stringify(ethAdd.body));
    const dup = await callFunction(url, pmToken, 'add-deposit-address', { currency: 'BTC', network: 'Bitcoin', address: ADDR.btc });
    check('the same address on the same route again is refused (409)', dup.status === 409, JSON.stringify(dup.body));
    [btcAdd, btcLegacyAdd, tronAdd, usdtErcAdd, ethAdd].forEach((r) => { if (r.body && r.body.id) createdAddressIds.push(r.body.id); });
    const btcId = btcAdd.body.id;
    const btcLegacyId = btcLegacyAdd.body.id;
    const tronId = tronAdd.body.id;

    // ---- 3. Assign: many clients per address, one address per route per client -----------
    console.log('\n3. assign-deposit-address');
    const assignA = await callFunction(url, pmToken, 'assign-deposit-address', { addressId: btcId, clientId: A.id });
    check('client A assigned to the BTC address', assignA.status === 200, JSON.stringify(assignA.body));
    check('...assignment carries currency/network copied from the address by the trigger',
      assignA.body && assignA.body.currency === 'BTC' && assignA.body.network === 'Bitcoin');
    const assignB = await callFunction(url, pmToken, 'assign-deposit-address', { addressId: btcId, clientId: B.id });
    check('client B assigned to the SAME BTC address — many clients per address', assignB.status === 200, JSON.stringify(assignB.body));
    const afterAssign = (await admin.from('deposit_addresses').select('status').eq('id', btcId).single()).data;
    check('★ the address flipped available -> assigned by itself (trigger)', afterAssign.status === 'assigned', afterAssign.status);
    const again = await callFunction(url, pmToken, 'assign-deposit-address', { addressId: btcId, clientId: A.id });
    check('assigning A to the same address twice is refused (409)', again.status === 409, JSON.stringify(again.body));
    const second = await callFunction(url, pmToken, 'assign-deposit-address', { addressId: btcLegacyId, clientId: A.id });
    check('★ A cannot get a SECOND BTC/Bitcoin address while holding one (409)', second.status === 409 && /one address per currency and network/.test(second.body.error), JSON.stringify(second.body));
    const assignATron = await callFunction(url, pmToken, 'assign-deposit-address', { addressId: tronId, clientId: A.id });
    check('...but A CAN hold a USDT/TRC-20 address alongside the BTC one', assignATron.status === 200, JSON.stringify(assignATron.body));
    const unknownClient = await callFunction(url, pmToken, 'assign-deposit-address', { addressId: btcId, clientId: crypto.randomUUID() });
    check('an unknown client -> 404', unknownClient.status === 404, String(unknownClient.status));

    // The partial unique index is the real guard, not the function: a direct service_role
    // insert of a second active BTC assignment for A must fail at the database.
    const directDup = await admin.from('deposit_address_assignments').insert({ address_id: btcLegacyId, client_id: A.id, currency: 'BTC', network: 'Bitcoin' });
    check('★ a direct service_role insert of a second active BTC assignment for A is refused by the DB (23505)',
      !!directDup.error && directDup.error.code === '23505', JSON.stringify(directDup.error));

    // ---- 4. RLS isolation, with a second real client ---------------------------------------
    console.log('\n4. RLS: a client can only ever see an address assigned to them');
    const seenByA = (await A.client.from('deposit_addresses').select('id, address')).data || [];
    check('A sees exactly their two assigned addresses (BTC + TRC-20)', seenByA.length === 2 && seenByA.some((r) => r.id === btcId) && seenByA.some((r) => r.id === tronId), JSON.stringify(seenByA));
    check('...and NOT the unassigned legacy BTC / ERC-20 / ETH addresses', !seenByA.some((r) => r.id === btcLegacyId));
    const seenByB = (await B.client.from('deposit_addresses').select('id')).data || [];
    check('★ B (a second real client, on the same BTC address) sees that one address only', seenByB.length === 1 && seenByB[0].id === btcId, JSON.stringify(seenByB));
    const seenByC = (await C.client.from('deposit_addresses').select('id')).data || [];
    check('C, assigned nothing, sees zero addresses', seenByC.length === 0, JSON.stringify(seenByC));
    const assignmentsSeenByB = (await B.client.from('deposit_address_assignments').select('client_id')).data || [];
    check('B sees only their own assignment row, never A\'s on the shared address',
      assignmentsSeenByB.length === 1 && assignmentsSeenByB[0].client_id === B.id, JSON.stringify(assignmentsSeenByB));
    const routesSeenByC = (await C.client.from('deposit_routes').select('currency, network')).data || [];
    check('the four routes are readable by any signed-in client (the form needs them even with no address)', routesSeenByC.length === 4, String(routesSeenByC.length));
    const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const anonSees = await anonClient.from('deposit_addresses').select('id');
    check('anon sees nothing', !anonSees.error && (anonSees.data || []).length === 0, JSON.stringify(anonSees));
    const clientInsert = await A.client.from('deposit_addresses').insert({ currency: 'BTC', network: 'Bitcoin', address: ADDR.btc + 'x' });
    check('a client cannot INSERT an address', !!clientInsert.error, JSON.stringify(clientInsert.data));
    const clientAssign = await A.client.from('deposit_address_assignments').insert({ address_id: btcLegacyId, client_id: A.id, currency: 'BTC', network: 'Bitcoin' });
    check('a client cannot assign themselves an address', !!clientAssign.error, JSON.stringify(clientAssign.data));
    await A.client.from('deposit_addresses').update({ address: 'tampered' }).eq('id', btcId);
    const untampered = (await admin.from('deposit_addresses').select('address').eq('id', btcId).single()).data;
    check('a client UPDATE is a silent no-op — the address is provably unchanged', untampered.address === ADDR.btc, untampered.address);

    // ---- 5. request-deposit: the request carries no amount -------------------------------
    console.log('\n5. request-deposit (crypto): no amount, address resolved server-side');
    const noAddr = await callFunction(url, C.token, 'request-deposit', { method: 'crypto', currency: 'BTC', network: 'Bitcoin' });
    check('a client with no assigned address for the route is refused (409, names the route)', noAddr.status === 409 && /Bitcoin/.test(noAddr.body.error), JSON.stringify(noAddr.body));
    const withAmount = await callFunction(url, A.token, 'request-deposit', { method: 'crypto', currency: 'BTC', network: 'Bitcoin', amount: 500 });
    check('sending an amount with a crypto request is refused (400)', withAmount.status === 400, JSON.stringify(withAmount.body));
    const noNetwork = await callFunction(url, A.token, 'request-deposit', { method: 'crypto', currency: 'BTC' });
    check('a crypto request without a network is refused', noNetwork.status === 400, JSON.stringify(noNetwork.body));
    const badHash = await callFunction(url, A.token, 'request-deposit', { method: 'crypto', currency: 'BTC', network: 'Bitcoin', txHash: 'abc' });
    check('an implausible transaction hash is refused', badHash.status === 400, JSON.stringify(badHash.body));
    const reqA = await callFunction(url, A.token, 'request-deposit', { method: 'crypto', currency: 'BTC', network: 'Bitcoin', txHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
    check('A submits WITH a hash', reqA.status === 200, JSON.stringify(reqA.body));
    check('...the stored request has NO amount', reqA.body && reqA.body.requestedAmount === null, JSON.stringify(reqA.body && reqA.body.requestedAmount));
    check('...and snapshots the address it was shown', reqA.body && reqA.body.depositAddressId === btcId);
    check('...and the hash', reqA.body && /^e3b0/.test(reqA.body.txHash));
    const reqB = await callFunction(url, B.token, 'request-deposit', { method: 'crypto', currency: 'BTC', network: 'Bitcoin' });
    check('B submits WITHOUT a hash (optional)', reqB.status === 200 && reqB.body.txHash === null, JSON.stringify(reqB.body));
    const bankNoAmount = await callFunction(url, A.token, 'request-deposit', { method: 'bank', currency: 'USD', details: {} });
    check('the bank path still REQUIRES an amount — unchanged', bankNoAmount.status === 400 && /positive number/.test(bankNoAmount.body.error), JSON.stringify(bankNoAmount.body));
    const bankOk = await callFunction(url, A.token, 'request-deposit', { method: 'bank', currency: 'USD', amount: 1200, details: { bankName: 'Test' } });
    check('...and still works with one', bankOk.status === 200 && bankOk.body.requestedAmount === 1200, JSON.stringify(bankOk.body));
    const rawRows = (await admin.from('deposit_requests').select('requested_amount, network, deposit_address_id').eq('id', reqA.body.id)).data;
    check('DB row: requested_amount IS NULL, network and address id set', rawRows[0].requested_amount === null && rawRows[0].network === 'Bitcoin' && rawRows[0].deposit_address_id === btcId, JSON.stringify(rawRows));
    const bankNullDb = await admin.from('deposit_requests').insert({ client_id: A.id, method: 'bank', requested_amount: null, currency: 'USD', status: 'pending' });
    check('★ the DB itself refuses a bank request with no amount (constraint, not just the function)', !!bankNullDb.error, JSON.stringify(bankNullDb.data));

    // ---- 6. credit-deposit on amount-less requests: PM enters what arrived ---------------
    console.log('\n6. credit-deposit works unchanged on a request that arrived without an amount');
    const creditA = await callFunction(url, pmToken, 'credit-deposit', { requestId: reqA.body.id, confirmedAmount: 4250.5 });
    check('A credited at the PM-determined $4,250.50', creditA.status === 200 && creditA.body.creditedAmount === 4250.5, JSON.stringify(creditA.body));
    const creditB = await callFunction(url, pmToken, 'credit-deposit', { requestId: reqB.body.id, confirmedAmount: 910 });
    check('B credited at a DIFFERENT PM-determined amount, $910', creditB.status === 200 && creditB.body.creditedAmount === 910, JSON.stringify(creditB.body));
    const stateA = (await admin.from('account_state').select('unallocated_capital').eq('client_id', A.id).single()).data;
    const stateB = (await admin.from('account_state').select('unallocated_capital').eq('client_id', B.id).single()).data;
    check('★ both landed correctly, each on its own account', Number(stateA.unallocated_capital) === 4250.5 && Number(stateB.unallocated_capital) === 910, JSON.stringify([stateA, stateB]));
    const txns = (await admin.from('transactions').select('client_id, type, total_value').in('client_id', [A.id, B.id])).data || [];
    check('...with one DEPOSIT ledger row each', txns.length === 2 && txns.every((t) => t.type === 'DEPOSIT'), JSON.stringify(txns));
    const noConfirmed = await callFunction(url, pmToken, 'credit-deposit', { requestId: bankOk.body.id });
    check('credit still demands a confirmedAmount (no fallback to a requested one)', noConfirmed.status === 400, JSON.stringify(noConfirmed.body));
    const emailRows = (await admin.from('email_log').select('subject, status').eq('related_entity_id', reqA.body.id)).data || [];
    check('the receipt and credit emails were attempted for A (logged, honest failure to the malformed recipient)',
      emailRows.length === 2 && emailRows.every((e) => e.status === 'failed'), JSON.stringify(emailRows));

    // reject on an amount-less request must not crash (the old email line called
    // .toLocaleString() on requested_amount).
    const reqB2 = await callFunction(url, B.token, 'request-deposit', { method: 'crypto', currency: 'BTC', network: 'Bitcoin' });
    const rejectB2 = await callFunction(url, pmToken, 'reject-deposit', { requestId: reqB2.body.id, reason: 'No transfer found on-chain' });
    check('reject-deposit on an amount-less request succeeds (no null crash in the email)', rejectB2.status === 200 && rejectB2.body.status === 'rejected', JSON.stringify(rejectB2.body));
    const rejectEmail = (await admin.from('email_log').select('status').eq('related_entity_id', reqB2.body.id)).data || [];
    check('...and its email was genuinely composed and attempted', rejectEmail.length >= 2, JSON.stringify(rejectEmail));

    // ---- 7. Retirement, enforced server-side -----------------------------------------------
    console.log('\n7. Retirement: removed from all clients -> retired, never reassignable');
    const removeA = await callFunction(url, pmToken, 'remove-deposit-address-assignment', { assignmentId: assignA.body.id });
    check('A removed from the BTC address', removeA.status === 200 && removeA.body.addressRetired === false, JSON.stringify(removeA.body));
    check('...address still "assigned" while B remains on it', removeA.body.addressStatus === 'assigned', removeA.body.addressStatus);
    const removeAgain = await callFunction(url, pmToken, 'remove-deposit-address-assignment', { assignmentId: assignA.body.id });
    check('removing A twice is refused (409)', removeAgain.status === 409, JSON.stringify(removeAgain.body));
    const removeB = await callFunction(url, pmToken, 'remove-deposit-address-assignment', { assignmentId: assignB.body.id });
    check('★ removing the LAST client retires the address (reported by the function)', removeB.status === 200 && removeB.body.addressRetired === true, JSON.stringify(removeB.body));
    const retiredRow = (await admin.from('deposit_addresses').select('status, retired_at').eq('id', btcId).single()).data;
    check('...status = retired, retired_at set', retiredRow.status === 'retired' && !!retiredRow.retired_at, JSON.stringify(retiredRow));
    const history = (await admin.from('deposit_address_assignments').select('client_id, removed_at').eq('address_id', btcId)).data || [];
    check('...the assignment HISTORY survives (2 rows, both removed) — "Previously 2 clients"', history.length === 2 && history.every((h) => !!h.removed_at), JSON.stringify(history));
    const reassign = await callFunction(url, pmToken, 'assign-deposit-address', { addressId: btcId, clientId: C.id });
    check('assigning a NEW client to the retired address via the function is refused (409)', reassign.status === 409 && /retired/.test(reassign.body.error), JSON.stringify(reassign.body));
    const directRetired = await admin.from('deposit_address_assignments').insert({ address_id: btcId, client_id: C.id, currency: 'BTC', network: 'Bitcoin' });
    check('★★ a direct service_role INSERT onto the retired address is refused BY THE DATABASE', !!directRetired.error && /DEPOSIT_ADDRESS_RETIRED/.test(directRetired.error.message), JSON.stringify(directRetired.error));
    const flipBack = await admin.from('deposit_addresses').update({ status: 'available' }).eq('id', btcId);
    check('★★ a direct service_role UPDATE flipping it back to available is refused BY THE DATABASE', !!flipBack.error && /DEPOSIT_ADDRESS_RETIRED/.test(flipBack.error.message), JSON.stringify(flipBack.error));
    const stillRetired = (await admin.from('deposit_addresses').select('status').eq('id', btcId).single()).data;
    check('...and it is still retired afterwards', stillRetired.status === 'retired', stillRetired.status);
    const cStillNone = (await C.client.from('deposit_addresses').select('id')).data || [];
    check('C still sees nothing (the refused assignment left no trace)', cStillNone.length === 0);
    const neverAssigned = (await admin.from('deposit_addresses').select('status').eq('id', btcLegacyId).single()).data;
    check('an address that was NEVER assigned stays "available" — retirement only follows real history', neverAssigned.status === 'available', neverAssigned.status);
    const aNowFree = await callFunction(url, pmToken, 'assign-deposit-address', { addressId: btcLegacyId, clientId: A.id });
    check('A, now off the retired address, can be given the other BTC address', aNowFree.status === 200, JSON.stringify(aNowFree.body));
    const aSeesNew = (await A.client.from('deposit_addresses').select('id')).data || [];
    check('...and A sees the new one and no longer the retired one', aSeesNew.some((r) => r.id === btcLegacyId) && !aSeesNew.some((r) => r.id === btcId), JSON.stringify(aSeesNew));
  } finally {
    // Order matters: requests reference addresses; assignments reference addresses.
    await admin.from('deposit_requests').delete().in('client_id', ids);
    await admin.from('transactions').delete().in('client_id', ids);
    await admin.from('account_state').delete().in('client_id', ids);
    await admin.from('email_log').delete().like('recipient', 'depaddr-%');
    if (createdAddressIds.length) {
      await admin.from('deposit_address_assignments').delete().in('address_id', createdAddressIds);
      await admin.from('deposit_addresses').delete().in('id', createdAddressIds);
    }
    for (const id of ids) {
      await admin.from('clients').delete().eq('id', id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log('  cleanup: deleteUser(' + id + ') -> ' + error.message);
    }
    const leftover = (await admin.from('deposit_addresses').select('id').in('id', createdAddressIds)).data || [];
    if (leftover.length) console.log('  cleanup WARNING: ' + leftover.length + ' address row(s) survived cleanup');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err && err.stack);
  process.exit(1);
});
