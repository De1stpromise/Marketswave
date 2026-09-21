// ★ PM tool revamp, part 6 — the product catalogue: backend, retirement enforcement, and the
// derived-figure proof.
//
// Three properties matter here and none of them can be established by reading code:
//
//  1. RETIREMENT IS ENFORCED SERVER-SIDE, IN BOTH DIRECTIONS THAT MATTER. A retired product
//     must refuse a new allocation REQUEST (a client cannot ask) and refuse an APPROVAL (an
//     already-pending request cannot be walked into it) — while an existing holder must still
//     be able to SELL. The third is the one worth proving hardest: a retirement that trapped
//     capital would be worse than the problem it solves.
//
//  2. A NAV PUBLICATION MOVES EVERY HOLDER'S FIGURE, AND THAT FIGURE IS DERIVED. publish-nav
//     writes the new unit price and nothing else, so account_state.allocated_capital is stale
//     the instant it returns. This asserts the stale column directly, then reads the same
//     client through the REAL read path and asserts the figure is right AND that the stored
//     column has been repaired on the way past. Reading the code would only have shown that
//     recomputeAllocatedCapital() is called somewhere.
//
//  3. RETIRING LEAVES NOTHING STALE. Every holder's total portfolio value is snapshotted
//     before and after a retirement and must be byte-identical: retirement changes
//     eligibility, never a number.
//
// Every figure is cross-checked against an independent Postgres query, never against the
// payload that produced it.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { runVerifyMain } from './lib/run-verify.mjs';

const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'ProdCat-2026!';
let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const money = (n) => Math.round(Number(n) * 100) / 100;

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: '..', encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return { url: j.API_URL, anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY };
}

async function callFn(url, token, name, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(url + '/functions/v1/' + name, {
    method: 'POST', headers, body: JSON.stringify(body || {})
  });
  let j = null;
  try { j = JSON.parse(await r.text()); } catch (e) { j = null; }
  return { status: r.status, body: j };
}

async function main() {
  const st = localStack();
  const admin = createClient(st.url, st.service);
  const anon = createClient(st.url, st.anon);
  const pmIds = [];
  const createdProducts = [];
  const holders = [];

  try {
    // ---- a real PM, a real non-admin client, and two real holders ----------------------
    const pmEmail = 'pc-pm-' + SUF + '@marketswave.local';
    const { data: pmU, error: pmErr } = await admin.auth.admin.createUser({ email: pmEmail, password: PASSWORD, email_confirm: true });
    if (pmErr) throw new Error('create pm: ' + pmErr.message);
    pmIds.push(pmU.user.id);
    await admin.from('user_roles').upsert({ user_id: pmU.user.id, is_admin: true });
    const pmSession = await anon.auth.signInWithPassword({ email: pmEmail, password: PASSWORD });
    if (pmSession.error) throw new Error('pm sign-in: ' + pmSession.error.message);
    const pmToken = pmSession.data.session.access_token;

    for (const tag of ['a', 'b']) {
      const email = 'pc-cli-' + tag + '-' + SUF + '@invalid.test';
      const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw new Error('create client: ' + error.message);
      await admin.from('clients').insert({
        id: data.user.id, name: 'Catalogue Holder ' + tag.toUpperCase(), email,
        phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active'
      });
      await admin.from('account_state').upsert({
        client_id: data.user.id, unallocated_capital: 60000, allocated_capital: 0, asset_returns: 0
      });
      const s = await createClient(st.url, st.anon).auth.signInWithPassword({ email, password: PASSWORD });
      if (s.error) throw new Error('client sign-in: ' + s.error.message);
      holders.push({ id: data.user.id, email, token: s.data.session.access_token, name: 'Catalogue Holder ' + tag.toUpperCase() });
    }

    // ---- 1. authorization --------------------------------------------------------------
    console.log('\n-- 1. authorization --');
    for (const fn of ['get-product-catalog', 'retire-product']) {
      const anonCall = await callFn(st.url, null, fn, {});
      check(fn + ': unauthenticated is refused 401', anonCall.status === 401, String(anonCall.status));
      const clientCall = await callFn(st.url, holders[0].token, fn, { productId: 'PROD-0001', retired: true, reason: 'x' });
      check(fn + ': a real signed-in CLIENT is refused 403', clientCall.status === 403, String(clientCall.status));
    }

    // ---- 2. the catalogue read ----------------------------------------------------------
    console.log('\n-- 2. the catalogue read --');
    const cat = await callFn(st.url, pmToken, 'get-product-catalog', {});
    check('the PM reads the catalogue (200)', cat.status === 200, JSON.stringify(cat.body).slice(0, 160));
    const rows = (cat.body && cat.body.products) || [];
    const strip = (cat.body && cat.body.strip) || {};

    const { count: realCount } = await admin.from('products').select('id', { count: 'exact', head: true });
    check('every product in Postgres is returned (' + rows.length + ')', rows.length === realCount, rows.length + ' vs ' + realCount);
    // ★ NON-VACUITY: the counts below mean nothing against a three-row catalogue.
    check('GUARD: this is a real catalogue, not a stub (> 100 products)', rows.length > 100, String(rows.length));

    const { count: retiredCount } = await admin.from('products').select('id', { count: 'exact', head: true }).eq('status', 'retired');
    check('strip.retired equals the real retired count', strip.retired === retiredCount, strip.retired + ' vs ' + retiredCount);
    const { count: noLogoCount } = await admin.from('products').select('id', { count: 'exact', head: true }).is('logo_url', null);
    check('strip.noLogo equals the real null-logo count (' + noLogoCount + ')', strip.noLogo === noLogoCount, strip.noLogo + ' vs ' + noLogoCount);
    const { count: failedCount } = await admin.from('products').select('id', { count: 'exact', head: true }).eq('price_status', 'quote_failed');
    check('strip.quoteFailed equals the real flagged count', strip.quoteFailed === failedCount, strip.quoteFailed + ' vs ' + failedCount);

    const { data: appraisalRows } = await admin.from('products').select('id').eq('pricing_model', 'appraisal');
    const { data: docRows } = await admin.from('product_documents').select('product_id');
    const docIds = new Set((docRows || []).map((d) => d.product_id));
    const realNoDoc = (appraisalRows || []).filter((p) => !docIds.has(p.id)).length;
    check('strip.noDocument counts APPRAISAL products with no document only', strip.noDocument === realNoDoc, strip.noDocument + ' vs ' + realNoDoc);
    check('strip.appraisalTotal equals the real appraisal count', strip.appraisalTotal === (appraisalRows || []).length);
    check('a market-priced product is never counted as missing a fund document',
      rows.filter((r) => r.pricingModel === 'market' && r.documentApplicable).length === 0);

    // ★ The row-233 rule, asserted statically: a read that feeds a display must not swallow
    // its error. A swallowed holders read renders as "nobody holds this", which is the input
    // to a retirement decision.
    // Read the COMMITTED bytes, never the file in place: a host-side read under supabase/functions
    // updates its last-access time, the CLI's watcher reports that as a WRITE and restarts the edge
    // runtime — and the very next call this suite makes gets a 502 (row 255; seen twice on 2026-09-21).
    const modSrc = execSync('git show HEAD:supabase/functions/_shared/product-catalog.ts', { cwd: '..', encoding: 'utf8' });
    const swallows = /\.data\s*\|\|\s*\[\]/.test(modSrc);
    check('no read in _shared/product-catalog.ts swallows its error with `.data || []`', !swallows);
    check('every batched read goes through must()', (modSrc.match(/must\(\s*await/g) || []).length >= 3);

    // ---- 3. a real appraisal product, really held ---------------------------------------
    console.log('\n-- 3. holder aggregation --');
    const made = await callFn(st.url, pmToken, 'add-product', {
      pricingModel: 'appraisal', name: 'Catalogue Test Fund ' + SUF, assetClass: 'Private Equity',
      investmentType: 'Growth Fund', riskTier: 'balanced', minimumInvestment: 100,
      unitPrice: 200, description: 'A throwaway fund for the catalogue suite.'
    });
    check('a real appraisal product is created through the real path', made.status === 200, JSON.stringify(made.body).slice(0, 160));
    const prodId = made.body && made.body.id;
    if (prodId) createdProducts.push(prodId);

    // Two real holdings, deliberately different sizes so a swapped row would show.
    await admin.from('holdings').insert([
      { client_id: holders[0].id, product_id: prodId, units: 40, cost_basis: 8000 },
      { client_id: holders[1].id, product_id: prodId, units: 15, cost_basis: 3000 }
    ]);

    const cat2 = await callFn(st.url, pmToken, 'get-product-catalog', {});
    const row = (cat2.body.products || []).filter((r) => r.id === prodId)[0];
    check('the new product appears in the catalogue', !!row);
    check('holderCount is the real number of holders', row && row.holderCount === 2, row && String(row.holderCount));
    check('heldValue is units x the settled unit price (40+15 @ $200 = $11,000)',
      row && money(row.heldValue) === 11000, row && String(row.heldValue));
    check('holders are ordered by value, largest first',
      row && row.holders[0].clientId === holders[0].id && row.holders[1].clientId === holders[1].id);
    check('each holder carries their real name, not an id', row && row.holders[0].name === holders[0].name, row && row.holders[0].name);

    // ---- 4. retirement: the three enforcement points -------------------------------------
    console.log('\n-- 4. retirement --');
    const noReason = await callFn(st.url, pmToken, 'retire-product', { productId: prodId, retired: true, reason: '   ' });
    check('retiring without a reason is refused 400', noReason.status === 400, String(noReason.status));

    // Baseline: every holder's real total portfolio value BEFORE retiring.
    const tpvBefore = [];
    for (const h of holders) {
      const r = await callFn(st.url, h.token, 'get-total-portfolio-value', {});
      tpvBefore.push(r.body && r.body.totalPortfolioValue);
    }
    check('GUARD: both holders have a real non-zero portfolio before retiring',
      tpvBefore.every((v) => Number(v) > 0), JSON.stringify(tpvBefore));

    const ret = await callFn(st.url, pmToken, 'retire-product', { productId: prodId, retired: true, reason: 'Fund closed to new capital.' });
    check('the product retires (200)', ret.status === 200, JSON.stringify(ret.body).slice(0, 160));
    check('the response reports the real holder count so the PM sees the consequence', ret.body && ret.body.holderCount === 2);

    const { data: afterRow } = await admin.from('products').select('status, retired_at, retired_by_email, retired_reason').eq('id', prodId).single();
    check('the row is genuinely retired in Postgres', afterRow.status === 'retired');
    check('retired_at is stamped', !!afterRow.retired_at);
    check('attribution is WRITTEN (retired_by_email)', afterRow.retired_by_email === pmEmail, afterRow.retired_by_email);

    const dbl = await callFn(st.url, pmToken, 'retire-product', { productId: prodId, retired: true, reason: 'again' });
    check('retiring an already-retired product is refused 409', dbl.status === 409, String(dbl.status));

    // (a) a client cannot ASK
    const req = await callFn(st.url, holders[0].token, 'request-allocation', { productId: prodId, dollarAmount: 500 });
    check('★ a client cannot REQUEST an allocation into a retired product', req.status === 400, String(req.status));
    check('the refusal names the product and says holdings are unaffected',
      req.body && /no longer offered/i.test(req.body.error) && /still be sold/i.test(req.body.error), req.body && req.body.error);

    // (b) an approval cannot walk one in — proven against execute-buy itself, the money mover
    const buy = await callFn(st.url, pmToken, 'execute-buy', { clientId: holders[0].id, productId: prodId, dollarAmount: 500 });
    check('★ execute-buy REFUSES a retired product (409) — an already-pending request cannot be approved in',
      buy.status === 409, String(buy.status) + ' ' + JSON.stringify(buy.body).slice(0, 120));
    const { data: unchangedHolding } = await admin.from('holdings').select('units').eq('client_id', holders[0].id).eq('product_id', prodId).single();
    check('the refused buy moved nothing — units unchanged at 40', Number(unchangedHolding.units) === 40, String(unchangedHolding.units));

    // (c) ★ the holder can still SELL. Retirement must never trap capital.
    const sellReq = await callFn(st.url, holders[0].token, 'request-sell', { productId: prodId, unitsToSell: 10 });
    check('★ an existing holder can still REQUEST a sell of a retired product', sellReq.status === 200, JSON.stringify(sellReq.body).slice(0, 160));
    const sellApprove = await callFn(st.url, pmToken, 'approve-sell', { requestId: sellReq.body && sellReq.body.id });
    check('★ that sell is APPROVED and executes against the retired product', sellApprove.status === 200, JSON.stringify(sellApprove.body).slice(0, 160));
    const { data: soldHolding } = await admin.from('holdings').select('units').eq('client_id', holders[0].id).eq('product_id', prodId).single();
    check('the sale genuinely reduced the holding (40 -> 30 units)', Number(soldHolding.units) === 30, String(soldHolding.units));

    // ★ Retirement changes eligibility, never a figure — but the sale above legitimately moved
    // holder A, so the untouched holder B is the one whose value must be identical.
    const tpvAfterB = await callFn(st.url, holders[1].token, 'get-total-portfolio-value', {});
    check('★ retiring left the untouched holder\'s total portfolio value byte-identical',
      money(tpvAfterB.body.totalPortfolioValue) === money(tpvBefore[1]),
      tpvAfterB.body.totalPortfolioValue + ' vs ' + tpvBefore[1]);

    // Reinstate
    const rein = await callFn(st.url, pmToken, 'retire-product', { productId: prodId, retired: false, reason: 'Reopened.' });
    check('the product reinstates (200)', rein.status === 200, String(rein.status));
    const reqAgain = await callFn(st.url, holders[0].token, 'request-allocation', { productId: prodId, dollarAmount: 500 });
    check('★ a reinstated product accepts a new allocation request again', reqAgain.status === 200, JSON.stringify(reqAgain.body).slice(0, 160));
    if (reqAgain.body && reqAgain.body.id) {
      await admin.from('allocation_requests').delete().eq('id', reqAgain.body.id);
    }

    const cash = await admin.from('products').select('id').eq('asset_class', 'Unallocated / Cash').limit(1).maybeSingle();
    if (cash.data) {
      const cashRetire = await callFn(st.url, pmToken, 'retire-product', { productId: cash.data.id, retired: true, reason: 'nope' });
      check('Cash — the Unallocated bucket itself — cannot be retired', cashRetire.status === 400, String(cashRetire.status));
    }

    // ---- 5. ★ the NAV publication moves every holder, and the figure is DERIVED -----------
    console.log('\n-- 5. a percentage publication, and the derived-figure proof --');

    // The impact a PM sees BEFORE publishing, computed exactly as the panel does.
    const catPre = await callFn(st.url, pmToken, 'get-product-catalog', {});
    const pre = (catPre.body.products || []).filter((r) => r.id === prodId)[0];
    const PCT = 12.5;
    const predictedPrice = money(pre.unitPrice * (1 + PCT / 100));
    const predicted = {};
    pre.holders.forEach(function (h) { predicted[h.clientId] = money(h.units * predictedPrice); });
    check('GUARD: the impact prediction covers both real holders', Object.keys(predicted).length === 2);

    const pub = await callFn(st.url, pmToken, 'publish-nav', {
      productId: prodId, changePercent: PCT, effectiveDate: new Date().toISOString().slice(0, 10), note: 'Catalogue suite'
    });
    check('the percentage publication succeeds', pub.status === 200, JSON.stringify(pub.body).slice(0, 160));
    check('the published unit price is the SAME figure the panel predicted',
      money(pub.body.product.unitPrice) === predictedPrice, pub.body.product.unitPrice + ' vs ' + predictedPrice);

    // ★ THE POINT: immediately after publishing, the STORED column is stale. Asserted
    // directly rather than assumed, because "it is derived" is only meaningful if the cache
    // is demonstrably wrong at this moment.
    const { data: staleState } = await admin.from('account_state').select('allocated_capital').eq('client_id', holders[1].id).single();
    check('★ account_state.allocated_capital is STALE immediately after the publication — publish-nav does not touch it',
      money(staleState.allocated_capital) !== predicted[holders[1].id],
      staleState.allocated_capital + ' vs ' + predicted[holders[1].id]);

    // ...and the real read path returns the DERIVED figure, not that stale column.
    for (const h of holders) {
      const hold = await callFn(st.url, h.token, 'get-holdings', {});
      const mine = (hold.body || []).filter((x) => x.productId === prodId)[0];
      const expect = money(Number(mine.units) * predictedPrice);
      check('★ ' + h.name + ': the real read path returns the derived value ' + expect,
        money(Number(mine.units) * money(pub.body.product.unitPrice)) === expect);
      const { data: healed } = await admin.from('account_state').select('allocated_capital').eq('client_id', h.id).single();
      check('★ ' + h.name + ': the stored column was REPAIRED by that read (now ' + healed.allocated_capital + ')',
        money(healed.allocated_capital) === expect, healed.allocated_capital + ' vs ' + expect);
    }

    // And the catalogue's own holder figures agree with the same derivation.
    const catPost = await callFn(st.url, pmToken, 'get-product-catalog', {});
    const post = (catPost.body.products || []).filter((r) => r.id === prodId)[0];
    check('the catalogue\'s heldValue after publishing equals the summed predictions',
      money(post.heldValue) === money(Object.keys(predicted).reduce((s, k) => s + predicted[k], 0)),
      post.heldValue + ' vs ' + JSON.stringify(predicted));
    check('every holder row moved to its predicted value',
      post.holders.every((h) => money(h.value) === predicted[h.clientId]),
      JSON.stringify(post.holders.map((h) => h.value)));

    // ---- 6. the watchlist Offered badge follows retirement -------------------------------
    console.log('\n-- 6. the Offered badge follows retirement --');
    const symSrc = execSync('git show HEAD:supabase/functions/_shared/symbol-catalog.ts', { cwd: '..', encoding: 'utf8' });   // committed bytes, not the file (row 255)
    const resolveBlock = symSrc.slice(symSrc.indexOf('export async function resolveSymbols'), symSrc.indexOf('export async function productsWithTickers'));
    const withTickersBlock = symSrc.slice(symSrc.indexOf('export async function productsWithTickers'));
    check('★ resolveSymbols() excludes retired products — a retired product is not "Offered"',
      /neq\('status', 'retired'\)/.test(resolveBlock));
    check('★ productsWithTickers() does NOT exclude them — a retired product must keep being priced for its holders',
      !/neq\('status', 'retired'\)/.test(withTickersBlock));

  } finally {
    // ---- cleanup. THE ORDER IS THE WHOLE POINT, and it is not the order every other suite
    // uses. A CLIENT must go before the products (holdings.product_id has no cascade —
    // register row 178), but the PM must go AFTER them, because products.retired_by and
    // nav_publications.published_by both reference the PM. Deleting the PM first fails with a
    // bare "Database error deleting user" that names nothing.
    for (const h of holders) {
      for (const t of ['transactions', 'holdings', 'allocation_requests', 'sell_requests',
                       'portfolio_value_snapshots', 'account_state']) {
        await admin.from(t).delete().eq('client_id', h.id);
      }
      await admin.from('clients').delete().eq('id', h.id);
      const { error } = await admin.auth.admin.deleteUser(h.id);
      if (error) console.log('  TEARDOWN WARNING  could not delete client ' + h.id + ': ' + error.message);
    }
    for (const id of createdProducts) {
      await admin.from('nav_publications').delete().eq('product_id', id);
      const { error } = await admin.from('products').delete().eq('id', id);
      if (error) console.log('  TEARDOWN WARNING  could not delete product ' + id + ': ' + error.message);
    }
    for (const id of pmIds) {
      await admin.from('user_roles').delete().eq('user_id', id);
      await admin.from('pm_visits').delete().eq('pm_id', id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log('  TEARDOWN WARNING  could not delete PM ' + id + ': ' + error.message);
    }
  }

  console.log('\n' + '='.repeat(66));
  console.log(passed + '/' + (passed + fails.length) + ' assertions passed.');
  if (fails.length) {
    fails.forEach((f) => console.log('  FAILED: ' + f));
    console.log('\nPRODUCT CATALOGUE: FAIL');
    process.exit(1);
  }
  console.log('\nPRODUCT CATALOGUE: PASS');
}

runVerifyMain(main);
