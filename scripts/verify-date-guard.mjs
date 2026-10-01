#!/usr/bin/env node
// verify-date-guard — the standing proof for lib/date-guard.cjs and its use in verify-pass.mjs
// (row 302, 2026-10-01). A date-sensitive suite must never START so close to 00:00Z that it
// crosses it, nor in the minutes just after (the 00:05Z snapshot job and lazy month anchors).
//
// The forced-failure controls drive the REAL runner with a faked clock (MW_FAKE_NOW):
//   - 23:59:00Z: the runner must announce a hold and must NOT start the suite (watched for 6 s,
//     then stopped — the hold would last ~11 minutes);
//   - 00:09:57Z: the runner must hold, wait ~3 s, then genuinely start the suite;
//   - 12:00:00Z: no hold at all.
// Plus the pure decision across month-end and year-end, and every guarded name being a real
// npm script (a misspelt name would simply never be guarded — the vacuity pattern).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';
import dateGuard from './lib/date-guard.cjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = 'verify-returns-display';   // guarded, short
let passed = 0; const fails = [];
const check = (label, ok, detail) => { if (ok) { passed++; console.log('  PASS  ' + label); } else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); } };
const T = (s) => Date.parse(s);

// Runs the real runner with a fake clock; resolves with its output once `until` matches or the
// time limit passes, then stops it (and its child tree) — a held runner would otherwise sit there.
function runRunner(fakeNow, until, limitMs) {
  return new Promise((resolve) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['run', '--silent', 'pass', '--', SUITE], { cwd: HERE, shell: true, env: Object.assign({}, process.env, { MW_FAKE_NOW: fakeNow }) });
    let out = ''; const t0 = Date.now(); let done = false;
    const finish = () => { if (done) return; done = true; clearInterval(iv);
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGKILL');
      resolve({ out, ms: Date.now() - t0 }); };
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('close', finish);
    const iv = setInterval(() => { if (until(out) || Date.now() - t0 > limitMs) finish(); }, 200);
  });
}

async function main() {
  console.log('\n=== 1. the decision ===\n');
  let d = dateGuard.decide(T('2026-10-01T23:59:00Z'), 5);
  check('23:59Z with a 5-min need: held until 00:10Z the next day', d.hold && new Date(d.until).toISOString() === '2026-10-02T00:10:00.000Z', JSON.stringify(d));
  d = dateGuard.decide(T('2026-10-01T23:50:00Z'), 5);
  check('23:50Z with a 5-min need: not held (it finishes before midnight)', !d.hold);
  d = dateGuard.decide(T('2026-10-01T23:50:00Z'), 15);
  check('23:50Z with a 15-min need (a visual suite): held', d.hold);
  d = dateGuard.decide(T('2026-10-01T00:05:00Z'), 5);
  check('00:05Z: held until 00:10Z (the snapshot job and lazy anchors)', d.hold && d.waitMs === 5 * 60e3, JSON.stringify(d));
  d = dateGuard.decide(T('2026-10-01T00:11:00Z'), 15);
  check('00:11Z: not held', !d.hold);
  d = dateGuard.decide(T('2026-10-01T12:00:00Z'), 15);
  check('midday: not held', !d.hold);
  d = dateGuard.decide(T('2026-10-31T23:58:00Z'), 5);
  check('month-end (Oct 31 23:58Z): held across into Nov 1 00:10Z', d.hold && new Date(d.until).toISOString() === '2026-11-01T00:10:00.000Z', JSON.stringify(d));
  d = dateGuard.decide(T('2026-12-31T23:58:00Z'), 5);
  check('year-end (Dec 31 23:58Z): held across into Jan 1 00:10Z', d.hold && new Date(d.until).toISOString() === '2027-01-01T00:10:00.000Z', JSON.stringify(d));

  console.log('\n=== 2. what is guarded ===\n');
  const scripts = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).scripts;
  const names = Object.keys(dateGuard.DATE_SENSITIVE);
  check('every guarded name is a real npm script (a misspelt one would never be guarded)', names.length >= 15 && names.every((n) => scripts[n]), names.filter((n) => !scripts[n]).join(', '));
  check('the suite the controls use is guarded', !!dateGuard.DATE_SENSITIVE[SUITE]);
  const runner = fs.readFileSync(path.join(HERE, 'verify-pass.mjs'), 'utf8');
  check('verify-pass.mjs consults the guard before starting each suite', /await dateGuard\.guardSuite\(name\)/.test(runner) && runner.indexOf('dateGuard.guardSuite(name)') < runner.indexOf('results.push(await runScript(name))'));

  console.log('\n=== 3. FORCED-FAILURE CONTROL — the real runner with a faked clock ===\n');
  const logsBefore = new Set(fs.readdirSync(path.join(HERE, '.pass-logs')));
  const startedIn = (out) => /==== verify-returns-display \(1\/1\) ====/.test(out);
  const hold = await runRunner('2026-10-01T23:59:00Z', (o) => /DATE GUARD:.*waiting/.test(o) && false, 6000 + 25000);
  const heldLine = (hold.out.match(/DATE GUARD:[^\n]*/) || [''])[0];
  check('fake 23:59:00Z: the runner announces the hold', /DATE GUARD: verify-returns-display — starting at 23:59Z would leave under 5 min before 00:00Z; waiting 660 s/.test(hold.out), heldLine);
  check('...and the suite did NOT start while held (no "window passed", no suite output)', !/window passed/.test(hold.out) && !/RETURNS DISPLAY|assertions passed/.test(hold.out), hold.out.slice(-300));
  const newDirs = fs.readdirSync(path.join(HERE, '.pass-logs')).filter((n) => !logsBefore.has(n));
  const suiteLogs = newDirs.flatMap((n) => { try { return fs.readdirSync(path.join(HERE, '.pass-logs', n)); } catch (_e) { return []; } }).filter((f) => f.startsWith(SUITE));
  check('...and no suite log was written while it was held', suiteLogs.length === 0, suiteLogs.join(', '));

  // Run to completion: stopping a suite that has started would leak its fixtures.
  const late = await runRunner('2026-10-01T00:09:57Z', (o) => /VERIFICATION PASS:/.test(o), 180000);
  const waitedMs = (late.out.match(/waiting (\d+) s/) || [])[1];
  check('fake 00:09:57Z: held inside the post-midnight window, waiting ~3 s', /DATE GUARD: verify-returns-display — starting at 00:09Z is inside the 10 min after 00:00Z; waiting 3 s/.test(late.out), (late.out.match(/DATE GUARD:[^\n]*/) || [''])[0]);
  check('...then really waited (>= 2.5 s) and started the suite', /window passed, starting/.test(late.out) && late.ms >= 2500, 'elapsed ' + late.ms + ' ms, waited ' + waitedMs + ' s');
  // The suite's OWN verdict is not the guard's business (it has flaked on the local runtime's
  // per_worker recycling — row 302); what the guard owes is that a released suite really runs.
  check('...and the suite, once released, ran to completion (a runner verdict was printed for it)', /verify-returns-display +[0-9.]+ min +(PASS|FAIL)/.test(late.out), late.out.slice(-200));

  const noon = await runRunner('2026-10-01T12:00:00Z', (o) => /VERIFICATION PASS:/.test(o), 180000);
  check('fake 12:00:00Z: no hold — the suite starts straight away and runs to completion', !/DATE GUARD/.test(noon.out) && startedIn(noon.out) && /verify-returns-display +[0-9.]+ min +(PASS|FAIL)/.test(noon.out), noon.out.slice(-300));

  console.log('\n' + passed + '/' + (passed + fails.length) + ' assertions passed.');
  console.log('DATE GUARD: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);   // explicit: runVerifyMain exits 0 on any normal return
}

runVerifyMain(main, { watchdogMs: 5 * 60 * 1000 });
