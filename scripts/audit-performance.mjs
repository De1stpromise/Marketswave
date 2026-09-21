// Performance audit — app-feel programme, stage 1 (2026-09-21). See CLAUDE.md "App-feel
// programme" for the brief and PERFORMANCE_AUDIT.md for the findings this produced.
//
// This is an INVESTIGATION tool, not a pass/fail suite: it measures the LIVE site
// (marketswave.net, served by GitHub Pages) against REAL cloud staging, prints tables, writes
// one JSON file per run to scripts/.pass-logs/perf/<stamp>.json (gitignored), and exits 0. It
// exists so every later stage of the programme has a baseline to diff against — re-run it the
// same way and diff the JSON.
//
// WHAT IT MEASURES, per page, in a real headless Chrome over CDP:
//   1. transfer weight (bytes on the wire, from Network.loadingFinished — cross-origin included,
//      which the Performance API's transferSize is not without Timing-Allow-Origin)
//   2. request count, grouped: same-origin static, Tailwind CDN, esm.sh, jsdelivr/cdnjs, fonts,
//      Supabase (auth / rest / functions / storage), other
//   3. time to first meaningful render: first-contentful-paint, plus the moment the shared
//      sidebar mount has children ("shell painted") and the first skeleton appears
//   4. time to real data: the last moment the page's .animate-pulse skeleton count returns to
//      zero (the one shared skeleton vocabulary every wired page uses) — or, on a page that
//      paints no skeleton, the last Supabase response
//   5. the longest single Edge Function call on load (and every backend call, with its duration)
//   6. the cost of a navigation TODAY: a real sidebar click in a tab whose HTTP cache is warm —
//      click → next page usable, and what is discarded and redone: the sidebar repaint, the
//      stylesheets/scripts re-fetched or re-parsed, the session check, and the backend calls
//      that repeat what the previous page had already fetched. Stage 2 is judged against this.
//   7. the glass cost: frame time while scrolling the same page with backdrop-filter on and
//      off, and with the whole .glass recipe / the blurred blobs removed — on several pages,
//      and on the catalog at 24 / 96 / 247 cards, so "glass" and "card count" are separated.
//
// PASSES. Every page is loaded twice with the HTTP cache DISABLED: a COLD pass (each Edge
// Function's first invocation of the run pays the isolate cold start) and a WARM pass (same
// pages, functions now warm). Both are reported, so a first-visit-of-the-day cost is visible
// without contaminating the per-page baseline. The navigation sequences run with the cache
// ENABLED, after a warm-up load, so they measure exactly what a client experiences clicking
// through the sidebar. Real staging is the only environment that carries real cold-start and
// CDN latency; the local stack understates both, which is why this runs against the live site.
//
// SESSIONS. The client is the seeded fixture client (scripts/lib/fixture-client.mjs) — his
// staging session is obtained through an admin magic link (generateLink → verifyOtp), never by
// changing his password. The PM is a throwaway additional staging PM account created for the
// run and deleted afterwards (user_roles and pm_visits rows too). Both sessions are placed into
// the browser the way the real login pages leave them (the SDK's own localStorage key, the two
// sessionStorage ids, the local mirror), so every page sees exactly a real signed-in state.
//
// SIDE EFFECTS ON REAL STAGING, stated: get-portfolio-overview records this month's value
// anchor for the fixture client (idempotent, the same thing his own visit would do);
// get-pm-briefing records pm_visits rows for the throwaway PM (deleted with it); the presence
// beacon records real visitor sessions for the client profile (30-day retention, the same
// thing his own visit would do) — the PM email addresses on staging are not real inboxes.
//
// Usage (from scripts/, with SUPABASE_STAGING_CREDENTIALS_FILE pointing at the staging api-keys JSON):
//   node audit-performance.mjs                 # everything
//   PERF_ONLY=pages,nav,glass  node audit-performance.mjs   # a subset of the three parts
//   PERF_PAGES=dashboard.html,admin.html node audit-performance.mjs   # a subset of pages
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { makeTempDir, trackChild, releaseTempDir } from './lib/harness-teardown.mjs';
import { FIXTURE_CLIENT } from './lib/fixture-client.mjs';

const BASE = process.env.PERF_BASE || 'https://marketswave.net';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PERF_PORT || 9531);
// Real cloud staging — the same project supabase-endpoint.js's STAGING_CONFIG points at; the anon
// key is the public one every visitor's browser already carries.
const STAGING_URL = 'https://ujnmlwbpginplfnofhhv.supabase.co';
const STAGING_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbm1sd2JwZ2lucGxmbm9maGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MTE5MDcsImV4cCI6MjEwMzQ4NzkwN30.nJ9hTEwyfJDK-pVDtDMto6xLgwVOe9SqJm-LJNiIINg';
const CREDS = process.env.SUPABASE_STAGING_CREDENTIALS_FILE;   // the operator's service_role key file — never a path in the repo
const ONLY = (process.env.PERF_ONLY || 'pages,nav,glass').split(',');
const PAGE_FILTER = process.env.PERF_PAGES ? process.env.PERF_PAGES.split(',') : null;
const SETTLE_TIMEOUT_MS = 45000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HERE = path.dirname(fileURLToPath(import.meta.url));

const CLIENT_KEY = 'sb-ujnmlwbpginplfnofhhv-auth-token';        // the SDK's default for this project
const ADMIN_KEY = 'sb-marketswave-admin-auth-token';               // admin-supabase-config.js's explicit key

// ── page inventory ────────────────────────────────────────────────────────────────────────
const CLIENT_PAGES = ['dashboard.html', 'asset-performance.html', 'asset-collection.html', 'transactions.html', 'high-yield-savings.html',
  'documents.html', 'risk-management.html', 'deploy-capital.html', 'settings.html', 'support.html', 'fund-document.html?product=PROD-0002'];
const ADMIN_PAGES = (garyId) => ['admin.html', 'admin-approvals.html', 'admin-inbox.html', 'admin-clients.html', 'admin-client-profile.html?client=' + garyId,
  'admin-presence.html', 'admin-products.html', 'admin-fund-document.html?product=PROD-0002', 'admin-deposit-addresses.html', 'admin-documents.html',
  'admin-advisory-fee.html', 'admin-security.html'];
const PUBLIC_PAGES = ['index.html', 'services.html', 'resources.html', 'about.html', 'contact.html', 'legal.html', 'help-center.html', 'blog-press.html',
  'login.html', 'signup.html', 'admin-login.html'];
// The locked sidebar order (client) and the ten-item PM nav (admin) — the navigation sequences.
const CLIENT_NAV = ['dashboard.html', 'asset-performance.html', 'high-yield-savings.html', 'transactions.html', 'documents.html', 'risk-management.html', 'deploy-capital.html', 'settings.html', 'support.html'];
const ADMIN_NAV = ['admin.html', 'admin-approvals.html', 'admin-inbox.html', 'admin-clients.html', 'admin-presence.html', 'admin-products.html', 'admin-deposit-addresses.html', 'admin-documents.html', 'admin-advisory-fee.html', 'admin-security.html'];
const GLASS_PAGES = [['client', 'dashboard.html'], ['client', 'settings.html'], ['admin', 'admin.html'], ['admin', 'admin-approvals.html'], ['public', 'index.html']];

// ── the browser ───────────────────────────────────────────────────────────────────────────
async function launchChrome(label, port) {
  const profile = makeTempDir('mw-perf-' + label + '-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run',
    '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); }
    catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + port);
  const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const listeners = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
    if (m.method && listeners.has(m.method)) for (const fn of listeners.get(m.method)) fn(m.params);
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '')); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Network accounting. One map per page load; cleared by the caller before each navigation.
  const reqs = new Map();
  on('Network.requestWillBeSent', (p) => { reqs.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type, start: p.timestamp, wall: p.wallTime, initiator: p.initiator && p.initiator.type }); });
  on('Network.requestServedFromCache', (p) => { const r = reqs.get(p.requestId); if (r) r.cache = 'served'; });
  on('Network.responseReceived', (p) => { const r = reqs.get(p.requestId); if (!r) return; r.status = p.response.status; r.responseAt = p.timestamp; if (r.method === 'OPTIONS') { r.done = true; r.end = p.timestamp; r.bytes = r.bytes || p.response.encodedDataLength || 0; } r.mime = p.response.mimeType; if (p.response.fromDiskCache) r.cache = 'disk'; if (p.response.fromMemoryCache) r.cache = 'memory'; if (p.response.fromPrefetchCache) r.cache = 'prefetch'; r.protocol = p.response.protocol; });
  on('Network.loadingFinished', (p) => { const r = reqs.get(p.requestId); if (r) { r.end = p.timestamp; r.bytes = p.encodedDataLength; r.done = true; } });
  on('Network.loadingFailed', (p) => { const r = reqs.get(p.requestId); if (r) { r.end = p.timestamp; r.failed = p.errorText; r.done = true; } });
  const errors = [];
  on('Runtime.exceptionThrown', (p) => errors.push('exception: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text).split('\n')[0].slice(0, 160)));
  on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push('console: ' + String(p.entry.text).slice(0, 160)); });

  const cdp = { send, on, evaluate, reqs, errors, onceNavigated: null, close: () => releaseTempDir(profile) };
  on('Page.frameNavigated', (p) => { if (cdp.onceNavigated) cdp.onceNavigated(p); });
  return cdp;
}

// Runs in every new document before the page's own scripts: the timing probes.
const PROBE_JS = `(() => {
  const P = window.__mwPerf = { skelFirst: null, skelZeroAt: null, skelMax: 0, skelOpen: false, shellAt: null, lcp: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  function scan() {
    const n = [...document.querySelectorAll('.animate-pulse')].filter((e) => e.getClientRects().length).length;   // visible ones only — a hidden row's skeleton is not a loading state
    if (n > 0 && P.skelFirst == null) P.skelFirst = performance.now();
    if (n > P.skelMax) P.skelMax = n;
    if (n > 0) P.skelOpen = true; else if (P.skelOpen) { P.skelZeroAt = performance.now(); P.skelOpen = false; }
    if (P.shellAt == null) { const m = document.querySelector('#sidebar-mount, #admin-sidebar-mount'); if (m && m.children.length) P.shellAt = performance.now(); }
  }
  function attach() { if (!document.documentElement) return setTimeout(attach, 0); new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); scan(); }
  attach();
})();`;

function classify(url) {
  if (/^(data|blob):/.test(url)) return 'inline';
  let h; try { h = new URL(url).host; } catch (_e) { return 'other'; }
  if (h === new URL(BASE).host) return /\/vendor\//.test(url) ? 'vendor' : 'static';
  if (h === 'cdn.tailwindcss.com') return 'tailwind';
  if (h === 'esm.sh') return 'esm.sh';
  if (/jsdelivr|cdnjs/.test(h)) return 'cdn-lib';
  if (/fonts\.g/.test(h)) return 'fonts';
  if (h.endsWith('supabase.co')) {
    const p = new URL(url).pathname;
    if (p.startsWith('/functions/')) return 'functions';
    if (p.startsWith('/rest/')) return 'rest';
    if (p.startsWith('/auth/')) return 'auth';
    if (p.startsWith('/storage/')) return 'storage';
    if (p.startsWith('/realtime/')) return 'realtime';
    return 'supabase';
  }
  if (/ipwho|ipinfo|finnhub|coingecko/.test(h)) return 'third-party';
  return 'other';
}
const backendPath = (url) => { const u = new URL(url); return u.pathname.replace(/^\/rest\/v1\//, 'rest:').replace(/^\/functions\/v1\//, 'fn:').replace(/^\/auth\/v1\//, 'auth:').replace(/^\/storage\/v1\//, 'storage:') + (u.pathname.startsWith('/rest/') ? '?' + [...u.searchParams.keys()].filter((k) => k !== 'select').map((k) => k + '=' + u.searchParams.get(k)).join('&') : ''); };
const isBackend = (c) => c === 'functions' || c === 'rest' || c === 'auth' || c === 'storage';

// The next main-frame commit — so a settle never reads the PREVIOUS document's readyState.
function waitNavigated(cdp) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 15000);
    cdp.onceNavigated = (p) => { if (!p.frame.parentId) { clearTimeout(t); cdp.onceNavigated = null; resolve(true); } };
  });
}
async function readMetrics(cdp) { return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])); }

// Wait until the page is usable: document complete, no skeleton on screen, and no Supabase
// request in flight (the presence beacon excepted — keepalive, never waited on by the page).
async function settle(cdp) {
  const t0 = Date.now(); let quiet = 0; let last = null;
  while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
    await sleep(250);
    let s = null;
    try { s = await cdp.evaluate('JSON.stringify({ ready: document.readyState, P: window.__mwPerf, n: [...document.querySelectorAll(".animate-pulse")].filter((e) => e.getClientRects().length).length, retry: document.querySelectorAll("[data-retry]").length })'); } catch (_e) { continue; }
    s = JSON.parse(s); last = s;
    const nowTs = Math.max(...[...cdp.reqs.values()].map((r) => r.end || r.responseAt || r.start));
    const pendingBackend = [...cdp.reqs.values()].filter((r) => !r.done && !/track-visit/.test(r.url) && classify(r.url) !== 'realtime' && classify(r.url) !== 'inline' && !(r.responseAt && nowTs - r.responseAt > 8) && !(!r.responseAt && nowTs - r.start > 20)).length;
    if (s.ready === 'complete' && s.n === 0 && pendingBackend === 0 && Date.now() - t0 > 1500) { if (++quiet >= 3) return { settled: true, ...s }; } else quiet = 0;
  }
  const pending = [...cdp.reqs.values()].filter((r) => !r.done && classify(r.url) !== 'realtime' && classify(r.url) !== 'inline').map((r) => (isBackend(classify(r.url)) ? backendPath(r.url) : r.url.slice(0, 80)) + ' (' + ((Date.now() / 1000 - r.wall) | 0) + 's)');
  return { settled: false, pending, ...(last || {}) };
}

async function collect(cdp, label, m0) {
  const nav = JSON.parse(await cdp.evaluate(`JSON.stringify((() => { const n = performance.getEntriesByType('navigation')[0] || {}; const paints = {}; for (const p of performance.getEntriesByType('paint')) paints[p.name] = p.startTime; const res = performance.getEntriesByType('resource').map((r) => ({ name: r.name, t: r.transferSize, e: r.encodedBodySize, d: r.decodedBodySize, it: r.initiatorType })); return { timeOrigin: performance.timeOrigin, responseStart: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, transfer: n.transferSize, paints, res, nodes: document.getElementsByTagName('*').length, glass: [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).backdropFilter !== 'none').length, blobs: document.querySelectorAll('.blob').length, title: document.title, href: location.href }; })())`));
  const m1 = await readMetrics(cdp);
  const metrics = {}; for (const k of Object.keys(m1)) metrics[k] = m1[k] - (m0 && m0[k] != null && /Duration|Count/.test(k) ? m0[k] : 0);
  const perfByUrl = new Map(nav.res.map((r) => [r.name, r]));
  const doc = [...cdp.reqs.values()].find((r) => r.type === 'Document' && r.url.startsWith(BASE));
  const docStart = doc ? doc.start : Math.min(...[...cdp.reqs.values()].map((r) => r.start));
  const reqs = [...cdp.reqs.values()].filter((r) => r.start >= docStart - 0.05 && classify(r.url) !== 'inline');
  const rows = reqs.map((r) => {
    const c = r.method === 'OPTIONS' ? 'preflight' : classify(r.url); const pe = perfByUrl.get(r.url);
    const cached = !!r.cache || (pe && pe.t === 0 && pe.e > 0);
    return { url: r.url, cls: c, status: r.status, bytes: r.bytes || 0, cached, failed: r.failed || null, start: +((r.start - docStart) * 1000).toFixed(0), dur: r.end ? +((r.end - r.start) * 1000).toFixed(0) : null, done: !!r.done, decoded: pe ? pe.d : null };
  });
  const groups = {};
  for (const row of rows) { const g = groups[row.cls] || (groups[row.cls] = { n: 0, bytes: 0, cached: 0 }); g.n++; g.bytes += row.cached ? 0 : row.bytes; if (row.cached) g.cached++; }
  const backend = rows.filter((r) => isBackend(r.cls)).map((r) => ({ path: backendPath(r.url), cls: r.cls, start: r.start, dur: r.dur, status: r.status, bytes: r.bytes, failed: r.failed }));
  const fnCalls = backend.filter((b) => b.cls === 'functions');
  const longestFn = fnCalls.length ? fnCalls.reduce((a, b) => ((b.dur || 0) > (a.dur || 0) ? b : a)) : null;
  // A page that polls (the admin shell's presence/approvals watches) never has a "last" backend
  // response; its data is ready at the end of the INITIAL burst — the last response before the
  // first idle second after DOMContentLoaded.
  const dataCalls = backend.filter((b) => !/track-visit/.test(b.path) && b.dur != null).map((b) => ({ s: b.start, e: b.start + b.dur })).sort((a, b) => a.s - b.s);
  let lastBackendEnd = 0; { let busyUntil = 0; for (const c of dataCalls) { if (lastBackendEnd && c.s > (nav.dcl || 0) && c.s - busyUntil > 1000) break; busyUntil = Math.max(busyUntil, c.e); lastBackendEnd = busyUntil; } }
  const P = cdp._lastProbe || {};
  const dataReady = P.skelZeroAt != null ? { ms: +P.skelZeroAt.toFixed(0), how: 'skeleton→0' } : (dataCalls.length ? { ms: +lastBackendEnd.toFixed(0), how: 'initial backend burst' } : { ms: +(nav.dcl || 0).toFixed(0), how: 'DOMContentLoaded (no backend)' });
  return {
    label, href: nav.href, title: nav.title, timeOrigin: nav.timeOrigin,
    bytesTotal: rows.reduce((s, r) => s + (r.cached ? 0 : r.bytes), 0), requests: rows.length, cachedRequests: rows.filter((r) => r.cached).length, groups,
    responseStart: +(nav.responseStart || 0).toFixed(0), fcp: nav.paints['first-contentful-paint'] != null ? +nav.paints['first-contentful-paint'].toFixed(0) : null, lcp: P.lcp != null ? +P.lcp.toFixed(0) : null,
    shellAt: P.shellAt != null ? +P.shellAt.toFixed(0) : null, skelFirst: P.skelFirst != null ? +P.skelFirst.toFixed(0) : null, skelMax: P.skelMax || 0, dataReady,
    dcl: +(nav.dcl || 0).toFixed(0), load: +(nav.load || 0).toFixed(0), longestFn, backend, fnCount: fnCalls.length,
    nodes: nav.nodes, glass: nav.glass, blobs: nav.blobs, errorCards: cdp._lastProbe_retry || 0, settled: cdp._lastSettled, pendingAtTimeout: cdp._lastPending || [], stalled: rows.filter((r) => !r.done && r.status == null).map((r) => r.url.slice(0, 90)),
    mainThread: { script: +(metrics.ScriptDuration * 1000).toFixed(0), layout: +(metrics.LayoutDuration * 1000).toFixed(0), style: +(metrics.RecalcStyleDuration * 1000).toFixed(0), task: +(metrics.TaskDuration * 1000).toFixed(0), heapMB: +(metrics.JSHeapUsedSize / 1048576).toFixed(1), layouts: metrics.LayoutCount },
    errors: cdp.errors.splice(0), skeletonLeft: cdp._lastSkeletonLeft || [], rows: rows.map((r) => ({ url: r.url.length > 140 ? r.url.slice(0, 140) + '…' : r.url, cls: r.cls, bytes: r.bytes, cached: r.cached, start: r.start, dur: r.dur, status: r.status, failed: r.failed }))
  };
}

async function loadPage(cdp, url, label) {
  cdp.reqs.clear(); cdp.errors.length = 0;
  const navigated = waitNavigated(cdp);
  await cdp.send('Page.navigate', { url });
  await navigated;
  const m0 = await readMetrics(cdp);
  const s = await settle(cdp);
  cdp._lastProbe = s.P || {}; cdp._lastProbe_retry = s.retry || 0; cdp._lastSettled = s.settled; cdp._lastPending = s.pending || [];
  cdp._lastSkeletonLeft = s.n ? await cdp.evaluate('[...document.querySelectorAll(".animate-pulse")].slice(0, 6).map((e) => { const p = e.closest("[id]"); return (p ? "#" + p.id + " " : "") + e.outerHTML.slice(0, 120); })') : [];
  return collect(cdp, label, m0);
}

// ── sessions ──────────────────────────────────────────────────────────────────────────────
function serviceRoleKey() {
  if (!CREDS) throw new Error('SUPABASE_STAGING_CREDENTIALS_FILE is not set — point it at the staging api-keys JSON (see scripts/supabase-staging-bootstrap-additional-pm.js)');
  const k = JSON.parse(readFileSync(CREDS, 'utf8'));
  return (Array.isArray(k) ? k.find((e) => e.name === 'service_role') : k).api_key;
}
async function clientSession(admin) {
  const { data: row, error } = await admin.from('clients').select('*').ilike('name', FIXTURE_CLIENT.name).maybeSingle();
  if (error || !row) throw new Error('fixture client is not on staging: ' + (error && error.message));
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: row.email });
  if (lErr) throw new Error('generateLink: ' + lErr.message);
  const anon = createClient(STAGING_URL, STAGING_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: v, error: vErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (vErr) throw new Error('verifyOtp: ' + vErr.message);
  return { session: v.session, row };
}
async function pmSession(admin) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'perf-audit-pm-' + suffix + '@marketswave-staging.internal';
  const password = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('createUser: ' + error.message);
  const { error: rErr } = await admin.from('user_roles').upsert({ user_id: created.user.id, is_admin: true }, { onConflict: 'user_id' });
  if (rErr) throw new Error('user_roles: ' + rErr.message);
  const anon = createClient(STAGING_URL, STAGING_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error('pm sign-in: ' + sErr.message);
  return { id: created.user.id, email, session: s.session };
}
async function deletePm(admin, id) {
  await admin.from('pm_visits').delete().eq('user_id', id);
  await admin.from('user_roles').delete().eq('user_id', id);
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) console.error('CLEANUP: deleteUser ' + error.message);
  const { data } = await admin.auth.admin.getUserById(id);
  if (data && data.user) console.error('CLEANUP: the throwaway PM still exists: ' + id);
}
const bootstrapJs = (key, session, extra) => `(() => { try { if (!localStorage.getItem(${JSON.stringify(key)})) localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))}); ${extra || ''} } catch (e) {} })();`;

// ── glass ─────────────────────────────────────────────────────────────────────────────────
const STYLE_JS = (css) => '(() => { let s = document.getElementById("__perfglass"); if (!s) { s = document.createElement("style"); s.id = "__perfglass"; document.head.appendChild(s); } s.textContent = ' + JSON.stringify(css) + '; return true; })()';
const MEASURE_JS = (FLOOR) => '(() => new Promise((resolve) => { const FLOOR = ' + FLOOR + '; const main = document.querySelector("main"); const el = (main && main.scrollHeight > main.clientHeight + 10) ? main : document.scrollingElement; const total = el.scrollHeight - el.clientHeight; if (total < 200) return resolve({ scrollable: total }); const STEPS = 90; const frames = []; let last = null, i = 0; el.scrollTop = 0; function tick(ts) { if (last !== null) frames.push(ts - last); last = ts; i++; el.scrollTop = Math.round(total * Math.min(1, i / STEPS)); if (i <= STEPS + 5) requestAnimationFrame(tick); else { el.scrollTop = 0; frames.sort((a, b) => a - b); const mean = frames.reduce((a, b) => a + b, 0) / frames.length; resolve({ frames: frames.length, mean: +mean.toFixed(2), p95: +frames[Math.floor(frames.length * 0.95)].toFixed(2), max: +frames[frames.length - 1].toFixed(2), dropped: frames.filter((f) => f > FLOOR * 1.25).length, scrollable: total }); } } requestAnimationFrame(tick); }))()';
const FLOOR_JS = '(() => new Promise((resolve) => { const f = []; let last = null, i = 0; function t(ts) { if (last !== null) f.push(ts - last); last = ts; if (++i < 40) requestAnimationFrame(t); else { f.sort((a,b)=>a-b); resolve(+f[Math.floor(f.length/2)].toFixed(2)); } } requestAnimationFrame(t); }))()';
const FILL_JS = (n) => '(() => { const g = document.getElementById("asset-cards-grid"); const cards = [...g.querySelectorAll("[data-product-id]")]; if (!cards.length) return 0; let i = 0; while (g.querySelectorAll("[data-product-id]").length < ' + n + ') { g.appendChild(cards[i % cards.length].cloneNode(true)); i++; } while (g.querySelectorAll("[data-product-id]").length > ' + n + ') { const c = g.querySelectorAll("[data-product-id]"); c[c.length - 1].remove(); } return g.querySelectorAll("[data-product-id]").length; })()';
const GLASS_SEL = '.glass, .glass-subtle, .glass-dark, .glass-slate, .glass-on-dark';
const VARIANTS = [
  ['as-is', ''],
  ['no-blur', '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }'],
  // blur off, but every glass element still forced onto its own compositor layer — if this is
  // as cheap as as-is, the blur's cost is being paid back by the layer it happens to create
  ['no-blur-layered', '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } ' + GLASS_SEL + ' { will-change: transform; }'],
  ['no-glass', '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } ' + GLASS_SEL + ' { box-shadow: none !important; background: #fff !important; border-color: #e2e8f0 !important; } ' + GLASS_SEL.split(', ').map((s) => s + '::before').join(', ') + ' { display: none !important; }'],
  ['no-decoration', '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; filter: none !important; } ' + GLASS_SEL + ' { box-shadow: none !important; background: #fff !important; } ' + GLASS_SEL.split(', ').map((s) => s + '::before').join(', ') + ', .blob, .grid-overlay, .page-grain, .hero-grain, .field-grain { display: none !important; }']
];
async function glassOn(cdp, label, counts) {
  const floor = await cdp.evaluate(FLOOR_JS);
  const out = { label, floor, glassElements: await cdp.evaluate('[...document.querySelectorAll("*")].filter(e => getComputedStyle(e).backdropFilter !== "none").length'), blobs: await cdp.evaluate('document.querySelectorAll(".blob").length'), runs: [] };
  for (const n of (counts || [null])) {
    const got = n ? await cdp.evaluate(FILL_JS(n)) : null;
    if (n) { await cdp.evaluate('(async () => { await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))); })()'); await sleep(400); }
    for (const [name, css] of VARIANTS) {
      await cdp.evaluate(STYLE_JS(css)); await sleep(300);
      await cdp.evaluate(MEASURE_JS(floor));                 // warm raster caches
      const ms = []; for (let k = 0; k < 3; k++) ms.push(await cdp.evaluate(MEASURE_JS(floor)));
      const m = ms[0].frames ? ms.sort((a, b) => a.mean - b.mean)[1] : ms[0];   // the median of three by mean
      if (m.frames) m.meanRange = [ms[0].mean, ms[2].mean];
      out.runs.push({ cards: got, variant: name, ...m });
      console.log('  ' + String(got == null ? '' : got).padEnd(6) + name.padEnd(17) + (m.frames ? 'mean ' + String(m.mean).padStart(6) + ' (' + m.meanRange[0] + '–' + m.meanRange[1] + ')  p95 ' + String(m.p95).padStart(6) + '  max ' + String(m.max).padStart(6) + '  dropped ' + String(m.dropped).padStart(3) + '/' + m.frames : 'not scrollable (' + m.scrollable + 'px)'));
    }
    await cdp.evaluate(STYLE_JS(''));
  }
  return out;
}

// The sample whose data-ready time is the median; the spread of every timing across samples is kept.
function medianSample(samples) {
  if (samples.length === 1) return samples[0];
  const sorted = [...samples].sort((a, b) => a.dataReady.ms - b.dataReady.ms);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const spread = (f) => { const v = samples.map(f).filter((x) => x != null); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
  mid.spread = { fcp: spread((x) => x.fcp), shellAt: spread((x) => x.shellAt), dataReady: spread((x) => x.dataReady.ms), bytesTotal: spread((x) => x.bytesTotal), longestFn: spread((x) => x.longestFn && x.longestFn.dur), samples: samples.length, unsettled: samples.filter((x) => !x.settled).length };
  mid.allSamples = samples.map((x) => ({ fcp: x.fcp, shellAt: x.shellAt, dataReady: x.dataReady.ms, bytesTotal: x.bytesTotal, longestFn: x.longestFn && x.longestFn.dur, settled: x.settled, slowest: x.rows.filter((r) => r.dur).sort((a, b) => b.dur - a.dur).slice(0, 3).map((r) => r.dur + 'ms ' + r.url.replace(BASE + '/', '').slice(0, 60)) }));
  return mid;
}

// ── output ────────────────────────────────────────────────────────────────────────────────
const kb = (b) => (b / 1024).toFixed(0);
function printPage(r) {
  const g = r.groups; const gs = (k) => (g[k] ? g[k].n + (g[k].cached ? '(' + g[k].cached + 'c)' : '') : '-');
  console.log('  ' + r.label.padEnd(44) + kb(r.bytesTotal).padStart(6) + 'KB ' + String(r.requests).padStart(3) + ' req  ' +
    'fcp ' + String(r.fcp == null ? '-' : r.fcp).padStart(5) + '  shell ' + String(r.shellAt == null ? '-' : r.shellAt).padStart(5) + '  data ' + String(r.dataReady.ms).padStart(6) + ' (' + r.dataReady.how + ')' +
    '  fn ' + String(r.fnCount).padStart(2) + ' longest ' + (r.longestFn ? r.longestFn.path.replace('fn:', '') + ' ' + r.longestFn.dur + 'ms' : '-') +
    (r.spread ? '  [data ' + r.spread.dataReady[0] + '–' + r.spread.dataReady[1] + ']' : '') + (r.settled ? '' : '  UNSETTLED pending=' + JSON.stringify(r.pendingAtTimeout)) + (r.stalled && r.stalled.length ? '  stalled ' + r.stalled.length : '') + (r.errorCards ? '  ERROR-CARDS ' + r.errorCards : '') + (r.errors.length ? '  console-errors ' + r.errors.length : ''));
  console.log('      static ' + gs('static') + ' vendor ' + gs('vendor') + ' preflight ' + gs('preflight') + ' tailwind ' + gs('tailwind') + ' esm.sh ' + gs('esm.sh') + ' libs ' + gs('cdn-lib') + ' fonts ' + gs('fonts') + ' auth ' + gs('auth') + ' rest ' + gs('rest') + ' functions ' + gs('functions') + ' storage ' + gs('storage') + ' realtime ' + gs('realtime') + ' other ' + gs('other') + ' | nodes ' + r.nodes + ' glass ' + r.glass + ' | main-thread script ' + r.mainThread.script + 'ms layout ' + r.mainThread.layout + 'ms style ' + r.mainThread.style + 'ms');
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(HERE, '.pass-logs', 'perf'); mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, stamp + '.json');
  const results = { stamp, base: BASE, viewport: '1440x900', passes: {}, nav: {}, glass: [], notes: [] };
  const admin = createClient(STAGING_URL, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  console.log('Performance audit — ' + BASE + ' against real staging, ' + stamp + '\n');
  const gary = await clientSession(admin);
  const pm = await pmSession(admin);
  console.log('sessions: client = the fixture client (magic-link session), PM = throwaway ' + pm.email + '\n');
  const clientBootstrap = bootstrapJs(CLIENT_KEY, gary.session, 'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(gary.row.id) + '); sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(gary.row.id) + ');');
  const adminBootstrap = bootstrapJs(ADMIN_KEY, pm.session);
  const mirrorJs = 'mirrorAuthenticatedClientLocally(' + JSON.stringify({ id: gary.row.id, name: gary.row.name, email: gary.row.email, phone: gary.row.phone, accountType: gary.row.account_type, status: gary.row.status, createdAt: gary.row.created_at ? gary.row.created_at.slice(0, 10) : null, applicationResolvedAt: null, applicationReason: null }) + '); setClientAuthenticated(' + JSON.stringify(gary.row.id) + '); true';

  const surfaces = [
    { name: 'client', pages: CLIENT_PAGES, bootstrap: clientBootstrap, nav: CLIENT_NAV, mount: '#sidebar-mount' },
    { name: 'admin', pages: ADMIN_PAGES(gary.row.id), bootstrap: adminBootstrap, nav: ADMIN_NAV, mount: '#admin-sidebar-mount' },
    { name: 'public', pages: PUBLIC_PAGES, bootstrap: '', nav: null }
  ];
  const browsers = {};
  try {
    for (const s of surfaces) {
      const cdp = await launchChrome(s.name, PORT + surfaces.indexOf(s)); browsers[s.name] = cdp;
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE_JS });
      if (s.bootstrap) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: s.bootstrap });
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      // Establish origin storage the way the login page leaves it; the client also gets the local mirror.
      await cdp.send('Page.navigate', { url: BASE + '/' + (s.name === 'public' ? 'index.html' : s.name === 'client' ? 'dashboard.html' : 'admin.html') }); await sleep(2500);
      if (s.name === 'client') {
        // engine-core.js must have loaded before the mirror can be written — wait for it, then reload once so
        // every later page (and the sidebar footer / settings profile card that read the mirror) sees it.
        let ok = false; for (let i = 0; i < 120 && !ok; i++) { ok = await cdp.evaluate('typeof mirrorAuthenticatedClientLocally === "function"').catch(() => false); if (!ok) await sleep(250); }
        if (!ok) throw new Error('engine-core.js never loaded on the pre-load page — cannot write the local mirror');
        await cdp.evaluate(mirrorJs);
        const mirrored = await cdp.evaluate('(JSON.parse(localStorage.getItem("marketswave_clients") || "[]").some((c) => c.id === ' + JSON.stringify(gary.row.id) + '))');
        if (!mirrored) throw new Error('the local mirror was not written');
      }
      // The one visit whose cost this pre-load already paid is discarded; the cold pass below is the first measured one.
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    }

    if (ONLY.includes('pages')) {
      const SAMPLES = Number(process.env.PERF_SAMPLES || 3);
      for (const pass of ['cold', 'warm']) {
        results.passes[pass] = [];
        console.log('=== PASS ' + pass.toUpperCase() + ' — HTTP cache disabled, ' + (pass === 'cold' ? 'each Edge Function\'s first invocation of the run (1 sample)' : 'functions warm from the cold pass (' + SAMPLES + ' samples, median by data-ready reported, min–max kept)') + ' ===');
        for (const s of surfaces) {
          const cdp = browsers[s.name];
          for (const p of s.pages) {
            if (PAGE_FILTER && !PAGE_FILTER.some((f) => p.startsWith(f))) continue;
            const samples = [];
            for (let k = 0; k < (pass === 'cold' ? 1 : SAMPLES); k++) samples.push(await loadPage(cdp, BASE + '/' + p, s.name + ' ' + p));
            const r = medianSample(samples);
            r.surface = s.name; results.passes[pass].push(r); printPage(r);
            writeFileSync(outFile, JSON.stringify(results, null, 1));
          }
        }
        console.log('');
      }
    }

    if (ONLY.includes('nav')) {
      console.log('=== NAVIGATION COST — HTTP cache enabled, real sidebar clicks, one tab ===');
      for (const s of surfaces.filter((x) => x.nav)) {
        const cdp = browsers[s.name];
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
        const seq = [];
        // Warm-up load of the first page (its cache-populating cost is not a navigation).
        let prev = await loadPage(cdp, BASE + '/' + s.nav[0], s.name + ' ' + s.nav[0]);
        for (let i = 1; i < s.nav.length; i++) {
          const target = s.nav[i]; const from = s.nav[i - 1];
          cdp.reqs.clear(); cdp.errors.length = 0;
          const navigated = waitNavigated(cdp);
          const clickEpoch = await cdp.evaluate('(() => { const a = document.querySelector(' + JSON.stringify(s.mount + ' a[href^="' + target + '"]') + '); if (!a) throw new Error("no sidebar link to ' + target + '"); const t = performance.timeOrigin + performance.now(); setTimeout(() => a.click(), 0); return t; })()');
          await navigated;
          const m0 = await readMetrics(cdp);
          const st = await settle(cdp);
          cdp._lastProbe = st.P || {}; cdp._lastProbe_retry = st.retry || 0; cdp._lastSettled = st.settled; cdp._lastPending = st.pending || [];
          const r = await collect(cdp, s.name + ' ' + from + ' → ' + target, m0);
          r.clickToNavStart = +(r.timeOrigin - clickEpoch).toFixed(0);
          const prevPaths = new Set(prev.backend.map((b) => b.path));
          r.repeatedBackend = r.backend.filter((b) => prevPaths.has(b.path) && !/track-visit/.test(b.path)).map((b) => b.path);
          r.reFetched = r.rows.filter((x) => !x.cached && (x.cls === 'static' || x.cls === 'vendor' || x.cls === 'tailwind' || x.cls === 'esm.sh' || x.cls === 'cdn-lib' || x.cls === 'fonts')).map((x) => x.url.replace(BASE + '/', ''));
          r.reParsed = r.rows.filter((x) => x.cached && (x.cls === 'static' || x.cls === 'vendor' || x.cls === 'tailwind' || x.cls === 'esm.sh' || x.cls === 'cdn-lib')).length;
          r.authCalls = r.backend.filter((b) => b.cls === 'auth').map((b) => b.path + ' ' + b.dur + 'ms');
          seq.push(r);
          console.log('  ' + r.label.padEnd(56) + 'click→nav ' + String(r.clickToNavStart).padStart(4) + '  html ' + String(r.responseStart).padStart(4) + '  shell ' + String(r.shellAt == null ? '-' : r.shellAt).padStart(5) + '  fcp ' + String(r.fcp == null ? '-' : r.fcp).padStart(5) + '  usable ' + String(r.dataReady.ms).padStart(6) + '  net ' + kb(r.bytesTotal) + 'KB/' + (r.requests - r.cachedRequests) + ' req  cached ' + r.cachedRequests + '  re-fetched ' + r.reFetched.length + '  backend ' + r.backend.length + ' (repeated ' + r.repeatedBackend.length + ': ' + r.repeatedBackend.map((p) => p.replace(/^(fn|rest):/, '')).join(', ') + ')  auth ' + r.authCalls.length + (r.settled ? '' : '  UNSETTLED'));
          prev = r;
        }
        results.nav[s.name] = seq;
        writeFileSync(outFile, JSON.stringify(results, null, 1));
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      }
      console.log('');
    }

    if (ONLY.includes('glass')) {
      console.log('=== GLASS COST — scroll frame time, same page, backdrop-filter on / off / the whole recipe off / all decoration off (the other two browsers parked on about:blank) ===');
      const park = async (keep) => { for (const [n, b] of Object.entries(browsers)) if (n !== keep) { try { await b.send('Page.navigate', { url: 'about:blank' }); } catch (_e) {} } await sleep(500); };
      for (const [surface, page] of GLASS_PAGES) {
        const cdp = browsers[surface];
        await park(surface);
        await loadPage(cdp, BASE + '/' + page, surface + ' ' + page); await sleep(800);
        console.log(surface + ' ' + page);
        results.glass.push(await glassOn(cdp, surface + ' ' + page));
        writeFileSync(outFile, JSON.stringify(results, null, 1));
      }
      const cdp = browsers.client;
      await park('client');
      await loadPage(cdp, BASE + '/asset-collection.html', 'client asset-collection.html');
      for (let i = 0; i < 40 && !(await cdp.evaluate('document.querySelectorAll("#asset-cards-grid [data-product-id]").length')); i++) await sleep(250);
      console.log('client asset-collection.html — filled to N cards by cloning the real rendered card');
      results.glass.push(await glassOn(cdp, 'client asset-collection.html (filled)', [24, 96, 247]));
      writeFileSync(outFile, JSON.stringify(results, null, 1));
    }
  } finally {
    for (const cdp of Object.values(browsers)) { try { await cdp.close(); } catch (e) { console.error('TEARDOWN: ' + e.message); } }
    await deletePm(admin, pm.id);
    writeFileSync(outFile, JSON.stringify(results, null, 1));
    console.log('\nwritten: ' + outFile);
  }
}
main().then(() => { process.exitCode = 0; }).catch((err) => { console.error('AUDIT FAILED: ' + (err && err.stack || err)); process.exitCode = 1; });
