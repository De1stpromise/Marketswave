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
  custom CSS in `styles.css`. No Tailwind here. **One dependency exception (Aug 22, 2026,
  Backend Migration Phase 1):** `signup.html`/`login.html` ONLY now also load the Firebase
  modular JS SDK (via CDN, `<script type="module">`) and `firebase-config.js` — real Firebase
  Auth + Firestore + Cloud Functions, emulator-only for now (see the Tech Stack log below and
  the handover doc's dedicated §12 for the full architecture). No other public-site page
  loads Firebase, and this doesn't touch the custom-CSS-vs-Tailwind styling boundary at all —
  only the data layer, same category of exception `engine-core.js` itself already was for
  these pages.
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
- **Approval Gate unification** (`engine-core.js` + `admin-deposits.html` /
  `admin-allocations.html` / `admin-sells.html` / `admin-hys.html` / `admin-sidebar.js`,
  Aug 21, 2026, the highest-risk task of the session — done on top of a fresh `git init` +
  initial commit made specifically for this task, since it rewrites the real money/unit-
  moving primitives with no other rollback net): converts Deposits/Allocations/Sells/HYS
  Deposits — previously the 4 "ambient" queues, each showing only the currently active
  session client — to the same cross-client aggregation pattern Client Profile Updates
  already used. **Full call-chain trace done and reported before any test was written, per
  instruction**: unlike Client Profile Updates (always stateless — a fresh scoped
  `localStorage` read/write per call, no cache), these 4 domains' resolve primitives
  (`executeBuy`/`executeSell`/`creditDepositRequest`/`creditHYSDeposit`) read and wrote
  `engine-core.js`'s module-level `accountState`/`holdings`/`transactions`/`*Requests`
  variables, loaded once ambiently — a naive "just add a `clientId` parameter" pass would
  have kept silently operating on the wrong client's in-memory data, the exact bug class
  §4.45 already found once. All 10 primitive/wrapper functions
  (`executeBuy(clientId,…)`/`executeSell(clientId,…)`/the 8 approve/reject/credit functions)
  now route through 5 new shared helpers that do a direct scoped `localStorage` read/write
  for an explicit `clientId` every time — no fallback to `getCurrentClientId()` anywhere in
  any of these chains, at any layer. Four new cross-client aggregators
  (`getAllClientDepositRequests()`/`getAllClientAllocationRequests()`/
  `getAllClientSellRequests()`/`getAllClientHYSDepositRequests()`) mirror
  `getAllClientSettingsChangeRequests()`'s exact shape; a narrow `getTransactionForClient(clientId,
  txnId)` was added mid-task for `admin-sells.html`'s Realized Return column. The pre-existing
  ambient no-arg getters and client-facing `request*()` functions are completely unchanged.
  **A real architectural consequence surfaced, not silently absorbed**: since the rewritten
  primitives bypass the module-level cache entirely, that cache can go stale relative to
  `localStorage` if an explicit-`clientId` action targets the ambient active client and is
  immediately followed (same page load, no reload) by an ambient read — never an issue on any
  real shipped page (admin pages always re-render via the new aggregators; client pages
  always get a fresh load), but real enough that 5 of the 12 prior Node regression test files
  needed a `reload()` inserted to keep passing. Node-verified per-domain individually, not
  assumed from one: for each of the 4 domains, resolved an action for client A by explicit id
  while client B was NOT ambient, then diffed client B's raw scoped storage byte-for-byte
  against a pre-action snapshot — 41 new assertions, 0 failures; full suite 346+ assertions,
  0 failures after the reload fixes. All 4 admin pages now call the matching `getAllClient*()`
  aggregator, show a client name/id pill per row (matching Client Profile Updates' visual
  treatment), and pass each row's own `clientId` explicitly to every action. The subtle
  "Viewing: …" sidebar indicator re-added in §4.59 was removed again — confirmed via grep
  that nothing else depended on it — now genuinely redundant since every Approval Gate page
  shows its own per-row client context. **Browser-verified live, the full flow**: seeded
  CLIENT-0002 with one pending item per domain, resolved each through the real modal on each
  of the 4 pages, confirmed correct per-row labels and a real raw-`localStorage` diff proving
  CLIENT-0001 byte-identical before/after each action; separately confirmed
  `admin-clients.html`'s "View as this Client" still switches the admin tool's own ambient
  session correctly, and — as designed, not a bug — does NOT change what a client-facing page
  shows, since `dashboard-sidebar.js` still unconditionally pins every client page to
  `CLIENT-0001` at file-load time (the historical §4.44/§4.45 fix, re-confirmed intact). Zero
  console errors throughout. See `Marketswave_Project_Handover.md` §4.60 for the full
  writeup, including the complete call-chain trace.
- **Password Reset + 2FA Rework** (`engine-core.js` + `admin-clients.html` /
  `admin-security.html` (new) / `admin-sidebar.js` / `admin.html` / `settings.html`,
  Aug 21, 2026): the first admin-triggered domain built cross-client from day one, using the
  exact discipline Approval Gate unification (§4.60) proved out, rather than built
  ambient-first and converted later. New global store `marketswave_security_actions_log`
  (same category as `marketswave_clients` — an audit trail across every client) records every
  reset via `{ id, clientId, clientName, type, reason, performedAt, performedBy }`.
  `resetClientPassword(clientId, reason)`/`resetClient2FA(clientId, reason)` both require a
  non-empty reason and do a direct scoped read/write for that explicit client only — no
  module-level cache anywhere in this domain (mirrors the Settings Change Request queue's own
  always-stateless discipline, not the module-cached pattern §4.60 had to convert away from);
  the full prior regression suite needed zero `reload()` insertions as a direct result.
  **"Force new password" approach, flagged per instruction, not silently decided**: since
  there's no real login/session system, `resetClientPassword()` sets a per-client flag
  `settings.html` checks on every load and uses to gate its own UI client-side, hiding
  everything else behind a banner + forced "Set New Password" form (reusing the exact
  strength/match validation the normal Change Password flow already uses) until
  `clearForcePasswordReset()` is called on successful submission. This is a client-side UI
  gate only, not real security enforcement, and does NOT need to wait on the login gate work
  to exist in this stub form — buildable and built now. Doesn't invent a password store
  either: the existing self-service Change Password form has never persisted an actual
  password anywhere in this project, and the forced form doesn't either — it just clears the
  flag. `resetClient2FA()` writes `'disabled'` directly to the exact same raw
  `marketswave_settings_2fa` key/format `settings.html` already reads, so the reset is picked
  up automatically with zero client-side code changes needed for that read path. **2FA setup
  rebuilt from QR/authenticator to email-code**: enabling 2FA now generates a random 6-digit
  code client-side, displays it directly on screen (no real email backend, same
  simulated-delivery pattern used elsewhere in this project), and Confirm now checks the
  client's input against that exact code rather than accepting any 6 digits — a small but real
  verification behavior that didn't exist before. Admin UI: `admin-clients.html`'s expanded
  row gained "Reset Password"/"Reset 2FA" buttons (a shared reason-required modal, no
  silent/reason-less resets, each passing its row's own `clientId` explicitly); new
  `admin-security.html` (grouped under User/Admin Relations in `admin-sidebar.js`, plus a
  matching Overview card showing total actions logged rather than a pending count, since this
  is a log, not a queue) shows one chronological table, newest first — no pending/approve
  mechanic, per instruction. Node-verified first (49 assertions: validation, single-client
  behavior, and — the actual point — per-action cross-client isolation tested individually
  for both action types in both directions, diffing raw storage byte-for-byte) plus the full
  346+-assertion prior suite, 395+ total, 0 failures. Browser-verified live end to end: both
  actions triggered from `admin-clients.html` with real reasons (and the empty-reason
  validation error confirmed surfacing verbatim first); both appear correctly in
  `admin-security.html`; the forced-reset banner renders CLIENT-0001's actual reason, blocks
  the page, validates the new password, and clearing it survives a reload; the new
  email-code 2FA flow rejects a wrong code and accepts the exact displayed one; a raw
  `localStorage` diff confirmed CLIENT-0002 completely untouched by every action taken
  against CLIENT-0001. Zero real console errors (only a known Chrome-extension messaging
  artifact unrelated to the app). See `Marketswave_Project_Handover.md` §4.61 for the full
  writeup.
- **Admin Login Gate** (`engine-core.js` + new `admin-login.html` / `admin-sidebar.js`,
  Aug 21, 2026): a session-based passphrase gate in front of every admin page.
  **Explicitly a UI-level stub, not real authentication — same honesty standard as the
  forced password-reset gate (§4.61), stated on the gate page itself, not just here.** A
  single shared `ADMIN_PASSPHRASE` constant in `engine-core.js` (not per-PM-account — no PM
  roster/multi-admin-user concept exists) is checked via `checkAdminPassphrase(input)`, a
  plain string comparison anyone with dev tools can read straight out of the source.
  `setAdminAuthenticated()`/`isAdminAuthenticated()`/`clearAdminAuthenticated()` are
  `sessionStorage`-backed, mirroring `getCurrentClientId()`/`setCurrentClientId()`'s own
  pattern — resets per browser session, never written to `localStorage`. New
  `admin-login.html`: slate/amber Tailwind styling matching the admin tool (not the public
  site's `login.html`), a passphrase input, one deliberately generic error on failure (never
  distinguishes *why* it failed, since there's no real backend check to differ from), and a
  visible one-line disclaimer that this isn't real authentication. Does not load
  `admin-sidebar.js` at all, so there's no redirect-loop risk against itself. **Gating**: a
  raw `sessionStorage` key check runs at the very top of `admin-sidebar.js` — before
  `engine-core.js` has even loaded — mirroring `dashboard-sidebar.js`'s own file-load-time
  CLIENT-0001-reset precedent (§4.44/§4.45) exactly, since `isAdminAuthenticated()` isn't
  defined yet at that point; redirects to `admin-login.html` immediately if unauthenticated.
  A second guard using the real `isAdminAuthenticated()` sits as the first line inside
  `initAdminSidebar()` itself, defense in depth. A new "Log Out" control in the sidebar's
  existing footer (distinct from the separate client-facing logout `dashboard-sidebar.js`
  already has — different session key, different mechanism entirely) calls
  `clearAdminAuthenticated()` and redirects back to the gate. Node-verified first (15
  assertions: exact-match passphrase checking including case/whitespace sensitivity and
  malformed input, the full auth-state cycle, state surviving a same-session reload, state
  NOT persisting to `localStorage`, a simulated fresh session correctly starting
  unauthenticated) plus the full prior suite. **One pre-existing, unrelated test failure was
  found and reported, not fixed or hidden**: `verify-step2.js` has one assertion hardcoding
  an exact price figure that depends on a real-wall-clock-date-seeded price tick — confirmed
  via `git show HEAD:engine-core.js` that this fails identically against the original,
  untouched, already-committed baseline, predating every task this session; out of scope to
  fix here, so it was flagged rather than silently absorbed. Browser-verified live end to
  end: direct navigation to any admin page URL while unauthenticated redirects to the gate
  with no flash of real content; wrong passphrase shows the generic error; correct
  passphrase authenticates and persists across real page-to-page navigation; Log Out
  actually locks it back down (confirmed via `sessionStorage.getItem()`, then re-confirmed
  by trying to navigate to another admin page directly); a simulated fresh session
  (`sessionStorage.clear()`) correctly requires re-entering the passphrase. Zero console
  errors throughout. See `Marketswave_Project_Handover.md` §4.62 for the full writeup.
- **Asset Collection extraction + full admin product management** (new `asset-collection.html`
  / `admin-products.html` + `engine-core.js` + `asset-performance.html` / `admin-sidebar.js` /
  `admin.html`, Aug 21, 2026): Product Catalog stays global/unscoped exactly as already
  designed — this was a UI-scale + admin-UI task, no data-model change. **Client side**: the
  product-browsing grid (cards, category tabs, allocation input, Request Allocation, the
  `flex-col`/`mt-auto` height fix) moved out of `asset-performance.html` into new
  `asset-collection.html`, unchanged behavior — same `requestAllocation()` calls. Return
  Table and My Requests deliberately stayed put (Return Table shows current holdings; My
  Requests covers sells too, which only make sense next to the Return Table's own Sell
  button). Added search (by name) and a genuinely load-bearing category filter, plus a "Load
  More" control (`PAGE_SIZE = 9`) chosen over numbered pagination as the simpler option given
  the existing single `.map().join()` card render — reported per instruction.
  `asset-performance.html` now shows a "Browse Asset Collection" link card in the grid's old
  spot. No new locked-sidebar nav entry (checked CLAUDE.md's own locked menu order first) —
  the new page highlights 'asset-performance' as active instead, the same treatment
  `deploy-capital.html` already has. **Admin side**: new `admin-products.html`, grouped under
  Portfolio Administration (the exact placement `admin-sidebar.js`'s own standing comment had
  already named as the anticipated next addition). Reuses Client List's list pattern with TWO
  independent filter dimensions (asset class AND risk tier, not Client List's one), each row
  showing name/class/type/riskTier/minimumInvestment/currentUnitPrice, expand for full detail
  + Edit. Add Product calls `addProduct()` for real (previously console-only, zero callers) —
  4 allocatable asset classes only in the dropdown (`Unallocated / Cash` excluded — reserved
  synthetic bucket, not something to multiply), explicit on-form copy that starting unit
  price is PM-entered, not a live feed. **Edit Product judgment call, decided and reported
  per instruction**: `unitPrice` edits are BLOCKED, enforced by `editProduct()` itself (throws
  if attempted, not just hidden from the form) — price should only ever move via
  `settleProduct()`'s own tick, never a manual overwrite that could silently corrupt every
  client's unrealized-return math. Flagged gap: no way to fix a starting-price typo after
  `addProduct()` runs today (no `removeProduct()` either) — if that's a real need, it should
  be a separate, explicitly-labeled override, not folded into general edit. New Overview card
  shows total product count (plain count, matching Advisory Fee Rate's own non-count
  treatment). **A real pre-existing bug fixed as a direct consequence**: `getAllProducts()`/
  `getProduct()` returned live catalog references, not defensive copies — the same bug class
  Phase 3 already fixed once for `getHoldings()`/`getAllocationRequests()`. Harmless until
  `editProduct()` started mutating catalog entries in place; confirmed via grep every real
  caller only reads the result, so fixed now rather than left as a landmine. Node-verified
  first (46 assertions: validation for both functions, `editProduct()`'s blocked-field
  rejection, the new defensive copies, and — the actual "does this orphan anything" proof the
  task asked for — renaming/reclassifying Nordic Growth Fund, which has a real seeded holding
  AND transaction, leaves both completely intact, since holdings/transactions only ever
  reference a product by its immutable PROD-id) plus the full 395+-assertion prior suite,
  440+ total, 0 failures (the one known pre-existing `verify-step2.js` failure from §4.62 is
  untouched). Browser-verified live end to end: added a real product from admin, confirmed it
  on `asset-collection.html` with working search/filter, submitted a real allocation request
  against it; edited Nordic Growth Fund's minimum investment from admin and confirmed the
  client-side card picked it up immediately, then reverted the edit afterward since it was a
  verification step against real seed data (the new product itself was left in place — no
  removal mechanism exists, and it's a legitimate artifact of the shipped feature); confirmed
  Return Table/My Requests on `asset-performance.html` are unaffected by the split, and that
  a request submitted from the NEW page shows up correctly in the OLD page's My Requests —
  proof both pages share one real engine, not two copies. Zero real console errors. See
  `Marketswave_Project_Handover.md` §4.63 for the full writeup.
- **Client Authentication, Phase 1 — credential storage + signup wiring** (`engine-core.js` +
  `signup.html`, Aug 21, 2026): **reported before any code changes, per instruction** — read
  `signup.html` directly and confirmed its "Submit Application" handler did nothing but
  `window.location.href = "thank-you.html"`, no `addClient()` call, no `engine-core.js` load
  at all, nothing persisted. New dedicated key `marketswave_client_credentials:<clientId>`
  (not folded into the settings profile store — credentials are a distinct security-sensitive
  concern, the same reasoning that already gave Account Security its own key), holding only
  `{ passwordHash }`. `hashClientPassword(rawPassword)` — async (`crypto.subtle.digest()` is
  async-only), SHA-256 — is the ONE place a raw password ever exists in this file, scoped
  strictly to that function's own call, never stored in a variable that outlives it.
  `setClientCredentials(clientId, passwordHash)`/`verifyClientCredentials(clientId,
  passwordHash)` are straightforward, stateless set/compare, explicit `clientId`, no
  module-level cache. **CLIENT-0001 seeded with a known demo password, `Marketswave2026!`**
  (reported in full, since that's the credential future testing needs) — its SHA-256 hash was
  precomputed once in Node and hardcoded (`DEMO_CLIENT0001_PASSWORD_HASH`), rather than
  generated by calling `hashClientPassword()` at seed time, since seeding is synchronous and
  Web Crypto's digest is not; verified byte-for-byte against an independent Node `crypto`
  digest of the same string before being trusted. `signup.html` now loads `engine-core.js`
  for the first time (data-layer boundary crossed, deliberately not the Tailwind/custom-CSS
  styling boundary CLAUDE.md documents — vanilla JS only) and its submit handler is now
  `async`: calls `addClient()` with the real collected name/email/phone and a mapped account
  type, then `hashClientPassword()` + `setClientCredentials()`, then redirects exactly as
  before — fails closed with the page's existing `showError()` if anything throws. **Did NOT
  touch `login.html`'s actual check or `dashboard-sidebar.js`'s CLIENT-0001 pin — Phases 2/3,
  deliberately deferred, per instruction.** Node-verified first (27 assertions: hash
  determinism/distinctness cross-checked against an independent Node SHA-256 digest, full
  set/compare validation, confirmation the raw password never appears in persisted storage,
  the demo seed surviving a reload without re-clobbering a real change, and a full
  signup-equivalent flow proving a REAL client with a REAL stored hash results — Registry
  genuinely grows by one, credentials genuinely persist, verify correctly, and are isolated
  from CLIENT-0001 in both directions) plus the full 440+-assertion prior suite, 467+ total, 0
  failures. Browser-verified live end to end: clicked through the actual 7-step signup form
  as a new applicant, submitted for real, confirmed via direct `localStorage` inspection that
  a genuine `CLIENT-0003` was created with a real 64-char-hex-only credential record (no raw
  password anywhere in it), and confirmed via the real engine functions that the new client
  verifies correctly, rejects a wrong password, and doesn't cross-bleed with CLIENT-0001
  (whose demo credential was reconfirmed still intact). Zero real console errors. See
  `Marketswave_Project_Handover.md` §4.64 for the full writeup.
- **Client Authentication, Phase 2 — real login check + session** (`engine-core.js` +
  `login.html`, Aug 21, 2026): builds on Phase 1's credential store — still does not touch
  `dashboard-sidebar.js`'s CLIENT-0001 pin (Phase 3). `getClientByEmail(email)` resolves an
  entered email to a client (case-insensitive/trimmed, `null` — not a throw — on no match, so
  `login.html` can fold "unknown email" and "wrong password" into one identical failure path).
  `setClientAuthenticated(clientId)`/`getAuthenticatedClientId()`/`clearClientAuthentication()`
  are `sessionStorage`-backed, mirroring `setAdminAuthenticated()`/`isAdminAuthenticated()`/
  `clearAdminAuthenticated()` exactly — storing the authenticated client's own id (not just a
  boolean), since a real client login has to record *which* client it was. `login.html`'s old
  "any submit redirects" stub is now a real check: resolve email → `hashClientPassword()` →
  `verifyClientCredentials()`; on success `setClientAuthenticated(clientId)` then the existing
  loading-screen/redirect flow runs completely unchanged; on any failure, one identical
  generic error banner (`#login-error`, styled with this page's own custom CSS, not
  Tailwind), never distinguishing unknown-email from wrong-password — same
  email-enumeration-avoidance principle as `admin-login.html`. `engine-core.js` now loads on
  `login.html` for the first time. The forgot-password panel is untouched. Node-verified (25
  assertions, including confirming the two failure paths produce
  `JSON.stringify`-identical results, not just "both false") plus the full 17-file regression
  suite, 0 failures. Browser-verified live: logged in as CLIENT-0001 with the demo password
  (succeeded); wrong password and a wholly unknown email both produced the identical generic
  banner; since CLIENT-0003 (Sarah Whitfield)'s real signup password was never recorded
  anywhere by design, a fresh client (CLIENT-0004) was created live through the exact same
  real call chain `signup.html` itself uses, then logged in successfully through the real
  form — proving Phase 2 works for a genuine self-registered client, not only the seeded
  demo. Confirmed, as expected and not a bug: the dashboard still showed CLIENT-0001's data
  even while logged in as CLIENT-0004, since `marketswave_authenticated_client_id` and
  `marketswave_current_client_id` are now two independently-observed session values that only
  Phase 3 reconciles. Zero console errors. See `Marketswave_Project_Handover.md` §4.65 for the
  full writeup.
- **Client Authentication, Phase 3 — retiring the CLIENT-0001 pin** (`dashboard-sidebar.js` +
  `settings.html`, Aug 21, 2026, the highest-risk step of the whole build — done on top of a
  safety-net `git commit`, `df041c6`, capturing everything through Phase 2, since this changes
  what every client-facing page resolves as "the current user" all at once). **Call chain
  traced before writing any test** (mirroring §4.45/§4.60's own discipline): a project-wide
  grep confirmed exactly three places needed changing — `dashboard-sidebar.js`'s file-load-time
  pin (the actual target), `wireLogoutLinks()` (its own comment documented Logout as a no-op
  since Phase 2 didn't exist yet when it was written — left unfixed, it would have silently
  defeated this phase's own "logout then reload doesn't restore access" requirement, so fixing
  it was required by the phase, not scope creep), and one stale comment in `settings.html` —
  and confirmed `admin-clients.html`'s "View as this Client" and `admin-sidebar.js`'s own Admin
  Login Gate were already fully independent, needing no changes. `dashboard-sidebar.js`'s
  file-load-time block now reads the real `marketswave_authenticated_client_id` (raw key,
  `engine-core.js` isn't loaded yet) and pins `marketswave_current_client_id` to that real
  client, or redirects to `login.html` via `location.replace()` if nobody is authenticated —
  mirroring the admin gate's own redirect pattern exactly. A second, defense-in-depth guard
  was added inside `initDashboardSidebar()` using the real `getAuthenticatedClientId()`,
  mirroring `initAdminSidebar()`'s own second check. `wireLogoutLinks()` now genuinely calls
  `clearClientAuthentication()` plus removes the ambient pin — no longer a documented no-op.
  No `engine-core.js` changes were needed. **A real, deliberately out-of-scope cosmetic gap,
  flagged not fixed**: the sidebar footer ("John Doe"/"JD") and `dashboard.html`'s "Welcome
  Back, John" greeting stay hardcoded regardless of who really logged in — confirmed live as
  CLIENT-0004 that the greeting/avatar stay wrong even though every real portfolio figure
  correctly resolves to that client's own genuinely empty data; out of this phase's explicit
  identity-resolution scope, not a data leak. Node-verified first (`verify-client-auth-phase3.js`,
  16 assertions, loading the REAL `engine-core.js` and REAL `dashboard-sidebar.js` source
  against a minimal fake DOM built for this file's own narrow DOM usage: unauthenticated
  redirects with no fallback pin; CLIENT-0001 pins correctly; a genuinely different real
  client, CLIENT-0002, pins to THAT id proving this isn't hardcoded; the defense-in-depth
  guard fires and never renders when unauthenticated; a real simulated Logout click proves
  `getAuthenticatedClientId()` genuinely returns null afterward and a simulated post-logout
  reload correctly redirects; and the admin mechanism has zero dependency on the client-auth
  session key) plus the full 18-file, 0-failure regression suite. Browser-verified live, the
  complete chain: all 9 locked-sidebar pages plus `asset-collection.html` (10 total) each
  independently redirect to `login.html` from a cleared session; CLIENT-0001 logs in and both
  session keys/the dashboard/other pages resolve correctly; real Logout clears both keys and a
  subsequent direct navigation redirects rather than restoring access; CLIENT-0004 (real,
  genuinely empty $0 portfolio confirmed BEFORE logging in) logs in and shows $0/0.0%
  everywhere with zero leakage from CLIENT-0001; the admin tool's "View as this Client" is
  confirmed genuinely independent (switches `marketswave_current_client_id` while
  `marketswave_authenticated_client_id` stays null); and, as a positive side effect, navigating
  directly to `dashboard.html` in the same admin tab correctly redirects rather than leaking
  the admin's ambient client — permanently closing the same-tab admin-to-client leak class
  §4.44/§4.45 had to fix once already, this time by construction. Zero console errors
  throughout. See `Marketswave_Project_Handover.md` §4.66 for the full writeup.
- **Identity display fix — real client name/initials/account type everywhere**
  (`engine-core.js` + `dashboard-sidebar.js` + `dashboard.html` + `settings.html` +
  `support.html`, Aug 22, 2026): closes the cosmetic gap flagged at the end of Phase 3.
  **Grepped the whole project first** and found two genuine hardcodes beyond the two the task
  named: `settings.html`'s Profile/KYC card header (avatar/name/account-type badge — missing
  `id`s entirely, unlike `email-view`/`phone-view` right below it) and `support.html`'s
  `DEMO_USER_NAME` constant (pre-fills the Request-a-Callback modal, drives the live-chat
  greeting's first name) — both fixed alongside the two named ones (`dashboard-sidebar.js`'s
  footer, `dashboard.html`'s greeting). New `getClientInitials(name)`: pure, name-based,
  strips legal-entity suffixes (LLC/INC/CORP/LTD/LLP/LP/PLC/PC) BEFORE splitting into words —
  `"Riverstone Holdings LLC"` → `"RH"` (Riverstone + Holdings, the business's own meaningful
  words), not `"RL"` (the bare suffix contributing nothing). A single remaining word (one-word
  name, or a legal name reduced to one word after stripping its suffix) falls back to its own
  first two characters. All four call sites read `getClient(getAuthenticatedClientId())`,
  guaranteed non-null since `dashboard-sidebar.js`'s Phase 3 guard already redirected
  otherwise. `support.html`'s `DEMO_USER_NAME` renamed to `CURRENT_CLIENT_NAME` for accuracy.
  Client names inserted as plain unescaped text-node concatenation — the existing convention
  `admin-clients.html`'s own client list already uses, not a new risk. Node-verified first (16
  assertions, including the task's exact `"Riverstone Holdings LLC"` → `"RH"` example and
  integration proof against the real Client Registry) plus the full 19-file, 0-failure
  regression suite. Browser-verified live: CLIENT-0001 still correctly shows "John Doe"/"JD"
  everywhere (cross-checked against real data, not just visually); a brand-new client created
  through the real signup flow (all 7 steps, real file uploads), "Marcus Chen" (CLIENT-0005),
  shows "Marcus Chen"/"MC" everywhere after logging in — not John Doe, not blank, not an
  error — with Total Portfolio Value correctly showing a genuinely separate $0. Zero console
  errors. See `Marketswave_Project_Handover.md` §4.67 for the full writeup.
- **Client Withdrawal — a 6th Approval Gate queue** (`engine-core.js` + `deploy-capital.html`
  + `transactions.html` + `dashboard.html` + `admin-sidebar.js` + `admin.html` + new
  `admin-withdrawals.html`, Aug 22, 2026): mirrors the deposit request/approve pattern for
  money leaving the account, built cross-client/stateless from the start — no module-level
  cache anywhere in this domain, including `requestWithdrawal(clientId, ...)` itself, which
  deliberately takes an explicit `clientId` unlike its ambient siblings
  `requestAllocation()`/`requestSell()`/`requestDeposit()`. **A real, pre-existing gap found
  and reported before building the client UI**: read `deploy-capital.html` directly and
  confirmed its two Deposit forms have never called `requestDeposit()` at all — Withdraw was
  still built genuinely wired to the engine, and a new withdrawal-only "My Withdrawal
  Requests" section was added (not merged with anything, since no real deposit-request
  history exists to merge into) — flagged in the Backend Requirements Register (row 31) as a
  separate, unscoped gap, not fixed here. New `marketswave_withdrawal_requests` store;
  `approveWithdrawal(clientId, requestId, approvedAmount)` re-validates `unallocatedCapital`
  at approval time, same oversell-protection discipline as `approveSellRequest()`. **Judgment
  call, decided and reported**: `approvedAmount` stays PM-editable for interaction
  consistency with every other Credit/Approve modal, even though — unlike a deposit — there's
  no genuine external settlement uncertainty on this side; the counter-argument (force it to
  exactly match the requested amount) was stated explicitly, not dismissed.
  `transactions.html`/`dashboard.html`'s rendering consumers (ledger table, drill-down modal,
  both charts, Recent Activity, the Type filter) were all extended for `WITHDRAWAL` from the
  start, not retrofitted after a rendering bug the way `DEPOSIT` originally was. Client side:
  a 3rd "Withdraw Funds" option card on `deploy-capital.html` with an in-form Crypto/Bank
  toggle (mirroring the existing term-mode-tab pattern) and an "Available to withdraw" guard
  rail mirroring the Sell modal's own precedented one. Admin side: new
  `admin-withdrawals.html`, structurally identical to `admin-deposits.html`, wired into the
  Approval Gate nav group and a new Overview card. Node-verified first (49 assertions,
  including the exact re-validation-at-approval-time edge case the task specified and
  per-domain cross-client isolation in both directions) plus the full 20-file, 0-failure
  regression suite, needing zero `reload()` insertions anywhere. Browser-verified live end to
  end: real crypto and bank withdrawal requests submitted (including the real thrown
  over-limit error via toast), both approved from the real admin UI (one at a PM-edited
  amount, correctly flagged "differs" in History), both real transactions confirmed rendering
  correctly everywhere, and a final live cross-client isolation spot-check confirmed zero
  leakage. Zero console errors. See `Marketswave_Project_Handover.md` §4.68 for the full
  writeup.
- **Deposit Wiring fix — `deploy-capital.html`'s two Deposit forms genuinely call
  `requestDeposit()`** (`deploy-capital.html` + `admin-deposits.html`, Aug 22, 2026): closes
  the real gap found and reported at the end of Client Withdrawal (row 31) — the Crypto and
  Bank Deposit forms had never called `requestDeposit()` at all, confirmed still accurate by
  reading the current handlers before touching anything. **A real signature mismatch caught
  before writing code**: the task described `requestDeposit(clientId, ...)`, but the actual
  function is `requestDeposit(method, amount, currency, details)` — AMBIENT, no `clientId`
  parameter, exactly like `requestAllocation()`/`requestSell()` (unlike `requestWithdrawal()`,
  deliberately built explicit-clientId one task earlier). Changing the signature would be an
  unrequested breaking change to an already-shipped function — resolved by calling it exactly
  as it exists; identity resolution is already correct post-Client-Authentication via
  `getCurrentClientId()`, which `dashboard-sidebar.js`'s Phase 3 guard already pins to the
  real authenticated client. `getAuthenticatedClientId()` WAS applied where it genuinely fits:
  corrected the pre-existing Withdraw handler's `requestWithdrawal(getCurrentClientId(), ...)`
  to `requestWithdrawal(getAuthenticatedClientId(), ...)`, since that function does take an
  explicit clientId. Wired using the just-built Withdraw handler as the direct reference —
  same file, same submit-handler shape, same try/catch-into-toast error handling. "My
  Withdrawal Requests" renamed to "My Funding Requests" (chosen over "My Deposit & Withdrawal
  Requests" for brevity) and merged with real Deposit history in one shared render. **Audit
  requested, one real finding reported**: `admin-deposits.html`'s `humanizeKey()`/
  `detailsHTML()` comment referenced the pre-fix gap as its reason for schema-agnostic
  rendering — updated (comment only; the code needed no change, already generic by
  construction). `engine-core.js` was not touched — `requestDeposit()` already worked, it
  just had no real caller; full 20-file, 0-failure regression suite re-run to confirm.
  Browser-verified live, the complete flow — not Crypto as a stand-in for both: a real Crypto
  deposit confirmed via direct `getAllClientDepositRequests()`/`getDepositRequests()`
  inspection (not just the UI toast) as a genuine pending request; an independently-submitted
  real Bank deposit confirmed with all destination fields persisted; both credited from the
  real `admin-deposits.html` UI (one at a PM-edited amount), both transactions landing
  correctly on `dashboard.html` alongside the pre-existing withdrawal entries. Zero real
  console errors. See `Marketswave_Project_Handover.md` §4.69 for the full writeup.
- **New Client Application Review — a 7th Approval Gate queue** (`engine-core.js` +
  `login.html` + new `admin-client-applications.html` + `admin-sidebar.js` + `admin.html` +
  `signup.html`, Aug 22, 2026): closes the gap where a client created via `signup.html` was
  immediately indistinguishable from an admin-created one, with nothing marking them as
  pending PM review (row 3). Confirmed before building that `signup.html` calls the exact
  same `addClient()` function `admin-clients.html`'s own Add Client form uses, and confirmed
  exactly which fields it persists (`name`/`email`/`phone`/`accountType` only — the rest of
  the signup form's own data is collected but never stored, a separate pre-existing gap
  flagged, not fixed, here). Client Registry gains a `status` field (`'pending_review'` /
  `'active'` / `'rejected'`) plus `applicationResolvedAt`/`applicationReason`; `addClient()`
  defaults `status` to `'active'` — a PM creating a client directly via Client List's own form
  IS the review, per the decision made; `signup.html` is the one caller that explicitly
  overrides this to `'pending_review'`, which wins since `clientFields` is spread after the
  default. `approveClientApplication(clientId)` / `rejectClientApplication(clientId, reason)`
  resolve it — **judgment call, decided and reported per the task's own stated instinct**: a
  rejected application is kept, never deleted, same "show everything, never silently delete"
  principle already used for rejected allocation/sell/deposit/withdrawal requests throughout
  this project. `getPendingClientApplications()` lists what's awaiting review.
  **Architecturally distinct from every other Approval Gate queue**: the Client Registry is
  already global/unscoped (one array, not a per-client-scoped store), so unlike deposits/
  withdrawals/sells/allocations/HYS-deposits there is no separate ambient-vs-cross-client-
  aggregator split needed here — `getPendingClientApplications()` already sees every
  applicant in one read. **Backward compatibility, explicitly designed and verified**: every
  client created before this feature shipped has no `status` field at all; the login-gate
  check tests for an exact match on `'pending_review'`/`'rejected'` to block, rather than
  requiring `'active'` to allow, so a missing/undefined status passes through unaffected —
  confirmed against a real precondition (CLIENT-0001's actual `status === undefined`), not
  assumed. `login.html`'s real credential check (Client Authentication Phase 2) now checks
  status after `verifyClientCredentials()` succeeds but before `setClientAuthenticated()` —
  `'pending_review'` shows "Your application is under review. We'll notify you once it's
  approved."; `'rejected'` shows "We were unable to approve your application. Please contact
  support for more information." (both reuse the existing `#login-error` element). New
  `admin-client-applications.html` (Pending list with real submitted signup data,
  Approve-confirm-modal mirroring `admin-allocations.html`'s own pattern, Reject-with-reason,
  History filtered by `applicationResolvedAt` being set — deliberately excluding
  admin-created clients, which never have that field set), positioned first in the Approval
  Gate nav group (ahead of Deposits) and a new Overview card. Node-verified first (40
  assertions, including the core security property verified directly rather than assumed —
  a signup-path client genuinely blocked from authenticating even with fully correct
  credentials, confirmed via a direct session-state check, not just the return value looking
  right — and cross-client isolation via byte-for-byte comparison) plus the full 21-file,
  0-failure regression suite. Browser-verified live, the complete flow: signed up as a brand
  new applicant through the real 7-step form (including real document uploads), confirmed a
  genuine new client was created `pending_review`; immediately attempted login with those
  exact credentials, confirmed blocked with the correct message and no session set; approved
  from the real admin UI; logged in again with the identical credentials, confirmed success
  this time, correctly showing the newly-approved client's own real (empty) portfolio —
  proving Client Authentication Phase 3's identity pin also works for a freshly-approved
  client, not just the seeded demo. Zero console errors. See
  `Marketswave_Project_Handover.md` §4.70 for the full writeup.
- **Onboarding Data Capture** (`engine-core.js` + `signup.html` +
  `admin-client-applications.html`, Aug 22, 2026): closes the remaining data-loss gap New
  Client Application Review's own build surfaced — `signup.html`'s steps 3-8 (entity/
  joint-holder details, financial profile, goals & preferences, the 6-question risk
  questionnaire, two document uploads) were collected by the form and thrown away, never
  persisted; only `name`/`email`/`phone`/`accountType` survived into `addClient()`. New
  client-scoped store, `marketswave_client_onboarding:<clientId>`, deliberately separate
  from the Client Registry record and from `SETTINGS_PROFILE_KEY` — same reasoning as every
  other domain-specific profile store in this file staying separate rather than bloating one
  record with unrelated fields. `saveClientOnboardingData(clientId, data)`/
  `getClientOnboardingData(clientId)` are explicit-clientId-only, stateless set/get — no
  ambient fallback, mirroring `resetClientPassword()`'s own pattern rather than
  `getSettingsProfile()`'s optional-clientId one, since `signup.html`'s new client isn't the
  active session yet (not authenticated at signup time) and admin review always needs one
  specific applicant, never "whichever client happens to be active." `getClientOnboardingData()`
  returns `null` (not an empty object) for a client with nothing saved, letting the admin page
  distinguish "no data exists" (an application predating this feature) from "data exists but
  empty." Document uploads are stored as filename + a fixed documentType label only, never
  real file bytes — same scoped-stub approach Documents & Reporting already uses. A new
  `collectOnboardingData()` helper in `signup.html` reads every field directly from the
  actual form markup (confirmed by reading the file before writing any code, not assumed) —
  entity/joint sections conditional on the same `accountType` variable that already decides
  which of steps 3/4 renders; the submit handler calls `saveClientOnboardingData()` alongside
  the existing `addClient()` call, gated behind the same fail-closed `typeof` check pattern.
  `admin-client-applications.html`'s Pending list gained a "View Details"/"Hide Details"
  expand toggle per row (mirroring `admin-clients.html`'s own expand-in-place pattern)
  rendering Entity Details or Joint Account Holder (whichever applies), Financial Profile,
  Goals & Preferences, all 6 Risk Questionnaire answers, and both uploaded document
  filenames — human-readable labels copied verbatim from `signup.html`'s own option text,
  **a documented duplication, the same low-risk category already flagged for
  `admin-settings-changes.html`'s own copy of `settings.html`'s formatting logic**, since no
  shared display-formatting module exists in this project. An application with no onboarding
  record (submitted before this feature shipped) shows a distinct, honest empty state rather
  than blank/undefined fields. Node-verified first (34 assertions: round-trip correctness
  across individual/entity/joint applicant shapes, `null` for a client with no saved data,
  defensive copies confirmed in both directions — mutating the caller's input after saving
  and mutating the read's return value both leave the real stored record untouched,
  cross-client isolation via byte-for-byte comparison, required-clientId enforcement on both
  functions, a clean overwrite on resubmission) plus the full 22-file, 0-failure regression
  suite. Browser-verified live, the complete flow: signed up as a new Entity/Business
  applicant ("Cascade Ventures LLC") through the real 7-step form with real, distinct answers
  at every step (Entity Details, Financial Profile, Goals & Preferences, all 6 Risk
  Questionnaire questions, two real uploaded files); confirmed via a direct
  `getClientOnboardingData()` console call (not UI inspection) that every field
  round-tripped byte-for-byte correctly; confirmed the same data renders correctly, section
  by section with the correct human-readable labels, in the admin review page's new
  expandable detail panel. Zero console errors. See `Marketswave_Project_Handover.md` §4.71
  for the full writeup.
- **HYS rate/term duplication cleanup** (`engine-core.js` + `high-yield-savings.html`, Aug 23,
  2026): closes Backend Requirements Register row 34. New public `getHYSRate(termMode,
  termValue)` (`'short'` = months 1-12, `'locked'` = years 1-5) is now the single source of
  truth for the HYS interest rate schedule — `requestHYSDeposit()` itself was refactored to
  call it internally instead of touching the private `hysShortTermRate()`/`HYS_LOCKED_RATES`
  tables directly, so the PM-credit-time path and the client-facing preview now genuinely
  share one function, not just two tables that happen to match. `high-yield-savings.html`'s
  own duplicate `SHORT_TERM_BRACKETS`/`LOCKED_RATES`/`getShortTermRate()` were deleted
  outright; `computeFDFields()` and the New Pocket term-dropdown option labels now call
  `getHYSRate()` directly. Pure refactor — no rate values changed, no new behavior.
  Node-verified: all 17 term brackets (1-12 months, 1-5 years) cross-checked against the old
  duplicated logic, byte-for-byte identical, plus confirmed the function throws correctly on
  out-of-range/invalid input; a full `requestHYSDeposit()` call for a short-term, a
  locked-term, and an AYW pocket confirmed the real request flow still produces the exact
  expected rates end-to-end. Browser-verified live (temporary local static server; logged
  into the client session via `setClientAuthenticated('CLIENT-0001')` directly rather than
  through `login.html`'s real Firebase Auth call, since that needs the separately-bootstrapped
  emulator and this check only concerned the New Pocket preview): all 12 Short-Term dropdown
  options and all 5 Locked-Term dropdown options read the exact expected rates, and the
  summary panel (rate/maturity/projected interest) updated correctly for a 6-month and a
  5-year selection. Zero console errors. See `Marketswave_Project_Handover.md` row 34 (Backend
  Requirements Register) for the full writeup.
- **Real `signOut(auth)` wired into the client-facing Logout action** (`dashboard-sidebar.js`,
  Aug 23, 2026): closes Backend Requirements Register row 61 / §12.4 switch-over-checklist
  item 9 — previously Logout only cleared the local session mirror, leaving a real Firebase
  Auth browser session (from a real `login.html` sign-in) able to persist in IndexedDB. New
  `signOutOfFirebaseAuth()` in `wireLogoutLinks()`'s click handler calls a real `signOut(auth)`
  alongside (never instead of) the existing local clear, reached via dynamic `import()` —
  valid in this classic non-module script — rather than adding a `<script type="module">` tag
  to all 10 client-facing pages that load this file; Firebase is still only reached eagerly at
  page-load time by `signup.html`/`login.html`, and by this one dynamic-import path only at
  the moment Logout is actually clicked. Wrapped in a 3-second timeout race so a stopped
  emulator or network hiccup can never block a real logout. **Two real races found and fixed
  live** (both caught by checking `auth.currentUser` via a fresh `onAuthStateChanged` on the
  very next page load, never an in-page synchronous read — that read is what silently masked
  both bugs on first pass): (1) `signOut()` was originally called before the freshly-imported
  Auth instance's own async initial-state hydration (its read of any persisted IndexedDB
  session) had settled — that hydration could resolve afterward and silently re-populate the
  session `signOut()` had just cleared; fixed by awaiting one `onAuthStateChanged` callback
  first. (2) Even after that fix, navigating away immediately after `signOut()`'s promise
  resolved could still cut off its underlying persisted-storage write before it durably
  flushed; fixed with a 300ms buffer before navigating, confirmed sufficient against the real
  emulator. Node/emulator-verified against the real running Auth Emulator (create + sign in a
  real test user, confirm `auth.currentUser` set, call `signOut(auth)`, confirm both the sync
  read and `onAuthStateChanged` genuinely go to `null` — 6/6 assertions). Browser-verified
  live end to end: signed up and approved a real test client, logged in through the actual
  `login.html` form (confirmed a genuine persisted IndexedDB session first), clicked the real
  Logout link, confirmed redirect to `login.html`, and confirmed via a fresh
  `onAuthStateChanged` on that page that `auth.currentUser` is genuinely `null` and both local
  session keys are cleared; separately confirmed navigating directly to `dashboard.html`
  afterward correctly redirects to `login.html`. Zero console errors. See
  `Marketswave_Project_Handover.md` row 61 for the full writeup, including a testing-process
  pitfall recorded there (an HTTP-cache false negative during verification, not a code bug).
- **`functions/`'s `npm audit` advisories — triaged** (Aug 23, 2026): closes the
  disclosed-but-unreviewed gap flagged at the end of Backend Migration Phase 1. All 8
  flagged advisories collapse to exactly one real CVE, `GHSA-w5hq-g745-h8pq` (`uuid`
  `<11.1.1`, moderate, "missing buffer bounds check in v3/v5/v6 when `buf` is provided") —
  `firebase-admin`/`@google-cloud/firestore`/`@google-cloud/storage`/`gaxios`/`google-gax`/
  `retry-request`/`teeny-request` are only flagged because each transitively depends on that
  same `uuid` range, not because of their own code. **Confirmed not exploitable in this
  project's actual usage**: grepped every real call site across the whole dependency tree
  that touches `uuid` (in `gaxios`, `google-gax`, `teeny-request`, and `firebase-admin`'s own
  `eventarc-utils.js`) — all four call `uuid.v4()` with zero arguments; none call the
  actually-vulnerable `v3()`/`v5()`/`v6()` with a `buf` parameter, and `functions/index.js`
  itself never imports `uuid` at all. **No safe fix exists**: `npm audit fix` (non-force) was
  run and produced a byte-for-byte identical `package-lock.json` (diffed directly, not just
  read) — `gaxios`/`teeny-request`/`google-gax` each pin `uuid` to `^9.0.x` in their own
  `package.json`, so nothing in the graph can satisfy `>=11.1.1` without a real version bump;
  `firebase-admin@12.7.0` is already the newest 12.x release, and the fix genuinely requires
  jumping to `14.3.0` (a 2-major jump, `npm audit`'s own `fixAvailable` field flags it
  `isSemVerMajor: true`) — **deliberately NOT applied**, flagged as its own future task
  instead, per instruction not to fold a breaking major bump into a security-triage pass. An
  npm `overrides` entry (forcing `uuid` tree-wide without touching `firebase-admin`'s version)
  was considered and also not applied — no real exploitable path exists to justify it.
  Verified nothing broke: a real Auth+Firestore+Functions emulator regression (Java newly
  installed on this machine to make the Firestore/Functions emulators runnable) exercised all
  three Cloud Functions end to end — real signup, a genuine `permission-denied` rejection of
  a non-admin caller, a real admin-bootstrapped approval, and a real rejection — 10/10
  assertions passed. Since the lockfile never changed, this confirms the current dependency
  state remains healthy rather than proving a fix. See `Marketswave_Project_Handover.md` row
  62 for the full writeup, including the exact advisory chain and CVSS detail.
- **Admin nav reorganization, round 2 — Catalog group added then repositioned, "Settings"
  group added then removed, all same day** (`admin-sidebar.js` + `admin.html`, Aug 23, 2026):
  data-only changes to `NAV_ITEMS`/`GROUPS`, no page files renamed or moved. Three sequential
  edits: the first renamed "Portfolio Administration" to "Settings" (holding Advisory Fee +
  Account Security) and moved Products to a new "Catalog" group positioned last; the second,
  same session, removed "Settings" entirely — Advisory Fee and Account Security (nav label
  shortened to "Security Log," its own `<title>`/`<h2>` unchanged) folded into User/Admin
  Relations instead, Catalog kept, still last; the third, on direct user feedback that
  Catalog shouldn't sit last, moved it up ahead of User/Admin Relations — Approval Gate
  deliberately stays first after Dashboard as the highest-frequency/most time-sensitive
  daily-use group. **Final structure**: Dashboard (Overview, Client List) → Approval Gate
  (Client Applications, Deposits, Withdrawals, Allocations, Sells, HYS Deposits, Profile
  Updates — "Client Profile Updates" shortened) → Catalog (Product Catalog) → User/Admin
  Relations (Documents, Support, Advisory Fee, Security Log). `NAV_ITEMS` array order
  deliberately puts the `settings` entry before `security` so `navHTML()` (which renders in
  array order, not alphabetically) produces Advisory Fee before Security Log. `admin.html`'s
  Overview cards updated in lockstep all three times, including swapping the Catalog/
  User-Admin-Relations `<div>` blocks to match. No `engine-core.js` changes. Browser-verified
  live via the real admin passphrase gate after each edit, most recently confirming the final
  4-group order (Dashboard, Approval Gate, Catalog, User/Admin Relations) renders correctly
  in both the sidebar and Overview, with User/Admin Relations' 4 cards all intact after the
  reorder. Zero real console errors (only the known, pre-existing Chrome-extension messaging
  artifact, unrelated to the app). See `Marketswave_Project_Handover.md` row 63 for the full
  writeup.
- **Bug fix: `dashboard.html`'s Portfolio Allocation legend wrapping** (Aug 23, 2026, item 1 of
  a 4-item small-fixes batch): root-caused with a systematic browser width sweep (an iframe
  technique, since this environment's window-resize tool doesn't move the real viewport) —
  the bug lives in a narrow ~30px band (~1160-1195px) right at the `lg` breakpoint, where the
  chart+legend row hasn't wrapped to two rows yet but the legend's side-by-side width is too
  narrow for its longest line ("Unallocated / Cash" + "15.9%"). Fixed by raising the legend's
  `basis-[180px]` to `basis-[220px]` (dashboard.html:110) and adding `whitespace-nowrap` to
  each label/percentage span plus `gap-2` on the row — turns the previous gradual squeeze into
  a clean binary wrap/no-wrap switch. Browser-verified across a wide sweep (700 through 1536px,
  plus 375px mobile) before and after, confirming the exact previously-broken width (1166px)
  is now fixed and no new squeeze zone was introduced anywhere else. See
  `Marketswave_Project_Handover.md` row 64 for the full writeup.
- **Duplicated formatting helpers extracted into `format-helpers.js`** (Aug 23, 2026, item 2
  of the same 4-item batch): closes the `formatDateDisplay()`/`formatFieldDisplay()`
  duplication between `settings.html` and `admin-settings-changes.html` flagged in the Known
  Structural Debt section. New `format-helpers.js` (plain globals on `window`, one `<script>`
  tag, same convention as `dashboard-sidebar.js`/`admin-sidebar.js` — deliberately NOT folded
  into `engine-core.js`, which is reserved for stateful/business logic) is now loaded by both
  pages; both files' local copies were deleted. The shared `formatFieldDisplay()` is a
  superset carrying the `dateOfBirth` branch `admin-settings-changes.html` needs for a legacy
  record — inert on `settings.html`, which never calls it with that field, so no behavior
  changed for either caller. **Grepped the whole project (not just the two named files)
  before assuming scope was complete**: found a much larger duplication family —
  `formatUSD()` near-identically duplicated across ~12 files, and a differently-named but
  byte-identical `formatDisplayDate()` across 4 more — reported, not fixed, as clearly out of
  the scope this task named (see the Known Structural Debt section for the full list).
  Browser-verified live end to end: a real Legal Name change request submitted via the console
  through `settings.html`'s own `requestSettingsChange()`, rendered correctly (via the shared
  formatter) in `admin-settings-changes.html`'s Pending list and its Approve confirmation
  modal, approved through the real UI, and confirmed the new name renders correctly (again via
  the shared formatter) back on `settings.html` after reload — the complete round trip through
  both callers of the now-shared code. Zero console errors. See
  `Marketswave_Project_Handover.md` row 65 for the full writeup.
- **File naming cleanup — `admin-settings.html` → `admin-advisory-fee.html`,
  `admin-settings-changes.html` → `admin-profile-updates.html`** (Aug 23, 2026, item 3 of the
  same batch, the riskiest of the four): closes the mismatch left after the nav reorg (row 63)
  fixed the nav *labels* without touching the file names, which still collided confusingly.
  Grepped the entire project before editing: real `href`/`src` references needing a fix existed
  in only 2 files, `admin-sidebar.js` and `admin.html` (2 links each); comment-only mentions in
  5 more files were updated for accuracy but carried no functional risk. A second full-project
  grep after editing confirmed zero remaining references to either old filename in any code
  file. Historical `§4.x`-dated narrative in both docs was deliberately left using the old
  filenames (they were correct at the time those phases shipped — this project doesn't rewrite
  history, see e.g. the preserved "Viewing Client" → "Client Management" → "Client List" label
  history); only the two forward-looking reference-table rows in
  `Marketswave_Project_Handover.md` were updated. **Verified by clicking through the actual
  renamed links, not just trusting the grep**: a real 404 surfaced on first click, traced to a
  browser-cached pre-rename copy of `admin-sidebar.js` (the on-disk file was already correct),
  resolved with a hard reload — after that, every nav link, both Overview cards, and both old
  URLs (now genuinely 404ing) were re-confirmed correct. Zero console errors. See
  `Marketswave_Project_Handover.md` row 66 for the full writeup.
- **Header button verification — status check only, no build** (Aug 23, 2026, item 4 of the
  same batch): confirmed the original project breakdown's "top-right header area needs a
  better button/design" concern is already resolved by the notification bell work (§4.37, Aug
  20, 2026), which replaced a purely decorative bell (present on only 2 of 9 dashboard pages,
  no count/dropdown/click behavior) with a real shared component on all 9 pages. Re-verified
  live rather than trusted from the doc: `dashboard.html`'s bell showed a real live count and a
  working dropdown with genuine notification entries; `settings.html` showed identical
  placement/styling with the badge correctly absent, traced to real read-state persistence
  (confirmed via a direct `localStorage` read) rather than a bug. No code changes made — a
  report-only task. See `Marketswave_Project_Handover.md` row 67 for the full writeup.

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

Live market data API, currency converter API, real password reset, portfolio engine
backend + DB, PM approval backend, document storage backend. Where a feature needs one of
these, build the frontend interaction (forms, buttons, confirmations, toasts) and stub the
result — do not silently leave controls non-functional. If something looks clickable, it
should do something, even if that something is just a client-side confirmation state.

**One real, deliberate exception as of Aug 22, 2026 — read before assuming "frontend-only"
still applies everywhere.** `signup.html` and `login.html` (ONLY these two files) now talk to
a real backend: real Firebase Auth + real Firestore + real Cloud Functions, via Backend
Migration Phase 1 — see the dedicated `Marketswave_Project_Handover.md` §12 for the full
architecture writeup and Tech Stack entry below for the summary. **This still stays
frontend-only in the sense that matters**: it's the Firebase Local Emulator Suite, not real
production Firebase — a real project ("Marketswave SE") exists with real Firestore/Auth
already enabled in its console, but is explicitly untouched and unconnected until a future,
separately-scoped deployment phase (§12.4's switch-over checklist). Every other page (all 9
dashboard pages, the entire admin tool) is still 100% local/`localStorage`-only for its actual
data — a hybrid bridge (`mirrorAuthenticatedClientLocally()` + `setClientAuthenticated()`) is
what makes that possible; see the Tech Stack entry. **One narrow addition, Aug 23, 2026**:
`dashboard-sidebar.js` (loaded by all 10 client-facing pages) now also reaches Firebase, but
only via a dynamic `import()` inside the Logout click handler, purely to call a real
`signOut(auth)` — no page gained an eager `<script type="module">` Firebase load, and no
other data on those pages comes from Firebase. `signup.html`/`login.html` remain the only
pages that load Firebase eagerly at page-load time.

**Backend pivot, Aug 30, 2026 — read before assuming the above is still the plan.** The real
backend is migrating from Firebase to Supabase (reason: Firebase Cloud Functions are blocked
on a Blaze plan upgrade for staging; Supabase's free tier includes real Edge Functions with
no card required, at the cost of free-tier auto-pause after 7 days idle). **Supabase
Migration Stage 1** (local Docker stack, schema, RLS, admin-role custom-claim hook, local
bootstrap) and **Stage 2** (client-facing `signup.html`/`login.html` support against the
LOCAL Supabase stack only, selected via a NEW, separate `?backend=supabase` query param —
its absence leaves both pages running on Firebase exactly as before, confirmed via `git diff`
to be byte-for-byte unchanged) are both complete — see the Tech Stack entries below and
`README.md`'s "Supabase Local Development Runbook" for the full detail. **Still additive,
still real backends kept side by side, not a replacement**: `signup.html`/`login.html` now
support BOTH backends behind one query param, but the default (no param) is still 100%
Firebase, and the real cloud "Marketswave Staging" project has not been touched by either
Supabase stage — everything Supabase-related so far is the LOCAL Docker stack only. Every
other page (all 9 dashboard pages, the entire admin tool) has zero Supabase-awareness either
way — the hybrid bridge (`mirrorAuthenticatedClientLocally()`/`setClientAuthenticated()`,
unmodified, already backend-agnostic) is what makes that possible, mirroring the exact same
role the Firebase-only bridge already played. One disclosed, tracked gap: Logout does not
yet sign out of a real Supabase session (mirrors a bug already fixed once on the Firebase
side, deliberately left open here — see the Stage 2 Tech Stack entry). Do not assume
Supabase has replaced anything beyond signup/login-against-the-local-stack until a later
Stage's own Tech Stack entry says so.

**Build it in-house, not via external APIs.** Explicit user direction (Aug 19, 2026): "we
are building an engine locally for our operation, we would not be needing a lot of
external APIs." Default to building portfolio/allocation/notification/document logic as
your own engine. The genuine exceptions — things external by nature, not by choice — are
real-world market prices, currency exchange rates, and blockchain confirmation for crypto
deposits; Backend Migration Phase 1 (above) is a distinct, explicitly-instructed exception
for auth/Client Registry specifically, not a reversal of this general rule for anything
else. Everything else (allocation math, PM approval, interest accrual, document storage,
notifications, risk profile persistence, sessions) is in-house engineering, still on
`localStorage`.

**Backend Requirements Register:** every frontend stub above is logged in
`Marketswave_Project_Handover.md` section 3.1 (60 items as of Aug 22, 2026, split into
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

**Approval Gate unification — COMPLETE** (Aug 21, 2026, the highest-risk task of the
session — a `git init` + initial commit was made specifically as a rollback net before it
began): Deposits, Allocations, Sells, and HYS Deposits — previously the 4 "ambient" queues
each showing only the currently active client — now use the same cross-client pattern
Client Profile Updates already had. The real risk wasn't the 4 admin pages, it was that the
underlying primitives (`executeBuy`/`executeSell`/`creditDepositRequest`/
`creditHYSDeposit`) read/wrote module-level cached state, not a fresh scoped read/write per
call the way Client Profile Updates always did — a full call-chain trace confirmed this and
was reported before any test was written, exactly as instructed. All 10 primitive/wrapper
functions now take an explicit `clientId` and touch only that client's scoped storage, no
fallback to the ambient session anywhere in the chain. Node-verified per-domain
individually (41 new assertions: resolve an action for client A, diff client B's raw
storage byte-for-byte against a pre-action snapshot) plus the full 346+-assertion suite
after fixing 5 older test files that needed a `reload()` between an explicit-client action
and a subsequent ambient read — a real, general architectural consequence of this change,
documented rather than silently patched around. Browser-verified live end to end on all 4
admin pages, including a real raw-`localStorage` isolation diff after each action, and
confirmed Client List's "View as this Client" still works correctly for its real remaining
purpose. The subtle "Viewing: ..." indicator re-added in §4.59 was removed again — genuinely
redundant now that every Approval Gate page shows its own per-row client context. See the
Tech Stack entry above and `Marketswave_Project_Handover.md` §4.60 for the full writeup,
including the complete call-chain trace. Backend Requirements Register row 46.

**Password Reset + 2FA Rework — COMPLETE** (Aug 21, 2026): the first admin-triggered domain
built cross-client from the start, using the discipline Approval Gate unification proved
out — no module-level cache anywhere in this domain, so the full regression suite needed
zero `reload()` insertions this time, unlike §4.60's own 5. New global
`marketswave_security_actions_log` audit trail; `resetClientPassword()`/`resetClient2FA()`
both take an explicit `clientId` and a required reason. "Force new password" is a
client-side UI gate only (no real login/session system exists to enforce it server-side) —
flagged explicitly as buildable now, not blocked on the login gate work. 2FA setup rebuilt
from QR/authenticator to a simulated email-code flow with real code verification. New
`admin-clients.html` Reset Password/Reset 2FA buttons and new `admin-security.html` log
page. Node-verified first (49 new assertions, per-action cross-client isolation for both
action types in both directions) plus the full 346+-assertion suite, 395+ total, 0
failures. Browser-verified live end to end, including the forced-reset banner, the new
2FA flow, and a raw `localStorage` diff confirming CLIENT-0002 untouched. See the Tech
Stack entry above and `Marketswave_Project_Handover.md` §4.61 for the full writeup.
Backend Requirements Register row 47.

**Admin Login Gate — COMPLETE** (Aug 21, 2026): a session-based shared passphrase now sits
in front of every admin page — **explicitly a UI-level stub, not real authentication, same
honesty standard as the forced password-reset gate**, stated on the gate page itself and in
the register, not just here. `admin-sidebar.js` checks a raw `sessionStorage` key at
file-load time (before `engine-core.js` even loads, mirroring `dashboard-sidebar.js`'s own
CLIENT-0001-reset precedent) and redirects any unauthenticated visitor to new
`admin-login.html` immediately; a "Log Out" control was added to the sidebar footer,
distinct from the client-facing logout. Node-verified first (15 assertions) plus the full
prior suite — one pre-existing, unrelated test failure was found and reported (a
`verify-step2.js` assertion that hardcodes a price figure depending on real-wall-clock-date
price ticking, confirmed to fail identically against the original untouched commit, nothing
to do with this task). Browser-verified live end to end: direct navigation to any admin URL
while unauthenticated redirects to the gate; correct passphrase authenticates and persists
across real navigation; Log Out genuinely locks it back down; a simulated fresh session
correctly requires re-entering the passphrase. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.62 for the full writeup. Backend Requirements Register
row 48. **This closes the "completely wide open" gap only — a real authentication system
(real PM accounts, real backend-verified credentials) remains a genuine, unresolved future
requirement, not superseded by this stub.**

**Asset Collection extraction + admin product management — COMPLETE** (Aug 21, 2026):
the product-browsing grid moved from `asset-performance.html` into new
`asset-collection.html` (search + load-bearing category filter + "Load More," unchanged
`requestAllocation()` behavior); Return Table/My Requests stayed put on
`asset-performance.html`, which now links out via a "Browse Asset Collection" card. New
`admin-products.html` gives PMs a real Add/Edit Product UI for the first time (`addProduct()`
had zero real callers before this) — two independent filter dimensions (asset class, risk
tier), and a deliberate, reported decision to block `unitPrice` edits at the engine level
(price should only ever move via the returns engine's own tick, never a manual overwrite).
A real pre-existing bug (`getAllProducts()`/`getProduct()` returning live references, not
defensive copies — the same class already fixed once for holdings/requests) was found and
fixed as a direct consequence of adding `editProduct()`. Node-verified first (46 assertions,
including a direct proof that renaming/reclassifying a product with a real seeded holding
and transaction orphans nothing) plus the full prior suite, 440+ total, 0 failures.
Browser-verified live end to end: added and edited real products from admin, confirmed both
changes reflected correctly on the client side, and confirmed a request submitted from the
new page shows up correctly back on `asset-performance.html`'s own My Requests — proof both
pages share one real engine. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.63 for the full writeup. Backend Requirements Register
row 49.

**Client Authentication, Phase 1 — COMPLETE** (Aug 21, 2026): credentials now exist somewhere
real. New `marketswave_client_credentials:<clientId>` store (`{ passwordHash }` only) and
`hashClientPassword()`/`setClientCredentials()`/`verifyClientCredentials()` in
`engine-core.js`; CLIENT-0001 seeded with a known demo password, `Marketswave2026!`
(precomputed hash, since seeding is synchronous and Web Crypto's digest isn't).
`signup.html`'s "Submit Application" — previously just a navigation to `thank-you.html` with
nothing persisted at all, confirmed by reading the file before starting — now genuinely
calls `addClient()` and stores a real hashed credential. Deliberately did NOT touch
`login.html`'s actual check or `dashboard-sidebar.js`'s CLIENT-0001 pin (Phases 2/3).
Node-verified first (27 assertions, including a full signup-equivalent flow proving a real
client with a real stored hash results) plus the full prior suite, 467+ total, 0 failures.
Browser-verified live: clicked through the actual 7-step signup form as a new applicant,
submitted for real, confirmed a genuine `CLIENT-0003` was created with a real credential
record (no raw password anywhere in it), and confirmed it verifies/rejects/isolates
correctly against the real engine functions. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.64 for the full writeup. Backend Requirements Register
row 50.

**Client Authentication, Phase 2 — COMPLETE** (Aug 21, 2026): `login.html` now performs a
real credential check. New `getClientByEmail(email)` (case-insensitive/trimmed, `null` on no
match) and a `sessionStorage`-backed auth-session trio,
`setClientAuthenticated(clientId)`/`getAuthenticatedClientId()`/`clearClientAuthentication()`,
mirroring the admin gate's own session functions exactly. `login.html`'s old
"any submit redirects" stub is replaced with a real
`getClientByEmail()` → `hashClientPassword()` → `verifyClientCredentials()` check; wrong
email and wrong password produce one identical generic error, never distinguishing which
failed. Still does NOT touch `dashboard-sidebar.js`'s CLIENT-0001 pin (Phase 3).
Node-verified first (25 assertions, including a structural proof — not just "both fail" —
that the two failure paths produce byte-identical results) plus the full 17-file regression
suite, 0 failures. Browser-verified live: CLIENT-0001 logs in successfully with the demo
password; a wrong password and a wholly unknown email both produce the identical generic
error; a fresh client created live through the real `signup.html` call chain (since
CLIENT-0003's actual signup password was never recorded anywhere, by design) also logs in
successfully, proving this works for a genuine self-registered client, not only the seeded
demo. Confirmed, as expected: the dashboard still shows CLIENT-0001's data even while logged
in as a different client, since reconciling `marketswave_authenticated_client_id` with
`marketswave_current_client_id` is Phase 3's job. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.65 for the full writeup. Backend Requirements Register
row 51.

**Client Authentication, Phase 3 — COMPLETE** (Aug 21, 2026, the highest-risk step of the
whole build): `dashboard-sidebar.js`'s file-load-time pin no longer unconditionally sets
CLIENT-0001 — it reads the real `getAuthenticatedClientId()` session (raw key) and pins
`marketswave_current_client_id` to whichever real client authenticated, redirecting to
`login.html` immediately if nobody did, on all 9 locked-sidebar pages plus
`asset-collection.html`. A defense-in-depth guard was added inside `initDashboardSidebar()`
itself, mirroring `initAdminSidebar()`'s own second check. `wireLogoutLinks()`'s previously
documented no-op now genuinely clears the real session (`clearClientAuthentication()` plus
the ambient pin) — required by this phase's own "logout then reload doesn't restore access"
verification, not scope creep. No `engine-core.js` changes were needed. A real, deliberately
out-of-scope cosmetic gap was flagged, not fixed: the sidebar footer ("John Doe"/"JD") and
`dashboard.html`'s greeting stay hardcoded regardless of who really logged in — confirmed live
that this is cosmetic only, not a data leak, since every real portfolio figure already
resolves correctly. Node-verified first (16 assertions, loading the REAL `engine-core.js` and
REAL `dashboard-sidebar.js` source against a minimal fake DOM) plus the full 18-file,
0-failure regression suite. Browser-verified live, the complete chain: all 10 client-facing
pages redirect correctly when unauthenticated; CLIENT-0001 and a second real client
(CLIENT-0004, genuinely empty portfolio) both resolve correctly with zero cross-leakage; real
Logout clears the session and a post-logout reload doesn't restore access; and the admin
tool's "View as this Client" is confirmed genuinely independent, with a bonus proof that
navigating to a client page from an admin tab now correctly redirects instead of leaking the
admin's ambient client — permanently closing the same-tab admin-to-client leak class
§4.44/§4.45 had to fix once already. Zero console errors. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.66 for the full writeup. Backend Requirements Register
row 52. **Client Authentication is now fully complete end to end** (signup → credential
storage → real login → real per-client dashboard resolution → real logout).

**Identity display fix — COMPLETE** (Aug 22, 2026): the sidebar footer, `dashboard.html`'s
greeting, `settings.html`'s profile card, and `support.html`'s callback modal/live chat all
now read the real authenticated client's own name/initials/account type via the new
`getClientInitials(name)` (business-name-aware — legal suffixes stripped before splitting, so
`"Riverstone Holdings LLC"` → `"RH"`). Grepping the whole project first surfaced two more
genuine hardcodes beyond the two originally flagged (`settings.html`'s profile header,
`support.html`'s `DEMO_USER_NAME`), both fixed too. Browser-verified live with a brand-new
client created through the real signup flow ("Marcus Chen") showing their own name/initials
everywhere, not "John Doe." See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.67 for the full writeup. Backend Requirements Register
row 53.

**Client Withdrawal — COMPLETE** (Aug 22, 2026): a 6th Approval Gate queue,
`marketswave_withdrawal_requests`, mirroring the deposit request/approve pattern for money
leaving the account, built cross-client/stateless from day one. New `admin-withdrawals.html`
and a real "Withdraw Funds" flow on `deploy-capital.html` (in-form Crypto/Bank toggle, an
"Available to withdraw" guard rail, a new "My Withdrawal Requests" section).
`approveWithdrawal()` re-validates `unallocatedCapital` at approval time, same
oversell-protection discipline as `approveSellRequest()`; `approvedAmount` stays PM-editable,
a judgment call decided and reported. **A real, pre-existing gap found and reported before
building the client UI**: `deploy-capital.html`'s two Deposit forms have never actually
called `requestDeposit()` — confirmed by reading the file directly — left untouched as a
separate, unscoped item (Backend Requirements Register row 31, updated). `transactions.html`/
`dashboard.html`'s rendering consumers were all extended for `WITHDRAWAL` from the start, not
retrofitted after a bug the way `DEPOSIT` originally was. Node-verified first (49 assertions,
including the exact re-validation-at-approval-time edge case specified and per-domain
cross-client isolation in both directions) plus the full 20-file, 0-failure regression suite.
Browser-verified live end to end, including the real thrown over-limit error, a PM-edited
approval amount, correct rendering across every transaction consumer, and a final live
cross-client isolation spot-check. Zero console errors. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.68 for the full writeup. Backend Requirements Register
row 54.

**Deposit Wiring fix — COMPLETE** (Aug 22, 2026): `deploy-capital.html`'s two Deposit forms
now genuinely call `requestDeposit()`, closing the gap Client Withdrawal found and reported
(row 31). A real signature mismatch was caught before writing code — `requestDeposit()` is
ambient (no `clientId` parameter), unlike `requestWithdrawal()` — resolved by calling it as
it actually exists rather than changing its signature; `getAuthenticatedClientId()` was
applied to the Withdraw handler's own explicit-clientId call instead, correcting it from
`getCurrentClientId()`. "My Withdrawal Requests" renamed to "My Funding Requests" and merged
with real Deposit history. Audit requested and reported: `admin-deposits.html`'s
`humanizeKey()`/`detailsHTML()` comment referencing the pre-fix gap was updated (code needed
no change, already schema-agnostic). Browser-verified live: independent real Crypto and Bank
deposits confirmed via direct engine inspection (not just UI toasts) as genuine pending
records, both credited from the real admin UI, both transactions landing correctly on
`dashboard.html`. Zero console errors. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` §4.69 for the full writeup. Backend Requirements Register
row 55.

**New Client Application Review — COMPLETE** (Aug 22, 2026): a 7th Approval Gate queue,
closing the row-3 gap — a client created via `signup.html` was immediately indistinguishable
from an admin-created one, with nothing marking them as pending PM review. Client Registry
gains a `status` field (`'pending_review'` / `'active'` / `'rejected'`) — `addClient()`
defaults to `'active'` (a PM creating a client directly IS the review); `signup.html` is the
one caller that overrides this to `'pending_review'`. `approveClientApplication(clientId)`/
`rejectClientApplication(clientId, reason)` resolve it (rejected applications are kept, never
deleted, same "show everything" principle as every other rejected request in this project);
`getPendingClientApplications()` lists what's awaiting review — no separate ambient-vs-
cross-client-aggregator split needed here, since the Client Registry is already
global/unscoped. `login.html`'s real credential check now blocks authentication entirely for
`'pending_review'`/`'rejected'` status, checked after credentials verify but before
`setClientAuthenticated()` — correct credentials alone are not enough. A missing/undefined
status (every client created before this feature shipped) is deliberately treated the same
as `'active'`, not migrated, so no pre-existing client is retroactively locked out — verified
against a real precondition (CLIENT-0001), not assumed. New `admin-client-applications.html`
(Pending/Approve-confirm-modal/Reject-with-reason/History), positioned first in the Approval
Gate nav group. Node-verified first (40 assertions, including the core security property —
a signup-path client genuinely blocked from authenticating even with fully correct
credentials — verified directly via a session-state check, not assumed from the code looking
right) plus the full 21-file, 0-failure regression suite. Browser-verified live, the complete
flow: signed up as a brand new applicant through the real 7-step form, confirmed blocked
login with the correct message and no session set, approved from the real admin UI, and
confirmed a second login with the identical credentials succeeded, correctly showing the
newly-approved client's own real portfolio. Zero console errors. See
`Marketswave_Project_Handover.md` §4.70 for the full writeup. Backend Requirements Register
row 56.

**Onboarding Data Capture — COMPLETE** (Aug 22, 2026): closes the remaining data-loss gap
New Client Application Review's own build surfaced — `signup.html`'s steps 3-8 (entity/
joint-holder details, financial profile, goals & preferences, the 6-question risk
questionnaire, two document uploads) were collected by the form and thrown away, never
persisted. New client-scoped store, `marketswave_client_onboarding:<clientId>`, separate
from the Client Registry record and from `SETTINGS_PROFILE_KEY`, same reasoning as every
other domain-specific profile store in this file. `saveClientOnboardingData(clientId,
data)`/`getClientOnboardingData(clientId)` are explicit-clientId-only, stateless set/get (no
ambient fallback — `signup.html`'s new client isn't the active session yet, and admin review
always needs one specific applicant). Document uploads are stored as filename + a fixed
documentType label only, never real file bytes — same scoped-stub approach Documents &
Reporting already uses. `signup.html`'s submit handler now calls this alongside
`addClient()`, reading every field from the actual form markup (confirmed by reading the
file directly). `admin-client-applications.html`'s Pending list gained a "View Details"
expand toggle (mirroring `admin-clients.html`'s own expand-in-place pattern) rendering
Financial Profile, Goals & Preferences, all 6 Risk Questionnaire answers, Entity Details or
Joint Account Holder (whichever applies), and both uploaded document filenames, with
human-readable labels matching `signup.html`'s own option text — a documented duplication,
same low-risk category as `admin-settings-changes.html`'s existing copy of `settings.html`'s
formatting logic. Node-verified first (34 assertions: round-trip correctness across
individual/entity/joint applicant shapes, `null` for a client with no saved data, defensive
copies confirmed in both directions, cross-client isolation, required-clientId enforcement,
clean overwrite on resubmission) plus the full 22-file, 0-failure regression suite.
Browser-verified live, the complete flow: signed up as a new Entity/Business applicant
through the real 7-step form with real, distinct answers at every step; confirmed via a
direct `getClientOnboardingData()` call (not UI inspection) that every field round-tripped
byte-for-byte correctly; confirmed the same data renders correctly, section by section, in
the admin review page's new expandable detail panel. Zero console errors. See
`Marketswave_Project_Handover.md` §4.71 for the full writeup. Backend Requirements Register
row 57.

**Backend Migration Phase 1 — real Firestore + Firebase Auth + Cloud Functions, for
`signup.html`/`login.html` only, EMULATOR-ONLY — COMPLETE** (Aug 22, 2026): this project's
first real backend. Full architecture writeup lives in its own dedicated
`Marketswave_Project_Handover.md` **§12** (a new major section, not a `§4.x` entry — a
stack-level decision, not one more feature). Summary: Firestore `clients/{uid}` (document id
= Firebase Auth uid, per explicit instruction), three Cloud Functions
(`createClientApplication`/`approveClientApplication`/`rejectClientApplication`, callable
`onCall` functions chosen over Auth triggers to avoid a real race window) mirroring
`engine-core.js`'s local business rules field-for-field. Admin authorization: a real custom
claim (`{admin: true}`) on a single shared bootstrap Firebase Auth account — server-enforced
for the first time, keeping the existing single-shared-admin model rather than building full
multi-PM support (real, separate future work). Firestore rules deny all direct client
writes; a client may only `get` their own document. **The hybrid bridge is the actual point
of this phase**: `mirrorAuthenticatedClientLocally()` (new) upserts a local shadow copy of
the real Firestore record into `engine-core.js`'s own local `clients` array, then the
EXACT, unmodified `setClientAuthenticated(uid)` — the same function every other page already
depends on via `getAuthenticatedClientId()` — is called with the client's real Firebase Auth
uid. Every other already-built page (all 9 dashboard pages, the entire admin tool) keeps
working with zero changes, unaware the identity behind that id is now real Firebase Auth
instead of a local password-hash comparison. **Deliberately emulator-only**: a real Firebase
project, "Marketswave SE," already exists with real Firestore/Auth enabled in its console,
but stays completely untouched and unconnected until a future, explicitly-scoped deployment
phase — a Claude memory entry (`project_firebase_real_project.md`) logs this so it isn't
silently forgotten. Node-verified (26 assertions against the real running Emulator Suite,
including confirming the admin-authorization check is genuinely enforced — a non-admin
caller is really rejected with `permission-denied`, not just assumed) and browser-verified
live end to end: real signup through the actual 7-step form → real Firestore doc
(`pending_review`) → login genuinely blocked with the correct message → approved via the
real admin-authorized callable → login succeeds → `dashboard.html`/`settings.html`/
`transactions.html` all render completely correctly (correct identity, genuine empty state
for a fresh client) with zero console errors, having no idea anything changed underneath
them → logout correctly revokes access. Known, disclosed limitations: no new admin UI was
built to call approve/reject this phase (a PM must invoke the callable directly — Step 3
scoped UI changes to signup.html/login.html only), the app's own Logout doesn't yet sign out
of Firebase Auth itself, `functions/`'s `npm audit` advisories are untriaged. See
`Marketswave_Project_Handover.md` §12 for the complete writeup, including the full
9-item real-production switch-over checklist. Backend Requirements Register row 58.

**Admin UI for Client Applications — closing the "PM must invoke the callable directly" gap
— COMPLETE, still emulator-only** (Aug 22, 2026, same-session follow-up): `admin-client-
applications.html`'s Approve/Reject now genuinely call the real, Firebase-authorized
callables through the real admin UI, not a script. **Investigated which situation applies
before building, per instruction**: both — a real, unresolved LOCAL pending application
(`CLIENT-0007`) was confirmed still sitting in this browser's own localStorage, so Pending/
History now merge the existing local reads with two new real Firestore queries, each row
tagged with a small "Firebase" badge when Firestore-sourced. New shared `admin-firebase-
config.js` transparently signs the browser into the single shared bootstrap PM Firebase Auth
account via `ensureAdminSignedIn()` — a PM never sees a second login screen beyond the
existing `admin-login.html` passphrase gate. `firestore.rules` extended to allow `get`/`list`
for `request.auth.token.admin == true` (writes unchanged, still 100% Cloud-Function-gated) —
re-verified Phase 1's own 26-assertion Node suite against the updated rules first, 0
regressions, before writing any UI code. **A real, disclosed correction to the task's own
framing**: financial profile/risk questionnaire/document metadata are NOT in Firestore
(Phase 1 deliberately kept that local-only, keyed by the same Firebase uid) — the detail
panel still reads the local `getClientOnboardingData()` store, genuinely real and correctly
correlated, just not Firestore-sourced the way the task assumed. Browser-verified live, the
complete real UI flow: signed up two new real applicants through the actual signup form,
confirmed both appeared in the real admin page's Pending list alongside the genuine local
`CLIENT-0007`, clicked Approve in the real UI and confirmed login then succeeded; clicked
Reject in the real UI with a real reason and confirmed the correct distinct rejected message
on a subsequent login attempt. Zero console errors. See `Marketswave_Project_Handover.md`
§12.7 for the full writeup, including why a genuine non-admin negative test isn't possible
through this UI by design (the authorization boundary lives entirely server-side, verified
independently via Node). Backend Requirements Register row 59.

**Admin UI for Client List — merging real Firebase clients into `admin-clients.html` —
COMPLETE, still emulator-only** (Aug 22, 2026, same-session follow-up): engine/UI code
complete, Node-verified (15 assertions against the real emulator, 0 failures) and
browser-verified live end to end — see `Marketswave_Project_Handover.md` §12.8. Mirrors
`admin-client-applications.html`'s own proven merge pattern exactly, read directly from that
file first. New `cachedClients` merges `getAllClients()` (local) with a bare, unfiltered
`collection(db, 'clients')` Firestore read (Client List shows every client regardless of
status) — no new `firestore.rules` changes needed, the existing admin-claim `allow list`
rule already covers this, confirmed via Node. `matchesSearch()`/`matchesTypeFilter()`/
`applyFilters()` were NOT modified — search/filter works across both sources by
construction, verified directly in both Node and the real UI. Dedup proven with a real
before/after login transition in Node and observed live in the browser (already-mirrored
Firebase clients correctly show without the badge). Browser-verified: signed up a new real
applicant through the actual form, confirmed it appeared in the real Client List UI with the
correct badge/id/type/balance, confirmed search and both filter pills worked correctly
across both sources, expanded the row in place with no crash. Zero console errors. Known
limitation flagged: Reset Password/2FA on a Firebase-sourced client currently has no real
effect on their actual Firebase Auth sign-in. Backend Requirements Register row 60.

**HYS rate/term duplication cleanup — COMPLETE** (Aug 23, 2026): closes Backend Requirements
Register row 34, the one remaining known-structural-debt item from the HYS Deposit Approval
Queue phase. `engine-core.js`'s `getHYSRate(termMode, termValue)` is now the single source of
truth for the HYS interest rate schedule — `requestHYSDeposit()` was refactored to call it
internally instead of reading its own private rate tables directly, and
`high-yield-savings.html`'s separate duplicate copy of those same tables was deleted, with its
live New Pocket preview now calling `getHYSRate()` directly instead. Pure refactor, no rate
values changed. Node-verified (all 17 term brackets byte-for-byte identical to the old
duplicated logic, plus a full `requestHYSDeposit()` round trip for short/locked/AYW pockets)
and browser-verified live (all 12 Short-Term and all 5 Locked-Term dropdown options, plus the
summary panel for two sample terms, all showing the correct rate/interest). Zero console
errors. See the Tech Stack entry above and `Marketswave_Project_Handover.md`'s Backend
Requirements Register row 34 for the full writeup.

**Real `signOut(auth)` wired into the client-facing Logout action — COMPLETE** (Aug 23,
2026): closes Backend Requirements Register row 61 and §12.4 switch-over-checklist item 9 —
`dashboard-sidebar.js`'s Logout handler now calls a real `signOut(auth)` (reached via dynamic
`import()`, no new `<script type="module">` tags needed on any client page) alongside the
existing local session clear, so a real Firebase Auth session from a real `login.html`
sign-in no longer silently outlives an app-level logout. Two real races were found and fixed
live during verification — a hydration race (calling `signOut()` before the freshly-imported
Auth instance's own initial IndexedDB-restore had settled let that restore silently undo the
sign-out) and a persistence-flush race (navigating away immediately after `signOut()`
resolved could still cut off its underlying storage write) — both confirmed via a fresh
`onAuthStateChanged` check on the very next page load, not an in-page synchronous read.
Node/emulator-verified (6/6 assertions against the real running Auth Emulator) and
browser-verified live end to end with a real signed-up-and-approved test client: real login
→ confirmed genuine persisted session → real Logout click → confirmed via a fresh page load
that both the real Firebase session and the local session are genuinely gone → confirmed a
direct navigation to a protected page afterward correctly redirects to `login.html`. Zero
console errors. See the Tech Stack entry above and `Marketswave_Project_Handover.md` row 61
for the full writeup.

**`functions/`'s `npm audit` advisories — TRIAGED** (Aug 23, 2026): closes the
disclosed-but-unreviewed gap left at the end of Backend Migration Phase 1. All 8 flagged
moderate advisories trace to one real CVE (`uuid <11.1.1`, `GHSA-w5hq-g745-h8pq`) reached only
transitively; confirmed not exploitable here since every real call site in the dependency
tree calls `uuid.v4()` with no arguments, never the actually-vulnerable `v3()`/`v5()`/`v6()`
with a buffer argument, and `functions/index.js` doesn't import `uuid` at all. No safe,
non-breaking fix exists — `npm audit fix` made zero changes (confirmed via a direct lockfile
diff); the only real fix is a 2-major-version `firebase-admin` bump (12.7.0 → 14.3.0),
deliberately NOT applied, flagged as its own future task instead. Verified nothing broke via
a real Auth+Firestore+Functions emulator regression exercising all three Cloud Functions
end to end (signup, a genuine non-admin `permission-denied` rejection, a real admin approval,
a real rejection) — 10/10 assertions passed. See the Tech Stack entry above and
`Marketswave_Project_Handover.md` row 62 for the full writeup.

**Backend Migration — Phase 0, items 1 & 2: stabilizing the hybrid — COMPLETE** (Aug 26,
2026; item 3, labeling local-only admin actions, deliberately deferred): adopts a new,
named migration structure for everything from here to real production — **Phase 0 (stabilize
what already works) → A (config/environment safety) → B (real deploy) → C (real admin
bootstrap) → D (multi-PM decision) → E (cutover)** — see the new root-level `README.md`'s
"Backend Migration roadmap" section for the full breakdown (Phases A–E are a proposed
grouping of this doc's own pre-existing §12.4 7-item checklist, flagged there as a proposal
to confirm, not settled history). **Item 1**: a full step-by-step Emulator Bootstrap Runbook,
written as `README.md` at the project root rather than a new handover-doc section — reported
per instruction: this is "how do I get this running" operational content, not phase-log
narrative history. Covers prerequisites (Java 21+ is installed on this machine but genuinely
NOT on either shell's default `PATH` — confirmed directly, exact prepend commands given for
both PowerShell and Git Bash), starting the three emulators, and the literal expected console
output at each step, not just a description of it. **Item 2**: `scripts/golden-path-
regression.js` — a single command that walks the entire real chain (signup → pending status,
plus a genuine blocked-login proof, not just a status check → admin approve → login succeeds
→ dashboard loads with a genuinely clean $0/empty-ledger read → Deploy Capital deposit
request → admin credit → `DEPOSIT` transaction appears → allocation request → admin approve →
`BUY` transaction + holding appear, Total Portfolio Value conserved) and prints one
unambiguous `GOLDEN PATH: PASS`/`FAIL` line, exit code 0/1 to match. Exercises the REAL
`functions/index.js`/`firestore.rules` via the real `firebase` client SDK for the Firebase
half, and the REAL `engine-core.js` source loaded into a fresh Node `vm` sandbox per
simulated "page load" (`scripts/lib/engine-harness.js` + `storage-polyfill.js`, reconstructing
this project's own "real file against a minimal fake DOM" Node-verification pattern, since
those prior scripts were themselves scratchpad-only and didn't survive between sessions) for
the local half — reusing the same underlying storage across "reloads" exactly like a real
browser tab, mirroring the exact ordering assumption §4.44/§4.45's own bug depended on
getting right. Also new: `scripts/bootstrap-admin.js`, a deliberately **committed** (not
scratchpad) idempotent script that creates/reuses the bootstrap PM account and its `{ admin:
true }` claim — safe to commit specifically because these emulator-only credentials are
already fully disclosed in the already-committed `admin-firebase-config.js`, a materially
different situation from the real-production bootstrap script §12.4 item 6 still requires
stay uncommitted (flagged explicitly in both files so this isn't mistaken as a precedent).
**Run for real against a live emulator, end to end, not assumed from the code**:
`GOLDEN PATH: PASS (16/16 steps)`, plus a confirmed-idempotent second `bootstrap-admin.js`
run. Two real environment findings surfaced and resolved live, not carried forward unverified
from old notes: a one-time Functions-discovery "Cannot determine backend specification"
timeout that cleared on a plain emulator restart (now documented in README.md's
Troubleshooting section), and the `--export-on-exit` limitation re-confirmed under a
DIFFERENT launch method than before (PowerShell `Start-Process`, not Git Bash) — Windows
outright refuses a non-forceful `taskkill`, confirming this is a genuine Windows process-
termination limitation, not a one-off shell quirk. One real mistake disclosed, not hidden:
a broad process-name cleanup pass (`ProcessName -match 'java|node'`) caught and killed an
unrelated Adobe Creative Cloud helper process alongside the intended stray emulator
processes — confirmed the main Creative Cloud app and its other helpers were unaffected, and
tightened all further process kills to target a specific PID confirmed via its own command
line. See `Marketswave_Project_Handover.md` §12.9 for the full writeup. Backend Requirements
Register row 68.

**Backend Migration — Phase 0, item 3: labeling local-only admin actions — COMPLETE** (Aug
26, 2026, same-day follow-up): closes Phase 0's own item 3, deliberately deferred out of the
items-1–2 task above. **Investigated directly before labeling anything, rather than trusting
the existing "Reset Password/2FA... has no real effect" framing (§12.8's own note) at face
value — that framing turned out to be inaccurate for one of the two actions.** Traced
`settings.html`'s forced-password-reset submit handler: it never persists a password anywhere
for ANY client (no real credential store backs the self-service Change Password flow either)
— it only clears the flag. For a Firebase-sourced client, this means Reset Password has
genuinely NO effect on their real sign-in credential; they keep using their existing real
Firebase Auth password, unaware anything was supposed to change. **Reset 2FA, however, is NOT
a no-op** — it writes directly to the same `marketswave_settings_2fa:<clientId>` key
`settings.html`'s own 2FA section reads, and 2FA has always been a fully local, simulated
feature independent of Firebase Auth for every client (Firebase Auth has its own real MFA
support; this project never adopted it) — so Reset 2FA achieves its real, complete, intended
effect for a Firebase-sourced client exactly as designed, and warning otherwise would have
been inaccurate, not just unnecessary caution. `admin-clients.html` now shows this
distinction two ways, both scoped to Reset Password on a Firebase-sourced client only, never
Reset 2FA: (1) an inline amber note under the two buttons in a Firebase-sourced client's
expanded row, visible before a PM even opens the modal; (2) a warning banner inside the
confirm modal itself (`#security-firebase-warning`, toggled in `openSecurityModal()` off a
`cachedClients` lookup by `_source`), reinforcing it at the actual point of commitment. The
prior blanket code comment above `expandedRowHTML()` was rewritten to explain the real
distinction rather than deleted. No `engine-core.js` changes — `resetClientPassword()`/
`resetClient2FA()` themselves are unchanged; this is UI-layer disclosure only. Syntax-checked
(inline scripts extracted and run through `node --check`); not browser-verified per this
project's standing verification policy for a low-risk, purely-additive, non-data-mutating UI
change — describe-and-let-the-user-check, not launch a browser unasked. See
`Marketswave_Project_Handover.md` §12.10 for the full writeup. Backend Requirements Register
row 69.

**Backend Migration — Phase A1: real Firebase identity against staging — COMPLETE** (Aug 26,
2026; Phase A2, real Cloud Functions on staging, BLOCKED on a Blaze plan upgrade — confirmed
live, not assumed, via the real Console still showing Spark). Introduces a THIRD Firebase
environment tier — `marketswave-staging`, a real, separate, persistent Firebase project, NOT
the same thing as "Marketswave SE" (the eventual real-production project) and not a one-off
testing detour. `firebase-config.js` now holds `EMULATOR_CONFIG`/`STAGING_CONFIG` side by
side, switched via an explicit `?env=staging` URL param on `signup.html`/`login.html` (chosen
over a persisted flag or a hand-edited constant specifically so it can never "stick" or be
accidentally left committed-on — see that file's own header comment) — its absence, which is
every existing habit including everything `golden-path-regression.js` does, stays on the
emulator, unaffected. `signup.html` branches at submit time: staging writes its own
`clients/{uid}` Firestore document DIRECTLY via the client SDK (`IS_STAGING` from
`firebase-config.js`) since there's no deployed Cloud Function yet, while the emulator path
keeps calling `createClientApplication` completely unchanged; `login.html` needed ZERO
changes — it was already Function-free, just a real Auth sign-in + a direct Firestore read.
New `firestore.staging.rules` (deployed for real via
`firebase deploy --only firestore:rules --project marketswave-staging --config
firebase.staging.json`) is what makes the direct client write safe: a signed-in client may
create EXACTLY their own document, `status` forced to literally `'pending_review'` (Firestore's
own create-vs-update classification means this can only ever fire once per uid), `email` must
match their real Auth token email and `accountType` must be a real valid value (both added
beyond the task's literal ask, mirroring validation the removed Cloud Function used to do
server-side, reported not smuggled in) — `allow update, delete: if false` unconditionally,
reserving every status change for privileged Admin SDK access. Two new scripts, deliberately
placed in `scripts/` (not `functions/`) since they're dev tooling, not deployed source:
`scripts/staging-bootstrap-admin.js` (creates/reuses the real staging PM account + its real
`{ admin: true }` claim) and `scripts/staging-approve-client.js` (an explicitly TEMPORARY
Admin-SDK stand-in for the real approve button Phase A2 will eventually provide). **Credential
handling, reported per instruction**: the staging service account key lives at
`C:\WorkDirectory\marketswave-secrets\` — structurally outside the repo (confirmed via
`realpath --relative-to`, not assumed), never referenced by path in any committed file, read
only via the operator-set `GOOGLE_APPLICATION_CREDENTIALS` env var; the staging PM account's
own password is, unlike the emulator's hardcoded one, generated randomly and shown once
rather than committed, since staging is a real cloud project. The real staging
`firebaseConfig` values themselves (apiKey/authDomain/etc., not secrets — see
`firebase-config.js`'s own comment) were obtained via the Firebase Management API
(`projects.webApps.getConfig`), authenticated with the service account, rather than asking the
user to paste them in. **Verified live end to end, the complete real chain, not from the code
alone**: a real applicant signed up through the actual 7-step `signup.html` form served
locally at `?env=staging` (real file uploads for both document steps — one CDP freeze hit and
resolved along the way, see `Marketswave_Project_Handover.md` §12.11 for the root cause,
`signup.html`'s own `showError()` calling native `alert()`) — confirmed a real Firebase Auth
user AND a real Firestore document **visually, in the actual Firebase Console** (not just a
script query, per explicit instruction), correct shape and `status: "pending_review"`;
real login while pending genuinely refused ("Your application is under review"); ran
`scripts/staging-approve-client.js` for real, confirmed `status: "active"` again in the
Console; logged in again — succeeded for real, landing on a genuinely empty ($0, zero
holdings) dashboard, proving the local `mirrorAuthenticatedClientLocally()`/
`setClientAuthenticated()` bridge works against a real staging identity, not just the
emulator's. Finally, restarted the LOCAL emulator from a clean state and re-ran
`golden-path-regression.js` completely unchanged — `GOLDEN PATH: PASS (16/16 steps)`,
confirming zero effect on local dev. See `Marketswave_Project_Handover.md` §12.11 and
`README.md`'s new "Staging Environment (Phase A1)" section for the full writeup. Backend
Requirements Register row 70.

**Product Descriptions + conditional Logo/More Info — VERIFIED (was already fully built, not
newly implemented; the verification and this write-up were what was actually missing)**
(Aug 27, 2026): a task asking to build `description`/`extendedDescription`/`logoUrl` on the
product schema plus admin form + client card support turned out to already be complete —
**confirmed by reading the live code before writing anything, per this project's own standing
rule, not assumed from the task's own framing.** `engine-core.js`'s schema/validation
(`PRODUCT_EDITABLE_FIELDS`, `validateProductFields()`, `addProduct()`/`editProduct()`) and
both `admin-products.html`'s conditional Add/Edit form fields and `asset-collection.html`'s
card rendering (logo box with `getClientInitials()` fallback, a real `<img>` `error` listener
degrading to initials rather than a broken-image icon, the "More info" modal, `flex-col`/
`mt-auto` CTA anchoring preserved) were all already present, dated Aug 23, 2026 in
`engine-core.js`'s own comments — but **never had a Tech Stack entry, a Backend Requirements
Register row, or (as far as could be determined) an actual verification pass**, which is what
this task closes. Ran every verification the task asked for, for the first time: **Node** (a
new 29-assertion script reusing `scripts/lib/engine-harness.js`, confirming existing seeded
products — which predate these fields entirely — round-trip cleanly with no `description`/
`logoUrl`/`extendedDescription` keys at all, `addProduct()`/`editProduct()` handle both
presence and absence correctly, non-string values are still rejected, and the `unitPrice`-edit
block still holds); **browser** (added a real Crypto product with a data-URI logo — rendered
correctly as a real ~28px logo image on `asset-collection.html`'s Crypto tab; edited Nordic
Growth Fund, a real seeded Private Equity product, to add both fields — "More info" correctly
revealed the extended description on both the Private Equity tab AND the "All" tab, since the
modal's click handler is delegated at the card-grid container level, not re-bound per filter;
confirmed a product with neither field set — European Real Estate Trust — degrades cleanly,
no description line, no "More info" link, nothing broken; confirmed the existing
initials-fallback behavior on two real seeded products with no `logoUrl`, "GE" for Global
Equity ETF and "ET" for Ethereum). Zero code changes were needed — every scenario passed
against the code exactly as it already stood. See `Marketswave_Project_Handover.md` §4.72 for
the full writeup. Backend Requirements Register row 71.

**Bug fix: sidebar hamburger icon overlapping header content on narrow/vertical viewports —
COMPLETE** (Aug 27, 2026): root-caused before fixing, per instruction — **confirmed via a real
narrow-viewport screenshot that this was a fixed-positioning/layout gap, not a z-index/
stacking issue** (this environment's `resize_window` tool doesn't move the real viewport,
re-confirmed this session — the same iframe technique row 64's own fix already established
was used again). Both `dashboard-sidebar.js`'s and `admin-sidebar.js`'s toggle buttons are
`fixed top-4 left-4 z-50 w-10 h-10` — correctly stacking above content by design, but nothing
underneath ever reserved space for that fixed footprint, so every page's header (duplicated
per-page, not part of either shared sidebar mount — same known structural pattern as the
notification bell before it was extracted) rendered its "Thursday / August 27..." date block
starting at a plain `px-8`, squarely inside the button's footprint on any viewport narrow
enough for the button to be visible (`lg:hidden`) — confirmed visually at 375px width, the
date text was genuinely hidden behind the opaque button, not just crowded. Fixed by changing
the one byte-identical `<header class="h-16 bg-white border-b border-slate-200 flex
items-center justify-between px-8">` opening tag — confirmed identical via grep before touching
anything — to `pl-16 pr-8 lg:pl-8` across all 24 pages that share it: the 10 client dashboard
pages (`dashboard.html`, `asset-collection.html`, `asset-performance.html`,
`high-yield-savings.html`, `transactions.html`, `documents.html`, `risk-management.html`,
`deploy-capital.html`, `settings.html`, `support.html`) and all 14 admin pages sharing the same
pattern — `admin.html` itself has the identical vulnerability, not out of scope just because
the task's own example ("date") was client-side language. `lg:pl-8` reverts to the exact
original padding at the breakpoint where the button is hidden, so desktop is pixel-identical
to before. Browser-verified at 375px width for both `dashboard.html` and `admin.html` — clean,
fully readable date text, no overlap — and re-confirmed at 1400px width that desktop layout is
completely unaffected. See `Marketswave_Project_Handover.md` §4.72 for the full writeup.

**Bug fix: Advisory Fee Rate is now genuinely global, not per-client — COMPLETE** (Aug 27,
2026, from the frontend audit's Top Findings #2): `admin-advisory-fee.html`'s copy always
claimed the rate was "Account-wide" / applied "across every client-facing page," but
`setAdvisoryFeeRate()` actually wrote to the AMBIENT current client's own scoped
`accountState.advisoryFeeRate` — confirmed directly in `engine-core.js` before writing any
fix. Fixed the real behavior, not just the copy (the copy turned out to already be accurate
once the behavior matched it, so it needed no rewrite — only the stale badge next to it, see
below). New genuinely-global store, `marketswave_advisory_fee_rate` (same category as
`CATALOG_KEY`/`CLIENTS_KEY` — unscoped, one value for the whole platform).
`setAdvisoryFeeRate()`/`getAdvisoryFeeRate()` (new getter) now read/write this key directly;
`getAdvisoryFeeAccrued()` combines the global rate with the CURRENT client's own
`allocatedCapital` — the rate is platform policy, the accrued dollar amount is still correctly
per-client. `advisoryFeeRate` removed from all 3 places it used to live in the per-client
account-state shape (`buildSeedData()`, `readAccountStateForClient()`'s default,
`seedMinimalClientStores()`) — existing clients' already-stored copies of the old field are
left in place as harmless, unread vestiges rather than actively stripped out, matching this
project's "don't manufacture cleanup machinery" precedent. **Migration, reported per
instruction**: a one-time `migrateAdvisoryFeeRateToGlobal()` (same idempotent pattern as
`migrateLegacyUnscopedKeysToClient0001()`) scans every real client's own pre-existing rate on
first load after this fix — **this machine's real browser data was checked directly before
deciding the approach** (both real clients here, CLIENT-0001 and the real Firebase-staging
client from Phase A1, agreed at 1.25%, so there was no actual divergence to ask about); if
every client agrees, that value becomes the new global rate automatically (an unambiguous
answer, nothing to ask); if clients' rates ever genuinely diverge (only possible if different
clients were ambient during different past edits — not this machine's actual case, but the
function still handles it correctly for any other install), the migration does NOT silently
pick one — it falls back to the platform default (1.25%) and logs every divergent value found
via `console.warn`, so the discrepancy stays visible rather than being quietly discarded.
`admin.html`'s Overview card and `transactions.html`'s Advisory Fee card both switched from
reading `getAccountState().advisoryFeeRate` (now `undefined`) to the new `getAdvisoryFeeRate()`.
Node-verified first (16 assertions: fresh-install default, migration writing the global key,
a full set-while-CLIENT-0001-is-ambient → reload-as-a-different-client → confirm-same-rate
round trip proving the core "genuinely global" property, a uniform-pre-existing-rates
migration scenario, a genuinely-divergent-rates migration scenario confirming the documented
fallback fires and warns rather than crashing, and existing input validation still holding)
then browser-verified live: changed the rate to 3.33% from `admin-advisory-fee.html` while
CLIENT-0001 was the ambient admin session, then loaded `transactions.html` AS the real
Firebase-staging client (`setClientAuthenticated()`, a genuinely different client) and
confirmed its own Advisory Fee card showed 3.33% too — the exact cross-client proof the task
asked for. Reset back to 1.25% afterward, since this is now real persistent platform state,
not a scoped-to-one-client demo artifact. See `Marketswave_Project_Handover.md` §4.73 for the
full writeup. Backend Requirements Register row 73.

**Bug fix: removed the stale "No login gate — internal preview build" badge from all 14
admin pages — COMPLETE** (Aug 27, 2026, from the frontend audit's Top Findings #3): the badge
predates the real Admin Login Gate (§4.62, Aug 21, 2026) and had been contradicting real,
working authentication ever since — grep-confirmed (not assumed from a partial list) it
appeared byte-identically on all 14 admin HTML files (`admin.html`, `admin-clients.html`,
`admin-client-applications.html`, `admin-deposits.html`, `admin-withdrawals.html`,
`admin-allocations.html`, `admin-sells.html`, `admin-hys.html`, `admin-profile-updates.html`,
`admin-documents.html`, `admin-support.html`, `admin-advisory-fee.html`,
`admin-security.html`, `admin-products.html`) and removed from all 14 — a second grep pass
afterward confirmed zero remaining occurrences anywhere in the project except
`FRONTEND_AUDIT.md`'s own historical record of the finding, correctly left untouched. **On
whether a replacement visual marker is needed** (the task's own question, left as a judgment
call): concluded no — every admin page already carries both the persistent slate sidebar's
"MARKETSWAVE **PM**" wordmark (confirmed in `admin-sidebar.js`) and the persistent red
"INTERNAL TOOL — PORTFOLIO MANAGER ACCESS ONLY — NOT THE CLIENT-FACING SITE" banner, both
unmissable and present on every single admin page with no exception — between the two, "this
is the PM tool" is already fully and unambiguously communicated; the removed badge was
specifically about AUTHENTICATION STATUS (a claim that's simply now false), not general
tool-identity, so no replacement was needed for that narrower purpose. Syntax-checked (every
inline `<script>` block across all 14 files, plus `engine-core.js` itself, run through
`node --check`, 0 errors); not independently browser-screenshotted per-page beyond the two
pages already covered live for the advisory-fee fix above, since this change is a pure,
mechanically-verified markup deletion with no logic behind it. See
`Marketswave_Project_Handover.md` §4.73 for the full writeup. Backend Requirements Register
row 74.

- **HYS pocket withdrawal — a 6th Approval Gate queue, closing a real architectural gap**
  (`engine-core.js` + `high-yield-savings.html` + `admin-hys.html` + `admin-sidebar.js` +
  `admin.html` + `transactions.html` + `dashboard.html`, Aug 27, 2026, from the frontend
  audit): `finalizeWithdrawal()` previously executed a client's HYS pocket withdrawal
  immediately, client-side — no approval gate, no transaction-ledger entry, unlike every
  other money-moving flow in this project. **Investigated and reported before writing any
  fix, per instruction**: confirmed this was the more serious of two possible bugs — the old
  code had zero paths touching `unallocatedCapital`/account state at all, so a withdrawal
  left no evidence anywhere outside the pocket record itself. **A real conflict between the
  task's own literal wording ("credit unallocatedCapital correctly") and `creditHYSDeposit()`'s
  own established design (HYS deliberately never touches `unallocatedCapital` — it's funded
  externally, "its own pool") surfaced mid-investigation and was resolved via a direct
  question to the user rather than silently decided either way — the user chose the symmetric
  external-payout option**, so approved HYS withdrawals record a real transaction for
  visibility but do NOT touch `unallocatedCapital`/`allocatedCapital`, mirroring
  `creditHYSDeposit()`'s own never-touches-the-main-pool rule; the task's own VERIFY wording
  ("confirm unallocatedCapital increased correctly") is superseded by this choice and should
  be read as confirming it's correctly left unchanged. New `requestHYSWithdrawal(clientId,
  pocketId, method, destinationDetails)`/`approveHYSWithdrawal(clientId, requestId)`/
  `rejectHYSWithdrawal(clientId, requestId, reason)`, built stateless-per-call/explicit-
  `clientId` from the start — the demonstrably correct pattern from "Approval Gate
  unification" rather than `requestHYSDeposit()`'s own older ambient one, since this is new
  code written today with that lesson already learned. New parallel store,
  `marketswave_hys_withdrawal_requests` (not an extension of the deposit or main withdrawal
  stores — the field shapes genuinely differ). New `computeHYSWithdrawalAmount(pocket)` is
  now the single source of truth for the forfeiture/receive-amount calculation, replacing a
  client-side duplicate — mirrors the `getHYSRate()` single-source-of-truth precedent (row 34)
  rather than leaving two copies that could drift. `requestHYSWithdrawal()` validates the
  pocket exists, isn't already withdrawn, isn't a still-active locked-term deposit (a real
  engine-level guard added beyond the literal ask — the UI already hides the button in that
  case, but nothing previously stopped a direct call), and has no other request already
  pending against it. `approveHYSWithdrawal()` re-validates against the pocket's CURRENT
  state (not the request-time snapshot, mirroring `approveSellRequest()`'s own re-validation
  discipline), marks the pocket `withdrawn`, and appends a new `HYS_WITHDRAWAL`
  transaction-ledger entry — proactively wired into `transactions.html`/`dashboard.html`'s
  consumers (`txnProductName()`/`txnTypeLabel()`, Type filter, badge color, drill-down modal,
  Recent Activity on both pages, excluded from the monthly volume chart matching
  `HYS_DEPOSIT`'s own exclusion) before any UI could produce one, avoiding a repeat of the
  "Capital allocated — null" bug class this project has hit before. Client side:
  `high-yield-savings.html`'s Withdraw flow now calls `requestHYSWithdrawal()` instead of
  mutating the pocket directly; "My Pocket Requests" was rebuilt to merge
  `getHYSDepositRequests()`/`getHYSWithdrawalRequests()` into one table with a new Kind
  column (purple Deposit / amber Withdrawal badges). Admin side: `admin-hys.html` extended
  (not duplicated into a new page) with a separate, clearly-labeled "Withdrawal Requests"
  section (own Pending/History) below the existing "Deposit Requests" section — **the chosen
  approach, reported per instruction**, over a merged table, since the two request shapes
  (`receiveAmount`/`forfeit` vs. `requestedAmount`/`creditedAmount`) differ too much for a
  clean single-table merge; the Approve modal is a pure confirm (no PM-editable amount — the
  receive amount is a deterministic calculation, not real-world settlement uncertainty) whose
  copy explicitly states "This does not affect Unallocated Capital — High Yield Savings is
  its own pool, funded and paid out externally." Page/nav renamed "HYS Deposits &
  Withdrawals"; `admin.html`'s Overview gained a separate "Pending HYS Withdrawals" card
  (not merged into the existing HYS Deposits count, matching how the main portfolio's own
  Deposits/Withdrawals stay two separate cards). Node-verified first (44 assertions,
  including the AYW/forfeit/matured/locked-term/duplicate-pending/re-validation-at-approval
  cases, and an **explicit two-directional per-domain cross-client isolation test — same
  rigor as every other Approval Gate domain** — funding and resolving a real withdrawal for a
  second client while CLIENT-0001 stayed ambient throughout, then diffing raw storage
  byte-for-byte in both directions, with an explicit check that the target client's own data
  genuinely changed so the isolation check isn't vacuous). **"Full regression suite," disclosed
  honestly**: this project's historical per-phase Node scripts are scratchpad-only and don't
  persist across sessions, so the new 44-assertion script is the regression check for this
  change; the one persistent script, `scripts/golden-path-regression.js`, exclusively
  exercises the unrelated Firebase Auth/Firestore hybrid signup-login flow and requires the
  emulator, which wasn't running — starting it wouldn't have meaningfully re-verified this
  pure-`localStorage` change, so it was not run, rather than silently assumed passing.
  Browser-verified live end to end: a real $5,000 AYW withdrawal request submitted through
  `high-yield-savings.html`'s actual Withdraw modal did NOT execute immediately (pocket stayed
  Active at its full balance; the new request appeared in My Pocket Requests as Pending);
  approved from the real `admin-hys.html` UI (confirm-modal copy verified correct); confirmed
  via direct engine/storage inspection that the pocket is genuinely `withdrawn`, a real
  `TXN-0006` `HYS_WITHDRAWAL` transaction landed in the ledger, and
  `unallocatedCapital`/`allocatedCapital` are exactly unchanged from their pre-request
  baseline — the confirmed "symmetric external payout" design holding in a real browser, not
  just Node. Confirmed correct rendering on `transactions.html` (Recent Activity, ledger
  table's "—" quantity/price guard, drill-down modal, Type filter) and `dashboard.html`'s
  Recent Activity, with Total Portfolio Value correctly unaffected throughout. Zero console
  errors, confirmed via a fresh reload. See `Marketswave_Project_Handover.md` §4.74 for the
  full writeup. Backend Requirements Register row 75.

- **Two fixes for fabricated data presented to clients as if real** (`support.html` +
  `settings.html`, Aug 27, 2026): both reports pointed at the same underlying problem — data
  a client would reasonably read as genuine account history/state that was actually hardcoded
  demo content with no disclosure. **Fix 1 — `support.html`'s fabricated seed tickets**:
  `requests = Array.isArray(stored) && stored.length ? stored : SEED.slice()` meant a client's
  own scoped `marketswave_support_requests` being empty (true for every client created since
  the multi-client model shipped) silently fell back to a 3-item `SEED` array of fake tickets
  (`TCK-1042`/`DSP-2077`/`TCK-1055`, complete with fabricated dates/evidence filename/
  descriptions) — the real empty state (`#requests-empty`, already correctly implemented)
  had been genuinely unreachable in practice. Fixed by deleting `SEED` and both its fallback
  call sites (confirmed via grep these were its only two references) —
  `requests = Array.isArray(stored) ? stored : []`, same on a parse failure. No change to
  `renderRequests()`/`buildRequestRow()`/dispute submission; confirmed
  `getAllClientSupportRequests()` (the admin-side aggregator) reads the same raw key directly
  with no seed fallback of its own, already unaffected. **Fix 2 — `settings.html`'s fabricated
  Active Sessions**: "Active Sessions & Linked Devices" showed 3 hardcoded rows — the real
  browser plus two entirely fake devices ("Safari on iPhone," "Chrome on MacBook Pro") each
  with a fabricated city and timestamp, with nothing distinguishing real from fake, and every
  "Log out" button (including "Log out all other sessions") only removed the DOM row rather
  than doing anything real. **Took the recommended approach, not silently substituted**: the
  section now shows ONLY the current real session — the one thing genuinely knowable
  client-side — with a visible, honest note that full session history across other devices
  isn't available yet. Device/browser derived from the real `navigator.userAgent` via a small
  self-contained parser kept local to this page (Edge/Opera checked before Chrome, Chrome
  before Safari, since their UA strings nest) — approximate but genuinely real, never
  invented; city/location dropped entirely rather than faked, since real geolocation needs a
  genuinely external geo-IP source, the same category as live market data/currency rates in
  CLAUDE.md's own Deferred section. Status defaults to "Active now" and upgrades to a real
  `lastSignInTime`-based "signed in <time>" only when a genuine Firebase Auth session is
  present, read via a best-effort dynamic `import()` mirroring `dashboard-sidebar.js`'s own
  real `signOut(auth)` pattern exactly (including waiting for one `onAuthStateChanged`
  callback first, avoiding the same pre-hydration race that pattern's own comment already
  documents) — failing silently back to "Active now" if Firebase is unreachable or this
  session wasn't established through a real Firebase sign-in, never blocking the page or
  fabricating a value with nothing real behind it. Both fake rows' "Log out" buttons and "Log
  out all other sessions" were removed outright, not left disabled (a disabled-but-present
  control would itself be a small dishonesty). Node-verified first for Fix 1 (16 assertions,
  `verify-support-empty-state.js`, loading the REAL `engine-core.js` and the REAL
  `support.html` "My Requests" IIFE source — extracted verbatim, not retyped — against a
  minimal fake DOM built for this IIFE's own narrow DOM usage, mirroring this project's
  established Node-verification pattern): a fresh client with no stored key at all, and one
  with an explicit real empty array, both see the real empty state; corrupted JSON fails safe
  to `[]` not the old seed; a client with real history renders exactly that with zero
  fabricated tickets mixed in; a two-directional cross-client isolation check confirms one
  client's real empty state is unaffected by another's real data. Browser-verified live for
  both fixes: created a genuine new client (`CLIENT-0002`, confirmed via direct storage
  inspection to have no support-requests key at all) and confirmed Support genuinely shows
  "0 requests"/the real empty-state copy, not the old fake tickets — re-confirmed the same fix
  holds for `CLIENT-0001` too; submitted a real dispute and confirmed it renders correctly on
  its own (`DISP-0001`, "1 request"), proving the fix didn't disturb real submission; on
  Settings, confirmed the section renders exactly one row ("Chrome on Windows," "This device,"
  "Active now") with both fake devices/cities gone and the honest note visible, and confirmed
  the Firebase dynamic-import path resolves gracefully to the plain fallback rather than
  hanging or throwing when no real Firebase session is present (the actual state during this
  dev-bypass verification). The verification-only client and test dispute were removed
  afterward, restoring the real single-client baseline. Zero console errors on a fresh reload
  for both pages. See `Marketswave_Project_Handover.md` §4.75 for the full writeup. Backend
  Requirements Register rows 76-77.

- **Bug fix: sidebar Documents badge genuinely computed on every page, not hardcoded on 9 of
  10** (`dashboard-sidebar.js` + `documents.html`, Aug 27, 2026, closing a dedicated
  investigation-only task's finding): a prior diagnosis-only task (no code changes, no
  register row) found that `documents.html`'s user-reported "fake/disconnected" notifications
  were actually two separate things — the audit-known chip flash (real but genuinely minor,
  self-healing every load, left untouched) and a second, deeper, previously-uncaught issue:
  `#sidebar-doc-badge` was hardcoded to a static `"2"` in `dashboard-sidebar.js`'s
  `navLinkHTML()`, with the file's own comment stating only `documents.html`'s own script ever
  corrected it — meaning every OTHER client-facing page showed that fake `"2"` for the ENTIRE
  page visit, not a flash. Invisible on a fresh install only because the seed data's real
  `urgentCount` also happens to equal 2 by coincidence; exposed the moment any real document
  state changed. Fixed exactly as directed: `initDashboardSidebar()` now calls the real
  `getDocumentNotificationCounts()` (the same function `documents.html`'s own correction and
  the notification bell already use) before building the nav HTML, baking the real count
  directly into the initial HTML string — genuinely better than the old flash-then-correct
  pattern, since there's no flash at all on the 9 non-documents pages now. Correct
  hidden-when-zero behavior added too. Falls back to `0`/hidden, never a fake nonzero value,
  if the engine function is unavailable. **Judgment call, decided and reported per
  instruction**: `documents.html`'s own existing badge-correction logic was KEPT, not removed
  as redundant — confirmed by direct testing that it's genuinely NOT redundant, since the
  shared component only computes the badge once at mount time and has no way to react to a
  mutation (sign/upload/remove) made without leaving the page; `documents.html`'s own logic
  remains the only thing providing a live in-page update after such a mutation. Both files'
  comments were rewritten to describe this division of labor rather than either implying it's
  the sole source of truth. Node-verified first (14 assertions, `verify-sidebar-doc-badge.js`,
  loading the REAL `dashboard-sidebar.js` and REAL `engine-core.js` source in their actual
  script-tag order against a minimal fake DOM): fresh-seed `urgentCount` baked directly into
  the initial HTML (no flash); **the exact bug scenario** — mutate a document, then mount a
  DIFFERENT page against the same storage — now shows the correct new count, not the old fake
  "2"; zero-count hides the badge; a missing engine function falls back to a hidden 0, never
  crashing or showing a fake value; two-directional cross-client isolation confirmed. Browser-
  verified live, the complete scenario: signed the seeded document via console WITHOUT ever
  visiting `documents.html`, navigated directly to `dashboard.html` — one real environment
  gotcha hit and resolved (a stale browser-cached copy of the pre-fix script from an earlier
  verification session, this project's own previously-documented caching pitfall; a hard
  reload resolved it) — confirmed the badge correctly read "1," not the old fake "2," and
  confirmed the identical correct value across all 10 client-facing pages including
  `documents.html` itself. Confirmed `documents.html`'s own live in-page update still works
  (a real Download action flipped a document's `isNew` off and the sidebar badge disappeared
  live, no reload — direct proof the "keep, don't remove" call was correct). Confirmed the
  notification bell's own, intentionally-different unread count is completely unaffected: a
  document with both a new AND a signature-required trigger showed sidebar badge "1"
  (doc-level) while the bell simultaneously and correctly showed "2" (item-level), both live
  and both correct by their own separate rules. All test mutations reverted, restoring
  CLIENT-0001's real document state to the exact original seed baseline. Zero console errors.
  See `Marketswave_Project_Handover.md` §4.76 for the full writeup. Backend Requirements
  Register row 78.

- **Bug fix: real Firebase-signup clients now start with a correct empty baseline, not
  CLIENT-0001's fake seed** (`engine-core.js`, Aug 27, 2026, closing a dedicated investigation
  task's finding): `mirrorAuthenticatedClientLocally()` — the function `login.html`'s real
  Firebase Auth success path calls for every real signup-created client — never called
  `seedMinimalClientStores()` the way `addClient()` (the local/admin path) always has, so a
  real new client's first real page load fell through to the ambient module-level "load or
  seed" fallbacks and inherited CLIENT-0001's fake demo content. **Full scope investigated and
  reported before any fix, per instruction**: confirmed via a real reproduction of the exact
  `login.html` call chain that the SAME bug affects `accountState`+`holdings` (Total Portfolio
  Value `$1,284,500`, 4 holdings, `$205,520` unallocated — CLIENT-0001's exact numbers, not a
  fresh account's), not just documents; checked and confirmed `transactions`/allocation/sell/
  deposit/HYS-deposit requests are NOT affected, since each defaults cleanly to `[]` regardless
  of pre-seeding; found and explicitly flagged as separate, NOT folded in, a related but
  different gap — `getSettingsProfile()`'s "John A. Doe" fallback affects every new client
  equally regardless of creation path, since neither path seeds it, so it's not a divergence
  this fix's framing covers. **Fix, exactly as directed**: reuses `seedMinimalClientStores()`
  directly (the same function `addClient()` already calls, not a duplicate — the
  `getHYSRate()`/`computeHYSWithdrawalAmount()` precedent) but ONLY on a client's genuinely
  first mirror (`idx === -1`, already computed by the function's own upsert logic) — critically
  NOT on every login, since `mirrorAuthenticatedClientLocally()` runs on every sign-in and an
  unconditional reseed would wipe a returning client's real accumulated data. Verified directly,
  not just reasoned about: a real returning client's real deposit + real uploaded document
  survive a genuine second mirror call byte-for-byte unchanged. **Repair path, searched
  thoroughly, reported honestly**: checked every locally-reachable browser origin this project's
  tooling has used (8765, 5000, 8000, 3000) — all show only the deterministic CLIENT-0001
  bootstrap, no Firebase-uid client anywhere. Queried the REAL staging Firestore directly via
  the Admin SDK (authoritative, independent of any browser) and found exactly one real client —
  the same "Staging Test Client" from Phase A1's own §12.11 verification — not present in any
  checked local browser storage. Conclusion stated plainly: no currently-reachable local state
  to repair on this machine right now, not a false "confirmed clean" claim; the fix will
  correctly seed this or any real client fresh the next time they genuinely log in anywhere.
  Node-verified first (21 assertions, `verify-mirror-seeding-fix.js`): first-mirror seeding
  happens immediately and correctly; the exact bug scenario now shows `$0`/0 holdings/0
  documents; **the critical regression guard** — a real returning client's data is provably
  untouched by a second mirror; CLIENT-0001 and `addClient()`-created clients are both
  unaffected; cross-client isolation holds. Browser-verified live, twice, against two
  independently-created real Firebase Auth users + real Firestore documents on real staging (the
  emulator wasn't running): confirmed the correct empty baseline on real `dashboard.html`
  ("$0," correct name/initials, "No recent activity yet.") and real `documents.html` ("0 New
  Documents," "No documents match your filters.") for both. **One real environment issue
  diagnosed and resolved, not silently worked around**: the real login form's submit button
  consistently failed via this environment's coordinate-based CDP click even though every
  underlying function was separately confirmed correct — dispatching a genuine `submit` event
  directly succeeded immediately, isolating this as a browser-automation click-targeting quirk,
  not an application defect. Confirmed CLIENT-0001 and a fresh admin-created client both
  completely unaffected. All test artifacts (both real Firebase users, their Firestore docs,
  local mirror data on every checked origin) deleted afterward, restoring staging and every
  local origin to their exact pre-verification baseline. Zero console errors. See
  `Marketswave_Project_Handover.md` §4.77 for the full writeup. Backend Requirements Register
  row 79.

- **Bug fix: `getSettingsProfile()`'s "John A. Doe" fallback closed for every new client**
  (`engine-core.js`, Aug 27, 2026, closing the gap flagged by the previous fix): **investigated
  first, per instruction** — confirmed "John A. Doe" is a hardcoded literal inside
  `REQUESTABLE_SETTINGS_DEFAULTS` (`engine-core.js:413-417`, alongside a fake Boston address
  and a fake "Passport" ID doc), read by `getSettingsProfile()`'s per-field fallback
  (`:2164-2172`) — but the reason every new client sees it is the SAME root cause as the
  accountState/holdings/documents fix: no function has ever written a real profile at creation
  time, on either creation path. Also found `settings.html`'s own separate inline
  `DEFAULTS = { email: 'john.doe@example.com', phone: '+1 (415) 555-0182' }`
  (`settings.html:552`) reads the IDENTICAL shared `marketswave_settings_profile` key — closing
  one fix closes both fallbacks. **Fix, exactly as directed**: `seedMinimalClientStores()` (the
  same function already reused for accountState/holdings/documents, already called by both
  `addClient()` and `mirrorAuthenticatedClientLocally()` on first creation/mirror) now also
  writes a real settings profile. New `splitClientLegalName(name)` helper reuses
  `getClientInitials()`'s own `LEGAL_ENTITY_SUFFIXES` filtering so "Riverstone Holdings LLC"
  splits as firstName "Riverstone"/lastName "Holdings," not a bare "LLC" — deliberately mirrors
  an existing precedent rather than new logic; a single-word name degrades to an honest empty
  firstName, not a crash. **Exact field sourcing, reported per instruction**: `legalName` —
  real, split from the client's own `name`, already known on both paths (signup form / Add
  Client form); `email`/`phone` — the real values already on the same client record, written
  directly; `address`/`idDocument` — seeded as real `null`, NOT fabricated, since neither
  creation path has real address/ID-document data at this moment (a real signup's own document
  uploads land in the separate `ONBOARDING_KEY` store, not here) — `null` renders cleanly as
  "—" via `formatFieldDisplay()`'s existing `if (!value) return '—'`, zero display-side changes
  needed. Both call sites updated minimally (`newClient`/`record`, already in scope); the new
  third parameter is optional, defaulting to a genuinely blank (not fake) profile for any
  pre-existing bare-2-arg caller. **Same regression discipline as the prior fix, verified with
  its own dedicated test, not assumed to carry over**: the "only on first mirror" guard already
  covers this for free (same call, same `isFirstMirror` gate), confirmed directly — a real
  self-edited profile survives a second mirror byte-for-byte unchanged. CLIENT-0001 correctly
  has no profile ever written by this fix and still falls back to the legacy default exactly
  as before — the correct behavior for the one client that genuinely predates any seeding
  mechanism, so `REQUESTABLE_SETTINGS_DEFAULTS` itself was deliberately left unchanged.
  Node-verified first (19 assertions, `verify-settings-profile-seed.js`): both paths seed a
  real profile immediately; "Marcus Chen" and legal-suffix-aware "Riverstone Holdings LLC"
  both split correctly; a single-word name degrades honestly; **the critical regression
  guard** — a returning client's real edit survives a second mirror unchanged; CLIENT-0001
  still falls back correctly; the bare-2-arg path seeds blank, not fake, without crashing.
  Full prior regression suite re-run to confirm the signature change introduced no regression
  (`verify-mirror-seeding-fix.js` 21/21, `verify-sidebar-doc-badge.js` 14/14). Browser-verified
  live for BOTH creation paths: a real admin-created client ("Priya Sharma") immediately showed
  her real name/email/phone and clean "—" for Address/ID-Document; a genuinely new real
  Firebase client ("Diego Fernandez Ruiz," a 3-word compound name against real
  `marketswave-staging`, logged in through the real form's own submit event) showed the
  identical correct result with the compound-name split landing correctly
  (`firstName: "Diego Fernandez"`, `lastName: "Ruiz"`); confirmed the Address "Request Change"
  modal renders the `null` current value cleanly as "—" with blank, uncorrupted inputs, no
  crash, no "undefined" text. Both test artifacts deleted afterward, restoring staging and
  local storage to their pre-verification baseline. Zero console errors on both runs. See
  `Marketswave_Project_Handover.md` §4.78 for the full writeup. Backend Requirements Register
  row 80.

- **Bug fix: `ensureAdminSignedIn()` now works against real staging via a runtime password
  prompt, never a hardcoded/committed credential** (`admin-firebase-config.js` +
  `admin-client-applications.html` + `admin-clients.html`, Aug 27, 2026, closing a dedicated
  diagnosis task's finding): `ensureAdminSignedIn()` always attempted the emulator's hardcoded
  bootstrap PM credential regardless of which real Firebase project the page was connected to
  — correctly staging-aware for the CONNECTION (via `firebase-config.js`'s own `IS_STAGING`),
  not for the sign-in credential, so any admin page loaded with `?env=staging` failed at the
  Auth step with `auth/invalid-credential` before any Firestore read was attempted. **Fix,
  exactly as directed**: branches on `IS_STAGING` — emulator path byte-for-byte unchanged;
  staging path signs in as the real `pm@marketswave-staging.internal` (safe to reference
  directly, per `scripts/staging-bootstrap-admin.js`'s own header) with a password obtained at
  runtime via a small modal matching the admin tool's existing styling (copied from
  `admin-client-applications.html`'s own approve/reject modals), never hardcoded or committed
  anywhere — dynamically injected into `document.body` on first use, mirroring
  `dashboard-sidebar.js`/`dashboard-notifications.js`'s own "shared component injects its own
  markup" precedent. `setPersistence(auth, inMemoryPersistence)` on the staging branch only —
  required, not just "the password isn't written anywhere": Firebase's own DEFAULT
  persistence would otherwise silently restore the session across a refresh via its own
  IndexedDB, with zero app code writing anything itself, violating "a page refresh should
  re-prompt." A wrong password shows a clear inline error and loops for another attempt;
  Cancel rejects and explicitly resets the cached `signInPromise` so a later retry isn't
  permanently locked out. **A real bug caught by this task's own Node verification, not
  shipped**: the retry loop originally cleared the modal's inline error at the TOP of every
  reopen — since a wrong-password catch reopens the same function on its next loop iteration,
  this raced the error being shown at all, hiding it again before any real render, a same-tick
  bug a screenshot taken even seconds later would never catch. Fixed by moving the
  error-clearing into `onSubmit()`, firing only when a genuinely new attempt begins. **A
  second, related toast bug found and fixed "while in these files," not narrowly scoped to
  one**: grepped both admin pages using `ensureAdminSignedIn()` and found the identical
  4-second auto-hide on both "Could Not Load Firebase Applications" and "Could Not Load
  Firebase Clients" — a genuine failure could fade before a PM registered it, reading as a
  silent "just shows empty" state (the exact symptom the whole investigation chain started
  from). Fixed with a new, deliberately SEPARATE `sticky` 4th param on `showToast()` in both
  files — NOT reusing `isError`, since that flag is also used purely for red styling on a
  genuine SUCCESS confirmation ("Application Rejected") in one of the files, and overloading
  it would have wrongly made that routine confirmation sticky too, a real regression caught
  before shipping. Sticky toasts get a manual-dismiss close button instead of auto-hiding;
  every other call site is unchanged. Node-verified first (24 assertions, loading the REAL
  `admin-firebase-config.js` unmodified via a custom ESM loader hook redirecting only its two
  external import specifiers to local instrumented mocks, with genuinely functional
  `localStorage`/`sessionStorage` stand-ins so a real `.setItem()` call would be directly
  observable): emulator branch untouched; staging branch calls `setPersistence` correctly,
  never attempts emulator credentials, passes the exact collected password through unaltered;
  wrong-then-correct password succeeds within one flow (exactly 2 real attempts, proving
  genuine retry); Cancel-then-retry proves `signInPromise` was reset; and zero storage writes
  occur across a full successful flow that DID carry a real password through the real
  sign-in call (confirmed non-vacuous). Browser-verified live against REAL
  `marketswave-staging`, with the user's own explicit involvement at two points, reported in
  full: rotating the real admin's password myself via Admin SDK was correctly blocked by the
  auto-mode permission classifier as a sensitive credential action; the user chose to supply
  the real password directly, which turned out to be stale (confirmed via a raw SDK call
  bypassing the modal, isolating a genuine Firebase rejection rather than a bug); only after
  the user's own explicit "do it" was the real password reset via the Admin SDK to a fresh
  random value, which the user now has. With the corrected password: the modal appeared
  correctly, a wrong password showed a persistently-visible error (re-confirming the
  Node-caught race fix holds in the real browser), the correct password signed in for real and
  the page's own real fetch flow loaded 2 real pending Firestore applications — including one,
  "Manuel Stormare," not created by this task (confirmed via its own pre-existing local
  per-client keys, proving a real prior signup+login) — left completely untouched, only
  reported to the user, never acted upon. A full refresh genuinely re-prompted, confirmed
  twice. Direct inspection of every `localStorage`/`sessionStorage` key confirmed the real
  password appears nowhere; the one pre-existing key containing the word "password" was
  traced directly to CLIENT-0001's own unrelated `passwordHash` field from a completely
  separate, already-shipped local credential system. Re-verified independently on
  `admin-clients.html` too — real clients loaded, zero console errors. The one local test
  application record created for this verification was deleted afterward; the real "Manuel
  Stormare" application and the pre-existing "Staging Test Client" record were both left
  exactly as found. See `Marketswave_Project_Handover.md` §4.79 for the full writeup. Backend
  Requirements Register row 81.

- **Bug fix: `?env=staging` now survives every internal navigation, not just the login->
  landing redirect** (`admin-login.html` + `admin-sidebar.js` + `login.html` +
  `dashboard-sidebar.js` + `signup.html`, Aug 27, 2026, the third bug in this same
  investigation chain): reported symptom — `admin-login.html?env=staging` → successful login
  → landed on plain `admin.html`, silently reverting to the emulator and reproducing the exact
  network error already diagnosed twice. **Grepped the whole project for every redirect, per
  instruction, not just the one named**: found 9 JS-driven `location.href`/`location.replace`
  sites (`admin-login.html`; `admin-sidebar.js` ×3 — file-load-time gate, `initAdminSidebar()`'s
  defense-in-depth guard, Log Out; `login.html`; `dashboard-sidebar.js` ×3 — the mirror-image
  client-side pattern; `signup.html`), every one built as a bare relative path with zero
  query-string awareness. Separately found a SECOND, distinct failure mode a redirect-only fix
  would have missed: every plain `<a href>` link — both shared sidebars' own rendered nav and
  each page's own hardcoded static links (most visibly `admin.html`'s 13 Overview cards) —
  dropped the param the instant a PM clicked anywhere, no redirect involved. **Fix**: new
  `currentEnvQuery()` helper (duplicated in `admin-sidebar.js`, `dashboard-sidebar.js`, and
  inline in the 3 pages that load neither shared file — matching this project's established
  small-disclosed-duplication precedent) appended to all 9 redirect targets. For the
  link-dropping half, rather than hand-threading every individual `href` (the exact single
  point of failure that caused the original bug), a new `preserveEnvParamInPageLinks()` in
  both shared sidebar files does ONE generic pass over every `<a href>` on the page — covering
  the sidebar's own rendered nav AND each page's own static links simultaneously, zero
  per-page changes needed now or ever. Called once at the end of
  `initAdminSidebar()`/`initDashboardSidebar()`, after the sidebar markup is injected. Logout
  deliberately included, not treated as an environment "reset" — confirmed a real functional
  consequence, not just cosmetic: `dashboard-sidebar.js`'s own real `signOutOfFirebaseAuth()`
  reads `IS_STAGING` fresh from the CURRENT page's URL at the moment Logout is clicked, so a
  lost param there would have made a real staging sign-out incorrectly target the emulator
  instead, leaving the real staging session still live. Browser-verified live against REAL
  `marketswave-staging`, the exact failing scenario, on both sides: admin login → confirmed
  `admin.html?env=staging` (not bare `admin.html`); confirmed all 27 links on that page
  (14 sidebar + 13 Overview cards) correctly carry the param; clicked into Client
  Applications — the page that used to show the network error — confirmed it now correctly
  shows the real Staging Admin Sign-In modal and, after signing in, loads real Firestore data;
  clicked through Deposits → Allocations → Product Catalog → Client List confirming the param
  survives every hop, not just the first; Log Out confirmed redirecting to
  `admin-login.html?env=staging` with a genuinely cleared session. Repeated identically on the
  client side: real login through `login.html?env=staging`'s own form landed on genuine
  `dashboard.html?env=staging`; all 9 sidebar/footer/Deploy Capital/Logout links correctly
  carried the param; real Logout redirected to `login.html?env=staging`. One real
  automation-environment artifact disclosed: this browser tool's tab-context trailer can
  report a stale, mid-transition URL immediately after a click, before real navigation
  finishes — several apparent contradictions during testing traced directly to this lag,
  confirmed by re-checking a moment later, ruled out rigorously rather than assumed away. Zero
  console errors throughout, both sides. All real test artifacts deleted afterward; "Manuel
  Stormare" and "Staging Test Client" left completely untouched. See
  `Marketswave_Project_Handover.md` §4.80 for the full writeup. Backend Requirements Register
  row 82.
- **Four small, independent cosmetic fixes from the frontend audit** (Aug 27, 2026, rows
  83-86): checkpointed and browser-verified individually. **Dead footer links** (row 83): the
  6 real marketing pages (`index.html`, `services.html`, `resources.html`, `about.html`,
  `legal.html`, `contact.html`) each had a byte-identical, unwired `<li><a href="#">Get
  Access</a></li>` footer link, visually identical to the real, working header "Get Access"
  button/modal but with no id or handler — fixed by giving both a shared
  `.get-access-trigger` class and switching each page's modal script to
  `querySelectorAll('.get-access-trigger')` with `e.preventDefault()` per trigger, applied
  identically across all 6; `about.html`'s "Company Updates" now points to
  `resources.html#blog`, a real existing section. `login.html`'s 4 `href="#"` anchors
  (forgot-password/back-to-login ×3) were checked and confirmed already genuinely wired via
  `id`-based listeners — out of scope regardless (auth entry point, not a marketing footer).
  **Flagged, not guessed at**: `about.html`'s LinkedIn/X-Twitter and `resources.html`'s "View
  latest updates" have no real destination anywhere in the project (fictional firm, no real
  blog content) and were left as `href="#"`. **`about.html` placeholder team cards** (row 84):
  the literal unfilled-template text `Leadership Role`/`Headshot` (role titles/descriptions
  were already real) was replaced with clearly-labeled "Name Coming Soon"/"Photo Coming Soon"
  — chosen over fabricating names, consistent with the section's own pre-existing honest
  disclosure sentence. **`index.html`'s "Process & Philosophy Visual" stub** (row 85): a flat
  box with only placeholder text, beside a column of real prose already describing a 4-stage
  process — replaced with a real 4-step numbered graphic (Discover → Construct → Monitor →
  Report) visualizing that existing copy rather than inventing new content or removing the
  section; new `.process-steps` CSS in `styles.css` using only the existing locked color
  tokens. **`signup.html` submit button loading feedback** (row 86): the real async Firebase
  signup call already disabled the button and re-enabled it on failure, but gave no visual
  feedback — added a captured `originalBtnHTML` snapshot, an `.is-loading` class, and a
  spinner + "Submitting..." swap (new CSS in the page's own existing inline `<style>` block),
  reverted exactly on the existing `catch` path. Browser-verified live via a local static
  server: fix 1's footer link/modal and `resources.html#blog` navigation confirmed for real;
  fix 2/3 confirmed rendering correctly; fix 4 verified via a DOM simulation running the exact
  capture → mutate → restore statements the real handler executes (a real signup attempt
  needs a running emulator or would create real staging Firebase data just to observe a
  sub-second transition), confirmed byte-for-byte correct before/during/after states on the
  real "Review & Submit" step. Zero real console errors throughout. See
  `Marketswave_Project_Handover.md` §4.81 for the full writeup. Backend Requirements Register
  rows 83-86.
- **Homepage/services content update: six services + three new homepage sections** (Aug 27,
  2026, rows 87-88): three-part content task, no architectural changes, all copy supplied
  verbatim. **Part 1 — site-wide years-of-experience check**: grepped every page and found
  only one numeric claim anywhere — the homepage stats bar itself ("10+" / "Years of
  Experience") — nothing else to align. **Part 2 — six services**: `services.html`'s Supply
  Chain card's longer paragraph rewritten to the exact supplied text (title kept, short
  `.intro` line untouched); new 6th card "Business Consulting" (`id="business-consulting"`)
  added matching the existing 5-card structure exactly (label/h3/intro + paragraph + 5
  newly-written bullets consistent with the supplied description). Confirmed
  `.service-landscape-card` is a full-width one-per-row grid, not side-by-side, so the
  flex-col/mt-auto CTA-anchoring concern the task flagged doesn't apply here. All 6
  marketing-page footers gained a Business Consulting link; `services.html`'s meta
  description updated. **Judgment call, decided and reported**: kept the homepage's existing
  4-card Core Services teaser unchanged (already a curated subset, since it omitted Supply
  Chain even at 5 services) and relabeled its CTA "View all 6 services." **Part 3 — three new
  homepage sections**, placement decided and reported: Partners (4 fictional institutional
  wordmarks — Northbridge Capital Partners, Ashford & Vane, Meridian Fund Services, Colwyn
  Index Group — bold serif, no real company names) placed right after Stats bar as an early
  trust signal; Platform Pitch (exact supplied header sentence as `<h2>`, 9 cards reusing the
  existing `.account-grid`/`.account-card` pattern with numbered circles) and What Makes Us
  Different (3 cards reusing the existing `.vm-card` left-aligned pattern, better suited to
  its longer paragraphs) placed together after Account Types and before Core Services — final
  order Hero → Stats → Partners → Company Pitch → Account Types → Platform Pitch → What Makes
  Us Different → Core Services → Philosophy CTA → Footer. All new CSS (`.platform-grid`/
  `.platform-card`, `.partners-card`/`.partners-row`, `.diff-grid`/`.diff-card`) added as one
  consolidated block in `styles.css` before the existing Responsive section, using only
  locked navy/cream tokens — no new colors; the two new 3-column grids were added to the SAME
  existing 960px breakpoint block that already collapses `.account-grid`/`.vision-mission`,
  reusing an already-shipped responsive rule rather than new logic. Browser-verified live:
  `services.html` shows all 6 cards correctly; all three new homepage sections render with
  the exact supplied copy in the decided order; zero console errors. One verification
  limitation disclosed: this environment's `resize_window` tool doesn't move the real
  viewport (a known limitation), so the 960px collapse itself couldn't be re-confirmed
  visually — relied on reusing the exact same already-verified breakpoint rule instead. See
  `Marketswave_Project_Handover.md` §4.82 for the full writeup. Backend Requirements Register
  rows 87-88.
- **Layout-only redesign: Platform Pitch columns + What Makes Us Different numeral list**
  (Aug 28, 2026, row 89): content unchanged from the prior task's own copy — pure layout
  replacement per approved mockups. Platform Pitch's 9-card grid became `.platform-columns`
  — 3 columns, no card borders/backgrounds — grouping the same 9 items into "Getting
  Started"/"Building Your Portfolio"/"Staying in Control," each column a thin-bordered
  uppercase label followed by bold-title/muted-description items. What Makes Us Different's
  3-card grid became `.diff-list` — a large-numeral (01/02/03) editorial list, no cards, thin
  horizontal dividers between rows, `max-width:900px` so paragraphs stay readable; numerals
  use `var(--border-strong)` (locked cream/border tone, not navy) so they deliberately recede
  behind the actual content. Both new layouts were added to the public site's own
  already-established `960px` breakpoint block in `styles.css` (the same block
  `.account-grid`/`.vision-mission` already use) rather than importing the dashboard family's
  unrelated Tailwind `lg` breakpoint — the correct reading of "reuse the established
  responsive pattern" for a custom-CSS public page. Old `.platform-grid`/`.platform-card`/
  `.diff-grid`/`.diff-card` CSS deleted outright, confirmed orphaned via grep;
  `.partners-card`/`.partners-row` (the 3rd homepage section, not part of this task) left
  untouched. No new colors. Browser-verified live at real desktop width; narrow-viewport
  verification done via a real injected `<iframe>` at genuine 390px width (since
  `resize_window` was re-confirmed this session not to move the real viewport) —
  `getComputedStyle()` inside the iframe confirmed both the column collapse and the
  narrow-width numeral-column/font-size overrides genuinely fire at the breakpoint, and
  `getBoundingClientRect()` confirmed all 3 platform columns stack with zero horizontal
  overlap, not just a plausible screenshot. Zero real console errors. See
  `Marketswave_Project_Handover.md` §4.83 for the full writeup. Backend Requirements Register
  row 89.
- **Removed the "Institutional Alignment" (Partners) homepage section entirely** (Aug 28,
  2026, row 90): explicit instruction to scrap it, not redesign it. Confirmed via grep that
  `.partners-card`/`.partners-row`/`.partner-wordmark` and the 4 fictional wordmark strings
  were referenced only inside this one section — removed the section from `index.html` and
  the now fully-orphaned CSS from `styles.css`, renaming the surrounding CSS comment to drop
  "PARTNERS." Homepage order is now Hero → Stats → Company Pitch → Account Types → Platform
  Pitch → What Makes Us Different → Core Services → Philosophy CTA → Footer. Browser-verified
  live: Stats bar flows directly into "Built for Clarity and Control" with no gap. Zero
  console errors. See `Marketswave_Project_Handover.md` §4.84. Backend Requirements Register
  row 90.
- **Supply Chain + Business Consulting added to the Core Services teaser** (Aug 28, 2026,
  row 91): explicit instruction, reversing row 87's own deliberate 4-card curation decision.
  Both new `.service-card` entries reuse already-established copy verbatim (Supply Chain
  from `services.html`'s own intro line, Business Consulting from its own existing
  description) — no CSS changes needed, since `.service-card p { flex-grow: 1 }` already
  keeps CTAs aligned regardless of description length and `.service-grid`'s `auto-fit` grid
  already reflows for any card count. Teaser now genuinely shows all 6 services, matching its
  own "View all 6 services" CTA. **Verified by the user directly, not by Claude** — per
  instruction to stop calling the browser tools without asking first; user confirmed the
  check (all 6 cards, CTA alignment, correct anchor links) was completed. See
  `Marketswave_Project_Handover.md` §4.85. Backend Requirements Register row 91.
- **Homepage content rewrite — precise find-and-replace across 6 sections** (Aug 28, 2026,
  row 92): content-only, exact strings supplied, no layout changes except where explicitly
  authorized. Hero, Company Pitch (heading/subtext/"Brand Identity & Approach" sub-heading/
  both body paragraphs) replaced verbatim. The 4 "Brand Identity & Approach" list items were
  restructured (the one authorized structural change, since plain `<li>text</li>` had no room
  for a title) into `<li><strong>Title</strong> — <span class="approach-list-desc">
  description</span></li>` — "One Team," "Champion the Investor," "Dream Big, Drive Change,"
  "Growth Mindset"; new `.approach-list-desc` CSS added (`font-weight:400;
  color:var(--text-muted)`, since the `<li>` itself carries `font-weight:500`), and
  `.approach-list li`'s `margin-bottom` bumped 14px→18px for the now-longer entries. Platform
  Pitch: 7 of 9 items updated (items 3/4 untouched, matching the task's own omission); item
  6's new copy reintroduces the fictional "Northbridge Capital Partners"/"Ashford & Vane"
  names from the now-removed Partners section (row 90) — confirmed still fictional. What
  Makes Us Different: subtext + Row 02 updated (new Row 02 text no longer mentions "10+
  years," per the supplied text, not an oversight); Rows 01/03 untouched. Core Services
  Teaser: Cards 2/3/5/6 updated, Cards 1/4 untouched. Get Access Modal: Login card
  description updated ("transactions" swapped for "statements"). Grepped after all edits to
  confirm none of the 17 original strings remain anywhere. Browser-verified live, the full
  page: every section renders correctly, all 4 restructured list items show bold titles with
  no unclosed-tag artifacts, the `&amp;` entity in "Ashford & Vane" renders correctly, the
  Get Access modal's Login card was opened for real and confirmed. Zero real console errors.
  See `Marketswave_Project_Handover.md` §4.86. Backend Requirements Register row 92.
- **Company Pitch section rebalanced: two-column pair + new Our Values section** (Aug 28,
  2026, row 93): layout-only, content unchanged from row 92. The original `.two-col` block
  had grown lopsided once row 92 added a 4-item values list to the left column. Split into
  TOP — the existing `.two-col` (unchanged `1fr 1fr`) now holds only the sub-heading + 2
  paragraphs, paired with the unmodified process-steps box, values list removed — and BOTTOM
  — a new full-width `.values-block` (centered "OUR VALUES" label + 4-column `.values-grid`)
  holding the same 4 items relocated, each a bare `.value-item` (`border-top: 2px solid
  var(--primary)`, bold title, muted description, no bullets/cards). The now-orphaned
  `.approach-list`/`.approach-list-desc` CSS (added one task earlier) was deleted and
  replaced with the new `.values-*` rules. Responsive, two-tier per instruction (2 columns
  tablet, 1 column narrow): `.values-grid` added to BOTH already-established breakpoint tiers
  — `repeat(2,1fr)` at the existing `960px` block, `1fr` at the existing `768px` block —
  reusing two shipped tiers rather than inventing one. No new colors. Browser-verified live:
  the top pair is now visibly balanced; Our Values reads clearly on its own. Narrow/tablet
  verified via a real injected `<iframe>` at 3 genuine widths (`resize_window` still doesn't
  move the real viewport here) — `getComputedStyle()`/`getBoundingClientRect()` confirmed 4
  columns at 1400px, exactly 2 at 850px, clean single-column stacking at 390px. Zero console
  errors. See `Marketswave_Project_Handover.md` §4.87. Backend Requirements Register row 93.
- **Account Type card icons: single letters (I/J/E) replaced with real SVG icons** (Aug 28,
  2026, row 94): read the Get Access modal's existing two icons first to match their exact
  style (`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"`, 22px on a 44px circle). Swapped only the
  inner content of each `.account-card .icon` div — badge container untouched, no CSS needed
  for color since `color: var(--primary)` already applies via `currentColor` inheritance,
  exactly as it did to the old letter text. Individual → Feather "user," Joint Option →
  Feather "users," Entity/Business → a building icon (one real iteration: the first version,
  full-width horizontal bars, read more like a document than a building on review; replaced
  with a tower + door + 2×2 window-mark grid that reads clearly as a building). All three use
  the same `26×26` output size at the same 24×24 viewBox, proportionally scaled from the
  modal's own ≈50%-of-circle ratio rather than an arbitrary new one. Browser-verified live:
  all three render crisply, cleanly centered, consistent stroke weight/color; zero console
  errors. See `Marketswave_Project_Handover.md` §4.88. Backend Requirements Register row 94.
- **Icons added to all 6 Core Services teaser cards** (Aug 28, 2026, row 95): new
  `.service-card .icon` (56px, `background: var(--surface)`, `border-radius: var(--radius)`
  — a rounded square, deliberately distinct from the circular Account Type badges built one
  task earlier). Six thin-stroke SVGs matching the same style established for Account Types
  (`viewBox 0 0 24 24`, `stroke-width 2`, round caps, `currentColor`, `26×26`): Trading →
  trend-line, Discretionary Management → compass, Retirement Planning → sunrise,
  High-Yield Savings → piggy bank, Supply Chain → truck, Business Consulting → lightbulb.
  Each badge sits as the first child inside its card, above the title. CTA-anchoring
  re-verified via `getBoundingClientRect()`: every "Learn more" button's bottom Y-coordinate
  is identical within each row despite varying description lengths — `.service-card p {
  flex-grow: 1 }` (the existing flex-col/mt-auto-equivalent mechanism) holds. Row 2
  confirmed via direct screenshot; row 1 confirmed via `getComputedStyle()`/
  `getBoundingClientRect()` across all 6 cards after a screenshot-capture flakiness in this
  session's browser tool prevented a clean row-1 screenshot (disclosed, not silently
  skipped — DOM/layout confirmed correct via live JS queries regardless). Zero real console
  errors. See `Marketswave_Project_Handover.md` §4.89. Backend Requirements Register row 95.
- **Removed hyphens and em-dash pauses from index.html only, editorial rewrite** (Aug 28,
  2026, row 96): `index.html` only, per explicit instruction. 8 compound-word hyphens fixed
  via straightforward space-separation ("institutional-grade" → "institutional grade",
  "long-term goals" → "long term goals", "Multi-Asset Class" → "Multi Asset Class",
  "ESG-related aspects" → "ESG related aspects", "self-directed access" → "self directed
  access", "multi-signatory controls" → "multi signatory controls", "real-time visibility" →
  "real time visibility", "near-term goals" → "near term goals"); `1099-DIV` left untouched
  (a fixed tax-form identifier, not a descriptive compound, same category as the explicit
  "High-Yield Savings" exception — confirmed untouched at both occurrences). 4 em-dash
  sentence pauses rewritten with real editorial judgment (comma+"with", plain deletion
  before an already-connecting "and", "while" to make a simultaneous relationship explicit,
  plain comma before a participial phrase — see `Marketswave_Project_Handover.md` §4.90 for
  the full before/after list); the `<title>` tag's own em-dash left untouched (a
  title/tagline separator, not sentence punctuation, correctly outside the task's own stated
  scope). Verified via `document.body.innerText` (plus the Get Access modal's hidden
  `innerText`) that zero target hyphens/em-dashes remain in rendered copy and all 12
  rewrites are genuinely live in the DOM, then read the entire rendered page text end to end
  to confirm every rewrite reads as natural English in context, not just "characters
  removed." Zero console errors. See `Marketswave_Project_Handover.md` §4.90. Backend
  Requirements Register row 96.
- **Homepage animation and micro-interaction pass** (Aug 28, 2026, row 97): motion only, no
  background/color/texture changes (a separate later pass). New `home-motion.js` (index.html
  only, same separate-concern-file convention as `dashboard-sidebar.js`) implements every
  entrance/scroll animation; new CSS "16C. HOMEPAGE MOTION" block in `styles.css`.
  **Architecture**: `[data-reveal]`/`[data-reveal-scale]` only take effect once `.js-motion`
  is on `<html>`, added entirely by JS — if `prefers-reduced-motion` is set, IntersectionObserver
  isn't supported, or JS fails to run, `.js-motion` is never added and content stays fully
  visible by construction, not hidden waiting on JS. A CSS `@media (prefers-reduced-motion)`
  override sits on top as defense-in-depth. Hero fades/slides in immediately on load, staggered
  100ms/element. Stats bar counts up the two numeric values ($900m, 10+) via rAF with
  ease-out-cubic; text-only stats correctly left static. Company Pitch's two-col pair fades as
  one unit; Our Values' 4 items stagger 100ms; the 4 process-step numbers scale in staggered
  90ms. Account Types gets a new icon `scale(1.1)` hover paired with the existing card lift.
  Platform Pitch's 3 columns stagger 150ms left to right. What Makes Us Different: each row is
  observed INDIVIDUALLY, not as a group, so they reveal one at a time while scrolling. Core
  Services gets the identical hover treatment as Account Types (confirmed byte-for-byte the
  same values). Philosophy CTA gets a simple fade-in; footer confirmed zero motion elements.
  **A real environment obstacle worked around, not silently skipped**: this session's browser
  tab was stuck `document.visibilityState: "hidden"` throughout (reproduced on a fresh tab
  too), a real Chromium behavior that throttles rAF/IntersectionObserver for pages not
  considered on-screen — confirmed this was environment, not a code bug, via a bare test
  observer that also never fired and direct stylesheet inspection confirming the CSS was
  correct. Found that taking a real screenshot reliably unstuck pending observations and used
  that as the verification method — directly captured genuine mid-transition screenshots,
  including the strongest evidence for the individual-row requirement: "Value, Accelerated"
  caught mid-fade while the already-passed "Differentiated Insights" was fully opaque, and
  separately "Strategic Partner" mid-fade while "Differentiated Insights" was still nearly
  transparent. Hover states verified via real hover at explicit pixel coordinates (one
  ref-based attempt silently failed and was caught and redone). Reduced-motion path verified
  by temporarily hardcoding the bailout to `true` (no media-emulation tool available), then
  reverted. No layout regression confirmed. Zero real console errors. See
  `Marketswave_Project_Handover.md` §4.91. Backend Requirements Register row 97.
- **services.html content rewrite — precise find-and-replace across all 6 cards** (Aug 28,
  2026, row 98): content-only, exact strings supplied, only `services.html` touched. Page
  Hero subheading, Trading's intro + 6 bullets, and Discretionary Fund Management's intro +
  5 bullets all replaced verbatim with new copy (real-time charting/crypto/commission
  savings for Trading; a 40/35/25 private-market allocation split for Discretionary).
  Retirement Planning: intro replaced; 3 of 5 bullets needed a title + description shape,
  matching "this project's other titled-bullet pattern" — since Company Pitch's "Our
  Values" had already been restructured into its own full-width grid by an earlier task,
  and this context is a plain `<ul><li>` list inside a two-column card, the pattern was
  adapted rather than copied verbatim: `<li><strong>Title</strong> — description</li>`,
  reusing this project's own earlier iteration of "Our Values" before its restructuring —
  confirmed no CSS override would suppress `<strong>`'s default bold, so no new CSS needed.
  High-Yield Savings and Business Consulting: per the task's own explicit "(intro
  paragraph)" wording (distinct from "(intro)"), only the second `.text-muted` paragraph
  was replaced in each, `.intro` left untouched in both; bullets 1-2 replaced, remaining
  bullets left untouched per instruction. Verified via grep that none of the ~25 original
  find-strings remain; read the entire rendered page text end to end to confirm every
  card's new copy and every untouched section render correctly; a live screenshot of
  Retirement Planning confirmed the new titled bullets render cleanly, consistent with
  their plain-text siblings. Zero console errors. See `Marketswave_Project_Handover.md`
  §4.92. Backend Requirements Register row 98.
- **services.html layout redesign: 6-card grid → service nav list + single detail panel**
  (Aug 28, 2026, row 99): structural only, content unchanged from row 98. New
  `service-explorer.js` (services.html only) reads the original 6 `.service-landscape-card`
  articles' real `innerHTML` at runtime and reuses it verbatim — no content retyped, zero
  risk of a mismatch with the rewrite that had just landed. Progressive enhancement: if the
  script fails, `#service-explorer-root` (the original wrapper) is left exactly as-is, the
  same stacked 6-card layout the page always had, never blank/broken. On success, JS builds
  `.service-explorer` (240px-nav/1fr-detail grid): `.service-nav` (6 buttons, labels read
  from each panel's own `<h3>`) + `.service-select` (hidden on desktop) + a single
  `.service-detail` div — genuinely one panel in the DOM, not 6 with 5 hidden. Active nav
  item uses `background: var(--primary)` + `color: var(--bg)` (locked cream); inactive
  items plain text with a subtle hover background added beyond spec. One shared
  `resolveActiveId()` checks `location.hash` against the 6 known ids, falling back to
  Trading — satisfying both "default" and "hash pre-select" from one code path. A shared
  `activate()` handles clicks/select/hashchange alike via `history.replaceState()` (not
  `pushState`, so back-history isn't polluted). Nav/select visibility and the grid collapse
  were added to the site's own already-established `960px` breakpoint block. No new colors.
  Browser-verified: clicked through all 6 real nav buttons (one coordinate-drift mis-click
  caught and redone via `find`-resolved refs), confirming correct content/highlight/hash
  each time with no layout jump; loaded fresh via real navigation with each of the 6 URL
  hashes, confirming correct pre-selection; narrow-viewport collapse verified via a real
  injected `<iframe>` at 390px — nav hidden, select shown, grid collapsed to one column, a
  real `change` event correctly swapped the panel, confirmed visually via a zoomed
  screenshot. Zero console errors. See `Marketswave_Project_Handover.md` §4.93. Backend
  Requirements Register row 99.
- **services.html richer detail panel: tag/serif title/stat callout/icon-highlight grid**
  (`service-explorer.js` + `styles.css`, Aug 28, 2026, row 100, on top of row 99's nav+panel
  structure): `services.html` itself is untouched — row 99's raw `.service-landscape-card`
  fallback markup stays the genuine no-JS fallback and live-extraction source for tag/title/
  intro; only the featured stat and 4 distilled highlight phrases per service are new,
  held in a new `EXTRA` data object keyed by service id. `.service-nav-item`'s base color
  changed `var(--text)` → `var(--primary)` (navy) and `.is-active` gained `font-weight: 700`,
  satisfying "Active item: solid navy background, cream text, bold; Inactive: plain text,
  navy." New panel markup: `.service-detail-tag` (gold, hardcoded `#C8860A` — confirmed
  byte-identical via grep to `risk-management.html`'s own `.rm-pill` gold, the same scoped
  one-off exception category, not reused anywhere else); `.service-detail-title` in
  `Georgia, 'Times New Roman', serif` at 2.15rem — **one disclosed discrepancy**: the task
  framed this as matching "What Makes Us Different," but that section's `.diff-content h3`
  was confirmed to carry no serif override at all; followed the task's own explicit literal
  fallback instruction instead, reusing the same Georgia stack this project used once before
  for the now-removed Partners wordmarks (row 84); `.service-detail-intro` constrained to
  `max-width: 560px`; `.service-stat` (cream `var(--surface)` box) with a numeric
  `.service-stat-number`/`.service-stat-label` variant (Trading "170+"/"tradable
  cryptocurrencies", Discretionary "$10,000"/"minimum investment", Retirement
  "$25,000"/"transfer-fee reimbursement", Savings "$250,000"/"FDIC protection" — all pulled
  from row 98's real copy) or a text-only `.service-stat-text` variant (Supply Chain "One
  integrated system", Business Consulting "Dedicated sector expertise"), styled consistently
  per instruction; `.service-highlights` (2-column grid of icon-badged rows, 40px
  `.service-highlight-icon` badges reusing the Core Services rounded-square language from row
  95 at a smaller size). **Highlight content, a judgment call reported per instruction**: each
  service's original bullets distilled to exactly 4 punchier phrases (not verbatim), dropping
  whichever bullet the stat callout already captures to avoid repeating a figure — resolves
  the task's own internal tension between "no new writing needed except the stat labels" and
  its later explicit authorization of "a tightened, punchier version," read as the more
  specific instruction governing. 21 distinct thin-stroke icons (same project-wide SVG
  convention) cover the 24 highlights, reused where genuinely fitting rather than
  manufacturing 24 unique glyphs. Responsive: `.service-highlights` collapses to `1fr` at the
  same existing 960px breakpoint row 99 already uses. Browser-verified live: all 6 services
  checked programmatically (hash nav + settle delay, since `hashchange` is async — a same-tick
  read across all 6 was caught reading stale state and corrected), confirming correct
  tag/title/stat/exactly-4-highlights/4-rendered-icons and mobile-select sync for every
  service; a full-page screenshot confirmed Trading's rendered panel matches the mockup
  structure; narrow-viewport collapse re-verified via a real injected `<iframe>` at 700px —
  `.service-highlights` resolves to one grid track, visually confirmed via a scrolled
  screenshot showing all 4 highlights stacked with icons intact. Zero console errors. See
  `Marketswave_Project_Handover.md` §4.94. Backend Requirements Register row 100.
- **services.html rebuilt again: full-width scrolling sections replace the nav+detail-panel
  concept entirely, complete/undistilled content** (Aug 28, 2026, row 101, a full reversal of
  rows 99-100's structural direction, not an iteration): explicit instruction to bring back
  real, COMPLETE content for every service — full intro + secondary paragraph, every real
  bullet in full, nothing shortened — the opposite of row 100's own deliberate distillation.
  Every service's complete text is now hand-written directly into static HTML (a deliberate
  departure from rows 99-100's "extract live from the DOM at runtime" pattern — there's no
  longer a separate fallback block to extract from, since this IS the only markup now). Six
  `<section class="service-section" id="...">` elements, stacked in a new `.services-full`
  wrapper in the locked order, each carrying its own locked anchor id directly — plain
  browser fragment navigation handles the jump now, no JS needed. Per section: `.service-tag`
  (gold, unchanged from row 100), `.service-title` (serif, unchanged from row 100, same
  disclosed "What Makes Us Different isn't actually serif" discrepancy carried forward, not
  re-litigated), `.service-copy` (both `.service-intro` and `.service-secondary` in full),
  `.service-stat` (unchanged number/label or text-only variants), and a new
  **single-column** `.service-checklist` (not row 100's 2-column grid — real bullet text
  runs 2-3 lines, a grid would look cramped, per instruction) of `.service-check-item` rows,
  each pairing a small 32px checkmark-icon badge with the complete, unshortened bullet text;
  Retirement's 3 titled bullets keep their exact `<strong>Title</strong> — description`
  shape. A subtle divider between sections reuses the identical `.diff-row`-style
  adjacent-sibling pattern (`.service-section + .service-section { border-top: 1px solid
  var(--border-strong); }`) already established on the homepage. **Full teardown of rows
  99-100's now-obsolete code**: `service-explorer.js` deleted outright (confirmed orphaned
  via grep first); its `<script>` tag removed; every CSS class the nav+panel/rich-panel
  design depended on removed from `styles.css` and replaced with the new full-width-section
  rules (confirmed via a follow-up grep that zero references remain); the 960px breakpoint
  block's old rules replaced with just two (reduced section padding, reduced title
  font-size) — no nav/grid left to collapse. Browser-verified live: all 6 sections confirmed
  programmatically to have complete content (correct bullet counts per service, both
  paragraphs present, one checkmark icon per bullet) plus spot-check substring matches
  against the exact original source text confirming no silent rewording; screenshots
  confirmed tag/serif title/stat/checklist/divider all render correctly while scrolling.
  **A real environment complication, disclosed not glossed over**: this session's tab was
  stuck `document.visibilityState: "hidden"` (documented throttling this project has hit
  before), which silently defeated a `location.hash`-driven JS scroll loop entirely (0
  movement across 6 iterations, confirmed via `window.scrollY` never changing); switched to
  real `navigate()` calls per anchor, which worked for most but at least one
  (`#discretionary`) landed short under the throttled tab's interaction with the site's own
  pre-existing `scroll-behavior: smooth` (unrelated, unchanged CSS) — resolved decisively by
  calling `scrollIntoView({behavior:'instant'})` on all 6 ids directly, landing every one at
  exactly `top: 0`, proving the anchor ids/structure are completely correct and the
  undershoot was a throttled-animation artifact of this automation tab, not a markup defect.
  Narrow-viewport read (390px, real injected `<iframe>`) confirmed every section stays fully
  within the viewport (max right edge 372px, zero overflow from new content) with the
  reduced-width rules genuinely active; a **separate, pre-existing, explicitly out-of-scope
  overflow was found and disclosed**: the site's own shared header
  (`.nav-toggle`/`.header-actions`, byte-identical across every page) overflows 390px on its
  own, unrelated to this task. Zero console errors. See `Marketswave_Project_Handover.md`
  §4.95. Backend Requirements Register row 101.
- **services.html animation and micro-interaction pass — page-hero + per-section entrance
  motion, reusing home-motion.js's exact pattern** (Aug 28, 2026, row 102, built on row 101's
  full-width section redesign): new `services-motion.js` (services.html only) reuses
  `home-motion.js`'s exact bailout conditions and helper shapes (same `prefers-reduced-
  motion`/`IntersectionObserver` guard, same `.js-motion`-on-`<html>` mechanism added
  entirely by JS, same `markReveal()`/`observeStaggeredGroup()` signatures) rather than a new
  pattern from scratch. Page Hero (`.page-hero h1`/`.page-hero p` — this page has no separate
  CTA row unlike the homepage's `.hero-lead`/`.hero-ctas`, so the selector was adapted to
  what actually exists) fades/slides in immediately on load via the identical double-rAF
  pattern, staggered 100ms. Each `.service-section` is observed individually
  (`observeStaggeredGroup()`, mirroring the homepage's own per-row "What Makes Us Different"
  treatment — sections reveal one at a time while scrolling), with its 5 content groups
  (`.service-tag`, `.service-title`, `.service-copy` — both paragraphs as one "intro" unit,
  since the task named 5 stages not 6 — `.service-stat`, `.service-checklist`) staggered 90ms
  apart in that order; the checklist reveals as one block, not bullet-by-bullet. The task's
  "section fades in on scroll" + "internal elements stagger" were read as one coherent effect
  rather than a redundant double-fade (outer wrapper + independent inner stagger). Zero new
  CSS needed — the existing `.js-motion [data-reveal]` rules in `styles.css` turned out
  already page-agnostic by construction (scoped only by class/attribute selectors, never an
  index.html-specific one); only the block's stale "(index.html only)" comment was corrected.
  Browser-verified live, working around this session's tab-throttling quirk
  (`document.visibilityState:"hidden"`, confirmed directly): a genuine mid-transition
  screenshot caught the hero's h1 and Trading's tag both visibly mid-fade simultaneously,
  proving both animations real; a settled follow-up confirmed both fully opaque.
  Programmatic checks confirmed Trading's 5 groups carry the correct 0/90/180/270/360ms
  delays in the right order and reached `is-visible`; confirmed Business Consulting (last,
  off-screen) hadn't fired before scrolling, fired correctly once scrolled into view, and
  stayed fired (not reset) after scrolling back up to Trading — confirming "once per
  element, never re-triggering." `prefers-reduced-motion` verified by temporarily hardcoding
  the bailout to `true` (no OS-level media-emulation tool available, same method already used
  for the homepage's own pass) — confirmed `.js-motion` never added and zero `[data-reveal]`
  attributes anywhere on a fresh load, then reverted. Zero console errors. See
  `Marketswave_Project_Handover.md` §4.96. Backend Requirements Register row 102.
- **resources.html content rewrite (all 6 Strategy cards + Help Center) + two structural
  additions, plus a new help-center.html stub** (Aug 28, 2026, rows 103-104): all 6
  `.strategy-card` bodies replaced verbatim with richer supplied copy. **Diversification
  needed a real read-the-live-markup decision, not just a text swap**: asked to match "the
  titled-bullet pattern already used elsewhere on this site, e.g. homepage's Our Values
  section" — rather than trust that wording (which could suggest the OLDER, since-superseded
  inline `<strong>Title</strong> — description` shape), the live homepage markup was checked
  first and the CURRENT Our Values shape was matched instead: `<h4>Multi-Asset Class
  Expertise</h4>` + `<p>description</p>` (two block elements, matching `.value-item`'s own
  post-restructuring form, row 93). A new scoped `.strategy-card h4` rule (1rem/700/navy) was
  added since none existed. Help Center: 3 existing cards' copy replaced verbatim, a genuine
  4th card added ("Promotion and referrals," grid auto-reflows 1×3→2×2, no CSS change
  needed), and a new "Visit Help Center" button added below the grid linking to a genuinely
  new `help-center.html` — a minimal stub copying `resources.html`'s real header/footer/
  Get Access modal verbatim around an honest "Full Help Center coming soon" message, explicit
  per instruction that the real buildout is a separate future task; the header nav highlights
  "Resources" as active, reusing `deploy-capital.html`'s own established precedent for a page
  with no dedicated nav slot. Blog & Press: 3 new "Article Coming Soon" placeholder cards
  added above the existing intro/CTA (untouched), honest generic copy only — no fabricated
  titles/dates/summaries, matching `about.html`'s "Name Coming Soon" team-card honesty
  standard (row 84). **Backend Requirements Register**: row 103 covers the content/structural
  work; a separate row 104 logs the deferred admin-manageable blog/article upload system the
  new placeholders are waiting on, per explicit instruction to log it as its own item.
  Browser-verified live: all 6 strategy cards confirmed with correct new body text and
  Diversification's new `<h4>` sub-title rendering correctly (navy, bold) via screenshot;
  Help Center confirmed showing exactly 4 cards in a real 2×2 layout with a working "Visit
  Help Center" button — clicked for real, landed on the genuine new stub page with matching
  chrome, a working footer (20 links) and Get Access modal (2 triggers) confirmed via direct
  DOM query; Blog section confirmed showing exactly 3 placeholder cards with "View latest
  updates" still present unchanged below them. Zero console errors on both pages. See
  `Marketswave_Project_Handover.md` §4.97. Backend Requirements Register rows 103-104.
- **Two same-day fixes to resources.html, from direct user feedback on row 103's work**
  (Aug 28, 2026, row 105): Blog & Press's card count reduced from 3 "Article Coming Soon"
  cards to 2, per instruction. Diversification's "Multi-Asset Class Expertise" sub-title —
  rendered in row 103 as a separate bold `<h4>` above the paragraph, matching Our Values'
  current `<h4>`/`<p>` shape — was corrected per feedback to read as part of the underlying
  paragraph instead: the `<h4>` was removed and "Multi-Asset Class Expertise." now opens the
  `<p>` itself, in the same plain weight as the rest of the text, matching all 5 sibling
  strategy cards. The now-unused `.strategy-card h4` CSS rule from row 103 was removed
  (confirmed via grep it had no other caller). Browser-verified live: exactly 2 Blog cards
  confirmed via count query; the Diversification `<p>` confirmed starting with "Multi-Asset
  Class Expertise. Spanning private equity..." with `querySelector('h4')` now returning
  `null`; a screenshot confirmed all 3 visible strategy cards share identical plain-paragraph
  formatting. See `Marketswave_Project_Handover.md` §4.98. Backend Requirements Register
  row 105.
- **New blog-press.html — a full Blog & Press page, replacing "View latest updates"'s old
  href="#"** (Aug 28, 2026, row 106): built as an honest stub, the same category as
  `help-center.html` (row 103) — the real client-facing blog listing/detail page is already
  the deferred work logged in row 104 (which depends on an admin-manageable article upload
  system that doesn't exist yet), so a "full" page today can only honestly be a fuller
  version of the same "Coming Soon" pattern, not real content; a code comment cross-
  references row 104 directly. Copies the site's real shared header/footer/Get Access modal
  verbatim (same pattern as `help-center.html`), with its own hero (reusing
  `resources.html`'s existing "Blog & Press" heading/subtext) and 3 "Article Coming Soon"
  cards (one more than the teaser's 2, since this is now the dedicated listing page), plus a
  "Full Blog & Press page coming soon" message and Contact Us CTA mirroring
  `help-center.html`'s own closing block. `resources.html`'s button now points to
  `blog-press.html` instead of `#`. **Deliberately NOT changed**: the site-wide footer's own
  "Blog & Press" link still points to `resources.html#blog` everywhere, including on
  `blog-press.html` itself — the task named only the one button; an initial draft had
  `blog-press.html`'s own footer self-linking, caught and corrected so the shared footer
  chrome stays byte-identical across every page rather than diverging on this one. Browser-
  verified live: clicked the real button (not just inspected its `href`) and confirmed
  genuine navigation via the tab's own reported URL/title; screenshot confirmed the hero, all
  3 cards, and the coming-soon message render correctly; direct DOM query confirmed the
  footer (20 links) and Get Access modal (2 triggers) match every other page's chrome. Zero
  console errors. See `Marketswave_Project_Handover.md` §4.99. Backend Requirements Register
  row 106.
- **about.html content rewrite + a site-wide company-facts consistency pass** (Aug 29,
  2026, row 107): full rewrite of hero, Vision, Mission, Background & History, all 3 team
  cards, and the closing note, plus a sweep to align other pages with the new canonical
  facts (Founded 2004, Stockholm HQ at Malmskillnadsgatan 44 B, 150+ employees). **Hero**:
  a new `<p class="subtitle">` was added between the existing (untouched) `<h1>` and the new
  descriptive paragraph — `.page-hero` previously only ever had h1+p; a new
  `.page-hero .subtitle` CSS rule (1.3rem/700/full opacity) overrides `.page-hero p`'s
  dimmer defaults via specificity. **Background & History**: the old single centered
  paragraph became 6 left-aligned narrative paragraphs (`.about-narrative`) plus a genuinely
  new **company facts block** — no existing labeled key-value pattern existed anywhere on
  the site (confirmed via grep before building), so a new `.facts-grid`/`.fact`/
  `.fact-label`/`.fact-value` set was built reusing the `border-top` accent language already
  established by the homepage's own `.value-item` ("Our Values"), 8 facts in a 2-column
  grid collapsing to 1 column at the existing 960px breakpoint. **Team cards**: Card 1 →
  "Craig Bergstrom," Card 2 → "Fede Salvai" (both names+descriptions updated), Card 3 →
  "Valerie Molina" (name only, description explicitly unchanged per instruction);
  "Photo Coming Soon" deliberately left untouched on all three — no real photos exist.
  **Closing note**: replaced with the user's own already-grammar-corrected text verbatim.
  **Site-wide pass**: homepage stats bar "Years of Experience" 10+ → 20+; `contact.html`'s
  Address card expanded to the specific street address. **A project-wide grep found 2 real
  discrepancies beyond the two the task named, both on index.html's Company Pitch section,
  both fixed**: "15+ year" → "20+ year" in its `<h2>`, and "honed over a decade" → "honed
  over two decades" in its subtext — confirmed no other founding-year/headcount/address
  references exist elsewhere in the project. Browser-verified live: every new element
  confirmed programmatically (exact text match on all 8 facts, all 3 team cards, the
  closing line) and visually via screenshots; homepage/contact updates confirmed rendering
  correctly. Narrow-viewport check (390px, real injected iframe) confirmed the facts grid
  collapses to 1 column and none of this task's content overflows — the only overflow
  present is the same pre-existing, out-of-scope shared-header overflow already documented
  in row 101. Zero console errors. See `Marketswave_Project_Handover.md` §4.100. Backend
  Requirements Register row 107.
- **about.html's Vision/Mission section redesigned away from boxed cards, per direct
  feedback** (Aug 29, 2026, row 108, same-day follow-up to row 107): CSS-only fix, no HTML
  changes — `.vm-card`/`.vision-mission` are used only on `about.html` (confirmed via grep),
  so the existing markup was restyled in place. The old boxed treatment (white background,
  border-radius, box-shadow, border, generous padding) was removed entirely; the new
  editorial treatment reuses the exact `border-top: 2px solid var(--primary)` accent
  language the homepage's own "Our Values" section (`.value-item`) already established —
  each column now reads as a labeled block of running text with a thin top rule, no
  card chrome at all. Grid gap widened 32px → 48px since the top-rule + whitespace now does
  the separation work the old box's own border/shadow used to. Text styling (`.vm-card h3`/
  `p`) left unchanged — only the container chrome changed. Browser-verified live: a
  screenshot confirmed the new layout reads as a clean, open two-column block that handles
  row 107's now-lengthy paragraphs far better than the old mismatched-height cards did;
  narrow-viewport re-check (390px, real injected iframe) confirmed the section still
  correctly collapses to one column. Zero console errors. See
  `Marketswave_Project_Handover.md` §4.101. Backend Requirements Register row 108.
- **Supabase Migration — Stage 1: local infrastructure + schema + bootstrap** (Aug 30, 2026,
  row 109): **the real backend is pivoting from Firebase to Supabase.** Reason, reported
  plainly: real Cloud Functions on the Firebase side are blocked on a Blaze (pay-as-you-go)
  plan upgrade for `marketswave-staging` (see Phase A2 above) — a real card requirement this
  project didn't want to take on. Supabase's free tier includes real Edge Functions with no
  card required, at the cost of a genuine tradeoff, not a free lunch: free-tier Supabase
  projects auto-pause after 7 days of inactivity and need a manual un-pause. **This is
  additive work — the existing Firebase integration (`signup.html`/`login.html`,
  `functions/`, both emulator and real `marketswave-staging`) is completely untouched and
  stays fully in place** until Supabase is proven equivalent end to end; a safety-net commit
  (`47bf335`) was made before any of this started, per the standing high-risk-change
  convention. **Stage 1 is infrastructure/schema/local-bootstrap only — no client-facing
  signup/login rebuild yet, no Supabase-side golden-path regression script yet; both are
  Stage 2, not started.** New real, separate, persistent cloud project: "Marketswave
  Staging" (`ujnmlwbpginplfnofhhv`, `supabase login`-confirmed reachable via
  `supabase projects list`) — **not linked yet** (`supabase link` is a later step this Stage
  deliberately doesn't need); every command this Stage ran was against the local Docker
  stack (`supabase start`), never that real cloud project. `supabase init` scaffolded
  `supabase/config.toml` + `supabase/migrations/`. New migration
  `supabase/migrations/20260830094238_create_clients_and_admin_roles.sql` mirrors Firestore's
  `clients/{uid}` collection field-for-field (read directly from `firestore.rules`/
  `firestore.staging.rules`/`functions/index.js` before writing it, not reinvented): a
  `clients` table (`id` = `auth.users.id` directly, same "document id = the owning user's own
  uid" design) with RLS mirroring the Firestore rules exactly — INSERT allows a client to
  create exactly their own row with `status` forced to `pending_review` and `email` checked
  against their own verified JWT email (the same anti-spoofing check
  `firestore.staging.rules` already enforces); SELECT allows self-or-admin; no UPDATE/DELETE
  policy exists for any client role at all, so both are denied by default — resolving an
  application is reserved for `service_role`/a future Edge Function, mirroring
  "writes are 100% Cloud-Function-gated" exactly. `account_type`/`status` validity is
  enforced via table `CHECK` constraints (stronger than a policy-only check, since it also
  protects `service_role` writes). **Admin-role pattern, researched and decided per
  instruction**: a Custom Access Token Auth Hook (`public.custom_access_token_hook`,
  registered via `config.toml`'s `[auth.hook.custom_access_token]`) that stamps
  `app_metadata.is_admin` onto every issued JWT from a new `public.user_roles` table (never
  exposed to any client role — RLS enabled with zero policies for `authenticated`/`anon`,
  only `supabase_auth_admin`/`service_role` can ever reach it) — chosen over the simpler
  `profiles.role` + RLS-subquery pattern because it's Supabase's own current-documented
  recommended approach (confirmed via a live web search, not assumed from training) and reads
  the claim straight off the already-verified JWT with zero extra DB round-trip per row,
  unlike a subquery-per-row-checked pattern; a boolean `is_admin` (not a `role` enum) was
  chosen to mirror Firebase's `{admin: true}` custom claim literally, matching this project's
  single-shared-admin model. New `public.is_admin()` (plain SQL, reads only the JWT, no table
  touch) is the one place RLS policies read the claim from. New
  `scripts/supabase-bootstrap-admin.js` mirrors `scripts/bootstrap-admin.js`'s own
  idempotent create-or-reuse-and-verify-live technique for a local `pm@marketswave.local`
  account; reads local-stack credentials from `supabase status -o json` at runtime rather
  than hardcoding them, with an explicit localhost-only guard refusing to run against
  anything else — the local `ANON_KEY`/`SERVICE_ROLE_KEY` are derived from `config.toml`'s
  well-known default local JWT secret, identical across every unmodified local Supabase
  project on any machine, the same "not actually a secret" category as the Firebase
  emulator's own hardcoded bootstrap password, which is why this script (and the verification
  script below) are safe to keep committed. New `@supabase/supabase-js` dependency added to
  `scripts/package.json`; `npm audit` confirmed its only advisory is the same pre-existing
  `uuid` chain already triaged (row 74/§62), nothing new introduced. **Local stack Docker
  persistence — investigated and verified directly, not assumed just because Docker volumes
  are generally persistent** (the task's own explicit instruction, given this project's real
  history of a Firebase emulator data-loss quirk): inserted a real test row into
  `auth.users`/`public.user_roles` via `docker exec ... psql`, ran `supabase stop` (output:
  `"backup": true`; `docker volume ls` confirmed `supabase_db_Marketswave` survives), ran
  `supabase start` again (output began `Starting database from backup...`, not
  `Initialising schema...`), and confirmed both rows still present, byte-identical.
  **Confirmed: no Firebase-style data-loss quirk — `supabase stop` performs a real backup and
  `supabase start` restores it automatically.** New `scripts/verify-supabase-schema.js` —
  Stage 1's own regression check, the Supabase-side analog of `golden-path-regression.js` —
  creates two real throwaway client users and one real throwaway admin user against the live
  local stack, signs in as each, and directly tests 16 real behaviors: **16/16 assertions
  passed**, including the two that matter most for the admin-role decision — an ordinary
  client's real issued JWT carries `app_metadata.is_admin === false` and that client
  genuinely cannot see another client's row, update/delete their own row, or insert one under
  someone else's id/with a spoofed email/with a non-`pending_review` status/with an invalid
  `account_type`; and an admin-claimed caller's real issued JWT carries
  `app_metadata.is_admin === true`, which genuinely unlocks reading every client's row while
  still **not** granting any client-side write path (confirmed `service_role` is the only
  role that can actually write, the path a future Edge Function will use). All test
  users/rows deleted at the end of the script, leaving no residue. New "Supabase Local
  Development Runbook" section added to `README.md`, placed first as the now-active path,
  covering prerequisites, `supabase init`/`start`/`stop`, the persistence proof above, both
  new scripts, and an explicit "What Stage 1 does NOT include yet" section (no client-facing
  code talks to Supabase at all; Edge Functions equivalents to
  `createClientApplication`/`approveClientApplication`/`rejectClientApplication` don't exist
  yet — today an application can only be resolved via direct `service_role` access,
  confirmed working in the verification script's own last check). One disclosed cosmetic
  issue: the `vector` container (Logflare's log shipper, feeds only Studio's Logs Explorer
  tab) restart-loops on this machine with `Connection refused` reaching the Docker socket — a
  known Docker-Desktop-on-Windows socket-mounting quirk, confirmed **not** to affect
  Postgres/Auth/REST/Storage/Studio (`docker ps` shows all `(healthy)` regardless, and every
  functional check above passed with `vector` still restart-looping); `imgproxy`/`pooler`
  show as "Stopped services" by design (not enabled in `config.toml`, not needed at this
  stage), not a failure. See `Marketswave_Project_Handover.md` §12 (Firebase) for context on
  what this migration is replacing, and the Backend Requirements Register row 109 below for
  the closed/open items.
- **Supabase Migration — Stage 2: client-facing signup/login rebuild, LOCAL STACK ONLY**
  (Aug 30, 2026, row 110): builds on Stage 1's schema/RLS, still entirely additive — the
  entire Firebase integration (`signup.html`/`login.html`'s existing code paths,
  `firebase-config.js`, `admin-firebase-config.js`, `functions/`, `firestore.rules`,
  `firestore.staging.rules`) is confirmed **completely untouched** (`git diff --stat`
  against every one of those files shows zero changes — only `signup.html`/`login.html`
  themselves changed, and only by addition plus one safe, backward-compatible extension of
  an existing helper, detailed below). Does not touch the real cloud "Marketswave Staging"
  project — Stage 3 work, deliberately deferred. **1. Environment switch**: new
  `supabase-config.js` (mirrors `firebase-config.js`'s exact shape) introduces a SECOND,
  orthogonal query param — `?backend=supabase` — alongside Firebase's own pre-existing
  `?env=staging`, rather than overloading one param for two independent axes. Disambiguation
  scheme, reported per instruction: `(no params)` → Firebase emulator (unchanged);
  `?env=staging` → Firebase staging (unchanged); `?backend=supabase` → Supabase LOCAL stack
  (this stage); `?backend=supabase&env=staging` → reserved for a future Supabase cloud
  staging (Stage 3, not built) — falls back to local with a `console.warn` rather than
  silently reaching a real cloud project, the same safe-default philosophy
  `firebase-config.js`'s own `IS_STAGING` already uses for anything unrecognized.
  `signup.html`/`login.html` check `IS_SUPABASE_BACKEND` FIRST, before ever touching
  Firebase's own `IS_STAGING` branch. **2. Session persistence — checked against the actual
  installed SDK source, not assumed** (`@supabase/auth-js` v2.112.4's `GoTrueClient.js`):
  `DEFAULT_OPTIONS = { autoRefreshToken: true, persistSession: true }`, and `persistSession:
  true` in a browser defaults to `globalThis.localStorage` — same CATEGORY of behavior as
  Firebase's own default `browserLocalPersistence`. `supabase-config.js` (client-facing)
  explicitly sets `persistSession: true` (a normal client should stay signed in);
  a future ADMIN-facing Supabase client (Stage 3, no page loads this today) is DECIDED to
  use `persistSession: false`, mirroring `admin-firebase-config.js`'s own
  `inMemoryPersistence` fix exactly — the precedent being the real bug that fix closed
  (Firebase's default silently restored an admin session across what was meant to be a fresh
  prompt). **Verified live in a real browser, both configurations, comparatively**: after a
  real client login, a real `sb-127-auth-token` key appeared in `localStorage`; a separate
  admin sign-in test using `persistSession: false` wrote NOTHING to `localStorage` (confirmed
  the only `sb-` key present was still the earlier client's, unchanged) and a brand-new
  client instance (the correct proxy for "a real page refresh") got back `getSession() ===
  null` for it. **3. Real signup/login**: `signup.html?backend=supabase` calls
  `supabase.auth.signUp()` then a direct, RLS-enforced `clients` table insert (no Edge
  Function needed for creation — Stage 1's own INSERT policy is what actually enforces "own
  row, forced `pending_review`, email must match your real account," the same reasoning
  `firestore.staging.rules` already established for its own client-SDK-direct-write
  design); `login.html?backend=supabase` reads real `status` for the real
  blocked/active/rejected behavior, byte-for-byte the same three messages as the Firebase
  branch. **4. THE HYBRID BRIDGE — the actual point of this stage, call chain traced before
  writing code, per instruction**: confirmed `mirrorAuthenticatedClientLocally()` and
  `setClientAuthenticated()` (both pre-existing, unmodified `engine-core.js` functions) are
  already fully backend-agnostic — they take a plain id + plain data object and have no
  Firebase-specific logic at all — so the Supabase branch calls them with data read from the
  real Postgres `clients` row (snake_case columns mapped to the same camelCase shape the
  Firebase branch's Firestore-document reader already produces) instead of a Firestore
  document, with ZERO `engine-core.js` changes needed. Confirmed `dashboard-sidebar.js`'s
  file-load-time gate reads the exact same raw `marketswave_authenticated_client_id`
  session key regardless of which backend wrote it — needing zero changes either. **5.
  Golden-path script**: new `scripts/supabase-golden-path-regression.js` mirrors
  `golden-path-regression.js` exactly in structure, reusing `lib/engine-harness.js`/
  `storage-polyfill.js` UNCHANGED for the local half (backend-agnostic by construction) and
  the real `@supabase/supabase-js` client (anon + `service_role`) for the Supabase half — no
  admin UI/Edge Function exists yet, so "admin approve" uses `service_role` directly (new
  `scripts/supabase-approve-client.js`, mirroring `scripts/staging-approve-client.js`'s own
  "explicitly a temporary stand-in" category). **Run twice in direct succession: `GOLDEN
  PATH: PASS (16/16 steps)` both times**, confirming signup → pending status (+ blocked-login
  proof) → local approve → login → dashboard ($0, clean) → fund the account (deposit +
  credit, needed before an allocation is even possible) → request an allocation → local
  approve → BUY transaction + holding appear, Total Portfolio Value conserved. **Browser-
  verified live, the complete real chain, exactly as the task asked**: drove the real 9-step
  signup form (via real DOM events, not a shortcut) against `?backend=supabase`, confirmed
  the resulting account **directly via a raw Postgres query** (not Studio's UI) — a real
  `auth.users` row, a real `clients` row, `status: pending_review`; confirmed login
  genuinely blocked with the real pending-review message; approved via
  `supabase-approve-client.js`; logged in for real, redirected to plain `dashboard.html`
  (no query param needed — downstream pages have zero reason to know which backend
  authenticated the client, which is the whole point); confirmed **`dashboard.html`,
  `settings.html`, `transactions.html`, and `asset-collection.html` all rendered correctly
  with the real client's own name/initials and a genuinely clean, empty portfolio — zero
  code changes to any of them**, having no idea anything changed underneath. **One real,
  disclosed limitation found and logged, not silently fixed or hidden**: clicking Logout
  correctly clears the local session (`dashboard-sidebar.js`'s existing, backend-agnostic
  mechanism) and redirects to `login.html`, but the real Supabase session in `localStorage`
  is confirmed still present afterward — `dashboard-sidebar.js`'s Logout handler only calls
  Firebase's own `signOutOfFirebaseAuth()`, by design untouched this stage (the same file
  Stage 2's own success criterion required stay at zero modifications). Mirrors the exact bug
  class already fixed once on the Firebase side (row 61) — deliberately left unfixed here
  since fixing it needs the one file this stage couldn't touch; tracked as Stage 2.x/3 work.
  All test accounts created during verification (browser + script) were deleted afterward,
  confirmed via a direct query that zero `clients` rows remain. New "Supabase Local
  Development Runbook" README steps 6-9 (signup/login walkthrough, the persistence proof,
  the golden-path script, the disclosed Logout gap) added; Stage 1's own "What Stage 1 does
  NOT include yet" section retired in favor of a "What Stage 2 does NOT include yet" one.
  See the Backend Requirements Register row 110 below for the closed/open items.

**Next**: Phase A2 (real Cloud Functions on staging) is blocked on a Blaze plan upgrade for
`marketswave-staging` — not attempted, not forgotten; once unblocked, deploy
`functions/index.js`'s three callables there, tighten `firestore.staging.rules` back to
Cloud-Function-only writes, and wire a real admin UI approve/reject button, retiring
`scripts/staging-approve-client.js`. Beyond that, the real-production Firebase switch-over
(§12.4's remaining checklist, now sequenced as README.md's Phase B–D — repointing
`.firebaserc`/adding a real `PRODUCTION_CONFIG` to `firebase-config.js` for the real
"Marketswave SE" project, guarding emulator connections to dev-only, deploying real
rules/Functions, bootstrapping a real production admin account, deciding on real multi-PM
support) is explicitly NOT started — do not assume production Firebase is live just because
Firebase (or even real staging) code exists in the repo; verify against `.firebaserc`/
`firebase-config.js` directly, and note that staging (`marketswave-staging`) and production
("Marketswave SE") are two different real projects, not the same one under two names.
`admin-clients.html` (Client List) now merges
real Firebase clients too (§12.8) — §12.4 item 8 is fully closed for both admin pages named
in it, and item 9 (real `signOut(auth)`) is now closed too (row 61, above). Reset Password on
a Firebase-sourced client (from either admin page) still has no real effect on that client's
actual Firebase Auth sign-in — now clearly labeled in the admin UI itself (Phase 0 item 3,
row 69, above) rather than silently misleading, but real per-client Firebase Auth admin APIs
(revoking refresh tokens, disabling the account) are still needed for a genuine fix, a
separate unscoped future task. Reset 2FA is NOT in this category — it works correctly for
Firebase-sourced clients too (row 69's own investigation found the original "both have no
real effect" framing was inaccurate for this one). `--export-on-exit` still does not persist
across an emulator restart — a genuine Windows process-termination limitation, re-confirmed
under a second, different launch method (row 68/Phase 0 above), not a one-off shell quirk —
so any fresh emulator session needs `README.md`'s Emulator Bootstrap Runbook followed in
full, including `node scripts/bootstrap-admin.js` (now a real, committed, idempotent script
— no longer scratchpad-only) before the admin UI's Firebase sign-in will work. Run
`node scripts/golden-path-regression.js` afterward (or any time "did I break the backend"
needs a real answer) to confirm the whole chain still works in one command instead of
manually re-testing each piece. Beyond that: row 3 (Onboarding data capture/PM review) is fully closed. Real file storage
(the uploaded documents' actual bytes, not just filename metadata) remains a genuinely
backend-dependent need, already tracked separately in the Documents & Reporting register
rows. Further client-selector UX work at higher client counts, if ever needed — the earlier
perf report found no slowdown at 50 clients, and this redesign already added search/filter,
so this stays non-urgent. A deliberate, explicitly-labeled "correct a starting-price typo"
override for the Product Catalog, if that turns out to be a genuine operational need —
flagged, not built, per the Edit Product judgment call in §4.63. See the handover doc §5,
§9 for the fuller forward-path discussion (note: §9's table predates both this phase and
Admin Tool Phase B, and is stale in places — the Tech Stack log here, §4.41-§4.71, and the
new §12 are the current source of truth).

## Known structural debt

~~The sidebar markup and the live-clock `<script>` block are duplicated verbatim across every
dashboard page.~~ **Resolved** — extracted into `dashboard-sidebar.js` and
`dashboard-common.js`, wired into all 9 dashboard pages. See the Tech Stack section above for
how to add a new page's nav entry.

~~`admin-settings-changes.html` duplicates `settings.html`'s (former) `formatDateDisplay()`/
`formatFieldDisplay()`.~~ **Resolved (Aug 23, 2026)** — both now load a new shared
`format-helpers.js` (mirroring `dashboard-sidebar.js`/`admin-sidebar.js`'s own "plain globals
on `window`, one `<script>` tag" convention, not folded into `engine-core.js` since these
functions are stateless) instead of hand-kept duplicates. The former deliberate divergence
(`admin-settings-changes.html` alone needing a `dateOfBirth` branch for a legacy record) is
preserved as a harmless superset in the shared `formatFieldDisplay()` — `settings.html` simply
never calls it with that field. See the Backend Requirements Register (row 65) for the full
writeup, including the broader duplication found and reported, not fixed, while grepping for
this: `formatUSD()` is duplicated near-identically across ~12 files project-wide, and
`formatDisplayDate()` (a differently-named but byte-identical date formatter) across 4 more
(`admin-documents.html`, `admin-products.html`, `admin-clients.html`, `documents.html`) —
out of scope for this task (which named `formatDateDisplay()`/`formatFieldDisplay()`
specifically), but a real, much larger candidate for a future dedicated dedup pass.

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
