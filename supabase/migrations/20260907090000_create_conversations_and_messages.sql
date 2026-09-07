-- Unified Communications Inbox — Stage 1 (2026-09-07): the conversation model + live chat.
-- Schema is deliberately designed for BOTH chat (this stage) and two-way email (Stage 2) from
-- day one, per instruction — messages.channel/direction plus the nullable email-specific
-- columns (message_id/in_reply_to) mean Stage 2 needs zero schema changes, only a new Edge
-- Function (an inbound-email webhook) and outbound-email sending, both writing into the exact
-- same two tables a chat message already writes into.

-- ============================================================================
-- conversations — one row per real contact_email (the task's own explicit grouping rule),
-- not one row per channel or per session. A message from an email that already has a
-- conversation joins that thread regardless of whether it arrived via chat or (in Stage 2)
-- email.
-- ============================================================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- Real registered client link — set automatically (see the retroactive-linking trigger
  -- below) whenever contact_email matches a real clients.email, whether that link exists at
  -- creation time or is discovered later, when a previously-anonymous visitor signs up.
  client_id uuid references auth.users(id),
  -- ★ A necessary addition beyond the task's own literal column list, flagged per this
  -- project's own standing convention rather than silently added: an anonymous chat visitor
  -- has no client_id at all (no real account), yet still needs a real, RLS-enforceable
  -- identity to read their own conversation back and receive real-time updates — see this
  -- migration's own header comment further down (near the RLS policies) for the full
  -- "why signInAnonymously(), not a hand-rolled token" reasoning.
  visitor_auth_id uuid references auth.users(id),
  contact_email text not null,
  contact_name text,
  status text not null default 'open' check (status in ('open', 'resolved', 'archived')),
  last_message_at timestamptz,
  unread_by_pm boolean not null default true,
  created_at timestamptz not null default now(),
  -- PM attribution (mirrors Backend Migration Phase C — Stage 1's own real per-PM
  -- attribution pattern, applied here from the start rather than retrofitted later) — set by
  -- admin-update-conversation whenever a PM resolves/archives a conversation, never by any
  -- client-facing write.
  resolved_by uuid references auth.users(id),
  resolved_by_email text,
  resolved_at timestamptz,
  -- Idle-debounce state for notify-new-chat-message (a real, disclosed design decision, per
  -- instruction, over trying to track live PM presence): a PM email notification only fires
  -- if enough real time has passed since the last one for THIS conversation, regardless of
  -- how many inbound messages arrived in between — see that function's own header for the
  -- full reasoning.
  last_notified_at timestamptz
);

-- Enforces the grouping rule at the database level, not just in application code — a second
-- attempt to create a conversation for an email that already has one fails outright rather
-- than silently duplicating, race-safe under real concurrent chat starts.
create unique index conversations_contact_email_unique_idx on public.conversations (lower(contact_email));

create index conversations_client_id_idx on public.conversations (client_id);
create index conversations_visitor_auth_id_idx on public.conversations (visitor_auth_id);
create index conversations_status_idx on public.conversations (status);
create index conversations_last_message_at_idx on public.conversations (last_message_at desc);

-- ============================================================================
-- messages — one row per real chat message (this stage) or email (Stage 2), always
-- belonging to exactly one conversation. message_id/in_reply_to are Stage 2's own real email
-- Message-ID/In-Reply-To headers — nullable and unused by this stage's chat-only messages,
-- present now so Stage 2 adds zero schema.
-- ============================================================================
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  channel text not null check (channel in ('chat', 'email')),
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  sender_name text,
  sender_email text,
  sent_at timestamptz not null default now(),
  message_id text,
  in_reply_to text
);

create index messages_conversation_id_idx on public.messages (conversation_id, sent_at);
-- Real full-text search over message body — the admin inbox's own "search across contact
-- name, email, and message body" requirement (row 4 of this stage's own task) needs this to
-- stay fast rather than fetching every message client-side; contact name/email search stays
-- plain ILIKE (small, already-indexed-enough columns on conversations directly).
create index messages_body_fts_idx on public.messages using gin (to_tsvector('english', body));

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- ============================================================================
-- RLS — investigated and decided per instruction, not assumed.
--
-- ★ ANONYMOUS VISITORS: Supabase's real Anonymous Sign-ins feature (signInAnonymously(),
-- enabled below via config.toml's auth.enable_anonymous_sign_ins) is used instead of a
-- hand-rolled session-token scheme. A hand-rolled token would need its own verification
-- Edge Function on every single read/write and would never integrate with Realtime's own
-- RLS-aware postgres_changes subscriptions at all (Realtime evaluates RLS using the same
-- auth.uid()/auth.jwt() every other policy in this project already relies on — a bespoke
-- token is invisible to it). A real anonymous sign-in issues a REAL JWT with role
-- 'authenticated' and is_anonymous: true, giving visitor_auth_id a genuine, unforgeable
-- identity RLS and Realtime both already know how to enforce, at zero new infrastructure
-- cost — the same mechanism this project's own real clients already use, just without a
-- password.
--
-- ★ A REAL, DISCLOSED SECURITY EDGE CASE, not silently smoothed over: the task's own
-- grouping rule ("a message from an email that already has a conversation joins that
-- thread") is deliberately honored for WRITES (any session, anonymous or not, that submits
-- the correct contact_email can add a message to the existing thread — start-chat-
-- conversation's own service_role logic handles this, see that function's header) but NOT
-- automatically extended to READS. visitor_auth_id is set ONCE, at a conversation's genuine
-- creation time, and is never reassigned to a later, different anonymous session that merely
-- types the same email — reassigning it would let anyone who knows/guesses a real email
-- address read that person's ENTIRE prior chat history, a real information-disclosure risk
-- this project's own "do NOT make conversations publicly readable" instruction explicitly
-- warned against. A second anonymous session continuing the same email-grouped conversation
-- can therefore always successfully SEND a new message into it, but only ever sees that
-- message (and anything after it, via Realtime) — never the pre-existing history, unless it
-- happens to be the SAME original session (the common real case: the same browser tab/
-- persisted anonymous session continuing across page loads). This mirrors real-world email's
-- own trust model (anyone who knows an address can write "as" it) while still protecting
-- READ access, which is the actual sensitive operation.
-- ============================================================================

create policy "clients, visitors, and admins can read their own conversation"
  on public.conversations
  for select
  to authenticated
  using (
    client_id = auth.uid()
    or visitor_auth_id = auth.uid()
    or public.is_admin()
  );

-- No INSERT/UPDATE policy for any client-facing role, admin included — conversation creation
-- (start-chat-conversation, the real find-or-create-by-email logic) and every PM action
-- (admin-update-conversation) both go through service_role, mirroring hys_pockets'/
-- support_requests' own "no client-side write path at all" precedent for exactly this reason:
-- creation needs a privileged pre-check (does a conversation already exist for this email —
-- a fresh anonymous session structurally cannot safely run that query itself, since RLS would
-- correctly hide any conversation it doesn't yet own) and status changes need real PM
-- attribution, neither of which a bare RLS policy can express safely.

create policy "clients, visitors, and admins can read messages in their own conversation"
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.client_id = auth.uid() or c.visitor_auth_id = auth.uid())
    )
    or public.is_admin()
  );

-- Real clients and anonymous visitors send directly (no Edge Function hop) once their
-- conversation already exists and their own auth.uid() is genuinely linked to it — keeps
-- live chat latency low, matching the task's own "genuinely good inbox... effortless" bar.
-- direction is server-enforced via this CHECK, not trusted from any client input elsewhere.
create policy "clients and visitors can send inbound messages in their own conversation"
  on public.messages
  for insert
  to authenticated
  with check (
    direction = 'inbound'
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.client_id = auth.uid() or c.visitor_auth_id = auth.uid())
    )
  );

-- PM replies also send directly (no Edge Function needed — no privileged pre-check like
-- creation needs, and no attribution field on messages itself to populate, unlike
-- conversations.resolved_by) — any admin may reply in any conversation, matching "Admin
-- reads all" extended symmetrically to writes for this one action.
create policy "admins can send outbound messages in any conversation"
  on public.messages
  for insert
  to authenticated
  with check (
    direction = 'outbound'
    and public.is_admin()
  );

-- ============================================================================
-- handle_new_message() — the single source of truth for conversations.last_message_at/
-- unread_by_pm, fired from a real trigger rather than duplicated in every real caller
-- (chat's own direct RLS insert today; Stage 2's inbound-email webhook and PM-reply sending,
-- tomorrow) — exactly the "design for both from the start" instruction applied to this
-- specific piece of logic. SECURITY DEFINER so it can update conversations even when the
-- inserting caller (an anonymous visitor) has no UPDATE grant on that table at all.
-- ============================================================================
create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.sent_at,
      unread_by_pm = case when new.direction = 'inbound' then true else unread_by_pm end
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger on_message_insert
  after insert on public.messages
  for each row
  execute function public.handle_new_message();

-- ============================================================================
-- Retroactive linking (2026-09-07) — investigated per instruction: "a trigger, or a check in
-- the signup flow." A TRIGGER on clients' own real insert path was chosen over a signup-flow
-- check for two real reasons: (1) it fires regardless of WHICH real path creates a client —
-- signup.html's own direct insert today, but also any future admin-created client (Client
-- List's own real "Add Client" form) — a signup-flow-only check would silently miss that
-- second, already-real path; (2) it needs no RLS gymnastics for the freshly-signed-up client
-- to be granted UPDATE on a conversations row it doesn't yet "own" via client_id (which is
-- exactly the NULL value being filled in) — a SECURITY DEFINER trigger bypasses that entirely,
-- the same reasoning handle_new_message() above already established for this migration.
-- ============================================================================
create or replace function public.link_conversations_to_new_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set client_id = new.id
  where client_id is null
    and lower(contact_email) = lower(new.email);
  return new;
end;
$$;

create trigger on_client_insert_link_conversations
  after insert on public.clients
  for each row
  execute function public.link_conversations_to_new_client();

-- ============================================================================
-- Realtime — both tables added to the real supabase_realtime publication so the chat widget
-- (client/visitor side) and the admin inbox (PM side) both receive genuinely live
-- postgres_changes events, not polling. Realtime respects the same RLS policies above, so a
-- visitor's own subscription naturally only ever receives events for conversations/messages
-- they're already allowed to SELECT — no separate Realtime-specific security surface.
--
-- REPLICA IDENTITY FULL is required on both tables for that RLS-aware filtering to actually
-- work: Realtime evaluates each subscriber's RLS policies against the row data carried in the
-- WAL change record itself, and Postgres's default replica identity only includes the primary
-- key — nowhere near enough data (e.g. client_id/visitor_auth_id, the exact columns the SELECT
-- policies above key off) for that evaluation to succeed. Without this, postgres_changes
-- events are silently never delivered to any authenticated/anon subscriber (a real, confirmed
-- finding from this migration's own UI verification, not a defensive guess).
-- ============================================================================
alter table public.conversations replica identity full;
alter table public.messages replica identity full;

alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
