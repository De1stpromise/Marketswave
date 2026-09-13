-- ★ Asset logos (2026-09-13, row 207).
--
-- Every asset name on the client dashboard, the catalog, the holdings table and the admin
-- catalog now carries one circular mark: a real logo where a provider has one, a
-- deterministic monogram where it does not. The logo bytes are resolved ONCE, server-side,
-- and stored in this project's own storage — a dashboard load makes zero provider requests.
--
-- 1. market_data_cache.logo_url — the resolved, first-party URL for a watched symbol.
--    products.logo_url already exists (20260903120000) and is reused for catalog products.
--    Nullable: a symbol nobody has a logo for keeps null and renders its monogram; never a
--    placeholder URL.
--    The scheduled refresh upserts whole rows into this table, but its payload never carries
--    logo_url (see _shared/market-refresh.ts toRow()), so an upsert leaves a stored logo_url
--    untouched — PostgREST only SETs the columns present in the payload.
alter table public.market_data_cache add column if not exists logo_url text;

-- 2. A PUBLIC bucket for the resolved images. Public on purpose: a logo is not client data,
--    it is the same image for every client, and a public bucket is what lets a plain <img>
--    load it with normal browser caching and no signed URL round trip. Written ONLY by
--    service_role (the resolver) — no client-side INSERT/UPDATE/DELETE policy exists for any
--    role, so nothing a client can do puts bytes here.
insert into storage.buckets (id, name, public, file_size_limit)
values ('asset-logos', 'asset-logos', true, 1048576)
on conflict (id) do nothing;

drop policy if exists "asset logos are readable by anyone" on storage.objects;
create policy "asset logos are readable by anyone"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'asset-logos');
