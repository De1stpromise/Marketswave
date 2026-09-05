-- Dashboard Real-Data Fixes (2026-09-03): closes the fabricated "+4.2% this month" figure on
-- dashboard.html — a genuinely real per-client monthly anchor, computed on demand rather than
-- a scheduled job (no pg_cron dependency, same "no new infrastructure" preference already
-- established when the HYS pocket maturity-transition gap was closed the same way, row 124).
--
-- One row per (client, calendar month) — the FIRST real total-portfolio-value figure observed
-- for a client in a given month becomes that month's anchor; every subsequent request against
-- the SAME month reads the SAME anchor, so "% change this month" stays stable and comparable
-- across a real multi-day window rather than silently resetting on every page load. A new
-- calendar month naturally gets its own fresh anchor the first time the client is seen in it —
-- no migration/cleanup job needed, old rows are simply never touched again once their month
-- has passed (kept as a permanent, honest history, not deleted).
create table public.portfolio_value_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  month_start_date date not null,
  value_at_anchor numeric not null,
  created_at timestamptz not null default now(),
  unique (client_id, month_start_date)
);

alter table public.portfolio_value_snapshots enable row level security;

create index portfolio_value_snapshots_client_id_idx on public.portfolio_value_snapshots (client_id);

-- Mirrors every other per-client table's own self-or-admin SELECT policy. No client-side
-- INSERT/UPDATE/DELETE policy at all -- a client never creates their own anchor row directly
-- (there's real value-integrity reasoning here, same as hys_pockets' own precedent: the
-- anchor must be the server's own computed total, never a value the client could supply) --
-- writes are reserved exclusively for service_role, via the new
-- get-portfolio-monthly-change function.
create policy "clients can view their own portfolio value snapshots; admins can view all"
  on public.portfolio_value_snapshots
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());
