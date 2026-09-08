// Motion UI Components (2026-09-08). Shared helpers for the 5 RareUI-referenced components
// (Animated Counter, Notification Bell, Scroll Progress, Step Player, Delete Button), built
// on Motion (https://motion.dev — the vanilla-JS successor to "Framer Motion"; the React
// library kept the old name, the framework-agnostic core is now just "Motion"). Loaded via a
// pinned CDN version, global `<script>` build (exposes `window.Motion`), only on the pages
// that actually use one of these 5 components — never loaded project-wide. Real bundle
// impact, confirmed directly (not assumed): motion@13.2.0's global build is 140,491 bytes
// uncompressed / 46,763 bytes gzipped over the wire — smaller than Chart.js
// (already an accepted dependency on 2 pages of this project, 69,693 bytes gzipped). Coexists
// cleanly with the existing Tailwind CDN script and Chart.js: all three are independent,
// self-contained global-variable UMD builds with no shared globals or load-order dependency
// on each other.
//
// ★ REUSES THE ESTABLISHED MOTION CONVENTION from home-motion.js/services-motion.js, per
// instruction — not a parallel set of rules: every animation here respects
// prefers-reduced-motion (checked once, suppressing the effect ENTIRELY when set, the exact
// same "bail out completely, content stays in its normal state" philosophy those two files
// already use — never a degraded-but-still-present motion), stays in the 200-500ms range for
// ordinary transitions, and never re-triggers once a given reveal has already fired. The one
// established, disclosed exception this project already carries is the stat-counter's own
// 900ms duration ("a count-up needs to be legible as counting, not just a quick fade") —
// carried forward here unchanged for the same reason, and this file's own hold-to-confirm
// delete interaction gets its own explicit, reported exception below for a different reason
// (a hold gesture that completed in under 500ms would be indistinguishable from an accidental
// click, defeating its entire purpose).
(function () {
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // True only when it's actually safe to call into the real Motion global — reduced motion
  // is off AND the CDN script genuinely loaded (a real, if unlikely, network failure must
  // never leave a page half-broken; every caller below falls back to the plain, un-animated
  // end state whenever this is false).
  function available() {
    return !reducedMotion() && typeof window.Motion !== 'undefined' && !!window.Motion.animate;
  }

  // ---------------------------------------------------------------------------------------
  // 1. ANIMATED COUNTER — Motion's own documented plain-number overload,
  // animate(from, to, { onUpdate }), rather than hand-rolled requestAnimationFrame easing
  // (home-motion.js's own animateStatCounters() pre-dates this file and is left exactly as
  // it was — the homepage's own upgrade to this shared helper is a separate, explicit edit,
  // not a silent rewrite of a file this task didn't touch here).
  // ---------------------------------------------------------------------------------------
  function countUp(el, opts) {
    if (!el) return;
    var to = opts.to;
    var from = typeof opts.from === 'number' ? opts.from : 0;
    var format = opts.format || function (n) { return String(Math.round(n)); };
    // 900ms, matching the pre-existing stat-counter precedent exactly (see this file's own
    // header) — a deliberate, disclosed exception to the general 200-500ms range.
    var durationMs = typeof opts.duration === 'number' ? opts.duration : 900;

    if (!available()) {
      el.textContent = format(to);
      return;
    }

    window.Motion.animate(from, to, {
      duration: durationMs / 1000,
      ease: [0.16, 1, 0.3, 1], // matches home-motion.js's own cubic ease-out shape
      onUpdate: function (latest) { el.textContent = format(latest); }
    });
  }

  // ---------------------------------------------------------------------------------------
  // 2. NOTIFICATION BELL — a short attention wiggle on the bell icon, and a smooth
  // open/close for its dropdown panel. Kept as small, generic DOM-animate wrappers here;
  // dashboard-notifications.js decides WHEN to call them (its own real aggregation/read-state
  // logic is untouched — see that file's own diff for the only 2 real call sites added).
  // ---------------------------------------------------------------------------------------
  function wiggle(el, durationMs) {
    if (!el || !available()) return;
    window.Motion.animate(el, { rotate: [0, -12, 10, -8, 5, 0] }, { duration: (durationMs || 500) / 1000, ease: 'easeInOut' });
  }

  function panelOpen(el, durationMs) {
    if (!el) return;
    if (!available()) return; // caller already removed the .hidden class; nothing more to do
    window.Motion.animate(el, { opacity: [0, 1], y: [-6, 0], scale: [0.97, 1] }, { duration: (durationMs || 200) / 1000, ease: 'easeOut' });
  }

  // Returns a Promise resolving once the exit animation has actually finished, so the caller
  // can hide (display:none) only after the fade genuinely completes rather than clipping it.
  function panelClose(el, durationMs) {
    if (!el || !available()) return Promise.resolve();
    var controls = window.Motion.animate(el, { opacity: [1, 0], y: [0, -6], scale: [1, 0.97] }, { duration: (durationMs || 150) / 1000, ease: 'easeIn' });
    return controls.finished || Promise.resolve();
  }

  // ---------------------------------------------------------------------------------------
  // 3. SCROLL PROGRESS — the canonical Motion pattern, scroll(animate(el, {scaleX:[0,1]})).
  // ★ Reduced-motion judgment call, reported per instruction: mirrors home-motion.js's own
  // literal "bail out entirely" behavior rather than a compromise middle ground (e.g. a
  // non-animated but still-updating bar) — the established convention for this project is a
  // full suppress, and a scroll progress bar is genuinely decorative chrome here (the pages
  // it's used on have no functional dependency on it), so mount() below simply never creates
  // the element at all when reduced motion is set, exactly like a homepage section that never
  // gets `.js-motion` never reveals via that path.
  // ---------------------------------------------------------------------------------------
  function mountScrollProgress() {
    if (reducedMotion() || typeof window.Motion === 'undefined' || !window.Motion.scroll || !window.Motion.animate) return;

    var bar = document.createElement('div');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;height:3px;background:var(--primary,#1B3A4B);' +
      'transform-origin:0%;transform:scaleX(0);z-index:9999;pointer-events:none;';
    document.body.appendChild(bar);

    var animation = window.Motion.animate(bar, { scaleX: [0, 1] }, { ease: 'linear' });
    window.Motion.scroll(animation);
  }

  window.MotionHelpers = {
    reducedMotion: reducedMotion,
    available: available,
    countUp: countUp,
    wiggle: wiggle,
    panelOpen: panelOpen,
    panelClose: panelClose,
    mountScrollProgress: mountScrollProgress
  };
})();
