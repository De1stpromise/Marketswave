// ★ "On the site" — arrival, departure and visit history (2026-09-28, register row 281).
//
// Seeds one session for EACH of the four departure states, plus a resumed session, a client on
// two devices at once, and sessions 8-30 days old, then drives the real get-visitor-presence
// and the REAL admin-presence.html script against them.
//
// Why seeded rather than observed: three of the four departure states cannot be produced on
// demand from a browser — "unknown" means the beacon did NOT arrive, and waiting for a real
// one to not arrive is not a test. The rows are written in exactly the shape track-visit
// writes them, and the classification under test reads only started_at / last_seen_at /
// ended_at, so a seeded row exercises the identical code path a real one does.
import { createClient } from '@supabase/supabase-js';
import { execSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';
import { makeTempDir, releaseTempDir } from './lib/harness-teardown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SUFFIX = Math.random().toString(16).slice(2, 8);

let passed = 0, failed = 0; const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; fails.push(label + (detail ? '  [' + detail + ']' : '')); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localStack() {
  const raw = execSync('supabase status -o json', { cwd: ROOT, encoding: 'utf8' });
  const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return { url: j.API_URL, anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY };
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60000, DAY = 86400000;

// Section 7 drives a real browser, so it needs the project's own static server on 8765 (the
// same dependency every visual suite has). Chrome's connect() is duplicated here rather than
// shared: there is no CDP helper in lib/ and every other suite rolls its own.
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = 'http://127.0.0.1:8765';

async function connect(profile) {
  const PORT = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250);
    } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const setCookieHeaders = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    // Collected so the "no server writes this cookie" assertion is a real observation of the
    // wire, not an inference from the source.
    if (m.method === 'Network.responseReceivedExtraInfo' && m.params && m.params.headers) {
      for (const k of Object.keys(m.params.headers)) {
        if (k.toLowerCase() === 'set-cookie') setCookieHeaders.push(m.params.headers[k]);
      }
    }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { chrome, ws, send, evaluate, setCookieHeaders };
}

async function main() {
  const { url, anon, service } = localStack();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const pm = createClient(url, anon, { auth: { persistSession: false } });
  const signedIn = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (signedIn.error) throw new Error('admin sign-in: ' + signedIn.error.message);

  const madeVisitors = [], madeSessions = [], madeUsers = [];
  // a valid v4-shaped uuid, unique per run and per index, so cleanup can key on it
  const vid = (n) => SUFFIX + String(n).padStart(2, '0') + '-0000-4000-8000-' + SUFFIX + String(n).padStart(6, '0');
  // Section 7's planted cookie. Declared out here because the opted-in visit it makes is a REAL
  // one: track-visit writes a visitors row and a session under this id, and the session's own id
  // is generated in the browser, so cleanup keys on the visitor instead.
  const COOKIE_VID = vid(8);
  madeVisitors.push(COOKIE_VID);

  try {
    // ---- a real client, so "grouped by person" has a genuine client_id to group on
    const clientEmail = 'presence-history-' + SUFFIX + '@invalid.test';
    const created = await admin.auth.admin.createUser({ email: clientEmail, password: 'Pw!' + SUFFIX + 'aA1', email_confirm: true });
    if (created.error) throw new Error('client user: ' + created.error.message);
    const clientId = created.data.user.id;
    madeUsers.push(clientId);
    await admin.from('clients').insert({ id: clientId, name: 'Presence Fixture ' + SUFFIX, email: clientEmail, account_type: 'Individual Account', status: 'active' });

    // ---- visitors (cookies)
    const cookies = [vid(1), vid(2), vid(3), vid(4), vid(5), vid(6), vid(7)];
    for (const c of cookies) {
      await admin.from('visitors').insert({ id: c, first_seen_at: iso(20 * DAY), last_seen_at: iso(1 * MIN), visit_count: 1 });
      madeVisitors.push(c);
    }

    // ---- one session per departure state, plus the cases the brief names
    const seed = async (row) => {
      const { error } = await admin.from('visitor_sessions').insert(row);
      if (error) throw new Error('seed ' + row.id + ': ' + error.message);
      madeSessions.push(row.id);
    };
    const base = (id, cookie, extra) => Object.assign({
      id, visitor_id: cookie, visit_number: 1, current_path: '/', page_count: 1,
      journey: [{ p: '/', t: extra.started_at }], country_code: 'SE', country: 'Sweden', city: 'Stockholm',
      device: 'Windows', browser: 'Chrome', referrer_label: 'Google', search_term: 'managed wealth account'
    }, extra);

    // ONE timestamp: two iso() calls can land a millisecond apart, and a last_seen_at even 1ms
    // after started_at is 'activity after arrival' — which is exactly the state this row is not.
    const UNSEEN = iso(120 * MIN);
    const S = {
      live:    vid(1), exact:   vid(2), approx:  vid(3), unknown: vid(4),
      resumed: vid(5), devA:    vid(6), devB:    vid(7)
    };
    // live: heartbeat inside the 45 s window, no beacon
    await seed(base(S.live, cookies[0], { started_at: iso(6 * MIN), last_seen_at: iso(5000), ended_at: null, page_count: 3,
      journey: [{ p: '/', t: iso(6 * MIN) }, { p: '/services', t: iso(4 * MIN) }, { p: '/signup', t: iso(5000) }] }));
    // exact: the leave beacon landed
    await seed(base(S.exact, cookies[1], { started_at: iso(70 * MIN), last_seen_at: iso(62 * MIN), ended_at: iso(62 * MIN), page_count: 2,
      journey: [{ p: '/', t: iso(70 * MIN) }, { p: '/about', t: iso(64 * MIN) }] }));
    // approx: heartbeats after arrival, no beacon, long past the live window
    await seed(base(S.approx, cookies[2], { started_at: iso(90 * MIN), last_seen_at: iso(84 * MIN), ended_at: null, page_count: 2,
      journey: [{ p: '/', t: iso(90 * MIN) }, { p: '/resources', t: iso(86 * MIN) }] }));
    // unknown: nothing at all after arrival — last_seen_at === started_at
    await seed(base(S.unknown, cookies[3], { started_at: UNSEEN, last_seen_at: UNSEEN, ended_at: null }));
    // resumed: a beacon was received and then cleared by a later event (track-visit sets
    // ended_at back to null on any page/heartbeat) — so it must read as live, not exact.
    await seed(base(S.resumed, cookies[4], { started_at: iso(40 * MIN), last_seen_at: iso(4000), ended_at: null, page_count: 4,
      journey: [{ p: '/', t: iso(40 * MIN) }, { p: '/login', t: iso(30 * MIN) }, { p: '/dashboard', t: iso(20 * MIN) }, { p: '/settings', t: iso(4000) }] }));
    // one client, two devices, genuinely overlapping in time
    await seed(base(S.devA, cookies[5], { started_at: iso(12 * MIN), last_seen_at: iso(6000), ended_at: null, client_id: clientId,
      client_name: 'Presence Fixture ' + SUFFIX, device: 'Windows', browser: 'Chrome', page_count: 5 }));
    await seed(base(S.devB, cookies[6], { started_at: iso(9 * MIN), last_seen_at: iso(7000), ended_at: null, client_id: clientId,
      client_name: 'Presence Fixture ' + SUFFIX, device: 'iPhone', browser: 'Safari', page_count: 2 }));
    // between 8 and 30 days old: in the month window, outside the week window
    const OLD = SUFFIX + '99-0000-4000-8000-' + SUFFIX + '000099';
    await seed(base(OLD, cookies[0], { started_at: iso(12 * DAY), last_seen_at: iso(12 * DAY - 4 * MIN), ended_at: iso(12 * DAY - 4 * MIN), page_count: 3,
      journey: [{ p: '/', t: iso(12 * DAY) }, { p: '/services', t: iso(12 * DAY - 2 * MIN) }] }));

    const call = async (body) => {
      const { data, error } = await pm.functions.invoke('get-visitor-presence', { body });
      if (error) { const b = await error.context.json().catch(() => ({})); throw new Error(b.error || error.message); }
      return data;
    };

    // ══ 1. the four departure states ═════════════════════════════════════════════════════
    console.log('\n-- departure states --');
    const month = await call({ tab: 'month' });
    const byId = {}; month.sessions.forEach((s) => { byId[s.id] = s; });
    check('GUARD: every seeded session is in the 30-day tab (otherwise the rest is vacuous)',
      [S.live, S.exact, S.approx, S.unknown, S.resumed, S.devA, S.devB, OLD].every((id) => byId[id]),
      Object.keys(byId).length + ' returned');
    check('★ live — heartbeat inside the window, no beacon', byId[S.live] && byId[S.live].departureState === 'live', byId[S.live] && byId[S.live].departureState);
    check('★ exact — the beacon landed, and departureAt IS ended_at',
      byId[S.exact] && byId[S.exact].departureState === 'exact' && byId[S.exact].departureAt === byId[S.exact].endedAt);
    check('★ approx — no beacon, not live, heartbeats after arrival; departureAt is last_seen_at',
      byId[S.approx] && byId[S.approx].departureState === 'approx' && byId[S.approx].departureAt === byId[S.approx].lastSeenAt);
    check('★ approx carries its tolerance, and it is the REAL heartbeat interval (15 s, not the 20 the constant used to claim)',
      byId[S.approx] && byId[S.approx].departureAccuracySeconds === 15, byId[S.approx] && String(byId[S.approx].departureAccuracySeconds));
    check('★ unknown — nothing recorded after arrival', byId[S.unknown] && byId[S.unknown].departureState === 'unknown');
    check('★ unknown reports knownDurationSeconds null, NOT 0 — 0 would read as a measurement',
      byId[S.unknown] && byId[S.unknown].knownDurationSeconds === null && byId[S.unknown].departureAt === null);
    check('★ a RESUMED session reads live, not exact — track-visit clears ended_at on any later event',
      byId[S.resumed] && byId[S.resumed].departureState === 'live' && byId[S.resumed].endedAt === null);

    // ══ 2. the 30-day window ═════════════════════════════════════════════════════════════
    console.log('\n-- the window --');
    const week = await call({ tab: 'week' });
    const inWeek = week.sessions.some((s) => s.id === OLD);
    check('★ a 12-day-old visit appears in the 30-day tab', !!byId[OLD]);
    check('★ ...and NOT in the 7-day tab', !inWeek);
    check('the 7-day tab still returns the recent ones', week.sessions.some((s) => s.id === S.exact));
    check('counts carry a month figure, and it is at least the week figure',
      typeof month.counts.month === 'number' && month.counts.month >= month.counts.week,
      JSON.stringify(month.counts));
    check('retentionDays is 30 — the ceiling the tab and the purge job agree on', month.rules.retentionDays === 30);

    // ══ 3. load: a heartbeat must not refetch 30 days ════════════════════════════════════
    console.log('\n-- payload weight --');
    const live = await call({ tab: 'live' });
    const liveBytes = JSON.stringify(live).length, monthBytes = JSON.stringify(month).length;
    check('★ the live payload is materially smaller than the 30-day one — this is what Realtime now re-reads',
      liveBytes < monthBytes, liveBytes + ' vs ' + monthBytes + ' bytes');
    check('★ no list payload carries a journey — the heaviest column, and no list row renders it',
      month.sessions.every((s) => !s.journey || s.journey.length === 0) && live.sessions.every((s) => !s.journey || s.journey.length === 0));
    const detail = await call({ detail: S.live });
    check('★ the journey IS returned by the detail branch, for one session at a time',
      Array.isArray(detail.journey) && detail.journey.length === 3, detail.journey && String(detail.journey.length));

    // ══ 4. privacy ═══════════════════════════════════════════════════════════════════════
    console.log('\n-- privacy --');
    const blob = JSON.stringify([month, live, detail]);
    check('★ no IPv4 address anywhere in any payload', !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(blob));
    check('★ no IPv6-looking address either', !/\b(?:[0-9a-f]{1,4}:){4,}[0-9a-f]{1,4}\b/i.test(blob));
    check('★ no raw user-agent string — only the parsed device and browser',
      !/Mozilla\/|AppleWebKit|Gecko\/|Chrome\/\d/.test(blob));
    check('★ no invitation_token leaks into a list payload', !/invitationToken|invitation_token/.test(blob));

    // ══ 5. the gate, unchanged ═══════════════════════════════════════════════════════════
    console.log('\n-- the gate --');
    const nonAdminEmail = 'presence-nonadmin-' + SUFFIX + '@invalid.test';
    const na = await admin.auth.admin.createUser({ email: nonAdminEmail, password: 'Pw!' + SUFFIX + 'bB2', email_confirm: true });
    madeUsers.push(na.data.user.id);
    const naC = createClient(url, anon, { auth: { persistSession: false } });
    await naC.auth.signInWithPassword({ email: nonAdminEmail, password: 'Pw!' + SUFFIX + 'bB2' });
    const naRes = await naC.functions.invoke('get-visitor-presence', { body: { tab: 'month' } });
    let naStatus = 0, naMsg = '';
    if (naRes.error) { naStatus = naRes.error.context ? naRes.error.context.status : 0; naMsg = (await naRes.error.context.json().catch(() => ({}))).error || ''; }
    check('★ a signed-in NON-ADMIN is refused 403, exactly as before', naStatus === 403, naStatus + ' ' + naMsg);
    const anonC = createClient(url, anon, { auth: { persistSession: false } });
    const anRes = await anonC.functions.invoke('get-visitor-presence', { body: { tab: 'month' } });
    check('★ no session at all is refused 401', anRes.error && anRes.error.context && anRes.error.context.status === 401);
    const naDetail = await naC.functions.invoke('get-visitor-presence', { body: { detail: S.live } });
    check('★ the new detail branch is behind the SAME gate — a non-admin cannot read a journey',
      naDetail.error && naDetail.error.context && naDetail.error.context.status === 403);

    // ══ 6. grouping, and the cookie, through the REAL page script ════════════════════════
    console.log('\n-- the page --');
    const vc = new VirtualConsole();
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://marketswave.net/admin-presence.html', runScripts: 'outside-only', virtualConsole: vc });
    // the cookie rule, exercised against the real site-presence.js source
    const src = readFileSync(path.join(ROOT, 'site-presence.js'), 'utf8');
    check('★ the cookie lifetime is 30 days, not 400', /COOKIE_DAYS\s*=\s*30/.test(src) && !/400\s*\*\s*86400/.test(src));
    check('★ ...and it is written on EVERY visit, not only when absent — which is what rewrites an old 400-day cookie down',
      !/if \(m\) return m\[1\];/.test(src) && /var id = m \? m\[1\] : uuid\(\);/.test(src));
    // a real 400-day cookie, then the real visitorId() — the id must survive and the Max-Age drop
    dom.window.document.cookie = 'mw_vid=11111111-2222-4333-8444-555555555555; Max-Age=' + (400 * 86400) + '; Path=/';
    const before = dom.window.document.cookie;
    const fnStart = src.indexOf('function visitorId()');
    const fnEnd = src.indexOf('}', src.indexOf('return id;', fnStart)) + 1;
    const fn = src.slice(fnStart, fnEnd);
    dom.window.eval('var COOKIE="mw_vid", COOKIE_DAYS=30; function uuid(){return "99999999-9999-4999-8999-999999999999";} ' + fn + '; var __id = visitorId(); var __set = [];');
    const keptId = dom.window.__id;
    check('★ an existing cookie keeps its id (the visitor is not reset by the shorter lifetime)',
      keptId === '11111111-2222-4333-8444-555555555555', keptId);
    check('the old cookie was present before the call (non-vacuity)', /mw_vid=11111111/.test(before));

    // grouping, through the real render
    const pageSrc = readFileSync(path.join(ROOT, 'admin-presence.html'), 'utf8');
    check('★ grouping keys on client_id for clients and the browser cookie for anonymous visitors',
      /'c:' \+ x\.clientId : 'b:' \+ \(x\.visitorId \|\| x\.id\)/.test(pageSrc));
    check('★ "at once" is only ever claimed for a CLIENT — two browsers of one cookie is one browser',
      /items\[0\]\.clientId \? items\.filter/.test(pageSrc));
    check('★ the anonymous case says so in words, rather than implying cross-device grouping',
      /cannot be followed across devices/.test(pageSrc));
    check('★ Realtime refreshes the live set only, never the heavy tab',
      /reloadTimer = setTimeout\(refreshLive, 400\)/.test(pageSrc) && !/setTimeout\(load, 400\)/.test(pageSrc));
    check('★ the detail branch is called with a session id, not fetched for the list',
      /callFunction\('get-visitor-presence', \{ detail: id \}\)/.test(pageSrc));
    check('times are formatted in the PM\'s own time zone', /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/.test(pageSrc));
    check('the 30-day tab exists between 7 days and Clients only',
      pageSrc.indexOf('data-tab="week"') < pageSrc.indexOf('data-tab="month"') && pageSrc.indexOf('data-tab="month"') < pageSrc.indexOf('data-tab="clients"'));

    // the two overlapping client sessions really do overlap, which is what grouping depends on
    const a = byId[S.devA], b = byId[S.devB];
    check('★ the two client sessions genuinely overlap in time (the grouping case is real, not assumed)',
      a && b && a.clientId === b.clientId && a.id !== b.id &&
      new Date(a.startedAt) < new Date(b.lastSeenAt) && new Date(b.startedAt) < new Date(a.lastSeenAt));
    check('★ ...and they are separate rows from separate cookies — the same person on two devices',
      a && b && a.visitorId !== b.visitorId, a && b ? a.visitorId + ' vs ' + b.visitorId : '');

    // detail: earlier visits scope
    const dClient = await call({ detail: S.devA });
    check('★ a client\'s earlier visits span their devices (groupedBy: client)', dClient.groupedBy === 'client');
    const dAnon = await call({ detail: S.exact });
    check('★ an anonymous visitor\'s earlier visits are from that browser only (groupedBy: browser)', dAnon.groupedBy === 'browser');

    // ══ 7. the cookie's REAL persisted lifetime, and a real heartbeat ════════════════════
    //
    // ★ WHY A REAL BROWSER AND NOT jsdom: jsdom's document.cookie getter returns only
    // name=value pairs and NEVER exposes Max-Age. Section 6 above can therefore prove the id
    // survives a rewrite but cannot prove the lifetime actually dropped from 400 days to 30 —
    // which is the whole claim. It is read from the browser's OWN cookie store over CDP.
    //
    // ★ AND THERE IS NO Set-Cookie HEADER TO READ. mw_vid is written by first-party JS
    // (site-presence.js's visitorId(), via document.cookie), never by a server. That is
    // asserted too, so a change that moved the write server-side is caught rather than
    // quietly satisfying a header-shaped test.
    console.log('\n-- the cookie, in a real browser --');
    const profileDir = makeTempDir('mw-presence-hist-');
    let cdp = null;
    try {
      cdp = await connect(profileDir);
      const getMw = async () => {
        const { cookies: jar } = await cdp.send('Network.getCookies', { urls: [SITE + '/'] });
        return jar.filter((c) => c.name === 'mw_vid');
      };
      const days = (c) => (c.expires - Date.now() / 1000) / 86400;

      // Plant exactly what the shipped code used to write, as a real returning visitor carries.
      await cdp.send('Network.setCookie', { name: 'mw_vid', value: COOKIE_VID, url: SITE + '/', path: '/',
        expires: Math.floor(Date.now() / 1000) + 400 * 86400, sameSite: 'Lax' });
      const planted = await getMw();
      check('NON-VACUITY: the planted cookie really is ~400 days out before the visit',
        planted.length === 1 && days(planted[0]) > 395 && days(planted[0]) < 401,
        planted.length ? days(planted[0]).toFixed(2) + ' days' : 'absent');

      // A local origin without the opt-in must not track at all (README): start() returns
      // before visitorId() is ever reached. This is also the control proving the rewrite below
      // is genuinely caused by the visit rather than by anything this suite did itself.
      await cdp.send('Page.navigate', { url: SITE + '/about.html' });
      await sleep(2500);
      const optedOut = await getMw();
      check('CONTROL: with the local opt-out active the tracker never runs and the cookie is untouched',
        optedOut.length === 1 && days(optedOut[0]) > 395,
        optedOut.length ? days(optedOut[0]).toFixed(2) + ' days' : 'absent');

      await cdp.evaluate('localStorage.setItem("mw_presence_local","1")');
      await cdp.send('Page.navigate', { url: SITE + '/about.html' });
      await sleep(4000);
      const rewritten = await getMw();
      const one = rewritten.length === 1;
      check('★ the REAL persisted cookie lifetime is 30 days, not 400 — read from the browser cookie store',
        one && days(rewritten[0]) > 29.9 && days(rewritten[0]) < 30.01,
        one ? days(rewritten[0]).toFixed(4) + ' days' : rewritten.length + ' cookie(s)');
      check('★ an existing 400-day cookie is genuinely REWRITTEN DOWN by the visit',
        one && days(planted[0]) - days(rewritten[0]) > 360,
        one ? 'dropped ' + (days(planted[0]) - days(rewritten[0])).toFixed(1) + ' days' : 'no cookie');
      check('★ the visitor id SURVIVES the rewrite — a shorter lifetime must never reset the visitor',
        one && rewritten[0].value === COOKIE_VID, one ? rewritten[0].value : 'no cookie');
      check('★ exactly ONE mw_vid cookie — the rewrite replaced the expiry, it did not add a second',
        one, rewritten.length + ' cookie(s)');
      check('the cookie is first-party to this origin, Path=/ and SameSite=Lax',
        one && rewritten[0].path === '/' && rewritten[0].sameSite === 'Lax' && rewritten[0].domain === '127.0.0.1',
        one ? rewritten[0].domain + ' path=' + rewritten[0].path + ' sameSite=' + rewritten[0].sameSite : 'no cookie');

      // Rolling, not fixed from the first visit: 30 days from the LAST visit, which is what
      // keeps a regular visitor recognised for exactly as long as their data survives.
      const firstExpiry = one ? rewritten[0].expires : 0;
      await sleep(3200);
      await cdp.send('Page.navigate', { url: SITE + '/about.html' });
      await sleep(3500);
      const rolled = await getMw();
      const moved = rolled.length === 1 ? rolled[0].expires - firstExpiry : 0;
      check('★ ROLLING: a later visit pushes the expiry forward — 30 days from the LAST visit, never fixed from the first',
        moved >= 3 && moved <= 15, 'expiry moved +' + moved.toFixed(1) + 's across a ~3s gap between visits');
      check('...and it is still ~30 days out, never accumulating',
        rolled.length === 1 && days(rolled[0]) > 29.9 && days(rolled[0]) < 30.01,
        rolled.length === 1 ? days(rolled[0]).toFixed(4) + ' days' : 'no cookie');
      const mwSetCookie = cdp.setCookieHeaders.filter((h) => /mw_vid/.test(h));
      check('★ NO response carried a Set-Cookie for mw_vid — no server writes it, it is first-party JS',
        mwSetCookie.length === 0,
        cdp.setCookieHeaders.length + ' Set-Cookie header(s) seen, ' + mwSetCookie.length + ' naming mw_vid');

      // ---- a real heartbeat must refetch the LIVE set only, never the 30-day tab ----------
      //
      // ★ The heaviest read on this page is the 30-day tab, and a heartbeat arrives every 15 s
      // per visitor. If Realtime refetched the open tab, the cost would scale with both the
      // window and the visitor count. Section 3 measures the payloads and section 6 reads
      // admin-presence.html's source for the Realtime target; this proves the behaviour.
      console.log('\n-- a real heartbeat, with the PM on the 30-day tab --');
      const bootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' +
        JSON.stringify(JSON.stringify(signedIn.data.session)) + '); true';
      await cdp.send('Page.navigate', { url: SITE + '/admin-login.html' });
      await sleep(1800);
      await cdp.evaluate(bootstrap);
      await cdp.send('Page.navigate', { url: SITE + '/admin-presence.html' });
      await sleep(2000);
      // Installed once the page's own script is present, so the month read below is recorded.
      const hooked = await cdp.evaluate('(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));' +
        ' for (let i = 0; i < 200; i++) { if (document.getElementById("presence-list")) break; await nap(200); }' +
        ' if (!document.getElementById("presence-list")) return false;' +
        ' window.__mwCalls = []; const f = window.fetch;' +
        ' window.fetch = function (u, o) { try { const s = typeof u === "string" ? u : (u && u.url) || "";' +
        '   if (/get-visitor-presence/.test(s)) window.__mwCalls.push((o && o.body) ? String(o.body) : ""); } catch (e) {}' +
        '   return f.apply(this, arguments); }; return true; })()');
      check('GUARD: admin-presence.html rendered and its reads can be observed', hooked === true);
      const rowCount = await cdp.evaluate('(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));' +
        ' const t = document.querySelector("[data-tab=month]"); if (t) t.click();' +
        ' for (let i = 0; i < 200; i++) { if (document.querySelectorAll("#presence-list tr[data-session]").length >= 6) break; await nap(200); }' +
        ' await nap(800); return document.querySelectorAll("#presence-list tr[data-session]").length; })()');
      check('GUARD: the PM is on a genuinely populated 30-day tab before the heartbeat',
        rowCount >= 6, rowCount + ' rows');
      const monthBefore = await cdp.evaluate('window.__mwCalls.filter((b) => /"tab":"month"/.test(b)).length');
      await cdp.evaluate('window.__mwCalls = []; true');

      // The same call site-presence.js makes every 15 s, against the real function.
      const hb = await fetch(url + '/functions/v1/track-visit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon },
        body: JSON.stringify({ event: 'heartbeat', sessionId: S.live, visitorId: cookies[0], path: '/services', at: new Date().toISOString() })
      });
      check('the heartbeat was accepted by the REAL track-visit function (200)', hb.status === 200, 'HTTP ' + hb.status);
      await sleep(4500);   // Realtime, plus the page's own 400 ms debounce
      const calls = await cdp.evaluate('window.__mwCalls');
      check('★ the heartbeat WOKE the page — it re-read something (otherwise the next check is vacuous)',
        calls.length >= 1, calls.length + ' call(s): ' + JSON.stringify(calls));
      check('★ EVERY read the heartbeat provoked asked for the LIVE set',
        calls.length >= 1 && calls.every((b) => /"tab":"live"/.test(b)), JSON.stringify(calls));
      check('★ NOT ONE of them refetched the 30-day tab — a heartbeat must never repeat the heavy read',
        calls.every((b) => !/"tab":"month"/.test(b)), JSON.stringify(calls));
      check('...and the 30-day tab HAD genuinely been read before the heartbeat (the PM really was on it)',
        monthBefore >= 1, monthBefore + ' month read(s) before');
      const stillMonth = await cdp.evaluate('(() => { const t = document.querySelector("[data-tab=month]");' +
        ' return !!(t && (/is-active/.test(t.className) || t.getAttribute("aria-selected") === "true")); })()');
      check('the PM is still on the 30-day tab afterwards — the open tab was not disturbed', stillMonth === true);
    } finally {
      if (cdp) { try { cdp.ws.close(); } catch (_e) { /* already closed */ } try { cdp.chrome.kill(); } catch (_e) { /* already gone */ } }
      await releaseTempDir(profileDir);
    }

    console.log('\n' + '='.repeat(70));
    console.log(passed + '/' + (passed + failed) + ' assertions passed.');
    if (failed) { console.log('\nFAILURES:'); fails.forEach((f) => console.log('  - ' + f)); }
    console.log(failed ? '\nPRESENCE HISTORY: FAIL' : '\nPRESENCE HISTORY: PASS');
  } finally {
    // Section 7's opted-in visit is real: track-visit generated the session id in the browser,
    // so it is removed by its visitor rather than by an id this suite never saw. Before the
    // visitors loop, or the row it points at blocks the delete.
    await admin.from('visitor_sessions').delete().eq('visitor_id', COOKIE_VID);
    for (const id of madeSessions) await admin.from('visitor_sessions').delete().eq('id', id);
    for (const id of madeVisitors) await admin.from('visitors').delete().eq('id', id);
    for (const id of madeUsers) { await admin.from('clients').delete().eq('id', id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
    console.log('cleanup: removed ' + madeSessions.length + ' sessions, ' + madeVisitors.length + ' visitors, ' + madeUsers.length + ' users');
  }
  process.exit(failed ? 1 : 0);
}

// 20 min, not 15: section 7 launches Chrome and loads four real pages, and under full-suite
// load a page load is slow. A visual sibling that kept the default 90 s watchdog left a real
// record unrepaired when it fired mid-run (row 249).
runVerifyMain(main, { watchdogMs: 20 * 60 * 1000 });
