// Supabase Migration — Stage 2 (Aug 30, 2026), Stage 3 (Aug 30, 2026), Firebase Retirement
// (Aug 30, 2026) — shared Supabase client bootstrap. Originally scoped as "signup.html and
// login.html ONLY" (mirroring firebase-config.js's exact shape/role for the now-retired
// Firebase side) — that comment went stale without ever being corrected: `supabase-data.js`'s
// own `getSupabaseClient()` has always reached this file via a dynamic `import()`, meaning
// every one of the 10 client dashboard pages effectively already depended on it. Unified
// Communications Inbox — Stage 1 (2026-09-07) adds a second, genuinely NEW real consumer
// beyond that pre-existing indirect one: `chat-widget.js`, loaded on the public marketing
// site too (a real, disclosed, narrowly-scoped exception to that site's own "no backend SDK"
// boundary — see that file's own header for the full reasoning). Plain ES module, loaded via
// <script type="module" src="supabase-config.js"> on signup.html/login.html directly, or via
// dynamic `import()` everywhere else — no bundler, matching this project's "no build step"
// convention; @supabase/supabase-js ships a real ES module build from a CDN, loaded the same
// way the Firebase SDK already is.
//
// ---- SUPABASE IS NOW THE SOLE ACTIVE BACKEND — read this before assuming the old scheme
// still applies. Firebase is RETIRED as of Aug 30, 2026 (see firebase-config.js's own header
// for the full "why"), kept only as historical/reference code, no longer reachable by
// accident.
//
// ★ The environment resolution and both project configs now live in supabase-endpoint.js
// (design round 2, 2026-09-08) — moved verbatim, not rewritten, so that a caller needing
// only the endpoint (home-hero.js's public ticker fetch) does not have to pull this file's
// @supabase/supabase-js bundle onto a marketing page. They are re-exported at the bottom of
// this file, so every existing importer is unaffected.
import {
  IS_SUPABASE_BACKEND,
  WANTS_SUPABASE_STAGING,
  LOCAL_CONFIG,
  STAGING_CONFIG,
  ACTIVE_CONFIG
} from './supabase-endpoint.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

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

// ACTIVE_CONFIG exported (Password Reset flow, 2026-09-07) so reset-password.html — the one
// page in this project that genuinely needs detectSessionInUrl: true, to auto-process a
// Supabase recovery-link token on load — can build its OWN client instance with that one
// differing auth option, without duplicating LOCAL_CONFIG/STAGING_CONFIG's own url/anonKey
// literal values in a second file (which would create a real drift risk if either ever
// rotates). Every other consumer of this module should keep using the shared `supabase`
// client above, not construct a second one.
export { supabase, IS_SUPABASE_BACKEND, WANTS_SUPABASE_STAGING, ACTIVE_CONFIG,
         LOCAL_CONFIG, STAGING_CONFIG };
