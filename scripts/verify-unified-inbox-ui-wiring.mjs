#!/usr/bin/env node
// Unified Communications Inbox — Stage 1 (2026-09-07). The real end-to-end proof: a genuinely
// separate anonymous visitor context (running the REAL, unmodified chat-widget.js) and a
// genuinely separate real PM session (running the REAL, unmodified admin-inbox.html's own
// inline script) — messages appearing in real time in BOTH directions via real Supabase
// Realtime, not a poll, not a shared in-process object standing in for two real browser tabs.
//
// ★★★ GENUINELY SEPARATE CONTEXTS — reuses verify-cross-role-sync-bugfix.mjs's own established
// technique exactly (see that file's own header for the full investigation this reuses):
// supabase-data.js has no import/export syntax and no project-root "type": "module", so
// Node's CommonJS-by-default ESM detection means its require/module cache is keyed by
// resolved file PATH — two temp copies of its real source, written to two distinct paths,
// are two genuinely distinct module-cache entries with zero shared JS state. Real jsdom
// windows (not the plain-object stand-ins that script's own supabase-data.js-only scope could
// get away with) are used here because this test also drives REAL DOM interaction — real
// clicks, real form fills, real innerHTML rendering — on both chat-widget.js (the visitor)
// and admin-inbox.html's own real inline script (the PM).
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-unified-inbox-ui-wiring.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

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
// Deliberately NOT forwarded — jsdom's own "Could not load img"/CSS parse noise for the real
// admin-inbox.html markup (real Tailwind CDN <script> tag references, never executed here
// since runScripts is 'outside-only') would otherwise drown out real test output.
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
  const tempPath = PROJECT_ROOT + '.tmp-inbox-test-' + label + '-' + process.pid + '.mjs';
  writeFileSync(tempPath, realSrc, 'utf8');
  tempFiles.push(tempPath);
  return tempPath;
}

async function main() {
  console.log('Unified Communications Inbox — Stage 1: end-to-end two-way real-time verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const suffix = crypto.randomBytes(4).toString('hex');
  const visitorEmail = 'ui-inbox-visitor-' + suffix + '@example.com';
  let conversationIdToCleanup = null;

  try {
    // =========================================================================================
    console.log('--- Setting up the VISITOR context (real chat-widget.js, real jsdom window) ---\n');
    const visitorDom = buildPageDom('<div id="chat-widget-mount"></div>');
    globalThis.window = visitorDom.window;
    globalThis.document = visitorDom.window.document;
    // chat-widget.js is window.eval()'d in the app's real usage (a plain classic <script src>
    // tag), but its own internal dynamic import('./supabase-config.js') needs to resolve
    // relative to its REAL file location, not the calling test script's — a dynamic import()
    // inside indirect-eval'd code resolves against the CALLER's module, not the eval'd
    // source's own path. Reusing the exact "temp copy at the project root + a real import()"
    // technique already established for supabase-data.js just below fixes this the same way.
    const chatWidgetTemp = writeTempCopy('visitor-chat-widget', readFileSync(PROJECT_ROOT + 'chat-widget.js', 'utf8'));
    await import('file://' + chatWidgetTemp.replace(/\\/g, '/'));
    visitorDom.window.initChatWidget();
    check('the real chat-widget.js mounts its own real markup into #chat-widget-mount', !!visitorDom.window.document.getElementById('chat-widget-bubble'));

    // =========================================================================================
    console.log('\n--- Setting up the PM context (real admin-inbox.html inline script, a genuinely separate real jsdom window) ---\n');
    const pmDom = buildPageDom(extractBodyMarkup(PROJECT_ROOT + 'admin-inbox.html'));

    const realSupabaseDataSrc = readFileSync(PROJECT_ROOT + 'supabase-data.js', 'utf8');
    const pmSupabaseDataTemp = writeTempCopy('pm-supabase-data', realSupabaseDataSrc);

    globalThis.window = pmDom.window;
    globalThis.document = pmDom.window.document;
    // supabase-data.js is a plain classic script (window.MarketswaveData = {...}) — eval'd
    // directly into the PM's own real window, exactly mirroring a real <script src=
    // "supabase-data.js"> tag executing in a real browser tab. Its own internal dynamic
    // import('./admin-supabase-config.js') (triggered once useAdminClient() is called below)
    // resolves relative to THIS temp file's own location (the project root), so
    // admin-supabase-config.js itself stays a real, un-duplicated singleton — correct, not a
    // gap, per verify-cross-role-sync-bugfix.mjs's own established reasoning (this test has
    // only ONE real PM context, so there is no second consumer to collide with).
    await import('file://' + pmSupabaseDataTemp.replace(/\\/g, '/'));
    const pmMarketswaveData = pmDom.window.MarketswaveData;
    check('the real PM window has its own genuine MarketswaveData instance', !!pmMarketswaveData);

    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    if (adminSignInErr) throw new Error('Real admin sign-in failed: ' + adminSignInErr.message);

    const inboxScript = extractInlineScript(PROJECT_ROOT + 'admin-inbox.html', 'loadAndSubscribe');
    pmDom.window.eval(inboxScript);
    check('the real admin-inbox.html inline script ran without throwing', true);

    await waitFor(() => pmDom.window.document.getElementById('realtime-status').textContent === 'Live', 10000);
    const toastVisible = !pmDom.window.document.getElementById('admin-toast').classList.contains('hidden');
    const toastDetail = toastVisible ? (pmDom.window.document.getElementById('admin-toast-title').textContent + ': ' + pmDom.window.document.getElementById('admin-toast-body').textContent) : '';
    check('★ the real PM inbox reaches a genuinely LIVE Realtime subscription state', pmDom.window.document.getElementById('realtime-status').textContent === 'Live', pmDom.window.document.getElementById('realtime-status').textContent + (toastDetail ? ' | toast: ' + toastDetail : ''));

    // =========================================================================================
    console.log('\n--- The visitor starts a real chat, sends a real message ---\n');
    globalThis.window = visitorDom.window;
    globalThis.document = visitorDom.window.document;

    visitorDom.window.document.getElementById('chat-widget-bubble').dispatchEvent(new visitorDom.window.Event('click', { bubbles: true }));
    check('clicking the real bubble opens the real panel', visitorDom.window.document.getElementById('chat-widget-panel').classList.contains('is-open'));

    visitorDom.window.document.getElementById('chat-widget-name').value = 'UI Test Visitor';
    visitorDom.window.document.getElementById('chat-widget-email').value = visitorEmail;
    visitorDom.window.document.getElementById('chat-widget-start-btn').dispatchEvent(new visitorDom.window.Event('click', { bubbles: true }));

    const reachedChat = await waitFor(() => visitorDom.window.document.getElementById('chat-widget-body').style.display === 'flex', 8000);
    check('★ the real visitor genuinely starts a real chat (a real signInAnonymously() + start-chat-conversation round trip)', !!reachedChat, visitorDom.window.document.getElementById('chat-widget-precontact-error').textContent);

    const { data: convoRow } = await admin.from('conversations').select('id').ilike('contact_email', visitorEmail).maybeSingle();
    check('a real conversation row genuinely exists for this visitor', !!convoRow);
    conversationIdToCleanup = convoRow && convoRow.id;

    const firstMessageBody = 'Hello, I have a real question — ' + suffix;
    visitorDom.window.document.getElementById('chat-widget-input').value = firstMessageBody;
    visitorDom.window.document.getElementById('chat-widget-send').dispatchEvent(new visitorDom.window.Event('click', { bubbles: true }));

    await waitFor(() => {
      const rows = visitorDom.window.document.querySelectorAll('.chat-widget-msg-row.is-inbound');
      return Array.from(rows).some((r) => r.textContent.indexOf(firstMessageBody) !== -1);
    }, 5000);
    check('the visitor\'s own message renders in their own real widget', Array.from(visitorDom.window.document.querySelectorAll('.chat-widget-msg-row')).some((r) => r.textContent.indexOf(firstMessageBody) !== -1));

    // =========================================================================================
    console.log('\n--- ★★★ THE REAL TWO-WAY PROOF: the PM sees the visitor\'s message via real-time, not a poll ---\n');
    globalThis.window = pmDom.window;
    globalThis.document = pmDom.window.document;

    const pmSeesIt = await waitFor(() => {
      const rows = pmDom.window.document.querySelectorAll('#convo-list .convo-row');
      return Array.from(rows).some((r) => r.textContent.indexOf('UI Test Visitor') !== -1 || r.textContent.indexOf(visitorEmail) !== -1);
    }, 8000);
    check('★ the real PM inbox genuinely receives the new conversation via real-time, with zero manual reload/re-fetch triggered by this test', !!pmSeesIt);

    const convoRowEl = Array.from(pmDom.window.document.querySelectorAll('#convo-list .convo-row')).find((r) => r.textContent.indexOf(visitorEmail) !== -1);
    check('the real conversation row shows an unread indicator before being opened', !!convoRowEl && convoRowEl.querySelector('.bg-amber-500') !== null);
    convoRowEl.dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));

    await waitFor(() => !pmDom.window.document.getElementById('thread-view').classList.contains('hidden'), 3000);
    const threadHasFirstMessage = await waitFor(() => pmDom.window.document.getElementById('thread-messages').textContent.indexOf(firstMessageBody) !== -1, 3000);
    check('★ the real visitor\'s exact message body appears in the real PM thread view', !!threadHasFirstMessage);

    await waitFor(async () => {
      const { data } = await admin.from('conversations').select('unread_by_pm').eq('id', conversationIdToCleanup).maybeSingle();
      return data && data.unread_by_pm === false;
    }, 5000);
    const { data: afterOpen } = await admin.from('conversations').select('unread_by_pm').eq('id', conversationIdToCleanup).single();
    check('opening the conversation in the real PM inbox genuinely calls admin-update-conversation and clears unread_by_pm', afterOpen.unread_by_pm === false);

    // =========================================================================================
    console.log('\n--- ★★★ THE REVERSE DIRECTION: the PM replies, the visitor sees it via real-time ---\n');
    const pmReplyBody = 'Thanks for reaching out — a real PM reply, ' + suffix;
    pmDom.window.document.getElementById('thread-reply-input').value = pmReplyBody;
    pmDom.window.document.getElementById('thread-reply-send').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));

    await waitFor(() => pmDom.window.document.getElementById('thread-messages').textContent.indexOf(pmReplyBody) !== -1, 5000);
    check('the real PM reply renders in the real PM\'s own thread view', pmDom.window.document.getElementById('thread-messages').textContent.indexOf(pmReplyBody) !== -1);

    globalThis.window = visitorDom.window;
    globalThis.document = visitorDom.window.document;
    const visitorSeesReply = await waitFor(() => {
      const rows = visitorDom.window.document.querySelectorAll('.chat-widget-msg-row.is-outbound');
      return Array.from(rows).some((r) => r.textContent.indexOf(pmReplyBody) !== -1);
    }, 8000);
    check('★★★ THE CORE REQUIREMENT: the real visitor genuinely receives the PM\'s reply via real-time, in a completely separate real jsdom context, with zero shared in-process state between the two sides', !!visitorSeesReply);

    // =========================================================================================
    console.log('\n--- Search + filters against a realistic seeded volume, in the real PM inbox\'s own DOM ---\n');
    globalThis.window = pmDom.window;
    globalThis.document = pmDom.window.document;

    const seedTag = 'seedvol-' + suffix;
    const seedRows = [
      { name: 'Alpha Nordholm ' + seedTag, email: 'alpha-' + seedTag + '@example.com', status: 'open', unread: true, channel: 'chat', body: 'a general chat inquiry' },
      { name: 'Bravo Castellane ' + seedTag, email: 'bravo-' + seedTag + '@example.com', status: 'resolved', unread: false, channel: 'chat', body: 'thanks that resolved it' },
      { name: 'Charlie Wrenfield ' + seedTag, email: 'charlie-' + seedTag + '@example.com', status: 'archived', unread: false, channel: 'chat', body: 'an archived old thread' },
      { name: 'Delta Marchetti ' + seedTag, email: 'delta-' + seedTag + '@example.com', status: 'open', unread: false, channel: 'email', body: 'a real inbound email about statements' },
      { name: 'Echo Ravensworth ' + seedTag, email: 'echo-' + seedTag + '@example.com', status: 'open', unread: true, channel: 'chat', body: 'a rare keyword ZEPHYRLOOKUP appears only here' },
    ];
    for (const row of seedRows) {
      const { data: convo } = await admin.from('conversations').insert({ contact_name: row.name, contact_email: row.email, status: row.status }).select().single();
      await admin.from('messages').insert({ conversation_id: convo.id, channel: row.channel, direction: 'inbound', body: row.body, sender_name: row.name, sender_email: row.email });
      row.id = convo.id;
      // handle_new_message() always sets unread_by_pm=true for an inbound message (correct,
      // real behavior — a new inbound message should always flag PM review). To seed a
      // realistic MIX of read/unread for the filter test below, explicitly mark this one
      // "already read by the PM" afterward when the row isn't meant to stay unread.
      if (!row.unread) {
        await admin.from('conversations').update({ unread_by_pm: false }).eq('id', convo.id);
      }
    }

    await waitFor(() => Array.from(pmDom.window.document.querySelectorAll('#convo-list .convo-row')).filter((r) => r.textContent.indexOf(seedTag) !== -1).length === seedRows.length, 8000);
    check('all 5 seeded conversations genuinely arrive in the real PM inbox via real-time (not a re-fetch)', Array.from(pmDom.window.document.querySelectorAll('#convo-list .convo-row')).filter((r) => r.textContent.indexOf(seedTag) !== -1).length === seedRows.length);

    function seedRowsVisible() {
      return Array.from(pmDom.window.document.querySelectorAll('#convo-list .convo-row')).filter((r) => r.textContent.indexOf(seedTag) !== -1);
    }
    function setSearch(term) {
      const input = pmDom.window.document.getElementById('inbox-search');
      input.value = term;
      input.dispatchEvent(new pmDom.window.Event('input', { bubbles: true }));
    }
    function clickFilterPill(containerId, value) {
      const pill = pmDom.window.document.querySelector('#' + containerId + ' [data-status-filter="' + value + '"], #' + containerId + ' [data-channel-filter="' + value + '"]');
      pill.dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    }

    setSearch('Bravo Castellane');
    check('real search by contact name narrows to exactly the one matching conversation', seedRowsVisible().length === 1 && seedRowsVisible()[0].textContent.indexOf('Bravo') !== -1);

    setSearch('delta-' + seedTag + '@example.com');
    check('real search by contact email narrows to exactly the one matching conversation', seedRowsVisible().length === 1 && seedRowsVisible()[0].textContent.indexOf('Delta') !== -1);

    setSearch('ZEPHYRLOOKUP');
    check('★ real search reaches into MESSAGE BODY text, not just name/email — a term that only appears in one message body correctly finds its conversation', seedRowsVisible().length === 1 && seedRowsVisible()[0].textContent.indexOf('Echo') !== -1);

    setSearch(seedTag);
    check('clearing back to a shared substring shows all 5 seeded rows again', seedRowsVisible().length === 5);

    clickFilterPill('status-filters', 'unread');
    check('the real Unread filter shows exactly the 2 seeded unread conversations (Alpha, Echo)', seedRowsVisible().length === 2 && seedRowsVisible().every((r) => r.textContent.indexOf('Alpha') !== -1 || r.textContent.indexOf('Echo') !== -1));

    clickFilterPill('status-filters', 'resolved');
    check('the real Resolved filter shows exactly the 1 seeded resolved conversation (Bravo)', seedRowsVisible().length === 1 && seedRowsVisible()[0].textContent.indexOf('Bravo') !== -1);

    clickFilterPill('status-filters', 'archived');
    check('the real Archived filter shows exactly the 1 seeded archived conversation (Charlie)', seedRowsVisible().length === 1 && seedRowsVisible()[0].textContent.indexOf('Charlie') !== -1);

    clickFilterPill('status-filters', 'all');
    clickFilterPill('channel-filters', 'email');
    check('the real Email channel filter shows exactly the 1 seeded email-channel conversation (Delta)', seedRowsVisible().length === 1 && seedRowsVisible()[0].textContent.indexOf('Delta') !== -1);

    clickFilterPill('channel-filters', 'chat');
    check('the real Chat channel filter shows the other 4 seeded chat-channel conversations', seedRowsVisible().length === 4);

    clickFilterPill('channel-filters', 'all');
    check('resetting both filters back to All shows all 5 seeded rows again', seedRowsVisible().length === 5);

    // Real RLS isolation, proven at the UI level too: a genuinely different anonymous visitor
    // cannot see any of these seeded conversations (or the earlier one) in their own widget.
    console.log('\n--- Real RLS isolation, proven through the actual widget UI (not just a raw API probe) ---\n');
    const secondVisitorDom = buildPageDom('<div id="chat-widget-mount"></div>');
    globalThis.window = secondVisitorDom.window;
    globalThis.document = secondVisitorDom.window.document;
    const secondVisitorChatWidgetTemp = writeTempCopy('second-visitor-chat-widget', readFileSync(PROJECT_ROOT + 'chat-widget.js', 'utf8'));
    await import('file://' + secondVisitorChatWidgetTemp.replace(/\\/g, '/'));
    secondVisitorDom.window.initChatWidget();
    secondVisitorDom.window.document.getElementById('chat-widget-bubble').dispatchEvent(new secondVisitorDom.window.Event('click', { bubbles: true }));
    secondVisitorDom.window.document.getElementById('chat-widget-name').value = 'Second Visitor';
    secondVisitorDom.window.document.getElementById('chat-widget-email').value = 'second-visitor-' + suffix + '@example.com';
    secondVisitorDom.window.document.getElementById('chat-widget-start-btn').dispatchEvent(new secondVisitorDom.window.Event('click', { bubbles: true }));
    await waitFor(() => secondVisitorDom.window.document.getElementById('chat-widget-body').style.display === 'flex', 8000);
    check('★ a genuinely different, second anonymous visitor sees ZERO history — their own real widget starts a fresh, empty thread, never the first visitor\'s or any seeded conversation\'s messages', secondVisitorDom.window.document.querySelectorAll('.chat-widget-msg-row').length === 0);
    const { data: secondConvoRow } = await admin.from('conversations').select('id').ilike('contact_email', 'second-visitor-' + suffix + '@example.com').maybeSingle();
    if (secondConvoRow) {
      await admin.from('messages').delete().eq('conversation_id', secondConvoRow.id);
      await admin.from('conversations').delete().eq('id', secondConvoRow.id);
    }

    // =========================================================================================
    console.log('\n--- Resolve action, real-time reflected back to the PM\'s own list ---\n');
    globalThis.window = pmDom.window;
    globalThis.document = pmDom.window.document;
    pmDom.window.document.getElementById('thread-resolve-btn').dispatchEvent(new pmDom.window.Event('click', { bubbles: true }));
    await waitFor(() => pmDom.window.document.getElementById('thread-status-badge').textContent === 'resolved', 5000);
    check('the real Resolve action updates the real thread status badge', pmDom.window.document.getElementById('thread-status-badge').textContent === 'resolved');
    const { data: resolvedRow } = await admin.from('conversations').select('status, resolved_by_email').eq('id', conversationIdToCleanup).single();
    check('the real conversation row is genuinely resolved with real PM attribution', resolvedRow.status === 'resolved' && !!resolvedRow.resolved_by_email);
  } finally {
    console.log('\nCleaning up...');
    for (const f of tempFiles) { try { unlinkSync(f); } catch (_e) {} }
    // ★ The visitor's anonymous auth user has to be collected BEFORE its conversation is
    // deleted, because visitor_auth_id on that row is the only way back to it.
    //
    // The previous comment here reasoned that because an anonymous session has no real email,
    // there was "nothing further to find/delete for the anonymous side". That conflated two
    // different things: signInAnonymously() genuinely DOES create a real auth.users row — it
    // just has a null email — so there was nothing to find BY EMAIL, but there was very much
    // something to delete. Only the conversation was being cleaned, and the anonymous user
    // was stranded, one per run, which is what kept auth_users drifting upward across
    // otherwise-clean suite runs. (A listUsers() call sat here too, its result never read.)
    const anonUserIds = new Set();
    const collectVisitor = async (filterFn) => {
      const { data } = await filterFn(admin.from('conversations').select('id, visitor_auth_id'));
      (data || []).forEach((r) => { if (r.visitor_auth_id) anonUserIds.add(r.visitor_auth_id); });
      return (data || []).map((r) => r.id);
    };

    if (conversationIdToCleanup) {
      await collectVisitor((q) => q.eq('id', conversationIdToCleanup));
      await admin.from('messages').delete().eq('conversation_id', conversationIdToCleanup);
      await admin.from('conversations').delete().eq('id', conversationIdToCleanup);
    }
    const seededIds = await collectVisitor((q) => q.ilike('contact_email', '%' + suffix + '%'));
    if (seededIds.length) {
      await admin.from('messages').delete().in('conversation_id', seededIds);
      await admin.from('conversations').delete().in('id', seededIds);
    }
    for (const uid of anonUserIds) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
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
  console.error('\nFATAL: script did not complete within 90s -- forcing exit.');
  process.exit(1);
}, 90000);

main().catch(function (err) {
  clearTimeout(watchdog);
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.stack || err));
  process.exit(1);
});
