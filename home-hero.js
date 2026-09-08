// =======================================================================================
// HOMEPAGE DEPTH PASS (2026-09-08) — hero v2 behaviour: the live market-curve canvas and
// the ticker tape's real data.
//
// Loaded only by index.html. Follows this project's established convention for public-site
// motion (home-motion.js / services-motion.js): a self-invoking classic script, no build
// step, and prefers-reduced-motion suppresses motion ENTIRELY rather than degrading it.
// =======================================================================================
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // -------------------------------------------------------------------------------------
  // L3 — layered market curves on canvas.
  // Seeded so the shape is stable per load rather than reshuffling on every frame: the
  // same seeds always produce the same walk, so the hero looks composed rather than random.
  // -------------------------------------------------------------------------------------
  (function marketCanvas() {
    var c = document.getElementById('hero-market');
    if (!c || !c.getContext) return;
    var x = c.getContext('2d');
    var W, H, t = 0, raf = null;

    function seed(s) {
      return function () { s = Math.sin(s) * 10000; return s - Math.floor(s); };
    }

    // A random walk, normalised to 0..1 so amplitude is controlled by the caller.
    function series(rnd, n, drift, vol) {
      var pts = [], v = 0, i;
      for (i = 0; i < n; i++) { v += drift + (rnd() - 0.5) * vol; pts.push(v); }
      var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), r = (mx - mn) || 1;
      return pts.map(function (p) { return (p - mn) / r; });
    }

    var lines = [
      { c: 'rgba(27,58,75,.32)',   w: 1.6, y: 0.62, amp: 0.20, pts: series(seed(7),  120,  0.012, 0.10) },
      { c: 'rgba(22,129,95,.34)',  w: 1.4, y: 0.55, amp: 0.16, pts: series(seed(23), 120,  0.010, 0.12) },
      { c: 'rgba(200,134,10,.28)', w: 1.2, y: 0.70, amp: 0.13, pts: series(seed(51), 120,  0.006, 0.14) },
      { c: 'rgba(157,196,232,.34)',w: 1.1, y: 0.46, amp: 0.11, pts: series(seed(89), 120, -0.004, 0.11) }
    ];

    function resize() {
      var dpr = window.devicePixelRatio || 1;
      W = c.width = Math.max(1, c.offsetWidth * dpr);
      H = c.height = Math.max(1, c.offsetHeight * dpr);
    }

    function draw() {
      var dpr = window.devicePixelRatio || 1;
      x.clearRect(0, 0, W, H);
      lines.forEach(function (L, li) {
        x.beginPath();
        var n = L.pts.length, step = W / (n - 1), i;
        for (i = 0; i < n; i++) {
          // The gentle "breathing" — suppressed entirely under reduced motion, which also
          // means the curve is drawn once and never repainted (see the rAF guard below).
          var wob = reduce ? 0 : Math.sin(t / 1400 + i / 9 + li) * 0.006;
          var px = i * step;
          var py = H * (L.y - (L.pts[i] - 0.5) * L.amp * 2 + wob);
          if (i) x.lineTo(px, py); else x.moveTo(px, py);
        }
        x.strokeStyle = L.c;
        x.lineWidth = L.w * dpr;
        x.lineJoin = 'round';
        x.stroke();

        if (li === 0) {
          x.lineTo(W, H); x.lineTo(0, H); x.closePath();
          var g = x.createLinearGradient(0, H * 0.4, 0, H);
          g.addColorStop(0, 'rgba(27,58,75,.05)');
          g.addColorStop(1, 'rgba(27,58,75,0)');
          x.fillStyle = g; x.fill();
        }
      });
      t += 16;
      if (!reduce) raf = window.requestAnimationFrame(draw);
    }

    window.addEventListener('resize', function () {
      resize();
      // Under reduced motion nothing is looping, so a resize must repaint explicitly or the
      // canvas would be left blank at its new size.
      if (reduce) draw();
    });
    resize();
    draw();

    // Nothing should keep running while the tab is hidden.
    document.addEventListener('visibilitychange', function () {
      if (reduce) return;
      if (document.hidden) {
        if (raf) { window.cancelAnimationFrame(raf); raf = null; }
      } else if (!raf) {
        raf = window.requestAnimationFrame(draw);
      }
    });
  })();

  // -------------------------------------------------------------------------------------
  // L6 — ticker tape.
  //
  // ★ IMPORTANT, and a correction to this task's own original plan: the tape shows REFERENCE
  // values, not live ones, and says so in the markup ("Indicative levels").
  //
  // The plan was to wire it to the real get-market-snapshot Edge Function. That function is
  // AUTH-GATED — verified directly, not inferred: calling it with only the public anon key
  // returns `401 {"error":"You must be signed in to perform this action."}`. It was built for
  // the signed-in dashboard's Market Snapshot card, and a homepage visitor is by definition
  // anonymous. Serving live data here would need a NEW public, unauthenticated Edge Function,
  // which is real backend work plus a deployment, and adds a public endpoint that reaches
  // third-party market APIs — out of scope for a visual pass without agreeing it first.
  //
  // So the values are honest about what they are, and the LABELS are the real ETF proxies
  // (SPY / QQQ / DIA) that get-market-snapshot itself returns — never "S&P 500" against an
  // index number this project already decided it cannot legitimately source. See that
  // function's own header comment for why the proxies exist.
  //
  // No fetch is attempted. Shipping a call that is guaranteed to 401 on every homepage load
  // would be pure waste and would put a recurring error in every visitor's console.
  // -------------------------------------------------------------------------------------

  // -------------------------------------------------------------------------------------
  // BEAT 4 — "What Makes Us Different" background video.
  //
  // The <video> element ships with NO source. A source is only attached when the viewport is
  // wide enough and the visitor has not asked for reduced motion, so a phone (or anyone with
  // reduced motion on) downloads the poster image and nothing else — the ~1.5MB video is
  // never fetched at all, rather than being fetched and then hidden.
  //
  // The poster <img> sits underneath and is always present, so the section looks identical
  // and intentional in every fallback case: no JS, narrow viewport, reduced motion, or a
  // browser that simply refuses to autoplay. If play() is rejected we remove the video from
  // the compositing path entirely so the poster shows through cleanly instead of a frozen
  // first frame.
  // -------------------------------------------------------------------------------------
  (function heroVideo() {
    var v = document.getElementById('different-video');
    if (!v) return;

    var wideEnough = window.matchMedia('(min-width: 900px)').matches;
    if (reduce || !wideEnough) {
      v.remove();          // poster <img> underneath is the whole design in this case
      return;
    }

    ['assets/different.webm|video/webm', 'assets/different.mp4|video/mp4'].forEach(function (spec) {
      var parts = spec.split('|');
      var src = document.createElement('source');
      src.src = parts[0];
      src.type = parts[1];
      v.appendChild(src);
    });
    v.preload = 'auto';
    v.load();

    var attempt = v.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(function () {
        // Autoplay refused (a real, common browser policy) — fall back to the poster rather
        // than leaving a stalled first frame on screen.
        v.remove();
      });
    }
  })();
})();
