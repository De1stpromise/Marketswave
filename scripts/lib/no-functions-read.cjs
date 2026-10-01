// no-functions-read.cjs — a RUNTIME guard: any filesystem read under supabase/functions fails.
//
// Register row 255 (finished 2026-10-01). A host-side read of any file under supabase/functions
// stamps NTFS last-access, the `functions serve` watcher reports it as a WRITE, and the edge
// runtime is recreated — taking the suite in flight (or the next one) down with 502s. Eleven
// places did it; they now use function-source.cjs (git show HEAD:) and local-secrets.cjs. This
// guard keeps a twelfth from creeping back in.
//
// HOW IT IS LOADED: verify-pass.mjs puts `--require <this file>` into NODE_OPTIONS for every
// suite, and NODE_OPTIONS is inherited by every node child a suite spawns (contrast, fonts,
// sheen). A RUNTIME check rather than a static scan, because the paths are built dynamically
// (path.join(__dirname, '..', 'supabase', 'functions', name, 'index.ts')) and a scan would have
// to guess at them.
//
// THE CHECK RUNS BEFORE THE OPEN. A blocked read never reaches the filesystem, so the guard
// cannot itself stamp the file it is protecting. Metadata-only calls (stat, exists) are left
// alone: they do not update last-access. Reads of the tree by other processes (git, which reads
// .git/objects; the supabase CLI) are untouched, since this lives only inside node.
//
// A violation throws an Error whose message starts "ROW 255 GUARD" and names the path, and is
// also printed once to stderr — so a suite that swallows the error still leaves the line in its
// log for the runner (and a reader) to find.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const FUNCTIONS_DIR = path.resolve(__dirname, '..', '..', 'supabase', 'functions');
const norm = (p) => path.resolve(String(p)).replace(/\//g, '\\').toLowerCase();
const PREFIX = norm(FUNCTIONS_DIR);

function isUnder(p) {
  if (p == null || typeof p === 'number') return false;           // a file descriptor: checked at open
  let s;
  if (p instanceof URL) s = require('node:url').fileURLToPath(p);
  else if (Buffer.isBuffer(p)) s = p.toString();
  else s = String(p);
  const n = norm(s);
  return n === PREFIX || n.startsWith(PREFIX + '\\');
}

function refuse(op, p) {
  const msg = 'ROW 255 GUARD: ' + op + ' under supabase/functions is not allowed at runtime — ' + String(p) +
    ' (use lib/function-source.cjs for source, lib/local-secrets.cjs for secrets)';
  try { process.stderr.write(msg + '\n'); } catch (_e) { /* best effort */ }
  const e = new Error(msg); e.code = 'EROW255'; return e;
}

const READS = ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream', 'readdirSync', 'readdir', 'opendirSync', 'opendir', 'cpSync', 'cp', 'copyFileSync', 'copyFile'];
for (const name of READS) {
  const orig = fs[name];
  if (typeof orig !== 'function') continue;
  fs[name] = function guarded(p, ...rest) {
    if (isUnder(p)) {
      const err = refuse(name, p);
      const cb = rest.length && typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1] : null;
      if (cb && !name.endsWith('Sync') && name !== 'createReadStream') { process.nextTick(cb, err); return undefined; }
      throw err;
    }
    return orig.call(this, p, ...rest);
  };
}
for (const name of ['readFile', 'open', 'readdir', 'opendir', 'cp', 'copyFile']) {
  const orig = fs.promises[name];
  if (typeof orig !== 'function') continue;
  fs.promises[name] = function guarded(p, ...rest) {
    if (isUnder(p)) return Promise.reject(refuse('promises.' + name, p));
    return orig.call(this, p, ...rest);
  };
}

// ESM named imports (`import { readFileSync } from 'node:fs'`) are bound separately from the
// CommonJS object; without this the .mjs suites would keep the unpatched functions.
require('node:module').syncBuiltinESMExports();

// MODULE LOADS. Node's module loader reads source through its own internals, never the patched
// fs above, so `import('../supabase/functions/_shared/x.ts')` (or a require of one) slipped past
// the fs guard entirely — verify-inbound-webhook-signature did exactly that until 2026-10-01.
// registerHooks() (synchronous, usable from a --require preload) refuses the RESOLVED file before
// the loader opens it.
const nodeModule = require('node:module');
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      // Path-style specifiers are checked BEFORE resolution, so a refused target is never even
      // stat'ed; bare specifiers are checked on what they resolve to.
      if (/^(\.{1,2}[\\/]|[\\/]|file:|[A-Za-z]:[\\/])/.test(specifier)) {
        let target = null;
        try {
          target = specifier.startsWith('file:') ? new URL(specifier)
            : /^[A-Za-z]:[\\/]|^[\\/]/.test(specifier) ? require('node:url').pathToFileURL(specifier)
            : new URL(specifier, context.parentURL || require('node:url').pathToFileURL(process.cwd() + '/'));
        } catch (_e) { target = null; }
        if (target && target.protocol === 'file:' && isUnder(target)) throw refuse('module load', specifier);
      }
      const r = nextResolve(specifier, context);
      if (r && typeof r.url === 'string' && r.url.startsWith('file:') && isUnder(new URL(r.url))) throw refuse('module load', r.url);
      return r;
    }
  });
}

module.exports = { FUNCTIONS_DIR, isUnder };
