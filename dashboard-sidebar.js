// Shared dashboard sidebar — extracted from the duplicated <aside> markup that used to
// live on every dashboard page. Call initDashboardSidebar('<page-key>') once, after this
// script has loaded, from a page that has an empty <div id="sidebar-mount"></div> in place
// of the old <aside>. The matching nav item is highlighted based on the page key passed in.
(function () {
  // Bug fix (Aug 27, 2026): preserves the real-vs-emulator `?env=staging` URL param across
  // every internal client-facing navigation, not just one redirect — the client-side half of
  // the exact same fix admin-sidebar.js/admin-login.html just got. Matters for real here too,
  // not just cosmetically: signOutOfFirebaseAuth() below reads firebase-config.js's IS_STAGING
  // fresh from the CURRENT page's own URL at the moment Logout is clicked, so if this page's
  // own URL never carried the param (because an earlier redirect or nav link silently dropped
  // it), a real staging sign-out would incorrectly target the emulator instead, leaving the
  // real staging session it meant to close still live. Defined here, before its first use
  // below, rather than after — function declarations hoist in JS, but this reads clearer.
  function currentEnvQuery() {
    try {
      return new URLSearchParams(window.location.search).get('env') === 'staging' ? '?env=staging' : '';
    } catch (e) { return ''; }
  }

  // Rewrites every same-page, local .html link — this file's own rendered sidebar nav/footer/
  // Deploy Capital CTA, AND each page's own other hardcoded internal links (e.g.
  // asset-performance.html's "Browse Asset Collection" card) — to carry the same env param,
  // in ONE place rather than requiring every current and future internal link to be
  // hand-threaded individually. Mirrors admin-sidebar.js's own identically-named function.
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
    location.replace('login.html' + currentEnvQuery());
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

  // Documents & Reporting is the only nav item with a notification badge, id="sidebar-doc-
  // badge". Bug fix (Aug 27, 2026, from the frontend audit): this used to be hardcoded to a
  // static "2" here, correct only on documents.html itself (whose own script overwrote it
  // after mount) — every other dashboard page showed that same fake "2" for the entire page
  // visit, since nothing on those pages ever touched the element. Masked on a fresh install
  // only because the seed data's real urgentCount also happens to be 2 by coincidence; any
  // real change to a client's document state (sign a document, have a new one published,
  // etc.) exposed the staleness on 9 of 10 client-facing pages. That fix computed the count,
  // at mount time, from getDocumentNotificationCounts() — a real engine-core.js function at
  // the time.
  //
  // ★ Bug-fix rewrite (2026-09-03): getDocumentNotificationCounts() now reads a local,
  // long-stale closure array — documents.html was wired to the real Supabase `documents`
  // table in UI Wiring Stage 4, and its own script was already fixed then to compute its own
  // 3 body-content chips AND re-correct #sidebar-doc-badge from the real fetched data (see
  // its own computeNotificationCounts()/refreshNotificationCounts()) — but this file's own
  // MOUNT-TIME render (which runs on all 9 OTHER client-facing pages, not documents.html
  // itself) never got the same fix, so every page besides documents.html was still showing a
  // stale local count. fetchDocumentBadgeCount() below is a real Supabase read, mirroring
  // documents.html's own real urgentCount rule (isNew/is_new || status === 'Signature
  // Required') exactly, just against real column names. Since this is now genuinely async,
  // the sidebar still renders synchronously first with the badge in its default hidden
  // state (never a fake placeholder count) and patches in the real number once the fetch
  // resolves — see fetchDocumentBadgeCount()'s own call site at the end of
  // initDashboardSidebar() below.
  var ACTIVE_MAIN = 'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 text-white font-medium';
  var INACTIVE_MAIN = 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition';
  var ACTIVE_FOOTER = 'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 text-white transition text-sm font-medium';
  var INACTIVE_FOOTER = 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/90 hover:bg-white/10 hover:text-white transition text-sm font-medium';

  var SETTINGS_ICON = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>';
  var SUPPORT_ICON = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>';

  function navLinkHTML(item, activePage, docBadgeCount) {
    var cls = item.key === activePage ? ACTIVE_MAIN : INACTIVE_MAIN;
    var inner = item.badge
      ? '<span class="flex-1">' + item.label + '</span>' +
        '<span id="sidebar-doc-badge" class="' + (docBadgeCount === 0 ? 'hidden ' : '') + 'inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none">' + docBadgeCount + '</span>'
      : item.label;
    return '<a href="' + item.href + '" class="' + cls + '">' +
      '<svg class="w-5 h-5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + item.icon + '"/></svg>' +
      inner +
      '</a>';
  }

  // Real Supabase read for the sidebar's own Documents badge count — see the file-level
  // comment above navLinkHTML() for the full "why now, why async" reasoning. Mirrors
  // documents.html's own real computeNotificationCounts() urgentCount rule exactly (is_new
  // OR status === 'Signature Required'), against real column names, so both places can never
  // silently disagree about what counts as "urgent." Fails closed to 0 (hidden badge), never
  // a fake nonzero placeholder, if supabase-data.js isn't loaded or the fetch itself fails.
  function fetchDocumentBadgeCount() {
    if (typeof MarketswaveData === 'undefined') return Promise.resolve(0);
    return MarketswaveData.selectTable('documents').then(function (rows) {
      return rows.reduce(function (n, d) { return (d.is_new || d.status === 'Signature Required') ? n + 1 : n; }, 0);
    }).catch(function () { return 0; });
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
      location.replace('login.html' + currentEnvQuery());
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

    // Real Documents badge count (see the file-level comment above navLinkHTML() for the bug
    // this replaces) — getDocumentNotificationCounts() is a real engine-core.js function,
    // already loaded by the time this runs (only ever called after engine-core.js's own
    // <script> tag, same as getClient()/getClientInitials() above). Falls back to 0 (hidden
    // badge) only if something is genuinely wrong, e.g. engine-core.js failed to load —
    // never a fake nonzero placeholder.
    // Starts hidden/0 — the real count is fetched and patched in below, once
    // fetchDocumentBadgeCount() resolves; never a fake interim value.
    var docBadgeCount = 0;

    var navHTML = NAV_ITEMS.map(function (item) { return navLinkHTML(item, activePage, docBadgeCount); }).join('');

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
      // Client Dashboard Visual Treatment, Stage 2 (2026-09-06): bg-navy (solid, opaque)
      // replaced with .glass-dark (glass-primitives.css) — a restrained frosted-glass
      // treatment for this fixed nav chrome. Genuinely visible where content actually
      // scrolls behind it (the off-canvas drawer overlay, below the `lg` breakpoint,
      // real content sits underneath while it's open); at `lg:static` desktop width the
      // sidebar sits beside content with nothing behind it to blur, so the effect there
      // is just the translucent navy tone + soft edge highlight, which is intentional —
      // not a bug, there's genuinely nothing to show through at that width.
      '<aside id="sidebar-aside" class="w-64 h-screen glass-dark text-white flex flex-col fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200 lg:static lg:translate-x-0">' +
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
              // Contrast Audit (2026-09-06): text-white/60 measured 4.42:1 against this
              // sidebar's own real .glass-dark background at its lighter (top) stop -- the
              // footer sits nearer the darker bottom stop in practice (5.60:1, a real pass),
              // but bumped to /70 anyway for a genuine, position-independent margin (5.37:1
              // even at the theoretical worst case, 7.02:1 where it actually renders),
              // matching the identical fix just made to admin-sidebar.js's own footer text.
              '<p class="text-xs text-white/70 truncate">' + footerAccountType + '</p>' +
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
    preserveEnvParamInPageLinks();

    // Real, async — patches the just-mounted badge in place once the real count arrives.
    // documents.html's own script runs this exact same real query independently right after
    // (via computeNotificationCounts()/refreshNotificationCounts()) and will correctly patch
    // it again the moment ITS OWN fetch resolves — both converge on the same real number,
    // this call just means the other 9 pages are no longer permanently stuck on the hidden
    // default.
    fetchDocumentBadgeCount().then(function (count) {
      var badge = document.getElementById('sidebar-doc-badge');
      if (!badge) return;
      badge.textContent = String(count);
      badge.classList.toggle('hidden', count === 0);
    });
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
  //
  // Real Firebase signOut() (Aug 23, 2026, follow-up to Backend Migration Phase 1's own
  // "flagged as real follow-up" note): previously Logout only cleared the local session
  // mirror above, leaving any real Firebase Auth session (from a real login.html sign-in)
  // silently still active. preventDefault() + a manual navigate-after is required here,
  // not the plain <a href> default action, because signOut() is asynchronous and a normal
  // link click's default navigation would tear down this page (aborting the in-flight
  // Firebase call) before it resolves. The local session clear above still runs first and
  // unconditionally — per Phase 1's hybrid bridge, every other page depends entirely on
  // that local mirror, so it must never be skipped or made to wait on Firebase.
  function wireLogoutLinks() {
    Array.prototype.forEach.call(document.querySelectorAll('a'), function (link) {
      if (link.textContent.trim() !== 'Logout') return;
      link.setAttribute('href', 'login.html');
      link.addEventListener('click', function (e) {
        e.preventDefault();
        try {
          if (typeof clearClientAuthentication === 'function') clearClientAuthentication();
          sessionStorage.removeItem('marketswave_current_client_id');
        } catch (err) { /* sessionStorage unavailable — non-fatal */ }
        // Supabase Migration Stage 2 follow-up (Aug 30, 2026): closes the disclosed gap
        // logged when Stage 2 shipped — a real Supabase Auth session (from a real
        // login.html?backend=supabase sign-in) silently outlived an app-level logout, the
        // same bug class already fixed once for Firebase here. Both real sign-outs run
        // alongside each other (Promise.all, not sequential) — this file has no idea which
        // backend actually authenticated the current session (that's the whole point of the
        // hybrid bridge), so it just best-effort signs out of both; whichever one wasn't
        // actually used resolves as a fast, harmless no-op.
        Promise.all([signOutOfFirebaseAuth(), signOutOfSupabaseAuth()]).then(function () {
          window.location.href = 'login.html' + currentEnvQuery();
        });
      });
    });
  }

  // Best-effort real Firebase Auth sign-out, run ALONGSIDE (never instead of) the local
  // session clear in wireLogoutLinks() above. Uses dynamic import() — valid in this
  // classic, non-module script — rather than adding a page-level <script type="module">
  // tag to all 10 client-facing pages that load this file; this keeps Firebase reached
  // from exactly one place outside signup.html/login.html (still the only pages that load
  // it eagerly at page-load time — see CLAUDE.md's Tech Stack section), only at the moment
  // Logout is actually clicked. Wrapped end-to-end (including a 3-second timeout race) so a
  // stopped emulator, a network hiccup, or Firebase already having no live session can never
  // block a real logout from completing.
  //
  // Two real races were found and fixed here, live, not hypothetically — both verified with
  // a genuine signed-in Firebase Auth test user by checking auth state via a FRESH
  // onAuthStateChanged on the very next page load (login.html), never just the in-page
  // synchronous read, since that's what silently masked both bugs during initial testing.
  //
  // Race 1 — MUST wait for auth's own initial state hydration (onAuthStateChanged firing
  // once) before calling signOut(). This file's dynamic import() always creates a BRAND NEW
  // Auth instance (module registries are per-page-load, not cached across navigations),
  // which kicks off an async read of any persisted session from IndexedDB the moment
  // getAuth() runs. Calling signOut() before that read settles loses the race: the in-flight
  // hydration resolves afterward and silently re-populates the very session signOut() just
  // cleared.
  //
  // Race 2 — MUST wait briefly after signOut()'s own promise resolves before navigating
  // away. signOut() resolving does not guarantee its underlying persisted-storage write has
  // actually flushed; navigating immediately (even after Race 1's fix) can still cut that
  // write short, leaving the old session to reappear on the next page. A short fixed delay
  // gives it room to complete — confirmed sufficient at 300ms against the real emulator.
  function signOutOfFirebaseAuth() {
    var attempt = Promise.resolve()
      .then(function () {
        return Promise.all([
          import('./firebase-config.js'),
          import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js')
        ]);
      })
      .then(function (mods) {
        var auth = mods[0].auth;
        var onAuthStateChanged = mods[1].onAuthStateChanged;
        var signOut = mods[1].signOut;
        return new Promise(function (resolve) {
          var unsub = onAuthStateChanged(auth, function () {
            unsub();
            resolve();
          });
        }).then(function () {
          return signOut(auth);
        }).then(function () {
          return new Promise(function (resolve) { setTimeout(resolve, 300); });
        });
      })
      .catch(function () { /* non-fatal — see comment above */ });
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); });
    return Promise.race([attempt, timeout]);
  }

  // Best-effort real Supabase Auth sign-out, run ALONGSIDE signOutOfFirebaseAuth() above
  // (never instead of the local session clear in wireLogoutLinks()). Same dynamic-import
  // technique and the same "one shared module, reached only at the moment Logout is
  // clicked" discipline signOutOfFirebaseAuth() already established — supabase-config.js is
  // otherwise only loaded eagerly by signup.html/login.html.
  //
  // Investigated whether this needs the SAME two races signOutOfFirebaseAuth() had to work
  // around by hand, rather than assuming symmetry between the two SDKs — checked directly
  // against the actual installed @supabase/auth-js source (v2.112.4,
  // scripts/node_modules/@supabase/auth-js/dist/main/GoTrueClient.js), not assumed:
  //
  //   Race 1 (hydration-before-signOut) — does NOT apply here, and this is a genuine,
  //   verified SDK design difference, not an oversight. GoTrueClient's own constructor
  //   fires `this.initialize()` automatically (line ~289-292, unless `skipAutoInitialize` is
  //   set, which supabase-config.js never sets) and assigns `this.initializePromise`
  //   SYNCHRONOUSLY at construction time, even though the promise itself resolves async.
  //   `signOut()` (line ~3405) begins with `await this.initializePromise` before doing
  //   anything else — so the SDK itself already guarantees any in-flight persisted-session
  //   hydration has settled before sign-out logic runs, the exact guarantee Firebase's own
  //   client needed a manual onAuthStateChanged-wait to provide at the app level.
  //
  //   Race 2 (flush-after-resolve) — does NOT apply either, for a different, equally real
  //   reason: Firebase's own default persistence is IndexedDB-backed, a genuinely
  //   asynchronous store whose write can still be in flight after its own promise resolves.
  //   Supabase's session storage here is `globalThis.localStorage` (see supabase-config.js's
  //   own persistSession:true decision) — a synchronous browser API. The SDK's own
  //   `removeItemAsync()` helper (auth-js/dist/main/lib/helpers.js:154-156) is just
  //   `await storage.removeItem(key)`; awaiting an already-synchronous call does not
  //   introduce a delay to wait out — by the time that await's microtask resolves, the
  //   removal has already durably happened, there is no separate flush to race.
  //
  // Both conclusions were then verified the same way the two Firebase races originally were
  // caught — not trusted from reading the source alone: a fresh, real signed-in Supabase
  // test client's session was confirmed genuinely absent via a FRESH auth-state check on the
  // NEXT page load (login.html, a brand-new supabase-config.js client instance calling
  // getSession()), never just an in-page synchronous read on the same page that called
  // signOut() — exactly the discipline that caught both Firebase races in the first place,
  // reused here even though it confirmed a clean result rather than a bug this time. Still
  // wrapped in the same 3-second timeout race as signOutOfFirebaseAuth() — for network
  // resilience (a stopped local stack, a slow connection), not because of either race above.
  function signOutOfSupabaseAuth() {
    var attempt = Promise.resolve()
      .then(function () {
        return import('./supabase-config.js');
      })
      .then(function (mod) {
        return mod.supabase.auth.signOut();
      })
      .catch(function () { /* non-fatal — see comment above */ });
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); });
    return Promise.race([attempt, timeout]);
  }

  window.initDashboardSidebar = initDashboardSidebar;
})();
