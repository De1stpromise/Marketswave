// Supabase Migration — Stage 3 (Aug 30, 2026) — shared Supabase bootstrap for admin pages
// that need to call a real, admin-authorized Edge Function against the real cloud
// "Marketswave Staging" project. Mirrors admin-firebase-config.js's own role and structure
// closely (read that file first, this one follows its shape deliberately) — same
// find-or-prompt-and-sign-in pattern, same reasoning for why a real second identity is
// established transparently underneath the admin tool's own pre-existing passphrase gate.
//
// Deliberately REAL-CLOUD-ONLY, no local-stack branch — unlike supabase-config.js (the
// client-facing file, which defaults to the local Docker stack and only reaches real
// staging behind an explicit `?backend=supabase&env=staging`), this file's entire reason to
// exist is to call the real DEPLOYED Edge Functions (approve-client-application/
// reject-client-application), which only exist on the real cloud project — there is no
// meaningful "local admin UI" version of this to branch to (the local stack's own Edge
// Functions only ever run via `supabase functions serve`, a manual dev-testing session, not
// an always-on part of local dev the way the DB/Auth containers are).
//
// ensureSupabaseAdminSignedIn(): admin-client-applications.html's OWN gate (the shared
// passphrase, admin-login.html/admin-sidebar.js) has nothing to do with Supabase Auth — a
// separate, pre-existing, purely local mechanism, exactly as it already is for Firebase.
// This function transparently signs the browser into the real staging PM account
// (pm@marketswave-staging.internal, created by scripts/supabase-staging-bootstrap-admin.js)
// so a PM who's already through the passphrase gate doesn't need a second login screen.
//
// Session persistence: `persistSession: false` — the DECISION Stage 2 already recorded for a
// future admin-facing Supabase client (mirroring admin-firebase-config.js's own
// inMemoryPersistence choice), now actually implemented here for the first time. "A page
// refresh should re-prompt" must genuinely hold for a real cloud admin identity, not just
// "the password isn't written anywhere."
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

const STAGING_URL = 'https://ujnmlwbpginplfnofhhv.supabase.co';
// Same "not actually a secret" reasoning as every other anon key in this project — see
// supabase-config.js's own STAGING_CONFIG comment for the full explanation.
const STAGING_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbm1sd2JwZ2lucGxmbm9maGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MTE5MDcsImV4cCI6MjEwMzQ4NzkwN30.nJ9hTEwyfJDK-pVDtDMto6xLgwVOe9SqJm-LJNiIINg';

const STAGING_ADMIN_EMAIL = 'pm@marketswave-staging.internal';

const supabase = createClient(STAGING_URL, STAGING_ANON_KEY, {
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
