// ★ PM tool revamp, part 6 — the products page, driven through its REAL script (row 236).
//
// The catalogue holds 331 products on a page that was built for five. Everything this suite
// asserts is the behaviour that only matters AT THAT SCALE: a search that reaches a product
// sitting well beyond the first page, pill counts that follow the search rather than quoting a
// static total, a sort that genuinely re-orders the rows, and a duplicate caught at SEARCH time
// rather than after a PM has filled a whole form.
//
// ★ THE PAGE'S OWN SCRIPT RUNS HERE, UNMODIFIED — admin-products.html's <body> is extracted
// verbatim, its <script> tags stripped, and admin-products-page.js evaluated into the window.
// Nothing is re-implemented, so an assertion that passes is the real page passing.
//
// ★ NAV IS ASSERTED (row 228). The approval gate shipped with no rail, no active item and no
// Log out, and a 69-assertion suite missed it because every assertion looked at the feature and
// none at the chrome. The rendered proof is the visual suite's job — admin-sidebar.js gates its
// render on a real getSession() jsdom cannot satisfy — so this half asserts the call exists.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = path.join(ROOT, 'admin-products.html');
const PAGE_JS = path.join(ROOT, 'admin-products-page.js');
const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'ProdPage-2026!';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(fn, maxMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { try { if (fn()) return true; } catch (e) {} await sleep(120); }
  return false;
}
/** Poll a real Postgres read until it satisfies fn — a UI write lands asynchronously. */
async function pollRow(read, fn, maxMs = 25000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < maxMs) {
    const { data } = await read();
    last = data;
    if (data && fn(data)) return data;
    await sleep(150);
  }
  return last && fn(last) ? last : null;
}
/** ★ A swallowed seed error looks EXACTLY like a page bug — this suite lost a run to a
 *  NOT NULL violation that reported as "the test product is not on screen". Never insert
 *  without reading the error back. */
async function must(p, what) {
  const { error } = await p;
  if (error) throw new Error('could not ' + what + ': ' + error.message);
}
const vc = new VirtualConsole();

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

/** The REAL page body + the REAL external page script. */
function buildDom(MarketswaveData, apiUrl) {
  const html = readFileSync(PAGE, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    url: 'http://127.0.0.1:8765/admin-products.html', runScripts: 'outside-only',
    virtualConsole: vc, pretendToBeVisual: true
  });
  dom.window.MarketswaveData = MarketswaveData;
  for (const f of ['format-helpers.js', 'asset-mark.js']) dom.window.eval(readFileSync(path.join(ROOT, f), 'utf8'));
  // supabase-data.js does this in a real browser the moment either client resolves; this jsdom
  // window has its own fresh copy of asset-mark.js, so it needs its own configure().
  dom.window.eval('AssetMark.configure({ storageBase: ' + JSON.stringify(apiUrl) + ' });');
  dom.window.eval(readFileSync(PAGE_JS, 'utf8'));
  return dom;
}
const rows = (dom) => [...dom.window.document.querySelectorAll('.pr-tr')];
const ready = (dom) => pollUntil(() => rows(dom).length > 0);
function q(dom, sel) { return dom.window.document.querySelector(sel); }
function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
function typeInto(dom, el, value) {
  el.value = value;
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
function rowName(r) { return txt(r.querySelector('.pr-nm b')); }
function pill(dom, key) { return q(dom, '[data-filter="' + key.replace(/"/g, '\\"') + '"]'); }
function pillCount(dom, key) { const p = pill(dom, key); return p ? Number(txt(p.querySelector('.n'))) : -1; }
const digits = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  globalThis.document = { addEventListener() {} };
  await import('../supabase-data.js');
  const D = globalThis.window.MarketswaveData;
  const cfg = await import('../admin-supabase-config.js');
  const { error: pmErr } = await cfg.supabase.auth.signInWithPassword({
    email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!'
  });
  check('a real admin session is established', !pmErr, pmErr && pmErr.message);
  D.useAdminClient();

  const createdProducts = [];
  const holders = [];
  const badId = 'PROD-TEST-BAD-' + SUF.toUpperCase();

  try {
    console.log('\n=== PART 1: NAVIGATION (row 228) ===\n');
    const src = readFileSync(PAGE, 'utf8');
    check("★ the page calls initAdminSidebar('products')", /initAdminSidebar\(\s*['"]products['"]\s*\)/.test(src));
    check('the page mounts the shared sidebar container', /id="admin-sidebar-mount"/.test(src));

    console.log('\n=== PART 2: the catalogue at real scale ===\n');
    const payload = await D.callFunction('get-product-catalog');
    check('GUARD: the catalogue is genuinely large — this page exists for that reason',
      payload.products.length > 100, payload.products.length + ' products');

    const dom = buildDom(D, st.API_URL);
    check('GUARD: the page rendered real rows', await ready(dom), 'no .pr-tr appeared');
    const doc = dom.window.document;

    const active = payload.products.filter((p) => p.status !== 'retired');
    check('the default view shows the first page only, not all ' + active.length,
      rows(dom).length === Math.min(40, active.length), rows(dom).length + ' rows');
    check('...and says so honestly',
      /Showing 40 of \d+/.test(txt(q(dom, '.pr-more'))), txt(q(dom, '.pr-more')));
    const before = rows(dom).length;
    q(dom, '#pr-more').click();
    check('★ "Continue browsing" pages the next 40 in', rows(dom).length === before + 40,
      before + ' → ' + rows(dom).length);
    check('the subtitle states the real catalogue size',
      txt(q(dom, '#pr-sub')).indexOf(payload.strip.total + ' in the catalogue') === 0, txt(q(dom, '#pr-sub')));

    console.log('\n=== PART 3: ★ SEARCH REACHES BEYOND THE FIRST PAGE ===\n');
    const search = doc.getElementById('pr-search');
    // A product a PM would never see without searching: sorted by name, far past page one.
    const byName = active.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const deep = byName[Math.min(220, byName.length - 1)];
    const deepIndex = byName.indexOf(deep);
    check('GUARD: the chosen product genuinely sits beyond the first page', deepIndex > 40,
      deep.name + ' is #' + (deepIndex + 1));
    typeInto(dom, search, deep.name.slice(0, 12));
    const hitNames = rows(dom).map(rowName);
    check('★ searching by NAME finds a product ' + (deepIndex + 1) + ' rows deep',
      hitNames.indexOf(deep.name) !== -1, hitNames.slice(0, 3).join(' | '));
    if (deep.ticker) {
      typeInto(dom, search, deep.ticker);
      check('★ searching by TICKER finds the same product',
        rows(dom).map(rowName).indexOf(deep.name) !== -1, deep.ticker);
    } else {
      const withTicker = byName.slice(41).filter((p) => p.ticker)[0];
      typeInto(dom, search, withTicker.ticker);
      check('★ searching by TICKER finds a product beyond the first page',
        rows(dom).map(rowName).indexOf(withTicker.name) !== -1, withTicker.ticker);
    }
    typeInto(dom, search, 'zzzz-no-such-product');
    check('a search with no hits shows a real empty state, not a blank panel',
      !!q(dom, '.pr-empty') && /No product matches/i.test(txt(q(dom, '.pr-empty'))));
    check('...and no rows are left behind it', rows(dom).length === 0);

    console.log('\n=== PART 4: filters, with REAL counts ===\n');
    typeInto(dom, search, '');
    const { count: cryptoActive } = await admin.from('products')
      .select('id', { count: 'exact', head: true }).eq('asset_class', 'Crypto').neq('status', 'retired');
    check('★ the Crypto pill count equals an independent Postgres count',
      pillCount(dom, 'Crypto') === cryptoActive, pillCount(dom, 'Crypto') + ' vs ' + cryptoActive);
    check('the All pill counts every non-retired product',
      pillCount(dom, 'all') === active.length, pillCount(dom, 'all') + ' vs ' + active.length);
    pill(dom, 'Crypto').click();
    const cryptoRows = rows(dom);
    check('★ the Crypto pill genuinely narrows the table to Crypto only',
      cryptoRows.length > 0 && cryptoRows.every((r) => /Crypto/.test(txt(r.querySelector('.pr-cls')))),
      cryptoRows.length + ' rows');
    check('...and the pill reads as pressed', pill(dom, 'Crypto').getAttribute('aria-pressed') === 'true');

    // ★ A count that ignores the search is a lie the moment a PM types anything.
    typeInto(dom, search, 'bitcoin');
    const narrowed = pillCount(dom, 'Crypto');
    check('★ pill counts follow the CURRENT search rather than quoting a static total',
      narrowed < cryptoActive && narrowed >= 1, narrowed + ' vs ' + cryptoActive);
    typeInto(dom, search, '');
    pill(dom, 'all').click();

    const { count: retiredCount } = await admin.from('products')
      .select('id', { count: 'exact', head: true }).eq('status', 'retired');
    check('the Retired pill count equals an independent Postgres count',
      pillCount(dom, 'retired') === retiredCount, pillCount(dom, 'retired') + ' vs ' + retiredCount);
    check('★ a retired product never appears under All — it accepts no new allocation',
      rows(dom).every((r) => !r.classList.contains('is-retired')));

    console.log('\n=== PART 5: the health strip — each card is a filter ===\n');
    const cards = [...doc.querySelectorAll('.pr-hc')];
    check('five health figures', cards.length === 5, String(cards.length));
    check('...live-priced, price stale, quote failed, no logo, no fund document',
      cards.map((c) => txt(c.querySelector('.k'))).join('|') ===
      'Live-priced|Price stale|Quote failed|No logo|No fund document',
      cards.map((c) => txt(c.querySelector('.k'))).join('|'));
    check('the live-priced figure equals the endpoint\'s own count, not a client-side re-add',
      digits(txt(cards[0].querySelector('.v'))) === payload.strip.livePriced,
      txt(cards[0].querySelector('.v')) + ' vs ' + payload.strip.livePriced);
    check('the no-fund-document card is scoped to the appraisal-valued products only',
      /of \d+ appraisal-valued/.test(txt(cards[4].querySelector('.x'))), txt(cards[4].querySelector('.x')));

    const noLogoCount = payload.products.filter((p) => !p.logoUrl).length;
    // ★ renderHealth() rebuilds the strip's innerHTML, so `cards` is stale the moment one is
    // clicked — re-query rather than reading aria-pressed off a detached node.
    const healthCard = (i) => doc.querySelectorAll('.pr-hc')[i];
    healthCard(3).click();
    check('★ the "No logo" card filters the table to exactly the products using a monogram',
      rows(dom).length === Math.min(40, noLogoCount) && rows(dom).every((r) => /No logo/.test(txt(r.querySelector('.pr-meta')))),
      rows(dom).length + ' rows of ' + noLogoCount);
    check('...and the card reads as pressed', healthCard(3).getAttribute('aria-pressed') === 'true');
    healthCard(3).click();
    check('clicking it again clears the filter', rows(dom).length === Math.min(40, active.length),
      rows(dom).length + ' rows');

    console.log('\n=== PART 6: sort genuinely re-orders ===\n');
    const nameBtn = () => q(dom, '[data-sort="name"]');
    const priceBtn = () => q(dom, '[data-sort="price"]');
    const asc = rows(dom).map(rowName);
    check('the default order is by name, ascending',
      asc.join('|') === asc.slice().sort((a, b) => a.localeCompare(b)).join('|'), asc.slice(0, 2).join(','));
    nameBtn().click();
    const desc = rows(dom).map(rowName);
    // ★ Only the first 40 of 331 are on screen, so reversing the sort brings in genuinely
    // DIFFERENT products — never the same 40 re-ordered. Compare against the full catalogue's
    // own tail, not the page's own rows, or the assertion can pass on a re-label.
    const fullDesc = byName.slice().reverse().map((p) => p.name);
    check('★ clicking the sorted column reverses it — genuinely different rows, not a re-label',
      desc[0] !== asc[0] && desc.join('|') === fullDesc.slice(0, desc.length).join('|') &&
      desc.every((n) => asc.indexOf(n) === -1),
      asc[0] + ' → ' + desc[0]);
    priceBtn().click();
    const prices = rows(dom).map((r) => digits(txt(r.querySelector('.pr-px-cell'))));
    check('★ sorting by price re-orders by the real figure, highest first',
      prices.every((v, i) => i === 0 || prices[i - 1] >= v), prices.slice(0, 3).join(' ≥ '));
    nameBtn().click();

    console.log('\n=== PART 7: detail panels are SHAPED BY PRICING MODEL ===\n');
    const market = active.filter((p) => p.pricingModel === 'market' && p.ticker)[0];
    const appraisal = active.filter((p) => p.pricingModel === 'appraisal')[0];
    check('GUARD: the catalogue holds both a market-priced and an appraisal-valued product',
      !!market && !!appraisal, (market && market.id) + ' / ' + (appraisal && appraisal.id));

    typeInto(dom, search, market.ticker);
    rows(dom).filter((r) => r.dataset.id === market.id)[0].click();
    const mPanel = () => txt(q(dom, '#pr-panel'));
    check('a market-priced product names its source and symbol',
      /Market · (Finnhub|CoinGecko) · /.test(mPanel()), mPanel().slice(0, 120));
    check('★ ...and offers NO fund-document affordance — the document belongs to appraisal',
      !q(dom, '#pr-doc') && !q(dom, '#pr-publish'));
    check('...it still shows who holds it', /Holders|Held by/.test(mPanel()));
    q(dom, '#pr-close').click();
    check('Close genuinely dismisses the panel', q(dom, '#pr-scrim').classList.contains('hidden'));

    typeInto(dom, search, appraisal.name.slice(0, 10));
    rows(dom).filter((r) => r.dataset.id === appraisal.id)[0].click();
    check('an appraisal-valued product leads with when it was last valued',
      /Last valued/.test(txt(q(dom, '#pr-panel'))) && /days ago/.test(txt(q(dom, '#pr-panel'))));
    check('★ ...and carries a publish-by-percentage field', !!q(dom, '#pr-nav-pct'));
    check('★ ...and states the fund document\'s state as its own block',
      !!q(dom, '#pr-doc') && /No fund document yet|Fund document in draft|Fund document published/.test(txt(q(dom, '#pr-doc'))),
      txt(q(dom, '#pr-doc')).slice(0, 80));
    check('...with an Edit action that opens the authoring page for THIS product',
      !!q(dom, '#pr-doc-link') && q(dom, '#pr-doc-link').getAttribute('href') ===
        'admin-fund-document.html?product=' + encodeURIComponent(appraisal.id));
    q(dom, '#pr-close').click();

    console.log('\n=== PART 8: retire, never delete — through the real UI ===\n');
    const retireId = 'PROD-TEST-RET-' + SUF.toUpperCase();
    createdProducts.push(retireId);
    await must(admin.from('products').insert({
      id: retireId, name: 'Retirement Test Fund ' + SUF, asset_class: 'Private Equity',
      investment_type: 'Growth Fund', risk_tier: 'balanced', minimum_investment: 1000,
      unit_price: 400, inception_unit_price: 400, pricing_model: 'appraisal',
      status: 'active', last_tick_date: '2026-06-30'
    }), 'seed the retirement test product');

    const dom2 = buildDom(D, st.API_URL);
    check('GUARD: the page rendered with the test product present', await ready(dom2));
    const s2 = dom2.window.document.getElementById('pr-search');
    typeInto(dom2, s2, 'Retirement Test Fund');
    const tRow = rows(dom2).filter((r) => r.dataset.id === retireId)[0];
    check('GUARD: the test product is on screen', !!tRow);
    tRow.click();
    q(dom2, '#pr-retire').click();
    const warn = txt(q(dom2, '.pr-note'));
    check('★ the warning states what retiring ACTUALLY does — kept, priced, sellable, no new allocation',
      /stays in the catalogue/i.test(warn) && /keeps being priced/i.test(warn) &&
      /no new allocation/i.test(warn) && /Nothing is deleted/i.test(warn), warn.slice(0, 140));
    q(dom2, '#pr-retire-submit').click();
    check('★ a retirement with no reason is refused before it reaches the server',
      await pollUntil(() => /reason is required/i.test(txt(q(dom2, '#pr-retire-err'))), 3000),
      txt(q(dom2, '#pr-retire-err')));
    const { data: stillActive } = await admin.from('products').select('status').eq('id', retireId).single();
    check('...and the product is provably untouched', stillActive.status === 'active', stillActive.status);

    q(dom2, '#pr-retire-reason').value = 'Fund closed to new subscriptions — ' + SUF;
    q(dom2, '#pr-retire-submit').click();
    const retired = await pollRow(
      () => admin.from('products').select('status, retired_by_email, retired_reason').eq('id', retireId).single(),
      (d) => d.status === 'retired');
    check('★ a real retirement lands in Postgres', !!retired, 'still active');
    check('...recorded against the real PM who did it',
      !!retired && retired.retired_by_email === 'pm@marketswave.local', retired && String(retired.retired_by_email));
    check('...with the reason they gave',
      !!retired && /Fund closed to new subscriptions/.test(String(retired.retired_reason)), retired && String(retired.retired_reason));
    check('the panel closed and the PM was told what it means for holders',
      q(dom2, '#pr-scrim').classList.contains('hidden') &&
      /retired/i.test(txt(q(dom2, '#pr-toast'))), txt(q(dom2, '#pr-toast')));

    await pollUntil(() => rows(dom2).length > 0);
    typeInto(dom2, dom2.window.document.getElementById('pr-search'), 'Retirement Test Fund');
    check('★ it is gone from the default view but still in the catalogue under Retired',
      rows(dom2).filter((r) => r.dataset.id === retireId).length === 0 &&
      pillCount(dom2, 'retired') >= 1, 'retired pill: ' + pillCount(dom2, 'retired'));
    pill(dom2, 'retired').click();
    const rRow = rows(dom2).filter((r) => r.dataset.id === retireId)[0];
    check('the retired row says plainly that it takes no new allocations',
      !!rRow && /no new allocations/.test(txt(rRow.querySelector('.pr-meta'))), rRow && txt(rRow.querySelector('.pr-meta')));
    // ★ The dimmed row is the risk row 233 already found once at 2.59:1 — the chrome may dim,
    // the WORDS may not. The composited proof is the visual suite's; this is the structural half.
    check('★ the retired row is marked by a class, never by dimming its own text',
      !!rRow && rRow.classList.contains('is-retired') && !/opacity/.test(rRow.getAttribute('style') || ''));

    rRow.click();
    q(dom2, '#pr-retire').click();
    q(dom2, '#pr-retire-reason').value = 'Reopened — ' + SUF;
    q(dom2, '#pr-retire-submit').click();
    const back = await pollRow(
      () => admin.from('products').select('status, retired_at').eq('id', retireId).single(),
      (d) => d.status === 'active');
    check('★ reinstating through the same control puts it back', !!back, 'still retired');
    check('...and clears the retirement stamp with it', !!back && back.retired_at === null, back && String(back.retired_at));

    console.log('\n=== PART 9: ★ a percentage publication, cross-checked against the impact shown before ===\n');
    const navId = 'PROD-TEST-NAV-' + SUF.toUpperCase();
    createdProducts.push(navId);
    await must(admin.from('products').insert({
      id: navId, name: 'Impact Test Fund ' + SUF, asset_class: 'Real Assets',
      investment_type: 'Growth Fund', risk_tier: 'balanced', minimum_investment: 1000,
      unit_price: 200, inception_unit_price: 200, pricing_model: 'appraisal',
      status: 'active', last_tick_date: '2026-06-30'
    }), 'seed the impact test product');

    const email = 'prodpage-holder-' + SUF + '@invalid.test';
    const { data: hu, error: huErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (huErr) throw huErr;
    holders.push(hu.user.id);
    await must(admin.from('clients').insert({
      id: hu.user.id, name: 'Impact Holder ' + SUF, email, phone: '+46 70 333 3333',
      account_type: 'Individual Account', status: 'active'
    }), 'seed the holder');
    await must(admin.from('account_state').insert({ client_id: hu.user.id, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 }), 'seed account state');
    await must(admin.from('holdings').insert({ client_id: hu.user.id, product_id: navId, units: 50, cost_basis: 10000 }), 'seed the holding');

    const dom3 = buildDom(D, st.API_URL);
    check('GUARD: the page rendered with the held test fund present', await ready(dom3));
    typeInto(dom3, dom3.window.document.getElementById('pr-search'), 'Impact Test Fund');
    const nRow = rows(dom3).filter((r) => r.dataset.id === navId)[0];
    check('★ the holder count and total value read straight off the row',
      !!nRow && txt(nRow.querySelector('.pr-hold b')) === '1' && digits(txt(nRow.querySelector('.pr-hold span'))) === 10000,
      nRow && txt(nRow.querySelector('.pr-hold')));
    nRow.click();
    check('the detail panel names the holder, not just a count',
      /Impact Holder/.test(txt(q(dom3, '#pr-panel'))) && /50(\.00)? units/.test(txt(q(dom3, '.pr-holder'))),
      txt(q(dom3, '.pr-holder')));

    typeInto(dom3, q(dom3, '#pr-nav-pct'), '10');
    const impactHead = txt(q(dom3, '#pr-impact-h'));
    const impactRow = q(dom3, '.pr-impact-row');
    check('★ the impact table shows the new unit price before anything is published',
      /New unit price \$220\.00/.test(impactHead) && /1 client holding/.test(impactHead), impactHead);
    const impactTo = digits(txt(impactRow.querySelector('.to')));
    const impactDelta = txt(impactRow.querySelector('.dl'));
    check('★ ...and what it does to this holder: $10,000 → $11,000, +$1,000',
      impactTo === 11000 && /\+\$1,000/.test(impactDelta), impactTo + ' / ' + impactDelta);

    q(dom3, '#pr-publish').click();
    const published = await pollRow(
      () => admin.from('products').select('unit_price').eq('id', navId).single(),
      (d) => Number(d.unit_price) === 220);
    check('★ the publication moved the real unit price to the previewed figure', !!published,
      published ? '' : 'unit_price never reached 220');

    // ★ THE ADDENDUM'S OWN QUESTION: are the holder's figures DERIVED after publishing, or read
    // from a cached column the publication never invalidated? Read through the REAL path a
    // client page uses — never the stored column directly.
    // get-holdings returns the shaped ARRAY itself, not an envelope.
    const holdingsRead = await D.callFunction('get-holdings', { clientId: hu.user.id });
    const held = (Array.isArray(holdingsRead) ? holdingsRead : holdingsRead.holdings || [])
      .filter((h) => h.productId === navId)[0];
    check('★ the holder\'s value, read through get-holdings, is $11,000 — derived, not cached',
      !!held && Math.abs(held.units * 220 - 11000) < 0.01 && Math.abs(held.costBasis - 10000) < 0.01,
      held && JSON.stringify(held));
    const tpv = await D.callFunction('get-total-portfolio-value', { clientId: hu.user.id });
    check('★ ...and their total portfolio value moved by exactly the impact table\'s own figure',
      Math.abs(tpv.totalPortfolioValue - (5000 + 11000)) < 0.01, String(tpv.totalPortfolioValue));

    console.log('\n=== PART 10: the create flow — the model first, the duplicate at search time ===\n');
    q(dom3, '#pr-add-open').click();
    check('the pricing model is chosen first, as a real radiogroup',
      !!q(dom3, '.pr-seg') && q(dom3, '.pr-seg').getAttribute('role') === 'radiogroup');
    check('★ ...and the panel says plainly it cannot be changed afterwards',
      /Permanent once created/i.test(txt(q(dom3, '.pr-lock'))), txt(q(dom3, '.pr-lock')));
    check('the market path asks for a symbol, never an asset class',
      !!q(dom3, '#pr-symbol') && q(dom3, '#pr-class').hasAttribute('readonly'));
    check('...and says the class is derived from the symbol and locked',
      /derived from the symbol/i.test(txt(q(dom3, '#pr-panel'))));

    typeInto(dom3, q(dom3, '#pr-symbol'), 'AAPL');
    check('GUARD: the symbol search returned results',
      await pollUntil(() => dom3.window.document.querySelectorAll('.pr-res').length > 0, 25000),
      'no .pr-res appeared');
    const results = [...dom3.window.document.querySelectorAll('.pr-res')];
    const dupe = results.filter((r) => r.dataset.symbol === 'AAPL')[0];
    check('★★ a symbol ALREADY IN THE CATALOGUE is flagged at SEARCH time, not after a 409',
      !!dupe && dupe.disabled === true && dupe.getAttribute('aria-disabled') === 'true' &&
      /In catalogue/.test(txt(dupe)), dupe ? txt(dupe) : 'AAPL not in results');
    dupe.click();
    check('...and it is unselectable — clicking it picks nothing',
      !q(dom3, '#pr-prev') || q(dom3, '#pr-prev').hidden === true);
    const free = results.filter((r) => !r.disabled)[0];
    check('a symbol NOT in the catalogue is offered normally', !!free,
      results.map((r) => r.dataset.symbol).join(','));

    q(dom3, '[data-model="appraisal"]').click();
    check('★ the appraisal path asks for no symbol at all',
      !q(dom3, '#pr-symbol') && !!q(dom3, '#pr-unit-price'));
    check('...it asks for a fund name, class, opening unit price and a minimum',
      !!q(dom3, '#pr-name') && q(dom3, '#pr-class').tagName === 'SELECT' && !!q(dom3, '#pr-min'));
    check('★ the submit reads "Create & write document" — the document is the second act',
      /Create & write document/.test(txt(q(dom3, '#pr-create-submit'))), txt(q(dom3, '#pr-create-submit')));
    check('...and the panel says where valuation frequency and horizon actually live',
      /Valuation frequency and expected horizon live in its Terms section/.test(txt(q(dom3, '#pr-panel'))));
    q(dom3, '#pr-create-cancel').click();

    console.log('\n=== PART 11: a failed quote is FLAGGED, and the last good price is kept ===\n');
    // ★ Ported from verify-live-pricing-ui-wiring's own PART A, which drove the page this one
    // replaced. A provider that answers HTTP 200 with {"c":0} is how Finnhub says "no such
    // symbol" — writing that through as a price would show every holder $0.00, so the refresh
    // keeps the last good figure and flags the row instead. The PM has to be able to SEE that.
    await must(admin.from('products').insert({
      id: badId, name: 'Quote Failed Fund ' + SUF, asset_class: 'Stocks & ETFs',
      investment_type: 'ETF', risk_tier: 'balanced', minimum_investment: 100,
      unit_price: 42.42, inception_unit_price: 42.42, pricing_model: 'market',
      ticker: 'ZQ' + SUF.slice(0, 4).toUpperCase(), price_source: 'finnhub',
      price_as_of: new Date(Date.now() - 3600e3).toISOString(),
      price_status: 'quote_failed',
      price_failure_reason: 'The provider returned no usable price on the last refresh. The last known good price is retained.',
      price_last_failed_at: new Date().toISOString(), last_tick_date: '2026-09-11'
    }), 'seed the quote-failed product');
    createdProducts.push(badId);

    const dom4 = buildDom(D, st.API_URL);
    check('GUARD: the page rendered with the flagged product present', await ready(dom4));
    const s4 = dom4.window.document.getElementById('pr-search');
    typeInto(dom4, s4, 'Quote Failed Fund');
    const bRow = rows(dom4).filter((r) => r.dataset.id === badId)[0];
    check('★ the failed quote is flagged in the ROW, not only in the panel',
      !!bRow && /Quote failed/.test(txt(bRow.querySelector('.pr-src'))), bRow && txt(bRow.querySelector('.pr-src')));
    check('★ ...and the row still shows the last good price, never $0.00',
      !!bRow && /\$42\.42/.test(txt(bRow.querySelector('.pr-px-cell'))) && /last good/.test(txt(bRow.querySelector('.pr-px-cell'))),
      bRow && txt(bRow.querySelector('.pr-px-cell')));
    bRow.click();
    const badNote = txt(q(dom4, '.pr-note.is-bad'));
    check('★ the panel explains it to the PM in the provider\'s own words',
      /last good price is retained/i.test(badNote) && /not overwritten with a zero/i.test(badNote) &&
      /returned no usable price/i.test(badNote), badNote.slice(0, 160));
    q(dom4, '#pr-close').click();

    const healthCards = [...dom4.window.document.querySelectorAll('.pr-hc')];
    healthCards[2].click();
    check('★ the "Quote failed" health card filters to exactly the flagged products',
      rows(dom4).length >= 1 && rows(dom4).every((r) => /Quote failed/.test(txt(r.querySelector('.pr-src')))),
      rows(dom4).length + ' rows');
    dom4.window.document.querySelectorAll('.pr-hc')[2].click();

    console.log('\n=== PART 12: creating a market-priced product, end to end ===\n');
    // ADI is a real, priced Finnhub symbol that the seeded catalogue does not offer — the
    // established free fixture for this path (register rows 212 / 215). The product created
    // here is deleted in the teardown below.
    q(dom4, '#pr-add-open').click();
    typeInto(dom4, q(dom4, '#pr-symbol'), 'adi');
    check('GUARD: the symbol search returned results for ADI',
      await pollUntil(() => dom4.window.document.querySelectorAll('.pr-res').length > 0, 25000),
      'no .pr-res appeared');
    const adi = [...dom4.window.document.querySelectorAll('.pr-res')]
      .filter((r) => r.dataset.symbol === 'ADI' && r.dataset.source === 'finnhub')[0];
    check('the result carries a live price', !!adi && /\$\d/.test(txt(adi)), adi && txt(adi));
    // ★ Finnhub's free tier returns {} from profile2 for many listings, so the exchange is
    // reported honestly or not at all — never a confident label over nothing.
    check('★ ...and an unverified exchange reads as a VISIBLE fallback, never a confident label',
      !!adi && (!/unverified/.test(txt(adi)) || /US listing/.test(txt(adi))), adi && txt(adi));
    adi.click();
    check('picking it previews the real symbol, its cadence and its price',
      await pollUntil(() => /Price will track ADI/.test(txt(q(dom4, '#pr-prev-l'))), 25000),
      txt(q(dom4, '#pr-prev-l')));
    const prevL = txt(q(dom4, '#pr-prev-l'));
    check('★ the preview states the real refresh cadence, not a guess',
      /refreshed by the 5-minute scheduler, in rotation/.test(prevL), prevL);
    check('★ ...and the asset class is DERIVED from the symbol and locked',
      q(dom4, '#pr-class').value === 'Stocks & ETFs' && q(dom4, '#pr-class').hasAttribute('readonly'),
      q(dom4, '#pr-class').value);
    q(dom4, '#pr-name').value = 'Analog Devices UI Test ' + SUF;
    q(dom4, '#pr-type').value = 'Stock';
    q(dom4, '#pr-min').value = '500';
    q(dom4, '#pr-max').value = '20000';
    q(dom4, '#pr-desc').value = 'Direct exposure to Analog Devices.';
    q(dom4, '#pr-create-submit').click();
    const madeRow = await pollRow(
      () => admin.from('products').select('*').eq('name', 'Analog Devices UI Test ' + SUF).maybeSingle(),
      (d) => !!d && !!d.id, 30000);
    check('★ Create product succeeds through the real UI', !!madeRow, 'no row appeared');
    if (madeRow) createdProducts.push(madeRow.id);
    check('★ ...the real row: market model, ADI on Finnhub, class derived, a live price, the max recorded',
      !!madeRow && madeRow.pricing_model === 'market' && madeRow.ticker === 'ADI' &&
      madeRow.price_source === 'finnhub' && madeRow.asset_class === 'Stocks & ETFs' &&
      Number(madeRow.unit_price) > 1 && Number(madeRow.maximum_investment) === 20000,
      JSON.stringify(madeRow && { m: madeRow.pricing_model, t: madeRow.ticker, c: madeRow.asset_class, p: madeRow.unit_price }));

    console.log('\n=== PART 13: Edit details — and what the form refuses to offer ===\n');
    const dom5 = buildDom(D, st.API_URL);
    check('GUARD: the page rendered for the edit round trip', await ready(dom5));
    typeInto(dom5, dom5.window.document.getElementById('pr-search'), 'Analog Devices UI Test');
    const mRow = rows(dom5).filter((r) => r.dataset.id === (madeRow && madeRow.id))[0];
    check('GUARD: the created product is on screen', !!mRow);
    mRow.click();
    check('the detail panel offers Edit details', !!q(dom5, '#pr-edit'));
    q(dom5, '#pr-edit').click();
    // ★ THE ABSENCES ARE THE ASSERTION. A price moves via the feed or a published valuation,
    // never a form; a remapped symbol would silently re-price every holder.
    check('★ the edit form offers NO unit-price input — the price is stated read-only',
      !q(dom5, 'input#pr-unit-price') && !!q(dom5, '#pr-e-price') && /not editable here/.test(txt(q(dom5, '#pr-e-price'))),
      txt(q(dom5, '#pr-e-price')));
    check('★ ...NO symbol input, and the symbol is shown as permanent',
      !q(dom5, '#pr-symbol') && /permanent/.test(txt(q(dom5, '#pr-panel'))));
    check('★ ...and the asset class is LOCKED for a market-priced product',
      !!q(dom5, '#pr-e-class') && q(dom5, '#pr-e-class').hasAttribute('readonly') &&
      q(dom5, '#pr-e-class').value === 'Stocks & ETFs', q(dom5, '#pr-e-class').value);
    check('the form is pre-filled with the real current values',
      q(dom5, '#pr-e-name').value === 'Analog Devices UI Test ' + SUF &&
      Number(q(dom5, '#pr-e-min').value) === 500 && Number(q(dom5, '#pr-e-max').value) === 20000,
      q(dom5, '#pr-e-name').value);
    q(dom5, '#pr-edit-save').click();
    check('★ saving with nothing changed is refused rather than writing an empty patch',
      await pollUntil(() => /Nothing changed/i.test(txt(q(dom5, '#pr-edit-err'))), 3000),
      txt(q(dom5, '#pr-edit-err')));

    const priceBefore = Number(madeRow.unit_price);
    q(dom5, '#pr-e-min').value = '750';
    q(dom5, '#pr-e-desc').value = 'Edited through the real UI — ' + SUF;
    q(dom5, '#pr-edit-save').click();
    const edited = await pollRow(
      () => admin.from('products').select('*').eq('id', madeRow.id).single(),
      (d) => Number(d.minimum_investment) === 750);
    check('★ a real edit lands in Postgres', !!edited, 'minimum never reached 750');
    check('...and the description went with it',
      !!edited && edited.description === 'Edited through the real UI — ' + SUF, edited && edited.description);
    check('★★ the unit price is COMPLETELY UNCHANGED by the edit — the rule re-confirmed enforced',
      !!edited && Math.abs(Number(edited.unit_price) - priceBefore) < 1e-9,
      edited && (edited.unit_price + ' vs ' + priceBefore));
    check('...and so are the symbol and the pricing model',
      !!edited && edited.ticker === 'ADI' && edited.pricing_model === 'market');

    // An appraisal-valued product CAN be reclassified — it is a real choice between the two
    // carved-out classes, and edit-product enforces exactly that pair.
    typeInto(dom5, dom5.window.document.getElementById('pr-search'), 'Retirement Test Fund');
    const aRow = rows(dom5).filter((r) => r.dataset.id === retireId)[0];
    check('GUARD: the appraisal test product is on screen', !!aRow);
    aRow.click();
    q(dom5, '#pr-edit').click();
    check('★ an appraisal-valued product\'s class IS editable — and only between PE and Real Assets',
      q(dom5, '#pr-e-class').tagName === 'SELECT' &&
      [...q(dom5, '#pr-e-class').options].map((o) => o.value).join('|') === 'Private Equity|Real Assets',
      [...q(dom5, '#pr-e-class').options].map((o) => o.value).join('|'));
    q(dom5, '#pr-e-class').value = 'Real Assets';
    q(dom5, '#pr-edit-save').click();
    const reclassed = await pollRow(
      () => admin.from('products').select('asset_class, unit_price').eq('id', retireId).single(),
      (d) => d.asset_class === 'Real Assets');
    check('★ reclassifying an appraisal product through the real UI lands', !!reclassed, 'class never changed');
    check('...with its price untouched', !!reclassed && Math.abs(Number(reclassed.unit_price) - 400) < 1e-9,
      reclassed && String(reclassed.unit_price));

  } finally {
    // ---- cleanup. THE ORDER IS THE WHOLE POINT: holdings/account_state reference BOTH the
    // client and the product, and holdings.product_id has no cascade (register row 178), so the
    // CLIENT goes before the products. No PM is created here, so nothing follows them.
    for (const id of holders) {
      await admin.from('holdings').delete().eq('client_id', id);
      await admin.from('account_state').delete().eq('client_id', id);
      await admin.from('portfolio_value_snapshots').delete().eq('client_id', id);
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const id of createdProducts) {
      await admin.from('nav_publications').delete().eq('product_id', id);
      await admin.from('products').delete().eq('id', id);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('PRODUCTS PAGE UI: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 900000 });
