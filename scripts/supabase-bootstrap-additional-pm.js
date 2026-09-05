#!/usr/bin/env node
// Backend Migration Phase C — Stage 1 (2026-09-06).
//
// Creates an ADDITIONAL real PM account against the LOCAL Supabase stack, alongside (never
// replacing) the single bootstrap account scripts/supabase-bootstrap-admin.js creates.
// user_roles was already schema-capable of multiple distinct admin identities from day one
// (Supabase Migration Stage 1) — `user_id primary key` means a second row for a different
// real user immediately grants that person admin, with zero migration needed to support it.
// This script is the "a script is fine, consistent with how the very first admin account was
// bootstrapped" tool the task asked for — no dedicated UI exists to create a PM, by design,
// same as the very first one never had one either.
//
// Deliberately a SEPARATE file from supabase-bootstrap-admin.js rather than a modification of
// it — that script's own hardcoded pm@marketswave.local identity is referenced by name across
// this project's own README/CLAUDE.md history as "the bootstrap account"; parameterizing it
// in place would silently change what running it with no arguments does. This script is
// purely additive.
//
// LOCAL-STACK ONLY, DELIBERATELY — same guard, same reasoning, as every other local-stack
// script in this project (the local anon/service_role keys are not a real secret; a real
// cloud project needs its own separate, never-committed credential, see the counterpart
// scripts/supabase-staging-bootstrap-additional-pm.js instead).
//
// Usage:
//   node scripts/supabase-bootstrap-additional-pm.js <email> <password>
// Requires the local Supabase stack to already be running (`supabase start`).

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

function readLocalStackCredentials() {
  let raw;
  try {
    raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  } catch (err) {
    throw new Error(
      "Could not read local stack status via 'supabase status'. Is the local stack running?" +
      ' Start it with: supabase start\n\nUnderlying error: ' + (err.message || err)
    );
  }

  let status;
  try {
    status = JSON.parse(raw);
  } catch (err) {
    throw new Error("Could not parse 'supabase status -o json' output as JSON:\n" + raw);
  }

  const url = status.API_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "'supabase status -o json' did not include API_URL/SERVICE_ROLE_KEY — got: " + raw
    );
  }

  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(
      'Refusing to run: API_URL is not localhost/127.0.0.1 (got: ' + url + '). ' +
      'This script is local-stack-only — see its own header comment.'
    );
  }

  return { url, serviceRoleKey };
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error('Usage: node scripts/supabase-bootstrap-additional-pm.js <email> <password>');
    process.exit(1);
  }

  console.log('Bootstrapping an ADDITIONAL admin/PM account against the local Supabase stack...');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('  API URL: ' + url);
  console.log('');

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let user;
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw new Error('listUsers() failed: ' + listErr.message);
  user = listData.users.find(function (u) { return u.email === email; });

  if (user) {
    console.log('Found existing account: ' + user.id + ' (' + email + ')');
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true
    });
    if (createErr) throw new Error('createUser() failed: ' + createErr.message);
    user = created.user;
    console.log('Created new account:    ' + user.id + ' (' + email + ')');
  }

  const { error: upsertErr } = await supabase
    .from('user_roles')
    .upsert({ user_id: user.id, is_admin: true }, { onConflict: 'user_id' });
  if (upsertErr) throw new Error('user_roles upsert failed: ' + upsertErr.message);

  const { data: confirmed, error: confirmErr } = await supabase
    .from('user_roles')
    .select('user_id, is_admin')
    .eq('user_id', user.id)
    .single();
  if (confirmErr) throw new Error('Post-upsert verification read failed: ' + confirmErr.message);
  if (!confirmed || confirmed.is_admin !== true) {
    throw new Error('Admin role did not take effect — got: ' + JSON.stringify(confirmed));
  }

  console.log('user_roles row confirmed live: { user_id: ' + user.id + ', is_admin: true }');
  console.log('');
  console.log('Bootstrap complete. This is a genuinely SEPARATE PM identity from any other');
  console.log('admin account on this stack — signing in as ' + email + ' will receive its');
  console.log('own real, distinct app_metadata.is_admin === true token.');
}

main().catch(function (err) {
  console.error('');
  console.error('Bootstrap FAILED: ' + (err && err.message ? err.message : err));
  console.error('');
  console.error('Most likely cause: the local Supabase stack is not running yet.');
  console.error('Start it first with: supabase start');
  process.exit(1);
});
