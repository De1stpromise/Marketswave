-- Backend Migration Phase B — Stage 1 (Aug 30, 2026): the portfolio engine's financial core
-- moves to real Supabase tables — Product Catalog, Account State, Holdings, and the
-- Transaction ledger. The highest-risk category of work in this migration project: this
-- touches real money figures directly. Read engine-core.js's actual implementation in full
-- before writing this file (buildSeedData(), settleProduct()/settleAllProducts(),
-- executeBuy()/executeSell(), getAccountState()/getHoldings()/getTransactionLedger()/
-- getTotalPortfolioValue()) — every table/column/constraint below mirrors that source exactly,
-- not reinvented. Local stack only this stage, per instruction — nothing here touches the
-- real cloud "Marketswave Staging" project.
--
-- ---- A genuinely necessary addition beyond the task's own literal 3-table list, flagged
-- per instruction rather than silently added: `products` (the Product Catalog) and
-- `advisory_fee_rate`. Neither was named in the task's own schema list, but both are hard
-- dependencies of the 3 named tables and the engine functions being ported — holdings.
-- product_id and transactions.product_id have to reference something real, and
-- executeBuy()/executeSell() cannot settle a current unit price without a real products
-- table to settle against. `advisory_fee_rate` is called out explicitly in the task's own
-- account_state bullet ("should be a SEPARATE global table... don't regress that") — this
-- migration honors that instruction literally by giving it its own table, not a column on
-- account_state.
--
-- ---- Table-by-table mapping to the real local engine, so the port is traceable line by line:
--   products         <- CATALOG_KEY (global/unscoped, exactly like Stage 1's own `clients`
--                        table design decision)
--   advisory_fee_rate <- ADVISORY_FEE_RATE_KEY (global/unscoped, singleton row)
--   account_state    <- ACCOUNT_KEY, scoped per client (engine-core.js's own
--                        `accountState` shape: unallocatedCapital/allocatedCapital/
--                        assetReturns — advisoryFeeRate deliberately NOT part of this shape,
--                        per that key's own Aug 27, 2026 fix history)
--   holdings         <- HOLDINGS_KEY, scoped per client (units + costBasis per product)
--   transactions     <- TRANSACTIONS_KEY, scoped per client (the ledger)
--
-- ---- ID generation, one deliberate implementation-level adaptation, NOT a business-rule
-- change — reported per instruction: the local engine's nextSequentialId() (scan-array-and-
-- increment, e.g. TXN-0001) is safe only for a single-threaded, one-client-at-a-time
-- localStorage store. It is NOT safe under real concurrent server-side writes (two
-- simultaneous inserts could both compute the same "next" number). holdings.id and
-- transactions.id use Postgres-native `gen_random_uuid()` instead — a real infrastructure
-- adaptation required by going server-side, not a reinterpretation of any financial business
-- rule (the actual money math — unit pricing, cost basis, realized returns — is ported
-- verbatim). `products.id` keeps the human-readable PROD-XXXX scheme from SEED_PRODUCTS,
-- since the product catalog is seeded once, deliberately, not created under concurrent
-- write pressure the way transactions/holdings are.

-- ============================================================================
-- products — the global Product Catalog, global/unscoped exactly like Stage 1's own
-- `clients` table decision (shared across every client, not per-client-scoped).
-- ============================================================================
create table public.products (
  id text primary key,
  name text not null,
  asset_class text not null check (asset_class in ('Private Equity', 'Real Assets', 'Stocks & ETFs', 'Crypto', 'Unallocated / Cash')),
  investment_type text not null,
  risk_tier text not null check (risk_tier in ('conservative', 'balanced', 'aggressive')),
  minimum_investment numeric not null default 0 check (minimum_investment >= 0),
  unit_price numeric not null check (unit_price > 0),
  inception_unit_price numeric not null check (inception_unit_price > 0),
  created_at date not null default current_date,
  last_tick_date date not null default current_date
);

alter table public.products enable row level security;

-- Every authenticated client may browse the full catalog — mirrors asset-collection.html's
-- own local behavior (every client sees every product, Cash included at the data layer,
-- excluded only at the UI layer). No INSERT/UPDATE/DELETE policy for authenticated/anon —
-- product management (admin-products.html's own local equivalent) stays service_role-only,
-- out of this stage's own scope (the task named account_state/holdings/transactions, not
-- product management UI).
create policy "authenticated can view the product catalog"
  on public.products
  for select
  to authenticated
  using (true);

-- ============================================================================
-- advisory_fee_rate — genuinely global, singleton-row config table. Mirrors the real fix
-- already made once on the local side (Aug 27, 2026): the rate is platform policy, not
-- per-client data — this table's very existence, separate from account_state, is that fix
-- carried forward into the real schema, per the task's own explicit instruction not to
-- regress it. Singleton enforced by a boolean primary key constrained to literally `true` —
-- a second row is structurally impossible, not just conventionally avoided.
-- ============================================================================
create table public.advisory_fee_rate (
  id boolean primary key default true,
  rate numeric not null check (rate > 0),
  updated_at timestamptz not null default now(),
  constraint advisory_fee_rate_is_singleton check (id)
);

alter table public.advisory_fee_rate enable row level security;

create policy "authenticated can view the advisory fee rate"
  on public.advisory_fee_rate
  for select
  to authenticated
  using (true);

-- ============================================================================
-- account_state — per-client, mirrors ACCOUNT_KEY's real shape exactly:
-- unallocatedCapital/allocatedCapital/assetReturns. advisoryFeeRate deliberately absent —
-- see advisory_fee_rate above.
-- ============================================================================
create table public.account_state (
  client_id uuid primary key references auth.users(id) on delete cascade,
  unallocated_capital numeric not null default 0,
  allocated_capital numeric not null default 0,
  asset_returns numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.account_state enable row level security;

-- ============================================================================
-- holdings — per-client, one row per (client, product) pair, mirrors HOLDINGS_KEY's real
-- shape: units + costBasis. UNIQUE(client_id, product_id) mirrors executeBuy()'s own
-- find-or-merge-into-existing-holding behavior — a client can only ever have ONE holding
-- row per product, exactly like the local engine's own array-with-one-entry-per-product
-- invariant.
-- ============================================================================
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id),
  units numeric not null check (units > 0),
  cost_basis numeric not null check (cost_basis >= 0),
  unique (client_id, product_id)
);

alter table public.holdings enable row level security;

create index holdings_client_id_idx on public.holdings (client_id);

-- ============================================================================
-- transactions — per-client, mirrors TRANSACTIONS_KEY's real shape: the ledger.
-- product_id is nullable (task's own instruction) for DEPOSIT/WITHDRAWAL types, which have
-- no associated product — mirrors DEPOSIT/WITHDRAWAL transactions already produced by the
-- (still-local, not-yet-migrated) Approval Gate queues. This stage's own Edge Functions
-- (execute-buy/execute-sell) only ever produce BUY/SELL rows; DEPOSIT/WITHDRAWAL are
-- included in the CHECK constraint for forward compatibility with the Approval Gate queues'
-- own future Phase B migration, not because this stage's own functions create them.
-- ============================================================================
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  product_id text references public.products(id),
  type text not null check (type in ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL')),
  units numeric,
  price numeric,
  total_value numeric not null,
  realized_return numeric,
  status text not null default 'Completed',
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

create index transactions_client_id_idx on public.transactions (client_id);
create index transactions_client_id_created_at_idx on public.transactions (client_id, created_at desc);

-- ============================================================================
-- RLS — the core security property, per instruction: "a client can SELECT only their own
-- rows across all three tables. NO client-side INSERT/UPDATE/DELETE path exists on any of
-- these tables for any role, including admin — every write must go through a
-- service-role-authenticated Edge Function." Mirrors Stage 1's own `clients` table pattern
-- exactly (self-or-admin SELECT via the same public.is_admin() helper that migration
-- already defined; no write policy of any kind for `authenticated`/`anon`, on any of the 3
-- tables, so both operations are denied by default). service_role bypasses RLS entirely by
-- design — that's the ONLY path the execute-buy/execute-sell Edge Functions use to write.
-- ============================================================================

create policy "clients can view their own account state; admins can view all"
  on public.account_state
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

create policy "clients can view their own holdings; admins can view all"
  on public.holdings
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

create policy "clients can view their own transactions; admins can view all"
  on public.transactions
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

-- No INSERT/UPDATE/DELETE policy exists anywhere above, for any table, for `authenticated`
-- or `anon` — with RLS enabled and no matching policy, every write operation is denied by
-- default for every client-side caller, admin-claimed or not. This is deliberate and
-- unconditional: resolving a buy/sell (or, in a future Approval Gate migration, a deposit/
-- withdrawal) is reserved exclusively for service_role, via the execute-buy/execute-sell
-- Edge Functions this migration's own companion functions implement.
