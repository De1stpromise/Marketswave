#!/usr/bin/env node
// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — configures THE SCHEDULER.
//
// This project had no scheduler of any kind before that task. The two cron jobs themselves
// are created by the migration (they are schema); what they need, and what a committed
// migration must never carry, is a real credential — invoking an Edge Function needs the
// service_role key.
//
// So `public.invoke_edge_function()` reads two values out of supabase_vault, and this script
// is what puts them there:
//   edge_functions_base_url     — where scheduled runs are POSTed
//   scheduler_service_role_key  — the project's own service_role key
//
// Until this has run, invoke_edge_function() finds no secret and returns null with a notice.
// That is deliberate: a freshly reset stack has cron jobs that exist and quietly do nothing,
// rather than a scheduler that errors every 15 minutes.
//
// The write goes through public.set_scheduler_config(), a service_role-only RPC, rather than
// a direct Postgres connection. That is what keeps the real cloud path simple: the operator
// needs only the API key they already keep, never the database password.
//
// LOCAL (default) — reads the running stack's own credentials from `supabase status`, and
// refuses to run against anything that is not localhost:
//     node scripts/supabase-configure-scheduler.js
//
// REAL CLOUD STAGING — same credential discipline as every other staging script here: the
// service_role key is never hardcoded and never referenced by a repo-relative path, only
// read from the JSON file the operator points SUPABASE_STAGING_CREDENTIALS_FILE at (the raw
// output of `supabase projects api-keys --reveal -o json`):
//     SUPABASE_STAGING_CREDENTIALS_FILE=... node scripts/supabase-configure-scheduler.js --staging
//
// Idempotent in both modes: an existing secret of the same name is updated in place, so
// re-running after a key rotation — or after any `supabase db reset`, which wipes the vault
// along with everything else — is the correct and only thing to do.

const fs = require('fs');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const STAGING = process.argv.indexOf('--staging') !== -1;
const STAGING_PROJECT_REF = 'ujnmlwbpginplfnofhhv';

function readLocalStack() {
  let raw;
  try {
    raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  } catch (err) {
    throw new Error(
      "Could not read local stack status via 'supabase status'. Is the local stack running " +
      '(`supabase start`)?\n' + (err.stdout || err.message)
    );
  }
  // The CLI prints an update-nag banner above its JSON on some versions — the same problem
  // verify-cloud-staging-parity.js already had to strip.
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  const apiUrl = status.API_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  if (!apiUrl || !serviceRoleKey) {
    throw new Error("'supabase status -o json' did not include API_URL/SERVICE_ROLE_KEY.");
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(apiUrl)) {
    throw new Error('Refusing to run: API_URL is not localhost/127.0.0.1 (got: ' + apiUrl + ').');
  }
  // Deliberately NOT apiUrl. pg_net runs INSIDE the Postgres container, so 127.0.0.1 there
  // is that container and not the host — a scheduled call aimed at the host's own API URL
  // comes back "Couldn't connect to server" every 15 minutes, with nothing user-facing to
  // notice it. Confirmed by watching real net._http_response rows fail exactly that way
  // before this was changed. On the local stack the reachable address is Kong's own network
  // alias; on a real cloud project the public URL is correct, because there is no container
  // boundary to cross.
  return { apiUrl, baseUrl: 'http://kong:8000/functions/v1', serviceRoleKey };
}

function readStaging() {
  const credFile = process.env.SUPABASE_STAGING_CREDENTIALS_FILE;
  if (!credFile) {
    throw new Error(
      'SUPABASE_STAGING_CREDENTIALS_FILE is not set. Point it at the JSON file produced by ' +
      '`supabase projects api-keys --project-ref ' + STAGING_PROJECT_REF + ' --reveal -o json`, ' +
      'kept OUTSIDE this repository.'
    );
  }
  const keys = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  const entry = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'service_role');
  if (!entry || !entry.api_key) {
    throw new Error('No service_role entry found in ' + credFile + '.');
  }
  const apiUrl = 'https://' + STAGING_PROJECT_REF + '.supabase.co';
  return { apiUrl, baseUrl: apiUrl + '/functions/v1', serviceRoleKey: entry.api_key };
}

async function main() {
  const target = STAGING ? readStaging() : readLocalStack();
  const label = STAGING ? 'REAL CLOUD STAGING (' + STAGING_PROJECT_REF + ')' : 'the local Docker stack';

  console.log('Configuring the Marketswave scheduler against ' + label);
  console.log('  Edge Functions base URL: ' + target.baseUrl);

  const admin = createClient(target.apiUrl, target.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data, error } = await admin.rpc('set_scheduler_config', {
    base_url: target.baseUrl,
    service_key: target.serviceRoleKey
  });
  if (error) {
    throw new Error(
      'set_scheduler_config failed: ' + error.message +
      '\nHas the watchlist/scheduler migration been applied to this project?'
    );
  }

  // Reported back from the exact view invoke_edge_function() itself reads. Lengths only —
  // a real service_role key must not end up on a terminal or in a shell history.
  console.log('\nvault.decrypted_secrets, as invoke_edge_function() will read them:');
  (data.secrets || []).forEach((s) => console.log('  ' + s.name + ' — present (' + s.length + ' chars)'));
  if ((data.secrets || []).length !== 2) {
    throw new Error('Expected both scheduler secrets to be readable, found ' + (data.secrets || []).length + '.');
  }

  console.log('\ncron.job:');
  (data.jobs || []).forEach((j) => console.log('  ' + j.jobname + '  ' + j.schedule + '  active=' + j.active));
  if ((data.jobs || []).length === 0) {
    throw new Error('No cron jobs exist. Has the watchlist/scheduler migration been applied to this project?');
  }

  console.log('\nDone. The next quarter hour will run refresh-market-data, and two minutes later check-price-alerts.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nFAILED: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
);
