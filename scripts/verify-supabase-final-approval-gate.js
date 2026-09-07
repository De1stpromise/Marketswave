#!/usr/bin/env node
// Backend Migration Phase B — Stage 5 (2026-09-02).
//
// Real-stack verification for the final two Approval Gate queues: Client Applications and
// Client Profile Updates. Mirrors every prior stage's own rigor and structure (same
// credential/sign-in helpers, same byte-for-byte cross-client isolation diff technique).
//
// PART 1 — Client Applications: investigated first, per instruction, and found ALREADY
// FULLY BUILT since Stage 3 (schema on `clients`, RLS, approve-client-application/
// reject-client-application Edge Functions, and even admin UI wiring) — nothing new was
// built for this domain. This script's own Part 1 closes the one genuine gap found: no
// PERSISTENT Node script previously exercised approve-client-application/
// reject-client-application against the LOCAL stack. The `clients` table's own full RLS
// matrix is already thoroughly covered by verify-supabase-schema.js (re-run alongside, not
// duplicated here).
//
// PART 2 — Client Profile Updates: genuinely new this stage — client_profiles +
// profile_change_requests tables, request-profile-change/approve-profile-change/
// reject-profile-change Edge Functions.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and localhost-only guard as every other local-stack script in this project.
//
// Standing convention: Node/API-level verification only, no browser automation.
//
// Usage:  node scripts/verify-supabase-final-approval-gate.js
// Requires: the local Supabase stack running, this stage's migration applied
// (`supabase migration up --local`), and the edge-runtime container reachable.

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

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
  await admin.from('profile_change_requests').delete().eq('client_id', userId);
  await admin.from('client_profiles').delete().eq('client_id', userId);
  await admin.from('clients').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);
}

async function main() {
  console.log('Supabase Backend Migration Phase B — Stage 5 verification (final 2 Approval Gate queues)\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyFinalGate-2026!';
  const adminSignIn = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  // ===========================================================================================
  // PART 1 — CLIENT APPLICATIONS
  // ===========================================================================================
  console.log('=== PART 1: Client Applications (already-built functions, new local Node coverage) ===\n');

  // -------------------------------------------------------------------------------------------
  // TEST 1 — approve-client-application: real state transition, double-resolve refused.
  // -------------------------------------------------------------------------------------------
  console.log('1. approve-client-application — real state transition + double-resolve protection');

  await (async function () {
    const email = 'capp-approve-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    await admin.from('clients').insert({ id: user.id, name: 'Test Applicant', email, phone: '+1-555-0100', account_type: 'Individual Account', status: 'pending_review' });

    const { data: approved, error: approveErr } = await adminSignIn.client.functions.invoke('approve-client-application', { body: { clientId: user.id } });
    check('approve-client-application succeeds against a real pending_review row', !approveErr, approveErr && approveErr.message);
    check('response reflects the new active status', approved && approved.status === 'active', JSON.stringify(approved));

    const { data: row } = await admin.from('clients').select('status,application_resolved_at').eq('id', user.id).single();
    check('the real clients row is genuinely active with a real application_resolved_at', row.status === 'active' && !!row.application_resolved_at, JSON.stringify(row));

    const { error: doubleErr } = await adminSignIn.client.functions.invoke('approve-client-application', { body: { clientId: user.id } });
    check('approve-client-application refuses to re-resolve an already-resolved application (409)', doubleErr && doubleErr.context && doubleErr.context.status === 409, doubleErr && doubleErr.message);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 2 — reject-client-application: real state transition with a real reason, kept not
  // deleted, double-resolve refused.
  // -------------------------------------------------------------------------------------------
  console.log('\n2. reject-client-application — real rejection with a reason, kept not deleted');

  await (async function () {
    const email = 'capp-reject-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    await admin.from('clients').insert({ id: user.id, name: 'Test Applicant 2', email, phone: '+1-555-0101', account_type: 'Individual Account', status: 'pending_review' });

    const { data: rejected, error: rejectErr } = await adminSignIn.client.functions.invoke('reject-client-application', { body: { clientId: user.id, reason: 'Unable to verify identity documents.' } });
    check('reject-client-application succeeds', !rejectErr, rejectErr && rejectErr.message);
    check('response reflects the new rejected status', rejected && rejected.status === 'rejected');

    const { data: row } = await admin.from('clients').select('status,application_reason').eq('id', user.id).single();
    check('the real clients row is genuinely rejected with the real reason preserved, not deleted', row.status === 'rejected' && row.application_reason === 'Unable to verify identity documents.', JSON.stringify(row));

    const { error: doubleErr } = await adminSignIn.client.functions.invoke('reject-client-application', { body: { clientId: user.id, reason: 'again' } });
    check('reject-client-application refuses to re-resolve an already-resolved application (409)', doubleErr && doubleErr.context && doubleErr.context.status === 409);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 3 — Cross-client isolation: resolving Client A's application never touches Client B's.
  // -------------------------------------------------------------------------------------------
  console.log('\n3. Cross-client isolation — resolving one application never touches another');

  await (async function () {
    const emailA = 'capp-isoA-' + suffix + '@test.marketswave.local';
    const emailB = 'capp-isoB-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('clients').insert([
      { id: userA.id, name: 'Iso Applicant A', email: emailA, phone: '+1-555-0102', account_type: 'Individual Account', status: 'pending_review' },
      { id: userB.id, name: 'Iso Applicant B', email: emailB, phone: '+1-555-0103', account_type: 'Business Account', status: 'pending_review' }
    ]);

    const beforeB = JSON.stringify(await admin.from('clients').select('*').eq('id', userB.id).single());

    await adminSignIn.client.functions.invoke('approve-client-application', { body: { clientId: userA.id } });

    const afterB = JSON.stringify(await admin.from('clients').select('*').eq('id', userB.id).single());
    check('Client B’s clients row is byte-for-byte unchanged after Client A’s application was resolved', beforeB === afterB);

    const { data: aRow } = await admin.from('clients').select('status').eq('id', userA.id).single();
    check('Client A’s own row DID genuinely change (the isolation check above is not vacuous)', aRow.status === 'active', JSON.stringify(aRow));

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 4 — Authorization negative cases.
  // -------------------------------------------------------------------------------------------
  console.log('\n4. Authorization — non-admin and unauthenticated callers');

  await (async function () {
    const email = 'capp-nonadmin-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    await admin.from('clients').insert({ id: user.id, name: 'Nonadmin Applicant', email, phone: '+1-555-0104', account_type: 'Individual Account', status: 'pending_review' });
    const nonAdmin = await signIn(url, anonKey, email, password);
    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { error: approveNonAdminErr } = await nonAdmin.client.functions.invoke('approve-client-application', { body: { clientId: user.id } });
    check('Non-admin caller cannot call approve-client-application (403)', approveNonAdminErr && approveNonAdminErr.context && approveNonAdminErr.context.status === 403, approveNonAdminErr && approveNonAdminErr.message);
    const { error: rejectNonAdminErr } = await nonAdmin.client.functions.invoke('reject-client-application', { body: { clientId: user.id, reason: 'x' } });
    check('Non-admin caller cannot call reject-client-application (403)', rejectNonAdminErr && rejectNonAdminErr.context && rejectNonAdminErr.context.status === 403);

    const { error: anonApproveErr } = await anonClient.functions.invoke('approve-client-application', { body: { clientId: user.id } });
    check('Unauthenticated caller cannot call approve-client-application (401)', anonApproveErr && anonApproveErr.context && anonApproveErr.context.status === 401, anonApproveErr && anonApproveErr.message);

    const { data: stillPending } = await admin.from('clients').select('status').eq('id', user.id).single();
    check('The application is genuinely still pending_review after every denied attempt', stillPending.status === 'pending_review', 'got=' + stillPending.status);

    await cleanupClient(admin, user.id);
  })();

  // ===========================================================================================
  // PART 2 — CLIENT PROFILE UPDATES
  // ===========================================================================================
  console.log('\n=== PART 2: Client Profile Updates (genuinely new this stage) ===\n');

  // -------------------------------------------------------------------------------------------
  // TEST 5 — request-profile-change validation + the no-fake-fallback current-value snapshot.
  // -------------------------------------------------------------------------------------------
  console.log('5. request-profile-change — validation and the no-fake-fallback current-value snapshot');

  await (async function () {
    const email = 'pcr-validation-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { error: badFieldErr } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'dateOfBirth', requestedValue: '1990-01-01' } });
    check('rejects dateOfBirth — confirmed genuinely removed from REQUESTABLE_SETTINGS_FIELDS (400)', badFieldErr && badFieldErr.context && badFieldErr.context.status === 400, badFieldErr && badFieldErr.message);

    const { error: badLegalNameErr } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'legalName', requestedValue: { firstName: 'Only' } } });
    check('rejects an incomplete legalName (missing lastName)', badLegalNameErr && badLegalNameErr.context && badLegalNameErr.context.status === 400);

    const { error: badAddressErr } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'address', requestedValue: { street: 'Only Street' } } });
    check('rejects an incomplete address (missing city)', badAddressErr && badAddressErr.context && badAddressErr.context.status === 400);

    const { error: badIdDocErr } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'idDocument', requestedValue: {} } });
    check('rejects an incomplete idDocument (missing documentType)', badIdDocErr && badIdDocErr.context && badIdDocErr.context.status === 400);

    // THE no-fake-fallback property — a client with no client_profiles row at all yet.
    const { data: created, error: createErr } = await clientSignIn.client.functions.invoke('request-profile-change', {
      body: { field: 'legalName', requestedValue: { firstName: 'Marcus', lastName: 'Chen' }, reason: 'Legal name updated after marriage.' }
    });
    check('a valid legalName request succeeds', !createErr, createErr && createErr.message);
    check('created request is scoped to the caller’s own uid, never a client-supplied id', created && created.clientId === user.id, JSON.stringify(created));
    check('created request status defaults to pending', created && created.status === 'pending');
    check('currentValue is REAL null for a client with no client_profiles row yet — never a fabricated "John A. Doe"-style default', created && created.currentValue === null, JSON.stringify(created));
    check('requestedValue is preserved verbatim', created && created.requestedValue.firstName === 'Marcus' && created.requestedValue.lastName === 'Chen');
    check('reason is preserved verbatim', created && created.reason === 'Legal name updated after marriage.');

    // Requesting a SECOND field concurrently is fine — the duplicate guard is per-field.
    const { error: addressErr } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'address', requestedValue: { street: '10 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'United States' } } });
    check('a request for a DIFFERENT field is not blocked by the pending legalName request', !addressErr, addressErr && addressErr.message);

    // A second pending request for the SAME field is refused.
    const { error: duplicateErr } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'legalName', requestedValue: { firstName: 'Marcus', lastName: 'Chen II' } } });
    check('a second pending request for the SAME field is refused (409)', duplicateErr && duplicateErr.context && duplicateErr.context.status === 409, duplicateErr && duplicateErr.message);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 6 — approve-profile-change: field-specific correctness for EACH of the 3 fields, not
  // one tested as a stand-in for all three, per instruction. Also: real upsert-on-first-change.
  // -------------------------------------------------------------------------------------------
  console.log('\n6. approve-profile-change — field-specific correctness for legalName, address, AND idDocument');

  await (async function () {
    const email = 'pcr-approve-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    // No client_profiles row exists yet — approving the first-ever change must create it
    // (a real upsert), not fail because "there's nothing to update yet."
    const { count: profileCountBefore } = await admin.from('client_profiles').select('*', { count: 'exact', head: true }).eq('client_id', user.id);
    check('no client_profiles row exists yet for this client (genuine starting state)', profileCountBefore === 0);

    // --- legalName ---
    const { data: legalNameReq } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'legalName', requestedValue: { firstName: 'Priya', lastName: 'Sharma' } } });
    const { data: legalNameApproved, error: legalNameErr } = await adminSignIn.client.functions.invoke('approve-profile-change', { body: { requestId: legalNameReq.id } });
    check('approve-profile-change succeeds for legalName', !legalNameErr, legalNameErr && legalNameErr.message);
    check('legalName request is now "approved" with a real resolvedAt', legalNameApproved && legalNameApproved.status === 'approved' && !!legalNameApproved.resolvedAt);
    const { data: profileAfterLegalName } = await admin.from('client_profiles').select('*').eq('client_id', user.id).single();
    check('client_profiles row was genuinely CREATED (upsert on first change) with the correct legal_name', profileAfterLegalName && profileAfterLegalName.legal_name.firstName === 'Priya' && profileAfterLegalName.legal_name.lastName === 'Sharma', JSON.stringify(profileAfterLegalName));
    check('address/id_document remain null — approving legalName did not touch other fields', profileAfterLegalName.address === null && profileAfterLegalName.id_document === null);

    // --- address ---
    const { data: addressReq } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'address', requestedValue: { street: '482 Harborview Lane', city: 'Boston', state: 'MA', zip: '02110', country: 'United States' } } });
    const { error: addressApproveErr } = await adminSignIn.client.functions.invoke('approve-profile-change', { body: { requestId: addressReq.id } });
    check('approve-profile-change succeeds for address', !addressApproveErr, addressApproveErr && addressApproveErr.message);
    const { data: profileAfterAddress } = await admin.from('client_profiles').select('*').eq('client_id', user.id).single();
    check('address is genuinely correct after approval (a real UPDATE, not a second row)', profileAfterAddress.address && profileAfterAddress.address.city === 'Boston' && profileAfterAddress.address.zip === '02110', JSON.stringify(profileAfterAddress.address));
    check('legal_name from the earlier approval is STILL correct (this update did not clobber it)', profileAfterAddress.legal_name.firstName === 'Priya');

    // --- idDocument ---
    const { data: idDocReq } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'idDocument', requestedValue: { documentType: 'Passport', fileName: 'passport-scan.pdf' } } });
    const { error: idDocApproveErr } = await adminSignIn.client.functions.invoke('approve-profile-change', { body: { requestId: idDocReq.id } });
    check('approve-profile-change succeeds for idDocument', !idDocApproveErr, idDocApproveErr && idDocApproveErr.message);
    const { data: profileAfterIdDoc } = await admin.from('client_profiles').select('*').eq('client_id', user.id).single();
    check('id_document is genuinely correct after approval', profileAfterIdDoc.id_document && profileAfterIdDoc.id_document.documentType === 'Passport' && profileAfterIdDoc.id_document.fileName === 'passport-scan.pdf', JSON.stringify(profileAfterIdDoc.id_document));
    check('ALL THREE fields are simultaneously correct on the same row after 3 independent approvals', profileAfterIdDoc.legal_name.lastName === 'Sharma' && profileAfterIdDoc.address.city === 'Boston' && profileAfterIdDoc.id_document.documentType === 'Passport', JSON.stringify(profileAfterIdDoc));

    // Double-approve refused.
    const { error: doubleApproveErr } = await adminSignIn.client.functions.invoke('approve-profile-change', { body: { requestId: legalNameReq.id } });
    check('approve-profile-change refuses to re-approve an already-resolved request (409)', doubleApproveErr && doubleApproveErr.context && doubleApproveErr.context.status === 409);

    // A SECOND, later legalName change genuinely overwrites the field wholesale (matches the
    // real local engine's own `profile[request.field] = request.requestedValue` behavior —
    // not a partial merge of firstName/lastName individually).
    const { data: legalNameReq2 } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'legalName', requestedValue: { firstName: 'Priyanka', lastName: 'Sharma-Rao' } } });
    check('currentValue on the SECOND request correctly snapshots the REAL current value (Priya Sharma), not null', legalNameReq2 && legalNameReq2.currentValue && legalNameReq2.currentValue.firstName === 'Priya', JSON.stringify(legalNameReq2));
    await adminSignIn.client.functions.invoke('approve-profile-change', { body: { requestId: legalNameReq2.id } });
    const { data: finalProfile } = await admin.from('client_profiles').select('legal_name').eq('client_id', user.id).single();
    check('legal_name is wholesale-replaced by the second approval (Priyanka Sharma-Rao), not merged field-by-field', finalProfile.legal_name.firstName === 'Priyanka' && finalProfile.legal_name.lastName === 'Sharma-Rao', JSON.stringify(finalProfile));

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 7 — reject-profile-change: marks rejected with resolutionNote (separate from reason),
  // moves nothing.
  // -------------------------------------------------------------------------------------------
  console.log('\n7. reject-profile-change — resolutionNote kept separate from the client’s own reason, moves nothing');

  await (async function () {
    const email = 'pcr-reject-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const clientSignIn = await signIn(url, anonKey, email, password);

    const { data: request } = await clientSignIn.client.functions.invoke('request-profile-change', { body: { field: 'idDocument', requestedValue: { documentType: 'Driver License', fileName: 'dl.jpg' }, reason: 'My passport expired.' } });
    const { data: rejected, error: rejectErr } = await adminSignIn.client.functions.invoke('reject-profile-change', { body: { requestId: request.id, resolutionNote: 'Document image is illegible — please resubmit a clearer scan.' } });
    check('reject-profile-change succeeds', !rejectErr, rejectErr && rejectErr.message);
    check('rejected request status is "rejected"', rejected && rejected.status === 'rejected');
    check('resolutionNote (PM) and reason (client) are BOTH preserved, distinctly, neither clobbering the other', rejected && rejected.resolutionNote === 'Document image is illegible — please resubmit a clearer scan.' && rejected.reason === 'My passport expired.', JSON.stringify(rejected));

    const { count: profileCount } = await admin.from('client_profiles').select('*', { count: 'exact', head: true }).eq('client_id', user.id);
    check('a rejected profile change never creates/touches a client_profiles row (nothing to move)', profileCount === 0);

    const { error: doubleRejectErr } = await adminSignIn.client.functions.invoke('reject-profile-change', { body: { requestId: request.id, resolutionNote: 'again' } });
    check('reject-profile-change refuses to re-resolve an already-resolved request (409)', doubleRejectErr && doubleRejectErr.context && doubleRejectErr.context.status === 409);

    await cleanupClient(admin, user.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 8 — Cross-client isolation across client_profiles and profile_change_requests.
  // -------------------------------------------------------------------------------------------
  console.log('\n8. Cross-client isolation across client_profiles and profile_change_requests');

  await (async function () {
    const emailA = 'pcr-isoA-' + suffix + '@test.marketswave.local';
    const emailB = 'pcr-isoB-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    const clientSignInA = await signIn(url, anonKey, emailA, password);
    const clientSignInB = await signIn(url, anonKey, emailB, password);

    // B has its own real activity so the isolation check isn't vacuous.
    const { data: reqB } = await clientSignInB.client.functions.invoke('request-profile-change', { body: { field: 'legalName', requestedValue: { firstName: 'Diego', lastName: 'Ruiz' } } });

    const beforeBProfile = JSON.stringify(await admin.from('client_profiles').select('*').eq('client_id', userB.id));
    const beforeBRequests = JSON.stringify(await admin.from('profile_change_requests').select('*').eq('client_id', userB.id));

    // Client A does a full round: request + approve for two different fields.
    const { data: reqA1 } = await clientSignInA.client.functions.invoke('request-profile-change', { body: { field: 'legalName', requestedValue: { firstName: 'Amara', lastName: 'Okafor' } } });
    await adminSignIn.client.functions.invoke('approve-profile-change', { body: { requestId: reqA1.id } });
    const { data: reqA2 } = await clientSignInA.client.functions.invoke('request-profile-change', { body: { field: 'address', requestedValue: { street: '1 Isolation Way', city: 'Denver', state: 'CO', zip: '80202', country: 'United States' } } });
    await adminSignIn.client.functions.invoke('reject-profile-change', { body: { requestId: reqA2.id, resolutionNote: 'Test rejection.' } });

    const afterBProfile = JSON.stringify(await admin.from('client_profiles').select('*').eq('client_id', userB.id));
    const afterBRequests = JSON.stringify(await admin.from('profile_change_requests').select('*').eq('client_id', userB.id));

    check('Client B’s client_profiles are byte-for-byte unchanged after Client A’s full approve+reject activity', beforeBProfile === afterBProfile);
    check('Client B’s profile_change_requests are byte-for-byte unchanged (only B’s own earlier request exists)', beforeBRequests === afterBRequests);
    check('Client B’s own request genuinely exists and is scoped to B, not mixed into A’s data', reqB && reqB.clientId === userB.id);

    const { data: aProfile } = await admin.from('client_profiles').select('*').eq('client_id', userA.id).single();
    check('Client A’s own client_profiles DID genuinely change (the isolation check above is not vacuous)', aProfile && aProfile.legal_name && aProfile.legal_name.firstName === 'Amara', JSON.stringify(aProfile));

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 9 — RLS — full matrix, zero client-side write path outside the Edge Functions, on
  // both new tables, for every role including admin.
  // -------------------------------------------------------------------------------------------
  console.log('\n9. RLS — full matrix, zero client-side write path outside the Edge Functions');

  await (async function () {
    const emailA = 'pcr-rlsA-' + suffix + '@test.marketswave.local';
    const emailB = 'pcr-rlsB-' + suffix + '@test.marketswave.local';
    const userA = await createTestClient(admin, emailA, password);
    const userB = await createTestClient(admin, emailB, password);
    await admin.from('client_profiles').insert({ client_id: userA.id, legal_name: { firstName: 'X', lastName: 'Y' } });
    await admin.from('profile_change_requests').insert({ client_id: userA.id, field: 'address', requested_value: { street: 'S', city: 'C' }, status: 'pending' });

    const a = await signIn(url, anonKey, emailA, password);

    // ---- Self-reads succeed, cross-client reads return empty ----------------------------
    const { data: ownProfile } = await a.client.from('client_profiles').select('*');
    check('Client A can SELECT their own client_profiles', ownProfile && ownProfile.length === 1);
    const { data: ownRequests } = await a.client.from('profile_change_requests').select('*');
    check('Client A can SELECT their own profile_change_requests', ownRequests && ownRequests.length === 1);
    const { data: crossProfile } = await a.client.from('client_profiles').select('*').eq('client_id', userB.id);
    check('Client A’s query for Client B’s client_profiles returns empty (RLS-filtered, not an error)', crossProfile && crossProfile.length === 0);

    // ---- client_profiles: NO insert policy for the client at all --------------------------
    const { data: profileInsertAttempt } = await a.client.from('client_profiles').insert({ client_id: userA.id, legal_name: { firstName: 'Spoofed', lastName: 'Name' } }).select();
    check('Client A cannot INSERT a client_profiles row directly at all (profiles are created only via approve-profile-change)', !profileInsertAttempt || profileInsertAttempt.length === 0);

    // ---- profile_change_requests INSERT: only a genuinely own, genuinely pending row -------
    const { data: legitInsert, error: legitErr } = await a.client.from('profile_change_requests').insert({ client_id: userA.id, field: 'idDocument', requested_value: { documentType: 'Passport' }, status: 'pending' }).select();
    check('Client A CAN directly insert their own genuinely-pending profile_change_requests row via RLS', legitInsert && legitInsert.length === 1, legitErr && legitErr.message);
    const { data: spoofClientInsert } = await a.client.from('profile_change_requests').insert({ client_id: userB.id, field: 'idDocument', requested_value: { documentType: 'Passport' }, status: 'pending' }).select();
    check('Client A cannot INSERT a profile_change_requests row under Client B’s client_id', !spoofClientInsert || spoofClientInsert.length === 0);
    const { data: spoofStatusInsert } = await a.client.from('profile_change_requests').insert({ client_id: userA.id, field: 'idDocument', requested_value: { documentType: 'Passport' }, status: 'approved' }).select();
    check('Client A cannot INSERT a profile_change_requests row with a non-pending status', !spoofStatusInsert || spoofStatusInsert.length === 0);

    // ---- No UPDATE/DELETE path for any role but service_role ------------------------------
    const { data: profileUpdateAttempt } = await a.client.from('client_profiles').update({ legal_name: { firstName: 'Hacked', lastName: 'Name' } }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own client_profiles row directly', !profileUpdateAttempt || profileUpdateAttempt.length === 0);
    const { data: requestUpdateAttempt } = await a.client.from('profile_change_requests').update({ status: 'approved' }).eq('client_id', userA.id).select();
    check('Client A cannot UPDATE their own profile_change_requests row directly', !requestUpdateAttempt || requestUpdateAttempt.length === 0);
    const { data: profileDeleteAttempt } = await a.client.from('client_profiles').delete().eq('client_id', userA.id).select();
    check('Client A cannot DELETE their own client_profiles row directly', !profileDeleteAttempt || profileDeleteAttempt.length === 0);

    const { data: adminUpdateAttempt } = await adminSignIn.client.from('client_profiles').update({ legal_name: { firstName: 'Admin', lastName: 'Direct' } }).eq('client_id', userA.id).select();
    check('Even an admin-claimed caller (client-side) cannot write directly — only service_role, via the Edge Functions, can', !adminUpdateAttempt || adminUpdateAttempt.length === 0);
    const { data: adminReadsA } = await adminSignIn.client.from('client_profiles').select('*').eq('client_id', userA.id);
    check('An admin-claimed caller CAN read Client A’s client_profiles directly (self-or-admin SELECT policy)', adminReadsA && adminReadsA.length >= 1);

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: anonProfiles } = await anonClient.from('client_profiles').select('*');
    check('Unauthenticated (anon) caller sees zero client_profiles rows', anonProfiles && anonProfiles.length === 0);
    const { data: anonRequests } = await anonClient.from('profile_change_requests').select('*');
    check('Unauthenticated (anon) caller sees zero profile_change_requests rows', anonRequests && anonRequests.length === 0);

    const { data: profileStillOriginal } = await admin.from('client_profiles').select('legal_name').eq('client_id', userA.id).single();
    check('client_profiles row is genuinely still original after every denied write attempt', profileStillOriginal.legal_name.firstName === 'X', JSON.stringify(profileStillOriginal));

    await cleanupClient(admin, userA.id);
    await cleanupClient(admin, userB.id);
  })();

  // -------------------------------------------------------------------------------------------
  // TEST 10 — Authorization negative cases for the 3 profile-change functions.
  // -------------------------------------------------------------------------------------------
  console.log('\n10. Authorization — non-admin and unauthenticated callers');

  await (async function () {
    const email = 'pcr-nonadmin-' + suffix + '@test.marketswave.local';
    const user = await createTestClient(admin, email, password);
    const nonAdmin = await signIn(url, anonKey, email, password);
    const { data: request } = await nonAdmin.client.functions.invoke('request-profile-change', { body: { field: 'legalName', requestedValue: { firstName: 'A', lastName: 'B' } } });

    const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { error: approveNonAdminErr } = await nonAdmin.client.functions.invoke('approve-profile-change', { body: { requestId: request.id } });
    check('Non-admin caller cannot call approve-profile-change (403)', approveNonAdminErr && approveNonAdminErr.context && approveNonAdminErr.context.status === 403, approveNonAdminErr && approveNonAdminErr.message);
    const { error: rejectNonAdminErr } = await nonAdmin.client.functions.invoke('reject-profile-change', { body: { requestId: request.id, resolutionNote: 'x' } });
    check('Non-admin caller cannot call reject-profile-change (403)', rejectNonAdminErr && rejectNonAdminErr.context && rejectNonAdminErr.context.status === 403);

    const { error: anonRequestErr } = await anonClient.functions.invoke('request-profile-change', { body: { field: 'legalName', requestedValue: { firstName: 'A', lastName: 'B' } } });
    check('Unauthenticated caller cannot call request-profile-change (401)', anonRequestErr && anonRequestErr.context && anonRequestErr.context.status === 401, anonRequestErr && anonRequestErr.message);
    const { error: anonApproveErr } = await anonClient.functions.invoke('approve-profile-change', { body: { requestId: request.id } });
    check('Unauthenticated caller cannot call approve-profile-change (401)', anonApproveErr && anonApproveErr.context && anonApproveErr.context.status === 401);

    const { data: stillPending } = await admin.from('profile_change_requests').select('status').eq('id', request.id).single();
    check('The request is genuinely still pending after every denied approve/reject attempt', stillPending.status === 'pending', 'got=' + stillPending.status);

    await cleanupClient(admin, user.id);
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
