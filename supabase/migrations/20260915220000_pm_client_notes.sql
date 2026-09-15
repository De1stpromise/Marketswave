-- PM tool revamp, part 4 — the client profile (register row 233).
--
-- Private notes a PM writes about a client. There was no table for this: the mockup showed the
-- panel, and nothing behind it. Built rather than faked, because the requirement is that
-- author-only is enforced HERE, in RLS, not by a UI filter a second PM could see past.
--
-- ★ AUTHOR-ONLY IS THE WHOLE POINT OF THIS TABLE, AND IT IS A ROW-LEVEL PROPERTY.
-- Multi-PM is real as of Phase C — there are genuinely distinct PM identities now (row 221) —
-- so "visible to you only" has to mean something. Every policy below is scoped to
-- author_id = auth.uid() AND public.is_admin(): a second PM reading the same client's profile
-- gets their own notes and no one else's, and a CLIENT gets nothing at all, ever.
--
-- author_id defaults to auth.uid() and the insert policy pins it, so a PM cannot write a note
-- attributed to a colleague even by crafting the payload directly against PostgREST.
create table public.pm_client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_email text,
  body text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index pm_client_notes_client_author_idx on public.pm_client_notes (client_id, author_id, created_at desc);

alter table public.pm_client_notes enable row level security;

-- Read: your own notes, and only if you are an admin at all.
create policy "pm reads own notes" on public.pm_client_notes
  for select to authenticated
  using (public.is_admin() and author_id = auth.uid());

-- Write: your own notes only. `with check` pins author_id to the caller, so the attribution
-- cannot be forged from the client side.
create policy "pm writes own notes" on public.pm_client_notes
  for insert to authenticated
  with check (public.is_admin() and author_id = auth.uid());

create policy "pm deletes own notes" on public.pm_client_notes
  for delete to authenticated
  using (public.is_admin() and author_id = auth.uid());

-- Deliberately NO update policy: a private note is a dated record of what was thought at the
-- time. Editing one silently rewrites history in a store that may be disclosable on a data
-- access request — see the disclosability line the profile renders beside this panel.
