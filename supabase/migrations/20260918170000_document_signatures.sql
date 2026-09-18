-- ★ Task C — real signing (2026-09-18, register row 249).
--
-- Until now "signed" was a status flip (Signature Required -> Signed) written by the client
-- directly, capturing nothing: no name, no timestamp beyond the row update, no address, no
-- device, no hash of what was signed, no artefact. If a client disputed signing an advisory
-- agreement, there was nothing to produce. This table is what gets produced.
--
-- ONE ROW PER DOCUMENT, EVER (unique document_id). Written by exactly one path — the
-- sign-document Edge Function, service_role — AFTER it has hashed the stored bytes and
-- generated the signed copy, and BEFORE the document's status changes. If this insert fails,
-- the document is not signed (Task B's "the log is the gate" ordering, row 246).
--
-- ★ APPEND-ONLY FOR EVERY ROLE, service_role INCLUDED — Task B's exact trigger shape. A
-- signature record that can be edited or deleted proves nothing. The consequence is the same
-- as Task B's: the rows verification writes are permanent, on every environment it runs
-- against; the suites name themselves in typed_name/consent so a reader knows what they are.
--
-- ★ NO FOREIGN KEYS, deliberately (Task B's reasoning): the evidence must outlive the client
-- and the document it describes. An ON DELETE CASCADE would erase the trail the moment a
-- client is deleted; a plain FK would block that deletion. So every row carries denormalised
-- snapshots (client name/email, filename, the original's storage path) and reads correctly
-- years later with nothing to join.
--
-- WHAT IS CAPTURED, all server-side at signature time:
--   typed_name          the name as typed, verbatim (the signature)
--   consent_text        the exact statement affirmed, stored verbatim — never a boolean alone
--   signed_at           UTC, the function's own clock
--   ip_address          cf-connecting-ip / x-forwarded-for at the request (same helper as
--                       visitor presence); a private/loopback address on the local stack
--   user_agent          the request's User-Agent, verbatim
--   original_sha256     SHA-256 of the EXACT bytes stored at original_storage_path at that
--                       moment — computed by the function from the bytes it read itself.
--                       This is the fingerprint a later re-check compares against.
--   signed_copy_*       the generated artefact (original + appended certificate page) and ITS
--                       own SHA-256, so the artefact is re-checkable too.
--   client_reported_*   what the CLIENT'S browser reported it rendered and hashed — a value the
--                       client supplies, recorded for dispute (a client whose reported hash
--                       differs from original_sha256 saw different bytes), NEVER trusted as
--                       the fingerprint. Nullable: a client that could not hash still signs.
create table public.document_signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique,
  client_id uuid not null,
  client_name text,
  client_email text,
  filename text not null,
  typed_name text not null check (length(btrim(typed_name)) >= 2),
  consent_text text not null check (length(consent_text) >= 40),
  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  original_storage_path text not null,
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  original_size_bytes bigint not null check (original_size_bytes > 0),
  page_count integer check (page_count is null or page_count > 0),
  signed_copy_storage_path text not null,
  signed_copy_sha256 text not null check (signed_copy_sha256 ~ '^[0-9a-f]{64}$'),
  signed_copy_size_bytes bigint not null check (signed_copy_size_bytes > 0),
  client_reported_sha256 text check (client_reported_sha256 is null or client_reported_sha256 ~ '^[0-9a-f]{64}$'),
  client_reported_pages integer check (client_reported_pages is null or client_reported_pages > 0)
);

create index document_signatures_client_id_idx on public.document_signatures (client_id);
create index document_signatures_signed_at_idx on public.document_signatures (signed_at desc);

alter table public.document_signatures enable row level security;

-- A client may read their own evidence; a PM may read all. NO client-side write policy for
-- any role — the only writer is sign-document, service_role.
create policy "clients can view their own signature evidence; admins can view all"
  on public.document_signatures
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

-- Append-only for everyone, service_role included.
create or replace function public.document_signatures_is_append_only()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'document_signatures is append-only: % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$fn$;

create trigger document_signatures_no_update
  before update on public.document_signatures
  for each row execute function public.document_signatures_is_append_only();

create trigger document_signatures_no_delete
  before delete on public.document_signatures
  for each row execute function public.document_signatures_is_append_only();

create trigger document_signatures_no_truncate
  before truncate on public.document_signatures
  for each statement execute function public.document_signatures_is_append_only();

-- ★ THE CLIENT UPDATE POLICY ON documents IS DROPPED. Signing is now sign-document's job
-- (service_role, after the evidence row exists). With it gone, a client has NO update path
-- on documents at all — which also permanently closes the column-rewrite hole row 248's
-- trigger guards against; that trigger stays as defence in depth should any client UPDATE
-- policy ever return. The documents.html "Download clears is_new" consequence recorded at
-- row 123 is unchanged: still structurally unreachable, now for a simpler reason.
drop policy if exists "clients can sign their own from-marketswave documents" on public.documents;
