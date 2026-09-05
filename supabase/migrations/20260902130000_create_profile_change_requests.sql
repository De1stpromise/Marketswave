-- Backend Migration Phase B — Stage 5 (2026-09-02): the final two Approval Gate queues,
-- Client Applications and Client Profile Updates, move to real Supabase tables + Edge
-- Functions. Local stack only, real cloud "Marketswave Staging" untouched.
--
-- ---- Client Applications — INVESTIGATED FIRST, PER INSTRUCTION. NOTHING TO BUILD HERE.
-- Confirmed by reading the real, already-shipped Stage 1/Stage 3 source before writing a
-- single line of new schema: this queue is already fully real, end to end, and has been
-- since Stage 3 (Aug 30, 2026) — NOT a gap this stage needs to close.
--   * Schema: the `clients` table (this migration file's own sibling,
--     20260830094238_create_clients_and_admin_roles.sql) already has `status` (default
--     'pending_review', CHECK'd to 'pending_review'|'active'|'rejected'),
--     `application_resolved_at`, `application_reason` — a genuine "client application" IS a
--     `clients` row, not a separate table. "The queue" is really just
--     `SELECT * FROM clients WHERE status = 'pending_review'`, exactly as this task's own
--     instruction predicted, confirmed rather than assumed.
--   * Creation: a client already creates their own pending application via a direct,
--     RLS-enforced insert (Stage 2/3, `signup.html?backend=supabase` -> `supabase.auth.signUp()`
--     then `clients.insert()`) — the same INSERT policy on `clients` (self-only, status
--     forced to 'pending_review', email spoofing blocked) already fully covers it.
--   * Resolution: `supabase/functions/approve-client-application/` and
--     `reject-client-application/` (Stage 3) already exist, are already deployed to the real
--     cloud project, and are already enabled for local `supabase functions serve` per
--     `config.toml` — both admin-only via `getClaims(jwt)`, both re-verify the row is
--     genuinely `pending_review` before resolving, both already correct.
--   * Admin UI: `admin-client-applications.html` (Stage 3) already lists real Supabase
--     `pending_review` rows (a bare `supabase.from('clients').select()` client-side read, no
--     Edge Function needed for the LIST, matching the "RLS itself already permits this read"
--     reasoning already established for every prior stage's own request-* functions) and
--     already routes Approve/Reject through `supabase.functions.invoke()`.
-- The one genuine gap found: no PERSISTENT Node script exercises
-- approve-client-application/reject-client-application against the LOCAL stack with this
-- project's own standing rigor (cross-client isolation via the functions themselves, auth
-- negative cases) — Stage 3's own verification was real-cloud-and-browser, not a committed
-- local Node suite. `scripts/verify-supabase-final-approval-gate.js` (this stage's own
-- verification script) closes that gap directly against the ALREADY-EXISTING functions; the
-- table-level RLS matrix for `clients` itself is already thoroughly covered by
-- `verify-supabase-schema.js`'s own 16 assertions (re-run alongside, not duplicated here).
-- No migration content follows for Client Applications — there is genuinely nothing to add.
--
-- ---- Client Profile Updates — the one real gap this stage closes. Read
-- engine-core.js's real requestSettingsChange()/approveSettingsChangeRequest()/
-- rejectSettingsChangeRequest()/getSettingsProfile()/validateSettingsFieldValue()/
-- REQUESTABLE_SETTINGS_FIELDS/REQUESTABLE_SETTINGS_DEFAULTS in full before writing this file
-- (they were), not reinvented.
--
-- ---- Field-value fidelity, called out because the task's own paraphrase differs from the
-- real engine, same category of finding as Stage 4's pocket_type ('fixed'/'ayw' vs.
-- "fixed_deposit"/"as_you_want") -- reported, not silently changed: the task's own SCHEMA
-- bullet describes field as "legal_name|address|id_document", but engine-core.js's real
-- REQUESTABLE_SETTINGS_FIELDS array stores exactly 'legalName', 'address', 'idDocument'
-- (camelCase, the literal JS property names) -- this migration's CHECK constraint uses the
-- REAL stored values, not the task's snake_case paraphrase.
--
-- ---- CONFIRMED, per instruction, not assumed: dateOfBirth is genuinely gone. The real
-- REQUESTABLE_SETTINGS_FIELDS array (engine-core.js, read directly) is exactly
-- ['legalName', 'address', 'idDocument'] -- three fields, no dateOfBirth -- with the local
-- engine's own comment confirming it was deliberately removed (Aug 21, 2026) as a
-- structured-vs-bare-string type mismatch, and that old dateOfBirth records already in the
-- local store are left resolvable but not migrated. This migration ports the CURRENT
-- three-field reality, not the historical four-field one.
--
-- ---- resolution_note -- a genuinely necessary addition beyond the task's own literal column
-- list, flagged per instruction, mirroring Stage 4's own "necessary addition" precedent
-- (hys_withdrawal_requests): the real local rejectSettingsChangeRequest(clientId, requestId,
-- resolutionNote) takes a resolutionNote DELIBERATELY SEPARATE from the client's own `reason`
-- field -- the local engine's own comment states this explicitly ("the client's reason is
-- 'why I want this change,' the PM's resolutionNote is 'why I'm rejecting it.' Conflating
-- them would silently discard the client's original context"). Omitting this column would be
-- a real, silent loss of that already-designed distinction, not a faithful port of a smaller
-- surface.
--
-- ---- client_profiles -- a SECOND genuinely necessary addition beyond the task's own literal
-- schema list, flagged per instruction for the same reason: request-profile-change's own
-- spec (below) requires "snapshots the client's actual current value automatically" -- that
-- is only possible if a real, server-side profile store exists to snapshot FROM. The local
-- engine has exactly this in SETTINGS_PROFILE_KEY (marketswave_settings_profile),
-- DELIBERATELY SEPARATE from the Client Registry (`clients` in this schema) -- the local
-- engine's own comment confirms this ("settings.html's own existing profile store... Now
-- also holds the four [now three] request-based fields"). This migration mirrors that same
-- separation with a new `client_profiles` table (client_id primary key, one column per
-- requestable field) rather than adding legal_name/address/id_document columns onto `clients`
-- itself, which would conflate two genuinely distinct local stores into one.
--
-- ---- No-fake-fallback design, ported forward from a REAL FIX already made once on the local
-- side and applied here from the start rather than repeating the mistake it fixed: the local
-- engine's own REQUESTABLE_SETTINGS_DEFAULTS ("John A. Doe" / a fake Boston address / a fake
-- "Passport" doc) was a real bug closed by the local engine's own later fix (Backend
-- Requirements Register row 80 -- "getSettingsProfile()'s John A. Doe fallback closed for
-- every new client") -- every new client now gets REAL null values seeded, never a fabricated
-- default. A Supabase-side client has no equivalent seeding step yet (out of this stage's own
-- scope), so this port goes straight to the ALREADY-FIXED behavior: a client_profiles row (or
-- column) that doesn't exist yet reads back as a genuine `null` current_value, never a fake
-- "John A. Doe"-style placeholder. request-profile-change/index.ts implements this directly.

-- ============================================================================
-- client_profiles — per-client, one row per client, one column per requestable field. A
-- missing row (or a null column) is the real, honest "nothing on file yet" state — never a
-- fabricated default. Created lazily by approve-profile-change (service_role) on a client's
-- first-ever approved change; a client is never expected to have this row from signup.
-- ============================================================================
create table public.client_profiles (
  client_id uuid primary key references auth.users(id) on delete cascade,
  legal_name jsonb,
  address jsonb,
  id_document jsonb,
  updated_at timestamptz not null default now()
);

alter table public.client_profiles enable row level security;

-- Mirrors every other per-client table's own self-or-admin SELECT policy. No client-side
-- INSERT/UPDATE/DELETE policy at all -- a client never writes their own profile row directly
-- (there is no local equivalent either: settings.html's own self-service email/phone fields
-- are explicitly OUT of REQUESTABLE_SETTINGS_FIELDS and out of this stage's scope; every
-- field this table holds is request-and-approve only) -- writes are reserved exclusively for
-- service_role, via approve-profile-change.
create policy "clients can view their own profile; admins can view all"
  on public.client_profiles
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

-- ============================================================================
-- profile_change_requests — per-client. Mirrors SETTINGS_CHANGE_REQUESTS_KEY's real field
-- shape (read directly from requestSettingsChange()/approveSettingsChangeRequest()/
-- rejectSettingsChangeRequest() before writing this, not reinvented). current_value/
-- requested_value are generic jsonb -- each field's own real shape differs (legalName:
-- {firstName,lastName}; address: {street,city,state,zip,country}; idDocument:
-- {documentType,fileName}), matching the local engine's own already-generic
-- validateSettingsFieldValue()-per-field approach rather than one fixed column shape.
-- ============================================================================
create table public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  field text not null check (field in ('legalName', 'address', 'idDocument')),
  current_value jsonb,
  requested_value jsonb not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);

alter table public.profile_change_requests enable row level security;

create index profile_change_requests_client_id_idx on public.profile_change_requests (client_id);

-- ============================================================================
-- RLS — the same established INSERT-own-as-pending + SELECT-own + admin-SELECT-all pattern
-- as every prior Approval Gate stage. No UPDATE/DELETE policy exists for
-- `authenticated`/`anon`, so both are denied by default for every client-side caller,
-- admin-claimed or not — resolving a request (approve/reject) is reserved exclusively for
-- service_role, via this stage's own 3 Edge Functions.
-- ============================================================================

create policy "clients can insert their own pending profile change request"
  on public.profile_change_requests
  for insert
  to authenticated
  with check (auth.uid() = client_id and status = 'pending');

create policy "clients can view their own profile change requests; admins can view all"
  on public.profile_change_requests
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());
