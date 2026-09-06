-- Backend Migration Phase D — Stage 1 (2026-09-06): real market data + first real email
-- notifications. Two genuinely unrelated domains, sharing one migration only because they
-- were built in the same stage.

-- ============================================================================
-- market_data_cache — a small, genuinely public (to any authenticated client) cache of
-- real market data, populated exclusively by get-market-snapshot's own service_role write.
-- One row per symbol, upserted in place rather than appended — this is a live snapshot, not
-- a time series; the real "did this get re-fetched recently enough" question is answered by
-- comparing last_updated against a threshold at read time, not by keeping history here.
-- ============================================================================
create table public.market_data_cache (
  symbol text primary key,
  value numeric not null,
  change_percent numeric,
  source text not null,
  last_updated timestamptz not null default now()
);

alter table public.market_data_cache enable row level security;

-- SELECT: any authenticated caller (a client viewing their own real dashboard's Market
-- Snapshot card) — this is non-sensitive, genuinely public market data, not scoped per
-- client at all. No INSERT/UPDATE/DELETE policy exists for any client-facing role — only
-- service_role (via get-market-snapshot) ever writes here.
create policy "authenticated users can read market data"
  on public.market_data_cache
  for select
  to authenticated
  using (true);

-- ============================================================================
-- email_log — a real, service_role-only audit trail of every email this project has
-- actually sent, written by _shared/send-email.ts. related_entity_type/related_entity_id
-- are a deliberately generic, unconstrained pair (not a real foreign key) — this table logs
-- emails triggered from many different domains (client applications today; deposits,
-- withdrawals, and others later, per this stage's own forward-looking register entry), and
-- Postgres has no single-column FK that can point at "whichever table this happens to be."
-- status is real and honest — a failed send (e.g. Resend rejects the request) is still
-- logged, with error_message populated, never silently dropped or recorded as a fake
-- success.
-- ============================================================================
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  subject text not null,
  sent_at timestamptz not null default now(),
  related_entity_type text,
  related_entity_id uuid,
  status text not null check (status in ('sent', 'failed')),
  resend_id text,
  error_message text
);

alter table public.email_log enable row level security;

create index email_log_related_entity_idx on public.email_log (related_entity_type, related_entity_id);

-- SELECT: admin-only (mirrors the local Security Log's own "PM-facing audit trail" role,
-- now for the first time as a genuinely real Supabase table) — a client never needs to read
-- a log of emails sent to them; they receive the emails themselves. No INSERT/UPDATE/DELETE
-- policy exists for any client-facing role, admin included — only service_role (via
-- _shared/send-email.ts, called from inside other Edge Functions) ever writes here.
create policy "admins can view the email log"
  on public.email_log
  for select
  to authenticated
  using (public.is_admin());
