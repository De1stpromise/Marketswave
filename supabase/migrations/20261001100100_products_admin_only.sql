-- 2026-10-01 — second half of 20261001100000: the base products table is now readable by admins
-- only. Clients read public.products_catalog, which omits the staff-attribution columns. Applied
-- AFTER the client pages switched to the view (a client reading the base table now gets zero rows,
-- not an error — RLS filters silently).
drop policy "authenticated can view the product catalog" on public.products;
create policy "admins can view the product catalog" on public.products
  for select to authenticated using (public.is_admin());
