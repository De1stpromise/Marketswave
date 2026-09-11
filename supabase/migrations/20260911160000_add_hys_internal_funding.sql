-- ★ Savings deposit from unallocated capital (2026-09-11).
--
-- A second funding source for an HYS pocket: capital already sitting in the client's own
-- account as unallocated, rather than an incoming external payment.
--
-- ---------------------------------------------------------------------------
-- ★ DOES THE TABLE NEED A SOURCE COLUMN? — investigated, and NO. `method` already IS the
-- funding-source field, and this is a third funding method, not a new dimension.
--
-- The alternative considered and rejected: a separate `source text` column alongside
-- `method`. That would make every consumer read two fields to answer one question, and
-- would leave `method` holding a meaningless value ('bank'? null?) for an internal
-- transfer — a row that lies about itself in the column everything already reads. Widening
-- the CHECK keeps one field answering "where does this money come from", which is what the
-- column has always meant.
--
-- What that DOES require is checking every consumer of `method` rather than assuming a new
-- value passes through harmlessly. Confirmed by reading them: request-hys-deposit validates
-- it, credit-hys-deposit maps it to hys_pockets.funding_method (widened below), and
-- admin-hys.html renders it through METHOD_STYLES + a two-branch ternary — all three are
-- updated in this same change. The RLS INSERT policy does not constrain `method` at all
-- (it pins only client_id and status), so it needed no change.
-- ---------------------------------------------------------------------------
alter table public.hys_deposit_requests drop constraint hys_deposit_requests_method_check;
alter table public.hys_deposit_requests add constraint hys_deposit_requests_method_check
  check (method in ('crypto', 'bank', 'internal'));

-- ---------------------------------------------------------------------------
-- hys_pockets.funding_method is ALSO constrained, and would have rejected the insert at
-- approval time with a constraint violation rather than anything readable — found by
-- reading the table definition rather than by hitting it. The existing two values are
-- human-readable prose ('crypto wallet', 'bank account'), so the new one matches that
-- register rather than the machine token: 'unallocated capital'.
-- ---------------------------------------------------------------------------
alter table public.hys_pockets drop constraint hys_pockets_funding_method_check;
alter table public.hys_pockets add constraint hys_pockets_funding_method_check
  check (funding_method in ('crypto wallet', 'bank account', 'unallocated capital'));

-- ---------------------------------------------------------------------------
-- ★ DOES HYS_DEPOSIT STILL DESCRIBE IT? — investigated, and NO. It needs distinguishing,
-- and the reason is a real gap rather than a naming preference.
--
-- HYS_DEPOSIT means "external money arrived into a pocket" — it does not touch
-- account_state, which is exactly why transactions.html excludes it from Net Cash Flow. An
-- internal transfer DOES reduce unallocated_capital. Reusing HYS_DEPOSIT for it would leave
-- the client's unallocated balance dropping by $X with NO ledger row that accounts for it:
-- money would appear to leave the account unexplained. That is the actual defect, and it is
-- what a distinct type fixes.
--
-- ★ ONE ROW, NOT TWO — a deliberate deviation from the task's "ledger entries on both
-- sides", stated rather than quietly taken. This project's ledger is single-entry: one row
-- per event, not a debit/credit pair. BUY is the exact precedent — it moves money out of
-- unallocated and into a holding and writes ONE row; nothing writes a separate "unallocated
-- debit" row to accompany it. Introducing half-double-entry for this one flow would leave a
-- future reader asking why an HYS transfer has two rows and a BUY has one.
--
-- Both sides remain genuinely traceable, which is what the instruction is actually after:
-- the row's own type names the source ("from unallocated capital"), the destination pocket
-- is on high-yield-savings.html, and hys_deposit_requests.transaction_id links the request
-- to the ledger row exactly as it already does for an external credit.
--
-- Like HYS_DEPOSIT, this type is excluded from both charts by construction — the volume
-- chart counts only BUY/SELL (this is not trading) and Net Cash Flow counts only
-- DEPOSIT/WITHDRAWAL (no external cash entered or left the account; it only moved).
-- ---------------------------------------------------------------------------
alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'HYS_DEPOSIT', 'HYS_WITHDRAWAL', 'HYS_TRANSFER_IN'));
