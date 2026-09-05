#!/usr/bin/env node
// Real Supabase Storage integration for Documents (2026-09-04) — replaces the metadata-only
// stub (a document row with just a client-typed `filename`, no real bytes anywhere) with
// genuine file upload/download. Local stack only, real cloud "Marketswave Staging" untouched.
//
// ★★★ GENUINELY SEPARATE PM/CLIENT CONTEXTS — reused verbatim from
// verify-cross-role-sync-bugfix.mjs / verify-products-catalog-fix.mjs, per this project's own
// established precedent (its own header explains the full investigation of why a shared
// module-level `clientPromise` inside supabase-data.js would silently mask a real cross-
// context bug): two independently-executed copies of the real, unmodified supabase-data.js
// source are written to temp files in the project root (so their own relative
// `./supabase-config.js` imports resolve correctly), giving each context its own,
// non-shared `clientPromise` closure — one representing a real PM browser tab, one
// representing a real client browser tab, with zero shared JS state between them. Both
// temp files are removed in a `finally` block regardless of outcome.
//
// ★★★ STORAGE POLICY MECHANISM — investigated directly against Supabase's own current docs
// before writing the storage migration this script verifies (20260904150000). See that
// migration file's own header for the full write-up: storage.objects is a real Postgres
// table with real RLS policies (not a bucket-specific config mechanism), scoped by the
// built-in storage.foldername() helper against a `<clientId>/<uploads|published>/<docId>/
// <filename>` path convention, and createSignedUrl() genuinely requires the caller to pass
// the objects table's own SELECT policy (confirmed via a live probe against the real local
// Storage API: a signed URL for a path with no real object behind it returns a real "Object
// not found" 400 — not a free pass, and not bypassable client-side).
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-documents-storage-integration.mjs

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

// ---- Genuinely separate MarketswaveData instances — see this file's own header. ----
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

function withContext(ctx, fn) {
  const prior = globalThis.window;
  globalThis.window = ctx.fakeWindow;
  return Promise.resolve().then(fn).finally(function () { globalThis.window = prior; });
}

// Real Node global File (Node 20+), NOT jsdom's own File class — confirmed via a standalone
// probe before writing this script that a real Node File instance passes
// @supabase/storage-js's own `instanceof Blob` check when that check runs in the OUTER Node
// realm (where the real supabase-js client performing the actual upload lives), even though
// the click reading `fileInput.files[0]` happens inside a jsdom window. Injected via
// Object.defineProperty since a real <input type="file"> element's `.files` is normally
// read-only but jsdom's own property descriptor is confirmed configurable.
function setRealFileInput(inputEl, filename, content, mimeType) {
  const file = new File([content], filename, { type: mimeType || 'application/octet-stream' });
  Object.defineProperty(inputEl, 'files', { value: [file], configurable: true });
  return file;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, text: buf.toString('utf8') };
}

async function main() {
  console.log('Real Supabase Storage integration for Documents — verification, using genuinely separate PM/client contexts\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const ADMIN_CTX = await createIndependentContext('ADMIN');
  const CLIENT_A_CTX = await createIndependentContext('CLIENT-A');
  check('two genuinely separate supabase-data.js instances were created (ADMIN !== CLIENT_A)', ADMIN_CTX.MarketswaveData !== CLIENT_A_CTX.MarketswaveData);

  // Admin Auth Consolidation (2026-09-05): useAdminClient()'s own ensureSupabaseAdminSignedIn()
  // no longer signs in on its own — it now only confirms a real session already exists,
  // mirroring a real admin page (only ever reachable AFTER a real sign-in already happened on
  // admin-login.html). This test must perform that real sign-in itself first, exactly once —
  // admin-supabase-config.js is a plain, unmodified relative import (no query-busting) both
  // here and from inside supabase-data.js's own useAdminClient(), so both resolve to the SAME
  // cached module instance/session, exactly mirroring how one real login on a real browser tab
  // is what every later privileged call on that same tab depends on.
  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  const adminConfigMod = await import('../admin-supabase-config.js');
  const { error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
  if (adminSignInErr) throw new Error('Real admin sign-in failed: ' + adminSignInErr.message);

  await withContext(ADMIN_CTX, function () { ADMIN_CTX.MarketswaveData.useAdminClient(); });
  const adminClient = await withContext(ADMIN_CTX, function () { return ADMIN_CTX.MarketswaveData.getSupabaseClient(); });
  const { data: adminUser } = await adminClient.auth.getUser();
  check('the ADMIN context is genuinely signed in as the real local bootstrap PM account', adminUser && adminUser.user && adminUser.user.email === 'pm@marketswave.local', adminUser && adminUser.user && adminUser.user.email);

  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyDocsStorage-2026!';

  async function createRealClient(label) {
    const email = 'docs-storage-' + label.toLowerCase() + '-' + suffix + '@test.marketswave.local';
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createErr) throw new Error('createUser failed: ' + createErr.message);
    const clientId = created.user.id;
    const clientName = 'Docs Storage Test Client ' + label + ' ' + suffix;
    await admin.from('clients').insert({ id: clientId, name: clientName, email: email, phone: '+1-555-0100', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 5000, allocated_capital: 0, asset_returns: 0 });
    return { email: email, clientId: clientId, clientName: clientName };
  }

  const clientA = await createRealClient('A');
  const clientB = await createRealClient('B');

  const clientASupabase = await withContext(CLIENT_A_CTX, function () { return CLIENT_A_CTX.MarketswaveData.getSupabaseClient(); });
  const { error: signInAErr } = await withContext(CLIENT_A_CTX, function () { return clientASupabase.auth.signInWithPassword({ email: clientA.email, password }); });
  check('CLIENT_A context genuinely signs in as the real test client A', !signInAErr, signInAErr && signInAErr.message);

  // ★ A real bug found and fixed while writing this script, not present in prior scripts
  // because none of them ever needed TWO simultaneously-active CLIENT identities: unlike
  // admin-supabase-config.js vs. supabase-config.js (two DIFFERENT files, safely left as
  // real, un-duplicated singletons per this project's own established precedent — see this
  // file's own header), Client A and a hypothetical "Client B via CLIENT_B_CTX" would BOTH
  // resolve `supabase-data.js`'s own `import('./supabase-config.js')` to the exact SAME
  // un-duplicated singleton module — meaning signing in as Client B would silently REPLACE
  // Client A's session inside that one shared client object (confirmed directly: a first
  // pass of this script using a real CLIENT_B_CTX made every subsequent Client-A action fail
  // with a genuine RLS rejection, since by the time it ran the shared client's real session
  // was already Client B's). PART 3 below needs a genuinely independent SECOND client
  // session, not a full simulated browser tab — so Client B is signed in via a plain, direct
  // `createClient()` call instead (mirroring verify-supabase-documents-support.js's own
  // `signIn()` helper), never touching the shared supabase-config.js singleton at all.
  const clientBSupabase = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInBErr } = await clientBSupabase.auth.signInWithPassword({ email: clientB.email, password });
  check('Client B signs in via a genuinely independent, directly-created client — never touching the shared supabase-config.js singleton Client A/ADMIN already use', !signInBErr, signInBErr && signInBErr.message);

  try {

  function buildAdminDocumentsDom() {
    const path = fileURLToPath(new URL('../admin-documents.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = ADMIN_CTX.MarketswaveData;
    const script = extractInlineScript(path, 'MarketswaveData.useAdminClient()');
    return { dom: dom, script: script };
  }
  function buildClientDocumentsDom(ctx, clientId) {
    const path = fileURLToPath(new URL('../documents.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = ctx.MarketswaveData;
    dom.window.getAuthenticatedClientId = function () { return clientId; };
    dom.window.document.body.insertAdjacentHTML('beforeend', '<span id="sidebar-doc-badge" class="hidden">0</span>');
    const script = extractInlineScript(path, 'UI Wiring — Stage 4');
    return { dom: dom, script: script };
  }

  // =============================================================================================
  // PART 1 — Client A uploads a REAL file via the real documents.html UI; PM can see and
  // download the actual bytes via the real admin-documents.html UI.
  // =============================================================================================
  console.log('=== PART 1: Client Upload -> real bytes in Storage -> PM downloads the real bytes ===\n');

  const UPLOAD_CONTENT = 'Real client-uploaded file contents — Docs Storage verification, client A, ' + suffix;
  let clientADocsHandle;

  console.log('1. Real Upload — a real file with real bytes, via the actual documents.html UI');
  await (async function () {
    clientADocsHandle = buildClientDocumentsDom(CLIENT_A_CTX, clientA.clientId);
    const D = clientADocsHandle.dom.window.document;
    const uploadListEl = D.getElementById('upload-list');
    await withContext(CLIENT_A_CTX, function () {
      clientADocsHandle.dom.window.eval(clientADocsHandle.script);
      return pollUntil(function () { return !/animate-pulse/.test(uploadListEl.innerHTML); }, 20000);
    });

    // 1a. Missing-file validation — the real, disclosed behavior change: no more silent
    // fallback to a fake "Untitled Document.pdf" filename with no real bytes behind it.
    const toastTitle = D.getElementById('doc-toast-title');
    const submitBtn = D.getElementById('submit-upload');
    var before = toastTitle.textContent;
    await withContext(CLIENT_A_CTX, function () {
      submitBtn.click();
      return pollUntil(function () { return toastTitle.textContent !== before; }, 5000);
    });
    check('clicking Upload with no file chosen shows a real, honest validation error, not a fake upload', toastTitle.textContent === 'Upload Failed' && D.getElementById('doc-toast-body').textContent.indexOf('Choose a file') !== -1, toastTitle.textContent + ' / ' + D.getElementById('doc-toast-body').textContent);
    const { count: noFileRowCount } = await admin.from('documents').select('*', { count: 'exact', head: true }).eq('client_id', clientA.clientId);
    check('no document row was created for the missing-file attempt', noFileRowCount === 0, 'got=' + noFileRowCount);

    // 1b. The real upload, with a real file.
    setRealFileInput(D.getElementById('upload-file'), 'Client A Proof of Address.pdf', UPLOAD_CONTENT, 'application/pdf');
    D.getElementById('upload-category').value = 'General';
    before = toastTitle.textContent;
    await withContext(CLIENT_A_CTX, function () {
      submitBtn.click();
      return pollUntil(function () { return toastTitle.textContent !== before; }, 15000);
    });
    check('the real toast confirms the real upload', toastTitle.textContent === 'Document Uploaded', toastTitle.textContent);
  })();

  let clientAUploadRow;
  console.log('\n2. The real row + real Storage object both genuinely exist, correctly linked');
  await (async function () {
    const { data: rows } = await admin.from('documents').select('*').eq('client_id', clientA.clientId).eq('direction', 'upload');
    check('exactly one real document row exists for Client A\'s real upload', rows && rows.length === 1, JSON.stringify(rows));
    clientAUploadRow = rows && rows[0];
    check('the row has a real, non-null storage_path', clientAUploadRow && !!clientAUploadRow.storage_path, clientAUploadRow && JSON.stringify(clientAUploadRow));
    check('the storage_path genuinely follows the "<clientId>/uploads/<docId>/<filename>" convention', clientAUploadRow && clientAUploadRow.storage_path === clientA.clientId + '/uploads/' + clientAUploadRow.id + '/Client A Proof of Address.pdf', clientAUploadRow && clientAUploadRow.storage_path);

    const { data: listing } = await admin.storage.from('documents').list(clientA.clientId + '/uploads/' + clientAUploadRow.id);
    check('the real object genuinely exists in Storage (service_role listing)', listing && listing.length === 1 && listing[0].name === 'Client A Proof of Address.pdf', JSON.stringify(listing));
  })();

  console.log('\n3. The PM genuinely sees and downloads the REAL bytes via the real admin-documents.html UI');
  await (async function () {
    const { dom, script } = buildAdminDocumentsDom();
    const D = dom.window.document;
    const pendingListEl = D.getElementById('pending-list');
    await withContext(ADMIN_CTX, function () {
      dom.window.eval(script);
      return pollUntil(function () { return !/animate-pulse/.test(pendingListEl.innerHTML); }, 20000);
    });
    check('Client A\'s real upload genuinely appears in the PM\'s real Pending list', pendingListEl.textContent.indexOf('Client A Proof of Address.pdf') !== -1 && pendingListEl.textContent.indexOf(clientA.clientName) !== -1, pendingListEl.textContent.slice(0, 400));

    var capturedUrl = null;
    dom.window.open = function (theUrl) { capturedUrl = theUrl; };
    const downloadBtn = pendingListEl.querySelector('.download-btn[data-doc="' + clientAUploadRow.id + '"]');
    check('the real Download button carries the real document id', !!downloadBtn);
    const toastTitle = D.getElementById('admin-toast-title');
    var before = toastTitle.textContent;
    await withContext(ADMIN_CTX, function () {
      downloadBtn.click();
      return pollUntil(function () { return toastTitle.textContent !== before; }, 15000);
    });
    check('the real toast confirms the download started', toastTitle.textContent === 'Download Started', toastTitle.textContent);
    check('a real signed URL was genuinely generated and "opened"', !!capturedUrl && capturedUrl.indexOf('/storage/v1/') !== -1 && capturedUrl.indexOf('token=') !== -1, capturedUrl);

    const fetched = await fetchBytes(capturedUrl);
    check('fetching the real signed URL succeeds (200)', fetched.status === 200, 'status=' + fetched.status);
    check('the fetched bytes are BYTE-FOR-BYTE the real content Client A actually uploaded — a genuine end-to-end proof, not just a plausible-looking URL', fetched.text === UPLOAD_CONTENT, fetched.text);
  })();

  // =============================================================================================
  // PART 2 — PM publishes a REAL file via the real admin-documents.html UI; Client A can see
  // and download the actual bytes via the real documents.html UI.
  // =============================================================================================
  console.log('\n=== PART 2: PM Publish -> real bytes in Storage -> Client downloads the real bytes ===\n');

  const PUBLISH_CONTENT = 'Real PM-published file contents — Docs Storage verification, ' + suffix;
  let publishedDocId;

  console.log('4. Real Publish — a real file with real bytes, via the actual admin-documents.html UI');
  await (async function () {
    const { dom, script } = buildAdminDocumentsDom();
    const D = dom.window.document;
    await withContext(ADMIN_CTX, function () {
      dom.window.eval(script);
      return pollUntil(function () { return D.getElementById('publish-client').options.length > 0; }, 20000);
    });
    var opt = [...D.getElementById('publish-client').options].find(function (o) { return o.value === clientA.clientId; });
    check('Client A appears in the real Publish-to-Client dropdown', !!opt);
    D.getElementById('publish-client').value = clientA.clientId;
    D.getElementById('publish-category').value = 'Contracts';
    D.getElementById('publish-signature-required').checked = true;

    // Missing-file validation on the real Publish form too.
    const errorEl = D.getElementById('publish-error');
    const publishBtn = D.getElementById('publish-submit');
    publishBtn.click();
    check('publishing with no file chosen shows a real, honest validation error, no request even attempted', !errorEl.classList.contains('hidden') && errorEl.textContent.indexOf('Choose a file') !== -1, errorEl.textContent);

    setRealFileInput(D.getElementById('publish-file'), 'Investment Management Agreement.pdf', PUBLISH_CONTENT, 'application/pdf');
    const toastTitle = D.getElementById('admin-toast-title');
    var before = toastTitle.textContent;
    await withContext(ADMIN_CTX, function () {
      publishBtn.click();
      return pollUntil(function () { return toastTitle.textContent !== before; }, 15000);
    });
    check('the real toast confirms the real publish', toastTitle.textContent === 'Document Published' && toastTitle.textContent, toastTitle.textContent);
  })();

  console.log('\n5. The real row + real Storage object both genuinely exist, correctly linked, under the PUBLISHED subfolder');
  await (async function () {
    const { data: rows } = await admin.from('documents').select('*').eq('client_id', clientA.clientId).eq('direction', 'from');
    check('exactly one real "from" document row exists for the real publish', rows && rows.length === 1, JSON.stringify(rows));
    const row = rows && rows[0];
    publishedDocId = row && row.id;
    check('the row has a real, non-null storage_path', row && !!row.storage_path);
    check('the storage_path genuinely follows the "<clientId>/published/<docId>/<filename>" convention', row && row.storage_path === clientA.clientId + '/published/' + row.id + '/Investment Management Agreement.pdf', row && row.storage_path);

    const { data: listing } = await admin.storage.from('documents').list(clientA.clientId + '/published/' + row.id);
    check('the real object genuinely exists in Storage', listing && listing.length === 1, JSON.stringify(listing));
  })();

  console.log('\n6. Client A genuinely sees and downloads the REAL published bytes via the real documents.html UI');
  await (async function () {
    // Reload the real page fresh (a real client would refresh to see a new publish) rather
    // than assuming the earlier live DOM instance would somehow already reflect it.
    const fresh = buildClientDocumentsDom(CLIENT_A_CTX, clientA.clientId);
    const FD = fresh.dom.window.document;
    const freshFromListEl = FD.getElementById('from-list');
    await withContext(CLIENT_A_CTX, function () {
      fresh.dom.window.eval(fresh.script);
      return pollUntil(function () { return !/animate-pulse/.test(freshFromListEl.innerHTML); }, 20000);
    });
    check('the real published document genuinely renders on Client A\'s real page', freshFromListEl.textContent.indexOf('Investment Management Agreement.pdf') !== -1, freshFromListEl.textContent.slice(0, 400));

    var capturedUrl = null;
    fresh.dom.window.open = function (theUrl) { capturedUrl = theUrl; };
    const downloadBtn = [...freshFromListEl.querySelectorAll('.doc-row')].find(function (r) { return r.textContent.indexOf('Investment Management Agreement.pdf') !== -1; }).querySelector('.download-btn');
    const toastTitle = FD.getElementById('doc-toast-title');
    var before = toastTitle.textContent;
    await withContext(CLIENT_A_CTX, function () {
      downloadBtn.click();
      return pollUntil(function () { return toastTitle.textContent !== before; }, 15000);
    });
    check('the real toast confirms the download', toastTitle.textContent === 'Download Started', toastTitle.textContent);
    check('a real signed URL was genuinely generated', !!capturedUrl && capturedUrl.indexOf('token=') !== -1, capturedUrl);

    const fetched = await fetchBytes(capturedUrl);
    check('the fetched bytes are BYTE-FOR-BYTE the real content the PM actually published', fetched.text === PUBLISH_CONTENT, fetched.text);
  })();

  // =============================================================================================
  // PART 3 — Cross-client isolation at the STORAGE level, not just the table level, tested
  // directly against the real Storage API as genuinely different real clients.
  // =============================================================================================
  console.log('\n=== PART 3: Cross-client isolation at the Storage level (raw API, genuinely separate real sessions) ===\n');

  console.log('7. Client B cannot read, sign a URL for, or delete Client A\'s real files');
  await (async function () {
    // clientBSupabase is a plain, directly-created client (see this file's own setup
    // comment) — it never depends on globalThis.window, so no withContext() wrapping is
    // needed for calls made directly on it.
    const { data: signedForB, error: signErr } = await clientBSupabase.storage.from('documents').createSignedUrl(clientAUploadRow.storage_path, 60);
    check('Client B CANNOT generate a signed URL for Client A\'s real uploaded file (RLS-filtered, the object is invisible to B)', !signedForB && !!signErr, signErr && signErr.message);

    const { data: removedForB, error: removeErr } = await clientBSupabase.storage.from('documents').remove([clientAUploadRow.storage_path]);
    // Storage remove(), unlike a table DELETE, genuinely errors on zero real deletions rather
    // than silently "succeeding" with nothing removed — confirmed the same real behavior this
    // project's own deleteFile() helper already documents.
    check('Client B CANNOT delete Client A\'s real uploaded file', !removedForB || removedForB.length === 0 || !!removeErr, JSON.stringify({ removedForB, removeErr: removeErr && removeErr.message }));

    const { data: stillThere } = await admin.storage.from('documents').list(clientA.clientId + '/uploads/' + clientAUploadRow.id);
    check('Client A\'s real file is confirmed genuinely UNAFFECTED by Client B\'s denied attempts', stillThere && stillThere.length === 1, JSON.stringify(stillThere));
  })();

  console.log('\n8. Client B cannot upload INTO Client A\'s own folder (impersonating/overwriting another client)');
  await (async function () {
    const spoofPath = clientA.clientId + '/uploads/spoofed-doc-id/Spoofed File.pdf';
    const { data: spoofUpload, error: spoofErr } = await clientBSupabase.storage.from('documents').upload(spoofPath, Buffer.from('spoofed content'), { contentType: 'text/plain' });
    check('Client B CANNOT upload into Client A\'s own uploads folder (folder[1] must equal the caller\'s own uid)', !spoofUpload && !!spoofErr, spoofErr && spoofErr.message);
  })();

  console.log('\n9. A client cannot upload into their OWN "published" subfolder (impersonating a firm-published document)');
  await (async function () {
    const spoofPublishedPath = clientA.clientId + '/published/spoofed-doc-id/Fake Firm Doc.pdf';
    const { data: spoofPublish, error: spoofPublishErr } = await withContext(CLIENT_A_CTX, function () {
      return clientASupabase.storage.from('documents').upload(spoofPublishedPath, Buffer.from('spoofed firm content'), { contentType: 'text/plain' });
    });
    check('Client A CANNOT upload into their own "published" subfolder — only service_role (publish-document) may (folder[2] must equal literally \'uploads\')', !spoofPublish && !!spoofPublishErr, spoofPublishErr && spoofPublishErr.message);
  })();

  console.log('\n10. Client A cannot delete the real PM-published (firm) file — the storage-level mirror of the table\'s own DELETE strengthening');
  await (async function () {
    const publishedPath = clientA.clientId + '/published/' + publishedDocId + '/Investment Management Agreement.pdf';
    const { data: removedPublished, error: removePublishedErr } = await withContext(CLIENT_A_CTX, function () {
      return clientASupabase.storage.from('documents').remove([publishedPath]);
    });
    check('Client A CANNOT delete their own real "from" (firm-published) file — only their own uploads subfolder is deletable', !removedPublished || removedPublished.length === 0 || !!removePublishedErr, JSON.stringify({ removedPublished, removePublishedErr: removePublishedErr && removePublishedErr.message }));

    const { data: stillThere } = await admin.storage.from('documents').list(clientA.clientId + '/published/' + publishedDocId);
    check('the real published file is confirmed genuinely still present', stillThere && stillThere.length === 1);
  })();

  console.log('\n11. The ADMIN-claimed session CAN read across every client directly (the storage-level mirror of "PM/admin can upload and read across all clients")');
  await (async function () {
    const { data: signedForAdmin, error: adminSignErr } = await withContext(ADMIN_CTX, function () {
      return adminClient.storage.from('documents').createSignedUrl(clientAUploadRow.storage_path, 60);
    });
    check('the real admin-claimed session CAN generate a real signed URL for Client A\'s file directly', !!signedForAdmin && !adminSignErr, adminSignErr && adminSignErr.message);
    if (signedForAdmin) {
      const fetched = await fetchBytes(signedForAdmin.signedUrl);
      check('and the real fetched bytes match what Client A actually uploaded', fetched.text === UPLOAD_CONTENT, fetched.text);
    }
  })();

  // =============================================================================================
  // PART 4 — Remove action cleans up the real underlying storage object, not just the row.
  // =============================================================================================
  console.log('\n=== PART 4: Remove cleans up the real storage object, not just the table row ===\n');

  console.log('12. Client A removes their own real upload via the real documents.html UI');
  await (async function () {
    const D = clientADocsHandle.dom.window.document;
    const uploadListEl = D.getElementById('upload-list');
    const removeBtn = [...uploadListEl.querySelectorAll('.doc-row')].find(function (r) { return r.textContent.indexOf('Client A Proof of Address.pdf') !== -1; }).querySelector('.remove-upload-btn');
    removeBtn.click();
    D.getElementById('remove-confirm-submit').click();
    const toastTitle = D.getElementById('doc-toast-title');
    await withContext(CLIENT_A_CTX, function () {
      return pollUntil(function () { return toastTitle.textContent === 'Document Removed'; }, 15000);
    });
    check('the real toast confirms the removal', toastTitle.textContent === 'Document Removed');

    const { data: rowsAfter } = await admin.from('documents').select('id').eq('id', clientAUploadRow.id);
    check('the real document row is genuinely gone from Postgres', rowsAfter && rowsAfter.length === 0);

    // The real storage delete is best-effort and asynchronous relative to the row delete —
    // poll for it rather than assuming it already finished by the time the row-delete toast
    // fired (the exact class of race this whole feature's own Upload-flash regression fix,
    // above in verify-hys-documents-ui-wiring.mjs, already had to account for once).
    const objectGone = await pollUntil(async function () {
      const { data: listing } = await admin.storage.from('documents').list(clientA.clientId + '/uploads/' + clientAUploadRow.id);
      return !listing || listing.length === 0;
    }, 15000);
    check('the real underlying storage object is ALSO genuinely gone, not just the row (Remove\'s own best-effort storage cleanup)', objectGone);
  })();

  // =============================================================================================
  // PART 5 — Backward compatibility: a real pre-existing row with no file behind it (this
  // project's own disclosed leftover-test-row category) degrades honestly, on both real pages.
  // =============================================================================================
  console.log('\n=== PART 5: A null storage_path (pre-existing/legacy row) — honest "No File Attached", never a crash or a doomed signed-url attempt ===\n');

  console.log('13. A real legacy "from" row with no storage_path renders and degrades correctly on both real pages');
  await (async function () {
    const { data: legacyDoc } = await admin.from('documents').insert({
      client_id: clientA.clientId, direction: 'from', filename: 'Pre-Storage Legacy Doc.pdf', category: 'General',
      status: null, is_new: false, deadline_label: null
    }).select().single();
    check('a real legacy row with storage_path genuinely null was created (bypassing the client-INSERT policy via service_role, mirroring an admin/pre-migration record)', legacyDoc && legacyDoc.storage_path === null, JSON.stringify(legacyDoc));

    const fresh = buildClientDocumentsDom(CLIENT_A_CTX, clientA.clientId);
    const FD = fresh.dom.window.document;
    const freshFromListEl = FD.getElementById('from-list');
    await withContext(CLIENT_A_CTX, function () {
      fresh.dom.window.eval(fresh.script);
      return pollUntil(function () { return !/animate-pulse/.test(freshFromListEl.innerHTML); }, 20000);
    });
    const legacyRow = [...freshFromListEl.querySelectorAll('.doc-row')].find(function (r) { return r.textContent.indexOf('Pre-Storage Legacy Doc.pdf') !== -1; });
    check('the real legacy document still renders on the client page, no crash', !!legacyRow);
    const downloadBtn = legacyRow.querySelector('.download-btn');
    const toastTitle = FD.getElementById('doc-toast-title');
    var before = toastTitle.textContent;
    downloadBtn.click();
    await pollUntil(function () { return toastTitle.textContent !== before; }, 5000);
    check('clicking Download on the real legacy row shows the honest "No File Attached" message, never attempting a doomed signed-url request', toastTitle.textContent === 'No File Attached', toastTitle.textContent);

    // Same real check on the admin side's Pending/History rendering — a legacy row could just
    // as easily be an uploaded (not published) one there.
    const { data: legacyUpload } = await admin.from('documents').insert({
      client_id: clientA.clientId, direction: 'upload', filename: 'Pre-Storage Legacy Upload.pdf', category: 'General',
      status: 'Received', is_new: false, deadline_label: null
    }).select().single();
    check('a real legacy UPLOAD row with storage_path genuinely null was also created', legacyUpload && legacyUpload.storage_path === null);

    const { dom, script } = buildAdminDocumentsDom();
    const AD = dom.window.document;
    await withContext(ADMIN_CTX, function () {
      dom.window.eval(script);
      return pollUntil(function () { return !/animate-pulse/.test(AD.getElementById('pending-list').innerHTML); }, 20000);
    });
    const adminDownloadBtn = AD.getElementById('pending-list').querySelector('.download-btn[data-doc="' + legacyUpload.id + '"]');
    check('the real legacy upload appears in the PM\'s real Pending list with a real Download button', !!adminDownloadBtn);
    const adminToastTitle = AD.getElementById('admin-toast-title');
    var adminBefore = adminToastTitle.textContent;
    await withContext(ADMIN_CTX, function () {
      adminDownloadBtn.click();
      return pollUntil(function () { return adminToastTitle.textContent !== adminBefore; }, 5000);
    });
    check('the PM\'s own real Download click on a null-storage_path row ALSO shows the honest "No File Attached" message', adminToastTitle.textContent === 'No File Attached', adminToastTitle.textContent);
  })();

  } finally {
    await admin.from('documents').delete().eq('client_id', clientA.clientId);
    await admin.from('documents').delete().eq('client_id', clientB.clientId);
    await removeAllClientStorageObjects(admin, 'documents', clientA.clientId);
    await removeAllClientStorageObjects(admin, 'documents', clientB.clientId);
    await admin.from('account_state').delete().eq('client_id', clientA.clientId);
    await admin.from('account_state').delete().eq('client_id', clientB.clientId);
    await admin.from('clients').delete().eq('id', clientA.clientId);
    await admin.from('clients').delete().eq('id', clientB.clientId);
    await admin.auth.admin.deleteUser(clientA.clientId);
    await admin.auth.admin.deleteUser(clientB.clientId);
    tempFiles.forEach(function (f) { try { unlinkSync(f); } catch (e) { /* already gone */ } });
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
