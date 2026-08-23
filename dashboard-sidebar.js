// Shared dashboard sidebar — extracted from the duplicated <aside> markup that used to
// live on every dashboard page. Call initDashboardSidebar('<page-key>') once, after this
// script has loaded, from a page that has an empty <div id="sidebar-mount"></div> in place
// of the old <aside>. The matching nav item is highlighted based on the page key passed in.
(function () {
  // Client Authentication, Phase 3 (Aug 21, 2026) — retires the unconditional CLIENT-0001
  // pin that Multi-Client Data Model Step 4 (see the git history of this comment) put here.
  // MUST still run here, at file-load time, not inside initDashboardSidebar(): this file
  // always loads BEFORE engine-core.js on every client-facing page (confirmed by script-tag
  // order), so resolving/setting the session client id here runs before engine-core.js's own
  // IIFE reads it to populate its module-level account state/holdings/etc. — setting it later
  // (inside initDashboardSidebar(), invoked by a script tag AFTER engine-core.js has already
  // loaded) is too late, exactly the bug §4.44/§4.45 already found and fixed once for the old
  // hardcoded-pin version of this same code. Raw sessionStorage keys used directly, not via
  // getAuthenticatedClientId()/setCurrentClientId() — engine-core.js, which defines those
  // functions, hasn't loaded yet at this point. Mirrors admin-sidebar.js's own file-load-time
  // Admin Login Gate check exactly, including the reason: the literal key strings
  // ('marketswave_authenticated_client_id', 'marketswave_current_client_id') must stay in
  // sync with engine-core.js's own CLIENT_AUTH_SESSION_KEY/CURRENT_CLIENT_SESSION_KEY
  // constants. No fallback to DEFAULT_CLIENT_ID here, and no re-validation against the real
  // Client Registry (engine-core.js isn't loaded yet to check it against) — the same "trust
  // the session flag, don't re-derive it" discipline isAdminAuthenticated() already uses; the
  // value only ever gets here via a real setClientAuthenticated() call after a real
  // verifyClientCredentials() success (Phase 2, login.html).
  var __authenticatedClientId = null;
  try { __authenticatedClientId = sessionStorage.getItem('marketswave_authenticated_client_id'); } catch (e) { /* sessionStorage unavailable — non-fatal, fails closed (redirects) */ }
  if (!__authenticatedClientId) {
    location.replace('login.html');
  } else {
    try { sessionStorage.setItem('marketswave_current_client_id', __authenticatedClientId); } catch (e) { /* non-fatal */ }
  }

  var NAV_ITEMS = [
    {
      key: 'dashboard',
      href: 'dashboard.html',
      label: 'Portfolio Overview',
      icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z'
    },
    {
      key: 'asset-performance',
      href: 'asset-performance.html',
      label: 'Asset & Performance',
      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
    },
    {
      key: 'high-yield-savings',
      href: 'high-yield-savings.html',
      label: 'High Yield Savings',
      icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
    },
    {
      key: 'transactions',
      href: 'transactions.html',
      label: 'Transactions',
      icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
    },
    {
      key: 'documents',
      href: 'documents.html',
      label: 'Documents & Reporting',
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      badge: true
    },
    {
      key: 'risk-management',
      href: 'risk-management.html',
      label: 'Risk Management',
      icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
    }
  ];

  // Documents & Reporting is the only nav item with a notification badge. It is always
  // rendered with id="sidebar-doc-badge" and a default of "2" (matching the static value
  // every non-documents page has always shown). documents.html's own script — which loads
  // after this one and after the sidebar has been mounted — recomputes the real count from
  // its live doc-row data and overwrites this element's text, exactly as it did before the
  // sidebar markup was extracted. No other page ever touches this element.
  var ACTIVE_MAIN = 'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 text-white font-medium';
  var INACTIVE_MAIN = 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition';
  var ACTIVE_FOOTER = 'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 text-white transition text-sm font-medium';
  var INACTIVE_FOOTER = 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/90 hover:bg-white/10 hover:text-white transition text-sm font-medium';

  var SETTINGS_ICON = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>';
  var SUPPORT_ICON = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>';

  function navLinkHTML(item, activePage) {
    var cls = item.key === activePage ? ACTIVE_MAIN : INACTIVE_MAIN;
    var inner = item.badge
      ? '<span class="flex-1">' + item.label + '</span>' +
        '<span id="sidebar-doc-badge" class="inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none">2</span>'
      : item.label;
    return '<a href="' + item.href + '" class="' + cls + '">' +
      '<svg class="w-5 h-5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + item.icon + '"/></svg>' +
      inner +
      '</a>';
  }

  function footerLinkHTML(href, key, label, iconPaths, activePage) {
    var cls = key === activePage ? ACTIVE_FOOTER : INACTIVE_FOOTER;
    return '<a href="' + href + '" class="' + cls + '">' +
      '<svg class="w-5 h-5 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + iconPaths + '</svg>' +
      label +
      '</a>';
  }

  // Collapses to an off-canvas drawer below the `lg` breakpoint (1024px), toggled by a
  // fixed hamburger button — the sidebar was previously a hardcoded w-64 that never
  // responded to viewport width at all, which starved every page's actual content area at
  // narrower/vertical viewports (confirmed while diagnosing separate overflow bugs on
  // dashboard.html and transactions.html — this is the shared root cause behind those).
  // At `lg` and above, behavior is pixel-identical to before: static-positioned, always
  // visible, no toggle affordance shown.
  function toggleSidebar(open) {
    var aside = document.getElementById('sidebar-aside');
    var backdrop = document.getElementById('sidebar-backdrop');
    var btn = document.getElementById('sidebar-toggle-btn');
    if (!aside || !backdrop || !btn) return;
    aside.classList.toggle('-translate-x-full', !open);
    aside.classList.toggle('translate-x-0', open);
    backdrop.classList.toggle('hidden', !open);
    // The external toggle button sits in the same top-left corner as the drawer's own logo
    // — hide it while open, since the drawer's internal close (X) button already covers
    // dismissal, avoiding the two visually overlapping.
    btn.classList.toggle('hidden', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function initDashboardSidebar(activePage) {
    // Defense in depth on top of the file-load-time redirect above: if that check somehow
    // didn't fire in time (or this function is ever called in a context that skipped it),
    // don't render real nav/data regardless. Uses the real engine-core.js function here
    // (already loaded by the time initDashboardSidebar() runs, unlike the top-of-file check)
    // — mirrors admin-sidebar.js's own initAdminSidebar() guard exactly.
    if (typeof getAuthenticatedClientId === 'function' && !getAuthenticatedClientId()) {
      location.replace('login.html');
      return;
    }

    var mount = document.getElementById('sidebar-mount');
    if (!mount) return;

    // Identity display fix (Aug 22, 2026): the footer used to hardcode "JD"/"John Doe"/
    // "Individual Account" regardless of who Phase 3 actually authenticated.
    // getAuthenticatedClientId() is guaranteed non-null here (the guard above already
    // returned otherwise), and getClient()/getClientInitials() are real engine-core.js
    // functions, already loaded by the time this function runs (only ever called from a
    // page's own script, after engine-core.js's <script> tag). Falls back to a generic
    // label only if something is genuinely wrong (e.g. a corrupted/unknown client id) —
    // never silently back to CLIENT-0001 or "John Doe".
    var footerClient = (typeof getClient === 'function' && typeof getAuthenticatedClientId === 'function')
      ? getClient(getAuthenticatedClientId())
      : null;
    var footerName = footerClient ? footerClient.name : 'Unknown Client';
    var footerAccountType = footerClient ? footerClient.accountType : '';
    var footerInitials = (footerClient && typeof getClientInitials === 'function') ? getClientInitials(footerClient.name) : '';

    var navHTML = NAV_ITEMS.map(function (item) { return navLinkHTML(item, activePage); }).join('');

    mount.innerHTML =
      '<button type="button" id="sidebar-toggle-btn" class="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-lg bg-navy text-white flex items-center justify-center shadow-lg" aria-label="Toggle menu" aria-expanded="false" aria-controls="sidebar-aside">' +
        '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>' +
      '</button>' +
      '<div id="sidebar-backdrop" class="hidden lg:hidden fixed inset-0 bg-navy-dark/60 z-40"></div>' +
      // h-screen is required, not decorative: in fixed/narrow mode inset-y-0 already forces
      // full-viewport height implicitly, but at lg:static (desktop) position:static ignores
      // inset entirely — without an explicit height, the aside falls back to its own
      // content's natural height (shrink-to-fit), which is shorter than most viewports,
      // leaving the cream body background visible below the navy panel. #sidebar-mount
      // itself does stretch to the outer h-screen row's height (default flex align-items
      // stretch), but that stretch doesn't cascade down through it to a plain block child.
      '<aside id="sidebar-aside" class="w-64 h-screen bg-navy text-white flex flex-col fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200 lg:static lg:translate-x-0">' +
        '<div class="h-16 flex items-center justify-between px-6 border-b border-white/10">' +
          '<span class="text-lg font-bold tracking-tight">MARKETSWAVE</span>' +
          '<button type="button" id="sidebar-close-btn" class="lg:hidden text-white/70 hover:text-white transition" aria-label="Close menu">' +
            '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<nav class="flex-1 px-4 py-6 space-y-1 overflow-y-auto">' +
          navHTML +
          '<div class="pt-4 pb-2">' +
            '<a href="deploy-capital.html" class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-white text-navy font-semibold text-sm hover:bg-cream transition">' +
              '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>' +
              'Deploy Capital' +
            '</a>' +
          '</div>' +
        '</nav>' +
        '<div class="px-4 pb-4 space-y-1 border-t border-white/10 pt-4">' +
          footerLinkHTML('settings.html', 'settings', 'Settings', SETTINGS_ICON, activePage) +
          footerLinkHTML('support.html', 'support', 'Support', SUPPORT_ICON, activePage) +
          '<div class="flex items-center gap-3 px-3 pt-3 mt-2 border-t border-white/10">' +
            '<div class="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-sm font-semibold">' + footerInitials + '</div>' +
            '<div class="flex-1 min-w-0">' +
              '<p class="text-sm font-medium truncate">' + footerName + '</p>' +
              '<p class="text-xs text-white/60 truncate">' + footerAccountType + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</aside>';

    document.getElementById('sidebar-toggle-btn').addEventListener('click', function () {
      toggleSidebar(this.getAttribute('aria-expanded') !== 'true');
    });
    document.getElementById('sidebar-close-btn').addEventListener('click', function () { toggleSidebar(false); });
    document.getElementById('sidebar-backdrop').addEventListener('click', function () { toggleSidebar(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') toggleSidebar(false);
    });

    wireLogoutLinks();
  }

  // Logout is a plain <a href="index.html">Logout</a> duplicated in every page's own
  // <header> — not part of this shared mount (headers differ slightly per page: some carry
  // a notification bell, some don't), so it can't be found via a shared id the way the
  // sidebar itself is. Wired here via content-based lookup instead, so every page gets a
  // working Logout at once without editing 9 files individually — matching how the sidebar
  // and clock were centralized. Client Authentication Phase 3 (Aug 21, 2026): a real session
  // now exists (Phase 2's marketswave_authenticated_client_id), so this is no longer a
  // documented no-op — genuinely clears it via clearClientAuthentication(), the real
  // engine-core.js function (already loaded by the time a click can happen), plus the
  // ambient marketswave_current_client_id pin directly (no dedicated "unset" function exists
  // for that key, same raw-key exception already used at file-load time above). Without this,
  // the file-load-time guard above would happily re-pin and let a "logged out" browser straight
  // back onto a dashboard page on the next navigation, since the auth key would still be set.
  function wireLogoutLinks() {
    Array.prototype.forEach.call(document.querySelectorAll('a'), function (link) {
      if (link.textContent.trim() !== 'Logout') return;
      link.setAttribute('href', 'login.html');
      link.addEventListener('click', function () {
        try {
          if (typeof clearClientAuthentication === 'function') clearClientAuthentication();
          sessionStorage.removeItem('marketswave_current_client_id');
        } catch (e) { /* sessionStorage unavailable — non-fatal */ }
      });
    });
  }

  window.initDashboardSidebar = initDashboardSidebar;
})();
