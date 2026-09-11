-- ★ Merged Market Snapshot + Watchlist, follow-up (2026-09-11).
--
-- Configuring the scheduler means writing two values into supabase_vault, and the first
-- version of scripts/supabase-configure-scheduler.js did that over a direct Postgres
-- connection. That worked locally, where `supabase status` hands you the connection string,
-- and made the REAL CLOUD project awkward: it required the operator to dig out the database
-- password for what is otherwise a one-line administrative action, and put that password in
-- an environment variable to do it.
--
-- This is the same operation as an RPC the service_role key can call, so the script needs
-- nothing beyond the key it already reads. It returns the resulting state rather than just
-- succeeding, so the script can report what the SCHEDULER will actually find instead of
-- what was just written — the secret VALUES are never returned, only their lengths, which
-- is enough to tell "present" from "truncated" without putting a real key in a response.
create or replace function public.set_scheduler_config(base_url text, service_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, cron
as $sched$
declare
  existing_id uuid;
  result jsonb;
begin
  if base_url is null or length(trim(base_url)) = 0 then
    raise exception 'base_url is required.';
  end if;
  if service_key is null or length(trim(service_key)) = 0 then
    raise exception 'service_key is required.';
  end if;

  select id into existing_id from vault.secrets where name = 'edge_functions_base_url';
  if existing_id is null then
    perform vault.create_secret(base_url, 'edge_functions_base_url',
      'Base URL public.invoke_edge_function() posts scheduled runs to.');
  else
    perform vault.update_secret(existing_id, base_url, 'edge_functions_base_url',
      'Base URL public.invoke_edge_function() posts scheduled runs to.');
  end if;

  select id into existing_id from vault.secrets where name = 'scheduler_service_role_key';
  if existing_id is null then
    perform vault.create_secret(service_key, 'scheduler_service_role_key',
      'service_role key used by pg_cron/pg_net to authorize scheduled Edge Function calls.');
  else
    perform vault.update_secret(existing_id, service_key, 'scheduler_service_role_key',
      'service_role key used by pg_cron/pg_net to authorize scheduled Edge Function calls.');
  end if;

  -- Read back through the exact view invoke_edge_function() itself reads, so this reports
  -- what the scheduler will genuinely find rather than what was just written.
  select jsonb_build_object(
    'secrets', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'length', length(decrypted_secret)) order by name), '[]'::jsonb)
      from vault.decrypted_secrets
      where name in ('edge_functions_base_url', 'scheduler_service_role_key')
    ),
    'jobs', (
      select coalesce(jsonb_agg(jsonb_build_object('jobname', jobname, 'schedule', schedule, 'active', active) order by jobname), '[]'::jsonb)
      from cron.job
    )
  ) into result;

  return result;
end;
$sched$;

-- service_role keeps EXECUTE (it is the intended caller, and it already holds the key this
-- writes). Everyone else is revoked: a signed-in client or an anonymous visitor has no
-- business rewriting where the scheduler points.
revoke all on function public.set_scheduler_config(text, text) from public;
revoke all on function public.set_scheduler_config(text, text) from anon, authenticated;
grant execute on function public.set_scheduler_config(text, text) to service_role;
