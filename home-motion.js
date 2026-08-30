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
  }

  function animateStatCounters(container) {
    var values = container.querySelectorAll('.stat .value');
    values.forEach(function (el) {
      var text = el.textContent.trim();
      // Only numeric stats ($900m, 10+) count up — text-only stats (International,
      // Multi Asset Class) have nothing to count, so they're left exactly as-is.
      var match = text.match(/^([^\d]*)(\d+)(.*)$/);
      if (!match) return;
      var prefix = match[1], target = parseInt(match[2], 10), suffix = match[3];
      var duration = 900; // deliberately longer than the 200-500ms general range —
      // a count-up needs to be legible as counting, not just a quick fade
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var progress = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = prefix + Math.round(eased * target) + suffix;
        if (progress < 1) requestAnimationFrame(step);
        else el.textContent = prefix + target + suffix;
      }
      requestAnimationFrame(step);
    });
  }

  // ---------- 3. COMPANY PITCH ----------
  var twoCol = document.querySelector('.two-col');
  markReveal(twoCol);
  observeReveal(twoCol, 0.15);

  var valuesGrid = document.querySelector('.values-grid');
  if (valuesGrid) {
    var valueItems = valuesGrid.querySelectorAll('.value-item');
    valueItems.forEach(function (el) { markReveal(el); });
    observeStaggeredGroup(valuesGrid, valueItems, 100, 0.2);
  }

  var processSteps = document.querySelector('.process-steps');
  if (processSteps) {
    var stepNums = processSteps.querySelectorAll('.process-step-num');
    stepNums.forEach(function (el) { markReveal(el, true); });
    observeStaggeredGroup(processSteps, stepNums, 90, 0.2);
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
