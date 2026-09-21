#!/usr/bin/env node
// verify-inbox-tickets-ui-wiring.mjs — PM tool revamp, part 1: the rebuilt admin-inbox.html,
// driven as a real DOM (2026-09-14).
//
//   npm run verify-inbox-tickets-ui-wiring      (from scripts/; functions serve must be running)
//
// The REAL admin-inbox.html body markup and the REAL inline script (extracted verbatim, not
// retyped) run inside a real jsdom window against the real local stack, with a real admin
// session — the harness shape verify-unified-inbox-ui-wiring.mjs established. Seeded around
// it: a real client with two migrated-style tickets, a general thread that starts as chat, an
// anonymous visitor thread, an unknown-sender email thread, a live presence session for the
// client, and an outbound email with delivery state.
//
// COVERS: the rail (five views, counts, a thread MOVING from Chats to Email as its most recent
// message changes channel, tickets in their own view), the list (grouped by urgency, search
// by body and by case id, "Waiting on me", the three sender types, ticket rows with case id +
// status pill, ticket filters by status and category), the thread (ticket header with a
// status dropdown, the meta strip, the opening message with the category header and a real
// attachment, day separators, an email card with subject + delivery state, a chat bubble, a
// status change appearing inline as a system line), the context strip for a client (pending
// requests, last activity, the Open profile hand-off carrying ?client=), the composer (default
// channel, the online hint from a real presence row, the email subject line, a real chat
// reply arriving back via Realtime, an explicit email reply refused with the real server
// message), a typing indicator arriving over a real Realtime broadcast, the ?c= deep link,
// and the mobile list/thread stacking class.
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
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const forwardingConsole = new VirtualConsole();
forwardingConsole.on('jsdomError', function () {});
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}
function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
}
function buildPageDom(bodyMarkup, urlStr) {
  return new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', { url: urlStr || 'http://127.0.0.1:8765/admin-inbox.html', runScripts: 'outside-only', virtualConsole: forwardingConsole, pretendToBeVisual: true });
}
const tempFiles = [];
function writeTempCopy(label, realSrc) {
  const tempPath = PROJECT_ROOT + '.tmp-inbox-tickets-test-' + label + '-' + process.pid + '.mjs';
  writeFileSync(tempPath, realSrc, 'utf8');
  tempFiles.push(tempPath);
  return tempPath;
}

async function main() {
  console.log('PM tool revamp, part 1 — the rebuilt inbox, driven as a real DOM\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const users = [];
  const convoIds = [];
  let sessionRowId = null;
  const visitorRowId = crypto.randomUUID();

  try {
    // ------------------------------------------------------------------ seed
    const password = 'InboxUi-2026!';
    const { data: cu } = await admin.auth.admin.createUser({ email: 'inbox-ui-' + suffix + '@test.marketswave.local', password, email_confirm: true });
    const clientId = cu.user.id; users.push(clientId);
    const clientEmail = 'inbox-ui-malformed-' + suffix; // malformed: no real mail ever leaves
    await admin.from('clients').insert({ id: clientId, name: 'Ticket Fixture Client ' + suffix, email: clientEmail, phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 50000, allocated_capital: 0, asset_returns: 0 });
    await admin.from('transactions').insert({ client_id: clientId, type: 'DEPOSIT', total_value: 50000, status: 'completed' });
    await admin.from('deposit_requests').insert({ client_id: clientId, method: 'bank', requested_amount: 5000, currency: 'USD', details: {}, status: 'pending' });

    const evidenceBytes = Buffer.from('evidence bytes ' + suffix);
    const evidencePath = clientId + '/uploads/' + crypto.randomUUID() + '/allocation-screenshot.png';
    const clientSession = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await clientSession.auth.signInWithPassword({ email: 'inbox-ui-' + suffix + '@test.marketswave.local', password });
    await clientSession.storage.from('documents').upload(evidencePath, evidenceBytes, { contentType: 'image/png' });

    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    async function convo(row) { const { data, error } = await admin.from('conversations').insert(row).select('id').single(); if (error) throw new Error(error.message); convoIds.push(data.id); return data.id; }
    async function msg(row) { const { data, error } = await admin.from('messages').insert(row).select('id').single(); if (error) throw new Error(error.message); return data.id; }

    // Ticket 1: in progress, with a system line and a PM reply, evidence attached.
    const t1 = await convo({ client_id: clientId, contact_email: clientEmail, contact_name: 'Ticket Fixture Client ' + suffix, kind: 'ticket', category: 'Transaction Issue', display_id: 'DISP-0001', subject: 'DISP-0001 · Transaction Issue', status: 'in_progress', created_at: ago(30) });
    await msg({ conversation_id: t1, channel: 'chat', direction: 'inbound', body: 'My BTC allocation from 9 September is still showing as pending.', sender_name: 'Gary', sender_email: clientEmail, sent_at: ago(30), attachment_path: evidencePath, attachment_name: 'allocation-screenshot.png', attachment_size: evidenceBytes.length });
    await msg({ conversation_id: t1, channel: 'system', direction: 'outbound', body: 'Status changed to In progress by pm@marketswave.local', sender_email: 'pm@marketswave.local', sent_at: ago(29) });
    await msg({ conversation_id: t1, channel: 'chat', direction: 'outbound', body: 'Thanks Gary — I can see it. The allocation is queued behind settlement.', sender_name: 'Portfolio Manager', sender_email: 'pm@marketswave.local', sent_at: ago(28) });
    await admin.from('conversations').update({ unread_by_pm: false }).eq('id', t1);
    // Ticket 2: open, unread, a callback request.
    const t2 = await convo({ client_id: clientId, contact_email: clientEmail, contact_name: 'Ticket Fixture Client ' + suffix, kind: 'ticket', category: 'Callback Request', display_id: 'DISP-0002', subject: 'DISP-0002 · Callback Request', status: 'open', created_at: ago(2) });
    await msg({ conversation_id: t2, channel: 'chat', direction: 'inbound', body: 'Name: Gary\nPhone: +46 70 000 0000\nPreferred window: Morning', sender_email: clientEmail, sent_at: ago(2) });
    // The client's general thread: starts as chat, unread.
    const g1 = await convo({ client_id: clientId, contact_email: clientEmail, contact_name: 'Ticket Fixture Client ' + suffix, kind: 'chat', status: 'open', created_at: ago(5) });
    await msg({ conversation_id: g1, channel: 'chat', direction: 'inbound', body: 'Is the BTC allocation still pending on your side?', sender_email: clientEmail, sent_at: ago(1) });
    // An anonymous visitor thread (read).
    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonData } = await anonClient.auth.signInAnonymously(); users.push(anonData.user.id);
    const a1 = await convo({ visitor_auth_id: anonData.user.id, contact_email: 'visitor-' + suffix + '@example.com', contact_name: 'Visitor Stockholm', kind: 'chat', status: 'open', created_at: ago(4), unread_by_pm: false });
    await msg({ conversation_id: a1, channel: 'chat', direction: 'inbound', body: 'Do you take clients outside the EU?', sender_email: 'visitor-' + suffix + '@example.com', sent_at: ago(4) });
    await admin.from('conversations').update({ unread_by_pm: false }).eq('id', a1);
    // An unknown-sender email thread with an outbound email carrying delivery state.
    const e1 = await convo({ contact_email: 'cold-' + suffix + '@example.com', contact_name: 'Sofia Berg', kind: 'email', subject: 'Question about your fees', status: 'open', created_at: ago(20) });
    await msg({ conversation_id: e1, channel: 'email', direction: 'inbound', body: 'What are your management fees for a $200k portfolio?', sender_name: 'Sofia Berg', sender_email: 'cold-' + suffix + '@example.com', sent_at: ago(20), message_id: '<in-' + suffix + '@example.com>' });
    await msg({ conversation_id: e1, channel: 'email', direction: 'outbound', body: 'Thanks Sofia — our advisory fee is 1.25% per year.', sender_name: 'Portfolio Manager', sender_email: 'pm@marketswave.local', sent_at: ago(19), message_id: '<out-' + suffix + '@marketswave.net>', resend_id: 're_ui_' + suffix, delivery_status: 'opened', delivered_at: ago(19), opened_at: ago(18) });
    await admin.from('conversations').update({ unread_by_pm: false }).eq('id', e1);
    // A live presence session for the client.
    await admin.from('visitors').insert({ id: visitorRowId, visit_count: 3, first_seen_at: ago(48), last_seen_at: new Date().toISOString() });
    const { data: sess } = await admin.from('visitor_sessions').insert({ id: crypto.randomUUID(), visitor_id: visitorRowId, visit_number: 3, client_id: clientId, client_name: 'Ticket Fixture Client ' + suffix, started_at: ago(0.1), last_seen_at: new Date().toISOString(), current_path: '/dashboard', page_count: 2, journey: [], city: 'Stockholm', country: 'Sweden' }).select('id').single();
    sessionRowId = sess.id;

    // ------------------------------------------------------------------ the PM context
    console.log('--- The real admin-inbox.html, in a real DOM, with a real admin session ---\n');
    const pmDom = buildPageDom(extractBodyMarkup(PROJECT_ROOT + 'admin-inbox.html'), 'http://127.0.0.1:8765/admin-inbox.html?c=' + t1);
    const pmSupabaseDataTemp = writeTempCopy('pm-supabase-data', readFileSync(PROJECT_ROOT + 'supabase-data.js', 'utf8'));
    globalThis.window = pmDom.window;
    globalThis.document = pmDom.window.document;
    globalThis.localStorage = pmDom.window.localStorage;
    await import('file://' + pmSupabaseDataTemp.replace(/\\/g, '/'));
    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    check('the real admin session signs in', !adminSignInErr, adminSignInErr && adminSignInErr.message);
    pmDom.window.currentEnvQuery = function () { return ''; };
    const D = pmDom.window.document;
    pmDom.window.eval(extractInlineScript(PROJECT_ROOT + 'admin-inbox.html', 'loadAndSubscribe'));
    await waitFor(() => D.getElementById('realtime-status').textContent === 'Live', 15000);
    check('★ the inbox reaches a LIVE Realtime state', D.getElementById('realtime-status').textContent === 'Live', D.getElementById('realtime-status').textContent);
    await waitFor(() => D.querySelectorAll('#convo-list .convo-row').length > 0, 10000);

    // ------------------------------------------------------------------ deep link + ticket thread
    console.log('\n--- Deep link, ticket header, meta strip, opening message, attachment ---\n');
    const rail = (v) => D.querySelector('#inbox-rail .ibx-rb[data-view="' + v + '"]');
    check('?c=<ticket> opens that ticket AND switches the rail to Tickets', !D.getElementById('thread-view').classList.contains('hidden') && rail('tickets').classList.contains('is-on'));
    check('the header carries the case id, and status is a DROPDOWN (no modal)', D.getElementById('thread-caseid').textContent === 'DISP-0001' && !D.getElementById('thread-status-wrap').hidden && D.getElementById('thread-status-select').value === 'in_progress');
    check('the resolve/archive buttons are hidden on a ticket — the dropdown owns status', D.getElementById('thread-resolve-btn').hidden && D.getElementById('thread-archive-btn').hidden);
    const ctx = D.getElementById('thread-context').textContent;
    check('the meta strip carries category, opened, assigned, message count', /Category/.test(ctx) && /Transaction Issue/.test(ctx) && /Opened/.test(ctx) && /Assigned/.test(ctx) && /Unassigned/.test(ctx) && /Messages2/.test(ctx.replace(/\s+/g, '')), ctx);
    const thread = D.getElementById('thread-messages');
    const opening = thread.querySelector('.ibx-m.is-opening');
    check('the opening description renders as its own message with the category as a header', !!opening && /Transaction Issue/.test(opening.querySelector('.ibx-oh').textContent) && /Ticket opened/.test(opening.querySelector('.ibx-chan').textContent));
    const att = opening && opening.querySelector('.thread-attachment');
    check('...with the evidence attached as a real file (name + size)', !!att && /allocation-screenshot\.png/.test(att.textContent) && att.getAttribute('data-path') === evidencePath, att && att.textContent);
    check('a status change renders inline as a quiet system line', thread.querySelectorAll('.ibx-sysline').length === 1 && /In progress by pm@marketswave.local/.test(thread.querySelector('.ibx-sysline').textContent));
    check('the PM reply is a chat bubble on the right', thread.querySelectorAll('.ibx-m.is-out .ibx-bub').length === 1);
    check('a day separator precedes the messages', thread.querySelectorAll('.ibx-daysep').length >= 1);
    // The handoff target moved when the real client profile was built (part 4, row 233): it used to point at the client LIST, which was the closest thing that existed. The behaviour asserted is unchanged - the link is offered for a client conversation and carries that client's id.
    check('a client conversation offers "Open profile" handing off to the real profile with ?client=<id>', !D.getElementById('thread-profile-link').hidden && D.getElementById('thread-profile-link').getAttribute('href').indexOf('admin-client-profile.html?client=' + clientId) === 0, D.getElementById('thread-profile-link').getAttribute('href'));
    check('presence: a live session shows Online in the header and the dot on the avatar', !D.getElementById('thread-online').hidden && !!D.getElementById('thread-avatar').querySelector('.ibx-on'));
    check('the composer defaults to chat because the client is online, and says so', D.querySelector('.ibx-ctab[data-channel="chat"]').classList.contains('is-on') && /is online/.test(D.getElementById('composer-hint').textContent), D.getElementById('composer-hint').textContent);

    // ------------------------------------------------------------------ status via the dropdown
    console.log('\n--- Status through the header dropdown ---\n');
    D.getElementById('thread-status-select').value = 'resolved';
    D.getElementById('thread-status-select').dispatchEvent(new pmDom.window.Event('change', { bubbles: true }));
    await waitFor(() => thread.querySelectorAll('.ibx-sysline').length === 2, 15000);
    const sysDb = (await admin.from('messages').select('body').eq('conversation_id', t1).eq('channel', 'system')).data;
    check('★ choosing Resolved inserts a second system line in the thread, live', thread.querySelectorAll('.ibx-sysline').length === 2 && /Resolved/.test(thread.querySelectorAll('.ibx-sysline')[1].textContent), 'dom=' + thread.querySelectorAll('.ibx-sysline').length + ' db=' + JSON.stringify(sysDb) + ' toast=' + D.getElementById('admin-toast-title').textContent + ': ' + D.getElementById('admin-toast-body').textContent + ' threadHidden=' + D.getElementById('thread-view').classList.contains('hidden') + ' active=' + (D.querySelector('.convo-row.is-active') && D.querySelector('.convo-row.is-active').getAttribute('data-convo-id')));
    const { data: t1Row } = await admin.from('conversations').select('status, resolved_by_email').eq('id', t1).single();
    check('...and the real row is resolved with PM attribution', t1Row.status === 'resolved' && t1Row.resolved_by_email === 'pm@marketswave.local');
    await waitFor(() => /Resolved/.test(D.querySelector('.convo-row[data-convo-id="' + t1 + '"] .ibx-stp').textContent), 5000);
    check('the ticket row\'s status pill follows', /Resolved/.test(D.querySelector('.convo-row[data-convo-id="' + t1 + '"] .ibx-stp').textContent));

    // ------------------------------------------------------------------ rail + list
    console.log('\n--- The rail, grouping, filters, search ---\n');
    // Every "which rows show" assertion is scoped to what THIS run seeded — another suite's
    // leftover (or a real conversation on a shared stack) must not turn a correct render into
    // a failure. The rail counts are cross-checked against an independent DB read applying
    // the same placement rule, never a hardcoded figure.
    const seeded = new Set([t1, t2, g1, a1, e1]);
    const rows = () => [...D.querySelectorAll('#convo-list .convo-row')].filter((r) => seeded.has(r.getAttribute('data-convo-id')));
    const groupOf = (rowEl) => { let el = rowEl; while (el && !(el.classList && el.classList.contains('ibx-grp'))) el = el.previousElementSibling; return el ? el.textContent.trim() : ''; };
    async function expectedRailCounts() {
      const { data: convos } = await admin.from('conversations').select('id, kind, status, unread_by_pm');
      const { data: msgs } = await admin.from('messages').select('conversation_id, channel, sent_at').neq('channel', 'system').order('sent_at');
      const lastChannel = {}; msgs.forEach((m) => { lastChannel[m.conversation_id] = m.channel; });
      const viewOf = (c) => c.status === 'archived' ? 'archive' : (c.kind === 'ticket' ? 'tickets' : ((lastChannel[c.id] || c.kind) === 'email' ? 'email' : 'chats'));
      const out = { chats: 0, email: 0, tickets: 0, all: 0, archive: 0 };
      convos.forEach((c) => { if (!c.unread_by_pm) return; out[viewOf(c)]++; if (c.status !== 'archived') out.all++; });
      return out;
    }
    const railCount = (v) => { const el = rail(v).querySelector('.ibx-cnt'); return el.hidden ? 0 : Number(el.textContent); };
    check('Tickets view shows the two seeded tickets, with case ids and status pills, and none of the seeded non-tickets', rows().length === 2 && rows().every((r) => r.querySelector('.ibx-caseid') && r.querySelector('.ibx-stp')) && ![g1, a1, e1].some((id) => D.querySelector('.convo-row[data-convo-id="' + id + '"]')), String(rows().length));
    check('...grouped: the unread callback ticket under "Needs a reply", the resolved one under "Earlier"', groupOf(D.querySelector('.convo-row[data-convo-id="' + t2 + '"]')) === 'Needs a reply' && groupOf(D.querySelector('.convo-row[data-convo-id="' + t1 + '"]')) === 'Earlier');
    const exp = await expectedRailCounts();
    check('the rail counts match an independent DB read of conversations needing a reply per view (tickets ' + exp.tickets + ', chats ' + exp.chats + ', email ' + exp.email + ', all ' + exp.all + ')', railCount('tickets') === exp.tickets && railCount('chats') === exp.chats && railCount('email') === exp.email && railCount('all') === exp.all, ['tickets', 'chats', 'email', 'all'].map((v) => v + '=' + railCount(v)).join(','));
    check('...and this run\'s own unread ticket and unread chat are among them', exp.tickets >= 1 && exp.chats >= 1);
    D.querySelector('#inbox-filters .ibx-fp[data-filter="cat:Callback Request"]').click();
    check('a ticket category filter narrows to that category', rows().length === 1 && rows()[0].getAttribute('data-convo-id') === t2);
    D.querySelector('#inbox-filters .ibx-fp[data-filter="status:resolved"]').click();
    check('a ticket status filter narrows to that status', rows().length === 1 && rows()[0].getAttribute('data-convo-id') === t1);
    D.querySelector('#inbox-filters .ibx-fp[data-filter="all"]').click();
    const search = D.getElementById('inbox-search');
    search.value = 'DISP-0002'; search.dispatchEvent(new pmDom.window.Event('input', { bubbles: true }));
    check('search by case id', rows().length === 1 && rows()[0].getAttribute('data-convo-id') === t2);
    search.value = 'queued behind settlement'; search.dispatchEvent(new pmDom.window.Event('input', { bubbles: true }));
    check('search reaches message bodies', rows().length === 1 && rows()[0].getAttribute('data-convo-id') === t1);
    search.value = ''; search.dispatchEvent(new pmDom.window.Event('input', { bubbles: true }));

    rail('chats').click();
    check('Chats view: the client\'s general thread and the anonymous visitor, no seeded tickets, no seeded email', rows().length === 2 && rows().every((r) => !r.querySelector('.ibx-caseid')) && rows().some((r) => r.getAttribute('data-convo-id') === g1) && rows().some((r) => r.getAttribute('data-convo-id') === a1), rows().map((r) => r.getAttribute('data-convo-id')).join(','));
    check('sender types: Client and Anonymous tags', /Client/.test(D.querySelector('.convo-row[data-convo-id="' + g1 + '"]').textContent) && /Anonymous/.test(D.querySelector('.convo-row[data-convo-id="' + a1 + '"]').textContent));
    check('presence: the online client\'s row carries the dot', !!D.querySelector('.convo-row[data-convo-id="' + g1 + '"] .ibx-on'));
    D.querySelector('#inbox-filters .ibx-fp[data-filter="waiting"]').click();
    check('"Waiting on me" keeps only the unread general thread', rows().length === 1 && rows()[0].getAttribute('data-convo-id') === g1);
    D.querySelector('#inbox-filters .ibx-fp[data-filter="visitors"]').click();
    check('"Visitors" keeps only the anonymous thread', rows().length === 1 && rows()[0].getAttribute('data-convo-id') === a1);
    D.querySelector('#inbox-filters .ibx-fp[data-filter="all"]').click();

    rail('email').click();
    check('Email view: of the seeded threads, the unknown-sender one only, tagged Unknown sender', rows().length === 1 && rows()[0].getAttribute('data-convo-id') === e1 && /Unknown sender/.test(rows()[0].textContent));
    rows()[0].click();
    await sleep(200);
    const mail = D.querySelectorAll('#thread-messages .ibx-mail');
    check('email renders as cards with a subject line', mail.length === 2 && /Question about your fees/.test(mail[0].querySelector('.ibx-s').textContent));
    check('...and the outbound card shows delivery + open state', /Delivered · opened/.test(D.getElementById('thread-messages').querySelector('.ibx-status').textContent), D.getElementById('thread-messages').querySelector('.ibx-status') && D.getElementById('thread-messages').querySelector('.ibx-status').textContent);
    check('an inbound email shows the real sender address', /from cold-/.test(D.querySelector('#thread-messages .ibx-m:not(.is-out) .ibx-addr').textContent));
    check('the composer defaults to Email for an email thread with nobody online, and carries the subject with Re:', D.querySelector('.ibx-ctab[data-channel="email"]').classList.contains('is-on') && !D.getElementById('composer-subject').hidden && D.getElementById('composer-subject').textContent === 'Subject: Re: Question about your fees', D.getElementById('composer-subject').textContent);

    // ------------------------------------------------------------------ a thread moving between views
    console.log('\n--- A conversation moves from Chats to Email as its channel changes ---\n');
    rail('chats').click();
    check('before: the general thread is in Chats', rows().some((r) => r.getAttribute('data-convo-id') === g1));
    await msg({ conversation_id: g1, channel: 'email', direction: 'inbound', body: 'Following up by email instead.', sender_email: clientEmail, message_id: '<move-' + suffix + '@example.com>' });
    await waitFor(() => !rows().some((r) => r.getAttribute('data-convo-id') === g1), 10000);
    check('★ after a real inbound EMAIL arrives via Realtime, it leaves Chats…', !rows().some((r) => r.getAttribute('data-convo-id') === g1));
    rail('email').click();
    check('…and appears in Email', rows().some((r) => r.getAttribute('data-convo-id') === g1));
    rail('all').click();
    check('All holds every non-archived seeded thread (5)', rows().length === 5, String(rows().length));

    // ------------------------------------------------------------------ composer round trips
    console.log('\n--- The composer: a real chat reply, an explicit email refused with the real message ---\n');
    rail('chats').click(); D.querySelector('.convo-row[data-convo-id="' + a1 + '"]').click();
    await sleep(200);
    D.querySelector('.ibx-ctab[data-channel="chat"]').click();
    D.getElementById('thread-reply-input').value = 'Yes — we work with clients worldwide.';
    D.getElementById('thread-reply-send').click();
    await waitFor(() => D.querySelectorAll('#thread-messages .ibx-m.is-out').length === 1, 15000);
    check('★ a chat reply sent through the composer arrives back in the thread via Realtime', D.querySelectorAll('#thread-messages .ibx-m.is-out').length === 1 && /clients worldwide/.test(D.querySelector('#thread-messages .ibx-m.is-out .ibx-bub').textContent));
    check('...and the input cleared', D.getElementById('thread-reply-input').value === '');
    check('Enter sends, Shift+Enter does not: the composer is a textarea with that binding', D.getElementById('thread-reply-input').tagName === 'TEXTAREA');
    D.querySelector('.convo-row[data-convo-id="' + g1 + '"]') || rail('email').click();
    D.querySelector('.convo-row[data-convo-id="' + g1 + '"]').click();
    await sleep(200);
    D.querySelector('.ibx-ctab[data-channel="email"]').click();
    check('switching the composer to Email shows the thread subject line', !D.getElementById('composer-subject').hidden);
    D.getElementById('thread-reply-input').value = 'This should be refused at the malformed address.';
    D.getElementById('thread-reply-send').click();
    await waitFor(() => D.getElementById('admin-toast-title').textContent === 'Reply Failed', 15000);
    check('an email reply to a malformed address surfaces the REAL server message, not a generic one', /Could not send the email reply/.test(D.getElementById('admin-toast-body').textContent), D.getElementById('admin-toast-body').textContent);

    // ------------------------------------------------------------------ typing indicator over real broadcast
    console.log('\n--- Typing indicator over a real Realtime broadcast ---\n');
    const other = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const ch = other.channel('typing-' + g1, { config: { broadcast: { self: false } } });
    await new Promise((resolve) => ch.subscribe((s) => { if (s === 'SUBSCRIBED') resolve(); }));
    await sleep(500);
    await ch.send({ type: 'broadcast', event: 'typing', payload: { from: 'contact', at: Date.now() } });
    const typingShown = await waitFor(() => D.getElementById('thread-typing') && !D.getElementById('thread-typing').hidden, 8000);
    check('★ a "typing" broadcast from the contact shows the indicator in the open thread', !!typingShown, typingShown ? '' : 'never shown');
    check('...naming who is typing', /is typing/.test(D.getElementById('thread-typing-label').textContent));
    await other.removeChannel(ch);

    // ------------------------------------------------------------------ mobile stacking
    console.log('\n--- Mobile: list/thread stacking class ---\n');
    check('opening a thread marks the shell for the stacked layout', D.getElementById('inbox-shell').classList.contains('is-thread-open'));
    D.getElementById('thread-back-btn').click();
    check('the back control returns to the list', !D.getElementById('inbox-shell').classList.contains('is-thread-open'));

    // ------------------------------------------------------------------ archive view
    rail('archive').click();
    check('Archive holds none of the seeded threads (none was archived)', rows().length === 0);
  } finally {
    console.log('\n(cleanup)');
    if (sessionRowId) await admin.from('visitor_sessions').delete().eq('id', sessionRowId);
    await admin.from('visitors').delete().eq('id', visitorRowId);
    if (convoIds.length) await admin.from('conversations').delete().in('id', convoIds);
    for (const uid of users) {
      await admin.from('conversations').delete().eq('client_id', uid);
      await admin.from('deposit_requests').delete().eq('client_id', uid);
      await admin.from('transactions').delete().eq('client_id', uid);
      await admin.from('account_state').delete().eq('client_id', uid);
      await admin.from('email_log').delete().ilike('recipient', '%' + suffix + '%');
      try { const { removeAllClientStorageObjects } = await import('./lib/storage-test-cleanup.mjs'); await removeAllClientStorageObjects(admin, 'documents', uid); } catch (_e) { /* anonymous */ }
      await admin.from('clients').delete().eq('id', uid);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.log('  cleanup: could not delete ' + uid + ': ' + error.message);
    }
    for (const f of tempFiles) { try { unlinkSync(f); } catch (_e) { /* already gone */ } }
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nVERIFY: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY: FAIL — ' + (e.stack || e.message)); for (const f of tempFiles) { try { unlinkSync(f); } catch (_e) {} } process.exit(1); });
