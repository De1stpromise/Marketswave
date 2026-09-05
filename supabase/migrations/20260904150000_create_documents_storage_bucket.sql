-- Real Supabase Storage integration for Documents (2026-09-04). Replaces the metadata-only
-- stub (a document row with just a client-typed `filename`, no real bytes anywhere) with
-- genuine file upload/download. Local stack only, same discipline as every prior Phase B/UI
-- Wiring stage.
--
-- ============================================================================
-- ★ STORAGE POLICY MECHANISM, investigated before writing this, per instruction — do not
-- assume it works identically to table RLS. Confirmed directly against Supabase's current
-- docs (guides/storage/security/access-control, guides/storage/schema/design):
--   * Storage objects are just rows in a real Postgres table, `storage.objects`
--     (columns include id, bucket_id, name — the full object path/key — owner_id, metadata,
--     created_at). RLS is already enabled on this table by default in every Supabase
--     project; policies on it are ORDINARY `create policy ... on storage.objects` statements,
--     created the same way as any other RLS policy, in a normal SQL migration — not a
--     bucket-specific config mechanism.
--   * The officially recommended pattern for scoping a user to "their own" objects is
--     folder-based, using the built-in `storage.foldername(name)` helper, which splits an
--     object's path into a 1-INDEXED array of its folder segments (excluding the final
--     filename component) — e.g. for `name = 'CLIENT_UUID/uploads/DOC_UUID/report.pdf'`,
--     `(storage.foldername(name))[1] = 'CLIENT_UUID'`, `[2] = 'uploads'`.
--   * `owner_id` (who actually performed the upload) was investigated and DELIBERATELY NOT
--     used for scoping: a PM publishing a "from Marketswave" document uploads it via
--     service_role (see publish-document/index.ts below), so `owner_id` on that object would
--     be the service role's own identity, not the receiving client's — an owner_id-based
--     policy would make a client's own published documents unreadable to them. Folder-path
--     scoping (the object's path itself encodes WHICH CLIENT it belongs to, independent of
--     who performed the write) is the only scheme that works identically for both a client's
--     own upload and a PM's publish-on-behalf-of, mirroring how `public.documents.client_id`
--     already scopes ownership independent of who wrote the row.
--   * `createSignedUrl()` (the real, time-limited download mechanism used everywhere below)
--     requires the caller's session to pass the objects table's own SELECT policy — confirmed
--     via Supabase's own reference docs ("objects table permissions: select"). It is NOT a
--     service-role-only or bucket-config-only operation — a real client session, or a real
--     admin-claimed session, can call it directly, client-side, exactly as long as the SELECT
--     policy below allows that caller to see that row. This is why no separate
--     "generate-download-url" Edge Function is needed for either role.
--
-- ---- PATH CONVENTION, chosen deliberately, not incidental ------------------------------
-- Every stored object's path is `<client_id>/<uploads|published>/<document_row_id>/<filename>`.
--   * `<client_id>` (segment [1]) is the SAME uuid as `public.documents.client_id` — the
--     folder-based RLS check below reads directly off this, with zero lookup into the
--     `documents` table itself (avoiding any RLS-recursion risk a cross-table subquery policy
--     could introduce).
--   * `<uploads|published>` (segment [2]) mirrors the `documents` table's own
--     direction='upload'/'from' distinction, and exists specifically so the client-side DELETE
--     policy below can mirror that table's own DELETE policy's deliberate strengthening
--     (20260902160000's own header: a client may remove their own UPLOADED files, never a
--     document the firm published) — storage.objects has no `direction` column of its own to
--     check directly, so the subfolder name is what encodes it at the storage layer.
--   * `<document_row_id>` (segment [3]) is the SAME uuid as the corresponding `documents.id`
--     row — the client/Edge Function generates this id BEFORE uploading and passes it
--     explicitly as the row's `id` on insert (Postgres allows an explicit value for a
--     default-generated primary key), so the storage path and its owning row are tied
--     together by construction, not by a separately-tracked parallel identifier. This also
--     guarantees path uniqueness (no collision handling needed for same-named files) without
--     mangling the original, human-readable filename, which remains the final path segment.
-- ============================================================================

-- ---- Bucket: private (never public — every read goes through an RLS-checked signed URL, per
-- instruction). file_size_limit is a real, if generous, sanity ceiling (20MB) for a document
-- exchange feature (contracts/statements/scans), not video/media; allowed_mime_types is left
-- unrestricted since a real client could reasonably upload a PDF, DOCX, or image scan and this
-- feature was never asked to gate on file type. on conflict do nothing, matching this schema's
-- own established idempotent-migration convention. ----
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 20971520)
on conflict (id) do nothing;

-- ---- Client: SELECT own files; admin SELECT all — required for createSignedUrl() to work at
-- all for either role (see this file's own header). Scoped to bucket_id = 'documents' so this
-- never accidentally applies to any other future bucket. ----
create policy "documents bucket: clients can view their own files; admins can view all"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- ---- Client: INSERT into their own uploads subfolder only — mirrors documents.html's own
-- direct-upload flow exactly (no Edge Function gates this, same as the `documents` table's own
-- client-INSERT policy). A client can never upload into another client's folder, nor into their
-- OWN 'published' subfolder (that would let them impersonate a firm-published document) —
-- segment [2] must be literally 'uploads'. Publishing a document into a client's 'published'
-- subfolder is reserved for service_role, inside publish-document/index.ts, which bypasses RLS
-- entirely — no separate admin-facing INSERT policy exists or is needed for that path. ----
create policy "documents bucket: clients can upload into their own uploads subfolder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] = 'uploads'
  );

-- ---- Client: DELETE their own uploaded files only — the storage-layer mirror of the
-- `documents` table's own deliberate DELETE strengthening (20260902160000: "a client may
-- remove their own upload, never a document the firm published"). Without this, the Remove
-- action's real storage cleanup (documents.html, added alongside this migration) would need to
-- fall back to a service_role Edge Function for no real reason — the client already has every
-- right to delete their own uploaded bytes, exactly as they already can delete the row itself.
create policy "documents bucket: clients can remove their own uploaded files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] = 'uploads'
  );

-- No UPDATE policy exists or is needed — no feature in this project ever replaces a stored
-- file's bytes in place (the Sign action only changes the `documents` row's status, never the
-- underlying file). No client-side INSERT/DELETE policy exists for the 'published' subfolder —
-- publishing is service_role-only (see publish-document/index.ts); nothing in this project ever
-- deletes a firm-published document's stored file, mirroring the table's own lack of any DELETE
-- path for direction='from' rows.

-- ============================================================================
-- documents.storage_path — the column referencing the real stored object above. Nullable, not
-- NOT NULL: a pre-existing document row created before this migration (this project's own
-- Backend Requirements Register already discloses one real leftover test row with no file
-- behind it) has no real stored object and none should be invented for it — every reader of
-- this column (documents.html, admin-documents.html) is written to treat a null storage_path as
-- a real, honest "no file attached" state, never a crash. Every NEW row going forward (both
-- the client-INSERT policy below and publish-document/index.ts) requires a real, non-null
-- storage_path — enforced at the RLS layer for the client-INSERT path, and by the Edge
-- Function's own upload-before-insert ordering for the service_role publish path.
-- ============================================================================
alter table public.documents add column storage_path text;

-- ---- Extends the existing client-INSERT policy (20260902160000) with the one new
-- requirement this feature adds: a real stored file must exist before the row does. Every
-- other clause is byte-for-byte unchanged from the original policy — see that migration's own
-- comment for the full reasoning behind each existing clause. ALTER POLICY (not drop+recreate)
-- keeps the same policy name and every other property (role, using-clause — none here since
-- this is an insert-only policy) untouched, the smallest possible diff for this one addition.
alter policy "clients can insert their own upload directly, no approval gate"
  on public.documents
  with check (
    auth.uid() = client_id
    and direction = 'upload'
    and category in ('Contracts', 'Statements & Reports', 'General')
    and status = 'Received'
    and is_new = false
    and deadline_label is null
    and storage_path is not null
  );
