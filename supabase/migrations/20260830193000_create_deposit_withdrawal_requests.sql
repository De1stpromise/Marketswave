-- Backend Migration Phase B — Stage 2 (Aug 30, 2026): Deposits and Withdrawals move to real
-- Supabase tables + Edge Functions. Local stack only, same discipline as Stage 1 — nothing
-- here touches the real cloud "Marketswave Staging" project. Read engine-core.js's actual
-- requestDeposit()/creditDepositRequest()/rejectDepositRequest()/requestWithdrawal()/
-- approveWithdrawal()/rejectWithdrawal() in full before writing this file (they were), not
-- reinvented — table/column/constraint choices below mirror that source's real field shapes.
--
-- ---- Table-by-table mapping to the real local engine ------------------------------------
--   deposit_requests    <- DEPOSIT_REQUESTS_KEY (marketswave_deposit_requests), scoped per client
--   withdrawal_requests <- WITHDRAWAL_REQUESTS_KEY (marketswave_withdrawal_requests), scoped per client
--
-- ---- ID generation — same infrastructure adaptation already made in Stage 1's own portfolio
-- tables migration, not a business-rule change: the local engine's nextSequentialId()
-- (DEP-XXXX/WITHDRAW-XXXX, scan-and-increment) is safe only for a single-threaded,
-- one-client-at-a-time localStorage store, not real concurrent server-side writers.
-- gen_random_uuid() is used here for the same reason holdings.id/transactions.id already are.
--
-- ---- transaction_id references public.transactions(id) directly — both credit-deposit and
-- approve-withdrawal create a real transactions row (DEPOSIT/WITHDRAWAL, already valid types
-- per Stage 1's own transactions.type CHECK constraint, which explicitly named both "for
-- forward compatibility with the Approval Gate queues own future Phase B migration" — this
-- IS that migration) and link it back onto the resolved request, mirroring
-- creditDepositRequest()/approveWithdrawal()'s own request.transactionId field exactly.
--
-- ---- Zero-balance default on a missing account_state row — a faithful port, not a new
-- behavior: engine-core.js's readAccountStateForClient() never throws "not found" for a
-- client with no stored account state, it defaults to { unallocatedCapital: 0,
-- allocatedCapital: 0, assetReturns: 0 } and writeAccountStateForClient() always upserts
-- (localStorage.setItem creates-or-overwrites unconditionally). The credit-deposit /
-- request-withdrawal / approve-withdrawal Edge Functions below reproduce this exactly via
-- .upsert() rather than requiring a pre-existing account_state row — this is what the real
-- local engine already does, not a new leniency invented for this port.

-- ============================================================================
-- deposit_requests — per-client. `details` is a generic jsonb object, matching
-- requestDeposit(method, amount, currency, details)'s own already-generic shape — the real
-- local caller (deploy-capital.html) puts different real fields in it per method (crypto:
-- { asset, network }; bank: { accountHolderName, senderAddress, phone, email, bankName,
-- accountNumber, branchAddress, routingNumber, swift, notes }) and admin-deposits.html
-- already renders it generically (humanizeKey()/detailsHTML()) for exactly this reason — no
-- schema-level shape to lock in here either.
-- ============================================================================
create table public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  method text not null check (method in ('crypto', 'bank')),
  requested_amount numeric not null check (requested_amount > 0),
  currency text not null,
  details jsonb,
  status text not null default 'pending' check (status in ('pending', 'credited', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  credited_amount numeric,
  transaction_id uuid references public.transactions(id),
  reason text
);

alter table public.deposit_requests enable row level security;

create index deposit_requests_client_id_idx on public.deposit_requests (client_id);

-- ============================================================================
-- withdrawal_requests — per-client. `destination_details` mirrors requestWithdrawal()'s own
-- destinationDetails shape exactly the same generic-jsonb way as deposit_requests.details
-- (crypto: { asset, network, walletAddress }; bank: { accountHolderName, bankName,
-- accountNumber, branchAddress, routingNumber, swift }). Status uses 'approved' (not
-- 'credited') as its resolved-success value, matching approveWithdrawal()'s own
-- request.status = 'approved' literally — deposits and withdrawals use different verbs for
-- the same "resolved successfully" outcome in the real local engine, not an inconsistency to
-- paper over here.
-- ============================================================================
create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  method text not null check (method in ('crypto', 'bank')),
  requested_amount numeric not null check (requested_amount > 0),
  currency text not null,
  destination_details jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  approved_amount numeric,
  transaction_id uuid references public.transactions(id),
  reason text
);

alter table public.withdrawal_requests enable row level security;

create index withdrawal_requests_client_id_idx on public.withdrawal_requests (client_id);

-- ============================================================================
-- RLS — per instruction: "a client can INSERT their own pending request (client_id must
-- match their own auth uid) and SELECT their own requests. No client-side UPDATE/DELETE on
-- either table, for any role" — mirrors Stage 1's own `clients` table INSERT-forces-a-
-- specific-status pattern (status forced to literally 'pending' here, exactly like `clients`
-- forces 'pending_review') and every portfolio table's own self-or-admin SELECT pattern
-- (public.is_admin(), defined in Stage 1's clients/admin-roles migration), for consistency
-- with every other table in this schema rather than a narrower "self only" read — admin
-- queue pages need to list every client's pending requests the same way
-- getAllClientDepositRequests()/getAllClientWithdrawalRequests() already do locally. No
-- UPDATE/DELETE policy exists for `authenticated`/`anon` on either table, so both are denied
-- by default for every client-side caller, admin-claimed or not — resolving a request
-- (credit/approve/reject) is reserved exclusively for service_role, via the
-- credit-deposit/approve-withdrawal/reject-deposit/reject-withdrawal Edge Functions.
-- ============================================================================

create policy "clients can insert their own pending deposit request"
  on public.deposit_requests
  for insert
  to authenticated
  with check (auth.uid() = client_id and status = 'pending');

create policy "clients can view their own deposit requests; admins can view all"
  on public.deposit_requests
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

create policy "clients can insert their own pending withdrawal request"
  on public.withdrawal_requests
  for insert
  to authenticated
  with check (auth.uid() = client_id and status = 'pending');

create policy "clients can view their own withdrawal requests; admins can view all"
  on public.withdrawal_requests
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());
