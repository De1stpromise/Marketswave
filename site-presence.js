// ★ Visitor presence (2026-09-13) — the tracking beacon every public page and every client
// dashboard page loads. Reports the current page, a heartbeat while the tab is open, and a
// leave beacon on pagehide, to the track-visit Edge Function. Region and behaviour only:
//
//   - the visitor is a random uuid in a first-party cookie (mw_vid, 30 days rolling, re-set on
//     every visit to match data retention) — no name, no
//     email, nothing typed anywhere; the cookie is how "returning · 3rd visit" is counted;
//   - a VISIT is a session: a new one starts on the first page load with no activity in the
//     previous 30 minutes (localStorage, so every tab shares it — opening a second tab is not
//     a second visit); the session id is a random uuid too;
//   - location is derived SERVER-SIDE from the request's IP inside track-visit and the IP is
//     discarded there; this script never sees it and never sends it;
//   - a signed-in client's own session JWT is attached when one exists (the dashboard pages),
//     which is how their real name appears — the platform legitimately knows who they are.
//
// LIVE vs GONE. Heartbeats go every 15 s while the page is open. Closing the tab sends a
// leave beacon (fetch keepalive, falling back to sendBeacon as text/plain — a beacon cannot
// run a CORS preflight, so the function accepts that content type). A stale connection — a
// laptop lid closed, a dropped network — sends nothing, and the session simply leaves the
// PM's "live" view when its last heartbeat is 45 s old; its duration is measured to that
// heartbeat, never padded.
//
// A PENDING CHAT INVITATION from a PM rides back on the heartbeat response; this script
// raises it as a `mw:chat-invitation` DOM event that chat-widget.js opens. Only
// supabase-endpoint.js (the project URL + anon key) is imported on public pages — never the
// full SDK (row 174).
(function () {
  'use strict';
  var COOKIE = 'mw_vid';
  var SESSION_KEY = 'mw_session';
  var IDLE_MS = 30 * 60 * 1000;
  var COOKIE_DAYS = 30;            // matches purge_visitor_data()'s retention exactly
  var HEARTBEAT_MS = 15000;
  var endpoint = null, anonKey = null, token = null, started = false, timer = null, invitationSeen = {}, acked = false;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.floor(Math.random() * 256); });
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  // * COOKIE LIFETIME: 30 DAYS, ROLLING, AND REWRITTEN ON EVERY VISIT (2026-09-28).
  //
  // It was 400 days, and it was written ONLY when absent — so an existing cookie kept its
  // original 400-day expiry for as long as the browser held it, and the identifier outlived
  // the data it identified by more than a year. purge_visitor_data() deletes a visitor 30 days
  // after they were last seen, so 30 days rolling is the lifetime that MATCHES the data: the
  // cookie and the row it points at now expire at the same moment.
  //
  // Rolling, not fixed from the first visit: the cookie is re-set on every visit, which both
  // keeps a regular visitor recognised for as long as their data exists AND is what rewrites
  // an old 400-day cookie down to 30 — re-setting the same name, value and path with a new
  // Max-Age replaces the expiry rather than adding a second cookie.
  function visitorId() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([0-9a-f-]{36})'));
    var id = m ? m[1] : uuid();
    document.cookie = COOKIE + '=' + id + '; Max-Age=' + (COOKIE_DAYS * 86400) + '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    return id;
  }
  function session() {
    var now = Date.now(), s = null;
    try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || !s.id || !s.at || now - s.at > IDLE_MS) s = { id: uuid(), at: now, isNew: true };
    s.at = now;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ id: s.id, at: s.at })); } catch (e) { /* storage blocked: the session still lives in memory for this page */ }
    return s;
  }
  var current = null;
  function pagePath() { return location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '') || '/'; }

  async function resolveEndpoint() {
    var mod = await import('./supabase-endpoint.js');
    endpoint = mod.ACTIVE_CONFIG.url;
    anonKey = mod.ACTIVE_CONFIG.anonKey;
    // A client dashboard page: the sidebar guard has already pinned the authenticated client,
    // and the SDK is already on the page — attach the real session so the name resolves.
    if (sessionStorage.getItem('marketswave_authenticated_client_id')) {
      try {
        var cfg = await import('./supabase-config.js');
        var r = await cfg.supabase.auth.getSession();
        token = r && r.data && r.data.session ? r.data.session.access_token : null;
      } catch (e) { token = null; }
    }
  }
  // PM tool revamp, part 1 (2026-09-14): the chat widget announces the conversation it opened
  // (an anonymous visitor's included). From then on every event carries the id and the
  // widget's own (anonymous) JWT, so track-visit can verify ownership and tie the presence
  // session to the thread — the inbox shows the visitor's page and a live dot beside it.
  var linkedConversationId = null;
  window.addEventListener('mw:chat-conversation', async function (e) {
    if (!e.detail || !e.detail.conversationId) return;
    linkedConversationId = e.detail.conversationId;
    if (!token) {
      try {
        var cfg2 = await import('./supabase-config.js');
        var r2 = await cfg2.supabase.auth.getSession();
        token = r2 && r2.data && r2.data.session ? r2.data.session.access_token : null;
      } catch (e2) { /* the link waits for a token that never comes — nothing else changes */ }
    }
    if (endpoint) send('heartbeat');
  });
  function payload(event, extra) {
    var s = session();
    current = s;
    var p = { event: event, sessionId: s.id, visitorId: visitorId(), path: pagePath(), at: new Date().toISOString() };
    if (linkedConversationId) p.conversationId = linkedConversationId;
    if (extra) for (var k in extra) p[k] = extra[k];
    return p;
  }
  async function send(event, extra) {
    if (!endpoint || (left && event !== 'leave')) return null;
    var headers = { 'Content-Type': 'application/json', apikey: anonKey };
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
      // keepalive on every event: the first page event on the live site takes ~4 s (a cold
      // function plus the geolocation lookup), and a click-through before it completes would
      // otherwise abort it — losing the first page and, with it, the referrer.
      var res = await fetch(endpoint + '/functions/v1/track-visit', { method: 'POST', headers: headers, body: JSON.stringify(payload(event, extra)), keepalive: true });
      if (!res.ok) return null;
      var data = await res.json();
      if (data && data.ok) acked = true;
      if (data && data.invitation && !invitationSeen[data.invitation.conversationId]) {
        invitationSeen[data.invitation.conversationId] = true;
        window.dispatchEvent(new CustomEvent('mw:chat-invitation', { detail: Object.assign({ sessionId: current.id }, data.invitation) }));
      }
      return data;
    } catch (e) { return null; }
  }
  var left = false;
  function leave() {
    if (!endpoint || left) return;
    left = true;
    if (timer) clearInterval(timer); // no heartbeat may follow the beacon and resurrect the session
    var body = JSON.stringify(payload('leave'));
    var ok = false;
    try { if (navigator.sendBeacon) ok = navigator.sendBeacon(endpoint + '/functions/v1/track-visit', new Blob([body], { type: 'text/plain' })); } catch (e) { ok = false; }
    if (!ok) { try { fetch(endpoint + '/functions/v1/track-visit', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true }); } catch (e) { /* best effort */ } }
  }

  // On a LOCAL origin the beacon is off unless opted in (localStorage mw_presence_local =
  // '1'): dozens of verification harnesses drive real headless browsers through these pages
  // against the local stack, and every one would otherwise leave real sessions — and, for a
  // signed-in test client, real notable-visitor emails — behind. Production hosts are
  // unaffected; local presence work sets the flag (README).
  function localOptOut() {
    if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return false;
    try { return localStorage.getItem('mw_presence_local') !== '1'; } catch (e) { return true; }
  }
  async function start() {
    if (started) return; started = true;
    if (localOptOut()) return;
    try { await resolveEndpoint(); } catch (e) { return; }
    var s = session();
    // The referrer rides the page event until the server has acknowledged the session, so a
    // first event that did not land does not lose it.
    await send('page', (s.isNew || !acked) ? { referrer: document.referrer || null } : null);
    timer = setInterval(function () { if (document.visibilityState !== 'hidden') send('heartbeat'); }, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') send('heartbeat'); });
    window.addEventListener('pagehide', leave);
  }
  // The dashboard's sidebar guard redirects an unauthenticated visitor before this runs; a
  // public page has no such guard and simply reports itself.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.MarketswavePresence = { sessionId: function () { return current ? current.id : null; }, visitorId: visitorId, heartbeat: function () { return send('heartbeat'); } };
})();
