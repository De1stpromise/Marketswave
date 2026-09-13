#!/usr/bin/env node
// ★ Portfolio overview (2026-09-12) — the REAL dashboard.html inline script and the real
// portfolio-overview.js in a real jsdom DOM, against real local data: an established client
// (four real anchors, three pending request types, three real pockets) and a new client with
// fewer anchors than the threshold. Chart.js is replaced by a recording stub (jsdom has no
// canvas) so the dataset handed to the chart can be checked against the table; the real
// Chart.js instance is proven by verify-portfolio-overview-visual.mjs in a real browser.
//
// Run from scripts/:  npm run verify-portfolio-overview-ui-wiring
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(test, maxMs) { const s = Date.now(); while (Date.now() - s < maxMs) { if (await test()) return true; await sleep(150); } return test(); }
function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function callFunction(url, token, name, body) {
  const r = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  let json = null; try { json = await r.json(); } catch (_e) {}
  return { status: r.status, body: json };
}
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}
function extractBodyMarkup(htmlPath) {
  return readFileSync(htmlPath, 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
}
const vc = new VirtualConsole(); // canvas "not implemented" noise stays out of the log
function buildPageDom(htmlPath) {
  return new JSDOM('<!doctype html><html><body>' + extractBodyMarkup(htmlPath) + '</body></html>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
}
const monthStart = (offset) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1)).toISOString().slice(0, 10); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonYYYY = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };

async function main() {
  console.log('Portfolio overview — real dashboard.html UI\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyOverviewUI-2026!';
  const { data: pmSess } = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  const pmToken = pmSess.session.access_token;

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  const root = new URL('../', import.meta.url);
  const dashPath = fileURLToPath(new URL('dashboard.html', root));
  const overviewSource = readFileSync(fileURLToPath(new URL('portfolio-overview.js', root)), 'utf8');
  const script = extractInlineScript(dashPath, 'UI Wiring — Stage 1');

  const ids = [], pocketIds = [];
  async function makeClient(tag, name, cash) {
    const email = 'povui-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    ids.push(data.user.id);
    await admin.from('clients').insert({ id: data.user.id, name, email: 'povui-' + tag + '-' + data.user.id, phone: '+1', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: data.user.id, unallocated_capital: cash, allocated_capital: 0, asset_returns: 0 });
    const { data: s } = await anon.auth.signInWithPassword({ email, password });
    return { id: data.user.id, email, token: s.session.access_token };
  }
  const A = await makeClient('a', 'Overview UI A', 100000);
  const B = await makeClient('b', 'Overview UI B', 52000);

  async function loadDashboardAs(client) {
    const dom = buildPageDom(dashPath);
    const captured = [];
    dom.window.MarketswaveData = MarketswaveData;
    dom.window.clientScopedKey = (k) => k + ':' + client.id;
    dom.window.Chart = function (ctx, cfg) { captured.push(cfg); return { destroy() {}, update() {}, data: cfg.data }; };
    dom.window.Chart.getChart = () => null;
    dom.window.eval(overviewSource);
    const shared = await MarketswaveData.getSupabaseClient();
    await shared.auth.signInWithPassword({ email: client.email, password });
    dom.window.eval(script);
    const D = dom.window.document;
    await pollUntil(() => !/animate-pulse/.test(D.getElementById('po-change').innerHTML) && !/animate-pulse/.test(D.getElementById('po-pending').innerHTML), 30000);
    return { dom, D, captured };
  }

  try {
    // ---- seed A: four anchors (real writer, account moved between them), pending requests, pockets
    const plan = [[3, 100000], [2, 104000], [1, 101500], [0, 110000]];
    for (const [offset, cash] of plan) {
      await admin.from('account_state').update({ unallocated_capital: cash }).eq('client_id', A.id);
      await callFunction(url, pmToken, 'snapshot-portfolio-values', { monthStartDate: monthStart(offset), clientId: A.id });
    }
    await admin.from('account_state').update({ unallocated_capital: 120000 }).eq('client_id', A.id);
    const wd = await callFunction(url, A.token, 'request-withdrawal', { method: 'bank', amount: 2500, currency: 'USD', destinationDetails: { bank: 'Test Bank', account: '123' } });
    const alo = await callFunction(url, A.token, 'request-allocation', { productId: 'PROD-0003', dollarAmount: 3000 });
    const hys = await callFunction(url, A.token, 'request-hys-deposit', { pocketType: 'fixed', term: { mode: 'short', value: 6 }, amount: 6000, method: 'internal', details: {} });
    check('seed: three real pending requests of three types exist', wd.status === 200 && alo.status === 200 && hys.status === 200, JSON.stringify([wd.body, alo.body, hys.body]));
    const now = Date.now(), day = 86400000;
    const { data: pk } = await admin.from('hys_pockets').insert([
      { client_id: A.id, pocket_type: 'fixed', amount: 52400, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5, maturity_date: new Date(now + 60 * day).toISOString(), projected_interest: 2227, funding_method: 'bank account', created_at: new Date(now - 120 * day).toISOString() },
      { client_id: A.id, pocket_type: 'ayw', amount: 18300, status: 'active', funding_method: 'crypto wallet', projected_interest: 0, created_at: new Date(now - 30 * day).toISOString() }
    ]).select('id');
    pk.forEach((p) => pocketIds.push(p.id));
    const server = (await callFunction(url, A.token, 'get-portfolio-overview', {})).body;

    // ================================================================================
    console.log('1. Established client — chart, ranges, pending, maturities');
    // ================================================================================
    const { D, captured } = await loadDashboardAs(A);
    // The card states NO figure (2026-09-12): the Total portfolio value card above it already
    // does, and this section answers "how has it changed", not "what am I worth".
    check('★ the card is titled "Portfolio value over time" and states no dollar figure outside the chart', D.querySelector('#po-value-card .ret-k').textContent.trim() === 'Portfolio value over time' && !D.getElementById('po-value') && !/\$/.test(D.querySelector('#po-value-card .po-top').textContent.replace(/\+\$[\d,]+ · [+−]?[\d.]+%/, '')), D.querySelector('#po-value-card .po-top').textContent);
    const change = D.getElementById('po-change');
    check('the change pill shows the server change and names the first anchor month', !change.hidden && /\+\$20,000 · \+20\.0%/.test(change.textContent) && change.textContent.indexOf('since ' + fmtMonYYYY(server.history.firstAnchor.date)) !== -1, change.textContent);
    check('the chart is shown and the new-client explanation hidden', !D.getElementById('po-chart-wrap').classList.contains('hidden') && D.getElementById('po-newc').classList.contains('hidden'));
    const line = captured.filter((c) => c.type === 'line');
    check('a real line chart config was handed to Chart.js', line.length >= 1);
    const first = line[0];
    const expectedAll = server.history.anchors.map((a) => a.value).concat([server.history.currentValue]);
    const buttons = [...D.querySelectorAll('#po-ranges .po-rg')];
    check('four range controls rendered, 1Y selected by default (4 anchors within a year)', buttons.length === 4 && buttons.find((b) => b.dataset.range === '12').classList.contains('is-on'));
    check('★ the initial dataset equals the table anchors + today\'s live value (cross-checked against the server rows)', JSON.stringify(first.data.datasets[0].data) === JSON.stringify(expectedAll), JSON.stringify({ chart: first.data.datasets[0].data, expected: expectedAll }));
    check('...with one label per point, the last being Today', first.data.labels.length === expectedAll.length && first.data.labels[first.data.labels.length - 1] === 'Today', JSON.stringify(first.data.labels));
    check('the y axis formats ticks as compact dollars and the tooltip shows the exact value', typeof first.options.scales.y.ticks.callback === 'function' && first.options.scales.y.ticks.callback(1400000) === '$1.4m' && first.options.plugins.tooltip.callbacks.label({ parsed: { y: 1286400 } }) === '$1,286,400');
    const table = D.getElementById('po-chart-table');
    check('a screen-reader table lists every plotted point with its exact value', table && table.querySelectorAll('tbody tr').length === expectedAll.length && /\$110,000/.test(table.textContent));

    // Range controls genuinely filter: 3M keeps the anchors dated within the last three months.
    const before = captured.length;
    buttons.find((b) => b.dataset.range === '3').click();
    await sleep(50);
    const after3 = captured.slice(before).find((c) => c.type === 'line');
    const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
    const expected3 = server.history.anchors.filter((a) => new Date(a.date + 'T00:00:00Z') >= cutoff).map((a) => a.value).concat([server.history.currentValue]);
    check('★ 3M genuinely filters: the redrawn dataset is the anchors dated within 3 months + today, shorter than All', after3 && JSON.stringify(after3.data.datasets[0].data) === JSON.stringify(expected3) && expected3.length < expectedAll.length, JSON.stringify({ got: after3 && after3.data.datasets[0].data, expected3, all: expectedAll }));
    check('...and the 3M control is now the selected one', buttons.find((b) => b.dataset.range === '3').classList.contains('is-on') && !buttons.find((b) => b.dataset.range === '12').classList.contains('is-on'));
    buttons.find((b) => b.dataset.range === 'all').click();
    await sleep(50);
    const afterAll = captured.slice(-1)[0];
    check('All restores the full series', JSON.stringify(afterAll.data.datasets[0].data) === JSON.stringify(expectedAll));

    const rows = [...D.querySelectorAll('#po-pending .po-row')];
    check('the pending panel lists the three real requests (server count ' + server.pending.length + ')', rows.length === server.pending.length && rows.length === 3, String(rows.length));
    const hysRow = rows.find((r) => r.dataset.requestType === 'hys_deposit');
    check('the internal-transfer pocket request carries the Internal transfer chip and $6,000', hysRow && hysRow.querySelector('.po-chip.is-internal') && /\$6,000/.test(hysRow.textContent), hysRow && hysRow.textContent);
    check('every row carries the Pending chip and links to its own page', rows.every((r) => r.querySelector('.po-chip') && r.querySelector('.po-chip').textContent === 'Pending' && /\.html$/.test(r.getAttribute('href'))));
    const aloRow = rows.find((r) => r.dataset.requestType === 'allocation');
    check('the allocation row names the real product and links to asset-performance.html', aloRow && /Global Equity ETF/.test(aloRow.textContent) && aloRow.getAttribute('href') === 'asset-performance.html', aloRow && aloRow.textContent);

    const mats = [...D.querySelectorAll('#po-maturities .po-mat')];
    check('two pockets rendered', mats.length === 2);
    const fixed = mats.find((m) => m.dataset.kind === 'fixed');
    const fixedSrv = server.maturities.find((m) => m.kind === 'fixed');
    check('the fixed pocket shows value, maturity date, 60 days, accrued interest and a progress bar at the server percentage', fixed && /\$52,400/.test(fixed.textContent) && /60 days/.test(fixed.textContent) && /accrued/.test(fixed.textContent) && fixed.querySelector('.po-bar i') && fixed.querySelector('.po-bar i').style.width === fixedSrv.progressPercent + '%', fixed && fixed.textContent + ' | ' + (fixed.querySelector('.po-bar i') || {}).style);
    const flex = mats.find((m) => m.dataset.kind === 'flexible');
    check('★ the flexible pocket has no bar and says so — no term, no interest', flex && !flex.querySelector('.po-bar') && /No fixed term/.test(flex.textContent) && /No interest/.test(flex.textContent), flex && flex.textContent);

    // ================================================================================
    console.log('\n2. New client — under the threshold');
    // ================================================================================
    // ★ The live-site bug (2026-09-12), reproduced exactly: the one anchor is a $0 snapshot
    // written BEFORE the account was funded. The page used to read "+$52,000 since <month>".
    await admin.from('account_state').update({ unallocated_capital: 0 }).eq('client_id', B.id);
    await callFunction(url, pmToken, 'snapshot-portfolio-values', { monthStartDate: monthStart(0), clientId: B.id }); // one $0 anchor: still under 3
    await admin.from('account_state').update({ unallocated_capital: 52000 }).eq('client_id', B.id);
    const b = await loadDashboardAs(B);
    const bChange = b.D.getElementById('po-change');
    check('★ no change figure and no pill at all under the threshold — a lone $0 anchor plus a funded account never reads as "+$52,000 since"', bChange.hidden === true && bChange.querySelector('.po-pill') === null && !/\$/.test(bChange.textContent), bChange.outerHTML);
    check('the chart and range controls are hidden', b.D.getElementById('po-chart-wrap').classList.contains('hidden') && b.D.getElementById('po-ranges').classList.contains('hidden'));
    const newc = b.D.getElementById('po-newc');
    check('the explanation is shown, honest about the threshold and how snapshots work', !newc.classList.contains('hidden') && /appears after 3 monthly points \(1 so far\)/.test(newc.textContent) && /start of each month/.test(newc.textContent), newc.textContent);
    check('...with the client-since date and NO repeated figure — the Total portfolio value card already states it', !newc.querySelector('.po-newc-fig') && !/\$/.test(newc.textContent) && /Client since/.test(newc.querySelector('.po-newc-sub').textContent), newc.textContent);
    check('no line chart was created for the new client', b.captured.filter((c) => c.type === 'line').length === 0);
    check('the value appears exactly once on the page — in the Total portfolio value card, not this section', b.D.getElementById('po-value') === null && !/\$52,000/.test(b.D.getElementById('po-value-card').textContent), b.D.getElementById('po-value-card').textContent);
    check('both side panels show their empty states', /Nothing pending/.test(b.D.getElementById('po-pending').textContent) && /No savings pockets yet/.test(b.D.getElementById('po-maturities').textContent));
  } finally {
    if (pocketIds.length) await admin.from('hys_pockets').delete().in('id', pocketIds);
    for (const t of ['withdrawal_requests', 'allocation_requests', 'hys_deposit_requests', 'portfolio_value_snapshots', 'holdings', 'transactions', 'account_state']) await admin.from(t).delete().in('client_id', ids);
    await admin.from('clients').delete().in('id', ids);
    for (const id of ids) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.error('CLEANUP: ' + error.message); }
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed) { console.log('VERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('VERIFY: PASS');
}

runVerifyMain(main, { watchdogMs: 300000 });
