#!/usr/bin/env node
// Backend Migration Phase D — Stage 1 (2026-09-06): dashboard.html's Market Snapshot +
// Currency Converter cards, wired to the two new Edge Functions this stage built.
//
// Same jsdom-based real-DOM harness established across every prior UI Wiring stage (verbatim
// <body>/<script> extraction, window.eval(), real input/change event dispatch) — reused here
// rather than extending verify-dashboard-ui-wiring.mjs's own deliberately minimal hand-rolled
// fake DOM, which doesn't cover the real addEventListener/classList/innerHTML surface these
// two cards' own new script block genuinely uses.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-dashboard-market-currency-ui.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
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
    await new Promise((r) => setTimeout(r, 150));
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
  return { url: status.API_URL, anonKey: status.ANON_KEY };
}

function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}

function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!bodyMatch) throw new Error('Could not find <body> in ' + htmlPath);
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

async function main() {
  console.log('Backend Migration Phase D — Stage 1 verification (dashboard.html Market Snapshot + Currency Converter UI)\n');
  const { url, anonKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real', !!MarketswaveData);

  const realClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInErr } = await realClient.auth.signInWithPassword({ email: 'demo-portfolio@marketswave.local', password: 'DemoPortfolio-Local-2026!' });
  if (signInErr) throw new Error('Real demo client sign-in failed: ' + signInErr.message);

  // Redirect MarketswaveData's own shared client to this real, already-signed-in session —
  // mirrors how a real page already has a real session by the time its own script runs.
  const configMod = await import('../supabase-config.js');
  await configMod.supabase.auth.setSession({ access_token: (await realClient.auth.getSession()).data.session.access_token, refresh_token: (await realClient.auth.getSession()).data.session.refresh_token });

  const path = fileURLToPath(new URL('../dashboard.html', import.meta.url));
  const bodyMarkup = extractBodyMarkup(path);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  dom.window.MarketswaveData = MarketswaveData;

  const script = extractInlineScript(path, 'Backend Migration Phase D — Stage 1');
  const D = dom.window.document;

  // ★ SUPERSEDED 2026-09-11 (row 193). The Market Snapshot half of this file used to assert
  // #market-snapshot-grid's six-card render. That card no longer exists: it became the merged
  // Market Snapshot + Watchlist, whose own suites are verify-supabase-watchlist-alerts.js (the
  // tables, the six Edge Functions, the scheduler) and verify-watchlist-ui-wiring.mjs (the real
  // card's four write actions). Rather than delete the section and lose the fact that it was
  // superseded, it now asserts the supersession itself — so a future session that reintroduces
  // a #market-snapshot-grid, or loses the watchlist card, finds out here. get-market-snapshot
  // ITSELF is still real and still guarded, by verify-supabase-market-data.js.
  console.log('1. Market Snapshot — superseded by the merged watchlist card (row 193)\n');
  dom.window.eval(script);
  check('the old fixed six-symbol grid is genuinely gone, not merely unused', D.getElementById('market-snapshot-grid') === null);
  check('the merged watchlist card is what replaced it', !!D.getElementById('watchlist-card') && !!D.getElementById('wl-rows'));
  check('...and the Delayed label survived the merge — these prices are still cached, not live', !!D.querySelector('#watchlist-card .wl-delayed'));

  console.log('\n2. Currency Converter — a real conversion runs automatically on load, and on input change\n');
  const resultEl = D.getElementById('convert-result');
  await pollUntil(() => resultEl.textContent !== '—' && resultEl.textContent !== '', 15000);
  check('a real result renders on load (the default 1000 USD -> EUR from the real static form values)', resultEl.textContent !== '—' && /€/.test(resultEl.textContent), resultEl.textContent);
  const rateNote = D.getElementById('convert-rate-note');
  check('the real exchange rate is shown as supporting context, not fabricated', !rateNote.classList.contains('hidden') && /1 USD = /.test(rateNote.textContent), rateNote.textContent);

  const amountInput = D.getElementById('convert-amount');
  const beforeChangeResult = resultEl.textContent;
  amountInput.value = '2000';
  amountInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await pollUntil(() => resultEl.textContent !== beforeChangeResult, 15000);
  check('changing the amount triggers a genuinely new real conversion (not a stale/frozen result)', resultEl.textContent !== beforeChangeResult, resultEl.textContent);

  const fromSelect = D.getElementById('convert-from');
  const toSelect = D.getElementById('convert-to');
  const beforeCurrencyChange = resultEl.textContent;
  fromSelect.value = 'GBP';
  fromSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await pollUntil(() => resultEl.textContent !== beforeCurrencyChange, 15000);
  check('changing the From currency triggers a genuinely new real conversion', resultEl.textContent !== beforeCurrencyChange, resultEl.textContent);

  toSelect.value = 'GBP';
  toSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await pollUntil(() => resultEl.textContent === '£' + Number(amountInput.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 15000);
  check('converting a currency to itself correctly shows the exact same amount with no fabricated rate applied', resultEl.textContent === '£' + Number(amountInput.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), resultEl.textContent);
  check('the rate note correctly hides for a same-currency conversion (rate of 1 is not worth showing)', rateNote.classList.contains('hidden'));

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err);
  process.exit(1);
});
