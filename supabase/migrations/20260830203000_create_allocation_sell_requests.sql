-- Backend Migration Phase B — Stage 3 (Aug 30, 2026): Allocations and Sells move to real
-- Supabase tables + Edge Functions. Local stack only, real cloud "Marketswave Staging"
-- untouched. Read engine-core.js's actual requestAllocation()/approveAllocationRequest()/
-- rejectAllocationRequest()/requestSell()/approveSellRequest()/rejectSellRequest() in full
-- before writing this file (they were), not reinvented.
--
-- ---- Table-by-table mapping to the real local engine ------------------------------------
--   allocation_requests <- REQUESTS_KEY (marketswave_allocation_requests), scoped per client
--   sell_requests       <- SELL_REQUESTS_KEY (marketswave_sell_requests), scoped per client
--
-- ---- MEANINGFULLY DIFFERENT FROM STAGE 2, flagged per instruction: these two queues don't
-- stand alone — they resolve INTO Stage 1's already-built execute-buy/execute-sell
-- functions rather than directly mutating account_state/holdings themselves. Neither table
-- carries a PM-editable-amount column (no `confirmed_amount`/`approved_units`, unlike
-- deposit_requests.credited_amount / withdrawal_requests.approved_amount) — this is a
-- faithful reflection of the real local engine, not an omission: approveAllocationRequest()
-- and approveSellRequest() both execute the EXACT requested_amount/units_to_sell, with no PM
-- edit step, unlike creditDepositRequest()/approveWithdrawal()'s own PM-editable design.
--
-- ---- product_id references public.products(id) directly, same as holdings/transactions in
-- Stage 1's own migration — every allocation/sell always concerns exactly one real product,
-- unlike deposit/withdrawal requests which have none.
--
-- ---- ID generation — same gen_random_uuid() infrastructure adaptation already used for
-- every other real table in this schema, not a business-rule change.
--
-- ---- Zero-balance/zero-holdings default on a missing account_state/holdings row — same
-- faithful-port discipline established in Stage 2's own migration: readAccountStateForClient()
-- defaults to unallocatedCapital: 0 rather than throwing, and a missing holdings row is
-- read as "no holding, 0 units" by the real local requestSell()/approveSellRequest() (a plain
-- Array.find() returning undefined). request-allocation/request-sell (below) reproduce this
-- exactly via a plain SELECT with a zero/no-holding default, never requiring a pre-existing
-- row — by construction this means a client with no account_state row can never successfully
-- create an allocation request (amount must be both > 0 and <= 0), and a client with no
-- holdings row for a product can never successfully create a sell request against it.

-- ============================================================================
-- allocation_requests — per-client.
-- ============================================================================
create table public.allocation_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id),
  requested_amount numeric not null check (requested_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  transaction_id uuid references public.transactions(id),
  reason text
);

alter table public.allocation_requests enable row level security;

create index allocation_requests_client_id_idx on public.allocation_requests (client_id);

-- ============================================================================
-- sell_requests — per-client.
-- ============================================================================
create table public.sell_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id),
  units_to_sell numeric not null check (units_to_sell > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  transaction_id uuid references public.transactions(id),
  reason text
);

alter table public.sell_requests enable row level security;

create index sell_requests_client_id_idx on public.sell_requests (client_id);

-- ============================================================================
-- RLS — identical shape to Stage 2's deposit_requests/withdrawal_requests, reused
-- deliberately rather than redesigned, per instruction: a client may INSERT their own row
-- forced to status='pending', and SELECT their own rows; admins can SELECT all
-- (public.is_admin()); no UPDATE/DELETE policy exists for authenticated/anon on either
-- table — resolving a request (approve/reject) is reserved exclusively for service_role, via
-- the approve-allocation/approve-sell/reject-allocation/reject-sell Edge Functions.
-- ============================================================================

create policy "clients can insert their own pending allocation request"
  on public.allocation_requests
  for insert
  to authenticated
  with check (auth.uid() = client_id and status = 'pending');

create policy "clients can view their own allocation requests; admins can view all"
  on public.allocation_requests
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

create policy "clients can insert their own pending sell request"
  on public.sell_requests
  for insert
  to authenticated
  with check (auth.uid() = client_id and status = 'pending');

create policy "clients can view their own sell requests; admins can view all"
  on public.sell_requests
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());
