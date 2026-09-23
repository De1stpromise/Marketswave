-- Savings pockets return money to the available balance (2026-09-23).
--
-- Every pocket withdrawal now credits unallocated_capital. Pockets no longer pay out
-- externally; reaching a bank is a normal WITHDRAWAL from the available balance, which is
-- already a real, gated flow. This is the mirror image of HYS_TRANSFER_IN (row 197), which
-- moves unallocated capital INTO a pocket.
--
-- ★ THE CONSTRAINTS ARE REPLACED, NOT WIDENED, AND THAT IS THE POINT. Widening would leave
-- 'crypto'/'bank' still writable, so old code, a stale deployed function or a hand-crafted
-- service_role insert could still record an external payout this system no longer makes.
-- Making the old path structurally impossible is the same discipline as help_articles_public
-- (row 270): the guarantee lives in what the database will accept, not in what the callers
-- happen to send. There is nothing to preserve — see the guard below.
--
-- ★ THE GUARD IS NOT CEREMONY. Zero rows was MEASURED on both local and real cloud staging
-- before this was written (0 hys_withdrawal_requests of any status, 0 HYS_WITHDRAWAL ledger
-- rows), so no client's figures move and no request made under the old expectation is
-- stranded. But a migration must be safe wherever it is applied, and an environment this
-- session never saw could hold one — so it refuses loudly rather than dropping a constraint
-- that real rows still depend on.

do $$
declare
  n_req int;
  n_pocket int;
begin
  select count(*) into n_req from public.hys_withdrawal_requests where method in ('crypto', 'bank');
  select count(*) into n_pocket from public.hys_pockets where withdrawal_method in ('crypto wallet', 'bank account');
  if n_req > 0 or n_pocket > 0 then
    raise exception
      'Refusing to replace the HYS withdrawal method constraints: % withdrawal request(s) and % pocket(s) still carry an external payout method. Decide how to honour them before applying this migration.',
      n_req, n_pocket;
  end if;
end $$;

-- A withdrawal request no longer has an external destination, so `method` carries the one
-- value that is now true. Kept as a column rather than dropped: the queue, the gate panel and
-- the ledger all read it, and 'internal' is the same word hys_deposit_requests already uses
-- for the movement in the other direction (row 197) — one vocabulary for one concept.
alter table public.hys_withdrawal_requests
  drop constraint if exists hys_withdrawal_requests_method_check;
alter table public.hys_withdrawal_requests
  add constraint hys_withdrawal_requests_method_check check (method = 'internal');

alter table public.hys_withdrawal_requests
  alter column method set default 'internal';

-- Mirrors hys_pockets.funding_method's own 'unallocated capital' value exactly, so a pocket
-- reads the same way at both ends of its life.
alter table public.hys_pockets
  drop constraint if exists hys_pockets_withdrawal_method_check;
alter table public.hys_pockets
  add constraint hys_pockets_withdrawal_method_check check (withdrawal_method = 'unallocated capital');
