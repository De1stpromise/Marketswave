-- Backend Migration Phase B — Stage 4 (Aug 30, 2026 line of work, applied 2026-09-02): HYS
-- pockets + the HYS Deposit Approval Queue move to real Supabase tables + Edge Functions.
-- Local stack only, same discipline as every prior stage — nothing here touches the real
-- cloud "Marketswave Staging" project. Read engine-core.js's real requestHYSDeposit()/
-- creditHYSDeposit()/rejectHYSDeposit()/getHYSRate()/computeHYSWithdrawalAmount()/
-- requestHYSWithdrawal()/approveHYSWithdrawal()/rejectHYSWithdrawal() in full before writing
-- this file (they were), not reinvented — table/column/constraint choices below mirror that
-- source's real field shapes.
--
-- ---- A genuinely necessary addition beyond the task's own literal 2-table list, flagged per
-- instruction rather than silently added: `hys_withdrawal_requests`. The task's own SCHEMA
-- section named only hys_pockets/hys_deposit_requests, but its EDGE FUNCTIONS section
-- explicitly asks for request-hys-withdrawal/approve-hys-withdrawal/reject-hys-withdrawal,
-- which have nowhere to persist a pending withdrawal request without their own table —
-- mirrors Stage 1's own precedent of flagging `products`/`advisory_fee_rate` as necessary,
-- unnamed dependencies rather than building silently around the gap.
--
-- ---- Field-value fidelity, called out because the task's own paraphrase differs from the
-- real engine: the task's SCHEMA bullet describes pocket_type as
-- "fixed_deposit|as_you_want", but the real engine-core.js source stores exactly 'fixed' and
-- 'ayw' (see requestHYSDeposit()'s own `pocketType !== 'fixed' && pocketType !== 'ayw'` check
-- and every pocket object's own `type: pocketType`). This migration uses the REAL stored
-- values ('fixed'/'ayw'), not the task's descriptive paraphrase, per the standing "read the
-- real source, don't reinvent" discipline every prior stage has followed. Likewise the real
-- engine keeps termMonths/termYears as two separate nullable fields (only one populated
-- depending on termMode), not one generic "term_value" — mirrored here as term_months/
-- term_years rather than collapsing to the task's single-field paraphrase.
--
-- ---- ID generation — same infrastructure adaptation already made in every prior Stage 1-3
-- table, not a business-rule change: the local engine's own pocket id scheme
-- ('pocket_' + Date.now() + random suffix) and nextSequentialId() (HYSDEP-XXXX/HYSWD-XXXX)
-- are both safe only for a single-threaded, one-client-at-a-time localStorage store, not real
-- concurrent server-side writers. gen_random_uuid() is used here for the same reason
-- holdings.id/transactions.id already are.
--
-- ---- pocket_id/transaction_id references — hys_deposit_requests.pocket_id references
-- public.hys_pockets(id) directly (mirrors request.pocketId being set once credit-hys-deposit
-- actually creates the pocket); both hys_deposit_requests.transaction_id and
-- hys_withdrawal_requests.transaction_id reference public.transactions(id) directly, mirroring
-- Stage 2's own transaction_id linkage pattern exactly — HYS_DEPOSIT/HYS_WITHDRAWAL are added
-- to transactions.type's CHECK constraint below (widening Stage 1's own original list) for
-- the same "forward compatibility, this IS that migration" reasoning Stage 2's own comment
-- already used for DEPOSIT/WITHDRAWAL.
--
-- ---- HYS deliberately never touches account_state — a faithful port, not an omission: the
-- real local creditHYSDeposit()/approveHYSWithdrawal() both explicitly document "HYS is its
-- own pool... never touching unallocatedCapital/allocatedCapital" (funded/paid out
-- externally, by design) — neither Edge Function below writes to account_state at all.
--
-- ---- A third pocket status, 'matured', found by reading high-yield-savings.html's own
-- client-side updatePocketStatuses() (not engine-core.js) before writing this file: a fixed
-- pocket still 'active' whose maturity_date has passed is transitioned client-side to
-- 'matured' and persisted directly to the local pockets store — a real, if disclosed, gap in
-- the local architecture (nothing in engine-core.js itself ever performs this transition;
-- only that one page's own render loop does, and only when a client actually loads that page
-- after maturity). computeHYSWithdrawalAmount()/requestHYSWithdrawal() both key their
-- forfeiture logic off `pocket.status === 'active'` specifically (not "matured OR withdrawn"),
-- so a matured pocket correctly stops forfeiting interest the moment its status is 'matured' —
-- ported faithfully into hys_pockets.status's own CHECK constraint below rather than silently
-- narrowed to the two statuses this stage's own SCHEMA bullet named. No Edge Function in this
-- stage performs the active->matured transition itself (there is no client-facing HYS UI
-- wired to Supabase yet to port that page-load-time behavior from) — this is the same
-- "schema + Edge Functions + Node verification only, no UI wiring yet" scope every other Stage
-- 3/4 table has shipped with, not a regression introduced here.

-- Widen transactions.type to include the two HYS transaction types this stage's own
-- credit-hys-deposit/approve-hys-withdrawal functions create — mirrors HYS_DEPOSIT/
-- HYS_WITHDRAWAL, the real local engine's own distinct transaction types (kept separate from
-- DEPOSIT/WITHDRAWAL so HYS activity stays visually distinguishable in the ledger, exactly as
-- it already is in every client-facing/admin rendering of the local engine's own ledger).
alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'HYS_DEPOSIT', 'HYS_WITHDRAWAL'));

-- ============================================================================
-- hys_pockets — per-client. Created ONLY by credit-hys-deposit (service_role) — a client
-- never inserts their own pocket row directly, mirroring the real local engine exactly
-- (creditHYSDeposit() is the sole writer of marketswave_hys_pockets in the whole codebase
-- other than approveHYSWithdrawal()'s own status/withdrawn-field update on an existing row).
-- ============================================================================
create table public.hys_pockets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  pocket_type text not null check (pocket_type in ('fixed', 'ayw')),
  amount numeric not null check (amount > 0),
  status text not null default 'active' check (status in ('active', 'matured', 'withdrawn')),
  term_mode text check (term_mode in ('short', 'locked')),
  term_months integer,
  term_years integer,
  term_label text,
  rate numeric,
  term_in_years numeric,
  maturity_date timestamptz,
  projected_interest numeric not null default 0,
  funding_method text not null check (funding_method in ('crypto wallet', 'bank account')),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_amount numeric,
  withdrawal_method text check (withdrawal_method in ('crypto wallet', 'bank account'))
);

alter table public.hys_pockets enable row level security;

create index hys_pockets_client_id_idx on public.hys_pockets (client_id);

-- ============================================================================
-- hys_deposit_requests — per-client. `details` is a generic jsonb object, matching
-- requestHYSDeposit(pocketType, term, amount, method, details)'s own already-generic shape —
-- same reasoning as deposit_requests.details in Stage 2 (crypto/bank populate different real
-- keys; admin-hys.html already renders it generically for exactly this reason).
-- ============================================================================
create table public.hys_deposit_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  pocket_type text not null check (pocket_type in ('fixed', 'ayw')),
  term_mode text check (term_mode in ('short', 'locked')),
  term_months integer,
  term_years integer,
  term_label text,
  rate numeric,
  term_in_years numeric,
  requested_amount numeric not null check (requested_amount > 0),
  method text not null check (method in ('crypto', 'bank')),
  currency text not null,
  details jsonb,
  status text not null default 'pending' check (status in ('pending', 'credited', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  credited_amount numeric,
  pocket_id uuid references public.hys_pockets(id),
  transaction_id uuid references public.transactions(id),
  reason text
);

alter table public.hys_deposit_requests enable row level security;

create index hys_deposit_requests_client_id_idx on public.hys_deposit_requests (client_id);

-- ============================================================================
-- hys_withdrawal_requests — per-client. A genuinely necessary addition beyond the task's own
-- literal 2-table SCHEMA list — see this file's own header for why. `destination_details`
-- mirrors requestHYSWithdrawal()'s own destinationDetails shape, the same generic-jsonb
-- pattern as every other *_details/destination_details column in this schema.
-- ============================================================================
create table public.hys_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  pocket_id uuid not null references public.hys_pockets(id),
  pocket_type text not null check (pocket_type in ('fixed', 'ayw')),
  term_label text,
  forfeit boolean not null default false,
  receive_amount numeric not null check (receive_amount >= 0),
  method text not null check (method in ('crypto', 'bank')),
  destination_details jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  transaction_id uuid references public.transactions(id),
  reason text
);

alter table public.hys_withdrawal_requests enable row level security;

create index hys_withdrawal_requests_client_id_idx on public.hys_withdrawal_requests (client_id);

-- ============================================================================
-- RLS — per instruction: "client INSERT-own-as-pending + SELECT-own on
-- hys_deposit_requests, SELECT-own on hys_pockets (pockets are created only via the credit
-- function, never directly by the client), admin SELECT-all, zero UPDATE/DELETE outside
-- service_role." hys_withdrawal_requests mirrors hys_deposit_requests' own INSERT-own-as-
-- pending + SELECT-own + admin-SELECT-all shape (the same pattern used for both
-- deposit_requests and withdrawal_requests in Stage 2 — not a new pattern invented here). No
-- UPDATE/DELETE policy exists for `authenticated`/`anon` on any of the 3 tables, so both are
-- denied by default for every client-side caller, admin-claimed or not — resolving a request
-- (credit/approve/reject) or creating/mutating a pocket is reserved exclusively for
-- service_role, via this stage's own 6 Edge Functions.
-- ============================================================================

create policy "clients can view their own hys pockets; admins can view all"
  on public.hys_pockets
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

create policy "clients can insert their own pending hys deposit request"
  on public.hys_deposit_requests
  for insert
  to authenticated
  with check (auth.uid() = client_id and status = 'pending');

create policy "clients can view their own hys deposit requests; admins can view all"
  on public.hys_deposit_requests
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

create policy "clients can insert their own pending hys withdrawal request"
  on public.hys_withdrawal_requests
  for insert
  to authenticated
  with check (auth.uid() = client_id and status = 'pending');

create policy "clients can view their own hys withdrawal requests; admins can view all"
  on public.hys_withdrawal_requests
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());
