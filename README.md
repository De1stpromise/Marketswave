# Marketswave

Marketswave is a discretionary wealth / capital management platform: a public marketing
site, multi-step client onboarding, login + password recovery, and a client dashboard. Most
of the app is frontend-only, static HTML backed by `localStorage` (see `engine-core.js`).

**Backend pivot (Aug 30, 2026): the real backend is migrating from Firebase to Supabase.**
`signup.html`/`login.html` still talk to the real Firebase backend described in the sections
below — **that stays fully in place and untouched** until Supabase is proven equivalent end
to end; this is additive work, not a replacement yet. The reason for the pivot, reported
plainly: real Cloud Functions on the Firebase side are blocked on a Blaze (pay-as-you-go)
plan upgrade for `marketswave-staging` (see "What's blocked: Phase A2" below) — a real card
requirement this project didn't want to take on. Supabase's free tier includes real Edge
Functions with no card required, at the cost of a real tradeoff, not a free lunch: free-tier
Supabase projects auto-pause after 7 days of inactivity and need a manual un-pause. **Supabase
Migration Stage 1** (infrastructure + schema + local bootstrap only — no client-facing
signup/login rebuild yet, no golden-path regression script yet, both Stage 2) is documented in
its own "Supabase Local Development Runbook" section below, placed first as the now-active
path. The Firebase sections that follow are kept intact as historical record of real,
working, verified infrastructure — not deleted, not superseded by this pivot on their own
terms — until Supabase Stage 2+ actually replaces what they do.

There are now THREE Firebase environment tiers, not two — see "Which Firebase environment am
I looking at?" below before assuming which one any given session/browser/script is pointed
at:

| Tier | Project id | Status |
|---|---|---|
| Emulator | `demo-marketswave` | Fully offline, default for all local dev — see "Emulator Bootstrap Runbook" |
| Staging | `marketswave-staging` | REAL Firebase project, Phase A1 complete — see "Staging Environment" |
| Production | "Marketswave SE" | REAL Firebase project, untouched — not started (Phases B–E) |

For the full project context (tech stack, locked design rules, feature history), see
`CLAUDE.md` — it is read automatically by Claude Code at the start of every session in this
directory and is the actual day-to-day source of truth. `Marketswave_Project_Handover.md` is
the full narrative history behind it. This file is deliberately narrower: it is an
operational runbook — now for both backends, side by side during the migration.

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

### Step 9 — Stop the stack when you're done

```
supabase stop
```

Leaves data intact (see Step 3) for next time. Use `supabase stop --no-backup` only if you
deliberately want a clean slate next start.

---

## Emulator Bootstrap Runbook

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
