#!/usr/bin/env node
// verify-pm-overview-visual.mjs — PM tool revamp, part 2: the ten-item sidebar, the briefing
// and the Approvals landing in a real browser (2026-09-14).
//
//   npm run verify-pm-overview-visual      (from scripts/)
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
//
// COVERS, in a real headless Chrome over CDP: the sidebar on every admin page — exactly ten
// items in the brief's order, no group headers, no Support entry, the seven queue pages
// highlighting "Approvals", the Approvals and Inbox counts equal to independent DB reads, the
// green dot on "On the site" while a real session is live (and its hidden count), the footer
// carrying the role and the real sign-in email with no display name, a real Log out control;
// contrast on every panel with the sheen composited (verify-contrast.mjs profiles pm-overview
// / pm-approvals, plus audit-glass-sheen.mjs on both pages); fonts by real advance width; the
// layout at 1440 / 390 / 375 and a real 320px iframe (viewport-integrity guarded, since the
// top-level override floors at 348px on this build — row 170).
import { execSync, spawnSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8765';
const PASSWORD = 'OverviewVis-2026!';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9449;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: SCRIPTS_DIR + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
function runChild(script, label, env) {
  const res = spawnSync(process.execPath, [script], { cwd: SCRIPTS_DIR, encoding: 'utf8', env: Object.assign({}, process.env, env) });
  forwardChildTeardown(res, label);
  const out = (res.stdout || '') + (res.stderr || '');
  if (!out.trim()) console.log('  ' + label + ' -> (no output; status ' + res.status + ', signal ' + res.signal + ')');
  return out;
}
function runContrast(profile, page, label, bootstrap, prepare) {
  const out = runChild('verify-contrast.mjs', 'verify-contrast', { CONTRAST_PROFILE: profile, CONTRAST_URL: BASE + '/' + page, CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare || '', CONTRAST_SETTLE_MS: '30000', CONTRAST_PORT: '9337' });
  const tail = out.trim().split('\n').slice(-2).join(' | ');
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + tail);
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  out.split('\n').filter((l) => /FAIL\s+\d|UNMEASURED\s/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}
function runFonts(page, label, bootstrap) {
  const out = runChild('audit-fonts.mjs', 'audit-fonts', { AUDIT_URL: BASE + '/' + page, AUDIT_BOOTSTRAP_JS: bootstrap });
  console.log('  ' + label + ' fonts -> ' + out.trim().split('\n').slice(-1)[0]);
  check(label + ': no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check(label + ': no monospace family anywhere — the scheme is Inter (row 192)', !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}
function runSheen(pages, label) {
  const out = runChild('audit-glass-sheen.mjs', 'audit-glass-sheen', { SHEEN_PAGES: pages, SHEEN_PORT: '9457' });
  const tail = out.trim().split('\n').slice(-1)[0];
  console.log('  ' + label + ' sheen -> ' + tail);
  const m = out.match(/(\d+) measured, (\d+) below/);
  check(label + ': the sheen audit measured text under a sheen and found none below 4.5:1', !!m && Number(m[1]) > 0 && Number(m[2]) === 0 && !/UNMEASURED/.test(out), tail);
  out.split('\n').filter((l) => /below|UNMEASURED/.test(l) && !/0 below/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}

async function connectChrome() {
  const profile = makeTempDir('mw-ovvis-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); }
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

// Waits for a page's sidebar (and, on the overview, the briefing) to render.
const WAIT = `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) {
    const nav = document.querySelectorAll('.an-item').length === 10;
    const brief = !document.getElementById('panel-health') || /Price refresh|Try Again|try again/i.test(document.getElementById('panel-health').textContent);
    const appr = !document.getElementById('approvals-total') || document.getElementById('approvals-total').textContent !== '—';
    if (nav && brief && appr && document.readyState === 'complete') break;
    await nap(200);
  }
  await nap(600);
  return true;
})()`;
const SIDEBAR = `(() => {
  const items = [...document.querySelectorAll('#admin-sidebar-aside .an-item')];
  const badge = (id) => { const b = document.getElementById(id); return b ? { hidden: b.hidden, text: b.textContent.trim(), display: getComputedStyle(b).display } : null; };
  const aside = document.getElementById('admin-sidebar-aside');
  return {
    labels: items.map(i => i.querySelector('.an-lb').textContent),
    on: items.filter(i => i.classList.contains('is-on')).map(i => i.querySelector('.an-lb').textContent),
    hrefs: items.map(i => i.getAttribute('href')),
    groupHeaders: aside.querySelectorAll('p.uppercase, .ngrp').length,
    approvals: badge('sidebar-approvals-count'), inbox: badge('sidebar-inbox-count'), presence: badge('sidebar-presence-count'),
    role: (document.querySelector('.an-nm b') || {}).textContent, email: (document.getElementById('admin-sidebar-email') || {}).textContent,
    footerText: (document.querySelector('.an-foot') || {}).textContent,
    logout: !!document.getElementById('admin-logout-btn'), logoutLabel: (document.getElementById('admin-logout-btn') || {}).getAttribute && document.getElementById('admin-logout-btn').getAttribute('aria-label'),
    railBg: getComputedStyle(aside).backgroundColor, asideW: Math.round(aside.getBoundingClientRect().width), asideVisible: getComputedStyle(aside).transform === 'none' || aside.getBoundingClientRect().left >= 0
  };
})()`;
const LAYOUT = `(() => {
  const r = (el) => el ? el.getBoundingClientRect() : null;
  const cols = getComputedStyle(document.querySelector('.ov-cols')).gridTemplateColumns.split(' ').length;
  const att = getComputedStyle(document.querySelector('.ov-att')).gridTemplateColumns.split(' ').length;
  const all = [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().width > 0 && !e.classList.contains('blob')); // the decorative blob sits past the edge by design, clipped by main's overflow-x-hidden (row 152)
  const maxRight = Math.max(...all.map(e => e.getBoundingClientRect().right));
  const urgent = document.querySelector('.ov-ac.is-urgent');
  return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, docScroll: document.documentElement.scrollWidth, cols, att, maxRight,
    urgentBg: urgent ? getComputedStyle(urgent).backgroundImage.slice(0, 80) : null, urgentColor: urgent ? getComputedStyle(urgent.querySelector('.ov-v')).color : null,
    panels: document.querySelectorAll('.ov-card').length, hot: document.querySelectorAll('.ov-rage.is-hot').length, needsRows: document.querySelectorAll('#panel-needs .ov-r').length,
    hzWarn: document.querySelectorAll('.ov-hz .d-warn, .ov-hz .d-bad').length };
})()`;
const NARROW = (page) => `(async () => {
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 80 && !document.body; i++) await nap(100);
  const f = document.createElement('iframe'); f.style.cssText = 'width:320px;height:1200px;border:0'; f.src = '/' + ${JSON.stringify(page)};
  document.body.appendChild(f); await new Promise(r => f.addEventListener('load', r));
  const d = f.contentDocument, w = f.contentWindow;
  for (let i = 0; i < 300; i++) { if (d.querySelectorAll('.an-item').length === 10 && (!d.getElementById('panel-health') || /Price refresh|Try Again/i.test(d.getElementById('panel-health').textContent)) && (!d.getElementById('approvals-total') || d.getElementById('approvals-total').textContent !== '—')) break; await nap(200); }
  await nap(600);
  const all = [...d.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().width > 0 && !e.classList.contains('blob'));
  const aside = d.getElementById('admin-sidebar-aside');
  const toggle = d.getElementById('admin-sidebar-toggle-btn');
  const before = { reported: d.documentElement.clientWidth, inner: w.innerWidth, bodyScroll: d.body.scrollWidth, maxRight: Math.max(...all.map(e => e.getBoundingClientRect().right)), asideOff: aside.getBoundingClientRect().right <= 0, att: getComputedStyle(d.querySelector('.ov-att')).gridTemplateColumns.split(' ').length, toggleVisible: getComputedStyle(toggle).display !== 'none' };
  toggle.click(); await nap(500);
  const items = [...aside.querySelectorAll('.an-item')];
  const after = { asideOpen: aside.getBoundingClientRect().left === 0, asideW: Math.round(aside.getBoundingClientRect().width), items: items.length, closeVisible: getComputedStyle(d.getElementById('admin-sidebar-close-btn')).display !== 'none', closeH: Math.round(d.getElementById('admin-sidebar-close-btn').getBoundingClientRect().height), itemH: Math.min(...items.map(i => Math.round(i.getBoundingClientRect().height))), logoutW: Math.round(d.getElementById('admin-logout-btn').getBoundingClientRect().width), emailVisible: d.getElementById('admin-sidebar-email').getBoundingClientRect().width > 0 };
  return { before, after };
})()`;

async function main() {
  console.log('PM tool revamp, part 2 — the sidebar, the briefing and the Approvals landing: visual verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const users = []; const convoIds = []; const productIds = []; const sessionIds = []; let visitorRowId = null; let keepAlive = null;
  const now = Date.now(); const H = 3600e3; const DAY = 24 * H; const iso = (t) => new Date(t).toISOString();
  const anonForPm = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const adminSigned = await anonForPm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (adminSigned.error) throw new Error('admin sign-in: ' + adminSigned.error.message);
  const pmId = adminSigned.data.user.id; const pmEmail = adminSigned.data.user.email;
  const { data: pmVisitBefore } = await admin.from('pm_visits').select('*').eq('user_id', pmId).maybeSingle();
  const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(adminSigned.data.session)) + '); true';

  async function makeClient(name, status) {
    const email = 'ovvis-' + name.toLowerCase().replace(/\s+/g, '-') + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error(error.message);
    users.push(data.user.id);
    const ins = await admin.from('clients').insert({ id: data.user.id, name, email: 'ovvis-malformed-' + name.toLowerCase().replace(/\s+/g, '-') + '-' + suffix, phone: '+46 70 000 0000', account_type: 'Individual Account', status });
    if (ins.error) throw new Error(ins.error.message);
    return { id: data.user.id, email, name };
  }

  try {
    // ---- seed: enough real state that every tone on every panel is measured for real
    const A = await makeClient('Tomas Karlsson', 'active');
    const B = await makeClient('Johan Lindberg', 'pending_review');
    const C = await makeClient('Erik Hovland', 'active');
    const { data: prods } = await admin.from('products').select('id, name, unit_price').eq('pricing_model', 'market').limit(1);
    const P = prods[0];
    await admin.from('account_state').insert([{ client_id: A.id, unallocated_capital: 42400, allocated_capital: 60000, asset_returns: 0 }, { client_id: C.id, unallocated_capital: 27900, allocated_capital: 0, asset_returns: 0 }]);
    await admin.from('holdings').insert({ client_id: A.id, product_id: P.id, units: 60000 / Number(P.unit_price), cost_basis: 60000 });
    await admin.from('transactions').insert({ client_id: A.id, type: 'DEPOSIT', total_value: 102400, status: 'completed' });
    await admin.from('withdrawal_requests').insert({ client_id: A.id, method: 'bank', requested_amount: 40000, currency: 'USD', destination_details: {}, status: 'pending', requested_at: iso(now - 3 * DAY) });
    await admin.from('deposit_requests').insert({ client_id: A.id, method: 'crypto', currency: 'BTC', network: 'Bitcoin', tx_hash: 'abc', details: {}, status: 'pending', requested_at: iso(now - 5 * H) });
    await admin.from('allocation_requests').insert({ client_id: A.id, product_id: P.id, requested_amount: 5000, status: 'pending', requested_at: iso(now - 6 * H) });
    async function convo(row) { const { data, error } = await admin.from('conversations').insert(row).select('id').single(); if (error) throw new Error(error.message); convoIds.push(data.id); return data.id; }
    async function msg(row) { const { error } = await admin.from('messages').insert(row); if (error) throw new Error(error.message); }
    const t1 = await convo({ client_id: A.id, contact_email: 'ovvis-malformed-tomas-karlsson-' + suffix, contact_name: A.name, kind: 'ticket', category: 'Transaction Issue', display_id: 'DISP-0003', status: 'in_progress' });
    await msg({ conversation_id: t1, channel: 'chat', direction: 'inbound', body: 'Still showing pending this morning.', sent_at: iso(now - 12 * 60000) });
    const e1 = await convo({ contact_email: 'ovvis-cold-' + suffix + '@example.com', contact_name: 'Sofia Berg', kind: 'email', subject: 'Fees', status: 'open' });
    await msg({ conversation_id: e1, channel: 'email', direction: 'inbound', body: 'What are your fees?', sent_at: iso(now - 15 * 60000), message_id: '<ovvis-' + suffix + '@example.com>' });
    const pk = await admin.from('hys_pockets').insert([
      { client_id: A.id, pocket_type: 'fixed', amount: 52400, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5, maturity_date: iso(now - 20 * 60000), projected_interest: 2227, funding_method: 'bank account', created_at: iso(now - 182 * DAY) },
      { client_id: A.id, pocket_type: 'fixed', amount: 10000, status: 'active', term_mode: 'short', term_months: 3, term_label: '3 Months', rate: 6, term_in_years: 0.25, maturity_date: iso(now + 4 * DAY), projected_interest: 150, funding_method: 'bank account', created_at: iso(now - 88 * DAY) }
    ]);
    if (pk.error) throw new Error(pk.error.message);
    const navOver = 'PROD-OVV-' + suffix.toUpperCase(); productIds.push(navOver);
    const lastValued = iso(now - 100 * DAY).slice(0, 10);
    const pins = await admin.from('products').insert({ id: navOver, name: 'Nordic Growth Fund II ' + suffix, asset_class: 'Private Equity', investment_type: 'Fund', risk_tier: 'aggressive', minimum_investment: 10000, unit_price: 646.04, inception_unit_price: 500, pricing_model: 'appraisal', last_tick_date: lastValued, created_at: iso(now - 400 * DAY) });
    if (pins.error) throw new Error(pins.error.message);
    await admin.from('product_documents').insert({ product_id: navOver, status: 'published', content: { sections: [{ key: 'terms', horizon: '5 years', valuationFrequency: 'Quarterly', fees: '2%' }] }, published_content: { sections: [{ key: 'terms', horizon: '5 years', valuationFrequency: 'Quarterly', fees: '2%' }] } });
    await admin.from('documents').insert({ client_id: A.id, filename: 'Advisory agreement.pdf', category: 'Contracts', direction: 'from', status: 'Signature Required', created_at: iso(now - 10 * DAY) });
    const { data: ws } = await admin.from('watchlist_symbols').insert({ client_id: A.id, symbol: 'OVV' + suffix.toUpperCase().slice(0, 4), name: 'Overview Sym', source: 'finnhub', asset_type: 'stock' }).select('id').single();
    await admin.from('price_alerts').insert({ client_id: A.id, watchlist_symbol_id: ws.id, symbol: 'OVV' + suffix.toUpperCase().slice(0, 4), direction: 'above', target_price: 10, status: 'fired', fired_at: iso(now - DAY), fired_price: 11 });
    visitorRowId = crypto.randomUUID();
    await admin.from('visitors').insert({ id: visitorRowId, visit_count: 3, first_seen_at: iso(now - 2 * DAY), last_seen_at: iso(now) });
    const s1 = await admin.from('visitor_sessions').insert({ id: crypto.randomUUID(), visitor_id: visitorRowId, visit_number: 3, started_at: iso(now - 6 * 60000), last_seen_at: iso(now), current_path: '/signup', page_count: 2, journey: [{ p: '/', t: iso(now - 6 * 60000) }, { p: '/signup', t: iso(now - 60000) }], city: 'London', country: 'United Kingdom', country_code: 'GB' }).select('id').single();
    sessionIds.push(s1.data.id);
    keepAlive = setInterval(() => { admin.from('visitor_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s1.data.id).then(() => {}); }, 15000);
    await admin.from('pm_visits').upsert({ user_id: pmId, email: pmEmail, session_started_at: iso(now - 50 * 60000), last_seen_at: iso(now - 40 * 60000), previous_session_last_seen_at: null });

    // Independent expectations for the sidebar counts.
    async function expectedCounts() {
      let approvals = 0;
      for (const t of ['deposit_requests', 'withdrawal_requests', 'allocation_requests', 'sell_requests', 'hys_deposit_requests', 'hys_withdrawal_requests', 'profile_change_requests']) approvals += (await admin.from(t).select('id').eq('status', 'pending')).data.length;
      approvals += (await admin.from('clients').select('id').eq('status', 'pending_review')).data.length;
      const inbox = (await admin.from('conversations').select('id').eq('unread_by_pm', true).neq('status', 'archived')).data.length;
      const live = (await admin.from('visitor_sessions').select('id').gte('last_seen_at', new Date(Date.now() - 45000).toISOString()).is('ended_at', null)).data.length;
      return { approvals, inbox, live };
    }

    console.log('--- Contrast: real composited pixels, sheen ON ---\n');
    const PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.an-item').length === 10 && /Price refresh/.test(document.getElementById('panel-health').textContent) && !document.getElementById('sidebar-approvals-count').hidden) break; await nap(200); } await nap(800); })()`;
    runContrast('pm-overview', 'admin.html', 'admin.html (briefing)', adminBootstrap, PREP);
    const PREP_APPR = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.an-item').length === 10 && document.getElementById('approvals-total').textContent !== '—' && document.querySelector('[data-oldest].ov-hot')) break; await nap(200); } await nap(800); })()`;
    runContrast('pm-approvals', 'admin-approvals.html', 'admin-approvals.html (landing)', adminBootstrap, PREP_APPR);
    runSheen('admin.html,admin-approvals.html', 'admin.html + admin-approvals.html');

    console.log('\n--- Fonts ---\n');
    runFonts('admin.html', 'admin.html', adminBootstrap);

    console.log('\n--- The sidebar on real pages, and the layout at 1440 / 390 / 375 + a real 320px iframe ---\n');
    const cdp = await connectChrome();
    try {
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(800);
      await cdp.evaluate(adminBootstrap);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: BASE + '/admin.html' }); await cdp.evaluate(WAIT);
      const sb = await cdp.evaluate(SIDEBAR);
      const exp = await expectedCounts();
      check('★ exactly ten items, in the brief\'s order, ungrouped', sb.labels.join(' · ') === 'Overview · Approvals · Inbox · Clients · On the site · Products · Deposit addresses · Documents · Advisory fee · Security' && sb.groupHeaders === 0, sb.labels.join(' · ') + ' / headers=' + sb.groupHeaders);
      check('no Support entry survives', !sb.labels.some((l) => /support/i.test(l)) && !sb.hrefs.some((h) => /admin-support/.test(h)));
      check('Overview is the active item on admin.html', sb.on.join() === 'Overview', sb.on.join());
      check('★ the Approvals count equals an independent sum of every pending queue + applications (' + exp.approvals + ')', sb.approvals && !sb.approvals.hidden && sb.approvals.text === String(exp.approvals), JSON.stringify(sb.approvals));
      check('★ the Inbox count equals an independent count of conversations needing a reply (' + exp.inbox + ')', sb.inbox && !sb.inbox.hidden && sb.inbox.text === String(exp.inbox), JSON.stringify(sb.inbox));
      check('★ "On the site" shows a green dot, not a number — the real count is held for assistive tech (' + exp.live + ')', sb.presence && !sb.presence.hidden && sb.presence.display === 'block' && sb.presence.text === String(exp.live) && exp.live >= 1, JSON.stringify(sb.presence));
      check('the footer carries the role and the real sign-in email, no display name', sb.role === 'Portfolio manager' && sb.email === pmEmail && !/Internal access/.test(sb.footerText), JSON.stringify({ role: sb.role, email: sb.email }));
      check('a real Log out control', sb.logout && sb.logoutLabel === 'Log out');
      check('the rail is the vocabulary\'s #0F172A, 238px wide at desktop', sb.railBg === 'rgb(15, 23, 42)' && sb.asideW === 238, sb.railBg + ' ' + sb.asideW);
      const lay = await cdp.evaluate(LAYOUT);
      check('1440px: the viewport is genuinely 1440 (integrity guard)', lay.inner === 1440, String(lay.inner));
      check('1440px: four attention cards across, two panel columns, no horizontal overflow', lay.att === 4 && lay.cols === 2 && lay.bodyScroll <= 1440 && lay.maxRight <= 1441, JSON.stringify(lay));
      check('1440px: the overdue card is the amber urgent card with an amber figure; hot ages and a degraded health line are on screen', /255, 251, 235|rgba\(255, 251, 235/.test(lay.urgentBg) && lay.urgentColor === 'rgb(180, 83, 9)' && lay.hot >= 1 && lay.hzWarn >= 1 && lay.panels === 8, JSON.stringify(lay));

      // A queue page highlights Approvals (alias), and the badges persist across pages.
      await cdp.send('Page.navigate', { url: BASE + '/admin-deposits.html' }); await cdp.evaluate(WAIT);
      const sbQ = await cdp.evaluate(SIDEBAR);
      check('★ on admin-deposits.html the active item is "Approvals" (the seven queue pages alias to it)', sbQ.on.join() === 'Approvals', sbQ.on.join());
      check('the counts render on a queue page too', sbQ.approvals && sbQ.approvals.text === String(exp.approvals) && sbQ.inbox && sbQ.inbox.text === String(exp.inbox));
      await cdp.send('Page.navigate', { url: BASE + '/admin-inbox.html' }); await cdp.evaluate(WAIT);
      const sbI = await cdp.evaluate(SIDEBAR);
      check('on admin-inbox.html the active item is Inbox', sbI.on.join() === 'Inbox', sbI.on.join());
      await cdp.send('Page.navigate', { url: BASE + '/admin-approvals.html' }); await cdp.evaluate(WAIT);
      const sbA = await cdp.evaluate(SIDEBAR);
      const links = await cdp.evaluate(`[...document.querySelectorAll('#approval-queues a')].map(a => a.getAttribute('href'))`);
      check('the Approvals item opens the landing, which is its active page', sbA.on.join() === 'Approvals');
      check('★ the seven queue pages are all reachable from the landing', ['admin-client-applications.html', 'admin-deposits.html', 'admin-withdrawals.html', 'admin-allocations.html', 'admin-sells.html', 'admin-hys.html', 'admin-profile-updates.html'].every((h) => links.indexOf(h) !== -1), links.join(','));
      // Log out is real: click it and land on the login page with no session.
      await cdp.evaluate('document.getElementById("admin-logout-btn").click(); true');
      await sleep(3500);
      const where = await cdp.evaluate('location.pathname + "|" + String(localStorage.getItem("sb-marketswave-admin-auth-token"))');
      check('Log out ends the session and lands on admin-login.html', /admin-login\.html\|null$/.test(where), where);
      await cdp.evaluate(adminBootstrap);

      for (const width of [390, 375]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: true });
        await cdp.send('Page.navigate', { url: BASE + '/admin.html' }); await cdp.evaluate(WAIT);
        const l = await cdp.evaluate(LAYOUT);
        check(width + 'px: the viewport is genuinely ' + width + ' (integrity guard)', l.inner === width, String(l.inner));
        check(width + 'px: one attention card per row, one panel column, no horizontal overflow', l.att === 1 && l.cols === 1 && l.bodyScroll <= width && l.docScroll <= width && l.maxRight <= width + 1, JSON.stringify(l));
        const s = await cdp.evaluate(SIDEBAR);
        check(width + 'px: the sidebar is the off-canvas drawer, still ten items', s.labels.length === 10 && !s.asideVisible, JSON.stringify({ n: s.labels.length, visible: s.asideVisible }));
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(800);
      const n = await cdp.evaluate(NARROW('admin.html'));
      check('320px: the iframe genuinely reports 320px', n.before.reported === 320, JSON.stringify(n.before));
      check('320px: one attention card per row, nothing escapes the viewport, the drawer is off-canvas with a visible toggle', n.before.att === 1 && n.before.bodyScroll <= 320 && n.before.maxRight <= 321 && n.before.asideOff && n.before.toggleVisible, JSON.stringify(n.before));
      check('320px: the toggle opens the drawer with all ten items, a 44px close control, 38px+ rows, a 44px+ Log out, the email visible', n.after.asideOpen && n.after.items === 10 && n.after.closeVisible && n.after.closeH >= 44 && n.after.itemH >= 38 && n.after.logoutW >= 44 && n.after.emailVisible, JSON.stringify(n.after));
    } finally {
      await cdp.close();
    }
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    console.log('\n(cleanup)');
    if (pmVisitBefore) await admin.from('pm_visits').upsert(pmVisitBefore); else await admin.from('pm_visits').delete().eq('user_id', pmId);
    if (sessionIds.length) await admin.from('visitor_sessions').delete().in('id', sessionIds);
    if (visitorRowId) await admin.from('visitors').delete().eq('id', visitorRowId);
    if (convoIds.length) await admin.from('conversations').delete().in('id', convoIds);
    if (productIds.length) { await admin.from('product_documents').delete().in('product_id', productIds); await admin.from('products').delete().in('id', productIds); }
    for (const uid of users) {
      await admin.from('conversations').delete().eq('client_id', uid);
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
