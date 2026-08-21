# CLAUDE.md — Marketswave Project

This file is read automatically by Claude Code at the start of every session in this
directory. It is the condensed, load-bearing version of `Marketswave_Project_Handover.md`
(which remains the full historical record — read it if you need more detail than what's here).

## What this project is

**Marketswave** is a discretionary wealth / capital management platform: a public marketing
site, multi-step client onboarding, login + password recovery, and a client dashboard
(portfolio, allocation, performance, capital deployment, transactions). Backend and live
APIs are intentionally not built yet — everything is frontend-only, static HTML.

## Tech stack — do not blur these boundaries

- **Public site + onboarding** (`index.html`, `services.html`, `resources.html`, `about.html`,
  `legal.html`, `contact.html`, `signup.html`, `login.html`, `thank-you.html`): static HTML +
  custom CSS in `styles.css`. No Tailwind here.
- **Dashboard family** (`dashboard.html`, `asset-performance.html`, `transactions.html`,
  `deploy-capital.html`, `documents.html`, `risk-management.html`, `high-yield-savings.html`,
  `settings.html`, `support.html` — the full locked sidebar menu is now built): Tailwind CSS
  via CDN, using the `navy` / `cream` color tokens defined in each page's `tailwind.config`.
  One deliberate exception:
  `risk-management.html`'s Risk Meter segmented control uses a scoped gold/mahogany +
  deep-green accent palette (`.rm-*` CSS classes) instead of navy/cream — a one-off standout
  moment on that single control. Do not reuse that palette anywhere else.
- **Charts**: Chart.js 4.4.0 via CDN (jsdelivr) — already used in `dashboard.html` and
  `transactions.html`. Use it for any new charts rather than introducing another library.
- Interactivity is vanilla JS throughout (no framework). Keep it that way for now.
- **Shared sidebar + live clock** (`dashboard-sidebar.js`, `dashboard-common.js`): every
  dashboard page mounts an empty `<div id="sidebar-mount"></div>` in place of the old inline
  `<aside>`, loads both scripts, then calls `initDashboardSidebar('<page-key>')` — page keys:
  `dashboard`, `asset-performance`, `high-yield-savings`, `transactions`, `documents`,
  `risk-management`, `deploy-capital` (never highlighted — the button is styled the same on
  every page, including its own), `settings`, `support`. Add any new dashboard page's nav
  entry to `NAV_ITEMS` in `dashboard-sidebar.js` rather than hand-writing `<aside>` markup.
  The Documents & Reporting badge (`#sidebar-doc-badge`) is always rendered by the shared
  component; only `documents.html`'s own script overwrites its text/visibility with the
  live-computed count — the script-tag order in each page (sidebar scripts, then the page's
  own inline script) is load-bearing for that page specifically. This extraction also fixed a
  real bug: `dashboard.html` and `asset-performance.html` had a dead `href="#"` Transactions
  link that had gone unnoticed since before `transactions.html` was built. **Responsive
  collapse (Aug 20, 2026):** below the `lg` breakpoint (1024px) the sidebar is now an
  off-canvas drawer (`-translate-x-full` by default, `#sidebar-aside`), opened by a fixed
  hamburger button (`#sidebar-toggle-btn`) and closeable via its own × button
  (`#sidebar-close-btn`), the backdrop (`#sidebar-backdrop`), or Escape — all wired inside
  `initDashboardSidebar()`/`toggleSidebar()`, so every page gets this for free with no
  per-page changes. At `lg` and above it's pixel-identical to before: static-positioned,
  always visible, hamburger hidden. This was previously a hardcoded `w-64` with no
  responsiveness at all — the root cause behind the overflow bugs fixed on `dashboard.html`'s
  Portfolio Allocation card and `transactions.html`'s Recent Activity row (§4.27); those
  disclosed "pathological extreme" edge cases (name/chart squeezed to near-nothing at very
  narrow widths) are effectively resolved as a side effect of this fix, since the sidebar no
  longer starves the content area of width. See `Marketswave_Project_Handover.md` §4.28 for
  the full writeup.
- **Portfolio engine data layer** (`engine-core.js`, Phase 1, Aug 20, 2026): the shared
  Product Catalog / Account State / Holdings model every later engine phase builds on.
  Intended to load the same way as `dashboard-sidebar.js` once a later phase wires it in —
  **Phase 1 deliberately does not add it to any page's `<script>` tags yet**, so don't assume
  it's live on any page just because the file exists. Bare global functions (no namespace
  object, matching `dashboard-sidebar.js`'s convention): `getProduct(id)`,
  `getAllProducts()`, `addProduct(product)` (auto-assigns the next sequential `PROD-XXXX`
  id), `getAccountState()`, `getHoldings()`, `getTotalPortfolioValue()` — the only place
  Total Portfolio Value should ever be computed once pages are wired to it —
  `engineDebugDump()` (console-only inspector, not for pages to call). Seeded to
  `localStorage` (`marketswave_product_catalog`, `marketswave_account_state`,
  `marketswave_holdings`) with numbers that reproduce `dashboard.html`'s current hardcoded
  $1,284,500 Total Portfolio Value exactly and `asset-performance.html`'s per-asset
  Allocated $ figures — `allocatedCapital` is derived from summing holdings, never set
  independently, so this holds by construction, not by coincidence. See
  `Marketswave_Project_Handover.md` §4.18 and §3.1 item 25 for the full writeup, including
  the risk-tier judgment calls made per product (none of the source pages carry a risk-tier
  concept today).
- **Portfolio engine NAV-tick returns** (`engine-core.js`, Phase 2, Aug 20, 2026): extends
  the Phase 1 data layer with simulated price movement — **still not wired into any page**.
  `RISK_TIER_RETURN_CONFIG` (`conservative` 6%/4%, `balanced` 11%/10%, `aggressive` 18%/28%
  mean/volatility) drives a deterministic daily GBM tick, seeded per `productId + calendar
  date` (FNV-1a → mulberry32 → Box-Muller) — same product, same date, same price, always,
  with no live ticker or `setInterval`. Each product tracks `lastTickDate`; `settleProduct(id)`
  / `settleAllProducts()` lazily walk unit price forward day-by-day to today whenever the
  engine loads, then `recomputeAllocatedCapital()` re-derives `allocatedCapital` from the new
  prices so Phase 1's "derived, never set independently" invariant keeps holding after prices
  move. Also added: `getAdvisoryFeeAccrued(periodDays)` and `setAdvisoryFeeRate(newRate)`
  (validates positive-number input). Also added as a same-session follow-up:
  `getUnrealizedReturn(productId)` / `getUnrealizedReturnPercent(productId)` /
  `getTotalUnrealizedReturns()` — pure on-demand reads (current holding value minus
  `costBasis`, and the sum of that across all holdings), nothing persisted, deliberately kept
  separate from Account State's realized-only `assetReturns` per the locked rule that a
  return never silently moves through into allocation state. **Flagged, not silently
  changed:** the `aggressive` tier
  bundles Private Equity and Crypto under one 28% volatility figure even though real-world
  crypto volatility usually runs meaningfully higher than PE — called out in a code comment
  as a reasonable shared-tier compromise for the demo, worth revisiting if PE and Crypto ever
  need to diverge. See `Marketswave_Project_Handover.md` §4.19 and §3.1 item 25 for the full
  writeup, including verification results.
- **Portfolio engine transaction mechanics** (`engine-core.js`, Phase 3, Aug 20, 2026):
  extends Phases 1-2 with an allocation request queue and buy/sell execution — **still not
  wired into any page**. `requestAllocation(productId, dollarAmount)` only ever appends a
  `pending` record to a new `marketswave_allocation_requests` store — it never moves money,
  per the locked "client requests → PM approves/rejects → THEN money moves" rule.
  `approveAllocationRequest(requestId)` / `rejectAllocationRequest(requestId, reason)` are the
  only things that resolve a request; approving internally calls `executeBuy()`.
  `executeBuy(productId, dollarAmount)` and `executeSell(productId, unitsToSell)` are the
  actual money-moving primitives, both settling price first via `settleProduct()` so they
  never execute against a stale unit price; both append to a new `marketswave_transactions`
  ledger (`getTransactionLedger()`), sequential `TXN-XXXX` ids. Sells use **average-cost-basis**
  accounting — the sold units are a proportional slice of the *entire* blended holding, not
  FIFO/LIFO lot tracking — so a same-day buy-then-sell round trip at an unchanged price can
  still realize a nonzero gain/loss if the pre-existing position was bought at a different
  cost basis; this is expected, not a bug, and Total Portfolio Value is still exactly
  conserved through the round trip (verified — see the handover doc). **Two judgment calls
  flagged, not silently decided:** (1) `requestAllocation()` rejects any amount exceeding
  *current* `unallocatedCapital`, even though a client might expect more capital to land
  before PM approval — the stricter check was chosen as the safer default; (2) only the buy
  side goes through a request/approval gate — `executeSell()` runs directly, no equivalent
  pending step, since the spec only described an approval gate for allocation. See
  `Marketswave_Project_Handover.md` §4.20 and §3.1 item 25 for the full writeup, including
  verification results and a real bug caught and fixed mid-build (`getHoldings()` /
  `getAllocationRequests()` were returning live object references, not clones, so a caller's
  "before" snapshot could silently mutate after a later engine call — fixed to match
  `getAccountState()`'s existing defensive-copy pattern).
- **Portfolio engine wired to dashboard.html** (Phase 4a, Aug 20, 2026): the first engine
  phase that touches page HTML/JS. `engine-core.js` loads the same way `dashboard-sidebar.js`
  does; the page calls `settleAllProducts()` once on load, then reads Total Portfolio Value,
  the allocation pie chart + legend (grouped from live holdings by `assetClass`, plus
  Unallocated — colors `#8B5A0F`/`#1B3D2A`/`#C8860A`/`#D4A843`/`#E8D5A8`, a scoped exception
  to the gold/mahogany/green restriction, pie-only), Risk Metrics (Cash Reserve, Set Risk
  Profile read from `marketswave_risk_profile`, Allocation Utilization), and Recent Activity
  (from `getTransactionLedger()`, with a real empty state since a fresh seed starts with zero
  transactions) all from the engine. Market Snapshot and Currency Converter deliberately
  untouched — both need real external data, tracked separately. "Returns Generated"/"Best
  Performing" were renamed only ("Asset Returns"/"Best Performing Class"), values
  intentionally left hardcoded — wiring "Asset Returns" to `assetReturns` would show `$0`
  since nothing's been sold yet in a typical session, which wasn't asked for this phase. See
  `Marketswave_Project_Handover.md` §4.21 and §3.1 items 4/8/25 for the full writeup.
- **Portfolio engine wired to asset-performance.html** (Phase 4b, Aug 20, 2026): same loading
  pattern as Phase 4a. Summary cards, the Return Table (one row per holding, "Capital
  Allocated" now correctly shows `holding.costBasis` — a real, visible drop from the old
  hardcoded current-value figures, e.g. Nordic Growth Fund $410,000 → $346,284, since cost
  basis and current value are genuinely different things; "Realized Amount" sums SELL
  transactions per product from `getTransactionLedger()`, corrected same-day from an initial
  hardcoded `—` — looks the same on a fresh seed but stays correct once a sell ever happens),
  and the Asset Collection cards
  (from `getAllProducts()`, Cash excluded since it can't be a `requestAllocation()` target,
  each showing a real "Minimum investment: $X" line for the first time) all read live.
  "Request Allocation" now genuinely calls `requestAllocation()` — thrown validation errors
  show verbatim in a red-styled toast — plus a new "My Allocation Requests" section
  (`getAllocationRequests()`, every status, newest first, matching the "show everything"
  principle from `documents.html`/`support.html`'s own "My Requests"). Renames: "Total
  Allocated Capital", "Unallocated Capital", "Total Asset Returns" (labeled "Unrealized" —
  reads `getTotalUnrealizedReturns()`, deliberately not the realized-only `assetReturns`),
  and every "PM" spelled out to "Portfolio Manager" including toast copy. See
  `Marketswave_Project_Handover.md` §4.22 and §3.1 items 4/5/6 for the full writeup.
- **Sell request queue** (`engine-core.js`, Phase 3B, Aug 20, 2026): mirrors Phase 3's
  allocation request/approve pattern exactly, but for sells — still not wired into any page.
  `requestSell(productId, unitsToSell)` (new `marketswave_sell_requests` store) only ever
  appends a `pending` record, same "request now, execute later" discipline as
  `requestAllocation()`. `approveSellRequest(requestId)` **re-validates against the current
  holding** (not the holding as it stood at request time) before calling `executeSell()`
  internally — two pending requests on the same holding that individually look valid can
  still combine into an oversell if approved back-to-back, so it throws rather than
  executing a partial/incorrect sell if the second approval's units no longer fit.
  `rejectSellRequest(requestId, reason)` and `getSellRequests()` (deep-cloned, applying
  Phase 3's own defensive-copy fix proactively this time) round it out. See
  `Marketswave_Project_Handover.md` §4.23 and §3.1 item 25 for the full writeup, including
  the re-validation edge-case test.
- **Sell action wired to asset-performance.html** (Phase 4c, Aug 20, 2026): the Return
  Table's new "Sell" button opens a preview modal (static HTML, same backdrop+card pattern as
  `high-yield-savings.html`'s New Pocket/Withdraw modals) showing available units, current
  value, proportional cost basis, and projected gain/loss — computed with `executeSell()`'s
  exact formula as a live preview only; nothing executes until a Portfolio Manager approves.
  A "Sell All"/"Partial" mode toggle mirrors the term-mode-tab interaction pattern already
  used on `high-yield-savings.html`. Submit calls `requestSell()`, reusing Phase 4b's
  red-styled error toast for thrown validation messages. Available-to-sell is computed as
  `holding.units − Σ(this product's own PENDING sell requests)`, disabling the button at
  ≤0 — this UI-layer guard was confirmed necessary via direct testing: `requestSell()` itself
  only validates against the current holding, not against other pending requests on it, so
  without this guard a client could submit a second request already doomed to fail at
  Phase 3B's approval-time re-validation. "My Allocation Requests" was merged with sell
  requests into one "My Requests" section (`getAllocationRequests()` + `getSellRequests()`,
  type badge alongside status badge). **Same-day cross-type sort order corrected same-day**
  (Aug 20, 2026): `requestAllocation()`/`requestSell()` now stamp `requestedAtMs: Date.now()`
  on every new request; My Requests sorts by that instead of the calendar-day string.
  `getAllocationRequests()`/`getSellRequests()` backfill a deterministic end-of-day fallback
  (computed on read, never persisted) for any older stored record missing the field, so
  nothing needed a migration. See `Marketswave_Project_Handover.md` §4.24 and §3.1 item 5 for
  the full writeup.
- **Portfolio engine wired to transactions.html** (Phase 4d, Aug 20, 2026 — the user's own
  instruction called it "Phase 4c," already used for the Sell-action work above; relabeled
  4d and flagged back to them to keep the numbering unambiguous): summary cards (Total Buys/
  Sells from the ledger; **Net Invested is `getHoldings()`' summed `costBasis`, not
  `allocatedCapital`** — same cost-basis-vs-current-value distinction as Phase 4b's "Capital
  Allocated"; Est. Monthly Advisory Fee with an inline-editable rate calling
  `setAdvisoryFeeRate()`), this page's own Recent Activity, both charts grouped by real
  calendar month from `getTransactionLedger()` (only months with real data, no invented
  trailing window), the full ledger table with working filters (Type trimmed to Buy/Sell —
  the engine can't produce other types yet; Asset populated dynamically, Cash excluded), and
  the drill-down modal (Market Price mirrors Execution Price and Associated Costs is a
  genuine `$0` — the engine has no slippage/per-trade-fee concept; a Realized Return row
  shows only for SELL). Verified via jsdom against a real DOM (not hand-rolled stubs) —
  installed and removed locally, no `package.json`/`node_modules` left in the project. See
  `Marketswave_Project_Handover.md` §4.25 and §3.1 item 8 for the full writeup.
- **Bug fix: backfill missing BUY transactions** (`engine-core.js`, Aug 20, 2026): Phase 1's
  `buildSeedData()` writes holdings directly to `localStorage` without ever going through
  `executeBuy()`, so a portfolio's starting holdings never had a corresponding BUY
  transaction — on **any** install, not just ones predating Phase 3. This left Net Invested
  (`getHoldings()`-derived) showing real numbers while Total Buys/Recent Activity/both
  charts/the ledger (all `getTransactionLedger()`-derived) correctly showed empty. Fixed with
  `backfillTransactionsForExistingHoldings()`, run once on load: if `transactions` is empty
  but `holdings` isn't, synthesizes one BUY per holding (`date` = the product's own
  `createdAt`, `price` = `costBasis / units`) — self-limiting with no extra flag, since a
  non-empty `transactions` array naturally prevents re-firing. **Separately confirmed, directly
  against the user's real browser `localStorage` (not assumed): no real sell had ever
  happened** — the "$954,136 vs $1,078,980" gap the user noticed is simply cost basis vs.
  current market value, which has differed by that amount since Phase 1's very first seed,
  with zero sells required to explain it. Verified in the real browser per the user's
  instruction (this class of bug — an inconsistency between two `localStorage` keys — can't
  be caught by a fresh mock store). See `Marketswave_Project_Handover.md` §4.26 for the full
  writeup.
- **Empty-state visual consistency fix, transactions.html** (Aug 20, 2026): Recent Activity's
  empty state was reusing its populated-list container's unconstrained slot
  (`text-center py-2` only), while the two chart cards center their empty state within a
  fixed `h-40 flex items-center justify-center` wrapper — a genuine pattern mismatch, not a
  spacing tweak. Fixed by giving Recent Activity's empty-state markup alone (not the
  populated-list state, which stays intentionally top-aligned) the identical `h-40 flex
  items-center justify-center` treatment. Verified in an actual browser, not Node/jsdom (pure
  layout issue), including forcing the real engine into a genuinely empty state
  (`holdings`/`transactions` both `[]`) to confirm the page's own real render logic produces
  all three consistent, not just injected matching markup. See
  `Marketswave_Project_Handover.md` §4.25 for the full writeup.
- **Bug fixes: responsive overflow at narrow/vertical viewports** (`dashboard.html`,
  `transactions.html`, Aug 20, 2026): Portfolio Allocation's chart+legend row used a viewport
  breakpoint (`flex-col sm:flex-row`) that didn't track the card's actual available width
  (reduced by the app's persistent, non-collapsing sidebar) — the chart's `flex-shrink-0` +
  escalating `max-w-*` made it completely rigid, and the legend couldn't shrink below its own
  text either, so at moderate-narrow widths the legend measurably spilled past the card edge.
  Fixed by switching to `flex flex-wrap` (content-driven wrapping, not a media query), the
  legend given `flex-1 basis-[180px]` (a soft wrap threshold, not a hard floor — shrinkable
  once wrapped), and `w-full` restored on the chart wrapper (it had been dropped in an
  earlier edit) so its width resolves to `min(available, max-w breakpoint)` instead of
  ignoring a narrower parent. Verified across ~500px/736px/1787px, confirming the wide-
  viewport "scale up" behavior from Phase 4a still holds. Separately, `transactions.html`'s
  Recent Activity row (populated state — distinct from the empty-state fix above) wrapped a
  long product name onto 3-4 lines at narrow widths, misaligning the type suffix and amount
  against it; fixed by wrapping the name in its own `truncate` span with `min-w-0` on its
  container (required for truncate to ever activate on a flex child) and `flex-shrink-0` on
  the dot/type/amount so they stay fully visible. Both fixes were verified in an actual
  browser at genuinely narrow viewports (pure layout issue, invisible to Node/jsdom), and a
  remaining pathological extreme (~500px, sidebar leaves only ~117px for the whole row) was
  disclosed rather than silently left unmentioned — it's a symptom of the sidebar's own
  separate non-collapse behavior, out of scope for what was asked here. See
  `Marketswave_Project_Handover.md` §4.27 for the full writeup.
- **Permission fix: removed client-facing advisory fee rate edit** (`transactions.html`,
  Aug 20, 2026): the "Est. Monthly Advisory Fee" card's inline pencil-icon edit control
  (calling `setAdvisoryFeeRate()` directly from the client dashboard) was removed entirely —
  clients should never be able to set their own fee rate. The card is now read-only, still
  live from `getAdvisoryFeeAccrued(30)`/`getAccountState().advisoryFeeRate`.
  `setAdvisoryFeeRate()` stays in `engine-core.js`, just uncalled from any client-facing
  page — logged in the Backend Requirements Register (§3.1 item 29) as belonging to the
  upcoming admin/Portfolio Manager tool. See `Marketswave_Project_Handover.md` §4.29 for the
  full writeup.
- **Bug fix: sidebar didn't extend full page height at `lg:static`** (`dashboard-sidebar.js`,
  Aug 20, 2026): confirmed via direct measurement, not guessed — `#sidebar-mount` correctly
  stretches to the outer `h-screen` row's height (default flex `align-items: stretch`), but
  that stretch doesn't cascade a second level down through it to the `<aside>` (a plain block
  child of an unstyled div), which reverted to `height: auto` at `lg:static` and fell ~326px
  short of the viewport on a typical desktop window — reproduces on every dashboard page,
  since the sidebar's own content height is constant across all of them. Fixed by adding
  `h-screen` directly to the aside (redundant-but-harmless in narrow/drawer mode, where
  `inset-y-0` already implies full height; the only thing enforcing it at `lg:static`, where
  `inset-y-0` is ignored). Verified specifically on a page requiring internal `<main>` scroll
  (`settings.html`, `scrollHeight` 1761px vs. visible 919px) — the sidebar stayed a solid
  navy panel through the full scroll, confirmed via `getBoundingClientRect()` before/after
  and a screenshot, not assumed fixed. See `Marketswave_Project_Handover.md` §4.30 for the
  full writeup.
- **Three polish fixes** (Aug 20, 2026): (1) `dashboard.html`'s Risk Metrics badges — added
  `whitespace-nowrap` to all three pills (grow wider, don't wrap text internally) plus
  `flex-wrap gap-2` on each row (wrap the whole label+badge row at the row level if a wider
  pill ever can't fit, matching §4.27/§4.30's row-level-wrap philosophy); verified at both
  wide and narrow (502px) viewports. (2) Logout wired for real, in `dashboard-sidebar.js` so
  every page gets it at once — no session-state flag exists anywhere in the project (checked
  every `marketswave_*` `localStorage` key project-wide before concluding this; none was
  invented just to clear it), so the fix corrects the `<a>`'s `href` from `index.html` to
  `login.html` via a content-based lookup (`textContent.trim() === 'Logout'`, since the
  header isn't part of the shared mount) and leaves a documented no-op click handler ready
  for a real session-clear call later; logged in the Backend Requirements Register (§3.1
  item 1). (3) `support.html`'s three Quick Contact cards got the same `flex flex-col` +
  CTA-wrapped-in-`mt-auto` treatment already used on `asset-performance.html`'s Asset
  Collection cards (§4.22) — verified via direct `getBoundingClientRect()` measurement that
  all three CTAs align to within 1.6px. See `Marketswave_Project_Handover.md`
  §4.31 (badges), §4.32 (Logout), §4.33 (card alignment) for the full writeups.
- **Documents & Reporting data layer migrated into engine-core.js** (Aug 20, 2026):
  `documents.html`'s 8 documents (previously hardcoded HTML rows with `data-*` attributes,
  mutated in place by page-local JS) now live in a `marketswave_documents` store —
  `{ id, filename, category, direction: 'from'|'upload', date, status, isNew,
  deadlineLabel }`. API: `getDocuments()`/`getDocument(id)` (deep-cloned),
  `addDocument(doc)`, `updateDocument(id, patch)` (the real primitive — Sign changes
  `status`/`isNew`/`deadlineLabel` together in one atomic call), `updateDocumentStatus(id,
  newStatus)` (convenience wrapper), `removeDocument(id)`, and
  `getDocumentNotificationCounts()` — the badge computation, now a reusable engine function
  any page can call instead of logic living only in `documents.html`'s own script (not yet
  called from anywhere else). `documents.html`'s UI/layout/component structure is
  byte-for-byte unchanged — only where the data lives moved; rows render from
  `getDocuments()` via a template function instead of hand-written HTML, and every action
  re-renders instead of patching one row's DOM in place. Verified in an actual browser per
  instruction, including a real `window.confirm()` freezing the automation tooling mid-test
  (flagged immediately, user dismissed manually) and direct `localStorage` inspection
  confirming every mutation persisted for real. See `Marketswave_Project_Handover.md` §4.34
  and §3.1 items 9/10 for the full writeup.
- **support.html dispute ids + documents.html Remove modal** (Aug 20, 2026): dispute
  "Reference Number" is no longer client-typed — `support.html` now generates a sequential
  `DISP-0001`-style id at submission (local `nextDisputeId()` helper, same scan-max-and-
  increment algorithm as `engine-core.js`'s `nextSequentialId`, kept local since support
  requests aren't part of the portfolio/document engine domain), shown in the post-submit
  toast and stored on the request record. `documents.html`'s Remove action now opens a
  custom on-page confirm modal (`#remove-confirm-modal`, following the same backdrop+card
  shape as `settings.html`'s `#change-modal`) instead of `window.confirm()` — same
  confirm/cancel behavior, but no longer blocks CDP-based browser automation the way native
  dialogs do. **The Evidence/Submit Dispute divider was strengthened same-day** (Aug 20,
  2026): `border-slate-100`/`mt-6 pt-5` became `border-slate-200`/`mt-8 pt-6`, after the user
  reported the original divider as not landing across two follow-up requests — direct
  re-reads of the live file both times confirmed it was already present and unchanged, with
  no duplicate/stale copy of `support.html` found elsewhere on the machine, so the
  strengthened version was applied as a low-risk improvement regardless of cause; user
  confirmed in-browser afterward. See `Marketswave_Project_Handover.md` §4.35 and §3.1 items
  9/19, and §4.36 for the divider follow-up.
- **Notification bell — shared header component** (`dashboard-notifications.js`, Aug 20,
  2026): the header (unlike the sidebar) was never part of `dashboard-sidebar.js`'s mount —
  it was duplicated inline per page, and only 2 of 9 pages even had a bell, purely
  decorative (static red dot, no count, no click behavior). Now every dashboard page mounts
  an empty `<div id="notif-bell-mount"></div>` in its header and calls
  `initDashboardNotifications()` (loads after `engine-core.js`, newly added to the 5 pages
  that didn't have it yet: `risk-management.html`, `high-yield-savings.html`,
  `settings.html`, `support.html`, `deploy-capital.html`). Aggregates from
  `getDocuments()`, `getAllocationRequests()`, and `getSellRequests()` — real
  `engine-core.js` reads, not parallel logic — plus High Yield Savings pockets and Support
  requests, both read **directly** from their own `localStorage` keys
  (`marketswave_hys_pockets`, `marketswave_support_requests`) rather than migrated into
  `engine-core.js`, a deliberate scope call flagged in the handover doc rather than a
  silent decision. Read/unread state persists per-item to `marketswave_notifications_read`
  (not one global watermark), so a new notification after an old one was read still shows
  up correctly — verified directly by rejecting a sell request via the console after
  everything else had been read, and confirming exactly one fresh unread notification
  appeared. Browser-verified end to end (badge counts, dropdown contents, click-through
  navigation, cross-page shared read state, empty state, zero console errors) via a
  temporary local server, per the task's own instruction. See
  `Marketswave_Project_Handover.md` §4.37 and §3.1 item 30 for the full writeup.
- **Admin tool Phase A — deposit request queue, engine layer only** (`engine-core.js`, Aug
  20, 2026): `requestDeposit(method, amount, currency, details)` /
  `creditDepositRequest(requestId, confirmedAmount)` / `rejectDepositRequest(requestId,
  reason)` / `getDepositRequests()`, mirroring the allocation/sell request/approve pattern
  for money coming INTO the account (`marketswave_deposit_requests`). The one real
  departure from that pattern: `confirmedAmount` (PM-entered, at credit time) is
  authoritative and may differ from the client's original `requestedAmount` — real-world
  wire fees/FX/partial transfers. Adds a `DEPOSIT` transaction type to the ledger with no
  `productId`/`units`/`price`, just `totalValue`/`date`/`method`. **No page wires to this
  yet — engine only, verified via Node** (mirrors Phases 1–3B's own verification
  discipline). A breakage audit of every `getTransactionLedger()` consumer was done at the
  time (crash risk in `transactions.html`'s ledger table/modal, mislabeling, "null" text in
  `dashboard.html`'s Recent Activity) — **all fixed same-day, see the next entry.** See
  `Marketswave_Project_Handover.md` §4.38 and §3.1 item 31 for the Phase A engine writeup,
  including the Node verification results.
- **Fixed the DEPOSIT rendering breakage from Phase A's own audit** (`transactions.html`,
  `dashboard.html`, Aug 20, 2026, same day as Phase A): `txnProductName()`/`txnTypeLabel()`
  now handle DEPOSIT explicitly (`"Cash Deposit (Bank Transfer/Crypto)"`, `"Deposit"`, its
  own blue badge) instead of falling through to a failed product lookup or a binary
  BUY/SELL ternary; ledger table + drill-down modal Quantity/Price cells guard `!= null`
  and render `"—"` instead of crashing on `.toFixed(null)`; a `"Deposit"` Type filter option
  was added; Transaction Volume excludes DEPOSIT (funding, not trading activity) while Net
  Cash Flow includes it as a positive inflow; Total Buys/Total Sells/Net Invested were
  confirmed already correct with no code change needed. `dashboard.html`'s Recent Activity
  gets its own "Deposit credited" phrasing instead of "Capital allocated — null".
  Browser-verified with a real `creditDepositRequest()`-created DEPOSIT transaction (created
  via console, same seeding approach as prior phases) — zero console errors, correct
  rendering across the ledger table, modal, filter, both charts, and both Recent Activity
  instances. `creditDepositRequest()` is now safe to surface from a future admin UI without
  breaking client-facing pages, though no page calls it yet. See
  `Marketswave_Project_Handover.md` §4.39 for the full writeup.
- **Bug fix: settings.html toggle switches broke the page layout on click** (Aug 20, 2026):
  found during a resumed 4-page browser verification pass
  (`high-yield-savings.html`/`settings.html`/`support.html`/`risk-management.html`, all 4
  PASS otherwise). The 2FA and all 4 Notification Preferences toggles used a `sr-only`
  checkbox inside a `<label>` missing `position: relative`, so the checkbox resolved its
  absolute position against a far-off ancestor (over 1000px down the page) instead of its
  own small label — clicking it made Chrome auto-scroll the whole window to reveal it, which
  desynced from `settings.html`'s internal `<main>` scroll region and visibly tore the fixed
  navy sidebar away from the viewport. Fixed by adding `relative` to all 5 labels; confirmed
  the 2FA setup panel and a notification toggle both now work with no layout break, and 2FA
  Enabled state survives a reload. See `Marketswave_Project_Handover.md` §4.40 for the full
  writeup, including the other 3 pages' verification results.
- **Admin/Portfolio Manager tool** (`admin.html`, `admin-deposits.html`,
  `admin-allocations.html`, `admin-sells.html`, `admin-settings.html`, `admin-sidebar.js`,
  Phase B MVP, Aug 20, 2026): a new, separate page family and persona from the client
  dashboard — not linked from any client page, not sharing `dashboard-sidebar.js` (a
  deliberately distinct `admin-sidebar.js`, same mount-point pattern:
  `<div id="admin-sidebar-mount">` + `initAdminSidebar('<page-key>')`, page keys `overview`,
  `deposits`, `allocations`, `sells`, `settings`). No login gate yet (explicitly deferred),
  but every admin page carries a persistent red "INTERNAL TOOL — Portfolio Manager Access
  Only" banner plus a wholesale distinct color scheme (slate-900 sidebar, amber accents,
  `bg-slate-100` body — NOT the locked navy/cream client tokens) so the two can never be
  visually confused. `admin.html` (Overview) shows pending counts across all three request
  queues, each linking into its queue page. `admin-deposits.html` credits
  (`creditDepositRequest(id, confirmedAmount)`, PM-editable, pre-filled with the client's
  requested amount — the real point of Phase A's original design) or rejects deposit
  requests, rendering the client-submitted `details` object generically (humanized
  key:value pairs) since no client-side deposit form exists yet to lock in its shape.
  `admin-allocations.html` / `admin-sells.html` approve (`approveAllocationRequest(id)` /
  `approveSellRequest(id)`, not PM-editable — the requested amount/units execute as-is) or
  reject with a reason, surfacing thrown re-validation errors (e.g. an oversell caught by
  Phase 3B's approval-time check) inline rather than failing silently. Every queue page has
  a read-only History section below Pending, same "show everything" principle as the
  client's own My Requests sections. `admin-settings.html` is now the only page anywhere
  that calls `setAdvisoryFeeRate()` (confirmed via grep — `transactions.html` only
  references it in a comment). Confirm modals throughout use a custom on-page pattern, never
  `window.confirm()`, per the standing preference from `documents.html`'s own Remove-action
  fix (native dialogs block browser-automation testing). All 5 pages verified free of
  console errors and rendering correctly against real pending/history data already in
  `localStorage`; interactive click-through testing was handed to the user per their own
  instruction mid-build that they'd take over browser verification from here. See
  `Marketswave_Project_Handover.md` §4.41 and §3.1 register rows 5/29/31 for the full
  writeup.
- **Multi-Client Data Model, Step 1 — Client Registry** (`engine-core.js`, Aug 21, 2026):
  new global, unscoped store (`marketswave_clients`, like the Product Catalog rather than a
  per-client store) — `getAllClients()`, `getClient(id)`, `addClient(client)`, same
  defensive-copy + `nextSequentialId`-assigned-id shape as every other engine store. Seeded
  with the existing single-tenant demo user as `CLIENT-0001`: `name`/`accountType` are
  hardcoded ("John Doe" / "Individual Account" — not stored anywhere today, matching what's
  hardcoded across every page's markup), `email`/`phone` are read from `settings.html`'s own
  `marketswave_settings_profile` if it already exists in this browser (falling back to that
  page's own defaults otherwise), `createdAt` is a fixed `2026-01-01`. **Every other store in
  this file (account state, holdings, transactions, requests, documents, etc.) still belongs
  to that one implicit client for now** — this step only creates the registry; it does not
  yet re-key anything, that's Step 2. Node-verified (three scenarios: fresh install, an
  existing settings profile with edited email/phone, and idempotent re-load never
  overwriting already-seeded client data) — see `Marketswave_Project_Handover.md` §4.42.
- **Multi-Client Data Model, Step 2 — client-scoped keys + one-time migration**
  (`engine-core.js` + 6 other files, Aug 21, 2026, highest-risk step of the phase): every
  per-client store is now genuinely scoped per client instead of implicitly shared. New
  `setCurrentClientId(id)` / `getCurrentClientId()` (sessionStorage-backed — resets per
  browser session) and `clientScopedKey(baseKey)` (`"<baseKey>:<clientId>"`), all exported on
  `window`. `getCurrentClientId()` defaults to `CLIENT-0001` whenever nothing has been set —
  deliberate, not just convenient: every store loads ONCE into module-level variables when
  `engine-core.js`'s IIFE runs, so switching clients requires a page reload/navigation after
  `setCurrentClientId()`, not a live in-place switch; defaulting to `CLIENT-0001` is what
  keeps every existing client-facing page working with zero behavior change today, since none
  of them call `setCurrentClientId()` yet (that's Step 4). **15 per-client keys now route
  through `clientScopedKey()`**: the 7 `engine-core.js` already owned (account state,
  holdings, transactions, allocation/sell/deposit requests, documents) plus 8 owned by other
  pages (`marketswave_risk_profile` — `risk-management.html` + `dashboard.html`;
  `marketswave_settings_profile`/`_pending`/`_2fa`/`_notifications` — `settings.html`, plus
  `support.html`'s own read of the profile store for its callback-modal prefill;
  `marketswave_notifications_read`/`_hys_pockets`/`_support_requests` —
  `dashboard-notifications.js`, plus `high-yield-savings.html`'s and `support.html`'s own
  reads of their respective stores). Product Catalog and Client Registry stay global/unscoped
  by design, untouched. A one-time migration (`migrateLegacyUnscopedKeysToClient0001()`,
  runs inside `engine-core.js` — the one script guaranteed to load before every other page's
  own inline script, confirmed by checking every script tag order) copies each old unscoped
  key's raw string value to its `CLIENT-0001`-scoped equivalent and deletes the old key;
  never overwrites a scoped key that already has data; runs before any per-client store's own
  load-or-seed block, but after the Client Registry's seed step (which needs the still-raw
  pre-migration settings-profile key for one read). **Node-verified with 99 assertions across
  6 scenarios, 0 failures** — full legacy migration of all 15 keys with byte-identical
  content verification, idempotent re-load, partial-legacy-state, scoped-key-already-exists
  (never clobbered), Step 1's own regression re-check, and a full request-lifecycle round
  trip (allocation/sell approve+reject, deposit credit, documents CRUD) proving the admin
  tool's Phase B action paths still work correctly end-to-end under the new scheme. One real
  bug caught and fixed during test authoring, not shipped: an early test draft omitted a
  legacy Product Catalog seed, which correctly triggered the **pre-existing** "reseed
  catalog+account+holdings together if any one is missing" invariant — not a migration bug,
  but worth knowing this invariant now interacts with migration for the first time. Not a
  git repo (checked before starting, per instruction), so there's no file-level rollback
  net for this phase — flagged back to the user rather than silently proceeding as if one
  existed. See `Marketswave_Project_Handover.md` §4.43 for the full writeup.
- **Multi-Client Data Model, Steps 3-5 — admin selector, client context, isolation proof**
  (`admin-sidebar.js`, `dashboard-sidebar.js`, `engine-core.js`, Aug 21, 2026): **Step 3**
  adds a "Viewing Client" dropdown to every admin page (rendered inside
  `admin-sidebar.js`'s shared mount, from live `getAllClients()`/`getCurrentClientId()`).
  Selecting a different client calls `setCurrentClientId(id)` then reloads the page — no
  queue page needed rewriting, since every store loads fresh from the now-updated
  `sessionStorage` context on that reload (see Step 2's own reload-to-switch design note).
  **Step 5** required `addClient()` (Step 1) to actually produce an isolated new client
  rather than one that inherits `buildSeedData()`'s rich demo portfolio on first load —
  added `seedMinimalClientStores()`, called from `addClient()`, which writes empty
  holdings/transactions/every request queue/documents plus a modest PM-specified starting
  cash balance directly to the new client's scoped keys. `addClient()` now accepts an
  optional `startingUnallocatedCapital` input field, kept out of the persisted Client
  Registry record itself. Node-verified (20 assertions) and then **run for real in the
  browser**: created CLIENT-0002 via console, switched to it through the actual admin
  dropdown, credited a real $500 deposit through the actual Credit modal, confirmed
  CLIENT-0001's balance/holdings/ledger were completely unaffected, and switching back to
  CLIENT-0001 showed its exact original state.

  **Step 4 — real bug found and fixed live, mid-verification, not just a "known
  interaction."** The original placement of `setCurrentClientId('CLIENT-0001')` — inside
  `dashboard-sidebar.js`'s `initDashboardSidebar()`, called from a script tag AFTER
  `engine-core.js` had already loaded — looked reasonable but was actually broken: by the
  time it ran, `engine-core.js`'s own IIFE had already read the OLD `sessionStorage` value
  and populated its module-level `accountState`/`holdings` variables from whatever client
  was previously selected. Resetting the session id afterward doesn't retroactively reload
  already-loaded data. This surfaced as real, confirmed data corruption while running Step
  5's browser proof: switching the admin tool to CLIENT-0002 in one tab, then navigating to
  `dashboard.html` in that SAME tab, caused `dashboard.html`'s own (separate) call to
  `settleAllProducts()` to persist CLIENT-0002's stale in-memory `unallocatedCapital` under
  CLIENT-0001's real scoped key — verified directly against raw `localStorage`, not
  inferred. `allocatedCapital` self-healed on the next correctly-scoped load (it's always
  recomputed from real holdings), but `unallocatedCapital` has no equivalent recompute and
  stayed corrupted until manually repaired. **Fixed** by moving the reset to
  `dashboard-sidebar.js`'s own file-load-time top level (this file always loads BEFORE
  `engine-core.js` on every client page), using the raw `sessionStorage` key directly since
  `setCurrentClientId()` isn't defined yet at that point. Re-verified live in the browser
  (switch to CLIENT-0002 in admin, navigate to `dashboard.html` in the same tab) — now
  correctly shows CLIENT-0001's real data, and CLIENT-0002's own data is confirmed
  untouched. Added a dedicated 6-assertion Node regression test that reproduces the
  corruption under the old (broken) ordering and confirms it's absent under the fixed one,
  so this can't silently regress. See `Marketswave_Project_Handover.md` §4.44 (updated) and
  §4.45 for the full writeup, including how the corrupted browser data was diagnosed and
  repaired.
- **HYS Deposit Approval Queue — engine layer** (`engine-core.js`, Aug 21, 2026, checkpoint
  1 of 2 — UI still to come): `requestHYSDeposit(pocketType, term, amount, method, details)`
  / `creditHYSDeposit(requestId, confirmedAmount)` / `rejectHYSDeposit(requestId, reason)` /
  `getHYSDepositRequests()`, a **parallel** store (`marketswave_hys_deposit_requests`), not
  an extension of the regular deposit queue — chosen because a pocket-funding request
  carries `pocketType`/term/rate/maturity fields a plain cash deposit into
  `unallocatedCapital` has no use for; mirrors the existing one-store-per-domain pattern
  already used for allocation/sell/deposit requests rather than overloading one generic
  table. Engine independently derives and stores rate/term fields from validated inputs
  (mirroring `high-yield-savings.html`'s own `SHORT_TERM_BRACKETS`/`LOCKED_RATES` tables,
  flagged as intentional small duplication that must stay in sync — same reasoning as every
  other money-affecting figure in this file never trusting a client-computed value
  verbatim). `creditHYSDeposit()` is the first engine code to ever touch
  `high-yield-savings.html`'s own pocket store — creates the pocket directly under the
  request's owning client's scoped key, funded with the PM-confirmed amount (which may
  differ from what was requested, same design point as the regular deposit queue),
  recomputes `maturityDate` from the actual credit date (not the original request date) and
  `projectedInterest` from the confirmed amount. Deliberately never touches
  `unallocatedCapital`/`allocatedCapital` — HYS is its own pool by design — but does produce
  a `HYS_DEPOSIT` transaction-ledger entry (distinct type from `DEPOSIT`) so the activity is
  visible in one place. Node-verified: 57 assertions (validation, rate/term computation
  matching the client tables exactly, PM-edited-amount credit flow, AYW's no-minimum/
  no-rate/no-interest rules, reject, defensive copies, and full multi-client isolation) plus
  the full 182-assertion regression suite across every prior phase, all still passing. See
  `Marketswave_Project_Handover.md` §4.46 for the full writeup.
- **HYS Deposit Approval Queue — COMPLETE, checkpoint 2 of 2 (client + admin UI)**
  (Aug 21, 2026): `high-yield-savings.html`'s "Open a New Pocket" flow now submits a request
  (`requestHYSDeposit()`) instead of creating the pocket immediately — same UX shift Deploy
  Capital already went through — with a new "My Pocket Requests" section ("show everything"
  principle) showing every request/status/resolution, flagging when the credited amount
  differs from what was requested. New `admin-hys.html` mirrors `admin-deposits.html`'s
  exact pattern (pending list, PM-editable Credit modal, Reject modal, History), wired into
  `admin-sidebar.js`'s nav and a 4th Overview count card. **Proactively audited and fixed
  `transactions.html`/`dashboard.html`'s DEPOSIT-rendering code for the new `HYS_DEPOSIT`
  type** before shipping any UI that could produce one — `txnProductName()`/`txnTypeLabel()`,
  the Type filter, badge color (distinct purple, not reused from `DEPOSIT`'s blue), and the
  drill-down modal's footer note all handle it explicitly now, avoiding a repeat of the exact
  "Capital allocated — null" bug class Admin Tool Phase A's own audit fixed once already for
  `DEPOSIT`. **Run for real in the browser, the full flow**: submitted a $6,000 6-month Fixed
  Deposit request as CLIENT-0001 through the actual modal, credited it from the actual admin
  UI at a *different* confirmed amount ($5,900) — the resulting pocket showed the confirmed
  amount, a maturity date computed from the credit date (not the request date), and
  `projectedInterest` correctly recomputed against the confirmed amount ($250.75 = 5900 ×
  0.085 × 0.5); confirmed the ledger entry, filter, and drill-down modal all render correctly
  with zero console errors; confirmed CLIENT-0002 has no HYS keys at all — completely
  unaffected. One self-caught fix during the live run: the funding-confirm buttons still read
  "Confirm & Open Pocket" even though they no longer open one immediately — relabeled
  "Confirm & Submit Request" before considering the UI phase done. See
  `Marketswave_Project_Handover.md` §4.47 for the full writeup.
- **Request Change redesign — both checkpoints complete** (`engine-core.js` +
  `settings.html`, Aug 21, 2026). Checkpoint 1, data model: replaces
  `marketswave_settings_pending` (which only ever stored an array of bare field-name strings
  — no requested value, no reason, no timestamp) with a real request queue,
  `marketswave_settings_change_requests`. New per-client profile storage for
  `legalName`/`dateOfBirth`/`address`/`idDocument` (previously 100% hardcoded static HTML
  with no storage location at all) backs `getSettingsProfile(clientId?)`.
  `requestSettingsChange(field, requestedValue, reason)` snapshots `currentValue`
  **automatically from the real profile** — never caller-supplied, so a client can't submit a
  fabricated "current" value — and rejects a second pending request on the same field.
  **Cross-client by design**: `approveSettingsChangeRequest(clientId, requestId)` /
  `rejectSettingsChangeRequest(clientId, requestId, resolutionNote)` take an explicit
  `clientId` rather than resolving against whichever client is currently active, since a
  future admin page will list requests from every client at once — confirmed this actually
  works (approving CLIENT-0001's request while CLIENT-0002 is the active session client
  correctly updates only CLIENT-0001's profile). `resolutionNote` (the PM's reason for
  rejecting) is a field deliberately separate from the client's own `reason` for
  requesting — conflating them would silently discard the client's original context. Approve
  genuinely writes `requestedValue` into the real profile store — possible for the first time
  now that real storage exists. The old `marketswave_settings_pending` key is abandoned, not
  migrated — there's nothing worth salvaging from a field-name-only record. Node-verified: 38
  new assertions (defaults, validation, live-not-cached snapshot behavior, duplicate-pending
  prevention, approve/reject including the cross-client case, resolutionNote-vs-reason
  separation) plus the full 182-assertion prior regression suite, 220 total, 0 failures.
  Checkpoint 2, `settings.html`'s client-side redesign: the four display rows now render from
  `getSettingsProfile()` live instead of hardcoded `data-value` HTML, with a "Pending Review"
  badge replacing "Request Change" per field while a request is pending. `#change-modal`
  rebuilt into four field-specific bodies matching each field's real shape (Legal Name:
  separate First/Last inputs; Date of Birth: native date input; Address: five separate
  inputs; ID/Document: document-type text input + a real file input, storing only
  `fileName`, never file content). Browser-verified live for all four fields, including a
  full approve round-trip (Legal Name: submit → Pending Review → console-simulated PM
  approval → reload → genuinely-changed name displays) and a real uploaded test file for
  ID/Document; zero application console errors. Email/Phone deliberately untouched
  (self-service, no request queue, out of scope). See `Marketswave_Project_Handover.md`
  §4.48-§4.49 for the full writeup.
- **Documents + Support admin queues** (`engine-core.js` + new `admin-documents.html` /
  `admin-support.html`, Aug 21, 2026): two of the original three-queue batch (Settings
  Change stays held). `getAllClientDocuments()` / `updateDocumentForClient(clientId, docId,
  patch)` / `publishDocumentToClient(clientId, { filename, category, signatureRequired?,
  dueDate? })` are cross-client, explicit-`clientId` functions mirroring the Settings Change
  pattern — `publishDocumentToClient()` reproduces `documents.html`'s exact "from" document
  shape (read from the real rendering code first, not guessed) so a published document
  renders with correct badges on the first try. `getAllClientSupportRequests()` /
  `updateSupportRequestForClient(clientId, requestId, patch)` are a deliberate **admin-only
  addition, not a full migration** — `marketswave_support_requests` stays owned by
  `support.html`'s own client-side code (unchanged), matching the scope decision already
  flagged when the notification bell was built. New `pmNote` field on support requests,
  shown in a new "Portfolio Manager Response" block on `support.html`'s own request-detail
  view. `admin-documents.html` has three sections (uploads awaiting review with a single
  "Mark Reviewed" action, a Publish to Client form, and a combined cross-client History);
  `admin-support.html` renames Pending/History to "Needs Attention"/"Resolved" to match the
  3-state ticket model rather than forcing a request/approve binary onto a domain that
  doesn't have one. Both wired into `admin-sidebar.js`'s nav and two new Overview
  pending-count cards (grid widened to 6). Node-verified: 34 new assertions (aggregation,
  `dueDate`→`deadlineLabel` math, per-client sequential ids, a client with no support store
  yet handled as empty rather than crashing, cross-client isolation, unknown-id errors,
  defensive copies) plus the full 220-assertion prior regression suite, 254 total, 0
  failures. Browser-verified end to end: marked a real upload Reviewed; published a
  signature-required document with a due date to CLIENT-0002 and confirmed via direct
  `localStorage` inspection that it landed correctly and CLIENT-0001 stayed unaffected
  (client-facing pages always resolve to `CLIENT-0001` in this build, so isolation can't be
  eyeballed by loading `documents.html` "as" another client — that's the same Step 4 design
  from the multi-client phase, not a gap in this batch); resolved a real support ticket with
  a PM note and confirmed it renders back on the client's own `support.html`. Zero console
  errors. See `Marketswave_Project_Handover.md` §4.50 for the full writeup.
- **Settings Change admin queue** (`engine-core.js` + new `admin-settings-changes.html`, Aug
  21, 2026): closes out the three-queue admin batch. `getAllClientSettingsChangeRequests()`
  is the one function this needed — `approveSettingsChangeRequest(clientId, requestId)` /
  `rejectSettingsChangeRequest(clientId, requestId, resolutionNote)` already took an explicit
  `clientId` from day one (Request Change redesign, Step 1), so nothing there had to change.
  `admin-settings-changes.html`'s Pending section reuses `settings.html`'s own
  `formatDateDisplay()`/`formatFieldDisplay()` logic (copied verbatim — no shared module
  system exists for plain display helpers in this project — logged as minor, low-risk
  structural debt) so each request's Current/Requested values render in the exact same
  field-specific shape the client themselves sees, rather than a generic diff view. Approve
  opens a confirmation modal (Current → Requested) before applying — identity fields felt at
  least as sensitive as the confirm step already used for Allocations/Sells. **Real finding
  from Node verification**: settings-change request ids are assigned per-client, not
  globally, so two different clients' first request can both legitimately be `SETTING-0001`
  — every Approve/Reject button carries both `data-client` and `data-id` (never id alone),
  matching the explicit-`clientId` requirement the engine functions already enforced; this
  was never actually exploitable through the real UI, only a test-authoring trap, caught and
  fixed before it shipped. Wired into `admin-sidebar.js`'s nav and a 7th Overview
  pending-count card. Node-verified (278 total assertions, 0 failures) and browser-verified
  end to end exactly as asked: submitted a Legal Name change as the client, approved it from
  admin (confirmation modal showed the correct values), reloaded `settings.html`, and
  confirmed the client's Legal Name now genuinely reads the new value — not just the request
  clearing from Pending. Zero console errors. See `Marketswave_Project_Handover.md` §4.51 for
  the full writeup.
- **Rename to "Client Profile Updates" + Date of Birth removal + client-selector perf report**
  (Aug 21, 2026): renamed the queue's user-facing label only — `admin-settings-changes.html`'s
  `<title>`/`<h2>`, `admin-sidebar.js`'s nav label, and the Overview card label — leaving the
  file name, the `'settings-changes'` nav key, and every `engine-core.js` function/store name
  unchanged (the task named "the queue/nav label," not a full identifier rename). Removed
  `dateOfBirth` as a requestable field from `REQUESTABLE_SETTINGS_FIELDS`/
  `REQUESTABLE_SETTINGS_DEFAULTS`/`validateSettingsFieldValue()` and from `settings.html`'s
  display row/modal body/`formatDateDisplay()` entirely — **after first querying the live
  browser and finding one pre-existing pending record**, `SETTING-0002` on `CLIENT-0001`
  (`1985-03-14` → `1985-03-20`), reported rather than deleted, per instruction.
  `admin-settings-changes.html` deliberately kept its own `dateOfBirth` branch in
  `FIELD_LABELS`/`formatFieldDisplay()` so that record (and any other legacy one) still
  renders correctly instead of "undefined" or crashing — confirmed
  `approveSettingsChangeRequest()`/`rejectSettingsChangeRequest()` never re-validate a
  request's field, so it stays fully resolvable through the real UI even though the field is
  no longer requestable going forward. Updated both Node test files that had exercised
  `dateOfBirth` as a normal field (rows 35/37) — one swapped its "different field" role to
  `address` plus a new explicit rejection assertion, the other replaced its
  `requestSettingsChange('dateOfBirth', ...)` call with a manually-seeded legacy record
  mirroring the real `SETTING-0002` scenario. 282 total assertions, 0 failures.
  Browser-verified: `settings.html` shows no Date of Birth row at all; `admin-settings-
  changes.html` still correctly displays and can resolve `SETTING-0002` (left unresolved
  deliberately, as the requested example). Separately, investigated and reported (not
  redesigned) the client selector: a plain native `<select>` built by `admin-sidebar.js`'s
  `clientSelectorHTML()` (one `.map().join()` string, one `.innerHTML` write). Measured live
  in the browser with 50 test clients added via `addClient()` in a loop (22.7ms for all 50)
  — all 52 options rendered correctly and instantly (0.1ms to read `.options.length`), no
  measurable slowdown; reported as a forward-looking concern for the separately-speced
  redesign, not an urgent one. All 50 test clients and their 350 scoped keys were removed
  after measuring. See `Marketswave_Project_Handover.md` §4.52 for the full writeup.
- **Admin nav grouping — Approval Gate / User-Admin Relations / Portfolio Administration**
  (Aug 21, 2026): `admin-sidebar.js`'s `NAV_ITEMS` gained an explicit `group` field per item
  (`null` for Overview, which stays outside all three groups as the landing page) and a new
  `GROUPS` array defining the three groups' ids/labels/render order — the single source of
  truth for membership and ordering, so a future tool (Product Catalog management was named
  as the concrete example, landing under `portfolio-administration`) is added with one tagged
  `NAV_ITEMS` entry, never by re-arranging section boundaries by hand; a future login gate is
  infrastructure, not a nav item, and gets no entry at all. Rendering rewritten as `navHTML()`:
  Overview first and ungrouped, then each group as its own section with a visible uppercase
  label header (matching the existing "Viewing Client" label's visual language) followed by
  its items in `NAV_ITEMS` order. `admin.html`'s Overview page mirrors the same three
  labels/order/membership for its pending-count cards; Settings has no pending-count concept
  (configuration, not a queue), so its Portfolio Administration card shows the live current
  advisory fee rate instead, keeping all three headers visible at a glance rather than hiding
  the third group. No `engine-core.js` changes; full 282-assertion regression suite
  unaffected. Browser-verified: all three group headers render with the correct labels and
  membership on every admin page, every nav link still resolves and active-page highlighting
  still works within its group, `admin-deposits.html`/`admin-settings.html`'s own content is
  completely unchanged, and Overview's cards render grouped to match with the Advisory Fee
  Rate card showing the same live value `admin-settings.html` itself displays. See
  `Marketswave_Project_Handover.md` §4.53 for the full writeup.
- **Download client-uploaded documents (admin)** (`admin-documents.html`, Aug 21, 2026):
  a "Download" button now appears on every client-uploaded document row — in "Client Uploads
  Awaiting Review" and as a new History action column (shown only for uploaded rows, not
  "From Marketswave" ones). Matches `documents.html`'s own existing "Download" button exactly
  (a toast, since this project never stores real file bytes, only the filename) rather than
  inventing new behavior. Adding a 7th History column pushed the table past its card width;
  fixed with `overflow-x-auto` on `#history-list`, scoped to this one file only. No engine
  changes. Browser-verified: correct toast/filename from both locations, "Mark Reviewed"
  unaffected, table scrolls within its card, zero console errors. See
  `Marketswave_Project_Handover.md` §4.54 for the full writeup.
- **Client Management page — Viewing Client moved out of the sidebar** (new
  `admin-clients.html`, Aug 21, 2026): the interactive "Viewing Client" `<select>` that lived
  in every admin page's shared sidebar since the Multi-Client Data Model phase moved into its
  own dedicated page, reached via a new "Viewing Client" nav item positioned directly under
  Overview (both `group: null` — outside all three functional groups, same treatment as
  Overview itself). The sidebar keeps only a read-only indicator (current client's name/id,
  linking to the new page) — switching itself lives on `admin-clients.html` now.
  `getAccountState(clientId?)`/`getTotalPortfolioValue(clientId?)` gained an optional
  `clientId`, mirroring `getSettingsProfile(clientId?)`'s exact pattern: no argument behaves
  identically to before (confirmed via a dedicated Node assertion, not assumed); an explicit
  id reads that client's own scoped storage directly and live on each call, without ever
  switching the active session — the same "arbitrary client, on demand" discipline the
  cross-client aggregation functions already established, now extended to Account State. The
  page lists every client with real balances (Unallocated/Allocated/Total Portfolio Value),
  a "Currently Viewing" badge, "View as this Client" (same `setCurrentClientId()` + reload
  mechanism the old dropdown used, unchanged), and a real "Add Client" form — closing the
  previously-tracked gap that `addClient()` was console-only (Backend Requirements Register
  row 32). Node-verified: 13 new assertions (unchanged no-arg behavior, explicit-id reads of
  both the active and a different client, live-not-cached reads, graceful handling of an
  unknown client, isolation surviving a real active-client switch) plus the full
  282-assertion prior regression suite, 295 total, 0 failures. Browser-verified end to end:
  the new indicator and nav tab render correctly everywhere, the Clients list showed real,
  correct balances matching known figures from earlier phases, "View as this Client"
  genuinely switched the active client, and Add Client created a real third client that was
  removed immediately after verifying, restoring the browser to its real baseline. Zero
  console errors. See `Marketswave_Project_Handover.md` §4.55 for the full writeup.
- **Client Management page — redesign: search, filter, expand-in-place** (`admin-clients.html`,
  Aug 21, 2026, same-day follow-up to §4.55): live search (name or id, case-insensitive
  substring); single-select filter pills (All/Individual/Joint/Business — Account Type on
  the Add Client form became a real 3-option `<select>` instead of free text so the pills
  have well-defined values, both existing clients already matched "Individual" so no
  migration needed); a small outlined "+ Add Client" button opening the form as a modal
  instead of a permanent section; a 4-column table (Client name+id, Type badge, Portfolio
  Value via `getTotalPortfolioValue(clientId)` per row, expand indicator); in-place row
  expansion (multiple rows can be open simultaneously) showing email, client-since date, a
  live per-client Approval Gate pending count, and "View as this Client" — moved from an
  always-visible per-row button into the expanded area only. New `engine-core.js` function
  `getClientPendingApprovalCount(clientId)` sums pending items across exactly the 5 Approval
  Gate queues (Deposits/Allocations/Sells/HYS Deposits/Client Profile Updates — matching
  `admin-sidebar.js`'s own `'approval-gate'` nav group membership) by reading each store's
  raw scoped key directly. The nav icon was swapped again, from a two-person "group" icon to
  a single-person "user" icon, for unambiguous visual distinction from Overview's house icon.
  Node-verified in two parts: 12 new assertions for the pending-count aggregation (including
  a client with zero requests in any queue correctly returning `0`, tested directly rather
  than assumed; approve/reject both correctly dropping a request out of the running count)
  and 14 new assertions for the search/filter logic against a 5-client test set (case-
  insensitive name/id matching, each filter pill in isolation, and a deliberately adversarial
  combined-filter case proving AND logic — "jan" + Business excludes "Jane Newclient" despite
  the name match, since she's Individual). Plus the full 295-assertion prior regression
  suite, 321 total, 0 failures. Browser-verified against every point asked for: live search
  narrows on real keystrokes; filter pills correctly show an empty state and correctly find
  a newly-added client; rows expand independently with correct live pending counts (5 for
  CLIENT-0001, hand-verified against Overview's own cards; 0 for CLIENT-0002, a real zero);
  "View as this Client" still switches correctly from inside the expanded row; the nav icon
  is visually distinct from Overview's, confirmed via screenshot. The one client created
  during verification was removed immediately after, restoring the real 2-client baseline.
  Zero console errors. See `Marketswave_Project_Handover.md` §4.56 for the full writeup.
- **Admin sidebar — Client Management label collision + indicator separator**
  (`admin-sidebar.js`, Aug 21, 2026): the nav item and the persistent current-client
  indicator directly above it both said "Viewing Client"/"VIEWING CLIENT," reading as the
  same element twice despite being functionally distinct. Nav item renamed "Client
  Management" (`key`/`href` unchanged, so active-state highlighting and routing needed no
  code changes — confirmed by clicking through). The indicator gained a real `border-b
  border-white/10` + `mb-2` (previously just padding) so it visibly separates from the nav
  list below instead of blending into its first item. Purely cosmetic, no engine changes.
  Browser-verified on `admin-clients.html` (still correctly highlights as active) and
  `admin-deposits.html` (still correctly highlights "Deposits," "Client Management" reads
  as its own distinct item beneath the now-bordered indicator). Zero console errors. See
  `Marketswave_Project_Handover.md` §4.57 for the full writeup.
- **Admin sidebar — removed the persistent "Viewing Client" indicator** (`admin-sidebar.js`,
  Aug 21, 2026, same-day follow-up to §4.57): explicit decision, not a bug fix — Client
  Management (`admin-clients.html`) is now the sole place a PM sees or changes which client
  is active, not something surfaced ambiently on every admin page. `clientIndicatorHTML()`
  removed in full (markup, styling, its `getClient(getCurrentClientId())` lookup) along with
  its call site; `setCurrentClientId()`/`getCurrentClientId()` and the real client-switching
  mechanism were explicitly left untouched, per instruction — display-only removal. Checked
  for orphaned code and found none beyond the function itself (confirmed via a project-wide
  grep for the removed function name, the old `admin-client-selector` id, and the "VIEWING
  CLIENT" text). Browser-verified on 3 admin pages: no gap or leftover empty space where the
  indicator used to sit, nav list begins directly below the header everywhere; "View as this
  Client" re-confirmed working via `getCurrentClientId()` directly, not just visually. Zero
  console errors. See `Marketswave_Project_Handover.md` §4.58 for the full writeup.
- **Admin sidebar — Dashboard group, Client List rename, subtle indicator re-added**
  (`admin-sidebar.js`, Aug 21, 2026, same-day follow-up to §4.58): a new `'dashboard'`
  `GROUPS` entry (label "Dashboard," positioned first) now holds Overview and the nav item
  formerly called "Client Management" — both switched from `group: null` to
  `group: 'dashboard'`, rendering through the exact same `GROUPS.map()` system every other
  group already uses, no new rendering code. The now-fully-unused `ungrouped` branch in
  `navHTML()` was removed. That nav item was renamed again, to "Client List" (its third label
  in one day — "Viewing Client" → "Client Management" → "Client List," each transition
  tracked in a comment) — reflected in the nav, `admin-clients.html`'s `<title>`/`<h2>`, and
  a stale `admin.html` comment; Overview's pending-count cards checked and confirmed clean.
  A subtle single-line "Viewing: &lt;name&gt; · &lt;id&gt;" indicator was re-added above the
  Dashboard group — deliberately much lighter than the block removed in §4.58 (no heading,
  no card background, no border), recomputed on every page load same as before.
  Browser-verified: Dashboard's header styling is pixel-identical to Approval Gate's
  (confirmed via a zoomed comparison screenshot); Overview/Client List render and highlight
  correctly as plain rows; the indicator correctly updated after a real client switch,
  confirmed via a fresh screenshot post-switch. Full 321-assertion suite unaffected (no
  engine changes); zero console errors. See `Marketswave_Project_Handover.md` §4.59 for the
  full writeup.

## Locked — do not restructure without explicit sign-off

- The 9-step signup/onboarding flow and its step order.
- The 5-asset-class portfolio engine rules: Private Equity, Real Assets, Stocks & ETFs,
  Crypto, Unallocated/Cash. Returns are tracked **separately** from allocation percentages —
  never let a return change an allocation %.
- The dashboard sidebar menu order: Portfolio Overview → Asset & Performance → High Yield
  Savings → Transactions → Documents & Reporting → Risk Management → Deploy Capital →
  Settings → Support. Deploy Capital's position in that list does not move.
- Color tokens: Navy `#1B3A4B` / dark `#122A38` / light `#2A4F63`, Cream `#F7F6F3` / dark
  `#EDE8E1`. Text: strong `#1A1C1E`, muted `#6B7178`.

## Deferred — keep frontend-only, do not wire to real backends

Live market data API, currency converter API, real auth, real password reset, portfolio
engine backend + DB, PM approval backend, document storage backend. Where a feature needs
one of these, build the frontend interaction (forms, buttons, confirmations, toasts) and
stub the result — do not silently leave controls non-functional. If something looks
clickable, it should do something, even if that something is just a client-side confirmation
state.

**Build it in-house, not via external APIs.** Explicit user direction (Aug 19, 2026): "we
are building an engine locally for our operation, we would not be needing a lot of
external APIs." Default to building portfolio/allocation/notification/document logic as
your own engine. The genuine exceptions — things external by nature, not by choice — are
real-world market prices, currency exchange rates, and blockchain confirmation for crypto
deposits. Everything else (allocation math, PM approval, interest accrual, document
storage, notifications, risk profile persistence, auth, sessions) is in-house engineering.

**Backend Requirements Register:** every frontend stub above is logged in
`Marketswave_Project_Handover.md` section 3.1 (25 items as of Aug 20, 2026, split into
in-house work vs. genuinely external data). Add a new row the same session you build a
new stub — don't leave it for a later cleanup pass.

## Current status (as of Aug 21, 2026)

This section is now a short, present-tense snapshot only — the detailed, dated history of
*how* things got here lives in the Tech Stack section above (which is updated every session
and is the actual source of truth in practice) and in
`Marketswave_Project_Handover.md` section 4. Keeping two full narrative logs in sync was
proving to be drift-prone (this section had gone stale, still describing the pre-engine
state after four engine phases and several page migrations shipped); rather than maintain
two, this section stays intentionally short and defers to the Tech Stack log for detail.

**Public site, onboarding, and the full dashboard family** (all 9 locked sidebar pages —
Portfolio Overview, Asset & Performance, High Yield Savings, Transactions, Documents &
Reporting, Risk Management, Deploy Capital, Settings, Support) are built and spec-verified
against the original `USER_FLOW.docx` / `MARKETSWAVE_SITE_MAP.docx`. Shared sidebar +
live-clock extraction (`dashboard-sidebar.js` / `dashboard-common.js`) is done and
user-verified in-browser.

**The portfolio engine (`engine-core.js`) is built in-house through Phase 4d**: Product
Catalog / Account State / Holdings data layer (Phase 1), deterministic NAV-tick returns
(Phase 2), allocation + sell request/approve mechanics (Phase 3, Phase 3B), and wired live
into `dashboard.html`, `asset-performance.html` (incl. the Sell action), and
`transactions.html` (Phases 4a–4d). Documents & Reporting's storage was separately migrated
into its own `engine-core.js`-backed store (Sign/Download/Upload/Remove all persisted, not
page-local). Most recently: `support.html`'s dispute ids are now system-assigned
(`DISP-0001` style) instead of client-typed, `documents.html`'s Remove action uses a
custom confirm modal instead of `window.confirm()`, and a real notification bell
(`dashboard-notifications.js`) now aggregates documents/allocation/sell/savings/support
"needs attention" signals into every dashboard page's header. See the Tech Stack section
for the full phase-by-phase and fix-by-fix breakdown, and `Marketswave_Project_Handover.md`
§3.1 for the Backend Requirements Register tracking everything still frontend-only.

**Now verified in-browser** (Aug 20, 2026): `high-yield-savings.html`, `settings.html`,
`support.html`'s non-dispute sections, and `risk-management.html`'s suitability/delta rework
and sliding-pill control all pass their state-machine/persistence checks — see the Tech
Stack entry above and `Marketswave_Project_Handover.md` §4.40 for the full pass/fail
breakdown, including a real bug found and fixed in `settings.html`'s toggle switches.

**Admin/Portfolio Manager tool — Phase B MVP built** (Aug 20, 2026): a new, separate page
family (`admin.html`, `admin-deposits.html`, `admin-allocations.html`, `admin-sells.html`,
`admin-settings.html`) sharing `admin-sidebar.js` (deliberately NOT `dashboard-sidebar.js` —
distinct persona, not linked from any client page). Every admin page carries an unmistakable
red "INTERNAL TOOL" banner and a wholesale distinct color scheme (slate/amber, not the
locked navy/cream client tokens) so the two are never visually confusable. No login gate yet
(explicitly deferred). All three request queues (deposits, allocations, sells) now have a
real PM-facing approve/reject UI — `creditDepositRequest()`, `approveAllocationRequest()`/
`rejectAllocationRequest()`, and `approveSellRequest()`/`rejectSellRequest()` are all called
from real UI for the first time, closing the loop on Phase A's deposit-rendering fix and the
"nothing resolves a pending request except the console" gap. `admin-settings.html` is now
the only page anywhere that calls `setAdvisoryFeeRate()` (confirmed via grep). All 5 pages
verified free of console errors and rendering correctly against real pending/history data;
interactive click-through testing was handed to the user per their own instruction mid-build
that they'd take over browser verification from here. See the handover doc §4.41 and §3.1
register rows 5/29/31 for the full writeup, including per-page design decisions (e.g.
Deposits rendering its `details` object generically since no client-side deposit form exists
yet to lock in a field-name shape).

**Multi-Client Data Model — COMPLETE, all 5 steps built and the isolation proof run live**
(Aug 21, 2026): the engine is now genuinely multi-tenant, not implicitly single-client.
Client Registry (`marketswave_clients`, global) seeded with the original demo user as
`CLIENT-0001`; all 15 per-client `localStorage` keys (7 owned by `engine-core.js`, 8 owned by
6 other files) route through `clientScopedKey()`/`setCurrentClientId()`/
`getCurrentClientId()`; a one-time migration moved every pre-existing key to its
`CLIENT-0001`-scoped equivalent losslessly. The admin tool has a live "Viewing Client"
selector; `addClient()` seeds a genuinely isolated new client (empty holdings/ledger/
requests, modest starting cash) rather than cloning the demo portfolio. **The isolation
proof was run for real**, not just Node-simulated: created a second client (Jane,
`CLIENT-0002`) via console, switched to her through the actual admin dropdown, credited a
real deposit through the actual Credit modal, and confirmed `CLIENT-0001`'s balance/
holdings/ledger were completely unaffected both ways. **That live run caught a real bug**
Node verification alone hadn't caught: the original client-context reset ran too late (after
`engine-core.js` had already loaded stale data), which under one specific same-tab sequence
(switch client in admin, then navigate to a client-facing page) silently corrupted
`CLIENT-0001`'s real `unallocatedCapital` — found via raw `localStorage` inspection, root-
caused, fixed by moving the reset to file-load time, re-verified against the exact failing
scenario, the corrupted data repaired from a known-good recorded baseline, and a permanent
6-assertion regression test added. See the Tech Stack entries above and
`Marketswave_Project_Handover.md` §4.42 (Step 1), §4.43 (Step 2 — the highest-risk step,
client-scoped keys + one-time migration, 99 Node assertions), §4.44 (Steps 3-5, corrected in
place after the bug was found), and §4.45 (the bug itself — full root-cause, fix, live
re-verification, and repair writeup). Backend Requirements Register row 32.

**HYS Deposit Approval Queue — COMPLETE** (Aug 21, 2026): mirrors the Deploy Capital
deposit-request pattern for High Yield Savings pocket funding. `high-yield-savings.html`'s
"Open a New Pocket" flow now submits a request instead of creating a pocket immediately;
`admin-hys.html` gives PMs a real credit-at-a-confirmed-amount/reject UI. Run for real in
the browser end to end (request → credit at a different confirmed amount than requested →
pocket created with the confirmed amount/correct maturity/correct interest), CLIENT-0002
confirmed unaffected. See the Tech Stack entry above and `Marketswave_Project_Handover.md`
§4.46-§4.47. Backend Requirements Register row 33.

**Request Change redesign (`settings.html`) — both checkpoints COMPLETE** (Aug 21, 2026):
Legal Name, Date of Birth, Address, and ID/Document went from 100% hardcoded static HTML to
real per-client storage (`getSettingsProfile()`) with a genuine request/approve queue
(`marketswave_settings_change_requests`, replacing the old field-names-only
`marketswave_settings_pending`). `settings.html`'s Request Change modal was rebuilt into
four field-specific bodies instead of one generic current/new text pair. Browser-verified
live for all four fields, including a full approve round-trip and a real uploaded test
file for ID/Document. See the Tech Stack entry above and `Marketswave_Project_Handover.md`
§4.48-§4.49. Backend Requirements Register row 35.

**Documents + Support admin queues — COMPLETE** (Aug 21, 2026): `admin-documents.html`
(client uploads awaiting review, Publish to Client form, cross-client History) and
`admin-support.html` (Needs Attention / Resolved, status + client-visible PM note) close out
two of the original three-queue batch. Node-verified (254 total assertions, 0 failures) and
browser-verified end to end, including confirming a document published to CLIENT-0002 landed
correctly and isolated via direct `localStorage` inspection, and a resolved support ticket's
PM note rendering back on the client's own `support.html`. See the Tech Stack entry above
and `Marketswave_Project_Handover.md` §4.50. Backend Requirements Register row 36.

**Settings Change admin queue — COMPLETE** (Aug 21, 2026): new `admin-settings-changes.html`
closes out the three-queue batch — Pending/History reusing `settings.html`'s own
field-specific display formatting, an Approve confirmation modal, Reject with an optional
reason. Node-verified (278 total assertions, 0 failures) and browser-verified end to end: a
client-submitted Legal Name change, approved from admin, genuinely shows the new name on the
client's own `settings.html` afterward. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.51. Backend Requirements Register row 37. **All three
originally-speced admin queues (Documents, Support, Settings Changes) are now complete.**

**Rename + Date of Birth removal + client-selector perf report — COMPLETE** (Aug 21, 2026):
the queue is now labeled "Client Profile Updates" everywhere a human reads it (page/nav/
Overview card only — no identifier renames). Date of Birth was removed as a requestable
field after first finding and reporting one pre-existing pending record in test data
(`SETTING-0002`, not deleted) — `admin-settings-changes.html` deliberately kept the ability
to display it correctly, and it remains fully resolvable through the real UI. The client
selector was measured at 50 test clients (added and then removed after measuring): no
measurable slowdown, reported as a forward-looking concern for the separately-speced
redesign. 282 total assertions, 0 failures. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.52. Backend Requirements Register row 38.

**Admin nav grouping — COMPLETE** (Aug 21, 2026): `admin-sidebar.js`'s nav reorganized into
three explicitly data-driven groups (Approval Gate, User/Admin Relations, Portfolio
Administration) via a `group` field per `NAV_ITEMS` entry and a new `GROUPS` array — future
tools (Product Catalog management named as the example) are added with one tagged entry, not
by re-arranging section boundaries. The Overview page's card grid mirrors the same grouping,
with Settings' card showing the live advisory fee rate in place of a pending count.
No engine changes; full 282-assertion suite unaffected; browser-verified that every nav link
still works, active-page highlighting still works within its group, the queue pages'
own content is completely untouched, and Overview's cards render grouped to match. See the
Tech Stack entry above and `Marketswave_Project_Handover.md` §4.53. Backend Requirements
Register row 39.

**Download client-uploaded documents (admin) — COMPLETE** (Aug 21, 2026):
`admin-documents.html` gained a "Download" button on every client-uploaded document row
(pending list + a new History action column), matching `documents.html`'s own existing
"Download" stub exactly (a toast — no real file bytes exist anywhere in this project). A 7th
History column overflowed the card; fixed with `overflow-x-auto` on `#history-list`, scoped
to this one file. No engine changes; browser-verified correct toast/filename from both
locations, "Mark Reviewed" unaffected, zero console errors. See the Tech Stack entry above
and `Marketswave_Project_Handover.md` §4.54. Backend Requirements Register row 40.

**Client Management page — COMPLETE** (Aug 21, 2026): the "Viewing Client" selector moved
out of the shared sidebar into its own page, `admin-clients.html`, reached via a nav tab
directly under Overview. Lists every client's real balances, keeps "View as this Client"
working exactly as before, and adds a real "Add Client" form (closing the previously
console-only `addClient()` gap). `getAccountState()`/`getTotalPortfolioValue()` gained an
optional `clientId` for on-demand cross-client reads. 295 total assertions, 0 failures;
browser-verified end to end. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.55. Backend Requirements Register row 41.

**Client Management page — redesign COMPLETE** (Aug 21, 2026, same-day follow-up): live
search + account-type filter pills (All/Individual/Joint/Business) + a 4-column table +
in-place row expansion (email, client-since, a live per-client Approval Gate pending count
via new `getClientPendingApprovalCount(clientId)`, and "View as this Client" now only inside
the expanded row) + a visually distinct single-person nav icon. 321 total assertions, 0
failures; browser-verified end to end. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.56. Backend Requirements Register row 42.

**Admin sidebar — Client Management label collision + indicator separator — COMPLETE**
(Aug 21, 2026): the nav item (renamed from "Viewing Client" to "Client Management," `key`/
`href` unchanged) no longer collides with the persistent "VIEWING CLIENT" indicator's own
label above it, and that indicator now has a real `border-b` separating it from the nav
list. Purely cosmetic, no engine changes; browser-verified on two pages. See the Tech Stack
entry above and `Marketswave_Project_Handover.md` §4.57. Backend Requirements Register row
43.

**Admin sidebar — removed the persistent "Viewing Client" indicator — COMPLETE**
(Aug 21, 2026, same-day follow-up): an explicit decision, not a bug fix — Client Management
is now the sole place a PM sees/changes the active client. `clientIndicatorHTML()` removed
in full; `setCurrentClientId()`/`getCurrentClientId()` and the real switching mechanism were
untouched. No orphaned code found (confirmed via project-wide grep). Browser-verified on 3
pages: no gap left behind, switching re-confirmed via `getCurrentClientId()` directly. See
the Tech Stack entry above and `Marketswave_Project_Handover.md` §4.58. Backend Requirements
Register row 44.

**Admin sidebar — Dashboard group, Client List rename, subtle indicator re-added —
COMPLETE** (Aug 21, 2026, same-day follow-up): Overview and the nav item (renamed again, to
"Client List") now belong to a new "Dashboard" group, positioned first, rendering through
the existing group system with no new code. A subtle single-line "Viewing: ..." indicator
was re-added above it — much lighter than the block removed in §4.58. Full 321-assertion
suite unaffected; browser-verified Dashboard's header is pixel-identical to the other three
groups, and the indicator updates correctly after a real switch. See the Tech Stack entry
above and `Marketswave_Project_Handover.md` §4.59. Backend Requirements Register row 45.

**Next**: further client-selector UX work at higher client counts, if ever needed — the
earlier perf report found no slowdown at 50 clients, and this redesign already added
search/filter, so this stays non-urgent. Longer-term: a real backend so admin actions and
multi-client data persist beyond this browser's `localStorage`; a real login/auth system
determining which client a given user actually is; a login gate for the admin tool. See the
handover doc §5, §9 for the fuller forward-path discussion (note: §9's table predates both
this phase and Admin Tool Phase B, and is stale in places — the Tech Stack log here and
§4.41-§4.59 are the current source of truth).

## Known structural debt

~~The sidebar markup and the live-clock `<script>` block are duplicated verbatim across every
dashboard page.~~ **Resolved** — extracted into `dashboard-sidebar.js` and
`dashboard-common.js`, wired into all 9 dashboard pages. See the Tech Stack section above for
how to add a new page's nav entry.

`admin-settings-changes.html` duplicates `settings.html`'s (former) `formatDateDisplay()`/
`formatFieldDisplay()` — no shared module system exists in this project for plain
display-formatting helpers (only stateful logic is shared, via `engine-core.js`/the sidebar
files, each its own `<script>` tag), and the two copies must stay in sync by hand if the
display format for Legal Name/Address/ID-Document ever changes. As of Aug 21, 2026 the two
copies also deliberately **diverge** on one point: `admin-settings-changes.html` alone still
carries a `dateOfBirth` branch, kept intentionally so a legacy record (Date of Birth was
removed as a requestable field, but existing test data wasn't deleted — see §4.52) still
renders correctly there. Low-risk (display-only, not a money or security figure) — see the
Backend Requirements Register row 37 for the recommended fix if a shared formatting module
is ever introduced for other reasons.

## Working conventions

- Minimal diffs. Change only what the current task requires — no drive-by refactors.
- Presentation and functionality move together: no decorative-only controls. If you build a
  filter, tab, or button, wire it up or clearly mark it as pending backend.
- After any significant session, update `Marketswave_Project_Handover.md` (the full record)
  and this file (the condensed pointer) so context survives across tools and sessions.
- The user's separate chat-based Claude sessions may still be used for planning and spec
  discussion; Claude Code is for direct implementation. Keep both in sync via the handover
  doc.
- Verify documentation claims against the actual live files before acting on them,
  especially before anything destructive like a rebuild. A doc merge once briefly claimed
  the pie chart / allocation input / transaction analytics were missing from
  `dashboard.html` / `asset-performance.html` / `transactions.html`; a direct file read
  before acting caught the error same-day — see the handover doc §2.1 correction note.
- **Always edit `CLAUDE.md` and `Marketswave_Project_Handover.md` in place — never create a
  copy, versioned variant, or alternate filename for either (no `CLAUDE_updated.md`, no
  timestamped copies, nothing).** Copies of `CLAUDE.md` were accidentally created in a past
  session instead of editing the real file, leaving the original stale across several
  sessions of undocumented work until the copies were noticed and deleted (Aug 20, 2026). If
  an edit to either file fails, report the failure and stop — do not fall back to writing a
  new file as a workaround.

## Verification

Do not launch a browser, dev server, or any visual/interactive verification step after
making changes, unless explicitly asked to. Describe what changed and let the user check it
themselves. If you believe verification is genuinely warranted (e.g. a JS bug you're not
confident is fixed), ask first rather than doing it.
