-- Backend Migration Phase B — Stage 6 (2026-09-02): Documents & Support move to real
-- Supabase tables + Edge Functions. Local stack only, real cloud "Marketswave Staging"
-- untouched.
--
-- ============================================================================
-- ★ ARCHITECTURAL NOTE, READ BEFORE ASSUMING THIS MIRRORS STAGES 1-5 ★
-- Documents & Support are NOT Approval Gate queues — they were deliberately categorized
-- separately (User/Admin Relations) from the start, and the REAL local behavior, confirmed
-- by reading documents.html/support.html/admin-documents.html/admin-support.html/
-- engine-core.js directly before writing a line of schema, reflects that difference:
--   * documents.html calls addDocument() DIRECTLY, with no gate, for a client's own upload.
--   * documents.html calls updateDocument() DIRECTLY, with no gate, for the Sign action —
--     a client signing a document the FIRM published, not something a client publishes.
--   * documents.html calls removeDocument() DIRECTLY, with no gate, to remove their own
--     upload.
--   * support.html calls a purely local nextDisputeId() + array push DIRECTLY, with no gate,
--     to file a new dispute — no pending/approved/rejected status on CREATION at all
--     (status starts 'Open', a real, immediately-usable ticket, not a request awaiting
--     approval).
--   * Only publishDocumentToClient() (create a `from` document), updateDocumentForClient()
--     (e.g. admin-documents.html's "Mark Reviewed"), and updateSupportRequestForClient()
--     (status + pmNote) are admin-only additions, confirmed by grep to have zero call sites
--     in either client-facing page.
-- The schema and RLS below are designed to match this ACTUAL shape — real client-side direct
-- writes where the real code takes that path, Edge-Function-only where the real code
-- restricts it to an admin-only function. This is NOT the "zero client-side write, every
-- write through service_role" pattern Stages 2-5 used for the seven genuinely
-- request-then-approve Approval Gate queues; reflexively copying that pattern here would
-- misrepresent a real structural difference this project's own admin-sidebar.js nav grouping
-- (Approval Gate vs. User/Admin Relations) already encodes.
-- ============================================================================
--
-- ---- DOCUMENTS: exact field shape confirmed against the real source (engine-core.js's
-- SEED_DOCUMENTS/getDocuments()/addDocument()/updateDocument()/publishDocumentToClient(),
-- and documents.html's own addDocument()/updateDocument()/removeDocument() call sites), not
-- assumed from the task's own paraphrase:
--   direction is 'from' | 'upload' (NOT "from_marketswave"/"uploaded_by_client" as the
--   task's own paraphrase suggested — the real stored values are the short forms).
--   category's real value set, confirmed by reading every dropdown that ever sets it: the
--   client's own upload-category select offers exactly 'Contracts'/'Statements & Reports'/
--   'General'; admin-documents.html's publish-category select ALSO offers 'Signature
--   Required' as a fourth, genuinely selectable category value (independent of the separate
--   signatureRequired checkbox) — a real, if slightly unusual, pre-existing quirk of the
--   shipped admin UI, not invented here; the CHECK constraint below allows all 4 real values,
--   while the client's own INSERT policy (below) is scoped to the narrower 3-value set that
--   matches what a client can actually pick.
--   status's real value set, confirmed across every place it's ever assigned: null (default,
--   most `from` docs), 'Received' (a client's own fresh upload), 'Under Review' (present in
--   SEED_DOCUMENTS, not reachable via any live client/admin action today but real seeded
--   data), 'Reviewed' (admin's "Mark Reviewed" on an upload), 'Signature Required' /
--   'Signed' (the from-document sign lifecycle).
--   `date` is a genuine calendar date (todayStrUTC() format), not a timestamp — mirrors
--   Stage 1's own `products.created_at date` precedent for the same reason.
--
-- ---- SUPPORT: exact field shape confirmed against the real source (support.html's own
-- dispute-submit handler and STORAGE_KEY/nextDisputeId()/requests.push() logic, and
-- admin-support.html's updateSupportRequestForClient() call), not assumed:
--   category's real value set: 'Transaction Issue' / 'Account Access' / 'Billing/Fees' /
--   'Document/Signature Issue' / 'Other' (read directly off the real <select> options).
--   status's real value set: 'Open' (created) / 'In Progress' / 'Resolved' (read directly
--   off admin-support.html's own <select> options).
--   `reference` is a real field in every request object support.html creates
--   (`reference: null`) and is conditionally rendered in BOTH support.html's and
--   admin-support.html's own row markup (`req.reference ? ... : ''`) -- but a project-wide
--   grep confirms it is NEVER set to anything but null anywhere in the real, live code today
--   (a vestigial field, likely left over from an earlier id scheme). Kept as a nullable
--   column for shape-fidelity with the real local store, not invented functionality --
--   flagged here so a future reader doesn't assume it's load-bearing.
--
-- ---- A GENUINE DESIGN DEVIATION, flagged per instruction, from a real, investigated
-- constraint the task itself named: "Confirm the reference-number generation (DISP-XXXX)
-- happens server-side, not trusted from the client." The real local nextDisputeId() scans
-- ONLY the CURRENT client's own scoped array (clientScopedKey()) for the max existing
-- DISP-N, meaning the human-readable id is UNIQUE PER CLIENT, not globally -- two different
-- clients' first-ever dispute can both legitimately be "DISP-0001" (the exact same real
-- per-client-id-collision property already found and handled once before in this project,
-- for Client Profile Updates' own SETTING-XXXX ids, register row unknown/see
-- admin-settings-changes.html's own data-client+data-id discipline). A bare `text primary
-- key` on that human-readable value would therefore be a real correctness bug the moment a
-- second client files their first dispute. Resolved the same way every prior Supabase stage
-- already resolved id generation under real concurrent/multi-client writers: `id` is a
-- genuine, globally-unique `gen_random_uuid()`; the human-readable, PER-CLIENT-SCOPED
-- display string lives in a separate `display_id` column (still genuinely server-computed,
-- never trusted from the caller -- see request-support-ticket/index.ts), constrained
-- `unique(client_id, display_id)` to preserve the real local "unique within this client's
-- own history" guarantee without claiming a false global-uniqueness property the real system
-- never actually had.
--
-- ---- Why support_requests gets NO client-side INSERT/UPDATE/DELETE policy at all (unlike
-- documents' own upload path, which DOES get a direct client INSERT policy) -- a real,
-- reasoned structural difference, not an inconsistency: `documents.id` is a plain
-- `gen_random_uuid()` with no display significance anywhere in the UI, so a client-supplied
-- id (even if RLS allowed one to slip through) carries no real risk -- a straightforward RLS
-- `with check` on the OTHER fields (direction/category/status/is_new/deadline_label) is
-- entirely sufficient to make a direct client insert exactly as safe as going through a
-- function. `support_requests.display_id`, by contrast, is displayed prominently in both the
-- client's own request list and the admin queue, genuinely needs server-computed
-- sequential-per-client generation, and RLS's row-level `with check` has no clean way to
-- verify "this display_id was computed by our own scan-and-increment algorithm" without a
-- trigger -- the simplest, least-surprising way to make that guarantee real is to not grant a
-- client-side INSERT path at all, mirroring Stage 4's own `hys_pockets` precedent ("no
-- client-side INSERT policy exists at all, even a genuinely-own one"). This is a decision
-- about HOW creation happens (a thin, always-succeeding Edge Function computes the id and
-- creates the row), not WHETHER it requires approval -- `request-support-ticket` still
-- creates immediately, unconditionally, with status='Open', with NO pending/approved/
-- rejected gate on creation itself, faithfully preserving the real "no approval gate on
-- ticket filing" property the task's own architectural note asked to be preserved.
--
-- ---- A deliberate strengthening beyond the local engine's own primitive, flagged per
-- instruction: the real local removeDocument(id) has NO `direction` check at all -- it will
-- delete ANY document by id, 'from' or 'upload'. In practice this is never exploitable
-- because documents.html's own UI only ever calls it with an upload doc's id (the Remove
-- button is rendered only inside the non-`isFrom` branch, confirmed by reading docRowHTML()
-- directly) -- but at the REAL Supabase security boundary, where a client could otherwise
-- issue a raw delete against any row RLS lets them reach, "never exploitable via the shipped
-- UI" isn't the same guarantee as "structurally impossible." The DELETE policy below is
-- scoped to `direction = 'upload'` explicitly -- a client can never delete a document the
-- firm published, even though the local engine's own primitive never enforced that.

-- ============================================================================
-- documents — per-client. See this file's own header for the full field-shape
-- investigation.
-- ============================================================================
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('from', 'upload')),
  filename text not null,
  category text not null check (category in ('Contracts', 'Statements & Reports', 'General', 'Signature Required')),
  status text check (status in ('Received', 'Under Review', 'Reviewed', 'Signature Required', 'Signed')),
  is_new boolean not null default false,
  deadline_label text,
  created_at date not null default current_date
);

alter table public.documents enable row level security;

create index documents_client_id_idx on public.documents (client_id);

-- ---- Client: SELECT own (both directions) --------------------------------------------
create policy "clients can view their own documents; admins can view all"
  on public.documents
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

-- ---- Client: INSERT their own upload directly, no gate -- mirrors documents.html's own
-- addDocument({ filename, category, direction: 'upload', status: 'Received', isNew: false,
-- deadlineLabel: null }) call verbatim. category restricted to the 3 real values the
-- client's own upload-category <select> actually offers (NOT the 4th, admin-only
-- "Signature Required" value) -- a real, deliberate narrowing beyond the table's own
-- broader CHECK constraint, matching what the real form can actually produce.
create policy "clients can insert their own upload directly, no approval gate"
  on public.documents
  for insert
  to authenticated
  with check (
    auth.uid() = client_id
    and direction = 'upload'
    and category in ('Contracts', 'Statements & Reports', 'General')
    and status = 'Received'
    and is_new = false
    and deadline_label is null
  );

-- ---- Client: UPDATE -- the Sign action ONLY. Mirrors documents.html's own
-- updateDocument(docId, { status: 'Signed', isNew: false, deadlineLabel: null }) call
-- verbatim -- USING checks the row being signed is genuinely their own, genuinely a `from`
-- document, genuinely awaiting a signature; WITH CHECK checks the resulting row lands
-- exactly where the real Sign action leaves it. Same disclosed limitation as every other
-- narrowly-scoped self-service policy already in this schema (e.g. Stage 2's own
-- deposit_requests INSERT policy): RLS enforces which ROWS qualify, not which OTHER columns
-- (filename/category/direction) a single UPDATE statement could also smuggle a change into --
-- accepted here at the same risk level already established project-wide, not tightened
-- further with a column-locking trigger no other table in this schema uses either.
create policy "clients can sign their own from-marketswave documents"
  on public.documents
  for update
  to authenticated
  using (auth.uid() = client_id and direction = 'from' and status = 'Signature Required')
  with check (
    auth.uid() = client_id
    and direction = 'from'
    and status = 'Signed'
    and is_new = false
    and deadline_label is null
  );

-- ---- Client: DELETE -- their own UPLOAD only. A deliberate strengthening beyond the local
-- removeDocument()'s own lack of a direction check -- see this file's own header.
create policy "clients can remove their own uploaded documents"
  on public.documents
  for delete
  to authenticated
  using (auth.uid() = client_id and direction = 'upload');

-- No other write policy exists for `authenticated`/`anon` -- publishing a `from` document
-- (publishDocumentToClient()) and the general admin patch (updateDocumentForClient(), e.g.
-- "Mark Reviewed") are reserved exclusively for service_role, via publish-document/
-- update-document below. A client can never insert a `from` document (impersonating the
-- firm) or apply an arbitrary patch to any document -- only the two narrow, real self-service
-- actions above.

-- ============================================================================
-- support_requests — per-client. See this file's own header for the display_id design and
-- why this table gets NO client-side write policy at all.
-- ============================================================================
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  display_id text not null,
  reference text,
  category text not null check (category in ('Transaction Issue', 'Account Access', 'Billing/Fees', 'Document/Signature Issue', 'Other')),
  description text not null,
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Resolved')),
  date_opened date not null default current_date,
  last_updated date not null default current_date,
  evidence text,
  pm_note text,
  unique (client_id, display_id)
);

alter table public.support_requests enable row level security;

create index support_requests_client_id_idx on public.support_requests (client_id);

-- ---- Client: SELECT own only; admin SELECT all (mirrors getAllClientSupportRequests()'s
-- own direct-read pattern -- no separate "list" Edge Function needed, same established
-- precedent as Client Applications' own admin listing in Stage 5).
create policy "clients can view their own support requests; admins can view all"
  on public.support_requests
  for select
  to authenticated
  using (auth.uid() = client_id or public.is_admin());

-- No INSERT/UPDATE/DELETE policy exists for `authenticated`/`anon` at all -- see this file's
-- own header for why creation (server-computed display_id) is Edge-Function-only despite
-- being a genuine no-approval-gate action, and why status/pm_note updates are admin-only,
-- exactly mirroring the real local engine (support.html has zero update capability on an
-- existing request anywhere in its own source, confirmed by grep).
