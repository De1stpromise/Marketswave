-- PM tool revamp, part 1 — the inbox, with ticketing consolidated into it (2026-09-14).
--
-- Until this migration a client could reach a PM four ways landing in three places: live chat
-- and email landed in `conversations`, a support ticket landed in `support_requests` (a
-- separate table, functions, admin page, nav item and notification path), and the "Call Us"
-- tile landed nowhere at all. A ticket-status email went out from noreply@ with no reply-to,
-- so a client hitting Reply arrived through the domain-wide catch-all and was grouped by
-- sender email into a NEW conversation with no link to their ticket.
--
-- After it: a ticket IS a conversation — `kind = 'ticket'`, a category, a per-client
-- display_id, a lifecycle (open → in_progress → resolved → archived) — threaded, so the
-- client can reply and a PM can answer more than once. `support_requests` stays as a
-- MIGRATION SOURCE only (every row is copied into conversations + messages by the function at
-- the bottom, which records where each went and is safe to re-run); nothing live reads it.
--
-- ============================================================================
-- 1. conversations — kind, category, display_id, a wider status.
-- ============================================================================
alter table public.conversations
  add column kind text not null default 'chat' check (kind in ('chat', 'email', 'ticket')),
  -- A ticket's category. The six values are support.html's own five plus 'Callback Request'
  -- (the "Call Us" tile's own real record — it used to validate, toast, and persist nothing).
  add column category text check (category is null or category in ('Transaction Issue', 'Account Access', 'Billing/Fees', 'Document/Signature Issue', 'Other', 'Callback Request')),
  -- DISP-0001 — sequential PER CLIENT, exactly as support_requests.display_id always was
  -- (two clients' first tickets can both be DISP-0001; the partial unique index below keeps
  -- that real, per-client guarantee, never a false global one).
  add column display_id text;

alter table public.conversations drop constraint conversations_status_check;
alter table public.conversations
  add constraint conversations_status_check check (status in ('open', 'in_progress', 'resolved', 'archived'));

create unique index conversations_client_display_id_idx
  on public.conversations (client_id, display_id) where display_id is not null;
create index conversations_kind_idx on public.conversations (kind);

-- ★ THE GROUPING RULE, RESHAPED. "One conversation per contact_email" was the whole model —
-- a chat and a later email from the same person land in one thread. A ticket cannot live
-- under that rule: a client with a general thread AND a ticket (or two tickets) needs several
-- conversations for one email. The rule becomes "one GENERAL (chat/email) thread per
-- contact"; tickets are keyed by display_id instead. Every lookup that finds "the
-- conversation for this email" (findOrCreateConversation, start-chat-conversation,
-- accept-chat-invitation) now excludes kind = 'ticket' — a `.maybeSingle()` against several
-- rows would otherwise throw the moment a client filed their first ticket.
drop index if exists public.conversations_contact_email_unique_idx;
create unique index conversations_contact_email_unique_idx
  on public.conversations (lower(contact_email))
  where contact_email is not null and kind <> 'ticket';

-- Existing rows: `kind` reflects how the thread STARTED — 'email' when its first message
-- travelled by email (an inbound cold email, a PM compose), 'chat' otherwise. The rail view a
-- thread appears in is decided by its MOST RECENT non-system message at render time, not by
-- this column, so a thread that moves from chat to email moves with it.
update public.conversations c
set kind = 'email'
where kind = 'chat'
  and exists (
    select 1 from public.messages m
    where m.conversation_id = c.id
      and m.channel = 'email'
      and m.sent_at = (select min(sent_at) from public.messages where conversation_id = c.id)
  );

-- ============================================================================
-- 2. messages — evidence as a real Storage object, email delivery state, system lines.
-- ============================================================================
-- `channel` keeps its meaning — how each message TRAVELLED — and gains 'system': a status
-- change appears in the thread as a quiet line that travelled nowhere. It is a row so that
-- the thread is one ordered list, not two interleaved sources; rail placement and "most
-- recent message" logic skip it.
alter table public.messages drop constraint messages_channel_check;
alter table public.messages
  add constraint messages_channel_check check (channel in ('chat', 'email', 'system'));

alter table public.messages
  -- Evidence: a real object in the `documents` bucket under the client's own
  -- `<client_id>/uploads/<message_id>/<filename>` — the exact path shape row 132's storage
  -- policies already scope, so a ticket attachment needs ZERO new storage policies: the
  -- client uploads into their own uploads subfolder, reads it back, and an admin reads all.
  add column attachment_path text,
  add column attachment_name text,
  add column attachment_size bigint,
  -- Email delivery state, from Resend's own webhooks (email.delivered / email.opened),
  -- matched back to the message by the id Resend assigned at send time.
  add column resend_id text,
  add column delivery_status text check (delivery_status is null or delivery_status in ('sent', 'delivered', 'opened', 'bounced', 'complained')),
  add column delivered_at timestamptz,
  add column opened_at timestamptz;

create index messages_resend_id_idx on public.messages (resend_id) where resend_id is not null;
create index messages_message_id_idx on public.messages (message_id) where message_id is not null;

-- ============================================================================
-- 3. support_requests becomes a migration source. Nothing live reads it after this; the
--    column below records, per row, the conversation it became — so the migration function
--    is idempotent and the mapping is auditable.
-- ============================================================================
alter table public.support_requests add column migrated_conversation_id uuid references public.conversations(id) on delete set null;

-- A resolved ticket's status came from a PM; keep that attribution on the conversation. The
-- ticket's own PM note (the one-shot "Portfolio Manager Response") becomes a real outbound
-- message the client can answer — that is the point of the consolidation.
create or replace function public.migrate_support_requests_to_conversations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  convo_id uuid;
  migrated integer := 0;
  mapped_status text;
  opened_at timestamptz;
  updated_at timestamptz;
begin
  for r in
    select s.*, c.email as client_email, c.name as client_name
    from public.support_requests s
    left join public.clients c on c.id = s.client_id
    where s.migrated_conversation_id is null
    order by s.date_opened, s.display_id
  loop
    mapped_status := case r.status when 'Open' then 'open' when 'In Progress' then 'in_progress' when 'Resolved' then 'resolved' else 'open' end;
    opened_at := r.date_opened::timestamptz;
    -- last_updated is a DATE; a note written the same day still sorts after the opening
    -- message thanks to the one-second offset.
    updated_at := greatest(r.last_updated::timestamptz, opened_at) + interval '1 second';

    insert into public.conversations (client_id, contact_email, contact_name, kind, category, display_id, subject, status, created_at, unread_by_pm, resolved_by, resolved_by_email, resolved_at)
    values (
      r.client_id,
      coalesce(r.client_email, r.client_id::text || '@unknown.invalid'),
      coalesce(r.client_name, 'Client'),
      'ticket', r.category, r.display_id,
      r.display_id || ' · ' || r.category,
      mapped_status, opened_at,
      false,
      r.resolved_by, r.resolved_by_email,
      case when mapped_status = 'resolved' then r.last_updated::timestamptz else null end
    )
    returning id into convo_id;

    -- The opening description is the ticket's first message. Evidence: only a filename was
    -- ever stored for a migrated ticket (support.html never uploaded bytes before this
    -- consolidation) — attachment_name is kept, attachment_path stays null, and the thread
    -- says so rather than pretending a file exists.
    insert into public.messages (conversation_id, channel, direction, body, sender_name, sender_email, sent_at, attachment_name)
    values (convo_id, 'chat', 'inbound', r.description, coalesce(r.client_name, 'Client'), r.client_email, opened_at, r.evidence);

    if r.pm_note is not null and length(trim(r.pm_note)) > 0 then
      insert into public.messages (conversation_id, channel, direction, body, sender_name, sender_email, sent_at)
      values (convo_id, 'chat', 'outbound', r.pm_note, 'Portfolio Manager', r.resolved_by_email, updated_at);
    end if;

    -- handle_new_message() flagged the inbound insert unread; a migrated ticket is history,
    -- not a new arrival — a PM has already seen it in the old queue. Only a still-open ticket
    -- with no PM note is genuinely still waiting on a reply.
    update public.conversations
    set unread_by_pm = (mapped_status <> 'resolved' and (r.pm_note is null or length(trim(r.pm_note)) = 0))
    where id = convo_id;

    update public.support_requests set migrated_conversation_id = convo_id where id = r.id;
    migrated := migrated + 1;
  end loop;
  return migrated;
end;
$$;

revoke execute on function public.migrate_support_requests_to_conversations() from public, anon, authenticated;

-- Run it now for whatever this environment holds; the function stays for a re-run against
-- rows that arrive later (none should — request-support-ticket writes conversations from
-- here on — but a late row is migrated rather than lost).
select public.migrate_support_requests_to_conversations();
