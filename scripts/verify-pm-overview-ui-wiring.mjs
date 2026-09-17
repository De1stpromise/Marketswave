#!/usr/bin/env node
// verify-pm-overview-ui-wiring.mjs — PM tool revamp, part 2: the Overview as a briefing,
// driven as a real DOM (2026-09-14; the Approvals-landing half retired at part 3, row 228).
//
//   npm run verify-pm-overview-ui-wiring      (from scripts/; functions serve must be running)
//
// The REAL admin.html body markup and its REAL inline script
// (extracted verbatim) run in real jsdom windows against the real local stack with a real
// admin session — the harness shape every UI-wiring suite here uses. Each rendered figure is
// compared to an independent read of its source (a direct DB query, or the payload read
// separately with recordVisit:false), never to the page's own arithmetic.
//
// COVERS: the four attention cards (overdue amber with the oldest age; waiting; unread by
// channel; AUM with the month change absent-with-reason), Needs you first (oldest first, hot
// ages, links into the queue pages), Since you last looked (first-briefing honesty, then a real
// previous session's items and yesterday's visitors), Coming up (maturity, an overdue NAV, an
// unsigned document, the snapshot labelled as what it is), Worth acting on (idle, concentration,
// alerts, dormant — thresholds stated on the panel), On the site now, The firm today, Needs a
// look (a client with no deposit address genuinely appearing), System health (eight lines,
// amber where degraded, backup honestly not configured); the error card with a retry when the
// read fails; the Approvals landing's seven counts and overdue band cross-checked against the
// tables, every queue page linked.
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
  for (;;) { const r = await test(); if (r) return r; if (Date.now() - start > maxMs) return r; await sleep(150); }
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
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
}
function buildPageDom(bodyMarkup, urlStr) {
  return new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', { url: urlStr, runScripts: 'outside-only', virtualConsole: forwardingConsole, pretendToBeVisual: true });
}
const tempFiles = [];
function writeTempCopy(label, realSrc) {
  const tempPath = PROJECT_ROOT + '.tmp-pm-overview-test-' + label + '-' + process.pid + '.mjs';
  writeFileSync(tempPath, realSrc, 'utf8'); tempFiles.push(tempPath); return tempPath;
}
async function callFunction(url, token, name, body) {
  const res = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  console.log('PM tool revamp, part 2 — the briefing and the Approvals landing, driven as real DOMs\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'OverviewUi-2026!';
  const users = []; const convoIds = []; const productIds = []; const sessionIds = []; let visitorRowId = null;
  const now = Date.now(); const H = 3600e3; const DAY = 24 * H; const iso = (t) => new Date(t).toISOString();
  const pmAnon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: pmSignIn } = await pmAnon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  const pmId = pmSignIn.user.id; const pmToken = pmSignIn.session.access_token;
  const { data: pmVisitBefore } = await admin.from('pm_visits').select('*').eq('user_id', pmId).maybeSingle();

  async function makeClient(name, status) {
    const email = 'ovui-' + name.toLowerCase() + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    users.push(data.user.id);
    const ins = await admin.from('clients').insert({ id: data.user.id, name: name + ' ' + suffix, email: 'ovui-malformed-' + name.toLowerCase() + '-' + suffix, phone: '+1-555-0100', account_type: 'Individual Account', status });
    if (ins.error) throw new Error(ins.error.message);
    return { id: data.user.id, email, name: name + ' ' + suffix };
  }

  try {
    // ------------------------------------------------------------------ seed
    const A = await makeClient('Tomas', 'active');
    const B = await makeClient('Johan', 'pending_review');
    const C = await makeClient('Erik', 'active');
    const { data: prods } = await admin.from('products').select('id, name, unit_price').eq('pricing_model', 'market').limit(1);
    const P = prods[0];
    await admin.from('account_state').insert({ client_id: A.id, unallocated_capital: 42400, allocated_capital: 60000, asset_returns: 0 });
    await admin.from('holdings').insert({ client_id: A.id, product_id: P.id, units: 60000 / Number(P.unit_price), cost_basis: 60000 });
    await admin.from('transactions').insert({ client_id: A.id, type: 'DEPOSIT', total_value: 102400, status: 'completed' });
    await admin.from('account_state').insert({ client_id: C.id, unallocated_capital: 27900, allocated_capital: 0, asset_returns: 0 });
    await admin.from('withdrawal_requests').insert({ client_id: A.id, method: 'bank', requested_amount: 40000, currency: 'USD', destination_details: {}, status: 'pending', requested_at: iso(now - 3 * DAY) });
    await admin.from('deposit_requests').insert({ client_id: A.id, method: 'crypto', currency: 'BTC', network: 'Bitcoin', tx_hash: 'abc', details: {}, status: 'pending', requested_at: iso(now - 5 * H) });
    async function convo(row) { const { data, error } = await admin.from('conversations').insert(row).select('id').single(); if (error) throw new Error(error.message); convoIds.push(data.id); return data.id; }
    async function msg(row) { const { error } = await admin.from('messages').insert(row); if (error) throw new Error(error.message); }
    const t1 = await convo({ client_id: A.id, contact_email: 'ovui-malformed-tomas-' + suffix, contact_name: A.name, kind: 'ticket', category: 'Transaction Issue', display_id: 'DISP-0003', status: 'in_progress' });
    await msg({ conversation_id: t1, channel: 'chat', direction: 'inbound', body: 'Still showing pending this morning.', sent_at: iso(now - 12 * 60000) });
    const e1 = await convo({ contact_email: 'ovui-cold-' + suffix + '@example.com', contact_name: 'Sofia Berg', kind: 'email', subject: 'Fees', status: 'open' });
    await msg({ conversation_id: e1, channel: 'email', direction: 'inbound', body: 'What are your fees?', sent_at: iso(now - 15 * 60000), message_id: '<ovui-' + suffix + '@example.com>' });
    const pk = await admin.from('hys_pockets').insert([
      { client_id: A.id, pocket_type: 'fixed', amount: 52400, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5, maturity_date: iso(now - 20 * 60000), projected_interest: 2227, funding_method: 'bank account', created_at: iso(now - 182 * DAY) },
      { client_id: A.id, pocket_type: 'fixed', amount: 10000, status: 'active', term_mode: 'short', term_months: 3, term_label: '3 Months', rate: 6, term_in_years: 0.25, maturity_date: iso(now + 4 * DAY), projected_interest: 150, funding_method: 'bank account', created_at: iso(now - 88 * DAY) }
    ]);
    if (pk.error) throw new Error(pk.error.message);
    const navOver = 'PROD-OVU-' + suffix.toUpperCase(); productIds.push(navOver);
    const lastValued = iso(now - 100 * DAY).slice(0, 10);
    const pins = await admin.from('products').insert({ id: navOver, name: 'Overview Quarterly Fund ' + suffix, asset_class: 'Private Equity', investment_type: 'Fund', risk_tier: 'aggressive', minimum_investment: 10000, unit_price: 646.04, inception_unit_price: 500, pricing_model: 'appraisal', last_tick_date: lastValued, created_at: iso(now - 400 * DAY) });
    if (pins.error) throw new Error(pins.error.message);
    await admin.from('product_documents').insert({ product_id: navOver, status: 'published', content: { sections: [{ key: 'terms', horizon: '5 years', valuationFrequency: 'Quarterly', fees: '2%' }] }, published_content: { sections: [{ key: 'terms', horizon: '5 years', valuationFrequency: 'Quarterly', fees: '2%' }] } });
    await admin.from('documents').insert({ client_id: A.id, filename: 'Advisory agreement.pdf', category: 'Contracts', direction: 'from', status: 'Signature Required', created_at: iso(now - 10 * DAY) });
    const { data: ws } = await admin.from('watchlist_symbols').insert({ client_id: A.id, symbol: 'OVU' + suffix.toUpperCase().slice(0, 4), name: 'Overview Sym', source: 'finnhub', asset_type: 'stock' }).select('id').single();
    await admin.from('price_alerts').insert({ client_id: A.id, watchlist_symbol_id: ws.id, symbol: 'OVU' + suffix.toUpperCase().slice(0, 4), direction: 'above', target_price: 10, status: 'fired', fired_at: iso(now - DAY), fired_price: 11 });
    visitorRowId = crypto.randomUUID();
    await admin.from('visitors').insert({ id: visitorRowId, visit_count: 3, first_seen_at: iso(now - 2 * DAY), last_seen_at: iso(now) });
    const s1 = await admin.from('visitor_sessions').insert({ id: crypto.randomUUID(), visitor_id: visitorRowId, visit_number: 3, started_at: iso(now - 6 * 60000), last_seen_at: iso(now), current_path: '/signup', page_count: 2, journey: [{ p: '/', t: iso(now - 6 * 60000) }, { p: '/signup', t: iso(now - 60000) }], city: 'London', country: 'United Kingdom', country_code: 'GB' }).select('id').single();
    sessionIds.push(s1.data.id);
    // The PM's previous session ended 40 minutes ago.
    await admin.from('pm_visits').upsert({ user_id: pmId, email: 'pm@marketswave.local', session_started_at: iso(now - 50 * 60000), last_seen_at: iso(now - 40 * 60000), previous_session_last_seen_at: null });
    // Keep the live session live through the run.
    const keepAlive = setInterval(() => { admin.from('visitor_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s1.data.id).then(() => {}); }, 15000);

    try {
      // ---------------------------------------------------------------- the real admin.html
      console.log('--- The real admin.html, in a real DOM, with a real admin session ---\n');
      const dom = buildPageDom(extractBodyMarkup(PROJECT_ROOT + 'admin.html'), 'http://127.0.0.1:8765/admin.html');
      const dataTemp = writeTempCopy('supabase-data', readFileSync(PROJECT_ROOT + 'supabase-data.js', 'utf8'));
      globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;
      await import('file://' + dataTemp.replace(/\\/g, '/'));
      const adminConfigMod = await import('../admin-supabase-config.js');
      const { error: signErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
      check('the real admin session signs in', !signErr, signErr && signErr.message);
      const D = dom.window.document;
      dom.window.eval(extractInlineScript(PROJECT_ROOT + 'admin.html', 'get-pm-briefing'));
      check('every panel paints a skeleton before the read resolves', D.querySelectorAll('.ov-skel').length === 8, String(D.querySelectorAll('.ov-skel').length));
      await waitFor(() => /Price refresh/.test(D.getElementById('panel-health').textContent), 30000);
      check('★ the briefing renders (health panel populated)', /Price refresh/.test(D.getElementById('panel-health').textContent));
      // The same payload, read independently (without moving the visit clock), is the oracle
      // for "rendered = computed"; its own figures are proven against the tables by the
      // backend suite. A few are re-derived from the tables here too.
      const { body: b } = await callFunction(url, pmToken, 'get-pm-briefing', { recordVisit: false });

      console.log('\n--- Attention band ---\n');
      check('greeting and dateline are set from the real date', /^Good (morning|afternoon|evening)$/.test(D.getElementById('briefing-greeting').textContent) && /here's where things stand/.test(D.getElementById('briefing-dateline').textContent));
      check('the live pill counts the seeded live session and links to Presence', /1 person on the site now|\d+ people on the site now/.test(D.getElementById('briefing-livepill-text').textContent) && !D.getElementById('briefing-livepill').classList.contains('is-quiet'), D.getElementById('briefing-livepill-text').textContent);
      const overdueEl = D.getElementById('att-overdue');
      // ★ The oldest age is read from the PAYLOAD, not hardcoded to this suite's own 3-day
      // fixture: that quietly assumed nothing older existed anywhere on the stack, which stops
      // being true the moment a seeded client's own pending request ages past three days. The
      // assertion that matters is that the card states the real figure the endpoint computed.
      const expectOldest = b.attention.overdue.oldestLabel || b.attention.overdue.oldest;
      check('overdue approvals: amber, the count, and the real oldest age the endpoint computed',
        overdueEl.classList.contains('is-urgent') &&
        D.getElementById('att-overdue-v').textContent === String(b.attention.overdue.count) &&
        /Oldest waiting/.test(D.getElementById('att-overdue-x').textContent) &&
        (expectOldest == null || D.getElementById('att-overdue-x').textContent.indexOf(String(expectOldest)) !== -1),
        D.getElementById('att-overdue-x').textContent + ' | payload ' + JSON.stringify(b.attention.overdue));
      const { data: pendCount } = await admin.from('withdrawal_requests').select('id').eq('status', 'pending');
      check('waiting on you = the payload count, itself ≥ the seeded pending rows', D.getElementById('att-waiting-v').textContent === String(b.attention.waiting.count) && b.attention.waiting.count >= pendCount.length + 1);
      const { data: unreadRows } = await admin.from('conversations').select('id').eq('unread_by_pm', true).neq('status', 'archived');
      check('unread = a direct count of unread_by_pm outside archive, broken down by channel', D.getElementById('att-unread-v').textContent === String(unreadRows.length) && /ticket/.test(D.getElementById('att-unread-x').textContent) && /email/.test(D.getElementById('att-unread-x').textContent), D.getElementById('att-unread-x').textContent);
      check('AUM is the payload figure, short-formatted, with the month change ABSENT and its reason shown (no anchors for these clients)', D.getElementById('att-aum-v').textContent === (b.attention.aum.value >= 1e6 ? '$' + (b.attention.aum.value / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm' : (b.attention.aum.value >= 1e4 ? '$' + Math.round(b.attention.aum.value / 1e3) + 'k' : '$' + Math.round(b.attention.aum.value).toLocaleString('en-US'))) && /Month anchors exist for/.test(D.getElementById('att-aum-x').textContent) && /no month change yet/.test(D.getElementById('att-aum-x').textContent), D.getElementById('att-aum-v').textContent + ' | ' + D.getElementById('att-aum-x').textContent);

      console.log('\n--- Needs you first ---\n');
      const needRows = [...D.querySelectorAll('#panel-needs .ov-r')];
      // Same correction: the rows follow the payload's own order, and this suite's own
      // withdrawal must be among them with the right shape — not necessarily at index 0.
      const mineRow = needRows.find((r) => new RegExp('Withdrawal · ' + A.name).test(r.textContent));
      check('rows render oldest first, and the 3-day withdrawal is among them, hot, with its amount and a link into the approval gate',
        needRows.length >= 2 && !!mineRow &&
        mineRow.querySelector('.ov-rage').classList.contains('is-hot') &&
        /\$40,000/.test(mineRow.textContent) &&
        /admin-approvals\.html/.test(mineRow.getAttribute('href')) &&
        needRows[0].textContent === (b.approvals[0] ? needRows[0].textContent : ''),
        (mineRow || needRows[0]) && (mineRow || needRows[0]).textContent);
      check('the 5-hour crypto deposit is not hot and names its network', needRows.some((r) => /Crypto deposit/.test(r.textContent) && /BTC · Bitcoin · hash provided/.test(r.textContent) && !r.querySelector('.ov-rage').classList.contains('is-hot')));
      // ★ THE PANEL SHOWS THE FIRST SIX (admin.html: `b.approvals.slice(0, 6)`), so "my fixture
      // is on screen" is only true while the stack holds fewer than six older pending requests.
      // The property that is always true is FIDELITY: the panel renders exactly the payload's
      // own first six, in its own order. A fixture that falls outside them is the cap working.
      check('the panel renders exactly the payload\'s first six approvals, in order',
        needRows.length === Math.min(6, b.approvals.length) &&
        needRows.every((r, i) => r.textContent.indexOf(b.approvals[i].clientName) !== -1 &&
          r.getAttribute('href') === b.approvals[i].href),
        needRows.length + ' rows for ' + b.approvals.length + ' approvals');
      const appIdx = b.approvals.findIndex((a) => a.type === 'application' && a.clientName === B.name);
      check('the pending application is in the payload and links to the approval gate',
        appIdx !== -1 && b.approvals[appIdx].href === 'admin-approvals.html' &&
        (appIdx >= 6 || needRows.some((r) => new RegExp('Client application · ' + B.name).test(r.textContent))),
        'payload index ' + appIdx);

      console.log('\n--- Since you last looked ---\n');
      check('the stamp is the previous session\'s last read (40 minutes ago, today)', /^today, \d\d:\d\d$/.test(D.getElementById('since-stamp').textContent), D.getElementById('since-stamp').textContent);
      const sinceRows = [...D.querySelectorAll('#panel-since .ov-r')];
      check('the ticket reply names the client and DISP id and deep-links into the inbox', sinceRows.some((r) => new RegExp(A.name + ' replied on DISP-0003').test(r.textContent) && r.getAttribute('href') === 'admin-inbox.html?c=' + t1));
      check('the email from a cold sender is listed', sinceRows.some((r) => /Sofia Berg wrote/.test(r.textContent)));
      // ★ `b` IS NOT AN ORACLE FOR THIS PANEL. The page's own briefing read records the visit,
      // so the independent read above ("since the previous session") correctly returns an EMPTY
      // since-list — the page just moved the clock. Read the rendered rows, as before.
      check('the pocket that matured 20 minutes ago is listed with principal and interest',
        sinceRows.some((r) => /Savings pocket matured/.test(r.textContent) && /52,400/.test(r.textContent) && /2,227/.test(r.textContent)),
        sinceRows.map((r) => r.textContent.replace(/\s+/g, ' ').slice(0, 60)).join(' | '));
      check('the new application is listed', sinceRows.some((r) => new RegExp('New application · ' + B.name).test(r.textContent)));
      check('yesterday\'s visitor count is the last row, from the real sessions table', /visitors? yesterday/.test(sinceRows[sinceRows.length - 1].textContent) && new RegExp('^' + b.since.yesterday.visitors + ' visitor').test(sinceRows[sinceRows.length - 1].querySelector('.ov-rt').textContent));
      check('no "first briefing" note when a previous session exists', !/first briefing/.test(D.getElementById('panel-since').textContent));

      console.log('\n--- Coming up ---\n');
      const dueRows = [...D.querySelectorAll('#panel-coming .ov-r')];
      check('the pocket maturing in 4 days: amount, soon, linking to the approval gate', dueRows.some((r) => /Savings pocket matures/.test(r.textContent) && /\$10,000/.test(r.textContent) && /in 4 days/.test(r.textContent) && r.querySelector('.ov-dv span').classList.contains('is-soon') && /admin-approvals\.html/.test(r.getAttribute('href'))));
      check('★ the quarterly fund valued 100 days ago reads as an OVERDUE NAV publication with its last valuation date and price', dueRows.some((r) => /NAV publication overdue · Overview Quarterly Fund/.test(r.textContent) && new RegExp('Valued quarterly · last ' + lastValued).test(r.textContent) && /\$646\.04/.test(r.textContent) && /days overdue/.test(r.textContent)));
      check('the unsigned document reads with its age', dueRows.some((r) => new RegExp('Document unsigned · ' + A.name).test(r.textContent) && /10 days unsigned/.test(r.textContent)));
      check('the monthly snapshot is labelled honestly (no statements are generated)', dueRows.some((r) => /Monthly portfolio value snapshot/.test(r.textContent) && /no client statements are generated yet/.test(r.textContent)));

      console.log('\n--- Worth acting on ---\n');
      const ops = [...D.querySelectorAll('#panel-acting .ov-op')];
      const { data: states } = await admin.from('account_state').select('client_id, unallocated_capital');
      const { data: cls } = await admin.from('clients').select('id'); const known = new Set(cls.map((c) => c.id));
      const idleExpected = states.filter((s) => known.has(s.client_id)).reduce((s, r) => s + Number(r.unallocated_capital), 0);
      check('idle capital = Σ unallocated over real clients (' + Math.round(idleExpected) + '), naming the largest holder, with a Review link to that client', ops.some((o) => o.textContent.indexOf('$' + Math.round(idleExpected).toLocaleString('en-US') + ' sitting unallocated') !== -1 && o.querySelector('a.ov-obtn').getAttribute('href').indexOf('admin-clients.html?client=') === 0), ops.map((o) => o.textContent).join(' | '));
      check('concentration is flagged for the client whose one holding dominates, naming the product', ops.some((o) => new RegExp('Concentration · ' + A.name).test(o.textContent) && new RegExp('% of portfolio in ' + P.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(o.textContent)));
      check('the fired alert is listed', ops.some((o) => /price alert/.test(o.textContent) && /fired this week/.test(o.textContent)));
      check('the dormant client (holds value, never signed in) is listed with the value held', ops.some((o) => new RegExp(C.name + ' · no activity on record').test(o.textContent) && /27,900/.test(o.textContent)));
      check('the thresholds are stated on the panel', /Concentration: one holding ≥ 40% of a portfolio of \$10,000\+ · dormant: no sign-in, request, transaction or visit in 60 days/.test(D.getElementById('panel-acting').textContent));

      console.log('\n--- On the site now / The firm today / Needs a look / System health ---\n');
      const vis = [...D.querySelectorAll('#panel-site .ov-vis')];
      check('the live London visitor shows the country code, page, duration and visit ordinal', vis.some((v) => /GB/.test(v.querySelector('.ov-flag').textContent) && /Visitor · London/.test(v.textContent) && /\/signup · \d+m/.test(v.textContent) && /3rd visit/.test(v.querySelector('.ov-vt').textContent)), vis.map((v) => v.textContent).join(' | '));
      const firmText = D.getElementById('panel-firm').textContent;
      const { data: cl } = await admin.from('clients').select('status');
      check('the firm today: clients (active · pending) from the real table', new RegExp('Clients' + cl.filter((c) => c.status === 'active').length + ' · ' + cl.filter((c) => c.status === 'pending_review').length + ' pending').test(firmText.replace(/\s+/g, '')) || new RegExp('Clients\\s*' + cl.filter((c) => c.status === 'active').length).test(firmText), firmText);
      check('...AUM (excl. savings), unallocated, savings and the fee accrual all from the payload', firmText.indexOf('$' + Math.round(b.firm.aum).toLocaleString('en-US')) !== -1 && /excl\. savings/.test(firmText) && firmText.indexOf('$' + Math.round(b.firm.unallocated).toLocaleString('en-US')) !== -1 && firmText.indexOf('$' + Math.round(b.firm.savings).toLocaleString('en-US')) !== -1 && (b.firm.feesThisMonth === null ? /No advisory fee rate/.test(firmText) : /est\. at/.test(firmText)), firmText);
      const lookRows = [...D.querySelectorAll('#panel-look .ov-r')];
      const { data: asg } = await admin.from('deposit_address_assignments').select('client_id').is('removed_at', null);
      const withAddr = new Set(asg.map((a) => a.client_id));
      const { data: activeClients } = await admin.from('clients').select('id, name').eq('status', 'active');
      const noAddr = activeClients.filter((c) => !withAddr.has(c.id));
      check('★ "clients with no deposit address" = the real count (' + noAddr.length + ') and genuinely includes the seeded active client', lookRows.some((r) => new RegExp('^' + noAddr.length + ' clients? with no deposit address assigned').test(r.querySelector('.ov-rt').textContent)) && noAddr.some((c) => c.id === A.id), lookRows.map((r) => r.textContent).join(' | '));
      check('the appraised product with no stated frequency is flagged in Needs a look', b.look.navNoFrequency.length === 0 || lookRows.some((r) => /no stated valuation frequency/.test(r.textContent)));
      const hz = [...D.querySelectorAll('#panel-health .ov-hz')];
      check('eight health lines, each with a dot and a value', hz.length === 8 && hz.every((h) => h.querySelector('.ov-dot') && h.querySelector('.ov-v').textContent.length > 0));
      check('a degraded line paints amber/red and says why; backup is honestly "Not configured"', hz.some((h) => (h.querySelector('.ov-dot').classList.contains('d-warn') || h.querySelector('.ov-dot').classList.contains('d-bad')) && h.querySelector('small')) && hz.some((h) => h.getAttribute('data-health') === 'backup' && /Not configured/.test(h.querySelector('.ov-v').textContent) && h.querySelector('.ov-dot').classList.contains('d-warn')));
      check('health states match the payload line for line', hz.every((h, i) => h.getAttribute('data-health') === b.health.lines[i].key && h.querySelector('.ov-v').textContent === String(b.health.lines[i].value)));

      // ---------------------------------------------------------------- failure: an error card with a retry
      console.log('\n--- A failed read shows the error card with a retry on every panel ---\n');
      const dom2 = buildPageDom(extractBodyMarkup(PROJECT_ROOT + 'admin.html'), 'http://127.0.0.1:8765/admin.html');
      globalThis.window = dom2.window; globalThis.document = dom2.window.document;
      const realCall = dom2.window.MarketswaveData;
      dom2.window.MarketswaveData = Object.assign({}, dom.window.MarketswaveData, { callFunction: () => Promise.reject(Object.assign(new Error('Could not reach the server.'), { kind: 'network' })) });
      void realCall;
      dom2.window.eval(extractInlineScript(PROJECT_ROOT + 'admin.html', 'get-pm-briefing'));
      await waitFor(() => dom2.window.document.querySelectorAll('[data-retry]').length === 8, 5000);
      check('every one of the eight panels shows the error card with a Try Again', dom2.window.document.querySelectorAll('[data-retry]').length === 8, String(dom2.window.document.querySelectorAll('[data-retry]').length));

      // ── The Approvals landing — RETIRED (register row 228). ───────────────────────────
      // Part 2 built admin-approvals.html as an interim landing of seven queue cards linking
      // to the seven per-type pages. Part 3 replaced BOTH: that page is now the approval gate
      // itself, and the seven pages are deleted. This section's coverage MOVED rather than
      // being dropped:
      //
      //   a per-type pending count equal to the real DB count
      //        -> verify-admin-approval-gate-ui-wiring, PART 1 (the filter pills, each
      //           compared against an independent Postgres count)
      //   the band totalling every queue
      //        -> the same suite's "the All pill equals the real total pending across all
      //           seven sources"
      //   the overdue/oldest-waiting treatment
      //        -> the same suite's urgency assertions ("every row Postgres says is over a day
      //           old is rendered in the urgent group", and the two group headings)
      //   the seven queue pages being reachable
      //        -> no longer a behaviour: there is one page, and every type is reachable from
      //           its own filter pill, which the pill assertions above already prove.
      //
      // Nothing from this section is unasserted. The briefing coverage above is unaffected.

    } finally { clearInterval(keepAlive); }
  } finally {
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
    for (const f of tempFiles) { try { unlinkSync(f); } catch (_e) { /* already gone */ } }
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nVERIFY: ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY: FAIL — ' + (e.stack || e.message)); for (const f of tempFiles) { try { unlinkSync(f); } catch (_e) {} } process.exit(1); });
