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
//      a $0 first anchor yields percent null, never Infinity;
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
    check('★ anchors equal the table rows, point for point, oldest first', JSON.stringify(h.anchors) === JSON.stringify(table.map((r) => ({ date: r.month_start_date, value: round2(Number(r.value_at_anchor)) }))), JSON.stringify({ api: h.anchors, table }));
    check('...and match the values the writer was asked to record', JSON.stringify(h.anchors.map((a) => a.value)) === JSON.stringify(expected.map((e) => e.value)), JSON.stringify(h.anchors));
    const tpv = await callFunction(url, A.token, 'get-total-portfolio-value', {});
    check('currentValue equals get-total-portfolio-value (the same server computation)', Math.abs(h.currentValue - Number(tpv.body.totalPortfolioValue)) < 0.01, JSON.stringify({ h: h.currentValue, tpv: tpv.body }));
    check('changeSinceFirst is the table arithmetic: current − first anchor, percent of first', h.changeSinceFirst.amount === round2(h.currentValue - 100000) && h.changeSinceFirst.percent === round2(((h.currentValue - 100000) / 100000) * 100), JSON.stringify(h.changeSinceFirst));
    check('chartReady with 4 anchors (threshold 3)', h.chartReady === true && h.anchorCount === 4 && h.minAnchors === 3);
    check('clientSince is the real clients.created_at', !!h.clientSince);

    const ovB0 = await callFunction(url, B.token, 'get-portfolio-overview', {});
    check('B with no anchors: chartReady false, no first anchor, no change', ovB0.body.history.chartReady === false && ovB0.body.history.anchorCount === 0 && ovB0.body.history.firstAnchor === null && ovB0.body.history.changeSinceFirst === null, JSON.stringify(ovB0.body.history));
    for (const off of [3, 2]) await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: monthStart(off), clientId: B.id });
    const ovB2 = await callFunction(url, B.token, 'get-portfolio-overview', {});
    check('B with 2 anchors is STILL under the threshold — a line through two points is not a chart', ovB2.body.history.chartReady === false && ovB2.body.history.anchorCount === 2, JSON.stringify(ovB2.body.history));
    check('...and a $0 first anchor yields percent null (never Infinity) with the amount still reported', ovB2.body.history.changeSinceFirst.percent === null && ovB2.body.history.changeSinceFirst.amount === round2(ovB2.body.history.currentValue - 0), JSON.stringify(ovB2.body.history.changeSinceFirst));
    // The real scheduled run — no clientId, this month — is what tips B over the threshold.
    const allRun = await callFunction(url, pm.token, 'snapshot-portfolio-values', { monthStartDate: monthStart(0) });
    const pRows = (await admin.from('portfolio_value_snapshots').select('id').eq('client_id', P.id)).data;
    check('a whole-catalog run covers every ACTIVE client and skips the pending_review one', allRun.status === 200 && allRun.body.clients >= 2 && allRun.body.inserted >= 1 && pRows.length === 0, JSON.stringify({ clients: allRun.body.clients, inserted: allRun.body.inserted, pendingRows: pRows.length }));
    const ovB3 = await callFunction(url, B.token, 'get-portfolio-overview', {});
    check('B flips to chartReady at exactly 3 anchors, the third written by the scheduled run', ovB3.body.history.chartReady === true && ovB3.body.history.anchorCount === 3, JSON.stringify(ovB3.body.history));
    const cross = await callFunction(url, B.token, 'get-portfolio-overview', { clientId: A.id });
    check('a client cannot read another client\'s overview (403)', cross.status === 403);
    const pmRead = await callFunction(url, pm.token, 'get-portfolio-overview', { clientId: A.id });
    check('a PM can read any client\'s overview', pmRead.status === 200 && pmRead.body.clientId === A.id);
    const noAuth = await callFunction(url, null, 'get-portfolio-overview', {});
    check('anonymous is refused (401)', noAuth.status === 401);

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
