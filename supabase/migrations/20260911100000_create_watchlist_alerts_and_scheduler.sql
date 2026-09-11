-- ★★ Merged Market Snapshot + Watchlist (2026-09-11).
--
-- The dashboard's Market Snapshot stops being a fixed six-symbol card and becomes a real,
-- client-editable watchlist with per-row price alerts. Three genuinely separate concerns
-- share this one migration because none of them is usable without the other two:
--   1. the symbol -> product mapping (products.ticker), the shared primitive the
--      live-priced product catalog work will inherit rather than re-derive;
--   2. the watchlist + alert tables themselves;
--   3. a real scheduler — this project has had NO scheduler of any kind until now.

-- ============================================================================
-- 1. products.ticker — THE SHARED PRIMITIVE.
--
-- "Is this symbol in the catalog?" is the question the watchlist's Offered/Tracking-only
-- badge asks, and it is the SAME question the live-priced product catalog work needs to
-- ask in the opposite direction ("what does this catalog product currently trade at?").
-- Both directions are one mapping, so it lives on the product row itself rather than in a
-- watchlist-specific side table that the catalog work would have to reach across a domain
-- boundary to use. _shared/symbol-catalog.ts is the read side of this column.
--
-- Nullable by design and BACKFILLED ONLY WHERE THE MAPPING IS GENUINELY UNAMBIGUOUS. Of
-- the five seeded products exactly one — "Ethereum" (Crypto) — names a real, publicly
-- quoted instrument; "Nordic Growth Fund", "European Real Estate Trust" and "Global Equity
-- ETF" are this project's own fictional vehicles with no real ticker, and "Cash" is the
-- synthetic Unallocated bucket. Inventing tickers for those to make more rows show the
-- Offered badge would be exactly the kind of fabricated-but-plausible data this project
-- has removed twice already. A PM sets the rest from admin-products.html when a product
-- genuinely has one.
-- ============================================================================
alter table public.products add column ticker text;

-- Case-insensitive and unique: two catalog products must never both claim BTC, or
-- resolveSymbols() would have to pick one arbitrarily and the Allocate button would send
-- the client to whichever it happened to pick.
create unique index products_ticker_unique_idx on public.products (upper(ticker)) where ticker is not null;

update public.products set ticker = 'ETH' where id = 'PROD-0004' and name = 'Ethereum';

-- ============================================================================
-- 2. market_data_cache becomes dynamic.
--
-- It held six hardcoded symbols written by get-market-snapshot's own constant maps. The
-- symbol set is now the union of (a) the six base symbols the public homepage ticker
-- depends on and (b) every symbol any client is actually watching — so the table needs to
-- carry enough about each row to display and re-fetch it without a hardcoded lookup:
--   name        — the human name ("Bitcoin", "NVIDIA Corporation"), previously a constant.
--   provider_id — CoinGecko's own id ("bitcoin"), which is NOT the ticker and cannot be
--                 derived from it; null for Finnhub, where the ticker IS the id.
--   asset_type  — 'stock' | 'crypto'; drives price formatting and which provider refreshes
--                 the row. Distinct from source (which provider answered) only in intent,
--                 but kept separate because a future provider swap changes one and not the
--                 other.
-- ============================================================================
alter table public.market_data_cache add column name text;
alter table public.market_data_cache add column provider_id text;
alter table public.market_data_cache add column asset_type text check (asset_type in ('stock', 'crypto'));

-- Backfill the six the old hardcoded maps described, so the public ticker and the client
-- dashboard both keep rendering real names from the row rather than a constant.
update public.market_data_cache set name = 'S&P 500 ETF',    asset_type = 'stock'  where symbol = 'SPY';
update public.market_data_cache set name = 'Nasdaq 100 ETF', asset_type = 'stock'  where symbol = 'QQQ';
update public.market_data_cache set name = 'Dow Jones ETF',  asset_type = 'stock'  where symbol = 'DIA';
update public.market_data_cache set name = 'Bitcoin',  provider_id = 'bitcoin',  asset_type = 'crypto' where symbol = 'BTC';
update public.market_data_cache set name = 'Ethereum', provider_id = 'ethereum', asset_type = 'crypto' where symbol = 'ETH';
update public.market_data_cache set name = 'Solana',   provider_id = 'solana',   asset_type = 'crypto' where symbol = 'SOL';

-- ============================================================================
-- 3. watchlist_symbols — what each client is actually watching.
--
-- NO client-side INSERT/UPDATE/DELETE policy for any role, including admin. Adding a
-- symbol is not a bare row write: it has to be validated against a real provider (the
-- symbol must genuinely exist), resolved to a real display name and provider id, counted
-- against the per-client ceiling, and price-seeded so the row is not blank on first
-- render. All of that is add-watchlist-symbol's job. Same reasoning as hys_pockets'
-- own "service_role is the sole writer" precedent, not a reflex copy of it.
-- ============================================================================
create table public.watchlist_symbols (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  name text not null,
  source text not null check (source in ('finnhub', 'coingecko')),
  provider_id text,
  asset_type text not null check (asset_type in ('stock', 'crypto')),
  created_at timestamptz not null default now()
);

-- One row per symbol per client, case-insensitively: "btc" and "BTC" are the same holding
-- of attention, and a duplicate would mean two Remove buttons for one thing.
create unique index watchlist_symbols_client_symbol_idx on public.watchlist_symbols (client_id, upper(symbol));
create index watchlist_symbols_symbol_idx on public.watchlist_symbols (upper(symbol));

-- The "has this client ever been given the default six?" marker. Deliberately a stamp on
-- the client rather than "does this client have zero rows right now": a client who
-- deliberately removes every symbol must get the honest empty state, not have the six
-- silently reappear on their next page load.
alter table public.clients add column watchlist_seeded_at timestamptz;

alter table public.watchlist_symbols enable row level security;

create policy "clients read their own watchlist"
  on public.watchlist_symbols for select to authenticated
  using (auth.uid() = client_id or public.is_admin());

-- ============================================================================
-- 4. price_alerts — one active alert per watched symbol, fires ONCE, then clears.
--
-- The partial unique index is the real enforcement of "one price alert per row": an
-- application-level check alone would lose a genuine double-submit race, and the UI shows
-- one bell per row precisely because a second one has no meaning.
--
-- A fired alert is KEPT, not deleted (status flips to 'fired', with the price and time it
-- fired at) — the same "show everything, never silently delete" principle every rejected
-- request in this project already follows, and the only way a client can tell the
-- difference between "my alert fired" and "my alert vanished".
-- ============================================================================
create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  watchlist_symbol_id uuid not null references public.watchlist_symbols(id) on delete cascade,
  symbol text not null,
  direction text not null check (direction in ('above', 'below')),
  target_price numeric not null check (target_price > 0),
  status text not null default 'active' check (status in ('active', 'fired')),
  created_at timestamptz not null default now(),
  fired_at timestamptz,
  fired_price numeric
);

create unique index price_alerts_one_active_per_symbol_idx
  on public.price_alerts (watchlist_symbol_id) where status = 'active';
create index price_alerts_active_idx on public.price_alerts (status) where status = 'active';

alter table public.price_alerts enable row level security;

create policy "clients read their own price alerts"
  on public.price_alerts for select to authenticated
  using (auth.uid() = client_id or public.is_admin());

-- ============================================================================
-- 5. THE SCHEDULER. There was none in this project before this migration.
--
-- pg_cron + pg_net, both confirmed present in shared_preload_libraries on this stack
-- before this was written. pg_cron fires a plain SQL statement; pg_net makes the HTTP call
-- out to an Edge Function, which is where the real work (and the real provider API keys)
-- already lives. Nothing is duplicated into SQL.
--
-- CREDENTIALS: invoking an Edge Function needs the service_role key, which must never be
-- written into a committed migration. It lives in supabase_vault (already installed on
-- this stack) and is populated out-of-band by scripts/supabase-configure-scheduler.js.
-- Until that script has run, invoke_edge_function() finds no secret and returns null
-- rather than erroring — so a fresh `supabase db reset` produces a schema whose cron jobs
-- exist and do nothing, which is the correct, quiet behaviour for an unconfigured stack.
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_edge_function(fn text)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $fn$
declare
  base_url text;
  service_key text;
  request_id bigint;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'edge_functions_base_url';
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'scheduler_service_role_key';

  if base_url is null or service_key is null then
    raise notice 'invoke_edge_function(%): scheduler secrets are not configured; skipping.', fn;
    return null;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$fn$;

-- SECURITY DEFINER + reads a service_role key, so it must not be callable by anyone but
-- the scheduler itself. Postgres grants EXECUTE to PUBLIC on new functions by default;
-- this is the revoke that actually matters.
revoke all on function public.invoke_edge_function(text) from public;
revoke all on function public.invoke_edge_function(text) from anon, authenticated, service_role;

-- Refresh on the quarter hour; check alerts two minutes later, so the check always reads
-- prices the refresh has already written rather than racing it. The alert check is
-- deliberately NOT part of the refresh function: a refresh failure (one provider down)
-- must not also silence every alert that the other provider's prices would have fired.
select cron.schedule(
  'marketswave-refresh-market-data',
  '*/15 * * * *',
  $cron$ select public.invoke_edge_function('refresh-market-data') $cron$
);

select cron.schedule(
  'marketswave-check-price-alerts',
  '2-59/15 * * * *',
  $cron$ select public.invoke_edge_function('check-price-alerts') $cron$
);
