// engine-core.js — Portfolio Engine.
//   Phase 1: shared data layer (Product Catalog / Account State / Holdings).
//   Phase 2: NAV-tick returns engine (deterministic per-tier price movement, lazy
//            day-by-day catch-up, advisory fee accrual, unrealized-return preview reads).
//   Phase 3: transaction mechanics (allocation request queue with a request/approve gate on
//            the buy side, buy/sell execution primitives, transaction ledger).
//   Phase 3B: sell request queue — mirrors Phase 3's allocation request/approve pattern for
//             the sell side, with re-validation against the current holding at approval time.
//   Documents & Reporting (Aug 20, 2026): a separate, independent CRUD store for
//             documents.html's data (not portfolio/financial logic) — migrated here purely
//             to centralize storage the same way products/holdings/transactions already are.
//   Admin tool Phase A (Aug 20, 2026): deposit request queue — mirrors the allocation/sell
//             request/approve pattern for money coming INTO the account (Deploy Capital),
//             with a PM-confirmed credited amount that may differ from what the client
//             requested. Engine layer only — no page wires to this yet; that's Phase B.
//   Admin tool Phase B (Aug 20, 2026): PM-facing approve/reject UI for all three request
//             queues, wired into a new admin.html page family — no engine-core.js changes,
//             UI only.
//   Multi-Client Data Model Phase, Step 1 (Aug 21, 2026): Client Registry — a new global,
//             unscoped store (like the Product Catalog) listing every client account. Seeded
//             with the existing single-tenant demo user as CLIENT-0001.
//   Multi-Client Data Model Phase, Step 2 (Aug 21, 2026): every per-client store (account
//             state, holdings, transactions, allocation/sell/deposit requests, documents —
//             plus risk profile/settings/notifications-read/HYS pockets/support requests,
//             owned by other pages but migrated here since this is the one script guaranteed
//             to load first) is now actually scoped per client via clientScopedKey(), not
//             implicitly shared. One-time migration copies each old unscoped key's data to
//             its CLIENT-0001-scoped equivalent and deletes the old key. Product Catalog and
//             Client Registry remain global/unscoped by design.
//   Multi-Client Data Model Phase, Steps 3-5 (Aug 21, 2026): addClient() now seeds a
//             genuinely fresh, isolated new client (seedMinimalClientStores() — empty
//             holdings/ledger/every request queue, only a modest starting cash balance) —
//             UI-side changes (admin selector, client-facing default context) live in
//             admin-sidebar.js/dashboard-sidebar.js, not here.
//   HYS Deposit Approval Queue (Aug 21, 2026): requestHYSDeposit()/creditHYSDeposit()/
//             rejectHYSDeposit()/getHYSDepositRequests() — mirrors the regular deposit
//             queue's request/approve discipline against a PARALLEL store (not an extension
//             of marketswave_deposit_requests — see the HYS_DEPOSIT_REQUESTS_KEY comment
//             below for why). creditHYSDeposit() is the first engine code to ever touch
//             high-yield-savings.html's own pocket store.
//   Request Change redesign, Step 1 of 2 — data model (Aug 21, 2026): replaces
//             marketswave_settings_pending (field-name strings only) with a real request
//             queue (marketswave_settings_change_requests) for legalName/dateOfBirth/
//             address/idDocument — currentValue snapshotted automatically from a real,
//             newly-added per-client profile store (previously these four fields were 100%
//             hardcoded static HTML with no storage location at all). Cross-client by
//             design (approve/reject take an explicit clientId) since a future admin page
//             will list requests from every client, not just whichever one is selected —
//             that admin UI itself is Step 2, deliberately held until this data model ships.
//   Request Change redesign, Step 2 of 2 — client UI (Aug 21, 2026): settings.html rebuilt
//             to read/display all four fields from getSettingsProfile() live, with a
//             field-specific Request Change modal (separate First/Last, native date input,
//             five address inputs, document type + real file input). No engine changes.
//   Documents + Support admin queues (Aug 21, 2026): cross-client aggregation/mutation
//             functions for admin-documents.html and admin-support.html — getAllClientDocuments()/
//             updateDocumentForClient()/publishDocumentToClient() (mirrors the explicit-clientId
//             pattern from Settings Change requests), and getAllClientSupportRequests()/
//             updateSupportRequestForClient() (an ADMIN-ONLY addition touching the same raw
//             marketswave_support_requests key — support.html's own client-side read/write of
//             its own store is untouched, still not a full migration into this file).
//   Settings Change admin queue (Aug 21, 2026): getAllClientSettingsChangeRequests() — the
//             cross-client listing reader deliberately held back in Step 1 (approve/reject
//             already took an explicit clientId from the start). Closes out the three-queue
//             admin batch alongside Documents + Support above.
//   Client Management page (Aug 21, 2026): getAccountState(clientId?)/
//             getTotalPortfolioValue(clientId?) gained an optional clientId, mirroring
//             getSettingsProfile(clientId?)'s pattern, so admin-clients.html can show every
//             client's real balance without switching the active session context. The
//             "Viewing Client" switcher moved out of the shared admin sidebar (every page)
//             into this one dedicated page, alongside a real "Add Client" form
//             (addClient() was previously console-only).
//   Client Management page redesign (Aug 21, 2026, same day): getClientPendingApprovalCount()
//             — one new function summing pending items across exactly the 5 Approval Gate
//             queues for an arbitrary client, reading each store's raw scoped key directly
//             (same on-demand, no-session-switch discipline as getAccountState(clientId?)).
//             Search/filter pills/row-expand are page-local UI, no further engine changes.
//   Client Authentication, Phase 2 (Aug 21, 2026): real login check + session, on top of
//             Phase 1's credential store. getClientByEmail(email) resolves an entered email to
//             a clientId (null on no match, not an error — login.html folds "unknown email"
//             and "wrong password" into one identical generic failure). setClientAuthenticated
//             (clientId)/getAuthenticatedClientId()/clearClientAuthentication() are
//             sessionStorage-backed, mirroring setAdminAuthenticated()/isAdminAuthenticated()/
//             clearAdminAuthenticated() exactly. login.html now performs a real credential
//             check; dashboard-sidebar.js's CLIENT-0001 pin is still untouched (Phase 3).
//
// This is the foundational data model every later engine phase (allocation requests, PM
// approval, transaction feed, etc.) will build on. Both phases so far deliberately do NOT
// wire this into any page's UI — dashboard.html, asset-performance.html, transactions.html,
// and every other dashboard page still render their own static demo numbers. This file only
// creates/seeds/ticks the data model, plus a console-only inspector.
//
// Intended to eventually be loaded the same way as dashboard-sidebar.js
// (`<script src="engine-core.js"></script>`), but that inclusion is NOT done yet — see
// CLAUDE.md / the handover doc for when a later phase wires it into the pages.
//
// Public globals (bare, no namespace object — matches dashboard-sidebar.js's convention):
//   getProduct(id), getAllProducts() — defensive-copy reads (Aug 21, 2026 fix)
//   addProduct(product) — validates all fields incl. a positive starting unitPrice
//   editProduct(id, patch) — name/assetClass/investmentType/riskTier/minimumInvestment only;
//   unitPrice/id/createdAt/lastTickDate/inceptionUnitPrice are blocked, throws if attempted
//   getAccountState(clientId?), getHoldings(), getTotalPortfolioValue(clientId?)
//   settleProduct(id), settleAllProducts()
//   getAdvisoryFeeAccrued(periodDays), setAdvisoryFeeRate(newRate)
//   getUnrealizedReturn(productId), getUnrealizedReturnPercent(productId),
//   getTotalUnrealizedReturns()  — pure reads, nothing persisted
//   requestAllocation(productId, dollarAmount) — ambient (client-facing)
//   approveAllocationRequest(clientId, requestId), rejectAllocationRequest(clientId, requestId, reason)
//     — explicit clientId (Aug 21, 2026, Approval Gate unification — see below)
//   getAllocationRequests() — ambient reader; getAllClientAllocationRequests() — cross-client
//   executeBuy(clientId, productId, dollarAmount), executeSell(clientId, productId, unitsToSell)
//     — explicit clientId, no fallback to getCurrentClientId() anywhere in this pair
//   requestSell(productId, unitsToSell) — ambient (client-facing)
//   approveSellRequest(clientId, requestId), rejectSellRequest(clientId, requestId, reason)
//     — explicit clientId
//   getSellRequests() — ambient reader; getAllClientSellRequests() — cross-client
//   requestDeposit(method, amount, currency, details) — ambient (client-facing)
//   creditDepositRequest(clientId, requestId, confirmedAmount),
//   rejectDepositRequest(clientId, requestId, reason) — explicit clientId
//   getDepositRequests() — ambient reader; getAllClientDepositRequests() — cross-client
//   requestHYSDeposit(pocketType, term, amount, method, details) — ambient (client-facing)
//   creditHYSDeposit(clientId, requestId, confirmedAmount),
//   rejectHYSDeposit(clientId, requestId, reason) — explicit clientId
//   getHYSDepositRequests() — ambient reader; getAllClientHYSDepositRequests() — cross-client
//   ---- Approval Gate unification (Aug 21, 2026): Deposits/Allocations/Sells/HYS Deposits
//   now match Documents/Support/Client Profile Updates' cross-client pattern. The approve/
//   reject/credit functions above and executeBuy()/executeSell() take an explicit clientId
//   and read/write ONLY that client's scoped storage directly (never the ambient module-
//   level accountState/holdings/transactions/*Requests arrays, and never getCurrentClientId()
//   at any layer) — see the CLAUDE.md Tech Stack entry for the full call-chain trace this
//   fixed. The no-arg ambient getters (getAllocationRequests() etc.) and the client-facing
//   request*() functions are UNCHANGED — asset-performance.html/high-yield-savings.html/
//   admin.html's Overview cards still call them exactly as before.
//   getSettingsProfile(clientId?), requestSettingsChange(field, requestedValue, reason),
//   approveSettingsChangeRequest(clientId, requestId),
//   rejectSettingsChangeRequest(clientId, requestId, resolutionNote),
//   getSettingsChangeRequests()
//   getTransactionLedger() — ambient reader; getTransactionForClient(clientId, txnId) — explicit
//   getDocuments(), getDocument(id), addDocument(doc), updateDocument(id, patch),
//   updateDocumentStatus(id, newStatus), removeDocument(id), getDocumentNotificationCounts()
//   getAllClientDocuments(), updateDocumentForClient(clientId, docId, patch),
//   publishDocumentToClient(clientId, { filename, category, signatureRequired?, dueDate? })
//   getAllClientSupportRequests(), updateSupportRequestForClient(clientId, requestId, patch)
//   getAllClientSettingsChangeRequests()
//   ---- Password Reset + 2FA Rework (Aug 21, 2026): built cross-client from the start,
//   using the same explicit-clientId, no-module-cache discipline the Approval Gate
//   unification proved out — see that section's own note above.
//   resetClientPassword(clientId, reason), resetClient2FA(clientId, reason) — explicit
//   clientId, admin-triggered, both require a non-empty reason
//   getSecurityActionsLog() — global (not per-client) audit trail, every reset ever performed
//   getClientSecurityState(clientId?) — ambient by default (client-facing settings.html);
//   clearForcePasswordReset() — ambient only, called by the client's own forced-reset form
//   getClientPendingApprovalCount(clientId)
//   getAllClients(), getClient(id), getClientByEmail(email), addClient(client)
//   ---- Client Authentication, Phase 1 (Aug 21, 2026): credential storage — does NOT touch
//   dashboard-sidebar.js's CLIENT-0001 pin (Phase 3).
//   hashClientPassword(rawPassword) — async, the only place a raw password briefly exists
//   setClientCredentials(clientId, passwordHash), verifyClientCredentials(clientId, passwordHash)
//   getCurrentClientId(), setCurrentClientId(id), clientScopedKey(baseKey)
//   ---- Client Authentication, Phase 2 (Aug 21, 2026): real login check + session — see the
//   phase-log entry above. login.html's own submit handler now calls these for real.
//   setClientAuthenticated(clientId), getAuthenticatedClientId(), clearClientAuthentication()
//   ---- Admin Login Gate (Aug 21, 2026): UI-level stub, not real authentication — see the
//   comment above ADMIN_PASSPHRASE for the full honesty callout.
//   checkAdminPassphrase(input), setAdminAuthenticated(), isAdminAuthenticated(),
//   clearAdminAuthenticated() — sessionStorage-backed, same pattern as
//   getCurrentClientId()/setCurrentClientId()
//   engineDebugDump()  — console-only, manual verification, no page should call this
(function () {
  const CATALOG_KEY = 'marketswave_product_catalog';
  const ACCOUNT_KEY = 'marketswave_account_state';
  const HOLDINGS_KEY = 'marketswave_holdings';
  const REQUESTS_KEY = 'marketswave_allocation_requests';
  const TRANSACTIONS_KEY = 'marketswave_transactions';
  const SELL_REQUESTS_KEY = 'marketswave_sell_requests';
  const DEPOSIT_REQUESTS_KEY = 'marketswave_deposit_requests';
  // Moved up from its old position further down the file (Multi-Client Data Model Phase,
  // Step 2, Aug 21, 2026) — needs to be visible to the migration sweep below, which runs
  // before the Documents store's own load-or-seed block does.
  const DOCUMENTS_KEY = 'marketswave_documents';
  // Multi-Client Data Model Phase, Step 1 (Aug 21, 2026): global, unscoped by design — every
  // client shares one registry, same reasoning as the Product Catalog being global rather
  // than per-client.
  const CLIENTS_KEY = 'marketswave_clients';
  // Step 2: sessionStorage (not localStorage) so it resets per browser session rather than
  // persisting forever — a stale "you're viewing CLIENT-0007" from a week-old session isn't
  // something either persona should silently inherit.
  const CURRENT_CLIENT_SESSION_KEY = 'marketswave_current_client_id';
  const DEFAULT_CLIENT_ID = 'CLIENT-0001';
  // Client Authentication, Phase 1 (Aug 21, 2026) — a dedicated, separate per-client store,
  // not folded into marketswave_settings_profile: credentials are a distinct
  // security-sensitive concern from profile data (name/address/etc.), and a dedicated key
  // means credential-verification code never has to read through — or risk being near — an
  // object that page-level UI code freely spreads/displays. Holds only { passwordHash } —
  // the raw password itself is never written here or anywhere else; see hashClientPassword()
  // below for the one place a raw password briefly exists at all, and why it can't outlive
  // that single call.
  const CLIENT_CREDENTIALS_KEY = 'marketswave_client_credentials';
  // Precomputed SHA-256 hex digest of the demo password 'Marketswave2026!' — the actual
  // plaintext credential for CLIENT-0001, reported here (and in the docs) exactly because
  // this is a known, intentional demo/testing credential, not a real user's password; a real
  // user's password is never written to a comment, a log, or any variable that outlives its
  // one hashing call (see hashClientPassword()). This value is PRECOMPUTED, not generated by
  // calling hashClientPassword() at seed time, because Web Crypto's crypto.subtle.digest() is
  // async-only (returns a Promise) while every other store in this file seeds synchronously
  // inside this IIFE — introducing an async seeding path for one store would be a much
  // larger architectural change than "Phase 1: credential storage + signup wiring" asked for.
  // Verified to match crypto.subtle.digest('SHA-256', ...) on that exact string byte-for-byte
  // before being hardcoded here (see the Node verification harness for this phase).
  const DEMO_CLIENT0001_PASSWORD_HASH = 'aa2490ec8670500ccd3838f2adff7cedf5425318e5e8c7d989acfa903a4704d6';
  // HYS Deposit Approval Queue (Aug 21, 2026). A PARALLEL store, not an extension of
  // marketswave_deposit_requests — a pocket-funding request carries pocketType/term/rate/
  // maturity fields a regular cash deposit into unallocatedCapital has no use for, and
  // regular deposits shouldn't grow optional fields that are only sometimes populated.
  // Mirrors the existing deposit/sell/allocation request pattern instead (each already its
  // own store with exactly the fields it needs), not a new pattern.
  const HYS_DEPOSIT_REQUESTS_KEY = 'marketswave_hys_deposit_requests';
  // high-yield-savings.html's own existing pocket store — engine-core.js did not previously
  // read or write this at all (pockets were entirely page-local). creditHYSDeposit() below
  // is the first engine code to touch it, and does so via a direct scoped read/modify/write
  // rather than adding a full module-level load-or-seed pipeline for it (nothing else in
  // this file needs pockets in memory), matching how seedMinimalClientStores() already
  // writes directly to a specific client's keys without going through the normal load path.
  const HYS_POCKETS_KEY = 'marketswave_hys_pockets';
  // Request Change redesign (Aug 21, 2026). REPLACES marketswave_settings_pending (which
  // only ever stored an array of bare field-name strings, no requested value, no reason, no
  // timestamp — see the handover doc for the full "why" of this redesign). The old key is
  // simply abandoned, not migrated: there is nothing worth salvaging from a field-name-only
  // record, unlike Multi-Client Data Model Step 2's migration, which moved real data.
  const SETTINGS_CHANGE_REQUESTS_KEY = 'marketswave_settings_change_requests';
  // settings.html's own existing profile store (previously email/phone only, read/written
  // directly by that page's own script, never through engine-core.js except once at Client
  // Registry seed time). Now also holds the four request-based fields below — engine-core.js
  // reads/writes those four fields directly via a scoped key, same as HYS_POCKETS_KEY above,
  // while settings.html's own email/phone read/write code is completely unchanged and safe:
  // it only ever mutates ONE field on an already-loaded object it re-persists whole, so it
  // can never clobber these new fields (verified by reading that code before adding this).
  const SETTINGS_PROFILE_KEY = 'marketswave_settings_profile';
  // Date of Birth removed as a requestable field (Aug 21, 2026) — it was the one field among
  // the original four stored as a bare ISO string rather than a structured object, and that
  // type mismatch (vs. legalName/address/idDocument's {..} shapes) was judged not worth
  // carrying forward. Removing it here means requestSettingsChange('dateOfBirth', ...) now
  // throws immediately via the REQUESTABLE_SETTINGS_FIELDS.indexOf check below — existing
  // dateOfBirth records already in marketswave_settings_change_requests test data are left
  // untouched (not migrated, not deleted) and remain fully visible/resolvable in
  // admin-settings-changes.html, since approveSettingsChangeRequest()/
  // rejectSettingsChangeRequest() never re-validate a request's field against this list.
  // Password Reset + 2FA Rework (Aug 21, 2026). SECURITY_LOG_KEY is GLOBAL — an audit trail
  // spanning every client, same category as CLIENTS_KEY/CATALOG_KEY, never scoped to one
  // client. SECURITY_STATE_KEY is per-client (mirrors SETTINGS_PROFILE_KEY's own
  // key-per-client convention) and holds the "force new password" flag; the existing
  // 'marketswave_settings_2fa' key (declared inline where it's used below, matching how
  // HYS_POCKETS_KEY's sibling keys are handled) is reused as-is for 2FA state rather than
  // introduced as a new constant, since its shape doesn't change.
  const SECURITY_LOG_KEY = 'marketswave_security_actions_log';
  const SECURITY_STATE_KEY = 'marketswave_settings_security';
  const REQUESTABLE_SETTINGS_FIELDS = ['legalName', 'address', 'idDocument'];
  // Matches exactly what every page in this project has always hardcoded for the demo
  // persona (dashboard-sidebar.js's footer, documents.html, etc.) — used only as a fallback
  // when a client's profile store doesn't have a field yet, so nothing visibly changes for
  // any existing browser until a real change is actually requested and approved.
  const REQUESTABLE_SETTINGS_DEFAULTS = {
    legalName: { firstName: 'John A.', lastName: 'Doe' },
    address: { street: '482 Harborview Lane', city: 'Boston', state: 'MA', zip: '02110', country: 'United States' },
    idDocument: { documentType: 'Passport', fileName: null }
  };

  // Total Portfolio Value currently hardcoded on dashboard.html. Used only at first-seed
  // time to derive unallocatedCapital = this minus the seeded holdings' value, so
  // getTotalPortfolioValue() reproduces today's on-page number exactly — nothing should
  // visually jump once a later phase wires pages to this engine.
  const DASHBOARD_TOTAL_PORTFOLIO_VALUE_SEED = 1284500;

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function safeParse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // Generic sequential id assigner, same pattern as addProduct()'s inline PROD-XXXX logic:
  // scans the array for the highest existing "<prefix>-<n>" id and increments. Never derived
  // from content, never reused.
  function nextSequentialId(arr, prefix) {
    let maxNum = 0;
    const re = new RegExp('^' + prefix + '-(\\d+)$');
    arr.forEach(function (item) {
      const match = re.exec(item.id);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    });
    return prefix + '-' + String(maxNum + 1).padStart(4, '0');
  }

  // Calendar-day string ('YYYY-MM-DD') in UTC, used consistently for both writing and
  // comparing lastTickDate — avoids local-timezone/DST edge cases entirely.
  function formatDateUTC(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayStrUTC() {
    return formatDateUTC(new Date());
  }

  // End-of-day fallback (ms) for a 'YYYY-MM-DD' requestedAt string that predates
  // requestedAtMs (added Phase 4c) — sorts an old record as the LATEST possible moment
  // within its own day, so it still sorts reasonably relative to newer, properly-timestamped
  // requests from the same or later days, rather than comparing as undefined/NaN.
  function endOfDayMsUTC(dateStr) {
    return new Date(dateStr + 'T23:59:59.999Z').getTime();
  }

  // ---- Client context (Multi-Client Data Model Phase, Step 2) --------------------------
  // getCurrentClientId() defaults to DEFAULT_CLIENT_ID ('CLIENT-0001') whenever nothing has
  // been explicitly set for this browser session — NOT null/undefined. This is deliberate,
  // not just a convenience default: every store below is loaded ONCE into module-level
  // variables when this IIFE runs, so switching clients mid-session (without a reload) would
  // NOT re-load fresh data — a caller must set the client id and then reload/navigate for it
  // to take effect, the same way a real account switch would. Defaulting to CLIENT-0001 is
  // what keeps every existing client-facing page (none of which call setCurrentClientId()
  // yet — that's Step 4) working with zero behavior change the moment this ships, rather
  // than silently reading from an undefined-suffixed key.
  function getCurrentClientId() {
    return sessionStorage.getItem(CURRENT_CLIENT_SESSION_KEY) || DEFAULT_CLIENT_ID;
  }

  function setCurrentClientId(id) {
    if (typeof id !== 'string' || !id) {
      throw new Error('setCurrentClientId requires a non-empty client id string.');
    }
    sessionStorage.setItem(CURRENT_CLIENT_SESSION_KEY, id);
  }

  // ---- Admin Login Gate (Aug 21, 2026) -----------------------------------------------------
  // Explicitly a UI-level stub, not real authentication — same honesty standard as the forced
  // password-reset gate (§4.61). There is no backend, no real PM account roster, no verified
  // credential of any kind; ADMIN_PASSPHRASE is a single shared constant living in this
  // client-side file, readable by anyone who opens dev tools. This closes the "any URL is
  // wide open with zero friction" gap only — it does NOT close the "properly secured" gap,
  // which needs a real backend, real PM accounts, and real credential verification (tracked
  // in the Backend Requirements Register as a genuine future requirement, not superseded by
  // this). sessionStorage-backed, same pattern as getCurrentClientId()/setCurrentClientId()
  // (CURRENT_CLIENT_SESSION_KEY above) — resets per browser session rather than persisting
  // forever, so a fresh session (or a cleared sessionStorage) always requires re-entering the
  // passphrase.
  const ADMIN_PASSPHRASE = 'marketswave-pm-2026';
  const ADMIN_AUTH_SESSION_KEY = 'marketswave_admin_authenticated';

  function checkAdminPassphrase(input) {
    return input === ADMIN_PASSPHRASE;
  }

  function setAdminAuthenticated() {
    sessionStorage.setItem(ADMIN_AUTH_SESSION_KEY, 'true');
  }

  function isAdminAuthenticated() {
    return sessionStorage.getItem(ADMIN_AUTH_SESSION_KEY) === 'true';
  }

  function clearAdminAuthenticated() {
    sessionStorage.removeItem(ADMIN_AUTH_SESSION_KEY);
  }

  // Every per-client store's actual localStorage key. Computed fresh on every call (not
  // cached) so it always reflects whatever getCurrentClientId() returns right now — though
  // in practice, within a single page load, that value only ever changes if the page's own
  // script calls setCurrentClientId() before any store is first read (see the ordering note
  // above about reload-to-switch).
  function clientScopedKey(baseKey) {
    return baseKey + ':' + getCurrentClientId();
  }

  // Same scoping scheme as clientScopedKey(), but for an EXPLICIT client id rather than
  // whichever client is currently active — needed for admin-side operations that must target
  // an arbitrary client regardless of the "Viewing Client" selector's current value (e.g.
  // resolving a settings-change request for the client who submitted it, not the client the
  // PM happens to be looking at right now). Extracted here from what was previously three
  // inline `baseKey + ':' + clientId` occurrences in seedMinimalClientStores() — same logic,
  // now named and reusable rather than duplicated a fourth time.
  function scopedKeyForClient(baseKey, clientId) {
    return baseKey + ':' + clientId;
  }

  // ---- One-time migration: old unscoped per-client keys -> CLIENT-0001-scoped keys -----
  // Every store in this list used to be a single, implicitly-CLIENT-0001 store before this
  // phase. Runs BEFORE any of those stores' own load-or-seed blocks below, and always
  // targets CLIENT-0001 specifically (not getCurrentClientId()) — these are literally
  // CLIENT-0001's pre-existing records being renamed into their new scoped home, regardless
  // of which client happens to be selected at the moment this code runs. Idempotent by
  // construction: once a legacy key is migrated, it's deleted, so a second run finds nothing
  // left to migrate for that key and does nothing. Never overwrites a scoped key that
  // already has data (only fills it in if empty) — if a scoped key somehow already exists,
  // the legacy key is still cleaned up (it's obsolete either way), but its content is not
  // used to clobber whatever's already properly scoped.
  //
  // NOTE: three of documents.html/support.html/high-yield-savings.html/risk-management.html/
  // settings.html's OWN keys are included here even though this file doesn't read or write
  // them during normal operation — engine-core.js is the one script guaranteed to load
  // before every one of those pages' own inline scripts (confirmed by checking every script
  // tag order), making it the single reliable place to run this exactly once, rather than
  // duplicating migration logic across 7 separate page scripts with no guarantee of which
  // page a given browser visits first.
  const LEGACY_UNSCOPED_KEYS_TO_MIGRATE = [
    ACCOUNT_KEY, HOLDINGS_KEY, REQUESTS_KEY, TRANSACTIONS_KEY, SELL_REQUESTS_KEY,
    DEPOSIT_REQUESTS_KEY, DOCUMENTS_KEY,
    'marketswave_risk_profile',
    'marketswave_settings_profile',
    'marketswave_settings_pending',
    'marketswave_settings_2fa',
    'marketswave_settings_notifications',
    'marketswave_notifications_read',
    'marketswave_hys_pockets',
    'marketswave_support_requests'
  ];

  function migrateLegacyUnscopedKeysToClient0001() {
    LEGACY_UNSCOPED_KEYS_TO_MIGRATE.forEach(function (baseKey) {
      const legacyValue = localStorage.getItem(baseKey);
      if (legacyValue === null) return; // nothing under the old unscoped key — nothing to do
      const scopedKey = baseKey + ':' + DEFAULT_CLIENT_ID;
      if (localStorage.getItem(scopedKey) === null) {
        localStorage.setItem(scopedKey, legacyValue);
      }
      localStorage.removeItem(baseKey);
    });
  }

  // ---- Risk tier return config ---------------------------------------------
  // Starting-point assumptions, not fixed in stone. Conservative and Balanced feel like
  // reasonable, fairly standard figures (bond-like vs. diversified-equity-like). Aggressive
  // is the one worth a second look: this tier currently covers BOTH Private Equity and
  // Crypto (see SEED_PRODUCTS below), which have quite different real-world volatility
  // profiles — real crypto is often 50-80%+ annualized, well above PE. 28% is a compromise
  // that undersells crypto's real swings and oversells PE's. Fine for a shared demo tier for
  // now, but flagging it: a future phase might want per-product volatility overrides rather
  // than one number per tier, especially once Crypto and Private Equity products diverge.
  const RISK_TIER_RETURN_CONFIG = {
    conservative: { annualReturnMean: 0.06, annualVolatility: 0.04 },
    balanced: { annualReturnMean: 0.11, annualVolatility: 0.10 },
    aggressive: { annualReturnMean: 0.18, annualVolatility: 0.28 }
  };

  // ---- Seeded deterministic PRNG (NOT Math.random()) -----------------------
  // Seed is derived from a string key (productId + calendar date) via FNV-1a, then fed into
  // a small deterministic generator (mulberry32) to produce uniform [0,1) draws, which
  // Box-Muller turns into a standard-normal Z. Same product + same date -> same Z, always;
  // different date or product -> a different (still fully deterministic) Z.
  function hashStringToSeed(str) {
    let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededStandardNormal(seedKey) {
    const rng = mulberry32(hashStringToSeed(seedKey));
    let u1 = rng();
    if (u1 <= 0) u1 = 1e-9; // guard against log(0)
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // ---- Seed inputs --------------------------------------------------------
  // Mirrors what's currently hardcoded today: the four asset cards + Return Table rows on
  // asset-performance.html (name, asset class, investment type, "Allocated: $X", return %)
  // and the 32/22/18/12/16 split + $1,284,500 total on dashboard.html. Cash is included as
  // the catalog's representation of the Unallocated bucket, per spec — it intentionally has
  // no `seedAllocatedValue` and gets no HOLDINGS entry, since Unallocated capital is tracked
  // as its own Account State field, not as units of a product (matches the locked portfolio
  // engine rule: Unallocated <-> Allocated are separate buckets, not a "cash product").
  //
  // riskTier is a judgment call for every product below — none of the source pages carry a
  // risk-tier concept today. Reasoning: Crypto and Private Equity are the two higher-
  // volatility/higher-growth classes here (18.4% and 9.1% return respectively, PE being
  // illiquid) -> aggressive. Real Assets (REIT) is the steadiest, income-oriented class ->
  // conservative. Stocks & ETFs sits in the middle -> balanced. Cash is capital preservation
  // by definition -> conservative.
  const SEED_PRODUCTS = [
    {
      name: 'Nordic Growth Fund',
      assetClass: 'Private Equity',
      investmentType: 'Growth Fund',
      riskTier: 'aggressive',
      minimumInvestment: 25000,
      inceptionUnitPrice: 100.00,
      seedReturnPct: 0.184,     // from asset-performance.html's Nordic Growth Fund card (+18.4%)
      seedAllocatedValue: 410000, // "Allocated: $410,000" on the same card
      createdAt: '2026-01-15'
    },
    {
      name: 'European Real Estate Trust',
      assetClass: 'Real Assets',
      investmentType: 'REIT',
      riskTier: 'conservative',
      minimumInvestment: 10000,
      inceptionUnitPrice: 100.00,
      seedReturnPct: 0.092,
      seedAllocatedValue: 282000,
      createdAt: '2026-01-15'
    },
    {
      name: 'Global Equity ETF',
      assetClass: 'Stocks & ETFs',
      investmentType: 'ETF',
      riskTier: 'balanced',
      minimumInvestment: 1000,
      inceptionUnitPrice: 100.00,
      seedReturnPct: 0.118,
      seedAllocatedValue: 230000,
      createdAt: '2026-01-15'
    },
    {
      name: 'Ethereum',
      assetClass: 'Crypto',
      investmentType: 'Digital Asset',
      riskTier: 'aggressive',
      minimumInvestment: 100,
      inceptionUnitPrice: 100.00,
      seedReturnPct: 0.091,
      seedAllocatedValue: 156980,
      createdAt: '2026-02-01'
    },
    {
      name: 'Cash',
      assetClass: 'Unallocated / Cash',
      investmentType: 'Cash',
      riskTier: 'conservative',
      minimumInvestment: 0,
      inceptionUnitPrice: 1.00,
      seedReturnPct: 0,
      seedAllocatedValue: null, // no holding — represents the Unallocated bucket, not a position
      createdAt: '2026-01-01'
    }
  ];

  function buildSeedData() {
    const catalog = [];
    const holdings = [];
    // lastTickDate seeds to TODAY (the moment this data is first created), not createdAt.
    // createdAt is a separate, purely informational "product launch" date. lastTickDate is
    // tick bookkeeping: seeding it to today means settleAllProducts() walks forward ZERO
    // days on this very first load, so unitPrice stays exactly the Phase-1-matched seed
    // value (e.g. Nordic Growth Fund's 118.40) until at least one real calendar day has
    // actually passed — preserving Phase 1's "nothing visually jumps" guarantee. Genuine
    // drift only starts accruing from here forward.
    const seedTickDate = todayStrUTC();

    SEED_PRODUCTS.forEach((seed, index) => {
      const id = 'PROD-' + String(index + 1).padStart(4, '0');
      const unitPrice = round2(seed.inceptionUnitPrice * (1 + seed.seedReturnPct));

      catalog.push({
        id: id,
        name: seed.name,
        assetClass: seed.assetClass,
        investmentType: seed.investmentType,
        riskTier: seed.riskTier,
        minimumInvestment: seed.minimumInvestment,
        unitPrice: unitPrice,
        inceptionUnitPrice: seed.inceptionUnitPrice,
        createdAt: seed.createdAt,
        lastTickDate: seedTickDate
      });

      if (seed.seedAllocatedValue !== null) {
        const units = seed.seedAllocatedValue / unitPrice;
        const costBasis = round2(units * seed.inceptionUnitPrice);
        holdings.push({ productId: id, units: units, costBasis: costBasis });
      }
    });

    const allocatedCapital = round2(holdings.reduce((sum, h) => {
      const product = catalog.find(function (p) { return p.id === h.productId; });
      return sum + h.units * product.unitPrice;
    }, 0));

    const unallocatedCapital = round2(DASHBOARD_TOTAL_PORTFOLIO_VALUE_SEED - allocatedCapital);

    const accountState = {
      unallocatedCapital: unallocatedCapital,
      allocatedCapital: allocatedCapital,
      assetReturns: 0, // realized returns only — stays 0 until a later phase posts to it
      advisoryFeeRate: 1.25
    };

    return { catalog: catalog, accountState: accountState, holdings: holdings };
  }

  // ---- Client Registry: load or seed FIRST, before migration runs ----------------------
  // Multi-Client Data Model Phase, Step 1 (Aug 21, 2026), reordered ahead of everything else
  // in Step 2: this seed step reads the OLD, still-unscoped 'marketswave_settings_profile'
  // key directly (not through clientScopedKey — there's no client to scope by yet at this
  // exact point). It MUST run before migrateLegacyUnscopedKeysToClient0001() below deletes
  // that raw key, or a fresh install with real pre-existing profile data would seed
  // CLIENT-0001 with generic defaults instead of that real data. This ordering constraint is
  // the reason this block was moved here rather than left in its original Step 1 position.
  // name/accountType aren't stored anywhere today (hardcoded "John Doe" / "Individual
  // Account" across every page's markup) so those two are hardcoded here too, matching the
  // persona consistently. email/phone ARE stored, so those are read from there — falling
  // back to settings.html's own defaults if that store doesn't exist yet in this browser.
  let clients = safeParse(localStorage.getItem(CLIENTS_KEY));
  if (!clients) {
    let seedProfile = null;
    try { seedProfile = JSON.parse(localStorage.getItem('marketswave_settings_profile')); } catch (e) { /* ignore malformed storage */ }
    clients = [{
      id: DEFAULT_CLIENT_ID,
      name: 'John Doe',
      email: (seedProfile && seedProfile.email) || 'john.doe@example.com',
      phone: (seedProfile && seedProfile.phone) || '+1 (415) 555-0182',
      accountType: 'Individual Account',
      createdAt: '2026-01-01'
    }];
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
  }

  // ---- One-time legacy-key migration runs here: after the Client Registry seed above (so
  // it could read the pre-migration raw settings-profile key), before every per-client
  // store's own load-or-seed block below (so those blocks see the now-scoped keys) --------
  migrateLegacyUnscopedKeysToClient0001();

  // ---- Seed CLIENT-0001's demo credentials, once, if missing (Client Authentication Phase
  // 1, Aug 21, 2026) — keeps every existing demo/testing flow working once login actually
  // checks credentials in Phase 2, without requiring every browser that already has
  // CLIENT-0001 seeded (from before this phase existed) to manually set one. Never
  // overwrites an existing credentials record — matches the "never clobber real data" rule
  // every other seed-if-missing block in this file already follows. Runs after the Client
  // Registry seed above (CLIENT-0001 must exist first) and after migration (credentials are
  // a brand-new key, never part of the legacy unscoped set, so ordering relative to
  // migration doesn't matter here — placed after it only to stay grouped with the other
  // one-time startup steps).
  if (!localStorage.getItem(scopedKeyForClient(CLIENT_CREDENTIALS_KEY, DEFAULT_CLIENT_ID))) {
    localStorage.setItem(
      scopedKeyForClient(CLIENT_CREDENTIALS_KEY, DEFAULT_CLIENT_ID),
      JSON.stringify({ passwordHash: DEMO_CLIENT0001_PASSWORD_HASH })
    );
  }

  // ---- Load or seed (all three stores together, so a partial/missing key always
  // re-seeds everything as one consistent set rather than mixing old + fresh data) ------
  // Product Catalog stays on its raw, unscoped CATALOG_KEY — global by design, shared across
  // every client, never migrated or re-keyed (same category as the Client Registry itself).
  let catalog, accountState, holdings;

  const storedCatalog = safeParse(localStorage.getItem(CATALOG_KEY));
  const storedAccount = safeParse(localStorage.getItem(clientScopedKey(ACCOUNT_KEY)));
  const storedHoldings = safeParse(localStorage.getItem(clientScopedKey(HOLDINGS_KEY)));

  if (storedCatalog && storedAccount && storedHoldings) {
    catalog = storedCatalog;
    accountState = storedAccount;
    holdings = storedHoldings;
  } else {
    const seeded = buildSeedData();
    catalog = seeded.catalog;
    accountState = seeded.accountState;
    holdings = seeded.holdings;
    localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
    localStorage.setItem(clientScopedKey(ACCOUNT_KEY), JSON.stringify(accountState));
    localStorage.setItem(clientScopedKey(HOLDINGS_KEY), JSON.stringify(holdings));
  }

  // Loaded independently of the catalog/account/holdings trio above, rather than folded into
  // that "all-or-nothing" seed block — these two keys are new as of Phase 3 and an existing
  // install already has real catalog/account/holdings data that must NOT be wiped just
  // because it predates these two keys. Each defaults to an empty array on first load.
  let allocationRequests = safeParse(localStorage.getItem(clientScopedKey(REQUESTS_KEY)));
  if (!allocationRequests) {
    allocationRequests = [];
    localStorage.setItem(clientScopedKey(REQUESTS_KEY), JSON.stringify(allocationRequests));
  }

  let transactions = safeParse(localStorage.getItem(clientScopedKey(TRANSACTIONS_KEY)));
  if (!transactions) {
    transactions = [];
    localStorage.setItem(clientScopedKey(TRANSACTIONS_KEY), JSON.stringify(transactions));
  }

  // New as of Phase 3B, loaded independently for the same reason as the two keys above —
  // an existing install's real data must not be wiped just because this key predates it.
  let sellRequests = safeParse(localStorage.getItem(clientScopedKey(SELL_REQUESTS_KEY)));
  if (!sellRequests) {
    sellRequests = [];
    localStorage.setItem(clientScopedKey(SELL_REQUESTS_KEY), JSON.stringify(sellRequests));
  }

  // Admin tool Phase A, loaded independently for the same reason as the two keys above — an
  // existing install's real data must not be wiped just because this key predates it.
  let depositRequests = safeParse(localStorage.getItem(clientScopedKey(DEPOSIT_REQUESTS_KEY)));
  if (!depositRequests) {
    depositRequests = [];
    localStorage.setItem(clientScopedKey(DEPOSIT_REQUESTS_KEY), JSON.stringify(depositRequests));
  }

  // HYS Deposit Approval Queue — new as of this phase, so (unlike the keys above) there is
  // no legacy unscoped version to ever migrate; it's born scoped.
  let hysDepositRequests = safeParse(localStorage.getItem(clientScopedKey(HYS_DEPOSIT_REQUESTS_KEY)));
  if (!hysDepositRequests) {
    hysDepositRequests = [];
    localStorage.setItem(clientScopedKey(HYS_DEPOSIT_REQUESTS_KEY), JSON.stringify(hysDepositRequests));
  }

  function persistCatalog() {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  }

  function persistAccountState() {
    localStorage.setItem(clientScopedKey(ACCOUNT_KEY), JSON.stringify(accountState));
  }

  function persistHoldings() {
    localStorage.setItem(clientScopedKey(HOLDINGS_KEY), JSON.stringify(holdings));
  }

  function persistAllocationRequests() {
    localStorage.setItem(clientScopedKey(REQUESTS_KEY), JSON.stringify(allocationRequests));
  }

  function persistTransactions() {
    localStorage.setItem(clientScopedKey(TRANSACTIONS_KEY), JSON.stringify(transactions));
  }

  function persistSellRequests() {
    localStorage.setItem(clientScopedKey(SELL_REQUESTS_KEY), JSON.stringify(sellRequests));
  }

  function persistDepositRequests() {
    localStorage.setItem(clientScopedKey(DEPOSIT_REQUESTS_KEY), JSON.stringify(depositRequests));
  }

  function persistHYSDepositRequests() {
    localStorage.setItem(clientScopedKey(HYS_DEPOSIT_REQUESTS_KEY), JSON.stringify(hysDepositRequests));
  }

  function persistClients() {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
  }

  // Bug/data-gap fix (Aug 20, 2026): Phase 1's originally-seeded holdings were written
  // directly to localStorage before the transaction ledger concept existed (Phase 3), so no
  // BUY transaction was ever recorded for a portfolio's starting holdings — on a fresh
  // install, OR an existing browser whose data predates Phase 3, this left
  // getTransactionLedger() empty while getHoldings() showed real data: Net Invested (reads
  // holdings) looked correct while Total Buys/Recent Activity/both charts/the ledger table
  // (all read the ledger) correctly showed nothing, because genuinely nothing had been
  // logged. Runs once: if transactions is empty but holdings already exist, synthesizes one
  // BUY per holding, backdated to the product's own createdAt, at the cost-basis-implied
  // unit price (costBasis / units — correct even for a holding that's since been partially
  // sold, since executeSell()'s proportional formula preserves the average cost per unit
  // exactly). Self-limiting without any extra flag: once this runs, transactions is no
  // longer empty, so the condition never re-fires on a later load.
  function backfillTransactionsForExistingHoldings() {
    if (transactions.length > 0 || holdings.length === 0) return;
    holdings.forEach(function (h) {
      const product = getProduct(h.productId);
      const unitPrice = h.units > 0 ? round2(h.costBasis / h.units) : 0;
      transactions.push({
        id: nextSequentialId(transactions, 'TXN'),
        date: product ? product.createdAt : todayStrUTC(),
        productId: h.productId,
        type: 'BUY',
        units: h.units,
        price: unitPrice,
        totalValue: h.costBasis,
        realizedReturn: null,
        status: 'Completed'
      });
    });
    persistTransactions();
  }
  backfillTransactionsForExistingHoldings();

  // Account State's allocatedCapital must always equal sum(holding.units x product.unitPrice)
  // — that was Phase 1's invariant. Phase 2 introduces price movement, so this has to be
  // recomputed any time unit prices tick, not just at seed time, or the invariant would
  // silently go stale the moment a single day ticks. Called at the end of
  // settleAllProducts() so it's always current after any settle pass.
  function recomputeAllocatedCapital() {
    const total = round2(holdings.reduce(function (sum, h) {
      const product = getProduct(h.productId);
      return sum + h.units * (product ? product.unitPrice : 0);
    }, 0));
    accountState.allocatedCapital = total;
    persistAccountState();
    return total;
  }

  // ---- NAV-tick returns engine ----------------------------------------------
  // Walks a single product's unitPrice forward day-by-day from its stored lastTickDate to
  // today (UTC calendar days), applying one GBM log-return step per day:
  //   dailyReturn = dailyMean - 0.5*dailyVariance + dailyVolatility*Z
  //   newPrice   = oldPrice * exp(dailyReturn)
  // Z is drawn from the seeded PRNG above, keyed on (productId, that specific date) — so
  // re-running this on the same day is a no-op (0 days to walk) and is fully idempotent;
  // re-running it after time has passed always reproduces the same path for the days already
  // ticked, since each day's Z is deterministic. Cash never ticks (par value, no riskTier
  // volatility concept applies to a cash placeholder) and products with an unrecognized
  // riskTier are left untouched defensively rather than throwing.
  function settleProduct(id) {
    const idx = catalog.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return null;
    const product = catalog[idx];

    if (product.assetClass === 'Unallocated / Cash') return product;
    const config = RISK_TIER_RETURN_CONFIG[product.riskTier];
    if (!config) return product;

    const dailyMean = config.annualReturnMean / 365;
    const dailyVolatility = config.annualVolatility / Math.sqrt(365);
    const dailyVariance = dailyVolatility * dailyVolatility;

    const today = todayStrUTC();
    let cursor = new Date(product.lastTickDate + 'T00:00:00Z');
    let price = product.unitPrice;

    while (formatDateUTC(cursor) < today) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const dateStr = formatDateUTC(cursor);
      const z = seededStandardNormal(id + '|' + dateStr);
      const dailyReturn = dailyMean - 0.5 * dailyVariance + dailyVolatility * z;
      price = price * Math.exp(dailyReturn);
    }

    price = round2(price);
    catalog[idx] = Object.assign({}, product, { unitPrice: price, lastTickDate: today });
    persistCatalog();
    return catalog[idx];
  }

  function settleAllProducts() {
    const results = getAllProducts().map(function (p) { return settleProduct(p.id); }).filter(Boolean);
    recomputeAllocatedCapital();
    return results;
  }

  // ---- Advisory fee ----------------------------------------------------------
  function getAdvisoryFeeAccrued(periodDays) {
    return round2(accountState.allocatedCapital * (accountState.advisoryFeeRate / 100) * (periodDays / 365));
  }

  function setAdvisoryFeeRate(newRate) {
    if (typeof newRate !== 'number' || !isFinite(newRate) || newRate <= 0) {
      throw new Error('Advisory fee rate must be a positive number.');
    }
    accountState.advisoryFeeRate = newRate;
    persistAccountState();
    return accountState.advisoryFeeRate;
  }

  // Lazy catch-up: run once per engine load (here, not on a setInterval — see file header).
  // On a fresh seed this is a same-day no-op. On an existing catalog it walks every product
  // forward however many real calendar days have elapsed since the engine was last loaded.
  settleAllProducts();

  // ---- Approval Gate unification: explicit-clientId storage helpers (Aug 21, 2026) --------
  // Deposits/Allocations/Sells/HYS Deposits used to be the one domain where the resolve
  // primitives (executeBuy/executeSell/creditDepositRequest/creditHYSDeposit) read and wrote
  // the module-level accountState/holdings/transactions/*Requests variables above — loaded
  // ONCE, ambiently, for whichever client was active when this IIFE ran. Unlike Documents/
  // Support/Settings-Changes (which never had that caching problem — every function there
  // already did a fresh localStorage read-modify-write per call), these four domains needed
  // their execution chain converted, not just their top-level function signatures. These
  // three helpers are the shared plumbing every rewritten primitive below uses instead of
  // touching the module-level arrays: always a direct scoped read, direct scoped write, for
  // an explicit clientId, every single call — no fallback to getCurrentClientId() anywhere
  // in this chain, at any layer, regardless of whether clientId happens to equal the
  // currently active client. (catalog/settleProduct()/getProduct() are NOT included here —
  // the Product Catalog is genuinely global/unscoped, shared by every client, so pricing
  // needs no per-client helper at all.)
  function readAccountStateForClient(clientId) {
    const key = scopedKeyForClient(ACCOUNT_KEY, clientId);
    return safeParse(localStorage.getItem(key)) ||
      { unallocatedCapital: 0, allocatedCapital: 0, assetReturns: 0, advisoryFeeRate: 1.25 };
  }

  function writeAccountStateForClient(clientId, state) {
    localStorage.setItem(scopedKeyForClient(ACCOUNT_KEY, clientId), JSON.stringify(state));
  }

  function readHoldingsForClient(clientId) {
    return safeParse(localStorage.getItem(scopedKeyForClient(HOLDINGS_KEY, clientId))) || [];
  }

  function writeHoldingsForClient(clientId, holdingsArr) {
    localStorage.setItem(scopedKeyForClient(HOLDINGS_KEY, clientId), JSON.stringify(holdingsArr));
  }

  // The one hop shared by all 4 domains' resolve paths (every credit/approve action logs a
  // transaction) — a single helper so none of the 4 rewritten primitives below can
  // accidentally fall back to the module-level, ambient `transactions` array. txn.id is
  // assigned here from THIS client's own transaction array (transaction ids are per-client
  // scoped, same as every other sequential id in this file — DOC-XXXX, SETTING-XXXX, etc. —
  // not globally unique across clients).
  function appendTransactionForClient(clientId, txn) {
    const key = scopedKeyForClient(TRANSACTIONS_KEY, clientId);
    const clientTransactions = safeParse(localStorage.getItem(key)) || [];
    const txnId = nextSequentialId(clientTransactions, 'TXN');
    clientTransactions.push(Object.assign({ id: txnId }, txn));
    localStorage.setItem(key, JSON.stringify(clientTransactions));
    return txnId;
  }

  // Same explicit-clientId discipline, for the 4 request queues themselves — the approve/
  // reject wrappers below must find and mutate a request inside the CORRECT client's own
  // queue, never the ambient module-level allocationRequests/sellRequests/depositRequests/
  // hysDepositRequests arrays (which reflect whichever client happened to be active when
  // this IIFE last ran, not necessarily the clientId the caller is naming here).
  function readRequestsForClient(baseKey, clientId) {
    return safeParse(localStorage.getItem(scopedKeyForClient(baseKey, clientId))) || [];
  }

  function writeRequestsForClient(baseKey, clientId, requestsArr) {
    localStorage.setItem(scopedKeyForClient(baseKey, clientId), JSON.stringify(requestsArr));
  }

  // ---- Transaction mechanics (Phase 3) ---------------------------------------------------
  // Models the locked rule: a client REQUEST must not move money by itself. Money only moves
  // once a PM (or, in this demo engine, a direct call to approveAllocationRequest) actually
  // executes it. requestAllocation() only ever appends a pending record.
  //
  // JUDGMENT CALL — flagged rather than silently decided: requestAllocation() rejects any
  // amount greater than CURRENT unallocatedCapital, even though a client requesting more
  // capital than is currently unallocated might reasonably expect additional capital to
  // land before a PM gets to approving the request. The stricter "can't request more than
  // exists right now" check was implemented because it's the safer default for a capital
  // platform (an approval that silently overdraws unallocatedCapital is a worse failure mode
  // than a client having to re-request after more capital arrives) — worth revisiting if a
  // later phase wants a "pending capital" concept that requests can draw against.
  //
  // JUDGMENT CALL — also flagged: requestAllocation() rejects the Cash product outright.
  // The spec doesn't mention this case, but Cash represents the Unallocated bucket itself
  // (see SEED_PRODUCTS above and the locked "Unallocated <-> Allocated are separate buckets"
  // rule) — "buying units of Cash" doesn't fit the model, the same reasoning that already
  // gives Cash no HOLDINGS entry and no price tick in settleProduct().
  function requestAllocation(productId, dollarAmount) {
    const product = getProduct(productId);
    if (!product) throw new Error('Unknown product: ' + productId);
    if (product.assetClass === 'Unallocated / Cash') {
      throw new Error('Cannot request an allocation into Cash — it represents the Unallocated bucket itself.');
    }
    if (typeof dollarAmount !== 'number' || !isFinite(dollarAmount) || dollarAmount <= 0) {
      throw new Error('Allocation amount must be a positive number.');
    }
    if (dollarAmount < product.minimumInvestment) {
      throw new Error('Allocation amount is below ' + product.name + '\'s minimum investment of ' + product.minimumInvestment + '.');
    }
    if (dollarAmount > accountState.unallocatedCapital) {
      throw new Error('Allocation amount exceeds current unallocated capital.');
    }

    const request = {
      id: nextSequentialId(allocationRequests, 'REQ'),
      productId: productId,
      amount: round2(dollarAmount),
      status: 'pending',
      requestedAt: todayStrUTC(),
      requestedAtMs: Date.now(), // for stable cross-type sort ordering — see getAllocationRequests()/getSellRequests()
      resolvedAt: null,
      transactionId: null
    };
    allocationRequests.push(request);
    persistAllocationRequests();
    return request;
  }

  // Settles the product's price first so the buy always executes at a current unit price,
  // never a stale one left over from before today's tick. Explicit clientId (Aug 21, 2026,
  // Approval Gate unification) — every read/write below is a direct scoped access for that
  // client, never the module-level holdings/accountState/transactions arrays (see the
  // helpers above). settleProduct()/getProduct() stay untouched — the Product Catalog is
  // global, not per-client.
  function executeBuy(clientId, productId, dollarAmount) {
    const settled = settleProduct(productId);
    if (!settled) throw new Error('Unknown product: ' + productId);
    const unitPrice = settled.unitPrice;
    const units = dollarAmount / unitPrice;

    const clientHoldings = readHoldingsForClient(clientId);
    let holding = clientHoldings.find(function (h) { return h.productId === productId; });
    if (holding) {
      holding.units += units;
      holding.costBasis = round2(holding.costBasis + dollarAmount);
    } else {
      holding = { productId: productId, units: units, costBasis: round2(dollarAmount) };
      clientHoldings.push(holding);
    }
    writeHoldingsForClient(clientId, clientHoldings);

    const clientAccountState = readAccountStateForClient(clientId);
    clientAccountState.unallocatedCapital = round2(clientAccountState.unallocatedCapital - dollarAmount);
    // Inlined recomputeAllocatedCapital() logic, against THIS client's freshly-written
    // holdings — the module-level recomputeAllocatedCapital() operates on the ambient
    // holdings/accountState and must not be called from this explicit-clientId chain.
    clientAccountState.allocatedCapital = round2(clientHoldings.reduce(function (sum, h) {
      const product = getProduct(h.productId);
      return sum + h.units * (product ? product.unitPrice : 0);
    }, 0));
    writeAccountStateForClient(clientId, clientAccountState);

    return appendTransactionForClient(clientId, {
      date: todayStrUTC(),
      productId: productId,
      type: 'BUY',
      units: units,
      price: unitPrice,
      totalValue: round2(dollarAmount),
      realizedReturn: null,
      status: 'Completed'
    });
  }

  // Cost basis for the sold portion is proportional to the fraction of the holding being
  // sold — NOT FIFO/LIFO lot tracking, since holdings aren't tracked as discrete lots here.
  // Explicit clientId (Aug 21, 2026, Approval Gate unification) — every read/write below is
  // a direct scoped access for that client, never the module-level holdings/accountState/
  // transactions arrays. See executeBuy() above for the same pattern.
  function executeSell(clientId, productId, unitsToSell) {
    const clientHoldings = readHoldingsForClient(clientId);
    const holding = clientHoldings.find(function (h) { return h.productId === productId; });
    if (!holding) throw new Error('No holding exists for product ' + productId + '.');
    if (typeof unitsToSell !== 'number' || !isFinite(unitsToSell) || unitsToSell <= 0) {
      throw new Error('unitsToSell must be a positive number.');
    }
    if (unitsToSell > holding.units + 1e-9) {
      throw new Error('Cannot sell more units than are held.');
    }

    const settled = settleProduct(productId);
    const unitPrice = settled.unitPrice;

    const saleValue = round2(unitsToSell * unitPrice);
    const costBasisPortion = round2(holding.costBasis * (unitsToSell / holding.units));
    const realizedReturn = round2(saleValue - costBasisPortion);

    const clientAccountState = readAccountStateForClient(clientId);
    clientAccountState.unallocatedCapital = round2(clientAccountState.unallocatedCapital + costBasisPortion);
    clientAccountState.assetReturns = round2(clientAccountState.assetReturns + realizedReturn);

    const remainingUnits = holding.units - unitsToSell;
    let updatedHoldings;
    if (remainingUnits < 1e-6) {
      updatedHoldings = clientHoldings.filter(function (h) { return h.productId !== productId; });
    } else {
      holding.units = remainingUnits;
      holding.costBasis = round2(holding.costBasis - costBasisPortion);
      updatedHoldings = clientHoldings;
    }
    writeHoldingsForClient(clientId, updatedHoldings);

    // Inlined recomputeAllocatedCapital() logic, against THIS client's freshly-written
    // holdings — see executeBuy() for why the module-level recomputeAllocatedCapital()
    // must not be called from this explicit-clientId chain.
    clientAccountState.allocatedCapital = round2(updatedHoldings.reduce(function (sum, h) {
      const product = getProduct(h.productId);
      return sum + h.units * (product ? product.unitPrice : 0);
    }, 0));
    writeAccountStateForClient(clientId, clientAccountState);

    return appendTransactionForClient(clientId, {
      date: todayStrUTC(),
      productId: productId,
      type: 'SELL',
      units: unitsToSell,
      price: unitPrice,
      totalValue: saleValue,
      realizedReturn: realizedReturn,
      status: 'Completed'
    });
  }

  // JUDGMENT CALL — flagged rather than silently decided: only the buy side (allocation
  // requests) goes through a pending/approval gate. executeSell() runs directly with no
  // equivalent request/approval step, since the spec only describes an approval gate for
  // allocation. Revisit if sells should also queue for PM approval in a later phase.
  // Explicit clientId (Aug 21, 2026, Approval Gate unification) — reads/writes ONLY that
  // client's own scoped request queue, never the ambient module-level allocationRequests.
  function approveAllocationRequest(clientId, requestId) {
    const clientRequests = readRequestsForClient(REQUESTS_KEY, clientId);
    const request = clientRequests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown allocation request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('Allocation request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }

    const txnId = executeBuy(clientId, request.productId, request.amount);

    request.status = 'approved';
    request.resolvedAt = todayStrUTC();
    request.transactionId = txnId;
    writeRequestsForClient(REQUESTS_KEY, clientId, clientRequests);
    return request;
  }

  function rejectAllocationRequest(clientId, requestId, reason) {
    const clientRequests = readRequestsForClient(REQUESTS_KEY, clientId);
    const request = clientRequests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown allocation request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('Allocation request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }

    request.status = 'rejected';
    request.resolvedAt = todayStrUTC();
    request.reason = reason || null;
    writeRequestsForClient(REQUESTS_KEY, clientId, clientRequests);
    return request;
  }

  // Deep-clones (same reason as getHoldings(): approveAllocationRequest()/
  // rejectAllocationRequest()/approveSellRequest()/rejectSellRequest() mutate request
  // objects in place internally) AND guarantees requestedAtMs is present, backfilling an
  // end-of-day fallback for any record stored before Phase 4c added the field — without
  // rewriting the underlying stored data, since the fallback is fully deterministic from
  // requestedAt and can just be recomputed on every read.
  function withSortTimestamp(r) {
    return Object.assign({}, r, {
      requestedAtMs: typeof r.requestedAtMs === 'number' ? r.requestedAtMs : endOfDayMsUTC(r.requestedAt)
    });
  }

  function getAllocationRequests() {
    return allocationRequests.map(withSortTimestamp);
  }

  // Cross-client aggregation (Aug 21, 2026, Approval Gate unification) — mirrors
  // getAllClientSettingsChangeRequests()/getAllClientDocuments() exactly: reads every
  // client's own scoped request queue directly, tags each item with clientId/clientName.
  function getAllClientAllocationRequests() {
    return clients.reduce(function (acc, c) {
      const key = scopedKeyForClient(REQUESTS_KEY, c.id);
      const requests = safeParse(localStorage.getItem(key)) || [];
      requests.forEach(function (r) {
        acc.push(Object.assign({}, withSortTimestamp(r), { clientId: c.id, clientName: c.name }));
      });
      return acc;
    }, []);
  }

  // ---- Sell request queue (Phase 3B) -----------------------------------------------------
  // Mirrors the allocation request queue exactly, but for the sell side: a client's
  // requestSell() must not move money by itself, only approveSellRequest() does — same
  // "request now, execute later" discipline as requestAllocation()/approveAllocationRequest().
  function requestSell(productId, unitsToSell) {
    const holding = holdings.find(function (h) { return h.productId === productId; });
    if (!holding) throw new Error('No holding exists for product ' + productId + '.');
    if (typeof unitsToSell !== 'number' || !isFinite(unitsToSell) || unitsToSell <= 0) {
      throw new Error('unitsToSell must be a positive number.');
    }
    if (unitsToSell > holding.units + 1e-9) {
      throw new Error('Cannot request to sell more units than are currently held.');
    }

    // Captures the exact unit count now, not a "sell everything" flag re-evaluated later —
    // a client's "Sell All" click resolves to a specific number at request time.
    const request = {
      id: nextSequentialId(sellRequests, 'SELL'),
      productId: productId,
      unitsToSell: unitsToSell,
      status: 'pending',
      requestedAt: todayStrUTC(),
      requestedAtMs: Date.now(), // for stable cross-type sort ordering — see getAllocationRequests()/getSellRequests()
      resolvedAt: null,
      transactionId: null,
      reason: null
    };
    sellRequests.push(request);
    persistSellRequests();
    return request;
  }

  // Re-validates against the CURRENT holding before executing — units could have shrunk
  // since the request was made if another sell request on the same holding was approved in
  // between. Throws rather than executing a partial/incorrect sell or failing silently.
  // Explicit clientId (Aug 21, 2026, Approval Gate unification) — reads/writes ONLY that
  // client's own scoped request queue and holdings, never the ambient module-level arrays.
  function approveSellRequest(clientId, requestId) {
    const clientRequests = readRequestsForClient(SELL_REQUESTS_KEY, clientId);
    const request = clientRequests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown sell request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('Sell request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }

    const clientHoldings = readHoldingsForClient(clientId);
    const holding = clientHoldings.find(function (h) { return h.productId === request.productId; });
    const currentUnits = holding ? holding.units : 0;
    if (request.unitsToSell > currentUnits + 1e-9) {
      throw new Error('Cannot approve sell request ' + requestId + ': only ' + currentUnits +
        ' units remain held, but ' + request.unitsToSell + ' were requested.');
    }

    const txnId = executeSell(clientId, request.productId, request.unitsToSell);

    request.status = 'approved';
    request.resolvedAt = todayStrUTC();
    request.transactionId = txnId;
    writeRequestsForClient(SELL_REQUESTS_KEY, clientId, clientRequests);
    return request;
  }

  function rejectSellRequest(clientId, requestId, reason) {
    const clientRequests = readRequestsForClient(SELL_REQUESTS_KEY, clientId);
    const request = clientRequests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown sell request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('Sell request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }

    request.status = 'rejected';
    request.resolvedAt = todayStrUTC();
    request.reason = reason || null;
    writeRequestsForClient(SELL_REQUESTS_KEY, clientId, clientRequests);
    return request;
  }

  // Same defensive-copy + requestedAtMs-backfill treatment as getAllocationRequests().
  function getSellRequests() {
    return sellRequests.map(withSortTimestamp);
  }

  // Cross-client aggregation (Aug 21, 2026, Approval Gate unification) — see
  // getAllClientAllocationRequests() above for the pattern this mirrors.
  function getAllClientSellRequests() {
    return clients.reduce(function (acc, c) {
      const key = scopedKeyForClient(SELL_REQUESTS_KEY, c.id);
      const requests = safeParse(localStorage.getItem(key)) || [];
      requests.forEach(function (r) {
        acc.push(Object.assign({}, withSortTimestamp(r), { clientId: c.id, clientName: c.name }));
      });
      return acc;
    }, []);
  }

  // ---- Deposit request queue (Admin tool Phase A) --------------------------------------
  // Mirrors the allocation/sell request pattern exactly: a client's requestDeposit() must
  // not move money or touch the ledger by itself, only creditDepositRequest() does — same
  // "request now, execute later" discipline as requestAllocation()/requestSell(). The one
  // real difference from those two: the amount that actually lands is a PM-entered figure
  // (creditDepositRequest's confirmedAmount), not necessarily what the client originally
  // typed on Deploy Capital — real-world wire fees, FX conversion, or a partial transfer can
  // all make the two differ, so confirmedAmount is authoritative and requestedAmount is kept
  // purely as the client's original claim for the PM to reconcile against.
  function requestDeposit(method, amount, currency, details) {
    if (method !== 'crypto' && method !== 'bank') {
      throw new Error('method must be either "crypto" or "bank".');
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      throw new Error('Deposit amount must be a positive number.');
    }
    if (!currency) {
      throw new Error('currency is required.');
    }

    const request = {
      id: nextSequentialId(depositRequests, 'DEP'),
      method: method,
      requestedAmount: round2(amount),
      currency: currency,
      status: 'pending',
      requestedAt: todayStrUTC(),
      requestedAtMs: Date.now(), // for stable cross-type sort ordering, same as allocation/sell requests
      resolvedAt: null,
      creditedAmount: null,
      transactionId: null,
      reason: null,
      details: details || null
    };
    depositRequests.push(request);
    persistDepositRequests();
    return request;
  }

  // confirmedAmount is the PM-entered figure and is what actually gets credited — NOT
  // request.requestedAmount. A DEPOSIT transaction has no productId/units/price (nothing was
  // bought), just totalValue, date, and the deposit method, per the deposit-specific
  // transaction shape below.
  // Explicit clientId (Aug 21, 2026, Approval Gate unification) — reads/writes ONLY that
  // client's own scoped request queue/account state/transaction ledger.
  function creditDepositRequest(clientId, requestId, confirmedAmount) {
    const clientRequests = readRequestsForClient(DEPOSIT_REQUESTS_KEY, clientId);
    const request = clientRequests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown deposit request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('Deposit request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }
    if (typeof confirmedAmount !== 'number' || !isFinite(confirmedAmount) || confirmedAmount <= 0) {
      throw new Error('confirmedAmount must be a positive number.');
    }

    const clientAccountState = readAccountStateForClient(clientId);
    clientAccountState.unallocatedCapital = round2(clientAccountState.unallocatedCapital + confirmedAmount);
    writeAccountStateForClient(clientId, clientAccountState);

    const txnId = appendTransactionForClient(clientId, {
      date: todayStrUTC(),
      productId: null,
      type: 'DEPOSIT',
      units: null,
      price: null,
      totalValue: round2(confirmedAmount),
      realizedReturn: null,
      status: 'Completed',
      method: request.method
    });

    request.status = 'credited';
    request.resolvedAt = todayStrUTC();
    request.creditedAmount = round2(confirmedAmount);
    request.transactionId = txnId;
    writeRequestsForClient(DEPOSIT_REQUESTS_KEY, clientId, clientRequests);
    return request;
  }

  function rejectDepositRequest(clientId, requestId, reason) {
    const clientRequests = readRequestsForClient(DEPOSIT_REQUESTS_KEY, clientId);
    const request = clientRequests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown deposit request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('Deposit request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }
    request.status = 'rejected';
    request.resolvedAt = todayStrUTC();
    request.reason = reason || null;
    writeRequestsForClient(DEPOSIT_REQUESTS_KEY, clientId, clientRequests);
    return request;
  }

  // Same defensive-copy + requestedAtMs-backfill treatment as getAllocationRequests()/getSellRequests().
  function getDepositRequests() {
    return depositRequests.map(withSortTimestamp);
  }

  // Cross-client aggregation (Aug 21, 2026, Approval Gate unification) — see
  // getAllClientAllocationRequests() above for the pattern this mirrors.
  function getAllClientDepositRequests() {
    return clients.reduce(function (acc, c) {
      const key = scopedKeyForClient(DEPOSIT_REQUESTS_KEY, c.id);
      const requests = safeParse(localStorage.getItem(key)) || [];
      requests.forEach(function (r) {
        acc.push(Object.assign({}, withSortTimestamp(r), { clientId: c.id, clientName: c.name }));
      });
      return acc;
    }, []);
  }

  // ---- HYS Deposit Approval Queue -------------------------------------------------------
  // Mirrors requestDeposit()/creditDepositRequest()/rejectDepositRequest()/getDepositRequests()
  // exactly in discipline (request now, execute later; PM-confirmed amount is authoritative,
  // not necessarily what the client typed), but against its own parallel store — see the
  // HYS_DEPOSIT_REQUESTS_KEY comment above for why this isn't just an extension of the
  // regular deposit queue.
  //
  // Rate tables intentionally mirror high-yield-savings.html's own SHORT_TERM_BRACKETS/
  // LOCKED_RATES exactly. This is real, if small, duplication — flagged rather than silently
  // accepted: the client page needs these for its own live preview (rate/maturity/interest
  // shown before the client ever submits), and the engine needs its OWN authoritative copy
  // so a submitted request's rate is derived from validated inputs, not trusted verbatim from
  // client-computed values, matching how every other money-affecting figure in this file
  // works (price ticks, advisory fee, etc.). If either table ever changes, update both.
  const HYS_SHORT_TERM_BRACKETS = [
    { max: 2, rate: 5 }, { max: 4, rate: 7 }, { max: 6, rate: 8.5 },
    { max: 8, rate: 9.5 }, { max: 10, rate: 10.5 }, { max: 12, rate: 12 }
  ];
  const HYS_LOCKED_RATES = { 1: 14, 2: 16, 3: 17.5, 4: 19, 5: 20 };

  function hysShortTermRate(months) {
    const bracket = HYS_SHORT_TERM_BRACKETS.find(function (b) { return months <= b.max; });
    return bracket ? bracket.rate : HYS_SHORT_TERM_BRACKETS[HYS_SHORT_TERM_BRACKETS.length - 1].rate;
  }

  // term is { mode: 'short'|'locked', value: number } for a Fixed Deposit pocket, or
  // null/omitted for an As You Want pocket (no term, no rate, no minimum — mirrors
  // high-yield-savings.html's own AYW rules exactly).
  function requestHYSDeposit(pocketType, term, amount, method, details) {
    if (pocketType !== 'fixed' && pocketType !== 'ayw') {
      throw new Error('pocketType must be either "fixed" or "ayw".');
    }
    if (method !== 'crypto' && method !== 'bank') {
      throw new Error('method must be either "crypto" or "bank".');
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      throw new Error('Deposit amount must be a positive number.');
    }

    let termMode = null, termValue = null, termLabel = null, termMonths = null, termYears = null, rate = null, termInYears = 0;

    if (pocketType === 'fixed') {
      if (amount < 5000) {
        throw new Error('Fixed Deposit pockets require a minimum of $5,000.');
      }
      if (!term || (term.mode !== 'short' && term.mode !== 'locked')) {
        throw new Error('term.mode must be either "short" or "locked" for a Fixed Deposit pocket.');
      }
      termMode = term.mode;
      termValue = term.value;
      if (termMode === 'short') {
        if (!Number.isInteger(termValue) || termValue < 1 || termValue > 12) {
          throw new Error('Short-term deposits must have a term between 1 and 12 months.');
        }
        termMonths = termValue;
        rate = hysShortTermRate(termMonths);
        termInYears = termMonths / 12;
        termLabel = termMonths + ' Month' + (termMonths > 1 ? 's' : '');
      } else {
        if (!Number.isInteger(termValue) || termValue < 1 || termValue > 5) {
          throw new Error('Locked deposits must have a term between 1 and 5 years.');
        }
        termYears = termValue;
        rate = HYS_LOCKED_RATES[termYears];
        termInYears = termYears;
        termLabel = termYears + ' Year' + (termYears > 1 ? 's' : '');
      }
    }

    const currency = method === 'crypto' ? ((details && details.asset) || 'CRYPTO') : 'USD';

    const request = {
      id: nextSequentialId(hysDepositRequests, 'HYSDEP'),
      pocketType: pocketType,
      termMode: termMode,
      termValue: termValue,
      termLabel: termLabel,
      termMonths: termMonths,
      termYears: termYears,
      rate: rate,
      termInYears: termInYears,
      requestedAmount: round2(amount),
      method: method,
      currency: currency,
      status: 'pending',
      requestedAt: todayStrUTC(),
      requestedAtMs: Date.now(),
      resolvedAt: null,
      creditedAmount: null,
      pocketId: null,
      transactionId: null,
      reason: null,
      details: details || null
    };
    hysDepositRequests.push(request);
    persistHYSDepositRequests();
    return request;
  }

  // Creates the pocket directly under the request's OWNER client's scoped key — since this
  // is called from the admin tool, "owner client" is whoever the PM currently has selected
  // (clientScopedKey() at call time), matching how every other admin credit/approve action
  // already resolves its target client. maturityDate is computed from TODAY (credit time),
  // not the original request date — a term deposit's clock starts when funds actually land,
  // not when the client asked to open it, so a pending request sitting in the queue for a
  // few days doesn't silently eat into the client's own term.
  // Explicit clientId (Aug 21, 2026, Approval Gate unification) — reads/writes ONLY that
  // client's own scoped request queue, pocket store, and transaction ledger. Previously this
  // already read/wrote HYS_POCKETS_KEY via a direct scoped access (never module-cached) —
  // that part only needed clientScopedKey() swapped for scopedKeyForClient(); the request
  // queue and transaction ledger needed the same explicit-client conversion as the other 3
  // domains.
  function creditHYSDeposit(clientId, requestId, confirmedAmount) {
    const clientRequests = readRequestsForClient(HYS_DEPOSIT_REQUESTS_KEY, clientId);
    const request = clientRequests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown HYS deposit request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('HYS deposit request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }
    if (typeof confirmedAmount !== 'number' || !isFinite(confirmedAmount) || confirmedAmount <= 0) {
      throw new Error('confirmedAmount must be a positive number.');
    }
    if (request.pocketType === 'fixed' && confirmedAmount < 5000) {
      throw new Error('Fixed Deposit pockets require a minimum of $5,000 — confirmedAmount is below that minimum.');
    }

    const now = new Date();
    let maturityDate = null;
    let projectedInterest = 0;
    if (request.pocketType === 'fixed') {
      const maturity = new Date(now);
      if (request.termMode === 'short') maturity.setMonth(maturity.getMonth() + request.termMonths);
      else maturity.setFullYear(maturity.getFullYear() + request.termYears);
      maturityDate = maturity.toISOString();
      projectedInterest = round2(confirmedAmount * (request.rate / 100) * request.termInYears);
    }

    const pocketsKey = scopedKeyForClient(HYS_POCKETS_KEY, clientId);
    const pockets = safeParse(localStorage.getItem(pocketsKey)) || [];
    // Same id format high-yield-savings.html's own createPocket() already uses — kept
    // identical rather than switching this one source to a different scheme, which would
    // leave two incompatible id formats mixed in the same array.
    const pocketId = 'pocket_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    pockets.push({
      id: pocketId,
      type: request.pocketType,
      amount: round2(confirmedAmount),
      status: 'active',
      createdAt: now.toISOString(),
      termMode: request.termMode,
      termLabel: request.termLabel,
      termMonths: request.termMonths,
      termYears: request.termYears,
      rate: request.rate,
      maturityDate: maturityDate,
      projectedInterest: projectedInterest,
      fundingMethod: request.method === 'crypto' ? 'crypto wallet' : 'bank account'
    });
    localStorage.setItem(pocketsKey, JSON.stringify(pockets));

    // HYS is its own pool, deliberately never touching unallocatedCapital/allocatedCapital
    // (matches the product's own "held apart from your main portfolio" rule) — so unlike
    // creditDepositRequest(), this never calls persistAccountState(). Still lands in the
    // shared transaction ledger (type HYS_DEPOSIT, distinct from DEPOSIT) so the activity is
    // visible in one place, per instruction.
    const txnId = appendTransactionForClient(clientId, {
      date: todayStrUTC(),
      productId: null,
      type: 'HYS_DEPOSIT',
      units: null,
      price: null,
      totalValue: round2(confirmedAmount),
      realizedReturn: null,
      status: 'Completed',
      method: request.method,
      pocketId: pocketId
    });

    request.status = 'credited';
    request.resolvedAt = todayStrUTC();
    request.creditedAmount = round2(confirmedAmount);
    request.pocketId = pocketId;
    request.transactionId = txnId;
    writeRequestsForClient(HYS_DEPOSIT_REQUESTS_KEY, clientId, clientRequests);
    return request;
  }

  function rejectHYSDeposit(clientId, requestId, reason) {
    const clientRequests = readRequestsForClient(HYS_DEPOSIT_REQUESTS_KEY, clientId);
    const request = clientRequests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown HYS deposit request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('HYS deposit request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }
    request.status = 'rejected';
    request.resolvedAt = todayStrUTC();
    request.reason = reason || null;
    writeRequestsForClient(HYS_DEPOSIT_REQUESTS_KEY, clientId, clientRequests);
    return request;
  }

  function getHYSDepositRequests() {
    return hysDepositRequests.map(withSortTimestamp);
  }

  // Cross-client aggregation (Aug 21, 2026, Approval Gate unification) — see
  // getAllClientAllocationRequests() above for the pattern this mirrors.
  function getAllClientHYSDepositRequests() {
    return clients.reduce(function (acc, c) {
      const key = scopedKeyForClient(HYS_DEPOSIT_REQUESTS_KEY, c.id);
      const requests = safeParse(localStorage.getItem(key)) || [];
      requests.forEach(function (r) {
        acc.push(Object.assign({}, withSortTimestamp(r), { clientId: c.id, clientName: c.name }));
      });
      return acc;
    }, []);
  }

  // ---- Settings Change Request queue (Request Change redesign, Aug 21, 2026) -------------
  // Replaces marketswave_settings_pending (field names only, no requested value, no reason,
  // no timestamp — see the SETTINGS_CHANGE_REQUESTS_KEY comment above). Not a module-level
  // load-or-seed store like allocation/sell/deposit requests: this is genuinely a
  // cross-client-facing queue by design (a future admin page lists requests from EVERY
  // client, not just whichever one is currently selected), so every function here reads/
  // writes the target client's scoped key directly, on demand — nothing cached in memory,
  // matching how creditHYSDeposit() already reads/writes marketswave_hys_pockets directly
  // rather than adding it to the main module-level pipeline.

  // Reads a client's four request-based profile fields, defaulting any field the store
  // doesn't have yet — mirrors settings.html's OWN { ...DEFAULTS, ...stored } pattern for
  // email/phone, applied here to the four fields that pattern doesn't cover. Exported
  // publicly (unlike most internal helpers) because settings.html's own display needs this
  // too, now that these fields have real storage instead of being 100% hardcoded HTML.
  function getSettingsProfile(clientId) {
    const key = clientId ? scopedKeyForClient(SETTINGS_PROFILE_KEY, clientId) : clientScopedKey(SETTINGS_PROFILE_KEY);
    const stored = safeParse(localStorage.getItem(key)) || {};
    const result = {};
    REQUESTABLE_SETTINGS_FIELDS.forEach(function (f) {
      result[f] = stored[f] !== undefined ? stored[f] : REQUESTABLE_SETTINGS_DEFAULTS[f];
    });
    return result;
  }

  // Structural validation per field — deliberately shallow (checks the fields the task's own
  // schema names are required, not exhaustive format validation like a real address
  // verification service would do). requestedValue is trusted as user-typed input the way
  // every other request function in this file trusts its own inputs; the point of the
  // snapshot-vs-trust distinction here is CURRENT value (read from the engine, never from the
  // client), not the requested value (which is inherently the client's own claim).
  function validateSettingsFieldValue(field, value) {
    if (field === 'legalName') {
      if (!value || !value.firstName || !value.lastName) {
        throw new Error('legalName requires both firstName and lastName.');
      }
    } else if (field === 'address') {
      if (!value || !value.street || !value.city) {
        throw new Error('address requires at least street and city.');
      }
    } else if (field === 'idDocument') {
      if (!value || !value.documentType) {
        throw new Error('idDocument requires documentType.');
      }
    }
  }

  // currentValue is snapshotted AUTOMATICALLY from the engine's own profile store — never
  // accepted as a caller-supplied parameter — so a client can't submit a request claiming a
  // fabricated "current" value. Rejects a second pending request for the same field rather
  // than silently allowing duplicates to pile up (settings.html's own UI already hides the
  // "Request Change" button while one is pending, but this is the same belt-and-suspenders
  // enforcement every other request function in this file applies at the engine level too).
  function requestSettingsChange(field, requestedValue, reason) {
    if (REQUESTABLE_SETTINGS_FIELDS.indexOf(field) === -1) {
      throw new Error('field must be one of: ' + REQUESTABLE_SETTINGS_FIELDS.join(', ') + '.');
    }
    validateSettingsFieldValue(field, requestedValue);

    const key = clientScopedKey(SETTINGS_CHANGE_REQUESTS_KEY);
    const requests = safeParse(localStorage.getItem(key)) || [];

    if (requests.some(function (r) { return r.field === field && r.status === 'pending'; })) {
      throw new Error('A pending change request already exists for ' + field + '.');
    }

    const request = {
      id: nextSequentialId(requests, 'SETTING'),
      field: field,
      currentValue: getSettingsProfile()[field],
      requestedValue: requestedValue,
      reason: reason || null,
      status: 'pending',
      requestedAt: todayStrUTC(),
      requestedAtMs: Date.now(),
      resolvedAt: null,
      resolutionNote: null
    };
    requests.push(request);
    localStorage.setItem(key, JSON.stringify(requests));
    return request;
  }

  // Takes an explicit clientId (unlike approveAllocationRequest()/approveSellRequest()/
  // creditDepositRequest(), which all resolve against whichever client is currently active)
  // — this queue is cross-client by design, so the admin page that will eventually call this
  // needs to target the specific client who submitted the request, not whoever the "Viewing
  // Client" selector happens to show. Genuinely applies the change to that client's actual
  // profile data (real storage now exists for these four fields for the first time) rather
  // than just clearing a flag.
  function approveSettingsChangeRequest(clientId, requestId) {
    const key = scopedKeyForClient(SETTINGS_CHANGE_REQUESTS_KEY, clientId);
    const requests = safeParse(localStorage.getItem(key)) || [];
    const request = requests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown settings change request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('Settings change request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }

    const profileKey = scopedKeyForClient(SETTINGS_PROFILE_KEY, clientId);
    const profile = safeParse(localStorage.getItem(profileKey)) || {};
    profile[request.field] = request.requestedValue;
    localStorage.setItem(profileKey, JSON.stringify(profile));

    request.status = 'approved';
    request.resolvedAt = todayStrUTC();
    localStorage.setItem(key, JSON.stringify(requests));
    return request;
  }

  // resolutionNote is deliberately a SEPARATE field from the client's own `reason` — the
  // client's reason is "why I want this change," the PM's resolutionNote is "why I'm
  // rejecting it." Conflating them would silently discard the client's original context.
  function rejectSettingsChangeRequest(clientId, requestId, resolutionNote) {
    const key = scopedKeyForClient(SETTINGS_CHANGE_REQUESTS_KEY, clientId);
    const requests = safeParse(localStorage.getItem(key)) || [];
    const request = requests.find(function (r) { return r.id === requestId; });
    if (!request) throw new Error('Unknown settings change request: ' + requestId);
    if (request.status !== 'pending') {
      throw new Error('Settings change request ' + requestId + ' is not pending (status: ' + request.status + ').');
    }
    request.status = 'rejected';
    request.resolvedAt = todayStrUTC();
    request.resolutionNote = resolutionNote || null;
    localStorage.setItem(key, JSON.stringify(requests));
    return request;
  }

  // Current client only — used by settings.html itself to check its own pending status per
  // field. See getAllClientSettingsChangeRequests() below for the cross-client admin queue
  // listing, added once the Settings Change admin queue was actually greenlit.
  function getSettingsChangeRequests() {
    const requests = safeParse(localStorage.getItem(clientScopedKey(SETTINGS_CHANGE_REQUESTS_KEY))) || [];
    return requests.map(withSortTimestamp);
  }

  // ---- Settings Change admin queue — cross-client aggregation (Aug 21, 2026) --------------
  // Mirrors getAllClientDocuments()/getAllClientSupportRequests(): reads every client's own
  // scoped request store directly via scopedKeyForClient(), tagging each record with
  // clientId/clientName for admin-settings-changes.html's cross-client listing. Approve/reject
  // themselves already take an explicit clientId (see above) — this is purely the missing
  // "list everyone's pending requests" reader that was deliberately held back in Step 1.
  function getAllClientSettingsChangeRequests() {
    return clients.reduce(function (acc, c) {
      const key = scopedKeyForClient(SETTINGS_CHANGE_REQUESTS_KEY, c.id);
      const requests = safeParse(localStorage.getItem(key)) || [];
      requests.forEach(function (r) {
        acc.push(Object.assign({}, withSortTimestamp(r), { clientId: c.id, clientName: c.name }));
      });
      return acc;
    }, []);
  }

  // ---- Client Authentication, Phase 1: credential storage (Aug 21, 2026) ------------------
  // This phase only gets credentials to actually exist somewhere real — it deliberately does
  // NOT touch login.html's actual check (Phase 2) or dashboard-sidebar.js's CLIENT-0001 pin
  // (Phase 3). Stateless, direct-scoped-storage-access-per-call, same discipline as the
  // Settings Change Request queue and the Account Security block below — no module-level
  // cache, since this is per-client state an admin-side or client-side caller might need for
  // an arbitrary/not-currently-active client.

  // The ONE place a raw password exists at all in this file. Takes it only as a function
  // parameter, uses it only within this function's own body, and returns before the caller
  // can do anything with it except pass the resulting hash straight into
  // setClientCredentials() — there is no module-level variable, no logging, no intermediate
  // object it gets attached to. Async because Web Crypto's crypto.subtle.digest() is
  // async-only; callers (signup.html) must await this.
  async function hashClientPassword(rawPassword) {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawPassword);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // Straightforward set/compare, per instruction — both take an ALREADY-HASHED password
  // (never a raw one), matching hashClientPassword()'s own contract that a raw password
  // never leaves that one function's scope. Explicit clientId (not ambient) since this needs
  // to work for a client being created right now (signup.html, before that client is
  // necessarily the active session) as well as for an arbitrary existing client.
  function setClientCredentials(clientId, passwordHash) {
    if (!clientId) throw new Error('setClientCredentials requires a clientId.');
    if (!passwordHash || typeof passwordHash !== 'string') {
      throw new Error('setClientCredentials requires a passwordHash string.');
    }
    localStorage.setItem(scopedKeyForClient(CLIENT_CREDENTIALS_KEY, clientId), JSON.stringify({ passwordHash: passwordHash }));
  }

  function verifyClientCredentials(clientId, passwordHash) {
    const stored = safeParse(localStorage.getItem(scopedKeyForClient(CLIENT_CREDENTIALS_KEY, clientId)));
    if (!stored || !stored.passwordHash) return false;
    return stored.passwordHash === passwordHash;
  }

  // ---- Client Authentication, Phase 2 (Aug 21, 2026): real login session -------------------
  // sessionStorage-backed, mirroring setAdminAuthenticated()/isAdminAuthenticated()/
  // clearAdminAuthenticated() exactly (ADMIN_AUTH_SESSION_KEY above) — resets per browser
  // session, no fallback to getCurrentClientId() or any other ambient value anywhere in this
  // trio. Stores the authenticated client's own id directly (not just a boolean the way the
  // admin gate does) since, unlike the admin gate — one shared passphrase, no persona to
  // distinguish — a real client login has to record WHICH client actually authenticated.
  const CLIENT_AUTH_SESSION_KEY = 'marketswave_authenticated_client_id';

  function setClientAuthenticated(clientId) {
    if (!clientId) throw new Error('setClientAuthenticated requires a clientId.');
    sessionStorage.setItem(CLIENT_AUTH_SESSION_KEY, clientId);
  }

  function getAuthenticatedClientId() {
    return sessionStorage.getItem(CLIENT_AUTH_SESSION_KEY);
  }

  function clearClientAuthentication() {
    sessionStorage.removeItem(CLIENT_AUTH_SESSION_KEY);
  }

  // ---- Account Security: Password Reset + 2FA Rework (Aug 21, 2026) -----------------------
  // Built cross-client from the start, using the exact discipline the Approval Gate
  // unification proved out (§4.60): every function below does a direct scoped read/write for
  // an explicit clientId, on demand — nothing cached in a module-level variable, no fallback
  // to getCurrentClientId() anywhere in the two admin-triggered actions. This mirrors the
  // Settings Change Request queue's own stateless discipline immediately above (never
  // module-cached to begin with) rather than the module-level-cached pattern the Approval
  // Gate task had to convert AWAY from — chosen deliberately so this domain never needs that
  // conversion later.
  //
  // SECURITY_LOG_KEY is genuinely global (like CLIENTS_KEY/CATALOG_KEY) — an audit trail
  // across every client, not scoped to one. getSecurityActionsLog()/appendSecurityLogEntry()
  // do a fresh localStorage read/write per call rather than a module-level cached array, for
  // the same reason every other cross-client-facing store in this file does: admin-security.html
  // must always see the latest log regardless of what page loaded last.

  // Shared by both resetClientPassword()/resetClient2FA() — appends one entry to the global
  // log and returns it. clientName is looked up from the (module-level, but genuinely global
  // and always-in-sync) Client Registry — safe to read here since, unlike the per-client
  // stores Approval Gate had to fix, there is only ever one Client Registry, not one per
  // client, so there's no "wrong client's copy" to go stale.
  function appendSecurityLogEntry(clientId, type, reason) {
    const log = safeParse(localStorage.getItem(SECURITY_LOG_KEY)) || [];
    const client = getClient(clientId);
    const entry = {
      id: nextSequentialId(log, 'SEC'),
      clientId: clientId,
      clientName: client ? client.name : clientId,
      type: type,
      reason: reason,
      performedAt: todayStrUTC(),
      performedBy: 'Portfolio Manager'
    };
    log.push(entry);
    localStorage.setItem(SECURITY_LOG_KEY, JSON.stringify(log));
    return entry;
  }

  // Deep-cloned per the established defensive-copy convention (getHoldings()/
  // getAllClientDocuments() etc.) — a caller mutating one returned entry must never affect
  // what's actually stored.
  function getSecurityActionsLog() {
    const log = safeParse(localStorage.getItem(SECURITY_LOG_KEY)) || [];
    return log.map(function (e) { return Object.assign({}, e); });
  }

  // Explicit clientId, admin-triggered. "Force new password" approach, given there's no real
  // login/session system yet (flagged per instruction, not silently decided): this sets a
  // per-client flag (forcePasswordReset) under SECURITY_STATE_KEY that settings.html reads on
  // every load and uses to gate its own UI client-side — there is no server session to
  // actually invalidate, so "force" here means "the client's own settings.html will not let
  // them past this screen until they submit a new password," not a real credential
  // invalidation. This is consistent with the rest of the project: the EXISTING self-service
  // Change Password form (settings.html) already doesn't persist an actual password anywhere
  // either (there is no real credential store in this codebase at all) — this reset flow
  // doesn't invent one, it just adds a flag that blocks the client's own page until they
  // complete the same already-existing (unpersisted) password form. Real enforcement — an
  // actual server rejecting stale credentials — needs the login gate + backend session work
  // already tracked as deferred; this is buildable now only as a client-side UI gate, not as
  // real security. See the Backend Requirements Register for the explicit callout.
  function resetClientPassword(clientId, reason) {
    if (!reason || !reason.trim()) {
      throw new Error('A reason is required to reset a client\'s password.');
    }
    const key = scopedKeyForClient(SECURITY_STATE_KEY, clientId);
    const state = safeParse(localStorage.getItem(key)) || {};
    state.forcePasswordReset = true;
    state.forcePasswordReason = reason.trim();
    state.forcePasswordFlaggedAt = todayStrUTC();
    localStorage.setItem(key, JSON.stringify(state));
    return appendSecurityLogEntry(clientId, 'PASSWORD_RESET', reason.trim());
  }

  // Explicit clientId, admin-triggered. Writes 'disabled' directly to the SAME raw key/format
  // settings.html's own 2FA code already reads (a bare 'enabled'/'disabled' string, not an
  // object) — chosen deliberately so settings.html's existing
  // `localStorage.getItem(STORAGE_KEY) === 'enabled'` read needs no changes at all to pick
  // this up on its next load; the reset just writes the same state that page would write to
  // itself if the client disabled 2FA on their own.
  function resetClient2FA(clientId, reason) {
    if (!reason || !reason.trim()) {
      throw new Error('A reason is required to reset a client\'s two-factor authentication.');
    }
    localStorage.setItem(scopedKeyForClient('marketswave_settings_2fa', clientId), 'disabled');
    return appendSecurityLogEntry(clientId, '2FA_RESET', reason.trim());
  }

  // ---- Client-facing reads (ambient — settings.html checking its OWN state) ---------------
  // Optional clientId mirrors getSettingsProfile(clientId?)'s own pattern: no argument reads
  // the currently active client (settings.html's normal usage); an explicit id is available
  // for any future admin surface that might want to check a specific client's flag without
  // switching the active session (not currently used by any page, but kept consistent with
  // every other client-state reader in this file rather than omitted).
  function getClientSecurityState(clientId) {
    const key = clientId ? scopedKeyForClient(SECURITY_STATE_KEY, clientId) : clientScopedKey(SECURITY_STATE_KEY);
    const stored = safeParse(localStorage.getItem(key)) || {};
    return {
      forcePasswordReset: stored.forcePasswordReset === true,
      forcePasswordReason: stored.forcePasswordReason || null,
      forcePasswordFlaggedAt: stored.forcePasswordFlaggedAt || null
    };
  }

  // Ambient, client-facing — called by settings.html once the client successfully submits the
  // forced "Set New Password" form. Clears the flag entirely rather than just flipping it to
  // false, since forcePasswordReason/forcePasswordFlaggedAt describe a NOW-RESOLVED reset, not
  // useful state to keep around (the permanent record of the action already lives in the
  // global security log via resetClientPassword()'s own appendSecurityLogEntry() call — this
  // per-client flag is purely "is a reset currently pending," nothing more).
  function clearForcePasswordReset() {
    const key = clientScopedKey(SECURITY_STATE_KEY);
    const state = safeParse(localStorage.getItem(key)) || {};
    state.forcePasswordReset = false;
    state.forcePasswordReason = null;
    state.forcePasswordFlaggedAt = null;
    localStorage.setItem(key, JSON.stringify(state));
  }

  // ---- Client Management page — per-client Approval Gate pending count (Aug 21, 2026) -----
  // Sums pending items across exactly the 5 "Approval Gate" queues (Deposits, Allocations,
  // Sells, HYS Deposits, Client Profile Updates — the same 5 queues admin-sidebar.js's own
  // 'approval-gate' nav group lists, §4.53), for one arbitrary client, on demand, without
  // switching the active session — same discipline as getAccountState(clientId?) above.
  // Deposits/Allocations/Sells/HYS are normally read via their own ambient-scoped getters
  // (getDepositRequests() etc., which only ever return the CURRENTLY ACTIVE client's own
  // requests) — this function bypasses that entirely and reads each store's raw scoped key
  // directly, the same way getAllClientDocuments()/getAllClientSupportRequests() already do
  // for their own domains, so a client that isn't currently active still gets an accurate
  // count. Documents/Support are deliberately excluded — they belong to the
  // 'user-admin-relations' nav group, not 'approval-gate'.
  function getClientPendingApprovalCount(clientId) {
    function countPending(baseKey) {
      const key = scopedKeyForClient(baseKey, clientId);
      const requests = safeParse(localStorage.getItem(key)) || [];
      return requests.filter(function (r) { return r.status === 'pending'; }).length;
    }
    return countPending(REQUESTS_KEY) + countPending(SELL_REQUESTS_KEY) +
      countPending(DEPOSIT_REQUESTS_KEY) + countPending(HYS_DEPOSIT_REQUESTS_KEY) +
      countPending(SETTINGS_CHANGE_REQUESTS_KEY);
  }

  function getTransactionLedger() {
    return transactions.slice();
  }

  // Explicit-clientId transaction lookup (Aug 21, 2026, Approval Gate unification) — reads
  // that client's own scoped ledger directly, for admin pages (e.g. admin-sells.html's
  // Realized Return column) that need one specific client's transaction without switching
  // the active session to them. Not a full getAllClientTransactions() aggregator since no
  // page needs every client's full ledger at once yet — just this narrower by-id lookup.
  function getTransactionForClient(clientId, txnId) {
    const key = scopedKeyForClient(TRANSACTIONS_KEY, clientId);
    const clientTransactions = safeParse(localStorage.getItem(key)) || [];
    const txn = clientTransactions.find(function (t) { return t.id === txnId; });
    return txn ? Object.assign({}, txn) : null;
  }

  // ---- Product Catalog API -------------------------------------------------
  // Defensive-copy reads (Aug 21, 2026 fix): getAllProducts()/getProduct() previously
  // returned live references into the module-level `catalog` array/its entries — the exact
  // same bug class Phase 3 already found and fixed once for getHoldings()/
  // getAllocationRequests() ("returning live object references, not clones... fixed to match
  // getAccountState()'s existing defensive-copy pattern"). Harmless while nothing ever wrote
  // back to the catalog outside buildSeedData()/settleProduct(), but this phase adds
  // editProduct(), which mutates a catalog entry in place — a caller holding an old
  // getProduct() reference across an edit would otherwise see it silently change underneath
  // them. Confirmed via grep that every existing caller (admin-allocations.html/
  // admin-sells.html/asset-performance.html/dashboard.html/transactions.html) only ever
  // reads from the result, never mutates it expecting persistence, so this is safe to fix now
  // rather than leave as a landmine for later.
  function getAllProducts() {
    return catalog.map(function (p) { return Object.assign({}, p); });
  }

  function getProduct(id) {
    const product = catalog.find(function (p) { return p.id === id; });
    return product ? Object.assign({}, product) : null;
  }

  // Asset Collection extraction + admin product management (Aug 21, 2026). The 5 locked
  // asset classes from CLAUDE.md, minus a 6th "value" that was never meant to be one:
  // 'Unallocated / Cash' is the catalog's synthetic representation of the Unallocated
  // bucket (exactly one instance, seeded once in buildSeedData(), never meant to be
  // multiplied) — PRODUCT_ASSET_CLASSES still lists it so validation accepts it on the ONE
  // existing Cash row if it's ever round-tripped through editProduct(), but
  // admin-products.html's own Add Product dropdown deliberately excludes it, so the admin
  // UI itself can't create a second one.
  const PRODUCT_ASSET_CLASSES = ['Private Equity', 'Real Assets', 'Stocks & ETFs', 'Crypto', 'Unallocated / Cash'];
  const PRODUCT_RISK_TIERS = ['conservative', 'balanced', 'aggressive'];
  // unitPrice is deliberately NOT here — see editProduct()'s own comment for why it's
  // blocked from this general field-patch path entirely, not just omitted from the admin
  // form. id/createdAt/lastTickDate/inceptionUnitPrice are immutable for the same reason
  // most identity/bookkeeping fields are immutable elsewhere in this file (transaction ids,
  // request timestamps, etc.) — they describe what already happened, not something to edit.
  const PRODUCT_EDITABLE_FIELDS = ['name', 'assetClass', 'investmentType', 'riskTier', 'minimumInvestment'];

  // Shared by addProduct() (validates the full new-product object, unitPrice checked
  // separately since it's the one field addProduct() needs but editProduct() forbids) and
  // editProduct() (validates the MERGED existing+patch object, so a partial patch — e.g.
  // only minimumInvestment changing — still gets full-object validation against a real,
  // already-valid product rather than false-failing on fields the caller didn't touch).
  function validateProductFields(fields) {
    if (!fields.name || !String(fields.name).trim()) {
      throw new Error('Product name is required.');
    }
    if (PRODUCT_ASSET_CLASSES.indexOf(fields.assetClass) === -1) {
      throw new Error('assetClass must be one of: ' + PRODUCT_ASSET_CLASSES.join(', ') + '.');
    }
    if (!fields.investmentType || !String(fields.investmentType).trim()) {
      throw new Error('Investment type is required.');
    }
    if (PRODUCT_RISK_TIERS.indexOf(fields.riskTier) === -1) {
      throw new Error('riskTier must be one of: ' + PRODUCT_RISK_TIERS.join(', ') + '.');
    }
    if (typeof fields.minimumInvestment !== 'number' || !isFinite(fields.minimumInvestment) || fields.minimumInvestment < 0) {
      throw new Error('minimumInvestment must be a non-negative number.');
    }
  }

  // Starting unit price is PM-entered here (this form), not a live feed — consistent with
  // the standing scoping decision that real-world market data stays deferred (Backend
  // Requirements Register). Becomes BOTH unitPrice and inceptionUnitPrice for the new
  // product, with lastTickDate seeded to today — the identical "nothing visually jumps until
  // a real day passes" pattern buildSeedData() already established for the original 5
  // products, applied here for the first time to a product created after initial seed.
  function addProduct(product) {
    if (typeof product.unitPrice !== 'number' || !isFinite(product.unitPrice) || product.unitPrice <= 0) {
      throw new Error('Starting unit price must be a positive number.');
    }
    validateProductFields(product);

    let maxNum = 0;
    catalog.forEach(function (p) {
      const match = /^PROD-(\d+)$/.exec(p.id);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    });
    const id = 'PROD-' + String(maxNum + 1).padStart(4, '0');
    const today = todayStrUTC();
    const newProduct = {
      id: id,
      name: String(product.name).trim(),
      assetClass: product.assetClass,
      investmentType: String(product.investmentType).trim(),
      riskTier: product.riskTier,
      minimumInvestment: product.minimumInvestment,
      unitPrice: round2(product.unitPrice),
      inceptionUnitPrice: round2(product.unitPrice),
      createdAt: today,
      lastTickDate: today
    };
    catalog.push(newProduct);
    persistCatalog();
    return Object.assign({}, newProduct);
  }

  // Renames/reclassifies an EXISTING product in place. Never changes `id` — holdings and
  // transactions only ever reference a product by its PROD-id string, never embed its name/
  // class/anything else, and always join to live catalog data via getProduct(id) at render
  // time (confirmed by reading every caller — admin-allocations.html/admin-sells.html/
  // asset-performance.html/dashboard.html/transactions.html — none of them cache a product's
  // name/class anywhere persistent). This means a rename or reclassification here is
  // automatically reflected everywhere a holding/transaction/request displays that product,
  // with nothing to migrate and no possibility of orphaning existing client data, BY
  // CONSTRUCTION — not something this function has to separately guarantee.
  //
  // JUDGMENT CALL, flagged rather than silently decided: unitPrice edits are blocked here
  // entirely (see PRODUCT_EDITABLE_FIELDS) — the returns engine's own deterministic tick
  // mechanic (settleProduct()) is the only thing that should ever move a product's price, so
  // a manual admin overwrite from a general "edit product" form could silently corrupt every
  // client's unrealized-return math for that product. The one real gap this leaves: there is
  // currently no way to correct a data-entry typo in a product's STARTING price after
  // addProduct() has already run (no removeProduct() exists either, so a mis-priced product
  // also can't be deleted and re-added clean). If that turns out to be a real operational
  // need, it should be a separate, deliberate, clearly-labeled "override" capability — not
  // silently folded into this general edit path.
  function editProduct(id, patch) {
    const product = catalog.find(function (p) { return p.id === id; });
    if (!product) throw new Error('Unknown product: ' + id + '.');

    const patchKeys = Object.keys(patch || {});
    const disallowed = patchKeys.filter(function (k) { return PRODUCT_EDITABLE_FIELDS.indexOf(k) === -1; });
    if (disallowed.length > 0) {
      throw new Error('editProduct() cannot change: ' + disallowed.join(', ') + '. unitPrice moves only via the returns engine\'s own tick mechanic, never a manual override from this form; id/createdAt/lastTickDate/inceptionUnitPrice are immutable once a product exists.');
    }

    const merged = Object.assign({}, product, patch);
    validateProductFields(merged);

    PRODUCT_EDITABLE_FIELDS.forEach(function (key) {
      if (key in patch) product[key] = patch[key];
    });
    if (typeof product.name === 'string') product.name = product.name.trim();
    if (typeof product.investmentType === 'string') product.investmentType = product.investmentType.trim();

    persistCatalog();
    return Object.assign({}, product);
  }

  // ---- Client Registry API (Multi-Client Data Model Phase, Step 1) ------------------------
  // Global/unscoped, same reasoning as the Product Catalog: one registry shared across every
  // client, not a per-client store. Deliberately mirrors getAllProducts()/getProduct()/
  // addProduct()'s exact shape (defensive-copy reads, nextSequentialId-assigned writes) for
  // consistency with the one existing global-store precedent in this file.
  function getAllClients() {
    return clients.map(function (c) { return Object.assign({}, c); });
  }

  function getClient(id) {
    const client = clients.find(function (c) { return c.id === id; });
    return client ? Object.assign({}, client) : null;
  }

  // Client Authentication, Phase 2 (Aug 21, 2026): login.html needs to resolve an entered
  // email to a clientId before it can check anything. Case-insensitive / trimmed, matching
  // how email addresses are conventionally compared everywhere else in practice; returns
  // null (not an error) for no match, so login.html can fold "unknown email" and "wrong
  // password" into the same generic failure without a special case here.
  function getClientByEmail(email) {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    const client = clients.find(function (c) { return (c.email || '').trim().toLowerCase() === normalized; });
    return client ? Object.assign({}, client) : null;
  }

  // Multi-Client Data Model Phase, Step 5 (Aug 21, 2026): writes a fresh, minimal set of
  // per-client stores directly to the NEW client's scoped keys — deliberately bypassing
  // clientScopedKey()/getCurrentClientId() (which still resolve to whichever client is
  // CURRENTLY active, typically CLIENT-0001, at the moment addClient() is called) and the
  // module-level catalog/accountState/holdings/etc. variables (which likewise still belong
  // to the current client). Without this, a newly added client's first engine load would
  // fall through to buildSeedData()'s rich CLIENT-0001-shaped demo portfolio (same 4
  // products, same $1,284,500 total) purely because nothing yet existed under its scoped
  // keys — cloning demo data into every new client, not the "fresh account, modest starting
  // cash, no holdings" a real new client should start with. Holdings/transactions/every
  // request queue/documents all start empty; only unallocatedCapital is nonzero.
  function seedMinimalClientStores(clientId, startingUnallocatedCapital) {
    const freshAccountState = {
      unallocatedCapital: round2(startingUnallocatedCapital),
      allocatedCapital: 0,
      assetReturns: 0,
      advisoryFeeRate: 1.25
    };
    localStorage.setItem(scopedKeyForClient(ACCOUNT_KEY, clientId), JSON.stringify(freshAccountState));
    localStorage.setItem(scopedKeyForClient(HOLDINGS_KEY, clientId), JSON.stringify([]));
    localStorage.setItem(scopedKeyForClient(TRANSACTIONS_KEY, clientId), JSON.stringify([]));
    localStorage.setItem(scopedKeyForClient(REQUESTS_KEY, clientId), JSON.stringify([]));
    localStorage.setItem(scopedKeyForClient(SELL_REQUESTS_KEY, clientId), JSON.stringify([]));
    localStorage.setItem(scopedKeyForClient(DEPOSIT_REQUESTS_KEY, clientId), JSON.stringify([]));
    localStorage.setItem(scopedKeyForClient(DOCUMENTS_KEY, clientId), JSON.stringify([]));
  }

  // startingUnallocatedCapital is accepted as an input field purely to seed the new client's
  // account state — it is NOT part of the Client Registry's own record shape (name, email,
  // phone, accountType, id, createdAt), so it's destructured out here rather than spread
  // into newClient, keeping every persisted client record's fields consistent regardless of
  // whether a caller passed it.
  function addClient(client) {
    const startingUnallocatedCapital = client.startingUnallocatedCapital || 0;
    const clientFields = Object.assign({}, client);
    delete clientFields.startingUnallocatedCapital;

    const newClient = Object.assign({ createdAt: todayStrUTC() }, clientFields, { id: nextSequentialId(clients, 'CLIENT') });
    clients.push(newClient);
    persistClients();
    seedMinimalClientStores(newClient.id, startingUnallocatedCapital);
    return newClient;
  }

  // ---- Account State + Holdings API ----------------------------------------
  // Optional clientId (Aug 21, 2026, admin-clients.html) mirrors getSettingsProfile()'s own
  // pattern: with no argument, returns the CURRENTLY ACTIVE client's in-memory state exactly
  // as before (unchanged behavior for every existing caller); with an explicit clientId, reads
  // that client's scoped key directly from localStorage on demand — nothing cached, same
  // "arbitrary client, on-demand" discipline as getAllClientDocuments()/
  // getAllClientSupportRequests() — so a client-list page can show every client's real
  // balance without switching the active session context (and without the "reload-to-switch"
  // cost that would imply for each row).
  function getAccountState(clientId) {
    if (clientId) {
      const key = scopedKeyForClient(ACCOUNT_KEY, clientId);
      return safeParse(localStorage.getItem(key)) || null;
    }
    return Object.assign({}, accountState);
  }

  // Deep-cloned per holding, not just a sliced array — executeBuy()/executeSell() mutate
  // holding objects in place internally, so a shallow .slice() would let a caller's "before"
  // snapshot silently change value after a later, unrelated engine call. Matches
  // getAccountState()'s existing defensive-copy convention.
  function getHoldings() {
    return holdings.map(function (h) { return Object.assign({}, h); });
  }

  // The ONLY place Total Portfolio Value should ever be computed. No page should calculate
  // it independently once wired to this engine in a later phase. Optional clientId mirrors
  // getAccountState()'s own new optional param, computed from that same on-demand read rather
  // than duplicating the formula against raw storage.
  function getTotalPortfolioValue(clientId) {
    const state = clientId ? getAccountState(clientId) : accountState;
    if (!state) return 0;
    return state.unallocatedCapital + state.allocatedCapital + state.assetReturns;
  }

  // ---- Unrealized return preview (pure reads, nothing persisted) -----------------------
  // Computed on demand from current holdings + current unitPrice — never written to
  // localStorage, since this isn't a recorded event, just a live "what if I looked right
  // now" figure. Distinct from Account State's assetReturns, which stays realized-only per
  // the locked rule (a return never silently moves through here into that field).
  function getUnrealizedReturn(productId) {
    const holding = holdings.find(function (h) { return h.productId === productId; });
    if (!holding) return 0;
    const product = getProduct(productId);
    if (!product) return 0;
    return round2(holding.units * product.unitPrice - holding.costBasis);
  }

  function getUnrealizedReturnPercent(productId) {
    const holding = holdings.find(function (h) { return h.productId === productId; });
    if (!holding || holding.costBasis === 0) return 0;
    return round2((getUnrealizedReturn(productId) / holding.costBasis) * 100);
  }

  function getTotalUnrealizedReturns() {
    return round2(holdings.reduce(function (sum, h) {
      return sum + getUnrealizedReturn(h.productId);
    }, 0));
  }

  // ---- Documents & Reporting (Aug 20, 2026) ---------------------------------------------
  // A separate, independent data store from the portfolio engine above — documents.html's
  // own client-side data layer, migrated here purely to centralize storage (localStorage key
  // marketswave_documents), matching the pattern already used for products/holdings/
  // transactions. No portfolio/financial logic involved; this is a plain CRUD store plus one
  // computed-aggregate reader for notification counts, now reusable by any page rather than
  // living only inside documents.html's own script.
  // Mirrors documents.html's original hardcoded rows exactly, in the same order, so
  // migrating to this store doesn't change what a fresh install shows.
  const SEED_DOCUMENTS = [
    { filename: 'Custody Agreement Amendment.pdf', category: 'Signature Required', direction: 'from', date: '2026-08-14', status: 'Signature Required', isNew: true, deadlineLabel: 'Due in 5 days' },
    { filename: 'Q2 2026 Performance Report.pdf', category: 'Statements & Reports', direction: 'from', date: '2026-08-10', status: null, isNew: true, deadlineLabel: null },
    { filename: 'Investment Management Agreement.pdf', category: 'Contracts', direction: 'from', date: '2026-08-02', status: null, isNew: false, deadlineLabel: null },
    { filename: 'July 2026 Account Statement.pdf', category: 'Statements & Reports', direction: 'from', date: '2026-08-01', status: null, isNew: false, deadlineLabel: null },
    { filename: 'Market Outlook — Q3 2026.pdf', category: 'General', direction: 'from', date: '2026-08-05', status: null, isNew: false, deadlineLabel: null },
    { filename: 'Form ADV Part 2A.pdf', category: 'General', direction: 'from', date: '2026-07-15', status: null, isNew: false, deadlineLabel: null },
    { filename: 'Proof of Address.pdf', category: 'General', direction: 'upload', date: '2026-08-12', status: 'Received', isNew: false, deadlineLabel: null },
    { filename: 'Q2 Bank Statement.pdf', category: 'Statements & Reports', direction: 'upload', date: '2026-08-09', status: 'Under Review', isNew: false, deadlineLabel: null }
  ];

  let documents = safeParse(localStorage.getItem(clientScopedKey(DOCUMENTS_KEY)));
  if (!documents) {
    documents = SEED_DOCUMENTS.map(function (seed, index) {
      return Object.assign({ id: 'DOC-' + String(index + 1).padStart(4, '0') }, seed);
    });
    localStorage.setItem(clientScopedKey(DOCUMENTS_KEY), JSON.stringify(documents));
  }

  function persistDocuments() {
    localStorage.setItem(clientScopedKey(DOCUMENTS_KEY), JSON.stringify(documents));
  }

  // Deep-cloned per document (same reason as getHoldings()/getAllocationRequests()):
  // updateDocument() mutates document objects in place internally.
  function getDocuments() {
    return documents.map(function (d) { return Object.assign({}, d); });
  }

  function getDocument(id) {
    const doc = documents.find(function (d) { return d.id === id; });
    return doc ? Object.assign({}, doc) : null;
  }

  function addDocument(doc) {
    const newDoc = Object.assign(
      { status: null, isNew: false, deadlineLabel: null, date: todayStrUTC() },
      doc,
      { id: nextSequentialId(documents, 'DOC') }
    );
    documents.push(newDoc);
    persistDocuments();
    return newDoc;
  }

  // General-purpose mutator — merges patch fields into the document and persists. The Sign
  // workflow needs more than one field to change atomically (status, isNew, deadlineLabel
  // all clear together), so this is the primitive; updateDocumentStatus() below is a thin
  // convenience wrapper over it for the common single-field case.
  function updateDocument(id, patch) {
    const idx = documents.findIndex(function (d) { return d.id === id; });
    if (idx === -1) return null;
    documents[idx] = Object.assign({}, documents[idx], patch);
    persistDocuments();
    return Object.assign({}, documents[idx]);
  }

  function updateDocumentStatus(id, newStatus) {
    return updateDocument(id, { status: newStatus });
  }

  function removeDocument(id) {
    const idx = documents.findIndex(function (d) { return d.id === id; });
    if (idx === -1) return false;
    documents.splice(idx, 1);
    persistDocuments();
    return true;
  }

  // Reusable aggregate reader — previously computed only inside documents.html's own script
  // by reading DOM data-* attributes; now callable from any page that loads engine-core.js.
  function getDocumentNotificationCounts() {
    const newCount = documents.reduce(function (n, d) { return d.isNew ? n + 1 : n; }, 0);
    const signatureCount = documents.reduce(function (n, d) { return d.status === 'Signature Required' ? n + 1 : n; }, 0);
    const deadlineCount = documents.reduce(function (n, d) { return d.deadlineLabel ? n + 1 : n; }, 0);
    const urgentCount = documents.reduce(function (n, d) { return (d.isNew || d.status === 'Signature Required') ? n + 1 : n; }, 0);
    return { newCount: newCount, signatureCount: signatureCount, deadlineCount: deadlineCount, urgentCount: urgentCount };
  }

  // ---- Documents admin queue — cross-client aggregation (Aug 21, 2026) --------------------
  // The Documents store above stays owned by the CURRENTLY ACTIVE client via clientScopedKey()
  // — these three functions are admin-only additions for the new cross-client Documents queue
  // (admin-documents.html), reading/writing an ARBITRARY client's scoped key directly, the
  // same explicit-clientId pattern already established for Settings Change requests.
  function getAllClientDocuments() {
    return clients.reduce(function (acc, c) {
      const key = scopedKeyForClient(DOCUMENTS_KEY, c.id);
      const docs = safeParse(localStorage.getItem(key)) || [];
      docs.forEach(function (d) {
        acc.push(Object.assign({}, d, { clientId: c.id, clientName: c.name }));
      });
      return acc;
    }, []);
  }

  function updateDocumentForClient(clientId, docId, patch) {
    const key = scopedKeyForClient(DOCUMENTS_KEY, clientId);
    const docs = safeParse(localStorage.getItem(key)) || [];
    const idx = docs.findIndex(function (d) { return d.id === docId; });
    if (idx === -1) throw new Error('Unknown document: ' + docId + ' for client ' + clientId);
    docs[idx] = Object.assign({}, docs[idx], patch);
    localStorage.setItem(key, JSON.stringify(docs));
    return Object.assign({}, docs[idx]);
  }

  // Delivers a new "From Marketswave" document straight into a specific client's store — the
  // callable primitive the task asked for, rather than admin-documents.html duplicating
  // documents.html's own internal row-construction logic. dueDate (optional, 'YYYY-MM-DD') is
  // converted into the same 'Due in N days' deadlineLabel format documents.html's seed data
  // already uses, computed relative to today so it stays accurate regardless of when it's read.
  function publishDocumentToClient(clientId, input) {
    if (!input || !input.filename || !input.category) {
      throw new Error('publishDocumentToClient requires filename and category.');
    }
    const key = scopedKeyForClient(DOCUMENTS_KEY, clientId);
    const docs = safeParse(localStorage.getItem(key)) || [];
    let deadlineLabel = null;
    if (input.dueDate) {
      const dueMs = new Date(input.dueDate + 'T00:00:00Z').getTime();
      const todayMs = new Date(todayStrUTC() + 'T00:00:00Z').getTime();
      const days = Math.round((dueMs - todayMs) / 86400000);
      deadlineLabel = days <= 0 ? 'Due today' : 'Due in ' + days + (days === 1 ? ' day' : ' days');
    }
    const newDoc = {
      id: nextSequentialId(docs, 'DOC'),
      filename: input.filename,
      category: input.category,
      direction: 'from',
      date: todayStrUTC(),
      status: input.signatureRequired ? 'Signature Required' : null,
      isNew: true,
      deadlineLabel: deadlineLabel
    };
    docs.push(newDoc);
    localStorage.setItem(key, JSON.stringify(docs));
    return newDoc;
  }

  // ---- Support/Disputes admin queue — cross-client aggregation (Aug 21, 2026) -------------
  // marketswave_support_requests itself stays owned by support.html (its own client only ever
  // reads/writes its own scoped key, unchanged) — a deliberate scope call already flagged in
  // CLAUDE.md/the handover doc when the notification bell was built (support requests read
  // directly from localStorage rather than migrated into this file). These two functions are
  // an ADMIN-ONLY addition, not a full migration: they read/write the same raw key for an
  // arbitrary client, mirroring the Documents functions above, without touching support.html's
  // own self-contained logic at all.
  const SUPPORT_REQUESTS_KEY = 'marketswave_support_requests';

  function getAllClientSupportRequests() {
    return clients.reduce(function (acc, c) {
      const key = scopedKeyForClient(SUPPORT_REQUESTS_KEY, c.id);
      const requests = safeParse(localStorage.getItem(key)) || [];
      requests.forEach(function (r) {
        acc.push(Object.assign({}, r, { clientId: c.id, clientName: c.name }));
      });
      return acc;
    }, []);
  }

  function updateSupportRequestForClient(clientId, requestId, patch) {
    const key = scopedKeyForClient(SUPPORT_REQUESTS_KEY, clientId);
    const requests = safeParse(localStorage.getItem(key)) || [];
    const idx = requests.findIndex(function (r) { return r.id === requestId; });
    if (idx === -1) throw new Error('Unknown support request: ' + requestId + ' for client ' + clientId);
    requests[idx] = Object.assign({}, requests[idx], patch);
    localStorage.setItem(key, JSON.stringify(requests));
    return Object.assign({}, requests[idx]);
  }

  // ---- Debug / inspector — console-only, manual verification, no page should call this ---
  function engineDebugDump() {
    /* eslint-disable no-console */
    console.log('%c=== Marketswave Engine — Product Catalog ===', 'font-weight:bold');
    console.table(catalog);

    console.log('%c=== Marketswave Engine — Account State ===', 'font-weight:bold');
    console.log(accountState);
    console.log('getTotalPortfolioValue():', getTotalPortfolioValue());

    console.log('%c=== Marketswave Engine — Holdings ===', 'font-weight:bold');
    console.table(holdings.map(function (h) {
      const product = getProduct(h.productId);
      return {
        productId: h.productId,
        productName: product ? product.name : '(unknown product)',
        units: h.units,
        unitPrice: product ? product.unitPrice : null,
        currentValue: product ? round2(h.units * product.unitPrice) : null,
        costBasis: h.costBasis
      };
    }));

    const reconstructedAllocated = round2(holdings.reduce(function (sum, h) {
      const product = getProduct(h.productId);
      return sum + h.units * (product ? product.unitPrice : 0);
    }, 0));
    console.log(
      'Consistency check — Account State allocatedCapital:', accountState.allocatedCapital,
      '| sum(holdings units x unitPrice):', reconstructedAllocated,
      '| match:', accountState.allocatedCapital === reconstructedAllocated
    );
    /* eslint-enable no-console */
  }

  window.getProduct = getProduct;
  window.getAllProducts = getAllProducts;
  window.addProduct = addProduct;
  window.editProduct = editProduct;
  window.getAllClients = getAllClients;
  window.getClient = getClient;
  window.getClientByEmail = getClientByEmail;
  window.addClient = addClient;
  window.hashClientPassword = hashClientPassword;
  window.setClientCredentials = setClientCredentials;
  window.verifyClientCredentials = verifyClientCredentials;
  window.setClientAuthenticated = setClientAuthenticated;
  window.getAuthenticatedClientId = getAuthenticatedClientId;
  window.clearClientAuthentication = clearClientAuthentication;
  window.setCurrentClientId = setCurrentClientId;
  window.getCurrentClientId = getCurrentClientId;
  window.clientScopedKey = clientScopedKey;
  window.checkAdminPassphrase = checkAdminPassphrase;
  window.setAdminAuthenticated = setAdminAuthenticated;
  window.isAdminAuthenticated = isAdminAuthenticated;
  window.clearAdminAuthenticated = clearAdminAuthenticated;
  window.getAccountState = getAccountState;
  window.getHoldings = getHoldings;
  window.getTotalPortfolioValue = getTotalPortfolioValue;
  window.settleProduct = settleProduct;
  window.settleAllProducts = settleAllProducts;
  window.getAdvisoryFeeAccrued = getAdvisoryFeeAccrued;
  window.setAdvisoryFeeRate = setAdvisoryFeeRate;
  window.getUnrealizedReturn = getUnrealizedReturn;
  window.getUnrealizedReturnPercent = getUnrealizedReturnPercent;
  window.getTotalUnrealizedReturns = getTotalUnrealizedReturns;
  window.requestAllocation = requestAllocation;
  window.approveAllocationRequest = approveAllocationRequest;
  window.rejectAllocationRequest = rejectAllocationRequest;
  window.getAllocationRequests = getAllocationRequests;
  window.getAllClientAllocationRequests = getAllClientAllocationRequests;
  window.executeBuy = executeBuy;
  window.executeSell = executeSell;
  window.requestSell = requestSell;
  window.approveSellRequest = approveSellRequest;
  window.rejectSellRequest = rejectSellRequest;
  window.getSellRequests = getSellRequests;
  window.getAllClientSellRequests = getAllClientSellRequests;
  window.requestDeposit = requestDeposit;
  window.creditDepositRequest = creditDepositRequest;
  window.rejectDepositRequest = rejectDepositRequest;
  window.getDepositRequests = getDepositRequests;
  window.getAllClientDepositRequests = getAllClientDepositRequests;
  window.requestHYSDeposit = requestHYSDeposit;
  window.creditHYSDeposit = creditHYSDeposit;
  window.rejectHYSDeposit = rejectHYSDeposit;
  window.getHYSDepositRequests = getHYSDepositRequests;
  window.getAllClientHYSDepositRequests = getAllClientHYSDepositRequests;
  window.getSettingsProfile = getSettingsProfile;
  window.requestSettingsChange = requestSettingsChange;
  window.approveSettingsChangeRequest = approveSettingsChangeRequest;
  window.rejectSettingsChangeRequest = rejectSettingsChangeRequest;
  window.getSettingsChangeRequests = getSettingsChangeRequests;
  window.getAllClientSettingsChangeRequests = getAllClientSettingsChangeRequests;
  window.resetClientPassword = resetClientPassword;
  window.resetClient2FA = resetClient2FA;
  window.getSecurityActionsLog = getSecurityActionsLog;
  window.getClientSecurityState = getClientSecurityState;
  window.clearForcePasswordReset = clearForcePasswordReset;
  window.getClientPendingApprovalCount = getClientPendingApprovalCount;
  window.getTransactionLedger = getTransactionLedger;
  window.getTransactionForClient = getTransactionForClient;
  window.getDocuments = getDocuments;
  window.getDocument = getDocument;
  window.addDocument = addDocument;
  window.updateDocument = updateDocument;
  window.updateDocumentStatus = updateDocumentStatus;
  window.removeDocument = removeDocument;
  window.getDocumentNotificationCounts = getDocumentNotificationCounts;
  window.getAllClientDocuments = getAllClientDocuments;
  window.updateDocumentForClient = updateDocumentForClient;
  window.publishDocumentToClient = publishDocumentToClient;
  window.getAllClientSupportRequests = getAllClientSupportRequests;
  window.updateSupportRequestForClient = updateSupportRequestForClient;
  window.engineDebugDump = engineDebugDump;
})();
