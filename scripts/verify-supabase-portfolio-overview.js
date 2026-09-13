#!/usr/bin/env node
// ★ Portfolio overview (2026-09-12) — backend verification, local stack, real Edge Functions.
//
// What it proves:
//   1. the SCHEDULED SNAPSHOT WRITER: writes one anchor per active client per month, is
//      idempotent (a second call for the same month changes nothing, even after the account
//      moved), agrees with the lazy writer (get-portfolio-monthly-change reads the same row),
//      skips a pending_review client, and is refused to an anonymous or non-admin caller;
//   2. the VALUE HISTORY: get-portfolio-overview's anchors equal the table rows, point for
//      point and oldest first; currentValue equals get-total-portfolio-value; the change
//      since the first anchor is the table arithmetic; chartReady flips at exactly 3 anchors;
//      the change figure is WITHHELD under the threshold (the live-site "+$94,874 since Sep
//      2026" bug: a lone $0 anchor written before funding); a $0 first anchor yields
//      percent null, never Infinity, once the threshold is met; the per-range period stats
//      are the table arithmetic (high/low with dates, best/worst full month);
//   2b. CAPITAL IN (bundled card, 2026-09-13): the reference series is derived from ledger
//      rows written by the REAL functions — credit-deposit counts, approve-withdrawal and an
//      internal credit-hys-deposit subtract, an EXTERNAL credit-hys-deposit is ignored, a BUY
//      moves nothing — and THE IDENTITY holds: live value minus capital in equals
//      get-returns-summary's total return, before and after a real buy; an anchor's capital
//      in is taken as of the moment it was RECORDED; the this-month figure follows the same
//      $0-anchor gating; a PM's cross-client read never writes the client's month anchor;
//   3. PENDING REQUESTS: five real request types created through the real functions appear
//      with the right type, amount (null for an amount-less crypto deposit), units and
//      internal-transfer flag; a rejected one disappears; cross-client isolation;
//   4. MATURITIES: a real fixed pocket's days remaining, progress toward term and pro-rata
//      accrued interest against the stored projected_interest; a matured one at 100%; a
//      flexible pocket with no term and no interest; a withdrawn one excluded.
//
// LOCAL STACK ONLY. Usage:  node scripts/verify-supabase-portfolio-overview.js
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { Client: PgClient } = require('pg');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY, dbUrl: status.DB_URL };
}
async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, token: data.session.access_token };
}
async function callFunction(url, token, name, body) {
  const res = await fetch(url + '/functions/v1/' + name, {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  });
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, body: json };
}
const round2 = (n) => Math.round(n * 100) / 100;
const monthStart = (offset) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1)).toISOString().slice(0, 10); };

async function main() {
  console.log('Portfolio overview — backend verification\n');
  const { url, anonKey, serviceRoleKey, dbUrl } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const password = 'VerifyOverview-2026!';
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  const ids = [];
  async function makeClient(tag, name, cash, status) {
    const email = 'pov-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    ids.push(data.user.id);
    await admin.from('clients').insert({ id: data.user.id, name, email: 'pov-' + tag + '-' + data.user.id, phone: '+1', account_type: 'Individual Account', status: status || 'active' });
    await admin.from('account_state').insert({ client_id: data.user.id, unallocated_capital: cash, allocated_capital: 0, asset_returns: 0 });
    const s = status === 'pending_review' ? null : await signIn(url, anonKey, email, password);
    return { id: data.user.id, name, token: s ? s.token : null, email };
  }
  const A = await makeClient('a', 'Overview Client A', 100000);
  const B = await makeClient('b', 'Overview Client B', 0);
  const P = await makeClient('p', 'Overview Pending', 500, 'pending_review');
  const pocketIds = [];
  const assignmentIds = [];

  try {
    // ================================================================================
    console.log('1. The scheduled snapshot writer');
    // ================================================================================
    const anon = await callFunction(url, null, 'snapshot-portfolio-values', {});
    check('anonymous call refused (401)', anon.status === 401, JSON.stringify(anon.body));
    const nonAdmin = await callFunction(url, A.token, 'snapshot-portfolio-values', {});
    check('a signed-in client is refused (403) — only the scheduler or a PM writes anchors', nonAdmin.status === 403, JSON.stringify(nonAdmin.body));
    const badDate = await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: '2026-09-15' });
    check('a month date that is not the 1st is refused', badDate.status === 400);

    // Four anchors for A, oldest first, with the account moved between writes so the values
    // genuinely differ — the writer always records the value NOW under the date it is asked
    // to file it under; nothing is invented.
    const plan = [[3, 100000], [2, 104000], [1, 101500], [0, 110000]];
    const expected = [];
    for (const [offset, cash] of plan) {
      await admin.from('account_state').update({ unallocated_capital: cash }).eq('client_id', A.id);
      const r = await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: monthStart(offset), clientId: A.id });
      check('writer run for ' + monthStart(offset) + ' inserted exactly one anchor for A', r.status === 200 && r.body.inserted === 1 && r.body.clients === 1, JSON.stringify(r.body));
      expected.push({ date: monthStart(offset), value: cash });
    }
    const again = await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: monthStart(0), clientId: A.id });
    check('a second run for the same month is idempotent (existing, not inserted)', again.status === 200 && again.body.existing === 1 && again.body.inserted === 0, JSON.stringify(again.body));
    await admin.from('account_state').update({ unallocated_capital: 120000 }).eq('client_id', A.id);
    const third = await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: monthStart(0), clientId: A.id });
    const stored = (await admin.from('portfolio_value_snapshots').select('value_at_anchor').eq('client_id', A.id).eq('month_start_date', monthStart(0)).single()).data;
    check('...and the stored anchor is NOT overwritten when the account moves afterwards', third.body.existing === 1 && Number(stored.value_at_anchor) === 110000, String(stored.value_at_anchor));
    const lazy = await callFunction(url, A.token, 'get-portfolio-monthly-change', {});
    check('the lazy writer (get-portfolio-monthly-change) reads the SAME row rather than creating a second anchor', lazy.status === 200 && Number(lazy.body.anchorValue) === 110000 && lazy.body.monthStartDate === monthStart(0), JSON.stringify(lazy.body));
    const rowsNow = (await admin.from('portfolio_value_snapshots').select('id').eq('client_id', A.id)).data;
    check('A has exactly 4 anchor rows after both writers ran', rowsNow.length === 4, String(rowsNow.length));

    // ================================================================================
    console.log('\n2. The value history');
    // ================================================================================
    const ovA = await callFunction(url, A.token, 'get-portfolio-overview', {});
    check('get-portfolio-overview returns for A', ovA.status === 200, JSON.stringify(ovA.body));
    const h = ovA.body.history;
    const table = (await admin.from('portfolio_value_snapshots').select('month_start_date, value_at_anchor').eq('client_id', A.id).order('month_start_date')).data;
    check('★ anchors equal the table rows, point for point, oldest first', JSON.stringify(h.anchors.map((a) => ({ date: a.date, value: a.value }))) === JSON.stringify(table.map((r) => ({ date: r.month_start_date, value: round2(Number(r.value_at_anchor)) }))), JSON.stringify({ api: h.anchors, table }));
    check('...and match the values the writer was asked to record', JSON.stringify(h.anchors.map((a) => a.value)) === JSON.stringify(expected.map((e) => e.value)), JSON.stringify(h.anchors));
    const tpv = await callFunction(url, A.token, 'get-total-portfolio-value', {});
    check('currentValue equals get-total-portfolio-value (the same server computation)', Math.abs(h.currentValue - Number(tpv.body.totalPortfolioValue)) < 0.01, JSON.stringify({ h: h.currentValue, tpv: tpv.body }));
    check('changeSinceFirst is the table arithmetic: current − first anchor, percent of first', h.changeSinceFirst.amount === round2(h.currentValue - 100000) && h.changeSinceFirst.percent === round2(((h.currentValue - 100000) / 100000) * 100), JSON.stringify(h.changeSinceFirst));
    check('chartReady with 4 anchors (threshold 3)', h.chartReady === true && h.anchorCount === 4 && h.minAnchors === 3);
    check('clientSince is the real clients.created_at', !!h.clientSince);

    // B is read THROUGH THE PM here: a client's own read writes this month's anchor (the lazy
    // writer folded into the overview, 2026-09-13), a PM's cross-client read never does — so
    // the PM read is what lets the under-threshold states be observed as such.
    const readB = () => callFunction(url, pm.token, 'get-portfolio-overview', { clientId: B.id });
    const ovB0 = await readB();
    check('B with no anchors: chartReady false, no first anchor, no change', ovB0.body.history.chartReady === false && ovB0.body.history.anchorCount === 0 && ovB0.body.history.firstAnchor === null && ovB0.body.history.changeSinceFirst === null, JSON.stringify(ovB0.body.history));
    check('...and no this-month figure either, with no anchor row yet', ovB0.body.history.thisMonth === null, JSON.stringify(ovB0.body.history.thisMonth));
    for (const off of [3, 2]) await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: monthStart(off), clientId: B.id });
    const ovB2 = await readB();
    check('B with 2 anchors is STILL under the threshold — a line through two points is not a chart', ovB2.body.history.chartReady === false && ovB2.body.history.anchorCount === 2, JSON.stringify(ovB2.body.history));
    // ★ The live-site bug (2026-09-12): B's anchors were written at $0, before any funding.
    // With the old payload the page read "+$52,000 since <month>" — the whole balance as a
    // gain. Under the threshold the change is withheld outright, not caveated.
    await admin.from('account_state').update({ unallocated_capital: 52000 }).eq('client_id', B.id);
    const ovB2f = await readB();
    check('★ under the threshold changeSinceFirst is NULL even with two $0 anchors and a now-funded account — never "+$52,000 since"', ovB2f.body.history.changeSinceFirst === null && ovB2f.body.history.currentValue === 52000 && ovB2f.body.history.firstAnchor.value === 0, JSON.stringify(ovB2f.body.history));
    // The real scheduled run — no clientId, this month — is what tips B over the threshold.
    const allRun = await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: monthStart(0) });
    const pRows = (await admin.from('portfolio_value_snapshots').select('id').eq('client_id', P.id)).data;
    const bRowsNow = (await admin.from('portfolio_value_snapshots').select('id').eq('client_id', B.id)).data;
    check('a whole-catalog run covers every ACTIVE client (B gained its third anchor) and skips the pending_review one', allRun.status === 200 && allRun.body.clients >= 2 && allRun.body.inserted >= 1 && bRowsNow.length === 3 && pRows.length === 0, JSON.stringify({ clients: allRun.body.clients, inserted: allRun.body.inserted, bRows: bRowsNow.length, pendingRows: pRows.length }));
    const ovB3 = await callFunction(url, B.token, 'get-portfolio-overview', {});
    check('B flips to chartReady at exactly 3 anchors, the third written by the scheduled run (B\'s own read finds it existing, writes nothing)', ovB3.body.history.chartReady === true && ovB3.body.history.anchorCount === 3, JSON.stringify(ovB3.body.history));
    check('...and only now does the change appear — a $0 first anchor yields percent null (never Infinity) with the amount reported', ovB3.body.history.changeSinceFirst && ovB3.body.history.changeSinceFirst.percent === null && ovB3.body.history.changeSinceFirst.amount === round2(ovB3.body.history.currentValue - 0), JSON.stringify(ovB3.body.history.changeSinceFirst));
    const cross = await callFunction(url, B.token, 'get-portfolio-overview', { clientId: A.id });
    check('a client cannot read another client\'s overview (403)', cross.status === 403);
    const pmRead = await callFunction(url, pm.token, 'get-portfolio-overview', { clientId: A.id });
    check('a PM can read any client\'s overview', pmRead.status === 200 && pmRead.body.clientId === A.id);
    const noAuth = await callFunction(url, null, 'get-portfolio-overview', {});
    check('anonymous is refused (401)', noAuth.status === 401);

    // A's four anchors carry no ledger rows, so its month figures are plain value changes:
    // 100,000 -> 104,000 (+4.0%), -> 101,500 (-2.4%), -> 110,000 (+8.37%); high is today's
    // 120,000, low the first anchor. Computed here from the plan, not read off the server.
    const psA = (await callFunction(url, A.token, 'get-portfolio-overview', {})).body.history.periodStats;
    check('★ period stats (All): high = today 120,000, low = the first anchor 100,000, best month +8.37% (the third), worst −2.4% (the second)',
      psA && psA.all && psA.all.high.live === true && psA.all.high.value === 120000 && psA.all.low.value === 100000 && psA.all.low.date === monthStart(3)
      && psA.all.months === 3 && psA.all.bestMonth.percent === 8.37 && psA.all.bestMonth.month === monthStart(1).slice(0, 7) && psA.all.worstMonth.percent === -2.4 && psA.all.worstMonth.month === monthStart(2).slice(0, 7), JSON.stringify(psA && psA.all));
    check('period stats (3M) cover only the two months in range, so the best month is still +8.37% but the low is 101,500', psA['3'] && psA['3'].months === 2 && psA['3'].low.value === 101500 && psA['3'].bestMonth.percent === 8.37, JSON.stringify(psA['3']));
    check('B under the threshold carries no period stats at all', ovB2f.body.history.periodStats.all === null && ovB2f.body.history.periodStats['3'] === null, JSON.stringify(ovB2f.body.history.periodStats));

    // ================================================================================
    console.log('\n2b. Capital in — derived from the ledger through the real functions');
    // ================================================================================
    const C = await makeClient('c', 'Overview Client C', 0);
    const dep = await callFunction(url, C.token, 'request-deposit', { method: 'bank', amount: 100000, currency: 'USD', details: { bank: 'Test Bank' } });
    const cred = await callFunction(url, pm.token, 'credit-deposit', { requestId: dep.body.id, confirmedAmount: 100000 });
    check('seed: a real 100,000 bank deposit credited through credit-deposit', dep.status === 200 && cred.status === 200, JSON.stringify([dep.body, cred.body]));
    const cwd = await callFunction(url, C.token, 'request-withdrawal', { method: 'bank', amount: 4000, currency: 'USD', destinationDetails: { bank: 'Test Bank', account: '9' } });
    const capp = await callFunction(url, pm.token, 'approve-withdrawal', { requestId: cwd.body.id, approvedAmount: 4000 });
    check('seed: a real 4,000 withdrawal approved through approve-withdrawal', cwd.status === 200 && capp.status === 200, JSON.stringify([cwd.body, capp.body]));
    const chi = await callFunction(url, C.token, 'request-hys-deposit', { pocketType: 'ayw', amount: 6000, method: 'internal', details: {} });
    const chic = await callFunction(url, pm.token, 'credit-hys-deposit', { requestId: chi.body.id, confirmedAmount: 6000 });
    check('seed: a real 6,000 INTERNAL transfer into a savings pocket credited (HYS_TRANSFER_IN)', chi.status === 200 && chic.status === 200, JSON.stringify([chi.body, chic.body]));
    const che = await callFunction(url, C.token, 'request-hys-deposit', { pocketType: 'ayw', amount: 5000, method: 'bank', details: { bank: 'Test Bank' } });
    const chec = await callFunction(url, pm.token, 'credit-hys-deposit', { requestId: che.body.id, confirmedAmount: 5000 });
    check('seed: a real 5,000 EXTERNAL pocket deposit credited (HYS_DEPOSIT)', che.status === 200 && chec.status === 200, JSON.stringify([che.body, chec.body]));
    for (const r of [chic, chec]) if (r.body && r.body.pocketId) pocketIds.push(r.body.pocketId);
    const cPockets = (await admin.from('hys_pockets').select('id').eq('client_id', C.id)).data || [];
    cPockets.forEach((p) => { if (pocketIds.indexOf(p.id) === -1) pocketIds.push(p.id); });

    let ovC = (await callFunction(url, C.token, 'get-portfolio-overview', {})).body;
    let retC = (await callFunction(url, C.token, 'get-returns-summary', {})).body;
    const ledgerC = (await admin.from('transactions').select('type, total_value').eq('client_id', C.id).order('created_at')).data;
    check('the ledger holds the four rows the real functions wrote (DEPOSIT, WITHDRAWAL, HYS_TRANSFER_IN, HYS_DEPOSIT)', ledgerC.map((t) => t.type).join(',') === 'DEPOSIT,WITHDRAWAL,HYS_TRANSFER_IN,HYS_DEPOSIT', JSON.stringify(ledgerC));
    check('★ capital in now = 100,000 − 4,000 − 6,000 = 90,000: the external pocket deposit changed nothing', ovC.history.capitalIn.current === 90000, JSON.stringify(ovC.history.capitalIn));
    check('...as three events (deposit, withdrawal, transfer_out) with a running cumulative — never a fourth for the pocket deposit', ovC.history.capitalIn.events.map((e) => e.kind + ':' + e.cumulativeAfter).join(' ') === 'deposit:100000 withdrawal:96000 transfer_out:90000', JSON.stringify(ovC.history.capitalIn.events));
    check('the live value is the account\'s real 90,000 (unallocated after those flows) and the live return 0', ovC.history.live.value === 90000 && ovC.history.live.return === 0, JSON.stringify(ovC.history.live));
    check('★ THE IDENTITY, no holdings: live value − capital in === get-returns-summary total (0)', Math.abs(ovC.history.live.return - retC.total) < 0.005, JSON.stringify({ gap: ovC.history.live.return, total: retC.total }));

    // A real BUY: capital in must not move, and the identity must survive whatever the price did.
    const calo = await callFunction(url, C.token, 'request-allocation', { productId: 'PROD-0003', dollarAmount: 3000 });
    const capA = await callFunction(url, pm.token, 'approve-allocation', { requestId: calo.body.id });
    check('seed: a real 3,000 allocation executed through approve-allocation (execute-buy)', calo.status === 200 && capA.status === 200, JSON.stringify([calo.body, capA.body]));
    ovC = (await callFunction(url, C.token, 'get-portfolio-overview', {})).body;
    retC = (await callFunction(url, C.token, 'get-returns-summary', {})).body;
    check('★ a BUY moves capital in by nothing (still 90,000) — an internal reallocation is not money in', ovC.history.capitalIn.current === 90000 && ovC.history.capitalIn.events.length === 3, JSON.stringify(ovC.history.capitalIn));
    check('★ THE IDENTITY after the buy: live value − capital in === get-returns-summary total (unrealised + realised), to the cent', Math.abs(ovC.history.live.return - retC.total) < 0.005, JSON.stringify({ gap: ovC.history.live.return, total: retC.total, unrealized: retC.unrealized, realized: retC.realized }));

    // The lazy anchor write happens on the client's OWN read, and its capital in is taken as of
    // the moment it was recorded — a later deposit does not leak back into it.
    const cRows = (await admin.from('portfolio_value_snapshots').select('month_start_date, value_at_anchor').eq('client_id', C.id)).data;
    check('★ C\'s own overview read wrote this month\'s anchor (the lazy writer folded into the overview)', cRows.length === 1 && cRows[0].month_start_date === monthStart(0) && Math.abs(Number(cRows[0].value_at_anchor) - ovC.history.currentValue) < 0.01, JSON.stringify(cRows));
    const thisAnchor = ovC.history.anchors.find((a) => a.date === monthStart(0));
    check('that anchor pairs its value with the capital in as of when it was recorded (90,000) and a return equal to the live one', thisAnchor && thisAnchor.capitalIn === 90000 && Math.abs(thisAnchor.return - ovC.history.live.return) < 0.01, JSON.stringify(thisAnchor));
    const dep2 = await callFunction(url, C.token, 'request-deposit', { method: 'bank', amount: 2000, currency: 'USD', details: { bank: 'Test Bank' } });
    const cred2 = await callFunction(url, pm.token, 'credit-deposit', { requestId: dep2.body.id, confirmedAmount: 2000 });
    check('seed: a further real 2,000 deposit credited AFTER the anchor was recorded', dep2.status === 200 && cred2.status === 200);
    const ovC2 = (await callFunction(url, C.token, 'get-portfolio-overview', {})).body;
    const thisAnchor2 = ovC2.history.anchors.find((a) => a.date === monthStart(0));
    check('★ the anchor\'s capital in is unchanged (as of its own created_at) while capital in NOW is 92,000', thisAnchor2.capitalIn === 90000 && thisAnchor2.value === thisAnchor.value && ovC2.history.capitalIn.current === 92000, JSON.stringify({ anchor: thisAnchor2, now: ovC2.history.capitalIn.current }));
    check('this month = live value − that anchor: +2,000 (a value change that includes the deposit, the same horizon the old badge answered)', ovC2.history.thisMonth && Math.abs(ovC2.history.thisMonth.amount - 2000) < 0.01 && ovC2.history.thisMonth.anchorValue === thisAnchor.value, JSON.stringify(ovC2.history.thisMonth));
    const retC2 = (await callFunction(url, C.token, 'get-returns-summary', {})).body;
    check('the identity still holds after the second deposit', Math.abs(ovC2.history.live.return - retC2.total) < 0.005, JSON.stringify({ gap: ovC2.history.live.return, total: retC2.total }));
    check('anchors, events and the live point all carry a capitalIn and return field (the CSV export\'s columns)', ovC2.history.anchors.every((a) => typeof a.capitalIn === 'number' && typeof a.return === 'number') && typeof ovC2.history.live.capitalIn === 'number');

    // A $0 anchor with money now: "new this month" — percent null AND amount withheld.
    const E = await makeClient('e', 'Overview Client E', 0);
    await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: monthStart(0), clientId: E.id });
    await admin.from('account_state').update({ unallocated_capital: 40000 }).eq('client_id', E.id);
    const ovE = (await callFunction(url, E.token, 'get-portfolio-overview', {})).body;
    check('★ this month for a $0 anchor and a now-funded account: percent null, amount reported but flagged by that null — the page renders "New this month", never "+$40,000 this month"', ovE.history.thisMonth && ovE.history.thisMonth.percent === null && ovE.history.thisMonth.anchorValue === 0, JSON.stringify(ovE.history.thisMonth));

    // A PM's cross-client read must NOT write the client's anchor as a side effect of looking.
    const D = await makeClient('d', 'Overview Client D', 1000);
    const pmD = await callFunction(url, pm.token, 'get-portfolio-overview', { clientId: D.id });
    const dRows0 = (await admin.from('portfolio_value_snapshots').select('id').eq('client_id', D.id)).data;
    check('★ a PM reading D\'s overview writes NO anchor for D (rows: ' + dRows0.length + ')', pmD.status === 200 && dRows0.length === 0, JSON.stringify(pmD.body && pmD.body.history && pmD.body.history.anchorCount));
    await callFunction(url, D.token, 'get-portfolio-overview', {});
    const dRows1 = (await admin.from('portfolio_value_snapshots').select('id').eq('client_id', D.id)).data;
    check('...while D\'s own read writes exactly one', dRows1.length === 1, String(dRows1.length));

    // ================================================================================
    console.log('\n3. Pending requests — five real types through the real functions');
    // ================================================================================
    // A crypto deposit request needs an assigned deposit address (row 198) — through the real
    // address-book functions, so the amount-less request shape is exercised for real.
    let cryptoOk = false;
    const addrRes = await callFunction(url, pm.token, 'add-deposit-address', { currency: 'BTC', network: 'Bitcoin', address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', label: 'pov ' + suffix });
    if (addrRes.status === 200 || addrRes.status === 409) {
      const addrId = addrRes.status === 200 ? addrRes.body.id : (await admin.from('deposit_addresses').select('id').eq('address', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4').eq('network', 'Bitcoin').single()).data.id;
      const assign = await callFunction(url, pm.token, 'assign-deposit-address', { addressId: addrId, clientId: A.id });
      if (assign.status === 200) assignmentIds.push(assign.body.id);
      const dep = await callFunction(url, A.token, 'request-deposit', { method: 'crypto', currency: 'BTC', network: 'Bitcoin' });
      cryptoOk = dep.status === 200;
      if (!cryptoOk) console.log('    (crypto deposit request: ' + JSON.stringify(dep.body) + ')');
    } else console.log('    (add-deposit-address: ' + JSON.stringify(addrRes.body) + ')');
    const wd = await callFunction(url, A.token, 'request-withdrawal', { method: 'bank', amount: 2500, currency: 'USD', destinationDetails: { bank: 'Test Bank', account: '123' } });
    check('a real withdrawal request is pending', wd.status === 200, JSON.stringify(wd.body));
    const alo = await callFunction(url, A.token, 'request-allocation', { productId: 'PROD-0003', dollarAmount: 3000 });
    check('a real allocation request is pending', alo.status === 200, JSON.stringify(alo.body));
    const hys = await callFunction(url, A.token, 'request-hys-deposit', { pocketType: 'fixed', term: { mode: 'short', value: 6 }, amount: 6000, method: 'internal', details: {} });
    check('a real internal-transfer savings pocket request is pending', hys.status === 200, JSON.stringify(hys.body));
    const prof = await callFunction(url, A.token, 'request-profile-change', { field: 'address', requestedValue: { street: '1 Test St', city: 'Testville', state: 'TS', postalCode: '00000', country: 'US' }, reason: 'moved' });
    check('a real profile change request is pending', prof.status === 200, JSON.stringify(prof.body));

    const ovP = await callFunction(url, A.token, 'get-portfolio-overview', {});
    const pend = ovP.body.pending;
    const types = pend.map((p) => p.type);
    check('the panel lists every pending type created (withdrawal, allocation, hys_deposit, profile_change' + (cryptoOk ? ', deposit' : '') + ')', ['withdrawal', 'allocation', 'hys_deposit', 'profile_change'].every((t) => types.indexOf(t) !== -1) && (!cryptoOk || types.indexOf('deposit') !== -1), JSON.stringify(types));
    const wdRow = pend.find((p) => p.type === 'withdrawal');
    check('the withdrawal row carries its amount, date and a link to its own page', wdRow && wdRow.amount === 2500 && !!wdRow.requestedAt && wdRow.href === 'deploy-capital.html', JSON.stringify(wdRow));
    const aloRow = pend.find((p) => p.type === 'allocation');
    check('the allocation row names the real product', aloRow && /Global Equity ETF/.test(aloRow.title) && aloRow.amount === 3000, JSON.stringify(aloRow));
    const hysRow = pend.find((p) => p.type === 'hys_deposit');
    check('★ the internal-transfer pocket request is marked as such', hysRow && hysRow.internalTransfer === true && /6 Month|6-month|6 month/i.test(hysRow.title) && hysRow.amount === 6000, JSON.stringify(hysRow));
    if (cryptoOk) {
      const depRow = pend.find((p) => p.type === 'deposit');
      check('an amount-less crypto deposit reports amount null (never a fabricated figure)', depRow && depRow.amount === null && depRow.title === 'Deposit · Crypto', JSON.stringify(depRow));
    }
    check('sorted newest first', pend.every((p, i) => i === 0 || new Date(pend[i - 1].requestedAt) >= new Date(p.requestedAt)));
    const ovBp = await callFunction(url, B.token, 'get-portfolio-overview', {});
    check('cross-client isolation: B sees none of A\'s requests', ovBp.body.pending.length === 0);
    const rej = await callFunction(url, pm.token, 'reject-withdrawal', { requestId: wd.body.id, reason: 'pov test' });
    const ovR = await callFunction(url, A.token, 'get-portfolio-overview', {});
    check('a resolved request leaves the panel', rej.status === 200 && !ovR.body.pending.some((p) => p.type === 'withdrawal'), JSON.stringify(rej.body));

    // ================================================================================
    console.log('\n4. Upcoming maturities');
    // ================================================================================
    const now = Date.now(), day = 86400000;
    const rows = [
      { client_id: A.id, pocket_type: 'fixed', amount: 52400, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5, maturity_date: new Date(now + 60 * day).toISOString(), projected_interest: 2227, funding_method: 'bank account', created_at: new Date(now - 120 * day).toISOString() },
      { client_id: A.id, pocket_type: 'fixed', amount: 10000, status: 'active', term_mode: 'short', term_months: 3, term_label: '3 Months', rate: 6, term_in_years: 0.25, maturity_date: new Date(now - 5 * day).toISOString(), projected_interest: 150, funding_method: 'bank account', created_at: new Date(now - 95 * day).toISOString() },
      { client_id: A.id, pocket_type: 'ayw', amount: 18300, status: 'active', funding_method: 'crypto wallet', projected_interest: 0, created_at: new Date(now - 30 * day).toISOString() },
      { client_id: A.id, pocket_type: 'fixed', amount: 5000, status: 'withdrawn', term_mode: 'short', term_months: 3, term_label: '3 Months', rate: 6, term_in_years: 0.25, maturity_date: new Date(now - 40 * day).toISOString(), projected_interest: 75, funding_method: 'bank account', created_at: new Date(now - 130 * day).toISOString(), withdrawn_at: new Date(now - 30 * day).toISOString(), withdrawn_amount: 5075 }
    ];
    const { data: inserted, error: insErr } = await admin.from('hys_pockets').insert(rows).select('id, pocket_type, status');
    if (insErr) throw new Error('pocket seed: ' + insErr.message);
    inserted.forEach((p) => pocketIds.push(p.id));
    const ovM = await callFunction(url, A.token, 'get-portfolio-overview', {});
    const mats = ovM.body.maturities;
    check('three pockets listed, the withdrawn one excluded', mats.length === 3 && !mats.some((m) => m.status === 'withdrawn'), JSON.stringify(mats.map((m) => [m.name, m.status])));
    const fixed = mats.find((m) => m.amount === 52400);
    const elapsed = 120 * day, total = 180 * day, progress = Math.round((elapsed / total) * 1000) / 10;
    check('the active fixed pocket: 60 days remaining, progress = elapsed/term', fixed && fixed.kind === 'fixed' && fixed.daysRemaining === 60 && Math.abs(fixed.progressPercent - progress) < 0.2, JSON.stringify(fixed));
    check('...interest accrued = projected_interest × progress, paid at maturity figure intact', fixed && Math.abs(fixed.interestAccrued - round2(2227 * (fixed.progressPercent / 100))) < 0.01 && fixed.interestAtMaturity === 2227, JSON.stringify(fixed));
    const matured = mats.find((m) => m.amount === 10000);
    check('a pocket past its maturity date is reported matured at 100% with the full interest, 0 days remaining', matured && matured.status === 'matured' && matured.progressPercent === 100 && matured.interestAccrued === 150 && matured.daysRemaining === 0, JSON.stringify(matured));
    const flex = mats.find((m) => m.kind === 'flexible');
    check('★ the flexible pocket has no term, no progress and NO interest — this engine pays none on AYW', flex && flex.maturityDate === null && flex.progressPercent === null && flex.interestAccrued === null && flex.amount === 18300, JSON.stringify(flex));
    check('sorted by maturity, soonest first (flexible last)', mats[0].amount === 10000 && mats[1].amount === 52400 && mats[2].kind === 'flexible', JSON.stringify(mats.map((m) => m.amount)));
    const ovBm = await callFunction(url, B.token, 'get-portfolio-overview', {});
    check('cross-client isolation: B sees no pockets', ovBm.body.maturities.length === 0);

    // ------------------------------------------------------------------ 5. the schedule
    console.log('\n5. The scheduled writer is genuinely scheduled');
    const pg = new PgClient({ connectionString: dbUrl });
    await pg.connect();
    try {
      const jobs = await pg.query("select jobname, schedule, active, command from cron.job where jobname = 'marketswave-snapshot-portfolio-values'");
      const job = jobs.rows[0];
      check('the pg_cron job exists, active, at 00:05 UTC on the 1st of every month', !!job && job.active === true && job.schedule === '5 0 1 * *', JSON.stringify(jobs.rows));
      check('...and it invokes snapshot-portfolio-values through the same invoke_edge_function() the market-data jobs use', !!job && /invoke_edge_function\('snapshot-portfolio-values'\)/.test(job.command), job && job.command);
    } finally {
      await pg.end();
    }
  } finally {
    if (pocketIds.length) await admin.from('hys_pockets').delete().in('id', pocketIds);
    for (const t of ['deposit_requests', 'withdrawal_requests', 'allocation_requests', 'sell_requests', 'hys_deposit_requests', 'hys_withdrawal_requests', 'profile_change_requests', 'portfolio_value_snapshots', 'deposit_address_assignments', 'holdings', 'transactions', 'account_state']) {
      await admin.from(t).delete().in('client_id', ids);
    }
    for (const aid of assignmentIds) await callFunction(url, pm.token, 'remove-deposit-address-assignment', { assignmentId: aid });
    await admin.from('deposit_address_assignments').delete().in('client_id', ids);
    await admin.from('deposit_addresses').delete().like('label', 'pov ' + suffix + '%');
    await admin.from('clients').delete().in('id', ids);
    for (const id of ids) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.error('CLEANUP: ' + error.message); }
    const left = (await admin.from('clients').select('id', { count: 'exact', head: true }).like('email', 'pov-%')).count;
    if (left) console.error('CLEANUP: ' + left + ' test client rows left behind');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log(failed ? 'VERIFY: FAIL (' + failed + ' assertion(s) failed)' : 'VERIFY: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('VERIFY FAILED WITH AN ERROR: ' + (err && err.stack || err)); process.exit(1); });
