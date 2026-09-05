# Marketswave

Marketswave is a discretionary wealth / capital management platform: a public marketing
site, multi-step client onboarding, login + password recovery, and a client dashboard. Most
of the app is frontend-only, static HTML backed by `localStorage` (see `engine-core.js`).

**Firebase is RETIRED as of Aug 30, 2026 — Supabase is now the sole active backend.**
`signup.html`/`login.html` default to Supabase, with zero query params needed either way —
which real target that reaches depends on where the page is actually being served from
(fixed 2026-09-04, see "Pre-hosting fix" below for the full "why"): on `localhost`/
`127.0.0.1` (local development) it reaches the local Docker stack; on any real hosted domain
it reaches the real "Marketswave Staging" cloud project — the correct default for a real
visitor, whose browser will never carry a query param. `?env=staging`/`?dev=local` remain
available as explicit overrides in either direction. The reason for the Firebase-to-Supabase
move, reported plainly: real Cloud Functions on the Firebase side stayed permanently blocked
on a Blaze (pay-as-you-go) plan upgrade for `marketswave-staging` (see "What's blocked: Phase
A2" further down, kept as historical record) — a real card requirement this project declined.
Supabase's free tier deploys real Edge Functions with no card required, at the cost of a real
tradeoff, not a free lunch: free-tier Supabase projects auto-pause after 7 days of inactivity
and need a manual un-pause. **Supabase Migration Stage 1** (infra/schema/local bootstrap),
**Stage 2** (client-facing signup/login against the local stack), and **Stage 3** (the real
cloud project + real deployed Edge Functions — the real admin approve/reject flow is fully
live for the first time in this project's history, closing the exact gap that stayed
permanently blocked on Firebase) are all complete — see the "Supabase Local Development
Runbook" section below.

**The Firebase sections that follow are kept intact as historical/reference record of real,
working, verified infrastructure — not deleted.** They remain reachable only via an explicit
`?legacyBackend=firebase` flag on `signup.html`/`login.html` (see `supabase-config.js`'s own
header for the full switch scheme) — no longer the default, no longer reachable by accident.
There are still THREE Firebase environment tiers, not two, if you deliberately opt into that
retired path — see "Which Firebase environment am I looking at?" below:

| Tier | Project id | Status |
|---|---|---|
| Emulator | `demo-marketswave` | RETIRED — reachable only via `?legacyBackend=firebase` |
| Staging | `marketswave-staging` | RETIRED, REAL project, untouched since Phase A1 — reachable only via `?legacyBackend=firebase&env=staging` |
| Production | "Marketswave SE" | REAL Firebase project, was always untouched — no longer a relevant future target, since Supabase is now the active path |

For the full project context (tech stack, locked design rules, feature history), see
`CLAUDE.md` — it is read automatically by Claude Code at the start of every session in this
directory and is the actual day-to-day source of truth. `Marketswave_Project_Handover.md` is
the full narrative history behind it. This file is deliberately narrower: it is an
operational runbook — Supabase is the active-path runbook; the Firebase sections below are
historical/reference only.

---

## Supabase Local Development Runbook

**Who this is for**: anyone (including a Claude Code session with zero memory of any prior
one) who needs to get the local Supabase stack running from a machine where nothing is
running yet. This is the ACTIVE path going forward — start here, not the Firebase runbook
below, unless you specifically need to touch the Firebase side (which still runs
`signup.html`/`login.html` for real today; Supabase Stage 1 is infra/schema only, nothing
user-facing points at it yet).

### What you're bringing up

`supabase start` brings up a full local Supabase stack as Docker containers — Postgres,
GoTrue (Auth), PostgREST (the REST API), Realtime, Storage, Studio (a local admin UI), an
Edge Functions runtime, and a few supporting services (Kong as the API gateway, Mailpit for
catching outgoing email locally, Logflare/Vector for the Studio Logs Explorer). All of it is
fully offline — a local Postgres database in a container, not the real cloud
`marketswave-staging`/`ujnmlwbpginplfnofhhv` project, even though the CLI is logged into the
real Supabase account that owns that project (`supabase login`/`supabase projects list`).
Nothing here reaches the real cloud project unless you explicitly `supabase link` and run a
`supabase db push`/`supabase functions deploy` — a local `supabase start` session never does
that on its own.

| Service | Local URL | What it's for |
|---|---|---|
| API gateway (Kong) | `http://127.0.0.1:54321` | Fronts REST/GraphQL/Functions/Storage — this is the one URL client code actually talks to |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Direct DB access — `psql`, migrations, `docker exec ... psql` |
| Studio | `http://127.0.0.1:54323` | A local web admin UI — browse tables, run SQL, inspect Auth users |
| Mailpit (mail catcher) | `http://127.0.0.1:54324` | Catches any email the local Auth stack would send (signup confirmations, etc.) — nothing ever leaves the machine |

The actual `ANON_KEY`/`SERVICE_ROLE_KEY`/`PUBLISHABLE_KEY`/`SECRET_KEY` values are printed by
`supabase status` — see below. They rotate only if `supabase/config.toml`'s JWT secret is
ever changed; the default one (`super-secret-jwt-token-with-at-least-32-characters-long`) is
a well-known, publicly-documented Supabase CLI default, identical across every unmodified
local Supabase project on any machine — **not a real secret**, the same category as the
Firebase emulator's own hardcoded bootstrap password (see `scripts/bootstrap-admin.js`'s own
header for that precedent). This is why `scripts/supabase-bootstrap-admin.js` and
`scripts/verify-supabase-schema.js` are safe to keep committed.

### Prerequisites (one-time, per machine)

- **Docker Desktop**, running. `supabase start` pulls ~15 images on first run — expect this
  to take several minutes on a fresh machine (verified live: roughly 5–6 minutes on this
  machine's connection). Subsequent starts are fast, since the images are already local.
- **Supabase CLI** (`supabase --version` — this was verified against `2.116.0`). If missing:
  `npm install -g supabase` (or see the CLI's own install docs for other package managers).
- **`supabase login`**, once per machine — opens a browser to authenticate against the real
  Supabase account. Confirm it worked with `supabase projects list`, which should show the
  real "Marketswave Staging" project (`ujnmlwbpginplfnofhhv`) with `"linked": false` — that
  `false` is correct and expected for local-only work; `supabase link` is a separate, later
  step this Stage does not need.
- **Node.js** with the `scripts/` dependencies installed (`cd scripts && npm install`) —
  needed for `supabase-bootstrap-admin.js`/`verify-supabase-schema.js`, both of which use
  `@supabase/supabase-js`.

### Step 1 — Initialize (one-time per project)

```
supabase init
```

Creates `supabase/config.toml` (all local stack configuration — ports, Auth settings, the
custom access token hook wiring) and `supabase/migrations/` (schema, applied automatically
on every `supabase start`). Already done for this project — this step is here for
completeness/a from-scratch clone, not something to re-run.

### Step 2 — Start the local stack

```
supabase start
```

First run pulls every image (slow, one-time); every run after that starts in seconds. On
success it prints a JSON blob with every service URL and key — the `ANON_KEY`/
`SERVICE_ROLE_KEY` values change only if the JWT secret in `config.toml` is edited. Re-run
`supabase status` any time afterward to see the same JSON again without restarting anything.

**Known cosmetic issue, disclosed not hidden**: the `vector` container (Logflare's log
shipper, feeds Studio's Logs Explorer tab only) restart-loops on this machine with
`Connection refused` trying to reach the Docker socket — a known Docker-Desktop-on-Windows
socket-mounting quirk, not something this project's own config caused. Confirmed it does
**not** affect Postgres/Auth/REST/Storage/Studio itself — `docker ps` shows all of those
`(healthy)` regardless, and every functional check in this document (schema, RLS, bootstrap)
passed with `vector` still restart-looping. `imgproxy`/`pooler` show as "Stopped services" in
every `supabase status` call — that's by design, not a failure: neither is enabled in
`config.toml` for this project (no image transforms, no connection pooling needed at this
stage).

### Step 3 — Confirm data actually persists across a stop/start (verified, not assumed)

This project's Firebase emulator has a real, documented data-loss quirk
(`--export-on-exit` doesn't reliably persist across a restart — see "Known limitation" in
the Emulator Bootstrap Runbook below). Supabase's local stack was checked directly for the
same failure mode rather than assumed fine just because Docker volumes are generally
persistent:

1. Inserted a real test row into `auth.users` and `public.user_roles` via `docker exec ...
   psql`.
2. `supabase stop` — output includes `"backup": true`, and `docker volume ls` afterward
   still shows `supabase_db_Marketswave` (the Postgres data volume survives the stop).
3. `supabase start` — output begins with `Starting database from backup...` (not
   `Initialising schema...`, which is what a fresh/empty database prints).
4. Queried both rows again — both present, byte-identical.

**Confirmed: no Firebase-style data-loss quirk.** `supabase stop` performs a real backup;
`supabase start` restores from it automatically. Data genuinely survives a stop/start cycle
on this machine. (`supabase stop --no-backup` or `supabase db reset` are the two ways to
deliberately wipe local data — neither is part of the normal stop/start cycle.)

### Step 4 — Bootstrap the local admin/PM account

```
cd scripts
node supabase-bootstrap-admin.js
```

Creates (or reuses) a local `pm@marketswave.local` Auth user and writes `{ is_admin: true }`
into `public.user_roles` for that account — mirroring `scripts/bootstrap-admin.js`'s own
idempotent create-or-reuse-and-verify-live technique for the Firebase side. Safe to re-run
any time; it self-heals a partially-bootstrapped state rather than erroring. On success it
prints the account's real Supabase Auth uid and confirms the `user_roles` row live (a
verification read, not just trusting the write call succeeded).

### Step 5 — Verify the schema/RLS actually work, not just that they exist

```
cd scripts
node verify-supabase-schema.js
```

This is Stage 1's own regression check — the Supabase-side analog of
`golden-path-regression.js` (below), except it exercises the raw schema/RLS layer directly
via `@supabase/supabase-js` rather than real app code, since no app code talks to Supabase
yet (Stage 2). Creates two real throwaway client users and one real throwaway admin user,
signs in as each, and checks 16 real behaviors against the live stack — not read from the
migration file and assumed correct. **Last run: `16/16 assertions passed`, including the two
that matter most**:
- an ordinary client's real issued JWT carries `app_metadata.is_admin === false`, and a
  client genuinely cannot see another client's row, update their own row, delete it, or
  insert one under someone else's id/with a spoofed email/with `status` forced to anything
  but `pending_review`/with an invalid `account_type`;
- an admin-claimed caller's real issued JWT carries `app_metadata.is_admin === true`, and
  that claim genuinely unlocks reading every client's row — while still **not** granting a
  client-side write path (no UPDATE/DELETE policy exists for `authenticated` at all,
  admin-claimed or not) — only `service_role` (the path a future Edge Function will use,
  confirmed it genuinely can write) bypasses RLS.

All test users/rows are deleted at the end of the script — it leaves no residue in the local
stack.

### Step 6 — Real signup/login against Supabase (Stage 2, `?backend=supabase`)

**Who this is for**: testing the actual client-facing pages against Supabase, not just the
raw schema/RLS layer Step 5 already covers.

Serve the project over plain HTTP first — `signup.html`/`login.html`'s Supabase code path
(like their existing Firebase one) loads real ES modules, which browsers refuse to import
from a `file://` URL:

```
python -m http.server 8765
```

(any static file server works — this is just the one already used to verify this stage).
Then open:

```
http://127.0.0.1:8765/signup.html?backend=supabase
```

`?backend=supabase` is a NEW, separate query param from Firebase's own `?env=staging` — see
`supabase-config.js`'s own header comment for the full three-backend disambiguation scheme
(Firebase emulator / Firebase staging / Supabase local, with Supabase cloud staging reserved
for a future Stage 3). Its absence leaves `signup.html`/`login.html` running exactly as
before, on Firebase, with zero behavior change — confirmed via `git diff`, not just
asserted: the only lines touched inside either file's existing Firebase code path are a
single query-string-building helper extended to also recognize `backend=supabase` (same net
effect for `?env=staging` as before), everything else is pure addition.

Complete the real 9-step form and submit — this creates a REAL Supabase Auth account (via
`supabase.auth.signUp()`) and a REAL `clients` row (via a direct, RLS-enforced insert — no
Edge Function needed for creation, the same reasoning `firestore.staging.rules` already
established on the Firebase side: the migration's own INSERT policy, not application code,
is what actually enforces "your own row only, forced `pending_review`, email must match your
real account"). Confirm it landed for real, directly against Postgres, not just a UI success
message:

```
docker exec supabase_db_Marketswave psql -U postgres -d postgres -c "select id, email, status from public.clients order by created_at desc limit 1;"
```

A real signup while pending is genuinely blocked at login — approve it with the local
stand-in script (there is no real admin UI or Edge Function for this yet; Stage 3+ work):

```
cd scripts
node supabase-approve-client.js <uid-from-the-query-above>
```

Then log in at `http://127.0.0.1:8765/login.html?backend=supabase` with the same
credentials — this is **THE BRIDGE**, the actual point of Stage 2: on success,
`mirrorAuthenticatedClientLocally()` (from `engine-core.js`, byte-for-byte the same function
the Firebase branch already calls) upserts a local shadow copy of the real `clients` row,
then `setClientAuthenticated(uid)` — the exact same pre-existing session function every one
of the 9 already-built dashboard pages already depends on — is called with the client's real
Supabase Auth uid. **Every already-built dashboard page keeps working with zero
modification**, having no idea the identity behind that id is now Supabase instead of
Firebase — verified live, not assumed: `dashboard.html`, `settings.html`,
`transactions.html`, and `asset-collection.html` all rendered correctly with the real
client's own name/initials and a genuinely clean, empty ($0, zero holdings) portfolio.

### Step 7 — Session persistence: deliberately configured, verified directly

Checked against the ACTUAL installed `@supabase/supabase-js` source first (not assumed):
`DEFAULT_OPTIONS = { autoRefreshToken: true, persistSession: true }`, and when
`persistSession` is true in a browser, session storage defaults to `globalThis.localStorage`
— the same CATEGORY of behavior as Firebase's own default `browserLocalPersistence`, just
backed by `localStorage` instead of IndexedDB. `supabase-config.js` (the client-facing file)
explicitly sets `persistSession: true` — not left implicit — because a normal client SHOULD
stay signed in like a normal login. **Verified live in a real browser**: after a real login,
`Object.keys(localStorage).filter(k => k.startsWith('sb-'))` shows a real
`sb-127-auth-token` key holding the actual session.

A future **admin-facing** Supabase client (Stage 3, not built yet — no admin page loads
`supabase-config.js` today) is DECIDED to use `persistSession: false`, mirroring
`admin-firebase-config.js`'s own `inMemoryPersistence` fix exactly (the real bug that fix
closed: Firebase's default persistence silently restored a signed-in admin session across
what was supposed to be a fresh prompt). **Verified directly, not assumed** — in a real
browser, signed in as the bootstrapped local admin (`pm@marketswave.local`) via a client
configured with `persistSession: false`:
- `localStorage` was checked immediately after a successful sign-in and held ONLY the
  pre-existing client session key, never a new one for the admin — a genuine comparative
  proof (the client config right above genuinely does write a key; the admin config,
  checked in the same origin, genuinely does not).
- A brand-new client instance (the correct proxy for "a real page refresh," since a fresh
  instance can only recover a session from actual persisted storage, never another
  instance's in-memory state) called `getSession()` and got back `null` — the admin session
  is real and usable for the lifetime of the signed-in instance, but does not survive a
  reload, exactly as decided.

### Step 8 — Confirm the golden path end to end, repeatably

```
cd scripts
node supabase-golden-path-regression.js
```

Mirrors `golden-path-regression.js` (the Firebase one) exactly in spirit: one command, walks
signup → pending status (+ a genuine blocked-login proof) → local `service_role` approve
(stands in for a real admin UI/Edge Function, which don't exist yet) → login succeeds →
dashboard loads with a clean $0 read → fund the account (a deposit request + local
credit, needed before an allocation is even possible) → request an allocation → local
approve → a BUY transaction + holding appear, Total Portfolio Value conserved. Prints a
clear `GOLDEN PATH: PASS (16/16 steps)` / `FAIL` line. **Confirmed to run clean, repeatedly**
— run twice in direct succession against the same local stack, `16/16` both times, no
manual cleanup needed between runs (a fresh timestamped test email avoids collisions). Test
accounts are left in the local stack afterward (harmless, real but fake data) — remove them
with `supabase db reset` if a clean slate is ever needed, or delete individually via Studio/
`psql`.

### Fixed: Logout now signs out of a real Supabase session too

Was a known, disclosed Stage 2 gap — closed same-day. `dashboard-sidebar.js`'s Logout
handler now runs a real `signOutOfSupabaseAuth()` (mirrors the existing
`signOutOfFirebaseAuth()`'s dynamic-import/best-effort/3-second-timeout shape) alongside
(via `Promise.all`, never instead of) the Firebase one and the local session clear.
**Investigated whether the same two races `signOutOfFirebaseAuth()` needed manual
workarounds for also apply here** — checked directly against the actual installed
`@supabase/auth-js` source: neither does, a genuine SDK/architecture difference (GoTrueClient
auto-initializes and `signOut()` itself awaits that promise; Supabase's session storage here
is synchronous `localStorage`, not Firebase's async IndexedDB default). Verified with the
same discipline that caught Firebase's two races — a fresh auth-state check on the NEXT page
load, never an in-page synchronous read. A real bug WAS caught during verification, but it
was environmental (a stale cached copy of `dashboard-sidebar.js`, this project's own
previously-documented pitfall), not a logic error — a hard reload resolved it and the test
then ran clean twice.

### Stage 3 — Real cloud staging + Edge Functions (Aug 30, 2026)

**The real admin approve/reject flow is fully live for the first time in this project's
entire migration history.** Firebase's own equivalent (Cloud Functions) stayed permanently
blocked on a Blaze plan upgrade for `marketswave-staging` — the whole reason this project
pivoted to Supabase in the first place. This stage proves the payoff: Supabase's free tier
deploys real Edge Functions with no card required, and they now genuinely resolve real
applications end to end against the real cloud project, called from a real admin UI — not a
script standing in for one.

- **Schema pushed to the real cloud project**: `supabase link --project-ref
  ujnmlwbpginplfnofhhv` (the one and only real project — confirmed via `supabase projects
  list` before linking anything), then `supabase db push` (previewed first with
  `--dry-run`, confirming only Stage 1's own migration would apply) and `supabase config
  push` (syncs `config.toml`'s `[auth.hook.custom_access_token]` registration to the real
  project's Auth service — a migration alone only creates the hook FUNCTION; the project's
  Auth config has to be told to actually call it, a separate real step).
- **`?backend=supabase&env=staging` now really works** — `supabase-config.js`'s
  `STAGING_CONFIG` targets the real `https://ujnmlwbpginplfnofhhv.supabase.co`, the
  `console.warn`-and-fall-back-to-local placeholder from Stage 2 is gone.
- **Real Edge Functions**: `supabase/functions/approve-client-application/` and
  `reject-client-application/`, mirroring `functions/index.js`'s own business rules
  field-for-field. **A real authorization bug was caught and fixed during local testing,
  before deployment** — the first draft checked `userClient.auth.getUser().app_metadata`,
  which returned `undefined` for a genuine local admin; `getUser()` fetches the live
  `auth.users` DATABASE record, a completely different thing from the JWT's own
  hook-injected claims. Fixed by using `getClaims(jwt)` instead — verifies the token
  server-side and returns the actual claims. Deployed via `supabase functions deploy`.
- **Real staging admin account**: `scripts/supabase-staging-bootstrap-admin.js` (mirrors
  `scripts/staging-bootstrap-admin.js`'s exact credential discipline — the `service_role`
  key is read from a JSON file path given via `SUPABASE_STAGING_CREDENTIALS_FILE`, never
  hardcoded or committed; the account's own password is generated and printed once, never
  stored) created `pm@marketswave-staging.internal` with a real `is_admin` `user_roles` row.
  This session's own copy of both the API keys file and the generated admin password live
  at `C:\WorkDirectory\marketswave-secrets\` (the same outside-the-repo directory the
  Firebase staging service account key already uses — see "Credential handling" below for
  that precedent) as `supabase-staging-api-keys.json` and
  `supabase-staging-admin-credentials.txt`; neither is referenced by that literal path
  anywhere in this codebase, only via the env var.
- **Admin UI wired to call it**: new `admin-supabase-config.js` (mirrors
  `admin-firebase-config.js`'s password-prompt-modal pattern, `persistSession: false` —
  Stage 2's own admin-flow decision, now actually implemented for the first time);
  `admin-client-applications.html` extended to merge in a real third source (Supabase,
  teal badge, alongside the existing local/Firebase merge) and route Approve/Reject through
  `supabase.functions.invoke()`.
- **Verified live, the complete real chain, exactly as the task asked**: a real applicant
  signed up through the actual 9-step form against `?backend=supabase&env=staging`;
  confirmed **visually in the real Supabase dashboard's Table Editor** (not a script) —
  `status: pending_review`; confirmed login genuinely blocked with the real pending
  message; clicked **Approve in the real admin UI** (not a script) — confirmed via the
  dashboard's own Edge Function Logs tab that the function genuinely booted at the exact
  click timestamp, and via a direct Table Editor re-check that `status` flipped to
  `active` with a fresh `application_resolved_at` — the only possible proof path, since
  RLS blocks any other caller from writing that row; logged in again, succeeded, landed on
  a real, clean `dashboard.html` render with zero code changes to that page. All test data
  removed from the real cloud project afterward. The local-stack path (Stage 2) was
  re-verified unaffected: `supabase-golden-path-regression.js` still `PASS (16/16 steps)`.

### What Stage 3 does NOT include yet

Signup/creation still goes through a direct, RLS-enforced client-SDK insert, not an Edge
Function (Stage 1/2's own established reasoning — RLS is what actually enforces the create
rules, mirroring `firestore.staging.rules`'s own design) — only Approve/Reject are real Edge
Functions. Real production Supabase (a distinct future project, not this same
"Marketswave Staging" one) is untouched. `admin-supabase-config.js` is real-cloud-only, no
local-stack branch — there is no "local admin UI" version of this to build, since the local
stack's own Edge Functions only run via a manual `supabase functions serve` dev session.

### Backend Migration Phase B — Stage 1: the portfolio engine, real tables (Aug 30, 2026)

**The highest-risk category of work in this migration — real money figures, going server-
side for the first time.** Local stack only, same discipline as every prior stage — this
does not touch the real cloud "Marketswave Staging" project. Adds 5 real tables
(`products`, `advisory_fee_rate`, `account_state`, `holdings`, `transactions`) and 6 real
Edge Functions (`get-account-state`, `get-holdings`, `get-transaction-ledger`,
`get-total-portfolio-value`, `execute-buy`, `execute-sell`) — a faithful port of
`engine-core.js`'s own settlement math, cost-basis math, and account bookkeeping, not a
reinterpretation. See CLAUDE.md's Tech Stack entry for the full writeup, including the two
genuinely necessary additions beyond the task's own literal 3-table list (`products` and
`advisory_fee_rate`, both hard dependencies of the 3 named tables).

Get a fresh local stack to this stage's own working baseline:

```
supabase migration up --local          # applies this stage's migration (and Stage 1's, if not already)
cd scripts
node supabase-seed-portfolio.js        # seeds products + a demo client's account_state/holdings
supabase functions serve               # in a separate terminal — serves all Edge Functions locally
node verify-supabase-portfolio-engine.js   # the full 40-assertion proof suite
```

**Verified**: `node scripts/verify-supabase-portfolio-engine.js` — **40/40 assertions
passed**, run twice for repeatability, including a genuine settlement-determinism cross-
check against the real, unmodified `engine-core.js` source (not just the ported TypeScript
trusted on its own): the same product, seeded to the same past `last_tick_date`, settles to
the byte-identical price on both the original browser-side engine and the real deployed
Edge Function stack. Also verified: the exact proportional cost-basis formula on a partial
sell (including the one detail most likely to get subtly wrong in a careless port —
`unallocated_capital` is credited with the cost-basis portion of a sale, NOT the full sale
value; the gain/loss goes separately into `asset_returns`); Total Portfolio Value exactly
conserved through a round-trip buy-then-sell; cross-client isolation (one client's
Edge Function calls never touch another client's rows, confirmed byte-for-byte); and the
core RLS property — a client can SELECT only their own rows across `account_state`/
`holdings`/`transactions`, and **no client-side INSERT/UPDATE/DELETE path exists on any of
the 5 tables for any role, including admin** — every write goes through `execute-buy`/
`execute-sell`, which are themselves admin-authorized only (mirroring the real engine's own
effective design: these primitives are never called directly by client-facing code, only
via a PM-approval action).

**What's now server-authoritative vs. what still isn't** — see CLAUDE.md's Tech Stack
entry for the complete list. In short: Account State, Holdings, and the Transaction ledger
(read + the raw buy/sell execution primitives) are real Postgres tables now, for the local
stack. The client-facing request/approval GATING layer around those primitives (the seven
Approval Gate queues — Client Applications, Deposits, Withdrawals, Allocations, Sells, HYS
Deposits, Client Profile Updates) is still 100% local/`localStorage`, as are High Yield
Savings and the Documents/Support domains — each awaits its own future Phase B stage.

### Backend Migration Phase B — Stage 2: Deposits and Withdrawals (Aug 30, 2026)

The first two of the seven Approval Gate queues to move off `engine-core.js`/`localStorage`.
Local stack only — the real cloud "Marketswave Staging" project is untouched. Adds 2 real
tables (`deposit_requests`, `withdrawal_requests`) and 6 real Edge Functions
(`request-deposit`, `request-withdrawal` — client-callable, self-only, `clientId` derived
from the caller's own JWT; `credit-deposit`, `approve-withdrawal`, `reject-deposit`,
`reject-withdrawal` — admin-only) — a faithful port of `requestDeposit()`/
`creditDepositRequest()`/`rejectDepositRequest()`/`requestWithdrawal()`/`approveWithdrawal()`/
`rejectWithdrawal()`. See CLAUDE.md's Tech Stack entry for the full writeup, including the
zero-balance-default-on-a-missing-`account_state`-row detail and the PM-editable-amount
property both functions preserve exactly.

Get a fresh local stack to this stage's own working baseline:

```
supabase migration up --local                       # applies this stage's migration too
cd scripts
supabase functions serve                            # in a separate terminal, if not already via `supabase start`
node verify-supabase-deposits-withdrawals.js         # the full 76-assertion proof suite
```

**Verified**: `node scripts/verify-supabase-deposits-withdrawals.js` — **76/76 assertions
passed**. Covers every validation path on both client-callable functions; the PM-editable-
amount property proven with a real differing confirmed/requested pair on both deposits and
withdrawals; **the re-validation-at-approval-time edge case** — two pending withdrawal
requests that together exceed available capital, where approving the first correctly leaves
the second refused (409) rather than driving the balance negative; double-resolve protection
(crediting/rejecting an already-resolved request is refused, with zero state change);
cross-client isolation (byte-for-byte diff of a second client's rows before/after the first
client's full deposit+withdrawal activity); the full RLS matrix on both new tables; and
authorization negative cases (401/403) on all 6 functions. The full existing Supabase suite
was re-run alongside with zero regressions: `verify-supabase-schema.js` 16/16,
`verify-supabase-portfolio-engine.js` 40/40, `supabase-golden-path-regression.js`
`PASS (16/16 steps)`.

**No client-facing or admin UI has been wired to these Edge Functions yet** —
`deploy-capital.html`/`admin-deposits.html`/`admin-withdrawals.html` still call the local
`engine-core.js` functions. This stage is schema + Edge Functions + Node verification only,
per its own scope; wiring the UI is separate, not-yet-scoped future work.

### Backend Migration Phase B — Stage 3: Allocations and Sells (Aug 30, 2026)

Two more of the seven Approval Gate queues move off `engine-core.js`/`localStorage` — 4 of 7
total after this stage. Local stack only — real cloud "Marketswave Staging" untouched.
Meaningfully different from Stage 2: `allocation_requests`/`sell_requests` don't stand
alone, they resolve INTO Stage 1's already-built `execute-buy`/`execute-sell` functions via
a real internal HTTP call (forwarding the caller's own admin JWT), rather than duplicating
either function's settlement/cost-basis logic. Adds 2 real tables (`allocation_requests`,
`sell_requests`, RLS reused verbatim from Stage 2) and 6 real Edge Functions
(`request-allocation`, `request-sell` — client-callable, self-only; `approve-allocation`,
`approve-sell`, `reject-allocation`, `reject-sell` — admin-only) — a faithful port of
`requestAllocation()`/`approveAllocationRequest()`/`rejectAllocationRequest()`/
`requestSell()`/`approveSellRequest()`/`rejectSellRequest()`. See CLAUDE.md's Tech Stack
entry for the full writeup, including a real, deliberate, flagged strengthening:
`approve-allocation` re-validates against the client's current `unallocated_capital` at
approval time even though the real local `approveAllocationRequest()` does not — a genuine
gap in the local engine this stage closes, not merely ports.

Get a fresh local stack to this stage's own working baseline:

```
supabase migration up --local                       # applies this stage's migration too
cd scripts
supabase functions serve                            # in a separate terminal, if not already via `supabase start`
node verify-supabase-allocations-sells.js            # the full 88-assertion proof suite
```

**Verified**: `node scripts/verify-supabase-allocations-sells.js` — **88/88 assertions
passed** on the first run. Covers every validation path on both client-callable functions;
an investigated-and-reported finding (the real local `requestSell()` has no "sum of this
client's own other pending sell requests" guard — that guard is UI-only, in
`asset-performance.html`, not inside the engine function itself); **the
internal-call-not-reimplementation proof** — a dedicated test calls `approve-allocation`
for one client and a direct `execute-buy` call for another on the same product/day,
confirming both entry points settle to the identical unit price and units-from-price
formula, with the mirrored proof for `approve-sell`/`execute-sell`; **both
re-validation-at-approval-time edge cases** (two allocations, then two sells, each pair
together exceeding what's available — only the first of each pair succeeds); reject-with-
reason for both queues; cross-client isolation; the full RLS matrix; and authorization
negative cases (401/403) on all 6 functions. The full existing Supabase suite was re-run
alongside with zero regressions: `verify-supabase-schema.js` 16/16,
`verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js`
76/76 (132 total, unaffected), `supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**No client-facing or admin UI has been wired to these Edge Functions yet** —
`asset-collection.html`/`asset-performance.html`/`admin-allocations.html`/
`admin-sells.html` still call the local `engine-core.js` functions. This stage is schema +
Edge Functions + Node verification only, per its own scope; wiring the UI is separate,
not-yet-scoped future work.

**Approval Gate queues now server-authoritative (local stack only), after Stages 1-3**:
Deposits, Withdrawals, Allocations, Sells — 4 of 7. **Still 100% local/`localStorage`**:
Client Applications, HYS Deposits, Client Profile Updates — plus HYS pocket withdrawals and
Documents/Support, each awaiting its own future Phase B stage.

### Backend Migration Phase B — Stage 4: HYS pockets + HYS Deposit/Withdrawal (2026-09-02)

HYS pockets and both HYS approval queues move off `engine-core.js`/`localStorage` — 5 of the
7 Approval Gate queues are now server-authoritative after this stage; only Client
Applications and Client Profile Updates remain local. Local stack only — real cloud
"Marketswave Staging" untouched. Adds 3 real tables (`hys_pockets`, `hys_deposit_requests`,
`hys_withdrawal_requests` — the third a genuinely necessary addition beyond this stage's own
literal 2-table schema list, since the EDGE FUNCTIONS section it also specified had nowhere
else to persist a pending HYS withdrawal request) and 6 real Edge Functions
(`request-hys-deposit`, `request-hys-withdrawal` — client-callable, self-only;
`credit-hys-deposit`, `reject-hys-deposit`, `approve-hys-withdrawal`,
`reject-hys-withdrawal` — admin-only) — a faithful port of `requestHYSDeposit()`/
`creditHYSDeposit()`/`rejectHYSDeposit()`/`getHYSRate()`/`requestHYSWithdrawal()`/
`approveHYSWithdrawal()`/`rejectHYSWithdrawal()`/`computeHYSWithdrawalAmount()`. See
CLAUDE.md's Tech Stack entry for the full writeup, including a real, disclosed gap found
while reading the local source: `high-yield-savings.html`'s own client-side
`updatePocketStatuses()` — not `engine-core.js` — is the only place a fixed pocket ever
transitions from `active` to a third status, `matured`, once its `maturity_date` passes; this
stage's `hys_pockets.status` CHECK constraint includes `matured` to stay faithful to that real
three-status model, but no Edge Function here performs the transition itself, since there's no
client-facing HYS UI wired to Supabase yet to port that page-load-time behavior from.

Get a fresh local stack to this stage's own working baseline:

```
supabase migration up --local                       # applies this stage's migration too
cd scripts
supabase functions serve                            # in a separate terminal, if not already via `supabase start`
node verify-supabase-hys.js                          # the full 103-assertion proof suite
```

**Verified**: `node scripts/verify-supabase-hys.js` — **103/103 assertions passed** on the
first run. Covers every validation path on both client-callable functions across both Fixed
(short-term and locked-term) and As-You-Want pockets; the PM-editable-confirmed-amount
property; **maturity computed from the credit date, not the request date**, and
**projected interest computed from the confirmed amount, not the requested one**; the
locked-term-blocks-early-withdrawal rule (and, distinctly, that a short-term pocket is NOT
hard-blocked the same way — it can be withdrawn early, it just forfeits interest); the
forfeiture-vs-matured distinction (an active fixed pocket forfeits, a matured one does not,
an AYW pocket never forfeits and always returns its full balance); a duplicate-pending guard
per pocket; **the re-validation-at-approval-time edge case** — a pocket withdrawn out from
under a still-pending request by some other resolved path correctly fails approval (409)
rather than double-withdrawing it; the symmetric external-payout property (neither
`credit-hys-deposit` nor `approve-hys-withdrawal` ever touches `account_state`); cross-client
isolation across all 3 new tables; the full RLS matrix, including that `hys_pockets` has NO
client-side INSERT path at all, even a genuinely-own one (pockets are created only via
`credit-hys-deposit`); and authorization negative cases (401/403) on all 6 functions. The full
existing Supabase suite was re-run alongside with zero regressions: `verify-supabase-schema.js`
16/16, `verify-supabase-portfolio-engine.js` 40/40,
`verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js`
88/88 (323 total, unaffected), `supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**No client-facing or admin UI has been wired to these Edge Functions yet** —
`high-yield-savings.html`/`admin-hys.html` still call the local `engine-core.js` functions.
This stage is schema + Edge Functions + Node verification only, per its own scope; wiring the
UI is separate, not-yet-scoped future work.

**Approval Gate queues now server-authoritative (local stack only), after Stages 1-4**:
Deposits, Withdrawals, Allocations, Sells, HYS Deposits, HYS Withdrawals — 5 of 7 domains (6
of the queue-shaped stores, since HYS Deposits/Withdrawals are 2 stores within 1 conceptual
domain). **Still 100% local/`localStorage`**: Client Applications, Client Profile Updates —
plus Documents/Support, each awaiting its own future Phase B stage.

### Backend Migration Phase B — Stage 5: the final 2 Approval Gate queues (2026-09-02)

**★ ALL 7 OF 7 APPROVAL GATE QUEUES ARE NOW SERVER-AUTHORITATIVE (LOCAL STACK ONLY). This
closes the entire "Approval Gate" category of Phase B work — Client Applications and Client
Profile Updates were the last two.** Local stack only — real cloud "Marketswave Staging"
untouched.

**Client Applications — investigated first, per instruction. Nothing to build.** Confirmed by
reading the real, already-shipped source before writing anything: this queue has been fully
real, end to end, since Stage 3 (Aug 30, 2026) — the `clients` table (Stage 1) already has
`status`/`application_resolved_at`/`application_reason`; creation is already a direct
RLS-enforced insert from `signup.html`; `approve-client-application`/
`reject-client-application` (Stage 3) already exist, are already deployed to real staging, and
are already enabled for the local stack; `admin-client-applications.html` already lists and
resolves real Supabase applications. The one genuine gap: no *persistent* Node script
previously exercised these two functions against the *local* stack — closed by this stage's
own `verify-supabase-final-approval-gate.js`, Part 1.

**Client Profile Updates — genuinely new.** Adds 2 real tables (`client_profiles` — a
necessary addition beyond this stage's own literal schema list, since a real server-side
profile store is required for "snapshot the current value automatically" to mean anything;
`profile_change_requests`, which also picked up a necessary `resolution_note` column, kept
deliberately separate from the client's own `reason`) and 3 real Edge Functions
(`request-profile-change` — client-callable, self-only; `approve-profile-change`,
`reject-profile-change` — admin-only) — a faithful port of `requestSettingsChange()`/
`approveSettingsChangeRequest()`/`rejectSettingsChangeRequest()`/`getSettingsProfile()`.
**Confirmed, per instruction: `dateOfBirth` is genuinely gone** — the real
`REQUESTABLE_SETTINGS_FIELDS` array is exactly `['legalName', 'address', 'idDocument']`, no
fourth field; this migration's CHECK constraint uses those same 3 real values (camelCase, not
the task's own `legal_name`/`address`/`id_document` snake_case paraphrase — a field-value
fidelity finding in the same category as Stage 4's `pocket_type`). A client with no profile on
file yet reads back a genuine `null` current value, never a fabricated default — the local
engine's own real fix for this exact fake-default bug (register row 80) is ported forward from
the start rather than repeated.

Get a fresh local stack to this stage's own working baseline:

```
supabase migration up --local                        # applies this stage's migration too
cd scripts
supabase functions serve                             # in a separate terminal, if not already via `supabase start`
node verify-supabase-final-approval-gate.js           # the full 69-assertion proof suite
```

**Verified**: `node scripts/verify-supabase-final-approval-gate.js` — **69/69 assertions
passed**. Part 1 (Client Applications, 12 assertions): real state transitions for both
approve and reject against genuine `pending_review` rows, double-resolve protection,
cross-client isolation, and authorization negative cases against the already-existing
functions. Part 2 (Client Profile Updates, 57 assertions): validation for all 3 fields;
the no-fake-fallback `null` current-value snapshot; **field-specific correctness proven for
each of the 3 fields individually, not one tested as a stand-in for all** (a real legalName
approval, a real address approval, and a real idDocument approval, each confirmed not to
clobber the other two on the same profile row); a wholesale-replace-not-merge proof on a
second legalName change; cross-client isolation; the full RLS matrix (including that
`client_profiles` has NO client-side INSERT path at all — profiles are created only via
`approve-profile-change`); and authorization negative cases (401/403) on all 3 functions. The
full existing Supabase suite was re-run alongside with zero regressions:
`verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
`verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js` 88/88,
`verify-supabase-hys.js` 103/103 (392 total, unaffected), `supabase-golden-path-regression.js`
`PASS (16/16 steps)`.

**No client-facing UI has been wired to `request-profile-change` yet** —
`settings.html` still calls the local `engine-core.js` function directly.
`admin-client-applications.html` already calls the real (pre-existing) Client Applications
functions; no admin UI exists yet for Client Profile Updates specifically (the local
`admin-profile-updates.html` still calls the local `engine-core.js` functions). This stage is
schema + Edge Functions + Node verification only for Client Profile Updates, per its own
scope; wiring the UI is separate, not-yet-scoped future work.

**All 7 Approval Gate queues are now server-authoritative (local stack only)**: Client
Applications, Deposits, Withdrawals, Allocations, Sells, HYS Deposits, HYS Withdrawals, Client
Profile Updates.

### Backend Migration Phase B — Stage 6: Documents & Support (2026-09-02)

**★ EVERY DOMAIN FROM THE ORIGINAL ENGINE NOW HAS REAL SUPABASE SCHEMA/FUNCTIONS (LOCAL
STACK ONLY). This closes the entire backend-logic portion of Phase B — the remaining gap,
across all 6 stages, is UI-wiring only, not backend logic.** Local stack only — real cloud
"Marketswave Staging" untouched.

**★ Documents & Support are NOT Approval Gate queues, and this stage's own schema
deliberately does not copy the "zero client-side write, everything through service_role"
pattern Stages 2-5 used.** Investigated the real client-side call pattern in
`documents.html`/`support.html` before writing any schema, per instruction, and confirmed:
a client directly calls `addDocument()` (upload), `updateDocument()` (Sign), and
`removeDocument()` (Remove) with NO gate at all; a client's own dispute-submit handler
creates a ticket immediately, status `'Open'`, no pending/approved/rejected step. Only
publishing a `from` document, a generic admin patch (e.g. "Mark Reviewed"), and support
ticket status/pmNote updates are admin-only. The schema below matches that real shape.

**Documents**: `documents` table gets a REAL client-side INSERT policy (own upload only,
`with check` pinned to the exact real `addDocument()` call shape — `direction='upload'`,
category restricted to the 3 real client-selectable values, `status='Received'`,
`is_new=false`, `deadline_label` null) and a REAL client-side UPDATE policy scoped
exclusively to the Sign transition (`direction='from'` + `status='Signature Required'` →
`status='Signed'`). A client can never INSERT a `direction='from'` document (impersonating
the firm) — that's `publish-document`, admin-only. `update-document` (admin-only, generic
patch) covers "Mark Reviewed" and any other admin patch. **A deliberate strengthening beyond
the local engine, flagged per instruction**: client-side DELETE (Remove) is scoped to
`direction='upload'` only — the real local `removeDocument(id)` has no such check at all, but
the real UI never exposes Remove for a `from` document either; at the real Supabase security
boundary, "never exploitable via the shipped UI" isn't the same guarantee as "structurally
impossible," so the RLS policy closes that gap.

**Support**: `support_requests` gets NO client-side INSERT/UPDATE/DELETE policy at all —
a genuine, reasoned deviation from documents' own direct-insert approach, not an
inconsistency. Ticket creation (`request-support-ticket`) is still immediate and
unconditional — the same real "no approval gate" property — but goes through a thin
Edge Function because the human-readable `display_id` (e.g. `DISP-0001`) must be genuinely
server-computed, and RLS's row-level `with check` has no clean way to verify "this id was
computed by our own scan-and-increment algorithm" without a trigger. **A real, investigated
finding, confirmed not assumed**: the local `nextDisputeId()` scans only the CURRENT
client's own scoped array — `display_id` is unique PER CLIENT, not globally (two different
clients' first-ever ticket can both legitimately be `DISP-0001`) — so `support_requests.id`
is a genuine `gen_random_uuid()` primary key, with `display_id` kept in its own column,
`unique(client_id, display_id)`.

Get a fresh local stack to this stage's own working baseline:

```
supabase migration up --local                        # applies this stage's migration too
cd scripts
supabase functions serve                              # in a separate terminal, if not already via `supabase start`
node verify-supabase-documents-support.js              # the full 64-assertion proof suite
```

**Verified**: `node scripts/verify-supabase-documents-support.js` — **64/64 assertions
passed** on the first run. Documents (Part 1): the exact real client-INSERT shape proven
(and every deviation from it refused — spoofed direction/category/status/is_new/client_id);
`publish-document` as the only path to a `from` document, including its real
`deadlineLabel` computation; the Sign action's exact real UPDATE shape (and every
deviation refused — re-signing, signing a non-required doc, an arbitrary target status,
signing an upload); `update-document`'s real "Mark Reviewed" usage; the Remove
DELETE scoped correctly (own upload succeeds, a `from` document is refused); cross-client
isolation; the RLS matrix; auth negatives. Support (Part 2): immediate no-gate ticket
creation with a real server-computed `display_id`, confirmed genuinely per-client (not
global) by creating two different clients' first tickets and proving both land on
`DISP-0001` as two distinct rows with different real uuid primary keys; `update-support-ticket`
setting status + pmNote atomically, including a second real re-update; the full RLS matrix
proving zero client-side write path at all (INSERT/UPDATE/DELETE all refused, for a
non-admin AND an admin-claimed caller alike); cross-client isolation; auth negatives. The
full existing Supabase suite was re-run alongside with zero regressions:
`verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
`verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js`
88/88, `verify-supabase-hys.js` 103/103, `verify-supabase-final-approval-gate.js` 69/69 (456
total, unaffected), `supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**No client-facing or admin UI has been wired to any of these 4 Edge Functions yet** —
`documents.html`/`admin-documents.html`/`support.html`/`admin-support.html` all still call
the local `engine-core.js` functions. This stage is schema + Edge Functions + Node
verification only, per its own scope; wiring the UI is separate, not-yet-scoped future work.

**★ Every domain from the original engine now has real Supabase schema/functions (local
stack only)**: all 7 Approval Gate queues (Stages 2-5) plus HYS pockets (Stage 4) plus
Documents & Support (this stage) plus the portfolio engine's own financial core (Stage 1)
plus identity (earlier Supabase stages). **The entire remaining gap is UI-wiring, not backend
logic** — across every one of Stages 1 through 6, not one client-facing page or admin page
anywhere in the project has been switched over to call any of these Supabase functions
instead of the local `engine-core.js` equivalents (the sole partial exception, unaffected by
this stage, is Client Applications' own admin listing/resolve UI, wired back in Stage 3).
Every dashboard page and every admin page still runs entirely on `localStorage` today,
regardless of how much of the backend now technically exists in Supabase.

### UI Wiring — Stage 1: dashboard.html (2026-09-03)

**The FIRST page in the project wired to any real Supabase backend logic.** Every prior
Supabase stage (1-6) was schema + Edge Functions + Node verification only — this is where a
real client-facing page starts calling them. Local stack only, real cloud "Marketswave
Staging" untouched.

**Identity — investigated first, per instruction. No change needed.** `dashboard.html` still
resolves the authenticated client via `getAuthenticatedClientId()` (the local hybrid-bridge
mirror `dashboard-sidebar.js`'s own file-load-time guard already established). That mirror
already reflects real Supabase identity — `login.html`'s real Supabase branch calls
`mirrorAuthenticatedClientLocally()` + `setClientAuthenticated(uid)` with the client's REAL
Supabase Auth uid — so no identity-resolution code changed. The only new concern this stage
introduces: the new Supabase calls need a live Supabase session (JWT), which is already
sitting in `localStorage` from the real login that got the client here (`persistSession:
true`) — `supabase-data.js` reaches it via the exact same `import('./supabase-config.js')`
dynamic-import technique `dashboard-sidebar.js`'s own `signOutOfSupabaseAuth()` already uses.

**New shared file, `supabase-data.js`** — the canonical async data-fetching + loading/error
pattern every future UI-wiring stage should import and reuse rather than re-deriving:
- `getSupabaseClient()` / `callFunction(name, body)` / `selectTable(table, applyQuery)` —
  thin wrappers around a lazily-created, page-lifetime-cached Supabase client.
- **`renderAsyncBundle(regions, { load, render, skeletonHTML })`** — the reusable loading/
  error convention. Paints a Tailwind `animate-pulse` skeleton into the given region(s)
  immediately, calls `load()` once, calls `render(data)` on success, or paints a consistent
  red error card (with a real "Try Again" button that re-runs the whole sequence) on
  failure. `regions` may be a single element or an array sharing one combined data load.
  **This is THE pattern — cite `supabase-data.js`'s own header comment directly in future
  wiring stages instead of re-deriving it.**

**dashboard.html's data fetching**: `get-account-state`, `get-holdings`,
`get-transaction-ledger`, `get-total-portfolio-value` (all Phase B Stage 1), plus a direct
RLS-authorized read of `products` (no Edge Function needed or exists for the catalog).
**Two real behavioral differences found by reading the actual Edge Functions before wiring
anything, not assumed**: (1) `get-account-state` returns a genuine 404 for a client with no
`account_state` row yet (a fresh/unfunded client) — the local engine's own
`readAccountStateForClient()` has always defaulted to a real $0 state instead of treating
"not found" as an error, so a 404 here is caught and mapped to the same $0 default, not
surfaced as an error card. (2) `get-transaction-ledger` already queries
`ORDER BY created_at DESC` (newest first) — genuinely different from the local engine's own
insertion-order array (oldest first), which the old code compensated for with
`.slice(-3).reverse()`. Blindly reusing that slice against the real query's own real
ordering would have silently shown the 3 OLDEST transactions in reverse order; fixed to
`.slice(0, 3)`, the correct equivalent.

**Responsive/animation**: unaffected — confirmed by diff, not just assumed; only the
`<script>` contents changed (plus one new `<script src="supabase-data.js">` tag), zero
markup/CSS touched.

**Verified**: `npm run verify-dashboard-ui-wiring` (from `scripts/`) — **27/27 assertions
passed, twice in direct succession**. **★ No browser automation tool is available in this
session (checked directly before starting, not assumed) — this script is the substitute**,
loading the REAL, unmodified `supabase-data.js` and the REAL, unmodified `dashboard.html`
inline script (extracted verbatim) into a minimal fake DOM (mirroring this project's own
established `scripts/lib/engine-harness.js` precedent), driven by a REAL local Supabase
session for a REAL test client seeded with deliberately distinctive numbers (never
mistakable for the old hardcoded/local-demo figures). Covers: `renderAsyncBundle()`'s own
loading/error/retry mechanics in isolation (skeleton paints synchronously before any
promise resolves; a failed load shows the error card with a genuine clickable Try Again;
retry re-fetches exactly once, not more); the real page rendering the real, independently-
computed TPV/allocation/risk-metric/recent-activity figures for the real test client (cross-
checked directly against Postgres, not the app's own logic); the "3 most recent, newest
first" ordering proven correct against 4 real seeded transactions; and a genuinely failed
call (a signed-out session, a real 401) showing the error card — not a blank or broken page —
on every affected region independently. One seam disclosed, not hidden: `supabase-config.js`'s
own CDN import (`https://esm.sh/@supabase/supabase-js@2.112.4`) is redirected to the
already-installed local npm package via a custom `module.register()` loader
(`scripts/lib/esm-loader-supabase-cdn.mjs`, the same technique this project used once before
for an equivalent Firebase-side config file) — every other line of both real files runs
completely unmodified. The full existing Supabase suite was re-run alongside with zero
regressions: `verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
`verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js`
88/88, `verify-supabase-hys.js` 103/103, `verify-supabase-final-approval-gate.js` 69/69,
`verify-supabase-documents-support.js` 64/64 (456 total, unaffected),
`supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**If a real visual/browser check is wanted**: log in as a real test client at
`login.html` (no query params needed for the local stack) and visit `dashboard.html` — a
real client can be created via `scripts/supabase-seed-portfolio.js` (see that script's own
header for its demo credentials), though that demo user has no `clients` row and so cannot
complete a real login through the form itself; a client created via the real 9-step signup
form (approved via `admin-client-applications.html`) can.

### UI Wiring — Stage 2: asset-collection.html + asset-performance.html (2026-09-03)

**This project's first two real WRITE actions** — Request Allocation and Sell — join Stage
1's read-only wiring. Reuses `supabase-data.js`'s canonical pattern exactly, extending it
(not forking a page-specific alternative) with two additions every future write-action
wiring stage should also cite directly:

- **`MarketswaveData.withButtonBusy(button, busyLabel, fn)`** — the write-action counterpart
  to `renderAsyncBundle()`. A write is NOT safely auto-retryable the way a read is (retrying
  a GET is harmless; blindly "retrying" a write risks a real double-submission), so this
  helper owns only the clicked button's own in-flight visual state (disabled + a small
  Tailwind `animate-spin` indicator + a busy label) — the caller's own `fn()` promise is what
  the caller reacts to (a toast, a modal close), exactly mirroring how `renderAsyncBundle`
  only owns a region's loading/error state and leaves `render()` to the caller.
- **A real bug found and fixed in `callFunction()`/`classifyError()` (present since Stage 1,
  never exercised there)**: confirmed directly against the installed `@supabase/functions-js`
  source that a failed Edge Function call's own `.message` is ALWAYS the literal generic
  string `"Edge Function returned a non-2xx status code"` — supabase-js does NOT parse the
  real response body for you. Every one of this project's Edge Functions returns its real,
  specific validation message as `{ error: "..." }` JSON, reachable only via
  `error.context.json()` (`.context` is the raw fetch `Response`). Without this fix, every
  failed write action in the whole project would have shown that same useless generic string
  instead of e.g. "Allocation amount exceeds current unallocated capital." — fixed now,
  before any write action needed it for real. New `MarketswaveData.writeErrorMessage(err)`
  shows the real server message verbatim for a genuine business-rule rejection (400/409) and
  falls back to the existing generic `friendlyMessage()` only for 401/403/network/500, where
  there's no business-specific text to show.

**Investigated first, per instruction — a real task correction**: "My Requests" (allocation +
sell history) lives on `asset-performance.html`, not `asset-collection.html` — confirmed by
reading both real files directly; the latter has no such section. Wired there accordingly.

**A real client-side-validation finding**: the only client-side check that existed before this
stage, on either page, was a plain positive-number check — neither page ever duplicated the
minimum-investment/sufficient-capital/held-units business rules client-side; those were
always enforced by the callee's own thrown validation. "The server is authoritative" was
already true architecturally; this stage didn't have to newly establish it, only carry it
across the sync-to-async boundary.

**A real schema gap found and disclosed, not silently worked around**: `engine-core.js`'s own
Product Catalog carries `description`/`extendedDescription`/`logoUrl`, but Phase B Stage 1's
real `products` table has no such columns (schema changes are out of this UI-wiring-only
stage's scope) — every product's logo/More-info features now show their existing, already-
correct "not set" fallback (initials instead of a logo, no More Info link) until a future
stage adds real column support.

**Verified**: `npm run verify-asset-pages-ui-wiring` (from `scripts/`) — **36/36 assertions
passed, twice in direct succession**. **★ No browser automation tool is available in this
session — checked again, not assumed carried over from Stage 1.** Stage 2's real write
actions are driven by delegated click handlers with real `closest()` DOM traversal, which
Stage 1's own hand-rolled minimal DOM stub can't faithfully simulate — rather than keep
hand-rolling an increasingly fragile stub, `jsdom` was installed as a genuine, persistent
`scripts/` devDependency (every future UI-wiring stage will need the same real-click-
simulation capability) — a real DOM implementation, so `closest()`/`querySelectorAll()`/
`.click()`/event bubbling all work exactly as a real browser's would. Both real HTML files'
`<body>` markup and real inline `<script>` blocks are extracted verbatim (not hand-
reconstructed) and run inside that real DOM via `window.eval()`. Covers: real product cards
rendering with correct "already holding"/"No position" badges; a real successful Request
Allocation round trip (a real new pending row confirmed directly in Postgres, the toast, the
input clearing, the button's busy-then-restored state); **two genuine server-side
rejections** — below a product's real minimum investment, and exceeding the client's real
unallocated capital — each confirmed via the real, specific server message appearing
verbatim in the toast AND via a direct Postgres query proving zero rows were created, not
just a client-side catch; the real Return Table/summary cards rendering correctly for real
holdings; a real successful Sell round trip (modal closes, a real pending row created for
the full held units, Return Table and My Requests both genuinely refresh); and **a real
server-side sell rejection via an actual concurrent-change race** (a holding's real unit
count reduced in Postgres, from a separate path, between the Sell modal opening and
Submit being clicked) — proving `request-sell`'s own re-validation catches exactly the
real-world race it exists for, with the real rejection message shown and the modal staying
open rather than silently closing. The full existing Supabase suite was re-run alongside
with zero regressions: `verify-supabase-schema.js` 16/16,
`verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js`
76/76, `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 103/103,
`verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js`
64/64, `verify-dashboard-ui-wiring.mjs` 27/27 (483 total, unaffected — including Stage 1's
own dashboard.html check, confirming the `supabase-data.js` extensions above introduced no
regression there), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**★ A real visual/browser check is worth doing manually before the next wiring stage** —
these are this project's first two real write actions, and while the Node-level harness
above proves the real request/response/DOM-update chain end to end, seeing it with your own
eyes is still worth the few minutes given the stakes. Suggested walkthrough: sign up (or use
an already-approved) real test client, log in at `login.html` (no query params needed for the
local stack), visit `asset-collection.html`, submit a real Request Allocation (try both a
valid amount and one you expect the server to reject, e.g. below a product's minimum), then
visit `asset-performance.html` and submit a real Sell on any held position — watch for the
skeleton-then-content loading state, the button's busy state while the request is in flight,
and the toast's exact wording on both success and a deliberate rejection.

### UI Wiring — Stage 3: deploy-capital.html + transactions.html (2026-09-03)

Two more real actions join the wired set: **Deposit** (crypto/bank) and **Withdraw** on
`deploy-capital.html` (this project's 3rd and 4th real write actions, following Stage 2's
Request Allocation/Sell), plus `transactions.html`'s full read-only surface — summary cards,
both charts, Recent Activity, the ledger table with all 4 filters, and the drill-down modal.
Reused `supabase-data.js`'s canonical pattern exactly as instructed — `renderAsyncBundle()`,
`withButtonBusy()`, `writeErrorMessage()`, `classifyError()` — with **zero further extension
needed**; Stage 2's two additions already covered everything both pages required.

**A real structural conflict found and fixed before any test ran, not caught as a runtime
failure**: `transactions.html`'s ledger table had a static `<tr id="ledger-empty-row">` sitting
inside `<tbody id="ledger-body">` in the original markup. `renderAsyncBundle()`'s skeleton
phase replaces that container's `innerHTML` wholesale, which would silently destroy that
static child on the very first load. Fixed by removing the static row from the HTML entirely
and rewriting `renderLedger()` to build the table body's full content — including the empty
state — on every call, matching the same full-rebuild discipline already established for
`asset-collection.html`/`asset-performance.html`'s own card grids in Stage 2. **General
principle for any future wiring stage, worth restating**: a container that gets
`renderAsyncBundle()`'d must have its `render()` do a complete rebuild each call — never
assume a static pre-existing child survives past the first skeleton paint.

**Real schema/behavior findings, confirmed against the actual running local stack, not
assumed**:
- `get-transaction-ledger` returns rows **newest-first** (`ORDER BY created_at DESC`) — the
  opposite of the local engine's own oldest-first in-memory array. `transactions.html`'s
  existing sort/group logic was checked against this and needed no change (it always sorted
  by real date/derived values itself, never relied on array order).
- `created_at`/`requested_at` are real, full ISO `timestamptz` values — no more need for the
  local engine's own `requestedAtMs` workaround (that field existed there only to disambiguate
  same-day string dates). A small `toDateOnly(iso)` helper maps the real timestamp down to a
  plain `'YYYY-MM-DD'` string wherever the page's existing filter/grouping logic was written
  against date-only strings, so that logic keeps working completely unchanged.
- `get-account-state`'s established "404 on no row = a genuine $0 default, not an error"
  pattern (Stage 1) was reused as-is on both pages — a client with no funding activity yet
  correctly sees $0/empty state, not an error card.

**deploy-capital.html**: the two previously-separate Deposit/Withdraw IIFEs (communicating
only via a fragile `window.renderMyFundingRequests` global) were merged into one IIFE sharing
real module-level state (`depositRequests`, `withdrawalRequests`, `account`), loaded once via
a cached-promise `loadFundingData()` and rendered through a single `renderAsyncBundle()` call
over the "My Funding Requests" section. Both Deposit forms (crypto/bank) and the Withdraw form
now call the real `request-deposit`/`request-withdrawal` Edge Functions through
`withButtonBusy()`, showing the real server message via `writeErrorMessage()` on rejection and
reloading the funding-requests list on success. The "Available to withdraw" figure is informational
only here (unlike Stage 2's Sell modal, which hard-gates its Submit button on a stale
client-side value) — confirmed by reading the real form's own submit handler before writing
any test.

**Verified**: `npm run verify-funding-transactions-ui-wiring` (from `scripts/`) — **54/54
assertions passed, twice in direct succession**. **★ No browser automation tool is available
in this session — checked again, not assumed carried over from Stage 2.** Reused the same
`jsdom`-based real-DOM harness (verbatim `<body>`/`<script>` extraction, `window.eval()`)
established in Stage 2. A real test client was seeded with a real funded account, one real
holding, and 4 real transactions spanning 2 calendar months (DEPOSIT, BUY, SELL, WITHDRAWAL)
so every rendering path — including DEPOSIT/WITHDRAWAL's "—" Quantity/Price guard and both
charts' documented positive/negative cash-flow treatment — had real data to prove itself
against. Covers: a real successful crypto deposit and a real successful bank deposit (each
confirmed via a direct Postgres row, not just the toast); a real successful withdrawal,
confirming the real "Available to withdraw" figure; a real **409 server-side rejection**
requesting a withdrawal far beyond unallocated capital, confirmed via the real message shown
verbatim through `writeErrorMessage()` and zero new rows in Postgres; **a real concurrent-
change race**, adapted from Stage 2's Sell-verification pattern — the real unallocated balance
was reduced directly in Postgres, from a separate path, after the form's stale "Available to
withdraw" figure was already captured, then a withdrawal was submitted against that stale
figure and confirmed genuinely rejected server-side (not just caught client-side), proving
`request-withdrawal`'s own re-validation-at-request-time check is real, not decorative. On
`transactions.html`: real, independently-computed summary cards (Total Buys, Total Sells, Net
Invested, and the advisory fee accrual computed independently against the real global rate and
compared); Recent Activity and DEPOSIT/WITHDRAWAL labels/badges rendering correctly; all 4
filters (Type, Asset, Date range, Reset) re-confirmed working correctly against real
async-loaded data, including a Date-From filter proven against real timestamps; both charts
verified via a fake `Chart` constructor stub that records the real config/data passed to it
(jsdom has no real Canvas 2D backend, so this proves the real data-aggregation logic feeds
Chart.js correct real numbers — explicitly **not** a proof of actual pixel rendering) —
confirmed 2 real month buckets, correct Buys/Sells-per-month figures, and the documented
Net-Cash-Flow rule (deposits positive, withdrawals negative) holding against real seeded data;
the drill-down modal opening on a real row click and showing the real DEPOSIT total with a
correct Realized Return row for the real SELL. **One real bug found and fixed — in the test
script itself, disclosed rather than silently patched**: the first run used `'mainnet'` as the
crypto network value, which isn't one of the real `<select>`'s actual options
(ERC20/TRC20/BEP20/Native); fixed to `'ERC20'` and re-run clean. The full existing Supabase
suite was re-run alongside with zero regressions: `verify-supabase-schema.js` 16/16,
`verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js` 76/76,
`verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 103/103,
`verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js` 64/64,
`verify-dashboard-ui-wiring.mjs` 27/27, `verify-asset-pages-ui-wiring.mjs` 36/36 (573 total,
unaffected), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**★ A real visual/browser check is worth doing manually before the next wiring stage** —
suggested walkthrough: log in as a real (already-approved) test client at `login.html` (no
query params needed for the local stack), visit `deploy-capital.html`, submit a real Crypto
Deposit and a real Bank Deposit (watch the button's busy state and the success toast), then
try a Withdraw request for an amount larger than your real unallocated capital and confirm the
real server-rejection message appears; scroll to "My Funding Requests" and confirm all of them
appear with correct status badges. Then visit `transactions.html` and confirm: the summary
cards and both charts load (skeleton-then-content), the ledger table shows your real deposit/
withdrawal rows alongside any existing buy/sell activity with correct "—" Quantity/Price cells,
each of the 4 filters narrows the table correctly, and clicking a row opens the drill-down
modal with the correct details.

### UI Wiring — Stage 4: high-yield-savings.html + documents.html (2026-09-03)

Two more real pages move off `engine-core.js`/`localStorage`: High Yield Savings (pockets,
Open a New Pocket, Withdraw, My Pocket Requests) and Documents & Reporting (both document
lists, Upload, Sign, Remove, notification chips). Reused `supabase-data.js`'s canonical
pattern — no further extension needed for the read/skeleton side, but Documents' own write
actions needed a genuinely new addition (see below), since Documents is architecturally
different from every prior write-action stage.

**Investigated first, per instruction: does the live rate/interest preview call the real
`hys-engine.ts` shared module or stay client-side?** Answer: stays client-side, reusing
`engine-core.js`'s own already-loaded, already-pure `getHYSRate()`/`computeFDFields()`/
`computeHYSWithdrawalAmount()` directly — `hys-engine.ts` runs in Deno and is unreachable from
the browser except by invoking a real Edge Function per keystroke, which would be pointless
for a rate schedule that's pure, deterministic, and non-secret. `engine-core.js` stays loaded
on this page regardless (the shared sidebar/notification bell depend on it), and neither
function touches `localStorage`, so calling them is genuine reuse, not a new duplicate. The
real, authoritative computation for an actual submitted request still happens server-side in
`request-hys-deposit`/`request-hys-withdrawal` via that same `hys-engine.ts` module, so the
preview and the real outcome can never drift apart — the same discipline Backend Requirements
Register row 34 already established locally.

**A real architecture gap found and disclosed, not silently patched**: `high-yield-savings.html`'s
own local-only `updatePocketStatuses()` (client-side 'active'→'matured' auto-transition once a
fixed pocket's maturity date passes) was removed rather than ported — investigated and
confirmed there is nowhere valid to persist this under real RLS (`hys_pockets` grants clients
`SELECT` only, no `UPDATE` policy at all, and no Edge Function performs this transition either).
A display-only client-side "effective status" was considered and rejected — it would make the
card's badge and the Withdraw modal's warning/lockout decision inconsistent with what
`request-hys-withdrawal` will actually do server-side (which keys off the real stored `status`),
exactly the "confusing UI... controls that would fail" anti-pattern this stage's own task
explicitly warned against, just in the opposite direction. The page now uniformly trusts the
real stored `status` for both the card badge and the Withdraw flow, guaranteeing the preview
always matches the server's real computation. **The real, disclosed consequence**: since
nothing server-side ever transitions a pocket's status once its real `maturity_date` elapses, a
genuinely-matured pocket whose stored status is still `'active'` will keep being treated as
pre-maturity (forfeiting interest early, or blocking a locked pocket's withdrawal outright)
until a future stage adds a real maturity-transition mechanism — inherited from Phase B Stage
4's own schema design (its own migration comment already flagged the local version of this
gap), not introduced here. A pocket whose real stored status IS `'matured'` already renders and
withdraws correctly today, verified directly.

**Documents — architecturally different from every prior write-action stage**: Stage 6's real
design gives a client direct, RLS-authorized INSERT/UPDATE/DELETE for their own Upload/Sign/
Remove — no Edge Function gates these three actions, unlike every Approval Gate queue wired so
far. This needed a genuine `supabase-data.js` extension: `insertRow()`/`updateRow()`/
`deleteRow()`, plus `classifyPostgrestError()` to map real Postgres/PostgREST error codes into
the same `.kind` scheme `writeErrorMessage()` already understands (a rejected direct table
write has no `.context` Response to read a custom JSON message from, unlike a rejected Edge
Function call). The static `#from-empty`/`#upload-empty` placeholders were rebuilt to always be
freshly regenerated by `renderDocumentLists()` on every call — the same static-child-vs-skeleton
conflict UI Wiring Stage 3 already found and fixed once for `transactions.html`'s ledger table.

**Two real bugs caught by this stage's own verification, fixed before shipping, not silently
patched around**:
1. The Upload action's real INSERT never included `client_id` in its payload — unlike every
   prior write action (an Edge Function derives `clientId` server-side from the JWT), a direct
   client INSERT has no such step; the row's own `client_id` column must be supplied by the
   client for the table's `with check (auth.uid() = client_id ...)` policy to ever evaluate
   true. Confirmed via a real failing insert first (RLS rejected it, `client_id` was implicitly
   `NULL`) before adding `getAuthenticatedClientId()` to the payload.
2. `deleteRow()`'s own first draft could silently "succeed" when RLS's `using` clause filtered
   out every row — unlike an INSERT/UPDATE's `with check` (which genuinely throws when a row is
   rejected), a DELETE's policy fails silently: a row that doesn't qualify is just not matched,
   not an error. Confirmed directly: a client attempting to delete a document RLS scopes them
   out of (e.g. a "from Marketswave" document) got back a plain success with zero rows
   affected — meaning the original code would have shown a genuine "Document Removed" toast for
   a document that was never actually removed. Fixed by chaining `.select()` after `.delete()`
   and treating a genuinely empty result as a real, thrown rejection.

A third, real, disclosed finding (not a bug, a genuine architectural incompatibility):
Download's local-engine behavior cleared a document's `isNew` flag as a side effect
(`updateDocument(dId, { isNew: false })`, with no RLS-equivalent restriction locally). Under
Stage 6's real schema, the ONE client UPDATE policy on `documents` is scoped exclusively to the
Sign transition (`USING` requires `status='Signature Required'`, `WITH CHECK` requires the
result be `status='Signed'`) — there is structurally no client write path that clears `isNew`
on its own, for ANY `from` document, confirmed by direct testing (100% of the time, not an edge
case). The write attempt was removed entirely rather than kept as code that can never succeed;
the real, disclosed consequence is that a "from" document's New badge now only ever clears via
Sign, never via Download — the download simulation itself (no real file bytes exist anywhere in
this project) is completely unaffected.

**Verified**: `npm run verify-hys-documents-ui-wiring` (from `scripts/`) — **68/68 assertions
passed, twice in direct succession**. **★ No browser automation tool is available in this
session — checked again, not assumed carried over from Stage 3.** Reused the established
`jsdom`-based real-DOM harness; `engine-core.js` was loaded into the HYS test's own DOM first
(the one page this stage's design deliberately keeps depending on it for the pure rate/
forfeiture preview functions), and `#sidebar-doc-badge`/`getAuthenticatedClientId()` were
stubbed for `documents.html`'s own earlier-script-block dependencies, mirroring Stage 3's
precedent. Covers, against real seeded Postgres data: 4 real pockets spanning every render/
withdraw branch (an active short-term Fixed, a genuinely `matured` short-term Fixed seeded
directly, an active locked Fixed, and an AYW pocket); the locked-pocket-no-withdraw-control
rule confirmed genuinely absent from the rendered DOM, not just server-blocked; a real
forfeiture-warning withdrawal round trip (principal-only receive amount, `forfeit=true`); a
real matured/no-warning withdrawal round trip (`forfeit=false`, principal+interest); a real
server-side rejection via the actual UI (submitting a second withdrawal request on a pocket
that already has one pending — a rule the client UI has no awareness of at all, unlike the
locked-before-maturity case, which is hidden by design); two real successful "Open a New
Pocket" round trips (Fixed/crypto with a server-computed rate matching the real schedule,
AYW/bank); a real server-side rejection called directly (a sub-$5,000 Fixed deposit, proving
defense in depth beyond the client's own pre-check, which already blocks this path through the
real UI); real document rendering (Sign button only where genuinely signature-required, Remove
button only on real uploads); the "from Marketswave" no-Remove-option rule confirmed genuinely
absent from the DOM; real notification counts computed from the real fetched list, including
the sidebar badge's live correction; a real Sign round trip confirmed against all three fields
the RLS policy's `WITH CHECK` requires; the Download finding confirmed both ways (the toast
still fires, and a direct is_new-only update against the same real row is genuinely rejected);
a real Upload round trip with the new row's real flash confirmed; a real Remove round trip
confirmed gone from Postgres; and two real security-boundary tests — a direct DELETE against a
"from" document genuinely rejected (structurally impossible now, not just unreachable via the
shipped UI), and a direct INSERT with `direction='from'` (impersonating the firm) genuinely
rejected. The full existing Supabase suite was re-run alongside with zero regressions:
`verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
`verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js` 88/88,
`verify-supabase-hys.js` 103/103, `verify-supabase-final-approval-gate.js` 69/69,
`verify-supabase-documents-support.js` 64/64, `verify-dashboard-ui-wiring.mjs` 27/27,
`verify-asset-pages-ui-wiring.mjs` 36/36, `verify-funding-transactions-ui-wiring.mjs` 54/54
(641 total, unaffected), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**★ A real visual/browser check is worth doing manually** — suggested walkthrough: log in as a
real test client, visit `high-yield-savings.html`, open a new Fixed Deposit pocket (watch the
live rate/maturity/interest preview update as you change the term) and a new As You Want
pocket, confirm both appear in "My Pocket Requests" as pending; once any pocket exists (e.g.
after an admin credits one of these, or against existing seeded data), try Withdraw on a
still-active locked pocket and confirm there is genuinely no Withdraw button at all, then try
Withdraw on an active short-term pocket and confirm the forfeiture warning appears before you
can continue. Then visit `documents.html` and confirm: the loading skeleton appears before real
content, the 3 header chips show real counts (never a stale "2"/"1"/"1"), a real file upload
appears and flashes, signing a signature-required document clears its badge and updates the
sidebar's own document count, removing an uploaded document works, and no "From Marketswave"
document ever shows a Remove button.

### UI Wiring — Stage 5: risk-management.html + settings.html + support.html (2026-09-03)

**This closes out ALL client-facing pages** — every one of the 10 pages behind the locked
sidebar now genuinely calls real Supabase wherever real backend support exists. Reused
`supabase-data.js`'s canonical pattern throughout, no further extension needed.

**Investigated first, per instruction, for each page, before wiring anything** — full findings:

- **risk-management.html**: no real Supabase table/column exists for a CLIENT's own risk
  profile anywhere in Phase B's six stages (the only real schema mention of "risk" anywhere is
  `products.risk_tier`, a per-PRODUCT classification for the portfolio engine's own return
  simulation — an entirely different concept). The Risk Meter (preview/save
  conservative/balanced/aggressive) stays 100% local, unchanged. The Diversification Score,
  however, turned out to **not actually be derived from real holdings at all** — it was a
  static "78/100" block hardcoded to match CLIENT-0001's own specific historical seed data,
  with the delta-preview math comparing against a hardcoded reference mix that only
  coincidentally equalled the real seed. Wired for real: reused dashboard.html's own
  established asset-class-grouping pattern (holdings × real current unit price, grouped by
  `products.asset_class`, plus Unallocated/Cash from `account_state`) to compute a genuine
  per-client HHI-based score, replacing both the static block and the hardcoded reference.
- **settings.html**: Email/Phone **do not live on `client_profiles`** as the task assumed — a
  real correction, confirmed by reading Phase B Stage 5's migration directly — they're real
  columns on `clients` (Phase B Stage 1). Display can genuinely go real (a plain SELECT);
  inline edit structurally cannot, since `clients` has no UPDATE policy for `authenticated` at
  all and no Edge Function updates it either. The Edit/Save UI stays, but Save now shows a
  real, honest "not available yet" disclosure instead of the old fake-success-then-silently-
  reverts-on-reload behavior a naive real-display wiring would have produced. Legal Name/
  Address/ID Document were already correctly modeled 1:1 by `client_profiles`/
  `profile_change_requests` — a straightforward wire. Password Change had **no backend of any
  kind** before this (not even fake-persisted) — wired to real
  `supabase.auth.updateUser({password})`, plus a real current-password re-check via
  `signInWithPassword()` first (Supabase's own `updateUser()` API has no "current password"
  parameter of its own, so a naive wire would have left that field purely decorative — the
  full, responsible version was chosen instead, per the task's own explicit invitation to make
  this call). 2FA and Notification Preferences: confirmed no real Supabase table exists for
  either — stay 100% local. Active Sessions: a **real, separate bug found during
  investigation** — it still imported the retired Firebase SDK, so its "signed in at"
  enhancement has been silently dead for every real Supabase-authenticated client since
  Firebase Retirement; fixed to try the real Supabase session first, Firebase as a fallback
  (mirroring `dashboard-sidebar.js`'s own real Logout handler, which already runs both real
  `signOut()` calls unconditionally for the identical "don't assume which backend
  authenticated this session" reason).
- **support.html**: ticket list, filing a dispute, and My Requests wire cleanly to
  `support_requests` + `request-support-ticket` (a direct RLS-authorized read for the list, no
  Edge Function needed there — creation is Edge-Function-only, since `display_id` must be
  genuinely server-computed). Quick-contact (Call/Chat/Email) stays pure UI, exactly as
  instructed. The Callback modal's phone default now reads the same real `clients.phone`
  column settings.html displays, for consistency, replacing its own local-storage read.

**Verified**: `npm run verify-settings-risk-support-ui-wiring` (from `scripts/`) — **33/33
assertions passed, twice in direct succession**. **★ No browser automation tool is available
in this session — checked again, not assumed carried over from Stage 4.** Reused the
established `jsdom`-based real-DOM harness; `engine-core.js`'s `getAuthenticatedClientId()`/
`getClient()`/`clientScopedKey()`/`getClientSecurityState()` and `format-helpers.js`'s
`formatFieldDisplay()` were stubbed/loaded as needed for each page's own remaining local-only
sections, mirroring prior stages' precedent for earlier-script-block dependencies. Covers,
against real seeded Postgres data: a real Diversification Score independently computed from a
deliberately non-balanced real holdings mix, confirmed to match the page's own rendered
score/label/top-concentration exactly and confirmed genuinely different from the old hardcoded
"78/100"; the Risk Meter's own delta line correctly waiting on and then using the real score;
real Email/Phone display from `clients`, with a real attempted edit confirmed to show the
honest disclosure AND confirmed via a direct Postgres read that nothing was actually changed;
a real Legal Name value (seeded directly) rendering correctly via the real `client_profiles`
read; a real Address change request round trip, including the server's own automatic
current-value snapshot (`null` — nothing on file yet) and a real 409 rejection of a genuine
duplicate-pending attempt; a real password-change round trip proving BOTH directions — a
genuinely wrong current password rejected via a real `signInWithPassword` re-check, and a
correct one succeeding, confirmed not just by the toast but by a fresh real sign-in with the
new password actually succeeding afterward; the real "signed in [time]" Active Sessions
enhancement confirmed resolving via the real Supabase session; two real dispute submissions
confirmed with real sequential per-client `display_id`s (DISP-0001/DISP-0002) and correct
newest-first ordering; a real direct server-side rejection of an invalid category; and the
Callback modal's real phone default. The full existing Supabase suite was re-run alongside
with zero regressions: `verify-supabase-schema.js` 16/16,
`verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js` 76/76,
`verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 112/112,
`verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js` 64/64,
`verify-dashboard-ui-wiring.mjs` 27/27, `verify-asset-pages-ui-wiring.mjs` 36/36,
`verify-funding-transactions-ui-wiring.mjs` 54/54, `verify-hys-documents-ui-wiring.mjs` 68/68
(683 total, unaffected), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**★ A real visual/browser check is worth doing manually** — suggested walkthrough: log in as a
real test client, visit `risk-management.html` and confirm the Diversification Score reflects
your own real holdings (not a fixed "78/100"), then visit `settings.html` and confirm: your
real email/phone display correctly, trying to edit either shows the honest "not available yet"
message, submitting a real Address or ID Document change request works and shows a Pending
Review badge, changing your password with the wrong current password is rejected and with the
correct one genuinely works (try logging out and back in with the new password), and Active
Sessions shows a real "signed in [time]" line rather than just "Active now." Finally visit
`support.html` and confirm: My Requests starts empty for a fresh client, filing a real dispute
gets a real DISP-0001-style id and appears immediately, and the Callback modal's phone field is
pre-filled with your real phone number.

### Admin UI Wiring — Stage 1: the five Approval Gate admin queue pages (2026-09-03)

The first ADMIN-side UI Wiring stage. Every UI Wiring stage before this one (Stages 1-5 above)
wired a client-facing page; `admin-deposits.html`, `admin-withdrawals.html`,
`admin-allocations.html`, `admin-sells.html`, and `admin-hys.html` are the first admin pages to
genuinely call real Supabase Edge Functions/tables instead of `engine-core.js`/localStorage.
LOCAL STACK ONLY — the real cloud "Marketswave Staging" project is untouched.

**The architectural question this stage had to answer first**: the caller on an admin page is
an admin session, not a client session — does `supabase-data.js`'s existing pattern already
handle that, or does it need an extension? `admin-supabase-config.js` (Supabase Migration
Stage 3) was built explicitly real-cloud-only, with its own header stating there was "no
meaningful local admin UI version of this to branch to" — true at the time, since its only
caller only ever needed the real deployed Edge Functions. That's no longer true once these
five pages needed the LOCAL stack's own functions, so that file was extended (not forked) with
a local branch mirroring `admin-firebase-config.js`'s own historical emulator-vs-staging
split: `?env=staging` still reaches real "Marketswave Staging" exactly as before (unchanged,
still prompt-based); its absence — what these five pages use by default — auto-signs in with
the known local bootstrap PM credential (`pm@marketswave.local`), no prompt. The actual
extension to `supabase-data.js` itself is one new function, `MarketswaveData.useAdminClient()`
— every other function in that file already funnels through one lazily-created
`clientPromise`, so redirecting that to an admin-authenticated session was the entire change;
zero other functions needed touching. Each of the five pages' own inline script calls this
once, as its own first statement.

**RLS was confirmed, not assumed, to already permit cross-client admin reads** — all 6
relevant tables (`deposit_requests`, `withdrawal_requests`, `allocation_requests`,
`sell_requests`, `hys_deposit_requests`, `hys_withdrawal_requests`) already grant
`using (auth.uid() = client_id or public.is_admin())` on SELECT, confirmed by reading each
migration directly. Every real Edge Function's exact request shape was also confirmed by
reading its deployed source, not assumed from memory: `credit-deposit`/`credit-hys-deposit`
and `approve-withdrawal` take a PM-editable amount (`confirmedAmount`/`approvedAmount`) that
may differ from what the client originally requested; `approve-allocation`/`approve-sell`/
`approve-hys-withdrawal` take `{requestId}` only and execute exactly as requested — the first
two forward the caller's own JWT into a real internal call to the already-deployed
`execute-buy`/`execute-sell`, never duplicating that logic.

`admin-sells.html`'s Realized Return column previously read `getTransactionForClient(clientId,
txnId)` (a per-client-scoped localStorage lookup) — it now reads a real `transactions` row
directly (the same self-or-admin RLS every other table in this schema already grants), fetched
cross-client alongside the sell requests themselves and joined by `transaction_id`.

**Verified**: `npm run verify-admin-approval-gate-ui-wiring` (from `scripts/`) — **102/102
assertions passed, twice in direct succession**. **★ No browser automation tool is available
in this session — checked again, not assumed carried over from Stage 5.** Reused the
established `jsdom`-based real-DOM harness (verbatim `<body>`/`<script>` extraction,
`window.eval()`). For each of the five domains the script covers: a real successful
approve/credit round trip (confirming, where applicable, that the PM's own edited input value
is what gets sent — verified with a real $2000→$1950 deposit edit and a real $700→$650
withdrawal edit, both checked against the raw stored row afterward, not just the toast); a
real successful reject round trip; and — the check that matters most for this stage — a
genuine re-validation-at-approval-time test driven through the ACTUAL admin UI (real button
clicks, never a direct function call). For Withdrawals/Allocations/Sells/HYS-Withdrawals this
is a real two-competing-requests test: two individually-valid pending requests against the
same finite resource (unallocated capital, held units, or the same HYS pocket) — approving the
first via a real click succeeds, approving the second via a second real click is genuinely
refused with the real server-computed 409 message, the second request stays pending, and the
contested resource is confirmed unchanged. Deposits and HYS Deposits don't contest a shared
resource the same way (crediting adds money rather than drawing down a pool), so their own
real-world race is a double-resolve test instead: open the Credit modal, resolve the SAME
request via a separate direct write (standing in for a second PM/tab), then submit via the
real UI and confirm the same 409 "not pending" guard fires, modal staying open. Cross-client
rendering was confirmed on every page — two real, independently-seeded clients both render
correctly side by side, not just one. The Allocations/Sells approve tests additionally
confirmed the real internal `execute-buy`/`execute-sell` calls genuinely ran (a real holding
created, real units debited, a real unallocated-capital change) rather than a status-only
stub.

**One real bug was caught in this new test script itself, not the app, during its own first
run — disclosed, not silently patched**: an early HYS-domain assertion hardcoded an expected
`unallocated_capital` figure left over from the Withdrawals domain's own end state, without
accounting for the Allocations domain resetting/debiting it further and the Sells domain's own
real cost-basis credit moving it again later in the same script run (both correct, real app
behavior) — fixed by capturing the balance immediately before the HYS withdrawal approval and
asserting it's unchanged afterward, instead of a stale cross-domain hardcoded number.

The full existing Supabase suite was re-run alongside with zero regressions:
`verify-supabase-schema.js` 16/16, `verify-supabase-portfolio-engine.js` 40/40,
`verify-supabase-deposits-withdrawals.js` 76/76, `verify-supabase-allocations-sells.js` 88/88,
`verify-supabase-hys.js` 112/112, `verify-supabase-final-approval-gate.js` 69/69,
`verify-supabase-documents-support.js` 64/64, `verify-dashboard-ui-wiring.mjs` 27/27,
`verify-asset-pages-ui-wiring.mjs` 36/36, `verify-funding-transactions-ui-wiring.mjs` 54/54,
`verify-hys-documents-ui-wiring.mjs` 68/68, `verify-settings-risk-support-ui-wiring.mjs` 33/33
(683 total, unaffected), and `supabase-golden-path-regression.js` `PASS (16/16 steps)`.

**★ A real visual/browser check is worth doing manually across all five pages** — suggested
walkthrough (sign in through `admin-login.html` first, same passphrase gate as always):

1. **admin-deposits.html**: as a real client, submit a deposit request (`deploy-capital.html`)
   for two different real test clients. Confirm both appear in Pending here with their correct
   real client names — not just one. Click Credit on one, confirm the modal pre-fills the
   requested amount, edit it to a different figure, submit, and confirm the toast/history shows
   the edited amount, not the original request. Reject the other with a reason and confirm it
   appears correctly in History.
2. **admin-withdrawals.html**: submit two withdrawal requests as the same real client that
   together exceed their unallocated capital. Approve the first (optionally editing the
   approved amount). Then try to approve the second — confirm a real error appears in the
   modal itself (not a silent failure) referencing the real remaining balance, and the modal
   stays open rather than closing.
3. **admin-allocations.html**: submit two allocation requests (via `asset-collection.html`)
   that together exceed a client's unallocated capital. Approve the first — confirm the toast
   references a real transaction id, and check `asset-performance.html`'s Return Table
   afterward to confirm a real holding now exists. Approve the second and confirm it's
   genuinely refused with a real "only $X unallocated capital remains" message.
4. **admin-sells.html**: submit two sell requests (via `asset-performance.html`) against the
   same holding that together exceed the units held. Approve the first, confirm a real
   Realized Return figure now shows in History for it (not a dash). Approve the second and
   confirm it's refused, referencing the real remaining unit count.
5. **admin-hys.html**: submit an HYS pocket-funding request (`high-yield-savings.html`) and
   credit it at a different confirmed amount than requested — confirm the created pocket shows
   the confirmed figure. Separately, submit two withdrawal requests against the same pocket;
   approve the first (confirm the pocket shows withdrawn and Unallocated Capital on
   `dashboard.html` is unaffected — HYS is its own pool), then confirm the second is refused
   with a real "already been withdrawn" message.

### Admin UI Wiring — Final Stage: the remaining admin pages (2026-09-03)

Closes out the admin tool wiring effort entirely. Each of the 6 remaining admin pages was
investigated individually before wiring anything, per instruction — no page was wired just
because a similar-sounding domain had already been built elsewhere.

**Wired:**
- **`admin-profile-updates.html`** — the one Approval Gate queue Admin UI Wiring Stage 1
  (above) genuinely missed. Real backend already existed (Phase B Stage 5:
  `client_profiles`/`profile_change_requests`/`request-profile-change`/
  `approve-profile-change`/`reject-profile-change`), and `settings.html`'s own client-side
  half was already wired to it — this closes the missing admin half of that same real domain.
  Reused Stage 1's exact `useAdminClient()` + cross-client `selectTable()`-joined-against-
  `clients` + real-Edge-Function-Approve/Reject pattern.
- **`admin.html`** — every Overview card with a real backend now reads it directly (all 7
  Approval Gate pending counts, Documents Awaiting Review, Support Needing Attention, Product
  Catalog count, Advisory Fee Rate), via direct RLS-authorized cross-client reads. Security
  Actions Logged stays local (see below), deliberately excluded from the all-clear check.
- **`admin-advisory-fee.html`** — closes a real "table exists, nothing writes to it" gap:
  Phase B Stage 1's own `advisory_fee_rate` singleton table had a real SELECT policy but no
  write path anywhere. A new, small, admin-only `update-advisory-fee-rate` Edge Function
  (mirrors the local `setAdvisoryFeeRate()`'s own validation byte-for-byte) closes it.
- **`admin-clients.html`** — REWIRED, real cleanup, not a straightforward wire. Found stuck
  on the pre-Retirement Firebase merge (built Aug 22, 2026) — Firebase was retired
  project-wide Aug 30, 2026, and this page was never updated afterward; it was still
  importing the retired `admin-firebase-config.js` and querying the retired emulator's
  Firestore `clients` collection, which no real signup path has written to since Supabase
  became the sole active backend. That whole `type="module"` Firebase block was removed
  outright and replaced with a real Supabase `clients` table merge (still combined with
  `getAllClients()` for the still-genuinely-local demo/admin-created clients, e.g.
  CLIENT-0001) — a "Supabase" badge replaces "Firebase." Real cross-client Total Portfolio
  Value for Supabase clients via the already-deployed `get-total-portfolio-value` function
  (admin can pass any `clientId`), pre-fetched in parallel on load. Real per-client pending
  Approval Gate count for Supabase clients, computed by querying the 7 real Approval Gate
  tables filtered by `client_id`/`status='pending'`, lazily on row-expand, cached per client.
  "View as this Client" — confirmed via project-wide grep to be the only remaining
  `getCurrentClientId()`/`setCurrentClientId()` caller anywhere in the admin tool — is shown
  only for local clients; a Supabase client gets an honest explanatory note instead of a
  button with no real identity-switch mechanism behind it.

**Confirmed no real backend, left correctly local — nothing faked:**
- **`admin-security.html`** — a project-wide grep of every migration and every
  `supabase/functions/` directory found no table/function resembling a security-actions log
  (mirrors `settings.html`'s own finding that 2FA has no real Supabase backend either).
- **`admin-products.html`** — the real `products` table (Phase B Stage 1) exists and is
  genuinely read by 4 already-wired pages (`dashboard.html`, `risk-management.html`,
  `asset-collection.html`, `asset-performance.html`), but carries only a SELECT policy — no
  write path for any role, no Edge Function, and no `description`/`logo_url`/
  `extended_description` columns the local schema has. Left the WHOLE page on the local
  engine (read AND write) rather than a partial wire, since a real-read/local-write split
  would have been actively misleading. **Flagged prominently**: since the 4 pages above were
  wired to the real table in earlier stages, this page's own Add/Edit actions against the
  local catalog have had ZERO effect on what any client actually sees since those stages
  shipped — it has been silently managing an orphaned catalog. Closing this needs its own
  scoped future task (a real migration for the missing columns, a real admin-only
  `add-product`/`edit-product` Edge Function pair, and a real UI wire).

**Verified**: `npm run verify-admin-final-wiring` (from `scripts/`) — **39/39 assertions
passed**, using the same `jsdom`-based real-DOM harness every prior UI-wiring stage
established. Covers: real Approve/Reject round trips for Client Profile Updates (including a
genuine `client_profiles` write, not just a status flip, and confirming a rejection performs
NO profile write); a real successful Advisory Fee Rate update AND a real server-rejected
invalid-rate attempt (rate provably unchanged); every one of `admin.html`'s 10 real
pending-count cards cross-checked against an independently-computed live DB query (not
derived from the page's own rendering logic); the real Supabase client merge, a real
cross-client Total Portfolio Value read, a real lazily-fetched per-client pending count
matched against an independent 7-table sum, and confirmation "View as this Client" is
genuinely absent for a Supabase-sourced client. The full existing Supabase suite was re-run
alongside with zero regressions (824 prior assertions unaffected, plus
`supabase-golden-path-regression.js` `PASS (16/16 steps)`).

**★ A real visual/browser check is worth doing manually** — sign in through
`admin-login.html`, then: open `admin-profile-updates.html` and confirm a real
`settings.html`-submitted Legal Name/Address/ID Document change appears and can be
approved/rejected for real; open `admin.html` and confirm every card shows a real number, not
a dash; open `admin-advisory-fee.html`, save a new rate, and confirm `admin.html`'s own
Advisory Fee card and `transactions.html`'s own card pick it up; open `admin-clients.html`
and confirm real Supabase-signed-up clients render with a "Supabase" badge, a real Total
Portfolio Value, and (on expand) a real pending-count figure that matches what the Approval
Gate pages themselves show for that client.

### Real Supabase Storage integration for Documents (2026-09-04)

Replaces the metadata-only Documents stub (a row with just a client-typed filename, no real
bytes anywhere) with genuine file upload/download — the fix for the originally reported bug
(the Download button doing nothing for PM-uploaded files). Local stack only, real cloud
"Marketswave Staging" untouched.

- A new private `documents` Storage bucket, real `storage.objects` RLS policies (a client can
  upload/read/delete only their own `<clientId>/uploads/...` files; a PM/admin-claimed session
  can read across every client; only `service_role`, inside `publish-document`, can write into
  a client's `<clientId>/published/...` folder).
- `documents.storage_path` (nullable, for real backward compatibility with any pre-existing
  row that has no file behind it).
- `documents.html`'s Upload now uploads real bytes directly before inserting the row (a
  missing file selection is now a real validation error); Download fetches a real, 60-second
  signed URL and opens it; Remove now also best-effort deletes the real underlying file.
- `admin-documents.html`'s Publish now sends the real chosen file's bytes (base64-encoded) to
  the extended `publish-document` Edge Function; Download (Pending + History) fetches real
  signed URLs the same way.

**Verified**: `npm run verify-documents-storage-integration` (from `scripts/`) — **46/46
assertions passed** — a real bidirectional round trip with byte-for-byte content verification
in both directions, cross-client isolation tested directly at the Storage level (not just the
table level), real storage cleanup on Remove, and the honest "no file attached" state for a
null `storage_path`. The full existing Supabase suite was re-run alongside with zero
regressions.

**★ This one specifically needs an eyes-on check — it's the first feature moving real file
bytes through the system.** Manual repro steps:

1. Sign in as a real client (`login.html`, no `?legacyBackend=firebase`) and go to
   `documents.html`.
2. Under "Upload to Marketswave," choose a real file from your machine (any small PDF/image/
   text file works), pick a category, click **Upload Document**. Confirm the toast says
   "Document Uploaded" and the new row appears.
3. In a second browser/tab, sign in through `admin-login.html`, open `admin-documents.html`.
   Confirm your real upload appears under "Client Uploads Awaiting Review." Click its
   **Download** button — confirm the real file actually opens/downloads (not a no-op), and
   that it's genuinely the same file you chose in step 2 (open it and check).
4. Still in `admin-documents.html`, use "Publish to Client": pick the same client, a category,
   choose a real file, optionally check "Signature required," click **Publish Document**.
   Confirm the toast says "Document Published."
5. Back in the client tab, reload `documents.html`. Confirm the newly published document
   appears under "From Marketswave." Click its **Download** button — confirm the real file
   opens/downloads and is genuinely the same file the PM published in step 4.
6. Back on the client's own uploaded row from step 2, click **Remove**, confirm in the modal.
   Confirm the row disappears. (There's no user-visible way to confirm the underlying Storage
   object is also gone without opening Supabase Studio's Storage browser at
   `http://127.0.0.1:54323/project/default/storage/buckets/documents` and checking the
   client's own folder is now empty of that file — optional, for the curious.)
7. As a negative check: try Upload with no file chosen — confirm a real "Choose a file to
   upload first" toast, not a fake upload. Try Publish with no file chosen — confirm a real
   inline "Choose a file to publish" error, no request sent.

### ★ Pre-hosting fix: the real hosted default now reaches Supabase staging (2026-09-04)

**Read this before this project is ever deployed anywhere public.** Confirmed and fixed a
real, launch-blocking bug: the Aug 30, 2026 Firebase Retirement inversion made "no query
params" mean "reach the local Docker stack" — correct for a developer's own machine, but
wrong for a real hosted deployment, since a real visitor's browser will never carry
`?env=staging` (or any other query param) in the URL. A page served from a real public
domain with that old default would have silently tried to reach `http://127.0.0.1:54321` —
unreachable from anywhere but the machine that ran `supabase start` — and every real
signup/login would have simply failed, silently, with no obvious cause from the outside.

**The fix, in both `supabase-config.js` and `admin-supabase-config.js` (checked and fixed
independently, not assumed one covers the other)**: the default now depends on the page's
own `window.location.hostname`, not a query param —

- **`localhost` / `127.0.0.1`** (real local development — confirmed against this project's
  own actual workflow: `python -m http.server` serves it at `127.0.0.1:8765`) → **local
  Docker stack**, zero config needed. Nothing changes for any existing local-dev habit.
- **Any other hostname** (a real hosted deployment, by definition) → **real cloud "Marketswave
  Staging"**, zero config needed. This is the actual fix.
- `?env=staging` still works as an explicit override, from anywhere, including localhost —
  unchanged, since local development deliberately testing against real staging is an
  existing, relied-upon workflow (see "Staging Environment" above).
- `?dev=local` is new: an explicit opt-in to reach the local stack from a non-localhost host
  (e.g. testing local backend code from a preview deployment of the frontend). Not needed for
  normal local development — hostname detection already covers that automatically. If both
  `?dev=local` and `?env=staging` are somehow present together, `env=staging` wins.

The Firebase legacy escape hatch (`?legacyBackend=firebase`) is completely unaffected — out
of this fix's scope, unchanged.

**A project-wide grep for every other hardcoded `localhost`/`127.0.0.1` reference was run, per
instruction, to catch anything else that could break on a real hosted domain.** Everything
found:
- `scripts/*.js` / `scripts/*.mjs` (dev/test tooling only, never shipped or served to a real
  visitor) — every one either connects directly to the local stack by design, or (the local-
  stack scripts) carries its own explicit `readLocalStackCredentials()` guard that already
  *refuses* to run against anything but a `127.0.0.1`/`localhost` API URL. No fix needed —
  these are correctly local-only on purpose.
- `firebase-config.js` (and its own emulator connection calls) — also defaults to the
  emulator on zero params, the exact same bug class, but genuinely out of scope: Firebase is
  retired and reachable *only* via the explicit, unmistakable `?legacyBackend=firebase` flag,
  never the default path a real visitor would ever silently hit. Reported, not fixed.
- `supabase/config.toml`'s own `site_url` — local Supabase CLI config only, already
  confirmed (Supabase Migration Stage 3) to have zero functional effect on this app (no
  OAuth/redirect/OTP/MFA flow exists anywhere in this codebase).
- No `.html` file, and no other browser-loaded `.js` file (`dashboard-sidebar.js`,
  `admin-sidebar.js`, `engine-core.js`, `dashboard-notifications.js`, `format-helpers.js`,
  `supabase-data.js`), contains a hardcoded `localhost`/`127.0.0.1` reference anywhere.

**Verified**: `npm run verify-hosting-default-fix` (from `scripts/`, no local stack needed —
this check is about which target gets *selected*, not a real network call against either
one) — **18/18 assertions passed**, covering both files independently: a real hosted domain
with zero params genuinely constructs a client wired to the real staging URL; `localhost`/
`127.0.0.1` with zero params genuinely stays on the local stack; `?env=staging` still reaches
staging from localhost; the new `?dev=local` reaches the local stack from a hosted domain;
the `env=staging`-wins priority when both are present; and the Firebase escape hatch is
unaffected. The full existing Supabase suite was re-run alongside — **found and fixed 11
existing test files that broke** as a direct, real consequence of this fix (not a false
regression): every one of them constructs a bare fake `window` object
(`{ location: { search: '' } }`, with no `hostname` at all) to simulate a browser tab before
importing `supabase-data.js`, which — now that hostname is actually read — resolved to
`undefined`, matched neither `localhost` nor `127.0.0.1`, and silently made every affected
test run against **real cloud staging instead of the local stack**, breaking on missing
seed data/permissions. Fixed by adding `hostname: '127.0.0.1'` to each fake window (the
correct, more faithful simulation of what a real local dev browser tab always provides,
never previously needed because no code read it before now):
`verify-admin-final-wiring.mjs`, `verify-asset-pages-ui-wiring.mjs`,
`verify-admin-approval-gate-ui-wiring.mjs`, `verify-cross-role-sync-bugfix.mjs`,
`verify-dashboard-real-data-fixes.mjs`, `verify-dashboard-ui-wiring.mjs`,
`verify-documents-storage-integration.mjs`, `verify-funding-transactions-ui-wiring.mjs`,
`verify-hys-documents-ui-wiring.mjs`, `verify-products-catalog-fix.mjs`,
`verify-settings-risk-support-ui-wiring.mjs`. After that fix, the complete existing suite
passed with zero further regressions: `verify-supabase-schema.js` 16/16,
`verify-supabase-portfolio-engine.js` 40/40, `verify-supabase-deposits-withdrawals.js`
76/76, `verify-supabase-allocations-sells.js` 88/88, `verify-supabase-hys.js` 112/112,
`verify-supabase-final-approval-gate.js` 69/69, `verify-supabase-documents-support.js`
67/67, `verify-dashboard-ui-wiring.mjs` 27/27, `verify-asset-pages-ui-wiring.mjs` 36/36,
`verify-funding-transactions-ui-wiring.mjs` 54/54, `verify-hys-documents-ui-wiring.mjs`
69/69, `verify-cross-role-sync-bugfix.mjs` 34/34, `verify-settings-risk-support-ui-wiring.mjs`
33/33, `verify-admin-approval-gate-ui-wiring.mjs` 102/102, `verify-admin-final-wiring.mjs`
39/39, `verify-products-catalog-fix.mjs` 35/35, `verify-dashboard-real-data-fixes.mjs`
38/38, `verify-documents-storage-integration.mjs` 46/46, and
`supabase-golden-path-regression.js` `PASS (16/16 steps)`.

### Step 9 — Stop the stack when you're done

```
supabase stop
```

Leaves data intact (see Step 3) for next time. Use `supabase stop --no-backup` only if you
deliberately want a clean slate next start.

---

## Emulator Bootstrap Runbook

> **★ RETIRED, Aug 30, 2026.** Firebase is no longer the active backend — see the top of this
> document for the full "why." Everything below still works exactly as written, kept as
> historical/reference record, but is reachable only via `signup.html`/`login.html`'s explicit
> `?legacyBackend=firebase` flag now, not the default. The active runbook is the "Supabase
> Local Development Runbook" section above.

**Who this is for**: anyone (including a Claude Code session with zero memory of any prior
one) who needs to get `signup.html`/`login.html`/the admin tool's Firebase-backed pages
working locally, starting from a machine where nothing is running yet.

**Why this exists**: this project's emulator does not reliably persist its data across
restarts (see "Known limitation" below), and the emulator itself does not remember its own
one-time setup steps (the bootstrap PM account) between runs. Every fresh emulator session —
which in practice means every fresh work session that touches the admin tool or a real
signup/login flow — needs to repeat a short, fixed sequence. This document is that sequence,
written out in full rather than assumed as background knowledge.

### What you're bringing up

Three emulators, from the Firebase Local Emulator Suite, all pointed at a fake "demo"
project (`demo-marketswave` — see `.firebaserc`/`firebase-config.js`, never a real Firebase
project):

| Emulator | Port | What it stands in for |
|---|---|---|
| Auth | 9099 | Real Firebase Authentication (email/password accounts) |
| Firestore | 8080 | The `clients/{uid}` collection — one document per signed-up client |
| Functions | 5001 | `functions/index.js`'s three callables: `createClientApplication`, `approveClientApplication`, `rejectClientApplication` |

Nothing here ever reaches real Firebase. `demo-`-prefixed project IDs are a special
Emulator Suite convention that keeps everything fully offline — no `firebase login`, no
billing, no real Google Cloud project.

### Prerequisites (one-time, per machine)

1. **Node.js** — any reasonably recent version works for running the emulators and the
   scripts in this repo (this was last verified against Node 24; `functions/package.json`
   declares `"node": "20"` as its *deploy target*, which is a separate thing from what runs
   the emulator harness locally — you'll see a one-line warning about this mismatch on every
   `emulators:start`, and it is harmless).
2. **Java 21+** — required by the Firestore emulator specifically (Auth and Functions don't
   need it). Check with `java -version`. **On this machine, Java is installed but is NOT on
   the default `PATH`** — it lives at:
   ```
   C:\Program Files\Eclipse Adoptium\jre-21.0.12.101-hotspot\bin
   ```
   Every command below that runs `firebase emulators:start` needs this directory prepended to
   `PATH` first, or you'll get a `java: command not found`-style failure. In PowerShell:
   ```powershell
   $env:PATH = "C:\Program Files\Eclipse Adoptium\jre-21.0.12.101-hotspot\bin;" + $env:PATH
   ```
   In Git Bash:
   ```bash
   export PATH="/c/Program Files/Eclipse Adoptium/jre-21.0.12.101-hotspot/bin:$PATH"
   ```
   If Java genuinely isn't installed on a machine yet, install a JRE/JDK **21 or newer**
   (firebase-tools 15.x refuses anything older — Java 17 was tried once during this project's
   original setup and rejected for exactly this reason).
3. **The Firebase CLI** (`firebase --version` — this project was last verified against
   `15.28.1`) and **`functions/`'s own dependencies**:
   ```bash
   cd functions && npm install
   ```
4. **This repo's dev scripts' own dependencies** (`scripts/bootstrap-admin.js` and
   `scripts/golden-path-regression.js`, covered below):
   ```bash
   cd scripts && npm install
   ```

Steps 3 and 4 are one-time per machine (or whenever `functions/package.json` or
`scripts/package.json` change) — `node_modules/` is gitignored for both, so a fresh clone
always needs this.

### Step 1 — Start the emulators

From the project root, with Java on `PATH` (see above):

```bash
firebase emulators:start --only auth,firestore,functions
```

Leave this running in its own terminal/session — it's a long-lived foreground process (or
launch it detached if your environment needs that; how you background it is your call, the
important part is that it stays up for the rest of this runbook and for however long you're
actually working).

**What "known good" looks like**: within roughly 5–15 seconds you should see a box like this:

```
┌─────────────────────────────────────────────────────────────┐
│ ✔  All emulators ready! It is now safe to connect your app. │
└─────────────────────────────────────────────────────────────┘

┌────────────────┬────────────────┐
│ Emulator       │ Host:Port      │
├────────────────┼────────────────┤
│ Authentication │ 127.0.0.1:9099 │
├────────────────┼────────────────┤
│ Functions      │ 127.0.0.1:5001 │
├────────────────┼────────────────┤
│ Firestore      │ 127.0.0.1:8080 │
└────────────────┴────────────────┘
```

Just above that box you should also see, for each of the three callables:

```
+  functions[us-central1-createClientApplication]: http function initialized (...)
+  functions[us-central1-approveClientApplication]: http function initialized (...)
+  functions[us-central1-rejectClientApplication]: http function initialized (...)
```

If those three lines are missing but the "All emulators ready" box still appeared, the
Functions emulator came up but **failed to load your actual functions** — see
"Troubleshooting" below (this is the single most likely thing to go wrong).

### Step 2 — Bootstrap the admin/PM account

```bash
node scripts/bootstrap-admin.js
```

**Why this step exists, specifically**: the admin tool (`admin-login.html` → any
`admin-*.html` page) signs itself into Firebase behind the scenes as a single shared PM
account (`admin-firebase-config.js`'s `ensureAdminSignedIn()`), and
`functions/index.js`'s `approveClientApplication`/`rejectClientApplication` callables refuse
to run for anyone who isn't signed in as that account with a real `{ admin: true }` custom
claim. That account and claim don't exist anywhere until something creates them — a fresh
emulator starts with **zero** users, every time. This script is that "something."

It's **idempotent** — safe to run every single time you start a fresh emulator session,
whether or not the account already exists this session. It will:
- Create the account if it's missing, or find it if it already exists.
- Set (or re-confirm) the `{ admin: true }` custom claim either way.
- Fail loudly, with a message that says "PM bootstrap account not found... run
  `node scripts/bootstrap-admin.js` first," if the emulators aren't up yet — this exact
  message is also what the golden-path script (below) will show you if you skip this step.

**What "known good" looks like** — a fresh emulator session should print:

```
Bootstrapping admin/PM account against the emulator...
  Auth emulator:      127.0.0.1:9099
  Firestore emulator: 127.0.0.1:8080
  Project id:         demo-marketswave

Created new account:    <some uid> (pm@marketswave.internal)
Custom claim confirmed live: { admin: true }

Bootstrap complete. The admin tool (admin-login.html -> any admin-*.html page)
can now sign in as this account automatically via admin-firebase-config.js.
```

Running it again in the *same* emulator session (nothing restarted) should instead say
`Found existing account: ...` — that's the idempotency working correctly, not a failure.

### Step 3 — Confirm everything actually works: the golden-path regression script

```bash
node scripts/golden-path-regression.js
```

This is covered in its own section below — run it now as the final confirmation that Steps 1
and 2 actually left you with a working system, not just a system that *started* without
error.

### Known limitation: `--export-on-exit` does not currently persist data

You might reasonably expect to avoid repeating Steps 1–2 every session by exporting emulator
state on shutdown and importing it on the next start
(`firebase emulators:start --export-on-exit=./emulator-data --import=./emulator-data`,
`emulator-data/` already exists and is gitignored, ready to receive a real export). **This
does not currently work reliably in this environment.**

The root cause, re-confirmed directly during this task (not just carried forward from an old
note): the emulator process, once started via `firebase.cmd`/`firebase.js` on Windows, cannot
be stopped gracefully. `taskkill /PID <pid>` (no `/F`) — the non-forceful request — is
refused outright by Windows with *"This process can only be terminated forcefully (with /F
option)"*, and a prior session separately found that sending Ctrl+C-style `SIGINT` via Git
Bash doesn't reach the process in a way that triggers its graceful-shutdown export hook
either. Either way, the process only ever comes down via a forceful kill, which skips the
export entirely. This is a genuine Windows-process/signal-handling limitation, not a config
mistake in this project's `firebase.json`.

**Practical consequence**: treat every emulator restart as a wipe. There is no "restore
yesterday's test data" step — just re-run Steps 1–2 above, and re-run
`golden-path-regression.js` if you want to repopulate a known-good state to click through
manually. If someone ever finds a genuinely reliable graceful-shutdown method on Windows for
this setup, this whole section (and the forced-restart assumption baked into
`bootstrap-admin.js`'s and `golden-path-regression.js`'s own comments) should be revisited —
flagged here so it isn't silently rediscovered as a surprise again.

### Troubleshooting

**`Failed to load function definition from source: ... Cannot determine backend
specification. Timeout after 10000.`** — the Functions emulator started, but never actually
loaded `functions/index.js` (you won't see the three `http function initialized` lines from
Step 1). This showed up once during this runbook's own verification and **resolved itself on
a plain restart** (stop the emulator, run Step 1 again) — the second attempt loaded correctly
within about 2 seconds. Likely cause: something (antivirus, first-touch disk scan of
`functions/node_modules`) slowing down the very first module load past the discovery
mechanism's fixed 10-second budget. If it happens twice in a row, then it's worth actually
investigating rather than just retrying a third time.

**`Port 8080 (or 9099 / 5001 / 4400) is not open... could not start`** — something is still
listening on an emulator port from a previous, not-fully-stopped run (very easy to end up
with, given the graceful-shutdown limitation above — a forceful kill of the parent
`firebase` process doesn't always take its child `java`/`node` processes down with it). Find
and stop the stray process, then retry:
```powershell
Get-NetTCPConnection -LocalPort 8080,9099,5001,4400 -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess
Stop-Process -Id <OwningProcess from above> -Force
```
Be careful with broad process-name kills (e.g. "kill everything named `node`") on a real
workstation — other, unrelated Node-based applications may be running. Match on the specific
PID holding the port, not the process name.

**`It seems that you are running multiple instances of the emulator suite for project
demo-marketswave`** — same root cause as above (a stray hub process from a prior
not-fully-stopped run). Same fix.

**The first callable call is slow (10–25+ seconds), later ones are fast** — this is normal
Functions-emulator cold start on the very first real invocation of a session, not a hang.
`golden-path-regression.js`'s own step timings will show this plainly (its first Functions
call routinely took ~25 seconds during this runbook's own verification; every call after that
was well under a second).

---

## Golden-Path Regression Script

> **★ RETIRED, Aug 30, 2026.** This is the FIREBASE golden-path script — no longer the active
> one. Still fully functional against the retired emulator path, kept as historical/reference
> record. The active regression check is `scripts/supabase-golden-path-regression.js` (see
> "Supabase Local Development Runbook" → Step 8 above).

`scripts/golden-path-regression.js` walks the **entire real chain**, end to end, against a
live emulator, and prints one unambiguous `GOLDEN PATH: PASS` or `GOLDEN PATH: FAIL` at the
end (exit code 0 or 1 to match — safe to wire into any future CI-style check). This is the
one command to run after any gap in work, any dependency bump, or any change to
`functions/index.js`/`firestore.rules`/the relevant parts of `engine-core.js`, to confirm
"everything still works" without manually re-clicking through the app.

### What it actually exercises

Two different kinds of real code, back to back, in the order a real user's session would
actually produce them:

1. **The Firebase half** — real `firebase` client SDK calls against the real running
   emulator: `createUserWithEmailAndPassword`, the `createClientApplication` /
   `approveClientApplication` callables, `signInWithEmailAndPassword`. This is a genuine
   exercise of `functions/index.js` and `firestore.rules` — not a mock, not a re-implemented
   stand-in for what they do.
2. **The local half** — the real `engine-core.js` source, loaded into a Node `vm` sandbox
   (see `scripts/lib/engine-harness.js`) with a `localStorage`/`sessionStorage` polyfill, the
   same functions `dashboard-sidebar.js`/`deploy-capital.html`/`asset-collection.html`/the
   admin tool actually call, called in the same order, with a fresh "reload" (a fresh `vm`
   context, same underlying storage) everywhere a real page navigation would happen. This
   matters: `engine-core.js` loads every store into memory once per page load and only
   re-reads storage on the next navigation (see `engine-harness.js`'s own header comment for
   the full "why," and CLAUDE.md's §4.44/§4.45 history for the real production bug this
   exact ordering assumption once caused when it was gotten wrong).

### The steps, in order

1. **Preflight** — confirms the emulators are reachable and the PM bootstrap account
   (Step 2 above) exists with its claim live. Fails fast with an actionable message
   (pointing at `bootstrap-admin.js`) rather than a confusing downstream error if not.
2. **Signup** — creates a real Firebase Auth account + Firestore application document via
   the real `createClientApplication` callable, then mirrors what `signup.html` itself does
   locally (`saveClientOnboardingData()`, `seedMinimalClientStores(uid, 0)`).
3. **Pending status** — confirms the Firestore document really is `pending_review`, *and*
   proves login is genuinely refused at this stage even with fully correct credentials (not
   just that the status field looks right in isolation).
4. **Admin approve** — signs in as the real bootstrap PM account and calls the real
   `approveClientApplication` callable; confirms the document flips to `active`.
5. **Login succeeds** — a real `signInWithEmailAndPassword` as the now-approved client, then
   the exact local bridge `login.html` itself runs
   (`mirrorAuthenticatedClientLocally()` + `setClientAuthenticated()`).
6. **Dashboard loads** — mirrors `dashboard-sidebar.js`'s own file-load-time client pin, then
   confirms a clean, genuinely-empty portfolio reads back correctly (Total Portfolio Value
   $0, empty transaction ledger) — proof the new client isn't silently inheriting anyone
   else's data.
7. **Deploy Capital** — a real `requestDeposit()`, a real admin-side
   `creditDepositRequest()`, then confirms the resulting `DEPOSIT` transaction and
   `unallocatedCapital` are both correct.
8. **Allocation** — a real `requestAllocation()` against whichever seeded product fits the
   test amount, a real admin-side `approveAllocationRequest()`, then confirms the `BUY`
   transaction and the new holding both appear and that Total Portfolio Value is conserved
   through the trade (within a cent, for rounding).

### Reading the output

Each step prints `PASS`/`FAIL` with its timing as it runs, and a full summary table plus one
final line at the end:

```
================================================================
GOLDEN PATH: PASS (16/16 steps)
```

or, if something's actually broken:

```
================================================================
GOLDEN PATH: FAIL (11/16 steps passed, 5 failed)
```

with exit code 1. The script stops at the *first* failing step (this is a sequential chain —
step 6 depends on step 4 having actually happened, so there's no value in continuing past a
break), and prints that step's real error message inline, not just a generic "something
failed."

Each run uses a freshly-generated test email
(`golden-path-<timestamp>@test.marketswave.internal`), so it's safe to run repeatedly against
the same emulator session without collisions. The test account it creates is left behind in
the emulator afterward — cleaned up automatically the moment the emulator is next restarted
(see the `--export-on-exit` limitation above), not something you need to manually tear down.

### Last verified

This entire runbook — Steps 1 through 3, including the "Cannot determine backend
specification" retry and the graceful-shutdown limitation — was run for real, on this
machine, on 2026-08-26, ending in a clean `GOLDEN PATH: PASS (16/16 steps)`. If you hit
something this document doesn't cover, that's a sign this doc (or the scripts themselves)
need updating — please do, rather than working around it silently and leaving the next
session to rediscover the same thing.

---

## Staging Environment (Phase A1)

> **★ RETIRED, Aug 30, 2026.** This is the real, untouched "marketswave-staging" FIREBASE
> project — no longer the active backend. Everything below still works exactly as written
> (the real project is still there, untouched), kept as historical/reference record, reachable
> only via `?legacyBackend=firebase&env=staging` now. The active real cloud project is
> Supabase's "Marketswave Staging" (`ujnmlwbpginplfnofhhv`) — see "Supabase Local Development
> Runbook" → Stage 3 above. Two DIFFERENT real cloud projects share a similar name, on two
> different platforms — do not confuse them.

**Which Firebase environment am I looking at?** Before touching anything below, know that
"staging" here means a REAL, separate Firebase project (`marketswave-staging`) — not the
emulator, and not "Marketswave SE" (the eventual real-production project named throughout
CLAUDE.md/the handover doc, still completely untouched). Real signups on staging create real
Firebase Auth users and real Firestore documents, visible in the real Firebase Console. There
is no test/prod separation *within* staging — treat every account you create there as real,
even though it's not the production project.

**Scope, deliberately narrow (Phase A1, a SUBSET of the original Phase A)**: real Firebase
Auth + Firestore identity against staging, with **no Cloud Functions deployed** — that's
Phase A2, a separate, currently BLOCKED task (see "What's blocked" below). Concretely, Phase
A1 covers: the environment switch, real Firestore security rules deployed to staging, real
signup/login against staging, a staging admin bootstrap script, and a temporary Admin-SDK
approval stand-in. It does NOT cover: a real admin UI approve/reject button (needs a deployed
callable), repointing `.firebaserc`'s `default` alias (still `demo-marketswave` — staging is
reached via an explicit `staging` alias, never the default), or anything in `firebase-config.js`
changing what a plain page load without `?env=staging` does.

### Credential handling — read this before running anything below

The staging Admin SDK credential (a service account key JSON file) is kept **outside this
repository entirely**, by deliberate instruction — same discipline the real-production
bootstrap script (§12.4 item 6 in the handover doc) has always required, now extended to
staging since it's a real cloud project too, just not the production one. Concretely:

- The key file is never copied into this repo, never referenced by a relative path anywhere
  in this codebase, and `.gitignore` doesn't need an entry for it — it's not inside the
  working tree at all, so git cannot see it regardless.
- Every script that needs it (`scripts/staging-bootstrap-admin.js`,
  `scripts/staging-approve-client.js`, and the `firebase deploy` command below) reads it
  exclusively from the standard `GOOGLE_APPLICATION_CREDENTIALS` environment variable, which
  YOU set, pointing at wherever you keep the key on your own machine:
  ```bash
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/marketswave-staging-firebase-adminsdk.json"
  ```
  (PowerShell: `$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\key.json"`.)
- The staging PM account's own password is, for the same reason, never hardcoded in
  `scripts/staging-bootstrap-admin.js` either (unlike the emulator's own bootstrap script,
  which is fine to hardcode since it only ever touches a fully offline emulator — see that
  script's own header for why staging is a genuinely different situation). On first run it
  generates a random password and prints it once — save it, it cannot be recovered.
- The `apiKey`/`authDomain`/`projectId`/etc. hardcoded into `firebase-config.js`'s
  `STAGING_CONFIG` are NOT secrets — per Firebase's own documented security model, a Web API
  key identifies the project to Google's client libraries; actual access control is enforced
  by Firebase Auth + the deployed Firestore rules, both of which are the real thing here. Only
  the service account key (Admin SDK access) and the PM account's password are handled with
  the care described above.

### Environment switch: `?env=staging`

Add `?env=staging` to `signup.html` or `login.html`'s URL to point that page load at the real
staging project — e.g. `http://127.0.0.1:8765/signup.html?env=staging`. Its absence (or any
other value) uses the emulator, the safe default — see `firebase-config.js`'s own header
comment for the full reasoning on why a URL param was chosen over a persisted flag or a
hand-edited constant. `golden-path-regression.js` never adds this param, so it is completely
unaffected by staging's existence — verified below, not assumed.

### Deploying Firestore rules to staging

Staging has its OWN rules file, `firestore.staging.rules` — do not confuse it with
`firestore.rules` (the emulator's own, structurally different ruleset: the emulator denies
ALL client writes since creation goes through a Cloud Function; staging allows a client to
create exactly their own document with status forced to `pending_review`, since there's no
Function to do that server-side yet). Deploy with:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/marketswave-staging-firebase-adminsdk.json"
firebase deploy --only firestore:rules --project marketswave-staging --config firebase.staging.json
```

`--config firebase.staging.json` is what points this deploy at `firestore.staging.rules`
instead of the emulator's `firestore.rules` — `firebase.staging.json` deliberately has no
`functions` block at all, so `--only functions` against it isn't even a well-formed command,
a structural safety net on top of "Do not attempt to deploy Functions in this task."

### Staging admin bootstrap

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/marketswave-staging-firebase-adminsdk.json"
node scripts/staging-bootstrap-admin.js
```

Creates (or reuses) the real staging PM account (`pm@marketswave-staging.internal`) and sets
its real `{ admin: true }` custom claim, mirroring `scripts/bootstrap-admin.js`'s technique
against the real project instead of the emulator. Idempotent, same as the emulator version.

### Temporary approval stand-in

There is no deployed Cloud Function on staging yet (Phase A2, blocked — see below), so there
is no real admin UI approve/reject button either. Until that ships, approving a pending
staging application is a manual script:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/marketswave-staging-firebase-adminsdk.json"
node scripts/staging-approve-client.js <uid>
```

`<uid>` is the applicant's Firebase Auth uid (== their `clients/{uid}` Firestore document id)
— find it in the Firebase Console's Authentication tab after they sign up. This script is
explicitly a temporary stand-in, not a permanent tool — see its own header comment for what
should happen to it once Phase A2 ships a real `approveClientApplication` callable on staging.

### What's blocked: Phase A2 (real Cloud Functions on staging)

**Blocked on a Blaze plan upgrade for the `marketswave-staging` project** — confirmed live
during Phase A1 (the Firebase Console shows staging still on the free Spark plan), not
assumed. Cloud Functions (2nd gen, which this project uses) require Blaze even for a
functions deployment that stays within the free-tier usage quota — Spark cannot deploy
Functions at all, full stop. Once staging is upgraded to Blaze, Phase A2 is: deploy
`functions/index.js`'s existing three callables to staging
(`firebase deploy --only functions --project marketswave-staging` — a real config, not
`firebase.staging.json`, since it needs both a `functions` block and `firestore.rules`
reverted to deny direct client creates again, mirroring the emulator's own Cloud-Function-
only-writes model once a Function actually exists to do that write), then wire a real
admin UI approve/reject button pointed at staging, retiring `scripts/staging-approve-client.js`
as the manual stand-in it always was. **Not attempted in this task, per explicit
instruction** — flagged here so it's a known, tracked blocker, not a silently dropped item.

### Staging verification — what was actually run, not just built

Run for real against the live staging project on 2026-08-26, not assumed from the code:
signed up a real applicant through the actual 7-step `signup.html` form (`?env=staging`,
served locally, real file uploads for the two document steps) — confirmed a real Firebase
Auth user AND a real `clients/{uid}` Firestore document (`status: "pending_review"`, `email`
matching the real Auth token, `createdAt` a real server timestamp) both **visually, in the
actual Firebase Console**, not just via a script query. Attempted login while pending with
fully correct credentials — genuinely refused with "Your application is under review."
Ran `scripts/staging-approve-client.js` — status flipped to `active` for real, confirmed
again in the Console. Logged in again — succeeded for real, landing on a genuinely empty
($0, zero holdings) real dashboard for that client, proving the local
`mirrorAuthenticatedClientLocally()`/`setClientAuthenticated()` bridge works correctly
against a real staging-authenticated identity, not just the emulator path. Finally, restarted
the LOCAL emulator from a clean state and re-ran `golden-path-regression.js`
completely unchanged — `GOLDEN PATH: PASS (16/16 steps)`, confirming Phase A1 has zero effect
on local emulator dev.

---

## Backend Migration roadmap (Phase 0 / A / B / C / D / E)

> **★ RETIRED, Aug 30, 2026.** This was the planned path to real PRODUCTION Firebase — moot
> now that Firebase itself is retired as the active backend (see the top of this document).
> Kept as historical record of the plan in motion at the time of the pivot; it is not being
> continued. The equivalent forward-looking plan for real production Supabase, if/when that
> becomes a real requirement, is a genuinely separate, not-yet-written future roadmap — do not
> assume anything below still applies.

This is the shape of the plan the work in this document belongs to — kept here so a future
session has the full roadmap, not just whichever single phase it happens to be picking up.
**Phase 0 is the only phase with a settled, agreed item list; Phases A–E below are this
project's existing (already-written, see `Marketswave_Project_Handover.md` §12.4) 7-item
real-production switch-over checklist, grouped into named phases here for the first time —
treat that grouping as a proposal to confirm, not settled history, until it's been explicitly
signed off.**

- **Phase 0 — Stabilize the hybrid** *(this document; complete)*. Make the
  already-working emulator setup reproducible and self-verifying before any staging/
  production work begins.
  1. ✅ Emulator bootstrap runbook (this document).
  2. ✅ Golden-path regression script (`scripts/golden-path-regression.js`).
  3. ✅ Label local-only admin actions that don't do what a PM would reasonably assume for a
     Firebase-sourced client. **Turned out to be narrower than the original "Reset
     Password/2FA... has no real effect" framing** (CLAUDE.md's Backend Migration §12.8 note)
     — investigated directly rather than trusted: only **Reset Password** is actually
     misleading (it gates `settings.html` until the client "sets a new password," but nothing
     is ever persisted for any client, so a Firebase-sourced client's real Firebase Auth
     password is completely untouched). **Reset 2FA is not a no-op** — 2FA has always been a
     fully local, simulated feature independent of Firebase Auth for every client, so
     resetting it achieves its real, complete, intended effect regardless of client source; a
     warning on it would have been inaccurate, not just unnecessary. `admin-clients.html` now
     shows an inline note under the buttons and a warning banner in the confirm modal — both
     scoped to Reset Password on a Firebase-sourced client only.
- **Phase A — Prove it against staging first, not production directly.** Revised from its
  original single-item shape (below) once Phase A1 actually shipped, reported here rather
  than silently redrawn: instead of pointing config directly at real production ("Marketswave
  SE"), Phase A now proves the whole real-backend approach against a genuinely separate,
  persistent staging project (`marketswave-staging`) first — see README's own "Staging
  Environment" section above for the full detail.
  - **A1 — Real identity (Auth + Firestore), no Cloud Functions — COMPLETE (Aug 26, 2026).**
    A real staging Firebase config living alongside the emulator's in `firebase-config.js`,
    switched via an explicit `?env=staging` URL param (never accidental, never persisted);
    real `firestore.staging.rules` deployed to staging enforcing "create your own doc once,
    status forced to `pending_review`, never update it again"; `signup.html`/`login.html`
    working for real against staging (signup writes Firestore directly via the client SDK,
    since there's no Function yet); a real staging admin bootstrap script
    (`scripts/staging-bootstrap-admin.js`) and a temporary Admin-SDK approval stand-in
    (`scripts/staging-approve-client.js`). Verified live end to end, including visual
    confirmation in the real Firebase Console (not just a script query) — see the Staging
    Environment section's own "what was actually run" note. `golden-path-regression.js`
    re-run afterward, completely unchanged: still `GOLDEN PATH: PASS (16/16 steps)`.
  - **A2 — Real Cloud Functions on staging — BLOCKED on a Blaze plan upgrade** for the
    `marketswave-staging` project, confirmed live (the Console still shows it on the free
    Spark plan) — Cloud Functions cannot deploy at all on Spark, regardless of usage. Once
    unblocked: deploy `functions/index.js`'s three callables to staging, tighten
    `firestore.staging.rules` back to Cloud-Function-only writes (mirroring the emulator's
    own model once a Function actually exists to enforce that), wire a real admin UI
    approve/reject button pointed at staging, retire `scripts/staging-approve-client.js` as
    the manual stand-in it always was. **Not attempted — explicitly out of scope for A1, not
    forgotten.**

  *Original Phase A shape, for context (superseded by A1/A2 above, not deleted from the
  record): "Point `.firebaserc` at the real Marketswave SE project id, replace
  `firebase-config.js`'s placeholder config with the real one, guard emulator connections
  behind a local-dev check." (§12.4 items 1–3.) That work still needs to happen — for
  PRODUCTION specifically — but only after A1+A2 fully prove the approach against staging,
  which is why it moved to Phase B below instead of staying Phase A's job.*
- **Phase B — Real production deploy.** Once staging (A1 + A2) is fully proven: point
  `.firebaserc` at the real "Marketswave SE" project id (a third alias, alongside `default`
  and `staging`), add its real web-app config to `firebase-config.js` as a third
  `PRODUCTION_CONFIG` (mirroring how `STAGING_CONFIG` was added in A1, not overwriting
  either existing config), confirm Email/Password sign-in is genuinely enabled in the real
  Console (don't just trust that it already is — A1 confirmed this take-nothing-for-granted
  habit was worth it), then `firebase deploy --only firestore:rules` and
  `firebase deploy --only functions` against the real production project. *(§12.4 items
  1–5, now sequenced after staging instead of before it.)*
- **Phase C — Real admin bootstrap (production).** Same technique as A1's staging bootstrap
  (`scripts/staging-bootstrap-admin.js`) and the emulator's own `scripts/bootstrap-admin.js`,
  applied a third time against real production — a real admin/PM Firebase Auth account, its
  custom claim set via an authenticated, one-time script that is run locally and **never
  committed** (production's own service account key, kept outside the repo exactly like
  staging's — see the Staging Environment section's "Credential handling" for the precedent
  this follows). *(§12.4 item 6.)*
- **Phase D — Multi-PM decision.** Decide, before going live, whether the single-shared-
  admin model (this project's deliberate scope through every phase so far) is acceptable for
  launch, or whether real individual PM accounts are a launch requirement. Currently a
  genuinely open, unresolved decision — not defaulted either way. *(§12.4 item 7.)*
- **Phase E — Cutover.** The actual go-live switch once A–D are done and verified against a
  staging project: real traffic starts flowing, the emulator-only path is retired as the
  default local-dev story (though very likely kept available *as* a local-dev option), and
  every reference to "emulator-only, deliberately" in `CLAUDE.md`/the handover doc gets
  updated to reflect that production is genuinely live. Not yet scoped in detail beyond that
  — deliberately, since A–D need to be settled first.

**Two items from the original §12.4 checklist are already done** and don't belong to any
future phase above: reading/writing real Firestore data from `admin-client-applications.html`
and `admin-clients.html` (§12.4 item 8), and wiring a real `signOut(auth)` into the app's own
Logout action (§12.4 item 9) — both shipped Aug 22–23, 2026, well before this Phase 0/A–E
structure was adopted.
