// ★ PM tool revamp, part 8 — Account security, driven through its REAL script (register row 238).
//
// ★ THE PAGE'S OWN SCRIPT RUNS HERE, UNMODIFIED — admin-security.html's <body> is extracted
// verbatim, its <script> tags stripped, and admin-security-page.js evaluated into the window.
// Nothing is re-implemented, so an assertion that passes is the real page.
//
// ★ NAV IS ASSERTED (row 228). The approval gate shipped with no rail, no active item and no
// Log out, and a 69-assertion suite missed it because every assertion looked at the feature and
// none at the chrome. The rendered proof is the visual suite's job — admin-sidebar.js gates its
// render on a real getSession() jsdom cannot satisfy — so this half asserts the call exists.
//
// ★ AND IT ASSERTS WHAT WAS NOT REMOVED. The brief described this page as "a change-password
// form and nothing else"; it also carried the client Security Actions Log, and that log is the
// ONLY reader of getSecurityActionsLog() anywhere in the project. Parts 5, 6 and 7 each nearly
// orphaned something by rebuilding a page without first asking what it already did, so the log
// is driven here rather than merely present in the markup.
//
// ★ A DEDICATED THROWAWAY PM, NOT pm@marketswave.local — and that is not tidiness. This suite
// ends sessions, including a "sign out everywhere else". Run against the shared bootstrap PM it
// would kill the session of any other suite running concurrently: the same cross-fixture
// collision class as row 212, on sessions rather than on symbols. Its own PM is created here,
// used for everything, and deleted in the finally.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = path.join(ROOT, 'admin-security.html');
const PAGE_JS = path.join(ROOT, 'admin-security-page.js');
const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'AccSecUI-2026!aA';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(fn, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { try { if (fn()) return true; } catch (_e) { /* not ready */ } await sleep(120); }
  try { return !!fn(); } catch (_e) { return false; }
}
const vc = new VirtualConsole();

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

const fresh = (url, anonKey) => createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

function buildDom(MarketswaveData) {
  const html = readFileSync(PAGE, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    url: 'http://127.0.0.1:8765/admin-security.html', runScripts: 'outside-only',
    virtualConsole: vc, pretendToBeVisual: true
  });
  dom.window.MarketswaveData = MarketswaveData;
  // engine-core.js backs the client security-actions log, which is genuinely local — no real
  // Supabase table or function exists for it anywhere (confirmed by a project-wide grep in the
  // Admin UI Wiring Final Stage, and re-confirmed for part 8). Wiring a fake one would be worse.
  dom.window.eval(readFileSync(path.join(ROOT, 'engine-core.js'), 'utf8'));
  dom.window.eval(readFileSync(PAGE_JS, 'utf8'));
  return dom;
}

const q = (dom, sel) => dom.window.document.querySelector(sel);
const all = (dom, sel) => [...dom.window.document.querySelectorAll(sel)];
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const sessionRows = (dom) => all(dom, '.sec-row[data-sec-session]');
const ready = (dom) => pollUntil(() => sessionRows(dom).length > 0);

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  globalThis.document = { addEventListener() {} };
  await import('../supabase-data.js');
  const D = globalThis.window.MarketswaveData;
  const cfg = await import('../admin-supabase-config.js');

  const pmEmail = 'accsec-ui-' + SUF + '@test.marketswave.local';
  const created = [];
  let dom = null;

  try {
    const { data: madePm, error: makeErr } = await admin.auth.admin.createUser({
      email: pmEmail, password: PASSWORD, email_confirm: true
    });
    if (makeErr) throw new Error('could not create the throwaway PM: ' + makeErr.message);
    created.push(madePm.user.id);
    const { error: roleErr } = await admin.from('user_roles').upsert({ user_id: madePm.user.id, is_admin: true });
    if (roleErr) throw new Error('could not grant admin: ' + roleErr.message);

    const { error: pmErr } = await cfg.supabase.auth.signInWithPassword({ email: pmEmail, password: PASSWORD });
    check('a real admin session is established for this suite\'s own throwaway PM', !pmErr, pmErr && pmErr.message);
    D.useAdminClient();

    console.log('\n1. The chrome — what a 69-assertion suite once missed\n');

    const html = readFileSync(PAGE, 'utf8');
    check('★ the page mounts the shared admin nav', /initAdminSidebar\(\s*['"]security['"]\s*\)/.test(html));
    check('the page links its own stylesheet', /admin-security\.css/.test(html));
    check('the page loads its own external script', /admin-security-page\.js/.test(html));

    console.log('\n2. Your account, and what it says about the address\n');

    dom = buildDom(D);
    await pollUntil(() => txt(q(dom, '#sec-email')) === pmEmail, 20000);
    check('the real signed-in PM\'s own email renders', txt(q(dom, '#sec-email')) === pmEmail, txt(q(dom, '#sec-email')));
    check('the role renders read-only', txt(q(dom, '#sec-role')) === 'Portfolio Manager', txt(q(dom, '#sec-role')));
    check('★ there is NO display-name field anywhere on the page',
      !/id="[^"]*display-name/i.test(html) && all(dom, 'input[name*="name" i]').length === 0);
    const accountNote = txt(q(dom, '#sec-account-h').closest('section').querySelector('.sec-note'));
    check('★ it states plainly that clients never see this address', /Clients never see this address/i.test(accountNote), accountNote.slice(0, 120));
    check('...and names what a client replying actually reaches', /support@marketswave\.net/.test(accountNote));

    console.log('\n3. Password — the real consequence, stated\n');

    for (const id of ['current-password', 'new-password', 'confirm-password']) {
      const input = q(dom, '#' + id);
      const label = q(dom, 'label[for="' + id + '"]');
      check(id + ' exists with a real associated label', !!input && !!label && txt(label).length > 0, txt(label));
    }
    const consequence = txt(q(dom, '#sec-password-consequence'));
    check('★ the page states the real consequence — signed out everywhere else',
      /signs you out everywhere else/i.test(consequence), consequence.slice(0, 120));
    check('★ ...and the honest caveat the mechanism actually has (an already-issued token lives out its hour)',
      /hour/i.test(consequence), consequence);

    // The strength meter moves on real input, and its LABEL is a legible colour rather than
    // the bar's own saturated fill (measured: the old #F59E0B/#10B981 as text fail 4.5:1).
    const newPw = q(dom, '#new-password');
    newPw.value = 'aaaaaaaa';
    newPw.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const weak = txt(q(dom, '#strength-text'));
    newPw.value = 'Str0ng-Passw0rd!x';
    newPw.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const strong = txt(q(dom, '#strength-text'));
    check('the strength meter genuinely responds to real input', weak !== strong && /strong/i.test(strong), weak + ' -> ' + strong);
    newPw.value = '';
    newPw.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    console.log('\n4. Two-factor — an honest absence, not a dead toggle\n');

    const twofa = q(dom, '#sec-2fa-h').closest('section');
    check('the 2FA panel is marked Planned', txt(q(dom, '#sec-2fa-status')) === 'Planned', txt(q(dom, '#sec-2fa-status')));
    check('★ it carries NO interactive control at all — no toggle, no button, no input',
      twofa.querySelectorAll('button, input, select, [role="switch"], [role="button"]').length === 0);
    check('and it says why, in terms that can be checked', /mfa_totp_enroll_not_enabled/.test(txt(twofa)));

    console.log('\n5. Where you\'re signed in — real sessions\n');

    await ready(dom);
    const firstRows = sessionRows(dom);
    check('real session rows render', firstRows.length >= 1, String(firstRows.length));
    const currentRows = firstRows.filter((r) => /This device/i.test(txt(r)));
    check('exactly one row is marked "This device"', currentRows.length === 1, String(currentRows.length));
    check('★ the current row offers NO "Sign out" — ending the session you are using is Log out',
      currentRows[0] && currentRows[0].querySelectorAll('[data-sec-revoke]').length === 0);
    check('a script session is named as a script rather than left "Unknown"',
      /Node\.js script|Script/i.test(txt(firstRows[0])), txt(firstRows[0]).slice(0, 120));
    check('every row states a location, honestly "Unknown location" when there is none',
      firstRows.every((r) => /location|,/.test(txt(r))), txt(firstRows[0]));
    check('the panel explains what device and location actually are', /approximations/i.test(txt(q(dom, '#sec-sessions-note'))));

    // A second real device for this same PM.
    const deviceB = fresh(st.API_URL, st.ANON_KEY);
    const bSignIn = await deviceB.auth.signInWithPassword({ email: pmEmail, password: PASSWORD });
    if (bSignIn.error) throw new Error('device B sign-in failed: ' + bSignIn.error.message);
    const bSessionId = JSON.parse(Buffer.from(bSignIn.data.session.access_token.split('.')[1], 'base64').toString()).session_id;

    await dom.window.__secReload();
    await pollUntil(() => sessionRows(dom).length >= 2, 20000);
    const withB = sessionRows(dom);
    check('a genuinely new second device appears in the real list', withB.length >= 2, String(withB.length));
    const bRow = withB.find((r) => r.getAttribute('data-sec-session') === bSessionId);
    check('...and it is the exact session that just signed in', !!bRow);
    check('the other device DOES offer a "Sign out"', !!bRow && bRow.querySelectorAll('[data-sec-revoke]').length === 1);
    check('"Sign out everywhere else" appears once there is somewhere else', q(dom, '#sec-revoke-others').hidden === false);

    console.log('\n6. Signing a device out, through the real UI\n');

    const bRefreshToken = bSignIn.data.session.refresh_token;
    bRow.querySelector('[data-sec-revoke]').click();
    await pollUntil(() => !sessionRows(dom).some((r) => r.getAttribute('data-sec-session') === bSessionId), 25000);
    check('the signed-out device is gone from the real list',
      !sessionRows(dom).some((r) => r.getAttribute('data-sec-session') === bSessionId));
    check('a toast confirms it', /signed out/i.test(txt(q(dom, '#sec-toast'))), txt(q(dom, '#sec-toast')));

    // ★ THE PROOF IS ON THE OTHER DEVICE, not in the list. A row disappearing proves a render;
    // a dead refresh token proves the session was genuinely ended.
    const bAfter = await fresh(st.API_URL, st.ANON_KEY).auth.refreshSession({ refresh_token: bRefreshToken });
    check('★ that device genuinely cannot refresh afterwards — the real revoke, not a re-render',
      !!bAfter.error, bAfter.error && bAfter.error.message);

    console.log('\n7. Sign out everywhere else\n');

    const c = fresh(st.API_URL, st.ANON_KEY);
    const cSignIn = await c.auth.signInWithPassword({ email: pmEmail, password: PASSWORD });
    const d = fresh(st.API_URL, st.ANON_KEY);
    const dSignIn = await d.auth.signInWithPassword({ email: pmEmail, password: PASSWORD });
    if (cSignIn.error || dSignIn.error) throw new Error('extra device sign-ins failed');

    await dom.window.__secReload();
    await pollUntil(() => sessionRows(dom).length >= 3, 20000);
    check('GUARD: three sessions are on screen before the sweep', sessionRows(dom).length >= 3, String(sessionRows(dom).length));

    q(dom, '#sec-revoke-others').click();
    await pollUntil(() => sessionRows(dom).length === 1, 25000);
    check('only this device is left on screen', sessionRows(dom).length === 1, String(sessionRows(dom).length));
    check('...and it is still the one marked "This device"', /This device/i.test(txt(sessionRows(dom)[0])));
    check('the control hides itself once there is nowhere else', q(dom, '#sec-revoke-others').hidden === true);
    const cAfter = await fresh(st.API_URL, st.ANON_KEY).auth.refreshSession({ refresh_token: cSignIn.data.session.refresh_token });
    const dAfter = await fresh(st.API_URL, st.ANON_KEY).auth.refreshSession({ refresh_token: dSignIn.data.session.refresh_token });
    check('★ both other devices are genuinely ended, measured on them', !!cAfter.error && !!dAfter.error);

    console.log('\n8. The activity panel is GONE (register row 239) — and the sessions panel says what it covers\n');

    // ★ Removed 2026-09-17: its only source, auth.audit_log_entries, is populated locally and NOT
    // AT ALL on the hosted project, so it was permanently empty in production while every one of
    // its assertions passed here. What replaces those assertions: the panel is genuinely absent
    // from the markup (no dormant section, no hidden container, no retry control for it), the
    // header no longer promises activity, and the sessions panel states its own scope in words a
    // PM can read: a sign-in history for as long as each session lasts, and nothing more.
    check('★ no activity panel exists in the rendered page at all', !q(dom, '#sec-activity') && !q(dom, '#sec-activity-h') && !q(dom, '#sec-activity-gap'));
    check('...and no retry control for one either', all(dom, '[data-sec-retry]').every((b) => b.getAttribute('data-sec-retry') !== 'activity'));
    check('the header no longer promises account activity', !/account activity/i.test(txt(q(dom, 'header'))), txt(q(dom, 'header')));
    const scope = txt(q(dom, '#sec-sessions-note'));
    check('★ the sessions panel says plainly what it covers: live sessions with their sign-in moment', /What this list covers/i.test(scope) && /still live/i.test(scope), scope.slice(0, 160));
    check('★ ...and what it does not: ended sessions drop off, and failed attempts are never recorded', /has ended drops off/i.test(scope) && /failed attempt.*never recorded/i.test(scope), scope.slice(0, 240));
    check('every rendered session row carries its sign-in moment', sessionRows(dom).length >= 1 && sessionRows(dom).every((r) => /signed in/i.test(txt(r))), sessionRows(dom).length ? txt(sessionRows(dom)[0]) : 'no rows');

    console.log('\n9. What was NOT orphaned — the client security-actions log\n');

    check('the log section is still on the page', !!q(dom, '#log-list'));
    check('it renders its honest empty state when there is nothing in it',
      /No client security actions/i.test(txt(q(dom, '#log-list'))) || !!q(dom, '#log-list table'),
      txt(q(dom, '#log-list')).slice(0, 80));

    // A real entry through the real engine function, then the page's own re-render — in the
    // SAME window. ★ A fresh JSDOM means fresh, empty localStorage, so writing the entry in one
    // window and reading it in another would fail for a reason that has nothing to do with the
    // app: the same trap verify-pm-self-service-security.mjs's own comment records.
    dom.window.eval("appendSelfSecurityLogEntry('PM_PASSWORD_CHANGE', 'Part 8 verification entry.', " + JSON.stringify(pmEmail) + ");");
    dom.window.__secRenderLog();
    await pollUntil(() => !!q(dom, '#log-list table'), 10000);
    const logText = txt(q(dom, '#log-list'));
    check('★ getSecurityActionsLog() still has its only reader — a real entry renders',
      /Part 8 verification entry/.test(logText), logText.slice(0, 160));
    check('a self-action shows "(Own account)" rather than a bare null in the Client column',
      /\(Own account\)/.test(logText) && !/null/.test(logText), logText.slice(0, 160));

    console.log('\n10. A failed read paints a real error card, not an empty page\n');

    // ★ THE FAILURE MODE THIS GUARDS. An empty sessions list reads as "you are signed in
    // nowhere else" — a reassuring statement about a security surface, made from no data at
    // all (register row 233).
    const brokenDom = buildDom({
      callFunction: () => Promise.reject(new Error('simulated read failure')),
      writeErrorMessage: () => 'Could not reach the server.',
      withButtonBusy: (btn, label, fn) => fn(),
      getCurrentUserEmail: () => Promise.resolve(pmEmail),
      // Task B (row 246): the page now reads identity_document_access_log at init.
      selectTable: () => Promise.resolve([])
    });
    await pollUntil(() => q(brokenDom, '#sec-sessions-err').classList.contains('is-shown'), 10000);
    check('the sessions panel shows a real error card', q(brokenDom, '#sec-sessions-err').classList.contains('is-shown'));
    check('it does not render a reassuring empty list instead', sessionRows(brokenDom).length === 0);
    check('the error card carries a real retry control', all(brokenDom, '[data-sec-retry="sessions"]').length === 1 && q(brokenDom, '#sec-sessions-err [data-sec-retry]') !== null);
    check('★ the identity still renders — a failed sessions read must not read as "we do not know who you are"',
      txt(q(brokenDom, '#sec-email')) === pmEmail, txt(q(brokenDom, '#sec-email')));
    check('and the "Sign out everywhere else" control is not offered against data that failed to load',
      q(brokenDom, '#sec-revoke-others').hidden === true);

    // The retry genuinely re-fetches.
    let calls = 0;
    const retryDom = buildDom({
      callFunction: () => { calls += 1; return Promise.reject(new Error('still failing')); },
      writeErrorMessage: () => 'Could not reach the server.',
      withButtonBusy: (btn, label, fn) => fn(),
      getCurrentUserEmail: () => Promise.resolve(pmEmail),
      // Task B (row 246): the page now reads identity_document_access_log at init.
      selectTable: () => Promise.resolve([])
    });
    await pollUntil(() => calls === 1, 10000);
    q(retryDom, '[data-sec-retry="sessions"]').click();
    await pollUntil(() => calls === 2, 10000);
    check('Try again genuinely re-fetches rather than only clearing the message', calls === 2, String(calls));
    // ★ NOT closed. Both pages still hold a pending promise chain that legitimately resolves
    // after these assertions, and a closed jsdom window makes `document` undefined inside it —
    // which surfaces as a crash in the PAGE's code for a reason created entirely by the test.

  } finally {
    try { await cfg.supabase.auth.signOut(); } catch (_e) { /* the account is about to go */ }
    for (const id of created) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log('  TEARDOWN WARNING  could not delete ' + id + ': ' + error.message);
    }
  }

  console.log('\n' + passed + '/' + (passed + fails.length) + ' assertions passed.\n');
  console.log('ACCOUNT SECURITY UI: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('VERIFY FAILED WITH AN ERROR: ' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
