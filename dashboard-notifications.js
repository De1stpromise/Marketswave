// Shared dashboard notification bell — the unified "needs attention" aggregation point for
// the whole dashboard, mounted the same way dashboard-sidebar.js mounts the sidebar. Call
// initDashboardNotifications() once per page, from a page with an empty
// <div id="notif-bell-mount"></div> in its header and engine-core.js already loaded.
//
// Aggregates from five sources. Three read straight through existing engine-core.js
// functions (no parallel counting/aggregation logic): getDocuments(), getAllocationRequests(),
// getSellRequests(). The other two — High Yield Savings pockets and Support requests — are
// NOT part of engine-core.js today, and this feature does not migrate them there: that would
// be a much larger, unrequested scope expansion (mirroring the Documents & Reporting
// migration), not what "build the notification bell" asked for. Both are instead read
// directly from their own existing localStorage keys, same as documents.html read its own
// data before that migration existed. See the maturity-computation note on
// buildSavingsItems() below for one real consequence of not migrating HYS.
(function () {
  // Multi-Client Data Model Phase, Step 2 (Aug 21, 2026): scoped via engine-core.js's
  // clientScopedKey() — safe to call at module-load time since this script always loads
  // after engine-core.js (confirmed in every page's own script tag order).
  var READ_KEY = clientScopedKey('marketswave_notifications_read');
  var HYS_KEY = clientScopedKey('marketswave_hys_pockets');
  var SUPPORT_KEY = clientScopedKey('marketswave_support_requests');
  var NEAR_MATURITY_DAYS = 7;

  var BELL_ICON = 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9';

  var CATEGORY_DOT = {
    Documents: 'bg-blue-500',
    Allocation: 'bg-navy',
    Sell: 'bg-amber-500',
    Savings: 'bg-emerald-500',
    Support: 'bg-slate-500'
  };

  // ---- Read-state store: per-item, not a single global "last seen" watermark, so a fresh
  // notification arriving right after a read still shows correctly as unread ----
  function loadReadMap() {
    try {
      var stored = JSON.parse(localStorage.getItem(READ_KEY));
      return stored && typeof stored === 'object' ? stored : {};
    } catch (e) { return {}; }
  }
  function saveReadMap(map) {
    localStorage.setItem(READ_KEY, JSON.stringify(map));
  }

  function readJSONArray(key) {
    try {
      var stored = JSON.parse(localStorage.getItem(key));
      return Array.isArray(stored) ? stored : [];
    } catch (e) { return []; }
  }

  function parseDateMs(dateStr) {
    if (!dateStr) return 0;
    var ms = Date.parse(dateStr.length <= 10 ? dateStr + 'T00:00:00Z' : dateStr);
    return isNaN(ms) ? 0 : ms;
  }

  function fmtMoney(n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function timeAgo(ms) {
    if (!ms) return '';
    var diff = Math.max(0, Date.now() - ms);
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    var months = Math.floor(days / 30);
    if (months < 12) return months + 'mo ago';
    return Math.floor(months / 12) + 'y ago';
  }

  // ---- Documents — via getDocuments(), the same underlying source
  // getDocumentNotificationCounts() reads, just at item level instead of a count ----
  function buildDocumentItems() {
    if (typeof getDocuments !== 'function') return [];
    var items = [];
    getDocuments().forEach(function (d) {
      var ts = parseDateMs(d.date);
      if (d.isNew) {
        items.push({ key: 'doc-new-' + d.id, category: 'Documents', text: 'New document: ' + d.filename, timestampMs: ts, href: 'documents.html' });
      }
      if (d.status === 'Signature Required') {
        items.push({ key: 'doc-sig-' + d.id, category: 'Documents', text: 'Signature required: ' + d.filename, timestampMs: ts, href: 'documents.html' });
      }
      if (d.deadlineLabel) {
        items.push({ key: 'doc-deadline-' + d.id, category: 'Documents', text: d.deadlineLabel + ': ' + d.filename, timestampMs: ts, href: 'documents.html' });
      }
    });
    return items;
  }

  // ---- Allocation requests — pending ones awaiting PM approval, plus recently resolved
  // ones keyed by id+status so approve/reject each produce their own distinct, one-time
  // unread notification ----
  function buildAllocationItems() {
    if (typeof getAllocationRequests !== 'function') return [];
    var items = [];
    getAllocationRequests().forEach(function (r) {
      var product = typeof getProduct === 'function' ? getProduct(r.productId) : null;
      var name = product ? product.name : r.productId;
      var amountText = fmtMoney(r.amount);
      if (r.status === 'pending') {
        items.push({ key: 'allocation-pending-' + r.id, category: 'Allocation', text: 'Allocation request pending: ' + name + ' — ' + amountText, timestampMs: r.requestedAtMs, href: 'asset-performance.html' });
      } else if (r.status === 'approved' || r.status === 'rejected') {
        items.push({ key: 'allocation-resolved-' + r.id + '-' + r.status, category: 'Allocation', text: 'Allocation ' + r.status + ': ' + name + ' — ' + amountText, timestampMs: parseDateMs(r.resolvedAt) || r.requestedAtMs, href: 'asset-performance.html' });
      }
    });
    return items;
  }

  // ---- Sell requests — same treatment as allocation requests ----
  function buildSellItems() {
    if (typeof getSellRequests !== 'function') return [];
    var items = [];
    getSellRequests().forEach(function (r) {
      var product = typeof getProduct === 'function' ? getProduct(r.productId) : null;
      var name = product ? product.name : r.productId;
      var amountText = Number(r.unitsToSell).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' units';
      if (r.status === 'pending') {
        items.push({ key: 'sell-pending-' + r.id, category: 'Sell', text: 'Sell request pending: ' + name + ' — ' + amountText, timestampMs: r.requestedAtMs, href: 'asset-performance.html' });
      } else if (r.status === 'approved' || r.status === 'rejected') {
        items.push({ key: 'sell-resolved-' + r.id + '-' + r.status, category: 'Sell', text: 'Sell ' + r.status + ': ' + name + ' — ' + amountText, timestampMs: parseDateMs(r.resolvedAt) || r.requestedAtMs, href: 'asset-performance.html' });
      }
    });
    return items;
  }

  // ---- High Yield Savings pockets — read directly from marketswave_hys_pockets (not
  // migrated into engine-core.js — see the file-level note above for why). A pocket's
  // stored `status` field only ever advances from 'active' to 'matured' inside
  // high-yield-savings.html's own updatePocketStatuses(), which doesn't run on other
  // pages — so maturity is computed independently here from `maturityDate` vs. the current
  // time, not read off the possibly-stale `status` field. Near-maturity and already-matured
  // are two distinctly-keyed notifications per pocket, so reading the "maturing soon" one
  // doesn't suppress the separate "matured" one that follows it. ----
  function buildSavingsItems() {
    var items = [];
    var now = Date.now();
    readJSONArray(HYS_KEY).forEach(function (p) {
      if (p.type !== 'fixed' || p.status === 'withdrawn' || !p.maturityDate) return;
      var maturityMs = parseDateMs(p.maturityDate);
      if (!maturityMs) return;
      if (maturityMs <= now) {
        items.push({
          key: 'hys-matured-' + p.id,
          category: 'Savings',
          text: 'Pocket matured: ' + (p.termLabel || 'Fixed Deposit') + ' — ready to withdraw',
          timestampMs: maturityMs,
          href: 'high-yield-savings.html'
        });
      } else {
        var daysLeft = Math.ceil((maturityMs - now) / 86400000);
        if (daysLeft <= NEAR_MATURITY_DAYS) {
          items.push({
            key: 'hys-nearmaturity-' + p.id,
            category: 'Savings',
            text: 'Pocket maturing soon: ' + (p.termLabel || 'Fixed Deposit') + ' — ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left',
            timestampMs: maturityMs - NEAR_MATURITY_DAYS * 86400000,
            href: 'high-yield-savings.html'
          });
        }
      }
    });
    return items;
  }

  // ---- Support requests — read directly from marketswave_support_requests (not migrated,
  // same rationale as Savings). A notification fires only for a request that has moved OFF
  // its original 'Open' state — the client already knows about a request the moment they
  // submit it, so 'Open' itself isn't a notification; a status change away from it is.
  // Keyed by id+status (not one global watermark) so a later transition, e.g. In Progress
  // -> Resolved, produces its own fresh unread notification even if the earlier
  // 'In Progress' one was already read. ----
  function buildSupportItems() {
    var items = [];
    readJSONArray(SUPPORT_KEY).forEach(function (r) {
      if (!r.status || r.status === 'Open') return;
      items.push({
        key: 'support-' + r.id + '-' + r.status,
        category: 'Support',
        text: r.status + ': ' + r.category + ' (' + r.id + ')',
        timestampMs: parseDateMs(r.lastUpdated),
        href: 'support.html'
      });
    });
    return items;
  }

  function getAllNotifications() {
    var items = buildDocumentItems()
      .concat(buildAllocationItems())
      .concat(buildSellItems())
      .concat(buildSavingsItems())
      .concat(buildSupportItems());
    items.sort(function (a, b) { return b.timestampMs - a.timestampMs; });
    return items;
  }

  function itemHTML(item, unread) {
    var dotClass = unread ? (CATEGORY_DOT[item.category] || 'bg-slate-400') : 'bg-transparent';
    return '<a href="' + item.href + '" class="flex gap-3 px-4 py-3 hover:bg-slate-50 transition border-b border-slate-100 last:border-b-0">' +
      '<span class="mt-1.5 w-2 h-2 rounded-full shrink-0 ' + dotClass + '"></span>' +
      '<div class="min-w-0 flex-1">' +
        '<p class="text-sm text-navy leading-snug">' + item.text + '</p>' +
        '<p class="text-xs text-slate-400 mt-0.5">' + item.category + ' · ' + timeAgo(item.timestampMs) + '</p>' +
      '</div>' +
    '</a>';
  }

  function renderPanel() {
    var items = getAllNotifications();
    var readMap = loadReadMap();
    var unreadCount = items.filter(function (it) { return !readMap[it.key]; }).length;

    var badge = document.getElementById('notif-bell-badge');
    if (badge) {
      badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
      badge.classList.toggle('hidden', unreadCount === 0);
    }

    var list = document.getElementById('notif-bell-list');
    var empty = document.getElementById('notif-bell-empty');
    if (list && empty) {
      if (items.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
      } else {
        empty.classList.add('hidden');
        list.innerHTML = items.map(function (it) { return itemHTML(it, !readMap[it.key]); }).join('');
      }
    }
    return { items: items, readMap: readMap };
  }

  function initDashboardNotifications() {
    var mount = document.getElementById('notif-bell-mount');
    if (!mount) return;

    mount.innerHTML =
      '<div class="relative">' +
        '<button type="button" id="notif-bell-btn" class="relative p-2 text-slate-500 hover:text-navy transition" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">' +
          '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + BELL_ICON + '"/></svg>' +
          '<span id="notif-bell-badge" class="hidden absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-[1.125rem] text-center">0</span>' +
        '</button>' +
        '<div id="notif-bell-panel" class="hidden absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-xl shadow-xl border border-slate-200 z-50">' +
          '<div class="px-4 py-3 border-b border-slate-100">' +
            '<p class="text-sm font-semibold text-navy">Notifications</p>' +
          '</div>' +
          '<div id="notif-bell-list" class="max-h-96 overflow-y-auto"></div>' +
          '<div id="notif-bell-empty" class="hidden px-4 py-8 text-center">' +
            '<p class="text-sm text-slate-400">You’re all caught up.</p>' +
          '</div>' +
        '</div>' +
      '</div>';

    var btn = document.getElementById('notif-bell-btn');
    var panel = document.getElementById('notif-bell-panel');

    renderPanel();

    function openPanel() {
      var state = renderPanel();
      panel.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      if (state.items.length) {
        var readMap = state.readMap;
        state.items.forEach(function (it) { readMap[it.key] = true; });
        saveReadMap(readMap);
        var badge = document.getElementById('notif-bell-badge');
        if (badge) badge.classList.add('hidden');
      }
    }
    function closePanel() {
      panel.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.classList.contains('hidden')) openPanel(); else closePanel();
    });
    document.addEventListener('click', function (e) {
      if (!panel.classList.contains('hidden') && !mount.contains(e.target)) closePanel();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });
  }

  window.initDashboardNotifications = initDashboardNotifications;
})();
