#!/usr/bin/env node
// Asset & Performance overview (2026-09-19, register row 250): the Total account value card,
// the Capital and Returns cards, the By-asset-class table, the reworked holdings table and
// the page order — every figure cross-checked against ITS SOURCE, never merely rendered.
//
//   PART 1  THE THREE TOTALS ARE THREE DISTINCT, CORRECT VALUES — asserted as such, never
//           reconciled — and related by the one identity that makes them defensible:
//             Total account value = deployed + unallocated + pockets(+accrued) + realised
//                                 = Portfolio value (get-total-portfolio-value) + pockets
//             Total deployed      = holdings only (get-returns-summary.currentValue)
//           Each is recomputed here from the tables/functions, not read off the page.
//   PART 2  Gary (8 holdings, 7 up / 1 down, 3 closed, two pockets): every card and every
//           class row against get-returns-summary / get-account-state / get-portfolio-overview
//           and an INDEPENDENT ledger sum for "deposited" (external flows only).
//   PART 3  The reworked holdings table: no Trend column, Sell on every row, part-sold kept.
//   PART 4  Page order — the mockup's sequence, read from the DOM.
//   PART 5  A client with NO holdings: every empty state, all four classes "not held".
//   PART 6  A client with ONE asset class: one held row at 100% share, three dimmed.
//
// The real page script runs verbatim in jsdom (the established harness); the browser half —
// contrast with the sheen composited, real phone profiles — is verify-returns-display-visual,
// whose profiles now carry every new surface (the dimmed rows especially).
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';
import { findFixtureClient } from './lib/fixture-client.mjs';
import { createSimulatedTestProduct, deleteSimulatedTestProduct } from './lib/simulated-test-product.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)) ;
let passed = 0; const fails = [];
function check(label, cond, detail) { if (cond) { passed++; console.log('  PASS  ' + label); } else { fails.push(label); console.log('  FAIL  ' + label + (detail !== undefined ? '  [' + String(detail).slice(0, 220) + ']' : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(test, maxMs) { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if (await test()) return true; await sleep(150); } return test(); }
const r2 = (n) => Math.round(n * 100) / 100;
const usd2 = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (n) => '$' + Math.round(n).toLocaleString('en-US');
function localStack() {
  const raw = execSync('supabase status -o json', { cwd: ROOT, encoding: 'utf8' });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(j.API_URL)) throw new Error('refusing a non-local API_URL');
  return j;
}
function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const t = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!t) throw new Error('no script containing ' + marker);
  return t;
}
function buildPageDom(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  return new JSDOM('<!doctype html><html><body>' + body + '</body></html>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
}
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const SUF = crypto.randomBytes(3).toString('hex');
  const PASSWORD = 'ApOverview-2026!';
  const created = [];
  let simA = null, simB = null;

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  const shared = await MarketswaveData.getSupabaseClient();
  const callAs = async (token, fn, body) => {
    const r = await fetch(st.API_URL + '/functions/v1/' + fn, { method: 'POST', headers: { apikey: st.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return r.json();
  };

  async function mount(client, password) {
    const dom = buildPageDom(ROOT + 'asset-performance.html');
    const w = dom.window;
    w.MarketswaveData = MarketswaveData;
    w.getAuthenticatedClientId = () => client.id;
    w.clientScopedKey = (k) => k + ':' + client.id;
    await shared.auth.signOut({ scope: 'local' }).catch(() => {});
    const { data: si, error } = await shared.auth.signInWithPassword({ email: client.email, password });
    if (error) throw new Error('sign-in ' + client.email + ': ' + error.message);
    // Warm the three functions the page calls BEFORE the render budget starts: as the first
    // suite of a pass after a `_shared` edit, every importer compiles on its first invocation
    // and three cold compiles in parallel blew a 30 s budget (the row-197 warm-up finding).
    const tok = si.session.access_token;
    await Promise.all([callAs(tok, 'get-returns-summary'), callAs(tok, 'get-account-state'), callAs(tok, 'get-portfolio-overview', { recordVisit: false })]);
    w.eval(readFileSync(ROOT + 'format-helpers.js', 'utf8'));
    w.eval(readFileSync(ROOT + 'asset-mark.js', 'utf8'));
    w.eval(extractInlineScript(ROOT + 'asset-performance.html', 'get-returns-summary'));
    const D = w.document;
    const ok = await pollUntil(() => !!D.querySelector('#return-table-foot tr, .rt-empty-copy') && !/animate-pulse/.test(D.getElementById('ap-total-amount').innerHTML) && !/animate-pulse/.test(D.getElementById('ap-by-class-region').innerHTML) && D.querySelectorAll('#ap-by-class-region tbody tr').length > 0, 90000);
    if (!ok) {
      const state = { total: txt(D.getElementById('ap-total-amount')).slice(0, 60), byClass: txt(D.getElementById('ap-by-class-region')).slice(0, 120), foot: !!D.querySelector('#return-table-foot tr'), empty: !!D.querySelector('.rt-empty-copy'), errorCards: [...D.querySelectorAll('button')].filter((b) => /try again/i.test(b.textContent)).length };
      throw new Error('page never rendered for ' + client.email + ' — ' + JSON.stringify(state));
    }
    return { D, token: tok };
  }

  // Independent "deposited": external flows only, straight from the ledger.
  async function depositedFromLedger(clientId) {
    const { data } = await admin.from('transactions').select('type,total_value').eq('client_id', clientId).in('type', ['DEPOSIT', 'HYS_DEPOSIT', 'WITHDRAWAL', 'HYS_WITHDRAWAL']);
    return r2((data || []).reduce((s, t) => s + (/WITHDRAWAL/.test(t.type) ? -1 : 1) * Number(t.total_value), 0));
  }

  try {
    // =========================================================================================
    console.log('\n=== PART 1 + 2: Gary — three distinct totals, every figure against its source ===\n');
    const gary = await findFixtureClient(admin); // never an address literal in a suite (row 256)
    if (!gary) throw new Error('Gary is not seeded — run: node seed-client-gary.mjs');
    const garyPw = (process.env.GARY_SEED_PASSWORD || readFileSync(ROOT + 'supabase/functions/.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('GARY_SEED_PASSWORD=')).slice(19).trim().replace(/^["']|["']$/g, ''));
    const { D, token } = await mount(gary, garyPw);

    const [ret, acct, tpvFn, ov] = await Promise.all([
      callAs(token, 'get-returns-summary'), callAs(token, 'get-account-state'), callAs(token, 'get-total-portfolio-value'), callAs(token, 'get-portfolio-overview', { recordVisit: false })
    ]);
    const pockets = (ov.maturities || []).filter((p) => p.status !== 'withdrawn');
    const pocketsValue = r2(pockets.reduce((s, p) => s + p.amount + (p.interestAccrued || 0), 0));
    const deployed = ret.currentValue, unalloc = acct.unallocatedCapital, realised = acct.assetReturns;
    const accountValue = r2(deployed + unalloc + pocketsValue + realised);
    const portfolioValue = tpvFn.totalPortfolioValue;
    const deposited = await depositedFromLedger(gary.id);

    check('GUARD: Gary genuinely has holdings, pockets and realised gains (the case that exercises everything)', ret.positions.length >= 2 && pockets.length >= 1 && realised !== 0, JSON.stringify({ p: ret.positions.length, pk: pockets.length, realised }));
    check('★ THREE DISTINCT TOTALS: account value, portfolio value and total deployed are three different numbers', new Set([accountValue, portfolioValue, deployed]).size === 3, [accountValue, portfolioValue, deployed].join(' / '));
    check('★ the identity holds to the cent: Total account value = Portfolio value + savings pockets', r2(portfolioValue + pocketsValue) === accountValue, r2(portfolioValue + pocketsValue) + ' vs ' + accountValue);
    check('★ Portfolio value = unallocated + allocated + realised (get-total-portfolio-value agrees)', r2(unalloc + acct.allocatedCapital + realised) === portfolioValue, portfolioValue);
    check('★ Total deployed = holdings only = Σ positions current value', r2(ret.positions.reduce((s, p) => s + p.currentValue, 0)) === deployed, deployed);
    check('★ allocated_capital sums the SAME per-position rounded values (the rounding-order finding, row 250: it used to round the raw sum and disagreed by a cent)', deployed === acct.allocatedCapital, deployed + ' vs ' + acct.allocatedCapital);
    {
      // Whether the two rounding orders differ for Gary depends on LIVE prices (they did by a
      // cent on 2026-09-19 morning and coincided by the afternoon), so this is reported, not
      // asserted — the deterministic control is in PART 6, on fixed-price simulated products.
      const { data: gh } = await admin.from('holdings').select('units, products(unit_price)').eq('client_id', gary.id);
      const rawOrder = r2(gh.reduce((s, h) => s + h.units * h.products.unit_price, 0));
      const perPosOrder = r2(gh.reduce((s, h) => s + r2(h.units * h.products.unit_price), 0));
      console.log('  info  Gary at today’s prices: round2(Σ raw) = ' + rawOrder + ', Σ round2(position) = ' + perPosOrder + (rawOrder === perPosOrder ? ' (coincide today)' : ' (differ today)'));
    }
    check('the account total EXCEEDS the portfolio value by exactly the pockets — never below it (the reason realised is included)', accountValue > portfolioValue && r2(accountValue - portfolioValue) === pocketsValue);

    check('the Total account value card shows exactly that figure', txt(D.getElementById('ap-total-amount')) === usd2(accountValue), txt(D.getElementById('ap-total-amount')) + ' vs ' + usd2(accountValue));
    const since = txt(D.getElementById('ap-total-since'));
    check('★ "deposited" is the ACCOUNT-scoped ledger sum (external flows only), not capitalIn', since.indexOf(usd2(deposited) + ' deposited') !== -1 && ov.history.accountDeposited === deposited, since);
    check('  ...and it differs from capitalIn.current by the pocket transfers (the plausible wrong number this card must not use)', deposited !== ov.history.capitalIn.current, deposited + ' vs ' + ov.history.capitalIn.current);
    const growth = r2(accountValue - deposited);
    check('growth since joining = account value − deposited, signed', since.indexOf((growth < 0 ? '−' : '+') + usd0(Math.abs(growth)).replace('$', '$')) !== -1 || since.indexOf(usd2(Math.abs(growth))) !== -1, since);
    check('the card says realised gains are included, held separately and not redeployable, and names the identity', /Includes realised gains/.test(since) && /not redeployable/.test(since) && /portfolio value plus your savings pockets/.test(since));
    const parts = [...D.querySelectorAll('#ap-total-parts .ap-tp')].map((p) => ({ label: txt(p.querySelector('b')), sub: txt(p.querySelector('.ap-tpb span')), value: txt(p.querySelector('.ap-tpv')) }));
    check('four parts in order: deployed, unallocated, pockets, realised', parts.map((p) => p.label).join('|') === 'Deployed in assets|Unallocated|Savings pockets|Realised gains', parts.map((p) => p.label).join('|'));
    check('part values are the source figures', parts[0].value === usd2(deployed) && parts[1].value === usd2(unalloc) && parts[2].value === usd2(pocketsValue) && parts[3].value === usd2(realised), parts.map((p) => p.value).join(' '));
    check('the parts sum to the total (the bar is a partition)', r2(deployed + unalloc + pocketsValue + realised) === accountValue);
    check('the deployed part names the real holding count', parts[0].sub.indexOf(ret.positions.length + ' holdings') === 0, parts[0].sub);
    check('the pockets part names the real pocket count and says interest accrued is included', parts[2].sub.indexOf(pockets.length + ' pockets') === 0 && /including interest accrued/.test(parts[2].sub), parts[2].sub);
    check('the realised part is labelled "Held separately, not redeployable"', parts[3].sub === 'Held separately, not redeployable', parts[3].sub);
    const barW = [...D.querySelectorAll('#ap-total-bar i')].map((i) => parseFloat(i.style.width));
    check('the proportional bar sums to 100%', Math.abs(barW.reduce((a, b) => a + b, 0) - 100) < 0.1, barW.join('+'));

    // Capital cards
    const heldClasses = ret.byClass.filter((c) => c.currentValue > 0);
    check('Deployed card: the deployed figure and "N holdings across M asset classes"', txt(D.getElementById('ap-cap-deployed-amount')) === usd0(deployed) && txt(D.getElementById('ap-cap-deployed-sub')) === ret.positions.length + ' holdings across ' + heldClasses.length + ' asset classes', txt(D.getElementById('ap-cap-deployed-sub')));
    const splitW = [...D.querySelectorAll('#ap-cap-deployed-split i')].map((i) => parseFloat(i.style.width));
    check('the class split bar has one segment per held class summing to 100%', splitW.length === heldClasses.length && Math.abs(splitW.reduce((a, b) => a + b, 0) - 100) < 0.1, splitW.join('+'));
    check('the split legend names the held classes in the donut palette', [...D.querySelectorAll('#ap-cap-deployed-legend span')].map(txt).sort().join('|') === heldClasses.map((c) => c.assetClass).sort().join('|'));
    const { data: prods } = await admin.from('products').select('minimum_investment, asset_class').neq('asset_class', 'Unallocated / Cash').gt('minimum_investment', 0);
    const lowest = Math.min(...prods.map((p) => Number(p.minimum_investment)));
    check('Unallocated card: the figure, "earning nothing", and the REAL lowest minimum in the collection', txt(D.getElementById('ap-cap-unallocated-amount')) === usd0(unalloc) && /earning nothing/.test(txt(D.getElementById('ap-cap-unallocated-sub'))) && txt(D.getElementById('ap-cap-unallocated-sub')).indexOf(usd0(lowest)) !== -1, txt(D.getElementById('ap-cap-unallocated-sub')));
    check('Unallocated card carries NO action button', !D.querySelector('#ap-cap-unallocated .mw-btn, #ap-cap-unallocated a'));
    const fixed = pockets.filter((p) => p.kind === 'fixed');
    const next = fixed.filter((p) => p.maturityDate && p.status !== 'matured').sort((a, b) => (a.maturityDate < b.maturityDate ? -1 : 1))[0];
    const pkSub = txt(D.getElementById('ap-cap-pockets-sub'));
    check('Pockets card: principal + accrued, the fixed count, the rate and the next maturity from get-portfolio-overview', txt(D.getElementById('ap-cap-pockets-amount')) === usd0(pocketsValue) && pkSub.indexOf(fixed.length + ' fixed pocket') === 0 && (!next || (pkSub.indexOf((Math.round(next.rate * 1000) / 10) + '%') !== -1 && /next matures/.test(pkSub))), pkSub);
    const matured = fixed.filter((p) => p.status === 'matured').length;
    check('  ...and a matured pocket is counted rather than hidden', matured === 0 || pkSub.indexOf(matured + ' matured') !== -1, pkSub);
    check('Pockets card has a View pockets action to the savings page', D.getElementById('ap-cap-pockets-link') && D.getElementById('ap-cap-pockets-link').getAttribute('href') === 'high-yield-savings.html');

    // Returns cards
    const up = ret.positions.filter((p) => p.unrealized > 0).length, down = ret.positions.filter((p) => p.unrealized < 0).length;
    check('GUARD: Gary has both a winner and a loser', up > 0 && down > 0, up + '/' + down);
    check('Unrealised card: the source figure, "on N open holdings", the held-only percentage', txt(D.getElementById('perf-unrealised-amount')) === (ret.unrealized < 0 ? '−' : '+') + usd0(Math.abs(ret.unrealized)) && txt(D.getElementById('perf-unrealised-sub')).indexOf('On ' + ret.positions.length + ' open holdings') === 0 && txt(D.getElementById('perf-unrealised-sub')).indexOf(usd0(ret.costBasis) + ' of capital allocated') !== -1, txt(D.getElementById('perf-unrealised-sub')));
    const udLegend = [...D.querySelectorAll('#ap-ret-updown-legend span')].map(txt);
    check('★ the up/down split is the real count: ' + up + ' up, ' + down + ' down', udLegend.join('|') === up + ' up|' + down + ' down', udLegend.join('|'));
    const udW = [...D.querySelectorAll('#ap-ret-updown i')].map((i) => parseFloat(i.style.width));
    check('the up/down bar is proportional to the counts', udW.length === 2 && Math.abs(udW[0] - (up / ret.positions.length) * 100) < 0.1 && Math.abs(udW[1] - (down / ret.positions.length) * 100) < 0.1, udW.join('/'));
    check('Realised card: the closed total, "Banked from N closed positions", with a See closed positions action', txt(D.getElementById('perf-realised-amount')) === '+' + usd0(ret.closedTotals.realised) && txt(D.getElementById('perf-realised-sub')).indexOf('Banked from ' + ret.closedTotals.count + ' closed positions') === 0 && D.getElementById('ap-ret-closed-link').getAttribute('href') === '#closed-positions' && !!D.getElementById('closed-positions'), txt(D.getElementById('perf-realised-sub')));
    check('the realised card equals account_state.asset_returns (the same money the total card includes)', ret.closedTotals.realised === realised);

    // By asset class
    const rows = [...D.querySelectorAll('#ap-by-class-region tbody tr')];
    check('By asset class: all four classes render, held and not', rows.length === 4 && rows.map((r) => r.dataset.class).join('|') === 'Stocks & ETFs|Crypto|Private Equity|Real Assets', rows.map((r) => r.dataset.class).join('|'));
    check('the meta line says how many of the four are held', txt(D.getElementById('ap-by-class-meta')) === heldClasses.length + ' of 4 classes held', txt(D.getElementById('ap-by-class-meta')));
    let shareSum = 0;
    for (const c of ret.byClass) {
      const row = rows.find((r) => r.dataset.class === c.assetClass);
      const cells = [...row.querySelectorAll('td')].map(txt);
      const n = ret.positions.filter((p) => p.assetClass === c.assetClass).length;
      const share = (c.currentValue / deployed) * 100;
      shareSum += share;
      check('  ' + c.assetClass + ': holdings ' + n + ', cost ' + usd0(c.costBasis) + ', value ' + usd0(c.currentValue) + ', unrealised, share ' + share.toFixed(1) + '% — all from byClass', !row.classList.contains('is-unheld') && cells[1] === String(n) && cells[2] === usd0(c.costBasis) && cells[3] === usd0(c.currentValue) && cells[4].indexOf(usd0(Math.abs(c.unrealized))) !== -1 && cells[5].indexOf(share.toFixed(1) + '%') === 0, cells.join(' | '));
    }
    check('the held shares sum to 100%', Math.abs(shareSum - 100) < 0.05, shareSum);
    const unheld = rows.filter((r) => r.classList.contains('is-unheld'));
    check('★ the unheld classes render DIMMED with "not held" and dashes, not omitted', unheld.length === 4 - heldClasses.length && unheld.every((r) => /not held/.test(txt(r)) && [...r.querySelectorAll('td')].slice(1).every((td) => txt(td) === '—')), unheld.map(txt).join(' | '));
    check('the dimmed rows dim by colour class, never by opacity on the row', unheld.every((r) => !r.getAttribute('style')));
    const foot = [...D.querySelectorAll('#ap-by-class-region tfoot td')].map(txt);
    check('the totals row reads "Total deployed" = holdings count, held cost basis, deployed value, 100%', foot[0] === 'Total deployed' && foot[1] === String(ret.positions.length) && foot[2] === usd0(ret.costBasis) && foot[3] === usd0(deployed) && foot[5] === '100%', foot.join(' | '));
    check('the class palette is the donut\'s (Stocks #4B2E83, Crypto #8B7CB5, PE #E08B14, Real Assets #F5C377)', rows.map((r) => r.querySelector('.ap-dot').style.background.toLowerCase()).join('|') === 'rgb(75, 46, 131)|rgb(139, 124, 181)|rgb(224, 139, 20)|rgb(245, 195, 119)', rows.map((r) => r.querySelector('.ap-dot').style.background).join('|'));

    // =========================================================================================
    console.log('\n=== PART 3: the reworked holdings table ===\n');
    const heads = [...D.querySelectorAll('#return-table-body').length ? D.getElementById('return-table-body').closest('table').querySelectorAll('thead th') : []].map(txt);
    check('columns are Holding · Units · Capital Allocated · Current value · Unrealised · Action — no Trend', heads.join('|') === 'Holding|Units|Capital Allocated|Current value|Unrealised|Action', heads.join('|'));
    check('no sparkline anywhere', D.querySelectorAll('svg.rt-spark').length === 0);
    const hrows = [...D.querySelectorAll('#return-table-body tr')];
    check('one row per position', hrows.length === ret.positions.length, hrows.length);
    check('★ Sell is on EVERY row and enabled (no minimum-remainder rule exists server-side)', hrows.every((r) => r.querySelector('.sell-request-btn') && !r.querySelector('.sell-request-btn').disabled), hrows.filter((r) => !r.querySelector('.sell-request-btn') || r.querySelector('.sell-request-btn').disabled).length + ' rows without an enabled Sell');
    check('the part-sold marker is preserved on the partially-sold positions', hrows.filter((r) => r.querySelector('.rt-partial')).length === ret.positions.filter((p) => p.partiallySold).length && ret.positions.some((p) => p.partiallySold));
    check('the totals row still carries cost, value and unrealised (6 cells now)', D.querySelectorAll('#return-table-foot td').length === 6);

    // =========================================================================================
    console.log('\n=== PART 4: page order ===\n');
    const order = [...D.querySelectorAll('#ap-total, #ap-capital, #ap-returns, a[href="asset-collection.html"], #return-table-body, #closed-positions, #ap-by-class, #my-requests-list')].map((e) => e.id || 'browse');
    check('★ order is total · capital · returns · browse · holdings · closed positions · by asset class · request history', order.join('|') === 'ap-total|ap-capital|ap-returns|browse|return-table-body|closed-positions|ap-by-class|my-requests-list', order.join('|'));

    // =========================================================================================
    console.log('\n=== PART 5: a client with NO holdings — every empty state ===\n');
    const E = await admin.auth.admin.createUser({ email: 'ap-empty-' + SUF + '@test.marketswave.local', password: PASSWORD, email_confirm: true });
    created.push(E.data.user.id);
    await admin.from('clients').insert({ id: E.data.user.id, name: 'AP Empty', email: E.data.user.email, phone: '+1', account_type: 'Individual Account', status: 'active' });
    const { D: ED } = await mount({ id: E.data.user.id, email: E.data.user.email }, PASSWORD);
    check('total account value is $0.00', txt(ED.getElementById('ap-total-amount')) === '$0.00', txt(ED.getElementById('ap-total-amount')));
    check('"Nothing deposited yet" replaces the growth line', /Nothing deposited yet/.test(txt(ED.getElementById('ap-total-since'))));
    check('the bar is empty (no fabricated partition of zero)', ED.querySelectorAll('#ap-total-bar i').length === 0);
    check('four parts still listed, all $0.00', [...ED.querySelectorAll('#ap-total-parts .ap-tpv')].map(txt).join('|') === '$0.00|$0.00|$0.00|$0.00');
    check('Deployed card: $0, "0 holdings across 0 asset classes", legend says "Nothing deployed yet"', txt(ED.getElementById('ap-cap-deployed-amount')) === '$0' && /0 holdings across 0 asset classes/.test(txt(ED.getElementById('ap-cap-deployed-sub'))) && /Nothing deployed yet/.test(txt(ED.getElementById('ap-cap-deployed-legend'))));
    check('Pockets card: "No savings pockets open"', /No savings pockets open/.test(txt(ED.getElementById('ap-cap-pockets-sub'))));
    check('Unrealised card: "On 0 open holdings", legend "No open holdings"', /On 0 open holdings/.test(txt(ED.getElementById('perf-unrealised-sub'))) && /No open holdings/.test(txt(ED.getElementById('ap-ret-updown-legend'))));
    check('Realised card: $0 with "No positions sold yet"', txt(ED.getElementById('perf-realised-amount')) === '$0' && /No positions sold yet/.test(txt(ED.getElementById('perf-realised-sub'))));
    const erows = [...ED.querySelectorAll('#ap-by-class-region tbody tr')];
    check('By asset class: all four rows "not held", meta "0 of 4 classes held", totals row dashes/0', erows.length === 4 && erows.every((r) => r.classList.contains('is-unheld')) && txt(ED.getElementById('ap-by-class-meta')) === '0 of 4 classes held' && [...ED.querySelectorAll('#ap-by-class-region tfoot td')].map(txt).join('|') === 'Total deployed|0|$0|$0|—|—', [...ED.querySelectorAll('#ap-by-class-region tfoot td')].map(txt).join('|'));
    check('the holdings table shows its honest empty copy', !!ED.querySelector('.rt-empty-copy'));

    // =========================================================================================
    console.log('\n=== PART 6: a client with ONE asset class ===\n');
    const O = await admin.auth.admin.createUser({ email: 'ap-oneclass-' + SUF + '@test.marketswave.local', password: PASSWORD, email_confirm: true });
    created.push(O.data.user.id);
    await admin.from('clients').insert({ id: O.data.user.id, name: 'AP One Class', email: O.data.user.email, phone: '+1', account_type: 'Individual Account', status: 'active' });
    // Two FIXED-price simulated products (last_tick_date = today, so nothing moves them and no
    // market refresh touches them), filed under Crypto so this stays a one-class client. Units
    // are chosen so each position is worth exactly 100.004: per-position rounding gives
    // 100.00 + 100.00 = 200.00, rounding the raw sum gives round2(200.008) = 200.01 — the
    // deterministic control that the rounding-order fix is exercised, not merely present.
    simA = await createSimulatedTestProduct(admin, 'AP' + SUF + 'A', { asset_class: 'Crypto', investment_type: 'Digital Asset', name: 'AP Sim Coin A ' + SUF });
    simB = await createSimulatedTestProduct(admin, 'AP' + SUF + 'B', { asset_class: 'Crypto', investment_type: 'Digital Asset', name: 'AP Sim Coin B ' + SUF });
    const crypto2 = [simA, simB];
    await admin.from('account_state').upsert({ client_id: O.data.user.id, unallocated_capital: 250, allocated_capital: 0, asset_returns: 0 });
    await admin.from('holdings').insert(crypto2.map((p) => ({ client_id: O.data.user.id, product_id: p.id, units: 100.004 / p.unit_price, cost_basis: 80 })));
    const { D: OD, token: otok } = await mount({ id: O.data.user.id, email: O.data.user.email }, PASSWORD);
    const oret = await callAs(otok, 'get-returns-summary');
    const orows = [...OD.querySelectorAll('#ap-by-class-region tbody tr')];
    const held = orows.filter((r) => !r.classList.contains('is-unheld'));
    check('exactly one held row (Crypto) at 100% share, three dimmed', held.length === 1 && held[0].dataset.class === 'Crypto' && /^100\.0%/.test(txt(held[0].querySelectorAll('td')[5])) && orows.filter((r) => r.classList.contains('is-unheld')).length === 3, held.map((r) => txt(r)).join(' | '));
    check('the held row\'s figures are byClass\'s', txt(held[0].querySelectorAll('td')[3]) === usd0(oret.byClass[0].currentValue) && txt(held[0].querySelectorAll('td')[1]) === '2');
    check('Deployed card reads "2 holdings across 1 asset class" with a single-segment split', /2 holdings across 1 asset class$/.test(txt(OD.getElementById('ap-cap-deployed-sub'))) && OD.querySelectorAll('#ap-cap-deployed-split i').length === 1, txt(OD.getElementById('ap-cap-deployed-sub')));
    check('meta reads "1 of 4 classes held"', txt(OD.getElementById('ap-by-class-meta')) === '1 of 4 classes held');
    const oAcct = await callAs(otok, 'get-account-state'); const oTpv = await callAs(otok, 'get-total-portfolio-value');
    check('★ ROUNDING-ORDER CONTROL: allocated_capital = Σ round2(position) = 200.00, NOT round2(Σ raw) = 200.01 (the pre-fix order, proven to give a different number here)', oAcct.allocatedCapital === 200 && oret.currentValue === 200 && r2(crypto2.reduce((s, p) => s + (100.004 / p.unit_price) * p.unit_price, 0)) === 200.01, oAcct.allocatedCapital + ' / ' + oret.currentValue);
    check('  ...and the page’s deployed figure is that same $200', txt(OD.getElementById('ap-cap-deployed-amount')) === '$200', txt(OD.getElementById('ap-cap-deployed-amount')));
    check('with no pockets and nothing realised, account value equals the portfolio value (the identity with zero pockets)', txt(OD.getElementById('ap-total-amount')) === usd2(oTpv.totalPortfolioValue) && r2(oret.currentValue + oAcct.unallocatedCapital) === oTpv.totalPortfolioValue, txt(OD.getElementById('ap-total-amount')) + ' vs ' + oTpv.totalPortfolioValue);
  } finally {
    await shared.auth.signOut({ scope: 'local' }).catch(() => {});
    if (simA) await deleteSimulatedTestProduct(admin, simA.id);
    if (simB) await deleteSimulatedTestProduct(admin, simB.id);
    for (const id of created) {
      for (const t of ['holdings', 'account_state', 'portfolio_value_snapshots', 'transactions']) await admin.from(t).delete().eq('client_id', id);
      await admin.from('clients').delete().eq('id', id);
      const { error } = await admin.auth.admin.deleteUser(id); if (error) console.error('CLEANUP ' + id + ': ' + error.message);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
}

runVerifyMain(main, { watchdogMs: 600000 });
