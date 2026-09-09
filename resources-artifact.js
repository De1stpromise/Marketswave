/* resources-artifact.js — the How It Works portfolio-assembly artifact (resources.html only).
 *
 * Same self-invoking, no-framework convention as home-motion.js / services-motion.js.
 *
 * The artifact builds one layer per step as the reader scrolls, and the step spine, dots,
 * percentage and readout all read from the SAME resolved active index, so they cannot drift
 * out of sync with each other.
 *
 * Three behaviours worth knowing before editing:
 *
 *  1. REDUCED MOTION SHOWS THE COMPLETE ARTIFACT, not an empty baseplate. Reduced motion
 *     means "do not animate", not "show nothing" — a reader with the preference set should
 *     still see the finished assembly. So the build is applied once, in full, and the scroll
 *     listener and orbit are never attached.
 *
 *  2. BELOW 960px it also renders the complete state and does not scroll-drive. The artifact
 *     sits after all six steps in source order, so in one column the reader reaches it having
 *     already passed every step — a build would never actually be seen. Showing it assembled
 *     is honest; animating it on arrival would be theatre.
 *
 *  3. The scroll listener is rAF-throttled: scroll only stores the latest event and requests
 *     a frame if one is not already pending, so update() runs at most once per frame no
 *     matter how fast the wheel spins.
 */
(function () {
  'use strict';

  var steps = Array.prototype.slice.call(document.querySelectorAll('.res-st'));
  var layers = Array.prototype.slice.call(document.querySelectorAll('.hiw-lay'));
  var rows = Array.prototype.slice.call(document.querySelectorAll('.hiw-readout .hiw-row'));
  var spine = document.querySelector('.res-steps');
  var pct = document.getElementById('hiw-pct');
  var ring = document.getElementById('hiw-ring');
  var beam = document.getElementById('hiw-beam');
  var sat = document.getElementById('hiw-sat');

  // Nothing to do if the artifact is not on this page.
  if (!steps.length || !layers.length || !spine || !pct) return;

  var TOTAL = steps.length;              // 6
  var RING_LEN = 189;                    // matches the circle's stroke-dasharray
  var ORBIT_RX = 118, ORBIT_RY = 46, ORBIT_CX = 160, ORBIT_CY = 190;

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isNarrow = function () { return window.matchMedia('(max-width: 960px)').matches; };

  function applyState(active) {
    for (var i = 0; i < steps.length; i++) {
      steps[i].classList.toggle('is-past', i < active);
      steps[i].classList.toggle('is-now', i === active);
    }
    for (var l = 0; l < layers.length; l++) layers[l].classList.toggle('is-on', l <= active);
    for (var r = 0; r < rows.length; r++) rows[r].classList.toggle('is-on', r <= active);

    // Spine fill runs to the centre of the active dot, so the filled line always stops
    // exactly at the marker the reader is level with rather than at the step's box edge.
    var h = 0;
    if (active >= 0) {
      var dot = steps[active].querySelector('.res-dot');
      if (dot) {
        var db = dot.getBoundingClientRect();
        var sb = spine.getBoundingClientRect();
        h = Math.max(0, db.top + db.height / 2 - sb.top - 6);
      }
    }
    spine.style.setProperty('--hiw-fill', h + 'px');

    // 17% at the first step through 100% at the last, matching the six readout rows.
    var shown = active < 0 ? 0 : Math.round(((active + 1) / TOTAL) * 100);
    pct.textContent = (shown < 10 ? '0' + shown : String(shown)) + '%';

    if (ring) ring.style.strokeDashoffset = active >= 5 ? 0 : RING_LEN;
    if (beam) beam.classList.toggle('is-on', active >= 4);
  }

  function completed() {
    applyState(TOTAL - 1);
    // With no scroll driving it, pin the fill to the spine's full height rather than to a
    // dot position that may not have settled yet.
    spine.style.setProperty('--hiw-fill', spine.getBoundingClientRect().height - 12 + 'px');
  }

  function activeFromScroll() {
    var mid = window.innerHeight * 0.55;
    var active = -1;
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].getBoundingClientRect().top < mid) active = i;
    }
    return active;
  }

  var pending = false;
  function onScroll() {
    if (pending) return;              // a frame is already queued; drop this event
    pending = true;
    window.requestAnimationFrame(function () {
      pending = false;
      applyState(activeFromScroll());
    });
  }

  var orbitRaf = null;
  function startOrbit() {
    var t = 0;
    (function step() {
      t += 0.012;
      var x = ORBIT_CX + ORBIT_RX * Math.cos(t);
      var y = ORBIT_CY + ORBIT_RY * Math.sin(t);
      sat.setAttribute('cx', x); sat.setAttribute('cy', y);
      beam.setAttribute('x1', x); beam.setAttribute('y1', y);
      orbitRaf = window.requestAnimationFrame(step);
    })();
  }
  function stopOrbit() {
    if (orbitRaf !== null) { window.cancelAnimationFrame(orbitRaf); orbitRaf = null; }
  }

  var scrollBound = false;
  function bindScroll() {
    if (scrollBound) return;
    window.addEventListener('scroll', onScroll, { passive: true });
    scrollBound = true;
  }
  function unbindScroll() {
    if (!scrollBound) return;
    window.removeEventListener('scroll', onScroll);
    scrollBound = false;
  }

  function setMode() {
    if (reduced || isNarrow()) {
      unbindScroll();
      stopOrbit();
      completed();
    } else {
      bindScroll();
      applyState(activeFromScroll());
      // The orbit is a real rAF loop rather than setInterval, so it pauses with the tab and
      // never queues frames the browser has to catch up on.
      if (orbitRaf === null && sat && beam) startOrbit();
    }
  }

  // A resize can cross the 960px boundary in either direction, so the mode is re-resolved
  // rather than decided once at load.
  window.addEventListener('resize', function () {
    setMode();
    if (!reduced && !isNarrow()) applyState(activeFromScroll());
  });

  setMode();
})();
