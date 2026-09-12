// ★ Portfolio overview (2026-09-12) — renders dashboard.html's overview row from ONE real
// read of get-portfolio-overview: the value chart (real monthly anchors from
// portfolio_value_snapshots plus today's live value), the cross-domain pending-requests
// panel, and the upcoming-maturities panel. Every figure arrives computed from the server;
// this file only formats and draws (row 185: no client-side money computation).
//
// Plain global, same convention as dashboard-sidebar.js / fund-document.js:
//   window.MarketswavePortfolioOverview.render(payload, { valueEl, changeEl, rangesEl,
//     chartWrap, newcEl, pendingEl, maturitiesEl })
//
// THE CHART THRESHOLD. A line through two points is not a chart. The server reports
// `history.chartReady` (>= CHART_MIN_ANCHORS = 3 real stored anchors); below that the card
// shows the honest explanation and the current value as a figure. Today's live value is
// appended as the terminal point when the chart IS shown, and never counts toward the
// threshold. The range controls (3M / 6M / 1Y / All) genuinely FILTER the series by date and
// the axes rescale to the filtered points; a range that would leave fewer than two anchors
// is disabled rather than drawn as a dot.
(function () {
  'use strict';

  var GAIN = '#137254';
  var LOSS = '#A8452F';
  var NAVY = '#1B3A4B';
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

  // ---------------------------------------------------------------- value + change
  function renderValue(h, valueEl, changeEl) {
    valueEl.textContent = formatUSD(Math.round(h.currentValue));
    changeEl.textContent = '';
    if (!h.firstAnchor || !h.changeSinceFirst) {
      changeEl.appendChild(el('span', 'po-pill is-flat', 'No monthly history yet'));
      return;
    }
    var c = h.changeSinceFirst;
    var pill = el('span', 'po-pill ' + (c.amount > 0 ? 'is-up' : c.amount < 0 ? 'is-dn' : 'is-flat'));
    var amt = (c.amount > 0 ? '+' : c.amount < 0 ? '−' : '') + formatUSD(Math.abs(Math.round(c.amount)));
    pill.textContent = c.percent === null ? amt : amt + ' · ' + (c.percent > 0 ? '+' : c.percent < 0 ? '−' : '') + Math.abs(c.percent).toFixed(1) + '%';
    changeEl.appendChild(pill);
    changeEl.appendChild(el('span', 'po-since', 'since ' + fmtMonYYYY(parseDate(h.firstAnchor.date))));
  }

  // ---------------------------------------------------------------- chart
  var RANGES = [{ key: '3', label: '3M', months: 3 }, { key: '6', label: '6M', months: 6 }, { key: '12', label: '1Y', months: 12 }, { key: 'all', label: 'All', months: null }];

  function pointsFor(h, months, now) {
    var live = { date: now.toISOString().slice(0, 10), value: h.currentValue, live: true };
    var anchors = h.anchors.map(function (a) { return { date: a.date, value: a.value, live: false }; });
    if (months === null) return anchors.concat([live]);
    var cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
    return anchors.filter(function (a) { return parseDate(a.date) >= cutoff; }).concat([live]);
  }
  function anchorCount(points) { return points.filter(function (p) { return !p.live; }).length; }

  function renderChart(h, rangesEl, chartWrap, opts) {
    var now = opts && opts.now ? opts.now : new Date();
    var state = { chart: null, range: null };
    rangesEl.textContent = '';
    chartWrap.textContent = '';

    var canvas = el('canvas');
    canvas.id = 'po-chart';
    canvas.setAttribute('role', 'img');
    chartWrap.appendChild(canvas);
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
      xl.textContent = '';
      xl.appendChild(el('span', null, fmtMonYY(parseDate(first.date))));
      if (pts.length > 2) xl.appendChild(el('span', null, fmtMonYY(parseDate(pts[Math.floor((pts.length - 1) / 2)].date))));
      xl.appendChild(el('span', null, 'Today'));

      table.textContent = '';
      var cap = el('caption', null, 'Portfolio value by month, ' + pts.length + ' points');
      table.appendChild(cap);
      var tb = el('tbody');
      pts.forEach(function (p) {
        var tr = el('tr'); tr.appendChild(el('th', null, p.live ? 'Today' : fmtDay(parseDate(p.date)))); tr.appendChild(el('td', null, formatUSD(Math.round(p.value)))); tb.appendChild(tr);
      });
      table.appendChild(tb);
      canvas.setAttribute('aria-label', 'Portfolio value from ' + fmtDay(parseDate(first.date)) + ' (' + formatUSD(Math.round(first.value)) + ') to today (' + formatUSD(Math.round(last.value)) + '), ' + pts.length + ' points');
      hint.textContent = 'Each point is the value recorded at the start of that month; the last point is today’s live value.';

      if (typeof Chart === 'undefined') return;
      var rising = last.value >= first.value;
      var tone = rising ? GAIN : LOSS;
      var labels = pts.map(function (p) { return p.live ? 'Today' : fmtMonYY(parseDate(p.date)); });
      var data = pts.map(function (p) { return p.value; });
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      state.chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Portfolio value',
            data: data,
            borderColor: tone,
            borderWidth: 2.4,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: tone,
            pointHoverBorderWidth: 2.5,
            fill: true,
            backgroundColor: function (ctx) {
              var area = ctx.chart.chartArea;
              if (!area) return 'rgba(19,114,84,0.08)';
              var g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              g.addColorStop(0, rising ? 'rgba(19,114,84,0.18)' : 'rgba(168,69,47,0.18)');
              g.addColorStop(1, rising ? 'rgba(19,114,84,0)' : 'rgba(168,69,47,0)');
              return g;
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 250 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              displayColors: false,
              backgroundColor: '#12283A',
              titleColor: '#F7F6F3',
              bodyColor: '#F7F6F3',
              bodyFont: { family: 'Inter', weight: '600', size: 14 },
              titleFont: { family: 'Inter', size: 11.5 },
              padding: 10,
              callbacks: {
                title: function (items) { var p = pts[items[0].dataIndex]; return p.live ? 'Today · live value' : fmtDay(parseDate(p.date)); },
                label: function (item) { return formatUSD(Math.round(item.parsed.y)); }
              }
            }
          },
          scales: {
            x: { display: false },
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
    body.appendChild(el('p', null, 'We record your portfolio’s total value at the start of each month. Once ' + h.minAnchors + ' of those points exist, this becomes a chart of how it has changed over time — a line through one or two points would not tell you anything real.'));
    body.appendChild(el('div', 'po-newc-fig', formatUSD(Math.round(h.currentValue))));
    var sub = 'Current value';
    if (h.clientSince) sub += ' · client since ' + fmtDay(new Date(h.clientSince));
    body.appendChild(el('div', 'po-newc-sub', sub));
    newcEl.appendChild(body);
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
    renderValue(h, els.valueEl, els.changeEl);
    if (h.chartReady) {
      els.newcEl.classList.add('hidden');
      els.chartWrap.classList.remove('hidden');
      els.rangesEl.classList.remove('hidden');
      renderChart(h, els.rangesEl, els.chartWrap, opts);
    } else {
      els.chartWrap.classList.add('hidden');
      els.rangesEl.classList.add('hidden');
      els.newcEl.classList.remove('hidden');
      renderNewClient(h, els.newcEl);
    }
    renderPending(payload.pending || [], els.pendingEl);
    renderMaturities(payload.maturities || [], els.maturitiesEl);
  }

  window.MarketswavePortfolioOverview = { render: render, formatUSD: formatUSD, pointsFor: pointsFor };
})();
