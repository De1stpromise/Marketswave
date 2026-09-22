// check-realised-migration-safety.mjs — the pre-migration safety report for the realised-gains
// fix (2026-09-22, row 264). REPORT ONLY: it writes nothing, on either stack.
//
// The migration is `unallocated_capital += asset_returns` (asset_returns retained as a tally).
// A client whose realised total is NEGATIVE — sold at a loss — would have their spendable
// balance REDUCED, and if they have since allocated against that overstated balance the result
// could be below zero. Nobody's balance goes negative without a decision, so this reports every
// affected client on both stacks and exits non-zero if ANY would end up under zero.
//
// Usage (from scripts/):
//   node check-realised-migration-safety.mjs                 # local stack
//   node check-realised-migration-safety.mjs --staging       # real cloud staging (service_role key file)
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const staging = process.argv.includes('--staging');
function conn() {
  if (staging) {
    const f = process.env.SUPABASE_STAGING_CREDENTIALS_FILE || 'C:/WorkDirectory/marketswave-secrets/supabase-staging-api-keys.json';
    const key = JSON.parse(readFileSync(f, 'utf8')).find((e) => e.name === 'service_role').api_key;
    return { url: 'https://ujnmlwbpginplfnofhhv.supabase.co', key, label: 'REAL CLOUD STAGING' };
  }
  const raw = execSync('supabase status -o json', { cwd: '..', encoding: 'utf8' });
  const st = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) throw new Error('refusing a non-local API_URL: ' + st.API_URL);
  return { url: st.API_URL, key: st.SERVICE_ROLE_KEY, label: 'LOCAL STACK' };
}

const { url, key, label } = conn();
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const r2 = (n) => Math.round(n * 100) / 100;

const { data: states, error } = await admin.from('account_state').select('client_id, unallocated_capital, allocated_capital, asset_returns');
if (error) throw new Error('account_state: ' + error.message);
const { data: clients } = await admin.from('clients').select('id, name, status');
const name = Object.fromEntries((clients || []).map((c) => [c.id, c.name]));
const { data: sells } = await admin.from('transactions').select('client_id, total_value, realized_return').eq('type', 'SELL');

console.log('Realised-gains migration safety — ' + label + ' (' + url + ')');
console.log('The migration: unallocated_capital += asset_returns; asset_returns retained as a tally.\n');
console.log('client'.padEnd(26) + 'unallocated'.padStart(14) + 'realised'.padStart(12) + 'after'.padStart(14) + '  sells  verdict');
let negatives = [], affected = 0;
for (const s of (states || []).sort((a, b) => Number(a.asset_returns) - Number(b.asset_returns))) {
  const un = Number(s.unallocated_capital), ar = Number(s.asset_returns);
  const after = r2(un + ar);
  const mySells = (sells || []).filter((t) => t.client_id === s.client_id);
  const lossSells = mySells.filter((t) => Number(t.realized_return) < 0).length;
  if (ar !== 0) affected++;
  const verdict = after < 0 ? 'NEGATIVE — STOP' : (ar < 0 ? 'reduced (realised loss)' : (ar > 0 ? 'increased' : 'unchanged'));
  if (after < 0) negatives.push({ client: name[s.client_id] || s.client_id, un, ar, after });
  console.log((name[s.client_id] || s.client_id.slice(0, 8)).padEnd(26) + String(un).padStart(14) + String(ar).padStart(12) + String(after).padStart(14) +
    '  ' + String(mySells.length).padStart(5) + (lossSells ? ' (' + lossSells + ' at a loss)' : '') + '  ' + verdict);
}
console.log('\n' + (states || []).length + ' account_state rows; ' + affected + ' carry a non-zero realised total.');
const totalMoved = r2((states || []).reduce((t, s) => t + Number(s.asset_returns), 0));
console.log('total realised moved into spendable capital: ' + totalMoved);
// A sale at a loss is what makes a balance shrink: report the ledger's own loss rows for context.
const lossRows = (sells || []).filter((t) => Number(t.realized_return) < 0);
console.log('SELL rows with a negative realized_return: ' + lossRows.length + (lossRows.length ? ' — ' + JSON.stringify(lossRows.map((t) => Number(t.realized_return))) : ''));
if (negatives.length) {
  console.log('\nSTOP: ' + negatives.length + ' client(s) would end below zero:');
  for (const n of negatives) console.log('  ' + n.client + ': ' + n.un + ' + (' + n.ar + ') = ' + n.after);
  console.log('Do not migrate. Report and decide.');
  process.exit(1);
}
console.log('\nSAFE: no client ends below zero on this stack.');
process.exit(0);
