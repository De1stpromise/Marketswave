// Supabase Migration — Stage 3 (Aug 30, 2026) — shared Supabase bootstrap for admin pages
// that need to call a real, admin-authorized Edge Function against the real cloud
// "Marketswave Staging" project. Mirrors admin-firebase-config.js's own role and structure
// closely (read that file first, this one follows its shape deliberately) — same
// find-or-prompt-and-sign-in pattern, same reasoning for why a real second identity is
// established transparently underneath the admin tool's own pre-existing passphrase gate.
//
// ★ Admin UI Wiring — Stage 1 (2026-09-03): a LOCAL-stack branch was added below, extending
// this file rather than building a second, parallel admin-Supabase-auth module — investigated
// and confirmed necessary first, per instruction. This file's own ORIGINAL header (preserved
// below, historically accurate as of Stage 3) explicitly reasoned there was "no meaningful
// local admin UI version of this to branch to" — true at the time, when this file's only
// caller (admin-client-applications.html) only ever needed the real DEPLOYED Edge Functions.
// This stage's own five admin pages need the LOCAL stack's own Edge Functions instead (the
// task's own explicit scope: "local stack"), so that reasoning no longer applies as a reason
// to exclude a local branch — it applies as the reason a local branch didn't exist YET.
// Mirrors supabase-config.js's own LOCAL_CONFIG/STAGING_CONFIG split (as of the 2026-09-04
// pre-hosting fix below: hostname-detected by default, `?env=staging`/`?dev=local` as
// explicit overrides — see that fix's own comment further down this file for the full
// reasoning), and mirrors admin-firebase-config.js's own emulator-vs-staging split for HOW
// each branch authenticates:
// the LOCAL branch auto-signs in with the known local bootstrap PM credential (no prompt,
// "Emulator path — byte-for-byte unchanged" is the literal precedent quoted from that file),
// while the STAGING branch below is completely untouched — still prompt-based, the password
// still never hardcoded, since a real cloud credential remains genuinely sensitive.
//
// Original header, below, describing the STAGING branch (its trigger condition is updated by
// the 2026-09-04 pre-hosting fix further down — the STAGING branch itself, and everything it
// does once active, is unchanged):
//
// Deliberately calls the real DEPLOYED Edge Functions (approve-client-application/
// reject-client-application, and now this stage's own five Approval Gate queues) on
// "Marketswave Staging" — as of the pre-hosting fix, whenever this page is NOT served from
// localhost/127.0.0.1 (the real hosted default), or whenever `?env=staging` is explicitly
// present (from anywhere, including localhost).
//
// ensureSupabaseAdminSignedIn(): admin-client-applications.html's OWN gate (the shared
// passphrase, admin-login.html/admin-sidebar.js) has nothing to do with Supabase Auth — a
// separate, pre-existing, purely local mechanism, exactly as it already is for Firebase.
// This function transparently signs the browser into the real staging PM account
// (pm@marketswave-staging.internal, created by scripts/supabase-staging-bootstrap-admin.js)
// so a PM who's already through the passphrase gate doesn't need a second login screen.
//
// Session persistence: `persistSession: false` for BOTH branches — the DECISION Stage 2
// already recorded for a future admin-facing Supabase client (mirroring
// admin-firebase-config.js's own inMemoryPersistence choice). "A page refresh should
// re-prompt" (staging) or "re-auto-sign-in cleanly" (local) must genuinely hold either way.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

// ★ Pre-hosting fix (2026-09-04) — mirrors supabase-config.js's own fix exactly (read that
// file's header for the full "why"), checked independently for THIS file rather than assumed
// covered by the client-facing fix: this file's own prior default, `(no params) -> LOCAL
// Docker stack`, has the exact same real-hosting bug — a PM opening a real, publicly hosted
// admin-login.html with no query params would silently try to reach
// `http://127.0.0.1:54321`, unreachable from anywhere but a developer's own machine.
// `window.location.hostname` being `localhost`/`127.0.0.1` is the same reliable, zero-config
// signal used there: real local development always serves this project from one of those two
// hostnames (README.md's own runbook: `python -m http.server` at `127.0.0.1:8765`); a real
// hosted admin tool is, by definition, served from some other real domain.
const params = new URLSearchParams(window.location.search);
const IS_LOCALHOST = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const FORCE_LOCAL_DEV = params.get('dev') === 'local';
const FORCE_STAGING = params.get('env') === 'staging';
// `env=staging` still wins over `dev=local` if somehow both are present — the same priority
// supabase-config.js's own fix documents, kept consistent between the two files.
const WANTS_STAGING = FORCE_STAGING || (!IS_LOCALHOST && !FORCE_LOCAL_DEV);

// LOCAL-STACK-ONLY, DELIBERATELY. Same "not actually a secret" reasoning as
// supabase-config.js's own LOCAL_CONFIG — this URL/anonKey are `supabase start`'s own local
// Docker stack, reachable only from this machine, identical across every unmodified local
// install.
const LOCAL_CONFIG = {
  url: 'http://127.0.0.1:54321',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
};
const STAGING_URL = 'https://ujnmlwbpginplfnofhhv.supabase.co';
// Same "not actually a secret" reasoning as every other anon key in this project — see
// supabase-config.js's own STAGING_CONFIG comment for the full explanation.
const STAGING_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbm1sd2JwZ2lucGxmbm9maGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MTE5MDcsImV4cCI6MjEwMzQ4NzkwN30.nJ9hTEwyfJDK-pVDtDMto6xLgwVOe9SqJm-LJNiIINg';
const ACTIVE_CONFIG = WANTS_STAGING ? { url: STAGING_URL, anonKey: STAGING_ANON_KEY } : LOCAL_CONFIG;

// Same "not actually a secret, well-known local-only credential" category as every other
// local bootstrap credential in this project — see scripts/supabase-bootstrap-admin.js's own
// header for the identical reasoning, applied here to the browser-facing side of that same
// account for the first time.
const LOCAL_ADMIN_EMAIL = 'pm@marketswave.local';
const LOCAL_ADMIN_PASSWORD = 'MarketswavePM-Local-2026!';
const STAGING_ADMIN_EMAIL = 'pm@marketswave-staging.internal';

const supabase = createClient(ACTIVE_CONFIG.url, ACTIVE_CONFIG.anonKey, {
  auth: { persistSession: false, autoRefreshToken: true }
});

let signInPromise = null;

// ---- Password prompt modal — same shape as admin-firebase-config.js's own
// buildStagingPasswordModal()/promptForStagingPassword(), different element ids so both
// files can coexist on the same page without colliding. Same deliberate choice NOT to clear
// the error at the top of a reopen (only onSubmit() clears it, right as a new attempt
// begins) — that exact ordering bug was found and fixed once already for the Firebase
// version's own retry loop; applied correctly here from the start rather than repeated.
function buildSupabaseAdminPasswordModal() {
  if (document.getElementById('supabase-admin-password-modal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'supabase-admin-password-modal';
  wrap.className = 'hidden fixed inset-0 z-[100] flex items-center justify-center p-4';
  wrap.innerHTML =
    '<div class="absolute inset-0 bg-black/60" id="supabase-admin-password-backdrop"></div>' +
    '<div class="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">' +
      '<p class="text-lg font-semibold text-slate-900 mb-2">Staging Admin Sign-In (Supabase)</p>' +
      '<p class="text-sm text-slate-500 mb-4">Real Supabase Auth session required to call the deployed Edge Functions against <span class="font-medium text-slate-900">Marketswave Staging</span>. Signing in as <span class="font-medium text-slate-900">' + STAGING_ADMIN_EMAIL + '</span>.</p>' +
      '<label class="block text-sm font-medium text-slate-700 mb-1">Password</label>' +
      '<input type="password" id="supabase-admin-password-input" class="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 mb-2" autocomplete="off">' +
      '<p class="text-xs text-red-500 hidden mb-2" id="supabase-admin-password-error"></p>' +
      '<p class="text-xs text-slate-400 mb-4">Held in memory for this tab only — never saved. A page refresh will ask again.</p>' +
      '<div class="flex gap-3">' +
        '<button type="button" id="supabase-admin-password-cancel" class="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">Cancel</button>' +
        '<button type="button" id="supabase-admin-password-submit" class="flex-1 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition">Sign In</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);
}

function promptForSupabaseAdminPassword() {
  buildSupabaseAdminPasswordModal();
  const modal = document.getElementById('supabase-admin-password-modal');
  const input = document.getElementById('supabase-admin-password-input');
  const errorEl = document.getElementById('supabase-admin-password-error');
  const submitBtn = document.getElementById('supabase-admin-password-submit');
  const cancelBtn = document.getElementById('supabase-admin-password-cancel');
  const backdrop = document.getElementById('supabase-admin-password-backdrop');

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
      errorEl.classList.add('hidden');
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
      reject(new Error('Supabase staging admin sign-in was cancelled.'));
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

async function signInSupabaseAdmin() {
  for (;;) {
    const password = await promptForSupabaseAdminPassword();
    const { error } = await supabase.auth.signInWithPassword({ email: STAGING_ADMIN_EMAIL, password });
    if (!error) return;
    buildSupabaseAdminPasswordModal();
    const errorEl = document.getElementById('supabase-admin-password-error');
    errorEl.textContent = /invalid/i.test(error.message) ? 'Incorrect password. Please try again.' : error.message;
    errorEl.classList.remove('hidden');
  }
}

function ensureSupabaseAdminSignedIn() {
  if (!signInPromise) {
    signInPromise = supabase.auth.getSession().then((res) => {
      if (!WANTS_STAGING) {
        // Local stack — auto-sign-in with the known bootstrap credential, no prompt. Mirrors
        // admin-firebase-config.js's own emulator branch exactly ("Emulator path —
        // byte-for-byte unchanged" is that file's own literal precedent for this shape).
        if (res.data.session && res.data.session.user.email === LOCAL_ADMIN_EMAIL) return res.data.session;
        return supabase.auth.signInWithPassword({ email: LOCAL_ADMIN_EMAIL, password: LOCAL_ADMIN_PASSWORD }).then((result) => {
          if (result.error) throw result.error;
          return result.data.session;
        });
      }
      if (res.data.session && res.data.session.user.email === STAGING_ADMIN_EMAIL) return res.data.session;
      return signInSupabaseAdmin();
    }).catch((err) => {
      // Don't leave a rejected promise cached forever — a PM who cancelled the prompt (or
      // hit a real transient failure) should be able to trigger another attempt later.
      signInPromise = null;
      throw err;
    });
  }
  return signInPromise;
}

export { supabase, ensureSupabaseAdminSignedIn };
