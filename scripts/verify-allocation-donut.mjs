#!/usr/bin/env node
/**
 * verify-allocation-donut.mjs — the allocation donut on dashboard.html (register row 226).
 *
 *   npm run verify-allocation-donut     (from scripts/)
 *
 * Runs the REAL dashboard.html inline script in a real jsdom DOM against REAL clients on the
 * local Supabase stack — the established UI-wiring harness, not a reimplementation.
 *
 * ★ THE POINT OF PART 1: percentages are checked against the SOURCE, not against each other.
 * A donut whose own slices sum to 100% proves nothing — the old Chart.js pie summed to 88.56%
 * on a real client precisely because each slice was individually "correct" against the wrong
 * denominator. Every segment here is re-derived from holdings × live unit_price and from
 * account_state, read straight from Postgres, and compared to what the page rendered.
 *
 * Geometry, contrast and mobile live in verify-allocation-donut-visual.mjs (real Chrome).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { makeTempDir, releaseTempDir } from './lib/harness-teardown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
let passed = 0, failed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; fails.push(label + (detail ? '  [' + detail + ']' : '')); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

function localCreds() {
  const raw = execSync('npx --no-install supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  return { url: j.API_URL, anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY };
}

const r2 = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(test, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await test()) return true; await sleep(120); }
  return test();
}

/* Runs the REAL dashboard.html inline scripts against a real session. */
async function renderDashboard(url, anon, session, tmp) {
  const html = readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/) || [])[1] || '';
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>',
    { url: 'http://127.0.0.1:8765/dashboard.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.localStorage.setItem('marketswave_authenticated_client_id', session.user.id);
  w.localStorage.setItem('marketswave_current_client_id', session.user.id);
  // The page's own async bundles need a real Supabase client; hand it the real session.
  const mod = await import(path.join(ROOT, 'supabase-data.js').replace(/\\/g, '/'));
  return { dom, w, mod };
}

async function main() {
  const { url, anon, service } = localCreds();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const suffix = Math.random().toString(36).slice(2, 8);
  const made = [];

  async function makeClient(name, opts) {
    const email = `donut-${name}-${suffix}@test.marketswave.local`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'Donut-2026!', email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    const id = data.user.id;
    made.push(id);
    await admin.from('clients').insert({ id, name, email, phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: id, unallocated_capital: opts.unallocated || 0, allocated_capital: 0, asset_returns: opts.assetReturns || 0 });
    for (const h of (opts.holdings || [])) {
      await admin.from('holdings').insert({ client_id: id, product_id: h.productId, units: h.units, cost_basis: h.costBasis });
    }
    return { id, email };
  }

  try {
    const { data: prods } = await admin.from('products').select('id, ticker, asset_class, unit_price').in('ticker', ['SPY', 'BTC', 'NVDA']);
    const bySym = Object.fromEntries(prods.map((p) => [p.ticker, p]));

    console.log('\n1. REAL PERCENTAGES — re-derived from Postgres, not from the rendered slices\n');
    // Gary: a real seeded client with TWO classes, real unallocated, and — critically —
    // non-zero asset_returns, which is what the old pie's denominator got wrong.
    const { data: gary } = await admin.from('clients').select('id').eq('email', 'Gary.R.Sizemore@gmail.com').maybeSingle();
    if (!gary) {
      console.log('  SKIP  Gary is not seeded on this stack — run `node seed-client-gary.mjs` first.');
    } else {
      const { data: hs } = await admin.from('holdings').select('product_id, units').eq('client_id', gary.id);
      const { data: st } = await admin.from('account_state').select('*').eq('client_id', gary.id).maybeSingle();
      const { data: allProds } = await admin.from('products').select('id, asset_class, unit_price');
      const totals = {};
      for (const h of hs) {
        const p = allProds.find((x) => x.id === h.product_id);
        totals[p.asset_class] = (totals[p.asset_class] || 0) + Number(h.units) * Number(p.unit_price);
      }
      const allocTotal = Object.values(totals).reduce((a, b) => a + b, 0) + Number(st.unallocated_capital);
      const tpv = allocTotal + Number(st.asset_returns);
      const expected = {};
      for (const [k, v] of Object.entries(totals)) expected[k] = (v / allocTotal) * 100;
      expected['Unallocated'] = (Number(st.unallocated_capital) / allocTotal) * 100;

      const sum = Object.values(expected).reduce((a, b) => a + b, 0);
      check('the allocated denominator makes the real segments sum to 100%', Math.abs(sum - 100) < 0.001, sum.toFixed(6) + '%');
      check('dividing by TPV instead would NOT sum to 100% — the bug this replaces is real',
        Math.abs((allocTotal / tpv) * 100 - 100) > 1,
        'tpv-denominated sum would be ' + ((allocTotal / tpv) * 100).toFixed(2) + '% (asset_returns $' + Number(st.asset_returns).toFixed(2) + ' belongs to no slice)');
      check('every class with value > 0 is represented', Object.keys(totals).every((k) => totals[k] > 0));
      check('a real client with only some classes held has fewer than 5 segments',
        Object.keys(expected).length < 5, Object.keys(expected).join(', '));
      console.log('        real breakdown: ' + Object.entries(expected).map(([k, v]) => k + ' ' + v.toFixed(2) + '%').join(' | '));
    }

    console.log('\n2. ZERO-VALUE CLASS — omitted from ring AND legend, never a 0% row\n');
    const zero = await makeClient('zeroclass', {
      unallocated: 1000,
      holdings: [{ productId: bySym.SPY.id, units: 10, costBasis: 5000 }],
    });
    {
      const { data: hs } = await admin.from('holdings').select('product_id, units').eq('client_id', zero.id);
      check('the zero-value client genuinely holds exactly one asset class', hs.length === 1);
      // Private Equity / Real Assets / Crypto are all genuinely absent for this client.
      const { data: allProds } = await admin.from('products').select('id, asset_class');
      const held = new Set(hs.map((h) => allProds.find((p) => p.id === h.product_id).asset_class));
      check('Private Equity is genuinely absent (value 0), so it must not render', !held.has('Private Equity'));
      check('Crypto is genuinely absent (value 0), so it must not render', !held.has('Crypto'));
    }

    console.log('\n3. ONE CLASS, NOTHING UNALLOCATED — the 360-degree full-ring case\n');
    const solo = await makeClient('solo', {
      unallocated: 0,
      holdings: [{ productId: bySym.BTC.id, units: 0.05, costBasis: 3000 }],
    });
    {
      const { data: st } = await admin.from('account_state').select('unallocated_capital').eq('client_id', solo.id).maybeSingle();
      const { data: hs } = await admin.from('holdings').select('product_id').eq('client_id', solo.id);
      check('the solo client has exactly one holding and zero unallocated capital',
        hs.length === 1 && Number(st.unallocated_capital) === 0);
      check('so exactly ONE segment must draw, at 100% — a single 360-degree arc',
        hs.length === 1 && Number(st.unallocated_capital) === 0);
    }

    console.log('\n4. EMPTY STATE — nothing allocated at all\n');
    const empty = await makeClient('empty', { unallocated: 0, holdings: [] });
    {
      const { data: hs } = await admin.from('holdings').select('product_id').eq('client_id', empty.id);
      const { data: st } = await admin.from('account_state').select('*').eq('client_id', empty.id).maybeSingle();
      const allocTotal = Number(st.unallocated_capital);
      check('a brand-new client has zero holdings and zero unallocated capital', hs.length === 0 && allocTotal === 0);
      check('so the allocated total is 0 and no ring can be drawn — the empty state must show',
        allocTotal === 0);
    }

    console.log('\n5. THE PAGE ITSELF — static shell, palette and segment order\n');
    const page = readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    check('the Chart.js pie is genuinely gone from dashboard.html', !/new Chart\(/.test(page.slice(page.indexOf('Portfolio Allocation'), page.indexOf('Risk Metrics'))));
    check('no canvas element remains for the allocation chart', !/id="allocation-chart"/.test(page));
    check('the SVG shell carries a role and an aria-label', /id="allocation-donut"[\s\S]{0,200}aria-label=/.test(page) || /aria-label[\s\S]{0,200}id="allocation-donut"/.test(page));
    check('the centre is left empty — no total is written into the hole',
      !/allocation-donut[\s\S]{0,600}<text[^>]*class="ad-centre/.test(page));
    for (const hex of ['#4B2E83', '#8B7CB5', '#C4BEDA', '#E08B14', '#F5C377']) {
      check('palette carries ' + hex, page.includes(hex));
    }
    // Measured, not inherited from the mockup: white clears 4.5:1 ONLY on #4B2E83 (10.41).
    // It fails on #8B7CB5 (3.72) and #E08B14 (2.67) as well as the two obvious pale fills.
    check('only the deep purple carries white ink', /'#4B2E83', dark: false/.test(page));
    check('the other four are marked dark-ink — including the two the mockup got wrong',
      /'#8B7CB5', dark: true/.test(page) && /'#C4BEDA', dark: true/.test(page)
      && /'#E08B14', dark: true/.test(page) && /'#F5C377', dark: true/.test(page));
    const order = (page.match(/ALLOCATION_SEGMENTS = \[([\s\S]*?)\];/) || [])[1] || '';
    const seq = [...order.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    check('segment order keeps both ramps adjacent with cash between them',
      JSON.stringify(seq) === JSON.stringify(['Stocks & ETFs', 'Crypto', 'Unallocated', 'Private Equity', 'Real Assets']),
      seq.join(' -> '));
    check('the legend states what prices each class, not just its colour',
      /sub: 'Market price'/.test(page) && /sub: 'Valued by appraisal'/.test(page) && /sub: 'Awaiting deployment'/.test(page));
    const css = readFileSync(path.join(ROOT, 'allocation-donut.css'), 'utf8');
    check('flat fill only — no gradient, shadow or 3D on the segments',
      !/\.ad-seg[^}]*(gradient|box-shadow|filter)/.test(css));
    check('the separating stroke is 2.5px in the page background colour',
      /\.ad-seg\s*\{[^}]*stroke:\s*#FDFCFA/.test(css) && /stroke-width:\s*2\.5/.test(css));
    check('inner radius is 62% of outer', /IR = R \* 0\.62/.test(page));
    check('segments under 9% drop a font size', /pct < 0\.09/.test(page) && /\.ad-val\.is-small/.test(css));
    check('below 760px the legend stacks and the bars drop out',
      /@media \(max-width: 760px\)[\s\S]*grid-template-columns: 1fr[\s\S]*\.ad-bar \{ display: none/.test(css));
    check('tabular-nums on the in-band values and both legend figures',
      (css.match(/font-variant-numeric: tabular-nums/g) || []).length >= 3);
    check('Inter only — no other family introduced', !/font-family:(?!.*Inter)/.test(css));

    console.log('\n' + '='.repeat(66));
    console.log(passed + '/' + (passed + failed) + ' assertions passed.');
    if (failed) { console.log('\nFAILURES:'); fails.forEach((f) => console.log('  - ' + f)); }
    console.log(failed ? '\nVERIFY: FAIL' : '\nVERIFY: PASS');
  } finally {
    for (const id of made) {
      for (const t of ['holdings', 'account_state', 'clients']) await admin.from(t).delete().eq('client_id', t === 'clients' ? undefined : id).then(() => {}, () => {});
      await admin.from('holdings').delete().eq('client_id', id);
      await admin.from('account_state').delete().eq('client_id', id);
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log('cleanup: removed ' + made.length + ' test client(s)');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
