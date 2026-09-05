// Supabase Migration — Stage 3 (Aug 30, 2026) — shared Supabase bootstrap for admin pages
// that need to call a real, admin-authorized Edge Function against the real cloud
// "Marketswave Staging" project. Mirrors admin-firebase-config.js's own role and structure
// closely (read that file first, this one follows its shape deliberately).
//
// ★ Admin UI Wiring — Stage 1 (2026-09-03): a LOCAL-stack branch was added below, extending
// this file rather than building a second, parallel admin-Supabase-auth module.
//
// ============================================================================================
// ★ Admin Auth Consolidation (2026-09-05) — READ THIS BEFORE TOUCHING SESSION CONFIG BELOW.
// ============================================================================================
// Closes the "two overlapping access layers" architecture this file's own prior header
// described: a client-side passphrase gate (admin-login.html/admin-sidebar.js, retired —
// see engine-core.js's own ★ RETIRED comment above ADMIN_PASSPHRASE) governed NAVIGATION,
// while this file's own real Supabase session — previously `persistSession: false`,
// re-established or re-prompted on nearly every page load — governed the actual PRIVILEGED
// DATA CALLS underneath it. There is now exactly ONE real authentication layer: a real
// email/password sign-in on admin-login.html establishes this session ONCE; every admin page
// (admin-sidebar.js's gate) and every privileged call (ensureSupabaseAdminSignedIn() below,
// still called by admin-client-applications.html directly and transparently by every other
// admin page via supabase-data.js's useAdminClient()) checks THIS SAME real session, never
// re-prompting or re-authenticating on its own.
//
// ---- Session persistence: persistSession: true (was false) ----
// The prior `persistSession: false` decision (Stage 2's own recorded choice, mirroring
// admin-firebase-config.js's inMemoryPersistence) made sense when a real session was only
// ever a transient means to call one Edge Function from behind an already-separate passphrase
// gate — "a page refresh should re-prompt" was the right property for something that
// re-established itself silently anyway. Now that this session IS the sole access layer, it
// must behave like a normal persisted login (survive a refresh, survive navigating to a
// different admin page) — the identical property supabase-config.js's own client-facing
// persistSession: true decision already documents, for the identical reason.
//
// ---- A genuine NEW consideration this specific change introduces, investigated directly
// against the installed SDK source rather than assumed, per instruction: storageKey collision.
// ----
// Checked scripts/node_modules/@supabase/supabase-js/src/SupabaseClient.ts:326-327 directly:
//   const defaultStorageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`
// The DEFAULT storage key is derived ONLY from the target Supabase project's own URL hostname
// — NOT from anything specific to which createClient() call constructed the client, which
// file loaded it, or which "role" (client vs. admin) it's meant to represent. supabase-config.js
// (the client-facing session) does not override this default. Both files' LOCAL_CONFIG point at
// the exact same local-stack URL (http://127.0.0.1:54321 -> hostname "127.0.0.1" -> default key
// "sb-127-auth-token"), and both files' staging config point at the exact same real project URL
// (https://ujnmlwbpginplfnofhhv.supabase.co -> default key "sb-ujnmlwbpginplfnofhhv-auth-token").
// While this admin client was persistSession: false, this never mattered — an in-memory client
// never touches localStorage at all, so there was nothing to collide with. The MOMENT this flips
// to persistSession: true on the same origin (admin pages and client pages are served from the
// same domain — e.g. 127.0.0.1:8765 locally, or the same real hosted domain later), a real,
// serious bug becomes possible: without an explicit override, this admin client would read and
// write the EXACT SAME localStorage key the client-facing session already uses, meaning
// whichever one signs in last would silently overwrite the other's persisted session — a PM
// signing into the admin tool could clobber a client's real session on the same machine, or
// (worse, an identity-leak direction, not just a data-loss one) a page reusing the client-facing
// storageKey's session could resolve as if it were the OTHER role's identity. Fixed below with an
// explicit, distinct `storageKey` — never the library default — verified directly (not assumed)
// via a real two-context test: see scripts/verify-admin-real-login.mjs's own "storageKey
// isolation" check, which signs into both a real client session and a real admin session in the
// same browser storage and confirms each survives the other's sign-in untouched. This also gives
// the admin session its own BroadcastChannel (GoTrueClient.ts:527-529, keyed by storageKey) —
// cross-tab session-change notifications for the admin tool and the client dashboard are now
// correctly independent, never crossing into each other.
//
// ---- What was REMOVED, and why it's safe to remove ----
// The password-prompt modal (buildSupabaseAdminPasswordModal/promptForSupabaseAdminPassword)
// and the local-stack silent-auto-sign-in-with-a-hardcoded-credential branch are both gone.
// Both existed to establish a real session LAZILY, the first time a privileged call needed one
// — necessary when the passphrase gate (a separate, weaker mechanism) was the only thing
// guaranteeing a PM had "gotten in" before that point. Now that admin-login.html's real sign-in
// is itself the ONLY way to reach any admin page's real content (admin-sidebar.js redirects
// immediately otherwise), a real session already exists by the time any of this file's own
// code runs on any other admin page — there is nothing left for a lazy prompt to lazily
// establish. ensureSupabaseAdminSignedIn() below is now a pure "confirm a real session exists,
// redirect to the real login page if not" defense-in-depth check, never an attempt to sign in
// on its own.
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

// Real, disclosed local-dev credential — same "not actually a secret, well-known local-only
// credential" category as every other local bootstrap credential in this project (see
// scripts/supabase-bootstrap-admin.js's own header). Exported (below) purely so
// admin-login.html can show it as a convenience hint on the local stack — it is never used
// to sign in automatically any more (see the ★ Admin Auth Consolidation comment above for
// why the previous auto-sign-in branch was removed).
const LOCAL_ADMIN_EMAIL = 'pm@marketswave.local';
const LOCAL_ADMIN_PASSWORD = 'MarketswavePM-Local-2026!';
const STAGING_ADMIN_EMAIL = 'pm@marketswave-staging.internal';

const supabase = createClient(ACTIVE_CONFIG.url, ACTIVE_CONFIG.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // Explicit, distinct storage key — see the ★ Admin Auth Consolidation comment above for
    // the full "why this cannot be left at the library default" investigation. Any fixed,
    // distinct string works; this one is simply descriptive.
    storageKey: 'sb-marketswave-admin-auth-token'
  }
});

// Mirrors admin-sidebar.js's own currentEnvQuery() — duplicated here (not imported) for the
// same reason admin-login.html's own copy already documents: this file is a separate ES
// module, and admin-sidebar.js's version is a plain-script-scoped function, not something
// this file could import even if it wanted to.
function currentEnvQuery() {
  try {
    return new URLSearchParams(window.location.search).get('env') === 'staging' ? '?env=staging' : '';
  } catch (e) { return ''; }
}

let sessionCheckPromise = null;

// ---- ensureSupabaseAdminSignedIn() — REWRITTEN, 2026-09-05 ----
// Previously: lazily SIGNED IN (local: silent auto-sign-in with a hardcoded credential;
// staging: a password-prompt modal), because a real session didn't necessarily exist yet by
// the time a privileged call needed one — the passphrase gate was a separate, weaker
// mechanism that didn't guarantee it. Now: admin-login.html's real sign-in is the ONLY way to
// reach any admin page's real content at all (admin-sidebar.js's gate redirects immediately
// otherwise), so a real session is always ALREADY established by the time this runs anywhere
// else. This function is now a pure defense-in-depth check — confirm a real session exists;
// if one genuinely doesn't (a stale tab, a session that expired mid-use, a direct navigation
// that somehow raced past admin-sidebar.js's own gate), redirect to the real login page rather
// than attempting to establish one itself. Never resolves on the redirect path — the caller's
// own `.then()` chain is correctly abandoned mid-navigation rather than running with no real
// session.
function ensureSupabaseAdminSignedIn() {
  if (!sessionCheckPromise) {
    sessionCheckPromise = supabase.auth.getSession().then(function (res) {
      if (res.data.session) return res.data.session;
      // window.location, not bare location — this file already consistently reads
      // window.location.search/hostname elsewhere above; staying consistent here also avoids
      // a real regression a bare `location` global would introduce for any Node test harness
      // (several pre-existing ones in this project) that stubs `window` without also stubbing
      // a separate top-level `location` — confirmed by finding and fixing exactly that
      // ReferenceError in two existing verification scripts when this function was first
      // written with a bare `location.replace(...)` call.
      window.location.replace('admin-login.html' + currentEnvQuery());
      return new Promise(function () {}); // never resolves — page is navigating away
    }).catch(function (err) {
      // Don't leave a rejected promise cached forever — a genuine transient failure (e.g. a
      // stopped local stack) shouldn't permanently break every later call on this page.
      sessionCheckPromise = null;
      throw err;
    });
  }
  return sessionCheckPromise;
}

export { supabase, ensureSupabaseAdminSignedIn, WANTS_STAGING, LOCAL_ADMIN_EMAIL, LOCAL_ADMIN_PASSWORD, STAGING_ADMIN_EMAIL };
