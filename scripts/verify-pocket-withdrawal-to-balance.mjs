#!/usr/bin/env node
// Savings pockets return money to the available balance (2026-09-23, register row 272).
//
// A pocket withdrawal used to leave the platform entirely: the request carried a crypto
// address or bank details, account_state was never touched, and the payout was assumed to
// happen off-platform. It now credits unallocated_capital, and reaching a bank from there is a
// normal WITHDRAWAL — already real, gated and audited. This suite is the money proof for that
// reversal. verify-supabase-hys.js keeps the per-function validation coverage; what lives HERE
// is the arithmetic a client would notice, end to end through the real functions:
//
//   PART 1  The four cases, each with the available balance moving by EXACTLY the right amount:
//           As You Want (principal), a short-term fixed pocket withdrawn early (principal only,
//           interest forfeited), a matured fixed pocket (principal + earned interest), and a
//           locked pocket before maturity (still refused, nothing moves).
//   PART 2  The totals, on a client whose every figure is explained by a real ledger row:
//           Total account value identical to the cent across the move, portfolio value up by
//           exactly the amount, and the chart's capital-in line still satisfying row 208's
//           identity (the gap between the two lines IS the return) on BOTH sides of it.
//   PART 3  The ONE case where the account total legitimately does move: an early fixed
//           withdrawal, which drops it by exactly the interest that was forfeited — a real
//           loss, asserted as an exact figure rather than waved through as "about right".
//   PART 4  The full round trip the reversal exists to enable: pocket -> available balance ->
//           allocated into a real investment.
//   PART 5  ...and out again the ordinary way: available balance -> a real bank withdrawal.
//
// ★ EVERY CLIENT IN PARTS 2-5 IS FUNDED THROUGH THE REAL LEDGER PATH (request-deposit +
// credit-deposit, then request-hys-deposit + credit-hys-deposit), never a hand-seeded
// account_state row. That is not ceremony: capital-in is DERIVED from the ledger, so a seeded
// balance no row explains would make row 208's identity assert something meaningless. Part 1,
// which only measures a delta, seeds pockets directly.
//
// LOCAL STACK ONLY — same `supabase status -o json` read and localhost-only guard as every
// other local-stack script here.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';
import { createSimulatedTestProduct, deleteSimulatedTestProduct } from './lib/simulated-test-product.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PM_EMAIL = 'pm@marketswave.local';
const PM_PASSWORD = 'MarketswavePM-Local-2026!';
const PASSWORD = 'PocketReversal-2026!';

let passed = 0; const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail !== undefined ? '  [' + String(detail).slice(0, 240) + ']' : '')); }
}
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function localStack() {
  const raw = execSync('supabase status -o json', { cwd: ROOT, encoding: 'utf8' });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(j.API_URL)) throw new Error('refusing a non-local API_URL: ' + j.API_URL);
  return j;
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, session: data.session };
}

async function balanceOf(admin, clientId) {
  const { data } = await admin.from('account_state').select('unallocated_capital').eq('client_id', clientId).maybeSingle();
  return data ? Number(data.unallocated_capital) : 0;
}

async function main() {
  console.log('Savings pockets return money to the available balance — money verification\n');
  const st = localStack();
  console.log('API URL: ' + st.API_URL + '\n');
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const pm = await signIn(st.API_URL, st.ANON_KEY, PM_EMAIL, PM_PASSWORD);

  const suffix = crypto.randomBytes(4).toString('hex');
  const created = [];
  let sim = null;

  // A client funded through the REAL path, so every figure has a ledger row behind it.
  async function makeClient(label, deposit) {
    const email = 'pocketrev-' + label + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    const id = data.user.id;
    created.push(id);
    await admin.from('clients').insert({ id, name: 'Pocket Reversal ' + label + ' ' + suffix, email, account_type: 'Individual Account', status: 'active' });
    const cl = await signIn(st.API_URL, st.ANON_KEY, email, PASSWORD);
    if (deposit) {
      const { data: dep, error: depErr } = await cl.client.functions.invoke('request-deposit', { body: { method: 'bank', amount: deposit, currency: 'USD', details: { bankName: 'Test Bank' } } });
      if (depErr) throw new Error('request-deposit: ' + depErr.message);
      const { error: credErr } = await pm.client.functions.invoke('credit-deposit', { body: { requestId: dep.id, confirmedAmount: deposit } });
      if (credErr) throw new Error('credit-deposit: ' + credErr.message);
    }
    return { id, client: cl.client };
  }

  // A real internal transfer into a pocket, through both real functions.
  async function openPocketFromBalance(c, body) {
    const { data: req, error } = await c.client.functions.invoke('request-hys-deposit', { body: Object.assign({ method: 'internal' }, body) });
    if (error) throw new Error('request-hys-deposit: ' + error.message);
    const { data: pocketReq, error: credErr } = await pm.client.functions.invoke('credit-hys-deposit', { body: { requestId: req.id, confirmedAmount: body.amount } });
    if (credErr) throw new Error('credit-hys-deposit: ' + credErr.message);
    const { data: pocket } = await admin.from('hys_pockets').select('*').eq('id', pocketReq.pocketId).single();
    return pocket;
  }

  async function withdrawAndApprove(c, pocketId) {
    const { data: req, error } = await c.client.functions.invoke('request-hys-withdrawal', { body: { pocketId } });
    if (error) return { error };
    const { data: approved, error: apErr } = await pm.client.functions.invoke('approve-hys-withdrawal', { body: { requestId: req.id } });
    if (apErr) return { error: apErr, request: req };
    return { request: req, approved };
  }

  async function overview(c) {
    const { data, error } = await c.client.functions.invoke('get-portfolio-overview', { body: {} });
    if (error) throw new Error('get-portfolio-overview: ' + error.message);
    return data;
  }

  try {
    // =======================================================================================
    console.log('1. The four cases — the available balance moves by exactly what the pocket returns');
    // =======================================================================================
    const opened = new Date(Date.now() - 30 * 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 200 * 86400000).toISOString();

    const c1 = await makeClient('cases', 0);

    async function caseRun(label, pocketRow, expectedCredit) {
      const { data: pocket, error } = await admin.from('hys_pockets').insert(Object.assign({ client_id: c1.id, funding_method: 'unallocated capital', created_at: opened }, pocketRow)).select().single();
      if (error) throw new Error('seed pocket (' + label + '): ' + error.message);
      const before = await balanceOf(admin, c1.id);
      const res = await withdrawAndApprove(c1, pocket.id);
      if (expectedCredit === null) {
        check(label + ': still refused before maturity', !!res.error && res.error.context && res.error.context.status === 409, res.error && res.error.message);
        const msg = res.error && res.error.context ? await res.error.context.clone().json().then((b) => b.error).catch(() => '') : '';
        check(label + ': the refusal names the real rule, not a generic error', /before maturity/i.test(msg || ''), msg);
        check(label + ': nothing was credited', (await balanceOf(admin, c1.id)) === before, String(await balanceOf(admin, c1.id)));
        const { data: still } = await admin.from('hys_pockets').select('status').eq('id', pocket.id).single();
        check(label + ': the pocket is untouched', still.status === 'active', still.status);
        return;
      }
      check(label + ': approved', !res.error, res.error && res.error.message);
      const after = await balanceOf(admin, c1.id);
      check(label + ': the available balance moved by exactly ' + expectedCredit, r2(after - before) === expectedCredit, 'before ' + before + ' after ' + after);
      check(label + ': receive_amount recorded on the request is that same figure', Number(res.request.receiveAmount) === expectedCredit, String(res.request && res.request.receiveAmount));
      const { data: p2 } = await admin.from('hys_pockets').select('status, withdrawn_amount, withdrawal_method').eq('id', pocket.id).single();
      check(label + ': the pocket records where the money went', p2.status === 'withdrawn' && Number(p2.withdrawn_amount) === expectedCredit && p2.withdrawal_method === 'unallocated capital', JSON.stringify(p2));
      return res;
    }

    const ayw = await caseRun('As You Want ($500 principal)',
      { pocket_type: 'ayw', amount: 500, projected_interest: 0, status: 'active' }, 500);
    check('As You Want: nothing is forfeited — the flag is false', ayw.request.forfeit === false, String(ayw.request.forfeit));

    const matured = await caseRun('Matured fixed ($1,000 + $42.50 earned)',
      { pocket_type: 'fixed', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, amount: 1000, projected_interest: 42.5, status: 'matured', maturity_date: past }, 1042.5);
    check('Matured fixed: the earned interest is genuinely paid, so nothing is forfeited', matured.request.forfeit === false, String(matured.request.forfeit));

    const early = await caseRun('Short-Term fixed withdrawn early ($800 principal only)',
      { pocket_type: 'fixed', term_mode: 'short', term_months: 12, term_label: '12 Months', rate: 12, amount: 800, projected_interest: 96, status: 'active', maturity_date: future }, 800);
    check('Early fixed: forfeit is flagged, and the $96 projected interest appears in NO credit and NO ledger row', early.request.forfeit === true, String(early.request.forfeit));
    const { data: earlyTxn } = await admin.from('transactions').select('total_value').eq('id', early.approved.transactionId).single();
    check('Early fixed: the HYS_WITHDRAWAL ledger row carries the principal alone ($800), never $896', Number(earlyTxn.total_value) === 800, String(earlyTxn.total_value));

    await caseRun('Locked fixed before maturity',
      { pocket_type: 'fixed', term_mode: 'locked', term_years: 3, term_label: '3 Years', rate: 17.5, amount: 900, projected_interest: 472.5, status: 'active', maturity_date: future }, null);

    // =======================================================================================
    console.log('\n2. The totals across the move — account value unchanged, portfolio value up by the amount');
    // =======================================================================================
    const c2 = await makeClient('totals', 20000);
    const p2 = await openPocketFromBalance(c2, { pocketType: 'ayw', amount: 5000 });

    const before2 = await overview(c2);
    const beforeIdentity = r2(before2.history.live.value - before2.history.live.capitalIn);
    check('before: the transfer into the pocket is genuinely out of the portfolio (portfolio $15,000 of a $20,000 account)',
      before2.account.total === 20000 && before2.history.live.value === 15000, before2.account.total + ' / ' + before2.history.live.value);
    check('before: row 208 holds — the gap between the two chart lines is the return, which is $0 with nothing invested',
      beforeIdentity === 0, String(beforeIdentity));
    check('before: capital-in has the transfer subtracted (deposited $20,000, in-portfolio $15,000)',
      before2.history.capitalIn.current === 15000 && before2.history.accountDeposited === 20000, before2.history.capitalIn.current + ' / ' + before2.history.accountDeposited);

    const res2 = await withdrawAndApprove(c2, p2.id);
    check('the pocket withdrawal is approved', !res2.error, res2.error && res2.error.message);

    const after2 = await overview(c2);
    check('★ Total account value is identical to the cent across the move', after2.account.total === before2.account.total, before2.account.total + ' -> ' + after2.account.total);
    check('★ portfolio value is up by exactly the amount returned ($5,000)', r2(after2.history.live.value - before2.history.live.value) === 5000, before2.history.live.value + ' -> ' + after2.history.live.value);
    check('the money is in the available balance, not in a pocket any more', after2.account.unallocated === 20000 && after2.account.pockets === 0, after2.account.unallocated + ' / ' + after2.account.pockets);
    check('★ the capital-you-put-in line follows it back in — HYS_WITHDRAWAL adds, HYS_TRANSFER_IN subtracted', after2.history.capitalIn.current === 20000, String(after2.history.capitalIn.current));
    check('★ row 208 still holds after the move: value − capital in is still exactly the return ($0)', r2(after2.history.live.value - after2.history.live.capitalIn) === 0, String(r2(after2.history.live.value - after2.history.live.capitalIn)));
    check('accountDeposited is unchanged — a pocket return is not an external flow', after2.history.accountDeposited === 20000, String(after2.history.accountDeposited));
    const inflow = (after2.history.capitalIn.events || []).filter((e) => e.kind === 'transfer_in');
    check('the move renders as a capital INFLOW event, not an outflow', inflow.length === 1 && inflow[0].amount === 5000, JSON.stringify(inflow));

    // =======================================================================================
    console.log('\n3. The one legitimate exception — an early fixed withdrawal drops the account total by exactly the interest forfeited');
    // =======================================================================================
    const c3 = await makeClient('forfeit', 20000);
    const p3 = await openPocketFromBalance(c3, { pocketType: 'fixed', amount: 10000, term: { mode: 'short', value: 12 } });
    // A pocket opened a moment ago has accrued nothing, which would make the assertion below
    // vacuously true (a drop of zero against an accrual of zero). Backdate the opening so the
    // pocket has genuinely earned something to forfeit -- the same manipulate-then-measure
    // technique row 124 used for the maturity transition, and the only way to reach a real
    // accrual without waiting months. maturity_date is left where credit-hys-deposit put it.
    await admin.from('hys_pockets').update({ created_at: new Date(Date.now() - 120 * 86400000).toISOString() }).eq('id', p3.id);
    const before3 = await overview(c3);
    const m3 = (before3.maturities || []).find((m) => m.id === p3.id);
    check('the fixed pocket reports a real pro-rata accrued interest before the withdrawal', !!m3 && m3.interestAccrued > 0, JSON.stringify(m3 && { accrued: m3.interestAccrued, atMaturity: m3.interestAtMaturity }));

    const res3 = await withdrawAndApprove(c3, p3.id);
    check('the early withdrawal is approved', !res3.error, res3.error && res3.error.message);
    const after3 = await overview(c3);
    check('★ the account total drops by EXACTLY the accrued interest that was forfeited — a real loss, stated as an exact figure',
      r2(before3.account.total - after3.account.total) === r2(m3.interestAccrued), 'drop ' + r2(before3.account.total - after3.account.total) + ' vs accrued ' + m3.interestAccrued);
    check('the principal itself is fully back in the available balance', after3.account.unallocated === 20000, String(after3.account.unallocated));
    check('forfeiture is exact: the credit is the principal, never the principal plus a reduced rate', Number(res3.request.receiveAmount) === 10000, String(res3.request.receiveAmount));

    // =======================================================================================
    console.log('\n4. The round trip the reversal exists for — pocket -> available balance -> a real investment');
    // =======================================================================================
    sim = await createSimulatedTestProduct(admin, 'pkt' + suffix.slice(0, 5), { minimum_investment: 100, unit_price: 100, last_tick_date: new Date().toISOString().slice(0, 10) });
    const c4 = await makeClient('roundtrip', 6000);
    const p4 = await openPocketFromBalance(c4, { pocketType: 'ayw', amount: 6000 });
    check('every dollar is in the pocket — the available balance is genuinely $0', (await balanceOf(admin, c4.id)) === 0);

    const { error: blockedErr } = await c4.client.functions.invoke('request-allocation', { body: { productId: sim.id, dollarAmount: 4000 } });
    check('with the money in the pocket an allocation is genuinely impossible (the state this fixes)', !!blockedErr, blockedErr && blockedErr.message);

    const res4 = await withdrawAndApprove(c4, p4.id);
    check('closing the pocket is approved', !res4.error, res4.error && res4.error.message);
    check('the whole $6,000 is now spendable', (await balanceOf(admin, c4.id)) === 6000, String(await balanceOf(admin, c4.id)));

    const { data: alloc, error: allocErr } = await c4.client.functions.invoke('request-allocation', { body: { productId: sim.id, dollarAmount: 4000 } });
    check('★ the same money now funds a real allocation request', !allocErr, allocErr && allocErr.message);
    const { error: approveAllocErr } = await pm.client.functions.invoke('approve-allocation', { body: { requestId: alloc.id } });
    check('★ ...and the PM approval executes the buy', !approveAllocErr, approveAllocErr && approveAllocErr.message);
    const { data: holding } = await admin.from('holdings').select('*').eq('client_id', c4.id).eq('product_id', sim.id).maybeSingle();
    check('a real holding exists, bought with money that came out of a savings pocket', !!holding && Number(holding.cost_basis) === 4000, JSON.stringify(holding));
    check('the balance is down by exactly what was invested', (await balanceOf(admin, c4.id)) === 2000, String(await balanceOf(admin, c4.id)));

    // =======================================================================================
    console.log('\n5. ...and out to a bank the ordinary way — a normal withdrawal from the available balance');
    // =======================================================================================
    const { data: wd, error: wdErr } = await c4.client.functions.invoke('request-withdrawal', { body: { method: 'bank', amount: 2000, currency: 'USD', destinationDetails: { bankName: 'Test Bank', accountNumber: '12345678' } } });
    check('★ a real bank withdrawal can be requested against the remaining balance', !wdErr, wdErr && wdErr.message);
    const { error: apWdErr } = await pm.client.functions.invoke('approve-withdrawal', { body: { requestId: wd.id, approvedAmount: 2000 } });
    check('★ ...and the PM approval pays it out', !apWdErr, apWdErr && apWdErr.message);
    check('the balance is back to zero — the money genuinely left the platform through the one audited path', (await balanceOf(admin, c4.id)) === 0, String(await balanceOf(admin, c4.id)));
  } finally {
    await pm.client.auth.signOut({ scope: 'local' }).catch(() => {});
    // Clients first: a holding and a BUY row reference the test product, and products.id has no
    // cascade, so deleting the product first fails on a foreign key and leaks it (row 178).
    for (const id of created) {
      for (const t of ['hys_withdrawal_requests', 'hys_deposit_requests', 'hys_pockets', 'allocation_requests', 'withdrawal_requests', 'deposit_requests', 'holdings', 'transactions', 'portfolio_value_snapshots', 'account_state']) {
        await admin.from(t).delete().eq('client_id', id);
      }
      await admin.from('clients').delete().eq('id', id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.error('CLEANUP ' + id + ': ' + error.message);
    }
    if (sim) await deleteSimulatedTestProduct(admin, sim.id);
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
}

runVerifyMain(main, { watchdogMs: 600000 });
