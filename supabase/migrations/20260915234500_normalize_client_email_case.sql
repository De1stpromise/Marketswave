-- ★★ EMAIL IS STORED AND COMPARED LOWERCASE (2026-09-15).
--
-- Found while correcting one capitalised address (Gary Sizemore's, the only mixed-case email
-- in either environment). The capitalisation itself was cosmetic; the MECHANISM underneath it
-- was not, and is what this migration closes.
--
-- public.clients' own INSERT policy compared the submitted email to the caller's verified JWT
-- email with a plain, case-SENSITIVE `=`. GoTrue normalises every address it stores to
-- lowercase — confirmed directly for BOTH creation paths (admin createUser and signUp) — so
-- the JWT side of that comparison is always lowercase while the row side is whatever the
-- caller sent. A caller inserting the address a client actually TYPED ("Gary.R.Sizemore@…")
-- was therefore refused by RLS.
--
-- Proven before changing anything, with a control on both sides: a throwaway user created with
-- a mixed-case address stored lowercase and signed in fine with EITHER capitalisation, then a
-- clients INSERT carrying the typed mixed-case address was REFUSED ("new row violates
-- row-level security policy"), and the identical row with the lowercase address was ACCEPTED.
--
-- It has not fired in production because signup.html happens to insert
-- `signUpData.user.email` — the value GoTrue hands BACK, already normalised — rather than the
-- value typed into the form. That is an implementation accident, not a guarantee: any future
-- caller that inserts the typed value gets a silent refusal, and the client-facing symptom is
-- indistinguishable from a wrong password (login.html folds "no clients row" into the same
-- generic message, by design).
--
-- Three parts, smallest that makes the convention true rather than remembered:
--   1. Backfill every stored address to lowercase.
--   2. Compare case-insensitively in the policy, so a legitimate insert can never be refused
--      over capitalisation. Anti-spoofing is unchanged — the addresses must still be the same
--      address, it just no longer has to be the same keystrokes.
--   3. Normalise on write, so storage is lowercase by construction for every writer including
--      service_role and the seed scripts, not only for the callers that happen to remember.
--
-- conversations.contact_email is backfilled but deliberately NOT given a trigger: its own
-- partial unique index on lower(contact_email) already enforces the invariant that matters
-- there (one thread per contact), and every read of it in the codebase already uses ilike.

-- ---- 1. backfill -------------------------------------------------------------------------
update public.clients set email = lower(email) where email <> lower(email);
update public.conversations set contact_email = lower(contact_email)
  where contact_email is not null and contact_email <> lower(contact_email);

-- ---- 2. the policy -----------------------------------------------------------------------
drop policy if exists "clients can insert their own pending application" on public.clients;
create policy "clients can insert their own pending application"
  on public.clients
  for insert
  to authenticated
  with check (
    auth.uid() = id
    and status = 'pending_review'
    and lower(email) = lower(auth.jwt() ->> 'email')
  );

-- ---- 3. normalise on write ---------------------------------------------------------------
create or replace function public.normalize_client_email()
returns trigger
language plpgsql
as $$
begin
  if new.email is not null then
    new.email := lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists clients_normalize_email on public.clients;
create trigger clients_normalize_email
  before insert or update of email on public.clients
  for each row execute function public.normalize_client_email();
