#!/usr/bin/env node
// verify-no-functions-read — the standing proof for lib/no-functions-read.cjs (register row 255,
// finished 2026-10-01).
//
// Why the guard exists: a host-side read of ANY file under supabase/functions stamps its NTFS
// last-access time, the `supabase functions serve` watcher reports it as a WRITE, and the edge
// runtime is destroyed and recreated mid-pass. Twelve places in the suites did it (eleven fs
// reads and one dynamic import()); all now go through lib/function-source.cjs (git show HEAD:)
// or lib/local-secrets.cjs. The runner (verify-pass.mjs) preloads the guard into every suite.
//
// What this proves, each against an UNGUARDED control so a pass cannot be vacuous:
//   - every access shape is refused with EROW255 when guarded (fs sync/async/promises, readdir,
//     an ESM import, a CommonJS require, a file: URL), and fails with an ORDINARY error unguarded
//   - every probe targets a path that does NOT exist, so even a broken guard cannot touch the
//     real tree (an ENOENT stamps nothing) — the proof can never cause the restart it guards against
//   - reads elsewhere, a lookalike sibling directory, and unrelated module loads are untouched
//   - the runner really injects the guard and really fails a suite that printed a guard line
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(HERE, 'lib', 'no-functions-read.cjs');
// What the runner puts into NODE_OPTIONS — forward slashes, because a backslash inside a quoted
// NODE_OPTIONS value is an escape (the first run of this suite caught the runner breaking on it).
const PRELOAD_FOR_NODE_OPTIONS = PRELOAD.replace(/\\/g, '/');
let passed = 0; const fails = [];
const check = (label, ok, detail) => { if (ok) { passed++; console.log('  PASS  ' + label); } else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); } };

// Each probe prints the error code it got (or OK), nothing else.
const PROBES = {
  'fs.readFileSync':          ['cjs', "require('fs').readFileSync('../supabase/functions/__guard_probe__')"],
  'fs.readFile (callback)':   ['cjs', "await new Promise((res, rej) => require('fs').readFile('../supabase/functions/__guard_probe__', (e) => e ? rej(e) : res()))"],
  'fs.promises.readFile':     ['esm', "await (await import('node:fs/promises')).readFile('../supabase/functions/__guard_probe__')"],
  'ESM named readFileSync':   ['esm', "(await import('node:fs')).readFileSync('../supabase/functions/__guard_probe__')"],
  'fs.readdirSync':           ['cjs', "require('fs').readdirSync('../supabase/functions/__guard_probe_dir__')"],
  'fs.createReadStream':      ['cjs', "await new Promise((res, rej) => { const s = require('fs').createReadStream('../supabase/functions/__guard_probe__'); s.on('error', rej); s.on('open', res); })"],
  'absolute forward-slash':   ['cjs', "require('fs').readFileSync(require('path').resolve('..').replace(/\\\\/g, '/') + '/supabase/functions/__guard_probe__')"],
  'ESM relative import()':    ['esm', "await import('../supabase/functions/_shared/__guard_probe__.ts')"],
  'ESM file: URL import()':   ['esm', "await import(require('url').pathToFileURL(require('path').resolve('../supabase/functions/__guard_probe__.mjs')).href)"],
  'CommonJS require':         ['cjs', "require('../supabase/functions/_shared/__guard_probe__.js')"]
};
function runProbe(kind, body, guarded) {
  const wrapped = kind === 'esm'
    ? "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); try { " + body + "; console.log('OK'); } catch (e) { console.log(e.code || e.message); }"
    : "(async () => { try { " + body + "; console.log('OK'); } catch (e) { console.log(e.code || e.message); } })();";
  const args = (guarded ? ['--require', PRELOAD] : []).concat(kind === 'esm' ? ['--input-type=module', '-e', wrapped] : ['-e', wrapped]);
  const r = spawnSync(process.execPath, args, { cwd: HERE, encoding: 'utf8', env: Object.assign({}, process.env, { NODE_OPTIONS: '' }) });
  return { code: (r.stdout || '').trim().split(/\r?\n/).pop(), stderr: r.stderr || '' };
}

async function main() {
  console.log('\n=== 1. every access shape: refused when guarded, an ordinary error when not ===\n');
  for (const [label, [kind, body]] of Object.entries(PROBES)) {
    const g = runProbe(kind, body, true);
    const u = runProbe(kind, body, false);
    check(label + ': guarded → EROW255', g.code === 'EROW255', 'got ' + g.code);
    check(label + ': unguarded control → an ordinary error, NOT EROW255 (the probe is not vacuous)', u.code && u.code !== 'EROW255' && u.code !== 'OK', 'got ' + u.code);
    if (label === 'fs.readFileSync') check('the refusal prints the guard marker line to stderr, so a swallowed error still reaches the log', /ROW 255 GUARD:/.test(g.stderr));
  }

  console.log('\n=== 2. nothing else is affected ===\n');
  const ok1 = runProbe('cjs', "require('fs').readFileSync('package.json')", true);
  check('a read outside supabase/functions still works', ok1.code === 'OK', 'got ' + ok1.code);
  const ok2 = runProbe('cjs', "require('fs').readFileSync('../supabase/functions-lookalike/__x__')", true);
  check('a lookalike sibling directory is not mistaken for it (ENOENT, not EROW255)', ok2.code === 'ENOENT', 'got ' + ok2.code);
  const ok3 = runProbe('esm', "await import('./lib/run-verify.mjs')", true);
  check('an unrelated module import still loads', ok3.code === 'OK', 'got ' + ok3.code);
  const ok4 = runProbe('cjs', "require('fs').statSync('../supabase/functions')", true);
  check('metadata-only stat is allowed (it does not update last-access)', ok4.code === 'OK', 'got ' + ok4.code);

  console.log('\n=== 3. the runner really wires it ===\n');
  const runner = fs.readFileSync(path.join(HERE, 'verify-pass.mjs'), 'utf8');
  check('verify-pass.mjs preloads lib/no-functions-read.cjs through NODE_OPTIONS', /NODE_OPTIONS[^\n]*--require[^\n]*GUARD_PRELOAD/.test(runner) && /no-functions-read\.cjs/.test(runner));
  const guardLine = runner.split(/\r?\n/).find((l) => l.startsWith('const GUARD_PRELOAD =')) || '';
  check('verify-pass.mjs builds the NODE_OPTIONS path with forward slashes (a backslash there is an escape and breaks every suite)', guardLine.includes(".replace(/\\\\/g, '/')"), guardLine);
  check('verify-pass.mjs fails a suite whose output carries a guard line even on exit 0, matched at LINE START only (so a label quoting the marker cannot fail itself)', /startsWith\('ROW 255 GUARD:'\)/.test(runner) && /'GUARD'/.test(runner));
  const inherited = spawnSync(process.execPath, ['-e', "require('fs').readFileSync('../supabase/functions/__guard_probe__')"], { cwd: HERE, encoding: 'utf8', env: Object.assign({}, process.env, { NODE_OPTIONS: '--require "' + PRELOAD_FOR_NODE_OPTIONS + '"' }) });
  check('a CHILD process inherits the guard through NODE_OPTIONS (contrast/fonts children are covered)', /EROW255|ROW 255 GUARD/.test(inherited.stderr || ''), (inherited.stderr || '').slice(0, 120));

  console.log('\n' + passed + '/' + (passed + fails.length) + ' assertions passed.');
  console.log('NO FUNCTIONS READ: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);   // explicit: runVerifyMain exits 0 on any normal return
}

runVerifyMain(main);
