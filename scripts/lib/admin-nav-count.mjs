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
