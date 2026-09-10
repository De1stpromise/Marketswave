# Button and Control Audit — Marketswave

**Date:** 2026-09-10
**Scope:** every button, filter control, select, textarea, file input and date input across
all 38 pages — 12 public site, 10 client dashboard, 16 admin tool.
**Status:** audited, mapped, applied, and verified. This document is the record of what was
found and why each decision was made, so a future pass can check its findings against
reality rather than re-deriving them.

Companion documents: `MOBILE_AUDIT.md` (tap targets and narrow-viewport behaviour — its
44×44 floor is a hard constraint on everything below), `control-patterns.css` (the shipped
implementation), `scripts/verify-control-patterns.mjs` (the standing check).

---

## 1. Method

Source-derived, then browser-verified.

The inventory was built by extracting every `class` attribute value from every `<button>`,
`<select>`, `<input>`, `<textarea>` and `[role=button]` in all 38 pages and grouping by
exact string. Heights were computed from Tailwind's own padding and line-height scale
(`text-sm` = 14/20, `text-xs` = 12/16, `py-2` = 8px each side, `border` = 1px each side),
which is deterministic. Every figure quoted below was then **re-measured as a real rendered
box in a real browser** after the change — see §7.

**Totals found:** 268 buttons · 36 selects · 167 inputs · 19 textareas.

---

## 2. Finding 0 — the two named reference patterns were not the same pattern

The task specified the primary treatment as "navy gradient, 12px radius, 50–54px height,
light sweep on hover, directional icon shift" and named both `login.html` and `signup.html`
as its references. Those two references disagree:

| | `signup.html` `.signup-btn-next` | `login.html` `.gate-btn` |
|---|---|---|
| Height | 50px | **54px** |
| Background | **flat `var(--primary)`** | **`linear-gradient(135deg,#22485C,#152B3B)`** |
| Light sweep | **none** | `::before`, 40% width, `left:-50% → 110%` over .6s |
| Radius / weight | 12px / 600 | 12px / 600 |
| Icon shift | svg `translateX(2px)` | svg `translateX(3px)` |
| Shadow | `0 8px 20px rgba(27,58,75,.18)` | `0 14px 28px -12px …` + inset highlight |

The Get Access modal is a third thing again — `.access-option-row` is a bordered link row
with a border-colour hover, deliberately rebuilt as an opaque panel during the 2026-09-06
contrast audit, and not a button pattern at all.

**Resolved:** the gate button is the primary. It is the most recently designed, it is the
one the task's own description actually matches, and the sweep is its distinguishing
gesture. Signup's flat variant survives as `.mw-btn-flat` — same geometry, no gradient, no
sweep — for contexts with several primary-ish actions where a sweep on each would be noise.

---

## 3. Inventory

### 3.1 Public site (12 pages, custom CSS) — already substantially on-pattern

| Control | Before | Verdict |
|---|---|---|
| `.btn` (+`-primary`/`-outline`/`-white`/`-ghost`) | ≈52px, 8px radius, w600, 2px border | On-pattern; **radius was the only gap** |
| `.btn-sm` (the 8 Get Access triggers) | ≈45px | Header-bar sized, deliberately left |
| `.hero-btn-primary` | ≈58px, 12px, gradient, **no sweep** | **Sweep was missing** |
| `.form-group input/select/textarea` | ≈52px, 10px radius, 1.5px border, real focus ring | On-pattern; radius 10→12 |
| `.custom-select-trigger` | ≈52px, 10px, custom chevron | Already the target select pattern |
| `.nav-toggle` | 44×44 | Correct (fixed in MOBILE_AUDIT batch 1) |
| `.access-modal-close` | 44×44 | Correct (batch 2) |

The public site was **not** where the inconsistency lived. It needed a radius pass and one
missing sweep.

### 3.2 Client dashboard (10 pages, Tailwind navy) — the real gap

| Signature | Height | Count | Where |
|---|---|---|---|
| `flex-1 py-2.5 … bg-navy text-white text-sm font-medium` | 40px | 12 | Modal confirms |
| `flex-1`/`px-4 py-2.5 … border-slate-200 text-slate-600` | 42px | 11 | Modal cancels, backs |
| `px-4 py-2 … bg-navy` | 36px | 4 | Apply Filters, Upload Document |
| `px-4 py-2 … border` | 38px | 2 | Reset |
| `px-3 py-1.5 … text-xs` (border or navy) | 28–30px | ~10 | **Table row actions**, Request Change, Sign, Download, Remove |
| `category-tab` / `sell-mode-tab` / `np-term-mode-tab` | 28–36px | 8 | Tab groups |
| `notif-chip` | 28px, `rounded-full` | 3 | documents.html chips |
| `text-xs … hover:underline` | **no box at all** | 4 | Edit / Cancel / More info / Reset-to-current |
| Inputs, selects `px-4 py-2.5` | 42px | 61 | Everywhere |
| Filter selects `px-3 py-2` | 38px | 9 | documents / transactions filter bars |

Radius was `rounded-lg` (**8px**) throughout; weight was `font-medium` (**500**) throughout.

### 3.3 Admin tool (16 pages, slate/amber)

Structurally identical signature set with a different palette: `bg-slate-900` /
`bg-emerald-600` (approve) / `bg-red-600` (reject) / `border-slate-200` (cancel), amber
focus rings. 22 modal cancels at 42px, 17 approve/reject at 40px, 14 filter pills at
**24px**, 30 close glyphs.

### 3.4 The premise this audit had to correct

`MOBILE_AUDIT.md`'s S4 hypothesised "a single shared Tailwind sizing convention" to bump.
There is no such class. The 28–42px cluster comes from **~40 distinct repeated utility
strings** on unrelated elements across unrelated pages. The instinct that it was one
convention rather than N mistakes was right; the assumption that it was expressed as a
class was not.

---

## 4. The three tiers

Applying one 54px height everywhere is the failure mode the task itself warned about. A
`px-3 py-1.5` action lives **inside a table row**; taking it 28px → 54px adds ~26px to
every row on every Approval Gate page.

| Tier | Class | Height | Radius | Used for |
|---|---|---|---|---|
| **A** | `.mw-btn.mw-btn-primary` (client) / `.mw-btn-admin`, `.mw-btn-approve`, `.mw-btn-danger` (admin) | 54px | 12px | Committing actions: modal submits, Request Allocation, Apply Filters, Approve / Credit / Reject |
| **B** | `.mw-btn.mw-btn-secondary`, `.mw-btn-outline` | 54px | 12px | Cancel, Back, Reset, Download, Remove |
| **C** | `.mw-btn.mw-btn-sm` (+ `.mw-btn-pill`) | 40px | 10px / 999px | Table row actions, tabs, filter pills, notification chips, and the four naked text links that had no box at all |

Tier C is **not a new invented pattern** — it is Tier A/B's palette, border treatment and
states at a density a table row can carry, which is exactly the relationship `.btn-sm`
already has to `.btn` on the public site. Without it, either the sweep wrecks table layout
or ~35 controls get skipped and the inconsistency survives.

**Form controls** → `.mw-field`: 54px (`.mw-field-sm` 40px for filter bars), 12px radius,
1.5px `#D8D4CD`, `#FCFBF9` ground, real focus ring, and signup's own custom chevron
data-URI on selects, copied verbatim so the two families cannot drift.

**The admin palette is locked and stays locked.** Shape and behaviour converge; colour does
not. A standing assertion walks every `.mw-btn` on 11 admin pages and fails if any of them
paints one of the client tool's navy values.

---

## 5. Native controls — recommendation, and what was actually done

### 5.1 `<input type="date">` — 5 instances. **Styled, not replaced.**

*Achievable:* box height, radius, border, ground, focus ring, font — all inherit normally,
which is what `.mw-field` supplies.
*Not achievable cross-browser:* the picker indicator glyph
(`::-webkit-calendar-picker-indicator` is Chromium-only; Firefox renders its own and Safari
differs again) and the internal segment layout.

**Recommendation, taken:** style the box, accept the native indicator, build no custom date
component. The residual inconsistency is one small glyph, against a 38px→matched-height
gain. The indicator is given a hover opacity so it does not sit flush against the border.

### 5.2 `<input type="file">` — 4 visible instances. **Button half styled; component logged.**

`::file-selector-button` is standard in all three engines, so the button genuinely reaches
Tier C. Not stylable: the "No file chosen" text, the gap, filename truncation; and there is
no drag-and-drop or clear affordance.

**Recommendation, taken:** style `::file-selector-button`, build no custom component here.

**★ And the reason that is not just caution.** `signup.html` already has a custom file
control — `.upload-box`, a hidden input behind a click-through `<div>` with a filename
display. It is the project's existing precedent **and it is keyboard-inaccessible**: no
`tabindex`, no `role`, no keyboard activation handler, no `aria-describedby` for the
accepted formats. A keyboard-only or screen-reader user cannot upload a document through
the signup flow today. So the decision is not "reuse signup's pattern" — it is "build one
properly **and retrofit signup's**", which is a real component with real acceptance
criteria, not a styling change.

**Logged as Backend Requirements Register row 189.** The accessibility defect is live now
and is tracked there, not only here.

### 5.3 Floating labels — **deliberately not done in this sweep**

The box treatment landed on all 72 form controls. The floating **label** did not.

The `.fld` pattern requires each `<label>` to be its input's immediate next sibling plus
`placeholder=" "` on the input. Applying it means relocating 72 labels, several of them
inside JS template strings, where a wrong move silently breaks the `for`/`id` association a
screen reader depends on — with no visual symptom. That is the same category of
accessibility risk as §5.2, and it gets the same treatment: logged rather than folded into
a styling sweep. A half-converted state would also be worse than either uniform choice,
since mixed floating and above-label forms in one tool is a new inconsistency.

**Logged as Backend Requirements Register row 190.**

---

## 6. Leave-alone list — what was deliberately not touched, and why

| Element | Why |
|---|---|
| Core Services field (`.fpanel`), the seam artifacts, Resources `.res-list` / `.res-steps`, both returns tables (`.rt`) | Named as deliberate in the task |
| `.rm-segment` Risk Meter (risk-management.html) | Carries the project's locked gold/mahogany/deep-green one-off palette |
| `option-card`, `np-type-card`, `wd-method-card`, `np-funding-card` | Selection **cards** with `border-2` selected states, not buttons. Tier A on them would read as six competing primary actions |
| `request-row-toggle` | A full-width row disclosure, not a control |
| `#remove-confirm-submit` (documents.html) | **The press-and-hold delete button (register row 166).** Its 1200ms progress-fill overlay depends on its own `position:relative` + `overflow:hidden`; `.mw-btn-danger`'s sweep would fight the overlay. A genuine near-miss — asserted untouched |
| 30 modal/drawer close glyphs (`×`) | Glyph-only dismiss controls, already at 44×44 from MOBILE_AUDIT batch 2 |
| Checkboxes, radios, `sr-only peer` toggles | Their real target is the surrounding label, already handled |

---

## 7. What the sweep changed, and how it was verified

**Applied:** 314 exact-string class replacements across 26 Tailwind pages, plus a radius
pass and one missing sweep on the public site. New shared `control-patterns.css`, linked on
exactly the 26 pages that already load `tap-targets.css`.

**Plain CSS, not Tailwind utilities** — for the reason register row 165 established: the
Tailwind CDN emits *no CSS at all* for a utility it does not recognise and does not error,
which is how an admin button once shipped fully transparent. Plain CSS cannot fail that
way, and a gradient, a sweeping highlight and a directional icon shift are not expressible
as utility strings regardless.

**Tabs and pills converge on geometry only.** Their active state is toggled by JS —
`classList.add/remove('bg-navy','text-white')` in some places, a full `btn.className = '…'`
rebuild in others. The colour utilities the JS expects are left exactly where they are;
only the sizing classes change. Verified by real clicks, not by reading the JS.

### Verification — `scripts/verify-control-patterns.mjs`, **38/38**

Every assertion reads a **real computed or rendered box**, never "the class is present".
Every measurement is preceded by a viewport-integrity guard. 320px goes through a real
same-origin iframe, because the top-level override floors at 348px on this build.

- Tier geometry measured across 21 pages: 22 Tier A, 18 Tier B, 21 Tier C, 80 fields
  (client); 31 controls, 48 fields (admin).
- Modal contents are measured by temporarily revealing their hidden ancestors — without
  that, most of Tier A is `display:none` and the run reports a confident pass over 7 buttons.
- **0 controls under 44×44** across all 21 pages at 390px and 375px, and at a real 320px.
- No horizontal overflow at any width.
- Real clicks: category tabs toggle, the documents filter bar applies, the HYS New Pocket
  modal opens, term-mode tabs toggle, the custom select on contact.html still opens.
- The leave-alone list asserted **untouched**, including the press-and-hold button's
  containing block.

### Contrast — 64 real composited-pixel measurements, 0 below 4.5:1

Measured on 8 pages via `verify-contrast.mjs`'s new `controls` profile, **including hover**,
because `.mw-btn-secondary:hover` changes both the ground and the text and a rest-state-only
check would never have seen it.

**Three real findings:**

1. **White on emerald-600 is 3.77:1.** Every Approve / Credit button in the admin tool had
   been shipping below the floor long before this sweep, and the new gradient carried that
   exact colour as its light stop. The ramp is now emerald-700 → emerald-800 (5.48:1 →
   7.68:1). A standing assertion now checks **both ends of every Tier A gradient** against
   its own white label, so this cannot be lightened back silently.
2. **The red notification chip** (`text-red-600` on `bg-red-50`) measured 4.41:1 at rest and
   3.95:1 on hover. Colours byte-identical on clean HEAD — pre-existing, but this sweep
   touched the element, so it is in scope. Now `text-red-700`.
3. **A harness bug, fixed:** the `controls` profile measured one button under two labels and
   returned 7.44:1 and 4.1:1 for the *same element in the same run* — the second sample
   caught an antialiased edge pixel. Selectors are now mutually exclusive. Left in, it would
   have shipped as a permanent false failure.

Also added: `CONTRAST_PREPARE_JS`, a post-settle hook, because deploy-capital's controls
only exist once a form panel has been opened and the run otherwise reports a confident zero.

### Regression

`verify-tailwind-color-scoping` PASS. Full suite re-run per the warm-up convention. Fonts
were not touched (`.mw-btn` uses `font-family: inherit`).

---

## 8. Still open

| # | Item | Register row |
|---|---|---|
| 1 | Custom file-input component — **and the live keyboard-accessibility defect in signup.html's existing `.upload-box`** | 189 |
| 2 | Floating-label conversion for the 72 dashboard/admin form controls | 190 |
| 3 | Contrast coverage gap: `deploy-capital.html` and `admin-deposits.html` reported zero visible controls in their default state (panels hidden / queue empty). Their controls use recipes measured elsewhere, but they have not been measured *on those pages* | — |
