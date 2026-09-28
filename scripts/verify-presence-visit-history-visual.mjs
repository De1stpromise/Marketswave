// ★ "On the site" — arrival, departure and visit history, in a real browser (register row 281).
//
// The backend suite (verify-presence-visit-history.mjs) proves the four departure states, the
// 30-day window and the gate. This one proves the PAGE: that a seeded visit in each state
// renders with the right chip and the right duration, that selecting a visit loads a journey,
// that grouping shows one person with two devices, and that the whole thing survives a phone.
//
// Seeded, for the reason the backend suite gives: three of the four states cannot be produced
// on demand from a browser — "not recorded" means the beacon did NOT arrive.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, releaseTempDir, forwardChildTeardown, reportSilentChild } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';
import { adminNavItemCount } from './lib/admin-nav-count.mjs';

const NAV_COUNT = adminNavItemCount();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const URL_PAGE = BASE + '/admin-presence.html';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SUFFIX = Math.random().toString(16).slice(2, 8);

let passed = 0; const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label + (detail ? '  [' + detail + ']' : '')); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}
function runChild(script, env, label, expect) {
  const res = spawnSync(process.execPath, [script], { cwd: HERE, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 900000 });
  forwardChildTeardown(res, label);
  if (reportSilentChild) reportSilentChild(res, label, expect);
  return (res.stdout || '') + (res.stderr || '');
}
function runContrast(profile, label, bootstrap, prepare) {
  const out = runChild('verify-contrast.mjs', {
    CONTRAST_PROFILE: profile, CONTRAST_URL: URL_PAGE, CONTRAST_BOOTSTRAP_JS: bootstrap,
    CONTRAST_PREPARE_JS: prepare || '', CONTRAST_WIDTHS: '1440'
  }, 'verify-contrast(' + profile + ')', /CONTRAST: (PASS|FAIL)/);
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ');
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  return m ? Number(m[1]) : 0;
}

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
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 140));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { chrome, ws, send, evaluate };
}
async function phone(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function desktop(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}

// The table is painted by an async read; a sweep on a fixed delay would enumerate the skeleton
// and pass on nothing at all (row 253). Wait for real rows.
const READY = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 200; i++) {
    const l = document.getElementById('presence-list');
    if (l && l.querySelector('tr[data-session]') && document.getElementById('st-live').textContent !== '—') break;
    await nap(200);
  } 
  // The default tab is "live" and only a live session is on it. The exact / about /
  // not-recorded seeds are older by construction, so read them where they actually are.
  const m = document.querySelector('[data-tab=month]'); if (m) m.click();
  for (let i = 0; i < 200; i++) { if (document.querySelectorAll('#presence-list tr[data-session]').length >= 6) break; await nap(200); }
  await nap(600);
  return document.querySelectorAll('#presence-list tr[data-session]').length; })()`;

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60000, DAY = 86400000;

async function main() {
  const stack = localStack();
  const admin = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const pmC = createClient(stack.API_URL, stack.ANON_KEY, { auth: { persistSession: false } });
  const signed = await pmC.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (signed.error) throw new Error('admin sign-in: ' + signed.error.message);
  const bootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(signed.data.session)) + '); true';

  const madeSessions = [], madeVisitors = [], madeUsers = [];
  const profileDir = makeTempDir('mw-presence-');
  let cdp = null;

  // The live window is 45 seconds and the contrast children take minutes, so a seeded live
  // session is long dead by the time the browser phase runs. Re-stamp it immediately before
  // each phase that needs it, rather than widening the window the product actually uses.
  let freshenLive = async () => {};

  try {
    const vid = (n) => SUFFIX + String(n).padStart(2, '0') + '-0000-4000-8000-' + SUFFIX + String(n).padStart(6, '0');
    const created = await admin.auth.admin.createUser({ email: 'presvis-' + SUFFIX + '@invalid.test', password: 'Pw!' + SUFFIX + 'aA1', email_confirm: true });
    if (created.error) throw new Error('client: ' + created.error.message);
    const clientId = created.data.user.id; madeUsers.push(clientId);
    await admin.from('clients').insert({ id: clientId, name: 'Visual Fixture ' + SUFFIX, email: 'presvis-' + SUFFIX + '@invalid.test', account_type: 'Individual Account', status: 'active' });

    for (let n = 1; n <= 7; n++) { const c = vid(n); await admin.from('visitors').insert({ id: c, first_seen_at: iso(20 * DAY), last_seen_at: iso(MIN), visit_count: 1 }); madeVisitors.push(c); }
    const seed = async (row) => { const { error } = await admin.from('visitor_sessions').insert(row); if (error) throw new Error('seed: ' + error.message); madeSessions.push(row.id); };
    const base = (id, cookie, extra) => Object.assign({ id, visitor_id: cookie, visit_number: 1, current_path: '/', page_count: 1,
      journey: [{ p: '/', t: extra.started_at }], country_code: 'SE', country: 'Sweden', city: 'Stockholm',
      device: 'Windows', browser: 'Chrome', referrer_label: 'Google', search_term: 'managed wealth account' }, extra);
    // ONE timestamp: two iso() calls can land a millisecond apart, and a last_seen_at even 1ms
    // after started_at is 'activity after arrival' — which is exactly the state this row is not.
    const UNSEEN = iso(120 * MIN);
    const S = { live: vid(1), exact: vid(2), approx: vid(3), unknown: vid(4), devA: vid(6), devB: vid(7) };
    await seed(base(S.live, vid(1), { started_at: iso(6 * MIN), last_seen_at: iso(5000), ended_at: null, page_count: 3,
      journey: [{ p: '/', t: iso(6 * MIN) }, { p: '/services', t: iso(4 * MIN) }, { p: '/signup', t: iso(5000) }] }));
    await seed(base(S.exact, vid(2), { started_at: iso(70 * MIN), last_seen_at: iso(62 * MIN), ended_at: iso(62 * MIN), page_count: 2,
      journey: [{ p: '/', t: iso(70 * MIN) }, { p: '/about', t: iso(64 * MIN) }] }));
    await seed(base(S.approx, vid(3), { started_at: iso(90 * MIN), last_seen_at: iso(84 * MIN), ended_at: null, page_count: 2,
      journey: [{ p: '/', t: iso(90 * MIN) }, { p: '/resources', t: iso(86 * MIN) }] }));
    await seed(base(S.unknown, vid(4), { started_at: UNSEEN, last_seen_at: UNSEEN, ended_at: null }));
    await seed(base(S.devA, vid(6), { started_at: iso(12 * MIN), last_seen_at: iso(6000), ended_at: null, client_id: clientId,
      client_name: 'Visual Fixture ' + SUFFIX, device: 'Windows', browser: 'Chrome', page_count: 5 }));
    await seed(base(S.devB, vid(7), { started_at: iso(9 * MIN), last_seen_at: iso(7000), ended_at: null, client_id: clientId,
      client_name: 'Visual Fixture ' + SUFFIX, device: 'iPhone', browser: 'Safari', page_count: 2 }));

    freshenLive = async () => {
      const now = new Date().toISOString();
      for (const id of [S.live, S.devA, S.devB]) await admin.from('visitor_sessions').update({ last_seen_at: now }).eq('id', id);
    };
    await freshenLive();

    // ══ contrast, with the sheen composited ══════════════════════════════════════════════
    console.log('\n-- contrast (real composited pixels) --');
    // The page re-renders rows every second (durations tick, sessions drop out of live), which
    // moves a box out from under the probe mid-measurement — row 210's guard reports that as
    // UNMEASURED rather than a ratio. Stop the tickers before measuring colour.
    const STILL = `for (let i = 1; i < 5000; i++) clearInterval(i);`;
    const prepList = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 200; i++) { if (document.querySelector('#presence-list tr[data-session]')) break; await nap(200); }
      const t = document.querySelector('[data-tab=today]'); if (t) t.click();
      for (let i = 0; i < 200; i++) { if (document.querySelector('#presence-list tr[data-session]')) break; await nap(200); }
      await nap(900); ${STILL} await nap(300); })()`;
    const prepDetail = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 200; i++) { if (document.querySelector('#presence-list tr[data-session]')) break; await nap(200); }
      const t = document.querySelector('[data-tab=today]'); if (t) t.click();
      for (let i = 0; i < 200; i++) { if (document.querySelector('#presence-list tr[data-session]')) break; await nap(200); }
      const row = document.querySelector('#presence-list tr[data-session]'); if (!row) throw new Error('no rows to select');
      row.click();
      for (let i = 0; i < 200; i++) { if (document.querySelector('#detail-body .tl-step')) break; await nap(200); }
      await nap(900); ${STILL} await nap(300); })()`;
    const nList = runContrast('visitor-presence', 'list + strip + key', bootstrap, prepList);
    const nDetail = runContrast('visitor-presence-detail', 'detail panel', bootstrap, prepDetail);
    console.log('  (' + nList + ' + ' + nDetail + ' composited measurements)');

    const sheen = runChild('verify-glass-sheen.mjs', { SHEEN_PAGES: 'admin-presence.html', SHEEN_BASE: BASE, SHEEN_PORT: '9471' }, 'verify-glass-sheen', /SHEEN|below/);
    check('sheen: nothing under the sheen falls below 4.5:1', /0 below|SHEEN: PASS/.test(sheen), sheen.split('\n').filter((l) => /below|SHEEN/.test(l)).join(' | '));
    const fonts = runChild('verify-fonts.mjs', { AUDIT_URL: URL_PAGE, AUDIT_BOOTSTRAP_JS: bootstrap, AUDIT_PORT: '9473' }, 'verify-fonts', /FONT AUDIT: /);
    check('fonts: Inter only, no fallback and no monospace', /FONT AUDIT: all requested families genuinely loaded/.test(fonts) && !/mono/i.test(fonts), fonts.split('\n').filter((l) => /FONT AUDIT|FALLBACK|mono/i.test(l)).join(' | '));

    // ══ the page itself ══════════════════════════════════════════════════════════════════
    console.log('\n-- the rendered page --');
    await freshenLive();
    cdp = await connect(profileDir);
    await desktop(cdp, 1440);
    await cdp.send('Page.navigate', { url: BASE + '/admin-login.html' });
    await sleep(1200);
    await cdp.evaluate(bootstrap);
    await cdp.send('Page.navigate', { url: URL_PAGE });
    const rowCount = await cdp.evaluate(READY);
    check('GUARD: the table rendered real rows (a skeleton read would make the rest vacuous)', rowCount >= 6, String(rowCount));

    const nav = await cdp.evaluate(`(() => { const a = document.getElementById('admin-sidebar-aside'); if (!a) return { missing: true };
      const items = [...a.querySelectorAll('.an-item')];
      return { count: items.length, on: items.filter(i => i.classList.contains('is-on')).map(i => (i.querySelector('.an-lb')||{}).textContent),
        logout: !!document.getElementById('admin-logout-btn'), bg: getComputedStyle(a).backgroundColor }; })()`);
    check('★ the nav rail is mounted, with every item', !nav.missing && nav.count === NAV_COUNT, JSON.stringify(nav));
    check('★ "On the site" is the active item', (nav.on || []).length === 1 && /On the site/i.test(nav.on[0]), JSON.stringify(nav.on));
    check('★ Log out is reachable', !!nav.logout);

    const read = `(() => {
      const rows = [...document.querySelectorAll('#presence-list tr[data-session]')];
      const cell = (id, sel) => { const tr = rows.find(r => r.dataset.session === id); return tr ? (tr.querySelector(sel) || {}).textContent : null; };
      const chip = (id) => { const tr = rows.find(r => r.dataset.session === id); const c = tr && tr.querySelector('.dep-conf'); return c ? { cls: [...c.classList].filter(x => x !== 'dep-conf').join(' '), text: c.textContent.trim() } : null; };
      return { ids: rows.map(r => r.dataset.session),
        chips: { live: chip('%LIVE%'), exact: chip('%EXACT%'), approx: chip('%APPROX%'), unknown: chip('%UNKNOWN%') },
        durs: { live: cell('%LIVE%', '[data-dur]'), exact: cell('%EXACT%', '[data-dur]'), approx: cell('%APPROX%', '[data-dur]'), unknown: cell('%UNKNOWN%', '[data-dur]') },
        keyCards: document.querySelectorAll('#departure-key > div').length,
        retention: (document.getElementById('retention-note') || {}).textContent,
        detailEmpty: (document.getElementById('detail-body') || {}).textContent };
    })()`.replace(/%LIVE%/g, S.live).replace(/%EXACT%/g, S.exact).replace(/%APPROX%/g, S.approx).replace(/%UNKNOWN%/g, S.unknown);
    // The live window is 45 seconds and everything above it — spawning Chrome, the two
    // navigations, waiting for six rows — takes longer than that, so the "live" seed has
    // genuinely aged out by now and the page correctly reclassifies it. Re-stamp it and
    // reload, so the read below is of a session that is live at the moment it is read.
    await freshenLive();
    await cdp.send('Page.navigate', { url: URL_PAGE });
    const rows2 = await cdp.evaluate(READY);
    check('GUARD: still six rows after the reload', rows2 >= 6, String(rows2));

    const r = await cdp.evaluate(read);
    check('★ the "on the site now" chip renders in its own tone', r.chips.live && /dep-now/.test(r.chips.live.cls), JSON.stringify(r.chips.live));
    check('★ the "exact" chip renders in its own tone', r.chips.exact && /dep-exact/.test(r.chips.exact.cls), JSON.stringify(r.chips.exact));
    check('★ the "about" chip renders in its own tone, and says the tolerance', r.chips.approx && /dep-about/.test(r.chips.approx.cls) && /15/.test(r.chips.approx.text), JSON.stringify(r.chips.approx));
    check('★ the "not recorded" chip renders in its own tone', r.chips.unknown && /dep-none/.test(r.chips.unknown.cls), JSON.stringify(r.chips.unknown));
    check('★ a visit with no recorded departure shows "Under 15 s", NEVER a zero duration',
      /Under/.test(r.durs.unknown || '') && !/^0/.test((r.durs.unknown || '').trim()), r.durs.unknown);
    check('★ a visit with a known departure shows a real duration, not a dash',
      /\d/.test(r.durs.exact || '') && !/Under/.test(r.durs.exact || ''), r.durs.exact);
    check('the key explains all four states, in the same words the column uses', r.keyCards === 4, String(r.keyCards));
    check('★ the retention and IP note is on the page, where a PM reads the data',
      /30 days/.test(r.retention || '') && /IP addresses are never stored/i.test(r.retention || ''), r.retention);
    check('the detail panel starts with an honest empty state, not a blank box', /No visit selected/.test(r.detailEmpty || ''));

    // selecting a visit loads its journey — the one read that carries a journey at all
    const det = await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      const tr = [...document.querySelectorAll('#presence-list tr[data-session]')].find(x => x.dataset.session === ${JSON.stringify(S.live)});
      if (!tr) return { noRow: true };
      tr.click();
      for (let i = 0; i < 150; i++) { if (document.querySelector('#detail-body .tl-step')) break; await nap(200); }
      const steps = [...document.querySelectorAll('#detail-body .tl-step')];
      return { steps: steps.length, pages: steps.map(s => (s.querySelector('.tl-p')||{}).textContent),
        selected: document.querySelectorAll('#presence-list tr.is-selected').length,
        tiles: [...document.querySelectorAll('#detail-body .grid-cols-3 p:last-child')].map(p => p.textContent) }; })()`);
    check('★ selecting a visit loads its journey — three pages for a three-page visit', det.steps === 3, JSON.stringify(det));
    check('★ ...with the real pages on it', (det.pages || []).join('|').includes('signup'), JSON.stringify(det.pages));
    check('the selected row is marked as selected', det.selected === 1, String(det.selected));
    check('a still-here visit says so rather than inventing a departure time', (det.tiles || [])[1] === 'Still here', JSON.stringify(det.tiles));

    // grouping
    const grp = await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelector('[data-view=people]').click();
      for (let i = 0; i < 150; i++) { if (document.querySelector('#presence-list tr.is-group')) break; await nap(150); }
      const g = [...document.querySelectorAll('#presence-list tr.is-group')];
      const mine = g.find(x => /Visual Fixture/.test(x.textContent));
      return { groups: g.length, note: mine ? mine.textContent : null,
        subrows: document.querySelectorAll('#presence-list tr.is-subrow').length,
        viewNote: (document.getElementById('view-note')||{}).textContent }; })()`);
    check('★ one client on two devices renders as ONE person', !!grp.note, JSON.stringify(grp).slice(0, 160));
    check('★ ...and says both devices are on the site at once', /2 devices, 2 at once/.test(grp.note || ''), (grp.note || '').slice(0, 120));
    check('the two visits stay visible beneath the group, not hidden by it', grp.subrows >= 2, String(grp.subrows));
    check('★ the page states the grouping rule rather than leaving it to be inferred',
      /anonymous visitors group per browser/i.test(grp.viewNote || ''), grp.viewNote);

    // ══ controls and the phone ═══════════════════════════════════════════════════════════
    console.log('\n-- controls and the phone --');
    await freshenLive();
    const CONTROLS = `(() => {
      const els = [...document.querySelectorAll('button, [role=button], select, input:not([type=checkbox]):not([type=radio]), textarea, a.flex, a.inline-flex')]
        .filter(e => e.offsetParent !== null && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none');
      const small = els.map(e => { const r = e.getBoundingClientRect(); return { t: e.tagName + '.' + (e.className||'').toString().split(' ').slice(0,2).join('.'), w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10 }; })
        .filter(x => (x.w > 0 && x.h > 0) && (x.h < 44 || x.w < 44));
      const rects = [...document.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
      const panel = document.getElementById('detail-panel'), list = document.getElementById('presence-panel');
      const pr = panel ? panel.getBoundingClientRect() : null, lr = list ? list.getBoundingClientRect() : null;
      return { inner: innerWidth, dpr: devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches, noHover: matchMedia('(hover: none)').matches,
        total: els.length, small, bodyScroll: document.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)),
        stacked: pr && lr ? pr.top >= lr.bottom - 1 : null, panelPos: panel ? getComputedStyle(panel).position : null }; })()`;

    await desktop(cdp, 1440);
    await sleep(700);
    const wide = await cdp.evaluate(CONTROLS);
    check('desktop: the detail panel sits BESIDE the table, not beneath it', wide.stacked === false, JSON.stringify({ stacked: wide.stacked, pos: wide.panelPos }));

    for (const w of [390, 375, 320]) {
      if (w === 320) break;   // 320 goes through a real iframe below — the override floors at ~348
      await phone(cdp, w);
      await sleep(900);
      const m = await cdp.evaluate(CONTROLS);
      check(w + 'px: a REAL phone profile (coarse pointer, no hover, dpr 3)', m.inner === w && m.coarse && m.noHover && m.dpr === 3, JSON.stringify({ inner: m.inner, coarse: m.coarse, dpr: m.dpr }));
      check(w + 'px: every control is at least 44x44', m.small.length === 0, JSON.stringify(m.small).slice(0, 220));
      check(w + 'px: nothing overflows the viewport', m.bodyScroll <= w + 1 && m.maxRight <= w + 1, 'scroll=' + m.bodyScroll + ' right=' + Math.round(m.maxRight));
      check('★ ' + w + 'px: the detail panel stacks BENEATH the table', m.stacked === true && m.panelPos === 'static', JSON.stringify({ stacked: m.stacked, pos: m.panelPos }));
      check(w + 'px: the guard saw real controls (non-vacuity)', m.total >= 8, String(m.total));
    }

    // 320 through a real same-origin iframe
    await freshenLive();
    await desktop(cdp, 1400);
    await cdp.send('Page.navigate', { url: BASE + '/admin-login.html' });
    await sleep(1000);
    const frame = await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      const f = document.createElement('iframe'); f.style.cssText = 'width:320px;height:900px;border:0'; f.src = ${JSON.stringify(URL_PAGE)};
      document.body.appendChild(f);
      for (let i = 0; i < 240; i++) { try { if (f.contentDocument && f.contentDocument.querySelector('#presence-list tr[data-session]')) break; } catch (e) {} await nap(250); }
      try { const mt = f.contentDocument.querySelector('[data-tab=month]'); if (mt) mt.click(); } catch (e) {}
      for (let i = 0; i < 200; i++) { try { if (f.contentDocument.querySelectorAll('#presence-list tr[data-session]').length >= 6) break; } catch (e) {} await nap(200); }
      await nap(900);
      const d = f.contentDocument, w = f.contentWindow;
      const els = [...d.querySelectorAll('button, [role=button], select, a.flex, a.inline-flex')].filter(e => e.offsetParent !== null);
      const small = els.map(e => { const r = e.getBoundingClientRect(); return { t: e.tagName, w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w > 0 && (x.h < 44 || x.w < 44));
      const panel = d.getElementById('detail-panel'), list = d.getElementById('presence-panel');
      const rects = [...d.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
      return { inner: w.innerWidth, rows: d.querySelectorAll('#presence-list tr[data-session]').length, total: els.length, small,
        bodyScroll: d.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)),
        stacked: panel && list ? panel.getBoundingClientRect().top >= list.getBoundingClientRect().bottom - 1 : null }; })()`);
    check('320px (real iframe): the page rendered real rows', frame.inner === 320 && frame.rows >= 6, JSON.stringify({ inner: frame.inner, rows: frame.rows }));
    check('320px: every control is at least 44x44', frame.small.length === 0, JSON.stringify(frame.small).slice(0, 220));
    check('320px: nothing overflows', frame.bodyScroll <= 321 && frame.maxRight <= 321, 'scroll=' + frame.bodyScroll + ' right=' + Math.round(frame.maxRight));
    check('★ 320px: the detail panel stacks beneath the table', frame.stacked === true, String(frame.stacked));

    console.log('\n' + '='.repeat(70));
    console.log(passed + '/' + (passed + fails.length) + ' assertions passed.');
    if (fails.length) { console.log('\nFAILURES:'); fails.forEach((f) => console.log('  - ' + f)); }
    console.log(fails.length ? '\nPRESENCE VISUAL: FAIL' : '\nPRESENCE VISUAL: PASS');
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (_e) {} try { cdp.chrome.kill(); } catch (_e) {} }
    await releaseTempDir(profileDir);
    for (const id of madeSessions) await admin.from('visitor_sessions').delete().eq('id', id);
    for (const id of madeVisitors) await admin.from('visitors').delete().eq('id', id);
    for (const id of madeUsers) { await admin.from('clients').delete().eq('id', id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
    console.log('cleanup: removed ' + madeSessions.length + ' sessions, ' + madeVisitors.length + ' visitors, ' + madeUsers.length + ' users');
  }
  process.exit(fails.length ? 1 : 0);
}

runVerifyMain(main, { watchdogMs: 20 * 60 * 1000 });
