// Shared admin sidebar — mirrors dashboard-sidebar.js's mount-point pattern
// (initAdminSidebar('<page-key>') from a page with an empty
// <div id="admin-sidebar-mount"></div>) but is a DELIBERATELY separate file and persona:
// the internal Portfolio Manager tool, not the client dashboard. Do not merge this into
// dashboard-sidebar.js or its NAV_ITEMS — client and admin navigation must never mix.

// ============================================================================================
// ★ Admin Auth Consolidation (2026-09-05) — the gate below REPLACES the retired passphrase
// stub. Read this before changing anything in this section.
// ============================================================================================
// Previously (Aug 21, 2026): a raw sessionStorage flag ('marketswave_admin_authenticated'),
// set by admin-login.html after a client-side passphrase compare with zero real backend —
// explicitly a UI-level stub, never real authentication (see engine-core.js's own ★ RETIRED
// comment above ADMIN_PASSPHRASE for the full historical writeup).
//
// Now: a real Supabase Auth session, established once via a real email/password sign-in on
// admin-login.html, is the SOLE access layer for the entire admin tool — no second, separate
// "real Supabase session" layer underneath it either (that used to exist too, previously
// re-established or re-prompted lazily the first time a privileged call needed one; see
// admin-supabase-config.js's own header for that consolidation). This check calls the real
// `supabase.auth.getSession()` — reads the persisted session from this admin client's own
// distinct storageKey (never the client-facing session's key — see admin-supabase-config.js
// for why that distinction matters) and, in the common case, resolves without any network
// round trip at all (the SDK only reaches the network if the token needs a refresh).
//
// Necessarily async (a real session check cannot be synchronous the way a raw sessionStorage
// flag read could), so "before anything else" now means: fire this check as the very first
// statement this file executes, and gate BOTH initAdminSidebar()'s own rendering AND the
// logout handler on its result — the closest a classic (non-module) script loaded first on
// the page can get to the original's "before anything else" discipline. This does not weaken
// real protection: every privileged read/write this admin tool ever makes is independently
// enforced server-side by Row-Level Security or an Edge Function's own admin-claim check
// (confirmed throughout this project's own Supabase migration) — a brief client-side render
// of the static page shell before this check resolves and redirects is a cosmetic timing
// question, not a data-exposure one, since no real data call succeeds without a real
// admin-claimed session regardless of how fast this redirect fires.
//
// Uses a dynamic import() — valid in this classic, non-module script, the identical technique
// dashboard-sidebar.js's own signOutOfFirebaseAuth()/signOutOfSupabaseAuth() already
// established — rather than adding a page-level <script type="module"> tag to every admin
// page. admin-login.html itself does NOT load this file at all (it has no sidebar/nav until
// authenticated), so there is no redirect loop to guard against here.
//
// Bug fix (Aug 27, 2026), carried forward unchanged: preserves the real-vs-emulator
// `?env=staging` URL param across every internal admin-tool navigation, not just the one
// login->landing redirect the report named. currentEnvQuery() reads the RAW query string
// directly rather than importing IS_STAGING from any config module, keeping this fix
// self-contained.
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

// Shared promise so initAdminSidebar()'s own check below reuses this exact same real
// getSession() call/result rather than firing a second, redundant one a few milliseconds
// later — both still exist (mirroring the original's file-load-time-check +
// defense-in-depth-inside-initAdminSidebar() two-layer shape) because they serve two
// different callers (this top-level IIFE runs unconditionally on file load; initAdminSidebar()
// is called explicitly by each page's own script and must not render if this resolves false).
var __adminEmail = null;
var __adminSessionCheck = import('./admin-supabase-config.js').then(function (mod) {
  return mod.supabase.auth.getSession();
}).then(function (res) {
  var authenticated = !!(res && res.data && res.data.session);
  if (authenticated) __adminEmail = (res.data.session.user && res.data.session.user.email) || null;
  if (!authenticated) {
    location.replace('admin-login.html' + currentEnvQuery());
  }
  return authenticated;
}).catch(function () {
  // A real failure here (e.g. the local stack isn't running) is treated the same as "no
  // session" — fails closed, never fails open into rendering admin content.
  location.replace('admin-login.html' + currentEnvQuery());
  return false;
});

(function () {
  // ★ PM tool revamp, part 2 (2026-09-14): TEN UNGROUPED ITEMS, ordered by how often a PM
  // touches them. The GROUPS array and every group header are gone — the ordering does the
  // work. The seven Approval Gate pages collapsed to ONE item, "Approvals" — and as of part 3
  // (2026-09-15) admin-approvals.html IS the gate rather than a landing: those seven pages are
  // retired, so the item needs no `aliases`. The mechanism stays in navHTML() for a future
  // family of pages that one item stands for. "Support" was folded into
  // Inbox in part 1 and has no entry. Counts: Approvals (pending across the seven queues) and
  // Inbox (conversations needing a reply) are live; "On the site" carries a green dot, not a
  // count, because that number is live and a count would be stale the moment it painted.
  // History of the grouped nav this replaced (Aug 21-23, 2026): see git.
  var ICON = {
    overview: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
    approvals: '<path d="M20 6 9 17l-5-5"/>',
    inbox: '<path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.5z"/>',
    clients: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
    presence: '<circle cx="12" cy="12" r="3"/><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/>',
    products: '<path d="M20 7 12 3 4 7v10l8 4 8-4z"/><path d="m4 7 8 4 8-4M12 21V11"/>',
    'deposit-addresses': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M7 15h3"/>',
    documents: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    settings: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    blog: '<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v5h5M3 15h6M3 11h8M3 19h4"/>',
    security: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
  };

  var NAV_ITEMS = [
    { key: 'overview', href: 'admin.html', label: 'Overview' },
    // PM tool revamp part 3 (2026-09-15): the seven queue pages this item used to stand for
    // are retired and admin-approvals.html IS the gate, so there is nothing left to alias.
    { key: 'approvals', href: 'admin-approvals.html', label: 'Approvals', count: 'sidebar-approvals-count' },
    { key: 'inbox', href: 'admin-inbox.html', label: 'Inbox', count: 'sidebar-inbox-count' },
    { key: 'clients', href: 'admin-clients.html', label: 'Clients' },
    { key: 'presence', href: 'admin-presence.html', label: 'On the site', live: 'sidebar-presence-count' },
    { key: 'products', href: 'admin-products.html', label: 'Products' },
    { key: 'deposit-addresses', href: 'admin-deposit-addresses.html', label: 'Deposit addresses' },
    { key: 'documents', href: 'admin-documents.html', label: 'Documents' },
    { key: 'help', href: 'admin-help.html', label: 'Help Center' },
    { key: 'blog', href: 'admin-blog.html', label: 'Blog & Press', count: 'sidebar-blog-count' },
    { key: 'settings', href: 'admin-advisory-fee.html', label: 'Advisory fee' },
    { key: 'security', href: 'admin-security.html', label: 'Security' }
  ];

  function navLinkHTML(item, activePage) {
    var on = item.key === activePage || (item.aliases && item.aliases.indexOf(activePage) !== -1);
    var badge = '';
    if (item.count) {
      // Starts hidden/0 (honest until the first real read), never a fake interim value.
      badge = '<span id="' + item.count + '" class="an-ct is-hot" hidden aria-label="' + (item.key === 'inbox' ? 'conversations needing a reply' : (item.key === 'blog' ? 'flagged comments worth a look' : 'approvals waiting on you')) + '">0</span>';
    } else if (item.live) {
      // The dot carries the real count for assistive tech (and for the checks that read it)
      // without painting a number that would be stale the moment it rendered.
      badge = '<span id="' + item.live + '" class="an-live" hidden role="status" aria-label="visitors on the site now" title="On the site now"><span class="an-sr">0</span></span>';
    }
    return '<a href="' + item.href + '" class="an-item' + (on ? ' is-on' : '') + '"' + (on ? ' aria-current="page"' : '') + '>' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[item.key] + '</svg>' +
      '<span class="an-lb">' + item.label + '</span>' + badge +
      '</a>';
  }

  function navHTML(activePage) {
    return NAV_ITEMS.map(function (item) { return navLinkHTML(item, activePage); }).join('');
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
    // Defense in depth on top of the file-load-time check above: awaits that SAME real
    // getSession() result (not a second independent call) before rendering anything — if it
    // resolves false, the redirect has already been issued by the check above; this function
    // simply must not render the sidebar mount in that case. Necessarily async (a real session
    // check cannot be synchronous) — nothing in this file or any admin page's own script
    // depends on initAdminSidebar() completing synchronously (confirmed by reading every
    // admin page's own script-tag order: each page's data-loading logic lives in its own,
    // separate <script> block after the one that calls this function, never inline after it).
    __adminSessionCheck.then(function (authenticated) {
      if (!authenticated) return;
      renderAdminSidebar(activePage);
    });
  }

  // ★ Visitor presence (2026-09-13). On EVERY admin page: keeps the sidebar's live count and
  // raises a browser notification per arriving visitor — while the PM tool is open in any
  // tab. Permission is never requested here (a prompt on load gets denied); it is asked on
  // admin-presence.html, with the reason. Mute (localStorage mw_presence_mute) silences the
  // notification, not the count. A `tag` per session collapses duplicates across open tabs.
  // Reads go through the real admin session under RLS (admin-only), via Realtime
  // postgres_changes on visitor_sessions plus a 30-second recount — a session that stops
  // heartbeating leaves the count without any event.
  var LIVE_WINDOW_SECONDS = 45;
  function startPresenceWatch() {
    var badge = document.getElementById('sidebar-presence-count');
    if (!badge) return;
    var supabase = null;
    function paint(n) {
      // A dot, not a number (PM tool revamp, part 2): the count lives in the visually-hidden
      // span for assistive tech; the dot shows while anyone is on the site.
      // Never assume the element can be queried: a harness stub or a partially-rendered
      // node may not carry querySelector, and this runs inside a .then() where a throw is an
      // unhandled rejection (fatal in Node, a dead recount loop in a browser). Falling back
      // to the plain-count branch below is the correct degraded behaviour, not a silent skip.
      var sr = badge.querySelector ? badge.querySelector('.an-sr') : null;
      if (sr) { sr.textContent = String(n); badge.setAttribute('aria-label', n + (n === 1 ? ' visitor' : ' visitors') + ' on the site now'); } else badge.textContent = String(n);
      badge.classList.toggle('hidden', !(n > 0));
      badge.hidden = !(n > 0); // the attribute, so the badge hides without Tailwind's .hidden
    }
    function recount() {
      if (!supabase) return;
      var since = new Date(Date.now() - LIVE_WINDOW_SECONDS * 1000).toISOString();
      supabase.from('visitor_sessions').select('id', { count: 'exact', head: true }).gte('last_seen_at', since).is('ended_at', null)
        .then(function (r) { if (!r.error) paint(r.count || 0); })
        .catch(function () { /* leave the badge as it stands: a failed repaint never kills the page */ });
    }
    function notify(row) {
      if (!window.Notification || Notification.permission !== 'granted') return;
      if (localStorage.getItem('mw_presence_mute') === '1') return;
      var where = [row.city, row.country].filter(Boolean).join(', ') || 'Unknown location';
      var who = row.client_name ? row.client_name + ' (client)' : (Number(row.visit_number) >= 2 ? 'Returning visitor' : 'New visitor');
      try {
        var n = new Notification(who + ' on the site', { body: (row.current_path || '/') + ' · ' + where, tag: 'mw-visitor-' + row.id, silent: true });
        n.onclick = function () { window.focus(); location.href = 'admin-presence.html' + currentEnvQuery(); };
      } catch (e) { /* notifications unavailable in this context */ }
    }
    import('./admin-supabase-config.js').then(function (mod) {
      supabase = mod.supabase;
      recount();
      setInterval(recount, 30000);
      supabase.channel('admin-sidebar-presence')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visitor_sessions' }, function (payload) { recount(); notify(payload.new); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'visitor_sessions' }, function () { recount(); })
        .subscribe();
    }).catch(function () { /* the count stays hidden: never a fake number */ });
  }

  // ★ PM tool revamp, part 1 (2026-09-14). The inbox's notifications reuse the presence
  // model above rather than a second one: on EVERY admin page the Inbox item carries a live
  // "needs a reply" count (conversations.unread_by_pm, admin-only RLS, via Realtime on
  // conversations plus a 30-second recount), and an inbound message raises a browser
  // notification — permission is asked on admin-inbox.html with the reason, never on load;
  // mute (localStorage mw_inbox_mute) silences the notification, not the count; a `tag` per
  // conversation collapses duplicates across open tabs. A ticket names its DISP id.
  function startInboxWatch() {
    var badge = document.getElementById('sidebar-inbox-count');
    if (!badge) return;
    var supabase = null;
    var convoNames = {};
    function paint(n) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', !(n > 0));
      badge.hidden = !(n > 0); // the attribute, so the badge hides without Tailwind's .hidden
    }
    function recount() {
      if (!supabase) return;
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('unread_by_pm', true).neq('status', 'archived')
        .then(function (r) { if (!r.error) paint(r.count || 0); })
        .catch(function () { /* leave the badge as it stands: a failed repaint never kills the page */ });
    }
    function notify(message) {
      if (!message || message.direction !== 'inbound' || message.channel === 'system') return;
      if (!window.Notification || Notification.permission !== 'granted') return;
      if (localStorage.getItem('mw_inbox_mute') === '1') return;
      var onInbox = /admin-inbox\.html/.test(location.pathname) && document.visibilityState === 'visible';
      if (onInbox) return; // the page itself shows it live
      supabase.from('conversations').select('id, contact_name, contact_email, kind, display_id').eq('id', message.conversation_id).maybeSingle().then(function (r) {
        var c = r.data || {};
        var who = c.contact_name || c.contact_email || 'A visitor';
        var title = c.kind === 'ticket' ? who + ' replied on ' + (c.display_id || 'a ticket') : 'New message from ' + who;
        try {
          var n = new Notification(title, { body: String(message.body || '').slice(0, 140), tag: 'mw-inbox-' + message.conversation_id, silent: true });
          n.onclick = function () { window.focus(); location.href = 'admin-inbox.html?c=' + message.conversation_id + currentEnvQuery().replace(/^\?/, '&'); };
        } catch (e) { /* notifications unavailable in this context */ }
      });
    }
    import('./admin-supabase-config.js').then(function (mod) {
      supabase = mod.supabase;
      recount();
      setInterval(recount, 30000);
      supabase.channel('admin-sidebar-inbox')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, function (payload) { recount(); notify(payload.new); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, function () { recount(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, function () { recount(); })
        .subscribe();
    }).catch(function () { /* the count stays hidden: never a fake number */ });
  }

  // ★ Blog & Press (2026-09-24). The rail count is FLAGGED, LIVE comments — not every comment,
  // and not removed ones. A flag is a prompt for a PM to look, so the number has to mean "this
  // many are waiting for your judgement"; counting all comments would make the badge permanent
  // and therefore ignored. Nothing is hidden automatically — a flagged comment is public the
  // whole time it is counted here, which is exactly why the count is worth surfacing.
  function startBlogWatch() {
    var badge = document.getElementById('sidebar-blog-count');
    if (!badge) return;
    var supabase = null;
    function paint(n) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', !(n > 0));
      badge.hidden = !(n > 0);
    }
    function recount() {
      if (!supabase) return;
      supabase.from('blog_comments').select('id', { count: 'exact', head: true })
        .eq('flagged', true).is('removed_at', null)
        .then(function (r) { if (!r.error) paint(r.count || 0); })
        .catch(function () { /* leave the badge as it stands */ });
    }
    import('./admin-supabase-config.js').then(function (mod) {
      supabase = mod.supabase;
      recount();
      setInterval(recount, 30000);
      supabase.channel('admin-sidebar-blog')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'blog_comments' }, recount)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'blog_comments' }, recount)
        .subscribe();
    }).catch(function () { /* the count stays hidden: never a fake number */ });
  }

  // ★ PM tool revamp, part 2 (2026-09-14). The Approvals item's live count: every pending
  // request across the seven queues plus applications awaiting review — the same seven
  // reads admin-approvals.html makes, kept live by Realtime on each table plus a 30-second
  // recount (a resolved request is an UPDATE; a new one an INSERT). Same shape as the
  // presence and inbox watches above: starts hidden, never a fake interim value.
  var APPROVAL_TABLES = ['deposit_requests', 'withdrawal_requests', 'allocation_requests', 'sell_requests', 'hys_deposit_requests', 'hys_withdrawal_requests', 'profile_change_requests'];
  function startApprovalsWatch() {
    var badge = document.getElementById('sidebar-approvals-count');
    if (!badge) return;
    var supabase = null;
    function paint(n) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', !(n > 0));
      badge.hidden = !(n > 0); // the attribute, so the badge hides without Tailwind's .hidden
    }
    function recount() {
      if (!supabase) return;
      var reads = APPROVAL_TABLES.map(function (t) { return supabase.from(t).select('id', { count: 'exact', head: true }).eq('status', 'pending'); });
      reads.push(supabase.from('clients').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'));
      Promise.all(reads).then(function (results) {
        var total = 0;
        for (var i = 0; i < results.length; i++) { if (results[i].error) return; total += results[i].count || 0; }
        paint(total);
      }).catch(function () { /* leave the badge as it stands: a failed repaint never kills the page */ });
    }
    import('./admin-supabase-config.js').then(function (mod) {
      supabase = mod.supabase;
      recount();
      setInterval(recount, 30000);
      var ch = supabase.channel('admin-sidebar-approvals');
      APPROVAL_TABLES.concat(['clients']).forEach(function (t) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, function () { recount(); });
      });
      ch.subscribe();
    }).catch(function () { /* the count stays hidden: never a fake number */ });
  }

  function renderAdminSidebar(activePage) {
    var mount = document.getElementById('admin-sidebar-mount');
    if (!mount) return;

    mount.innerHTML =
      '<button type="button" id="admin-sidebar-toggle-btn" class="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-lg" aria-label="Toggle menu" aria-expanded="false" aria-controls="admin-sidebar-aside">' +
        '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>' +
      '</button>' +
      '<div id="admin-sidebar-backdrop" class="hidden lg:hidden fixed inset-0 bg-black/60 z-40"></div>' +
      // The look is admin-nav.css (.an-*); the off-canvas drawer mechanics below lg stay the
      // Tailwind utilities every admin page has always used (h-screen for the same reason
      // dashboard-sidebar.js needs it — see CLAUDE.md's sidebar-height bug note).
      '<aside id="admin-sidebar-aside" class="an-side h-screen fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200 lg:static lg:translate-x-0">' +
        '<div class="an-brand">' +
          '<span class="an-lg" aria-hidden="true">M</span>' +
          '<div class="an-bn"><b>MARKETSWAVE</b><span>Manager</span></div>' +
          '<button type="button" id="admin-sidebar-close-btn" class="an-close lg:hidden" aria-label="Close menu">' +
            '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<nav class="an-nav" aria-label="PM tool">' +
          navHTML(activePage) +
        '</nav>' +
        '<div class="an-foot">' +
          '<div class="an-pm">' +
            '<span class="an-av" aria-hidden="true">PM</span>' +
            // The account: role and sign-in email. No display name — the account has no name
            // field, and will not until multi-PM adds one.
            '<div class="an-nm"><b>Portfolio manager</b><span id="admin-sidebar-email" title="' + (__adminEmail || '') + '">' + (__adminEmail || '…') + '</span></div>' +
            // Admin-tool logout — distinct from any client-facing logout (dashboard-sidebar.js's
            // own, which navigates to login.html): this one ends the real admin Supabase
            // session (see the click handler below) and returns to admin-login.html.
            '<button type="button" id="admin-logout-btn" class="an-out" title="Log out" aria-label="Log out">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>' +
            '</button>' +
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
      // Rewritten, 2026-09-05: previously cleared only the local passphrase-gate flag — there
      // was no real Supabase session to end (it was persistSession: false, so nothing durable
      // to sign out of). Now that a real, persisted admin session is the sole access layer,
      // Logout must genuinely end it, not just navigate away and leave a real, still-valid
      // session sitting in localStorage under this file's own distinct storageKey (see
      // admin-supabase-config.js's own header for why that key is distinct in the first
      // place). Mirrors dashboard-sidebar.js's own signOutOfSupabaseAuth() exactly — same
      // dynamic-import technique, same "best-effort, wrapped in a timeout race" shape, and
      // the SAME investigated conclusion that this SDK/config combination (persistSession:
      // true + localStorage, GoTrueClient's own constructor-time initializePromise) needs
      // neither of the two races Firebase's own signOut() had to work around by hand — see
      // that file's own comment for the full source-level verification, which applies
      // identically here since this is the same SDK version and the same persistence
      // category, just a different storageKey.
      var attempt = import('./admin-supabase-config.js').then(function (mod) {
        return mod.supabase.auth.signOut();
      }).catch(function () { /* non-fatal — best-effort, see comment above */ });
      var timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); });
      Promise.race([attempt, timeout]).then(function () {
        // Preserves env across logout too — a PM deliberately testing staging shouldn't have
        // that context silently dropped the moment they log back out, only to have their next
        // login attempt quietly land back on the local stack with no indication why.
        location.replace('admin-login.html' + currentEnvQuery());
      });
    });

    preserveEnvParamInPageLinks();
    startPresenceWatch();
    startInboxWatch();
    startApprovalsWatch();
    startBlogWatch();
  }

  window.initAdminSidebar = initAdminSidebar;
})();
