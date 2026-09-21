// tailwind.config.js — the ONE Tailwind configuration for every logged-in page (app-feel stage 1.5,
// fix 2, 2026-09-21, register row 260). Compiled by scripts/build-tailwind.mjs into
// ../../tailwind-3.4.17.css, which the 24 Tailwind pages link as the LAST stylesheet in <head>.
//
// It replaces the play CDN (cdn.tailwindcss.com — 124 KB of render-blocking script that JIT-compiled
// each page's CSS on every load, PERFORMANCE_AUDIT.md finding #4) and the eleven per-page inline
// `tailwind.config = {...}` blocks that used to extend navy/cream on the client-facing pages.
//
// ★ ONE SHEET, ONE PALETTE, ONE RULE. The client-facing family's navy/cream tokens are compiled in
// for every page, including the PM tool's. That does NOT make navy legal on an admin page — the
// admin tool's own locked palette is slate/amber, and verify-tailwind-color-scoping.js still fails
// any admin file that names navy/cream in a utility position. Before this sheet, such a use rendered
// TRANSPARENT (the CDN emitted no CSS for a colour its page had not defined, row 165); now it would
// render navy — visible, wrong, and still caught by the guard.
//
// ★ CONTENT IS EVERY ROOT-LEVEL .html AND .js, NOTHING ELSE. A class the compiler cannot find in
// these files is not in the sheet and does nothing — silently. Every class this project emits from
// JavaScript is a whole string literal (a tone map, a template), never assembled from fragments;
// keep it that way. `theme.extend` (never bare `theme.colors`, which would drop the default palette)
// — the guard checks this file for that too.
module.exports = {
  content: { relative: true, files: ['../../*.html', '../../*.js'] },   // relative to THIS file, not the cwd
  // darkMode is Tailwind 3's default ('media'), the same default the play CDN applied — the `dark:`
  // variants in the markup behave exactly as before.
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#1B3A4B', dark: '#122A38', light: '#2A4F63' },
        cream: { DEFAULT: '#F7F6F3', dark: '#EDE8E1' }
      }
    }
  },
  plugins: []
};
