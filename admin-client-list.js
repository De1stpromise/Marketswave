// ★ PM tool revamp, part 5 (2026-09-15) — the client list (register row 235).
//
// ★★ THE PRECEDENCE RULE THIS PAGE EXISTS TO GET RIGHT:
//   SUPABASE IS AUTHORITATIVE FOR ANY CLIENT WHO EXISTS THERE.
//   The local engine is a fallback ONLY for clients who exist nowhere else.
//
// The old page had this exactly backwards — it merged localClients.concat(supabaseClients) with
// LOCAL winning the dedup, so a client mirrored into this browser by a past sign-in shadowed
// their real Supabase record and their money was read from localStorage, where a PM's browser
// holds none. Gary and Manuel rendered $0 while genuinely holding $32k and $94k. Reproduced by
// mirroring Gary locally: his row flipped from $32,013 to $0. John Doe was never affected
// because he is genuinely local-only, which is why "no badge" did not universally mean zero.
//
// One read (get-client-list) settles the catalogue once and returns every Supabase client plus
// the strip totals. Local-only clients are appended afterwards and can never displace one.
//
// ★ AND: a figure that could not be computed renders as "unavailable", NEVER as $0. A zero and
// a failed read must not look the same — that is what hid the bug above for as long as it did.
(function () {
  'use strict';

  var D = document;
  var state = { rows: [], strip: null, filter: 'all', type: null, q: '', sort: 'value', dir: 'desc', dormantDays: 60 };

  function usd(n, opts) {
    if (n === null || n === undefined) return '—';
    var o = opts || {};
    return (n < 0 ? '−' : (o.sign ? '+' : '')) + '$' +
      Math.abs(Number(n)).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function initials(name) {
    if (window.getClientInitials) { try { return window.getClientInitials(name); } catch (e) {} }
    var p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
  }

  // ---- load: Supabase first, local ONLY as a fallback ----------------------------------------
  var cache = null;
  function load() {
    if (cache) return cache;
    cache = (async function () {
      MarketswaveData.useAdminClient();
      var payload = await MarketswaveData.callFunction('get-client-list', {});
      var rows = payload.clients.slice();
      var seen = {};
      rows.forEach(function (r) { seen[r.id] = true; });

      // ★ Local-only clients are APPENDED, never merged over. A local record for a client who
      // also exists in Supabase is a stale shadow of an authoritative row and is discarded.
      try {
        if (typeof getAllClients === 'function') {
          getAllClients().forEach(function (c) {
            if (seen[c.id]) return; // Supabase wins. Always.
            var value = null;
            try { value = typeof getTotalPortfolioValue === 'function' ? getTotalPortfolioValue(c.id) : null; }
            catch (e) { value = null; }
            rows.push({
              id: c.id, name: c.name, email: c.email, phone: c.phone,
              accountType: c.accountType, status: c.status || 'active',
              createdAt: c.createdAt || null,
              valueAvailable: value !== null && value !== undefined,
              portfolioValue: value === undefined ? null : value,
              unallocated: 0, pendingCount: 0, holdingsCount: 0,
              totalReturn: null, returnPercent: null, idlePercent: null,
              dormant: false, dormantDays: null,
              funded: !!value, localOnly: true
            });
          });
        }
      } catch (e) { /* the local engine is a fallback; its absence is not an error */ }
      return { rows: rows, strip: payload.strip, dormantDays: payload.dormantDays };
    })();
    return cache;
  }
  function reload() { cache = null; return load(); }

  // ---- filtering, search, sort ---------------------------------------------------------------
  function visible() {
    var rows = state.rows.slice();
    var q = state.q.trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) {
        return String(r.name || '').toLowerCase().indexOf(q) !== -1 ||
               String(r.email || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    if (state.type) rows = rows.filter(function (r) { return r.accountType === state.type; });
    if (state.filter === 'active') rows = rows.filter(function (r) { return r.status === 'active' && !r.dormant; });
    else if (state.filter === 'pending') rows = rows.filter(function (r) { return r.status === 'pending_review'; });
    else if (state.filter === 'requests') rows = rows.filter(function (r) { return r.pendingCount > 0; });
    else if (state.filter === 'dormant') rows = rows.filter(function (r) { return r.dormant; });

    var dir = state.dir === 'asc' ? 1 : -1;
    var key = state.sort;
    rows.sort(function (a, b) {
      if (key === 'name') return dir * String(a.name || '').localeCompare(String(b.name || ''));
      if (key === 'type') return dir * String(a.accountType || '').localeCompare(String(b.accountType || ''));
      if (key === 'pending') return dir * ((a.pendingCount || 0) - (b.pendingCount || 0));
      if (key === 'unallocated') return dir * ((a.unallocated || 0) - (b.unallocated || 0));
      if (key === 'status') return dir * String(a.status || '').localeCompare(String(b.status || ''));
      // value: a row whose figure is unavailable sorts last in either direction rather than
      // being treated as zero.
      var av = a.valueAvailable ? (a.portfolioValue || 0) : null;
      var bv = b.valueAvailable ? (b.portfolioValue || 0) : null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir * (av - bv);
    });
    return rows;
  }

  function counts() {
    var r = state.rows;
    return {
      all: r.length,
      active: r.filter(function (x) { return x.status === 'active' && !x.dormant; }).length,
      pending: r.filter(function (x) { return x.status === 'pending_review'; }).length,
      requests: r.filter(function (x) { return x.pendingCount > 0; }).length,
      dormant: r.filter(function (x) { return x.dormant; }).length
    };
  }

  // ---- render --------------------------------------------------------------------------------
  function renderStrip(d) {
    var s = d.strip;
    var aumSub = s.aumMonthChange === null
      ? ('month change not available · anchors for ' + s.aumAnchorCoverage)
      : (usd(s.aumMonthChange, { sign: true }) + ' this month');
    var aumCls = s.aumMonthChange === null ? '' : (s.aumMonthChange < 0 ? 'cl-dn' : 'cl-up');
    var unavailable = s.valueUnavailable > 0
      ? ('<div class="cl-x cl-dn">' + s.valueUnavailable + ' could not be valued</div>') : '';
    return [
      card('Clients', String(d.rows.length), s.active + ' active · ' + s.pendingApproval + ' pending approval'),
      card('Assets under management', usd(s.aum), '<span class="' + aumCls + '">' + esc(aumSub) + '</span>' + unavailable),
      card('Awaiting your approval', String(s.pendingTotal),
        s.pendingTotal ? ('across ' + s.pendingClients + ' client' + (s.pendingClients === 1 ? '' : 's')) : 'nothing pending',
        s.pendingTotal > 0),
      card('Unallocated across clients', usd(s.unallocatedTotal), 'not deployed', s.unallocatedTotal > 0)
    ].join('');
  }
  function card(k, v, x, warn) {
    return '<div class="cl-hc' + (warn ? ' is-warn' : '') + '"><div class="cl-k">' + esc(k) + '</div>' +
      '<div class="cl-v">' + v + '</div><div class="cl-x">' + x + '</div></div>';
  }

  function renderFilters() {
    var c = counts();
    var defs = [
      ['all', 'All', c.all], ['active', 'Active', c.active], ['pending', 'Pending', c.pending],
      ['requests', 'Has pending requests', c.requests], ['dormant', 'Dormant', c.dormant]
    ];
    var html = defs.map(function (d) {
      return '<button type="button" class="cl-fp" data-cl-filter="' + d[0] + '" aria-pressed="' +
        (state.filter === d[0]) + '">' + esc(d[1]) + '<span class="cl-n">' + d[2] + '</span></button>';
    }).join('');
    html += ['Individual Account', 'Joint Account', 'Business Account'].map(function (t) {
      return '<button type="button" class="cl-fp" data-cl-type="' + esc(t) + '" aria-pressed="' +
        (state.type === t) + '">' + esc(t.replace(' Account', '')) + '</button>';
    }).join('');
    return html;
  }

  function renderHead() {
    // The shared sortable header (format-helpers.js + .mw-sort, register row 252): the page
    // keeps its own dispatch attribute, the cell's markup is the vocabulary's.
    var col = function (key, label, right) {
      return '<span' + (right ? ' class="cl-r"' : '') + '>' +
        sortHeaderHTML({ attr: 'data-cl-sort', key: key, label: label, dir: state.sort === key ? state.dir : null, end: !!right }) +
        '</span>';
    };
    return '<span></span>' + col('name', 'Client') + col('type', 'Type') +
      col('value', 'Portfolio', true) + col('unallocated', 'Unallocated', true) +
      col('pending', 'Pending', true) + col('status', 'Status') + '<span></span>';
  }

  function statusCell(r) {
    if (r.status === 'pending_review') return '<span class="cl-stp cl-s-pend">Awaiting approval</span>';
    if (r.status === 'rejected') return '<span class="cl-stp cl-s-rej">Rejected</span>';
    if (r.dormant) return '<span class="cl-stp cl-s-dorm">Dormant ' + r.dormantDays + 'd</span>';
    return '<span class="cl-stp cl-s-act">Active</span>';
  }

  // ★ THREE DISTINCT STATES. An unfunded client says so; a value that could not be computed
  // says so; only a real zero renders as a figure. Collapsing these is what hid the bug.
  function valueCell(r) {
    if (!r.valueAvailable) {
      return '<div class="cl-mny is-unavailable cl-r" data-cl-value="unavailable">Unavailable' +
        '<span>could not be valued</span></div>';
    }
    if (!r.funded) {
      return '<div class="cl-mny is-unfunded cl-r" data-cl-value="unfunded">—<span>not yet funded</span></div>';
    }
    var ret = '';
    if (r.totalReturn !== null && r.totalReturn !== undefined) {
      var cls = r.totalReturn < 0 ? 'cl-dn' : 'cl-up';
      ret = '<span class="' + cls + '">' + usd(r.totalReturn, { sign: true }) +
        (r.returnPercent === null || r.returnPercent === undefined ? '' :
          ' · ' + (r.returnPercent < 0 ? '−' : '+') + Math.abs(r.returnPercent).toFixed(1) + '%') + '</span>';
    }
    return '<div class="cl-mny cl-r" data-cl-value="real">' + usd(r.portfolioValue) + ret + '</div>';
  }

  function renderRows() {
    var rows = visible();
    if (!rows.length) {
      return '<div class="cl-empty">No clients match this view.<br>Clear the filters or search for a name or email.</div>';
    }
    return rows.map(function (r) {
      var idle = (r.idlePercent === null || r.idlePercent === undefined)
        ? '' : '<span>' + r.idlePercent.toFixed(0) + '% idle</span>';
      var una = r.valueAvailable && r.funded
        ? ('<div class="cl-una cl-r">' + usd(r.unallocated) + idle + '</div>')
        : '<div class="cl-una cl-r cl-dash">—<span class="cl-dash">—</span></div>';
      return '<a class="cl-tr" data-cl-row="' + esc(r.id) + '"' +
        ' href="admin-client-profile.html?client=' + encodeURIComponent(r.id) + '">' +
        '<span class="cl-av' + (r.status === 'pending_review' ? ' is-pending' : '') + '">' + esc(initials(r.name)) + '</span>' +
        '<span class="cl-cn"><b>' + esc(r.name) + '</b><span class="cl-sub">' + esc(r.email || '—') + '</span></span>' +
        '<span><span class="cl-typ">' + esc(String(r.accountType || '').replace(' Account', '')) + '</span></span>' +
        valueCell(r) + una +
        '<span class="cl-r"><span class="cl-pend' + (r.pendingCount ? '' : ' is-none') + '">' +
          (r.pendingCount || '<span class="cl-dash">—</span>') + '</span></span>' +
        '<span>' + statusCell(r) + '</span>' +
        '<span class="cl-chev" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></span>' +
        '</a>';
    }).join('');
  }

  function paint(d) {
    state.rows = d.rows; state.strip = d.strip; state.dormantDays = d.dormantDays;
    D.getElementById('cl-strip').innerHTML = renderStrip(d);
    D.getElementById('cl-filters').innerHTML = renderFilters();
    D.getElementById('cl-head').innerHTML = renderHead();
    D.getElementById('clients-list').innerHTML = renderRows();
  }
  function repaint() {
    D.getElementById('cl-filters').innerHTML = renderFilters();
    D.getElementById('cl-head').innerHTML = renderHead();
    D.getElementById('clients-list').innerHTML = renderRows();
  }

  function start() {
    MarketswaveData.renderAsyncBundle(D.getElementById('clients-list'), {
      skeletonHTML: MarketswaveData.skeleton.lines(['w-full', 'w-full', 'w-5/6', 'w-full', 'w-4/5'], { gap: 'space-y-4' }),
      load: load,
      render: paint
    });
  }

  D.addEventListener('click', function (ev) {
    var f = ev.target.closest && ev.target.closest('[data-cl-filter]');
    if (f) { state.filter = f.getAttribute('data-cl-filter'); repaint(); return; }
    var t = ev.target.closest && ev.target.closest('[data-cl-type]');
    if (t) {
      var v = t.getAttribute('data-cl-type');
      state.type = state.type === v ? null : v;
      repaint(); return;
    }
    var s = ev.target.closest && ev.target.closest('[data-cl-sort]');
    if (s) {
      var key = s.getAttribute('data-cl-sort');
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = key; state.dir = key === 'name' || key === 'type' || key === 'status' ? 'asc' : 'desc'; }
      repaint(); return;
    }
  });
  D.addEventListener('input', function (ev) {
    if (ev.target && ev.target.id === 'client-search') { state.q = ev.target.value || ''; repaint(); }
  });

  window.MarketswaveClientList = { reload: function () { return reload().then(paint); } };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();
})();
