// Supabase Migration — Stage 2 (Aug 30, 2026), Stage 3 (Aug 30, 2026), Firebase Retirement
// (Aug 30, 2026) — shared Supabase client bootstrap for signup.html and login.html ONLY,
// mirroring firebase-config.js's exact shape/role for the (now-retired) Firebase side. Plain
// ES module, loaded via <script type="module" src="supabase-config.js"> — no bundler,
// matching this project's "no build step" convention; @supabase/supabase-js ships a real ES
// module build from a CDN, loaded the same way the Firebase SDK already is.
//
// ---- SUPABASE IS NOW THE SOLE ACTIVE BACKEND — read this before assuming the old scheme
// still applies. Firebase is RETIRED as of Aug 30, 2026 (see firebase-config.js's own header
// for the full "why"), kept only as historical/reference code, no longer reachable by
// accident.
//
// ★ Pre-hosting fix (2026-09-04) — the local-vs-staging DEFAULT was inverted a second time,
// this time deliberately, before this project goes anywhere public. The Aug 30 inversion
// above made the default "(no params) -> LOCAL Docker stack" — correct for a developer
// running this project entirely on their own machine, but WRONG for a real hosted
// deployment: a real visitor's browser will never carry `?env=staging` (or any other query
// param) in the URL, so a page served from a real public domain with that old default would
// silently try to reach `http://127.0.0.1:54321` — unreachable from anywhere but the
// developer's own machine — and every real signup/login would simply fail. Confirmed
// directly by reading this file's own prior logic before changing anything, not assumed.
//
// The fix: default to whichever backend the PAGE'S OWN HOSTNAME implies, not a query param.
// `window.location.hostname` is `localhost`/`127.0.0.1` ONLY when this project is being
// served by a local dev server (confirmed against this project's own real workflow —
// README.md's own runbook serves it via `python -m http.server` at `127.0.0.1:8765`) — a
// real hosted deployment is, by definition, served from some other real domain. This makes
// the safe choice the automatic one, with zero configuration required either way, rather
// than relying on every developer to remember an opt-in flag or every hosting setup to
// remember an opt-out one:
//
//   Real hosted domain, (no params)          -> Supabase, REAL cloud staging   (NEW DEFAULT
//                                                for anything not on localhost/127.0.0.1 —
//                                                THE fix this pass makes)
//   localhost/127.0.0.1, (no params)         -> Supabase, LOCAL Docker stack   (unchanged
//                                                real-world behavior for every existing local
//                                                dev workflow — auto-detected, no flag needed)
//   ?env=staging                             -> Supabase, REAL cloud staging, from ANYWHERE,
//                                                including localhost — an explicit override,
//                                                unchanged from before, still needed so local
//                                                development can deliberately test against
//                                                real staging (an existing, relied-upon
//                                                workflow — see README.md's own Staging
//                                                Environment section).
//   ?dev=local                               -> Supabase, LOCAL Docker stack, from ANYWHERE,
//                                                including a real hosted domain — the new,
//                                                explicit opt-IN this task asked for, for the
//                                                rare case of testing local backend code from
//                                                a non-localhost frontend host (e.g. a preview
//                                                deployment). NOT needed for normal local
//                                                development — hostname detection already
//                                                covers that automatically.
//   ?dev=local&env=staging (both present)    -> `env=staging` wins — the more explicit "give
//                                                me staging" signal takes priority over the
//                                                dev-local opt-in, matching how `env=staging`
//                                                was already the strongest explicit signal in
//                                                the pre-existing scheme.
//   ?backend=supabase (/ &env=staging)       -> same as the matching row above — kept as a
//                                                harmless, redundant synonym so every existing
//                                                Stage 2/3 script, bookmark, and habit that
//                                                already typed this still works unchanged.
//   ?legacyBackend=firebase                  -> Firebase, emulator — UNCHANGED by this pass;
//                                                still requires this explicit,
//                                                unmistakable, distinctly-named flag.
//   ?legacyBackend=firebase&env=staging      -> Firebase, real staging — UNCHANGED.
//
// `legacyBackend` is the one and only door back to Firebase — deliberately not reusing
// `backend=firebase` (too easy to type by analogy with the still-supported `backend=supabase`
// synonym above) or a bare boolean-ish name. signup.html/login.html's own control flow needed
// ZERO changes for either inversion: they already check `IS_SUPABASE_BACKEND` first and
// `return` before ever reaching the Firebase branch below it.
const params = new URLSearchParams(window.location.search);
const LEGACY_FIREBASE_REQUESTED = params.get('legacyBackend') === 'firebase';
const IS_SUPABASE_BACKEND = !LEGACY_FIREBASE_REQUESTED;
const IS_LOCALHOST = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const FORCE_LOCAL_DEV = params.get('dev') === 'local';
const FORCE_STAGING = params.get('env') === 'staging';
const WANTS_SUPABASE_STAGING = IS_SUPABASE_BACKEND && (FORCE_STAGING || (!IS_LOCALHOST && !FORCE_LOCAL_DEV));

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
// DECISION for the ADMIN-facing Supabase client: persistSession: false, autoRefreshToken:
// true — mirroring admin-firebase-config.js's own inMemoryPersistence choice exactly, for
// the exact same reason ("a page refresh should re-prompt" must genuinely hold, not just
// "the password isn't written anywhere"). Built in Stage 3 as admin-supabase-config.js (a
// SEPARATE file, not this one — this file is client-facing only) using this exact
// configuration; see that file's own header. See README.md's Supabase runbook for the
// verification that proves both configurations behave as described, run directly against
// the real local stack in a real browser, not assumed from reading the source alone.
const supabase = createClient(ACTIVE_CONFIG.url, ACTIVE_CONFIG.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

export { supabase, IS_SUPABASE_BACKEND, WANTS_SUPABASE_STAGING };
