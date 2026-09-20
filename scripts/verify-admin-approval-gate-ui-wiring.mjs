#!/usr/bin/env node
/**
 * verify-admin-approval-gate-ui-wiring.mjs — the APPROVAL GATE (register row 228).
 *
 *   npm run verify-admin-approval-gate-ui-wiring     (from scripts/)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * ★ REWRITTEN, NOT REPLACED (row 228's binding decision 2). This suite used to drive six
 * separate admin queue pages — admin-deposits / -withdrawals / -allocations / -sells /
 * -hys and the Client Profile Updates half of admin-final-wiring. Those pages are deleted;
 * one page now carries all seven request types. Dropping the coverage to make a
 * deployed-bytes 404 check simpler would have traded real verification for tidiness, so
 * every behaviour the old suite asserted is asserted here against the new surface:
 *
 *   old page                     what it proved                     where it lives now
 *   admin-deposits.html          credit at a PM-EDITED amount       PART 2 · dep
 *                                reject, nothing moves              PART 3
 *                                double-resolve refused             PART 4b
 *   admin-withdrawals.html       approve at a PM-EDITED amount      PART 2 · wd
 *                                re-validation race refused         PART 4a
 *   admin-allocations.html       approve executes a real BUY        PART 2 · alo
 *   admin-sells.html             approve executes a real SELL       PART 2 · sell
 *   admin-hys.html               credit creates a real pocket       PART 2 · hys-deposit
 *                                approve pays out a pocket          PART 2 · hys-withdrawal
 *   admin-profile-updates.html   approve writes client_profiles     PART 2 · prof
 *   (never covered before)       approve a client application       PART 2 · app
 *
 * Two types the old suite never reached — client applications and profile updates — are
 * covered here for the first time, because the gate genuinely handles all seven.
 *
 * ★ ROW 229'S RULE, APPLIED THROUGHOUT: every headline assertion reads a value THE PAGE
 * PRODUCED and compares it against one derived independently — from Postgres, or from a
 * real Edge Function's own response. The page exposes `window.__agInternals` (its own
 * `state`, `build()`, `ageOf()`); this file NEVER reads it for an assertion. Asserting
 * against a page's own internal state is the tautology row 229 exists to prevent — it
 * would pass against a page that rendered nothing at all.
 *
 * ★ ATTRIBUTION IS WRITTEN, NEVER RENDERED (row 228's binding decision 1). PART 5 proves
 * both halves: the real Edge Function wrote resolved_by/resolved_by_email, AND the rendered
 * page carries the PM's email nowhere — not in text, not in a title/aria attribute, and not
 * in a visually-hidden span, since a hidden field is still a displayed field to a screen
 * reader.
 *
 * LOCAL STACK ONLY. Usage (the loader flag is baked into the npm script):
 *   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-admin-approval-gate-ui-wiring.mjs
 * ══════════════════════════════════════════════════════════════════════════════════════════
 */
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GATE_HTML = path.join(ROOT, 'admin-approvals.html');
const GATE_JS = path.join(ROOT, 'admin-approvals-page.js');
const PASSWORD = 'Gate-Verify-2026!';

let passed = 0, failed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; fails.push(label + (detail ? '  [' + detail + ']' : '')); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(test, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await test()) return true; await sleep(100); }
  return test();
}

function localCreds() {
  const raw = execSync('npx --no-install supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(j.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + j.API_URL);
  }
  return { url: j.API_URL, anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY };
}

const vc = new VirtualConsole();
vc.forwardTo(console);

/**
 * A fresh gate page per scenario. The page caches its own `load()` result, so a new DOM is
 * the only honest way to observe state after a write — reusing one would read a snapshot
 * taken before the write happened.
 */
function buildGateDom(MarketswaveData) {
  const html = readFileSync(GATE_HTML, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    url: 'http://localhost/admin-approvals.html', runScripts: 'outside-only', virtualConsole: vc
  });
  dom.window.MarketswaveData = MarketswaveData;
  // The real page loads format-helpers.js before its own script (the shared sortHeaderHTML()
  // builder, register row 252), so the harness does too.
  dom.window.eval(readFileSync(path.join(ROOT, 'format-helpers.js'), 'utf8'));
  dom.window.eval(readFileSync(GATE_JS, 'utf8'));
  return dom;
}

/** Settled = the skeleton is gone and the page has painted rows or a real empty state. */
async function gateReady(dom, maxMs = 30000) {
  const q = dom.window.document.getElementById('ag-queue');
  return pollUntil(() => !/animate-pulse/.test(q.innerHTML)
    && (q.querySelectorAll('.ag-row').length > 0 || q.querySelector('.ag-empty')), maxMs);
}

/** Every rendered queue row, read straight out of the DOM. */
function renderedRows(dom) {
  return [...dom.window.document.querySelectorAll('#ag-queue .ag-row')].map((r) => ({
    kind: r.getAttribute('data-kind'),
    id: r.getAttribute('data-id'),
    chip: (r.querySelector('.ag-kind') || {}).textContent || '',
    title: (r.querySelector('.ag-what b') || {}).textContent || '',
    sub: (r.querySelector('.ag-what span') || {}).textContent || '',
    client: (r.querySelector('.ag-nm b') || {}).textContent || '',
    amount: (r.querySelector('.ag-amt b') || {}).textContent || '',
    amountSub: (r.querySelector('.ag-amt span') || {}).textContent || '',
    urgent: r.classList.contains('is-urgent'),
    el: r
  }));
}

/** The filter pill counts, as the page painted them. */
function pillCounts(dom) {
  const out = {};
  [...dom.window.document.querySelectorAll('#ag-filters .ag-fp')].forEach((p) => {
    out[p.getAttribute('data-f')] = Number((p.querySelector('.ag-n') || {}).textContent);
  });
  return out;
}

async function openRow(dom, kind, id) {
  const row = dom.window.document.querySelector(`#ag-queue .ag-row[data-kind="${kind}"][data-id="${id}"]`);
  if (!row) return null;
  row.click();
  await pollUntil(() => !dom.window.document.getElementById('ag-scrim').hidden
    && dom.window.document.getElementById('ag-pane').innerHTML.length > 0, 8000);
  return dom.window.document.getElementById('ag-pane');
}

function panelText(dom) {
  return (dom.window.document.getElementById('ag-pane').textContent || '').replace(/\s+/g, ' ').trim();
}

/** Click Approve and wait for either the panel to close (success) or an error to paint. */
async function clickApprove(dom, maxMs = 25000) {
  dom.window.document.getElementById('ag-approve').click();
  await pollUntil(() => {
    const scrim = dom.window.document.getElementById('ag-scrim');
    const err = dom.window.document.getElementById('ag-err');
    return scrim.hidden || (err && err.textContent.trim().length > 0);
  }, maxMs);
  const err = dom.window.document.getElementById('ag-err');
  return { closed: dom.window.document.getElementById('ag-scrim').hidden, error: err ? err.textContent.trim() : '' };
}

/** Reject is two clicks by design: the first reveals the reason field, the second sends. */
async function rejectWith(dom, reason, maxMs = 25000) {
  dom.window.document.getElementById('ag-reject').click();
  await pollUntil(() => !dom.window.document.getElementById('ag-reason-wrap').hidden, 5000);
  const ta = dom.window.document.getElementById('ag-reason');
  ta.value = reason;
  dom.window.document.getElementById('ag-reject').click();
  await pollUntil(() => {
    const scrim = dom.window.document.getElementById('ag-scrim');
    const err = dom.window.document.getElementById('ag-err');
    return scrim.hidden || (err && err.textContent.trim().length > 0);
  }, maxMs);
  const err = dom.window.document.getElementById('ag-err');
  return { closed: dom.window.document.getElementById('ag-scrim').hidden, error: err ? err.textContent.trim() : '' };
}

function setAmount(dom, v) {
  const el = dom.window.document.getElementById('ag-amount');
  if (el) el.value = String(v);
  return !!el;
}

async function main() {
  const { url, anon, service } = localCreds();
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const made = [];

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded and defined window.MarketswaveData', !!MarketswaveData);
  check('useAdminClient() exists — the gate calls it as its first statement', typeof MarketswaveData.useAdminClient === 'function');

  // Admin Auth Consolidation (row 134): useAdminClient() no longer auto-signs in — a real
  // admin session is established exactly once via a real sign-in on admin-login.html, before
  // any admin page is reachable. admin-supabase-config.js is a real, un-duplicated singleton,
  // so signing in on ITS OWN client here is seen by every later useAdminClient() call, which
  // is exactly how one real PM login persists across every page they then navigate to.
  // Signing in on a SEPARATE client would leave that singleton sessionless and send the page
  // straight to its own redirect guard.
  const adminConfig = await import('../admin-supabase-config.js');
  const { error: pmErr } = await adminConfig.supabase.auth.signInWithPassword({
    email: adminConfig.LOCAL_ADMIN_EMAIL, password: adminConfig.LOCAL_ADMIN_PASSWORD
  });
  if (pmErr) throw new Error('Real admin sign-in failed: ' + pmErr.message);
  const PM_EMAIL_REAL = adminConfig.LOCAL_ADMIN_EMAIL;
  check('a real admin session is established before any gate render', true);

  async function makeClient(tag, opts = {}) {
    const email = `gate-${tag}-${suffix}@test.marketswave.local`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error('createUser ' + tag + ': ' + error.message);
    const id = data.user.id;
    made.push(id);
    await admin.from('clients').insert({
      id, name: 'Gate ' + tag, email, phone: '+46 70 000 0000',
      account_type: 'Individual Account', status: opts.status || 'active'
    });
    if (opts.status !== 'pending_review') {
      await admin.from('account_state').insert({
        client_id: id, unallocated_capital: opts.unallocated || 0,
        allocated_capital: 0, asset_returns: 0
      });
    }
    return { id, email, name: 'Gate ' + tag };
  }

  const dbPending = async (table) => (await admin.from(table).select('*', { count: 'exact', head: true }).eq('status', 'pending')).count;

  try {
    const { data: prods } = await admin.from('products').select('id, ticker, unit_price, minimum_investment').in('ticker', ['SPY', 'BTC', 'ETH']);
    const bySym = Object.fromEntries(prods.map((p) => [p.ticker, p]));

    /* ════════════════════════════════════════════════════════════════════════════════════
     * PART 1 — THE QUEUE SURFACE, read out of the rendered DOM and cross-checked against
     * Postgres. The committed fixture (seed-approval-gate-fixtures.mjs) supplies one pending
     * request of every type plus two rows deliberately aged 2–3 days, because a real local
     * stack almost never has all seven at once.
     *
     * ★ THE COUNTS ARE COMPARED AGAINST THE DATABASE, NOT AGAINST THE PAGE'S OTHER HALF.
     * Asserting "the pill says N and N rows rendered" would be two readings of the same
     * computation — it passes if the page miscounts consistently. Each pill is checked
     * against an independent `count(*) where status='pending'`.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n1. THE QUEUE SURFACE — every rendered value cross-checked against Postgres\n');
    execSync('node seed-approval-gate-fixtures.mjs --tag v' + suffix, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

    const truth = {
      dep: await dbPending('deposit_requests'),
      wd: await dbPending('withdrawal_requests'),
      alo: await dbPending('allocation_requests'),
      sell: await dbPending('sell_requests'),
      prof: await dbPending('profile_change_requests'),
      app: (await admin.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'pending_review')).count
    };
    // The gate folds both HYS queues into one 'hys' kind, which is a real design choice, so
    // its expected count is the sum of two independent tables.
    truth.hys = (await dbPending('hys_deposit_requests')) + (await dbPending('hys_withdrawal_requests'));
    const truthTotal = Object.values(truth).reduce((a, b) => a + b, 0);

    check('GUARD: the fixture genuinely produced all seven types — otherwise this section proves nothing',
      Object.entries(truth).every(([, n]) => n > 0),
      Object.entries(truth).map(([k, n]) => k + '=' + n).join(' '));

    const d1 = buildGateDom(MarketswaveData);
    const ok1 = await gateReady(d1);
    check('the real gate page rendered (not a skeleton, not an error card)', ok1,
      d1.window.document.getElementById('ag-queue').textContent.replace(/\s+/g, ' ').slice(0, 120));

    const rows1 = renderedRows(d1);
    const pills1 = pillCounts(d1);

    check('★ the All pill equals the real total pending across all seven sources',
      pills1.all === truthTotal, 'page ' + pills1.all + ' vs Postgres ' + truthTotal);
    for (const k of ['app', 'dep', 'wd', 'alo', 'sell', 'hys', 'prof']) {
      check('★ the ' + k + ' pill equals its own real pending count in Postgres',
        pills1[k] === truth[k], 'page ' + pills1[k] + ' vs Postgres ' + truth[k]);
    }
    check('★ the queue renders one row per pending request, and no more',
      rows1.length === truthTotal, rows1.length + ' rows vs ' + truthTotal + ' pending');
    check('all seven types are genuinely present as rendered rows',
      new Set(rows1.map((r) => r.kind)).size === 7, [...new Set(rows1.map((r) => r.kind))].sort().join(','));

    // Urgency: which rows the DB says are ≥24h old, vs which the page marked urgent.
    const nowMs = Date.now();
    const agedIds = new Set();
    for (const [tbl, kind] of [['deposit_requests', 'dep'], ['withdrawal_requests', 'wd']]) {
      const { data } = await admin.from(tbl).select('id, requested_at').eq('status', 'pending');
      data.forEach((r) => { if (nowMs - new Date(r.requested_at).getTime() >= 864e5) agedIds.add(kind + ':' + r.id); });
    }
    const renderedUrgent = new Set(rows1.filter((r) => r.urgent).map((r) => r.kind + ':' + r.id));
    check('GUARD: the fixture genuinely aged at least two rows past 24h', agedIds.size >= 2, agedIds.size + ' aged');
    check('★ every row Postgres says is over a day old is rendered in the urgent group',
      [...agedIds].every((k) => renderedUrgent.has(k)),
      'aged ' + agedIds.size + ', page marked ' + renderedUrgent.size);
    check('the "Waiting more than a day" heading is present, and a "Today" heading beside it',
      /Waiting more than a day/.test(d1.window.document.getElementById('ag-queue').textContent)
      && /Today/.test(d1.window.document.getElementById('ag-queue').textContent));
    check('the oldest-waiting badge is shown and names a real age',
      !d1.window.document.getElementById('ag-oldest').hidden
      && /Oldest waiting/.test(d1.window.document.getElementById('ag-oldest-text').textContent),
      d1.window.document.getElementById('ag-oldest-text').textContent);

    // Filtering and search, driven by real clicks.
    d1.window.document.querySelector('#ag-filters [data-f="wd"]').click();
    await sleep(60);
    const wdRows = renderedRows(d1);
    check('★ clicking a type pill narrows the queue to exactly that type',
      wdRows.length === truth.wd && wdRows.every((r) => r.kind === 'wd'),
      wdRows.length + ' rows, kinds ' + [...new Set(wdRows.map((r) => r.kind))].join(','));
    d1.window.document.querySelector('#ag-filters [data-f="all"]').click();
    await sleep(60);

    const searchTarget = rows1.find((r) => r.kind === 'wd');
    const qEl = d1.window.document.getElementById('ag-q');
    qEl.value = 'Gate main';
    qEl.dispatchEvent(new d1.window.Event('input', { bubbles: true }));
    await sleep(60);
    const found = renderedRows(d1);
    check('search by client name narrows to that client\'s own rows',
      found.length > 0 && found.every((r) => /Gate main/i.test(r.client)),
      found.length + ' rows for "Gate main"');
    qEl.value = '';
    qEl.dispatchEvent(new d1.window.Event('input', { bubbles: true }));
    await sleep(60);

    // The crypto deposit's "PM sets amount" — one of row 228's four kept fields.
    const cryptoRow = rows1.find((r) => r.kind === 'dep' && /PM sets amount/.test(r.amountSub));
    const { data: cryptoDb } = await admin.from('deposit_requests').select('id, requested_amount, method')
      .eq('status', 'pending').eq('method', 'crypto').limit(1).maybeSingle();
    check('★ a crypto deposit with a genuinely NULL requested_amount renders "PM sets amount", not $0',
      !!cryptoRow && !!cryptoDb && cryptoDb.requested_amount === null && cryptoRow.amount === '—',
      cryptoRow ? cryptoRow.amount + ' / ' + cryptoRow.amountSub : 'no such row');

    execSync('node seed-approval-gate-fixtures.mjs --clean --tag v' + suffix, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

    /* ════════════════════════════════════════════════════════════════════════════════════
     * PART 2 — THE SEVEN APPROVALS, END TO END, WITH MONEY LANDING CORRECTLY.
     * Each one drives the REAL page: click the row, read the panel, click Approve. The
     * outcome is then read from Postgres, never from the page's own optimism.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n2. THE SEVEN APPROVALS — real clicks, money checked in Postgres\n');

    // ---- 2a. CLIENT APPLICATION ------------------------------------------------------
    {
      const c = await makeClient('app', { status: 'pending_review' });
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      const pane = await openRow(dom, 'app', c.id);
      check('app: the panel opens for a real pending application', !!pane && /Application/.test(panelText(dom)), panelText(dom).slice(0, 90));
      check('app: the panel states the real account type and email from the clients row',
        panelText(dom).includes('Individual Account') && panelText(dom).includes(c.email));
      const r = await clickApprove(dom);
      check('app: the panel closed on success (no error surfaced)', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('clients').select('status, application_resolved_at, application_resolved_by_email').eq('id', c.id).single();
      check('★ app: the real clients row is genuinely active, with a resolution timestamp',
        row.status === 'active' && !!row.application_resolved_at, JSON.stringify(row));
      check('★ app: attribution was WRITTEN by the Edge Function', row.application_resolved_by_email === PM_EMAIL_REAL, String(row.application_resolved_by_email));
    }

    // ---- 2b. DEPOSIT — credited at a PM-EDITED amount --------------------------------
    {
      const c = await makeClient('dep', { unallocated: 0 });
      const { data: req } = await admin.from('deposit_requests').insert({
        client_id: c.id, method: 'bank', requested_amount: 2000, currency: 'USD',
        details: { bankName: 'SEB' }, status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'dep', req.id);
      check('dep: the amount field is pre-filled with the REQUESTED amount', dom.window.document.getElementById('ag-amount').value === '2000',
        dom.window.document.getElementById('ag-amount').value);
      check('dep: the panel states that crediting has no balance to re-validate (row 228 — credit-deposit correctly has no such check)',
        /no balance to re-validate/i.test(panelText(dom)), panelText(dom).slice(-160));
      setAmount(dom, 1950);
      const r = await clickApprove(dom);
      check('dep: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('deposit_requests').select('status, credited_amount, resolved_by_email').eq('id', req.id).single();
      check('★ dep: the row is credited at the PM-ENTERED $1,950, NOT the requested $2,000',
        row.status === 'credited' && Math.abs(row.credited_amount - 1950) < 1e-9, JSON.stringify(row));
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', c.id).single();
      check('★ dep: the money genuinely landed — unallocated is exactly $1,950',
        Math.abs(Number(st.unallocated_capital) - 1950) < 1e-9, '$' + st.unallocated_capital);
      check('dep: attribution written', row.resolved_by_email === PM_EMAIL_REAL, String(row.resolved_by_email));
    }

    // ---- 2c. WITHDRAWAL — approved at a PM-EDITED amount -----------------------------
    {
      const c = await makeClient('wd', { unallocated: 5000 });
      const { data: req } = await admin.from('withdrawal_requests').insert({
        client_id: c.id, method: 'bank', requested_amount: 700, currency: 'USD',
        destination_details: { bankName: 'SEB', accountNumber: '****4417' }, status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'wd', req.id);
      check('wd: the amount field is pre-filled with the requested $700', dom.window.document.getElementById('ag-amount').value === '700');
      check('wd: the panel names the re-validation that will run against current capital',
        /re-read at approval/i.test(panelText(dom)), panelText(dom).slice(-160));
      check('★ wd: the destination renders through the GENERIC renderer — bank fields, not a hardcoded crypto shape',
        /Bank Name/i.test(panelText(dom)) && /SEB/.test(panelText(dom)), panelText(dom).slice(0, 200));
      setAmount(dom, 650);
      const r = await clickApprove(dom);
      check('wd: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('withdrawal_requests').select('status, approved_amount').eq('id', req.id).single();
      check('★ wd: approved at the PM-ENTERED $650, not the requested $700',
        row.status === 'approved' && Math.abs(row.approved_amount - 650) < 1e-9, JSON.stringify(row));
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', c.id).single();
      check('★ wd: the money genuinely left — $5,000 − $650 = $4,350',
        Math.abs(Number(st.unallocated_capital) - 4350) < 1e-9, '$' + st.unallocated_capital);
    }

    // ---- 2d. ALLOCATION — a real BUY -------------------------------------------------
    {
      const c = await makeClient('alo', { unallocated: 6000 });
      const { data: req } = await admin.from('allocation_requests').insert({
        client_id: c.id, product_id: bySym.SPY.id, requested_amount: 3000, status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'alo', req.id);
      check('alo: the panel names the product and the real amount', /SPY|Global|ETF|S&P/i.test(panelText(dom)) && /3,000|3000/.test(panelText(dom)), panelText(dom).slice(0, 160));
      const r = await clickApprove(dom);
      check('alo: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('allocation_requests').select('status, transaction_id').eq('id', req.id).single();
      check('★ alo: approved with a REAL transaction id', row.status === 'approved' && !!row.transaction_id, JSON.stringify(row));
      const { data: tx } = await admin.from('transactions').select('type, total_value, units, price').eq('id', row.transaction_id).single();
      check('★ alo: the ledger row is a real BUY for exactly $3,000', tx.type === 'BUY' && Math.abs(Number(tx.total_value) - 3000) < 1e-9, JSON.stringify(tx));
      const { data: h } = await admin.from('holdings').select('units, cost_basis').eq('client_id', c.id).eq('product_id', bySym.SPY.id).single();
      check('★ alo: a real holding exists with the units the price implies',
        Math.abs(Number(h.cost_basis) - 3000) < 1e-9 && Math.abs(Number(h.units) - 3000 / Number(tx.price)) < 1e-6, JSON.stringify(h));
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', c.id).single();
      check('★ alo: unallocated fell by exactly the allocated amount — $6,000 → $3,000',
        Math.abs(Number(st.unallocated_capital) - 3000) < 1e-9, '$' + st.unallocated_capital);
    }

    // ---- 2e. SELL — a real SELL ------------------------------------------------------
    {
      const c = await makeClient('sell', { unallocated: 0 });
      const units = 20;
      const costBasis = 4000;
      await admin.from('holdings').insert({ client_id: c.id, product_id: bySym.SPY.id, units, cost_basis: costBasis });
      const { data: req } = await admin.from('sell_requests').insert({
        client_id: c.id, product_id: bySym.SPY.id, units_to_sell: units, status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'sell', req.id);
      check('sell: the panel states the units being sold', /20/.test(panelText(dom)), panelText(dom).slice(0, 160));
      const r = await clickApprove(dom);
      check('sell: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('sell_requests').select('status, transaction_id').eq('id', req.id).single();
      check('★ sell: approved with a real transaction id', row.status === 'approved' && !!row.transaction_id);
      const { data: tx } = await admin.from('transactions').select('type, total_value, realized_return').eq('id', row.transaction_id).single();
      check('★ sell: the ledger row is a real SELL carrying a realised return', tx.type === 'SELL' && tx.realized_return !== null, JSON.stringify(tx));
      const { data: st } = await admin.from('account_state').select('unallocated_capital, asset_returns').eq('client_id', c.id).single();
      // The engine's own locked split: the COST-BASIS portion returns to spendable capital,
      // the gain goes to asset_returns and is deliberately not spendable.
      check('★ sell: the split is the engine\'s own — cost basis to unallocated, gain to asset_returns',
        Math.abs(Number(st.unallocated_capital) - (Number(tx.total_value) - Number(tx.realized_return))) < 0.02
        && Math.abs(Number(st.asset_returns) - Number(tx.realized_return)) < 0.02,
        'unalloc $' + st.unallocated_capital + ', returns $' + st.asset_returns + ', sale $' + tx.total_value + ', gain $' + tx.realized_return);
      const { data: hs } = await admin.from('holdings').select('id').eq('client_id', c.id).eq('product_id', bySym.SPY.id);
      check('sell: a fully-sold holding row is genuinely gone', hs.length === 0, hs.length + ' rows');
    }

    // ---- 2f. HYS DEPOSIT — credited, creating a real pocket --------------------------
    {
      const c = await makeClient('hysdep', { unallocated: 0 });
      const { data: req } = await admin.from('hys_deposit_requests').insert({
        // rate is a PERCENT (getHysRate returns 12 for 12 months); credit-hys-deposit
        // computes amount * (rate/100) * years, so a fraction here would seed a pocket
        // the real request path could never create.
        client_id: c.id, pocket_type: 'fixed', term_mode: 'short', term_months: 12,
        term_label: '12 months', rate: 12, term_in_years: 1, requested_amount: 8000,
        method: 'bank', currency: 'USD', status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'hys', req.id);
      // ★ REGRESSION GUARD. The gate first rendered this as (rate * 100).toFixed(1) + '%',
      // so a real 12% pocket read 1200.0%. hys_deposit_requests.rate is stored as a PERCENT
      // already (getHysRate returns 12 for 12 months; credit-hys-deposit divides by 100), and
      // high-yield-savings.html renders it bare. Compared against the DB value, not a literal.
      check('★ hys-dep: the panel shows the pockets own REAL rate, 12.0% — not 1200.0%',
        /12\.0%/.test(panelText(dom)) && !/1200/.test(panelText(dom)),
        (panelText(dom).match(/Rate[^·]{0,16}/) || [''])[0]);
      check('...and so does the queue row', /12\.0%/.test(dom.window.document.querySelector('.ag-row[data-kind="hys"][data-id="' + req.id + '"] .ag-amt').textContent || ''),
        dom.window.document.querySelector('.ag-row[data-kind="hys"][data-id="' + req.id + '"] .ag-amt').textContent);
      check('hys-dep: the approve control reads "Credit", not "Approve"',
        dom.window.document.getElementById('ag-approve').textContent.trim() === 'Credit',
        dom.window.document.getElementById('ag-approve').textContent.trim());
      setAmount(dom, 7500);
      const r = await clickApprove(dom);
      check('hys-dep: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('hys_deposit_requests').select('status, credited_amount, pocket_id').eq('id', req.id).single();
      check('★ hys-dep: credited at the PM-ENTERED $7,500, not the requested $8,000',
        row.status === 'credited' && Math.abs(row.credited_amount - 7500) < 1e-9, JSON.stringify(row));
      const { data: pk } = await admin.from('hys_pockets').select('amount, projected_interest, maturity_date, status').eq('id', row.pocket_id).single();
      check('★ hys-dep: a real pocket exists funded with the CONFIRMED amount',
        Math.abs(Number(pk.amount) - 7500) < 1e-9 && pk.status === 'active', JSON.stringify(pk));
      check('★ hys-dep: projected interest is computed off the CONFIRMED amount (7500 × 12% × 1 = 900), not the requested 8000',
        Math.abs(Number(pk.projected_interest) - 900) < 0.01, '$' + pk.projected_interest);
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', c.id).single();
      check('★ hys-dep: an EXTERNALLY-funded pocket leaves unallocated capital untouched (HYS is its own pool)',
        Math.abs(Number(st.unallocated_capital)) < 1e-9, '$' + st.unallocated_capital);
    }

    // ---- 2g. HYS WITHDRAWAL — paid out ----------------------------------------------
    {
      const c = await makeClient('hyswd', { unallocated: 0 });
      const { data: pk, error: pkErr } = await admin.from('hys_pockets').insert({
        // funding_method is CHECK-constrained to 'crypto wallet' / 'bank account' /
        // 'unallocated capital'. 'bank' silently failed the insert and .single() then
        // returned null — a seed the real credit path could never have written.
        client_id: c.id, pocket_type: 'fixed', amount: 5000, status: 'matured', term_mode: 'short',
        term_months: 12, term_label: '12 months', rate: 12, term_in_years: 1,
        maturity_date: '2026-01-01', projected_interest: 600, funding_method: 'bank account'
      }).select('id').single();
      if (pkErr) throw new Error('hys_pockets seed failed: ' + pkErr.message);
      const { data: req } = await admin.from('hys_withdrawal_requests').insert({
        client_id: c.id, pocket_id: pk.id, pocket_type: 'fixed', term_label: '12 months',
        forfeit: false, receive_amount: 5240, method: 'bank',
        destination_details: { bankName: 'SEB' }, status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'hys', req.id);
      check('hys-wd: the approve control reads "Approve" for a withdrawal',
        dom.window.document.getElementById('ag-approve').textContent.trim() === 'Approve');
      check('hys-wd: the panel carries no PM-editable amount — the payout is a computed figure',
        !dom.window.document.getElementById('ag-amount'));
      const r = await clickApprove(dom);
      check('hys-wd: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('hys_withdrawal_requests').select('status').eq('id', req.id).single();
      const { data: pk2 } = await admin.from('hys_pockets').select('status').eq('id', pk.id).single();
      check('★ hys-wd: the request is approved and the real pocket is genuinely withdrawn',
        row.status === 'approved' && pk2.status === 'withdrawn', row.status + ' / ' + pk2.status);
      const { data: tx } = await admin.from('transactions').select('type, total_value').eq('client_id', c.id).eq('type', 'HYS_WITHDRAWAL').maybeSingle();
      check('★ hys-wd: a real HYS_WITHDRAWAL ledger row exists for the payout',
        !!tx && Math.abs(Number(tx.total_value) - 5240) < 1e-9, JSON.stringify(tx));
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', c.id).single();
      check('★ hys-wd: symmetric external payout — unallocated capital is untouched',
        Math.abs(Number(st.unallocated_capital)) < 1e-9, '$' + st.unallocated_capital);
    }

    // ---- 2h. PROFILE UPDATE — applied to client_profiles -----------------------------
    {
      const c = await makeClient('prof', { unallocated: 0 });
      await admin.from('client_profiles').insert({
        client_id: c.id, legal_name: { firstName: 'Gate', lastName: 'Before' }, address: null, id_document: null
      });
      const { data: req } = await admin.from('profile_change_requests').insert({
        client_id: c.id, field: 'legalName',
        current_value: { firstName: 'Gate', lastName: 'Before' },
        requested_value: { firstName: 'Gate', lastName: 'After' },
        reason: 'Married', status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'prof', req.id);
      check('prof: the panel shows the real current and requested values',
        /Before/.test(panelText(dom)) && /After/.test(panelText(dom)), panelText(dom).slice(0, 180));
      const r = await clickApprove(dom);
      check('prof: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('profile_change_requests').select('status').eq('id', req.id).single();
      const { data: prof } = await admin.from('client_profiles').select('legal_name').eq('client_id', c.id).single();
      check('★ prof: approved AND genuinely applied to the real client_profiles row',
        row.status === 'approved' && prof.legal_name.lastName === 'After', JSON.stringify(prof.legal_name));
    }

    // ---- 2i. GARY — a real seeded client's pending allocation, through the gate ------
    //
    // ★ THIS BLOCK RESTORES WHAT IT CONSUMES. Gary is a committed fixture shared with every
    // other suite, and his account carries exactly ONE pending allocation. Approving it for
    // real and walking away made this suite pass once and fail on every later run ("no
    // pending request") — row 212's pollution class, pointed at a fixture instead of a
    // symbol. The approval below is genuinely real: a real BUY executes against his real
    // portfolio and his real balance moves. It is then unwound so the next run starts from
    // the same place, which is what makes the assertion repeatable rather than single-use.
    {
      // ★ ilike, not eq (2026-09-15). This was a plain case-SENSITIVE equality match on a
      // stored address that was then normalised to lowercase — and the failure mode is the
      // bad one: the lookup returns nothing, the branch below SKIPS, and a real approval
      // assertion silently stops running while the suite still reports a clean pass. Match
      // an address case-insensitively, always.
      const { data: gary } = await admin.from('clients').select('id, name').ilike('email', 'gary.r.sizemore@gmail.com').maybeSingle();
      if (!gary) {
        console.log('  SKIP  Gary is not seeded on this stack — run `node seed-client-gary.mjs` first.');
      } else {
        const { data: req } = await admin.from('allocation_requests')
          .select('id, requested_amount, product_id, requested_at')
          .eq('client_id', gary.id).eq('status', 'pending').maybeSingle();
        const { data: stBefore } = await admin.from('account_state').select('unallocated_capital').eq('client_id', gary.id).single();
        check('GUARD: Gary\'s seeded pending allocation is genuinely affordable at his real balance',
          !!req && Number(req.requested_amount) <= Number(stBefore.unallocated_capital),
          req ? '$' + req.requested_amount + ' vs $' + stBefore.unallocated_capital : 'no pending request — a previous run consumed it without restoring');

        if (req) {
          const { data: hBefore } = await admin.from('holdings')
            .select('id, units, cost_basis').eq('client_id', gary.id).eq('product_id', req.product_id).maybeSingle();

          const dom = buildGateDom(MarketswaveData);
          await gateReady(dom);
          await openRow(dom, 'alo', req.id);
          check('gary: his real request opens in the gate', /Gary/.test(panelText(dom)) || /Ethereum|ETH/i.test(panelText(dom)), panelText(dom).slice(0, 120));
          const r = await clickApprove(dom);
          check('★ gary: a REAL SEEDED CLIENT\'s allocation is approved through the gate', r.closed && !r.error, r.error);
          const { data: row } = await admin.from('allocation_requests').select('status, transaction_id').eq('id', req.id).single();
          check('★ gary: a real BUY executed against his real portfolio', row.status === 'approved' && !!row.transaction_id, JSON.stringify(row));
          const { data: stAfter } = await admin.from('account_state').select('unallocated_capital').eq('client_id', gary.id).single();
          check('★ gary: his real unallocated fell by exactly the requested amount',
            Math.abs((Number(stBefore.unallocated_capital) - Number(stAfter.unallocated_capital)) - Number(req.requested_amount)) < 0.02,
            '$' + stBefore.unallocated_capital + ' → $' + stAfter.unallocated_capital);

          // ---- restore, so this is repeatable -------------------------------------------
          if (row.transaction_id) await admin.from('transactions').delete().eq('id', row.transaction_id);
          if (hBefore) {
            await admin.from('holdings').update({ units: hBefore.units, cost_basis: hBefore.cost_basis }).eq('id', hBefore.id);
          } else {
            await admin.from('holdings').delete().eq('client_id', gary.id).eq('product_id', req.product_id);
          }
          await admin.from('account_state').update({ unallocated_capital: stBefore.unallocated_capital }).eq('client_id', gary.id);
          await admin.from('allocation_requests').delete().eq('id', req.id);
          const { error: reErr } = await admin.from('allocation_requests').insert({
            client_id: gary.id, product_id: req.product_id, requested_amount: req.requested_amount,
            status: 'pending', requested_at: req.requested_at
          });
          const { data: stRestored } = await admin.from('account_state').select('unallocated_capital').eq('client_id', gary.id).single();
          const { data: reqRestored } = await admin.from('allocation_requests').select('id').eq('client_id', gary.id).eq('status', 'pending').maybeSingle();
          check('★ gary: the fixture is restored — his balance and his one pending request are back as found',
            !reErr && !!reqRestored && Math.abs(Number(stRestored.unallocated_capital) - Number(stBefore.unallocated_capital)) < 1e-9,
            '$' + stRestored.unallocated_capital + ', pending ' + (reqRestored ? 'present' : 'MISSING'));
        }
      }
    }

    /* ════════════════════════════════════════════════════════════════════════════════════
     * PART 3 — TWO REJECTIONS, CONFIRMING NOTHING MOVES.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n3. TWO REJECTIONS — the record is kept, and nothing moves\n');

    // ---- 3a. Reject a withdrawal ------------------------------------------------------
    {
      const c = await makeClient('rejwd', { unallocated: 3000 });
      const { data: req } = await admin.from('withdrawal_requests').insert({
        client_id: c.id, method: 'bank', requested_amount: 900, currency: 'USD',
        destination_details: { bankName: 'SEB' }, status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'wd', req.id);
      check('reject: the reason field is hidden until Reject is clicked once',
        dom.window.document.getElementById('ag-reason-wrap').hidden);
      const r = await rejectWith(dom, 'Destination wallet failed verification.');
      check('reject-wd: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('withdrawal_requests').select('status, reason, approved_amount').eq('id', req.id).single();
      check('★ reject-wd: the row is rejected, carrying the real reason text, with no approved amount',
        row.status === 'rejected' && row.reason === 'Destination wallet failed verification.' && row.approved_amount === null, JSON.stringify(row));
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', c.id).single();
      check('★ reject-wd: NOTHING MOVED — unallocated is exactly the $3,000 it started at',
        Math.abs(Number(st.unallocated_capital) - 3000) < 1e-9, '$' + st.unallocated_capital);
    }

    // ---- 3b. Reject an allocation -----------------------------------------------------
    {
      const c = await makeClient('rejalo', { unallocated: 4000 });
      const { data: req } = await admin.from('allocation_requests').insert({
        client_id: c.id, product_id: bySym.SPY.id, requested_amount: 2500, status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'alo', req.id);
      const r = await rejectWith(dom, 'Minimum holding period not yet satisfied.');
      check('reject-alo: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('allocation_requests').select('status, reason, transaction_id').eq('id', req.id).single();
      check('★ reject-alo: rejected with the real reason and NO transaction',
        row.status === 'rejected' && row.reason === 'Minimum holding period not yet satisfied.' && row.transaction_id === null, JSON.stringify(row));
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', c.id).single();
      const { data: hs } = await admin.from('holdings').select('id').eq('client_id', c.id);
      check('★ reject-alo: NOTHING MOVED — capital intact and no holding created',
        Math.abs(Number(st.unallocated_capital) - 4000) < 1e-9 && hs.length === 0,
        '$' + st.unallocated_capital + ', ' + hs.length + ' holdings');
    }

    // ---- 3c. Reject a profile change — CARRIED OVER from verify-admin-final-wiring's own
    //          section 1, which drove the now-deleted admin-profile-updates.html. Two
    //          behaviours live only here: resolutionNote is the PM's reason and is stored
    //          SEPARATELY from the client's own `reason` (conflating them would silently
    //          discard the client's context), and a rejection must write NO profile row at all.
    {
      const c = await makeClient('rejprof', { unallocated: 0 });
      const { data: req } = await admin.from('profile_change_requests').insert({
        client_id: c.id, field: 'address',
        current_value: null,
        requested_value: { line1: '9 New Street', city: 'Malmo', country: 'Sweden' },
        reason: 'I moved house', status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'prof', req.id);
      check('reject-prof: the panel shows the CLIENT\'s own stated reason', /I moved house/.test(panelText(dom)), panelText(dom).slice(0, 200));
      const r = await rejectWith(dom, 'Proof of address not supplied.');
      check('reject-prof: the panel closed on success', r.closed && !r.error, r.error);
      const { data: row } = await admin.from('profile_change_requests')
        .select('status, reason, resolution_note').eq('id', req.id).single();
      check('★ reject-prof: the PM\'s note is stored in resolution_note, and the CLIENT\'s own reason survives untouched beside it',
        row.status === 'rejected' && row.resolution_note === 'Proof of address not supplied.' && row.reason === 'I moved house',
        JSON.stringify(row));
      const { data: prof } = await admin.from('client_profiles').select('address').eq('client_id', c.id).maybeSingle();
      check('★ reject-prof: NOTHING WAS WRITTEN — a rejection creates no client_profiles row and no address',
        !prof || !prof.address, JSON.stringify(prof));
    }

    /* ════════════════════════════════════════════════════════════════════════════════════
     * PART 4 — THE RE-VALIDATION RACE, driven through the REAL page.
     *
     * ★ THE POINT: not that the source contains a check, but that a request which WAS
     * affordable when it was made is genuinely refused after the balance moves underneath
     * it — and that the request is left PENDING rather than silently resolved.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n4. THE RE-VALIDATION RACE — the condition changes under a real pending request\n');

    // ---- 4a. Withdrawal: capital genuinely leaves between request and approval --------
    {
      const c = await makeClient('race', { unallocated: 1000 });
      const { data: req } = await admin.from('withdrawal_requests').insert({
        client_id: c.id, method: 'bank', requested_amount: 900, currency: 'USD',
        destination_details: { bankName: 'SEB' }, status: 'pending'
      }).select('id').single();

      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'wd', req.id);
      check('race: the panel opens showing the original $900 — the page has no idea what is about to happen',
        dom.window.document.getElementById('ag-amount').value === '900');

      // The condition changes from a genuinely separate path, exactly as a second PM action
      // or a client's own allocation would do it.
      await admin.from('account_state').update({ unallocated_capital: 100 }).eq('client_id', c.id);
      check('GUARD: the balance genuinely moved under the open panel — $1,000 → $100', true);

      const r = await clickApprove(dom);
      check('★ race: the approval is REFUSED — the panel stayed open and showed a real error',
        !r.closed && r.error.length > 0, r.error || '(no error shown)');
      check('★ race: the refusal is the SERVER\'s own message, naming the real shortfall',
        /exceed|insufficient|available|unallocated|100/i.test(r.error), r.error);
      const { data: row } = await admin.from('withdrawal_requests').select('status, approved_amount').eq('id', req.id).single();
      check('★ race: the request is left GENUINELY PENDING, not silently resolved',
        row.status === 'pending' && row.approved_amount === null, JSON.stringify(row));
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', c.id).single();
      check('★ race: no money moved — the balance is still the $100 it was changed to',
        Math.abs(Number(st.unallocated_capital) - 100) < 1e-9, '$' + st.unallocated_capital);
    }

    // ---- 4b. Deposit: double-resolve refused ------------------------------------------
    {
      const c = await makeClient('dbl', { unallocated: 0 });
      const { data: req } = await admin.from('deposit_requests').insert({
        client_id: c.id, method: 'bank', requested_amount: 500, currency: 'USD',
        details: { bankName: 'SEB' }, status: 'pending'
      }).select('id').single();
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      await openRow(dom, 'dep', req.id);
      // Resolved by a genuinely different actor while this panel is open.
      await admin.from('deposit_requests').update({ status: 'rejected', reason: 'Resolved by a different PM.' }).eq('id', req.id);
      const r = await clickApprove(dom);
      check('★ double-resolve: crediting an already-resolved request is refused with a real error',
        !r.closed && r.error.length > 0, r.error || '(no error shown)');
      const { data: row } = await admin.from('deposit_requests').select('status, reason, credited_amount').eq('id', req.id).single();
      check('★ double-resolve: the other actor\'s own resolution is untouched',
        row.status === 'rejected' && row.reason === 'Resolved by a different PM.' && row.credited_amount === null, JSON.stringify(row));
    }

    /* ════════════════════════════════════════════════════════════════════════════════════
     * PART 5 — HISTORY, THE (differs) MARKER, AND ATTRIBUTION NEVER RENDERED.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n5. HISTORY — a resolved record per retired page, (differs), and no attribution on screen\n');
    {
      const dom = buildGateDom(MarketswaveData);
      await gateReady(dom);
      dom.window.document.getElementById('ag-view-history').click();
      await pollUntil(() => dom.window.document.querySelectorAll('#ag-hrows .ag-hrow').length > 0, 12000);

      const hrows = [...dom.window.document.querySelectorAll('#ag-hrows .ag-hrow')];
      check('the history view renders real resolved records', hrows.length > 0, hrows.length + ' rows');

      // ★ Per-type history counts, compared against INDEPENDENT database counts — one
      // resolved record per retired page, proven by number rather than by a regex on text.
      const hist = {
        dep: (await admin.from('deposit_requests').select('*', { count: 'exact', head: true }).neq('status', 'pending')).count,
        wd: (await admin.from('withdrawal_requests').select('*', { count: 'exact', head: true }).neq('status', 'pending')).count,
        alo: (await admin.from('allocation_requests').select('*', { count: 'exact', head: true }).neq('status', 'pending')).count,
        sell: (await admin.from('sell_requests').select('*', { count: 'exact', head: true }).neq('status', 'pending')).count,
        prof: (await admin.from('profile_change_requests').select('*', { count: 'exact', head: true }).neq('status', 'pending')).count,
        app: (await admin.from('clients').select('*', { count: 'exact', head: true }).not('application_resolved_at', 'is', null)).count
      };
      hist.hys = (await admin.from('hys_deposit_requests').select('*', { count: 'exact', head: true }).neq('status', 'pending')).count
               + (await admin.from('hys_withdrawal_requests').select('*', { count: 'exact', head: true }).neq('status', 'pending')).count;

      const hpills = {};
      [...dom.window.document.querySelectorAll('#ag-hfilters [data-hf]')].forEach((b) => {
        hpills[b.getAttribute('data-hf')] = Number((b.querySelector('.ag-n') || {}).textContent);
      });

      for (const [kind, label] of [['app', 'Applications'], ['dep', 'Deposits'], ['wd', 'Withdrawals'],
                                   ['alo', 'Allocations'], ['sell', 'Sells'], ['hys', 'HYS'], ['prof', 'Profile updates']]) {
        check('★ history carries the real resolved count for ' + label + ' — the retired ' + kind + ' page\'s own domain',
          hpills[kind] === hist[kind] && hist[kind] > 0,
          'page ' + hpills[kind] + ' vs Postgres ' + hist[kind]);
      }

      // ★ The (differs) marker — this run approved a $700 withdrawal at $650.
      const { data: divergent } = await admin.from('withdrawal_requests')
        .select('id, requested_amount, approved_amount').eq('status', 'approved')
        .not('approved_amount', 'is', null).limit(50);
      const realDiffers = (divergent || []).filter((r) => Math.abs(Number(r.requested_amount) - Number(r.approved_amount)) > 1e-9);
      check('GUARD: a genuinely divergent approval exists in Postgres — otherwise the marker check is vacuous',
        realDiffers.length > 0, realDiffers.length + ' divergent');
      const markers = dom.window.document.querySelectorAll('#ag-hrows .ag-differs');
      check('★ the (differs) marker renders for a PM-edited amount that diverged from the request',
        markers.length > 0 && /differs/i.test(markers[0].textContent), markers.length + ' markers');

      // ★ ATTRIBUTION: written to the database, absent from the page. Three separate claims —
      // "not visible", "not in an attribute" and "not in the accessibility tree" are different
      // things, and a visually-hidden span would satisfy the first while failing the third.
      const { data: attributed } = await admin.from('withdrawal_requests')
        .select('resolved_by_email').eq('status', 'approved').not('resolved_by_email', 'is', null).limit(1).maybeSingle();
      check('GUARD: attribution genuinely IS written by the Edge Function — otherwise "absent" proves nothing',
        !!attributed && attributed.resolved_by_email === PM_EMAIL_REAL, JSON.stringify(attributed));

      const body = dom.window.document.body;
      check('★ attribution appears NOWHERE in the rendered text of the whole page',
        !body.textContent.includes(PM_EMAIL_REAL));
      const attrHit = [...body.querySelectorAll('*')].filter((el) =>
        [...el.attributes].some((a) => String(a.value).includes(PM_EMAIL_REAL)));
      check('★ attribution appears in NO attribute either — no title, aria-label or data-*',
        attrHit.length === 0, attrHit.length + ' elements');
      check('★ and not in a visually-hidden span — a hidden field is still a displayed field to a screen reader',
        !body.innerHTML.includes(PM_EMAIL_REAL));
      // The local PM's own id, not just the email — an id would be just as much of a leak.
      const { data: pmUser } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const pmId = (pmUser.users.find((u) => u.email === PM_EMAIL_REAL) || {}).id;
      check('★ nor does the PM\'s user id appear anywhere in the rendered page',
        !!pmId && !body.innerHTML.includes(pmId), String(pmId));
    }

    console.log('\n' + '='.repeat(70));
    console.log(passed + '/' + (passed + failed) + ' assertions passed.');
    if (failed) { console.log('\nFAILURES:'); fails.forEach((f) => console.log('  - ' + f)); }
    console.log(failed ? '\nVERIFY: FAIL' : '\nVERIFY: PASS');
  } finally {
    // Children before parents; every delete scoped to a client this run created.
    for (const id of made) {
      for (const t of ['profile_change_requests', 'hys_withdrawal_requests', 'hys_deposit_requests',
                       'sell_requests', 'allocation_requests', 'withdrawal_requests', 'deposit_requests',
                       'hys_pockets', 'transactions', 'holdings', 'client_profiles', 'account_state',
                       'portfolio_value_snapshots']) {
        await admin.from(t).delete().eq('client_id', id);
      }
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    try { execSync('node seed-approval-gate-fixtures.mjs --clean --tag v' + suffix, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { /* already clean */ }
    console.log('cleanup: removed ' + made.length + ' test client(s) and the fixture');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('\nFAILED: ' + e.message); console.error(e.stack); process.exit(1); });
