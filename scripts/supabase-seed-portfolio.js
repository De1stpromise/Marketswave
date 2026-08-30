#!/usr/bin/env node
// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Seeds the local Supabase stack with data matching engine-core.js's own buildSeedData() —
// same starting products, same starting holdings — so local testing of the new Edge
// Functions has a consistent, familiar baseline. Ported verbatim from buildSeedData()'s own
// math (SEED_PRODUCTS, unit price computation, cost basis computation, unallocatedCapital
// derivation) — read that function directly before writing this, not reinvented.
//
// Creates (or reuses) a demo Supabase Auth user to own the seeded account_state/holdings —
// mirrors CLIENT-0001's persona (demo/portfolio-owner), but this is a genuinely separate
// identity from the local engine's own CLIENT-0001 (a different backend, a different uid
// scheme entirely) — do not conflate the two.
//
// LOCAL STACK ONLY. Reads connection details from `supabase status -o json`, same technique
// and localhost-only guard as every other local-stack script in this project.
//
// Usage:  node scripts/supabase-seed-portfolio.js
// Requires the local Supabase stack running (`supabase start`) with Stage 1's and this
// stage's migrations already applied (`supabase migration up --local`).

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const DEMO_EMAIL = 'demo-portfolio@marketswave.local';
const DEMO_PASSWORD = 'DemoPortfolio-Local-2026!';

// ---- Ported verbatim from engine-core.js's SEED_PRODUCTS ---------------------------------
const SEED_PRODUCTS = [
  {
    name: 'Nordic Growth Fund', assetClass: 'Private Equity', investmentType: 'Growth Fund',
    riskTier: 'aggressive', minimumInvestment: 25000, inceptionUnitPrice: 100.00,
    seedReturnPct: 0.184, seedAllocatedValue: 410000, createdAt: '2026-01-15'
  },
  {
    name: 'European Real Estate Trust', assetClass: 'Real Assets', investmentType: 'REIT',
    riskTier: 'conservative', minimumInvestment: 10000, inceptionUnitPrice: 100.00,
    seedReturnPct: 0.092, seedAllocatedValue: 282000, createdAt: '2026-01-15'
  },
  {
    name: 'Global Equity ETF', assetClass: 'Stocks & ETFs', investmentType: 'ETF',
    riskTier: 'balanced', minimumInvestment: 1000, inceptionUnitPrice: 100.00,
    seedReturnPct: 0.118, seedAllocatedValue: 230000, createdAt: '2026-01-15'
  },
  {
    name: 'Ethereum', assetClass: 'Crypto', investmentType: 'Digital Asset',
    riskTier: 'aggressive', minimumInvestment: 100, inceptionUnitPrice: 100.00,
    seedReturnPct: 0.091, seedAllocatedValue: 156980, createdAt: '2026-02-01'
  },
  {
    name: 'Cash', assetClass: 'Unallocated / Cash', investmentType: 'Cash',
    riskTier: 'conservative', minimumInvestment: 0, inceptionUnitPrice: 1.00,
    seedReturnPct: 0, seedAllocatedValue: null, createdAt: '2026-01-01'
  }
];

const DASHBOARD_TOTAL_PORTFOLIO_VALUE_SEED = 1284500;
const DEFAULT_ADVISORY_FEE_RATE = 1.25;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function todayStrUTC() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function main() {
  console.log('Seeding the local Supabase stack\'s portfolio engine tables...');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // ---- Product Catalog (global) — idempotent upsert, exact math from buildSeedData() -----
  const seedTickDate = todayStrUTC();
  const catalog = [];
  const holdingsToSeed = [];

  SEED_PRODUCTS.forEach((seed, index) => {
    const id = 'PROD-' + String(index + 1).padStart(4, '0');
    const unitPrice = round2(seed.inceptionUnitPrice * (1 + seed.seedReturnPct));
    catalog.push({
      id: id,
      name: seed.name,
      asset_class: seed.assetClass,
      investment_type: seed.investmentType,
      risk_tier: seed.riskTier,
      minimum_investment: seed.minimumInvestment,
      unit_price: unitPrice,
      inception_unit_price: seed.inceptionUnitPrice,
      created_at: seed.createdAt,
      last_tick_date: seedTickDate
    });
    if (seed.seedAllocatedValue !== null) {
      const units = seed.seedAllocatedValue / unitPrice;
      const costBasis = round2(units * seed.inceptionUnitPrice);
      holdingsToSeed.push({ productId: id, units: units, costBasis: costBasis });
    }
  });

  const { error: catalogErr } = await admin.from('products').upsert(catalog, { onConflict: 'id' });
  if (catalogErr) throw new Error('Failed to seed products: ' + catalogErr.message);
  console.log('Seeded ' + catalog.length + ' products.');

  // ---- Advisory fee rate (global singleton) ------------------------------------------------
  const { error: feeErr } = await admin.from('advisory_fee_rate').upsert({ id: true, rate: DEFAULT_ADVISORY_FEE_RATE }, { onConflict: 'id' });
  if (feeErr) throw new Error('Failed to seed advisory_fee_rate: ' + feeErr.message);
  console.log('Seeded advisory_fee_rate: ' + DEFAULT_ADVISORY_FEE_RATE + '%.');

  // ---- Demo client (find-or-create) --------------------------------------------------------
  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw new Error('listUsers() failed: ' + listErr.message);
  let demoUser = listData.users.find((u) => u.email === DEMO_EMAIL);
  if (demoUser) {
    console.log('Found existing demo client: ' + demoUser.id + ' (' + DEMO_EMAIL + ')');
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true
    });
    if (createErr) throw new Error('createUser() failed: ' + createErr.message);
    demoUser = created.user;
    console.log('Created new demo client: ' + demoUser.id + ' (' + DEMO_EMAIL + ')');
  }

  // ---- Account state + holdings for the demo client, exact math from buildSeedData() ------
  const allocatedCapital = round2(holdingsToSeed.reduce((sum, h) => {
    const product = catalog.find((p) => p.id === h.productId);
    return sum + h.units * product.unit_price;
  }, 0));
  const unallocatedCapital = round2(DASHBOARD_TOTAL_PORTFOLIO_VALUE_SEED - allocatedCapital);

  const { error: accountErr } = await admin.from('account_state').upsert({
    client_id: demoUser.id,
    unallocated_capital: unallocatedCapital,
    allocated_capital: allocatedCapital,
    asset_returns: 0
  }, { onConflict: 'client_id' });
  if (accountErr) throw new Error('Failed to seed account_state: ' + accountErr.message);

  // Clear any pre-existing holdings for this client first (idempotent re-seed), then insert fresh.
  await admin.from('holdings').delete().eq('client_id', demoUser.id);
  const holdingsRows = holdingsToSeed.map((h) => ({
    client_id: demoUser.id, product_id: h.productId, units: h.units, cost_basis: h.costBasis
  }));
  const { error: holdingsErr } = await admin.from('holdings').insert(holdingsRows);
  if (holdingsErr) throw new Error('Failed to seed holdings: ' + holdingsErr.message);

  console.log('Seeded account_state for ' + demoUser.id + ': unallocated=$' + unallocatedCapital + ', allocated=$' + allocatedCapital);
  console.log('Seeded ' + holdingsRows.length + ' holdings.');
  console.log('');
  console.log('Demo client credentials: ' + DEMO_EMAIL + ' / ' + DEMO_PASSWORD);
  console.log('Demo client uid: ' + demoUser.id);
  console.log('');
  console.log('Seed complete. Total Portfolio Value = $' + round2(unallocatedCapital + allocatedCapital) + ' (matches DASHBOARD_TOTAL_PORTFOLIO_VALUE_SEED = $' + DASHBOARD_TOTAL_PORTFOLIO_VALUE_SEED + ').');
}

main().catch((err) => {
  console.error('');
  console.error('Seed FAILED: ' + (err && err.message ? err.message : err));
  console.error('Most likely cause: the local Supabase stack is not running, or this migration has not been applied yet.');
  process.exit(1);
});
