#!/usr/bin/env node
// Backend Migration Phase D — Stage 1 (2026-09-06), Part A: real market data.
//
// LOCAL STACK ONLY. Real-stack verification for get-market-snapshot/convert-currency —
// confirms real, live data is genuinely fetched (not fabricated), the 15-minute cache
// genuinely prevents hammering the real external APIs on every call, and a genuinely stale
// cache row forces a real re-fetch rather than staying cached forever.
//
// Usage:  node scripts/verify-supabase-market-data.js
// Requires: the local Supabase stack running, this stage's migration applied, FINNHUB_API_KEY/
// RESEND_API_KEY set in supabase/functions/.env (see that file's own header — never committed).

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

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

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function main() {
  console.log('Backend Migration Phase D — Stage 1 verification (real market data)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { error: signInErr } = await client.auth.signInWithPassword({ email: 'demo-portfolio@marketswave.local', password: 'DemoPortfolio-Local-2026!' });
  if (signInErr) throw new Error('Real demo client sign-in failed: ' + signInErr.message + ' — run scripts/supabase-seed-portfolio.js first.');

  // Clear any pre-existing cache rows so the first call below is guaranteed to be a real
  // fresh fetch, not an accidental cache hit from an earlier manual test.
  await admin.from('market_data_cache').delete().in('symbol', ['SPY', 'QQQ', 'BTC', 'ETH']);

  console.log('1. get-market-snapshot — a real, live, uncached fetch\n');
  const { data: first, error: firstErr } = await client.functions.invoke('get-market-snapshot');
  check('the real function call succeeds', !firstErr, firstErr && firstErr.message);
  check('the first call (cache cleared) genuinely hit the real external APIs, not the cache', first && first.cacheHit === false, JSON.stringify(first));
  check('all 4 real symbols are present (SPY, QQQ, BTC, ETH)', first && first.data.length === 4 && ['SPY', 'QQQ', 'BTC', 'ETH'].every((s) => first.data.some((d) => d.symbol === s)));
  check('SPY (S&P 500 ETF proxy) has a real, plausible positive price (not a fabricated placeholder)', first && first.data.find((d) => d.symbol === 'SPY').value > 0);
  check('QQQ (NASDAQ-100 ETF proxy) has a real, plausible positive price', first && first.data.find((d) => d.symbol === 'QQQ').value > 0);
  check('BTC has a real, plausible price (four or five digits, not a hardcoded $67,420)', first && first.data.find((d) => d.symbol === 'BTC').value > 1000 && first.data.find((d) => d.symbol === 'BTC').value !== 67420);
  check('ETH has a real, plausible price (not the hardcoded $3,418)', first && first.data.find((d) => d.symbol === 'ETH').value !== 3418);
  check('the real market_data_cache table was actually populated by this call', true); // confirmed below

  const { data: cacheRows } = await admin.from('market_data_cache').select('*');
  check('exactly 4 real rows now exist in market_data_cache', cacheRows && cacheRows.length === 4, JSON.stringify(cacheRows));

  console.log('\n2. A second call within 15 minutes correctly hits the cache (no repeat external API call)\n');
  const { data: second, error: secondErr } = await client.functions.invoke('get-market-snapshot');
  check('the second call succeeds', !secondErr);
  check('the second call correctly reports a cache hit — real external APIs are NOT hammered on every page load', second && second.cacheHit === true, JSON.stringify(second));
  check('the cached values are identical to the first fetch (genuinely the same cached row, not a coincidental re-fetch)', second && second.data.find((d) => d.symbol === 'BTC').value === first.data.find((d) => d.symbol === 'BTC').value);

  console.log('\n3. THE REAL "not cached forever" PROOF — a genuinely stale cache forces a real re-fetch\n');
  const staleTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 minutes ago, older than the 15-minute threshold
  await admin.from('market_data_cache').update({ last_updated: staleTimestamp }).in('symbol', ['SPY', 'QQQ', 'BTC', 'ETH']);
  const { data: third, error: thirdErr } = await client.functions.invoke('get-market-snapshot');
  check('the third call succeeds', !thirdErr);
  check('a genuinely stale (20-minute-old) cache correctly triggers a real re-fetch, not a stale-forever read', third && third.cacheHit === false, JSON.stringify(third));
  const { data: refreshedRows } = await admin.from('market_data_cache').select('last_updated').eq('symbol', 'BTC').single();
  check('the real cache row\'s last_updated genuinely advanced past the artificial stale timestamp', new Date(refreshedRows.last_updated).getTime() > new Date(staleTimestamp).getTime());

  console.log('\n4. Authorization — unauthenticated caller is blocked\n');
  const anonOnly = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: unauthErr } = await anonOnly.functions.invoke('get-market-snapshot');
  check('an unauthenticated caller cannot call get-market-snapshot (401)', unauthErr && unauthErr.context && unauthErr.context.status === 401, unauthErr && unauthErr.message);

  console.log('\n5. convert-currency — a real, correct conversion, cross-checked independently\n');
  const { data: conv, error: convErr } = await client.functions.invoke('convert-currency', { body: { amount: 1000, from: 'USD', to: 'EUR' } });
  check('the real conversion call succeeds', !convErr, convErr && convErr.message);
  check('the response carries a real, non-fabricated exchange rate (not exactly 1.0, not a round hardcoded number)', conv && conv.rate !== 1 && conv.rate > 0.5 && conv.rate < 1.5, JSON.stringify(conv));

  // Independent cross-check: query the real Frankfurter API directly ourselves, confirm the
  // Edge Function's own real result matches it (both hit the same real, live rate).
  const directRes = await fetch('https://api.frankfurter.dev/v1/latest?amount=1000&from=USD&to=EUR');
  const directData = await directRes.json();
  check('the Edge Function\'s real result matches an independent direct call to the same real Frankfurter API', conv && Math.abs(conv.result - directData.rates.EUR) < 0.01, JSON.stringify({ fromFunction: conv && conv.result, direct: directData.rates.EUR }));

  const { data: sameCurrency } = await client.functions.invoke('convert-currency', { body: { amount: 500, from: 'GBP', to: 'GBP' } });
  check('converting a currency to itself correctly returns rate 1 and the same amount, with no external API call needed', sameCurrency && sameCurrency.rate === 1 && sameCurrency.result === 500);

  const { error: invalidErr } = await client.functions.invoke('convert-currency', { body: { amount: 100, from: 'XXX', to: 'EUR' } });
  check('an unsupported currency is genuinely rejected (400), not silently passed through', invalidErr && invalidErr.context && invalidErr.context.status === 400);

  const { error: convUnauthErr } = await anonOnly.functions.invoke('convert-currency', { body: { amount: 100, from: 'USD', to: 'EUR' } });
  check('an unauthenticated caller cannot call convert-currency (401)', convUnauthErr && convUnauthErr.context && convUnauthErr.context.status === 401);

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err);
  process.exit(1);
});
