-- ============================================================================
-- ★ PM tool revamp, part 2 (2026-09-14) — the Overview as a daily briefing.
--
-- Two things the briefing needs that nothing in the schema could answer before:
--
-- 1. WHEN DID THIS PM LAST LOOK? The "Since you last looked" panel is timestamped against
--    the PM's actual previous SESSION, and no such timestamp existed anywhere — checked, not
--    assumed:
--      - auth.users.last_sign_in_at moves only on a password sign-in. The admin session is
--        persisted (admin-supabase-config.js, persistSession: true) and refreshes silently,
--        so a PM who signed in a week ago and has read the tool every day since still shows
--        last week's date there.
--      - auth.sessions.refreshed_at is null for every real PM session on this stack (the
--        token refresh path never wrote it), and it is not readable from the browser anyway.
--      - Nothing records a page view.
--    So pm_visits records one, honestly: one row per PM, written by get-pm-briefing on each
--    read. A SESSION is a run of reads with no gap longer than PM_SESSION_GAP_MINUTES (30 —
--    the same idle rule visitor sessions use); when a read arrives after a longer gap, the
--    previous session's last read becomes previous_session_last_seen_at, which is what the
--    panel reports. A PM's very first briefing has no previous session, and the panel says
--    so rather than substituting midnight.
--
-- 2. HOW ARE THE SCHEDULED JOBS DOING? System health reads the real last run of every
--    marketswave-* cron job and the real HTTP responses pg_net collected, which live in the
--    cron and net schemas PostgREST does not expose. scheduler_health() is a SECURITY DEFINER
--    read over both, executable by service_role only — the briefing function reads it; no
--    client-side role can.
-- ============================================================================

create table public.pm_visits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  session_started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  previous_session_last_seen_at timestamptz
);

-- service_role only: RLS on, no policies for any client-side role (the same shape as
-- user_roles). The Edge Function is the only reader and writer.
alter table public.pm_visits enable row level security;

create or replace function public.scheduler_health()
returns jsonb
language sql
security definer
set search_path = public, cron, net
as $fn$
  select jsonb_build_object(
    'jobs', (
      select coalesce(jsonb_agg(row_to_json(j) order by j.jobname), '[]'::jsonb)
      from (
        select j.jobname, j.schedule, j.active,
          (select jsonb_build_object('status', d.status, 'start_time', d.start_time, 'end_time', d.end_time, 'return_message', d.return_message)
             from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_run
        from cron.job j
        where j.jobname like 'marketswave-%'
      ) j
    ),
    'responses', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.created desc), '[]'::jsonb)
      from (
        select r.id, r.status_code, r.created, r.timed_out, r.error_msg, left(r.content, 4000) as content
        from net._http_response r
        order by r.created desc
        limit 40
      ) r
    )
  );
$fn$;

revoke all on function public.scheduler_health() from public;
revoke all on function public.scheduler_health() from anon, authenticated;
grant execute on function public.scheduler_health() to service_role;
