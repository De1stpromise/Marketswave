#!/usr/bin/env node
// Homepage design round 2 (2026-09-08) — verification for get-public-market-snapshot.
//
// This is the project's first genuinely open read endpoint, so the checks below are weighted
// toward the SAFETY properties rather than just "does it return data":
//   - it must never refresh the cache (that is what makes an open endpoint safe here: no
//     amount of traffic can reach, bill or rate-limit Finnhub/CoinGecko)
//   - it must need no user session
//   - it must expose no client data and no NAV attribution columns
//   - it must rate-limit
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`.
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

function localStack() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const st = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + st.API_URL);
  }
  return { url: st.API_URL, anonKey: st.ANON_KEY, serviceRoleKey: st.SERVICE_ROLE_KEY };
}

// Each section calls with its OWN x-forwarded-for value. Without this the sections exhaust
// one another's rate-limit allowance and later checks fail for reasons unrelated to what they
// are testing — which is exactly what happened on the first two runs.
async function call(url, anonKey, ip = 'verify-functional', headers = {}) {
  const res = await fetch(url + '/functions/v1/get-public-market-snapshot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + anonKey,
      'x-forwarded-for': ip,
      ...headers
    },
    body: '{}'
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body, headers: res.headers };
}

async function main() {
  console.log('get-public-market-snapshot — verification\n');
  const { url, anonKey, serviceRoleKey } = localStack();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // ===========================================================================================
  console.log('1. Serves real cached market data with only the public anon key (no user session)');
  const r1 = await call(url, anonKey);
  check('returns 200 for a caller with no user session', r1.status === 200, 'got ' + r1.status);
  check('returns market rows', Array.isArray(r1.body?.markets) && r1.body.markets.length > 0,
    JSON.stringify(r1.body).slice(0, 160));
  const labels = (r1.body?.markets || []).map((m) => m.label);
  check('uses the honest ETF-proxy labels, never a bare index name',
    labels.some((l) => /S&P 500 ETF/.test(l)) && !labels.some((l) => /^S&P 500$/.test(l)),
    JSON.stringify(labels));
  check('every market row carries a real numeric value',
    (r1.body?.markets || []).every((m) => typeof m.value === 'number' && isFinite(m.value)));

  // cross-check against the table itself, so this is real data and not a fixture
  const { data: cacheRows } = await admin.from('market_data_cache').select('symbol, value');
  const bySym = Object.fromEntries((cacheRows || []).map((r) => [r.symbol, Number(r.value)]));
  const matches = (r1.body?.markets || []).every((m) => bySym[m.symbol] === Number(m.value));
  check('values match public.market_data_cache exactly (real data, not synthesised)', matches);

  // ===========================================================================================
  console.log('\n2. ★ NEVER refreshes the cache — the property that makes an open endpoint safe');
  const before = await admin.from('market_data_cache').select('symbol, value, last_updated').order('symbol');
  // Force the cache to look stale. The AUTHENTICATED function would refresh on this; the public
  // one must not, no matter how old the data is.
  const staleTime = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  await admin.from('market_data_cache').update({ last_updated: staleTime }).neq('symbol', '');
  for (let i = 0; i < 3; i++) await call(url, anonKey);
  const after = await admin.from('market_data_cache').select('symbol, value, last_updated').order('symbol');
  // Compare on VALUES and on the timestamp parsed as a Date. A raw string compare fails on
  // formatting alone — toISOString() emits "...842Z" while Postgres returns "...842+00:00" —
  // which produced a false failure on this exact (and most important) assertion first time.
  const sameValues = JSON.stringify((after.data || []).map((r) => [r.symbol, Number(r.value)])) ===
                     JSON.stringify((before.data || []).map((r) => [r.symbol, Number(r.value)]));
  const staleMs = new Date(staleTime).getTime();
  const stillStale = (after.data || []).every((r) => Math.abs(new Date(r.last_updated).getTime() - staleMs) < 1000);
  check('★ 3 calls against a 6-hour-stale cache left every VALUE unchanged', sameValues,
    'the public endpoint must never write to or refresh the cache');
  check('★ and left last_updated still stale — no refresh was triggered', stillStale,
    'if this moved, the public endpoint refetched from the third-party API');
  const rStale = await call(url, anonKey);
  check('still serves the stale values rather than erroring or refetching',
    rStale.status === 200 && (rStale.body?.markets || []).length > 0);
  // restore the real timestamps so the authenticated function behaves normally afterwards
  for (const row of before.data || []) {
    await admin.from('market_data_cache').update({ last_updated: row.last_updated }).eq('symbol', row.symbol);
  }
  console.log('     (original last_updated timestamps restored)');

  // ===========================================================================================
  console.log('\n3. Exposes nothing sensitive');
  const raw = JSON.stringify(r1.body);
  check('no published_by / attribution columns leak from nav_publications',
    !/published_by|publishedBy|performed_by|_email/i.test(raw));
  check('no client / account / email fields anywhere in the payload',
    !/client_id|clientId|account_state|unallocated|@/i.test(raw), raw.slice(0, 200));
  const navKeys = new Set((r1.body?.navs || []).flatMap((n) => Object.keys(n)));
  check('NAV rows expose only product / price / asOf',
    [...navKeys].every((k) => ['product', 'price', 'asOf'].includes(k)), [...navKeys].join(','));
  if ((r1.body?.navs || []).length) {
    const { data: navRows } = await admin
      .from('nav_publications').select('product_id, published_unit_price, effective_date')
      .order('effective_date', { ascending: false }).limit(1);
    check('NAV values are real rows from nav_publications',
      (r1.body.navs || []).some((n) => Number(n.price) === Number(navRows[0].published_unit_price)));
  } else {
    console.log('  (no NAV publications present to cross-check)');
  }

  // ===========================================================================================
  console.log('\n4. Rate limiting');
  // CONCURRENT, not serial. The limiter is per-isolate by nature (documented in the function
  // itself), and a serial loop is slow enough that isolates recycle between requests, so it
  // reported a false negative first time. A concurrent burst is both deterministic here AND
  // the shape real abuse actually takes.
  const statuses = await Promise.all(
    Array.from({ length: 90 }, () => call(url, anonKey, 'verify-burst').then((r) => r.status))
  );
  const counts = statuses.reduce((a, s) => ((a[s] = (a[s] || 0) + 1), a), {});
  check('a concurrent burst of 90 is rate-limited (429s returned)', (counts[429] || 0) > 0,
    'status spread: ' + JSON.stringify(counts));
  check('and legitimate requests still succeed within the allowance', (counts[200] || 0) > 0,
    'status spread: ' + JSON.stringify(counts));
  console.log('     status spread: ' + JSON.stringify(counts));

  // ===========================================================================================
  console.log('\n5. CORS preflight (the homepage calls this cross-origin)');
  const pre = await fetch(url + '/functions/v1/get-public-market-snapshot', { method: 'OPTIONS' });
  check('OPTIONS preflight succeeds', pre.status === 200 || pre.status === 204, 'got ' + pre.status);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  console.log(failed ? '\nVERIFY: FAIL' : '\nVERIFY: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
