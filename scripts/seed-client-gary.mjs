#!/usr/bin/env node
/**
 * seed-client-gary.mjs — reconstruct one backdated client account, repeatably.
 *
 *   node seed-client-gary.mjs              # local Supabase stack
 *   node seed-client-gary.mjs --staging    # real cloud staging
 *
 * This is a SCRIPT FOR ONE CLIENT, not a migration tool. A tool for migrating many clients is
 * queued separately; this seeds Gary Sizemore and nothing else.
 *
 * ── THE PASSWORD, AND THE ADDRESS ───────────────────────────────────────────────────────────
 * Read from GARY_SEED_PASSWORD and GARY_SEED_EMAIL. Put both in supabase/functions/.env (already
 * gitignored, already where FINNHUB_API_KEY / RESEND_API_KEY live). NEVER hardcoded, never
 * committed — the address is a real, deliverable one and the repository is public (row 256);
 * scripts/lib/fixture-client.mjs is the one place it is read, with a non-deliverable fixture
 * default for a stack that has never been seeded. The account is
 * created email_confirm:true — he is a migrated client who was verified on the previous
 * platform, so there is no confirmation mail and no extra step before he can sign in.
 *
 * ── HOW IT IS IDEMPOTENT ────────────────────────────────────────────────────────────────────
 * Two mechanisms, deliberately different because the data is:
 *
 *   1. THE AUTH USER IS CREATE-OR-REUSE, keyed on the email. Re-running never makes a second
 *      Gary and never changes his uid, so every foreign key downstream stays valid and any
 *      session he holds keeps working. If GARY_SEED_PASSWORD differs from the stored one on a
 *      re-run the password is UPDATED, so it can be rotated by re-running.
 *
 *   2. EVERY OTHER ROW IS DELETE-THEN-INSERT, SCOPED TO HIS OWN client_id. Most of these tables
 *      have gen_random_uuid() ids and no natural key, so an upsert has nothing stable to key on;
 *      wiping his rows and rebuilding is what makes a re-run produce identical state instead of
 *      duplicates. The delete is ALWAYS .eq('client_id', uid) where uid was resolved from the
 *      exact email — it can never touch another client.
 *      The two shared deposit_addresses rows are the exception: they are GLOBAL, so they upsert
 *      on (currency, network, address) and are never deleted (another client may share one).
 *
 * ── WHY THE HISTORY IS WRITTEN DIRECTLY ─────────────────────────────────────────────────────
 * The normal path cannot produce it. execute-buy/execute-sell price at TODAY and the engine
 * settles forward, so a 2021 purchase at $55,000 is unreachable through them. This writes the
 * end state: holdings with their real units and cost basis, transactions at their historical
 * created_at and price, and the realised figures on the SELL rows.
 *
 * Verified safe before writing (see register row 223):
 *   - NOTHING recomputes holdings. No trigger on holdings / account_state /
 *     portfolio_value_snapshots; only execute-buy and execute-sell ever write
 *     holdings.cost_basis, and neither runs here.
 *   - transactions.created_at is a plain insertable timestamptz (default now(), no trigger) and
 *     IS the historical date — there is no separate date column.
 *   - account_state.allocated_capital CANNOT be seeded meaningfully:
 *     computeTotalPortfolioValue() calls recomputeAllocatedCapital(), which overwrites it with
 *     Σ units × live price on every read. A correct value is written anyway so the row is never
 *     transiently wrong, but the engine owns that field.
 *   - Cost-basis reconstruction works off the ledger: capital allocated to sold units =
 *     total_value − realized_return. get-returns-summary reads realised from the SELL rows, not
 *     from account_state, so the closed-positions panel renders these figures exactly.
 *
 * ── THE HISTORY IS SOLVED, NOT COPIED ───────────────────────────────────────────────────────
 * The source document's figures were built against mockup prices and a brokerage model in which
 * sale GAINS can be redeployed. Neither holds here: this engine returns only the COST-BASIS
 * portion of a sale to spendable unallocated capital and routes the gain to asset_returns, which
 * execute-buy cannot spend. The history below was re-solved against live catalog prices and that
 * real cash-flow invariant. Deposits are unchanged ($14,370, 7 of them, dates as given).
 *
 * ── NO HISTORICAL EMAIL ─────────────────────────────────────────────────────────────────────
 * Backfilled 2021 deposits must not fire five-year-old confirmations. This script calls NO Edge
 * Function and sends NOTHING; where the history matters it writes email_log rows directly, which
 * is a record of mail sent on the old platform, not an instruction to send any now. Email is
 * live for this account from here on — only genuinely new activity sends.
 */
import { createClient } from '@supabase/supabase-js';
import { FIXTURE_CLIENT } from './lib/fixture-client.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STAGING = process.argv.includes('--staging');
const r2 = (n) => Math.round(n * 100) / 100;

/* ── identity ─────────────────────────────────────────────────────────────────────────────── */
const GARY = {
  // ★ LOWERCASE, DELIBERATELY (2026-09-15). Stored capitalised, this row was the only
  // mixed-case email in either environment, and it exposed a real latent mechanism rather
  // than a cosmetic one: public.clients' own INSERT policy compared `email = (auth.jwt() ->>
  // 'email')` with a plain `=`, while GoTrue normalises every address it stores to lowercase.
  // A caller inserting the address a client actually TYPED would therefore be refused by RLS
  // with no error a client could act on. Proven directly, both ways, before changing anything:
  // a mixed-case insert REFUSED, the same row lowercase ACCEPTED. The policy is
  // case-insensitive now and a trigger normalises on write — but the convention is to store
  // lowercase at the source too, so a re-run of this seed never puts a capitalised address
  // back. See CLAUDE.md's Working conventions.
  email: FIXTURE_CLIENT.email, // GARY_SEED_EMAIL, never a literal here — scripts/lib/fixture-client.mjs
  name: FIXTURE_CLIENT.name,
  phone: '(502) 558 5280',
  accountType: 'Individual Account',
  since: '2021-10-07',
};

/* ── the solved history ───────────────────────────────────────────────────────────────────── */
const DEPOSITS = [ // FIXED by the source document: 7 deposits, $14,370, all crypto
  { date: '2021-10-07', amount: 5000, currency: 'BTC', network: 'Bitcoin' },
  { date: '2022-06-29', amount: 900, currency: 'BTC', network: 'Bitcoin' },
  { date: '2022-07-20', amount: 1100, currency: 'BTC', network: 'Bitcoin' },
  { date: '2022-10-28', amount: 1000, currency: 'USDT', network: 'TRC-20' },
  { date: '2022-10-28', amount: 500, currency: 'USDT', network: 'TRC-20' },
  { date: '2023-04-07', amount: 1000, currency: 'BTC', network: 'Bitcoin' },
  { date: '2023-11-15', amount: 4870, currency: 'BTC', network: 'Bitcoin' },
];

const BUYS = [
  ['2021-10-11', 'SPY', 1800, 438], ['2021-10-11', 'BTC', 1900, 55000], ['2021-10-11', 'AAPL', 1250, 145],
  ['2022-07-01', 'BTC', 900, 20000],
  ['2022-07-22', 'ETH', 1100, 1100],
  ['2022-10-31', 'QQQ', 1000, 280], ['2022-10-31', 'NVDA', 500, 14],
  ['2023-04-11', 'BTC', 1000, 28000],
  ['2023-11-20', 'NVDA', 700, 48], ['2023-11-20', 'SPY', 1100, 440], ['2023-11-20', 'ETH', 1200, 2000],
  ['2023-11-20', 'BTC', 870, 37000], ['2023-11-20', 'VGK', 1000, 58],
  ['2024-03-20', 'MSFT', 600, 415],
  ['2024-09-15', 'SOL', 400, 135], ['2024-09-15', 'ETH', 300, 2400],
  ['2025-06-05', 'ETH', 400, 2600],
];

// units, price. Cost basis and realised are DERIVED by replay — never hardcoded, so they can
// never drift out of agreement with the holdings they came from.
const SELLS = [
  ['2024-03-15', 'NVDA', 25, 85],
  ['2024-09-10', 'AAPL', 1250 / 145, 220],   // full close
  ['2025-05-22', 'BTC', 0.03, 85000],
];

const POCKETS = [
  { open: '2025-06-01', amount: 600, months: 12, rate: 0.048, matures: '2026-06-01', status: 'matured' },
  { open: '2026-07-10', amount: 500, months: 12, rate: 0.048, matures: '2027-07-10', status: 'active' },
];

/* Monthly price path for the snapshot series. Anchors are every real trade price plus today's
 * live price; interpolation is linear in LOG space, so every trade in the history sits exactly
 * ON the path rather than beside it. */
const PRICE_ANCHORS = {
  BTC: [['2021-10', 55000], ['2021-11', 66000], ['2022-01', 42000], ['2022-06', 21000], ['2022-07', 20000], ['2022-11', 16500], ['2023-04', 28000], ['2023-11', 37000], ['2024-03', 68000], ['2024-11', 76000], ['2025-05', 85000], ['2025-12', 82000]],
  ETH: [['2021-10', 3400], ['2021-11', 4200], ['2022-06', 1150], ['2022-07', 1100], ['2022-11', 1250], ['2023-11', 2000], ['2024-09', 2400], ['2025-06', 2600]],
  SPY: [['2021-10', 438], ['2022-01', 460], ['2022-10', 372], ['2023-11', 440], ['2024-09', 565], ['2025-06', 640]],
  AAPL: [['2021-10', 145], ['2022-10', 150], ['2023-11', 190], ['2024-09', 220]],
  NVDA: [['2022-10', 14], ['2023-11', 48], ['2024-03', 85], ['2024-11', 135], ['2025-06', 158]],
  QQQ: [['2022-10', 280], ['2023-11', 390], ['2024-09', 480], ['2025-06', 560]],
  VGK: [['2023-11', 58], ['2024-09', 68], ['2025-06', 76]],
  MSFT: [['2024-03', 415], ['2024-11', 430], ['2025-06', 465]],
  SOL: [['2024-09', 135], ['2025-01', 190], ['2025-06', 140]],
};

const CEILING_VALUE = 35740;
const CEILING_RETURN = 21370;
/* The trailing pending allocation request. Module scope so hard gate 8 can check it
 * against the replayed ending cash BEFORE anything is written. */
const PENDING_ALLOC = 100;

/* Crypto deposit addresses. Structurally valid for their networks (see
 * _shared/deposit-address-validation.ts) but not wallets anyone controls — this is seed data. */
const ADDRESSES = [
  { currency: 'BTC', network: 'Bitcoin', address: 'bc1qg4ry5m2xk8p3nvz7wq6hs9jt0cdfe4lu8a2v6x', label: 'Gary Sizemore — BTC' },
  { currency: 'USDT', network: 'TRC-20', address: 'TQm7xKp2VrN8sLd4WfYc6BhZaE3uJg9tRv', label: 'Gary Sizemore — USDT TRC-20' },
];

/* ── connection ───────────────────────────────────────────────────────────────────────────── */
function localCreds() {
  const raw = execSync('npx --no-install supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  const url = j.API_URL || 'http://127.0.0.1:54321';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
    throw new Error('Refusing to run: local mode resolved a non-local API URL, ' + url);
  }
  return { url, key: j.SERVICE_ROLE_KEY };
}

function stagingCreds() {
  const f = process.env.SUPABASE_STAGING_CREDENTIALS_FILE;
  if (!f) throw new Error('SUPABASE_STAGING_CREDENTIALS_FILE is not set. Point it at the JSON from `supabase projects api-keys --reveal`.');
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const arr = Array.isArray(j) ? j : (j.keys || j.api_keys || []);
  const sr = arr.find((k) => k.name === 'service_role' || k.id === 'service_role');
  if (!sr) throw new Error('No service_role entry in ' + f);
  const cfg = readFileSync(path.join(ROOT, 'supabase-endpoint.js'), 'utf8');
  const url = (cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  if (!url) throw new Error('Could not read the staging URL out of supabase-endpoint.js');
  return { url, key: sr.api_key || sr.apiKey || sr.key };
}

function readPassword() {
  if (process.env.GARY_SEED_PASSWORD) return process.env.GARY_SEED_PASSWORD;
  const envFile = path.join(ROOT, 'supabase', 'functions', '.env');
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('GARY_SEED_PASSWORD='));
    if (line) {
      const v = line.slice('GARY_SEED_PASSWORD='.length).trim().replace(/^["']|["']$/g, '');
      if (v) return v;
    }
  }
  throw new Error('GARY_SEED_PASSWORD is not set. Put it in supabase/functions/.env (gitignored) or export it.');
}

/* ── replay: derives every figure from the history above ──────────────────────────────────── */
function replay(livePrices) {
  let cash = 0;
  let assetReturns = 0;
  const hold = new Map();
  const ledger = [];
  const closed = [];
  let minCash = Infinity;

  const evts = [
    ...DEPOSITS.map((d) => ({ t: d.date, kind: 'DEPOSIT', ...d })),
    ...BUYS.map(([t, sym, amount, price]) => ({ t, kind: 'BUY', sym, amount, price })),
    ...SELLS.map(([t, sym, units, price]) => ({ t, kind: 'SELL', sym, units, price })),
    ...POCKETS.map((p) => ({ t: p.open, kind: 'HYS_TRANSFER_IN', amount: p.amount })),
  ].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  for (const e of evts) {
    if (e.kind === 'DEPOSIT') {
      cash = r2(cash + e.amount);
      ledger.push({ date: e.t, type: 'DEPOSIT', sym: null, units: null, price: null, total: e.amount, realized: null });
    } else if (e.kind === 'BUY') {
      if (e.amount > cash + 1e-9) throw new Error(`replay: ${e.t} BUY ${e.sym} $${e.amount} exceeds unallocated $${cash}`);
      const u = e.amount / e.price;
      const h = hold.get(e.sym) || { units: 0, cb: 0 };
      h.units += u;
      h.cb = r2(h.cb + e.amount);
      hold.set(e.sym, h);
      cash = r2(cash - e.amount);
      ledger.push({ date: e.t, type: 'BUY', sym: e.sym, units: u, price: e.price, total: e.amount, realized: null });
    } else if (e.kind === 'SELL') {
      const h = hold.get(e.sym);
      if (!h) throw new Error(`replay: ${e.t} SELL ${e.sym} with no holding`);
      if (e.units > h.units + 1e-9) throw new Error(`replay: ${e.t} SELL ${e.sym} ${e.units}u exceeds held ${h.units}`);
      const proceeds = r2(e.units * e.price);
      const cbPortion = r2(h.cb * (e.units / h.units));
      const realized = r2(proceeds - cbPortion);
      const full = Math.abs(e.units - h.units) < 1e-9;
      h.units -= e.units;
      h.cb = r2(h.cb - cbPortion);
      if (h.units < 1e-9) hold.delete(e.sym);
      cash = r2(cash + cbPortion);
      assetReturns = r2(assetReturns + realized);
      ledger.push({ date: e.t, type: 'SELL', sym: e.sym, units: e.units, price: e.price, total: proceeds, realized });
      closed.push({ sym: e.sym, date: e.t, units: e.units, cbPortion, proceeds, realized, full });
    } else if (e.kind === 'HYS_TRANSFER_IN') {
      if (e.amount > cash + 1e-9) throw new Error(`replay: ${e.t} pocket $${e.amount} exceeds unallocated $${cash}`);
      cash = r2(cash - e.amount);
      ledger.push({ date: e.t, type: 'HYS_TRANSFER_IN', sym: null, units: null, price: null, total: e.amount, realized: null });
    }
    if (cash < minCash) minCash = cash;
    if (cash < -1e-9) throw new Error(`replay: unallocated went negative (${cash}) at ${e.t}`);
  }

  let heldCB = 0;
  let allocLive = 0;
  const positions = [];
  for (const [sym, h] of hold) {
    const v = r2(h.units * livePrices[sym]);
    positions.push({ sym, units: h.units, cb: r2(h.cb), value: v });
    heldCB = r2(heldCB + h.cb);
    allocLive = r2(allocLive + v);
  }
  positions.sort((a, b) => b.value - a.value);

  return {
    cash: r2(cash), minCash: r2(minCash), assetReturns, heldCB, allocLive,
    unrealised: r2(allocLive - heldCB),
    tpv: r2(cash + allocLive + assetReturns),
    totalReturn: r2(allocLive - heldCB + assetReturns),
    positions, ledger, closed,
  };
}

/* ── snapshots: the WHOLE series is computed and checked before a single row is written ───── */
const mIdx = (s) => { const [y, m] = s.split('-').map(Number); return y * 12 + (m - 1); };

function pathPrice(sym, ms, live, lastMs) {
  const all = [...PRICE_ANCHORS[sym], [lastMs, live[sym]]];
  const t = mIdx(ms);
  if (t <= mIdx(all[0][0])) return all[0][1];
  if (t >= mIdx(all[all.length - 1][0])) return all[all.length - 1][1];
  for (let i = 0; i < all.length - 1; i++) {
    const t0 = mIdx(all[i][0]);
    const t1 = mIdx(all[i + 1][0]);
    if (t >= t0 && t <= t1) {
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return Math.exp(Math.log(all[i][1]) + f * (Math.log(all[i + 1][1]) - Math.log(all[i][1])));
    }
  }
  return all[all.length - 1][1];
}

function buildSnapshots(live, lastMs) {
  const evts = [
    ...DEPOSITS.map((d) => ({ t: d.date, k: 'D', a: d.amount })),
    ...BUYS.map(([t, s, a, p]) => ({ t, k: 'B', s, a, p })),
    ...SELLS.map(([t, s, u, p]) => ({ t, k: 'S', s, u, p })),
    ...POCKETS.map((p) => ({ t: p.open, k: 'P', a: p.amount })),
  ].sort((x, y) => (x.t < y.t ? -1 : 1));

  const rows = [];
  for (let t = mIdx('2021-11'); t <= mIdx(lastMs); t++) {
    const ms = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    const cut = ms + '-01';
    let cash = 0;
    let ar = 0;
    const h = new Map();
    for (const e of evts) {
      if (e.t >= cut) continue;
      if (e.k === 'D') cash = r2(cash + e.a);
      else if (e.k === 'P') cash = r2(cash - e.a);
      else if (e.k === 'B') {
        const g = h.get(e.s) || { u: 0, cb: 0 };
        g.u += e.a / e.p; g.cb = r2(g.cb + e.a); h.set(e.s, g);
        cash = r2(cash - e.a);
      } else {
        const g = h.get(e.s);
        const pr = r2(e.u * e.p);
        const cbp = r2(g.cb * (e.u / g.u));
        g.u -= e.u; g.cb = r2(g.cb - cbp);
        if (g.u < 1e-9) h.delete(e.s);
        cash = r2(cash + cbp);
        ar = r2(ar + r2(pr - cbp));
      }
    }
    let alloc = 0;
    for (const [s, g] of h) alloc += g.u * pathPrice(s, ms, live, lastMs);
    rows.push({ month_start_date: ms + '-01', value_at_anchor: r2(cash + alloc + ar) });
  }
  return rows;
}

export { replay, buildSnapshots, GARY, DEPOSITS, BUYS, SELLS, POCKETS, ADDRESSES, CEILING_VALUE, CEILING_RETURN };

/* ── writers ──────────────────────────────────────────────────────────────────────────────── */
const at = (d, hhmm) => new Date(`${d}T${hhmm || '14:30'}:00.000Z`).toISOString();
const must = (label) => ({ error }) => { if (error) throw new Error(label + ': ' + error.message); };

async function upsertAuthUser(db, password) {
  let page = 1;
  let found = null;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error('listUsers failed: ' + error.message);
    found = (data.users || []).find((u) => (u.email || '').toLowerCase() === GARY.email.toLowerCase()) || null;
    if (found || !data.users || data.users.length < 200) break;
    page++;
  }
  if (found) {
    const { error } = await db.auth.admin.updateUserById(found.id, { password, email_confirm: true });
    if (error) throw new Error('updateUserById failed: ' + error.message);
    console.log(`   auth user REUSED   ${found.id}   (password refreshed from GARY_SEED_PASSWORD)`);
    return found.id;
  }
  // A stack seeded under a different address (the pre-row-256 literal, or another operator's
  // GARY_SEED_EMAIL) must not quietly get a SECOND fixture client. Refuse and say what to set.
  const { data: named } = await db.from('clients').select('id, email').ilike('name', GARY.name);
  if (named && named.length) {
    throw new Error(`a client named "${GARY.name}" already exists under ${named.map((r) => r.email).join(', ')}, not ${GARY.email}. Set GARY_SEED_EMAIL to that address (supabase/functions/.env) so this seed reuses the account instead of creating a second one.`);
  }
  const { data, error } = await db.auth.admin.createUser({ email: GARY.email, password, email_confirm: true });
  if (error) throw new Error('createUser failed: ' + error.message);
  console.log(`   auth user CREATED  ${data.user.id}   (email_confirm:true — no verification mail)`);
  return data.user.id;
}

/* Every per-client table, wiped for THIS uid only. Children before parents. */
async function wipe(db, uid) {
  const { data: convs } = await db.from('conversations').select('id').eq('client_id', uid);
  for (const c of convs || []) await db.from('messages').delete().eq('conversation_id', c.id);
  await db.from('price_alerts').delete().eq('client_id', uid);
  for (const t of ['watchlist_symbols', 'conversations', 'documents', 'allocation_requests',
                   'sell_requests', 'withdrawal_requests', 'hys_deposit_requests',
                   'hys_withdrawal_requests', 'hys_pockets', 'deposit_requests',
                   'portfolio_value_snapshots', 'transactions', 'holdings',
                   'client_profiles', 'account_state']) {
    await db.from(t).delete().eq('client_id', uid);
  }
  await db.from('deposit_address_assignments').delete().eq('client_id', uid);
  await db.from('email_log').delete().eq('recipient', GARY.email);
  console.log('   wiped his previous rows (scoped to client_id — no other client touched)');
}

async function writeEverything(db, uid, R, snaps, bySym) {
  await wipe(db, uid);
  const pid = (sym) => bySym[sym].id;

  must('clients')(await db.from('clients').upsert({
    id: uid, name: GARY.name, email: GARY.email, phone: GARY.phone,
    account_type: GARY.accountType, status: 'active',
    created_at: at(GARY.since, '09:00'), watchlist_seeded_at: at(GARY.since, '09:00'),
  }, { onConflict: 'id' }));

  /* ONLY what genuinely exists server-side. The rest of the onboarding record (DOB,
   * nationality, tax residence, risk profile, source of funds, experience, horizon) has NO
   * column anywhere in this schema and is carried as a document instead. See register row 224:
   * that is a real gap in the platform, not a shortcut taken by this script. */
  must('client_profiles')(await db.from('client_profiles').insert({
    client_id: uid,
    legal_name: { firstName: 'Gary', lastName: 'Sizemore' },
    address: { line1: '8020 Stream Ridge Rd', city: 'Pensacola', state: 'FL', postalCode: '32514', country: 'United States' },
    id_document: { documentType: 'Passport', fileName: 'passport-gary-sizemore.pdf' },
  }));

  /* allocated_capital is written correct so the row is never transiently wrong, but
   * recomputeAllocatedCapital() owns it from the first read onward. */
  must('account_state')(await db.from('account_state').insert({
    client_id: uid, unallocated_capital: R.cash, allocated_capital: R.allocLive, asset_returns: R.assetReturns,
  }));

  must('holdings')(await db.from('holdings').insert(
    R.positions.map((p) => ({ client_id: uid, product_id: pid(p.sym), units: p.units, cost_basis: p.cb }))));

  const txRows = R.ledger.map((l) => ({
    client_id: uid, product_id: l.sym ? pid(l.sym) : null, type: l.type,
    units: l.units, price: l.price, total_value: l.total, realized_return: l.realized,
    status: 'Completed', created_at: at(l.date),
  }));
  const { data: txIns, error: txErr } = await db.from('transactions').insert(txRows).select('id, type, created_at');
  if (txErr) throw new Error('transactions: ' + txErr.message);

  /* deposit addresses are GLOBAL — upserted on (currency, network, address), never deleted,
   * because another client may legitimately share one. */
  const addrIds = {};
  for (const a of ADDRESSES) {
    const { data: ex } = await db.from('deposit_addresses').select('id')
      .eq('currency', a.currency).eq('network', a.network).eq('address', a.address).maybeSingle();
    if (ex) {
      addrIds[a.currency] = ex.id;
      await db.from('deposit_addresses').update({ status: 'assigned' }).eq('id', ex.id);
    } else {
      const { data, error } = await db.from('deposit_addresses')
        .insert({ ...a, status: 'assigned', created_at: at(GARY.since, '09:05') }).select('id').single();
      if (error) throw new Error('deposit_addresses: ' + error.message);
      addrIds[a.currency] = data.id;
    }
    must('deposit_address_assignments')(await db.from('deposit_address_assignments').insert({
      address_id: addrIds[a.currency], client_id: uid, currency: a.currency, network: a.network,
      assigned_at: at(GARY.since, '09:05'),
    }));
  }

  const depTx = txIns.filter((t) => t.type === 'DEPOSIT').sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const depSorted = [...DEPOSITS].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  must('deposit_requests')(await db.from('deposit_requests').insert(depSorted.map((d, i) => ({
    client_id: uid, method: 'crypto', requested_amount: d.amount, currency: d.currency,
    network: d.network, deposit_address_id: addrIds[d.currency],
    details: { currency: d.currency, network: d.network, address: ADDRESSES.find((a) => a.currency === d.currency).address },
    status: 'credited', requested_at: at(d.date, '12:00'), resolved_at: at(d.date, '16:00'),
    credited_amount: d.amount, transaction_id: depTx[i] ? depTx[i].id : null,
    resolved_by_email: 'pm@marketswave.local',
  }))));

  /* One matured, one running. HYS is its own pool: the matured pocket was NOT withdrawn, so it
   * sits at status 'matured' rather than paying out. */
  for (const p of POCKETS) {
    const interest = r2(p.amount * p.rate * (p.months / 12));
    const { data: pk, error } = await db.from('hys_pockets').insert({
      client_id: uid, pocket_type: 'fixed', amount: p.amount, status: p.status,
      term_mode: 'short', term_months: p.months, term_label: `${p.months} months`,
      rate: p.rate, term_in_years: p.months / 12, maturity_date: p.matures,
      projected_interest: interest, funding_method: 'unallocated capital', created_at: at(p.open, '10:00'),
    }).select('id').single();
    if (error) throw new Error('hys_pockets: ' + error.message);
    must('hys_deposit_requests')(await db.from('hys_deposit_requests').insert({
      client_id: uid, pocket_type: 'fixed', term_mode: 'short', term_months: p.months,
      // ★ hys_pockets.rate is a PERCENT (getHysRate: 5, 7, 8.5, 12; high-yield-savings.html
      // renders `${rate}% APR`), never the fraction the interest arithmetic above uses. This seed
      // stored 0.048 until 2026-09-19 (row 251) and both pages read "0.048%".
      term_label: `${p.months} months`, rate: p.rate * 100, term_in_years: p.months / 12,
      requested_amount: p.amount, method: 'internal', currency: 'USD', status: 'credited',
      requested_at: at(p.open, '09:30'), resolved_at: at(p.open, '10:00'),
      credited_amount: p.amount, pocket_id: pk.id, resolved_by_email: 'pm@marketswave.local',
    }));
  }

  /* ★ THE TRAILING PENDING REQUEST MUST BE AFFORDABLE AT THE END STATE, and it was not.
   * This was seeded at $1,500 against an ending unallocated balance of $106.01, so
   * approve-allocation's own re-validation would refuse it forever — a request that can
   * never be approved is not a decidable fixture, and row 228 expected exactly the opposite
   * (Gary's allocation approved THROUGH the gate). The seven hard gates below all check the
   * REPLAYED timeline; none of them looked at the row appended after it. PENDING_ALLOC is
   * sized against the real ending cash and the product's own minimum, and gate 8 now refuses
   * to write if it ever drifts out of range again. */
  const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toISOString();
  must('allocation_requests')(await db.from('allocation_requests').insert({
    client_id: uid, product_id: pid('ETH'), requested_amount: PENDING_ALLOC, status: 'pending', requested_at: twoDaysAgo,
  }));

  /* ★ NO fake document catalogue (2026-09-18). This seed used to insert six `documents`
   * rows -- four "real" documents both directions plus two CARRIERS for data with no column
   * (register row 224) -- but every one of them had NO storage_path, so no bytes existed
   * behind any of them. On the rebuilt Documents page (part 9) that is register row D
   * exactly: a Download button that finds no file, a document that looks real and is not. A
   * demo built on byteless documents is dishonest, so it is removed at the SOURCE rather than
   * the rows, so a re-run cannot restore it. Gary is left with an honest EMPTY Documents page.
   * The two carriers (an Onboarding Record, a Regulatory Levy) went with it; the data they
   * stood in for still has no real home -- onboarding beyond the three persisted fields, and
   * any invoice/fee concept -- which is register row 224, open, not fixed by this seed. If
   * Gary ever needs real demo documents, they must carry real bytes uploaded to Storage
   * (the way the Task B staging proof uploads a real object), not a byteless row. */

  const WATCH = [['BTC', 'Bitcoin', 'crypto', 'bitcoin'], ['NVDA', 'NVIDIA Corporation', 'stock', 'NVDA'],
                 ['TSLA', 'Tesla, Inc.', 'stock', 'TSLA'], ['VGK', 'Vanguard FTSE Europe ETF', 'stock', 'VGK'],
                 ['SOL', 'Solana', 'crypto', 'solana']];
  const { data: wl, error: wErr } = await db.from('watchlist_symbols').insert(
    WATCH.map(([symbol, name, asset_type, provider_id]) => ({
      client_id: uid, symbol, name, asset_type,
      source: asset_type === 'crypto' ? 'coingecko' : 'finnhub',
      provider_id, created_at: at('2024-02-14', '19:00'),
    }))).select('id, symbol');
  if (wErr) throw new Error('watchlist_symbols: ' + wErr.message);
  const wid = (s) => wl.find((w) => w.symbol === s).id;
  must('price_alerts')(await db.from('price_alerts').insert([
    { client_id: uid, watchlist_symbol_id: wid('BTC'), symbol: 'BTC', direction: 'above',
      target_price: 95000, status: 'active', created_at: at('2026-08-02', '07:40') },
    { client_id: uid, watchlist_symbol_id: wid('NVDA'), symbol: 'NVDA', direction: 'above',
      target_price: 200, status: 'fired', created_at: at('2026-05-11', '13:05'),
      fired_at: at('2026-06-18', '14:10'), fired_price: 201.4 },
  ]));

  /* ONE conversation carrying BOTH channels, and deliberately NO ticket.
   *
   * Not two threads: conversations has a PARTIAL unique index on lower(contact_email) WHERE
   * kind <> 'ticket', so a contact gets exactly one non-ticket thread — "one general thread per
   * contact, across channels" (register row 217). That is not a limitation to work around, it
   * IS the model: messages.channel is per-MESSAGE, so one thread genuinely carries an email
   * exchange from 2024 and a chat exchange from 2026. The rail places it by the most recent
   * non-system message's channel, which here is chat.
   *
   * kind stays 'email' because the thread began as an email exchange and owns that subject.
   * It is never 'ticket', so the Tickets view is genuinely empty for this client. */
  const conv = await db.from('conversations').insert({
    client_id: uid, contact_email: GARY.email, contact_name: GARY.name, kind: 'email',
    status: 'resolved', subject: 'Rebalancing after the NVIDIA trim',
    created_at: at('2024-03-18', '09:12'), last_message_at: at('2026-03-04', '15:19'),
    unread_by_pm: false, resolved_at: at('2026-03-04', '15:30'), resolved_by_email: 'pm@marketswave.local',
  }).select('id').single();
  if (conv.error) throw new Error('conversations: ' + conv.error.message);
  const cid = conv.data.id;
  must('messages')(await db.from('messages').insert([
    { conversation_id: cid, channel: 'email', direction: 'inbound', sender_name: GARY.name, sender_email: GARY.email, sent_at: at('2024-03-18', '09:12'),
      body: 'I saw the NVIDIA sale went through. What did you put the proceeds into?' },
    { conversation_id: cid, channel: 'email', direction: 'outbound', sender_name: 'Marketswave', sender_email: 'support@marketswave.net', sent_at: at('2024-03-19', '11:40'),
      body: 'Only the returned capital could be redeployed - the gain sits separately as a realised return rather than as spendable cash. That went into Microsoft on 20 March. Your statement shows both legs.' },
    { conversation_id: cid, channel: 'chat', direction: 'inbound', sender_name: GARY.name, sender_email: GARY.email, sent_at: at('2026-03-04', '15:02'),
      body: 'Quick one - does the savings pocket auto-renew when it matures, or do I need to do something?' },
    { conversation_id: cid, channel: 'chat', direction: 'outbound', sender_name: 'Marketswave', sender_email: 'support@marketswave.net', sent_at: at('2026-03-04', '15:11'),
      body: 'It does not auto-renew. At maturity it stays in your account as a matured pocket and you decide whether to withdraw it or open a new term. Nothing happens automatically.' },
    { conversation_id: cid, channel: 'chat', direction: 'inbound', sender_name: GARY.name, sender_email: GARY.email, sent_at: at('2026-03-04', '15:19'),
      body: 'Perfect, thanks.' },
  ]));

  must('portfolio_value_snapshots')(await db.from('portfolio_value_snapshots').insert(
    snaps.map((s) => ({ client_id: uid, month_start_date: s.month_start_date, value_at_anchor: s.value_at_anchor, created_at: at(s.month_start_date, '00:05') }))));

  /* A RECORD of mail the previous platform sent. This script sends nothing. */
  must('email_log')(await db.from('email_log').insert([
    ...depSorted.map((d) => ({ recipient: GARY.email, subject: 'Your Marketswave deposit has been credited', sent_at: at(d.date, '16:05'), related_entity_type: 'deposit', status: 'sent' })),
    { recipient: GARY.email, subject: 'Your Marketswave application has been approved', sent_at: at(GARY.since, '09:15'), related_entity_type: 'client_application', status: 'sent' },
  ]));

  console.log(`   clients / client_profiles / account_state, ${R.positions.length} holdings, ${txRows.length} transactions`);
  console.log(`   ${ADDRESSES.length} deposit addresses + assignments, ${DEPOSITS.length} credited deposits`);
  console.log(`   ${POCKETS.length} savings pockets, 1 pending allocation request, 0 documents (fake catalogue scrapped — row 224/D)`);
  console.log(`   ${WATCH.length} watchlist symbols (1 armed + 1 fired alert), 1 conversation (2 email + 3 chat messages), 0 tickets`);
  console.log(`   ${snaps.length} portfolio snapshots, ${DEPOSITS.length + 1} email_log records (none sent)`);
}

/* ── main ─────────────────────────────────────────────────────────────────────────────────── */
async function main() {
  const password = readPassword();
  const { url, key } = STAGING ? stagingCreds() : localCreds();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`=== Seeding Gary Sizemore - ${STAGING ? 'REAL CLOUD STAGING' : 'LOCAL STACK'}`);
  console.log(`    ${url}\n`);

  const symbols = [...new Set([...BUYS.map((b) => b[1]), ...SELLS.map((s) => s[1]), 'TSLA'])];
  const { data: prods, error: pErr } = await db.from('products').select('id, ticker, name, unit_price, minimum_investment').in('ticker', symbols);
  if (pErr) throw new Error('products read failed: ' + pErr.message);
  const bySym = Object.fromEntries(prods.map((p) => [String(p.ticker).toUpperCase(), p]));
  const missing = symbols.filter((s) => !bySym[s]);
  if (missing.length) throw new Error('Products missing from the catalog: ' + missing.join(', '));
  const live = Object.fromEntries(prods.map((p) => [String(p.ticker).toUpperCase(), Number(p.unit_price)]));

  const R = replay(live);
  const lastMs = new Date().toISOString().slice(0, 7);
  const snaps = buildSnapshots(live, lastMs);
  const peak = snaps.reduce((m, s) => (s.value_at_anchor > m.value_at_anchor ? s : m), snaps[0]);

  console.log('-- solved against live catalog prices -----------------------------');
  for (const p of R.positions) {
    const d = r2(p.value - p.cb);
    console.log(`   ${p.sym.padEnd(5)} ${p.units.toFixed(8).padStart(13)}  cb ${p.cb.toFixed(2).padStart(9)}  value ${p.value.toFixed(2).padStart(10)}  ${(d >= 0 ? '+' : '') + d.toFixed(2)}`);
  }
  console.log(`   unallocated      $${R.cash.toFixed(2)}   (minimum over the whole timeline $${R.minCash.toFixed(2)})`);
  console.log(`   holdings         $${R.allocLive.toFixed(2)}   cost basis $${R.heldCB.toFixed(2)}`);
  console.log(`   unrealised       $${R.unrealised.toFixed(2)}`);
  console.log(`   realised         $${R.assetReturns.toFixed(2)}`);
  console.log(`   PORTFOLIO VALUE  $${R.tpv.toFixed(2)}   ceiling ${CEILING_VALUE}   headroom ${((1 - R.tpv / CEILING_VALUE) * 100).toFixed(1)}%`);
  console.log(`   TOTAL RETURN     $${R.totalReturn.toFixed(2)}   ceiling ${CEILING_RETURN}   headroom ${((1 - R.totalReturn / CEILING_RETURN) * 100).toFixed(1)}%`);
  console.log(`   snapshots        ${snaps.length} anchors, peak $${peak.value_at_anchor.toFixed(2)} at ${peak.month_start_date} (headroom ${((1 - peak.value_at_anchor / CEILING_VALUE) * 100).toFixed(1)}%)\n`);

  /* HARD GATES. Nothing is written if any of these fail. */
  const fail = [];
  if (R.minCash < 0) fail.push(`unallocated went negative (minimum $${R.minCash})`);
  if (R.tpv > CEILING_VALUE) fail.push(`portfolio value $${R.tpv} exceeds the ${CEILING_VALUE} ceiling`);
  if (R.totalReturn > CEILING_RETURN) fail.push(`total return $${R.totalReturn} exceeds the ${CEILING_RETURN} ceiling`);
  if (peak.value_at_anchor > CEILING_VALUE) fail.push(`snapshot peak $${peak.value_at_anchor} at ${peak.month_start_date} exceeds the ${CEILING_VALUE} ceiling`);
  if (!R.positions.some((p) => p.value < p.cb)) fail.push('no position is at a loss - the red states would not render');
  if (R.closed.filter((c) => c.full).length !== 1) fail.push('expected exactly one full close');
  if (R.closed.filter((c) => !c.full).length !== 2) fail.push('expected exactly two partial sells');
  /* ★ GATE 8 — the trailing pending allocation must be genuinely decidable at the END
   * state, in BOTH directions. Every gate above checks the replayed timeline; this row is
   * appended after it, and it was seeded at $1,500 against $106.01 of ending cash, so
   * approve-allocation would have refused it forever. A fixture whose one pending request
   * can never be approved is not a fixture. */
  // bySym holds the real product ROW; `live` is ticker -> unit_price only, so the minimum
  // must be read from bySym or this check silently degrades to its own fallback.
  const ethMin = Number((bySym.ETH || {}).minimum_investment);
  if (!Number.isFinite(ethMin)) fail.push('ETH carries no minimum_investment — gate 8 cannot be evaluated');
  if (PENDING_ALLOC > R.cash) fail.push(`the pending allocation $${PENDING_ALLOC} exceeds ending unallocated $${R.cash.toFixed(2)} — it could never be approved`);
  if (PENDING_ALLOC < ethMin) fail.push(`the pending allocation $${PENDING_ALLOC} is below ETH's own $${ethMin} minimum — it could never be approved`);
  if (fail.length) {
    console.error('REFUSING TO WRITE - the solved history breaches a constraint:');
    fail.forEach((f) => console.error('   x ' + f));
    process.exit(1);
  }
  console.log('   every ceiling and shape gate passed - writing\n');

  const uid = await upsertAuthUser(db, password);
  await writeEverything(db, uid, R, snaps, bySym);

  console.log(`\n=== DONE. ${GARY.email} can sign in at ${STAGING ? 'https://marketswave.net/login.html' : 'http://127.0.0.1:8765/login.html'}`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('seed-client-gary.mjs')) {
  main().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
}
