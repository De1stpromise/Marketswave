// build-tailwind.mjs — compiles the ONE static Tailwind stylesheet the logged-in pages link.
// App-feel programme stage 1.5, fix 2 (2026-09-21, register row 260; PERFORMANCE_AUDIT.md
// finding #4).
//
// WHY. Until this, 24 pages loaded the Tailwind PLAY CDN — 124 KB of render-blocking script that
// scanned the DOM and JIT-compiled the page's CSS on the main thread on every load, and the single
// largest variance source the audit measured (346 ms to 10,975 ms for the same resource). The play
// CDN is a prototyping tool; this compiles the same Tailwind 3.4.17, with the same configuration,
// into a static sheet once.
//
// NOT A BUILD PIPELINE. The output is committed; nothing runs at deploy time. It is re-run
// deliberately whenever a page gains a class the sheet does not yet contain — and the guard
// (verify-tailwind-color-scoping.js) rebuilds to a temp file and byte-compares on every pass, so a
// forgotten rebuild fails the gate by name instead of shipping a class that silently does nothing.
//
// WHAT IS PRODUCED: ../tailwind-<version>.css — the version in the filename so an upgrade is a
// visible rename in the diff, at the root (no exclude-prefix collision with _config.yml, row 256).
// Linked as the LAST stylesheet in <head>: measured on the live site, the play CDN appended its
// generated <style> after every other stylesheet (it compiles asynchronously, after the parser has
// finished <head>), so utilities WIN equal-specificity contests against control-patterns.css,
// glass-primitives.css and a page's own <style>. The link's position preserves that; moving it
// earlier would silently flip those contests.
//
// Usage (from scripts/):  npm run build-tailwind            # writes ../tailwind-3.4.17.css
//                         node build-tailwind.mjs --out <file>   # (the guard's temp build)
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const TAILWIND_VERSION = JSON.parse(readFileSync(join(HERE, 'node_modules/tailwindcss/package.json'), 'utf8')).version;
export const OUTPUT = join(ROOT, 'tailwind-' + TAILWIND_VERSION + '.css');
export const OUTPUT_HREF = 'tailwind-' + TAILWIND_VERSION + '.css';

export function buildTailwind(outFile = OUTPUT) {
  const cli = join(HERE, 'node_modules/tailwindcss/lib/cli.js');
  if (!existsSync(cli)) throw new Error('tailwindcss is not installed — run npm install in scripts/');
  // process.execPath + the CLI's own entry, no shell: the flags reach the compiler verbatim.
  execFileSync(process.execPath, [cli, '-c', join(HERE, 'tailwind/tailwind.config.js'), '-i', join(HERE, 'tailwind/tailwind.input.css'), '-o', outFile, '--minify'],
    { stdio: ['ignore', 'ignore', 'pipe'], cwd: HERE });
  const css = readFileSync(outFile, 'utf8');
  if (!/--tw-/.test(css) || css.length < 10000) throw new Error('the compiled sheet looks empty (' + css.length + ' bytes) — check the content globs in tailwind/tailwind.config.js');
  return outFile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--out');
  const out = buildTailwind(i > 0 ? process.argv[i + 1] : OUTPUT);
  const bytes = readFileSync(out).length;
  console.log('wrote ' + out.replace(ROOT, '').replace(/\\/g, '/') + ' — tailwindcss ' + TAILWIND_VERSION + ', ' + (bytes / 1024).toFixed(1) + ' KB');
}
