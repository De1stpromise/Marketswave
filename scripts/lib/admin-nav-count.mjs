// admin-nav-count.mjs — how many items the shared PM rail renders (2026-09-23).
//
// ★ WHY THIS EXISTS. Seven visual suites asserted "ten items" as a literal, and three of them
// used the same literal as a READINESS condition — so adding one rail item (Help Center) broke
// four assertions and would have left the other three polling until they timed out, which reads
// as "the page never rendered" rather than "the count moved". That is this project's own
// "assert the PROPERTY, not a hardcoded count" lesson in its most literal form.
//
// The property those suites actually care about is row 228's: the shared nav mounted, whole,
// with the page's own item active and Log out reachable. The COUNT is only a proxy for "fully
// rendered", so it should be derived from the one place that defines it rather than retyped in
// seven files that then drift.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The number of entries in admin-sidebar.js's NAV_ITEMS, read from the real source. */
export function adminNavItemCount() {
  const src = readFileSync(path.join(ROOT, 'admin-sidebar.js'), 'utf8');
  const start = src.indexOf('NAV_ITEMS');
  if (start === -1) throw new Error('admin-nav-count: NAV_ITEMS not found in admin-sidebar.js');
  const open = src.indexOf('[', start);
  const close = src.indexOf('];', open);
  if (open === -1 || close === -1) throw new Error('admin-nav-count: could not bound the NAV_ITEMS array');
  const body = src.slice(open, close);
  const n = (body.match(/\{\s*key:/g) || []).length;
  // A count of zero or one means the parse broke, not that the rail shrank — fail loudly rather
  // than hand back a number that would make every caller's assertion vacuous.
  if (n < 2) throw new Error('admin-nav-count: parsed ' + n + ' items, which cannot be right');
  return n;
}

/**
 * Nav keys that render NO icon — i.e. a key in NAV_ITEMS with no entry in admin-sidebar.js's
 * ICON map. Returns [] when every item is covered.
 *
 * ★ WHY THIS EXISTS (2026-09-27). Help Center shipped with no ICON entry, so navHTML() emitted
 * `<svg …>undefined</svg>`: an empty 16x16 gap in the rail, and the literal string "undefined"
 * as a text node inside the svg. Nothing errored. The only assertion that touched rail icons
 * was `/\n    blog: '<path/.test(railSrc)` — it checked ONE key, by source regex, so it could
 * never have covered a different item. Assert the SET, derived from NAV_ITEMS, never a list
 * retyped here that would drift the same way the item count did.
 */
export function adminNavIconGaps() {
  const src = readFileSync(path.join(ROOT, 'admin-sidebar.js'), 'utf8');

  const navStart = src.indexOf('NAV_ITEMS');
  const navOpen = src.indexOf('[', navStart);
  const navClose = src.indexOf('];', navOpen);
  if (navStart === -1 || navOpen === -1 || navClose === -1) throw new Error('admin-nav-count: could not bound NAV_ITEMS');
  const navKeys = [...src.slice(navOpen, navClose).matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]);

  const icoStart = src.indexOf('var ICON');
  const icoOpen = src.indexOf('{', icoStart);
  const icoClose = src.indexOf('\n  };', icoOpen);
  if (icoStart === -1 || icoOpen === -1 || icoClose === -1) throw new Error('admin-nav-count: could not bound the ICON map');
  const icoBody = src.slice(icoOpen, icoClose);
  // Keys may be bare (documents:) or quoted ('deposit-addresses':) — a regex that only matched
  // the bare form once reported two false gaps, which is how a wrong parse looks like a bug.
  // Parse line by line rather than with one regex: a key may be bare (documents:) or quoted
  // ('deposit-addresses':), and a regex that matched only the bare form reported two false
  // gaps on its first run — a wrong parse looks exactly like a real bug.
  const iconKeys = [];
  for (const rawLine of icoBody.split(String.fromCharCode(10))) {
    const line = rawLine.trim();
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().replace(/^'|'$/g, '');
    if (!key || !/^[a-zA-Z-]+$/.test(key)) continue;
    const rest = line.slice(colon + 1).trim();
    const q = rest.indexOf("'");
    if (q !== 0) continue;
    const end = rest.indexOf("'", 1);
    const value = end > 0 ? rest.slice(1, end) : '';
    if (value.trim().length > 0) iconKeys.push(key);   // present but empty is still a gap
  }

  if (navKeys.length < 2 || iconKeys.length < 2) {
    throw new Error('admin-nav-count: parsed ' + navKeys.length + ' nav keys and ' +
      iconKeys.length + ' icon keys, which cannot be right');
  }
  return navKeys.filter((k) => !iconKeys.includes(k));
}
