// Cloud Staging Parity Check — the safeguard added 2026-09-05 closing the exact gap that
// caused a real live-site outage: "local stack only" was the correct, deliberate scope for
// every individual Phase B/UI-Wiring stage (10+ stages across Aug 30 - Sep 4, 2026), but
// nothing ever tracked WHEN real cloud staging needed to catch up with what had already been
// proven locally — the gap grew silently for ~10 days until a real user (robert greene) hit
// "Could not reach the server" on the real live hosted site, because every Phase B migration
// and 34 of 36 Edge Functions had only ever been applied to the local Docker stack.
//
// This script answers one question directly against the real remote project (never assumed
// from a memory of what "should" be there): does every migration file and every Edge Function
// directory that exists locally also exist, deployed, on real cloud staging? Run this:
//   - Before any push that touches supabase/migrations/, supabase/functions/, or any
//     Supabase-calling client-facing/admin page — the standing rule from CLAUDE.md's new
//     "Cloud Staging Parity" section.
//   - Any time you're unsure whether a Phase/Stage's own "local stack only" scope note is
//     still an accurate description of the live site's actual state.
//
// Exit code 0 = real remote is fully caught up. Exit code 1 = a real, live gap exists —
// do NOT assume the live site works until this passes, per the incident this closes.
//
// Requires: `supabase` CLI logged in and linked to the real project (same discipline as
// every other real-cloud-staging script in this project — confirms the linked project
// matches supabase-config.js's own hardcoded STAGING_CONFIG.url before trusting anything).
//
// A REAL, DISCLOSED LIMITATION (found 2026-09-06, Backend Migration Phase C — Stage 1):
// the Edge Functions check only confirms a function SLUG exists and is ACTIVE on the real
// remote — it does NOT diff the deployed function's actual CODE against the local source.
// Editing an already-deployed function (e.g. adding a new field to its write, exactly what
// Phase C — Stage 1 did to 22 already-deployed functions) leaves this check reporting
// "37/37 deployed" even while the real remote is running STALE code, since the slug never
// changed. This script therefore only catches a NEWLY ADDED, never-deployed function or
// migration — not a MODIFIED one going stale. Redeploying an edited function (`supabase
// functions deploy <name>`) is still the operator's own responsibility to remember; this
// gap is reported rather than silently left implied-covered. A future improvement worth
// tracking: hash-compare deployed bundle content (functions list's own response includes no
// content hash reliably comparable to local source today) or track a "last deployed" marker
// per function file.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const FUNCTIONS_DIR = path.join(REPO_ROOT, 'supabase', 'functions');
const EXPECTED_STAGING_URL = 'https://ujnmlwbpginplfnofhhv.supabase.co';

function run(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
}

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exitCode = 1;
}

console.log('=== Cloud Staging Parity Check ===\n');

// ---- 0. Confirm we're actually targeting the right real project ----
const supabaseConfigSrc = fs.readFileSync(path.join(REPO_ROOT, 'supabase-config.js'), 'utf8');
const stagingBlockMatch = supabaseConfigSrc.match(/const STAGING_CONFIG = \{[\s\S]*?\};/);
const urlMatch = stagingBlockMatch && stagingBlockMatch[0].match(/url:\s*'([^']+)'/);
if (!urlMatch || urlMatch[1] !== EXPECTED_STAGING_URL) {
  fail(`supabase-config.js's STAGING_CONFIG.url does not match the expected real project URL (${EXPECTED_STAGING_URL}) — refusing to check parity against a possibly-wrong project. Found: ${urlMatch && urlMatch[1]}`);
  process.exit(1);
}
let linkedRef;
try {
  linkedRef = run('supabase projects list -o json');
} catch (e) {
  fail('Could not run `supabase projects list` — is the CLI installed and logged in? ' + e.message);
  process.exit(1);
}
const projects = JSON.parse(linkedRef).projects || JSON.parse(linkedRef);
const linked = (Array.isArray(projects) ? projects : projects.projects).find(p => p.linked);
if (!linked || !EXPECTED_STAGING_URL.includes(linked.ref)) {
  fail(`The linked Supabase project (${linked && linked.ref}) does not match the expected real staging project ref embedded in ${EXPECTED_STAGING_URL}.`);
  process.exit(1);
}
console.log(`Confirmed: linked project "${linked.name}" (${linked.ref}) matches the app's own real staging config.\n`);

// ---- 1. Migrations: every local file must show up on the remote side ----
const localMigrations = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .map(f => f.split('_')[0])
  .sort();

// `supabase migration list` has been observed emitting EITHER real JSON (a trailing
// {"migrations":[...]} line) or a markdown table (`` `local` | `remote` | `time` ``)
// depending on this CLI's own terminal/TTY detection — not consistent run to run in this
// environment. Both are parsed rather than assuming one; re-check this if a future CLI
// upgrade changes both formats at once.
let migrationListRaw;
try {
  migrationListRaw = run('supabase migration list 2>&1');
} catch (e) {
  migrationListRaw = e.stdout ? e.stdout.toString() : '';
}

let rows = [];
const jsonStartIdx = migrationListRaw.indexOf('{"migrations":');
if (jsonStartIdx !== -1) {
  const candidate = migrationListRaw.slice(jsonStartIdx).trim();
  const parsed = JSON.parse(candidate);
  rows = parsed.migrations.map(m => ({ local: m.local, remote: m.remote }));
} else {
  rows = migrationListRaw
    .split('\n')
    .filter(line => line.trim().startsWith('`'))
    .map(line => {
      const cells = line.split('|').map(c => c.trim().replace(/^`|`$/g, ''));
      return { local: cells[0], remote: cells[1] };
    })
    .filter(r => /^\d{14}$/.test(r.local));
}

if (rows.length === 0) {
  fail('Could not parse `supabase migration list` output — CLI output format may have changed:\n' + migrationListRaw);
  process.exit(1);
}

const missingRemote = rows.filter(m => !m.remote);
console.log(`Local migrations: ${localMigrations.length}`);
console.log(`Applied to real remote: ${rows.length - missingRemote.length} / ${rows.length}`);
if (missingRemote.length > 0) {
  fail(`${missingRemote.length} migration(s) exist locally but have NEVER been applied to real cloud staging:`);
  missingRemote.forEach(m => console.error('  - ' + m.local));
} else {
  console.log('All local migrations are applied to real cloud staging.\n');
}

// ---- 2. Edge Functions: every local function directory must be ACTIVE on the remote ----
const localFunctions = fs.readdirSync(FUNCTIONS_DIR)
  .filter(f => f !== '_shared' && fs.statSync(path.join(FUNCTIONS_DIR, f)).isDirectory())
  .sort();

let remoteFunctionsRaw;
try {
  remoteFunctionsRaw = run('supabase functions list -o json');
} catch (e) {
  fail('Could not run `supabase functions list`: ' + e.message);
  process.exit(1);
}
const remoteFunctions = JSON.parse(remoteFunctionsRaw);
const remoteSlugs = new Set((remoteFunctions.functions || remoteFunctions).map(f => f.slug).filter(Boolean));
if (remoteFunctions.functions === undefined && Array.isArray(remoteFunctions)) {
  remoteFunctions.forEach(f => remoteSlugs.add(f.slug));
}

const missingFunctions = localFunctions.filter(f => !remoteSlugs.has(f));
console.log(`Local Edge Functions: ${localFunctions.length}`);
console.log(`Deployed (ACTIVE) on real remote: ${localFunctions.length - missingFunctions.length} / ${localFunctions.length}`);
if (missingFunctions.length > 0) {
  fail(`${missingFunctions.length} Edge Function(s) exist locally but are NOT deployed to real cloud staging:`);
  missingFunctions.forEach(f => console.error('  - ' + f));
} else {
  console.log('All local Edge Functions are deployed to real cloud staging.\n');
}

console.log('=== ' + (process.exitCode === 1 ? 'PARITY GAP FOUND — see FAIL lines above' : 'PARITY OK — real cloud staging matches local') + ' ===');
// Explicit exit (2026-09-07, project-wide hang-fix audit) — this script itself never
// establishes a real Supabase Auth session (only shells out to the `supabase` CLI), so it
// isn't actually at risk of the lingering-autoRefreshToken-timer hang other verify scripts
// were found to have; added anyway for consistency and defense-in-depth, matching the new
// project-wide convention (see CLAUDE.md's Working Conventions). process.exitCode is
// preserved, not overridden.
process.exit(process.exitCode || 0);
