#!/usr/bin/env node
// Backend Migration Phase C — Stage 3 (2026-09-06, final stage of Phase C): self-service
// password change for a PM's own account.
//
// INVESTIGATED FIRST, per instruction: read the real current admin-security.html and every
// other admin page for any existing PM self-service credential path — confirmed none exists
// (a project-wide grep for updateUser()/"My Account"/"Change Password" in any admin*.html
// file found nothing beyond a stale comment reference to the unrelated CLIENT-facing flow in
// admin-clients.html). The gap was real, not assumed.
//
// 2FA, investigated and reported (not built as a stub): supabase/config.toml's own comment
// states "Multi-factor-authentication is available to Supabase Pro plan" — confirmed live
// against the real local Auth server too, a real auth.mfa.enroll({factorType:'totp'}) call
// returns a real 422 `mfa_totp_enroll_not_enabled`. This project has deliberately stayed on
// Supabase's free tier throughout its migration (the same category of real constraint that
// blocked Firebase's own Cloud Functions on the Blaze plan). Genuine PM 2FA is therefore
// logged as its own deferred item, not tested here — there is nothing built to test.
//
// LOCAL STACK ONLY. Standing convention: Node/API-level (jsdom-DOM-level) verification only,
// no browser automation, per CLAUDE.md.
//
// Usage:  node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-pm-self-service-security.mjs

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

async function bootstrapPm(admin, url, anonKey, email, password) {
  const { data: listData } = await admin.auth.admin.listUsers();
  let user = listData.users.find(function (u) { return u.email === email; });
  if (!user) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email: email, password: password, email_confirm: true });
    if (createErr) throw new Error('createUser(' + email + ') failed: ' + createErr.message);
    user = created.user;
  }
  await admin.from('user_roles').upsert({ user_id: user.id, is_admin: true }, { onConflict: 'user_id' });
  return user;
}

async function main() {
  console.log('Backend Migration Phase C — Stage 3 verification (PM self-service password change)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');

  // Two genuinely different real PM accounts — this must work for any real PM, not just the
  // original shared one (Stage 1's own point).
  const pm1Email = 'selfservice-pm1-' + suffix + '@test.marketswave.local';
  const pm1OldPassword = 'OldPassword2026!A';
  const pm1NewPassword = 'NewPassword2026!AAA';
  const pm2Email = 'selfservice-pm2-' + suffix + '@test.marketswave.local';
  const pm2OldPassword = 'OldPassword2026!B';
  const pm2NewPassword = 'NewPassword2026!BBB';

  const pm1User = await bootstrapPm(admin, url, anonKey, pm1Email, pm1OldPassword);
  const pm2User = await bootstrapPm(admin, url, anonKey, pm2Email, pm2OldPassword);
  check('two genuinely different real PM accounts were bootstrapped', pm1User.id !== pm2User.id);

  const engineCoreSource = readFileSync(fileURLToPath(new URL('../engine-core.js', import.meta.url)), 'utf8');
  const path = fileURLToPath(new URL('../admin-security.html', import.meta.url));
  const script = extractInlineScript(path, 'Backend Migration Phase C — Stage 3');
  const bodyMarkup = extractBodyMarkup(path);

  // ONE real jsdom window, reused across BOTH PMs' flows — engine-core.js's
  // SECURITY_LOG_KEY is a genuinely global localStorage key (not scoped per-PM-session), the
  // same way a real admin's browser tab would carry it forward across a real PM-to-PM
  // hand-off (sign out, a different PM signs in) without ever navigating away from the page
  // or clearing storage. A first draft of this test built a FRESH JSDOM per PM call — a real
  // bug caught before it could produce a false "PM #2's entry is missing" failure: a fresh
  // JSDOM means fresh, empty localStorage, so PM #1's own log write would never be visible
  // from PM #2's separate window, even though nothing was actually wrong with the app.
  const sharedDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });

  // supabase-data.js is imported exactly ONCE, outside the per-PM function — a real bug
  // caught while first running this test: Node's ESM module cache means a second
  // import('../supabase-data.js') call does NOT re-execute the module body, so its own
  // `window.MarketswaveData = {...}` side effect only ever applies to whichever `window`
  // object happened to be globalThis.window the FIRST time it ran. Creating a fresh
  // globalThis.window per PM call (as an earlier draft did) left the second call's window
  // with no MarketswaveData at all. One shared MarketswaveData object, reused across both
  // PM turns, mirrors how a real single page load keeps exactly one such global for its own
  // lifetime regardless of which PM later signs in via useAdminClient().
  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;

  async function runChangePasswordFlow(pmEmail, pmOldPassword, pmNewPassword, pmUserId, wrongCurrentFirst) {
    // A real sign-in as THIS PM, via the EXACT SAME bare specifier useAdminClient() will
    // itself import internally — admin-supabase-config.js is deliberately a real,
    // un-duplicated singleton within one process (the same established precedent as every
    // other "genuinely separate PM/client contexts" script in this project), so signing in
    // here via a query-param-suffixed copy (a real bug caught while writing this test) would
    // leave the REAL singleton useAdminClient() resolves to still unauthenticated. Sequential
    // PM turns on the one real singleton correctly mirror "PM 1 signs out, PM 2 signs in" —
    // exactly what this test needs, since the two PMs' flows never need to coexist.
    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: signInErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: pmEmail, password: pmOldPassword });
    if (signInErr) throw new Error('Real PM sign-in failed for ' + pmEmail + ': ' + signInErr.message);
    MarketswaveData.useAdminClient();

    // Reset the shared window's body to a fresh copy of the real page markup (simulating a
    // real page reload) while its real localStorage/sessionStorage carry forward untouched —
    // exactly what a real browser tab does across a real navigation.
    const dom = sharedDom;
    dom.window.document.body.innerHTML = bodyMarkup;
    dom.window.eval(engineCoreSource);
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.eval(script);

    await pollUntil(function () { return dom.window.document.getElementById('my-account-email').textContent !== '—'; }, 10000);
    check(pmEmail + ': the real signed-in PM\'s own email renders in "Signed in as"', dom.window.document.getElementById('my-account-email').textContent === pmEmail, dom.window.document.getElementById('my-account-email').textContent);

    const currentInput = dom.window.document.getElementById('current-password');
    const newInput = dom.window.document.getElementById('new-password');
    const confirmInput = dom.window.document.getElementById('confirm-password');
    const errorEl = dom.window.document.getElementById('password-error');
    const submitBtn = dom.window.document.getElementById('password-submit');

    if (wrongCurrentFirst) {
      currentInput.value = 'definitely-the-wrong-password';
      newInput.value = pmNewPassword;
      confirmInput.value = pmNewPassword;
      submitBtn.click();
      await pollUntil(function () { return !errorEl.classList.contains('hidden'); }, 10000);
      check(pmEmail + ': a wrong current password is genuinely rejected', !errorEl.classList.contains('hidden') && /incorrect/i.test(errorEl.textContent), errorEl.textContent);

      // Confirm the real password was NOT changed by the rejected attempt.
      const stillOldClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: stillOldErr } = await stillOldClient.auth.signInWithPassword({ email: pmEmail, password: pmOldPassword });
      check(pmEmail + ': the real password is genuinely UNCHANGED after the rejected attempt (still signs in with the OLD password)', !stillOldErr, stillOldErr && stillOldErr.message);
    }

    currentInput.value = pmOldPassword;
    newInput.value = pmNewPassword;
    confirmInput.value = pmNewPassword;
    submitBtn.click();

    const toast = dom.window.document.getElementById('admin-toast');
    await pollUntil(function () { return !toast.classList.contains('hidden'); }, 10000);
    check(pmEmail + ': the real password change succeeds (toast confirms)', !toast.classList.contains('hidden') && /Password Updated/.test(dom.window.document.getElementById('admin-toast-title').textContent));

    // THE REAL PROOF, per instruction — not just a success message: sign in with the NEW
    // password, in a genuinely separate, fresh client instance.
    const freshClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: freshSignIn, error: freshErr } = await freshClient.auth.signInWithPassword({ email: pmEmail, password: pmNewPassword });
    check(pmEmail + ': signing in with the NEW real password succeeds, in a genuinely fresh client instance, and resolves to the correct real PM', !freshErr && freshSignIn.user.id === pmUserId, JSON.stringify({ error: freshErr && freshErr.message, gotId: freshSignIn && freshSignIn.user && freshSignIn.user.id, expectedId: pmUserId }));

    const oldPasswordClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: oldPasswordErr } = await oldPasswordClient.auth.signInWithPassword({ email: pmEmail, password: pmOldPassword });
    check(pmEmail + ': the OLD password no longer works after the real change', !!oldPasswordErr);

    // Real attribution: the log entry's performedBy is this PM's own real email, never a
    // generic/fabricated value, never the other PM's.
    const log = dom.window.getSecurityActionsLog();
    const myEntry = log.find(function (e) { return e.type === 'PM_PASSWORD_CHANGE' && e.performedBy === pmEmail; });
    check(pmEmail + ': a real PM_PASSWORD_CHANGE log entry exists with this exact PM\'s own real email as performedBy', !!myEntry, JSON.stringify(log));
    check(pmEmail + ': the log entry correctly has no clientId/clientName (a self-action, not a client action)', myEntry && myEntry.clientId === null && myEntry.clientName === null, myEntry && JSON.stringify(myEntry));

    return { dom: dom, log: log };
  }

  console.log('1. PM #1 — wrong current password rejected, then a real successful change\n');
  const result1 = await runChangePasswordFlow(pm1Email, pm1OldPassword, pm1NewPassword, pm1User.id, true);

  console.log('\n2. PM #2 — a genuinely different real PM account, same flow, no wrong-password step this time\n');
  const result2 = await runChangePasswordFlow(pm2Email, pm2OldPassword, pm2NewPassword, pm2User.id, false);

  console.log('\n3. Cross-PM attribution check — the two log entries are genuinely distinguishable\n');
  const combinedLog = result2.dom.window.getSecurityActionsLog();
  const entry1 = combinedLog.find(function (e) { return e.type === 'PM_PASSWORD_CHANGE' && e.performedBy === pm1Email; });
  const entry2 = combinedLog.find(function (e) { return e.type === 'PM_PASSWORD_CHANGE' && e.performedBy === pm2Email; });
  check('both PMs\' own self-change log entries are present and genuinely distinct', !!entry1 && !!entry2 && entry1.performedBy !== entry2.performedBy, JSON.stringify({ entry1: entry1, entry2: entry2 }));

  console.log('\n4. 2FA — confirmed genuinely deferred, not silently built as a stub\n');
  const html = readFileSync(path, 'utf8');
  check('the real page shows an honest "not available yet" note for 2FA, not a fake toggle', /Not available yet for Portfolio Manager accounts/.test(html));
  check('no interactive 2FA control (button/toggle/input) exists in the real markup', !/id="(2fa|mfa)[-\w]*"/i.test(html));

  // Cleanup
  await admin.auth.admin.deleteUser(pm1User.id);
  await admin.auth.admin.deleteUser(pm2User.id);

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err);
  process.exit(1);
});
