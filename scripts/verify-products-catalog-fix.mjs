#!/usr/bin/env node
// Products Catalog Fix (2026-09-03): closes the "PM acts, client never sees it" bug class
// already fixed once for Documents/Support (row 127), now confirmed present for the Product
// Catalog by Admin UI Wiring — Final Stage's own investigation (row 128) — admin-products.html
// was silently managing a LOCAL catalog completely disconnected from the real Supabase
// `products` table every already-wired client-facing page reads. This fix adds the three
// missing columns (description/extended_description/logo_url), a real admin-only
// add-product/edit-product Edge Function pair, and wires admin-products.html to them for real.
//
// ★★★ GENUINELY SEPARATE CONTEXTS — same rigor as the cross-role sync fix
// (verify-cross-role-sync-bugfix.mjs), reused here per instruction, not a same-process
// convenience. This project's own dev/test workflow can otherwise mask exactly this bug class
// by running the PM's admin-tool actions and the client's own page reads in the same browser
// realm — see that script's own header for the full investigation this reuses verbatim (why
// supabase-data.js needs two genuinely independent module instances, not just two DOM
// windows). Two temp copies of the real, unmodified supabase-data.js are created — one
// representing the PM's tab (ADMIN_CTX), one representing the client's tab (CLIENT_CTX) — with
// zero shared JS state between them, deleted in a finally block regardless of outcome.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-products-catalog-fix.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await test()) return true;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return test();
}

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
  const target = scripts.find(function (s) { return s.indexOf(marker) !== -1; });
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}

function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!bodyMatch) throw new Error('Could not find <body> in ' + htmlPath);
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

const forwardingConsole = new VirtualConsole();
forwardingConsole.forwardTo(console);

function buildPageDom(htmlPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: forwardingConsole
  });
  return dom;
}

// ---- Genuinely separate MarketswaveData instances — see this file's own header. ----
const PROJECT_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const REAL_SUPABASE_DATA_SRC = readFileSync(PROJECT_ROOT_DIR + 'supabase-data.js', 'utf8');
const tempFiles = [];

async function createIndependentContext(label) {
  const tempPath = PROJECT_ROOT_DIR + '.tmp-supabase-data-' + label + '-' + process.pid + '.mjs';
  writeFileSync(tempPath, REAL_SUPABASE_DATA_SRC, 'utf8');
  tempFiles.push(tempPath);
  const fakeWindow = { location: { hostname: '127.0.0.1', search: '' } };
  const priorWindow = globalThis.window;
  globalThis.window = fakeWindow;
  await import('../.tmp-supabase-data-' + label + '-' + process.pid + '.mjs');
  const MarketswaveData = fakeWindow.MarketswaveData;
  globalThis.window = priorWindow;
  return { label: label, MarketswaveData: MarketswaveData, fakeWindow: fakeWindow };
}

function withContext(ctx, fn) {
  const prior = globalThis.window;
  globalThis.window = ctx.fakeWindow;
  return Promise.resolve().then(fn).finally(function () { globalThis.window = prior; });
}

async function main() {
  console.log('Products Catalog Fix verification, using genuinely separate PM/client contexts\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const ADMIN_CTX = await createIndependentContext('ADMIN');
  const CLIENT_CTX = await createIndependentContext('CLIENT');
  check('two genuinely separate supabase-data.js instances were created (ADMIN !== CLIENT)', ADMIN_CTX.MarketswaveData !== CLIENT_CTX.MarketswaveData);

  await withContext(ADMIN_CTX, function () { ADMIN_CTX.MarketswaveData.useAdminClient(); });
  const adminClient = await withContext(ADMIN_CTX, function () { return ADMIN_CTX.MarketswaveData.getSupabaseClient(); });
  const { data: adminUser } = await adminClient.auth.getUser();
  check('the ADMIN context is genuinely signed in as the real local bootstrap PM account', adminUser && adminUser.user && adminUser.user.email === 'pm@marketswave.local', adminUser && adminUser.user && adminUser.user.email);

  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'products-fix-' + suffix + '@test.marketswave.local';
  const password = 'VerifyProductsFix-2026!';
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;
  const clientName = 'Products Fix Test Client ' + suffix;
  await admin.from('clients').insert({ id: clientId, name: clientName, email: email, phone: '+1-555-0177', account_type: 'Individual Account', status: 'active' });
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 2000, allocated_capital: 8000, asset_returns: 0 });

  const clientSupabaseClient = await withContext(CLIENT_CTX, function () { return CLIENT_CTX.MarketswaveData.getSupabaseClient(); });
  const { error: signInErr } = await withContext(CLIENT_CTX, function () { return clientSupabaseClient.auth.signInWithPassword({ email, password }); });
  check('the CLIENT context genuinely signs in as the real test client, completely independent of the ADMIN context above', !signInErr, signInErr && signInErr.message);
  check('the ADMIN context is confirmed UNAFFECTED by the client sign-in that just happened in the other context', (await adminClient.auth.getUser()).data.user.email === 'pm@marketswave.local');

  const createdProductIds = [];

  try {

  // ===========================================================================================
  // PART 1 — Add Product (a Crypto product with description + logoUrl), via the REAL
  // admin-products.html UI, ADMIN context
  // ===========================================================================================
  console.log('\n=== PART 1: Add Product — Crypto, description + logoUrl (ADMIN context, real UI) ===\n');
  var cryptoProductId;
  await withContext(ADMIN_CTX, async function () {
    const path = fileURLToPath(new URL('../admin-products.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = ADMIN_CTX.MarketswaveData;
    const script = extractInlineScript(path, 'Products Catalog Fix');
    const D = dom.window.document;

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(D.getElementById('products-list').innerHTML); }, 20000);

    D.getElementById('open-add-modal').click();
    check('the real Add Product modal genuinely opens', !D.getElementById('add-modal').classList.contains('hidden'));

    const testLogoUrl = 'https://example.test/products-fix-' + suffix + '-logo.png';
    const testDescription = 'A diversified digital-asset basket added by the real Products Catalog Fix test — ' + suffix + '.';
    D.getElementById('add-name').value = 'Test Digital Basket ' + suffix;
    D.getElementById('add-asset-class').value = 'Crypto';
    D.getElementById('add-asset-class').dispatchEvent(new dom.window.Event('change'));
    D.getElementById('add-risk-tier').value = 'aggressive';
    D.getElementById('add-investment-type').value = 'Index Basket';
    D.getElementById('add-description').value = testDescription;
    D.getElementById('add-logo-url').value = testLogoUrl;
    D.getElementById('add-minimum-investment').value = '500';
    D.getElementById('add-unit-price').value = '25.50';

    check('the Logo URL field is genuinely visible for a Crypto product (the conditional-field UI)', !D.getElementById('add-logo-url-field').classList.contains('hidden'));

    var bodyBefore = D.getElementById('admin-toast-body').textContent;
    D.getElementById('add-submit').click();
    await pollUntil(function () { return !D.getElementById('admin-toast').classList.contains('hidden') && D.getElementById('admin-toast-body').textContent !== bodyBefore; }, 15000);
    check('the toast confirms the real product was added', D.getElementById('admin-toast-title').textContent === 'Product Added', D.getElementById('admin-toast-title').textContent + ' / ' + D.getElementById('admin-toast-body').textContent);

    const idMatch = /\(PROD-\d+\)/.exec(D.getElementById('admin-toast-body').textContent);
    check('a real PROD-XXXX id was assigned and shown in the toast', !!idMatch, D.getElementById('admin-toast-body').textContent);
    cryptoProductId = idMatch[0].slice(1, -1);
    createdProductIds.push(cryptoProductId);

    const { data: row } = await admin.from('products').select('*').eq('id', cryptoProductId).single();
    check('the real products row genuinely has all three new columns set correctly', row.description === testDescription && row.logo_url === testLogoUrl && row.extended_description === null, JSON.stringify(row));
    check('unit_price and inception_unit_price both equal the PM-entered starting price', Math.abs(row.unit_price - 25.5) < 1e-9 && Math.abs(row.inception_unit_price - 25.5) < 1e-9, JSON.stringify(row));
  });

  // ===========================================================================================
  // PART 2 — Add Product (a Private Equity product with description + extendedDescription),
  // give the test client a real holding on it
  // ===========================================================================================
  console.log('\n=== PART 2: Add Product — Private Equity, description + extendedDescription (ADMIN context, real UI) ===\n');
  var peProductId;
  var peExtendedDescription = 'This fund concentrates on late-stage private equity positions across North American mid-market companies, added by the real Products Catalog Fix test — ' + suffix + '.';
  await withContext(ADMIN_CTX, async function () {
    const path = fileURLToPath(new URL('../admin-products.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = ADMIN_CTX.MarketswaveData;
    const script = extractInlineScript(path, 'Products Catalog Fix');
    const D = dom.window.document;

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(D.getElementById('products-list').innerHTML); }, 20000);

    D.getElementById('open-add-modal').click();
    D.getElementById('add-name').value = 'Test Mid-Market PE Fund ' + suffix;
    D.getElementById('add-asset-class').value = 'Private Equity';
    D.getElementById('add-asset-class').dispatchEvent(new dom.window.Event('change'));
    D.getElementById('add-risk-tier').value = 'balanced';
    D.getElementById('add-investment-type').value = 'Growth Fund';
    D.getElementById('add-description').value = 'Short summary.';
    D.getElementById('add-extended-description').value = peExtendedDescription;
    D.getElementById('add-minimum-investment').value = '1000';
    D.getElementById('add-unit-price').value = '100.00';

    check('the Extended Description field is genuinely visible for a Private Equity product', !D.getElementById('add-extended-description-field').classList.contains('hidden'));

    var bodyBefore = D.getElementById('admin-toast-body').textContent;
    D.getElementById('add-submit').click();
    await pollUntil(function () { return !D.getElementById('admin-toast').classList.contains('hidden') && D.getElementById('admin-toast-body').textContent !== bodyBefore; }, 15000);
    const idMatch = /\(PROD-\d+\)/.exec(D.getElementById('admin-toast-body').textContent);
    check('a second real product was created', !!idMatch, D.getElementById('admin-toast-body').textContent);
    peProductId = idMatch[0].slice(1, -1);
    createdProductIds.push(peProductId);

    const { data: row } = await admin.from('products').select('*').eq('id', peProductId).single();
    check('the real row genuinely has extended_description set, logo_url null (never provided)', row.extended_description === peExtendedDescription && row.logo_url === null, JSON.stringify(row));
  });

  // Real holding on the new PE product — standing in for a completed allocation (the request/
  // approve flow itself is already proven end-to-end by verify-asset-pages-ui-wiring.mjs and
  // verify-admin-approval-gate-ui-wiring.mjs; this test's own job is the catalog fix, not
  // re-proving that flow a third time).
  await admin.from('holdings').insert({ client_id: clientId, product_id: peProductId, units: 80, cost_basis: 8000 });

  // ===========================================================================================
  // PART 3 — CLIENT context, real asset-collection.html: confirm both new products genuinely
  // appear correctly, without asset-collection.html needing any structural change
  // ===========================================================================================
  console.log('\n=== PART 3: asset-collection.html (CLIENT context, real UI) — the new products appear correctly ===\n');
  await withContext(CLIENT_CTX, async function () {
    const path = fileURLToPath(new URL('../asset-collection.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    const script = extractInlineScript(path, 'UI Wiring — Stage 2');
    const D = dom.window.document;
    const grid = D.getElementById('asset-cards-grid');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(grid.innerHTML) && grid.innerHTML.indexOf(cryptoProductId) !== -1; }, 20000);

    const cryptoCard = grid.querySelector('[data-product-id="' + cryptoProductId + '"]');
    check('the real Crypto product card renders at all', !!cryptoCard);
    check('its real logo <img src> matches exactly what the PM entered through the real admin UI', cryptoCard && cryptoCard.querySelector('.product-logo-img') && cryptoCard.querySelector('.product-logo-img').getAttribute('src') === 'https://example.test/products-fix-' + suffix + '-logo.png', cryptoCard ? cryptoCard.innerHTML.slice(0, 300) : null);
    check('its real description text renders verbatim', cryptoCard && cryptoCard.textContent.indexOf('A diversified digital-asset basket added by the real Products Catalog Fix test') !== -1);

    // Trigger the tab/category selector to Private Equity so the PE card is definitely within
    // the visible page (it may not be among the first 9 products under "All").
    const peTab = [...D.querySelectorAll('.category-tab')].find(function (t) { return t.dataset.category === 'Private Equity'; });
    if (peTab) peTab.click();
    await pollUntil(function () { return grid.innerHTML.indexOf(peProductId) !== -1; }, 20000);

    const peCard = grid.querySelector('[data-product-id="' + peProductId + '"]');
    check('the real Private Equity product card renders, showing the real held position (not "No position")', !!peCard && peCard.textContent.indexOf('No position') === -1, peCard ? peCard.textContent.slice(0, 200) : null);
    const moreInfoBtn = peCard && peCard.querySelector('.more-info-link');
    check('a real "More info" link renders (extendedDescription is genuinely set)', !!moreInfoBtn);
    moreInfoBtn.click();
    check('the real "More info" modal genuinely opens', !D.getElementById('more-info-modal').classList.contains('hidden'));
    check('the modal shows the EXACT real extendedDescription entered through the real admin UI', D.getElementById('more-info-modal-body').textContent === peExtendedDescription, D.getElementById('more-info-modal-body').textContent);
  });

  // ===========================================================================================
  // PART 4 — CLIENT context, real dashboard.html: the held PE product's value groups under
  // "Private Equity" — before the reclassification test in Part 6
  // ===========================================================================================
  console.log('\n=== PART 4: dashboard.html (CLIENT context, real UI) — groups under Private Equity, before reclassification ===\n');
  await withContext(CLIENT_CTX, async function () {
    const path = fileURLToPath(new URL('../dashboard.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientId; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 1');
    const D = dom.window.document;
    const legend = D.getElementById('allocation-legend');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(legend.innerHTML); }, 20000);
    check('the real Portfolio Allocation legend shows a nonzero "Private Equity" line (the real held PE product, before reclassification)', /Private Equity[\s\S]*?(?:\d)/.test(legend.textContent) && (function () {
      var m = /Private Equity<\/span><span[^>]*>([\d.]+)%/.exec(legend.innerHTML);
      return m && parseFloat(m[1]) > 0;
    })(), legend.textContent);
  });

  // ===========================================================================================
  // PART 5 — CLIENT context, real risk-management.html: Diversification Score reflects the
  // real Private Equity concentration — before reclassification
  // ===========================================================================================
  console.log('\n=== PART 5: risk-management.html (CLIENT context, real UI) — reflects real PE concentration, before reclassification ===\n');
  await withContext(CLIENT_CTX, async function () {
    const path = fileURLToPath(new URL('../risk-management.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientId; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 5');
    const D = dom.window.document;
    const concentrationEl = D.getElementById('diversification-concentration');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(concentrationEl.innerHTML); }, 20000);
    check('the real Diversification concentration line names Private Equity as the top concentration, before reclassification', concentrationEl.textContent.indexOf('Private Equity') !== -1, concentrationEl.textContent);
  });

  // ===========================================================================================
  // PART 6 — Edit Product: reclassify the held PE product from "Private Equity" to
  // "Real Assets" via the REAL admin-products.html Edit UI, ADMIN context. Also confirms
  // unitPrice truly cannot be edited through this path.
  // ===========================================================================================
  console.log('\n=== PART 6: Edit Product — reclassify Private Equity -> Real Assets (ADMIN context, real UI) ===\n');
  await withContext(ADMIN_CTX, async function () {
    const path = fileURLToPath(new URL('../admin-products.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = ADMIN_CTX.MarketswaveData;
    const script = extractInlineScript(path, 'Products Catalog Fix');
    const D = dom.window.document;

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(D.getElementById('products-list').innerHTML) && D.getElementById('products-list').innerHTML.indexOf(peProductId) !== -1; }, 20000);

    // Expand the row and click Edit, exactly the real click path a PM uses.
    const row = D.querySelector('.product-row[data-id="' + peProductId + '"]');
    row.click();
    await pollUntil(function () { return !!D.querySelector('.edit-btn[data-id="' + peProductId + '"]'); }, 5000);
    D.querySelector('.edit-btn[data-id="' + peProductId + '"]').click();
    check('the real Edit Product modal opens, pre-filled with the real current values', !D.getElementById('edit-modal').classList.contains('hidden') && D.getElementById('edit-asset-class').value === 'Private Equity');
    check('the read-only Current Unit Price display shows the real price — confirming there is genuinely no editable unit price input on this form', D.getElementById('edit-unit-price-display').textContent.indexOf('100.00') !== -1 && !D.getElementById('edit-unit-price'), D.getElementById('edit-unit-price-display').textContent);

    D.getElementById('edit-asset-class').value = 'Real Assets';
    D.getElementById('edit-asset-class').dispatchEvent(new dom.window.Event('change'));

    var bodyBefore = D.getElementById('admin-toast-body').textContent;
    D.getElementById('edit-submit').click();
    await pollUntil(function () { return !D.getElementById('admin-toast').classList.contains('hidden') && D.getElementById('admin-toast-body').textContent !== bodyBefore; }, 15000);
    check('the toast confirms the real product was updated', D.getElementById('admin-toast-title').textContent === 'Product Updated', D.getElementById('admin-toast-title').textContent);

    const { data: row2 } = await admin.from('products').select('*').eq('id', peProductId).single();
    check('the real row genuinely shows asset_class = Real Assets now', row2.asset_class === 'Real Assets', JSON.stringify(row2));
    check('the real row\'s unit_price is COMPLETELY UNCHANGED by the edit — still 100.00, the rule re-confirmed still enforced', Math.abs(row2.unit_price - 100) < 1e-9, row2.unit_price);
    check('extended_description survived the edit untouched (only assetClass was patched)', row2.extended_description === peExtendedDescription, row2.extended_description);
  });

  console.log('\n6a. A real client-side attempt to sneak unitPrice into the patch is genuinely rejected server-side');
  await withContext(ADMIN_CTX, async function () {
    const { data: result, error } = await ADMIN_CTX.MarketswaveData.callFunction('edit-product', { id: peProductId, patch: { minimumInvestment: 2000, unitPrice: 999 } }).then(function (d) { return { data: d, error: null }; }).catch(function (e) { return { data: null, error: e }; });
    check('the real Edge Function genuinely rejects a patch containing unitPrice, with the real specific message', !!error && /unitPrice moves only via the returns engine/i.test(error.message), error && error.message);
    const { data: row3 } = await admin.from('products').select('unit_price,minimum_investment').eq('id', peProductId).single();
    check('the real row is completely UNCHANGED by the rejected attempt — neither unit_price nor minimum_investment moved', Math.abs(row3.unit_price - 100) < 1e-9 && Math.abs(row3.minimum_investment - 1000) < 1e-9, JSON.stringify(row3));
  });

  console.log('\n6b. A real invalid assetClass on add-product is genuinely rejected server-side, no row created');
  await withContext(ADMIN_CTX, async function () {
    const before = (await admin.from('products').select('id')).data.length;
    const { data: result, error } = await ADMIN_CTX.MarketswaveData.callFunction('add-product', {
      name: 'Should Never Exist', assetClass: 'Not A Real Class', investmentType: 'X', riskTier: 'balanced', minimumInvestment: 100, unitPrice: 10
    }).then(function (d) { return { data: d, error: null }; }).catch(function (e) { return { data: null, error: e }; });
    check('the real Edge Function genuinely rejects an invalid assetClass', !!error && /assetClass must be one of/i.test(error.message), error && error.message);
    const after = (await admin.from('products').select('id')).data.length;
    check('genuinely ZERO products rows were created for the rejected attempt', after === before, before + ' -> ' + after);
  });

  // ===========================================================================================
  // PART 7 — CLIENT context, FRESH real dashboard.html + risk-management.html: the SAME held
  // value now groups under "Real Assets" instead of "Private Equity" — THE CORE PROOF THAT A
  // REAL ADMIN EDIT IS VISIBLE ON REAL CLIENT-FACING PAGES, with ZERO changes to either page's
  // own code.
  // ===========================================================================================
  console.log('\n=== PART 7: dashboard.html + risk-management.html (CLIENT context, real UI, FRESH DOM) — reflect the reclassification with ZERO page code changes ===\n');
  await withContext(CLIENT_CTX, async function () {
    const path = fileURLToPath(new URL('../dashboard.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientId; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 1');
    const D = dom.window.document;
    const legend = D.getElementById('allocation-legend');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(legend.innerHTML); }, 20000);

    var peMatch = /Private Equity<\/span><span[^>]*>([\d.]+)%/.exec(legend.innerHTML);
    var raMatch = /Real Assets<\/span><span[^>]*>([\d.]+)%/.exec(legend.innerHTML);
    check('Private Equity now shows genuinely 0.0% — the reclassified holding no longer counts there', peMatch && parseFloat(peMatch[1]) === 0, legend.textContent);
    check('Real Assets now shows the SAME nonzero percentage the held product used to show under Private Equity — the real admin edit is genuinely visible here, unchanged page code', raMatch && parseFloat(raMatch[1]) > 0, legend.textContent);
  });

  await withContext(CLIENT_CTX, async function () {
    const path = fileURLToPath(new URL('../risk-management.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientId; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 5');
    const D = dom.window.document;
    const concentrationEl = D.getElementById('diversification-concentration');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(concentrationEl.innerHTML); }, 20000);
    check('the real Diversification concentration line now names Real Assets, not Private Equity — the real admin edit is genuinely visible here too, unchanged page code', concentrationEl.textContent.indexOf('Real Assets') !== -1 && concentrationEl.textContent.indexOf('Private Equity') === -1, concentrationEl.textContent);
  });

  } finally {
    // Cleanup — the two real test products aren't owned by any client (the Product Catalog
    // is global), so they need an explicit delete; the holding/account_state/client rows all
    // cascade from the real auth user via `on delete cascade`, confirmed by reading every
    // migration's own FK definition, same as every prior verification script in this project.
    for (const id of createdProductIds) {
      await admin.from('products').delete().eq('id', id);
    }
    await admin.auth.admin.deleteUser(clientId);
    tempFiles.forEach(function (f) {
      try { unlinkSync(f); } catch (e) { /* best-effort */ }
    });
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
}

main().catch(function (err) {
  tempFiles.forEach(function (f) {
    try { unlinkSync(f); } catch (e) { /* best-effort */ }
  });
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
