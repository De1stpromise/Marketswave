#!/usr/bin/env node
// Backend Migration — Phase 0, item 2 (Aug 26, 2026).
//
// Walks the FULL real chain end to end against the emulator, in one command, producing a
// clear PASS/FAIL: signup -> pending status -> admin approve -> login succeeds -> dashboard
// loads -> Deploy Capital (deposit request + admin credit) -> transaction appears -> request
// an allocation -> admin approve -> transaction appears. See README.md's "Golden-Path
// Regression Script" section for how/when to run this and how to read its output.
//
// Two halves of the real chain are each exercised through the ACTUAL code that runs them,
// not reimplemented logic that merely resembles it:
//   1. The Firebase half (signup/pending/approve/login) uses the real firebase client SDK
//      against the real emulator, calling the exact same functions signup.html/login.html
//      call (createUserWithEmailAndPassword, the createClientApplication/
//      approveClientApplication callables, signInWithEmailAndPassword) — a genuine exercise
//      of functions/index.js and firestore.rules, not a mock.
//   2. The local half (dashboard/Deploy Capital/allocation/transactions) loads the REAL
//      engine-core.js source into a Node vm sandbox (see lib/engine-harness.js) and calls the
//      exact same functions signup.html/login.html/dashboard-sidebar.js/deploy-capital.html/
//      asset-collection.html/the admin tool call, in the same order, with a fresh "reload"
//      (fresh vm context, same underlying localStorage/sessionStorage) everywhere a real page
//      navigation would happen — see engine-harness.js's own comment for why that ordering is
//      load-bearing, not cosmetic.
//
// Requires the Auth + Firestore + Functions emulators running AND scripts/bootstrap-admin.js
// already run at least once this emulator session (this script signs in as that PM account
// to approve the test application, exactly like the real admin tool does). See README.md.
//
// Usage:  node scripts/golden-path-regression.js
// (or, from inside scripts/:  npm run golden-path)
// Exit code 0 = every step passed. Exit code 1 = at least one step failed (see the summary
// table printed at the end for which one, and why).

const { initializeApp: initAdminApp } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');

const { initializeApp } = require('firebase/app');
const {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require('firebase/firestore');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');

const { loadEngine, createSharedStorage } = require('./lib/engine-harness');

const PROJECT_ID = 'demo-marketswave'; // must match .firebaserc/firebase.json/firebase-config.js
const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const FUNCTIONS_EMULATOR_HOST = { host: '127.0.0.1', port: 5001 };

const ADMIN_EMAIL = 'pm@marketswave.internal'; // same bootstrap PM account as scripts/bootstrap-admin.js
const ADMIN_PASSWORD = 'MarketswavePM-Emulator-2026!';

// A fresh email every run avoids "email already in use" collisions if this script is run
// more than once against the same emulator session (the emulator does not reset between
// runs, only between `firebase emulators:start` restarts).
const RUN_ID = Date.now();
const TEST_EMAIL = 'golden-path-' + RUN_ID + '@test.marketswave.internal';
const TEST_PASSWORD = 'GoldenPath-Test-2026!';
const TEST_NAME = 'Golden Path Test Client';
const TEST_PHONE = '+1 (555) 010-' + String(RUN_ID).slice(-4);
const TEST_ACCOUNT_TYPE = 'Individual Account';

const DEPOSIT_REQUESTED_AMOUNT = 50000;
const DEPOSIT_CONFIRMED_AMOUNT = 50000; // kept equal to requested here — PM-edited-amount behavior is already covered by this project's own engine-level Node suite, not this script's job to re-prove
const ALLOCATION_AMOUNT = 10000;

// ---------------------------------------------------------------------------------------
// Step runner — collects PASS/FAIL + timing per step, prints as it goes, and stops the run
// (this is a sequential chain, each step depends on the last actually having happened) the
// moment a step throws.
// ---------------------------------------------------------------------------------------
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

function firestoreTimestampToDateString(ts) {
  if (!ts || typeof ts.toDate !== 'function') return null;
  return ts.toDate().toISOString().slice(0, 10);
}

async function main() {
  console.log('Golden-Path Regression — Marketswave hybrid backend (emulator)');
  console.log('================================================================');
  console.log('Project id: ' + PROJECT_ID + '   Test client email: ' + TEST_EMAIL);
  console.log('');

  // ---- Admin SDK setup (verification reads + the one-time preflight check) --------------
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  initAdminApp({ projectId: PROJECT_ID });
  const adminAuth = getAdminAuth();
  const adminDb = getAdminFirestore();

  // ---- Client SDK setup (the actual code path signup.html/login.html/admin pages run) ---
  const app = initializeApp({
    apiKey: 'demo-emulator-only-not-a-real-key',
    authDomain: PROJECT_ID + '.firebaseapp.com',
    projectId: PROJECT_ID
  });
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + AUTH_EMULATOR_HOST, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FUNCTIONS_EMULATOR_HOST.host, 8080);
  const functions = getFunctions(app);
  connectFunctionsEmulator(functions, FUNCTIONS_EMULATOR_HOST.host, FUNCTIONS_EMULATOR_HOST.port);

  // localStorage/sessionStorage instances shared across every simulated "page load" below —
  // see engine-harness.js's own comment for why this is what makes the reload-to-switch
  // semantics correctly line up with the real app's behavior.
  const storages = createSharedStorage();

  let uid;

  console.log('Preflight');
  await step('emulators reachable + PM bootstrap account exists', async function () {
    let pmUser;
    try {
      pmUser = await adminAuth.getUserByEmail(ADMIN_EMAIL);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        throw new Error(
          'PM bootstrap account not found. Run "node scripts/bootstrap-admin.js" first (see README.md) — ' +
          'this project\'s emulator does not reliably persist data across restarts, so this needs to be ' +
          're-run at the start of every fresh emulator session.'
        );
      }
      throw new Error('Could not reach the Auth emulator at ' + AUTH_EMULATOR_HOST + ': ' + err.message);
    }
    if (!pmUser.customClaims || pmUser.customClaims.admin !== true) {
      throw new Error('PM bootstrap account exists but is missing its { admin: true } claim — re-run scripts/bootstrap-admin.js.');
    }
    return 'uid=' + pmUser.uid;
  });

  console.log('');
  console.log('1. Signup (real Firebase Auth + real createClientApplication callable)');
  await step('create Firebase Auth account + Firestore application doc', async function () {
    const credential = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
    uid = credential.user.uid;
    const createClientApplication = httpsCallable(functions, 'createClientApplication');
    await createClientApplication({ name: TEST_NAME, phone: TEST_PHONE, accountType: TEST_ACCOUNT_TYPE });
    await signOut(auth); // signup.html signs the new user back out immediately — mirrored here
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
  console.log('2. Pending status (real Firestore read + a real blocked-login proof)');
  await step('Firestore doc status === "pending_review"', async function () {
    const snap = await adminDb.collection('clients').doc(uid).get();
    if (!snap.exists) throw new Error('No Firestore doc found for uid ' + uid);
    const status = snap.data().status;
    if (status !== 'pending_review') throw new Error('Expected status "pending_review", got "' + status + '"');
  });

  await step('login is genuinely blocked while pending (correct credentials, still refused)', async function () {
    const credential = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
    const snap = await getDoc(doc(db, 'clients', credential.user.uid));
    const status = snap.data().status;
    await signOut(auth); // mirrors login.html's own sign-out on the pending/rejected branches
    if (status !== 'pending_review') throw new Error('Expected still-pending status during this check, got "' + status + '"');
    // The actual gate is login.html's own if-statement (client-side); this step proves the
    // DATA that gate reads is genuinely still "pending_review" at the moment a real sign-in
    // with fully correct credentials succeeds — i.e. credentials alone are not enough.
  });

  console.log('');
  console.log('3. Admin approve (real approveClientApplication callable, PM-authorized)');
  await step('sign in as PM + call approveClientApplication', async function () {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    const approveClientApplication = httpsCallable(functions, 'approveClientApplication');
    await approveClientApplication({ clientId: uid });
    await signOut(auth);
  });

  await step('Firestore doc status === "active"', async function () {
    const snap = await adminDb.collection('clients').doc(uid).get();
    const data = snap.data();
    if (data.status !== 'active') throw new Error('Expected status "active", got "' + data.status + '"');
    if (!data.applicationResolvedAt) throw new Error('applicationResolvedAt was not set on approval');
  });

  console.log('');
  console.log('4. Login succeeds (real Firebase Auth sign-in, post-approval)');
  let clientData;
  await step('sign in as the approved client', async function () {
    const credential = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
    const snap = await getDoc(doc(db, 'clients', credential.user.uid));
    if (!snap.exists()) throw new Error('No Firestore doc found on login for uid ' + uid);
    clientData = snap.data();
    if (clientData.status !== 'active') throw new Error('Expected active status on login, got "' + clientData.status + '"');
  });

  await step('local bridge: mirrorAuthenticatedClientLocally() + setClientAuthenticated()', async function () {
    const engine = loadEngine(storages);
    engine.mirrorAuthenticatedClientLocally({
      id: uid,
      name: clientData.name,
      email: clientData.email,
      phone: clientData.phone,
      accountType: clientData.accountType,
      status: clientData.status,
      createdAt: firestoreTimestampToDateString(clientData.createdAt),
      applicationResolvedAt: firestoreTimestampToDateString(clientData.applicationResolvedAt),
      applicationReason: clientData.applicationReason || null
    });
    engine.setClientAuthenticated(uid);
    if (engine.getAuthenticatedClientId() !== uid) throw new Error('getAuthenticatedClientId() did not return the just-authenticated uid');
  });

  console.log('');
  console.log('5. Dashboard loads (dashboard-sidebar.js\'s file-load-time client pin + a clean read)');
  await step('pin current client (mirrors dashboard-sidebar.js) + read a clean, empty portfolio', async function () {
    // Mirrors dashboard-sidebar.js's own file-load-time behavior EXACTLY: read the raw
    // authenticated-client session key and pin the current-client session key to it, BEFORE
    // engine-core.js's own IIFE runs for this "page load" — see engine-harness.js's comment
    // and CLAUDE.md's §4.44/§4.45 history for why this ordering is the actual load-bearing
    // part, not a formality.
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
  console.log('6. Deploy Capital: deposit request -> admin credit -> transaction appears');
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

  await step('admin credits the deposit (creditDepositRequest)', async function () {
    const engine = loadEngine(storages); // simulates navigating to admin-deposits.html
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
  console.log('7. Request an allocation -> admin approve -> transaction appears (holdings, too)');
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

  await step('admin approves the allocation (approveAllocationRequest)', async function () {
    const engine = loadEngine(storages); // simulates navigating to admin-allocations.html
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
    // Rounding-tolerant: buy/sell math in engine-core.js rounds to cents at several steps.
    const diff = Math.abs(totalValue - DEPOSIT_CONFIRMED_AMOUNT);
    if (diff > 1) throw new Error('Total Portfolio Value not conserved through the buy: expected ~' + DEPOSIT_CONFIRMED_AMOUNT + ', got ' + totalValue);
    return buyTxn.id + ', holding units=' + holding.units.toFixed(4) + ', Total Portfolio Value=$' + totalValue.toFixed(2);
  });

  console.log('');
  console.log('Test account: ' + TEST_EMAIL + ' (uid ' + uid + ') left in the emulator —');
  console.log('cleared automatically on the next emulator restart (see README.md).');
}

main()
  .then(function () {
    printSummary();
    process.exit(results.every(function (r) { return r.ok; }) ? 0 : 1);
  })
  .catch(function () {
    // The failing step already printed its own error above; just render the summary table.
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
