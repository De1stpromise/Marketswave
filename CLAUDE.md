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
  custom CSS in `styles.css`. No Tailwind here. **One dependency exception, now on its SECOND
  backend:** `signup.html`/`login.html` ONLY also load a real backend SDK — real Supabase Auth
  + Postgres (RLS) + Edge Functions as of Aug 30, 2026 (Supabase is now the SOLE ACTIVE
  backend — see the dedicated "Firebase — RETIRED" Tech Stack entry below for the full arc).
  Real Firebase Auth + Firestore + Cloud Functions (Backend Migration Phase 1, Aug 22, 2026)
  preceded it and is RETIRED, kept only as historical/reference code, reachable solely via an
  explicit `?legacyBackend=firebase` URL flag now, never the default. Neither backend touches
  the custom-CSS-vs-Tailwind styling boundary at all — only the data layer, same category of
  exception `engine-core.js` itself already was for these pages. No other public-site page
  loads either backend SDK.
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
- **Animation**: Motion (formerly bundled under "Framer Motion" — the vanilla-JS core is now
  independently named "Motion," motion.dev; not the React library) via CDN (jsdelivr),
  pinned to `motion@13.2.0`, global `<script>` build (`window.Motion`). Loaded only on the
  pages that actually use `motion-helpers.js` (the shared wrapper — `countUp`/`wiggle`/
  `panelOpen`/`panelClose`/`mountScrollProgress` — that centralizes the project's
  `prefers-reduced-motion`-suppresses-entirely convention), never globally. Use it for any
  new JS-driven animation rather than introducing another library; the existing hand-rolled
  `[data-reveal]`/`IntersectionObserver` pattern in `home-motion.js`/`services-motion.js`
  stays as-is for simple scroll reveals, no need to migrate it.
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

**One real, deliberate exception, now on its SECOND real backend — read before assuming
"frontend-only" still applies everywhere.** `signup.html` and `login.html` (ONLY these two
files) talk to a real backend. **Supabase is the SOLE ACTIVE backend as of Aug 30, 2026**
(Firebase Retirement) — see the dedicated "Firebase — RETIRED" Tech Stack entry below for
the full arc (why Firebase was chosen, what got built on it, why it was retired) and the
Supabase Migration Stage 1-3 entries for what replaced it. Every other page (all 9 dashboard
pages, the entire admin tool minus its own real Edge Function calls) is still 100%
local/`localStorage`-only for its actual data — a hybrid bridge
(`mirrorAuthenticatedClientLocally()` + `setClientAuthenticated()`, backend-agnostic by
construction) is what makes that possible regardless of which real backend authenticated the
client. `dashboard-sidebar.js` (loaded by all 10 client-facing pages) reaches whichever real
backend was actually used only via a dynamic `import()` inside the Logout click handler,
purely to call a real `signOut()` — no page gained an eager `<script type="module">` real-
backend load; `signup.html`/`login.html` remain the only pages that load a backend SDK
eagerly at page-load time.

**The full arc, summarized — see the two dedicated Tech Stack entries below for the complete
writeups.** Real Firebase Auth + Firestore + Cloud Functions (Backend Migration Phase 1, Aug
22, 2026) was built first, emulator-only, then extended to a real staging project (Phase A1,
Aug 26, 2026) — but real Cloud Functions on that real project stayed permanently BLOCKED on a
required Blaze (pay-as-you-go) plan upgrade, meaning the real admin approve/reject flow could
never actually be deployed there. Supabase Migration Stage 1 (Aug 30, 2026: local Docker
stack, schema, RLS, admin-role custom-claim hook), Stage 2 (client-facing `signup.html`/
`login.html` support against the local stack), and Stage 3 (the real cloud "Marketswave
Staging" Supabase project, real deployed Edge Functions, a real admin UI) proved out a full
replacement — **Stage 3 is the headline result: the real admin approve/reject flow is fully
live for the first time in this project's entire migration history**, since Supabase's free
tier deploys real Edge Functions with no card required. **Firebase Retirement (same day, Aug
30, 2026)** then flipped the environment switch's own default: `signup.html`/`login.html` now
default to Supabase with ZERO query params needed (local stack) or `?env=staging` (the real
Supabase cloud project) — the OLD Firebase path is retired, kept fully functional as
historical/reference code, reachable only via the new, explicit, unmistakable
`?legacyBackend=firebase` flag (never the default, never reachable by accident). Confirmed
via `git diff` at every stage that the Firebase integration itself was never modified, only
made unreachable by default — nothing about it was deleted. `dashboard-sidebar.js`'s Logout
handler runs BOTH a real Firebase `signOut()` and a real Supabase `signOut()` unconditionally
(best-effort, alongside the local session clear) — it has no idea, and doesn't need to know,
which real backend actually authenticated the current session. Do not assume Supabase has
replaced anything beyond signup/login (either environment), the real admin approve/reject
flow, and — as of Backend Migration Phase B Stages 2-3 (Aug 30, 2026, rows 115-116) — 4 of
the 7 Approval Gate queues' own schema/Edge Functions: Deposits/Withdrawals
(`deposit_requests`/`withdrawal_requests` tables + `request-deposit`/`request-withdrawal`/
`credit-deposit`/`approve-withdrawal`/`reject-deposit`/`reject-withdrawal`) and
Allocations/Sells (`allocation_requests`/`sell_requests` tables + `request-allocation`/
`request-sell`/`approve-allocation`/`approve-sell`/`reject-allocation`/`reject-sell` —
the latter two make a real internal HTTP call into Stage 1's `execute-buy`/`execute-sell`
rather than duplicating their logic). LOCAL STACK ONLY, no client-facing or admin UI wired
to any of these 4 queues yet — `deploy-capital.html`/`admin-deposits.html`/
`admin-withdrawals.html`/`asset-collection.html`/`asset-performance.html`/
`admin-allocations.html`/`admin-sells.html` all still call the local `engine-core.js`
functions — until a later Tech Stack entry says so. Every OTHER admin action (Client
Applications, HYS, Client Profile Updates, advisory fee, security log) is still 100%
local/`localStorage`.

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
**Superseded, 2026-09-05**: the exact future requirement flagged above is now genuinely
resolved — see the "Admin Auth Consolidation" entry near the end of this section. The
passphrase mechanism described above (`checkAdminPassphrase()`/`setAdminAuthenticated()`/
`isAdminAuthenticated()`/`clearAdminAuthenticated()`) is retired, not deleted (marked with a
★ RETIRED comment in `engine-core.js`), and replaced by a real Supabase Auth session as the
tool's sole access layer.

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
- **Real Supabase `signOut()` wired into the client-facing Logout action — closes Stage 2's
  own disclosed gap** (Aug 30, 2026, row 111): `dashboard-sidebar.js`'s Logout handler now
  runs a real `signOutOfSupabaseAuth()` alongside (via `Promise.all`, never instead of) the
  existing `signOutOfFirebaseAuth()` and the local session clear — mirrors that function's
  own dynamic-`import()`/best-effort/3-second-timeout shape exactly. **Investigated whether
  the same two races `signOutOfFirebaseAuth()` needed manual workarounds for also apply
  here, rather than assumed symmetric, per instruction** — checked directly against the
  actual installed `@supabase/auth-js` v2.112.4 source: **neither race applies, a genuine
  verified SDK/architecture difference, not an oversight.** Race 1 (hydration-before-
  signOut) doesn't apply because `GoTrueClient`'s own constructor auto-fires `initialize()`
  and assigns `initializePromise` synchronously, and `signOut()` itself begins with
  `await this.initializePromise` — the SDK already guarantees this, where Firebase's client
  needed an app-level `onAuthStateChanged`-wait to provide the same guarantee. Race 2
  (flush-after-resolve) doesn't apply because Supabase's session storage here is
  `localStorage` (synchronous) per `supabase-config.js`'s own `persistSession: true`
  decision, unlike Firebase's default IndexedDB-backed persistence (genuinely async,
  needing the 300ms buffer) — confirmed via `removeItemAsync()`'s own source, which is just
  `await storage.removeItem(key)`. **Verified with the exact same discipline that caught
  Firebase's two races, reused here even though it confirmed a clean result rather than
  finding a bug**: a real signed-in Supabase test client's session was checked via a FRESH
  auth-state check on the NEXT page load (a brand-new `supabase-config.js` client instance
  calling `getSession()` on `login.html`), never an in-page synchronous read. **A real bug
  WAS caught during this exact verification, but it was environmental, not logical — the
  same stale-script-cache pitfall this project has hit before (row 76 et al.)**: the first
  verification pass showed the session still present after Logout, root-caused via
  `performance.getEntriesByType('resource')` showing `dashboard-sidebar.js` loaded with
  `transferSize: 0` (served from cache) and a `decodedBodySize` (23,671 bytes) matching the
  PRE-fix file, not the real 28,042-byte current file — a hard reload (`Ctrl+Shift+R`)
  resolved it, and the identical test re-run clean: `localStorageKeyStillPresent: false`,
  `freshClientHasSession: false`. Also re-confirmed navigating directly to `dashboard.html`
  after logout correctly redirects to `login.html` (the local session guard, unaffected by
  this fix, still works). Test accounts deleted afterward. See the Backend Requirements
  Register row 111 below.
- **Supabase Migration — Stage 3: real cloud staging + Edge Functions** (Aug 30, 2026, row
  112). **★ THE REAL ADMIN APPROVE/REJECT FLOW IS FULLY LIVE FOR THE FIRST TIME IN THIS
  PROJECT'S ENTIRE MIGRATION HISTORY.** Firebase's own Cloud Functions equivalent stayed
  permanently blocked on a Blaze plan upgrade for `marketswave-staging` — the entire reason
  this project pivoted to Supabase (row 109). Supabase's free tier deploys real Edge
  Functions with no card required, and this phase proves that payoff for real: a real
  applicant can now sign up, be genuinely blocked while pending, be approved through a real
  admin UI button (not a script), and log in successfully — end to end against real cloud
  infrastructure, closing the exact gap that stayed permanently open on the Firebase side.
  A safety-net commit (the Logout fix above) was made first, per the standing high-risk-
  change convention, since this is the first stage to touch the real "Marketswave Staging"
  project at all. **Schema pushed for real**: `supabase link --project-ref
  ujnmlwbpginplfnofhhv` (confirmed via `supabase projects list` first — exactly one real
  project exists, no ambiguity about which to target), `supabase db push --dry-run` (preview
  confirmed only Stage 1's own migration would apply) then for real, and `supabase config
  push` — a genuinely separate, necessary step from the migration itself: a migration only
  creates the hook FUNCTION in Postgres, the project's real Auth service still needs to be
  told to actually call it, which `config push`'s real diff output confirmed
  (`[hook.custom_access_token] enabled = false → true`), alongside several unrelated,
  low-risk config fields (`site_url`, OTP/MFA settings) that have zero functional effect on
  this app (confirmed: no OAuth/redirect/OTP/MFA flow is used anywhere in this codebase) —
  disclosed rather than blocking on a `config push` dry-run that doesn't exist in this CLI.
  **`?backend=supabase&env=staging` now genuinely targets the real cloud project** —
  `supabase-config.js`'s `STAGING_CONFIG` (real URL + real, non-secret anon key, obtained via
  `supabase projects api-keys --reveal`) replaces Stage 2's own `console.warn`-and-fall-back
  placeholder. **Real Edge Functions**: new `supabase/functions/approve-client-application/`
  and `reject-client-application/`, mirroring `functions/index.js`'s business rules
  field-for-field, each independently service-role-privileged and re-verifying the caller's
  own JWT server-side. **A real authorization bug caught and fixed during local testing,
  before any deployment** — the first draft checked `userClient.auth.getUser().app_metadata`
  for the admin claim, confirmed via a real local sign-in test to return `undefined` even
  for a genuine admin: `getUser()` fetches the live `auth.users` DATABASE record (a
  completely different thing from the JWT's own hook-injected claims — the custom access
  token hook only ever modifies the TOKEN at issuance, never writes back to that row); the
  installed SDK's own source explicitly warns exactly this ("the user object returned by
  getUser() must not be trusted [for authorization] — always verify the JWT using
  getClaims()"). Fixed by using `getClaims(jwt)` — a real server-verified read of the actual
  injected claims, the same source RLS policies themselves read via `auth.jwt()`. Both
  functions tested locally first (`supabase functions serve`, against the local stack) —
  approve/reject both correct, plus three negative cases individually verified working
  (double-approve on an already-resolved row → 409; a genuine non-admin caller, confirmed
  via a real second sign-in, → 403 "This action requires Portfolio Manager access."; no
  Authorization header at all → 401) — before `supabase functions deploy` to the real
  project, then re-verified working against the real deployed instance directly (a real
  pending applicant created, approved via a real HTTP call to the live endpoint, confirmed
  via a direct Postgres query). **`verify_jwt = false` in `config.toml`'s `[functions.*]`
  blocks, reviewed not ignored**: the CLI's own function scaffold sets this (a
  platform-level gateway setting, unrelated to the in-function `getClaims(jwt)` check) —
  confirmed directly it does NOT weaken the real security boundary: a genuinely anonymous
  call (no real session at all) still gets a real 401 straight from the function's own code.
  Left as scaffolded rather than flipped to `true`, since the function's own check is
  already the real, tested boundary. **Real staging admin bootstrap**: new
  `scripts/supabase-staging-bootstrap-admin.js`, mirroring
  `scripts/staging-bootstrap-admin.js`'s exact credential discipline (the `service_role`
  key read from a JSON file via `SUPABASE_STAGING_CREDENTIALS_FILE`, never hardcoded or
  committed; the account's own password generated and printed once, never stored) — created
  `pm@marketswave-staging.internal` with a real `is_admin` `user_roles` row, confirmed live
  by decoding a real issued JWT. **Admin UI wired to call it**: new
  `admin-supabase-config.js` (mirrors `admin-firebase-config.js`'s password-prompt-modal
  pattern almost verbatim, `persistSession: false` — Stage 2's own recorded admin-flow
  decision, now actually implemented for the first time, not dead code);
  `admin-client-applications.html` extended to merge in a real third source (mirroring its
  own established local+Firebase merge pattern exactly) with a distinct teal "Supabase"
  badge, routing Approve/Reject through `supabase.functions.invoke()` (which automatically
  forwards the signed-in admin's own Authorization Bearer token). **Verified live, the
  complete real chain, exactly as asked, with the same rigor as Firebase's own Phase A1**:
  a real applicant signed up through the actual 9-step form against
  `?backend=supabase&env=staging`; confirmed **visually in the real Supabase dashboard's
  Table Editor** (not a script) — `status: pending_review`; confirmed login genuinely
  blocked with the real pending message; clicked **Approve in the real admin UI** — the
  browser's own network-request capture missed the underlying `functions.invoke()` call (an
  environment/tooling limitation, disclosed rather than treated as a negative result), so
  confirmation instead came from two independent, unambiguous real sources: the dashboard's
  own Edge Function Logs tab showing a real `booted`/`shutdown` cycle at the exact
  click timestamp, and a direct Table Editor re-check showing `status: active` with a fresh
  `application_resolved_at` — the only possible proof, since RLS blocks every other caller
  from writing that row (confirmed by construction in Stage 1's own migration); logged in
  again, succeeded, landed on a genuinely clean `dashboard.html` render (correct name/
  initials, $0 portfolio) with zero code changes to that page. All real test data removed
  from the cloud project afterward, confirmed via a direct query showing zero remaining
  rows. **Confirmed no regression on the local-stack path**: `supabase-golden-path-
  regression.js` re-run after all Stage 3 changes, still `GOLDEN PATH: PASS (16/16 steps)`.
  **Confirmed the entire Firebase integration remains untouched**: `git diff --stat` against
  `firebase-config.js`/`admin-firebase-config.js`/`functions/`/both `firestore.rules` files/
  `signup.html`/`login.html`/`engine-core.js` shows zero changes from this stage. New
  README.md "Stage 3" section documents the full runbook; the Logout fix's own section
  updated from "known limitation" to "Fixed." See the Backend Requirements Register row 112
  below.
- **★ Firebase — RETIRED (Aug 30, 2026). The full arc, kept as historical record, not
  deleted.** Read this before assuming anything about "the real backend" without checking
  the date of whatever section you're reading. **Why Firebase was chosen** (Aug 22, 2026,
  Backend Migration Phase 1): `signup.html`/`login.html` needed a real credential-verified
  auth system and a real Client Registry, and Firebase's Emulator Suite offered a
  fully-offline way to build and verify that without touching a real cloud project or
  billing — a deliberate, reported choice at the time (see `Marketswave_Project_Handover.md`
  §12 for the original architecture writeup). **What got built on it**: real Firebase Auth +
  Firestore + Cloud Functions, emulator-only at first (Phase 1); extended to a real, separate
  staging project, `marketswave-staging` (Phase A1, Aug 26, 2026) — real signup/login against
  real cloud infrastructure, a real staging admin bootstrap, real `firestore.staging.rules`
  deployed; a real admin UI merging local + Firebase-sourced client applications
  (`admin-client-applications.html`, `admin-clients.html`); a real `signOut(auth)` wired into
  client-facing Logout (Aug 23, 2026); `functions/index.js`'s three Cloud Functions
  (`createClientApplication`/`approveClientApplication`/`rejectClientApplication`), fully
  written and tested against the local emulator. **Why it was retired**: the one piece that
  never shipped for real was the actual point of having Cloud Functions at all — deploying
  them to the real `marketswave-staging` project (Phase A2) required a Blaze (pay-as-you-go)
  billing plan upgrade, which stayed permanently blocked for the length of this project. That
  meant the real admin approve/reject flow — the core PM workflow this whole migration exists
  to support — could never actually run against real infrastructure on Firebase, only the
  local emulator. Supabase's free tier deploys real Edge Functions with no card required;
  Supabase Migration Stage 3 (Aug 30, 2026, same day as retirement) proved a full,
  real-cloud-verified replacement in one session, closing the exact gap Phase A2 could never
  close. **What "retired" means concretely**: every Firebase file (`firebase-config.js`,
  `admin-firebase-config.js`, `functions/index.js`, `firestore.rules`,
  `firestore.staging.rules`, `scripts/bootstrap-admin.js`, `scripts/staging-bootstrap-
  admin.js`, `scripts/staging-approve-client.js`, `scripts/golden-path-regression.js`) is
  marked with a dated `★ RETIRED` header comment explaining this same arc, and remains fully
  functional, byte-for-byte unmodified in its actual logic — confirmed via `git diff` that
  retirement touched ZERO lines inside any of these files' own working code, only added
  header comments. The real, untouched `marketswave-staging` Firebase project and the real,
  never-connected "Marketswave SE" production project both still exist exactly as before —
  retirement is a code-reachability and documentation change, not an infrastructure teardown.
  See the "Firebase Retirement" entry directly below for the mechanics of how the code paths
  were actually disabled, and the Backend Requirements Register (row 113) for the item-by-item
  mapping of every remaining Firebase-specific register row to its Supabase equivalent.
- **Firebase Retirement — Supabase becomes the sole active backend, environment switch
  inverted** (Aug 30, 2026, row 113). Closes the loop Supabase Migration Stage 3 opened —
  Supabase now proven to fully replace Firebase's own real admin approve/reject flow, so the
  environment switch's own DEFAULT flips: `signup.html`/`login.html` now reach Supabase with
  ZERO query params needed (was: Firebase emulator by default), or `?env=staging` for the
  real Supabase cloud project. **Switch mechanism decision, reported per instruction: kept,
  not removed, inverted, with a new distinctly-named explicit flag** — `supabase-config.js`'s
  `IS_SUPABASE_BACKEND` now defaults to `true` and only flips to `false` when a NEW,
  unmistakable `?legacyBackend=firebase` param is present (deliberately not reusing
  `backend=firebase`, which would be too easy to type by analogy with the still-supported
  `?backend=supabase` synonym kept for backward compatibility with every existing Stage 2/3
  script and habit). **Confirmed sufficient by reading `signup.html`/`login.html`'s own
  control flow before deciding, not assumed**: both files already checked
  `IS_SUPABASE_BACKEND` first and `return`ed before ever reaching their own Firebase branch —
  flipping this one boolean's default is the entire mechanism; zero restructuring needed in
  either file. Both Firebase branches (in `signup.html`/`login.html`) and the Firebase
  imports immediately above them got their own inline `★ RETIRED` marker comments, confirming
  they're reached only via the explicit flag now. **`admin-client-applications.html`** (not
  literally named in the task's own file list, but the other real runtime reach point,
  extended to cover per the retirement's own stated goal of "Supabase as the sole active
  backend"): its Firebase Firestore merge — previously running unconditionally on every page
  load — is now gated behind a new `LEGACY_FIREBASE_ENABLED` constant, hardcoded `false`
  (not a URL param, since this admin page never had one before and the retired path here is
  meant for deliberate code-level opt-in during reference testing, not casual URL-typing);
  flipping it to `true` re-enables the exact same working code, unmodified. **`git diff`
  confirmed**: every actual Firebase file's own internal logic is byte-for-byte unchanged —
  only header/inline comments were added anywhere inside them; the only FUNCTIONAL changes
  are the inverted default in `supabase-config.js` and the new gate in
  `admin-client-applications.html`. **Verified live, both Supabase environments completely
  unaffected — this was a pure Firebase-side change, confirmed not assumed**: re-ran
  `scripts/supabase-golden-path-regression.js` against the local stack, `GOLDEN PATH: PASS
  (16/16 steps)`, identical to before retirement; separately confirmed via a real browser
  session that a plain `signup.html`/`login.html` load with NO query params now reaches
  Supabase (not Firebase) by default, that `?legacyBackend=firebase` genuinely restores the
  old Firebase behavior, and that the browser's own Network panel shows **zero** requests to
  any Firebase endpoint (`identitytoolkit.googleapis.com`/`firestore.googleapis.com`/
  emulator ports) on a default page load — the static ES module imports of
  `firebase-config.js` still execute (harmless — pure endpoint configuration, no network I/O
  of their own, confirmed directly) but nothing downstream ever calls them unless the legacy
  flag is present. README.md's Supabase runbook and every retired Firebase section (each now
  carrying its own retirement banner) and CLAUDE.md updated in place; Backend Requirements
  Register row 113 added.
- **Backend Migration Phase B — Stage 1: the portfolio engine goes server-side, real
  Supabase tables** (Aug 30, 2026, row 114): **the highest-risk category of work in this
  entire migration — real money figures, going server-side for the first time.** Local
  stack only, same discipline as every prior Supabase stage — does not touch the real cloud
  "Marketswave Staging" project. Prior stages moved identity (Client Registry/Auth); this
  stage moves Account State, Holdings, and the Transaction ledger — the actual financial
  engine. **Schema, real migration files**: `products` (global, unscoped, mirrors
  `engine-core.js`'s Product Catalog) and `advisory_fee_rate` (a genuinely global singleton
  table — `id boolean primary key default true` + `check(id)` — deliberately NOT per-client,
  preserving the "genuinely global, not per-client" fix already locked in for the local
  engine) were added beyond the task's own literal 3-table list, flagged explicitly as
  necessary dependencies of the 3 named tables, not scope creep. `account_state` (`client_id
  uuid primary key references auth.users(id)`, `unallocated_capital`/`allocated_capital`/
  `asset_returns numeric`), `holdings` (`id uuid default gen_random_uuid()`, `client_id`,
  `product_id references products(id)`, `units`/`cost_basis numeric`, `UNIQUE(client_id,
  product_id)`), `transactions` (`id uuid default gen_random_uuid()`, `client_id`,
  `product_id` nullable — DEPOSIT/WITHDRAWAL have no product — `type CHECK IN ('BUY','SELL',
  'DEPOSIT','WITHDRAWAL')`, `units`/`price`/`total_value`/`realized_return numeric`,
  `status`, `created_at`). **`gen_random_uuid()` chosen over the local engine's own
  sequential `TXN-XXXX`/`PROD-XXXX` id scheme, flagged as a genuine infrastructure adaptation,
  not a business-rule change** — a concurrency-safety property sequential ids don't give for
  free under real concurrent writers. **RLS, the core security property, verified with the
  same 16/16-style rigor as the Approval Gate unification**: a client may `SELECT` only their
  own rows across all 5 tables (self-or-admin, reusing Stage 1's own `public.is_admin()`
  helper); **no client-side INSERT/UPDATE/DELETE path exists on any of the 5 tables for any
  role, including admin** — every write goes exclusively through a service-role-authenticated
  Edge Function, the identical write-path property already locked in for the `clients` table
  in Stage 1. **Business logic, ported not reinterpreted**: new shared
  `supabase/functions/_shared/portfolio-engine.ts` is a byte-for-byte TypeScript port of
  `engine-core.js`'s own settlement math — the FNV-1a hash → mulberry32 PRNG → Box-Muller
  transform chain, `RISK_TIER_RETURN_CONFIG`, the GBM log-return NAV-tick formula, and the
  lazy day-by-day settlement catch-up — deliberately written in TypeScript/Deno rather than
  SQL/plpgsql specifically because Deno runs V8, guaranteeing bit-identical `Math.imul`/
  `>>> 0` bitwise semantics to the original browser-side JS; a SQL port could not make that
  guarantee. 6 new Edge Functions: `get-account-state`/`get-holdings`/
  `get-transaction-ledger`/`get-total-portfolio-value` (self-or-admin — a caller may omit
  `clientId` to read their own data, or pass another client's id only if their own JWT carries
  `app_metadata.is_admin === true`, checked via `getClaims(jwt)` — never `getUser()`, which
  reads the live `auth.users` DB record instead of the JWT's own hook-injected claims, a real
  bug already caught once in Stage 3's own Edge Functions and avoided here from the start;
  the first 3 settle every product via `settleAllProducts()` before reading, matching the
  local engine's own "lazy catch-up runs once per engine load" behavior) and `execute-buy`/
  `execute-sell` (the money-moving primitives, exact ports of `executeBuy(clientId,
  productId, dollarAmount)`/`executeSell(clientId, productId, unitsToSell)` — **deliberately
  ADMIN-ONLY, not client-callable**, mirroring that the real local engine's own
  `executeBuy`/`executeSell` are never invoked directly by client-facing code either, only
  via a PM-approval action; each settles only the ONE traded product via a new
  `settleOneProduct()`, not the whole catalog, matching exactly which local function the
  original calls). **The one detail most likely to get subtly wrong in a careless port,
  called out explicitly in `execute-sell/index.ts`'s own header comment and preserved
  exactly**: `unallocated_capital` is credited with the COST-BASIS PORTION of a sale
  (`costBasisPortion = holding.cost_basis × (unitsToSell / holding.units)`), NOT the full
  sale value — the gain/loss (`realizedReturn = saleValue − costBasisPortion`) is credited
  SEPARATELY to `asset_returns`; cost basis is PROPORTIONAL to the sold fraction, not
  FIFO/LIFO lot tracking, since holdings aren't tracked as discrete lots here either. New
  `scripts/supabase-seed-portfolio.js` ports `buildSeedData()`'s exact math (same
  `SEED_PRODUCTS`, same unit-price/cost-basis/`unallocatedCapital` derivation) to seed a
  demo Supabase Auth client for local testing — produces the identical numbers the local
  engine's own seed always has ($1,284,500 Total Portfolio Value, $205,520 unallocated,
  $1,078,980 allocated). **Verified**: `scripts/verify-supabase-portfolio-engine.js`, a new
  40-assertion suite, run twice for repeatability, 40/40 passing both times — settlement
  determinism (the same product, seeded to the same past `last_tick_date`, ticked on BOTH
  the real unmodified `engine-core.js` source, loaded into a Node `vm` sandbox via the
  existing `scripts/lib/engine-harness.js`, AND the real deployed Edge Function stack,
  asserted to settle to the byte-identical price — not just "the ported code looks right,"
  an actual cross-implementation proof; also confirms same-day idempotency); the exact
  proportional cost-basis/unallocated-vs-asset_returns split formula against a controlled
  scenario; Total Portfolio Value exactly conserved through a real round-trip buy-then-sell;
  cross-client isolation (resolving an action for one client, then diffing a second client's
  `account_state`/`holdings`/`transactions` byte-for-byte against a pre-action snapshot,
  confirming zero leakage — the identical rigor standard set by "Approval Gate unification");
  the full RLS matrix (self-reads succeed, cross-client reads return empty, zero
  INSERT/UPDATE/DELETE succeeds on any of the 5 tables for any role including admin, `anon`
  sees nothing); and `execute-buy`/`execute-sell` authorization (401 unauthenticated, 403
  non-admin, confirmed no state change on rejection). **A real test-hygiene bug found and
  fixed during verification, not a port bug**: the determinism test deliberately ticks a
  product forward several days, then restores its price/`last_tick_date` afterward — the
  first pass restored the product but never forced a recompute of the demo client's own
  `allocated_capital` (which had been computed against the temporarily-ticked price mid-test
  and was left stale, $1,091,099.93 vs. the correct $1,078,980) — fixed by adding a second
  `get-total-portfolio-value` call after restoring the product, forcing a fresh recompute;
  re-ran the full suite afterward to confirm a genuinely clean baseline. Both new scripts
  added to `scripts/package.json`. README.md's Supabase runbook gained a new "Backend
  Migration Phase B — Stage 1" section with the full step-by-step local rebuild sequence.
  **What's now server-authoritative** (for the local Supabase stack): Account State,
  Holdings, and the Transaction ledger's raw read/write primitives, for a client's own
  portfolio data, RLS-secured, with business logic byte-for-byte cross-verified against the
  real local engine. **What still is not, awaiting its own future Phase B stage**: the
  client-facing request/approval GATING layer around those primitives — all seven Approval
  Gate queues (Client Applications, Deposits, Withdrawals, Allocations, Sells, HYS Deposits,
  Client Profile Updates) — plus High Yield Savings and the Documents/Support domains, all
  still 100% local/`localStorage` via `engine-core.js`, completely unaffected by this stage.
  Backend Requirements Register row 114 added.
- **Backend Migration Phase B — Stage 2: Deposits and Withdrawals move to real Supabase
  tables + Edge Functions** (Aug 30, 2026, row 115): the first two of the seven Approval Gate
  queues to move off `engine-core.js`/`localStorage`. Local stack only, same discipline as
  every prior stage — the real cloud "Marketswave Staging" project is untouched. **Schema**:
  new migration adds `deposit_requests`/`withdrawal_requests`, mirroring
  `DEPOSIT_REQUESTS_KEY`/`WITHDRAWAL_REQUESTS_KEY`'s real field shapes read directly from
  `requestDeposit()`/`creditDepositRequest()`/`rejectDepositRequest()`/`requestWithdrawal()`/
  `approveWithdrawal()`/`rejectWithdrawal()`, not reinvented — `details`/`destination_details`
  stay generic `jsonb`, matching the local engine's own already-generic shape (crypto/bank
  populate different real keys; `admin-deposits.html`'s own `humanizeKey()`/`detailsHTML()`
  already renders it generically for exactly this reason). `transaction_id` on both tables
  references `public.transactions(id)` directly — the exact forward-compatibility use Stage
  1's own `transactions.type` CHECK constraint already anticipated. `gen_random_uuid()` for
  both tables' ids, same infrastructure adaptation as Stage 1's `holdings`/`transactions`
  (not a business-rule change). **RLS**: a client may `INSERT` only their own row with
  `status` forced to literally `'pending'` (mirrors the `clients` table's own
  insert-forces-a-status pattern) and `SELECT` only their own rows; admins can `SELECT` all
  (`public.is_admin()`, consistent with every other table in this schema); no `UPDATE`/
  `DELETE` policy exists for `authenticated`/`anon` on either table — resolving a request is
  reserved exclusively for `service_role`, via the 6 new Edge Functions. **Edge Functions,
  ported faithfully**: `request-deposit`/`request-withdrawal` (client-callable, self-only —
  `clientId` always derived from the caller's own verified JWT via `getClaims(jwt).sub`,
  never trusted from the request body) create a pending row only, touching nothing else;
  `request-withdrawal` also re-implements the local engine's own pre-check that the requested
  amount can't exceed the client's *current* `unallocated_capital`. `credit-deposit`/
  `approve-withdrawal`/`reject-deposit`/`reject-withdrawal` (admin-only, `getClaims(jwt)` —
  never `getUser()`, the exact authorization bug already caught once in Stage 3 and avoided
  here from the start) resolve a request by `requestId` alone, since the row itself already
  carries `client_id`. **The PM-editable-confirmed/approved-amount property, preserved
  exactly**: `credit-deposit`'s `confirmedAmount` and `approve-withdrawal`'s `approvedAmount`
  are both authoritative and may differ from what was originally requested, carried forward
  unchanged from the local engine's own judgment calls, not relitigated. **THE property this
  stage most had to preserve, per instruction**: `approve-withdrawal` re-validates against
  the client's *current* `unallocated_capital` at approval time, not the balance at request
  time — proven by a dedicated test approving two individually-valid pending requests
  back-to-back where only the first can actually be approved, confirming the second is
  correctly refused (409) rather than driving the balance negative, and stays genuinely
  `pending` afterward. **Zero-balance default on a missing `account_state` row — a faithful
  port, not new leniency**: `readAccountStateForClient()`'s real local behavior always
  defaults to `{ unallocatedCapital: 0, ... }` rather than throwing "not found," and
  `writeAccountStateForClient()`'s `localStorage.setItem()` always creates-or-overwrites
  unconditionally — reproduced server-side via `.upsert()` rather than requiring a
  pre-existing row (confirmed: a client with no `account_state` row yet correctly gets one
  created on their first credited deposit, seeded with exactly the confirmed amount, and
  correctly gets *rejected* for any withdrawal request since $0 is correctly treated as their
  current balance). **Verified**: new `scripts/verify-supabase-deposits-withdrawals.js`, 76
  assertions, 76/76 passing — every validation path on both client-callable functions; the
  PM-editable-amount property proven with a real differing confirmed/requested pair on both
  deposits and withdrawals; the exact re-validation-at-approval-time edge case specified;
  double-resolve protection (409, zero state change); cross-client isolation (byte-for-byte
  diff of a second, independently-active client's rows before/after the first client's full
  deposit+withdrawal activity, confirmed non-vacuous); the full RLS matrix on both new tables;
  and authorization negative cases (401/403) on all 6 functions. Plus the full existing
  Supabase suite re-run alongside with zero regressions: `verify-supabase-schema.js` 16/16,
  `verify-supabase-portfolio-engine.js` 40/40, `supabase-golden-path-regression.js`
  `PASS (16/16 steps)`. **No client-facing or admin UI wired to these new Edge Functions
  yet** — `deploy-capital.html`/`admin-deposits.html`/`admin-withdrawals.html` still call the
  local `engine-core.js` functions; this stage is schema + Edge Functions + Node verification
  only, per the task's own scope. Backend Requirements Register row 115 added.
- **Backend Migration Phase B -- Stage 3: Allocations and Sells move to real Supabase
  tables + Edge Functions** (Aug 30, 2026, row 116): two more of the seven Approval Gate
  queues are now server-authoritative -- 4 of 7 total after this stage. Local stack only,
  real cloud "Marketswave Staging" untouched. **Meaningfully different from Stage 2, per
  instruction**: `allocation_requests`/`sell_requests` don't stand alone -- they resolve
  INTO Stage 1's already-built, already-verified `execute-buy`/`execute-sell` functions
  rather than directly mutating `account_state`/`holdings` themselves. **Schema**: new
  migration adds `allocation_requests`/`sell_requests`, mirroring `REQUESTS_KEY`/
  `SELL_REQUESTS_KEY`'s real field shapes -- neither table carries a PM-editable-amount
  column, a faithful reflection of the real local engine: both approve functions execute
  the exact requested amount/units, no PM edit step (unlike deposits/withdrawals).
  `product_id` references `public.products(id)` directly. **RLS reused verbatim from Stage
  2, not redesigned, per instruction.** **Edge Functions, ported faithfully**:
  `request-allocation`/`request-sell` (client-callable, self-only via `getClaims(jwt).sub`)
  create a pending row only; `request-allocation` validates against the product's own
  `minimum_investment` and the client's current `unallocated_capital` (zero-default);
  `request-sell` validates against the client's current holding (zero-holdings default).
  **Investigated and reported, per instruction, rather than assumed either way**: the real
  local `requestSell()` has NO "sum of this client's own other pending sell requests"
  guard -- that guard lives entirely in `asset-performance.html`'s own client-side UI code,
  not inside `requestSell()` itself (confirmed by reading its real source) -- so nothing was
  ported here beyond what `requestSell()` actually does; the real backstop is `approve-sell`'s
  own re-validation, proven in its own dedicated test. **THE ACTUAL POINT OF THIS STAGE**:
  `approve-allocation`/`approve-sell` make a REAL, LIVE HTTP call to Stage 1's already-
  deployed `execute-buy`/`execute-sell` functions -- forwarding the ORIGINAL CALLER'S OWN
  verified JWT as the Authorization header, so `execute-buy`/`execute-sell`'s own
  independent admin check passes identically with no service-role bypass needed -- rather
  than duplicating either function's settlement/cost-basis logic. Proven, not just
  asserted: a dedicated test calls `approve-allocation` for Client A and a DIRECT
  `execute-buy` call for Client B on the same product/day with a different dollar amount,
  confirming both entry points settle to the IDENTICAL unit price and units-from-price
  formula; the same proof runs for `approve-sell`/`execute-sell` with identical starting
  holdings, confirming byte-identical saleValue/realizedReturn/remaining-holding figures
  through both entry points. **A REAL, DELIBERATE STRENGTHENING BEYOND THE LOCAL ENGINE,
  FLAGGED PER INSTRUCTION, NOT SILENTLY ADDED**: the real local `approveAllocationRequest()`
  does NOT re-validate against the client's current `unallocatedCapital` before calling
  `executeBuy()` -- a genuine asymmetry with `approveSellRequest()`, which already does
  re-validate against current holdings. Per this stage's own explicit instruction,
  `approve-allocation` ADDS this re-validation -- proven with the exact specified edge case
  (two individually-valid pending allocation requests that together exceed current
  capital; only the first can be approved, the second is refused 409 and stays genuinely
  pending). `approve-sell`'s own equivalent re-validation is a FAITHFUL PORT, not a new
  addition -- proven with the mirrored edge case (two pending sell requests exceeding held
  units), including the holdings-row-deletion path (a 100%-sold holding is correctly
  treated as 0 units for any further pending approval). **Verified**: new
  `scripts/verify-supabase-allocations-sells.js`, 88 assertions, 88/88 passing on the first
  run -- every validation path, the investigated "no pending-sum guard" finding, the
  internal-call-not-reimplementation proof for both approve functions, both
  re-validation-at-approval-time edge cases, reject-with-reason for both queues,
  cross-client isolation, the full RLS matrix, and authorization negative cases (401/403)
  on all 6 functions. Plus the full existing Supabase suite re-run alongside with zero
  regressions: `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js`
  40/40, `verify-supabase-deposits-withdrawals.js` 76/76 (132 total, unaffected), and
  `supabase-golden-path-regression.js` `PASS (16/16 steps)`. **No client-facing or admin UI
  wired to these new Edge Functions yet** -- `asset-collection.html`/`asset-performance.html`/
  `admin-allocations.html`/`admin-sells.html` still call the local `engine-core.js`
  functions; this stage is schema + Edge Functions + Node verification only, per the
  task's own scope. Backend Requirements Register row 116 added.
- **Backend Migration Phase B -- Stage 4: HYS pockets + HYS Deposit Approval Gate move to real
  Supabase tables + Edge Functions** (2026-09-02, row 117): 5 of the 7 Approval Gate queues
  are now server-authoritative after this stage -- only Client Applications and Client
  Profile Updates remain local. Local stack only, real cloud "Marketswave Staging" untouched.
  **A standing convention change lands with this task**: Node/API-level verification against
  the local Supabase stack is now the DEFAULT for this project going forward -- browser
  automation is used only when a task explicitly says "browser-verify" and states why
  Node-level testing genuinely can't cover it (a real visual/CSS issue, or confirming actual
  rendered UI behavior). This formalizes what Phase B's Stages 1-3 were already mostly doing
  in practice, not a new restriction on top of prior work. **Schema**: `hys_pockets` (created
  ONLY by `credit-hys-deposit`, service_role -- no client-side INSERT policy exists at all,
  even a genuinely-own one, mirroring the real local engine's own sole-writer discipline),
  `hys_deposit_requests`, and a genuinely necessary addition beyond this stage's own literal
  2-table schema list, flagged per instruction rather than silently added:
  `hys_withdrawal_requests` -- the task's own EDGE FUNCTIONS section explicitly asked for
  `request-hys-withdrawal`/`approve-hys-withdrawal`/`reject-hys-withdrawal`, which have
  nowhere to persist a pending withdrawal request without their own table, the same category
  of unnamed-but-necessary dependency Stage 1's own `products`/`advisory_fee_rate` already
  were. **Field-value fidelity, called out because the task's own paraphrase differs from the
  real engine, reported not silently changed**: the task's SCHEMA bullet describes
  `pocket_type` as `"fixed_deposit|as_you_want"`, but the real `engine-core.js` source stores
  exactly `'fixed'` and `'ayw'` -- this migration uses the REAL stored values, not the task's
  descriptive paraphrase, per the standing "read the real source, don't reinvent" discipline
  every prior stage has followed; likewise `term_months`/`term_years` stay two separate
  nullable columns (mirroring the real engine's own two separate fields, only one populated
  per `termMode`) rather than collapsing to the task's single "term_value" paraphrase. **A
  real, disclosed gap found while reading the local source before writing any schema, not
  assumed from the task's own description**: `high-yield-savings.html`'s own client-side
  `updatePocketStatuses()` -- NOT `engine-core.js` -- is the only place a fixed pocket ever
  transitions from `active` to a third status, `matured`, once its `maturityDate` passes,
  persisted directly to the local pockets store outside any engine function.
  `computeHYSWithdrawalAmount()`/`requestHYSWithdrawal()` both key their forfeiture logic off
  `pocket.status === 'active'` specifically (not "matured OR withdrawn"), so this
  third status is load-bearing for the forfeiture-vs-matured distinction the task itself asked
  to be verified -- `hys_pockets.status`'s CHECK constraint includes `'matured'` for this
  reason, caught and fixed by editing the migration file and applying the equivalent live
  ALTER TABLE before any verification ran (a full `db reset` was deliberately avoided since it
  would have wiped real pre-existing local test data -- the bootstrap PM account and several
  real signed-up local test users already sitting in this machine's local stack -- that this
  session did not create and had no basis to discard). No Edge Function in this stage performs
  the active-to-matured transition itself, since there is no client-facing HYS UI wired to
  Supabase yet to port that page-load-time behavior from -- the same "schema + Edge Functions
  + Node verification only, no UI wiring yet" scope every other Stage 3/4 table has shipped
  with. **RLS**: `hys_deposit_requests`/`hys_withdrawal_requests` both mirror Stage 2's own
  INSERT-own-as-pending + SELECT-own + admin-SELECT-all shape exactly; `hys_pockets` gets
  SELECT-own + admin-SELECT-all only, no INSERT policy for `authenticated` at all. **Edge
  Functions, ported faithfully, `getClaims(jwt)` throughout, never `getUser()`**: a new shared
  `_shared/hys-engine.ts` holds `getHysRate()`/`computeHysWithdrawalAmount()` as the single
  source of truth for both `request-hys-deposit` and `credit-hys-deposit`/
  `request-hys-withdrawal` -- the same drift-prevention discipline the local engine's own
  Backend Requirements Register row 34 fix already established, applied here from the start
  rather than duplicated once and cleaned up later. `credit-hys-deposit` preserves, exactly:
  the PM-editable confirmed amount (may differ from what was requested); `maturity_date`
  computed from the CREDIT date, not the original request date; `projected_interest` computed
  from the CONFIRMED amount, not the requested one; and never touches `account_state` at all
  (HYS is its own pool, funded/paid out externally). `request-hys-withdrawal` preserves: a
  pocket must exist, belong to the caller, not already be withdrawn; a locked-term Fixed
  Deposit still `active` cannot be withdrawn early (a hard block) while a SHORT-term one CAN
  be (it just forfeits interest, a real and load-bearing distinction, not an inconsistency);
  and only one pending withdrawal request may exist per pocket at a time.
  `approve-hys-withdrawal` re-validates against the pocket's CURRENT state at approval time
  (not the request-time snapshot) -- mirroring `approve-withdrawal`/`approve-sell`'s own
  re-validation discipline -- and, symmetric with `credit-hys-deposit`, never touches
  `account_state` either; still lands a real `HYS_WITHDRAWAL` transaction so the activity is
  visible in one place. `transactions.type`'s CHECK constraint widened to include
  `HYS_DEPOSIT`/`HYS_WITHDRAWAL`, mirroring Stage 2's own DEPOSIT/WITHDRAWAL forward-
  compatibility widening exactly. **Verified**: `node scripts/verify-supabase-hys.js`, a new
  103-assertion suite, **103/103 passing on the first run** -- every validation path across
  Fixed (both short-term and locked-term) and As-You-Want pockets; the PM-editable-amount and
  credit-date-not-request-date properties, with real numeric proof (a 1-year 14% locked
  deposit's `projected_interest` computed as exactly `7500 * 0.14 * 1 = 1050` off the
  PM-confirmed $7,500, not the requested $8,000); the locked-vs-short-term early-withdrawal
  distinction; the forfeiture-vs-matured distinction (an active fixed pocket forfeits interest,
  a matured one does not, an AYW pocket never forfeits); a duplicate-pending guard per pocket;
  **the re-validation-at-approval-time edge case** -- a pocket independently withdrawn out from
  under a still-pending request correctly fails approval (409) rather than double-withdrawing
  it, and the request stays genuinely pending, not silently resolved; the symmetric
  external-payout property confirmed directly against `account_state` (zero rows created by
  either `credit-hys-deposit` or `approve-hys-withdrawal`); cross-client isolation across all 3
  new tables via a byte-for-byte diff, confirmed non-vacuous; the full RLS matrix, including
  `hys_pockets`' own no-client-INSERT-at-all property; and authorization negative cases
  (401/403) on all 6 functions. The full existing Supabase suite was re-run alongside with
  zero regressions: `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js`
  40/40, `verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js`
  88/88 (323 total, unaffected), `supabase-golden-path-regression.js` `PASS (16/16 steps)`.
  **No client-facing or admin UI wired to these new Edge Functions yet** --
  `high-yield-savings.html`/`admin-hys.html` still call the local `engine-core.js` functions;
  this stage is schema + Edge Functions + Node verification only, per the task's own scope.
  Backend Requirements Register row 117 added.
- **★ Backend Migration Phase B -- Stage 5: the final two Approval Gate queues, Client
  Applications and Client Profile Updates, move to real Supabase tables + Edge Functions**
  (2026-09-02, row 118). **ALL 7 OF 7 APPROVAL GATE QUEUES ARE NOW SERVER-AUTHORITATIVE
  (LOCAL STACK ONLY) -- this closes the entire "Approval Gate" category of Phase B work.**
  Local stack only, real cloud "Marketswave Staging" untouched. **Client Applications --
  investigated first, per instruction, before writing a line of schema. Found genuinely
  ALREADY FULLY BUILT since Stage 3 (Aug 30, 2026) -- nothing new was built for this domain.**
  Confirmed by reading the real, already-shipped source: the `clients` table (Stage 1) already
  carries `status`/`application_resolved_at`/`application_reason` -- "the queue" IS
  `SELECT * FROM clients WHERE status = 'pending_review'`, exactly as the task's own
  instruction predicted; creation already happens via a direct, RLS-enforced insert from
  `signup.html` (Stage 2/3); `approve-client-application`/`reject-client-application` (Stage 3)
  already exist, are already deployed to real staging, and are already enabled for local
  `supabase functions serve`; `admin-client-applications.html` (Stage 3) already lists real
  Supabase `pending_review` rows and already routes Approve/Reject through
  `supabase.functions.invoke()`. **The one genuine gap, closed by this stage**: no PERSISTENT
  Node script previously exercised these two already-existing functions against the LOCAL
  stack with this project's own standing rigor -- Stage 3's own verification was real-cloud-
  and-browser, not a committed local suite; the `clients` table's own full RLS matrix is
  already thoroughly covered by `verify-supabase-schema.js` (re-run alongside, not
  duplicated). **Client Profile Updates -- genuinely new**. Schema: `client_profiles` (a
  genuinely necessary addition beyond the task's own literal 2-table schema list, flagged per
  instruction, mirroring Stage 4's own "necessary addition" precedent -- `request-profile-
  change`'s own spec requires "snapshots the client's actual current value automatically,"
  which is only possible with a real server-side profile store to snapshot FROM; mirrors the
  local engine's own SETTINGS_PROFILE_KEY, deliberately separate from the Client Registry, not
  columns bolted onto `clients`) and `profile_change_requests`, which also picked up a second
  necessary addition, `resolution_note` -- the real local `rejectSettingsChangeRequest()`
  keeps this DELIBERATELY SEPARATE from the client's own `reason` (their reason is "why I want
  this change," the PM's resolutionNote is "why I'm rejecting it"; conflating them would
  silently discard the client's own context). **Field-value fidelity, called out because the
  task's own paraphrase differs from the real engine, same finding category as Stage 4's
  `pocket_type`**: the task's SCHEMA bullet describes `field` as
  `"legal_name|address|id_document"`, but the real `REQUESTABLE_SETTINGS_FIELDS` array is
  exactly `['legalName', 'address', 'idDocument']` (camelCase, the literal JS property names)
  -- this migration's CHECK constraint uses the REAL stored values. **CONFIRMED, per
  instruction, not assumed: `dateOfBirth` is genuinely gone** -- read directly off the real
  array, three fields only, with the local engine's own comment confirming the deliberate
  removal (Aug 21, 2026) and that old `dateOfBirth` records already in local test data are
  left resolvable but not migrated; this migration ports the CURRENT three-field reality.
  **No-fake-fallback design, ported forward from a real fix already made once locally**: the
  local engine's own `REQUESTABLE_SETTINGS_DEFAULTS` ("John A. Doe" / a fake Boston address)
  was itself a bug closed by a later local fix (register row 80) -- a Supabase-side client has
  no seeding step yet, so this port goes straight to the ALREADY-FIXED behavior:
  `request-profile-change` reads a missing `client_profiles` row/column back as genuine `null`,
  never a fabricated placeholder. **Edge Functions, ported faithfully, `getClaims(jwt)`
  throughout, never `getUser()`**: `request-profile-change` (client-callable, self-only)
  snapshots `current_value` server-side from `client_profiles` (never trusted from the caller)
  and rejects a second pending request for the same field, same per-field duplicate guard as
  the local function; `approve-profile-change` (admin-only) genuinely applies
  `requested_value` to the client's real `client_profiles` row via `.upsert()` (a client's
  first-ever approved change correctly CREATES the row, not just an update against something
  assumed to already exist) -- confirmed the field is replaced WHOLESALE, not merged
  key-by-key, matching the local engine's own `profile[request.field] = request.requestedValue`
  behavior exactly; `reject-profile-change` (admin-only) marks rejected with a `resolutionNote`
  and moves nothing. **Verified**: new `scripts/verify-supabase-final-approval-gate.js`, 69
  assertions, 69/69 passing -- Part 1 (Client Applications, 12 assertions): real state
  transitions for both approve and reject against genuine `pending_review` rows, double-
  resolve protection, cross-client isolation, and auth negative cases against the already-
  existing functions; Part 2 (Client Profile Updates, 57 assertions): validation for all 3
  fields; the no-fake-fallback null snapshot; **field-specific correctness proven for EACH of
  the 3 fields individually, per instruction, not one tested as a stand-in for all three** (a
  real legalName approval, a real address approval, and a real idDocument approval, each
  confirmed on the SAME profile row without clobbering the other two, plus a second legalName
  change proving wholesale replacement); cross-client isolation; the full RLS matrix,
  including that `client_profiles` has NO client-side INSERT path at all; and authorization
  negative cases (401/403) on all 3 new functions. The full existing Supabase suite was
  re-run alongside with zero regressions: `verify-supabase-schema.js` 16/16,
  `verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js`
  76/76, `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 103/103 (392
  total, unaffected), `supabase-golden-path-regression.js` `PASS (16/16 steps)`. **No
  client-facing UI wired to `request-profile-change` yet** -- `settings.html` still calls the
  local `engine-core.js` function; `admin-client-applications.html` already calls the real
  (pre-existing) Client Applications functions, but no admin UI exists yet for Client Profile
  Updates specifically -- `admin-profile-updates.html` still calls the local `engine-core.js`
  functions. This stage is schema + Edge Functions + Node verification only for Client
  Profile Updates, per the task's own scope. Backend Requirements Register row 118 added.
- **★ Backend Migration Phase B -- Stage 6: Documents & Support move to real Supabase tables
  + Edge Functions** (2026-09-02, row 119). **EVERY DOMAIN FROM THE ORIGINAL ENGINE NOW HAS
  REAL SUPABASE SCHEMA/FUNCTIONS (LOCAL STACK ONLY) -- this closes the entire backend-logic
  portion of Phase B.** Local stack only, real cloud "Marketswave Staging" untouched.
  **★ ARCHITECTURAL NOTE, per instruction, investigated before writing a line of schema**:
  Documents & Support are NOT Approval Gate queues -- they were deliberately categorized
  separately (User/Admin Relations) from the start, and their real local behavior reflects
  that. Confirmed by reading `documents.html`/`support.html`/`admin-documents.html`/
  `admin-support.html` directly: a client calls `addDocument()` (upload), `updateDocument()`
  (Sign), and `removeDocument()` (Remove) DIRECTLY, with NO gate; a client's own dispute-
  submit handler creates a support ticket immediately, `status: 'Open'`, no pending/approved/
  rejected step at all. Only `publishDocumentToClient()`, `updateDocumentForClient()` (e.g.
  admin-documents.html's "Mark Reviewed"), and `updateSupportRequestForClient()` (status +
  pmNote) are admin-only additions, confirmed via grep to have zero call sites in either
  client-facing page. **The schema deliberately does NOT copy Stages 2-5's "zero client-side
  write, everything through service_role" pattern** -- that pattern fit those seven genuinely
  request-then-approve queues; reflexively copying it here would misrepresent a real
  structural difference this project's own `admin-sidebar.js` nav grouping already encodes.
  **Documents schema, field shape confirmed against the real source, not assumed**: `category`'s
  real value set is `'Contracts'`/`'Statements & Reports'`/`'General'` (the client's own
  upload-category dropdown) PLUS a genuinely real 4th value, `'Signature Required'`,
  selectable only from `admin-documents.html`'s own publish-category dropdown -- a real,
  slightly unusual pre-existing UI quirk (independent of the separate `signatureRequired`
  checkbox), not invented here; `status`'s real value set spans `null`/`'Received'`/
  `'Under Review'`/`'Reviewed'`/`'Signature Required'`/`'Signed'`, confirmed across every
  real assignment site. `documents` gets a REAL client-side INSERT policy (own upload only --
  `with check` pinned to the exact real `addDocument()` call shape: `direction='upload'`,
  category restricted to the narrower 3-value client-selectable set, `status='Received'`,
  `is_new=false`, `deadline_label` null) and a REAL client-side UPDATE policy scoped
  EXCLUSIVELY to the Sign transition (`direction='from'` + `status='Signature Required'` ->
  `status='Signed'`, via matched `USING`/`WITH CHECK`). A client can never INSERT a
  `direction='from'` document -- that's `publish-document` (admin-only), the only path to
  one; `update-document` (admin-only, a generic patch mirroring `updateDocumentForClient()`'s
  own generic signature) covers "Mark Reviewed" and any other admin patch.
  **A deliberate strengthening beyond the local engine, flagged per instruction, not silently
  added**: client-side DELETE (Remove) is scoped to `direction='upload'` only -- the real
  local `removeDocument(id)` has NO direction check at all (confirmed by reading it), but the
  real UI's Remove button only ever renders for uploads (confirmed via `docRowHTML()`); at
  the real Supabase security boundary, "never exploitable via the shipped UI" isn't the same
  guarantee as "structurally impossible," so the RLS policy closes that gap the local
  primitive never had to. **Support schema, a genuine, reasoned design deviation from
  documents' own direct-insert approach, flagged per instruction**: `support_requests` gets
  NO client-side INSERT/UPDATE/DELETE policy at all -- mirrors Stage 4's own `hys_pockets`
  precedent ("no client-side INSERT policy exists at all, even a genuinely-own one"). Ticket
  creation (`request-support-ticket`) is still immediate/unconditional -- the real "no
  approval gate" property is fully preserved -- but goes through a thin Edge Function because
  the human-readable `display_id` (e.g. `DISP-0001`) must be genuinely server-computed, and
  RLS's row-level `with check` has no clean way to verify "this id was computed by our own
  scan-and-increment algorithm" without a trigger. **A real, investigated finding, confirmed
  not assumed, that shaped the primary-key design**: the local `nextDisputeId()` scans ONLY
  the CURRENT client's own scoped array -- `display_id` is unique PER CLIENT, not globally
  (two different clients' first-ever ticket can both legitimately be `DISP-0001`, the exact
  same real per-client-id-collision property this project already found once for Client
  Profile Updates' own local SETTING-XXXX ids). A bare `text primary key` on that
  human-readable value would be a real correctness bug the moment a second client files their
  first dispute -- resolved the same way every prior Supabase stage resolves id generation
  under real multi-client writers: `id` is a genuine, globally-unique `gen_random_uuid()`;
  `display_id` lives in its own column, `unique(client_id, display_id)`, preserving the real
  local "unique within this client's own history" guarantee without claiming a false
  global-uniqueness property the real system never had. `update-support-ticket` (admin-only)
  sets status + pmNote together atomically, mirroring `updateSupportRequestForClient()`
  exactly; `reference` (a real field in every local request object, conditionally rendered in
  both client and admin markup) is kept as a nullable column for shape-fidelity even though a
  project-wide grep confirms it is NEVER set to anything but `null` anywhere in the real, live
  code today -- flagged explicitly as vestigial, not invented functionality. **Verified**: new
  `scripts/verify-supabase-documents-support.js`, 64 assertions, 64/64 passing on the first
  run -- the exact real client-INSERT shape proven for documents (and every deviation refused:
  spoofed direction/category/status/is_new/client_id); `publish-document` as the ONLY path to
  a `from` document, including its real `deadlineLabel`-relative-to-today computation; the
  Sign action's exact real UPDATE shape (and every deviation refused: re-signing, signing a
  non-required doc, an arbitrary target status, "signing" an upload); `update-document`'s real
  "Mark Reviewed" usage; Remove correctly scoped (own upload succeeds, a `from` document is
  refused); immediate no-gate support-ticket creation with a real server-computed
  `display_id`, confirmed genuinely per-client by creating two different clients' first
  tickets and proving both land on `DISP-0001` as two distinct rows with different real uuid
  primary keys -- no collision; `update-support-ticket` setting status + pmNote atomically,
  including a real second re-update (Resolved after In Progress); the full RLS matrix on
  `support_requests` proving ZERO client-side write path at all (INSERT/UPDATE/DELETE all
  refused, for a non-admin AND an admin-claimed caller alike); cross-client isolation on both
  domains; and authorization negative cases (401/403) on all 4 new functions. The full
  existing Supabase suite was re-run alongside with zero regressions:
  `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
  `verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js`
  88/88, `verify-supabase-hys.js` 103/103, `verify-supabase-final-approval-gate.js` 69/69
  (456 total, unaffected), `supabase-golden-path-regression.js` `PASS (16/16 steps)`. **No
  client-facing or admin UI wired to any of these 4 new Edge Functions yet** --
  `documents.html`/`admin-documents.html`/`support.html`/`admin-support.html` all still call
  the local `engine-core.js` functions. This stage is schema + Edge Functions + Node
  verification only, per the task's own scope. Backend Requirements Register row 119 added.
- **★ UI Wiring — Stage 1: dashboard.html (2026-09-03, row 120). THE FIRST PAGE IN THE
  PROJECT WIRED TO ANY REAL SUPABASE BACKEND LOGIC** -- every one of Stages 1-6 above was
  schema/functions/Node-verification only; this is where a real client-facing page starts
  actually calling them. Local stack only, real cloud "Marketswave Staging" untouched.
  **Identity, investigated first per instruction -- no change needed**: `dashboard.html`
  still resolves the authenticated client via `getAuthenticatedClientId()` (the local
  hybrid-bridge mirror `dashboard-sidebar.js`'s own guard already established), and that
  mirror already reflects real Supabase identity -- `login.html`'s real Supabase branch
  already calls `mirrorAuthenticatedClientLocally()`/`setClientAuthenticated(uid)` with the
  client's REAL Supabase Auth uid. The only new concern: the new Supabase calls need a live
  session (JWT), already sitting in `localStorage` from the real login that got the client
  here (`persistSession: true`) -- reached via the exact same `import('./supabase-config.js')`
  dynamic-import technique `dashboard-sidebar.js`'s own `signOutOfSupabaseAuth()` already
  uses. **New shared file, `supabase-data.js`** -- the canonical, documented, reusable
  pattern every future UI-wiring stage should cite directly rather than re-derive:
  `getSupabaseClient()`/`callFunction()`/`selectTable()` (thin wrappers around a cached
  client) and **`renderAsyncBundle(regions, { load, render, skeletonHTML })`** -- paints a
  Tailwind `animate-pulse` skeleton (Tailwind IS this page family's whole design system, no
  new CSS invented) into the given region(s) immediately, calls `load()` once, calls
  `render(data)` on success, or paints a consistent red error card with a genuine "Try
  Again" retry button on failure; `regions` may be one element or several sharing one
  combined load. **dashboard.html's data fetching**: `get-account-state`/`get-holdings`/
  `get-transaction-ledger`/`get-total-portfolio-value` (Phase B Stage 1) plus a direct
  RLS-authorized `products` read (no Edge Function exists or is needed for the catalog).
  **Two real behavioral differences found by reading the actual Edge Functions before wiring
  anything, not assumed**: (1) `get-account-state` 404s for a client with no `account_state`
  row yet -- caught and mapped to the local engine's own real $0 default (never surfaced as
  an error card, mirroring `readAccountStateForClient()`'s own "not found is not an error"
  behavior); (2) `get-transaction-ledger` already queries newest-first (`ORDER BY created_at
  DESC`), genuinely different from the local engine's own oldest-first insertion-order array
  -- blindly reusing the old code's own `.slice(-3).reverse()` against this real ordering
  would have silently shown the 3 OLDEST transactions reversed; fixed to `.slice(0, 3)`, the
  correct equivalent for a query that's already newest-first. Responsive/animation confirmed
  unaffected by diff, not assumed -- only `<script>` contents changed plus one new
  `<script src="supabase-data.js">` tag, zero markup/CSS touched. **★ No browser automation
  tool is available in this session -- checked directly before starting, not assumed --
  disclosed clearly per the task's own explicit browser-verify request, and substituted with
  the most rigorous Node-level equivalent achievable**: new
  `scripts/verify-dashboard-ui-wiring.mjs` loads the REAL, unmodified `supabase-data.js` and
  the REAL, unmodified `dashboard.html` inline script (extracted verbatim, not retyped) into
  a minimal fake DOM (mirroring this project's own established `scripts/lib/
  engine-harness.js` precedent), driven by a REAL local Supabase session for a REAL test
  client seeded with deliberately distinctive numbers (never mistakable for old hardcoded/
  local-demo figures). One seam disclosed: `supabase-config.js`'s own CDN import
  (`https://esm.sh/@supabase/supabase-js@2.112.4`) is redirected to the already-installed
  local npm package via a custom `module.register()` loader
  (`scripts/lib/esm-loader-supabase-cdn.mjs`, the same technique this project used once
  before for an equivalent Firebase-side config file) -- every other line of both real files
  runs completely unmodified. **Verified**: 27/27 assertions passing, twice in direct
  succession -- `renderAsyncBundle()`'s own loading/error/retry mechanics in isolation
  (skeleton paints synchronously before any promise resolves; a failed load shows a genuine
  clickable Try Again; retry re-fetches exactly once); the real page rendering real,
  independently-computed figures for the real test client, cross-checked directly against
  Postgres, not the app's own logic; the "3 most recent, newest first" ordering proven
  against 4 real seeded transactions; and a genuinely failed call (a signed-out session, a
  real 401) showing the error card on every affected region independently, never a blank or
  broken page. The full existing Supabase suite was re-run alongside with zero regressions:
  `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
  `verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js`
  88/88, `verify-supabase-hys.js` 103/103, `verify-supabase-final-approval-gate.js` 69/69,
  `verify-supabase-documents-support.js` 64/64 (456 total, unaffected),
  `supabase-golden-path-regression.js` `PASS (16/16 steps)`. README.md's Supabase runbook
  updated in place. Backend Requirements Register row 120 added.
- **★ UI Wiring — Stage 2: asset-collection.html + asset-performance.html** (2026-09-03, row
  121). **This project's first two real WRITE actions** -- Request Allocation and Sell --
  join Stage 1's read-only wiring. Reuses `supabase-data.js`'s canonical pattern exactly,
  EXTENDING it (not forking a page-specific alternative), per instruction, with two additions
  every future write-action wiring stage should also cite directly. **1)
  `MarketswaveData.withButtonBusy(button, busyLabel, fn)`** -- the write-action counterpart to
  `renderAsyncBundle()`: a write is NOT safely auto-retryable the way a read is (retrying a
  GET is harmless; "retrying" a write the same way risks a real double-submission), so this
  helper owns only the clicked button's own in-flight visual state (disabled + a small
  Tailwind `animate-spin` indicator + a busy label) -- the caller's own `fn()` promise
  resolution/rejection is what the caller reacts to (a toast, a modal close), exactly
  mirroring how `renderAsyncBundle` only owns a region's loading/error state and leaves
  `render()` to the caller. **2) A real bug found and fixed in `callFunction()`/
  `classifyError()` (present since Stage 1, never exercised there because dashboard.html's
  own error cases never needed a write's real validation text)**: confirmed directly against
  the installed `@supabase/functions-js` source (`dist/module/types.js:69`,
  `FunctionsClient.js:271`) that a failed Edge Function call's own `.message` is ALWAYS the
  literal generic string "Edge Function returned a non-2xx status code" -- supabase-js does
  NOT parse the real response body for you; every one of this project's Edge Functions
  returns its real, specific validation message as `{ error: "..." }` JSON, reachable only
  via `error.context.json()` (`.context` is the raw fetch `Response`). Without this fix,
  every failed write action in the whole project would have shown that same useless generic
  string instead of e.g. "Allocation amount exceeds current unallocated capital." -- fixed
  before any write action needed it for real, not discovered as a shipped bug. New
  `MarketswaveData.writeErrorMessage(err)` shows the real server message verbatim for a
  genuine business-rule rejection (400/409) and falls back to the existing generic
  `friendlyMessage()` only for 401/403/network/500, where there is no business-specific text
  to show. **Investigated first, per instruction -- a real task correction**: "My Requests"
  (allocation + sell history) lives on `asset-performance.html`, not
  `asset-collection.html` -- confirmed by reading both real files directly; the latter has no
  such section at all. Wired there accordingly, not on the page the task's own framing named.
  **A real client-side-validation finding**: the only client-side check that existed on
  either page before this stage was a plain positive-number check -- neither page ever
  duplicated the minimum-investment/sufficient-capital/held-units business rules
  client-side; those were always enforced entirely by the callee's own thrown validation
  surfaced via toast. "The server is authoritative" was already true architecturally; this
  stage carried that discipline across the sync-to-async boundary, it didn't have to newly
  establish it. **A real schema gap found and disclosed, not silently worked around**:
  `engine-core.js`'s own Product Catalog carries `description`/`extendedDescription`/
  `logoUrl`, but Phase B Stage 1's real `products` table (confirmed by reading that migration
  directly) has no such columns -- schema changes are out of this UI-wiring-only stage's
  scope -- so every product's logo/More-info features now show their existing, already-
  correct "not set" fallback (initials instead of a logo, no More Info link) until a future
  stage adds real column support; not a new failure mode, the same fallback path an
  already-unset product exercised before this stage too. `get-transaction-ledger`'s own
  already-newest-first ordering (found in Stage 1) meant My Requests needed its own small
  fix too: the real `requested_at` column is a full timestamptz, unlike the local engine's
  own plain date string that needed a SEPARATE `requestedAtMs` field for same-day ordering --
  sorting directly by `requested_at`'s own ISO string is already correct to millisecond
  precision, a real simplification, not a gap, so no `requestedAtMs`-equivalent was ported.
  **★ No browser automation tool is available in this session -- checked again, not assumed
  carried over from Stage 1.** Stage 2's real write actions are driven by delegated click
  handlers with real `closest()` DOM traversal, which Stage 1's own hand-rolled minimal DOM
  stub can't faithfully simulate -- rather than keep hand-rolling an increasingly fragile
  stub, `jsdom` was installed as a genuine, PERSISTENT `scripts/` devDependency (every future
  UI-wiring stage will need the same real-click-simulation capability, so install-then-remove
  would just mean reinstalling it again next stage) -- a real DOM implementation, so
  `closest()`/`querySelectorAll()`/`.click()`/event bubbling all work exactly as a real
  browser's would, with zero custom stub logic. Both real HTML files' `<body>` markup and
  real inline `<script>` blocks are extracted verbatim (not hand-reconstructed) and run
  inside that real DOM via `window.eval()`. **Verified**: new
  `scripts/verify-asset-pages-ui-wiring.mjs`, 36 assertions, 36/36 passing, twice in direct
  succession -- real product cards rendering with correct "already holding"/"No position"
  badges; a real successful Request Allocation round trip (a real new pending row confirmed
  directly in Postgres, the toast, the input clearing, the button's busy-then-restored
  state); **two genuine server-side rejections** (below a product's real minimum investment;
  exceeding the client's real unallocated capital), each confirmed via the real, specific
  server message appearing verbatim in the toast AND via a direct Postgres query proving
  zero rows were created, not just a client-side catch; a real successful Sell round trip
  (modal closes, a real pending row created for the full held units, Return Table and My
  Requests both genuinely refresh); and **a real server-side sell rejection via an actual
  concurrent-change race** (a holding's real unit count reduced in Postgres from a separate
  path between the Sell modal opening and Submit being clicked) -- proving `request-sell`'s
  own re-validation catches exactly the real-world race it exists for, real rejection message
  shown, modal staying open rather than silently closing. **Several real bugs found and fixed
  in this NEW test script itself during the same task, not the app -- disclosed, not
  papered over**: a first draft's second test holding used Nordic Growth Fund, silently
  contradicting Part 1's own "stays genuinely unheld" and "below minimum investment" checks
  on that exact same product for the exact same test client -- caught on the script's own
  first run, fixed by using a different real product (Ethereum) for the second holding; a
  toast-timing race where a still-visible toast from an earlier sequential test satisfied a
  later test's own "not hidden" poll condition before that test's own click had done
  anything -- fixed by polling for the toast body to genuinely CHANGE from a captured
  before-click snapshot, not just "not hidden"; an unscoped `.sell-request-btn` query that
  matched a DIFFERENT product's own still-enabled button and wrongly concluded the just-sold
  product's own row hadn't updated -- fixed by scoping the query to that exact product's
  `data-product-id`. The full existing Supabase suite was re-run alongside with zero
  regressions: `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js`
  40/40, `verify-supabase-deposits-withdrawals.js` 76/76,
  `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 103/103,
  `verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js`
  64/64, `verify-dashboard-ui-wiring.mjs` 27/27 (483 total, unaffected -- including Stage 1's
  own dashboard.html check, confirming the `supabase-data.js` extensions above introduced no
  regression there), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`. README.md
  updated in place with a suggested manual visual-check walkthrough, flagged as worth doing
  before the next wiring stage given these are the project's first real write actions.
  Backend Requirements Register row 121 added.
- **★ UI Wiring — Stage 3: deploy-capital.html + transactions.html** (2026-09-03, row 122):
  this project's 3rd and 4th real write actions (Deposit — crypto/bank — and Withdraw), plus
  `transactions.html`'s full read-only surface (summary cards, both charts, Recent Activity,
  the ledger table with all 4 filters, the drill-down modal). Reused `supabase-data.js`'s
  canonical pattern exactly, with **zero further extension needed** — Stage 2's
  `withButtonBusy()`/`writeErrorMessage()` already covered both pages' write actions
  completely. **A real structural conflict found and fixed before any test ran**:
  `transactions.html`'s ledger table had a static `<tr id="ledger-empty-row">` inside
  `<tbody id="ledger-body">`, which `renderAsyncBundle()`'s skeleton-phase `innerHTML`
  replacement would silently destroy on first load — fixed by removing the static row and
  rewriting `renderLedger()` to build the table body's full content, empty state included, on
  every call, matching the same full-rebuild discipline Stage 2 already established for the
  asset pages' card grids. **General principle for any future wiring stage**: a container fed
  through `renderAsyncBundle()` must have its `render()` do a complete rebuild each call —
  never assume a static pre-existing child survives past the first skeleton paint. **Real
  schema/behavior findings, confirmed live, not assumed**: `get-transaction-ledger` returns
  rows newest-first (opposite of the local engine's own array order — the page's existing
  sort/group logic needed no change, since it never relied on array order); `created_at`/
  `requested_at` are real full ISO `timestamptz` values, eliminating the local engine's own
  `requestedAtMs` workaround — a new `toDateOnly(iso)` helper maps down to a plain
  `'YYYY-MM-DD'` string wherever the page's existing filter/grouping logic expects one, so
  that logic runs unchanged; `get-account-state`'s Stage 1 "404 = genuine $0 default" pattern
  was reused as-is on both pages. `deploy-capital.html`'s two previously-separate Deposit/
  Withdraw IIFEs (communicating only via a fragile `window.renderMyFundingRequests` global)
  were merged into one IIFE sharing real module-level state, loaded once via a cached-promise
  `loadFundingData()`; the "Available to withdraw" figure there is informational only, unlike
  Stage 2's Sell modal, which hard-gates its Submit button on a stale client value — confirmed
  by reading the real submit handler before writing any test. **Verified**:
  `npm run verify-funding-transactions-ui-wiring` (from `scripts/`) — **54/54 assertions
  passed, twice in direct succession**. **No browser automation tool available — checked
  again, not assumed carried over.** Reused Stage 2's `jsdom`-based real-DOM harness
  (verbatim `<body>`/`<script>` extraction, `window.eval()`) against a real test client seeded
  with a real funded account, one real holding, and 4 real transactions spanning 2 calendar
  months. Covers: real successful crypto and bank deposits (each confirmed via a direct
  Postgres row); a real successful withdrawal; a real 409 server-side rejection for a
  withdrawal far beyond unallocated capital (verified via the real message through
  `writeErrorMessage()` and zero new rows); **a real concurrent-change race**, adapted from
  Stage 2's Sell-verification pattern — the real unallocated balance reduced directly in
  Postgres, from a separate path, after the form's stale "Available to withdraw" figure was
  captured, then a withdrawal submitted against that stale figure and confirmed genuinely
  rejected server-side, proving `request-withdrawal`'s own re-validation-at-request-time check
  is real, not decorative; real independently-computed summary cards including the advisory
  fee accrual; Recent Activity and DEPOSIT/WITHDRAWAL labels/badges; all 4 filters
  re-confirmed against real async-loaded data; both charts verified via a fake `Chart`
  constructor stub recording the real config/data passed to it (jsdom has no real Canvas 2D
  backend — explicitly not a proof of pixel rendering), confirming correct real month buckets
  and the documented deposits-positive/withdrawals-negative Net Cash Flow rule against real
  seeded data; the drill-down modal. **One real bug found and fixed — in the test script
  itself, disclosed not silently patched**: the first run used `'mainnet'` as the crypto
  network value, not one of the real `<select>`'s actual options (ERC20/TRC20/BEP20/Native);
  fixed to `'ERC20'`, re-run clean. The full existing Supabase suite was re-run alongside with
  zero regressions: `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js`
  40/40, `verify-supabase-deposits-withdrawals.js` 76/76,
  `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 103/103,
  `verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js`
  64/64, `verify-dashboard-ui-wiring.mjs` 27/27, `verify-asset-pages-ui-wiring.mjs` 36/36 (573
  total, unaffected), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`. README.md
  updated in place with a suggested manual visual-check walkthrough for both pages. Backend
  Requirements Register row 122 added.
- **★ UI Wiring — Stage 4: high-yield-savings.html + documents.html** (2026-09-03, row 123):
  pockets, Open a New Pocket, Withdraw, and My Pocket Requests on the HYS page; both document
  lists, Upload, Sign, Remove, and notification chips on the Documents page. Reused
  `supabase-data.js`'s canonical read/skeleton pattern unchanged; Documents' own write actions
  needed a genuine extension (below), since Stage 6's real design gives clients direct,
  RLS-authorized INSERT/UPDATE/DELETE for Upload/Sign/Remove — no Edge Function gates these
  three, unlike every Approval Gate queue wired so far. **Investigated per instruction: the
  live rate/interest preview stays calling `engine-core.js`'s own already-loaded, already-pure
  `getHYSRate()`/`computeFDFields()`/`computeHYSWithdrawalAmount()` directly, not a new call to
  the real `hys-engine.ts` module** (Deno-only, unreachable from the browser except per-keystroke
  Edge Function calls — pointless for a pure, deterministic, non-secret rate schedule); the real
  authoritative computation for an actual submitted request still happens server-side via that
  same module, so preview and outcome can never drift, mirroring Backend Requirements Register
  row 34's own discipline. **A real architecture gap found and disclosed, not silently patched**:
  the local-only `updatePocketStatuses()` (client-side 'active'→'matured' auto-transition) was
  removed rather than ported — there is nowhere valid to persist it under real RLS (`hys_pockets`
  grants clients `SELECT` only), and a display-only client-computed "effective status" was
  rejected as a design choice since it would make the card badge and the Withdraw modal's
  warning/lockout decision inconsistent with what `request-hys-withdrawal` actually does
  server-side (which keys off the real stored `status`) — exactly the "confusing UI... controls
  that would fail" anti-pattern this stage's own task explicitly warned against, in the opposite
  direction. The page now uniformly trusts the real stored `status` for both; the real,
  disclosed consequence is that nothing server-side ever transitions a pocket past maturity yet,
  so a genuinely-matured-but-still-`'active'`-stored pocket keeps being treated as pre-maturity
  until a future stage adds a real transition mechanism — inherited from Phase B Stage 4's own
  schema design (already flagged there), not introduced here; a pocket whose real status IS
  `'matured'` already renders and withdraws correctly today, verified directly. **New
  `supabase-data.js` primitives**: `insertRow()`/`updateRow()`/`deleteRow()` plus
  `classifyPostgrestError()`, mapping real Postgres/PostgREST error codes into the same
  `.kind` scheme `writeErrorMessage()` already understands (a rejected direct table write has no
  `.context` Response to read a custom message from, unlike a rejected Edge Function call). The
  static `#from-empty`/`#upload-empty` placeholders were rebuilt to be freshly regenerated by
  `renderDocumentLists()` every call — the same static-child-vs-skeleton conflict Stage 3 already
  found once for `transactions.html`'s ledger table. **Two real bugs caught by this stage's own
  verification, fixed before shipping**: (1) the Upload INSERT never included `client_id` in its
  payload — unlike an Edge Function (which derives `clientId` server-side from the JWT), a direct
  client INSERT has no such step, so the table's own `with check (auth.uid() = client_id ...)`
  policy always evaluated false; confirmed via a real failing insert first, fixed by adding
  `getAuthenticatedClientId()` to the payload. (2) `deleteRow()`'s first draft could silently
  "succeed" when RLS's `using` clause filtered out every row — unlike INSERT/UPDATE's `with
  check` (which genuinely throws), a DELETE's policy fails silently, no error, zero rows
  affected; confirmed directly that a client deleting a document RLS scopes them out of (a "from
  Marketswave" document) got back a plain success with nothing actually deleted, meaning the
  original code would have shown a genuine "Document Removed" toast for a document that was
  never removed — fixed by chaining `.select()` after `.delete()` and treating an empty result
  as a real, thrown rejection. **A third, real, disclosed finding, not a bug**: Download's local
  behavior of clearing `isNew` as a side effect (no RLS-equivalent restriction locally) is now
  structurally unreachable under Stage 6's real schema — the ONE client UPDATE policy on
  `documents` is scoped exclusively to the Sign transition, confirmed by direct testing to fail
  100% of the time for this use, not an edge case — the write attempt was removed entirely; the
  real consequence is a "from" document's New badge now only ever clears via Sign, never
  Download, with the (bytes-free) download simulation itself unaffected. **Verified**:
  `npm run verify-hys-documents-ui-wiring` (from `scripts/`) — **68/68 assertions passed, twice
  in direct succession**. **No browser automation tool available — checked again, not assumed
  carried over.** `engine-core.js` was loaded into the HYS test's own DOM (the one page this
  stage deliberately keeps depending on it for pure preview functions); `#sidebar-doc-badge`/
  `getAuthenticatedClientId()` were stubbed for `documents.html`'s own earlier-script-block
  dependencies, mirroring Stage 3's precedent. Covers, against real seeded data: 4 pockets
  spanning every render/withdraw branch including a genuinely `matured` pocket seeded directly;
  the locked-pocket-no-withdraw-control rule confirmed absent from the DOM, not just
  server-blocked; a real forfeiture-warning round trip and a real matured/no-warning round trip;
  a real server-side rejection via the actual UI (a second pending withdrawal on the same
  pocket — a rule the client UI has no awareness of, unlike the by-design-hidden locked case);
  two real "Open a New Pocket" round trips with a server-computed rate matching the real
  schedule; a real direct server-side rejection (sub-$5,000 Fixed, defense in depth); real
  document rendering and the "from Marketswave" no-Remove rule confirmed absent from the DOM;
  real notification counts including the sidebar badge's live correction; a real Sign round
  trip confirmed against all 3 fields the RLS `WITH CHECK` requires; the Download finding
  confirmed both ways; real Upload and Remove round trips; and two real security-boundary tests
  (a direct DELETE against a "from" document, and a direct INSERT with `direction='from'`, both
  genuinely rejected). The full existing Supabase suite was re-run alongside with zero
  regressions: `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
  `verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js` 88/88,
  `verify-supabase-hys.js` 103/103, `verify-supabase-final-approval-gate.js` 69/69,
  `verify-supabase-documents-support.js` 64/64, `verify-dashboard-ui-wiring.mjs` 27/27,
  `verify-asset-pages-ui-wiring.mjs` 36/36, `verify-funding-transactions-ui-wiring.mjs` 54/54
  (641 total, unaffected), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`.
  README.md updated in place with a suggested manual visual-check walkthrough for both pages.
  Backend Requirements Register row 123 added.
- **★ Bug fix: the real HYS pocket maturity-transition gap, closed** (2026-09-03, row 124):
  closes the real, disclosed architecture gap from both UI Wiring Stage 4 and Phase B Stage 4 —
  nothing server-side ever transitioned a real `hys_pockets` row from `'active'` to `'matured'`
  once its real `maturity_date` passed, so `request-hys-withdrawal`'s own status-keyed logic
  could apply pre-maturity rules to a genuinely-matured pocket: a locked pocket would be wrongly
  **blocked from withdrawal entirely** (a real, indefinite access denial, not just a display
  bug), and a short-term pocket would wrongly **forfeit interest** it shouldn't. **Investigated
  first, per instruction, rather than assuming the user's own stated preference (option 1) was
  automatically sufficient**: option 1 (transition at request/read time, no new infrastructure)
  was confirmed correct for the real money decision, but a literal reading of "even the read
  functions" doesn't apply here — there IS no read Edge Function for `hys_pockets` at all; the
  client reads it via a raw, RLS-authorized `selectTable('hys_pockets')` call that never touches
  any server code, so a fix scoped only to `request-hys-withdrawal` would leave a genuinely-
  matured LOCKED pocket showing **no Withdraw control in the UI at all** until a withdrawal
  happened to be attempted against it once — exactly the gap the user's own question anticipated.
  Option 2 (pg_cron) was rejected for the reason the user's own instinct already gave: a real
  staleness window between sweeps, plus new infrastructure to maintain, for no benefit over a
  request-time fix once the read-side gap is also closed. Option 3 (a Postgres VIEW computing an
  always-live derived status) was considered as the most "correct" idiomatic answer to the pure-
  read problem, but rejected as more invasive than necessary (a new schema object, RLS-on-views
  considerations, a repointed client read) when a trivial, provably-safe alternative exists: **a
  pure client-side computation using the IDENTICAL deterministic rule the now-fixed server also
  applies.** This is a materially different, safer situation than the ORIGINAL UI Wiring Stage 4
  writeup's own explicit rejection of a client-computed "effective status" — that rejection was
  correct *at the time*, specifically because the server hadn't been fixed yet (a client preview
  could disagree with what the unfixed server would actually do); now that the server
  independently recomputes and self-heals the same way, both sides apply one pure function of
  real data (`maturity_date`, current time) and can never disagree. **The fix**: new
  `resolveEffectivePocketStatus(pocket)` in `supabase/functions/_shared/hys-engine.ts` — the
  single source of truth for the rule, deliberately kept separate from
  `computeHysWithdrawalAmount()` (left UNCHANGED, still a faithful byte-for-byte port of the
  real local function, which never needed its own maturity-awareness since the local engine's
  own now-removed `updatePocketStatuses()` always self-healed BEFORE calling it — the real-
  Supabase equivalent is `request-hys-withdrawal` calling `resolveEffectivePocketStatus()`
  explicitly, in the same call order, rather than baking the check into the shared money-math
  function itself). `request-hys-withdrawal/index.ts` now calls it immediately after fetching
  the real pocket (before the lockout check, before `computeHysWithdrawalAmount()`), and — the
  genuinely value-adding part beyond a purely ad-hoc computation — **writes the corrected status
  back to Postgres** when it finds one stale, the same "settle lazily, on touch" discipline this
  project's own portfolio engine already established for price ticks
  (`settleProduct()`/`settleAllProducts()`), so the stored data itself increasingly reflects
  reality rather than staying permanently stale. `approve-hys-withdrawal` needed NO change,
  confirmed by reading it directly: it only ever checks `pocket.status === 'withdrawn'`
  (unaffected by the active/matured distinction) and executes the request's own
  already-computed `forfeit`/`receive_amount` — the same "terms locked in at request time" design
  every other request-then-approve domain in this project already uses. `high-yield-savings.html`
  gets the matching client-side fix: a new `effectivePocketStatus(p)` helper applies the
  identical rule inside `mapPocketRow()`, once, at mapping time — every downstream read of a
  pocket's `.status` (the card badge, the locked-pocket action-block decision, the Withdraw
  modal's `needsWarning` check, `computeHYSWithdrawalAmount()`'s own forfeit preview) picks up
  the corrected value automatically, no other call site needed changes. The file's own prior
  "genuine, disclosed architecture gap, out of scope" comment block was rewritten in place to
  describe the actual fix rather than left stale. **Verified**: extended the existing canonical
  `scripts/verify-supabase-hys.js` (the right home for this — Phase B Stage 4's own regression
  suite already covers the exact files this fix touches) with a new section, "4b," 9 new
  assertions, run twice in direct succession, 112/112 total both times: a LOCKED pocket stored
  `'active'` with a real past `maturity_date` is confirmed **no longer wrongly blocked**, its
  real `receiveAmount` correctly does NOT forfeit interest, and its real stored row is confirmed
  genuinely self-healed to `status='matured'`; the identical proof for a SHORT-term pocket
  (previously would have wrongly forfeited interest, now correctly doesn't); and a **control** —
  a genuinely still-active pocket (real future `maturity_date`) is confirmed completely
  unaffected by the fix, both in its withdrawal outcome (still correctly forfeits) and its
  stored status (still `'active'`, no false self-heal) — proving the fix doesn't over-fire.
  `scripts/verify-hys-documents-ui-wiring.mjs` (UI Wiring Stage 4's own suite, directly affected
  by the `high-yield-savings.html` change) was re-run, still 68/68. The full existing Supabase
  suite was re-run alongside with zero regressions: `verify-supabase-schema.js` 16/16,
  `verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js` 76/76,
  `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 112/112 (was 103),
  `verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js` 64/64,
  `verify-dashboard-ui-wiring.mjs` 27/27, `verify-asset-pages-ui-wiring.mjs` 36/36,
  `verify-funding-transactions-ui-wiring.mjs` 54/54, `verify-hys-documents-ui-wiring.mjs` 68/68
  (650 total, unaffected), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`.
  Backend Requirements Register row 124 added, citing both row 117 (Phase B Stage 4, where the
  gap was first disclosed) and row 123 (UI Wiring Stage 4, whose own trailing "still open" note
  was updated in place to point here rather than left stale).
- **★ UI Wiring — Stage 5: risk-management.html + settings.html + support.html, CLOSING OUT
  ALL CLIENT-FACING PAGES** (2026-09-03, row 125): every one of the 10 pages behind the locked
  sidebar now genuinely calls real Supabase wherever real backend support exists. Reused
  `supabase-data.js`'s canonical pattern throughout, no further extension needed. **Investigated
  first, per instruction, for each page, before wiring anything.** **risk-management.html**: no
  real Supabase table/column exists for a CLIENT's own risk profile anywhere in Phase B's six
  stages (the only real "risk" schema anywhere is `products.risk_tier`, a per-PRODUCT
  classification, an entirely different concept) — the Risk Meter stays 100% local, unchanged.
  The Diversification Score, however, was found to NOT actually be derived from real holdings
  at all — a static "78/100" hardcoded to match CLIENT-0001's own specific historical seed
  data, with the delta-preview math comparing against a hardcoded reference mix that only
  coincidentally equalled the real seed. Wired for real by reusing dashboard.html's own
  established asset-class-grouping pattern (holdings × real current unit price, grouped by
  `products.asset_class`, plus Unallocated/Cash from `account_state`), replacing both the
  static block and the hardcoded reference with a genuine per-client HHI-based computation.
  **settings.html**: a real correction to the task's own framing — Email/Phone do NOT live on
  `client_profiles` (confirmed by reading Phase B Stage 5's migration directly), they're real
  columns on `clients` (Phase B Stage 1). Display can genuinely go real (a plain SELECT);
  inline edit structurally cannot — `clients` has no UPDATE policy for `authenticated` at all
  and no Edge Function updates it either. The Edit/Save UI stays, but Save now shows a real,
  honest "not available yet" disclosure instead of a fake success that would have silently
  reverted on the next real-data reload. Legal Name/Address/ID Document were already modeled
  1:1 by `client_profiles`/`profile_change_requests` — a straightforward wire. Password Change
  had NO backend of any kind before this (not even fake-persisted) — wired to real
  `supabase.auth.updateUser({password})` plus a real current-password re-check via
  `signInWithPassword()` first, since Supabase's own `updateUser()` has no "current password"
  parameter of its own and a naive wire would have left that field purely decorative — the
  full, responsible version was chosen per the task's own explicit invitation to make this
  call. 2FA and Notification Preferences: confirmed no real Supabase table exists for either —
  stay 100% local. Active Sessions: a real, SEPARATE bug found during investigation — it still
  imported the retired Firebase SDK, so its "signed in at" enhancement had been silently dead
  for every real Supabase-authenticated client since Firebase Retirement; fixed to try the real
  Supabase session first, Firebase as a fallback, mirroring `dashboard-sidebar.js`'s own real
  Logout handler (which already runs both real `signOut()` calls unconditionally for the
  identical "don't assume which backend authenticated this session" reason). **support.html**:
  ticket list, filing a dispute, and My Requests wire cleanly to `support_requests` +
  `request-support-ticket` (a direct RLS-authorized read for the list, no Edge Function needed
  there; creation is Edge-Function-only since `display_id` must be genuinely server-computed).
  Quick-contact stays pure UI, exactly as instructed. The Callback modal's phone default now
  reads the same real `clients.phone` column settings.html displays, replacing its own
  local-storage read. **Verified**: `npm run verify-settings-risk-support-ui-wiring` (from
  `scripts/`) — **33/33 assertions passed, twice in direct succession**. **No browser
  automation tool available — checked again, not assumed carried over.** Reused the
  established `jsdom` harness; `engine-core.js`'s `getAuthenticatedClientId()`/`getClient()`/
  `clientScopedKey()`/`getClientSecurityState()` and `format-helpers.js`'s
  `formatFieldDisplay()` were stubbed/loaded for each page's own remaining local-only sections.
  Covers, against real seeded data: a real Diversification Score independently computed from a
  deliberately non-balanced holdings mix, confirmed to match the page's own render exactly and
  confirmed genuinely different from the old hardcoded "78/100"; real Email/Phone display with
  a real attempted edit confirmed to show the honest disclosure AND confirmed via a direct
  Postgres read that nothing changed; a real Legal Name value rendering via the real
  `client_profiles` read; a real Address change round trip including the server's own automatic
  current-value snapshot and a real 409 duplicate-pending rejection; a real password-change
  round trip proving both directions (a wrong current password rejected, a correct one
  succeeding — confirmed via a fresh real sign-in with the new password, not just the toast);
  the real "signed in [time]" Active Sessions enhancement; two real disputes with correct
  sequential per-client `display_id`s and newest-first ordering; a real direct server-side
  rejection of an invalid category; and the Callback modal's real phone default. The full
  existing Supabase suite was re-run alongside with zero regressions: `verify-supabase-schema.js`
  16/16, `verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js`
  76/76, `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 112/112,
  `verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js` 64/64,
  `verify-dashboard-ui-wiring.mjs` 27/27, `verify-asset-pages-ui-wiring.mjs` 36/36,
  `verify-funding-transactions-ui-wiring.mjs` 54/54, `verify-hys-documents-ui-wiring.mjs` 68/68
  (683 total, unaffected), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`.
  README.md updated in place with a suggested manual visual-check walkthrough for all three
  pages. Backend Requirements Register row 125 added, itemizing all 4 confirmed-no-real-backend
  gaps (Risk Meter, 2FA, Notification Preferences, Email/Phone edit) so none of them silently
  look done.
- **★ Admin UI Wiring — Stage 1: the five Approval Gate admin queue pages move from
  engine-core.js/localStorage to real Supabase calls, LOCAL STACK ONLY** (2026-09-03): the
  first ADMIN-side UI Wiring stage — every prior UI Wiring stage (rows 120-125) wired a
  client-facing page; `admin-deposits.html`/`admin-withdrawals.html`/`admin-allocations.html`/
  `admin-sells.html`/`admin-hys.html` are the first admin pages to genuinely call real
  Supabase Edge Functions/tables. **Investigated first, per instruction**: `admin-supabase-
  config.js` (Stage 3) was explicitly real-cloud-only — extended (not forked) with a local
  branch mirroring `admin-firebase-config.js`'s own emulator-vs-staging split (auto-signs in
  as `pm@marketswave.local`, no prompt, when `?env=staging` is absent). New
  `MarketswaveData.useAdminClient()` in `supabase-data.js` is the entire "small, clearly-
  scoped extension" the task asked about — redirects the module's one existing lazy
  `clientPromise` to an admin-authenticated session; every other exported function needed
  zero changes. RLS confirmed (via direct migration reads) to already grant cross-client
  admin SELECT on all 6 relevant tables. Every real Edge Function's exact request shape was
  confirmed by reading its deployed source, not assumed: `credit-deposit`/`credit-hys-
  deposit` and `approve-withdrawal` take a PM-editable amount (verified by direct test: a
  real $2000→$1950 deposit edit and $700→$650 withdrawal edit, both landing the PM's own
  entered value, never the originally-requested one); `approve-allocation`/`approve-sell`/
  `approve-hys-withdrawal` execute exactly as requested, no editable amount (the first two
  forward the caller's own JWT into a real internal call to the already-deployed
  `execute-buy`/`execute-sell`, never duplicating that logic). `admin-sells.html`'s Realized
  Return column now reads a real `transactions` row directly (self-or-admin RLS), replacing
  the old per-client-scoped `getTransactionForClient()` local lookup. All five pages rebuilt
  onto `loadPageData()`/`reloadPageData(forceReload)` + `MarketswaveData.renderAsyncBundle()`,
  every Approve/Credit/Reject handler onto `withButtonBusy()`/`writeErrorMessage()`.
  **Verified**: new `scripts/verify-admin-approval-gate-ui-wiring.mjs`, 102 assertions,
  102/102 twice in direct succession — per domain: a real approve/credit round trip, a real
  reject round trip, and a genuine re-validation-at-approval-time test driven through the
  ACTUAL admin UI (real clicks, never a direct function call) — for Withdrawals/Allocations/
  Sells/HYS-Withdrawals, two competing pending requests against the same finite resource
  (capital/units/pocket), approving the first succeeds, approving the second is genuinely
  refused with the real 409 server message, the resource stays unchanged; for Deposits/HYS-
  Deposits (no shared resource to contest, so their own real race is double-resolve, not
  oversell), a real concurrent-resolution simulation proves the same 409 guard fires through
  the real UI, modal staying open. Cross-client rendering confirmed on every page (two real,
  independently-seeded clients both show correctly, not just one). **One real bug caught in
  this NEW test script itself, not the app**: a hardcoded cross-domain expected balance
  became stale once later domains legitimately moved it further — fixed by capturing a
  before/after snapshot instead of a hardcoded figure. Full existing Supabase suite re-run
  alongside with zero regressions (683 prior assertions unaffected, plus
  `supabase-golden-path-regression.js` `PASS (16/16 steps)`). **No browser automation tool
  available this session** (checked again) — reused the same `jsdom`-based real-DOM harness
  every prior UI Wiring stage has used. README.md updated in place with a manual visual-check
  walkthrough across all five pages. Backend Requirements Register row 126 added — the
  remaining admin pages (Client Profile Updates, Documents, Support, Advisory Fee, Security
  Log, Product Catalog, Client List) stay fully unwired; `admin-client-applications.html`
  itself was already wired back in Supabase Stage 3 (row 112), untouched by this stage.
- **★ Bug fix: the full cross-role local/Supabase split — admin-documents.html +
  admin-support.html wired fully bidirectional, notification bell + sidebar Documents badge
  wired to real Supabase across all 5 domains** (2026-09-03): closes a real reported bug —
  a PM's real publish via `admin-documents.html` produced a real client notification, but the
  document never appeared on the client's own real `documents.html`. **A dedicated
  investigation ran first**: confirmed `admin-documents.html`/`admin-support.html` were still
  100% local (`engine-core.js`/localStorage) on BOTH Pending/History reads AND PM write
  actions, even though `documents.html` (Stage 4) and `support.html` (Stage 5) were already
  wired to real Supabase — a genuinely bidirectional split (a real client upload/dispute was
  equally invisible to the PM, not just the originally-reported PM→client direction).
  Separately, `dashboard-notifications.js` (the shared bell, mounted on all 10 client pages)
  and `dashboard-sidebar.js`'s own Documents badge had zero Supabase references across all 5
  of the bell's own sources — stale since each domain's client-facing page was wired in an
  earlier stage that never touched this shared file. **Fixed**: both admin pages rewired onto
  `supabase-data.js`'s canonical pattern, reusing the already-deployed Phase B Stage 6
  `publish-document`/`update-document`/`update-support-ticket` Edge Functions (zero real
  callers until now) — no new schema/functions needed, this closed a wiring gap only. The
  bell's 5 `build*Items()` functions rewritten as pure mappers over real Supabase rows
  (`getAllNotifications()`/`renderPanel()` now async, fetching fresh on every open); the
  sidebar badge now fetches its real count via a new `fetchDocumentBadgeCount()`, patched in
  once resolved (starts honest hidden/0, never a fake interim value). **★ This bug class is
  now logged as its own named, recurring risk: "staged wiring cross-role/shared-component
  disconnect"** — wiring a client-facing page to real Supabase must be accompanied, in the
  SAME pass, by checking and wiring every OTHER consumer of that same domain's data (a
  corresponding admin page, a shared component like this bell/badge, anything else) — a
  staged rollout naturally creates a window where two consumers silently disagree about which
  backend is authoritative, and that window can look correct in same-browser dev/test (as
  this exact bug did) while being genuinely broken in a real multi-device deployment. Future
  domains should grep for every local-engine caller of that domain in the SAME session a
  client-facing page is wired, not as a follow-up. **Verified**: new
  `scripts/verify-cross-role-sync-bugfix.mjs`, 34 assertions, 34/34 twice in direct
  succession. **★ The core requirement, per instruction — genuinely separate PM/client
  contexts, not same-process convenience**: `supabase-data.js` has no import/export syntax
  and no governing `package.json` "type" field exists anywhere from the project root upward,
  so Node's ESM-detection heuristic treats it as CommonJS by default — its require cache is
  keyed by resolved PATH, so a query-string-busted `import()` of the same path silently
  returns the first cached execution (confirmed via a standalone probe before landing on the
  real fix). Fixed by writing the real, byte-for-byte unmodified content of `supabase-data.js`
  to two temporary files in the project root (so their own relative config imports resolve
  correctly) — two distinct paths are always two distinct module-cache entries, confirmed
  via the same probe (`!==` identity, independently-resolving sessions); both temp files
  deleted in a `finally` block, confirmed clean via `git status` after every run.
  `admin-supabase-config.js`/`supabase-config.js` deliberately stay real, un-duplicated
  singletons — correct, not a gap, mirroring how two real browser tabs would each get their
  own realm's copy of `supabase-data.js` while both still resolve against the one real
  Supabase project. Covers the real reported bug proven fixed across genuinely independent
  contexts, the reverse direction, a full bidirectional Support round trip, the bell showing
  live real items across all 5 domains after real actions, real read-state marking, and the
  real sidebar badge cross-checked directly against Postgres. Two real bugs caught in the
  NEW test script itself (a missed checkbox check; a badge-hidden assertion not accounting
  for a separate microtask link) — disclosed, fixed in the test, not the app. Full existing
  Supabase suite re-run with zero regressions (785 prior assertions unaffected, plus
  `supabase-golden-path-regression.js` `PASS (16/16 steps)`). Backend Requirements Register
  row 127 added.
- **★ Admin UI Wiring — Final Stage (2026-09-03), CLOSES OUT THE ADMIN TOOL WIRING EFFORT**:
  the 6 remaining admin pages, each investigated individually before wiring anything, per
  instruction — no page got wired just because a similar-sounding domain was built elsewhere.
  **1. `admin-profile-updates.html` — WIRED**: the one Approval Gate queue Admin UI Wiring
  Stage 1 (row 126) genuinely missed. Real backend already existed (Phase B Stage 5:
  `client_profiles`/`profile_change_requests`/`request-profile-change`/
  `approve-profile-change`/`reject-profile-change`), and `settings.html`'s own client half
  was already wired (UI Wiring Stage 5) — this closes the missing admin half. Reused Stage
  1's exact pattern (`useAdminClient()`, cross-client `selectTable('profile_change_requests')`
  joined against `clients` for a display name, Approve/Reject through the real functions);
  the real `format-helpers.js` supplies `formatFieldDisplay()` unchanged.
  **2. `admin.html` — WIRED**: every Overview card with a real backend now reads it directly
  (all 7 Approval Gate pending counts, Documents Awaiting Review, Support Needing Attention,
  Product Catalog count, Advisory Fee Rate) via direct RLS-authorized cross-client reads, no
  Edge Function needed for any of them. Security Actions Logged stays local (item 5),
  deliberately excluded from the all-clear check, unchanged.
  **3. `admin-advisory-fee.html` — WIRED, closing a real "table exists, nothing writes to it"
  gap**: Phase B Stage 1's own `advisory_fee_rate` singleton table had a real SELECT policy
  but no write path anywhere. New, small, admin-only `update-advisory-fee-rate` Edge Function
  (mirrors the local `setAdvisoryFeeRate()`'s own validation byte-for-byte) closes it —
  the same minimal admin-only pattern as every prior write in this migration series.
  **4. `admin-clients.html` — REWIRED, real cleanup, not a straightforward wire, per
  instruction**: found stuck on the PRE-RETIREMENT Firebase merge (built Aug 22, 2026) —
  Firebase was retired project-wide Aug 30, 2026 and this page was never updated after,
  still importing the retired `admin-firebase-config.js` and querying the retired emulator's
  Firestore, which no real signup path has written to since Supabase became sole active
  backend. That whole `type="module"` Firebase block removed outright, replaced with a real
  Supabase `clients` table merge (still combined with `getAllClients()` for the still-
  genuinely-local demo/admin-created clients, e.g. CLIENT-0001) — a "Supabase" badge replaces
  "Firebase." Real cross-client Total Portfolio Value for Supabase clients via the already-
  deployed `get-total-portfolio-value` function (admin can pass any `clientId`), pre-fetched
  in parallel on load. Real per-client pending Approval Gate count for Supabase clients,
  computed by querying the 7 real Approval Gate tables filtered by `client_id`/
  `status='pending'`, lazily on row-expand (matching the page's own established lazy-detail
  pattern), cached per client. **Real, disclosed design decision**: "View as this Client" —
  confirmed via project-wide grep to be the ONLY remaining `getCurrentClientId()`/
  `setCurrentClientId()` caller anywhere in the admin tool (every wired queue page now takes
  an explicit `clientId` per row instead) — shown only for local clients; a Supabase client
  gets an honest explanatory note instead of a button with no real identity-switch mechanism
  behind it. Reset Password/Reset 2FA re-investigated (not assumed carried over from the old
  Firebase-specific note) and found to apply identically to a Supabase-authenticated client
  for the same real reasons already documented for Firebase — warning copy relabeled
  "Firebase" → "Supabase" accordingly.
  **5. `admin-security.html` — CONFIRMED NO REAL BACKEND, left correctly local**: a
  project-wide grep of every migration and every `supabase/functions/` directory found no
  table/function resembling a security-actions log — mirrors `settings.html`'s own Stage 5
  finding that 2FA itself has no real Supabase backend either. Nothing wired fake; a comment
  documents the finding, zero functional code changed.
  **6. `admin-products.html` — CONFIRMED NO REAL WRITE PATH, left correctly local, a real
  orphaned-catalog gap logged**: the real `products` table (Phase B Stage 1) exists and is
  genuinely read by 4 already-wired pages (`dashboard.html`, `risk-management.html`,
  `asset-collection.html`, `asset-performance.html`), but carries only a SELECT policy — no
  write path for any role, no Edge Function, and no `description`/`logo_url`/
  `extended_description` columns the local schema has. Left the WHOLE page on the local
  engine (read AND write) rather than a partial wire — a real-read/local-write split would
  have been actively misleading, Add/Edit silently writing to a disconnected local array with
  no visible sign of the mismatch. **Real, currently-live consequence, flagged prominently**:
  since the 4 pages above were wired to the real table in earlier stages, this page's own
  Add/Edit actions against the local catalog have had ZERO effect on what any client actually
  sees since those stages shipped — it has been silently managing an orphaned catalog.
  Closing this needs its own scoped future task (a real migration for the missing columns, a
  real admin-only `add-product`/`edit-product` Edge Function pair mirroring
  `update-advisory-fee-rate`'s own pattern plus the local engine's own unitPrice-edit-blocked
  rule, and a real UI wire) — not built here, reported instead. **Verified**: new
  `scripts/verify-admin-final-wiring.mjs`, 39 assertions, 39/39 passing, using the same
  jsdom-based real-DOM harness every prior UI-wiring stage established — real Approve/Reject
  round trips for Client Profile Updates (including a genuine `client_profiles` write, not
  just a status flip, and confirming a rejection performs NO profile write); a real
  successful Advisory Fee Rate update AND a real server-rejected invalid-rate attempt (rate
  provably unchanged); every one of `admin.html`'s 10 real pending-count cards cross-checked
  against an independently-computed live DB query; the real Supabase client merge, a real
  cross-client Total Portfolio Value read, a real lazily-fetched per-client pending count
  matched against an independent 7-table sum, and confirmation "View as this Client" is
  genuinely absent for a Supabase-sourced client. Full existing Supabase suite re-run
  alongside with zero regressions (824 prior assertions unaffected, plus
  `supabase-golden-path-regression.js` `PASS (16/16 steps)`). Backend Requirements Register
  row 128 added. **Two real, honest gaps were flagged**: Product Catalog management had no
  real write path (orphaned local catalog) — **CLOSED, see the next entry**; the Security
  Actions Log has no real backend at all — still open, logged, not silently worked around.
- **★ Products Catalog Fix (2026-09-03)**: closes the "PM acts, client never sees it" bug
  class already fixed once for Documents/Support (row 127), now confirmed present for the
  Product Catalog by the prior entry's own investigation (row 128). `admin-products.html`
  was silently managing a LOCAL catalog completely disconnected from the real Supabase
  `products` table every already-wired client-facing page reads — any Add/Edit had zero
  effect on what a client actually saw. **Schema**: a new migration adds the three missing
  columns — `description`/`extended_description`/`logo_url` — confirmed as the complete
  missing field set by reading the real, current `admin-products.html`/`engine-core.js`
  source first (full local field set: `name`/`assetClass`/`investmentType`/`riskTier`/
  `minimumInvestment`/`unitPrice`, already backed by real columns, plus these three). No RLS
  changes needed (row-level, not column-level — the existing SELECT policy already covers new
  columns). Applied directly to the running local Postgres rather than a destructive
  `supabase db reset`, preserving real pre-existing local test data. **Write path**: new
  admin-only `add-product`/`edit-product` Edge Functions, plus a genuinely shared
  `_shared/product-validation.ts` so the two can never validate-drift apart — the same
  drift-prevention discipline `_shared/hys-engine.ts` already established. `add-product`
  mirrors the local `addProduct()`'s own scan-and-increment `PROD-XXXX` id generation
  (matching Phase B Stage 1's own deliberate non-UUID design for this table). **The
  unitPrice-edit-blocked rule was RE-CONFIRMED still true by reading `editProduct()`'s real
  current source before porting it**, per instruction, not assumed carried over — a patch
  containing `unitPrice` is rejected with the exact real local error message. **Wired
  `admin-products.html`**: cross-client list (global catalog, no per-client scoping) via
  direct RLS-authorized read, Add/Edit through the new functions via the established
  `withButtonBusy()`/`writeErrorMessage()` pattern. `asset-collection.html`'s product mapping
  now maps the three real columns instead of leaving them undefined — its existing fallback
  rendering needed zero changes, it now just renders a real value once one is set;
  `dashboard.html`/`risk-management.html`/`asset-performance.html` needed literally zero
  changes, confirmed by checking first — they only ever use `assetClass` for grouping.
  **Verified with the SAME rigor as the cross-role sync fix (row 127), reused per
  instruction**: new `scripts/verify-products-catalog-fix.mjs`, 35 assertions, 35/35 passing
  on the first run, using the identical "genuinely separate PM/client contexts" harness (two
  independent `supabase-data.js` module instances, zero shared JS state) — not a
  same-process convenience that could mask the same bug class again. Covers, all through the
  REAL admin/client UIs: a real Add Product (Crypto, description+logoUrl) confirmed rendering
  correctly — exact real logo `<img src>` and description — on real `asset-collection.html`
  in a genuinely independent client-session context; a real Add Product (Private Equity,
  description+extendedDescription) with a real holding, its real "More info" popup showing
  the exact real text; **the core proof**: a real Edit Product reclassifying that held
  product from Private Equity to Real Assets through the real admin UI, then loading
  BRAND-NEW, FRESH real `dashboard.html`/`risk-management.html` DOM instances confirming the
  held value's allocation/diversification grouping genuinely moved (Private Equity 0.0%
  after, Real Assets the same nonzero % it used to show) with ZERO changes to either client
  page's own code; the real unitPrice-immutability rejection; a real invalid-`assetClass`
  rejection (zero rows created). Full existing Supabase suite re-run alongside with zero
  regressions (863 prior assertions unaffected, plus `supabase-golden-path-regression.js`
  `PASS (16/16 steps)`). Backend Requirements Register row 129 added; row 128's own gap note
  updated to point here. **The Security Actions Log remains the one honest, still-open gap**
  — no real Supabase backend exists for it at all. Real cloud "Marketswave Staging" untouched
  — local stack only; the new migration/columns/functions exist only on the local Supabase
  Docker stack until a future deployment stage pushes them for real.
- **★ Dashboard Real-Data Fixes (2026-09-03)**: closes 4 real fabricated/incomplete figures
  on `dashboard.html`. **1. Real Monthly Change %**: new `portfolio_value_snapshots` table
  (`client_id`/`month_start_date`/`value_at_anchor`, unique on the pair) plus a new
  `get-portfolio-monthly-change` Edge Function, closing the hardcoded "+4.2% this month"
  label — reads (or, on a client's genuinely first call in a calendar month, CREATES using
  the real current Total Portfolio Value) that month's anchor row, then computes
  `% change = (current - anchor) / anchor`. **Deliberately its OWN function, not folded into
  `get-total-portfolio-value`**: that function is also called cross-client by
  `admin-clients.html` browsing every client's balance — if snapshot creation were a side
  effect of ITS OWN call, an admin merely looking at a client's balance could silently set
  their real monthly anchor to whatever the portfolio happened to be worth at that moment.
  The shared computation was extracted into `computeTotalPortfolioValue()` in
  `_shared/portfolio-engine.ts` (a pure refactor of `get-total-portfolio-value`'s own prior
  inline logic, zero behavior change, verified via the full suite), now used by both
  functions. A genuinely `$0` anchor that later receives real money the SAME month reports
  `changePercent: null` (never NaN/Infinity/a guessed value) — shown as "New this month."
  **2. Asset Returns / Best Performing Class**: Asset Returns now reads
  `account_state.asset_returns` directly (already fetched by the existing
  `loadDashboardData()` — zero new backend work needed), correctly realized-only per the
  locked rule. Best Performing Class **reuses the exact per-class grouping the pie chart
  already computes** — read the real current implementation first, per instruction, then
  extracted it into a shared `computeClassBreakdown(data)` (not rebuilt) so both the pie
  chart AND the new card call the same grouping against the same already-cached data —
  extended to sum each class's real cost basis and surface the class with the highest
  `(current value - cost basis) / cost basis`; honest "—"/"No holdings yet" for a client
  with no holdings anywhere, never a fabricated best class; labeled "unrealized," not "YTD"
  (which the original hardcoded copy claimed but never actually was). **3. Empty-State Pie
  Chart**: a genuinely `$0` Total Portfolio Value (`data.tpv === 0`, distinct from
  "unallocated cash but nothing allocated," since TPV already includes
  `unallocatedCapital`) now hides the chart and shows an honest "No capital deployed yet."
  message plus a real "Deploy Capital" link, matching this project's own established
  empty-state visual language; real unallocated-cash-only clients still render normally, a
  real 100% Unallocated slice, confirmed as the genuinely distinct case. **4. Settings
  Legal Name/Address/ID Investigation**: investigated directly for the real reported client
  (`stormarem@gmail.com`) — confirmed via a direct query that NEITHER a `client_profiles`
  row NOR a single `profile_change_requests` row has ever existed for them; **the "—"
  display is genuinely correct and honest, not a bug**. A small per-field helper hint was
  added, shown only when that specific field is genuinely empty, so the honest empty state
  reads as intentional to a real client. **Verified**: new
  `scripts/verify-dashboard-real-data-fixes.mjs`, 38 assertions, 38/38 passing on the first
  run — a real "multi-day" monthly-change scenario via direct state manipulation between
  real calls (same technique as the HYS maturity-transition fix, row 124, since a real
  Deno Edge Function's own `new Date()` can't be mocked): first-call anchor creation, a
  second call after a real balance change proving the anchor stays stable (the actual bug
  this feature prevents), a real cross-month isolation proof, the `$0`-anchor-then-real-
  money edge case, plus a real `dashboard.html` UI round trip; a real deliberately-varied
  3-class holdings mix (one genuine winner, one genuine loser) checked against
  independently-computed expected percentages; both empty-state pie-chart cases; the real
  settings.html investigation result captured directly from a live query, plus a real
  hint-visibility/per-field-independence round trip. Full existing Supabase suite re-run
  alongside with zero regressions (931 prior assertions unaffected, plus
  `supabase-golden-path-regression.js` `PASS (16/16 steps)`). Backend Requirements Register
  row 130 added. Market Snapshot/Currency Converter remain deliberately untouched — both
  still need real external market/FX data.
- **★ Portfolio Allocation empty-state redesign (2026-09-04, row 131)**: purely visual —
  the `data.tpv === 0` content logic from the Dashboard Real-Data Fixes task (row 130) is
  completely unchanged (a genuine $0 total still shows this state; real unallocated-cash-only
  with nothing allocated still renders the real 100% Unallocated slice normally, confirmed
  unaffected). Replaced the old plain "No capital deployed yet." text + bare link with a
  dashed circular ring standing in for the hidden pie chart (`border-2 border-dashed
  border-slate-300 rounded-full`, reusing the exact same responsive `max-w-[13rem]
  sm:max-w-[14rem] md:max-w-[15rem] lg:max-w-[18rem] xl:max-w-[20rem] 2xl:max-w-[22rem]
  aspect-square` sizing classes `#allocation-chart-wrapper` itself already uses, so the ring's
  diameter tracks the real pie chart's diameter at every breakpoint rather than being a fixed
  guess), a small muted Feather-style pie-chart icon centered inside it
  (`text-slate-300`, matching this project's established stroke-icon convention — `viewBox 0
  0 24`, `stroke-width 2`, round caps, `currentColor`), a headline ("No capital deployed
  yet." — kept its trailing period specifically to keep matching the exact substring
  `verify-dashboard-real-data-fixes.mjs`'s own Part 3a assertion already checks for, not
  reworked as a new sentence), one short supporting line, and the "Deploy Capital" CTA
  reusing the exact same `bg-navy text-white ... rounded-lg` button classes used everywhere
  else in this app (confirmed via a project-wide grep of every `bg-navy text-white` button
  first) rather than a bare unstyled link — the link element/href/label were already correct
  and untouched, only its surrounding visual treatment changed. Only locked navy/cream +
  slate-300/slate-400 tokens used, no new colors. **Verified**: re-ran both
  `scripts/verify-dashboard-real-data-fixes.mjs` (38/38, including the exact empty-state
  assertions this change touches — the hidden chart wrapper, the "No capital deployed yet."
  substring, and the "Deploy Capital" link) and `scripts/verify-dashboard-ui-wiring.mjs`
  (27/27) against the real local Supabase stack, zero regressions in either. Per this
  project's standing verification policy, no browser launch was performed — the visual result
  was described here for the user to check themselves.
- **★ Real Supabase Storage integration for Documents (2026-09-04, row 132)**: replaces the
  metadata-only stub (a document row with just a client-typed `filename`, no real bytes
  anywhere) with genuine file upload/download — this is the fix for the originally reported
  bug (the Download button doing nothing for PM-uploaded files). Local stack only, real cloud
  "Marketswave Staging" untouched. **Storage policy mechanism, investigated first, per
  instruction, before writing any schema** — confirmed directly against Supabase's current
  docs: `storage.objects` is a real Postgres table with real RLS policies, created the same
  way as any other RLS policy (not a bucket-specific config mechanism), scoped via the
  built-in `storage.foldername(name)` helper; `createSignedUrl()` genuinely requires the
  caller's session to pass the objects table's own SELECT policy (confirmed live: a signed
  URL for a path with no real object behind it returns a real "Object not found" 400, not a
  free pass) — so no separate "generate-download-url" Edge Function is needed for either
  role, a real client-side call suffices once RLS allows it. **Path convention, deliberately
  chosen, not incidental**: every object lives at
  `<client_id>/<uploads|published>/<document_row_id>/<filename>` — the `client_id` segment is
  the SAME uuid as `documents.client_id` (a folder-based RLS check, zero lookup into the
  `documents` table itself, avoiding any RLS-recursion risk); the `uploads`/`published`
  segment mirrors the table's own `direction` column so the storage-level DELETE policy can
  mirror the table's own deliberate strengthening (a client may remove their own upload,
  never a document the firm published) even though `storage.objects` has no `direction`
  column of its own; the `document_row_id` segment is generated BEFORE upload and reused as
  the row's own explicit `id` on insert, so the path and its owning row are tied together by
  construction. **`owner_id`-based scoping was investigated and deliberately rejected**: a PM
  publishing a document uploads it via `service_role`, so `owner_id` would be the service
  role's own identity, not the receiving client's — folder-path scoping is the only scheme
  that works identically for a client's own upload and a PM's publish-on-behalf-of. New
  migration `20260904150000_create_documents_storage_bucket.sql`: a private `documents`
  bucket (20MB limit, unrestricted mime types); 3 storage.objects policies (client SELECT own
  + admin SELECT all; client INSERT into their own `uploads` subfolder only; client DELETE
  their own `uploads` subfolder only — no client-side INSERT/DELETE exists for the
  `published` subfolder at all, publishing is `service_role`-only); a new nullable
  `documents.storage_path` column (nullable for real backward compatibility with a
  pre-existing row that has no file behind it — this project's own disclosed leftover test
  row included — never fabricated); and an `ALTER POLICY` extending the existing client-
  INSERT policy with `storage_path is not null`, the smallest possible diff for the one new
  requirement, every other clause byte-for-byte unchanged. **`publish-document`
  Edge Function extended**: now requires a `fileBase64` field (the request stays plain JSON,
  matching every other Edge Function in this project, rather than restructuring this one
  endpoint as multipart) — decodes it, uploads to the client's `published` subfolder via the
  same `service_role` client already used for the row insert (bypasses RLS entirely, so no
  separate admin-facing storage INSERT policy is needed), generates the row's `id` before the
  upload so both share it, and only inserts the row if the upload genuinely succeeded (a
  failed upload creates no row; a row-insert failure after a successful upload leaves a
  harmless orphaned object — an accepted, disclosed non-atomicity at the same risk level this
  project already accepts elsewhere). **`documents.html`**: Upload now uploads the real file's
  real bytes directly (RLS-authorized, no Edge Function, matching Documents' own established
  direct-write architecture) before inserting the row — a missing file selection is now a
  real, disclosed validation error (the old silent fallback to a fake "Untitled Document.pdf"
  filename with no real bytes behind it no longer makes sense once real bytes are what's
  actually stored). Download (for `from` documents) now fetches a real, time-limited (60s)
  signed URL and opens it — a null `storage_path` (a pre-existing/legacy row) shows an honest
  "No File Attached" toast rather than attempting a doomed signed-url request. Remove now
  also best-effort deletes the real underlying storage object after the row delete succeeds
  (RLS-authorized directly, made possible by the new client-DELETE storage policy) — a
  failure here stays silent, since the row is already genuinely gone, which is the
  user-facing intent; an orphaned/already-missing storage object is a harmless, invisible
  resource leak, not a user-facing failure worth surfacing as one. **`admin-documents.html`**:
  Publish now reads the chosen file's real bytes, base64-encodes them client-side (a chunked
  loop, not a one-shot `String.fromCharCode(...bytes)` spread, so a real, reasonably large
  file doesn't risk a stack-size error), and sends them to the extended `publish-document`
  function. Download (both the Pending list and History) now fetches a real signed URL for
  either an uploaded or a published document, same null-`storage_path` honest-empty-state
  handling as the client side. New `MarketswaveData.uploadFile()` /
  `getSignedDownloadUrl()` / `deleteFile()` in `supabase-data.js`, plus a new
  `classifyStorageError()` (Storage's own `StorageError`/`StorageApiError` shape — a real
  `.status`/`.message`, confirmed directly against the installed `@supabase/storage-js`
  source — is a genuinely different shape from both a rejected Edge Function call and a
  rejected PostgREST table write, so neither existing classifier applied). **Verified**: new
  `scripts/verify-documents-storage-integration.mjs`, 46 assertions, 46/46 passing — a real
  end-to-end round trip both directions (Client A uploads a real file with real bytes via the
  real `documents.html` UI, the PM sees and downloads the exact real bytes via the real
  `admin-documents.html` UI, confirmed byte-for-byte via an actual fetch of the real signed
  URL, not just a plausible-looking URL string; the PM publishes a real file the same way,
  Client A sees and downloads the exact real bytes back); cross-client isolation tested
  directly at the Storage level, not just the table level (Client B cannot generate a signed
  URL for, delete, or upload into Client A's real folder; a client cannot upload into their
  own `published` subfolder, impersonating a firm-published document; Client A cannot delete
  the real PM-published file; a real admin-claimed session CAN read across every client
  directly); Remove's real storage cleanup confirmed (polled, since the row-delete and the
  best-effort storage-delete are two genuinely separate async operations); and the honest
  null-`storage_path` empty state confirmed on both real pages. Missing-file validation
  confirmed on both the real Upload and the real Publish forms. **A real architectural
  discovery made and fixed while writing this script, not present in any prior "genuinely
  separate contexts" script because none of them ever needed TWO simultaneously-active CLIENT
  identities**: unlike `admin-supabase-config.js` vs. `supabase-config.js` (two different
  files, safely left as real, un-duplicated singletons per this project's own established
  precedent), two client contexts would BOTH resolve `supabase-data.js`'s own
  `import('./supabase-config.js')` to the exact same un-duplicated singleton — confirmed
  directly (a first draft using a real second `MarketswaveData` context for Client B made
  every subsequent Client-A action fail with a genuine RLS rejection, since the shared
  client's real session had silently become Client B's) — resolved by giving Client B a
  plain, directly-created `createClient()` session instead (mirroring
  `verify-supabase-documents-support.js`'s own established `signIn()` helper) for the
  isolation checks, which only ever needed a second real session, not a full simulated
  second browser tab. New shared `scripts/lib/storage-test-cleanup.mjs`
  (`removeAllClientStorageObjects()`) recursively lists and removes every real object under a
  test client's own folder — confirmed necessary and wired into this new script,
  `verify-hys-documents-ui-wiring.mjs`, `verify-cross-role-sync-bugfix.mjs`, and
  `verify-supabase-documents-support.js`'s own `cleanupClient()`, after a real audit found 17
  genuinely orphaned test objects left behind by earlier runs of those files (real Storage
  objects have no foreign-key cascade from a deleted `documents` row or a deleted test user —
  confirmed directly, and cleaned up manually once, then closed at the source in all 4
  affected files). **Regression fixes required in 2 pre-existing test files, disclosed, not
  silently patched**: `verify-hys-documents-ui-wiring.mjs`'s own Upload-action test needed a
  real Node `File` injected (the old fake-filename-fallback path this test relied on no
  longer exists) plus a real `pollUntil` fix for a genuine race the slower, now-real upload
  sequence exposed (the row-flash assertion was reading the DOM before the async reload's own
  render had settled — the toast fires as soon as the write promise resolves, a separate,
  earlier microtask than the reload's own fetch-then-render chain); its Download-test seed
  data needed a real uploaded object behind its `storage_path`, not just a placeholder string
  (confirmed a fake path genuinely fails `createSignedUrl()`, not a free pass).
  `verify-cross-role-sync-bugfix.mjs`'s own Publish and Upload tests needed the same real
  Node `File` injection (a bare `{ name: '...' }` placeholder has no `.arrayBuffer()` method,
  which the real Publish handler now calls). `verify-supabase-documents-support.js` (Phase B
  Stage 6's own low-level RLS/validation suite) needed `fileBase64` added to every "should
  succeed" `publish-document` call and `storage_path` added to every "should succeed" client
  INSERT — 3 new assertions added alongside (a missing-file 400, a missing-`storage_path`
  RLS rejection, confirming both real `from` documents carry a real `storage_path`), 64→67.
  The full existing Supabase suite was re-run alongside with zero regressions:
  `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
  `verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js`
  88/88, `verify-supabase-hys.js` 112/112, `verify-supabase-final-approval-gate.js` 69/69,
  `verify-supabase-documents-support.js` 67/67 (was 64), `verify-dashboard-ui-wiring.mjs`
  27/27, `verify-asset-pages-ui-wiring.mjs` 36/36, `verify-funding-transactions-ui-wiring.mjs`
  54/54, `verify-hys-documents-ui-wiring.mjs` 69/69 (was 68, +1 net), `verify-cross-role-sync-
  bugfix.mjs` 34/34, `verify-settings-risk-support-ui-wiring.mjs` 33/33,
  `verify-admin-approval-gate-ui-wiring.mjs` 102/102, `verify-admin-final-wiring.mjs` 39/39,
  `verify-products-catalog-fix.mjs` 35/35, `verify-dashboard-real-data-fixes.mjs` 38/38, and
  `supabase-golden-path-regression.js` `PASS (16/16 steps)` — every real storage object this
  session's own repeated runs left behind (17 confirmed, both from this script's own earlier
  failing drafts and from `verify-supabase-documents-support.js`'s pre-fix runs) was found via
  a direct `storage.objects` audit and removed, confirmed via a fresh re-run of the
  now-fixed cleanup paths leaving zero residue. README.md updated in place with manual
  repro steps for an eyes-on visual check — flagged as specifically warranted here, unlike
  most other backend-wiring stages, since this is the first feature moving real file bytes
  through the system.
- **★★★ Pre-hosting fix: real hosted default now reaches Supabase staging, not the local
  Docker stack (2026-09-04, row 133) — a genuinely important pre-launch fix, read before this
  project is deployed anywhere public.** Investigated first, per instruction, before assuming
  anything: read the real current `supabase-config.js`/`admin-supabase-config.js` source and
  confirmed both files' current default (zero query params) resolves to the LOCAL Docker
  stack (`http://127.0.0.1:54321`) — a real, disclosed consequence of the Aug 30, 2026
  Firebase Retirement inversion, correct for a developer's own machine but **launch-blocking**
  for a real hosted deployment: a real visitor's browser never carries `?env=staging` (or any
  query param) in its URL, so a page served from a real public domain with that old default
  would silently try to reach a URL unreachable from anywhere but the machine that ran
  `supabase start`, and every real signup/login would simply fail. **Fix, applied
  independently to BOTH files, confirmed neither's fix accidentally covered the other**: the
  default now depends on the page's own `window.location.hostname`, not a query param —
  `localhost`/`127.0.0.1` (confirmed against this project's own real local-dev workflow,
  `python -m http.server` at `127.0.0.1:8765`) defaults to the local stack, zero config; any
  OTHER hostname (a real hosted deployment, by definition) defaults to real cloud "Marketswave
  Staging," zero config — inverting the opt-in relationship exactly as instructed, via
  automatic hostname detection rather than requiring every developer to remember a flag.
  `?env=staging` remains an explicit override reachable from anywhere including localhost
  (an existing, relied-upon local-dev-against-real-staging workflow, left unchanged); a new
  `?dev=local` is the explicit opt-in for the rare reverse case (testing local backend code
  from a non-localhost frontend host) — not needed for normal local development, which
  hostname detection already covers automatically; `env=staging` wins if both are somehow
  present together. The Firebase legacy escape hatch (`?legacyBackend=firebase`) is completely
  unaffected, out of scope. **A project-wide grep for every other hardcoded localhost/127.0.0.1
  reference was run and reported, per instruction**: every `scripts/*.js`/`scripts/*.mjs` hit
  is dev/test tooling only, never shipped to a real visitor, and the local-stack ones already
  carry their own `readLocalStackCredentials()` guard refusing to run against anything but a
  real local API URL — no fix needed. `firebase-config.js` has the exact same bug class (also
  defaults to its emulator on zero params) but is genuinely out of scope: reachable only via
  the explicit `?legacyBackend=firebase` flag, never a default path a real visitor could hit
  by accident — reported, not fixed. `supabase/config.toml`'s own `site_url` is local-CLI-only
  and was already confirmed (Supabase Migration Stage 3) to have zero functional effect (no
  OAuth/redirect/OTP/MFA flow exists in this codebase). No `.html` file and no other
  browser-loaded `.js` file contains a hardcoded localhost reference at all. **Verified**: new
  `scripts/verify-hosting-default-fix.mjs`, 18 assertions, **18/18 passing** — needs no local
  stack running at all (it verifies which target gets *selected*, not a real network call
  against either): a real hosted domain with zero params genuinely constructs a client wired
  to the real staging URL (the actual fix, confirmed via the constructed client's own
  `supabaseUrl` property, not just a correctly-computed unused variable); `localhost`/
  `127.0.0.1` with zero params genuinely stays local; both explicit overrides confirmed in
  both directions; the `env=staging`-wins priority; the Firebase escape hatch unaffected —
  covering both files independently. **A real regression found and fixed across 11 existing
  test files, a direct and correct consequence of this fix, not a false failure**: every one
  of them builds a bare fake `window` object (`{ location: { search: '' } }`, no `hostname` at
  all) to simulate a browser tab before importing `supabase-data.js` — now that
  `window.location.hostname` is actually read, `undefined` matched neither `localhost` nor
  `127.0.0.1`, silently sending every affected test against **real cloud staging instead of
  the local stack** and breaking on missing seed data/permissions; fixed by adding
  `hostname: '127.0.0.1'` to each fake window — the more faithful simulation of what a real
  local browser tab always provides, simply never needed before now since no code read it:
  `verify-admin-final-wiring.mjs`, `verify-asset-pages-ui-wiring.mjs`,
  `verify-admin-approval-gate-ui-wiring.mjs`, `verify-cross-role-sync-bugfix.mjs`,
  `verify-dashboard-real-data-fixes.mjs`, `verify-dashboard-ui-wiring.mjs`,
  `verify-documents-storage-integration.mjs`, `verify-funding-transactions-ui-wiring.mjs`,
  `verify-hys-documents-ui-wiring.mjs`, `verify-products-catalog-fix.mjs`,
  `verify-settings-risk-support-ui-wiring.mjs`. The complete existing Supabase suite then
  passed with zero further regressions: `verify-supabase-schema.js` 16/16,
  `verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js`
  76/76, `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 112/112,
  `verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js`
  67/67, `verify-dashboard-ui-wiring.mjs` 27/27, `verify-asset-pages-ui-wiring.mjs` 36/36,
  `verify-funding-transactions-ui-wiring.mjs` 54/54, `verify-hys-documents-ui-wiring.mjs`
  69/69, `verify-cross-role-sync-bugfix.mjs` 34/34,
  `verify-settings-risk-support-ui-wiring.mjs` 33/33,
  `verify-admin-approval-gate-ui-wiring.mjs` 102/102, `verify-admin-final-wiring.mjs` 39/39,
  `verify-products-catalog-fix.mjs` 35/35, `verify-dashboard-real-data-fixes.mjs` 38/38,
  `verify-documents-storage-integration.mjs` 46/46, and `supabase-golden-path-regression.js`
  `PASS (16/16 steps)`. Both edited config files' own header comments were rewritten in place
  to describe the new scheme; README.md's top-of-file summary (which had gone stale, still
  describing the old unconditional-local default) and a new dated section were both updated.
- **★ Admin Auth Consolidation (2026-09-05) — the admin tool moves from two overlapping
  access layers to one real login, LOCAL STACK ONLY, staging deliberately not touched this
  task.** Retires the client-side passphrase gate (`checkAdminPassphrase()`/
  `setAdminAuthenticated()`/`isAdminAuthenticated()`/`clearAdminAuthenticated()`/
  `ADMIN_PASSPHRASE`, Aug 21, 2026) and the SEPARATE, previously `persistSession: false`,
  lazily-re-established real Supabase admin session (Stage 3, Aug 30, 2026) that sat
  underneath it — a real Supabase Auth session, established once via a real email/password
  sign-in, is now the tool's sole access layer. **Retired, not deleted**: `engine-core.js`'s
  passphrase functions/constant are marked with a ★ RETIRED comment banner (same treatment as
  the Firebase integration) and left byte-for-byte functionally unchanged, confirmed via
  project-wide grep to have zero remaining live callers. `admin-login.html` is rebuilt as a
  real email/password form calling `supabase.auth.signInWithPassword()` directly (one
  deliberately generic "Invalid email or password" error either way, the same
  email-enumeration-avoidance principle `login.html`'s own real check already uses); a local-
  stack convenience hint shows the known, already-disclosed local bootstrap credential
  (`pm@marketswave.local`) without pre-filling it — the PM still explicitly signs in on both
  environments, deliberately not special-cased per environment. A real "already signed in?"
  check on load redirects straight through if a valid session already exists. **Session
  persistence flipped `persistSession: false` → `true`** in `admin-supabase-config.js` (matching
  `supabase-config.js`'s own client-facing decision) — genuinely necessary now that this
  session is the tool's only gate, since "a page refresh should re-prompt" no longer makes
  sense once refreshing IS how a PM keeps working across pages. **A real, investigated
  consideration this specific change introduces, not assumed away**: checked directly against
  the installed SDK source (`scripts/node_modules/@supabase/supabase-js/src/SupabaseClient.ts:
  326-327`) — the DEFAULT `storageKey` is derived purely from the target project's own URL
  hostname (`sb-<hostname>-auth-token`), with nothing distinguishing which file/role
  constructed the client; both the admin and client-facing clients point at the exact same
  local-stack/staging URLs, so the moment the admin client's session started persisting to
  `localStorage` on the same origin, it would have silently shared (and could clobber, or be
  clobbered by, or worse, be misread as) the client-facing session's own storage key. Fixed
  with an explicit, distinct `storageKey: 'sb-marketswave-admin-auth-token'` — verified
  directly, not just reasoned about (see Verified below), and confirmed as a genuine
  correctness win beyond the collision itself: it also gives the admin session its own
  BroadcastChannel, so cross-tab session-change notifications for the two personas can never
  cross into each other. **Every admin page's gate check** (`admin-sidebar.js`) now calls the
  real `supabase.auth.getSession()` instead of reading a raw passphrase flag — necessarily
  async (a real session check cannot be synchronous), so "before anything else" now means
  firing the check as the very first statement the file executes and gating both
  `initAdminSidebar()`'s own rendering (split into a new `renderAdminSidebar()` the check
  gates) and the logout handler on its result; a brief render of the static page shell before
  a redirect resolves is disclosed as a cosmetic timing question, not a security one, since
  every real privileged call is independently enforced server-side by RLS/an Edge Function's
  own admin-claim check regardless of how fast the client-side redirect fires. **The lazy
  mid-page "Staging Admin Sign-In" modal is removed** — confirmed no longer necessary, not
  just deleted on assumption: `ensureSupabaseAdminSignedIn()` (still called by
  `admin-client-applications.html` directly and transparently by every other admin page via
  `supabase-data.js`'s `useAdminClient()`) is rewritten from "sign in, prompting if needed" to
  a pure defense-in-depth "confirm a real session exists, redirect to the real login if not"
  check — there is nothing left for a lazy prompt to lazily establish, since a real session
  already exists by the time any of this code runs on any page other than admin-login.html
  itself. **Logout, investigated and found genuinely missing, not just "confirmed already
  wired" as the task assumed**: no admin-side `signOut()` call existed anywhere before this —
  the old Logout handler only ever cleared the local passphrase flag, since there was no
  durable session to end (`persistSession: false` never touched `localStorage`). Built fresh,
  mirroring `dashboard-sidebar.js`'s own `signOutOfSupabaseAuth()` exactly (same dynamic-
  import + 3-second-timeout-race shape) — and the SAME investigated conclusion applies
  identically here (same SDK, same `persistSession: true` + `localStorage` combination): this
  SDK/config pairing needs neither of the two races Firebase's own `signOut()` had to work
  around by hand, confirmed by reading the exact same source lines that conclusion was
  originally verified against. **Verified**: new `scripts/verify-admin-real-login.mjs`, 31
  assertions, **31/31 passing**, against the REAL, unmodified production files (not a
  reimplementation) — `admin-sidebar.js`, `admin-supabase-config.js`, and `admin-login.html`'s
  own inline module script (extracted verbatim into a real temp `.mjs` file, not hand-
  retyped), executed via genuinely fresh Node module instances per simulated "page load"
  (temp-copy technique, mirroring this project's own established "genuinely separate
  contexts" precedent) sharing only a real `localStorage` polyfill — never the same in-memory
  client object across "reloads," which would have falsely "proven" persistence via JS-object
  continuity instead of the real storage-read-on-init path a genuine static-multi-page
  navigation actually depends on. Covers, end to end: a wrong password rejected with the
  generic message and no session created; a correct sign-in through the real form succeeds;
  visiting any admin page while logged out redirects immediately to the real login with the
  sidebar never rendered; navigating Deposits → Allocations → Overview → Deposits (four
  genuinely fresh module instances) needs no re-authentication and genuinely renders each
  time; clicking Logout ends the session and redirects; and — the same rigor as every prior
  logout verification in this project — a GENUINELY FRESH page load afterward (not an
  in-page synchronous read) is independently confirmed denied, both through the real gate and
  through a direct, separate `getSession()` call; plus the storageKey isolation fix itself,
  proven by signing into a real client session and a real admin session in the SAME shared
  `localStorage` and confirming neither clobbers the other, with both distinct keys present
  side by side. **Two real, disclosed regressions found and fixed in 5 pre-existing test
  files, a direct and correct consequence of retiring the old auto-sign-in behavior, not a
  false failure**: (1) `admin-supabase-config.js`'s new redirect-on-no-session path used a
  bare `location.replace(...)`, crashing with `ReferenceError: location is not defined` in
  two test harnesses (`verify-products-catalog-fix.mjs`, `verify-documents-storage-
  integration.mjs`) that stub `window` without a separate bare `location` global — fixed by
  using `window.location.replace(...)` instead, consistent with this file's own existing
  `window.location.search`/`.hostname` reads elsewhere, closing the gap without needing to
  touch either test file's own stub shape; (2) five test files
  (`verify-products-catalog-fix.mjs`, `verify-documents-storage-integration.mjs`,
  `verify-cross-role-sync-bugfix.mjs`, `verify-admin-approval-gate-ui-wiring.mjs`,
  `verify-admin-final-wiring.mjs`) had genuinely relied on the OLD, now-retired local-stack
  auto-sign-in behavior — two of them even had a header comment explicitly describing it as
  the reason no manual sign-in was needed — so each now performs one real, explicit
  `signInWithPassword()` call as the local bootstrap PM before calling `useAdminClient()`,
  exactly mirroring how a real admin page is only ever reachable after a real login already
  happened on `admin-login.html`; the stale header comments were corrected in place rather
  than left describing removed behavior. The full existing Supabase suite was re-run
  alongside with zero further regressions: `verify-supabase-schema.js` 16/16,
  `verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js`
  76/76, `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 112/112,
  `verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js`
  67/67, `verify-dashboard-ui-wiring.mjs` 27/27, `verify-asset-pages-ui-wiring.mjs` 36/36,
  `verify-funding-transactions-ui-wiring.mjs` 54/54, `verify-hys-documents-ui-wiring.mjs`
  69/69, `verify-cross-role-sync-bugfix.mjs` 34/34,
  `verify-settings-risk-support-ui-wiring.mjs` 33/33,
  `verify-admin-approval-gate-ui-wiring.mjs` 102/102, `verify-admin-final-wiring.mjs` 39/39,
  `verify-products-catalog-fix.mjs` 35/35, `verify-dashboard-real-data-fixes.mjs` 38/38,
  `verify-documents-storage-integration.mjs` 46/46, `verify-hosting-default-fix.mjs` 18/18,
  and `supabase-golden-path-regression.js` `PASS (16/16 steps)`. README.md updated in place
  with a new dated runbook section covering the real login flow. **Real cloud "Marketswave
  Staging" was deliberately NOT touched this task** — the real staging PM account
  (`pm@marketswave-staging.internal`) still authenticates exactly as it already did (unchanged
  by this task), but `admin-login.html`'s real form now IS the only way to establish that
  session too, on staging, once this same change is applied there in a following task, per
  instruction. Backend Requirements Register row 134.
- **★ Homepage Visual Redesign — Stage 1: shared glass/gradient primitives + Hero + Stats
  Bar (2026-09-05).** First real application of a newly-approved visual direction for the
  public marketing site — "liquid glass, light background" — built against a real reference
  preview (3 iterations reviewed; built against the final, approved one specifically, not the
  earlier dark or flat-glass versions). Scope was deliberately narrow, per instruction: the
  persistent site header/nav (shared across every page, a separate future decision) and
  everything below the Stats Bar are both untouched.
  **1. Four reusable primitives, extracted into `styles.css` first** (a new "4A. SHARED
  VISUAL PRIMITIVES" section, positioned right before the Hero section it's first applied
  to), meant to be pointed at directly by every later redesign stage rather than
  re-derived: `.glass` (layered-translucency gradient background, a light-catching border —
  brighter top/left, darker bottom/right — inset+outer shadow, and a top-left sheen via
  `::before`); `.gradient-text` (navy → teal → gold headline accent, via
  `background-clip:text`, with a real solid-navy fallback color declared first for browsers
  that don't support it — never invisible text); `.blob` (a blurred gradient accent shape,
  composed from a base class + a size modifier `--sm/--md/--lg` + a color modifier
  `--teal/--gold/--blue/--rose/--violet` — position deliberately left OUT of the shared
  utility, since where a blob sits is inherently section-specific, so each section defines
  its own small set of position classes that pair with the shared size/color modifiers); and
  `.grid-overlay` (a faint, radially-masked architectural grid texture). All four are real,
  literal CSS ported from the approved reference preview's own recipe, not reinterpreted —
  the `rgba(27,58,75,*)` values throughout are `--primary`'s own decomposed RGB channels,
  documented as such since a CSS custom property can't be decomposed into R/G/B channels for
  reuse inside `rgba()`.
  **2. A deliberate, scoped palette expansion, documented per instruction** — two new root
  tokens, `--accent-teal` (`#16815F`, deep — gradient-text stop, eyebrow badge text/dot) and
  `--accent-teal-soft`/`--accent-gold-soft` (`#7FD4B4`/`#F0C878`, soft/pastel — blob
  backgrounds only), same category as `risk-management.html`'s own gold/mahogany +
  deep-green accent exception: used ONLY for blobs and gradient-text, never as a flat UI
  background, never anywhere else on the site. The gradient-text gold stop deliberately
  reuses the ALREADY-LOCKED `#C8860A` risk-meter/service-tag gold rather than introducing a
  second, redundant gold token. The blob utility's `--blue`/`--rose`/`--violet` modifiers
  (matching the reference preview's own extra accent hues) are decorative, blob-only
  literals — NOT promoted to named palette tokens, since the documented expansion is
  deliberately scoped to teal + gold only.
  **3. Hero**: fully rebuilt to the new light-glass treatment — grid overlay + 5 blobs
  (teal/gold/soft-blue main, rose/violet smaller accents, matching the reference preview's
  exact layout) behind the REAL existing headline/subheading/CTA copy, completely
  unchanged text, only the second `<h1>` line now carries `.gradient-text`. **A real,
  necessary consolidation found and fixed while doing this**: `.hero`'s CSS rule was
  DUPLICATED — a second, later `.hero` rule (a dark-tinted overlay on `hero-bg.jpg`) won
  the cascade over the first one and was the one actually rendering, meaning the real
  pre-existing hero was dark navy + a photographic background, not the plain flat-gradient
  the first (dead) rule implied. The second rule is deleted outright, confirmed orphaned via
  grep (`hero-bg.jpg` is no longer referenced anywhere); the image file itself is left on
  disk, unused, rather than deleted. New eyebrow badge (didn't exist before): real, accurate
  copy — **"Now Accepting New Applications," chosen and reported per instruction** — matches
  this site's own actual signup + PM-review flow (a real client application queue exists in
  the backend), deliberately NOT the reference preview's own placeholder ("Now live on real
  infrastructure," backend-infrastructure language inappropriate for client-facing marketing
  copy). New `.hero-btn-primary`/`.hero-btn-secondary` classes were added rather than
  restyling the existing `.btn-white`/`.btn-ghost` utility classes in place — both of those
  are used elsewhere on the site (`about.html`, `services.html`) and were designed for the
  OLD dark hero (`.btn-ghost` is literally a white-text-on-dark-background recipe), so
  redefining them would have silently broken those other pages and made no visual sense on
  the new light background regardless.
  **4. Stats Bar**: converted to 4 real liquid-glass stat cards (icon badge, value, label,
  trend line, matching the reference preview's card treatment) — **the `.stat`/`.value`/
  `.label` class names and text-node structure are completely UNCHANGED**, specifically so
  `home-motion.js`'s existing count-up animation (`animateStatCounters()`, which queries
  `.stats-bar .stat .value` and regex-parses each one's real numeric prefix/value/suffix out
  of its own textContent) needed zero code changes — confirmed working via a real headless-
  Chrome screenshot catching the animation mid-flight (`$899m` a frame before its final
  `$900m`). Real values only, all 4 of the site's real existing stats kept (the reference
  preview showed only 3 — a design reference, not a content spec to trim to). Each card's
  `.trend` line is honest supporting text, never a fabricated growth percentage: "Actively
  managed," "Since 2004" (a real fact, matching `about.html`'s own Founded 2004),
  "Across global markets," and "6 core services" (a real, verified count of
  `services.html`'s own service sections) — chosen specifically because the reference
  preview's own "↑ 12.4% YoY" trend text was invented flavor copy for the mockup, and this
  project has a standing, hard-won discipline against presenting fabricated figures as if
  real (see the Support/Settings fake-data fixes, §4.75).
  **5. `home-motion.js`**: two small, additive changes — the new `.hero-eyebrow` was added to
  the front of the existing hero fade-in stagger list (so it animates in first, ahead of
  `h1`, instead of appearing instantly); the 4 stat cards get the same staggered-group
  entrance reveal already established for other homepage sections (`.values-grid`, etc.),
  firing independently alongside (not instead of) the existing count-up
  `IntersectionObserver`.
  **★ Browser-verified live — no browser automation tool was available in this session
  (checked directly, not assumed), substituted with a real, disclosed alternative**: Chrome
  is installed locally but its CLI `--window-size` flag was found NOT to be honored below
  ~504px on this machine (confirmed directly — 320/375/390px requests all rendered an actual
  504px viewport, a genuine environment quirk, not a CSS bug — this false signal briefly
  looked like a real responsive-grid bug before being root-caused). Fixed by driving headless
  Chrome directly via the Chrome DevTools Protocol (`Emulation.setDeviceMetricsOverride`,
  Chrome's own real mobile-viewport-emulation mechanism, the same one Playwright/Puppeteer
  wrap) through a small custom Node script using Node's built-in `WebSocket`/`fetch` — no new
  dependencies installed. Verified at a real 1440px, a real 600px, and a real, properly-
  emulated 390px viewport: the glass sheen/border/shadow, the grid overlay, all 5 blobs, and
  the gradient text all render correctly; the Hero's own content reflows cleanly with zero
  overflow at every width (headline/paragraph wrap correctly, CTAs stack via the pre-existing
  `@media (max-width:480px)` rule); the Stats Bar correctly collapses 4→2→1 columns via the
  pre-existing responsive rules, confirmed genuinely at each breakpoint once the viewport
  emulation was fixed. **One real, pre-existing, explicitly out-of-scope issue confirmed, not
  newly introduced**: the site's own shared header (`.nav-toggle`/`.header-actions`) overflows
  a genuine 390px viewport — already documented as a known, cross-page issue unrelated to any
  one page's own content (see row 101/§4.95's own identical finding on `services.html`) — and
  confirmed via a direct 600px-vs-390px comparison that Hero/Stats content introduces zero
  ADDITIONAL overflow beyond what the header already causes on its own. Zero console errors
  or warnings (checked directly via CDP `Runtime`/`Log` events, not assumed). All temporary
  screenshots/scripts/Chrome profiles were cleaned up afterward; the specific headless Chrome
  process PIDs (confirmed via their own command line, not a broad kill) were closed, leaving
  the user's own real, already-running Chrome browser and its many tabs completely untouched.
  Backend Requirements Register row 135.
  **Same-day follow-up**: the eyebrow badge ("Now Accepting New Applications") was removed
  entirely per direct feedback — the Hero now opens straight into the eyebrow-free layout,
  `h1` first. Removed cleanly, not just hidden: the `<div class="hero-eyebrow glass">` markup
  is gone from `index.html`; the now-unused `.hero-eyebrow`/`.hero-eyebrow .dot`/
  `.hero-eyebrow .label` CSS rules are deleted from `styles.css` (confirmed via grep no other
  page references them); `home-motion.js`'s hero fade-in selector list is reverted to exactly
  its pre-Stage-1 form (`.hero h1, .hero .hero-lead, .hero .hero-ctas`, dropping
  `.hero-eyebrow`). The `--accent-teal` token is untouched and still genuinely in use
  elsewhere (the Stats Bar's own `.trend` line color) — this removal didn't orphan it. The
  three other shared primitives (`.glass`, `.gradient-text`, `.blob`/`.grid-overlay`) and
  their two other real applications in this same Hero (the `.hero-btn-secondary.glass`
  button) and the Stats Bar (all 4 `.stat.glass` cards) are unaffected — this was narrowly
  the one eyebrow-badge element, not a rollback of Stage 1 itself.
- **★ Homepage Visual Redesign — Stage 2: glass/gradient treatment extended across every
  remaining public-facing page** (2026-09-05): reuses Stage 1's shared primitives exactly —
  `.glass`, `.gradient-text`, `.blob`/blob modifiers, `.grid-overlay` — with two small,
  genuinely necessary additions, not forked per-page variants: **`.glass-subtle`** (half the
  blur, lighter background, no sheen `::before`, lighter shadow — for dense side-by-side item
  grids where full `.glass` would overdo translucency) and **`.blob-field`** (a reusable
  `position:relative;overflow:hidden` marker for hosting page-wide atmospheric blobs, plus a
  `.blob-field .container { position:relative; z-index:2 }` descendant rule so nested
  containers stay above the blobs). Every card-style class that needed the treatment
  (`.value-item`, `.account-card`, `.service-card`, `.strategy-card`, `.team-card`,
  `.service-stat`, `.contact-card`, `.contact-form-wrap`, `.approach-visual.process-steps`,
  `.philosophy-panel`) had its own hardcoded `background`/`border`/`box-shadow` removed so the
  `.glass`/`.glass-subtle` class (added via HTML) can supply them without fighting cascade
  order — the same technique Stage 1 already established for `.stat-card`.
  **index.html — remaining sections**: process-steps box gets full `.glass`; all 4 Our Values
  items get `.glass-subtle` (deliberately calmer at that density, per instruction); all 3
  Account Type cards get full `.glass`; Platform Pitch and What Makes Us Different both keep
  their deliberate anti-card typography untouched (3-column grouped list, numeral editorial
  treatment) and instead get a `.blob-field` + 2 subtle background blobs each for atmospheric
  consistency, per instruction; all 6 Core Services cards get full `.glass`; the Philosophy
  CTA (closing, high-impact moment) was rebuilt with a real `.glass` panel plus 2 large
  background blobs, matching the Hero's own visual weight. **A real contrast bug found and
  fixed, not an artifact**: `.glass`'s default background opacity (tuned for the light Hero)
  left the Philosophy panel's muted-grey body text nearly unreadable against the dark
  Philosophy section background, especially in the more-transparent lower-right corner of the
  135deg gradient — fixed by overriding `.philosophy-panel`'s own background to a much more
  opaque white gradient (94%/86%) and bumping the paragraph color to full-strength
  `var(--text)`; re-verified via screenshot as fully legible. Footer left completely
  untouched, per instruction. **services.html**: a task-framing discrepancy was found and
  corrected before building anything — this page is NOT a nav-list/detail-panel architecture
  (that was true once, per row 99-100, but was fully replaced by row 101's full-width
  scrolling-sections redesign) — confirmed by reading the live file directly. All 6
  `.service-stat` divs got `.glass`; a `.blob-field` + 3 blobs (teal/gold/blue) were added to
  the `.services-full` wrapper; checklist icons were deliberately left plain, per instruction
  (glass-ifying every bullet would be too dense). **resources.html**: all 6 Core Strategies
  cards and all 4 Help Center cards got full `.glass`; the 2 Blog & Press cards (not
  explicitly named by the task, but sharing the same base class that lost its background) got
  `.glass` too, for consistency; the How It Works workflow steps were deliberately left as
  plain typography, per instruction; `.blob-field` + subtle blobs added behind Core
  Strategies and Help Center. **about.html**: investigated and found the Vision/Mission cards
  and the Background & History facts block were ALREADY de-carded into a deliberate editorial
  pattern (row 108) — the exact same "protect a deliberate anti-card decision" principle the
  task itself named for Platform Pitch/What Makes Us Different — so these were deliberately
  left untouched (a `.blob-field` + 2 blobs added to the section instead, for atmospheric
  consistency only); all 3 team cards got full `.glass`. **contact.html**: a duplicate/dead
  CSS block was found (a second, later "CONTACT PAGE" rule set silently winning the cascade
  over an earlier, already-current-looking one — the same class of bug already found once in
  Stage 1's own `.hero` rule) — the dead block was deleted outright and the winning
  `.contact-card`/`.contact-form-wrap` rules were upgraded from ad-hoc rgba/blur to real
  `.glass`; a `.blob-field` + 2 blobs added behind the Contact Content section.
  **legal.html**: investigated and left completely untouched, confirming the user's own
  stated instinct — legal content earns trust through clarity, not visual flourish, the same
  reasoning already applied to this page's deliberate lack of animation; documented via a
  comment only, no visual change. **Verified, browser-first as instructed**: every touched
  page confirmed rendering correctly at both normal (1440px) and narrow (390px, via CDP
  `Emulation.setDeviceMetricsOverride`) viewports, with zero console errors on any page.
  Functional elements re-confirmed unbroken after the visual changes: contact.html's custom
  `.custom-select` dropdowns (open/select/close, hidden-input value all correct) and the Get
  Access modal (opens correctly on click) both tested via real DOM event dispatch, not
  assumed from markup; services.html's 6 real section anchor ids (`#trading`,
  `#discretionary`, etc.) confirmed structurally correct via `scrollIntoView` (a genuine,
  disclosed headless-tab scroll-throttling artifact — the same one already documented in row
  101 — meant a plain hash-driven scroll couldn't be timed reliably in this environment, so
  the anchor TARGET's correctness was confirmed directly instead of the native scroll
  animation itself). Color contrast was checked deliberately wherever glass/blur sits over
  varying background content, not just glanced at — this is what caught the real Philosophy
  panel bug above; every other glass surface on every page was confirmed to keep full text
  legibility. All temporary screenshots/scripts/the headless Chrome profile were cleaned up
  afterward, the specific Chrome PIDs (confirmed via their own command line, not a broad
  kill) closed, leaving the user's own real browser session untouched. Backend Requirements
  Register row 136.
- **★★★ INCIDENT + FIX: real cloud staging deployed real Phase B schema/functions for the
  first time since Supabase Migration Stage 3 (2026-09-05, row 137) — the live public site
  was broken for real users until this closed.** A real user (robert greene) hit "Could not
  reach the server" on the real, live, hosted `dashboard.html`. **Diagnosis (separate task,
  same day, fully reported before any fix per instruction)** confirmed the root cause
  directly against the real remote project, not assumed: every one of Phase B's 9 migrations
  (Stages 1-6, Aug 30 - Sep 4) and 34 of 36 Edge Functions had only ever been applied to the
  LOCAL Docker stack — each stage's own "local stack only, real cloud staging untouched"
  scope note was accurate and deliberate at the time it was written, but nothing ever tracked
  when cloud staging needed to catch up, so the gap silently grew for ~10 days until a real
  visitor hit it. Confirmed via direct REST probes against the real remote (`PGRST205 Could
  not find the table` on every Phase B table) and `supabase functions list` (only
  `approve-client-application`/`reject-client-application`, from Stage 3, were `ACTIVE`).
  Three other candidate causes were investigated and ruled out: the project was not paused
  (`ACTIVE_HEALTHY`, real 200s from REST/Auth); Admin Auth Consolidation (same day) was
  confirmed unrelated by diffing every file it touched — the only shared-file change was
  inside `useAdminClient()`, confirmed via grep to be admin-only, never reached by
  `dashboard.html`'s own code path; no genuine Supabase platform incident (status page
  confirmed all core services operational, no active incidents). **Fix**: a safety-net commit
  first (`ea78a7f`, the standing high-risk-change convention, since this was the first real
  touch of cloud staging since Stage 3) — confirmed clean of secrets before committing. Then,
  after confirming the linked CLI project (`ujnmlwbpginplfnofhhv`) matches
  `supabase-config.js`'s own hardcoded `STAGING_CONFIG.url` exactly (the same discipline
  every prior real-cloud-staging task in this project has used) and confirming via
  `--dry-run`/direct grep that none of the 9 pending migrations contain a `DROP`/`TRUNCATE`/
  `DELETE`/`ALTER TABLE clients` that could touch the real, genuine existing signups already
  in the real `clients` table (robert greene, elliot john — both confirmed present, both
  `status: active`, queried directly via `service_role` before touching anything): ran
  `supabase db push` for real (all 9 migrations applied cleanly) and `supabase functions
  deploy` for real (all 35 missing functions deployed, 37 total now `ACTIVE`). **Verified,
  exactly as instructed, real cloud staging only, never the local stack**: re-ran the
  identical REST probe from the diagnosis against all 19 tables — every one now returns a
  real `200 []` (RLS-filtered, not missing); called the real `get-account-state` function as
  a real authenticated test user and confirmed a real, correctly-handled `404 "No account
  state found for client..."` (the documented, graceful empty-account case from UI Wiring
  Stage 1 — genuinely different from the `kind: 'network'`/"Could not reach the server"
  failure this fix closes, not a lingering symptom of it). **Real end-to-end proof on the
  actual live hosted site** (`https://de1stpromise.github.io/Marketswave/`, not localhost, per
  instruction that this is the only verification that actually matters here): drove the real
  9-step `signup.html` form via genuine DOM events + real CDP file-upload injection for the
  document steps against the live site; confirmed a real `pending_review` client row created
  via the real signup code path; approved it by calling the real, already-deployed
  `approve-client-application` function directly with a real admin JWT (the live site's own
  `admin-login.html` hadn't been redeployed yet at push time — a separate, already-diagnosed-
  unrelated fact, so approval was done against the real function directly rather than waiting
  on an unrelated deploy); logged in through the real live `login.html` and confirmed
  `dashboard.html`, `transactions.html`, `settings.html`, `asset-collection.html`, and
  `high-yield-savings.html` ALL render correctly — real name/initials ("Verify Fix
  Testuser"/"VT"), real computed $0/empty-state figures, zero "Could not reach the server"
  anywhere, zero real console errors (one benign, already-expected `get-account-state` 404
  confirmed via its own response body to be the documented graceful case, not a new
  problem). `asset-collection.html` correctly shows "No assets match your search/filter" —
  expected and disclosed, not a bug: the fresh migration created empty schema with no seed
  product data, a separate, known consequence of this fix, not part of the diagnosed issue.
  All real test artifacts (the throwaway client row, both throwaway Auth users) deleted
  afterward; the real pre-existing `clients` rows for robert greene and elliot john
  reconfirmed byte-identical, untouched throughout. **Safeguard against recurrence, built,
  not just proposed**: new `scripts/verify-cloud-staging-parity.js`
  (`npm run verify-cloud-staging-parity` from `scripts/`) — checks, directly against the real
  remote project every time it's run, whether every local migration file and every local
  Edge Function directory is actually applied/deployed there; exits 1 with a clear per-item
  list on any gap, exits 0 only when real cloud staging genuinely matches local. Confirmed
  working both ways: passes cleanly post-fix (10/10 migrations, 37/37 functions), and
  correctly fails when a synthetic gap is introduced (tested directly, not assumed). **New
  standing rule, added to this file's own Working Conventions section below**: run this
  script before any push that touches `supabase/migrations/`, `supabase/functions/`, or any
  Supabase-calling page — this is now the answer to "did I forget to deploy something to real
  cloud staging," replacing the informal per-stage scope notes that let this gap go unnoticed.
  See the Backend Requirements Register row 137 for the closed/open items — the diagnosis
  itself is not a separate register row, since diagnosis-only tasks aren't stubs to track;
  this row covers the real fix.
- **★ Backend Migration Phase C — Stage 1: real per-PM accounts, replacing the single shared
  admin login (2026-09-06).** Closes the "single shared PM identity" limitation flagged back
  at the original Admin Login Gate (Aug 21, 2026) and reaffirmed unresolved at Admin Auth
  Consolidation (2026-09-05) — the admin tool now supports genuinely distinct real PM
  identities, each producing genuinely distinguishable audit attribution. Verified locally
  first, per the new standing Cloud Staging Parity convention, then deployed to real cloud
  staging after local verification passed clean — the first task to exercise that convention
  end to end since it was created. **Investigated first, per instruction**: `user_roles`
  (`user_id primary key`, Supabase Migration Stage 1) was ALREADY schema-capable of multiple
  distinct admin identities from day one — a second row for a different real user
  immediately grants that person admin, zero migration needed for that alone; "single shared
  PM" was always an operational choice (only one row was ever inserted), never a schema
  limitation. `admin-login.html` was found to ALREADY accept any real email/password —
  confirmed via direct code read, not modified, since it already calls
  `signInWithPassword({email, password})` with whatever the form fields contain; the
  local-stack credential hint text is informational only, not a hardcoded target.
  **What genuinely was missing, confirmed by grep, not assumed**: attribution. The literal
  string `'Portfolio Manager'` as a generic actor existed in exactly ONE place in the entire
  project — `engine-core.js`'s local (100%-localStorage, no real Supabase backend, confirmed
  directly) `appendSecurityLogEntry()`. Every real Supabase Edge Function's own admin-write
  path recorded NO actor at all, not even a generic placeholder — the task's own framing
  ("replacing a generic label") turned out to undersell the real gap: this was mostly
  ADDING attribution that never existed, not replacing a wrong value. New migration
  (`20260906090000_add_pm_attribution.sql`) adds a `<verb>_by uuid references auth.users(id)`
  + `<verb>_by_email text` pair to every real admin-write table — `clients`
  (`application_resolved_by`), the 7 request-queue tables (`resolved_by`, shared by their own
  approve/reject pair), `documents` (`reviewed_by` for Mark Reviewed, `published_by` for a
  new firm-authored document — two distinct real actions, never conflated), `products`
  (`created_by`/`updated_by`), and `advisory_fee_rate` (`updated_by`) — all nullable, no
  default, so every pre-existing row correctly shows NULL/"unknown" rather than a fabricated
  placeholder, the same "don't manufacture history that never happened" precedent this
  project has followed since the `dateOfBirth` field removal. Deliberately denormalizes
  BOTH the real uuid AND the email captured directly from the calling admin's own
  already-verified JWT at write time (`claimsData.claims.sub`/`.email`, both already
  standard, already-used-elsewhere claims — confirmed by decoding a real issued JWT before
  relying on the shape) — mirrors `clients.name`/`clients.email`'s own established
  denormalization-over-join precedent, since PostgREST doesn't expose `auth.users` to any
  client-facing role anyway. **22 Edge Functions edited** (every approve-*/reject-*/credit-*
  function across every Approval Gate domain, plus `add-product`/`edit-product`/
  `update-advisory-fee-rate`/`update-document`/`publish-document`/`update-support-ticket`) —
  each gets exactly two new lines capturing `adminId`/`adminEmail` immediately after its
  EXISTING, UNTOUCHED admin-check block, then two new fields on its existing write call;
  the 403 authorization check itself was deliberately left byte-for-byte unmodified in every
  one, proven via a dedicated static-diff assertion (not just claimed) rather than relying
  on the live-call tests alone to notice a subtle authorization regression. `toClientShape()`
  (or equivalent) in each function extended to surface the new fields in the real API
  response too, so attribution is visible without a raw DB query. **The local Security
  Log**: `appendSecurityLogEntry()`'s hardcoded literal replaced with a new
  `performedByEmail` parameter threaded through `resetClientPassword()`/`resetClient2FA()`,
  falling back to an honest `'Unknown PM'` (never the old fictional-reading default) if a
  future caller forgets to pass it. New `MarketswaveData.getCurrentUserEmail()` in
  `supabase-data.js` (resolves whichever client `useAdminClient()` currently points at,
  returns `null` rather than throwing if no session exists) is the one small addition this
  needed — `admin-clients.html`'s Reset Password/Reset 2FA submit handler now fetches the
  real signed-in admin's own email this way before calling either function, since this
  domain has no JWT to read server-side. **Bootstrap tooling, new, additive, deliberately
  NOT a modification of the existing single-PM bootstrap scripts** (those two remain exactly
  what they were — "the first bootstrap account," referenced by name throughout this
  project's own history): `scripts/supabase-bootstrap-additional-pm.js` (local stack) and
  `scripts/supabase-staging-bootstrap-additional-pm.js` (real cloud staging, same
  service_role-key-from-file/never-hardcoded-password discipline as every other real-staging
  script) both take `<email> <password>` as arguments — "a script is fine, consistent with
  how the very first admin account was bootstrapped," per instruction, no dedicated UI was
  built. **A real mistake made and disclosed mid-task, not hidden**: an initial attempt to
  verify the new migration locally via `supabase db reset` was interrupted mid-command after
  realizing this project's own documented precedent (Phase B Stage 4) explicitly avoids that
  command to protect pre-existing local data — but the interruption landed AFTER the reset
  had already dropped the local database and BEFORE it re-applied migrations, leaving the
  local stack's `auth.users`/`public` schema genuinely empty; a `stop`/`start` cycle did not
  recover it (the backup that mechanism relies on already reflected the post-wipe state).
  Real cloud staging was independently confirmed completely unaffected throughout (a
  separate project, a separate credential, never touched by any local-stack command). Root-
  caused, disclosed to the user immediately, and — since the auto-mode classifier correctly
  blocked a second `db reset` as a destructive action — explicit user approval was obtained
  before rebuilding the local schema from scratch (structure only; by that point there was
  nothing left to lose). Local demo/test data (the bootstrap PM account, seeded portfolio
  products/demo client) was re-created via the existing bootstrap/seed scripts afterward.
  **Verified**: new `scripts/verify-supabase-pm-attribution.js`, 52 assertions, **52/52
  passing** — real distinguishable attribution proven with TWO GENUINELY DIFFERENT real PM
  accounts (`pm@marketswave.local`/`pm2@marketswave.local`) resolving SEPARATE real rows
  across Client Applications/Allocations/Deposits/Products/Advisory Fee Rate/Support
  Tickets, each correctly showing its own real id+email, never the other PM's and never the
  old generic string; a non-admin authenticated caller confirmed blocked (403) from every
  one of those same functions, with the blocked attempt confirmed to leave the real row
  genuinely untouched; the local Security Log's own two real distinguishable entries via the
  real `engine-core.js` source loaded through `scripts/lib/engine-harness.js`; and the
  static proof that all 22 functions' own admin-check blocks are byte-identical to before.
  Full existing Supabase suite re-run for zero regression: `verify-supabase-schema.js`
  16/16, `verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-
  withdrawals.js` 76/76, `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-
  hys.js` 112/112, `verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-
  documents-support.js` 67/67, `verify-documents-storage-integration.mjs` 46/46,
  `verify-hys-documents-ui-wiring.mjs` 69/69, `verify-admin-approval-gate-ui-wiring.mjs`
  102/102, `verify-admin-final-wiring.mjs` 39/39, `verify-products-catalog-fix.mjs` 35/35
  (759 total, unaffected), plus `supabase-golden-path-regression.js` `PASS (16/16 steps)`.
  **Deployed to real cloud staging after local verification passed clean**: the migration
  pushed for real (confirmed via dry-run first, confirmed no `DROP`/`TRUNCATE`/`DELETE`/
  `ALTER TABLE clients` in the migration, confirmed the real pre-existing `clients` rows for
  robert greene/elliot john were byte-identical before and after) and all 22 modified
  functions redeployed; `verify-cloud-staging-parity.js` confirmed clean afterward (11/11
  migrations, 37/37 functions). **Real end-to-end proof against real cloud staging itself**,
  not just the local stack: bootstrapped a genuine second real staging PM account
  (`pm2@marketswave-staging.internal`, alongside the existing `pm@marketswave-staging.
  internal`), then ran the same two-PM distinguishability proof directly against the real
  deployed functions — a real applicant approved by real PM #1 and a separate real applicant
  rejected by real PM #2, each row confirmed to carry that PM's own real id+email, genuinely
  distinguishable from the other. All real test artifacts (both throwaway applicants, the
  temporary verification script) deleted afterward; the real `clients` rows for robert
  greene and elliot john reconfirmed present and untouched. **A real, disclosed limitation
  found in the Cloud Staging Parity script itself while using it for the first time on a
  MODIFIED-not-just-NEW change**: it only checks that a function slug exists and is
  `ACTIVE` on the real remote, never diffing deployed code against local source — editing an
  already-deployed function and forgetting to redeploy it would still report clean. Disclosed
  in the script's own header and in this file's Working Conventions section rather than
  silently left as an implied guarantee the tool doesn't actually provide. **What remains in
  Phase C after this stage, reported per instruction**: (1) real Admin APIs behind password/
  2FA reset for a PM'S OWN account — this stage gave PMs distinct identities and
  attribution, but did not build any self-service credential-management flow for a PM to
  reset their own password/2FA (the existing Reset Password/2FA buttons on
  `admin-clients.html` act on a CLIENT's credentials, an entirely different, already-built
  feature, not a PM's own); (2) the "View as Client must not leak PM session" test — the
  real admin tool has no "View as this Client" mechanism for a Supabase-sourced client at
  all (confirmed absent, `verify-admin-final-wiring.mjs`'s own test), and the one that DOES
  exist (`admin-clients.html`'s local-client-only "View as this Client",
  `setCurrentClientId()`) was never re-examined THIS stage for whether a multi-PM admin
  session could leak into a client session or vice versa — both genuinely untested here, not
  silently assumed safe.
- **★ Backend Migration Phase C — Stage 2: "View as Client" session isolation — CLOSED,
  no leak found, proven with the same rigor as a real fix (2026-09-06).** Closes the risk
  flagged at the end of Stage 1. Investigated first, per instruction, before writing any
  test: read admin-clients.html's real "View as this Client" mechanism end to end. It calls
  exactly one function, setCurrentClientId(id) (engine-core.js:494-498), a plain
  sessionStorage.setItem('marketswave_current_client_id', id) — nothing more. This function
  never reads, writes, or references the real Supabase Auth session in any way; that session
  lives entirely inside the Supabase JS SDK's own GoTrueClient instance, under a completely
  different storage key (sb-marketswave-admin-auth-token for the admin — Admin Auth
  Consolidation's own explicit, distinct storageKey — or the SDK's own default
  sb-<hostname>-auth-token for a client-facing page), a wholly separate subsystem
  setCurrentClientId() has no reference to at all. The button is also structurally gated off
  for exactly the scenario the task describes: confirmed via the render logic (isSupabase =
  c._source === 'supabase') that "View as this Client" never renders at all for a real
  Supabase-authenticated client — only for a local/legacy one — already partially confirmed
  by verify-admin-final-wiring.mjs's own test 4c, but that only proved the UI gate, not the
  underlying primitive. This stage tests one level deeper: calling setCurrentClientId()
  DIRECTLY against a real Supabase client's real uid, bypassing the UI gate entirely, to
  prove the raw mechanism itself cannot leak — not merely that the button happens to be
  hidden today.

  New scripts/verify-view-as-client-isolation.mjs, using ONE real jsdom window (real Storage
  implementations, not stubs) as the shared browser tab both a REAL admin Supabase session
  (admin-supabase-config.js, unmodified) and REAL engine-core.js execute against — the same
  faithful "one page, one shared storage, two subsystems" reproduction of the real production
  page. PART A: signed in as a real admin, called setCurrentClientId(a real Supabase client's
  real uid) directly, then proved: the admin's real session token in localStorage is
  byte-identical before/after; the admin Supabase client's own live session (getSession())
  still resolves to the real admin's own id, never the viewed client's; a real
  admin-authorized Edge Function call made immediately afterward
  (approve-client-application) still succeeds AS THE REAL ADMIN, with the resulting real
  attribution (Phase C Stage 1's own new columns) correctly showing the real admin's
  id+email, never the viewed client's — the concrete, observable consequence that would
  exist if any contamination had occurred; the window's entire real localStorage is
  completely unchanged (only sessionStorage's plain ambient key ever moves); the real UI gate
  re-confirmed absent for this exact client via the real admin-clients.html page itself.
  PART B: a second, genuinely independent real client session — its own separate new JSDOM()
  window with its own separate real localStorage object, sharing nothing with Part A's window
  — signed in as the real client being "viewed" in Part A, and proved: their own session
  (re-fetched AFTER every Part A action) is still genuinely valid and still their own; their
  own access token is byte-identical before/after everything Part A did; their own
  localStorage is completely unchanged; nothing resembling the admin's own local ambient
  variable ever appears in it, confirming no leak in the reverse direction either.

  A real environment finding made and fixed while building this test, not a production bug:
  the test's own localStorage-persistence checks initially found the admin session token
  genuinely never landed in the jsdom window's real localStorage at all — traced directly to
  a missing bare document global (confirmed against the installed SDK source,
  @supabase/auth-js's supportsLocalStorage() calls isBrowser():
  typeof window !== 'undefined' && typeof document !== 'undefined' — the same finding
  verify-admin-real-login.mjs's own header already documented once before, re-discovered
  here because this test's global setup only set window/localStorage, not bare document);
  without it the SDK silently falls back to an in-memory adapter regardless of
  persistSession's own value, which would have made the whole test pass for the wrong reason
  (proving nothing about real persisted-session isolation). Fixed by setting
  globalThis.document = adminDom.window.document alongside window/localStorage. A second,
  cosmetic-only SDK warning ("Multiple GoTrueClient instances detected in the same browser
  context") was investigated and confirmed harmless — a diagnostic artifact of running two
  independent createClient() instances in one Node process (this test harness's own
  reality), never evidence of actual cross-contamination, since every identity/token
  comparison still passed and two real, separate browser tabs would never share a JS process
  at all.

  Verified: 18/18 assertions passing. Full existing Supabase suite re-run for zero regression
  (no application code was changed this stage — no leak was found to fix):
  verify-supabase-schema.js 16/16, verify-supabase-portfolio-engine.js 40/40,
  verify-supabase-deposits-withdrawals.js 76/76, verify-supabase-allocations-sells.js 88/88,
  verify-supabase-hys.js 112/112, verify-supabase-final-approval-gate.js 69/69,
  verify-supabase-documents-support.js 67/67, verify-admin-final-wiring.mjs 39/39,
  verify-supabase-pm-attribution.js 52/52 (559 total, unaffected), plus
  supabase-golden-path-regression.js PASS (16/16 steps). Real cloud staging untouched —
  nothing to deploy, since no migration or Edge Function changed this stage;
  verify-cloud-staging-parity.js re-confirmed clean regardless (11/11, 37/37).

  The conclusive mechanism-level answer, not just an absence of symptoms: "View as this
  Client" structurally cannot affect any real Supabase session in either direction, for two
  independent, both-confirmed reasons — (a) it is gated off entirely for the one identity
  type (a real Supabase client) the risk could ever apply to, and (b) even the underlying
  primitive it uses for the case it IS gated on for (a local client) touches a single
  sessionStorage key that no part of the Supabase JS SDK, on either the admin's or any
  client's side, ever reads or writes. This closes the risk that had been sitting flagged,
  untested, since the original migration plan was written — the real Admin APIs behind
  password/2FA reset for a PM's own account (Stage 1's other remaining item) is still the
  one open item in Phase C.
- **★ Backend Migration Phase C — Stage 3 (final stage of Phase C): PM self-service
  password change — PHASE C COMPLETE, 2FA logged as its own deferred item, not a leftover
  Phase C task (2026-09-06).** Investigated first, per instruction: read admin-security.html
  and every other admin page directly, confirmed no self-service PM credential path existed
  anywhere — the existing Reset Password/Reset 2FA buttons (admin-clients.html) act on a
  CLIENT's credentials, a real, already-shipped, but entirely different feature; a
  project-wide grep for updateUser()/"My Account"/"Change Password" in any admin*.html file
  found nothing else. The gap was real, not assumed.

  Password change: a new "My Account" section on admin-security.html mirrors
  settings.html's own real client-facing flow exactly (same strength-meter thresholds, same
  genuine re-authentication discipline) — Supabase's updateUser() trusts the
  already-authenticated session outright and has no "current password" parameter of its
  own, so this re-verifies the real current password first via a real
  signInWithPassword() call against the session's own real email, then calls updateUser().
  Uses MarketswaveData.getSupabaseClient() — once useAdminClient() (already called at page
  load) has redirected the shared client promise to the real admin-authenticated session,
  this resolves to THAT session, so the flow works for whichever real PM is currently
  signed in, not a hardcoded account — confirmed with two genuinely different real PM
  accounts, not just the original shared one.

  2FA: investigated and reported plainly, not built as a stub. supabase/config.toml's own
  comment states outright: "Multi-factor-authentication is available to Supabase Pro
  plan" — confirmed live against the real local Auth server too, a real
  auth.mfa.enroll({factorType:'totp'}) call returns a real 422
  mfa_totp_enroll_not_enabled, not a client-side limitation. This project has deliberately
  stayed on Supabase's free tier throughout its entire migration — the same category of
  real, external constraint that already blocked Firebase's own Cloud Functions on the
  Blaze plan and was the whole reason this project moved to Supabase in the first place.
  Building real PM 2FA now would mean reintroducing exactly that kind of paid-plan
  dependency. No toggle, no QR code, no fake "enabled" state was built — admin-security.html
  shows only an honest note explaining the real constraint, confirmed via the test script
  itself asserting no interactive 2FA control exists in the real markup at all.

  Attribution: a genuinely new local log-entry type, PM_PASSWORD_CHANGE, via a new
  appendSelfSecurityLogEntry(type, reason, performedByEmail) in engine-core.js —
  deliberately a SEPARATE function from the existing appendSecurityLogEntry(), since a
  self-action has no clientId at all (the actor and the subject are the same person);
  overloading the existing function with a nullable clientId would have rendered a bare
  `null` in admin-security.html's own Client column, the same kind of confusing half-real
  display this project avoids elsewhere. Reuses the SAME SECURITY_LOG_KEY store so the
  existing log table picks it up with zero extra plumbing — rendering was extended to show
  "(Own Account)" for these entries instead.

  **Verified**: new scripts/verify-pm-self-service-security.mjs, 18/18 assertions — two
  genuinely different real PM accounts, each: a wrong current password genuinely rejected
  (and confirmed to leave the real password unchanged — a real sign-in with the OLD
  password still succeeds afterward); a real successful change; THE REAL PROOF per
  instruction, not just a success message — signing in with the NEW real password in a
  genuinely fresh client instance succeeds, and the OLD password no longer works; a real
  PM_PASSWORD_CHANGE log entry with this exact PM's own real email as performedBy, correctly
  carrying no clientId/clientName; and the two PMs' own entries confirmed genuinely
  distinguishable from each other. **Two real bugs found and fixed while building this test
  itself, not the app**: (1) signing in via a query-param-suffixed copy of
  admin-supabase-config.js left the REAL singleton useAdminClient() itself resolves to still
  unauthenticated — fixed by signing in via the exact same bare specifier that function
  internally imports; (2) a fresh JSDOM window per PM call meant fresh, empty localStorage,
  so PM #1's own log write was invisible from PM #2's separate window — fixed by reusing ONE
  shared jsdom window across both PM turns (resetting only the page body between them,
  mirroring a real page reload) so the real, genuinely global SECURITY_LOG_KEY correctly
  carries forward exactly as a real browser tab's localStorage would. Full existing Supabase
  suite re-run for zero regression: verify-supabase-schema.js 16/16,
  verify-supabase-portfolio-engine.js 40/40, verify-supabase-deposits-withdrawals.js 76/76,
  verify-supabase-allocations-sells.js 88/88, verify-supabase-hys.js 112/112,
  verify-supabase-final-approval-gate.js 69/69, verify-supabase-documents-support.js 67/67,
  verify-admin-final-wiring.mjs 39/39, verify-supabase-pm-attribution.js 52/52,
  verify-view-as-client-isolation.mjs 18/18 (577 total, unaffected), plus
  supabase-golden-path-regression.js PASS (16/16 steps). Real cloud staging: no migration or
  Edge Function changed this stage (updateUser()/signInWithPassword() are pure Supabase Auth
  SDK calls, identical against local stack or real cloud staging with no deployment needed);
  verify-cloud-staging-parity.js re-confirmed clean regardless (11/11, 37/37). Deliberately
  NOT tested against the real staging PM accounts specifically — doing so would mean
  changing pm@marketswave-staging.internal's/pm2@marketswave-staging.internal's own real,
  currently-relied-upon passwords, which this task did not ask for and this stage did not
  need in order to prove the underlying mechanism correct (already proven locally with the
  same rigor, against the same GoTrue software real cloud staging also runs).

  **PHASE C IS NOW COMPLETE.** All three of its stages closed: Stage 1 (real per-PM
  accounts + attribution), Stage 2 ("View as Client" proven safe), Stage 3 (PM self-service
  password change). The one deferred item — real 2FA for PM accounts — is NOT an
  incomplete Phase C task; it is a genuinely separate, explicitly out-of-scope item blocked
  on a real Supabase Pro plan upgrade, logged in the Backend Requirements Register as its
  own row rather than left implied-covered by Phase C's own closure.
- **★ Backend Migration Phase D — Stage 1: real market data + first real email
  notifications (2026-09-06).** The first Phase D task — starts closing the last two
  "Genuinely external" register items (rows 22-23, Market Snapshot/Currency Converter) and
  builds this project's first-ever outbound email. Local stack first, then deployed to real
  cloud staging after local verification passed clean, per the standing Cloud Staging Parity
  convention.
  **Part A — real market data.** New `market_data_cache` table (`symbol` primary key,
  `value`/`change_percent`/`source`/`last_updated`, admin+authenticated-read RLS). New
  `get-market-snapshot` Edge Function fetches SPY/QQQ from Finnhub and BTC/ETH from
  CoinGecko, caching results for 15 minutes so a client refreshing their dashboard doesn't
  hammer either real external API. **A real, disclosed finding, not silently worked
  around**: Finnhub's free tier does NOT support direct S&P 500/NASDAQ index quotes
  (`^GSPC`/`^IXIC` return `"Market data subscription required for CFD indices."`, confirmed
  directly) — used the standard real-world proxy instead, SPY/QQQ ETFs, labeled honestly as
  "SPY (S&P 500 ETF)"/"QQQ (NASDAQ-100 ETF)" rather than fabricating an index-equivalent
  number via an approximate multiplier, the same "never look more real than it is"
  discipline Phase C — Stage 3's own 2FA finding already established. New
  `convert-currency` Edge Function uses Frankfurter (ECB-backed, no key needed), queried
  live on every real conversion request — deliberately NOT cached the way the snapshot is,
  since a converter's whole point is "convert THIS amount right now," not a periodic poll.
  Both wired into `dashboard.html`'s Market Snapshot and Currency Converter cards, replacing
  the static hardcoded figures (5,248 / 16,742 / $67,420 / $3,418) that had been there since
  the engine was first built.
  **Part B — first real email notifications.** New `email_log` audit table (`recipient`/
  `subject`/`sent_at`/`related_entity_type`/`related_entity_id`/`status`/`resend_id`/
  `error_message`, admin-only read RLS, no client-side INSERT for any role). New shared
  `_shared/send-email.ts` (mirrors `hys-engine.ts`'s own "one shared module, every caller
  imports from here" discipline) wraps the Resend API and logs every attempt. **A
  deliberate design decision, stated in the module's own header**: a failed send (Resend
  rejects, network error, missing key) is caught and logged `status: 'failed'` — it never
  throws back to the caller, since the two real trigger points wired this stage are money/
  identity-moving actions whose own success must never depend on whether the follow-up
  email happened to send. Wired into exactly 3 real trigger points as a proof of pattern,
  each a minimal, additive diff to the function's existing logic/return shape:
  `approve-client-application` ("Your Marketswave application has been approved"),
  `reject-client-application` ("An update on your Marketswave application," includes the
  reason if given), and `credit-deposit` ("Your Marketswave deposit has been credited," the
  PM-confirmed amount).
  **Real third-party keys, handled per this project's established secret discipline**: both
  `FINNHUB_API_KEY`/`RESEND_API_KEY` were already set on real cloud staging (via
  `supabase secrets set`) but had no local-stack equivalent — added to a new, gitignored
  `supabase/functions/.env` (the standard Supabase-documented location the local edge-
  runtime reads automatically), never committed, never printed after initial setup. **A
  real, disclosed mistake made and self-corrected during setup**: a throwaway
  `test-env-check` function was accidentally deployed to REAL cloud staging while confirming
  the keys were readable (there is no local-only `functions deploy`) — caught immediately via
  `supabase functions list` and deleted from both environments before any further work. **A
  second real finding**: the Finnhub key already set on real cloud staging turned out to be
  stale/invalid (a live call returned a real `401`) — re-set with the confirmed-working value
  before the real cloud-staging proof could succeed.
  **Resend's real sandbox restriction, confirmed empirically, not assumed**: without a
  verified sending domain, `onboarding@resend.dev` can only deliver to Resend's own fixed
  test address or the EXACT email address registered to the account — a `+alias` variant of
  that address is genuinely rejected (`"You can only send testing emails to your own email
  address"`), confirmed via a real attempt that landed correctly in `email_log` as a real,
  honest `failed` row before the exact registered address was used instead.
  **Verified, local stack**: 3 new scripts, 47 new assertions —
  `verify-supabase-market-data.js` (22, including **the critical "not cached forever"
  proof**: manually backdating a cache row's `last_updated` to 20 minutes ago forces a
  genuine re-fetch, and an independent direct Frankfurter call cross-checks the Edge
  Function's own conversion result), `verify-supabase-email-notifications.js` (14, using a
  deliberately unreachable `@invalid.test` domain to prove the real failure-logging path
  without spamming a real inbox on every regression run), and
  `verify-dashboard-market-currency-ui.mjs` (11, the established jsdom real-DOM harness,
  including two real bugs caught and fixed in the test itself — polling for the async
  skeleton's own intermediate state instead of final content, and an innerHTML-vs-textContent
  HTML-entity-encoding mismatch). Full existing suite re-run for zero regression (595 prior
  assertions unaffected, plus the golden-path script).
  **Real end-to-end proof, both locally and against real cloud staging itself**: three real
  emails sent to a real inbox the user controls during local verification (approval,
  rejection, deposit credit — each with a real Resend message id, `status: "sent"` in
  `email_log`); then, after deploying the migration and all 5 new/modified functions to real
  cloud staging (dry-run first, `verify-cloud-staging-parity.js` confirmed clean before and
  after) and fixing the stale Finnhub key found there, a complete real signup → approve
  round trip run directly against real cloud staging (not a script simulating it) produced a
  real, delivered email with a real Resend message id, confirmed via a direct `email_log`
  read — proving the pattern survives the move from local to real infrastructure, not just
  passing in isolation. All real test artifacts (the temporary staging test client, its auth
  user, and one orphaned auth user from a mid-test correction) were fully cleaned up
  afterward, confirmed via a direct re-query.
  **Report requested per instruction — which of the remaining ~20 admin-write functions
  could similarly trigger email in a future stage**: high-value client-facing outcome
  events not yet wired — `reject-deposit`, `approve-withdrawal`/`reject-withdrawal`,
  `approve-allocation`/`reject-allocation`, `approve-sell`/`reject-sell`,
  `credit-hys-deposit`/`reject-hys-deposit`, `approve-hys-withdrawal`/
  `reject-hys-withdrawal`, `approve-profile-change`/`reject-profile-change` (13 functions,
  each a single-recipient, single-outcome event exactly like the 3 already wired); lower-
  urgency but still plausible — `update-support-ticket` (a PM responded), `publish-document`
  (a new document needs review/signature); NOT good candidates for this same single-
  recipient pattern — `add-product`/`edit-product`/`update-advisory-fee-rate` (platform-wide,
  no single client recipient; a rate change would need a bulk/broadcast send, a different
  shape entirely) and `execute-buy`/`execute-sell` (internal-only, called BY
  `approve-allocation`/`approve-sell` — wiring email there directly would duplicate whatever
  the caller already sends).
  CLAUDE.md updated in place.
- **★ Real PM-Published NAV for Private Equity / Real Assets (2026-09-06) — closes the full
  original Phase D market-data/NAV line item.** Investigated first: read `_shared/
  portfolio-engine.ts`'s `settleProduct()`/`settleAllProducts()`/`settleOneProduct()` in
  full — confirmed exactly one existing early return (`'Unallocated / Cash'` never ticks) and
  every real caller (`get-account-state`, `get-holdings`, `computeTotalPortfolioValue()`
  shared by `get-total-portfolio-value`/`get-portfolio-monthly-change`, and
  `settleOneProduct()` via `execute-buy`/`execute-sell`) calls through `settleProduct()`
  itself — a second, symmetric early return is inherited by every caller for free, zero call
  sites needed to change. Also confirmed via project-wide grep that `engine-core.js`'s own
  local `settleProduct()` has ZERO remaining callers on any live HTML page — every page now
  reads pricing via the real Supabase functions — so the carve-out was built ONLY in the real
  backend, correctly leaving the local copy untouched.
  **Schema**: new `nav_publications` table (`product_id`, `published_unit_price`,
  `published_by`/`published_by_email` per Phase C's real attribution pattern, `published_at`,
  `effective_date`, optional `note`) — admin-only read RLS, no client-side write for any role,
  mirroring `hys_pockets`' own "service_role only" precedent.
  **Transition, recommended and implemented per the user's own stated instinct, confirmed
  correct and reported**: existing PE/Real Assets products are FROZEN at their current
  simulated price as a system-recorded initial publication (`published_by` NULL, a real
  disclosed system event, not a fabricated PM action) rather than reset to inception price —
  a client's real unrealized-return figure is computed against the CURRENT price, so
  resetting to inception the moment this shipped would have produced a real, unexplained jump
  with zero real-world event to justify it; freezing changes nothing visible at the moment
  this ships.
  **Carve-out**: `settleProduct()` gets one new early return, byte-for-byte the same shape as
  the existing Cash one, for `asset_class in ('Private Equity','Real Assets')`.
  `products.last_tick_date` is deliberately REUSED (not a new parallel column) to mean "date
  of last real valuation" for these two classes — `publish-nav` updates it to the real
  `effective_date` on every publish, powering both `admin-products.html`'s relabeled
  "Last Valued (NAV)" field and the new client-facing indicator with no extra join needed.
  **Edge Function**: new admin-only `publish-nav` — validates the product is genuinely
  PE/Real Assets server-side (never trusting the UI's own scoping), validates a positive
  price and a well-formed `effectiveDate`, records real PM attribution, updates the product
  atomically. **Admin UI**: `admin-products.html` gets a lazy-loaded NAV History table
  (mirroring `admin-clients.html`'s own lazy per-client pending-count fetch) and a "Publish
  New NAV" action, both rendered only for eligible products. **Client-facing, investigated
  and recommended per instruction**: yes — a small, honest "Last valued: [date]" line was
  added under the asset class on `asset-performance.html`'s Return Table for PE/Real Assets
  holdings only, reusing data the page already fetches, no new backend read needed.
  **A real regression found and fixed BEFORE it could ship**: `verify-supabase-portfolio-
  engine.js`'s own determinism cross-check used `PROD-0001` (Nordic Growth Fund, Private
  Equity) as its target — forcing it backward in time and expecting it to tick forward, a
  scenario the carve-out makes permanently false. Swapped to `PROD-0003` (Global Equity ETF,
  genuinely unaffected) — the determinism PROPERTY under test is unchanged for any product
  the tick still applies to, a like-for-like swap, not a weakened test; also fixed the test's
  own hardcoded "restore to 118.40" cleanup to capture-and-restore the real pre-test price
  instead, since that hardcoded value only ever worked by coincidence for the old target.
  **Verified**: new `scripts/verify-supabase-nav-publications.js`, 42/42 assertions on the
  first run — the carve-out proven directly; the regression proven in the same run
  (Stocks & ETFs/Crypto still tick normally); full `publish-nav` validation including
  explicit rejection of ineligible asset classes with the real server error message; a real
  successful publish with two genuinely different real PM accounts producing distinguishable
  attribution (mirroring Phase C — Stage 1's own rigor); a real published price proven to NOT
  drift on a subsequent settlement call; cross-client correctness (one real publication
  against a shared product identically updates Total Portfolio Value for two different real
  clients holding it); authorization (401/403, plus RLS confirming no client-side role can
  read or write `nav_publications`); and the migration backfill (every real pre-existing
  PE/Real Assets product carries a real system-recorded initial NAV row). Full existing
  Supabase suite re-run for zero regression (932 prior assertions unaffected, plus the
  golden-path script). **Deployed to real cloud staging, with a real deployment-mechanics
  finding acted on, not just disclosed**: confirmed via grep that 12 OTHER already-deployed
  functions import the now-changed `_shared/portfolio-engine.ts` — since Deno bundles
  imports at deploy time, deploying only `publish-nav` would have left all 12 with a STALE,
  pre-carve-out bundled copy on real cloud staging even though local behavior was already
  correct; all 12 were redeployed alongside `publish-nav` and the new migration.
  `verify-cloud-staging-parity.js` confirmed clean afterward (13/13, 40/40) — though, per
  that script's own documented limitation, presence/ACTIVE status alone would NOT have caught
  the stale-bundle risk; this was caught by reading the real dependency graph directly.
  **Real end-to-end proof run directly against real cloud staging** (zero seeded products
  there, confirmed, so a real temporary test product was inserted, exercised, and fully
  cleaned up afterward): a real settlement call left a real PE test product's price and
  `last_tick_date` completely unchanged; a real `publish-nav` call from the real staging PM
  account produced a real updated price, a real `nav_publications` row with real attribution,
  and `last_tick_date` correctly advanced to the real `effective_date`. CLAUDE.md updated in
  place. Backend Requirements Register row 143.
- **★ Backend Migration Phase D — Stage 2: all 15 remaining real email triggers wired —
  closes the full Phase D email line item (2026-09-06).** Wires the 13 high-value candidates
  Stage 1's own report named (`reject-deposit`, `approve/reject-withdrawal`, `approve/reject-
  allocation`, `approve/reject-sell`, `credit/reject-hys-deposit`, `approve/reject-hys-
  withdrawal`, `approve/reject-profile-change`) plus the 2 lower-urgency ones from that same
  list (`update-support-ticket`, `publish-document`), using the exact non-blocking
  `_shared/send-email.ts` pattern Stage 1 proved. **Each domain gets genuinely distinct, real
  content, not one template reused everywhere**: rejections quote the real requested amount
  and reason; approvals quote the real approved/executed amount and (for allocation/sell) the
  real product name via a small parallel `products` lookup; HYS deposit emails describe the
  real pocket type and term label; HYS withdrawal approvals mention a forfeiture note only
  when `forfeit` is genuinely true; profile-change emails reuse the exact same human-readable
  field labels `admin-profile-updates.html` already uses, so client and PM wording never
  disagree; `update-support-ticket` composes a genuinely different subject for a `Resolved`
  move versus any other status change; `publish-document` composes different content for a
  signature-required document versus a plain one. **Verified**: new `scripts/verify-
  supabase-email-triggers-stage2.js`, 85/85 assertions (one real bug caught in the test's own
  `support_requests` category value — `'General'` isn't valid per that table's own CHECK
  constraint, fixed to `'Other'`) — covers all 15 trigger points against a deliberately
  unreachable domain, mirroring Stage 1's own regression-safe technique. **The explicitly-
  required human-confirmed real-inbox proof, a representative sample across every domain, not
  a re-test of Stage 1's same 3**: 9 real emails sent to a real inbox the user controls, one
  per domain, mixing approve/reject content — a genuine mid-run test-setup bug (a missing
  `account_state` row in the throwaway sample script, confirmed NOT present in the real
  85-assertion regression script) was caught, fixed, and that one email resent successfully.
  Full existing Supabase suite re-run for zero regression (1014 prior assertions unaffected)
  — this run also caught and fixed a real test-SCOPE bug in `verify-supabase-nav-
  publications.js`'s own migration-backfill check (row 143): it asserted every CURRENT
  PE/Real Assets product has NAV history, which broke against real leftover test products a
  different, unrelated script leaves behind — narrowed to check only the two originally-
  seeded products the one-time backfill actually covered. **Deployed to real cloud staging**:
  all 15 modified functions redeployed, parity confirmed clean afterward, and a real
  end-to-end proof (`reject-deposit`) produced a real delivered email with a real Resend
  message id directly against real cloud staging. CLAUDE.md updated in place. **This closes
  the full Phase D email line item — every real trigger point across every domain in this
  project is now wired**; `add-product`/`edit-product`/`update-advisory-fee-rate` and
  `execute-buy`/`execute-sell` stay excluded, reaffirmed from Stage 1's own original report.
  Backend Requirements Register row 144.
- **★ Real end-to-end verification against the LIVE hosted site (2026-09-06) — the first
  time this whole accumulated batch (Admin Auth Consolidation through Phase D Stage 2) was
  tested against real production hosting conditions.** Verification-only, no code changes.
  **No real browser automation tool was available in this session — confirmed before
  starting, disclosed rather than silently substituted.** Instead, the exact real requests
  the live site's own deployed JS makes were replayed in order, using config values SCRAPED
  LIVE from the real deployed `supabase-config.js` (not the local repo) and call sequences
  read directly from the real deployed `signup.html`/`login.html`/`dashboard.html`/
  `deploy-capital.html`/`admin-login.html`/`admin-deposits.html` — proving the real
  deployment → real backend → real CORS → real data chain end to end, but NOT independently
  proving the rendered HTML/CSS/click-handlers are bug-free in an actual browser, a
  limitation stated plainly. **Pre-flight**: confirmed via direct `curl` that GitHub Pages
  had actually redeployed the latest push (the real live `admin-login.html` serves the new
  email/password form; the real live `dashboard.html` serves the new
  `market-snapshot-grid`; the real live `supabase-config.js` defaults to real Supabase
  staging on a non-localhost domain with zero query params); confirmed `_shared/cors.ts`'s
  `Access-Control-Allow-Origin: '*'` rules out a real CORS-rejection risk against the actual
  `github.io` origin. **All 6 requested steps run for real, in sequence, against real cloud
  staging, using a real client identity at the user's own real inbox**: real signup → real
  Supabase confirmation via direct query → real PM approval → a real approval email logged
  `sent` → real client login loading real dashboard data (a genuine graceful 404 for a new
  client's account state, $0 TPV, real live Market Snapshot figures — BTC $79,984, not the
  old hardcoded $67,420 — and a real live currency conversion) → a real $4,200 deposit
  request, credited, producing a real transaction id and a second real email. **Human-
  confirmed, not just a script's success response**: both real emails (approval + deposit
  credit) confirmed received in the user's own real inbox. All real test artifacts deleted
  afterward. Zero failures across all 6 steps. Backend Requirements Register row 145.
- **★ Client Dashboard Polish — 5-item batch (2026-09-06).** **1. Market Snapshot
  expansion**: `get-market-snapshot` extended from 4 to 6 real symbols — DIA (Dow Jones ETF
  proxy, Finnhub) and SOL (CoinGecko) added, both confirmed working on the free tier via
  direct API calls before adding; GLD (Gold) also confirmed working but deliberately left
  out — 7 items doesn't grid cleanly, 6 does as a clean 2×3. `dashboard.html`'s grid
  rebalanced `grid-cols-2 sm:grid-cols-4` → `grid-cols-2 sm:grid-cols-3`; browser-confirmed
  the Market Snapshot and Currency Converter cards stay aligned at the same top Y, no
  misalignment. **2. Unified loading mechanism**: investigated and found ~25 genuinely
  different one-off `skeletonHTML` implementations across all 10 client-facing pages, several
  literal placeholder text or bare spinners rather than real layout-matching shapes. Replaced
  every one with a new shared `skeleton` object in `supabase-data.js`
  (`.text()`/`.block()`/`.lines()`/`.card()`/`.tableRow()`/`.tableRows()`) producing real
  gray placeholder blocks sized to each real element (real skeleton table rows, a composed
  4-line pocket-card skeleton, etc.) — never literal text — now the one shared vocabulary
  every page calls. **3. The "John Doe" flash bug — investigated, found to be a much larger
  real bug class, not a regression**: "John Doe" itself no longer appears anywhere in
  rendered markup (the earlier identity-display fix held) — the real bug was
  `dashboard.html`'s/`settings.html`'s STATIC HTML still containing real-looking hardcoded
  fake values (profile name/avatar, the entire pre-migration TPV/monthly-change/asset-
  returns/best-performing-class figures, email/phone) that a real page load could flash
  before the async Supabase fetch overwrote them. Also found and fixed the identical pattern
  in `documents.html`'s 3 header chip counts (still baked into static HTML as the literal
  fake `"2"`/`"1"`/`"1"` from before the engine migration — Backend Requirements Register row
  78 had only ever fixed the JS-side computation, never the static markup it was
  overwriting) and `asset-performance.html`'s 5 summary figures. All replaced with real
  skeletons from item 2's shared vocabulary — a flash of fake content is now structurally
  impossible, confirmed explicitly rather than patched at only the one reported instance.
  **4. "null has been approved" string bugs — audited, one real gap found and fixed**: all
  15 email templates and every admin toast/resolution string and the notification bell
  confirmed clean. The one real gap: `admin-security.html`'s log rendering interpolated
  `e.reason` with no fallback — fixed to `(e.reason || '—')`, confirmed correct with both a
  real present reason (renders verbatim) and a genuinely missing one (`null` and an absent
  key both render `—`, never `"null"`). **5. Bar chart rounded corners**: `transactions.html`'s
  Buys/Sells datasets both gained `borderRadius: 6`, confirmed on the real live Chart.js
  instance. **Verified**: browser-verified live via headless Chrome over CDP (no browser
  tool available this session) against a real seeded test client — 27/27 assertions,
  including a genuine throttled-network mid-load screenshot proving the skeleton state (never
  fake content) during a real slow load. Full existing Supabase suite re-run for zero
  regression, including 2 pre-existing test files corrected to match the fixed (not broken)
  behavior rather than left failing: `verify-supabase-market-data.js` (4→6 symbols, 22→24
  assertions) and `verify-hys-documents-ui-wiring.mjs` (2 assertions had been unknowingly
  re-asserting the old fake-chip-count bug as a baseline, 67→69). Deployed
  `get-market-snapshot` to real cloud staging; `verify-cloud-staging-parity.js` confirmed
  clean before and after. Backend Requirements Register row 146.
- **★ Client Dashboard Visual Treatment — the restrained public-site glass language applied
  to real financial summary cards (2026-09-06).** Reuses the exact shared CSS primitives
  already built for the public site (Homepage Visual Redesign, Stages 1-2) — `.glass`/
  `.glass-subtle`/`.gradient-text`/`.blob`(+modifiers)/`.grid-overlay`/`.blob-field` —
  extracted verbatim out of `styles.css` into a new `glass-primitives.css` (plus a small,
  disclosed 4-token `:root` block, since dashboard pages define navy/cream as Tailwind
  config JS, not CSS custom properties); `styles.css` now `@import`s it instead of defining
  the rules itself. **Investigated all 10 client-facing pages, not just the task's named
  list**: 4 had a qualifying top-level summary surface (`dashboard.html`'s TPV hero/Asset
  Returns/Best Performing Class/Risk Metrics/Market Snapshot, `asset-performance.html`'s 3
  summary cards, `high-yield-savings.html`'s 3 aggregate Summary Cards — explicitly not the
  individual pocket cards, a data listing, `transactions.html`'s 4 summary cards) — exactly
  the task's own list, confirmed rather than assumed. **6 pages reported as having no
  qualifying card**: `asset-collection.html` (search/browse container), `documents.html`
  (chips are inline badges, not cards), `deploy-capital.html` (action-selector buttons and
  actual forms), `risk-management.html` (the Risk Meter card is dominated by an interactive
  control carrying its own explicitly LOCKED gold/mahogany/deep-green palette — glass
  deliberately not applied there to avoid disturbing it), `settings.html` (identity/edit
  forms), `support.html` (action tiles). **Intensity scheme**: TPV hero alone gets full
  `.glass` (true standalone hero); every other targeted card sits in a dense 3-4-across row
  and gets `.glass-subtle`, reusing the exact calmer-sibling precedent Stage 2 already
  established; `dashboard.html`'s standalone Risk Metrics/Market Snapshot cards get full
  `.glass`. **A real reversal, reported not hidden**: `.gradient-text` was tried on the TPV
  dollar figure, then reverted after measuring its gold stop at ~2.8:1 contrast against the
  light glass card — below WCAG's 4.5:1 — a real legibility risk on the page's single most
  important number; solid navy is used instead, hero distinctiveness now carried by size/
  position only. The dark navy TPV card became a light `.glass` card (not a forked "dark
  glass" variant) — every white/white-on-navy text color and skeleton option on it updated
  to navy/slate. **Blobs tuned down after a real over-strong first pass**: `blob--md` on
  dashboard.html washed a visible tint across much of the page (caught via screenshot);
  reduced to `blob--sm` uniformly across all 4 pages. A scrollable `<main
  class="overflow-y-auto">` can't use `.blob-field` (its symmetric `overflow:hidden` would
  kill vertical scroll) — each page instead adds `relative overflow-x-hidden` directly to
  `<main>`, achieving the same containment asymmetrically without forking the primitive.
  **Verified**: a real seeded test client, browser-verified live via headless Chrome over
  CDP (no browser tool available this session) — 30/30 assertions on the second pass (after
  fixing the blob-intensity and gradient-text issues found on the first), covering every
  named card's class, `.glass`'s real computed `backdrop-filter`, every table/form/filter
  confirmed NOT glass, real dollar figures rendering in solid navy (not white/transparent),
  zero horizontal overflow at normal and a real CDP-emulated 390px viewport, and — the
  specific interaction the task flagged as worth checking — a real throttled-network
  mid-load screenshot confirming the unified skeleton states render correctly as real gray
  blocks inside the new glass cards. Full existing Supabase suite re-run for zero regression
  (pure CSS/HTML, zero schema/function changes) — one transient `verify-admin-final-
  wiring.mjs` failure reproduced its own already-documented flaky-retry pattern, confirmed
  clean on an immediate re-run. No cloud staging deployment needed. Backend Requirements
  Register row 147.
- **★ Client Dashboard Visual Treatment — Stage 2 (amplified) (2026-09-06).** Reuses
  `glass-primitives.css` exactly. **1. Sidebar** (`dashboard-sidebar.js`, all 10 client
  pages): added a THIRD formal variant, `.glass-dark` — the same precedent `.glass-subtle`
  itself set, not a fork — since `.glass`/`.glass-subtle` are light-toned and would wash the
  sidebar's own dark navy identity into an illegible pale wash; `.glass-dark` keeps the same
  structural language (backdrop blur, soft edge highlight) in navy tones, deliberately
  gentler (16px blur, no sheen) per the task's own warning that heavy blur on fixed nav
  chrome reads as noisy. Replaces `bg-navy` on `#sidebar-aside`; `glass-primitives.css` now
  linked on all 10 pages. Verified by actually opening the real off-canvas drawer and
  scrolling real content behind it — confirmed via screenshot the content genuinely blurs
  through, calm not shimmering, nav text staying fully legible. **2. Charts**: only 2 files
  in the project have a real Chart.js instance — `dashboard.html`'s pie and
  `transactions.html`'s bar + line. Pie: a real scriptable `backgroundColor` builds a
  per-segment radial gradient (each asset class's own locked color, light center to darker
  edge, one shared center point) plus a `pieGlossyDepth` plugin (Chart.js's own public
  `beforeDatasetsDraw`/`afterDatasetsDraw` hooks) for a soft shadow + glossy sheen; border
  2→3. Bar: a shared `verticalGradientFill()` helper on both Buys/Sells plus a
  `barShadowLift` plugin, `borderRadius: 6` kept. Line (the un-named third chart, found by
  investigating rather than assuming the task's list was complete): the flat area fill
  became a real gradient via the same helper, for consistency. Verified every chart's
  `backgroundColor` is genuinely a function via the live `Chart.getChart()` instance, real
  data unchanged, and a real simulated pointer event still resolves the correct pie segment
  (a first attempt at the exact geometric center failed — a genuine degenerate hit-test
  point, not a bug, fixed by offsetting it). **3. risk-management.html**: the Risk Meter's
  own locked gold/mahogany/deep-green control confirmed completely untouched (a direct
  negative assertion). Glass applied only to what was named: the Diversification Score box
  (`.glass-subtle`; its two siblings deliberately left plain) and the Regulatory Heatmap's
  outer card (`.glass`; its 4 status sub-cards stay clean). One blob added. **4.
  documents.html**: `#from-section`/`#upload-section` → `.glass`; rows confirmed to carry no
  glass class. `#notification-chips` (previously backgroundless) now reads as one
  `.glass-subtle` strip; individual chip pills unchanged. One blob added. **5.
  settings.html — investigated first**: confirmed Password Change/2FA/Active Sessions sat in
  ONE flat card differentiated only by hairline dividers, no icon/heading hierarchy at all.
  Restructured into 3 independently-bounded `.glass-subtle` sub-cards with icon+title
  headers and real gaps — every element id kept byte-identical, confirmed via a real
  functional test that the strength meter still fires after restructuring. Profile/KYC card
  got full `.glass`. One blob added. **6. deploy-capital.html**: all 4 form-panel containers
  → `.glass`; option-selector buttons deliberately left untouched (action tiles); every
  input confirmed still plain/opaque via computed style. One blob added. **Verified**: a
  real seeded test client browser-verified live via headless Chrome over CDP — 53/53
  assertions on the second pass (fixed 2 test-script bugs, neither a real product bug).
  Contrast measured directly on 2 new surfaces, matching Stage 1's discipline. Skeleton
  states re-confirmed inside 2 of the new glass surfaces via a real throttled-network
  mid-load screenshot. Zero horizontal overflow at normal and a real 390px viewport across
  all 6 touched pages. **A real, pre-existing data-pollution bug found and fixed during the
  regression run, not caused by this task**: `verify-asset-pages-ui-wiring.mjs` crashed —
  traced to 6 leftover test products from an earlier, untidied session pushing the real
  seeded products off the grid's first page; cleaned up (confirmed none were referenced
  elsewhere), re-ran clean. Full existing Supabase suite re-run for zero regression after
  the cleanup. No cloud staging deployment needed. Backend Requirements Register row 148.
- **★ Admin/PM Tool Visual Treatment — every admin page (2026-09-06).** Reuses
  `glass-primitives.css` exactly. **Investigated all 15 admin pages first**: confirmed the
  expected enumeration is complete. One real finding: none of the 7 Approval Gate queue
  pages actually have a top "summary/stat surface" — each is purely a header + Pending +
  History — reported rather than inventing one. A second judgment call: `admin-documents.
  html`/`admin-support.html` aren't under the sidebar's own "Approval Gate" group but
  structurally match the same Pending/History-container pattern — treated identically for
  consistency. **A fourth formal primitive, `.glass-slate`**, added the same way
  `.glass-dark` was: reusing `.glass-dark` (navy-toned) directly on the admin sidebar would
  have visibly tinted it toward the client tool's own navy identity, defeating the project's
  own locked "wholesale distinct color scheme... never visually confused" principle —
  `.glass-slate` is byte-for-byte the same recipe with the two background stops swapped to
  real slate-900/slate-950 RGB values, confirmed via computed style. Replaces `bg-slate-900`
  on `#admin-sidebar-aside`; linked on all 15 pages. **admin.html**: all 13 pending-count
  cards → `.glass-subtle`; all-clear banner → `.glass`; hover states re-confirmed still
  fire. **Every queue page**: Pending/History outer containers → `.glass` (14 containers
  across 7 pages, plus 3 more on `admin-documents.html`/`admin-support.html` —
  `admin-documents.html`'s own "Publish to Client" form deliberately excluded, the one real
  exception among these siblings). Rows confirmed via negative assertion to carry no glass
  class. Approve/Reject/Credit buttons and PM-editable amount fields verified via real
  computed style (opacity 1, pointer-events not none, plain white inputs) inside 4 real
  opened modals. **admin-clients.html**: outer container → `.glass`; expanded-row detail
  (`bg-slate-50/60`) → `.glass-subtle`, confirmed by actually clicking a real row.
  **admin-products.html/admin-advisory-fee.html/admin-security.html**: card surfaces →
  `.glass` (including the identical expanded-row pattern on admin-products.html); Add/Edit
  Product modals left untouched. **admin-login.html — the one richer treatment**: confirmed
  via markup it has no scrolling `<main>` at all, so `.blob-field` was used directly (2
  blobs + `.grid-overlay`); the login card became a real `.glass` panel. **Blobs**: 1
  restrained `blob--sm` per touched scrollable page (14 pages). **Verified**: a real seeded
  test client with a real pending item in all 7 queues, browser-verified live via headless
  Chrome over CDP — 57/57 assertions across two passes (one test-timing false negative on
  an expand-row check, independently reconfirmed correct). Zero horizontal overflow at a
  real 390px viewport across all 15 pages; a real throttled-network mid-load check; a real
  contrast check on a page header. Full existing Supabase suite re-run for zero regression.
  A second instance of the same leftover-test-product pollution already found once in the
  prior task reappeared (from `verify-products-catalog-fix.mjs`'s own unreliable cleanup)
  and was cleaned up again — flagged as worth a dedicated fix to that script's own teardown
- **★ Three-item polish batch: AUM figure, dashboard card reorder, remaining glass
  treatment (2026-09-06).** **1.** `$900m` -> `$350m` project-wide — 2 real code references
  (`index.html`'s Stats Bar card, a `home-motion.js` comment), 2 historical `.md` mentions
  deliberately left untouched. **2.** `dashboard.html`: Currency Converter moved above
  Market Snapshot (kept its own compact 1-of-3-column width); Market Snapshot now sits
  full-width below it (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`), room to grow into a
  future 20-30 symbol batch. Confirmed via real DOM order + width comparison the grid
  reflows cleanly, nothing else misaligned. **3.** Remaining glass treatment, investigated
  project-wide rather than trusting the task's own list as complete: `signup.html`/
  `login.html`/`thank-you.html` each had their OWN bespoke pre-existing "glass on dark
  photo background" implementation (predating the shared primitive system) — replaced with
  the real shared `.glass`/`.blob`/`.blob-field`/`.grid-overlay` primitives, bodies switched
  to the light `var(--bg)` page background; the old background images left unused on disk,
  not deleted. The Get Access modal panel (shared identically across all 8 marketing pages)
  got `.glass`. All 7 `.page-hero`-sharing marketing pages got `.glass-dark` + `.blob-field`
  + 2 blobs (a safe, zero-new-primitive reuse — the hero's own pre-existing navy gradient is
  nearly the same hue). `high-yield-savings.html`'s New Pocket + Withdraw modal panels got
  `.glass` per the task's own explicit, narrow exception to the standing "modals stay clean"
  precedent — inputs/selector tiles confirmed to stay completely clean. `deploy-capital.html`
  investigated and confirmed already fully covered from an earlier task, no changes needed.
  16 admin/client files with the standard plain-modal pattern were confirmed intentionally
  left unconverted, outside this task's narrow HYS-specific exception. **Two real pre-existing
  bugs found and fixed as a byproduct**: `login.html` had dead CSS
  (`.login-topbar a.back-link`, never matched the real `back-link-panel` markup) — deleted;
  `signup.html` had its own byte-identical local duplicate of the global `.back-link-panel`
  rule — deleted, consolidating to the one shared rule. **Verified, browser-first, headless
  Chrome over CDP (no browser tool available this session)**: a full functional 9-step
  signup walkthrough (Individual path, correctly skipping steps 3/4) driving every real
  field/radio/select via real DOM events, ending in a real Supabase `signUp()` + `clients`
  insert and a real redirect to `thank-you.html` — zero console errors throughout; real
  computed-style contrast measurements (not eyeballed) — 8.95:1 for white hero text on the
  composited `.glass-dark` background, 16.25:1 for body text on `.glass` — both far exceeding
  WCAG AAA; narrow-viewport (390px, real CDP device-metrics override) checks confirmed the
  touched cards introduce zero additional overflow beyond the already-documented,
  out-of-scope shared-header overflow (rows 101/135/136). Full existing regression suite
  re-run for zero regression — a pure CSS/HTML/comment task, confirmed via `git status`, no
  cloud staging deployment needed; parity re-confirmed clean regardless. **A third instance
  of the known `verify-products-catalog-fix.mjs` test-pollution issue found and cleaned up**
  (2 stray test products, confirmed unreferenced, removed) — now surfaced three separate
  times across three separate tasks, strengthening the case for a dedicated fix to that
- **★★ Get Access Modal redesign + terminology consistency + project-wide contrast audit
  (2026-09-06) — the largest single-task contrast finding in the whole glass-treatment
  series.** **1. Get Access Modal**: `.glass` removed from the panel entirely — a real,
  measured failure: the old panel sat over its OWN blurred backdrop
  (`rgba(18,42,56,0.55)` + `blur(4px)`), and that double-transparency stack computed to
  1.86:1–2.93:1 for body text, a marginal 4.51:1 even for navy titles. Rebuilt as a solid
  white panel, two columns — LEFT (`.access-options`, compact horizontal Login/Sign Up
  rows) and RIGHT (`.access-value-panel`, a genuinely opaque navy gradient — nothing sits
  behind it worth seeing through, so no glass at all) with 3 real benefit rows grounded in
  the actual platform (5-asset-class diversification, PM-approval workflow, the live
  dashboard). Mobile-first: value panel first in DOM (stacks above on narrow viewports with
  zero media query), reordered to the right only via CSS `order` at `min-width:640px`.
  `--accent-teal-soft`'s doc comment updated to record a real, measured second use as
  accent text on this dark panel — `--accent-teal` itself was tested and failed (2.47:1–
  3.07:1) there. **2. Terminology**: 8 "Create Account" instances (byte-identical Get Access
  button, all 8 marketing pages) standardized to "Sign Up" as part of the modal rebuild;
  confirmed zero live instances remain via a second grep. Reported, not fixed, per
  instruction: "Login" (client-facing) vs "Sign In" (`admin-login.html`), and "Logout"
  (client-facing, one word) vs "Log Out" (`admin-sidebar.js`, two words). **3 & 4.** AUM
  figure and dashboard reorder already correct from the same-day prior task — re-verified
  live, not redone. **CRITICAL contrast audit — where the real scope grew far past the
  modal**: re-measured real computed contrast everywhere the modal's own failure mode could
  recur. Found and fixed three genuinely separate issues. **(a)** The identical double-
  transparency bug in `high-yield-savings.html`'s New Pocket and Withdraw modals (both
  glassed in an earlier same-day task, both sitting over their own `bg-navy-dark/60`
  backdrop) — measured 1.62:1–3.53:1, reverted to plain `bg-white`. **(b)** A systemic
  finding: Tailwind's `text-slate-400`/`text-slate-500` used as real body/label copy inside
  a `.glass`/`.glass-subtle` card in 83 real instances across 22 client-dashboard/admin
  files — found via a purpose-built script walking real HTML to attribute each occurrence to
  its actual glass ancestor. `text-slate-500` is already marginal on plain white (4.759:1);
  glass's own low-alpha corner over this project's real cream/slate-100 backgrounds tips it
  to 4.480:1/4.433:1, and `text-slate-400` to ~2.4:1 — both genuinely below 4.5:1. Fixed the
  same way the TPV gradient-text issue was resolved — changing the treatment at the point of
  failure, not re-tuning the shared `.glass` recipe (which would need nearly doubling its
  low-alpha stop, visibly changing every already-verified surface project-wide) — via one
  scoped descendant-selector override in `glass-primitives.css` bumping both to slate-600
  (`#475569`, 7.06:1–7.13:1) specifically inside any glass variant; every other real use
  outside a glass container is untouched, structurally unreachable by the override.
  **(c)** Low-opacity white text inside the two dark sidebars: `admin-sidebar.js`'s nav
  group labels (`text-white/40`, 2.86:1–3.82:1) and footer text (`text-white/50`, a marginal
  4.39:1), `dashboard-sidebar.js`'s footer account-type text (`text-white/60`, a marginal
  4.42:1) — all 4 bumped to `/70` (5.37:1–9.26:1 across the real gradient, regardless of
  exact position). **Verified genuinely safe, with real recomputed numbers, not assumed**:
  public-site `.glass` on the plain page bg (16.09:1/11.28:1), `.page-hero`'s `.glass-dark`
  (8.95:1), the Philosophy CTA's earlier-fixed override (9.13:1/13.02:1), every other real
  modal with a translucent backdrop confirmed to correctly carry no glass class at all.
  Decorative-only `text-slate-300` icon strokes confirmed exempt (no icon-only controls
  among the 14 real instances). **Verified live, headless Chrome over CDP (no browser tool
  available this session)**: 31/31 assertions on the second pass (2 test-script bugs fixed —
  a background-detection bug reading a transparent ancestor instead of the real white panel,
  and a stray test-only localStorage write that corrupted the real session needed later in
  the run; neither was a real product bug) — covering the modal's structure/no-glass/
  responsive-stacking, real measured contrast on both columns, "Sign Up" wording, both HYS
  modals confirmed reverted, the slate-500 override resolving correctly via a real synthetic
  DOM test, and all 3 sidebar fixes confirmed on real rendered `admin.html`/`dashboard.html`
  content through real admin and client logins. Full existing regression suite re-run for
  zero regression — a pure CSS/HTML/JS-string task, no schema/function changes, no cloud
  staging deployment needed; parity re-confirmed clean regardless. **A fourth instance of
  the known `verify-products-catalog-fix.mjs` test-pollution issue found and cleaned up**
  (1 stray test product, confirmed unreferenced, removed) — now found four separate times
- **★★ Glass Language Extension — every remaining page, modal, panel, and overlay
  investigated project-wide, real gaps closed (2026-09-07).** Reuses `glass-primitives.css`
  exactly, no new primitives needed. **Item 1** (signup/login/thank-you): confirmed already
  fully treated from a same-day prior task — re-verified rather than redone, including a
  full, real, functional 9-step signup walkthrough that genuinely completed end to end.
  **Item 2** (HYS "Open a New Pocket"): both modals confirmed correctly solid (reverted by
  the Contrast Audit, row 151); the one remaining candidate, "My Pocket Requests," renders a
  real `<table>` internally, so it correctly stays plain. **Item 3** (deploy-capital.html):
  its 4 forms were fully covered earlier, but "My Funding Requests" — added by a LATER task
  (Deposit Wiring fix, Aug 22, 2026) — was genuinely missed; investigated and correctly left
  plain, also a real `<table>`. **Item 4, the comprehensive project-wide investigation,
  where most of this task's real work landed**: grepped all 36 HTML pages for un-glassed
  `bg-white` containers. Found and closed 2 real, clean gaps never touched by any prior
  task — `asset-collection.html` (linked the stylesheet but had zero applied classes; its
  browse container got `.glass` + a blob + `relative overflow-x-hidden` on `<main>`) and
  `support.html` (same situation; its div-based "My Requests" list got `.glass` + the same
  blob/main treatment). Found and closed 4 more gaps on already-partially-treated pages,
  each confirmed via direct source inspection to be newer content or a genuinely overlooked
  standalone display card: `dashboard.html`'s Portfolio Allocation chart + Recent Activity;
  `transactions.html`'s Recent Activity + both chart cards; `asset-performance.html`'s
  "Browse Asset Collection" teaser card. **A real rule discovered and corrected mid-task,
  disclosed not smoothed over**: an initial pass glassed FORMS (Currency Converter, "Open a
  Dispute") by analogy to deploy-capital.html's own glassed forms — WRONG, caught by finding
  `admin-documents.html`'s own pre-existing comment: "deliberately left clean (not glass):
  this is a form, matching the 'every form, input, filter... stay clean' instruction."
  Investigated further: deploy-capital.html's forms are CONDITIONALLY-REVEALED single-focus
  action panels (`.form-panel { display: none }` until picked, a quasi-modal moment), not
  permanent page furniture like the two just-reverted forms. **A second rule, also caught
  mid-task**: "My Pocket Requests"/"My Funding Requests" were initially glassed by analogy
  to documents.html's div-based lists, then found to render real `<table>`s — reverted,
  matching this project's own standing "tables — must stay clean" principle (also confirmed,
  on inspection, for the Filters bars on transactions.html/documents.html, the Return Table/
  My Requests table on asset-performance.html, and Notification Preferences on
  settings.html). **Other deliberate exclusions confirmed and documented**: settings.html's
  forced-password-reset banner (an intentionally urgent security alert); risk-management.html's
  locked Risk Meter card (re-confirmed, not re-litigated); the notification bell dropdown
  (shared across all 10 client pages) and support.html's Chat Panel — both investigated and
  left solid as OVERLAYS (floating popovers with no darkened backdrop that can open over
  arbitrary real page content, a case `.glass` was never tuned or verified against, unlike
  `.glass-dark`'s own specific tuning for the sidebar). **The critical double-transparency
  lesson from row 151 was applied throughout**: every modal sitting over its own translucent
  backdrop project-wide re-confirmed via direct source inspection to correctly carry no
  glass class — zero new risk introduced anywhere. The admin tool was independently re-swept
  and found to have no further gaps. **Verified live, headless Chrome over CDP (no browser
  tool available this session)**: 47/47 assertions on the final pass (2 test-script bugs
  fixed — a timing flake reconfirmed on a clean re-run, and a DOM-structure assumption where
  a heading turned out to be a SIBLING of its card div, not a descendant) — covering every
  new surface's real computed contrast (all comfortably above 4.5:1), every deliberately-
  plain surface confirmed genuinely plain, the full real 9-step signup flow, and real
  page-level overflow via `document.body.scrollWidth` (a third correction: `<main>`'s own
  `scrollWidth` legitimately reports larger due to its own off-screen blob elements while
  still correctly preventing real visible overflow, confirmed identical on an already-
  established, unrelated page before trusting it) at normal and 390px. Full existing
  regression suite re-run for zero regression — no schema/function changes, no cloud staging
  deployment needed. **A fifth instance of the known `verify-products-catalog-fix.mjs`
  test-pollution issue found and cleaned up.** Backend Requirements Register row 152.
- **★★ Branded HTML Emails — recovery, first real execution, and two real infrastructure
  fixes (2026-09-07).** Closes out a task that was left uncommitted and never once run when
  this machine froze mid-session (a separate recovery task confirmed the state: `_shared/
  send-email.ts`'s full `renderEmail()` HTML/plain-text template, 22 converted trigger
  functions, and 4 brand-new functions — `notify-new-client-application`, `notify-new-
  document-upload`, `notify-password-changed`, `sync-hys-pocket-status` — all sat structurally
  complete but unverified, since the local Docker/Supabase stack wasn't even running). Docker
  Desktop + `supabase start` brought the stack back up; the edge-runtime container had exited
  on its own first boot (`Exited (255)`, no error in its logs — a transient cold-start
  artifact) and needed one `docker start` to come up clean. **First real run of the new
  `scripts/verify-branded-emails.js`: 196 passed, 23 failed — every single failure was the
  identical assertion**, "a real send failure (unreachable domain) is honestly logged as
  failed," across every domain. **Root-caused before touching anything, not assumed a fluke**:
  the same-day context this task started from — marketswave.net is now a verified Resend
  sending domain — silently invalidated the whole test technique both this new script and two
  PRE-EXISTING scripts (`verify-supabase-email-notifications.js`,
  `verify-supabase-email-triggers-stage2.js`) relied on. All three used a syntactically-VALID
  `@invalid.test` recipient, which only ever failed because the OLD unverified
  `onboarding@resend.dev` sandbox sender enforced "deliver only to the account's own
  registered address" — confirmed directly by querying the real `email_log` rows this run
  produced (`status: "sent"`, real `resend_id`s) and by a direct `curl` against the real
  Resend API showing `@invalid.test` now gets synchronously QUEUED, not rejected, once the
  sender domain is verified (Resend never validates deliverability synchronously, only
  request format). **Fix, applied to all three scripts**: a genuinely malformed recipient (no
  `@`, e.g. `branded-email-verify-malformed-<suffix>`) DOES still trigger a real, synchronous
  422 regardless of sender-domain verification — confirmed directly via `curl` before relying
  on it. Since the notification recipient is `clients.email` (a column fully decoupled from
  the Auth account's own login email, already established by an earlier fix), every test
  client's `clients.email` was set to the malformed value via `createTestClient()`'s existing
  `opts` override while its real Auth email stayed valid (a malformed Auth email would have
  broken signup/sign-in itself, a different concern) — zero changes needed to any application
  code, only the three test scripts. **Re-run clean: 219/219**, and — since the two
  pre-existing scripts shared the identical latent bug and would have silently started failing
  the next time either ran — fixed proactively rather than left for a future surprise:
  `verify-supabase-email-notifications.js` 14/14, `verify-supabase-email-triggers-stage2.js`
  85/85. **Domain-verification judgment call, asked of the user rather than guessed**: the
  FROM sender address was switched to `Marketswave <noreply@marketswave.net>` (via a new
  `getFromAddress()`, `EMAIL_FROM_ADDRESS`-overridable, mirroring `SITE_URL`'s own pattern) —
  safe, since it's purely a deliverability improvement and a `noreply@` address makes no
  implicit promise about a monitored inbox. The footer's displayed `support@marketswave.com`
  contact address was confirmed with the user to have NO real monitored `support@
  marketswave.net` inbox yet, so it was deliberately left as its existing, already-flagged
  placeholder rather than switched to a real-looking address on a real domain nobody reads —
  logged as its own follow-up register row rather than left silently implied-resolved by the
  sender-address fix. **Mid-task, a second real piece of context arrived**: the project's
  custom domain, `marketswave.net`, is now fully live with HTTPS enforced, and a `CNAME` file
  had already been pushed directly to `origin/main` (pulled in via a clean fast-forward, no
  conflict with the uncommitted work). Grepped the whole project for the old GitHub Pages URL
  and found exactly ONE live-code reference — `send-email.ts`'s `getSiteUrl()` default —
  updated to `https://marketswave.net`; two historical, dated narrative mentions in `CLAUDE.md`
  itself and the handover doc were deliberately left untouched, per this project's own
  "don't rewrite history" convention. `admin-supabase-config.js`/`supabase-config.js`'s own
  hostname-detection logic was confirmed to need zero changes — it was already written
  generically ("any non-localhost hostname"), never hardcoded to the old domain. **A real,
  previously-undiscovered deployment gap found while checking real cloud staging parity, not
  assumed clean**: `verify-cloud-staging-parity.js` reported only 2 missing functions
  (`notify-password-changed`, `sync-hys-pocket-status`), which on direct investigation via
  `supabase functions list`'s own real timestamps revealed something bigger — the INTERRUPTED
  prior session had already deployed the other 22 touched functions to real cloud staging
  before the machine froze (all clustered within one ~8-minute window, `11:08-11:16 UTC`,
  ending right where the 2 missing ones would have come next alphabetically/by creation
  order). Those 22 were carrying a STALE bundled `_shared/send-email.ts` — Deno bundles shared
  imports at deploy time, a lesson this project already learned once for `_shared/portfolio-
  engine.ts` — meaning real cloud staging was, until this fix, still sending from the old
  `onboarding@resend.dev` sandbox address with no domain-verification or `SITE_URL` fixes
  applied at all. **Fixed**: all 25 real functions that import `_shared/send-email.ts`
  (confirmed via a project-wide grep, not assumed to match the git diff's own 24-function
  count) redeployed together in one `supabase functions deploy` call; `verify-cloud-staging-
  parity.js` re-confirmed clean afterward (13/13 migrations, 44/44 functions). **Full
  regression suite re-run end to end after all fixes**: every one of the ~30 `verify-*`
  scripts plus `supabase-golden-path-regression.js`, all green (one script,
  `verify-dashboard-real-data-fixes.mjs`, showed 37/37 instead of its historical 38/38 — a
  genuinely benign, already-documented conditional skip, not a regression: a specific named
  real test client from an earlier session no longer exists on this since-rebuilt local
  stack, and the script itself reports this as informational rather than asserting failure).
  **Step 5, the real human-confirmed proof — the "send-representative-sample-emails.js" step
  `verify-branded-emails.js`'s own header comment had referenced but which had never been
  written**: built new `scripts/send-representative-sample-emails.js`, confirmed the target
  real inbox with the user directly before sending anything real and externally visible
  (never guessed). Creates two genuinely separate temp identities against the LOCAL stack — a
  temp PM account whose real Auth email IS the target inbox (since `getAdminEmails()` resolves
  real Auth emails, not a decoupled column) and a temp client account with a synthetic Auth
  email but `clients.email` set to the real target inbox (mirroring the exact decoupling
  technique the regression-script fix above established) — then triggers 9 real function
  calls covering every dimension the task named: existing conversions in both footer types
  (`approve-allocation`/`reject-withdrawal` investment, `reject-profile-change` general), new
  client-side triggers (`request-deposit`, `notify-password-changed`, `sync-hys-pocket-
  status`), and new PM-side triggers (`notify-new-client-application` — which alone produces 2
  real emails, a client receipt AND a PM notify — `notify-new-document-upload`,
  `request-support-ticket`). **Confirmed genuinely delivered, not just "the call didn't
  error"**: a direct `email_log` query after the run showed all 10 real emails logged
  `status: "sent"` with real, distinct Resend message ids. All temp accounts and test data
  cleaned up afterward. Real cloud staging was deliberately NOT used for this step — the same
  real, shared Resend account backs both environments, so a local send is an equally real
  proof of actual delivery without touching real cloud staging's own test data. Backend
  Requirements Register rows 153-154 (154 being the still-open `support@marketswave.net`
  monitored-inbox follow-up).
- **★★★ Client-Facing Password Reset flow + a real production bug found and fixed + a
  project-wide test-hang audit + Supabase Auth Email Branding investigation and partial
  implementation (2026-09-07).** Four connected pieces of work from the same session,
  triggered by a real broken password-reset attempt on the live site.
  **1. The real reset flow, built from scratch.** Investigated first: `login.html`'s
  "Forgot Password" panel was a complete, non-functional 4-step stub simulating a 6-digit
  verification code — literal `// Later: call backend here` comments at every step, never
  once calling Supabase. Supabase's REAL reset mechanism is link-based, not code-based, so
  the fake code-entry steps were removed entirely, replaced with a real 2-step flow (enter
  email → real `resetPasswordForEmail()` call → "Check Your Email" confirmation, identical
  regardless of whether the email is real — no enumeration signal, matching this project's
  own established login-check discipline). New `reset-password.html` is the real destination
  `redirectTo` points at: builds its OWN Supabase client (the shared `supabase-config.js`
  client explicitly sets `detectSessionInUrl: false` project-wide, since no page had ever
  needed URL-based recovery-token detection before now — `ACTIVE_CONFIG` was exported from
  that file so this one page can build its own client with `detectSessionInUrl: true` without
  duplicating the local/staging URL+key literals in a second file), listens for the real
  `PASSWORD_RECOVERY` auth event, shows a real "Set New Password" form (reusing settings.html's
  own strength-meter scale), calls `updateUser({password})`, fires the existing
  `notify-password-changed` best-effort email, and signs the recovery session back out so the
  client re-authenticates fresh with their new password — matching this project's standing
  rule that no flow silently drops a client into the dashboard without a real login step. A
  real, necessary `additional_redirect_urls`/`site_url` fix was required for the real
  `redirectTo` to be accepted at all (Supabase Auth's own server-side allowlist) — see item 4
  below for how this was done safely. **Verified end to end with real Mailpit-captured
  emails** (`scripts/verify-password-reset-flow.mjs`, reusing `verify-admin-real-login.mjs`'s
  own "extract the real `<script type="module">`, run it against a real jsdom window" 
  technique, extended with a new `lib/esm-loader-reset-flow-test.mjs` stubbing login.html's
  still-statically-present RETIRED Firebase imports): the happy path (real recovery link →
  real session → real password change → a genuinely fresh sign-in with the new password
  succeeds, the old one no longer works), an unknown email (identical confirmation, no
  enumeration signal), a direct navigation with no token at all (honest "invalid/expired"
  state, not a stuck spinner), and a real reused/already-consumed link (genuinely refused by
  the real server) — 16/16 assertions, run before the day's Resend quota was exhausted.
  **2. A real, previously-undiscovered production bug found while verifying, not assumed
  a fluke.** `verify-branded-emails.js` started failing 3 checks — "PM notification never
  logged" — for the first time. Root cause: `getAdminEmails()` (`_shared/send-email.ts`)
  called `listUsers()` with no pagination, defaulting to 50-per-page, newest-first; this
  project's own accumulated test-account cruft across many sessions pushed real total users
  past 50, silently bumping the real bootstrap PM (`pm@marketswave.local`, earliest-created)
  onto page 2 — **every PM-facing notification in the entire app had been returning zero
  recipients since real user count crossed 50, confirmed directly** (54 total users at the
  time, `pm@marketswave.local` absent from a bare `listUsers()` call, present once paginated
  through). Fixed by paging through every page rather than assuming one call covers every
  real user, present or future; deployed to real cloud staging (config-only, no email
  involved). Re-verifying via the full email test suite is deferred until Resend quota resets
  (confirmed via direct query that the underlying fix logic now finds both real PM accounts).
  **3. Project-wide verify-script hang-bug audit (a second, separate request, same session).**
  This new script hung indefinitely after printing a full 16/16 PASS result — the identical
  class already diagnosed and fixed once, hours earlier, in `verify-admin-real-login.mjs`
  (confirmed via the same CPU-time-vs-wall-clock method: ~7s actual work against 10+ minutes
  wall clock, required a manual kill): real Supabase clients with `autoRefreshToken: true`
  schedule a live refresh timer never explicitly stopped, so Node's natural
  exit-when-event-loop-empty never fires. Audited all 30 `verify-*.js`/`.mjs` scripts: 24
  lacked an explicit success-path `process.exit(0)` and were patched (a uniform, mechanical
  one-line addition, syntax-checked and spot-verified against 3 representative files — one
  confirmed to genuinely have been hanging, two confirmed already-fine but now robust against
  ever silently regressing). **Preventative measure, not just a one-off patch**: new
  `scripts/lib/run-verify.mjs` exports `runVerifyMain(main)` — a shared wrapper handling the
  exit(0)-on-success + watchdog pattern so a NEW script inherits the fix by construction;
  `verify-password-reset-flow.mjs` itself was rewritten to use it as the first real adopter,
  re-confirmed still 16/16 passing at ~22s (down from a 10+-minute hang requiring a manual
  kill) after the swap.
  **4. Supabase Auth Email Branding — investigated, partially implemented, the SMTP half
  deliberately held.** Confirmed both paths are achievable via `config.toml`
  (`[auth.email.template.*]` for branded HTML, `[auth.email.smtp]` for routing through
  Resend) — no Dashboard UI clicking needed, both are `config push`-able to the real project.
  **A real, load-bearing design tension found and resolved**: `config.toml` is shared between
  local `supabase start` and `config push` to real cloud staging; this project's own
  regression suite triggers real Supabase-native signup/reset emails constantly during normal
  local development, so putting live Resend SMTP in the shared file would burn real quota on
  every routine local test run, forever — not just today's already-exhausted case. Resolved
  by keeping `[auth.email.smtp]` OUT of the shared config.toml entirely: new
  `scripts/supabase-staging-configure-smtp.js` builds a throwaway temp copy of the real
  `supabase/` directory (confirmed via a real, harmless `supabase status --workdir <dir>`
  test that `--workdir` expects the PARENT directory, not the `supabase/` subdirectory itself
  — the natural first guess, wrong), appends a real `[auth.email.smtp]` block there only
  (Resend's real relay: `smtp.resend.com`, user `resend`, password = the already-configured
  `RESEND_API_KEY` read live from `supabase/functions/.env`, never hardcoded or copied as a
  file — confirmed via a dry run that `.env` itself is explicitly excluded from the temp
  copy), and pushes FROM that temp copy via `--project-ref` — so local dev's own `config.toml`
  never carries a live SMTP block and can never accidentally drift into using it. **A second
  real finding, discovered attempting the template push**: Supabase's free tier rejects ANY
  email template customization outright until custom SMTP is configured — "Email template
  modification is not available for free tier projects using the default email provider.
  Please upgrade your plan or configure a custom SMTP provider." Templates and SMTP are not
  independent rollout steps on this project's real plan tier. **A third real finding, caught
  by `config push`'s own diff before it applied, not after**: a first attempt at
  `additional_redirect_urls` (needed for the reset flow's own `redirectTo` to be accepted)
  would have REPLACED real cloud staging's actual current 4-entry list — carrying entries
  this repo's own `config.toml` never tracked (evidently added directly via the Dashboard at
  some point, never synced back) — with just 2 new ones, silently breaking whatever
  legitimately depends on the other three. Fixed by unioning with what's actually live rather
  than guessing; the existing `https://marketswave.net/**` wildcard already covers
  `reset-password.html` on production, so only the genuinely-new local dev entry
  (`http://127.0.0.1:8765/reset-password.html`) needed adding. Pushed successfully, confirmed
  via the diff showing exactly the intended addition. **What's genuinely done vs. deliberately
  held, reported plainly, not blurred**: a real branded `supabase/templates/recovery.html`
  (matching `renderEmail()`'s own navy/cream shell, MARKETSWAVE wordmark, real footer legal
  text) is written, wired into `config.toml`, and **verified live via a real local
  `resetPasswordForEmail()` call captured in Mailpit** — real substituted
  `{{ .Email }}`/`{{ .ConfirmationURL }}` values, correct subject ("Reset your Marketswave
  password"), zero Resend cost since local dev never touches Resend. This template is
  **NOT YET pushed to real cloud staging** — blocked by the free-tier SMTP requirement above,
  and deliberately not unblocked by rushing SMTP live while quota is exhausted (a real user's
  real password-reset attempt on staging right now would rather use the current, working,
  unbranded default mailer than silently fail to deliver through a freshly-enabled, unverified
  SMTP relay). `scripts/supabase-staging-configure-smtp.js` is written, syntax-checked, and
  dry-run-verified (temp-copy structure, `.env` exclusion) but **deliberately not executed
  against real cloud staging** — per direct instruction, held until Resend quota is confirmed
  reset and a real end-to-end send can be verified, matching every other real-email feature in
  this project's own verification discipline. Also deliberately left commented out in
  `config.toml`: Supabase's own native "password changed" notification template — this
  project's own real `notify-password-changed` Edge Function already sends a real, branded
  version of that exact email; enabling Supabase's native one too would double-send. Backend
  Requirements Register rows 155-158.

- **★★★ Unified Communications Inbox — Stage 1: data model + live chat (2026-09-07).** The
  foundation for a unified inbox handling BOTH live chat (this stage) and two-way email
  (Stage 2, not built) — the schema was deliberately designed for both from the start rather
  than a chat-only model needing a later reshape. Local stack only.
  **Schema**: new `conversations` (`client_id`/`visitor_auth_id` both nullable references to
  `auth.users`, `contact_email`/`contact_name`, `status` open|resolved|archived,
  `last_message_at`, `unread_by_pm`, PM attribution columns per Phase C's established
  convention, `last_notified_at` for the debounce below) and `messages` (`channel`
  chat|email, `direction` inbound|outbound, `body`, `sender_name`/`sender_email`, plus
  nullable `message_id`/`in_reply_to` — unused by this stage, reserved for Stage 2's real
  email threading so that later work needs no new columns). **Grouping rule**: a unique
  index on `lower(contact_email)` in `conversations` — one conversation per contact, across
  channels, enforced at the database level, not just application logic. **Retroactive
  linking, investigated and decided per instruction**: a `SECURITY DEFINER` trigger on
  `clients` AFTER INSERT (`link_conversations_to_new_client()`) was chosen over a
  signup-flow client-side check — it fires for every real client-creation path (signup,
  admin-created) rather than one, and bypasses the RLS gymnastics a freshly-signed-up client
  would otherwise need to update a conversation row they don't yet own.
  **RLS, the anonymous-visitor identity question investigated and decided per
  instruction**: real Supabase Anonymous Sign-ins (`signInAnonymously()`) were chosen over a
  hand-rolled session-token scheme — a real JWT with `is_anonymous: true`, `authenticated`
  role, integrates natively with both RLS and Realtime with zero custom plumbing.
  `enable_anonymous_sign_ins` flipped to `true` in `config.toml` (safe to share between
  local/staging — no email cost, already rate-limited). **A real, disclosed security design
  decision, not a compromise silently accepted**: `visitor_auth_id` is set once and never
  reassigned — a later anonymous session with the same email can still WRITE into the
  grouped thread (satisfying the grouping rule, matching real-world email's own trust model)
  but is never granted READ access to prior history, protecting against information
  disclosure from anyone who merely knows/guesses an email address. Conversations carry NO
  client-side INSERT/UPDATE policy for any role, including admin — every write goes through
  `start-chat-conversation` (creates/links, service-role) or `admin-update-conversation`
  (status/read-state, admin-only); messages allow a direct client-side INSERT scoped to the
  caller's own conversation and `direction = 'inbound'` only — an admin's own outbound
  reply/the visitor's own message both insert directly via RLS, no Edge Function needed for
  sending itself. **A real, load-bearing bug found and fixed during UI verification, not
  assumed correct from the schema alone**: neither table had `REPLICA IDENTITY FULL` set —
  Realtime evaluates each subscriber's RLS policies against the row data carried in the WAL
  change record itself, and Postgres's default replica identity only includes the primary
  key, nowhere near enough data (`client_id`/`visitor_auth_id`, the exact columns the SELECT
  policies key off) for that evaluation to succeed — without it, `postgres_changes` events
  were silently never delivered to ANY subscriber at all, confirmed directly (the admin
  inbox's own conversation list never updated in real time until this was added). Fixed with
  `alter table ... replica identity full` on both tables, in the migration and applied live.
  **Live chat, client side**: new `chat-widget.js`/`chat-widget.css` (plain CSS, matching the
  public site's own no-Tailwind convention — safe on top of Tailwind too) mounted via
  `#chat-widget-mount` on all 10 client-dashboard pages AND all 8 public marketing pages — a
  second, deliberate, disclosed exception to the public site's "no backend SDK" boundary
  (the first was `signup.html`/`login.html`). Anonymous visitors get a pre-chat name+email
  capture form; an authenticated dashboard client is auto-identified (their real
  `clients` row's own name/email, server-resolved, never a client-supplied override — the
  same spoofing prevention `start-chat-conversation` already enforces). Real-time via a
  `postgres_changes` subscription on `messages`, filtered by `conversation_id` — never
  polling. `support.html`'s old fake canned-reply chat panel ("Sarah from Marketswave
  Support," hardcoded replies) was removed outright and repointed to trigger the real widget.
  **Live chat, PM side**: new `admin-inbox.html` — real search (contact name, email, AND
  message body — a genuine full-text reach, not just header fields), status filter pills
  (all/unread/open/resolved/archived), channel filter pills (all/chat/email), a threaded
  view, real Resolve/Archive/Reopen actions (via `admin-update-conversation`, PM attribution
  recorded on resolve/archive), and real unread indicators — all held in one in-memory
  array fetched once via `MarketswaveData.selectTable()` and kept live by two Realtime
  subscriptions (INSERT on `messages`; INSERT+UPDATE on `conversations`) — the same
  "fetch once, keep live via Realtime, filter/search client-side" shape this project's own
  Client List already established, extended with a genuine live feed. Nav entry added to
  `admin-sidebar.js` under User/Admin Relations, positioned first.
  **Email notification, the debounce approach investigated and decided per instruction**: a
  simple `last_notified_at` time-window check (5 minutes) in `notify-new-chat-message` was
  chosen over Realtime-Presence-based "is a PM actively viewing" detection — simpler, more
  robust (no reliance on a PM's tab staying connected), and sufficient to avoid spamming
  during active back-and-forth. Called client-side, self-only (verifies the caller owns the
  conversation via `client_id`/`visitor_auth_id`), best-effort — `last_notified_at` updates
  regardless of whether the real send succeeds, matching `_shared/send-email.ts`'s own
  established non-blocking discipline. **Resend quota handled per the standing project
  constraint**: the function's own header comment and this stage's verification both treat a
  quota/rate-limit rejection as blocked-on-quota, never a code failure — verified the real
  debounce LOGIC independently of whether a send actually succeeds.
  **Verified**: two dedicated scripts. `scripts/verify-supabase-unified-inbox.js` (backend/
  API level), **39/39 assertions** — anonymous visitor start+resume, RLS isolation via a
  direct SELECT probe, the critical second-anonymous-session-same-email edge case (same
  conversation, `authorizedForHistory: false`, empty history, cannot even send — since
  `visitor_auth_id` was never granted, confirmed as a real, correct consequence of the
  design decision above, not a bug), mixed-channel grouping (an admin-inserted `'email'`
  message joins the same thread — proving Stage 2 needs no schema change), real client
  identity resolution (spoofing prevented), retroactive linking firing automatically on a
  real signup, admin read/resolve/reject actions with attribution, the full RLS negative
  matrix (a blocked UPDATE returns a silent no-op per real PostgREST/RLS behavior, not an
  error — proven by checking the row is provably unchanged rather than expecting a thrown
  error), the debounce itself, and a real Realtime subscription reaching genuine
  `SUBSCRIBED` status (not the unreliable `channel.state === 'joined'`) before a message
  insert is expected to arrive. `scripts/verify-unified-inbox-ui-wiring.mjs` (the real
  end-to-end UI proof, reusing `verify-cross-role-sync-bugfix.mjs`'s own established
  "genuinely separate contexts" technique — real jsdom windows, a real temp-file copy of
  `supabase-data.js` for the PM side since `chat-widget.js`'s own internal dynamic
  `import('./supabase-config.js')` needed the same temp-copy-at-the-real-path fix to resolve
  correctly when run via `window.eval()`), **28/28 assertions**: a genuinely separate
  anonymous visitor jsdom context and a genuinely separate real PM-session jsdom context,
  both running their REAL, unmodified widget/page code — a real visitor message appears in
  the real PM inbox via Realtime with zero manual re-fetch triggered by the test, a real PM
  reply appears back in the real visitor's own widget the same way, resolving a conversation
  updates both sides; search/filters proven against a realistic 5-conversation seeded volume
  (name, email, AND message-body search each independently proven to narrow correctly; every
  status and channel filter pill proven individually) — including a real test-authoring
  finding, not a product bug: seeding `unread_by_pm` directly at conversation-insert time
  doesn't stick, since `handle_new_message()` always sets it `true` on any inbound message
  insert (correct, real behavior — any new message should flag PM review) — fixed by
  marking specific seeded rows "already read" AFTER their message insert, not by changing
  the trigger; and real RLS isolation proven through the actual widget UI a second time (a
  genuinely different anonymous visitor's own widget starts a fresh, empty thread — zero
  history leakage from the first visitor or any seeded conversation). Full existing
  regression suite re-run for zero regression — one pre-existing, unrelated gap found and
  disclosed rather than fixed here: `verify-password-reset-flow.mjs`'s own temp-dir
  page-loading helper never copies `firebase-config.js` alongside `supabase-config.js`, so
  `login.html`'s static import of it fails when that script runs standalone (confirmed via
  `git status` that neither `login.html` nor `firebase-config.js` was touched this session —
  not a regression from this task). **Deployed to real cloud staging the same session**: the
  migration and all 3 Edge Functions pushed for real (dry-run confirmed only this one
  migration would apply first); `verify-cloud-staging-parity.js` re-confirmed clean
  afterward (14/14 migrations, 47/47 functions). Backend Requirements Register row 159 added.

- **★★★ Resend upgraded to paid — SMTP + branded recovery template genuinely live on real
  cloud staging, all 3 deferred email checks re-verified, quota-blocked constraint lifted
  (2026-09-07).** Closes rows 156-158's own deferred work — see Backend Requirements
  Register row 160 for the full writeup, including two real config-push traps found and
  fixed in `scripts/supabase-staging-configure-smtp.js` (pushing SMTP + the template
  together in one call fails on this platform; removing the template's config.toml section
  alone doesn't exclude it — the CLI auto-discovers `supabase/templates/recovery.html` by
  file-path convention regardless) and a third CLI-invocation finding (`--workdir` didn't
  reliably redirect config discovery for this command; running with `cwd` set directly to
  the temp copy's own root did). **Genuinely confirmed, not just an accepted API response**:
  a real throwaway staging user's real `resetPasswordForEmail()` produced a real email the
  user directly confirmed showed the full branded design, not Supabase's stock template.
  `verify-branded-emails.js` (219/219, all 3 target `getAdminEmails()` checks passing),
  `verify-supabase-email-notifications.js` (14/14), `verify-supabase-email-triggers-
  stage2.js` (85/85) — zero quota-blocked skips anywhere. A fourth, unrelated finding fixed
  along the way: the CLI's own update-nag banner started corrupting
  `verify-cloud-staging-parity.js`'s `JSON.parse()` calls (fixed with a shared
  `stripCliNagBanner()` helper, re-confirmed 14/14 migrations, 47/47 functions clean).
  **Resend's exact plan/ceiling could not be determined via API** — the project's
  `RESEND_API_KEY` is genuinely restricted to sending only; `x-resend-monthly-quota` was
  confirmed (by sending twice and watching it increment) to be a used-so-far counter, not a
  remaining/ceiling value. **The standing "do not send real test emails" constraint is now
  lifted** — future tasks may send real verification emails again where genuinely needed.

- **Real monitored support inbox confirmed — `support@marketswave.com` (placeholder) →
  `support@marketswave.net` (real) everywhere (2026-09-07).** Updated all 4 real code
  locations: `_shared/send-email.ts`'s `FOOTER_SUPPORT_EMAIL` constant (comment rewritten
  from "PLACEHOLDER — STILL OPEN" to "RESOLVED"), `supabase/templates/recovery.html`'s
  footer, and `support.html`'s contact card + mailto link + copy-button JS. Verified
  locally first (219/219 + 14/14 + 85/85, zero regressions), then redeployed all 26 real
  Edge Functions importing `_shared/send-email.ts` (Deno bundles shared imports at deploy
  time — a partial redeploy would leave some running a stale bundle) and pushed the
  recovery template separately via a plain `supabase config push` (its own diff showed
  exactly the `.com`→`.net` substitution, nothing else). `verify-cloud-staging-parity.js`
  re-confirmed clean (14/14 migrations, 47/47 functions). Backend Requirements Register
  row 161 added, superseding row 154.

- **★★★ CRITICAL: full real password-reset round trip verified end to end on the live site
  via real browser + Gmail access, plus the real Resend plan confirmed and two real bugs
  found and fixed (2026-09-07).** Real Chrome tools became available this pass; the user's
  own profile was already signed into Resend and Gmail, so every step was driven and
  confirmed directly. **Real plan, confirmed from the dashboard**: Pro, 50,000 emails/mo,
  unlimited daily, $20/mo, 230/50,000 used this cycle (renews Oct 7) — corroborating the
  earlier `x-resend-monthly-quota` finding as a used-so-far counter, not a ceiling. **Full
  round trip driven live**: real reset request → real branded email found in Gmail → real
  link clicked → real `reset-password.html` on marketswave.net detected the recovery
  session → new password set → login → real dashboard. **Two real bugs found**: (1) the
  first login attempt failed — isolated via a direct `signInWithPassword()` API call
  (succeeded immediately) to a gap in this task's OWN test setup, not a product bug — a raw
  Admin-SDK-created user has no matching `clients` row, which `login.html` requires; (2) a
  genuine product bug — `reset-password.html`'s two "Go to Login" links dropped
  `?env=staging` (the exact param-loss class already fixed once in `admin-sidebar.js`/
  `dashboard-sidebar.js`, never applied to this newer page); fixed with a mirrored inline
  `currentEnvQuery()`. The 3 deferred `getAdminEmails()` checks and the Unified Inbox's own
  notification check were freshly re-run (219/219 + 14/14 + 85/85, and confirmed the chat
  notification was never actually quota-blocked at any point this session).
  `verify-cloud-staging-parity.js` re-confirmed clean. One pre-existing gap from row 159
  re-encountered and left open (bigger than originally scoped): `firebase-config.js`
  statically imports 4 real `gstatic.com` specifiers the CDN loader doesn't redirect —
  the real live-site verification stands on its own regardless. Backend Requirements
  Register row 162 added.

- **★★★ Unified Communications Inbox — Stage 2: two-way email, built and verified end to
  end on the LIVE site (2026-09-07).** Real inbound receiving via a real Resend webhook
  (Svix-signature verified, hand-implemented via Web Crypto in a new
  `_shared/webhook-verify.ts`) and real outbound replies threaded via In-Reply-To/
  References, routed automatically by the conversation's own most recent message's channel
  — a new `send-conversation-reply` function now owns both channels (replacing Stage 1's
  chat-only direct insert), since a real email reply needs a real server round trip to
  Resend before the row can even be written. **A real, reported schema addition**: Gmail's
  own threading requires subject continuity alongside References/In-Reply-To — a single
  nullable `conversations.subject` column was added, captured once from the real inbound
  email that starts a thread. **Security check (point 4) confirmed**: `receive-inbound-
  email` runs entirely as `service_role`, never through RLS, so Stage 1's
  `visitor_auth_id` read-access asymmetry is structurally irrelevant to this path — a
  spoofed inbound sender can get a message written into an existing thread (the same
  generic property email has everywhere) but gains zero read access, proven directly with
  a real victim/attacker session pair. **Two real, disclosed findings along the way**: (1)
  the live site's own new UI/reply-flow additions were completely missing on first test —
  root-caused directly to the static-site changes never having been committed/pushed (Edge
  Function deploys and a git push to the static site are two separate deployment paths);
  (2) the existing `RESEND_API_KEY` turned out to be send-only and can't read received
  emails — the user created a real "Full access" key and set it as the Supabase secret
  directly, never sharing the raw value. **The complete real round trip verified live,
  exactly per this stage's VERIFY criteria**: a real cold email to `support@marketswave.net`
  created a new real conversation and genuinely appeared in the real `admin-inbox.html`; a
  real PM reply genuinely sent via Resend and arrived back in the real Gmail inbox,
  correctly grouped into the SAME thread ("me, Marketswave — 2") — real, direct proof of
  correct threading in an actual email client. Verified first at the backend/DB level, local
  stack: `scripts/verify-inbound-webhook-signature.mjs` (11/11) and
  `scripts/verify-supabase-inbound-outbound-email.mjs` (18/18, including the full security-
  check proof) — inbound delivery itself is categorically untestable locally without a real,
  publicly-reachable webhook endpoint. Full existing regression suite re-run for zero
  regression (one pre-existing, already-observed intermittent real-time-timing flake in
  `verify-supabase-unified-inbox.js`, clean on immediate retry, not a Stage 2 regression).
  `verify-cloud-staging-parity.js` re-confirmed clean (15/15 migrations, 49/49 functions).
  All real test artifacts deleted afterward. Backend Requirements Register row 163 added.
- **★★★ PM Compose Email + Company Announcements, built on Stage 1-2's own conversation
  model (2026-09-07).** Extends `send-conversation-reply` (never a parallel function) with a
  real compose mode (`clientId`+`subject` in place of `conversationId`) and adds a new,
  deliberately separate `send-announcement` for bulk sends — an announcement genuinely isn't
  a conversation, per instruction, so it never touches `conversations`/`messages` at all.
  **Both UI-location judgments landed inside `admin-inbox.html`**, not a separate page —
  compose agreeing with the user's own stated instinct (this inbox already handles exactly
  this, and a composed email genuinely IS the start of a thread that should appear there);
  announcements as a second tab in the SAME "New Message" modal, the agent's own call, since
  this inbox is where ALL outbound PM email intent lives, whether or not the result becomes
  a conversation. New shared `_shared/conversations.ts` (`findOrCreateConversation()`)
  extracted from `receive-inbound-email`'s own original inline logic, reused by both that
  function and compose. `footerType` is an explicit parameter on both functions (defaulting
  to `general`, an explicit UI radio choice at send time, never inferred) — recommended and
  built as a real override for announcements too, since a genuine investment-related
  announcement needs the real risk paragraph exactly like any other investment
  communication. **Real recipient filters** (status/accountType, mirroring
  `admin-clients.html`'s own pattern) — no manual address entry anywhere. **Real batching**:
  Resend's Batch Send API (100/call) with a 400ms inter-chunk delay, comfortably under the
  real confirmed 10 req/s account-wide limit, plus a real retry-once-after-`retry-after` path
  on an actual 429. **Reply-to-announcement confirmed, not assumed**: a reply has no prior
  conversation (announcements create none), so `findOrCreateConversation()` correctly falls
  through to its CREATE branch — the identical path a cold sender takes, zero
  announcement-specific logic anywhere. **A real bug found and fixed live during the
  human-confirmed real-inbox verification step, disclosed not silently patched**: composing
  to a contact with an ALREADY-EXISTING conversation (grouping correctly reused the thread)
  silently sent the real email under the conversation's OLD stored subject instead of what
  the PM had just typed — `findOrCreateConversation()`'s own "backfill subject only if
  missing" rule is correct and unchanged, but the subject-for-the-real-email computation was
  reading `conversation.subject` instead of the PM's fresh `composeSubject`; the earlier
  local regression run never caught this since no test both composed twice to an
  already-grouped contact AND checked the real `email_log.subject`. Fixed by hoisting
  `composeSubject` to the real subject-for-email computation unconditionally in compose mode
  — confirmed via a real second live send against staging showing the correct subject, and
  permanently locked in as a new regression assertion. **Verified**:
  `scripts/verify-pm-compose-announcements.mjs` (48/48 — validation/auth on both functions,
  real `@invalid.test`-safe sends, footerType propagation proven via a real static-code
  assertion since the local `RESEND_API_KEY` turned out send-only (a real 401 from
  `GET /emails/{id}`), real grouping + the subject-line regression lock, a real DB-level
  reply-threading proof mirroring Stage 2's own technique, real filter inclusion/exclusion
  via `email_log`, the no-conversation-for-announcements guarantee, and a real >100-recipient
  chunk-boundary batching proof — 105 real synthetic clients, a real elapsed-time proof that
  2 real `/batch` calls genuinely fired, 105 real `email_log` rows each with its own distinct
  real `resend_id`) and a new `scripts/verify-pm-compose-ui-wiring.mjs` (22/22 — the REAL,
  unmodified `admin-inbox.html` inline script driven through real jsdom DOM events: modal
  open, real async client search/select, a real send producing a real "Message Sent" toast
  and a real Postgres row; the Announcement tab's real filter-driven recipient-count preview,
  the real two-step Send-then-Confirm-and-Send gate including a real Cancel, and a real send
  producing a real "Announcement Sent" toast with real per-recipient inclusion/exclusion). Full
  existing regression suite re-run for zero regression. Deployed to real cloud staging:
  `send-announcement` plus every one of the 25 already-deployed functions importing the
  changed `_shared/send-email.ts`/`_shared/conversations.ts` (avoiding the same stale-bundle
  risk already learned once for `_shared/portfolio-engine.ts`), then a second redeploy of
  `send-conversation-reply` alone after the live-caught subject-line fix —
  `verify-cloud-staging-parity.js` reconfirmed clean both times (15/15 migrations, 50/50
  functions). **Real end-to-end proof, human-deliverable**: two real composes (footerType
  investment, then general after the fix) genuinely delivered to the user's own real Gmail
  inbox, correctly grouped into a real pre-existing conversation from an earlier Stage 2
  session; a real 3-recipient announcement sent to 3 genuinely distinct real addresses under
  the user's own control (Gmail plus-aliasing, disclosed as the technique used), all 3
  delivered with distinct real `resend_id`s. **A real production-safety step taken before
  sending**: the real staging `clients` table was queried first and found to hold 4 real
  production users, all `Individual Account` — the 3 real test recipients were deliberately
  set to `Business Account` first, confirmed as the only clients with that type, guaranteeing
  the test could never reach a real production user by filter overlap. **A second real bug
  found and fixed during cleanup, in the verification script's own logic, not the app**:
  `deleteUser()` resolves `{data, error}` rather than rejecting, so a `.catch()`-only cleanup
  silently "succeeded" while a real FK reference (from the pre-existing conversation's
  `client_id`, legitimately set by the compose calls) actually blocked the delete — caught by
  an explicit post-delete existence check, fixed by resetting that FK to its real, correct
  pre-task `null` state first. All real test artifacts reconfirmed genuinely deleted, not
  assumed; the real staging `clients` table reconfirmed back to its exact 4 production rows.
  Backend Requirements Register row 164 added.
- **★★★ Real bug found and fixed on the live site: invisible admin-inbox.html buttons
  (2026-09-07, same day as row 164, found by the user immediately after that push).**
  Investigated before fixing, per instruction. Deployment was confirmed NOT the cause (the
  live `admin-inbox.html` was byte-identical to local, freshly served). The real cause,
  confirmed live in the actual browser: `#new-message-btn` genuinely existed, was laid out
  correctly, and was the real topmost element at its own coordinates — yet its real computed
  `background-color` was `rgba(0, 0, 0, 0)`, fully transparent, with white text — invisible,
  not absent. `bg-navy`/`hover:bg-navy-dark`/`focus:ring-navy` are custom Tailwind colors that
  only exist where a page's own inline `tailwind.config` defines them (every client-facing
  dashboard page does; no admin page ever has, per the locked distinct-palette rule) — the
  Tailwind CDN's JIT compiler doesn't error on an unrecognized color, it silently emits no CSS
  at all, making this bug class genuinely silent. **Confirmed pre-existing, not introduced by
  this task's own compose modal**: the original Stage 1 `#thread-reply-send` ("Send") button
  used the identical pattern and showed the identical transparent background — this bug
  predates row 164, which simply copied the same already-broken pattern into 2 more buttons.
  **Fix scope confirmed via a project-wide grep, not assumed limited to one button**:
  `admin-inbox.html` was the only file among all 16 admin pages + `admin-sidebar.js`
  referencing navy/cream in a real class position — all 8 real occurrences fixed to the admin
  tool's own real, working scheme (`bg-slate-900`/`hover:bg-slate-800` matching the
  already-correct Resolve button; `focus:ring-amber-500/30 focus:border-amber-500` matching
  the exact pattern already used 30 times across `admin-clients.html`/`admin-deposits.html`/
  `admin-products.html`). **The reverse direction investigated and confirmed structurally
  safe, not just asserted**: every client-facing page's own `tailwind.config` consistently
  uses the safe `theme.extend.colors` form (adds navy/cream on top of the default palette),
  never a destructive bare `theme.colors` that would strip slate/amber/etc. — confirmed via
  grep across all 10 pages, not currently a real risk anywhere in the project. **Preventative
  measure, built not proposed**: new `scripts/verify-tailwind-color-scoping.js` — a standing,
  zero-dependency static check for both directions, verified to genuinely catch the exact
  regression (reintroduced `bg-navy` into a throwaway copy, confirmed a real FAIL, reverted,
  confirmed clean PASS) — added as a new standing convention alongside
  `verify-cloud-staging-parity.js` in the Working Conventions section below. **Browser-verified
  live on marketswave.net after pushing**, with a fresh real temporary staging PM account:
  every fixed button's real computed background is now `rgb(15, 23, 42)` (real slate-900,
  matching Resolve byte-for-byte), and the Subject input's real focus ring genuinely paints
  amber (`rgba(245, 158, 11, 0.3)` box-shadow, confirmed via the actual injected Tailwind
  stylesheet rule firing, not assumed from the class name). A real screenshot confirmed every
  affected button as solid and legible for the first time. Backend Requirements Register row
  165 added.
- **★★★ Five RareUI-referenced animated components adopted via Motion (2026-09-08).**
  Motion is the vanilla-JS core formerly bundled under "Framer Motion" — the React library
  kept that name, the framework-agnostic core is now just "Motion" (motion.dev). **Investigated
  first, per instruction**: confirmed the real current CDN build via a live jsDelivr fetch —
  `https://cdn.jsdelivr.net/npm/motion@13.2.0/dist/motion.js` (pinned), a real global UMD
  build exposing `window.Motion = { animate, scroll, stagger, inView, hover, press, ... }`
  (confirmed by reading the real bundle's own UMD header/exports directly). Real bundle size:
  140,491 bytes uncompressed / 46,763 bytes gzipped — smaller than Chart.js (69,693 bytes
  gzipped, already accepted on 2 pages) — loaded only on the ~15 pages that actually use one
  of the 5 components, never globally. Coexists cleanly with Tailwind CDN + Chart.js (three
  independent UMD builds, no shared globals). New shared `motion-helpers.js` reuses
  `home-motion.js`/`services-motion.js`'s own established convention exactly, per instruction
  — check `prefers-reduced-motion` once, suppress ENTIRELY when set (never a degraded
  motion), 200-500ms general range (the pre-existing 900ms stat-counter exception carried
  forward, plus one new reported exception below). **1. Counter**: `animateStatCounters()`
  now delegates to `MotionHelpers.countUp()` (Motion's own `animate(from,to,{onUpdate})`
  plain-number overload) instead of a hand-rolled rAF loop; applied to `dashboard.html`'s
  Total Portfolio Value/Asset Returns (genuine one-time-per-load reveals) — **Market
  Snapshot's real quotes were deliberately excluded** (periodically-cached, not truly live;
  counting up on every load would misleadingly imply real-time updates — the exact "gimmicky
  on live data" case flagged in the task). **2. Notification Bell**: the real aggregation
  logic in `dashboard-notifications.js` is completely untouched — only `openPanel()`/
  `closePanel()` (a real Motion fade+scale, gated on a real `.finished` promise before hiding)
  and a one-time attention wiggle fired only when the very first mount-time fetch discovers
  genuinely unread items. **3. Scroll Progress**: the canonical `scroll(animate(el,
  {scaleX:[0,1]}))` pattern on `index.html`/`services.html`/`resources.html`/`about.html`
  only — the dashboard's own fixed-height internally-scrolling `<main>` was investigated and
  excluded as a poor fit. **4. Step Player**: `signup.html`'s `showStep(step, direction)`
  animates the newly-active panel's entrance (direction-aware ±16px slide + fade) — the real
  class-toggle logic that decides WHICH step shows is byte-for-byte unchanged, confirmed via
  direct instrumentation of the exact `x` offset per direction. Drove the REAL, complete
  7-step signup flow end to end (including the Entity/Joint step-skip logic, real file
  uploads, real validation) to a genuine `thank-you.html` landing and a real new `clients` row
  — a real, disclosed environment incident along the way (the tab froze on a pre-existing,
  unrelated `alert()` in `showError()`, triggered by two agreement checkboxes not actually
  registering at a stale zoom level — root-caused, not a Motion bug, resolved by re-driving
  the flow correctly). **5. Delete Button**: investigated first — a project-wide grep found
  `documents.html`'s own "Remove" is the ONLY genuinely destructive action anywhere in the
  project (the entire admin tool has zero delete capability; every "Reject" keeps its record
  per the locked "never silently delete" principle, so it doesn't qualify). Rebuilt
  `#remove-confirm-submit` as a real press-and-hold (a 1200ms progress-fill overlay — a
  deliberate, reported exception to the 200-500ms range, since a shorter hold would be
  indistinguishable from an accidental click) with full keyboard support (Enter/Space) and a
  clean early-release cancel; falls back to the exact original single-click behavior when
  Motion/reduced-motion say no, checked fresh on every click. **Verified live for all 4 real
  scenarios with direct Postgres confirmation each time**: quick click doesn't delete, a full
  hold does (caught mid-progress in a real screenshot), early release cancels cleanly, and the
  reduced-motion fallback deletes on a single click. Full existing regression suite re-run for
  zero regressions across every affected area (documents/HYS/dashboard/inbox/asset/funding/
  settings/admin suites, golden-path), plus `npm run verify-tailwind-color-scoping` reconfirmed
  clean both mid-task (at the user's own request, since Motion work touches interactive
  elements across both tools) and at the end. All real test artifacts deleted afterward.
  Backend Requirements Register row 166 added.
- **★★★ `signup.html` full-page redesign — centered card replaced with a persistent dark step
  rail + glass form panel, floating-label inputs, redesigned buttons, built against an
  approved mockup, all real Supabase submission logic preserved (2026-09-08).** Read the real,
  live 1557-line implementation fully before changing anything, per instruction, plus
  `styles.css`'s `.access-value-panel` (the Get Access modal's own opaque navy-gradient
  recipe, explicitly named as the rail's reference — deliberately not `.glass-dark`, since
  `.access-value-panel` is opaque specifically because of this project's own earlier
  contrast-audit finding that glass-over-blurred-backdrop measured as low as 1.86:1) and the
  full `glass-primitives.css` catalog. **Layout**: `.signup-card`'s scroll-inside-a-card
  container removed entirely — the page itself scrolls. New `.signup-shell`
  (`300px 1fr` grid) holds `.signup-rail` (the exact `.access-value-panel` gradient, composed
  via existing `--primary`/`--primary-dark` tokens, not forked) and `.signup-panel.glass`.
  The rail's step list is rendered by a new `renderRail()` called from the EXISTING
  `updateProgress()` (which `showStep()` already calls on every navigation) — driven by the
  same `currentStep`/`getVisibleSteps()` state powering the step panels, not a parallel
  implementation, directly per instruction. Responsive: `@media (max-width: 900px)` collapses
  to one column, rail moves above the form (`order: -1`), step list becomes a horizontal
  `overflow-x:auto` dot strip with labels/reassurance-footer hidden — verified via a real
  injected `<iframe>` at 817px CSS width (`resize_window` again confirmed not to move this
  environment's real viewport). **Inputs**: 18 real text/select fields across steps 2-6
  converted to a new `.fld` floating-label pattern — real `<label for="...">` elements paired
  with a matching `id` added to every field that lacked one, label reordered as the input's
  own next sibling (required for the `:not(:placeholder-shown) + label` CSS technique) —
  confirmed via a JS audit that all 18 fields keep correct `label.tagName === 'LABEL'` +
  `for === id` association, so screen readers announce them exactly as before. Selects and
  the date input (`.fld--static`) keep their label permanently floated instead of the dynamic
  trick, since `:placeholder-shown` doesn't apply to `<select>` and is unreliable for
  `type="date"` — investigated and reported, not guessed. The mockup's currency-prefix
  baseline-fix (`.fld.fld-money .pfx`, visible only once the label has floated) is built and
  ready but confirmed applied nowhere in the real markup — no real signup field is a
  free-text currency amount (`investable_assets`/`source_of_wealth` are tier-selection
  `.choice-grid` cards, untouched). **A real, disclosed automation finding**: a first-pass
  JS-only `.focus()` check returned false negatives (`document.hasFocus() === false` in the
  CDP tab, so `:focus` correctly didn't match per spec even though `activeElement` was
  correct) — re-verified via a real mouse click (which does grant window focus), confirming
  the float-on-focus mechanism works correctly for a real user; recorded so a future session
  doesn't misdiagnose the same artifact as a CSS bug. **Buttons**: every `.btn`/`.btn-primary`/
  `.btn-back` instance replaced with new page-scoped `.signup-btn`/`.signup-btn-next`/
  `.signup-btn-back` classes — confirmed via grep first that `.btn`/`.btn-primary` are real
  shared GLOBAL classes used across 11 other pages, so they were never modified, only stopped
  being used here; both new classes share equal height/min-width, Continue solid navy with a
  hover-translating chevron, Back a lighter outlined/muted treatment with its own chevron.
  Confirmed every click handler is attached via `id`/`data-next`/`data-back`, never a class
  selector, so the swap needed zero JS changes. **Step count, investigated and reported**:
  `getVisibleSteps()`'s real logic makes the "9 real steps" actually 7 visible (Individual)
  or 8 (Joint/Entity) — steps 3/4 are mutually exclusive, never both — so the mockup's "7
  steps" already matches the Individual path exactly, zero real tension. Recommendation:
  keep all 9 as genuinely distinct data-collection stages (no merging — each maps to a real,
  separate compliance concern), render the rail dynamically from the live
  `getVisibleSteps()` result rather than a hardcoded count — confirmed live, Individual path
  shows exactly 7 rail items. **Verified, browser-first, against the real local Supabase
  stack**: drove the complete real 7-step Individual flow (real password-strength meter
  reaching "Strong," two real file uploads, real consent checkboxes) to a real
  `Submit Application`, landing on `thank-you.html?backend=supabase`. Confirmed via direct
  Postgres queries: a real `clients` row (`status: 'pending_review'`), a real
  `marketswave_client_onboarding:<uid>` record with every real answer from every step
  (proving `saveClientOnboardingData()`/`seedMinimalClientStores()` fired exactly as before),
  and a real `email_log` proving `notify-new-client-application` genuinely fired to both real
  local PM accounts. **A real, disclosed correction to the task's own VERIFY wording**: "real
  Storage objects" doesn't apply — `collectOnboardingData()`'s upload handling (unmodified)
  has only ever stored a filename + fixed document-type label locally, never real bytes to
  Supabase Storage; real byte storage belongs exclusively to `documents.html`'s own
  post-login upload flow, a structurally separate feature this page has never touched.
  `prefers-reduced-motion` inherited unchanged (`showStep()`'s own Motion-gated transition,
  already verified correct in the prior Motion task, untouched here). Regression:
  `npm run verify-tailwind-color-scoping` clean; `supabase-golden-path-regression.js`
  `PASS (16/16 steps)` — the remaining ~35 domain-specific scripts (HYS/documents/admin
  queues/email/inbox) were judged not warranted for a page-scoped visual redesign touching
  zero schema/functions, and were not run — disclosed rather than silently claimed. All real
  test artifacts deleted afterward, confirmed via re-query. Backend Requirements Register row
  167 added.
- **★★★ `thank-you.html` redesigned to match the rebuilt signup page — reassuring final
  screen, real gentle success animation, honest content with zero invented SLA
  (2026-09-08).** Read the real, live pre-redesign file fully first (already a small
  `.glass`/blob/grid-overlay page from an earlier visual-treatment task). **Investigated the
  existing "1–2 business days" claim, per instruction, before writing new copy**: grepped
  the whole project for any real stated SLA — found exactly two, both for the unrelated
  Support-ticket domain (`contact.html`/`support.html`'s own "reply within 1 business day"),
  and confirmed via `engine-core.js`/every Edge Function that Client Application Review has
  no tracked queue metric or automated timer at all — a manual, PM-triggered action, no real
  SLA behind it. The old figure was invented and dropped, replaced with honest,
  timeframe-free language ("We don't have a fixed timeframe to share..."). **Visual**:
  reuses the exact `.glass`/`.grid-overlay`/`.blob` primitives already on the page; new
  `.ty-kicker`/`.ty-title`/`.ty-lead` mirror signup.html's `.step-kicker`/`.step-title`/
  `.step-lead` font-size/color values exactly (each file keeps its own locally-scoped
  `<style>` block, matching this project's established per-page-duplication convention);
  new `.ty-btn`/`.ty-btn-primary`/`.ty-btn-secondary` mirror signup.html's own button recipe
  rather than touching the shared global `.btn`/`.btn-primary` used by 11 other pages.
  **Content, no personal data**: confirmed the page reads zero session/localStorage/
  query-param state — a confident headline, a genuine two-item "what happens next"
  (PM review, then an email either way), an explicit "email is the only notification
  channel" note, and two real CTAs ("Return to Homepage" → index.html, "Learn How It Works"
  → resources.html, confirmed to exist). **A real bug found and fixed during verification,
  not shipped broken**: the first checkmark implementation used an SVG `stroke-dashoffset`
  "drawing" animation — direct instrumentation (`getAnimations().length`, awaiting
  `controls.finished`, comparing against a proven-working `opacity` animation on the same
  element) confirmed this Motion CDN build silently no-ops on `strokeDashoffset`
  specifically (no error, promise resolves, but the value never actually changes) — a real
  capability limit of this build for that property, separate from the tab-visibility
  throttling this project has hit before (also genuinely present here, `document.hidden`
  confirmed `true` at one point, but not what was actually blocking this specific
  animation). Rebuilt using a proven-working `opacity`/`scale` fade+pop instead (confirmed
  via a genuine mid-transition read at 120ms showing partial progress, not an instant
  snap), gentle rather than celebratory. Reduced-motion/Motion-unavailable path leaves both
  elements with zero inline style overrides (confirmed via `getAttribute('style') === null`)
  — their normal, fully-visible default state, never a half-drawn artifact. **Verified,
  browser-first**: normal viewport, a real 390px narrow viewport via injected iframe (zero
  overflow, CTAs stack full-width), and a REAL complete signup flow driven end to end
  landing on the redesigned page with the correct new content, cross-checked via a direct
  Postgres query showing the genuine new `clients` row. **A real, disclosed local-dev-server
  caching artifact hit during verification, not a product bug**: the first end-to-end
  attempt landed on a stale cached copy from an earlier same-session test load
  (`http-server -s`'s own `Cache-Control: max-age=3600`) — re-run against a freshly-started
  server with caching disabled confirmed the real redirect and content are both correct;
  specific to repeated same-session local testing, no bearing on a real first-time visitor
  or production hosting. Direct-URL access re-confirmed to render identically, since the
  page depends on no session state. Regression: `npm run verify-tailwind-color-scoping`
  clean; `supabase-golden-path-regression.js` `PASS (16/16 steps)`, unaffected (no schema/
  function changes). All real test artifacts (two `clients` rows across both verification
  passes, their Auth users, email_log rows) deleted afterward. Backend Requirements
  Register row 168 added.

- **★ Mobile Usability Audit — Stage 1 (2026-09-08, row 169) — a real, complete 393-line audit
  document that had no CLAUDE.md entry or register row at all until now.** `MOBILE_AUDIT.md`
  (project root) is a report-only sweep of the public site, the client dashboard and the admin
  tool at 320/375/390/768px, using real DOM measurement plus real screenshots rather than
  assumption — going well beyond the horizontal-overflow-at-390px checks earlier verification
  passes covered. **24 findings: 4 broken, 14 bad, 6 minor**, grouped into 7 systemic findings
  (S1–S7, one root cause recurring across many pages) plus page-specific ones. The headline
  items: S1 (public site header overflows every marketing page), S3 (notification bell dropdown
  renders off-screen, truncating every line — the worst single finding), S2 (off-canvas drawer
  close buttons at 20×20px on BOTH the client and admin tools), S5 (modal close buttons
  undersized everywhere checked), S4 (filter bars/row actions/card actions consistently
  36–40px). It also records a genuine bright spot: the just-redesigned `signup.html` is the
  strongest page in the project by this standard. **This entry exists because the audit itself
  was undocumented** — a future session reading only CLAUDE.md would not have known the file
  existed, let alone that most of its findings are still open. **S1 and S3 are now fixed (row
  170); every other finding in that document is still open** and is the natural source for a
  Batch 2.
- **★ Mobile fixes — Batch 1: S1 (public site header overflow) + S3 (notification dropdown
  off-screen) (2026-09-08, row 170).** Closes the two BROKEN findings from row 169's audit.
  **This task was interrupted mid-flight by a machine freeze and resumed in a later session** —
  the recovery found `styles.css` + `site-nav.js` written and 6 of 8 marketing pages edited in
  alphabetical order, cut off exactly between `legal.html` and `resources.html`, with S3 not
  started at all. **Nothing done before the freeze had ever been verified, and verifying it is
  what found the two real bugs below.**

  **S1.** Below 960px "Contact" moves out of the header bar into a real mobile nav drawer;
  "Get Access" stays. New `site-nav.js` (loaded by all 8 marketing pages, same self-invoking
  convention as `home-motion.js`) provides toggle/outside-click/Escape/link-close and the
  hamburger→X transition — **confirmed via project-wide grep that `.nav-toggle` had never had
  ANY JS wired to it anywhere in the project, so it did literally nothing before this**. The
  toggle is now a real 44×44px target (was ~38×42). **A real cascade bug found by verification,
  not by reading the code:** `.header-actions .site-header-contact { display: none }` MATCHED
  but never APPLIED — a SECOND, later `.header-actions .btn` rule (line ~1946, the one that
  actually sizes these buttons to 132×38, genuinely load-bearing, NOT a dead duplicate) has
  identical specificity (0,2,0) and, coming later, silently won. Fixed by qualifying with the
  element type — `.header-actions a.site-header-contact` (0,2,1) — which wins regardless of
  source order, so a future appended block cannot quietly re-break it. **Third instance of this
  project's own duplicate-CSS-block-wins-the-cascade bug class** (cf. the deleted `.hero`
  duplicate, contact.html's own). **A second real finding: hiding Contact alone was not enough
  at 320px** — the header still needed 147.5px logo + 118px "Get Access" (its own `min-width`
  floor) + 44px toggle = 309.5px against 272px available, so a `@media (max-width: 480px)`
  block (reusing styles.css's own already-established breakpoint) now lets the logo, the button
  and the header's own padding each give a little; all three selectors are
  `.site-header`-qualified (0,3,0) for the same specificity reason. **A third finding, beyond
  the header and disclosed rather than silently absorbed:** three `repeat(auto-fit, minmax(Npx,
  1fr))` grids (`.service-grid` 320px, `.strategy-grid` 340px, `.team-grid` 240px) force a
  track wider than a 320px viewport's content box — guarded with the standard
  `minmax(min(Npx, 100%), 1fr)` idiom, byte-identical behaviour at every wider width.

  **S3.** Root-caused to exact geometry rather than assumed: the panel is `absolute right-0`
  inside the bell's own `relative` wrapper, so its right edge is pinned to the BELL, not the
  viewport, and the bell sits ~104px in from the right edge (header `pr-8` + the Logout link +
  `gap-4`) — a 320px panel anchored there starts at 375−104−320 = **−49**, exactly the audit's
  measured value. **The panel already carried `max-w-[90vw]`, which is why a width cap alone
  would never have worked**: 90vw is 337px at 375px, LARGER than the panel's own 320px, so it
  never applied — the constraint had to come from position. Below 480px the panel is now
  `position: fixed` with symmetric 1rem gutters and `top: 4.5rem` (the 64px `h-16` header,
  confirmed byte-identical on all 10 pages that mount the bell, + the same 8px gap `mt-2` gave
  it). **Delivered as a real injected `<style>` from `dashboard-notifications.js` rather than
  Tailwind responsive utilities, deliberately** — this project has a documented silent failure
  mode where the Tailwind CDN emits NO CSS for an unrecognised utility (row 165); plain CSS
  cannot fail that way, and ID specificity beats the utility classes already on the element so
  it needs no `!important` and is insensitive to load order. Injecting its own styles mirrors
  this component's own "shared component injects its own markup" precedent.

  **Item 3, investigated and the audit corrected:** S1 listed `login.html` as "near-certain" to
  share the overflowing header. **Directly disproved** — `login.html`/`reset-password.html` use
  a completely different `.login-topbar` and contain no `.site-header`/`.main-nav`/
  `.header-actions`/`.nav-toggle` at all; `scrollWidth` equals the viewport exactly at all three
  widths on them plus `signup.html`/`thank-you.html`. No fix needed or applied. One NEW minor
  finding was recorded instead (logged in MOBILE_AUDIT.md as A1, deliberately NOT fixed here as
  cosmetic and out of scope): at 320px their wordmark and "← Back to site" button sit with a
  **0px gap** and the button label wraps to two lines. An initial read of the screenshot
  suggested the button was overlapping and obscuring the wordmark; **direct measurement
  disproved that** (logo ends 184.2, button starts 184.2) — cramped, not broken.

  **Verified with real browser screenshots at real viewports.** No browser automation tool was
  available (checked, not assumed), so headless Chrome was driven over CDP — this project's own
  established technique. **A real harness trap was hit and disclosed rather than trusted:** the
  first run reported a clean PASS on every page at "375px" while
  `Emulation.setDeviceMetricsOverride` was silently clamping the viewport to 492px, so nothing
  narrow was ever actually tested — the same false-signal class row 135 documented for Chrome's
  `--window-size`. The floor is 348px on this build in BOTH headless modes regardless of
  `--window-size`; 375/390/1440 are exact real top-level viewports, and 320px uses a real
  same-origin iframe (the technique rows 83/93/100/101 already established), disclosed rather
  than presented as a top-level viewport. **S1: 240/240** — real `scrollWidth` equals the real
  viewport on all 8 marketing pages at 320/375/390, no desktop regression at 1440, drawer
  open/Escape/`aria-expanded`/hamburger→X confirmed. **S3: 65/65** against a REAL signed-in
  client (real sign-in through the actual `login.html` form) with 8 REAL seeded notifications —
  every row on-screen at every width, `fixed` below 480px and `absolute` at 1280px. **The
  screenshot is the actual proof**: at a real 320px viewport every line now reads from its first
  character ("Allocation request pending: Cash — $25,000"), versus the audit's "...ications" /
  "...ew document:". **Auth pages: 12/12.** Full regression suite re-run green (all 7 core
  Supabase suites, all 6 client UI-wiring suites, all admin/PM/inbox/email suites,
  `verify-tailwind-color-scoping` PASS, `supabase-golden-path-regression.js` PASS (16/16), cloud
  staging parity OK 50/50 — unchanged, since this task touched no migration or Edge Function).
  **One suite failure was investigated and proven to be this task's own test-data pollution, not
  a regression** — `verify-supabase-documents-support.js` asserts exactly 2 rows share
  `DISP-0001`, and the S3 seed client added a third; PASS again immediately after cleanup. The
  known intermittent Realtime-timing flake in `verify-supabase-unified-inbox.js` recurred and
  was clean on retry. All real test data (client, auth user, documents, support and allocation
  rows) and every temp script were removed afterward, confirmed by direct query.

- **★ Mobile fixes — Batch 2: the systemic tap-target findings S2, S4, S5, S6, S7 + A1
  (2026-09-08, row 171). ALL 7 SYSTEMIC FINDINGS (S1–S7) FROM THE MOBILE AUDIT ARE NOW
  CLOSED.** Target throughout: a real rendered hit area of at least 44×44px, reached by
  padding rather than by making anything visually bigger — every glyph and label keeps its
  original size.
  **New shared `tap-targets.css`**, linked on exactly the 26 pages that already load
  `glass-primitives.css` (the 10 client dashboard + 16 admin pages — verified to be an exact
  set match, not an approximation). Public-site equivalents live in `styles.css` and the chat
  widget's own close button in `chat-widget.css`, because those two files are loaded on pages
  `tap-targets.css` is not.
  **★ S4's central premise was wrong, and correcting it changed the shape of the fix.** The
  finding hypothesises "a single shared Tailwind sizing convention" to bump. Investigated
  before writing anything: there is no such class — the 36/38/40px cluster comes from ~40
  DISTINCT repeated utility strings (`px-3 py-1.5 text-xs`, `px-4 py-2 text-sm`, …) on
  unrelated elements across unrelated pages. The instinct that it was one convention rather
  than N mistakes was right; the assumption that it was expressed as a class was not. So the
  fix is keyed on what those controls genuinely share — being buttons and form controls —
  via one `min-height: 44px` rule over `button`/`[role=button]`/`select`/`textarea`/`input`
  (checkbox and radio excluded: their real target is the surrounding label), plus
  `min-width: 44px` for buttons only. A `min-height` constrains the USED value after `height`
  resolves, so it beats a Tailwind `h-*` utility regardless of specificity and cannot be
  silently out-cascaded. Anchors are deliberately excluded from that rule (a blanket
  `a { min-height }` would inflate every inline link in body copy); a separate `a.flex,
  a.inline-flex` rule covers only anchors the design has already made flex boxes — the
  structural signal that an anchor is acting as a control — which caught the sidebar nav
  links, "Deploy Capital" (223×40) and "Back to Asset & Performance" (217×20), none of
  which the audit had listed.
  **★ S5 was 37 controls, not 4.** A project-wide grep found dismiss controls on every admin
  queue modal, both drawers, the toasts, the chat widget and asset-collection's popup. They
  share no class and no common aria-label but DO share a naming convention (every id ends in
  `-close` or `-close-btn`), so the rule matches structurally rather than enumerating 37 ids,
  and a future modal following the convention inherits the minimum with no further edit.
  **★ A REAL CASCADE FAILURE WAS CAUGHT BY VERIFICATION — the FOURTH instance of this
  project's duplicate-CSS-block-wins-the-cascade bug class.** The Get Access modal rule was
  added to styles.css ABOVE that file's existing `.access-modal-close { width: 36px }`.
  Identical specificity (0,1,0), later rule wins — so it matched and did nothing, and the
  first verification run still measured a real 36×36. Fixed by qualifying it as
  `button.access-modal-close` (0,1,1), which wins regardless of source order. This is exactly
  why every assertion in this batch reads a real computed box instead of trusting that CSS
  was written, and it is the third batch running in which that discipline has paid for itself.
  **Two `display` traps handled explicitly, both of the "rule matches but does nothing"
  kind**: (1) `min-height` is IGNORED on a non-replaced inline box, so the header Logout link
  (S7) and the public footer links (S6) — both plain inline `<a>` — get an explicit
  inline-flex/inline-block display alongside the minimum, never a bare min-height; (2)
  `display` is deliberately NOT overridden on `<button>`, because browsers already centre a
  button's content vertically and forcing a display would fight the `flex`/`w-full`/`hidden`
  utilities those buttons already carry, with no way to hand a Tailwind value back afterwards
  (`revert` returns the user-agent default, not the utility's value) — an early draft that
  tried it was caught and removed before it shipped.
  **S7's class hook is applied at runtime, not per page**: `dashboard-sidebar.js`'s EXISTING
  `wireLogoutLinks()` already locates the client Logout links by their text to wire their real
  sign-out behaviour, so it now also tags them `.mw-tap-logout` — one definition of "which
  element is the logout link" instead of a hand-added class on 10 pages that could drift.
  **A1** got a small `@media (max-width: 480px)` block in `login.html` and
  `reset-password.html` (neither file contained a single media query before this), reusing the
  public site's own established breakpoint.
  **Everything is scoped to a breakpoint, which makes "no desktop regression" structural
  rather than something to re-check by eye**: ≤1023.98px for the Tailwind family (the app's
  own `lg`), ≤960px for the public site (its own), so each side reuses the responsive system
  it already has and above those widths not one declaration applies. The only always-on rules
  are the two drawer buttons, which are `lg:hidden` and therefore cannot reach desktop either.
  **Verified — 43/43 assertions, exit 0**, applying Batch 1's three recorded lessons
  explicitly. (a) Every assertion reads a REAL computed/rendered box, never "the CSS was
  written" — which is what caught the cascade failure above. (b) Every measurement is
  preceded by a viewport-integrity guard that throws if the browser reports a different width
  than requested, because Batch 1's first run reported a clean PASS "at 375px" while silently
  clamped to 492px; 375/390/1440 confirmed exact, and 320px again uses a real same-origin
  iframe since the top-level override still floors at 348px on this build. (c) All new CSS is
  plain CSS, and `verify-tailwind-color-scoping` PASSes.
  **The strongest single result: a full re-scan of 16 pages reports 0 controls under 44×44
  remaining**, down from 3–37 per page beforehand — measured by enumerating every
  button/anchor/select/input/textarea/[role=button] on each page rather than re-checking only
  the ones the audit happened to sample. **Desktop no-regression proven by measurement, not
  assumption**: at 1440px both media queries confirmed inactive, the drawer rules confirmed
  `display:none`, and controls re-measured at their exact original sizes (`#filter-type`
  154×37, `#apply-filters` 116×36, `#reset-filters` 71.6×38, footer link 52.8×18 still
  `display:inline` with its original 12px `li` margin). Screenshots confirmed the padding
  changes look right rather than merely measuring right.
  **Full regression suite re-run green** (all 7 core Supabase suites, all client + admin UI
  wiring suites, PM/inbox/compose/market/email suites, `verify-tailwind-color-scoping` PASS,
  `supabase-golden-path-regression.js` PASS 16/16, cloud staging parity OK — unchanged, since
  this batch touched no migration or Edge Function). **One suite failure was investigated and
  proven to be this task's own test-data pollution, not a regression** —
  `verify-admin-approval-gate-ui-wiring` asserts an exact pending count, and the Batch 2 seed
  client added real pending deposit/withdrawal rows; PASS again immediately after cleanup. The
  known intermittent Realtime-timing flake in `verify-supabase-unified-inbox.js` recurred and
  was clean on retry. All real test data was removed afterward — including a real
  `conversations` row the chat widget created when it was opened during verification, which
  blocked the auth-user delete via a foreign key and had to be cleared first (worth knowing:
  opening the chat widget as an authenticated client leaves a real row behind).

- **★★ Mobile fixes — Batch 3: the remaining page-specific findings (2026-09-08, row 172).
  EVERY FINDING IN MOBILE_AUDIT.md IS NOW RESOLVED** — all 7 systemic (Batches 1–2) plus all
  page-specific (this batch), closing the audit out entirely.
  **★ The headline change: wide data tables become CARDS at narrow widths, not a scroll cue.**
  The audit's `transactions.html` finding suggested an edge-fade; its own `admin-deposits.html`
  finding separately observed that the Approval Gate pages already solve this with cards and
  named that as the pattern to follow. **Put to the user with the reasoning; they chose cards.**
  Three things settled the recommendation: a fade only ADVERTISES that 60.4% of the content is
  elsewhere without making it reachable; **the drill-down modal the ledger already opens carries
  every one of the 7 columns PLUS three more** (Market Price, Associated Costs, Realized Return)
  — checked directly before recommending, so a summarising card loses nothing; and it could be
  done CSS-first with one render path instead of a second mobile-only one.
  New `responsive-tables.css` + `responsive-tables.js`, opt-in via a `mw-card-table` class
  (opt-in deliberately — most tables already fit, and silently restyling those would be a change
  nobody asked for). Below `lg`, each row becomes a self-labelling card.
  **★ A full sweep found FIVE MORE overflowing tables the audit never caught**, on pages it had
  only checked for tap targets: `admin-client-applications.html` (939px in 324px — the worst),
  `asset-performance.html` (744), `admin-hys.html` (716), `admin-products.html` (686),
  `admin-clients.html` (448). **The user was asked and chose to include them.** The sharpest
  consequence was on `admin-documents.html`, where the last column holds the Download / Mark
  Reviewed action — **a PM's primary action sat ~500px off-screen at x=808.9–892.4 in a 390px
  viewport**, proven by a genuine before/after in a single page load (disable only the new
  stylesheet), and now at x=248.5–332 at 83.5×44.
  **Labels are DERIVED, not hand-written**: `responsive-tables.js` copies each column's own
  `<th>` text onto the `<td>`s beneath it. Chosen over hand-adding ~50 `data-label` attributes
  across eight string-concatenated render functions — a derived label can never disagree with
  its heading, and a future column change needs no edit. A MutationObserver re-labels after each
  re-render, because every one of these tables is rebuilt on filter/refresh and a one-shot pass
  would have labelled only the first render and silently missed the rest.
  **Verified rather than assumed for the other named items** — and most turned out already
  closed by Batch 2's systemic work: `documents.html` chips 145.5×44 (were 28 tall),
  `settings.html` "Edit" 44×44 (was 22×16), "Request Change" 120.6×44, password fields 276×44,
  `asset-collection.html` "More info" 234×44 (was 150×16) and "Back to Asset & Performance"
  217×44. The ONLY named item needing this batch's own work was the settings toggle switches,
  which the audit had reasonably flagged MINOR (44×24 is the universal toggle size): resolved in
  the batch's own spirit — the SWITCH stays visually 44×24 and only its `<label>`, the element
  that actually receives the tap, grows to 44×44 with a compensating negative margin.
  **The unswept pages are clean**: `risk-management`, `deploy-capital`, `support` (client) and
  `admin-withdrawals`/`admin-sells`/`admin-support`/`admin-profile-updates`/`admin-advisory-fee`/
  `admin-security`/`admin-login` all swept at a confirmed 390px — no undersized controls, no
  overflow, no over-wide tables. `admin-login.html` checked while genuinely unauthenticated.
  **★ TWO REAL TRAPS CAUGHT, both instances of the lessons this batch was told to apply.**
  (1) **A stale-cache false negative**: the first re-sweep reported all five tables STILL broken
  with the new class apparently absent — the persistent browser profile was serving cached
  copies of the just-edited files. Had it not been chased, a batch that was already correct
  would have been reported as failing. Fixed at the harness level (`Network.setCacheDisabled` on
  every navigation), not worked around — this is now the third distinct false-signal class this
  project's verification has had to defend against, after the viewport clamp and the cascade
  trap. (2) **`clip` hides painting, not geometry**: the visually-hidden `<thead>` still reported
  its full layout width and inflated an ancestor's `scrollWidth` (383 against a 324px wrapper),
  and `width: 1px` alone did nothing because a `table-cell` is re-measured by the table layout
  algorithm — collapsed properly by also forcing `display: block` on the head cells. A third,
  smaller one: a `td` is a flex row, and cells carrying text PLUS a badge could not wrap, pushing
  the badge past the card edge — fixed with `flex-wrap: wrap` on the cell.
  **Verified**: 36/36 on the main checks, 43/43 on the card-table checks, 5/5 on the
  admin-documents action A/B — every assertion reading real computed style, every measurement
  behind a viewport-integrity guard, 375/390/1440 exact and 320px via a real iframe. A full
  re-sweep reports **0 tables still scrolling horizontally** across every client and admin page.
  Desktop no-regression proven by measurement on all seven pages (`display: table-row`, `thead`
  visible, ledger still 1118px at 1440px) plus the settings toggle back to 24px. Real
  before/after screenshots for the ledger, captured by disabling only the new stylesheet in the
  same page load so the comparison is genuinely like-for-like.
  **Full regression suite green** (all 7 core Supabase suites, all client + admin UI-wiring
  suites, PM/inbox/compose/market/email suites, `verify-tailwind-color-scoping` PASS,
  `supabase-golden-path-regression.js` PASS 16/16, cloud staging parity OK — unchanged, no
  migration or Edge Function touched). Two known flakes (`supabase-verify-pm-attribution`,
  `supabase-verify-unified-inbox`) recurred and were clean on retry. All test data removed
  afterward, conversations row included.

- **★★ Homepage Depth Pass — hero v2, section rhythm, and the project's first real media
  (2026-09-08, row 173).** Built from two approved mockups (`hero_v2.html`,
  `section_rhythm_preview.html`), matching their structure and reasoning rather than their
  pixel values, and reusing this project's own locked tokens and shared primitives wherever
  an equivalent already existed.
  **HERO** — all seven layers ported: perspective grid, three drifting light fields, a live
  seeded-random-walk canvas of market curves, four floating glass data cards with SVG
  sparklines, the allocation ring, the scrolling ticker tape, SVG-turbulence grain, vignette,
  streaks, trust markers, a pulsing status dot, and JetBrains Mono on every data element.
  **The real headline / subheading / CTAs were kept** — the mockup's own placeholder copy was
  deliberately NOT carried over.
  **★ TWO HONESTY CORRECTIONS TO THE MOCKUP, both investigated rather than assumed.**
  (1) The mockup's ticker shows index values (`S&P 500 5,248.31`, `DOW 39,118.44`) that this
  project ALREADY decided it cannot legitimately source — `get-market-snapshot`'s own header
  records that Finnhub's free tier refuses index quotes, which is why it returns SPY/QQQ/DIA
  ETF proxies under honest labels. The tape now uses those real proxy labels and is captioned
  "Indicative levels". (2) The mockup's data cards carry invented performance figures
  ("+18.4% YTD Private Equity", "+9.2% Real Assets") with no data source anywhere in this
  project. On a public financial site those read as performance claims, so they were replaced
  with facts the site already states elsewhere: $350m+ AUM, 5 asset classes, 20+ years since
  2004, 6 core services.
  **★ A REAL CORRECTION TO MY OWN EARLIER RECOMMENDATION, made mid-task**: the plan (and the
  option the user picked) was to wire the ticker to live `get-market-snapshot` data. I had
  verified that function's SYMBOLS but not its auth — it is auth-gated, confirmed directly by
  calling it with only the public anon key and getting `401 {"error":"You must be signed in
  to perform this action."}`. A homepage visitor is by definition anonymous, so live data
  would need a NEW public unauthenticated Edge Function: real backend work, a deployment, and
  a public endpoint reaching third-party market APIs. Out of scope for a visual pass without
  agreeing it, so the tape ships as clearly-labelled reference data and NO fetch is attempted
  (shipping a guaranteed-401 call would waste a request and put an error in every visitor's
  console on every load). Flagged as a follow-up rather than silently dropped.
  **SECTION RHYTHM** — the agreed sequence, confirmed with the user before building because
  their sketch had 5 beats and the page has 6 content sections:
  `light → DARK → light → DARK(video) → light → DARK(photo) → footer`. Account Types became
  the extra dark beat (it is a 3-card grid — exactly the shape the mockup's own dark section
  uses — so `.glass-on-dark` drops straight in). **The video and photo sections COUNT AS the
  dark beats rather than being additional to them**, which is what keeps the page from
  stacking consecutive dark moments. Also adopted: angled SVG transitions between every beat
  (5 of them), an artifact straddling a section boundary (verified to genuinely intersect
  both), deliberately larger blobs cropped by section edges, teal eyebrows on light and mint
  on dark.
  **TWO NEW SHARED PRIMITIVES, added formally to `glass-primitives.css`** the same way
  `.glass-dark` and `.glass-slate` were, not forked: **`.glass-on-dark`** (the fifth variant —
  a low-alpha white lifted OFF a dark background; none of the existing four work, since
  `.glass`/`.glass-subtle` are light-toned with dark text and `.glass-dark`/`.glass-slate` are
  ~90% opaque sidebar panels, not translucent cards) and **`.blob--xl`** (720px, so blobs are
  genuinely cropped by section edges rather than politely contained).
  **MEDIA** — the project's first real video and photograph. ffmpeg was not installed; it was
  added via winget with the user's agreement. Video: 2048×1080 30fps .mov → 1280 wide, 24fps,
  audio stripped, H.264 CRF 26 + VP9 CRF 34. **8,408 KB → 1,503 KB MP4 / 1,432 KB WebM (82%
  smaller, well under the ~2MB target)** — the first pass at CRF 30 came in at 920KB, and the
  headroom was deliberately spent on quality because abstract gradient footage bands badly
  when over-compressed. Photo: 5442×2958 → responsive 768/1280/1920 in WebP + JPEG,
  **6,576 KB → 210 KB at the largest WebP (96.8% smaller**, target was under 400KB).
  **REAL PAGE WEIGHT, measured from the Performance API's `transferSize`** (not
  `encodedDataLength`, which reports only headers and read ~0.2KB for everything on the first
  attempt): **desktop 1,940 KB · mobile 390px 358 KB · desktop + reduced-motion 507 KB.** The
  video is genuinely never fetched on mobile or under reduced motion — the `<video>` ships
  with no `<source>` at all and JS only attaches one above 900px with motion allowed — and the
  responsive photo correctly serves the 768px WebP (60.8 KB) to a phone rather than the 1920.
  **CONTRAST — 19/19, every text-over-media and text-on-dark surface, measured on REAL
  COMPOSITED PIXELS.** This needed a new technique and the first two attempts were both
  wrong, which is worth recording: a `getComputedStyle` composite is meaningless on this page
  because every dark surface paints with a gradient or real media and has NO
  `background-color` to read — it produced impossible 1:1 readings. The working method hides
  the glyphs, screenshots the page, and samples the actual rendered pixels behind the text.
  **Three real bugs in that harness had to be fixed before the numbers could be trusted**, and
  each one had silently produced plausible-looking output: CDP's `Page.captureScreenshot`
  `clip` is in PAGE coordinates, not viewport ones, so every sample after a scroll was reading
  the top of the document; `visibility: hidden` also removes the element's OWN background, so
  a card or pill sampled whatever sat behind it instead of its own surface; and the canvas
  paint check sampled the masked-out top-left corner rather than the band the curves occupy.
  **★ FOUR REAL DEFECTS THE MEASUREMENTS CAUGHT, none visible from reading the code.** (1)
  **Navy text on navy scrims at 1.05:1** — I wrote light-text rules for `.section-dark` but
  not `.media-section`, so the video and photo sections had unreadable headings; a
  background-colour-based check could never have caught it, because a scrim over a video has
  no background-colour. (2) Four hero elements between 3.86:1 and 4.26:1 — `--text-muted`
  clears 4.5:1 on plain white but not on the hero's tinted glass; darkened to #5B6670 scoped
  to the hero, leaving the token itself and every other page untouched. (3) **The
  reduced-motion rule hid the static photograph too** — `.media-bg { display: none }` matched
  the `<img>` as well as the `<video>`, so that section lost its background entirely for
  reduced-motion users; a photo is not motion, so it is now `video.media-bg`. (4) The hero's
  `min-height: 100vh` ignored the 72px sticky header the mockup did not have, pushing the
  ticker below the fold, and the site's 1180px container left only 130px of gutter so the
  badge genuinely overlapped the $350m+ card — both measured, both fixed.
  **Verified**: 33/33 structural, 19/19 contrast, 17/17 motion+video. Reduced motion
  suppresses EVERYTHING including the canvas (confirmed drawn once and never repainted —
  identical pixels sampled 1.5s apart, no rAF loop) and the ticker (0 running CSS animations
  on the whole page). Autoplay refusal was simulated by forcing `play()` to reject, and the
  section stays a real 1112px dark beat with the poster loaded. No horizontal overflow at
  320/375/390 — the recent mobile-fix batches are not regressed. Full regression suite green,
  `verify-tailwind-color-scoping` PASS, golden path 16/16, cloud staging parity OK (no
  migration or Edge Function touched). The two 14.6MB source masters are gitignored; the
  derived assets are committed, with the exact ffmpeg/Pillow settings recorded here so the
  derivation is reproducible.

- **★★★ Homepage design round 2 — nav, seam artifacts, structure, ticker and footer
  (2026-09-08, row 174)**: built from an approved mockup and landed as five logically-grouped
  commits — backend, structure, nav, artifacts, ticker/polish.
  **New public endpoint**: `get-public-market-snapshot` is this project's FIRST genuinely open,
  unauthenticated read endpoint. It exists because the homepage ticker cannot call the
  authenticated `get-market-snapshot` — that function genuinely returns 401 to an anonymous
  visitor (verified directly, correcting the Depth Pass's own recommendation, which had checked
  the symbols but not the auth). What makes it safe is architectural: it is READ-ONLY against
  `market_data_cache` and **never refreshes it**, so no volume of traffic can reach, bill or
  rate-limit Finnhub/CoinGecko. It exposes only product/price/as-of for published NAVs — a
  deliberate, flagged widening of previously admin-gated data, with no publisher identity.
  Deployed to real cloud staging.
  **New shared module**: `supabase-endpoint.js` holds the environment resolution and both
  project configs (`LOCAL_CONFIG`/`STAGING_CONFIG`/`ACTIVE_CONFIG`), moved verbatim out of
  `supabase-config.js`, which now imports and re-exports them — so a caller that only needs the
  endpoint does not pull the whole `@supabase/supabase-js` bundle onto a marketing page.
  **Any future code needing only the project URL/anon key should import this file, not
  `supabase-config.js`.** Confirmed by real resource timing: zero esm.sh requests on the
  homepage. `verify-cloud-staging-parity.js` now reads `STAGING_CONFIG.url` from here.
  **Homepage rhythm** is now hero / stats(light) -> DARK(photo) -> light -> light ->
  DARK(video) -> light -> quiet-light -> DARK(footer). The photo moved up from the Philosophy
  CTA to the Company Pitch, so the two pieces of media ARE the dark beats rather than being
  extra to them; Philosophy is deliberately quiet (no background, panel or blobs).
  **Header** (`site-nav.js`, shared by all 8 marketing pages): transparent over the hero and
  glass past 60px, a liquid nav indicator built with NO SVG filters (an overshooting curve plus
  a travel-distance-derived stretch), and magnetic buttons. **The transparent-at-rest overlay is
  HOMEPAGE ONLY** — `.hero` exists on `index.html` alone; the other seven open with a dark
  `.page-hero` where a transparent bar would put navy links on navy. Those pages keep an opaque
  bar and gain only the scrolled glass.
  **Seven seam artifacts** (VAULT, FINGERPRINT, PLINKO, CANDLESTICK, RADAR, SNOWBALL, CHEQUE)
  each live in a zero-height `.seam-rail` BETWEEN two sections, never inside one: every
  candidate host carries `.blob-field` or `.media-section`, both of which set `overflow:hidden`,
  so anything hung off a section's own bottom edge is clipped. **Add a future artifact the same
  way** — a rail between the two sections, not a child of either. They carry no text at all; the
  mockup's illustrative figures had no source and were not carried over.
  **Ticker** alternates MARKETSWAVE (real company facts, static in the markup) and MARKETS (real
  cached prices, labelled *delayed*) roughly every 25s. Every fabricated market number the
  mockup shipped is gone, and fabricated values are never a fallback — with the endpoint blocked
  the tape shows no market symbol at all.
  Verified: 15/15 endpoint, 30/30 and 33/33 real composited-contrast probes, 55/55 header,
  57/57 artifacts, 34/34 ticker/footer/tilt. Page weight +40.6 KB against the round's own
  baseline, entirely text, no new media. See `Marketswave_Project_Handover.md` register row 174.

- **★★ Homepage design round 2, addendum — hero cards removed, Core Services rebuilt as the
  monochrome field (2026-09-08, row 175)**: two items, two commits.
  **A**: the four floating hero cards are gone, superseding the hover tilt built for them one
  commit earlier — that went with them rather than staying as dead code. The rest of the hero
  is untouched, proven by comparing every remaining layer's rendered geometry against a
  baseline captured from the previous commit.
  **B**: `index.html`'s Core Services section is no longer a six-card grid. It is a full-bleed
  light stone field (`#EEECE8`) with grain, vignette and a drifting sheen, divided into six
  vertical `.fpanel` links — each a real link to its own `services.html` anchor, carrying a
  baked contour terrain, a ghosted numeral, the exact icon its old card used, and a vertical
  name. One panel is ALWAYS open; hover or focus moves which. Interaction lives in the new
  `core-field.js`, the surface in `styles.css` section 18G.
  **Things a future session needs to know before touching it:**
  - The six terrains are **generated at build time and baked into the markup** (the generator
    is `scratchpad/build_field2.py`'s port of the mockup's own PRNG). Nothing generates them at
    runtime, and `core-field.js` is asserted to contain no generation code — do not move that
    into the browser.
  - **Greyscale is absolute except one element**: the open panel's 2px `::after` hairline, in
    that service's `--fp-hue`. A verification walks every painted colour in the section and
    fails if anything else paints one of the six hues.
  - The mockup's own `#6B6F72` failed contrast (3.88-4.16:1) once the multiply grain darkens
    the surface; `--ink-3` is `#5C6063` for that reason. Measure composited pixels, not the
    flat stone value, if you change any grey here.
  - The mobile branch keys off POINTER TYPE, not width. Headless Chrome needs
    `Emulation.setTouchEmulationEnabled` to reach it — `setDeviceMetricsOverride` alone leaves
    `hover: hover` / `pointer: fine` matching, and the first synthetic tap then navigates away.
  - `.service-card`/`.service-grid` CSS is deliberately kept: `resources.html` and
    `blog-press.html` still use it.
  Verified: 119/119 field, 41/41 hero, 39/39 real composited-contrast probes, artifacts 57/57
  and header 55/55 unchanged, console clean. See `Marketswave_Project_Handover.md` row 175.

- **★★ Homepage corrections — seam artifacts rebuilt, Company Pitch split, fonts fixed
  (2026-09-08, row 176)**: three commits, sequenced fonts -> Company Pitch -> artifacts,
  because the split moves the boundaries the artifacts sit on.
  **Fonts**: Inter 200/300 were never in the loaded subset even though the Core Services field
  asks for both, so it was rendering in a substitute face. Now requested, along with JetBrains
  Mono 700. **The Philosophy heading's Georgia serif was dropped** — it appeared exactly once
  on this page; `services.html` keeps its own `.service-title` serif because there it repeats
  six times, and a check now asserts that so a later sweep does not remove it too.
  **Company Pitch is now TWO sections**: `.approach` (dark, over the photograph, directional
  scrim, split lead, one pulled-out ESG statement, a four-step horizontal rail) and
  `.values-section` (light, the four values as an editorial list — NOT cards). The old
  `.pitch-prose`/`.process-flow`/`.values-grid`/`.value-item` markup and CSS are gone, and
  `home-motion.js` was rewired to match: it still targeted those selectors and would silently
  have stopped revealing anything.
  **★ The seam artifacts are seven animated SCENES, not icon tiles.** Vault, fingerprint,
  plinko sorter, candlestick chart, radar, snowball, cheque — 170-260px full-width bands,
  ported from nav_artifacts_v8.html.
  **Things a future session needs to know before touching them:**
  - The zero-height `.seam-rail` is still the container and still load-bearing: every section
    sets `overflow:hidden`, so a band hung off a section's own edge is clipped. Add a new
    scene as a `.sa-band` inside a rail BETWEEN two sections, never inside one.
  - **Sections adjacent to a rail reserve clear space** (`section:has(+ .seam-rail)` and
    `.seam-rail + section`). Without it, five of the seven overlapped real headings. If you
    add a taller band, re-run the collision check rather than assuming the clearance covers it.
  - **A scene must be legible on BOTH grounds it straddles.** The fingerprint and radar were
    drawn cream for a dark section; after the Company Pitch split the fingerprint sits between
    two LIGHT sections. It is navy now, and the radar carries its own dark ground. Check the
    tone on both sides before choosing colours.
  - The candlestick chart is built by `home-hero.js` from a fixed seed (unlike the Core
    Services terrains, which are baked). Same seed every load — proven by comparing two loads.
  - Contrast is measured **under reduced motion**, because these scenes animate opacity on
    long cycles and sampling at an arbitrary instant catches text mid-fade (the radar readout
    read 1.42:1 that way, meaninglessly).
  Verified: 92/92 artifacts, 47/47 Company Pitch, 9/9 fonts, 51/51 real composited-contrast
  probes, plus field 119/119, header 55/55 and hero 41/41 unchanged. See
  `Marketswave_Project_Handover.md` row 176.

- **★★ Resources page redesign — editorial list, vertical spine, and `.page-grain` promoted to a
  shared primitive (2026-09-08, row 177)**: resumed after a machine freeze left the work uncommitted,
  unverified and undocumented. Core Strategies is now a `.res-list` editorial list (per-row `--hue`,
  monospace numeral, icon, hairline dividers, no boxes) and How It Works a `.res-steps` vertical
  numbered spine, both carrying the homepage's greyscale-at-rest discipline.
  **Things a future session needs to know before touching this page:**
  - **The copy is the point.** The reference mockup was LAYOUT ONLY and its descriptions are trimmed;
    the real page copy must survive verbatim. Proved by extracting visible text and diffing — 8841 ->
    8835 characters with every delta explained by the numbering alone. Re-prove it after any edit here;
    it is a two-second check and it is the one thing this redesign could silently ruin.
  - **`--hue` is decoration, `--hue-text` is text, and the split is load-bearing.** Measured against the
    row's own hover surface BEFORE the grain, five of the six accents fail as text: gold `#C8860A`
    2.90:1, blue `#4A7FA5` 4.09:1, violet `#7A6BA8` 4.43:1, teal `#16815F` 4.59:1, rust `#B4553F`
    4.62:1. Only the accent rail and the `aria-hidden` icon stroke may use `--hue`. Adding a new row
    means deriving a new `--hue-text` and measuring it, not reusing the accent.
  - **`.page-grain` now lives in `glass-primitives.css`**, not `styles.css` — the second texture
    primitive after `.grid-overlay` and the first that is page-wide. It is `multiply`, so it DARKENS
    everything beneath it: every text colour on a page carrying it must be measured composited, never
    against its own flat value. The homepage's `.hero-grain`/`.field-grain` are deliberately NOT folded
    in yet; `.field-grain` is calibrated against the stone field's own contrast floor, so consolidating
    is a re-measurement task, not a rename.
  - **`scripts/verify-contrast.mjs` is new and is the tool for any grain/glass surface.** It samples
    real composited pixels over CDP. Two of its own bugs are already fixed and worth not
    reintroducing: foreground detection must be POLARITY-AWARE (this page has light-on-dark surfaces —
    hero, table head, footer — where taking the darkest pixel measures the background against itself
    and reports ~1.0:1), and a hovered element's box must be re-read AFTER hover, because
    `.res-item:hover` adds `padding-left` and shifts the row out from under a stale rect. Measure every
    variant, not a sample: a 2-row sample originally hid four genuine failures behind two passes.
  - The `→` affordance was **removed**, not restyled — the rows are not links and the strategies have
    no detail pages. If detail pages are ever built, it comes back with them.
  **Verified**: contrast 113 measurements at 1440px and 113 at each of 390/375/320, 0 below 4.5:1;
  structure/responsive 48/48 across all four widths; full suite 33/34 (the known unified-inbox Realtime
  flake clean on retry), Tailwind guard PASS, golden path PASS (16/16). **A methodology note worth
  keeping**: a first full-suite run showed 19 failures that were NOT regressions — restoring the
  changes and re-running the identical set in the identical order produced output byte-identical to
  clean HEAD. The cause was 12 leftover `Test Mid-Market PE Fund` products from
  `verify-products-catalog-fix`'s unreliable teardown, now the SIXTH recorded occurrence of that leak;
  it is worth fixing that script's teardown rather than cleaning up after it a seventh time.
  **Pre-existing, unrelated, reported not fixed**: `verify-hosting-default-fix.mjs` fails on clean HEAD
  too — commit 15eaa27 extracted `supabase-endpoint.js` to the project root, invalidating that
  script's own documented assumption that its temp module (written into `scripts/` so the
  `@supabase/supabase-js` bare specifier resolves) needs no project-root-relative imports.

- **★★ Verification-script teardown made reliable + hosting-default check repaired
  (2026-09-09, rows 178-179)**: the recurring `Test Mid-Market PE Fund` leak was an ORDERING
  bug, not a missing delete — `holdings.product_id` references `products(id)` with no
  `on delete cascade`, and teardown deleted products BEFORE the auth user, so that delete
  always hit an FK violation whose error nothing read, and the user delete a line later
  cascaded the holding away and orphaned the product. Only the PE product has a holding,
  which is why only it ever leaked. Now: user deleted first, errors checked, and the
  authoritative sweep keys off the run's unique suffix rather than ids parsed after the rows
  already exist. Proven with a control (pre-fix code + injected failure leaks one product;
  fixed code + identical failure leaks nothing). `verify-hosting-default-fix.mjs` was broken
  outright since commit 15eaa27 extracted `supabase-endpoint.js` to the project root; fixed
  by co-locating a PER-SCENARIO copy beside the temp files (per-scenario is load-bearing —
  that module resolves the environment at import time, so a shared copy is cached and every
  later scenario reuses the first one's answer). Four more leaks fixed for the same reason
  (no try/finally at all; 105 synthetic clients stranded on hard death, now swept on entry;
  an undeleted `non-admin-*` account; and an anonymous `auth.users` row whose comment wrongly
  reasoned that no-email meant nothing-to-delete), and golden-path's documented "leave it, it
  costs nothing" was deliberately reversed. **Every table now returns to its exact starting
  count across a full double run** — see the two new Working conventions above for the
  cold-start warm-up rule and the expected `email_log` growth, both of which you want to read
  BEFORE running the suite.
  **★ One item is TRACKED AND OPEN, deliberately not chased (row 179)**:
  `verify-supabase-pm-attribution` intermittently writes NULL attribution, but ONLY for
  `approve-client-application`/`reject-client-application` — in the SAME run, with the SAME
  PM JWT, ~20 other admin-write functions attribute correctly, and the 403/untouched-row
  assertions pass. Three occurrences, all inside full-suite runs; 52/52 in isolation. That
  narrowness is the useful part: it is NOT a general claims failure and NOT "admin actions
  without an audit trail" (both checked and ruled out). The function 401s if `getClaims()`
  errors, so a successful call structurally cannot write nulls — which points at the call not
  succeeding on those occasions, though that was not confirmed. First step for whoever picks
  it up: log the actual HTTP status/body of those two `functions.invoke` calls, which
  separates "call rejected" from "call succeeded but wrote nulls" in a single run.

- **★★ How It Works portfolio-assembly artifact, and a real font-fallback bug fixed on
  resources.html (2026-09-09, row 180)**: the empty right half of How It Works now holds a
  vertical artifact that assembles one layer per step as the reader scrolls (seed -> plan
  frame -> custody vessel -> four allocation layers -> monitoring orbit -> reporting ring),
  synchronised with the step spine, a 17%->100% counter and a row-by-row readout. New
  `resources-artifact.js`; the `<ol>` and all six steps' copy are untouched.
  **Things a future session needs to know before touching this page:**
  - **★ `document.fonts.check()` DOES NOT tell you whether a family is loaded, and it lied
    here.** It returned `true` for JetBrains Mono on a page with no `@font-face` for it, on a
    machine where it is not installed, and where it provably rendered as a fallback. Chrome
    reports true whenever the font list resolves at all — fallback included — so it answers
    "will this render?" (always yes), not "is this family being used?". Use METRIC COMPARISON
    instead: render a specimen in the requested family and in a deliberately nonexistent one;
    identical widths mean both hit the same fallback. `scripts/audit-fonts.mjs` does this
    across every family actually used on a page — run it after touching fonts anywhere.
  - **★ ...but METRIC COMPARISON CANNOT VERIFY A *WEIGHT* WITHIN A MONOSPACE FAMILY, and
    `audit-fonts.mjs` will report LOADED for a mono weight that does not exist (2026-09-09).**
    The probe compares text WIDTH, and every weight of a monospace family has the same advance
    width. Measured on asset-performance.html: JetBrains Mono reported `w=297.6` at 400, 500
    AND 700 while the document had `@font-face` entries for 500 and 700 only. The real effect
    is not a fallback to another family — CSS font matching resolves the missing 400 to the
    500 face, so the text renders one step HEAVIER than authored, which is exactly the kind of
    thing that reads as "inconsistent" without anything looking broken. A LOADED result means
    the FAMILY resolves; it says nothing about the WEIGHT. After changing mono weights, read
    the "@font-face entries" block the script also prints — that list is the real evidence.
    Proportional families are unaffected, since their widths genuinely vary with weight.
    Also fixed then: `ui-sans-serif` (and the other `ui-*` CSS generics) were missing from the
    script's generic list, so it flagged them as FALLBACK when there is nothing to load.
  - **resources.html had been silently falling back since row 177.** It never loaded JetBrains
    Mono, yet `styles.css` sets it on `.res-n`/`.res-kind`/`.res-dot`. Only `index.html` loads
    the family; the other seven marketing pages do not, but only resources.html actually uses
    it, so this was the one affected page. The homepage's hero ticker and Core Services field
    were checked and are genuinely fine. **If you add a JetBrains Mono rule to any other
    marketing page, load the font there too** — nothing will warn you.
  - **The artifact is NOT in a card, deliberately.** No border, no glass, no background fill —
    two hairline rules and a cast shadow on the drawing only. This page is card-free
    throughout; a panel here fights it. The verification asserts all four by computed style.
  - **Do not use `var(--accent-teal)` for anything carrying text on this page.** Cream on that
    token measures 4.32:1. The `.is-now` dot reintroduced exactly the failure row 177 had
    already fixed for `:hover`; both now use `#137254`. The mockup's own greys also all failed
    (label 2.92:1, readout key 3.44:1, idle dot 2.47:1) and are replaced with `#5C6367`, the
    tone `.res-dot` already used.
  - **Reduced motion and mobile both show the COMPLETE assembly, not an empty baseplate.**
    Reduced motion means do not animate, not show nothing. Below 960px the artifact sits after
    all six steps in source order, so the reader arrives having already passed every step and a
    scroll-build would never be seen — showing it assembled is the honest choice, not a
    shortcut.
  - **Testing this page's scroll behaviour: the site sets `scroll-behavior: smooth` globally**
    (row 101). A plain `scrollBy` therefore animates for hundreds of ms and every read lands
    mid-flight. Use `scrollTo({behavior:'instant'})`, confirm `scrollY` actually arrived, then
    poll for the processed state with a timeout. A "has it stopped changing" check is not
    enough on its own — the previous step's state is itself perfectly stable and reads as
    settled.
  **Verified**: `scripts/verify-hiw-artifact.mjs` 44/44 (four runs, including under full-suite
  CPU load) — it proves the artifact BUILDS across six real scroll positions with a screenshot
  at each, rather than screenshotting a finished state that a hardcoded artifact would also
  produce; plus rAF-throttling measured against a no-scroll baseline (60 scroll events cost 2
  extra frames). Contrast 127/127, row 177's structural check 48/48, copy preservation zero
  prose lost, Tailwind guard PASS.

- **★★ Site footer disclosures — full text on legal.html, condensed on all 8 footer pages
  (2026-09-09, row 181)**: new `legal.html#disclosures` section with the client's own
  disclosure text, and a condensed 3-paragraph block in the shared footer linking to it.
  **Things a future session needs to know before touching this:**
  - **The legal text is the CLIENT'S OWN and is used VERBATIM. Do not edit, soften, shorten or
    "improve" it**, and do not retype it inline. Both the full section and the three footer
    excerpts are generated from a single source list, which is why a check can prove all 12
    paragraphs and all 3 excerpts byte-identical. If it ever needs updating, regenerate both
    places from one source rather than editing two copies that will drift.
  - **It is 12 paragraphs, not 10.** The brief said ten and supplied twelve; its own quoted
    first and last paragraphs matched paragraphs 1 and 12, so the count was a miscount, not an
    instruction to drop two. Footer excerpts are paragraphs 1, 3 and 9.
  - **The footer is byte-identical across all 8 pages** (about, blog-press, contact,
    help-center, index, legal, resources, services) — verified by hashing before and after.
    Any footer change must be applied to all 8 in one pass, and the hash check is the way to
    confirm it stayed uniform.
  - **The footer texture already existed** — `.site-footer::before` is the radial light and
    `::after` the SVG-turbulence grain, built in round 2 (row 174). The grain is `mix-blend-mode:
    screen`, NOT multiply, because the surface is dark and multiply would simply vanish there.
    `.page-grain` is multiply and is therefore the wrong primitive for a dark surface — that
    difference is why a separate treatment exists, not an oversight. Do not add a third grain.
  - **The legal block needs `z-index: 2`** to sit above those two decorative pseudo-elements
    (light at 0, grain at 1). Text placed in the footer without it renders under the grain.
  - **`support@marketswave.com` is fully retired** (row 161): `send-email.ts`, `support.html`
    and the recovery template all use `support@marketswave.net`. The site footer never carried
    a support address at all. The comment in `send-email.ts` is a dated RESOLUTION RECORD, not
    a live placeholder — leave it.
  - **Email vs site disclosures do NOT contradict each other**, checked claim by claim: six
    risk claims align exactly; six more appear only on the site, where the email is silent
    rather than conflicting. The one asymmetry, reported for the client rather than edited:
    the site says "only suitable for accredited investors" while the email says "not suitable
    for all clients" — the site is stricter, so nobody receiving both is misled.
  **Verified**: `scripts/verify-footer-disclosures.mjs` 9/9 across all 8 pages at
  1440/390/375/320 (3 paragraphs, hairline rule, working link, zero overflow, and the block
  proven genuinely smaller AND dimmer than the footer body while staying ≥11px at ≥1.6
  line-height — quiet, not fine print). Contrast run on all 8 pages: disclosure text 5.55:1 and
  the link pass everywhere. Fonts audited on all 8 by metric comparison (row 180): zero
  fallbacks. The link was verified by CLICKING it, not by reading the href. Copy preservation
  re-run on all 8, nothing lost. Tailwind guard PASS.
  **Pre-existing, unrelated, reported not fixed**: `about.html`'s section lede measures 4.01:1
  — proven pre-existing by reproducing the identical figure on clean HEAD.

- **★★ Login gate + sign-in loading screen redesigned; auth logic untouched (2026-09-09,
  rows 183-184)**: `login.html` is a split gate (dark canvas environment left, cream
  floating-label form right) with an access-granted loading screen (orbiting rings, 36-tick
  dial, lock that opens). New `login-gate.js` for the canvas, magnetic controls and tick dial.
  **Things a future session needs to know before touching this page:**
  - **★ This is a REAL authentication flow.** Every element the auth module reaches for is
    load-bearing and must survive any redesign: `#login-form`, `#loading-screen` (.is-active),
    `#login-error` (.is-visible), `#email`, `#password`, `button[type=submit]`, `.login-card`
    (the FIRST one — showForgotPanel() display-toggles it), `#forgot-panel`,
    `.forgot-step[data-forgot-step]`, `#back-to-login-1/2`, `#btn-send-reset`, `#forgot-error`,
    `#reset-email`, and `a[href="signup.html"]` (the ?env/?backend propagator rewrites it).
  - **★ The loading screen is now raised BEFORE sign-in, not after.** It used to appear only
    once every await had already resolved, which is why the mockup's four timer-cycled messages
    would have been fiction — nothing was left to narrate. The three messages now map one-to-one
    onto real awaited work. **The consequence: the screen can be up when auth FAILS, so every
    failure path must call `hideLoading()`.** There are six (bad credentials, missing client
    row, pending_review, rejected — in both branches). Add a seventh failure path and you must
    add a seventh call, or the user is stranded on a loading screen after a failed sign-in.
  - **★ The submit handler does not attach for ~4 seconds after load** (row 184), because
    `firebase-config.js` statically imports four gstatic.com modules and a static ES import is
    a real network fetch. Confirmed identical on clean HEAD. Any browser test MUST wait for the
    module before submitting — `verify-login-redesign.mjs` probes the forgot-password listener
    to detect readiness, because probing with a submit event would fire a real sign-in. Without
    that gate the auth assertions dispatch into a form with no handler and pass vacuously.
  - Grain blend differs per surface and is not interchangeable: SCREEN on the dark environment
    and loading screen, MULTIPLY on the cream pane. Multiply on dark disappears entirely.
  - The area below the gate headline is **deliberately empty** and asserted to be. Stats,
    tickers, clocks, security badges and link lists were all tried and rejected.
  - The back control is a **direct grid child**, not a child of either column, so it can sit in
    the cream pane on desktop and inside the dark band on mobile. All three grid children are
    placed explicitly — adding a third item without explicit placement pushes the columns into
    later rows.
  **Verified**: `scripts/verify-login-redesign.mjs` 76/76 (twice), including the real auth
  behaviour driven through the actual form — wrong password and unknown email give an identical
  generic message, pending_review and rejected still block with their own copy, and a real
  client reaches the dashboard. The status line is proven non-timer by blocking the auth
  endpoint and asserting it stays put. Contrast 11/11 plus the loading screen measured
  separately; reduced motion leaves both screens complete rather than empty; fonts audited by
  metric comparison (JetBrains Mono was absent and is now loaded at the weight actually used).
  **Two pre-existing issues reported not fixed (row 184)**: the ~4s dead window above, and the
  Supabase branch dropping `?env=staging` on its success redirect while the retired Firebase
  branch preserves it.

- **★★ Returns display — dashboard cards and the holdings table (2026-09-09, row 185).**
  The dashboard's returns card showed realised gains only, so a client holding well-performing
  positions for two years saw $0. **The number was correct** — realised-only is the locked
  accounting rule and nothing here changes it. What was wrong is that one number was carrying a
  job it cannot do, so this is a DISCLOSURE change, not a recalculation.
  **New backend, after investigating what already existed.** `get-holdings` returned only
  `{id, productId, units, costBasis}`; unrealised was computed IN THE BROWSER on
  asset-performance.html and asset-collection.html, per-class percentages again in
  dashboard.html, and per-product realised from the ledger — three client-side money
  computations, no server figure for any of it. New `get-returns-summary` is now the one
  source: per-position unrealised amount/percent, totals, per-class breakdown, best class,
  per-product realised, and the trend series. The page-local ports were DELETED rather than
  left dormant, so nothing can quietly reintroduce a second source of truth for money.
  **Things a future session needs to know before touching this:**
  - **The maths is the engine's own, including its order of operations.** `unrealized =
    round2(units * unitPrice - costBasis)`, percent guarded at zero cost basis, and the total
    is the sum of the ALREADY-ROUNDED per-position values — summing raw and rounding once at
    the end is a different number. Verified by seeding the REAL `engine-core.js` with the same
    holdings and prices and comparing to the cent, not by re-deriving the server's arithmetic.
  - **`realizedHeld` and the per-position `realized` field are GONE (2026-09-09, row 187).**
    Both existed only to feed the Return Table's Realised column, which was removed; realised
    is now reported per CLOSED position instead, which is the thing it actually describes.
    `realized` (the account-level `account_state.asset_returns`) remains and is still what the
    dashboard shows, unchanged.
  - **The total-return percentage denominator: FIXED 2026-09-09 (row 187), and the reasoning
    that was written here before was WRONG.** It used to divide by the cost basis of HELD
    positions only, which overstated performance for anyone who had sold ($100,000 -> $115,000
    across one closed and one open position reported +25% instead of +15%). This entry, and
    register row 186, both claimed the engine "does not retain the cost basis of closed
    positions" and that fixing it needed a schema change plus a migration. **That was false.**
    The figure was never lost, only unqueried: `execute-sell` stores both `total_value` and
    `realized_return` on the SELL row, so `capital allocated = total_value - realized_return`,
    exactly. The denominator is now capital DEPLOYED (`capitalDeployed` = held cost basis plus
    recovered closed cost basis). Per-position and per-class percentages deliberately keep the
    held-only denominator, since each describes a position still held. See row 186, which was
    corrected in place rather than merely ticked off.
  - **The Trend sparkline is REAL history, not a decorative shape.** `settleProduct()`'s daily
    return depends only on product id and calendar date, never on the price, so the walk is
    exactly invertible: `price(D-1) = price(D) / exp(dailyReturn(D))`. New `unitPriceSeries()`
    walks backward from today. It is proven by walking the result FORWARD again and landing on
    today's real price to the cent. Private Equity / Real Assets are carved out of the tick, so
    their real history is `nav_publications` and a flat line is the TRUTHFUL picture between
    appraisals, not a missing one.
  - **★ `engine-core.js` is NOT a valid oracle for settlement.** It never received row 143's
    Private Equity / Real Assets carve-out (built server-side only, since no live page still
    calls the local `settleProduct()`), so the local engine happily ticks a PE product the
    server correctly holds flat. It IS a valid oracle for the unrealised FORMULA, which is what
    was ported — the verification pins the seeded catalog to today so settlement is a no-op and
    the formula is compared in isolation.
  - **Colours are measured, and one was a real failure.** `--ret-gain #137254` (row 180's
    proven green), `--ret-loss #A8452F`, `--ret-realised #3A6785` — deliberately NOT row 177's
    `#4A7FA5`, which measured 4.09:1. The em dash for a never-sold position was `#8A9298` and
    measured **3.16:1** on the table's white ground; it carries real meaning ("never sold") so
    it was darkened to `--ret-muted`. Caught by measurement, invisible by eye. Gain/loss is
    never signalled by colour alone — every figure carries an explicit + or U+2212 sign.
  - **`verify-contrast.mjs` now takes page PROFILES and can measure AUTHENTICATED pages.**
    `CONTRAST_PROFILE` picks the selector set (default `resources`, unchanged — re-confirmed at
    120 measurements, 0 failures) and `CONTRAST_BOOTSTRAP_JS` seeds a real session on the
    origin before navigating. A wrong session key cannot produce a false pass: the page bounces
    to login and the run reports zero measurements, which it already treats as a hard failure.
  - **New user-facing copy is British ("unrealised"/"realised")**, following the approved mockup
    and the task's own specified legend wording. The two existing user-facing American spellings
    on these two pages were aligned so neither page reads as mixed; code identifiers
    (`getUnrealizedReturn` etc.) were deliberately left alone.
  - **`runVerifyMain()` exits 0 on ANY normal resolve**, so returning a code from `main()` is
    silently discarded and a failing run reports success. Both new scripts call
    `process.exit(1)` explicitly — proven with a forced-failure control, not assumed.
  - **One client-side computation deliberately NOT closed, stated rather than implied**:
    `asset-collection.html` keeps its own `getUnrealizedReturnPercent()` for the per-product
    card badge. That page is neither the dashboard cards nor the holdings table, so it was out
    of scope — but it is now the LAST place unrealised is computed in the browser, and it
    should read `get-returns-summary` when that page is next touched.
  **Table**: Holding (name + class/type) | Units | Capital Allocated | Current value |
  Unrealised (amount over percentage) | Trend | Action, plus a totals row and a two-line
  legend. (The Realised column was here originally and was removed on 2026-09-09 — see row
  187.) The column keeps its ORIGINAL label, "Capital Allocated": it was briefly
  renamed "Cost basis" on the technical argument that the cell renders `holding.costBasis`,
  and that was reverted the same day. Both phrases describe the same real figure — what the
  client originally put into the position — and where two labels are equally accurate, the
  one a client understands without explanation beats the accountant's term. The same wording
  was aligned in the Sell modal and in transactions.html's Net Invested sub-label, both of
  which had said "cost basis" since well before this work. Code identifiers
  (`holding.costBasis`) are deliberately untouched — this is copy, not a rename. Asset Class
  and Investment Type moved into the Holding cell rather than being dropped — no information
  left the table.
  action, and the task said "extend".
  **Deployment note**: the shared-module change is **72 insertions, 0 modifications**, and
  `unitPriceSeries()` is called only by the new function — verified, not assumed — so unlike
  row 143 the other 12 importers' bundles are not behaviourally stale and only
  `get-returns-summary` needed deploying.
  **Verified**: `verify-returns-display.mjs` 57/57 (engine cross-check, the invertible-series
  proof, a genuinely losing position, a genuinely negative total return, the totals row adding
  up, 401/403) and `verify-returns-display-visual.mjs` 34/34 (contrast on both pages with a
  winner AND a loser on screen so both tones are measured for real; 1440/390/375/320 with the
  Trend column hidden below `lg` and the card layout from the mobile batches still holding).
  Cards stay SHORT — asserted, not just intended: no allocation breakdown, ranking or sparkline
  was added to them, and the mockup's own unused `.vbreak`/`.rank`/`.spark` CSS was not carried
  over.

- **★★ Realised gains card, closed positions panel, and the Return Table cleanup
  (2026-09-09, row 187).** Realised gains had nowhere sensible to live: the Return Table's
  Realised column was an em dash on every row for any client who had never sold — most of
  them — and a position that HAS been closed has no holding row left to sit on at all. The
  column is gone; realised now has a panel that can describe a closed position properly.
  **★ THE INVESTIGATION THAT GATED THE DESIGN, AND ITS ANSWER — READ THIS BEFORE TOUCHING
  ANYTHING HERE.** The approved design needed the capital originally allocated to each CLOSED
  position, and row 186 claimed the engine discarded that on sale. **It does not.** No BUY
  history is needed and none is consulted: `execute-sell` computes `realized_return =
  round2(saleValue - costBasisPortion)` and writes BOTH `total_value` and `realized_return` to
  the SELL row, so `capital allocated to the units sold = total_value - realized_return`.
  Both operands are already rounded to 2dp at write time, so the subtraction is EXACT. It is
  also immune to the average-cost blending that would defeat a FIFO-style reconstruction from
  BUY rows, precisely because it never looks at them. Proven, not reasoned: a real 1000-unit
  position (cost basis $100,000) sold down through three real `execute-sell` calls
  (250/300/450) reconstructed to the holding row's own cost-basis delta to the cent on every
  sell, summing back to exactly $100,000. `execute-sell` is the only writer of SELL rows and
  has always written `realized_return`, so no legacy row breaks it.
  **Things a future session needs to know before touching this:**
  - **★ Row 186 is FIXED by the same identity, and row 186 itself was CORRECTED IN PLACE
    rather than ticked off.** Its stated root cause ("the engine discards a position's cost
    basis on sale") was factually wrong and its proposed fix (schema change + reconstruction
    from BUY history) would have been unnecessary and more fragile. `totalPercent` now divides
    by `capitalDeployed` = held cost basis + recovered closed cost basis. Per-POSITION and
    per-CLASS percentages deliberately keep their own held-only denominator: each describes a
    position you still hold, so capital already taken back out of a closed one is not what
    produced it. Only the portfolio-level figure spans both, because only its numerator does.
  - **Closed positions aggregate PER PRODUCT, not per SELL row.** A position sold down over
    three sells is one closed position a client would recognise, and it matches how the engine
    already treats a holding — one blended average-cost position, never discrete lots.
    `closedAt` is therefore the MOST RECENT sell.
  - **`partiallySold` keys on the EXISTENCE of a SELL row, never on a non-zero gain.** A sale
    at exactly cost realises $0 and is still a real partial sale; a gain-based test would
    silently miss it and the two tables would then look like a duplicate rather than a
    deliberate pair. The panel carries the reciprocal marker ("Part of this position is still
    held") so the cross-reference reads from both ends.
  - **The Realised gains CARD shows the closed-positions total, not `account_state.asset_returns`.**
    It introduces the panel directly below it and states that panel's own row count, so the two
    must agree on screen. In real data they are the same number by construction: `execute-sell`
    writes the identical `realized_return` to the ledger row and to `account_state`.
  - **Three things the removed column orphaned were deleted, not left dormant**: the payload's
    `realizedHeld`, the per-position `realized` field (and the `realisedByProduct` map behind
    it), and `.rt-dash`. Leaving `realizedHeld` in place would have left a long comment in
    `get-returns-summary` explaining that it feeds a totals row that no longer exists.
  - **★ A SEEDED SELL ROW MUST BE ONE `execute-sell` COULD ACTUALLY HAVE WRITTEN.** Both
    existing verification scripts seeded impossible rows — $1,000 of proceeds carrying a
    $3,400 gain, and 10 units at ~$111 carrying $2,500 — which imply a NEGATIVE original
    cost. That never mattered while nothing read it; the moment capital is recovered as
    `total_value - realized_return` it produces a nonsense denominator, and it would not have
    failed loudly. Both seeds were corrected to real trades.
  - **`audit-fonts.mjs` could not audit an authenticated page at all**, and would have
    reported on `login.html` after the redirect while appearing to succeed. It now takes
    `AUDIT_BOOTSTRAP_JS`, the same hook and the same reasoning as `verify-contrast.mjs`'s
    `CONTRAST_BOOTSTRAP_JS`.
  - **`.rt` now matches TWO tables** (the Return Table and the panel), which is deliberate —
    they are styled as siblings, so measuring them through one selector is what proves it. Any
    probe that wants only one of them must scope to that table's own element; an unscoped
    `thead th` merges both column lists.
  **Layout**: three summary cards — Total portfolio value, Unrealised, Realised gains.
  Unallocated Capital lost its card here: it is not a returns figure, and it is still on
  dashboard.html and deploy-capital.html, which is where a client acts on it. "Browse Asset
  Collection" moved ABOVE both tables, directly under the cards — it is the entry point to
  allocating capital, and a client with no holdings previously scrolled past two empty tables
  and a request history to reach it, which on mobile is several screens of nothing.
  **Verified**: `verify-returns-display.mjs` 105/105 (the real partial-sell chain driven
  through the real `execute-sell`; rendered figures cross-checked against the LEDGER ROWS
  rather than against the payload the page was handed; a genuinely losing close, a negative
  totals row and a negative Realised card; the empty state) and
  `verify-returns-display-visual.mjs` 72/72 — 91 real composited-contrast measurements
  across three profiles including a dedicated never-sold run, and 1440/390/375/320 with
  explicit guards against the two regressions this page has already had once: card labels
  rendered in the figures' monospace, and a totals card laid out narrower than the holding
  cards above it. `audit-fonts.mjs` re-run on both pages: no fallbacks, mono weights used
  (500, 700) exactly matching the faces available.

**Next**: The Firebase roadmap that used to live in this paragraph (Phase A2 real Cloud
Functions on staging, the real-production Firebase switch-over) is **RETIRED, not
pursued** — see the "Firebase — RETIRED" Tech Stack entry above for the full "why." Supabase
Migration Stage 3 already delivered what Phase A2 was trying to reach (a real admin approve/
reject flow against real cloud infrastructure), so there is nothing left to unblock there.
If a real PRODUCTION backend is ever genuinely needed, it is Supabase's own future
real-production project (a distinct, not-yet-decided future item — see README.md's Backend
Migration roadmap section, itself marked retired/historical) — not a revival of
`.firebaserc`'s `PRODUCTION_CONFIG`/"Marketswave SE" plan. The Firebase-specific operational
detail that used to live here (the `--export-on-exit` emulator limitation, `admin-clients.html`
merging real Firebase clients, Reset Password/2FA's differing real effect on a
Firebase-sourced client) all still applies verbatim if anyone deliberately opts into the
retired `?legacyBackend=firebase` path for historical/reference testing — see README.md's own
retired Firebase sections (each now carries its own retirement banner) rather than repeating
it here. A fresh session's own "did I break the backend" check is now
`node scripts/supabase-golden-path-regression.js` (Stage 3's own, run against the local
Supabase stack), not the Firebase golden-path script; a new, separate
`node scripts/supabase-verify-portfolio-engine.js` is this stage's own "did I break the
portfolio engine" check (also local-stack-only) — the two scripts are complementary, not a
replacement of one by the other, since they cover different table sets. A third, separate
script, `node scripts/verify-supabase-deposits-withdrawals.js`, is Stage 2's own "did I break
Deposits/Withdrawals" check; a fourth, `node scripts/verify-supabase-allocations-sells.js`,
is Stage 3's own "did I break Allocations/Sells" check; a fifth, `node
scripts/verify-supabase-hys.js`, is Stage 4's own "did I break HYS Deposits/Withdrawals"
check; a sixth, `node scripts/verify-supabase-final-approval-gate.js`, is Stage 5's own "did
I break Client Applications/Client Profile Updates" check; a seventh, `node
scripts/verify-supabase-documents-support.js`, is Stage 6's own "did I break Documents/
Support" check; an eighth, `npm run verify-dashboard-ui-wiring` (from `scripts/`, note the
required `--experimental-loader` flag baked into that npm script), is UI Wiring Stage 1's own
"did I break dashboard.html's real data rendering" check; a ninth, `npm run
verify-asset-pages-ui-wiring` (same flag), is UI Wiring Stage 2's own "did I break
asset-collection.html/asset-performance.html's real reads AND write actions" check; a tenth,
`npm run verify-funding-transactions-ui-wiring` (same flag), is UI Wiring Stage 3's own "did I
break deploy-capital.html's Deposit/Withdraw actions AND transactions.html's real reads"
check; an eleventh, `npm run verify-hys-documents-ui-wiring` (same flag), is UI Wiring Stage
4's own "did I break high-yield-savings.html's pocket actions AND documents.html's real
reads/writes" check; a twelfth, `npm run verify-settings-risk-support-ui-wiring` (same flag),
is UI Wiring Stage 5's own "did I break risk-management.html/settings.html/support.html's real
reads AND write actions" check; a thirteenth, `npm run verify-admin-approval-gate-ui-wiring`
(same flag), is Admin UI Wiring Stage 1's own "did I break the five Approval Gate admin
pages' real reads AND approve/credit/reject write actions" check; a fourteenth, `npm run
verify-cross-role-sync-bugfix` (same flag), is the cross-role sync bug fix's own "did I break
admin-documents.html/admin-support.html's bidirectional wiring OR the notification bell/
sidebar Documents badge across all 5 domains" check — one of two scripts (with the
sixteenth, below) that build genuinely separate PM/client contexts rather than one shared
`MarketswaveData` instance, see that Tech Stack entry above for why. A fifteenth, `npm run
verify-admin-final-wiring` (same flag), is Admin UI Wiring Final Stage's own "did I break
admin-profile-updates.html/admin.html/admin-advisory-fee.html/admin-clients.html's real reads
AND write actions" check. A sixteenth, `npm run verify-products-catalog-fix` (same flag), is
the Products Catalog Fix's own "did I break admin-products.html's real reads/writes OR
asset-collection.html's real product-card rendering" check — the second script to build
genuinely separate PM/client contexts, reused from the cross-role sync fix per instruction.
A seventeenth, `npm run verify-dashboard-real-data-fixes` (same flag), is the Dashboard
Real-Data Fixes' own "did I break the real monthly-change/Asset-Returns/Best-Performing-
Class/empty-state-pie-chart wiring on dashboard.html OR the Legal Name/Address/ID hint on
settings.html" check.
**★
Phase B Stage 2 (Aug 30, 2026, row 115) moved Deposits and Withdrawals onto real Supabase
tables + Edge Functions; Stage 3 (Aug 30, 2026, row 116) moved Allocations and Sells the same
way; Stage 4 (2026-09-02, row 117) moved HYS pockets + both HYS approval queues the same way;
Stage 5 (2026-09-02, row 118) moved the final two Approval Gate queues, Client Applications
(found already fully built since Stage 3 — nothing new needed) and Client Profile Updates
(genuinely new that stage), closing all 7 of 7 Approval Gate queues; Stage 6 (2026-09-02, row
119) moved Documents & Support — NOT Approval Gate queues, deliberately built on a different
write-path shape (real client-side direct writes where the real code takes that path;
Edge-Function-only where it's genuinely admin-only) rather than copying the request-then-
approve pattern — closing the backend-logic loop: EVERY DOMAIN FROM THE ORIGINAL ENGINE HAS
REAL SUPABASE SCHEMA/FUNCTIONS (LOCAL STACK ONLY).** Stages 1-6 are all schema/functions/
Node-verification only — no client-facing or admin UI switched over. **UI Wiring is the
separate, ongoing effort actually closing that remaining gap, one page/domain at a time**:
Stage 1 (2026-09-03, row 120) wired `dashboard.html` — the FIRST page in the project
genuinely calling real Supabase Edge Functions/tables — establishing `supabase-data.js`'s
canonical `renderAsyncBundle()` read pattern; Stage 2 (2026-09-03, row 121) wired
`asset-collection.html` + `asset-performance.html`, extending that same module with the
canonical WRITE-action pattern (`withButtonBusy()`/`writeErrorMessage()`) for this project's
first two real write actions (Request Allocation, Sell) — cite `supabase-data.js`'s own
header comments directly in any future wiring stage rather than re-deriving either pattern;
Stage 3 (2026-09-03, row 122) wired `deploy-capital.html` (Deposit/Withdraw, this project's
3rd/4th real write actions) + `transactions.html` (full real read-only surface), needing zero
further extension to `supabase-data.js` — proof the Stage 2 pattern genuinely generalizes;
Stage 4 (2026-09-03, row 123) wired `high-yield-savings.html` (pockets, Open a New Pocket,
Withdraw, My Pocket Requests) + `documents.html` (both document lists, Upload, Sign, Remove,
notification chips) — the FIRST UI Wiring stage needing a genuine `supabase-data.js` extension
since Stage 2, adding `insertRow()`/`updateRow()`/`deleteRow()` for Documents' own real direct
table writes (no Edge Function gates Upload/Sign/Remove, unlike every domain wired before it);
Stage 5 (2026-09-03, row 125) wired `risk-management.html` (a real per-client Diversification
Score, replacing what turned out to be static/hardcoded-not-actually-real data) +
`settings.html` (Email/Phone display, Legal Name/Address/ID Document request-change, a real
Password Change built from scratch, and a real Active Sessions bug fix) + `support.html`
(ticket list, filing a dispute, My Requests) — **CLOSING OUT ALL 10 CLIENT-FACING PAGES**, the
last UI Wiring stage for the client side; needed zero further extension to `supabase-data.js`.
**Admin UI Wiring is a separate, dedicated sub-effort for the admin tool, started immediately
after the client side closed out**: Stage 1 (2026-09-03, row 126) wired the five Approval
Gate admin queue pages — `admin-deposits.html`/`admin-withdrawals.html`/
`admin-allocations.html`/`admin-sells.html`/`admin-hys.html` — the first admin-side UI Wiring
stage, adding `MarketswaveData.useAdminClient()` to `supabase-data.js` as the one small
extension an admin-authenticated caller needed (every other function in that file needed zero
changes). `admin-client-applications.html` was already wired to real Supabase back in
Supabase Migration Stage 3 (row 112), independently of this effort — its own real-cloud
Firebase/Supabase merge logic is untouched by Admin UI Wiring. `admin-documents.html` and
`admin-support.html` were ALSO wired to real Supabase, but as their OWN dedicated bug fix
(2026-09-03, row 127, closing a real cross-role local/Supabase split investigation found —
see that Tech Stack entry above), not as part of Admin UI Wiring Stage 1's own five-page
scope — don't conflate the two when tracing history. **Admin UI Wiring — Final Stage
(2026-09-03, row 128) closed out the remaining admin pages, one by one, investigated
individually — this closes the admin tool wiring effort entirely, one way or another, for
every page**: `admin-profile-updates.html` (the one queue Stage 1 missed) and
`admin-advisory-fee.html` (a new small `update-advisory-fee-rate` Edge Function closing a
real "table exists, nothing writes to it" gap) are now genuinely wired;
`admin-clients.html` was REWIRED — its stale pre-Retirement Firebase merge (dead since
Firebase Retirement, Aug 30, 2026, and never updated after) replaced with a real Supabase
`clients` merge, real cross-client Total Portfolio Value, and a real per-client pending
Approval Gate count. `admin-security.html` was investigated and confirmed to have no real
backend at all (mirrors `settings.html`'s own 2FA finding) — left correctly local, nothing
faked. `admin-products.html` was investigated and confirmed at the time to have no real
write path AND no schema support for its own `description`/`logoUrl`/`extendedDescription`
fields, left entirely local — **that gap was CLOSED the same day by the dedicated Products
Catalog Fix (2026-09-03, row 129, its own Tech Stack entry above)**: a real migration added
the three missing columns, real admin-only `add-product`/`edit-product` Edge Functions were
built, `admin-products.html` was wired to them, and `asset-collection.html`'s own product
mapping now maps the real columns instead of leaving them undefined — a real admin edit is
now genuinely visible on the real client-facing pages, proven via the same
genuinely-separate-context rigor as the cross-role sync fix, not assumed. **Every admin page
has now been individually investigated at least once; nothing remains "unknown," and the
only still-open gap across the whole admin tool is `admin-security.html`'s missing backend.**
**Standing
convention as of Phase B Stage 4
(2026-09-02), reconfirmed at Phase B Stages 5 and 6, at UI Wiring Stages 1-5, and again at
Admin UI Wiring Stage 1 and its Final Stage**: default to
Node/API-level verification against the local Supabase stack for this kind of backend work
(UI Wiring Stage 2 added `jsdom` as a persistent `scripts/` devDependency specifically to
keep this true for write-action pages with real delegated-click DOM interaction, not to
abandon it); reach for browser automation only when a task explicitly says "browser-verify"
and states why Node-level testing genuinely can't cover it — and even then, no such tool has
been available in this session at any point so far (checked fresh each time, not assumed).
Beyond the backend itself: row 3 (Onboarding data capture/PM review) is fully closed. Real
file storage (the uploaded documents' actual bytes, not just filename metadata) remains a
genuinely backend-dependent need, already tracked separately in the Documents & Reporting
register rows. Further client-selector UX work at higher client counts, if ever needed — the
earlier perf report found no slowdown at 50 clients, and this redesign already added
search/filter, so this stays non-urgent. A deliberate, explicitly-labeled "correct a
starting-price typo" override for the Product Catalog, if that turns out to be a genuine
operational need — flagged, not built, per the Edit Product judgment call in §4.63. See the
handover doc §5, §9 for the fuller forward-path discussion (note: §9's table predates both
this phase and Admin Tool Phase B, and is stale in places — the Tech Stack log here,
§4.41-§4.71, and the new §12 are the current source of truth). **Backend Migration Phase D
— Stage 1 (2026-09-06, row 142)** started the genuinely-external register items: Market
Snapshot and Currency Converter (rows 22-23) are now real, live data, not stubs — only
crypto on-chain confirmation (row 24) remains a genuine external-data gap in that group.
The same stage also shipped this project's first real outbound email (approve/reject-
client-application, credit-deposit) and reported which of the remaining admin-write
functions are good candidates to wire next — see that Tech Stack entry above for the
itemized list rather than re-deriving it. Three more "did I break X" checks now exist:
`node scripts/verify-supabase-market-data.js` (market data/currency), `node
scripts/verify-supabase-email-notifications.js` (email logging), and `npm run
verify-dashboard-market-currency-ui` (from `scripts/`, dashboard.html's own UI).
**Real PM-Published NAV (2026-09-06, row 143)** closed the full original Phase D market-
data/NAV line item — Private Equity/Real Assets products now move only via a real published
NAV, never the simulated tick. A fourth "did I break X" check: `node
scripts/verify-supabase-nav-publications.js` (the settlement carve-out, `publish-nav`, and
the Stocks & ETFs/Crypto regression it depends on staying unaffected).
**Phase D — Stage 2 (2026-09-06, row 144)** closed the full Phase D email line item — all 15
remaining real trigger points (deposits/withdrawals/allocations/sells/HYS/profile-changes/
support/documents) are now wired, alongside Stage 1's original 3. A fifth "did I break X"
check: `node scripts/verify-supabase-email-triggers-stage2.js`.

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
- **Cloud Staging Parity — run `npm run verify-cloud-staging-parity` (from `scripts/`)
  before any push that touches `supabase/migrations/`, `supabase/functions/`, or any page
  that calls Supabase.** Added 2026-09-05 after a real incident (row 137): every Phase B/UI-
  Wiring stage's own "local stack only, real cloud staging untouched" scope note was
  accurate and deliberate when written, but nothing tracked WHEN cloud staging needed to
  catch up — the gap grew silently for ~10 days until a real user hit "Could not reach the
  server" on the real live hosted site, because 9 migrations and 34 of 36 Edge Functions had
  only ever been applied locally. This script checks the real remote project directly
  (never a memory of what "should" be deployed) and exits non-zero the moment local and
  real-cloud-staging genuinely diverge — that failure is the signal to run `supabase db
  push`/`supabase functions deploy` for real BEFORE pushing app code that depends on them,
  not after a live user finds the gap. A stage that is genuinely meant to stay local-only
  (not yet ready for real users) is a deliberate decision to make explicitly, not a default
  to silently drift into — say so in the task's own writeup if that's the intent, the same
  "local stack only" language every stage above already uses, but treat it as a live
  decision to revisit, not a fact to forget.
  **A real limitation found 2026-09-06 (Phase C — Stage 1), disclosed in the script's own
  header too**: the Edge Functions check only confirms a function slug exists and is
  `ACTIVE` on the real remote — it does NOT diff deployed code against local source, so
  editing an already-deployed function and forgetting to redeploy it still reports clean.
  Redeploying an edited function remains the operator's own responsibility to remember.
- **Tailwind Color Scoping — run `npm run verify-tailwind-color-scoping` (from `scripts/`)
  before any push that adds/edits Tailwind classes on an admin page, or touches any page's
  own inline `tailwind.config` block.** Added 2026-09-07 after a real incident: `admin-
  inbox.html`'s "New Message" button (and, it turned out, the pre-existing Stage 1 "Send"
  button too) used `bg-navy`/`hover:bg-navy-dark`/`focus:ring-navy` — but `navy`/`cream` are
  CUSTOM colors that only exist where a page's own inline `tailwind.config` defines them via
  `theme.extend.colors` (every client-facing dashboard page does; no admin page ever has, by
  the locked "wholesale distinct color scheme" rule). The Tailwind CDN's JIT compiler doesn't
  error on an unrecognized color utility — it silently emits no CSS for it, so the button
  stayed fully present, correctly laid out, and clickable (confirmed live: `getComputedStyle`,
  `elementFromPoint`, `display`/`visibility`/`opacity` all read normal) while its real
  `background-color` computed to `rgba(0,0,0,0)` — invisible, not absent. Genuinely silent:
  no console error, no warning, easy to miss even on a direct screenshot. Confirmed via a
  project-wide grep that this was isolated to `admin-inbox.html` (the only admin file ever
  referencing navy/cream) and that the reverse direction — a client page's own custom-color
  `tailwind.config` accidentally stripping the Tailwind DEFAULT palette (slate/amber/etc.) —
  isn't currently happening, since every client page consistently uses the safe `extend` form,
  not a destructive bare `theme.colors` override. `scripts/verify-tailwind-color-scoping.js`
  is the standing, automatable check for both directions — checked directly (not assumed) to
  actually catch the exact regression by reintroducing it in a throwaway copy first.
- **★ Full-suite runs need ONE warm-up pass after a cold start — take measurements from the
  SECOND run onward.** Added 2026-09-09. A "cold start" is any `supabase start` after a
  `supabase stop`, including the very first run of a session. The stack is genuinely not at
  steady state on that first pass: `supabase functions serve` compiles each of the 51 Edge
  Functions on its FIRST invocation rather than at boot, and Realtime is still establishing
  its subscriptions. Both costs land entirely on run 1.
  This is measured, not a hunch — across ten full-suite passes, **every first run after a
  cold start dropped 1-3 assertions, and every subsequent run passed 34/34**. The drops are
  always in Realtime or edge-auth paths, always pass in isolation, and are not test-data
  pollution (that was a separate problem, fixed in row 178). Treating a cold first run as a
  regression will send you chasing a real-looking failure that is only a cold stack.
  So: `supabase start` -> run the suite once and DISCARD it -> then run it for real. If you
  need a clean pair, that is three passes, not two, and each is ~25 minutes — budget for it.
  A `supabase stop`/`start` in the middle of a session resets this; the next run is a cold
  run again.
- **`email_log` grows by roughly 58 rows per full-suite run, and that is BY DESIGN — do not
  "clean it up" or read it as a leak.** It is an append-only audit of genuinely-sent emails,
  and the email tests genuinely send. Every other table returns to its exact starting count
  across a full double run (confirmed twice, `auth_users` included). When checking for leaked
  test data, `email_log` is the one expected non-zero delta; a non-zero delta anywhere ELSE
  is a real leak worth chasing.

## Verification

Do not launch a browser, dev server, or any visual/interactive verification step after
making changes, unless explicitly asked to. Describe what changed and let the user check it
themselves. If you believe verification is genuinely warranted (e.g. a JS bug you're not
confident is fixed), ask first rather than doing it.
