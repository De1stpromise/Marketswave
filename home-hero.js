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
  // L6 — segmented ticker tape.
  //
  // ★ This replaces the earlier note here saying live data was out of scope. It no longer is:
  // get-public-market-snapshot was built for exactly this (design round 2, commit 1). The
  // authenticated get-market-snapshot genuinely returns 401 to an anonymous homepage visitor —
  // that finding stands — so a separate PUBLIC, read-only endpoint now serves the same cached
  // values without ever refreshing them, which is what makes an open endpoint safe here.
  //
  // Two segments alternate roughly every 25 seconds:
  //   MARKETSWAVE — real company facts, static in the markup, so it is present with no JS,
  //                 no network, or a failed fetch.
  //   MARKETS     — real cached prices, added only if the fetch actually succeeds. It is
  //                 labelled "delayed" rather than live: the endpoint serves a cache that
  //                 only the signed-in dashboard's own call ever refreshes, so claiming a
  //                 live feed would be untrue.
  //
  // If the fetch fails the tape simply keeps showing the MARKETSWAVE segment. Fabricated
  // market numbers are never used as a fallback — that was the whole problem with the values
  // this replaced.
  // -------------------------------------------------------------------------------------
  (function heroTape() {
    var track = document.getElementById('hero-tape-track');
    if (!track) return;

    var firmSegment = track.innerHTML;   // captured before anything is swapped in
    var marketSegment = null;
    var showingMarkets = false;
    var ROTATE_MS = 25000;

    function restartScroll() {
      // A CSS animation does not restart on a content change; force a reflow between clearing
      // and restoring it so each segment scrolls from its own beginning.
      track.style.animation = 'none';
      void track.offsetWidth;
      track.style.animation = '';
    }

    function swapTo(html, name) {
      track.classList.add('is-swapping');
      window.setTimeout(function () {
        track.innerHTML = html;
        track.setAttribute('data-segment', name);
        restartScroll();
        track.classList.remove('is-swapping');
      }, 400);
    }

    function rotate() {
      if (!marketSegment) return;              // nothing to rotate between
      showingMarkets = !showingMarkets;
      swapTo(showingMarkets ? marketSegment : firmSegment,
             showingMarkets ? 'markets' : 'marketswave');
    }

    function esc(v) {
      return String(v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function num(v, dp) {
      var n = Number(v);
      if (!isFinite(n)) return null;
      return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    }

    function buildMarkets(payload) {
      var parts = ['<span class="tape-label">Markets</span>',
                   '<span class="tape-note">delayed</span>'];

      (payload.markets || []).forEach(function (m) {
        var value = num(m.value, Math.abs(Number(m.value)) >= 1000 ? 2 : 2);
        if (value === null) return;
        var cp = Number(m.changePercent);
        var change = '';
        if (isFinite(cp)) {
          // A real minus sign, matching the typography the tape already used.
          change = ' <em class="' + (cp < 0 ? 'dn' : 'up') + '">' +
                   (cp < 0 ? '\u2212' : '+') + Math.abs(cp).toFixed(2) + '%</em>';
        }
        parts.push('<span>' + esc(m.symbol) + ' <b>' + value + '</b>' + change + '</span>');
      });

      // Real PM-published fund values, when there are any. These are genuine published NAVs,
      // not simulated prices — the endpoint only ever returns product, price and as-of date.
      (payload.navs || []).forEach(function (n) {
        var price = num(n.price, 2);
        if (price === null) return;
        parts.push('<span>' + esc(n.product) + ' <b>' + price + '</b>' +
                   (n.asOf ? ' <em class="tape-note">as of ' + esc(n.asOf) + '</em>' : '') + '</span>');
      });

      if (parts.length < 4) return null;       // label + note + at least two real rows
      var html = '        ' + parts.join('\n        ') + '\n';
      return html + html;                      // duplicated, same as the static segment
    }

    // The endpoint's URL and public anon key come from supabase-endpoint.js, which was split
    // out of supabase-config.js for exactly this call: that file constructs a real Supabase
    // client at module scope, so importing it here would pull the whole @supabase/supabase-js
    // bundle from a third-party CDN onto a marketing page for a decorative tape.
    // supabase-endpoint.js imports nothing, so this costs one small file and no SDK.
    //
    // It is an ES module and home-hero.js is a classic script, hence the dynamic import —
    // the same technique dashboard-sidebar.js already uses for its own sign-out call. A plain
    // fetch is enough: this is one unauthenticated POST to a public endpoint.
    import('./supabase-endpoint.js').then(function (mod) {
      var cfg = mod.ACTIVE_CONFIG;
      if (!cfg || !cfg.url) return;
      return fetch(cfg.url + '/functions/v1/get-public-market-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.anonKey },
        body: '{}'
      }).then(function (res) {
        return res.ok ? res.json() : null;
      }).then(function (payload) {
        if (!payload) return;
        marketSegment = buildMarkets(payload);
        if (!marketSegment) return;
        // Show the real market data straight away — a visitor should not have to wait 25s to
        // see the segment that actually needed a network call.
        showingMarkets = true;
        swapTo(marketSegment, 'markets');
      });
    }).catch(function () {
      // Offline, blocked, endpoint down, config missing — the static MARKETSWAVE segment is
      // already on screen and stays there. Deliberately silent: a marketing page should not
      // put an error in a visitor's console over a decorative tape.
    });

    window.setInterval(rotate, ROTATE_MS);
  })();


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
  // -------------------------------------------------------------------------------------
  // Hero card hover tilt (design round 2).
  //
  // Applied to .hero-card-inner, never the card itself: the card carries a running float
  // keyframe animation, and a running animation beats an inline style, so a transform set on
  // the card would be silently ignored. Never attached under reduced motion — the CSS gives
  // those visitors a plain static lift on hover instead.
  // -------------------------------------------------------------------------------------
  (function heroCardTilt() {
    if (reduce) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var MAX_DEG = 9;
    [].forEach.call(document.querySelectorAll('.hero-card'), function (card) {
      var inner = card.querySelector('.hero-card-inner');
      if (!inner) return;

      card.addEventListener('pointermove', function (e) {
        var b = card.getBoundingClientRect();
        var px = (e.clientX - b.left) / b.width - 0.5;   // -0.5 .. 0.5
        var py = (e.clientY - b.top) / b.height - 0.5;
        card.classList.add('is-tilting');
        inner.style.transform =
          'rotateX(' + (-py * MAX_DEG).toFixed(2) + 'deg) ' +
          'rotateY(' + (px * MAX_DEG).toFixed(2) + 'deg) ' +
          'translateZ(10px)';
      });

      card.addEventListener('pointerleave', function () {
        card.classList.remove('is-tilting');   // back to the slow easing for the settle
        inner.style.transform = '';
      });
    });
  })();
})();
