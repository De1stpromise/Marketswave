/**
 * verify-contrast.mjs - real composited-pixel contrast measurement.
 *
 * WHY THIS EXISTS, and why a getComputedStyle-based check is useless here:
 * resources.html carries .page-grain - a full-viewport SVG-turbulence overlay at
 * mix-blend-mode: multiply, z-index 40. It sits ABOVE the content, so it darkens both the
 * text and the surface beneath it, and it has no background-color for anything to read.
 * Reading authored colours and compositing them arithmetically cannot model per-pixel
 * multiply noise. So this samples the ACTUAL RENDERED PIXELS.
 *
 * Three traps this project has already paid for, all handled here:
 *   1. Page.captureScreenshot's `clip` is in PAGE coordinates, not viewport coordinates.
 *      Avoided entirely: we capture the plain viewport and sample with viewport-relative
 *      rects from getBoundingClientRect().
 *   2. `visibility: hidden` also removes the element's OWN background, so an element hidden
 *      that way reports whatever sits behind its container instead of its own surface.
 *      Avoided: the background pass uses `color: transparent` (plus transparent
 *      -webkit-text-fill-color and text-shadow), which removes the glyphs while leaving the
 *      box painted.
 *   3. Long-cycle opacity animations catch text mid-fade and produce meaningless readings.
 *      Avoided: prefers-reduced-motion: reduce is emulated for the whole run.
 *
 * Background is the MEDIAN pixel of the text box with the glyphs removed. Foreground is the
 * glyph core - whichever of the box's darkest/lightest pixel sits furthest from that
 * background in luminance. That polarity check is load-bearing, not defensive: this page has
 * light-on-dark surfaces (the hero, the workflow table head, the footer) as well as
 * dark-on-light ones, and taking "darkest" unconditionally measures the dark background
 * against itself and reports a meaningless ~1.0:1 for every one of them.
 *
 * Antialiasing can only pull the sampled glyph core back toward the background, so the
 * measurement errs pessimistic - it never flatters a failing colour.
 *
 * Usage:  node scripts/verify-contrast.mjs
 *         CONTRAST_URL=... CONTRAST_WIDTHS=1440,390 node scripts/verify-contrast.mjs
 * Requires a static server already serving the project (default http://127.0.0.1:8765).
 */
import { spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir } from './lib/harness-teardown.mjs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CONTRAST_PORT || 9333);
const PAGE_URL = process.env.CONTRAST_URL || 'http://127.0.0.1:8765/resources.html';
const THRESHOLD = 4.5;

// Page profiles. This file began as resources.html's own contrast check; the Returns
// Display work (2026-09-09) needed the same real-composited-pixel measurement on two
// AUTHENTICATED pages, so the selector list became a profile chosen by CONTRAST_PROFILE and
// an optional CONTRAST_BOOTSTRAP_JS hook seeds a real session before the target page loads.
// Default behaviour is unchanged: no env vars means the resources profile, exactly as before.
const PROFILES = {};

PROFILES.resources = [
  // --- the redesigned components (rest state) ---
  { label: 'res-item h3', sel: '.res-item h3', limit: 6 },
  { label: 'res-item kind', sel: '.res-kind', limit: 6 },
  { label: 'res-item body', sel: '.res-item p', limit: 6 },
  { label: 'res-item numeral', sel: '.res-n', limit: 6 },
  { label: 'res-step h3', sel: '.res-st h3', limit: 6 },
  { label: 'res-step body', sel: '.res-st p', limit: 6 },
  { label: 'res-step dot', sel: '.res-dot', limit: 6 },
  // How It Works portfolio-assembly artifact (2026-09-09). The readout rows sit at opacity
  // .22 until their step is reached, so these are measured with the artifact scrolled into
  // view, which is also the only state in which a reader can actually read them.
  { label: 'artifact label', sel: '.hiw-cap b', limit: 1 },
  { label: 'artifact percentage', sel: '.hiw-cap i', limit: 1 },
  { label: 'readout key', sel: '.hiw-readout .hiw-row.is-on .hiw-k', limit: 6 },
  { label: 'readout value', sel: '.hiw-readout .hiw-row.is-on .hiw-v', limit: 6 },
  // --- hover state: greyscale-at-rest only pays off if the engaged row is legible ---
  // Every row is measured, not a sample: the six accents differ per row, and a
  // 2-row sample originally hid four genuine failures behind two passes.
  { label: 'HOVER res-item numeral', sel: '.res-n', limit: 6, hover: true },
  { label: 'HOVER res-step dot', sel: '.res-dot', limit: 6, hover: true },
  { label: 'HOVER res-item h3', sel: '.res-item h3', limit: 6, hover: true },
  { label: 'HOVER res-item kind', sel: '.res-kind', limit: 6, hover: true },
  { label: 'HOVER res-item body', sel: '.res-item p', limit: 6, hover: true },
  { label: 'HOVER res-step h3', sel: '.res-st h3', limit: 6, hover: true },
  // --- the rest of the page: the grain is NEW and page-wide, so sections this redesign
  //     never touched are now composited differently than when they were last measured ---
  { label: 'page-hero h1', sel: '.page-hero h1', limit: 1 },
  { label: 'page-hero lede', sel: '.page-hero p', limit: 1 },
  { label: 'section h2', sel: '.section-header h2', limit: 4 },
  { label: 'section lede', sel: '.section-header p', limit: 4 },
  { label: 'table cell', sel: '.workflow-table-wrap td', limit: 4 },
  { label: 'table head', sel: '.workflow-table-wrap th', limit: 3 },
  { label: 'help card h3', sel: '#help h3', limit: 4 },
  { label: 'help card body', sel: '#help p', limit: 4 },
  { label: 'blog card h3', sel: '#blog h3', limit: 3 },
  { label: 'blog card body', sel: '#blog p', limit: 3 },
  { label: 'footer link', sel: '.site-footer a', limit: 4 },
  { label: 'footer text', sel: '.site-footer p', limit: 2 },
  // Login gate + loading screen (2026-09-09). Small muted text on a dark environment and a
  // teal eyebrow on cream are both the shapes that fail, so all of them are measured.
  { label: 'gate headline', sel: '.gate-headline h1', limit: 1 },
  { label: 'gate sub', sel: '.gate-sub', limit: 1 },
  { label: 'gate brand', sel: '.gate-brand', limit: 1 },
  { label: 'gate eyebrow', sel: '.gate-eyebrow', limit: 1 },
  { label: 'gate title', sel: '.login-title', limit: 1 },
  { label: 'gate lead', sel: '.login-lead', limit: 1 },
  { label: 'field label', sel: '.fld label', limit: 2 },
  { label: 'forgot link', sel: '.gate-row a', limit: 1 },
  { label: 'back pill', sel: '.gate-back', limit: 1 },
  { label: 'gate alt', sel: '.gate-alt', limit: 1 },
  // Condensed disclosures (2026-09-09): small muted type on the footer's dark, grain-screened
  // surface - exactly the combination that fails, and it appears on all eight footer pages.
  { label: 'disclosure text', sel: '.footer-disclosures p', limit: 3 },
  { label: 'full-disclosures link', sel: '.footer-disclosures-more a', limit: 1 },
];

// Returns Display (2026-09-09). Every NEW coloured figure is measured — gain green, loss
// red, realised blue — in BOTH tones, because a returns display that has only ever been
// measured green is only half measured. Row 177 found five of six accent hues fail as text
// on these grounds, so none of these three is assumed safe from having been used elsewhere.
PROFILES['returns-dashboard'] = [
  { label: 'card label', sel: '.ret-k', limit: 3 },
  { label: 'total return figure', sel: '.ret-v', limit: 1 },
  { label: 'percentage pill', sel: '.ret-pc', limit: 1 },
  { label: 'context line', sel: '.ret-sub', limit: 3 },
  { label: 'unrealised figure', sel: '#total-unrealized-amount', limit: 1 },
  { label: 'realised figure (blue)', sel: '#asset-returns-amount', limit: 1 },
  { label: 'best class name', sel: '.ret-class', limit: 1 },
  { label: 'best class pct', sel: '#best-performing-return .ret-u', limit: 1 },
];

// asset-performance.html. `.rt` now matches BOTH tables — the Return Table and the
// closed-positions panel — which is deliberate: they are styled as siblings, so measuring
// them through one selector is what proves they really are. Limits are set above the real
// element counts so nothing is silently sampled out.
PROFILES['returns-holdings'] = [
  // Summary cards. The two returns cards colour the DISPLAY figure by sign, which the
  // dashboard's own card does not, so these are new surfaces rather than known ones.
  { label: 'card label', sel: '.ret-k', limit: 3 },
  { label: 'card figure', sel: '.ret-v', limit: 3 },
  { label: 'card sub-line', sel: '.ret-sub', limit: 3 },
  { label: 'card sub figure', sel: '.ret-sub .ret-u', limit: 2 },
  // Both tables
  { label: 'column head', sel: '.rt th', limit: 14 },
  { label: 'holding name', sel: '.rt tbody b', limit: 8 },
  { label: 'holding meta', sel: '.rt tbody .rt-meta', limit: 8 },
  // The partial-sale marker takes the realised blue rather than the meta grey, so it is a
  // genuinely different measurement from the meta line it sits under.
  { label: 'partial-sale marker', sel: '.rt-partial', limit: 6 },
  { label: 'units/cost figure', sel: '.rt .rt-num', limit: 14 },
  { label: 'current value', sel: '.rt .rt-val', limit: 10 },
  { label: 'gain amount', sel: '.rt .rt-gain .a', limit: 10 },
  { label: 'gain percent', sel: '.rt .rt-gain .p', limit: 10 },
  { label: 'totals label', sel: '.rt-total-lab', limit: 2 },
  { label: 'legend text', sel: '.rt-legend div', limit: 2 },
  { label: 'legend term', sel: '.rt-legend b', limit: 2 },
];

// The same page for a client who has never sold — the state MOST clients are in, so its
// copy is measured for real rather than assumed to inherit a tone measured elsewhere.
PROFILES['returns-holdings-empty'] = [
  { label: 'card label', sel: '.ret-k', limit: 3 },
  { label: 'card figure', sel: '.ret-v', limit: 3 },
  { label: 'card sub-line', sel: '.ret-sub', limit: 3 },
  { label: 'empty-state copy', sel: '.rt-empty-copy', limit: 1 },
];

/* The converged control vocabulary (Button and Control Modernisation, 2026-09-10).
 * Both label colours are NEW surfaces: Tier B puts #475569 on a translucent white that
 * sits over whatever the page's own glass/blob background happens to be, and Tier C is
 * the same at 13px. Hover is measured too, because .mw-btn-secondary:hover CHANGES both
 * the ground (#F5F3EF) and the text (#1A1C1E) — a hover state that fails is still a
 * failure, and rest-state alone would never have measured it. */
PROFILES.controls = [
  { label: 'Tier A label (gradient ground)', sel: '.mw-btn-primary', limit: 4 },
  { label: 'Tier A admin label', sel: '.mw-btn-admin', limit: 4 },
  { label: 'Tier A approve label', sel: '.mw-btn-approve', limit: 4 },
  { label: 'Tier A danger label', sel: '.mw-btn-danger', limit: 4 },
  { label: 'Tier B label (translucent ground)', sel: '.mw-btn-secondary', limit: 6 },
  // Scoped so no element is measured twice under two labels: a Tier C button that is
  // ALSO secondary is measured once, as Tier B. Measuring one button under both labels
  // produced 7.44:1 and 4.1:1 in the SAME run for the SAME element (the second sample
  // caught an antialiased edge pixel) - a permanent false failure if left in.
  { label: 'Tier C label', sel: '.mw-btn-sm:not(.mw-btn-secondary):not(.mw-btn-outline)', limit: 8 },
  { label: 'Tier B outline label', sel: '.mw-btn-outline', limit: 4 },
  { label: 'field text', sel: '.mw-field', limit: 6 },
  // --- hover: the secondary treatment changes BOTH ground and text on hover ---
  { label: 'HOVER Tier B label', sel: '.mw-btn-secondary', limit: 6, hover: true },
  { label: 'HOVER Tier C label', sel: '.mw-btn-sm:not(.mw-btn-secondary):not(.mw-btn-outline)', limit: 8, hover: true },
  { label: 'HOVER Tier A label', sel: '.mw-btn-primary', limit: 4, hover: true },
  { label: 'HOVER Tier A admin label', sel: '.mw-btn-admin', limit: 4, hover: true },
];

/* The accessible upload component and the floating-label pattern (rows 189/190,
 * 2026-09-10). The floated label is 11px uppercase on the field's own ground, which is a
 * genuinely new and genuinely small text surface — exactly the kind that passes by eye and
 * fails when measured. Focus states are included because both the label colour AND the
 * field ground change on focus. */
PROFILES['controls-fields'] = [
  { label: 'floating label (resting)', sel: '.mw-fld > label', limit: 10 },
  { label: 'field value text', sel: '.mw-fld > .mw-field', limit: 10 },
  { label: 'upload face', sel: '.mw-upload-face', limit: 4 },
  { label: 'upload hint', sel: '.mw-upload-hint', limit: 4 },
  { label: 'upload state', sel: '.mw-upload-state', limit: 4 },
  { label: 'upload clear', sel: '.mw-upload-clear', limit: 4 },
  { label: 'HOVER upload face', sel: '.mw-upload-face', limit: 4, hover: true },
  { label: 'HOVER upload clear', sel: '.mw-upload-clear', limit: 4, hover: true },
];

/* Merged Market Snapshot + Watchlist (2026-09-11). Every text surface on the new card,
 * measured on real composited pixels over the glass it actually sits on — the mockup's own
 * #7C868C / #8A9298 greys measure roughly 4.0:1 and 3.4:1 there and are not used.
 * BOTH badge styles are measured, not one as a stand-in for the other: Offered is green on
 * a green tint and Tracking only is slate on a navy tint, two genuinely different stacks.
 * The add panel and the alert modal are opened by CONTRAST_PREPARE_JS before sampling —
 * without that most of this profile is display:none and the run passes on nothing. */
/* Block grid + drawer (2026-09-12, row 206): the CARD FACE is measured here — every card
 * sits in the top-left quadrant of a full .glass card, so the sheen is composited over it
 * exactly as a client sees it (#watchlist-card carries .glass-lift; the measurement is what
 * proves that holds). The drawer is its own profile below, measured in two runs so BOTH
 * badge states are sampled inside it, not one as a stand-in for the other. */
PROFILES.watchlist = [
  { label: 'card ticker', sel: '.wl-card .wl-tag', limit: 8 },
  { label: 'card name', sel: '.wl-card .wl-name', limit: 8 },
  { label: 'badge Offered', sel: '.wl-card .wl-badge:not(.wl-track)', limit: 6 },
  { label: 'badge Tracking only', sel: '.wl-card .wl-badge.wl-track', limit: 6 },
  { label: 'card price', sel: '.wl-card .wl-px-v', limit: 8 },
  { label: 'card change (gain)', sel: '.wl-card .wl-px-c.wl-up', limit: 6 },
  { label: 'card change (loss)', sel: '.wl-card .wl-px-c.wl-dn', limit: 6 },
  { label: 'OPEN card ticker', sel: '.wl-card.is-open .wl-tag', limit: 2 },
  { label: 'OPEN card name', sel: '.wl-card.is-open .wl-name', limit: 2 },
  { label: 'Delayed label', sel: '.wl-delayed', limit: 1 },
  { label: 'search result source', sel: '.wl-src', limit: 6 },
  { label: 'HOVER card name', sel: '.wl-card .wl-name', limit: 6, hover: true },
  { label: 'HOVER card price', sel: '.wl-card .wl-px-v', limit: 6, hover: true },
];

/* The drawer sits on a faint green tint inside the glass card. Run once with an Offered
 * card open (Allocate present, armed alert line) and once with a Tracking-only card open. */
PROFILES['watchlist-drawer'] = [
  { label: 'drawer title', sel: '.wl-drawer-top b', limit: 1 },
  { label: 'drawer badge Offered', sel: '.wl-drawer .wl-badge:not(.wl-track)', limit: 1 },
  { label: 'drawer badge Tracking only', sel: '.wl-drawer .wl-badge.wl-track', limit: 1 },
  { label: 'drawer Allocate', sel: '.wl-drawer a.mw-btn', limit: 1 },
  { label: 'drawer bell (unarmed)', sel: '.wl-drawer .wl-bell:not(.is-on)', limit: 1 },
  { label: 'drawer bell (armed)', sel: '.wl-drawer .wl-bell.is-on', limit: 1 },
  { label: 'drawer Remove', sel: '.wl-drawer .wl-remove', limit: 1 },
  { label: 'armed alert line', sel: '.wl-alertline', limit: 1 },
];

/* The alert modal is measured in its OWN run, not alongside the card. It covers the page
 * with a blurred scrim, so anything behind it is sampled THROUGH that scrim — which is
 * exactly how the first run of this profile reported .wl-name at 3.6:1 with a white
 * foreground on a mid-grey ground. Those were real measurements of a genuinely obscured
 * surface, not a real contrast failure, and splitting the runs is what makes both honest. */
PROFILES['watchlist-modal'] = [
  { label: 'alert modal title', sel: '.wl-modal-title', limit: 1 },
  { label: 'alert modal copy', sel: '.wl-modal-sub', limit: 1 },
  { label: 'alert modal field label', sel: 'label[for="wl-alert-target"]', limit: 1 },
  { label: 'alert modal error', sel: '.wl-modal-error:not([hidden])', limit: 2 },
];


// ★ Asset logos (2026-09-13, row 207). The monogram is white bold text at 7–15px on a
// gradient well, which is the hardest text case on the site: antialiasing at that size eats
// coverage, and the mockup's own light stops (#C8860A gold 3.06:1, #1D8A66 green and
// #4A7FA5 blue 4.3:1) failed before that even started. Every hue is darkened in
// asset-mark.css; this profile is what proves the composited result. Runs on any page with
// marks — asset-collection.html (40px), dashboard.html (34px cards, 28px in an open drawer),
// asset-performance.html (28px) — plus the attribution line's own two surfaces.
PROFILES['asset-marks'] = [
  { label: 'monogram', sel: '.mk-mono .mk-t', limit: 16 },
  { label: 'logo credit', sel: '.asset-logo-credit', limit: 1 },
  { label: 'logo credit link', sel: '.asset-logo-credit a', limit: 1 },
];
// The synthetic strip verify-asset-logos-visual.mjs injects: every size × every length on a
// plain .glass card WITHOUT .glass-lift, positioned so the marks sit under the sheen's
// brightest part. The real cards carry .glass-lift (row 204), which composites the sheen
// BENEATH their content — so this is the honest answer to "does a monogram survive the
// sheen" for any future card that does not carry the lift.
PROFILES['asset-marks-sheen'] = [
  { label: 'sheen monogram', sel: '#mk-sheen-strip .mk-t', limit: 16 },
];

// ★ Savings deposit from unallocated capital (2026-09-11). The internal funding step is a
// genuinely new surface: a figure block on a slate-50 panel inside a white modal, plus a
// disabled-state error line. Measured rather than assumed safe because the amounts sit on a
// tinted panel, not the plain white the rest of the modal uses. CONTRAST_PREPARE_JS drives the
// real flow to that step first — it does not exist in the DOM until a client gets there.
PROFILES['hys-internal'] = [
  { label: 'available label', sel: '[data-step="funding-internal"] .uppercase', limit: 1 },
  { label: 'available figure', sel: '#np-internal-available', limit: 1 },
  { label: 'row label', sel: '[data-step="funding-internal"] .text-slate-600', limit: 2 },
  { label: 'transferring figure', sel: '#np-internal-amount', limit: 1 },
  { label: 'remaining figure', sel: '#np-internal-remaining', limit: 1 },
  { label: 'explanatory copy', sel: '[data-step="funding-internal"] .text-slate-500', limit: 1 },
  { label: 'card title', sel: '.np-funding-card[data-method="internal"] h4', limit: 1 },
  { label: 'card description', sel: '.np-funding-card[data-method="internal"] p', limit: 1 }
];

// The admin queue's own new surfaces: the INTERNAL TRANSFER badge (amber-100/amber-800, the
// most distinct of the three method badges by design) and the amber explanatory line that
// replaces the external destination details.
PROFILES['hys-internal-admin'] = [
  { label: 'internal badge', sel: '.bg-amber-100.text-amber-800', limit: 1 },
  { label: 'no-payment-to-confirm note', sel: '#pending-list .text-amber-800:not(.bg-amber-100)', limit: 1 }
];

// Crypto deposit routing (2026-09-11). The client-facing address card sits on the page's
// glass form panel with its own tinted sub-surfaces (an amber warning, a cream address box,
// an amber pending card) - three grounds that are not the plain white the rest of the form
// uses, so every text element on each is measured. CONTRAST_PREPARE_JS drives the real crypto
// option first; none of this exists in the DOM until a client has chosen it.
PROFILES['deposit-routing-client'] = [
  { label: 'choice name', sel: '.dep-choice b', limit: 4 },
  { label: 'choice network', sel: '.dep-choice .dep-net', limit: 4 },
  { label: 'warning title', sel: '#crypto-warning-title', limit: 1 },
  { label: 'warning body', sel: '#crypto-warning-body', limit: 1 },
  { label: 'address heading', sel: '#crypto-address-card .uppercase', limit: 1 },
  { label: 'network chip', sel: '#crypto-network-chip', limit: 1 },
  { label: 'address value', sel: '#crypto-address-value', limit: 1 },
  { label: 'copy button', sel: '#crypto-copy-btn', limit: 1 },
  { label: 'hash field label', sel: '#crypto-address-card .mw-fld label', limit: 1 },
  { label: 'hash hint', sel: '#crypto-hash-hint', limit: 1 },
  { label: 'hash hint lead', sel: '#crypto-hash-hint b', limit: 1 },
  { label: 'submit', sel: '#submit-crypto', limit: 1 },
  { label: 'pending title', sel: '#crypto-pending-card > div > p:first-child', limit: 1 },
  { label: 'pending body', sel: '#crypto-pending-card > div > p:nth-child(2)', limit: 1 },
  { label: 'pending meta key', sel: '#crypto-pending-card span', limit: 4 },
  { label: 'pending meta value', sel: '#crypto-pending-card b', limit: 4 }
];
PROFILES['deposit-routing-empty'] = [
  { label: 'empty title', sel: '#crypto-empty-state p:first-of-type', limit: 1 },
  { label: 'empty body', sel: '#crypto-empty-state p:nth-of-type(2)', limit: 1 },
  { label: 'empty CTA', sel: '#crypto-empty-message-pm', limit: 1 }
];
// The address book (glass card; the expanded management view is glass-subtle inside it).
PROFILES['deposit-routing-admin'] = [
  { label: 'currency name', sel: '#addresses-list .font-semibold', limit: 4 },
  { label: 'network / status pill', sel: '#addresses-list [class*="text-[10px]"]', limit: 8 },
  { label: 'address', sel: '#addresses-list .dep-addr', limit: 4 },
  { label: 'avatar initials', sel: '#addresses-list .dep-av', limit: 3 },
  { label: 'assigned-to text', sel: '#addresses-list td .text-xs', limit: 4 },
  { label: 'management note', sel: '.expand-row p', limit: 8 },
  { label: 'management cell', sel: '.expand-row td', limit: 8 },
  { label: 'management head', sel: '.expand-row th', limit: 4 },
  { label: 'management buttons', sel: '.expand-row button', limit: 4 }
];
// The deposits queue: the amount-less line and the amber no-hash note.
PROFILES['deposit-routing-queue'] = [
  { label: 'amount-determined line', sel: '#pending-list .italic', limit: 2 },
  { label: 'no-hash note', sel: '#pending-list .text-amber-800', limit: 2 },
  { label: 'no-hash lead', sel: '#pending-list .text-amber-700', limit: 2 },
  { label: 'sent-to / hash', sel: '#pending-list .dep-addr', limit: 4 },
  { label: 'route figure', sel: '#pending-list .text-base', limit: 2 }
];

// Product catalog — live pricing, part 1 (2026-09-11). The client card's new price block and
// its three source states (live green / stale grey / appraisal amber), the change figure in
// BOTH tones (a winner and a loser are both seeded so neither tone is assumed from the other),
// the ticker chip and the fractional-units note — all on the card's white ground inside the
// page's glass container.
PROFILES['live-pricing-client'] = [
  // Catalog expansion (2026-09-14, row 211): the compact card's own classes. The change figure
  // carries .up/.dn/.flat now, and the source line is a single 10.5px run (no bold segment).
  { label: 'unit price', sel: '.product-price', limit: 6 },
  { label: 'per-unit label', sel: '.cat-pr .cat-u', limit: 6 },
  { label: 'change (gain)', sel: '.price-change.up', limit: 3 },
  { label: 'change (loss)', sel: '.price-change.dn', limit: 3 },
  { label: 'source live', sel: '.price-source[data-source="live"]', limit: 3 },
  { label: 'source stale', sel: '.price-source[data-source="stale"]', limit: 3 },
  { label: 'source appraisal', sel: '.price-source[data-source="appraisal"]', limit: 3 },
  { label: 'ticker chip', sel: '.product-ticker', limit: 4 },
  { label: 'minimum line', sel: '.cat-ft .cat-min', limit: 4 },
  { label: 'minimum figure', sel: '.cat-ft .cat-min b', limit: 4 }
];
// Catalog expansion (2026-09-14, row 211): every text surface on the four-up card — on the
// plain card AND on the held card's faint green tint — plus the toolbar chips with their live
// counts, the sort control, the "Showing N of M" count and the Continue browsing button. The
// glass container carries .glass-lift, so the first row's names sit above the sheen; the
// sheen audit measures that separately.
PROFILES['catalog-card'] = [
  { label: 'card name', sel: '.cat-card:not(.is-held) .cat-name', limit: 6 },
  { label: 'held card name', sel: '.cat-card.is-held .cat-name', limit: 3 },
  { label: 'class chip (equities)', sel: '.cat-cl-eq', limit: 2 },
  { label: 'class chip (crypto)', sel: '.cat-cl-cr', limit: 2 },
  { label: 'class chip (PE)', sel: '.cat-cl-pe', limit: 2 },
  { label: 'class chip (real assets)', sel: '.cat-cl-ra', limit: 2 },
  { label: 'ticker chip', sel: '.product-ticker', limit: 3 },
  { label: 'unit price', sel: '.product-price', limit: 4 },
  { label: 'held unit price', sel: '.cat-card.is-held .product-price', limit: 2 },
  { label: 'per-unit label', sel: '.cat-pr .cat-u', limit: 3 },
  { label: 'change (gain)', sel: '.price-change.up', limit: 3 },
  { label: 'change (loss)', sel: '.price-change.dn', limit: 3 },
  { label: 'source live', sel: '.price-source[data-source="live"]', limit: 3 },
  { label: 'source stale', sel: '.price-source[data-source="stale"]', limit: 3 },
  { label: 'source appraisal', sel: '.price-source[data-source="appraisal"]', limit: 3 },
  { label: 'description', sel: '.cat-card:not(.is-held) .cat-ds', limit: 4 },
  { label: 'held description', sel: '.cat-card.is-held .cat-ds', limit: 2 },
  { label: 'allocate button', sel: '.cat-card:not(.is-held) .request-allocation-btn', limit: 3 },
  { label: 'add button (held)', sel: '.cat-card.is-held .request-allocation-btn', limit: 3 },
  { label: 'minimum line', sel: '.cat-ft .cat-min', limit: 3 },
  { label: 'minimum figure', sel: '.cat-ft .cat-min b', limit: 3 },
  { label: 'position line', sel: '.cat-ft .cat-pos', limit: 3 },
  { label: 'position units', sel: '.cat-ft .cat-pos b', limit: 3 },
  { label: 'position gain', sel: '.cat-ft .cat-pos .cat-g.up', limit: 3 },
  { label: 'position loss', sel: '.cat-ft .cat-pos .cat-g.dn', limit: 3 },
  { label: 'chip active', sel: '.category-tab[aria-pressed="true"]', limit: 1 },
  { label: 'chip active count', sel: '.category-tab[aria-pressed="true"] .cat-chip-n', limit: 1 },
  { label: 'chip inactive', sel: '.category-tab[aria-pressed="false"]', limit: 4 },
  { label: 'chip inactive count', sel: '.category-tab[aria-pressed="false"] .cat-chip-n', limit: 4 },
  { label: 'sort label', sel: '.cat-sort label', limit: 1 },
  { label: 'sort value', sel: '#catalog-sort', limit: 1 },
  { label: 'search label', sel: '.cat-search label', limit: 1 },
  { label: 'showing count', sel: '#cat-count', limit: 1 },
  { label: 'continue browsing', sel: '#load-more-btn', limit: 1 },
  { label: 'HOVER card name', sel: '.cat-card:not(.is-held) .cat-name', limit: 2, hover: true },
  { label: 'HOVER allocate button', sel: '.cat-card:not(.is-held) .request-allocation-btn', limit: 2, hover: true },
];
// The allocation panel, one state per run (the PREPARE hook opens it in the state named):
// every row exists in every state, so the same selector list applies to all three — the
// muted result box and the error line simply appear in the below-minimum run.
PROFILES['catalog-modal'] = [
  { label: 'modal title', sel: '#alloc-modal .cat-mtitle', limit: 1 },
  { label: 'modal source line', sel: '#alloc-modal .cat-msub', limit: 1 },
  { label: 'amount label', sel: '.cat-fieldlbl .cat-k', limit: 1 },
  { label: 'available', sel: '.cat-fieldlbl .cat-a', limit: 1 },
  { label: 'available figure', sel: '.cat-fieldlbl .cat-a b', limit: 1 },
  { label: 'currency prefix', sel: '.cat-amt .cat-cur', limit: 1 },
  { label: 'amount value', sel: '#alloc-amount', limit: 1 },
  { label: 'error line', sel: '.cat-err:not(.is-hidden)', limit: 1 },
  { label: 'quick amount', sel: '.cat-quick button:not(.is-on)', limit: 4 },
  { label: 'quick amount (on)', sel: '.cat-quick button.is-on', limit: 1 },
  { label: 'result key', sel: '.cat-result .cat-k', limit: 1 },
  { label: 'result value', sel: '.cat-result .cat-v', limit: 1 },
  { label: 'result sub', sel: '.cat-result .cat-x', limit: 1 },
  { label: 'after key', sel: '.cat-after .cat-k', limit: 2 },
  { label: 'after value', sel: '.cat-after .cat-v', limit: 2 },
  { label: 'gate note', sel: '.cat-gate span', limit: 1 },
  // A disabled control is exempt from the contrast floor (WCAG 1.4.3); the enabled state is what is measured.
  { label: 'submit', sel: '#alloc-submit:not(:disabled)', limit: 1 },
  { label: 'cancel', sel: '#alloc-cancel', limit: 1 },
  { label: 'close', sel: '#alloc-modal-close', limit: 1 },
];
// admin-products.html list: the 11px source lines in all four colours, inside the glass table.
PROFILES['live-pricing-admin-list'] = [
  { label: 'source market fresh', sel: '#products-list .text-emerald-800', limit: 3 },
  { label: 'source market stale', sel: '#products-list p.text-slate-600', limit: 3 },
  { label: 'source appraisal', sel: '#products-list .text-amber-800', limit: 3 },
  { label: 'source quote failed', sel: '#products-list .text-red-700', limit: 3 },
  { label: 'quote-failed block title', sel: '[id^="quote-failed-"] .text-red-800.font-semibold', limit: 1 },
  { label: 'quote-failed block body', sel: '[id^="quote-failed-"] p.text-xs', limit: 1 }
];
// The New product modal, after a real search: segmented control, hints, results (price,
// name, the unverified-exchange label), the green live preview.
PROFILES['live-pricing-admin-add'] = [
  { label: 'model segment (selected)', sel: '.add-model-btn[aria-checked="true"]', limit: 1 },
  { label: 'model segment (unselected)', sel: '.add-model-btn[aria-checked="false"]', limit: 1 },
  { label: 'cannot-change copy', sel: '#add-modal .text-slate-500 .text-slate-700', limit: 1 },
  { label: 'asset-class hint', sel: '#add-asset-class-hint', limit: 1 },
  { label: 'result symbol', sel: '.symbol-result .text-slate-900', limit: 3 },
  { label: 'result name', sel: '.symbol-result .text-slate-600', limit: 3 },
  { label: 'result exchange fallback', sel: '.symbol-result .text-slate-500', limit: 3 },
  { label: 'live preview label', sel: '#add-live-preview-label', limit: 1 },
  { label: 'live preview price', sel: '#add-live-preview-price', limit: 1 }
];
// The Publish valuation modal with the impact table populated (deltas in both tones).
PROFILES['live-pricing-admin-nav'] = [
  { label: 'current line', sel: '#nav-modal-current', limit: 1 },
  { label: 'mode segment (selected)', sel: '.nav-mode-btn[aria-checked="true"]', limit: 1 },
  { label: 'mode segment (unselected)', sel: '.nav-mode-btn[aria-checked="false"]', limit: 1 },
  { label: 'preview label (amber tint)', sel: '#nav-modal .text-xs.font-semibold[style]', limit: 1 },
  { label: 'preview price', sel: '#nav-preview', limit: 1 },
  { label: 'impact heading', sel: '#nav-impact-heading', limit: 1 },
  { label: 'impact who', sel: '.nav-impact-row .text-slate-700', limit: 4 },
  { label: 'impact from', sel: '.nav-impact-row .text-slate-500', limit: 4 },
  { label: 'impact to', sel: '.nav-impact-to', limit: 4 },
  { label: 'impact delta', sel: '.nav-impact-delta', limit: 4 },
  { label: 'impact total', sel: '#nav-impact-total', limit: 1 }
];

// Product catalog — fund documents, part 2 (2026-09-12). The client document: every text
// surface the renderer paints — the navy hero (chip, title, 72%-alpha labels, figures), the
// teal section headings, prose/list/strong, the terms table, the chart header in both tones
// (a gaining and a losing product are each measured in their own run), the risk callout,
// the download row, and the disclosure footer on its off-white ground.
PROFILES['fund-document-client'] = [
  { label: 'hero class chip', sel: '.fd-class', limit: 1 },
  { label: 'hero title', sel: '.fd-hero h1', limit: 1 },
  { label: 'hero figure label (72% cream)', sel: '.fd-meta > div', limit: 4 },
  { label: 'hero figure', sel: '.fd-meta > div b', limit: 4 },
  { label: 'section heading (teal)', sel: '.fd-section h2', limit: 8 },
  { label: 'prose', sel: '.fd-section > p', limit: 4 },
  { label: 'prose strong', sel: '.fd-section p strong', limit: 2 },
  { label: 'list item', sel: '.fd-section li', limit: 3 },
  { label: 'term key', sel: '.fd-term-k', limit: 4 },
  { label: 'term value', sel: '.fd-term-v', limit: 4 },
  { label: 'chart label', sel: '.fd-chart-a', limit: 1 },
  { label: 'chart change (gain)', sel: '.fd-chart-b.is-gain', limit: 1 },
  { label: 'chart change (loss)', sel: '.fd-chart-b.is-loss', limit: 1 },
  { label: 'single-valuation note', sel: '.fd-chart-note', limit: 1 },
  { label: 'risk callout', sel: '.fd-risk p', limit: 2 },
  { label: 'download name', sel: '.fd-dl-nm b', limit: 1 },
  { label: 'download meta', sel: '.fd-dl-nm span', limit: 1 },
  { label: 'download button', sel: '.fd-dl-btn', limit: 1 },
  { label: 'disclosure text', sel: '.fd-foot p', limit: 2 },
  { label: 'full-disclosures link', sel: '.fd-foot-more a', limit: 1 }
];
// The PM authoring page: section headers/hints/pills, the editor toolbar, editor prose, the
// counter in both states, the automatic-valuation note, the ordering note, the status chip
// in its three states, custom-section heading inputs, and the inline server error.
PROFILES['fund-document-admin'] = [
  { label: 'section name', sel: '.sect .sh .n b', limit: 6 },
  { label: 'section hint', sel: '.sect .sh .n span.hint', limit: 6 },
  { label: 'required pill', sel: '.req:not(.opt):not(.auto)', limit: 2 },
  { label: 'optional pill', sel: '.req.opt', limit: 1 },
  { label: 'automatic pill', sel: '.req.auto', limit: 1 },
  { label: 'toolbar button', sel: '.rte-btn', limit: 5 },
  { label: 'editor prose', sel: '.rte-body p', limit: 3 },
  { label: 'editor strong', sel: '.rte-body strong, .rte-body b', limit: 1 },
  { label: 'counter', sel: '.rte-counter:not(.over)', limit: 2 },
  { label: 'counter (over cap)', sel: '.rte-counter.over', limit: 1 },
  { label: 'terms minimum (from product)', sel: '#terms-minimum', limit: 1 },
  { label: 'terms minimum hint', sel: '#terms-minimum + p', limit: 1 },
  { label: 'auto note title', sel: '.auto-note b', limit: 1 },
  { label: 'auto note body', sel: '.auto-note p', limit: 1 },
  { label: 'ordering note', sel: '.ordernote p', limit: 1 },
  { label: 'custom heading input', sel: '.htitle', limit: 2 },
  { label: 'status chip', sel: '#doc-status-chip', limit: 1 },
  { label: 'publish hint', sel: '#doc-publish-hint', limit: 1 },
  { label: 'inline server error', sel: '#doc-error', limit: 1 },
  { label: 'attachment name', sel: '#attachment-name', limit: 1 },
  { label: 'attachment meta', sel: '#attachment-meta', limit: 1 }
];

// Portfolio overview (2026-09-12; bundled card 2026-09-13). Every text surface the bundled
// card, the pending panel and the maturities panel put on the dashboard's glass — measured
// composited, because a grey declared safe on white is not safe inside a backdrop-filter
// layer (rows 193/200), and because the band's lead figure sits top-left of a full glass card,
// exactly the sheen's failing case (row 204). Both change tones are separate runs (a gaining
// client and a losing client, row 187's discipline); the range control in both states; the
// three-row tooltip in its own hovered run. The y-axis ticks are canvas text Chart.js paints
// in the same #475569 as the DOM x-labels (.po-xl), which stand in for them here.
// Visitor presence (2026-09-13) — admin-presence.html. The stat strip and the table sit on
// glass; the compose modal is opened by the prepare hook. Both tag colours, the live pill,
// the trail and the 30-second wait note are measured on real composited pixels.
PROFILES['visitor-presence'] = [
  // First: the two surfaces that only exist for a moment (the wait note counts down to
  // nothing after 30 s), measured before the run's own duration removes them.
  { label: 'wait note', sel: '[data-wait]', limit: 1 },
  { label: 'message button (enabled)', sel: 'button[data-message]:not(:disabled)', limit: 1 },
  { label: 'page title', sel: 'main h2', limit: 1 },
  { label: 'page subtitle', sel: 'main h2 + p', limit: 1 },
  { label: 'live pill', sel: '#live-pill-text', limit: 1 },
  { label: 'notification copy', sel: '#notif-copy', limit: 1 },
  { label: 'mute label', sel: '#mute-label', limit: 1 },
  { label: 'stat label', sel: '#stat-strip p:first-child', limit: 4 },
  { label: 'stat value', sel: '#st-live, #st-today, #st-median, #st-page', limit: 4 },
  { label: 'stat sub', sel: '#st-live-x, #st-today-x, #st-page-x', limit: 3 },
  { label: 'tab (selected)', sel: '.tab-pill.is-active', limit: 1 },
  { label: 'tab (unselected)', sel: '.tab-pill:not(.is-active)', limit: 2 },
  { label: 'column heading', sel: '#presence-list th', limit: 3 },
  { label: 'visitor name', sel: '#presence-list td b', limit: 3 },
  { label: 'client tag', sel: '.tagc.bg-blue-100', limit: 1 },
  { label: 'anonymous tag', sel: '.tagc.bg-slate-100', limit: 1 },
  { label: 'visitor sub-line', sel: '#presence-list td b + span', limit: 3 },
  { label: 'current page', sel: '#presence-list code', limit: 2 },
  { label: 'journey trail', sel: '.trail span', limit: 3 },
  { label: 'flag box', sel: '.flagbox', limit: 2 },
  { label: 'location', sel: '#presence-list td:nth-child(3) > span', limit: 2 },
  { label: 'device', sel: '#presence-list td:nth-child(4) > span', limit: 2 },
  { label: 'referrer', sel: '#presence-list td:nth-child(5)', limit: 2 },
  { label: 'duration', sel: '[data-dur]', limit: 3 },
  { label: 'footer rule', sel: '#presence-foot > span:first-child', limit: 1 },
  { label: 'footer counts', sel: '#presence-foot > span:last-child', limit: 1 }
];
PROFILES['visitor-presence-modal'] = [
  { label: 'modal title', sel: '#message-modal-title', limit: 1 },
  { label: 'modal explanation', sel: '#message-modal-title ~ p', limit: 1 },
  { label: 'context label', sel: '#mm-context > div', limit: 4 },
  { label: 'context value', sel: '#mm-context b', limit: 4 },
  { label: 'snippet', sel: '.snip', limit: 3 },
  { label: 'textarea text', sel: '#mm-text', limit: 1 },
  { label: 'rule note', sel: '#mm-rule', limit: 1 },
  { label: 'send button', sel: '#mm-send', limit: 1 },
  { label: 'cancel button', sel: '#mm-cancel', limit: 1 }
];

PROFILES['portfolio-overview'] = [
  { label: 'card title', sel: '.po-title', limit: 1 },
  { label: 'as-of indicator', sel: '#po-asof', limit: 1 },
  { label: 'band label', sel: '.po-band .ret-k', limit: 3 },
  { label: 'value figure (38px, under the sheen corner)', sel: '#tpv-amount', limit: 1 },
  { label: 'since pill (gain)', sel: '.po-pill.is-up', limit: 1 },
  { label: 'since text', sel: '.po-since', limit: 1 },
  { label: 'this-month figure', sel: '#tpv-monthly-change b', limit: 1 },
  { label: 'this-month text', sel: '#tpv-monthly-change span', limit: 2 },
  { label: 'return figure (gain)', sel: '#total-return-amount', limit: 1 },
  { label: 'return pill', sel: '#total-return-pct', limit: 1 },
  { label: 'return context line', sel: '#total-return-split', limit: 1 },
  { label: 'unrealised figure', sel: '#total-unrealized-amount', limit: 1 },
  { label: 'realised figure', sel: '#asset-returns-amount', limit: 1 },
  { label: 'best class name', sel: '.ret-class', limit: 1 },
  { label: 'best class pill', sel: '#best-performing-return .ret-pc', limit: 1 },
  { label: 'best class context', sel: '#best-performing-return', limit: 1 },
  { label: 'chart title', sel: '.po-ch-title', limit: 1 },
  { label: 'legend item', sel: '.po-leg > span', limit: 4 },
  { label: 'range control (selected)', sel: '.po-rg.is-on', limit: 1 },
  { label: 'range control (unselected)', sel: '.po-rg:not(.is-on):not(:disabled)', limit: 2 },
  { label: 'x-axis label', sel: '.po-xl span', limit: 3 },
  { label: 'chart hint', sel: '#po-chart-hint', limit: 1 },
  { label: 'period stat label', sel: '.po-pf .ret-k', limit: 4 },
  { label: 'period stat value', sel: '.po-pv:not(.is-up):not(.is-dn)', limit: 2 },
  { label: 'period stat value (gain)', sel: '.po-pv.is-up', limit: 1 },
  { label: 'period stat value (loss)', sel: '.po-pv.is-dn', limit: 1 },
  { label: 'period stat sub', sel: '.po-ps', limit: 4 },
  { label: 'panel title', sel: '.po-hd .po-t', limit: 2 },
  { label: 'panel subtitle', sel: '.po-hd .po-s', limit: 2 },
  { label: 'request title', sel: '.po-rt', limit: 3 },
  { label: 'request detail', sel: '.po-rs', limit: 3 },
  { label: 'request amount', sel: '.po-v', limit: 3 },
  { label: 'pending chip', sel: '.po-chip:not(.is-internal)', limit: 2 },
  { label: 'internal transfer chip', sel: '.po-chip.is-internal', limit: 1 },
  { label: 'pocket name', sel: '.po-mn', limit: 2 },
  { label: 'pocket value', sel: '.po-mv', limit: 2 },
  { label: 'maturity date', sel: '.po-md', limit: 2 },
  { label: 'interest accrued', sel: '.po-mi:not(.is-none)', limit: 1 },
  { label: 'no-interest note', sel: '.po-mi.is-none', limit: 1 }
];
PROFILES['portfolio-overview-loss'] = [
  { label: 'since pill (loss)', sel: '.po-pill.is-dn', limit: 1 },
  { label: 'this-month figure (loss)', sel: '#tpv-monthly-change b.is-dn', limit: 1 },
  { label: 'return figure (loss)', sel: '#total-return-amount.is-loss', limit: 1 },
  { label: 'return pill (loss)', sel: '#total-return-pct.is-loss', limit: 1 },
  { label: 'unrealised figure (loss)', sel: '#total-unrealized-amount.is-loss', limit: 1 },
  { label: 'best class pill (loss — "Most resilient class")', sel: '#best-performing-return .ret-pc.is-loss', limit: 1 },
  { label: 'period stat value (loss)', sel: '.po-pv.is-dn', limit: 1 }
];
// The three-row tooltip, measured hovered: the prepare hook (the visual suite) moves the real
// pointer onto an anchor first, so the tooltip is genuinely open when sampled.
PROFILES['portfolio-overview-tip'] = [
  { label: 'tooltip date', sel: '.po-tip.is-on .po-td', limit: 1 },
  { label: 'tooltip row label', sel: '.po-tip.is-on .po-tr span', limit: 3 },
  { label: 'tooltip row figure', sel: '.po-tip.is-on .po-tr b:not(.is-up):not(.is-dn)', limit: 2 },
  { label: 'tooltip return (gain)', sel: '.po-tip.is-on .po-tr b.is-up', limit: 1 }
];
// The new-client state and both empty states, on the same glass: the band still renders.
PROFILES['portfolio-overview-new'] = [
  { label: 'band label', sel: '.po-band .ret-k', limit: 3 },
  { label: 'value figure', sel: '#tpv-amount', limit: 1 },
  { label: 'this-month ("New this month")', sel: '#tpv-monthly-change span', limit: 1 },
  { label: 'return figure (flat $0)', sel: '#total-return-amount', limit: 1 },
  { label: 'best class dash', sel: '.ret-class', limit: 1 },
  { label: 'chart title', sel: '.po-ch-title', limit: 1 },
  { label: 'new-client heading', sel: '.po-newc b', limit: 1 },
  { label: 'new-client explanation', sel: '.po-newc p', limit: 1 },
  { label: 'new-client sub', sel: '.po-newc-sub', limit: 1 },
  { label: 'empty-state heading', sel: '.po-empty b', limit: 2 },
  { label: 'empty-state copy', sel: '.po-empty p', limit: 2 }
];

const SELECTORS = PROFILES[process.env.CONTRAST_PROFILE || 'resources'];
if (!SELECTORS) throw new Error('unknown CONTRAST_PROFILE: ' + process.env.CONTRAST_PROFILE);

// WCAG relative luminance + contrast ratio.
const lum = (c) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const pair = [lum(a), lum(b)].sort((p, q) => q - p);
  return (pair[0] + 0.05) / (pair[1] + 0.05);
};

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.text + ' :: ' + ((d.exception && d.exception.description) || ''));
    }
    return r.result.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Pixels that changed luminance bin between two samples of the same box (half the L1
// distance between the two histograms — each moved pixel leaves one bin and enters another).
const pixelsShifted = (a, b) => a.reduce((acc, v, i) => acc + Math.abs(v - b[i]), 0) / 2;

const SAMPLER = [
  'window.__sample = (dataUri, rect) => new Promise((resolve) => {',
  '  const img = new Image();',
  '  img.onload = () => {',
  '    const c = document.createElement("canvas");',
  '    c.width = img.width; c.height = img.height;',
  '    const g = c.getContext("2d", { willReadFrequently: true });',
  '    g.drawImage(img, 0, 0);',
  '    const x = Math.max(0, Math.round(rect.x)), y = Math.max(0, Math.round(rect.y));',
  '    const w = Math.max(1, Math.min(Math.round(rect.w), img.width - x));',
  '    const h = Math.max(1, Math.min(Math.round(rect.h), img.height - y));',
  '    const d = g.getImageData(x, y, w, h).data;',
  '    const px = [];',
  '    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i+1], d[i+2]]);',
  '    const L = (p) => 0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2];',
  '    px.sort((a, b) => L(a) - L(b));',
  '    const hist = new Array(16).fill(0); px.forEach((p) => { hist[Math.min(15, Math.floor(L(p) / 16))]++; });',
  '    resolve({ darkest: px[0], lightest: px[px.length-1], median: px[Math.floor(px.length/2)], n: px.length, hist });',
  '  };',
  '  img.src = dataUri;',
  '});',
].join('\n');

async function measure(cdp, t) {
  const pick = 'document.querySelectorAll(' + JSON.stringify(t.sel) + ')[' + t.idx + ']';

  const rect = await cdp.eval([
    '(async () => {',
    '  const el = ' + pick + '; if (!el) return null;',
    '  el.scrollIntoView({ block: "center", behavior: "instant" });',
    '  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));',
    '  const r = el.getBoundingClientRect();',
    '  return { x: r.x, y: r.y, w: r.width, h: r.height };',
    '})()',
  ].join('\n'));
  if (!rect) return null;

  // Hovering a row shifts it (.res-item:hover adds padding-left), so the rect captured above
  // describes where the glyphs WERE, not where they are once hovered. Re-read the box in the
  // hovered state; sampling the stale rect reads mostly background and fakes a ~1.0:1 pass
  // failure that has nothing to do with the colours under test.
  let box = rect;
  if (t.hover) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    await sleep(450);
    box = await cdp.eval([
      '(() => { const el = ' + pick + '; if (!el) return null;',
      '  const r = el.getBoundingClientRect();',
      '  return { x: r.x, y: r.y, w: r.width, h: r.height }; })()',
    ].join('\n')) || rect;
  }

  const shot = async () => 'data:image/png;base64,' + (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;

  // The box is re-read around EACH screenshot (see the non-vacuity note below): a page
  // toggling layout faster than one measurement can sit at the same position for a single
  // before/after pair and elsewhere for a screenshot in between.
  const readBox = () => cdp.eval('(() => { const el = ' + pick + '; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');

  // Pass 1 - normal render. Darkest pixel in the box is the glyph core.
  const shot1 = await shot(); const box1 = await readBox();
  const fg = await cdp.eval('window.__sample(' + JSON.stringify(shot1) + ', ' + JSON.stringify(box) + ')');

  // Pass 2 - Trap 2: remove the glyphs only, never the box.
  // A live page can re-render between the two passes (admin-presence.html rebuilds its table
  // when a row's state changes); an element that vanished is reported as such rather than
  // crashing the whole run on a null dereference.
  const stillThere = await cdp.eval([
    '(() => { const el = ' + pick + '; if (!el) return false;',
    '  el.dataset.savedStyle = el.style.cssText;',
    '  el.style.setProperty("color", "transparent", "important");',
    '  el.style.setProperty("-webkit-text-fill-color", "transparent", "important");',
    '  el.style.setProperty("text-shadow", "none", "important"); return true; })()',
  ].join('\n'));
  if (!stillThere) return null;
  await sleep(120);
  const box2a = await readBox(); const shot2 = await shot();
  const bg = await cdp.eval('window.__sample(' + JSON.stringify(shot2) + ', ' + JSON.stringify(box) + ')');
  await cdp.eval('(() => { const el = ' + pick + '; if (!el) return; el.style.cssText = el.dataset.savedStyle || ""; delete el.dataset.savedStyle; })()');

  // ★ NON-VACUITY (2026-09-13, from the sheen audit's own finding): the box must not have
  // moved around EITHER screenshot (four reads), and hiding the glyphs must have CHANGED the sampled
  // pixels — otherwise the box held no glyphs (the page was still laying out) and any ratio
  // computed from it is a confident wrong number. Reported as unmeasured, never as a ratio.
  const after = await readBox();
  const differs = (q) => !q || Math.abs(q.x - box.x) > 1 || Math.abs(q.y - box.y) > 1 || Math.abs(q.w - box.w) > 1 || Math.abs(q.h - box.h) > 1;
  const moved = [box1, box2a, after].some(differs);
  // "Changed" is a pixel-DISTRIBUTION test, not an extremes test: a legend swatch in the same
  // navy as its text keeps the darkest pixel put, and a white-on-navy pill's rounded corners
  // keep the card ground as the lightest pixel — both are real, legible elements whose glyphs
  // genuinely vanished, and an extremes-only check calls them vacuous. Hiding real glyphs
  // moves pixels between luminance bins; that is what is counted.
  const shifted = pixelsShifted(fg.hist, bg.hist);
  const changed = shifted >= Math.max(6, fg.n * 0.005);
  if (moved || !changed) return { unmeasured: moved ? 'box moved during measurement (' + Math.round(box.x) + ',' + Math.round(box.y) + ' → ' + (after ? Math.round(after.x) + ',' + Math.round(after.y) : 'gone') + ')' : 'hiding the glyphs changed nothing in the box (' + shifted + ' of ' + fg.n + ' pixels moved at ' + Math.round(box.x) + ',' + Math.round(box.y) + ' ' + Math.round(box.w) + '×' + Math.round(box.h) + ') — no glyphs were sampled' };

  if (t.hover) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });

  // Polarity matters: on a light surface the glyph core is the DARKEST pixel, but on a dark
  // surface (the hero, the table head, the footer) it is the LIGHTEST. Picking "darkest"
  // unconditionally reports the background against itself and yields a meaningless ~1.0:1.
  // Choose whichever extreme sits furthest from the measured background luminance.
  const bgc = bg.median;
  const dDark = Math.abs(lum(fg.darkest) - lum(bgc));
  const dLight = Math.abs(lum(fg.lightest) - lum(bgc));
  const fgc = dLight > dDark ? fg.lightest : fg.darkest;
  return { fg: fgc, bg: bgc, polarity: dLight > dDark ? 'light-on-dark' : 'dark-on-light',
           ratio: Math.round(ratio(fgc, bgc) * 100) / 100 };
}

async function main() {
  const profile = makeTempDir('mw-contrast-');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  trackChild(profile, chrome);

  // Connect to a PAGE target, not the browser target - the browser-level endpoint does not
  // implement Page/Runtime/Input, and reports them as "wasn't found".
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl;
      else await sleep(250);
    } catch (e) { await sleep(250); }
  }
  if (!wsUrl) { await releaseTempDir(profile); throw new Error('Chrome did not expose a page debugging endpoint'); }

  const ws = new WebSocket(wsUrl);
  trackChild(profile, chrome, ws);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // Trap 3: pin reduced motion so nothing is sampled mid-transition.
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const widths = (process.env.CONTRAST_WIDTHS || '1440').split(',').map(Number);
  const results = [];

  for (const width of widths) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    // An authenticated target needs its session in place BEFORE the page's own script runs,
    // so seed it on the same origin first, then navigate for real.
    if (process.env.CONTRAST_BOOTSTRAP_JS) {
      const origin = new URL(PAGE_URL).origin + '/';
      await cdp.send('Page.navigate', { url: origin });
      await sleep(600);
      await cdp.eval(process.env.CONTRAST_BOOTSTRAP_JS);
    }
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(Number(process.env.CONTRAST_SETTLE_MS || 1800));

    // CONTRAST_PREPARE_JS runs AFTER the page has settled, unlike CONTRAST_BOOTSTRAP_JS,
    // which must run BEFORE navigation to seed a session. It exists because some controls
    // only come into being once the page is live and something has been opened - a
    // conditionally-revealed form panel, a modal. Without it those controls are never
    // measured at all and the run reports a confident zero.
    if (process.env.CONTRAST_PREPARE_JS) {
      await cdp.eval(process.env.CONTRAST_PREPARE_JS);
      await sleep(Number(process.env.CONTRAST_PREPARE_SETTLE_MS || 900));
    }
    // CONTRAST_CHAOS_BLANK=1: a VERIFICATION-ONLY hook — every glyph on the page is made
    // transparent BEFORE measuring, the page whose text never painted. Both passes then sample
    // the same pixels and the non-vacuity guard must report every target UNMEASURED with 0
    // pixels moved, never a ratio. Not for normal runs.
    if (process.env.CONTRAST_CHAOS_BLANK) await cdp.eval('document.head.appendChild(Object.assign(document.createElement("style"), { textContent: "body, body * { color: transparent !important; -webkit-text-fill-color: transparent !important; }" })); true');

    // Viewport-integrity guard: this project has had a run report a clean PASS while the
    // browser was silently clamped to a different width. Fail loudly instead.
    const real = await cdp.eval('window.innerWidth');
    if (real !== width) throw new Error('viewport integrity: asked ' + width + ', got ' + real);

    await cdp.eval(SAMPLER);

    const targets = await cdp.eval([
      '(() => {',
      '  const sels = ' + JSON.stringify(SELECTORS) + ';',
      '  const out = [];',
      '  for (const s of sels) {',
      '    document.querySelectorAll(s.sel).forEach((el, i) => {',
      '      if (s.limit != null && i >= s.limit) return;',
      '      const r = el.getBoundingClientRect();',
      '      if (r.width < 4 || r.height < 4) return;',
      '      const cs = getComputedStyle(el);',
      '      if (cs.visibility === "hidden" || cs.display === "none") return;',
      '      if (!el.textContent.trim()) return;',
      '      out.push({ label: s.label + (i ? " #" + (i+1) : ""), sel: s.sel, idx: i, hover: !!s.hover });',
      '    });',
      '  }',
      '  return out;',
      '})()',
    ].join('\n'));

    for (const t of targets) {
      // An unmeasured element (the box moved or held no glyphs) is retried once after a settle
      // nap — the page may have been mid-layout — and then recorded as UNMEASURED.
      let m = await measure(cdp, t);
      if (m && m.unmeasured) { await sleep(700); m = await measure(cdp, t); }
      if (m) results.push(Object.assign({ width }, t, m));
    }
  }

  await releaseTempDir(profile);
  report(results);
}

function report(allRows) {
  const unmeasured = allRows.filter((r) => r.unmeasured);
  const rows = allRows.filter((r) => !r.unmeasured);
  const fail = rows.filter((r) => r.ratio < THRESHOLD);
  for (const w of [...new Set(rows.map((r) => r.width))]) {
    console.log('\n=== viewport ' + w + 'px ===');
    const set = rows.filter((x) => x.width === w).sort((a, b) => a.ratio - b.ratio);
    for (const r of set) {
      const rgb = (c) => 'rgb(' + c.join(',') + ')';
      console.log('  ' + (r.ratio >= THRESHOLD ? 'PASS' : 'FAIL') +
        '  ' + String(r.ratio).padStart(6) + ':1  ' + r.label.padEnd(26) +
        ' fg=' + rgb(r.fg).padEnd(18) + ' bg=' + rgb(r.bg));
    }
  }
  unmeasured.forEach((r) => console.log('  UNMEASURED  ' + r.label.padEnd(26) + ' — ' + r.unmeasured));
  console.log('\n' + rows.length + ' measurements, ' + fail.length + ' below ' + THRESHOLD + ':1' + (unmeasured.length ? ', ' + unmeasured.length + ' UNMEASURED (box moved or held no glyphs — the page never settled; not a contrast result)' : ''));
  // A run that measured NOTHING is not a pass. It means the page never loaded, or no selector
  // matched anything - and reporting PASS there is a vacuous green that would hide a real
  // regression rather than catch it. Seen intermittently on login.html, whose auth module is
  // slow to settle, which is exactly the kind of page where a silent zero is most misleading.
  if (rows.length === 0) {
    console.log('CONTRAST: FAIL (no measurements taken — page did not load, or no selector matched)');
    process.exit(1);
  }
  console.log(fail.length || unmeasured.length ? 'CONTRAST: FAIL' : 'CONTRAST: PASS');
  process.exit(fail.length || unmeasured.length ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
