// services.html: page-hero + per-section entrance motion, reusing the exact
// implementation pattern established in home-motion.js (index.html) — same bailout
// conditions, same [data-reveal] mechanism, same helper shapes. Progressive
// enhancement: if prefers-reduced-motion is set, or IntersectionObserver isn't
// supported, or JS fails to run, .js-motion is never added and every element stays in
// its normal, fully-visible static state (the [data-reveal] CSS in styles.css only
// takes effect once .js-motion is present on <html>) — content is never hidden
// waiting on JS that might not run.
(function () {
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || !('IntersectionObserver' in window)) return;

  document.documentElement.classList.add('js-motion');

  function markReveal(el) {
    if (!el) return;
    el.setAttribute('data-reveal', '');
  }

  // A group of children stagger in together once the shared container enters view.
  // Each element fires once and is never re-triggered on scroll back up/down.
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

  // ---------- 1. PAGE HERO — immediate on load, not scroll-triggered ----------
  var heroTargets = document.querySelectorAll('.page-hero h1, .page-hero p');
  heroTargets.forEach(function (el, i) {
    markReveal(el);
    el.style.transitionDelay = (i * 100) + 'ms';
  });
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      heroTargets.forEach(function (el) { el.classList.add('is-visible'); });
    });
  });

  // ---------- 2. EACH SERVICE SECTION — internal elements stagger in on scroll ----------
  // tag, then title, then intro (both paragraphs as one group), then the stat
  // callout, then the bullet list — each section observed individually, so sections
  // reveal one at a time as the user scrolls through them, not all at once.
  document.querySelectorAll('.service-section').forEach(function (section) {
    var group = [
      section.querySelector('.service-tag'),
      section.querySelector('.service-title'),
      section.querySelector('.service-copy'),
      section.querySelector('.service-stat'),
      section.querySelector('.service-checklist')
    ].filter(Boolean);
    group.forEach(function (el) { markReveal(el); });
    observeStaggeredGroup(section, group, 90, 0.15);
  });
})();
