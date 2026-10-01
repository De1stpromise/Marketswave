-- 2026-10-01 — signed-in clients must not read staff attribution on the product catalog.
-- Every products row carried created_by / created_by_email (the PM who created it), plus the
-- updated_by and retired_by pairs, and the catalog policy granted every signed-in user SELECT on
-- the whole row — so a client could read a staff email address through the API (no page showed it).
--
-- RLS restricts rows, never columns, and every reader asks for select('*'), which a column-level
-- revoke turns into "permission denied for table products" — every client page would break. So:
-- this migration adds the client-facing view; the NEXT migration (20261001100100) narrows the base
-- table to admins. Two migrations so the static pages can switch to the view between them —
-- tightening first would blank the catalog for real clients until the pages caught up.
--
-- The view runs with its OWNER's privileges (security_invoker off, like help_articles_public), which
-- is what lets it keep serving clients once the base table is admin-only. It lists columns
-- explicitly, so a column added to products later is HIDDEN from clients until it is added here —
-- the safe direction for a table that has already leaked staff identities once.
-- retired_reason (PM-entered) and price_failure_reason (provider diagnostics) are internal too, and
-- no client page reads either; they stay out.
create view public.products_catalog as
  select id, name, asset_class, investment_type, risk_tier, minimum_investment, unit_price,
         inception_unit_price, created_at, last_tick_date, description, extended_description,
         logo_url, ticker, pricing_model, price_source, provider_id, price_as_of,
         price_change_percent, price_status, price_last_failed_at, maximum_investment, status,
         retired_at
    from public.products;

revoke all on public.products_catalog from public, anon, authenticated;
grant select on public.products_catalog to authenticated, service_role;
