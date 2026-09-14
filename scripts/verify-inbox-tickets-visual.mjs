#!/usr/bin/env node
// verify-inbox-tickets-visual.mjs — the rebuilt PM inbox: contrast on real composited pixels,
// fonts by real advance width, and 1440 / 390 / 375 / a real 320px iframe (2026-09-14).
//
//   npm run verify-inbox-tickets-visual      (from scripts/)
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
//
// Delegates contrast and fonts to verify-contrast.mjs / audit-fonts.mjs through their own
// CONTRAST_PROFILE / CONTRAST_BOOTSTRAP_JS / CONTRAST_PREPARE_JS hooks — the same delegation
// every visual suite since row 188 uses — with a real admin session seeded into
// localStorage under the admin client's own storageKey. Widths are exact top-level viewports
// (viewport-integrity guarded) plus a real same-origin iframe for 320px, since the
// top-level override floors at 348px on this build (row 170).
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'InboxVisual-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9447;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

function runContrast(profile, page, label, bootstrap, prepare) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8',
    env: Object.assign({}, process.env, { CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/' + page, CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare || '', CONTRAST_SETTLE_MS: '25000', CONTRAST_PORT: '9337' })
  });
  forwardChildTeardown(res, 'verify-contrast');
  const out = (res.stdout || '') + (res.stderr || '');
  const tail = out.trim().split('\n').slice(-2).join(' | ');
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + tail);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  out.split('\n').filter((l) => /FAIL\s+\d|UNMEASURED\s/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}
function runFonts(page, label, bootstrap) {
  const res = spawnSync(process.execPath, ['audit-fonts.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8',
    env: Object.assign({}, process.env, { AUDIT_URL: BASE + '/' + page, AUDIT_BOOTSTRAP_JS: bootstrap })
  });
  forwardChildTeardown(res, 'audit-fonts');
  const out = (res.stdout || '') + (res.stderr || '');
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family anywhere — the scheme is Inter (row 192)', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}

async function connectChrome() {
  const profile = makeTempDir('mw-inboxvis-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250);
    } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  return { send, evaluate, close: () => releaseTempDir(profile) };
}

// Waits for the inbox to be live with rows, then reports geometry the width checks need.
const MEASURE = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200; i++) { if (document.querySelectorAll('#convo-list .convo-row').length > 0 && document.getElementById('realtime-status').textContent === 'Live') break; await nap(200); }
  document.querySelector('#inbox-rail .ibx-rb[data-view="all"]').click();
  await nap(600);
  const shell = document.getElementById('inbox-shell');
  const rail = document.querySelector('.ibx-rail');
  const list = document.querySelector('.ibx-list');
  const thread = document.querySelector('.ibx-thread');
  const r = (el) => el ? el.getBoundingClientRect() : null;
  const railR = r(rail), listR = r(list), threadR = r(thread);
  const rows = [...document.querySelectorAll('#convo-list .convo-row')];
  const maxRowRight = rows.length ? Math.max(...rows.map(x => x.getBoundingClientRect().right)) : null;
  return {
    inner: window.innerWidth, bodyScroll: document.body.scrollWidth, docScroll: document.documentElement.scrollWidth,
    rows: rows.length,
    railHorizontal: railR ? railR.width > railR.height : null,
    railW: railR ? Math.round(railR.width) : null,
    listVisible: !!listR && listR.width > 0 && getComputedStyle(list).display !== 'none',
    threadVisible: !!threadR && threadR.width > 0 && getComputedStyle(thread).display !== 'none',
    listW: listR ? Math.round(listR.width) : null, threadW: threadR ? Math.round(threadR.width) : null,
    maxRowRight, listRight: listR ? Math.round(listR.right) : null,
    threadOpen: shell.classList.contains('is-thread-open')
  };
})()`;

const OPEN_FIRST_ROW = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  document.querySelector('#convo-list .convo-row').click();
  await nap(600);
  const shell = document.getElementById('inbox-shell');
  const list = document.querySelector('.ibx-list');
  const thread = document.querySelector('.ibx-thread');
  const msgs = [...document.querySelectorAll('#thread-messages .ibx-m')];
  const ta = document.getElementById('thread-reply-input');
  const send = document.getElementById('thread-reply-send');
  return {
    threadOpen: shell.classList.contains('is-thread-open'),
    listVisible: getComputedStyle(list).display !== 'none',
    threadVisible: getComputedStyle(thread).display !== 'none',
    bodyScroll: document.body.scrollWidth, inner: window.innerWidth,
    maxMsgRight: msgs.length ? Math.max(...msgs.map(m => m.getBoundingClientRect().right)) : null,
    taRight: ta ? ta.getBoundingClientRect().right : null,
    sendH: send ? Math.round(send.getBoundingClientRect().height) : null,
    backVisible: getComputedStyle(document.getElementById('thread-back-btn')).display !== 'none'
  };
})()`;

const NARROW_EXPR = (query) => `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 80 && !document.body; i++) await nap(100);
  const f = document.createElement('iframe');
  f.style.cssText = 'width:320px;height:900px;border:0';
  f.src = '/admin-inbox.html' + ${JSON.stringify(query)};
  document.body.appendChild(f);
  await new Promise(r => f.addEventListener('load', r));
  const d = f.contentDocument, w = f.contentWindow;
  for (let i = 0; i < 200; i++) { if (d.querySelectorAll('#convo-list .convo-row').length > 0) break; await nap(250); }
  await nap(600);
  const rows = [...d.querySelectorAll('#convo-list .convo-row')];
  const before = { bodyScroll: d.body.scrollWidth, rows: rows.length, railHorizontal: (() => { const r = d.querySelector('.ibx-rail').getBoundingClientRect(); return r.width > r.height; })() };
  rows[0].click();
  await nap(600);
  const msgs = [...d.querySelectorAll('#thread-messages .ibx-m')];
  return {
    reported: d.documentElement.clientWidth, inner: w.innerWidth,
    before,
    afterBodyScroll: d.body.scrollWidth,
    threadOpen: d.getElementById('inbox-shell').classList.contains('is-thread-open'),
    listHidden: getComputedStyle(d.querySelector('.ibx-list')).display === 'none',
    maxMsgRight: msgs.length ? Math.max(...msgs.map(m => m.getBoundingClientRect().right)) : null,
    taRight: d.getElementById('thread-reply-input').getBoundingClientRect().right
  };
})()`;

async function main() {
  console.log('PM tool revamp, part 1 — the inbox: visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const users = []; const convoIds = []; const visitorRowId = crypto.randomUUID(); let sessionRowId = null;

  try {
    // ---- seed: one client with a ticket + a chat thread, an anonymous thread, an email thread
    const { data: cu } = await admin.auth.admin.createUser({ email: 'inboxvis-' + suffix + '@test.marketswave.local', password: PASSWORD, email_confirm: true });
    const clientId = cu.user.id; users.push(clientId);
    const clientEmail = 'inboxvis-malformed-' + suffix;
    await admin.from('clients').insert({ id: clientId, name: 'Manuel Stormare', email: clientEmail, phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 25000, allocated_capital: 0, asset_returns: 0 });
    await admin.from('deposit_requests').insert({ client_id: clientId, method: 'bank', requested_amount: 5000, currency: 'USD', details: {}, status: 'pending' });
    const evidenceBytes = Buffer.from('evidence ' + suffix);
    const evidencePath = clientId + '/uploads/' + crypto.randomUUID() + '/allocation-screenshot.png';
    const cs = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await cs.auth.signInWithPassword({ email: 'inboxvis-' + suffix + '@test.marketswave.local', password: PASSWORD });
    await cs.storage.from('documents').upload(evidencePath, evidenceBytes, { contentType: 'image/png' });
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    async function convo(row) { const { data, error } = await admin.from('conversations').insert(row).select('id').single(); if (error) throw new Error(error.message); convoIds.push(data.id); return data.id; }
    async function msg(row) { const { error } = await admin.from('messages').insert(row); if (error) throw new Error(error.message); }
    const t1 = await convo({ client_id: clientId, contact_email: clientEmail, contact_name: 'Manuel Stormare', kind: 'ticket', category: 'Transaction Issue', display_id: 'DISP-0003', subject: 'DISP-0003 · Transaction Issue', status: 'in_progress', created_at: ago(30) });
    await msg({ conversation_id: t1, channel: 'chat', direction: 'inbound', body: 'My BTC allocation from 9 September is still showing as pending. The deposit that funded it was credited two days ago, so I expected it to have gone through by now. Reference DEP-0147 if that helps.', sender_email: clientEmail, sent_at: ago(30), attachment_path: evidencePath, attachment_name: 'allocation-screenshot.png', attachment_size: 412 * 1024 });
    await msg({ conversation_id: t1, channel: 'system', direction: 'outbound', body: 'Status changed to In progress by pm@marketswave.local', sender_email: 'pm@marketswave.local', sent_at: ago(29) });
    await msg({ conversation_id: t1, channel: 'chat', direction: 'outbound', body: 'Thanks Manuel — I can see it. The allocation is queued behind the deposit\'s settlement window rather than stuck.', sender_name: 'Portfolio Manager', sender_email: 'pm@marketswave.local', sent_at: ago(28) });
    await msg({ conversation_id: t1, channel: 'chat', direction: 'inbound', body: 'Still showing pending this morning — has it cleared on your side?', sender_email: clientEmail, sent_at: ago(0.2) });
    const t2 = await convo({ client_id: clientId, contact_email: clientEmail, contact_name: 'Manuel Stormare', kind: 'ticket', category: 'Billing/Fees', display_id: 'DISP-0004', subject: 'DISP-0004 · Billing/Fees', status: 'resolved', created_at: ago(72), resolved_by_email: 'pm@marketswave.local', resolved_at: ago(70) });
    await msg({ conversation_id: t2, channel: 'chat', direction: 'inbound', body: 'Thanks, all sorted.', sender_email: clientEmail, sent_at: ago(72) });
    await admin.from('conversations').update({ unread_by_pm: false }).eq('id', t2);
    const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonData } = await anon.auth.signInAnonymously(); users.push(anonData.user.id);
    const a1 = await convo({ visitor_auth_id: anonData.user.id, contact_email: 'visitor-' + suffix + '@example.com', contact_name: 'Visitor', kind: 'chat', status: 'open', created_at: ago(0.3) });
    await msg({ conversation_id: a1, channel: 'chat', direction: 'inbound', body: 'Do you take clients outside the EU?', sender_email: 'visitor-' + suffix + '@example.com', sent_at: ago(0.15) });
    const e1 = await convo({ contact_email: 'cold-' + suffix + '@example.com', contact_name: 'Sofia Berg', kind: 'email', subject: 'Re: Your deposit has been credited', status: 'open', created_at: ago(20) });
    await msg({ conversation_id: e1, channel: 'email', direction: 'inbound', body: 'Thanks for confirming. Could I get the Q3 statement early — I\'m travelling from the 20th.', sender_name: 'Sofia Berg', sender_email: 'cold-' + suffix + '@example.com', sent_at: ago(20), message_id: '<vis-in-' + suffix + '@example.com>' });
    await msg({ conversation_id: e1, channel: 'email', direction: 'outbound', body: 'Of course — I\'ll have it with you by Thursday.', sender_name: 'Portfolio Manager', sender_email: 'pm@marketswave.local', sent_at: ago(19), message_id: '<vis-out-' + suffix + '@marketswave.net>', resend_id: 're_vis_' + suffix, delivery_status: 'opened', delivered_at: ago(19), opened_at: ago(18) });
    await admin.from('conversations').update({ unread_by_pm: false }).eq('id', e1);
    await admin.from('visitors').insert({ id: visitorRowId, visit_count: 2, first_seen_at: ago(48), last_seen_at: new Date().toISOString() });
    const { data: sess } = await admin.from('visitor_sessions').insert({ id: crypto.randomUUID(), visitor_id: visitorRowId, visit_number: 2, conversation_id: a1, started_at: ago(0.1), last_seen_at: new Date().toISOString(), current_path: '/services', page_count: 2, journey: [], city: 'Stockholm', country: 'Sweden' }).select('id').single();
    sessionRowId = sess.id;
    // Presence: the PM page recounts every 30 s; the seeded session must still read live — a
    // small keep-alive during the run.
    const keepAlive = setInterval(() => { admin.from('visitor_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', sessionRowId).then(() => {}); }, 20000);

    const anonForPm = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const adminSigned = await anonForPm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (adminSigned.error) throw new Error('admin sign-in: ' + adminSigned.error.message);
    const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(adminSigned.data.session)) + '); true';

    console.log('--- Contrast: real composited pixels ---\n');
    const PREPARE_TICKET = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) { if (document.querySelectorAll('#thread-messages .ibx-m').length > 0 && document.querySelectorAll('#convo-list .convo-row').length > 0) break; await nap(200); } await nap(800); })()`;
    runContrast('inbox-ticket', 'admin-inbox.html?c=' + t1, 'ticket thread + tickets list', adminBootstrap, PREPARE_TICKET);
    const PREPARE_EMAIL = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) { if (document.querySelectorAll('#thread-messages .ibx-mail').length > 0) break; await nap(200); } await nap(300); document.querySelector('#inbox-rail .ibx-rb[data-view="all"]').click(); await nap(300); const t = document.getElementById('thread-typing'), l = document.getElementById('thread-typing-label'); if (t) { t.hidden = false; l.hidden = false; l.textContent = 'Sofia is typing…'; } await nap(500); })()`;
    runContrast('inbox-email', 'admin-inbox.html?c=' + e1, 'email thread + all view', adminBootstrap, PREPARE_EMAIL);

    console.log('\n--- Fonts ---\n');
    runFonts('admin-inbox.html?c=' + t1, 'admin-inbox.html', adminBootstrap);

    console.log('\n--- Widths: 1440 / 390 / 375, and a real 320px iframe ---\n');
    const cdp = await connectChrome();
    try {
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(800);
      await cdp.evaluate(adminBootstrap);
      for (const width of [1440, 390, 375]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
        await cdp.send('Page.navigate', { url: BASE + '/admin-inbox.html' });
        await sleep(1500);
        const m = await cdp.evaluate(MEASURE);
        check(width + 'px: the viewport is genuinely ' + width + ' (integrity guard)', m.inner === width, 'inner=' + m.inner);
        check(width + 'px: no horizontal overflow (body)', m.bodyScroll <= width && m.docScroll <= width, 'body=' + m.bodyScroll + ' doc=' + m.docScroll);
        check(width + 'px: rows rendered', m.rows >= 3, String(m.rows));
        if (width >= 1024) {
          check('1440px: three columns — a 78px rail, a 340px list, the thread', !m.railHorizontal && m.railW === 78 && m.listW === 340 && m.threadVisible && m.threadW > 600, JSON.stringify({ railW: m.railW, listW: m.listW, threadW: m.threadW }));
          check('1440px: no row escapes the list column', m.maxRowRight <= m.listRight + 1, m.maxRowRight + ' vs ' + m.listRight);
        } else {
          check(width + 'px: the rail becomes a horizontal strip and only the list shows', m.railHorizontal && m.listVisible && !m.threadVisible && !m.threadOpen, JSON.stringify(m));
          const o = await cdp.evaluate(OPEN_FIRST_ROW);
          check(width + 'px: tapping a row opens the thread in place of the list, with a back control', o.threadOpen && o.threadVisible && !o.listVisible && o.backVisible, JSON.stringify(o));
          check(width + 'px: no message or the composer escapes the viewport', o.bodyScroll <= width && o.maxMsgRight <= width + 1 && o.taRight <= width + 1, JSON.stringify({ bodyScroll: o.bodyScroll, maxMsgRight: o.maxMsgRight, taRight: o.taRight }));
          check(width + 'px: the Send button meets the 44px floor', o.sendH >= 44, String(o.sendH));
        }
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Page.navigate', { url: BASE + '/' });
      await sleep(800);
      const n = await cdp.evaluate(NARROW_EXPR('?c=' + t1));
      check('320px: the iframe genuinely reports 320px', n.reported === 320, JSON.stringify(n));
      check('320px: rows render, the rail is a strip, no overflow before opening a thread', n.before.rows >= 3 && n.before.railHorizontal && n.before.bodyScroll <= 320, JSON.stringify(n.before));
      check('320px: with a thread open, the list hides and nothing escapes the viewport', n.threadOpen && n.listHidden && n.afterBodyScroll <= 320 && n.maxMsgRight <= 321 && n.taRight <= 321, JSON.stringify(n));
    } finally {
      clearInterval(keepAlive);
      await cdp.close();
    }
  } finally {
    console.log('\n(cleanup)');
    if (sessionRowId) await admin.from('visitor_sessions').delete().eq('id', sessionRowId);
    await admin.from('visitors').delete().eq('id', visitorRowId);
    if (convoIds.length) await admin.from('conversations').delete().in('id', convoIds);
    for (const uid of users) {
      await admin.from('conversations').delete().eq('client_id', uid);
      await admin.from('deposit_requests').delete().eq('client_id', uid);
      await admin.from('account_state').delete().eq('client_id', uid);
      try { const { removeAllClientStorageObjects } = await import('./lib/storage-test-cleanup.mjs'); await removeAllClientStorageObjects(admin, 'documents', uid); } catch (_e) { /* anonymous */ }
      await admin.from('clients').delete().eq('id', uid);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.log('  cleanup: could not delete ' + uid + ': ' + error.message);
    }
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nVERIFY: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY: FAIL — ' + (e.stack || e.message)); process.exit(1); });
