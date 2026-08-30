/**
 * ============================================================================================
 * ★ RETIRED, Aug 30, 2026 — read this before deploying or relying on anything in this file.
 * ============================================================================================
 * This is the Firebase Cloud Functions equivalent of the real admin approve/reject flow —
 * RETIRED along with the rest of the Firebase integration (see firebase-config.js's own
 * header for the full "why"). These three callables were, in practice, only ever exercised
 * against the local emulator — the real deployed equivalent for the real "marketswave-staging"
 * project (Phase A2) stayed permanently BLOCKED on a required Blaze plan upgrade, and was
 * never actually deployed to a real project. Supabase's own Edge Function equivalents
 * (supabase/functions/approve-client-application/, reject-client-application/ — creation
 * itself stays a direct, RLS-enforced client insert, mirroring this file's own
 * createClientApplication rules but enforced by Postgres RLS instead of a callable) ARE
 * deployed for real and ARE the active path — see CLAUDE.md's Tech Stack section (Supabase
 * Migration Stage 3) for the full writeup, including a real authorization bug this file's own
 * design (trusting `request.auth.token.admin`, injected by the Firebase Admin SDK's custom
 * claim mechanism) helped surface an analogous mistake for on the Supabase side (`getUser()`
 * vs `getClaims()`) before it shipped. KEPT, NOT DELETED, as historical/reference record of
 * real, working, verified server-side logic.
 * ============================================================================================
 *
 * Marketswave Cloud Functions — Backend Migration Phase 1 (Aug 22, 2026)
 *
 * Migrates the Client Registry + client-application-review business rules that previously
 * lived entirely in engine-core.js (a browser-only, localStorage-backed file) onto a real
 * Firestore + Firebase Auth backend. This file is the SERVER-SIDE half of that migration —
 * see signup.html/login.html for the client-side half, and engine-core.js's own
 * `mirrorAuthenticatedClientLocally()` for how the two are bridged back into every other
 * still-unmigrated page's existing localStorage-based world.
 *
 * These three callables deliberately mirror engine-core.js's addClient()/
 * approveClientApplication()/rejectClientApplication() rules field-for-field and
 * error-message-for-error-message (read directly from that file before writing this one, not
 * reinvented) — the one deliberate departure is documented inline at each point it happens.
 *
 * ---- Idiomatic-approach decision, reported per the task's own instruction --------------
 * Callable Cloud Functions (onCall), not Firebase Auth triggers (functions.auth.user()
 * .onCreate(), or 2nd-gen "blocking functions"). Two reasons:
 *   1. A 1st-gen onCreate() Auth trigger fires asynchronously AFTER
 *      createUserWithEmailAndPassword() already resolves client-side — there's a real race
 *      window where the client believes signup succeeded but the Firestore document doesn't
 *      exist yet if it immediately tries to read it back or attach onboarding data. A
 *      callable the client awaits directly has no such window.
 *   2. This project's own established pattern (every request/approve function in
 *      engine-core.js) is a synchronous call the caller awaits and gets a real return value
 *      or a thrown, readable error from — callables preserve that exact shape client-side,
 *      where an Auth trigger returns nothing to the client at all.
 * 2nd-gen blocking functions (beforeCreate) were considered and rejected as more machinery
 * than Phase 1 needs — they exist to VETO Auth account creation itself (e.g. domain
 * allowlisting), not to create a companion Firestore document, which is what's actually
 * needed here.
 *
 * ---- Admin authorization, reported per the task's own instruction -----------------------
 * "PM Identity currently stays single-shared-admin" (the existing admin-login.html gate is a
 * single shared client-side passphrase, no real per-PM account roster). This migration keeps
 * that SAME single-shared-identity model — deliberately not building a full multi-PM-account
 * system, which is out of Phase 1's scope and tracked as a real future requirement — but
 * gives it genuine SERVER-SIDE enforcement for the first time: one bootstrap Firebase Auth
 * user represents "the PM," carries a custom claim `{ admin: true }` (set via
 * admin.auth().setCustomUserClaims(), which can only be done server-side/via the Admin SDK —
 * never something a client can grant itself), and every admin-only callable below checks
 * `request.auth.token.admin === true` before doing anything. This is a real security upgrade
 * over the old passphrase stub (trivially readable/bypassable in client-side source) even
 * though it's still one shared identity, not individual PM accounts — that distinction is
 * flagged, not silently glossed over, in the Backend Requirements Register.
 *
 * Firestore rules (firestore.rules) deny ALL direct client writes to `clients/*` as
 * defense-in-depth — the Admin SDK these functions use bypasses security rules entirely by
 * design, so the custom-claim check inside each function below is what ACTUALLY does the
 * authorization work; the rules exist to make sure there is no OTHER path into this data.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const VALID_ACCOUNT_TYPES = ['Individual Account', 'Joint Account', 'Business Account'];

function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to perform this action.');
  }
  if (request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'This action requires Portfolio Manager access.');
  }
}

// ---- createClientApplication ---------------------------------------------------------
// Mirrors engine-core.js's addClient() — but ONLY the signup path specifically (the general
// addClient(), used by Client List's own "Add Client" admin form and defaulting status to
// 'active', is NOT reproduced here; this callable's one job is the signup flow, so status is
// hardcoded to 'pending_review', never accepted from the caller). email is read from the
// caller's own verified Auth token (request.auth.token.email), never trusted as a client-
// supplied field the way name/phone/accountType are — a client cannot claim a different
// email than the one their Firebase Auth account actually has. createdAt uses Firestore's
// serverTimestamp() rather than a client-clock date string (todayStrUTC()'s local-only
// equivalent) — a real, disclosed format difference from the local convention; the frontend
// converts it back to a 'YYYY-MM-DD' string when mirroring this record into the existing
// local Client Registry (see login.html/signup.html's own comments).
exports.createClientApplication = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to submit an application.');
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email;
  if (!email) {
    throw new HttpsError('failed-precondition', 'Your account has no verified email address.');
  }

  const name = (request.data && request.data.name || '').trim();
  const phone = (request.data && request.data.phone || '').trim();
  const accountType = request.data && request.data.accountType;

  if (!name) throw new HttpsError('invalid-argument', 'name is required.');
  if (!phone) throw new HttpsError('invalid-argument', 'phone is required.');
  if (VALID_ACCOUNT_TYPES.indexOf(accountType) === -1) {
    throw new HttpsError('invalid-argument', 'accountType must be one of: ' + VALID_ACCOUNT_TYPES.join(', ') + '.');
  }

  const docRef = db.collection('clients').doc(uid);
  const existing = await docRef.get();
  if (existing.exists) {
    // Defensive, not expected in normal use — a Firebase Auth uid is unique per account, so
    // this only fires if the callable is somehow invoked twice for the same account.
    throw new HttpsError('already-exists', 'A client application already exists for this account.');
  }

  const record = {
    name: name,
    email: email,
    phone: phone,
    accountType: accountType,
    status: 'pending_review',
    createdAt: FieldValue.serverTimestamp(),
    applicationResolvedAt: null,
    applicationReason: null
  };

  await docRef.set(record);
  return { id: uid };
});

// ---- approveClientApplication ----------------------------------------------------------
// Mirrors engine-core.js's approveClientApplication(clientId) field-for-field: same
// not-pending-review guard, same exact error message shape, same status/applicationResolvedAt
// writes. clientId here IS the Firestore document id, which IS the target client's Firebase
// Auth uid (per this migration's own "document id = Auth uid" design) — not a locally
// generated CLIENT-XXXX id.
exports.approveClientApplication = onCall(async (request) => {
  requireAdmin(request);

  const clientId = request.data && request.data.clientId;
  if (!clientId) throw new HttpsError('invalid-argument', 'clientId is required.');

  const docRef = db.collection('clients').doc(clientId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Unknown client: ' + clientId);
  }
  const client = snap.data();
  if (client.status !== 'pending_review') {
    throw new HttpsError('failed-precondition', 'Client ' + clientId + ' is not pending review (status: ' + client.status + ').');
  }

  await docRef.update({
    status: 'active',
    applicationResolvedAt: FieldValue.serverTimestamp()
  });

  return { id: clientId, status: 'active' };
});

// ---- rejectClientApplication -------------------------------------------------------------
// Mirrors engine-core.js's rejectClientApplication(clientId, reason) exactly, including the
// same judgment call already made and reported there: a rejected application is KEPT
// (status becomes 'rejected'), never deleted — same "show everything, never silently delete"
// principle used throughout the rest of this project.
exports.rejectClientApplication = onCall(async (request) => {
  requireAdmin(request);

  const clientId = request.data && request.data.clientId;
  const reason = request.data && request.data.reason;
  if (!clientId) throw new HttpsError('invalid-argument', 'clientId is required.');

  const docRef = db.collection('clients').doc(clientId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Unknown client: ' + clientId);
  }
  const client = snap.data();
  if (client.status !== 'pending_review') {
    throw new HttpsError('failed-precondition', 'Client ' + clientId + ' is not pending review (status: ' + client.status + ').');
  }

  await docRef.update({
    status: 'rejected',
    applicationResolvedAt: FieldValue.serverTimestamp(),
    applicationReason: reason || null
  });

  return { id: clientId, status: 'rejected' };
});
