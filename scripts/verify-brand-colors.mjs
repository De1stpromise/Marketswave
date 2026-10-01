#!/usr/bin/env node
// verify-brand-colors — keeps the brand palette in ONE place (row 303, 2026-10-01).
//
// The palette lives in scripts/brand/brand-colors.json. Generated from it: brand-tokens.css,
// brand-colors.js, supabase/functions/_shared/brand-colors.ts, supabase/templates/recovery.html;
// the Tailwind config reads it directly. This fails if:
//   1. any brand colour — as hex, or as its rgb()/rgba() channels — appears in a shipped file
//      (root .html/.css/.js, Edge Function source, the auth templates, the Tailwind config) other
//      than those generated outputs and the compiled Tailwind sheet;
//   2. a generated file is out of date with the JSON (build-brand --check);
//   3. a page does not link brand-tokens.css and brand-colors.js before its own styles/scripts.
// Forced-failure controls (part 4) inject each fault into a temporary copy and require the
// scanner to name it — a scan that found nothing because it read nothing would otherwise pass.
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';
import { makeTempDir, releaseTempDir } from './lib/harness-teardown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const { colors } = JSON.parse(fs.readFileSync(path.join(HERE, 'brand', 'brand-colors.json'), 'utf8'));
const GENERATED = new Set(['brand-tokens.css', 'brand-colors.js', 'supabase/functions/_shared/brand-colors.ts', 'supabase/templates/recovery.html', 'tailwind-3.4.17.css']);
let passed = 0; const fails = [];
const check = (label, ok, detail) => { if (ok) { passed++; console.log('  PASS  ' + label); } else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); } };

const hexes = Object.values(colors).map((h) => h.slice(1).toUpperCase());
const triplets = Object.values(colors).map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const hexRe = new RegExp('#(' + hexes.join('|') + ')(?![0-9A-Fa-f])', 'gi');
function findBrand(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    hexRe.lastIndex = 0; let m;
    while ((m = hexRe.exec(line))) out.push({ line: i + 1, what: m[0] });
    for (const mm of line.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) {
      if (triplets.some((t) => t[0] === +mm[1] && t[1] === +mm[2] && t[2] === +mm[3])) out.push({ line: i + 1, what: mm[0] });
    }
  });
  return out;
}
// pdf-lib colours in Edge Function source (the signed-copy certificate) are rgb(r, g, b) on a 0-1
// scale, which the brand-channel check above cannot see: rgb(0.36, 0.39, 0.42) is no brand triplet.
// So any rgb() whose three arguments are all numeric LITERALS no greater than 1 is flagged — a
// certificate colour must come from BRAND_RGB (2026-10-01, row 304: its greys escaped exactly so).
function findLiteralPdfColour(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\brgb\(\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*\)/g)) {
      if ([m[1], m[2], m[3]].every((v) => +v <= 1)) out.push({ line: i + 1, what: m[0] });
    }
  });
  return out;
}
function shippedFiles(root) {
  const list = execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  return list.filter((f) => /^[^/]+\.(html|css|js)$/.test(f) || /^ctl\/.*\.ts$/.test(f) || /^supabase\/functions\/.*\.ts$/.test(f) || /^supabase\/templates\//.test(f) || f === 'scripts/tailwind/tailwind.config.js');
}
// Reads Edge Function source from git objects, never the working tree (row 255 — the guard would refuse).
function readShipped(root, f) {
  if (f.startsWith('supabase/functions/')) {
    const r = spawnSync('git', ['show', ':' + f], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status === 0) return r.stdout;
    return spawnSync('git', ['show', 'HEAD:' + f], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout || '';
  }
  return fs.readFileSync(path.join(root, f), 'utf8');
}
function scan(root) {
  const files = shippedFiles(root); const hits = [];
  for (const f of files) {
    if (GENERATED.has(f)) continue;
    const text = readShipped(root, f);
    for (const h of findBrand(text)) hits.push(f + ':' + h.line + ' ' + h.what);
    if (/\.ts$/.test(f)) for (const h of findLiteralPdfColour(text)) hits.push(f + ':' + h.line + ' ' + h.what);
  }
  return { files: files.length, hits };
}
function pageLinks(root) {
  const bad = [];
  for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    const head = (s.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
    const first = head.search(/<(link|style|script)\b/i);
    const tok = head.indexOf('href="brand-tokens.css"'), js = head.indexOf('src="brand-colors.js"');
    if (tok < 0 || js < 0) { bad.push(f + ' (missing)'); continue; }
    const firstTag = head.slice(first, first + 60);
    if (!/brand-tokens\.css/.test(firstTag)) bad.push(f + ' (not first)');
  }
  return bad;
}

async function main() {
  console.log('\n=== 1. no brand colour outside the single source ===\n');
  const r = scan(ROOT);
  check('scanned the shipped files (' + r.files + ' — non-vacuous)', r.files > 200, String(r.files));
  check('no brand hex or brand rgb() channels anywhere but the generated files', r.hits.length === 0, r.hits.slice(0, 15).join(' | '));

  console.log('\n=== 2. the generated files match the JSON ===\n');
  const b = spawnSync(process.execPath, [path.join(HERE, 'build-brand.mjs'), '--check'], { encoding: 'utf8' });
  check('build-brand --check: every generated file is up to date', b.status === 0, (b.stdout + b.stderr).trim());
  const tw = fs.readFileSync(path.join(HERE, 'tailwind', 'tailwind.config.js'), 'utf8');
  check('the Tailwind config reads the JSON and names no hex itself', /require\('\.\.\/brand\/brand-colors\.json'\)/.test(tw) && findBrand(tw).length === 0);

  console.log('\n=== 3. every page links the palette first ===\n');
  const pages = fs.readdirSync(ROOT).filter((x) => x.endsWith('.html')).length;
  const bad = pageLinks(ROOT);
  check('all ' + pages + ' pages link brand-tokens.css first and load brand-colors.js in <head>', pages > 30 && bad.length === 0, bad.join(', '));

  console.log('\n=== 4. FORCED-FAILURE CONTROLS ===\n');
  const tmp = makeTempDir('mw-brandguard-');
  try {
    execSync('git init -q', { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'page.html'), '<html><head><link rel="stylesheet" href="brand-tokens.css">\n  <script src="brand-colors.js"></script>\n  <style>.x{color:#1b3a4b}</style></head><body></body></html>');
    fs.writeFileSync(path.join(tmp, 'a.css'), '.y { background: rgba(200, 134, 10, .4); }');
    fs.writeFileSync(path.join(tmp, 'b.js'), "var c = '#16815F';");
    fs.writeFileSync(path.join(tmp, 'ok.css'), '.z { color: var(--brand-navy); background: rgba(var(--brand-gold-rgb), .4); }');
    fs.mkdirSync(path.join(tmp, 'ctl'));
    fs.writeFileSync(path.join(tmp, 'ctl', 'cert.ts'), 'const muted = rgb(0.36, 0.39, 0.42);\nconst ok = rgb(BRAND_RGB.muted[0] / 255, BRAND_RGB.muted[1] / 255, BRAND_RGB.muted[2] / 255);\n');
    fs.writeFileSync(path.join(tmp, 'nolink.html'), '<html><head><style>.a{}</style></head></html>');
    const c = scan(tmp);
    check('control: a lowercase brand hex in a <style> block is named', c.hits.some((h) => /^page\.html:\d+ #1b3a4b/.test(h)), c.hits.join(' | '));
    check('control: gold as rgba() channels in a stylesheet is named', c.hits.some((h) => /^a\.css:1 rgba\(200, 134, 10/.test(h)), c.hits.join(' | '));
    check('control: a brand hex in a JavaScript string is named', c.hits.some((h) => /^b\.js:1 #16815F/.test(h)), c.hits.join(' | '));
    check('control: var()-based colours are NOT flagged', !c.hits.some((h) => h.startsWith('ok.css')), c.hits.join(' | '));
    check('control: a literal pdf-lib grey in Edge Function source is named', c.hits.some((h) => /^ctl\/cert\.ts:1 rgb\(0\.36/.test(h)), c.hits.join(' | '));
    check('control: a BRAND_RGB-derived pdf-lib colour is NOT flagged', !c.hits.some((h) => /^ctl\/cert\.ts:2/.test(h)), c.hits.join(' | '));
    const pl = pageLinks(tmp);
    check('control: a page without the palette links is named', pl.includes('nolink.html (missing)'), pl.join(', '));
  } finally { await releaseTempDir(tmp); }

  console.log('\n' + passed + '/' + (passed + fails.length) + ' assertions passed.');
  console.log('BRAND COLOURS: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);   // explicit: runVerifyMain exits 0 on any normal return
}

runVerifyMain(main, { watchdogMs: 120000 });
