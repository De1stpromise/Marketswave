// fixture-client.mjs — the ONE place the seeded fixture client's identity lives.
//
// Every suite that needs a real, backdated, populated account resolves it through here, never
// through an address written into the suite. The address is NOT in the repository: it is read
// from GARY_SEED_EMAIL (the environment, or supabase/functions/.env — gitignored, the same file
// GARY_SEED_PASSWORD already lives in), with a non-deliverable fixture default for a stack that
// has never been seeded. Register row 256 (2026-09-21): the repository is public and served in
// full, and a real, deliverable address had been written into the seed and four suites.
//
// Resolution order, and why both steps exist: by the configured address first; then by the
// fixture's NAME. A stack seeded before this module existed carries whatever address the
// operator seeded it with — the name lookup is what lets such a stack keep resolving with no
// environment variable set, so no suite starts SKIPping a real assertion because a literal moved.
// Two clients carrying the fixture's name is an error, not a guess.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_FILE = path.join(ROOT, 'supabase', 'functions', '.env');

// A reserved TLD (RFC 2606): syntactically valid everywhere, deliverable nowhere.
export const FIXTURE_CLIENT_DEFAULT_EMAIL = 'gary.sizemore@fixture.marketswave.test';

/** process.env first, then supabase/functions/.env. Returns null when unset. */
export function readSeedEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(ENV_FILE)) return null;
  const line = readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).find((l) => l.startsWith(key + '='));
  if (!line) return null;
  const v = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  return v || null;
}

export const FIXTURE_CLIENT = Object.freeze({
  name: 'Gary Sizemore',
  get email() { return (readSeedEnv('GARY_SEED_EMAIL') || FIXTURE_CLIENT_DEFAULT_EMAIL).toLowerCase(); },
});

export function fixtureClientPassword() {
  const v = readSeedEnv('GARY_SEED_PASSWORD');
  if (!v) throw new Error('GARY_SEED_PASSWORD is not set (supabase/functions/.env) — seed the fixture client first: node seed-client-gary.mjs');
  return v;
}

/**
 * The fixture client's `clients` row, or null when the stack has not been seeded.
 * @param admin a service_role supabase-js client
 * @param columns the select list (default 'id, name, email')
 */
export async function findFixtureClient(admin, columns = 'id, name, email') {
  const byEmail = await admin.from('clients').select(columns).ilike('email', FIXTURE_CLIENT.email).maybeSingle();
  if (byEmail.error) throw new Error('fixture client lookup by email: ' + byEmail.error.message);
  if (byEmail.data) return byEmail.data;
  const byName = await admin.from('clients').select(columns).ilike('name', FIXTURE_CLIENT.name).limit(2);
  if (byName.error) throw new Error('fixture client lookup by name: ' + byName.error.message);
  const rows = byName.data || [];
  if (rows.length > 1) throw new Error('more than one client is named "' + FIXTURE_CLIENT.name + '" — set GARY_SEED_EMAIL to the seeded address so the lookup is unambiguous');
  return rows[0] || null;
}
