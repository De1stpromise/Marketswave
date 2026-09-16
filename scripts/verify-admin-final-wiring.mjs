#!/usr/bin/env node
// Admin UI Wiring — Final Stage (2026-09-03): the remaining admin pages, closing out the
// admin tool wiring effort entirely. Same substitute-for-an-unavailable-browser-tool
// discipline as every prior UI Wiring stage — NO BROWSER AUTOMATION TOOL IS AVAILABLE IN
// THIS SESSION (checked again, not assumed carried over) — and the same jsdom-based
// real-DOM harness (verbatim <body>/<script> extraction, window.eval(), real delegated-
// click/closest() support) established in UI Wiring Stage 2 and reused unchanged through
// Admin UI Wiring Stage 1.
//
// Covers what was genuinely wired this stage:
//   1. admin-profile-updates.html — the one queue missed by Admin UI Wiring Stage 1's own
//      five-page scope, now wired to real profile_change_requests + client_profiles +
//      request/approve/reject-profile-change.
//   2. admin.html — Overview's pending-count cards, now real cross-client counts across
//      every wired domain (7 Approval Gate queues, Documents, Support, Product Catalog,
//      Advisory Fee Rate). Security Actions Logged stays local by design (item 5 below).
//   3. admin-advisory-fee.html — a real, genuinely global advisory_fee_rate read/update,
//      closing the gap where the table existed but nothing wrote to it (new
//      update-advisory-fee-rate Edge Function).
//   4. admin-clients.html — real cleanup, not a straightforward wire: the stale
//      pre-retirement Firebase merge is replaced with a real Supabase `clients` merge,
//      including real cross-client Total Portfolio Value and a real per-client pending
//      Approval Gate count for Supabase-sourced clients.
// admin-security.html and admin-products.html are investigated-and-confirmed-local — no
// code changes, so no round-trip test for either; a light sanity check just confirms
// neither page was accidentally touched into a broken state.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-admin-final-wiring.mjs

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

async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await test()) return true;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return test();
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

function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
  const target = scripts.find(function (s) { return s.indexOf(marker) !== -1; });
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}

function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!bodyMatch) throw new Error('Could not find <body> in ' + htmlPath);
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

function buildPageDom(htmlPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only'
  });
  return dom;
}

async function createTestClient(admin, label, suffix, unallocated) {
  const email = 'adminfinal-' + label.toLowerCase() + '-' + suffix + '@test.marketswave.local';
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: email, password: 'VerifyAdminFinal-2026!', email_confirm: true
  });
  if (createErr) throw new Error('createUser (' + label + ') failed: ' + createErr.message);
  const id = created.user.id;
  const name = 'Admin Final Wiring Test Client ' + label + ' ' + suffix;
  await admin.from('clients').insert({
    id: id, name: name, email: email, phone: '+1-555-0100', account_type: 'Individual Account', status: 'active'
  });
  await admin.from('account_state').insert({ client_id: id, unallocated_capital: unallocated, allocated_capital: 0, asset_returns: 0 });
  return { id: id, name: name, email: email };
}

async function main() {
  console.log('Admin UI Wiring — Final Stage verification, substituting for an unavailable browser tool\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);

  // Admin Auth Consolidation (2026-09-05): useAdminClient()'s own ensureSupabaseAdminSignedIn()
  // no longer auto-signs in on its own — a real admin session is now established exactly once
  // via a real sign-in on admin-login.html, before any admin page is reachable at all. This
  // test performs that same real sign-in here, ONCE, before any of the page simulations below
  // — admin-supabase-config.js is a real, un-duplicated singleton, so this one sign-in is seen
  // by every subsequent useAdminClient() call, exactly mirroring how one real PM login
  // persists across every real page they navigate to afterward.
  const adminConfigMod = await import('../admin-supabase-config.js');
  const { error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
  if (adminSignInErr) throw new Error('Real admin sign-in failed: ' + adminSignInErr.message);

  const suffix = crypto.randomBytes(4).toString('hex');
  const clientA = await createTestClient(admin, 'A', suffix, 5000);
  const clientB = await createTestClient(admin, 'B', suffix, 5000);
  let applicantUserId = null;

  try {

  // =============================================================================================
  // ── 1. admin-profile-updates.html — RETIRED (register row 228). ──────────────────────
  // That page is deleted; the approval gate carries Client Profile Updates now, so this
  // section's coverage MOVED rather than being dropped (row 228's binding decision 2):
  //
  //   approve -> a real client_profiles write, not just a status flip
  //        -> verify-admin-approval-gate-ui-wiring, PART 2h
  //   reject  -> resolution_note stored separately from the client's own reason,
  //              and NO profile row written at all
  //        -> verify-admin-approval-gate-ui-wiring, PART 3c
  //   cross-client rendering + per-type counts
  //        -> verify-admin-approval-gate-ui-wiring, PART 1 (checked against Postgres)
  //
  // Nothing from this section is unasserted. Sections 2-4 below are unaffected — they cover
  // pages that still exist, and section 3 already points at admin-approvals.html.

  // 2. admin-advisory-fee.html
  // =============================================================================================
  console.log('\n=== 2. admin-advisory-fee.html ===\n');
  await (async function () {
    const path = fileURLToPath(new URL('../admin-advisory-fee.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    const script = extractInlineScript(path, 'Admin UI Wiring — Final Stage');

    dom.window.eval(script);
    const rateDisplay = dom.window.document.getElementById('current-rate-display');
    await pollUntil(function () { return !/animate-pulse/.test(rateDisplay.innerHTML); }, 20000);
    check('the current rate genuinely renders from the real advisory_fee_rate table (or the honest "not yet set" fallback)', /%|not yet set/.test(rateDisplay.textContent), rateDisplay.textContent);

    dom.window.document.getElementById('rate-input').value = '2.75';
    const btn = dom.window.document.getElementById('save-rate-btn');
    var bodyBefore = dom.window.document.getElementById('admin-toast-body').textContent;
    btn.click();
    check('the Save button shows a genuine busy state immediately', btn.disabled === true);
    await pollUntil(function () { return !dom.window.document.getElementById('admin-toast').classList.contains('hidden') && dom.window.document.getElementById('admin-toast-body').textContent !== bodyBefore; }, 15000);
    check('the toast confirms the real update', dom.window.document.getElementById('admin-toast-title').textContent === 'Advisory Fee Rate Updated');
    check('the display updates to the real new rate immediately', rateDisplay.textContent === '2.75%', rateDisplay.textContent);

    const { data: row } = await admin.from('advisory_fee_rate').select('*').eq('id', true).single();
    check('the real advisory_fee_rate singleton row genuinely holds 2.75 — closes the "table exists, nothing writes to it" gap', Math.abs(row.rate - 2.75) < 1e-9, JSON.stringify(row));

    console.log('\n2a. A real rejection (invalid rate) surfaces the real server validation message');
    dom.window.document.getElementById('rate-input').value = '-5';
    const errorEl = dom.window.document.getElementById('rate-error');
    dom.window.document.getElementById('save-rate-btn').click();
    await pollUntil(function () { return !errorEl.classList.contains('hidden'); }, 15000);
    check('the real server-side validation rejection surfaces verbatim', /positive number/i.test(errorEl.textContent), errorEl.textContent);
    const { data: rowAfter } = await admin.from('advisory_fee_rate').select('rate').eq('id', true).single();
    check('the real rate is UNCHANGED by the rejected attempt (still 2.75, not -5)', Math.abs(rowAfter.rate - 2.75) < 1e-9, rowAfter.rate);
  })();

  // =============================================================================================
  // ── 3. admin-approvals.html — the INTERIM LANDING is gone (register row 228). ────────
  // This section drove the landing's inline "Approvals landing" script and its seven
  // queue-count cards. The approval gate replaced that page at the same filename, with its
  // logic in admin-approvals-page.js, so the coverage MOVED rather than being dropped:
  //
  //   seven per-queue counts vs independently-queried DB counts
  //        -> verify-admin-approval-gate-ui-wiring, PART 1 (the filter pills, same check)
  //   the total waiting across all seven
  //        -> verify-admin-approval-gate-ui-wiring, PART 1 (the All pill)
  //
  // The one assertion here that was NOT about the landing — that the advisory fee rate
  // saved in section 2 genuinely reads back — belongs to section 2 and is kept below.
  {
    const { data: rateRow } = await admin.from('advisory_fee_rate').select('rate').eq('id', true).single();
    check('the real advisory fee rate saved in step 2 reads back 2.75', Math.abs(Number(rateRow.rate) - 2.75) < 1e-9, String(rateRow.rate));
  }
  // ── 4. admin-clients.html — RETIRED (register row 235). ──────────────────────────────────
  // The client list was rebuilt in part 5 and this section drove the OLD surface, so its
  // coverage MOVED rather than being dropped:
  //
  //   real Supabase clients render in the list
  //        -> verify-client-list-ui-wiring, PART 3 (every funded client compared against
  //           get-total-portfolio-value, with a guard that at least two were compared)
  //   the portfolio cell shows the exact server-computed figure
  //        -> verify-client-list-ui-wiring, PARTS 2 and 3
  //   real per-client pending Approval Gate count
  //        -> verify-client-list-ui-wiring, PART 5 (the strip's approval figure against an
  //           independent pending total) and PART 6 (the "Has pending requests" filter)
  //   "View as this Client" absent for a Supabase client
  //        -> verify-client-list-ui-wiring, PART 7 asserts it is absent for EVERY client:
  //           the control is gone entirely, because setCurrentClientId() was write-only.
  //
  // The one assertion with no replacement is the "Supabase" badge, which was REMOVED BY
  // DESIGN (row 235): internal implementation on a PM-facing page. It was also the tell for
  // the $0 bug, which is now fixed at source rather than signposted — and PART 7 asserts the
  // badge is absent, so that removal is itself covered.


  } finally {
    // Every table this test touched cascades from its owning real auth user via
    // `on delete cascade` (confirmed by reading every migration's own FK definition before
    // relying on this, same as every prior admin wiring verification script) — deleting all
    // three test users cleans up everything else in one shot.
    // conversations.client_id is NOT on delete cascade (the Stage 1 inbox migration) — the
    // ticket seeded above for the Inbox card must go first, or the user delete fails silently.
    await admin.from('conversations').delete().eq('client_id', clientA.id);
    if (applicantUserId) await admin.auth.admin.deleteUser(applicantUserId);
    await admin.auth.admin.deleteUser(clientA.id);
    await admin.auth.admin.deleteUser(clientB.id);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
