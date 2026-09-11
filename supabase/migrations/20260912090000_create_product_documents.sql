-- ★ Product catalog — fund documents, part 2 of 2 (2026-09-12).
--
-- Every product can carry a full document, authored by a PM in fixed sections (Overview,
-- Strategy, Terms & liquidity, Valuation history, Risks, Attached documents) plus any number
-- of repeatable custom sections, and read by clients once published.
--
-- ---------------------------------------------------------------------------
-- ONE ROW PER PRODUCT, TWO COPIES OF THE CONTENT.
--   content            — the PM's working copy. Every "Save draft" writes here.
--   published_content  — the frozen copy clients read. "Publish" copies content into it.
-- Why two columns rather than a status flag on one: a PM must be able to keep working on a
-- document that is already live (over several sessions) without either hiding it from
-- clients or having half-finished edits go live. With one column, editing a published
-- document would mean either unpublishing first or publishing every keystroke. With two,
-- the draft is invisible to clients BY CONSTRUCTION — they are never handed `content`, only
-- `published_content`, and only through get-product-document (service role). There is no
-- client-side SELECT policy on this table at all, so a draft is unreadable by any client
-- even with a direct table query.
--
-- `status` is kept as an explicit column for the admin list's own convenience, and a CHECK
-- keeps it truthful: published if and only if a published copy exists.
--
-- THE CONTENT ITSELF is a canonical JSON document, never HTML — see
-- functions/_shared/fund-document.ts for the exact model. A rich-text field is a list of
-- blocks (paragraph / bulleted / numbered) made of runs (text + bold/italic flags). The model
-- cannot express a tag, an attribute or a URL, which is what makes "sanitised on the way in"
-- a structural property rather than a filter: the server validates the shape and rejects
-- anything outside it; the renderer builds DOM from text nodes and never touches innerHTML.
--
-- ORDERING is enforced by the same validator: the fixed sections must appear in their fixed
-- order and custom sections only between Valuation history and Risks — a payload that puts
-- a custom section after Risks is refused, not reordered.
-- ---------------------------------------------------------------------------
create table public.product_documents (
  product_id text primary key references public.products(id) on delete cascade,
  content jsonb not null default '{"sections":[]}'::jsonb,
  published_content jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_by_email text,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  published_by_email text,
  constraint product_documents_status_truthful
    check ((status = 'published') = (published_content is not null))
);

alter table public.product_documents enable row level security;

-- Admin-only read. Deliberately NO policy of any kind for a plain authenticated client:
-- clients never read this table directly — the published copy reaches them only through
-- get-product-document, which hands out `published_content` and nothing else. No client-side
-- write path for any role either; every write is service_role via save-product-document.
create policy "admins can view product documents"
  on public.product_documents
  for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- ATTACHED DOCUMENTS (the formal factsheet / prospectus) live in their own private bucket,
-- at `<product_id>/<uuid>/<filename>`. A PM uploads directly from the authoring page under
-- the admin SELECT/INSERT/DELETE policies below (same direct-upload shape documents.html's
-- own client uploads use — see 20260904150000 for the storage-policy mechanism). A client
-- never touches this bucket: their download is a signed URL that get-product-document
-- creates with the service role, and ONLY for the attachment referenced by a PUBLISHED
-- document — so an attachment on a draft is as unreachable as the draft itself.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('fund-documents', 'fund-documents', false, 20971520)
on conflict (id) do nothing;

create policy "fund-documents bucket: admins can view"
  on storage.objects for select to authenticated
  using (bucket_id = 'fund-documents' and public.is_admin());

create policy "fund-documents bucket: admins can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'fund-documents' and public.is_admin());

create policy "fund-documents bucket: admins can remove"
  on storage.objects for delete to authenticated
  using (bucket_id = 'fund-documents' and public.is_admin());
