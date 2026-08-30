#!/usr/bin/env node
// Supabase Migration — Stage 2 (Aug 30, 2026).
//
// EXPLICITLY A TEMPORARY STAND-IN, not a permanent solution — same category as
// scripts/staging-approve-client.js on the Firebase side. Flips a specified local-stack
// client's `clients` row status from 'pending_review' to 'active' directly via service_role
// (bypasses RLS entirely, the same way the Admin SDK bypasses Firestore security rules) —
// standing in for a real Edge Function equivalent of Stage 1's `approveClientApplication`,
// which does not exist yet (Stage 3+ work, alongside a real admin UI button). There is no
// admin UI wired to this on the local stack — running this script BY HAND (or via
// golden-path-regression.js, which calls the same underlying logic directly) is the entire
// "approval flow" for now.
//
// Mirrors functions/index.js's approveClientApplication(clientId) rule exactly: only resolves
// a row that is currently 'pending_review' (throws a clear error otherwise — never silently
// overwrites an already-resolved application), sets status = 'active' and
// application_resolved_at = now(). Does not offer a --reject mode, same reasoning as the
// Firebase version's own header — not built pre-emptively.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and same localhost-only guard as scripts/supabase-bootstrap-admin.js.
//
// Usage:  node scripts/supabase-approve-client.js <uid>
// <uid> is the Supabase Auth user id (== the clients.id) of the applicant to approve — find
// it via Studio (http://127.0.0.1:54323), or from signup's own result, not guessed.

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function main() {
  const clientId = process.argv[2];
  if (!clientId) {
    throw new Error('Usage: node scripts/supabase-approve-client.js <uid>');
  }

  console.log('TEMPORARY STAND-IN for a real admin approve action (no Edge Function/admin UI yet).');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('Approving LOCAL Supabase client: ' + clientId + ' (' + url + ')');
  console.log('');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: existing, error: fetchErr } = await admin.from('clients').select('*').eq('id', clientId).single();
  if (fetchErr || !existing) {
    throw new Error('Unknown client: ' + clientId + ' (no clients row exists) — ' + (fetchErr && fetchErr.message));
  }
  if (existing.status !== 'pending_review') {
    throw new Error('Client ' + clientId + ' is not pending review (status: ' + existing.status + ').');
  }

  const { error: updateErr } = await admin
    .from('clients')
    .update({ status: 'active', application_resolved_at: new Date().toISOString() })
    .eq('id', clientId);
  if (updateErr) throw new Error('Update failed: ' + updateErr.message);

  const { data: confirmed } = await admin.from('clients').select('*').eq('id', clientId).single();
  console.log('Approved. ' + (existing.name || clientId) + ' (' + existing.email + ') is now status: ' + confirmed.status);
  console.log('Verify in Studio: http://127.0.0.1:54323/project/default/editor');
}

main().catch(function (err) {
  console.error('');
  console.error('Local approval FAILED: ' + (err && err.message ? err.message : err));
  console.error('Most likely cause: the local Supabase stack is not running yet. Start it with: supabase start');
  process.exit(1);
});
