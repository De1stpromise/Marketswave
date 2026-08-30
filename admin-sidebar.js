// Shared admin sidebar — mirrors dashboard-sidebar.js's mount-point pattern
// (initAdminSidebar('<page-key>') from a page with an empty
// <div id="admin-sidebar-mount"></div>) but is a DELIBERATELY separate file and persona:
// the internal Portfolio Manager tool, not the client dashboard. Do not merge this into
// dashboard-sidebar.js or its NAV_ITEMS — client and admin navigation must never mix.

// ---- Admin Login Gate (Aug 21, 2026) — the very first thing that runs on every admin page,
// before anything else, including before engine-core.js has even loaded (this file is always
// the first <script> tag on every admin page — confirmed by checking every admin page's
// script tag order). Raw sessionStorage key used directly, not via isAdminAuthenticated() —
// engine-core.js, which defines that function, hasn't loaded yet at this point. Mirrors
// dashboard-sidebar.js's own file-load-time CLIENT-0001 reset precedent exactly, including
// the reason: the literal key string ('marketswave_admin_authenticated') must stay in sync
// with engine-core.js's own ADMIN_AUTH_SESSION_KEY constant. admin-login.html itself does
// NOT load this file at all (it has no sidebar/nav until authenticated), so there is no
// redirect loop to guard against here. This is explicitly a UI-level stub, not real
// authentication — see the ADMIN_PASSPHRASE comment in engine-core.js for the full honesty
// callout; a determined visitor can bypass this via dev tools, same as the forced
// password-reset gate on settings.html.
// Bug fix (Aug 27, 2026): preserves the real-vs-emulator `?env=staging` URL param across
// every internal admin-tool navigation, not just the one login->landing redirect the report
// named. Same class of bug as the CLIENT-0001 identity pin and the emulator-credential gap
// two fixes ago — a mechanism (IS_STAGING, read fresh from window.location.search on every
// page load, per firebase-config.js's own design) that works correctly wherever the param is
// actually present, but nothing had ever propagated it forward through this file's own
// redirects or the sidebar's own rendered <a href> links, so it silently reverted to the
// emulator (and reproduced the exact auth/invalid-credential/network-request-failed error
// already diagnosed twice) the moment a PM clicked anywhere. Deliberately reads the RAW query
// string directly (not IS_STAGING itself, which lives in firebase-config.js — a module this
// plain, non-module script can't import, and which admin-login.html/most admin pages never
// even load) — keeps this fix self-contained and needing nothing from the Firebase layer.
function currentEnvQuery() {
  try {
    return new URLSearchParams(window.location.search).get('env') === 'staging' ? '?env=staging' : '';
  } catch (e) { return ''; }
}

// Rewrites every same-page, local .html link (the sidebar's own freshly-rendered nav —
// covered without needing to touch navLinkHTML() itself, since this runs AFTER
// mount.innerHTML is set — AND each admin page's own hardcoded links, e.g. admin.html's 13
// Overview cards, admin-hys.html's cross-links, etc.) to carry the same env param, in ONE
// place rather than requiring every current and future internal link to be hand-threaded
// individually — the exact kind of single point of failure that let this bug happen in the
// first place. Skips anything that already has a query string (so re-running this, or a link
// this function already rewrote, is a safe no-op) and anything that isn't a plain local
// "somepage.html" href (external URLs, mailto:, #anchors).
function preserveEnvParamInPageLinks() {
  var suffix = currentEnvQuery();
  if (!suffix) return;
  var links = document.querySelectorAll('a[href]');
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute('href');
    if (!href || href.indexOf(':') !== -1 || href.indexOf('#') === 0 || href.indexOf('?') !== -1) continue;
    if (!/\.html$/.test(href)) continue;
    links[i].setAttribute('href', href + suffix);
  }
}

var __adminAuthenticated = false;
try { __adminAuthenticated = sessionStorage.getItem('marketswave_admin_authenticated') === 'true'; } catch (e) { /* sessionStorage unavailable — non-fatal, fails closed (redirects) */ }
if (!__adminAuthenticated) {
  location.replace('admin-login.html' + currentEnvQuery());
}

(function () {
  // Nav groups (Aug 21, 2026) — the fixed categorization every admin tool's nav item is
  // assigned into via its own `group` field below, in the exact order groups render. This is
  // the one place group membership/order/labels are defined; adding a future tool means
  // adding one NAV_ITEMS entry with an existing `group` id (or a new GROUPS entry first, if
  // it genuinely needs another category) — never re-arranging section boundaries by hand.
  // 'dashboard' added (Aug 21, 2026) as the first group, holding Overview and Client List —
  // previously these two were "ungrouped" (group: null), rendered above the labeled groups
  // with no header of their own. That distinction is gone now: they're a real group like any
  // other, just positioned first, so they get the identical group-header treatment.
  //
  // Aug 23, 2026, second regroup same day: the 'portfolio-administration' group (briefly
  // relabeled "Settings" earlier the same day) is removed entirely — Products moved out to
  // the new 'catalog' group below, and Advisory Fee + Account Security (now labeled "Security
  // Log") moved into 'user-admin-relations' instead of getting their own group. 'catalog' was
  // originally positioned last; moved up (third edit, same day) ahead of 'user-admin-relations'
  // so it doesn't sit at the bottom of the nav — Approval Gate stays first after Dashboard as
  // the highest-frequency/most time-sensitive daily-use group.
  var GROUPS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'approval-gate', label: 'Approval Gate' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'user-admin-relations', label: 'User/Admin Relations' }
  ];

  var NAV_ITEMS = [
    {
      key: 'overview',
      href: 'admin.html',
      label: 'Overview',
      icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z',
      group: 'dashboard'
    },
    {
      // Deliberately a single-person "user" icon (not the two-person group icon originally
      // used), specifically to read as unmistakably distinct from Overview's house icon —
      // both are simple filled-outline shapes at the same 20px sidebar size, so the shape
      // difference (house vs. person) needs to be unambiguous at a glance, not just
      // technically different.
      // Label history (Aug 21, 2026, all same day): "Viewing Client" → "Client Management"
      // (collided with the persistent "VIEWING CLIENT" indicator that used to sit above the
      // nav, since removed — see the note above initAdminSidebar()) → "Client List" (current
      // — this group is now literally titled "Dashboard" with Overview right beside it, so
      // "Management" read as broader than what the page actually is: a searchable list you
      // expand rows on and switch from).
      key: 'clients',
      href: 'admin-clients.html',
      label: 'Client List',
      icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
      group: 'dashboard'
    },
    {
      // New Client Application Review (Aug 22, 2026) — positioned first in the group,
      // ahead of Deposits: whether a client should exist at all comes before anything they
      // might request.
      key: 'client-applications',
      href: 'admin-client-applications.html',
      label: 'Client Applications',
      icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
      group: 'approval-gate'
    },
    {
      key: 'deposits',
      href: 'admin-deposits.html',
      label: 'Deposits',
      icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
      group: 'approval-gate'
    },
    {
      // Client Withdrawal (Aug 22, 2026) — positioned directly after Deposits, its natural
      // pair (money in / money out), rather than at the end of the group.
      key: 'withdrawals',
      href: 'admin-withdrawals.html',
      label: 'Withdrawals',
      icon: 'M17 8l4 4m0 0l-4 4m4-4H3',
      group: 'approval-gate'
    },
    {
      key: 'allocations',
      href: 'admin-allocations.html',
      label: 'Allocations',
      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
      group: 'approval-gate'
    },
    {
      key: 'sells',
      href: 'admin-sells.html',
      label: 'Sells',
      icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
      group: 'approval-gate'
    },
    {
      key: 'hys',
      href: 'admin-hys.html',
      label: 'HYS Deposits & Withdrawals', // renamed Aug 27, 2026 — admin-hys.html now
      // covers both request kinds, not just deposits (the HYS withdrawal approval-gate fix)
      icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      group: 'approval-gate'
    },
    {
      // Label shortened Aug 23, 2026: "Client Profile Updates" → "Profile Updates" — none of
      // its sibling queues in this group (Deposits, Withdrawals, Allocations, Sells, HYS
      // Deposits) spell out "Requests" either; the "Approval Gate" group header itself already
      // carries that meaning, so "Client" was redundant with being inside this nav at all.
      key: 'settings-changes',
      href: 'admin-profile-updates.html',
      label: 'Profile Updates',
      icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
      group: 'approval-gate'
    },
    {
      key: 'documents',
      href: 'admin-documents.html',
      label: 'Documents',
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      group: 'user-admin-relations'
    },
    {
      key: 'support',
      href: 'admin-support.html',
      label: 'Support',
      icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      group: 'user-admin-relations'
    },
    {
      // Label changed Aug 23, 2026: "Settings" → "Advisory Fee" — this page only ever managed
      // the advisory fee rate. Group changed same day (second regroup): briefly its own
      // "Settings" group, now folded into 'user-admin-relations' — the "Settings" group was
      // removed entirely rather than kept as a two-item category. Positioned before Security
      // Log (below) to match the specified final order.
      key: 'settings',
      href: 'admin-advisory-fee.html',
      label: 'Advisory Fee',
      icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
      group: 'user-admin-relations'
    },
    {
      // Lock icon — a chronological log, not a queue (no pending/approve mechanic), so it
      // gets a plain read-only-looking icon rather than reusing a document/checkmark shape
      // already associated with a queue elsewhere in this nav. Aug 23, 2026, second regroup
      // same day: briefly moved to a now-removed 'portfolio-administration' group, moved back
      // to 'user-admin-relations' here; label shortened "Account Security" → "Security Log"
      // (the page's own <title>/<h2> stay "Account Security" — only the nav label changed).
      key: 'security',
      href: 'admin-security.html',
      label: 'Security Log',
      icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
      group: 'user-admin-relations'
    },
    {
      // Product Catalog management. Group changed Aug 23, 2026: 'portfolio-administration' →
      // the new 'catalog' group — its own dedicated category now, rather than sharing space
      // with the fee-rate/security configuration pages.
      key: 'products',
      href: 'admin-products.html',
      label: 'Product Catalog',
      icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
      group: 'catalog'
    }
  ];

  var ACTIVE = 'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 text-white font-medium';
  var INACTIVE = 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition';

  function navLinkHTML(item, activePage) {
    var cls = item.key === activePage ? ACTIVE : INACTIVE;
    return '<a href="' + item.href + '" class="' + cls + '">' +
      '<svg class="w-5 h-5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + item.icon + '"/></svg>' +
      item.label +
      '</a>';
  }

  // Renders the full nav: each GROUPS entry in order as its own labeled section — a visible
  // header, not just a gap — containing every NAV_ITEMS entry whose `group` matches, in their
  // NAV_ITEMS array order. Every item belongs to some group now (Dashboard included, Aug 21,
  // 2026) — there is no ungrouped case left, but a group with zero items (nothing currently
  // produces this, but a future edit could) still renders no header and no section at all,
  // rather than an empty labeled gap.
  function navHTML(activePage) {
    return GROUPS.map(function (group) {
      var itemsInGroup = NAV_ITEMS.filter(function (item) { return item.group === group.id; });
      if (itemsInGroup.length === 0) return '';
      return '<div class="mt-5 first:mt-0">' +
        '<p class="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">' + group.label + '</p>' +
        '<div class="space-y-1">' +
          itemsInGroup.map(function (item) { return navLinkHTML(item, activePage); }).join('') +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Same off-canvas-drawer-below-lg pattern as dashboard-sidebar.js's toggleSidebar(), kept
  // independent (not shared) since the element ids are admin-specific and the two personas'
  // sidebars must never accidentally wire into each other's markup.
  function toggleSidebar(open) {
    var aside = document.getElementById('admin-sidebar-aside');
    var backdrop = document.getElementById('admin-sidebar-backdrop');
    var btn = document.getElementById('admin-sidebar-toggle-btn');
    if (!aside || !backdrop || !btn) return;
    aside.classList.toggle('-translate-x-full', !open);
    aside.classList.toggle('translate-x-0', open);
    backdrop.classList.toggle('hidden', !open);
    btn.classList.toggle('hidden', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function initAdminSidebar(activePage) {
    // Defense in depth on top of the file-load-time redirect above: if that check somehow
    // didn't fire in time (or this function is ever called in a context that skipped it),
    // don't render real nav/data regardless. Uses the real engine-core.js function here
    // (already loaded by the time initAdminSidebar() runs, unlike the top-of-file check).
    if (typeof isAdminAuthenticated === 'function' && !isAdminAuthenticated()) {
      location.replace('admin-login.html' + currentEnvQuery());
      return;
    }

    var mount = document.getElementById('admin-sidebar-mount');
    if (!mount) return;

    var navSectionsHTML = navHTML(activePage);

    mount.innerHTML =
      '<button type="button" id="admin-sidebar-toggle-btn" class="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-lg" aria-label="Toggle menu" aria-expanded="false" aria-controls="admin-sidebar-aside">' +
        '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>' +
      '</button>' +
      '<div id="admin-sidebar-backdrop" class="hidden lg:hidden fixed inset-0 bg-black/60 z-40"></div>' +
      // h-screen, not h-full: the mount div this <aside> lives inside doesn't itself
      // establish a flex context for its child, so flex-stretch from the outer
      // ".flex h-screen" wrapper doesn't cascade down to here (same root cause documented
      // for dashboard-sidebar.js's own aside — see CLAUDE.md's sidebar-height bug note).
      // Explicit h-screen is the proven fix, reused as-is.
      '<aside id="admin-sidebar-aside" class="w-64 h-screen bg-slate-900 text-white flex flex-col fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200 lg:static lg:translate-x-0">' +
        '<div class="h-16 flex items-center justify-between px-6 border-b border-white/10">' +
          '<span class="text-lg font-bold tracking-tight">MARKETSWAVE <span class="text-amber-400">PM</span></span>' +
          '<button type="button" id="admin-sidebar-close-btn" class="lg:hidden text-white/70 hover:text-white transition" aria-label="Close menu">' +
            '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<nav class="flex-1 px-4 pb-6 pt-2 overflow-y-auto">' +
          navSectionsHTML +
        '</nav>' +
        '<div class="px-4 pb-4 pt-4 border-t border-white/10">' +
          '<div class="flex items-center gap-3 px-3">' +
            '<div class="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center text-sm font-semibold text-amber-400">PM</div>' +
            '<div class="flex-1 min-w-0">' +
              '<p class="text-sm font-medium truncate">Portfolio Manager</p>' +
              '<p class="text-xs text-white/50 truncate">Internal access</p>' +
            '</div>' +
            // Admin-tool logout (Aug 21, 2026) — distinct from any client-facing logout
            // (dashboard-sidebar.js's own, which navigates to login.html): this one clears
            // ONLY the admin session flag and returns to admin-login.html, never touching
            // getCurrentClientId()/the client-scoped session state client pages depend on.
            '<button type="button" id="admin-logout-btn" class="text-xs font-medium text-white/50 hover:text-white transition shrink-0" title="Log Out">Log Out</button>' +
          '</div>' +
        '</div>' +
      '</aside>';

    document.getElementById('admin-sidebar-toggle-btn').addEventListener('click', function () {
      toggleSidebar(this.getAttribute('aria-expanded') !== 'true');
    });
    document.getElementById('admin-sidebar-close-btn').addEventListener('click', function () { toggleSidebar(false); });
    document.getElementById('admin-sidebar-backdrop').addEventListener('click', function () { toggleSidebar(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') toggleSidebar(false);
    });
    document.getElementById('admin-logout-btn').addEventListener('click', function () {
      if (typeof clearAdminAuthenticated === 'function') clearAdminAuthenticated();
      // Preserves env across logout too — a PM deliberately testing staging shouldn't have
      // that context silently dropped the moment they log back out, only to have their next
      // login attempt quietly land back on the emulator with no indication why.
      location.replace('admin-login.html' + currentEnvQuery());
    });

    preserveEnvParamInPageLinks();
  }

  window.initAdminSidebar = initAdminSidebar;
})();
