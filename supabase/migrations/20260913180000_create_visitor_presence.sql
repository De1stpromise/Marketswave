-- ★ Visitor presence (2026-09-13) — live presence, a rolling 30-day session history, and the
-- hooks for a PM to open a conversation with someone browsing (register row 209).
--
-- WHAT IS STORED — region and behaviour, never identity. There is deliberately NO column for
-- an IP address, a user agent string, or anything a visitor typed. The IP reaches only the
-- track-visit Edge Function, which uses it once per session to derive country/city from a
-- geolocation provider and then discards it; the browser never sees it. A visitor is a random
-- uuid in a first-party cookie; a session is a random uuid in sessionStorage. A signed-in
-- client is the one case where identity is legitimately known (client_id/client_name), and
-- that is data the platform already holds.
--
-- WHY NOT A REALTIME PRESENCE CHANNEL (the brief's own suggestion): Supabase Realtime
-- presence shares the whole presence state with every member of the channel, so visitors
-- joining one would each see every other visitor — the exact thing this feature's own RLS
-- rule forbids. Visitors therefore never open a Realtime channel at all; they heartbeat to
-- track-visit, and it is the PM's page that uses Realtime (postgres_changes on this table,
-- admin-only under RLS, REPLICA IDENTITY FULL per the row-159 finding) to stay live.
--
-- RETENTION: 30 days, enforced by purge_visitor_data() on a daily pg_cron job — a plain SQL
-- function, no Edge Function hop and no vault secret to configure (unlike the price refresh),
-- so it works the moment the migration applies. Stated in the page footer, not a policy page.

create table public.visitors (
  id uuid primary key,                                     -- the first-party cookie value
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  visit_count integer not null default 0                   -- sessions started by this cookie
);

create table public.visitor_sessions (
  id uuid primary key,                                     -- generated in the browser, per tab
  visitor_id uuid not null references public.visitors(id) on delete cascade,
  visit_number integer not null,                           -- this visitor's Nth session
  client_id uuid references auth.users(id) on delete set null,
  client_name text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),         -- the last heartbeat
  ended_at timestamptz,                                    -- set by the pagehide beacon
  current_path text not null,
  journey jsonb not null default '[]'::jsonb,              -- [{ "p": path, "t": iso }] in order
  page_count integer not null default 1,
  country_code text,
  country text,
  city text,
  device text,                                             -- "Mac", "iPhone", "Windows", ...
  browser text,                                            -- "Chrome", "Safari", ...
  referrer_host text,
  referrer_label text,                                     -- "Direct", "Google", "LinkedIn", ...
  search_term text,
  -- Notable-visitor email: at most ONE per session, and only for the reasons track-visit
  -- names (returning visitor, on /signup, a signed-in client, a session past five minutes).
  notable_reason text,
  notified_at timestamptz,
  -- Proactive chat: one invitation per session, enforced here by the function reading these
  -- columns under service_role — never by the UI alone.
  invitation_sent_at timestamptz,
  invited_by uuid references auth.users(id),
  invited_by_email text,
  invitation_token uuid,
  conversation_id uuid references public.conversations(id) on delete set null
);

create index visitor_sessions_started_at_idx on public.visitor_sessions (started_at desc);
create index visitor_sessions_last_seen_at_idx on public.visitor_sessions (last_seen_at desc);
create index visitor_sessions_visitor_id_idx on public.visitor_sessions (visitor_id);
create index visitor_sessions_client_id_idx on public.visitor_sessions (client_id);

-- ============================================================================
-- RLS — admin-only reads; no client-side write path for any role. Every write goes through
-- track-visit / send-proactive-message / accept-chat-invitation under service_role. A client
-- never reads presence, and a visitor never sees another visitor: the only SELECT policy is
-- the admin claim, and a visitor has no JWT at all.
-- ============================================================================
alter table public.visitors enable row level security;
alter table public.visitor_sessions enable row level security;

create policy "admins can read visitors"
  on public.visitors for select to authenticated using (public.is_admin());
create policy "admins can read visitor sessions"
  on public.visitor_sessions for select to authenticated using (public.is_admin());

-- Realtime for the PM's page (postgres_changes). Realtime evaluates each subscriber's RLS
-- against the WAL row itself, which needs the full row (row 159).
alter table public.visitor_sessions replica identity full;
alter publication supabase_realtime add table public.visitor_sessions;

-- ============================================================================
-- Retention — 30 days, then deleted. Sessions by their start; visitors once nothing has been
-- seen from that cookie for 30 days (a return after that is, honestly, a first visit again).
-- ============================================================================
create or replace function public.purge_visitor_data()
returns table (sessions_deleted integer, visitors_deleted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  s integer;
  v integer;
begin
  delete from public.visitor_sessions where started_at < now() - interval '30 days';
  get diagnostics s = row_count;
  delete from public.visitors where last_seen_at < now() - interval '30 days';
  get diagnostics v = row_count;
  return query select s, v;
end;
$$;
revoke all on function public.purge_visitor_data() from public, anon, authenticated;

select cron.schedule(
  'marketswave-purge-visitor-data',
  '15 3 * * *',
  $cron$ select public.purge_visitor_data() $cron$
);

-- ============================================================================
-- Proactive chat needs a conversation with no email yet: a PM opens one with an anonymous
-- visitor who has given nothing. contact_email becomes nullable; the grouping rule (one
-- conversation per contact) stays exactly as strong for every conversation that HAS an
-- email, via a partial unique index. The visitor supplies name and email when they first
-- reply, and accept-chat-invitation fills them in then.
-- ============================================================================
alter table public.conversations alter column contact_email drop not null;
drop index if exists public.conversations_contact_email_unique_idx;
create unique index conversations_contact_email_unique_idx
  on public.conversations (lower(contact_email)) where contact_email is not null;
