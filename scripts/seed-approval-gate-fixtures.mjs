#!/usr/bin/env node
/**
 * seed-approval-gate-fixtures.mjs — one PENDING request of every type, for the approval gate.
 *
 *   node seed-approval-gate-fixtures.mjs            # seed, prints the ids as JSON
 *   node seed-approval-gate-fixtures.mjs --clean    # remove everything a previous run seeded
 *   node seed-approval-gate-fixtures.mjs --tag foo  # a fixed suffix instead of a random one
 *
 * LOCAL STACK ONLY. It refuses to run against anything but a local API URL.
 *
 * ── WHY THIS IS COMMITTED ─────────────────────────────────────────────────────────────────
 * The approval gate (PM tool revamp part 3, register row 228) cannot be exercised at all
 * without one pending request of each of the SEVEN types, and a real local stack almost never
 * has all seven at once — the day this was written it had exactly one. Rebuilding this from
 * scratch is an hour of reading seven table shapes and their CHECK constraints, and the next
 * session should not pay for that twice.
 *
 * ── WHAT IT SEEDS ─────────────────────────────────────────────────────────────────────────
 * Two throwaway clients:
 *   "Gate app"  — status pending_review, which IS a pending client application (the Client
 *                 Registry is that queue; there is no separate table).
 *   "Gate main" — $50,000 unallocated, a 100-unit SPY holding and a MATURED savings pocket,
 *                 which is the state the other six requests need to be decidable:
 *     deposit          crypto, requested_amount NULL by design (the PM enters what landed),
 *                      a real tx hash, aged 3 days so it lands in "Waiting more than a day"
 *     withdrawal       bank, $4,000, aged 2 days — also overdue, so the grouping has two rows
 *     allocation       $3,000 into BTC
 *     sell             20 of 100 SPY units (a partial, so the row says "partial")
 *     hys deposit      $2,000 internal transfer — the variant that re-validates unallocated
 *     hys withdrawal   against the matured pocket, forfeit false
 *     profile change   legalName
 *
 * The two ages are deliberate: without them every row falls in "Today" and the urgency
 * grouping, the amber left rule and the "Oldest waiting N days" badge are never exercised.
 *
 * ── CLEAN UP AFTER YOURSELF ───────────────────────────────────────────────────────────────
 * Run --clean when finished. Pending rows left behind skew the exact-count assertions in
 * verify-admin-approval-gate-ui-wiring and admin.html's Overview cards — register row 212's
 * pollution class precisely, and it has already cost this project three verification passes.
 */
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLEAN = process.argv.includes('--clean');
const tagIdx = process.argv.indexOf('--tag');
const TAG = tagIdx !== -1 ? process.argv[tagIdx + 1] : 'gatefix';
const EMAIL_RE = new RegExp('^gate-(app|main)-' + TAG + '@test\\.marketswave\\.local$');

function creds() {
  const raw = execSync('npx --no-install supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  const url = j.API_URL || 'http://127.0.0.1:54321';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
    throw new Error('Refusing to run: this fixture is local-stack only, but the API URL is ' + url);
  }
  return { url, key: j.SERVICE_ROLE_KEY };
}

async function findSeeded(admin) {
  const ids = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error('listUsers: ' + error.message);
    (data.users || []).forEach((u) => { if (EMAIL_RE.test(u.email || '')) ids.push(u.id); });
    if (!data.users || data.users.length < 200) break;
  }
  return ids;
}

/* Children before parents; every delete scoped to a seeded client_id, never broader. */
async function clean(admin) {
  const ids = await findSeeded(admin);
  for (const id of ids) {
    for (const t of ['profile_change_requests', 'hys_withdrawal_requests', 'hys_deposit_requests',
                     'sell_requests', 'allocation_requests', 'withdrawal_requests', 'deposit_requests',
                     'hys_pockets', 'holdings', 'client_profiles', 'account_state']) {
      await admin.from(t).delete().eq('client_id', id);
    }
    await admin.from('clients').delete().eq('id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  return ids.length;
}

async function main() {
  const { url, key } = creds();
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Always clean first: re-running must not stack a second set of pending rows on the first.
  const removed = await clean(admin);
  if (CLEAN) {
    console.log('cleaned: removed ' + removed + ' seeded client(s) and every row scoped to them');
    process.exit(0);
  }
  if (removed) console.log('(removed ' + removed + ' client(s) from a previous run first)');

  const mk = async (which, status) => {
    const email = 'gate-' + which + '-' + TAG + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'Gate-2026!', email_confirm: true });
    if (error) throw new Error('createUser ' + which + ': ' + error.message);
    const { error: cErr } = await admin.from('clients').insert({
      id: data.user.id, name: 'Gate ' + which, email, phone: '+46 70 000 0000',
      account_type: 'Individual Account', status
    });
    if (cErr) throw new Error('clients ' + which + ': ' + cErr.message);
    return data.user.id;
  };
  const must = (label) => ({ error }) => { if (error) throw new Error(label + ': ' + error.message); };
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();

  const { data: prods } = await admin.from('products').select('id, ticker, unit_price').in('ticker', ['SPY', 'BTC']);
  const spy = prods.find((p) => p.ticker === 'SPY');
  const btc = prods.find((p) => p.ticker === 'BTC');
  if (!spy || !btc) throw new Error('SPY and BTC must exist in the catalog — run the catalog seed first.');
  const { data: addrs } = await admin.from('deposit_addresses').select('id').limit(1);

  const appId = await mk('app', 'pending_review');           // 1. client application
  const id = await mk('main', 'active');

  must('account_state')(await admin.from('account_state').insert({
    client_id: id, unallocated_capital: 50000, allocated_capital: 0, asset_returns: 0
  }));
  must('holdings')(await admin.from('holdings').insert({
    client_id: id, product_id: spy.id, units: 100, cost_basis: 40000
  }));
  const { data: pocket, error: pErr } = await admin.from('hys_pockets').insert({
    client_id: id, pocket_type: 'fixed', amount: 5000, status: 'matured', term_mode: 'short',
    term_months: 12, term_label: '12 months', rate: 0.048, term_in_years: 1,
    maturity_date: '2026-01-01', projected_interest: 240, funding_method: 'unallocated capital'
  }).select('id').single();
  if (pErr) throw new Error('hys_pockets: ' + pErr.message);
  must('client_profiles')(await admin.from('client_profiles').insert({
    client_id: id,
    legal_name: { firstName: 'Gate', lastName: 'Main' },
    address: { line1: '1 Test Street', city: 'Stockholm', country: 'Sweden' },
    id_document: { documentType: 'Passport', fileName: 'gate-passport.pdf' }
  }));

  // 2. deposit — crypto, NO requested_amount (by design: the PM enters what actually landed),
  //    aged so it lands in the overdue group.
  must('deposit_requests')(await admin.from('deposit_requests').insert({
    client_id: id, method: 'crypto', currency: 'BTC', network: 'Bitcoin',
    deposit_address_id: addrs && addrs[0] ? addrs[0].id : null,
    tx_hash: '0x7f3aaabbccddeeff0011223344556677889900aabbccddeeff00112233c21b',
    details: { currency: 'BTC', network: 'Bitcoin' }, status: 'pending', requested_at: ago(3)
  }));
  // 3. withdrawal — bank, also overdue so the urgency group has more than one row.
  must('withdrawal_requests')(await admin.from('withdrawal_requests').insert({
    client_id: id, method: 'bank', requested_amount: 4000, currency: 'USD',
    destination_details: { bankName: 'SEB', accountNumber: '****4417' },
    status: 'pending', requested_at: ago(2)
  }));
  must('allocation_requests')(await admin.from('allocation_requests').insert({   // 4
    client_id: id, product_id: btc.id, requested_amount: 3000, status: 'pending', requested_at: new Date().toISOString()
  }));
  must('sell_requests')(await admin.from('sell_requests').insert({               // 5 (partial)
    client_id: id, product_id: spy.id, units_to_sell: 20, status: 'pending', requested_at: new Date().toISOString()
  }));
  must('hys_deposit_requests')(await admin.from('hys_deposit_requests').insert({ // 6 (internal)
    client_id: id, pocket_type: 'fixed', term_mode: 'short', term_months: 12, term_label: '12 months',
    rate: 0.048, term_in_years: 1, requested_amount: 2000, method: 'internal', currency: 'USD',
    status: 'pending', requested_at: new Date().toISOString()
  }));
  must('hys_withdrawal_requests')(await admin.from('hys_withdrawal_requests').insert({ // 7
    client_id: id, pocket_id: pocket.id, pocket_type: 'fixed', term_label: '12 months',
    forfeit: false, receive_amount: 5240, method: 'bank', destination_details: { bankName: 'SEB' },
    status: 'pending', requested_at: new Date().toISOString()
  }));
  must('profile_change_requests')(await admin.from('profile_change_requests').insert({ // 8
    client_id: id, field: 'legalName',
    current_value: { firstName: 'Gate', lastName: 'Main' },
    requested_value: { firstName: 'Gate', lastName: 'Renamed' },
    reason: 'Married', status: 'pending', requested_at: new Date().toISOString()
  }));

  console.log(JSON.stringify({ tag: TAG, applicationClientId: appId, clientId: id, pocketId: pocket.id }, null, 2));
  console.log('\nSeeded 8 pending items across all seven types (HYS contributes two).');
  console.log('Run with --clean when finished — leftover pending rows skew exact-count assertions.');
  process.exit(0);
}

main().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
