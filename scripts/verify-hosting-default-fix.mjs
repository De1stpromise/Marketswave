#!/usr/bin/env node
// Pre-hosting fix (2026-09-04): confirms the real DEFAULT backend target for a real public
// deployment. Closes a real, disclosed bug — the prior default (Aug 30, 2026 Firebase
// Retirement inversion) made "(no query params)" mean "the LOCAL Docker stack" everywhere,
// including a real hosted domain a real visitor's browser would load with zero query
// params — meaning every real signup/login on a real hosted deployment would have silently
// tried to reach `http://127.0.0.1:54321`, unreachable from anywhere but the developer's own
// machine, and failed outright.
//
// This script does NOT need the local Supabase stack running at all — it verifies which
// backend target gets SELECTED based on the page's own simulated hostname/query string, not
// real network calls against either target.
//
// ---- Fresh module instances per scenario, per this project's own established technique
// (verify-cross-role-sync-bugfix.mjs's own header explains the full "why": Node's ESM module
// cache is keyed by resolved file path, so re-importing the SAME real source under a
// DIFFERENT simulated window.location requires a distinct temp file per scenario, not a
// second import() of the original path, which would just return the first cached
// evaluation). Both real, unmodified source files are written out per scenario; deleted in a
// `finally` block regardless of outcome.
//
// Usage:  node verify-hosting-default-fix.mjs   (no --experimental-loader needed — this
// script never imports the real @supabase/supabase-js CDN specifier itself; it only checks
// which LOCAL_CONFIG/STAGING_CONFIG each real config file would have selected, and — via a
// real createClient() call reading back client.supabaseUrl — confirms the selected URL is
// genuinely wired into the constructed client, not just a correctly-computed unused variable.
// createClient() is imported directly from the installed local npm package, no CDN
// redirection needed for that part.)

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

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

const PROJECT_ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const REAL_SUPABASE_CONFIG_SRC = readFileSync(PROJECT_ROOT_DIR + 'supabase-config.js', 'utf8');
const REAL_ADMIN_SUPABASE_CONFIG_SRC = readFileSync(PROJECT_ROOT_DIR + 'admin-supabase-config.js', 'utf8');

const LOCAL_URL = 'http://127.0.0.1:54321';
const STAGING_URL = 'https://ujnmlwbpginplfnofhhv.supabase.co';

const tempFiles = [];
let scenarioCounter = 0;

// Real createClient() calls made by the imported config files themselves would use the
// esm.sh CDN specifier, which this script deliberately does NOT redirect (no
// --experimental-loader) — so instead of importing the real files with their own
// createClient() call intact (which would throw, unable to resolve a bare CDN URL under
// plain Node import resolution), each temp copy has ITS OWN createClient import line
// substituted for the real local package, the ONE deliberate line-level change made to an
// otherwise byte-for-byte copy of the real source — confirmed by diffing before/after that
// this is the only substitution, mirroring the exact, already-established
// esm-loader-supabase-cdn.mjs technique's OWN goal (real file, real logic, only the network
// fetch swapped) via a simpler mechanism appropriate for a script that doesn't need the
// loader for anything else.
function localizeCdnImport(source) {
  const needle = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';";
  if (source.indexOf(needle) === -1) {
    throw new Error('Expected CDN import line not found — the real source may have changed shape; update this script.');
  }
  return source.replace(needle, "import { createClient } from '@supabase/supabase-js';");
}

// Temp copies are written into scripts/ (not the project root) specifically so the
// substituted '@supabase/supabase-js' bare specifier resolves against scripts/node_modules —
// Node's module resolution walks UP from the importing file's own directory looking for
// node_modules, never into a child directory, and the project root has no node_modules of
// its own. That placement is load-bearing and must not be "fixed" by moving these files to
// the root; doing so re-breaks the bare specifier this placement exists to satisfy.
//
// The cost of that placement is that any PROJECT-ROOT-RELATIVE import inside the copied
// source no longer resolves, because the copy now lives a directory deeper. When this script
// was written (2026-09-07) neither real source had such an import, and its original comment
// said so. Commit 15eaa27 the following day extracted supabase-endpoint.js to the project
// root and pointed supabase-config.js at it, silently invalidating that assumption and
// leaving this script failing with "Cannot find module 'supabase-endpoint.js'" — unnoticed
// because nothing re-ran it.
//
// Rather than relocate, the fix is the same temp-copy approach verify-cross-role-sync-
// bugfix.mjs already uses for supabase-data.js: co-locate the dependency next to the copy
// that needs it and repoint the import at it. supabase-endpoint.js is self-contained (no
// imports of its own, confirmed by reading it), so a byte-for-byte copy is sufficient and
// there is no transitive case to handle. localizeRelativeImports() is deliberately strict —
// if supabase-config.js ever gains ANOTHER root-relative import, it throws with the offending
// specifier named instead of failing later with an opaque resolution error.
// ★ The endpoint copy is PER-SCENARIO, not shared, and that is the whole point rather than an
// implementation detail. supabase-endpoint.js reads window.location.hostname/.search at module
// TOP LEVEL and freezes WANTS_SUPABASE_STAGING/ACTIVE_CONFIG at import time. A single shared
// copy is imported once and cached, so every scenario after the first would silently reuse the
// FIRST scenario's environment resolution — which is exactly the module-caching hazard this
// script already avoids for the config itself by writing a new temp file per scenario. A
// shared copy here made 7 assertions fail with the local scenarios reporting the staging URL.
const REAL_SUPABASE_ENDPOINT_SRC = readFileSync(PROJECT_ROOT_DIR + 'supabase-endpoint.js', 'utf8');

function writeEndpointCopy(n) {
  const basename = '.tmp-hosting-endpoint-' + n + '-' + process.pid + '.mjs';
  writeFileSync(SCRIPTS_DIR + basename, REAL_SUPABASE_ENDPOINT_SRC, 'utf8');
  tempFiles.push(SCRIPTS_DIR + basename);
  return basename;
}

function localizeRelativeImports(source, endpointBasename) {
  const out = source.replace(/(['"])\.\/supabase-endpoint\.js\1/g, "'./" + endpointBasename + "'");
  // Any OTHER project-root-relative specifier is a shape change this script has not been
  // taught about — fail loudly and name it, rather than let it become the next silent break.
  const leftover = out.match(/from\s+['"]\.\/(?!\.tmp-hosting-)[^'"]+['"]/g);
  if (leftover) {
    throw new Error('Unhandled project-root-relative import in copied source: ' + leftover.join(', ') +
      ' — add it to localizeRelativeImports() (co-locate a temp copy), do not move the temp file to the root.');
  }
  return out;
}

async function importScenario(realSource, hostname, search) {
  scenarioCounter++;
  const endpointBasename = writeEndpointCopy(scenarioCounter);
  const tempPath = SCRIPTS_DIR + '.tmp-hosting-check-' + scenarioCounter + '-' + process.pid + '.mjs';
  writeFileSync(tempPath, localizeRelativeImports(localizeCdnImport(realSource), endpointBasename), 'utf8');
  tempFiles.push(tempPath);
  const fakeWindow = { location: { hostname: hostname, search: search } };
  const priorWindow = globalThis.window;
  globalThis.window = fakeWindow;
  const mod = await import('./.tmp-hosting-check-' + scenarioCounter + '-' + process.pid + '.mjs');
  globalThis.window = priorWindow;
  return mod;
}

async function main() {
  console.log('Pre-hosting fix verification — real backend-target default, hostname-based, no local stack needed\n');

  try {

  // ===========================================================================================
  // PART 1 — supabase-config.js (client-facing: signup.html / login.html)
  // ===========================================================================================
  console.log('=== PART 1: supabase-config.js (client-facing) ===\n');

  console.log('1. THE ACTUAL FIX: a real hosted domain, zero query params — must reach REAL CLOUD STAGING');
  await (async function () {
    const mod = await importScenario(REAL_SUPABASE_CONFIG_SRC, 'marketswave-app.example.com', '');
    check('IS_SUPABASE_BACKEND is true (no legacyBackend requested)', mod.IS_SUPABASE_BACKEND === true);
    check('WANTS_SUPABASE_STAGING is genuinely TRUE for a real hosted domain with zero query params — THIS is the fix', mod.WANTS_SUPABASE_STAGING === true);
    check('the real constructed Supabase client is genuinely wired to the REAL STAGING URL, not just a correctly-computed unused variable', mod.supabase.supabaseUrl === STAGING_URL, mod.supabase.supabaseUrl);
  })();

  console.log('\n2. Local development (127.0.0.1) — zero query params — must stay on the LOCAL stack, unaffected by the fix');
  await (async function () {
    const mod = await importScenario(REAL_SUPABASE_CONFIG_SRC, '127.0.0.1', '');
    check('WANTS_SUPABASE_STAGING is genuinely FALSE on 127.0.0.1 with zero query params', mod.WANTS_SUPABASE_STAGING === false);
    check('the real constructed client is genuinely wired to the LOCAL stack URL', mod.supabase.supabaseUrl === LOCAL_URL, mod.supabase.supabaseUrl);
  })();

  console.log('\n3. Local development (localhost) — zero query params — same real local behavior via the other real hostname alias');
  await (async function () {
    const mod = await importScenario(REAL_SUPABASE_CONFIG_SRC, 'localhost', '');
    check('WANTS_SUPABASE_STAGING is genuinely FALSE on localhost with zero query params', mod.WANTS_SUPABASE_STAGING === false);
    check('the real constructed client is genuinely wired to the LOCAL stack URL', mod.supabase.supabaseUrl === LOCAL_URL, mod.supabase.supabaseUrl);
  })();

  console.log('\n4. Explicit override: ?env=staging still reaches real staging even FROM localhost (an existing, relied-upon local-dev workflow, must survive this fix)');
  await (async function () {
    const mod = await importScenario(REAL_SUPABASE_CONFIG_SRC, '127.0.0.1', '?env=staging');
    check('WANTS_SUPABASE_STAGING is TRUE on 127.0.0.1 with ?env=staging (explicit override)', mod.WANTS_SUPABASE_STAGING === true);
    check('the real constructed client is genuinely wired to the REAL STAGING URL', mod.supabase.supabaseUrl === STAGING_URL, mod.supabase.supabaseUrl);
  })();

  console.log('\n5. New explicit opt-in: ?dev=local reaches the LOCAL stack even from a real hosted domain');
  await (async function () {
    const mod = await importScenario(REAL_SUPABASE_CONFIG_SRC, 'marketswave-app.example.com', '?dev=local');
    check('WANTS_SUPABASE_STAGING is FALSE on a real hosted domain with ?dev=local (explicit opt-in override)', mod.WANTS_SUPABASE_STAGING === false);
    check('the real constructed client is genuinely wired to the LOCAL stack URL', mod.supabase.supabaseUrl === LOCAL_URL, mod.supabase.supabaseUrl);
  })();

  console.log('\n6. Priority when both explicit overrides are somehow present: ?env=staging wins over ?dev=local');
  await (async function () {
    const mod = await importScenario(REAL_SUPABASE_CONFIG_SRC, 'marketswave-app.example.com', '?dev=local&env=staging');
    check('WANTS_SUPABASE_STAGING is TRUE — env=staging is the stronger explicit signal', mod.WANTS_SUPABASE_STAGING === true);
  })();

  console.log('\n7. The Firebase legacy escape hatch (?legacyBackend=firebase) is completely unaffected by this fix — sanity check, not this fix\'s own scope');
  await (async function () {
    const mod = await importScenario(REAL_SUPABASE_CONFIG_SRC, 'marketswave-app.example.com', '?legacyBackend=firebase');
    check('IS_SUPABASE_BACKEND is genuinely FALSE when legacyBackend=firebase is present, on any hostname', mod.IS_SUPABASE_BACKEND === false);
  })();

  // ===========================================================================================
  // PART 2 — admin-supabase-config.js (admin-facing)
  // ===========================================================================================
  console.log('\n=== PART 2: admin-supabase-config.js (admin-facing) — checked independently, per instruction ===\n');

  console.log('8. THE ACTUAL FIX, admin side: a real hosted domain, zero query params — must reach REAL CLOUD STAGING');
  await (async function () {
    const mod = await importScenario(REAL_ADMIN_SUPABASE_CONFIG_SRC, 'marketswave-app.example.com', '');
    check('the real constructed ADMIN client is genuinely wired to the REAL STAGING URL for a real hosted domain with zero query params', mod.supabase.supabaseUrl === STAGING_URL, mod.supabase.supabaseUrl);
  })();

  console.log('\n9. Local development (127.0.0.1 / localhost), admin side — zero query params — stays on the LOCAL stack');
  await (async function () {
    const modA = await importScenario(REAL_ADMIN_SUPABASE_CONFIG_SRC, '127.0.0.1', '');
    check('the real constructed ADMIN client is genuinely wired to the LOCAL stack URL on 127.0.0.1', modA.supabase.supabaseUrl === LOCAL_URL, modA.supabase.supabaseUrl);
    const modB = await importScenario(REAL_ADMIN_SUPABASE_CONFIG_SRC, 'localhost', '');
    check('the real constructed ADMIN client is genuinely wired to the LOCAL stack URL on localhost', modB.supabase.supabaseUrl === LOCAL_URL, modB.supabase.supabaseUrl);
  })();

  console.log('\n10. Explicit overrides, admin side — both directions, mirroring the client-facing behavior exactly');
  await (async function () {
    const modStaging = await importScenario(REAL_ADMIN_SUPABASE_CONFIG_SRC, '127.0.0.1', '?env=staging');
    check('?env=staging reaches real staging even from 127.0.0.1 (admin side)', modStaging.supabase.supabaseUrl === STAGING_URL, modStaging.supabase.supabaseUrl);
    const modLocal = await importScenario(REAL_ADMIN_SUPABASE_CONFIG_SRC, 'marketswave-app.example.com', '?dev=local');
    check('?dev=local reaches the local stack even from a real hosted domain (admin side)', modLocal.supabase.supabaseUrl === LOCAL_URL, modLocal.supabase.supabaseUrl);
  })();

  } finally {
    tempFiles.forEach(function (f) { try { unlinkSync(f); } catch (e) { /* already gone */ } });
  }

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
