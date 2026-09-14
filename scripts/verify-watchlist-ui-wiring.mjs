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
    win.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8')); // asset-mark.js: the page's own <script src> in a real browser (row 207)
    win.eval(script);

    check('the loading skeleton paints immediately, before any promise resolves',
      /animate-pulse/.test(rows.innerHTML), rows.innerHTML.slice(0, 160));

    await pollUntil(function () { return !/animate-pulse/.test(rows.innerHTML); }, 30000);
    check('the real card renders the six seeded defaults',
      ['SPY', 'QQQ', 'DIA', 'BTC', 'ETH', 'SOL'].every(function (s) { return rows.textContent.indexOf(s) !== -1; }),
      rows.textContent.slice(0, 300));
    check('six real cards are rendered', rows.querySelectorAll('.wl-card').length === 6,
      String(rows.querySelectorAll('.wl-card').length));
    // Block grid + drawer (2026-09-12, row 206): the face is for glancing. Allocation lives
    // in the drawer, never on a card; the badge is on the face AND repeated in the drawer.
    check('no Allocate action sits on any card face — allocation is demoted into the drawer',
      rows.querySelectorAll('.wl-card a.mw-btn').length === 0);
    check('no drawer is open before anything is tapped', !rows.querySelector('.wl-drawer'));
    check('every card is a real button for keyboard and touch (role=button, tabindex, aria-expanded=false)',
      [...rows.querySelectorAll('.wl-card')].every(function (c) {
        return c.getAttribute('role') === 'button' && c.getAttribute('tabindex') === '0' && c.getAttribute('aria-expanded') === 'false';
      }));
    // Removed 2026-09-11, and asserted absent so they cannot quietly come back: a client
    // does not need a running tally of their own list. The ceiling is still enforced
    // server-side and surfaces in the add flow - proven for real in section 5 below.
    check('no symbol count and no ceiling caption are on the card',
      !doc.getElementById('wl-count') && !doc.getElementById('wl-cap') &&
      doc.querySelector('.wl-head h3').textContent.trim() === 'Market snapshot',
      doc.querySelector('.wl-head h3').textContent);
    check('the Delayed label is still on the card — these prices are cached, not live',
      doc.querySelector('.wl-delayed').textContent.indexOf('Delayed') !== -1);

    // ---- Offered vs Tracking only, and the real Allocate action ---------------------------
    // Real cards only: a reload paints skeleton .wl-card placeholders (aria-hidden, no
    // data-wl-card, no ticker), and reading .wl-tag off one of those is a null dereference
    // that looks like a page bug. A poll that resolves mid-reload (the dot poll below does —
    // a skeleton has no dot either) must not hand a skeleton to this.
    function cardFor(sym) {
      return [...rows.querySelectorAll('.wl-card[data-wl-card]')].find(function (r) {
        return r.querySelector('.wl-tag').textContent === sym;
      });
    }
    const ethRowEl = cardFor('ETH');
    const spyRowEl = cardFor('SPY');
    check('a catalog symbol renders the Offered badge on its face', !!ethRowEl.querySelector('.wl-badge') && ethRowEl.textContent.indexOf('Offered') !== -1);
    // Since the seeded catalog (2026-09-12, row 202) SPY is a real product too; the
    // Tracking-only state is proven on GM below, added through the real search — a symbol the
    // seeded catalog (row 211) does not offer; NVDA, the original, is a product now.
    check('SPY (seeded as SPDR S&P 500 ETF Trust) renders Offered as well', spyRowEl && spyRowEl.textContent.indexOf('Offered') !== -1);

    // ---- The drawer: one at a time, beneath the card, toggles closed, keyboard ------------
    console.log('\n0. The drawer');
    spyRowEl.click();
    let drawer = rows.querySelector('.wl-drawer');
    check('tapping a card opens a drawer', !!drawer);
    check('...exactly one drawer exists', rows.querySelectorAll('.wl-drawer').length === 1);
    check('...inside the grid, directly after a card (beneath a row, never outside the list)',
      drawer.parentNode === rows && drawer.previousElementSibling && drawer.previousElementSibling.classList.contains('wl-card'));
    check('...the tapped card is marked open (aria-expanded=true, .is-open)',
      spyRowEl.getAttribute('aria-expanded') === 'true' && spyRowEl.classList.contains('is-open'));
    check('...and the drawer names the symbol and repeats the badge',
      /SPY/.test(drawer.querySelector('.wl-drawer-top').textContent) && !!drawer.querySelector('.wl-badge'));

    ethRowEl.click();
    drawer = rows.querySelector('.wl-drawer');
    check('tapping a second card moves the one drawer — still exactly one', rows.querySelectorAll('.wl-drawer').length === 1);
    check('...now for ETH', drawer.getAttribute('data-wl-drawer') === ethRowEl.getAttribute('data-wl-card'));
    check('...and the first card is no longer marked open',
      spyRowEl.getAttribute('aria-expanded') === 'false' && !spyRowEl.classList.contains('is-open') &&
      ethRowEl.getAttribute('aria-expanded') === 'true');
    check('the drawer carries a real Allocate action pointing at the real product ETH resolved to',
      drawer.querySelector('a.mw-btn') &&
      drawer.querySelector('a.mw-btn').getAttribute('href') === 'asset-collection.html?product=PROD-0004',
      drawer.querySelector('a.mw-btn') && drawer.querySelector('a.mw-btn').getAttribute('href'));
    check('...an alert control and a Remove control', !!drawer.querySelector('[data-wl-bell]') && !!drawer.querySelector('[data-wl-remove]'));

    ethRowEl.click();
    check('tapping the open card again closes its drawer', !rows.querySelector('.wl-drawer') && ethRowEl.getAttribute('aria-expanded') === 'false');

    spyRowEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    check('Enter on a focused card opens its drawer (keyboard)', !!rows.querySelector('.wl-drawer') && spyRowEl.getAttribute('aria-expanded') === 'true');
    spyRowEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    check('Space toggles it closed again', !rows.querySelector('.wl-drawer'));

    check('every card carries a real price, not a dash',
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
    searchInput.value = 'general motors';
    searchInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    await pollUntil(function () { return results.querySelectorAll('.wl-res').length > 0; }, 30000);
    check('a real query against both providers returns rendered results',
      results.querySelectorAll('.wl-res').length > 0, results.textContent.slice(0, 240));
    check('every result is labelled with its real source', /Stock|Crypto/.test(results.textContent));

    const gmResult = [...results.querySelectorAll('.wl-res')].find(function (r) {
      return r.getAttribute('data-wl-add') === 'GM';
    });
    check('the real GM result is present to click', !!gmResult, results.textContent.slice(0, 240));

    gmResult.click();
    await pollUntil(function () { return rows.textContent.indexOf('GM') !== -1; }, 30000);
    check('clicking a result genuinely adds the symbol and the card re-renders with it',
      rows.textContent.indexOf('GM') !== -1);
    const gmStored = await admin.from('watchlist_symbols').select('*').eq('client_id', clientId).eq('symbol', 'GM');
    check('...and a real row exists in Postgres, not just on screen', (gmStored.data || []).length === 1);
    check('the add panel closes and the search box clears after a successful add',
      addPanel.hidden === true && searchInput.value === '');
    { const gmRowEl = cardFor('GM');
      check('a non-catalog symbol (GM) reads Tracking only on its face', !!gmRowEl && gmRowEl.textContent.indexOf('Tracking only') !== -1);
      gmRowEl.click();
      const gmDrawer = rows.querySelector('.wl-drawer');
      check('...its drawer repeats Tracking only', !!gmDrawer && /Tracking only/.test(gmDrawer.querySelector('.wl-drawer-top').textContent));
      check('...and has no Allocate action at all, because there genuinely is no allocation path', !!gmDrawer && !gmDrawer.querySelector('a.mw-btn'));
      gmRowEl.click(); }
    check('a seventh real card is rendered', rows.querySelectorAll('.wl-card').length === 7,
      String(rows.querySelectorAll('.wl-card').length));

    // ---- The alert modal, and the once-and-clear promise it makes -------------------------
    console.log('\n2. Set a price alert through the real modal');
    const modal = doc.getElementById('wl-alert-modal');
    check('the alert modal starts hidden', modal.hidden === true);

    const btcRowEl = cardFor('BTC');
    check('no gold dot on BTC before an alert exists', !btcRowEl.querySelector('.wl-dot'));
    btcRowEl.click();
    rows.querySelector('.wl-drawer [data-wl-bell]').click();
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
    check('the re-render keeps the BTC drawer open, now showing the armed alert',
      rows.querySelector('.wl-drawer') && rows.querySelector('.wl-drawer').getAttribute('data-wl-drawer') === cardFor('BTC').getAttribute('data-wl-card') &&
      rows.querySelector('.wl-drawer').textContent.indexOf('Alert when below') !== -1, rows.textContent.slice(0, 400));
    check('...restating that it fires once and then clears',
      /email you once, then it clears/.test(rows.querySelector('.wl-drawer').textContent));
    check('a gold dot now marks the BTC card face (with sr-only text, not colour alone)',
      !!cardFor('BTC').querySelector('.wl-dot') && /Price alert set/.test(cardFor('BTC').querySelector('.wl-dot').textContent));
    check('...and no other card carries a dot', rows.querySelectorAll('.wl-dot').length === 1);
    const armedBell = rows.querySelector('.wl-drawer [data-wl-bell]');
    check('...and the bell in the drawer shows its armed state and the real target', armedBell.classList.contains('is-on') && /below/.test(armedBell.textContent), armedBell.textContent);

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
    await pollUntil(function () { return !rows.querySelector('.wl-dot') && !/animate-pulse/.test(rows.innerHTML); }, 30000);
    check('the gold dot leaves the BTC face once the alert is cleared', !rows.querySelector('.wl-dot'));

    // ---- Remove a symbol ------------------------------------------------------------------
    console.log('\n4. Remove a symbol');
    const gmRowEl = cardFor('GM');
    gmRowEl.click();
    rows.querySelector('.wl-drawer [data-wl-remove]').click();
    await pollUntil(function () { return rows.textContent.indexOf('GM') === -1; }, 30000);
    check('the card disappears from the grid', rows.textContent.indexOf('GM') === -1);
    check('...and its drawer closes with it', !rows.querySelector('.wl-drawer'));
    check('...and is genuinely gone from Postgres',
      ((await admin.from('watchlist_symbols').select('id').eq('client_id', clientId).eq('symbol', 'GM')).data || []).length === 0);
    check('the grid is back to six real cards', rows.querySelectorAll('.wl-card').length === 6,
      String(rows.querySelectorAll('.wl-card').length));

    // ---- The ceiling, surfaced where it is relevant --------------------------------------
    // The card no longer states the ceiling anywhere, by design. This is the one moment it
    // is genuinely relevant, so this is the one place it has to be proven reachable: a real
    // client at the limit, clicking a real search result, seeing the server's own real
    // message on screen. add-watchlist-symbol checks the ceiling BEFORE it calls a provider,
    // so the filler rows below cost no provider calls at all.
    console.log('\n5. At the ceiling, the add flow says so');
    const filler = [];
    for (let i = 0; i < 19; i++) {
      filler.push({
        client_id: clientId, symbol: 'FILL' + String(i).padStart(2, '0'),
        name: 'Ceiling filler ' + i, source: 'finnhub', asset_type: 'stock'
      });
    }
    const { error: fillErr } = await admin.from('watchlist_symbols').insert(filler);
    check('the client is genuinely at the 25-symbol ceiling', !fillErr &&
      ((await admin.from('watchlist_symbols').select('id').eq('client_id', clientId)).data || []).length === 25,
      fillErr && fillErr.message);

    addToggle.click();
    searchInput.value = 'general motors';
    searchInput.dispatchEvent(new win.Event('input', { bubbles: true }));
    await pollUntil(function () { return results.querySelectorAll('.wl-res').length > 0; }, 30000);
    const gmAgain = [...results.querySelectorAll('.wl-res')].find(function (r) {
      return r.getAttribute('data-wl-add') === 'GM';
    });
    check('a result is still there to click at the ceiling - search is not pre-emptively blocked',
      !!gmAgain, results.textContent.slice(0, 240));

    const wlMessageEl = doc.getElementById('wl-message');
    gmAgain.click();
    await pollUntil(function () { return wlMessageEl.hidden === false; }, 30000);
    check('the client is told at the moment it matters, in the add flow',
      wlMessageEl.hidden === false && /up to 25 symbols/.test(wlMessageEl.textContent),
      wlMessageEl.textContent);
    check("...in the server's own words, not a guess the page made",
      /Remove one to add another/.test(wlMessageEl.textContent), wlMessageEl.textContent);
    check('...and nothing was added past the ceiling',
      ((await admin.from('watchlist_symbols').select('id').eq('client_id', clientId)).data || []).length === 25);

    await admin.from('watchlist_symbols').delete().eq('client_id', clientId).like('symbol', 'FILL%');

    // ---- The empty state ------------------------------------------------------------------
    console.log('\n6. The empty state, and that it does not silently re-seed');
    await admin.from('watchlist_symbols').delete().eq('client_id', clientId);
    const emptyDom = buildPageDom(dashPath);
    emptyDom.window.MarketswaveData = MarketswaveData;
    const emptyRows = emptyDom.window.document.getElementById('wl-rows');
    emptyDom.window.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8')); // asset-mark.js (row 207)
    emptyDom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(emptyRows.innerHTML); }, 30000);
    check('a client who has removed everything sees the honest empty state',
      /not tracking any symbols/.test(emptyRows.textContent), emptyRows.textContent.slice(0, 200));
    check('...and the six defaults do NOT silently reappear',
      emptyRows.textContent.indexOf('SPY') === -1);

    // ---- A genuinely failed load ----------------------------------------------------------
    console.log('\n7. A genuinely failed load');
    await supa.auth.signOut();
    const failDom = buildPageDom(dashPath);
    failDom.window.MarketswaveData = MarketswaveData;
    const failRows = failDom.window.document.getElementById('wl-rows');
    failDom.window.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8')); // asset-mark.js (row 207)
    failDom.window.eval(script);
    await pollUntil(function () { return /Try Again/.test(failRows.textContent); }, 30000);
    check('a real failure shows the shared error card with a real retry, never a blank card',
      /Try Again/.test(failRows.textContent), failRows.textContent.slice(0, 200));

    // ---- The Allocate link's destination actually does something ---------------------------
    console.log('\n8. The Allocate link lands somewhere that acts on it');
    const collectionPath = fileURLToPath(new URL('../asset-collection.html', import.meta.url));
    const collDom = buildPageDom(collectionPath, '?product=PROD-0004');
    collDom.window.MarketswaveData = MarketswaveData;
    collDom.window.getClientInitials = function (name) { return name.slice(0, 2).toUpperCase(); };
    await supa.auth.signInWithPassword({ email, password });
    const collGrid = collDom.window.document.getElementById('asset-cards-grid');
    collDom.window.eval(readFileSync(new URL('../asset-mark.js', import.meta.url), 'utf8')); // asset-mark.js (row 207)
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
    await admin.from('market_data_cache').delete().in('symbol', ['GM']);
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
