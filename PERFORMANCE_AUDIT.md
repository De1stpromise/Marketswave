# Performance Audit — app-feel programme, stage 1

**Date**: 2026-09-21 · **Scope**: the live site (marketswave.net, GitHub Pages) against real cloud
staging · **Report-only** — nothing was fixed; every number here is the baseline the later stages
are diffed against. Register row 257. Companion to `MOBILE_AUDIT.md` and `BUTTON_AUDIT.md`.

**Re-run**: `node audit-performance.mjs` from `scripts/` (about 30 minutes; writes
`scripts/.pass-logs/perf/<stamp>.json`). This report was produced from
`2026-09-21T12-16-31-319Z.json`, with `settings.html` re-measured at `13-0x` after a harness fix
(§7). Diff the JSON, not this prose.

---

## 1. The findings, ranked

The programme's own hypothesis — that `.glass` and `backdrop-filter` are the expensive thing across
38 pages — is **not what the measurements show**. Glass is at the frame-rate floor on every shipped
page and only becomes a cost past roughly a hundred simultaneously blurred layers (§6). What the
logged-in platform actually pays for, in order:

| # | Finding | Surface | Severity | Owner stage |
|---|---|---|---|---|
| 1 | **A page's data cannot start loading until ~2 s after its shell has painted**, because the Supabase SDK is a 17-request module graph from esm.sh that begins downloading only once the page's own script runs a dynamic `import()`. On `dashboard.html` the shell paints at 2.0 s, the last SDK module lands at ~4.1 s, and all 14 backend calls fire together at 4.16 s. Every logged-in page pays this on an empty cache; every navigation re-evaluates the 17 modules from cache. | client + PM | **High** | Stage 2 (a persistent shell keeps one SDK instance alive); independently a single self-hosted bundle |
| 2 | **Every navigation re-fetches the shell's own data.** On the client, 8–16 of a page's 10–25 backend calls are calls the previous page made seconds earlier — the notification bell's five domains, the sidebar's documents badge, the full `products` table — on every hop. On the PM tool it is 9 of every hop's calls: the sidebar's approvals/inbox/presence watchers re-count nine tables on every page. | client + PM | **High** | Stage 2 (shared data survives the page change) |
| 3 | **The logged-in platform is usable at 3.3–7.0 s on a warm backend (median per page), 4–13 s cold.** The public site is usable at 0.8–1.1 s. The gap is the app-feel gap in one number. Backend calls themselves cost 0.9–1.9 s per Edge Function warm and 2–8 s cold (`get-client-profile` 7.8 s cold, `get-client-list` 4.4 s); they run in parallel, so a page's data phase is its single slowest function plus the SDK wait in front of it. | client + PM | **High** | Stages 2–3 hide it; the functions' own latency is separate work |
| 4 | **The Tailwind play-CDN is a 124 KB render-blocking script on every logged-in page**, it compiles the page's CSS on the main thread on every load, and its latency is the largest single source of variance observed: 346 ms on one load, **10,975 ms** on another of the same page (a 14.5 s first paint). | client + PM (26 pages) | High | Stage 2 keeps it alive across navigations; a build-time stylesheet removes it entirely |
| 5 | **`engine-core.js` — 197 KB, 52 KB gzipped, 3,460 lines — is loaded by 23 pages**, including every login-gate page; of its 102 exported globals, 56 are referenced anywhere outside it; its own IIFE runs localStorage seeding and migrations on every load. It is the largest first-party script on every page that carries it. | client + login + 9 PM pages | Medium | Stage 2 loads it once; a trim is independent |
| 6 | **Every REST call is two round trips on an empty cache** — a CORS preflight (`OPTIONS`, ~230 ms) then the request — because the SDK's `apikey`/`Authorization` headers force one. 10–28 preflights per page load. The browser caches the preflight per URL, so warm navigations pay 0–6. | client + PM | Medium | Independent of the programme (same-origin proxy or a longer `Access-Control-Max-Age`); stage 2 reduces the calls that need one |
| 7 | **Four client pages download the entire product catalog** — `products?select=*`, 328 rows with descriptions, 36 KB — to group holdings by asset class (`dashboard`, `asset-performance`, `transactions`, `risk-management`). | client | Medium | Stage 2 (shared, fetched once); a narrower select is independent |
| 8 | **The PM shell keeps every admin page issuing count queries for as long as it is open**: nine `select=id&status=eq.pending` queries per recount, recounts triggered by Realtime events (each heartbeat from any visitor's browser re-counts presence on every open PM tab), and the presence count is issued twice on pages with their own presence panel. 41 REST calls in 45 s observed on `admin-inbox.html` sitting idle. | PM | Medium | Stage 2 (one watcher in the shell); the recount fan-out is independent |
| 9 | **The PM shell paints 2.5–3.9 s after navigation on an empty cache, versus 1.3–2.6 s for the client shell**, because the sidebar's render is gated on the async session check, which cannot run until the SDK (finding 1) has loaded. With a warm cache both shells paint 370–630 ms after the HTML arrives. | PM | Medium | Stage 2 |
| 10 | **`index.html` is 1.9 MB on desktop** — 1,434 KB of `different.webm`, 210 KB photo, 74 KB poster — against 120–180 KB for every other marketing page. Fetched only above 900 px with motion allowed (row 173's design), and it does not delay first paint (0.8 s). | public | Low | None — recorded as the baseline |
| 11 | **Glass is not the cost** (§6). Every shipped page scrolls at the 20 ms rAF floor with `backdrop-filter` on; removing the blur while keeping the rest of the recipe makes `dashboard.html` *worse* (20 → 38 ms/frame, 0 → 67 dropped frames) because the blur is what promotes each card to its own compositor layer. The blur becomes measurable only at 247 simultaneous layers (+15 ms/frame over the layered-no-blur control). | all | Info | The row-211 page-size decision stands and is now explained |
| 12 | Login/signup carry the SDK graph and `engine-core.js` too — 460–530 KB against 120–180 KB for the marketing pages beside them. | public (auth) | Low | Stage 2's shell; independent trim |

Sizes and shapes that explain the numbers above, measured from the repository rather than the
browser (gzip = as GitHub Pages serves it):

| Asset | Raw KB | Gzip KB | Lines | Loaded by |
|---|---:|---:|---:|---|
| `engine-core.js` | 196.8 | 52.6 | 3,460 | 23 pages |
| `styles.css` | 146.8 | 39.2 | 3,897 | public site |
| `portfolio-overview.js` | 36.1 | 11.5 | 669 | dashboard |
| `supabase-data.js` | 33.5 | 11.4 | 586 | every logged-in page |
| `dashboard-sidebar.js` | 32.3 | 11.4 | 480 | 10 client pages |
| `control-patterns.css` | 31.1 | 10.3 | 714 | 26 pages |
| `admin-sidebar.js` | 27.2 | 9.1 | 411 | 17 PM pages |
| `dashboard-notifications.js` | 22.9 | 8.0 | 431 | 10 client pages |
| `glass-primitives.css` | 20.0 | 7.8 | 330 | 26 pages |
| Tailwind play-CDN (`cdn.tailwindcss.com/3.4.17`) | — | 124 | — | 26 pages, render-blocking |
| `@supabase/supabase-js` via esm.sh | — | 102 (17 requests) | — | every logged-in page, dynamic import |
| Chart.js 4.4.0 (jsdelivr) | — | 69 | — | dashboard, transactions |
| Motion 13.2.0 (jsdelivr) | — | 47 | — | ~15 pages |
| Inter (Google Fonts, CSS + one woff2) | — | 48 | — | every page |

Per page: 13 `<script src>` tags and 5–11 stylesheets on a client page, 4–9 scripts and 6 stylesheets on
a PM page; 30–57 KB of inline script per client page (`dashboard.html` 57 KB, `admin-inbox.html` 50 KB).

---

## 1.5 Stage 1.5 — the two foundational fixes, measured one at a time

### Fix 1 — the SDK is one self-hosted, preloaded bundle (2026-09-21, row 258)

`vendor/supabase-js-2.112.4.min.js` (216 KB raw, 57 KB gzip, one request, zero external imports),
built once by `scripts/vendor-supabase-js.mjs` from the exact SDK version in `scripts/node_modules`,
`modulepreload`ed from every SDK-reaching page's `<head>` beside the stylesheets. The three import
sites repointed; nothing else about how a page uses the client changed. Measured with the same
harness two and a half hours after the baseline (`npm run audit-performance-diff` between the two
runs; warm-pass medians, three samples):

| | Data-ready (median of pages) | Shell | FCP | Weight | Requests | SDK requests |
|---|---:|---:|---:|---:|---:|---:|
| Client (11 pages) | **5.0 → 3.1 s** | 1.8 → 1.6 s | 1.8 → 1.6 s | 540 → 498 KB | 65 → 49 | 17 → 1 |
| PM tool (12 pages) | **3.9 → 3.0 s** | **3.1 → 1.6 s** | 1.3 → 1.6 s | 407 → 367 KB | 59 → 43 | 17 → 1 |
| Public (11 pages, control) | 1.0 → 1.4 s | — | 1.0 → 1.3 s | 177 → 176 KB | 15 → 14 | 0 → 0 |

Every one of the 23 logged-in pages got faster to real data, by 0.3–2.8 s (`asset-performance`
6.6 → 3.8, `high-yield-savings` 6.9 → 4.1, `settings` 5.4 → 2.8, `admin-clients` 6.4 → 4.1). The PM
shell — gated on the session check, which waits for the SDK — halved (3.1 → 1.6 s), which is
finding #9 closing as a side effect. The `dashboard.html` anatomy in §4 now reads: shell 2.0 s,
first backend call **~2.3 s** (was 4.16), usable 4.7 s (was 6.5).

**The control matters.** The public pages, which never load the SDK, came out 0.3–1.0 s *slower*
in the after-run — the live site was simply slower at 15:00Z than at 12:20Z. So the client and PM
gains above are measured against a headwind of roughly half a second and are, if anything,
understated. This is why the audit keeps a surface that a fix cannot touch.

**Navigation** barely moves, as expected — the SDK was already in the HTTP cache on every hop:
client median usable 2.84 → 2.34 s and shell repaint 561 → 392 ms (17 fewer cached modules to
re-evaluate per hop); the PM hops read 0.3–2 s slower, entirely inside the run-to-run variance the
public control shows and dominated by backend calls the fix does not touch. Finding #2 is
untouched by design — it is stage 2's.

`scripts/audit-performance-diff.mjs` is the tool for this comparison from here on.

### Fix 2 — the Tailwind play CDN is a compiled static sheet (2026-09-21, row 260)

`tailwind-3.4.17.css` (32 KB, 6.5 KB gzip) compiled once by `scripts/build-tailwind.mjs` from
`scripts/tailwind/` with `tailwindcss@3.4.17` pinned as a devDependency, linked as the **last**
stylesheet in every one of the 24 pages' `<head>` — the position the play CDN's asynchronously
appended `<style>` occupied (measured live), so utilities keep winning every equal-specificity
contest. The eleven inline `tailwind.config` blocks are gone. Completeness was proved two ways
before any page was switched: every selector the live CDN generated on all 24 signed-in pages
(382 of 382) exists in the compiled sheet, and a rendered before/after on identical local data
(`scripts/audit-render-diff.mjs`, 48 comparisons at 1440 and 390) was pixel-identical outside
chart canvases and clocks. The staleness guard lives in `verify-tailwind-color-scoping` and was
proven with three forced-failure controls (an uncompiled class, a dropped link, a mis-ordered link).

### Both fixes together — the combined measurement

Same harness, same baseline run, about nine hours later; the public control moved only
+0.1–0.3 s this time, so the environment was comparable.

| | Data-ready (median of pages) | Shell | FCP | Weight | Requests |
|---|---:|---:|---:|---:|---:|
| Client (11 pages) | **5.0 → 2.4 s** | **1.8 → 1.0 s** | **1.8 → 1.1 s** | 540 → 380 KB | 65 → 49 |
| PM tool (12 pages) | **3.9 → 2.7 s** | **3.1 → 1.0 s** | 1.3 → 1.2 s | 407 → 222 KB | 59 → 42 |
| Public (control) | 1.0 → 1.1 s | — | 1.0 → 1.2 s | 177 → 174 KB | 15 → 14 |

Per page, every client page reaches real data 1.4–3.6 s sooner than the baseline (`transactions`
5.6 → 2.5, `settings` 5.4 → 2.0, `asset-performance` 6.6 → 3.0, `dashboard` 6.5 → 3.9) and every
PM page 1.2–2.9 s sooner; the PM shell is 1.7–2.8 s sooner on every page. Fix 2's own share, read
against the fix-1 run: client data-ready 3.1 → 2.4 s, shell 1.6 → 1.0 s, FCP 1.6 → 1.1 s, and
**−118 KB per page** (the 124 KB script replaced by a 6.5 KB sheet, and no per-load JIT); PM FCP
1.6 → 1.2 s. **The PM-FCP question from the fix-1 report is answered**: with the CDN gone, first
paint is below the stage-1 baseline on 9 of 12 PM pages (−0.1 to −0.4 s) and level on `admin.html`
— the fix-1 run's +0.3 s was the environment, not the preload links competing with paint.

**Three PM pages are not in that table**: `admin-client-profile`, `admin-presence` and
`admin-products` hit a DNS drop during the warm pass (`net::ERR_NAME_NOT_RESOLVED`, each load
landing on `chrome-error://` after 24.1 s — row 222's flap). The harness now reports such a load as
**UNREACHABLE** rather than as a time, and the diff tool skips it. Their cold-pass loads minutes
earlier were clean: 13.0 → 5.1 s, 8.1 → 2.5 s, 9.4 → 2.5 s. A later re-measurement fell in a
visibly degraded window (a page that did FCP 1.4 s at baseline read 4.0 s) and is not cited.

**Navigation**: client hops median usable 2.84 → 1.67 s. On the PM tool the last six hops show
what the compiled sheet does to a warm-cache navigation — **shell repaint 83–138 ms** against
373–498 ms at baseline (no Tailwind JIT to re-run per page) — while the first three hops ran in the
same network-recovery window and read slower; read the six, not the median.

**What the full suite found that the pixel diff could not** (rows 261–263): a real pre-existing
defect on `admin-products.html` — its filter pills carried `min-height: 0`, sat at 32 px on every
phone since row 236, and were invisible to the control sweep because that page used to render them
*after* the sweep looked; the faster page exposed it (row 253's async blind spot, exactly). A
1.35 px chart-dot deviation in `verify-portfolio-overview-visual` was chased as a possible
container-rounding change and passed in isolation — it had run inside an edge-runtime restart
window. Every other non-green suite in the 117-suite pass traced to the runtime restart (row 255,
now with one more self-inflicted trigger fixed), provider availability, leftover test data or the
price-state race class (row 263) — none to the stylesheet.

---

## 2. Method

**Harness**: `scripts/audit-performance.mjs` — a real headless Chrome (1440×900) driven over the
Chrome DevTools Protocol, the same technique every visual suite in this project uses. Three browser
profiles (client, PM, public), each launched once and kept for the whole run so `localStorage` /
`sessionStorage` behave exactly as one real tab's would.

**Sessions**: the client is the seeded fixture client (`scripts/lib/fixture-client.mjs`), with his real
staging session obtained through an admin magic link (`generateLink` → `verifyOtp`) — never by changing
his password. The PM is a throwaway additional staging PM account created for the run and deleted
afterwards, `user_roles` and `pm_visits` rows included. Both sessions are placed into the browser the
way the real login pages leave them: the SDK's own `localStorage` key, the two `sessionStorage` ids,
and the local client mirror `login.html` writes.

**What each column means**

- **Weight** — bytes on the wire from CDP `Network.loadingFinished`, cross-origin included (the
  Performance API's `transferSize` is 0 for a cross-origin resource without `Timing-Allow-Origin`, which
  is most of them here). `data:` URIs excluded. Cached responses count 0.
- **Requests** — every network request, with CORS preflights counted separately.
- **FCP** — first contentful paint, from the Paint Timing API.
- **Shell** — the first moment `#sidebar-mount` / `#admin-sidebar-mount` has children: the shared
  sidebar has painted. The public site has no shell.
- **Data-ready** — the last moment the count of *visible* `.animate-pulse` skeletons returns to zero;
  the one shared skeleton vocabulary every wired page uses (row 146). For a page that paints no skeleton
  (marked ᵃ) it is the end of the initial burst of backend responses — the last response before the
  first idle second after `DOMContentLoaded`, which is what separates a page's own load from the
  shell's continuous polling (finding 8). For a public page with no backend it is `DOMContentLoaded`.
- **Backend calls** — Edge Function invocations + PostgREST reads + Storage reads, excluding the
  presence beacon (`track-visit`, `keepalive`, never waited on by the page) and Realtime (a websocket).
- **Longest function** — the slowest single Edge Function invocation on that load, warm median / cold.
- **Script ms** — the renderer's own `ScriptDuration` for the load, as a delta from the navigation.

**Passes**. Every page is loaded with the HTTP cache **disabled** — a first visit. The **cold** pass
is one sample in which each Edge Function's first invocation of the run pays its isolate cold start.
The **warm** pass is three samples per page with functions warm; the sample whose data-ready is the
median is reported and the min–max of every timing is kept. The **navigation** sequences run with the
cache **enabled** after one warm-up load, clicking the real sidebar links in the real locked order, so
they measure exactly what a client clicking through the sidebar experiences today. The **glass** runs
park the other two browsers on `about:blank` first (§7).

**The cold-start caveat the brief asked for, answered**: hosted Edge Functions cold-start per isolate,
not per container, so "warm" here means each function had been invoked at least once in the preceding
minutes. Every warm figure in the tables is a warm-backend figure. The cold column is the same page's
single cold sample, and the "longest function" cell shows both. The pre-run pre-load (one visit per
surface to establish storage) is not counted anywhere.

**Variance**. This is the live site over the real internet, and the spread matters as much as the
median. The same page measured three times within a minute ranged 4.4–8.6 s (`asset-collection`),
5.8–10.6 s (`high-yield-savings`), 5.0–9.8 s (`admin.html`). One `cdn.tailwindcss.com` fetch took
10,975 ms against a typical 350 ms. A later spot re-measurement at a slower network moment put
`settings.html` at 6.1–11.9 s. Read every figure with its range.

---

## 3. Baseline — per page

### Client dashboard family

| Page | Weight KB | Requests (of which preflights) | FCP s | Shell s | Data-ready s (warm median, min–max) | Cold data-ready s | Backend calls (fn + REST + storage) | Longest function on load (warm / cold) | Script ms |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| dashboard.html | 655 | 78 (14) | 2.1 | 2.0 | 6.5 (6.3–7.0) | 10.0 | 18 (4 + 9 + 5) | get-portfolio-overview 1.9 / 1.6 | 484 |
| asset-performance.html | 633 | 85 (17) | 2.7 | 2.6 | 6.6 (5.5–7.0) | 12.3 | 25 (5 + 11 + 9) | get-portfolio-overview 1.9 / 2.9 | 239 |
| asset-collection.html | 636 | 89 (13) | 1.8 | 1.8 | 4.6 (4.4–8.6) | 11.9 | 36 (3 + 9 + 24) | get-account-state 1.1 / 1.2 | 116 |
| transactions.html | 624 | 68 (14) | 1.9 | 1.8 | 5.6 (5.6–7.7) | 9.8 | 13 (3 + 10 + 0) | get-account-state 1.4 / 1.2 | 279 |
| high-yield-savings.html | 514 | 64 (14) | 1.9 | 2.0 | 6.9 (5.8–10.6) | 7.1 | 13 (2 + 11 + 0) | get-account-state 1.8 / 1.1 | 177 |
| documents.html | 518 | 61 (11) | 1.6 | 1.6 | 3.9 (3.8–4.3) | 4.4 | 10 (0 + 10 + 0) | — | 143 |
| risk-management.html | 540 | 62 (13) | 1.5 | 1.6 | 4.3 (4.2–5.2) | 5.5 | 12 (3 + 9 + 0) | get-holdings 1.2 / 2.0 | 127 |
| deploy-capital.html | 519 | 65 (14) | 2.2 | 2.2 | 5.0 (4.1–8.5) | 5.7 | 13 (1 + 12 + 0) | get-account-state 1.2 / 0.9 | 168 |
| settings.html | 527 | 69 (15) | 1.5 | 2.0 | 5.4 (3.5–6.9) ᵃ | 7.6 | 12 (0 + 12 + 0) | — | 397 |
| support.html | 509 | 61 (12) | 1.3 | 1.3 | 3.3 (3.2–3.7) | 5.2 | 11 (0 + 11 + 0) | — | 105 |
| fund-document.html?product=… | 586 | 63 (10) | 1.3 | 1.3 | 4.1 (3.7–4.5) | 4.0 | 9 (1 + 8 + 0) | — | 86 |

### PM tool

| Page | Weight KB | Requests (of which preflights) | FCP s | Shell s | Data-ready s (warm median, min–max) | Cold data-ready s | Backend calls (fn + REST + storage) | Longest function on load (warm / cold) | Script ms |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| admin.html | 340 | 76 (23) | 1.5 | 3.4 | 6.4 (5.0–9.8) | 5.3 | 23 (1 + 22 + 0) | get-pm-briefing 2.8 / 2.7 | 155 |
| admin-approvals.html | 468 | 91 (28) | 1.4 | 3.2 | 3.9 (3.7–6.3) | 3.7 | 28 (0 + 28 + 0) | — | 62 |
| admin-inbox.html | 407 | 57 (13) | 1.6 | 3.4 | 4.4 (3.8–5.4) ᵃ | 5.3 | 13 (0 + 13 + 0) | — | 96 |
| admin-clients.html | 405 | 59 (12) | 1.3 | 3.9 | 6.4 (5.7–8.8) | 8.8 | 12 (2 + 10 + 0) | get-client-list 2.5 / 4.4 | 70 |
| admin-client-profile.html?client=… | 472 | 69 (12) | 1.4 | 3.3 | 7.0 (6.6–7.7) | 13.0 | 20 (2 + 10 + 8) | get-client-profile 2.3 / 7.8 | 89 |
| admin-presence.html | 412 | 54 (11) | 1.5 | 2.9 | 3.9 (3.8–5.7) ᵃ | 8.1 | 11 (1 + 10 + 0) | get-visitor-presence 1.0 / 3.2 | 60 |
| admin-products.html | 560 | 95 (11) | 1.2 | 2.6 | 3.9 (3.8–4.1) | 9.4 | 50 (1 + 10 + 39) | get-product-catalog 1.2 / 3.2 | 48 |
| admin-fund-document.html?product=… | 474 | 58 (11) | 1.2 | 2.8 | 3.9 (3.6–4.2) ᵃ | 5.4 | 11 (1 + 10 + 0) | get-product-document 1.0 / 1.0 | 82 |
| admin-deposit-addresses.html | 355 | 56 (11) | 1.0 | 2.5 | 3.9 (3.3–4.1) | 3.9 | 11 (1 + 10 + 0) | get-deposit-address-book 1.3 / 1.1 | 40 |
| admin-documents.html | 355 | 62 (14) | 1.2 | 2.9 | 3.4 (3.3–4.4) | 3.5 | 14 (0 + 14 + 0) | — | 49 |
| admin-advisory-fee.html | 383 | 52 (11) | 1.2 | 3.1 | 3.5 (3.4–3.6) | 8.9 | 11 (0 + 11 + 0) | — | 44 |
| admin-security.html | 402 | 58 (12) | 1.3 | 2.8 | 4.0 (3.7–4.2) ᵃ | 11.5 | 12 (1 + 11 + 0) | get-account-security 1.2 / 1.1 | 54 |

### Public site

| Page | Weight KB | Requests (of which preflights) | FCP s | Shell s | Data-ready s (warm median, min–max) | Cold data-ready s | Backend calls (fn + REST + storage) | Longest function on load (warm / cold) | Script ms |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| index.html | 1925 | 22 (2) | 0.8 | — | 2.5 (2.4–5.7) ᵃ | 3.1 | 1 (1 + 0 + 0) | — | 70 |
| services.html | 177 | 15 (1) | 0.9 | — | 0.9 (0.9–1.0) ᵃ | 1.4 | 0 (0 + 0 + 0) | — | 22 |
| resources.html | 180 | 15 (1) | 0.9 | — | 0.9 (0.9–1.1) ᵃ | 1.4 | 0 (0 + 0 + 0) | — | 33 |
| about.html | 174 | 14 (1) | 0.8 | — | 0.8 (0.7–1.1) ᵃ | 1.8 | 0 (0 + 0 + 0) | — | 22 |
| contact.html | 122 | 12 (1) | 1.1 | — | 0.9 (0.9–1.0) ᵃ | 1.4 | 0 (0 + 0 + 0) | — | 10 |
| legal.html | 124 | 12 (1) | 1.1 | — | 1.0 (0.8–1.0) ᵃ | 1.3 | 0 (0 + 0 + 0) | — | 7 |
| help-center.html | 120 | 12 (1) | 0.9 | — | 0.8 (0.8–1.0) ᵃ | 1.2 | 0 (0 + 0 + 0) | — | 5 |
| blog-press.html | 120 | 12 (1) | 1.1 | — | 1.0 (0.9–1.0) ᵃ | 1.2 | 0 (0 + 0 + 0) | — | 5 |
| login.html | 460 | 34 (1) | 1.1 | — | 2.7 (2.3–3.4) ᵃ | 3.8 | 0 (0 + 0 + 0) | — | 83 |
| signup.html | 529 | 37 (1) | 1.0 | — | 2.4 (2.2–2.5) ᵃ | 2.7 | 0 (0 + 0 + 0) | — | 32 |
| admin-login.html | 305 | 25 (0) | 1.2 | — | 2.6 (2.4–3.8) ᵃ | 4.6 | 0 (0 + 0 + 0) | — | 32 |

ᵃ Data-ready is the initial backend burst / `DOMContentLoaded`, not a skeleton, on that page.
`settings.html` in the main run is the burst figure; re-measured after the harness fix in §7 it is
**6.5 s (6.1–11.9) by skeleton**, at a slower network moment. `fund-document.html` for a product
with no published document logs one console 404 from `get-product-document` — expected, the page
renders its honest empty state.

**Reading the client table.** The shell paints at 1.3–2.7 s and the page is usable at 3.3–7.0 s: on
every page at least half the wait comes *after* the shell, and that half is §4's SDK gap plus the
slowest backend call. Weight is 510–655 KB, of which the same ~390 KB (Tailwind 124, esm.sh 102, fonts
48, `engine-core.js` 54, the shared CSS/JS ~60) is identical on every page — a first visit pays it, a
navigation re-parses it.

**Reading the PM table.** First paint is *faster* than the client's (1.0–1.6 s — no Chart.js, no
Motion, lighter pages) but the shell paints *later* (2.5–3.9 s): the sidebar is gated on the async
session check, which waits for the SDK. `admin-approvals.html` makes 28 REST calls on load (7 queue
tables + 9 sidebar counts, each preflighted); `admin-products.html` makes 50 backend calls, 39 of
them logo images.

**Reading the public table.** 120–180 KB, 12–15 requests, first paint under 1.1 s, no backend on the
critical path — the reference point for "what a fast page on this host feels like". `index.html` is
the exception at 1.9 MB (finding 10). `login.html`/`signup.html`/`admin-login.html` are 305–530 KB
because they carry the SDK graph and (login/signup) `engine-core.js`.

---

## 4. The anatomy of one page load — `dashboard.html`, warm backend, empty cache

Milliseconds from navigation start, from the median warm sample:

| t | What |
|---:|---|
| 398 | HTML response (23 KB) |
| ~400–2,000 | 11 stylesheets, 13 scripts, Tailwind play-CDN (124 KB, render-blocking, then JIT-compiles the page's CSS), Chart.js, Motion, fonts |
| 1,606 | first skeleton appears |
| 1,966 | **shell painted** (sidebar mounted) |
| 2,052 | first contentful paint |
| 2,609 | `load` |
| ~2,600–4,100 | **the SDK**: `supabase-data.js` dynamic-imports `supabase-config.js`, which imports `https://esm.sh/@supabase/supabase-js@2.112.4` — 17 module requests (102 KB) resolved as a dependency waterfall, 220–560 ms each, three to four levels deep. Nothing else happens. |
| 4,156–4,222 | **all 14 backend calls fire at once**: `get-portfolio-overview` (1,949 ms), `get-returns-summary` (1,235), `get-transaction-ledger` (928), `get-watchlist` (1,095), plus 9 PostgREST reads (~500 ms each incl. preflight — `products?select=*` alone 37 KB) and `track-visit` |
| 6,460 | **data-ready** — the last skeleton leaves |

So: 0.4 s to get the HTML, 1.6 s to paint the shell, **2.1 s of SDK waterfall with nothing on screen
changing**, then 2.3 s for the slowest function. The SDK gap is the largest single block the programme
can remove without touching a backend function; the function latency is the largest it cannot.

---

## 5. Metric 6 — the cost of a navigation today

What stage 2 is judged against. Each row is a real click on the real sidebar link, in one tab, with
every static asset already in the HTTP cache from the previous page.

**Client — every hop is a real sidebar click, HTTP cache warm**

| From → to | HTML ms | Shell painted ms | FCP ms | Usable ms | Bytes from network KB | Requests: network / cache | Backend calls | …repeating the previous page | Main-thread ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| dashboard → asset-performance | 260 | 846 | 932 | 3273 | 89 | 27 / 47 | 25 | 16 | 1341 |
| asset-performance → high-yield-savings | 19 | 421 | 432 | 2837 | 45 | 15 / 36 | 13 | 10 | 871 |
| high-yield-savings → transactions | 280 | 816 | 900 | 4572 | 82 | 19 / 39 | 13 | 10 | 1676 |
| transactions → documents | 35 | 569 | 508 | 1936 | 42 | 11 / 39 | 10 | 9 | 880 |
| documents → risk-management | 26 | 400 | 444 | 3317 | 80 | 15 / 36 | 12 | 9 | 826 |
| risk-management → deploy-capital | 34 | 561 | 552 | 2179 | 45 | 16 / 37 | 13 | 9 | 1024 |
| deploy-capital → settings | 21 | 460 | 484 | 1242 | 46 | 18 / 38 | 12 | 8 | 1622 |
| settings → support | 20 | 483 | 424 | 1515 | 44 | 15 / 35 | 11 | 11 | 756 |

**PM tool — every hop is a real sidebar click, HTTP cache warm**

| From → to | HTML ms | Shell painted ms | FCP ms | Usable ms | Bytes from network KB | Requests: network / cache | Backend calls | …repeating the previous page | Main-thread ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| admin → admin-approvals | 24 | 521 | 432 | 844 | 58 | 27 / 35 | 26 | 9 | 708 |
| admin-approvals → admin-inbox | 23 | 430 | 416 | 1075 | 7 | 15 / 31 | 13 | 9 | 620 |
| admin-inbox → admin-clients | 20 | 376 | 332 | 2269 | 3 | 15 / 35 | 12 | 9 | 594 |
| admin-clients → admin-presence | 60 | 634 | 648 | 3380 | 39 | 16 / 32 | 13 | 9 | 942 |
| admin-presence → admin-products | 23 | 447 | 368 | 1479 | 42 | 13 / 73 | 50 | 9 | 734 |
| admin-products → admin-deposit-addresses | 24 | 373 | 304 | 1191 | 4 | 13 / 34 | 11 | 9 | 593 |
| admin-deposit-addresses → admin-documents | 24 | 391 | 336 | 949 | 4 | 15 / 34 | 14 | 9 | 542 |
| admin-documents → admin-advisory-fee | 20 | 498 | 452 | 746 | 1 | 13 / 29 | 11 | 9 | 472 |
| admin-advisory-fee → admin-security | 20 | 414 | 428 | 1414 | 3 | 14 / 34 | 12 | 9 | 659 |

**What is discarded and redone on every hop**, from the client table:

- **The shell repaint**: 370–850 ms from the HTML arriving to the sidebar being on screen again
  (median ~470 ms client, ~430 ms PM). In that window the browser re-parses 33–47 cached resources —
  the Tailwind play-CDN script *re-runs its JIT compile of the page*, `engine-core.js` re-runs its
  seeding IIFE, the 17 SDK modules are re-evaluated and a new SDK client instantiated, the sidebar,
  the notification bell and the chat widget are rebuilt from scratch.
- **The session check**: zero network cost on every hop measured (the token was valid; no
  `/auth/v1/token` refresh occurred in either sequence) — but on the PM tool it is on the critical
  path of the shell paint (finding 9).
- **The data the previous page already had**: 8–16 of every client hop's 10–25 backend calls
  repeat the previous page's — `documents` ×2, `allocation_requests`, `sell_requests`,
  `hys_pockets`, `conversations`, `messages` (the bell's five domains + the badge), `products` (the
  whole catalog), and on the money pages `get-account-state` / `get-returns-summary` /
  `get-portfolio-overview`. On the PM tool it is the same 9 count queries on every one of the nine
  hops. **Between a third and all of a page's backend traffic is the shell re-fetching what it
  already knew.**
- **What is genuinely new per hop**: the HTML (20–280 ms), 0–4 page-specific files, and the page's
  own 1–5 Edge Function calls — the part a soft navigation keeps.
- **Bytes**: 42–89 KB from the network per client hop (mostly the backend responses; the
  `products` catalog is 37 KB of it), 1–58 KB per PM hop.
- **Usable**: 1.2–4.6 s per client hop, 0.7–3.4 s per PM hop, warm cache and warm backend. The
  best case today (`admin-documents → admin-advisory-fee`, 746 ms) is what every hop would feel
  like if the shell and its data survived.

---

## 6. Metric 7 — the glass cost

Scroll frame time on the same page under five variants, three runs each (median of the means, with
the range), the other two browsers parked. The rAF floor in this headless build is 20 ms (50 Hz), so
"dropped" is a frame over 25 ms. Variants: **as-is**; **no-blur** (`backdrop-filter: none` on
everything); **no-blur-layered** (blur off, but every glass element forced onto its own compositor
layer with `will-change: transform`); **no-glass** (blur off, gradient/shadow/sheen off, plain white);
**no-decoration** (no-glass plus the blobs, grid overlays and grains hidden).

**client dashboard.html** — rAF floor 20 ms, 9 elements carry a backdrop-filter, 2 blob(s)

| Cards | Variant | Mean ms (3 runs) | p95 ms | Dropped / frames |
|---:|---|---:|---:|---:|
|  | as-is | 20 (20–20) | 20.3 | 0 / 95 |
|  | no-blur | 37.9 (37.26–40.84) | 60.1 | 67 / 95 |
|  | no-blur-layered | 20 (20–20) | 20.4 | 0 / 95 |
|  | no-glass | 20 (20–20) | 20.2 | 0 / 95 |
|  | no-decoration | 22.11 (21.26–25.47) | 40 | 10 / 95 |

**client settings.html** — rAF floor 20 ms, 6 elements carry a backdrop-filter, 1 blob(s)

| Cards | Variant | Mean ms (3 runs) | p95 ms | Dropped / frames |
|---:|---|---:|---:|---:|
|  | as-is | 20 (20–20) | 20.2 | 0 / 95 |
|  | no-blur | 20 (20–20) | 20.1 | 0 / 95 |
|  | no-blur-layered | 20 (20–20) | 20.2 | 0 / 95 |
|  | no-glass | 20 (20–20) | 20.3 | 0 / 95 |
|  | no-decoration | 20 (20–20) | 20.2 | 0 / 95 |

**admin admin.html** — rAF floor 20 ms, 12 elements carry a backdrop-filter, 1 blob(s)

| Cards | Variant | Mean ms (3 runs) | p95 ms | Dropped / frames |
|---:|---|---:|---:|---:|
|  | as-is | 20 (20–20) | 20.2 | 0 / 95 |
|  | no-blur | 20 (20–20) | 20.2 | 0 / 95 |
|  | no-blur-layered | 20 (20–20.01) | 20.4 | 0 / 95 |
|  | no-glass | 20 (20–20) | 20.2 | 0 / 95 |
|  | no-decoration | 20 (20–21.68) | 20.2 | 0 / 95 |

**admin admin-approvals.html** — rAF floor 20 ms, 1 elements carry a backdrop-filter, 1 blob(s)

| Cards | Variant | Mean ms (3 runs) | p95 ms | Dropped / frames |
|---:|---|---:|---:|---:|
|  | as-is | not scrollable |  |  |
|  | no-blur | not scrollable |  |  |
|  | no-blur-layered | not scrollable |  |  |
|  | no-glass | not scrollable |  |  |
|  | no-decoration | not scrollable |  |  |

**public index.html** — rAF floor 20.1 ms, 12 elements carry a backdrop-filter, 11 blob(s)

| Cards | Variant | Mean ms (3 runs) | p95 ms | Dropped / frames |
|---:|---|---:|---:|---:|
|  | as-is | 21.47 (20.84–39.16) | 20.1 | 2 / 95 |
|  | no-blur | 20.84 (20.63–21.69) | 20.3 | 4 / 95 |
|  | no-blur-layered | 20.42 (20–20.63) | 20.3 | 2 / 95 |
|  | no-glass | 21.68 (20.21–26.52) | 40 | 8 / 95 |
|  | no-decoration | 20 (20–20) | 20.1 | 0 / 95 |

**client asset-collection.html (filled)** — rAF floor 20 ms, 2 elements carry a backdrop-filter, 1 blob(s)

| Cards | Variant | Mean ms (3 runs) | p95 ms | Dropped / frames |
|---:|---|---:|---:|---:|
| 24 | as-is | 20 (20–20) | 20.3 | 0 / 95 |
| 24 | no-blur | 28 (23.79–29.89) | 60 | 30 / 95 |
| 24 | no-blur-layered | 20 (20–20) | 20.2 | 0 / 95 |
| 24 | no-glass | 30.53 (29.26–31.16) | 60 | 42 / 95 |
| 24 | no-decoration | 50.11 (45.9–50.31) | 80 | 89 / 95 |
| 96 | as-is | 20 (20–20.42) | 20.2 | 0 / 95 |
| 96 | no-blur | 41.9 (23.79–46.74) | 80 | 63 / 95 |
| 96 | no-blur-layered | 20.21 (20.21–20.21) | 20.1 | 1 / 95 |
| 96 | no-glass | 25.26 (23.79–25.26) | 59.8 | 18 / 95 |
| 96 | no-decoration | 54.74 (46.95–60.63) | 80 | 88 / 95 |
| 247 | as-is | 36.53 (34.42–37.16) | 80 | 34 / 95 |
| 247 | no-blur | 50.53 (28.74–52.21) | 120.1 | 65 / 95 |
| 247 | no-blur-layered | 21.26 (21.16–22.84) | 39.9 | 6 / 95 |
| 247 | no-glass | 47.86 (46.31–53.12) | 100 | 59 / 95 |
| 247 | no-decoration | 53.37 (52.53–55.79) | 80.1 | 89 / 95 |

**Reading it.**

- On every shipped page — dashboard (9 glass elements), settings (6), `admin.html` (12), `index.html`
  (12), the catalog at its real 24-per-page and even at 96 — **as-is scrolls at the floor: mean 20.0 ms,
  0 dropped frames.** Glass costs nothing at these counts on this machine.
- **`no-blur` is worse than as-is on the dashboard and the catalog** (dashboard 20 → 37.9 ms, 67
  dropped; catalog@24 20 → 28, @96 20 → 41.9, @247 36.5 → 50.5). The blur is what promotes each card
  to its own compositor layer; take it away and the gradient, shadow and sheen — still there — are
  repainted on the main thread every frame. **`no-blur-layered` is at the floor everywhere**,
  including 247 cards (21.3 ms, 6 dropped): the layer is the thing, not the blur.
- **Where the blur itself costs**: at 247 cards, as-is 36.5 ms / 34 dropped against the layered
  control's 21.3 / 6 — about **+15 ms per frame for 247 simultaneous backdrop-filters**. That is the
  row-211 figure (2× budget at 247), now attributed: not "247 cards", **247 blur layers**. At 96 the
  same blur is free.
- **`no-glass` and `no-decoration` are not faster** — 247 unlayered white cards cost 47.9 ms, and
  hiding the blobs/grains too costs 53.4 (the `filter: none` on `*` also removes the layer the blobs'
  own blur gives them). Plain cards scroll worse than glass cards once there are many of them.
- `settings.html`, `admin.html`: every variant at the floor — nothing to attribute.
  `admin-approvals.html` (the zero-glass control, 1 element) does not scroll at 1440×900.
  `index.html` as-is has a 140 ms max spike (the canvas hero / ticker), not a glass cost.

**Conclusion for the design vocabulary**: it does not change. Glass is free at the density the product
renders, and removing the blur alone is a regression. The real constraint is a **count**: keep the
number of *simultaneously rendered* backdrop-filter elements well under ~100 — which the 24-card catalog
page and every dashboard already do. The three-browsers-alive first attempt (§7) is worth remembering:
it produced the opposite reading on the same pages.

---

## 7. Harness notes — what had to be fixed to trust the numbers

Recorded because each one produced a plausible wrong number first.

- **A `document.readyState` of `complete` is not "loaded"** on these pages: the SDK is a *dynamic*
  `import()`, so `load` fires with the 17 esm.sh requests still in flight. The first cut of the
  settle reported `admin-inbox.html` usable at 4.8 s with zero backend calls — it had read the page
  before the SDK arrived. The settle now holds on any in-flight request except the presence beacon
  and Realtime.
- **CDP never sees a CORS preflight finish** (no `loadingFinished` for `OPTIONS`), which held the
  settle open forever until preflights were marked done on `responseReceived` and classified
  separately. Their existence is finding 6.
- **A polling shell has no "last" backend response.** `admin-inbox.html` sat at 111 requests in
  45 s; data-ready for a skeleton-less page is now the end of the initial burst (§2).
- **A skeleton inside a hidden row is not a loading state.** `settings.html` never settled because
  the entity/joint rows (hidden for an Individual account) keep their skeleton markup; only visible
  skeletons count now.
- **The mirror step raced `engine-core.js`.** The first full run wrote the local client mirror 2.5 s
  after the pre-load navigation, before that 197 KB script had arrived on a cold cache, so the run's
  client had no mirror — exactly the state row 210 documented. It affects only the surfaces that read
  the mirror (the settings profile card, the sidebar footer name), none of the timings; the harness now
  waits for the function and verifies the write. `settings.html` was re-measured with the mirror present.
- **Three live browsers corrupt the glass numbers.** With the client, PM and public browsers all
  alive (the PM pages polling, the client heartbeating), the first glass run read as-is at 27–81 ms
  and `no-blur` *slower* by 2–3× on every page — noise, not signal. Parking the other two on
  `about:blank` produced the floor-flat tables in §6. Any frame-cost measurement in this project
  should run alone.
- **Some admin count queries are observed with no completion at all** (2–10 per page load of
  `visitor_sessions` / the nine `status=eq.pending` reads) while identical queries a second later
  complete in 250 ms. Most likely superseded requests the watchers abort; never user-visible. Recorded
  as `stalled` in the JSON, not counted as usable-time.
- The renderer's `Performance.getMetrics` counters are read as deltas from the navigation, not
  absolutes; `JSHeapUsedSize` is reported but rose and fell across the sequence with GC and is not
  read as a finding.

**Side effects on real staging, stated**: `get-portfolio-overview` recorded this month's value anchor
for the fixture client (idempotent — his own visit does the same); the presence beacon recorded real
visitor sessions for the client profile (30-day retention); `pm_visits` rows for the throwaway PM were
deleted with it. No email reached a real inbox: the staging PM addresses are not mailboxes.
