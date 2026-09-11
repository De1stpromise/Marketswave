-- ★ Crypto deposit routing (2026-09-11).
--
-- Until now a crypto deposit request captured a method and an amount, and a PM credited
-- it. No address existed anywhere — the client was never told where to send funds. This
-- migration adds the address book (shared across all PMs), per-client assignments, and the
-- changes to deposit_requests that a request-without-an-amount needs.
--
-- ---------------------------------------------------------------------------
-- deposit_routes — the four DISTINCT things a client can send. Seeded, not PM-editable.
--
-- "Seed the four real entries" is read as these four currency+network ROUTES, not four
-- real wallet addresses (none were supplied, and a seeded placeholder address that a client
-- could be shown is exactly the unrecoverable-loss case this whole feature exists to
-- prevent). A route is what the client-facing form offers as an option and what an address
-- is added AGAINST; USDT on TRC-20 and USDT on ERC-20 are two rows here because they are
-- two separate things, which is the reason the client form never shows "USDT" with a
-- network toggle.
--
-- `address_format` names the structural validation rule an address on this route must
-- pass (see _shared/deposit-address-validation.ts). ETH and USDT-ERC-20 share 'evm': the
-- same 0x address serves both, and a PM may well add the same address twice under the two
-- routes — that is allowed (uniqueness below is per route), because they are still two
-- separate client-facing choices with two separate warnings.
-- ---------------------------------------------------------------------------
create table public.deposit_routes (
  currency text not null,
  network text not null,
  currency_name text not null,
  network_label text not null,
  address_format text not null check (address_format in ('btc', 'evm', 'tron')),
  display_order integer not null,
  primary key (currency, network)
);

alter table public.deposit_routes enable row level security;

create policy "any signed-in user can read the deposit routes"
  on public.deposit_routes for select to authenticated using (true);

insert into public.deposit_routes (currency, network, currency_name, network_label, address_format, display_order) values
  ('BTC',  'Bitcoin', 'Bitcoin',  'Bitcoin network',  'btc',  1),
  ('USDT', 'TRC-20',  'Tether',   'TRC-20 · Tron',    'tron', 2),
  ('USDT', 'ERC-20',  'Tether',   'ERC-20 · Ethereum','evm',  3),
  ('ETH',  'ERC-20',  'Ethereum', 'ERC-20',           'evm',  4);

-- ---------------------------------------------------------------------------
-- deposit_addresses — the shared address book. One row per (route, address).
--
-- status is DERIVED, never set by a caller: 'available' on insert, 'assigned' once any
-- client is on it, 'retired' once the last client is removed. The triggers below own every
-- transition; the Edge Functions never write this column. That is what makes retirement a
-- server-side guarantee rather than a UI convention.
-- ---------------------------------------------------------------------------
create table public.deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  currency text not null,
  network text not null,
  address text not null,
  label text,
  status text not null default 'available' check (status in ('available', 'assigned', 'retired')),
  created_by uuid references auth.users(id),
  created_by_email text,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  foreign key (currency, network) references public.deposit_routes (currency, network),
  unique (currency, network, address)
);

alter table public.deposit_addresses enable row level security;

-- ---------------------------------------------------------------------------
-- deposit_address_assignments — MANY clients per address.
--
-- Soft-removed (removed_at), never deleted: the address book's own "Previously N clients"
-- on a retired row, and the audit of who was on an address when funds arrived, both depend
-- on the history surviving the removal.
--
-- currency/network are DENORMALISED here from the address (copied by trigger, never
-- caller-supplied) so that "a client has at most one address per currency+network" can be
-- a real partial unique index rather than an application-level check that two concurrent
-- assigns could both pass.
-- ---------------------------------------------------------------------------
create table public.deposit_address_assignments (
  id uuid primary key default gen_random_uuid(),
  address_id uuid not null references public.deposit_addresses(id),
  client_id uuid not null references auth.users(id) on delete cascade,
  currency text not null,
  network text not null,
  assigned_by uuid references auth.users(id),
  assigned_by_email text,
  assigned_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  removed_by_email text
);

alter table public.deposit_address_assignments enable row level security;

create index deposit_address_assignments_address_idx on public.deposit_address_assignments (address_id);
create index deposit_address_assignments_client_idx on public.deposit_address_assignments (client_id);

create unique index deposit_address_assignments_one_active_per_route
  on public.deposit_address_assignments (client_id, currency, network)
  where removed_at is null;

-- A client cannot be assigned to the SAME address twice while still on it either (the
-- per-route index above already implies this, since an address has one route — kept
-- explicit so the intent reads without deriving it).
create unique index deposit_address_assignments_one_active_per_address
  on public.deposit_address_assignments (client_id, address_id)
  where removed_at is null;

-- ---------------------------------------------------------------------------
-- ★ RETIREMENT, NOT REUSE — enforced in the database.
--
-- Funds can still arrive at a retired address from a wallet where a client saved it, so
-- reassigning it to anyone new would misattribute them. Three triggers make that
-- structurally impossible rather than merely unimplemented in the UI:
--
--   1. before insert on assignments: copy currency/network from the address, and RAISE if
--      the address is retired. This is the guard. It fires for every caller — the
--      assign-deposit-address Edge Function, a service_role script, a direct SQL insert.
--   2. after insert/update on assignments: recompute the address's status from its active
--      assignment count. available -> assigned on the first; assigned -> retired when the
--      last one is removed. An address that was NEVER assigned stays 'available' — it has
--      no history a wallet could be holding.
--   3. before update on deposit_addresses: once 'retired', status cannot change. This
--      closes the one path the first two do not cover — an UPDATE that flips the status
--      column back to 'available' and then assigns.
-- ---------------------------------------------------------------------------
create or replace function public.deposit_address_assignment_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  addr record;
begin
  select currency, network, status into addr from public.deposit_addresses where id = new.address_id;
  if addr is null then
    raise exception 'Unknown deposit address: %', new.address_id;
  end if;
  if addr.status = 'retired' then
    raise exception 'DEPOSIT_ADDRESS_RETIRED: this address has been retired and cannot be assigned to anyone new. Funds may still arrive at it from a wallet that saved it, so reusing it would misattribute them.';
  end if;
  new.currency := addr.currency;
  new.network := addr.network;
  return new;
end;
$$;

create trigger deposit_address_assignments_before_insert
  before insert on public.deposit_address_assignments
  for each row execute function public.deposit_address_assignment_before_insert();

create or replace function public.deposit_address_recompute_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.address_id, old.address_id);
  active_count integer;
  current_status text;
begin
  select count(*) into active_count
    from public.deposit_address_assignments
   where address_id = target and removed_at is null;
  select status into current_status from public.deposit_addresses where id = target;

  if current_status = 'retired' then
    return null; -- terminal; nothing recomputes it
  end if;

  if active_count > 0 then
    update public.deposit_addresses set status = 'assigned' where id = target and status <> 'assigned';
  elsif current_status = 'assigned' then
    -- The last client has been removed. Not back to 'available' — retired, permanently.
    update public.deposit_addresses set status = 'retired', retired_at = now() where id = target;
  end if;
  return null;
end;
$$;

create trigger deposit_address_assignments_recompute_status
  after insert or update on public.deposit_address_assignments
  for each row execute function public.deposit_address_recompute_status();

create or replace function public.deposit_address_before_update()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'DEPOSIT_ADDRESS_RETIRED: a retired address cannot be made available again.';
  end if;
  return new;
end;
$$;

create trigger deposit_addresses_before_update
  before update on public.deposit_addresses
  for each row execute function public.deposit_address_before_update();

-- ---------------------------------------------------------------------------
-- RLS. A client can only ever SEE an address currently assigned to them; an admin sees
-- everything. No client-side write path exists on either table for any role — every write
-- goes through an admin-only Edge Function (attribution + validation), and the triggers
-- above hold regardless of who writes.
-- ---------------------------------------------------------------------------
create policy "clients see only their own assigned addresses; admins see all"
  on public.deposit_addresses for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.deposit_address_assignments a
       where a.address_id = deposit_addresses.id
         and a.client_id = auth.uid()
         and a.removed_at is null
    )
  );

create policy "clients see their own assignments; admins see all"
  on public.deposit_address_assignments for select to authenticated
  using (public.is_admin() or client_id = auth.uid());

-- ---------------------------------------------------------------------------
-- ★ THE REQUEST CARRIES NO AMOUNT (crypto only).
--
-- The PM determines what arrived from the chain, so a crypto request stores no
-- requested_amount at all — not zero, not a client guess. requested_amount was
-- `not null check (> 0)`; it becomes nullable with the positivity check kept for any value
-- that IS present, and a second constraint keeps it REQUIRED for bank transfers, whose
-- flow is unchanged. Pre-existing crypto rows (which do carry an amount) remain valid.
--
-- deposit_address_id snapshots WHICH address the client was shown at submit time — the
-- attribution anchor a PM reconciles against, and the join behind "last deposit" on the
-- address book. tx_hash is the client's optional transaction id.
-- ---------------------------------------------------------------------------
alter table public.deposit_requests alter column requested_amount drop not null;
alter table public.deposit_requests drop constraint deposit_requests_requested_amount_check;
alter table public.deposit_requests add constraint deposit_requests_requested_amount_check
  check (requested_amount is null or requested_amount > 0);
alter table public.deposit_requests add constraint deposit_requests_bank_requires_amount
  check (method <> 'bank' or requested_amount is not null);

alter table public.deposit_requests add column network text;
alter table public.deposit_requests add column deposit_address_id uuid references public.deposit_addresses(id);
alter table public.deposit_requests add column tx_hash text;

create index deposit_requests_deposit_address_idx on public.deposit_requests (deposit_address_id);
