#!/usr/bin/env node
// Backend Migration — Phase A1, item 4 (Aug 26, 2026).
//
// Creates (or reuses) the real staging PM/admin Firebase Auth account and sets its real
// { admin: true } custom claim — the staging equivalent of scripts/bootstrap-admin.js, same
// technique (Admin SDK, getUserByEmail-or-create, setCustomUserClaims, re-fetch to confirm),
// but against the REAL "marketswave-staging" Firebase project instead of the local emulator.
// DO NOT confuse the two scripts — this one creates a real Firebase Auth user on a real
// cloud project. There is currently no real Cloud Function on staging to check this claim
// (Phase A2, blocked on a Blaze plan upgrade) — today it exists only so
// scripts/staging-approve-client.js (and any future real admin UI once A2 ships) has a real
// privileged identity to act as, and so the pattern is already in place for when A2 lands.
//
// CREDENTIALS, HANDLED DELIBERATELY DIFFERENTLY FROM THE EMULATOR SCRIPT:
//   - The Admin SDK credential (the SERVICE ACCOUNT KEY) is never referenced by path anywhere
//     in this file. It is read from the standard `GOOGLE_APPLICATION_CREDENTIALS` environment
//     variable via admin.credential.applicationDefault() — the operator sets that env var
//     themselves, pointing at wherever they keep the key OUTSIDE this repository. This file
//     contains no path, relative or absolute, that assumes where that key lives. See
//     README.md's "Staging credential handling" section for the full requirement, and why:
//     this is the exact same "never commit a real credential" discipline the real-production
//     bootstrap script (§12.4 item 6 in the handover doc) has always required — staging is a
//     REAL cloud project too, just not the production one.
//   - The PM ACCOUNT'S OWN PASSWORD is, for the same reason, never hardcoded here either
//     (unlike scripts/bootstrap-admin.js's emulator-only constant, which is fine to commit
//     specifically because it only ever touches a fully offline emulator — see that script's
//     own header for why). On first run (account doesn't exist yet), pass the desired
//     password via the STAGING_PM_PASSWORD env var, or omit it and this script will generate
//     a random one and print it ONCE — write it down, it is not stored anywhere and cannot be
//     recovered, only reset by deleting the account in the Firebase Console and re-running
//     this script. Re-runs against an already-existing account never touch the password at
//     all (only re-assert the custom claim), so STAGING_PM_PASSWORD is simply ignored then.
//
// SAFETY: explicitly clears any FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST that
// might be lingering in the calling shell's environment from emulator work earlier in the
// same session — those env vars silently redirect the Admin SDK at a local emulator instead
// of the real project, which would make this script a complete no-op against staging while
// looking like it succeeded. Better to be explicit than to inherit shell state by accident.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-key.json node scripts/staging-bootstrap-admin.js
// Optional: STAGING_PM_PASSWORD=... to set the password on first creation.

delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FUNCTIONS_EMULATOR;

const crypto = require('crypto');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const PROJECT_ID = 'marketswave-staging';
const PM_EMAIL = 'pm@marketswave-staging.internal';

function generatePassword() {
  // 24 random bytes -> base64url, trimmed to a clean 28-ish char string. Strong, print-once.
  return crypto.randomBytes(24).toString('base64url');
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at the staging service account key ' +
      '(kept OUTSIDE this repository — see README.md) before running this script, e.g.:\n' +
      '  GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/staging-bootstrap-admin.js'
    );
  }

  console.log('Bootstrapping REAL staging admin/PM account — project: ' + PROJECT_ID);
  console.log('  Using credential from GOOGLE_APPLICATION_CREDENTIALS (path not echoed here).');
  console.log('');

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const auth = getAuth();

  let user;
  try {
    user = await auth.getUserByEmail(PM_EMAIL);
    console.log('Found existing account: ' + user.uid + ' (' + PM_EMAIL + ')');
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    const password = process.env.STAGING_PM_PASSWORD || generatePassword();
    user = await auth.createUser({ email: PM_EMAIL, password: password, emailVerified: true });
    console.log('Created new account:    ' + user.uid + ' (' + PM_EMAIL + ')');
    if (!process.env.STAGING_PM_PASSWORD) {
      console.log('');
      console.log('  GENERATED PASSWORD (shown once, not stored anywhere): ' + password);
      console.log('  Save this now. It cannot be recovered — only reset via the Firebase Console.');
    }
  }

  await auth.setCustomUserClaims(user.uid, { admin: true });

  const confirmed = await auth.getUser(user.uid);
  if (!confirmed.customClaims || confirmed.customClaims.admin !== true) {
    throw new Error('Custom claim did not take effect — got: ' + JSON.stringify(confirmed.customClaims));
  }

  console.log('');
  console.log('Custom claim confirmed live on REAL staging: { admin: true }');
  console.log('Verify in the Firebase Console: https://console.firebase.google.com/project/' + PROJECT_ID + '/authentication/users');
}

main().catch(function (err) {
  console.error('');
  console.error('Staging bootstrap FAILED: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
