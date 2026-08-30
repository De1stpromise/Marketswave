# Marketswave

Marketswave is a discretionary wealth / capital management platform: a public marketing
site, multi-step client onboarding, login + password recovery, and a client dashboard. Most
of the app is frontend-only, static HTML backed by `localStorage` (see `engine-core.js`) —
**the one exception is `signup.html`/`login.html`, which talk to a real Firebase backend.**
That hybrid is what this document is about. There are now THREE Firebase environment tiers,
not two — see "Which Firebase environment am I looking at?" below before assuming which one
any given session/browser/script is pointed at:

| Tier | Project id | Status |
|---|---|---|
| Emulator | `demo-marketswave` | Fully offline, default for all local dev — see "Emulator Bootstrap Runbook" |
| Staging | `marketswave-staging` | REAL Firebase project, Phase A1 complete — see "Staging Environment" |
| Production | "Marketswave SE" | REAL Firebase project, untouched — not started (Phases B–E) |

For the full project context (tech stack, locked design rules, feature history), see
`CLAUDE.md` — it is read automatically by Claude Code at the start of every session in this
directory and is the actual day-to-day source of truth. `Marketswave_Project_Handover.md` is
the full narrative history behind it. This file is deliberately narrower: it is an
operational runbook for the Firebase half of the app — the emulator (getting it running from
nothing, confirming it works) and, now, the real staging project.

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
