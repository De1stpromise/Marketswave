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
