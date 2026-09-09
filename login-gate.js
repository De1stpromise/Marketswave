/* login-gate.js — the login gate's environment and the loading screen's instrument dial.
 *
 * Same self-invoking, no-framework convention as home-motion.js / resources-artifact.js.
 * Purely decorative: nothing here touches authentication. The auth module in login.html owns
 * every credential, status and redirect decision, and this file must never grow one.
 *
 * Reduced motion is handled by DRAWING ONCE rather than skipping the draw. A gate whose left
 * half is an empty navy rectangle looks broken; a gate whose curves are simply still looks
 * calm. Same principle the loading screen's CSS follows for its settled state.
 */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- instrument tick dial */
  (function ticks() {
    var host = document.getElementById('load-ticks');
    if (!host) return;
    // 36 marks, every 10 degrees, with every ninth brighter so the dial reads as a quartered
    // instrument rather than an even ring. Built here rather than as 36 hand-written elements.
    for (var i = 0; i < 36; i++) {
      var t = document.createElement('i');
      t.style.transform = 'rotate(' + (i * 10) + 'deg)';
      t.style.opacity = (i % 9 === 0) ? '.85' : '.32';
      host.appendChild(t);
    }
  })();

  /* ---------------------------------------------------------------- magnetic controls */
  (function magnetic() {
    if (reduced) return;
    var targets = [document.getElementById('gate-back'), document.getElementById('gate-submit')];
    targets.forEach(function (el) {
      if (!el) return;
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) * 0.18;
        var dy = (e.clientY - (r.top + r.height / 2)) * 0.18;
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    });
  })();

  /* ---------------------------------------------------------------- drifting market curves */
  (function curves() {
    var c = document.getElementById('gate-canvas');
    if (!c || !c.getContext) return;
    var x = c.getContext('2d');
    var W = 0, H = 0, t = 0;

    function resize() {
      var dpr = window.devicePixelRatio || 1;
      W = c.width = Math.max(1, c.offsetWidth * dpr);
      H = c.height = Math.max(1, c.offsetHeight * dpr);
    }

    // Seeded so the same page load always draws the same curves — this is decoration, not
    // data, and a shape that reshuffles on every repaint would imply live movement that means
    // nothing. Same seeded-PRNG approach the homepage hero's own canvas uses.
    function seeded(s) {
      return function () { s = Math.sin(s) * 10000; return s - Math.floor(s); };
    }
    function series(rnd, n) {
      var pts = [], v = 0, i;
      for (i = 0; i < n; i++) { v += 0.01 + (rnd() - 0.5) * 0.12; pts.push(v); }
      var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), r = (mx - mn) || 1;
      return pts.map(function (q) { return (q - mn) / r; });
    }

    var lines = [
      { c: 'rgba(159,225,203,.45)', y: 0.62, a: 0.18, p: series(seeded(3), 110) },
      { c: 'rgba(200,134,10,.35)',  y: 0.70, a: 0.13, p: series(seeded(29), 110) },
      { c: 'rgba(247,246,243,.20)', y: 0.50, a: 0.11, p: series(seeded(71), 110) }
    ];

    function draw() {
      var dpr = window.devicePixelRatio || 1;
      x.clearRect(0, 0, W, H);
      lines.forEach(function (l, li) {
        x.beginPath();
        var n = l.p.length, step = W / (n - 1), i;
        for (i = 0; i < n; i++) {
          // A slow breathing term, not a scroll: the curves settle rather than travel.
          var wob = Math.sin(t / 1600 + i / 9 + li) * 0.006;
          var px = i * step;
          var py = H * (l.y - (l.p[i] - 0.5) * l.a * 2 + wob);
          if (i) x.lineTo(px, py); else x.moveTo(px, py);
        }
        x.strokeStyle = l.c;
        x.lineWidth = 1.4 * dpr;
        x.stroke();
      });
    }

    resize();
    window.addEventListener('resize', function () { resize(); draw(); });

    if (reduced) { draw(); return; }   // drawn once, then left still — never blank

    (function loop() { draw(); t += 16; window.requestAnimationFrame(loop); })();
  })();
})();
