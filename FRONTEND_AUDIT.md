# Frontend Audit — Marketswave

**Date:** 2026-08-27
**Scope:** All 33 pages — public site (9), client dashboard (10), admin tool (14).
**Type:** Report only. Nothing was fixed or edited to produce this document.
**Method:** Full read of every page's source, cross-referenced against the Backend Requirements
Register (`Marketswave_Project_Handover.md` §3.1) and CLAUDE.md's Deferred section, plus direct
verification (grep/read) of the highest-stakes findings below before including them here. Four
parallel research passes (public site / client dashboard / admin Overview+Client List+Approval
Gate / remaining admin pages) fed this synthesis; findings that showed up independently in more
than one pass are noted as such.

Legend for the "Placeholder/Decorative" column: **TRACKED** = already has a Backend
Requirements Register row or a CLAUDE.md Deferred-section mention (cited). **NOT TRACKED** =
no register row or CLAUDE.md mention found anywhere — the category worth prioritizing first.

---

## Top findings to prioritize (all NOT TRACKED)

Ranked roughly by how likely each is to mislead a real user or PM, not by effort to fix:

1. **`support.html` shows 3 fabricated support tickets to every client with no real history**,
   not just the original demo client — the seed data (`TCK-1042`/`DSP-2077`/`TCK-1055`) is the
   fallback whenever a client's own scoped `marketswave_support_requests` key is empty, which is
   true for every client created since the multi-client model shipped. The real "no requests
   yet" empty state exists in code but is effectively unreachable. Verified directly in
   `support.html`'s own seed/fallback logic.
2. **`admin-advisory-fee.html`'s copy claims the rate is "Account-wide" / applies "across every
   client-facing page,"** but `setAdvisoryFeeRate()` writes to the ambient CURRENT client's own
   scoped account state (`clientScopedKey(ACCOUNT_KEY)`), not a global value — verified directly
   in `engine-core.js`. A PM could believe they've repriced every client when they've only
   repriced whichever one happens to be active in their admin session.
3. **Every admin page (all 14) displays a hardcoded "No login gate — internal preview build"
   badge**, but a real passphrase gate (`admin-login.html`, enforced in `admin-sidebar.js`) has
   existed since Aug 21, 2026 — the badge is stale copy that now actively contradicts real,
   working functionality. Found independently by two separate audit passes across all 14 pages.
4. **`settings.html`'s "Active Sessions & Linked Devices" section is entirely fake** — three
   hardcoded demo sessions with specific cities/devices/timestamps, no visual "demo data" cue,
   "Log out" just deletes the DOM row. Verified via the code's own `// in-memory demo data`
   comment. Mentioned once in the handover doc's build narrative but never given its own
   register row.
5. **`high-yield-savings.html` pocket withdrawal bypasses the PM-approval pattern entirely** —
   `finalizeWithdrawal()` flips a pocket to `withdrawn` and saves directly to `localStorage`,
   with no approval gate and no transaction-ledger entry, unlike HYS *deposits* (which do go
   through `requestHYSDeposit()`) and unlike the main Withdrawal flow on `deploy-capital.html`
   (which also has a real approval gate). Verified directly in the function itself.
6. **`risk-management.html`'s Risk Capacity / Diversification Score cards were deliberately
   static by original design** (documented once, pre-multi-client) **but that intent predates
   the Multi-Client Data Model** — the numbers are only correct for the original demo client and
   would misrepresent any other real client. The page's own footer copy is also stale ("once the
   portfolio engine is built" — the engine has existed for most of this project's history).
7. **`about.html` has no real team-member identity anywhere** — three cards literally read
   "Headshot" / "Leadership Role" placeholder text, and its "Connect" section's 3 social links
   are all dead (`href="#"`).
8. **The public site's footer "Get Access" link is dead (`href="#"`) on all 9 pages** — a
   duplicate of the header's own "Get Access" button, which works correctly.
9. **`documents.html`'s Upload has no file-selected validation** — clicking "Upload Document"
   with nothing chosen silently creates a document named "Untitled Document.pdf" instead of
   showing an error.
10. **`thank-you.html`'s copy promises a confirmation email** ("Please check your email...")
    that no part of this project can ever send — no transactional-email system exists anywhere.

Everything else below is organized by page family as requested — narrower findings, already-
tracked items (noted for completeness, not because they need attention), and the Missing
States / Visual Flatness / Structural Gaps columns for every page.

---

## Public Site

| Page | Placeholder/Decorative | Missing States | Visual Flatness | Structural Gaps |
|---|---|---|---|---|
| index.html | "Process & Philosophy Visual" is literal placeholder text standing in for missing imagery — NOT TRACKED. Dead footer "Get Access" link (see Top Findings #8). Stats bar's "International"/"Multi-Asset Class" are qualitative claims dressed as stat values — minor, likely intentional. | N/A — static content. Get Access modal open/close has a real CSS transition. | Real hierarchy: large hero type, stats bar, alternating section backgrounds, icon-badged cards; `styles.css` carries 45 hover/transition rules site-wide. Reads as designed, not flat. | The "Process & Philosophy Visual" placeholder is the one visible unfinished spot. |
| services.html | Only the site-wide dead footer link (#8). | N/A — static. | Good: labeled sections, alternating "service-landscape-card" layout, substantive per-service copy of comparable depth. | None — all 5 service cards are comparably developed. |
| resources.html | **Blog & Press** confirmed placeholder ("Content will be published here...", dead "View latest updates" link) — **TRACKED** (Register row 21). Dead footer link (#8). | N/A — static. | Strong hierarchy: numbered workflow steps, a real data table, tagged strategy-card grid — one of the most content-rich pages. | Blog & Press reads visibly thinner than the much richer Strategies/How-It-Works sections above it — expected, given its tracked placeholder status. |
| about.html | No real team-member identity anywhere — 3 cards show literal "Headshot"/"Leadership Role" placeholder text; "Connect" section's 3 social links all dead (see Top Findings #7). Dead footer link (#8). | N/A — static. | Good hierarchy (vision/mission cards, background section, team grid), but the 3 team cards read visibly thinner than the rest of the page given the placeholder text. | No real team-member identity anywhere — the single most visible content gap on the public site. |
| legal.html | None — substantial real boilerplate legal copy across all 4 sections. Dead footer link (#8). | N/A — static. | Fairly flat/dense by design (long-form legal text); a jump-nav menu gives some wayfinding. Appropriate for the content type. | None — depth is even across all 4 sub-sections. |
| contact.html | **Contact form is non-functional** (`action="#"`, no real submit handler; a honeypot field exists but nothing real backs it) — **TRACKED** (Register row 20). Dead footer link (#8). | No success/error state ever shows after "submit" — a direct consequence of the tracked stub above. Custom-select dropdowns are real, functional components. | Good: two-column layout, custom-styled selects with real open/close interaction. One of the more interactive public pages. | None beyond the already-tracked form stub. |
| signup.html | None — the one public page with genuinely real backend behavior (Firebase Auth + Firestore). | **NOT TRACKED**: the final "Submit Application" button only disables itself (no spinner/"Submitting…" text) while the real network call can take 20+ seconds on a cold start (directly observed this session) — no feedback during a potentially long wait. Per-step validation still uses native `alert()`, a pattern already flagged once elsewhere in this project's history as an automation/UX footgun. | Multi-step wizard with a real progress bar and step label — genuine structural hierarchy. | None beyond the loading-state gap noted above. |
| login.html | None. | Handled well: a real "Signing you in / Preparing your portal…" full-screen loading state on success (confirmed working live this session); one deliberately generic error banner on failure (a documented email-enumeration-avoidance choice, not a gap). | Simple, focused single-card layout; Forgot Password is a real multi-step panel, not a static link. | None. |
| thank-you.html | Copy promises a confirmation email that nothing in this project can send (Top Findings #10). | N/A — static single-purpose confirmation screen. | Deliberately minimal by design — appropriate for a one-off confirmation page. | None. |

---

## Client Dashboard

| Page | Placeholder/Decorative | Missing States | Visual Flatness | Structural Gaps |
|---|---|---|---|---|
| dashboard.html | Market Snapshot (S&P 500/NASDAQ/BTC/ETH) and Currency Converter are 100% hardcoded, never wired to JS — both **TRACKED** (Register rows 22–23, explicitly deferred external-data items). No other placeholders found; Risk Metrics/Allocation/Recent Activity all read live engine state. | Recent Activity has a real empty state ("No recent activity yet."). Risk Metrics badges briefly show "—" before JS populates them (negligible flash). | Good — gradient Total Portfolio Value hero card is a clear focal point, varied card sizes/weights. Stat cards themselves have no hover state; only the Logout link does. Not flat overall. | None beyond the two tracked placeholders. |
| asset-collection.html | None found. All data (cards, pricing, allocation %, logo/initials) is live-computed. | Real "no results" empty state for search/filter with no matches. No loading-flash issues. | Good — cards have a real hover-border transition, category tabs have active/hover states, "More info" link and logo box add variety without competing with the primary CTA. | None. |
| asset-performance.html | None found. Summary cards, Return Table, My Requests all live-wired. | Return Table has a real empty state ("No current holdings."); My Requests has one too ("No requests yet."). Sell modal preview correctly shows "—" until a product is selected. | Good — table row hovers, button hovers, a well-structured Sell modal with mode tabs. Data-dense but organized, not flat. | None. |
| high-yield-savings.html | Pocket **withdrawal bypasses the PM-approval pattern entirely** — no approval gate, no ledger entry, unlike HYS deposits and the main Withdrawal flow (Top Findings #5). | Real empty state ("You don't have any savings pockets yet."); My Pocket Requests has one too. No loading-flash issues. | Strong — multi-step modals with real fade transitions, hover states throughout, status pills add real variety. One of the more polished pages. | The withdrawal approval-gate bypass (above) is a content/architecture gap as much as a placeholder concern. |
| transactions.html | None found. All summary cards, both charts, the ledger, and the drill-down modal are live. | Excellent — dedicated, correctly-sized empty states for Recent Activity and both charts (no layout jump) and the ledger table. No loading-flash. | Good — real charts add visual variety, table row hover, filter panel clearly separated from the ledger. Solid hierarchy. | None. |
| documents.html | Two minor NOT TRACKED issues: (1) notification-chip counts are hardcoded in HTML and only corrected by JS on load — a brief flash of wrong counts is possible; (2) Upload has no file-selected validation (Top Findings #9). | Both document sections have real filtered-empty-state text; no separate "zero documents at all" state, but the filtered one covers it. | Good — hover states on rows/buttons, a genuine `row-flash` highlight animation when jumping to a document via notification. Not flat. | The no-file-selected upload gap (above) is the main one. |
| risk-management.html | Regulatory Heatmap (fake "Compliant" statuses/review dates) is **TRACKED** (Register row 14). Risk Capacity/Diversification cards are static-by-original-design but that decision **predates the multi-client model and was never re-flagged** (Top Findings #6); stale footer copy ("once the portfolio engine is built"). | N/A — fixed reference content, no per-client dynamic lists, so no real empty-state concept applies. | Strong — the custom sliding-pill Risk Meter (real animated transitions, a deliberate accent moment) is a genuine highlight. The Regulatory Heatmap itself is flatter — four uniform static boxes. | The stale footer copy and post-multi-client staleness of the Capacity/Diversification cards (above) are the real gaps. |
| deploy-capital.html | None found — all three flows (Crypto/Bank Deposit, Withdraw) are genuinely wired. | My Funding Requests has a real empty state ("No funding requests yet."). No loading-flash issues. | Good — option-card selection states, fade-in panel transitions, a method toggle on Withdraw. | **NOT TRACKED inconsistency**: the two Deposit forms validate with native `alert()` popups, while Withdraw (same page) uses proper inline red error text for the same class of validation. |
| settings.html | **"Active Sessions & Linked Devices" is entirely fake** (Top Findings #4) — mentioned once narratively in the handover doc but never given its own register row. Everything else (2FA, password change, notification prefs, Request Change queue) is genuinely wired. | No real empty-state concerns — profile/security/notification sections always have content by nature. | Decent — toggle switches have real animated transitions, inline edit/save/cancel works well. At a macro level, a fairly uniform stack of white cards — one of the flatter pages in this family. | The fake Active Sessions section (above) is the main one. |
| support.html | **"My Requests" seeds 3 fabricated tickets for any client with empty real history** (Top Findings #1) — the real empty state is effectively unreachable in practice. "Chat with Us" is a self-aware stub (canned replies, a fake named agent) — transparent in code comments, not visually distinguishable from real chat to an end user. | The empty state exists in code but is practically unreachable due to the seed-data issue above. | Good — quick-contact cards use consistent `flex-col`/`mt-auto` alignment, chat panel slides in, request rows expand/collapse with a chevron rotation. | The fake seed tickets (above) are the significant one. |

---

## Admin Tool

*Cross-cutting note, applies to every row below*: all 14 admin pages carry the stale **"No
login gate — internal preview build"** badge (Top Findings #3) — abbreviated as "stale badge"
in the table to avoid repeating the full explanation 14 times.

| Page | Placeholder/Decorative | Missing States | Visual Flatness | Structural Gaps |
|---|---|---|---|---|
| Overview (admin.html) | Stale badge. All 9 count cards are real, computed reads — no placeholder data found. | No loading state needed (synchronous local reads). Real, considered "✓ All caught up" all-clear banner when every queue is empty. | Decent: 3xl bold numbers as a clear focal point per card, amber hover/shadow transitions, grouped section labels. Reads as a real dashboard. | Self-disclosed in a code comment: Deposits/Allocations/Sells/Withdrawals/HYS counts are ambient (current-client-only), while Documents/Support/Profile Updates are cross-client aggregated — a real inconsistency a PM could be misled by (a "0" doesn't necessarily mean zero across *all* clients). |
| Client List (admin-clients.html) | Stale badge. Everything else is real, computed data. | Real loading state ("Loading…") while the Firestore merge is in flight, and a real empty state ("No clients match this search/filter."). | Clean table with hover rows, expand/collapse chevron rotation, active-state filter pills. | None found. |
| Client Applications (admin-client-applications.html) | Stale badge. Onboarding detail panel shows a distinct, honest empty state for pre-migration applications rather than blank fields — a genuinely good detail. | Real loading state and real empty states for both Pending and History. | Same functional pattern as Client List — hover states present, reasonable hierarchy via the expandable detail panel. | None found. |
| Deposits (admin-deposits.html) | Stale badge. Rest is real. | Real empty states for both lists. No async/loading state on this page (100% synchronous local reads) — not a gap, just a simpler architecture than Client List/Applications. | Same Pending/History template as every other queue page — functional, hover transitions present. Reads as formulaic across the whole queue family (see Structural Gaps) more than flat on its own. | See the cross-page template-uniformity note below. |
| Withdrawals (admin-withdrawals.html) | Stale badge. Rest real. | Real empty states, both lists. | Same template as Deposits. | None found on this page alone. |
| Allocations (admin-allocations.html) | Stale badge. Rest real. | Real empty states, both lists. | Same template as Deposits. | None found on this page alone. |
| Sells (admin-sells.html) | Stale badge. Rest real. | Real empty states, both lists. | Same template as Deposits. | None found on this page alone. |
| HYS Deposits (admin-hys.html) | Stale badge. Rest real. | Real empty states, both lists. | Same template as Deposits. | None found on this page alone. |
| Profile Updates (admin-profile-updates.html) | Stale badge. Rest real, including a disclosed legacy-data accommodation (a stray `dateOfBirth` field from before its removal still renders correctly). | Real empty states, both lists. | Same template family, plus a genuinely distinct Approve modal (Current → Requested comparison) — slightly more visual variety than its 5 siblings. | **Family-wide note**: 6 of the 7 Approval Gate queue pages are near-byte-identical in structure and copy — a deliberate, consistent pattern per this project's conventions, not a bug, but worth knowing for a future differentiation or shared-template pass. This project has no shared HTML partial/include system at all — the identical header/sidebar-mount/toast markup is hand-duplicated per file across all 33 pages, the same class of duplication the recent hamburger-icon fix had to patch across 24 files individually. |
| Documents (admin-documents.html) | Stale badge. "Download" is a real click-through but only shows a toast — no file bytes exist anywhere in the system (documented in-code as intentional, matching `documents.html`'s own precedent — TRACKED). Everything else is real. | Real, considered empty-state copy for both Pending Uploads and History. No loading-state issues (synchronous). | Reasonable hierarchy: card sections, a real form, a data table; hover states present throughout. | None beyond the stale badge. |
| Support (admin-support.html) | Stale badge. Otherwise fully real — PM notes and status genuinely persist and round-trip to the client's own support.html. | Real empty-state copy for both Needs Attention and Resolved. No loading-state issues. | Clean two-section layout, a real update modal, consistent hover/transition treatment. Slightly less visual variety than Documents (no form/logo elements) but not flat. | None. |
| Advisory Fee (admin-advisory-fee.html) | Stale badge. **Real, significant finding**: copy claims "Account-wide" scope but `setAdvisoryFeeRate()` is structurally per-client (Top Findings #2). | N/A — single static value display, no list/empty-state concept. | Very minimal: one small card, one large bold rate display as a genuine focal point, one input+button. Simple but not flat. | The account-wide-vs-per-client copy/behavior mismatch (above) is the main gap. |
| Security Log (admin-security.html) | Stale badge. Log data is fully real; "Performed By" is always the literal string "Portfolio Manager" — an honest reflection of the already-documented single-shared-admin-identity design, not fake data. | Real, considered empty state ("No security actions have been taken yet."). No loading-state issues. | Flattest of the 14 admin pages: a single monotone table, no cards, only row hover for interactivity. Functional but the least visually developed page in the tool. | None beyond the flatness itself — arguably acceptable for a log, but worth naming for an honest read. |
| Products (admin-products.html) | Stale badge. Everything else genuinely real and recently re-verified in this same session (product schema, conditional Logo URL/Extended Description fields). | Real empty-state copy covering both a genuinely-empty catalog and an over-filtered one. No loading-state issues. | Richest of the 14 admin pages: search bar, two independent filter-pill rows, expandable rows, two modals — the most interactive-element variety in the tool; hover/focus states present throughout. | None found beyond the shared badge issue. |

---

## Notes on what this document is not

This is a catalog, not a priority-ranked backlog beyond the "Top findings" ordering above (which
is a rough read, not a formal severity scoring) — sequencing and effort tradeoffs are for the
follow-up conversation this was requested for. Nothing here was fixed, and no other project
document (CLAUDE.md, the Backend Requirements Register) was modified to produce it, per
instruction.
