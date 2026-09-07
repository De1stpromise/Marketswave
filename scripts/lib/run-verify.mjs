// Project-wide hang-fix convention (2026-09-07). Every verify-*.js/.mjs script in this
// project that loads real production config files or otherwise establishes a real Supabase
// Auth session schedules a live autoRefreshToken timer for each such client (correct,
// required production behavior — never disabled just to make a test convenient) that is
// never explicitly stopped. Relying on Node's natural "exit once the event loop is empty"
// behavior then hangs the process INDEFINITELY once the real work is done, even though every
// assertion already ran and printed its result — confirmed directly, twice, the same day this
// file was written: verify-admin-real-login.mjs (found first, 80+ minutes before being
// force-killed) and verify-password-reset-flow.mjs (found ~10 minutes in, same signature —
// a full PASS result already printed, ~7s of actual CPU time against 10+ minutes of
// wall-clock time). Every existing verify script was individually patched with an explicit
// `process.exit(0)` on its own success path as the immediate fix (see CLAUDE.md's own
// dated Tech Stack entry for the full audit) — this file is the PREVENTATIVE half: a shared
// wrapper so a NEW script inherits the fix by construction instead of needing to remember it.
//
// USAGE — a new verify script should end with:
//
//   import { runVerifyMain } from './lib/run-verify.mjs';
//   runVerifyMain(main);
//
// instead of the old, error-prone hand-rolled pattern:
//
//   main().catch(function (err) {
//     console.error('...' + err);
//     process.exit(1);
//   });
//   // (and hoping every success path inside main() itself also explicitly exits — the
//   // exact thing that kept getting forgotten)
//
// CONTRACT this wrapper assumes, matching every existing script's own established shape
// unchanged: `main` is an async function that either (a) resolves normally when everything
// passed — the wrapper itself calls process.exit(0) in that case, so main() does NOT need to
// call process.exit(0) itself anymore — or (b) calls process.exit(1) ITSELF somewhere inside
// its own real failure-handling logic (the `if (failed > 0) { ...; process.exit(1); }`
// pattern every existing script already uses) — process.exit() is synchronous and never
// returns, so the wrapper's own .then() below is simply never reached in that case, meaning
// NO changes are needed to any script's existing internal pass/fail bookkeeping to adopt
// this wrapper. A thrown/rejected error is the third case, caught by .catch() below.
export function runVerifyMain(main, options) {
  const watchdogMs = (options && options.watchdogMs) || 90000;
  // Not unref()'d — an unref()'d timer wouldn't keep the process alive on its own, defeating
  // the point of a safety net that must fire even if nothing else is scheduled.
  const watchdog = setTimeout(function () {
    console.error(
      '\nFATAL: script did not complete within ' + (watchdogMs / 1000) + 's -- forcing exit. ' +
      'If every assertion had already printed by now, this is very likely the same lingering-' +
      'autoRefreshToken-timer class this wrapper exists to prevent, somehow still reached; if ' +
      'assertions were still actively printing, something inside main() is genuinely stuck ' +
      '(a real network call with no timeout).'
    );
    process.exit(1);
  }, watchdogMs);

  main().then(function () {
    clearTimeout(watchdog);
    process.exit(0);
  }).catch(function (err) {
    clearTimeout(watchdog);
    console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.stack || err));
    process.exit(1);
  });
}
