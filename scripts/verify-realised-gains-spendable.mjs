// verify-realised-gains-spendable.mjs — the money-path proof for row 264 (2026-09-22).
//
// A sale credits its FULL proceeds to unallocated_capital; asset_returns is a reported lifetime
// tally, no longer summed into any total. This suite proves the four things that decision rests on,
// against the REAL deployed Edge Functions on the local stack:
//
//   1. CONSERVATION — Total Portfolio Value is exactly conserved through a buy/sell round trip.
//      (verify-supabase-portfolio-engine asserts this too; it is repeated here because it is the
//      property most easily broken by this change and the one that matters most.)
//   2. THE GAIN IS REACHABLE — sell at a profit, then WITHDRAW the gain through the real
//      request-withdrawal → approve-withdrawal path. Under the old split this was impossible.
//   3. THE LOSS CASE — sell at a loss and spendable capital equals what the sale ACTUALLY
//      returned, not the cost basis. Under the old split the balance overstated it.
//   4. execute-buy REFUSES an over-balance call made directly, bypassing both gates (row 264's
//      defence-in-depth check), and writes nothing when it refuses.
//
// Prices are made deterministic the way row 199 established: simulated test products, whose price
// is a pure function of id and date, so a sale's proceeds are exact and the :00/:05 market refresh
// cannot move them under the assertions (row 263).
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { runVerifyMain } from './lib/run-verify.mjs';

const raw = execSync('supabase status -o json', { cwd: '..', encoding: 'utf8' });
const ST = JSON.parse(raw.slice(raw.indexOf('{')));
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(ST.API_URL)) throw new Error('refusing a non-local API_URL: ' + ST.API_URL);
const admin = createClient(ST.API_URL, ST.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(ST.API_URL, ST.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const r2 = (n) => Math.round(n * 100) / 100;
let passed = 0, failed = 0;
function check(what, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + what); }
  else { failed++; console.log('  FAIL  ' + what + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
}
// execute-buy / execute-sell / approve-withdrawal / get-* authorise on the CALLER'S JWT via
// getClaims(); a service_role key carries no `sub` and is refused (row 112's finding). So every
// admin-side call here carries a real PM session, exactly as the admin UI's own calls do.
let PM_TOKEN = null;
async function pmToken() {
  if (!PM_TOKEN) {
    const { data, error } = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (error) throw new Error('PM sign-in: ' + error.message);
    PM_TOKEN = data.session.access_token;
  }
  return PM_TOKEN;
}
async function fn(name, body, token) {
  const bearer = token || await pmToken();
  const res = await fetch(ST.API_URL + '/functions/v1/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer, apikey: ST.ANON_KEY },
    body: JSON.stringify(body)
  });
  let json = null; try { json = await res.json(); } catch (_e) {}
  return { status: res.status, json };
}
const suffix = crypto.randomBytes(4).toString('hex');
const PASSWORD = 'RealisedGains-2026!';

async function main() {
  const made = { users: [], products: [] };
  try {
    // ── fixtures: one client, two fixed-price simulated products ──────────────────────────
    const email = 'realised-' + suffix + '@test.marketswave.local';
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (cErr) throw new Error('createUser: ' + cErr.message);
    const clientId = created.user.id; made.users.push(clientId);
    await admin.from('clients').insert({ id: clientId, name: 'Realised Gains Probe', email: 'realised-' + clientId, phone: '+1 555 0142', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 50000, allocated_capital: 0, asset_returns: 0 });
    const today = new Date().toISOString().slice(0, 10);
    const mk = async (id, price) => {
      await admin.from('products').insert({
        id, name: 'Realised Probe ' + id, asset_class: 'Stocks & ETFs', investment_type: 'Stock', risk_tier: 'balanced',
        minimum_investment: 100, unit_price: price, inception_unit_price: price, pricing_model: 'simulated', last_tick_date: today, status: 'active'
      });
      made.products.push(id);
    };
    const GAIN = 'PROD-RG1-' + suffix.slice(0, 4).toUpperCase(), LOSS = 'PROD-RG2-' + suffix.slice(0, 4).toUpperCase();
    await mk(GAIN, 100); await mk(LOSS, 100);
    const state = async () => (await admin.from('account_state').select('*').eq('client_id', clientId).maybeSingle()).data;
    const tpv = async () => (await fn('get-total-portfolio-value', { clientId })).json.totalPortfolioValue;

    // ── 1. conservation through a round trip ───────────────────────────────────────────────
    console.log('\n=== 1. Total Portfolio Value conserved through a buy/sell round trip ===\n');
    const before = await tpv();
    const buy1 = await fn('execute-buy', { clientId, productId: GAIN, dollarAmount: 10000 });
    check('execute-buy succeeds', buy1.status === 200, buy1.json);
    const afterBuy = await tpv();
    check('TPV unchanged by the buy (capital moved, not created)', Math.abs(afterBuy - before) < 0.011, { before, afterBuy });
    const h1 = (await admin.from('holdings').select('*').eq('client_id', clientId).eq('product_id', GAIN).maybeSingle()).data;
    const sell1 = await fn('execute-sell', { clientId, productId: GAIN, unitsToSell: h1.units });
    check('execute-sell succeeds', sell1.status === 200, sell1.json);
    const afterSell = await tpv();
    check('★ TPV is EXACTLY conserved through the round trip', Math.abs(afterSell - before) < 0.011, { before, afterSell });
    const s1 = await state();
    check('★ the FULL sale value landed in unallocated_capital (not the cost-basis portion)',
      Math.abs(s1.unallocated_capital - r2(50000 - 10000 + sell1.json.totalValue)) < 0.011,
      { unallocated: s1.unallocated_capital, saleValue: sell1.json.totalValue });
    check('asset_returns tallies the realised amount', Math.abs(s1.asset_returns - sell1.json.realizedReturn) < 0.011, { tally: s1.asset_returns, realized: sell1.json.realizedReturn });
    check('★ the tally is NOT double-counted: TPV = unallocated + allocated, tally excluded',
      Math.abs(afterSell - r2(s1.unallocated_capital + s1.allocated_capital)) < 0.011,
      { tpv: afterSell, unallocated: s1.unallocated_capital, allocated: s1.allocated_capital, tally: s1.asset_returns });

    // ── 2. a real gain, then withdraw it ───────────────────────────────────────────────────
    console.log('\n=== 2. Sell at a PROFIT, then withdraw the gain — it must succeed ===\n');
    await admin.from('account_state').update({ unallocated_capital: 10000, allocated_capital: 0, asset_returns: 0 }).eq('client_id', clientId);
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('transactions').delete().eq('client_id', clientId);
    await admin.from('products').update({ unit_price: 100, last_tick_date: today }).eq('id', GAIN);
    const buy2 = await fn('execute-buy', { clientId, productId: GAIN, dollarAmount: 10000 });
    check('bought $10,000 at $100/unit (100 units)', buy2.status === 200 && Math.abs(buy2.json.units - 100) < 1e-6, buy2.json);
    await admin.from('products').update({ unit_price: 130 }).eq('id', GAIN);      // +30%
    const sell2 = await fn('execute-sell', { clientId, productId: GAIN, unitsToSell: 100 });
    check('sold 100 units at $130 → $13,000 proceeds, $3,000 gain',
      sell2.status === 200 && Math.abs(sell2.json.totalValue - 13000) < 0.011 && Math.abs(sell2.json.realizedReturn - 3000) < 0.011, sell2.json);
    const s2 = await state();
    check('★ spendable capital is the FULL proceeds: $0 + $13,000', Math.abs(s2.unallocated_capital - 13000) < 0.011, s2.unallocated_capital);
    check('the tally records the $3,000 gain', Math.abs(s2.asset_returns - 3000) < 0.011, s2.asset_returns);
    // withdraw MORE than the old spendable balance would have allowed ($10,000 cost basis):
    // $12,000 is only reachable because the gain is spendable.
    const { data: session, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error('client sign-in: ' + sErr.message);
    const token = session.session.access_token;
    const wreq = await fn('request-withdrawal', { method: 'bank', amount: 12000, currency: 'USD', destinationDetails: { bank_name: 'Probe Bank', account_number: '000123' } }, token);
    check('★ a $12,000 withdrawal request is ACCEPTED — more than the $10,000 cost basis, reachable only because the gain is spendable',
      wreq.status === 200, { status: wreq.status, body: wreq.json });
    const wid = wreq.json && (wreq.json.id || (wreq.json.request && wreq.json.request.id));
    const wapp = await fn('approve-withdrawal', { requestId: wid, approvedAmount: 12000 });
    check('★ the PM approves it and the money genuinely leaves', wapp.status === 200, { status: wapp.status, body: wapp.json });
    const s2b = await state();
    check('spendable capital is $1,000 after the payout ($13,000 − $12,000)', Math.abs(s2b.unallocated_capital - 1000) < 0.011, s2b.unallocated_capital);
    check('the tally is untouched by the withdrawal — it is a record, not a balance', Math.abs(s2b.asset_returns - 3000) < 0.011, s2b.asset_returns);

    // ── 3. the loss case ───────────────────────────────────────────────────────────────────
    console.log('\n=== 3. Sell at a LOSS — spendable capital equals what the sale actually returned ===\n');
    await admin.from('account_state').update({ unallocated_capital: 10000, allocated_capital: 0, asset_returns: 0 }).eq('client_id', clientId);
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('transactions').delete().eq('client_id', clientId);
    await admin.from('products').update({ unit_price: 100, last_tick_date: today }).eq('id', LOSS);
    const buy3 = await fn('execute-buy', { clientId, productId: LOSS, dollarAmount: 10000 });
    check('bought $10,000 at $100/unit', buy3.status === 200, buy3.json);
    await admin.from('products').update({ unit_price: 60 }).eq('id', LOSS);       // −40%
    const sell3 = await fn('execute-sell', { clientId, productId: LOSS, unitsToSell: 100 });
    check('sold 100 units at $60 → $6,000 proceeds, a $4,000 loss',
      sell3.status === 200 && Math.abs(sell3.json.totalValue - 6000) < 0.011 && Math.abs(sell3.json.realizedReturn + 4000) < 0.011, sell3.json);
    const s3 = await state();
    check('★ spendable capital is $6,000 — what the sale RETURNED, not the $10,000 cost basis',
      Math.abs(s3.unallocated_capital - 6000) < 0.011, s3.unallocated_capital);
    check('the tally records the −$4,000 loss', Math.abs(s3.asset_returns + 4000) < 0.011, s3.asset_returns);
    check('★ TPV reflects the real loss: $6,000, not $10,000', Math.abs((await tpv()) - 6000) < 0.011, await tpv());
    const over = await fn('request-withdrawal', { method: 'bank', amount: 9000, currency: 'USD', destinationDetails: { bank_name: 'Probe Bank', account_number: '000123' } }, token);
    check('★ a $9,000 withdrawal is REFUSED — the client no longer appears to have money the loss took',
      over.status === 409, { status: over.status, body: over.json });

    // ── 4. execute-buy's own balance check ─────────────────────────────────────────────────
    console.log('\n=== 4. execute-buy refuses an over-balance call made directly, bypassing both gates ===\n');
    const s4before = await state();
    const hBefore = (await admin.from('holdings').select('id').eq('client_id', clientId)).data.length;
    const direct = await fn('execute-buy', { clientId, productId: LOSS, dollarAmount: 999999 });
    check('★ a direct admin call for more than the balance is REFUSED (409)', direct.status === 409, { status: direct.status, body: direct.json });
    check('the refusal names the real available figure', /exceeds current unallocated capital/i.test((direct.json && direct.json.error) || ''), direct.json);
    const s4after = await state();
    check('★ it wrote NOTHING: unallocated_capital is unchanged', Math.abs(s4after.unallocated_capital - s4before.unallocated_capital) < 1e-9, { before: s4before.unallocated_capital, after: s4after.unallocated_capital });
    check('★ ...and no holding was created', (await admin.from('holdings').select('id').eq('client_id', clientId)).data.length === hBefore);
    const exact = await fn('execute-buy', { clientId, productId: LOSS, dollarAmount: s4before.unallocated_capital });
    check('a buy for EXACTLY the balance is allowed (the check is not off by a cent)', exact.status === 200, { status: exact.status, body: exact.json });

    console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
    if (failed) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
    console.log('\nVERIFY: PASS');
  } finally {
    await admin.from('withdrawal_requests').delete().in('client_id', made.users);
    await admin.from('transactions').delete().in('client_id', made.users);
    await admin.from('holdings').delete().in('client_id', made.users);
    await admin.from('account_state').delete().in('client_id', made.users);
    for (const id of made.users) {
      await admin.from('clients').delete().eq('id', id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.error('CLEANUP: deleteUser ' + error.message);
    }
    for (const p of made.products) {
      const { error } = await admin.from('products').delete().eq('id', p);
      if (error) console.error('CLEANUP: product ' + p + ' ' + error.message);
    }
  }
}
runVerifyMain(main, { watchdogMs: 300000 });
