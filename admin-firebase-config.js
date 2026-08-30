// ============================================================================================
// ★ RETIRED, Aug 30, 2026 — see firebase-config.js's own header for the full "why" (Supabase
// is now the sole active backend; Firebase's real Cloud Functions/admin-approve flow stayed
// permanently blocked on a Blaze plan requirement, which Supabase's free tier doesn't need).
// KEPT, NOT DELETED, as historical/reference record. admin-client-applications.html — the
// only caller of ensureAdminSignedIn() below — no longer calls into this file by default
// (see that page's own LEGACY_FIREBASE_ENABLED flag); the real, active admin approve/reject
// path is now admin-supabase-config.js + the deployed Edge Functions (Stage 3).
// ============================================================================================
//
// Backend Migration Phase 1 admin follow-up (Aug 22, 2026) — shared Firebase bootstrap for
// admin pages that need to read/write real Firestore data or call admin-authorized Cloud
// Functions. Reuses the SAME Firebase app instance firebase-config.js already initializes
// (one app, one emulator connection) rather than creating a second one.
//
// ensureAdminSignedIn(): the admin tool's OWN gate (admin-login.html's shared passphrase,
// checked by admin-sidebar.js) has nothing to do with Firebase Auth — it's a separate,
// pre-existing, purely local mechanism. But approveClientApplication/rejectClientApplication
// (and any admin-only Firestore read, per firestore.rules) require the CALLER to be signed
// in as a REAL Firebase Auth user carrying the { admin: true } custom claim. Rather than add
// a second, separate login screen a PM would have to click through, this transparently signs
// the browser into the SAME single shared bootstrap PM account Phase 1 already established
// (functions/index.js's own header comment explains why this mirrors the existing
// single-shared-admin decision) — once the PM is through the existing passphrase gate, they
// don't need to know or care that a real Firebase session is also being established
// underneath. Idempotent: waits for Firebase Auth's own persisted-session restore
// (onAuthStateChanged's first callback) before deciding whether a sign-in call is even
// needed, and caches the in-flight/completed promise so concurrent callers share one sign-in.
//
// EMULATOR-ONLY. ADMIN_EMAIL/ADMIN_PASSWORD below are the exact same bootstrap credentials
// bootstrap-admin.js (Node, scratchpad-only, not part of this repository) used to create the
// account and set its custom claim — duplicated here rather than shared via one file, since
// bootstrap-admin.js runs in Node/CommonJS and this runs in the browser/ESM; a small,
// disclosed duplication of two string constants, same low-risk category as this project's
// other documented duplications (e.g. admin-profile-updates.html's copy of settings.html's
// formatting helpers). Before any real production switch-over (see the handover doc's §12.4
// checklist), this whole bootstrap approach needs replacing with real individual PM
// accounts — tracked there, not solved here.
import { auth, db, functions, IS_STAGING } from './firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, setPersistence, inMemoryPersistence } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';

const ADMIN_EMAIL = 'pm@marketswave.internal';
const ADMIN_PASSWORD = 'MarketswavePM-Emulator-2026!';

// Real staging admin (Aug 27, 2026 follow-up — closes the "Could Not Load Firebase
// Applications" / auth/invalid-credential bug this task's own diagnosis found).
// pm@marketswave-staging.internal is the real account scripts/staging-bootstrap-admin.js
// creates — safe to reference directly, per that script's own header, since a Firebase email
// identifies an account but isn't itself a secret. The PASSWORD is the one genuinely
// sensitive value here (real staging is a real cloud project, unlike the emulator) and is
// deliberately NEVER hardcoded/committed anywhere in this file or any other browser-loaded
// code — see promptForStagingPassword() below for how it's obtained instead.
const STAGING_ADMIN_EMAIL = 'pm@marketswave-staging.internal';

let signInPromise = null;

function waitForInitialAuthState() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// ---- Staging admin password prompt — a small modal, not a raw browser prompt(), matching
// the admin tool's own existing modal styling (bg-black/60 backdrop, bg-white rounded-2xl
// shadow-xl card, amber focus ring — copied from admin-client-applications.html's own
// approve/reject modals since neither admin page that loads this shared module has a
// dedicated mount point for it). Injected into document.body on first use rather than
// requiring every admin page's own HTML to carry this markup — same "shared component
// injects its own markup" precedent dashboard-sidebar.js/dashboard-notifications.js already
// established, just targeting document.body instead of a page-specific mount div, since no
// admin page currently has one reserved for this. ----
function buildStagingPasswordModal() {
  if (document.getElementById('staging-admin-password-modal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'staging-admin-password-modal';
  wrap.className = 'hidden fixed inset-0 z-[100] flex items-center justify-center p-4';
  wrap.innerHTML =
    '<div class="absolute inset-0 bg-black/60" id="staging-admin-password-backdrop"></div>' +
    '<div class="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">' +
      '<p class="text-lg font-semibold text-slate-900 mb-2">Staging Admin Sign-In</p>' +
      '<p class="text-sm text-slate-500 mb-4">Real Firebase Auth session required to read/write against <span class="font-medium text-slate-900">marketswave-staging</span>. Signing in as <span class="font-medium text-slate-900">' + STAGING_ADMIN_EMAIL + '</span>.</p>' +
      '<label class="block text-sm font-medium text-slate-700 mb-1">Password</label>' +
      '<input type="password" id="staging-admin-password-input" class="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 mb-2" autocomplete="off">' +
      '<p class="text-xs text-red-500 hidden mb-2" id="staging-admin-password-error"></p>' +
      '<p class="text-xs text-slate-400 mb-4">Held in memory for this tab only — never saved. A page refresh will ask again.</p>' +
      '<div class="flex gap-3">' +
        '<button type="button" id="staging-admin-password-cancel" class="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">Cancel</button>' +
        '<button type="button" id="staging-admin-password-submit" class="flex-1 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition">Sign In</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);
}

// Resolves with the raw password once, then the caller uses it and lets it go out of scope
// immediately — never assigned anywhere that outlives this one call, same "raw value scoped
// strictly to its own call" discipline hashClientPassword() already established elsewhere in
// this project. Rejects (not resolves with null) on Cancel, so ensureAdminSignedIn() can tell
// "PM declined to sign in" apart from "wrong password, please retry."
function promptForStagingPassword() {
  buildStagingPasswordModal();
  const modal = document.getElementById('staging-admin-password-modal');
  const input = document.getElementById('staging-admin-password-input');
  const errorEl = document.getElementById('staging-admin-password-error');
  const submitBtn = document.getElementById('staging-admin-password-submit');
  const cancelBtn = document.getElementById('staging-admin-password-cancel');
  const backdrop = document.getElementById('staging-admin-password-backdrop');

  // Deliberately does NOT clear errorEl's visibility here. This function re-runs on every
  // retry loop iteration in signInStagingAdmin() below — if it cleared the error at the TOP
  // of a reopen, a wrong-password message the catch block just set would be hidden again
  // immediately, before the PM ever saw it (a real bug this fix's own Node verification
  // caught: the error only ever appeared for one JS tick, gone before any real render).
  // The error starts correctly hidden on a genuinely fresh modal build (baked into its
  // initial HTML above) and is only ever cleared by onSubmit() below, right as a NEW attempt
  // begins — never by simply reopening.
  input.value = '';
  modal.classList.remove('hidden');
  input.focus();

  return new Promise((resolve, reject) => {
    function cleanup() {
      submitBtn.removeEventListener('click', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      modal.classList.add('hidden');
      input.value = '';
    }
    function onSubmit() {
      errorEl.classList.add('hidden'); // clear any stale error from a prior attempt now, right as a new one begins
      const value = input.value;
      if (!value) {
        errorEl.textContent = 'Password is required.';
        errorEl.classList.remove('hidden');
        return;
      }
      cleanup();
      resolve(value);
    }
    function onCancel() {
      cleanup();
      reject(new Error('Staging admin sign-in was cancelled.'));
    }
    function onKeydown(e) {
      if (e.key === 'Enter') onSubmit();
      if (e.key === 'Escape') onCancel();
    }
    submitBtn.addEventListener('click', onSubmit);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

// Shows the SAME open modal's own inline error (not the page's toast) so a wrong password
// reads as "try again, right here" rather than a failure the PM has to go dismiss elsewhere
// first — then re-prompts. Genuinely stops only when the PM cancels (promptForStagingPassword
// rejects) or a real sign-in succeeds.
async function signInStagingAdmin() {
  // inMemoryPersistence, not the SDK's own default (browserLocalPersistence, which would
  // survive a refresh via IndexedDB) or browserSessionPersistence (which would survive a
  // refresh via sessionStorage) — required so "a page refresh should re-prompt" genuinely
  // holds, not just "the password itself isn't written anywhere." Scoped to the staging
  // branch only, per instruction: the emulator path below is untouched, byte-for-byte.
  await setPersistence(auth, inMemoryPersistence);
  for (;;) {
    const password = await promptForStagingPassword();
    try {
      const cred = await signInWithEmailAndPassword(auth, STAGING_ADMIN_EMAIL, password);
      return cred.user;
    } catch (e) {
      // Loop back to a fresh prompt rather than giving up after one wrong attempt — but the
      // error must be visible on the NEXT prompt, since this one was already torn down by
      // promptForStagingPassword()'s own cleanup(). buildStagingPasswordModal() is a no-op
      // here (the modal already exists), kept only for defense-in-depth in case it doesn't.
      buildStagingPasswordModal();
      const errorEl = document.getElementById('staging-admin-password-error');
      errorEl.textContent = (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password')
        ? 'Incorrect password. Please try again.'
        : (e.message || String(e));
      errorEl.classList.remove('hidden');
    }
  }
}

function ensureAdminSignedIn() {
  if (!signInPromise) {
    signInPromise = waitForInitialAuthState().then((user) => {
      if (!IS_STAGING) {
        // Emulator path — byte-for-byte unchanged from before this fix.
        if (user && user.email === ADMIN_EMAIL) return user;
        return signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD).then((cred) => cred.user);
      }
      if (user && user.email === STAGING_ADMIN_EMAIL) return user;
      return signInStagingAdmin();
    }).catch((err) => {
      // Don't leave a rejected promise cached forever — a PM who cancelled the prompt (or hit
      // a real transient failure) should be able to trigger another attempt later (e.g. by
      // clicking a "reload data" action again), not be permanently locked out for the rest of
      // the tab's lifetime.
      signInPromise = null;
      throw err;
    });
  }
  return signInPromise;
}

export { auth, db, functions, ensureAdminSignedIn };
