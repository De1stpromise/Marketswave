#!/usr/bin/env node
// verify-supabase-attribution-views.mjs — signed-in clients cannot read which PM resolved their
// requests, set the fee rate or created their deposit address; the PM tool still can
// (2026-10-01, register row 305). Same shape as verify-supabase-products-attribution (row 304).
//
// Before: the request tables, conversations, advisory_fee_rate and deposit_addresses all granted a
// client their own full row, so `resolved_by_email` / `updated_by_email` / `created_by_email` —
// a PM's own sign-in address — came back to the client through the API. Now clients read
// definer views without those columns (my_*, advisory_fee_rate_public) and the base tables are
// admin-only for SELECT. Proven against the real local stack, with a real client whose rows are
// resolved BY a real PM (so the attribution genuinely exists — non-vacuous):
//   * the client reads its own row through each view, with no attribution column on it, and asking
//     the view for an attribution column is refused 42703 (asked directly, never inferred);
//   * the client reading each BASE table gets zero rows;
//   * a SECOND client sees none of the first client's rows through any view;
//   * anon reads nothing;
//   * the PM reads each base table WITH the attribution populated;
//   * the messages policies — which used to look conversations up as the caller — still let the
//     client read its own messages and send one, now conversations itself is closed to them.
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { runVerifyMain } from './lib/run-verify.mjs';

const PM_EMAIL = 'pm@marketswave.local', PM_PASSWORD = 'MarketswavePM-Local-2026!';
// view -> [base table, attribution columns]
const VIEWS = {
  my_allocation_requests: ['allocation_requests', ['resolved_by', 'resolved_by_email']],
  my_sell_requests: ['sell_requests', ['resolved_by', 'resolved_by_email']],
  my_deposit_requests: ['deposit_requests', ['resolved_by', 'resolved_by_email']],
  my_withdrawal_requests: ['withdrawal_requests', ['resolved_by', 'resolved_by_email']],
  my_hys_deposit_requests: ['hys_deposit_requests', ['resolved_by', 'resolved_by_email']],
  my_hys_withdrawal_requests: ['hys_withdrawal_requests', ['resolved_by', 'resolved_by_email']],
  my_profile_change_requests: ['profile_change_requests', ['resolved_by', 'resolved_by_email']],
  my_conversations: ['conversations', ['resolved_by', 'resolved_by_email']],
  my_deposit_addresses: ['deposit_addresses', ['created_by', 'created_by_email']],
  advisory_fee_rate_public: ['advisory_fee_rate', ['updated_by', 'updated_by_email']],
};
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); } }
function must(r, what) { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; }

async function main() {
  const st = JSON.parse(execSync('npx supabase status -o json', { cwd: '..', encoding: 'utf8' }).replace(/^[^{]*/, ''));
  if (!/127\.0\.0\.1|localhost/.test(st.API_URL)) throw new Error('refusing to run against ' + st.API_URL);
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, opts);
  const sfx = randomBytes(4).toString('hex');
  const password = 'Attrib-' + randomBytes(8).toString('hex') + '!';
  const made = [];
  const mkUser = async (tag) => {
    const email = 'attrib-views-' + tag + '-' + sfx + '@example.com';
    const u = must(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'createUser ' + tag);
    made.push(u.user.id);
    must(await admin.from('clients').insert({ id: u.user.id, name: 'Attribution Fixture ' + tag + ' ' + sfx, email, account_type: 'Individual Account', phone: '+10000000000', status: 'active' }), 'clients ' + tag);
    return { id: u.user.id, email };
  };
  let addressId = null, feeBefore = null;
  try {
    const A = await mkUser('a'), B = await mkUser('b');
    const pmUsers = must(await admin.auth.admin.listUsers({ perPage: 1000 }), 'listUsers').users;
    const pmUser = pmUsers.find((u) => u.email === PM_EMAIL);
    if (!pmUser) throw new Error('bootstrap PM not found');
    const by = { resolved_by: pmUser.id, resolved_by_email: PM_EMAIL, resolved_at: new Date().toISOString() };

    // One resolved row per table for client A, attributed to the real PM.
    must(await admin.from('allocation_requests').insert({ client_id: A.id, product_id: 'PROD-0001', requested_amount: 1000, status: 'rejected', ...by }), 'allocation');
    must(await admin.from('sell_requests').insert({ client_id: A.id, product_id: 'PROD-0001', units_to_sell: 1, status: 'rejected', ...by }), 'sell');
    must(await admin.from('deposit_requests').insert({ client_id: A.id, method: 'bank', requested_amount: 500, currency: 'USD', status: 'rejected', ...by }), 'deposit');
    must(await admin.from('withdrawal_requests').insert({ client_id: A.id, method: 'bank', requested_amount: 200, currency: 'USD', status: 'rejected', ...by }), 'withdrawal');
    must(await admin.from('hys_deposit_requests').insert({ client_id: A.id, pocket_type: 'ayw', requested_amount: 300, method: 'bank', currency: 'USD', status: 'rejected', ...by }), 'hys deposit');
    const pocket = must(await admin.from('hys_pockets').insert({ client_id: A.id, pocket_type: 'ayw', amount: 300, funding_method: 'bank account' }).select('id').single(), 'pocket');
    must(await admin.from('hys_withdrawal_requests').insert({ client_id: A.id, pocket_id: pocket.id, pocket_type: 'ayw', receive_amount: 300, method: 'internal', status: 'rejected', ...by }), 'hys withdrawal');
    must(await admin.from('profile_change_requests').insert({ client_id: A.id, field: 'address', requested_value: { line1: 'Fixture' }, status: 'rejected', ...by }), 'profile change');
    const convo = must(await admin.from('conversations').insert({ client_id: A.id, contact_email: A.email, contact_name: 'Attribution Fixture a', kind: 'chat', status: 'resolved', ...by }).select('id').single(), 'conversation');
    must(await admin.from('messages').insert({ conversation_id: convo.id, channel: 'chat', direction: 'outbound', body: 'Fixture reply from the PM', sender_email: 'support@marketswave.net' }), 'pm message');
    const addr = must(await admin.from('deposit_addresses').insert({ currency: 'BTC', network: 'Bitcoin', address: 'bc1qattribviews' + sfx + 'x0x0x0x0x0x0', created_by: pmUser.id, created_by_email: PM_EMAIL }).select('id').single(), 'address');
    addressId = addr.id;
    must(await admin.from('deposit_address_assignments').insert({ address_id: addr.id, client_id: A.id, currency: 'BTC', network: 'Bitcoin' }), 'assignment');
    feeBefore = must(await admin.from('advisory_fee_rate').select('updated_by, updated_by_email').eq('id', true).single(), 'fee');
    if (!feeBefore.updated_by_email) must(await admin.from('advisory_fee_rate').update({ updated_by: pmUser.id, updated_by_email: PM_EMAIL }).eq('id', true), 'fee attribution');

    console.log('=== 1. A SIGNED-IN CLIENT, through each view ===');
    const client = createClient(st.API_URL, st.ANON_KEY, opts);
    const se = (await client.auth.signInWithPassword({ email: A.email, password })).error;
    check('client A signs in', !se, se && se.message);
    for (const [view, [base, cols]] of Object.entries(VIEWS)) {
      const r = await client.from(view).select('*');
      const keys = r.data && r.data[0] ? Object.keys(r.data[0]) : [];
      check(view + ': client A reads its own row (non-vacuous)', !r.error && r.data.length >= 1, r.error ? r.error.message : r.data.length + ' rows');
      check(view + ': ...and no attribution column comes back', keys.length > 0 && cols.every((c) => !keys.includes(c)), keys.filter((k) => cols.includes(k)).join(','));
      const ce = (await client.from(view).select(cols[1]).limit(1)).error;
      check(view + ': asking it for ' + cols[1] + ' is refused 42703', ce && ce.code === '42703', ce ? ce.code : 'no error');
      const b = await client.from(base).select('*');
      check(base + ': client A reading the BASE table gets zero rows', !b.error && b.data.length === 0, b.error ? b.error.message : b.data.length + ' rows');
    }

    console.log('=== 2. MESSAGES still work for the client (conversations closed to them) ===');
    const msgs = await client.from('messages').select('id, body').eq('conversation_id', convo.id);
    check('client A reads its own conversation\'s messages', !msgs.error && msgs.data.length >= 1, msgs.error ? msgs.error.message : msgs.data.length + ' rows');
    const sent = await client.from('messages').insert({ conversation_id: convo.id, channel: 'chat', direction: 'inbound', body: 'Fixture reply from the client' }).select().single();
    check('client A sends an inbound message into its own conversation', !sent.error && sent.data && sent.data.id, sent.error && sent.error.message);
    await client.auth.signOut({ scope: 'local' });

    console.log('=== 3. A SECOND CLIENT sees none of it ===');
    const other = createClient(st.API_URL, st.ANON_KEY, opts);
    await other.auth.signInWithPassword({ email: B.email, password });
    for (const view of Object.keys(VIEWS)) {
      if (view === 'advisory_fee_rate_public') continue; // genuinely global, read by everyone
      const r = await other.from(view).select('id');
      check(view + ': client B sees zero rows', !r.error && r.data.length === 0, r.error ? r.error.message : r.data.length + ' rows');
    }
    const om = await other.from('messages').select('id').eq('conversation_id', convo.id);
    check('client B reads none of client A\'s messages', !om.error && om.data.length === 0, om.error ? om.error.message : om.data.length + ' rows');
    const os = await other.from('messages').insert({ conversation_id: convo.id, channel: 'chat', direction: 'inbound', body: 'intrusion' });
    check('client B cannot post into client A\'s conversation', !!os.error, 'insert accepted');
    await other.auth.signOut({ scope: 'local' });

    console.log('=== 4. ANON ===');
    const anon = createClient(st.API_URL, st.ANON_KEY, opts);
    for (const [view, [base]] of Object.entries(VIEWS)) {
      const v = await anon.from(view).select('*').limit(1);
      const b = await anon.from(base).select('*').limit(1);
      check(view + ' / ' + base + ': anon reads nothing', (!!v.error || v.data.length === 0) && (!!b.error || b.data.length === 0));
    }

    console.log('=== 5. THE PM TOOL keeps the attribution ===');
    const pm = createClient(st.API_URL, st.ANON_KEY, opts);
    const pe = (await pm.auth.signInWithPassword({ email: PM_EMAIL, password: PM_PASSWORD })).error;
    check('the bootstrap PM signs in', !pe, pe && pe.message);
    for (const [view, [base, cols]] of Object.entries(VIEWS)) {
      let q = pm.from(base).select('*');
      if (base === 'deposit_addresses') q = q.eq('id', addressId);
      else if (base === 'advisory_fee_rate') q = q.eq('id', true);
      else q = q.eq('client_id', A.id);
      const r = await q;
      check('★ ' + base + ': the PM reads ' + cols[1] + ' populated', !r.error && r.data.length >= 1 && r.data.every((row) => row[cols[1]]), r.error ? r.error.message : JSON.stringify((r.data || []).map((x) => x[cols[1]])));
    }
    await pm.auth.signOut({ scope: 'local' });
  } finally {
    if (feeBefore && !feeBefore.updated_by_email) {
      const r = await admin.from('advisory_fee_rate').update({ updated_by: feeBefore.updated_by, updated_by_email: feeBefore.updated_by_email }).eq('id', true);
      if (r.error) console.log('TEARDOWN WARNING: fee attribution not restored: ' + r.error.message);
    }
    for (const id of made) {
      for (const t of ['allocation_requests', 'sell_requests', 'deposit_requests', 'withdrawal_requests', 'hys_deposit_requests', 'hys_withdrawal_requests', 'profile_change_requests']) {
        const r = await admin.from(t).delete().eq('client_id', id); if (r.error) console.log('TEARDOWN WARNING: ' + t + ': ' + r.error.message);
      }
      for (const t of ['hys_pockets', 'deposit_address_assignments']) {
        const r = await admin.from(t).delete().eq('client_id', id); if (r.error) console.log('TEARDOWN WARNING: ' + t + ': ' + r.error.message);
      }
      const cv = await admin.from('conversations').select('id').eq('client_id', id);
      for (const c of cv.data || []) { await admin.from('messages').delete().eq('conversation_id', c.id); }
      const rc = await admin.from('conversations').delete().eq('client_id', id); if (rc.error) console.log('TEARDOWN WARNING: conversations: ' + rc.error.message);
    }
    if (addressId) { const r = await admin.from('deposit_addresses').delete().eq('id', addressId); if (r.error) console.log('TEARDOWN WARNING: deposit_addresses: ' + r.error.message); }
    for (const id of made) {
      await admin.from('clients').delete().eq('id', id);
      const d = await admin.auth.admin.deleteUser(id);
      if (d.error) console.log('TEARDOWN WARNING: could not delete ' + id + ': ' + d.error.message);
      const g = await admin.auth.admin.getUserById(id);
      if (g.data && g.data.user) console.log('TEARDOWN WARNING: account ' + id + ' still present');
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}
runVerifyMain(main, { watchdogMs: 240000 });
