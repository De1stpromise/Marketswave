-- Help Center (2026-09-23). Articles live in the database and are edited from the PM tool, so
-- publishing never needs a code change. The blog will reuse this storage, the block model and
-- the editor, which is why nothing here is named "help_" past the tables themselves.
--
-- ★ DRAFT AND PUBLISHED ARE SEPARATE COLUMNS, NOT A VERSION HISTORY. Every publishable field
-- exists twice: the draft column the PM edits, and the pub_ column clients read. Editing a live
-- article changes only the draft side, so what clients see cannot move until Publish copies the
-- draft across. That is what "Unpublished edits" means in the list and the editor, and it is
-- tracked exactly rather than by deep-comparing two jsonb blobs: `draft_dirty` is set by every
-- save and cleared by every publish.
--
-- ★★ THE PUBLISHED-ONLY VIEW IS THE ONLY PUBLIC DOOR, AND THE MECHANISM IS DELIBERATE.
-- `help_articles` itself has NO select policy for anon or authenticated — only an admin can read
-- it — so a draft is unreachable through the table by anyone who is not a manager. The public
-- read goes through `help_articles_public`, a view that selects ONLY published rows and only the
-- pub_ columns. A Postgres view runs with its OWNER's privileges unless `security_invoker` is on
-- (default off, confirmed on PG 17.6 here), so the view can serve published rows while the base
-- table stays closed. That is the whole point: the WHERE clause on the view is the filter, and
-- there is no path around it. DO NOT set security_invoker = on — the view would inherit the base
-- table's RLS, return nothing to a visitor, and the public Help Center would silently go blank.
-- DO NOT add an anon/authenticated select policy to help_articles "to make something work": that
-- reopens drafts to the public, which is the one real risk this feature has.

create table if not exists public.help_topics (
  id          text primary key,
  name        text not null,
  blurb       text,
  icon        text,
  sort_order  int  not null default 0
);

create table if not exists public.help_articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 80),

  -- ---- draft side: what the PM is editing -------------------------------------------------
  topic_id           text references public.help_topics(id) on delete set null,
  title              text,
  question           text,
  lede               text,
  blocks             jsonb not null default '[]'::jsonb,
  related_slugs      text[] not null default '{}',
  in_most_asked      boolean not null default false,
  featured_on_topic  boolean not null default false,
  product_slot       text,

  -- ---- published side: what clients read. NULL published_at means not live. ---------------
  pub_topic_id           text references public.help_topics(id) on delete set null,
  pub_title              text,
  pub_question           text,
  pub_lede               text,
  pub_blocks             jsonb,
  pub_related_slugs      text[],
  pub_in_most_asked      boolean not null default false,
  pub_featured_on_topic  boolean not null default false,
  pub_product_slot       text,
  pub_reading_minutes    int,

  published_at        timestamptz,
  first_published_at  timestamptz,
  draft_dirty         boolean not null default true,

  published_by        uuid references auth.users(id),
  published_by_email  text,
  updated_by          uuid references auth.users(id),
  updated_by_email    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists help_articles_published_idx on public.help_articles (published_at) where published_at is not null;
create index if not exists help_articles_topic_idx     on public.help_articles (topic_id);

-- The public door. Published rows, pub_ columns only — no draft column is even selectable here.
create or replace view public.help_articles_public as
  select slug,
         pub_topic_id          as topic_id,
         pub_title             as title,
         pub_question          as question,
         pub_lede              as lede,
         pub_blocks            as blocks,
         pub_related_slugs     as related_slugs,
         pub_in_most_asked     as in_most_asked,
         pub_featured_on_topic as featured_on_topic,
         pub_product_slot      as product_slot,
         pub_reading_minutes   as reading_minutes,
         published_at
    from public.help_articles
   where published_at is not null;

alter table public.help_articles enable row level security;
alter table public.help_topics   enable row level security;

-- Managers read everything. Nobody else reads this table at all, by any path.
drop policy if exists help_articles_admin_read on public.help_articles;
create policy help_articles_admin_read on public.help_articles
  for select to authenticated using (public.is_admin());

-- No insert/update/delete policy for any client role: every write goes through an Edge Function
-- running as service_role, the same discipline as every Approval Gate table.

-- Topics are reference data: anyone may read them (the landing renders the topic cards before
-- any article exists), nobody but service_role may write them.
drop policy if exists help_topics_read on public.help_topics;
create policy help_topics_read on public.help_topics for select to anon, authenticated using (true);

revoke all on public.help_articles from anon, authenticated;
grant select on public.help_articles to authenticated;   -- still gated by the RLS policy above
grant select on public.help_articles_public to anon, authenticated;

insert into public.help_topics (id, name, blurb, icon, sort_order) values
  ('getting-to-know', 'Getting to know Marketswave', 'How a managed account works, what you can invest in, and who looks after your money.', 'compass', 0),
  ('opening-account', 'Opening your account',        'Signing up, what we ask for, and getting approved.',                 'user-plus', 1),
  ('adding-money',    'Adding money',                'Bank transfers, crypto, and what happens after you send.',          'arrow-down', 2),
  ('investing',       'Investing',                   'Choosing investments, allocating, selling, and your gains.',        'chart',     3),
  ('savings',         'Savings and withdrawals',     'Savings pockets, maturity, and taking money out.',                  'lock',      4),
  ('portfolio',       'Following your portfolio',    'Reading your dashboard, risk metrics, alerts and prices.',          'layout',    5),
  ('documents',       'Documents and your account',  'Your documents, changing details, and getting help.',               'file',      6)
on conflict (id) do nothing;
