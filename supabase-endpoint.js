// Homepage design round 2 (2026-09-08) — WHICH Supabase project this browser talks to, and
// nothing else.
//
// Extracted verbatim out of supabase-config.js: every comment, constant and the resolution
// rule itself are unchanged, only relocated. supabase-config.js imports and re-exports all of
// it, so every existing consumer keeps importing exactly what it always did.
//
// ★ WHY IT WAS SPLIT OUT: home-hero.js needs the project URL and public anon key to call one
// unauthenticated Edge Function for the homepage ticker. Importing supabase-config.js for
// them would pull the entire @supabase/supabase-js bundle from a third-party CDN onto a
// marketing page — that file constructs a real client at module scope — which is a genuine
// page-weight cost for a decorative tape. Copying the two literals into home-hero.js instead
// was rejected for the reason supabase-config.js's own comment already gives: it creates a
// real drift risk the moment either value is rotated. This module imports nothing at all, so
// a caller that only needs the endpoint pays only for the endpoint.

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

export { IS_SUPABASE_BACKEND, WANTS_SUPABASE_STAGING, LOCAL_CONFIG, STAGING_CONFIG, ACTIVE_CONFIG };
