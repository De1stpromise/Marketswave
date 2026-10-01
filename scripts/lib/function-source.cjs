// function-source.cjs — read Edge Function source WITHOUT touching supabase/functions on disk.
//
// Register row 255 (2026-09-20, finished 2026-10-01): any host-side READ of a file under
// supabase/functions stamps its NTFS last-access time, the `supabase functions serve` watcher
// reports that as a WRITE, and the edge runtime is destroyed and recreated — so a suite that
// reads function source in place 502s itself, or the next suite, mid-pass. Observed again on
// 2026-10-01: verify-pm-compose-announcements' two reads restarted the runtime at 00:21:3xZ.
//
// The committed object database is a different file entirely: `git show HEAD:<path>` reads the
// blob out of .git/objects, never the working-tree file, so the watcher sees nothing. The cost,
// stated rather than hidden: this returns the COMMITTED source, so an uncommitted edit to a
// function is invisible to a suite until it is committed. That is the same trade
// supabase-verify-product-catalog and supabase-verify-pm-attribution already make.
//
// Usage (CommonJS):  const { readFunctionSource } = require('./lib/function-source.cjs');
// Usage (ESM):       import fnSource from './lib/function-source.cjs'; fnSource.readFunctionSource(...)
//   readFunctionSource('send-announcement/index.ts')   — path relative to supabase/functions/
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readFunctionSource(relPath) {
  const rel = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('..')) throw new Error('readFunctionSource: path must stay inside supabase/functions: ' + relPath);
  try {
    return execFileSync('git', ['show', 'HEAD:supabase/functions/' + rel], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error('readFunctionSource: could not read supabase/functions/' + rel + ' from HEAD — is it committed? ' + ((e.stderr || e.message || '') + '').trim());
  }
}

/** The function directory names in HEAD (excluding _shared), from git — never a readdir of the tree. */
function listFunctionNames() {
  const out = execFileSync('git', ['ls-tree', '-d', '--name-only', 'HEAD', 'supabase/functions/'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).map((p) => p.replace(/^supabase\/functions\//, '')).filter((n) => n !== '_shared').sort();
}

module.exports = { readFunctionSource, listFunctionNames, REPO_ROOT };
