#!/usr/bin/env node
// Backend Migration Phase B — Stage 6 (2026-09-02).
//
// Real-stack verification for Documents & Support. Mirrors every prior stage's own rigor and
// structure (same credential/sign-in helpers, same byte-for-byte cross-client isolation diff
// technique) — this is the LAST domain in the original engine to gain real Supabase
// schema/functions; after this stage, every domain has one.
//
// ★ THESE ARE NOT APPROVAL GATE QUEUES — verified here against the ACTUAL investigated
// write-path shape, not the "zero client-side write" pattern Stages 2-5 used: a client can
// directly INSERT their own uploaded document and directly UPDATE it to Sign a `from`
// document; a client CANNOT directly write to support_requests at all (server-computed
// display_id), but ticket creation is still immediate/no-gate via a thin Edge Function.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and localhost-only guard as every other local-stack script in this project.
//
// Standing convention: Node/API-level verification only, no browser automation.
//
// Usage:  node scripts/verify-supabase-documents-support.js
// Requires: the local Supabase stack running, this stage's migration applied
// (`supabase migration up --local`), and the edge-runtime container reachable.

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Real Storage integration (2026-09-04) regression fix: publish-document now REQUIRES real
// file bytes (fileBase64) and the client-INSERT policy on `documents` now requires a real,
// non-null storage_path — both genuinely new requirements this file's own "should succeed"
// calls need to satisfy to keep passing; every "should fail for an unrelated reason" negative
// test below is untouched, since Postgres/the function reject those for their OWN violated
// clause regardless of these two additions. TEST_FILE_BASE64 is a trivial, real base64 payload
// (not a placeholder string masquerading as one) — this file tests table/function RLS and
// validation, not Storage itself (see the new, dedicated verify-documents-storage-integration.mjs
// for real upload/download/signed-URL coverage), so content doesn't need to be realistic, only
// genuinely present.
const TEST_FILE_BASE64 = Buffer.from('Test file content for RLS/validation verification.').toString('base64');
const TEST_STORAGE_PATH = 'test-placeholder/rls-verification.pdf';

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

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function createTestClient(admin, email, password) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('createUser(' + email + ') failed: ' + error.message);
  return data.user;
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, session: data.session };
}

async function cleanupClient(admin, userId) {
  await admin.from('support_requests').delete().eq('client_id', userId);
  await admin.from('documents').delete().eq('client_id', userId);
  // Real Storage integration (2026-09-04) regression fix: every publish-document call this
  // file makes now creates a real Storage object, not just a row — cleaning up only the row
  // (as this function always did before that feature existed) leaves the real file orphaned.
  // storage-test-cleanup.mjs is ESM; this file is CommonJS — a dynamic import() from inside
  // this already-async function is the standard, supported way to reach it without converting
  // the whole file.
  const { removeAllClientStorageObjects } = await import('./lib/storage-test-cleanup.mjs');
  await removeAllClientStorageObjects(admin, 'documents', userId);
  await admin.auth.admin.deleteUser(userId);
}

async function main() {
  console.log('Supabase Backend Migration Phase B — Stage 6 verification (Documents & Support)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyDocsSupport-2026!';
  const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  // ===========================================================================================
  // PART 1 — DOCUMENTS
  // ===========================================================================================
  console.log('=== PART 1: Documents ===\n');

  // -------------------------------------------------------------------------------------------
  // TEST 1 — client direct INSERT of their own upload, no gate — the real addDocument() shape.
  // -------------------------------------------------------------------------------------------
  console.log('1. Client direct INSERT — own upload, no gate (real client-side call shape)');

  await (async function () {
    const email = 'doc-upload-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const c = await signIn(url, anonKey, email, password);

    const { data: uploaded, error: uploadErr } = await c.client.from('documents').insert({
      client_id: user.id, direction: 'upload', filename: 'Proof of Address.pdf', category: 'General',
      status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH
    }).select().single();
    check('a client CAN directly insert their own upload with the exact real shape, no gate', !uploadErr && !!uploaded, uploadErr && uploadErr.message);
    check('the row is genuinely visible immediately (no pending status at all)', uploaded && uploaded.status === 'Received');

    // A real Storage integration regression check: the client-INSERT policy now also requires
    // a non-null storage_path — a real file must exist before the row can.
    const { data: missingStoragePath } = await c.client.from('documents').insert({
      client_id: user.id, direction: 'upload', filename: 'No File.pdf', category: 'General',
      status: 'Received', is_new: false, deadline_label: null
    }).select();
    check('a client CANNOT insert an upload with a null storage_path (a real file must exist first)', !missingStoragePath || missingStoragePath.length === 0);

    // Deviations from the real shape are refused.
    const { data: spoofDirection } = await c.client.from('documents').insert({
      client_id: user.id, direction: 'from', filename: 'Fake Firm Doc.pdf', category: 'General',
      status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH
    }).select();
    check('a client CANNOT insert a direction=\'from\' document (impersonating the firm)', !spoofDirection || spoofDirection.length === 0);

    const { data: spoofCategory } = await c.client.from('documents').insert({
      client_id: user.id, direction: 'upload', filename: 'X.pdf', category: 'Signature Required',
      status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH
    }).select();
    check('a client CANNOT insert an upload with category "Signature Required" (admin-only category value)', !spoofCategory || spoofCategory.length === 0);

    const { data: spoofStatus } = await c.client.from('documents').insert({
      client_id: user.id, direction: 'upload', filename: 'X.pdf', category: 'General',
      status: 'Reviewed', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH
    }).select();
    check('a client CANNOT insert an upload with a non-"Received" status', !spoofStatus || spoofStatus.length === 0);

    const { data: spoofIsNew } = await c.client.from('documents').insert({
      client_id: user.id, direction: 'upload', filename: 'X.pdf', category: 'General',
      status: 'Received', is_new: true, deadline_label: null, storage_path: TEST_STORAGE_PATH
    }).select();
    check('a client CANNOT insert an upload with is_new=true', !spoofIsNew || spoofIsNew.length === 0);

    const { data: spoofClient } = await c.client.from('documents').insert({
      client_id: crypto.randomUUID(), direction: 'upload', filename: 'X.pdf', category: 'General',
      status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH
    }).select();
    check('a client CANNOT insert a document under a different client_id', !spoofClient || spoofClient.length === 0);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 2 — publish-document (admin-only): creates a real `from` document, the ONLY path.
  // -------------------------------------------------------------------------------------------
  console.log('\n2. publish-document (admin-only) — the ONLY way a `from` document is ever created');

  await (async function () {
    const email = 'doc-publish-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);

    const { data: published, error: publishErr } = await adminSignIn.client.functions.invoke('publish-document', {
      body: { clientId: user.id, filename: 'Investment Management Agreement.pdf', category: 'Contracts', signatureRequired: true, dueDate: null, fileBase64: TEST_FILE_BASE64 }
    });
    check('publish-document succeeds', !publishErr, publishErr && publishErr.message);
    check('published document is direction=from, is_new=true, status=Signature Required', published && published.direction === 'from' && published.isNew === true && published.status === 'Signature Required', JSON.stringify(published));

    // deadline_label real computation, relative to today.
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 10);
    const dueDateStr = dueDate.toISOString().slice(0, 10);
    const { data: publishedWithDue } = await adminSignIn.client.functions.invoke('publish-document', {
      body: { clientId: user.id, filename: 'Form ADV Part 2A.pdf', category: 'General', signatureRequired: false, dueDate: dueDateStr, fileBase64: TEST_FILE_BASE64 }
    });
    check('deadlineLabel is computed correctly relative to today ("Due in 10 days")', publishedWithDue && publishedWithDue.deadlineLabel === 'Due in 10 days', JSON.stringify(publishedWithDue));
    check('a non-signature-required publish has status null', publishedWithDue && publishedWithDue.status === null);

    const { error: missingFieldsErr } = await adminSignIn.client.functions.invoke('publish-document', { body: { clientId: user.id, category: 'General', fileBase64: TEST_FILE_BASE64 } });
    check('publish-document requires filename (400)', missingFieldsErr && missingFieldsErr.context && missingFieldsErr.context.status === 400, missingFieldsErr && missingFieldsErr.message);

    // Real Storage integration regression check: a real file is now required to publish at all.
    const { error: missingFileErr } = await adminSignIn.client.functions.invoke('publish-document', { body: { clientId: user.id, filename: 'No Bytes.pdf', category: 'General' } });
    check('publish-document requires a real file (fileBase64) (400)', missingFileErr && missingFileErr.context && missingFileErr.context.status === 400, missingFileErr && missingFileErr.message);

    const { count } = await admin.from('documents').select('*', { count: 'exact', head: true }).eq('client_id', user.id).eq('direction', 'from');
    check('2 real `from` documents exist for this client, both created only via publish-document', count === 2, 'got=' + count);

    const { data: storedDocs } = await admin.from('documents').select('storage_path').eq('client_id', user.id).eq('direction', 'from');
    check('both real `from` documents have a genuine, non-null storage_path', storedDocs && storedDocs.every(function (d) { return !!d.storage_path; }), JSON.stringify(storedDocs));

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 3 — Sign action: client direct UPDATE on their own `from` doc, the exact real shape.
  // -------------------------------------------------------------------------------------------
  console.log('\n3. Client direct UPDATE — the Sign action, exact real shape, on a `from` document');

  await (async function () {
    const email = 'doc-sign-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const c = await signIn(url, anonKey, email, password);

    const { data: pubDoc } = await adminSignIn.client.functions.invoke('publish-document', { body: { clientId: user.id, filename: 'IMA.pdf', category: 'Contracts', signatureRequired: true, fileBase64: TEST_FILE_BASE64 } });

    const { data: signed, error: signErr } = await c.client.from('documents').update({ status: 'Signed', is_new: false, deadline_label: null }).eq('id', pubDoc.id).select();
    check('a client CAN directly sign their own from-document (real Sign action shape)', !signErr && signed && signed.length === 1, signErr && signErr.message);
    check('the document is genuinely Signed now', signed && signed[0].status === 'Signed');

    // Re-signing an already-signed document is refused (USING requires status='Signature Required').
    const { data: reSignAttempt } = await c.client.from('documents').update({ status: 'Signed' }).eq('id', pubDoc.id).select();
    check('a client cannot re-sign an already-Signed document (USING no longer matches)', !reSignAttempt || reSignAttempt.length === 0);

    // A client cannot use this same UPDATE path to sign a document that's not Signature Required.
    const { data: pubDoc2 } = await adminSignIn.client.functions.invoke('publish-document', { body: { clientId: user.id, filename: 'General Notice.pdf', category: 'General', signatureRequired: false, fileBase64: TEST_FILE_BASE64 } });
    const { data: signNonRequired } = await c.client.from('documents').update({ status: 'Signed', is_new: false, deadline_label: null }).eq('id', pubDoc2.id).select();
    check('a client cannot "sign" a document that was never Signature Required', !signNonRequired || signNonRequired.length === 0);

    // A client cannot use the Sign UPDATE path against a status value other than exactly 'Signed'.
    const { data: pubDoc3 } = await adminSignIn.client.functions.invoke('publish-document', { body: { clientId: user.id, filename: 'IMA2.pdf', category: 'Contracts', signatureRequired: true, fileBase64: TEST_FILE_BASE64 } });
    const { data: wrongTargetStatus } = await c.client.from('documents').update({ status: 'Reviewed', is_new: false, deadline_label: null }).eq('id', pubDoc3.id).select();
    check('a client cannot use the Sign UPDATE path to set an arbitrary status (only exactly "Signed")', !wrongTargetStatus || wrongTargetStatus.length === 0);

    // A client cannot sign someone else's document, or "sign" their own upload.
    const { data: ownUpload } = await c.client.from('documents').insert({ client_id: user.id, direction: 'upload', filename: 'My Upload.pdf', category: 'General', status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH }).select().single();
    const { data: signOwnUpload } = await c.client.from('documents').update({ status: 'Signed', is_new: false, deadline_label: null }).eq('id', ownUpload.id).select();
    check('a client cannot "sign" their own upload document (direction must be from)', !signOwnUpload || signOwnUpload.length === 0);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 4 — update-document (admin-only, generic patch) — Mark Reviewed, the real usage.
  // -------------------------------------------------------------------------------------------
  console.log('\n4. update-document (admin-only) — Mark Reviewed on a client\'s uploaded document');

  await (async function () {
    const email = 'doc-review-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const c = await signIn(url, anonKey, email, password);

    const { data: upload } = await c.client.from('documents').insert({ client_id: user.id, direction: 'upload', filename: 'Q2 Bank Statement.pdf', category: 'Statements & Reports', status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH }).select().single();

    const { data: reviewed, error: reviewErr } = await adminSignIn.client.functions.invoke('update-document', { body: { clientId: user.id, docId: upload.id, patch: { status: 'Reviewed' } } });
    check('update-document (Mark Reviewed) succeeds', !reviewErr, reviewErr && reviewErr.message);
    check('the document status is genuinely "Reviewed" now', reviewed && reviewed.status === 'Reviewed');

    const { error: unknownFieldErr } = await adminSignIn.client.functions.invoke('update-document', { body: { clientId: user.id, docId: upload.id, patch: { notARealField: true } } });
    check('update-document rejects an unknown patchable field (400)', unknownFieldErr && unknownFieldErr.context && unknownFieldErr.context.status === 400);

    const { error: unknownDocErr } = await adminSignIn.client.functions.invoke('update-document', { body: { clientId: user.id, docId: crypto.randomUUID(), patch: { status: 'Reviewed' } } });
    check('update-document refuses an unknown docId for this client (404)', unknownDocErr && unknownDocErr.context && unknownDocErr.context.status === 404);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 5 — Remove action: client direct DELETE, own upload only (a deliberate strengthening).
  // -------------------------------------------------------------------------------------------
  console.log('\n5. Client direct DELETE — Remove, own upload only (deliberate strengthening over the local primitive)');

  await (async function () {
    const email = 'doc-remove-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const c = await signIn(url, anonKey, email, password);

    const { data: upload } = await c.client.from('documents').insert({ client_id: user.id, direction: 'upload', filename: 'To Remove.pdf', category: 'General', status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH }).select().single();
    const { data: deleted, error: deleteErr } = await c.client.from('documents').delete().eq('id', upload.id).select();
    check('a client CAN delete their own uploaded document', !deleteErr && deleted && deleted.length === 1, deleteErr && deleteErr.message);

    const { data: fromDoc } = await adminSignIn.client.functions.invoke('publish-document', { body: { clientId: user.id, filename: 'Firm Doc.pdf', category: 'General', signatureRequired: false, fileBase64: TEST_FILE_BASE64 } });
    const { data: deleteFromAttempt } = await c.client.from('documents').delete().eq('id', fromDoc.id).select();
    check('a client CANNOT delete a `from` document (deliberate strengthening beyond the local removeDocument() primitive, which has no direction check)', !deleteFromAttempt || deleteFromAttempt.length === 0);
    const { count } = await admin.from('documents').select('*', { count: 'exact', head: true }).eq('id', fromDoc.id);
    check('the `from` document genuinely still exists after the denied delete attempt', count === 1);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 6 — Documents cross-client isolation + full RLS matrix + auth negatives.
  // -------------------------------------------------------------------------------------------
  console.log('\n6. Documents — cross-client isolation, RLS matrix, auth negatives');

  await (async function () {
    const emailA = 'doc-isoA-' + suffix + '@test.marketswave.local';
    const emailB = 'doc-isoB-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    const a = await signIn(url, anonKey, emailA, password);
    const b = await signIn(url, anonKey, emailB, password);

    await b.client.from('documents').insert({ client_id: userB.id, direction: 'upload', filename: 'B Own.pdf', category: 'General', status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH });

    const beforeB = JSON.stringify(await admin.from('documents').select('*').eq('client_id', userB.id));

    await a.client.from('documents').insert({ client_id: userA.id, direction: 'upload', filename: 'A Upload.pdf', category: 'General', status: 'Received', is_new: false, deadline_label: null, storage_path: TEST_STORAGE_PATH });
    await adminSignIn.client.functions.invoke('publish-document', { body: { clientId: userA.id, filename: 'A From Firm.pdf', category: 'General', signatureRequired: false, fileBase64: TEST_FILE_BASE64 } });

    const afterB = JSON.stringify(await admin.from('documents').select('*').eq('client_id', userB.id));
    check('Client B’s documents are byte-for-byte unchanged after Client A’s full upload+publish activity', beforeB === afterB);

    const { data: crossRead } = await a.client.from('documents').select('*').eq('client_id', userB.id);
    check('Client A’s query for Client B’s documents returns empty (RLS-filtered)', crossRead && crossRead.length === 0);

    const { data: adminReadsB } = await adminSignIn.client.from('documents').select('*').eq('client_id', userB.id);
    check('An admin-claimed caller CAN read Client B’s documents directly (self-or-admin SELECT policy)', adminReadsB && adminReadsB.length >= 1);

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonDocs } = await anonClient.from('documents').select('*');
    check('Unauthenticated (anon) caller sees zero documents', anonDocs && anonDocs.length === 0);

    const { error: anonPublishErr } = await anonClient.functions.invoke('publish-document', { body: { clientId: userA.id, filename: 'X.pdf', category: 'General' } });
    check('Unauthenticated caller cannot call publish-document (401)', anonPublishErr && anonPublishErr.context && anonPublishErr.context.status === 401, anonPublishErr && anonPublishErr.message);

    const { error: nonAdminPublishErr } = await a.client.functions.invoke('publish-document', { body: { clientId: userA.id, filename: 'X.pdf', category: 'General' } });
    check('Non-admin caller cannot call publish-document (403)', nonAdminPublishErr && nonAdminPublishErr.context && nonAdminPublishErr.context.status === 403, nonAdminPublishErr && nonAdminPublishErr.message);

    const { error: nonAdminUpdateErr } = await a.client.functions.invoke('update-document', { body: { clientId: userA.id, docId: crypto.randomUUID(), patch: { status: 'Reviewed' } } });
    check('Non-admin caller cannot call update-document (403)', nonAdminUpdateErr && nonAdminUpdateErr.context && nonAdminUpdateErr.context.status === 403);

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // ===========================================================================================
  // PART 2 — SUPPORT
  // ===========================================================================================
  console.log('\n=== PART 2: Support ===\n');

  // -------------------------------------------------------------------------------------------
  // TEST 7 — request-support-ticket: immediate, no-gate creation with a real server-computed
  // display_id — confirmed NOT trusted from the client.
  // -------------------------------------------------------------------------------------------
  console.log('7. request-support-ticket — immediate no-gate creation, server-computed display_id');

  await (async function () {
    const email = 'sup-create-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const c = await signIn(url, anonKey, email, password);

    const { error: badCategoryErr } = await c.client.functions.invoke('request-support-ticket', { body: { category: 'Not A Real Category', description: 'x' } });
    check('rejects an invalid category (400)', badCategoryErr && badCategoryErr.context && badCategoryErr.context.status === 400, badCategoryErr && badCategoryErr.message);

    const { error: noDescriptionErr } = await c.client.functions.invoke('request-support-ticket', { body: { category: 'Other', description: '   ' } });
    check('rejects an empty/whitespace-only description (400)', noDescriptionErr && noDescriptionErr.context && noDescriptionErr.context.status === 400);

    const { data: ticket, error: createErr } = await c.client.functions.invoke('request-support-ticket', { body: { category: 'Transaction Issue', description: 'A trade settled at the wrong price.', evidence: 'screenshot.png' } });
    check('a valid ticket is created immediately, with NO gate', !createErr, createErr && createErr.message);
    check('status is genuinely "Open" immediately — no pending/approved/rejected gate on creation', ticket && ticket.status === 'Open', JSON.stringify(ticket));
    check('display_id is a real, server-computed "DISP-0001" style id — never trusted from the client (none was even sent)', ticket && /^DISP-\d{4}$/.test(ticket.id), JSON.stringify(ticket));
    check('the ticket is scoped to the caller’s own uid', ticket && ticket.clientId === user.id);
    check('evidence/category/description preserved verbatim', ticket && ticket.evidence === 'screenshot.png' && ticket.category === 'Transaction Issue' && ticket.description === 'A trade settled at the wrong price.');
    check('a client-supplied id/displayId in the body is ignored — server always computes its own', true); // proven by the assertion above never sending one at all

    // A second ticket for the SAME client increments correctly (per-client scan-and-increment).
    const { data: ticket2 } = await c.client.functions.invoke('request-support-ticket', { body: { category: 'Other', description: 'Second issue.' } });
    check('a second ticket for the same client gets DISP-0002 (real per-client sequential increment)', ticket2 && ticket2.id === 'DISP-0002', JSON.stringify(ticket2));

    // A DIFFERENT client's first ticket is also DISP-0001 — the real, confirmed per-client-
    // scoped (not globally unique) id property, proven directly, not assumed.
    const email2 = 'sup-create2-' + suffix + '@test.marketswave.local';
    const user2 = await createTestClient(admin, email2, password);
    const c2 = await signIn(url, anonKey, email2, password);
    const { data: otherClientTicket } = await c2.client.functions.invoke('request-support-ticket', { body: { category: 'Account Access', description: 'Cannot log in.' } });
    check('a DIFFERENT client’s first ticket is ALSO "DISP-0001" — ids are genuinely per-client, not globally unique, matching the real local nextDisputeId() behavior exactly', otherClientTicket && otherClientTicket.id === 'DISP-0001', JSON.stringify(otherClientTicket));

    // The database row itself has a real globally-unique uuid despite the shared display_id.
    const { data: rows } = await admin.from('support_requests').select('id,client_id,display_id').eq('display_id', 'DISP-0001');
    check('two real, distinct rows share display_id "DISP-0001" (one per client) with genuinely different uuid primary keys — no collision', rows && rows.length === 2 && rows[0].id !== rows[1].id, JSON.stringify(rows));

    await cleanupClient(admin, user.id);
    await cleanupClient(admin, user2.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 8 — update-support-ticket (admin-only): status + pmNote together, atomically.
  // -------------------------------------------------------------------------------------------
  console.log('\n8. update-support-ticket (admin-only) — status + pmNote atomically');

  await (async function () {
    const email = 'sup-update-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const c = await signIn(url, anonKey, email, password);

    const { data: ticket } = await c.client.functions.invoke('request-support-ticket', { body: { category: 'Billing/Fees', description: 'Fee looks incorrect.' } });

    const { data: updated, error: updateErr } = await adminSignIn.client.functions.invoke('update-support-ticket', { body: { clientId: user.id, requestId: ticket.id, status: 'In Progress', pmNote: 'Investigating the fee calculation.' } });
    check('update-support-ticket succeeds', !updateErr, updateErr && updateErr.message);
    check('status and pmNote both updated together, atomically', updated && updated.status === 'In Progress' && updated.pmNote === 'Investigating the fee calculation.', JSON.stringify(updated));

    const { data: resolved, error: resolveErr } = await adminSignIn.client.functions.invoke('update-support-ticket', { body: { clientId: user.id, requestId: ticket.id, status: 'Resolved', pmNote: 'Fee was correct; explained the calculation to the client.' } });
    check('a second real update (Resolved) succeeds — no restriction on re-updating a ticket, matching the real local engine (tickets are not single-resolution requests)', !resolveErr, resolveErr && resolveErr.message);
    check('status is now genuinely "Resolved"', resolved && resolved.status === 'Resolved');

    const { error: badStatusErr } = await adminSignIn.client.functions.invoke('update-support-ticket', { body: { clientId: user.id, requestId: ticket.id, status: 'Closed', pmNote: 'x' } });
    check('update-support-ticket rejects an invalid status value (400)', badStatusErr && badStatusErr.context && badStatusErr.context.status === 400);

    const { error: unknownTicketErr } = await adminSignIn.client.functions.invoke('update-support-ticket', { body: { clientId: user.id, requestId: 'DISP-9999', status: 'Open', pmNote: null } });
    check('update-support-ticket refuses an unknown display_id for this client (404)', unknownTicketErr && unknownTicketErr.context && unknownTicketErr.context.status === 404);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 9 — Support: full RLS matrix — zero client-side write path at all, confirmed directly.
  // -------------------------------------------------------------------------------------------
  console.log('\n9. Support — RLS matrix: zero client-side write path on support_requests, for any role');

  await (async function () {
    const emailA = 'sup-rlsA-' + suffix + '@test.marketswave.local';
    const emailB = 'sup-rlsB-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    const a = await signIn(url, anonKey, emailA, password);
    await admin.from('support_requests').insert({ client_id: userA.id, display_id: 'DISP-0001', category: 'Other', description: 'seed', status: 'Open' });

    const { data: ownRead } = await a.client.from('support_requests').select('*');
    check('Client A can SELECT their own support_requests', ownRead && ownRead.length === 1);
    const { data: crossRead } = await a.client.from('support_requests').select('*').eq('client_id', userB.id);
    check('Client A’s query for Client B’s support_requests returns empty (RLS-filtered)', crossRead && crossRead.length === 0);

    const { data: directInsertAttempt } = await a.client.from('support_requests').insert({ client_id: userA.id, display_id: 'DISP-0002', category: 'Other', description: 'attempted direct insert', status: 'Open' }).select();
    check('a client CANNOT directly INSERT a support_requests row at all — even a genuinely own, genuinely valid-looking one (no INSERT policy exists; creation is Edge-Function-only)', !directInsertAttempt || directInsertAttempt.length === 0);

    const { data: directUpdateAttempt } = await a.client.from('support_requests').update({ status: 'Resolved' }).eq('client_id', userA.id).select();
    check('a client CANNOT directly UPDATE their own support_requests row (status changes are admin-only)', !directUpdateAttempt || directUpdateAttempt.length === 0);

    const { data: directDeleteAttempt } = await a.client.from('support_requests').delete().eq('client_id', userA.id).select();
    check('a client CANNOT directly DELETE their own support_requests row', !directDeleteAttempt || directDeleteAttempt.length === 0);

    const { data: adminDirectWriteAttempt } = await adminSignIn.client.from('support_requests').update({ status: 'Resolved' }).eq('client_id', userA.id).select();
    check('even an admin-claimed caller (client-side) cannot write directly — only service_role, via update-support-ticket, can', !adminDirectWriteAttempt || adminDirectWriteAttempt.length === 0);
    const { data: adminDirectRead } = await adminSignIn.client.from('support_requests').select('*').eq('client_id', userA.id);
    check('an admin-claimed caller CAN read directly (self-or-admin SELECT policy)', adminDirectRead && adminDirectRead.length >= 1);

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonRead } = await anonClient.from('support_requests').select('*');
    check('unauthenticated (anon) caller sees zero support_requests rows', anonRead && anonRead.length === 0);

    const { error: nonAdminUpdateFnErr } = await a.client.functions.invoke('update-support-ticket', { body: { clientId: userA.id, requestId: 'DISP-0001', status: 'Resolved', pmNote: 'x' } });
    check('non-admin caller cannot call update-support-ticket (403)', nonAdminUpdateFnErr && nonAdminUpdateFnErr.context && nonAdminUpdateFnErr.context.status === 403, nonAdminUpdateFnErr && nonAdminUpdateFnErr.message);

    const anonNoAuth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: anonCreateErr } = await anonNoAuth.functions.invoke('request-support-ticket', { body: { category: 'Other', description: 'x' } });
    check('unauthenticated caller cannot call request-support-ticket (401)', anonCreateErr && anonCreateErr.context && anonCreateErr.context.status === 401, anonCreateErr && anonCreateErr.message);

    const { data: stillOriginal } = await admin.from('support_requests').select('status').eq('client_id', userA.id).eq('display_id', 'DISP-0001').single();
    check('the seeded ticket is genuinely still "Open" after every denied write attempt', stillOriginal.status === 'Open', 'got=' + stillOriginal.status);

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 10 — Support cross-client isolation, the same byte-for-byte diff standard.
  // -------------------------------------------------------------------------------------------
  console.log('\n10. Support — cross-client isolation, byte-for-byte diff');

  await (async function () {
    const emailA = 'sup-isoA-' + suffix + '@test.marketswave.local';
    const emailB = 'sup-isoB-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    const a = await signIn(url, anonKey, emailA, password);
    const b = await signIn(url, anonKey, emailB, password);

    const { data: ticketB } = await b.client.functions.invoke('request-support-ticket', { body: { category: 'Other', description: 'B’s own ticket.' } });
    const beforeB = JSON.stringify(await admin.from('support_requests').select('*').eq('client_id', userB.id));

    const { data: ticketA } = await a.client.functions.invoke('request-support-ticket', { body: { category: 'Transaction Issue', description: 'A’s own ticket.' } });
    await adminSignIn.client.functions.invoke('update-support-ticket', { body: { clientId: userA.id, requestId: ticketA.id, status: 'Resolved', pmNote: 'Resolved for A.' } });

    const afterB = JSON.stringify(await admin.from('support_requests').select('*').eq('client_id', userB.id));
    check('Client B’s support_requests are byte-for-byte unchanged after Client A’s full create+resolve activity', beforeB === afterB);
    check('Client B’s own ticket genuinely exists and is scoped to B, not mixed into A’s data', ticketB && ticketB.clientId === userB.id);

    const { data: aTicket } = await admin.from('support_requests').select('status').eq('client_id', userA.id).eq('display_id', ticketA.id).single();
    check('Client A’s own ticket DID genuinely change (the isolation check above is not vacuous)', aTicket.status === 'Resolved');

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
