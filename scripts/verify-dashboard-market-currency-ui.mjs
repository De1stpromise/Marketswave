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

  console.log('1. Market Snapshot — real data replaces the loading placeholder\n');
  dom.window.eval(script);
  const grid = D.getElementById('market-snapshot-grid');
  // Poll for the REAL final content, not just the absence of the initial static placeholder
  // — renderAsyncBundle() paints its own animate-pulse skeleton first (a real, distinct
  // intermediate state), which would satisfy a weaker "loading text is gone" check before
  // the actual async data has genuinely finished loading. A first draft of this test caught
  // exactly that race.
  await pollUntil(() => /SPY/.test(grid.innerHTML), 20000);
  check('the loading placeholder is genuinely replaced with real final content, not just the async skeleton', grid.textContent.indexOf('Loading real market data') === -1 && !/animate-pulse/.test(grid.innerHTML));
  // textContent, not innerHTML — jsdom serializes "&" as "&amp;" in innerHTML, a real
  // regex-vs-serialization mismatch caught in this test's own first draft, not an app bug.
  check('all 4 real symbols render with the honest SPY/QQQ labels (not the old fake "S&P 500"/"NASDAQ")', /SPY \(S&P 500 ETF\)/.test(grid.textContent) && /QQQ \(NASDAQ-100 ETF\)/.test(grid.textContent) && /BTC/.test(grid.textContent) && /ETH/.test(grid.textContent), grid.textContent.slice(0, 400));
  check('the old hardcoded values are genuinely gone (5,248 / 16,742 / $67,420 / $3,418)', !/5,248/.test(grid.innerHTML) && !/16,742/.test(grid.innerHTML) && !/67,420/.test(grid.innerHTML) && !/3,418/.test(grid.innerHTML));
  check('at least one real, live numeric value renders (not "NaN" or "undefined")', /\$[\d,]+/.test(grid.innerHTML) || /\d+\.\d+/.test(grid.innerHTML));

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
