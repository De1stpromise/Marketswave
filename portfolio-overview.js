// ★ Portfolio overview (2026-09-12; bundled card 2026-09-13) — renders dashboard.html's
// bundled portfolio card and its two side panels from ONE real read of
// get-portfolio-overview: the band's change figures (since the first recorded month, and
// this month), the return-series sparkline, the value chart with its capital-in reference
// line and capital events, the per-range period stats, the CSV export, the cross-domain
// pending-requests panel, and the upcoming-maturities panel. Every figure arrives computed
// from the server; this file only formats and draws (row 185: no client-side money
// computation — the period stats are looked up by range key, never recomputed here).
//
// Plain global, same convention as dashboard-sidebar.js / fund-document.js:
//   window.MarketswavePortfolioOverview.render(payload, { changeEl, thisMonthEl, sparkEl,
//     legendEl, rangesEl, chartWrap, newcEl, statsEl, exportBtn, asOfEl,
//     pendingEl, maturitiesEl })
//
// THE CHART THRESHOLD. A line through two points is not a chart. The server reports
// `history.chartReady` (>= CHART_MIN_ANCHORS = 3 real stored anchors); below that the card
// shows the honest explanation, no change-since figure, no sparkline and no period stats —
// the server itself withholds `changeSinceFirst` and `periodStats` under the threshold,
// since a lone $0 anchor written before an account was funded once read as "+$94,874 since
// Sep 2026" on the live site. Today's live value is appended as the terminal point when the
// chart IS shown, and never counts toward the threshold.
//
// THE CHART SECTION NEVER STATES THE CURRENT VALUE. The band's lead cell above it does,
// once; this section answers "how has it changed" (2026-09-12).
//
// CAPITAL IN. The dashed grey line is `history.capitalIn.events` — the ledger's deposits,
// withdrawals and transfers into savings, cumulative — stepped at each event's real date
// (a duplicate x at the step, so no reliance on Chart.js's stepped-segment semantics).
// The portfolio line is drawn with straight segments (tension 0) DELIBERATELY: the event
// dots sit on the line at a linearly interpolated y, which is exact only for straight
// segments; and a straight line between monthly points is the honest picture of "we have
// one point a month". The tooltip's Capital in / Return rows are the SERVER's per-anchor
// figures (capital in as of the moment that anchor was recorded), never a client-side
// difference.
//
// The range controls (3M / 6M / 1Y / All) genuinely FILTER the series by date (the same
// cutoff rule the server uses for periodStats) and the axes rescale to the filtered points;
// a range that would leave fewer than two anchors is disabled rather than drawn as a dot.
(function () {
  'use strict';

  var GAIN = '#137254';
  var LOSS = '#A8452F';
  var NAVY = '#1B3A4B';
  var CAPITAL = '#7C868C';
  var GOLD = '#C8860A';
  var DAY = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatUSD(n, decimals) {
    var d = typeof decimals === 'number' ? decimals : 0;
    var neg = n < 0;
    var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return (neg ? '−' : '') + '$' + s;
  }
  function compactUSD(n) {
    var a = Math.abs(n);
    if (a >= 1e6) return (n < 0 ? '−' : '') + '$' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'm';
    if (a >= 1e3) return (n < 0 ? '−' : '') + '$' + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
    return formatUSD(n);
  }
  function parseDate(s) { return new Date(String(s).length === 10 ? s + 'T00:00:00Z' : s); }
  function fmtDay(d) { return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function fmtMonYY(d) { return MONTHS[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); }
  function fmtMonYYYY(d) { return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function svgIcon(kind) {
    var paths = {
      chart: '<path d="M3 3v18h18"/><path d="M18.7 8 12 14.7l-3.5-3.5L3 16.4"/>',
      down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
      up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
      lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      swap: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'
    };
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = paths[kind] || paths.chart; // fixed markup from this file, never data
    return s;
  }

  function signed(n, fmt) {
    return (n > 0 ? '+' : n < 0 ? '\u2212' : '') + fmt(Math.abs(n));
  }
  function signedPct1(p) { return signed(p, function (a) { return a.toFixed(1) + '%'; }); }
  function tone(n) { return n > 0 ? 'is-up' : n < 0 ? 'is-dn' : 'is-flat'; }

  // ---------------------------------------------------------------- band: both horizons
  // Since the first recorded month — a pill plus "since <month>". Shown only once the chart
  // is (the server sends changeSinceFirst null below the threshold); with nothing to show the
  // span is hidden rather than filled with a caveat.
  function renderChange(h, changeEl) {
    changeEl.textContent = '';
    if (!h.chartReady || !h.firstAnchor || !h.changeSinceFirst) {
      changeEl.hidden = true;
      return;
    }
    changeEl.hidden = false;
    var c = h.changeSinceFirst;
    var pill = el('span', 'po-pill ' + tone(c.amount));
    var amt = signed(Math.round(c.amount), function (a) { return formatUSD(a); });
    pill.textContent = c.percent === null ? amt : amt + ' \u00b7 ' + signedPct1(c.percent);
    changeEl.appendChild(pill);
    changeEl.appendChild(el('span', 'po-since', 'since ' + fmtMonYYYY(parseDate(h.firstAnchor.date))));
  }
  // This month — the current month's anchor against the live value, as a figure. A month that
  // opened at $0 with money now has no honest change figure ("+$94,874 this month" is the
  // row-205 bug on a shorter horizon): it reads "New this month" instead.
  function renderThisMonth(h, thisMonthEl, changeShown) {
    thisMonthEl.textContent = '';
    thisMonthEl.className = 'po-tm';
    var t = h.thisMonth;
    if (!t) { thisMonthEl.hidden = true; return; }
    thisMonthEl.hidden = false;
    if (changeShown) thisMonthEl.appendChild(el('span', 'po-sep', '\u00b7'));
    if (t.percent === null) { thisMonthEl.appendChild(el('span', null, 'New this month')); return; }
    var b = el('b', tone(t.amount), signed(Math.round(t.amount), function (a) { return formatUSD(a); }));
    thisMonthEl.appendChild(b);
    thisMonthEl.appendChild(el('span', null, (t.percent === 0 ? '' : '(' + signedPct1(t.percent) + ') ') + 'this month'));
  }

  // ---------------------------------------------------------------- band: return sparkline
  // The RETURN series (each anchor's value minus capital in, then today's), 70x26, from the
  // same points the chart plots. A sparkline that climbed on a deposit would contradict the
  // very cell it decorates. Gated on the chart threshold like everything else drawn from
  // the anchors.
  function renderSparkline(h, sparkEl) {
    sparkEl.textContent = '';
    if (!h.chartReady) { sparkEl.hidden = true; return; }
    var series = h.anchors.map(function (a) { return a.return; }).concat([h.live.return]);
    var min = Math.min.apply(null, series), max = Math.max.apply(null, series);
    var span = max - min || 1;
    var W = 70, H = 26, pad = 2;
    var d = series.map(function (v, i) {
      var x = (i / (series.length - 1)) * W;
      var y = pad + (1 - (v - min) / span) * (H - pad * 2);
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', series[series.length - 1] >= series[0] ? GAIN : LOSS);
    sparkEl.appendChild(path);
    sparkEl.hidden = false;
  }

  // ---------------------------------------------------------------- chart
  var RANGES = [{ key: '3', label: '3M', months: 3 }, { key: '6', label: '6M', months: 6 }, { key: '12', label: '1Y', months: 12 }, { key: 'all', label: 'All', months: null }];

  // The same cutoff rule _shared/portfolio-overview.ts uses for periodStats: an anchor is in
  // an N-month range when its label date is on or after today minus N months.
  function pointsFor(h, months, now) {
    var live = { date: now.toISOString().slice(0, 10), value: h.currentValue, capitalIn: h.live ? h.live.capitalIn : null, ret: h.live ? h.live.return : null, live: true };
    var anchors = h.anchors.map(function (a) { return { date: a.date, value: a.value, capitalIn: a.capitalIn, ret: a.return, live: false }; });
    if (months === null) return anchors.concat([live]);
    var cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
    return anchors.filter(function (a) { return parseDate(a.date) >= cutoff; }).concat([live]);
  }
  function anchorCount(points) { return points.filter(function (p) { return !p.live; }).length; }
  function xOf(dateStr) { return parseDate(dateStr).getTime() / DAY; }

  // The capital-in step series for a range: the level before the first point, then a
  // vertical step (duplicate x) at every event inside the range, then the level today.
  function capitalSeriesFor(h, pts) {
    var events = (h.capitalIn && h.capitalIn.events) || [];
    var x0 = xOf(pts[0].date), x1 = xOf(pts[pts.length - 1].date);
    var level = 0;
    var out = [];
    events.forEach(function (e) {
      var x = xOf(e.date);
      if (x < x0) { level = e.cumulativeAfter; return; }
      if (x > x1) return;
      if (!out.length) out.push({ x: x0, y: level });
      out.push({ x: x, y: level });
      level = e.cumulativeAfter;
      out.push({ x: x, y: level });
    });
    if (!out.length) out.push({ x: x0, y: level });
    out.push({ x: x1, y: level });
    return out;
  }
  // Linear y on the portfolio line at x — exact for straight segments (tension 0).
  function valueOnLineAt(pts, x) {
    for (var i = 0; i < pts.length - 1; i++) {
      var xa = xOf(pts[i].date), xb = xOf(pts[i + 1].date);
      if (x >= xa && x <= xb) {
        if (xb === xa) return pts[i + 1].value;
        return pts[i].value + (pts[i + 1].value - pts[i].value) * ((x - xa) / (xb - xa));
      }
    }
    return null;
  }
  function eventPointsFor(h, pts) {
    var events = (h.capitalIn && h.capitalIn.events) || [];
    var x0 = xOf(pts[0].date), x1 = xOf(pts[pts.length - 1].date);
    var out = [];
    events.forEach(function (e) {
      var x = xOf(e.date);
      if (x < x0 || x > x1) return;
      var y = valueOnLineAt(pts, x);
      if (y === null) return;
      out.push({ x: x, y: y, event: e });
    });
    return out;
  }

  function renderStats(stats, statsEl) {
    statsEl.textContent = '';
    if (!stats) { statsEl.hidden = true; return; }
    statsEl.hidden = false;
    function cell(k, v, vcls, sub) {
      var d = el('div');
      d.appendChild(el('div', 'ret-k', k));
      d.appendChild(el('div', 'po-pv' + (vcls ? ' ' + vcls : ''), v));
      d.appendChild(el('div', 'po-ps', sub));
      statsEl.appendChild(d);
    }
    var pointLabel = function (p) { return p.live ? 'Today' : fmtDay(parseDate(p.date)); };
    cell('Period high', formatUSD(Math.round(stats.high.value)), null, pointLabel(stats.high));
    cell('Period low', formatUSD(Math.round(stats.low.value)), null, pointLabel(stats.low));
    var monthLabel = function (m) { return fmtMonYYYY(parseDate(m + '-01')); };
    if (stats.bestMonth) cell('Best month', signedPct1(stats.bestMonth.percent), tone(stats.bestMonth.percent), monthLabel(stats.bestMonth.month));
    else cell('Best month', '\u2014', null, 'Needs two full months');
    if (stats.worstMonth) cell('Worst month', signedPct1(stats.worstMonth.percent), tone(stats.worstMonth.percent), monthLabel(stats.worstMonth.month));
    else cell('Worst month', '\u2014', null, 'Needs two full months');
  }

  function renderChart(h, els, opts) {
    var now = opts && opts.now ? opts.now : new Date();
    var rangesEl = els.rangesEl, chartWrap = els.chartWrap;
    var state = { chart: null, range: null };
    rangesEl.textContent = '';
    chartWrap.textContent = '';

    var canvas = el('canvas');
    canvas.id = 'po-chart';
    canvas.setAttribute('role', 'img');
    chartWrap.appendChild(canvas);
    var tip = el('div', 'po-tip');
    tip.id = 'po-tip';
    tip.setAttribute('aria-hidden', 'true');
    chartWrap.appendChild(tip);
    var xl = el('div', 'po-xl');
    chartWrap.parentNode.insertBefore(xl, chartWrap.nextSibling);
    var table = el('table', 'po-visually-hidden');
    table.id = 'po-chart-table';
    chartWrap.parentNode.insertBefore(table, xl.nextSibling);
    var hint = el('p', 'po-hint');
    hint.id = 'po-chart-hint';
    chartWrap.parentNode.insertBefore(hint, table.nextSibling);

    function draw(rangeKey) {
      var r = RANGES.filter(function (x) { return x.key === rangeKey; })[0];
      var pts = pointsFor(h, r.months, now);
      state.range = rangeKey;
      Array.prototype.forEach.call(rangesEl.querySelectorAll('.po-rg'), function (b) {
        var on = b.dataset.range === rangeKey;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      var first = pts[0], last = pts[pts.length - 1];
      var capital = capitalSeriesFor(h, pts);
      var events = eventPointsFor(h, pts);
      var hasOut = events.some(function (e) { return e.event.kind !== 'deposit'; });
      if (els.legendOutEl) els.legendOutEl.hidden = !hasOut;

      xl.textContent = '';
      xl.appendChild(el('span', null, fmtMonYY(parseDate(first.date))));
      if (pts.length > 2) xl.appendChild(el('span', null, fmtMonYY(parseDate(pts[Math.floor((pts.length - 1) / 2)].date))));
      xl.appendChild(el('span', null, 'Today'));

      table.textContent = '';
      var cap = el('caption', null, 'Portfolio value by month, ' + pts.length + ' points, with capital in and return at each');
      table.appendChild(cap);
      var thead = el('thead'); var hr = el('tr');
      ['Date', 'Portfolio value', 'Capital in', 'Return'].forEach(function (t) { hr.appendChild(el('th', null, t)); });
      thead.appendChild(hr); table.appendChild(thead);
      var tb = el('tbody');
      pts.forEach(function (p) {
        var tr = el('tr');
        tr.appendChild(el('th', null, p.live ? 'Today' : fmtDay(parseDate(p.date))));
        tr.appendChild(el('td', null, formatUSD(Math.round(p.value))));
        tr.appendChild(el('td', null, p.capitalIn === null ? '\u2014' : formatUSD(Math.round(p.capitalIn))));
        tr.appendChild(el('td', null, p.ret === null ? '\u2014' : signed(Math.round(p.ret), formatUSD)));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      canvas.setAttribute('aria-label', 'Portfolio value from ' + fmtDay(parseDate(first.date)) + ' (' + formatUSD(Math.round(first.value)) + ') to today (' + formatUSD(Math.round(last.value)) + '), ' + pts.length + ' points, against capital in');
      hint.textContent = 'Each point is the value recorded at the start of that month; the last point is today\u2019s live value. The dashed line is capital in \u2014 deposits less withdrawals and transfers to savings \u2014 so the gap between the lines is your return.';

      renderStats(h.periodStats ? h.periodStats[rangeKey] : null, els.statsEl);

      if (typeof Chart === 'undefined') return;
      var rising = last.value >= first.value;
      var lineTone = rising ? GAIN : LOSS;
      var portfolio = pts.map(function (p) { return { x: xOf(p.date), y: p.value }; });
      if (state.chart) { state.chart.destroy(); state.chart = null; }

      var hoverGuide = {
        id: 'poHoverGuide',
        afterDatasetsDraw: function (chart) {
          var active = chart.getActiveElements ? chart.getActiveElements() : [];
          if (!active.length) return;
          var e = active[0].element;
          var ctx = chart.ctx, area = chart.chartArea;
          ctx.save();
          ctx.strokeStyle = 'rgba(19,114,84,0.25)';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(e.x, area.top); ctx.lineTo(e.x, area.bottom); ctx.stroke();
          ctx.restore();
        }
      };

      function externalTooltip(ctx) {
        var t = ctx.tooltip;
        if (!t || t.opacity === 0 || !t.dataPoints || !t.dataPoints.length) { tip.classList.remove('is-on'); return; }
        var dp = t.dataPoints[0];
        tip.textContent = '';
        if (dp.datasetIndex === 2) {
          var ev = events[dp.dataIndex].event;
          var label = ev.kind === 'deposit' ? 'Deposit' : ev.kind === 'withdrawal' ? 'Withdrawal' : 'Transfer to savings';
          tip.appendChild(el('div', 'po-td', fmtDay(new Date(ev.date))));
          var row = el('div', 'po-tr'); row.appendChild(el('span', null, label));
          row.appendChild(el('b', ev.kind === 'deposit' ? 'is-up' : null, (ev.kind === 'deposit' ? '+' : '\u2212') + formatUSD(ev.amount, ev.amount % 1 ? 2 : 0)));
          tip.appendChild(row);
          var row2 = el('div', 'po-tr'); row2.appendChild(el('span', null, 'Capital in after'));
          row2.appendChild(el('b', null, formatUSD(Math.round(ev.cumulativeAfter)))); tip.appendChild(row2);
        } else if (dp.datasetIndex === 0) {
          var p = pts[dp.dataIndex];
          tip.appendChild(el('div', 'po-td', p.live ? 'Today \u00b7 live value' : fmtDay(parseDate(p.date))));
          var r1 = el('div', 'po-tr'); r1.appendChild(el('span', null, 'Portfolio')); r1.appendChild(el('b', null, formatUSD(Math.round(p.value)))); tip.appendChild(r1);
          var r2 = el('div', 'po-tr'); r2.appendChild(el('span', null, 'Capital in')); r2.appendChild(el('b', null, formatUSD(Math.round(p.capitalIn)))); tip.appendChild(r2);
          var r3 = el('div', 'po-tr'); r3.appendChild(el('span', null, 'Return')); r3.appendChild(el('b', tone(p.ret), signed(Math.round(p.ret), formatUSD))); tip.appendChild(r3);
        } else { tip.classList.remove('is-on'); return; }
        var wrapW = chartWrap.clientWidth || 600;
        var left = t.caretX + 14;
        if (left + 170 > wrapW) left = Math.max(0, t.caretX - 184);
        tip.style.left = left + 'px';
        tip.style.top = Math.max(0, t.caretY - 60) + 'px';
        tip.classList.add('is-on');
      }

      state.chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          datasets: [{
            label: 'Portfolio value',
            data: portfolio,
            borderColor: lineTone,
            borderWidth: 2.2,
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: lineTone,
            pointHoverBorderWidth: 2.5,
            fill: true,
            order: 2,
            backgroundColor: function (c) {
              var area = c.chart.chartArea;
              if (!area) return 'rgba(19,114,84,0.08)';
              var g = c.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              g.addColorStop(0, rising ? 'rgba(19,114,84,0.17)' : 'rgba(168,69,47,0.17)');
              g.addColorStop(1, rising ? 'rgba(19,114,84,0)' : 'rgba(168,69,47,0)');
              return g;
            }
          }, {
            label: 'Capital in',
            data: capital,
            borderColor: CAPITAL,
            borderWidth: 1.4,
            borderDash: [4, 4],
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            order: 3
          }, {
            label: 'Capital events',
            type: 'scatter',
            data: events.map(function (e) { return { x: e.x, y: e.y }; }),
            pointRadius: 4.5,
            pointHoverRadius: 6,
            pointBackgroundColor: events.map(function (e) { return e.event.kind === 'deposit' ? GOLD : '#ffffff'; }),
            pointBorderColor: events.map(function (e) { return e.event.kind === 'deposit' ? '#ffffff' : GOLD; }),
            pointBorderWidth: 1.5,
            order: 1
          }]
        },
        plugins: [hoverGuide],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 250 },
          interaction: { mode: 'nearest', intersect: false, axis: 'x' },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false, external: externalTooltip }
          },
          scales: {
            x: { type: 'linear', display: false, min: portfolio[0].x, max: portfolio[portfolio.length - 1].x },
            y: {
              grid: { color: 'rgba(27,58,75,0.08)', drawBorder: false },
              border: { display: false },
              ticks: { color: '#475569', font: { family: 'Inter', size: 10.5 }, maxTicksLimit: 5, callback: function (v) { return compactUSD(v); } }
            }
          }
        }
      });
    }

    RANGES.forEach(function (r) {
      var b = el('button', 'po-rg mw-btn mw-btn-sm', r.label);
      b.type = 'button';
      b.dataset.range = r.key;
      var n = anchorCount(pointsFor(h, r.months, now));
      if (n < 2) { b.disabled = true; b.title = 'Not enough monthly points in this range yet'; }
      b.addEventListener('click', function () { if (!b.disabled) draw(r.key); });
      rangesEl.appendChild(b);
    });
    // Default: 1Y when it holds enough points, otherwise the smallest range that does.
    var initial = anchorCount(pointsFor(h, 12, now)) >= 3 ? '12' : 'all';
    draw(initial);
    return state;
  }

  function renderNewClient(h, newcEl) {
    newcEl.textContent = '';
    newcEl.appendChild(svgIcon('chart'));
    var body = el('div');
    body.appendChild(el('b', null, h.anchorCount === 0 ? 'Your value chart appears after your first full month' : 'Your value chart appears after ' + h.minAnchors + ' monthly points (' + h.anchorCount + ' so far)'));
    body.appendChild(el('p', null, 'We record your portfolio\u2019s total value at the start of each month. Once ' + h.minAnchors + ' of those points exist, this becomes a chart of how it has changed over time against the capital you have put in \u2014 a line through one or two points would not tell you anything real.'));
    // No figure here: the band above already states it (see the header).
    if (h.clientSince) body.appendChild(el('div', 'po-newc-sub', 'Client since ' + fmtDay(new Date(h.clientSince))));
    newcEl.appendChild(body);
  }

  // ---------------------------------------------------------------- export
  // CSV of the snapshot series: one row per recorded anchor plus today, with the capital in
  // and return the server paired with each. Built from the payload already on the page —
  // no second read, nothing recomputed.
  function buildCSV(h) {
    var rows = [['Date', 'Portfolio value', 'Capital in', 'Return']];
    h.anchors.forEach(function (a) { rows.push([a.date, a.value.toFixed(2), a.capitalIn.toFixed(2), a.return.toFixed(2)]); });
    if (h.live) rows.push([h.live.date + ' (live)', h.live.value.toFixed(2), h.live.capitalIn.toFixed(2), h.live.return.toFixed(2)]);
    return rows.map(function (r) { return r.map(function (c) { return /[",\n]/.test(c) ? '"' + String(c).replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n') + '\r\n';
  }
  function wireExport(h, btn) {
    if (!btn) return;
    btn.disabled = !h.anchors.length && !h.live;
    btn.onclick = function () {
      var csv = buildCSV(h);
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
      var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      var a = el('a'); a.href = url; a.download = 'marketswave-portfolio-value-' + (h.live ? h.live.date : 'history') + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    };
  }

  // ---------------------------------------------------------------- as-of indicator
  var asOfTimer = null;
  function renderAsOf(asOfEl, at) {
    if (!asOfEl) return;
    function paint() {
      var mins = Math.floor((Date.now() - at) / 60000);
      var text = mins < 1 ? 'Updated just now' : 'Updated ' + mins + ' min ago';
      asOfEl.textContent = '';
      var dot = el('i'); dot.setAttribute('aria-hidden', 'true'); asOfEl.appendChild(dot);
      asOfEl.appendChild(document.createTextNode(text));
    }
    paint();
    if (asOfTimer) clearInterval(asOfTimer);
    asOfTimer = setInterval(paint, 60000);
  }

  // ---------------------------------------------------------------- pending requests
  var ICON_FOR = { deposit: ['dep', 'down'], withdrawal: ['wd', 'up'], allocation: ['alo', 'chart'], sell: ['alo', 'chart'], hys_deposit: ['hys', 'lock'], hys_withdrawal: ['hys', 'lock'], profile_change: ['prof', 'user'] };

  function renderPending(list, container) {
    container.textContent = '';
    if (!list.length) {
      var e = el('div', 'po-empty');
      var ei = el('div', 'po-ei'); ei.appendChild(svgIcon('check')); e.appendChild(ei);
      e.appendChild(el('b', null, 'Nothing pending'));
      e.appendChild(el('p', null, 'Deposits, withdrawals, allocations, sells, savings pockets and profile changes you request appear here while your portfolio manager reviews them.'));
      container.appendChild(e);
      return;
    }
    list.forEach(function (r) {
      var row = el('a', 'po-row');
      row.href = r.href;
      row.dataset.requestId = r.id;
      row.dataset.requestType = r.type;
      var ic = ICON_FOR[r.type] || ['alo', 'chart'];
      var icon = el('div', 'po-ic ' + ic[0]); icon.appendChild(svgIcon(r.internalTransfer ? 'swap' : ic[1])); row.appendChild(icon);
      var rb = el('div', 'po-rb');
      rb.appendChild(el('div', 'po-rt', r.title));
      rb.appendChild(el('div', 'po-rs', 'Requested ' + fmtDay(new Date(r.requestedAt)) + ' · ' + r.detail));
      row.appendChild(rb);
      var ra = el('div', 'po-ra');
      ra.appendChild(el('div', 'po-v', r.amount !== null ? formatUSD(r.amount, r.amount % 1 ? 2 : 0) : r.units !== null ? String(r.units) + ' units' : '—'));
      var chips = el('div');
      chips.appendChild(el('span', 'po-chip', 'Pending'));
      if (r.internalTransfer) chips.appendChild(el('span', 'po-chip is-internal', 'Internal transfer'));
      ra.appendChild(chips);
      row.appendChild(ra);
      container.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- maturities
  function renderMaturities(list, container) {
    container.textContent = '';
    if (!list.length) {
      var e = el('div', 'po-empty');
      var ei = el('div', 'po-ei'); ei.appendChild(svgIcon('lock')); e.appendChild(ei);
      e.appendChild(el('b', null, 'No savings pockets yet'));
      e.appendChild(el('p', null, 'Fixed-term pockets you open will show their maturity date, days remaining and interest accrued here; flexible pockets show their balance.'));
      container.appendChild(e);
      return;
    }
    list.forEach(function (m) {
      var row = el('div', 'po-mat');
      row.dataset.pocketId = m.id;
      row.dataset.kind = m.kind;
      var r1 = el('div', 'po-mr1');
      r1.appendChild(el('span', 'po-mn', m.name));
      r1.appendChild(el('span', 'po-mv', formatUSD(m.amount, m.amount % 1 ? 2 : 0)));
      row.appendChild(r1);
      var r2 = el('div', 'po-mr2');
      if (m.kind === 'fixed') {
        var md = m.status === 'matured'
          ? 'Matured ' + fmtDay(new Date(m.maturityDate)) + ' · ready to withdraw'
          : 'Matures ' + fmtDay(new Date(m.maturityDate)) + ' · ' + m.daysRemaining + ' day' + (m.daysRemaining === 1 ? '' : 's');
        r2.appendChild(el('span', 'po-md', md));
        r2.appendChild(el('span', 'po-mi', '+' + formatUSD(m.interestAccrued, 2) + (m.status === 'matured' ? ' interest' : ' accrued · ' + formatUSD(m.interestAtMaturity, 2) + ' at maturity')));
        row.appendChild(r2);
        var bar = el('div', 'po-bar');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(m.progressPercent)));
        bar.setAttribute('aria-label', 'Progress toward term');
        var fill = el('i'); fill.style.width = Math.max(0, Math.min(100, m.progressPercent)) + '%'; bar.appendChild(fill);
        row.appendChild(bar);
      } else {
        r2.appendChild(el('span', 'po-md', 'No fixed term · withdraw anytime'));
        r2.appendChild(el('span', 'po-mi is-none', 'No interest · flexible access'));
        row.appendChild(r2);
      }
      container.appendChild(row);
    });
  }

  function render(payload, els, opts) {
    var h = payload.history;
    renderChange(h, els.changeEl);
    if (els.thisMonthEl) renderThisMonth(h, els.thisMonthEl, !els.changeEl.hidden);
    if (els.sparkEl) renderSparkline(h, els.sparkEl);
    if (h.chartReady) {
      els.newcEl.classList.add('hidden');
      els.chartWrap.classList.remove('hidden');
      els.rangesEl.classList.remove('hidden');
      if (els.legendEl) els.legendEl.hidden = false;
      renderChart(h, els, opts);
    } else {
      els.chartWrap.classList.add('hidden');
      els.rangesEl.classList.add('hidden');
      if (els.legendEl) els.legendEl.hidden = true;
      if (els.statsEl) { els.statsEl.hidden = true; els.statsEl.textContent = ''; }
      els.newcEl.classList.remove('hidden');
      renderNewClient(h, els.newcEl);
    }
    wireExport(h, els.exportBtn);
    renderAsOf(els.asOfEl, opts && opts.at ? opts.at : Date.now());
    renderPending(payload.pending || [], els.pendingEl);
    renderMaturities(payload.maturities || [], els.maturitiesEl);
  }

  window.MarketswavePortfolioOverview = { render: render, formatUSD: formatUSD, pointsFor: pointsFor, capitalSeriesFor: capitalSeriesFor, eventPointsFor: eventPointsFor, buildCSV: buildCSV };
})();
