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

// =========================================================================================
// Homepage design round 2 (2026-09-08) — header treatment, shared by all 8 marketing pages.
//
// Three independent behaviours, each gated on its own conditions and each degrading to
// exactly the pre-round-2 header if its condition is not met:
//   1. scroll state   — past 60px the bar gains .is-stuck (glass). Runs everywhere, and is
//                       the only one of the three that runs under reduced motion.
//   2. liquid pill    — desktop widths only (below the site's own 960px breakpoint the nav
//                       is a drawer and a travelling indicator makes no sense), and never
//                       under reduced motion, where the existing active underline stays.
//   3. magnetic buttons — fine pointer with real hover only, never under reduced motion.
// =========================================================================================
(function () {
  var header = document.querySelector('.site-header');
  if (!header) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- 1. transparent -> glass past ~60px ------------------------------------------------
  var STUCK_AT = 60;
  var ticking = false;
  function applyScrollState() {
    ticking = false;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    header.classList.toggle('is-stuck', y > STUCK_AT);
  }
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(applyScrollState);
  }, { passive: true });
  applyScrollState(); // a reload part-way down the page must not start out transparent

  // ---- 2. liquid indicator ---------------------------------------------------------------
  var nav = document.getElementById('main-nav');
  var desktop = window.matchMedia('(min-width: 961px)');
  var pill = null;
  var current = null;

  function activeLink() {
    return nav && (nav.querySelector('a.active') || null);
  }

  function moveTo(link, animate) {
    if (!pill || !link) return;
    var navBox = nav.getBoundingClientRect();
    var box = link.getBoundingClientRect();
    var padX = 14;
    var x = Math.round(box.left - navBox.left) - padX;
    var w = Math.round(box.width) + padX * 2;

    // The stretch is derived from how far the pill is actually travelling, so a hop between
    // neighbours barely deforms and a jump across the whole nav elongates noticeably. Capped
    // so it never reads as a glitch.
    var prevX = parseFloat(pill.style.getPropertyValue('--pill-x')) || 0;
    var distance = Math.abs(x - prevX);
    var stretch = animate ? Math.min(1 + distance / 900, 1.16) : 1;

    pill.style.width = w + 'px';
    pill.style.setProperty('--pill-x', x + 'px');
    pill.style.setProperty('--pill-stretch', String(stretch));
    pill.classList.add('is-travelling', 'is-visible');
    current = link;

    if (stretch > 1) {
      // Release the stretch mid-flight so the pill settles back to its true width rather
      // than arriving stretched.
      window.clearTimeout(moveTo._t);
      moveTo._t = window.setTimeout(function () {
        pill.style.setProperty('--pill-stretch', '1');
      }, 170);
    }
  }

  function buildPill() {
    if (pill || !nav || reduced || !desktop.matches) return;
    pill = document.createElement('span');
    pill.className = 'nav-pill';
    pill.setAttribute('aria-hidden', 'true');
    nav.insertBefore(pill, nav.firstChild);
    nav.classList.add('has-pill');
    // Place it without animating, so it does not fly in from the left on load.
    moveTo(activeLink(), false);
  }

  function destroyPill() {
    if (!pill) return;
    pill.remove();
    pill = null;
    current = null;
    nav.classList.remove('has-pill');
  }

  if (nav) {
    buildPill();

    nav.addEventListener('mouseover', function (e) {
      var link = e.target.closest('a');
      if (!link || !pill || link === current) return;
      moveTo(link, true);
    });
    nav.addEventListener('mouseleave', function () {
      if (pill) moveTo(activeLink(), true);
    });

    // Keyboard users get the same indicator — focus, not just hover.
    nav.addEventListener('focusin', function (e) {
      var link = e.target.closest('a');
      if (link && pill) moveTo(link, true);
    });
    nav.addEventListener('focusout', function () {
      if (pill) moveTo(activeLink(), true);
    });

    var onBreakpoint = function () {
      if (desktop.matches) buildPill();
      else destroyPill();
    };
    if (desktop.addEventListener) desktop.addEventListener('change', onBreakpoint);
    else if (desktop.addListener) desktop.addListener(onBreakpoint);

    // Re-seat rather than rebuild on resize: widths change, the pill should follow.
    var rt;
    window.addEventListener('resize', function () {
      window.clearTimeout(rt);
      rt = window.setTimeout(function () {
        if (pill) moveTo(current || activeLink(), false);
      }, 120);
    });
  }

  // ---- 3. magnetic buttons ---------------------------------------------------------------
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  if (!reduced && finePointer.matches) {
    var STRENGTH = 0.28;   // fraction of the cursor's offset from centre
    var MAX = 6;           // px — a lean, not a lurch
    [].forEach.call(document.querySelectorAll('.header-actions .btn'), function (btn) {
      btn.addEventListener('pointermove', function (e) {
        var b = btn.getBoundingClientRect();
        var dx = (e.clientX - (b.left + b.width / 2)) * STRENGTH;
        var dy = (e.clientY - (b.top + b.height / 2)) * STRENGTH;
        dx = Math.max(-MAX, Math.min(MAX, dx));
        dy = Math.max(-MAX, Math.min(MAX, dy));
        btn.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      });
      btn.addEventListener('pointerleave', function () {
        btn.style.transform = '';
      });
    });
  }
})();
