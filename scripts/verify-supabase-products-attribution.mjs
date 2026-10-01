#!/usr/bin/env node
// verify-supabase-products-attribution.mjs — signed-in clients cannot read staff attribution on
// the product catalog; the PM tool still can (2026-10-01, register row 304).
//
// Before: products had created_by / created_by_email (+ the updated_by and retired_by pairs), and
// its SELECT policy granted every signed-in user the whole row, so a client could read the email
// of the PM who created each product. Now clients read public.products_catalog (a view without
// those columns) and the base table is admin-only. This proves, against the real local stack:
//   * a real CLIENT session reads the view, which carries no attribution column (PostgREST answers
//     42703 when asked for one — asked directly, never inferred from an empty row's keys);
//   * the same client reading the base table gets ZERO rows (RLS filters silently);
//   * anon reads neither;
//   * a real PM session reads the base table WITH created_by_email populated — non-vacuous: the
//     attribution genuinely exists, so its absence from the client's read means something.
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { runVerifyMain } from './lib/run-verify.mjs';

const ATTRIBUTION = ['created_by', 'created_by_email', 'updated_by', 'updated_by_email', 'retired_by', 'retired_by_email', 'retired_reason', 'price_failure_reason'];
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); } }

async function main() {
  const st = JSON.parse(execSync('npx supabase status -o json', { cwd: '..', encoding: 'utf8' }).replace(/^[^{]*/, ''));
  if (!/127\.0\.0\.1|localhost/.test(st.API_URL)) throw new Error('refusing to run against ' + st.API_URL);
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, opts);
  const email = 'products-attrib-' + randomBytes(4).toString('hex') + '@example.com';
  const password = 'Attrib-' + randomBytes(8).toString('hex') + '!';
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ue) throw ue;
  try {
    console.log('=== 1. A SIGNED-IN CLIENT ===');
    const client = createClient(st.API_URL, st.ANON_KEY, opts);
    const { error: se } = await client.auth.signInWithPassword({ email, password });
    check('a real client session signs in', !se, se && se.message);
    const { data: cat, error: ce } = await client.from('products_catalog').select('*');
    check('the client reads the catalog through the view', !ce && cat && cat.length > 0, ce ? ce.message : (cat || []).length + ' rows');
    const keys = cat && cat[0] ? Object.keys(cat[0]) : [];
    check('...a catalog row carries name, unit price and status', ['id', 'name', 'unit_price', 'status'].every((k) => keys.includes(k)), keys.join(','));
    check('...and NO attribution or internal-reason column', ATTRIBUTION.every((k) => !keys.includes(k)), keys.filter((k) => ATTRIBUTION.includes(k)).join(','));
    for (const col of ['created_by_email', 'updated_by_email', 'retired_by_email']) {
      const { error } = await client.from('products_catalog').select(col).limit(1);
      check('asking the view for ' + col + ' is refused (42703: the column does not exist there)', error && error.code === '42703', error ? error.code : 'no error');
    }
    const { data: base, error: be } = await client.from('products').select('id, created_by_email');
    check('the client reading the BASE table gets zero rows', !be && Array.isArray(base) && base.length === 0, be ? be.message : base.length + ' rows');
    await client.auth.signOut({ scope: 'local' });

    console.log('=== 2. ANON ===');
    const anon = createClient(st.API_URL, st.ANON_KEY, opts);
    const { data: av, error: ave } = await anon.from('products_catalog').select('id').limit(1);
    check('anon cannot read the view', !!ave || (av || []).length === 0, ave ? ave.code : (av || []).length + ' rows');
    const { data: ab, error: abe } = await anon.from('products').select('id').limit(1);
    check('anon cannot read the base table', !!abe || (ab || []).length === 0, abe ? abe.code : (ab || []).length + ' rows');

    console.log('=== 3. THE PM TOOL ===');
    const pm = createClient(st.API_URL, st.ANON_KEY, opts);
    const { error: pe } = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    check('the bootstrap PM signs in', !pe, pe && pe.message);
    const { data: pb, error: pbe } = await pm.from('products').select('id, created_by_email');
    check('the PM reads the base table', !pbe && pb && pb.length > 0, pbe ? pbe.message : (pb || []).length + ' rows');
    const attributed = (pb || []).filter((r) => r.created_by_email);
    check('★ ...with created_by_email genuinely populated (non-vacuous: the attribution exists)', attributed.length > 0, attributed.length + ' rows attributed');
    const { count: total } = await admin.from('products').select('id', { count: 'exact', head: true });
    check('the view and the base table hold the same rows', cat && cat.length === total && pb.length === total, (cat || []).length + ' / ' + (pb || []).length + ' / ' + total);
    await pm.auth.signOut({ scope: 'local' });
  } finally {
    const { error: de } = await admin.auth.admin.deleteUser(u.user.id);
    if (de) console.log('TEARDOWN WARNING: could not delete ' + u.user.id + ': ' + de.message);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}
runVerifyMain(main, { watchdogMs: 180000 });
