-- Catalog expansion (2026-09-14): the market-data refresh moves from every 15 minutes to
-- every 5, still 30 stock symbols per run — 90 symbols per 15 minutes instead of 30.
--
-- WHY: at ~220 stock symbols and 30 per cycle, a 15-minute cadence gives ceil(220/30) = 8
-- cycles, a 120-minute worst-case staleness. At 5 minutes the same 8 cycles are 40 minutes.
-- The Finnhub budget is unchanged: each run still spends 30 of the 60 calls/minute inside
-- its own minute and leaves 30 to the interactive paths; runs three times as often but
-- never twice in one minute.
--
-- THE ALERT SWEEP KEEPS ITS +2 MINUTE OFFSET ON THE NEW GRID: refresh at :00/:05/:10…,
-- sweep at :02/:07/:12…. A refresh completes in seconds, so a sweep two minutes later always
-- reads prices the immediately preceding refresh already wrote; and the sweep makes no
-- provider calls at all (it compares against the cache), so the two jobs never share a
-- rate-limit minute in either direction. The old '2-59/15' would have left the sweep at a
-- 15-minute cadence against a 5-minute refresh — three refreshes between sweeps, an alert
-- crossing the second of them fires up to ten minutes late for no reason.
--
-- pg_cron >= 1.4 treats cron.schedule(name, …) as an upsert on the job name, but that is not
-- guaranteed on every version this migration may meet, so both jobs are unscheduled by name
-- first when they exist and re-created. The command text is byte-identical to the original
-- (20260911100000): only the schedule changes.

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'marketswave-refresh-market-data') then
    perform cron.unschedule('marketswave-refresh-market-data');
  end if;
  if exists (select 1 from cron.job where jobname = 'marketswave-check-price-alerts') then
    perform cron.unschedule('marketswave-check-price-alerts');
  end if;
end
$do$;

select cron.schedule(
  'marketswave-refresh-market-data',
  '*/5 * * * *',
  $cron$ select public.invoke_edge_function('refresh-market-data') $cron$
);

select cron.schedule(
  'marketswave-check-price-alerts',
  '2-59/5 * * * *',
  $cron$ select public.invoke_edge_function('check-price-alerts') $cron$
);
