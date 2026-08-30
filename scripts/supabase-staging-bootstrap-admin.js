#!/usr/bin/env node
// Supabase Migration — Stage 3 (Aug 30, 2026).
//
// Creates (or reuses) the real staging PM/admin Supabase Auth account and writes its real
// `{ is_admin: true }` row into public.user_roles — the Supabase-side equivalent of
// scripts/staging-bootstrap-admin.js (Firebase), same technique (find-or-create, write the
// privileged marker, re-fetch to confirm live), against the REAL "Marketswave Staging"
// Supabase project (ujnmlwbpginplfnofhhv) instead of the local Docker stack. DO NOT confuse
// this with scripts/supabase-bootstrap-admin.js, which is local-stack-only and deliberately
// carries a hardcoded, non-secret password — this script creates a real account on a real
// cloud project and must never do that.
//
// CREDENTIALS, HANDLED WITH THE SAME DISCIPLINE AS staging-bootstrap-admin.js:
//   - The SERVICE_ROLE key (this project's real, genuinely sensitive credential — it
//     bypasses RLS entirely) is never hardcoded or referenced by a repo-relative path
//     anywhere in this file. It is read from a JSON file at the path given via the
//     SUPABASE_STAGING_CREDENTIALS_FILE environment variable — the operator points that at
//     wherever they keep it OUTSIDE this repository (this session's own copy lives at
//     C:\WorkDirectory\marketswave-secrets\supabase-staging-api-keys.json, mirroring the
//     Firebase staging service account key's own location in that same directory — never
//     referenced by that literal path here, only via the env var, exactly like
//     GOOGLE_APPLICATION_CREDENTIALS's own discipline). The file is the raw JSON array
//     `supabase projects api-keys --reveal -o json` produces; this script reads the
//     `service_role` entry's `api_key` field out of it and nothing else.
//   - The PM ACCOUNT'S OWN PASSWORD is, for the same reason, never hardcoded (unlike the
//     local-stack script's own committed constant, safe only because it's fully offline).
//     On first run (account doesn't exist yet), pass the desired password via the
//     STAGING_PM_PASSWORD env var, or omit it and this script generates a random one and
//     prints it ONCE — write it down, it is not stored anywhere and cannot be recovered,
//     only reset via the real Supabase dashboard's Auth > Users panel. Re-runs against an
//     already-existing account never touch the password (only re-assert the user_roles row),
//     so STAGING_PM_PASSWORD is simply ignored then.
//
// Usage:
//   SUPABASE_STAGING_CREDENTIALS_FILE=/path/to/supabase-staging-api-keys.json node scripts/supabase-staging-bootstrap-admin.js
// Optional: STAGING_PM_PASSWORD=... to set the password on first creation.

const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_URL = 'https://ujnmlwbpginplfnofhhv.supabase.co';
const PM_EMAIL = 'pm@marketswave-staging.internal';

function generatePassword() {
  return crypto.randomBytes(24).toString('base64url');
}

function readServiceRoleKey() {
  const credFile = process.env.SUPABASE_STAGING_CREDENTIALS_FILE;
  if (!credFile) {
    throw new Error(
      'SUPABASE_STAGING_CREDENTIALS_FILE is not set. Point it at the JSON file produced by ' +
      '`supabase projects api-keys --project-ref ujnmlwbpginplfnofhhv --reveal -o json`, kept ' +
      'OUTSIDE this repository, e.g.:\n' +
      '  SUPABASE_STAGING_CREDENTIALS_FILE=/path/to/supabase-staging-api-keys.json node scripts/supabase-staging-bootstrap-admin.js'
    );
  }
  const keys = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  const serviceRole = keys.find(function (k) { return k.name === 'service_role'; });
  if (!serviceRole) throw new Error('No "service_role" entry found in ' + credFile);
  return serviceRole.api_key;
}

async function main() {
  console.log('Bootstrapping REAL staging admin/PM account — project: Marketswave Staging (ujnmlwbpginplfnofhhv)');
  const serviceRoleKey = readServiceRoleKey();
  console.log('  Using service_role key from SUPABASE_STAGING_CREDENTIALS_FILE (path not echoed here).');
  console.log('');

  const admin = createClient(PROJECT_URL, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let user;
  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw new Error('listUsers() failed: ' + listErr.message);
  user = listData.users.find(function (u) { return u.email === PM_EMAIL; });

  if (user) {
    console.log('Found existing account: ' + user.id + ' (' + PM_EMAIL + ')');
  } else {
    const password = process.env.STAGING_PM_PASSWORD || generatePassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: PM_EMAIL,
      password: password,
      email_confirm: true
    });
    if (createErr) throw new Error('createUser() failed: ' + createErr.message);
    user = created.user;
    console.log('Created new account:    ' + user.id + ' (' + PM_EMAIL + ')');
    if (!process.env.STAGING_PM_PASSWORD) {
      console.log('');
      console.log('  GENERATED PASSWORD (shown once, not stored anywhere): ' + password);
      console.log('  Save this now. It cannot be recovered — only reset via the Supabase dashboard.');
    }
  }

  const { error: upsertErr } = await admin
    .from('user_roles')
    .upsert({ user_id: user.id, is_admin: true }, { onConflict: 'user_id' });
  if (upsertErr) throw new Error('user_roles upsert failed: ' + upsertErr.message);

  const { data: confirmed, error: confirmErr } = await admin
    .from('user_roles')
    .select('user_id, is_admin')
    .eq('user_id', user.id)
    .single();
  if (confirmErr) throw new Error('Post-upsert verification read failed: ' + confirmErr.message);
  if (!confirmed || confirmed.is_admin !== true) {
    throw new Error('Admin role did not take effect — got: ' + JSON.stringify(confirmed));
  }

  console.log('');
  console.log('user_roles row confirmed live on REAL staging: { user_id: ' + user.id + ', is_admin: true }');
  console.log('Verify in the Supabase dashboard: https://supabase.com/dashboard/project/ujnmlwbpginplfnofhhv/auth/users');
}

main().catch(function (err) {
  console.error('');
  console.error('Staging bootstrap FAILED: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
