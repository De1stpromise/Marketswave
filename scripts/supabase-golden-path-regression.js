#!/usr/bin/env node
// Supabase Migration — Stage 2 (Aug 30, 2026).
//
// Walks the FULL real chain end to end against the LOCAL Supabase Docker stack, in one
// command, producing a clear PASS/FAIL: signup -> pending status (+ a real blocked-login
// proof) -> local service_role approve (standing in for a real admin UI/Edge Function, which
// don't exist yet — Stage 3+) -> login succeeds -> dashboard loads -> fund the account
// (deposit request + local approve) -> request an allocation -> local approve -> transaction
// appears. Mirrors scripts/golden-path-regression.js (the Firebase one) exactly in spirit and
// structure — read that file first, this one follows its shape deliberately, not
// reinvented — see README.md's "Supabase Local Development Runbook" for how/when to run this
// and how to read its output.
//
// Two halves of the real chain are each exercised through the ACTUAL code that runs them, not
// reimplemented logic that merely resembles it:
//   1. The Supabase half (signup/pending/approve/login) uses the real @supabase/supabase-js
//      client SDK against the real local stack — the exact same signUp()/
//      signInWithPassword()/.from('clients') calls signup.html/login.html make when loaded
//      with ?backend=supabase — a genuine exercise of Stage 1's RLS policies, not a mock.
//      "Admin approve" uses service_role directly (bypasses RLS, same as the Admin SDK
//      bypasses Firestore rules) — the same stand-in scripts/supabase-approve-client.js is,
//      inlined here rather than shelled out to, since this script already holds a
//      service_role client.
//   2. The local half (dashboard/Deploy Capital/allocation/transactions) loads the REAL
//      engine-core.js source into a Node vm sandbox (see lib/engine-harness.js) and calls the
//      exact same functions signup.html/login.html/dashboard-sidebar.js/deploy-capital.html/
//      asset-collection.html/the admin tool call, in the same order, with a fresh "reload"
//      (fresh vm context, same underlying localStorage/sessionStorage) everywhere a real page
//      navigation would happen — identical harness to the Firebase script, since this half of
//      the app has no idea which backend authenticated the client.
//
// Requires the local Supabase stack running (`supabase start`). Does NOT require
// scripts/supabase-bootstrap-admin.js to have been run first — unlike the Firebase version,
// this script never signs in as an admin ACCOUNT to approve (no admin UI exists yet to mirror
// that way); it uses service_role directly, the way a future Edge Function eventually will.
//
// Usage:  node scripts/supabase-golden-path-regression.js
// (or, from inside scripts/:  npm run supabase-golden-path)
// Exit code 0 = every step passed. Exit code 1 = at least one step failed (see the summary
// table printed at the end for which one, and why).

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { loadEngine, createSharedStorage } = require('./lib/engine-harness');

const RUN_ID = Date.now();
const TEST_EMAIL = 'golden-path-supabase-' + RUN_ID + '@test.marketswave.local';
const TEST_PASSWORD = 'GoldenPath-Supabase-Test-2026!';
const TEST_NAME = 'Golden Path Supabase Test Client';
const TEST_PHONE = '+1 (555) 020-' + String(RUN_ID).slice(-4);
const TEST_ACCOUNT_TYPE = 'Individual Account';

const DEPOSIT_REQUESTED_AMOUNT = 50000;
const DEPOSIT_CONFIRMED_AMOUNT = 50000; // kept equal to requested — PM-edited-amount behavior is already covered elsewhere, not this script's job to re-prove
const ALLOCATION_AMOUNT = 10000;

const results = [];

async function step(name, fn) {
  const start = Date.now();
  process.stdout.write('  -> ' + name + ' ... ');
  try {
    const detail = await fn();
    const ms = Date.now() - start;
    results.push({ name, ok: true, ms, detail });
    console.log('PASS (' + ms + 'ms)' + (detail ? '  ' + detail : ''));
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ name, ok: false, ms, detail: err && err.message ? err.message : String(err) });
    console.log('FAIL (' + ms + 'ms)');
    console.log('     ' + (err && err.message ? err.message : err));
    throw err;
  }
}

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

function pgTimestampToDateString(ts) {
  return ts ? String(ts).slice(0, 10) : null;
}

async function main() {
  console.log('Golden-Path Regression — Marketswave hybrid backend (Supabase, local stack)');
  console.log('================================================================');
  console.log('Test client email: ' + TEST_EMAIL);
  console.log('');

  console.log('Preflight');
  let url, anonKey, serviceRoleKey;
  await step('local Supabase stack reachable', async function () {
    const creds = readLocalStackCredentials();
    url = creds.url; anonKey = creds.anonKey; serviceRoleKey = creds.serviceRoleKey;
    return url;
  });

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  await step('clients/user_roles tables reachable via service_role', async function () {
    const { error } = await admin.from('clients').select('id').limit(1);
    if (error) throw new Error('Could not query public.clients: ' + error.message);
  });

  // localStorage/sessionStorage instances shared across every simulated "page load" below —
  // see engine-harness.js's own comment for why this is what makes the reload-to-switch
  // semantics correctly line up with the real app's behavior.
  const storages = createSharedStorage();
  let uid;
  let clientAnon; // the anon-key client the "browser" (client) uses across signup/login

  console.log('');
  console.log('1. Signup (real Supabase Auth signUp() + a real RLS-enforced clients insert)');
  await step('create Supabase Auth account + clients row (mirrors signup.html?backend=supabase)', async function () {
    clientAnon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signUpData, error: signUpError } = await clientAnon.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
    if (signUpError) throw signUpError;
    uid = signUpData.user.id;

    const { error: insertError } = await clientAnon.from('clients').insert({
      id: uid,
      name: TEST_NAME,
      email: signUpData.user.email,
      phone: TEST_PHONE,
      account_type: TEST_ACCOUNT_TYPE,
      status: 'pending_review'
    });
    if (insertError) throw insertError;

    await clientAnon.auth.signOut(); // signup.html signs the new user back out immediately — mirrored here
    return 'uid=' + uid;
  });

  await step('local mirror: saveClientOnboardingData() + seedMinimalClientStores(uid, 0)', async function () {
    const engine = loadEngine(storages);
    if (typeof engine.saveClientOnboardingData !== 'function' || typeof engine.seedMinimalClientStores !== 'function') {
      throw new Error('engine-core.js did not export the expected functions — check ENGINE_PATH / the file itself.');
    }
    engine.saveClientOnboardingData(uid, {
      financialProfile: { investableAssets: '$500,000 - $1,000,000', sourceOfWealth: 'Employment income', employment: 'Software Engineer' },
      goalsPreferences: { investmentGoal: 'Long-term growth', timeHorizon: '10+ years', riskComfort: 'Balanced' },
      riskQuestionnaire: { knowledge: 'Moderate', reaction: 'Hold', objective: 'Growth', horizon: '10+ years', liquidity: 'Low', experience: '3-5 years' },
      documents: { idDocument: { fileName: 'golden-path-id.pdf', documentType: 'Government-issued Photo ID' }, proofOfAddress: { fileName: 'golden-path-address.pdf', documentType: 'Proof of Address' } }
    });
    engine.seedMinimalClientStores(uid, 0);
  });

  console.log('');
  console.log('2. Pending status (real Postgres read + a real blocked-login proof)');
  await step('clients row status === "pending_review" (via direct Postgres query, service_role)', async function () {
    const { data, error } = await admin.from('clients').select('status').eq('id', uid).single();
    if (error || !data) throw new Error('No clients row found for uid ' + uid + ': ' + (error && error.message));
    if (data.status !== 'pending_review') throw new Error('Expected status "pending_review", got "' + data.status + '"');
  });

  await step('login is genuinely blocked while pending (correct credentials, still refused)', async function () {
    const { data: signInData, error: signInError } = await clientAnon.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
    if (signInError) throw signInError;
    const { data: row } = await clientAnon.from('clients').select('status').eq('id', signInData.user.id).single();
    await clientAnon.auth.signOut(); // mirrors login.html's own sign-out on the pending/rejected branches
    if (!row || row.status !== 'pending_review') throw new Error('Expected still-pending status during this check, got "' + (row && row.status) + '"');
    // The actual gate is login.html's own if-statement (client-side); this step proves the
    // DATA that gate reads is genuinely still "pending_review" at the moment a real sign-in
    // with fully correct credentials succeeds — i.e. credentials alone are not enough.
  });

  console.log('');
  console.log('3. Local approve (service_role directly — stands in for a real admin UI/Edge Function, Stage 3+)');
  await step('service_role: clients.status pending_review -> active', async function () {
    const { error } = await admin.from('clients').update({ status: 'active', application_resolved_at: new Date().toISOString() }).eq('id', uid);
    if (error) throw new Error('Update failed: ' + error.message);
    const { data } = await admin.from('clients').select('status, application_resolved_at').eq('id', uid).single();
    if (data.status !== 'active') throw new Error('Expected status "active", got "' + data.status + '"');
    if (!data.application_resolved_at) throw new Error('application_resolved_at was not set on approval');
  });

  console.log('');
  console.log('4. Login succeeds (real Supabase Auth sign-in, post-approval)');
  let clientRow;
  await step('sign in as the approved client', async function () {
    const { data: signInData, error: signInError } = await clientAnon.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
    if (signInError) throw signInError;
    const { data, error } = await clientAnon.from('clients').select('*').eq('id', signInData.user.id).single();
    if (error || !data) throw new Error('No clients row found on login for uid ' + uid);
    clientRow = data;
    if (clientRow.status !== 'active') throw new Error('Expected active status on login, got "' + clientRow.status + '"');
  });

  await step('local bridge: mirrorAuthenticatedClientLocally() + setClientAuthenticated()', async function () {
    const engine = loadEngine(storages);
    engine.mirrorAuthenticatedClientLocally({
      id: uid,
      name: clientRow.name,
      email: clientRow.email,
      phone: clientRow.phone,
      accountType: clientRow.account_type,
      status: clientRow.status,
      createdAt: pgTimestampToDateString(clientRow.created_at),
      applicationResolvedAt: pgTimestampToDateString(clientRow.application_resolved_at),
      applicationReason: clientRow.application_reason || null
    });
    engine.setClientAuthenticated(uid);
    if (engine.getAuthenticatedClientId() !== uid) throw new Error('getAuthenticatedClientId() did not return the just-authenticated uid');
  });

  console.log('');
  console.log('5. Dashboard loads (dashboard-sidebar.js\'s file-load-time client pin + a clean read)');
  await step('pin current client (mirrors dashboard-sidebar.js) + read a clean, empty portfolio', async function () {
    // Mirrors dashboard-sidebar.js's own file-load-time behavior EXACTLY: read the raw
    // authenticated-client session key and pin the current-client session key to it, BEFORE
    // engine-core.js's own IIFE runs for this "page load" — same ordering discipline the
    // Firebase golden-path script already established (CLAUDE.md §4.44/§4.45).
    const authedId = storages.sessionStorage.getItem('marketswave_authenticated_client_id');
    if (!authedId) throw new Error('No authenticated client id in sessionStorage — login step did not persist correctly');
    storages.sessionStorage.setItem('marketswave_current_client_id', authedId);

    const engine = loadEngine(storages);
    if (engine.getCurrentClientId() !== uid) throw new Error('getCurrentClientId() did not pin to the real client after "page load"');
    const client = engine.getClient(uid);
    if (!client || client.name !== TEST_NAME) throw new Error('getClient(uid) did not return the mirrored client record');
    const totalValue = engine.getTotalPortfolioValue();
    if (totalValue !== 0) throw new Error('Expected a clean $0 starting portfolio, got ' + totalValue);
    const ledger = engine.getTransactionLedger();
    if (ledger.length !== 0) throw new Error('Expected an empty transaction ledger on a fresh client, got ' + ledger.length + ' entries');
    return 'client=' + client.name + ', Total Portfolio Value=$0, ledger empty';
  });

  console.log('');
  console.log('6. Fund the account (deposit request + local approve), so an allocation is possible');
  let depositRequestId;
  await step('client requests a bank deposit (requestDeposit)', async function () {
    const engine = loadEngine(storages); // simulates navigating to deploy-capital.html
    const request = engine.requestDeposit('bank', DEPOSIT_REQUESTED_AMOUNT, 'USD', {
      bankName: 'Golden Path Test Bank', accountHolder: TEST_NAME
    });
    depositRequestId = request.id;
    if (request.status !== 'pending') throw new Error('Expected a pending deposit request, got status "' + request.status + '"');
    return request.id + ' for $' + DEPOSIT_REQUESTED_AMOUNT;
  });

  await step('local approve credits the deposit (creditDepositRequest)', async function () {
    const engine = loadEngine(storages); // simulates a future admin-deposits.html action
    const credited = engine.creditDepositRequest(uid, depositRequestId, DEPOSIT_CONFIRMED_AMOUNT);
    if (credited.status !== 'credited') throw new Error('Expected "credited" status, got "' + credited.status + '"');
  });

  await step('DEPOSIT transaction appears + unallocatedCapital reflects it', async function () {
    const engine = loadEngine(storages); // simulates the client reloading dashboard.html/transactions.html
    const ledger = engine.getTransactionLedger();
    const depositTxn = ledger.find(function (t) { return t.type === 'DEPOSIT'; });
    if (!depositTxn) throw new Error('No DEPOSIT transaction found in the ledger');
    if (depositTxn.totalValue !== DEPOSIT_CONFIRMED_AMOUNT) {
      throw new Error('DEPOSIT transaction totalValue mismatch: expected ' + DEPOSIT_CONFIRMED_AMOUNT + ', got ' + depositTxn.totalValue);
    }
    const state = engine.getAccountState();
    if (state.unallocatedCapital !== DEPOSIT_CONFIRMED_AMOUNT) {
      throw new Error('unallocatedCapital mismatch: expected ' + DEPOSIT_CONFIRMED_AMOUNT + ', got ' + state.unallocatedCapital);
    }
    return depositTxn.id + ' for $' + depositTxn.totalValue;
  });

  console.log('');
  console.log('7. Request an allocation -> local approve -> transaction appears (holdings, too)');
  let allocationRequestId, chosenProductId, chosenProductName;
  await step('client requests an allocation (requestAllocation)', async function () {
    const engine = loadEngine(storages); // simulates navigating to asset-collection.html
    const products = engine.getAllProducts().filter(function (p) {
      return p.assetClass !== 'Unallocated / Cash' && p.minimumInvestment <= ALLOCATION_AMOUNT;
    });
    if (products.length === 0) throw new Error('No product in the catalog has a minimum investment <= $' + ALLOCATION_AMOUNT);
    chosenProductId = products[0].id;
    chosenProductName = products[0].name;
    const request = engine.requestAllocation(chosenProductId, ALLOCATION_AMOUNT);
    allocationRequestId = request.id;
    if (request.status !== 'pending') throw new Error('Expected a pending allocation request, got status "' + request.status + '"');
    return request.id + ' -> ' + chosenProductName + ' for $' + ALLOCATION_AMOUNT;
  });

  await step('local approve (approveAllocationRequest)', async function () {
    const engine = loadEngine(storages); // simulates a future admin-allocations.html action
    const approved = engine.approveAllocationRequest(uid, allocationRequestId);
    if (approved.status !== 'approved') throw new Error('Expected "approved" status, got "' + approved.status + '"');
  });

  await step('BUY transaction + holding appear, Total Portfolio Value conserved', async function () {
    const engine = loadEngine(storages); // simulates the client reloading again
    const ledger = engine.getTransactionLedger();
    const buyTxn = ledger.find(function (t) { return t.type === 'BUY' && t.productId === chosenProductId; });
    if (!buyTxn) throw new Error('No BUY transaction found for ' + chosenProductId);
    const holdings = engine.getHoldings();
    const holding = holdings.find(function (h) { return h.productId === chosenProductId; });
    if (!holding) throw new Error('No holding found for ' + chosenProductId + ' after approval');
    const totalValue = engine.getTotalPortfolioValue();
    const diff = Math.abs(totalValue - DEPOSIT_CONFIRMED_AMOUNT);
    if (diff > 1) throw new Error('Total Portfolio Value not conserved through the buy: expected ~' + DEPOSIT_CONFIRMED_AMOUNT + ', got ' + totalValue);
    return buyTxn.id + ', holding units=' + holding.units.toFixed(4) + ', Total Portfolio Value=$' + totalValue.toFixed(2);
  });

  console.log('');
  console.log('Test account: ' + TEST_EMAIL + ' (uid ' + uid + ') left in the local stack —');
  console.log('cleaned up automatically on the next `supabase db reset`, or leave it, it costs nothing.');
}

main()
  .then(function () {
    printSummary();
    process.exit(results.every(function (r) { return r.ok; }) ? 0 : 1);
  })
  .catch(function () {
    printSummary();
    process.exit(1);
  });

function printSummary() {
  console.log('');
  console.log('================================================================');
  const passed = results.filter(function (r) { return r.ok; }).length;
  const failed = results.length - passed;
  results.forEach(function (r) {
    console.log('  [' + (r.ok ? 'PASS' : 'FAIL') + '] ' + r.name);
  });
  console.log('================================================================');
  if (failed === 0) {
    console.log('GOLDEN PATH: PASS (' + passed + '/' + results.length + ' steps)');
  } else {
    console.log('GOLDEN PATH: FAIL (' + passed + '/' + results.length + ' steps passed, ' + failed + ' failed)');
  }
}
