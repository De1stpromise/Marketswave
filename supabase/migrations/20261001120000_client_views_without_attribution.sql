-- Client-facing views without staff attribution (2026-10-01, register row 305; row 304's shape).
--
-- RLS restricts rows, not columns, so a client could read the PM's email on their own request
-- rows (resolved_by_email), on the advisory fee rate, on their conversations and on their deposit
-- addresses. Clients now read these views; the base tables become admin-only in the NEXT migration,
-- which ships only after the pages read the views (tightening first blanks every client page).
--
-- * A view runs with its OWNER's privileges (no security_invoker - row 270), so it does NOT see the
-- base table's RLS: each view repeats its table's own-rows filter exactly, or a client would read
-- every client's rows. security_barrier keeps that filter from being bypassed by a leaky predicate.
-- A new column a client needs must be ADDED HERE, or it is silently absent from client pages.

create or replace view public.my_allocation_requests with (security_barrier) as
  select id, client_id, product_id, requested_amount, status, requested_at, resolved_at, transaction_id, reason
  from public.allocation_requests
  where client_id = auth.uid();
revoke all on public.my_allocation_requests from public, anon, authenticated;
grant select on public.my_allocation_requests to authenticated, service_role;

create or replace view public.my_sell_requests with (security_barrier) as
  select id, client_id, product_id, units_to_sell, status, requested_at, resolved_at, transaction_id, reason
  from public.sell_requests
  where client_id = auth.uid();
revoke all on public.my_sell_requests from public, anon, authenticated;
grant select on public.my_sell_requests to authenticated, service_role;

create or replace view public.my_withdrawal_requests with (security_barrier) as
  select id, client_id, method, requested_amount, currency, destination_details, status, requested_at, resolved_at, approved_amount, transaction_id, reason
  from public.withdrawal_requests
  where client_id = auth.uid();
revoke all on public.my_withdrawal_requests from public, anon, authenticated;
grant select on public.my_withdrawal_requests to authenticated, service_role;

create or replace view public.my_deposit_requests with (security_barrier) as
  select id, client_id, method, requested_amount, currency, details, status, requested_at, resolved_at, credited_amount, transaction_id, reason, network, deposit_address_id, tx_hash
  from public.deposit_requests
  where client_id = auth.uid();
revoke all on public.my_deposit_requests from public, anon, authenticated;
grant select on public.my_deposit_requests to authenticated, service_role;

create or replace view public.my_hys_deposit_requests with (security_barrier) as
  select id, client_id, pocket_type, term_mode, term_months, term_years, term_label, rate, term_in_years, requested_amount, method, currency, details, status, requested_at, resolved_at, credited_amount, pocket_id, transaction_id, reason
  from public.hys_deposit_requests
  where client_id = auth.uid();
revoke all on public.my_hys_deposit_requests from public, anon, authenticated;
grant select on public.my_hys_deposit_requests to authenticated, service_role;

create or replace view public.my_hys_withdrawal_requests with (security_barrier) as
  select id, client_id, pocket_id, pocket_type, term_label, forfeit, receive_amount, method, destination_details, status, requested_at, resolved_at, transaction_id, reason
  from public.hys_withdrawal_requests
  where client_id = auth.uid();
revoke all on public.my_hys_withdrawal_requests from public, anon, authenticated;
grant select on public.my_hys_withdrawal_requests to authenticated, service_role;

create or replace view public.my_profile_change_requests with (security_barrier) as
  select id, client_id, field, current_value, requested_value, reason, status, requested_at, resolved_at, resolution_note
  from public.profile_change_requests
  where client_id = auth.uid();
revoke all on public.my_profile_change_requests from public, anon, authenticated;
grant select on public.my_profile_change_requests to authenticated, service_role;

create or replace view public.my_conversations with (security_barrier) as
  select id, client_id, visitor_auth_id, contact_email, contact_name, status, last_message_at, unread_by_pm, created_at, resolved_at, last_notified_at, subject, kind, category, display_id
  from public.conversations
  where client_id = auth.uid() or visitor_auth_id = auth.uid();
revoke all on public.my_conversations from public, anon, authenticated;
grant select on public.my_conversations to authenticated, service_role;

create or replace view public.my_deposit_addresses with (security_barrier) as
  select id, currency, network, address, label, status, created_at, retired_at
  from public.deposit_addresses
  where exists (select 1 from public.deposit_address_assignments a where a.address_id = deposit_addresses.id and a.client_id = auth.uid() and a.removed_at is null);
revoke all on public.my_deposit_addresses from public, anon, authenticated;
grant select on public.my_deposit_addresses to authenticated, service_role;

create or replace view public.advisory_fee_rate_public with (security_barrier) as
  select id, rate, updated_at
  from public.advisory_fee_rate
  where true;
revoke all on public.advisory_fee_rate_public from public, anon, authenticated;
grant select on public.advisory_fee_rate_public to authenticated, service_role;

-- ★ The messages policies looked conversations up under the CALLER's own access. The next migration
-- makes conversations admin-only for SELECT, after which those subqueries would see nothing and
-- every client and chat visitor would lose their messages and the ability to send one (Realtime
-- included). Ownership is read through a definer helper instead; it answers only "is this
-- conversation the caller's", for the caller. Applied here, in the safe phase: while conversations
-- is still client-readable it is equivalent, and it must be live before the tightening lands.
create or replace function public.owns_conversation(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv and (c.client_id = auth.uid() or c.visitor_auth_id = auth.uid())
  );
$$;
revoke all on function public.owns_conversation(uuid) from public, anon;
grant execute on function public.owns_conversation(uuid) to authenticated, service_role;

alter policy "clients, visitors, and admins can read messages in their own co" on public.messages
  using (public.owns_conversation(conversation_id) or public.is_admin());
alter policy "clients and visitors can send inbound messages in their own con" on public.messages
  with check (direction = 'inbound' and public.owns_conversation(conversation_id));
