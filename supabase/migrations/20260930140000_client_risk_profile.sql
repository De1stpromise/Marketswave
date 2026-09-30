-- ★ The risk profile, stored with the account (2026-09-30, register row 292).
--
-- It lived only in the client's browser (localStorage, marketswave_risk_profile:<clientId>),
-- invisible to the server, to the PM, and to the client's other devices. It is now a column on
-- client_profiles, with the time it was set.
--
-- DISTINCT FROM risk_questionnaire (row 242): that is what the client ANSWERED at signup; this is
-- the level they CHOOSE on the Risk Meter. Neither is derived from the other.
--
-- WRITE PATH: set-risk-profile only — a self-only Edge Function that derives the client from the
-- caller's JWT and writes these two columns and nothing else. client_profiles still has NO client
-- INSERT/UPDATE policy, deliberately: RLS cannot restrict which COLUMNS a row write touches, so a
-- client write policy "for the risk profile" would also let a client rewrite legal_name, address
-- and id_document without approval (the same reasoning as submit-onboarding, row 242). Reads are
-- unchanged: a client reads their own row, a PM reads every row.

alter table public.client_profiles
  add column risk_profile text,
  add column risk_profile_set_at timestamptz;

alter table public.client_profiles
  add constraint client_profiles_risk_profile_valid
  check (risk_profile is null or risk_profile in ('conservative', 'balanced', 'aggressive'));

alter table public.client_profiles
  add constraint client_profiles_risk_profile_set_at_paired
  check ((risk_profile is null) = (risk_profile_set_at is null));
