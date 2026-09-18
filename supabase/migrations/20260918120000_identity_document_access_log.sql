-- ============================================================================================
-- Task B — access logging for identity documents (2026-09-18, register row 246).
--
-- Task A (row 242) put identity documents in an owner-only bucket with NO admin read policy,
-- so that no PM could open one before every open was logged. This is the log, and the read.
--
-- ★ APPEND-ONLY, STRUCTURALLY. No client role has an INSERT, UPDATE or DELETE policy, and a
-- trigger refuses UPDATE and DELETE for EVERY role including service_role — the one caller
-- RLS cannot stop. If a PM (or a script holding the service key) could quietly remove a row,
-- the trail would prove nothing. Proven in the suite by attempting both, as a PM and as
-- service_role, and asserting refusal.
--
-- ★ NO FOREIGN KEYS TO auth.users OR identity_documents, deliberately. A trail row must outlive
-- the client and the document it describes: an ON DELETE CASCADE would erase history the
-- moment a client is deleted, and a plain FK would block that deletion. The row carries
-- denormalised snapshots (client name/email, document kind/type/filename, PM email) taken at
-- the moment of access, so it reads correctly years later with nothing to join.
--
-- ★ REFUSED ATTEMPTS ARE ROWS TOO. A request that was validated and rejected — a reason too
-- short, a document that does not exist, a caller who is not a Portfolio Manager — is exactly
-- what an audit trail exists to show. Recording only successes would leave no trace of the
-- interesting case.
--
-- ★ THE REASON IS FREE TEXT WITH A MINIMUM LENGTH, enforced here as a CHECK as well as in the
-- Edge Function: a picker invites clicking the first option, and a short typed reason is
-- worth more for review than a category.
--
-- The client is NOT notified of an access (a product decision that can change) — but "not
-- notified" is not "not disclosable": a client making a data access request is entitled to
-- know who opened their documents, and this table is what answers that.
--
-- One PM today means this log has no immediate reader. It is built for the deployment where
-- it matters — a second PM, a compliance review, a subject access request — because an audit
-- trail retrofitted later has no history before the day it was added.
-- ============================================================================================

create table public.identity_document_access_log (
  id uuid primary key default gen_random_uuid(),
  -- who asked (a real PM's own auth uid + email, Phase C's attribution convention; for a
  -- refused non-PM attempt, the caller's own uid/email so the attempt is attributable)
  pm_user_id uuid not null,
  pm_email text,
  -- whose document
  client_id uuid not null,
  client_name text,
  client_email text,
  -- which document (snapshot; the identity_documents row may be gone later)
  identity_document_id uuid,
  document_kind text,
  document_type text,
  filename text,
  -- why, and what happened
  reason text not null,
  outcome text not null check (outcome in ('opened', 'refused')),
  refusal_reason text,
  requested_at timestamptz not null default now(),
  url_expires_at timestamptz,
  constraint identity_document_access_log_reason_min check (char_length(btrim(reason)) >= 10 or outcome = 'refused')
);

create index identity_document_access_log_client_idx on public.identity_document_access_log (client_id, requested_at desc);
create index identity_document_access_log_requested_idx on public.identity_document_access_log (requested_at desc);

alter table public.identity_document_access_log enable row level security;

-- Every PM sees every access. Moot at one PM, correct at multi-PM, and the other way would
-- need undoing. No client-side policy of any other kind exists.
create policy "identity access log: admins read all"
  on public.identity_document_access_log
  for select
  to authenticated
  using (public.is_admin());

-- Append-only for everyone, service_role included.
create or replace function public.identity_document_access_log_is_append_only()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'identity_document_access_log is append-only: % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$fn$;

create trigger identity_document_access_log_no_update
  before update on public.identity_document_access_log
  for each row execute function public.identity_document_access_log_is_append_only();

create trigger identity_document_access_log_no_delete
  before delete on public.identity_document_access_log
  for each row execute function public.identity_document_access_log_is_append_only();

-- Belt and braces: TRUNCATE is not subject to row triggers; refuse it at statement level too.
create trigger identity_document_access_log_no_truncate
  before truncate on public.identity_document_access_log
  for each statement execute function public.identity_document_access_log_is_append_only();
