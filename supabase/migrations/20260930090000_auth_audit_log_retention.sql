-- ★ Auth audit log retention: 90 days (2026-09-30, register row 286).
--
-- auth.audit_log_entries is written by GoTrue (owned by supabase_auth_admin) once the project's
-- "Write audit logs to the database" setting is on. Each row carries the event (login, logout,
-- token_refreshed/revoked, user_recovery_requested, ...), the account's id and email, and the
-- client IP address — personal data, so it is kept no longer than it is useful: 90 days, the
-- operator's decision. Measured growth: 1 row per successful sign-in, 1 per sign-out, 2 per token
-- refresh (roughly hourly per open tab); a FAILED sign-in writes nothing at all.
--
-- The job runs as `postgres` (every cron job here does), which on the hosted project is NOT a
-- superuser but holds DELETE on this table — checked on the live project before writing this.
-- The migration runs the purge once below, as the same role, so a missing privilege fails the
-- migration loudly rather than the 03:45 job failing silently every night.

create or replace function public.purge_auth_audit_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from auth.audit_log_entries where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.purge_auth_audit_log() from public, anon, authenticated;

-- Idempotent: a re-applied migration replaces the job rather than adding a second one.
select cron.unschedule(jobid) from cron.job where jobname = 'marketswave-purge-auth-audit-log';
select cron.schedule(
  'marketswave-purge-auth-audit-log',
  '45 3 * * *',
  $cron$ select public.purge_auth_audit_log() $cron$
);

-- The privilege proof, as the role the job uses.
select public.purge_auth_audit_log();
