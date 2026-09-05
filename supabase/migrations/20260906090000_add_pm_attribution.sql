-- Backend Migration Phase C — Stage 1 (2026-09-06).
--
-- Real per-PM attribution. Until this migration, no admin-write table anywhere in this
-- schema recorded WHO performed a resolution/credit/edit action — not even a generic
-- placeholder; "Portfolio Manager" as a generic actor label exists in exactly ONE place in
-- the whole project, engine-core.js's local (localStorage-only) appendSecurityLogEntry(), a
-- domain that has never had a real Supabase backend at all (confirmed directly, not
-- assumed — see Admin UI Wiring Final Stage's own investigation). Every real Supabase
-- Edge Function's own admin-write path recorded no actor whatsoever. This migration adds
-- that missing attribution across every real admin-write table, ahead of Phase C's own
-- multi-PM bootstrap work (this project no longer has exactly one shared PM identity, so
-- "which PM did this" is now a real, answerable question worth being able to answer).
--
-- Pattern used throughout, deliberately consistent with this project's own established
-- denormalization precedent (`clients.name`/`clients.email` are captured directly at
-- signup time rather than joined from `auth.users` on every read — the same reasoning
-- applies here): every actor column comes as a PAIR —
--   <verb>_by       uuid references auth.users(id)   -- the real, canonical source of truth
--   <verb>_by_email text                              -- captured directly from the calling
--                                                         admin's own verified JWT at the
--                                                         moment of the write, so displaying
--                                                         "who did this" never needs a
--                                                         privileged join into auth.users
--                                                         (which PostgREST doesn't expose to
--                                                         any client-facing role anyway).
-- Both columns are nullable with no default — every existing row predates this migration and
-- correctly shows NULL/"unknown", not a fabricated placeholder value. No RLS policy changes
-- are needed anywhere: every affected table's existing SELECT policy (self-or-admin) already
-- covers reading these new columns, and every write to them happens exclusively through an
-- Edge Function's own service_role client, unchanged by this migration.
--
-- Column naming is contextual per table (resolved_by / created_by / updated_by / reviewed_by
-- / published_by), matching the real verb each table's own admin action actually performs,
-- rather than forcing one generic name onto every table.

-- ---- clients: application review (approve-client-application / reject-client-application)
alter table public.clients
  add column application_resolved_by uuid references auth.users(id),
  add column application_resolved_by_email text;

-- ---- Approval Gate request queues: resolved via approve-*/reject-*/credit-*
alter table public.deposit_requests
  add column resolved_by uuid references auth.users(id),
  add column resolved_by_email text;

alter table public.withdrawal_requests
  add column resolved_by uuid references auth.users(id),
  add column resolved_by_email text;

alter table public.allocation_requests
  add column resolved_by uuid references auth.users(id),
  add column resolved_by_email text;

alter table public.sell_requests
  add column resolved_by uuid references auth.users(id),
  add column resolved_by_email text;

alter table public.hys_deposit_requests
  add column resolved_by uuid references auth.users(id),
  add column resolved_by_email text;

alter table public.hys_withdrawal_requests
  add column resolved_by uuid references auth.users(id),
  add column resolved_by_email text;

alter table public.profile_change_requests
  add column resolved_by uuid references auth.users(id),
  add column resolved_by_email text;

alter table public.support_requests
  add column resolved_by uuid references auth.users(id),
  add column resolved_by_email text;

-- ---- documents: two distinct admin actions, tracked separately, never conflated —
-- reviewed_by covers update-document's "Mark Reviewed" (and any other generic patch) on a
-- client's own upload; published_by covers publish-document's creation of a brand new
-- firm-authored ('from') document. A single document row is only ever touched by one of
-- these two actions in its lifetime today, but the columns stay separate since they
-- represent genuinely different real-world actions, not the same one twice.
alter table public.documents
  add column reviewed_by uuid references auth.users(id),
  add column reviewed_by_email text,
  add column published_by uuid references auth.users(id),
  add column published_by_email text;

-- ---- products: add-product (created_by) / edit-product (updated_by)
alter table public.products
  add column created_by uuid references auth.users(id),
  add column created_by_email text,
  add column updated_by uuid references auth.users(id),
  add column updated_by_email text;

-- ---- advisory_fee_rate: the one genuinely global singleton row, updated by
-- update-advisory-fee-rate
alter table public.advisory_fee_rate
  add column updated_by uuid references auth.users(id),
  add column updated_by_email text;
