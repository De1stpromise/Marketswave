// ============================================================================================
// ★ RETIRED, Aug 30, 2026 — read this before touching or relying on anything in this file.
// ============================================================================================
// This Firebase integration is RETIRED. Supabase is now the sole active backend for
// signup.html/login.html — see supabase-config.js's own header for the live environment
// switch. WHY: the whole reason this project migrated off Firebase in the first place — real
// Cloud Functions (the admin approve/reject flow) stayed permanently blocked on a required
// Blaze (pay-as-you-go) plan upgrade for the real staging project, a card requirement this
// project declined to take on. Supabase's free tier deploys real Edge Functions with no card
// required, and Supabase Migration Stage 3 (Aug 30, 2026) proved that out completely: the
// real admin approve/reject flow now works end to end against real cloud infrastructure —
// the exact capability that stayed permanently out of reach here.
//
// KEPT, NOT DELETED: this file (and every other Firebase file — admin-firebase-config.js,
// functions/index.js, firestore.rules, firestore.staging.rules, scripts/golden-path-
// regression.js, the Firebase Bootstrap/Staging sections of README.md) remains exactly as it
// was, fully functional, as historical/reference record of real, working, verified
// infrastructure — not a dead stub. It is reachable again only via signup.html/login.html's
// new explicit `?legacyBackend=firebase` flag (see supabase-config.js's header for the full
// scheme) — no longer the default, no longer reachable by accident. See CLAUDE.md's Tech
// Stack section for the full arc (why Firebase was chosen, what got built on it, why it was
// retired) and the Backend Requirements Register for how each Firebase-specific item now
// maps to its Supabase equivalent.
// ============================================================================================
//
// Backend Migration Phase 1 (Aug 22, 2026) — shared Firebase app/SDK bootstrap for
// signup.html and login.html ONLY (see engine-core.js's own Backend Migration comment for
// why no other page touches this yet). Plain ES module, loaded via
// <script type="module" src="firebase-config.js"> and imported from — no bundler, matching
// this project's existing "no build step" convention; the Firebase JS SDK ships real ES
// modules from its own CDN, so this works natively in every modern browser.
//
// Phase A1 (Aug 26, 2026) added a SECOND, real environment — "marketswave-staging" — a
// distinct staging Firebase project, NOT the same thing as "Marketswave SE" (the eventual
// real-production project named throughout CLAUDE.md/the handover doc's Backend Migration
// section, still completely untouched). There are now three tiers, not two:
//   emulator (demo-marketswave, default)  ->  staging (marketswave-staging)  ->  production (Marketswave SE, not started)
//
// ---- Environment switch, reported per instruction: a URL query parameter -----------------
// `?env=staging` on signup.html/login.html selects the real staging project; its absence (or
// any other value) selects the emulator — the safe default. A URL param was chosen over a
// persisted flag (localStorage/sessionStorage) or a hand-edited constant specifically because
// it can't "stick": every plain page load — including everything golden-path-regression.js
// does, and every existing manual emulator-testing habit — is unaffected with zero code
// changes on their end, since none of them ever add `?env=staging` to a URL. A persisted flag
// risks a browser silently staying pointed at staging across sessions after just one
// deliberate test; a hardcoded constant risks being left flipped to `true` and committed,
// silently redirecting every future local dev/test session at a REAL cloud project. Neither
// of those failure modes is possible with a URL param — you cannot "accidentally forget" a
// query string that was never added, and manually typing `?env=staging` is about as
// unambiguous an opt-in as this project's own URL bar can offer.
//
// IS_STAGING is exported so signup.html can branch its own submission logic (staging writes
// its own Firestore document directly via the client SDK, per Phase A1's "no Cloud Functions"
// scope — see signup.html's own comment; the emulator path keeps calling the
// createClientApplication callable, completely unchanged). login.html needs NO branching at
// all — it already only ever does a real signInWithEmailAndPassword + a direct Firestore
// getDoc() read, neither of which cares which project `auth`/`db` happen to point at.
const params = new URLSearchParams(window.location.search);
const IS_STAGING = params.get('env') === 'staging';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js';

// EMULATOR-ONLY, DELIBERATELY. The apiKey/projectId below are NOT real Firebase project
// credentials — "demo-marketswave" is a Firebase Emulator Suite "demo project": a magic
// project-id prefix that keeps the entire Auth/Firestore/Functions emulator suite fully
// offline (no real Google Cloud project, no firebase login, no billing, nothing ever reaches
// real Firebase). Any non-empty apiKey string works here — the emulator never validates it
// against a real backend — as long as projectId matches firebase.json/.firebaserc's own
// "demo-marketswave".
const EMULATOR_CONFIG = {
  apiKey: 'demo-emulator-only-not-a-real-key',
  authDomain: 'demo-marketswave.firebaseapp.com',
  projectId: 'demo-marketswave'
};

// REAL staging project config (Aug 26, 2026) — fetched directly from the real, already-
// registered "marketswave-web" web app via the Firebase Management API
// (projects.webApps.getConfig), authenticated with the staging service account, NOT typed in
// by hand or guessed. `apiKey` here is a real Firebase Web API key — per Firebase's own
// documented security model this is NOT a secret (it identifies the project to Google's
// client libraries; actual access control is enforced by Firebase Auth + the deployed
// Firestore security rules, both of which are the real thing here), so it's safe to commit,
// unlike the staging service account's private key (see README.md's own "never commit"
// section for that key's handling — this file never touches it at all, on either browser
// side).
const STAGING_CONFIG = {
  apiKey: 'AIzaSyDZ-WrSpc3PQR_KKnR8kayTLah1UoWAFSc',
  authDomain: 'marketswave-staging.firebaseapp.com',
  projectId: 'marketswave-staging',
  storageBucket: 'marketswave-staging.firebasestorage.app',
  messagingSenderId: '946711837608',
  appId: '1:946711837608:web:5609135a8e5a1536583b9d'
};

const app = initializeApp(IS_STAGING ? STAGING_CONFIG : EMULATOR_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

if (!IS_STAGING) {
  // Ports must match firebase.json's own emulators block exactly. Never runs in staging mode
  // — connecting an emulator hook to a real Firebase app would be a contradiction in terms,
  // and correctly just isn't reachable when IS_STAGING is true.
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
// Staging deliberately does NOT deploy any Cloud Functions yet (Phase A2, blocked on a Blaze
// plan upgrade — see README.md). `functions` is still exported for shape-compatibility with
// admin-firebase-config.js's own import, but nothing in this phase calls a callable against
// staging; doing so today would fail with a real "not found" error, which is expected and
// correct given nothing is deployed there.

export { app, auth, db, functions, IS_STAGING };
