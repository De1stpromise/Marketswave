# Marketswave Project — Comprehensive Handover Document

**Prepared:** August 2026  
**Last updated:** August 19, 2026  
**Scope:** Full project history from inception through current step  
**Purpose:** Enable clean continuation by any developer or future session  
**Continuity note:** Work migrated from Grok to Claude as of August 2026. This document is the single source of truth bridging that transition — Claude updates it after each significant session so no context is lost across tools or sessions.  

---

## 1. Project Overview

**Marketswave** is a discretionary wealth / capital management platform with:

- Public marketing site (multi-page)
- Multi-step client onboarding
- Client login + password recovery
- Client dashboard (portfolio, allocation, performance, capital deployment)
- Intended backend portfolio engine (capital allocation, PM approval, returns tracking)

**Working directory (user’s machine):**  
`C:\WorkDirectory\Marketswave`

**Design language:** Institutional, navy + cream palette  

**Primary colors (locked):**
- Navy: `#1B3A4B` / dark `#122A38`
- Cream: `#F7F6F3` / `#EDE8E1`
- Text: strong `#1A1C1E`, muted `#6B7178`

---

## 2. Inception & Evolution

| Phase | What happened |
|-------|----------------|
| Start | User uploaded site map + existing Aether Capital-style HTML/CSS template |
| Goal | Rebrand and expand into full Marketswave multi-page site |
| Constraint | Prefer **Find & Replace** over full file dumps; user creates files locally |
| Later | Shifted priority to structural flows (Get Access, onboarding, login, dashboard) over pure visual polish |
| Engine vision | User supplied flowchart + asset-class rules + returns model for a custom portfolio engine |

### 2.1 Original Source Documents (uploaded Aug 18, 2026, read into context Aug 19)

Two founding documents predate the handover doc and are the origin spec everything was built from. Both are now cross-checked against every current file.

**`MARKETSWAVE_SITE_MAP.docx`** — defines the 5-page public nav (Home, Service, Resources, About, Legal), full content for each (account types, service descriptions, 6 strategies, 6-step How It Works + stage table, Blog & Press, Help Center principles, About sections, Legal sections). Marked "complete and locked for development." **Status: fully implemented, verified line-by-line against current files, no gaps found.**

**`USER_FLOW.docx`** — defines the dashboard sidebar (Portfolio Overview, Asset & Performance, High Yield Savings, Transactions, Documents & Reporting, Risk & Compliance → renamed "Risk Management", Invest Capital → renamed "Deploy Capital", Settings, Support) and the detailed spec for each page. Also specifies: Deploy Capital's crypto/bank flow, and two login page fixes (forgot password flow, "Create an account" link to signup).

**Gap analysis: spec vs. current build (Aug 19, 2026)**

| Area | Spec calls for | Current build | Status |
|------|----------------|----------------|--------|
| Login forgot password | Designed multi-step flow | 4-step flow built | ✅ Done |
| Login "Create an account" link | Links to signup.html | Confirmed linked correctly | ✅ Done |
| Sidebar renames | Invest Capital→Deploy Capital, Risk & Compliance→Risk Management | Both applied | ✅ Done |
| Deploy Capital | Crypto card + bank card, bank collects sender info | Built, bank form expanded Aug 18 | ✅ Done |
| Portfolio Overview visual | **Vector pie chart** — exposure by asset class/sector/region/position | Chart.js pie chart + legend, confirmed present via direct file read (Aug 19) | ✅ Done |
| Asset & Performance — Asset Collection | User picks asset **+ quantity/allocation amount**, pends for PM approval | Allocation-amount input on every card, working category-tab filtering, confirmed present via direct file read (Aug 19) | ✅ Done |
| Asset & Performance — Return Table | Capital, asset class, **investment type**, return, return % | Investment Type column present, confirmed via direct file read (Aug 19) | ✅ Done |
| Transactions | Last-5 quick glance card, click-to-drill-down detail, transaction volume chart, net cash flow chart | Recent Activity card, volume chart, cash-flow chart, drill-down modal all present, confirmed via direct file read (Aug 19) | ✅ Done |
| Documents & Reporting | Two-way document hub (client↔company), categorized (contract/signature-required/article), notifications for uploads/signatures/deadlines | Built `documents.html` (Aug 19) — From/Upload sections, 4 categories, functional category/direction/date filters, live notification badges (chips + sidebar count) | ✅ Done |
| Risk Management | Risk meter + risk profile (engine-dependent), regulatory heatmap (KYC/AML/GDPR/SEC) | Built `risk-management.html`, revised 5× same day — see 4.12 | ✅ Done |
| High Yield Savings | Own allocation pool, Fixed Deposit + As You Want pockets, crypto/bank deposit+withdrawal | Built `high-yield-savings.html` — see 4.13 | ✅ Done |
| Settings | Profile/KYC card, other standard settings (Claude/Grok to recommend) | Built `settings.html`, revised — see 4.14 | ✅ Done |
| Support | Call Us, Chat with Us, dispute system, other recommended features | Built `support.html` — see 4.15 | ✅ Done |

**Correction (Aug 19, 2026):** an earlier version of this doc temporarily marked the three rows above as "confirmed missing," based on stale gap-language from before these features were built, mistaken for fresh evidence during a doc merge. Claude Code caught the error by reading the live files directly before acting on the incorrect claim — no rebuild was needed or performed. This note exists so a future session doesn't repeat the mistake of trusting a documentation claim over a direct file check.

**Bugs found and fixed during this audit (Aug 19, 2026), unrelated to the original spec but caught while reviewing against it:**
- Deploy Capital sidebar link on `asset-performance.html` was a dead `<button>` with no href — every other dashboard page uses a working `<a>`. Fixed.
- Login page "Back to site" link had a class name mismatch (`back-link-panel` in HTML vs `.back-link` in CSS) so it never received its intended white styling. Fixed.

---

## 3. Tech Stack (Current)

| Layer | Stack |
|-------|--------|
| Public site + onboarding | Static HTML + custom CSS (`styles.css`) |
| Dashboard | Tailwind CSS (CDN) + same navy/cream tokens |
| Interactivity | Vanilla JS (modals, multi-step forms, validation, live clock) |
| Backend | **Not built yet** (booked for later) |
| Future dashboard | Tailwind confirmed; React/Next.js optional later |

**Booked for later integration:**
- Live market data API
- Currency converter API
- Real auth + password reset backend
- Portfolio engine backend + DB

### 3.1 Backend Requirements Register

Every item below is currently a frontend-only stub (form, button, toast, or static demo
data) with no server behind it. **Split into two categories per user direction (Aug 19,
2026): most of this is in-house engine work you build and own, not third-party API
integration.** Build your own portfolio/allocation/notification/document logic locally
rather than defaulting to external services — the exceptions are the handful of items
that are genuinely external by nature (real-world market data, blockchain confirmation,
currency rates), not by choice. Update this register any time a new frontend stub is
added anywhere in the project.

**In-house engine work (you build and own this logic — no third party needed):**

| # | Area | What's stubbed on the frontend now | What the in-house engine needs to do |
|---|------|-------------------------------------|----------------------------------------|
| 1 | Auth | **Login now performs a real credential check (Client Authentication Phase 2, Aug 21, 2026, row 51)** — `login.html`'s submit handler calls `getClientByEmail()` → `hashClientPassword()` → `verifyClientCredentials()` for real, with `setClientAuthenticated(clientId)` recording who actually logged in on success. Wrong email and wrong password produce one identical generic error, never distinguishing which failed. **Logout now navigates to `login.html` (Aug 20, 2026, wired in `dashboard-sidebar.js` — every dashboard page gets it at once)**, though it still only clears the ambient `CLIENT-0001` dashboard-context pin, not the new `marketswave_authenticated_client_id` session key Phase 2 introduced — Logout wiring that key up is left for whichever phase finally reconciles the two. **One deliberate, documented gap remains**: `dashboard-sidebar.js`'s file-load-time pin still unconditionally sets `marketswave_current_client_id` to `CLIENT-0001` regardless of who `setClientAuthenticated()` recorded — so every dashboard page still shows `CLIENT-0001`'s data no matter who really logged in, confirmed directly in Phase 2's own live browser test (logged in as a different real client, dashboard still showed John Doe). That's Phase 3's job | Real backend-verified authentication (this is still a client-side-only hash comparison against `localStorage`, not a real server) and session management. Phase 3 — retire `dashboard-sidebar.js`'s hardcoded `CLIENT-0001` pin so the dashboard actually reflects whichever client `getAuthenticatedClientId()` says logged in — is the one remaining outstanding piece, tracked in row 51 |
| 2 | Password reset | 4-step UI flow, no real email/verification | Send/validate verification codes, update stored password |
| 3 | Onboarding | 9-step signup form, client-side validation only. **Completing the form now genuinely persists data (Client Authentication Phase 1, Aug 21, 2026, row 50)** — `addClient()` creates a real Client Registry record (name/email/phone/accountType) and a real hashed credential is stored, previously the submit button just navigated to `thank-you.html` with nothing saved at all | Route the newly created client to a real PM review queue before they're treated as fully onboarded — no such queue exists yet, a client created via signup today is immediately indistinguishable from an admin-created one |
| 4 | Portfolio engine — allocation | `dashboard.html`'s pie chart + legend (Phase 4a) and **`asset-performance.html`'s summary cards + Return Table + Asset Collection cards (Phase 4b, Aug 20, 2026)** all now read live from `engine-core.js` — grouped/summed from real holdings × current unit price, not hardcoded. **The Asset Collection cards themselves moved to their own page, `asset-collection.html` (Aug 21, 2026, row 49)** — `asset-performance.html` keeps the summary cards and Return Table, links out to the new page for browsing/requesting | Real backend still needed to actually persist an approved allocation across sessions/devices — the in-house engine only lives in this browser's `localStorage` for now |
| 5 | Portfolio engine — PM approval | **`asset-performance.html`'s "Request Allocation" button genuinely calls `requestAllocation()` (Phase 4b)**, and **the Return Table's new "Sell" action genuinely calls `requestSell()` (Phase 4c, Aug 20, 2026)** — both with real validation-error messages surfaced in a red-styled toast, not a generic failure. The two request histories were merged into one "My Requests" section (`getAllocationRequests()` + `getSellRequests()`, full history, every status, type badge distinguishing Allocation/Sell). **A PM-facing approve/reject UI now exists (Admin Tool Phase B, Aug 20, 2026)** — see row 31 and §4.41 — `admin-allocations.html`/`admin-sells.html` call `approveAllocationRequest()`/`rejectAllocationRequest()`/`approveSellRequest()`/`rejectSellRequest()` directly, with thrown re-validation errors (e.g. an oversell caught by Phase 3B's approval-time check) surfaced inline rather than failing silently. **All 4 of those functions now take an explicit `clientId` as their first argument and show every client's pending items, not just the currently active one (Approval Gate unification, Aug 21, 2026)** — see row 46 and §4.60 | None outstanding for the approve/reject UI itself — still needed: a real backend so approvals persist beyond this browser's `localStorage`, and a login gate for the admin tool (explicitly deferred per the Phase B spec) |
| 6 | Portfolio engine — returns | **`asset-performance.html`'s Return Table now reads live from `getHoldings()`/`getUnrealizedReturnPercent()` (Phase 4b, Aug 20, 2026)** — one row per current holding. Realized Amount column is genuinely realized now, summing `getTransactionLedger()`'s SELL rows per product (corrected same-day from an initial hardcoded `—`) — shows `—` only when that sum is genuinely zero — the live unrealized preview moved to the summary card instead, clearly labeled "Unrealized" | None — this row's original need is now met by Phase 4b |
| 7 | Deploy Capital — bank | Expanded sender/bank form submits nowhere yet | Email/queue sender details; email recipient bank details back; reconcile transfer |
| 8 | Transactions | **dashboard.html's Recent Activity card** reads live from `getTransactionLedger()` (Phase 4a). **`transactions.html` itself is now fully wired (Phase 4d, Aug 20, 2026)** — summary cards, its own Recent Activity instance, both charts (Transaction Volume, Net Cash Flow, grouped by real month from real data), the full ledger table with working filters, and the drill-down modal all read live. Deposit/Withdrawal/Dividend/Interest/Fee transaction types don't exist in the engine yet (only BUY/SELL) — the Type filter was trimmed to just Buy/Sell for now rather than offering options that can never match anything; the ledger will look sparser than a full real account's history until Deploy Capital and other cash-movement flows are wired to the engine in a later phase | None outstanding for BUY/SELL — re-expand the Type filter and ledger once Deposit/Withdrawal/Dividend/Fee transaction types exist in the engine |
| 9 | Documents & Reporting — storage | **Migrated to `engine-core.js`'s document store (Aug 20, 2026)** — Upload/Sign/Download/Remove all read/write through `getDocuments()`/`addDocument()`/`updateDocument()`/`removeDocument()`, persisted to `localStorage` (`marketswave_documents`) instead of documents.html's own page-local logic. Still frontend-only: no real file bytes are stored (just filename/category/status metadata), Sign is still a stub (no real e-signature), Upload doesn't actually transmit a file anywhere. **Remove confirmation now uses a custom on-page modal instead of `window.confirm()` (Aug 20, 2026, §4.35)** — same confirm/cancel behavior, but no longer blocks browser automation | Real file storage, real e-signature integration, real delivery |
| 10 | Documents & Reporting — notifications | **Badge computation is now a reusable engine function** (`getDocumentNotificationCounts()` in `engine-core.js`, Aug 20, 2026) — previously computed only inside documents.html's own script by reading DOM `data-*` attributes; now callable from any page that loads `engine-core.js`. Not yet actually called from any page besides `documents.html` itself | Real notification delivery (email/push) for docs, signatures, deadlines; wire `getDocumentNotificationCounts()` into other pages if a live badge is ever wanted elsewhere |
| 11 | High Yield Savings — pockets | Pockets + interest projections persisted to `localStorage` only | Real interest-accrual engine, real pocket ledger tied to account |
| 12 | High Yield Savings — bank leg | Bank funding/withdrawal form submits nowhere yet | Same in-house queue/reconciliation as Deploy Capital's bank leg |
| 13 | Risk Management — profile persistence | Risk meter save uses `localStorage` as a stand-in | Persist risk profile server-side, tied to the account |
| 14 | Risk Management — regulatory heatmap | KYC/AML, GDPR, SEC, Global Standards all show static "Compliant" | Real compliance monitoring feed driving each status pill |
| 15 | Settings — profile/KYC | Email/Phone edit + Request-Change modal write to `localStorage` only | Real profile update + change-request review workflow |
| 16 | Settings — security | Password change, 2FA setup, session list are all stubs | Real credential update, real TOTP 2FA, real session tracking/revocation |
| 17 | Settings — notification prefs | Toggle grid persists to `localStorage` only | Wire actual delivery preferences to the notification engine (item 10) |
| 18 | Support — chat | Canned reply cycle, no real agent | Real live-chat backend or agent routing |
| 19 | Support — call/dispute | Callback request + dispute form are stubs. **Dispute reference number is now system-assigned at submission (Aug 20, 2026, §4.35)** — sequential `DISP-0001`-style id (matching the `PROD-`/`TXN-`/`REQ-`/`SELL-` convention), no longer client-typed | Real callback scheduling, real ticketing/dispute workflow |
| 20 | Public site — contact form | `action="#"`, doesn't submit anywhere | Real form submission endpoint / email routing |
| 21 | Public site — Blog & Press | Placeholder text only | CMS for company posts/announcements |
| 25 | Portfolio engine — Phase 1 data layer + Phase 2 NAV-tick engine + Phase 3 transaction mechanics + Phase 3B sell request queue | `engine-core.js` (Phase 1 Aug 20, 2026; Phase 2 Aug 20, 2026; Phase 3 Aug 20, 2026; Phase 3B Aug 20, 2026): Product Catalog + Account State + Holdings, all seeded to `localStorage` (`marketswave_product_catalog`, `marketswave_account_state`, `marketswave_holdings`) and internally consistent by construction (Account State's `allocatedCapital` is derived from summing holdings × unit price, not hardcoded separately; `getTotalPortfolioValue()` reproduces dashboard.html's current $1,284,500 exactly on a fresh seed). Phase 2 adds a deterministic, seeded-PRNG GBM daily price tick per risk tier, lazily caught up on load (`settleProduct`/`settleAllProducts`, no live ticker), plus advisory fee accrual and unrealized-return preview reads. Phase 3 adds a request/approve allocation queue (`marketswave_allocation_requests` — `requestAllocation()` never moves money by itself, only `approveAllocationRequest()` does, per the locked rule) plus `executeBuy()`/`executeSell()` execution primitives and a `marketswave_transactions` ledger. **Phase 3B mirrors that same request/approve pattern for the sell side** (`marketswave_sell_requests` — `requestSell()`/`approveSellRequest()`/`rejectSellRequest()`/`getSellRequests()`), with a re-validation check at approval time against the *current* holding (not the holding as it was when the request was made) so two pending sells on the same holding can never combine into an oversell. **Phase 4a (Aug 20, 2026) wires `dashboard.html` to it** — Total Portfolio Value, the
allocation pie chart + legend, Risk Metrics, and Recent Activity all read live engine state.
**Phase 4b (Aug 20, 2026) wires `asset-performance.html`** — summary cards, the Return
Table, Asset Collection cards, real `requestAllocation()` wiring (with real validation
errors, not a generic toast). **Phase 4c (Aug 20, 2026) adds a Sell action to the same
page's Return Table**, wired to `requestSell()` via a preview modal, plus merges the request
history into one "My Requests" section covering both queues. **Phase 4d (Aug 20, 2026) wires
`transactions.html`** — summary cards, its own Recent Activity instance, both charts (real
monthly buy/sell volume + net cash flow), the full ledger table with working filters, and
the drill-down modal. **Bug fix, same day:** Phase 1's originally-seeded holdings were
written directly to `localStorage` before the transaction ledger existed, so no BUY
transaction was ever recorded for a starting portfolio — `engine-core.js` now backfills one
synthetic BUY per pre-existing holding on load if the ledger is empty, once only; see 4.26
for the full writeup. See 4.18 (Phase 1), 4.19 (Phase 2), 4.20 (Phase 3), 4.21 (Phase 4a),
4.22 (Phase 4b), 4.23 (Phase 3B), 4.24 (Phase 4c), 4.25 (Phase 4d), 4.26 (backfill fix), 4.27
(responsive-layout bug fixes), 4.28 (sidebar collapse) in this doc | Next: build a PM-facing
approve/reject UI somewhere for both request queues; wire Deploy Capital so deposits start
appearing in the transaction ledger too |
| 29 | Portfolio engine — advisory fee rate management | `transactions.html`'s "Est. Monthly Advisory Fee" card is **read-only** (Aug 20, 2026) — displays the live accrual (`getAdvisoryFeeAccrued(30)`) and current rate, but has no edit affordance. An earlier version of this card let the client edit the rate inline via `setAdvisoryFeeRate()`; removed as a permissions fix — clients should never be able to set their own advisory fee. `setAdvisoryFeeRate()` itself stays in `engine-core.js` (still a valid, tested function), just uncalled from any client-facing page. **`admin-settings.html` (Admin Tool Phase B, Aug 20, 2026) is now the one place this is callable from any UI** — confirmed via grep that no client page calls it | None outstanding — real backend persistence is the only remaining gap, same as every other engine-only setting |
| 30 | Notification bell — cross-domain aggregation | New shared component (Aug 20, 2026, `dashboard-notifications.js`), mounted on all 9 dashboard pages via `initDashboardNotifications()`. Aggregates Documents (via `getDocuments()`), Allocation requests, and Sell requests (via `getAllocationRequests()`/`getSellRequests()`) straight through existing `engine-core.js` functions. High Yield Savings pockets and Support requests are read **directly** from their own `localStorage` keys (`marketswave_hys_pockets`, `marketswave_support_requests`) rather than being migrated into `engine-core.js` — a deliberate scope decision, not an oversight (see §4.37). Read/unread state persists to a new `marketswave_notifications_read` key, keyed per notification item (not one global watermark), entirely frontend-only | If HYS or Support are ever migrated into `engine-core.js` for other reasons, `dashboard-notifications.js`'s two direct-`localStorage` readers (`buildSavingsItems()`, `buildSupportItems()`) should be updated to go through the engine API instead, for the same reason Documents' badge logic was centralized in Phase 4.34's migration |
| 31 | Portfolio engine — deposit request queue (Admin tool Phase A) | `engine-core.js` (Aug 20, 2026): `requestDeposit(method, amount, currency, details)` / `creditDepositRequest(requestId, confirmedAmount)` / `rejectDepositRequest(requestId, reason)` / `getDepositRequests()`, mirroring the allocation/sell request/approve pattern for money coming INTO the account. `confirmedAmount` (PM-entered) is authoritative and may differ from the client's original `requestedAmount` — real-world wire fees/FX/partial transfers. Adds a `DEPOSIT` transaction type to the ledger (no `productId`/`units`/`price` — just `totalValue`, `date`, `method`). Engine layer verified via Node, mirroring how every prior engine phase was verified. **The `getTransactionLedger()` rendering breakage flagged by this row's original audit is now fixed** (Aug 20, 2026, same day — see §4.39): `transactions.html`'s ledger table/drill-down modal no longer crash on a `productId`-less DEPOSIT, DEPOSIT has its own label/badge/asset text instead of being mislabeled "Sell" or showing "null", and `dashboard.html`'s Recent Activity shows real deposit phrasing instead of "Capital allocated — null". **`creditDepositRequest()` is now called from `admin-deposits.html` (Admin Tool Phase B, Aug 20, 2026)** — see §4.41. The PM enters a confirmed amount (pre-filled with the client's requested amount, editable) which is what actually lands, exactly matching this row's original design intent. **`creditDepositRequest()`/`rejectDepositRequest()` now take an explicit `clientId` and write directly to that client's scoped storage — no module-level caching, no fallback to the ambient active client anywhere in the chain (Approval Gate unification, Aug 21, 2026)**; `admin-deposits.html` shows every client's pending/history rows via a new `getAllClientDepositRequests()` aggregator — see row 46 and §4.60 | None outstanding for the deposit queue's admin UI — still needed: real backend persistence and a login gate for the admin tool (explicitly deferred per the Phase B spec) |
| 32 | Portfolio engine — multi-client data model | `engine-core.js` + 6 other files (Aug 21, 2026, all 5 steps): the engine is now genuinely multi-tenant instead of implicitly single-client. `marketswave_clients` Client Registry (global); `setCurrentClientId()`/`getCurrentClientId()`/`clientScopedKey()` (`sessionStorage`-backed, defaults to `CLIENT-0001`); all 15 per-client `localStorage` keys route through `clientScopedKey()` — the 7 `engine-core.js` already owned plus 8 owned by `risk-management.html`/`settings.html`/`support.html`/`high-yield-savings.html`/`dashboard-notifications.js`/`dashboard.html`. One-time migration copies old unscoped data to `CLIENT-0001`-scoped keys losslessly (Node-verified, 99 assertions). Admin tool now has a "Viewing Client" selector (`admin-sidebar.js` originally; moved into its own dedicated page, `admin-clients.html`, on Aug 21, 2026 — see row 41); client-facing pages explicitly assert `CLIENT-0001` context (`dashboard-sidebar.js`). `addClient()` seeds a genuinely fresh, isolated new client (empty holdings/ledger/requests, modest starting cash) rather than cloning the demo portfolio — isolation proven via a 20-assertion Node harness simulating the full create-switch-act-switch-back cycle, **then run for real in the browser** (created CLIENT-0002, switched via the actual admin dropdown, credited a real deposit via the actual Credit modal, confirmed CLIENT-0001 completely unaffected both ways). **That live run caught a real bug Node verification missed**: the original client-context reset (Step 4) ran too late relative to `engine-core.js`'s own data loading, which under one same-tab sequence (switch client in admin, then navigate to a client page) silently corrupted CLIENT-0001's real `unallocatedCapital` — root-caused via raw `localStorage` inspection, fixed by moving the reset to file-load time (before `engine-core.js` loads, not after), re-verified against the exact failing scenario, corrupted data repaired from a recorded known-good baseline, and a 6-assertion regression test added so it can't silently return. See §4.45 | Real backend persistence (still `localStorage`-only, per-browser); a login/auth system to actually determine which client a real user is; ~~a "create client" UI in the admin tool (client creation is currently console-only)~~ **resolved Aug 21, 2026 — see row 41's "Add Client" form on `admin-clients.html`** |
| 33 | Portfolio engine — HYS deposit approval queue | **COMPLETE** (Aug 21, 2026, both checkpoints). `engine-core.js`: `requestHYSDeposit(pocketType, term, amount, method, details)` / `creditHYSDeposit(requestId, confirmedAmount)` / `rejectHYSDeposit(requestId, reason)` / `getHYSDepositRequests()`, a parallel store to the regular deposit queue (see §4.46 for why). `creditHYSDeposit()` creates the actual pocket funded with the PM-confirmed amount, computes `maturityDate` from the real credit date and `projectedInterest` from the confirmed amount, never touches `unallocatedCapital`/`allocatedCapital`, and produces an `HYS_DEPOSIT` transaction-ledger entry. `high-yield-savings.html`'s "Open a New Pocket" flow now submits a request (with a "My Pocket Requests" section); new `admin-hys.html` gives PMs a real credit/reject UI; `transactions.html`/`dashboard.html` proactively audited and fixed for the new transaction type before ship. Node-verified (57 + 182 regression assertions) AND run for real end-to-end in the browser (§4.47) — request submitted, credited at a different confirmed amount than requested, pocket/maturity/interest all verified correct, CLIENT-0002 confirmed completely unaffected. **`creditHYSDeposit()`/`rejectHYSDeposit()` now take an explicit `clientId` and write directly to that client's scoped storage at every layer — the pocket store, the request queue, and the transaction ledger (Approval Gate unification, Aug 21, 2026)**; `admin-hys.html` shows every client's pending/history rows via a new `getAllClientHYSDepositRequests()` aggregator — see row 46 and §4.60 | None outstanding for this queue |
| 34 | HYS rate/term duplication — known structural debt, not a bug | `high-yield-savings.html`'s client-facing rate preview (`SHORT_TERM_BRACKETS`/`LOCKED_RATES`) and `engine-core.js`'s independently-derived rate logic (`HYS_SHORT_TERM_BRACKETS`/`HYS_LOCKED_RATES`, used when a PM actually credits an HYS deposit — see §4.46) are two separate copies of the same business rule, kept intentionally separate for security reasons: the engine must never trust a client-computed money figure, so it recalculates rates from raw inputs (`pocketType`/term) rather than accepting a pre-computed value from the browser. Correct behavior as designed, but the two copies can silently drift if a rate ever changes and only one copy gets updated | Make `engine-core.js` the single source of truth for the rate schedule, and have `high-yield-savings.html`'s live preview call into the engine for its number instead of keeping a parallel copy — eliminates drift risk while preserving the same security principle. **Recommended timing: after the current admin-tool build-out (the nine-item batch following the Multi-Client Data Model phase) is complete, as a dedicated cleanup pass rather than squeezed into feature work.** |
| 35 | Request Change data model + client redesign | **Both checkpoints COMPLETE (Aug 21, 2026).** Checkpoint 1 — `engine-core.js`: `marketswave_settings_change_requests` replaces `marketswave_settings_pending` (field names only, no value/reason/timestamp). `getSettingsProfile(clientId?)` backed by new per-client storage for `legalName`/`dateOfBirth`/`address`/`idDocument` (previously 100% hardcoded HTML, no storage at all). `requestSettingsChange(field, requestedValue, reason)` auto-snapshots `currentValue` from the real profile. `approveSettingsChangeRequest(clientId, requestId)`/`rejectSettingsChangeRequest(clientId, requestId, resolutionNote)` take an explicit `clientId` (cross-client by design, confirmed with a dedicated test). Approve genuinely writes into the real profile store for the first time. Node-verified, 38 assertions + full 182-assertion regression suite, 220 total, 0 failures (§4.48). Checkpoint 2 — `settings.html` rewritten to read/display all four fields from `getSettingsProfile()` live, with a "Pending Review" badge replacing "Request Change" per field; `#change-modal` redesigned into four field-specific bodies (Legal Name split first/last, Date of Birth native date input, Address five separate inputs, ID/Document type input + real file input capturing `fileName` only). Browser-verified live for all four fields including a real approve round-trip (console-simulated PM action) and a real uploaded test file — see §4.49 | None — the cross-client aggregation reader and `admin-settings-changes.html` itself are now both built; see row 37 |
| 36 | Documents + Support admin queues | **COMPLETE (Aug 21, 2026).** `engine-core.js`: `getAllClientDocuments()`/`updateDocumentForClient(clientId, docId, patch)`/`publishDocumentToClient(clientId, { filename, category, signatureRequired?, dueDate? })` (cross-client, mirrors the Settings Change explicit-`clientId` pattern) and `getAllClientSupportRequests()`/`updateSupportRequestForClient(clientId, requestId, patch)` (an admin-only addition touching the existing `marketswave_support_requests` key — `support.html`'s own client-side read/write of its own store is untouched, still not a full migration). New `admin-documents.html` (client uploads awaiting review with a "Mark Reviewed" action, a Publish to Client form, and a combined History of published + reviewed documents) and `admin-support.html` (Needs Attention / Resolved, an Update modal setting status + a client-visible PM note). `support.html` gained a "Portfolio Manager Response" block in its request-detail view to surface the new `pmNote` field. Both wired into `admin-sidebar.js`'s nav and two new Overview pending-count cards (Overview's grid widened from 4 to 6 cards). Node-verified, 34 new assertions (aggregation shape, `publishDocumentToClient`'s `dueDate`→`deadlineLabel` conversion, per-client sequential doc ids, missing-key handling for a client who's never loaded `support.html`, cross-client isolation, defensive copies) + full 220-assertion regression suite, 254 total, 0 failures. Browser-verified end to end: marked a real upload "Reviewed" (moved to History correctly); published a signature-required document with a due date to CLIENT-0002 — confirmed via raw `localStorage` inspection (client-facing pages can't be viewed as a non-default client in this build, by the same Step 4 design that hard-locks them to `CLIENT-0001`) that it landed with the exact right shape (`deadlineLabel: "Due in 9 days"`, `status: "Signature Required"`) and CLIENT-0001's own 8 documents were completely unaffected; resolved a real support ticket with a PM note from `admin-support.html` and confirmed the exact note text renders back on the client's own `support.html` "My Requests" view. Zero console errors throughout. See §4.50 | None outstanding for these two queues — the Settings Change admin queue (`admin-settings-changes.html`) remains the one held item from the original three-queue batch, per explicit instruction |
| 37 | Settings Change admin queue | **COMPLETE (Aug 21, 2026) — closes out the original three-queue batch.** `engine-core.js`: `getAllClientSettingsChangeRequests()`, the cross-client listing reader deliberately held back in the Request Change redesign's Step 1 (row 35) — `approveSettingsChangeRequest(clientId, requestId)`/`rejectSettingsChangeRequest(clientId, requestId, resolutionNote)` already took an explicit `clientId` from the start, so no changes were needed to either. New `admin-settings-changes.html`: Pending (field-specific Current/Requested display reusing `settings.html`'s own `formatFieldDisplay()`/`formatDateDisplay()` logic, byte-identical copies — see the duplication note below), an Approve confirmation modal showing Current → Requested before applying, a Reject modal with an optional reason, and a History section showing every resolved request with its outcome. Wired into `admin-sidebar.js`'s nav and a 7th Overview pending-count card. **A real, non-hypothetical finding from Node verification**: settings change request ids (`SETTING-0001`, ...) are assigned per-client, not globally — CLIENT-0001's and CLIENT-0002's first requests can both legitimately be `SETTING-0001`. Every row's Approve/Reject button carries both `data-client` and `data-id`, and the underlying engine functions already require an explicit `clientId`, so this was never exploitable through the actual UI — but it did trip up the *test's* first draft (an id-only lookup silently matched the wrong client's request), fixed by keying the test on `(clientId, field)` instead and documented in the test file as a reusable lesson for any future cross-client aggregate lookup. Node-verified, 24 new assertions (empty case, cross-client tagging, all 4 field shapes applying correctly to the right client's profile on approve, reject touching only status/resolutionNote, double-approve rejected, defensive copies) + full 254-assertion prior regression suite, 278 total, 0 failures. Browser-verified end to end exactly as asked: submitted a Legal Name change ("Jonathan Doe" → "Jonathan Whitmore-Doe") as the client, approved it from `admin-settings-changes.html` (confirmation modal showed the correct Current/Requested values), then reloaded `settings.html` and confirmed the client's Legal Name genuinely now reads "Jonathan Whitmore-Doe" as the real current value — not just the request clearing from Pending. Zero console errors throughout. **Minor structural debt logged, not silently duplicated**: `formatDateDisplay()`/`formatFieldDisplay()` are copied verbatim into `admin-settings-changes.html` rather than shared, since this project has no module system for plain display-formatting helpers (only stateful logic like `engine-core.js`/the sidebar files are actually shared via `<script>` tags) — low-risk since nothing here is a money or security figure, unlike the flagged HYS rate duplication, but two copies can still drift if the display format ever changes in one place and not the other. See §4.51 | If a shared display-formatting module is ever introduced for other reasons, fold `formatDateDisplay()`/`formatFieldDisplay()` into it so `settings.html` and `admin-settings-changes.html` share one copy instead of two |
| 38 | Client Profile Updates rename + Date of Birth removal + client-selector perf check | **COMPLETE (Aug 21, 2026).** (1) Renamed the queue's user-facing label from "Settings Changes" to "Client Profile Updates" across `admin-settings-changes.html` (`<title>`, `<h2>`), `admin-sidebar.js`'s nav entry, and the Overview pending-count card — scoped deliberately to display text only; the file name, nav `key: 'settings-changes'`, and every `engine-core.js` function/store name (`getSettingsChangeRequests`, `marketswave_settings_change_requests`, etc.) were left unchanged, since the task named "the queue/nav label," not a full identifier rename. (2) Removed `dateOfBirth` from `REQUESTABLE_SETTINGS_FIELDS`/`REQUESTABLE_SETTINGS_DEFAULTS`/`validateSettingsFieldValue()` in `engine-core.js`, and from `settings.html`'s display row, modal body, `FIELDS` array, and `formatDateDisplay()`/its `formatFieldDisplay()` branch entirely — `requestSettingsChange('dateOfBirth', ...)` now throws immediately. **One real pre-existing pending record was found and reported, not deleted**: `SETTING-0002` on `CLIENT-0001` (`1985-03-14` → `1985-03-20`, submitted during this session's own earlier browser testing) — confirmed still present, untouched, and fully visible/actionable in `admin-settings-changes.html`, since `approveSettingsChangeRequest()`/`rejectSettingsChangeRequest()` never re-validate a request's `field` against `REQUESTABLE_SETTINGS_FIELDS`. `admin-settings-changes.html` deliberately KEPT its `dateOfBirth` branch in `FIELD_LABELS`/`formatFieldDisplay()` (the one divergence from settings.html's now-identical-minus-dateOfBirth copy) specifically so this and any other legacy record renders correctly instead of showing "undefined" or crashing. (3) Client selector, investigated and reported: a plain native `<select>` built by `admin-sidebar.js`'s `clientSelectorHTML()` — `getAllClients().map()` to a single joined HTML string, one `<option>` per client, set via one `.innerHTML` write per page load. Measured directly, not estimated: added 50 test clients via `addClient()` in a loop (22.7ms total for all 50, ~0.45ms/client), reloaded `admin.html`, confirmed all 52 options render correctly and in order via the accessibility tree, and `document.getElementById('admin-client-selector').options.length` reads in 0.1ms — **no measurable slowdown at 50 clients; this is a forward-looking concern, not a current one**. Native `<select>` elements are browser-engine-rendered and handle hundreds of options natively without custom virtualization; the real cost at higher client counts would be UX (scanning an unsorted flat list to find one client) long before it becomes a rendering-performance problem, and the "reload-to-switch" architecture's per-switch `location.reload()` cost is constant regardless of client count, not affected by option count at all. All 50 test clients and their seeded scoped stores were removed after measuring (350 scoped keys), restoring the browser to its real 2-client baseline. Node-verified: both test files touching `dateOfBirth` (rows 35/37) updated to reflect its removal — `verify-settings-change-queue.js`'s "different field" role swapped from `dateOfBirth` to `address`, plus a new explicit assertion that `dateOfBirth` now throws; `verify-settings-change-admin-queue.js` replaced its `requestSettingsChange('dateOfBirth', ...)` call with a manually-seeded legacy record (mirroring the real `SETTING-0002` scenario) proving it stays visible and resolvable. Full suite: 282 total assertions, 0 failures. Browser-verified: `settings.html` no longer shows a Date of Birth row at all; `admin-settings-changes.html` still correctly renders and labels the legacy `SETTING-0002` record ("Date of Birth", "March 14, 1985 → March 20, 1985"), left unresolved by choice (not approved/rejected) so it remains available as the requested example. Zero console errors throughout. See §4.52 | Client selector redesign itself (separate spec, not started); if/when a shared display-formatting module exists for other reasons, `admin-settings-changes.html`'s now-divergent `formatFieldDisplay()` (it alone still has a `dateOfBirth` branch) should be revisited |
| 39 | Admin nav grouping — Approval Gate / User-Admin Relations / Portfolio Administration | **COMPLETE (Aug 21, 2026).** `admin-sidebar.js`'s `NAV_ITEMS` gained an explicit `group` field per item (`'approval-gate'`, `'user-admin-relations'`, `'portfolio-administration'`, or `null` for Overview) and a new `GROUPS` array defining the three groups' ids, display labels, and render order — the single source of truth for both membership and ordering, so a future tool is added by giving one `NAV_ITEMS` entry an existing (or, if genuinely new, an added) group id, never by re-arranging section boundaries by hand. Per instruction: a future Product Catalog management page would take `group: 'portfolio-administration'`; a future login gate is infrastructure, not a nav item, and gets no entry here at all. Rendering rewritten as a new `navHTML()` function: Overview renders first, ungrouped; each `GROUPS` entry renders as its own section with a visible uppercase label header (`text-[11px] font-semibold uppercase tracking-wide text-white/40`, matching the existing "Viewing Client" label's visual language) followed by that group's items in `NAV_ITEMS` order — a group with zero members renders no header and no section at all, rather than an empty labeled gap (not currently exercised, since all 3 groups have members, but the fallback exists for a future edit that might trigger it). `admin.html`'s Overview page mirrors the same three labels/order/membership: its pending-count card grid was split into three headed sections identical to the nav groups. Settings has no pending-count concept (configuration, not a queue) — its Portfolio Administration card shows the live current advisory fee rate instead of a count, so all three group headers stay visible at a glance on Overview even though the third section has only one, differently-shaped card. No `engine-core.js` changes — this was a pure `admin-sidebar.js`/`admin.html` UI reorganization, confirmed via the full 282-assertion regression suite still passing unchanged. Browser-verified: all three group headers render correctly with the exact requested labels and item membership on every admin page; `admin-deposits.html` and `admin-settings.html` spot-checked directly — active-page highlighting still works correctly within its group, both pages' own content (Pending/History tables, the Advisory Fee Rate form) is completely unchanged, and both nav `href`s resolve correctly; Overview's three card sections render with matching labels/order and the Advisory Fee Rate card shows the same live 1.25% value `admin-settings.html` itself shows. Zero console errors throughout | None outstanding — this was purely organizational, no functional gap introduced |
| 40 | Download client-uploaded documents (admin) | **COMPLETE (Aug 21, 2026).** `admin-documents.html` gained a "Download" button on every client-uploaded document row — both in "Client Uploads Awaiting Review" (next to "Mark Reviewed") and in History (a new action column, shown only for `direction === 'upload'` rows; "From Marketswave" rows correctly show nothing, since the PM already has whatever it published). Same stub pattern already established by `documents.html`'s own existing "Download" button for "From Marketswave" documents — this project has never stored real file bytes anywhere, only the filename a client typed/selected at upload time, so there is no real file content behind either button to actually transfer; clicking shows a "Download Started — &lt;filename&gt; is downloading." toast, consistent with the existing client-side precedent, not a new, differently-behaved control. Adding a 7th table column pushed History's table wider than its card at normal viewport widths — fixed with `overflow-x-auto` on the `#history-list` container (scoped to this one file; the other admin History tables share the same unwrapped-div pattern but weren't independently widened by this change, so they were left alone). No `engine-core.js` changes. Browser-verified: Download fires the correct toast with the correct filename from both the pending list and History, "Mark Reviewed" is unaffected, the table now scrolls within its own card instead of the page, and zero console errors | Real file storage/download — tracked as part of the existing "document storage backend" gap already logged for `documents.html`'s own Download button; not reopened as a new item |
| 41 | Client Management page — new `admin-clients.html` | **COMPLETE (Aug 21, 2026).** The interactive "Viewing Client" `<select>` that previously lived embedded in every admin page's sidebar moved out into its own dedicated page, reachable via a new "Viewing Client" nav item positioned right under Overview (both `group: null`, outside the three functional groups — the same "landing-page-adjacent" treatment Overview itself gets). What remains in the sidebar is a read-only indicator (current client's name/id, linking through to the new page) rather than the switching control itself. `admin-clients.html` lists every real client (from `getAllClients()`) with live financial data — Unallocated/Allocated/Total Portfolio Value — computed via two new optional-`clientId` parameters on `getAccountState(clientId?)`/`getTotalPortfolioValue(clientId?)` (mirroring `getSettingsProfile(clientId?)`'s existing pattern exactly): with no argument, unchanged behavior for every existing caller (the currently active client's in-memory state); with an explicit id, an on-demand direct read of that client's own scoped storage key, without ever switching the active session context — the same "arbitrary client, on demand" discipline `getAllClientDocuments()`/`getAllClientSupportRequests()`/`getAllClientSettingsChangeRequests()` already established for their own domains. A "Currently Viewing" badge marks the active row; "View as this Client" on every other row calls the same `setCurrentClientId()` + `location.reload()` the old dropdown always used — unchanged mechanism, just relocated. Also closes a real, previously-tracked gap: a genuine "Add Client" form (Name, Email, Phone, Account Type, Starting Unallocated Capital) wired to `addClient()`, which was console-only until now (flagged as outstanding in row 32's own writeup). Node-verified first, 13 new assertions covering the optional-clientId behavior specifically (unchanged no-arg behavior; explicit-id reads matching a no-arg read of the same already-active client; an explicit-id read of a *different* client without disturbing the active session id; live-not-cached reads reflecting a later change to the target client's raw storage; graceful `null`/`0` for a nonexistent client rather than a throw; explicit-id reads still correctly isolated after a real active-client switch+reload) plus the full 282-assertion prior regression suite, 295 total, 0 failures. Browser-verified end to end: the sidebar indicator and new nav tab render correctly on every admin page; the Clients list shows John Doe's and Jane Newclient's real, correct balances (spot-checked against known values from earlier phases); clicking "View as this Client" for Jane correctly switched the active client (confirmed via the sidebar indicator updating and the badge moving); Add Client created a real third client ("Marcus Reid," $25,000 starting capital) that appeared correctly in the list — this test client and its seeded scoped keys were removed immediately after verifying, restoring the browser to its real 2-client baseline; confirmed `admin-settings.html` and `admin.html` both still render and function correctly with the new sidebar structure. Zero console errors throughout | None outstanding for this page itself |
| 42 | Client Management page — redesign (search/filter/expand) | **COMPLETE (Aug 21, 2026).** `admin-clients.html` rebuilt from a flat table + always-visible Add Client section into: a header row (live search input matching name or id, case-insensitive substring, plus a small outlined "+ Add Client" button opening a modal instead of a permanent form); single-select filter pills (All/Individual/Joint/Business, styled as a segmented pill control consistent with the admin tool's existing badge language); a 4-column table (Client name+id stacked, Type badge, Portfolio Value via `getTotalPortfolioValue(clientId)` per row, expand chevron); and in-place row expansion (no navigation) revealing email, client-since date, a live per-client pending-items count, and "View as this Client" — which moved from an always-visible per-row button into the expanded area only, same `setCurrentClientId()` + reload mechanism as before, unchanged. Account Type on the Add Client form changed from free text to a 3-option select (Individual/Joint/Business Account) so the new filter pills have well-defined values to match against — the two existing clients already had `accountType: 'Individual Account'`, so no migration was needed. New `engine-core.js` function `getClientPendingApprovalCount(clientId)` sums pending items across exactly the 5 Approval Gate queues (Deposits, Allocations, Sells, HYS Deposits, Client Profile Updates — matching admin-sidebar.js's own 'approval-gate' nav group membership, §4.53) by reading each store's raw scoped key directly for the target client, the same on-demand cross-client discipline `getAccountState(clientId?)` already established (row 41); Documents/Support are deliberately excluded since they belong to the 'user-admin-relations' group, not Approval Gate. Node-verified in two parts, exactly as asked: (1) 12 new assertions for `getClientPendingApprovalCount()` — a fresh client with zero requests correctly returns 0 rather than erroring; the count tracks exactly across all 5 queues one at a time as requests are added; approving or rejecting a request correctly drops it out of the count; full cross-client isolation (CLIENT-0001's count is completely unaffected by CLIENT-0002's activity, and is readable correctly without switching the active session); a nonexistent client returns 0 rather than throwing; (2) 14 new assertions for the page's own search/filter logic (`matchesSearch()`/`matchesTypeFilter()`/`applyFilters()`, duplicated standalone in the test file for DOM-free testing, mirroring the exact functions written into the page) — case-insensitive name search, id search, partial-id search, whitespace-only query treated as empty, each filter pill in isolation, and combined search+filter using AND logic (not OR), confirmed with a deliberately adversarial case: "jan" + Business correctly excludes "Jane Newclient" (Individual) even though her name also contains "jan". Plus the full 295-assertion prior regression suite, 321 total, 0 failures. The "Viewing Client" nav icon was also swapped from a two-person "group" icon to a single-person "user" icon specifically for unambiguous visual distinction from Overview's house icon at the same small sidebar size — a deliberate response to the task's own explicit requirement, not assumed already satisfied. Browser-verified end to end: live search narrows the list on every keystroke (tested against "jane," matching only "Jane Newclient"); filter pills correctly narrow by account type and correctly show an empty state when nothing matches (tested against Business with both existing clients being Individual); rows expand independently and simultaneously, showing the exact live pending count for each (5 for CLIENT-0001, matching the sum of its real known Approval Gate queue counts — 2 Allocations + 1 Sell + 2 Client Profile Updates + 0 Deposits + 0 HYS — cross-checked directly against Overview's own cards; 0 for CLIENT-0002, correctly rendered as a real zero, not blank or an error); "View as this Client" (now only reachable from inside the expanded row) still switches correctly, confirmed via the sidebar indicator updating and a full page reload; the Add Client modal opens/closes correctly and created a real "Acme Holdings LLC" (Business Account, $15,000) that immediately appeared correctly typed and badged, and was found by the Business filter pill — this test client was removed immediately after verifying, restoring the browser to its real 2-client baseline. Zero console errors throughout | None outstanding for this page |
| 43 | Admin sidebar — Client Management label collision + indicator separator | **COMPLETE (Aug 21, 2026).** Two small, purely-cosmetic fixes to `admin-sidebar.js`, no engine or other-page changes. (1) The nav item previously labeled "Viewing Client" was renamed "Client Management" — it collided with the "VIEWING CLIENT" label on the persistent current-client indicator directly above it, reading as the same element twice even though they're genuinely different (one switches/manages clients, the other just displays which one is active). The nav item's `key` (`'clients'`) and `href` (`admin-clients.html`) were left untouched, so active-state highlighting and routing needed no changes — confirmed, not assumed, by clicking through. (2) The indicator block gained a visible `border-b border-white/10` plus `mb-2` (previously just `pb-2` padding, no visual boundary at all) so it now reads as a distinct persistent element sitting above the nav list rather than blending into its first item. Browser-verified: clicking "Client Management" still correctly navigates to `admin-clients.html` and highlights as active there; spot-checked on `admin-deposits.html` too, confirming "Deposits" still highlights correctly as active while "Client Management" reads as a separate, un-highlighted nav item below a now-clearly-bordered indicator; zero console errors on both pages | None outstanding — purely cosmetic, no functional gap |
| 44 | Admin sidebar — removed the persistent "Viewing Client" indicator | **COMPLETE (Aug 21, 2026), explicit product decision, not a bug fix.** The "VIEWING CLIENT / &lt;name&gt; (&lt;id&gt;)" block that used to sit above the nav list in `admin-sidebar.js` was removed entirely — Client Management (`admin-clients.html`) is now the sole place a PM sees or changes which client is selected, rather than that state being surfaced ambiently on every admin page. Removed: the `clientIndicatorHTML()` function itself (markup, styling, and its `getClient(getCurrentClientId())` lookup), and its call site inside `initAdminSidebar()`. Explicitly NOT touched, per instruction: `setCurrentClientId()`/`getCurrentClientId()` in `engine-core.js`, and the actual client-switching mechanism on `admin-clients.html` (`setCurrentClientId()` + `location.reload()`), both confirmed still fully functional. Checked for orphaned code and found none beyond the function itself — `getClient` (only called from the removed function within this file) is still exported by `engine-core.js` and used elsewhere, so nothing to clean up there; no other file referenced `clientIndicatorHTML()`, the `admin-client-selector` id, or the "VIEWING CLIENT" text, confirmed via a project-wide grep. A short explanatory comment was left in place of the removed block (why it's gone, and that the switching logic itself is untouched) — consistent with this project's own convention of documenting removals rather than leaving a silent gap, without leaving any actual dead code. Browser-verified: no gap or leftover empty space where the indicator used to sit on any of the 3 admin pages checked (`admin.html`, `admin-clients.html`, `admin-support.html`) — Overview/the nav list now sits directly below the "MARKETSWAVE PM" header on every page; "View as this Client" on `admin-clients.html` still switches the active client correctly, confirmed directly via `getCurrentClientId()` before and after clicking, not just visually; zero console errors throughout | None outstanding — purely visual removal, no functional gap |
| 45 | Admin sidebar — Dashboard group, Client List rename, re-added subtle indicator | **COMPLETE (Aug 21, 2026).** Three related changes to `admin-sidebar.js`'s nav structure, no engine changes. (1) A new `'dashboard'` entry was added to the `GROUPS` array (label "Dashboard"), positioned first — Overview and Client List (see below) now carry `group: 'dashboard'` instead of `group: null`, so they render through the exact same `navHTML()`/`GROUPS.map()` rendering path every other group already uses, with an identical uppercase-muted header. No new rendering logic was written — the existing group-rendering system handled this with only data changes (the now-fully-unused `ungrouped`/`!item.group` branch in `navHTML()` was removed as a result, since every `NAV_ITEMS` entry has a real group now). (2) The nav item at `admin-clients.html` was renamed from "Client Management" to "Client List" (its third label in one day: "Viewing Client" → "Client Management" → "Client List" — each rename tracked in an inline comment) — reflected in the nav label, `admin-clients.html`'s own `<title>` and `<h2>`, and a stale code comment in `admin.html` that referenced the old "Viewing Client" selector by name. Overview's own pending-count cards were checked and confirmed to contain no reference to either old name — nothing to change there. (3) A subtle "currently viewing" indicator was re-added — deliberately much lighter than the block removed in row 44: a single small muted text line ("Viewing: &lt;name&gt; · &lt;id&gt;", `text-white/40`, no heading, no card background, no border) positioned between the header and the Dashboard group, recomputed fresh via the same `getClient(getCurrentClientId())` read as before on every page load — "live" in the same reload-to-switch sense every other cross-page state in this app already uses. Browser-verified: the Dashboard header renders with identical styling to Approval Gate/User-Admin Relations/Portfolio Administration (confirmed via a zoomed side-by-side screenshot, not just class-name comparison); Overview and Client List render as plain flat rows within it, active-state highlighting working correctly for both; "Client List" reflected everywhere checked (nav, page title, page h2); the indicator read "Viewing: John Doe · CLIENT-0001" at rest and correctly updated to "Viewing: Jane Newclient · CLIENT-0002" immediately after using "View as this Client," confirmed via a fresh zoomed screenshot post-switch; spot-checked on `admin-settings.html` too, confirming consistency across pages. Full 321-assertion regression suite re-run and unaffected (no engine changes). Zero console errors throughout. **The subtle indicator added here was removed again the same day (Approval Gate unification, Aug 21, 2026) — see row 46 and §4.60** — once every Approval Gate page shows its own per-row client context, a page-level "currently viewing" hint became genuinely redundant rather than just lighter-weight | None outstanding — purely organizational/cosmetic, no functional gap |
| 46 | Approval Gate unification — Deposits/Allocations/Sells/HYS Deposits converted to the cross-client aggregation pattern | **COMPLETE (Aug 21, 2026).** Before this task, of the 5 Approval Gate queues, only Client Profile Updates was cross-client (`getAllClientSettingsChangeRequests()` + explicit-`clientId` approve/reject, built stateless from the start — no module-level caching, every call a fresh scoped read/write). Deposits/Allocations/Sells/HYS Deposits were all "ambient": their admin pages only ever showed whichever single client happened to be the active session client, because their resolve primitives (`executeBuy`/`executeSell`/`creditDepositRequest`/`creditHYSDeposit`) read and wrote `engine-core.js`'s module-level `accountState`/`holdings`/`transactions`/`*Requests` variables — loaded ONCE, ambiently, when the IIFE ran. **Full call-chain trace, done before writing any test (as instructed), confirming a naive "just add a clientId parameter" pass would have been insufficient**: `approveAllocationRequest`→`executeBuy`→ touches module-level `holdings`, `accountState`, `transactions`; `approveSellRequest`→`executeSell`→ touches the same three plus re-reads `holdings` for its own re-validation check; `creditDepositRequest`→ touches `accountState`+`transactions` directly (no separate primitive); `creditHYSDeposit`→ touches `transactions` plus `marketswave_hys_pockets` (already a direct scoped access pre-task, never module-cached — the one domain partially correct already) — every one of those module-level touches had to convert to an explicit-`clientId` scoped read/write, not just the 8 top-level approve/reject/credit function signatures. Confirmed via grep that `executeBuy`/`executeSell` had zero external callers and the 8 approve/reject/credit functions were called only from the 4 admin pages in scope, making the signature changes safe within this task's blast radius. **Engine changes**: `executeBuy(clientId, productId, dollarAmount)`, `executeSell(clientId, productId, unitsToSell)`, `approveAllocationRequest(clientId, requestId)`, `rejectAllocationRequest(clientId, requestId, reason)`, `approveSellRequest(clientId, requestId)`, `rejectSellRequest(clientId, requestId, reason)`, `creditDepositRequest(clientId, requestId, confirmedAmount)`, `rejectDepositRequest(clientId, requestId, reason)`, `creditHYSDeposit(clientId, requestId, confirmedAmount)`, `rejectHYSDeposit(clientId, requestId, reason)` — every one now reads/writes ONLY that client's own scoped storage via 3 new shared helpers (`readAccountStateForClient`/`writeAccountStateForClient`, `readHoldingsForClient`/`writeHoldingsForClient`, `readRequestsForClient`/`writeRequestsForClient` per request-queue base key) plus one shared cross-domain helper (`appendTransactionForClient`, since every one of the 4 domains' resolve paths logs a transaction) — no fallback to `getCurrentClientId()` anywhere in any of these chains, at any layer, confirmed by code review of every line each rewritten function touches. `recomputeAllocatedCapital()`'s logic is inlined into `executeBuy`/`executeSell` against the freshly-read client-scoped holdings rather than calling the existing ambient version, which operates on the module-level arrays and must not be touched from this explicit-`clientId` chain. New cross-client aggregators, mirroring `getAllClientSettingsChangeRequests()`'s exact shape: `getAllClientDepositRequests()`, `getAllClientAllocationRequests()`, `getAllClientSellRequests()`, `getAllClientHYSDepositRequests()` (each attaching `clientId`/`clientName` per item). New narrow helper `getTransactionForClient(clientId, txnId)` — added mid-task once `admin-sells.html`'s Realized Return column turned out to need one specific client's transaction without switching the active session, the same on-demand-arbitrary-client discipline as `getAccountState(clientId?)`. The pre-existing no-arg ambient getters (`getDepositRequests()` etc.) and the client-facing `request*()` functions are completely unchanged — confirmed both by code (they still read/write the module-level arrays exactly as before) and by browser-testing `asset-performance.html`/`high-yield-savings.html` continuing to work. **A real architectural side effect surfaced and worked around, not silently absorbed**: because the rewritten primitives now write directly to `localStorage` and bypass the module-level cache entirely, that cache goes stale relative to `localStorage` whenever an explicit-`clientId` call targets the client that also happens to be the currently *active ambient* client in that same page/process — an ambient read immediately afterward (e.g. `getTransactionLedger()`, `getAccountState()`, `getHoldings()`) would show pre-action data until a reload. This never affects the real shipped pages (the 4 admin pages always re-render via the new `getAllClient*()` aggregators, which are always a direct fresh scoped read, never the module cache; client-facing pages always get a fresh full page load, so their module cache is never stale relative to an action that happened on a previous page), but it is a real, general property of this chain now and is worth knowing before writing any future Node test or admin feature that mixes an explicit-`clientId` action with an ambient read in the same process without a reload between them. **Node verification**: for each of the 4 domains individually (not one as a stand-in for all four, per instruction) — created a second client with distinct starting state, resolved an action for client A by explicit id while client B was NOT the active session client, then diff'd client B's raw scoped `localStorage` string byte-for-byte against a pre-action snapshot; repeated in the reverse direction (resolve all 4 of client B's own pending requests while client A is ambient, confirm client A's raw storage untouched); plus reject-path and cross-client-aggregator-surfaces-both-clients checks — 41 new assertions, 0 failures. This is the exact test class that would have caught the historical §4.45 cross-tab corruption bug. Full prior regression suite (12 files) was re-run alongside it: 5 files needed a `reload()` inserted between an explicit-`clientId` action and a subsequent ambient read, exactly the side effect above (not a real regression — those tests were asserting through the ambient getters immediately after an action, which the new architecture no longer keeps in sync without a reload) — after that fix, 346+ assertions across the full suite, 0 failures. **Admin UI**: `admin-deposits.html`/`admin-allocations.html`/`admin-sells.html`/`admin-hys.html` switched from their single-client ambient getter to the new `getAllClient*()` aggregator, each Pending/History row now carries a client name/id badge matching Client Profile Updates' existing visual treatment (`bg-slate-100 text-slate-600` pill), and every Approve/Reject/Credit action reads `clientId` from the row's own `data-client` attribute rather than any page-level state. **Sidebar cleanup**: the subtle "Viewing: [Client] · [CLIENT-ID]" indicator added in row 45/§4.59 was removed from `admin-sidebar.js` again (`clientIndicatorHTML()` function and its one call site) — confirmed via grep that nothing else in the file or project referenced it before removing; genuinely redundant now that every Approval Gate page shows its own per-row client context, so a page-level "currently viewing" hint no longer adds information. `setCurrentClientId()`/`getCurrentClientId()` and `admin-clients.html`'s own "View as this Client" mechanism are completely untouched. **Browser-verified live, the full flow, not just Node-simulated**: seeded a second client (Jane, CLIENT-0002) with one pending item in each of the 4 domains via the console, then for each of the 4 admin pages in turn — confirmed both clients' pending items render with correct per-row client labels, resolved CLIENT-0002's item through the real modal (Credit/Approve), confirmed it moved to History with the correct client label, and confirmed via a direct raw-`localStorage` diff (not just visual inspection) that CLIENT-0001's own account state/holdings/transactions/request queues were byte-identical before and after. Also confirmed `admin-clients.html`'s "View as this Client" for its real remaining purpose: switching the admin tool's own ambient session (verified via `getCurrentClientId()` before/after, persists correctly across admin-page navigation) — and, separately, that this switch does NOT leak into what a client-facing page shows, since `dashboard-sidebar.js` unconditionally pins every client-facing page to `CLIENT-0001` at file-load time regardless of the admin tool's session state (the intended, by-design behavior from the historical §4.44/§4.45 fix, re-confirmed still working correctly here, not a regression). Zero console errors throughout. See §4.60 for the full writeup | None outstanding for these 4 queues' admin UI — still needed: real backend persistence and a login gate for the admin tool, same as every other admin-tool row |
| 47 | Password Reset + 2FA Rework — built cross-client from the start | **COMPLETE (Aug 21, 2026).** The first new admin-triggered domain built cross-client from day one, using the exact discipline the Approval Gate unification (row 46) proved out, rather than being built ambient-first and converted later. New GLOBAL store `marketswave_security_actions_log` (same category as `marketswave_clients`/the Product Catalog — an audit trail across every client, not scoped to one) records every reset: `{ id, clientId, clientName, type: "PASSWORD_RESET" \| "2FA_RESET", reason, performedAt, performedBy: "Portfolio Manager" }`. `resetClientPassword(clientId, reason)`/`resetClient2FA(clientId, reason)` both require an explicit `clientId` and a non-empty `reason` (validated, throws otherwise), do a direct scoped read/write for that client only — no module-level cache anywhere in this domain, matching the Settings Change Request queue's own always-stateless discipline rather than the module-cached pattern row 46 had to convert away from. `getSecurityActionsLog()` is a plain, fresh read (deep-cloned per the established defensive-copy convention) — no module-cached array, so `admin-security.html` always sees the latest log regardless of what page loaded last. **"Force new password" approach, given there is no real login/session system yet (flagged per instruction, not silently decided)**: `resetClientPassword()` sets a per-client flag (`forcePasswordReset`, under new per-client key `marketswave_settings_security`) that `settings.html` checks on every load and uses to gate its own UI client-side — there is no server session to actually invalidate, so this is a client-side UI convenience gate only, not real security enforcement. It doesn't invent a password store either: the existing self-service Change Password form in this project has never persisted an actual password anywhere (there is no real credential store in this codebase at all), and the forced-reset flow doesn't change that — completing the forced form just clears the flag via `clearForcePasswordReset()` (ambient, client-facing) and unlocks the page, mirroring the existing unpersisted stub exactly. Real enforcement needs the login gate + backend session work already tracked as deferred; **this is buildable now only as a client-side gate, and does NOT need to wait on the login gate work to exist in this stub form** — flagged explicitly per instruction rather than assumed blocked. `resetClient2FA()` writes `'disabled'` directly to the exact same raw key/format (`marketswave_settings_2fa`, a bare `'enabled'`/`'disabled'` string) `settings.html`'s own 2FA code already reads, so no client-side code needed updating at all for that read path — it just picks up the reset automatically on next load. **2FA setup flow changed from QR/authenticator to email-code** (`settings.html`): enabling 2FA now generates a random 6-digit code client-side and displays it directly on screen (no real email backend exists, same simulated-delivery pattern used elsewhere in this project for anything that can't really be delivered), and confirmation now checks the client's typed code against that exact generated code rather than accepting any 6 digits. New admin surfaces: `admin-clients.html`'s expanded row gained "Reset Password"/"Reset 2FA" buttons (alongside the existing "View as this Client"), each opening a shared reason-required modal (no silent/reason-less resets) that passes the row's own `clientId` explicitly to the engine call; new `admin-security.html` (grouped under User/Admin Relations in `admin-sidebar.js`, plus a matching Overview card showing total actions logged instead of a pending count, since this is a log, not a queue) shows one chronological table of every reset, newest first. Node-verified first, per instruction: 49 assertions covering validation (empty/whitespace/null reason rejected for both action types), single-client behavior, the `clearForcePasswordReset()` self-service completion path, and — the actual point of this task — per-action cross-client isolation tested individually for BOTH action types, in both directions (reset CLIENT-0001, diff CLIENT-0002's raw storage byte-for-byte; then reset CLIENT-0002, diff CLIENT-0001's), plus a check that resetting one client's 2FA never touches a *different* client's 2FA key. Full prior regression suite re-run alongside it, 395+ assertions total, 0 failures — this domain required zero `reload()` insertions in any existing test file, unlike row 46, precisely because it was never module-cached to begin with. Browser-verified end to end, exactly as asked: triggered both actions from `admin-clients.html` against CLIENT-0001 with real reasons (including confirming the empty-reason validation error surfaces verbatim), confirmed both appear correctly in `admin-security.html` with correct client label/type badge/reason/performer/date; confirmed CLIENT-0001's forced-reset banner renders on `settings.html` showing the actual PM-given reason, blocks the rest of the page, validates the new password (>=8 chars, must match) exactly like the existing Change Password form, and clearing it via a real submission unlocks the page and survives a reload; confirmed the new email-code 2FA flow end to end (wrong code rejected with a specific error, exact displayed code accepted, state persisted as `'enabled'`); confirmed via a raw `localStorage` diff, both directions, that CLIENT-0002 was completely untouched by every action taken against CLIENT-0001. Zero real console errors throughout (the only console entries were a known Chrome-extension messaging artifact unrelated to this app, confirmed by their generic "message channel closed" text and lack of any app file/line reference). See `Marketswave_Project_Handover.md` §4.61 for the full writeup |  None outstanding for the engine/admin/gate-UI itself — still needed, same as every other admin-tool row: real backend persistence, and the login/session system that would let "force new password" become genuine server-side enforcement instead of a client-side gate |
| 48 | Admin Login Gate — session-based passphrase gate in front of every admin page | **COMPLETE (Aug 21, 2026).** **Explicitly a UI-level stub, not real authentication — flagged with the same honesty standard as the forced password-reset gate (row 47), stated plainly on the gate page itself, not just in this register.** A single shared passphrase constant (`ADMIN_PASSPHRASE`, `engine-core.js`) — not a per-PM-account credential, since there is no PM roster or multi-admin-user concept anywhere in this project; one shared gate for the whole internal tool, matching the "shared team passphrase" model rather than inventing individual accounts this phase never asked for. `checkAdminPassphrase(input)` does a plain string comparison and returns a boolean — no hashing, no real credential verification, because there is nothing on the other end of this check to actually protect against a determined visitor (anyone with dev tools can read `ADMIN_PASSPHRASE` directly out of `engine-core.js`, exactly as anyone could always read this entire frontend-only project's source). `setAdminAuthenticated()`/`isAdminAuthenticated()`/`clearAdminAuthenticated()` are `sessionStorage`-backed, mirroring `getCurrentClientId()`/`setCurrentClientId()`'s own existing session pattern — resets per browser session (a fresh tab, or a cleared `sessionStorage`, always requires re-entering the passphrase), never written to `localStorage`, so it never persists beyond the current browser session the way real "remember me" auth would. New `admin-login.html`: a standalone page using the admin tool's own slate/amber Tailwind visual language (not the public site's navy/cream `login.html` styling, since this is unmistakably the internal tool, not the client-facing login) — a passphrase input, a single generic error on failure ("Incorrect passphrase.") that deliberately never distinguishes a wrong passphrase from any other failure mode, since there is no real backend check to differ from in the first place; a visible one-line disclaimer under the form states plainly that this is a UI-level access gate, not real authentication. This page deliberately does NOT load `admin-sidebar.js` at all, so there is no possibility of a redirect loop against itself. **Gating lives in `admin-sidebar.js`, since it already mounts on every admin page (per instruction)** — a raw `sessionStorage` key check runs at the very top of the file, before anything else, including before `engine-core.js` has loaded (the same file-load-time-check-with-a-literal-key-string precedent `dashboard-sidebar.js` already established for its own CLIENT-0001 reset, §4.44/§4.45) — an unauthenticated visitor is redirected to `admin-login.html` as the very first thing that happens on any admin page load. A second guard inside `initAdminSidebar()` itself (using the real `isAdminAuthenticated()` function, available by the time that function runs) provides defense in depth. A new "Log Out" control was added to the sidebar's existing footer block (distinct from the client-facing logout `dashboard-sidebar.js` already has, which is a completely separate mechanism touching a completely separate key) — calls `clearAdminAuthenticated()` and redirects to `admin-login.html`. Node-verified first (15 assertions: correct/incorrect/case-sensitive/whitespace-sensitive/null/undefined passphrase handling, `isAdminAuthenticated()` correctly reflecting state through a full set/clear cycle, state surviving a simulated reload within the same session, state NOT persisting to `localStorage`, and a simulated fresh session — `sessionStorage` cleared — correctly starting unauthenticated again) plus the full prior regression suite. **One unrelated, pre-existing test failure was found and reported, not silently absorbed or fixed**: `verify-step2.js` has one assertion (`account_state.allocatedCapital` hardcoded to an exact figure that depends on a real-wall-clock-date-seeded price tick) that fails against the ORIGINAL, untouched, already-committed baseline of `engine-core.js` just as much as against this session's changes — confirmed directly by running the identical test file against `git show HEAD:engine-core.js`, not assumed. This is a test-fragility issue that predates every task in this session and has nothing to do with the Admin Login Gate (or any other change made today); it was not "fixed" here since doing so was outside this task's scope, but is flagged rather than silently left unexplained. Every other file in the suite: 0 failures. Browser-verified end to end, exactly as asked: navigating directly to `admin.html`, `admin-deposits.html`, and `admin-security.html` while unauthenticated all correctly redirected to the gate; a wrong passphrase showed the generic error and cleared/refocused the input (tested via both the button and Enter-key submission); the correct passphrase authenticated and redirected to `admin.html`, and that authenticated state was confirmed to persist across real page navigation to a different admin page within the same tab/session; "Log Out" correctly cleared the session flag (confirmed directly via `sessionStorage.getItem()`, not just visually) and redirected back to the gate, after which navigating directly to any admin page URL redirected back to the gate again; a simulated fresh browser session (`sessionStorage.clear()` followed by navigation) also correctly required re-entering the passphrase. Zero console errors throughout the entire flow | **Genuinely still needed, explicitly not superseded by this stub**: a real authentication system — real PM accounts (not one shared passphrase), real backend-verified credentials (not a client-side string comparison anyone can read out of the page source), and real session management tied to a real backend. This row closes the "completely wide open, zero friction" gap only; the "properly secured" gap remains fully open and is tracked here as a genuine, unresolved future requirement, not something this gate should ever be mistaken for having solved |
| 49 | Asset Collection extraction — new `asset-collection.html` — plus full admin product management | **COMPLETE (Aug 21, 2026).** Product Catalog stays global/unscoped exactly as already designed — this was a UI-scale and admin-UI task, no data-model change. **Client side**: the product-browsing grid (cards, category tabs, allocation-amount input, Request Allocation button, the `flex-col`/`mt-auto` card-height fix) moved out of `asset-performance.html` into new `asset-collection.html`, unchanged in behavior — same `requestAllocation()` calls, same "Pending PM approval" flow. Return Table and My Requests deliberately stayed on `asset-performance.html` — Return Table shows current holdings and My Requests covers both allocation AND sell requests (sells are tied to holdings shown on that page), neither of which belongs on a pure browse-and-request catalog page. Added: search (by product name) and a genuinely load-bearing category filter (previously cosmetic against a 4-5-product catalog); a "Load More" control (9 cards per page) instead of an unbounded grid — chosen over numbered pagination as the simpler option, reported per instruction, given the existing card markup is a single `.map().join()` render into one container, so Load More just re-renders a larger slice of the same already-filtered array with no page-index bookkeeping needed. `asset-performance.html` now shows a "Browse Asset Collection" link card in the grid's place. No new sidebar nav entry (the locked sidebar menu order stays untouched, per CLAUDE.md) — the new page highlights 'asset-performance' as active instead, the same treatment `deploy-capital.html` already established for a page reached via link rather than a locked nav slot. **Admin side**: new `admin-products.html`, grouped under Portfolio Administration in `admin-sidebar.js` (the exact placement that nav's own standing comment had already named as the anticipated next addition). Reuses Client List's proven list pattern: search (by name), TWO independent filter dimensions (asset class AND risk tier, each its own pill row — Client List only ever had one dimension), each row showing name/class/type/riskTier/minimumInvestment/currentUnitPrice, click to expand for full detail (created date, inception unit price, last price tick) + an Edit action. Add Product form calls `addProduct()` for real (previously console-only) — name/asset class (4 allocatable classes only, `Unallocated / Cash` deliberately excluded from the dropdown since it's a reserved synthetic category representing the Unallocated bucket, not something to multiply)/investment type/risk tier/minimum investment/starting unit price, with explicit on-form copy that the starting price is PM-entered, not a live feed, consistent with the standing scoping decision that real-world market data stays deferred. **Edit Product decision, made and reported per instruction**: `unitPrice` edits are BLOCKED — not just hidden from the form, but rejected by `editProduct()` itself if attempted, since price is meant to move only via the returns engine's own deterministic tick mechanic, and a manual admin overwrite from a general edit form could silently corrupt every client's unrealized-return math for that product. The one real gap this leaves, flagged rather than silently accepted: there is currently no way to correct a data-entry typo in a product's STARTING price after `addProduct()` has already run (no `removeProduct()` exists either) — if that turns out to be a real operational need, it should be a separate, deliberate, clearly-labeled override capability, not folded into this general edit path. New Overview card under Portfolio Administration shows total product count (a plain count, not a pending-count concept, matching the Advisory Fee Rate card's own non-count treatment). **A real, pre-existing latent bug fixed as part of this work, not left for later**: `getAllProducts()`/`getProduct()` previously returned live references into the module-level catalog array/its entries, not defensive copies — the exact bug class Phase 3 already found and fixed once for `getHoldings()`/`getAllocationRequests()`. Harmless while nothing ever wrote back to the catalog outside seed time, but this phase adds `editProduct()`, which mutates a catalog entry in place — confirmed via grep that every existing caller only ever reads the result, never mutates it expecting persistence, so this was safe to fix now rather than leave as a landmine. Node-verified first (46 assertions: validation on required fields for both `addProduct()`/`editProduct()`, `editProduct()`'s blocked-field rejection — `unitPrice`/`id`/`createdAt`/`lastTickDate`/`inceptionUnitPrice` all throw if patched — the new defensive-copy behavior, and, the actual point of the "does this orphan anything" check the task asked for: renaming and reclassifying `PROD-0001` (Nordic Growth Fund, which the demo seed already gives a real holding AND a real transaction) leaves both completely intact and byte-identical except for the live join now correctly showing the new name, proving by direct test — not just by design argument — that a rename/reclassification cannot orphan existing client data, since holdings/transactions only ever reference a product by its immutable PROD-id) plus the full 395+-assertion prior regression suite, 440+ total, 0 failures (the one known pre-existing, unrelated `verify-step2.js` failure — flagged in row 48 — is untouched by this task). Browser-verified end to end, exactly as asked: added a real "Atlas Infrastructure Fund" product from `admin-products.html`, confirmed it appeared correctly on `asset-collection.html` with working search and category filter, and successfully submitted a real allocation request against it, confirmed in `getAllocationRequests()`; edited Nordic Growth Fund's minimum investment from admin and confirmed the client-side card on `asset-collection.html` reflected the new figure immediately (then reverted the edit back to the original seed value afterward, since this was a verification step against real seed data, not an intended permanent change — unlike the new product itself, which was left in place since no `removeProduct()` exists to clean it up and it's a legitimate demonstration of the shipped feature); confirmed `asset-performance.html`'s Return Table and My Requests render exactly as before, unaffected by the page split, and that the new My Requests row for the Atlas Infrastructure Fund allocation (submitted from the OTHER page) appears correctly there too — proof both pages share the same real engine state. Zero real console errors throughout (only the same known Chrome-extension messaging artifact seen elsewhere in this session) | None outstanding for the extraction/admin-UI itself — still needed, same as every other row touching the Product Catalog: real backend persistence, and (flagged, not built) a deliberate "correct a starting-price typo" override capability if that turns out to be a genuine operational need |
| 50 | Client Authentication, Phase 1 — credential storage + signup wiring | **COMPLETE (Aug 21, 2026).** **Reported before any code changes, per instruction**: read `signup.html` directly first — its "Submit Application" handler did literally nothing but `window.location.href = "thank-you.html"`, no `addClient()` call, no `<script src="engine-core.js">` tag at all (confirmed via grep — none existed), and no aggregation of the form's own fields (`full_name`/`email`/`phone`/`password`/`password_confirm`, all present in the DOM but never read for persistence). This meant the full scope described in the task needed building from scratch, not hooking up something partially there. **Storage design decision, made and reported per instruction**: a dedicated new key, `marketswave_client_credentials:<clientId>` — not folded into `marketswave_settings_profile` — since credentials are a distinct security-sensitive concern from profile data, and a separate key means credential-verification code never has to read through (or risk sitting near) an object page-level UI code freely spreads/displays; matches the same reasoning that already gave Account Security its own `marketswave_settings_security` key rather than folding into the profile store. Holds only `{ passwordHash }` — the raw password is never written here or anywhere else. **Engine**: `hashClientPassword(rawPassword)` — async (Web Crypto's `crypto.subtle.digest()` is async-only), uses SHA-256, and is the ONE place in this entire file a raw password ever exists — takes it only as a function parameter, uses it only within that function's own body, returns before the caller can do anything with it except pass the resulting hash straight into `setClientCredentials()`; no module-level variable, no logging, no intermediate object it gets attached to. `setClientCredentials(clientId, passwordHash)`/`verifyClientCredentials(clientId, passwordHash)` — straightforward set/compare per instruction, both take an ALREADY-HASHED password (never raw), explicit `clientId` (stateless, direct-scoped-storage-access-per-call, same discipline as the Settings Change Request queue and the Account Security block — no module-level cache). **CLIENT-0001 seeded with a known demo password, `Marketswave2026!`** (reported here per instruction, since that's the credential needed for testing going forward) — its SHA-256 hex digest is PRECOMPUTED and hardcoded as a constant (`DEMO_CLIENT0001_PASSWORD_HASH`) rather than generated by calling `hashClientPassword()` at seed time, because seeding happens synchronously inside the engine's IIFE while Web Crypto's digest is async-only; introducing an async seeding path for one store would have been a much larger architectural change than this phase asked for. Verified byte-for-byte against an independently-computed Node `crypto.createHash('sha256')` digest of the same string before being hardcoded, not just self-consistency within the new code. Seeding is idempotent — never overwrites an existing credentials record, matching every other seed-if-missing block in this file, confirmed by a direct test that changing CLIENT-0001's credential and reloading does NOT silently reset it back to the demo value. **`signup.html` wiring**: now loads `engine-core.js` (the first time this page has loaded any shared engine — vanilla JS only, no Tailwind dependency, so this crosses the data-layer boundary but not the styling boundary CLAUDE.md documents between the public site and the dashboard family). The submit handler is now `async`: validates step 9 as before, then calls `addClient()` with the real collected `full_name`/`email`/`phone` and an `accountType` mapped from the existing `individual`/`joint`/`entity` selection to `Individual Account`/`Joint Account`/`Business Account` (the exact format `admin-clients.html`'s own Add Client form already uses), then `await hashClientPassword(rawPassword)` followed by `setClientCredentials(newClient.id, hash)`, then redirects to `thank-you.html` — matching every other error-surfacing convention already in this file (`try`/`catch`, `showError()`, the page's own pre-existing `alert()`-based error display, not a new pattern). Fails closed if `engine-core.js` didn't load, rather than silently pretending an account was created. **Explicitly did NOT touch** `login.html`'s actual credential check (still just redirects on any submit) or `dashboard-sidebar.js`'s hardcoded CLIENT-0001 pin — both deliberately deferred to Phases 2/3, so existing demo/testing flows keep working unchanged through this phase. Node-verified first (27 assertions: `hashClientPassword()` determinism — same input always produces the same hash, confirmed both via self-consistency and against an independently-computed Node `crypto` digest of the same string; different passwords, and even a one-character difference, always produce different hashes; `setClientCredentials()`/`verifyClientCredentials()` validation and straightforward set/compare behavior including a client with no stored credentials returning `false` rather than throwing; confirmation the raw password never appears anywhere in what gets persisted; the CLIENT-0001 demo seed verifying correctly and surviving a reload without being re-applied over a real change; and — the actual point of "does this create a real client, not just a UI flow that looks complete" — a full signup-equivalent flow: `addClient()` genuinely grows the Client Registry by one, the resulting client's credentials are genuinely persisted to `localStorage`, verify correctly against the password actually "typed," and are completely isolated from CLIENT-0001's own credentials in both directions) plus the full 440+-assertion prior regression suite, 467+ total, 0 failures (the one known pre-existing, unrelated `verify-step2.js` failure remains untouched). **Browser-verified live, the complete real signup flow, not simulated**: clicked through all 7 visible steps of the actual form as a new "Sarah Whitfield" individual applicant, reached Review & Submit, checked both consent boxes, and clicked the real Submit Application button — redirected correctly to `thank-you.html`, and confirmed via direct `localStorage` inspection that a genuinely new `CLIENT-0003` record was created (correct name/email/phone/`Individual Account` type, Client Registry grew from 2 to 3) with a real persisted credentials record containing only a 64-character hex `passwordHash` field and no trace of the raw password string anywhere; separately confirmed via the real engine functions that the new client verifies correctly against the password actually entered, fails correctly against a wrong password, and is fully isolated from CLIENT-0001 (whose own seeded demo credential was independently confirmed still intact and working) in both directions. Zero real console errors throughout (only the same known Chrome-extension messaging artifact seen elsewhere in this session). The test client (`CLIENT-0003`, Sarah Whitfield) created during this live verification was left in place afterward — no `removeClient()` exists to clean it up, and it's a genuine, honest artifact of the real signup flow working end to end, the same treatment given to the Atlas Infrastructure Fund test product in row 49 | **Phase 2 is now COMPLETE (row 51) — only Phase 3 remains outstanding**: retire `dashboard-sidebar.js`'s hardcoded `sessionStorage.setItem('marketswave_current_client_id', 'CLIENT-0001')` pin now that a real per-client identity can exist via a real login. Also still needed regardless: a real backend (credentials, like everything else in this project, still live only in this browser's `localStorage`); real password-reset email delivery (the existing 4-step UI flow on `login.html` remains a pure stub, unconnected to this credential store); and the Phase 3 (Onboarding, row 3) PM-review-queue gap signup wiring exposes — a client created via self-signup today is immediately indistinguishable from an admin-created one, with nothing marking them as "pending PM review" |
| 51 | Client Authentication, Phase 2 — real login check + session | **COMPLETE (Aug 21, 2026).** Builds directly on Phase 1's credential store (row 50) — does not touch `dashboard-sidebar.js`'s `CLIENT-0001` pin (that's Phase 3). **Engine**: `getClientByEmail(email)` resolves an entered email to a client, case-insensitive/trimmed, returning `null` (not a throw) on no match so `login.html` can fold "unknown email" and "wrong password" into one identical failure with no special case. `setClientAuthenticated(clientId)`/`getAuthenticatedClientId()`/`clearClientAuthentication()` are `sessionStorage`-backed, mirroring `setAdminAuthenticated()`/`isAdminAuthenticated()`/`clearAdminAuthenticated()` exactly, storing the authenticated client's own id (not just a boolean) since — unlike the shared-passphrase admin gate — a real client login has to record which client it actually was. **`login.html`**: the old "any submit redirects after a fixed delay" stub is now a real check — resolve email, hash the entered password via `hashClientPassword()`, compare via `verifyClientCredentials()`. On success, `setClientAuthenticated(clientId)`, then the existing loading-screen/2200ms-delay/redirect-to-`dashboard.html` flow proceeds completely unchanged. On any failure (unknown email OR wrong password), one identical generic error (`"Incorrect email or password. Please try again."`) shows in a new inline `#login-error` banner, styled with this page's own custom CSS (not Tailwind — this page stays inside the locked public/onboarding styling boundary) — no detail ever distinguishes which part failed, same email-enumeration-avoidance principle already used on `admin-login.html`'s passphrase gate, more important here since this page is client-facing. `engine-core.js` is now loaded on `login.html` for the first time. The forgot-password 3-step panel is completely untouched. Node-verified (`verify-client-auth-phase2.js`, 25 assertions: `getClientByEmail()` case-insensitivity/trimming/null-on-no-match; the auth session trio's set/get/clear cycle and its `sessionStorage`-only, no-ambient-default behavior, distinct from `getCurrentClientId()`'s own deliberate default; a full login-flow simulation confirming correct credentials succeed, wrong password fails, unknown email fails, and — the actual point — the two failure results are `JSON.stringify`-identical, not just "both false" by coincidence; and a client created through the real `addClient()`→`hashClientPassword()`→`setClientCredentials()` chain logging in successfully, not just the seeded demo account) plus the full 17-file, 0-failure regression suite (`verify-step2.js` excluded per its pre-existing, unrelated failure — row 48). **Browser-verified live**: logged in as `CLIENT-0001` with the demo password through the real form — succeeded, `marketswave_authenticated_client_id` confirmed `CLIENT-0001` by direct inspection; a wrong password and, separately, a wholly unknown email both produced the identical `#login-error` banner (confirmed via screenshot, not assumed); since Sarah Whitfield's (`CLIENT-0003`, row 50) real signup password was never recorded anywhere by design and so isn't recoverable, a fresh client (`CLIENT-0004`, "Login Phase 2 Test") was created live through the exact real call chain `signup.html` itself uses, then logged in successfully through the real form — `marketswave_authenticated_client_id` confirmed `CLIENT-0004`, proving Phase 2 works for a genuinely self-registered client, not only the seeded demo. Also confirmed, expected and not a bug: the resulting dashboard still showed `CLIENT-0001`'s ("John Doe") data even while logged in as `CLIENT-0004`, since `marketswave_authenticated_client_id` (who really logged in) and `marketswave_current_client_id` (which client's data renders) are now two independently-observed values that Phase 3 alone reconciles. The forgot-password panel was clicked through live (Send Code → Verify Code) and confirmed unaffected. Zero console errors. `CLIENT-0004` was left in place afterward (no `removeClient()` exists), same treatment as `CLIENT-0003`/the Atlas Infrastructure Fund test product; the browser's own login/auth session state was cleared before finishing | Phase 3 — retire `dashboard-sidebar.js`'s hardcoded `CLIENT-0001` pin so every dashboard page actually reflects `getAuthenticatedClientId()` instead of always `CLIENT-0001`. Also still needed regardless: a real backend (this remains a client-side hash comparison against `localStorage`, not server-verified auth), and real password-reset email delivery for the still-stubbed forgot-password flow |

**Genuinely external — these need a real third-party data source, not in-house logic:**

| # | Area | What's stubbed on the frontend now | Why it can't be fully in-house |
|---|------|-------------------------------------|----------------------------------|
| 22 | Dashboard — market data | Market Snapshot cards show static prices | Real-world market prices you don't generate yourself |
| 23 | Dashboard — currency converter | Static demo conversion, doesn't calculate | Real-world exchange rates |
| 24 | Deploy Capital / HYS — crypto | Crypto deposit forms show no real address/confirmation | Verifying on-chain confirmation requires reading the blockchain (own node or a data provider) |

Consider pulling items 22–24 into your own local cache/store periodically rather than
calling out live on every page load, to minimize the external dependency footprint even
further.

---

## 4. Completed Work (By Area)

### 4.1 Public Site Structure
- Multi-page architecture planned from site map
- Pages: Home, Services, Resources, About, Legal, Contact, Login, Signup, Thank You, Dashboard family
- “Client Login” → **Get Access** modal with Login + Sign Up cards
- Stats bar: AUM $900m, 10+ years, International, Multi-Asset
- Contact page: company detail cards + redesigned form + custom dropdowns + frosted section
- Consistent header actions (fixed button sizing)

### 4.2 Get Access Modal
- Login → `login.html`
- Create Account → `signup.html`
- Both buttons use outline style (neither pre-highlighted)

### 4.3 Login (`login.html`)
- Frosted background (`login-bg.jpg`)
- Welcome Back title
- Loading screen → redirect to dashboard
- **Forgot Password multi-step flow (frontend only):**
  1. Enter email  
  2. Enter verification code  
  3. New password + confirm  
  4. Success → back to login  
- “Create an account” → `signup.html`
- Backend integration **booked for later**

### 4.4 Onboarding (`signup.html`) — 9 Steps
1. Account Type (Individual / Joint / Entity) — selectable cards  
2. Personal Details (Name, Email, Phone, Password + strength + Confirm, DOB, Country)  
3. Entity Details (conditional)  
4. Joint Holder (conditional)  
5. Financial Profile (choice panels)  
6. Goals & Preferences  
7. Risk Questionnaire (6 questions, choice-grid panels)  
8. Document Upload (1× ID + 1× Proof of Address)  
9. Review & Submit → `thank-you.html`

- Client-side validation (required fields, password match, age ≥ 18, radios, uploads, consents)
- Progress bar + conditional step visibility
- Inline errors on key fields (password match, required, age)

### 4.5 Thank You (`thank-you.html`)
- Frosted background (`thankyou-bg.jpg`)
- Confirmation + wait for email / review message

### 4.6 Dashboard Shell
- Left sidebar (final menu):
  - Portfolio Overview  
  - Asset & Performance  
  - High Yield Savings  
  - Transactions  
  - Documents & Reporting  
  - Risk Management  
  - **Deploy Capital** (button/link)  
  - Settings  
  - Support  
- Live day + date/time in top bar  
- User footer (demo: John Doe, Individual Account)

### 4.7 Portfolio Overview (`dashboard.html`)
- Prominent Total Portfolio Value card  
- Returns Generated + Best Performing  
- Allocation bars for **5 asset classes**  
- Risk Metrics  
- Market Snapshot cards  
- Simple Currency Converter (static demo)  
- Recent Activity  

### 4.8 Asset & Performance (`asset-performance.html`)
- Summary cards (Allocated / Unallocated / Realized Returns)  
- Return Table (Asset, Class, Capital, Return %, Realized $)  
- Asset Collection grid + category tabs + “Request Allocation”  
- Same sidebar + live clock  

### 4.9 Deploy Capital (`deploy-capital.html`) — COMPLETE
- Two option cards: **Crypto Deposit** / **Bank Transfer**  
- Crypto form (asset, amount, network)  
- Bank form — **expanded** (Aug 18, 2026): split into Sender Information (full legal name, address, phone, email, amount, currency) and Sending Bank Information (bank name, account number, branch address, routing number, SWIFT/BIC — either/or required). Widened to `max-w-4xl` two-column layout. Validation updated accordingly.  
- Success state  
- Sidebar linked from dashboard / asset-performance  

### 4.10 Transactions (`transactions.html`) — COMPLETE
- Summary cards (Total Buys, Total Sells, Net Invested, Revenue/Fees)  
- Filter bar (Date From/To, Type, Asset) — **now functional**: filters combine via AND logic, Reset clears and restores full table, header count updates to reflect visible rows, empty state row shown when no matches  
- Transaction ledger table with type/status badges, `data-date`/`data-type`/`data-asset` attributes on each row for JS filtering  
- Accessibility fixes: filter labels properly linked via `for`/`id`, `name` attributes added for future backend binding, `scope="col"` added to table headers  
- Same sidebar + live clock as rest of dashboard family  

### 4.11 Documents & Reporting (`documents.html`) — COMPLETE (Aug 19, 2026)
- Two-way document hub: **From Marketswave** section (company → client) and **Upload to
  Marketswave** section (client → company), each its own card with its own row list
- Four categories: Contracts, Signature Required, Statements & Reports, General
- Filter bar (Category, Direction, Date From/To) — functional, shared across both sections;
  setting Direction to one side hides the other section entirely; empty-state message shown
  per section when no rows match
- Notification badge pattern, computed live from row state rather than hardcoded:
  - Three header chips (New Documents / Signature Required / Deadline This Week) with counts
  - Sidebar nav badge on "Documents & Reporting" (added to every dashboard page's sidebar,
    not just this page) showing count of documents needing attention
  - Per-row badges: New, Signature Required, Due in N days
  - Clicking a header chip resets filters, scrolls to, and flashes the first matching row
- Sign action: marks a Signature Required document signed in place (badge → "Signed",
  removes Sign button, recalculates all notification counts), toast confirmation
- Download action: stub toast confirmation, clears the row's "New" badge if set
- Upload form: file input + category select → appends a new row to "Your Uploads" with
  today's date and status "Received", toast confirmation, respects active filters
- Remove action on uploaded rows: `window.confirm` then removes row, toast confirmation
- All actions frontend-only per the deferred-backend rule — no persistence, everything is a
  client-side stub with a visible confirmation state
- Same sidebar + live clock as rest of dashboard family
- Verified interactively in-browser (local static server + Chrome automation): filters,
  direction toggle, sign flow, upload flow, notification-chip scroll/flash — no console
  errors. One bug caught and fixed during testing: the filter/count logic was snapshotting
  the upload row list once at page load, so newly-uploaded documents weren't included in
  filtering or counts; fixed to re-query rows live inside `applyFilters()`.

### 4.12 Risk Management (`risk-management.html`) — COMPLETE (Aug 19, 2026, revised 4× same day)
Built, then revised through four passes the same day: (1) initial Risk Meter + Regulatory
Heatmap, (2) added the interactive preview toggle + swapped Time Horizon for a Portfolio
Diversification Score, (3) added "Save as My Risk Profile" with `localStorage` persistence,
(4) reworked Risk Tolerance/Capacity/Diversification into one consistent reactive pattern and
fixed a real bug in the save flow, (5) replaced the gradient bar + separate toggle buttons
with a single gold/mahogany-and-deep-green sliding-pill segmented control. Current state:

- **Risk Meter card — sliding-pill segmented control** (pass 5, replacing the old gradient
  bar): a parchment track (`#EFE6D2`, 999px radius, inset shadow) holds three equal
  Conservative/Balanced/Aggressive segments; a gold/mahogany gradient pill
  (`135deg, #C8860A → #8B5A0F`, dark drop shadow) slides behind whichever segment is
  currently **previewed**, animated via CSS transition on `left`/`width` (280ms
  cubic-bezier), with position/size read live from the clicked segment's
  `offsetLeft`/`offsetWidth` — never fixed percentages. A small dot above each label marks
  the **saved** level specifically: hollow deep-green ring by default, filled parchment when
  the pill happens to be on that same segment. Labels are muted brown by default, bold
  parchment when active. This palette (`.rm-*` CSS classes) is deliberately scoped to this
  one control — explicitly not applied anywhere else on the dashboard. The "Current Profile:
  X" tag and "Preview only — not saved" note both use matching parchment/deep-green tag
  styling; the Save and Reset buttons kept their existing navy styling, unchanged.
- **Preview vs. actual state:** clicking a segment sets `previewLevel` and re-renders
  everything below without persisting anything. "Save as My Risk Profile" (shown only while
  previewing something other than the saved level) sets `actualLevel = previewLevel`,
  writes it to `localStorage` (`marketswave_risk_profile`), and — critically — **explicitly
  re-syncs `previewLevel` to match before re-rendering every dependent piece of state in one
  pass**: pill position, saved dot, active label, the preview indicator, and all three
  breakdown cards. This was added deliberately after a bug report (screenshot showing the
  "Current Profile" badge updated but the toggle/marker still stuck on the previous preview)
  — even though the original save handler was logically sound, the fix makes the full
  re-render explicit and removes any doubt. "Reset to current" reverts `previewLevel` to
  `actualLevel` the same way.
- **Risk Tolerance card:** no longer frozen — always shows the label + description for
  whichever level is currently previewed (`TOLERANCE_DESCRIPTIONS` per level), updating live
  with every segment click, since tolerance *is* what's being previewed.
- **Risk Capacity card:** the value ("Moderate–High") and description never change — capacity
  is a fact about the client, not a function of preview state. A suitability chip beneath it
  compares the previewed tolerance's ordinal (Conservative=1/Balanced=2/Aggressive=3) against
  a fixed `CAPACITY_ORDINAL = 2` ("Moderate", per spec instruction to treat actual capacity
  as ordinal 2 for this demo): "✓ Aligned with your risk capacity" (emerald) or "⚠ Selected
  tolerance exceeds your risk capacity" (amber) — previewing Aggressive is the only level
  that triggers the warning.
- **Portfolio Diversification Score card:** the real score (78/100 — Well Diversified, from
  the actual 32% PE / 22% RA / 18% S&ETF / 12% Crypto / 16% Cash holdings) is the only
  primary content and never changes with the toggle — it's pure static HTML, not JS-bound.
  One compact line below it reacts to the preview: "This is your current allocation." when
  previewing the saved level, or "Under {Level}: {score}/100 ({+/-N} pts), concentrated in
  {top asset}." otherwise — computed from reference model mixes per level (Conservative
  10/20/20/5/45, Balanced 32/22/18/12/16 = actual holdings by design, Aggressive 35/15/20/25/5)
  via the same Herfindahl-Hirschman-style `computeDiversification()` helper used for the real
  score. **Bug found and fixed during this pass:** the delta line used to compare
  `previewLevel === 'balanced'` (hardcoded) instead of `previewLevel === actualLevel` — so if
  a client ever saved a non-Balanced profile, the "matches current holdings" case would never
  fire again correctly. Fixed to compare against `actualLevel`.
- Footer note clarifying this profile will drive portfolio allocation once the portfolio
  engine is built — static reference only for now, consistent with the deferred-backend rule
- **Regulatory Heatmap card (untouched through all revisions):** 2×2 grid — KYC/AML, GDPR,
  SEC, Global Standards — each cell has a one-line description, a status pill (green/amber/red
  capable; demo data uses "Compliant"/green for all four per spec), and a "Last reviewed" date
- Same sidebar + header + live clock as rest of dashboard family; sidebar link updated on
  all other dashboard pages to point to `risk-management.html` (previously `href="#"`)
- **Verification history:** the initial build and the interactive-preview revision were
  checked in-browser (local static server + Chrome automation), no console errors. The user
  then added the no-auto-verify working convention (see Working Agreement below) — the Save
  feature, the Tolerance/Capacity/Diversification rework, and the sliding-pill control were
  all built **without a live browser check**, per that new convention. Worth a manual
  click-through, particularly: saving a non-Balanced level and confirming everything
  (pill, dot, all three cards) updates together, and confirming the pill re-aligns correctly
  on window resize.

### 4.13 High Yield Savings (`high-yield-savings.html`) — COMPLETE (Aug 19, 2026)
- **Separate savings pool**, deliberately not touching `dashboard.html`'s Total Portfolio
  Value — its own "HYS Total Balance" summary card (plus Active Pockets count and Total
  Projected Interest), with an explicit note that the balance is held apart from the main
  portfolio
- **My Pockets:** grid of every open pocket (client can hold several at once), each showing
  type, principal, term + maturity date + day countdown (Fixed Deposit only), projected
  interest (or "N/A — no fixed rate" for As You Want), and status (Active / Matured /
  Withdrawn — auto-transitions Active→Matured on render once `maturityDate` has passed).
  Persisted to `localStorage` under `marketswave_hys_pockets`, array of pocket objects
  (id, type, amount, status, term fields, rate, maturityDate, projectedInterest,
  fundingMethod, withdrawal fields once withdrawn) — a frontend stand-in, no backend.
- **Open a New Pocket modal** (step-driven, `.np-step` show/hide, no page navigation):
  type choice (Fixed Deposit / As You Want) → detail step → funding method (Crypto/Bank,
  same two-card visual pattern as `deploy-capital.html`) → method-specific form → confirm.
  - Fixed Deposit: a Short-Term (1–12mo) / Locked (1–5yr) segmented toggle swaps the term
    `<select>`'s options; rate auto-fills per the spec's bracket table (short: 1–2mo 5%,
    3–4mo 7%, 5–6mo 8.5%, 7–8mo 9.5%, 9–10mo 10.5%, 11–12mo 12%; locked: 1yr 14%, 2yr 16%,
    3yr 17.5%, 4yr 19%, 5yr 20%); a live preview box shows rate, maturity date, and
    estimated interest as the client types; $5,000 minimum enforced with inline error text
    (no `alert()`, unlike `deploy-capital.html`'s validation style — a deliberate
    inconsistency favoring the newer inline-error pattern used on `documents.html` /
    `risk-management.html`)
  - As You Want: amount only, no minimum beyond >0, no term, no rate
  - Interest formula is simple/non-compounding: `principal × (rate/100) × termInYears`
  - Funding forms are trimmed versions of `deploy-capital.html`'s crypto/bank fields (asset
    + network for crypto; name/bank/account/routing-or-swift for bank) rather than an exact
    clone of its full sender-information form — judged sufficient to "match the two-card
    pattern" the spec asked for without duplicating that page's full field set twice more
    on an already-large page
- **Withdraw modal**, opened per-pocket, branches on state:
  - As You Want (any time) and matured Fixed Deposits (short-term or locked): straight to
    destination selection, principal + full interest, no warning
  - Short-term Fixed Deposit before maturity: warning step first ("all accrued interest
    forfeited, principal only") with Cancel / Continue Anyway
  - Locked pocket (1–5yr) before maturity: no Withdraw button rendered at all — card shows
    only a "Locked until maturity" note and the countdown
  - Destination is Crypto (wallet address + asset + network) or Bank (recipient
    name/bank/account/routing-or-swift), same two-card pattern as the deposit side
  - On confirm: pocket flips to `status: 'withdrawn'`, records `withdrawnAmount` (principal
    only if forfeited, principal+interest otherwise) and `withdrawalMethod`; card then shows
    a muted "Withdrawn" history line instead of an action button
- Toast confirmations on every deposit/withdrawal action; all money movement is a stub per
  the deferred-backend rule — no real crypto/bank transfer, no interest-accrual engine
- Same sidebar + header + live clock as rest of dashboard family; "High Yield Savings"
  sidebar link updated on all six other dashboard pages to point here (previously `href="#"`)
- **Not yet verified in-browser.** Built under the new Verification working convention (see
  below), which says not to launch a browser/dev server after changes unless asked. This is
  the largest, most state-machine-heavy page built so far (localStorage persistence, dynamic
  term-mode select rebuilding, conditional warning/no-button withdraw branches) — flagged
  as the strongest candidate on the site for a manual click-through before relying on it.

### 4.14 Settings (`settings.html`) — COMPLETE (Aug 19, 2026, revised same day)
- **Profile / KYC card:** header row with avatar, "Individual Account" badge, and a "KYC
  Verified" status pill using the same green/amber/red 3-state pattern as the Regulatory
  Heatmap on `risk-management.html`. Email and Phone are directly editable inline (click
  Edit → input appears → Save validates format and persists to `localStorage`
  (`marketswave_settings_profile`) → toast confirmation; Cancel discards). Legal Name, Date
  of Birth, Address, and ID/Document are read-only with a "Request Change" button each,
  opening a shared modal (current value, new value, reason for change) that on submit marks
  that field pending in `localStorage` (`marketswave_settings_pending`), swaps the button for
  a "Pending Review" badge, and shows a toast — mirroring the "Pending PM approval" toast
  pattern already established on `asset-performance.html`'s Request Allocation flow. No real
  review workflow — frontend stub only, per the deferred-backend rule.
- **Security section:**
  - Password change reuses `signup.html` step 2's exact strength-scoring algorithm
    (length/uppercase/digit/special-char checks → 5-level Weak→Strong scale with the same
    colors) and match validation, rebuilt with Tailwind markup instead of signup's custom CSS.
    Submit clears the form and shows a toast — no real credential change.
  - 2FA toggle (plain navy `peer-checked` switch, not the gold/green risk-meter palette) — 
    switching on reveals a stub setup panel (placeholder QR graphic + 6-digit code input);
    any 6-digit entry completes to an "Enabled" badge, persisted to `localStorage`
    (`marketswave_settings_2fa`). No real TOTP backend.
  - Active Sessions & Linked Devices: 3 static demo rows (one tagged "This device", no logout
    control on that row) plus "Log out all other sessions". Both use `window.confirm` before
    removing a row — same confirm-then-remove pattern as the "Remove" action on
    `high-yield-savings.html`'s uploaded documents. In-memory only, no persistence — sessions
    aren't meaningful to survive a reload for a demo.
- **Notification Preferences:** a table with the same four notification triggers already
  driving `documents.html`'s badge system (Statements & Reports, Allocation Approvals,
  Document Uploads & Signatures, Deadlines), each with a `peer-checked` toggle (smaller
  variant of the same switch used for 2FA), persisted to `localStorage`
  (`marketswave_settings_notifications`). A footer note clarifies this panel controls
  delivery preferences for notifications already surfaced elsewhere in the dashboard — it
  does not create a second notification system.
- Same sidebar + header + live clock as rest of dashboard family; "Settings" sidebar link
  (in the footer nav section, below Deploy Capital) updated on all seven other dashboard
  pages to point here (previously `href="#"`)
- **Revised same day:** removed the Compliance & Audit Badges section entirely (was a
  display-only cert grid — SOC 2, ISO 27001, GDPR, PCI DSS) and removed the SMS toggle
  column from Notification Preferences, leaving a single Email toggle per row. The
  now-unused `sms` keys were also cleaned out of the JS `DEFAULTS` object. Profile/KYC and
  Security were left untouched.
- **Not yet verified in-browser**, per the Verification working convention, both at initial
  build and after the revision. Given the number of independent interactive pieces (inline
  edit ×2, Request Change modal ×4 fields, password form, 2FA toggle + setup flow, session
  logout ×2 paths, 4 notification toggles), this is worth a manual pass across each control
  before relying on it.

### 4.15 Support (`support.html`) — COMPLETE (Aug 19, 2026)
- **Quick Contact Options (3 cards):**
  - **Call Us:** phone number + hours, "Request a Callback" button opens a modal pre-filled
    with the demo user's name and — reading `marketswave_settings_profile` from
    `localStorage` if present, so it stays consistent with whatever the client edited on
    Settings — their phone number, plus a Best Time to Call select. Submit validates
    name/phone are present, closes the modal, and shows a toast. No real call is scheduled.
  - **Chat with Us:** "Start Chat" opens a fixed bottom-right chat panel. On first open it
    shows a "Connecting you to an agent..." system message for ~1.5s, then a stub agent
    greeting using the demo user's first name. The message input appends client messages as
    right-aligned navy bubbles; each is followed ~1–1.5s later by one of three canned agent
    replies (cycled in order), appended as left-aligned bubbles. Closing and reopening the
    panel keeps the existing conversation (in-memory only — not persisted to `localStorage`,
    since a chat transcript surviving a reload wasn't asked for and isn't meaningful for a
    stub). No real chat backend.
  - **Email Support:** address + a "Copy" button (Clipboard API with a
    `document.execCommand('copy')` fallback via a hidden textarea, since `navigator.clipboard`
    can be flaky outside a secure/permitted context) plus a `mailto:` link as a second option.
- **Open a Dispute:** Reference Number (optional) / Category (5-option select) / Description
  (textarea) / Evidence (file input reusing `documents.html`'s exact upload-button Tailwind
  styling). Submit validates Category + Description are present, generates a sequential
  `DSP-30xx` id, and pushes a new entry (status `Open`) into the same request list used by
  My Requests below — no separate dispute-only store.
- **My Requests:** a unified, div-based (not `<table>`) list combining seeded support
  tickets and disputes filed above, each row showing id (+ reference number if present),
  category, truncated description, a 3-state status pill (Open=amber, In Progress=blue,
  Resolved=emerald — same pill-with-dot visual pattern as the Regulatory Heatmap and
  Settings' KYC badge, remapped to these three statuses since the semantics differ from
  Compliant/Under Review/Action Needed), date opened, and a chevron. Clicking a row toggles
  an inline detail panel (full description + evidence filename or "None attached" + last
  updated). Seeded with 3 static demo entries (one Resolved, one In Progress with evidence,
  one Open) on first load; the whole list persists to `localStorage`
  (`marketswave_support_requests`), so disputes submitted above survive a reload and the
  dispute-id counter continues correctly from whatever's already stored.
- Toast confirmations on every action (callback request, email copy, dispute submit); chat
  replies are canned, not generated — all frontend stubs, no real backend calls, per the
  deferred-backend rule.
- Same sidebar + header + live clock as rest of dashboard family; "Support" sidebar link (in
  the footer nav section, below Settings) updated on all eight other dashboard pages to
  point here (previously `href="#"`) — this was the last remaining `href="#"` sidebar link
  in the entire dashboard family.
- **Not yet verified in-browser**, per the Verification working convention. The chat
  panel's timed states (connecting → greeting → send/reply loop) and the dispute-submit →
  My Requests round trip are the parts most worth a manual click-through.

### 4.16 Shared sidebar + live-clock extraction — COMPLETE (Aug 19, 2026)
Resolved the long-flagged structural debt: sidebar markup and the live-clock script were
duplicated verbatim across all 9 dashboard pages. Before starting, checked whether the
project was a git repo (`git status`) so the working state could be committed first per the
user's ask — **it is not a git repo**, so there was nothing to commit; flagged to the user
rather than silently skipping.

- **`dashboard-sidebar.js`:** a self-invoking module exposing `window.initDashboardSidebar(activePage)`.
  Renders the full sidebar (logo, 6 main nav items, Deploy Capital button, Settings/Support
  footer links, user card) into `document.getElementById('sidebar-mount')` as one `innerHTML`
  assignment, built from a `NAV_ITEMS` array (key/href/label/icon-path, one entry flagged
  `badge: true` for Documents & Reporting) plus two footer-link helpers. Active-vs-inactive
  styling exactly reproduces the two distinct class strings the app already used (main nav:
  `bg-white/10 text-white font-medium` when active; footer nav: same plus `transition text-sm
  font-medium`) — transcribed by reading the real markup on `support.html` (has every nav
  item) rather than reconstructed from memory. Deploy Capital is never treated as "active" —
  confirmed by checking `deploy-capital.html`'s own sidebar, which renders the button
  identically to every other page.
- **Documents & Reporting badge, preserved exactly:** the shared component always renders
  the badge span with `id="sidebar-doc-badge"` and a default text of "2" (the static value
  every non-`documents.html` page always showed). `documents.html`'s own existing script —
  unchanged — still does `document.getElementById('sidebar-doc-badge').textContent = ...`
  to overwrite it with the live-computed count from its doc-row data; this only works because
  `documents.html`'s sidebar-init script tag was placed *before* that existing script tag
  (documented with an inline comment at the call site) — the one page where script order is
  load-bearing. All 8 other pages just show the static "2", identical to before.
- **`dashboard-common.js`:** the live-clock function, defensively null-checking
  `#live-day`/`#live-date-time` before writing (harmless hardening, header markup itself
  wasn't touched), auto-running on load exactly as the inline version always did.
- **Per page:** replaced the raw `<aside>...</aside>` block with
  `<div id="sidebar-mount"></div>`, removed the inline `updateDateTime` function, and added
  the two `<script src>` tags + an `initDashboardSidebar('<key>')` call immediately before
  each page's existing inline script. Page keys: `dashboard`, `asset-performance`,
  `high-yield-savings`, `transactions`, `documents`, `risk-management`, `deploy-capital`,
  `settings`, `support`.
- **Bug found and fixed:** `dashboard.html` and `asset-performance.html` still had a dead
  `href="#"` Transactions sidebar link — never updated when `transactions.html` was built,
  and missed by every later sidebar-link audit in this project (including the note on
  `support.html`'s own build, in 4.15 above, that its own link fix was "the last remaining
  `href="#"` sidebar link" — that claim was incomplete; this Transactions link had been
  missed). The extraction fixed it automatically since `dashboard-sidebar.js` was written
  from a correct, freshly-verified href list.
- **Verification performed (static, no browser, per the Verification convention):**
  confirmed across all 9 files — `<aside>`/`</aside>` tag counts are 0/0 (fully removed, no
  orphaned closing tags — one was caught and fixed on `settings.html` during this pass), each
  file has exactly one `#sidebar-mount`, one `dashboard-sidebar.js` reference, one
  `dashboard-common.js` reference, the correct page-specific `initDashboardSidebar()` call,
  and zero leftover `function updateDateTime` definitions; overall `<div>`/`<script>`/`<body>`
  tag balance holds on every file; every `href` value inside `dashboard-sidebar.js` (including
  the two footer links passed as plain arguments, not object properties) resolves to a file
  that exists in the project. Not browser-tested — that remains the user's to do, alongside
  everything else built since the no-auto-verify convention took effect.

### 4.17 Settings — layout bug fix (Aug 19, 2026, after the sidebar/clock extraction)
After the shared sidebar extraction (4.16), `settings.html` had a layout bug: the page
scrolled far beyond its visible content (large blank area at the bottom) and the sidebar
wasn't staying pinned to the viewport while scrolling, unlike every other dashboard page.
Diagnosed and fixed by Claude Code — root cause and exact fix weren't captured in detail
in this doc at the time, but the symptom (confirmed via user screenshot: sidebar scrolled
down to just the footer/user card, large blank page area below the Notification
Preferences card) is resolved and the user confirmed in-browser afterward that it "behaves
very well now." Worth a spot-check on the other 8 dashboard pages for the same class of
bug (an element not properly removed from document flow when hidden) if anything similar
turns up.

### 4.18 Portfolio Engine, Phase 1 — data layer only (`engine-core.js`) — COMPLETE (Aug 20, 2026)
Foundational shared data model every later engine phase (allocation requests, PM approval,
returns posting, transaction feed, etc.) builds on. **Deliberately does not touch any page's
UI or `<script>` tags in this phase** — no HTML file was modified; `engine-core.js` exists
as a standalone file only, confirmed via grep that no page references it yet.

- **Product Catalog** (`marketswave_product_catalog`): `{ id, name, assetClass,
  investmentType, riskTier, minimumInvestment, unitPrice, inceptionUnitPrice, createdAt }`.
  `id` is permanent (`PROD-0001`, `PROD-0002`, ...), assigned sequentially at seed time and
  by `addProduct()` thereafter — never derived from name, never reused (scans the catalog
  for the highest existing `PROD-XXXX` number and increments). Seeded with 5 products
  mirroring what's hardcoded today: the four assets on `asset-performance.html`'s cards +
  Return Table (Nordic Growth Fund / Private Equity / Growth Fund, European Real Estate
  Trust / Real Assets / REIT, Global Equity ETF / Stocks & ETFs / ETF, Ethereum / Crypto /
  Digital Asset) plus a Cash entry (Unallocated / Cash / Cash) representing the Unallocated
  bucket in the catalog, per spec. **`riskTier` is a judgment call for every product** — none
  of the source pages carry this concept today: Private Equity and Crypto → `aggressive`
  (highest returns shown, PE illiquid); Real Assets → `conservative` (steadiest, income-
  oriented); Stocks & ETFs → `balanced` (middle of the pack); Cash → `conservative`
  (capital preservation by definition). `unitPrice` is derived at seed time as
  `inceptionUnitPrice × (1 + return%)` using each asset's return % from
  `asset-performance.html` (e.g. Nordic Growth Fund's +18.4% → unit price 118.40 against a
  100.00 inception price) — not an arbitrary number.
- **Account State** (`marketswave_account_state`): `{ unallocatedCapital, allocatedCapital,
  assetReturns, advisoryFeeRate }`. `allocatedCapital` is *derived*, not hardcoded — computed
  as `sum(holding.units × product.unitPrice)` across all seeded holdings, guaranteeing it
  can never drift from the holdings by construction. `unallocatedCapital` is then derived as
  `dashboard.html`'s current hardcoded Total Portfolio Value ($1,284,500) minus that
  `allocatedCapital`, so `getTotalPortfolioValue()` reproduces $1,284,500 exactly rather
  than "close to" — verified both by hand arithmetic and by actually running the module
  under Node with a `localStorage`/`window` shim (not a page-level browser check, just
  executing the data module itself) before writing this up. `assetReturns` seeds to `0` —
  "realized returns only," left for a later phase to populate, per the field's own
  docstring in the source spec. `advisoryFeeRate` seeds to `1.25` as specified.
- **Holdings** (`marketswave_holdings`): `{ productId, units, costBasis }`, one entry per
  allocated product (Cash is excluded — it has no holding, since Unallocated capital is a
  top-level Account State field, not "units of a cash product," per the locked portfolio
  engine rule that Unallocated and Allocated are separate buckets). `units` is computed as
  `seedAllocatedValue / unitPrice` (e.g. Nordic Growth Fund: $410,000 / $118.40 ≈
  3,462.8378 units); `costBasis` as `units × inceptionUnitPrice`, i.e. what was originally
  invested before the seeded return applied.
- **API** (bare globals on `window`, matching `dashboard-sidebar.js`'s no-namespace
  convention, not the literal spec list plus two clearly-necessary reader functions for any
  future phase to consume state at all): `getProduct(id)`, `getAllProducts()`,
  `addProduct(product)`, `getAccountState()`, `getHoldings()`, `getTotalPortfolioValue()`
  (unallocated + allocated + assetReturns — the only place this should ever be computed),
  `engineDebugDump()` (console-only `console.table` dump of all three stores plus a live
  recheck that `allocatedCapital` still matches the holdings sum — for manual verification,
  not for any page to call).
- **Load-or-seed pattern:** all three `localStorage` keys are checked together at load; if
  any is missing, all three are re-seeded as one consistent set rather than mixing stale and
  fresh data (avoids a partial-seed inconsistency if, say, only the catalog key existed from
  some future stray write).
- **Verified (not via browser, per the Verification convention):** ran the file directly
  under Node with a minimal `localStorage`/`window` shim — confirmed all 5 products seed
  with the correct schema, `getAccountState()` returns
  `{ unallocatedCapital: 205520, allocatedCapital: 1078980, assetReturns: 0,
  advisoryFeeRate: 1.25 }`, `getTotalPortfolioValue()` returns exactly `1284500`, summing
  `holdings units × product unitPrice` independently reproduces `allocatedCapital` exactly
  (`1078980 === 1078980`), and `addProduct()` correctly assigns the next sequential id
  (`PROD-0006` after the 5 seeded products). This exercised the module's own logic, not any
  page's UI — no HTML file was touched or needs re-verifying.

### 4.19 Portfolio Engine, Phase 2 — NAV-tick returns engine (`engine-core.js`) — COMPLETE (Aug 20, 2026)
Extends the Phase 1 data layer with simulated price movement. **Still deliberately does not
touch any page's UI or `<script>` tags** — no HTML file was modified this phase either
(confirmed via file mtimes: every `.html` file predates Aug 20, only `engine-core.js` was
touched).

- **`RISK_TIER_RETURN_CONFIG`**: `{ conservative: { annualReturnMean: 0.06,
  annualVolatility: 0.04 }, balanced: { 0.11, 0.10 }, aggressive: { 0.18, 0.28 } }`, exactly
  as specified — not silently adjusted. **Flagged, per instruction, rather than changed:**
  the `aggressive` tier is shared by Private Equity and Crypto products (see §4.18's
  `riskTier` judgment calls), but real-world crypto volatility usually runs well above PE's.
  28% annualized is a reasonable single compromise value for a shared demo tier, not a
  claim that PE and Crypto genuinely share a risk profile — worth splitting into separate
  tiers in a later phase if the two need to diverge.
- **Deterministic daily tick**: GBM discretization,
  `dailyReturn = dailyMean - 0.5×dailyVariance + dailyVolatility×Z`, `dailyMean =
  annualReturnMean/365`, `dailyVolatility = annualVolatility/√365`, new price =
  `oldPrice × exp(dailyReturn)`. `Z` is a standard-normal variate from a **seeded** PRNG, not
  `Math.random()`: FNV-1a hashes `productId + '|' + dateStr` to a 32-bit seed, which feeds a
  mulberry32 generator, which feeds a Box-Muller transform. Same product + same calendar date
  always produces the same `Z`, and therefore the same price, no matter how many times or
  from how many places it's computed — a re-run or a page reload never re-rolls history.
- **Lazy catch-up, not a live ticker**: each catalog product now carries `lastTickDate`.
  `settleProduct(id)` walks unit price forward one simulated day at a time from
  `lastTickDate` to the real `today` (UTC calendar date), then persists the new price and
  `lastTickDate`. `settleAllProducts()` runs this for every product, then calls
  `recomputeAllocatedCapital()` so Phase 1's "`allocatedCapital` is derived, never set
  independently" invariant keeps holding once prices move. Both are called once,
  synchronously, right after the load-or-seed block resolves — no `setInterval`, no
  background timer. Cash is explicitly skipped in `settleProduct` (no risk-tier return
  config applies to it; it doesn't hold units).
- **Advisory fee**: `getAdvisoryFeeAccrued(periodDays) = allocatedCapital ×
  (advisoryFeeRate/100) × (periodDays/365)`; `setAdvisoryFeeRate(newRate)` throws
  `Error('Advisory fee rate must be a positive number.')` for anything that isn't a positive
  finite number.
- **Seed adjustment for Phase 2**: seed products now set `lastTickDate` to *today* (the day
  the engine first seeds) rather than each product's `createdAt`, and the auto-settle call
  runs immediately after seeding. This is deliberate: if `lastTickDate` seeded to
  `createdAt`, the very first load would immediately walk forward however many days have
  elapsed since seeding and change prices right away, breaking Phase 1's exact
  `getTotalPortfolioValue() === 1284500` guarantee before anyone ever saw it. Seeding
  `lastTickDate` to "today" means a brand-new install is a same-day no-op — Phase 1's numbers
  hold exactly until a real day boundary is crossed.
- **Verified (Node + `localStorage` shim, not a browser) — two properties required by spec,
  plus one methodology correction along the way:**
  - *Same-day no-op*: fresh seed → prices/`lastTickDate` unchanged, `getAccountState()` and
    `getTotalPortfolioValue()` identical to Phase 1's seeded values. Passed on the first try.
  - **Caught and fixed a test bug before trusting the result:** the first attempt at
    simulating "30 days passing" mutated the raw stored JSON directly in the same Node
    process *after* `engine-core.js` had already been `require()`'d — but the module reads
    `localStorage` once, into its own closure state, at load time, so that mutation was
    invisible to it. The result looked passable (prices unchanged, "idempotent") but was
    actually a false positive: the day-walk loop never ran at all, and the "idempotency"
    check was trivially true because nothing had changed in either pass. Re-did it correctly
    by mutating the stored data, then clearing Node's `require` cache and re-`require`-ing
    the module — which forces its IIFE to re-run and re-read `localStorage` from scratch,
    the same way a real browser re-runs the script fresh on every page load. This is
    reported here in the interest of the same "verify before trusting" discipline expected
    of documentation claims elsewhere in this project.
  - *30-day forward walk, corrected*: all 5 unit prices genuinely moved (e.g. Nordic Growth
    Fund 118.40 → 152.15, Ethereum 109.10 → 115.97), `allocatedCapital` and
    `getTotalPortfolioValue()` recomputed accordingly (up from $1,284,500 to $1,414,297.96,
    entirely attributable to price movement, not any allocation change).
  - *Idempotency, corrected*: re-loading the module again on the same simulated day (no
    further date change) produced byte-identical prices to the prior load — confirmed `true`.
  - *Tier-spread spot check, two independent runs (30-day and, separately, 45-day forward
    walks — different date ranges produce different seeded `Z` draws)*: in both runs, the
    `aggressive`-tier products moved substantially more than the `conservative`-tier product
    — run 1: Nordic Growth Fund (aggressive) +28.5%, Ethereum (aggressive) +6.3%, European
    Real Estate Trust (conservative) -1.1%; run 2: Nordic Growth Fund +37.0%, Ethereum +5.7%,
    European Real Estate Trust +0.2%. Conservative stayed within ~1% of its seed price in
    both runs while aggressive swung by several percent to tens of percent — consistent with
    the 7× volatility ratio (28% vs 4%) built into the config, and consistent across two
    independently-seeded runs rather than a single lucky draw.
- **API additions** (bare globals, same convention as Phase 1): `settleProduct(id)`,
  `settleAllProducts()`, `getAdvisoryFeeAccrued(periodDays)`, `setAdvisoryFeeRate(newRate)`.

**Unrealized return preview — same-session follow-up (Aug 20, 2026):**
- `getUnrealizedReturn(productId)`: `(units × current unitPrice) − costBasis` for that
  holding; `0` if no holding exists for the product (e.g. Cash, which has none by design).
- `getUnrealizedReturnPercent(productId)`: the above as a percentage of `costBasis`.
- `getTotalUnrealizedReturns()`: sum of `getUnrealizedReturn()` across every current
  holding — the live "preview" figure. Deliberately distinct from Account State's
  `assetReturns`, which stays realized-only per the locked rule (nothing here writes into
  that field, or into `localStorage` at all — these are pure on-demand reads computed from
  current holdings + current unit prices, not a recorded event).
- **Verified (Node, not browser):** on a fresh seed, `getTotalUnrealizedReturns()` = the sum
  of each product's baked-in seed return ($124,843.61, matching the seeded return % per
  product exactly); Cash correctly returns `0` (no holding). After rolling `lastTickDate`
  back 30 days and forcing a fresh module load (same technique as the Phase 2 price-tick
  re-verification above — mutate stored data, then clear the require cache and re-`require`
  so the IIFE actually re-reads it), `settleAllProducts()` genuinely moved unit prices and
  `getTotalUnrealizedReturns()` changed accordingly, from $124,843.61 to $254,641.58 —
  confirming it tracks live price movement rather than being cached or stale. A second,
  same-day `settleAllProducts()` call left the total unchanged (idempotent, as expected).
  Cross-checked against `allocatedCapital − sum(costBasis)`: matched to within $0.01 — the
  cent-level gap is a rounding-order artifact (this function rounds each holding's unrealized
  return individually before summing, while `allocatedCapital` rounds one aggregate sum), not
  a bug; per-product figures, which is what any future UI would actually display, are exact.
  No new `localStorage` keys were written — confirmed only the original three Phase 1 keys
  exist after these calls.
- **API additions:** `getUnrealizedReturn(productId)`, `getUnrealizedReturnPercent(productId)`,
  `getTotalUnrealizedReturns()`.

### 4.20 Portfolio Engine, Phase 3 — transaction mechanics (`engine-core.js`) — COMPLETE (Aug 20, 2026)
Extends Phases 1-2 with the allocation request/approval gate and the actual buy/sell
execution primitives. **Still deliberately does not touch any page's UI or `<script>` tags**
— confirmed via file mtimes that every `.html` file still predates Aug 20.

- **Allocation Request Queue** (`marketswave_allocation_requests`): `{ id, productId, amount,
  status: 'pending'|'approved'|'rejected', requestedAt, resolvedAt, transactionId, reason }`
  (`reason` is a natural addition beyond the originally-listed schema, populated only on
  rejection — needed to actually fulfil "`rejectAllocationRequest(requestId, reason)`... marks
  'rejected' with resolvedAt + reason"). `requestAllocation(productId, dollarAmount)` models
  the locked "client requests → PM approves/rejects → THEN money moves" rule literally: it
  validates and appends a pending record and touches nothing else — no Account State field,
  no holding, no transaction. Loaded independently of the Phase 1 catalog/account/holdings
  trio (a separate load-or-init block defaulting to `[]`) rather than folded into that
  all-or-nothing seed check, specifically so an existing install's real portfolio data is
  never wiped just because this new key didn't exist yet.
  - **Judgment call, flagged per instruction rather than silently decided:**
    `requestAllocation()` rejects any amount greater than *current* `unallocatedCapital`,
    even though a client might reasonably expect more capital to land before a PM gets to
    approving the request. Implemented the stricter check — a client having to re-request is
    a better failure mode than an approval that could silently overdraw
    `unallocatedCapital` — but this is a real design choice, not the only reasonable one; a
    later phase might want a "pending/reserved capital" concept requests can draw against
    instead.
  - **Additional judgment call, not asked for but following directly from the locked
    portfolio rules:** `requestAllocation()` also rejects the Cash product outright (`Cannot
    request an allocation into Cash...`), since Cash represents the Unallocated bucket
    itself — the same reasoning that already gives Cash no HOLDINGS entry (§4.18) and no
    price tick (§4.19's `settleProduct()` skips it).
- **Execution primitives:** `executeBuy(productId, dollarAmount)` settles the product's price
  first (never executes against a stale tick), converts dollars to units at the now-current
  price, extends an existing holding or creates a new one, decrements
  `unallocatedCapital`, calls `recomputeAllocatedCapital()`, and appends a `BUY` transaction.
  `executeSell(productId, unitsToSell)` validates the holding covers the requested units,
  settles price first, computes `saleValue = unitsToSell × currentUnitPrice`, and splits cost
  basis **proportionally against the whole holding** (`costBasisPortion = holding.costBasis ×
  (unitsToSell / holding.units)`) — average-cost-basis accounting, not FIFO/LIFO discrete-lot
  tracking, called out directly in the code as a deliberate simplification since holdings
  aren't modeled as separate lots. `unallocatedCapital` gets the cost-basis portion back
  (principal only); `assetReturns` gets `realizedReturn = saleValue − costBasisPortion`
  separately (can be negative — a loss is recorded exactly as honestly as a gain, per the
  locked rule that returns are tracked separately from allocation and never silently
  adjusted). A holding whose remaining units round to ~0 is removed from the array entirely
  (not left behind as a zeroed placeholder).
- **Approval workflow:** `approveAllocationRequest(requestId)` requires the request to still
  be `pending`, calls `executeBuy()` internally with the request's own `productId`/`amount`,
  then marks the request `approved` with `resolvedAt` and the resulting `transactionId`.
  `rejectAllocationRequest(requestId, reason)` requires `pending` too, marks `rejected` with
  `resolvedAt` + `reason`, and moves no money at all.
  - **Judgment call, flagged per instruction:** only the buy side has a pending/approval
    gate. `executeSell()` runs directly with no equivalent queued step, since the spec only
    described an approval gate for allocation (buy-side) requests — worth reconsidering if
    sells should also require PM sign-off in a later phase.
- **Transaction Ledger** (`marketswave_transactions`): `{ id, date, productId, type:
  'BUY'|'SELL', units, price, totalValue, realizedReturn, status: 'Completed' }`, sequential
  `TXN-XXXX` ids via the same `nextSequentialId()` pattern as `PROD-XXXX`/`REQ-XXXX`.
  `realizedReturn` is `null` on `BUY` rows (nothing realized on a purchase).
  `getTransactionLedger()` returns the full array.
- **Real bug caught and fixed mid-build, before it reached verification:** the first version
  of `getHoldings()` (Phase 1) and the new `getAllocationRequests()` both returned
  `array.slice()` — a shallow copy of the *array*, but each holding/request *object* inside
  was still the same live reference as the engine's internal state. Since `executeBuy()` /
  `executeSell()` mutate holding objects in place (`holding.units += units`), and
  `approveAllocationRequest()` / `rejectAllocationRequest()` mutate request objects in place,
  a caller that captured a "before" snapshot via `getHoldings()` or `getAllocationRequests()`
  and then called those functions was actually looking at the *same, now-mutated* object —
  caught while writing the verification test below (a "before vs. after" units comparison
  came back `false` when it should have been `true`). Fixed both to deep-clone each element
  (`array.map(x => Object.assign({}, x))`), matching `getAccountState()`'s existing
  defensive-copy convention. `getTransactionLedger()` needed no such fix — transaction
  objects are only ever pushed once, never mutated after creation.
- **Verified (Node, not browser) — every property the spec asked for, checked directly
  rather than assumed:**
  - `requestAllocation()` alone: `unallocatedCapital`, `allocatedCapital`, and the holdings
    array all byte-identical before/after — confirmed via direct equality and JSON-string
    comparison, not just spot-reading a couple of fields.
  - `approveAllocationRequest()`: `unallocatedCapital` dropped by exactly the requested
    amount; the existing Global Equity ETF holding's units and cost basis grew; a
    transaction record was created; `allocatedCapital` was independently re-derived from
    `getHoldings() × getProduct().unitPrice` outside the engine's own
    `recomputeAllocatedCapital()` and matched exactly (`1083980 === 1083980`).
  - `rejectAllocationRequest()`: confirmed zero change to `unallocatedCapital`,
    `allocatedCapital`, or the holdings array (JSON-string equality before/after).
  - Partial `executeSell()`: independently recomputed `costBasisPortion` and
    `realizedReturn` by hand from the pre-sell holding snapshot (not trusting the function's
    own output) and both matched the transaction record exactly;
    `unallocatedCapital` increased by exactly the cost-basis portion; `assetReturns` changed
    by exactly the realized return; the remaining holding's units and cost basis matched
    independently-recomputed expected values to within floating-point tolerance.
  - Full `executeSell()` (selling every remaining unit): confirmed the holding was actually
    removed from the array (`array.length` dropped by one, and no entry for that
    `productId` remains) rather than left behind zeroed out.
  - Round-trip Total Portfolio Value: bought $20,000 into Ethereum, then immediately sold
    back the exact units just bought, same day (no price tick in between).
    `getTotalPortfolioValue()` was **exactly** identical before and after
    ($1,284,500 → $1,284,500) — the real end-to-end proof that money doesn't leak or
    duplicate across a buy/sell round trip. **Worth flagging:** the sell's own
    `realizedReturn` on that round trip was *not* ~$0 (it showed a $1,479.68 gain) — this is
    the expected, correct consequence of average-cost-basis accounting: the sold units are a
    proportional slice of Ethereum's *entire* blended holding (original seed units bought at
    the $100 inception price + the newly-bought units at the current $109.10 price), not a
    specific-lot match to only the units just purchased. The Total Portfolio Value invariant
    — the actual thing the spec asked to confirm — held exactly regardless; the nonzero
    per-trade realized return is a property of the accounting method chosen, not a leak.
- **API additions:** `requestAllocation(productId, dollarAmount)`,
  `approveAllocationRequest(requestId)`, `rejectAllocationRequest(requestId, reason)`,
  `getAllocationRequests()`, `executeBuy(productId, dollarAmount)`,
  `executeSell(productId, unitsToSell)`, `getTransactionLedger()`.

### 4.21 Portfolio Engine, Phase 4a — wire `dashboard.html` to `engine-core.js` — COMPLETE (Aug 20, 2026)
The first phase that actually touches page HTML/JS. `engine-core.js` is now loaded on
`dashboard.html` the same way `dashboard-sidebar.js` is (`<script src="engine-core.js">`,
right after the shared sidebar/clock scripts, before the page's own inline script — so by
the time the page script runs, the engine has already auto-seeded/auto-settled). The page's
inline script calls `settleAllProducts()` once up front, then reads every value below from
the engine rather than hardcoding it.

- **Renames only, values left as-is:** "Returns Generated" → "Asset Returns", "Best
  Performing" → "Best Performing Class" — the user's instruction explicitly scoped this to a
  label rename, distinct from every other item which said "read from X." Left both cards'
  dollar figures hardcoded ($142,800 / "Private Equity +18.4% YTD") rather than expanding
  scope unprompted. **Flagged:** Account State's `assetReturns` is realized-only and is
  currently `0` on a fresh seed (nothing has been sold yet in a typical browsing session) —
  wiring "Asset Returns" to it literally would show `$0`, which would read as a regression
  compared to today's demo number, not an improvement. Both cards are natural Phase 4b/4c
  candidates once there's a real story for what should drive them (`getTotalUnrealizedReturns()`
  for the returns figure; a per-asset-class comparison for "best performing").
- **Total Portfolio Value:** `<p id="tpv-amount">` now set from `getTotalPortfolioValue()`.
  The "+4.2% this month" growth badge and "Updated just now" text underneath were left
  untouched — not asked for this phase, and there's no engine-tracked "value 1 month ago" to
  honestly compute that badge from yet.
- **Pie chart + legend:** holdings are grouped by `product.assetClass` (summing
  `units × current unitPrice`), plus `accountState.unallocatedCapital` as its own slice, each
  divided by `getTotalPortfolioValue()` for a percentage — computed from the engine, not
  hardcoded. Colors are the scoped exception given: Private Equity `#8B5A0F`, Real Assets
  `#1B3D2A`, Stocks & ETFs `#C8860A`, Crypto `#D4A843`, Unallocated/Cash `#E8D5A8` — applied
  to the pie slices **and** the legend dots together (the legend is now JS-generated from the
  same `labels`/`colors`/`percentages` arrays as the chart, replacing 5 hardcoded rows, so the
  two can never visually drift apart). The canvas's `aria-label` is also generated live
  instead of the old hardcoded "32%, 22%..." string. Sizing: the chart's container went from
  a fixed `w-52 h-52` to `max-w-[13rem]` growing through `sm:`/`md:`/`lg:`/`xl:`/`2xl:` up to
  `max-w-[22rem]`, paired with `aspect-square` so it stays circular without needing matching
  height breakpoints — `responsive: true` / `maintainAspectRatio: false` (already set) let
  Chart.js resize the canvas to fill whatever the container's current breakpoint gives it.
- **Risk Metrics card**, all three rows replaced: **Cash Reserve** =
  `unallocatedCapital / getTotalPortfolioValue()`, badge reads "Poor" (red) below 20% or
  "Adequate" (amber) at/above it, with the live percentage shown alongside. **Set Risk
  Profile** reads `localStorage['marketswave_risk_profile']` using the exact same
  key/validation/default as `risk-management.html`'s own script (valid values
  `conservative`/`balanced`/`aggressive`, default `balanced` if unset or invalid) — so the two
  pages can never silently disagree about what "the" saved risk profile is. **Allocation
  Utilization** = `allocatedCapital / getTotalPortfolioValue()` as a plain percentage, no
  pass/fail styling (informational only).
- **Recent Activity card:** reads the 3 most recent rows from `getTransactionLedger()`
  (`.slice(-3).reverse()`) — genuinely the same data structure as the (not-yet-wired)
  Transactions page ledger, not a lookalike copy. **Flagged, real behavior change:** a fresh
  engine seed starts with **zero** transactions (nothing has been bought/sold yet), so this
  card now shows an explicit "No recent activity yet." empty state by default, replacing the
  three always-present hardcoded demo rows (Dividend received / Capital allocated / Statement
  available) that were there regardless of any real activity. This is the correct behavior
  once the card means what it says, but it is a visible change from every prior screenshot of
  this page. BUY rows show a navy dot ("Capital allocated — {product}"); SELL rows show
  emerald (gain) or red (loss) depending on `realizedReturn`'s sign ("Position sold —
  {product}", with the realized $ amount shown).
- **Verified — Node dry-run of the actual page script, not just a syntax check:** extracted
  `dashboard.html`'s inline `<script>` blocks and ran the engine-wiring one directly under
  Node with the same `localStorage` shim used for Phases 1-3, plus minimal `document`/`Chart`
  stubs (fake elements exposing `textContent`/`innerHTML`/`className`/`setAttribute`,
  capturing whatever the real DOM calls would have set) — this executes the actual logic,
  not just confirms it parses. Confirmed: `tpv-amount` reads `$1,284,500` on a fresh seed
  (matches Phase 1's exact-match guarantee); the 5 pie percentages sum to exactly 100; Cash
  Reserve correctly showed "Poor (16.0%)" with the red badge class on a fresh seed (16% is
  below the 20% threshold); Allocation Utilization showed "84.0%" (100 − 16, consistent);
  risk profile defaulted to "Balanced" with nothing saved, and correctly showed "Aggressive"
  after `localStorage.setItem('marketswave_risk_profile', 'aggressive')`; Recent Activity
  correctly showed the empty state on a fresh seed, and after generating one approved
  allocation request (`PROD-0003`, $5,000) and one partial sell (`PROD-0004`, 50 units) via
  the Phase 3 API, correctly rendered both as a navy "Capital allocated" row and an
  emerald/red "Position sold" row with the right realized-return sign and formatting. All 3
  of the page's inline `<script>` blocks were also confirmed syntactically valid via
  `new Function(...)` before this dry run.
- **Verified in an actual browser**, per the user's explicit confirmation — local static
  server, screenshots at multiple viewport widths (420px through 1800px, chart visibly
  scaled with breakpoint), zero console errors beyond the pre-existing Tailwind CDN
  production warning present on every dashboard page. **Also verified the cross-page
  `localStorage` contract live, not just logically**: set the risk profile to Conservative
  on `risk-management.html`, saved, navigated to `dashboard.html`, confirmed "Set Risk
  Profile" updated to "Conservative" live, then restored it to Balanced afterward so no
  altered demo state was left behind.

### 4.22 Portfolio Engine, Phase 4b — wire `asset-performance.html` to `engine-core.js` — COMPLETE (Aug 20, 2026)
Same pattern as Phase 4a: `engine-core.js` loads the same way `dashboard-sidebar.js` does,
the page calls `settleAllProducts()` once on load, then every value below reads from the
engine instead of a hardcoded number. Only `asset-performance.html` was modified — confirmed
via file mtimes.

- **Renames:** "Total Allocated" → "Total Allocated Capital", "Unallocated / Cash" →
  "Unallocated Capital", "Total Realized Returns" → "Total Asset Returns", and every
  literal "PM" spelled out to "Portfolio Manager" (the Asset Collection subheading, the
  success-toast copy, and the new error-toast copy) — confirmed via grep that no bare `PM`
  token remains in the file.
- **Summary cards:** Total Allocated Capital = `getAccountState().allocatedCapital`,
  Unallocated Capital = `.unallocatedCapital`, both with their "% of portfolio" subtitle
  recomputed from `getTotalPortfolioValue()` too (not left stale) — leaving the subtitle
  hardcoded while the headline number went live would have made the card visibly
  self-contradict the moment either number drifted from its original seed value, so this
  was treated as required for internal consistency rather than optional scope. **Total
  Asset Returns is deliberately the live `getTotalUnrealizedReturns()` preview, not Account
  State's realized-only `assetReturns`** (which stays `$0` until something actually sells) —
  labeled with a small "Unrealized" pill next to the card title and a "Live preview — not
  yet realized" subtitle, per the explicit instruction not to let this read like a realized
  number.
- **Return Table:** one row per current holding (`getHoldings()` joined against
  `getProduct()`). **Flagged, a real and visible number change, not a bug:** "Capital
  Allocated" now shows `holding.costBasis` (what was actually invested, at inception price)
  rather than the old hardcoded figures, which were actually *current value* dressed up as
  "Allocated: $410,000" etc. — e.g. Nordic Growth Fund now shows $346,284, not $410,000. The
  new number is the more correct definition of "capital allocated" (principal invested, not
  current market value), and it's exactly what the spec asked for (`Capital Allocated
  (holding.costBasis)`), but it's a visible drop worth knowing about before comparing
  screenshots. Return % reads from `getUnrealizedReturnPercent()`. **Realized Amount
  (corrected same-day, Aug 20, 2026):** initially shipped as a hardcoded `—` for every row
  per the original instruction's literal wording; the user then asked for the more accurate
  version — it now sums `realizedReturn` across every `SELL` transaction for that product
  from `getTransactionLedger()`, showing `—` only when that sum is genuinely zero. Looks
  identical to the original on a fresh seed (no sells exist yet, so the sum is `0` for every
  product) but now stays correct if a sell is ever executed via any path, not just
  hardcoded. Verified via Node: fresh seed still shows `—` for all four rows; after
  executing a real partial sell (`executeSell('PROD-0004', 30)`, realizing +$273), Ethereum's
  row correctly updated to "+$273" in emerald, matching the ledger entry exactly, with the
  other three rows unaffected.
- **Asset Collection:** cards render from `getAllProducts()`. **Judgment call, flagged:**
  Cash is excluded from the rendered cards — `requestAllocation()` itself rejects Cash as a
  target (§4.20), so a "Request Allocation" card for it would always fail on click; the
  category tabs also never had a Cash/Unallocated tab to begin with. Each card now shows a
  genuine "Minimum investment: $X" line for the first time (none of the old hardcoded cards
  showed this at all) — confirmed Ethereum's is $100, not absent or invented. The return-%
  badge and "Allocated: $X" line are also now live per-holding data, with a "No position" /
  "Not yet allocated" fallback state added for the case (not currently reachable via any
  page UI, but reachable via the Phase 3 API directly) where a product has no current
  holding — e.g. after a full `executeSell()`.
- **Card alignment fix (Aug 20, 2026, same-day):** the user reported Nordic Growth Fund's
  card visually misaligned against its siblings and asked for a diagnosis before any fix.
  Diagnosed against all four points requested: (1) DOM structure identical across cards —
  ruled out, single shared template; (2) holding lookup — confirmed correct for Nordic on a
  fresh seed (units/costBasis resolve exactly as expected), not silently rendering the
  fallback state; (3) per-field text length comparison across all four cards showed nothing
  uniquely long about Nordic specifically (European Real Estate Trust's name is actually
  longer, yet wasn't reported as misaligned) — not clearly the trigger on typical data; (4)
  **confirmed as the actual root cause**: the card grid (`grid grid-cols-1 md:grid-cols-2
  xl:grid-cols-3 gap-4`) does equalize each card's *outer* box height within a row via CSS
  Grid's default `align-items: stretch`, but each card was a plain block-level `<div>`, not a
  flex column with the CTA anchored to the bottom — so any card whose content-above-the-
  button ran even one line longer than a sibling's (for any reason: a wrap, a longer
  computed value, or the fallback state) pushed its input/button down relative to siblings,
  even though the outer card heights matched. This is structural and product-agnostic, not
  a one-off Nordic issue — could resurface on any product whenever its content happens to
  differ by a line. **Fix applied:** each card is now `flex flex-col`, with the "Requested
  Allocation Amount" label/input/button wrapped in a `mt-auto` div so it always anchors to
  the card's bottom regardless of how much content sits above it. Verified via Node dry-run
  that all 4 rendered cards carry both `flex flex-col` and the `mt-auto` wrapper.
- **Request Allocation — real wiring:** the button calls `requestAllocation(productId,
  amount)` directly; a thrown validation error (below minimum, exceeds current Unallocated
  Capital) is caught and shown verbatim in the toast, now styled red to visually distinguish
  a failure from a success (the old toast only ever showed one canned success message, so
  this distinction didn't previously exist — added since real errors are now genuinely
  possible on click). On success the toast keeps its existing copy pattern, just with
  "Portfolio Manager" spelled out.
- **My Allocation Requests (new section, per user clarification during this phase):** reads
  `getAllocationRequests()`, shows **every** status (pending/approved/rejected) with a
  colored status badge, sorted newest-first, consistent with the "show everything, not just
  open items" principle already used by `documents.html`'s and `support.html`'s own "My
  Requests" sections. Rejected rows show the resolution reason inline. Re-renders
  immediately after a successful `requestAllocation()` call so a client sees their own
  request appear without reloading.
- **Verified — Node dry-run of the actual page script, same discipline as Phase 4a:**
  extracted the inline `<script>` and ran it under Node against the real engine with
  `document`/element stubs. Confirmed on a fresh seed: summary cards show $1,078,980 / 84% /
  $205,520 / 16% / +$124,844 (unrealized, emerald); the Return Table's first row shows
  Nordic Growth Fund's costBasis-based $346,284 (not the old $410,000); exactly 4 cards
  render (Cash excluded) with correct minimum-investment labels pulled straight from the
  catalog; My Allocation Requests shows the empty state on a fresh seed. Then, by calling
  `requestAllocation()`/`approveAllocationRequest()`/`rejectAllocationRequest()` directly
  against the engine (bypassing the click handler, which Phase 3 already verified
  thoroughly) and re-running the render logic, confirmed all three status rows (pending,
  approved, rejected-with-reason) render with the correct badge color and newest-first
  order.
- **Browser verification:** the user opted to check this phase in-browser themselves rather
  than have it launched here — not independently browser-verified by Claude.

### 4.23 Portfolio Engine, Phase 3B — sell request queue (`engine-core.js`) — COMPLETE (Aug 20, 2026)
Mirrors Phase 3's allocation request/approve pattern exactly, but for the sell side. Still
deliberately does not touch any page's UI or `<script>` tags — confirmed via file mtimes
that only `dashboard.html` and `asset-performance.html` (both from earlier phases) carry
today's date; no HTML file changed this phase.

- **Sell Request Queue** (`marketswave_sell_requests`): `{ id, productId, unitsToSell,
  status: 'pending'|'approved'|'rejected', requestedAt, resolvedAt, transactionId, reason }`
  — same shape and same "request now, execute later" discipline as the allocation request
  queue (§4.20). `requestSell(productId, unitsToSell)` validates the holding exists and
  currently covers `unitsToSell`, then appends a pending record and touches nothing else —
  no `unallocatedCapital`, `assetReturns`, holdings, or transaction ledger change. The exact
  unit count is captured at request time, not a "sell everything" flag re-evaluated later —
  a client's "Sell All" click resolves to a specific number immediately, per the explicit
  instruction. Loaded independently of the other stores (same pattern as the allocation
  requests / transactions keys), defaulting to `[]`, so an existing install's real data is
  never wiped just because this key predates it.
- **Approval workflow:** `approveSellRequest(requestId)` requires the request still be
  `pending`, then **re-validates against the current holding** (not the holding as it stood
  at request time) before calling `executeSell()` internally — units could have shrunk if
  another sell request on the same holding was approved in between. If the current holding
  no longer covers `unitsToSell`, it throws a clear error naming exactly how many units
  remain vs. how many were requested, rather than executing a partial/incorrect sell or
  failing silently. On success, marks the request `approved` with `resolvedAt` and the
  resulting `transactionId`. `rejectSellRequest(requestId, reason)` requires `pending` too,
  marks `rejected` with `resolvedAt` + `reason`, and moves nothing.
- **`getSellRequests()`** deep-clones each request (`array.map(r => Object.assign({}, r))`),
  applying Phase 3's own defensive-copy fix (§4.20) proactively this time rather than
  reintroducing the live-reference bug that was caught and fixed for `getHoldings()` /
  `getAllocationRequests()` — confirmed via a snapshot-then-mutate test that an earlier
  `getSellRequests()` result stays frozen after later, unrelated engine calls.
- **Verified (Node, not browser) — all four properties the spec asked for, checked
  directly:**
  - `requestSell()` alone: `getHoldings()`, `getAccountState()`, and
    `getTransactionLedger()` all byte-identical (JSON-string equality) before/after — only
    the new pending record appears.
  - `approveSellRequest()` cross-checked two ways: against an independently hand-computed
    expectation (`saleValue`, `costBasisPortion`, `realizedReturn` calculated by hand from
    the pre-sell holding, not trusted from the function's own output) — matched exactly
    (sold 500 Nordic Growth Fund units: saleValue $59,200, costBasisPortion $50,000,
    realizedReturn $9,200); and against a parallel direct `executeSell()` call on a fresh,
    identically-seeded engine instance — the resulting transaction, Account State, and
    holding were byte-identical between the two paths, confirming `approveSellRequest()`
    doesn't do anything different from the primitive it wraps.
  - **The re-validation edge case, the one most likely to hide a bug:** created two pending
    sell requests against the same Nordic Growth Fund holding (1,831.42 units each) whose
    *combined* total (3,662.84) exceeds what's actually held (3,462.84) — each individually
    valid at request time, since `requestSell()` only checks current units and requesting
    doesn't reserve/touch anything. Approved the first (succeeded, left 1,631.42 units
    remaining). Attempting to approve the second correctly **threw** ("only 1631.42 units
    remain held, but 1831.42 were requested") rather than executing an oversell — confirmed
    the second request's status stayed `pending` (not silently marked approved or left in a
    partial state) and the holding was completely untouched by the failed attempt.
  - `rejectSellRequest()`: confirmed zero change to `getAccountState()`, `getHoldings()`, or
    `getTransactionLedger()` — only the request's own `status`/`resolvedAt`/`reason` changed.
- **API additions:** `requestSell(productId, unitsToSell)`, `approveSellRequest(requestId)`,
  `rejectSellRequest(requestId, reason)`, `getSellRequests()`.

### 4.24 Portfolio Engine, Phase 4c — Sell action on `asset-performance.html`'s Return Table — COMPLETE (Aug 20, 2026)
Wires the Phase 3B sell request queue into a page for the first time. Sells require
Portfolio Manager approval, same as buys — this submits a request via `requestSell()`, it
does not execute immediately (`executeSell()` is never called from this page).

- **Sell button per Return Table row:** the Return Table only ever iterates current holdings
  (Cash never has one; a fully-sold product's holding is removed entirely by `executeSell()`
  internally), so the "no button on rows with no holding" case from the spec is naturally
  satisfied by the table's existing structure — every row already implies a holding exists.
  The button instead disables for the case that's actually reachable here: a pending sell
  request already covering the full available position.
- **Available-to-sell calculation:** `available = holding.units − Σ(unitsToSell across this
  product's own PENDING sell requests)`, recomputed fresh (not cached) every time the table
  or modal renders, via a new `pendingSellUnitsForProduct()` / `availableToSell()` pair in
  the page script. **Verified this guard is doing real work, not just decoration:** a direct
  test of `requestSell()` confirmed it only validates against the CURRENT `holding.units` at
  request time — it does *not* check pending totals from other requests on the same holding.
  So without this UI-layer guard, a client could submit a second sell request that passes
  `requestSell()`'s own check individually but combines with an already-pending one to
  oversell the position — exactly the scenario Phase 3B's `approveSellRequest()`
  re-validation was built to catch at approval time (§4.23). This guard complements that
  safety net by preventing the doomed request from ever being submitted in the first place,
  rather than letting it sit `pending` until an approval attempt fails on it. When available
  drops to ≤0, the button disables with a `title` tooltip explaining why.
- **Sell modal** (static HTML, matching the existing modal pattern from
  `high-yield-savings.html`'s New Pocket / Withdraw modals — backdrop + centered card, not a
  JS-built overlay): header shows product name + current unit price. An info panel shows
  available units, current value, proportional cost basis, and projected gain/loss — **a
  live preview only**, computed with the exact same formula `executeSell()` itself uses
  (`costBasisPortion = holding.costBasis × (units / holding.units)`, denominator always the
  *full* holding, not the available-to-sell amount) so the preview numbers match what would
  actually happen on approval. A "Sell All" / "Partial" mode toggle mirrors
  `high-yield-savings.html`'s term-mode-tab interaction pattern (active/inactive tab
  restyling); "Sell All" defaults to the full *available* amount (already excluding pending
  units, not the raw holding), and "Partial" reveals a live-validated numeric input that
  recomputes the preview and disables Submit on every keystroke until the amount is valid.
  Explicit copy states the request is pending Portfolio Manager approval and does not sell
  immediately. Submit calls `requestSell(productId, unitsToSell)`; a thrown error (e.g. an
  amount somehow exceeding available, though the live validation should already prevent
  reaching Submit in that state) is caught and shown verbatim in the same red-styled error
  toast Request Allocation already uses (Phase 4b) — reused, not duplicated. On success: the
  modal closes, a success toast fires, and both the Return Table (button/available-units
  state) and My Requests re-render.
- **"My Requests" consolidation:** merged the Phase 4b "My Allocation Requests" section with
  the new sell requests into one list, sourced from `getAllocationRequests()` +
  `getSellRequests()` together, each row carrying a type badge (Allocation — navy tint; Sell
  — purple tint, a color not used elsewhere in the app) alongside the existing status badge.
  Sell rows show units (`"1234.5678 units"`) in the Amount column instead of a dollar figure,
  since a sell request has no dollar amount until execution. Originally sorted by the
  calendar-day `requestedAt` string (a real data-precision limitation flagged at the time,
  not a UI shortcut, since `requestedAt` had no sub-day timestamp) — **corrected same-day**
  per a follow-up request: `requestAllocation()`/`requestSell()` now also stamp
  `requestedAtMs: Date.now()` on every new request, and My Requests sorts by that instead.
  Existing stored requests from before this field existed aren't silently rewritten —
  `getAllocationRequests()`/`getSellRequests()` compute a deterministic end-of-day fallback
  for any record missing `requestedAtMs`, recomputed fresh on every read from its
  `requestedAt` day-string, so old and new requests still sort reasonably together without a
  migration step. Verified: new requests get a real millisecond timestamp; a manually
  injected legacy record (no `requestedAtMs`) correctly backfilled to
  `2026-08-19T23:59:59.999Z` on read, sorted after same-day-and-later real timestamps, and
  the underlying stored record was confirmed untouched (fallback is read-only, not
  persisted). Genuine same-millisecond ties (only realistically reachable via rapid
  synchronous test calls, not real UI interaction) still resolve via a stable tie-break
  (allocation requests before sell requests) — observed directly while testing, not a
  regression.
- **Verified (Node dry-run of the actual page script, real engine, no browser yet):**
  fresh-seed render shows exactly 4 enabled Sell buttons, 0 disabled. After submitting a
  sell request covering Nordic Growth Fund's *entire* available position, re-rendering
  correctly disabled that row's button with the tooltip. Separately, confirmed the
  partial-then-stacking-to-full case end to end: a 40%-of-holding pending request correctly
  left ~60% available (button stays enabled); a second request for exactly that remaining
  ~60% succeeded and correctly reduced available to ~0, disabling the button — demonstrating
  the guard tracks partial reductions correctly, not just the fully-covered case. My Requests
  correctly rendered one Allocation row and one Sell row together with the right type/status
  badge colors and amount formatting after both a `requestAllocation()` and a `requestSell()`
  call.
- **Browser verification:** not yet done — flagged to the user as warranted, per their own
  instruction, since this is the second real money-moving action wired into a live page
  (after Request Allocation in Phase 4b), pending their confirmation before launching one.

### 4.25 Portfolio Engine, Phase 4d — wire `transactions.html` to `engine-core.js` — COMPLETE (Aug 20, 2026)
The user's own instruction called this "Phase 4c," but that label was already used for the
Sell-action work above (§4.24) — labeled "Phase 4d" here instead to keep the numbering
unambiguous, flagged back to the user rather than silently reusing the same number for two
different pieces of work. Same loading pattern as 4a-4c: `engine-core.js` loads the way
`dashboard-sidebar.js` does, `settleAllProducts()` runs once on page load. Only
`transactions.html` was modified — confirmed via file mtimes.

- **Verification seeding, done first as test setup, not a feature:** every Node test in this
  phase seeded genuine mixed BUY/SELL data via `requestSell()` then `approveSellRequest()`
  (for the sell) and `requestAllocation()` then `approveAllocationRequest()` (for buys) —
  the same request/approve path a real page would use, not `executeBuy()`/`executeSell()`
  called directly, and never through any page UI. This meant every verification below ran
  against real mixed data instead of an all-BUY dataset from the start.
- **Testing methodology upgrade for this phase specifically:** installed `jsdom` locally
  (`npm install jsdom --no-save`, removed again after testing — no `package.json` or
  `node_modules` left behind in the project) to verify against a real DOM rather than the
  hand-rolled element stubs used for Phases 4a-4c. This phase's filter/re-render/drill-down
  interactions (remove-and-reinsert ledger rows, dynamically populated `<select>` options,
  live `classList` toggling across a modal's view/edit states) are meaningfully more complex
  than earlier phases' — real `querySelectorAll`/`insertAdjacentHTML`/event dispatch caught
  things a hand-rolled stub would have had to fake correctly by hand. One real jsdom pitfall
  hit and worked around: blanket-copying every `window` property onto Node's `global` (to
  make bare identifiers resolve inside `eval`'d page-script text) clobbered Node's real
  `setTimeout` with jsdom's version, causing infinite recursion in jsdom's own internal timer
  bookkeeping — fixed by mirroring only the specific `engine-core.js`-exported function names
  plus `document`, not the entire window surface.
- **Summary cards:** Total Buys / Total Sells sum `totalValue` from `getTransactionLedger()`
  filtered by type, with a transaction-count subtitle. **Net Invested is `getHoldings()`'
  summed `costBasis`, deliberately not `allocatedCapital`** — same cost-basis-vs-current-
  value distinction Phase 4b already applied to "Capital Allocated" (principal still
  allocated, not current market value including price movement). Cross-checked by hand
  during testing: after seeding one sell + two buys, Net Invested summed to $914,136,
  matching an independent hand-computation of the four remaining holdings' cost basis.
  Revenue/Fees was renamed "Est. Monthly Advisory Fee" (`getAdvisoryFeeAccrued(30)`, labeled
  "Based on a 30-day accrual" rather than implying calendar-month precision it doesn't have)
  with a small inline pencil-icon edit control that reveals a rate input +
  Save/Cancel, calling `setAdvisoryFeeRate()` — per the standing decision that this rate
  should be editable at any time, not hardcoded. A thrown validation error (non-positive
  rate) shows inline under the input and leaves edit mode open rather than silently
  discarding the attempt; Cancel discards without saving.
- **Recent Activity** (this page's own instance, separate from `dashboard.html`'s): last 5
  from `getTransactionLedger()`, newest first, real "No recent activity yet." empty state
  verified at zero transactions.
- **Empty-state visual consistency fix (Aug 20, 2026, same day):** the user reported Recent
  Activity's empty-state text sat right under the header while the two chart cards' empty
  states were vertically centered lower in their cards — all three should read as consistent
  siblings. Diagnosed before fixing: the chart cards' canvases sit inside a fixed-height
  `h-40` wrapper, and their empty-state code replaces that wrapper's content with
  `h-full flex items-center justify-center`, centering it within that fixed box. Recent
  Activity's list container (`#recent-activity-list`) has **no fixed height or centering
  wrapper at all** — deliberately, since a populated list of 1-5 rows should stack
  top-aligned, not be centered in an arbitrary height. Its empty state was reusing that same
  unconstrained slot with only `text-center py-2`, which centers horizontally but has no
  fixed height to center vertically within — a genuine pattern mismatch (item 2 in the
  user's own diagnostic framing), not a one-off spacing tweak. **Fix, applied at the pattern
  level:** Recent Activity's empty-state markup alone (not the populated-list state) now
  wraps in the identical `h-40 flex items-center justify-center` treatment the chart cards
  use — same fixed height, same both-axis centering, same `text-sm text-slate-400` text
  styling; wording kept as "No recent activity yet." (more contextually precise than the
  charts' text) since the user's ask was about visual/CSS consistency, not literal wording.
  **Verified in an actual browser, per the user's explicit instruction, not Node/jsdom**
  (pure layout issues aren't visible to either): first confirmed the exact markup visually by
  injecting it directly into a live page; then, as a stronger check, forced a genuinely empty
  state through the real engine (`marketswave_holdings` and `marketswave_transactions` both
  explicitly set to `[]`, confirmed they stayed empty after reload — proving the backfill
  fix's own bail-out condition, `holdings.length === 0`, correctly declines to backfill when
  there's nothing to backfill from) and screenshotted the page's own real render logic
  producing all three empty states at matching vertical positions. Used a separate throwaway
  local-server origin (a different port) for this test, so the user's real browser data was
  never touched.
- **Transaction Volume + Net Cash Flow charts:** grouped by real calendar month
  (`YYYY-MM` derived from each transaction's date) from `getTransactionLedger()`, entirely
  replacing the old hardcoded 6-month Mar-Aug window — only months that actually have
  transactions appear, rather than a fixed trailing window padded with invented zeros for
  months that don't apply to this account's real history at all. **Empty-state fix made
  during this phase's own verification, not left as a known gap:** the "No transaction
  history yet." text replacing each canvas was initially nested inside the `typeof Chart !==
  'undefined'` guard, meaning a Chart.js CDN failure would leave a blank canvas with no
  explanation at all, satisfying neither the chart nor the text fallback. Restructured so the
  zero-transaction text renders independent of whether Chart.js loaded — verified via jsdom
  that the canvas is genuinely replaced with the text and `getElementById('volume-chart')`
  correctly returns `null` afterward.
- **Ledger table:** rows generated from `getTransactionLedger()` joined against
  `getProduct()`. The old "Date & Time" header was renamed to "Date" — the engine only ever
  stores a calendar-day string, no time-of-day, so the old hardcoded fake times ("14:22" etc.)
  were not something to reproduce with real data. BUY rows show no realized return; SELL
  rows' realized return lives in the drill-down modal (see below), not as an extra ledger
  column, matching the spec's framing of where that detail belongs. **Judgment call,
  flagged:** the Type filter was trimmed from 7 options (Buy/Sell/Dividend/Interest/Fee/
  Deposit/Withdrawal) down to just Buy/Sell, since the engine can only ever produce those two
  transaction types today — offering filter values that can never match anything would be a
  decorative-only control. The Asset filter is now populated dynamically from
  `getAllProducts()` (Cash excluded — it can never appear in a transaction) instead of a
  hardcoded 5-item list that included a "Cash" option that could never actually match a real
  row. Per the explicit instruction, no Deposit-type rows were fabricated to fill the gap
  left by Deploy Capital not being wired yet — the ledger will look sparser than a real
  account's full history until a later phase wires that page in.
- **Filters re-verified against the new real data source, not assumed to still work:** date
  range, type, and asset filters were tested individually and combined (e.g. Type=Sell +
  Asset=Ethereum on a dataset with no matching row) against the real jsdom DOM — correctly
  narrowed results, updated the `ledger-count` label, and showed the empty row with the
  correct message. **A second, distinct empty-state message was added**: "No transactions
  yet." when the ledger is genuinely empty vs. "No transactions match your filters." when
  data exists but the current filters exclude everything — verified both message paths
  render correctly.
- **Drill-down modal:** pulls real per-transaction detail (units, execution price, status,
  and — SELL only — realized return) from the actual transaction record via a `data-txn-id`
  lookup, not per-row dataset attributes holding pre-formatted strings. **Judgment call,
  flagged:** the engine has no separate "market price vs. execution price" or per-trade
  "associated costs" concept — every buy/sell executes exactly at the settled unit price with
  no modeled slippage or fee. Rather than removing those two modal fields (more invasive than
  asked), "Market Price at Execution" mirrors "Execution Price" exactly and "Associated
  Costs" shows a genuine `$0`, not an invented number. A new "Realized Return" row appears
  only for SELL transactions — verified hidden for BUY rows, shown and correctly signed/
  colored for SELL rows. The modal's note text is generated per type ("Executed following
  Portfolio Manager approval of an allocation/sell request.") — accurate today since
  `executeBuy()`/`executeSell()` are only ever called internally by an approved request, not
  fabricated, though worth revisiting if a future phase calls them from anywhere else.
- **Verified end-to-end via jsdom against the real page HTML and a real DOM** (not hand-rolled
  stubs): seeded 1 sell + 2 buys, confirmed summary cards (cross-checked Net Invested and
  Total Sells by hand), Recent Activity showing all 3 newest-first, exactly 3 real ledger
  rows in the same order, the Asset filter dropdown correctly populated and excluding Cash,
  individual and combined filters correctly narrowing/excluding results with the right empty-
  state message, reset restoring all rows, the drill-down modal showing correct real detail
  for both a SELL (realized return visible, "+$7,360" — independently matches
  `saleValue − costBasisPortion` computed by hand) and a BUY (realized return row hidden),
  the true zero-transaction empty state across cards/activity/charts/ledger, and the full
  advisory-fee edit/save/cancel/error interaction cycle.
- **Verified in an actual browser** (Aug 20, 2026, as part of investigating the backfill bug
  described in §4.26) — real DOM confirmed for summary cards, both charts, the ledger table,
  and the drill-down modal on the user's actual persisted `localStorage`, not just jsdom.

### 4.26 Bug fix — backfill missing BUY transactions for pre-existing holdings (`engine-core.js`) — COMPLETE (Aug 20, 2026)
The user reported that in their real browser, `transactions.html`'s Total Buys/Sells,
Recent Activity, both charts, and the ledger table all showed empty/zero, while Net Invested
showed real data — and asked whether this was a Phase 4d wiring bug or something else.

- **Root cause, confirmed by direct inspection, not assumption:** Phase 1's originally-seeded
  holdings (§4.18) were written straight to `localStorage` via `buildSeedData()`, before the
  transaction ledger concept existed at all (Phase 3, §4.20) — `buildSeedData()` constructs
  holdings directly rather than calling `executeBuy()`, so no BUY transaction was ever
  created for a portfolio's starting position. This isn't specific to browsers that predate
  Phase 3 — it affects **any** install, including a brand-new one today, since the seeding
  logic itself has never gone through the transaction-creating code path. Net Invested (reads
  `getHoldings()`) showed real numbers because holdings data was always genuinely there; Total
  Buys/Recent Activity/both charts/the ledger (all read `getTransactionLedger()`) correctly
  showed nothing, because nothing had actually been logged.
- **A second thing the user asked to check turned out to be a false alarm, confirmed rather
  than assumed:** the user suspected roughly $124,844 might have already been sold, based on
  comparing Net Invested ($954,136) against the old $1,078,980 figure. Before touching the
  browser, a fresh-seed Node test already showed $954,136.39 is exactly what the sum of
  holdings' `costBasis` has been since Phase 1's very first seed — with **zero** sells ever
  executed. That's because $1,078,980 (`allocatedCapital`) is *current market value*
  (holdings priced at their return-adjusted unit price) while $954,136 (Net Invested) is
  *cost basis* (the same holdings priced at inception price) — two different metrics that
  have always differed by exactly $124,843.61, the unrealized return baked into the original
  seed's return percentages (matching Phase 4b's "Total Asset Returns (Unrealized)" figure
  on a fresh seed exactly). **Directly confirmed against the user's real browser
  `localStorage`** (not inferred): `getHoldings()` matched the pristine original Phase 1 seed
  values exactly (unchanged units/costBasis for all 4 products), `marketswave_sell_requests`
  was `[]`, and — since the backfill function bails out immediately if any transaction
  already exists, meaning it would never have added anything if a real SELL record had been
  sitting there — the post-fix ledger containing only 4 synthetic BUY rows (no SELL) proves
  the pre-fix ledger was genuinely empty. No real sell ever happened in this browser; the
  discrepancy was the expected, by-design cost-basis-vs-market-value gap, not evidence of a
  sale.
- **Fix:** `engine-core.js` now runs `backfillTransactionsForExistingHoldings()` once,
  immediately after the transactions store loads — if `transactions` is empty but `holdings`
  already has entries, it synthesizes one BUY per holding: `date` = the product's own
  `createdAt` (not today's date, avoiding an implausible "everything bought today"
  ledger), `price` = the cost-basis-implied unit price (`costBasis / units` — correct even
  for a holding that's since been partially sold, since `executeSell()`'s proportional
  formula preserves the average cost per unit exactly), `units`/`totalValue` from the
  holding's own `units`/`costBasis`. **Self-limiting without any extra flag or persisted
  marker:** once backfilled, `transactions` is no longer empty, so the condition naturally
  never re-fires on a later load — verified this isn't accidental by re-running the check
  twice in sequence and confirming no duplicate rows appear.
- **Verified directly in the real browser, not just Node/jsdom, per the user's explicit
  instruction** — this class of bug (an inconsistency between two localStorage keys that
  only manifests when one already has real accumulated data and the other doesn't) can't be
  caught by a fresh mock store, which always starts both consistent together. Loaded
  `transactions.html` against the user's actual `localStorage`: summary cards showed Total
  Buys $954,136/4 transactions, Total Sells $0/0, Net Invested $954,136 (now consistent with
  Total Buys, which it wasn't before), Recent Activity and the ledger table showing all 4
  backfilled entries with correct dates/prices, the Transaction Volume and Net Cash Flow
  charts rendering two real months of data (verified the Net Cash Flow values directly, not
  just the chart's visual shape, since the y-axis is intentionally hidden — both months are
  genuinely negative, -$810,250.05 and -$143,886.34, an all-buy/no-sell picture, and the
  chart's upward slope between them is real: moving from a larger negative to a smaller
  negative). Clicked into the drill-down modal for a real backfilled row and confirmed
  correct detail with no Realized Return row (BUY). Also spot-checked `dashboard.html`
  (Recent Activity now shows the same real backfilled history) and `asset-performance.html`
  (Total Allocated Capital $1,078,980, Realized Amount correctly `—` for every row, all 4
  Sell buttons enabled) on the same real browser session, confirming the fix is consistent
  everywhere the engine is wired, not just on `transactions.html`.

### 4.27 Bug fixes — responsive-layout overflow on narrow/vertical viewports (`dashboard.html`, `transactions.html`) — COMPLETE (Aug 20, 2026)
The user reported two layout bugs, both specific to narrower/vertically-oriented viewports
(not the wide desktop view most testing had used) — asked for the responsive root cause to
be diagnosed for each before fixing, and verified in an actual browser at genuinely narrow
widths, not Node/jsdom (pure layout issue, invisible to either).

**Tooling note:** the browser automation's `resize_window` tool does not reliably shrink an
already-loaded tab's actual rendering viewport (`window.innerWidth` stayed at ~1024px
despite the OS window visibly shrinking) — resizing a **new** tab *before* navigating it was
the only reliable way found to get a genuinely narrow `window.innerWidth` for testing. Even
then, this tooling has an apparent floor around 500px — narrower widths (e.g., a literal
375px phone) couldn't be reached directly; the ~500px floor was still narrow enough to
reveal both bugs.

- **Dashboard.html — Portfolio Allocation card overflow.** Root cause confirmed via direct
  `getBoundingClientRect()`/`getComputedStyle()` measurement, not guessed: the chart's
  wrapper had `flex-shrink-0` (added deliberately in Phase 4a so the circular chart wouldn't
  get squished into an oval) combined with an escalating `max-w-[13rem]` → `22rem` per
  breakpoint — meaning it was **completely rigid** at its breakpoint's max-width, with no
  ability to shrink even when the row didn't have room for it. The legend, though
  shrinkable, still couldn't compress below its own text's min-content width. At a
  moderate-narrow viewport (736px, `sm:flex-row` already active) with the app's persistent,
  non-collapsing sidebar eating a fixed chunk of the viewport regardless of its size,
  neither element's minimum requirement deferred to the other, and the legend visibly spilled
  past the card's right edge by measurable pixels (confirmed via `right` coordinates, not
  just a visual impression). The existing `flex-col` → `sm:flex-row` breakpoint switch
  wasn't the problem (it correctly stacks below 640px) — the actual gap was that a
  **viewport-width breakpoint doesn't track the card's actual available width**, which
  depends on the sidebar's fixed width too.
  - **Fix, at the layout level, per the user's own suggested direction:** replaced the
    `flex-col sm:flex-row` viewport-breakpoint switch with `flex flex-wrap` — content-driven
    wrapping based on the row's real available width, not a media query. The legend got
    `flex-1 basis-[180px]` (a soft preferred-size threshold for the wrap decision, not a
    hard floor — deliberately `basis` rather than `min-width`, so it can still shrink below
    180px once wrapped alone onto its own line, rather than creating a second overflow floor
    at a different pixel value). The chart wrapper needed `w-full` restored (it had been
    dropped in an earlier edit) alongside its `max-w-*` classes, so its computed width
    resolves to `min(100% of its available line, max-w breakpoint value)` — without it, the
    element rendered at exactly its max-width unconditionally, ignoring a narrower parent.
  - **A more extreme case caught during verification, not assumed fixed by the first pass:**
    at the tooling's ~500px floor, the sidebar left the card only ~166px wide — narrower
    than even the chart's smallest breakpoint tier (13rem = 208px) and the legend's 180px
    threshold individually. The `flex-wrap` fix alone didn't address this (both elements
    still had hard floors exceeding the available width); only after restoring `w-full` on
    the chart and switching the legend to `basis-[180px]` did both genuinely shrink below
    their nominal sizes to fit the ~166px card, confirmed via measurement
    (`chartOverflowsCard`/`legendOverflowsCard` both `false`, `documentScrollWidth` matching
    `innerWidth` exactly — no page-level horizontal overflow).
  - **Verified across the full range in an actual browser**, not just the one width that
    happened to be tested: ~500px (both elements correctly shrink, no overflow, no
    horizontal scrollbar), 736px (clean stacked layout, chart centered above legend, neither
    spills), and a genuinely wide desktop viewport (1787px — reached via resize-before-
    navigate on a fresh tab, since resizing an already-open tab wouldn't budge past ~1024px)
    where the chart and legend render side-by-side with the chart scaled up to its largest
    breakpoint tier, exactly matching Phase 4a's original "scale up on large viewports"
    requirement — confirming the fix didn't regress the wide-viewport behavior while fixing
    the narrow one.
- **Transactions.html — Recent Activity row displacement, populated state.** Confirmed
  **distinct** from the empty-state fix in §4.25's addendum (which only touched the
  zero-transactions placeholder) — this is the populated-row layout itself. Root cause,
  screenshotted directly before fixing: the row was `flex items-center justify-between` with
  the product name as a bare, untruncatable text node inside a flex span with no `min-w-0` —
  at a narrow available width, a long name ("European Real Estate Trust", "Global Equity
  ETF") wrapped onto 3-4 lines, and since the amount span was vertically centered
  (`items-center`) against that now-multi-line block while the "· Buy/Sell" suffix floated
  mid-block, the row visually looked exactly as reported: displaced and imbalanced, not
  cleanly aligned.
  - **Fix:** wrapped the product name in its own `<span class="truncate">`, gave its
    containing span `min-w-0` (required for `truncate`'s ellipsis to ever activate on a flex
    child — without it, the span refuses to shrink below the text's own min-content width
    and never truncates), and gave the dot, the "· Buy/Sell" suffix, and the amount all
    `flex-shrink-0` so they stay fully visible and never get squeezed as the name truncates
    around them. This keeps the entire row on one aligned line at any width, with the name
    gracefully ellipsizing instead of wrapping.
  - **Verified at a realistic narrow width (736px):** all four rows, including the two
    longest product names, rendered on one clean line each, fully readable (not even needing
    to truncate at this width), correctly aligned dot/name/type/amount.
  - **A genuinely pathological extreme found and disclosed, not hidden:** at the tooling's
    ~500px floor, the same sidebar-driven ~166px-wide card left only ~117px total for the
    entire row — measured directly: the dot + gaps + "· Buy" suffix + the dollar amount
    alone already consumed all 117px, leaving **zero** width for the name even after
    truncation, so the name became fully invisible (not wrapped/misaligned, just absent).
    This is not a regression from the fix — it replaced a visibly broken-looking wrapped mess
    with a compact-but-aligned row — but it's also not a complete solution for this specific
    extreme case, which is a symptom of the sidebar's own separate, unreported non-collapse
    behavior (confirmed the row's fixed-width elements alone exceed 117px, so no amount of
    truncation logic on the name alone can fully solve it without either shrinking the
    dollar amount or restructuring the row to wrap onto two lines — out of scope for what
    was asked here, and flagged rather than silently left unmentioned).

### 4.28 Sidebar responsive collapse (`dashboard-sidebar.js`) — COMPLETE (Aug 20, 2026)
Following §4.27's investigation, the user asked to fix the actual root cause: the sidebar
had always been a hardcoded `w-64`, fully static and non-responsive, on every dashboard page
— it never shrank, hid, or adapted at any viewport width. Since the sidebar was extracted
into a shared component months earlier, this fix lives entirely in `dashboard-sidebar.js`
and applies to all 9 dashboard pages automatically — no per-page edits needed.

- **Design:** below the `lg` breakpoint (1024px), the sidebar becomes an off-canvas drawer —
  `position:fixed`, `-translate-x-full` by default (fully off-screen to the left), toggled by
  a fixed hamburger button in the top-left corner. Opening it adds `translate-x-0` (CSS
  transition, 200ms) and shows a semi-transparent backdrop (`#sidebar-backdrop`) covering the
  rest of the page; the drawer itself gained its own × close button. Three ways to close:
  the × button, clicking the backdrop, or pressing Escape — all wired in one `toggleSidebar()`
  function shared by every trigger. At `lg` and above, `lg:static lg:translate-x-0` override
  the mobile-mode positioning entirely, and the hamburger button is `lg:hidden` — the result
  is pixel-identical to the sidebar's previous always-visible behavior on desktop, confirmed
  via direct `getComputedStyle()` inspection (`position: static`, identity-matrix transform,
  hamburger `display: none`) at a viewport just above the breakpoint (1032px), not just a
  visual glance.
- **Real bug caught and fixed during the browser verification pass, not left for later:**
  the external hamburger button and the drawer's own "MARKETSWAVE" logo both sit in the same
  top-left corner — with the drawer open, they visually overlapped, clipping the logo text.
  Fixed by hiding the external hamburger button whenever the drawer is open (the drawer's own
  × button already covers closing it), toggled in the same `toggleSidebar()` function.
- **A second false alarm caught before being reported as a bug:** an early screenshot taken
  immediately after a programmatic `.click()` open showed the drawer badly cut off, with text
  fragments visible only along a narrow strip — looked exactly like a positioning bug.
  Checked `getBoundingClientRect()`/`getComputedStyle()` directly rather than trusting the
  screenshot: the drawer's actual DOM position was already fully correct
  (`left: 0, right: 256, width: 256`, identity-matrix transform, i.e. no offset at all) at
  the moment of inspection. The screenshot had simply been taken mid-transition — the 200ms
  slide-in animation hadn't finished before the screenshot tool fired. Re-screenshotting
  after a brief wait confirmed the drawer renders correctly; this was a tooling/timing
  artifact, not a real defect, and is recorded here specifically so a future session doesn't
  waste time re-diagnosing the same non-bug.
- **Verified in an actual browser across the full range**, using the same tab-creation/
  resize-before-navigate technique established in §4.27 (resizing an already-loaded tab
  doesn't reliably shrink `window.innerWidth`): at ~502px on both `dashboard.html` and
  `transactions.html`, the sidebar is fully hidden by default, the hamburger opens a correct
  full-width-appropriate drawer, and — as a direct side effect of the content area finally
  getting real width — the "pathological extreme" cases disclosed in §4.27 (the pie chart
  squeezed very small, the Recent Activity row's product name disappearing entirely) no
  longer occur: at this same ~502px width, `transactions.html`'s Recent Activity now shows
  every product name in full, untruncated, on one line each. At 1032px (just above the `lg`
  breakpoint), confirmed both pages render the sidebar exactly as before — static, always
  visible, no hamburger — and `dashboard.html`'s Portfolio Allocation card correctly shows
  the chart and legend side-by-side without overflow, confirming §4.27's flex-wrap fix and
  this sidebar fix compose correctly together rather than conflicting.
- **Not independently re-verified on the other 7 dashboard pages** (`asset-performance.html`,
  `high-yield-savings.html`, `documents.html`, `risk-management.html`, `settings.html`,
  `support.html`, `deploy-capital.html`) beyond the shared script's syntax check — the fix is
  a genuinely page-agnostic shared component with no per-page coupling (same script, same
  `initDashboardSidebar()` call already present on every page), and `dashboard.html` +
  `transactions.html` were verified thoroughly, but worth a spot-check on the others if
  anything page-specific interacts oddly with a fixed-position overlay (e.g. a page with its
  own modal using a similar z-index).

### 4.29 Permission fix — removed client-facing advisory fee rate edit (`transactions.html`) — COMPLETE (Aug 20, 2026)
Phase 4d had given the "Est. Monthly Advisory Fee" card an inline pencil-icon edit control
calling `setAdvisoryFeeRate()` directly from the client dashboard. The user flagged this as
a genuine permissions bug, not a UX preference: **clients should never be able to set their
own advisory fee rate.**

- **Fix:** removed the edit affordance entirely — the pencil-icon button, the inline
  input/Save/Cancel controls, and the inline error-message element are all gone from the
  page's HTML, and the corresponding `renderAdvisoryFee()`/`showFeeView()`/`showFeeEdit()`
  JS and their event listeners were removed too, replaced with two plain read-only lines
  (accrued amount, current rate) still sourced live from `getAdvisoryFeeAccrued(30)` and
  `getAccountState().advisoryFeeRate` — the card still reflects real Account State, it just
  can't be used to change it.
- **`setAdvisoryFeeRate()` deliberately untouched in `engine-core.js`** — it's still a valid,
  already-tested function (§4.19), just no longer called from any client-facing page. Logged
  in the Backend Requirements Register (§3.1 item 29) as belonging to the upcoming admin /
  Portfolio Manager tool rather than the client dashboard, so the capability isn't lost track
  of once that tool gets built — it just needs a new, PM-facing UI to call the same function
  from.
- **Verified:** confirmed via grep that none of the removed element ids
  (`advisory-fee-edit-btn`, `-edit-view`, `-rate-view`, `-rate-input`, `-save-btn`,
  `-cancel-btn`, `-error`) remain anywhere in the file, and that the sole remaining
  `setAdvisoryFeeRate` occurrence is the explanatory code comment, not a call.

### 4.30 Bug fix — sidebar doesn't extend full page height at `lg:static` (desktop) (`dashboard-sidebar.js`) — COMPLETE (Aug 20, 2026)
Following §4.28's sidebar rework, the user reported the navy sidebar panel not reaching the
bottom of the page on at least some dashboard pages, and asked for the root cause to be
diagnosed — specifically whether the static/desktop version's height was anchored to
something that doesn't grow with actual page content.

- **Root cause, confirmed via direct `getBoundingClientRect()`/`getComputedStyle()`
  measurement on `high-yield-savings.html` at a genuinely wide (1032px, `lg:static` mode)
  viewport, not guessed:** the outer app shell (`.flex.h-screen.overflow-hidden`) and
  `#sidebar-mount` both correctly stretch to the full viewport height (983.2px, matching
  `window.innerHeight` exactly — default flex `align-items: stretch` working as expected at
  those two levels). But the `<aside>` itself measured only **657.6px** — its own content's
  natural height, not the parent's. `#sidebar-mount` is a plain unstyled `<div>`
  (`display: block`, not itself a flex container), so while flex-stretch from the *outer* row
  correctly stretches `#sidebar-mount` to fill it, that stretch does not cascade a second
  level down to `#sidebar-mount`'s own child — the aside, at `lg:static`, has no explicit
  height at all and reverts to `height: auto` (shrink-to-fit), leaving roughly 326px of the
  card's cream body background visible below the navy panel on that viewport. In narrow/
  drawer mode this was already masked: `position: fixed` + `inset-y-0` implicitly forces
  exactly 100vh regardless of content, which is why the bug was specifically reported as a
  desktop/static-mode issue, matching the user's own suspicion.
- **Reproduces on every dashboard page**, not just specific ones — the sidebar's own content
  (nav items, Deploy Capital button, footer) is identical across all 9 pages via the shared
  `NAV_ITEMS` list, so its natural content height (~658px) is roughly constant regardless of
  which page is open; the bug shows whenever the browser's viewport height exceeds that,
  which is true for most normal desktop windows.
- **Fix:** added `h-screen` directly to the `<aside>`'s own class list — a self-contained fix
  that doesn't depend on multi-level flex-stretch propagation working correctly through
  intermediate unstyled elements. Confirmed non-conflicting with narrow/drawer mode: there,
  `inset-y-0` already implies 100vh, so the added `h-screen` is redundant-but-harmless; at
  `lg:static`, `inset-y-0` is ignored entirely (static positioning doesn't respect inset
  properties), so `h-screen` becomes the only thing enforcing the height, exactly filling the
  gap.
- **Verified in an actual browser, specifically on a page requiring internal scroll, per the
  user's explicit instruction** — checked `settings.html` at 1032px, where `<main>`'s content
  genuinely exceeds one viewport (`scrollHeight: 1761` vs. a visible height of `919px`,
  confirmed via measurement, not assumption). Post-fix, the aside measured exactly
  `983.2px`, matching `window.innerHeight` precisely. Screenshotted before and after scrolling
  `<main>` to its very bottom — the sidebar stayed a solid, unbroken navy panel throughout,
  confirming it's correctly decoupled from `<main>`'s independent internal scroll (the
  intended app-shell behavior: the sidebar's own height is fixed to the viewport regardless
  of how much the content column scrolls). Also re-confirmed narrow/drawer mode still
  measures correctly (aside height matching `window.innerHeight` exactly) with no regression
  from the added class.

### 4.31 Polish fix — Risk Metrics badge wrapping (`dashboard.html`) — COMPLETE (Aug 20, 2026)
The "Poor (16.0%)" Cash Reserve badge wrapped onto two lines while its shorter siblings
("Balanced", "84.0%") stayed on one — an inconsistent pill treatment within the same card.

- **Fix:** added `whitespace-nowrap` to all three badge spans (not just the currently-broken
  one, for consistency) so the pill grows wider instead of wrapping its own text internally,
  and added `flex-wrap gap-2` to each row container so that if a wider pill ever genuinely
  can't fit alongside its label at a narrow width, the *row* wraps (label above, badge below)
  rather than text wrapping *inside* the badge — matching the row-level-wrap philosophy
  already established this session (§4.27, §4.30) rather than patching this one badge in
  isolation.
- **Verified in an actual browser at both a wide viewport and a narrow one (502px, using the
  now-collapsed sidebar from §4.28)** — "Poor (16.0%)" renders on one line at both widths;
  at 502px there's comfortably enough room now that the sidebar collapse fix (§4.28) freed
  up real content width, so the row-wrap fallback isn't even needed in practice, but the
  capability is there if a longer label/value combination ever requires it.

### 4.32 Logout wired (`dashboard-sidebar.js`) — COMPLETE (Aug 20, 2026)
Logout had no real behavior on any dashboard page — a plain `<a href="index.html">Logout</a>`
duplicated in all 9 pages' own headers, sending the client to the public marketing site.

- **Session-state investigation, reported before any code changed:** grepped every
  `localStorage.setItem`/`getItem`/`removeItem` call across every `.html`/`.js` file in the
  project. Every key used anywhere is `marketswave_*`-prefixed and is a data-model key
  (product catalog, account state, holdings, allocation/sell requests, transactions, risk
  profile, settings profile/pending/2FA/notifications, HYS pockets, support requests) — **no
  "logged in" / session-state flag exists anywhere.** Per instruction, none was invented just
  to give Logout something to clear.
- **Fix:** wired in the shared `dashboard-sidebar.js` (not per-page) via a content-based
  lookup — `initDashboardSidebar()` now also finds every `<a>` on the page whose text is
  exactly "Logout" (the header markup isn't part of the shared mount, so it can't be found by
  a shared id the way the sidebar itself is) and (1) corrects its `href` to `login.html`
  (was `index.html`) and (2) attaches a click handler that's currently a documented no-op —
  the one place a real session-clear call will go once a session concept exists, rather than
  needing rediscovery across 9 files later. This is the same "every page gets it at once"
  centralization pattern already used for the sidebar and clock.
- **Verified in an actual browser on two different pages** (`dashboard.html` and
  `support.html`, confirming the shared-component fix needed no per-page changes) — the
  `href` attribute correctly reads `login.html` on both, and clicking it on `dashboard.html`
  navigated to `login.html` for real, not just a corrected attribute that was never exercised.
- **Logged in the Backend Requirements Register** (§3.1 item 1, folded into the existing Auth
  row) so the "add the real session-clear call" follow-up isn't lost track of.

### 4.33 Polish fix — Quick Contact card CTA alignment (`support.html`) — COMPLETE (Aug 20, 2026)
The three Quick Contact cards (Call Us, Chat with Us, Email Support) have different amounts
of content above their CTA — different button/link vertical positions across siblings, the
same class of bug already diagnosed and fixed on `asset-performance.html`'s Asset Collection
cards this session (§4.22's card-alignment fix).

- **Fix:** applied the identical pattern — `flex flex-col` added to each of the three card
  divs, and each card's CTA (a single button for Call Us/Chat with Us, the two-button
  Copy/Email Us row for Email Support) wrapped in its own `<div class="mt-auto pt-4">`, so it
  anchors to the card's bottom regardless of how many lines of text sit above it, with
  `pt-4` preserving the same visual gap the original inline `mt-4` margins provided.
- **Verified in an actual browser** — measured all three CTA buttons'
  `getBoundingClientRect().top` directly rather than eyeballing it: 376.8px, 378.4px, 376.8px
  — aligned to within 1.6px (a sub-pixel/border rounding artifact, not a real misalignment).

### 4.34 Documents & Reporting data layer migrated into `engine-core.js` — COMPLETE (Aug 20, 2026)
`documents.html` previously tracked its 8 documents entirely as hardcoded HTML rows with
`data-*` attributes, mutated in place by page-local JS — no shared storage, no reuse. This
brings it into `engine-core.js`, matching the pattern already used for products/holdings/
transactions, **without changing documents.html's UI, layout, or component structure at
all** — only where its data lives.

- **Schema** (`marketswave_documents`): `{ id, filename, category, direction: 'from'|
  'upload', date, status, isNew, deadlineLabel }`. `status` is a free-form string
  (`'Signature Required'`, `'Signed'`, `'Received'`, `'Under Review'`, or `null` for a
  from-document with no special state) rather than an enum, matching how `assetClass` on
  Product Catalog entries is also unvalidated free text — consistent with the engine's
  existing looseness elsewhere. `deadlineLabel` is a nullable display string (e.g.
  `'Due in 5 days'`) rather than a real deadline date with live day-countdown logic — the
  original UI only ever showed one static hardcoded label, and inventing a dynamic
  countdown feature that wasn't there before would be scope creep beyond "migrate storage,
  don't change behavior."
- **Seed data mirrors the original 6 "from" + 2 "upload" hardcoded rows exactly**, same
  order, same field values, so migrating to this store doesn't change what a fresh install
  shows — verified via Node (`getDocuments()` returns all 8 in the original order with the
  original filenames/categories/dates/status/isNew/deadlineLabel values intact).
- **API**: `getDocuments()` / `getDocument(id)` (deep-cloned, same defensive-copy discipline
  already established for holdings/allocation requests — applied proactively this time, not
  discovered as a bug afterward), `addDocument(doc)`, `updateDocument(id, patch)` (the real
  primitive — merges any patch fields and persists in one atomic call, needed because Sign
  changes three fields — `status`, `isNew`, `deadlineLabel` — together),
  `updateDocumentStatus(id, newStatus)` (a thin convenience wrapper over `updateDocument`
  for the common single-field case, matching the exact function name the user suggested),
  `removeDocument(id)`, and `getDocumentNotificationCounts()` — the notification-badge
  computation (new/signature/deadline/urgent counts), previously logic living only inside
  documents.html's own script, now a reusable aggregate reader any page can call. Not yet
  actually called from any page besides `documents.html` — the capability is there, but
  nothing else uses it yet (logged in §3.1 item 10).
- **documents.html migration**: rows are now rendered from `getDocuments()` via a
  `docRowHTML()` template function reproducing the exact original markup (same classes,
  same badge/button structure) instead of being hand-written HTML; every action
  (Sign/Download/Upload/Remove) now calls the engine API and re-renders, rather than
  surgically patching one row's DOM in place — an internal implementation change, not a
  user-visible one. Filtering, the notification chips' jump-to-and-flash behavior, and the
  toast pattern are otherwise untouched logic, just re-querying the freshly-rendered rows
  each time instead of static ones.
- **Verified in an actual browser, per the user's explicit instruction** (a real behavioral
  migration on a page with several interactive flows, not something Node/jsdom alone could
  confirm matches the original page's exact behavior): confirmed zero console errors beyond
  the standard Tailwind CDN warning; initial render showed all 8 documents with correct
  badges and exactly the original notification counts (2 New / 1 Signature Required / 1
  Deadline This Week); Sign correctly transitioned the badge to "Signed," removed the Sign
  button, and dropped the sidebar badge from 2 to 1; Download correctly cleared the "New"
  badge on click; category and direction filters correctly narrowed results and toggled
  section visibility; Upload correctly appended a new row with the right fallback filename,
  category, and today's date; the notification chip correctly reset filters and
  scrolled-to-and-flashed the matching row.
- **Real native-dialog interaction, handled correctly, not glossed over**: the Remove
  button's `window.confirm()` (preserved exactly from the original page, per "same...remove
  flows") froze the browser automation tooling mid-test, since native JS dialogs block all
  further CDP commands — flagged to the user immediately rather than forcing through it;
  the user dismissed it manually (Cancel), confirming Cancel correctly leaves the document
  untouched. Verified the actual removal path afterward by stubbing `window.confirm` to
  return `true` via injected JS (avoiding retriggering the same automation freeze) — the row
  disappeared from the DOM, the upload count dropped, and critically `getDocuments().length`
  and the raw `localStorage` contents both dropped from 8 to 7, confirming a real persisted
  removal through the engine, not just a DOM change.
- **Confirmed via direct `localStorage` inspection that every mutation this session
  persisted for real** — read `marketswave_documents` directly after several actions and
  found `DOC-0001.status === 'Signed'` and `DOC-0002.isNew === false`, matching the UI
  exactly, proving the page is genuinely backed by the shared store now rather than an
  in-memory illusion.

---

### 4.35 Two polish fixes — support.html dispute IDs + documents.html custom Remove modal — COMPLETE (Aug 20, 2026)
Two small, unrelated fixes requested together in one session.

**support.html — Open a Dispute panel:**
- Removed the "Reference Number" input entirely — a client-typed reference number didn't
  match how every other id in the system works. The Category field now takes the full
  width the two-field row previously split.
- Added `nextDisputeId()`, a local helper mirroring `engine-core.js`'s `nextSequentialId`
  algorithm (scan existing ids for the highest `DISP-<n>` suffix, increment, zero-pad to 4
  digits) — replaces the old ad-hoc `DSP-${3000 + count}` numbering. Implemented locally in
  support.html's own script rather than importing `engine-core.js`'s internal helper:
  support requests are their own domain (`marketswave_support_requests`), not part of the
  portfolio/document engine, and loading `engine-core.js` just for one id-formatting helper
  would be a heavier coupling than the fix calls for.
- The generated id (e.g. `DISP-0001`) is shown directly in the post-submit toast ("Dispute
  DISP-0001 submitted.") and stored on the new request record, so it's visible later in "My
  Requests" exactly as `req.id`.
- Existing seed data (`DSP-2077`) was left untouched — it's historical demo data, and
  `nextDisputeId()` only scans `DISP-`-prefixed ids when computing the next number, so the
  old-format seed entry doesn't interfere with new numbering (new disputes correctly start
  at `DISP-0001` regardless of the legacy seed row).
- Added a divider (`border-t border-slate-100`, `mt-6 pt-5`, later strengthened to
  `border-slate-200`/`mt-8 pt-6` — see §4.36) between the Evidence file input and the error
  message / Submit Dispute button, so Submit reads as a distinct final action instead of
  sitting clustered directly under Evidence.

**documents.html — custom Remove confirmation modal, replacing `window.confirm()`:**
- Neither of the two patterns the user pointed at turned out to be a genuine custom modal
  to copy directly: `settings.html`'s "session logout confirm" is itself still a native
  `window.confirm()` (checked directly — `logout-all-btn` and `.session-logout-btn` both call
  `window.confirm(...)`), and `high-yield-savings.html`'s withdraw warning is a multi-step
  wizard modal (`data-step="warning"` inside a larger New Pocket/Withdraw flow), heavier
  than a single yes/no confirmation needs. Instead, built a small standalone confirm modal
  (`#remove-confirm-modal`) following the same structural pattern already used for
  `settings.html`'s `#change-modal` — `fixed inset-0 z-50 flex items-center justify-center
  p-4` backdrop (`bg-navy-dark/60`) + a `relative bg-white rounded-2xl shadow-xl` card,
  close (`&times;`), Cancel, and a primary action button — since that's the site's
  established modal shape, just simplified to a single confirm/cancel pair instead of a
  multi-field form.
- Same behavior as before: clicking a row's Remove button opens the modal showing the
  filename, Cancel or the backdrop/close button dismiss with no change, and the modal's own
  "Remove" button calls `removeDocument()` and re-renders exactly as the old
  `window.confirm()` path did.
- This removes the native-dialog dependency flagged in §4.34 — native `window.confirm()`/
  `alert()`/`prompt()` calls block the Chrome DevTools Protocol entirely, freezing browser
  automation mid-session. The new modal is plain DOM, so it no longer blocks automated
  testing of this flow.
- Verified with a Node syntax check (`new Function(...)` over both files' inline `<script>`
  blocks) — no browser verification performed this session per the standing Verification
  rule in `CLAUDE.md` (launch a browser only if explicitly asked, or ask first when
  genuinely unsure a fix works); a manual click-through of both flows is worth doing before
  fully trusting them, particularly documents.html's modal open/cancel/confirm cycle.

Logged in the Backend Requirements Register: §3.1 item 9 (Documents & Reporting — storage)
now notes the custom modal; §3.1 item 19 (Support — call/dispute) now notes the
system-assigned dispute id.

---

### 4.36 Follow-up: divider strengthened + CLAUDE.md "Current status" rewrite — COMPLETE (Aug 20, 2026)
Two small follow-ups in the same-day session after §4.35.

**support.html — Evidence/Submit Dispute divider strengthened:** the user reported the
spacing fix from §4.35 as not landing, across two follow-up requests. Each time, a direct
re-read of the live file on disk confirmed the divider *was* present and unchanged from
what §4.35 shipped — no accidental revert, no duplicate/stale copy of `support.html`
anywhere else on the machine (checked via a broad filesystem search of common project/web
roots). Since the on-disk state was already correct, the working theory is a rendering or
browser-cache issue on the viewing side rather than a missing edit — flagged to the user
directly rather than silently re-applying the identical change. As a low-risk improvement
regardless of cause, the divider was strengthened to be more visually obvious:
`border-slate-100` → `border-slate-200` (matches the card's own border weight, so the line
reads as an intentional section break rather than a near-invisible hairline) and `mt-6
pt-5` → `mt-8 pt-6` (more breathing room). **User confirmed in-browser afterward: "checked
& looks fine."**
- **Lesson for future sessions**: when a user reports a previously-verified fix as "not
  landing," re-read the live file before re-editing — don't assume the fix regressed and
  don't assume the user is wrong either. Confirm the actual on-disk state first, report it
  plainly, and only then decide whether to strengthen the change, investigate a caching/build
  issue, or ask the user to double check what they're viewing.

**CLAUDE.md — "Current status" section rewritten, no longer a competing narrative log:**
the section had gone stale — it still described the pre-engine-phase dashboard-family state
and said "next major phase is the portfolio engine," even though the Tech Stack section
above it already documented Phases 1 through 4d, the Documents & Reporting migration, the
DISP-id fix, and the Remove-modal fix, all shipped since. Root cause: two separate narrative
sections (Tech Stack's dated chronological log vs. a standalone prose summary) that only one
of them — Tech Stack — was actually being kept current in practice, so the other silently
drifted. Rather than keep maintaining both, "Current status" was rewritten as a short,
present-tense snapshot (public site/onboarding/dashboard family built; engine built through
Phase 4d and where it's wired; most recent fixes; what's not yet browser-verified; what's
next) that explicitly defers to the Tech Stack section and the handover doc's §4 for detail,
instead of duplicating it. This removes the structural cause of the drift rather than just
patching the stale text once more.

---

### 4.37 Notification bell — shared header component — COMPLETE (Aug 20, 2026)
Built the unified "needs attention" aggregation point for the dashboard: a working bell in
the shared header, replacing the purely decorative one that previously existed on only 2 of
9 pages (`dashboard.html`, `asset-performance.html` — a static SVG bell with a hardcoded red
dot, no count, no dropdown, no click behavior; the other 7 pages had no bell at all).

**Investigation before building:** checked how the header itself was structured, since the
task asked specifically whether it needed a shared component like the sidebar got. Found
the header was NOT part of `dashboard-sidebar.js`'s mount — it's duplicated inline in every
page's own `<body>`, and only 2 of the 9 copies actually had a bell. Given a working bell
needed to land on all 9 pages identically, a shared component was the clear answer, built
the same way the sidebar was: a new `dashboard-notifications.js` exposing
`initDashboardNotifications()`, mounted into an empty `<div id="notif-bell-mount"></div>`
that replaced the two existing decorative buttons and was newly added to the other 7
pages' headers (before the Logout link, same position both existing bells already had).
`engine-core.js` was also newly added to the 5 pages that didn't yet load it
(`risk-management.html`, `high-yield-savings.html`, `settings.html`, `support.html`,
`deploy-capital.html`) — the bell needs it everywhere, not just the 4 pages already wired
to the portfolio engine.

**Aggregation — five sources, three read straight through existing engine functions:**
- **Documents**: via `getDocuments()` (not `getDocumentNotificationCounts()` — that
  function only returns aggregate counts, and the dropdown needs individual items with
  their own filename/timestamp/link, so item-level detail reads the same underlying
  `getDocuments()` source instead; this isn't parallel counting logic, just a different
  read of the same store). One item per `isNew` / `'Signature Required'` / `deadlineLabel`
  condition — a single document can produce more than one notification.
- **Allocation requests** (`getAllocationRequests()`): one item per `pending` request, plus
  one per request that just moved to `approved`/`rejected` — keyed by `id + status`, so
  approval and rejection each produce their own distinct one-time notification rather than
  overwriting or suppressing each other.
- **Sell requests** (`getSellRequests()`): identical treatment to allocation requests.
- **High Yield Savings pockets** — **read directly from `marketswave_hys_pockets`,
  deliberately NOT migrated into `engine-core.js` for this feature.** Flagged choice, not
  an oversight: migrating that store would mirror the much larger Documents & Reporting
  migration (§4.34) — a full storage/API move — which is a bigger, unrequested scope
  expansion than "aggregate into a notification bell" asked for. Logged as a forward-looking
  note in §3.1 item 30 in case HYS is migrated later for other reasons. One real consequence
  of reading directly: a pocket's stored `status` field only ever advances from `'active'`
  to `'matured'` inside `high-yield-savings.html`'s own `updatePocketStatuses()`, which
  doesn't run on other pages — so the bell computes maturity independently from
  `maturityDate` vs. the current time on every read, rather than trusting a `status` value
  that could be stale on any page other than High Yield Savings itself. Near-maturity
  (within 7 days) and already-matured are two separately-keyed notifications per pocket, so
  reading one doesn't suppress the other.
- **Support requests** — read directly from `marketswave_support_requests`, same
  not-migrated rationale as HYS. A notification fires only for a request that has moved OFF
  its original `'Open'` status (`'In Progress'` or `'Resolved'`) — submitting a request
  isn't itself a notification, since the client obviously already knows they just submitted
  it; a status change away from that is the actual "needs attention" signal. Keyed by
  `id + status`, so a request moving `Open → In Progress → Resolved` produces two separate,
  independently-read notifications rather than one that gets stuck read/unread.

**Read state**: `marketswave_notifications_read`, a flat `{ [itemKey]: true }` map — a
per-item marker, not one global "last seen" timestamp, exactly as specified, so a new
notification arriving after an old one was read still shows up as unread on its own.
Opening the dropdown marks everything currently listed as read and persists immediately;
the badge count is always computed fresh from `items.filter(unread).length` against the
live read map, never cached.

**UI**: bell + red count badge (caps display at "9+"), click toggles a dropdown panel
(newest-first, category dot + description + relative "Xm/h/d ago" timestamp + click-through
link to the relevant page), backdrop-click/outside-click/Escape all close it — same
interaction conventions as the sidebar's own drawer. Empty state shows "You're all caught
up." when there are genuinely zero items (not just zero *unread* items — a fully-read but
non-empty list still renders its items, just without unread dots).

**Existing per-page indicators explicitly left alone**, per the task's own instruction:
`documents.html`'s header chips and the sidebar's Documents badge (`#sidebar-doc-badge`)
are untouched — the bell aggregates alongside them, not instead of them.

**Browser-verified** (per the task's own instruction — this touches every dashboard page
and involves persisted read state, which Node/jsdom can't validate correctly), via a
temporary local HTTP server (not the user's real browsing profile — file:// URLs aren't
navigable by the browser-automation tooling, and `localhost:8791`'s `localStorage` is
fully isolated from whatever the user normally uses to view the site, so no cleanup of real
data was needed afterward):
- Fresh seed on `dashboard.html`: bell showed a real "4" badge (the seed's 4 document-level
  conditions), dropdown listed all 4 with correct categories/timestamps, opening cleared
  the badge to 0, and the read state survived a full page reload.
- Seeded one pending + one approved allocation request, one pending sell request, an
  at-maturity HYS pocket, a near-maturity HYS pocket, a far-future HYS pocket (confirmed it
  correctly produced NO notification), and a support request moved to `'In Progress'` —
  every one appeared with the correct category label, dot color, text, and relative
  timestamp; the far-future pocket correctly stayed silent.
- Cross-page consistency confirmed: navigating from `dashboard.html` to `support.html` via
  a notification's own link landed on the right page, and the badge stayed correctly
  cleared there too, since read state is shared through the one `localStorage` key rather
  than tracked separately per page.
- **The core "new notification after a read still shows correctly" requirement was tested
  directly, not just asserted**: after everything above was read (badge at 0), rejected one
  pending sell request via the console (`rejectSellRequest()`) — a genuinely new event on
  data that had already been fully read — and confirmed the badge came back showing exactly
  "1", the freshly-generated `sell-resolved-...-rejected` notification, with nothing else
  reappearing as unread.
- Zero console errors across every page visited.
- The empty-state DOM branch was checked separately via a non-destructive script (swapping
  in the empty-state markup directly, without touching any real `localStorage` data) rather
  than by actually wiping the demo dataset, since reaching genuine emptiness organically
  wasn't practical without destroying real seed data the user will look at later.

Logged in the Backend Requirements Register as a new §3.1 item 30.

---

### 4.38 Admin tool Phase A — deposit request queue (engine layer only) — COMPLETE (Aug 20, 2026)
First piece of the upcoming admin/Portfolio Manager tool, scoped deliberately narrow per
the user's own instruction: engine layer only, no HTML touched, verified via Node exactly
like Phases 1–3B were.

**`marketswave_deposit_requests`**, loaded independently (same pattern as the allocation/
sell/documents stores — an existing install's real data must not be wiped just because
this key predates it): `{ id: "DEP-0001", method: "crypto"|"bank", requestedAmount,
currency, status: "pending"|"credited"|"rejected", requestedAt, requestedAtMs, resolvedAt,
creditedAmount, transactionId, reason, details }`. `details` holds whatever the client
submitted on Deploy Capital (crypto asset/network, or bank sender/institution fields) —
kept on the record so a PM can reconcile against what actually arrived.

- **`requestDeposit(method, amount, currency, details)`** mirrors `requestAllocation()`/
  `requestSell()` exactly: creates a `pending` record, moves no money, touches no
  transaction ledger. Validates `method` is `'crypto'`/`'bank'`, `amount` is a positive
  number, and `currency` is present.
- **`creditDepositRequest(requestId, confirmedAmount)`** is the one genuine departure from
  the allocation/sell pattern: the amount that actually lands is a **PM-entered figure**,
  not necessarily what the client originally typed — real-world wire fees, FX conversion,
  or a partial transfer can all make the two differ. `confirmedAmount` is authoritative;
  `requestedAmount` stays on the record purely as the client's original claim to reconcile
  against. Validates the request is still `pending` and `confirmedAmount` is a positive
  number (re-crediting an already-resolved request throws rather than double-crediting —
  verified directly, not just assumed). Increments `unallocatedCapital` by
  `confirmedAmount`, appends a `DEPOSIT` transaction (`productId: null`, `units: null`,
  `price: null` — nothing was bought, just `totalValue`, `date`, and the deposit `method`),
  and marks the request `credited` with `creditedAmount` + `transactionId` + `resolvedAt`.
- **`rejectDepositRequest(requestId, reason)`** mirrors the allocation/sell reject
  functions exactly — status + reason only, moves nothing.
- **`getDepositRequests()`** — same deep-clone + `requestedAtMs`-backfill treatment as
  `getAllocationRequests()`/`getSellRequests()` (via the existing shared `withSortTimestamp()`
  helper) — confirmed by mutating a returned record and re-reading to prove the internal
  array wasn't touched.

**Verified in Node** (`verify-deposit-phase-a.js`, run against the real `engine-core.js`
with a minimal `localStorage` shim, then discarded — not committed to the project, same
"install and remove locally" discipline as Phase 4d's jsdom verification):
`requestDeposit()` alone left `getTotalPortfolioValue()`, `unallocatedCapital`, and the
ledger length all completely unchanged; crediting with a `confirmedAmount` ($49,875.32)
deliberately different from `requestedAmount` ($50,000) produced a `creditedAmount`
matching the confirmed figure exactly, a `DEPOSIT` transaction with the confirmed
`totalValue` and `null` `productId`/`units`/`price`, and `getTotalPortfolioValue()`
increasing by exactly `confirmedAmount` (delta `49875.32`, to the cent); a second
`creditDepositRequest()` call on the now-`credited` request threw and left the total
unchanged; `rejectDepositRequest()` left `getTotalPortfolioValue()`, `unallocatedCapital`,
and the ledger length untouched, only flipping `status`/`reason`.

**Breakage audit of every existing `getTransactionLedger()` consumer, reported but NOT
fixed this phase, per instruction** (so the follow-up admin UI work is scoped knowingly
rather than discovering these live):
- **`transactions.html` — a real crash, not a misrender**: both the ledger table's row
  renderer and the drill-down modal call `txn.units.toFixed(4)` unconditionally. With
  `units: null` on a DEPOSIT record this throws a `TypeError`. Because the ledger table
  builds every row in one `.map()` call, a single DEPOSIT anywhere in the ledger breaks
  rendering of the **entire table**, not just its own row.
- **`transactions.html` — misrenders**: `txnProductName()` falls back to `txn.productId`
  (`null`) when `getProduct()` finds nothing — string-concatenated into the ledger table's
  Asset cell this renders the literal text `"null"`; in the modal, `textContent = null` is
  coerced to an empty string instead by the DOM spec's `[LegacyNullToEmptyString]` behavior,
  so the two call sites fail differently, not identically. `txnTypeLabel()` is a plain
  `type === 'BUY' ? 'Buy' : 'Sell'` ternary, so DEPOSIT falls into the `else` and is
  mislabeled "Sell" (wrong badge color, silently matches the Type filter's "Sell" option,
  and there's no "Deposit" option to filter to it directly). `formatUSD(null, 2)` doesn't
  crash (`Math.abs(null)` → `0`) but shows a meaningless `$0.00` Execution/Market Price.
  Both charts bucket by the same `type === 'BUY'` check, so a DEPOSIT counts as a "Sell" in
  the Transaction Volume bar chart and inflates the Net Cash Flow line under the wrong
  legend color. The modal's footer note is a hardcoded two-way ternary
  ("...following approval of a sell/allocation request") with no DEPOSIT case, so it shows
  the wrong copy.
- **`dashboard.html` Recent Activity**: same `null`-productId fallback, string-concatenated
  into the activity title, renders literally as `"Capital allocated — null"` — also
  wrongly prefixed "Capital allocated" (buy-style copy) since `isSell` is false for
  DEPOSIT.
- **`asset-performance.html` Return Table — confirmed unaffected**: its ledger read is
  already gated on `t.type === 'SELL' && t.productId === productId`, so a DEPOSIT record is
  excluded by the type check alone before the `null` productId could ever matter.

Logged in the Backend Requirements Register as a new §3.1 item 31, with an explicit note
that `creditDepositRequest()` shouldn't be surfaced from any client-facing UI until at
least the `transactions.html` crash is fixed in Phase B.

---

### 4.39 Fixed DEPOSIT rendering breakage from Phase A's audit — COMPLETE (Aug 20, 2026)
Same-day follow-up to §4.38: fixed every rendering path §4.38's own audit flagged, before
any admin UI gets built — these were live crashes the moment `creditDepositRequest()` is
actually used, not hypothetical.

**`transactions.html`:**
- `txnProductName()` now returns `'Cash Deposit (Bank Transfer)'` / `'Cash Deposit
  (Crypto)'` for a DEPOSIT instead of falling through to the failed product lookup that
  used to render the literal text `"null"`.
- `txnTypeLabel()` now returns `'Deposit'` for DEPOSIT instead of falling into the `else`
  branch of a binary BUY/SELL ternary and being mislabeled `'Sell'`.
- Ledger table badge styling: DEPOSIT gets its own `bg-blue-50 text-blue-700` (blue),
  distinct from BUY's emerald and SELL's red — reuses the same blue already established for
  "New" elsewhere in the app rather than introducing a new color.
- Ledger table Quantity/Price cells and the drill-down modal's Quantity/Execution
  Price/Market Price fields all now guard with `!= null` and render `'—'` instead of
  calling `.toFixed()`/`formatUSD()` on a `null` value — this is what fixes the actual
  crash, since the table builds every row in one `.map()` call that a single unguarded
  `.toFixed()` on one bad row used to abort entirely.
- Added a `"Deposit"` option to the Type filter dropdown (previously trimmed to Buy/Sell
  only because the engine couldn't produce anything else — it can now) — confirmed via
  direct DOM interaction that filtering by "Deposit" returns exactly the deposit row and
  nothing else.
- Modal footer note gets a third case (`'Credited following Portfolio Manager confirmation
  of a deposit request.'`) instead of falling into the sell/allocation binary ternary.
- **Charts**: implemented the recommended treatment (agreed with, not just adopted
  unquestioned) — Transaction Volume excludes DEPOSIT entirely from both the `buys`/`sells`
  accumulators (it measures buy/sell trading activity, not funding), while Net Cash Flow
  adds a `deposits` accumulator and includes it as a positive inflow alongside sells
  (`sells + deposits − buys`), since that chart is genuinely about money entering and
  leaving the account. Verified visually: the deposit's month shows no Volume bar but does
  lift the Net Cash Flow line.
- **Summary cards (Total Buys / Total Sells / Net Invested) — confirmed already correct,
  no code change needed**: `buys`/`sells` were already filtered by exact `t.type === 'BUY'`/
  `'SELL'` equality, which naturally excludes DEPOSIT; `Net Invested` reads `getHoldings()`
  entirely independently of the ledger. Confirmed via the same live browser session (Total
  Buys stayed at 4 transactions/$954,136, Total Sells stayed $0, after a $39,875.50 deposit
  was credited).

**`dashboard.html` Recent Activity**: DEPOSIT now gets its own branch — a blue dot, title
"Deposit credited", and a detail line of amount · date · method (`Bank Transfer`/`Crypto`)
— replacing the old fallback that rendered the literal text "Capital allocated — null".

**`transactions.html`'s own Recent Activity instance** (separate from the ledger table)
already reused `txnProductName()`/`txnTypeLabel()`, so it inherited the "Cash Deposit
(...)" / "Deposit" fix automatically with no separate edit — confirmed showing "· Deposit"
correctly in the live browser check, not just assumed from the shared-helper fix.

**Verified live in a browser with a real DEPOSIT transaction present** (temporary local
server, same setup discipline as §4.37's bell verification — isolated from the user's real
browsing profile), created via `creditDepositRequest()` in the console exactly as the task
specified (mirroring how SELL test data was seeded in earlier phases): zero console errors
on every page visited; the ledger table row rendered `"Cash Deposit (Bank Transfer)"` /
blue `"Deposit"` badge / `"—"` / `"—"` / `"$39,876"` with no crash; the drill-down modal
opened cleanly showing `"—"` for Quantity/Execution Price/Market Price and the new deposit
footer copy; the Type filter's "Deposit" option correctly isolated exactly one row;
`dashboard.html` showed "Deposit credited · $39,876 · 2026-08-20 · Bank Transfer" with a
blue dot, and Total Portfolio Value correctly read $1,324,376 — up from the $1,284,500 seed
by the $39,875.50 credited amount.

No changes to `engine-core.js` in this follow-up — purely the four rendering paths §4.38
flagged.

### 4.40 Browser verification pass (4 pages) + real bug found and fixed in settings.html toggles (Aug 20, 2026)
Resumed the checkpointed 4-item browser verification pass (`high-yield-savings.html`,
`settings.html`, `support.html` non-dispute sections, `risk-management.html`), one browser
session via a temporary local server, same discipline as prior live-browser phases.

**`high-yield-savings.html` — PASS on all sub-checks.** Created a Short-Term Fixed Deposit
(1 Month) and confirmed its early-withdraw shows the "Interest will be forfeited" warning
with correct principal/forfeited-interest figures; created a Locked (1-5 Years) Fixed
Deposit and confirmed it shows "Locked until maturity — no early withdrawal available" with
no Withdraw button at all (not just a disabled one); created an As You Want pocket and
confirmed its withdraw flow goes straight to the funding-method step with no warning;
completed a full As You Want withdrawal (Bank) and confirmed both the pocket's "Withdrawn"
state and the balance/active-pocket-count deltas survive a hard reload.

**`settings.html` — real bug found and fixed.** Inline Email/Phone edit+save and a Request
Change submission (Legal Name → "Pending Review" badge) all worked correctly first try. The
2FA toggle did not: clicking it caused the entire page layout to visibly break — the navy
sidebar appeared to shrink to a fraction of its height and page content below a certain
point rendered as blank white space. Root-caused via direct DOM inspection (not guessed):
the toggle's `sr-only` checkbox (`<input id="twofa-toggle" class="sr-only peer">`) sat
inside a `<label class="inline-flex items-center cursor-pointer">` with no `position:
relative`, so the absolutely-positioned checkbox resolved against a far-off ancestor instead
of its own small label wrapper, landing over 1000px down the document. Focusing it on click
made Chrome auto-scroll the whole window to reveal it — but `high-yield-savings.html`-style
pages here rely on an internal `<main class="overflow-y-auto">` scroll region, not a
window-level scroll, so the window scroll and `main`'s own scroll desynced, visibly tearing
the fixed-height sidebar away from the viewport. The exact same unguarded pattern existed on
all 4 Notification Preferences toggles in the same file (Statements & Reports, Allocation
Approvals, Document Uploads & Signatures, Deadlines) — grep confirmed no other page in the
project uses this `sr-only peer` toggle pattern, so the bug was isolated to this one file.
**Fix:** added `relative` to all 5 labels. Re-verified after the fix: the 2FA toggle now
opens its "Set Up Two-Factor Authentication" QR/confirmation-code panel cleanly with no
layout break, `Confirm` sets it to Enabled and that state survives a reload, and a
Notification Preferences toggle click no longer breaks the layout either. Individual
session "Log out" (Active Sessions & Linked Devices) also confirmed working — it uses a
native `window.confirm()`, which froze the browser-automation tooling mid-test exactly like
the pre-fix `documents.html` Remove action documented in §4.35; dismissed manually and
confirmed the underlying logout itself works correctly once past the dialog. **Flagged, not
changed:** this native-confirm pattern is real, standard browser behavior for actual users
and isn't broken — it only obstructs automated testing — so it wasn't touched, unlike
`documents.html`'s Remove action which was a deliberate, separately-scoped fix in a past
session. Header "Logout" confirmed as a direct navigation to `login.html` with no dialog, as
documented.

**`support.html` non-dispute sections — PASS on all three.** Request a Callback modal
correctly prefilled Name/Phone from the live settings profile (including the phone number
just edited moments earlier in the same session, confirming cross-page
`marketswave_settings_profile` reads) and fired the expected "Callback Requested" toast on
submit — confirmed via direct DOM/JS inspection after an initial screenshot missed the
toast's timing window, not because the feature was broken. Start Chat opened the panel with
the agent greeting and correctly cycled through multiple distinct canned replies across two
sent messages (both via the Send button and via Enter). Email Copy fired the expected
"Email Copied" toast; a follow-up attempt to also verify the actual clipboard write via
`navigator.clipboard.readText()` froze the tab on a permission prompt this sandboxed
automation can't dismiss — a limitation of that verification method, not a page bug, and
unrelated to the toast confirmation already obtained.

**`risk-management.html` — PASS on all sub-checks.** Clicking through all three pills
(Conservative/Balanced/Aggressive) correctly updated Risk Tolerance's label+description,
correctly left Risk Capacity ("Moderate–High") unchanged while updating its alignment note
(✓ Aligned for Conservative/Balanced, ⚠ "Selected tolerance exceeds your risk capacity" for
Aggressive), and correctly recomputed the Portfolio Diversification Score delta per level
(e.g. "Under Conservative: 71/100 (-7 pts)," "Under Aggressive: 75/100 (-3 pts)") while a
preview is active, reverting to "This is your current allocation" once saved. Saving
Aggressive updated the "Current Profile" badge, cleared the preview-only state, and survived
a hard reload.

**Test data note:** the HYS pockets/withdrawal, the email/phone/2FA/Legal-Name-request
changes, and the saved Aggressive risk profile created during this pass are live in the
temporary local server's `localStorage`, consistent with how prior live-browser-verification
phases (§4.34, §4.37) left their own test data in place rather than reverting it.

### 4.41 Admin/Portfolio Manager tool — Phase B MVP, all 5 steps (Aug 20, 2026)
Built the first admin-facing page family: a new, separate persona from the client dashboard,
not linked from it anywhere, sharing its own admin sidebar (`admin-sidebar.js` — deliberately
NOT merged into `dashboard-sidebar.js`, per instruction, since client and admin nav must
never mix). No login gate yet (explicitly deferred), but every admin page carries an
unmistakable visual marker: a persistent red "INTERNAL TOOL — Portfolio Manager Access Only
— Not the Client-Facing Site" banner at the top, plus a wholesale distinct color scheme
(slate-900 sidebar, amber accents, `bg-slate-100` body) instead of the locked navy/cream
client tokens — a deliberate divergence, not an oversight, so the two are never visually
confusable even at a glance.

**Shell (`admin.html`) + `admin-sidebar.js`:** 5 nav items (Overview, Deposits, Allocations,
Sells, Settings), same off-canvas-drawer-below-`lg` responsive pattern as the client sidebar
(independently implemented, not shared code, so the two personas' element ids never
collide). The Overview page reads `getDepositRequests()`/`getAllocationRequests()`/
`getSellRequests()`, each filtered to `status === 'pending'`, as three linked count cards —
the PM's landing view of what needs attention, with an "all caught up" state when every
queue is empty. Reused the proven `h-screen`-on-`<aside>` fix from the client sidebar's own
§4.30 bug (the mount div doesn't establish a flex-stretch context for its child, so an
explicit height is required, not a percentage) rather than rediscovering it the hard way.

**Deposits (`admin-deposits.html`):** Pending section shows method (crypto/bank badge),
`requestedAmount` + `currency`, and the client-submitted `details` rendered generically as
humanized key:value pairs rather than assuming a fixed shape — no page has ever called
`requestDeposit()` through a real UI yet (Phase A was engine-only), so the eventual
client-side deposit form's field names on `deploy-capital.html` aren't locked in; this
renders correctly regardless of what shape that future form ends up using. Credit opens a
modal pre-filled with `requestedAmount` but editable — the whole point, per Phase A's own
design, being that real settlement (wire fees, FX, partial transfers) may differ from what
was requested — calling `creditDepositRequest(id, confirmedAmount)`. Reject opens a reason
modal calling `rejectDepositRequest(id, reason)`. History shows resolved requests read-only,
flagging with "(differs)" when `creditedAmount` doesn't match `requestedAmount`. This is the
first time `creditDepositRequest()` has ever been exercised through a real UI instead of
console-created test data — closes the loop on Phase A's own `getTransactionLedger()`
rendering-breakage fix (§4.39), which is now live-tested rather than just defensively coded.

**Allocations (`admin-allocations.html`):** Pending section shows product name (via
`getProduct()`), requested amount, `requestedAt`. Approve opens a lightweight confirm modal
(not a native `window.confirm()` — deliberately avoided, per the standing project preference
established when `documents.html`'s Remove action was moved off it, since native dialogs
block browser-automation testing tools) calling `approveAllocationRequest(id)` directly, no
PM-editable amount — unlike deposits, the requested amount is exact and the engine executes
it as-is, per the task's own instruction. Reject mirrors Deposits' reason-modal pattern.

**Sells (`admin-sells.html`):** Pending section shows product name, `unitsToSell`, and a
computed current-value estimate (`unitsToSell × product.unitPrice`, labeled "(est., at
current price)" since it's a live snapshot, not a locked-in figure) so the PM has value
context before approving. Approve calls `approveSellRequest(id)`, which re-validates unit
availability against the CURRENT holding internally (Phase 3B) — its thrown error (e.g. an
oversell from two pending requests on the same holding both being approved) is caught and
shown inline in the modal rather than failing silently or crashing. History's Realized
Return column looks up the resolved request's `transactionId` in `getTransactionLedger()` to
show the actual realized gain/loss, color-coded, rather than re-deriving it independently.

**Settings (`admin-settings.html`):** Displays the current advisory fee rate
(`getAccountState().advisoryFeeRate`) with an editable input + Save calling
`setAdvisoryFeeRate(newRate)`, validation errors (non-positive/non-numeric) surfaced inline.
Confirmed via grep across every `.html` file that `admin-settings.html` is now the only page
that calls `setAdvisoryFeeRate()` — `transactions.html` only references it in a comment
explaining why it deliberately doesn't.

**Verification:** all 5 pages checked for console errors on load (none found) and rendered
correctly against real pending/history data already present in `localStorage` from earlier
sessions' testing (2 pending + 2 approved allocation requests, 1 pending + 1 rejected sell
request) — screenshots confirmed the Overview counts, Pending/History sections, and status
badges all matched that real data. **Interactive click-through (Credit/Approve/Reject
actions, the Deposits-queue confirmed-amount-differs case, and cross-checking results back
on the client-facing pages) was handed to the user to run themselves** per their explicit
instruction mid-session that they'd take over browser testing from here — a test outline was
given for Step 1's shell before that instruction landed; the user has the console commands
needed to seed a test pending deposit request (`requestDeposit()` has no client-side caller
yet) if they want to exercise the Credit flow with real data.

### 4.42 Multi-Client Data Model — Step 1: Client Registry (Aug 21, 2026)
First step of a new foundational phase: making the engine actually multi-tenant instead of
implicitly single-client. Not a git repo (checked before starting, per the user's own
"commit first" instruction — conditional on it being one), so there's no file-level rollback
safety net for this phase; flagged back to the user rather than silently proceeding as if
one existed. Node-verification is the substitute discipline here, same as every prior engine
phase, and matters even more given Step 2's re-keying risk still ahead.

Added `marketswave_clients` — a new **global, unscoped** store, explicitly NOT per-client
(same category as the Product Catalog: shared across every client by design). API:
`getAllClients()` / `getClient(id)` / `addClient(client)`, deliberately shaped identically to
`getAllProducts()`/`getProduct()`/`addProduct()` — defensive-copy reads (verified: mutating a
returned client object does not affect stored data, matching every other store's existing
convention), `nextSequentialId`-assigned `CLIENT-XXXX` ids on write.

Seeded with exactly one client, `CLIENT-0001`, representing the existing demo user every
other store in the file still implicitly belongs to (Step 2 is what actually re-keys them).
`name`/`accountType` are hardcoded ("John Doe" / "Individual Account") since neither is
stored anywhere in the project today — matching what's hardcoded in `dashboard-sidebar.js`'s
footer identity block and every page's header. `email`/`phone` are read from
`settings.html`'s own `marketswave_settings_profile` store if it exists in this browser
(falling back to that page's own hardcoded defaults otherwise) — chosen specifically so the
seed reflects real edits already made during the §4.40 browser-verification pass (email
`jdoe.test@example.com`, phone `+1 (415) 555-0199`) rather than silently reverting them to
generic placeholders. `createdAt` is a fixed `2026-01-01`, not `todayStrUTC()` — the field
represents account inception, and stamping it with whatever date this code first happens to
run would misrepresent a demo account as freshly created.

**Node-verified, three scenarios** (harness in the session scratchpad, not committed to the
repo): (1) fresh install with no settings profile yet — seed uses the settings.html
defaults, all fields/shape correct, defensive-copy behavior confirmed on both `getClient()`
and `getAllClients()`, `addClient()` correctly assigns `CLIENT-0002` and persists both
clients in order; (2) an existing settings profile with edited email/phone — seed correctly
pulls the real edited values, not the defaults; (3) `marketswave_clients` already
exists — confirmed the seed logic never re-fires and never overwrites already-stored client
data on a later load, the same idempotency guarantee every other store's own seed block
already provides. All three scenarios: 16 assertions, zero failures.

### 4.43 Multi-Client Data Model — Step 2: client-scoped keys + one-time migration (Aug 21, 2026)
The highest-risk step of the phase, flagged as such by the user's own instructions, and
treated accordingly: a complete inventory of every `localStorage` key in the project was
built first (`grep`-ing for every `marketswave_*` string literal across every `.html`/`.js`
file), before any code changed, to confirm the task's own list of "every per-client store"
was complete and accurate rather than trusting it blind. It was — 15 per-client keys total,
matching exactly.

**Inventory:** 7 owned by `engine-core.js` itself (account state, holdings, transactions,
allocation/sell/deposit requests, documents) and 8 owned by other pages, read/written
directly via raw `localStorage` calls with no engine involvement: `marketswave_risk_profile`
(`risk-management.html`'s own store, also read directly by `dashboard.html` for its Risk
Metrics badge), `marketswave_settings_profile`/`_pending`/`_2fa`/`_notifications`
(`settings.html`'s four independent stores — profile, pending Request-Change fields, 2FA
state, notification preferences — plus `support.html`'s own direct read of the profile store
for its Request-a-Callback modal's prefill), and
`marketswave_notifications_read`/`_hys_pockets`/`_support_requests`
(`dashboard-notifications.js`'s three direct reads, plus `high-yield-savings.html`'s and
`support.html`'s own reads/writes of their respective stores). Two keys confirmed to stay
global/unscoped: `marketswave_product_catalog` and `marketswave_clients` (Step 1) — shared
across every client by design, never migrated or re-keyed.

**Design decision — `clientScopedKey()` exposed publicly, not kept file-internal.** The task
described it as "an internal helper," but 8 of the 15 per-client keys are owned by pages
outside `engine-core.js` with no other access to a matching scoping scheme; keeping the
helper private would have forced each of those 6 files to reimplement the same string-
concatenation logic independently, risking subtle inconsistencies (a different separator, a
different default). Exported on `window` instead, alongside `setCurrentClientId()` /
`getCurrentClientId()`, so every file computes scoped keys identically.

**Design decision — reload-to-switch, not live mid-session re-keying.** Every store is
loaded ONCE into module-level variables when `engine-core.js`'s IIFE executes. Making a
client switch take effect WITHOUT a reload would require rewriting every getter/persist
function to re-check the current client and possibly re-load fresh data on every single
call — a much larger, riskier change than asked for, and unnecessary: Step 3's admin
selector (built next) naturally reloads/navigates after calling `setCurrentClientId()`,
which is enough for `sessionStorage`'s persistence-across-reloads to correctly re-scope
everything on the next load. `getCurrentClientId()` defaults to `CLIENT-0001` (never
null/undefined) specifically because of this: without an explicit default, every existing
client-facing page — none of which call `setCurrentClientId()` yet, that's Step 4 — would
start reading from a wrongly-suffixed key (e.g. `...:undefined`) the instant this step
shipped, breaking every page immediately rather than only once Steps 3/4 exist.

**Migration ordering — the one genuinely tricky sequencing constraint found.** The Client
Registry's own seed step (Step 1) reads the still-raw, pre-migration
`marketswave_settings_profile` key directly, to seed `CLIENT-0001`'s real email/phone. If
migration ran first, that key would already be gone by the time Step 1's seed logic looked
for it, silently degrading to generic defaults on any fresh install that actually had real
profile data. Resolved by moving the Client Registry load-or-seed block to run BEFORE
`migrateLegacyUnscopedKeysToClient0001()`, and confirming via a dedicated Node scenario
(below) that this ordering is preserved and does not regress Step 1's original behavior.

**Migration algorithm:** for each of the 15 keys, if the old unscoped key has a value, copy
it verbatim (raw string, not parsed/re-serialized — guarantees byte-for-byte fidelity) to
`"<key>:CLIENT-0001"` unless that scoped key already has data (never clobbers real data with
a stale legacy leftover), then delete the old key regardless. Runs inside `engine-core.js`
specifically because it's the one script confirmed to load before every other page's own
inline script on every page that owns one of the 8 external keys — centralizing this in one
place, verifiable via one Node harness, rather than duplicating migration logic across 6
files with no guarantee of which page a given browser visits first.

**Node-verified — 99 assertions across three harnesses, 0 failures**, kept in the session
scratchpad (not committed to the repo, since this isn't a git repo):
- *Step 1 regression* (16 assertions): the original Step 1 harness, re-run unchanged after
  Step 2's reordering, still fully passes.
- *Step 2 core* (69 assertions, 6 scenarios): fresh install (correct defaults, no raw keys
  left behind, Total Portfolio Value invariant unchanged at $1,284,500); full legacy
  migration of all 15 keys with byte-identical content verification (account_state checked
  field-by-field instead, since `settleAllProducts()`'s `recomputeAllocatedCapital()`
  legitimately recalculates `allocatedCapital` from holdings × current price on every load —
  a pre-existing invariant unrelated to migration, not a bug, confirmed correct at exactly
  the expected recomputed value); idempotent second load (byte-identical store before/after,
  proving migration never re-fires once legacy keys are gone); partial-legacy-state (only
  some keys have old data — only those migrate, others seed fresh normally); scoped-key-
  already-exists (legacy value never clobbers it, but the stale legacy key is still cleaned
  up); Client Registry seed ordering re-confirmed with real pre-migration profile data;
  `executeBuy()` write-through sanity under the new scheme.
- *Full request-lifecycle round trip* (14 assertions): `requestAllocation` →
  `approveAllocationRequest` → real BUY transaction; `requestSell` → `approveSellRequest` →
  real SELL transaction; `rejectAllocationRequest` with a reason; `requestDeposit` →
  `creditDepositRequest` with a confirmed amount differing from the requested one (Phase A's
  own core design point) → real DEPOSIT transaction and correct `unallocatedCapital` delta;
  full Documents CRUD (add/update/remove). These are exactly the action paths the admin
  tool's Phase B pages depend on — confirming they still work correctly end-to-end under the
  new scoped-key scheme, not just that individual getters/setters function in isolation.

**One real bug caught during test authoring, not shipped:** an early draft of the migration
test omitted seeding a legacy Product Catalog entry, and the resulting failure looked at
first like migrated `account_state`/`holdings` data being silently discarded. Root-caused via
a standalone debug script rather than guessing: the pre-existing "reseed catalog + account +
holdings together if any one of the three is missing" all-or-nothing invariant (present since
Phase 1, unrelated to this phase) correctly fired because the test's Product Catalog was
missing — not a Step 2 regression, but a genuine, useful discovery that this old invariant
now interacts with migration for the first time. Fixed by seeding a realistic legacy catalog
in the test, matching what any real pre-existing browser would already have.

**Not a git repo** (checked via `git status` before starting, per the user's own conditional
"commit first" instruction) — flagged back rather than silently proceeding as though a
rollback safety net existed. Node verification is the substitute discipline, and given this
step's blast radius, verification here is deliberately more extensive than any prior engine
phase's own Node checks.

### 4.44 Multi-Client Data Model — Steps 3-5: admin selector, client context, isolation proof (Aug 21, 2026)

**Step 3 — Admin Client Selector.** Added directly to `admin-sidebar.js`'s shared mount,
appearing above the nav on every admin page: a "Viewing Client" `<select>` populated from
`getAllClients()`, pre-selected to `getCurrentClientId()`. Defensive `typeof` guard (mirrors
`documents.html`'s own convention) skips rendering the selector rather than breaking the
whole sidebar if `engine-core.js` somehow isn't loaded — though in practice it always is, by
script-tag order. On change: `setCurrentClientId(select.value)` then `location.reload()`.
No queue page (`admin-deposits.html`/`admin-allocations.html`/`admin-sells.html`) needed any
code change — confirmed by design, not just assumed: Step 2's reload-to-switch architecture
means every store loads fresh from whatever `sessionStorage` now holds the instant the
reloaded page's `engine-core.js` IIFE runs, before any queue page's own script executes.
Live-checked in the real browser against this session's actual `localStorage` (not just
Node): the selector rendered "John Doe (CLIENT-0001)" and the Overview counts (0/2/1) matched
exactly what they were before Step 2's migration ran — real-world confirmation that the
migration correctly preserved this browser's actual pre-existing admin-tool test data
end-to-end, not just Node-simulated data.

**Step 4 — Minimal Client-Side Account Context — ORIGINAL VERSION, LATER FOUND BROKEN, see
§4.45.** First implementation: one line, `dashboard-sidebar.js`'s `initDashboardSidebar()`:
`setCurrentClientId('CLIENT-0001')`, guarded by a defensive `typeof` check, on the reasoning
that all 9 client-facing pages call this function after `engine-core.js` has loaded (same
timing argument as Step 3's selector), so this would cover every client page from one
place. Initially believed functionally a no-op given `getCurrentClientId()`'s own
`CLIENT-0001` default, with the cross-tab-session interaction flagged as correct-by-design
rather than a bug. **This reasoning was wrong** — see §4.45 for the real bug this placement
caused, found live during Step 5's own browser verification, and the fix (moving the reset
to file-load time instead, before `engine-core.js` loads at all).

**Step 5 — Isolation Proof.** The task's own framing — "this is the real test of whether
this phase worked" — meant the mechanism had to be provably correct, not just plausible.
Problem found before any browser testing: `addClient()` (Step 1) only ever wrote a Client
Registry entry; nothing initialized a new client's actual per-client stores, so the very
first time anything tried to load `CLIENT-0002`'s data, `engine-core.js`'s ordinary
load-or-seed logic would find nothing under its scoped keys and fall through to
`buildSeedData()` — silently cloning the full 4-product, $1,284,500 CLIENT-0001-shaped demo
portfolio onto every new client, the opposite of "fresh account, modest starting cash, no
holdings." Fixed with `seedMinimalClientStores(clientId, startingUnallocatedCapital)`,
called from `addClient()`: writes empty arrays for holdings/transactions/allocation
requests/sell requests/deposit requests/documents, and an account state with only
`unallocatedCapital` nonzero, directly to the new client's scoped keys — bypassing
`clientScopedKey()`/the module-level store variables entirely, since both still belong to
whichever client is currently active at `addClient()`-call time (typically CLIENT-0001, the
PM's default view), not the client being created. `addClient()` now accepts an optional
`startingUnallocatedCapital` field on its input, explicitly destructured out before the
record is persisted to the Client Registry — it's a one-time seeding parameter, not part of
a client's actual identity data, and leaving it in would have made the registry's own record
shape inconsistent depending on how a caller invoked `addClient()`.

**Node-verified end to end, 20 assertions, 0 failures** (harness re-uses the
reload-by-re-eval technique from Step 2's own verification): creating CLIENT-0002 while
viewing CLIENT-0001 doesn't touch CLIENT-0001's already-loaded in-memory state;
CLIENT-0002's pre-seeded stores are confirmed empty/minimal directly in the simulated
`localStorage` before any switch happens; switching context and reloading loads CLIENT-0002's
real empty holdings and starting cash through the actual getters (not just checking raw
storage); crediting a real deposit for CLIENT-0002 correctly updates only its own balance and
ledger; switching back to CLIENT-0001 confirms its balance, all 4 original holdings, and its
transaction ledger are byte-for-byte unaffected — explicitly checked that CLIENT-0001's
ledger does NOT contain CLIENT-0002's deposit transaction, not just that totals look right;
switching back to CLIENT-0002 a second time shows its own state correctly persisted (3000,
not reset back to 2500), proving the isolation holds across repeated switches, not just once.

**Run live in the browser** (the user explicitly asked for this after the Node-verified
build was handed off): created CLIENT-0002 via console (no "create client" UI exists in the
admin tool — not asked for in any of the 5 steps, Step 3 only asked for a selector among
existing clients — so this is a console action, consistent with how test data has been
seeded throughout this project's history):
`addClient({ name: 'Jane Newclient', email: 'jane@example.com', phone: '+1 (212) 555-0100', accountType: 'Individual Account', startingUnallocatedCapital: 2500 })`.
Switched to Jane through the real admin dropdown, seeded and credited a real $500 deposit
request through the real Credit modal, and confirmed via direct console checks that
CLIENT-0001's balance/holdings/6-transaction ledger were completely unaffected and that
switching back showed CLIENT-0001's exact original state. This live run is what surfaced
the real Step 4 bug — see §4.45.

### 4.45 Real bug found, diagnosed, fixed, and repaired live during Step 5's browser verification (Aug 21, 2026)

While running Step 5's isolation proof in the real browser (at the user's explicit request,
after the Node-verified build had been handed off), one more check was added beyond the
scripted plan: switching the admin tool to CLIENT-0002, then navigating to `dashboard.html`
in the SAME browser tab — testing the cross-persona interaction Step 4's original writeup
had confidently (and, it turned out, wrongly) called "correct behavior, not a bug."

**Symptom:** `dashboard.html` loaded with `getCurrentClientId()` correctly reporting
`CLIENT-0001`, `getHoldings().length` correctly `4`, `getAccountState().allocatedCapital`
correctly `1127498.84` — but `getAccountState().unallocatedCapital` was `3000`, which is
CLIENT-0002's value, not CLIENT-0001's real `153520`. A hard reload (`Ctrl+Shift+R`) didn't
change the result, ruling out a stale-script-cache explanation (the same class of issue that
turned out to be the actual cause of an earlier apparent bug during the settings.html
toggle-fix session — checked and ruled out here specifically, not assumed).

**Root cause, confirmed via direct raw `localStorage` inspection, not inferred:**
`localStorage.getItem('marketswave_account_state:CLIENT-0001')` showed the corruption baked
into real stored data, not a read-time bug. Traced to the exact sequence: (1) admin.html
switches to CLIENT-0002 and reloads, so `sessionStorage` holds `CLIENT-0002` when the user
then navigates to `dashboard.html`; (2) `engine-core.js`'s own IIFE runs first (per script
order) and loads CLIENT-0002's data into its module-level `accountState`/`holdings`
variables, since `sessionStorage` still says `CLIENT-0002` at that point; (3) a LATER inline
script tag runs `initDashboardSidebar()`, whose original Step 4 code called
`setCurrentClientId('CLIENT-0001')` at that point — updating `sessionStorage`, but with
`engine-core.js`'s module-level variables already populated from CLIENT-0002 and unable to
retroactively reload; (4) `dashboard.html`'s own separate script then calls
`settleAllProducts()` again (confirmed via `grep` — this is real, existing Phase 4a
behavior, not new), which calls `recomputeAllocatedCapital()` → `persistAccountState()`;
`clientScopedKey()` at THIS point resolves to the now-updated `CLIENT-0001`, so the STILL
CLIENT-2-shaped in-memory `accountState` (unallocatedCapital 3000) gets written under
CLIENT-0001's real key. `allocatedCapital` self-healed on the NEXT correctly-scoped page
load (it's always recomputed fresh from real holdings, which were never touched), but
`unallocatedCapital` has no equivalent recompute path and stayed corrupted — exactly
matching what was observed, once traced through.

**Fix:** moved the reset out of `initDashboardSidebar()` entirely, to `dashboard-sidebar.js`'s
own file-top-level code — this file is confirmed to always load BEFORE `engine-core.js` on
every client-facing page (script-tag order, same fact already used to justify Step 3's
selector timing), so the reset now runs before `engine-core.js`'s IIFE ever reads
`sessionStorage`. Uses the raw key string `'marketswave_current_client_id'` directly (not
`setCurrentClientId()`, which isn't defined yet at this point in the load sequence) —
documented as needing to stay in sync with `engine-core.js`'s own
`CURRENT_CLIENT_SESSION_KEY` constant.

**Re-verified live, the exact failing scenario repeated:** switched admin to CLIENT-0002,
navigated to `dashboard.html` in the same tab — now correctly shows CLIENT-0001's real data
(`unallocatedCapital` 153520, `allocatedCapital` 1127498.84, 4 holdings), confirmed both via
console and the on-page Total Portfolio Value figure ($1,281,019, matching
153520+1127498.84 rounded); confirmed CLIENT-0002's own stored data was untouched by this
navigation.

**Data repair:** CLIENT-0001's real `unallocatedCapital`, corrupted to `3000` by testing the
broken code, was restored to `153520` — the correct pre-corruption value, taken from this
session's own baseline check recorded before CLIENT-0002 was ever created (not guessed).
`allocatedCapital` and `holdings` needed no repair, having self-healed as described above.

**Regression test added** (session scratchpad, 6 assertions): simulates both orderings —
the broken one (engine loads before the reset) reproduces the exact corruption, confirming
the test is meaningful and not vacuously passing; the fixed one (reset before the engine
loads) shows CLIENT-0001 loading correctly and CLIENT-0002's data staying untouched.

**Why this matters beyond this one bug:** the original Step 4 writeup asserted the
cross-tab-session interaction was "correct behavior, not a bug" — a plausible-sounding
conclusion that turned out to be wrong the moment it was actually exercised end-to-end in a
live browser rather than reasoned about abstractly. Consistent with this project's own
"verify documentation claims against the actual live files before acting on them" principle
(see the working-conventions section of `CLAUDE.md`) — here extended to verifying *behavioral*
claims about running code, not just claims about file contents.

### 4.46 HYS Deposit Approval Queue — engine layer, checkpoint 1 of 2 (Aug 21, 2026)

Extends the request-queue pattern to High Yield Savings pocket funding. **Design decision,
reported as instructed**: built as a parallel store
(`marketswave_hys_deposit_requests`/`requestHYSDeposit()`/`creditHYSDeposit()`/
`rejectHYSDeposit()`/`getHYSDepositRequests()`) rather than extending the existing
`marketswave_deposit_requests`/`requestDeposit()` pattern. Reasoning: an HYS pocket-funding
request needs `pocketType` (fixed/AYW), term (short-month or locked-year), the derived
`rate`, and (at credit time) a computed `maturityDate` and `projectedInterest` — none of
which a plain cash deposit into `unallocatedCapital` has any use for. Bolting these on as
optional fields, populated only sometimes, would have made the generic deposit request
schema meaningfully messier for no benefit, when this project already has a clean, proven
precedent: allocation requests, sell requests, and deposit requests are each already their
own store with exactly the fields that request type needs, not one overloaded generic
table. The parallel store follows that existing precedent rather than introducing a new one.

**Rate tables intentionally duplicated, flagged not hidden**: `HYS_SHORT_TERM_BRACKETS`/
`HYS_LOCKED_RATES` inside `engine-core.js` are a byte-for-byte mirror of
`high-yield-savings.html`'s own `SHORT_TERM_BRACKETS`/`LOCKED_RATES`. The client page still
needs its own copy for the live rate/maturity/interest preview shown before a client ever
submits a request (unchanged, still page-local — the request just doesn't fire until they
confirm). The engine needs its own authoritative copy so a submitted request's `rate` is
independently derived from validated `pocketType`/term inputs, not trusted verbatim from a
client-computed value — the same principle already applied to every other money-affecting
figure in this file (price ticks via the seeded PRNG, advisory fee accrual, etc.). If either
table's numbers ever change, both copies need updating — a small, real DRY tension, worth
knowing about rather than discovering later when the two silently diverge.

**`creditHYSDeposit()` design points:**
- First engine code to ever touch `high-yield-savings.html`'s own pocket store
  (`marketswave_hys_pockets`) — reads/writes it directly via `clientScopedKey()` at call
  time rather than folding pockets into the main module-level load/seed pipeline, since
  nothing else in the engine needs pockets resident in memory (mirrors how
  `seedMinimalClientStores()` already writes directly to a specific client's keys outside
  the normal load path).
  Creates the pocket under the **request's owning client's** scoped key — resolved via
  `clientScopedKey()` at credit time, i.e. whichever client the PM currently has selected in
  the admin tool, matching how every other admin credit/approve action already resolves its
  target.
- Pocket funded with the **PM-confirmed amount**, which may differ from what the client
  requested — same design point Phase A's regular deposit queue already established
  (real-world wire fees/FX/partial transfers), now applied here too.
- `maturityDate` is computed from the actual **credit date**, not the original request
  date — a term deposit's clock starts when funds actually land, not when the client asked
  to open it, so a request sitting in the pending queue for a few days doesn't silently eat
  into the client's own term length.
- `projectedInterest` is recomputed from the **confirmed** amount using the request's
  already-validated `rate`/`termInYears` — not carried forward from whatever the client's
  own live preview showed at request time, since the confirmed amount may differ.
- Deliberately never touches `unallocatedCapital`/`allocatedCapital` — HYS pockets are their
  own pool, held apart from the main portfolio by design (matches
  `high-yield-savings.html`'s own "Held separately — not included in your Total Portfolio
  Value" copy) — unlike `creditDepositRequest()`, which does move `unallocatedCapital`.
- Still produces a transaction-ledger entry, type `HYS_DEPOSIT` (distinct from `DEPOSIT`),
  with a `pocketId` reference — so the activity shows up in the shared ledger per
  instruction, without conflating it with a portfolio-affecting deposit. **This new
  transaction type required a proactive audit of `transactions.html`/`dashboard.html`'s
  existing DEPOSIT-rendering code** (checkpoint 2, UI phase) to avoid reintroducing the
  exact "Capital allocated — null" class of bug Admin Tool Phase A's own audit already fixed
  once for `DEPOSIT` — confirmed by direct code inspection before writing any UI, not
  assumed safe.

**Node-verified, 57 assertions**: every validation path (invalid `pocketType`/`method`,
negative/zero amount, Fixed Deposit's $5,000 minimum enforced on both the requested AND the
PM-confirmed amount, invalid/out-of-range term values, AYW's genuine no-minimum exception);
rate/term/`termLabel`/`termInYears` computed correctly for both short-term and locked modes,
matching the client-side tables exactly; the PM-edited-amount credit flow (requested
$10,000, confirmed $12,000 — pocket funded with $12,000, `projectedInterest` recomputed
against $12,000 rather than $10,000, verified against the hand-calculated expected value);
AYW pockets get no rate/maturity and exactly zero projected interest; `unallocatedCapital`/
`allocatedCapital` confirmed unchanged by a credit; the ledger entry's shape and `pocketId`
reference confirmed; reject with reason; defensive-copy reads; and full multi-client
isolation (a request under CLIENT-0001 invisible to CLIENT-0002 and vice versa, each
client's credited pocket landing only under its own scoped key). The complete prior
regression suite (182 assertions across every earlier phase) was re-run alongside this and
still passes in full — this addition introduced no regressions.

### 4.47 HYS Deposit Approval Queue — checkpoint 2 of 2: client + admin UI, run live (Aug 21, 2026)

**Client side (`high-yield-savings.html`).** `createPocket()` — which used to push straight
into the `pockets` array and persist immediately — was replaced with
`submitPocketRequest(method, details)`, which calls `requestHYSDeposit()` and surfaces any
thrown validation error inline (same pattern as every other request-submission flow in this
project). The two funding-confirm handlers (`np-crypto-confirm`/`np-bank-confirm`) now call
this instead of `createPocket()`, mapping the already-computed `draft` object (`type`,
`termMode`, `termMonths`/`termYears`, `amount`) into the engine's `{mode, value}` term shape.
A new "My Pocket Requests" table (same "show everything" principle as
`asset-performance.html`'s own My Requests section) reads `getHYSDepositRequests()`, sorted
newest first, flagging with an amber "(requested $X)" annotation whenever the credited
amount differs from what was requested. Existing pockets render unchanged — `pockets` is
still read fresh from `localStorage` on load, so pockets `creditHYSDeposit()` creates
directly show up with zero additional client-side code.

**Self-caught fix during the live run, not shipped broken:** the funding-confirm buttons'
static HTML still read "Confirm & Open Pocket" after the behavior change — they no longer
open a pocket immediately, they submit a request. Caught by reading the actual modal during
the browser-verify pass (not assumed correct because the JS was right), relabeled "Confirm &
Submit Request" on both buttons before considering the client-side UI phase done. Also
caught and pre-empted, before it ever ran: the inline error-message elements
(`np-crypto-error`/`np-bank-error`) needed their static-validation text set explicitly in
code (not left relying on the HTML's original hardcoded copy), since the same element is now
also used to display a dynamic thrown error from `requestHYSDeposit()` — without this, a
later validation failure would have shown a stale leftover engine error message instead of
the correct "Please select an asset and network" (or bank equivalent) text.

**Admin side (`admin-hys.html`)**, added to `admin-sidebar.js`'s nav (between Deposits and
Allocations — grouping the two money-IN queues together) and a 4th Overview count card
(`admin.html`, grid widened from 3 to 4 columns): pending list shows method, requested
amount, the derived pocket-type/term/rate summary, and the same generic `details` renderer
already proven in `admin-deposits.html` (reused verbatim, not reinvented, since the request
shapes are analogous). Credit modal pre-fills the requested amount, editable, explicitly
labeled "the pocket is created only once you confirm." History shows requested vs. credited
side by side, flagging "(differs)" the same way `admin-deposits.html` already does.

**Proactive audit, done BEFORE writing any UI that could produce an `HYS_DEPOSIT`
transaction, not after finding a bug**: `transactions.html`'s `txnProductName()` (now
returns "HYS Pocket Funding (Crypto/Bank Transfer)"), `txnTypeLabel()` (now returns "HYS
Deposit", not falling through to the generic "Deposit" the original code's `else` branch
would have produced), the Type filter dropdown (new "HYS Deposit" option), badge color
(distinct purple, not `DEPOSIT`'s blue — visually distinguishable at a glance), and the
drill-down modal's footer note (a dedicated `isHysDeposit` branch, not falling through to
"Executed following Portfolio Manager approval of an allocation request" the way it would
have without this). `dashboard.html`'s Recent Activity got the identical treatment — an
`isHysDeposit` branch with its own phrasing and a purple dot, added specifically because the
code comment on the ORIGINAL `DEPOSIT` branch already documented the exact failure mode this
would have hit ("Capital allocated — null") had it been left to fall through unhandled. This
audit was done by reading the actual DEPOSIT-handling code first (not assumed safe), the
same discipline as Admin Tool Phase A's own retroactive fix for `DEPOSIT` — the difference
here being this one happened proactively, before ship, rather than as a follow-up repair.

**Run for real in the browser, the complete flow, not just Node-verified in isolation**:
submitted a Fixed Deposit request (6 months, $6,000, bank transfer, real form data) through
the actual "Open a New Pocket" modal as CLIENT-0001; confirmed it appeared correctly in "My
Pocket Requests" (Pending) and in `admin-hys.html`'s Pending list with every submitted
detail rendered; credited it from the real admin UI at a **different** confirmed amount
($5,900, not the $6,000 requested) — confirmed via `admin-hys.html`'s own History ("$5,900
(differs)") and, more importantly, via the actual created pocket on `high-yield-savings.html`:
funded with $5,900 (not $6,000), maturity "185 days · Feb 21, 2027" (computed from today,
the credit date — not the original request date), and `projectedInterest` of $250.75, hand-
verified against the formula (5900 × 0.085 × 0.5 = 250.75, using the confirmed amount, not
the originally-requested one). HYS Total Balance/Active Pockets/Total Projected Interest
summary cards all updated correctly. Confirmed zero console errors across
`high-yield-savings.html`, `admin-hys.html`, `transactions.html`, and `dashboard.html`
throughout. Confirmed via direct `localStorage` inspection that CLIENT-0002 — still present
from the Multi-Client Data Model phase's own isolation proof — has neither an HYS deposit
requests key nor an HYS pockets key at all under its scoped keys: completely unaffected by
CLIENT-0001's activity, exactly as the task's own browser-verify instruction asked to
confirm.

### 4.48 Request Change redesign — Step 1 of 2: data model (Aug 21, 2026)

**The gap, confirmed by reading the code, not assumed.** Before touching anything, the
current `settings.html` Request Change modal was read in full: it already collects a "New
Value" and a "Reason for Change" from the client — but the submit handler only ever pushed
the FIELD NAME onto `marketswave_settings_pending` (`if (!pendingFields.includes(activeField))
pendingFields.push(activeField)`), discarding both typed values entirely. Worse,
`legalName`/`dateOfBirth`/`address`/`idDocument` turned out to be 100% hardcoded static HTML
(`data-value="John A. Doe"` etc.) with no per-client storage anywhere — so "Approve: applies
the change to that client's actual profile data" was not just unimplemented, it was
*impossible* under the old shape, since there was no requested value AND no storage location
to write into. This confirms the task's own framing exactly.

**New profile storage, not just a new request-log.** For approve to genuinely mean something,
real per-client storage had to exist for the four fields first. Rather than inventing a new
key, the four fields were added to the ALREADY-existing `marketswave_settings_profile` store
(previously email/phone only) — `getSettingsProfile(clientId?)` reads all four with
per-field defaults matching exactly what was previously hardcoded (`{firstName: 'John A.',
lastName: 'Doe'}`, `'1985-03-14'`, the Harborview Lane address, `{documentType: 'Passport',
fileName: null}`), so nothing visibly changes for any existing browser until a real request
is actually approved. **Verified safe against settings.html's existing email/phone code**
(read before adding anything, not assumed): that code loads the whole profile object once,
mutates only the one field being saved, and re-persists the whole object — so it can never
clobber the four new fields, since whatever it loaded already includes them from storage.

**`requestSettingsChange(field, requestedValue, reason)`** snapshots `currentValue`
automatically from `getSettingsProfile()` — never accepted as a parameter — so a client
cannot submit a request claiming a fabricated "before" state. Shallow per-field structural
validation (not full format/format verification — matches this file's existing validation
depth elsewhere) throws for missing required sub-fields (`legalName` needs both
`firstName`/`lastName`, `address` needs at least `street`/`city`, `idDocument` needs
`documentType`). Rejects a second pending request on the same field — settings.html's own UI
already hides the "Request Change" button while one is pending, but this adds the same
engine-level belt-and-suspenders enforcement every other request function in this file
already has.

**Cross-client by design, confirmed with a dedicated test, not assumed correct by
analogy.** Unlike `approveAllocationRequest()`/`approveSellRequest()`/`creditDepositRequest()`
(which all resolve against whichever client is currently active via the reload-to-switch
pattern), `approveSettingsChangeRequest(clientId, requestId)` and
`rejectSettingsChangeRequest(clientId, requestId, resolutionNote)` take an **explicit**
`clientId`. Reasoning: the original nine-item admin-tool batch task described the future
Settings Change admin queue as listing "from every client's... store" with "client" as its
own column — the same cross-client-aggregated shape already established for Documents and
Support in that same task — so approve/reject need to target the specific client who
submitted the request, not whoever the PM's "Viewing Client" selector happens to show.
Node-verified directly: switched the active session to CLIENT-0002, then approved a request
belonging to CLIENT-0001 by explicit id — confirmed CLIENT-0001's profile was updated
correctly and CLIENT-0002's own profile was completely untouched, proving the explicit-id
design actually works under the condition it exists for, not just in the simple case where
the active and target client happen to be the same.

**`resolutionNote` kept deliberately separate from the client's own `reason`** — the client's
`reason` is "why I want this change," the PM's `resolutionNote` (set on reject) is "why I'm
rejecting it." A single shared field would have silently discarded the client's original
context the moment a PM rejected a request. Verified both fields survive independently
after a reject.

**The old `marketswave_settings_pending` key is abandoned, not migrated** — unlike Multi-Client
Data Model Step 2's migration (which moved real, valuable data), there is nothing worth
salvaging from a record that only ever contained bare field names. It becomes a harmless
orphaned key in any existing browser; `settings.html`'s own redesigned code (Step 2 of this
task) will simply stop reading or writing it.

**Node-verified, 38 new assertions**: fresh-install defaults matching the previously-hardcoded
display values exactly; every validation path; the automatic (not caller-supplied) snapshot
behavior, including confirming a SECOND request on the same field snapshots the just-approved
value rather than a stale one (proving the read is live, not cached); duplicate-pending
rejection while a different field remains independently requestable; approve genuinely
writing into the real profile store while leaving unrelated fields untouched; reject leaving
the profile completely unchanged; the full cross-client scenario described above; defensive-
copy reads. Re-ran the complete prior regression suite (182 assertions) alongside this — 220
total, 0 failures, no regressions introduced.

**Not yet built, by explicit instruction**: the cross-client aggregation reader (equivalent
of a future `getAllClientSettingsChangeRequests()`) and the admin UI page itself — both held
until this data model shipped and was Node-verified, per the task's own two-step sequencing.
`settings.html`'s own client-side redesign (Request Change modal UI, display cards reading
from `getSettingsProfile()` instead of hardcoded text) is Step 2, covered next.

### 4.49 Request Change redesign — Step 2 of 2: client-side UI (Aug 21, 2026)

**`settings.html` rewritten to read live, not hardcoded.** The four display rows (Legal
Name, Date of Birth, Address, ID/Document) now render from `getSettingsProfile()` into
`<p id="${field}-display">` on load, instead of static `data-value` HTML — matching what
§4.48 established as the actual source of truth. A "Pending Review" badge (replacing the
"Request Change" button while a pending request exists for that field, per
`getSettingsChangeRequests()`) prevents the duplicate-pending case the engine also rejects
— UI-level and engine-level enforcement both present, same belt-and-suspenders pattern used
elsewhere in this project.

**One modal, four field-specific bodies.** `#change-modal` gained a dynamic title and four
`.change-body[data-body="..."]` sections toggled by field, each shaped to that field's real
structure rather than one generic "current/new" text pair: Legal Name splits into separate
First/Last inputs; Date of Birth uses a native date input; Address has five separate
inputs (street/city/state/zip/country); ID/Document has a document-type text input plus a
real file input (`requestedValue.fileName` stored from `input.files[0].name` — no file
content persisted, matching the fact `localStorage` can't hold binary blobs and nothing in
this project's document-storage engine work does either). The "Current ___" display in
each body reads from the live profile, not the stale value baked in when the page loaded,
so it can't go stale across two requests in one session. Reason stayed optional per the
task's own instruction, not skipped.

**Errors from `requestSettingsChange()` surface verbatim inline** in the modal, not as a
toast — consistent with the modal staying open on failure so the client doesn't lose typed
input, the same reasoning already applied to Deploy Capital's request flows.

**Browser-verified live, all four fields, not just Node-verified in isolation**: Legal Name
(submit → Pending Review badge → simulated PM approval via `approveSettingsChangeRequest()`
console call, since the admin UI doesn't exist yet by design → reload → the approved name
genuinely displays, badge clears, "Request Change" becomes available again); Date of Birth
(deliberately submitted with the date field empty first, confirmed the engine's thrown
validation error surfaced inline, then resubmitted validly); Address (all five inputs
present and correctly labeled, current address displays as the full formatted string);
ID/Document (Current Document Type showed "Passport" correctly, New Document Type + a real
uploaded test file both submitted successfully, Pending Review badge appeared). Final
`getSettingsChangeRequests()` console read confirmed all three submitted records
(`SETTING-0001` approved, `SETTING-0002`/`SETTING-0003` pending) with exactly the field
shapes §4.48 specified, including `idDocument.requestedValue.fileName` populated from the
real uploaded file's name. Zero application console errors throughout — only the same
recurring browser-extension messaging noise seen on every page this entire session.

**Not yet built, unchanged from §4.48**: the cross-client aggregation reader and
`admin-settings-changes.html` itself, both still held pending explicit go-ahead now that
the data model AND client UI are both live and verified.

### 4.50 Documents + Support admin queues (Aug 21, 2026)

**Two of the original three-queue batch, the Settings Change queue held per instruction.**
This picks up the "Documents, Settings Changes, Support/Disputes" batch first speced
earlier in the session (research done, build interrupted by a usage-limit checkpoint, then
explicitly resequenced behind the Request Change redesign). With that redesign now
complete, the task was to build Documents and Support "as originally speced, since neither
has a reported data gap," while continuing to hold the Settings Change admin queue.

**Documents — read the real code before designing, same discipline as every prior phase.**
`documents.html`'s row-rendering logic (`docRowHTML()`) was read in full before writing
`publishDocumentToClient()`, specifically to confirm the exact document shape a "from"
document needs (`direction: 'from'`, `status` drives the Signature Required/Signed badges,
`deadlineLabel` drives the red due-date badge, `isNew` drives the blue New badge) — the new
function reproduces this shape exactly rather than guessing at it, so a document it creates
renders correctly on the very first row-render, no follow-up fix needed. `getAllClientDocuments()`
and `updateDocumentForClient()` mirror the explicit-`clientId` pattern already established
for Settings Change requests (§4.48) — Documents is cross-client-aggregated by the task's
own design, unlike Deposits/Allocations/Sells/HYS, which resolve against whichever client
the admin "Viewing Client" selector currently shows.

**"Mark Reviewed" as the one PM action on uploads**, per the task's own instruction to keep
the action set simple (uploads aren't approval requests, just documents to receive). A new
status value, `'Reviewed'`, was chosen deliberately: `documents.html`'s existing upload-row
rendering (`doc.status === 'Under Review' ? amber : slate`, else falls through to
`doc.status || 'Received'`) already renders any other status string safely as slate-colored
text with no code change needed on that page — confirmed by reading the rendering code
first, not assumed safe.

**`publishDocumentToClient()`'s `dueDate` → `deadlineLabel` conversion** reproduces the
exact `'Due in N days'` format `documents.html`'s own seed data already uses, computed
relative to today (not the eventual read time) so a document published with a due date
stays accurate no matter when a client later loads the page.

**Support — an admin-only addition, not a full migration, and said so explicitly in the
code comment.** `marketswave_support_requests` stays owned by `support.html` (unchanged,
still reads/writes only its own scoped key) — this was a deliberate scope decision already
flagged in CLAUDE.md when the notification bell was built (§4.37), and this phase respects
it rather than silently reversing it. `getAllClientSupportRequests()`/
`updateSupportRequestForClient()` are two new functions that read/write the *same* raw key
for an arbitrary client, purely so the new admin queue has real cross-client aggregation and
Node-testability — they don't change where or how `support.html` itself stores its own
client's data. A genuine edge case this uncovered and handled correctly: a client who has
never loaded `support.html` in a given browser has no `marketswave_support_requests:<id>`
key at all yet (that page seeds it lazily on first load) — `getAllClientSupportRequests()`
treats a missing key as an empty list rather than crashing, confirmed by a dedicated test
that starts from a completely fresh `CLIENT-0001` with no support store at all.

**New `pmNote` field, deliberately separate from the client's own `description`** — same
reasoning already established for Settings Change's `resolutionNote` vs. `reason` (§4.48):
conflating the client's account of the issue with the PM's response would silently discard
one or the other. `support.html` gained a "Portfolio Manager Response" block in its
request-detail expansion, rendered only when `pmNote` is present, so existing requests with
no PM response yet show no visual change.

**Admin UI, both pages mirror the proven pending/PM-action/history shape**, adapted to each
domain: `admin-documents.html` has three sections (Client Uploads Awaiting Review, Publish
to Client, and a combined History of every published-or-reviewed document across every
client) instead of a binary pending/resolved queue, since Documents doesn't have a single
request/approve concept spanning the whole domain. `admin-support.html` renamed
"Pending"/"History" to "Needs Attention" (status Open or In Progress) and "Resolved" to
match the 3-state ticket model the task asked to reuse, rather than forcing the
request/approve binary onto a domain that doesn't have one. Both wired into
`admin-sidebar.js`'s nav (between Sells and Settings) and two new Overview pending-count
cards — the grid widened from 4 to 6 cards (`xl:grid-cols-3`, two rows), with Documents'
and Support's counts computed the same cross-client way the pages themselves do (not
filtered by the "Viewing Client" selector, unlike the other four cards).

**Node-verified before any browser check, per instruction**: 34 new assertions covering
aggregation shape and client tagging, `publishDocumentToClient()`'s validation and
`deadlineLabel` math (including the "due today" boundary), per-client-independent
sequential doc ids, the missing-support-key case above, cross-client isolation for both
domains (an update/publish targeting one client provably doesn't touch another's data, and
is confirmed to persist under the *exact* key `support.html`/`documents.html` themselves
would read), unknown-id error handling, and defensive-copy reads — plus the full prior
220-assertion regression suite, 254 total, 0 failures.

**Browser-verified end to end, using the existing CLIENT-0001/CLIENT-0002 browser state
from the Multi-Client Data Model phase**: marked a real `Received` upload ("Proof of
Address.pdf") "Reviewed" from `admin-documents.html` — confirmed it left the pending list
and appeared correctly in History. Published a Signature Required document with a 9-day-out
due date to CLIENT-0002 through the real Publish to Client form — since client-facing pages
in this build always resolve to `CLIENT-0001` regardless of the admin's "Viewing Client"
selection (the same Step 4 design fix from §4.45, which deliberately prevents exactly this
kind of cross-tab leak), the isolation check was run via direct `localStorage` inspection of
CLIENT-0002's real scoped key rather than by trying to load `documents.html` "as" CLIENT-0002
— confirmed the stored record has the exact right shape (`id: "DOC-0001"`, `direction:
"from"`, `status: "Signature Required"`, `deadlineLabel: "Due in 9 days"`) and that
CLIENT-0001's own document count stayed at exactly 8, unaffected. Resolved a real support
ticket (`TCK-9001`) from `admin-support.html` with a PM note, then navigated to the client's
own `support.html` and confirmed the exact note text renders in a new "Portfolio Manager
Response" block, and the status badge shows "Resolved". Zero console errors on any page
throughout (only the same recurring browser-extension messaging noise seen all session).

**Not yet built, by explicit instruction, unchanged**: the Settings Change admin queue
(`admin-settings-changes.html`) and its cross-client aggregation reader remain held.

### 4.51 Settings Change admin queue — closes out the three-queue batch (Aug 21, 2026)

**The one piece deliberately held since the Request Change redesign (§4.48) is now built.**
`approveSettingsChangeRequest(clientId, requestId)`/`rejectSettingsChangeRequest(clientId,
requestId, resolutionNote)` already took an explicit `clientId` from the moment they were
first written — the redesign anticipated this exact admin queue and built the resolve
functions to support it from day one. The only genuinely missing piece was a cross-client
*listing* reader, `getAllClientSettingsChangeRequests()`, which mirrors
`getAllClientDocuments()`/`getAllClientSupportRequests()` (§4.50) exactly: iterate every
client, read their own `marketswave_settings_change_requests` scoped key directly, tag each
record with `clientId`/`clientName`.

**Reused `settings.html`'s own field-specific display logic, per the task's instruction, not
a generic diff view.** `formatDateDisplay()`/`formatFieldDisplay()` were copied verbatim
into `admin-settings-changes.html`'s own script — this project has no shared module system
for plain display-formatting helpers (only stateful logic gets shared, via `engine-core.js`/
`dashboard-sidebar.js`/`admin-sidebar.js`/etc., each loaded as its own `<script>` tag), so a
literal shared import wasn't available. The two copies are intentionally byte-identical so
the admin queue shows a Legal Name, Date of Birth, Address, or ID/Document request in
*exactly* the same format the client themselves would see, rather than a generic
"before/after JSON" view — logged as minor structural debt (display-only, not a money or
security figure, so lower-risk than the standing HYS rate-duplication debt) rather than
silently left undocumented.

**A real finding from Node verification, not a hypothetical one: request ids are per-client,
not global.** `nextSequentialId()` scans only the array it's given — since each client's
settings-change-request store is its own separate array, CLIENT-0001's first request and
CLIENT-0002's first request can both legitimately be `SETTING-0001`. The first draft of the
Node test looked up a request by `id` alone across the cross-client aggregate and silently
matched the wrong client's record — caught immediately by an assertion failure, not shipped.
Fixed by keying the lookup on `(clientId, field)` instead, and left a comment in the test
file explaining why, as a reusable lesson: any UI or test code operating on the cross-client
aggregate must always carry both `clientId` and `id` together, never `id` alone. Checked the
actual UI code against this risk before considering it safe — every Approve/Reject button in
`admin-settings-changes.html` already carries `data-client` alongside `data-id` (matching the
same pattern already used in `admin-documents.html`/`admin-support.html`), and the underlying
engine functions require an explicit `clientId` argument, so this was never actually
exploitable through the real page; it only tripped up the test written to verify it.

**Approve modal shows a Current → Requested confirmation before applying** — unlike
Documents' "Mark Reviewed" (a low-stakes acknowledgment) or the plain-approve buttons on
Allocations/Sells (money movement, not identity data), a settings change touches a client's
actual legal identity fields, which felt at least as sensitive as the confirmation step
already used for Allocations/Sells — so the same custom-modal confirm pattern was applied
here too rather than a bare click-to-approve.

**Node-verified, 24 new assertions**: the empty case (no requests, no error); cross-client
tagging correctness; all four field shapes (`legalName`'s `{firstName, lastName}`,
`dateOfBirth`'s plain string, `address`'s five sub-fields, `idDocument`'s
`{documentType, fileName}`) each applying correctly to the *correct* client's profile on
approve, confirmed via direct `getSettingsProfile(clientId)` reads for both clients;
rejecting a request touching only `status`/`resolvedAt`/`resolutionNote` and leaving the
profile completely unchanged; a double-approve correctly throwing; defensive-copy reads. Plus
the full prior 254-assertion regression suite, 278 total, 0 failures.

**Browser-verified end to end exactly as asked**: submitted a Legal Name change request as
the client ("Jonathan Doe" → "Jonathan Whitmore-Doe", with a reason), approved it from
`admin-settings-changes.html` — the confirmation modal correctly showed "Current: Jonathan
Doe" / "Requested: Jonathan Whitmore-Doe" before applying — then reloaded `settings.html` and
confirmed Legal Name now genuinely reads "Jonathan Whitmore-Doe" as the real, persisted
current value (not merely the request disappearing from Pending), with the "Pending Review"
badge cleared and "Request Change" available again. Zero console errors on either page
throughout. The three-queue admin batch (Documents, Support, Settings Changes) originally
speced together is now fully complete.

### 4.52 Rename to "Client Profile Updates" + Date of Birth removal + client-selector perf report (Aug 21, 2026)

**Three small, distinct requests handled together**: a display rename, a field removal with
an explicit "don't silently delete existing data" constraint, and a diagnostic report ahead
of a future selector redesign. None of the three touched the others' code paths.

**Rename, scoped deliberately narrow.** "Settings Change"/"Settings Changes" became "Client
Profile Updates" everywhere a human reads it — the page `<title>`, its `<h2>`, the sidebar
nav label, and the Overview card label. Everything a human doesn't read stayed exactly as it
was: the file is still `admin-settings-changes.html`, the nav item's `key` is still
`'settings-changes'`, and every `engine-core.js` identifier (`getSettingsChangeRequests()`,
`approveSettingsChangeRequest()`, the `marketswave_settings_change_requests` store name,
etc.) is untouched. The task's own wording — "the queue/nav label" — was read as scoping
this to display text, not a full rename of the underlying feature's identifiers, which would
have been a much larger, riskier change than what was actually asked for.

**Date of Birth removal — found the existing record first, before touching anything.**
Before any code change, the live browser's actual `marketswave_settings_change_requests`
data was queried directly: exactly one dateOfBirth record existed, `SETTING-0002` on
`CLIENT-0001`, still `pending`, `currentValue: "1985-03-14"` → `requestedValue:
"1985-03-20"` — created during this same session's own earlier Request Change UI testing
(§4.49). Reported here rather than silently dropped, per instruction. It was **not**
deleted, migrated, or altered in any way.

**The removal itself, three places, matching the task's own three-place framing.**
`engine-core.js`: `dateOfBirth` dropped from `REQUESTABLE_SETTINGS_FIELDS` (so
`requestSettingsChange('dateOfBirth', ...)` now throws `'field must be one of: legalName,
address, idDocument.'` immediately, before ever reaching `validateSettingsFieldValue()`),
from `REQUESTABLE_SETTINGS_DEFAULTS`, and its now-dead validation branch removed.
`settings.html`: the entire Date of Birth display row, its `.change-body` modal section, its
`FIELDS`-array membership, its `buildRequestedValue()`/`clearNewValueInputs()` branches, and
the now-unused `formatDateDisplay()` helper — all removed, not just hidden behind a
conditional. `admin-settings-changes.html`: deliberately **not** stripped the same way —
its `FIELD_LABELS` and `formatFieldDisplay()` both keep their `dateOfBirth` branches, so the
one legacy record (and any other that might exist) renders as "Date of Birth" with correctly
formatted dates instead of "undefined" or a crash. This is the direct, considered answer to
the task's "report what you find rather than silently deleting" instruction: the data stays,
and the one surface that still needs to display it correctly still can.

**Why the legacy record still resolves correctly, confirmed not assumed.**
`approveSettingsChangeRequest()`/`rejectSettingsChangeRequest()` never re-validate a
request's stored `field` against `REQUESTABLE_SETTINGS_FIELDS` — they only look the request
up by `(clientId, id)` and apply `requestedValue` to `profile[request.field]` unconditionally.
This means `SETTING-0002` (and the manually-seeded legacy record used in the updated Node
test) remains fully approvable/rejectable through the real `admin-settings-changes.html` UI
even though the field itself is no longer requestable going forward — confirmed with a
dedicated Node assertion, not assumed from reading the code alone. If it were ever approved,
the resulting `dateOfBirth` key would land in the raw `marketswave_settings_profile` store
but never surface through `getSettingsProfile()` again (since that function only iterates
`REQUESTABLE_SETTINGS_FIELDS`) — a harmless orphaned key, also confirmed directly against
raw storage in the updated test, not left as an untested assumption.

**Two existing Node test files needed updating, not just re-running.** Both
`verify-settings-change-queue.js` (row 35) and `verify-settings-change-admin-queue.js`
(row 37) had exercised `dateOfBirth` as a normal requestable field before this change —
running them unmodified crashed with the new, correct `'field must be one of...'` error
(confirmed by running them first, not assumed). Fixed by: swapping `dateOfBirth`'s old
"a different field is still requestable" role over to `address` in the Step-1 test; adding
an explicit `assertThrows` confirming `dateOfBirth` is now rejected in both files; and, in
the admin-queue test, replacing the old `requestSettingsChange('dateOfBirth', ...)` call
with a manually-seeded legacy record (mirroring the real `SETTING-0002` scenario exactly)
to prove the "still resolvable" behavior the task cares about, rather than just deleting the
coverage. Full suite: 282 total assertions across all 9 harness files, 0 failures.

**Browser-verified**: `settings.html` reloaded shows only Legal Name/Address/ID-Document —
no Date of Birth row, no console errors. `admin-settings-changes.html` reloaded still shows
`SETTING-0002` in Pending, correctly labeled "Date of Birth," correctly formatted ("March 14,
1985" → "March 20, 1985") — left unresolved deliberately, as the requested example, not
approved or rejected as part of this task.

**Client selector — investigated and reported, no redesign work done yet.** Current
implementation: `admin-sidebar.js`'s `clientSelectorHTML()` calls `getAllClients()`, builds
one `<option>` string per client via `.map().join('')`, and injects the whole thing into a
plain native `<select id="admin-client-selector">` with a single `.innerHTML` write, once per
page load (part of the same string that builds the rest of the sidebar). No client-side
search, filtering, or virtualization — a client is found by scrolling/typing into the native
dropdown, same as any HTML `<select>`.

**Measured, not estimated.** 50 test clients were added via `addClient()` in a loop directly
in the live browser (not simulated in Node, since this needed to observe the real
`admin.html` render): the loop itself took 22.7ms total (~0.45ms per client, dominated by
`localStorage.setItem()` calls, not the selector). Reloading `admin.html` afterward rendered
all 52 real `<option>` elements correctly and in order (confirmed via the accessibility
tree — every "Perf Test Client N (CLIENT-00XX)" label present and correctly ordered), and
reading `.options.length` off the live DOM took 0.1ms. **No measurable slowdown at 50
clients** — this is a forward-looking design concern for whatever scale comes later
(hundreds to thousands of clients, or a UX need to search/filter rather than scroll a flat
list), not a problem that exists today. The `location.reload()` cost every client-switch
already pays (the "reload-to-switch" architecture, §4.43) is a flat cost unrelated to how
many `<option>` elements exist, so it doesn't compound with client count either. All 50 test
clients and their 350 seeded scoped `localStorage` keys were removed immediately after
measuring, restoring the browser to its real `CLIENT-0001`/`CLIENT-0002` baseline —
confirmed via a fresh `admin.html` reload showing the original 2-client dropdown and
unchanged pending counts.

### 4.53 Admin nav grouping — Approval Gate / User-Admin Relations / Portfolio Administration (Aug 21, 2026)

**Data-driven grouping, not visual-only re-ordering.** The task's own framing — "this
categorization is meant to hold for future admin tools too... structure the data with an
explicit group field per item, not just visual ordering" — was taken literally: each
`NAV_ITEMS` entry in `admin-sidebar.js` gained a `group` field (`'approval-gate'`,
`'user-admin-relations'`, `'portfolio-administration'`, or `null` for Overview), and a new
`GROUPS` array became the single source of truth for which three groups exist, their display
labels, and the order they render in. Adding a future tool — the task named Product Catalog
management as the concrete example, landing under `'portfolio-administration'` — means adding
one `NAV_ITEMS` entry with a `group` already defined in `GROUPS`, not touching any rendering
logic or manually re-inserting a section boundary. A future login gate was explicitly called
out as infrastructure, not a nav item, and correctly gets no entry in either array at all.

**Rendering: `navHTML()` replaces the old flat `NAV_ITEMS.map()`.** Overview renders first,
ungrouped (its `group: null` is what keeps it out of all three sections, exactly as
specified — "outside all three groups, at the top, as the landing page"). Each `GROUPS` entry
then renders as its own section: a visible uppercase label header
(`text-[11px] font-semibold uppercase tracking-wide text-white/40` — reusing the exact visual
language the "Viewing Client" label already established, so it reads as consistent with the
existing sidebar rather than a new pattern) followed by that group's `NAV_ITEMS` in their
array order. A defensive branch skips rendering a group's header/section entirely if it has
zero members — not currently exercised (every one of the three groups has at least one item
today), but a real behavior a future edit could trigger, and "no header for an empty section"
is a more honest default than "always show a header, sometimes over nothing."

**Item order and membership matched the task's exact categorization**, reordering
`NAV_ITEMS` itself (not just adding group tags to the prior order) so the array reads
top-to-bottom exactly as specified: Deposits, Allocations, Sells, HYS Deposits, Client
Profile Updates under Approval Gate; Documents, Support under User/Admin Relations; Settings
alone under Portfolio Administration. The "HYS Deposits" nav label itself was deliberately
left unchanged (the task's own categorization text said "High Yield Savings," which read as
describing which item was meant, not instructing a label rename — an out-of-scope change
this task didn't ask for, unlike the prior session's explicit "Settings Change" →
"Client Profile Updates" rename request).

**Overview's card grid mirrors the same three groups, with one necessary adaptation.**
`admin.html`'s flat 7-card grid was split into three headed sections using the identical
labels/order/membership as the nav. Settings has no pending-count concept at all — it's a
configuration page, not a request queue — so forcing it into a "Pending X" card would have
been dishonest. Instead its Portfolio Administration card shows the live current advisory
fee rate (read via the same `getAccountState().advisoryFeeRate` call `admin-settings.html`
itself uses), so all three group headers stay visible on Overview at a glance — matching the
nav's own "always show three headers" behavior — while the one non-queue item inside the
third group is honestly shaped differently from the other six queue-count cards rather than
faking a number that doesn't exist.

**No `engine-core.js` changes** — this was a pure `admin-sidebar.js`/`admin.html`
reorganization. Confirmed via the full existing 282-assertion regression suite still passing
unchanged (none of it touches admin nav rendering, but re-running it after any change
remains the discipline established for every phase this session).

**Browser-verified against every point the task asked for**: all three group headers render
with the exact requested labels and correct item membership on every admin page (confirmed
on `admin.html` and spot-checked on `admin-deposits.html`/`admin-settings.html`); every nav
link's `href` still resolves correctly and active-page highlighting still works correctly
within its group (confirmed directly via the accessibility tree, not just visually);
`admin-deposits.html`'s own Pending/History content and `admin-settings.html`'s own Advisory
Fee Rate form are both completely unchanged — confirming nothing about the queue pages
themselves was touched, only the shared sidebar and Overview that link to them; Overview's
card sections render grouped with matching labels/order, and the Advisory Fee Rate card
shows the same live 1.25% value `admin-settings.html` itself displays. Zero console errors
throughout.

### 4.54 Download client-uploaded documents (admin) (Aug 21, 2026)

**Matched an existing precedent rather than inventing a new one.** `documents.html`'s own
"From Marketswave" documents already had a "Download" button before this change — read
first, and confirmed it was already a stub (a toast, no real file transfer), since this
project has never stored real file bytes anywhere, only the filename a client typed or
selected at upload time. Rather than silently leaving the PM's side of the same gap
un-actioned, `admin-documents.html` got the identical control on every client-uploaded
document row: in "Client Uploads Awaiting Review" (next to "Mark Reviewed") and as a new
action column in History, shown only for `direction === 'upload'` rows — "From Marketswave"
rows correctly show nothing there, since the PM already has whatever it itself published.

**Adding a 7th table column pushed History past its card's width** at the normal desktop
viewport this session tests at, discovered live during verification, not assumed safe.
Fixed by wrapping `#history-list` in `overflow-x-auto`, scoped to this one file — every other
admin queue page's History table shares the same unwrapped-div pattern, but none of them was
independently widened by this change, so they were left alone rather than "fixed" as an
unrelated drive-by.

**Browser-verified**: Download fires the correct "Download Started — &lt;filename&gt; is
downloading." toast with the correct filename from both the pending list and History; "Mark
Reviewed" still works unaffected (the two buttons share one delegated click handler on the
pending list, confirmed not to interfere with each other); the table now scrolls within its
own card instead of pushing the page wider; zero console errors throughout.

### 4.55 Client Management page — Viewing Client moved out of the sidebar (Aug 21, 2026)

**What moved and why.** The "Viewing Client" `<select>` had lived embedded in every admin
page's shared sidebar since the Multi-Client Data Model phase (§4.44) — functional, but a
control with no room to grow: no way to see a client's real balance before switching to
them, no way to add a new client without the console. Per instruction, it moved into a
dedicated page, `admin-clients.html`, reached via a new "Viewing Client" nav item positioned
directly under Overview — both carry `group: null`, the same "outside all three functional
groups, at the top" treatment already established for Overview itself in §4.53's grouping
work, rather than belonging to Approval Gate/User-Admin Relations/Portfolio Administration.
The sidebar itself keeps a small trace of the old control: a read-only "Viewing Client"
indicator (the active client's name and id) that links through to the new page instead of
switching in place — context stays visible everywhere without the switching mechanism
needing to live everywhere too.

**Two engine functions gained an optional `clientId`, not two new functions.**
`getAccountState(clientId?)` and `getTotalPortfolioValue(clientId?)` were extended rather
than duplicated, mirroring `getSettingsProfile(clientId?)`'s exact existing shape: called
with no argument, both behave identically to before (the currently active client's
in-memory state — confirmed unchanged, not just assumed, via a dedicated Node assertion) so
every existing caller across the codebase needed zero changes; called with an explicit id,
both read that client's own scoped storage key directly and on demand, live each call (not
cached from a first read), without ever touching `setCurrentClientId()` or disturbing the
active session — the same "arbitrary client, on demand" discipline
`getAllClientDocuments()`/`getAllClientSupportRequests()`/`getAllClientSettingsChangeRequests()`
already established for their own domains, now extended to the core Account State store
those functions didn't touch. A nonexistent clientId returns `null`/`0` rather than
throwing, confirmed directly rather than left as an assumption.

**A real, previously-tracked gap closed in the same pass.** `addClient()` had been
console-only since it was built (Multi-Client Data Model, §4.42-§4.45) — explicitly flagged
as outstanding in Backend Requirements Register row 32's own writeup. `admin-clients.html`'s
"Add Client" form (Name, Email, Phone, Account Type, Starting Unallocated Capital) is the
first real UI to call it, using the exact same field shape the function already expected —
no engine changes needed for this half of the page.

**Node-verified first, 13 new assertions**: unchanged no-arg behavior for both functions;
an explicit-id read of the already-active client matching the no-arg read exactly; an
explicit-id read of a *different* client returning that client's own real seeded balance
without ever changing `getCurrentClientId()`'s return value; a live (not cached) read
reflecting a change written directly to the target client's raw storage after the first
read; graceful `null`/`0` for an unknown client; and, after a genuine active-client
switch+reload, confirming explicit-id reads of the *other* client still stay correctly
isolated. Plus the full 282-assertion prior regression suite, 295 total, 0 failures.

**Browser-verified end to end**: the sidebar's new read-only indicator and the "Viewing
Client" nav tab both render correctly on `admin.html` and `admin-settings.html`, positioned
exactly where specified (directly under Overview, outside the three groups); the Clients
list showed John Doe's and Jane Newclient's real balances, matching known figures from
earlier phases exactly ($153,520 / $1,127,499 / $1,281,019 total for John Doe; $3,000 /
$0 / $3,000 for Jane); clicking "View as this Client" for Jane genuinely switched the
active client — confirmed via the sidebar indicator updating to her name and the "Currently
Viewing" badge moving to her row, the same reload-to-switch mechanism the old dropdown
always used, unchanged; the Add Client form created a real third client ("Marcus Reid,"
$25,000 starting capital) that appeared correctly in the list with the right balance and a
working "View as this Client" button of its own. That test client and its 7 seeded scoped
keys were removed immediately after verifying, and the active client switched back to
`CLIENT-0001`, restoring the browser to its real baseline — confirmed via a fresh reload of
`admin.html` showing unchanged pending counts. Zero console errors throughout.

### 4.56 Client Management page — redesign: search, filter, expand-in-place (Aug 21, 2026)

**A structural redesign of the page built the same day (§4.55), per an exact spec.** The
task gave a specific 5-part layout, followed literally: header row (search + a small
outlined "+ Add Client" button, not a permanent form section), single-select filter pills,
a 4-column table, in-place row expansion, and a visually distinct nav icon. Each is covered
below in the order it was asked for.

**Search + Add Client button.** The always-visible "Add Client" card was replaced with a
small outlined button that opens the same form as a modal — same fields, same validation,
same `addClient()` call, just relocated and no longer permanently taking up page space. The
search input filters live, on every keystroke (`input` event, not a submit), matching
either the client's name or id, case-insensitively, as a substring — not an exact match, so
"0003" finds `CLIENT-0003` and "jan" finds "Janet Winters" without needing the full name.

**Filter pills required a real data-shape decision, not just a UI one.** The task named four
categories — All/Individual/Joint/Business — but the existing Add Client form's Account Type
field was free text, defaulting to "Individual Account" with nothing stopping a PM from
typing anything else. Filter pills need well-defined values to match against, so Account
Type became a 3-option `<select>` (Individual/Joint/Business Account) as part of this same
change — a necessary, in-scope adjustment to make the requested filter actually work, not
scope creep. Both existing real clients already had `accountType: 'Individual Account'`
(set before this redesign existed), so nothing needed migrating. Pills are styled as a
segmented control — active pill solid `bg-slate-900 text-white`, inactive pills a light
neutral `bg-slate-100 text-slate-600` — deliberately drawing on the same pill/badge visual
language already used throughout the admin tool (status badges, type badges) rather than
inventing a new control style.

**The table's 4th column is genuinely new data, not a relabel.** Portfolio Value is computed
per client via `getTotalPortfolioValue(clientId)` — the optional-clientId version added
in §4.55's own work, called once per visible row. Type renders as a colored badge (Individual
= neutral slate, Joint = blue, Business = purple — reusing color assignments already
established elsewhere in this project, e.g. blue for HYS-related badges) rather than plain
text, matching the "Type (badge)" instruction literally.

**Row expansion is real in-place UI state, not a page or a modal.** A plain JS object
(`expandedIds`) tracks which client rows are open; clicking a row's own area (not the
"View as this Client" button, which lives inside the expanded content and is excluded from
the toggle via `e.target.closest('.view-btn')` short-circuiting first) flips that client's
entry and re-renders. Multiple rows can be expanded simultaneously — nothing in the task
asked for single-expand-only, and allowing several open at once cost nothing extra to
support. The expanded area shows email, `createdAt` formatted as "Client Since," a live
pending-items count, and — only for a client that ISN'T the one currently active —
"View as this Client." This is the one real behavior change from §4.55's version: that page
had "View as this Client" as an always-visible button on every non-active row; here it only
exists once a PM has actually opened that row's detail, per the task's own explicit
instruction to relocate it.

**`getClientPendingApprovalCount(clientId)` — one new function, scoped exactly to the 5
named queues.** Built by reading each of Deposits/Allocations/Sells/HYS
Deposits/Client Profile Updates' own raw scoped storage key directly for the target client
and counting `status === 'pending'` entries, summed. This deliberately mirrors
`admin-sidebar.js`'s own `'approval-gate'` nav group membership (§4.53) exactly — the same 5
items, in the same conceptual grouping — rather than being a separately-invented list that
could drift from what the sidebar itself calls "Approval Gate." Documents and Support were
deliberately left out, since they belong to the sidebar's `'user-admin-relations'` group,
not this one.

**Node-verified in two genuinely separate passes, matching the task's own two-part
instruction.** `getClientPendingApprovalCount()`: 12 assertions, including a freshly-seeded
client with literally zero requests in any queue correctly returning `0` rather than
throwing (the task's own explicitly-named edge case) — confirmed by testing the empty case
*before* adding any requests, not just inferring it from the code. Adding one pending item
to each of the 5 queues one at a time and re-checking the running total after each addition
confirmed the sum tracks exactly, not just that the final total happens to be right; approve
and reject were both confirmed to correctly drop a request out of the count, not just leave
it stale. Search/filter: 14 assertions against a small 5-client test set spanning all three
account types plus name collisions designed to stress the AND-logic requirement — "jan" +
Business correctly returns only "Janet Winters," not "Jane Newclient" too, proving the two
filters combine with AND, not OR. Plus the full 295-assertion prior regression suite, 321
total, 0 failures.

**Nav icon — verified as a real, not assumed, visual distinction.** The icon used for
"Viewing Client" in §4.55 (a two-person "group" icon) was swapped for a single-person "user"
icon specifically because the task named this as an explicit requirement — read as a signal
that the two icons may have still looked too similar in practice, not merely a formality to
satisfy. Confirmed visually in the browser at the actual sidebar render size (a house
silhouette vs. a person silhouette), not just by comparing SVG path strings.

**Browser-verified against every point in the task's own instruction**: live search
(typed "jane" via real keystrokes, not a value-only injection, to genuinely exercise the
`input` event — narrowed correctly to "Jane Newclient"); filter pills (Business correctly
showed an empty state against the pre-existing 2-Individual-client baseline, then correctly
found "Acme Holdings LLC" once created); expand/collapse (both rows opened simultaneously,
each showing its own correct data); pending counts (CLIENT-0001 showed 5, hand-verified
against Overview's own cards — 2+1+2+0+0 — not just trusted; CLIENT-0002 showed a real 0);
"View as this Client" (switched correctly from inside the expanded row, confirmed via the
sidebar indicator and a real reload); the nav icon (visually distinct from Overview's, per
screenshot). The one test client created during verification ("Acme Holdings LLC") was
removed immediately afterward, restoring the browser to its real 2-client baseline. Zero
console errors throughout.

### 4.57 Admin sidebar — Client Management label collision + indicator separator (Aug 21, 2026)

**A real, reported UX problem, not a hypothetical one.** With the nav item and the
persistent indicator both saying "Viewing Client" (one as its label, one as its own
"VIEWING CLIENT" heading directly above it), the two read as the same thing rendered twice
— even though they're functionally distinct: the indicator is a passive display of who's
currently active, the nav item leads to the actual client list/search/filter/switch page.
Renamed the nav item to "Client Management," which also more accurately names what that
page does post-redesign (§4.56) than "Viewing Client" ever did — switching was only ever
one part of it.

**Only the label changed — `key`/`href` stayed identical**, so active-state highlighting
(which matches on `key`, not `label`) and routing needed no code changes at all — confirmed
by clicking through rather than assumed safe from reading the diff alone.

**The indicator gained an actual visual boundary.** It previously had only bottom padding
(`pb-2`) separating it from the nav list below — no border, no distinct background, nothing
stopping it from reading as the first item in the list rather than a separate persistent
element above it. Added `border-b border-white/10` plus `mb-2`.

**Browser-verified**: "Client Management" correctly navigates to `admin-clients.html` and
highlights as active there; spot-checked on `admin-deposits.html`, confirming "Deposits"
still highlights correctly while "Client Management" reads as its own distinct, unhighlighted
nav item beneath a now-clearly-bordered indicator block. Zero console errors on either page.

### 4.58 Admin sidebar — removed the persistent "Viewing Client" indicator (Aug 21, 2026)

**A deliberate simplification, not a bug fix — §4.57's separator fix was made obsolete the
same day by removing the thing it was separating.** Client Management is now the sole place
a PM sees or changes which client is active; the sidebar no longer surfaces that state
ambiently on every page. Removed `clientIndicatorHTML()` in full (markup, styling, and its
`getClient(getCurrentClientId())` lookup) and its call site in `initAdminSidebar()`.
`setCurrentClientId()`/`getCurrentClientId()` in `engine-core.js`, and the real switching
mechanism on `admin-clients.html`, were explicitly left untouched per instruction — this was
a display-only removal.

**Checked for orphaned code rather than assuming a clean removal.** `getClient` was called
nowhere else in `admin-sidebar.js` once the indicator function was gone, so nothing needed
cleaning up there (it remains exported by `engine-core.js`, still used elsewhere). A
project-wide grep for `clientIndicatorHTML`, the old `admin-client-selector` id, and the
"VIEWING CLIENT" text turned up nothing outside this file's own now-historical explanatory
comments. A short comment documents why the block is gone and confirms the switching logic
itself wasn't touched — consistent with this session's own established practice of leaving a
trace for removals rather than a silent gap, without leaving actual dead code behind.

**Browser-verified on 3 different admin pages** (`admin.html`, `admin-clients.html`,
`admin-support.html`): no gap or leftover empty space where the indicator used to sit — the
nav list now begins directly below the header on every page, consistently. "View as this
Client" was re-tested directly via `getCurrentClientId()` before and after clicking (not
just visually), confirming the actual switch still works exactly as before. Zero console
errors throughout.

### 4.59 Admin sidebar — Dashboard group, Client List rename, subtle indicator re-added (Aug 21, 2026)

**Overview and Client List became real group members, not a special case.** Adding
`{ id: 'dashboard', label: 'Dashboard' }` as the first `GROUPS` entry and switching both
items' `group` field from `null` to `'dashboard'` was enough on its own — `navHTML()`'s
existing `GROUPS.map()` loop already builds a labeled header + item list for whatever's in
each group, so Dashboard needed zero new rendering code, exactly as asked. The one cleanup
this enabled: the old `ungrouped`/`!item.group` filtering branch in `navHTML()` had nothing
left to match once every `NAV_ITEMS` entry carried a real group, so it was removed rather
than kept as dead code that would never execute.

**"Client List" is the third label this nav item has had in one calendar day** —
"Viewing Client" (original), "Client Management" (§4.57, to stop colliding with the
now-removed indicator), "Client List" (here, because "Management" implied more than a
searchable, expandable list now that it sits in a group literally titled "Dashboard" next to
Overview). Each transition is tracked in an inline comment rather than silently overwritten,
so the reasoning survives even though the text doesn't. Propagated to
`admin-clients.html`'s own `<title>`/`<h2>` and a stale reference in an `admin.html` code
comment; Overview's pending-count cards were checked and confirmed to have never referenced
either old name.

**The re-added indicator is deliberately not a smaller version of the old block — it's a
different kind of element.** The one removed in §4.58 had its own uppercase heading, a bold
name line, padding, and a border: enough visual weight that it read as a component in its
own right, which is exactly what made it worth removing once Client List existed as the real
place to see/change this. What came back is a single muted text line with none of that —
closer to a caption than a card. Same underlying read (`getClient(getCurrentClientId())`),
same "recomputed on every page load" freshness model already established for the rest of
this reload-to-switch architecture.

**Browser-verified**: the Dashboard header's styling was compared directly against Approval
Gate's via a zoomed screenshot (not just by re-reading the shared class string) and is
pixel-identical; Overview and Client List both render and highlight correctly as plain rows
within it; "Client List" confirmed showing in the nav, the page `<title>`, and the page
`<h2>`; the indicator read "Viewing: John Doe · CLIENT-0001" before switching and correctly
updated to "Viewing: Jane Newclient · CLIENT-0002" immediately after "View as this Client,"
confirmed via a fresh screenshot taken after the switch, not assumed from the code. Spot-
checked on `admin-settings.html` for cross-page consistency. Full 321-assertion regression
suite re-run (no engine changes were made) — unaffected. Zero console errors throughout.

### 4.60 Approval Gate unification — Deposits/Allocations/Sells/HYS Deposits converted to the cross-client aggregation pattern (Aug 21, 2026)

**Why this was the highest-risk task of the session, and why a git safety net was set up
first.** This task rewrites the actual money/unit-moving primitives —
`executeBuy`/`executeSell`/`creditDepositRequest`/`creditHYSDeposit` — not just an admin
page's rendering logic. The user's first attempt at specifying this task was cut off
mid-sentence; rather than guess, the ambiguity was surfaced back explicitly (what "confirm
each function operates" should verify, whether the primitives themselves needed
explicit-`clientId` treatment). The user's next message, before providing the full spec, was
to initialize a git repository and make an initial commit of the working tree specifically
because there was no rollback net otherwise — done first (`git init` + one commit,
`19b183b`, 40 files, working tree confirmed clean afterward), before any of the engine
rewrite began.

**The full call-chain trace, done before writing any test, per the user's own explicit
instruction ("Trace and report the FULL call chain... before writing tests, so we know every
hop is actually covered, not just the top-level function signature").** Direct code reading
(not guessing) of `engine-core.js` confirmed the critical difference between this task and
its stated reference pattern (`admin-settings-changes.html`'s Client Profile Updates queue):
Settings Change was stateless from the start — `requestSettingsChange`/
`approveSettingsChangeRequest`/`rejectSettingsChangeRequest` all do a fresh
`localStorage.getItem`/`setItem` per call, no module-level cache anywhere in that domain, so
adding an explicit `clientId` parameter to its two resolve functions was genuinely
sufficient on its own. Deposits/Allocations/Sells/HYS Deposits are architecturally
different: `engine-core.js`'s IIFE loads `accountState`, `holdings`, `transactions`,
`allocationRequests`, `sellRequests`, `depositRequests`, and `hysDepositRequests` ONCE into
module-level `let` variables, ambiently, for whichever client happens to be active
(`getCurrentClientId()`) when the page runs — a literal "just add a `clientId` parameter"
pass on the 8 top-level approve/reject/credit functions would have looked like it worked
(the function accepts a `clientId` argument) while silently still reading and writing the
WRONG client's in-memory data underneath, reproducing the exact bug class §4.45 already
found and fixed once for the multi-client migration itself. Traced hop by hop: `executeBuy`
touches module-level `holdings`, `accountState`, `transactions`; `executeSell` touches the
same three plus its own re-read of `holdings` for the sell-side validation; `approveAllocationRequest`/
`rejectAllocationRequest` touch module-level `allocationRequests` (and, for approve,
everything `executeBuy` touches internally); `approveSellRequest`/`rejectSellRequest` touch
module-level `sellRequests` (and, for approve, everything `executeSell` touches, plus its own
pre-approval re-validation read of `holdings`); `creditDepositRequest`/`rejectDepositRequest`
touch module-level `depositRequests`, `accountState`, `transactions`; `creditHYSDeposit`/
`rejectHYSDeposit` touch module-level `hysDepositRequests` and `transactions`, plus
`marketswave_hys_pockets` — which turned out to be the one already-correct piece, since it
was always read/written via a direct scoped key (`clientScopedKey(HYS_POCKETS_KEY)`), never
cached in a module-level variable; only its `clientScopedKey()` → `scopedKeyForClient()` swap
was needed there. Confirmed via grep that `executeBuy`/`executeSell` have zero callers
outside the two functions rewritten to call them, and that the 8 approve/reject/credit
functions are called only from the 4 admin pages in this task's own scope — the blast radius
was fully contained before any code changed. This trace was reported back in full before any
Node test was written, per instruction.

**Engine implementation.** Five new shared helpers do the actual explicit-`clientId` storage
access every rewritten primitive now uses instead of the module-level arrays:
`readAccountStateForClient`/`writeAccountStateForClient`, `readHoldingsForClient`/
`writeHoldingsForClient` (both via `scopedKeyForClient()`), and `readRequestsForClient`/
`writeRequestsForClient` (parameterized by the request queue's own base key — one pair
serving all 4 domains' request arrays rather than 4 near-duplicate pairs), plus one shared
cross-domain helper `appendTransactionForClient(clientId, txn)` since every one of the 4
domains' resolve paths logs a transaction and none of them should be able to accidentally
fall back to the ambient `transactions` array. All 10 primitive/wrapper functions —
`executeBuy(clientId, productId, dollarAmount)`, `executeSell(clientId, productId,
unitsToSell)`, `approveAllocationRequest(clientId, requestId)`, `rejectAllocationRequest(clientId,
requestId, reason)`, `approveSellRequest(clientId, requestId)`, `rejectSellRequest(clientId,
requestId, reason)`, `creditDepositRequest(clientId, requestId, confirmedAmount)`,
`rejectDepositRequest(clientId, requestId, reason)`, `creditHYSDeposit(clientId, requestId,
confirmedAmount)`, `rejectHYSDeposit(clientId, requestId, reason)` — were rewritten to use
only these helpers, with no reference to the module-level arrays and no call to
`getCurrentClientId()` anywhere in any of these chains, confirmed by direct code review of
every line each one touches, not just its signature. `recomputeAllocatedCapital()`'s
existing logic (sum holdings × current unit price) is inlined into the rewritten
`executeBuy`/`executeSell` against the freshly-read client-scoped holdings, rather than
calling the existing ambient `recomputeAllocatedCapital()` — that function operates on the
module-level `holdings`/`accountState` and must not be invoked from an explicit-`clientId`
chain, since doing so would silently reintroduce the exact ambient dependency this task
exists to remove. `settleProduct()`/`getProduct()` and the whole Product Catalog stayed
completely untouched, confirmed still safe: pricing is genuinely global/unscoped, shared by
every client, so it has no per-client dimension to get wrong. Four new cross-client
aggregators — `getAllClientDepositRequests()`, `getAllClientAllocationRequests()`,
`getAllClientSellRequests()`, `getAllClientHYSDepositRequests()` — mirror
`getAllClientSettingsChangeRequests()`'s exact shape (`clients.reduce()` over
`getAllClients()`, each item tagged with `clientId`/`clientName`), deliberately copying that
established pattern rather than inventing a new one, per instruction. One narrow addition
made mid-task, not originally planned: `getTransactionForClient(clientId, txnId)` — needed
once `admin-sells.html`'s History table's Realized Return column turned out to require one
specific client's transaction record without switching the active session to them; scoped
narrowly (a single by-id lookup, not a full `getAllClientTransactions()` aggregator) since no
page currently needs every client's entire ledger at once. The pre-existing no-arg ambient
getters (`getDepositRequests()`, `getAllocationRequests()`, `getSellRequests()`,
`getHYSDepositRequests()`) and the client-facing `request*()` functions
(`requestDeposit`/`requestAllocation`/`requestSell`/`requestHYSDeposit`) were deliberately
left completely untouched — confirmed both by code (they still read/write the module-level
arrays exactly as before) and by browser-testing that `asset-performance.html`,
`high-yield-savings.html`, and `admin.html`'s own Overview pending-count cards (which use the
ambient getters, not the new aggregators — a scope boundary flagged here rather than silently
extended, since Overview's cards were not named in this task's page list) all continue to
work correctly.

**A real architectural consequence, surfaced rather than silently absorbed.** Because the
rewritten primitives now write directly to `localStorage` and bypass the module-level cache
entirely, that cache can go stale relative to `localStorage` in one specific situation: an
explicit-`clientId` call that happens to target the SAME client who is also the currently
active *ambient* client in that page/process, followed immediately (same page load, no
reload) by an ambient read (`getTransactionLedger()`, `getAccountState()`, `getHoldings()`,
`getAllocationRequests()`, etc.). This was discovered directly, not anticipated in the
abstract — Node-testing `creditHYSDeposit()` immediately followed by `getTransactionLedger()`
threw the ledger entry away (the ambient array hadn't been told about the direct write), and
the same pattern surfaced across several of the older regression test files once run against
the new code. It does not affect any real shipped page: the 4 admin pages always re-render
via the new `getAllClient*()` aggregators (always a direct fresh scoped read, never the
module cache), and client-facing pages always get a genuine fresh page load between any
prior admin action and their own render (so their module cache is never stale relative to
something that happened on a different page load). It IS a real, general property of this
part of the engine now, worth knowing before writing any future test or feature that mixes
an explicit-`clientId` action with an ambient read in the same process without a reload
between them — recorded here rather than left to be independently rediscovered.

**Node verification, run per-domain individually as instructed, not assumed from one passing
as a stand-in for all four.** A new harness (`verify-approval-gate-unification.js`) created
two clients with genuinely distinct starting state, then for each of the 4 domains in turn:
resolved an action for client A by explicit id while client B was deliberately NOT the active
session client, then diffed client B's raw scoped `localStorage` string byte-for-byte against
a snapshot taken immediately before the action — the exact test class that would have caught
the historical §4.45 cross-tab corruption bug, run for real against all 4 domains rather than
inferred from one. Also run in the reverse direction (resolve all 4 of client B's own pending
requests while client A is the ambient client, confirm client A's raw storage is untouched),
plus a reject-path check and a check that all 4 new aggregators genuinely surface both
clients' records with a real `clientName` on every item. 41 assertions, 0 failures. The full
prior regression suite (12 files, 305 assertions before this task) was then re-run alongside
it — 5 files needed a `reload()` call inserted between an explicit-`clientId` action and a
subsequent ambient read, which is the architectural consequence described above surfacing in
test code, not a real regression (those tests were written when the ambient getters and the
approve/reject functions shared the same in-memory state by construction; that assumption is
no longer true for these 4 domains, so the tests were updated to reload first, exactly
mirroring what a real page does between an admin action and a later page view). After that
fix: 346+ assertions across the full suite, 0 failures.

**Admin UI**, all 4 pages following the exact same edit shape: swap the single-client ambient
getter for the matching `getAllClient*()` aggregator; add a `bg-slate-100 text-slate-600`
client name/id pill to each Pending row and a Client column to each History table, matching
Client Profile Updates' existing visual treatment exactly rather than inventing a new one;
add `data-client` alongside the existing `data-id` on every action button, threaded through
each page's own approve/reject/credit modal state (`activeApprove*ClientId`,
`activeReject*ClientId`, `activeCredit*ClientId`) so every action call now passes the row's
own `clientId` explicitly. `admin-sells.html`'s History table additionally switched its
Realized Return lookup from the ambient `getTransactionLedger().find()` to the new
`getTransactionForClient(r.clientId, r.transactionId)`, since a cross-client table can no
longer assume the ambient ledger belongs to the row it's rendering.

**Sidebar cleanup.** The subtle "Viewing: [Client] · [CLIENT-ID]" indicator re-added in
§4.59 was removed from `admin-sidebar.js` again — `clientIndicatorHTML()` and its one call
site inside `initAdminSidebar()`. Confirmed via grep, before removing, that nothing else in
the file or the project referenced the function, the "Viewing:" text, or depended on it being
present. This directly reverses §4.59's own re-addition from earlier the same day — not a
mistake, but a real consequence of this task: once every Approval Gate page shows its own
per-row client context, a page-level "currently viewing" hint has nothing left to add.
`setCurrentClientId()`/`getCurrentClientId()` in `engine-core.js` and `admin-clients.html`'s
own "View as this Client" mechanism (`setCurrentClientId()` + `location.reload()`) are
completely untouched.

**Browser-verified live, the full flow — not assumed from the Node pass.** Seeded a second
client (Jane, CLIENT-0002, already existing in this browser from earlier sessions) with one
pending item in each of the 4 domains via the console (a deposit, an allocation, an HYS
AYW deposit, and a sell — the sell needed an existing holding first, so a small `executeBuy`
was issued directly by explicit id before switching context to create it). For each of the 4
admin pages in turn: confirmed both CLIENT-0001's and CLIENT-0002's pending items render
together with correct per-row client labels; resolved CLIENT-0002's item through the real
modal (Credit for Deposits/HYS, Approve for Allocations/Sells); confirmed it moved into
History with the correct client label and correct computed figures (the sell showed a real
"+$0" Realized Return, fetched via the new `getTransactionForClient()`, correct for a
same-day buy-then-sell at an unmoved price); and confirmed via a direct raw-`localStorage`
diff (every one of CLIENT-0001's 8 relevant scoped keys, string-compared, not just visually
inspected) that CLIENT-0001 was byte-identical before and after each of the 4 actions.
Also separately confirmed `admin-clients.html`'s "View as this Client" continues to serve its
real remaining purpose: it switches the admin tool's own ambient session (`getCurrentClientId()`
confirmed changing and persisting correctly across admin-page navigation within the same
tab), and — confirmed as a deliberate non-effect, not a bug — this switch does NOT change
what a client-facing page shows, since `dashboard-sidebar.js` unconditionally resets the
session's client id to `CLIENT-0001` at file-load time on every client-facing page,
regardless of the admin tool's own session state (the exact by-design safety fix from
§4.44/§4.45, re-confirmed still working correctly here rather than assumed unaffected). Zero
console errors throughout, confirmed via the browser console reader, not just visual
inspection.

### 4.61 Password Reset + 2FA Rework — built cross-client from the start (Aug 21, 2026)

**The point of this task, stated explicitly by the user, was to not repeat §4.60's own
history.** Every prior admin-triggered domain in this project (Deposits, Allocations,
Sells, HYS Deposits) was built ambient-first and had to be converted to cross-client later,
at real risk, once module-level caching turned out to be load-bearing in ways a first pass
didn't anticipate. This task was specified as "build cross-client from the start this time,
using the exact pattern the Approval Gate unification proved out" — so the design decision
made before writing any code was: never introduce a module-level cache for this domain at
all, for either the per-client security-state flag or the global audit log. Both are
stateless, direct-scoped-storage-access-per-call, mirroring the Settings Change Request
queue's own discipline (which was always correct, never needed converting) rather than the
`accountState`/`holdings`/`transactions` pattern that caused §4.60's actual problem. This
paid off directly in verification: the full prior regression suite needed zero `reload()`
insertions for this task, versus 5 files for §4.60 — there was never a module-level cache to
go stale in the first place.

**Engine.** `SECURITY_LOG_KEY` (`marketswave_security_actions_log`) is genuinely global —
same category as `CLIENTS_KEY`/`CATALOG_KEY`, an audit trail spanning every client, never
scoped to one. `SECURITY_STATE_KEY` (`marketswave_settings_security`) is per-client, mirroring
`SETTINGS_PROFILE_KEY`'s own key-per-client convention. `appendSecurityLogEntry(clientId,
type, reason)` is the shared helper both `resetClientPassword()`/`resetClient2FA()` call —
reads the log fresh, resolves `clientName` from the Client Registry (safe to read that
module-level `clients` array here, unlike the per-client stores §4.60 had to fix, since there
is only ever one Client Registry, not one per client, so there's no "wrong client's copy" to
go stale), appends, writes back. `resetClientPassword(clientId, reason)` and
`resetClient2FA(clientId, reason)` both validate `reason` is non-empty (throwing a specific
message either way, surfaced verbatim in the admin modal), then do a direct scoped
read/write for that explicit client only, then call `appendSecurityLogEntry()`. Neither
function nor `getSecurityActionsLog()` reference `getCurrentClientId()` or any module-level
cached variable anywhere in their bodies — confirmed by direct code review, the same
verification standard §4.60 established, not merely by the function signature accepting a
`clientId` parameter.

**"Force new password" approach — reported per instruction, not silently decided.** There is
no real login/session system anywhere in this project, so there is nothing server-side to
actually invalidate when a PM "resets" a client's password. The approach taken:
`resetClientPassword()` sets a per-client flag object (`forcePasswordReset: true,
forcePasswordReason, forcePasswordFlaggedAt`) under the client's own scoped
`SECURITY_STATE_KEY`. `settings.html` reads this flag via `getClientSecurityState()`
(ambient — ok here, since `settings.html` is a client-facing page and `dashboard-sidebar.js`
already unconditionally pins every client-facing page to `CLIENT-0001` at file-load time, the
§4.44/§4.45 mechanism) on every load, and if set, hides everything else on the page behind a
banner + forced "Set New Password" form until the client submits a valid new password, which
calls `clearForcePasswordReset()` (ambient, ONLY ever called by the client's own completed
form) to clear the flag. **This is explicitly a client-side UI convenience gate, not real
security** — a client could in principle clear the flag themselves via the browser console,
the same way any client-side-only gate in a project with no backend can be bypassed. Real
enforcement — a server actually rejecting requests until a credential is genuinely rotated —
needs the login gate + backend session work already tracked as deferred in the Backend
Requirements Register. **This does NOT need to wait on that work to exist in this stub
form** — it's buildable now, exactly as built, and flagged here rather than silently treated
as either "done" or "blocked." One more thing worth being explicit about: this reset flow
doesn't invent a password store. The project's EXISTING self-service Change Password form
(the one directly below the 2FA section on `settings.html`) has never persisted an actual
password anywhere — there is no real credential store in this codebase at all, and the
normal password-change flow already just validates and shows a success toast. The
forced-reset form does the identical thing (validate, clear the flag, show success) rather
than inventing new unpersisted-credential behavior that doesn't match the rest of the page.

**2FA rework: QR/authenticator → email-code.** The previous setup panel showed a static
placeholder QR-code icon and accepted any 6-digit input as "confirmation" — genuinely no
verification happened at all. The new panel generates a random 6-digit code client-side the
moment the toggle is switched on, displays it directly on the page (labeled clearly as a
stand-in for a real email since no email backend exists in this project — the same
simulated-delivery convention already used elsewhere, e.g. deposit request "confirmations"),
and the Confirm button now checks the client's typed input against that exact generated code,
not just a length/digit-pattern check. This is a small but real behavior change: entering the
wrong 6 digits now correctly fails with a specific error, where the old flow would have
accepted it. The underlying storage (`marketswave_settings_2fa`, a bare `'enabled'`/
`'disabled'` string, scoped per-client) is completely unchanged in format — chosen
deliberately so `resetClient2FA()` writing `'disabled'` there needs zero corresponding
changes to `settings.html`'s own read logic (`localStorage.getItem(STORAGE_KEY) ===
'enabled'`) to pick the reset up correctly on the client's next page load.

**Admin UI.** `admin-clients.html`'s expanded client row gained "Reset Password" and
"Reset 2FA" buttons next to the existing "View as this Client" — both open the same shared
Security Action modal (distinguished by a stored `activeSecurityAction`), which requires a
non-empty reason before "Confirm Reset" is enabled to actually do anything (client-side
`.trim()` gate plus the engine's own throw as a second layer, not a single point of
enforcement); each button passes its own row's `clientId` explicitly, never relying on the
admin tool's ambient active client. New `admin-security.html` — grouped under "User/Admin
Relations" in `admin-sidebar.js` (a new lock-icon nav item, chosen deliberately distinct from
the document/checkmark icons already used by the queue pages in that group, since this is a
log, not a queue) — renders `getSecurityActionsLog()` as one flat, newest-first table:
client, action type (color-coded badge, amber for Password Reset / purple for 2FA Reset,
matching this project's existing badge-color conventions), reason, performed by, when. No
pending/approve mechanic anywhere on this page, per instruction — every row is already a
resolved, permanent record the moment it's created. `admin.html`'s Overview page picked up a
matching "Security Actions Logged" card in the User/Admin Relations section, showing the
total log count rather than a pending count (the same non-count treatment Settings' Advisory
Fee Rate card already established for a domain with no pending-item concept) — added because
the file's own standing comment states the card grouping mirrors `admin-sidebar.js`'s
`NAV_ITEMS` groups exactly, membership included, and leaving Account Security out of Overview
would have silently broken that already-documented invariant.

**Node verification, run before any UI code, per instruction.** A new harness
(`verify-security-actions.js`) covers: validation (empty/whitespace/null reason rejected for
both `resetClientPassword()` and `resetClient2FA()`); single-client behavior (flag set
correctly with the right reason/date, log entry shape correct, `clearForcePasswordReset()`
clears the flag but never removes the permanent log entry); and — the actual point of this
task, mirroring §4.60's own isolation-test discipline — per-action cross-client isolation
tested individually for BOTH action types: reset CLIENT-0001's password, diff CLIENT-0002's
raw `marketswave_settings_security`/`marketswave_settings_2fa` strings byte-for-byte against
a pre-action snapshot; same for CLIENT-0001's 2FA reset; then the reverse direction (reset
both of CLIENT-0002's, diff CLIENT-0001's raw storage); plus a defensive-copy check on
`getSecurityActionsLog()`. 49 assertions, 0 failures. The full prior regression suite (13
files, 346+ assertions) was re-run alongside it and needed zero modifications — no
`reload()` insertions required anywhere, the direct payoff of building this domain stateless
from the start rather than converting it later.

**Browser-verified live, the full flow.** Triggered Reset Password against CLIENT-0001 from
`admin-clients.html` with an empty reason first, confirming the engine's exact thrown message
("A reason is required to reset a client's password.") surfaces verbatim in the modal; then
with a real reason, confirmed the flag landed correctly via a raw `localStorage` read (the
JS-tool's own output redacted the parsed object's values because the key names contained the
word "password" — a tool-level display safeguard, not an app bug, confirmed by reading the
identical data as a raw un-parsed string instead, which showed the real values plainly).
Repeated for Reset 2FA. Navigated to `settings.html` as CLIENT-0001 and confirmed the forced
banner rendered with the PM's actual reason quoted, the rest of the page fully hidden;
tested the new-password validation (too-short rejected, mismatch rejected), then a valid
matching password, which cleared the banner and — confirmed via a reload, not just the
immediate DOM state — stayed cleared. Tested the new email-code 2FA flow: the toggle-on
generated and displayed a real 6-digit code, submitting the wrong 6 digits produced a
specific mismatch error, submitting the exact displayed code succeeded and persisted
`'enabled'` to raw storage. Confirmed `admin-security.html` rendered both log entries
correctly (client label, color-coded type badge, reason, performer, date, newest first).
Confirmed, via a raw `localStorage` diff read directly from the browser (not Node-simulated),
that CLIENT-0002's `marketswave_settings_security`/`marketswave_settings_2fa` keys were both
still `null` — completely untouched — after every action taken against CLIENT-0001 in this
live session. Zero real console errors; the only console entries recorded were a generic
Chrome-extension "message channel closed" exception with no file/line attribution to this
app's own code, the same known automation-tooling artifact seen on other pages earlier in
this project.

### 4.62 Admin Login Gate — session-based passphrase gate (Aug 21, 2026)

**What this is, and — just as importantly — what it explicitly is not.** Every admin page in
this project has been reachable by anyone who could guess or be given the URL, with zero
friction, since Admin Tool Phase B first shipped (§4.41). This task closes that specific
gap — "completely wide open" — and only that gap. It does not, and was never asked to,
close the "properly secured" gap: there is still no PM account roster, no backend, and no
real credential verification of any kind. The gate is a single shared passphrase compared
client-side against a plain string constant sitting in `engine-core.js`, fully readable by
anyone who opens dev tools — the same level of "protection" as everything else in this
frontend-only project's source. This is stated explicitly in three places, not just this
doc: a code comment directly above `ADMIN_PASSPHRASE`, a visible one-line disclaimer on
`admin-login.html` itself, and the Backend Requirements Register row (48) — the same
honesty standard already established for the forced password-reset gate (§4.61), applied
consistently rather than let slip for a feature literally named "Login Gate."

**Engine.** `ADMIN_PASSPHRASE` and `ADMIN_AUTH_SESSION_KEY` are declared right after
`setCurrentClientId()`, deliberately positioned next to the client-session mechanism this
new one mirrors. `checkAdminPassphrase(input)` is a bare `===` comparison — no trimming, no
case-insensitivity, no hashing; wrong case or incidental whitespace both correctly fail,
confirmed by test rather than assumed. `setAdminAuthenticated()`/`isAdminAuthenticated()`/
`clearAdminAuthenticated()` read/write a single `sessionStorage` key, the same storage
mechanism (not `localStorage`) `getCurrentClientId()`/`setCurrentClientId()` already use for
exactly the same reason: a `sessionStorage` value resets when the browser session ends,
which is the correct default for "am I currently allowed in," the same way it's already the
correct default for "which client is currently selected."

**Gate page.** `admin-login.html` is a new, standalone page — Tailwind, slate/amber, the
same red "INTERNAL TOOL" banner every other admin page carries, deliberately NOT styled
like the public site's client-facing `login.html` (navy/cream, `styles.css`), since this
page needs to read as unmistakably the internal tool from the first pixel, consistent with
every other admin page's visual language. It loads only `engine-core.js` — not
`admin-sidebar.js` — specifically so there is no nav/session-dependent chrome to gate
against on the one page that must always be reachable regardless of auth state, and so
there is no possibility of a redirect loop against itself. The error state is deliberately
generic: "Incorrect passphrase," full stop, regardless of what was actually wrong — there
is no real backend distinguishing "wrong passphrase" from "expired session" from "unknown
user" to leak information about in the first place, so the honest response is one
uninformative message, not a menu of specific-sounding failure reasons that would imply a
sophistication this check doesn't have. Submits via both a Continue button and Enter-key
handling in the input.

**Gating mechanism — the one place this task genuinely had to think about ordering.**
`admin-sidebar.js` is confirmed to be the very first `<script>` tag on every admin page
(checked every admin page's script tag order directly, not assumed), which makes it the
correct place for the check per instruction — but `isAdminAuthenticated()` is defined in
`engine-core.js`, which loads AFTER `admin-sidebar.js` in every page. This is the identical
ordering problem `dashboard-sidebar.js` already solved once for its own CLIENT-0001 reset
(§4.44/§4.45): the fix there was a raw `sessionStorage` key access at file-load time, not a
call to the not-yet-defined engine function, with a comment tying the literal key string
back to its counterpart constant in `engine-core.js` so the two can't silently drift apart.
The exact same pattern was applied here — a raw `sessionStorage.getItem('marketswave_admin_
authenticated') === 'true'` check runs at the top of `admin-sidebar.js`, before the file's
own IIFE, before `NAV_ITEMS`/`GROUPS` are even defined, and calls `location.replace('admin-
login.html')` immediately if it fails. A second check was added as the first line inside
`initAdminSidebar()` itself, using the real `isAdminAuthenticated()` function (fully defined
and safe to call by the time this runs, since it executes from a `<script>` tag positioned
after `engine-core.js` has loaded) — defense in depth, not strictly required for the happy
path, but consistent with this project's general instinct toward a belt-and-suspenders check
at the point where a function actually renders something, not just at the earliest possible
moment. Neither check was extended into every individual admin page's own data-loading
script (a scope decision, not an oversight) — the task named `admin-sidebar.js` specifically
as the gating surface "since it already mounts on every admin page," and extending the check
into 10+ separate page scripts wasn't asked for and would have been scope creep for a stub
whose own honesty disclaimer already concedes it isn't real security. `admin-login.html`
itself needed no gating logic of its own, by construction — it never loads
`admin-sidebar.js`.

**Log Out.** Added to the sidebar's existing footer block (the "Portfolio Manager / Internal
access" card at the bottom of the nav) as a small text button, calling
`clearAdminAuthenticated()` then redirecting to `admin-login.html`. Explicitly a distinct
mechanism from the client-facing logout `dashboard-sidebar.js` already has (which navigates
to `login.html` and, per row 1 of the Backend Requirements Register, still has nothing real
to clear) — the two personas' logout actions touch completely different session keys and
must never be confused, the same "never blur these boundaries" discipline this project
applies to every other client/admin distinction.

**Node verification.** A new harness (`verify-admin-login-gate.js`) covers: exact-match
passphrase checking (correct, incorrect, wrong case, leading whitespace, `null`,
`undefined` — none of the malformed-input cases throw); the full
`isAdminAuthenticated()`/`setAdminAuthenticated()`/`clearAdminAuthenticated()` cycle,
including confirming `clearAdminAuthenticated()` actually *removes* the `sessionStorage`
key rather than just setting it to something falsy; authenticated state surviving a
simulated reload (same session, mirroring real page-to-page navigation); confirming the
auth flag is never written to `localStorage` (would be wrong for something meant to reset
per-session); and a simulated fresh session (`sessionStorage` cleared, `localStorage`
untouched) correctly starting unauthenticated again — the exact browser-verify scenario the
task asks for, proven first at the Node level. 15 assertions, 0 failures.

**A pre-existing, unrelated test failure was found while re-running the full suite, and is
reported here rather than silently worked around.** `verify-step2.js` has one assertion
(`account_state.allocatedCapital === 410000`) that hardcodes an exact price figure implicitly
depending on `engine-core.js`'s deterministic-but-real-wall-clock-date-seeded price tick for
Nordic Growth Fund — the assumption baked into the test (unit price stays exactly at its
$100 seed value) stops holding once enough real calendar days have passed since the
product's `createdAt` for the GBM tick to move the price away from that seed. **Confirmed
this is not a regression from any change made in this session**: the identical test, run
against `git show HEAD:engine-core.js` (the original, untouched, already-committed
baseline, predating every task in this session including Approval Gate unification and
Password Reset + 2FA), fails identically. This is real, pre-existing test brittleness tied
to wall-clock time rather than a controlled fixture — worth fixing at some point (freezing
or mocking the date in that test, or asserting a tolerance/range instead of an exact
figure), but explicitly out of scope for the Admin Login Gate task, so it was reported here
rather than either silently ignored or opportunistically "fixed" as a drive-by unrelated to
what was asked. Every other file in the 15-file suite: 0 failures.

**Browser-verified live, the full flow, exactly as asked.** Navigated directly to
`admin.html` with no prior session state — redirected to `admin-login.html` immediately, no
flash of real admin content. Entered a wrong passphrase: generic "Incorrect passphrase"
error shown, input cleared and refocused, tested via Enter-key submission. Entered the
correct passphrase: authenticated, redirected to `admin.html`. Navigated directly (via the
address bar, not through the nav) to `admin-deposits.html` — stayed authenticated, no
redirect, confirming the session persists across real page-to-page navigation within the
same tab. Clicked "Log Out": redirected to `admin-login.html`, confirmed via a direct
`sessionStorage.getItem()` read (not just the visual redirect) that the flag was genuinely
cleared, then confirmed navigating to `admin-security.html` directly redirected back to the
gate again — the lockout is real, not just a one-page effect. Logged back in, then
simulated a fresh browser session via `sessionStorage.clear()` followed by a real navigation
to `admin-clients.html` — correctly redirected to the gate again, proving the "fresh
session requires re-entering the passphrase" requirement holds for real, not just in the
Node simulation. Zero console errors observed at any point in this entire flow — including,
notably, none of the Chrome-extension "message channel closed" noise seen on earlier pages
in this session, which was never an application error to begin with.

### 4.63 Asset Collection extraction + full admin product management (Aug 21, 2026)

**Scope, stated up front by the user and worth restating**: Product Catalog stays global/
unscoped exactly as already designed — nothing about the data model changed here. This was
a UI-scale task (the browsing grid needed to work for hundreds of products, not four or
five) and an admin-UI task (the catalog had never had a real management surface — every
prior addition went through the console). Two independent halves, covered in order below.

**Client side: `asset-performance.html` → new `asset-collection.html`.** The exact card
markup, the `flex flex-col` + `mt-auto` height-equalization fix (documented at length when
it was first added), the category tabs, and the `requestAllocation()` wiring all moved
verbatim — read the original file's own inline comments before touching anything, then
carried every one of them forward describing the same code in its new location, rather than
re-deriving the reasoning from scratch. What's genuinely new: search (`matchesSearch()`,
matching by product name, case-insensitive substring — the identical shape as
`admin-clients.html`'s own `matchesSearch()`, extended to a new domain rather than
reinvented) and a category filter that is now load-bearing rather than cosmetic (with 5
seed products, filtering never mattered; with an admin now able to add more, it does).
**Pagination choice, decided and reported per instruction**: "Load More," not numbered
pagination. The existing card grid was always a single `.innerHTML = array.map(cardHTML)
.join('')` render into one container — Load More only needs one extra number
(`visibleCount`, incremented by `PAGE_SIZE` on each click) and re-renders the same filtered
array sliced wider; numbered pagination would have needed page-index state, a page-count
calculation, and a page-number control row for a benefit (jump to page N) nothing about
this UI's actual use case calls for. `PAGE_SIZE = 9` fills exactly 3 full rows at the `xl`
3-column breakpoint. A new search or filter change always resets `visibleCount` back to
`PAGE_SIZE` — starting a fresh browse from the top, rather than leaving a stale, possibly
much-larger "visible window" applied to a newly-narrowed result set.

**What deliberately did NOT move, and why, stated explicitly rather than left to infer from
the diff**: Return Table and My Requests stay on `asset-performance.html`. Return Table is
keyed off current holdings (`getHoldings()`), which has nothing to do with browsing the
catalog — it's a performance view, not a shopping view. My Requests merges allocation AND
sell requests, and Sell only makes sense in the context of a holding, which only ever
appears via the Return Table's own Sell button — moving My Requests without Return Table
would have separated a sell request from the only page that can actually create one.
`asset-performance.html` gained one new element in the grid's old position: a "Browse Asset
Collection" link card, `<a>`-wrapped, matching the visual weight of the section it replaced
rather than a small text link easy to miss.

**No new locked-sidebar nav entry — confirmed against CLAUDE.md before deciding, not
assumed.** The sidebar menu order (`Portfolio Overview → Asset & Performance → High Yield
Savings → Transactions → Documents & Reporting → Risk Management → Deploy Capital →
Settings → Support`) is explicitly locked, "do not restructure without explicit sign-off" —
the task didn't ask for sign-off on that, so `asset-collection.html` doesn't get a slot in
it. It still calls `initDashboardSidebar('asset-performance')` on load, though, so the
sidebar highlights "Asset & Performance" as active — the identical treatment
`deploy-capital.html` already established for a page reached by link rather than occupying
its own locked nav position (CLAUDE.md: "Deploy Capital's position in that list does not
move" — the same underlying principle, a page can be real and reachable without needing its
own permanent nav slot).

**Admin side: new `admin-products.html`.** Grouped under Portfolio Administration in
`admin-sidebar.js` — the exact placement that file's own standing comment had already named
as the anticipated next addition ("Per instruction: Product Catalog management would land
under 'portfolio-administration'"), so this wasn't a new categorization decision, just
following through on one already made. Reuses `admin-clients.html`'s proven list shape
directly: search input, filter pills, expandable rows, an action inside the expanded area —
but with TWO independent filter dimensions instead of Client List's one (asset class AND
risk tier, each its own labeled pill row), since a product genuinely has two orthogonal
classification axes a PM might want to narrow by separately. Each summary row shows exactly
the six fields asked for: name/class/type/riskTier/minimumInvestment/currentUnitPrice — type
folded into the name cell's subtitle (matching how Client List shows a client's id as a
subtitle under its name) rather than its own column, to keep the table from growing past six
visible columns before the expand chevron.

**Add Product**: calls `addProduct()` for real — the function existed since Phase 1 but had
zero callers anywhere in the project until now (confirmed via grep), console-only exactly as
the task described. Asset class dropdown offers only the 4 allocatable classes; `Unallocated
/ Cash` is deliberately excluded — it's the catalog's synthetic representation of the
Unallocated bucket, seeded exactly once, and letting an admin create a second "Cash"-class
product would produce a confusing, semantically meaningless duplicate even though nothing in
the engine would technically break. Starting unit price copy states plainly, on the form
itself, that it's PM-entered, not a live feed — consistent with the standing "real market
data stays deferred" scoping decision, restated here rather than left implicit. `addProduct()`
itself was rewritten to actually validate (previously accepted anything, including a missing
name or negative price) and to construct the derived fields correctly rather than trust the
caller: `inceptionUnitPrice` is set equal to the PM-entered starting price and `lastTickDate`
is seeded to today, the identical "nothing visually jumps until a real day passes" pattern
`buildSeedData()` already established for the original 5 products, now correctly applied to
a product created well after initial seed for the first time.

**Edit Product — the judgment call the task specifically asked to be made and reported, not
left open.** The instinct stated in the task ("I'd lean toward blocking direct unitPrice
edits") was adopted, and enforced at the engine layer, not just by omitting the field from
the form: `editProduct()` explicitly rejects a patch containing `unitPrice` (or `id`,
`createdAt`, `lastTickDate`, `inceptionUnitPrice`) with a specific thrown message explaining
why, rather than silently ignoring it. Reasoning: `settleProduct()`'s deterministic tick is
the only thing that should ever move a product's price — every client's unrealized-return
math for that product derives from it — so a manual overwrite from a general "edit product"
form could silently corrupt that math, indistinguishable from an honest data-entry
mistake in fields the PM DIDN'T mean to touch. The gap this leaves, flagged rather than
silently accepted per the task's own request to flag it: there is currently no way to fix a
typo in a product's STARTING price after `addProduct()` has already run, and no
`removeProduct()` exists to delete-and-recreate it clean either. If that turns out to be a
genuine operational need, the right shape for it is a separate, explicitly-labeled override
capability (its own function, its own clearly-marked admin control, probably its own
confirmation step given what it can corrupt if misused) — not a quiet exception carved into
this general edit path.

**The "does renaming orphan anything" proof — done as a direct test, not a design
argument.** `editProduct()` never changes `id`; holdings and transactions only ever
reference a product by that immutable id string, joining to live name/class/everything-else
data via `getProduct(id)` at render time (confirmed by reading every actual caller —
`admin-allocations.html`, `admin-sells.html`, `asset-performance.html`, `dashboard.html`,
`transactions.html` — none of them cache a product's name or class anywhere persistent).
This means a rename or reclassification is automatically reflected everywhere by
construction, with nothing to migrate — but "by construction" was proven, not just argued:
the Node suite renamed and reclassified `PROD-0001` (Nordic Growth Fund, which the real demo
seed already gives both a holding AND a backfilled BUY transaction) and confirmed the
holding and the transaction are still present afterward, completely byte-identical in every
field, while a live join from that same unchanged holding now correctly shows the new name —
exactly the scenario a real rename in production would need to survive.

**A real, pre-existing latent bug, found and fixed as a direct consequence of adding
`editProduct()`, not left for later.** `getAllProducts()`/`getProduct()` had returned live
references into the module-level `catalog` array since Phase 1 — the identical bug class
already found and fixed once for `getHoldings()`/`getAllocationRequests()` back in Phase 3
("returning live object references, not clones... fixed to match `getAccountState()`'s
existing defensive-copy pattern"). Harmless for as long as nothing ever wrote back to a
catalog entry outside seed time, which was true until this exact task — `editProduct()`
mutates a catalog entry in place, so a caller holding an old `getProduct()` reference across
an edit would otherwise see it silently change underneath them. Confirmed via grep, before
fixing, that every real caller across the whole project only ever reads from the result and
never mutates it expecting persistence, so converting both functions to defensive-copy reads
was safe to do now rather than leave as a landmine for whichever future task discovers it
the hard way.

**Node verification.** A new harness (`verify-product-management.js`) covers: full
validation coverage for both `addProduct()` (missing/whitespace name, invalid asset class,
missing investment type, invalid risk tier, negative minimum investment, zero/negative/
missing unit price) and `editProduct()` (unknown id, every blocked field individually,
invalid merged-result values); the real success paths for both, including confirming
`addProduct()`'s derived fields (`inceptionUnitPrice`, `lastTickDate`) are set correctly and
`editProduct()` correctly applies a genuinely partial patch (only one field, everything else
left exactly as it was); the new defensive-copy behavior on both getters; and — the
rename/reclassify-doesn't-orphan-anything proof described above, plus a final sanity check
that `settleAllProducts()` still runs cleanly with a newly-added product's risk tier
correctly resolving against `RISK_TIER_RETURN_CONFIG`. 46 assertions, 0 failures. Full prior
regression suite (14 files, 395+ assertions) re-run alongside it, all still passing — this
task needed no `reload()` insertions anywhere, since nothing here touches the per-client
module-level caching pattern Approval Gate unification had to work around.

**Browser-verified live, the full flow, exactly as asked.** Added a real product ("Atlas
Infrastructure Fund," Real Assets, $5,000 minimum, $75.00 starting price) from
`admin-products.html`, confirmed it appeared correctly on `asset-collection.html` with
working search (narrowed to just that card on "atlas") and confirmed its card rendered with
a correct "No position" badge and the right minimum-investment line; submitted a real
$10,000 allocation request against it directly from the new page and confirmed it in
`getAllocationRequests()`. Edited Nordic Growth Fund's minimum investment from
`admin-products.html` (`$25,000 → $30,000`) and confirmed the client-side card on
`asset-collection.html` picked up the new figure on the very next load — then reverted it
back to `$25,000` afterward via the console, since this was a verification step against
real, pre-existing seed data, not an intended permanent change (unlike the new product
itself, which was deliberately left in place — there's no `removeProduct()` to clean it up
with, and it's a legitimate, honest artifact of the shipped feature working, the same
treatment prior sessions gave other unremovable legacy test records like `SETTING-0002`).
Confirmed `asset-performance.html`'s Return Table and My Requests render exactly as before
the split, and — the strongest proof the two pages genuinely share one engine, not two
divergent copies — that the Atlas Infrastructure Fund allocation request submitted from
`asset-collection.html` shows up correctly in `asset-performance.html`'s own My Requests
list. Zero real console errors throughout (only the same known Chrome-extension messaging
artifact seen elsewhere in this session, confirmed by its generic "message channel closed"
text and lack of any app file/line attribution).

### 4.64 Client Authentication, Phase 1 — credential storage + signup wiring (Aug 21, 2026)

**The report requested before any code changes.** Read `signup.html` directly rather than
assuming: its "Submit Application" click handler was exactly `if (!validateStep(9)) return;
window.location.href = "thank-you.html";` — nothing else. No `<script src="engine-core.js">`
tag anywhere in the file (confirmed via grep, not assumed from the page's public/onboarding
category), and no aggregation of the form's own already-collected fields (`full_name`,
`email`, `phone`, `password`, `password_confirm`, all sitting in the DOM across step 2, an
`accountType` variable tracked from step 1) into anything that could be persisted. This
meant every piece of "Phase 1" needed building from nothing, not wiring up a partial
existing mechanism — reported back before writing a single line of the engine work, exactly
as asked.

**Storage decision, made and reported per instruction.** The task offered two options — fold
into existing per-client settings, or a new dedicated key — and named the new key as an
example. A dedicated `marketswave_client_credentials:<clientId>` key was chosen: credentials
are categorically different from profile data (name, address, phone) in a way that matters
for how carefully surrounding code needs to treat them, and a separate key means nothing
that reads/spreads/displays a client's profile object can ever accidentally end up holding a
password hash. This mirrors a choice already made once this session for exactly this reason
— Account Security's `marketswave_settings_security` key was kept separate from
`marketswave_settings_profile` for the identical argument.

**`hashClientPassword()` — the one function in this entire file that ever sees a raw
password, and only for the width of its own call.** Web Crypto's `crypto.subtle.digest()` is
async-only, so this function is `async`; it takes `rawPassword` as a parameter, encodes it,
digests it with SHA-256, converts the result to a lowercase hex string, and returns — nothing
about the raw string is stored in a module-level variable, logged, or attached to any object
that survives past the function's own return. The task's own phrasing ("never store the raw
password itself, anywhere, even transiently in a variable that outlives the hashing call")
was read as a real constraint on THIS function's implementation, not just a general goal —
satisfied by keeping the raw password strictly local to `hashClientPassword()`'s own scope,
with `setClientCredentials()`/`verifyClientCredentials()` only ever seeing the already-hashed
output.

**The demo credential.** CLIENT-0001 needed a real, known password so existing demo/testing
flows keep working once a real login check exists (Phase 2) — chosen: `Marketswave2026!`,
reported here in full per instruction, since that's the literal credential every future
testing session in this project will need. Its SHA-256 hex digest was **precomputed once, in
Node, before writing any engine code** — `aa2490ec8670500ccd3838f2adff7cedf5425318e5e8c7d989acfa903a4704d6`
— and hardcoded as `DEMO_CLIENT0001_PASSWORD_HASH`, deliberately NOT generated by calling
`hashClientPassword()` at seed time. The reason is structural, not a shortcut: every other
store in `engine-core.js` seeds synchronously inside the file's own top-level IIFE, and
`crypto.subtle.digest()` returns a Promise with no synchronous equivalent — introducing one
async seed path into an otherwise fully-synchronous module would have been a real
architectural change well beyond what "Phase 1: credential storage + signup wiring" asked
for. The precomputed hash was verified two ways before being trusted: against Node's own
`crypto.createHash('sha256')` digest of the identical string (an independent SHA-256
implementation, not just internal self-consistency), and again inside the Node verification
harness against `hashClientPassword()`'s own real Web-Crypto-backed output for the same
password, confirming both paths produce byte-identical results. Seeding follows the
established "never clobber existing data" discipline every other seed-if-missing block in
this file already uses — proven directly, not assumed: a test changed CLIENT-0001's
credential to a different hash, reloaded the engine (re-running the seed check), and
confirmed the changed credential was still there, not silently reset back to the demo value.

**`signup.html` wiring.** The page now loads `engine-core.js` for the first time — the first
public/onboarding page to load any shared engine file. This is flagged explicitly as crossing
the DATA-layer boundary between the public site and the dashboard family, but deliberately
NOT the STYLING boundary CLAUDE.md documents (custom CSS vs. Tailwind) — `engine-core.js` is
plain vanilla JS with zero Tailwind dependency, so this doesn't blur the boundary the project
actually cares about keeping intact. The submit handler became `async`: after the existing
`validateStep(9)` check passes, it reads the real collected values (`full_name`, the
already-`id`'d `email` field, `phone`, and the raw password from the already-`id`'d
`password` field), maps the tracked `accountType` variable (`individual`/`joint`/`entity`)
to the exact account-type string format `admin-clients.html`'s own Add Client form already
uses (`Individual Account`/`Joint Account`/`Business Account` — not a new format invented for
this page), calls `addClient()`, then `await`s `hashClientPassword(rawPassword)` and passes
the result straight into `setClientCredentials(newClient.id, hash)`, then redirects to
`thank-you.html` exactly as before. Failure handling reuses the page's own pre-existing
`showError()` (a plain `alert()` — crude, but consistent with how every other validation
failure on this page is already surfaced, not a new pattern introduced here) inside a
`try`/`catch`, and the handler fails closed (shows an error, does not navigate) if
`engine-core.js` somehow didn't load, rather than silently completing a UI transition to
`thank-you.html` while creating nothing.

**What this phase explicitly did not touch, per instruction.** `login.html`'s own submit
handler is completely unchanged — it still redirects unconditionally on any submit,
regardless of what's typed. `dashboard-sidebar.js`'s hardcoded
`sessionStorage.setItem('marketswave_current_client_id', 'CLIENT-0001')` pin (the §4.44/§4.45
safety mechanism) is also completely unchanged. Both are real, deliberate scope boundaries —
this phase only gets credentials to exist somewhere real; making them actually gate anything
is Phase 2, and letting a real logged-in identity replace the hardcoded pin is Phase 3.

**Node verification.** A new harness (`verify-client-auth-phase1.js`) covers: determinism
(the same password always produces the same hash, checked via direct repeated calls, not
assumed from the algorithm) and distinctness (different passwords, and even a one-character
difference, always produce different hashes) for `hashClientPassword()`, cross-checked
against an independently-computed Node `crypto` SHA-256 digest of the same string, not just
internal self-consistency; full validation and set/compare behavior for
`setClientCredentials()`/`verifyClientCredentials()`, including a client with no stored
credentials at all correctly returning `false` rather than throwing, and a direct
confirmation that the raw password string never appears anywhere in what actually gets
persisted to storage; the CLIENT-0001 demo seed working correctly and surviving a reload
without being re-applied over a real subsequent change; and — the actual point of this
phase's verification ask — a complete signup-equivalent flow proving a REAL client with a
REAL stored hash results, not merely a UI transition that looks complete: `addClient()`
genuinely grows the Client Registry by one, the new client's credentials are genuinely
written to `localStorage`, verify correctly against the password actually used to create
them, and are provably isolated from CLIENT-0001's own credentials in both directions. 27
assertions, 0 failures. Full prior regression suite (15 files, 440+ assertions) re-run
alongside it, all still passing — this domain needed no `reload()` insertions, the same
payoff every stateless-by-design domain in this file has gotten since the Approval Gate
unification's own lesson (§4.60).

**Browser-verified live — the complete real signup flow, not a shortcut through the
engine.** Clicked through all 7 visible steps of the actual multi-step form as a genuinely
new "Sarah Whitfield" individual applicant (account type, personal details including a real
password entry with the page's own strength meter correctly showing "Strong," investment
profile, risk questionnaire, document upload, and the final consent checkboxes), then clicked
the real "Submit Application" button. Confirmed the redirect to `thank-you.html` completed
correctly, and — via direct `localStorage` inspection, not just trusting the UI transition —
that a genuinely new `CLIENT-0003` record now exists in the real Client Registry (correct
name/email/phone/`Individual Account` type; the registry's own length grew from 2 to 3) with
a real persisted credentials record containing exactly one field, a 64-character hex
`passwordHash`, and confirmed directly that the raw password string typed into the form
never appears anywhere in that persisted record. Separately, via the real
`verifyClientCredentials()` function on a different page, confirmed the new client verifies
correctly against the password actually entered, fails correctly against an unrelated wrong
password, and is completely isolated from CLIENT-0001 in both directions — while
CLIENT-0001's own seeded demo credential (`Marketswave2026!`) was independently reconfirmed
still intact and working, untouched by the new client's creation. Zero real console errors
throughout (only the same known Chrome-extension "message channel closed" artifact seen
elsewhere in this session, confirmed by its generic text and complete lack of any app
file/line attribution). The test client created during this live run, `CLIENT-0003` (Sarah
Whitfield), was left in place afterward rather than removed — no `removeClient()` exists in
this engine to clean it up, and it stands as a genuine, honest artifact of the real signup
flow working correctly end to end, the same treatment already given to the Atlas
Infrastructure Fund test product in §4.63.

### 4.65 Client Authentication, Phase 2 — real login check + session (Aug 21, 2026)

Builds directly on Phase 1's credential store (§4.64). Still does not touch
`dashboard-sidebar.js`'s `CLIENT-0001` pin — that remains Phase 3.

**Engine additions**, all built stateless-per-call from the start (no module-level cache,
mirroring the discipline the Approval Gate unification proved out at §4.60, and the same
discipline Password Reset+2FA and Client Auth Phase 1 already followed successfully — this
is now the fourth domain in a row that needed zero `reload()` retrofits in its Node tests):
- `getClientByEmail(email)` — resolves an entered email to a client record, case-insensitive
  and trimmed. Returns `null` (not a thrown error) on no match, deliberately, so
  `login.html` can fold "unknown email" and "wrong password" into one identical failure path
  without a special case at the call site.
- `setClientAuthenticated(clientId)` / `getAuthenticatedClientId()` /
  `clearClientAuthentication()` — sessionStorage-backed under a new dedicated key
  (`marketswave_authenticated_client_id`), mirroring `setAdminAuthenticated()`/
  `isAdminAuthenticated()`/`clearAdminAuthenticated()` exactly. One deliberate difference
  from the admin gate: this stores the authenticated client's own id, not just a boolean —
  unlike the admin gate (one shared passphrase, no persona to distinguish), a real client
  login has to record *which* client actually authenticated, since `login.html` doesn't yet
  feed that id anywhere else (Phase 3's job) but must still capture it correctly now.

**`login.html`**: the old "any submit redirects after a fixed delay" stub is replaced with a
real check — resolve the entered email via `getClientByEmail()`, hash the entered password
via `hashClientPassword()`, compare against that client's stored hash via
`verifyClientCredentials()`. On success: `setClientAuthenticated(clientId)`, then the
existing loading-screen/2200ms-delay/redirect-to-`dashboard.html` flow proceeds completely
unchanged. On any failure — unknown email, or a known email with the wrong password — the
exact same generic message (`"Incorrect email or password. Please try again."`) is shown in
a new inline `#login-error` banner (styled to match the page's own custom-CSS conventions,
not Tailwind — this page is in the locked public/onboarding styling boundary), with no
detail distinguishing which case occurred. `engine-core.js` is now loaded on `login.html` for
the first time (same one-line `<script>` addition Phase 1 made to `signup.html`). The
forgot-password 3-step panel is completely untouched — confirmed still functioning, not
rebuilt.

**Node-verified** (`verify-client-auth-phase2.js`, 25 assertions, 0 failures): `getClientByEmail()`
resolves correctly (case-insensitive, trimmed, `null` on no match or empty/null input);
`setClientAuthenticated()`/`getAuthenticatedClientId()`/`clearClientAuthentication()` behave
exactly like their admin-gate counterparts (sessionStorage-only, no localStorage write, no
ambient default the way `getCurrentClientId()` intentionally has); and a full login-flow
simulation (mirroring `login.html`'s own real logic) confirmed: correct credentials
authenticate; wrong password fails; unknown email fails; the two failure result objects are
byte-for-byte `JSON.stringify`-identical (`{ok:false}`, nothing else) — the generic-error
requirement checked structurally, not just "both fail"; and a client created through the real
`addClient()`/`hashClientPassword()`/`setClientCredentials()` call chain (the same one
`signup.html` calls) logs in successfully with the password set at signup, not just the
seeded `CLIENT-0001` demo account. The full 17-file regression suite (`verify-step2.js`
excluded per its pre-existing, unrelated, out-of-scope failure — see §4.62) was re-run
alongside this new file: 0 failures.

**Browser-verified live**, the full flow, via a local server: logged in as `CLIENT-0001`
with the documented demo password (`Marketswave2026!`) through the real form — succeeded,
loading screen shown, redirected to `dashboard.html`, and `sessionStorage`'s
`marketswave_authenticated_client_id` confirmed set to `CLIENT-0001` by direct inspection.
Tried the same email with a wrong password — the generic `#login-error` banner appeared,
verbatim text and styling, no page reload, submit button correctly re-enabled. Tried a
completely unknown email — the identical banner, confirmed via screenshot comparison to be
the exact same text and visual treatment as the wrong-password case, not a look-alike. Since
Phase 1's own live-tested signup client (`CLIENT-0003`, Sarah Whitfield, §4.64) never had its
raw password recorded anywhere by design (raw passwords are never persisted, even
transiently — the whole point of `hashClientPassword()`'s scoping), her real password isn't
recoverable for a login test; rather than skip this check, a fresh client (`CLIENT-0004`,
"Login Phase 2 Test") was created live in the browser through the exact same real engine call
chain `signup.html`'s own handler uses (`addClient()` → `hashClientPassword()` →
`setClientCredentials()`), then logged in through the real form with the password just set —
succeeded, redirected correctly, and `marketswave_authenticated_client_id` confirmed set to
`CLIENT-0004` by direct inspection — proving Phase 2 works for a real self-registered client,
not only the seeded demo account. Also confirmed, exactly as expected and **not** a bug: the
dashboard shown after the `CLIENT-0004` login still displays `CLIENT-0001`'s ("John Doe")
data, since `dashboard-sidebar.js`'s file-load-time pin
(`marketswave_current_client_id` → `CLIENT-0001`) is completely untouched by this phase —
`marketswave_authenticated_client_id` (who really logged in) and
`marketswave_current_client_id` (which client's data every dashboard page renders) are now
two genuinely different, independently-observed session values, and reconciling them is
explicitly Phase 3's job, not this one's. The forgot-password panel was also clicked through
live (Send Code → Verify Code step transition) and confirmed still working, unaffected. Zero
console errors throughout. The `CLIENT-0004` test client and its credentials record were left
in place afterward (no `removeClient()` exists in this engine), the same treatment already
given to `CLIENT-0003` in §4.64 and the Atlas Infrastructure Fund test product in §4.63; the
session's own login/auth state was cleared before finishing so no browser was left in a
logged-in state. Backend Requirements Register row 51.

---

## 5. Portfolio Engine Specification (User-Defined)

**Five asset classes (must sum to 100%):**
1. Private Equity  
2. Real Assets  
3. Stocks & ETFs  
4. Crypto  
5. Unallocated / Cash  

**Capital flow:**
- Initial deposit → 100% Unallocated  
- Client requests allocation → PM notifies → Approve/Reject  
- On approve: $ moves from Unallocated into asset under a class  
- Calculation engine recalculates class % and Unallocated %  
- Allocation bars update  

**Returns:**
- Tracked **separately** (do not change allocation %)  
- Table: Asset | Asset Value | Return % | Realized Amount  
- PM can edit Asset Value and Return %  

**PM role:** Approves requests, assigns $, records returns, can adjust amounts.

---

## 6. Key Files (Expected in Project Folder)

| File | Role |
|------|------|
| `index.html` + other marketing pages | Public site |
| `styles.css` | Shared public/onboarding styles |
| `login.html` | Login + Forgot Password flow |
| `signup.html` | 9-step onboarding |
| `thank-you.html` | Post-submit |
| `dashboard.html` | Portfolio Overview |
| `asset-performance.html` | Asset & Performance |
| `deploy-capital.html` | Deploy Capital |
| `documents.html` | Documents & Reporting |
| `risk-management.html` | Risk Management |
| `high-yield-savings.html` | High Yield Savings |
| `settings.html` | Settings |
| `support.html` | Support |
| `transactions.html` | Transactions (ledger, filters, drill-down modal, both charts) |
| `dashboard-sidebar.js` | Shared client sidebar (mounted into `#sidebar-mount` on all 9 dashboard pages) — also sets the client-facing `sessionStorage` context to `CLIENT-0001` at file-load time (Multi-Client Data Model Phase, Step 4, see §4.45) |
| `dashboard-common.js` | Shared live-clock logic (day/date/time in each page's header) |
| `dashboard-notifications.js` | Shared notification bell (mounted into `#notif-bell-mount`) — aggregates Documents/Allocation/Sell via `engine-core.js`, plus HYS pockets and Support requests read directly from their own (now client-scoped) `localStorage` keys. See §4.37 |
| `engine-core.js` | Shared multi-client data layer for every client-facing page and the whole admin family — Product Catalog / Client Registry (both global, unscoped) / Account State / Holdings, deterministic seeded-PRNG price ticking, allocation + sell + deposit request/approval queues, buy/sell/credit execution, transaction ledger, an independent Documents & Reporting CRUD store, and the client-scoping layer (`setCurrentClientId()`/`getCurrentClientId()`/`clientScopedKey()`) every per-client store routes through. See §4.18-§4.30, §4.34, §4.38-§4.39 (Admin Phase A), §4.41 (Admin Phase B), §4.42-§4.45 (Multi-Client Data Model) for the full phase-by-phase history |
| `admin.html` | Admin tool — Overview (pending counts across all 3 request queues) |
| `admin-deposits.html` | Admin tool — Deposits queue (credit/reject, PM-editable confirmed amount) |
| `admin-allocations.html` | Admin tool — Allocations queue (approve/reject, not PM-editable) |
| `admin-sells.html` | Admin tool — Sells queue (approve/reject, surfaces Phase 3B re-validation errors) |
| `admin-hys.html` | Admin tool — HYS Deposits queue (credit/reject, PM-editable confirmed amount, creates the actual pocket on credit) |
| `admin-settings.html` | Admin tool — the only page anywhere that calls `setAdvisoryFeeRate()` |
| `admin-documents.html` | Admin tool — Documents queue (client uploads awaiting review, Publish to Client form, cross-client History). See §4.50 |
| `admin-support.html` | Admin tool — Support/Disputes queue (Needs Attention / Resolved, status + client-visible PM note). See §4.50 |
| `admin-settings-changes.html` | Admin tool — Settings Changes queue (Pending/History, field-specific Current→Requested display, Approve confirmation modal, Reject with reason). See §4.51 |
| `admin-clients.html` | Admin tool — Client Management: every client's real balances, "View as this Client" switching, and an "Add Client" form (`addClient()`'s first real UI). Reached via the "Viewing Client" nav item under Overview. See §4.55 |
| `admin-sidebar.js` | Shared admin sidebar (mounted into `#admin-sidebar-mount` on all 9 admin pages) — deliberately separate from `dashboard-sidebar.js`, distinct persona. Renders a read-only "Viewing Client" indicator (linking to `admin-clients.html`) — the interactive selector itself moved there Aug 21, 2026, see §4.55 |
| `login-bg.jpg`, `thankyou-bg.jpg`, `signup-bg.jpg` (if used) | Backgrounds |

---

## 7. Current Step (Where We Left Off)

**Completed since this doc was last written (Aug 19, 2026, continued):**
- User confirmed the sidebar/live-clock extraction (4.16) works correctly in-browser
  ("behaves very well now") — this item can be considered browser-verified, not just
  statically verified, updating its status from the note in 4.16
- Found and fixed a `settings.html` layout bug (page scrolling far beyond visible content,
  sidebar not staying pinned) via user screenshot — see 4.17
- Merged this handover doc and `CLAUDE.md` with the chat-based Claude session's parallel
  work: added the full Backend Requirements Register (3.1, 24 items, split into in-house
  engine work vs. genuinely external data per explicit user direction — "we are building
  an engine locally for our operation, we would not be needing a lot of external APIs")
- **Corrected a false alarm:** the pie chart / allocation-input / transaction-analytics
  items had been incorrectly marked "confirmed missing" during the doc merge above. Claude
  Code verified all three directly against the live files before acting on that claim and
  found them genuinely present and working — no rebuild needed. See the correction note in
  section 2.1. No remaining blocker before engine work.
- **User decision on sequencing (Aug 19, 2026):** rather than a dedicated polish/audit
  sweep across all pages, continue catching bugs reactively (as has been working — every
  bug so far was caught via user screenshot, not a scheduled audit) and prioritize
  structural work with real leverage (like the sidebar extraction) over the engine when it
  reduces integration risk. Explicit user framing: build the engine in-house, minimize
  external API dependency.

**Immediate next steps, in order:**
1. **Portfolio engine design** (data model + calculation rules, section 5) — the next
   major phase, with no remaining blockers now that the false-alarm gap is resolved
2. A manual click-through of `high-yield-savings.html`, `risk-management.html`, and
   `support.html` is still outstanding (only `settings.html` and the sidebar extraction
   have been user-verified since the no-auto-verify convention took effect) — lower
   priority than the engine given the reactive-bugfinding approach that's been working, but
   worth doing before the engine starts depending on any of these pages' data shapes

**Build order — dashboard family complete, engine is next major phase:**
1. ~~Documents & Reporting~~ ✅ Done
2. ~~Risk Management~~ ✅ Done
3. ~~High Yield Savings~~ ✅ Done
4. ~~Settings~~ ✅ Done (incl. layout bug fix, 4.17)
5. ~~Support~~ ✅ Done
6. ~~Shared sidebar/live-clock extraction~~ ✅ Done, user-verified in-browser
7. ~~Pie chart / allocation input / transaction analytics~~ ✅ Confirmed already present (false alarm) — no rebuild needed
8. Portfolio engine design (data model + calculation rules) — next, no remaining blockers


- Built `documents.html` — Documents & Reporting hub, complete per spec (see 4.11)
- Added the Documents & Reporting sidebar link + notification badge to `dashboard.html`,
  `asset-performance.html`, `transactions.html`, and `deploy-capital.html`
- Verified interactively in-browser; fixed a live-query bug found during that testing (see 4.11)
- Built `risk-management.html` — Risk Meter + Regulatory Heatmap, complete per spec (see 4.12)
- Updated the Risk Management sidebar link on `dashboard.html`, `asset-performance.html`,
  `transactions.html`, `deploy-capital.html`, and `documents.html` to point to the new page
- Verified interactively in-browser, no console errors
- Revised `risk-management.html`: swapped Time Horizon for a Portfolio Diversification Score
  card, and made the Risk Meter interactive with a Conservative/Balanced/Aggressive preview
  control (frontend-only, not persisted, with a reset back to the actual current level — see
  4.12)
- Added a "Save as My Risk Profile" flow to `risk-management.html`'s preview control:
  persists the chosen level to `localStorage` (`marketswave_risk_profile`), updates the
  "Current Profile" pill and bolded axis label, shows a confirmation toast, and reads the
  saved value back on page load (defaulting to Balanced if none stored)
- User added a new working convention: do not launch a browser/dev server to verify changes
  unless explicitly asked — describe the change and let the user check it themselves; ask
  first if verification feels genuinely warranted. Added to both `CLAUDE.md` and this doc
  (see Working Agreement below).
- Built `high-yield-savings.html` — a savings pool fully separate from the main portfolio,
  with My Pockets (Fixed Deposit / As You Want), a New Pocket modal wizard, a state-branching
  Withdraw modal, and `localStorage` persistence, complete per spec (see 4.13). Updated the
  "High Yield Savings" sidebar link on all six other dashboard pages to point here. **Not
  verified in-browser**, per the new no-auto-verify convention — flagged in 4.13 as worth a
  manual click-through given its size and state-machine complexity.
- Added Risk Capacity suitability chip + Portfolio Diversification "Projected" line to
  `risk-management.html` (previewed-tolerance-vs-fixed-capacity ordinal check; reference
  model mixes per level), both wired into the existing preview render cycle
- Overhauled the three `risk-management.html` breakdown cards to one consistent pattern:
  un-froze Risk Tolerance (now always shows the previewed level's description), simplified
  the Diversification card to a single delta line, and — while doing so — found and fixed a
  real bug where that delta line compared against a hardcoded `'balanced'` instead of the
  actual saved level; also hardened the Save handler to explicitly re-render every dependent
  piece of state in one pass (see 4.12)
- Replaced `risk-management.html`'s gradient bar + separate toggle buttons with a single
  gold/mahogany-and-deep-green sliding-pill segmented control, scoped to that one control
  only via `.rm-*` classes — explicitly not applied elsewhere (see 4.12)
- Built `settings.html` — Profile/KYC card (inline-editable Email/Phone, Request-Change
  modal for read-only fields), Security section (password change reusing `signup.html`'s
  strength/match logic, 2FA stub setup flow, Active Sessions list), Compliance/Audit Badges
  (display-only), and Notification Preferences (Email/SMS toggles for the same four triggers
  documents.html already surfaces), complete per spec (see 4.14). Updated the "Settings"
  sidebar link on all seven other dashboard pages to point here. **Not verified in-browser**,
  per the no-auto-verify convention.
- Revised `settings.html`: removed the Compliance & Audit Badges section entirely, and
  removed the SMS toggle column from Notification Preferences (Email-only now); cleaned up
  the now-dead `sms` keys in the JS defaults (see 4.14)
- Built `support.html` — the final page in the locked sidebar menu, completing the dashboard
  family. Quick Contact row (Call Us callback modal, Chat with Us live-feeling panel with
  timed connect + canned replies, Email Support copy-to-clipboard), Open a Dispute form
  feeding into a unified, click-to-expand, `localStorage`-persisted My Requests list seeded
  with 3 demo entries, complete per spec (see 4.15). Updated the "Support" sidebar link on
  all eight other dashboard pages — the last remaining `href="#"` sidebar link in the whole
  dashboard family is now gone. **Not verified in-browser**, per the no-auto-verify
  convention.

**Completed previous session (Aug 18–19, 2026):**
- Bank Transfer form on `deploy-capital.html` expanded per spec (see 4.9)
- `transactions.html` reviewed and tightened: filters made functional, accessibility gaps fixed (see 4.10)
- Full spec audit completed against original `USER_FLOW.docx` and `MARKETSWAVE_SITE_MAP.docx` (see 2.1) — two live bugs found and fixed (dead Deploy Capital button on Asset & Performance; login "Back to site" link styling mismatch)

**Immediate focus going forward — see the updated version at the top of this section
(§7) for the current, resolved state.** (This block is kept as a historical record of
what was still open at the point this doc was originally written, before the merge with
the chat-based Claude session's parallel work: item 1's pie-chart-vs-bars question and
item 2's spec-gap list were briefly, incorrectly flagged as a missing-files issue during
that merge — corrected same-day after Claude Code verified the live files directly and
found all three genuinely present; see the correction note in §2.1. Item 3's
manual-click-through need is still accurate for `high-yield-savings.html`,
`risk-management.html`, and `support.html`; `settings.html` and the sidebar extraction
have since been user-verified. Item 4 has been decided: sidebar extraction done,
portfolio engine is next with no remaining blockers.)

**Build order — dashboard family complete, see the updated version at the top of §7 for
current next steps:**
1. ~~Documents & Reporting~~ ✅ Done (Aug 19, 2026)
2. ~~Risk Management~~ ✅ Done (Aug 19, 2026)
3. ~~High Yield Savings~~ ✅ Done (Aug 19, 2026)
4. ~~Settings~~ ✅ Done (Aug 19, 2026), incl. layout bug fix (4.17)
5. ~~Support~~ ✅ Done (Aug 19, 2026) — every item in the locked sidebar order now has a page
6. ~~Shared sidebar/live-clock extraction~~ ✅ Done, user-verified in-browser
7. ~~Pie chart / allocation input / transaction analytics~~ ✅ Confirmed already present (false alarm)
8. Portfolio engine design — next, no remaining blockers

**Working agreement established with user (Aug 18, 2026):**
- Delivery format: small/targeted edits → Find & Replace snippets; large structural rewrites → full file. Always flagged which one is being given.
- Claude proceeds from this handover doc as source of truth rather than re-confirming scope each session, flagging assumptions inline.
- Claude updates this handover doc after each significant session.
- Locked/do-not-touch: 9-step onboarding structure, 5-asset-class portfolio engine rules, sidebar menu order and Deploy Capital button position, custom CSS (public/onboarding) vs Tailwind (dashboard) stack boundary.
- Known structural debt: sidebar markup and live-clock script duplication — **resolved
  (Aug 19, 2026)**. Extracted into `dashboard-sidebar.js` (renders the sidebar into
  `#sidebar-mount`, called via `initDashboardSidebar('<page-key>')`) and
  `dashboard-common.js` (live clock), wired into all 9 dashboard pages. See §4.16 below for
  the full writeup, including a real dead-link bug the extraction caught and fixed along the
  way. Not a git repo, so there was nothing to commit beforehand per the user's ask — flagged
  to the user in the summary.
- **New known structural debt, not yet resolved (Aug 21, 2026):** HYS rate/term
  duplication — `high-yield-savings.html`'s client-facing rate preview
  (`SHORT_TERM_BRACKETS`/`LOCKED_RATES`) and `engine-core.js`'s independently-derived rate
  logic (`HYS_SHORT_TERM_BRACKETS`/`HYS_LOCKED_RATES`, used by `creditHYSDeposit()`) are two
  separate copies of the same rate schedule, kept deliberately separate so the engine never
  trusts a client-computed money figure — correct behavior, but the two copies can silently
  drift if a rate ever changes and only one gets updated. Not urgent, not a bug. Recommended
  fix: make `engine-core.js` the single source of truth, have the client-side preview call
  into the engine instead of keeping a parallel copy. Recommended timing: after the current
  admin-tool build-out (the nine-item batch following the Multi-Client Data Model phase) is
  complete, as a dedicated cleanup pass rather than squeezed into feature work. See §3.1
  register row 34 for the full entry.
- Presentation and functionality move together: no decorative-only controls going forward — if something looks interactive (filter, tab, button), it should do something or be clearly marked as pending backend.
- **Verification (added Aug 19, 2026):** do not launch a browser, dev server, or any
  visual/interactive verification step after making changes, unless explicitly asked to.
  Describe what changed and let the user check it themselves. If verification feels
  genuinely warranted (e.g. a JS bug not confident is fixed), ask first rather than doing
  it. This reverses the prior default (used through `documents.html`, `risk-management.html`
  initial build/revision) of always spinning up a local server + Chrome automation after
  every change.
- **In-house engine preference (added Aug 19, 2026):** "we are building an engine locally
  for our operation, we would not be needing a lot of external APIs" — default to
  building portfolio/allocation/notification/document logic as an in-house engine rather
  than reaching for third-party services. Reserve external integration for genuinely
  external data (real-world market prices, blockchain confirmation, currency exchange
  rates) — see §3.1's split table.
- **Backend Requirements Register (added Aug 19, 2026):** log every new frontend-only stub
  in §3.1 the same session it's built, not retroactively — don't let new deferred-backend
  items go untracked.
- **Sequencing decision (Aug 19, 2026):** rather than a dedicated polish/audit sweep across
  all pages, keep catching bugs reactively as they're used (this has worked well so far —
  every bug found this session was caught via user screenshot, not a scheduled audit).
  Structural work with real leverage (like the sidebar extraction) gets prioritized
  ahead of the portfolio engine when it reduces engine-integration risk; cosmetic polish
  does not get a dedicated phase.
- **Verify against live files before acting on doc claims (added Aug 19, 2026):** a
  documentation claim — that something is missing, broken, or present — should be checked
  against the actual file before it drives real work, especially anything destructive like
  a rebuild. This doc itself briefly, incorrectly claimed the pie chart / allocation input /
  transaction analytics were missing during a merge; Claude Code caught the error by reading
  the live files directly before acting on it. See the correction note in §2.1.

---

## 8. Suggested Chat Areas for Pruning

These sections of conversation history are safe to drop or summarize heavily to free context:

1. **Repeated button-size / width matching iterations** (Get Access vs Contact)  
2. **Multiple hero overlay darkness / image background size discussions**  
3. **Early full-file zip delivery confusion** and “stop sending files” corrections  
4. **Duplicate/orphaned HTML field leakage fixes** on signup (Primary Source of Wealth appearing on wrong steps)  
5. **Icon preference back-and-forth** for Deploy Capital (plus → lightning → paper plane → wallet)  
6. **Long intermediate CSS paste blocks** that were later superseded  
7. **Tailwind vs custom CSS debate** once decision was locked (custom for public/onboarding, Tailwind for dashboard)  
8. **Early single-page template analysis** once multi-page structure was established  

**Keep intact:**
- Final 9-step onboarding structure  
- Portfolio engine rules (5 classes + capital flow + returns)  
- USER FLOW document requirements  
- Sidebar final menu  
- Booked backend/API items  
- Current Deploy Capital bank-form requirements  

---

## 9. Recommended Forward Path

| Order | Item | Status |
|-------|------|--------|
| 1 | Bank Transfer form on `deploy-capital.html` | ✅ Done |
| 2 | Transactions page (base build) | ✅ Done |
| 3 | Documents & Reporting | ✅ Done |
| 4 | Risk Management | ✅ Done |
| 5 | High Yield Savings | ✅ Done |
| 6 | Settings | ✅ Done |
| 7 | Support | ✅ Done |
| 8 | Shared sidebar/live-clock extraction | ✅ Done, user-verified |
| 9 | Pie chart / allocation input / transaction analytics | ✅ Confirmed already present — false alarm, no rebuild needed |
| 10 | Portfolio engine (data model + calculation rules) | ⬜ Next — no remaining blockers |
| 11 | Manual click-through: `high-yield-savings.html`, `risk-management.html`, `support.html` | ⬜ Lower priority than #10 |
| 12 | Design gap pass across marketing + onboarding | ⬜ Deprioritized — reactive bugfinding preferred over a dedicated sweep |
| 13 | Backend build-out (see §3.1 register) | ⬜ Deferred, in-house-first |

---

## 10. Handover Checklist for Next Session

- [ ] Confirm all listed HTML files exist in `C:\WorkDirectory\Marketswave`
- [ ] Confirm Deploy Capital button correctly links to `deploy-capital.html` on dashboard and asset-performance
- [ ] Expand Bank form with the exact fields listed above
- [ ] Keep sidebar Deploy Capital position unchanged
- [ ] Treat market data + currency converter + password-reset backend as deferred
- [ ] Use Find & Replace / full-block style preferred by user
- [ ] Preserve 5 asset-class model and “returns tracked separately” rule

---

## 11. One-Line Status Summary

**Note (Aug 21, 2026): this section had gone stale** (it still said "Next: portfolio engine
design" after the engine, the admin tool, and the multi-client model had all since shipped)
— same drift problem the "Current status" section in `CLAUDE.md` already flagged for itself.
Updated below rather than left wrong; if this happens again, prefer the Tech Stack log in
`CLAUDE.md` and section 4 of this doc as the actual current source of truth, and treat any
one-line summary as a snapshot that decays.

**The full locked dashboard sidebar menu, the in-house portfolio engine, the admin/Portfolio
Manager tool, and a genuinely multi-client data model are all built and verified.** All 9
client dashboard pages are built and spec-verified; shared sidebar/live-clock/notification-
bell extraction is done. `engine-core.js` covers Product Catalog, deterministic price
ticking, allocation/sell/deposit request queues with approve/reject mechanics, transaction
ledger, and a Documents & Reporting store — wired live into every client page (§4.18-§4.39).
The admin tool (`admin.html` + 4 queue/settings pages, Aug 20, 2026, §4.41) gives a
Portfolio Manager persona a real approve/reject UI for all three request queues, visually
unmistakable from the client site, no login gate yet (deferred by design). The Multi-Client
Data Model (Aug 21, 2026, §4.42-§4.45) makes the engine genuinely multi-tenant: a Client
Registry, every per-client store scoped and migrated losslessly, an admin client selector,
and an isolation proof **run for real in the browser** — which caught and fixed a real
same-tab data-corruption bug that 99+20 passing Node assertions alone hadn't caught,
underscoring why the live run mattered, not just the simulated one. Since then: a full HYS
Deposit Approval Queue (§4.46-§4.47, request→credit/reject→pocket-creation, `admin-hys.html`,
COMPLETE) and a Request Change redesign for `settings.html` (§4.48-§4.49) replacing four
100%-hardcoded profile fields with real per-client storage, a genuine request/approve queue,
and a field-shaped modal UI — both checkpoints (data model, then client UI) Node- and
browser-verified. Most recently: `admin-documents.html` and `admin-support.html` (§4.50,
COMPLETE) give PMs a real cross-client queue for reviewing client document uploads/
publishing new documents, and for updating support tickets with a client-visible response —
both Node-verified (34 new + 220 prior regression assertions, 254 total) and browser-
verified end to end, including confirming a published document lands correctly and isolated
on a second client via direct `localStorage` inspection (client-facing pages always resolve
to `CLIENT-0001` in this build, so they can't be viewed "as" another client directly). Most
recently, `admin-settings-changes.html` (§4.51, COMPLETE) closes out the three-queue admin
batch — Pending/History for client profile change requests, reusing `settings.html`'s own
field-specific display formatting, an Approve confirmation modal, and Reject with reason.
Node-verified (278 total assertions) and browser-verified end to end: a client-submitted
Legal Name change, approved from admin, genuinely shows the new name on the client's own
`settings.html` afterward. **All three originally-speced admin queues (Documents, Support,
Settings Changes) are now complete.** Most recently (§4.52): the Settings Change queue was
renamed "Client Profile Updates" (display label only, across the page/nav/Overview card —
no identifier renames); Date of Birth was removed as a requestable field from `settings.html`
and `engine-core.js`'s validation, after first confirming and reporting the one pre-existing
pending `dateOfBirth` request in test data (`SETTING-0002`) rather than deleting it —
`admin-settings-changes.html` deliberately kept its own `dateOfBirth` display support so that
record (and any other legacy one) stays visible and resolvable; and the client selector was
measured at 50 test clients (added, measured, then removed) with no measurable slowdown,
reported as a forward-looking concern for the separately-speced redesign rather than an
urgent one. 282 total assertions, 0 failures. Most recently (§4.53): the admin nav was
reorganized into three explicitly data-driven groups — Approval Gate, User/Admin Relations,
Portfolio Administration — via a new `group` field on every `NAV_ITEMS` entry and a `GROUPS`
array defining labels/order, specifically so a future tool (Product Catalog management was
named as the concrete example) is added with one tagged entry rather than by re-arranging
section boundaries by hand. Overview's card grid mirrors the same three groups; Settings'
card shows the live advisory fee rate in place of a pending count, since it isn't a queue.
No engine changes; full 282-assertion suite unaffected; browser-verified that every nav link
still resolves, active-page highlighting still works, the queue pages' own content is
completely untouched, and Overview's cards render grouped to match. Then (§4.54):
`admin-documents.html` gained a "Download" button on every client-uploaded document row
(pending list + a new History action column), matching `documents.html`'s own existing
"Download" stub exactly — a toast, since no real file bytes exist anywhere in this project,
only filenames. A 7th History column overflowed the card; fixed with `overflow-x-auto`,
scoped to this one file. No engine changes; browser-verified correct toast/filename from
both locations, zero console errors. Most recently (§4.55): the "Viewing Client" selector
moved out of the shared sidebar entirely, into a new dedicated page,
`admin-clients.html`, reached via a nav tab positioned directly under Overview. The new page
lists every client's real balances (`getAccountState(clientId?)`/
`getTotalPortfolioValue(clientId?)` gained an optional clientId, mirroring
`getSettingsProfile(clientId?)`'s pattern, reading any client's storage on demand without
switching the active session), keeps "View as this Client" working exactly as the old
dropdown did, and adds a real "Add Client" form — closing the previously-tracked
console-only `addClient()` gap (row 32). The sidebar keeps only a read-only indicator now.
295 total assertions, 0 failures; browser-verified end to end including a real client
created and then cleaned up after verifying. Most recently (§4.56): the same page was
redesigned per an exact spec — live search (name or id), single-select account-type filter
pills (All/Individual/Joint/Business — Account Type became a real 3-option select instead of
free text so the pills have well-defined values to match), a 4-column table (Client, Type
badge, Portfolio Value, expand indicator), and in-place row expansion showing email,
client-since date, a live per-client Approval Gate pending count (new
`getClientPendingApprovalCount(clientId)`, summing Deposits+Allocations+Sells+HYS+Client
Profile Updates), and "View as this Client" (now only reachable once a row is expanded, no
longer a permanent per-row button). The nav icon was also swapped for a single-person "user"
icon, unambiguously distinct from Overview's house icon. 321 total assertions (12 new for
the pending-count aggregation, 14 new for search/filter logic against a 5-client test set),
0 failures; browser-verified end to end including a real "Acme Holdings LLC" (Business)
client created via the new modal, found by the Business filter, and removed after verifying.
Most recently (§4.57): the sidebar's nav item and its own persistent "VIEWING CLIENT"
indicator both said "Viewing Client," reading as the same element twice — the nav item was
renamed "Client Management" (`key`/`href` unchanged, so highlighting/routing needed no code
changes), and the indicator gained a real `border-b` + spacing so it visibly separates from
the nav list rather than blending into its first item. Purely cosmetic, no engine changes;
browser-verified on two pages. Most recently (§4.58): that same indicator was removed
entirely, same day — an explicit decision that Client Management is now the sole place a PM
sees/changes which client is active, not something surfaced ambiently on every page.
`setCurrentClientId()`/`getCurrentClientId()` and the real switching mechanism were
untouched; only the display block and its own lookup logic were removed, with no orphaned
code left behind (confirmed via a project-wide grep). Browser-verified on 3 pages — no gap
where the indicator used to sit, switching re-confirmed via `getCurrentClientId()` directly.
Most recently (§4.59): Overview and the "Client List" nav item (renamed again, same day,
from "Client Management" — third label in one day) both joined a new "Dashboard" group,
positioned first, rendering through the exact same group-header system every other group
uses (no new rendering logic needed). A subtle single-line "Viewing: &lt;name&gt; ·
&lt;id&gt;" indicator was re-added — deliberately much lighter than the block removed in
§4.58 (no heading, no card, no border), sitting above the Dashboard group and updating
correctly on every client switch. Full 321-assertion suite unaffected; browser-verified the
Dashboard header is pixel-identical to the other three, and the indicator updates correctly
after a real switch.

**Next**: further client-selector UX work at higher client counts (the §4.52 perf report
found no slowdown at 50 clients, and this redesign already added search/filter, so this
remains non-urgent). Longer-term: a real backend so admin actions and multi-client data
persist beyond this browser's `localStorage`, and a real login/auth system determining which
client a given user actually is (which the admin tool's own login gate also depends on). A
manual click-through of a few pages' more obscure states remains lower-priority
housekeeping. Backend and genuinely-external data sources (market prices, exchange rates,
blockchain confirmation) remain explicitly deferred, per §3.1's Backend Requirements
Register.

---

*End of handover document. This is the single source of truth for Marketswave work completed in this chat.*
