-- Base tables admin-only for SELECT (2026-10-01, register row 305). Applied ONLY after the client
-- pages read the my_* / advisory_fee_rate_public views from the previous migration. Every Edge
-- Function uses the service role and is unaffected; PM pages keep full rows through is_admin().
-- Realtime on these tables now reaches only PMs: support.html's conversations UPDATE subscription
-- goes quiet for clients, and a status change still reaches them through its system messages row.

drop policy if exists "authenticated can view the advisory fee rate" on public.advisory_fee_rate;
create policy "admins can view advisory_fee_rate" on public.advisory_fee_rate
  for select to authenticated using (public.is_admin());

drop policy if exists "clients can view their own allocation requests; admins can view" on public.allocation_requests;
create policy "admins can view allocation_requests" on public.allocation_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "clients, visitors, and admins can read their own conversation" on public.conversations;
create policy "admins can view conversations" on public.conversations
  for select to authenticated using (public.is_admin());

drop policy if exists "clients see their own assignments; admins see all" on public.deposit_address_assignments;
create policy "admins can view deposit_address_assignments" on public.deposit_address_assignments
  for select to authenticated using (public.is_admin());

drop policy if exists "clients see only their own assigned addresses; admins see all" on public.deposit_addresses;
create policy "admins can view deposit_addresses" on public.deposit_addresses
  for select to authenticated using (public.is_admin());

drop policy if exists "clients can view their own deposit requests; admins can view al" on public.deposit_requests;
create policy "admins can view deposit_requests" on public.deposit_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "clients can view their own hys deposit requests; admins can vie" on public.hys_deposit_requests;
create policy "admins can view hys_deposit_requests" on public.hys_deposit_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "clients can view their own hys withdrawal requests; admins can " on public.hys_withdrawal_requests;
create policy "admins can view hys_withdrawal_requests" on public.hys_withdrawal_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "clients can view their own profile change requests; admins can " on public.profile_change_requests;
create policy "admins can view profile_change_requests" on public.profile_change_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "clients can view their own sell requests; admins can view all" on public.sell_requests;
create policy "admins can view sell_requests" on public.sell_requests
  for select to authenticated using (public.is_admin());

drop policy if exists "clients can view their own withdrawal requests; admins can view" on public.withdrawal_requests;
create policy "admins can view withdrawal_requests" on public.withdrawal_requests
  for select to authenticated using (public.is_admin());
