#!/usr/bin/env node
// Supabase Migration — Stage 1 (Aug 30, 2026).
//
// Local-stack equivalent of scripts/bootstrap-admin.js (the Firebase emulator version) —
// same technique deliberately mirrored: create-or-reuse a single bootstrap PM account, then
// re-assert its admin marker every run so a partially-bootstrapped state (account exists,
// role row missing — e.g. from an interrupted prior run) self-heals rather than requiring a
// manual fix. Verifies the result live (re-fetches and checks) rather than trusting the
// write call succeeded silently, same discipline as the Firebase version.
//
// The one real mechanical difference from the Firebase version: Supabase's admin flag isn't
// set directly on the auth user the way `setCustomUserClaims()` writes straight onto the
// Firebase Auth account. It lives in `public.user_roles` (source of truth) and only reaches
// the JWT via the `custom_access_token_hook` Postgres function at the moment a token is
// issued — see supabase/migrations/20260830094238_create_clients_and_admin_roles.sql for
// the full "why" of that design. This script writes the source-of-truth row; it does NOT
// (and cannot, from here) directly verify the hook stamps the claim onto a real issued JWT —
// that's an end-to-end sign-in check, out of this script's own scope, and is instead covered
// by Stage 1's own separate RLS/admin-claim verification pass.
//
// LOCAL-STACK ONLY, DELIBERATELY. This script targets `supabase start`'s local Docker stack
// exclusively — it refuses to run against anything else (see the localhost/127.0.0.1 guard
// below). The local anon/service_role keys it uses are NOT a real secret: they are derived
// from `supabase/config.toml`'s well-known, publicly-documented default local JWT secret
// (`super-secret-jwt-token-with-at-least-32-characters-long`), identical across every
// unmodified local Supabase project on any machine — the same "this credential's real
// safety category is 'not actually a secret'" reasoning scripts/bootstrap-admin.js's own
// header already documents for its own emulator password. This is a DIFFERENT situation
// from the real cloud "Marketswave Staging" project, which needs its own separate,
// never-committed bootstrap credential — do not use this file as a template for that
// without a full re-read of scripts/staging-bootstrap-admin.js's own header first.
//
// Usage:  node scripts/supabase-bootstrap-admin.js
// Requires the local Supabase stack to already be running (`supabase start`).

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const ADMIN_EMAIL = 'pm@marketswave.local';
const ADMIN_PASSWORD = 'MarketswavePM-Local-2026!';

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

  // Refuse to run against anything that isn't the local stack, even if somehow reachable —
  // this script's whole safety model (hardcoded plaintext password, committed to the repo)
  // depends on this always being the local Docker stack, never a real cloud project.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(
      'Refusing to run: API_URL is not localhost/127.0.0.1 (got: ' + url + '). ' +
      'This script is local-stack-only — see its own header comment.'
    );
  }

  return { url, serviceRoleKey };
}

async function main() {
  console.log('Bootstrapping admin/PM account against the local Supabase stack...');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('  API URL: ' + url);
  console.log('');

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Find-or-create the bootstrap account. The Admin API's listUsers() is paginated but the
  // local dev stack will only ever have a handful of test users at a time in this project's
  // own workflow, so a single default-page lookup is enough — flagged here rather than
  // silently assumed to scale, since it's a real, if currently harmless, limitation.
  let user;
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw new Error('listUsers() failed: ' + listErr.message);
  user = listData.users.find(function (u) { return u.email === ADMIN_EMAIL; });

  if (user) {
    console.log('Found existing account: ' + user.id + ' (' + ADMIN_EMAIL + ')');
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true
    });
    if (createErr) throw new Error('createUser() failed: ' + createErr.message);
    user = created.user;
    console.log('Created new account:    ' + user.id + ' (' + ADMIN_EMAIL + ')');
  }

  // Upsert the admin marker — service_role bypasses RLS entirely, exactly like the Admin SDK
  // bypasses Firestore security rules, so this is the one legitimate direct writer to
  // user_roles outside the hook's own read-only access.
  const { error: upsertErr } = await supabase
    .from('user_roles')
    .upsert({ user_id: user.id, is_admin: true }, { onConflict: 'user_id' });
  if (upsertErr) throw new Error('user_roles upsert failed: ' + upsertErr.message);

  // Re-fetch rather than trust the upsert succeeded silently, same verified-live discipline
  // as scripts/bootstrap-admin.js's own re-fetch-and-check.
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
  console.log('Bootstrap complete. Signing in as ' + ADMIN_EMAIL + ' will now receive an');
  console.log('access token with app_metadata.is_admin === true, stamped by the');
  console.log('custom_access_token_hook Postgres function at token-issue time.');
}

main().catch(function (err) {
  console.error('');
  console.error('Bootstrap FAILED: ' + (err && err.message ? err.message : err));
  console.error('');
  console.error('Most likely cause: the local Supabase stack is not running yet.');
  console.error('Start it first with: supabase start');
  process.exit(1);
});
