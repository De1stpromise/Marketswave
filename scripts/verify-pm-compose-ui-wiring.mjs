#!/usr/bin/env node
// PM Compose Email + Company Announcements (2026-09-07). The real end-to-end UI proof: the
// REAL, unmodified admin-inbox.html inline script (its own new "New Message" modal — tab
// switching, real client search/select, the announcement recipient-count preview, the
// two-step confirm/cancel gate) driven through real jsdom DOM events, backed by real
// send-conversation-reply / send-announcement calls against the real locally-served
// functions. The underlying backend behavior (validation, real filtering, real footerType
// propagation, real chunked batching, the no-conversation-for-announcements rule, real
// reply-threading) already has its own dedicated, thorough regression script
// (verify-pm-compose-announcements.mjs) — this script proves the UI WIRING on top of that:
// that the modal's own click handlers, tab toggling, search rendering, and confirm-gate
// genuinely call those same real functions correctly, not a re-proof of the backend rules
// themselves.
//
// Reuses verify-unified-inbox-ui-wiring.mjs's own established harness technique exactly (see
// that file's own header for the full "why a real jsdom window + a temp-copy import, not a
// mock" reasoning) — LOCAL STACK ONLY.
//
// Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-pm-compose-ui-wiring.mjs
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(test, maxMs) {
  const start = Date.now();
  for (;;) {
    const result = await test();
    if (result) return result;
    if (Date.now() - start > maxMs) return result;
    await sleep(150);
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

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const forwardingConsole = new VirtualConsole();
forwardingConsole.on('jsdomError', function () {});

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

function buildPageDom(bodyMarkup) {
  return new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://127.0.0.1:8765/', runScripts: 'outside-only', virtualConsole: forwardingConsole, pretendToBeVisual: true
  });
}

const tempFiles = [];
function writeTempCopy(label, realSrc) {
  const tempPath = PROJECT_ROOT + '.tmp-compose-ui-test-' + label + '-' + process.pid + '.mjs';
  writeFileSync(tempPath, realSrc, 'utf8');
  tempFiles.push(tempPath);
  return tempPath;
}

async function main() {
  console.log('PM Compose Email + Company Announcements — real UI wiring verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const suffix = crypto.randomBytes(4).toString('hex');
  const cleanupAuthUserIds = [];
  const cleanupConversationIds = [];

  async function createTestClient({ email, name, status = 'active', accountType = 'Individual Account' }) {
    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({ email, password: 'RealTestClientPass2026!Aa', email_confirm: true });
    if (authErr) throw new Error('Could not create real test auth user for ' + email + ': ' + authErr.message);
    cleanupAuthUserIds.push(authUser.user.id);
    const { data: clientRow, error: clientErr } = await admin.from('clients').insert({
      id: authUser.user.id, email, name, phone: '+1-555-0100', status, account_type: accountType
    }).select().single();
    if (clientErr) throw new Error('Could not create real test clients row for ' + email + ': ' + clientErr.message);
    return clientRow;
  }

  try {
    // =========================================================================================
    console.log('--- Real test clients: one to compose to, one to announce to, one deliberately excluded ---\n');
    const clientX = await createTestClient({ email: 'ui-compose-x-' + suffix + '@invalid.test', name: 'UI Compose Target X', status: 'active', accountType: 'Individual Account' });
    const clientY = await createTestClient({ email: 'ui-announce-y-' + suffix + '@invalid.test', name: 'UI Announce Target Y', status: 'active', accountType: 'Business Account' });
    check('real setup: 2 test clients created', !!clientX.id && !!clientY.id);

    // =========================================================================================
    console.log('\n--- Setting up the PM context (real admin-inbox.html inline script, a real jsdom window) ---\n');
    const pmDom = buildPageDom(extractBodyMarkup(PROJECT_ROOT + 'admin-inbox.html'));

    const realSupabaseDataSrc = readFileSync(PROJECT_ROOT + 'supabase-data.js', 'utf8');
    const pmSupabaseDataTemp = writeTempCopy('pm-supabase-data', realSupabaseDataSrc);

    globalThis.window = pmDom.window;
    globalThis.document = pmDom.window.document;
    await import('file://' + pmSupabaseDataTemp.replace(/\\/g, '/'));
    check('the real PM window has its own genuine MarketswaveData instance', !!pmDom.window.MarketswaveData);

    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    if (adminSignInErr) throw new Error('Real admin sign-in failed: ' + adminSignInErr.message);

    const inboxScript = extractInlineScript(PROJECT_ROOT + 'admin-inbox.html', 'loadAndSubscribe');
    pmDom.window.eval(inboxScript);
    check('the real admin-inbox.html inline script (now including the compose/announcement code) ran without throwing', true);

    await waitFor(() => pmDom.window.document.getElementById('realtime-status').textContent === 'Live', 10000);
    check('★ the real PM inbox reaches a genuinely LIVE Realtime subscription state before we start clicking', pmDom.window.document.getElementById('realtime-status').textContent === 'Live');

    globalThis.window = pmDom.window;
    globalThis.document = pmDom.window.document;

    // =========================================================================================
    console.log('\n--- Real UI: open the New Message modal ---\n');
    const D = pmDom.window.document;
    D.getElementById('new-message-btn').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    check('★ a real click on "New Message" opens the real modal', !D.getElementById('compose-modal-backdrop').classList.contains('hidden'));
    check('the modal opens defaulted to the "To One Client" tab', D.querySelector('#compose-mode-tabs [data-compose-mode="single"]').classList.contains('is-active'));

    // =========================================================================================
    console.log('\n--- Real UI: compose — search for a real client, select them, send ---\n');
    const searchInput = D.getElementById('compose-client-search');
    // The real client list loads asynchronously (MarketswaveData.selectTable('clients')) —
    // poll by re-typing the search term until real results genuinely appear, the same
    // "real async data, real polling wait" discipline every prior UI-wiring script uses.
    const foundResult = await waitFor(function () {
      searchInput.value = 'UI Compose Target X';
      searchInput.dispatchEvent(new pmDom.window.Event('input', { bubbles: true }));
      return D.getElementById('compose-client-results').textContent.indexOf(clientX.email) !== -1;
    }, 10000);
    check('★ typing a real client\'s name genuinely finds them in the real, async-loaded client list', foundResult, D.getElementById('compose-client-results').textContent);

    const optionEl = Array.from(D.querySelectorAll('.compose-client-option')).find((el) => el.textContent.indexOf(clientX.email) !== -1);
    optionEl.dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    check('clicking a real search result selects them (the selected-client chip shows their real name+email)', !D.getElementById('compose-client-selected').classList.contains('hidden') && D.getElementById('compose-client-selected-label').textContent.indexOf(clientX.email) !== -1);

    const uiSubject = 'UI Wiring Compose Test - ' + suffix;
    D.getElementById('compose-subject').value = uiSubject;
    D.getElementById('compose-body').value = 'A real message sent through the real UI.';
    // ★ Real test-script fix, not an app bug: jsdom's default-action handling (toggling a
    // radio input) only fires from the real HTMLElement.click() method, not a manually
    // dispatched synthetic 'click' Event — confirmed directly (a dispatchEvent() attempt left
    // the radio genuinely unchecked). .click() is the correct, documented way to simulate a
    // real user click with its real default action in jsdom.
    D.querySelector('input[name="compose-footer-type"][value="investment"]').click();
    check('clicking the Investment radio genuinely selects it (real footerType choice, not a guess)', D.querySelector('input[name="compose-footer-type"][value="investment"]').checked);

    D.getElementById('compose-send-btn').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    const composeSuccessToast = await waitFor(function () {
      return !D.getElementById('admin-toast').classList.contains('hidden') && D.getElementById('admin-toast-title').textContent === 'Message Sent';
    }, 10000);
    check('★ a real click on Send genuinely calls the real backend and shows a real "Message Sent" toast', composeSuccessToast, D.getElementById('admin-toast-title').textContent + ': ' + D.getElementById('admin-toast-body').textContent);
    check('the modal genuinely closes itself after a successful real send', D.getElementById('compose-modal-backdrop').classList.contains('hidden'));

    const { data: composedConvo } = await admin.from('conversations').select('*').ilike('contact_email', clientX.email).maybeSingle();
    check('a real conversation genuinely exists in Postgres for the client the UI composed to', composedConvo && composedConvo.subject === uiSubject);
    if (composedConvo) cleanupConversationIds.push(composedConvo.id);

    // =========================================================================================
    console.log('\n--- Real UI: switch to Company Announcement, change filters, confirm/cancel/confirm-and-send ---\n');
    D.getElementById('new-message-btn').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    D.querySelector('#compose-mode-tabs [data-compose-mode="announcement"]').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    check('★ clicking the "Company Announcement" tab genuinely switches panels', D.querySelector('#compose-mode-tabs [data-compose-mode="announcement"]').classList.contains('is-active') && !D.getElementById('compose-panel-announcement').classList.contains('hidden') && D.getElementById('compose-panel-single').classList.contains('hidden'));

    const accountTypeSelect = D.getElementById('announce-account-type-filter');
    accountTypeSelect.value = 'Business Account';
    accountTypeSelect.dispatchEvent(new pmDom.window.Event('change', { bubbles: true }));
    const countUpdated = await waitFor(function () {
      return /^\d+ real client/.test(D.getElementById('announce-recipient-count').textContent);
    }, 8000);
    check('★ changing the real account-type filter genuinely updates the real recipient-count preview from the real, async-loaded client list', countUpdated, D.getElementById('announce-recipient-count').textContent);

    const uiAnnounceSubject = 'UI Wiring Announcement Test - ' + suffix;
    D.getElementById('compose-subject').value = uiAnnounceSubject;
    D.getElementById('compose-body').value = 'A real announcement sent through the real UI.';
    D.querySelector('input[name="compose-footer-type"][value="general"]').click();

    D.getElementById('compose-send-btn').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    check('★ THE TWO-STEP CONFIRM GATE: the first real Send click shows a real confirm panel instead of sending immediately', !D.getElementById('compose-confirm-panel').classList.contains('hidden') && D.getElementById('compose-send-btn').textContent === 'Confirm & Send');

    D.getElementById('compose-cancel-btn').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    check('a real Cancel click genuinely reverts the confirm gate (panel hidden, button text back to Send) without closing the whole modal', D.getElementById('compose-confirm-panel').classList.contains('hidden') && D.getElementById('compose-send-btn').textContent === 'Send' && !D.getElementById('compose-modal-backdrop').classList.contains('hidden'));

    D.getElementById('compose-send-btn').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    check('re-clicking Send after Cancel genuinely re-shows the real confirm gate', !D.getElementById('compose-confirm-panel').classList.contains('hidden'));
    D.getElementById('compose-send-btn').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));

    const announceSuccessToast = await waitFor(function () {
      return !D.getElementById('admin-toast').classList.contains('hidden') && D.getElementById('admin-toast-title').textContent === 'Announcement Sent';
    }, 15000);
    check('★ the real "Confirm & Send" click genuinely calls the real backend and shows a real "Announcement Sent" toast', announceSuccessToast, D.getElementById('admin-toast-title').textContent + ': ' + D.getElementById('admin-toast-body').textContent);
    check('the modal genuinely closes itself after a successful real announcement send', D.getElementById('compose-modal-backdrop').classList.contains('hidden'));

    const { data: announceLogs } = await admin.from('email_log').select('recipient').eq('subject', uiAnnounceSubject);
    const announceRecipients = (announceLogs || []).map((r) => r.recipient);
    check('★ the real announcement, sent entirely through the real UI, genuinely reached the real Business-Account client (Y)', announceRecipients.includes(clientY.email));
    check('★ the real announcement genuinely EXCLUDED the real Individual-Account client (X) — the real UI filter genuinely worked, not just accepted', !announceRecipients.includes(clientX.email));

    const { data: announceConvos } = await admin.from('conversations').select('id').ilike('contact_email', clientY.email);
    check('the real announcement sent through the real UI created NO conversation thread, exactly as the backend guarantees', announceConvos.length === 0);

  } finally {
    console.log('\nCleaning up real test data...');
    for (const id of cleanupConversationIds) {
      await admin.from('messages').delete().eq('conversation_id', id);
      await admin.from('conversations').delete().eq('id', id);
    }
    await admin.from('email_log').delete().ilike('recipient', '%' + suffix + '%');
    for (const id of cleanupAuthUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch (_e) { /* already gone */ }
    }
    console.log('Done.');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
  process.exit(0);
}

const watchdog = setTimeout(function () {
  console.error('\nFATAL: script did not complete within 120s -- forcing exit.');
  process.exit(1);
}, 120000);

main().then(function () { clearTimeout(watchdog); }).catch(function (err) {
  clearTimeout(watchdog);
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.stack || err));
  process.exit(1);
});
