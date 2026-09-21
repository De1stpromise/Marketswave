#!/usr/bin/env node
// verify-pass.mjs — THE way to run a verification pass, targeted or full. (2026-09-14, register
// row 216.) Before this file a "targeted pass" was a hand-typed list of `npm run` calls and the
// full suite was a scratchpad bash loop, so there was nothing for a pre-pass gate to hook into
// and the gate stayed manual — which is precisely the step that gets skipped under time
// pressure, when it is most needed.
//
//   npm run pass -- verify-catalog-expansion verify-asset-pages-ui-wiring   # a targeted pass
//   npm run pass -- --full                                                   # every suite
//   npm run pass -- --list                                                   # what --full runs
//
// WHAT IT DOES, IN ORDER:
//   0. `verify-fixture-symbols` — ALWAYS, first, and there is no flag to skip it. If it fails,
//      nothing else runs: a fixture colliding with the real catalog does not just fail a suite,
//      it can write onto a real product's row, and every minute of a pass run after that is a
//      minute spent on a state the gate already knows is wrong. (Row 215 records the five
//      hours that this ordering would have saved.)
//   1. each named suite, sequentially, its output streamed to the console AND written to
//      .pass-logs/<timestamp>/<suite>.log so a `TEARDOWN` warning or an `UNMEASURED` line can
//      be grepped afterwards without re-running anything.
//   2. a summary table — suite, minutes, result — and one line: PASS n/m or FAIL. The per-suite
//      wall time is the measured input the verification-time question needs (the ~2h40 figure
//      for a targeted pass was a reconstruction from commit timestamps; this records it).
//
// EXIT CODES a suite hands back, read the way this project has learned to read them:
//   0    PASS.
//   127  on Windows, EITHER the documented post-assertion libuv abort (row 198: every
//        assertion already printed PASS, then `Assertion failed: !(handle->flags &
//        UV_HANDLE_CLOSING)`) OR a genuine mid-run death with no error text (row 214). The
//        table marks it "exit 127 — read the log", never PASS, because the runner cannot tell
//        the two apart from the code alone; the log's last lines can.
//   else FAIL.
// The runner itself exits 1 if the gate failed or any suite did not exit 0.
//
// WHAT IT DELIBERATELY DOES NOT DO: pick which suites a targeted pass needs (that is the
// operator's judgment — the CLAUDE.md gates bullet says which surfaces a task touched), run the
// cold-start warm-up pass for you (a `--full` run after `supabase start` is the discarded warm-up
// by the standing convention; run `--full` again for the real one), or run two suites in
// parallel (shared test data, ports and provider budget make that a wall of false failures —
// CLAUDE.md row 211's own note).

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const GATE = 'verify-fixture-symbols';
const NOT_A_SUITE = new Set([GATE, GATE + '-self-test', 'pass']);
// verify-* / supabase-verify-* run in a pass and exit non-zero on failure; audit-* are investigations
// (they print numbers, need the live site or a second origin, exit 0 regardless) and never join one.
// A file that can fail a pass is a verify- by definition, whatever it was called (row 262).
const isSuite = (name) => /^(verify|supabase-verify)-/.test(name) && !NOT_A_SUITE.has(name);
const allSuites = Object.keys(scripts).filter(isSuite);

if (args.includes('--list')) {
  console.log('--full runs, in this order, after the gate:\n' + allSuites.map((s) => '  ' + s).join('\n'));
  process.exit(0);
}
const wanted = args.includes('--full') ? allSuites : args.filter((a) => !a.startsWith('--'));
if (!wanted.length) {
  console.error('usage: npm run pass -- <suite> [<suite> ...] | --full | --list\n(a suite is an npm script name from scripts/package.json, e.g. verify-catalog-expansion)');
  process.exit(2);
}
const unknown = wanted.filter((s) => !scripts[s]);
if (unknown.length) { console.error('not an npm script in scripts/package.json: ' + unknown.join(', ') + '\n(`npm run pass -- --list` shows the suite names)'); process.exit(2); }
const notSuite = wanted.filter((s) => !isSuite(s));
if (notSuite.length) { console.error('not a suite (or the gate itself, which always runs first): ' + notSuite.join(', ')); process.exit(2); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logDir = path.join(__dirname, '.pass-logs', stamp);
fs.mkdirSync(logDir, { recursive: true });
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runScript(name) {
  return new Promise((resolve) => {
    const logPath = path.join(logDir, name + '.log');
    const log = fs.createWriteStream(logPath);
    const t0 = Date.now();
    // shell: true so npm.cmd resolves on Windows without a path lookup of our own.
    const child = spawn(npmCmd, ['run', '--silent', name], { cwd: __dirname, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const tee = (stream, out) => stream.on('data', (chunk) => { out.write(chunk); log.write(chunk); });
    tee(child.stdout, process.stdout); tee(child.stderr, process.stderr);
    child.on('close', (code) => { log.end(); resolve({ name, code, minutes: (Date.now() - t0) / 60000, logPath }); });
  });
}
const mins = (m) => m.toFixed(1).padStart(5) + ' min';
const verdict = (r) => r.code === 0 ? 'PASS' : (r.code === 127 ? 'exit 127 — read the log (row 198 post-assertion abort, or row 214 mid-run death)' : 'FAIL (exit ' + r.code + ')');

(async () => {
  console.log('VERIFICATION PASS — ' + (args.includes('--full') ? 'full, ' : 'targeted, ') + wanted.length + ' suite' + (wanted.length === 1 ? '' : 's') + '; logs in ' + path.relative(process.cwd(), logDir) + '\n');
  // Registration gate (2026-09-21, row 259): a suite that exists on disk but has no npm script
  // never runs in a pass, and a suite that never runs looks identical to one that passes — the
  // vacuity pattern (register row V) in its fifth shape. verify-login-redesign sat unregistered
  // for twelve days; four more were found the moment this line was written.
  const unregistered = fs.readdirSync(__dirname).filter((f) => /^verify-.*\.(m?js)$/.test(f) && !Object.values(pkg.scripts).join(' ').includes(f));
  if (unregistered.length) {
    console.log('VERIFICATION PASS: FAIL - these verify-* files have no npm script in scripts/package.json, so no pass could ever run them: ' + unregistered.join(', ') + '. Register each one, then start the pass again.');
    process.exit(1);
  }
  console.log('==== gate: ' + GATE + ' (always first, cannot be skipped) ====');
  const gate = await runScript(GATE);
  if (gate.code !== 0) {
    console.log('\nVERIFICATION PASS: FAIL — the fixture-symbols gate did not pass (exit ' + gate.code + '); no suite was run. Fix the collision (or waive it beside the code with a reason) and start the pass again.');
    process.exit(1);
  }
  const results = [];
  for (const name of wanted) {
    console.log('\n==== ' + name + ' (' + (results.length + 1) + '/' + wanted.length + ') ====');
    results.push(await runScript(name));
  }
  const total = results.reduce((a, r) => a + r.minutes, 0) + gate.minutes;
  console.log('\n==== summary ====');
  console.log('  ' + 'gate'.padEnd(46) + mins(gate.minutes) + '  PASS');
  for (const r of results) console.log('  ' + r.name.padEnd(46) + mins(r.minutes) + '  ' + verdict(r));
  const ok = results.filter((r) => r.code === 0).length;
  console.log('  ' + 'total'.padEnd(46) + mins(total));
  console.log('\nVERIFICATION PASS: ' + (ok === results.length ? 'PASS' : 'FAIL') + ' (' + ok + '/' + results.length + ' suites exit 0; logs in ' + path.relative(process.cwd(), logDir) + ')');
  process.exitCode = ok === results.length ? 0 : 1;
})();
