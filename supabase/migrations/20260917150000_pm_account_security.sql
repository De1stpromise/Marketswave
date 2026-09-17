-- ★ PM tool revamp, part 8 (2026-09-17) — reading and revoking a PM's OWN Auth sessions.
--
-- ★ WHY THESE ARE SECURITY DEFINER FUNCTIONS AND NOT A TABLE READ. auth.sessions and
-- auth.audit_log_entries are GoTrue-internal tables in the `auth` schema. PostgREST exposes
-- only `public` and `graphql_public`, so NO caller reaches them over the API — not a client,
-- not an admin, not even service_role. A SECURITY DEFINER function in `public` is the only
-- route, and that is exactly why each one below is locked down rather than merely exposed.
--
-- ★ EXECUTE IS REVOKED FROM anon AND authenticated, AND GRANTED ONLY TO service_role. Every
-- one of these takes p_user_id as an argument, so a function reachable by `authenticated`
-- would let any signed-in user read or revoke ANY other user's sessions by passing their id —
-- a real privilege escalation, not a theoretical one. The only caller is an Edge Function
-- that has already verified the requester's own JWT with getClaims() and passes claims.sub;
-- it can never pass an id the caller did not prove they own. The verification proves the
-- refusal for a client session AND for an admin-claimed one, rather than reading the GRANT.
--
-- ★ WHAT IS DELIBERATELY NOT HERE: a function that lists sessions for an arbitrary user, or
-- that writes anything to auth.*. A PM can see and end their OWN sessions; ending a CLIENT's
-- session is a different action with a different audit story and is not built here.

-- ---------------------------------------------------------------------------------------
-- The caller's own live sessions. `not_after` is GoTrue's own hard expiry (null = none set).
-- `ip` is inet in the table and is cast to text for the caller; `user_agent` is whatever the
-- client sent at sign-in and may be absent or not a browser at all.
create or replace function public.pm_auth_sessions(p_user_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  refreshed_at timestamptz,
  not_after timestamptz,
  user_agent text,
  ip text,
  aal text
)
language sql
security definer
set search_path = auth, public
as $$
  select s.id, s.created_at, s.updated_at, s.refreshed_at, s.not_after,
         s.user_agent, host(s.ip), s.aal::text
  from auth.sessions s
  where s.user_id = p_user_id
  order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc
$$;

-- ---------------------------------------------------------------------------------------
-- The caller's own recorded account activity.
--
-- ★ WHAT THIS CAN AND CANNOT SHOW, established by querying the real table rather than assumed
-- (register row 234): GoTrue records SUCCESSES here (login, logout, token_refreshed,
-- token_revoked, user_updated_password, …) and records NO FAILED ATTEMPTS AT ALL — a query
-- for any action matching fail/invalid/denied returns empty. Nor is there a device or a
-- location: auth.audit_log_entries.ip_address was blank on all 62,564 rows on this stack (the
-- column exists; this deployment never populates it) and the payload carries only
-- {action, actor_id, actor_username, actor_via_sso, log_type, traits:{provider}} — no user
-- agent. So this returns a timestamp, an action and a provider, and the page says plainly
-- that failures are not recorded rather than presenting a successes-only list as a security
-- history. Adding failures would need application-layer logging on our own sign-in pages,
-- which would only ever capture attempts made through them.
create or replace function public.pm_auth_activity(p_user_id uuid, p_days integer default 30, p_limit integer default 50)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  provider text
)
language sql
security definer
set search_path = auth, public
as $$
  select a.id, a.created_at,
         a.payload->>'action',
         a.payload->'traits'->>'provider'
  from auth.audit_log_entries a
  where (a.payload->>'actor_id') = p_user_id::text
    and a.created_at > now() - make_interval(days => greatest(p_days, 1))
  order by a.created_at desc
  limit greatest(p_limit, 1)
$$;

-- ---------------------------------------------------------------------------------------
-- End one of the caller's own sessions.
--
-- ★ DELETING THE SESSION ROW IS A GENUINE REVOKE, not a cosmetic one:
-- auth.refresh_tokens.session_id carries ON DELETE CASCADE
-- (refresh_tokens_session_id_fkey), so the device's refresh token goes with it and it can
-- never mint another access token. Its CURRENT access token remains valid until it expires
-- (one hour) — that is how bearer tokens work, and the page says so rather than implying an
-- instant cut-off it cannot deliver.
--
-- The `and user_id = p_user_id` clause is the guard: a session id belonging to someone else
-- matches nothing and returns false. It is not decoration — it is what makes passing an
-- arbitrary uuid harmless.
create or replace function public.pm_revoke_session(p_user_id uuid, p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  v_deleted integer;
begin
  delete from auth.sessions where id = p_session_id and user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- End every session of the caller's EXCEPT the one they are using. p_keep_session_id comes
-- from the requester's own JWT session_id claim in the Edge Function, so "this device" is
-- identified by the token itself and never by anything the browser sent.
create or replace function public.pm_revoke_other_sessions(p_user_id uuid, p_keep_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  v_deleted integer;
begin
  delete from auth.sessions where user_id = p_user_id and id is distinct from p_keep_session_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.pm_auth_sessions(uuid) from public, anon, authenticated;
revoke execute on function public.pm_auth_activity(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.pm_revoke_session(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.pm_revoke_other_sessions(uuid, uuid) from public, anon, authenticated;

grant execute on function public.pm_auth_sessions(uuid) to service_role;
grant execute on function public.pm_auth_activity(uuid, integer, integer) to service_role;
grant execute on function public.pm_revoke_session(uuid, uuid) to service_role;
grant execute on function public.pm_revoke_other_sessions(uuid, uuid) to service_role;
