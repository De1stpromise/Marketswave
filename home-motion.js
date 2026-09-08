// Homepage (index.html) entrance/scroll motion + stat count-up.
// Progressive enhancement: if prefers-reduced-motion is set, or IntersectionObserver
// isn't supported, this bails out entirely and every element stays in its normal,
// fully-visible static state (the [data-reveal]/[data-reveal-scale] CSS only takes
// effect once .js-motion is present on <html>, added below) — content is never
// hidden waiting on JS that might not run.
(function () {
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || !('IntersectionObserver' in window)) return;

  document.documentElement.classList.add('js-motion');

  function markReveal(el, scale) {
    if (!el) return;
    el.setAttribute(scale ? 'data-reveal-scale' : 'data-reveal', '');
  }

  // Single element, animates in the first time it enters the viewport.
  function observeReveal(el, threshold) {
    if (!el) return;
    var obs = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: threshold || 0.15 });
    obs.observe(el);
  }

  // A group of children stagger in together once the shared container enters view.
  function observeStaggeredGroup(container, children, staggerMs, threshold) {
    if (!container || !children || !children.length) return;
    children.forEach(function (el, i) {
      el.style.transitionDelay = (i * staggerMs) + 'ms';
    });
    var obs = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          children.forEach(function (el) { el.classList.add('is-visible'); });
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: threshold || 0.15 });
    obs.observe(container);
  }

  // ---------- 1. HERO — immediate on load, not scroll-triggered ----------
  var heroTargets = document.querySelectorAll('.hero h1, .hero .hero-lead, .hero .hero-ctas');
  heroTargets.forEach(function (el, i) {
    markReveal(el);
    el.style.transitionDelay = (i * 100) + 'ms';
  });
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      heroTargets.forEach(function (el) { el.classList.add('is-visible'); });
    });
  });

  // ---------- 2. STATS BAR — count up numeric values once, on scroll entry ----------
  var statsBar = document.querySelector('.stats-bar');
  if (statsBar) {
    var statsObs = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateStatCounters(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    statsObs.observe(statsBar);

    // Homepage Visual Redesign, Stage 1 (2026-09-05): the 4 stat cards now get the same
    // staggered-group entrance reveal already established for other homepage sections
    // (e.g. .values-grid below) — purely additive, does not touch animateStatCounters()
    // or its own IntersectionObserver above; both fire independently off the same
    // .stats-bar entering view.
    var statCards = statsBar.querySelectorAll('.stat');
    statCards.forEach(function (el) { markReveal(el); });
    observeStaggeredGroup(statsBar, statCards, 100, 0.3);
  }

  // Motion UI Components (2026-09-08): the count-up itself now runs through
  // MotionHelpers.countUp() (Motion's own animate(from, to, {onUpdate}) plain-number
  // overload) instead of this function's own original hand-rolled requestAnimationFrame
  // loop — a smoother, spring-adjacent cubic-bezier ease rather than a manually coded cubic
  // ease-out, with the identical 900ms duration and prefix/suffix formatting preserved
  // exactly. Falls back to the exact old un-animated end state (just the final number) if
  // Motion isn't loaded or prefers-reduced-motion is set — MotionHelpers.countUp()'s own
  // job, not duplicated here.
  function animateStatCounters(container) {
    var values = container.querySelectorAll('.stat .value');
    values.forEach(function (el) {
      var text = el.textContent.trim();
      // Only numeric stats ($350m, 20+) count up — text-only stats (International,
      // Multi Asset Class) have nothing to count, so they're left exactly as-is.
      var match = text.match(/^([^\d]*)(\d+)(.*)$/);
      if (!match) return;
      var prefix = match[1], target = parseInt(match[2], 10), suffix = match[3];
      if (window.MotionHelpers) {
        window.MotionHelpers.countUp(el, {
          to: target,
          duration: 900,
          format: function (n) { return prefix + Math.round(n) + suffix; }
        });
      } else {
        el.textContent = prefix + target + suffix;
      }
    });
  }

  // ---------- 3. OUR APPROACH + WHAT WE STAND FOR ----------
  // Rewired 2026-09-08: the single overloaded Company Pitch section was split in two, so
  // .two-col, .values-grid/.value-item and .process-steps/.process-step-num no longer exist.
  // Left pointing at them, this whole block would have silently done nothing — every
  // querySelector would return null and three real reveals would just stop happening.
  var approachLead = document.querySelector('.approach-lead');
  markReveal(approachLead);
  observeReveal(approachLead, 0.15);

  var approachEsg = document.querySelector('.approach-esg');
  markReveal(approachEsg);
  observeReveal(approachEsg, 0.2);

  var approachRail = document.querySelector('.approach-rail');
  if (approachRail) {
    var approachSteps = approachRail.querySelectorAll('.approach-step');
    approachSteps.forEach(function (el) { markReveal(el); });
    observeStaggeredGroup(approachRail, approachSteps, 90, 0.2);
  }

  var valuesList = document.querySelector('.values-list');
  if (valuesList) {
    var valueRows = valuesList.querySelectorAll('.values-row');
    valueRows.forEach(function (el) { markReveal(el); });
    observeStaggeredGroup(valuesList, valueRows, 100, 0.2);
  }

  // ---------- 5. PLATFORM PITCH — 3 columns stagger left to right ----------
  var platformColumns = document.querySelector('.platform-columns');
  if (platformColumns) {
    var columns = platformColumns.querySelectorAll('.platform-column');
    columns.forEach(function (el) { markReveal(el); });
    observeStaggeredGroup(platformColumns, columns, 150, 0.15);
  }

  // ---------- 6. WHAT MAKES US DIFFERENT — each row triggers individually ----------
  document.querySelectorAll('.diff-row').forEach(function (el) {
    markReveal(el);
    observeReveal(el, 0.3);
  });

  // ---------- 8. PHILOSOPHY CTA — simple fade-in ----------
  var philosophy = document.querySelector('.philosophy .container');
  markReveal(philosophy);
  observeReveal(philosophy, 0.2);
})();
