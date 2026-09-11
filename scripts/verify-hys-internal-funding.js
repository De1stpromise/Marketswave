#!/usr/bin/env node
// ★ Savings deposit from unallocated capital (2026-09-11).
//
// Real-stack verification for funding an HYS pocket from capital already sitting in the
// client's own account, rather than from an incoming external payment. Reuses
// verify-supabase-hys.js's own harness shape verbatim (same credential/sign-in/cleanup
// helpers, same real-Edge-Function calls) — this is a new funding SOURCE on an existing
// queue, so it belongs alongside that suite rather than reinventing one.
//
// ★ THE ASSERTION THAT MATTERS MOST IS THE RACE (Part 3). A client can commit $50k here and
// then allocate that same capital elsewhere before a PM acts. The approval must be refused
// rather than driving unallocated capital negative — the same race approve-withdrawal
// already guards, whose pattern credit-hys-deposit reuses. Everything else in this file
// could pass with that broken, which is why it is tested against real, genuinely-moved
// capital rather than a simulated balance.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same
// localhost-only guard as every other local-stack script here.
//
// Usage:  node scripts/verify-hys-internal-funding.js
// Requires: the local stack running, this task's migration applied, and the edge-runtime
// container reachable.
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
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
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {}
    ),
    body: JSON.stringify(body || {})
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* a 204 or a non-JSON body */ }
  return { status: res.status, body: json };
}

async function cleanupClient(admin, userId) {
  await admin.from('hys_withdrawal_requests').delete().eq('client_id', userId);
  await admin.from('hys_deposit_requests').delete().eq('client_id', userId);
  await admin.from('hys_pockets').delete().eq('client_id', userId);
  await admin.from('transactions').delete().eq('client_id', userId);
  await admin.from('account_state').delete().eq('client_id', userId);
  await admin.from('clients').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);
}

async function unallocatedOf(admin, clientId) {
  const { data } = await admin.from('account_state').select('unallocated_capital').eq('client_id', clientId).maybeSingle();
  return data ? Number(data.unallocated_capital) : 0;
}

async function main() {
  console.log('Savings deposit from unallocated capital — real local stack\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'hysint-' + suffix + '@test.marketswave.local';
  const password = 'VerifyHysInternal-2026!';

  const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');
  const adminToken = adminSignIn.session.access_token;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;
  await admin.from('clients').insert({
    id: clientId, name: 'HYS Internal Verify', email: 'hysint-verify-' + clientId,
    phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
  });

  const c = await signIn(url, anonKey, email, password);
  const token = c.session.access_token;

  try {
    // A real funded account to transfer FROM.
    await admin.from('account_state').insert({
      client_id: clientId, unallocated_capital: 60000, allocated_capital: 0, asset_returns: 0
    });

    // ---- Part 1: request-time validation ------------------------------------------------
    console.log('\n1. Request-time validation');
    const tooBig = await callFunction(url, token, 'request-hys-deposit', {
      pocketType: 'ayw', amount: 75000, method: 'internal'
    });
    check('a transfer beyond current unallocated capital is refused at request time',
      tooBig.status === 409, JSON.stringify(tooBig.body));
    check('...with the real available figure in the message, not a generic refusal',
      /60,000|60000/.test(String(tooBig.body && tooBig.body.error)), String(tooBig.body && tooBig.body.error));
    check('...and no row was created',
      ((await admin.from('hys_deposit_requests').select('id').eq('client_id', clientId)).data || []).length === 0);

    const badMethod = await callFunction(url, token, 'request-hys-deposit', {
      pocketType: 'ayw', amount: 100, method: 'wire'
    });
    check('an unknown method is still refused', badMethod.status === 400);

    // ---- Part 2: the real end-to-end transfer -------------------------------------------
    console.log('\n2. A real internal transfer, end to end');
    const beforeUnallocated = await unallocatedOf(admin, clientId);
    const created1 = await callFunction(url, token, 'request-hys-deposit', {
      pocketType: 'fixed', term: { mode: 'short', value: 6 }, amount: 20000, method: 'internal'
    });
    check('a valid internal transfer request is accepted', created1.status === 200, JSON.stringify(created1.body));
    const reqId = created1.body && created1.body.id;
    check('...stored with method "internal"', created1.body && created1.body.method === 'internal');
    check('...and carries no fabricated external destination details',
      created1.body && created1.body.details === null, JSON.stringify(created1.body && created1.body.details));
    check('REQUESTING moves no capital — unallocated is untouched while pending',
      (await unallocatedOf(admin, clientId)) === beforeUnallocated,
      'before ' + beforeUnallocated + ', now ' + (await unallocatedOf(admin, clientId)));

    // The PM-editable amount is meaningless here and must be refused, not silently accepted.
    const edited = await callFunction(url, adminToken, 'credit-hys-deposit', {
      requestId: reqId, confirmedAmount: 19500
    });
    check('a PM-adjusted amount on an internal transfer is refused', edited.status === 400, JSON.stringify(edited.body));
    check('...and the request is still pending after that refusal',
      (await admin.from('hys_deposit_requests').select('status').eq('id', reqId).single()).data.status === 'pending');
    check('...and no capital moved on the refused attempt',
      (await unallocatedOf(admin, clientId)) === beforeUnallocated);

    const approved = await callFunction(url, adminToken, 'credit-hys-deposit', {
      requestId: reqId, confirmedAmount: 20000
    });
    check('approving at the exact requested amount succeeds', approved.status === 200, JSON.stringify(approved.body));

    const afterUnallocated = await unallocatedOf(admin, clientId);
    check('CAPITAL GENUINELY LEFT UNALLOCATED — 60,000 -> 40,000',
      afterUnallocated === 40000, 'got ' + afterUnallocated);

    const pockets = (await admin.from('hys_pockets').select('*').eq('client_id', clientId)).data || [];
    check('a real pocket exists for the transferred amount',
      pockets.length === 1 && Number(pockets[0].amount) === 20000, JSON.stringify(pockets.map(p => p.amount)));
    check('...recorded as funded from unallocated capital, not a wallet or bank',
      pockets[0] && pockets[0].funding_method === 'unallocated capital', pockets[0] && pockets[0].funding_method);
    check('...with a real maturity date and projected interest for a 6-month fixed pocket',
      !!pockets[0].maturity_date && Number(pockets[0].projected_interest) > 0,
      JSON.stringify({ m: pockets[0].maturity_date, i: pockets[0].projected_interest }));

    const txns = (await admin.from('transactions').select('*').eq('client_id', clientId)).data || [];
    check('LEDGER: exactly one row for the movement, single-entry as every other flow here',
      txns.length === 1, JSON.stringify(txns.map(t => t.type)));
    check('...typed HYS_TRANSFER_IN, distinguishable from an external HYS_DEPOSIT',
      txns[0] && txns[0].type === 'HYS_TRANSFER_IN', txns[0] && txns[0].type);
    check('...for the real amount', txns[0] && Number(txns[0].total_value) === 20000);
    check('...and linked from the request, so both ends are traceable',
      (await admin.from('hys_deposit_requests').select('transaction_id, pocket_id').eq('id', reqId).single()).data.transaction_id === txns[0].id);

    // ---- Part 3: THE RACE ----------------------------------------------------------------
    console.log('\n3. THE RACE — capital allocated elsewhere between request and approval');
    const raceReq = await callFunction(url, token, 'request-hys-deposit', {
      pocketType: 'ayw', amount: 35000, method: 'internal'
    });
    check('a second transfer is validly requested against the remaining 40,000',
      raceReq.status === 200, JSON.stringify(raceReq.body));
    const raceId = raceReq.body && raceReq.body.id;

    // The client genuinely spends that same capital elsewhere, exactly as they could in
    // real life — a direct account_state write standing in for any real allocation path.
    await admin.from('account_state')
      .update({ unallocated_capital: 5000, updated_at: new Date().toISOString() })
      .eq('client_id', clientId);
    check('the same capital is genuinely allocated elsewhere first (40,000 -> 5,000)',
      (await unallocatedOf(admin, clientId)) === 5000);

    const raceApprove = await callFunction(url, adminToken, 'credit-hys-deposit', {
      requestId: raceId, confirmedAmount: 35000
    });
    check('★ APPROVAL IS REFUSED rather than overdrawing the account',
      raceApprove.status === 409, JSON.stringify(raceApprove.body));
    check('...naming the real remaining balance so the PM knows why',
      /5000|5,000/.test(String(raceApprove.body && raceApprove.body.error)),
      String(raceApprove.body && raceApprove.body.error));
    check('★ UNALLOCATED CAPITAL DID NOT GO NEGATIVE — still exactly 5,000',
      (await unallocatedOf(admin, clientId)) === 5000, 'got ' + (await unallocatedOf(admin, clientId)));
    check('...no second pocket was created',
      ((await admin.from('hys_pockets').select('id').eq('client_id', clientId)).data || []).length === 1);
    check('...no second ledger row was written',
      ((await admin.from('transactions').select('id').eq('client_id', clientId)).data || []).length === 1);
    check('...and the request stays genuinely pending, not silently resolved',
      (await admin.from('hys_deposit_requests').select('status').eq('id', raceId).single()).data.status === 'pending');

    // ---- Part 4: rejection moves nothing --------------------------------------------------
    console.log('\n4. Rejection returns nothing, because nothing ever moved');
    const beforeReject = await unallocatedOf(admin, clientId);
    const pocketsBefore = ((await admin.from('hys_pockets').select('id').eq('client_id', clientId)).data || []).length;
    const txnsBefore = ((await admin.from('transactions').select('id').eq('client_id', clientId)).data || []).length;

    const rejected = await callFunction(url, adminToken, 'reject-hys-deposit', {
      requestId: raceId, reason: 'Capital committed elsewhere.'
    });
    check('the pending internal transfer rejects cleanly', rejected.status === 200, JSON.stringify(rejected.body));
    check('...status is genuinely rejected',
      (await admin.from('hys_deposit_requests').select('status').eq('id', raceId).single()).data.status === 'rejected');
    check('★ unallocated capital is byte-identical after rejection — nothing to return',
      (await unallocatedOf(admin, clientId)) === beforeReject, 'was ' + beforeReject);
    check('...no pocket created by the rejection',
      ((await admin.from('hys_pockets').select('id').eq('client_id', clientId)).data || []).length === pocketsBefore);
    check('...no ledger row written by the rejection',
      ((await admin.from('transactions').select('id').eq('client_id', clientId)).data || []).length === txnsBefore);

    // ---- Part 5: authorization -------------------------------------------------------------
    console.log('\n5. Authorization');
    const openReq = await callFunction(url, token, 'request-hys-deposit', {
      pocketType: 'ayw', amount: 1000, method: 'internal'
    });
    const openId = openReq.body && openReq.body.id;
    check('a client cannot approve their own internal transfer',
      (await callFunction(url, token, 'credit-hys-deposit', { requestId: openId, confirmedAmount: 1000 })).status === 403);
    check('an unauthenticated caller cannot approve one',
      (await callFunction(url, null, 'credit-hys-deposit', { requestId: openId, confirmedAmount: 1000 })).status === 401);
    check('...and the capital is still untouched after both refusals',
      (await unallocatedOf(admin, clientId)) === beforeReject);

    // ---- Part 6: the external path is unregressed ------------------------------------------
    console.log('\n6. The existing external-deposit path is unchanged');
    const ext = await callFunction(url, token, 'request-hys-deposit', {
      pocketType: 'ayw', amount: 2500, method: 'bank', details: { bankName: 'Test Bank' }
    });
    check('an external bank-funded request is still accepted', ext.status === 200, JSON.stringify(ext.body));
    const extUnallocatedBefore = await unallocatedOf(admin, clientId);
    const extCredit = await callFunction(url, adminToken, 'credit-hys-deposit', {
      requestId: ext.body.id, confirmedAmount: 2400
    });
    check('...and a PM-adjusted amount is STILL allowed for a genuinely external deposit',
      extCredit.status === 200, JSON.stringify(extCredit.body));
    check('...crediting it does NOT touch unallocated capital (HYS stays its own pool)',
      (await unallocatedOf(admin, clientId)) === extUnallocatedBefore);
    const extTxn = (await admin.from('transactions').select('type').eq('client_id', clientId).eq('total_value', 2400).maybeSingle()).data;
    check('...and it still writes a plain HYS_DEPOSIT, not the internal type',
      extTxn && extTxn.type === 'HYS_DEPOSIT', extTxn && extTxn.type);
  } finally {
    await cleanupClient(admin, clientId);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
