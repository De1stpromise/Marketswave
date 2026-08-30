#!/usr/bin/env node
// Supabase Migration — Stage 1 (Aug 30, 2026).
//
// Real-stack RLS/schema verification for the `clients`/`user_roles` migration
// (supabase/migrations/20260830094238_create_clients_and_admin_roles.sql). This is Stage
// 1's own regression check, the Supabase-side analog of scripts/golden-path-regression.js —
// but unlike that script (which exercises real client-facing app code end to end), this one
// exercises the RAW schema/RLS layer directly via @supabase/supabase-js, since there is no
// app code talking to Supabase yet (that's Stage 2). Run it any time the migration changes
// to confirm the security properties still hold, not just that the tables exist.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and same localhost-only guard as scripts/supabase-bootstrap-admin.js.
//
// Usage:  node scripts/verify-supabase-schema.js
// Requires the local Supabase stack to already be running (`supabase start`).

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

function decodeJwtPayload(token) {
  const parts = token.split('.');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function createTestUser(admin, email, password) {
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

async function main() {
  console.log('Supabase Stage 1 schema/RLS verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const suffix = crypto.randomBytes(4).toString('hex');
  const clientAEmail = 'verify-client-a-' + suffix + '@marketswave.local';
  const clientBEmail = 'verify-client-b-' + suffix + '@marketswave.local';
  const adminEmail = 'verify-admin-' + suffix + '@marketswave.local';
  const password = 'VerifyTest-2026!';

  const userA = await createTestUser(admin, clientAEmail, password);
  const userB = await createTestUser(admin, clientBEmail, password);
  const adminUser = await createTestUser(admin, adminEmail, password);
  await admin.from('user_roles').upsert({ user_id: adminUser.id, is_admin: true }, { onConflict: 'user_id' });

  console.log('Created test users: A=' + userA.id + ' B=' + userB.id + ' admin=' + adminUser.id + '\n');

  // ---- Sign in as each, decode JWT claims ------------------------------------------------
  const a = await signIn(url, anonKey, clientAEmail, password);
  const b = await signIn(url, anonKey, clientBEmail, password);
  const adminSignIn = await signIn(url, anonKey, adminEmail, password);

  const aClaims = decodeJwtPayload(a.session.access_token);
  const adminClaims = decodeJwtPayload(adminSignIn.session.access_token);

  check(
    'Custom access token hook: ordinary client JWT has app_metadata.is_admin === false',
    aClaims.app_metadata && aClaims.app_metadata.is_admin === false,
    'got: ' + JSON.stringify(aClaims.app_metadata)
  );
  check(
    'Custom access token hook: admin JWT has app_metadata.is_admin === true',
    adminClaims.app_metadata && adminClaims.app_metadata.is_admin === true,
    'got: ' + JSON.stringify(adminClaims.app_metadata)
  );

  // ---- INSERT: a client may create exactly their own row, status forced pending_review ---
  const { error: insertOwnErr } = await a.client.from('clients').insert({
    id: userA.id,
    name: 'Client A Test',
    email: clientAEmail,
    phone: '+1 555 0100',
    account_type: 'Individual Account',
    status: 'pending_review'
  });
  check('Client A can insert their own row (id=own uid, status=pending_review, email matches)', !insertOwnErr, insertOwnErr && insertOwnErr.message);

  // Spoof attempts, each expected to be rejected:
  const { error: spoofIdErr } = await b.client.from('clients').insert({
    id: userA.id, // someone else's id
    name: 'Spoofed', email: clientBEmail, phone: '+1 555 0101',
    account_type: 'Individual Account', status: 'pending_review'
  });
  check('Client B cannot insert a row under Client A\'s id', !!spoofIdErr);

  const { error: spoofStatusErr } = await b.client.from('clients').insert({
    id: userB.id, name: 'Client B', email: clientBEmail, phone: '+1 555 0102',
    account_type: 'Individual Account', status: 'active' // trying to skip review
  });
  check('Client cannot insert their own row with status other than pending_review', !!spoofStatusErr);

  const { error: spoofEmailErr } = await b.client.from('clients').insert({
    id: userB.id, name: 'Client B', email: 'someone-else@example.com', phone: '+1 555 0103',
    account_type: 'Individual Account', status: 'pending_review'
  });
  check('Client cannot insert their own row with an email other than their verified Auth email', !!spoofEmailErr);

  const { error: badAccountTypeErr } = await b.client.from('clients').insert({
    id: userB.id, name: 'Client B', email: clientBEmail, phone: '+1 555 0104',
    account_type: 'Not A Real Type', status: 'pending_review'
  });
  check('Client cannot insert an invalid account_type (table CHECK constraint)', !!badAccountTypeErr);

  // Now insert Client B's real, valid row so cross-client isolation has two real rows to test.
  const { error: insertBErr } = await b.client.from('clients').insert({
    id: userB.id, name: 'Client B Test', email: clientBEmail, phone: '+1 555 0105',
    account_type: 'Joint Account', status: 'pending_review'
  });
  check('Client B can insert their own valid row after their bad attempts were all rejected', !insertBErr, insertBErr && insertBErr.message);

  // ---- SELECT isolation: A sees only their own row, not B's ------------------------------
  const { data: aOwnRows } = await a.client.from('clients').select('id');
  check(
    'Client A\'s SELECT returns exactly their own row, never Client B\'s',
    Array.isArray(aOwnRows) && aOwnRows.length === 1 && aOwnRows[0].id === userA.id,
    'got: ' + JSON.stringify(aOwnRows)
  );

  // ---- UPDATE/DELETE: denied for every client role, even on their own row ----------------
  const { data: updateResult } = await a.client.from('clients').update({ status: 'active' }).eq('id', userA.id).select();
  check(
    'Client A cannot update their own row\'s status (no UPDATE policy for authenticated)',
    Array.isArray(updateResult) && updateResult.length === 0,
    'got: ' + JSON.stringify(updateResult)
  );
  const { data: stillPending } = await admin.from('clients').select('status').eq('id', userA.id).single();
  check('Client A\'s row is genuinely still pending_review after the denied update attempt (service_role read)', stillPending && stillPending.status === 'pending_review', 'got: ' + JSON.stringify(stillPending));

  const { data: deleteResult } = await a.client.from('clients').delete().eq('id', userA.id).select();
  check('Client A cannot delete their own row (no DELETE policy for authenticated)', Array.isArray(deleteResult) && deleteResult.length === 0, 'got: ' + JSON.stringify(deleteResult));

  // ---- Admin claim genuinely unlocks cross-client visibility, the core security property -
  const { data: adminRows, error: adminSelectErr } = await adminSignIn.client.from('clients').select('id').in('id', [userA.id, userB.id]);
  check(
    'Admin-claimed caller can see BOTH Client A\'s and Client B\'s rows',
    !adminSelectErr && Array.isArray(adminRows) && adminRows.length === 2,
    (adminSelectErr && adminSelectErr.message) || ('got: ' + JSON.stringify(adminRows))
  );

  // Admin also cannot write directly (no INSERT policy grants authenticated+admin an
  // exception, and no UPDATE/DELETE policy exists for authenticated at all) — resolving
  // applications is reserved for service_role/a future Edge Function, mirroring the
  // Firestore rules' own "writes are 100% Cloud-Function-gated, admin reads don't imply
  // admin writes" design.
  const { data: adminUpdateResult } = await adminSignIn.client.from('clients').update({ status: 'active' }).eq('id', userA.id).select();
  check('Admin-claimed caller (client-side) still cannot write directly — no client-role write path exists for anyone', Array.isArray(adminUpdateResult) && adminUpdateResult.length === 0, 'got: ' + JSON.stringify(adminUpdateResult));

  // service_role, by contrast, genuinely can (bypasses RLS entirely, same as Admin SDK) —
  // proves the eventual approve/reject Edge Function has a real path to use.
  const { error: serviceUpdateErr } = await admin.from('clients').update({ status: 'active', application_resolved_at: new Date().toISOString() }).eq('id', userA.id);
  check('service_role CAN update a row directly (bypasses RLS, the path a future Edge Function will use)', !serviceUpdateErr, serviceUpdateErr && serviceUpdateErr.message);

  // ---- anon (unauthenticated) role: denied everything ------------------------------------
  const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: anonRows } = await anonClient.from('clients').select('id');
  check('Unauthenticated (anon) caller sees zero rows', Array.isArray(anonRows) && anonRows.length === 0, 'got: ' + JSON.stringify(anonRows));

  // ---- cleanup -----------------------------------------------------------------------------
  await admin.from('clients').delete().in('id', [userA.id, userB.id]);
  await admin.from('user_roles').delete().in('user_id', [userA.id, userB.id, adminUser.id]);
  await admin.auth.admin.deleteUser(userA.id);
  await admin.auth.admin.deleteUser(userB.id);
  await admin.auth.admin.deleteUser(adminUser.id);

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
