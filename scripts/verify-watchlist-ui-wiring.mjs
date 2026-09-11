#!/usr/bin/env node
// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — UI verification.
//
// Drives dashboard.html's REAL, unmodified inline script inside a real jsdom DOM built from
// the page's own <body> markup, against the REAL local Supabase stack and the REAL Edge
// Functions — the same harness every UI-wiring stage in this project has used since Stage 2.
// Nothing is stubbed except supabase-config.js's own CDN import, redirected to the local npm
// package by lib/esm-loader-supabase-cdn.mjs.
//
// WHAT THIS PROVES THAT THE BACKEND SUITE CANNOT: that the four write actions are genuinely
// reachable from the real rendered card — a real click on a real Remove button, a real
// search result, a real bell, a real Set alert — and that what comes back is genuinely
// rendered. verify-supabase-watchlist-alerts.js proves the functions; this proves the card.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-watchlist-ui-wiring.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

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
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
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

function buildPageDom(htmlPath, search) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  return new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/page' + (search || ''), runScripts: 'outside-only'
  });
}

async function main() {
  console.log('Merged Market Snapshot + Watchlist — UI verification (real dashboard.html script, real Supabase)\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'wlui-' + suffix + '@test.marketswave.local';
  const password = 'VerifyWatchlistUI-2026!';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;
  await admin.from('clients').insert({
    id: clientId, name: 'Watchlist UI Verify', email: 'wlui-verify-' + clientId,
    phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
  });

  try {
    const supa = await MarketswaveData.getSupabaseClient();
    const { error: signInErr } = await supa.auth.signInWithPassword({ email, password });
    check('real signInWithPassword against the local stack succeeds', !signInErr, signInErr && signInErr.message);

    const dashPath = fileURLToPath(new URL('../dashboard.html', import.meta.url));
    const dom = buildPageDom(dashPath);
    const win = dom.window;
    const doc = win.document;
    win.MarketswaveData = MarketswaveData;
    // dashboard.html's watchlist block lives in the same <script> as the currency converter,
    // which fires on a real Chart.js-free page fine, but the FIRST block also expects
    // engine-core globals; only the second block is extracted and run, deliberately.
    const script = extractInlineScript(dashPath, 'MARKET SNAPSHOT + WATCHLIST');

    const rows = doc.getElementById('wl-rows');
    win.eval(script);

    check('the loading skeleton paints immediately, before any promise resolves',
      /animate-pulse/.test(rows.innerHTML), rows.innerHTML.slice(0, 160));

    await pollUntil(function () { return !/animate-pulse/.test(rows.innerHTML); }, 30000);
    check('the real card renders the six seeded defaults',
      ['SPY', 'QQQ', 'DIA', 'BTC', 'ETH', 'SOL'].every(function (s) { return rows.textContent.indexOf(s) !== -1; }),
      rows.textContent.slice(0, 300));
    check('the visible count is real, not decorative',
      /^·?\s*6 symbols$/.test(doc.getElementById('wl-count').textContent.trim()),
      doc.getElementById('wl-count').textContent);
    check('the ceiling is stated on screen, not only enforced on the server',
      /up to 25 symbols/.test(doc.getElementById('wl-cap').textContent),
      doc.getElementById('wl-cap').textContent);
    check('the Delayed label is still on the card — these prices are cached, not live',
      doc.querySelector('.wl-delayed').textContent.indexOf('Delayed') !== -1);

    // ---- Offered vs Tracking only, and the real Allocate action ---------------------------
    const ethRowEl = [...rows.querySelectorAll('.wl-row')].find(function (r) {
      return r.querySelector('.wl-tag').textContent === 'ETH';
    });
    const spyRowEl = [...rows.querySelectorAll('.wl-row')].find(function (r) {
      return r.querySelector('.wl-tag').textContent === 'SPY';
    });
    check('a catalog symbol renders the Offered badge', ethRowEl.textContent.indexOf('Offered') !== -1);
    check('...and carries a real Allocate action pointing at the real product it resolved to',
      ethRowEl.querySelector('a.mw-btn') &&
      ethRowEl.querySelector('a.mw-btn').getAttribute('href') === 'asset-collection.html?product=PROD-0004',
      ethRowEl.querySelector('a.mw-btn') && ethRowEl.querySelector('a.mw-btn').getAttribute('href'));
    check('a non-catalog symbol reads Tracking only', spyRowEl.textContent.indexOf('Tracking only') !== -1);
    check('...and has no Allocate action at all, because there genuinely is no allocation path',
      !spyRowEl.querySelector('a.mw-btn'));
    check('every row carries a real price, not a dash',
      [...rows.querySelectorAll('.wl-px-v')].every(function (el) { return el.textContent.trim() !== '—'; }));

    // ---- Add a symbol, through the real search --------------------------------------------
    console.log('\n1. Add a symbol through the real search');
    const addToggle = doc.getElementById('wl-add-toggle');
    const addPanel = doc.getElementById('wl-addpanel');
    check('the add panel starts closed', addPanel.hidden === true);
    addToggle.click();
    check('clicking Add symbol opens it', addPanel.hidden === false && addToggle.getAttribute('aria-expanded') === 'true');

    const searchInput = doc.getElementById('wl-search-input');
    const results = doc.getElementById('wl-results');
    searchInput.value = 'nvidia';
    searchInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    await pollUntil(function () { return results.querySelectorAll('.wl-res').length > 0; }, 30000);
    check('a real query against both providers returns rendered results',
      results.querySelectorAll('.wl-res').length > 0, results.textContent.slice(0, 240));
    check('every result is labelled with its real source', /Stock|Crypto/.test(results.textContent));

    const nvdaResult = [...results.querySelectorAll('.wl-res')].find(function (r) {
      return r.getAttribute('data-wl-add') === 'NVDA';
    });
    check('the real NVDA result is present to click', !!nvdaResult, results.textContent.slice(0, 240));

    nvdaResult.click();
    await pollUntil(function () { return rows.textContent.indexOf('NVDA') !== -1; }, 30000);
    check('clicking a result genuinely adds the symbol and the card re-renders with it',
      rows.textContent.indexOf('NVDA') !== -1);
    const nvdaStored = await admin.from('watchlist_symbols').select('*').eq('client_id', clientId).eq('symbol', 'NVDA');
    check('...and a real row exists in Postgres, not just on screen', (nvdaStored.data || []).length === 1);
    check('the add panel closes and the search box clears after a successful add',
      addPanel.hidden === true && searchInput.value === '');
    check('the visible count moved with it', /7 symbols$/.test(doc.getElementById('wl-count').textContent.trim()));

    // ---- The alert modal, and the once-and-clear promise it makes -------------------------
    console.log('\n2. Set a price alert through the real modal');
    const modal = doc.getElementById('wl-alert-modal');
    check('the alert modal starts hidden', modal.hidden === true);

    const btcRowEl = [...rows.querySelectorAll('.wl-row')].find(function (r) {
      return r.querySelector('.wl-tag').textContent === 'BTC';
    });
    btcRowEl.querySelector('[data-wl-bell]').click();
    check('clicking the bell opens the modal for that row', modal.hidden === false);
    check('...named for the real symbol', doc.getElementById('wl-alert-title').textContent === 'Alert me on BTC');
    check('...stating plainly that the alert fires once and then clears, at the moment of deciding',
      /once/.test(doc.getElementById('wl-alert-sub').textContent) &&
      /clear/.test(doc.getElementById('wl-alert-sub').textContent),
      doc.getElementById('wl-alert-sub').textContent);
    check('...showing the real current price it is being set against',
      /Currently \$/.test(doc.getElementById('wl-alert-sub').textContent));

    // A real client-side validation refusal, shown in the modal rather than swallowed.
    doc.getElementById('wl-alert-target').value = '0';
    doc.getElementById('wl-alert-save').click();
    check('a zero target is refused in the modal itself',
      doc.getElementById('wl-alert-error').hidden === false);
    check('...and nothing was written', ((await admin.from('price_alerts').select('id').eq('client_id', clientId)).data || []).length === 0);

    doc.querySelector('[data-wl-dir="below"]').click();
    check('choosing a direction moves the real selection', doc.querySelector('[data-wl-dir="below"]').getAttribute('aria-pressed') === 'true');
    check('...and deselects the other one', doc.querySelector('[data-wl-dir="above"]').getAttribute('aria-pressed') === 'false');

    doc.getElementById('wl-alert-target').value = '1,000';
    doc.getElementById('wl-alert-save').click();
    await pollUntil(function () { return modal.hidden === true; }, 30000);
    check('a real alert is saved and the modal closes', modal.hidden === true);
    const alertRow = (await admin.from('price_alerts').select('*').eq('client_id', clientId)).data[0];
    check('a real active alert row exists with the entered target, comma and all',
      alertRow && alertRow.status === 'active' && Number(alertRow.target_price) === 1000 && alertRow.direction === 'below',
      JSON.stringify(alertRow));

    await pollUntil(function () { return rows.textContent.indexOf('Alert when below') !== -1; }, 30000);
    check('the armed alert is shown on its own row',
      rows.textContent.indexOf('Alert when below') !== -1, rows.textContent.slice(0, 400));
    check('...restating that it fires once and then clears',
      /email you once, then it clears/.test(rows.textContent));
    const armedBell = [...rows.querySelectorAll('.wl-row')].find(function (r) {
      return r.querySelector('.wl-tag').textContent === 'BTC';
    }).querySelector('[data-wl-bell]');
    check('...and the bell on that row shows its armed state', armedBell.classList.contains('is-on'));

    // ---- Clearing it ----------------------------------------------------------------------
    console.log('\n3. Clear the alert');
    armedBell.click();
    check('reopening the modal on a row that already has an alert offers to remove it',
      doc.getElementById('wl-alert-clear').hidden === false);
    check('...prefilled with the real existing target', doc.getElementById('wl-alert-target').value === '1000');
    doc.getElementById('wl-alert-clear').click();
    await pollUntil(function () { return modal.hidden === true; }, 30000);
    check('the alert is cleared and the modal closes', modal.hidden === true);
    check('...and no alert row survives — a cancelled alert never fired, so it is not kept as one',
      ((await admin.from('price_alerts').select('id').eq('client_id', clientId)).data || []).length === 0);

    // ---- Remove a symbol ------------------------------------------------------------------
    console.log('\n4. Remove a symbol');
    const nvdaRowEl = [...rows.querySelectorAll('.wl-row')].find(function (r) {
      return r.querySelector('.wl-tag').textContent === 'NVDA';
    });
    nvdaRowEl.querySelector('[data-wl-remove]').click();
    await pollUntil(function () { return rows.textContent.indexOf('NVDA') === -1; }, 30000);
    check('the row disappears from the card', rows.textContent.indexOf('NVDA') === -1);
    check('...and is genuinely gone from Postgres',
      ((await admin.from('watchlist_symbols').select('id').eq('client_id', clientId).eq('symbol', 'NVDA')).data || []).length === 0);
    check('the count moved back down', /6 symbols$/.test(doc.getElementById('wl-count').textContent.trim()));

    // ---- The empty state ------------------------------------------------------------------
    console.log('\n5. The empty state, and that it does not silently re-seed');
    await admin.from('watchlist_symbols').delete().eq('client_id', clientId);
    const emptyDom = buildPageDom(dashPath);
    emptyDom.window.MarketswaveData = MarketswaveData;
    const emptyRows = emptyDom.window.document.getElementById('wl-rows');
    emptyDom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(emptyRows.innerHTML); }, 30000);
    check('a client who has removed everything sees the honest empty state',
      /not tracking any symbols/.test(emptyRows.textContent), emptyRows.textContent.slice(0, 200));
    check('...and the six defaults do NOT silently reappear',
      emptyRows.textContent.indexOf('SPY') === -1);

    // ---- A genuinely failed load ----------------------------------------------------------
    console.log('\n6. A genuinely failed load');
    await supa.auth.signOut();
    const failDom = buildPageDom(dashPath);
    failDom.window.MarketswaveData = MarketswaveData;
    const failRows = failDom.window.document.getElementById('wl-rows');
    failDom.window.eval(script);
    await pollUntil(function () { return /Try Again/.test(failRows.textContent); }, 30000);
    check('a real failure shows the shared error card with a real retry, never a blank card',
      /Try Again/.test(failRows.textContent), failRows.textContent.slice(0, 200));

    // ---- The Allocate link's destination actually does something ---------------------------
    console.log('\n7. The Allocate link lands somewhere that acts on it');
    const collectionPath = fileURLToPath(new URL('../asset-collection.html', import.meta.url));
    const collDom = buildPageDom(collectionPath, '?product=PROD-0004');
    collDom.window.MarketswaveData = MarketswaveData;
    collDom.window.getClientInitials = function (name) { return name.slice(0, 2).toUpperCase(); };
    await supa.auth.signInWithPassword({ email, password });
    const collGrid = collDom.window.document.getElementById('asset-cards-grid');
    collDom.window.eval(extractInlineScript(collectionPath, 'UI Wiring — Stage 2'));
    await pollUntil(function () { return !/animate-pulse/.test(collGrid.innerHTML); }, 30000);
    check('arriving with ?product= pre-filters the collection to that real product',
      collDom.window.document.getElementById('asset-search').value === 'Ethereum',
      collDom.window.document.getElementById('asset-search').value);
    check('...so the client lands on the product itself, not an unfiltered grid',
      collGrid.querySelectorAll('[data-product-id]').length >= 1 &&
      collGrid.textContent.indexOf('Ethereum') !== -1);
  } finally {
    await admin.from('price_alerts').delete().eq('client_id', clientId);
    await admin.from('watchlist_symbols').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    await admin.auth.admin.deleteUser(clientId);
    await admin.from('market_data_cache').delete().in('symbol', ['NVDA']);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err && err.stack);
  process.exit(1);
});
