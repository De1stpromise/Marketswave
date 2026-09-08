// Shared dashboard notification bell — the unified "needs attention" aggregation point for
// the whole dashboard, mounted the same way dashboard-sidebar.js mounts the sidebar. Call
// initDashboardNotifications() once per page, from a page with an empty
// <div id="notif-bell-mount"></div> in its header, engine-core.js already loaded, and (as of
// this fix) supabase-data.js already loaded — confirmed present, in that order or earlier,
// on all 10 client-facing pages this component mounts on.
//
// ★ Bug-fix rewrite (2026-09-03): all five sources now read real Supabase data instead of
// engine-core.js/localStorage — a real, separate fix, not a side effect of the
// admin-documents.html/admin-support.html fix this same investigation found. This component
// is a SHARED, client-facing piece every one of the 10 client pages mounts, independent of
// which admin page a PM happens to use — it was found stale for ALL FIVE of its sources the
// moment each domain's own client-facing page was wired to Supabase in an earlier UI Wiring
// stage (Documents/Savings in Stage 4, Allocation/Sell in Stage 2, Support in Stage 5), since
// none of those stages touched this file. Reuses supabase-data.js's plain client-facing
// session (MarketswaveData.selectTable() — never useAdminClient(), this always runs as the
// currently signed-in CLIENT) — every one of the 5 tables' own SELECT RLS policy is
// self-or-admin, so a plain client session already sees exactly and only its own rows with
// no extra client-side filtering needed. Every build*Items() function is now a pure mapper
// over an already-fetched real row array (real column names, not engine-core.js's local
// camelCase field names) instead of calling a local engine-core.js function or reading a raw
// localStorage key directly.
//
// getAllNotifications()/renderPanel() are now ASYNC (return Promises) — the one structural
// change this fix required throughout the file, since Supabase reads are inherently async
// where the old local reads were synchronous. initDashboardNotifications() still renders
// once, immediately, at mount time (the badge simply stays at its honest default — hidden,
// no fake interim count — until that first real fetch resolves, the same "no fabricated
// data" discipline used everywhere real data replaced a placeholder in this project); opening
// the panel re-fetches fresh so it always reflects genuinely live counts, not a stale
// snapshot from page load.
//
// The per-item READ-STATE store (marketswave_notifications_read) is deliberately UNCHANGED —
// it is real, but purely local UI-preference state ("has THIS browser already seen this
// notification"), not business data with a corresponding server-side source of truth, so it
// stays exactly as it was: client-scoped localStorage, no Supabase table behind it.
(function () {
  // Multi-Client Data Model Phase, Step 2 (Aug 21, 2026): scoped via engine-core.js's
  // clientScopedKey() — safe to call at module-load time since this script always loads
  // after engine-core.js (confirmed in every page's own script tag order). Read-state only —
  // see this file's own header for why this one store stays local.
  var READ_KEY = clientScopedKey('marketswave_notifications_read');
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

  // ---- Documents — real `documents` rows (real column names: is_new/deadline_label/
  // created_at), replacing the old getDocuments() local read ----
  function buildDocumentItems(rows) {
    var items = [];
    rows.forEach(function (d) {
      var ts = parseDateMs(d.created_at);
      if (d.is_new) {
        items.push({ key: 'doc-new-' + d.id, category: 'Documents', text: 'New document: ' + d.filename, timestampMs: ts, href: 'documents.html' });
      }
      if (d.status === 'Signature Required') {
        items.push({ key: 'doc-sig-' + d.id, category: 'Documents', text: 'Signature required: ' + d.filename, timestampMs: ts, href: 'documents.html' });
      }
      if (d.deadline_label) {
        items.push({ key: 'doc-deadline-' + d.id, category: 'Documents', text: d.deadline_label + ': ' + d.filename, timestampMs: ts, href: 'documents.html' });
      }
    });
    return items;
  }

  // ---- Allocation requests — real `allocation_requests` rows, joined against a real
  // products fetch for the display name, replacing the old getAllocationRequests() local
  // read + getProduct() lookup. Pending ones awaiting PM approval, plus recently resolved
  // ones keyed by id+status so approve/reject each produce their own distinct, one-time
  // unread notification ----
  function buildAllocationItems(rows, productsById) {
    var items = [];
    rows.forEach(function (r) {
      var name = productsById[r.product_id] || r.product_id;
      var amountText = fmtMoney(r.requested_amount);
      if (r.status === 'pending') {
        items.push({ key: 'allocation-pending-' + r.id, category: 'Allocation', text: 'Allocation request pending: ' + name + ' — ' + amountText, timestampMs: parseDateMs(r.requested_at), href: 'asset-performance.html' });
      } else if (r.status === 'approved' || r.status === 'rejected') {
        items.push({ key: 'allocation-resolved-' + r.id + '-' + r.status, category: 'Allocation', text: 'Allocation ' + r.status + ': ' + name + ' — ' + amountText, timestampMs: parseDateMs(r.resolved_at) || parseDateMs(r.requested_at), href: 'asset-performance.html' });
      }
    });
    return items;
  }

  // ---- Sell requests — real `sell_requests` rows, same treatment as allocation requests ----
  function buildSellItems(rows, productsById) {
    var items = [];
    rows.forEach(function (r) {
      var name = productsById[r.product_id] || r.product_id;
      var amountText = Number(r.units_to_sell).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' units';
      if (r.status === 'pending') {
        items.push({ key: 'sell-pending-' + r.id, category: 'Sell', text: 'Sell request pending: ' + name + ' — ' + amountText, timestampMs: parseDateMs(r.requested_at), href: 'asset-performance.html' });
      } else if (r.status === 'approved' || r.status === 'rejected') {
        items.push({ key: 'sell-resolved-' + r.id + '-' + r.status, category: 'Sell', text: 'Sell ' + r.status + ': ' + name + ' — ' + amountText, timestampMs: parseDateMs(r.resolved_at) || parseDateMs(r.requested_at), href: 'asset-performance.html' });
      }
    });
    return items;
  }

  // ---- High Yield Savings pockets — real `hys_pockets` rows, replacing the old raw
  // localStorage read of marketswave_hys_pockets. A pocket's own stored `status` column only
  // ever gets self-healed from 'active' to 'matured' when request-hys-withdrawal happens to
  // touch it (Backend Requirements Register row 124) — not on every read — so maturity here
  // is still computed independently from `maturity_date` vs. the current time, not read off
  // the possibly-stale `status` column, exactly the same principle the old local
  // implementation already used (only the field names/source changed). Near-maturity and
  // already-matured stay two distinctly-keyed notifications per pocket, so reading the
  // "maturing soon" one doesn't suppress the separate "matured" one that follows it. ----
  function buildSavingsItems(rows) {
    var items = [];
    var now = Date.now();
    rows.forEach(function (p) {
      if (p.pocket_type !== 'fixed' || p.status === 'withdrawn' || !p.maturity_date) return;
      var maturityMs = parseDateMs(p.maturity_date);
      if (!maturityMs) return;
      if (maturityMs <= now) {
        items.push({
          key: 'hys-matured-' + p.id,
          category: 'Savings',
          text: 'Pocket matured: ' + (p.term_label || 'Fixed Deposit') + ' — ready to withdraw',
          timestampMs: maturityMs,
          href: 'high-yield-savings.html'
        });
      } else {
        var daysLeft = Math.ceil((maturityMs - now) / 86400000);
        if (daysLeft <= NEAR_MATURITY_DAYS) {
          items.push({
            key: 'hys-nearmaturity-' + p.id,
            category: 'Savings',
            text: 'Pocket maturing soon: ' + (p.term_label || 'Fixed Deposit') + ' — ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left',
            timestampMs: maturityMs - NEAR_MATURITY_DAYS * 86400000,
            href: 'high-yield-savings.html'
          });
        }
      }
    });
    return items;
  }

  // ---- Support requests — real `support_requests` rows, replacing the old raw localStorage
  // read of marketswave_support_requests. A notification fires only for a request that has
  // moved OFF its original 'Open' state — the client already knows about a request the
  // moment they submit it, so 'Open' itself isn't a notification; a status change away from
  // it is. Keyed by the real, per-client-unique display_id + status (not one global
  // watermark) so a later transition, e.g. In Progress -> Resolved, produces its own fresh
  // unread notification even if the earlier 'In Progress' one was already read. ----
  function buildSupportItems(rows) {
    var items = [];
    rows.forEach(function (r) {
      if (!r.status || r.status === 'Open') return;
      items.push({
        key: 'support-' + r.display_id + '-' + r.status,
        category: 'Support',
        text: r.status + ': ' + r.category + ' (' + r.display_id + ')',
        timestampMs: parseDateMs(r.last_updated),
        href: 'support.html'
      });
    });
    return items;
  }

  // Fetches all 5 real sources fresh (plus `products` for the Allocation/Sell display name)
  // and returns a Promise resolving to the combined, sorted item list. A failed fetch fails
  // CLOSED to an empty list rather than throwing and breaking every page's own header — the
  // bell showing zero notifications until the next successful reload is a smaller failure
  // than a broken header on every client-facing page.
  function getAllNotifications() {
    if (typeof MarketswaveData === 'undefined') return Promise.resolve([]);
    return Promise.all([
      MarketswaveData.selectTable('documents'),
      MarketswaveData.selectTable('allocation_requests'),
      MarketswaveData.selectTable('sell_requests'),
      MarketswaveData.selectTable('hys_pockets'),
      MarketswaveData.selectTable('support_requests'),
      MarketswaveData.selectTable('products')
    ]).then(function (results) {
      var productsById = {};
      results[5].forEach(function (p) { productsById[p.id] = p.name; });
      var items = buildDocumentItems(results[0])
        .concat(buildAllocationItems(results[1], productsById))
        .concat(buildSellItems(results[2], productsById))
        .concat(buildSavingsItems(results[3]))
        .concat(buildSupportItems(results[4]));
      items.sort(function (a, b) { return b.timestampMs - a.timestampMs; });
      return items;
    }).catch(function () {
      return [];
    });
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

  // Async now — fetches fresh real data on every call (mount time, and again every time the
  // panel opens) so both the badge and the panel always reflect genuinely live counts, not a
  // cached snapshot from an earlier point in the page's life.
  function renderPanel() {
    return getAllNotifications().then(function (items) {
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
    });
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
        // Glass Language Extension (2026-09-07): investigated and deliberately left solid,
        // not overlooked -- this dropdown is a floating popover (position:absolute, z-50,
        // no darkened backdrop), not a static card in the page's own document flow. It can
        // open over whatever real content happens to sit beneath it at that scroll position
        // on any of the 10 client-facing pages that mount it, which .glass's own recipe was
        // never tuned or verified against (unlike .glass-dark, specifically built and
        // measured for the sidebar's own scrolling-content-behind-it case). Treating this as
        // an "overlay" per the Contrast Audit's own framing (row 151), not a "card."
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

    // Fire-and-forget at mount time — the badge stays at its honest hidden/0 default until
    // this first real fetch resolves, never a fabricated interim count.
    //
    // ★ Motion UI Components (2026-09-08): a one-time attention wiggle on the bell icon,
    // fired only if this VERY FIRST real fetch discovers genuinely unread items — never on
    // every page load regardless of count, and never again after this (opening the panel
    // marks everything read, so there is no later point where the count could newly
    // increase without a full page reload starting this same one-time check over). The real
    // aggregation logic below (getAllNotifications/renderPanel/the read-state store) is
    // completely untouched — this only reacts to what renderPanel() already computes.
    renderPanel().then(function (state) {
      if (window.MotionHelpers && state.items.length) {
        var unread = state.items.filter(function (it) { return !state.readMap[it.key]; });
        if (unread.length > 0) {
          var iconEl = document.querySelector('#notif-bell-btn svg');
          window.MotionHelpers.wiggle(iconEl);
        }
      }
    });

    function openPanel() {
      panel.classList.remove('hidden');
      if (window.MotionHelpers) window.MotionHelpers.panelOpen(panel);
      btn.setAttribute('aria-expanded', 'true');
      // Re-fetch fresh on every open, not just at mount time — this is what actually makes
      // "live counts after a real action elsewhere" true, since a client could have taken an
      // action (or a PM could have resolved something) any time after the page first loaded.
      renderPanel().then(function (state) {
        if (state.items.length) {
          var readMap = state.readMap;
          state.items.forEach(function (it) { readMap[it.key] = true; });
          saveReadMap(readMap);
          var badge = document.getElementById('notif-bell-badge');
          if (badge) badge.classList.add('hidden');
        }
      });
    }
    function closePanel() {
      if (panel.classList.contains('hidden')) return;
      btn.setAttribute('aria-expanded', 'false');
      if (window.MotionHelpers) {
        window.MotionHelpers.panelClose(panel).then(function () { panel.classList.add('hidden'); });
      } else {
        panel.classList.add('hidden');
      }
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
