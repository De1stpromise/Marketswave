# Mobile Usability Audit — Stage 1

**Date:** 2026-09-08
**Scope:** Public site, client dashboard, admin tool — report only, no fixes applied.
**Status:** S1 and S3 were FIXED on 2026-09-08 by "Mobile fixes — Batch 1" (CLAUDE.md /
handover row 170). S2, S4, S5, S6, S7 and A1 were FIXED the same day by "Mobile fixes —
Batch 2" (row 171). **All 7 systemic findings (S1–S7) are now resolved.** What remains open
is the page-specific section below. Each finding carries its own RESOLVED note; this document
stays a record of what the audit found at the time it was written, annotated in place rather
than rewritten.
**Widths tested:** 320px, 375px, 390px, 768px (see Methodology for how these were used per finding).

This audit goes beyond horizontal-overflow checks (the only thing prior verification passes
covered at 390px). It covers tap-target sizing, table/data density, modal fit, form behavior,
chart legibility, sidebar drawer mechanics, the chat widget, and typography/spacing — using
real DOM measurement plus real screenshots as ground truth, not assumptions.

---

## Summary

**Findings by severity:** 4 broken · 14 bad · 6 minor (24 total, several of which are
systemic and recur across many pages — see grouping below).

**Top 5 systemic issues, in priority order:**

1. **Public site header causes real horizontal overflow on every marketing page** (confirmed
   on 6 pages, near-certain on the rest — see Finding S1). Users must scroll sideways to reach
   the site at all on a real phone. This is a known, previously-flagged issue that was marked
   "out of scope" by several earlier page-specific tasks and never actually fixed.
2. **The notification bell dropdown renders with its left edge off-screen**, genuinely
   truncating every line of text — the worst single finding in this audit (Finding S3).
3. **Every off-canvas drawer's toggle/close buttons are undersized** — the close button in
   particular (20×20) is well under half the practical minimum, on both the client dashboard
   and the admin tool (Finding S2).
4. **Modal close ("×") buttons are undersized everywhere they were checked**, ranging from
   barely-under (40×40) to genuinely tiny (13×20) (Finding S5).
5. **Filter bars, row-action buttons, and per-card action buttons consistently land at
   36–40px tall** across transactions, documents, asset-collection, and every admin queue
   page — a single shared sizing convention that's a few pixels short everywhere it's used
   (Finding S4).

**One genuine bright spot:** the just-redesigned `signup.html` flow (Task before this one)
is in noticeably better shape than the rest of the project — only one sub-44px element found
(a logo link), rail/panel collapse works cleanly at 375px, and every real form control meets
the tap-target minimum. It's a working proof that the rest of the site can be brought to the
same standard.

---

## Methodology (read before the findings below)

- `resize_window` does not move the real viewport in this environment (confirmed, matching
  this project's own prior history) — every check here used a real `<iframe>` injected into a
  live page at the target CSS width, measured via `getBoundingClientRect()`/`getComputedStyle()`
  and cross-checked with real screenshots.
- **A real methodology pitfall was hit and corrected mid-audit, disclosed here so it isn't
  mistaken for a product bug**: `getBoundingClientRect()` reads for an element with an ACTIVE
  CSS `transform` (e.g., a sidebar drawer's `translateX` toggle) can return a stale position
  when read synchronously inside an iframe that hasn't received a real paint/compositing pass.
  This first appeared to show the client sidebar drawer never opening at all (stuck at
  `x:-256`) — a real screenshot proved this wrong; the drawer opens correctly. Every
  transform/animation-dependent finding below (drawer open/close, modal open) was verified
  against a real screenshot, not a raw position read alone. Plain SIZE measurements
  (width/height not involving a transform) were cross-checked against screenshots repeatedly
  and found reliable — those are used with confidence throughout.
- 320px, 375px, and 390px produced **identical** measurements on every page checked at more
  than one of these widths — there is no qualitative difference between them for this
  project's layouts. 768px also produced identical tap-target counts to 320px on every
  client/admin page checked, since the sidebar's own breakpoint is 1024px (`lg:`), not
  something between 320–768px. Given this, most pages were swept at 320px + 768px (confirmed
  equivalent to the full 4-width set), with deeper visual/screenshot verification concentrated
  on representative examples of each content type (one ledger table, one set of modals, one
  set of charts, etc.) rather than exhaustively screenshotting all ~38 pages.
- **A real, throwaway test client** was created via the local Supabase stack and seeded with
  real holdings, transactions, documents, HYS pockets, and pending requests across every
  domain (deposits, allocations, HYS deposits, withdrawals) plus a real chat conversation, so
  tables/lists were checked in a populated state, not empty. All seeded data, the test client,
  its Auth user, and a chat conversation it incidentally created were deleted afterward,
  confirmed via re-query.
- **Not independently tested this pass** (disclosed, not silently skipped): `login.html`,
  `reset-password.html`, `blog-press.html`, `help-center.html` (public — near-certain to share
  the header-overflow issue below, since they share the identical header markup, but not
  individually confirmed); `admin-withdrawals.html`, `admin-sells.html`, `admin-support.html`,
  `admin-documents.html`, `admin-profile-updates.html`, `admin-advisory-fee.html`,
  `admin-security.html`, `admin-login.html` (admin — the 7 queue-shaped pages among these are
  very likely consistent with the confirmed card-based pattern on `admin-deposits.html`, but
  not individually swept); `risk-management.html`, `deploy-capital.html`, `support.html`
  (client — swept for overflow/tap-targets only, no deep visual dive).

---

## Systemic Findings (one root cause, many pages)

### S1 — ~~BROKEN~~ RESOLVED (2026-09-08) — Public site header overflows every marketing page

**Pages confirmed:** `index.html`, `services.html`, `about.html`, `resources.html`,
`contact.html`, `legal.html` — all six show the **identical** `document.body.scrollWidth`
(486px) at a 375px viewport, confirming this is the one shared header, not six separate bugs.
Near-certain on `blog-press.html`, `help-center.html`, `login.html` too (same header markup),
not individually re-confirmed.

**What's wrong:** `.header-actions` (the "Get Access" + "Contact" button pair) measures 276px
wide with its right edge at x=448 inside a 375px viewport — it doesn't wrap or collapse at
this width, so the page's real scroll width is 486px against a 375–390px viewport: **~111–136px
of genuine horizontal overflow**, present on every page load, not an edge case. The mobile
nav hamburger toggle is also undersized (38×42).

**Status:** this is a previously-known issue. CLAUDE.md's own history (rows 101, 135, 136)
explicitly flagged the same header overflow as "pre-existing, out of scope" for three separate
earlier page-specific tasks — it was disclosed each time but never actually fixed. It remains
live and affects every real visitor on a real phone today.

**Suggested fix:** give `.header-actions` a real narrow-viewport treatment — collapse "Contact"
into the mobile nav drawer and keep only "Get Access" (or an icon-only variant) in the header
bar below some breakpoint, and confirm the hamburger toggle grows to ≥44×44px at the same
breakpoint.

**RESOLVED, 2026-09-08 (Mobile fixes — Batch 1).** Fixed along the suggested lines: below
960px "Contact" moves into a real mobile nav drawer (new `site-nav.js` — the `.nav-toggle` had
never had ANY JS wired to it anywhere in the project, so it did nothing at all before this),
"Get Access" stays in the bar, and the toggle is now a real 44×44px target.

**Two things this finding got wrong, corrected by the fix's own verification:**
1. *Hiding "Contact" alone was not enough.* At a real 320px viewport the header still needed
   147.5px logo + 118px "Get Access" (its own `min-width` floor) + 44px toggle = 309.5px
   against 272px of available space. Closed by also letting the logo, the button and the
   header's own padding give a little below 480px.
2. *The overflow at 320px was not only the header.* Three `repeat(auto-fit, minmax(Npx, 1fr))`
   grids (`.service-grid` 320px, `.strategy-grid` 340px, `.team-grid` 240px) force a track
   wider than a 320px viewport's content box. Guarded with the standard
   `minmax(min(Npx, 100%), 1fr)` idiom — identical at every wider width.

**Verified:** real `scrollWidth` equals the real viewport on all 8 marketing pages at 320px,
375px and 390px, with no desktop regression at 1440px; drawer open/close, Escape, `aria-expanded`
and the hamburger→X transition all confirmed working. 240/240 assertions.

---

### S2 — ~~BAD~~ RESOLVED (2026-09-08) — Off-canvas drawer toggle/close buttons undersized (client + admin)

**Pages:** all 10 client-dashboard pages (`dashboard-sidebar.js`, shared) + `asset-collection.html`;
all 16 admin pages (`admin-sidebar.js`, shared). Directly confirmed on `dashboard.html`,
`transactions.html`, `asset-collection.html`, `documents.html`, `settings.html`,
`high-yield-savings.html` (client) and `admin.html`, `admin-deposits.html` (admin); inherited
identically by every other page loading the same shared script.

**What's wrong, real measurements:**
- Client: `#sidebar-toggle-btn` ("Toggle menu") 40×40px; `#sidebar-close-btn` ("Close menu")
  **20×20px**.
- Admin: `#admin-sidebar-toggle-btn` 40×40px; `#admin-sidebar-close-btn` **20×20px**.

The close button is byte-for-byte the same undersized pattern on both tools — under half the
44px practical minimum on both axes. This is genuinely hard to tap accurately on a real
phone; a mis-tap lands on whatever's behind/beside it.

**Confirmed working correctly otherwise:** the drawer itself opens and closes correctly (real
screenshot confirmed — see Methodology for the false alarm this took to rule out), and a
backdrop tap should also dismiss it per the existing implementation (not independently
re-verified this pass, but unrelated to the sizing issue above).

**Suggested fix:** grow both buttons' real hit area to 44×44px — the toggle button already
has `w-10 h-10` (40px); bumping to `w-11 h-11` (44px) plus checking the close button's own
padding would close both gaps with a small, low-risk CSS change in two shared files.

**RESOLVED, 2026-09-08 (Mobile fixes — Batch 2).** Fixed in the new shared `tap-targets.css`
rather than by editing the Tailwind class strings in the two JS files, deliberately: this
project has a documented silent failure mode where the Tailwind CDN emits no CSS at all for a
utility it does not recognise (register row 165), and plain CSS cannot fail that way.

Both toggles are now exactly 44×44; both close buttons are 44×44 with a `-12px` right margin
so the enlarged box grows OUTWARD into the drawer header's own padding and the visible glyph
stays optically where it already sat. All four controls are `lg:hidden`, so they only ever
exist below the breakpoint and the change cannot reach desktop at all.

**Verified by real computed measurement** at a genuinely-confirmed 390px viewport, on both
tools: client `#sidebar-toggle-btn` 44×44, `#sidebar-close-btn` 44×44 (was 20×20),
admin `#admin-sidebar-toggle-btn` 44×44, `#admin-sidebar-close-btn` 44×44.

---

### S3 — ~~BROKEN~~ RESOLVED (2026-09-08) — Notification bell dropdown renders off-screen at mobile widths

**Page:** `dashboard-notifications.js`, mounted on all 10 client-facing pages — directly
confirmed on `dashboard.html`.

**What's wrong:** at 375px width, the notification panel (`#notif-bell-panel`, 320px wide)
is positioned with its left edge at **x=-49** — 49px off the left edge of the viewport.
**Visually confirmed via screenshot**: every line of every notification is genuinely truncated
at the start — "Notifications" reads as "...ications", "New document: Q3-Statement.pdf" reads
as "...ew document: Q3-Statement.pdf", and so on. This is not a cramped-but-readable case —
the content is actually cut off and unreadable without already knowing what it says.

**Cause (likely, not independently traced to the exact CSS rule):** the panel is almost
certainly positioned via `right: 0` relative to the bell button near the top-right corner;
its own fixed width (320px) exceeds the space between the bell and the left edge of a narrow
viewport, pushing it into negative `x`.

**Suggested fix:** cap the panel's width to something that fits `calc(100vw - 32px)` (or
similar) below a breakpoint, and/or reposition it via `left`/`right: auto` with a max-width
at narrow viewports rather than a fixed 320px.

**RESOLVED, 2026-09-08 (Mobile fixes — Batch 1).** The suspected cause above was correct in
outline and is now traced exactly: the panel is `absolute right-0` inside the bell's own
`relative` wrapper, so its right edge is pinned to the BELL, not the viewport — and the bell
sits ~104px in from the right edge (header `pr-8` 32px + the Logout link + `gap-4` 16px). A
320px panel anchored there starts at 375 − 104 − 320 = **−49**, exactly the measured value.

**Why the width cap alone would not have worked:** the panel *already* carried
`max-w-[90vw]`, which is 337px at 375px — LARGER than its own 320px width, so it never
applied. The constraint had to come from position, not width. Below 480px the panel is now
`position: fixed` with symmetric 1rem gutters and `top: 4.5rem` (the 64px `h-16` header,
byte-identical on all 10 pages that mount the bell, + the same 8px gap `mt-2` gave it),
so it is fully on-screen at any width regardless of where the bell sits.

Delivered as a real injected `<style>` rather than Tailwind responsive utilities,
deliberately: this project has a documented silent failure mode where the Tailwind CDN emits
NO CSS for a utility it does not recognise (register row 165). ID specificity also beats the
utility classes already on the element, so it needs no `!important`.

**Verified with real screenshots, not just measurement:** at a real 320px viewport every line
now reads from its first character ("Allocation request pending: Cash — $25,000", "New
document: Q3-2026-Portfolio-Statement.pdf") against a real signed-in client with 8 real
notifications — versus the "...ications" / "...ew document:" truncation reported above.
Desktop (1280px) confirmed still `absolute` at its original 320px width. 65/65 assertions.

---

### S4 — ~~BAD~~ RESOLVED (2026-09-08) — Filter bars, row actions, and card action buttons consistently land at 36–40px

**Pages:** `transactions.html`, `documents.html`, `asset-collection.html` (client);
`admin-deposits.html` (representative of all 7 Approval Gate admin queue pages, which share
the identical card/button pattern per CLAUDE.md's own description of that shared design).

**Real measurements:**
- `transactions.html`: `#filter-date-from`/`#filter-date-to` 152×40; `#filter-type`/
  `#filter-asset` selects 36px tall; `#apply-filters` 116×36; `#reset-filters` 71×38.
- `documents.html`: same filter-row pattern (36–40px); document-row `Download`/`Remove`
  buttons only **30px tall**; `#submit-upload` 152×36.
- `asset-collection.html`: category filter pills (All / Private Equity / Real Assets /
  Stocks & ETFs / Crypto) all **36px tall**; per-card `Request Allocation` buttons 150×38;
  the allocation-amount `<input>` 150×38; `More info` links **150×16** (the shortest control
  found on this page).
- `admin-deposits.html`: `Reject`/`Credit` buttons 73–75×38.

**Why this reads as one issue, not many:** the heights cluster tightly at 36, 38, and 40px —
consistent with a single shared Tailwind sizing convention (something like `py-2`/`py-2.5`
combined with the current line-height) applied everywhere a filter control or a small action
button appears, rather than N unrelated one-off mistakes.

**Suggested fix:** audit whatever shared button/input size class produces this ~36–40px
result and bump its vertical padding so the real rendered height clears 44px, then spot-check
the handful of pages above rather than hand-tuning each instance individually.

**RESOLVED, 2026-09-08 (Mobile fixes — Batch 2) — but this finding's central premise was
wrong, and the correction changed the shape of the fix.**

"Why this reads as one issue, not many" above hypothesises **a single shared sizing class**.
Investigated directly before writing any fix, and there is no such class: the 36/38/40px
cluster comes from roughly **40 DISTINCT, repeated Tailwind utility strings**
(`px-3 py-1.5 text-xs`, `px-4 py-2 text-sm`, …) on unrelated elements across unrelated pages.
The instinct that it was "one convention, not N mistakes" was right; the assumption that the
convention was expressed as a shared class was not. There was nothing to bump.

So the fix is keyed on what these controls genuinely share — being buttons and form controls —
in `tap-targets.css`: one `min-height: 44px` rule over `button`, `[role=button]`, `select`,
`textarea` and `input` (checkboxes and radios excluded, since their real target is the
surrounding label), plus `min-width: 44px` for buttons only, which are the ones that can
genuinely be narrow. A `min-height` constrains the USED value after `height` resolves, so it
beats a Tailwind `h-*` utility regardless of specificity and cannot be silently out-cascaded.

Anchors are deliberately NOT covered by that rule — a blanket `a { min-height }` would inflate
every inline link in body copy — so a separate rule covers only anchors the design has already
made flex boxes (`a.flex`, `a.inline-flex`), which is the structural signal that an anchor is
acting as a control. That caught the sidebar nav links and "Deploy Capital" (223×40) and
asset-collection's "Back to Asset & Performance" (217×20), none of which this audit had listed.

Scoped to ≤1023.98px — the app's own `lg` breakpoint — so desktop is structurally untouched.

**Verified**: every named worst case measured at a genuinely-confirmed 390px viewport —
documents Download 83.5×44 and Remove 72.1×44 (were 30px), chip pills 145.5×44 (were 28px),
`#filter-category` 189×44, `#apply-filters` 116×44, asset-collection "More info" 234×44 (was
150×16), category tabs 49×44, allocation input and Request Allocation both 234×44, transactions
`#filter-date-from` 152×44 and `#reset-filters` 71.6×44, admin Reject 75.7×44 and Credit
72.6×44, HYS term-mode pills 170.8×44 (were 28px). A full re-scan of 16 pages reports **0
controls under 44px remaining**, down from 3–37 per page.

---

### S5 — ~~BAD~~ RESOLVED (2026-09-08) — Modal close buttons undersized everywhere checked

**What's wrong, real measurements, worst-to-best:**
- HYS "Open a New Pocket" modal (`high-yield-savings.html`): × button **13×20px** — the
  smallest close control found anywhere in this audit.
- Chat widget panel (`chat-widget.js`, mounted broadly): `#chat-widget-close` 22×24px.
- Get Access modal (public site, shared across all 8 marketing pages that load it): 36×36px.
- Admin-inbox "New Message" compose modal: 40×40px (closest to compliant of the four).

**Pattern:** every modal checked in this audit — spanning three visually distinct component
implementations (a project-wide shared modal pattern, the chat widget, and the admin inbox's
own compose UI) — has an undersized close control. None of the four modals themselves failed
to FIT the viewport or scroll properly; the close button is specifically the recurring
problem, not overall modal layout.

**Suggested fix:** standardize a minimum 44×44px hit area for every "×" dismiss control
project-wide — the visual glyph can stay small, but the clickable/tappable box around it
needs padding to reach the real minimum.

**RESOLVED, 2026-09-08 (Mobile fixes — Batch 2).** A project-wide grep for dismiss controls
found **37, not the 4 sampled here** — every modal on every admin queue page, the two drawers,
the toasts, the chat widget, and asset-collection's own "More info" popup. They share no class
and no common aria-label, but they DO share a naming convention: every one ends in `-close` or
`-close-btn`. The rule matches on that structurally (`[id$="-close"]`, `[id$="-close-btn"]`,
plus `.access-modal-close`), so all 37 are covered without enumerating them and a future modal
following the same convention inherits the minimum with no further edit.

**A real cascade failure was caught here by verification, not by reading the code** — and it is
the FOURTH instance of this project's duplicate-CSS-block-wins-the-cascade bug class. The Get
Access modal's `.access-modal-close` rule was added to styles.css ABOVE the file's existing
`.access-modal-close { width: 36px; height: 36px }`. Identical specificity (0,1,0), later rule
wins: the new rule matched and did nothing, and the first verification run still measured
36×36. Fixed by qualifying it as `button.access-modal-close` (0,1,1), which wins regardless of
source order. This is exactly why every assertion in this batch reads a real computed box
rather than trusting that the CSS was written.

**Verified**: HYS `#np-close` 44×44 (was 13×20, the smallest control in the whole audit),
`#chat-widget-close` 44×44 (was 22×24), Get Access `.access-modal-close` 44×44 (was 36×36),
admin-inbox `#compose-modal-close` 44×44 (was 40×40).

---

### S6 — ~~MINOR-BAD~~ RESOLVED (2026-09-08) — Public-site footer links are 18px tall

**Pages:** all ~12 public marketing pages sharing the same footer.

**What's wrong:** footer navigation links (Trading, Discretionary Management, Retirement
Planning, Supply Chain, High-Yield Savings, Business Consulting, Strategies, How It Works,
Blog & Press, Help Center, etc.) are plain text links with no padding — measured at **18px
tall**, under half the practical minimum. Lower severity than the other findings here since
footer links are a widely-accepted lower-priority tap target across the web, but still a
real, measured gap worth a note.

**Suggested fix:** add vertical padding to each footer `<li>`/`<a>` so the real tappable box
reaches closer to 44px, even if the visible text stays compact.

**RESOLVED, 2026-09-08 (Mobile fixes — Batch 2).** Fixed in styles.css, scoped to the public
site's OWN established 960px breakpoint (not the 1023.98px `lg` the dashboard family uses), so
each side reuses the responsive system it already has.

**Padding alone would NOT have worked, and this is the trap worth recording**: these are plain
inline `<a>` elements, and vertical padding on an inline box does not grow the box the layout
actually measures. The links are given `display: inline-block` alongside the padding, which is
what makes the padded area a real, measurable target rather than a rule that looks correct and
does nothing. The list item's own 12px margin is zeroed at the same width so the footer gains
target area without also gaining dead space per row.

**Verified**: 52.8×50.3 at 390px (was 52.8×18), links stacking contiguously with 0px gaps —
a solid tappable column — and the visible text size unchanged. Desktop re-measured at 1440px
as 52.8×18, `display: inline`, `li` margin 12px: byte-identical to before.

---

### S7 — ~~MINOR~~ RESOLVED (2026-09-08) — Logout controls are short

**Pages:** client dashboard ("Logout" link, all 10 pages) and admin tool ("Log Out" button,
all 16 pages).

**Real measurements:** client "Logout" 47×20px; admin "Log Out" 45×16px. Both are wide enough
but genuinely short — an easy control to mis-tap given how consequential it is (it ends the
session).

**Suggested fix:** add vertical padding to both so their real height clears 44px; low-risk,
isolated to two shared header locations.

**RESOLVED, 2026-09-08 (Mobile fixes — Batch 2).** The admin control is a `<button>` with an
id, so it was straightforward. The client control is a plain inline `<a>` with no id and no
distinguishing class — and, as with S6, a bare `min-height` on an inline box is ignored.

Rather than hand-adding a class to all 10 client pages (10 places to drift out of sync), the
class is applied at runtime by `dashboard-sidebar.js`'s EXISTING `wireLogoutLinks()`, which
already locates exactly these links by their text in order to wire their real sign-out
behaviour — so there is only ever one definition of "which element is the logout link".

**Verified**: client Logout 46.7×44 (was 47×20), admin `#admin-logout-btn` 45.2×44 (was
45×16).

---

## Page-Specific Findings

### `transactions.html` — Ledger table scrolls with no visual cue it's scrollable — BAD

The real ledger `<table>` measures **802px wide** inside a wrapper with `overflow-x: auto`
whose visible width at 375px is only **285px** — meaning roughly 65% of the table's content
(4 of 7 columns' worth) is off-screen and must be discovered by scrolling. **No visual
affordance exists** — checked directly (`box-shadow: none`, no gradient mask on the wrapper)
— so a user has no hint that more columns exist unless they happen to try swiping sideways.
Font size inside the table (14px) is genuinely readable — this is purely a discoverability
problem, not a legibility one.

*Suggested fix:* add a subtle edge-fade or shadow to the scrollable wrapper when it has more
content to reveal (a common, well-established CSS pattern for exactly this case), or pin the
first 1–2 most-important columns and let the rest scroll.

**Charts on this page — checked, no issues:** the "Transaction Volume" bar chart renders
legibly at 375px — distinguishable bars, readable axis labels (Aug 26 / Sep 26), and a clear
color-keyed legend (Buys/Sells). The line chart ("Net Cash Flow") was visible but not
independently screenshotted at full size this pass.

---

### `documents.html` — notification chip pills undersized, filter row shares S4 — BAD

The three status chip pills at the top ("1 New Documents", "0 Signature Required", "0
Deadline This Week") measure 28px tall — smaller than the general filter-row pattern in S4.
Everything else on this page is covered by S4 above.

---

### `settings.html` — "Edit" buttons are genuinely tiny — BAD

The inline "Edit" text-link buttons next to Email/Phone measure **22×16px** — small even
relative to the rest of this audit's findings, and a real, frequently-used action (editing
contact info). "Request Change" buttons (Legal Name/Address/ID Document) measure 120×30px.
2FA/notification toggle switches measure 44×24px — width is fine, height is a conventional
(industry-common) toggle-switch size that technically falls under the strict 44px guidance;
flagged as MINOR given how universal this exact pattern is elsewhere on the web. Password
fields are 42px tall — MINOR, just under the line.

*Suggested fix:* give the "Edit" buttons real padding (they currently look like they're
sized purely by their text content with no touch-friendly box around it).

---

### `asset-collection.html` — the highest concentration of undersized controls on the client side — BAD

In addition to the filter pills and per-card buttons covered in S4, the "More info" toggle
link on each product card measures **150×16px** — the shortest link-style control found on
the client side — and the "Back to Asset & Performance" link measures 217×20px.

---

### `high-yield-savings.html` — the "Open a New Pocket" modal fits well; its own controls don't — mixed

**Checked, genuinely good:** both steps of the modal (pocket-type selection, then the
funding-details form for a Fixed Deposit) fit cleanly within a 375px viewport with no
overflow — readable card copy, a clear rate/maturity/interest summary box, sensible spacing.
This is a well-built modal apart from its control sizing.

**What's wrong:** the × close button is **13×20px** (see S5, the worst instance found); the
term-mode toggle pills ("Short-Term (1–12 Months)" / "Locked (1–5 Years)") measure 28px tall;
the Back/Continue buttons at the bottom of the funding step measure 42px tall (MINOR, just
under the line).

---

### `admin-deposits.html` (representative of the Approval Gate queue pages) — card layout is genuinely good — mostly good

**Checked, genuinely good:** unlike the client-side ledger table, this page (and, per its
shared design, likely every other Approval Gate queue page —
`admin-allocations.html`/`admin-withdrawals.html`/`admin-sells.html`/`admin-hys.html`/etc.)
renders pending requests as **cards, not a table** — client name, method, request id, date,
amount, and detail fields all read cleanly at 375px with no cramping or horizontal scroll
needed. This is the right pattern and should be the reference for fixing the transactions
ledger table (S1 above).

**What's wrong:** the `Reject`/`Credit` action buttons on each card measure 73–75×38px (see
S4). The persistent red "INTERNAL TOOL — PORTFOLIO MANAGER ACCESS ONLY" warning banner wraps
to 2 lines at 375px width, consuming a real (if modest) amount of above-the-fold space before
any actual page content appears — MINOR, not measured precisely but visually confirmed via
screenshot.

---

### `admin-inbox.html` — compose modal fits well, close button undersized — mostly good

**Checked, genuinely good:** the "New Message" compose modal's fields (recipient search,
Subject, Message textarea, the "To One Client"/"Company Announcement" tab pair, and the
General/Investment footer-type radio choice) all stack cleanly and read well at 375px.

**What's wrong:** the × close button measures 40×40px (MINOR — the least-bad instance of S5,
but still under the line).

---

### Get Access modal (public site, shared across all 8 marketing pages) — mostly good

**Checked, genuinely good:** the redesigned two-part layout (dark value panel first, then
Login/Sign Up options) stacks correctly on mobile — this was specifically rebuilt for glass/
contrast correctness in an earlier task and it shows; text is readable, the Login option card
measures a generous 274×141px.

**What's wrong:** the × close button measures 36×36px (part of S5).

---

### `signup.html` — the one page in genuinely good shape — checked, essentially no issues

Only **one** sub-44px element was found on the entire flow: the "MARKETSWAVE" logo link
(162×34px) — low priority, since it's rarely an intentional tap target. Every real form
control (floating-label inputs, selects, the account-type cards, Back/Continue buttons)
meets or exceeds the 44px minimum. The rail-above-panel collapse at 375px (built in the
immediately preceding task) renders cleanly — the horizontal dot-strip step indicator, the
account-type cards, and the Continue button all look and measure correctly. No horizontal
overflow (`scrollWidth: 350` against a 375px viewport). This page is the clearest evidence in
the project that the systemic issues above are fixable with the same care already applied
here.

---

## Findings Added After the Fact (2026-09-08, from Batch 1's own verification)

These were not part of the original Stage 1 sweep. They surfaced while verifying S1/S3 and
are recorded here so the audit stays the single source of truth for mobile findings.

### S1-CORRECTION — `login.html` does NOT share the marketing header (this audit was wrong)

S1 above lists `login.html` as "near-certain" to share the overflowing header markup, on the
basis that it looks similar. **Directly disproved.** `login.html` and `reset-password.html`
use a completely different, much lighter `.login-topbar` (logo + a "← Back to site" link,
styled inline in each file) — they contain no `.site-header`, no `.main-nav`, no
`.header-actions` and no `.nav-toggle` at all. Measured `scrollWidth` equals the viewport
exactly at 320px, 375px and 390px on `login.html`, `reset-password.html`, `signup.html` and
`thank-you.html`. **No S1 fix was needed or applied to any of them.** Treat "same markup, so
probably the same bug" as a hypothesis to check, not a finding.

### A1 — ~~MINOR~~ RESOLVED (2026-09-08) — `login.html` / `reset-password.html` topbar is cramped at 320px

**Pages:** `login.html`, `reset-password.html` (each styles `.login-topbar` in its own inline
`<style>`; neither file contains a single `@media` rule).

**What's wrong:** at a real 320px viewport the "MARKETSWAVE" wordmark ends at x=184.2 and the
"← Back to site" button begins at exactly x=184.2 — a **0px gap** — and the button's label
wraps onto two lines. Measured, not eyeballed: an initial read of the screenshot suggested the
button was overlapping and obscuring the wordmark, and direct measurement disproved that. It
is touching-and-cramped, not overlapping, and nothing is unreadable.

**Not fixed, deliberately:** this is cosmetic, causes no overflow, and is outside both S1 and
S3. Flagged rather than folded silently into Batch 1. A fix would be a small `@media
(max-width: 480px)` block in both files (a slightly smaller topbar logo, a `gap`, and a
smaller back-link font) — the same shape as the narrow-width header treatment Batch 1 added to
`styles.css`.

**RESOLVED, 2026-09-08 (Mobile fixes — Batch 2)**, exactly as scoped above: a small
`@media (max-width: 480px)` block in each file's own inline `<style>` (neither page contained
a single media query before this), reusing the public site's already-established 480px
breakpoint. Slightly smaller topbar logo and back-link font, plus a real `gap`.

**Verified** at a real 320px viewport on both pages: the gap between the wordmark and the
"← Back to site" button is now **40.4px** (was 0px), the button renders on a single line
(39.1px tall, previously wrapping to two), and `scrollWidth` still equals the viewport exactly
at 320/320 — no overflow introduced.

---

## Checked, No Issues Found

- **No page-level horizontal overflow** on any of the 10 client-dashboard pages or 8 of the
  16 admin pages tested, at any of 320/375/390/768px.
- **Chat widget bubble launcher** (`#chat-widget-bubble`): 56×56px — meets the minimum.
- **Chat widget panel**, once open: 334×480px at 375px width, fits cleanly with no overflow;
  re-checked at a shorter 600px-tall viewport and the panel still fit (bottom edge at 494px,
  no overflow). Message input and Send button read as reasonably sized in the screenshot.
- **`transactions.html`'s "Transaction Volume" bar chart**: legible at 375px.
- **`high-yield-savings.html`'s "Open a New Pocket" modal**, both steps: well-organized,
  readable, no overflow (control sizing aside — see above).
- **Get Access modal**: readable, well-stacked, no overflow (close button aside).
- **Admin queue card layout** (`admin-deposits.html`, and by shared design the other
  Approval Gate queue pages): avoids the dense-table problem entirely by using cards.
- **`signup.html`**: see above — the strongest page in the audit.

---

## A note on what this Stage 1 audit does not cover

Per instruction, nothing here was fixed. A few things worth flagging for whoever scopes
Stage 2: the exact CSS rule responsible for S3's off-screen notification panel was not traced
to its source line (only confirmed via measurement + screenshot that it happens); the shared
button/input sizing class behind S4 was not identified by name; and the 8 admin pages and 3
client pages listed as "not independently tested" in Methodology should get at least a quick
sweep before Stage 2 work begins, to confirm they don't hide anything the representative
pages didn't.
