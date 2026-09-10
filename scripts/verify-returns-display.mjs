// verify-returns-display.mjs — Returns Display (2026-09-09).
//
// WHAT THIS PROVES, beyond "numbers appear":
//   1. Every figure get-returns-summary returns is cross-checked against the REAL
//      engine-core.js, loaded from source into a sandbox and seeded with the SAME holdings
//      and prices. Two independent implementations agreeing to the cent is the point; a test
//      that only re-derived the server's own arithmetic would prove nothing.
//   2. The trend series is GENUINE history, not a shape. It is walked FORWARD again with
//      settleProduct()'s own formula and must land back on today's real price to the cent.
//   3. A genuinely LOSING position, and a genuinely NEGATIVE total return, both render — with
//      the red tone, the U+2212 minus sign and the negative percentage. A returns display
//      that has only ever rendered green is untested.
//   4. The totals row adds up to the column above it.
//
// Contrast and narrow-viewport checks are a separate real-browser pass
// (verify-returns-display-visual.mjs) — jsdom has no layout or paint.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

const require = createRequire(import.meta.url);
const { loadEngine, createSharedStorage } = require('./lib/engine-harness');

let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail !== undefined ? '  [' + detail + ']' : '')); }
}
async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < (maxMs || 8000)) {
    if (test()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return test();
}
function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.replace(/^[^{]*/, ''));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('non-local API_URL');
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY, anonKey: status.ANON_KEY };
}
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('no script containing "' + marker + '" in ' + htmlPath);
  return target;
}
function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!m) throw new Error('no <body> in ' + htmlPath);
  return m[1].replace(/<script[\s\S]*?<\/script>/g, '');
}
const vc = new VirtualConsole();
vc.forwardTo(console);
function buildPageDom(htmlPath) {
  return new JSDOM('<!doctype html><html><body>' + extractBodyMarkup(htmlPath) + '</body></html>',
    { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const round2 = (n) => Math.round(n * 100) / 100;

// Residue sweep, run on ENTRY rather than only in the finally.
//
// The finally block below cleans up a normal run, but it cannot run if the process is KILLED
// mid-flight — which is exactly what happened during this task's own development (a suite
// runner was stopped part-way and left seven test accounts behind, cleaned up by hand). Row
// 178 already learned this for verify-products-catalog-fix: sweep by the script's own email
// SHAPE on entry, so residue from an older crashed run is collected automatically instead of
// waiting for somebody to notice it. listUsers is paged, so walk it rather than trusting
// page one.
async function sweepResidue(admin, re) {
  const ids = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error('SWEEP: listUsers failed: ' + error.message); return; }
    const users = (data && data.users) || [];
    for (const u of users) if (re.test(u.email || '')) ids.push(u.id);
    if (users.length < 200) break;
  }
  for (const id of ids) {
    await admin.from('transactions').delete().eq('client_id', id);
    await admin.from('holdings').delete().eq('client_id', id);
    await admin.from('account_state').delete().eq('client_id', id);
    await admin.from('clients').delete().eq('id', id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error('SWEEP: could not delete ' + id + ': ' + error.message);
  }
  if (ids.length) console.log('sweep: cleared ' + ids.length + ' leftover account(s) from an earlier interrupted run');
}


async function main() {
  console.log('Returns Display verification\n');
  const { url, serviceRoleKey, anonKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;

  await sweepResidue(admin, /^returns-(mixed|other|partial|fresh)-[0-9a-f]{8}@test[.]marketswave[.]local$/);
  const suffix = crypto.randomBytes(4).toString('hex');
  const made = [];
  const PASSWORD = 'ReturnsDisplay-2026!';

  async function makeClient(label) {
    const email = 'returns-' + label + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    await admin.from('clients').insert({
      id: data.user.id, name: 'Returns Display ' + label + ' ' + suffix, email,
      phone: '+1-555-0177', account_type: 'Individual Account', status: 'active'
    });
    made.push(data.user.id);
    return { id: data.user.id, email };
  }

  try {
    // Real current prices — the seed is built against these so expected figures are real.
    const { data: prods } = await admin.from('products').select('*');
    const byId = Object.fromEntries(prods.map((p) => [p.id, p]));
    const PE = byId['PROD-0001'];      // Private Equity  — carved out of the tick
    const ETF = byId['PROD-0003'];     // Stocks & ETFs   — ticks
    const CRY = byId['PROD-0004'];     // Crypto          — ticks

    // ===================================================================================
    console.log('\n=== PART 1: server figures vs. the REAL engine, on a mixed portfolio ===\n');
    // Deliberately mixed: two winners and one GENUINE loser, plus a real realised gain.
    // Cost bases are set directly so the loser is unambiguous rather than dependent on
    // whichever way the deterministic tick happened to move today.
    const A = await makeClient('mixed');
    const HOLD = [
      { product_id: PE.id,  units: 500, cost_basis: 50000 },
      { product_id: ETF.id, units: 300, cost_basis: 30000 },
      { product_id: CRY.id, units: 200, cost_basis: 30000 }   // priced ~111 -> ~22k, a real loss
    ];
    await admin.from('account_state').insert({
      client_id: A.id, unallocated_capital: 15000, allocated_capital: 0, asset_returns: 2500
    });
    for (const h of HOLD) await admin.from('holdings').insert({ client_id: A.id, ...h });
    // A real SELL, so one position has genuine realised gain and the others genuinely none.
    //
    // The units matter now, not just the gain. Closed-position capital is recovered as
    // total_value - realized_return, so a seeded row has to be one execute-sell could
    // actually have written: 10 units at ~111 is $1,113 of proceeds, and claiming a $2,500
    // gain on it would imply a NEGATIVE original cost. 100 units gives $11,137 of proceeds
    // against a $2,500 gain — a position bought around $86/unit and sold at $111, which is
    // an ordinary trade. An unrealistic seed here would not have failed loudly; it would
    // have quietly produced a nonsense denominator and made the checks below meaningless.
    const SEED_SELL_UNITS = 100;
    const seedSellProceeds = round2(SEED_SELL_UNITS * ETF.unit_price);
    await admin.from('transactions').insert({
      client_id: A.id, product_id: ETF.id, type: 'SELL', units: SEED_SELL_UNITS, price: ETF.unit_price,
      total_value: seedSellProceeds, realized_return: 2500, status: 'completed'
    });

    const anon = createClient(url, anonKey);
    await anon.auth.signInWithPassword({ email: A.email, password: PASSWORD });
    const { data: R, error: rErr } = await anon.functions.invoke('get-returns-summary');
    check('get-returns-summary returns a real payload', !rErr && !!R, rErr && rErr.message);

    // --- the cross-implementation proof -------------------------------------------------
    // Seed the REAL engine-core.js with the identical catalog + holdings, then compare.
    const storages = createSharedStorage();
    let engine = loadEngine(storages);
    storages.localStorage.setItem('marketswave_product_catalog', JSON.stringify(prods.map((p) => ({
      id: p.id, name: p.name, assetClass: p.asset_class, investmentType: p.investment_type,
      riskTier: p.risk_tier, minimumInvestment: p.minimum_investment, unitPrice: p.unit_price,
      inceptionUnitPrice: p.inception_unit_price, createdAt: p.created_at,
      // Pinned to today so the local engine's own settleProduct() is a no-op and both
      // sides compute unrealised from the SAME prices. This isolates the unrealised
      // FORMULA, which is what was ported. It also sidesteps a real divergence worth
      // knowing: engine-core.js never received row 143's Private Equity / Real Assets
      // carve-out (that was built server-side only, since no live page still calls the
      // local settleProduct()), so the local engine would happily tick a PE product the
      // server correctly holds flat. Settlement itself is already covered by
      // verify-supabase-portfolio-engine.js.
      lastTickDate: new Date().toISOString().slice(0, 10)
    }))));
    storages.localStorage.setItem('marketswave_holdings:CLIENT-0001', JSON.stringify(
      HOLD.map((h) => ({ productId: h.product_id, units: h.units, costBasis: h.cost_basis }))
    ));
    engine = loadEngine(storages);   // fresh "page load" against the seeded state

    const engTotal = engine.getTotalUnrealizedReturns();
    check('total unrealised matches the real engine to the cent',
      R.unrealized === engTotal, 'server ' + R.unrealized + ' vs engine ' + engTotal);

    let perPositionOk = true, detail = '';
    for (const p of R.positions) {
      const eAmt = engine.getUnrealizedReturn(p.productId);
      const ePct = engine.getUnrealizedReturnPercent(p.productId);
      if (p.unrealized !== eAmt || p.unrealizedPercent !== ePct) {
        perPositionOk = false;
        detail += p.productId + ': ' + p.unrealized + '/' + p.unrealizedPercent + ' vs ' + eAmt + '/' + ePct + ' ';
      }
    }
    check('every per-position unrealised amount AND percentage matches the real engine', perPositionOk, detail);

    // The engine sums ALREADY-ROUNDED per-position values; summing raw and rounding once is
    // a different number in general. Assert the server reproduced the engine's order of ops.
    const sumOfRounded = round2(R.positions.reduce((s, p) => s + p.unrealized, 0));
    check('total is the sum of the ROUNDED per-position values, matching getTotalUnrealizedReturns()',
      R.unrealized === sumOfRounded, R.unrealized + ' vs ' + sumOfRounded);

    check('realised total is account_state.asset_returns, unblended', R.realized === 2500, R.realized);
    check('total return = realised + unrealised', R.total === round2(2500 + R.unrealized), R.total);
    // Row 186's fix. The denominator is capital DEPLOYED — held cost basis plus the
    // recovered cost of everything closed — not capital STILL deployed.
    const seedClosedCapital = round2(seedSellProceeds - 2500);
    check('closed-position capital is recovered exactly from the ledger row',
      R.closedTotals.capitalAllocated === seedClosedCapital,
      R.closedTotals.capitalAllocated + ' vs ' + seedClosedCapital);
    check('capitalDeployed = held cost basis + recovered closed cost basis',
      R.capitalDeployed === round2(R.costBasis + seedClosedCapital), R.capitalDeployed);
    check('total return percentage divides by capital DEPLOYED (row 186 fixed)',
      R.totalPercent === round2((R.total / R.capitalDeployed) * 100), R.totalPercent);
    // Non-vacuous: prove the fix actually changed the number, so this cannot pass by the
    // two denominators happening to coincide.
    const oldPercent = round2((R.total / R.costBasis) * 100);
    check('the fix genuinely changes the figure — the old held-only denominator OVERSTATED it',
      oldPercent > R.totalPercent, 'old ' + oldPercent + '% vs fixed ' + R.totalPercent + '%');

    const cry = R.positions.find((p) => p.productId === CRY.id);
    check('the seeded losing position really is negative (not just assumed)', cry.unrealized < 0, cry.unrealized);
    check('the losing position has a negative percentage too', cry.unrealizedPercent < 0, cry.unrealizedPercent);
    // Realised moved out of the Return Table entirely, so it is no longer reported per
    // HELD position — it is reported per CLOSED position, which is the thing it describes.
    check('realised is reported per closed position now',
      R.closedPositions.length === 1 && R.closedPositions[0].realised === 2500,
      JSON.stringify(R.closedPositions.map((c) => c.realised)));
    check('the orphaned per-holding realised fields are genuinely gone, not just unrendered',
      R.realizedHeld === undefined && R.positions.every((p) => p.realized === undefined));

    check('best class is the genuinely best performer, excluding zero-cost-basis classes',
      R.bestClass && R.bestClass.assetClass === 'Private Equity', JSON.stringify(R.bestClass));

    // ===================================================================================
    console.log('\n=== PART 2: the trend series is REAL history, not a shape ===\n');
    // Walk the returned series FORWARD with settleProduct()'s own formula. If the series is
    // genuine it must land back on today's real price to the cent.
    function fnv1a(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function seededStandardNormal(key) {
      const r = mulberry32(fnv1a(key));
      let u = 0, v = 0;
      while (u === 0) u = r();
      while (v === 0) v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    const CFG = { conservative: { m: 0.06, v: 0.04 }, balanced: { m: 0.11, v: 0.10 }, aggressive: { m: 0.18, v: 0.28 } };
    function datesEndingToday(n) {
      const out = [];
      const c = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      c.setUTCDate(c.getUTCDate() - (n - 1));
      for (let i = 0; i < n; i++) { out.push(c.toISOString().slice(0, 10)); c.setUTCDate(c.getUTCDate() + 1); }
      return out;
    }
    const etfPos = R.positions.find((p) => p.productId === ETF.id);
    check('trend carries a real 30-point series', etfPos.trend.length === 30, etfPos.trend.length);
    const ds = datesEndingToday(30);
    const cfg = CFG[ETF.risk_tier];
    const dm = cfg.m / 365, dv = cfg.v / Math.sqrt(365);
    let walked = etfPos.trend[0];
    for (let i = 1; i < 30; i++) {
      walked = walked * Math.exp(dm - 0.5 * dv * dv + dv * seededStandardNormal(ETF.id + '|' + ds[i]));
    }
    check('walking the series FORWARD lands back on today\'s real price — genuine history, not a drawn shape',
      Math.abs(round2(walked) - ETF.unit_price) <= 0.02, round2(walked) + ' vs ' + ETF.unit_price);
    const pePos = R.positions.find((p) => p.productId === PE.id);
    check('Private Equity is honestly FLAT (carved out of the tick; moves only on a published NAV)',
      pePos.trend.every((v) => v === pePos.trend[0]), pePos.trend.slice(0, 3).join(','));

    // ===================================================================================
    console.log('\n=== PART 3: dashboard cards, real render ===\n');
    async function mountDashboard(client) {
      const dom = buildPageDom(ROOT + 'dashboard.html');
      const w = dom.window;
      w.MarketswaveData = MarketswaveData;
      w.clientScopedKey = (key) => key + ':' + client.id;
      w.Chart = function () { return { destroy() {} }; };
      w.Chart.getChart = () => null;
      // The page authenticates through the SHARED MarketswaveData client, exactly as the
      // real page does — sign that in as this client so its own calls run as them.
      const shared = await MarketswaveData.getSupabaseClient();
      await shared.auth.signInWithPassword({ email: client.email, password: PASSWORD });
      w.eval(extractInlineScript(ROOT + 'dashboard.html', 'get-returns-summary'));
      return { dom, w };
    }

    const { w: dw } = await mountDashboard(A);
    const D = dw.document;
    await pollUntil(() => (D.getElementById('total-return-amount').textContent || '').indexOf('$') !== -1, 15000);

    const amt = D.getElementById('total-return-amount').textContent.trim();
    const pct = D.getElementById('total-return-pct').textContent.trim();
    const split = D.getElementById('total-return-split');
    check('total return card shows the real total with an explicit + sign',
      amt === '+$' + Math.round(R.total).toLocaleString('en-US'), amt);
    check('percentage pill shows the real percentage', pct === '+' + R.totalPercent.toFixed(1) + '%', pct);
    check('pill carries the gain tone', D.getElementById('total-return-pct').className.indexOf('is-gain') !== -1);

    const unrealEl = D.getElementById('total-unrealized-amount');
    const realEl = D.getElementById('asset-returns-amount');
    check('context line shows the unrealised figure, colour-coded green', !!unrealEl && unrealEl.className.indexOf('ret-u') !== -1);
    check('context line shows the realised figure, colour-coded blue', !!realEl && realEl.className.indexOf('ret-r') !== -1);
    check('the realised element STILL shows realised-only ($2,500), never blended — the locked rule is untouched',
      realEl.textContent === '$2,500', realEl.textContent);
    check('the split line reads "... unrealised - ... realised"',
      /unrealised/.test(split.textContent) && /realised/.test(split.textContent), split.textContent.trim());

    const bestPct = D.getElementById('best-performing-return').textContent.trim();
    check('best performing class names the real class',
      D.getElementById('best-performing-class').textContent.trim() === 'Private Equity');
    check('best performing figure says the word "unrealised" after the percentage',
      /^\+[\d.]+%\s+unrealised$/.test(bestPct), bestPct);
    check('cards stay SHORT: no allocation breakdown, ranking or sparkline was added to them',
      D.querySelectorAll('#total-return-split svg, #best-performing-return svg').length === 0);

    // ===================================================================================
    console.log('\n=== PART 4: a genuinely NEGATIVE total return on the dashboard ===\n');
    // Deepen the crypto loss past the realised gain so the TOTAL itself goes negative.
    await admin.from('holdings').update({ cost_basis: 300000 }).eq('client_id', A.id).eq('product_id', CRY.id);
    const { data: R2 } = await anon.functions.invoke('get-returns-summary');
    check('total return is genuinely negative now', R2.total < 0, R2.total);

    const { w: dw2 } = await mountDashboard(A);
    const D2 = dw2.document;
    await pollUntil(() => (D2.getElementById('total-return-amount').textContent || '').indexOf('$') !== -1, 15000);
    const negAmt = D2.getElementById('total-return-amount').textContent.trim();
    const negPct = D2.getElementById('total-return-pct').textContent.trim();
    check('negative total renders with a real U+2212 MINUS SIGN, not a hyphen', negAmt.charAt(0) === '−', JSON.stringify(negAmt));
    check('negative total shows the correct figure', negAmt === '−$' + Math.abs(Math.round(R2.total)).toLocaleString('en-US'), negAmt);
    check('negative percentage renders with the minus sign', negPct.charAt(0) === '−', negPct);
    check('pill switches to the loss tone', D2.getElementById('total-return-pct').className.indexOf('is-loss') !== -1);
    check('the unrealised half switches to the loss colour',
      D2.getElementById('total-unrealized-amount').className.indexOf('is-loss') !== -1);
    check('the realised half stays realised-only and positive even while the total is negative',
      D2.getElementById('asset-returns-amount').textContent === '$2,500');

    // restore
    await admin.from('holdings').update({ cost_basis: 30000 }).eq('client_id', A.id).eq('product_id', CRY.id);

    // ===================================================================================
    console.log('\n=== PART 5: holdings table ===\n');
    // Mounts the REAL page script against a real jsdom document, signing the SHARED
    // MarketswaveData client in as this client first — exactly what a real page load does.
    // PART 7 and PART 8 mount it again as genuinely different clients.
    async function mountAssetPerformance(client) {
      const dom = buildPageDom(ROOT + 'asset-performance.html');
      const w = dom.window;
      w.MarketswaveData = MarketswaveData;
      w.getAuthenticatedClientId = () => client.id;
      w.clientScopedKey = (key) => key + ':' + client.id;
      const shared = await MarketswaveData.getSupabaseClient();
      await shared.auth.signInWithPassword({ email: client.email, password: PASSWORD });
      w.eval(extractInlineScript(ROOT + 'asset-performance.html', 'get-returns-summary'));
      return { dom, w };
    }
    const { w: aw } = await mountAssetPerformance(A);
    const AD = aw.document;
    // Poll for genuinely RENDERED content, not row count: renderAsyncBundle paints
    // skeleton <tr>s first, which would satisfy a bare count check instantly and leave
    // every assertion below reading the loading state. The tfoot is only ever written
    // with real data, so it is the honest signal that the render finished.
    await pollUntil(() => !!AD.querySelector('#return-table-foot tr') &&
      !/animate-pulse/.test(AD.getElementById('return-table-body').innerHTML) &&
      // The closed-positions panel is its own async region; PART 6 reads it from this same
      // render, so wait for it here rather than reading a half-painted page.
      !/animate-pulse/.test(AD.getElementById('closed-positions-region').innerHTML) &&
      AD.getElementById('closed-positions-region').innerHTML.length > 0, 20000);

    const returnTable = AD.getElementById('return-table-body').closest('table');
    const heads = [...returnTable.querySelectorAll('thead th')].map((t) => t.textContent.trim());
    check('table carries Unrealised and Trend',
      heads.includes('Unrealised') && heads.includes('Trend'), heads.join('|'));
    check('the Realised column is GONE from the Return Table — realised lives in the panel now',
      !heads.includes('Realised'), heads.join('|'));
    check('the Sell action column survived the redesign', heads.includes('Action'));
    check('the real Sell button still renders', AD.querySelectorAll('.sell-request-btn').length >= 1);

    const rows = [...AD.querySelectorAll('#return-table-body tr')];
    check('one row per real holding', rows.length === 3, rows.length);

    const cryRow = rows.find((r) => r.textContent.indexOf(CRY.name) !== -1);
    const cryUn = cryRow.querySelector('.rt-gain');
    check('the losing position renders in the LOSS tone (red)', cryUn.querySelector('.a').className.indexOf('rt-neg') !== -1,
      cryUn.querySelector('.a').className);
    check('the loss amount carries the U+2212 minus sign', cryUn.querySelector('.a').textContent.charAt(0) === '−',
      JSON.stringify(cryUn.querySelector('.a').textContent));
    check('the loss percentage is negative and signed', cryUn.querySelector('.p').textContent.charAt(0) === '−',
      cryUn.querySelector('.p').textContent);
    check('amount and percentage are STACKED in one cell', cryUn.querySelectorAll('.a').length === 1 && cryUn.querySelectorAll('.p').length === 1);

    const peRow = rows.find((r) => r.textContent.indexOf(PE.name) !== -1);
    check('a winning position renders in the GAIN tone (green)',
      peRow.querySelector('.rt-gain .a').className.indexOf('rt-pos') !== -1);
    const etfRow = rows.find((r) => r.textContent.indexOf(ETF.name) !== -1);
    // The partial-sale marker, which is what replaces the removed Realised column as the
    // link between this row and the closed-position entry for the same product.
    check('the partly-sold holding is marked as such on its name',
      !!etfRow.querySelector('.rt-partial') &&
      /partially sold/i.test(etfRow.querySelector('.rt-partial').textContent),
      etfRow.querySelector('.rt-partial') && etfRow.querySelector('.rt-partial').textContent);
    check('a holding that has never been sold carries NO partial marker',
      !peRow.querySelector('.rt-partial') && !cryRow.querySelector('.rt-partial'));
    check('the marker is a micro-label in the meta line, not a badge or a figure',
      etfRow.querySelector('.rt-partial').classList.contains('rt-meta'));

    check('every row carries a real sparkline', AD.querySelectorAll('#return-table-body svg.rt-spark').length === 3);
    const cryPts = cryRow.querySelector('svg.rt-spark polyline').getAttribute('points').split(' ');
    check('the sparkline plots the full 30-point series', cryPts.length === 30, cryPts.length);

    const foot = AD.querySelector('#return-table-foot tr');
    check('a totals row exists', !!foot);
    const footCost = foot.children[2].textContent.trim();
    const footVal = foot.children[3].textContent.trim();
    const sumCost = rows.reduce((s, r) => s + Number(r.children[2].textContent.replace(/[^0-9.]/g, '')), 0);
    check('totals row cost basis equals the sum of the column above it',
      footCost.replace(/[^0-9.]/g, '') === String(Math.round(sumCost)), footCost + ' vs ' + sumCost);
    check('totals row shows a real current value', footVal.indexOf('$') === 0, footVal);
    check('totals row carries a real unrealised total with amount and percentage',
      !!foot.querySelector('.rt-gain .a') && !!foot.querySelector('.rt-gain .p'));

    const legend = AD.getElementById('return-table-legend');
    check('a two-line legend defines both terms in plain language', !!legend && legend.children.length === 2);
    check('legend defines unrealised as gain/loss on positions still held, at today\'s price',
      /positions you still hold/i.test(legend.textContent) && /today/i.test(legend.textContent));
    check('legend defines realised as locked in when a position is sold',
      /locked in when a position is sold/i.test(legend.textContent));

    check('tfoot cells carry explicit data-labels so the mobile card layout still names them',
      [...foot.children].every((td) => td.hasAttribute('data-label')));

    // ===================================================================================
    console.log('\n=== PART 6: closed positions panel, against the real ledger ===\n');
    const closedRegion = AD.getElementById('closed-positions-region');
    const closedHeads = [...closedRegion.querySelectorAll('thead th')].map((t) => t.textContent.trim());
    check('the panel names the columns a client needs to check the arithmetic',
      closedHeads.join('|') === 'Position|Units sold|Capital Allocated|Proceeds|Realised|Closed',
      closedHeads.join('|'));
    const closedRows = [...closedRegion.querySelectorAll('tbody tr')];
    check('one entry for the one product with sell history', closedRows.length === 1, closedRows.length);
    const cRow = closedRows[0];
    check('the entry names the real position', cRow.textContent.indexOf(ETF.name) !== -1);

    // Cross-check the RENDERED figures against the LEDGER ROWS themselves, not against the
    // payload the page was handed — echoing back a number the server sent proves nothing
    // about whether that number was right.
    const { data: ledgerSells } = await admin.from('transactions')
      .select('units, total_value, realized_return')
      .eq('client_id', A.id).eq('type', 'SELL');
    const ledgerCapital = round2(ledgerSells.reduce((t, r) => t + (r.total_value - r.realized_return), 0));
    const ledgerProceeds = round2(ledgerSells.reduce((t, r) => t + r.total_value, 0));
    const ledgerRealised = round2(ledgerSells.reduce((t, r) => t + r.realized_return, 0));
    const cellNum = (el) => Number(el.textContent.replace(/[^0-9.]/g, ''));
    check('units sold matches the ledger', cellNum(cRow.children[1]) === 100, cRow.children[1].textContent);
    check('capital allocated is the RECOVERED cost from the ledger, to the dollar',
      cellNum(cRow.children[2]) === Math.round(ledgerCapital),
      cRow.children[2].textContent + ' vs ' + ledgerCapital);
    check('proceeds match the ledger', cellNum(cRow.children[3]) === Math.round(ledgerProceeds),
      cRow.children[3].textContent + ' vs ' + ledgerProceeds);
    check('realised matches the ledger',
      cellNum(cRow.children[4].querySelector('.rt-gain .a')) === Math.round(ledgerRealised),
      cRow.children[4].textContent + ' vs ' + ledgerRealised);
    check('the gain renders in the GAIN tone with amount over percentage',
      cRow.querySelector('.rt-gain .a').className.indexOf('rt-pos') !== -1 &&
      !!cRow.querySelector('.rt-gain .p'));
    check('the percentage is realised over RECOVERED capital, not over proceeds',
      cRow.querySelector('.rt-gain .p').textContent ===
        '+' + round2((ledgerRealised / ledgerCapital) * 100).toFixed(1) + '%',
      cRow.querySelector('.rt-gain .p').textContent);
    check('a real closing date is shown', /[0-9]{4}/.test(cRow.children[5].textContent),
      cRow.children[5].textContent);
    check('the entry says part of the position is still held — the other half of the cross-reference',
      !!cRow.querySelector('.rt-partial'), cRow.innerHTML.indexOf('rt-partial'));
    const cFoot = closedRegion.querySelector('tfoot tr');
    check('the panel has a totals row', !!cFoot);
    check('panel totals row carries explicit data-labels for the mobile card layout',
      [...cFoot.children].every((td) => td.hasAttribute('data-label')));
    check('panel totals equal the sum of the column above',
      cellNum(cFoot.children[2]) === Math.round(ledgerCapital), cFoot.children[2].textContent);

    const usd = (n) => Math.abs(Math.round(n)).toLocaleString('en-US');
    check('the Realised gains card shows the real closed total',
      AD.getElementById('perf-realised-amount').textContent === '+$' + usd(ledgerRealised),
      AD.getElementById('perf-realised-amount').textContent);
    check('the Realised gains card counts the closed positions it introduces',
      /Locked in across/.test(AD.getElementById('perf-realised-sub').textContent) &&
      AD.getElementById('perf-realised-sub').textContent.indexOf('1') !== -1,
      AD.getElementById('perf-realised-sub').textContent);
    check('the Unrealised card is a separate figure, never blended with realised',
      AD.getElementById('perf-unrealised-amount').textContent ===
        (R.unrealized < 0 ? '−' : '+') + '$' + usd(R.unrealized),
      AD.getElementById('perf-unrealised-amount').textContent);
    check('the three summary labels are the settled heading style, in the approved order',
      [...AD.querySelectorAll('.ret-k')].map((e) => e.textContent.trim()).join('|') ===
        'Total portfolio value|Unrealised|Realised gains',
      [...AD.querySelectorAll('.ret-k')].map((e) => e.textContent.trim()).join('|'));

    // Page order: the way IN to allocating capital should not sit below two data tables.
    const orderProbe = [...AD.querySelectorAll('a[href="asset-collection.html"], table.rt')];
    check('Browse Asset Collection comes BEFORE both tables',
      orderProbe.length >= 3 && orderProbe[0].tagName === 'A',
      orderProbe.map((e) => e.tagName).join('>'));

    // ===================================================================================
    console.log('\n=== PART 7: a REAL partial sell, and the reconstruction it depends on ===\n');
    // The hardest case for recovering a closed position's original cost, and the case the
    // partial marker exists for. Driven through the REAL execute-sell, never seeded.
    const C = await makeClient('partial');
    await admin.from('account_state').insert({
      client_id: C.id, unallocated_capital: 0, allocated_capital: 0, asset_returns: 0
    });
    await admin.from('holdings').insert({ client_id: C.id, product_id: ETF.id, units: 1000, cost_basis: 100000 });
    // Seeded ABOVE its market value, so closing it realises a genuine LOSS.
    await admin.from('holdings').insert({ client_id: C.id, product_id: CRY.id, units: 200, cost_basis: 60000 });

    const pm = createClient(url, anonKey);
    const { error: pmErr } = await pm.auth.signInWithPassword({
      email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!'
    });
    check('the local Portfolio Manager account is available to drive real sells', !pmErr, pmErr && pmErr.message);

    async function realSell(productId, units) {
      const before = (await admin.from('holdings').select('cost_basis')
        .eq('client_id', C.id).eq('product_id', productId).maybeSingle()).data;
      const { data: txn, error } = await pm.functions.invoke('execute-sell', {
        body: { clientId: C.id, productId: productId, unitsToSell: units }
      });
      if (error) throw new Error('execute-sell failed: ' + error.message);
      const after = (await admin.from('holdings').select('cost_basis')
        .eq('client_id', C.id).eq('product_id', productId).maybeSingle()).data;
      return {
        txn,
        trueCost: round2(before.cost_basis - (after ? after.cost_basis : 0)),
        recovered: round2(txn.totalValue - txn.realizedReturn)
      };
    }

    const s1 = await realSell(ETF.id, 250);
    const s2 = await realSell(ETF.id, 300);
    check('partial sell 1: recovered cost equals the holding cost-basis delta exactly',
      s1.recovered === s1.trueCost, s1.recovered + ' vs ' + s1.trueCost);
    check('partial sell 2: recovered cost equals the holding cost-basis delta exactly',
      s2.recovered === s2.trueCost, s2.recovered + ' vs ' + s2.trueCost);
    const lossSell = await realSell(CRY.id, 200);
    check('the losing sale really did realise a loss (not merely assumed)',
      lossSell.txn.realizedReturn < 0, lossSell.txn.realizedReturn);

    const anonC = createClient(url, anonKey);
    await anonC.auth.signInWithPassword({ email: C.email, password: PASSWORD });
    const { data: RC } = await anonC.functions.invoke('get-returns-summary');
    const etfClosed = RC.closedPositions.find((c) => c.productId === ETF.id);
    const cryClosed = RC.closedPositions.find((c) => c.productId === CRY.id);
    check('two partial sells aggregate into ONE closed entry, not two',
      RC.closedPositions.filter((c) => c.productId === ETF.id).length === 1);
    check('aggregated units sold is the real total', etfClosed.unitsSold === 550, etfClosed.unitsSold);
    check('aggregated recovered capital equals the sum of both sells',
      etfClosed.capitalAllocated === round2(s1.recovered + s2.recovered), etfClosed.capitalAllocated);
    check('the partly-sold position is flagged as still held', etfClosed.stillHeld === true);
    check('the fully-sold position is NOT flagged as still held', cryClosed.stillHeld === false);
    check('the still-held half is marked partiallySold for the Return Table',
      RC.positions.find((p) => p.productId === ETF.id).partiallySold === true);
    check('a fully-sold position has left the Return Table entirely',
      !RC.positions.find((p) => p.productId === CRY.id));

    // Close the rest, and confirm the recovered total is the position's ORIGINAL cost basis.
    await realSell(ETF.id, 450);
    const { data: RC2 } = await anonC.functions.invoke('get-returns-summary');
    const etfClosed2 = RC2.closedPositions.find((c) => c.productId === ETF.id);
    check('across a full partial-sell chain the recovered capital is the ORIGINAL cost basis',
      etfClosed2.capitalAllocated === 100000, etfClosed2.capitalAllocated);
    check('once fully sold it is no longer flagged as still held', etfClosed2.stillHeld === false);
    check('the net across a winning and a losing close is genuinely negative',
      RC2.closedTotals.realised < 0, RC2.closedTotals.realised);

    const { w: cw } = await mountAssetPerformance(C);
    const CD = cw.document;
    await pollUntil(() => {
      const r = CD.getElementById('closed-positions-region');
      return r && r.innerHTML.indexOf('tfoot') !== -1 && !/animate-pulse/.test(r.innerHTML);
    }, 20000);
    const cRegion = CD.getElementById('closed-positions-region');
    const lossRow = [...cRegion.querySelectorAll('tbody tr')].find((r) => r.textContent.indexOf(CRY.name) !== -1);
    check('the losing close renders in the LOSS tone',
      lossRow.querySelector('.rt-gain .a').className.indexOf('rt-neg') !== -1);
    check('the loss carries a real U+2212 MINUS SIGN, not a hyphen',
      lossRow.querySelector('.rt-gain .a').textContent.charAt(0) === '−',
      JSON.stringify(lossRow.querySelector('.rt-gain .a').textContent));
    check('the loss percentage is negative and signed',
      lossRow.querySelector('.rt-gain .p').textContent.charAt(0) === '−',
      lossRow.querySelector('.rt-gain .p').textContent);
    const negFoot = cRegion.querySelector('tfoot .rt-gain');
    check('a NEGATIVE totals row renders in the loss tone with a minus sign',
      negFoot.querySelector('.a').className.indexOf('rt-neg') !== -1 &&
      negFoot.querySelector('.a').textContent.charAt(0) === '−',
      negFoot.querySelector('.a').textContent);
    check('the Realised gains CARD goes negative too, not just the table',
      CD.getElementById('perf-realised-amount').textContent.charAt(0) === '−' &&
      CD.getElementById('perf-realised-amount').className.indexOf('is-loss') !== -1,
      CD.getElementById('perf-realised-amount').textContent);

    // ===================================================================================
    console.log('\n=== PART 8: the empty state, which is what MOST clients see ===\n');
    const F = await makeClient('fresh');
    await admin.from('account_state').insert({
      client_id: F.id, unallocated_capital: 25000, allocated_capital: 0, asset_returns: 0
    });
    const { w: fw } = await mountAssetPerformance(F);
    const FD = fw.document;
    await pollUntil(() => {
      const r = FD.getElementById('closed-positions-region');
      return r && r.innerHTML.length > 0 && !/animate-pulse/.test(r.innerHTML);
    }, 20000);
    const fRegion = FD.getElementById('closed-positions-region');
    check('a client who has never sold sees no table at all, not an empty one',
      !fRegion.querySelector('table'), fRegion.innerHTML.slice(0, 60));
    const emptyCopy = fRegion.textContent.replace(/[ ]+/g, ' ').trim();
    check('the empty state says exactly what the client needs to hear',
      /sold any positions yet/.test(emptyCopy) &&
      /Gains stay unrealised until a position is sold/.test(emptyCopy), emptyCopy);
    check('the empty state is real copy at a real reading size, not a greyed placeholder',
      !!fRegion.querySelector('.rt-empty-copy'));
    await pollUntil(() => (FD.getElementById('perf-realised-amount').textContent || '').indexOf('$') !== -1, 15000);
    check('the Realised gains card reads a plain $0, with no misleading + sign',
      FD.getElementById('perf-realised-amount').textContent === '$0',
      FD.getElementById('perf-realised-amount').textContent);
    check('the zero card is painted neither as a gain nor as a loss',
      FD.getElementById('perf-realised-amount').className.trim() === 'ret-v',
      FD.getElementById('perf-realised-amount').className);
    check('its sub-line explains the zero rather than reading "across 0 closed positions"',
      FD.getElementById('perf-realised-sub').textContent.trim() === 'No positions sold yet',
      FD.getElementById('perf-realised-sub').textContent);
    check('the Return Table is honestly empty too',
      /No current holdings/.test(FD.getElementById('return-table-body').textContent));

    // ===================================================================================
    console.log('\n=== PART 9: authorization ===\n');
    const noAuth = await fetch(url + '/functions/v1/get-returns-summary', { method: 'POST' });
    check('unauthenticated call is refused (401)', noAuth.status === 401, noAuth.status);
    const B = await makeClient('other');
    const anonB = createClient(url, anonKey);
    await anonB.auth.signInWithPassword({ email: B.email, password: PASSWORD });
    const { error: crossErr } = await anonB.functions.invoke('get-returns-summary', { body: { clientId: A.id } });
    check('a non-admin cannot read another client\'s returns (403)', !!crossErr, crossErr && crossErr.message);

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log(fail ? 'RETURNS DISPLAY: FAIL' : 'RETURNS DISPLAY: PASS');
    // runVerifyMain() exits 0 on any normal resolve, so a returned code would be
    // silently discarded and a failing run would report success. Exit explicitly.
    if (fail) process.exit(1);
  } finally {
    for (const id of made) {
      await admin.from('transactions').delete().eq('client_id', id);
      await admin.from('holdings').delete().eq('client_id', id);
      await admin.from('account_state').delete().eq('client_id', id);
      await admin.from('clients').delete().eq('id', id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.error('CLEANUP: could not delete ' + id + ': ' + error.message);
    }
    const { count } = await admin.from('clients')
      .select('id', { count: 'exact', head: true })
      .like('email', 'returns-%@test.marketswave.local');
    if (count) console.error('CLEANUP: ' + count + ' test client rows still present');
    else if (made.length) console.log('cleanup: removed ' + made.length + ' test account(s), none remaining');
  }
}

runVerifyMain(main);
