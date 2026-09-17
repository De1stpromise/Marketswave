# PM tool vocabulary

The patterns the PM tool revamp establishes, recorded so that the later pages — the client
profile, the approval queues — apply a documented vocabulary rather than a remembered
impression. Part 1 (the inbox, 2026-09-14) set §1–§9; part 2 (the navigation and the briefing, the same
day) added §10–§12; part 3 (the approval gate, 2026-09-15) added §13; each later part extends
this file rather than inventing a second version of anything here.

Every value below is measured, not chosen by eye: contrast on real composited pixels
(`verify-contrast.mjs`, profiles `inbox-ticket` / `inbox-email`), fonts by real advance width,
widths at 1440 / 390 / 375 and a real 320px iframe.

## 1. Grouping by urgency

A list is grouped, never flat. The first group is **what needs the PM's action**; the second
is everything else, most recent first within each.

- Inbox: **"Needs a reply"** (`unread_by_pm = true`) above **"Earlier"**. Recency sorts within
  each group. A group header is a 10px uppercase label with a hairline to its right
  (`.ibx-grp`), never a card or a box.
- The same shape carries to the queues: "Needs a decision" above "Earlier"; to the client
  profile: "Pending" above "Resolved". The rule is one binary of urgency, then time. Do not
  add a third group unless it is a genuinely different kind of thing (an archived state, say),
  and then it gets its own view, not a third group.
- Counts belong on the thing that switches the list (the rail button, the filter pill) —
  never as a bare number floating in a header.

## 2. Status indicators

Status is a **word in a pill**, small and uppercase, colour-coded consistently, and it is
never signalled by colour alone.

| status        | pill class     | tone                      |
|---------------|----------------|---------------------------|
| open          | `.s-open`      | amber (`#FEF3C7` / `#92400E`) |
| in progress   | `.s-in_progress` | blue (`#DBEAFE` / `#1E40AF`) |
| resolved      | `.s-resolved`  | green (`#DCFCE7` / `#166534`) |
| archived      | `.s-archived`  | slate (`#F1F5F9` / `#475569`) |

The same four tones are the vocabulary for every lifecycle in the tool: pending/approved/
rejected map onto amber/green/red the same way. A status is CHANGED through a control in the
header — a `<select>` on a ticket — never a modal, and the change is visible in the record
itself (a system line in the thread) so the history stays one ordered list.

Identity chips use the same 9–9.5px uppercase pill shape with their own tones: **Client**
(blue), **Anonymous** (slate), **Unknown sender** (violet), a **case id** (violet on
`#F3F0FF`, tabular figures).

## 3. Presence

Presence is a **green dot on the avatar** (`.ibx-on`, `#22C55E`, 11px, ringed by the surface
colour) and, where there is room, the word **Online** in green beside the name. It is derived
from the same `visitor_sessions` rows `admin-presence.html` reads — a session seen within the
last 45 seconds and not ended — never from a second mechanism. Where the person is (their
current page) is a small amber chip (`.ibx-wait`) on the row, only for an anonymous visitor.

Presence changes what a control DOES, not only how it looks: the composer defaults to chat
when the person is online and says so ("Manuel is online — chat will reach him now"); when
they are not, it says which channel will reach them.

## 4. The context strip

A **slim strip of three facts and one link** under the header (`.ibx-ctx`): each fact is a
small grey label over a bold value with tabular figures, separated by hairlines. It answers
"what do I need to know to act on this" — and hands off for anything more.

- For a client: pending requests · last activity · this conversation · **Open profile →**
- For a ticket: category · opened · assigned · messages
- For a visitor: where they are · location · this conversation · View on presence →

"Open profile" hands off to the client profile (`admin-clients.html?client=<id>`) rather than
embedding it — deliberate and settled. The strip is never a place to put a second copy of
another page.

## 5. Density

Chrome is tight, content breathes. Small type carries structure; body type carries content.

- Structural text is 9–11px, semibold-to-bold, often uppercase with tracking: pills, group
  headers, meta lines, rail labels.
- Content text is 13.5px at 1.62 line-height: bubbles, email bodies. Names are 13.5px/500,
  bold when unread. Headings are 15–15.5px/700 with slight negative tracking.
- Vertical rhythm: 12px row padding in lists, 14px between messages, 10px context-strip
  padding. Rows are separated by background change on hover/active and a 3px left accent on
  the active row (`#B45309`), not by borders between every row.
- Figures are always `font-variant-numeric: tabular-nums`. The family is Inter everywhere; no
  monospace (row 192).

## 6. Colour

The admin tool's own palette, never the client tool's navy/cream: **`#0F172A`** for the dark
rail, **`#B45309`** (amber-700) as the single accent — the active rail button, the active row's
left bar, the unread dot and hot timestamps, the PM's avatar. Outbound bubbles and the Send
button are a slate gradient (`#334155 → #1E293B`). Secondary text is **`#475569`** (slate-600),
not slate-500: at 10.5–12px on the tinted list/thread grounds slate-500 composited at
4.02–4.44:1 (row 151's finding, measured again here). Channel chips: chat green, email violet,
ticket violet-on-lilac.

## 7. Views, filters, search

A dark rail owns the top-level split (Live chats · Email · Tickets · All · Archive) with a
"needs action" count on each. Filters inside a view are pills in one horizontal row, one
active at a time, with a count where the count is cheap and honest. Search is one field, above
the filters, and it reaches into content (message bodies, case ids), not only titles.

A record appears in the view of its **most recent** real activity, so it moves as it changes —
the rail is a live categorisation, not a stored one.

## 8. Composition

A composer picks its channel explicitly (tabs), defaults to the one that is live, and shows a
one-line hint saying what will happen. Enter sends; Shift+Enter breaks a line. Anything that
threads (email) carries its subject automatically and shows it, so the PM never types one on a
reply.

## 9. Mobile

Below `lg` (1024px) the rail becomes a horizontal strip, the list fills the width, and opening
a record replaces the list with the record plus a back control (`.is-thread-open`). Nothing
scrolls horizontally at 320px. Every control keeps the 44px floor (`tap-targets.css`).

## 10. The navigation (part 2)

Ten items, ungrouped, ordered by how often a PM touches them — Overview · Approvals · Inbox ·
Clients · On the site · Products · Deposit addresses · Documents · Advisory fee · Security.
The ordering does the work; there are no group headers. A **count** sits on an item only where
the number is a queue a PM works through (Approvals, Inbox) — a red pill (`.an-ct.is-hot`,
red-600, measured 4.83:1). A figure that is live (people on the site) is a **green dot**, not a
number, because a number would be stale the moment it painted; the real count is kept for
assistive tech in a visually-hidden span. The footer is the account: role and sign-in email.
No display name exists and none is invented. The rail is `#0F172A`, 238px; the active item is
the single accent (`#B45309`); every item is a real link with `aria-current`.

A family of pages that one item stands for marks the item active through `aliases` — the PM
never sees a nav with nothing highlighted. (The seven approval queues were that family until
part 3 replaced them with one page; the mechanism stays in `navHTML()` for the next one.)

## 11. The briefing (part 2)

The Overview is what a PM reads first each day, not cards-with-links. Nine panels in a fixed
order: an **attention band** of four figures (amber where urgent, with the oldest age), then
two columns — left: what needs the PM first, what changed since they last looked, what is
coming up, what is worth acting on; right: who is on the site, the firm today, what needs a
look, system health.

- **Every figure is real or absent.** A figure that cannot be computed is shown as the reason
  it cannot ("Month anchors exist for 0 of 2 portfolios", "Not configured"), never a
  placeholder number, never a guessed default. A rule with a threshold states the threshold on
  the panel ("one holding ≥ 40% of a portfolio of $10,000+").
- **"Since you last looked" is against the PM's own previous session** (`pm_visits`), and a
  first briefing says it is one. Never "today", never midnight.
- **Rows** (`.ov-r`): an icon box tinted by domain, a 12.5px/600 title, an 11px sub, and a
  right-hand figure or age; an age past the overdue line is hot (`#B45309`, 600). Panels are
  `.glass-subtle`; the attention cards `.glass` + `.glass-lift`. Rows are separated by
  hairlines, never boxed; an empty panel says what is empty in one sentence.
- **System health** is a dot per line: green ok, amber degraded, red failed, grey not yet run
  — and a one-line reason beneath the label whenever the dot is not green.

## 12. Interim pages

When a nav item stands for work not yet rebuilt, it opens a **landing** that links every page
it stands for, with the same counts and ages the sidebar badge sums — never a nav item pointing
at a page that does not exist, never a dead end. The Approvals landing was the one instance and
is **superseded**: part 3 replaced it, at the same filename, with the gate itself.

## 13. The approval gate (part 3)

One page for all seven request types: one pending queue, one history, **seven panel shapes**.
The split is the point — the QUEUE unifies *seeing*, so "what needs me" has a single answer
ordered oldest-first; the PANEL is shaped by the type so *doing* stays correct. A generic panel
would have made every approval look alike, which is exactly the property that must not hold
when one of them moves real money and another does not.

- **Every row carries the five things a PM triages by**: the type (a word in a chip, never
  colour alone — §6), what it is, WHO it is, how much, and how long it has waited. The type
  pills above the queue each carry their own live count; "All" is the sum.
- **Urgency is a grouping, not a badge** (§1): "Waiting more than a day" above "Today", and a
  hot age (`#B45309`) on the row itself. An "Oldest waiting N" badge sits beside the title.
- **★ THE PANEL SAYS WHICH RE-VALIDATION WILL RUN, because they are not uniform.**
  `approve-allocation` re-reads unallocated capital, `approve-withdrawal` re-reads it against
  the PM-entered amount, `approve-sell` re-reads held units, `credit-hys-deposit` re-reads
  unallocated for an internal transfer only, `approve-hys-withdrawal` re-reads the pocket.
  **`credit-deposit` has no balance check and correctly so** — crediting is money ARRIVING, so
  there is nothing to exceed. Stating the real check per type is honest; implying a uniform one
  would not be.
- **A PM-editable amount exists only where settlement is genuinely uncertain** — an external
  deposit, a withdrawal, an external HYS deposit. An internal transfer's field is `readonly`
  AND refused server-side, because a UI control is not a constraint. Where an amount a PM
  entered diverges from what was requested, history marks it `(differs)` — never left to be
  spotted.
- **★ ATTRIBUTION IS WRITTEN AND NEVER RENDERED.** `resolved_by` / `resolved_by_email` keep
  being written by every Edge Function and appear nowhere: not in a row, not in a title, **not
  in a visually-hidden span** — a hidden field is still a displayed field to a screen reader,
  and this would be the only place in the product where a PM's email surfaces. It returns with
  multi-PM.
- **★ NARROW WIDTHS RESTACK, THEY DO NOT HIDE.** The first cut of the gate's own rule dropped
  `.ag-who` and `.ag-age` below 1000px, which left a phone showing rows a PM could not tell
  apart and removed the one signal the queue is ordered by. Both survive on a second line; what
  goes is the avatar, the type-specific context line, and history's column HEADER — never its
  content. Below 560px the panel is full-bleed. **Verify this by reading the rendered text of
  each part, not by checking that the grid collapsed** (§V, the vacuity pattern).
- **Surfaces**: the gate is white `.ag-*` cards on the page ground, with **no `.glass`
  anywhere** — deliberately, and asserted, so the sheen question does not arise on it at all.
  Secondary 10px text is `#475569`; `#64748B` measured 4.34–4.40:1 there and does not pass.

## 14. Inventory at scale (part 6 — the products page)

The first PM surface holding hundreds of rows rather than dozens. What it establishes:

- **A HEALTH STRIP IS A FILTER SET, not a scoreboard.** Five figures — live-priced, price
  stale, quote failed, no logo, no fund document — each a button that filters the table to
  exactly the rows behind its own number. A figure a PM cannot click through to is a number
  they have to go and find the rows for by hand.
- **★ A COUNT THAT IGNORES THE OTHER CONTROLS IS A LIE THE MOMENT A PM TYPES ANYTHING.** Every
  filter pill's count is computed against the CURRENT search and health card, never a static
  total. Asserted directly: search narrows, and the Crypto pill's own count narrows with it.
- **Paging, not a virtualised list.** 40 rows, then "Continue browsing", with the real
  arithmetic stated ("Showing 40 of 331"). Measured, not assumed: the catalogue's own frame
  cost was already established at ~247 cards running 2× the frame budget (row 211), so the
  page never renders everything at once.
- **Search reaches the whole catalogue, then paging applies.** Filter first, page second —
  otherwise a match on row 221 is invisible. The suite proves exactly that case rather than
  searching for something on page one.
- **★ THE DETAIL PANEL'S SHAPE COMES FROM THE OBJECT, NOT FROM THE PAGE.** A market-priced
  product and an appraisal-valued one are different things to a PM: one's price is the
  market's and its only question is whether the feed is healthy; the other's price is the
  firm's own and its questions are when it was last valued and whether its document is
  written. One shape for both puts a dead "publish valuation" beside a tracker and buries the
  overdue valuation that matters. Where a later surface has two genuinely different objects,
  branch the panel rather than the copy.
- **RETIRE, NEVER DELETE — and say what retiring does, in the words it actually does it in.**
  The product stays in the catalogue and keeps being priced; its holders keep their positions
  and can still sell; it accepts no new allocation; nothing is deleted. Enforced server-side in
  three places (`request-allocation`, `execute-buy` behind `approve-allocation`, and
  `resolveSymbols()`), never by hiding a control. A reason is required.
- **★ DIM THE CHROME, NEVER THE WORDS.** A retired row is a background TINT. It carries no
  `opacity` and no `filter`, and its name renders in the same colour as a live row's — proven
  by reading both. Row 233 already shipped 2.59:1 once by fading the text that explained an
  absence, which makes the explanation hardest to read exactly where it is needed.
- **AN EDIT FORM'S ABSENCES ARE ITS DESIGN.** No unit-price input, no symbol input, no
  pricing-model control — a price moves via the feed or a published valuation, a remapped
  symbol would silently re-price every holder, and the model is permanent. The server refuses
  all three regardless; the form simply does not offer what the server would reject, and states
  the fixed values read-only beside the editable ones.
- **★ CATCH THE DUPLICATE AT SEARCH TIME.** A symbol already in the catalogue is flagged AND
  disabled in the results — before a PM fills a form, not after `add-product` returns a 409.
  The server still refuses it; this is the earlier, cheaper stop.
- **Two creation paths, the model chosen FIRST and permanent.** Market-priced: symbol search
  across both providers, the asset class derived from the provider and locked. Appraisal:
  no symbol at all, an opening unit price dated today. The appraisal submit reads
  **"Create & write document"** and hands straight to the authoring page — the document is the
  deliberate second act (row 200), not a second half of one form.
- **A PREVIEW IS BUILT FROM DATA THE PAGE ALREADY HAS.** The publish-by-percentage impact table
  is computed from the holders the catalogue read already returned — no second query — so the
  preview and the row can never disagree. Verified by publishing and re-reading each holder
  through `get-holdings`, never off `account_state` directly.
- **Every read that feeds a display checks its error.** On this page an empty holder list and a
  failed holder query look identical, and "nobody holds this" is the input to a retirement
  decision. `buildProductCatalog()` wraps every batched read in `must()` and throws rather than
  returning partial data; two wrong column names were caught by exactly this during the build,
  where they had been rendering as empty panels.
- **Surfaces**: `.pr-*` on white cards over the page ground; the health strip and the table sit
  on `.glass` + `.glass-lift`. Secondary text is `#475569` — `#64748B` does not pass at 10.5px
  on these grounds (§6, measured again here). One overlay hosts every panel: detail, retire,
  create and edit.
- **No export control**, for the same reason the portfolio card has none (row 208): nothing in
  this project generates a catalogue export, and Documents & Reporting owns getting data out.

---

## 15. Reference data a client depends on (part 7 — the deposit address book)

The first PM surface where a PM's OMISSION silently blocks a client. What it establishes:

- **★ WHAT A PM HAS NOT DONE LEADS THE PAGE.** A client with no address on a route cannot
  deposit that currency at all — they see an honest empty state where an address should be, and
  nothing on their side says why. So the blocked clients sit in amber ABOVE the strip and the
  book, with the currencies each is missing as chips and an Assign action on the row itself.
  The Overview already counts them; this page is where the count is fixed, and the banner
  SHRINKS as each route is assigned rather than being a snapshot taken at load.
- **GROUP BY THE THING THAT MAKES TWO ROWS RELATED.** Several addresses per coin is the normal
  case, so a flat list makes them read as unrelated. Each group header carries its own address
  count, client count, total received and Add action. **USDT appears TWICE** — TRC-20 and
  ERC-20 are two groups, never one with a network toggle, because sending to the wrong one
  destroys the funds and a toggle invites exactly that.
- **★ THE DETAIL PANEL'S EMPHASIS FOLLOWS THE OBJECT, not the page.** A SHARED address leads
  with its clients, because the open question is who is on it — the chain alone will not say who
  sent what. A SINGLE-CLIENT address leads with its deposits, because attribution there is
  unambiguous and the deposits are what a PM came to see. Leading with the wrong one buries the
  question that is actually open. (Part 6 branched a panel on a product's pricing model for the
  same reason; this is the same rule applied to a different axis.)
- **SAY WHAT THE PLATFORM DOES NOT DO.** Both panels carry it: only deposits a client
  ACKNOWLEDGED through the platform are listed — Marketswave does not watch the chain. A figure
  that looks like a balance and is really a sum of self-reports has to say so where it is read.
- **★ AN IRREVERSIBLE INPUT GETS TWO DIFFERENT GUARDS, because they catch different mistakes.**
  STRUCTURAL VALIDATION against the route's own format, live, per keystroke — catches a TRON
  address in an ERC-20 slot, a truncated paste, an 0x missing a character. Then a READ-BACK step
  spelling the address out again before it saves — the only defence against a WELL-FORMED address
  belonging to someone else, which nothing client-side can validate and a human reading it
  against their wallet can. Neither replaces the other, and the server re-runs the structural
  check regardless.
- **THE CLIENT-SIDE CHECK IS A COURTESY; THE SERVER IS THE AUTHORITY.** The page mirrors
  `_shared/deposit-address-validation.ts` so a PM learns before submitting, and the suite proves
  the rejection through the REAL function with no row created. Where a rule is mirrored, say so
  at both ends — the same small, disclosed duplication `getHYSRate()` once carried.
- **★ REFERENCE DATA LIVES IN A TABLE, SO ADDING ONE IS ONE ROW.** `deposit_routes` is the
  catalogue of what a client may send. PYUSD was added as a single row: validation, the client's
  deposit picker, `request-deposit` and this page all read it generically and needed no code
  change. **A new route with no genuine address format is not a row** — PYUSD on Solana was left
  out because Solana addresses are neither `evm` nor `tron` and a route a client can pick must be
  one that is really validated.
- **★ DIM THE CHROME, NEVER THE WORDS — and on this page the words are the point.** A retired
  address is a background TINT with a status pill; the mockup faded the whole row at
  `opacity:.5`, which is register row 233's 2.59:1 failure, and here the faded thing would be the
  62-character address — the one text worth reading on a retired row, since its history is why
  it is still on screen at all. Retirement keeps everything and refuses new assignment, and both
  are enforced by a database trigger rather than by the UI.
- **Surfaces**: white `.da-*` cards on the page ground, with **no `.glass` anywhere** — asserted,
  the same call the approval gate made (§13), because the most important text here is an address
  read character by character. Secondary 10–10.5px text is `#475569`. **A small quiet figure is
  still text**: the row index at `#94A3B8` measured 2.56:1 and was darkened.
- **A nowrap cell needs `min-width: 0` AND a block box.** An address is `white-space: nowrap`, so
  a grid item's automatic minimum is the whole string — `minmax(0, 1fr)` on the track is not
  enough. And `overflow`/`text-overflow` do not apply to an inline box, so the address rendered
  clipped while still MEASURING its full width (and never showed an ellipsis). Both caught by
  measuring `maxRight`, which is why the probe names the widest offender rather than printing a
  bare number.

---

## 16. A page about the PM's own account (part 8 — Security)

The first PM surface whose subject is the PM rather than a client, and the first where the
honest answer to "can we build this panel?" was **partly no**. What it establishes:

- **★ INVESTIGATE WHETHER THE DATA EXISTS, THEN REPORT IT, THEN BUILD.** Three questions were
  answered against the real database before a line of the page was written, and two of them
  changed the design. Sessions ARE listable. The password-change consequence IS true, measured on
  a second device rather than read in documentation. Sign-in history is real but carries **no
  failures, no device and no location** — so the panel that was specified could not be built as
  specified, and saying so was the deliverable, not a blocker.
  **★ CORRECTED THE NEXT DAY (register rows D / 239): ASK IT OF THE DEPLOYMENT TARGET.** Every
  one of those three questions was put to the LOCAL database, and for sign-in history the local
  answer was a truthful yes — 62,568 audit rows. On the hosted project the same table holds 0 in
  total and is never written, so the panel built on it was permanently empty in production while
  passing every assertion here. It has been removed. A table this project's own migrations create
  exists wherever the migration ran; a table the PLATFORM populates (`auth.*`, `storage.*`,
  `cron.*`, `net.*`, `vault.*`) can be present on the target and never written. The check is a
  `count(*)` on the real project before building, and again after performing the event the panel
  would show. A thorough investigation of the wrong environment reads exactly like a thorough one.
- **★ A HEADING IS A CLAIM. "Recent sign-ins" over a successes-only list says nobody has failed
  to sign in.** The data cannot support that, so the panel is "Recent account activity" and the
  absence is stated in the panel itself: failed attempts are not recorded, and these entries
  carry no device and no location. Renaming was cheaper than fabricating and more honest than
  showing the list under a heading it cannot earn. (The panel is gone since 2026-09-17 — see the
  correction above — but the rule stands: the sessions panel that remains is headed for what it
  is, "Where you're signed in", and its note says what the list covers and what it does not.)
- **★ PUT A CLAIM ABOUT ABSENT DATA IN THE PAYLOAD, NOT ONLY IN THE COPY.**
  `failuresRecorded: false`, `devicesRecorded: false`, `locationsRecorded: false` travelled with
  the data, so the verification asserted them and would have failed the day the platform started
  recording either. A sentence in a page is a claim nobody re-checks; a field under test is one
  that expires loudly. (Those fields left with the panel; the same discipline is what the
  backend suite now applies to the raw RPC — it asserts the local table IS written and that a
  failed attempt still leaves nothing, so the local/hosted split itself is under test.)
- **NO CONTROL FOR SOMETHING THAT DOES NOT EXIST.** Two-factor is marked Planned with the real
  constraint named (Supabase MFA is a Pro-plan feature; a real enrolment returns 422
  `mfa_totp_enroll_not_enabled`) and carries no toggle, no button, no input — asserted absent, not
  merely unstyled. On a security page a switch that flips and does nothing reads as protection
  that is not there, which is worse than an honest gap. There is no display-name field either:
  nothing renders a PM's name to anyone, so it would be a setting with no effect.
- **★ STATE A CONSEQUENCE ONLY AFTER MEASURING IT — AND STATE ITS CAVEAT TOO.** "This signs you
  out everywhere else" is printed because two devices were signed in, the password changed on one,
  and the other's refresh genuinely failed. The same measurement produced the caveat the page also
  prints: a revoked device keeps working for up to an hour, until the access token it already
  holds expires. A comforting sentence without its caveat is a half-truth a PM would act on.
- **★ A CONTROL THE UI DOES NOT RENDER IS NOT A GUARANTEE — THE SERVER MUST REFUSE IT TOO.**
  The current session shows no Sign out, and `revoke-pm-session` refuses it 409 regardless. The
  same rule the approval gate's own re-validation follows (§13), applied to a destructive control
  rather than to money.
- **★ A FUNCTION THAT TAKES A USER ID IS SERVICE_ROLE-ONLY, AND THE TEST CALLS IT TO PROVE IT.**
  The four `SECURITY DEFINER` reads/writes over `auth.*` each take the user as an argument, so one
  reachable by `authenticated` would be a real privilege escalation — EXECUTE is revoked from
  `public`/`anon`/`authenticated`, and the suite CALLS each as a real client and as a real ADMIN
  rather than reading the GRANT, with a `service_role` control so four refusals cannot pass for
  the wrong reason (§V, the vacuity pattern).
- **A NON-BROWSER SESSION IS NAMED FOR WHAT IT IS.** "Unknown device · Unknown browser" for a
  `node` or `curl` session is accurate and useless, and on a security panel "unknown" invites
  alarm where the honest answer is mundane. Script clients are labelled; anything genuinely
  unrecognised still says Unknown.
- **The one-per-request cost of an external lookup is capped, and the cap degrades honestly.**
  Geolocation runs once per DISTINCT public IP, at most twelve per request; past that the location
  is `null`, which renders "Unknown location" — the same as a private address or a provider miss,
  never a guessed city.
- **Surfaces**: `.glass` + `.glass-lift` cards (this page's headings sit in the sheen corner —
  register row 204), secondary text `#475569`, and a quiet `.sec-note` block for every statement
  of fact a reader needs in order to trust what is above it. **Those notes are never dimmed**: on
  this page the caveats ARE the content (§6's rule, and row 233's 2.59:1).
- **A five-column table is a `mw-card-table`.** Row 172's pattern: on a phone the last two columns
  otherwise sit hundreds of pixels off-screen inside a scroll container nobody scrolls.
- **★ WHAT THE PAGE ALREADY DID SURVIVES THE REBUILD.** The client security-actions log was on
  this page and is the only reader of `getSecurityActionsLog()` anywhere in the project. Parts 5,
  6 and 7 each nearly orphaned something; the log is driven end to end in the suite rather than
  merely left in the markup, which is the difference between keeping it and assuming it still
  works.

---
