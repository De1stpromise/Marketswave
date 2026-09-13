#!/usr/bin/env node
// ★ Visitor presence (2026-09-13) — end-to-end verification in TWO real browsers.
//
// A real second browser (its own headless Chrome, its own cookie jar) loads the real public
// site; the real PM tool in the other browser sees it appear as live presence — through the
// real site-presence.js beacon, the real track-visit function, the real Realtime
// subscription and the real admin-presence.html page — and sees it leave when the visitor's
// tab is closed. Then the PM messages that visitor from the real compose panel: the 30-second
// rule holds the button with a visible countdown, the send creates a real conversation, the
// visitor's real widget opens with the message, their reply lands inbound in the same thread
// and appears in the real admin inbox. The browser-notification permission flow is driven
// through the real page (CDP grants the permission the way a click on "Allow" would) and a
// real arrival then produces a real Notification (recorded through an injected stub, since
// headless Chrome has no notification tray). Contrast on every text surface of the page and
// the open compose modal, fonts (Inter only, tabular figures), and 1440/390/375 + a real
// 320px iframe.
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
async function pollUntil(fn, ms, step) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(step || 300); } return fn(); }

async function connectChrome(port, prefix, extraArgs) {
  const profile = makeTempDir(prefix);
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars'].concat(extraArgs || []).concat(['about:blank']), { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + port);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + String((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + ((r.exceptionDetails.exception || {}).description || '') + ' :: ' + expr.slice(0, 120));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  trackChild(profile, chrome, ws);
  return { send, evaluate, errors, chrome, close: () => releaseTempDir(profile), kill: () => { try { chrome.kill(); } catch (_e) { /* already gone */ } } };
}

function runContrast(profile, label, bootstrap, prepare, port) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8',
    env: Object.assign({}, process.env, { CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/admin-presence.html', CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare, CONTRAST_SETTLE_MS: '5000', CONTRAST_PORT: String(port) })
  });
  forwardChildTeardown(res, 'verify-contrast');
  const out = (res.stdout || '') + (res.stderr || '');
  const tail = out.trim().split('\n').slice(-2).join(' | ');
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + tail);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  out.split('\n').filter((l) => /FAIL\s+\d/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}
function runFonts(label, bootstrap) {
  const res = spawnSync(process.execPath, ['audit-fonts.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', env: Object.assign({}, process.env, { AUDIT_URL: BASE + '/admin-presence.html', AUDIT_BOOTSTRAP_JS: bootstrap }) });
  forwardChildTeardown(res, 'audit-fonts');
  const out = (res.stdout || '') + (res.stderr || '');
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family anywhere', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}

const WAIT_PRESENCE = '(async()=>{for(let i=0;i<120;i++){const l=document.getElementById("presence-list");if(l&&(l.querySelector("table")||/Nobody on the site|No sessions|No client/.test(l.textContent))&&document.getElementById("st-live").textContent!=="—")return true;await new Promise(r=>setTimeout(r,250));}return false;})()';

async function main() {
  console.log('Visitor presence — two real browsers, end to end\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: pmSess, error: pmErr } = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('PM sign-in: ' + pmErr.message);
  const pmBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(pmSess.session)) + '); localStorage.removeItem("mw_presence_mute"); true';
  const shotsDir = process.env.VP_SHOTS || null;
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  async function shot(cdp, name) { if (!shotsDir) return; const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shotsDir + '/' + name + '.png', Buffer.from(r.data, 'base64')); }

  const sessionsBefore = (await admin.from('visitor_sessions').select('id')).data.map((r) => r.id);
  const visitorsBefore = (await admin.from('visitors').select('id')).data.map((r) => r.id);
  const convosBefore = (await admin.from('conversations').select('id')).data.map((r) => r.id);
  const usersBefore = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.map((u) => u.id);
  let visitor = null, pm = null;
  try {
    // ============================================================================
    console.log('=== A real second browser appears as live presence, and leaves ===\n');
    // ============================================================================
    pm = await connectChrome(9461, 'mw-vp-pm-');
    // A recording stub for Notification: headless Chrome has no tray, so the real call is
    // captured rather than displayed. Permission itself is the browser's real state.
    await pm.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__notifs=[];const _N=window.Notification;window.Notification=function(t,o){window.__notifs.push({title:t,body:o&&o.body,tag:o&&o.tag});return {onclick:null,close(){}}};window.Notification.requestPermission=function(){return _N.requestPermission()};Object.defineProperty(window.Notification,"permission",{get:()=>_N.permission});' });
    await pm.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await pm.send('Page.navigate', { url: BASE + '/' });
    await pm.evaluate('(async()=>{for(let i=0;i<80;i++){if(location.hostname==="127.0.0.1"&&document.readyState!=="loading")return true;await new Promise(r=>setTimeout(r,100));}return false;})()');
    await pm.evaluate(pmBootstrap);
    await pm.send('Page.navigate', { url: BASE + '/admin-presence.html' });
    await pm.evaluate(WAIT_PRESENCE); // warm-up (cold Edge Functions)
    await pm.send('Page.navigate', { url: BASE + '/admin-presence.html' });
    const ready = await pm.evaluate(WAIT_PRESENCE);
    check('the real admin-presence.html renders for a real PM session', ready === true, JSON.stringify(pm.errors.slice(-5)));
    const permBefore = await pm.evaluate('Notification.permission');
    check('★ no notification permission was requested on load (still "default"), the page asks with a reason instead', permBefore === 'default' && (await pm.evaluate('!document.getElementById("notif-enable").hidden && /each time a visitor arrives/.test(document.getElementById("notif-copy").textContent)')), permBefore);
    const subscribed = await pollUntil(async () => (await pm.evaluate('document.getElementById("realtime-status").textContent')) === 'Live', 15000);
    check('the page\'s Realtime subscription is genuinely SUBSCRIBED ("Live")', subscribed);
    await pm.send('Browser.grantPermissions', { origin: BASE, permissions: ['notifications'] });
    await pm.evaluate('document.getElementById("notif-enable").click()');
    await sleep(500);
    const permAfter = await pm.evaluate('Notification.permission');
    check('★ the permission flow: after the page\'s own "Turn on notifications", the browser reports "granted" and the block says so', permAfter === 'granted' && (await pm.evaluate('document.getElementById("notif-enable").hidden && /notifications are on/.test(document.getElementById("notif-copy").textContent)')), permAfter);
    await shot(pm, '01-presence-empty');
    const liveBefore = await pm.evaluate('Number(document.getElementById("st-live").textContent)');

    // The visitor: a second, independent browser with its own cookies, a Google referrer.
    visitor = await connectChrome(9462, 'mw-vp-visitor-');
    // The beacon is opt-in on a local origin (see site-presence.js): this browser IS the visitor.
    await visitor.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.setItem("mw_presence_local","1")}catch(e){}' });
    await visitor.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await visitor.send('Page.navigate', { url: BASE + '/services.html', referrer: 'https://www.google.com/search?q=wealth+management+stockholm' });
    await sleep(2500);
    const sid = await visitor.evaluate('(async()=>{for(let i=0;i<40;i++){if(window.MarketswavePresence&&window.MarketswavePresence.sessionId())return window.MarketswavePresence.sessionId();await new Promise(r=>setTimeout(r,250));}return null;})()');
    check('the visitor\'s page runs site-presence.js and has a session id', !!sid, JSON.stringify(visitor.errors.slice(-5)));
    const cookie = await visitor.evaluate('document.cookie');
    check('a first-party mw_vid cookie was set (a random uuid, nothing else)', /mw_vid=[0-9a-f-]{36}/.test(cookie) && !/@/.test(cookie), cookie);
    const appeared = await pollUntil(async () => (await pm.evaluate('[...document.querySelectorAll("[data-session]")].some(tr=>tr.dataset.session===' + JSON.stringify(sid) + '&&tr.dataset.live==="1")')), 20000);
    check('★ the visitor appears as LIVE in the PM\'s real page, via Realtime, without a reload', appeared === true);
    const row = await pm.evaluate('(()=>{const tr=[...document.querySelectorAll("[data-session]")].find(tr=>tr.dataset.session===' + JSON.stringify(sid) + ');return tr?{text:tr.textContent.replace(/\\s+/g," "),anon:!!tr.querySelector(".av.is-anon"),dot:!!tr.querySelector(".av .on"),msgBtn:!!tr.querySelector("button[data-message]"),disabled:(tr.querySelector("button[data-message]")||{}).disabled,wait:(tr.querySelector("[data-wait]")||{}).textContent}:null;})()');
    // Locally the visitor's IP is 127.0.0.1, so location is honestly "Unknown location"; the
    // real public IP case is proven by the backend suite. The Google referrer: a browser's
    // default referrer policy sends only the ORIGIN cross-site (and nothing at all from an
    // https search to an http local page), so the search term is genuinely unavailable here
    // — the parser is proven directly by the backend suite; the row shows what the browser
    // actually sent.
    check('the row shows Visitor · Anonymous · First visit, /services, a location line, the device and browser, a duration and page count', row && row.anon && row.dot && /Visitor.*Anonymous/.test(row.text) && /First visit/.test(row.text) && /\/services/.test(row.text) && /Unknown location|[A-Z]{2}/.test(row.text) && /Chrome/.test(row.text) && /\d+m \d+s/.test(row.text) && /1 page/.test(row.text), row && row.text);
    check('★ inside the first 30 seconds the Message button is disabled with a visible "Wait Ns"', row && row.msgBtn && row.disabled === true && /^Wait \d+s$/.test(row.wait || ''), JSON.stringify(row));
    const liveAfter = await pollUntil(async () => (await pm.evaluate('Number(document.getElementById("st-live").textContent)')) >= liveBefore + 1, 10000);
    check('the "On the site now" stat and the live pill count them', liveAfter === true && /on the site now/.test(await pm.evaluate('document.getElementById("live-pill-text").textContent')));
    const sidebarBadge = await pollUntil(async () => { const t = await pm.evaluate('(()=>{const b=document.getElementById("sidebar-presence-count");return b&&!b.classList.contains("hidden")?Number(b.textContent):0;})()'); return t >= 1; }, 10000);
    check('★ the sidebar\'s Presence item shows a live count', sidebarBadge === true);
    const notified = await pollUntil(async () => (await pm.evaluate('window.__notifs.length')) >= 1, 5000);
    const notif = await pm.evaluate('window.__notifs[0]');
    check('★ a real browser Notification fired for the arrival (title names a new visitor, body the page and location, nothing personal)', notified && notif && /New visitor on the site/.test(notif.title) && /\/services/.test(notif.body) && !/@/.test(notif.body), JSON.stringify(notif));
    // Mute: a second arrival must not notify, but must still count.
    await pm.evaluate('document.getElementById("mute-toggle").click()');
    check('mute is persisted', (await pm.evaluate('localStorage.getItem("mw_presence_mute")')) === '1');
    await visitor.evaluate('localStorage.removeItem("mw_session"); true'); // a fresh session for the same visitor
    await visitor.send('Page.navigate', { url: BASE + '/about.html' }); await sleep(2500);
    const sid2 = await visitor.evaluate('(async()=>{for(let i=0;i<40;i++){if(window.MarketswavePresence&&window.MarketswavePresence.sessionId()&&window.MarketswavePresence.sessionId()!==' + JSON.stringify(sid) + ')return window.MarketswavePresence.sessionId();await new Promise(r=>setTimeout(r,250));}return null;})()');
    await pollUntil(async () => (await pm.evaluate('[...document.querySelectorAll("[data-session]")].some(tr=>tr.dataset.session===' + JSON.stringify(sid2) + ')')), 20000);
    const row2 = await pm.evaluate('(()=>{const tr=[...document.querySelectorAll("[data-session]")].find(tr=>tr.dataset.session===' + JSON.stringify(sid2) + ');return tr?tr.textContent.replace(/\\s+/g," "):null;})()');
    check('★ the same cookie starting a new session is "Returning · 2nd visit"', row2 && /Returning · 2nd visit/.test(row2), row2);
    await sleep(800);
    check('★ muted: the second arrival produced NO notification, but IS counted on the page', (await pm.evaluate('window.__notifs.length')) === 1 && (await pm.evaluate('[...document.querySelectorAll("[data-session]")].length')) >= 2);
    await pm.evaluate('document.getElementById("mute-toggle").click()');
    await shot(pm, '02-presence-live');

    // ============================================================================
    console.log('\n=== Proactive chat — the compose panel, the real conversation, the real reply ===\n');
    // ============================================================================
    // Age the session past 30 s (the rule reads started_at; waiting 30 real seconds proves
    // nothing extra), then the countdown on the page reaches zero and the button enables.
    await admin.from('visitor_sessions').update({ started_at: new Date(Date.now() - 40000).toISOString() }).eq('id', sid2);
    await visitor.evaluate('window.MarketswavePresence.heartbeat()');
    const enabled = await pollUntil(async () => (await pm.evaluate('(()=>{const tr=[...document.querySelectorAll("[data-session]")].find(tr=>tr.dataset.session===' + JSON.stringify(sid2) + ');const b=tr&&tr.querySelector("button[data-message]");return !!b&&!b.disabled;})()')), 15000);
    check('after 30 seconds the Message button enables', enabled === true);
    await pm.evaluate('(()=>{const tr=[...document.querySelectorAll("[data-session]")].find(tr=>tr.dataset.session===' + JSON.stringify(sid2) + ');tr.querySelector("button[data-message]").click();})()');
    await sleep(300);
    const modal = await pm.evaluate('(()=>{const g=(id)=>document.getElementById(id).textContent;return {open:!document.getElementById("message-modal").classList.contains("hidden"),page:g("mm-page"),time:g("mm-time"),loc:g("mm-loc"),visit:g("mm-visit"),snips:[...document.querySelectorAll(".snip")].map(b=>b.textContent),text:document.getElementById("mm-text").value,rule:g("mm-rule")};})()');
    check('★ the compose panel shows the context (page, time on site, location, visit number) and three snippets', modal.open && modal.page === '/about' && /\d+m \d+s/.test(modal.time) && modal.visit === '2nd' && modal.snips.length === 3 && modal.text.length > 20 && /One invitation per session/.test(modal.rule), JSON.stringify(modal));
    await shot(pm, '03-compose');
    await pm.evaluate('document.querySelector(".snip[data-snip=minimums]").click()');
    const snipText = await pm.evaluate('document.getElementById("mm-text").value');
    check('a snippet fills the message', /Minimum investments/.test(snipText));
    await pm.evaluate('document.getElementById("mm-text").value = "Hi — I saw you reading about us. Happy to answer anything about how accounts work.";document.getElementById("mm-send").click()');
    const sentOk = await pollUntil(async () => /Message Sent/.test(await pm.evaluate('document.getElementById("admin-toast-title").textContent')) && !(await pm.evaluate('document.getElementById("admin-toast").classList.contains("hidden")')), 15000);
    check('★ the send succeeds through the real page ("Message Sent")', sentOk === true, await pm.evaluate('document.getElementById("mm-error").textContent'));
    const srow = (await admin.from('visitor_sessions').select('invitation_sent_at, conversation_id, invited_by_email').eq('id', sid2).single()).data;
    check('a real conversation was created and the one invitation claimed, attributed to the PM', !!srow.invitation_sent_at && !!srow.conversation_id && srow.invited_by_email === 'pm@marketswave.local', JSON.stringify(srow));
    const openThread = await pollUntil(async () => (await pm.evaluate('(()=>{const tr=[...document.querySelectorAll("[data-session]")].find(tr=>tr.dataset.session===' + JSON.stringify(sid2) + ');return !!(tr&&tr.querySelector("a[href^=\\"admin-inbox.html\\"]"));})()')), 10000);
    check('the row now offers "Open thread" instead of a second Message button', openThread === true);

    // The visitor's widget opens with the PM's message (it rides the next heartbeat).
    const widgetOpen = await pollUntil(async () => (await visitor.evaluate('(()=>{const p=document.getElementById("chat-widget-panel");const inv=document.getElementById("chat-widget-invitation");return !!(p&&p.classList.contains("is-open")&&inv&&/Happy to answer/.test(inv.textContent));})()')), 30000);
    check('★ the visitor\'s real chat widget opens by itself with the PM\'s message', widgetOpen === true, JSON.stringify(visitor.errors.slice(-5)));
    await shot(visitor, '04-visitor-widget');
    await visitor.evaluate('document.getElementById("chat-widget-name").value="Alex Visitor";document.getElementById("chat-widget-email").value="alex-' + crypto.randomBytes(3).toString('hex') + '@test.marketswave.local";document.getElementById("chat-widget-start-btn").click();true');
    const accepted = await pollUntil(async () => (await visitor.evaluate('document.getElementById("chat-widget-footer").style.display==="flex" && document.querySelectorAll("#chat-widget-body .chat-widget-msg-row").length>=1')), 20000);
    check('★ replying with a name and email accepts the invitation: the thread opens showing the PM\'s message', accepted === true, JSON.stringify(visitor.errors.slice(-5)));
    await visitor.evaluate('document.getElementById("chat-widget-input").value="Yes — what is the minimum to start?";document.getElementById("chat-widget-send").click();true');
    const replied = await pollUntil(async () => { const r = await admin.from('messages').select('direction, body').eq('conversation_id', srow.conversation_id).order('sent_at'); return r.data && r.data.length === 2 && r.data[1].direction === 'inbound'; }, 15000);
    check('★ the visitor\'s reply lands INBOUND in the same real conversation', replied === true);
    const convo = (await admin.from('conversations').select('contact_name, contact_email, visitor_auth_id, unread_by_pm').eq('id', srow.conversation_id).single()).data;
    check('...with their name and email now on the thread and unread for the PM', convo.contact_name === 'Alex Visitor' && /@test\.marketswave\.local$/.test(convo.contact_email || '') && !!convo.visitor_auth_id && convo.unread_by_pm === true, JSON.stringify(convo));
    // The PM sees it in the real inbox.
    await pm.send('Page.navigate', { url: BASE + '/admin-inbox.html' });
    const inInbox = await pollUntil(async () => (await pm.evaluate('(()=>{const rows=[...document.querySelectorAll("#convo-list .convo-row, #convo-list [data-conversation-id]")];return rows.some(r=>/Alex Visitor/.test(r.textContent)&&/minimum to start/.test(r.textContent));})()')), 20000);
    check('★ the conversation threads in the real admin inbox with the visitor\'s reply', inInbox === true, await pm.evaluate('document.getElementById("convo-list").textContent.slice(0,300)'));
    await shot(pm, '05-inbox-thread');

    // Leaving: close the visitor's browser — the pagehide beacon ends the session.
    await visitor.evaluate('window.dispatchEvent(new Event("pagehide")); true');
    await sleep(800);
    visitor.kill();
    await pm.send('Page.navigate', { url: BASE + '/admin-presence.html' });
    await pm.evaluate(WAIT_PRESENCE);
    const gone = await pollUntil(async () => !(await pm.evaluate('[...document.querySelectorAll("[data-session]")].some(tr=>tr.dataset.session===' + JSON.stringify(sid2) + '&&tr.dataset.live==="1")')), 15000);
    const ended = (await admin.from('visitor_sessions').select('ended_at').eq('id', sid2).single()).data;
    check('★ closing the visitor\'s browser ends the session (leave beacon → ended_at) and it disappears from Live', gone === true && !!ended.ended_at, JSON.stringify(ended));
    await pm.evaluate('document.querySelector("[data-tab=week]").click()');
    const inHistory = await pollUntil(async () => (await pm.evaluate('[...document.querySelectorAll("[data-session]")].some(tr=>tr.dataset.session===' + JSON.stringify(sid2) + '&&tr.dataset.live==="0")')), 10000);
    check('...but stays in the rolling history under Last 7 days, marked left', inHistory === true);

    // ============================================================================
    console.log('\n=== Contrast, fonts, widths ===\n');
    // ============================================================================
    // A seeded live client session and an anonymous one keep both tag colours and the wait
    // note on screen for the measurement (their heartbeats are refreshed just before).
    const { data: cu } = await admin.auth.admin.createUser({ email: 'vp-client-' + crypto.randomBytes(3).toString('hex') + '@test.marketswave.local', password: 'VerifyPresenceVisual-2026!', email_confirm: true });
    await admin.from('clients').insert({ id: cu.user.id, name: 'Marta Visual', email: cu.user.email, phone: '+1', account_type: 'Individual Account', status: 'active' });
    const vA = crypto.randomUUID(), sA = crypto.randomUUID(), vB = crypto.randomUUID(), sB = crypto.randomUUID();
    await admin.from('visitors').insert([{ id: vA, visit_count: 1 }, { id: vB, visit_count: 3 }]);
    const seedRows = () => [
      { id: sA, visitor_id: vA, visit_number: 1, client_id: cu.user.id, client_name: 'Marta Visual', started_at: new Date(Date.now() - 500000).toISOString(), last_seen_at: new Date().toISOString(), current_path: '/asset-performance', journey: [{ p: '/dashboard', t: new Date().toISOString() }, { p: '/deploy-capital', t: new Date().toISOString() }, { p: '/asset-performance', t: new Date().toISOString() }], page_count: 3, country_code: 'SE', country: 'Sweden', city: 'Stockholm', device: 'Mac', browser: 'Chrome', referrer_label: 'Direct' },
      { id: sB, visitor_id: vB, visit_number: 3, client_id: null, client_name: null, started_at: new Date(Date.now() - 5000).toISOString(), last_seen_at: new Date().toISOString(), current_path: '/signup', journey: [{ p: '/', t: new Date().toISOString() }, { p: '/about', t: new Date().toISOString() }, { p: '/signup', t: new Date().toISOString() }], page_count: 3, country_code: 'GB', country: 'United Kingdom', city: 'London', device: 'Windows', browser: 'Edge', referrer_label: 'LinkedIn' }
    ];
    const { error: seedErr } = await admin.from('visitor_sessions').insert(seedRows());
    if (seedErr) throw new Error('seed: ' + seedErr.message);
    // A contrast run outlasts the 45-second live window, and a row flipping to "left"
    // mid-run rebuilds the table under the sampler — the seeded rows' last heartbeat is set
    // ten minutes AHEAD so they stay live for the whole run; the wait note is kept on screen
    // the same way (a session that started 5 s ago, re-seeded before each run).
    const refresh = async () => { const ahead = new Date(Date.now() + 10 * 60000).toISOString(); await admin.from('visitor_sessions').update({ last_seen_at: ahead, started_at: new Date(Date.now() - 5000).toISOString() }).eq('id', sB); await admin.from('visitor_sessions').update({ last_seen_at: ahead }).eq('id', sA); };
    await refresh();
    runContrast('visitor-presence', 'presence page', pmBootstrap, WAIT_PRESENCE, 9463);
    await refresh();
    await admin.from('visitor_sessions').update({ started_at: new Date(Date.now() - 400000).toISOString() }).eq('id', sB);
    const OPEN_MODAL = '(async()=>{const ok=await ' + WAIT_PRESENCE + ';if(!ok)return false;const b=document.querySelector("button[data-message]:not(:disabled)");if(!b)return false;b.click();await new Promise(r=>setTimeout(r,400));return !document.getElementById("message-modal").classList.contains("hidden");})()';
    runContrast('visitor-presence-modal', 'compose modal', pmBootstrap, OPEN_MODAL, 9464);
    await refresh();
    runFonts('admin-presence.html', pmBootstrap);

    for (const width of [1440, 390, 375]) {
      await refresh();
      await pm.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
      await pm.send('Page.navigate', { url: BASE + '/admin-presence.html' });
      await pm.evaluate(WAIT_PRESENCE);
      await sleep(500);
      const real = await pm.evaluate('document.documentElement.clientWidth');
      check(width + 'px: the browser genuinely reports that width', real === width, 'got ' + real);
      const g = await pm.evaluate('(()=>{const rows=[...document.querySelectorAll("#presence-list tr[data-session]")];const tr=rows[0];const cs=tr?getComputedStyle(tr).display:null;const stats=[...document.querySelectorAll("#stat-strip > div")].map(d=>{const r=d.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right}});const right=Math.max(...[...document.querySelectorAll("#presence-list *")].map(e=>e.getBoundingClientRect().right));return {inner:innerWidth,bodyScroll:document.body.scrollWidth,rows:rows.length,rowDisplay:cs,stats,maxRight:right,btn:[...document.querySelectorAll("button[data-message], .tab-pill")].map(b=>Math.round(b.getBoundingClientRect().height))};})()');
      check(width + 'px: no horizontal overflow', g.bodyScroll <= g.inner + 1, JSON.stringify({ bodyScroll: g.bodyScroll, inner: g.inner }));
      check(width + 'px: rows rendered', g.rows >= 2, String(g.rows));
      if (width >= 1024) {
        check(width + 'px: the stat strip is four across and rows are table rows', g.stats.length === 4 && g.stats.every((s) => Math.abs(s.t - g.stats[0].t) < 2) && g.rowDisplay === 'table-row', JSON.stringify(g.stats));
      } else {
        check(width + 'px: the stat strip wraps to two columns and each row becomes a card (mw-card-table)', g.stats.length === 4 && Math.abs(g.stats[0].t - g.stats[1].t) < 2 && g.stats[2].t > g.stats[0].t + 10 && g.rowDisplay !== 'table-row', JSON.stringify({ stats: g.stats, rowDisplay: g.rowDisplay }));
        check(width + 'px: nothing in the list escapes the viewport', g.maxRight <= g.inner + 1, String(g.maxRight));
        check(width + 'px: tabs and Message buttons meet the 44px floor', g.btn.every((h) => h >= 44), JSON.stringify(g.btn));
      }
      await shot(pm, '06-layout-' + width);
    }
    // 320px via a real same-origin iframe (the top-level override floors at 348px on this build).
    await refresh();
    await pm.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: true });
    await pm.send('Page.navigate', { url: BASE + '/' }); await sleep(1200);
    const narrow = await pm.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 80 && !document.body; i++) await nap(100);
      const f = document.createElement('iframe'); f.style.cssText = 'width:320px;height:900px;border:0'; f.src = '/admin-presence.html'; document.body.appendChild(f);
      await new Promise(r => f.addEventListener('load', r));
      const d = f.contentDocument, w = f.contentWindow;
      for (let i = 0; i < 120; i++) { const l = d.getElementById('presence-list'); if (l && l.querySelector('table')) break; await nap(250); }
      const rows = [...d.querySelectorAll('#presence-list tr[data-session]')];
      const right = Math.max(...[...d.querySelectorAll('#presence-list *')].map(e => e.getBoundingClientRect().right));
      return { reported: d.documentElement.clientWidth, inner: w.innerWidth, bodyScroll: d.body.scrollWidth, rows: rows.length, maxRight: right, rowDisplay: rows[0] ? w.getComputedStyle(rows[0]).display : null };
    })()`);
    check('320px: the iframe genuinely reports 320px', narrow.reported === 320, JSON.stringify(narrow));
    check('320px: rows render as cards, no horizontal overflow, nothing escapes', narrow.rows >= 2 && narrow.rowDisplay !== 'table-row' && narrow.bodyScroll <= narrow.inner + 1 && narrow.maxRight <= narrow.inner + 1, JSON.stringify(narrow));
    await admin.from('clients').delete().eq('id', cu.user.id);
    await admin.auth.admin.deleteUser(cu.user.id);
  } finally {
    if (visitor) { visitor.kill(); await visitor.close(); }
    if (pm) await pm.close();
    // Everything the two browsers created: sessions, visitors, the conversation, the
    // anonymous auth user the widget signed in as.
    const sessionsNow = (await admin.from('visitor_sessions').select('id, conversation_id')).data;
    const newSessions = sessionsNow.filter((r) => sessionsBefore.indexOf(r.id) === -1);
    const visitorsNow = (await admin.from('visitors').select('id')).data.map((r) => r.id).filter((id) => visitorsBefore.indexOf(id) === -1);
    if (newSessions.length) await admin.from('visitor_sessions').delete().in('id', newSessions.map((r) => r.id));
    if (visitorsNow.length) await admin.from('visitors').delete().in('id', visitorsNow);
    const convosNow = (await admin.from('conversations').select('id')).data.map((r) => r.id).filter((id) => convosBefore.indexOf(id) === -1);
    if (convosNow.length) await admin.from('conversations').delete().in('id', convosNow);
    const usersNow = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) => usersBefore.indexOf(u.id) === -1);
    for (const u of usersNow) { const { error } = await admin.auth.admin.deleteUser(u.id); if (error) console.error('CLEANUP: ' + error.message); }
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch((err) => { console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err)); console.error(err && err.stack); process.exit(1); });
