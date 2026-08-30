#!/usr/bin/env node
// Backend Migration — Phase 0, item 1 (Aug 26, 2026).
//
// Creates (or reuses) the single shared bootstrap PM Firebase Auth account and sets its
// { admin: true } custom claim — the account admin-firebase-config.js's ensureAdminSignedIn()
// signs the admin tool into, and the same account functions/index.js's requireAdmin() checks
// via request.auth.token.admin === true. See functions/index.js's own header comment and
// README.md's "Emulator Bootstrap Runbook" for the full "why" of this single-shared-admin
// model.
//
// EMULATOR-ONLY, DELIBERATELY. This script is safe to keep in the repository — its
// credentials are not a real secret, they're already fully disclosed in the committed
// admin-firebase-config.js (which every admin page loads and which anyone can read straight
// out of browser dev tools). This is a DIFFERENT situation from a future real-production
// bootstrap script: §12.4 item 6 of the Backend Migration plan (see the handover doc) still
// requires that a REAL admin account for the real "Marketswave SE" project be bootstrapped
// via a one-time script that is run locally and NEVER committed, since a real bootstrap
// script would carry a real credential. Do not use this file as a template for that without
// stripping the hardcoded plaintext password out of it first.
//
// IDEMPOTENT: safe to re-run every time a fresh emulator session starts (this project's
// `firebase emulators:start` currently does not reliably persist data across restarts — see
// README.md's "known --export-on-exit limitation" section for why). Reuses the account if it
// already exists; always re-asserts the custom claim either way, so a partially-bootstrapped
// state (account exists, claim missing — e.g. from an interrupted prior run) self-heals on
// the next run rather than requiring a manual fix.
//
// Usage:  node scripts/bootstrap-admin.js
// (or, from inside scripts/:  npm run bootstrap-admin)
// Requires the Auth + Firestore emulators to already be running (see README.md).

const ADMIN_EMAIL = 'pm@marketswave.internal';
const ADMIN_PASSWORD = 'MarketswavePM-Emulator-2026!';
const PROJECT_ID = 'demo-marketswave'; // must match .firebaserc/firebase.json exactly
const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

// Admin SDK reads these two env vars to redirect itself at the emulators instead of real
// Firebase — must be set BEFORE requiring firebase-admin/app, which reads them at
// initialization time.
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

async function main() {
  console.log('Bootstrapping admin/PM account against the emulator...');
  console.log('  Auth emulator:      ' + AUTH_EMULATOR_HOST);
  console.log('  Firestore emulator: ' + FIRESTORE_EMULATOR_HOST);
  console.log('  Project id:         ' + PROJECT_ID);
  console.log('');

  initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth();

  let user;
  try {
    user = await auth.getUserByEmail(ADMIN_EMAIL);
    console.log('Found existing account: ' + user.uid + ' (' + ADMIN_EMAIL + ')');
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    user = await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, emailVerified: true });
    console.log('Created new account:    ' + user.uid + ' (' + ADMIN_EMAIL + ')');
  }

  await auth.setCustomUserClaims(user.uid, { admin: true });

  // Re-fetch rather than trust the call above succeeded silently — the whole point of this
  // script is to leave behind a VERIFIED-live claim, not just an unconfirmed API call.
  const confirmed = await auth.getUser(user.uid);
  if (!confirmed.customClaims || confirmed.customClaims.admin !== true) {
    throw new Error('Custom claim did not take effect — got: ' + JSON.stringify(confirmed.customClaims));
  }

  console.log('Custom claim confirmed live: { admin: true }');
  console.log('');
  console.log('Bootstrap complete. The admin tool (admin-login.html -> any admin-*.html page)');
  console.log('can now sign in as this account automatically via admin-firebase-config.js.');
}

main().catch(function (err) {
  console.error('');
  console.error('Bootstrap FAILED: ' + (err && err.message ? err.message : err));
  console.error('');
  console.error('Most likely cause: the Auth/Firestore emulators are not running yet.');
  console.error('Start them first (see README.md), then re-run this script.');
  process.exit(1);
});
