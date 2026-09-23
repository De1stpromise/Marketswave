#!/usr/bin/env node
// Concentration agreement across BOTH callers (2026-09-22, register rows 264/265).
//
// `_shared/concentration.ts` exists for exactly one reason, stated in its own header: the client
// dashboard's "Largest position" row and the PM briefing's concentration finding must agree on the
// arithmetic, "or a client is told their portfolio is fine while their PM is told it is
// concentrated". Nothing tested that across both callers, and it broke:
//
//   pm-briefing.ts              tpv = unallocated + allocated              (row 264, corrected)
//   get-returns-summary/index   tpv = unallocated + allocated + realised   (row 264, MISSED)
//
// which understates the client's share against an inflated total, so the 40% flag fails toward
// "fine" — the wrong direction for a risk signal. That fifth copy of the total formula was found by
// a failing suite rather than by either of the two greps that task ran, which is the argument for
// row 265 (one formula, one place).
//
// ★ THE NON-VACUITY GUARD IS THE POINT OF THIS FILE. When a client holds NO realised gains the two
// definitions are numerically identical, so the check would pass without testing anything at all —
// §V's fourth form. It therefore refuses to run against a client whose `asset_returns` is zero, and
// separately asserts that the correct and the broken share are far enough apart for the comparison
// to be capable of failing. Both are hard failures, never skips.
//
// ★ FORCED-FAILURE CONTROL, run against the real fixture client BEFORE the fix landed (2026-09-22),
// 7 passed / 3 failed: PM side 27.1498% of $34,552.51, client side 24.5137% of $38,268.05 — and the
// recovered server total matched `brokenTpv` TO THE CENT, so the diagnosis is exact rather than
// approximate. All three ★ assertions went red, the control among them. A check written after a bug
// is already fixed is worth only what its red run was worth, so that run is recorded here.
//
// Read-only: no rows are written, nothing is seeded, nothing needs cleaning up.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';
import { findFixtureClient } from './lib/fixture-client.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let passed = 0; const fails = [];
const check = (label, cond, detail) => {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); }
};

function localStack() {
  const raw = execSync('supabase status -o json', { cwd: ROOT, encoding: 'utf8' });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(j.API_URL)) throw new Error('refusing a non-local API_URL');
  return j;
}

// The local bootstrap PM. Already disclosed in committed scripts; deliberately used INSTEAD of the
// fixture client's own password, because that lives in supabase/functions/.env and a host-side read
// there restarts the edge runtime mid-pass (row 255). get-returns-summary is self-or-admin, so the
// PM can read the fixture client's summary by clientId and this suite adds no twelfth .env reader.
const PM_EMAIL = 'pm@marketswave.local';
const PM_PASSWORD = 'MarketswavePM-Local-2026!';

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(st.API_URL, st.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: si, error: se } = await anon.auth.signInWithPassword({ email: PM_EMAIL, password: PM_PASSWORD });
  if (se) throw new Error('PM sign-in failed: ' + se.message);
  const token = si.session.access_token;

  const client = await findFixtureClient(admin); // never an address literal in a suite (row 256)
  if (!client) throw new Error('the fixture client is not seeded on this stack');

  // ---------------------------------------------------------------- a stable read window
  //
  // ★ THE CATALOG IS LIVE-PRICED, so a raw read and the function's own read can straddle the
  // five-minute refresh (row 251) — the first run of this check measured $9,382.02 against the
  // server's $9,380.93 for the same position, purely from that. And `get-returns-summary` itself
  // calls recomputeAllocatedCapital(), which WRITES account_state.allocated_capital, so a read
  // taken before the call can legitimately differ from one taken after even with prices frozen.
  // So: warm the stored column with one discarded call, then read → call → read, and compare only
  // when the two raw reads agree. Never widen a tolerance to absorb this — a tolerance loose enough
  // to swallow a price move is loose enough to swallow the bug this file exists to catch.
  const snapshot = async () => {
    const { data: state, error: e1 } = await admin
      .from('account_state').select('unallocated_capital, allocated_capital, asset_returns')
      .eq('client_id', client.id).maybeSingle();
    if (e1) throw e1;
    if (!state) throw new Error('no account_state row for the fixture client');
    const { data: holds, error: e2 } = await admin
      .from('holdings').select('product_id, units, products(name, unit_price)').eq('client_id', client.id);
    if (e2) throw e2;
    return { state, holds: holds || [] };
  };
  const fingerprint = (s) => JSON.stringify({
    st: [s.state.unallocated_capital, s.state.allocated_capital, s.state.asset_returns],
    h: s.holds.map((h) => [h.product_id, String(h.units), String(h.products && h.products.unit_price)]).sort()
  });
  const callSummary = async () => {
    const res = await fetch(st.API_URL + '/functions/v1/get-returns-summary', {
      method: 'POST',
      headers: { apikey: st.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: client.id })
    });
    if (!res.ok) throw new Error('get-returns-summary returned ' + res.status + ': ' + (await res.text()).slice(0, 300));
    return res.json();
  };

  await callSummary(); // discarded: warms allocated_capital so the first raw read is already fresh

  let snap = null; let rs = null; let attempt = 0;
  for (attempt = 1; attempt <= 5; attempt++) {
    const before = await snapshot();
    const summary = await callSummary();
    const after = await snapshot();
    if (fingerprint(before) === fingerprint(after)) { snap = after; rs = summary; break; }
    console.log('    prices moved between the two raw reads (live-priced catalog) — retrying (' + attempt + ')');
  }
  check('a stable read window was obtained (prices held still across the call)', !!snap, { attempts: attempt });
  if (!snap) {
    console.log('\n  Refusing to compare figures read across a price move.\n');
    console.log(passed + ' passed, ' + fails.length + ' failed');
    process.exit(1);
  }

  console.log('\n=== 1. The client genuinely holds realised gains (without this, nothing is tested) ===\n');

  const unallocated = Number(snap.state.unallocated_capital || 0);
  const allocated = Number(snap.state.allocated_capital || 0);
  const realised = Number(snap.state.asset_returns || 0);

  check('the fixture client holds a NON-ZERO realised tally, so the two totals are distinguishable',
    realised !== 0, { unallocated, allocated, realised });
  if (realised === 0) {
    console.log('\n  This check cannot discriminate the two definitions for a client with no realised');
    console.log('  gains. Refusing to report a pass that would mean nothing.\n');
    console.log(passed + ' passed, ' + fails.length + ' failed');
    process.exit(1);
  }

  console.log('\n=== 2. The PM side, derived here from raw rows (pm-briefing.ts arithmetic) ===\n');

  // pm-briefing.ts:186 — tpv = unallocated_capital + allocated_capital, the stored columns, with
  // asset_returns deliberately excluded; top = the largest units × unit_price.
  const values = snap.holds.map((h) => ({
    product: h.product_id,
    name: h.products ? h.products.name : h.product_id,
    value: Number(h.units) * Number(h.products ? h.products.unit_price : 0)
  }));
  check('the fixture client holds at least one position', values.length > 0, { positions: values.length });

  const pmTop = values.slice().sort((a, b) => b.value - a.value)[0];
  const pmTpv = unallocated + allocated;
  const pmShare = pmTop.value / pmTpv;
  const brokenTpv = pmTpv + realised;            // what get-returns-summary computed before the fix
  const brokenShare = pmTop.value / brokenTpv;

  console.log('    PM-side      tpv = ' + pmTpv.toFixed(2) + '  top = ' + pmTop.name + ' ' + pmTop.value.toFixed(2) + '  share = ' + pmShare.toFixed(6));
  console.log('    if realised were added: tpv = ' + brokenTpv.toFixed(2) + '  share = ' + brokenShare.toFixed(6));

  check('★ the correct and the realised-inflated share differ enough for this check to be able to FAIL',
    Math.abs(pmShare - brokenShare) > 1e-4, { pmShare, brokenShare, delta: Math.abs(pmShare - brokenShare) });

  console.log('\n=== 3. The client side, read from get-returns-summary ===\n');

  const lp = rs.largestPosition;
  check('get-returns-summary returns a largestPosition', !!lp && typeof lp.shareOfPortfolio === 'number', lp || null);
  if (!lp) { console.log('\n' + passed + ' passed, ' + fails.length + ' failed'); process.exit(1); }

  // The total the server divided by, recovered from its own two numbers.
  const serverTpv = Number(lp.currentValue) / Number(lp.shareOfPortfolio);
  console.log('    client-side  implied tpv = ' + serverTpv.toFixed(2) + '  top = ' + lp.name + ' ' + Number(lp.currentValue).toFixed(2) + '  share = ' + Number(lp.shareOfPortfolio).toFixed(6));

  console.log('\n=== 4. THE PROPERTY: the two callers agree ===\n');

  check('both sides pick the SAME position as the largest', lp.productId === pmTop.product,
    { client: lp.productId, pm: pmTop.product });

  // Tolerances are tight on purpose. With prices held still, the only legitimate difference is the
  // server rounding each position to the cent before summing (row 250) — at most a half-cent on the
  // top position, so ~1e-7 on a share. A dollar of slack here would hide a bug worth thousands.
  check('★ the total the client side divided by is unallocated + allocated — NOT plus the realised tally',
    Math.abs(serverTpv - pmTpv) < 0.05,
    { serverTpv: Number(serverTpv.toFixed(2)), pmTpv: Number(pmTpv.toFixed(2)), brokenTpv: Number(brokenTpv.toFixed(2)), realised });

  check('★ the client-side share equals the PM-side share (the property concentration.ts guarantees)',
    Math.abs(Number(lp.shareOfPortfolio) - pmShare) < 1e-6,
    { client: lp.shareOfPortfolio, pm: pmShare, delta: Math.abs(Number(lp.shareOfPortfolio) - pmShare) });

  check('★ CONTROL: the client-side share is NOT the realised-inflated one',
    Math.abs(Number(lp.shareOfPortfolio) - brokenShare) > 1e-5,
    { client: lp.shareOfPortfolio, broken: brokenShare });

  // Weaker than it looks, and said so rather than left to imply more: both sides currently sit well
  // below the threshold, so this agrees whenever neither is flagged. It is here to catch a threshold
  // or minTpv drifting between the two callers, not as evidence the shares themselves match.
  const pmConcentrated = pmShare >= Number(lp.threshold) && pmTpv >= Number(lp.minTpv);
  check('the concentrated FLAG agrees with the PM-side threshold evaluation',
    Boolean(lp.concentrated) === pmConcentrated,
    { client: lp.concentrated, pm: pmConcentrated, share: pmShare, tpv: pmTpv, threshold: lp.threshold, minTpv: lp.minTpv });

  console.log('\n' + passed + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('CONCENTRATION AGREEMENT: FAIL'); process.exit(1); }
  console.log('CONCENTRATION AGREEMENT: PASS');
  process.exit(0);
}

runVerifyMain(main, { watchdogMs: 4 * 60 * 1000 });
