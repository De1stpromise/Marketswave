-- Blog & Press (2026-09-24) — posts, likes and comments.
--
-- ★ THE SECOND CONSUMER OF THE ARTICLE SYSTEM, NOT A COPY OF IT. _shared/article-blocks.ts and
-- article-render.js were built shared (row 270) and say nothing about "help"; the blog reuses the
-- block model, the renderer, the draft/published column pairs, draft_dirty and the server-side
-- publish checklist. What is new here is what a blog genuinely needs on top and the Help Center
-- has no concept of: a category, a byline, a cover image, likes and comments.
--
-- ★ THE ONLY PUBLIC READS ARE THE TWO VIEWS, AND THAT IS THE WHOLE SECURITY STORY — the same
-- shape the Help Center already proves. blog_posts and blog_comments have NO anon grant and NO
-- anon policy. A Postgres view runs with its OWNER's privileges unless security_invoker is on
-- (default off, PG 17.6), so the views can read tables the caller cannot.
--   DO NOT add an anon policy to either table: it reopens drafts, and worse, it reopens the
--   comment table's client_id and every other account column the public view exists to withhold.
--   DO NOT set security_invoker = on: the views inherit the closed tables' RLS and the blog
--   silently goes blank.
--
-- ★ blog_comments_public IS A PRIVACY BOUNDARY, NOT A CONVENIENCE. A comment row carries the
-- commenting client's id. The public view exposes ONLY: comment id, post id, parent id, the
-- display name, the body, when it was written, and whether it is a Marketswave reply. No
-- client_id, no email, nothing else about the account — the same principle as publishing only
-- pub_ columns, applied to a person rather than to a draft.

-- ============================================================================================
-- 1. POSTS
-- ============================================================================================
create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- ---- draft side ----
  category text check (category in ('explainer', 'private-equity', 'article', 'company-news')),
  title text,
  -- ★ OPTIONAL FOR A POST, REQUIRED FOR A HELP CENTER ARTICLE. "The question it answers" is a
  -- help-centre idea; a post does not have to answer one. The rule lives in the shared
  -- checklist's `kind`, not here — this column is simply nullable on both sides.
  question text,
  lede text,
  blocks jsonb not null default '[]'::jsonb,
  byline text not null default 'Marketswave',
  cover_path text,
  cover_alt text,
  featured boolean not null default false,
  allow_comments boolean not null default true,
  allow_likes boolean not null default true,

  -- ---- published side: only publish-blog-post writes these ----
  pub_category text,
  pub_title text,
  pub_question text,
  pub_lede text,
  pub_blocks jsonb,
  pub_byline text,
  pub_cover_path text,
  pub_cover_alt text,
  pub_featured boolean not null default false,
  pub_allow_comments boolean not null default true,
  pub_allow_likes boolean not null default true,
  pub_reading_minutes integer,

  published_at timestamptz,
  first_published_at timestamptz,
  draft_dirty boolean not null default true,

  published_by uuid references auth.users(id),
  published_by_email text,
  updated_by uuid references auth.users(id),
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ★ ONE FEATURED POST AT A TIME, enforced on the PUBLISHED side because that is what readers
-- see. A partial unique index on a constant expression admits exactly one row where the flag
-- is true. publish-blog-post clears any other first, so the PM never meets this error — the
-- index is what makes that true rather than hoped for.
create unique index blog_posts_one_featured_idx on public.blog_posts ((true)) where pub_featured;

create index blog_posts_published_idx on public.blog_posts (published_at desc) where published_at is not null;
create index blog_posts_category_idx on public.blog_posts (pub_category) where published_at is not null;

-- ============================================================================================
-- 2. COMMENTS
-- ============================================================================================
create table public.blog_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.blog_posts(id) on delete cascade,

  -- ★ ONE LEVEL DEEP. Every reply in a conversation attaches to the ORIGINAL comment, never to
  -- another reply, so a thread cannot become a tree. Enforced by the trigger below, which is
  -- the only thing that can express "my parent must itself have no parent".
  parent_id uuid references public.blog_comments(id) on delete cascade,

  -- NULL for a Marketswave reply: it is written by the firm, not by a client.
  client_id uuid references auth.users(id) on delete set null,
  -- Denormalised at write time from clients.name. A comment must keep reading correctly after
  -- the account is gone, and the public view must never need to join a client table to render.
  display_name text,
  is_marketswave boolean not null default false,

  body text not null check (char_length(btrim(body)) between 1 and 1500),

  -- ★ A PROMPT, NOT A DECISION. A flagged comment is published exactly like any other; the flag
  -- only raises it to the PM. Nothing is hidden automatically.
  flagged boolean not null default false,
  flag_reason text,

  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  removed_by_email text,

  created_at timestamptz not null default now(),

  -- A Marketswave reply has no client; a client comment must have one and a name.
  constraint blog_comments_author_shape check (
    (is_marketswave and client_id is null and display_name is null)
    or (not is_marketswave and client_id is not null and display_name is not null)
  )
);

create index blog_comments_post_idx on public.blog_comments (post_id, created_at);
create index blog_comments_parent_idx on public.blog_comments (parent_id);
create index blog_comments_client_idx on public.blog_comments (client_id, created_at desc);

create or replace function public.blog_comments_one_level_deep()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.blog_comments p where p.id = new.parent_id and p.parent_id is not null) then
      raise exception 'A reply attaches to the original comment, not to another reply.';
    end if;
    -- A reply must live on the same post as the comment it answers.
    if not exists (select 1 from public.blog_comments p where p.id = new.parent_id and p.post_id = new.post_id) then
      raise exception 'A reply must be on the same post as the comment it answers.';
    end if;
  end if;
  return new;
end $$;

create trigger blog_comments_one_level_deep_trg
  before insert or update on public.blog_comments
  for each row execute function public.blog_comments_one_level_deep();

-- ============================================================================================
-- 3. LIKES — one per client per post, enforced by the primary key itself
-- ============================================================================================
create table public.blog_likes (
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, client_id)
);

-- ============================================================================================
-- 4. RLS — nothing client-facing reads these tables directly
-- ============================================================================================
alter table public.blog_posts    enable row level security;
alter table public.blog_comments enable row level security;
alter table public.blog_likes    enable row level security;

-- Admins read everything, including drafts and removed comments.
create policy blog_posts_admin_read    on public.blog_posts    for select to authenticated using (public.is_admin());
create policy blog_comments_admin_read on public.blog_comments for select to authenticated using (public.is_admin());
create policy blog_likes_admin_read    on public.blog_likes    for select to authenticated using (public.is_admin());

-- ★ A CLIENT MAY READ THEIR OWN COMMENTS, and nothing else. This is what lets the notification
-- bell find replies TO them: the page reads its own comment ids here, then reads the replies
-- from blog_comments_public. No notification table is needed and none exists — the bell has
-- always built its items from source rows with per-item read state held locally, and a blog
-- reply is one more source, not a new mechanism.
create policy blog_comments_own_read on public.blog_comments
  for select to authenticated using (client_id = auth.uid());

-- ★ A CLIENT MAY READ THEIR OWN LIKE, and nothing else. It is the only way the page can show a
-- Like button already pressed without asking the server who liked what.
create policy blog_likes_own_read on public.blog_likes
  for select to authenticated using (client_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for any role on any of the three. Every write goes through an
-- Edge Function, because every write has a rule RLS cannot express: an ACTIVE account, a rate
-- limit, a flag decision, a one-level-deep reply, a denormalised display name.
revoke all on public.blog_posts, public.blog_comments, public.blog_likes from anon, authenticated;
grant select on public.blog_posts, public.blog_comments to authenticated;   -- still gated by RLS
grant select on public.blog_likes to authenticated;                          -- still gated by RLS

-- ============================================================================================
-- 5. THE PUBLIC VIEWS
-- ============================================================================================
create view public.blog_posts_public as
select
  id,
  slug,
  pub_category        as category,
  pub_title           as title,
  pub_question        as question,
  pub_lede            as lede,
  pub_blocks          as blocks,
  pub_byline          as byline,
  pub_cover_path      as cover_path,
  pub_cover_alt       as cover_alt,
  pub_featured        as featured,
  pub_allow_comments  as allow_comments,
  pub_allow_likes     as allow_likes,
  pub_reading_minutes as reading_minutes,
  published_at,
  first_published_at
from public.blog_posts
where published_at is not null;

-- ★ EXACTLY SEVEN COLUMNS ABOUT THE COMMENT AND NOTHING ABOUT THE ACCOUNT. Adding a column here
-- is a privacy decision, not a convenience — client_id and email must never appear.
--
-- Removal, per the agreed rule:
--   removed AND it has replies  -> kept as a placeholder with NO name and NO body, so the
--                                  conversation beneath it still makes sense
--   removed AND it has none     -> gone entirely
create view public.blog_comments_public as
select
  c.id,
  c.post_id,
  c.parent_id,
  case when c.removed_at is null then c.display_name end as display_name,
  case when c.removed_at is null then c.body end         as body,
  c.created_at,
  c.is_marketswave,
  (c.removed_at is not null)                             as removed
from public.blog_comments c
where c.removed_at is null
   or exists (select 1 from public.blog_comments r where r.parent_id = c.id and r.removed_at is null);

-- Like counts, without exposing who liked anything.
create view public.blog_like_counts as
select p.id as post_id, count(l.client_id) as likes
from public.blog_posts p
left join public.blog_likes l on l.post_id = p.id
where p.published_at is not null
group by p.id;

grant select on public.blog_posts_public    to anon, authenticated;
grant select on public.blog_comments_public to anon, authenticated;
grant select on public.blog_like_counts     to anon, authenticated;

-- ============================================================================================
-- 6. THE SHARED IMAGE BUCKET — built once, used by blog covers AND Help Center image blocks
-- ============================================================================================
-- Public-read, following the asset-logos pattern: a cover image must be readable by an
-- anonymous visitor, so this is the one bucket shape that fits. Writes are admin-only and go
-- through upload-article-image; there is deliberately no client-side INSERT policy at all.
insert into storage.buckets (id, name, public, file_size_limit)
values ('article-images', 'article-images', true, 5242880)
on conflict (id) do nothing;

drop policy if exists "article images: public read" on storage.objects;
create policy "article images: public read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'article-images');
