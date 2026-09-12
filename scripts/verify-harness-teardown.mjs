// Proof for lib/harness-teardown.mjs — forced-failure controls, the same way row 178's
// teardown fix was proven (pre-fix code + injected failure leaks; fixed code + identical
// failure does not). Run from scripts/:  npm run verify-harness-teardown
//
// What it proves, each against a REAL headless Chrome holding a REAL profile directory:
//   A. the normal path removes the directory AND the browser's exit was genuinely awaited
//      (exitCode/signalCode set before rmSync ran — kill() returning is not the same thing);
//   B. a harness that THROWS mid-run still has its directory removed (the exit hook);
//   C. a harness that calls process.exit() from inside a try still has it removed;
//   D. a harness that is HARD-KILLED (SIGKILL — no JavaScript runs) leaks, honestly, and the
//      next run's entry sweep removes the directory (Chrome itself dies with its parent —
//      libuv's job object — so the directory is the whole leak);
//   E. a genuinely un-removable directory (a file inside held open by another process the
//      helper cannot see by command line) produces a visible TEARDOWN WARNING naming the
//      directory — not silence, and not a false "removed";
//   F. no verify-*/audit-* script calls mkdtempSync directly any more — every temp
//      directory goes through makeTempDir, so the exit hook and the sweep cover it.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeTempDir, trackChild, releaseTempDir, sweepStale, processesReferencing } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, 'lib', 'teardown-control-child.mjs');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

// Capture the helper's own stderr lines (it reports through console.error).
function captureStderr(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  return Promise.resolve().then(fn).finally(() => { console.error = orig; }).then((r) => ({ result: r, lines }));
}

function runChild(mode, port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHILD, mode], { cwd: HERE, env: Object.assign({}, process.env, { CONTROL_PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', dir = null;
    const dirReady = new Promise((res) => {
      child.stdout.on('data', (d) => { out += d; const m = out.match(/^DIR (.+)$/m); if (m && !dir) { dir = m[1].trim(); res(dir); } });
    });
    child.stderr.on('data', (d) => { err += d; });
    const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
    resolve({ child, dirReady, exited, out: () => out, err: () => err });
  });
}

async function waitForChrome(port) {
  for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) return true; } catch (e) {} await sleep(250); }
  return false;
}

async function main() {
  // Anything a previous, interrupted run of THIS script left behind. Age 0 is safe here:
  // nothing else ever uses this prefix.
  sweepStale('mw-tdctl-', { sweepOlderThanMs: 0 });

  console.log('\nA. normal path — removal waits for the browser to genuinely exit');
  {
    const dir = makeTempDir('mw-tdctl-', { label: 'proof-A' });
    const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9471', '--user-data-dir=' + dir, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
    trackChild(dir, chrome);
    check('Chrome came up on the profile', await waitForChrome(9471));
    check('the profile directory exists while Chrome runs', existsSync(dir));
    check('Chrome had not exited before release (the pre-condition that makes B meaningful)', chrome.exitCode === null && chrome.signalCode === null);
    const { result, lines } = await captureStderr(() => releaseTempDir(dir));
    check('releaseTempDir returned true', result === true);
    check('the browser process had genuinely exited before removal ran', chrome.exitCode !== null || chrome.signalCode !== null, 'exitCode=' + chrome.exitCode + ' signalCode=' + chrome.signalCode);
    check('the profile directory is gone', !existsSync(dir), dir);
    check('no TEARDOWN WARNING on the normal path', !lines.some((l) => /TEARDOWN WARNING/.test(l)), lines.join(' | '));
    check('no process still references the profile', processesReferencing(dir).length === 0);
  }

  console.log('\nB. a harness that THROWS mid-run still removes its directory (exit hook)');
  {
    const r = await runChild('throw', 9472);
    const dir = await r.dirReady;
    check('the child reported its profile directory', !!dir, r.out());
    check('the directory existed mid-run', existsSync(dir));
    const { code } = await r.exited;
    check('the child exited non-zero on its uncaught error', code === 1, 'code=' + code);
    check('its stderr carries the real error, not a swallowed one', /deliberate mid-run failure/.test(r.err()));
    check('the directory is gone after the throw', !existsSync(dir), dir);
    check('no orphaned Chrome references it', processesReferencing(dir).length === 0);
    check('no TEARDOWN WARNING was needed', !/TEARDOWN WARNING/.test(r.err()), r.err());
  }

  console.log('\nC. a harness that calls process.exit() from inside a try still removes its directory');
  {
    const r = await runChild('exit', 9473);
    const dir = await r.dirReady;
    const { code } = await r.exited;
    check('the child exited with its own code 1', code === 1, 'code=' + code);
    check('the directory is gone after process.exit()', !existsSync(dir), dir);
    check('no orphaned Chrome references it', processesReferencing(dir).length === 0);
    check('no TEARDOWN WARNING was needed', !/TEARDOWN WARNING/.test(r.err()), r.err());
  }

  console.log('\nD. a HARD-KILLED harness leaks (no JavaScript runs) — and the next run\'s sweep removes it');
  {
    const r = await runChild('hang', 9474);
    const dir = await r.dirReady;
    process.kill(r.child.pid, 'SIGKILL');
    const { code, signal } = await r.exited;
    check('the child was killed outright', code !== 0, 'code=' + code + ' signal=' + signal);
    await sleep(500);
    check('honest: the directory is STILL there after a hard kill (nothing in-process can cover this)', existsSync(dir), dir);
    // Chrome does NOT outlive the harness: libuv spawns a Windows child inside a job object
    // that ends it when the parent dies (unless `detached`), so the leak after a hard kill is
    // the directory alone — found by this proof's first run, which had expected an orphan.
    check('Chrome died with its parent (libuv job object) — the leak is the directory only', processesReferencing(dir).length === 0, JSON.stringify(processesReferencing(dir).map((p) => p.name)));
    const { result: swept, lines } = await captureStderr(() => sweepStale('mw-tdctl-', { sweepOlderThanMs: 0 }));
    check('the next run\'s entry sweep reported the stale directory', swept.length === 1 && dir.endsWith(swept[0]), JSON.stringify(swept));
    check('the sweep said so on stderr', lines.some((l) => /teardown: swept 1 stale mw-tdctl-\* directory/.test(l)), lines.join(' | '));
    check('the directory is gone after the sweep', !existsSync(dir), dir);
  }

  console.log('\nE. a genuinely un-removable directory produces a visible warning, not silence');
  {
    const dir = makeTempDir('mw-tdctl-', { label: 'proof-E' });
    const held = join(dir, 'held.lock');
    writeFileSync(held, 'held');
    // The holder learns the path over stdin, so its command line never mentions the
    // directory — the helper's orphan hunt cannot find it, which is the point: this is a
    // lock the helper CANNOT resolve, and it must say so rather than pretend. It is held
    // from PowerShell with FileShare.None: Node itself opens files with FILE_SHARE_DELETE,
    // so a Node holder does NOT block deletion on Windows (found by this proof's first run).
    const holder = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', "$p = [Console]::In.ReadLine(); $f = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); while ($true) { Start-Sleep 1 }"], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    holder.stdin.end(held + '\n');
    await new Promise((res) => holder.stdout.on('data', (d) => { if (/HELD/.test(String(d))) res(); }));
    const { result, lines } = await captureStderr(() => releaseTempDir(dir));
    check('releaseTempDir returned false (it did not claim success)', result === false);
    check('the directory still exists (the lock genuinely held)', existsSync(dir));
    const w = lines.find((l) => /TEARDOWN WARNING/.test(l)) || '';
    check('a TEARDOWN WARNING was printed', !!w, lines.join(' | '));
    check('the warning names the directory', w.includes(dir), w);
    check('the warning names the error code', /\((EBUSY|EPERM|ENOTEMPTY)\)/.test(w), w);
    check('the warning says nothing references it by command line (the honest diagnosis)', /no process references it/.test(w), w);
    holder.kill('SIGKILL');
    await new Promise((res) => holder.on('exit', res));
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    check('control: released the lock and removed it by hand', !existsSync(dir));
  }

  console.log('\nF. no harness creates a temp directory outside the helper');
  {
    const offenders = readdirSync(HERE).filter((n) => /^(verify-|audit-).*\.mjs$/.test(n))
      .filter((n) => /mkdtempSync\s*\(/.test(readFileSync(join(HERE, n), 'utf8')));
    check('no verify-*/audit-* script calls mkdtempSync directly', offenders.length === 0, offenders.join(', '));
    const swallowers = readdirSync(HERE).filter((n) => /^(verify-|audit-).*\.mjs$/.test(n))
      .filter((n) => /rmSync\((profile|tempDir|dir)\b[^\n]*force:\s*true[^\n]*\}\s*\)\s*;?\s*\}\s*catch\s*\([^)]*\)\s*\{\s*\}/.test(readFileSync(join(HERE, n), 'utf8')));
    check('no harness swallows a failed temp-dir removal with an empty catch any more', swallowers.length === 0, swallowers.join(', '));
  }

  const stray = readdirSync(tmpdir()).filter((n) => n.startsWith('mw-tdctl-'));
  check('this proof left no mw-tdctl-* directory of its own behind', stray.length === 0, stray.join(', '));

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed) { console.log('HARNESS TEARDOWN: FAIL'); process.exit(1); }
  console.log('HARNESS TEARDOWN: PASS');
}

runVerifyMain(main, { watchdogMs: 300000 });
