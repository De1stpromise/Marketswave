// Core Services field — design round 2 addendum, item B (2026-09-08). index.html only.
// Built against the approved mockup, core_services_field_v5.html.
//
// The surface, the baked terrains and every static state live in styles.css section 18G and in
// the markup; this file only decides WHICH panel is open and drives the two things CSS cannot
// do on its own: restarting the light sweep on each open, and parallaxing the terrain against
// the cursor. One panel is always open — the first, until hovering or focusing moves it.
//
// Two behaviours are gated, both for real reasons rather than caution:
//   - prefers-reduced-motion: no parallax, and the CSS drops every transition and animation in
//     the section, so opening becomes instant. The field itself is not motion; only its
//     transitions are, so nothing is hidden.
//   - pointer type: on a coarse pointer there is no hover, so the FIRST tap opens a panel and
//     a second follows its link. Each panel is a real <a> to its services.html anchor, so with
//     no JS at all a tap simply navigates, which is the correct fallback.
(function () {
  var root = document.getElementById('field-panels');
  if (!root) return;

  var panels = [].slice.call(root.querySelectorAll('.fpanel'));
  if (!panels.length) return;

  var ticks = [].slice.call(document.querySelectorAll('#field-ticks i'));
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fineHover = window.matchMedia('(hover: hover) and (pointer: fine)');

  function open(panel) {
    if (panel.classList.contains('is-on')) return;
    panels.forEach(function (p) {
      p.classList.toggle('is-on', p === panel);
      if (p !== panel) {
        var t = p.querySelector('.fpanel-terrain');
        if (t) t.style.transform = '';
      }
    });
    var i = panels.indexOf(panel);
    ticks.forEach(function (t, n) { t.classList.toggle('is-on', n === i); });

    // A CSS animation does not replay when a class simply moves between elements; forcing a
    // reflow between clearing and restoring it makes the sweep genuinely pass once per open.
    var sweep = panel.querySelector('.fpanel-sweep');
    if (sweep && !reduce) {
      sweep.style.animation = 'none';
      void sweep.offsetWidth;
      sweep.style.animation = '';
    }
  }

  panels.forEach(function (p) {
    p.addEventListener('mouseenter', function () {
      if (fineHover.matches) open(p);
    });
    // Keyboard users move the field with focus, not just the mouse.
    p.addEventListener('focus', function () { open(p); });
  });

  root.addEventListener('mouseenter', function () {
    if (fineHover.matches) root.classList.add('is-hovering');
  });
  root.addEventListener('mouseleave', function () {
    root.classList.remove('is-hovering');
    // The open panel stays open — the field always shows one, it never collapses to none.
    panels.forEach(function (p) {
      var t = p.querySelector('.fpanel-terrain');
      if (t) t.style.transform = '';
    });
  });

  if (!reduce) {
    root.addEventListener('mousemove', function (e) {
      if (!fineHover.matches) return;
      var p = root.querySelector('.fpanel.is-on');
      if (!p) return;
      var t = p.querySelector('.fpanel-terrain');
      if (!t) return;
      var r = p.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      t.style.transform = 'translate3d(' + (x * -18).toFixed(1) + 'px,' +
                          (y * -14).toFixed(1) + 'px,0) scale(1.06)';
    });
  }

  // Coarse pointer: first tap opens, second follows the link.
  root.addEventListener('click', function (e) {
    var p = e.target.closest ? e.target.closest('.fpanel') : null;
    if (!p) return;
    if (fineHover.matches) return;          // hover already opened it
    if (!p.classList.contains('is-on')) {
      e.preventDefault();
      open(p);
    }
  });
})();
