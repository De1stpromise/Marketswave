#!/usr/bin/env node
// Admin Auth Consolidation (2026-09-05): the client-side passphrase gate
// (checkAdminPassphrase()/setAdminAuthenticated()/isAdminAuthenticated()/
// clearAdminAuthenticated(), now retired in engine-core.js) is replaced entirely by a real
// Supabase Auth session — one real email/password sign-in on admin-login.html, checked
// directly by admin-sidebar.js on every admin page. This script verifies the REAL,
// unmodified production files (admin-sidebar.js, admin-supabase-config.js, and
// admin-login.html's own inline module script, extracted verbatim) against the real local
// Supabase stack — no reimplementation of the gate/session logic under test.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-admin-real-login.mjs
//
// ---- Why "genuinely fresh module instances sharing only localStorage" matters here ----
// The admin tool is a set of separate static HTML pages, not an SPA — every real navigation
// between admin pages is a full page reload in a real browser: a brand-new JS execution
// context, a brand-new admin-supabase-config.js module instantiation (a brand-new
// createClient() call), with ONLY localStorage carrying continuity forward. A test that
// simply reuses the SAME in-memory `supabase` client object across multiple simulated "page
// visits" would trivially "prove" persistence without ever exercising the real
// storage-read-on-init path a real reload actually depends on. This script instead writes
// fresh, byte-for-byte-unmodified temp copies of admin-sidebar.js + admin-supabase-config.js
// into a NEW directory for every simulated page load — a genuinely distinct Node module-cache
// entry each time, exactly mirroring this project's own established "genuinely separate
// contexts" technique (see verify-cross-role-sync-bugfix.mjs / verify-products-catalog-fix.mjs
// for the same technique applied to supabase-data.js) — while deliberately sharing ONE
// localStorage polyfill object across the relevant simulated loads, the one thing a real
// browser tab's reloads would also share.
//
// ---- Why window/document need to be real (if minimal) globals, not just localStorage ----
// Checked directly against the installed SDK source (@supabase/auth-js
// dist/main/lib/helpers.js:60-91): supportsLocalStorage() — which persistSession: true relies
// on to decide whether to use globalThis.localStorage at all — first calls isBrowser()
// (typeof window !== 'undefined' && typeof document !== 'undefined'); without both defined,
// the SDK would silently fall back to an in-memory-only adapter regardless of
// persistSession's own value, which would make this entire verification pass for the wrong
// reason (falsely "proving" persistence via JS-object continuity, the exact false positive
// the fresh-module-instance technique above is designed to rule out). Minimal plain objects
// satisfy both checks — no real DOM/jsdom needed for the session mechanics themselves.

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitFor(test, maxMs) {
  const start = Date.now();
  for (;;) {
    const result = await test();
    if (result) return result;
    if (Date.now() - start > maxMs) return result;
    await sleep(50);
  }
}

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: PROJECT_ROOT, encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

// ---- Real, byte-for-byte-unmodified temp copies (see the file header for why) ----
function makeTempAdminDir() {
  return mkdtempSync(path.join(tmpdir(), 'ms-admin-login-test-'));
}

function copyRealFile(name, destDir) {
  const src = readFileSync(path.join(PROJECT_ROOT, name), 'utf8');
  const dest = path.join(destDir, name);
  writeFileSync(dest, src);
  return dest;
}

function extractModuleScript(htmlFileName) {
  const html = readFileSync(path.join(PROJECT_ROOT, htmlFileName), 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Could not find a <script type="module"> block in ' + htmlFileName);
  return m[1];
}

// ---- Minimal, faithful global stubs ----
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: function (k) { return store.has(k) ? store.get(k) : null; },
    setItem: function (k, v) { store.set(k, String(v)); },
    removeItem: function (k) { store.delete(k); },
    clear: function () { store.clear(); },
    key: function (i) { return Array.from(store.keys())[i] ?? null; },
    get length() { return store.size; },
    // Test-only introspection, not part of the real Storage interface.
    _rawKeys: function () { return Array.from(store.keys()); }
  };
}

// Element stub supporting exactly the surface admin-sidebar.js/admin-login.html's inline
// script actually calls: innerHTML, addEventListener (capturing callbacks so this script can
// invoke them for real, e.g. a real click on the logout button or the login submit button),
// getAttribute/setAttribute, and a no-op classList.
function makeElementStub() {
  const listeners = {};
  return {
    innerHTML: '',
    value: '',
    disabled: false,
    textContent: '',
    _listeners: listeners,
    addEventListener: function (evt, fn) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    dispatch: function (evt, evObj) {
      (listeners[evt] || []).forEach(function (fn) { fn(evObj || {}); });
    },
    getAttribute: function () { return null; },
    setAttribute: function () {},
    focus: function () {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }
  };
}

function makeDocumentStub() {
  const elements = {};
  function el(id) {
    if (!elements[id]) elements[id] = makeElementStub();
    return elements[id];
  }
  return {
    _elements: elements,
    getElementById: function (id) { return el(id); },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

// One real location object shared between `globalThis.window.location` (used by
// currentEnvQuery()'s `window.location.search`) and bare `globalThis.location` (used by
// every bare `location.replace(...)` call) — a real browser's `window` and the global scope
// are the same object, so both access patterns resolve to the identical Location; this stub
// preserves that by construction rather than accidentally diverging.
function makeLocation() {
  const loc = { search: '', hostname: '127.0.0.1', replaceCalls: [] };
  loc.replace = function (url) { loc.replaceCalls.push(url); };
  return loc;
}

function setFreshGlobals(localStorage) {
  const location = makeLocation();
  const document = makeDocumentStub();
  globalThis.window = { location: location };
  globalThis.document = document;
  globalThis.location = location;
  globalThis.localStorage = localStorage;
  return { location: location, document: document };
}

async function main() {
  console.log('Admin Auth Consolidation verification (real Supabase Auth session replaces the retired passphrase gate)\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');
  const svc = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // ==========================================================================================
  console.log('-- Section A: real sign-in mechanics against admin-supabase-config.js directly --');
  // ==========================================================================================
  {
    const ls = makeLocalStorage();
    setFreshGlobals(ls);
    const mod = await import(pathToFileURL(path.join(PROJECT_ROOT, 'admin-supabase-config.js')).href + '?A=' + Date.now());
    check('admin-supabase-config.js loaded for real (WANTS_STAGING correctly false for a 127.0.0.1 host)', mod.WANTS_STAGING === false);

    const before = await mod.supabase.auth.getSession();
    check('no session exists before any sign-in', before.data.session === null);

    const wrong = await mod.supabase.auth.signInWithPassword({ email: mod.LOCAL_ADMIN_EMAIL, password: 'definitely-wrong-password' });
    check('real signInWithPassword with a wrong password is rejected', !!wrong.error);
    const stillNone = await mod.supabase.auth.getSession();
    check('no session was created by the failed attempt', stillNone.data.session === null);

    const correct = await mod.supabase.auth.signInWithPassword({ email: mod.LOCAL_ADMIN_EMAIL, password: mod.LOCAL_ADMIN_PASSWORD });
    check('real signInWithPassword with the real local bootstrap credential succeeds', !correct.error, correct.error && correct.error.message);
    const after = await mod.supabase.auth.getSession();
    check('a real session now exists for the correct PM account', !!(after.data.session && after.data.session.user.email === mod.LOCAL_ADMIN_EMAIL));

    const rawKeys = ls._rawKeys();
    check('the session was persisted under the explicit, distinct admin storageKey', rawKeys.indexOf('sb-marketswave-admin-auth-token') !== -1, JSON.stringify(rawKeys));
  }

  // ==========================================================================================
  console.log('\n-- Section B: visiting an admin page while logged out redirects to the real login --');
  // ==========================================================================================
  {
    const ls = makeLocalStorage(); // fresh, empty — nobody signed in
    const { location } = setFreshGlobals(ls);
    const dir = makeTempAdminDir();
    copyRealFile('admin-supabase-config.js', dir);
    const sidebarPath = copyRealFile('admin-sidebar.js', dir);

    await import(pathToFileURL(sidebarPath).href);
    globalThis.window.initAdminSidebar('deposits');
    await waitFor(function () { return location.replaceCalls.length > 0; }, 3000);

    check('an unauthenticated visit redirects to admin-login.html', location.replaceCalls.indexOf('admin-login.html') !== -1, JSON.stringify(location.replaceCalls));
    check('the sidebar mount was never rendered for an unauthenticated visitor', globalThis.document._elements['admin-sidebar-mount'] === undefined || globalThis.document._elements['admin-sidebar-mount'].innerHTML === '');
  }

  // ==========================================================================================
  console.log('\n-- Section C: real sign-in through admin-login.html\'s own extracted inline script --');
  // ==========================================================================================
  const sharedLS = makeLocalStorage(); // carried forward through Sections C, D, E below —
  // the one thing a real browser's own repeated page loads would also carry forward.
  {
    const { location, document } = setFreshGlobals(sharedLS);
    const dir = makeTempAdminDir();
    copyRealFile('admin-supabase-config.js', dir);
    const inlineSrc = extractModuleScript('admin-login.html');
    const inlinePath = path.join(dir, 'admin-login-inline.mjs');
    writeFileSync(inlinePath, inlineSrc);

    // Wire the exact element ids the real script looks up via document.getElementById().
    document.getElementById('admin-login-submit-label').textContent = 'Sign In';

    await import(pathToFileURL(inlinePath).href);
    // The real script's own "already signed in?" check runs immediately on load — give it a
    // moment, then confirm it correctly found nothing (this is a fresh, signed-out context)
    // and did NOT redirect past the login form.
    await sleep(300);
    check('admin-login.html\'s own real "already signed in" check correctly found no session on first load', location.replaceCalls.length === 0, JSON.stringify(location.replaceCalls));

    const emailInput = document.getElementById('admin-email-input');
    const passwordInput = document.getElementById('admin-password-input');
    const errorEl = document.getElementById('admin-login-error');
    const submitBtn = document.getElementById('admin-login-submit');

    // Real wrong-password attempt through the real form's own click handler.
    emailInput.value = 'pm@marketswave.local';
    passwordInput.value = 'wrong-password-entirely';
    submitBtn.dispatch('click');
    await waitFor(function () { return errorEl.classList && errorEl.textContent !== ''; }, 3000);
    check('the real login form shows a generic error for a wrong password', errorEl.textContent === 'Invalid email or password.', errorEl.textContent);
    check('a wrong-password attempt through the real form issued no redirect', location.replaceCalls.length === 0);

    // Real correct sign-in through the real form's own click handler.
    passwordInput.value = 'MarketswavePM-Local-2026!';
    submitBtn.dispatch('click');
    await waitFor(function () { return location.replaceCalls.length > 0; }, 3000);
    check('a correct sign-in through the real form redirects to admin.html', location.replaceCalls.indexOf('admin.html') !== -1, JSON.stringify(location.replaceCalls));
  }

  // ==========================================================================================
  console.log('\n-- Section D: navigating between several admin pages does NOT require re-authentication --');
  // ==========================================================================================
  const pageSequence = ['deposits', 'allocations', 'overview', 'deposits'];
  for (const pageKey of pageSequence) {
    const { location, document } = setFreshGlobals(sharedLS); // SAME localStorage as Section C's real sign-in, GENUINELY fresh module instances (a new temp dir every iteration)
    const dir = makeTempAdminDir();
    copyRealFile('admin-supabase-config.js', dir);
    const sidebarPath = copyRealFile('admin-sidebar.js', dir);

    await import(pathToFileURL(sidebarPath).href);
    globalThis.window.initAdminSidebar(pageKey);
    await waitFor(function () { return document._elements['admin-sidebar-mount'] && document._elements['admin-sidebar-mount'].innerHTML !== ''; }, 3000);

    check('navigating to "' + pageKey + '" (fresh module instance) needed no re-authentication', location.replaceCalls.length === 0, JSON.stringify(location.replaceCalls));
    check('"' + pageKey + '" genuinely rendered the sidebar (real session confirmed, not just "no redirect yet")', document._elements['admin-sidebar-mount'] && document._elements['admin-sidebar-mount'].innerHTML.indexOf('admin-sidebar-aside') !== -1);
  }

  // ==========================================================================================
  console.log('\n-- Section E: Logout genuinely ends the session, confirmed via a FRESH session check on the next page load --');
  // ==========================================================================================
  {
    // One more fresh "page load" (still signed in, per Section D) — this is the page the PM
    // clicks Log Out from.
    const { location, document } = setFreshGlobals(sharedLS);
    const dir = makeTempAdminDir();
    copyRealFile('admin-supabase-config.js', dir);
    const sidebarPath = copyRealFile('admin-sidebar.js', dir);
    await import(pathToFileURL(sidebarPath).href);
    globalThis.window.initAdminSidebar('deposits');
    await waitFor(function () { return document._elements['admin-sidebar-mount'] && document._elements['admin-sidebar-mount'].innerHTML !== ''; }, 3000);
    check('signed-in state confirmed immediately before testing Logout', location.replaceCalls.length === 0);

    const logoutBtn = document._elements['admin-logout-btn'];
    check('a real click handler is wired to the Logout button', !!(logoutBtn && logoutBtn._listeners.click && logoutBtn._listeners.click.length === 1));
    logoutBtn.dispatch('click');
    await waitFor(function () { return location.replaceCalls.length > 0; }, 4000);
    check('clicking Logout redirects to admin-login.html', location.replaceCalls.indexOf('admin-login.html') !== -1, JSON.stringify(location.replaceCalls));
  }
  {
    // THE critical check, same rigor as every prior logout verification in this project: a
    // GENUINELY FRESH page load (new temp module instances) sharing the SAME localStorage,
    // AFTER Logout, must be denied — not an in-page synchronous read of state Logout's own
    // click handler already mutated in memory, but a real new getSession() call resolving
    // against whatever Logout actually left behind in persisted storage.
    const { location } = setFreshGlobals(sharedLS);
    const dir = makeTempAdminDir();
    copyRealFile('admin-supabase-config.js', dir);
    const sidebarPath = copyRealFile('admin-sidebar.js', dir);
    await import(pathToFileURL(sidebarPath).href);
    globalThis.window.initAdminSidebar('overview');
    await waitFor(function () { return location.replaceCalls.length > 0; }, 3000);
    check('a fresh page load AFTER Logout is genuinely denied and redirected — not a stale in-memory read', location.replaceCalls.indexOf('admin-login.html') !== -1, JSON.stringify(location.replaceCalls));

    // Independent confirmation via a direct, fresh admin-supabase-config.js import (not
    // through admin-sidebar.js at all) — the same storage, checked a second, completely
    // different way.
    const mod = await import(pathToFileURL(path.join(PROJECT_ROOT, 'admin-supabase-config.js')).href + '?post-logout=' + Date.now());
    const res = await mod.supabase.auth.getSession();
    check('a fresh, independent getSession() call also confirms no session remains after Logout', res.data.session === null);
  }

  // ==========================================================================================
  console.log('\n-- Section F: storageKey isolation — the admin session cannot collide with the client-facing session --');
  // ==========================================================================================
  {
    const ls = makeLocalStorage();
    setFreshGlobals(ls);

    const suffix = crypto.randomBytes(4).toString('hex');
    const clientEmail = 'admin-login-isolation-' + suffix + '@test.marketswave.local';
    const clientPassword = 'IsolationTest-2026!';
    const { data: created, error: createErr } = await svc.auth.admin.createUser({ email: clientEmail, password: clientPassword, email_confirm: true });
    if (createErr) throw new Error('createUser failed: ' + createErr.message);

    try {
      const clientMod = await import(pathToFileURL(path.join(PROJECT_ROOT, 'supabase-config.js')).href + '?iso=' + Date.now());
      const adminMod = await import(pathToFileURL(path.join(PROJECT_ROOT, 'admin-supabase-config.js')).href + '?iso=' + Date.now());

      const clientSignIn = await clientMod.supabase.auth.signInWithPassword({ email: clientEmail, password: clientPassword });
      check('real client-facing sign-in succeeds (sharing the SAME localStorage as the admin client below)', !clientSignIn.error, clientSignIn.error && clientSignIn.error.message);

      const adminSignIn = await adminMod.supabase.auth.signInWithPassword({ email: adminMod.LOCAL_ADMIN_EMAIL, password: adminMod.LOCAL_ADMIN_PASSWORD });
      check('real admin sign-in ALSO succeeds in the same shared localStorage', !adminSignIn.error, adminSignIn.error && adminSignIn.error.message);

      const clientSessionAfter = await clientMod.supabase.auth.getSession();
      const adminSessionAfter = await adminMod.supabase.auth.getSession();
      check('the client-facing session still correctly resolves to the CLIENT account, not the admin\'s', !!(clientSessionAfter.data.session && clientSessionAfter.data.session.user.email === clientEmail), clientSessionAfter.data.session && clientSessionAfter.data.session.user.email);
      check('the admin session still correctly resolves to the PM account, not the client\'s', !!(adminSessionAfter.data.session && adminSessionAfter.data.session.user.email === adminMod.LOCAL_ADMIN_EMAIL), adminSessionAfter.data.session && adminSessionAfter.data.session.user.email);

      const rawKeys = ls._rawKeys();
      check('two DISTINCT storage keys exist side by side (the real fix under test)', rawKeys.indexOf('sb-marketswave-admin-auth-token') !== -1 && rawKeys.indexOf('sb-127-auth-token') !== -1, JSON.stringify(rawKeys));
    } finally {
      await svc.auth.admin.deleteUser(created.user.id);
    }
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
}

main().catch(function (err) {
  console.error('FATAL: ' + (err && err.stack || err));
  process.exit(1);
});
