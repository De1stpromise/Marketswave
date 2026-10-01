// date-guard.cjs — keeps a date-sensitive suite from straddling 00:00Z (2026-10-01, row 302).
//
// The 2026-10-01 date sweep (row 299) found 19 calendar assumptions in 14 suite files, and almost
// all of them break only when a run CROSSES 00:00Z: a month anchor written lazily on the 1st, a
// "yesterday" fixed at seed time, a simulated price that ticks once at midnight, a "today" read
// after a server call. One start-time rule removes that whole class: a listed suite does not START
// in the minutes before midnight long enough for it to finish, nor in the minutes just after
// (the monthly snapshot job runs at 00:05Z and the lazy anchor writes follow). It WAITS until the
// window has passed, then runs — a calendar edge is not a reason to fail a pass.
//
// The runner (verify-pass.mjs) consults this before starting each suite, so it covers every suite
// in a pass whatever its own entry point (most of these call main() directly, not runVerifyMain).
// A suite run on its own with `node` is not guarded; a pass is the supported path.
//
// MW_FAKE_NOW=<ISO time> replaces the clock for the decision AND the wait, so the forced-failure
// control can fake "just before midnight" without waiting for a real one.
'use strict';

const AFTER_MIDNIGHT_MIN = 10;   // past the 00:05Z snapshot job and the lazy month-anchor writes

// Minutes each date-sensitive suite needs clear of midnight: roughly twice its measured run time,
// never under 5. Suites not listed are not date-sensitive and are never held.
const DATE_SENSITIVE = {
  'verify-portfolio-overview-ui-wiring': 5,
  'verify-portfolio-overview-visual': 15,
  'supabase-verify-portfolio-overview': 5,
  'verify-dashboard-real-data-fixes': 5,
  'supabase-verify-pm-briefing': 5,
  'verify-pm-overview-ui-wiring': 5,
  'verify-deposit-routing-ui-wiring': 5,
  'verify-realised-gains-spendable': 5,
  'verify-returns-display': 5,
  'supabase-verify-documents-support': 5,
  'supabase-verify-visitor-presence': 5,
  'verify-presence-visit-history-visual': 15,
  'supabase-verify-hys': 5,
  'verify-pocket-withdrawal-to-balance': 5,
  // simulated-test-product users: a run across 00:00Z adds one price tick
  'verify-asset-performance-overview': 5,
  'verify-collection-gain-badge': 5,
  'verify-dashboard-redesign': 15,
  'supabase-verify-nav-publications': 5,
  'supabase-verify-portfolio': 5   // verify-supabase-portfolio-engine.js
};

function nowMs() {
  if (process.env.MW_FAKE_NOW) {
    const t = Date.parse(process.env.MW_FAKE_NOW);
    if (Number.isNaN(t)) throw new Error('MW_FAKE_NOW is not a parseable time: ' + process.env.MW_FAKE_NOW);
    return t;
  }
  return Date.now();
}

/**
 * Pure decision. Returns { hold: false } or { hold: true, waitMs, until, reason }.
 * Holds if starting at `t` would leave fewer than `beforeMin` minutes before the next 00:00Z,
 * or if `t` is within AFTER_MIDNIGHT_MIN minutes after the last one.
 */
function decide(t, beforeMin, afterMin = AFTER_MIDNIGHT_MIN) {
  const d = new Date(t);
  const lastMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const nextMidnight = lastMidnight + 86400e3;
  const fmt = (ms) => new Date(ms).toISOString().slice(11, 16) + 'Z';
  if (nextMidnight - t < beforeMin * 60e3) {
    const until = nextMidnight + afterMin * 60e3;
    return { hold: true, waitMs: until - t, until, reason: 'starting at ' + fmt(t) + ' would leave under ' + beforeMin + ' min before 00:00Z' };
  }
  if (t - lastMidnight < afterMin * 60e3) {
    const until = lastMidnight + afterMin * 60e3;
    return { hold: true, waitMs: until - t, until, reason: 'starting at ' + fmt(t) + ' is inside the ' + afterMin + ' min after 00:00Z' };
  }
  return { hold: false };
}

/** The runner's entry point: waits if needed, and says so. Resolves when the suite may start. */
async function guardSuite(name, log = console.log) {
  const beforeMin = DATE_SENSITIVE[name];
  if (!beforeMin) return { held: false };
  const t0 = nowMs();
  const dec = decide(t0, beforeMin);
  if (!dec.hold) return { held: false };
  log('DATE GUARD: ' + name + ' — ' + dec.reason + '; waiting ' + Math.ceil(dec.waitMs / 1000) + ' s until ' + new Date(dec.until).toISOString().slice(11, 19) + 'Z');
  await new Promise((r) => setTimeout(r, dec.waitMs));
  log('DATE GUARD: ' + name + ' — window passed, starting');
  return { held: true, waitMs: dec.waitMs };
}

module.exports = { decide, guardSuite, DATE_SENSITIVE, AFTER_MIDNIGHT_MIN, nowMs };
