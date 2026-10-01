#!/usr/bin/env node
// run-round-robin.mjs — the npm entry point for verify-round-robin-refresh (register row 214,
// built 2026-10-01). It runs the suite as a CHILD process and, when the child exits — cleanly,
// with a failure, killed, or aborted with 0xC0000409 — replays the suite's journal through
// lib/round-robin-restore.mjs: cron jobs re-activated, cache timestamps put back, the test client
// and product removed. That is what makes "a crashed round-robin can never leave cron paused"
// true: the restore no longer lives inside the process that crashes.
//
//   npm run verify-round-robin-refresh          — the bounded default (~10 min)
//   npm run verify-round-robin-refresh-full     — the complete 10-cycle run (~45-60 min)
// The exit code is the suite's own; if the restore could not put everything back, it is 1 even
// when the suite passed, because a passing suite that leaves cron paused is not a pass.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreFromJournal } from './lib/round-robin-restore.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [suiteFile, ...suiteArgs] = process.argv.slice(2);
if (!suiteFile) { console.error('usage: node run-round-robin.mjs verify-round-robin-refresh.mjs [--full]'); process.exit(2); }

const t0 = Date.now();
// The suite imports supabase-data.js, whose CDN import needs the project's loader (the flag the
// npm script used to pass directly).
const child = spawn(process.execPath, ['--experimental-loader', './lib/esm-loader-supabase-cdn.mjs', path.join(HERE, suiteFile), ...suiteArgs], { cwd: HERE, stdio: 'inherit' });
child.on('exit', async (code, signal) => {
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('\n[run-round-robin] suite exited ' + (signal ? 'by signal ' + signal : 'with code ' + code) + ' after ' + mins + ' min — running the external restore');
  let ok = false;
  try { ok = (await restoreFromJournal()).ok; } catch (e) { console.log('ROUND-ROBIN RESTORE: FAILED — ' + e.message); }
  process.exit(!ok ? 1 : (code === null ? 1 : code));
});
