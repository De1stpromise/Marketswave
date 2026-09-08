#!/usr/bin/env node
// Client-Facing Password Reset flow (2026-09-07). Verifies the REAL, unmodified production
// files — login.html's "Forgot Password" panel and the new reset-password.html — against the
// real local Supabase stack and its real Mailpit email capture, not a reimplementation of
// either page's logic.
//
// NO BROWSER AUTOMATION TOOL IS AVAILABLE IN THIS SESSION (checked directly, not assumed).
// Uses real jsdom (this project's own established devDependency for pages needing real DOM
// interaction — querySelectorAll/classList/form-submit events) PLUS the "extract the real
// <script type="module"> content, write it to a temp .mjs file, dynamic-import it with
// globalThis.window/document already pointed at a real jsdom window" technique
// verify-admin-real-login.mjs already established for a page in this exact same
// type="module"-with-real-import situation. jsdom's own real Location/History implementation
// means the SDK's internal window.location.href / window.history.replaceState calls
// (confirmed by reading the installed @supabase/auth-js source directly, not assumed) work
// against a REAL URL object, not a hand-built stand-in.
//
// Two seams substituted, disclosed plainly: supabase-config.js's own https://esm.sh CDN
// import is redirected to the local npm package, and login.html's own still-statically-
// present RETIRED Firebase imports (harmless in a real browser — never actually called
// unless IS_SUPABASE_BACKEND is false, which it never is here — but Node's static import
// resolution still needs every specifier to resolve to something) are redirected to inert
// stubs — see lib/esm-loader-reset-flow-test.mjs's own header for the full "why" on both.
// Every other line of login.html/reset-password.html/supabase-config.js runs completely
// unmodified.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-reset-flow-test.mjs verify-password-reset-flow.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(test, maxMs) {
  const start = Date.now();
  for (;;) {
    const result = await test();
    if (result) return result;
    if (Date.now() - start > maxMs) return result;
    await sleep(100);
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

function extractModuleScript(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No <script type="module"> found in ' + htmlPath);
  return m[1];
}

function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  if (!m) throw new Error('No <body> found in ' + htmlPath);
  // Strip the module script from the body markup — it's imported separately as a real .mjs
  // file below, not left inline (jsdom's own <script type="module"> execution support is
  // inconsistent, the same reason verify-admin-real-login.mjs uses this exact technique).
  return m[1].replace(/<script type="module">[\s\S]*?<\/script>/, '');
}

async function loadPage(htmlPath, url, supabaseConfigTempPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: url,
    pretendToBeVisual: true
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;

  const moduleCode = extractModuleScript(htmlPath);
  const tempDir = mkdtempSync(path.join(tmpdir(), 'ms-reset-flow-test-'));
  writeFileSync(path.join(tempDir, 'supabase-config.js'), readFileSync(supabaseConfigTempPath, 'utf8'));
  // supabase-endpoint.js (homepage design round 2, 2026-09-08) holds the environment
  // resolution and both project configs, which supabase-config.js now imports and
  // re-exports. It has to come along or the temp copy cannot resolve its own import.
  writeFileSync(path.join(tempDir, 'supabase-endpoint.js'),
                readFileSync(path.join(PROJECT_ROOT, 'supabase-endpoint.js'), 'utf8'));
  const modulePath = path.join(tempDir, 'page-script-' + crypto.randomBytes(4).toString('hex') + '.mjs');
  writeFileSync(modulePath, moduleCode);
  await import('file://' + modulePath.replace(/\\/g, '/'));
  return { dom, tempDir };
}

function cleanupTempDir(tempDir) {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch (_e) {}
}

async function fetchMailpitLinkFor(recipientEmail, sinceMs) {
  const list = await (await fetch('http://127.0.0.1:54324/api/v1/messages?limit=20')).json();
  const msg = (list.messages || []).find(function (m) {
    return m.To && m.To.some(function (t) { return t.Address === recipientEmail; }) &&
      new Date(m.Created).getTime() >= sinceMs;
  });
  if (!msg) return null;
  const full = await (await fetch('http://127.0.0.1:54324/api/v1/message/' + msg.ID)).json();
  const linkMatch = (full.HTML || full.Text || '').match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^"\s)]+/);
  // The HTML body's href attribute has its "&" HTML-entity-encoded as "&amp;" (real HTML,
  // correctly rendered by any real browser/mail client's own HTML parser — but this script
  // pulls the raw source text via regex, not a real DOM parser, so it must decode this one
  // real entity itself before treating the result as a literal query string).
  return linkMatch ? linkMatch[0].replace(/&amp;/g, '&') : null;
}

async function resolveRedirectLocation(verifyUrl) {
  const res = await fetch(verifyUrl, { redirect: 'manual' });
  const loc = res.headers.get('location');
  if (!loc) {
    const body = await res.text().catch(() => '<unreadable>');
    throw new Error('verify link did not produce a redirect Location header (status ' + res.status + ', url=' + verifyUrl + ', body=' + body + ')');
  }
  return loc;
}

async function main() {
  console.log('Client-Facing Password Reset flow verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // A real, unmodified temp copy of supabase-config.js — reused as-is by every page load
  // below (each gets its own fresh copy alongside its own module script file, matching
  // verify-admin-real-login.mjs's "genuinely fresh instance per simulated page load"
  // discipline for the module-cache side, while sharing nothing else).
  const supabaseConfigSrc = readFileSync(path.join(PROJECT_ROOT, 'supabase-config.js'), 'utf8');
  const supabaseConfigTemp = path.join(mkdtempSync(path.join(tmpdir(), 'ms-reset-flow-cfg-')), 'supabase-config.js');
  writeFileSync(supabaseConfigTemp, supabaseConfigSrc);

  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'reset-flow-verify-' + suffix + '@example.com';
  const oldPassword = 'OldRealPassword2026!';
  const newPassword = 'BrandNewRealPassword2026!';

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true });
  if (createErr) throw new Error('creating test client failed: ' + createErr.message);
  await admin.from('clients').insert({ id: created.user.id, name: 'Reset Flow Verify Client', email, phone: '+1-555-0910', account_type: 'Individual Account', status: 'active' });
  console.log('Test client ready: ' + created.user.id + ' (' + email + ')\n');

  let allTempDirs = [];

  try {
    // =========================================================================================
    // PART 1 — login.html's real "Forgot Password" panel: real resetPasswordForEmail() call
    // =========================================================================================
    console.log('--- Part 1: login.html real Send Reset Link flow ---\n');
    {
      const since = Date.now();
      const { dom, tempDir } = await loadPage(path.join(PROJECT_ROOT, 'login.html'), 'http://127.0.0.1:8765/login.html', supabaseConfigTemp);
      allTempDirs.push(tempDir);
      const doc = dom.window.document;

      doc.getElementById('forgot-password-link').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
      check('clicking "Forgot password?" shows the forgot panel, hides the login card', doc.getElementById('forgot-panel').style.display === 'block' && doc.getElementById('login-form').closest('.login-card').style.display === 'none');
      check('forgot panel starts on step 1 (Enter Email)', doc.querySelector('[data-forgot-step="1"]').classList.contains('is-active'));

      doc.getElementById('reset-email').value = email;
      doc.getElementById('btn-send-reset').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));

      const advanced = await waitFor(function () {
        return doc.querySelector('[data-forgot-step="2"]').classList.contains('is-active');
      }, 8000);
      check('after Send Reset Link, the panel genuinely advances to step 2 (Check Your Email)', !!advanced);

      const mailpitLink = await waitFor(function () { return fetchMailpitLinkFor(email, since); }, 5000);
      check('a real password-reset email was genuinely captured in Mailpit for this exact address', !!mailpitLink, mailpitLink);
      if (mailpitLink) {
        check('the real captured email\'s verify link carries the real, correct redirect_to (reset-password.html, not the homepage)', mailpitLink.includes('redirect_to=http://127.0.0.1:8765/reset-password.html'), mailpitLink);
      }

      // Real security-conscious behavior check: an unknown email must produce the IDENTICAL
      // step-2 confirmation, never a distinguishing error (email-enumeration avoidance).
      dom.window.document.getElementById('back-to-login-2').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
      doc.getElementById('reset-email').value = 'definitely-not-a-real-account-' + suffix + '@example.com';
      doc.getElementById('btn-send-reset').dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
      const advancedUnknown = await waitFor(function () {
        return doc.querySelector('[data-forgot-step="2"]').classList.contains('is-active');
      }, 8000);
      check('an UNKNOWN email produces the identical step-2 confirmation (no email-enumeration signal)', !!advancedUnknown);
    }

    // =========================================================================================
    // PART 2 — reset-password.html: the real happy path, catching a real recovery link
    // =========================================================================================
    console.log('\n--- Part 2: reset-password.html real recovery + set-new-password flow ---\n');
    {
      // Real GoTrue rate limiting (config.toml's own auth.email.max_frequency = "1s") refuses
      // a second resetPasswordForEmail() for the SAME address within that window — a genuine
      // security control, not a bug; Part 1 above already requested one for this email.
      await sleep(1500);
      const since = Date.now();
      const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: reqErr } = await anon.auth.resetPasswordForEmail(email, { redirectTo: 'http://127.0.0.1:8765/reset-password.html' });
      if (reqErr) throw new Error('resetPasswordForEmail (Part 2) failed: ' + reqErr.message);

      const verifyLink = await waitFor(function () { return fetchMailpitLinkFor(email, since); }, 5000);
      check('a fresh real reset email was captured for the happy-path test', !!verifyLink, verifyLink);

      const finalUrl = await resolveRedirectLocation(verifyLink);
      check('the real verify link redirects to reset-password.html with a real #access_token fragment', finalUrl.startsWith('http://127.0.0.1:8765/reset-password.html#') && finalUrl.includes('access_token=') && finalUrl.includes('type=recovery'), finalUrl.slice(0, 80) + '...');

      const { dom, tempDir } = await loadPage(path.join(PROJECT_ROOT, 'reset-password.html'), finalUrl, supabaseConfigTemp);
      allTempDirs.push(tempDir);
      const doc = dom.window.document;

      check('reset-password.html starts on the "checking" step', doc.querySelector('[data-reset-step="checking"]').classList.contains('is-active'));

      const reachedForm = await waitFor(function () {
        return doc.querySelector('[data-reset-step="form"]').classList.contains('is-active');
      }, 6000);
      check('a REAL PASSWORD_RECOVERY event fires and the page genuinely advances to the Set New Password form', !!reachedForm);

      doc.getElementById('new-password').value = newPassword;
      doc.getElementById('confirm-new-password').value = newPassword;
      const form = doc.getElementById('reset-form');
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

      const reachedSuccess = await waitFor(function () {
        return doc.querySelector('[data-reset-step="success"]').classList.contains('is-active');
      }, 8000);
      check('after submitting, the page genuinely reaches the real success step', !!reachedSuccess);

      // The real, conclusive proof: sign in with a BRAND NEW client instance using the NEW
      // password — not just "the call didn't error."
      const freshClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: newPassErr } = await freshClient.auth.signInWithPassword({ email, password: newPassword });
      check('a genuinely fresh sign-in with the NEW password succeeds', !newPassErr, newPassErr && newPassErr.message);
      await freshClient.auth.signOut().catch(() => {});

      const oldPassClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: oldPassErr } = await oldPassClient.auth.signInWithPassword({ email, password: oldPassword });
      check('the OLD password no longer works', !!oldPassErr);

      // Real notify-password-changed proof, via email_log (this one DOES route through
      // sendEmail()/renderEmail(), unlike Supabase's own native recovery mailer above).
      // reset-password.html deliberately fires this best-effort/non-blocking (its own success
      // state must never wait on it) — so polled here rather than checked immediately, the
      // same real "fire-and-forget vs. an immediate synchronous check" race this project has
      // hit before with other best-effort notify calls, not a page bug.
      const logRows = await waitFor(async function () {
        const { data } = await admin.from('email_log').select('*').eq('recipient', email).eq('subject', 'Your Marketswave password was changed').gte('sent_at', new Date(since - 2000).toISOString());
        return data && data.length >= 1 ? data : null;
      }, 5000);
      check('a real notify-password-changed email was logged for this real reset', !!logRows, JSON.stringify(logRows));
    }

    // =========================================================================================
    // PART 3 — reset-password.html: a link with NO recovery token at all
    // =========================================================================================
    console.log('\n--- Part 3: reset-password.html with no recovery token (direct navigation) ---\n');
    {
      const { dom, tempDir } = await loadPage(path.join(PROJECT_ROOT, 'reset-password.html'), 'http://127.0.0.1:8765/reset-password.html', supabaseConfigTemp);
      allTempDirs.push(tempDir);
      const doc = dom.window.document;

      const reachedInvalid = await waitFor(function () {
        return doc.querySelector('[data-reset-step="invalid"]').classList.contains('is-active');
      }, 6000);
      check('with no recovery token present at all, the page honestly shows the invalid/expired state (not a stuck spinner, not a fake form)', !!reachedInvalid);
    }

    // =========================================================================================
    // PART 4 — a REUSED (already-consumed) recovery link is genuinely rejected
    // =========================================================================================
    console.log('\n--- Part 4: a real, already-consumed recovery link ---\n');
    {
      await sleep(1500); // same real rate-limit consideration as Part 2 — see its own comment.
      const since = Date.now();
      const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: reqErr } = await anon.auth.resetPasswordForEmail(email, { redirectTo: 'http://127.0.0.1:8765/reset-password.html' });
      if (reqErr) throw new Error('resetPasswordForEmail (Part 4) failed: ' + reqErr.message);
      const verifyLink = await waitFor(function () { return fetchMailpitLinkFor(email, since); }, 5000);

      // Consume it once for real (a genuine first use).
      await resolveRedirectLocation(verifyLink);
      // A second real HTTP hit against the SAME single-use verify token.
      const res2 = await fetch(verifyLink, { redirect: 'manual' });
      const loc2 = res2.headers.get('location') || '';
      check('the SAME recovery token, used a second time, is genuinely refused by the real server (no fresh access_token issued)', !loc2.includes('access_token='), 'status ' + res2.status + ', location: ' + loc2);
    }
  } finally {
    for (const dir of allTempDirs) cleanupTempDir(dir);
    cleanupTempDir(path.dirname(supabaseConfigTemp));
    await admin.from('clients').delete().eq('id', created.user.id);
    await admin.auth.admin.deleteUser(created.user.id);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
  // No explicit process.exit(0) here — runVerifyMain() below does that once main() resolves.
  // See lib/run-verify.mjs's own header for the full "why" (this script's own real hang,
  // caught and killed mid-session, is the second confirmed case that motivated writing it as
  // a shared wrapper rather than hand-rolling this exact watchdog+exit pattern a third time).
}

runVerifyMain(main);
