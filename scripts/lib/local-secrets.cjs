// local-secrets.cjs — test-time secrets for the verification suites, from OUTSIDE supabase/functions.
//
// Register row 255 (finished 2026-10-01): suites used to read supabase/functions/.env directly,
// and any host-side read under that directory restarts the local edge runtime (see
// function-source.cjs). Secrets now resolve in this order:
//   1. the environment (process.env[key])
//   2. the file named by MW_LOCAL_SECRETS_FILE, else ../marketswave-secrets/local-test.env —
//      a sibling of the repository, so it can never be committed (the repo is public, row 256).
// NEVER supabase/functions/.env. The runtime guard (no-functions-read.cjs) fails a suite that
// tries.
//
// Keys the suites need today: GARY_SEED_EMAIL, GARY_SEED_PASSWORD, RESEND_WEBHOOK_SECRET.
// RESEND_WEBHOOK_SECRET also stays in supabase/functions/.env, because the local
// receive-inbound-email function reads it there; the two copies must match, and the suite that
// uses it fails with a forged-signature mismatch if they ever drift — loud, not silent.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_FILE = path.resolve(REPO_ROOT, '..', 'marketswave-secrets', 'local-test.env');

function secretsFile() { return process.env.MW_LOCAL_SECRETS_FILE || DEFAULT_FILE; }

let cache = null;
function fileValues() {
  if (cache) return cache;
  cache = {};
  const f = secretsFile();
  if (!fs.existsSync(f)) return cache;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) cache[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return cache;
}

/** The secret, or null when it is set nowhere. */
function readLocalSecret(key) {
  if (process.env[key]) return process.env[key];
  const v = fileValues()[key];
  return v ? v : null;
}

/** The secret, or a thrown error naming where to put it. */
function requireLocalSecret(key) {
  const v = readLocalSecret(key);
  if (!v) throw new Error(key + ' is not set — export it, or add it to ' + secretsFile() + ' (never supabase/functions/.env; register row 255)');
  return v;
}

module.exports = { readLocalSecret, requireLocalSecret, secretsFile };
