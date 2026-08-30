-- Supabase Migration — Stage 1 (Aug 30, 2026)
--
-- Mirrors Backend Migration Phase 1's Firestore `clients/{uid}` collection + its admin
-- custom-claim authorization model onto Postgres/Supabase. Read directly from
-- firestore.rules / firestore.staging.rules / functions/index.js before writing this file,
-- not reinvented — the field shapes, the "status forced to pending_review on create, never
-- updatable by the client afterward" rule, and the email-spoofing/account-type validation
-- are all deliberate mirrors of that existing, already-verified design. This migration adds
-- schema only — it does not touch, remove, or disable any existing Firebase code.
--
-- ---- Admin-role pattern, researched and decided per instruction ------------------------
-- Chose a Custom Access Token Auth Hook (a Postgres function Supabase Auth calls before
-- issuing a JWT) that stamps `app_metadata.is_admin` onto the token from a source-of-truth
-- `user_roles` table, over the simpler "profiles.role + RLS subquery" pattern. Reasons:
--   1. It's Supabase's own documented, current-recommended approach for RBAC
--      (https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook,
--      https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac).
--   2. RLS policies read the claim straight off the already-verified JWT
--      (`auth.jwt() -> 'app_metadata' ->> 'is_admin'`) with ZERO extra database round-trip
--      per row evaluated — a subquery-per-row pattern (`EXISTS (SELECT 1 FROM profiles
--      WHERE id = auth.uid() AND role = 'admin')`) does one lookup per row checked, which
--      gets expensive on `list`-shaped queries exactly like this table's own admin-review
--      list. A JWT claim is only wrong for the lifetime of that token (short — this project
--      never needs live role revocation mid-session, same as the Firebase custom-claim
--      model it already ships).
--   3. `app_metadata` (unlike `user_metadata`) can only ever be set server-side (the Auth
--      Admin API / a Postgres function running with elevated privilege) — a client can never
--      grant itself admin, mirroring exactly how Firebase's `{admin: true}` custom claim can
--      only be set via the Admin SDK, never client-side. This preserves the existing
--      single-shared-admin security property instead of weakening it.
-- A boolean `is_admin` (not a `role` text/enum column) was chosen to mirror the Firebase side
-- literally — this project has one shared PM identity, not a multi-role system, so a richer
-- role enum would be unused complexity today; if real multi-PM/multi-role support is ever
-- built (already a flagged future item — see CLAUDE.md's Phase D), `user_roles` is the
-- natural place to add a `role` column without touching this migration's own shape.

-- ============================================================================
-- user_roles — source of truth for the admin claim. NEVER exposed to any client role
-- (authenticated/anon) — RLS is enabled with zero policies for those roles, so both are
-- denied by default; only supabase_auth_admin (via the hook below) and service_role
-- (bootstrap script) can ever read/write it.
-- ============================================================================
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- Required by Supabase's own Auth Hooks setup: the hook function runs as the
-- supabase_auth_admin role, which needs explicit grants to reach into `public` at all —
-- without this, the hook silently can't read the table it depends on.
grant usage on schema public to supabase_auth_admin;
grant select on public.user_roles to supabase_auth_admin;

create policy "supabase_auth_admin can read user_roles"
  on public.user_roles
  as permissive
  for select
  to supabase_auth_admin
  using (true);

-- ============================================================================
-- custom_access_token_hook — stamps app_metadata.is_admin onto every issued JWT from the
-- user_roles table above. Registered via supabase/config.toml's [auth.hook.custom_access_token]
-- block, not here — a hook function existing alone does nothing until Auth is told to call it.
-- ============================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  admin_flag boolean;
begin
  select coalesce(is_admin, false)
    into admin_flag
    from public.user_roles
    where user_id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{app_metadata,is_admin}', to_jsonb(coalesce(admin_flag, false)), true);

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- Defense in depth, matching the hook docs: only supabase_auth_admin may ever invoke this,
-- never a client-facing role.
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;

-- ============================================================================
-- is_admin() — the one place RLS policies read the JWT claim from. A plain SQL function
-- (not SECURITY DEFINER — it never touches a table, only the session's already-verified
-- JWT), so it costs nothing beyond what auth.jwt() itself costs.
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

-- ============================================================================
-- clients — mirrors Firestore's clients/{uid} document shape field-for-field
-- (functions/index.js's createClientApplication, and engine-core.js's addClient()/
-- approveClientApplication()/rejectClientApplication() that it was itself mirroring).
-- id = auth.users.id directly, same "document id = the owning user's own uid" design as
-- the Firestore side, not a separate generated primary key.
-- ============================================================================
create table public.clients (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null,
  account_type text not null check (account_type in ('Individual Account', 'Joint Account', 'Business Account')),
  status text not null default 'pending_review' check (status in ('pending_review', 'active', 'rejected')),
  application_resolved_at timestamptz,
  application_reason text,
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;

-- INSERT: an authenticated user may create EXACTLY their own row (id = auth.uid()), with
-- status forced to literally 'pending_review' — never accepted as whatever the client sends
-- — and email checked against their own verified JWT email, preventing a client from
-- claiming a different email than their real Supabase Auth account (the same anti-spoofing
-- check firestore.staging.rules already enforces, added there beyond the Cloud Function's
-- own literal ask and carried over here deliberately, not smuggled in silently).
-- account_type's validity is enforced globally by the CHECK constraint above rather than
-- repeated here, which is stronger than a policy-only check since it also protects
-- service_role writes.
create policy "clients can insert their own pending application"
  on public.clients
  for insert
  to authenticated
  with check (
    auth.uid() = id
    and status = 'pending_review'
    and email = (auth.jwt() ->> 'email')
  );

-- SELECT: a client may read their own row; an admin (per the JWT claim above) may read any
-- row — this single policy covers both Firestore's separate `get` (self) and `list` (admin)
-- rules, since Postgres RLS doesn't distinguish single-row vs. multi-row reads the way
-- Firestore's rules language does.
create policy "clients can view their own row; admins can view all"
  on public.clients
  for select
  to authenticated
  using (
    auth.uid() = id
    or public.is_admin()
  );

-- No UPDATE or DELETE policy exists for `authenticated` or `anon` on purpose — with RLS
-- enabled and no matching policy, both operations are denied by default for every
-- client-side caller, including a client attempting to update their own row. Resolving an
-- application (pending_review -> active/rejected) is reserved for privileged access only
-- (service_role, via a future Edge Function mirroring approveClientApplication/
-- rejectClientApplication) — mirrors firestore.rules'/firestore.staging.rules' own
-- `allow update, delete: if false` for every client-side caller, unconditionally.
