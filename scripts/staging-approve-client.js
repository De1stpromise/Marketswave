#!/usr/bin/env node
// ★ RETIRED, Aug 30, 2026 — Firebase is no longer the active backend (see
// firebase-config.js's own header for why); this was already its own documented "temporary
// stand-in," now doubly so. The active equivalent (a real admin UI button, not a script) is
// admin-client-applications.html's Supabase-sourced Approve/Reject, calling the real deployed
// Edge Functions (Supabase Migration Stage 3). KEPT, NOT DELETED.
//
// Backend Migration — Phase A1, item 5 (Aug 26, 2026).
//
// EXPLICITLY A TEMPORARY STAND-IN, not a permanent solution. Flips a specified staging
// client's Firestore document status from 'pending_review' to 'active' directly via the
// Admin SDK — standing in for the real approveClientApplication Cloud Function, which cannot
// be deployed yet (Phase A2 is blocked on a Blaze plan upgrade; see README.md). There is
// deliberately no real admin UI button wired to this on staging — running this script BY
// HAND is the entire "approval flow" for now. Once Phase A2 ships a real deployed
// approveClientApplication callable, this script should be retired in favor of it (or kept
// only as an emergency manual-override tool, a decision to make at that time, not this one).
//
// Mirrors functions/index.js's approveClientApplication(clientId) rule exactly: only resolves
// a document that is currently 'pending_review' (throws a clear error otherwise — never
// silently overwrites an already-resolved application), sets status: 'active' and
// applicationResolvedAt: serverTimestamp(). Does NOT touch applicationReason (that field is
// reject-only) and does not offer a --reject mode — the task this script was built for asked
// specifically for an approval stand-in; a symmetric reject version would be a small, easy
// addition later if that's ever genuinely needed for staging testing, not built pre-emptively
// here.
//
// CREDENTIALS: same discipline as scripts/staging-bootstrap-admin.js — the service account
// key is read only from GOOGLE_APPLICATION_CREDENTIALS, never referenced by path in this
// file, and any lingering emulator env vars are explicitly cleared first so this can never
// silently no-op against a local emulator instead of the real project.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-key.json node scripts/staging-approve-client.js <uid>
// <uid> is the Firebase Auth uid (== the Firestore clients/{uid} document id) of the
// applicant to approve — find it in the Firebase Console's Authentication tab, or from
// signup's own confirmation, not guessed.

delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FUNCTIONS_EMULATOR;

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'marketswave-staging';

async function main() {
  const clientId = process.argv[2];
  if (!clientId) {
    throw new Error('Usage: node scripts/staging-approve-client.js <uid>');
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at the staging service account key ' +
      '(kept OUTSIDE this repository — see README.md) before running this script.'
    );
  }

  console.log('TEMPORARY STAND-IN for the real admin approve action (Phase A2 blocked on Blaze).');
  console.log('Approving REAL staging client: ' + clientId + ' (project: ' + PROJECT_ID + ')');
  console.log('');

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const docRef = db.collection('clients').doc(clientId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new Error('Unknown client: ' + clientId + ' (no clients/' + clientId + ' document exists)');
  }
  const client = snap.data();
  if (client.status !== 'pending_review') {
    throw new Error('Client ' + clientId + ' is not pending review (status: ' + client.status + ').');
  }

  await docRef.update({ status: 'active', applicationResolvedAt: FieldValue.serverTimestamp() });

  const confirmed = (await docRef.get()).data();
  console.log('Approved. ' + (client.name || clientId) + ' (' + client.email + ') is now status: ' + confirmed.status);
  console.log('Verify in the Firebase Console: https://console.firebase.google.com/project/' + PROJECT_ID + '/firestore/data/~2Fclients~2F' + clientId);
}

main().catch(function (err) {
  console.error('');
  console.error('Staging approval FAILED: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
