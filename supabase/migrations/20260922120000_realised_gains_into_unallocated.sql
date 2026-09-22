-- Realised gains become spendable capital (2026-09-22, register row 264).
--
-- WHAT CHANGED IN THE CODE, WHICH THIS MIGRATION COMPLETES. execute-sell used to credit only the
-- COST-BASIS PORTION of a sale to unallocated_capital and route the gain to asset_returns as a
-- second pot. Nothing could ever spend or withdraw that pot — execute-buy debits
-- unallocated_capital, and request/approve-allocation and request/approve-withdrawal all validate
-- against it — so a client who sold at a profit saw the gain in every total and could reach none
-- of it, permanently. It now credits the FULL sale value, and asset_returns is a reported lifetime
-- TALLY of what sales have made: retained, never spent, and no longer summed into Total Portfolio
-- Value (computeTotalPortfolioValue, pm-briefing's AUM, portfolio-overview's account total).
--
-- THIS MIGRATION moves every client's existing realised balance into their spendable capital, so
-- money banked under the old rule becomes reachable exactly like money banked under the new one.
--
-- ★ EVERY TOTAL IS NUMERICALLY UNCHANGED BY THIS. The amount moves between two columns that were
-- both inside the same sum, and the code drops the third term in the same commit:
--   before:  TPV = unallocated + allocated + asset_returns
--   after:   TPV = (unallocated + asset_returns) + allocated
-- so total account value, the dashboard headline, AUM and every historical portfolio_value_snapshots
-- anchor read exactly what they read before. Snapshots need no backfill and keep their meaning.
--
-- ★ IDEMPOTENT. `migrated_realised_at` is stamped on the rows this moves; a re-run skips them, so
-- applying the migration twice cannot credit the same money twice. asset_returns is deliberately
-- NOT zeroed — it is the tally, and zeroing it would erase the client's lifetime realised figure
-- from every surface that reports it.
--
-- ★ NEGATIVE BALANCES. A client with a realised LOSS has a negative asset_returns and would have
-- their spendable balance REDUCED; if they had allocated against the overstated balance, the result
-- could go below zero. Nobody's balance goes negative silently: this migration RAISES rather than
-- writing such a row, and `scripts/check-realised-migration-safety.mjs` reports every affected
-- client on both stacks before it is ever applied (run 2026-09-22: local 1 client, staging 2, all
-- positive, zero loss-sales in either ledger, no balance reduced).

alter table public.account_state
  add column if not exists migrated_realised_at timestamptz;

comment on column public.account_state.migrated_realised_at is
  'Row 264: when this row''s pre-existing asset_returns balance was moved into unallocated_capital. Non-null means already migrated — the migration skips it on a re-run.';

comment on column public.account_state.asset_returns is
  'Row 264: the lifetime TALLY of realised gains/losses from sales — reported, never spent, never withdrawn, and NOT summed into Total Portfolio Value. A sale credits its full proceeds to unallocated_capital and adds its realized_return here.';

do $$
declare
  affected int;
  went_negative int;
begin
  -- Refuse outright if any row would end below zero. Checked here as well as in the pre-flight
  -- script, because a stack this has never run against may hold different data.
  select count(*) into went_negative
  from public.account_state
  where migrated_realised_at is null
    and asset_returns <> 0
    and round((unallocated_capital + asset_returns)::numeric, 2) < 0;

  if went_negative > 0 then
    raise exception 'Row 264 migration refused: % client(s) would end with a negative unallocated_capital. Run scripts/check-realised-migration-safety.mjs, report, and decide — do not force this.', went_negative;
  end if;

  update public.account_state
     set unallocated_capital = round((unallocated_capital + asset_returns)::numeric, 2),
         migrated_realised_at = now(),
         updated_at = now()
   where migrated_realised_at is null
     and asset_returns <> 0;
  get diagnostics affected = row_count;

  -- Rows with nothing to move are stamped too, so a later re-run is a genuine no-op everywhere.
  update public.account_state
     set migrated_realised_at = now()
   where migrated_realised_at is null;

  raise notice 'Row 264: moved realised balances into unallocated_capital for % client(s).', affected;
end $$;
