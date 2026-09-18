-- ============================================================================================
-- Task A — make signup's data actually persist (2026-09-18, register row 242).
--
-- Until this migration, signup.html collected a client's date of birth, country of residence,
-- financial profile, goals & preferences, the six-question risk questionnaire, entity/joint
-- details and two identity documents — and NONE of it reached Supabase. The onboarding record
-- went to the browser's own localStorage (marketswave_client_onboarding:<uid>), two fields
-- (date of birth, country) went nowhere at all, and the two documents were stored as a FILENAME
-- with no bytes behind them anywhere. Three shipped surfaces were rendering honest emptiness
-- over data a client had typed.
--
-- WHAT THIS ADDS
--   1. client_profiles gains the onboarding record as COLUMNS. Extended rather than a new table
--      because every surface that shows a client's profile (settings.html, the PM profile, the
--      approval gate) already joins client_profiles by uid; a second table is a fourth read on
--      each of them and a second "profile" concept. The request-and-approve flow is reused by
--      widening profile_change_requests.field, not duplicated.
--   2. identity_documents — its OWN table and its OWN private bucket. NOT the documents bucket:
--      that bucket's SELECT policy grants public.is_admin() over every object, so an identity
--      file placed there would be readable by any PM today with nothing logging it. The
--      identity-documents bucket's SELECT policy is OWNER ONLY — there is deliberately NO admin
--      clause — so until access logging ships (Task B) there is no read path for a PM anywhere:
--      not a suppressed button, an absent policy. A PM sees the row's METADATA through the
--      table's own admin SELECT (document type, filename, upload date), never the bytes.
--      A client can never DELETE an identity document either (KYC records are not
--      client-removable, unlike documents.html's own uploads).
--   3. A one-off backfill of legal_name for every client that has none, from clients.name —
--      the only part of the six real signups' onboarding that is recoverable server-side. The
--      rest existed only in each person's own browser (register row 242 says so plainly).
--
-- ★ NO CLIENT WRITE PATH ON client_profiles IS ADDED. A client-side INSERT/UPDATE policy cannot
-- restrict WHICH columns a row write touches, so a client "submitting onboarding" could also
-- rewrite legal_name/address/id_document and bypass approval. Onboarding is written by the
-- new submit-onboarding Edge Function (service_role, self-only, refuses a second submission,
-- writes only the onboarding columns), which is also what the reclaim-on-login path calls.
--
-- ★ ROW D (the absent-source pattern): every object this migration creates is in public or
-- storage and is created BY this migration, so cloud-staging parity is what proves it exists on
-- the deployment target. The storage bucket policies were proven to behave identically on the
-- hosted project with a throwaway client before this was written (upload own folder OK, a
-- non-policied subfolder refused, signed-URL read byte-identical, anon refused).
-- ============================================================================================

-- ---- 1. client_profiles: the onboarding record ---------------------------------------------
alter table public.client_profiles
  add column if not exists date_of_birth date,
  add column if not exists country_of_residence text,
  add column if not exists financial_profile jsonb,
  add column if not exists goals_preferences jsonb,
  add column if not exists risk_questionnaire jsonb,
  add column if not exists entity_details jsonb,
  add column if not exists joint_holder jsonb,
  add column if not exists onboarding_submitted_at timestamptz;

comment on column public.client_profiles.date_of_birth is
  'Identity fact. NOT a requestable field (decided Aug 21, 2026 and reaffirmed 2026-09-18): a wrong date of birth is corrected through support, not self-requested.';
comment on column public.client_profiles.country_of_residence is
  'Country of RESIDENCE, the two-letter code signup.html offers. This is NOT tax residence — the fee rules need the latter and signup does not ask for it (register row 242).';
comment on column public.client_profiles.onboarding_submitted_at is
  'Set exactly once by submit-onboarding. Null means the client has never submitted an onboarding record to the server — either they signed up before 2026-09-18 and have not signed in from the same browser since (reclaim-on-login), or the write failed at signup.';

-- ---- 2. the change-request flow: six more requestable groups --------------------------------
-- The local engine's REQUESTABLE_SETTINGS_FIELDS was ['legalName','address','idDocument'] and
-- dateOfBirth was deliberately removed from it; that decision stands. The new groups are
-- requestable AS GROUPS (one request carries the whole group's value), mirroring how
-- legalName already carries {firstName,lastName} rather than one request per sub-field.
alter table public.profile_change_requests
  drop constraint if exists profile_change_requests_field_check;
alter table public.profile_change_requests
  add constraint profile_change_requests_field_check
  check (field in (
    'legalName', 'address', 'idDocument',
    'countryOfResidence', 'financialProfile', 'goalsPreferences', 'riskQuestionnaire',
    'entityDetails', 'jointHolder'
  ));

-- ---- 3. identity_documents ------------------------------------------------------------------
create table public.identity_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('id', 'address')),
  document_type text not null,
  filename text not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  unique (client_id, kind)
);

alter table public.identity_documents enable row level security;

-- A client may read their own rows; a PM may read every row. This is METADATA — the bytes are
-- behind the bucket policy below, which grants a PM nothing.
create policy "identity docs: clients read their own; admins read all"
  on public.identity_documents
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

-- A client inserts their own row, and only against a path inside their own folder of the
-- identity-documents bucket — the row must describe an object the bucket policy would have
-- let this same client write. No UPDATE, no DELETE, for any client role.
create policy "identity docs: clients insert their own"
  on public.identity_documents
  for insert
  to authenticated
  with check (
    auth.uid() = client_id
    and storage_path like (auth.uid()::text || '/%')
  );

-- ---- 4. the identity-documents bucket -------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('identity-documents', 'identity-documents', false, 20971520)
on conflict (id) do nothing;

-- Path convention: <client_id>/<kind>/<document_row_id>/<filename> — the first segment is the
-- owner's own uid, so every policy below is a folder check with no table lookup.
--
-- ★ OWNER ONLY. There is no public.is_admin() clause on purpose. A PM cannot sign a URL for,
-- list, or download any object in this bucket through any client-side path. When Task B ships
-- access logging, the logged read will be a service_role Edge Function — which bypasses these
-- policies by construction — and NOT a widening of this policy.
create policy "identity bucket: owner can view their own files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "identity bucket: owner can upload into their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No DELETE policy for anyone but service_role: an identity document is not client-removable.

-- ---- 5. backfill legal_name from clients.name -----------------------------------------------
-- The one recoverable piece for the six clients who signed up before this existed. Mirrors
-- the local engine's splitClientLegalName(): trailing legal-entity suffixes stripped first,
-- last remaining word is the last name, everything before it is the first name, and a
-- single-word name degrades to an EMPTY first name rather than a guess.
create or replace function public.split_client_legal_name(p_name text)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  words text[];
  n int;
begin
  words := regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+');
  words := array_remove(words, '');
  -- strip trailing legal-entity suffixes (LLC, INC, CORP, LTD, LLP, LP, PLC, PC), any count
  while array_length(words, 1) > 1
    and upper(regexp_replace(words[array_length(words, 1)], '[.,]', '', 'g')) in ('LLC','INC','CORP','LTD','LLP','LP','PLC','PC') loop
    words := words[1:array_length(words, 1) - 1];
  end loop;
  n := coalesce(array_length(words, 1), 0);
  if n = 0 then return null; end if;
  if n = 1 then return jsonb_build_object('firstName', '', 'lastName', words[1]); end if;
  return jsonb_build_object('firstName', array_to_string(words[1:n-1], ' '), 'lastName', words[n]);
end;
$fn$;

insert into public.client_profiles (client_id, legal_name)
select c.id, public.split_client_legal_name(c.name)
from public.clients c
left join public.client_profiles p on p.client_id = c.id
where p.client_id is null
  and public.split_client_legal_name(c.name) is not null;

update public.client_profiles p
set legal_name = public.split_client_legal_name(c.name),
    updated_at = now()
from public.clients c
where c.id = p.client_id
  and p.legal_name is null
  and public.split_client_legal_name(c.name) is not null;
