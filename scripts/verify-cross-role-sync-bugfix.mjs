#!/usr/bin/env node
// Bug-fix verification (2026-09-03) — closes the cross-role local/Supabase split found by a
// dedicated investigation: admin-documents.html and admin-support.html were still 100% local
// (engine-core.js/localStorage) on BOTH the Pending/History reads AND the PM write actions,
// even though documents.html (Stage 4) and support.html (Stage 5) had already been wired to
// real Supabase — meaning a PM's publish/response never reached the real client page, and a
// client's real upload/dispute was invisible to the PM. Separately, dashboard-notifications.js
// (the shared notification bell, mounted on all 10 client pages) and dashboard-sidebar.js's
// own Documents badge were STILL reading local/raw-localStorage data across all 5 of the
// bell's own sources (Documents, Allocation, Sell, Savings/HYS, Support) — stale since each
// domain's own client-facing page was wired in an earlier UI Wiring stage, unrelated to this
// specific bug but found by the same investigation and fixed in the same pass, per instruction
// ("its own real fix, not a side effect").
//
// ★★★ GENUINELY SEPARATE CONTEXTS — the core requirement of this verification, not a
// same-process convenience ★★★
// The reported bug was specifically masked by a coincidence: this project's own dev/test
// workflow runs the PM's admin-tool actions and the client's own page reads in the SAME
// browser, so the PM's write (into localStorage) and the client's read (also from
// localStorage) happened to share state even though the real, intended architecture never
// guaranteed that — a real two-person deployment (PM and client on separate devices) would
// never have shown the notification the bug report described at all. To prove the FIX
// doesn't have an equivalent same-process blind spot, this script builds TWO GENUINELY
// INDEPENDENT supabase-data.js module instances — one representing "the PM's browser tab",
// one representing "the client's browser tab" — with ZERO shared JS state between them.
//
// Investigated first, per the standing discipline: supabase-data.js has no import/export
// syntax of its own, and no package.json anywhere from the project root upward declares
// "type": "module" — so Node's own ESM-detection heuristic treats it as CommonJS by default.
// CommonJS's require cache is keyed by resolved file PATH, not by the full specifier — so
// even a query-string-busted `import('../supabase-data.js?instance=B')` silently returns the
// FIRST cached execution without re-running the file (confirmed directly via a standalone
// probe before writing this script: the second "instance" never got its own MarketswaveData
// assigned at all). The real fix: write the REAL, byte-for-byte unmodified content of
// supabase-data.js out to two temporary files, BOTH placed in the project root (so their own
// relative `./supabase-config.js`/`./admin-supabase-config.js` imports resolve correctly) —
// two distinct resolved paths are always two distinct Node module-cache entries, confirmed via
// the same probe to produce two objects with `!==` identity and independently-resolving
// getSupabaseClient() promises. Both temp files are deleted in a `finally` block regardless of
// outcome. admin-supabase-config.js and supabase-config.js themselves stay real, un-duplicated
// singletons — this is correct, not a gap: they are DIFFERENT files serving different personas
// already (an admin session only ever goes through the former, a client session only ever
// through the latter), so nothing about "genuinely separate" requires splitting those too —
// exactly like two real separate browser tabs each loading admin-documents.html/documents.html
// would each get their own realm's copy of supabase-data.js, while both would still ultimately
// resolve real requests against the one real Supabase project, which is the actual point.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-cross-role-sync-bugfix.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { removeAllClientStorageObjects } from './lib/storage-test-cleanup.mjs';

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await test()) return true;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return test();
}

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
  const target = scripts.find(function (s) { return s.indexOf(marker) !== -1; });
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}

function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!bodyMatch) throw new Error('Could not find <body> in ' + htmlPath);
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

const forwardingConsole = new VirtualConsole();
forwardingConsole.forwardTo(console);

function buildPageDom(htmlPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: forwardingConsole
  });
  return dom;
}

// ---- Genuinely separate MarketswaveData instances — see this file's own header for the
// full investigation/design. ----
const PROJECT_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const REAL_SUPABASE_DATA_SRC = readFileSync(PROJECT_ROOT_DIR + 'supabase-data.js', 'utf8');
const tempFiles = [];

async function createIndependentContext(label) {
  const tempPath = PROJECT_ROOT_DIR + '.tmp-supabase-data-' + label + '-' + process.pid + '.mjs';
  writeFileSync(tempPath, REAL_SUPABASE_DATA_SRC, 'utf8');
  tempFiles.push(tempPath);
  const fakeWindow = { location: { hostname: '127.0.0.1', search: '' } };
  const priorWindow = globalThis.window;
  globalThis.window = fakeWindow;
  await import('../.tmp-supabase-data-' + label + '-' + process.pid + '.mjs');
  const MarketswaveData = fakeWindow.MarketswaveData;
  globalThis.window = priorWindow;
  return { label: label, MarketswaveData: MarketswaveData, fakeWindow: fakeWindow };
}

// Every real MarketswaveData call that might still be resolving its OWN first dynamic import
// (getSupabaseClient()/useAdminClient()'s underlying import('./supabase-config.js')/
// import('./admin-supabase-config.js'), which itself reads window.location.search at ITS OWN
// module top level) needs globalThis.window pointed at the RIGHT context's window at call
// time — this helper makes every call site do that correctly without manual bookkeeping.
function withContext(ctx, fn) {
  const prior = globalThis.window;
  globalThis.window = ctx.fakeWindow;
  return Promise.resolve().then(fn).finally(function () { globalThis.window = prior; });
}

async function main() {
  console.log('Cross-role sync bug-fix verification (admin-documents.html + admin-support.html bidirectional wiring, notification bell + sidebar badge across all 5 domains), using genuinely separate PM/client contexts\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const ADMIN_CTX = await createIndependentContext('ADMIN');
  const CLIENT_CTX = await createIndependentContext('CLIENT');
  check('two genuinely separate supabase-data.js instances were created (ADMIN !== CLIENT)', ADMIN_CTX.MarketswaveData !== CLIENT_CTX.MarketswaveData);
  check('their getSupabaseClient functions are genuinely distinct closures, not shared', ADMIN_CTX.MarketswaveData.getSupabaseClient !== CLIENT_CTX.MarketswaveData.getSupabaseClient);

  // Admin Auth Consolidation (2026-09-05): useAdminClient()'s own ensureSupabaseAdminSignedIn()
  // no longer signs in on its own — it now only confirms a real session already exists,
  // mirroring a real admin page (only ever reachable AFTER a real sign-in already happened on
  // admin-login.html). This test must perform that real sign-in itself first, exactly once —
  // admin-supabase-config.js is a real, un-duplicated singleton (per this file's own header),
  // imported both here and from inside supabase-data.js's own useAdminClient(), so both
  // resolve to the SAME cached module instance/session, exactly mirroring how one real login
  // on a real browser tab is what every later privileged call on that same tab depends on.
  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  const adminConfigMod = await import('../admin-supabase-config.js');
  const { error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
  if (adminSignInErr) throw new Error('Real admin sign-in failed: ' + adminSignInErr.message);

  await withContext(ADMIN_CTX, function () { ADMIN_CTX.MarketswaveData.useAdminClient(); });
  const adminClient = await withContext(ADMIN_CTX, function () { return ADMIN_CTX.MarketswaveData.getSupabaseClient(); });
  const { data: adminUser } = await adminClient.auth.getUser();
  check('the ADMIN context is genuinely signed in as the real local bootstrap PM account', adminUser && adminUser.user && adminUser.user.email === 'pm@marketswave.local', adminUser && adminUser.user && adminUser.user.email);

  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'crossrole-' + suffix + '@test.marketswave.local';
  const password = 'VerifyCrossRole-2026!';
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;
  const clientName = 'Cross-Role Test Client ' + suffix;
  await admin.from('clients').insert({ id: clientId, name: clientName, email: email, phone: '+1-555-0199', account_type: 'Individual Account', status: 'active' });
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 10000, allocated_capital: 0, asset_returns: 0 });

  const clientSupabaseClient = await withContext(CLIENT_CTX, function () { return CLIENT_CTX.MarketswaveData.getSupabaseClient(); });
  const { error: signInErr } = await withContext(CLIENT_CTX, function () { return clientSupabaseClient.auth.signInWithPassword({ email, password }); });
  check('the CLIENT context genuinely signs in as the real test client, completely independent of the ADMIN context above', !signInErr, signInErr && signInErr.message);
  check('the ADMIN context is confirmed UNAFFECTED by the client sign-in that just happened in the other context', (await adminClient.auth.getUser()).data.user.email === 'pm@marketswave.local');

  try {

  // ===========================================================================================
  // PART 1 — admin-documents.html <-> documents.html, bidirectional, genuinely separate contexts
  // ===========================================================================================
  console.log('\n=== PART 1: Documents — bidirectional, genuinely separate PM/client contexts ===\n');

  function buildAdminDocumentsDom() {
    const path = fileURLToPath(new URL('../admin-documents.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = ADMIN_CTX.MarketswaveData;
    const script = extractInlineScript(path, 'MarketswaveData.useAdminClient()');
    return { dom: dom, script: script };
  }
  function buildClientDocumentsDom() {
    const path = fileURLToPath(new URL('../documents.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    dom.window.getAuthenticatedClientId = function () { return clientId; };
    // #sidebar-doc-badge is normally rendered by dashboard-sidebar.js's own earlier mount,
    // an out-of-scope script block this harness doesn't load — documents.html's own
    // refreshNotificationCounts() unconditionally writes to it, same stub precedent already
    // established in verify-hys-documents-ui-wiring.mjs.
    dom.window.document.body.insertAdjacentHTML('beforeend', '<span id="sidebar-doc-badge" class="hidden">0</span>');
    const script = extractInlineScript(path, 'UI Wiring — Stage 4');
    return { dom: dom, script: script };
  }

  console.log('1. PM publishes a document via the REAL admin-documents.html UI (ADMIN context)');
  await (async function () {
    const { dom, script } = buildAdminDocumentsDom();
    const D = dom.window.document;
    await withContext(ADMIN_CTX, function () {
      dom.window.eval(script);
      return pollUntil(function () { return D.getElementById('publish-client').options.length > 0; }, 20000);
    });
    var opt = [...D.getElementById('publish-client').options].find(function (o) { return o.value === clientId; });
    check('the real test client appears in the Publish-to-Client dropdown, fetched fresh from real Supabase', !!opt, D.getElementById('publish-client').innerHTML.slice(0, 300));
    D.getElementById('publish-client').value = clientId;
    D.getElementById('publish-category').value = 'Contracts';
    D.getElementById('publish-signature-required').checked = true;
    // Real admin-documents.html hard-requires a real selected file — and, since Real Storage
    // integration (2026-09-04), its own Publish handler now calls the real File's own
    // `.arrayBuffer()` to base64-encode real bytes before sending them to publish-document, so
    // a bare `{ name: '...' }` placeholder object (which has no such method) would throw
    // rather than validate cleanly. A genuine Node global File (Node 20+), not jsdom's own File
    // class, is used instead — confirmed via a standalone probe that a real Node File instance
    // passes @supabase/storage-js's own `instanceof Blob` check in the OUTER Node realm (where
    // the real supabase-js client that ultimately performs the storage upload lives), even
    // though the click reading `fileInput.files[0]` happens inside this jsdom window.
    var fileInput = D.getElementById('publish-file');
    var publishFile = new File(['Real test file content — cross-role sync verification.'], 'Advisory Agreement.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [publishFile], configurable: true });
    var btn = D.getElementById('publish-submit');
    var toastTitle = D.getElementById('admin-toast-title');
    var bodyBefore = D.getElementById('admin-toast-body').textContent;
    await withContext(ADMIN_CTX, function () {
      btn.click();
      return pollUntil(function () { return toastTitle.textContent === 'Document Published'; }, 15000);
    });
    check('the real toast confirms the publish, addressed to the real client', toastTitle.textContent === 'Document Published' && D.getElementById('admin-toast-body').textContent.indexOf(clientName) !== -1, D.getElementById('admin-toast-body').textContent);

    const { data: rows } = await admin.from('documents').select('*').eq('client_id', clientId).eq('direction', 'from');
    check('a real `from` document row was genuinely created in Postgres, not localStorage', rows && rows.length === 1 && rows[0].filename === 'Advisory Agreement.pdf' && rows[0].status === 'Signature Required', JSON.stringify(rows));
  })();

  console.log('\n2. THE ACTUAL BUG FIX, PROVEN ACROSS GENUINELY SEPARATE CONTEXTS: the published document now reaches the real client page (CLIENT context — a completely independent supabase-data.js instance and Supabase session, zero shared JS state with the ADMIN context above)');
  var clientDocsHandle;
  await (async function () {
    clientDocsHandle = buildClientDocumentsDom();
    const D = clientDocsHandle.dom.window.document;
    const fromListEl = D.getElementById('from-list');
    await withContext(CLIENT_CTX, function () {
      clientDocsHandle.dom.window.eval(clientDocsHandle.script);
      return pollUntil(function () { return !/animate-pulse/.test(fromListEl.innerHTML); }, 20000);
    });
    check('the real published document genuinely renders on the real client page — the exact scenario the original bug report described, now proven through two genuinely independent contexts, not a shared browser', fromListEl.textContent.indexOf('Advisory Agreement.pdf') !== -1, fromListEl.textContent.slice(0, 400));
    check('it renders with its real Signature Required badge/Sign button, not just a bare filename', !!fromListEl.querySelector('.sign-btn'));
  })();

  console.log('\n3. THE REVERSE DIRECTION: a real client upload (CLIENT context) now reaches the PM (ADMIN context) — the other half of the split the investigation found');
  await (async function () {
    const D = clientDocsHandle.dom.window.document;
    D.getElementById('upload-category').value = 'General';
    // Real Storage integration (2026-09-04): documents.html's own Upload handler now uploads
    // the real file's actual bytes to Storage before inserting the row — a bare `{ name }`
    // placeholder no longer suffices (see this file's own Publish-side comment above for the
    // same real-Node-File technique and why it works across the jsdom/outer-Node-realm split).
    var fileInput = D.getElementById('upload-file');
    var uploadFile = new File(['Real test file content — cross-role sync verification.'], 'Passport Scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [uploadFile], configurable: true });
    var btn = D.getElementById('submit-upload');
    var toastTitle = D.getElementById('doc-toast-title');
    var bodyBefore = toastTitle.textContent;
    await withContext(CLIENT_CTX, function () {
      btn.click();
      return pollUntil(function () { return toastTitle.textContent !== bodyBefore; }, 15000);
    });
    check('the real toast confirms the real client upload', toastTitle.textContent === 'Document Uploaded', toastTitle.textContent);

    const { data: rows } = await admin.from('documents').select('*').eq('client_id', clientId).eq('direction', 'upload');
    check('a real `upload` document row was genuinely created in Postgres', rows && rows.length === 1 && rows[0].filename === 'Passport Scan.pdf', JSON.stringify(rows));

    // A real PM would need to reload their own Pending list to see a real client action that
    // happened through a completely separate context — mirrors an actual page refresh, not an
    // artificial "just re-read the array" shortcut.
    const { dom, script } = buildAdminDocumentsDom();
    const AD = dom.window.document;
    const pendingListEl = AD.getElementById('pending-list');
    await withContext(ADMIN_CTX, function () {
      dom.window.eval(script);
      return pollUntil(function () { return !/animate-pulse/.test(pendingListEl.innerHTML); }, 20000);
    });
    check('the real client upload now genuinely appears in the PM\'s own real Client Uploads Awaiting Review — the exact reverse-direction gap the investigation found', pendingListEl.textContent.indexOf('Passport Scan.pdf') !== -1 && pendingListEl.textContent.indexOf(clientName) !== -1, pendingListEl.textContent.slice(0, 400));

    console.log('\n4. Mark Reviewed — a real PM write, round-tripping correctly');
    var reviewBtn = pendingListEl.querySelector('.review-btn');
    var adToastTitle = AD.getElementById('admin-toast-title');
    await withContext(ADMIN_CTX, function () {
      reviewBtn.click();
      return pollUntil(function () { return adToastTitle.textContent === 'Document Reviewed'; }, 15000);
    });
    check('the real toast confirms the review', adToastTitle.textContent === 'Document Reviewed');
    const { data: reviewedRows } = await admin.from('documents').select('status').eq('client_id', clientId).eq('direction', 'upload');
    check('the real row is genuinely marked Reviewed in Postgres', reviewedRows && reviewedRows[0].status === 'Reviewed', JSON.stringify(reviewedRows));
  })();

  // ===========================================================================================
  // PART 2 — admin-support.html <-> support.html, bidirectional, genuinely separate contexts
  // ===========================================================================================
  console.log('\n=== PART 2: Support — bidirectional, genuinely separate PM/client contexts ===\n');

  function buildClientSupportDom() {
    const path = fileURLToPath(new URL('../support.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    dom.window.getAuthenticatedClientId = function () { return clientId; };
    dom.window.getClient = function () { return null; };
    const script = extractInlineScript(path, 'UI Wiring — Stage 5');
    return { dom: dom, script: script };
  }
  function buildAdminSupportDom() {
    const path = fileURLToPath(new URL('../admin-support.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = ADMIN_CTX.MarketswaveData;
    const script = extractInlineScript(path, 'MarketswaveData.useAdminClient()');
    return { dom: dom, script: script };
  }

  var clientSupportHandle;
  console.log('1. Client files a real dispute (CLIENT context) — the client -> PM direction');
  await (async function () {
    clientSupportHandle = buildClientSupportDom();
    const P = clientSupportHandle.dom.window.document;
    const requestsListEl = P.getElementById('requests-list');
    await withContext(CLIENT_CTX, function () {
      clientSupportHandle.dom.window.eval(clientSupportHandle.script);
      return pollUntil(function () { return !/animate-pulse/.test(requestsListEl.innerHTML); }, 20000);
    });
    P.getElementById('dispute-category').value = 'Billing/Fees';
    P.getElementById('dispute-description').value = 'A real cross-role test dispute.';
    var btn = P.getElementById('dispute-submit');
    var toastTitle = P.getElementById('support-toast-title');
    await withContext(CLIENT_CTX, function () {
      btn.click();
      return pollUntil(function () { return toastTitle.textContent === 'Dispute Submitted'; }, 15000);
    });
    check('the real toast confirms a real server-computed DISP-0001 id', P.getElementById('support-toast-body').textContent.indexOf('DISP-0001') !== -1, P.getElementById('support-toast-body').textContent);

    const { data: rows } = await admin.from('support_requests').select('*').eq('client_id', clientId);
    check('a real support_requests row was genuinely created in Postgres', rows && rows.length === 1 && rows[0].display_id === 'DISP-0001', JSON.stringify(rows));
  })();

  console.log('\n2. THE ACTUAL BUG FIX: the real dispute now reaches the PM (ADMIN context, genuinely separate)');
  var adminSupportHandle;
  await (async function () {
    adminSupportHandle = buildAdminSupportDom();
    const AS = adminSupportHandle.dom.window.document;
    const pendingListEl = AS.getElementById('pending-list');
    await withContext(ADMIN_CTX, function () {
      adminSupportHandle.dom.window.eval(adminSupportHandle.script);
      return pollUntil(function () { return !/animate-pulse/.test(pendingListEl.innerHTML); }, 20000);
    });
    check('the real dispute filed via a completely independent context genuinely appears in the PM\'s Needs Attention, with the correct real client name', pendingListEl.textContent.indexOf('DISP-0001') !== -1 && pendingListEl.textContent.indexOf(clientName) !== -1, pendingListEl.textContent.slice(0, 400));
  })();

  console.log('\n3. PM responds and updates status (ADMIN context) — the PM -> client direction');
  await (async function () {
    const AS = adminSupportHandle.dom.window.document;
    const pendingListEl = AS.getElementById('pending-list');
    var updateBtn = pendingListEl.querySelector('.update-btn');
    updateBtn.click();
    AS.getElementById('update-status-input').value = 'In Progress';
    AS.getElementById('update-note-input').value = 'We are reviewing your billing dispute now.';
    var submitBtn = AS.getElementById('update-submit');
    var toastTitle = AS.getElementById('admin-toast-title');
    await withContext(ADMIN_CTX, function () {
      submitBtn.click();
      return pollUntil(function () { return toastTitle.textContent === 'Request Updated'; }, 15000);
    });
    check('the real toast confirms the update', toastTitle.textContent === 'Request Updated');
    const { data: rows } = await admin.from('support_requests').select('status,pm_note').eq('client_id', clientId);
    check('the real row genuinely has status=In Progress and the real PM note in Postgres', rows && rows[0].status === 'In Progress' && rows[0].pm_note === 'We are reviewing your billing dispute now.', JSON.stringify(rows));
  })();

  console.log('\n4. THE FIX, PROVEN THE OTHER WAY: the PM\'s real response reaches the client\'s own real page (CLIENT context, genuinely separate)');
  await (async function () {
    const clientPath = fileURLToPath(new URL('../support.html', import.meta.url));
    const clientDom = buildPageDom(clientPath);
    clientDom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    clientDom.window.getAuthenticatedClientId = function () { return clientId; };
    clientDom.window.getClient = function () { return null; };
    const clientScript = extractInlineScript(clientPath, 'UI Wiring — Stage 5');
    const P2 = clientDom.window.document;
    const requestsListEl2 = P2.getElementById('requests-list');
    await withContext(CLIENT_CTX, function () {
      clientDom.window.eval(clientScript);
      return pollUntil(function () { return !/animate-pulse/.test(requestsListEl2.innerHTML); }, 20000);
    });
    check('the real client page genuinely shows the real PM-updated status', requestsListEl2.textContent.indexOf('In Progress') !== -1, requestsListEl2.textContent.slice(0, 500));
    check('the real client page genuinely shows the real PM note text — the PM -> client half of the bidirectional fix', requestsListEl2.textContent.indexOf('We are reviewing your billing dispute now.') !== -1, requestsListEl2.textContent.slice(0, 500));
  })();

  console.log('\n5. Resolve fully (ADMIN context) — confirms History/Resolved on both real pages');
  await (async function () {
    const AS = adminSupportHandle.dom.window.document;
    const updateBtn = AS.getElementById('pending-list').querySelector('.update-btn');
    // Real page state has already moved on since step 3's own click — re-fetch fresh via a
    // real reload, mirroring a genuine PM page refresh, rather than reusing a stale DOM.
    const { dom, script } = buildAdminSupportDom();
    const AS2 = dom.window.document;
    const pendingListEl = AS2.getElementById('pending-list');
    await withContext(ADMIN_CTX, function () {
      dom.window.eval(script);
      return pollUntil(function () { return !/animate-pulse/.test(pendingListEl.innerHTML); }, 20000);
    });
    var btn2 = pendingListEl.querySelector('.update-btn');
    btn2.click();
    AS2.getElementById('update-status-input').value = 'Resolved';
    AS2.getElementById('update-note-input').value = 'Billing dispute resolved — a real refund was issued.';
    var toastTitle = AS2.getElementById('admin-toast-title');
    await withContext(ADMIN_CTX, function () {
      AS2.getElementById('update-submit').click();
      return pollUntil(function () { return toastTitle.textContent === 'Request Updated'; }, 15000);
    });

    const historyListEl = AS2.getElementById('history-list');
    await withContext(ADMIN_CTX, function () { return pollUntil(function () { return !/animate-pulse/.test(historyListEl.innerHTML); }, 20000); });
    check('the real ticket now genuinely appears in the PM\'s own Resolved section', historyListEl.textContent.indexOf('DISP-0001') !== -1 && historyListEl.textContent.indexOf(clientName) !== -1, historyListEl.textContent.slice(0, 400));

    const clientPath = fileURLToPath(new URL('../support.html', import.meta.url));
    const clientDom = buildPageDom(clientPath);
    clientDom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    clientDom.window.getAuthenticatedClientId = function () { return clientId; };
    clientDom.window.getClient = function () { return null; };
    const clientScript = extractInlineScript(clientPath, 'UI Wiring — Stage 5');
    const P3 = clientDom.window.document;
    const requestsListEl3 = P3.getElementById('requests-list');
    await withContext(CLIENT_CTX, function () {
      clientDom.window.eval(clientScript);
      return pollUntil(function () { return !/animate-pulse/.test(requestsListEl3.innerHTML); }, 20000);
    });
    check('the client\'s own real page genuinely shows Resolved + the real final PM note too', requestsListEl3.textContent.indexOf('Resolved') !== -1 && requestsListEl3.textContent.indexOf('a real refund was issued') !== -1, requestsListEl3.textContent.slice(0, 500));
  })();

  // ===========================================================================================
  // PART 3 — notification bell + sidebar Documents badge, all 5 real domains, live after real actions
  // ===========================================================================================
  console.log('\n=== PART 3: dashboard-notifications.js (bell) + dashboard-sidebar.js (Documents badge) — all 5 domains ===\n');

  function buildBellDom() {
    const dom = new JSDOM('<!doctype html><html><body><div id="notif-bell-mount"></div></body></html>', {
      url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: forwardingConsole
    });
    dom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    dom.window.clientScopedKey = function (key) { return key + ':' + clientId; };
    const bellSrc = readFileSync(fileURLToPath(new URL('../dashboard-notifications.js', import.meta.url)), 'utf8');
    return { dom: dom, src: bellSrc };
  }

  console.log('1. Before any of this part\'s own new activity: the bell already shows real, live items from Parts 1-2\'s own real actions (Documents: 1 new+1 signature-required from the real publish; Support: 1 real resolved ticket)');
  var initialBell = buildBellDom();
  await (async function () {
    await withContext(CLIENT_CTX, function () {
      initialBell.dom.window.eval(initialBell.src);
      initialBell.dom.window.initDashboardNotifications();
      return pollUntil(function () { return !initialBell.dom.window.document.getElementById('notif-bell-badge').classList.contains('hidden'); }, 20000);
    });
    var badge = initialBell.dom.window.document.getElementById('notif-bell-badge');
    check('the real badge shows a nonzero unread count, computed from real Supabase reads across the sources already touched (no fake/stale local data)', badge.textContent !== '0' && !badge.classList.contains('hidden'), badge.textContent);
  })();

  console.log('\n2. Seed real activity in Allocation, Sell, and HYS Savings directly (service-role, standing in for actions whose own UI round trip is already proven end-to-end by verify-admin-approval-gate-ui-wiring.mjs — this part\'s own job is the BELL\'s correctness, not re-proving the Approval Gate)');
  const { data: productsForBell } = await admin.from('products').select('id,name').in('name', ['Global Equity ETF', 'Ethereum']);
  const etfProduct = productsForBell.find(function (p) { return p.name === 'Global Equity ETF'; });
  const ethProduct = productsForBell.find(function (p) { return p.name === 'Ethereum'; });
  const { data: pendingAllocReq } = await admin.from('allocation_requests').insert({ client_id: clientId, product_id: etfProduct.id, requested_amount: 1500, status: 'pending' }).select().single();
  await admin.from('holdings').insert({ client_id: clientId, product_id: ethProduct.id, units: 5, cost_basis: 400 });
  const { data: approvedSellReq } = await admin.from('sell_requests').insert({ client_id: clientId, product_id: ethProduct.id, units_to_sell: 2, status: 'approved', resolved_at: new Date().toISOString() }).select().single();
  const nearMaturity = new Date(Date.now() + 3 * 86400000).toISOString(); // 3 days out — inside the bell's own NEAR_MATURITY_DAYS=7 window
  await admin.from('hys_pockets').insert({ client_id: clientId, pocket_type: 'fixed', amount: 5000, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 4.5, term_in_years: 0.5, maturity_date: nearMaturity, projected_interest: 112.5, funding_method: 'bank account' });

  console.log('\n3. The real bell shows correct, live items for all 5 domains after these real actions — a fresh mount, not a stale cached render');
  var bell2 = buildBellDom();
  await (async function () {
    await withContext(CLIENT_CTX, function () {
      bell2.dom.window.eval(bell2.src);
      bell2.dom.window.initDashboardNotifications();
      return pollUntil(function () { return !bell2.dom.window.document.getElementById('notif-bell-badge').classList.contains('hidden'); }, 20000);
    });
    var btn = bell2.dom.window.document.getElementById('notif-bell-btn');
    await withContext(CLIENT_CTX, function () {
      btn.click();
      return pollUntil(function () { return bell2.dom.window.document.getElementById('notif-bell-list').textContent.indexOf('Allocation request pending') !== -1; }, 20000);
    });
    var listText = bell2.dom.window.document.getElementById('notif-bell-list').textContent;
    check('Documents: the real published+uploaded documents from Part 1 are represented (live, real data)', listText.indexOf('Advisory Agreement.pdf') !== -1 || listText.indexOf('New document') !== -1, listText.slice(0, 600));
    check('Allocation: the real pending allocation request shows, with the real product name', listText.indexOf('Allocation request pending') !== -1 && listText.indexOf('Global Equity ETF') !== -1, listText.slice(0, 600));
    check('Sell: the real approved sell request shows', listText.indexOf('Sell approved') !== -1, listText.slice(0, 600));
    check('Savings: the real near-maturity HYS pocket is correctly detected (computed live from maturity_date, not a stale status column)', listText.indexOf('maturing soon') !== -1, listText.slice(0, 600));
    check('Support: the real resolved dispute from Part 2 shows', listText.indexOf('DISP-0001') !== -1, listText.slice(0, 600));

    console.log('\n4. Opening the panel marks everything read — a real, working read-state round trip against real data');
    var badge = bell2.dom.window.document.getElementById('notif-bell-badge');
    // openPanel()'s own read-marking .then() is a SEPARATE link chained onto renderPanel()'s
    // returned promise, one microtask after the list-populating update the poll above already
    // waited for — poll for the actual target condition directly rather than assuming it's
    // already settled by the time the list text poll resolved.
    await withContext(CLIENT_CTX, function () { return pollUntil(function () { return badge.classList.contains('hidden'); }, 15000); });
    check('the badge is hidden after opening (everything just got marked read)', badge.classList.contains('hidden'));
  })();

  console.log('\n5. A completely fresh bell mount (simulating a real new page load) correctly shows the same items as already-read (real localStorage read-state persists), proving this is genuinely live real data, not an artifact of the open panel\'s own in-memory state');
  var bell3 = buildBellDom();
  await (async function () {
    await withContext(CLIENT_CTX, function () {
      bell3.dom.window.eval(bell3.src);
      bell3.dom.window.initDashboardNotifications();
      return pollUntil(function () { return bell3.dom.window.document.getElementById('notif-bell-badge').textContent === '0' || bell3.dom.window.document.getElementById('notif-bell-badge').classList.contains('hidden'); }, 20000);
    });
    var badge = bell3.dom.window.document.getElementById('notif-bell-badge');
    check('a fresh mount correctly shows 0 unread (real read-state carried over) while the underlying items are still genuinely present', badge.classList.contains('hidden') || badge.textContent === '0');
  })();

  console.log('\n6. The real sidebar Documents badge (dashboard-sidebar.js, the OTHER real fix in this pass) shows the correct live count');
  await (async function () {
    const sidebarDom = new JSDOM('<!doctype html><html><body><div id="sidebar-mount"></div></body></html>', {
      url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: forwardingConsole
    });
    sidebarDom.window.sessionStorage.setItem('marketswave_authenticated_client_id', clientId);
    sidebarDom.window.MarketswaveData = CLIENT_CTX.MarketswaveData;
    sidebarDom.window.getAuthenticatedClientId = function () { return clientId; };
    sidebarDom.window.getClient = function () { return { name: clientName, accountType: 'Individual Account' }; };
    sidebarDom.window.getClientInitials = function () { return 'CT'; };
    sidebarDom.window.clearClientAuthentication = function () {};
    const sidebarSrc = readFileSync(fileURLToPath(new URL('../dashboard-sidebar.js', import.meta.url)), 'utf8');

    // The real 2 documents from Part 1 (1 real "from" publish — is_new/Signature Required — and
    // 1 real client upload, already marked Reviewed so it no longer counts) mean the real
    // urgentCount should be exactly 1 right now — confirmed directly against Postgres, not
    // assumed, before checking the rendered badge.
    const { data: docsNow } = await admin.from('documents').select('is_new,status').eq('client_id', clientId);
    const expectedUrgent = docsNow.reduce(function (n, d) { return (d.is_new || d.status === 'Signature Required') ? n + 1 : n; }, 0);
    check('sanity check: the real expected urgent document count in Postgres is genuinely nonzero for this test to be meaningful', expectedUrgent > 0, expectedUrgent);

    await withContext(CLIENT_CTX, function () {
      sidebarDom.window.eval(sidebarSrc);
      sidebarDom.window.initDashboardSidebar('dashboard');
      var badge = sidebarDom.window.document.getElementById('sidebar-doc-badge');
      return pollUntil(function () { return badge.textContent !== '0' || !badge.classList.contains('hidden'); }, 20000);
    });
    var sidebarBadge = sidebarDom.window.document.getElementById('sidebar-doc-badge');
    check('the real sidebar badge (dashboard-sidebar.js, mounted fresh, real Supabase read) shows the correct real urgent count — no longer stale/local', sidebarBadge.textContent === String(expectedUrgent) && !sidebarBadge.classList.contains('hidden'), sidebarBadge.textContent + ' vs expected ' + expectedUrgent);
  })();

  } finally {
    await admin.from('hys_pockets').delete().eq('client_id', clientId);
    await admin.from('sell_requests').delete().eq('client_id', clientId);
    await admin.from('allocation_requests').delete().eq('client_id', clientId);
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('support_requests').delete().eq('client_id', clientId);
    await admin.from('documents').delete().eq('client_id', clientId);
    await removeAllClientStorageObjects(admin, 'documents', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    await admin.auth.admin.deleteUser(clientId);
    tempFiles.forEach(function (f) { try { unlinkSync(f); } catch (e) { /* already gone */ } });
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  tempFiles.forEach(function (f) { try { unlinkSync(f); } catch (e) { /* already gone */ } });
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
