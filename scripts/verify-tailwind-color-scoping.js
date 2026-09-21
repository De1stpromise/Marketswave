#!/usr/bin/env node
// Tailwind Color Scoping Guard (2026-09-07). Preventative measure for the exact bug class
// found and fixed the same day: admin-inbox.html used `bg-navy`/`text-navy`/`focus:ring-navy`
// throughout (copied from the client-facing dashboard family's own established button
// pattern), but `navy`/`cream` are CUSTOM Tailwind colors that only exist where a page's own
// inline `tailwind.config` defines them via `theme.extend.colors` — every client-facing
// dashboard page does this, no admin page ever has (the admin tool deliberately uses only
// Tailwind's own DEFAULT palette — slate/amber — needing no custom config at all, per the
// locked "wholesale distinct color scheme" rule in CLAUDE.md). The Tailwind CDN's JIT
// compiler does not error on an unrecognized color utility — it silently generates NO CSS for
// it, so `bg-navy` on an admin page renders as a fully transparent background: the element
// stays present, correctly laid out, and fully clickable (confirmed live — getComputedStyle,
// elementFromPoint, display/visibility/opacity all report "normal"), it just never PAINTS.
// This makes the bug class genuinely silent — nothing errors, nothing warns, a screenshot at
// a glance can even miss it — which is exactly why a one-off "remember not to mix palettes"
// isn't enough; this script is the real, automatable check standing in for that.
//
// TWO INDEPENDENT CHECKS, since this bug class has two directions (checked directly, not
// assumed symmetric — see the file-scan results in the commit this script shipped with):
//
// 1. No ADMIN file may reference `navy`/`cream` in a Tailwind color-utility position — those
//    two names are the ONLY custom colors ever defined anywhere in this project, and only by
//    the client-facing dashboard family's own inline tailwind.config. If a third custom color
//    is ever added to that config, add its name to CLIENT_ONLY_CUSTOM_COLORS below.
//
// 2. Every page's own inline `tailwind.config` must use `theme: { extend: { colors: {...} } }`
//    — never a bare `theme: { colors: {...} }`, which REPLACES Tailwind's entire default
//    palette instead of adding to it, silently breaking every other default color (slate,
//    amber, red, green, everything) on that one page. Confirmed empirically that every
//    client-facing page already does this correctly (the `extend` form) — this check exists
//    to keep it that way, since a future edit copying an example from Tailwind's own docs
//    could easily introduce the destructive form by mistake.
//
// Usage: node scripts/verify-tailwind-color-scoping.js
// Exit 0 = clean. Exit 1 = at least one real issue found, listed with file:line.
//
// RUN THIS before any push that adds or edits Tailwind classes on an admin*.html page, or
// touches any page's own inline tailwind.config block — the same standing-convention
// treatment already given to verify-cloud-staging-parity.js after its own real incident.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// The only custom Tailwind color names defined anywhere in this project today (client-facing
// dashboard family's own inline tailwind.config, via theme.extend.colors). These must never
// appear on an admin page, which defines no such config.
const CLIENT_ONLY_CUSTOM_COLORS = ['navy', 'cream'];

const CUSTOM_COLOR_UTILITY_RE = new RegExp(
  '\\b(?:bg|text|border|ring|from|to|via|divide|placeholder|outline|decoration|caret|accent|fill|stroke)-' +
    '(?:' + CLIENT_ONLY_CUSTOM_COLORS.join('|') + ')' +
    '(?:-[a-z]+)?' +   // e.g. -dark, -light
    '(?:/\\d+)?' +     // e.g. /20 opacity modifier
    '\\b',
  'g'
);

function listRootHtmlFiles() {
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
}

function isAdminFile(filename) {
  return /^admin/i.test(filename);
}

function readIfExists(relPath) {
  const p = path.join(ROOT, relPath);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

const failures = [];

// -------------------------------------------------------------------------------------------
// Check 1: no admin file (any admin*.html, plus admin-sidebar.js — the one admin-exclusive
// shared script) may reference a client-only custom color.
// -------------------------------------------------------------------------------------------
const adminHtmlFiles = listRootHtmlFiles().filter(isAdminFile);
const adminFilesToScan = adminHtmlFiles.concat(['admin-sidebar.js']);

for (const relFile of adminFilesToScan) {
  const content = readIfExists(relFile);
  if (content === null) continue;
  content.split('\n').forEach((line, idx) => {
    const matches = line.match(CUSTOM_COLOR_UTILITY_RE);
    if (matches) {
      failures.push({
        file: relFile,
        line: idx + 1,
        detail: 'references client-only custom color class(es): ' + [...new Set(matches)].join(', ')
      });
    }
  });
}

// -------------------------------------------------------------------------------------------
// Check 2 (rewritten 2026-09-21, row 260): the ONE Tailwind configuration is
// scripts/tailwind/tailwind.config.js and it must use theme.extend — never a bare theme.colors
// that silently replaces the entire default palette. No page may carry an inline
// `tailwind.config` any more: the play CDN that read it is gone, so it would be a dead global
// AND a sign someone expects the CDN's runtime behaviour.
// -------------------------------------------------------------------------------------------
const TW_CONFIG = path.join(__dirname, 'tailwind', 'tailwind.config.js');
const twConfig = fs.existsSync(TW_CONFIG) ? fs.readFileSync(TW_CONFIG, 'utf8') : null;
if (twConfig === null) {
  failures.push({ file: 'scripts/tailwind/tailwind.config.js', line: null, detail: 'missing — the compiled Tailwind sheet has no source configuration' });
} else {
  const themeMatch = twConfig.match(/theme:\s*\{\s*([a-zA-Z]+)\s*:/);
  if (!themeMatch || themeMatch[1] !== 'extend') {
    failures.push({ file: 'scripts/tailwind/tailwind.config.js', line: null, detail: 'theme must use "theme.extend" — a bare theme.' + (themeMatch ? themeMatch[1] : '?') + ' REPLACES Tailwind\'s entire default palette (slate, amber, red, green, every default colour), not just adds to it' });
  }
}
for (const relFile of listRootHtmlFiles()) {
  const content = readIfExists(relFile);
  if (content === null) continue;
  if (content.indexOf('tailwind.config') !== -1) failures.push({ file: relFile, line: null, detail: 'carries an inline tailwind.config — the compiled sheet is the only configuration now (scripts/tailwind/tailwind.config.js); remove the block' });
  if (content.indexOf('cdn.tailwindcss.com') !== -1) failures.push({ file: relFile, line: null, detail: 'loads the Tailwind play CDN — it was retired for the compiled sheet (row 260); link ' + TW_HREF() + ' as the last stylesheet in <head> instead' });
}

// -------------------------------------------------------------------------------------------
// Check 3: every page that USES Tailwind utilities links the compiled sheet, as the LAST
// stylesheet in <head>. "Uses" is read from the sheet itself: a page whose class attributes
// carry five or more selectors the compiled sheet defines is a Tailwind page. The position
// matters: the play CDN appended its generated <style> after every other sheet, so utilities
// win equal-specificity contests against control-patterns.css / glass-primitives.css / a
// page's own <style>; a link placed earlier would silently flip those contests.
// -------------------------------------------------------------------------------------------
function TW_VERSION() { return JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', 'tailwindcss', 'package.json'), 'utf8')).version; }
function TW_HREF() { return 'tailwind-' + TW_VERSION() + '.css'; }
const compiledPath = path.join(ROOT, TW_HREF());
const compiled = fs.existsSync(compiledPath) ? fs.readFileSync(compiledPath, 'utf8') : null;
if (compiled === null) {
  failures.push({ file: TW_HREF(), line: null, detail: 'the compiled Tailwind sheet is missing — run `npm run build-tailwind` in scripts/ and commit it' });
} else {
  const compiledClasses = new Set();
  const selRe = /(?:^|[}])([^{}]+)\{/g; let m;
  while ((m = selRe.exec(compiled))) for (const part of m[1].split(',')) { const cls = part.trim().match(/^\.((?:\\.|[^\s:>~+.\[])+(?:\[[^\]]*\])?)/); if (cls) compiledClasses.add(cls[1].replace(/\\(.)/g, '$1')); }
  let tailwindPages = 0;
  for (const relFile of listRootHtmlFiles()) {
    const content = readIfExists(relFile);
    const used = new Set();
    for (const attr of content.matchAll(/class=["']([^"']*)["']/g)) for (const c of attr[1].split(/\s+/)) if (c && compiledClasses.has(c)) used.add(c);
    if (used.size < 5) continue;
    tailwindPages++;
    const head = content.slice(0, content.indexOf('</head>'));
    const links = [...head.matchAll(/<link[^>]*rel="stylesheet"[^>]*>|<style\b/g)].map((x) => x[0]);
    const last = links[links.length - 1] || '';
    if (!head.includes('href="' + TW_HREF() + '"')) failures.push({ file: relFile, line: null, detail: 'uses ' + used.size + ' Tailwind utilities but does not link ' + TW_HREF() + ' — every one of them renders as nothing on this page' });
    else if (!last.includes(TW_HREF())) failures.push({ file: relFile, line: null, detail: TW_HREF() + ' must be the LAST stylesheet/style in <head> (utilities must keep winning equal-specificity contests, as they did under the play CDN); it is followed by: ' + last.slice(0, 80) });
  }
  if (tailwindPages < 20) failures.push({ file: '(all pages)', line: null, detail: 'only ' + tailwindPages + ' pages read as Tailwind pages — the detection is broken (vacuity guard: 24 expected)' });

  // -----------------------------------------------------------------------------------------
  // Check 4 — STALENESS. The play CDN saw every class in the live DOM; the compiled sheet
  // contains only what was in the files when it was built. A class added to a page after that
  // does NOTHING, silently — row 165's failure mode, now for every class. So the sheet is
  // rebuilt here into a temp file and byte-compared: a forgotten rebuild fails by name.
  // -----------------------------------------------------------------------------------------
  const { execFileSync } = require('child_process');
  const os = require('os');
  const tmp = path.join(os.tmpdir(), 'mw-tailwind-guard-' + process.pid + '.css');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'build-tailwind.mjs'), '--out', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    const fresh = fs.readFileSync(tmp, 'utf8');
    if (fresh !== compiled) {
      const cls = (css) => new Set((css.match(/\.(?:\\.|[^\s{,:>~+])+/g) || []));
      const a = cls(compiled), b = cls(fresh);
      const added = [...b].filter((x) => !a.has(x)).slice(0, 8), removed = [...a].filter((x) => !b.has(x)).slice(0, 8);
      failures.push({ file: TW_HREF(), line: null, detail: 'STALE — the pages use classes the committed sheet does not contain (or no longer use some it does). Run `npm run build-tailwind` in scripts/ and commit the result. Missing from the sheet: ' + (added.join(' ') || '(none)') + '; no longer used: ' + (removed.join(' ') || '(none)') });
    }
  } catch (e) {
    failures.push({ file: TW_HREF(), line: null, detail: 'could not rebuild the sheet to check staleness: ' + String(e.message).split('\n')[0] });
  } finally { try { fs.unlinkSync(tmp); } catch (_e) {} }
}

if (failures.length) {
  console.log('=== Tailwind Color Scoping Guard: FAIL ===\n');
  for (const f of failures) {
    console.log('  ' + f.file + (f.line ? ':' + f.line : '') + ' — ' + f.detail);
  }
  console.log('\n' + failures.length + ' issue(s) found.');
  process.exit(1);
}

console.log('=== Tailwind Color Scoping Guard: PASS ===');
console.log(
  'No admin file references a client-only custom color (' + CLIENT_ONLY_CUSTOM_COLORS.join('/') + '); no page loads the play CDN or carries an inline config; ' +
  'scripts/tailwind/tailwind.config.js uses theme.extend; every Tailwind page links ' + TW_HREF() + ' as its last stylesheet; and the committed sheet is byte-identical to a fresh build.'
);
process.exit(0);
