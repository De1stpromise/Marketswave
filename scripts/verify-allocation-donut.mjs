#!/usr/bin/env node
/**
 * verify-allocation-donut.mjs — the allocation donut on dashboard.html (register rows 226, 229).
 *
 *   npm run verify-allocation-donut     (from scripts/)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * ★ THIS SUITE WAS VACUOUS AND IS REWRITTEN. READ THIS BEFORE EDITING IT.
 *
 * As first written it imported JSDOM, defined a renderDashboard() helper — AND NEVER CALLED
 * IT. Not one assertion touched the page. Its headline check was:
 *
 *     for (const [k, v] of Object.entries(totals)) expected[k] = (v / allocTotal) * 100;
 *     expected['Unallocated'] = (unallocated / allocTotal) * 100;
 *     const sum = Object.values(expected).reduce((a, b) => a + b, 0);
 *     check('the allocated denominator makes the real segments sum to 100%', Math.abs(sum - 100) < 0.001);
 *
 * It divided a set of values by their own total and then verified that the quotients summed
 * to one. That is arithmetic, not a test: it would have passed against no shipped code at
 * all, against the OLD Chart.js pie, and against a dashboard.html that did not exist. It
 * reported 31/31 over two real bugs.
 *
 * The rule this file now follows, and any future edit must keep: EVERY HEADLINE ASSERTION
 * READS A VALUE OUT OF THE RENDERED DOM AND COMPARES IT TO ONE DERIVED INDEPENDENTLY FROM
 * POSTGRES. A check whose two sides are both computed by this file proves only that this
 * file can divide.
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Runs the REAL dashboard.html inline script in a real jsdom DOM against REAL clients on the
 * local Supabase stack — the established UI-wiring harness (the same extractInlineScript /
 * buildPageDom / sign-in-then-eval shape verify-dashboard-real-data-fixes.mjs uses), not a
 * reimplementation.
 *
 * Geometry, contrast and mobile live in verify-allocation-donut-visual.mjs (real Chrome).
 *
 * LOCAL STACK ONLY.
 * Usage (the --experimental-loader flag is baked into the npm script):
 *   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-allocation-donut.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DASH = path.join(ROOT, 'dashboard.html');
const PASSWORD = 'Donut-2026!';

let passed = 0, failed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; fails.push(label + (detail ? '  [' + detail + ']' : '')); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

function localCreds() {
  const raw = execSync('npx --no-install supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(j.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + j.API_URL);
  }
  return { url: j.API_URL, anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(test, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await test()) return true; await sleep(120); }
  return test();
}

const forwardingConsole = new VirtualConsole();
forwardingConsole.forwardTo(console);

function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}

function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!m) throw new Error('Could not find <body> in ' + htmlPath);
  return m[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

function buildPageDom() {
  return new JSDOM('<!doctype html><html><body>' + extractBodyMarkup(DASH) + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: forwardingConsole
  });
}

/**
 * ★ THE RENDER. This is the thing the old file defined and never called.
 *
 * Signs a REAL session in as the given client, evaluates the REAL dashboard.html inline
 * script against a real DOM, waits for the allocation bundle to settle, and hands back what
 * the page actually painted — legend rows, arc count, in-band labels, empty-state text.
 * Nothing here recomputes a percentage; it only reads.
 */
async function renderDonut(MarketswaveData, client) {
  const dom = buildPageDom();
  dom.window.MarketswaveData = MarketswaveData;
  dom.window.clientScopedKey = function (key) { return key + ':' + client.id; };
  dom.window.getAuthenticatedClientId = function () { return client.id; };

  const D = dom.window.document;
  const legendEl = D.getElementById('allocation-legend');

  const shared = await MarketswaveData.getSupabaseClient();
  const { error } = await shared.auth.signInWithPassword({ email: client.email, password: PASSWORD });
  if (error) throw new Error('sign-in for ' + client.email + ': ' + error.message);

  dom.window.eval(extractInlineScript(DASH, 'UI Wiring — Stage 1'));

  // Settled = the skeleton is gone and the bundle has painted something real: either legend
  // rows, or the genuine empty state.
  const settled = await pollUntil(function () {
    if (/animate-pulse/.test(legendEl.innerHTML)) return false;
    return legendEl.querySelectorAll('.ad-row').length > 0
      || legendEl.textContent.indexOf('No capital deployed yet') !== -1;
  }, 25000);

  const rows = [...legendEl.querySelectorAll('.ad-row')].map(function (row) {
    return {
      name: row.querySelector('.ad-nm b').textContent.trim(),
      sub: row.querySelector('.ad-nm span').textContent.trim(),
      amount: row.querySelector('.ad-amt b').textContent.trim(),
      pct: parseFloat(row.querySelector('.ad-amt span').textContent)
    };
  });

  return {
    dom, D, settled, rows,
    legendText: legendEl.textContent.replace(/\s+/g, ' ').trim(),
    arcs: D.querySelectorAll('#allocation-ring path.ad-seg').length,
    labels: [...D.querySelectorAll('#allocation-vals text')].map((t) => t.textContent.trim()),
    ariaLabel: (D.getElementById('allocation-donut') || {}).getAttribute
      ? D.getElementById('allocation-donut').getAttribute('aria-label') : null,
    chartHidden: D.getElementById('allocation-chart-wrapper').classList.contains('hidden')
  };
}

/** What Postgres says, derived WITHOUT reference to anything the page computed. */
async function truthFor(admin, clientId) {
  const { data: hs } = await admin.from('holdings').select('product_id, units').eq('client_id', clientId);
  const { data: st } = await admin.from('account_state').select('*').eq('client_id', clientId).maybeSingle();
  const { data: allProds } = await admin.from('products').select('id, asset_class, unit_price');
  const totals = {};
  for (const h of (hs || [])) {
    const p = allProds.find((x) => x.id === h.product_id);
    totals[p.asset_class] = (totals[p.asset_class] || 0) + Number(h.units) * Number(p.unit_price);
  }
  const unallocated = Number((st || {}).unallocated_capital || 0);
  const assetReturns = Number((st || {}).asset_returns || 0);
  const allocated = Object.values(totals).reduce((a, b) => a + b, 0);
  const denom = allocated + unallocated;
  const expected = {};
  for (const [k, v] of Object.entries(totals)) if (v > 0) expected[k] = (v / denom) * 100;
  if (unallocated > 0) expected['Unallocated'] = (unallocated / denom) * 100;
  return { totals, unallocated, assetReturns, allocated, denom, expected, tpv: denom + assetReturns };
}

async function main() {
  const { url, service } = localCreds();
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);

  const suffix = Math.random().toString(36).slice(2, 8);
  const made = [];

  async function makeClient(name, opts) {
    const email = `donut-${name}-${suffix}@test.marketswave.local`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    const id = data.user.id;
    made.push(id);
    await admin.from('clients').insert({ id, name: 'Donut ' + name, email, phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: id, unallocated_capital: opts.unallocated || 0, allocated_capital: 0, asset_returns: opts.assetReturns || 0 });
    for (const h of (opts.holdings || [])) {
      await admin.from('holdings').insert({ client_id: id, product_id: h.productId, units: h.units, cost_basis: h.costBasis });
    }
    return { id, email };
  }

  try {
    const { data: prods } = await admin.from('products').select('id, ticker, asset_class, unit_price').in('ticker', ['SPY', 'BTC', 'NVDA']);
    const bySym = Object.fromEntries(prods.map((p) => [p.ticker, p]));

    /* ════════════════════════════════════════════════════════════════════════════════════
     * 1. REAL PERCENTAGES — READ OUT OF THE RENDERED DOM, cross-checked against Postgres.
     *
     * The fixture is chosen so the two bugs this section exists for are genuinely exercised:
     *   - NON-ZERO unallocated capital, so an Unallocated band must actually render. Without
     *     it "the segments sum to 100" passes for a client who has no Unallocated term at
     *     all, which is exactly the term the denominator bug was about.
     *   - NON-ZERO asset_returns, so a tpv denominator would be VISIBLY wrong. Without it the
     *     two denominators are numerically identical and the check cannot tell them apart.
     * Both are asserted as guards below, so the section can never pass vacuously.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n1. REAL PERCENTAGES — read from the rendered DOM, cross-checked against Postgres\n');
    {
      const c = await makeClient('pcts', {
        unallocated: 25000, assetReturns: 9000,
        holdings: [
          { productId: bySym.SPY.id, units: 50, costBasis: 20000 },
          { productId: bySym.BTC.id, units: 0.25, costBasis: 15000 }
        ]
      });
      const t = await truthFor(admin, c.id);

      check('GUARD: the fixture genuinely HAS unallocated capital, so an Unallocated band must exist',
        t.unallocated > 0, '$' + t.unallocated);
      check('GUARD: the fixture genuinely HAS asset_returns, so a tpv denominator would be visibly wrong',
        t.assetReturns > 0, '$' + t.assetReturns);
      check('GUARD: the fixture holds more than one asset class, so this is not a trivial single-slice case',
        Object.keys(t.totals).length > 1, Object.keys(t.totals).join(', '));

      const r = await renderDonut(MarketswaveData, c);
      check('the REAL dashboard.html script rendered the donut (not a skeleton, not an error card)',
        r.settled && r.rows.length > 0, r.legendText.slice(0, 140));

      check('the page drew one arc and one legend row per non-zero class, and no more',
        r.rows.length === Object.keys(t.expected).length && r.arcs === r.rows.length,
        'rendered ' + r.rows.length + ' rows / ' + r.arcs + ' arcs, expected ' + Object.keys(t.expected).length);

      check('★ an UNALLOCATED band is genuinely RENDERED for a client who has unallocated capital',
        r.rows.some((x) => x.name === 'Unallocated'), r.rows.map((x) => x.name).join(', '));

      const diffs = [];
      for (const row of r.rows) {
        const want = t.expected[row.name];
        if (want == null || Math.abs(want - row.pct) > 0.06) {
          diffs.push(row.name + ' rendered ' + row.pct + '% vs Postgres ' + (want == null ? '(absent)' : want.toFixed(2) + '%'));
        }
      }
      check('★ every RENDERED percentage matches the one derived independently from Postgres',
        diffs.length === 0, diffs.join(' | ') || 'all matched');

      const renderedSum = r.rows.reduce((a, x) => a + x.pct, 0);
      check('★ the RENDERED percentages sum to 100 — read off the page, not computed by this test',
        Math.abs(renderedSum - 100) < 0.15,
        r.rows.map((x) => x.name + ' ' + x.pct + '%').join(' + ') + ' = ' + renderedSum.toFixed(2));

      // The old pie's actual defect, asserted as a property of the RENDERED output: had
      // asset_returns stayed in the denominator, the page would have summed to this instead.
      const tpvSum = (t.denom / t.tpv) * 100;
      check('★ asset_returns is NOT in the denominator — a tpv-denominated page would have summed to ' + tpvSum.toFixed(2) + '%',
        Math.abs(renderedSum - tpvSum) > 1,
        'rendered ' + renderedSum.toFixed(2) + '% vs tpv-denominated ' + tpvSum.toFixed(2) + '%');

      const wantAmounts = Object.fromEntries(Object.entries(t.expected).map(([k]) => [k, true]));
      check('each legend row carries a real dollar amount alongside its percentage',
        r.rows.length > 0 && r.rows.every((x) => /^\$[\d,]/.test(x.amount)) && Object.keys(wantAmounts).length === r.rows.length,
        r.rows.map((x) => x.name + ' ' + x.amount).join(', '));

      check('the SVG describes the real rendered breakdown to a screen reader',
        r.ariaLabel && r.rows.every((x) => r.ariaLabel.indexOf(x.name) !== -1), r.ariaLabel);
    }

    /* ════════════════════════════════════════════════════════════════════════════════════
     * 1b. A BAND UNDER 3% — the suppression rule, exercised against the page.
     *
     * ★ ADDED BECAUSE THE SHIPPED RULE WAS NEVER TESTED AT ALL. `if (pct >= 0.03)` decides
     * whether an in-band label is drawn, and no fixture in this suite had ever produced a
     * band under 3% — so nothing distinguished a suppression rule keyed on the value's SHARE
     * from one keyed on rendered arc width in PIXELS, which is what the mobile bug report
     * first suggested. Suppressed IN THE BAND, still present in the LEGEND, sum still 100.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n1b. A BAND UNDER 3% — suppressed in the ring, still in the legend\n');
    {
      // ~$34,000 of SPY against $500 of unallocated ⇒ Unallocated lands near 1.4%.
      const c = await makeClient('tiny', {
        unallocated: 500, assetReturns: 0,
        holdings: [{ productId: bySym.SPY.id, units: 50, costBasis: 20000 }]
      });
      const t = await truthFor(admin, c.id);
      const tinyPct = t.expected['Unallocated'];
      check('GUARD: the fixture genuinely produces a band under 3% — otherwise this section tests nothing',
        tinyPct > 0 && tinyPct < 3, 'Unallocated is ' + (tinyPct || 0).toFixed(2) + '%');

      const r = await renderDonut(MarketswaveData, c);
      check('the page rendered for the under-3% client', r.settled && r.rows.length > 0, r.legendText.slice(0, 120));

      const tinyRow = r.rows.find((x) => x.name === 'Unallocated');
      check('★ the under-3% class IS still a legend row, with its real percentage',
        !!tinyRow && Math.abs(tinyRow.pct - tinyPct) < 0.06,
        tinyRow ? tinyRow.name + ' ' + tinyRow.pct + '%' : 'absent');
      check('★ and IS still drawn as an arc — suppression hides the label, never the segment',
        r.arcs === r.rows.length, r.arcs + ' arcs for ' + r.rows.length + ' rows');
      check('★ but its in-band LABEL is suppressed — fewer labels than segments',
        r.labels.length === r.rows.length - 1,
        r.labels.length + ' labels for ' + r.rows.length + ' segments: ' + r.labels.join(', '));
      check('the label that IS drawn belongs to the band over 3%',
        r.labels.length === 1 && Math.abs(parseFloat(r.labels[0]) - (100 - tinyPct)) < 1.5, r.labels.join(', '));

      const sum = r.rows.reduce((a, x) => a + x.pct, 0);
      check('the rendered percentages still sum to 100 with a suppressed band present',
        Math.abs(sum - 100) < 0.15, sum.toFixed(2) + '%');
    }

    /* ════════════════════════════════════════════════════════════════════════════════════
     * 2. ZERO-VALUE CLASS — omitted from ring AND legend, never a 0% row.
     * Previously this asserted only that Postgres held one asset class. That is a fact about
     * the fixture, not about the page: it would have passed if the page rendered five 0%
     * rows. Now read off the rendered legend.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n2. ZERO-VALUE CLASS — omitted from ring AND legend, never a 0% row\n');
    {
      const c = await makeClient('zeroclass', {
        unallocated: 1000,
        holdings: [{ productId: bySym.SPY.id, units: 10, costBasis: 5000 }]
      });
      const t = await truthFor(admin, c.id);
      check('GUARD: the fixture genuinely holds exactly one asset class, so three classes are truly absent',
        Object.keys(t.totals).length === 1, Object.keys(t.totals).join(', '));

      const r = await renderDonut(MarketswaveData, c);
      check('the page rendered for the single-class client', r.settled && r.rows.length > 0, r.legendText.slice(0, 120));
      check('★ exactly two rows render — the held class and Unallocated, nothing else',
        r.rows.length === 2 && r.arcs === 2, r.rows.map((x) => x.name).join(', '));
      for (const absent of ['Private Equity', 'Real Assets', 'Crypto']) {
        check(absent + ' is genuinely absent and does NOT appear in the rendered legend',
          !r.rows.some((x) => x.name === absent) && r.legendText.indexOf(absent) === -1);
      }
      check('★ no rendered row reads 0.0% — an absent class is omitted, not shown empty',
        r.rows.every((x) => x.pct > 0), r.rows.map((x) => x.name + ' ' + x.pct + '%').join(', '));
    }

    /* ════════════════════════════════════════════════════════════════════════════════════
     * 3. ONE CLASS, NOTHING UNALLOCATED — the 360-degree full-ring case.
     * A single 360-degree arc is where SVG arc paths degenerate (start == end, the A command
     * is a no-op and NOTHING paints). The old version asserted only that the fixture had one
     * holding — which is true whether the ring drew or vanished.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n3. ONE CLASS, NOTHING UNALLOCATED — the 360-degree full-ring case\n');
    {
      const c = await makeClient('solo', {
        unallocated: 0,
        holdings: [{ productId: bySym.BTC.id, units: 0.05, costBasis: 3000 }]
      });
      const t = await truthFor(admin, c.id);
      check('GUARD: the fixture genuinely has one holding and zero unallocated capital',
        Object.keys(t.totals).length === 1 && t.unallocated === 0);

      const r = await renderDonut(MarketswaveData, c);
      check('the page rendered for the full-ring client', r.settled && r.rows.length > 0, r.legendText.slice(0, 120));
      check('★ exactly ONE arc is painted at 100% — the degenerate full-circle path did not vanish',
        r.arcs === 1 && r.rows.length === 1 && Math.abs(r.rows[0].pct - 100) < 0.05,
        r.arcs + ' arcs, ' + (r.rows[0] ? r.rows[0].pct + '%' : 'no row'));
      const d = r.D.querySelector('#allocation-ring path.ad-seg').getAttribute('d');
      check('the full ring is drawn as a real two-arc annulus, not a zero-length arc',
        (d.match(/ A /g) || []).length === 4 && /fill-rule/.test(r.D.querySelector('#allocation-ring path.ad-seg').outerHTML),
        d.slice(0, 80) + '…');
      check('its in-band label reads 100%', r.labels.length === 1 && r.labels[0] === '100%', r.labels.join(', '));
    }

    /* ════════════════════════════════════════════════════════════════════════════════════
     * 4. EMPTY STATE — nothing deployed at all. Asserted against what the page SHOWS.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n4. EMPTY STATE — nothing allocated at all\n');
    {
      const c = await makeClient('empty', { unallocated: 0, holdings: [] });
      const t = await truthFor(admin, c.id);
      check('GUARD: the fixture genuinely has zero holdings and zero unallocated capital',
        Object.keys(t.totals).length === 0 && t.denom === 0);

      const r = await renderDonut(MarketswaveData, c);
      check('★ the page painted the real empty state, not a blank card or a degenerate ring',
        r.settled && r.legendText.indexOf('No capital deployed yet') !== -1, r.legendText.slice(0, 120));
      check('no arc and no legend row is drawn at all', r.arcs === 0 && r.rows.length === 0, r.arcs + ' arcs / ' + r.rows.length + ' rows');
      check('the chart wrapper is hidden so no empty ring sits beside the message', r.chartHidden);
      check('the empty state offers a real way forward — a Deploy Capital link',
        !!r.D.querySelector('#allocation-legend a[href="deploy-capital.html"]'));
    }

    /* ════════════════════════════════════════════════════════════════════════════════════
     * 5. THE PAGE ITSELF — static shell, palette and segment order.
     * These are genuinely static-source facts (a palette hex, a declared order), so reading
     * them from source is the right check — unlike everything above, there is no rendered
     * value to read instead. Kept as-is.
     * ═════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n5. THE PAGE ITSELF — static shell, palette and segment order\n');
    const page = readFileSync(DASH, 'utf8');
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
    // ★ The suppression rule is keyed on the value's SHARE, not on rendered pixels — asserted
    // here in source AND exercised against the page in section 1b above.
    check('the under-3% suppression rule is share-based, not pixel-based', /if \(pct >= 0\.03\)/.test(page));
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
      await admin.from('holdings').delete().eq('client_id', id);
      await admin.from('account_state').delete().eq('client_id', id);
      await admin.from('portfolio_value_snapshots').delete().eq('client_id', id).then(() => {}, () => {});
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log('cleanup: removed ' + made.length + ' test client(s)');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
