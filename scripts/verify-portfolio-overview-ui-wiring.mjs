#!/usr/bin/env node
// ★ Portfolio overview (2026-09-12; bundled card 2026-09-13) — the REAL dashboard.html inline
// script and the real portfolio-overview.js in a real jsdom DOM, against real local data: an
// established client (four real anchors with real capital flows between them — a deposit
// before the first anchor, a withdrawal, a transfer to savings, an EXCLUDED external pocket
// deposit, and a deposit this month — three pending request types, two real pockets) and a
// new client with fewer anchors than the threshold. Chart.js is replaced by a recording stub
// (jsdom has no canvas) so the datasets handed to the chart — the portfolio line, the stepped
// capital-in line and the event dots — can be checked against the table and the ledger; the
// real Chart.js instance is proven by verify-portfolio-overview-visual.mjs in a real browser.
//
// The band's figures are cross-checked against get-returns-summary and the snapshot table,
// never against the payload the page was handed alone.
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
    await pollUntil(() => !/animate-pulse/.test(D.getElementById('tpv-monthly-change').innerHTML) && !/animate-pulse/.test(D.getElementById('po-pending').innerHTML) && !/animate-pulse/.test(D.getElementById('total-return-split').innerHTML) && !/animate-pulse/.test(D.getElementById('tpv-amount').innerHTML), 30000);
    return { dom, D, captured };
  }

  try {
    // ---- seed A. Four anchors through the real writer, each backdated to its own month start
    // (the writer stamps created_at now; capital in is taken as of created_at, so the anchor
    // must genuinely predate the flows that follow it). Ledger rows inserted directly with
    // real dates — the same rows credit-deposit / approve-withdrawal / credit-hys-deposit
    // write, placed in time.
    const msAt = (offset, day) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, day)).toISOString(); };
    const plan = [[3, 100000], [2, 112000], [1, 109500], [0, 118000]];
    for (const [offset, cash] of plan) {
      await admin.from('account_state').update({ unallocated_capital: cash }).eq('client_id', A.id);
      await callFunction(url, pmToken, 'snapshot-portfolio-values', { monthStartDate: monthStart(offset), clientId: A.id });
      await admin.from('portfolio_value_snapshots').update({ created_at: msAt(offset, 1) }).eq('client_id', A.id).eq('month_start_date', monthStart(offset));
    }
    // The END state is a possible real account: 110,000 of net capital in sitting as
    // unallocated capital plus 18,000 of realised gains (account_state.asset_returns) —
    // TPV 128,000. A seed that simply set unallocated to 128,000 would carry 18,000 no ledger
    // row explains, and the identity assertion below correctly refuses it.
    await admin.from('account_state').update({ unallocated_capital: 110000, asset_returns: 18000 }).eq('client_id', A.id);
    const { error: ledgerErr } = await admin.from('transactions').insert([
      { client_id: A.id, type: 'DEPOSIT', total_value: 100000, status: 'completed', created_at: msAt(4, 20) },
      { client_id: A.id, type: 'WITHDRAWAL', total_value: 2000, status: 'completed', created_at: msAt(2, 10) },
      { client_id: A.id, type: 'HYS_TRANSFER_IN', total_value: 3000, status: 'completed', created_at: msAt(1, 12) },
      { client_id: A.id, type: 'HYS_DEPOSIT', total_value: 5000, status: 'completed', created_at: msAt(1, 15) },
      { client_id: A.id, type: 'DEPOSIT', total_value: 15000, status: 'completed', created_at: msAt(0, 3) }
    ]);
    check('seed: five real ledger rows inserted (two deposits, a withdrawal, a transfer to savings, an external pocket deposit)', !ledgerErr, ledgerErr && ledgerErr.message);
    // Independent expectations, computed from the seed itself (not from the server):
    //   capital in: 100,000 before every anchor; -2,000 after the withdrawal (-2/10); -3,000
    //   after the transfer (-1/12); the pocket deposit changes nothing; +15,000 this month.
    const EXP = {
      capitalInAtAnchor: [100000, 100000, 98000, 95000],
      returnAtAnchor: [0, 12000, 11500, 23000],
      capitalInNow: 110000, returnNow: 18000,
      thisMonth: { amount: 10000, percent: 8.47 },
      // month returns net of flows: (V1 - V0 - flow) / V0
      months: { m3: 12.0, m2: -0.45, m1: 10.5 }
    };
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
    const returns = (await callFunction(url, A.token, 'get-returns-summary', {})).body;
    const h = server.history;

    // ================================================================================
    console.log('1. Server payload — cross-checked against the seed, the table and get-returns-summary');
    // ================================================================================
    const table = (await admin.from('portfolio_value_snapshots').select('month_start_date, value_at_anchor').eq('client_id', A.id).order('month_start_date')).data;
    check('anchors equal the table rows, point for point', JSON.stringify(h.anchors.map((a) => [a.date, a.value])) === JSON.stringify(table.map((r) => [r.month_start_date, Number(r.value_at_anchor)])), JSON.stringify(h.anchors));
    check('★ capital in at each anchor is the ledger cumulative as of that anchor (deposit counted, withdrawal and transfer subtracted, pocket deposit ignored)', JSON.stringify(h.anchors.map((a) => a.capitalIn)) === JSON.stringify(EXP.capitalInAtAnchor), JSON.stringify(h.anchors.map((a) => a.capitalIn)));
    check('...and each anchor\'s return is value minus capital in', JSON.stringify(h.anchors.map((a) => a.return)) === JSON.stringify(EXP.returnAtAnchor), JSON.stringify(h.anchors.map((a) => a.return)));
    check('capital in now is 110,000 and the live return 18,000', h.capitalIn.current === EXP.capitalInNow && h.live.return === EXP.returnNow && h.live.value === 128000, JSON.stringify({ capitalIn: h.capitalIn, live: h.live }));
    check('★ THE IDENTITY: live value minus capital in equals get-returns-summary\'s total return, exactly', Math.abs(h.live.return - returns.total) < 0.005, JSON.stringify({ gap: h.live.return, total: returns.total }));
    check('four capital events, in date order, with the right kinds — the HYS_DEPOSIT is NOT among them', h.capitalIn.events.length === 4 && h.capitalIn.events.map((e) => e.kind).join(',') === 'deposit,withdrawal,transfer_out,deposit' && h.capitalIn.events.map((e) => e.cumulativeAfter).join(',') === '100000,98000,95000,110000', JSON.stringify(h.capitalIn.events));
    check('this month: +$10,000 (+8.47%) against the month\'s 118,000 anchor', h.thisMonth && h.thisMonth.anchorValue === 118000 && h.thisMonth.amount === EXP.thisMonth.amount && h.thisMonth.percent === EXP.thisMonth.percent, JSON.stringify(h.thisMonth));
    const ps = h.periodStats;
    check('period stats exist for every range (four anchors fall inside 3M, 6M, 1Y and All)', ps && ps['3'] && ps['6'] && ps['12'] && ps.all, JSON.stringify(ps));
    check('★ All: high is today (128,000), low is the first anchor (100,000)', ps.all.high.live === true && ps.all.high.value === 128000 && ps.all.low.value === 100000 && ps.all.low.date === monthStart(3), JSON.stringify(ps.all));
    check('★ All: best month is the first (+12.0%, no flows) and worst the second (−0.45% — the 2,000 withdrawal is netted out, not read as a loss)', ps.all.bestMonth.percent === EXP.months.m3 && ps.all.bestMonth.month === monthStart(3).slice(0, 7) && ps.all.worstMonth.percent === EXP.months.m2 && ps.all.worstMonth.month === monthStart(2).slice(0, 7), JSON.stringify([ps.all.bestMonth, ps.all.worstMonth]));
    check('★ 3M: the stats genuinely differ — best month is now the third (+10.5%, the 3,000 transfer netted out) and the low is 109,500', ps['3'].bestMonth.percent === EXP.months.m1 && ps['3'].low.value === 109500 && ps['3'].months === 2 && ps.all.months === 3, JSON.stringify(ps['3']));

    // ================================================================================
    console.log('\n2. Established client — the bundled card');
    // ================================================================================
    const { D, captured } = await loadDashboardAs(A);
    const card = D.getElementById('po-value-card');
    check('★ ONE card: the three summary cards and the chart card are gone; the band and the chart section live inside #po-value-card', card.querySelector('.po-band') && card.querySelector('.po-chart-sec') && card.querySelectorAll('.po-cell').length === 3 && !D.querySelector('.glass-subtle') && D.querySelectorAll('#tpv-amount').length === 1 && card.contains(D.getElementById('tpv-amount')), card.className);
    check('header: "Portfolio", an as-of indicator reading "Updated just now", and an enabled export control', card.querySelector('.po-title').textContent === 'Portfolio' && /Updated just now/.test(D.getElementById('po-asof').textContent) && D.getElementById('po-export').disabled === false);
    // (a) Total portfolio value: the figure, since-first pill, this-month figure.
    check('the value figure is the real $128,000, once, in the lead cell', D.getElementById('tpv-amount').textContent.trim() === '$128,000' && card.querySelector('.po-lead').contains(D.getElementById('tpv-amount')));
    const change = D.getElementById('po-change');
    check('the since pill shows +$28,000 · +28.0% since the first anchor month', !change.hidden && /\+\$28,000 · \+28\.0%/.test(change.textContent) && change.textContent.indexOf('since ' + fmtMonYYYY(h.firstAnchor.date)) !== -1 && change.querySelector('.po-pill.is-up'), change.textContent);
    const tm = D.getElementById('tpv-monthly-change');
    check('★ this month is a FIGURE beside the pill: "+$10,000 (+8.5%) this month"', !tm.hidden && /\+\$10,000/.test(tm.textContent) && /\+8\.5%/.test(tm.textContent) && /this month/.test(tm.textContent) && tm.querySelector('b.is-up'), tm.textContent);
    // (b) Total return: figure, split, sparkline — cross-checked against get-returns-summary.
    const tr = D.getElementById('total-return-amount');
    check('the return figure equals get-returns-summary total (+$18,000) with the gain tone', tr.textContent.trim() === '+$18,000' && /is-gain/.test(tr.className) && returns.total === 18000, tr.textContent + ' | ' + tr.className);
    const split = D.getElementById('po-split');
    check('★ the 4px split bar shows unrealised against realised by magnitude — here 0% / 100% (this seed has no holdings; the whole return is realised cash)', !split.hidden && parseFloat(split.children[0].style.width) === 0 && parseFloat(split.children[1].style.width) === 100, split.outerHTML);
    const spark = D.getElementById('po-spark');
    const sparkPath = spark.querySelector('path');
    check('★ the sparkline is the RETURN series: five points (four anchors + today) in one path, gain-toned since it ends above where it began', !spark.hidden && sparkPath && sparkPath.getAttribute('d').split(/[ML]/).filter(Boolean).length === 5 && sparkPath.getAttribute('stroke') === '#137254', spark.outerHTML);
    // (c) Best performing class — only the class, the pill, and "of N classes".
    const bpr = D.getElementById('best-performing-return');
    check('no holdings: the class cell reads an honest em dash and "No holdings yet", no pill, no ranking', D.getElementById('best-performing-class').textContent.trim() === '\u2014' && /No holdings yet/.test(bpr.textContent) && !bpr.querySelector('.ret-pc') && card.querySelectorAll('.po-cell:last-child .ret-sub').length === 1, bpr.textContent);

    // Chart section.
    check('the chart section is titled "Value over time" with a legend (Portfolio / Capital in / Deposit) and states no dollar figure', card.querySelector('.po-ch-title').textContent === 'Value over time' && !D.getElementById('po-legend').hidden && /Portfolio/.test(D.getElementById('po-legend').textContent) && /Capital in/.test(D.getElementById('po-legend').textContent) && !/\$/.test(card.querySelector('.po-ch-h').textContent), card.querySelector('.po-ch-h').textContent);
    check('...and the outflow legend entry appears, since a withdrawal and a transfer fall in range', !D.getElementById('po-legend-out').hidden);
    check('the chart is shown and the new-client explanation hidden', !D.getElementById('po-chart-wrap').classList.contains('hidden') && D.getElementById('po-newc').classList.contains('hidden'));
    const line = captured.filter((c) => c.type === 'line');
    check('a real line chart config was handed to Chart.js', line.length >= 1);
    const first = line[0];
    const expectedAll = h.anchors.map((a) => a.value).concat([h.currentValue]);
    const buttons = [...D.querySelectorAll('#po-ranges .po-rg')];
    check('four range controls rendered, 1Y selected by default (4 anchors within a year)', buttons.length === 4 && buttons.find((b) => b.dataset.range === '12').classList.contains('is-on'));
    const ds = first.data.datasets;
    check('★ dataset 0 (portfolio) equals the table anchors + today\'s live value, straight segments (tension 0)', JSON.stringify(ds[0].data.map((p) => p.y)) === JSON.stringify(expectedAll) && ds[0].tension === 0, JSON.stringify({ chart: ds[0].data, expectedAll }));
    const xOf = (iso) => new Date(iso + 'T00:00:00Z').getTime() / 86400000;
    const cap = ds[1].data;
    check('★ dataset 1 (capital in) is stepped and dashed: starts at 100,000 on the first anchor, steps DOWN 2,000 then 3,000 at the withdrawal and transfer dates, UP 15,000 at this month\'s deposit, ends at 110,000 today', ds[1].borderDash && ds[1].borderDash.length === 2 && cap[0].y === 100000 && cap[0].x === xOf(h.anchors[0].date) && cap[cap.length - 1].y === 110000 && cap.filter((p, i) => i > 0 && cap[i - 1].x === p.x).length === 3 && JSON.stringify(cap.map((p) => p.y)) === JSON.stringify([100000, 100000, 98000, 98000, 95000, 95000, 110000, 110000]), JSON.stringify(cap));
    const ev = ds[2];
    check('★ dataset 2 (events) has three dots on the portfolio line — the withdrawal, the transfer and this month\'s deposit (the first deposit predates the range; the pocket deposit is not an event)', ev.type === 'scatter' && ev.data.length === 3 && ev.pointBackgroundColor.join(',') === '#ffffff,#ffffff,#C8860A', JSON.stringify(ev));
    const evY = ev.data.map((p) => p.y);
    const between = (v, a, b) => v >= Math.min(a, b) - 0.01 && v <= Math.max(a, b) + 0.01;
    check('...each dot\'s y lies on the segment between the two anchors that bracket its date', between(evY[0], 112000, 109500) && between(evY[1], 109500, 118000) && between(evY[2], 118000, 128000), JSON.stringify(evY));
    const tableEl = D.getElementById('po-chart-table');
    const tRows = [...tableEl.querySelectorAll('tbody tr')];
    check('the screen-reader table lists every point with value, capital in and return', tRows.length === expectedAll.length && tRows[tRows.length - 1].textContent.indexOf('$128,000') !== -1 && tRows[tRows.length - 1].textContent.indexOf('$110,000') !== -1 && tRows[tRows.length - 1].textContent.indexOf('+$18,000') !== -1, tRows.map((r) => r.textContent).join(' | '));
    check('the tooltip is the external three-row one (Chart.js tooltip disabled) and the y axis formats compact dollars', first.options.plugins.tooltip.enabled === false && typeof first.options.plugins.tooltip.external === 'function' && first.options.scales.y.ticks.callback(1400000) === '$1.4m');

    // Period stats footer: rendered for 1Y, then GENUINELY recomputed on a real 3M click.
    const stats = D.getElementById('po-stats');
    const statCells = () => [...stats.querySelectorAll(':scope > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim());
    check('★ period stats (1Y): high $128,000 Today, low $100,000 on the first anchor, best month +12.0%, worst month −0.5%', !stats.hidden && statCells().length === 4 && /Period high\$128,000Today/.test(statCells()[0]) && /Period low\$100,000/.test(statCells()[1]) && /Best month\+12\.0%/.test(statCells()[2]) && /Worst month−0\.5%/.test(statCells()[3]), JSON.stringify(statCells()));
    const before = captured.length;
    buttons.find((b) => b.dataset.range === '3').click();
    await sleep(50);
    const after3 = captured.slice(before).find((c) => c.type === 'line');
    const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
    const expected3 = h.anchors.filter((a) => new Date(a.date + 'T00:00:00Z') >= cutoff).map((a) => a.value).concat([h.currentValue]);
    check('★ 3M genuinely filters: the redrawn portfolio dataset is the anchors dated within 3 months + today, shorter than All', after3 && JSON.stringify(after3.data.datasets[0].data.map((p) => p.y)) === JSON.stringify(expected3) && expected3.length < expectedAll.length, JSON.stringify({ got: after3 && after3.data.datasets[0].data, expected3 }));
    check('★ ...and the period stats RECOMPUTE: best month is now +10.5% and the low $109,500', /Best month\+10\.5%/.test(statCells()[2]) && /Period low\$109,500/.test(statCells()[1]), JSON.stringify(statCells()));
    check('...the capital-in line for 3M starts at the first in-range anchor\'s level (100,000 on the 1st — the withdrawal on the 10th is a step INSIDE the range) and ends at 110,000', after3.data.datasets[1].data[0].y === 100000 && after3.data.datasets[1].data[0].x === xOf(monthStart(2)) && after3.data.datasets[1].data.slice(-1)[0].y === 110000, JSON.stringify(after3.data.datasets[1].data));
    buttons.find((b) => b.dataset.range === 'all').click();
    await sleep(50);
    check('All restores the full series and the All stats', JSON.stringify(captured.slice(-1)[0].data.datasets[0].data.map((p) => p.y)) === JSON.stringify(expectedAll) && /Best month\+12\.0%/.test(statCells()[2]));

    // Export: CSV of the snapshot series, built from the payload already on the page.
    const csv = D.defaultView.MarketswavePortfolioOverview.buildCSV(h);
    const csvLines = csv.trim().split(/\r?\n/);
    check('★ the export is a CSV of the snapshot series: header + four anchors + today, each with value, capital in and return', csvLines[0] === 'Date,Portfolio value,Capital in,Return' && csvLines.length === 6 && csvLines[1] === monthStart(3) + ',100000.00,100000.00,0.00' && csvLines[4] === monthStart(0) + ',118000.00,95000.00,23000.00' && /\(live\),128000\.00,110000\.00,18000\.00$/.test(csvLines[5]), csv);

    const rows = [...D.querySelectorAll('#po-pending .po-row')];
    check('the pending panel lists the three real requests (server count ' + server.pending.length + ')', rows.length === server.pending.length && rows.length === 3, String(rows.length));
    const hysRow = rows.find((r) => r.dataset.requestType === 'hys_deposit');
    check('the internal-transfer pocket request carries the Internal transfer chip and $6,000', hysRow && hysRow.querySelector('.po-chip.is-internal') && /\$6,000/.test(hysRow.textContent), hysRow && hysRow.textContent);
    const mats = [...D.querySelectorAll('#po-maturities .po-mat')];
    check('two pockets rendered, the fixed one with a bar at the server percentage and the flexible one with no bar', mats.length === 2 && mats.find((m) => m.dataset.kind === 'fixed').querySelector('.po-bar i').style.width === server.maturities.find((m) => m.kind === 'fixed').progressPercent + '%' && !mats.find((m) => m.dataset.kind === 'flexible').querySelector('.po-bar'));

    // ================================================================================
    console.log('\n3. New client — under the threshold');
    // ================================================================================
    // ★ The live-site bug (2026-09-12), reproduced exactly: the one anchor is a $0 snapshot
    // written BEFORE the account was funded. The page used to read "+$52,000 since <month>".
    await admin.from('account_state').update({ unallocated_capital: 0 }).eq('client_id', B.id);
    await callFunction(url, pmToken, 'snapshot-portfolio-values', { monthStartDate: monthStart(0), clientId: B.id }); // one $0 anchor: still under 3
    await admin.from('account_state').update({ unallocated_capital: 52000 }).eq('client_id', B.id);
    await admin.from('transactions').insert({ client_id: B.id, type: 'DEPOSIT', total_value: 52000, status: 'completed' });
    const b = await loadDashboardAs(B);
    const bCard = b.D.getElementById('po-value-card');
    check('★ the band still renders — value $52,000, return $0, class "—" are all real today', b.D.getElementById('tpv-amount').textContent.trim() === '$52,000' && /\$0/.test(b.D.getElementById('total-return-amount').textContent) && b.D.getElementById('best-performing-class').textContent.trim() === '\u2014', b.D.getElementById('total-return-amount').textContent);
    const bChange = b.D.getElementById('po-change');
    check('★ no since-figure and no pill under the threshold — a lone $0 anchor plus a funded account never reads as "+$52,000 since"', bChange.hidden === true && bChange.querySelector('.po-pill') === null && !/\$/.test(bChange.textContent), bChange.outerHTML);
    const bTm = b.D.getElementById('tpv-monthly-change');
    check('★ this month reads "New this month" — the month opened at $0, so there is no honest change figure either (same gating, shorter horizon)', !bTm.hidden && bTm.textContent.trim() === 'New this month', bTm.textContent);
    check('the sparkline, legend, chart, range controls and period stats are all hidden', b.D.getElementById('po-spark').hidden && b.D.getElementById('po-legend').hidden && b.D.getElementById('po-chart-wrap').classList.contains('hidden') && b.D.getElementById('po-ranges').classList.contains('hidden') && b.D.getElementById('po-stats').hidden && b.D.getElementById('po-stats').textContent === '');
    const newc = b.D.getElementById('po-newc');
    check('the explanation is shown, honest about the threshold and how snapshots work', !newc.classList.contains('hidden') && /appears after 3 monthly points \(1 so far\)/.test(newc.textContent) && /start of each month/.test(newc.textContent), newc.textContent);
    check('...with the client-since date and NO repeated figure — the band already states it', !newc.querySelector('.po-newc-fig') && !/\$/.test(newc.textContent) && /Client since/.test(newc.querySelector('.po-newc-sub').textContent), newc.textContent);
    check('no line chart was created for the new client', b.captured.filter((c) => c.type === 'line').length === 0);
    check('the value appears exactly once on the page — in the band\'s lead cell, nowhere in the chart section', b.D.querySelectorAll('#po-value-card .po-lead #tpv-amount').length === 1 && !/\$52,000/.test(bCard.querySelector('.po-chart-sec').textContent), bCard.querySelector('.po-chart-sec').textContent);
    check('the export control is enabled (today\'s live point alone is exportable) and the CSV carries the live row', b.D.getElementById('po-export').disabled === false && /\(live\),52000\.00,52000\.00,0\.00/.test(b.D.defaultView.MarketswavePortfolioOverview.buildCSV((await callFunction(url, B.token, 'get-portfolio-overview', {})).body.history)));
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
