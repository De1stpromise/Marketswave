// Supabase Migration — Stage 2 (Aug 30, 2026) — shared Supabase client bootstrap for
// signup.html and login.html ONLY, mirroring firebase-config.js's exact shape/role for the
// Firebase side. Plain ES module, loaded via <script type="module" src="supabase-config.js">
// — no bundler, matching this project's "no build step" convention; @supabase/supabase-js
// ships a real ES module build from a CDN, loaded the same way the Firebase SDK already is.
//
// ---- Disambiguating THREE backends, reported per instruction --------------------------
// Before this file, there was one axis: Firebase emulator vs. Firebase staging, chosen by
// `?env=staging` (see firebase-config.js's own header). This migration adds a SECOND,
// orthogonal axis — which backend FAMILY a page load hits at all — via a NEW, separate query
// param, `?backend=supabase`. The two params compose cleanly rather than colliding:
//
//   (no params)                        -> Firebase, emulator            (unchanged default)
//   ?env=staging                       -> Firebase, real staging        (unchanged)
//   ?backend=supabase                  -> Supabase, LOCAL Docker stack  (Stage 2)
//   ?backend=supabase&env=staging      -> Supabase, REAL cloud staging  (Stage 3, Aug 30,
//                                          2026 — now live, "Marketswave Staging",
//                                          project ref ujnmlwbpginplfnofhhv)
//
// `env` means "which tier of whichever backend family was selected"; `backend` means "which
// backend family at all." A query param (not a persisted flag or a hardcoded constant) was
// chosen for the exact same reasons firebase-config.js's own header already gives for
// `?env=staging`: it can't "accidentally stick" across sessions, and typing it is about as
// unambiguous an opt-in as this project's URL bar can offer. signup.html/login.html check
// `IS_SUPABASE_BACKEND` FIRST, before ever looking at Firebase's own `IS_STAGING` — the two
// files' existing Firebase code paths are completely unaffected when this param is absent,
// which is every existing habit and everything golden-path-regression.js (the Firebase one)
// does today.
const params = new URLSearchParams(window.location.search);
const IS_SUPABASE_BACKEND = params.get('backend') === 'supabase';
const WANTS_SUPABASE_STAGING = IS_SUPABASE_BACKEND && params.get('env') === 'staging';

// Pinned to the exact version scripts/package.json's package-lock.json resolved and Stage 1's
// own verify-supabase-schema.js ran against (2.112.4) — same "pin exact SDK version, don't
// float" discipline firebase-config.js already established for the Firebase JS SDK (11.0.2).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

// LOCAL-STACK-ONLY, DELIBERATELY. This URL and this ANON_KEY are NOT real project credentials
// — they are `supabase start`'s own local Docker stack, reachable only from this machine.
// ANON_KEY here is derived from supabase/config.toml's well-known, publicly-documented default
// local JWT secret (`super-secret-jwt-token-with-at-least-32-characters-long`), identical
// across every unmodified local Supabase project on any machine — the same "not actually a
// secret" category as the Firebase emulator's own hardcoded EMULATOR_CONFIG.apiKey (see that
// file's own comment) and scripts/supabase-bootstrap-admin.js's own header for the same
// precedent. An anon key is additionally never a secret by Supabase's own security model
// regardless of environment — access control is enforced by RLS (see Stage 1's migration),
// not by hiding this value.
const LOCAL_CONFIG = {
  url: 'http://127.0.0.1:54321',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
};

// REAL staging project config (Stage 3, Aug 30, 2026) — "Marketswave Staging"
// (ujnmlwbpginplfnofhhv), the same real, separate, persistent Supabase project Phase A1's
// Firebase-side staging work is named alongside in CLAUDE.md's own project table, NOT the
// same thing as a future real-production Supabase project (a decision not yet made — see
// the Backend Migration roadmap). `url` follows Supabase's own standard, deterministic
// per-project URL convention (`https://<project-ref>.supabase.co`), not guessed. `anonKey`
// was read directly from `supabase projects api-keys --project-ref ujnmlwbpginplfnofhhv
// --reveal` — a real project anon key, but per Supabase's own documented security model
// this is NOT a secret (identifies the project to client libraries; actual access control
// is enforced by real Auth + the real RLS policies deployed via Stage 1's migration and
// Stage 3's own `supabase db push`/`config push`), so it's safe to commit — mirroring
// firebase-config.js's own STAGING_CONFIG.apiKey precedent exactly. The service_role key
// (genuinely sensitive — bypasses RLS entirely) is never referenced here or anywhere else
// in browser-loaded code; it lives only in scripts/ tooling, read from a file kept OUTSIDE
// this repository (see scripts/supabase-staging-bootstrap-admin.js's own header).
const STAGING_CONFIG = {
  url: 'https://ujnmlwbpginplfnofhhv.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbm1sd2JwZ2lucGxmbm9maGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MTE5MDcsImV4cCI6MjEwMzQ4NzkwN30.nJ9hTEwyfJDK-pVDtDMto6xLgwVOe9SqJm-LJNiIINg'
};

const ACTIVE_CONFIG = WANTS_SUPABASE_STAGING ? STAGING_CONFIG : LOCAL_CONFIG;

// ---- Session persistence, deliberately decided and configured, not left at the library
// default — per instruction, given the exact real bug this project already hit once on the
// Firebase side (admin-firebase-config.js's own inMemoryPersistence fix, Aug 27, 2026): its
// default persistence (browserLocalPersistence, IndexedDB-backed) silently restored a
// signed-in session across what was supposed to be a fresh sign-in prompt.
//
// Checked directly against the ACTUAL installed @supabase/supabase-js source (v2.112.4,
// scripts/node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:17-21, 242-262) rather than
// assumed from memory: DEFAULT_OPTIONS = { autoRefreshToken: true, persistSession: true }, and
// when persistSession is true and running in a browser, storage defaults to
// `globalThis.localStorage` — i.e. the real default already behaves like a normal persisted
// login (survives a refresh/new tab, the same CATEGORY of behavior as Firebase's own default
// browserLocalPersistence, just backed by localStorage instead of IndexedDB). When
// persistSession is false, the client uses an in-memory-only storage adapter instead
// (memoryLocalStorageAdapter) and never touches localStorage at all — the direct Supabase
// analog of Firebase's inMemoryPersistence.
//
// DECISION for THIS file (the client-facing signup/login flow): persistSession: true,
// autoRefreshToken: true — explicitly set to the same values as the library default, not left
// implicit, because a normal client SHOULD stay signed in like a normal login (this is what
// the task asked for: "should behave like a normal login, presumably real persistence").
// detectSessionInUrl is explicitly set to false: that option parses the URL's hash fragment
// for OAuth/magic-link redirect tokens on every load, a flow this app never uses (plain
// email/password only) — disabling it removes a code path that could otherwise silently
// interact with this app's own query-string-based ?backend=/?env= scheme in an unexpected way,
// even though the two don't actually collide (magic-link tokens live in the URL HASH, this
// app's params live in the URL QUERY STRING) — explicit-over-implicit, per instruction.
//
// DECISION for a future ADMIN-facing Supabase client (Stage 3, not built yet — no admin page
// loads this file today, confirmed via grep): persistSession: false, autoRefreshToken: true —
// mirroring admin-firebase-config.js's own inMemoryPersistence choice exactly, for the exact
// same reason ("a page refresh should re-prompt" must genuinely hold, not just "the password
// isn't written anywhere"). Recorded here as the decision for whoever builds that client next,
// not implemented as dead code with no caller — see README.md's Supabase runbook for the
// verification that proves both configurations behave as described, run directly against the
// real local stack in a real browser, not assumed from reading the source alone.
const supabase = createClient(ACTIVE_CONFIG.url, ACTIVE_CONFIG.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

export { supabase, IS_SUPABASE_BACKEND, WANTS_SUPABASE_STAGING };
