// vendor-supabase-js.mjs — produces the ONE self-hosted supabase-js bundle the site loads.
// App-feel programme stage 1.5, fix 1 (2026-09-21, register row 258; PERFORMANCE_AUDIT.md
// finding #1).
//
// WHY. Until this, every page reached the SDK through
//   import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'
// which esm.sh resolved as SEVENTEEN module requests (four of them node polyfills), fetched
// only once a page's own script ran its dynamic import() — on dashboard.html the shell painted
// at 2.0 s and the first backend call could not start until 4.16 s. This script bundles the
// EXACT version already installed in scripts/node_modules (the one every suite tests against)
// into a single ES module with zero external imports, committed at
//   vendor/supabase-js-<version>.min.js
// and modulepreloaded from every page's <head>, so it downloads beside Tailwind and the fonts
// instead of after the shell.
//
// NOT A BUILD PIPELINE. This is a one-time recipe, re-run deliberately: the bundle is committed,
// nothing runs at deploy time, and a version bump is `npm install @supabase/supabase-js@<new>`
// then `npm run vendor-supabase-js`, then commit the diff and repoint the three import sites
// (supabase-config.js, admin-supabase-config.js, reset-password.html) and the modulepreload
// links, whose filenames carry the version on purpose so an upgrade is visible in the diff.
//
// THE OUTPUT PATH IS LOAD-BEARING (row 256's prefix trap): _config.yml excludes `supabase/` and
// Jekyll matches exclude entries by PREFIX — a bundle named `supabase-js.min.js` at the root
// would have been excluded by the first version of that file and taken every page down.
// `vendor/` shares a prefix with nothing in the exclude list. `.js` rather than `.mjs` so the
// served MIME type is not a bet on GitHub Pages — a module script silently fails on a wrong one.
//
// WHAT IS CHECKED, not assumed: the output contains no import/require of anything, and the only
// node globals it references are guarded (`typeof Buffer` — verified once by hand, re-verified
// here on every run, since a future SDK version could add an unguarded one).
//
// Usage (from scripts/):  npm run vendor-supabase-js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const pkg = JSON.parse(readFileSync(join(HERE, 'node_modules/@supabase/supabase-js/package.json'), 'utf8'));
const esbuildPkg = JSON.parse(readFileSync(join(HERE, 'node_modules/esbuild/package.json'), 'utf8'));
const version = pkg.version;
const entry = join(HERE, 'node_modules/@supabase/supabase-js/dist/index.mjs');
const outDir = join(ROOT, 'vendor');
const out = join(outDir, 'supabase-js-' + version + '.min.js');
mkdirSync(outDir, { recursive: true });

const { buildSync } = await import('esbuild');   // the pinned devDependency in scripts/package.json
buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', outfile: out, logLevel: 'warning' });

let code = readFileSync(out, 'utf8');
// Verification — a bundle that still reaches for the network or an unguarded node global is
// exactly the silent failure this exists to remove.
const externalImports = code.match(/\bfrom\s*"[^"]+"|\bimport\s*\(?"[^"]+"|\brequire\(/g) || [];
if (externalImports.length) throw new Error('the bundle still has external references: ' + externalImports.slice(0, 5).join(', '));
const bufferUses = (code.match(/\bBuffer\./g) || []).length;
const bufferGuards = (code.match(/typeof Buffer/g) || []).length;
if (bufferUses > bufferGuards) throw new Error('an unguarded Buffer reference would throw in the browser (' + bufferUses + ' uses, ' + bufferGuards + ' guards)');
const processUses = (code.match(/[^A-Za-z_$."'`]process\.[A-Za-z]/g) || []).length;
if (processUses) throw new Error('an unguarded process.* reference would throw in the browser');

const header = '/* @supabase/supabase-js ' + version + ' — self-hosted single-file ES module bundle. Built by scripts/vendor-supabase-js.mjs with esbuild ' + esbuildPkg.version +
  ' from scripts/node_modules (row 258). Do not edit; regenerate with `npm run vendor-supabase-js` in scripts/. */\n';
writeFileSync(out, header + code);
const bytes = Buffer.byteLength(header + code);
console.log('wrote ' + out.replace(ROOT, '').replace(/\\/g, '/') + ' — @supabase/supabase-js ' + version + ', ' + (bytes / 1024).toFixed(1) + ' KB, zero external imports');
console.log('now repoint the three import sites and the modulepreload links if the version changed:');
console.log('  grep -rn "vendor/supabase-js-" *.html *.js | grep -v ' + version);
