// Shared temp-directory teardown for every harness that creates one (2026-09-12).
//
// WHY THIS EXISTS. A cleanup pass found 1,333 leaked harness directories in %TEMP% — 684
// headless-Chrome profiles (mw-*) and 649 jsdom temp-module dirs (ms-*) — accumulated over
// weeks with nothing reporting it. Two causes, both of which this module is built around:
//
//   1. `chrome.kill()` RETURNS BEFORE WINDOWS RELEASES THE PROFILE'S LOCK FILES. Every
//      harness called rmSync() on the very next line, while the browser process was still
//      being torn down, so the delete hit EBUSY/EPERM on the lock/LevelDB files. kill() is
//      a request; the exit event is the fact. Removal here waits for the real exit first.
//   2. `try { rmSync(dir, { force: true }) } catch (e) {}` SWALLOWED THAT FAILURE. A leak
//      per run, for weeks, and not one line of output said so. Nothing here swallows a
//      failed removal: it prints a TEARDOWN WARNING to stderr naming the directory and the
//      error code. A warning nobody reads is still better than silence — a run that leaks
//      should say so.
//
// Seven visual harnesses never called rmSync at all, and verify-admin-real-login /
// verify-password-reset-flow could throw between mkdtemp and the finally that would have
// removed the dir. So a directory is REGISTERED THE MOMENT IT IS CREATED, and three paths
// then cover it:
//
//   - the normal path: `await releaseTempDir(dir)` (or `await releaseAll()`), which closes
//     any attached socket, kills any attached child, awaits its genuine exit, removes with
//     Node's own EBUSY/EPERM retry loop, and if that still fails, looks for processes whose
//     command line references the directory (a Chrome grandchild that outlived kill()),
//     ends them by PID — each one logged by name and command line — and retries once;
//   - a process 'exit' hook: a throw, an uncaught rejection or a process.exit() mid-run
//     lands here, where the same removal runs SYNCHRONOUSLY (an exit handler cannot await;
//     rmSync's built-in retry loop is what gives the just-killed browser time to let go);
//   - an ENTRY SWEEP in makeTempDir(): a hard kill (taskkill /F, a machine freeze) runs no
//     JavaScript at all, so nothing in-process can cover it. The next run of any harness
//     using the same prefix removes stale siblings — and ends any orphaned browser still
//     holding one — so a hard-killed run leaks only until the next run, never for weeks.
//
// A leaked directory does NOT change the process exit code. The warning is the contract;
// callers that want a leak to fail the run can check the boolean releaseTempDir() returns.
//
// USAGE
//   import { makeTempDir, trackChild, releaseTempDir } from './lib/harness-teardown.mjs';
//   const profile = makeTempDir('mw-example-');            // registered immediately
//   const chrome = spawn(CHROME, ['--user-data-dir=' + profile, ...]);
//   trackChild(profile, chrome, ws);                       // ws optional
//   ...
//   await releaseTempDir(profile);                         // true if removed, false if not
//
// PROVEN by scripts/verify-harness-teardown.mjs with forced-failure controls: a mid-run
// throw and a mid-run process.exit() both still remove the directory; a hard-killed run's
// directory (and its orphaned Chrome) is removed by the next run's sweep; a genuinely
// un-removable directory (a file held open by another process) produces a visible
// TEARDOWN WARNING rather than silence.

import { mkdtempSync, rmSync, renameSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const registry = new Map(); // dir -> { label, child, ws }
let exitHookInstalled = false;
let leaked = 0;

// Removal with an EXPLICIT retry loop. Node's own rmSync({maxRetries}) is not enough here:
// on Windows it handles EPERM on a file with a single chmod-and-retry (not the backoff loop,
// which only covers EBUSY/ENOTEMPTY), so the first attempt — made a few milliseconds after
// TerminateProcess, while Chrome's GPU/network children are still letting go of the cache
// and LevelDB files — fails outright. Measured: 250ms after kill() the same removal
// succeeds. The loop below sleeps synchronously (Atomics.wait) so it works identically in
// the async path and inside a process 'exit' handler, which cannot await anything.
const RM_ATTEMPTS = 24;      // x 250ms = 6s budget
const RM_DELAY_MS = 250;
const HELD = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES']);

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function warn(msg) { console.error('TEARDOWN WARNING: ' + msg); }

function tryRm(dir) {
  let last = null;
  for (let i = 0; i < RM_ATTEMPTS; i++) {
    if (i > 0) sleepSync(RM_DELAY_MS);
    try { rmSync(dir, { recursive: true, force: false, maxRetries: 0 }); return null; }
    catch (e) {
      if (!e || e.code === 'ENOENT') return null;
      last = e;
      if (!HELD.has(e.code)) return e;
    }
  }
  return last;
}

// Processes whose command line references this exact directory. On Windows that is what a
// spawned Chrome (or one of its children) looks like: `--user-data-dir=<dir>`. Returned as
// {pid, name, cmd} so a kill can be logged by command line, never done blind by name.
export function processesReferencing(dir) {
  try {
    if (process.platform === 'win32') {
      // -like with the path as a literal: escape PowerShell's own wildcard characters and the
      // quote. Backslashes are not special to -like.
      const lit = dir.replace(/'/g, "''").replace(/([\[\]\*\?])/g, '`$1');
      const script = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" + lit + "*' } | ForEach-Object { '' + $_.ProcessId + '|' + $_.Name + '|' + $_.CommandLine }";
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
      return out.split(/\r?\n/).filter(Boolean).map((line) => {
        const [pid, name, ...rest] = line.split('|');
        return { pid: Number(pid), name, cmd: rest.join('|') };
      }).filter((p) => p.pid && p.pid !== process.pid && !/Get-CimInstance Win32_Process/.test(p.cmd)); // not the enumerator itself
    }
    const out = execFileSync('ps', ['-eo', 'pid=,comm=,args='], { encoding: 'utf8', timeout: 20000 });
    return out.split('\n').filter((l) => l.includes(dir)).map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), name: m[2], cmd: m[3] } : null;
    }).filter((p) => p && p.pid !== process.pid && !/ps.*-eo/.test(p.cmd));
  } catch (e) {
    warn('could not enumerate processes referencing ' + dir + ' (' + (e && e.message) + ')');
    return [];
  }
}

function killByPid(p, why) {
  console.error('teardown: ending ' + p.name + ' (pid ' + p.pid + ') — ' + why + ' :: ' + p.cmd.slice(0, 160));
  try { process.kill(p.pid, 'SIGKILL'); return true; }
  catch (e) { warn('could not end pid ' + p.pid + ' (' + (e && e.code) + ')'); return false; }
}

// Synchronous removal with the orphan hunt. Used by the exit hook and the sweep, and as the
// final step of the async path once the child's exit has genuinely been awaited.
function removeSync(dir, label) {
  let err = tryRm(dir);
  if (!err) return true;
  const holders = processesReferencing(dir);
  if (holders.length) {
    for (const p of holders) killByPid(p, 'still referencing ' + basename(dir) + ' after teardown');
    err = tryRm(dir);
    if (!err) return true;
  }
  leaked++;
  warn('[' + label + '] temp directory NOT removed (' + (err.code || err.message) + '): ' + dir +
       (holders.length ? '' : ' — no process references it by command line; something else holds a file open inside it'));
  return false;
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const [dir, entry] of registry) {
      if (entry.ws) { try { entry.ws.close(); } catch (e) {} }
      if (entry.child && entry.child.exitCode === null && entry.child.signalCode === null) {
        try { entry.child.kill(); } catch (e) {}
      }
      // An exit handler cannot await the child's exit event; tryRm()'s own retry loop (a
      // 6s budget, sleeping synchronously) is the time a just-killed browser gets to let go.
      removeSync(dir, entry.label + ' (exit hook)');
      registry.delete(dir);
    }
    if (leaked) console.error('TEARDOWN: ' + leaked + ' temp director' + (leaked === 1 ? 'y' : 'ies') + ' leaked this run — see TEARDOWN WARNING lines above');
  });
}

// Remove stale siblings of this prefix left by a hard-killed earlier run. Two guards keep a
// concurrently running sibling safe: it must be older than sweepOlderThanMs, and it must
// rename cleanly first — Windows refuses to rename a directory with an open handle inside it,
// which is exactly the state of a live Chrome profile.
export function sweepStale(prefix, { sweepOlderThanMs = 10 * 60 * 1000, label = prefix } = {}) {
  const base = tmpdir();
  let names;
  try { names = readdirSync(base).filter((n) => n.startsWith(prefix)); } catch (e) { return []; }
  const swept = [];
  const now = Date.now();
  for (const n of names) {
    const dir = join(base, n);
    let st;
    try { st = statSync(dir); } catch (e) { continue; }
    if (!st.isDirectory() || now - st.mtimeMs < sweepOlderThanMs) continue;
    for (const p of processesReferencing(dir)) killByPid(p, 'orphaned by a hard-killed earlier run, still holding ' + n);
    const moved = dir + '.sweep';
    try { renameSync(dir, moved); }
    catch (e) { console.error('teardown: skipping ' + n + ' — rename refused (' + e.code + '), a live process may still hold it'); continue; }
    if (removeSync(moved, label + ' (sweep)')) swept.push(n);
  }
  if (swept.length) console.error('teardown: swept ' + swept.length + ' stale ' + prefix + '* director' + (swept.length === 1 ? 'y' : 'ies') + ' from an earlier run');
  return swept;
}

// Create and REGISTER a temp directory. Registration is what makes the exit hook cover it,
// so this must be the call site's first act — nothing between creation and registration.
export function makeTempDir(prefix, opts = {}) {
  sweepStale(prefix, opts);
  const dir = mkdtempSync(join(tmpdir(), prefix));
  trackTempDir(dir, { label: opts.label || prefix });
  return dir;
}

export function trackTempDir(dir, { label = basename(dir) } = {}) {
  installExitHook();
  if (!registry.has(dir)) registry.set(dir, { label, child: null, ws: null });
  return dir;
}

// Attach the browser (and optionally its CDP socket) whose lifetime is tied to the dir.
export function trackChild(dir, child, ws = null) {
  if (!registry.has(dir)) trackTempDir(dir);
  const entry = registry.get(dir);
  entry.child = child;
  if (ws) entry.ws = ws;
}

function childExited(child) { return child.exitCode !== null || child.signalCode !== null; }

async function awaitExit(child, timeoutMs) {
  if (childExited(child)) return true;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(t); resolve(true); });
  });
}

// The normal path. Returns true if the directory is gone, false if it leaked (already
// reported). Safe to call twice; safe on a dir that was never registered.
export async function releaseTempDir(dir, { exitTimeoutMs = 10000 } = {}) {
  const entry = registry.get(dir) || { label: basename(dir), child: null, ws: null };
  if (entry.ws) { try { entry.ws.close(); } catch (e) {} entry.ws = null; }
  if (entry.child) {
    if (!childExited(entry.child)) { try { entry.child.kill(); } catch (e) {} }
    const exited = await awaitExit(entry.child, exitTimeoutMs);
    if (!exited) warn('[' + entry.label + '] child process did not exit within ' + exitTimeoutMs + 'ms after kill(); attempting removal anyway');
    entry.child = null;
  }
  const ok = removeSync(dir, entry.label);
  registry.delete(dir);
  return ok;
}

export async function releaseAll() {
  let ok = true;
  for (const dir of Array.from(registry.keys())) ok = (await releaseTempDir(dir)) && ok;
  return ok;
}

export function leakedCount() { return leaked; }
export function trackedDirs() { return Array.from(registry.keys()); }

// For a parent harness that spawnSync()s a child harness (the visual suites run
// verify-contrast.mjs and audit-fonts.mjs as children): re-emit the child's own teardown
// lines on the parent's stderr. A parent that prints only the child's last stdout line
// would otherwise discard a child's TEARDOWN WARNING — silence again, one level up.
export function forwardChildTeardown(res, label) {
  const err = (res && res.stderr) || '';
  for (const line of String(err).split(/\r?\n/)) {
    if (/TEARDOWN|teardown:/.test(line)) console.error('[' + label + '] ' + line);
  }
}
