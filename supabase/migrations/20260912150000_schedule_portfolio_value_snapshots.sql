-- ★ Portfolio overview (2026-09-12): schedule the portfolio value snapshot writer.
--
-- portfolio_value_snapshots (created 2026-09-04 for the dashboard's monthly-change figure)
-- had exactly one writer until now: get-portfolio-monthly-change, which inserts a client's
-- anchor for the current month lazily, on their first dashboard load in that month. Nothing
-- ran on a schedule, so a client who did not visit got no row, and no client could ever
-- accumulate the month-by-month history a value chart needs. The investigation that opened
-- this work found two rows in the whole table on real cloud staging (both $0) and none
-- locally.
--
-- This job runs snapshot-portfolio-values at 00:05 UTC on the 1st of every month, which
-- writes that month's anchor for every client — the same (client_id, month_start_date) row
-- the lazy writer would create, computed the same way — so the two never disagree. It goes
-- through the same public.invoke_edge_function() as the market-data jobs and needs the same
-- one-time `npm run supabase-configure-scheduler`; until that has run it, like them, exists
-- and quietly does nothing.
--
-- 00:05 rather than 00:00: the refresh-market-data job fires on the quarter hour and this
-- must read prices that run has already settled rather than race it on the same minute.

select cron.schedule(
  'marketswave-snapshot-portfolio-values',
  '5 0 1 * *',
  $cron$ select public.invoke_edge_function('snapshot-portfolio-values') $cron$
);
