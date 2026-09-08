// Mobile fixes, Batch 1 (2026-09-08), Finding S1: real toggle behavior for the public-site
// mobile nav (.nav-toggle / #main-nav). Before this, .nav-toggle rendered but had zero JS
// wired to it anywhere in the project — clicking it did nothing at all (confirmed via a
// project-wide grep before writing this file). Shared across all 8 marketing pages
// (about/blog-press/contact/help-center/index/legal/resources/services) that load
// styles.css's own .site-header/.header-actions/.nav-toggle markup — self-invoking, no
// init() call needed, matching home-motion.js's own convention for page-load-time setup.
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('main-nav');
  if (!toggle || !nav) return;

  function isOpen() {
    return nav.classList.contains('is-open');
  }

  function open() {
    nav.classList.add('is-open');
    toggle.classList.add('is-active');
    toggle.setAttribute('aria-expanded', 'true');
  }

  function close() {
    nav.classList.remove('is-open');
    toggle.classList.remove('is-active');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    if (isOpen()) close(); else open();
  });

  // A real nav link click is already a real navigation — closing first just avoids a stale
  // open drawer flashing on a same-page anchor or a back/forward-cache restore.
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) close();
  });

  document.addEventListener('click', function (e) {
    if (!isOpen()) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) close();
  });
})();
