-- Products Catalog Fix (2026-09-03): closes the "PM acts, client never sees it" bug class
-- already fixed once for Documents/Support (row 127), now confirmed present for the Product
-- Catalog (row 128's own flagged finding) -- admin-products.html has been silently managing
-- a local catalog completely disconnected from the real `products` table every already-wired
-- client-facing page (dashboard.html/risk-management.html/asset-collection.html/
-- asset-performance.html) actually reads.
--
-- Confirmed by reading the real, current admin-products.html/engine-core.js source directly
-- before writing this migration, not assumed: the local product-add/edit form's full real
-- field set is name/assetClass/investmentType/riskTier/minimumInvestment/unitPrice (add-only,
-- immutable after creation -- see PRODUCT_EDITABLE_FIELDS's own comment) plus three optional
-- display fields -- description, extendedDescription, logoUrl -- confirmed genuinely missing
-- from this table via engine-core.js's own PRODUCT_EDITABLE_FIELDS array and
-- validateProductFields(). This migration adds exactly those three missing columns; every
-- other field the local form captures already has a real column (Phase B Stage 1).
alter table public.products
  add column description text,
  add column extended_description text,
  add column logo_url text;

-- No RLS changes needed -- RLS is row-level, not column-level; the existing
-- "authenticated can view the product catalog" SELECT policy (Phase B Stage 1) already
-- covers these new columns automatically, the same way it already covers every existing
-- column. Writes remain service_role-only -- no INSERT/UPDATE/DELETE policy for any client
-- role existed before this migration and none is added now; the new add-product/edit-product
-- Edge Functions (admin-only, via getClaims(jwt)) are the only write path, mirroring every
-- other admin-only write in this schema.
