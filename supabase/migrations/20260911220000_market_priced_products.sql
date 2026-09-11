-- ★ Product catalog — live pricing, part 1 (2026-09-11).
--
-- Until now every product's price was hand-typed by a PM and then drifted by the simulated
-- GBM tick, except Private Equity / Real Assets, carved out in row 143 to move only on a
-- published NAV. That is right for PE/RA. It is wrong for Stocks & ETFs and Crypto, which
-- have real prices in the real world. This migration gives every product an explicit,
-- IMMUTABLE pricing model and the columns a market-priced product needs.
--
-- ---------------------------------------------------------------------------
-- pricing_model — chosen at creation, never changeable afterwards (edit-product refuses
-- it). Four values, two of which a PM can choose:
--   market     — unit_price IS the market price for `ticker`, copied from
--                market_data_cache by the 15-minute refresh and read through on every
--                settlement call. Stocks & ETFs / Crypto only; asset_class is DERIVED
--                from the symbol's provider (Finnhub -> Stocks & ETFs, CoinGecko -> Crypto)
--                so BTC can never be filed under Real Assets.
--   appraisal  — unit_price moves only on a published NAV (publish-nav). PE / RA only.
--   simulated  — LEGACY ONLY: the GBM tick. Not creatable; exists so a pre-existing
--                Stocks/Crypto row with no ticker keeps behaving exactly as it did until a
--                PM maps it. After this migration's own backfill no seeded product is left
--                on it (see below), but the value stays valid for any other install.
--   fixed      — Unallocated / Cash, par value, never moves.
-- ---------------------------------------------------------------------------
alter table public.products add column pricing_model text not null default 'simulated'
  check (pricing_model in ('market', 'appraisal', 'simulated', 'fixed'));
alter table public.products add column price_source text
  check (price_source is null or price_source in ('finnhub', 'coingecko'));
alter table public.products add column provider_id text;          -- CoinGecko id ("bitcoin"); null for Finnhub
alter table public.products add column price_as_of timestamptz;   -- market: the cache's last_updated the price was copied from
alter table public.products add column price_change_percent numeric; -- market: 24h change from the provider; appraisal: the last published % change
alter table public.products add column price_status text not null default 'ok'
  check (price_status in ('ok', 'quote_failed'));
alter table public.products add column price_failure_reason text;
alter table public.products add column price_last_failed_at timestamptz;
alter table public.products add column maximum_investment numeric
  check (maximum_investment is null or maximum_investment > 0);

-- A market-priced product must carry a real symbol and know which provider prices it.
alter table public.products add constraint products_market_requires_symbol
  check (pricing_model <> 'market' or (ticker is not null and price_source is not null));

-- ---------------------------------------------------------------------------
-- Backfill the model from what each row already is.
-- ---------------------------------------------------------------------------
update public.products set pricing_model = 'appraisal'
  where asset_class in ('Private Equity', 'Real Assets');
update public.products set pricing_model = 'fixed'
  where asset_class = 'Unallocated / Cash';

-- ★ THE ONE-TIME MAPPING OF EXISTING STOCKS/CRYPTO PRODUCTS TO REAL SYMBOLS — reported
-- before it was done, with the real holder named (register row 199):
--   * local  PROD-0003 "Global Equity ETF" — no ticker; mapped to VT (Vanguard Total World
--            Stock ETF, confirmed pricing on Finnhub's free tier). No holdings.
--   * local  PROD-0004 "Ethereum"          — ticker ETH already set; CoinGecko "ethereum".
--            No holdings.
--   * REAL STAGING PROD-0001 "Bitcoin"     — ticker BTC already set; CoinGecko "bitcoin".
--            ONE REAL HOLDER: 0.07130380 units, cost basis $5,633. The exact simulated ->
--            market figures at the moment this ran on real staging are recorded in
--            register row 199 (at the time of the report: $79,436.98 -> $77,259.00, i.e.
--            $5,664 -> $5,509 on that holding, -2.7%). Units and cost basis untouched;
--            only the valuation became the real one.
-- The name guard on the VT mapping keeps it from touching any other install's PROD-0003.
update public.products set ticker = 'VT'
  where id = 'PROD-0003' and name = 'Global Equity ETF' and ticker is null;

update public.products
   set pricing_model = 'market',
       price_source = case when asset_class = 'Crypto' then 'coingecko' else 'finnhub' end,
       provider_id = case
         when asset_class <> 'Crypto' then null
         when upper(ticker) = 'BTC' then 'bitcoin'
         when upper(ticker) = 'ETH' then 'ethereum'
         when upper(ticker) = 'SOL' then 'solana'
         else lower(ticker)  -- a later PM edit is refused (immutable); a wrong id here surfaces as quote_failed, never as a wrong price
       end
 where asset_class in ('Stocks & ETFs', 'Crypto') and ticker is not null;

-- ★ THE PRICE JUMP ITSELF, done here from the cache rather than left to whichever refresh
-- happens next, so that the before/after is one recorded moment. A product whose symbol is
-- not in the cache yet (VT, locally) keeps its old price until the first refresh reaches
-- it; price_as_of stays null, which the client card renders as "awaiting refresh".
update public.products p
   set unit_price = m.value,
       price_as_of = m.last_updated,
       price_change_percent = m.change_percent
  from public.market_data_cache m
 where p.pricing_model = 'market' and upper(p.ticker) = m.symbol and m.value > 0;

-- allocated_capital is derived (sum of units x unit_price) and every settlement caller
-- recomputes it on the next read, so nothing here needs to touch account_state.
