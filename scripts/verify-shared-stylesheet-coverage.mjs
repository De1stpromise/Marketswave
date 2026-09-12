/* verify-shared-stylesheet-coverage.mjs — a standing guard for a whole BUG CATEGORY
 * (2026-09-10, the second finding to come out of register row 190).
 *
 * WHY THIS EXISTS
 * ---------------
 * The control-modernisation sweep added control-patterns.css and linked it on the 26
 * Tailwind pages, because those were the pages that sweep was scoped to. signup.html is a
 * custom-CSS page and was not in that list — so when row 189 later retrofitted signup's
 * two uploads to the shared .mw-upload component, the markup landed on a page that never
 * linked the stylesheet defining it. The component rendered completely unstyled, with no
 * focus ring at all, on the one page where that control is a REQUIRED step.
 *
 * Nothing failed. Nothing warned. The markup was right, the CSS was right, and the page
 * was broken, because the two had never been introduced to each other. That is the
 * category, and it will recur every time this project adds a shared component:
 *
 *   ★ A SHARED STYLESHEET ADDED IN ONE PASS SILENTLY MISSES THE PAGES OUTSIDE THAT PASS'S
 *     SCOPE, AND ANY LATER PASS THAT USES THE COMPONENT INHERITS THE GAP.
 *
 * It is cheap to close permanently, because it needs no browser: a stylesheet declares
 * which classes it owns and a page declares which it uses, so "this page uses a class it
 * cannot reach a definition for" is a fact about the files on disk.
 *
 * WHAT IT CHECKS
 *   - ownership is read from the shared stylesheets THEMSELVES, never a hand-maintained
 *     list, so a component added to one of them is covered the day it is written;
 *   - reachability follows @import transitively, so a page linking styles.css genuinely
 *     reaches glass-primitives.css rather than being reported as a false positive;
 *   - a script that BUILDS markup counts as a user of the classes it writes, and the
 *     requirement lands on every page loading that script. chat-widget.js is the real
 *     case — its classes appear in no HTML file at all, so a check that read only static
 *     markup would declare those pages clean while proving nothing about them.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The component stylesheets. Deliberately NOT styles.css: that is the public site's base
 * sheet, every public page links it, and it owns hundreds of generic names (.container,
 * .btn) whose reuse carries no signal. Each of these five defines a named component
 * vocabulary that a page either reaches or does not. */
const SHARED = [
  'control-patterns.css',
  'glass-primitives.css',
  'tap-targets.css',
  'responsive-tables.css',
  'chat-widget.css',
  // Fund documents (2026-09-12): the editor (rich-text.js builds .rt/.rtbar/.rtbody/.counter)
  // and the document renderer (fund-document.js builds every .fd-* class). Both scripts
  // create their markup at runtime, so this is exactly the case this check exists for.
  'rich-text.css',
  'fund-document.css',
];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* Class names a stylesheet DEFINES. Comments are stripped first, so a class mentioned
 * only in prose ("see .mw-upload above") is never mistaken for a definition. */
function ownedClasses(css) {
  const body = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Strings and url() payloads are NOT selectors. Without this, the SVG namespace in an
    // inline data: URI ("www.w3.org") is harvested as a class named `w3`.
    .replace(/url\([^)]*\)/g, '')
    .replace(/"[^"]*"|'[^']*'/g, '');
  const out = new Set();
  for (const m of body.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(m[1]);
  return out;
}

/* Stylesheets a document reaches: its own <link> hrefs, plus whatever those @import. */
function reachableSheets(html) {
  const direct = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map((m) => (m[0].match(/href=["']([^"']+)["']/i) || [])[1])
    .filter(Boolean)
    .map((h) => h.replace(/^\.\//, '').split('?')[0]);
  const seen = new Set();
  const queue = [...direct];
  while (queue.length) {
    const sheet = queue.shift();
    if (!sheet || seen.has(sheet)) continue;
    seen.add(sheet);
    if (!existsSync(join(ROOT, sheet))) continue;
    for (const m of read(sheet).matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)) {
      queue.push(m[1].replace(/^\.\//, '').split('?')[0]);
    }
  }
  return seen;
}

/* Class names a file USES. Covers static markup and markup built inside JS template
 * literals alike — the second is how most of this project's admin tables are rendered,
 * and a check reading only static HTML would miss them entirely. */
function usedClasses(text) {
  const out = new Set();
  for (const m of text.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) {
    for (const c of m[1].split(/\s+/)) if (c && !c.includes('$')) out.add(c);
  }
  for (const m of text.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*["']([^"']+)["']/g)) {
    out.add(m[1]);
  }
  return out;
}

const scriptsLoadedBy = (html) =>
  [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => m[1].replace(/^\.\//, '').split('?')[0]);

async function main() {
  let passed = 0;
  const failures = [];
  const check = (label, ok, detail) => {
    if (ok) { passed++; console.log('  PASS  ' + label); }
    else { failures.push(label); console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
  };

  /* ★ A class can legitimately be defined in MORE THAN ONE stylesheet, and the check is
   * wrong if it ignores that. `.access-modal-close` is defined by styles.css and merely
   * QUALIFIED by tap-targets.css (which raises its hit area); `.is-visible` is a generic
   * state name several files set. Demanding one nominated owner reported eleven public
   * pages as broken when every one of them genuinely reaches a definition via styles.css.
   * So: map each class to EVERY stylesheet defining it, and satisfy a page if it reaches
   * ANY of them. What that still catches is the real failure — a page that reaches NONE. */
  const definedIn = new Map();
  const allSheets = readdirSync(ROOT).filter((f) => f.endsWith('.css'));
  for (const sheet of allSheets) {
    for (const cls of ownedClasses(read(sheet))) {
      if (!definedIn.has(cls)) definedIn.set(cls, new Set());
      definedIn.get(cls).add(sheet);
    }
  }
  // Only classes a SHARED component sheet defines are in scope; the rest is page-local CSS.
  const shared = new Set();
  for (const sheet of SHARED) for (const cls of ownedClasses(read(sheet))) shared.add(cls);
  console.log('Shared component vocabulary: ' + shared.size + ' class names across ' +
    SHARED.length + ' stylesheets (of ' + allSheets.length + ' stylesheets in the project)\n');

  const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const jsFiles = readdirSync(ROOT).filter((f) => f.endsWith('.js'));

  // Which shared classes does each local script require, by virtue of the markup it builds?
  const scriptNeeds = new Map();
  for (const js of jsFiles) {
    const needs = [...usedClasses(read(js))].filter((c) => shared.has(c));
    if (needs.length) scriptNeeds.set(js, needs);
  }

  const gaps = [];
  for (const page of htmlFiles) {
    const html = read(page);
    const reachable = reachableSheets(html);
    // A page's own inline <style> is a definition too, and just as reachable.
    const inline = new Set();
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      for (const c of ownedClasses(m[1])) inline.add(c);
    }
    const unreachable = new Map();
    const want = (cls, why) => {
      if (inline.has(cls)) return;
      const homes = definedIn.get(cls) || new Set();
      if ([...homes].some((h) => reachable.has(h))) return;
      const key = [...homes].join(' or ') || '(undefined anywhere)';
      if (!unreachable.has(key)) unreachable.set(key, new Set());
      unreachable.get(key).add(why);
    };

    for (const cls of usedClasses(html)) if (shared.has(cls)) want(cls, cls);
    for (const src of scriptsLoadedBy(html)) {
      for (const cls of scriptNeeds.get(src) || []) want(cls, cls + ' (built by ' + src + ')');
    }
    for (const [homes, why] of unreachable) {
      gaps.push(page + ' uses classes defined only in ' + homes + ', which it never links: ' +
        [...why].slice(0, 6).join(', '));
    }
  }

  check('every page that uses a shared component also links its stylesheet (' +
    htmlFiles.length + ' pages, ' + jsFiles.length + ' scripts inspected)',
    gaps.length === 0, gaps.join('\n        '));

  /* NON-VACUITY. A clean run is only meaningful if the check is capable of reporting a
   * dirty one, so prove that against a synthetic page that uses a real shared class and
   * links nothing — rather than trusting a pass that might mean the detector is inert. */
  const fake = '<html><body><div class="mw-upload"></div></body></html>';
  const probe = [...usedClasses(fake)]
    .filter((c) => shared.has(c) &&
      ![...(definedIn.get(c) || [])].some((h) => reachableSheets(fake).has(h)))
    .map((c) => c + ' -> ' + [...(definedIn.get(c) || [])].join(' or '));
  check('the check can actually fail — a synthetic unlinked page is detected (' +
    probe.join(', ') + ')', probe.length > 0);

  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log('SHARED STYLESHEET COVERAGE: FAIL'); process.exit(1); }
  console.log('SHARED STYLESHEET COVERAGE: PASS');
}

runVerifyMain(main);
