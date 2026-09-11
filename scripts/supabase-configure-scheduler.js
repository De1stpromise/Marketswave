#!/usr/bin/env node
// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — configures THE SCHEDULER.
//
// This project had no scheduler of any kind before that task. The two cron jobs themselves
// are created by the migration (they are schema); what they need and a migration must never
// contain is a real credential — invoking an Edge Function needs the service_role key, and
// a committed migration is exactly the wrong place for it.
//
// So the migration's public.invoke_edge_function() reads two values out of supabase_vault,
// and this script is what puts them there:
//   edge_functions_base_url     — e.g. http://127.0.0.1:54321/functions/v1
//   scheduler_service_role_key  — the project's own service_role key
//
// Until this has run, invoke_edge_function() finds no secret and returns null with a
// notice. That is deliberate: a freshly reset stack has cron jobs that exist and quietly do
// nothing, rather than a scheduler that errors every 15 minutes.
//
// LOCAL (default) — reads the running stack's own credentials from `supabase status`, and
// refuses to run against anything that is not localhost:
//     node scripts/supabase-configure-scheduler.js
//
// REAL CLOUD STAGING — same credential discipline as every other staging script in this
// directory: the service_role key is never hardcoded and never referenced by a repo-
// relative path, only read from the JSON file the operator points SUPABASE_STAGING_
// CREDENTIALS_FILE at (the raw output of `supabase projects api-keys --reveal -o json`).
// The database password is needed too, because these are SQL statements rather than API
// calls — pass it via SUPABASE_STAGING_DB_URL (the full connection string from the real
// project's Database settings), which is likewise never stored here.
//     SUPABASE_STAGING_CREDENTIALS_FILE=... SUPABASE_STAGING_DB_URL=... \
//       node scripts/supabase-configure-scheduler.js --staging
//
// Idempotent in both modes: an existing secret of the same name is updated in place rather
// than duplicated, so re-running after a key rotation is the correct and only thing to do.

const fs = require('fs');
const { execSync } = require('child_process');
const { Client } = require('pg');

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
  // The CLI prints an update-nag banner above its JSON on some versions; the same
  // stripCliNagBanner problem verify-cloud-staging-parity.js already had to solve.
  const firstBrace = raw.indexOf('{');
  const status = JSON.parse(raw.slice(firstBrace));
  const apiUrl = status.API_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  const dbUrl = status.DB_URL;
  if (!apiUrl || !serviceRoleKey || !dbUrl) {
    throw new Error("'supabase status -o json' did not include API_URL/SERVICE_ROLE_KEY/DB_URL.");
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(apiUrl)) {
    throw new Error('Refusing to run: API_URL is not localhost/127.0.0.1 (got: ' + apiUrl + ').');
  }
  // ★ NOT apiUrl. pg_net runs INSIDE the Postgres container, so 127.0.0.1 there is that
  // container and not the host — a scheduled call aimed at the host's own API URL comes
  // back "Couldn't connect to server" every 15 minutes, with nothing user-facing to notice
  // it. Confirmed by watching real net._http_response rows fail that way before this was
  // changed. On the local stack the reachable address is Kong's own network alias; on a
  // real cloud project the public URL is correct, because there is no container boundary
  // to cross.
  return { baseUrl: 'http://kong:8000/functions/v1', serviceRoleKey, dbUrl };
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
  const dbUrl = process.env.SUPABASE_STAGING_DB_URL;
  if (!dbUrl) {
    throw new Error(
      'SUPABASE_STAGING_DB_URL is not set. These are SQL statements, not API calls, so this ' +
      "needs the real project's own connection string (Database settings > Connection string)."
    );
  }
  return {
    baseUrl: 'https://' + STAGING_PROJECT_REF + '.supabase.co/functions/v1',
    serviceRoleKey: entry.api_key,
    dbUrl
  };
}

// vault.create_secret() throws on a duplicate name, so "put this secret here" has to mean
// update-if-present. Expressed as one statement rather than a read followed by a write, so
// a concurrent run cannot land between the two.
//
// The values are passed as bound PARAMETERS, never interpolated into statement text — the
// service_role key must not end up in a shell command line (visible to any process listing)
// or in a query log.
async function upsertSecret(client, name, value, description) {
  // Two statements inside one transaction rather than a DO block: a plpgsql DO block cannot
  // take bind parameters at all (it is a statement, not a prepared statement), and the only
  // way to give it the values would be to interpolate them into the statement text — which
  // would put the real service_role key into query text and any statement log that captures
  // it. The transaction is what keeps the read and the write from being raced apart.
  await client.query('begin');
  try {
    const existing = await client.query('select id from vault.secrets where name = $1', [name]);
    if (existing.rows.length > 0) {
      await client.query('select vault.update_secret($1::uuid, $2, $3, $4)',
        [existing.rows[0].id, value, name, description]);
    } else {
      await client.query('select vault.create_secret($1, $2, $3)', [value, name, description]);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

async function main() {
  const target = STAGING ? readStaging() : readLocalStack();
  const label = STAGING ? 'REAL CLOUD STAGING (' + STAGING_PROJECT_REF + ')' : 'the local Docker stack';

  console.log('Configuring the Marketswave scheduler against ' + label);
  console.log('  Edge Functions base URL: ' + target.baseUrl);

  const client = new Client({ connectionString: target.dbUrl });
  await client.connect();
  try {
    await upsertSecret(client, 'edge_functions_base_url', target.baseUrl,
      'Base URL public.invoke_edge_function() posts scheduled runs to.');
    await upsertSecret(client, 'scheduler_service_role_key', target.serviceRoleKey,
      'service_role key used by pg_cron/pg_net to authorize scheduled Edge Function calls.');

    // Read back through the exact view invoke_edge_function() itself reads, so this confirms
    // what the scheduler will genuinely find rather than what was just written. The secret
    // VALUE is never printed — only its length, which is enough to tell "present" from
    // "truncated" without putting a real key on a terminal.
    const secrets = await client.query(
      "select name, length(decrypted_secret) as len from vault.decrypted_secrets " +
      "where name in ('edge_functions_base_url','scheduler_service_role_key') order by name"
    );
    console.log('\nvault.decrypted_secrets, as invoke_edge_function() will read them:');
    secrets.rows.forEach((r) => console.log('  ' + r.name + ' — present (' + r.len + ' chars)'));
    if (secrets.rows.length !== 2) {
      throw new Error('Expected both scheduler secrets to be readable, found ' + secrets.rows.length + '.');
    }

    const jobs = await client.query('select jobname, schedule, active from cron.job order by jobname');
    console.log('\ncron.job:');
    jobs.rows.forEach((r) => console.log('  ' + r.jobname + '  ' + r.schedule + '  active=' + r.active));
    if (jobs.rows.length === 0) {
      throw new Error('No cron jobs exist. Has the watchlist/scheduler migration been applied to this project?');
    }
  } finally {
    await client.end();
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
