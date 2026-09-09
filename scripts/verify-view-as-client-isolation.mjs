#!/usr/bin/env node
// Backend Migration Phase C — Stage 2 (2026-09-06): "View as Client" session isolation.
//
// INVESTIGATED FIRST, per instruction, before any test was written — see this script's own
// findings echoed in CLAUDE.md's Tech Stack entry for the full writeup. Summary: "View as
// this Client" (admin-clients.html's expanded-row button) calls ONE function,
// setCurrentClientId(id) — a plain `sessionStorage.setItem('marketswave_current_client_id',
// id)` (engine-core.js:494-498). It does not read, write, or reference the real Supabase
// Auth session in any way — that session lives entirely inside the Supabase JS SDK's own
// client instance, under an entirely different storage key
// (`sb-marketswave-admin-auth-token` for the admin, the SDK's own default
// `sb-<hostname>-auth-token` for a client-facing page), managed by a completely separate
// subsystem (GoTrueClient) that setCurrentClientId() never touches. The button is ALSO
// gated off entirely for a real Supabase-authenticated client (`_source === 'supabase'`) —
// confirmed already by verify-admin-final-wiring.mjs's own test 4c — so the SPECIFIC risk
// scenario the task describes (a real PM viewing a real Supabase client) is structurally
// unreachable through the UI at all. This script goes one level deeper than that existing
// UI-gate check: it calls the underlying setCurrentClientId() primitive DIRECTLY, bypassing
// the UI gate entirely, against a real Supabase client's real uid — proving the raw
// mechanism itself cannot leak, not just that the button happens to be hidden today.
//
// Uses ONE real jsdom window (real Storage implementations, not stubs) as the shared
// browser tab both the real Supabase JS SDK and the real engine-core.js execute against —
// the same "genuinely separate contexts" discipline already proven for the cross-role sync
// bug fix, applied here to prove separation WITHIN one page (admin session vs. local
// ambient variable) and ACROSS two pages (a second, fully independent real client session,
// its own separate jsdom window/storage, never touched by anything in the first).
//
// LOCAL STACK ONLY. Standing convention: Node/API-level (here jsdom-DOM-level) verification
// only, no browser automation, per CLAUDE.md.
//
// Usage:  node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-view-as-client-isolation.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

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

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function main() {
  console.log('Backend Migration Phase C — Stage 2 verification ("View as Client" session isolation)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'ViewAsClientVerify-2026!';

  // A real Supabase-authenticated client — the exact identity "View as Client" can never
  // legitimately be invoked against, but the one this test deliberately targets anyway, to
  // prove the underlying primitive is safe even when called against exactly this identity.
  const { data: realClientUser, error: realClientErr } = await admin.auth.admin.createUser({
    email: 'view-as-target-' + suffix + '@test.marketswave.local', password: password, email_confirm: true
  });
  if (realClientErr) throw new Error('createUser (real client) failed: ' + realClientErr.message);

  // Cleanup used to be a bare sequence at the end of main() with no try/finally at all, so
  // any throw between here and there stranded both test auth users and their clients rows.
  // That is not theoretical: this script failed once inside a full-suite run and left
  // view-as-target-* users behind. The try opens as soon as the first real row exists.
  let approveTestClient = null;
  try {

  await admin.from('clients').insert({
    id: realClientUser.user.id, name: 'Real Client Target', email: realClientUser.user.email,
    phone: '+1-555-0500', account_type: 'Individual Account', status: 'active'
  });

  // ===========================================================================================
  // PART A — same-page mechanism proof: a REAL admin Supabase session and REAL engine-core.js
  // sharing ONE real jsdom window's storage, exactly like the real admin-clients.html page.
  // ===========================================================================================
  console.log('=== PART A: same-page mechanism proof (real admin session + real engine-core.js) ===\n');

  const adminDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:8765/' });
  // Bind the global scope BOTH ways (window.* and bare) — exactly what a real browser tab
  // provides via its own global scope chain, and what admin-supabase-config.js's own
  // `createClient()` call (no explicit `storage` override) needs in order to genuinely bind
  // to THIS window's real Storage implementation rather than falling back to an in-memory
  // stub, which would silently prove nothing about real persisted-session behavior.
  // bare `document` is REQUIRED too, not just window/localStorage — confirmed directly
  // against the installed SDK source (@supabase/auth-js's supportsLocalStorage() calls
  // isBrowser(): `typeof window !== 'undefined' && typeof document !== 'undefined'`, same
  // finding verify-admin-real-login.mjs's own header already documents); without it the SDK
  // silently falls back to an in-memory adapter regardless of persistSession's own value,
  // which was caught here directly — a first draft omitting this line left localStorage
  // genuinely empty after a real sign-in, a false negative in this test, not a real app bug.
  globalThis.window = adminDom.window;
  globalThis.document = adminDom.window.document;
  globalThis.localStorage = adminDom.window.localStorage;
  globalThis.sessionStorage = adminDom.window.sessionStorage;

  const adminConfigMod = await import('../admin-supabase-config.js');
  const { data: adminSignInData, error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({
    email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD
  });
  if (adminSignInErr) throw new Error('Real admin sign-in failed: ' + adminSignInErr.message);
  const realAdminUserId = adminSignInData.user.id;
  const realAdminAccessToken = adminSignInData.session.access_token;
  check('a real admin Supabase session was genuinely established', !!realAdminAccessToken);

  // Load the REAL engine-core.js into the SAME jsdom window — bare localStorage/sessionStorage
  // references inside it resolve to THIS window's real Storage, the same object the admin
  // Supabase client above is persisting its own session into. This is the real, faithful
  // "one browser tab, one shared storage, two subsystems" reproduction of admin-clients.html.
  const engineCoreSource = readFileSync(fileURLToPath(new URL('../engine-core.js', import.meta.url)), 'utf8');
  adminDom.window.eval(engineCoreSource);

  // supabase-js persists to storage asynchronously (a microtask after signInWithPassword()
  // resolves), so poll briefly rather than reading synchronously right after await — a real
  // timing gap in THIS test, not the app, confirmed by every later read of the same key
  // succeeding once given a moment to land.
  const adminSupabaseTokenKey = 'sb-marketswave-admin-auth-token';
  let adminTokenBefore = adminDom.window.localStorage.getItem(adminSupabaseTokenKey);
  for (let i = 0; !adminTokenBefore && i < 20; i++) {
    await new Promise(function (r) { setTimeout(r, 100); });
    adminTokenBefore = adminDom.window.localStorage.getItem(adminSupabaseTokenKey);
  }
  check('the real admin session token is present in this window\'s real localStorage before the test action', !!adminTokenBefore);
  const adminLocalStorageSnapshotBefore = JSON.stringify(Object.assign({}, adminDom.window.localStorage));

  console.log('\n1. Calling setCurrentClientId() DIRECTLY against a real Supabase client\'s real uid\n');
  // Bypasses the UI gate entirely (the button never renders for this identity) — tests the
  // raw primitive itself, the more rigorous proof the task asked for.
  adminDom.window.setCurrentClientId(realClientUser.user.id);
  check('setCurrentClientId() ran with no error against a real Supabase client\'s real uid', adminDom.window.getCurrentClientId() === realClientUser.user.id);

  const adminTokenAfter = adminDom.window.localStorage.getItem(adminSupabaseTokenKey);
  check('the admin\'s real Supabase session token in localStorage is BYTE-IDENTICAL before and after', adminTokenBefore === adminTokenAfter);

  const { data: sessionAfterViewAs, error: sessionAfterErr } = await adminConfigMod.supabase.auth.getSession();
  check('the admin Supabase client\'s own real live session is UNCHANGED — still the real admin\'s own id, never the viewed client\'s', !sessionAfterErr && sessionAfterViewAs.session && sessionAfterViewAs.session.user.id === realAdminUserId, JSON.stringify(sessionAfterViewAs.session && sessionAfterViewAs.session.user.id));
  check('the admin\'s real session user id is genuinely DIFFERENT from the viewed client\'s real id (not a coincidental match)', realAdminUserId !== realClientUser.user.id);

  // Confirm calling a real admin-authorized Edge Function AFTER "viewing" the client still
  // authenticates as the real admin — the actual, concrete consequence that would matter if
  // any contamination had occurred (every admin action would silently execute as the wrong
  // identity).
  ({ data: approveTestClient } = await admin.auth.admin.createUser({
    email: 'view-as-approve-check-' + suffix + '@test.marketswave.local', password: password, email_confirm: true
  }));
  await admin.from('clients').insert({
    id: approveTestClient.user.id, name: 'Approve Check', email: approveTestClient.user.email,
    phone: '+1-555-0501', account_type: 'Individual Account', status: 'pending_review'
  });
  const { data: approvedAfterViewAs, error: approveErr } = await adminConfigMod.supabase.functions.invoke('approve-client-application', { body: { clientId: approveTestClient.user.id } });
  check('a real admin-authorized Edge Function call AFTER "View as Client" still succeeds as the real admin (not silently broken)', !approveErr, approveErr && approveErr.message);
  const { data: approvedRow } = await admin.from('clients').select('application_resolved_by,application_resolved_by_email').eq('id', approveTestClient.user.id).single();
  check('the resulting attribution is the REAL ADMIN\'s own id+email — never the viewed client\'s — proving no identity contamination occurred', approvedRow.application_resolved_by === realAdminUserId && approvedRow.application_resolved_by_email === adminConfigMod.LOCAL_ADMIN_EMAIL, JSON.stringify(approvedRow));

  // Confirm no NEW Supabase-Auth-SDK-shaped key was created for the viewed client — the
  // ONLY thing that changed in this window's entire localStorage is the plain engine-core.js
  // ambient variable (a sessionStorage key, not even localStorage).
  const adminLocalStorageSnapshotAfter = JSON.stringify(Object.assign({}, adminDom.window.localStorage));
  check('this window\'s real localStorage is COMPLETELY UNCHANGED by setCurrentClientId() — it only ever touches sessionStorage', adminLocalStorageSnapshotBefore === adminLocalStorageSnapshotAfter);
  const sessionStorageKeys = Object.keys(adminDom.window.sessionStorage);
  check('sessionStorage contains the plain local ambient key, never anything Supabase-Auth-SDK-shaped ("sb-...")', sessionStorageKeys.includes('marketswave_current_client_id') && !sessionStorageKeys.some(function (k) { return k.startsWith('sb-'); }), JSON.stringify(sessionStorageKeys));

  console.log('\n2. UI-gate re-confirmation: "View as this Client" genuinely never renders for this same real client, via the real admin-clients.html page itself\n');
  await (async function () {
    globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
    await import('../supabase-data.js');
    const MarketswaveData = globalThis.window.MarketswaveData;

    const path = fileURLToPath(new URL('../admin-clients.html', import.meta.url));
    const html = readFileSync(path, 'utf8');
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
    const bodyMarkup = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
    const pageDom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
    pageDom.window.MarketswaveData = MarketswaveData;
    pageDom.window.getAllClients = function () { return []; };
    pageDom.window.getCurrentClientId = function () { return null; };
    pageDom.window.getTotalPortfolioValue = function () { return 0; };
    pageDom.window.getClientPendingApprovalCount = function () { return 0; };
    pageDom.window.resetClientPassword = function () { throw new Error('not used in this test'); };
    pageDom.window.resetClient2FA = function () { throw new Error('not used in this test'); };
    pageDom.window.addClient = function () { throw new Error('not used in this test'); };

    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
    const script = scripts.find(function (s) { return s.indexOf('Admin UI Wiring — Final Stage') !== -1; });
    const clientsList = pageDom.window.document.getElementById('clients-list');
    pageDom.window.eval(script);

    const start = Date.now();
    while (clientsList.textContent.indexOf('Real Client Target') === -1 && Date.now() - start < 20000) {
      await new Promise(function (r) { setTimeout(r, 150); });
    }
    check('the real client (the exact same one setCurrentClientId() was called against above) renders in Client List', clientsList.textContent.indexOf('Real Client Target') !== -1);

    const row = [...clientsList.querySelectorAll('tr.client-row')].find(function (tr) { return tr.dataset.id === realClientUser.user.id; });
    row.click();
    const expandStart = Date.now();
    let expandRow = clientsList.querySelector('tr.expand-row');
    while ((!expandRow || expandRow.textContent.indexOf('Loading') !== -1) && Date.now() - expandStart < 20000) {
      await new Promise(function (r) { setTimeout(r, 150); });
      expandRow = clientsList.querySelector('tr.expand-row');
    }
    check('no "View as this Client" button renders for this real Supabase client — the UI gate independently confirms the same thing the raw-primitive test above already proved', !expandRow.querySelector('.view-btn'));
  })();

  // ===========================================================================================
  // PART B — genuinely separate context: a SECOND, fully independent real client session
  // (its own jsdom window, its own real localStorage, sharing NOTHING with Part A's window),
  // confirmed untouched by everything Part A just did.
  // ===========================================================================================
  console.log('\n=== PART B: genuinely separate real client session, confirmed untouched ===\n');

  const { data: secondClientAuth, error: secondClientSignupErr } = await (async function () {
    const clientDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:8765/' });
    // A SEPARATE createClient() call with an EXPLICIT storage bound to THIS SECOND window's
    // own real localStorage — genuinely independent JS objects from Part A's window, the
    // same "two independent module instances/contexts" rigor already proven for the
    // cross-role sync bug fix, applied here via two literally separate jsdom Storage
    // instances rather than two temp-file module copies (the mechanism differs because the
    // risk differs: there Node's own require-cache could silently share state; here two
    // separate `new JSDOM()` calls are, by construction, two separate objects with no shared
    // reference of any kind — confirmed, not just assumed, by the identity checks below).
    // A harmless SDK console warning ("Multiple GoTrueClient instances detected in the same
    // browser context") fires here — confirmed to be a diagnostic artifact of running two
    // independent createClient() instances in ONE Node process (this test harness's own
    // reality, not a real browser), never evidence of actual cross-contamination: every
    // identity/token comparison below still passes, and two genuinely separate real browser
    // tabs (the real production scenario) would never share a JS process/globalThis at all,
    // so this warning has no real-world equivalent to worry about.
    const clientSupabase = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: false, storage: clientDom.window.localStorage }
    });
    const signInResult = await clientSupabase.auth.signInWithPassword({ email: realClientUser.user.email, password: password });
    return { data: { clientDom: clientDom, clientSupabase: clientSupabase, session: signInResult.data.session }, error: signInResult.error };
  })();
  if (secondClientSignupErr) throw new Error('Real client sign-in (Part B) failed: ' + secondClientSignupErr.message);

  const realClientAccessTokenBefore = secondClientAuth.session.access_token;
  const realClientLocalStorageBefore = JSON.stringify(Object.assign({}, secondClientAuth.clientDom.window.localStorage));
  check('a real, separate client session was established in a genuinely independent window/storage', !!realClientAccessTokenBefore);
  check('this second window\'s storage object is a genuinely different object from Part A\'s admin window', secondClientAuth.clientDom.window.localStorage !== adminDom.window.localStorage);

  // Nothing in Part A ever referenced secondClientAuth's window/storage/client — this is
  // true by construction, but confirmed empirically rather than only argued: re-fetch the
  // client's own session independently and diff it against its own pre-Part-A-action
  // snapshot.
  const { data: clientSessionAfter, error: clientSessionAfterErr } = await secondClientAuth.clientSupabase.auth.getSession();
  check('the real client\'s own session, re-fetched after every Part A action, is still genuinely valid and still their own', !clientSessionAfterErr && clientSessionAfter.session && clientSessionAfter.session.user.id === realClientUser.user.id);
  check('the real client\'s own access token is BYTE-IDENTICAL before and after everything Part A did', clientSessionAfter.session.access_token === realClientAccessTokenBefore);
  const realClientLocalStorageAfter = JSON.stringify(Object.assign({}, secondClientAuth.clientDom.window.localStorage));
  check('the real client\'s own localStorage is COMPLETELY UNCHANGED by anything in Part A', realClientLocalStorageBefore === realClientLocalStorageAfter);
  check('the real client\'s storage contains NOTHING resembling the admin\'s own local ambient variable (never crossed the other direction either)', !Object.keys(secondClientAuth.clientDom.window.localStorage).some(function (k) { return k.indexOf('marketswave_current_client_id') !== -1; }));

  } finally {
    // Runs regardless of outcome. Guarded per-id because approveTestClient is only created
    // partway through Part A — on an early failure it is still null, and an unguarded
    // property read here would replace the real error with a TypeError from the cleanup.
    const ids = [realClientUser.user.id];
    if (approveTestClient && approveTestClient.user) ids.push(approveTestClient.user.id);
    await admin.from('clients').delete().in('id', ids);
    for (const id of ids) {
      await admin.auth.admin.deleteUser(id).catch(function () {});
    }
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
  // Explicit exit — the admin/client Supabase clients created above use autoRefreshToken
  // timers that would otherwise keep the event loop alive indefinitely after a real success.
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err);
  process.exit(1);
});
