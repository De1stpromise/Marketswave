#!/usr/bin/env node
// ★ Visitor presence (2026-09-13) — backend verification, local stack, real Edge Functions.
//
// What it proves:
//   1. CAPTURE through the real track-visit: a public IP resolves to a real country/city
//      and the IP is provably absent from every stored column (no column holds anything
//      shaped like an IP); UA → device/browser; a Google referrer with its term; the journey
//      and page count across page events; visit counting via the cookie id (a second session
//      for the same visitor is visit 2, a new visitor is visit 1); a heartbeat keeps the
//      session live and a leave beacon (text/plain, no headers) ends it; a signed-in client's
//      real name appears, an anonymous visitor shows none;
//   2. THE NOTABLE-VISITOR EMAIL, thresholds and the one-per-session rule: an ordinary first
//      page view sends NOTHING; /signup, a returning visitor and a signed-in client each send
//      exactly one; a second qualifying event on the same session sends no second email;
//      the two-minute burst guard holds across sessions;
//   3. RLS: an admin reads sessions; a real client session reads NONE (empty, not an error);
//      an anonymous session reads none; no client-side INSERT/UPDATE/DELETE succeeds for any
//      role, admin included;
//   4. RETENTION: purge_visitor_data() deletes a session aged past 30 days and its visitor,
//      leaves a 29-day-old one, and is scheduled daily in cron.job; the function is not
//      executable by anon/authenticated;
//   5. PROACTIVE CHAT, refused SERVER-SIDE: a message inside the first 30 seconds is a 409
//      naming the wait; after the window it creates a real conversation + outbound message
//      and claims the one invitation; a second message on the same session is a 409 even
//      though the row looks otherwise eligible; a message to a session that has left is a
//      409; a non-admin is 403; the visitor's next heartbeat carries the invitation; the
//      visitor accepts with an anonymous session + the token (a wrong token is 403), the
//      conversation binds to them, their reply lands inbound in the SAME conversation, and
//      after a reply the PM is pointed to the inbox rather than allowed a second proactive
//      send; a signed-in client's invitation lands in THEIR existing conversation.
//
// LOCAL STACK ONLY. Usage:  node scripts/verify-supabase-visitor-presence.js
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, token: data.session.access_token, id: data.user.id };
}
async function call(url, name, body, opts) {
  const headers = Object.assign({ 'Content-Type': (opts && opts.contentType) || 'application/json' }, (opts && opts.headers) || {});
  if (opts && opts.token) headers.Authorization = 'Bearer ' + opts.token;
  const res = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, body: json };
}
const uuid = () => crypto.randomUUID();
const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

async function main() {
  console.log('Visitor presence — backend verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyPresence-2026!';
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');
  const sessionIds = [], visitorIds = [], userIds = [], convoIds = [];
  const track = (body, opts) => call(url, 'track-visit', body, Object.assign({ headers: { 'X-Forwarded-For': '8.8.8.8', 'User-Agent': UA_MAC, 'Origin': 'http://127.0.0.1:8765' } }, opts || {}));

  // A real client for the "signed-in client" and RLS cases.
  const clientEmail = 'presence-client-' + suffix + '@test.marketswave.local';
  const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ email: clientEmail, password, email_confirm: true });
  if (cuErr) throw new Error(cuErr.message);
  userIds.push(cu.user.id);
  await admin.from('clients').insert({ id: cu.user.id, name: 'Presence Client ' + suffix, email: clientEmail, phone: '+1', account_type: 'Individual Account', status: 'active' });
  const client = await signIn(url, anonKey, clientEmail, password);

  // Every browser-driven suite now creates REAL sessions (site-presence.js runs on every
  // client page a headless Chrome loads, and a signed-in test client is a notable visitor),
  // so inside a full-suite run the two-minute burst guard can already be armed by another
  // script's session. Those are other tests' artefacts: age their notifications out of the
  // window before measuring this suite's own email behaviour.
  await admin.from('visitor_sessions').update({ notified_at: new Date(Date.now() - 10 * 60000).toISOString() }).gte('notified_at', new Date(Date.now() - 5 * 60000).toISOString());

  try {
    // ================================================================================
    console.log('1. Capture — region and behaviour, never the IP');
    // ================================================================================
    const v1 = uuid(), s1 = uuid(); visitorIds.push(v1); sessionIds.push(s1);
    const p1 = await track({ event: 'page', sessionId: s1, visitorId: v1, path: '/services.html', referrer: 'https://www.google.com/search?q=wealth+management+stockholm' });
    check('a first page event is accepted (200) with visit 1 and no invitation', p1.status === 200 && p1.body.ok === true && p1.body.visitNumber === 1 && p1.body.invitation === null, JSON.stringify(p1.body));
    let row = (await admin.from('visitor_sessions').select('*').eq('id', s1).single()).data;
    check('★ location derived server-side from the request IP: country US, a real city', row.country_code === 'US' && !!row.city && !!row.country, JSON.stringify({ cc: row.country_code, city: row.city, country: row.country }));
    const stored = JSON.stringify(row) + JSON.stringify((await admin.from('visitors').select('*').eq('id', v1).single()).data);
    check('★ the IP is absent from storage: no column of the session or visitor row contains anything shaped like an IP', !IP_RE.test(stored), stored.match(IP_RE) && stored.match(IP_RE)[0]);
    check('no column exists for an IP or a user agent at all', !('ip' in row) && !('ip_address' in row) && !('user_agent' in row), Object.keys(row).join(','));
    check('device and browser parsed from the User-Agent: Mac · Chrome', row.device === 'Mac' && row.browser === 'Chrome', row.device + ' · ' + row.browser);
    check('referrer: Google, with the search term the referrer carried', row.referrer_label === 'Google' && row.search_term === 'wealth management stockholm', row.referrer_label + ' / ' + row.search_term);
    check('current page normalised (/services), journey of one, page count 1', row.current_path === '/services' && row.journey.length === 1 && row.journey[0].p === '/services' && row.page_count === 1, JSON.stringify(row.journey));
    check('anonymous: no client, no name', row.client_id === null && row.client_name === null);
    check('an ordinary first page view sends NO email', row.notified_at === null && row.notable_reason === null);

    const p2 = await track({ event: 'page', sessionId: s1, visitorId: v1, path: '/about.html' });
    const p3 = await track({ event: 'page', sessionId: s1, visitorId: v1, path: '/about.html' }); // a reload is not a new step
    const p4 = await track({ event: 'page', sessionId: s1, visitorId: v1, path: '/resources.html' });
    row = (await admin.from('visitor_sessions').select('*').eq('id', s1).single()).data;
    check('the journey records the pages in order (a reload of the same page is not a step): services → about → resources, 3 pages', p2.status === 200 && p3.status === 200 && p4.status === 200 && row.journey.map((j) => j.p).join(',') === '/services,/about,/resources' && row.page_count === 3 && row.current_path === '/resources', JSON.stringify(row.journey));
    const hb = await track({ event: 'heartbeat', sessionId: s1, visitorId: v1, path: '/resources.html' });
    row = (await admin.from('visitor_sessions').select('last_seen_at, ended_at').eq('id', s1).single()).data;
    check('a heartbeat updates last_seen_at and the session is live (no ended_at)', hb.status === 200 && row.ended_at === null && Date.now() - new Date(row.last_seen_at).getTime() < 5000);
    const lv = await call(url, 'get-visitor-presence', { tab: 'live' }, { token: pm.token });
    const live1 = lv.body.sessions.find((s) => s.id === s1);
    check('the PM read lists it as LIVE with its journey, location and device', lv.status === 200 && live1 && live1.live === true && live1.journey.length === 3 && live1.countryCode === 'US' && live1.device === 'Mac', JSON.stringify(live1));
    // The leave beacon: text/plain, no headers at all — exactly what navigator.sendBeacon sends.
    const leaveRes = await fetch(url + '/functions/v1/track-visit', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ event: 'leave', sessionId: s1, visitorId: v1, path: '/resources.html' }) });
    row = (await admin.from('visitor_sessions').select('ended_at').eq('id', s1).single()).data;
    const lv2 = await call(url, 'get-visitor-presence', { tab: 'live' }, { token: pm.token });
    check('★ a leave beacon (text/plain, no auth header) ends the session — it is no longer live', leaveRes.status === 200 && row.ended_at !== null && !lv2.body.sessions.some((s) => s.id === s1), JSON.stringify({ status: leaveRes.status, ended: row.ended_at }));
    const wk = await call(url, 'get-visitor-presence', { tab: 'week' }, { token: pm.token });
    const gone = wk.body.sessions.find((s) => s.id === s1);
    check('...but it stays in the rolling history with its duration measured to the leave, not to now', gone && gone.live === false && gone.durationSeconds >= 0 && gone.durationSeconds < 60, JSON.stringify(gone));

    // Visit counting: the same cookie starting a second session is visit 2; a new cookie is 1.
    const s2 = uuid(); sessionIds.push(s2);
    const p5 = await track({ event: 'page', sessionId: s2, visitorId: v1, path: '/' });
    const v2 = uuid(), s3 = uuid(); visitorIds.push(v2); sessionIds.push(s3);
    const p6 = await track({ event: 'page', sessionId: s3, visitorId: v2, path: '/' }, { headers: { 'X-Forwarded-For': '8.8.8.8', 'User-Agent': UA_IPHONE, 'Origin': 'http://127.0.0.1:8765' } });
    check('★ visit counting: a second session for the same cookie is visit 2, a new cookie is visit 1', p5.body.visitNumber === 2 && p6.body.visitNumber === 1, JSON.stringify([p5.body, p6.body]));
    const iph = (await admin.from('visitor_sessions').select('device, browser, referrer_label').eq('id', s3).single()).data;
    check('an iPhone Safari UA parses as iPhone · Safari, no referrer is Direct', iph.device === 'iPhone' && iph.browser === 'Safari' && iph.referrer_label === 'Direct', JSON.stringify(iph));

    // The cold-start race, measured on the live site: two page events for a brand-new session
    // in flight at once (a click-through before the first, ~4 s, event lands). Both pages must
    // survive, in the order they happened, and the visit must count once.
    const vR = uuid(), sR = uuid(); visitorIds.push(vR); sessionIds.push(sR);
    const t1 = new Date(Date.now() - 2000).toISOString(), t2 = new Date(Date.now() - 500).toISOString();
    const [ra, rb] = await Promise.all([
      track({ event: 'page', sessionId: sR, visitorId: vR, path: '/services.html', at: t1, referrer: 'https://www.linkedin.com/' }),
      track({ event: 'page', sessionId: sR, visitorId: vR, path: '/about.html', at: t2 })
    ]);
    const rrow = (await admin.from('visitor_sessions').select('journey, current_path, page_count, visit_number').eq('id', sR).single()).data;
    const rvis = (await admin.from('visitors').select('visit_count').eq('id', vR).single()).data;
    check('★ two page events racing to create a session: both land, in time order, current page is the later one, and the visit is counted ONCE', ra.status === 200 && rb.status === 200 && rrow.journey.map((j) => j.p).join(',') === '/services,/about' && rrow.current_path === '/about' && rrow.page_count === 2 && rrow.visit_number === 1 && rvis.visit_count === 1, JSON.stringify({ ra: ra.body, rb: rb.body, rrow, rvis }));

    // A signed-in client: the real name, from their real JWT.
    const s4 = uuid(), v3 = uuid(); sessionIds.push(s4); visitorIds.push(v3);
    const p7 = await track({ event: 'page', sessionId: s4, visitorId: v3, path: '/dashboard.html' }, { token: client.token, headers: { 'X-Forwarded-For': '8.8.8.8', 'User-Agent': UA_MAC, 'Origin': 'http://127.0.0.1:8765' } });
    const crow = (await admin.from('visitor_sessions').select('client_id, client_name, notable_reason, notified_at').eq('id', s4).single()).data;
    check('★ a signed-in client shows their real name (from the JWT, never the body)', p7.status === 200 && crow.client_id === client.id && crow.client_name === 'Presence Client ' + suffix, JSON.stringify(crow));

    // ================================================================================
    console.log('\n2. Notable-visitor email — thresholds, one per session, the burst guard');
    // ================================================================================
    // The returning visitor (s2, visit 2) was the first notable session and was mailed at
    // once; the signed-in client (s4) started inside the two-minute window after it.
    const r2 = (await admin.from('visitor_sessions').select('notable_reason, notified_at, visit_number').eq('id', s2).single()).data;
    check('★ the returning visitor (visit 2) is mailed on arrival (reason: returning)', r2.visit_number === 2 && r2.notable_reason === 'returning' && r2.notified_at !== null, JSON.stringify(r2));
    const mailsForS2 = (await admin.from('email_log').select('id, subject').eq('related_entity_id', s2)).data;
    check('...logged in email_log with the returning-visitor subject', mailsForS2.length >= 1 && /returning visitor/.test(mailsForS2[0].subject), JSON.stringify(mailsForS2));
    check('★ burst guard: the signed-in client arriving inside the two-minute window is NOT mailed (never two presence emails within two minutes)', crow.notified_at === null && crow.notable_reason === null, JSON.stringify(crow));
    // Move the returning visitor's notification back in time to lift the guard, then re-trigger.
    await admin.from('visitor_sessions').update({ notified_at: new Date(Date.now() - 10 * 60000).toISOString() }).eq('id', s2);
    await track({ event: 'heartbeat', sessionId: s4, visitorId: v3, path: '/dashboard.html' }, { token: client.token, headers: { 'X-Forwarded-For': '8.8.8.8', 'User-Agent': UA_MAC, 'Origin': 'http://127.0.0.1:8765' } });
    const c2 = (await admin.from('visitor_sessions').select('notable_reason, notified_at').eq('id', s4).single()).data;
    check('★ once the window has passed, the signed-in client is mailed exactly once (reason: client)', c2.notable_reason === 'client' && c2.notified_at !== null, JSON.stringify(c2));
    const mailsForS4 = (await admin.from('email_log').select('id, subject').eq('related_entity_id', s4)).data;
    check('...with the signed-in-client subject', mailsForS4.length >= 1 && /signed-in client/.test(mailsForS4[0].subject), JSON.stringify(mailsForS4));
    const before = (await admin.from('email_log').select('id', { count: 'exact', head: true }).eq('related_entity_id', s2)).count;
    await admin.from('visitor_sessions').update({ notified_at: new Date(Date.now() - 10 * 60000).toISOString() }).eq('id', s2);
    await track({ event: 'page', sessionId: s2, visitorId: v1, path: '/signup.html' });
    const after = (await admin.from('email_log').select('id', { count: 'exact', head: true }).eq('related_entity_id', s2)).count;
    check('★ one email per session: landing on /signup afterwards sends NO second email for that session', after === before, JSON.stringify({ before, after }));
    // /signup on a fresh first-visit session: mailed (after the guard window).
    await admin.from('visitor_sessions').update({ notified_at: new Date(Date.now() - 10 * 60000).toISOString() }).in('id', [s2, s4]);
    const v4 = uuid(), s5 = uuid(); visitorIds.push(v4); sessionIds.push(s5);
    await track({ event: 'page', sessionId: s5, visitorId: v4, path: '/index.html' });
    const s5a = (await admin.from('visitor_sessions').select('notified_at').eq('id', s5).single()).data;
    await track({ event: 'page', sessionId: s5, visitorId: v4, path: '/signup.html' });
    const s5b = (await admin.from('visitor_sessions').select('notable_reason, notified_at').eq('id', s5).single()).data;
    check('★ /signup mails a first-time visitor (reason: signup) — and the homepage view before it did not', s5a.notified_at === null && s5b.notable_reason === 'signup' && s5b.notified_at !== null, JSON.stringify([s5a, s5b]));
    // Engaged: a session past five minutes — backdate started_at, then heartbeat.
    await admin.from('visitor_sessions').update({ notified_at: new Date(Date.now() - 10 * 60000).toISOString() }).eq('id', s5);
    const v5 = uuid(), s6 = uuid(); visitorIds.push(v5); sessionIds.push(s6);
    await track({ event: 'page', sessionId: s6, visitorId: v5, path: '/services.html' });
    await admin.from('visitor_sessions').update({ started_at: new Date(Date.now() - 6 * 60000).toISOString() }).eq('id', s6);
    await track({ event: 'heartbeat', sessionId: s6, visitorId: v5, path: '/services.html' });
    const s6r = (await admin.from('visitor_sessions').select('notable_reason, notified_at').eq('id', s6).single()).data;
    check('★ a session past five minutes mails once (reason: engaged)', s6r.notable_reason === 'engaged' && s6r.notified_at !== null, JSON.stringify(s6r));
    const totalMails = (await admin.from('email_log').select('id', { count: 'exact', head: true }).in('related_entity_id', sessionIds)).count;
    const notifiedSessions = (await admin.from('visitor_sessions').select('id').in('id', sessionIds).not('notified_at', 'is', null)).data.length;
    const perSession = (await admin.from('email_log').select('id', { count: 'exact', head: true }).eq('related_entity_id', s4)).count;
    check('★ ' + notifiedSessions + ' notable sessions out of ' + sessionIds.length + ' → exactly one email per notable session (× ' + perSession + ' PM recipient(s)); the ordinary sessions sent none', notifiedSessions === 4 && totalMails === notifiedSessions * perSession, JSON.stringify({ totalMails, notifiedSessions, perSession }));

    // ================================================================================
    console.log('\n3. RLS — admin-only, a client reads none, a visitor reads none, nobody writes');
    // ================================================================================
    const adminRead = await pm.client.from('visitor_sessions').select('id').in('id', sessionIds);
    check('a PM reads the sessions directly (RLS admin claim)', !adminRead.error && adminRead.data.length === sessionIds.length, JSON.stringify(adminRead.error));
    const clientRead = await client.client.from('visitor_sessions').select('id');
    check('★ a real signed-in client reads NONE — not even their own session (empty, not an error)', !clientRead.error && clientRead.data.length === 0, JSON.stringify(clientRead));
    const clientVisitors = await client.client.from('visitors').select('id');
    check('...and no visitor rows', !clientVisitors.error && clientVisitors.data.length === 0);
    const anonC = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonSess } = await anonC.auth.signInAnonymously();
    if (anonSess && anonSess.user) userIds.push(anonSess.user.id);
    const anonRead = await anonC.from('visitor_sessions').select('id');
    check('★ a second, anonymous visitor session reads NONE (a visitor never sees another visitor)', !anonRead.error && anonRead.data.length === 0, JSON.stringify(anonRead));
    const anonKeyOnly = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const bare = await anonKeyOnly.from('visitor_sessions').select('id');
    check('the bare anon key reads none', !bare.error && bare.data.length === 0);
    const ins = await client.client.from('visitor_sessions').insert({ id: uuid(), visitor_id: visitorIds[0], visit_number: 1, current_path: '/x' });
    const insA = await pm.client.from('visitor_sessions').insert({ id: uuid(), visitor_id: visitorIds[0], visit_number: 1, current_path: '/x' });
    check('no client-side INSERT for a client or an admin', !!ins.error && !!insA.error);
    const upd = await pm.client.from('visitor_sessions').update({ city: 'Nowhere' }).eq('id', s1).select('id');
    const del = await pm.client.from('visitor_sessions').delete().eq('id', s1).select('id');
    const still = (await admin.from('visitor_sessions').select('city').eq('id', s1).single()).data;
    check('no client-side UPDATE/DELETE even for an admin (silent no-ops under RLS; the row is provably unchanged)', (!upd.data || upd.data.length === 0) && (!del.data || del.data.length === 0) && still && still.city !== 'Nowhere', JSON.stringify({ upd, del, still }));

    // ================================================================================
    console.log('\n4. Retention — 30 days, deleted by the scheduled job');
    // ================================================================================
    const vOld = uuid(), sOld = uuid(), vKeep = uuid(), sKeep = uuid();
    visitorIds.push(vOld, vKeep); sessionIds.push(sOld, sKeep);
    // (PostgREST batch inserts need identical key sets per row — a first draft mixed them and
    // the insert silently failed, making the purge look broken.)
    const { error: vIns } = await admin.from('visitors').insert([
      { id: vOld, visit_count: 1, first_seen_at: new Date(Date.now() - 40 * 86400000).toISOString(), last_seen_at: new Date(Date.now() - 31 * 86400000).toISOString() },
      { id: vKeep, visit_count: 1, first_seen_at: new Date(Date.now() - 29 * 86400000).toISOString(), last_seen_at: new Date(Date.now() - 29 * 86400000).toISOString() }
    ]);
    if (vIns) throw new Error('retention seed (visitors): ' + vIns.message);
    const { error: sIns } = await admin.from('visitor_sessions').insert([
      { id: sOld, visitor_id: vOld, visit_number: 1, current_path: '/', started_at: new Date(Date.now() - 31 * 86400000).toISOString(), last_seen_at: new Date(Date.now() - 31 * 86400000).toISOString() },
      { id: sKeep, visitor_id: vKeep, visit_number: 1, current_path: '/', started_at: new Date(Date.now() - 29 * 86400000).toISOString(), last_seen_at: new Date(Date.now() - 29 * 86400000).toISOString() }
    ]);
    if (sIns) throw new Error('retention seed (sessions): ' + sIns.message);
    const { data: purged, error: purgeErr } = await admin.rpc('purge_visitor_data');
    const oldLeft = (await admin.from('visitor_sessions').select('id').eq('id', sOld)).data;
    const keepLeft = (await admin.from('visitor_sessions').select('id').eq('id', sKeep)).data;
    const vOldLeft = (await admin.from('visitors').select('id').eq('id', vOld)).data;
    const vKeepLeft = (await admin.from('visitors').select('id').eq('id', vKeep)).data;
    check('★ purge_visitor_data() deletes the 31-day-old session and its visitor, keeps the 29-day-old ones', !purgeErr && oldLeft.length === 0 && vOldLeft.length === 0 && keepLeft.length === 1 && vKeepLeft.length === 1, JSON.stringify({ purged, purgeErr }));
    check('...and reports what it deleted (at least the two rows)', Array.isArray(purged) && purged[0] && purged[0].sessions_deleted >= 1 && purged[0].visitors_deleted >= 1, JSON.stringify(purged));
    const rpcClient = await client.client.rpc('purge_visitor_data');
    check('a client cannot execute the purge (EXECUTE revoked)', !!rpcClient.error, JSON.stringify(rpcClient.error));
    const cron = execSync('docker exec supabase_db_Marketswave psql -U postgres -d postgres -Atc "select schedule from cron.job where jobname = \'marketswave-purge-visitor-data\'"', { encoding: 'utf8' }).trim();
    check('the purge is scheduled daily in cron.job (15 3 * * *)', cron === '15 3 * * *', cron);

    // ================================================================================
    console.log('\n5. Proactive chat — etiquette refused server-side, a real conversation, a real reply');
    // ================================================================================
    const v6 = uuid(), s7 = uuid(); visitorIds.push(v6); sessionIds.push(s7);
    await track({ event: 'page', sessionId: s7, visitorId: v6, path: '/signup.html' });
    const early = await call(url, 'send-proactive-message', { sessionId: s7, message: 'Hi — need any help?' }, { token: pm.token });
    check('★ a message inside the first 30 seconds is REFUSED server-side (409) naming the wait', early.status === 409 && /Wait \d+s/.test(early.body.error) && early.body.waitSeconds > 0, JSON.stringify(early.body));
    const s7row = (await admin.from('visitor_sessions').select('invitation_sent_at, conversation_id').eq('id', s7).single()).data;
    check('...and nothing was claimed or created', s7row.invitation_sent_at === null && s7row.conversation_id === null);
    const nonAdmin = await call(url, 'send-proactive-message', { sessionId: s7, message: 'x' }, { token: client.token });
    check('a non-admin is refused (403)', nonAdmin.status === 403);
    const noAuth = await call(url, 'send-proactive-message', { sessionId: s7, message: 'x' });
    check('anonymous is refused (401)', noAuth.status === 401);
    // Age the session past 30 s (real time is not required to pass: the rule reads started_at).
    await admin.from('visitor_sessions').update({ started_at: new Date(Date.now() - 45000).toISOString() }).eq('id', s7);
    const sent = await call(url, 'send-proactive-message', { sessionId: s7, message: "Hi — I noticed you're partway through opening an account. Happy to help." }, { token: pm.token });
    check('★ after 30 s the message sends: a real conversation and an outbound message exist', sent.status === 200 && sent.body.conversationId && sent.body.messageId, JSON.stringify(sent.body));
    if (sent.body && sent.body.conversationId) convoIds.push(sent.body.conversationId);
    const convo = (await admin.from('conversations').select('*').eq('id', sent.body.conversationId).single()).data;
    const firstMsg = (await admin.from('messages').select('*').eq('conversation_id', sent.body.conversationId).order('sent_at')).data;
    check('the conversation is open, email-less (anonymous), named by location, not unread for the PM who wrote it', convo.status === 'open' && convo.contact_email === null && /^Visitor/.test(convo.contact_name) && convo.unread_by_pm === false && convo.visitor_auth_id === null, JSON.stringify(convo));
    check('the outbound chat message carries the PM\'s email as sender', firstMsg.length === 1 && firstMsg[0].direction === 'outbound' && firstMsg[0].channel === 'chat' && firstMsg[0].sender_email === 'pm@marketswave.local', JSON.stringify(firstMsg));
    const again = await call(url, 'send-proactive-message', { sessionId: s7, message: 'Still there?' }, { token: pm.token });
    check('★ ONE invitation per session: a second message is REFUSED (409) server-side', again.status === 409 && /One invitation per session/.test(again.body.error) && again.body.replied === false, JSON.stringify(again.body));
    const msgCount = (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', sent.body.conversationId)).count;
    check('...and no second message was written', msgCount === 1);

    // The visitor's next heartbeat carries the invitation.
    const hbInv = await track({ event: 'heartbeat', sessionId: s7, visitorId: v6, path: '/signup.html' });
    check('★ the visitor\'s next heartbeat carries the pending invitation (conversation, token, the PM\'s message)', hbInv.status === 200 && hbInv.body.invitation && hbInv.body.invitation.conversationId === sent.body.conversationId && hbInv.body.invitation.token && /partway through/.test(hbInv.body.invitation.message), JSON.stringify(hbInv.body));
    // Accept it with an anonymous session — wrong token first.
    const visitorC = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: vs } = await visitorC.auth.signInAnonymously();
    userIds.push(vs.user.id);
    const badTok = await call(url, 'accept-chat-invitation', { sessionId: s7, token: uuid(), contactName: 'Eve', contactEmail: 'eve-' + suffix + '@test.marketswave.local' }, { token: vs.session.access_token });
    check('a wrong token is refused (403) — a stray anonymous session cannot claim the thread', badTok.status === 403, JSON.stringify(badTok.body));
    const acc = await call(url, 'accept-chat-invitation', { sessionId: s7, token: hbInv.body.invitation.token, contactName: 'Priya Test', contactEmail: 'priya-' + suffix + '@test.marketswave.local' }, { token: vs.session.access_token });
    check('★ the right token binds the conversation to the visitor\'s anonymous session and returns the history (the PM\'s message)', acc.status === 200 && acc.body.conversationId === sent.body.conversationId && acc.body.messages.length === 1 && acc.body.messages[0].direction === 'outbound', JSON.stringify(acc.body));
    const convo2 = (await admin.from('conversations').select('visitor_auth_id, contact_name, contact_email').eq('id', sent.body.conversationId).single()).data;
    check('...contact name and email now recorded on the thread', convo2.visitor_auth_id === vs.user.id && convo2.contact_name === 'Priya Test' && convo2.contact_email === 'priya-' + suffix + '@test.marketswave.local', JSON.stringify(convo2));
    const readBack = await visitorC.from('messages').select('id, direction').eq('conversation_id', sent.body.conversationId);
    check('the visitor can now read the thread under the existing RLS (visitor_auth_id)', !readBack.error && readBack.data.length === 1);
    const reply = await visitorC.from('messages').insert({ conversation_id: sent.body.conversationId, channel: 'chat', direction: 'inbound', body: 'Yes please — what is the minimum?' }).select('id').single();
    check('★ the visitor\'s reply lands INBOUND in the SAME conversation (it threads in the inbox)', !reply.error && !!reply.data.id, JSON.stringify(reply.error));
    const convo3 = (await admin.from('conversations').select('unread_by_pm, last_message_at').eq('id', sent.body.conversationId).single()).data;
    check('...and the inbox sees it as unread for the PM', convo3.unread_by_pm === true && !!convo3.last_message_at);
    const afterReply = await call(url, 'send-proactive-message', { sessionId: s7, message: 'x' }, { token: pm.token });
    check('after a reply, a further proactive send is refused and points the PM to the inbox thread', afterReply.status === 409 && afterReply.body.replied === true && afterReply.body.conversationId === sent.body.conversationId, JSON.stringify(afterReply.body));
    const hbAfter = await track({ event: 'heartbeat', sessionId: s7, visitorId: v6, path: '/signup.html' });
    check('once accepted, the heartbeat no longer carries the invitation', hbAfter.body.invitation === null);
    const gone2 = await call(url, 'send-proactive-message', { sessionId: s1, message: 'x' }, { token: pm.token });
    check('a session that has left cannot be messaged (409)', gone2.status === 409 && /no longer on the site/.test(gone2.body.error), JSON.stringify(gone2.body));

    // A signed-in client: the invitation lands in THEIR existing conversation.
    await admin.from('visitor_sessions').update({ started_at: new Date(Date.now() - 45000).toISOString() }).eq('id', s4);
    await track({ event: 'heartbeat', sessionId: s4, visitorId: v3, path: '/dashboard.html' }, { token: client.token });
    const sentC = await call(url, 'send-proactive-message', { sessionId: s4, message: 'Welcome back — anything I can help with today?' }, { token: pm.token });
    check('a signed-in client can be messaged after 30 s', sentC.status === 200, JSON.stringify(sentC.body));
    if (sentC.body && sentC.body.conversationId) convoIds.push(sentC.body.conversationId);
    const convoC = (await admin.from('conversations').select('client_id, contact_email').eq('id', sentC.body.conversationId).single()).data;
    check('★ ...into a conversation keyed to the client\'s real id and email (their existing thread, never a duplicate)', convoC.client_id === client.id && convoC.contact_email === clientEmail, JSON.stringify(convoC));
    const clientMsgs = await client.client.from('messages').select('id, direction, body').eq('conversation_id', sentC.body.conversationId);
    check('the client reads the PM\'s message under their own existing policy', !clientMsgs.error && clientMsgs.data.length === 1 && clientMsgs.data[0].direction === 'outbound');
    const pres = await call(url, 'get-visitor-presence', { tab: 'clients' }, { token: pm.token });
    const s4v = pres.body.sessions.find((s) => s.id === s4);
    check('the Clients-only tab lists the client session with canMessage false and "Already invited"', s4v && s4v.clientName === 'Presence Client ' + suffix && s4v.canMessage === false && s4v.messageBlockedReason === 'Already invited', JSON.stringify(s4v));
    check('the stat strip counts today\'s sessions and names a most-viewed page', pres.body.stats.sessionsToday >= 5 && pres.body.stats.mostViewedToday && pres.body.stats.mostViewedToday.path, JSON.stringify(pres.body.stats));
  } finally {
    await admin.from('visitor_sessions').delete().in('id', sessionIds);
    await admin.from('visitors').delete().in('id', visitorIds);
    if (convoIds.length) await admin.from('conversations').delete().in('id', convoIds);
    await admin.from('conversations').delete().eq('client_id', cu.user.id);
    await admin.from('clients').delete().eq('id', cu.user.id);
    for (const id of userIds) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.error('CLEANUP: ' + error.message); }
    const left = (await admin.from('visitor_sessions').select('id', { count: 'exact', head: true }).in('id', sessionIds)).count;
    if (left) console.error('CLEANUP: ' + left + ' test session rows left behind');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed) { console.log('VERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('VERIFY: PASS');
  process.exit(0);
}

main().catch((err) => { console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err)); console.error(err && err.stack); process.exit(1); });
