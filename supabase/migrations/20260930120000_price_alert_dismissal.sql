-- ★ Fired price alerts, shown to the client (2026-09-30, register row 291).
--
-- A fired alert used to reach the client only by email. get-watchlist now also returns the
-- client's fired alerts from the last 30 days that they have not dismissed, the watchlist card
-- shows the triggered state, and the notification bell lists it. Dismissing needs a state
-- that is NOT deletion: a fired alert is the client's own record of what happened (row 193 keeps
-- fired rows with the price and time they fired at; only a CANCELLED alert is deleted). So a
-- fired row gains a dismissed_at, set by clear-price-alert's dismiss mode under its existing
-- self-only gate.
--
-- No policy change: price_alerts already lets a client SELECT only their own rows, and has no
-- client write policy at all — every write goes through a service-role Edge Function that
-- derives client_id from the caller's JWT.

alter table public.price_alerts add column dismissed_at timestamptz;

-- The client's fired-and-undismissed read (get-watchlist, the bell) filters on these.
create index price_alerts_fired_undismissed_idx
  on public.price_alerts (client_id, fired_at desc)
  where status = 'fired' and dismissed_at is null;

-- dismissed_at only ever describes a FIRED alert.
alter table public.price_alerts
  add constraint price_alerts_dismissed_only_when_fired
  check (dismissed_at is null or status = 'fired');
