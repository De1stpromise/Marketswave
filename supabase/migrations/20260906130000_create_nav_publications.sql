-- Backend Migration Phase D — NAV feature (2026-09-06): real PM-published NAV for Private
-- Equity / Real Assets, replacing the simulated settlement tick for these two asset classes
-- specifically. Local stack only, per instruction — nothing here touches the real cloud
-- "Marketswave Staging" project.
--
-- ---- Why this table exists, read directly against the real settlement mechanic before
-- writing anything (_shared/portfolio-engine.ts's settleProduct()/settleAllProducts(), a
-- faithful port of engine-core.js's own function): settleProduct() already has ONE early
-- return for 'Unallocated / Cash' (never ticks, no riskTier volatility concept applies) —
-- this feature adds a second, symmetric early return for 'Private Equity'/'Real Assets',
-- exactly the same shape, not a new mechanism bolted alongside the existing one. It's called
-- from settleAllProducts() (get-account-state, get-holdings, computeTotalPortfolioValue() —
-- itself shared by get-total-portfolio-value and get-portfolio-monthly-change) and
-- settleOneProduct() (execute-buy/execute-sell, settling only the one product being traded)
-- — every one of these call sites is UNCHANGED by this migration; the carve-out lives
-- entirely inside settleProduct() itself, so it's inherited by every caller for free. This is
-- the realistic behavior being modeled: a real illiquid valuation (a PE fund, a real estate
-- trust) doesn't move on a simulated daily basis the way a real-time-quoted equity does — it
-- stays flat between periodic real appraisals, and only a PM publishing a new NAV moves it.
--
-- ---- Local-only note: engine-core.js's own local settleProduct()/settleAllProducts() are
-- confirmed (via a project-wide grep of every .html file) to have ZERO remaining callers on
-- any live client-facing or admin page — every page that ever read pricing now reads it via
-- the real Supabase Edge Functions above. The carve-out is therefore built ONLY in
-- _shared/portfolio-engine.ts; engine-core.js's own copy is left untouched (still exercised
-- by this project's own historical Node regression scripts, out of scope for a real-backend
-- feature).
--
-- ---- Attribution, per Phase C — Stage 1's own established pattern: `published_by`/
-- `published_by_email`, mirroring products.created_by/created_by_email exactly (captured
-- from the calling admin's own already-verified JWT claims, never trusted from the request
-- body). NULLABLE — the one-time backfill below inserts a SYSTEM publication (no real PM
-- action), not a fabricated admin identity.

create table public.nav_publications (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id),
  published_unit_price numeric not null check (published_unit_price > 0),
  published_by uuid references auth.users(id),
  published_by_email text,
  published_at timestamptz not null default now(),
  effective_date date not null,
  note text,
  created_at timestamptz not null default now()
);

create index nav_publications_product_id_idx on public.nav_publications (product_id, effective_date desc);

alter table public.nav_publications enable row level security;

-- Admin-only read — mirrors the Security Log's own "a financial/administrative history
-- record, not something a plain client needs raw access to" precedent. A client-facing
-- "Last valued" indicator (asset-performance.html) reads products.last_tick_date directly
-- instead (see below) rather than needing its own SELECT policy on this table.
create policy "admins can view NAV publication history"
  on public.nav_publications
  for select
  to authenticated
  using (public.is_admin());

-- No INSERT/UPDATE/DELETE policy for authenticated/anon, for any role, including admin —
-- publishing a NAV is exclusively service_role, via the publish-nav Edge Function, which also
-- validates the product's asset_class is genuinely eligible before allowing it. Mirrors
-- hys_pockets' own "no client-side INSERT policy exists at all" precedent (Phase B Stage 4).

-- ============================================================================
-- TRANSITION for existing Private Equity / Real Assets products, decided and reported per
-- instruction: FREEZE at the current simulated unit price as the first "publication," not a
-- reset to inception price.
--
-- Reasoning: a client who already holds one of these products today has a real, live
-- unrealized-return figure computed against its current simulated price (see
-- getUnrealizedReturn()/getTotalUnrealizedReturns() — both read the CURRENT unit_price, not
-- the inception one). Resetting to inception price the moment this migration runs would
-- produce a real, unexplained, and potentially large jump in that figure for every such
-- client — on the client's own dashboard/asset-performance page, with zero real-world event
-- (no actual appraisal happened) to justify it. Freezing at the current value is the only
-- option that changes NOTHING visible to a client at the moment this ships — the exact
-- behavior a real illiquid-asset valuation model should have when it's first turned on: the
-- last known mark simply becomes the baseline going forward, and the price only ever moves
-- again when a PM deliberately publishes a real new NAV. `published_by`/`published_by_email`
-- are left NULL for this one row per product — a real PM did not "publish" this, the
-- migration itself is recording where the price already stood; `note` says so explicitly so
-- this reads as an honest system event in NAV history, never mistaken for a real PM action.
-- `effective_date` uses the product's own current last_tick_date (the last day the simulated
-- tick genuinely ran) rather than today's date, since that IS the date this price was last
-- genuinely determined.
-- ============================================================================
insert into public.nav_publications (product_id, published_unit_price, published_by, published_by_email, effective_date, note)
select id, unit_price, null, null, last_tick_date,
  'Initial NAV — frozen at the pre-carve-out simulated price when the real NAV-publication feature was introduced. Not a real Portfolio Manager action.'
from public.products
where asset_class in ('Private Equity', 'Real Assets');
