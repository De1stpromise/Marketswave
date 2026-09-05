#!/usr/bin/env node
// Backend Migration Phase C — Stage 1 (2026-09-06).
//
// Creates an ADDITIONAL real PM account against the REAL "Marketswave Staging" Supabase
// project (ujnmlwbpginplfnofhhv), alongside (never replacing) the single bootstrap account
// scripts/supabase-staging-bootstrap-admin.js created. Mirrors that script's exact
// credential-handling discipline — see its own header for the full "why," not repeated here
// verbatim, only the one real difference: this script's email/password come from CLI
// arguments (a genuinely new identity every time it's run), never a fixed constant.
//
// CREDENTIALS: the service_role key is read from the JSON file at the path given via
// SUPABASE_STAGING_CREDENTIALS_FILE (never hardcoded, never a repo-relative path — same
// discipline as every other real-cloud-staging script in this project). The new PM's own
// password is whatever you pass on the command line — this script does not generate one for
// you, since (unlike the very first bootstrap, which had no operator-supplied identity yet
// to work from) you're the one choosing this PM's real credential.
//
// LOCAL-STACK-FIRST, PER THE STANDING CONVENTION: verify this whole flow works against
// scripts/supabase-bootstrap-additional-pm.js (the local-stack counterpart) before ever
// running this against the real project.
//
// Usage:
//   SUPABASE_STAGING_CREDENTIALS_FILE=/path/to/supabase-staging-api-keys.json \
//     node scripts/supabase-staging-bootstrap-additional-pm.js <email> <password>

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_URL = 'https://ujnmlwbpginplfnofhhv.supabase.co';

function readServiceRoleKey() {
  const credFile = process.env.SUPABASE_STAGING_CREDENTIALS_FILE;
  if (!credFile) {
    throw new Error(
      'SUPABASE_STAGING_CREDENTIALS_FILE is not set. Point it at the JSON file produced by ' +
      '`supabase projects api-keys --project-ref ujnmlwbpginplfnofhhv --reveal -o json`, kept ' +
      'OUTSIDE this repository.'
    );
  }
  const keys = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  // This file has been observed in two real shapes in this project's own history: the
  // "legacy" shape ({ description: 'Legacy service_role API key', api_key }) and the newer
  // { name: 'service_role', api_key } shape — support both rather than assume one.
  const serviceRole = keys.find(function (k) {
    return k.name === 'service_role' || k.description === 'Legacy service_role API key';
  });
  if (!serviceRole) throw new Error('No service_role entry found in ' + credFile);
  return serviceRole.api_key;
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error('Usage: node scripts/supabase-staging-bootstrap-additional-pm.js <email> <password>');
    process.exit(1);
  }

  console.log('Bootstrapping an ADDITIONAL REAL PM account — project: Marketswave Staging (ujnmlwbpginplfnofhhv)');
  const serviceRoleKey = readServiceRoleKey();
  console.log('  Using service_role key from SUPABASE_STAGING_CREDENTIALS_FILE (path not echoed here).');
  console.log('');

  const admin = createClient(PROJECT_URL, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let user;
  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw new Error('listUsers() failed: ' + listErr.message);
  user = listData.users.find(function (u) { return u.email === email; });

  if (user) {
    console.log('Found existing account: ' + user.id + ' (' + email + ')');
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true
    });
    if (createErr) throw new Error('createUser() failed: ' + createErr.message);
    user = created.user;
    console.log('Created new account:    ' + user.id + ' (' + email + ')');
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
