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
// Check 2: every inline tailwind.config, on ANY html page, must use theme.extend — never a
// bare theme.colors that silently replaces the entire default Tailwind palette.
// -------------------------------------------------------------------------------------------
for (const relFile of listRootHtmlFiles()) {
  const content = readIfExists(relFile);
  if (content === null) continue;
  const configIdx = content.indexOf('tailwind.config');
  if (configIdx === -1) continue;
  const snippet = content.slice(configIdx, configIdx + 400);
  const themeMatch = snippet.match(/theme:\s*\{\s*([a-zA-Z]+)\s*:/);
  if (themeMatch && themeMatch[1] !== 'extend') {
    failures.push({
      file: relFile,
      line: null,
      detail:
        'inline tailwind.config uses "theme.' + themeMatch[1] + '" directly instead of ' +
        '"theme.extend.' + themeMatch[1] + '" — this REPLACES Tailwind\'s entire default ' +
        'palette (slate, amber, red, green, every default color) on this page, not just adds ' +
        'to it. Change to theme: { extend: { ' + themeMatch[1] + ': {...} } }.'
    });
  }
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
  'No admin file references a client-only custom color (' + CLIENT_ONLY_CUSTOM_COLORS.join('/') + '), ' +
  'and every inline tailwind.config uses theme.extend rather than a destructive theme.colors override.'
);
process.exit(0);
