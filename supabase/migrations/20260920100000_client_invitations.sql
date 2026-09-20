-- PM client creation by invitation (2026-09-20, register row 254).
--
-- "+ Add Client" was a thin form that created a client row directly, with a PM typing the
-- person's details. It becomes an invitation: the PM enters a name and an email address, the
-- person completes signup themselves, and every declaration (date of birth, country, the
-- financial profile, the risk questionnaire, both identity documents) stays attributable to
-- whoever made it. INVITATION ONLY — no proxy creation.
--
-- ★ WHY AN INVITATION IS ITS OWN TABLE AND NOT A clients ROW WITH A STATUS.
--   * clients.id IS auth.users.id (Supabase Migration Stage 1's design), so a client cannot
--     exist before the auth user does — and an invited person has no account until they
--     finish signup. There is nothing to put a clients row's primary key on.
--   * An invitation has states a client never has (sent, opened, expired, revoked), and the
--     same address may be invited more than once over time (a lapsed invitation, then a new
--     one). A per-client status column cannot carry either.
--   * On acceptance it records WHICH client it became (accepted_client_id) and stops being
--     live — the join is from the invitation to the client, never the reverse.
--
-- ★ THE TOKEN IS STORED AS A HASH, NEVER RAW. The raw token exists in exactly one place: the
--   link in the email. A read of this table — a PM's export, a log line, a backup — must not
--   yield a usable signup link for someone else's identity. "Resend" therefore ROTATES the
--   token (a new one is generated and mailed; the old link stops working) rather than needing
--   the raw value back. The table's `token` in the approved shape is `token_hash` here for
--   that reason; everything else matches.
--
-- ★ ACCEPTANCE IS SERVER-SIDE, IN ONE PLACE, AND COVERS BOTH PATHS. A trigger on clients AFTER
--   INSERT resolves any live invitation at the new client's address — so the invited path
--   (link → prefilled signup → clients insert) and the ordinary path (someone signs up
--   normally at an address that happens to hold a live invitation) both land the same way:
--   the signup succeeds and the invitation resolves as accepted against that client, rather
--   than a real signup being blocked by a courtesy link. The signup page carries no accept
--   step of its own; a page can be skipped, a trigger cannot. Mirrors
--   link_conversations_to_new_client() (20260907090000).
--
-- ★ NO CLIENT-SIDE WRITE PATH AT ALL. Reads are admin-only via RLS; every write goes through
--   an admin-only Edge Function (create / resend / revoke — validation, attribution and the
--   email live there), the unauthenticated signup reads a single invitation by its token
--   through get-invitation (service_role, hashed lookup), and acceptance is the trigger.
create table public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  email text not null check (position('@' in email) > 1),
  token_hash text not null unique,
  note text check (note is null or length(note) <= 1000),
  invited_by uuid references auth.users(id) on delete set null,
  invited_by_email text,
  created_at timestamptz not null default now(),
  -- Resend keeps the row and re-mails it; this is the moment the CURRENT link was sent.
  last_sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'sent'
    check (status in ('sent', 'opened', 'accepted', 'expired', 'revoked')),
  opened_at timestamptz,
  accepted_at timestamptz,
  accepted_client_id uuid references public.clients(id) on delete set null
);

comment on table public.client_invitations is
  'PM-issued signup invitations. Its own table: a client cannot exist before its auth user, an invitation has states a client never has, and one address may be invited more than once. token_hash only — the raw token lives in the email.';

-- Email is stored and compared lowercase — the standing convention (2026-09-15) on clients.
create or replace function public.lowercase_invitation_email()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

create trigger client_invitations_lowercase_email
  before insert or update of email on public.client_invitations
  for each row
  execute function public.lowercase_invitation_email();

-- ★ ONE LIVE INVITATION PER ADDRESS, ENFORCED IN THE DATABASE. The Edge Function refuses a
-- duplicate with a reason; this index is what stops two concurrent creates from both passing
-- that check. "Live" is sent|opened — a time-expired row is settled to 'expired' by the
-- functions that touch it (settle-on-touch, the HYS-maturity precedent, row 124) before a new
-- invitation to the same address is inserted, so the index never blocks "Invite again".
create unique index client_invitations_one_live_per_email
  on public.client_invitations (lower(email))
  where status in ('sent', 'opened');

create index client_invitations_status_idx on public.client_invitations (status, expires_at);

alter table public.client_invitations enable row level security;

-- Admin-only READ. There is deliberately no INSERT/UPDATE/DELETE policy for any role —
-- writes are service_role only, through the admin-only Edge Functions and the trigger below.
create policy "pm reads invitations" on public.client_invitations
  for select to authenticated
  using (public.is_admin());

-- ============================================================================
-- Acceptance: any live invitation at a NEW client's address resolves against that client.
-- SECURITY DEFINER because the inserting role (the signing-up user, under RLS) has no write
-- access to client_invitations at all — the same reasoning link_conversations_to_new_client()
-- already gave. Deliberately does NOT require expires_at > now(): if a person whose link lapsed
-- signs up normally, they still became the client the invitation was for, and saying so is
-- more honest than leaving the invitation reading "expired" beside a real account. Revoked
-- and already-accepted invitations are never touched.
-- ============================================================================
create or replace function public.link_invitations_to_new_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.client_invitations
  set status = 'accepted',
      accepted_at = now(),
      accepted_client_id = new.id
  where lower(email) = lower(new.email)
    and status in ('sent', 'opened', 'expired');
  return new;
end;
$$;

create trigger on_client_insert_link_invitations
  after insert on public.clients
  for each row
  execute function public.link_invitations_to_new_client();
