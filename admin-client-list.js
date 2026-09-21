// ★ PM tool revamp, part 5 (2026-09-15) — the client list (register row 235).
//
// ★★ THE PRECEDENCE RULE THIS PAGE EXISTS TO GET RIGHT:
//   SUPABASE IS AUTHORITATIVE FOR ANY CLIENT WHO EXISTS THERE.
//   The local engine is a fallback ONLY for clients who exist nowhere else.
//
// The old page had this exactly backwards — it merged localClients.concat(supabaseClients) with
// LOCAL winning the dedup, so a client mirrored into this browser by a past sign-in shadowed
// their real Supabase record and their money was read from localStorage, where a PM's browser
// holds none. The seeded fixture client and a real client rendered $0 while genuinely holding real value. Reproduced by
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
      var both = await Promise.all([
        MarketswaveData.callFunction('get-client-list', {}),
        // ★ Invitations are their own read (register row 254) — a pending invitation is not a
        // client and never appears in `rows`; it has its own panel and its own strip card.
        MarketswaveData.callFunction('get-client-invitations', {})
      ]);
      var payload = both[0], inv = both[1];
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
      return { rows: rows, strip: payload.strip, dormantDays: payload.dormantDays,
        invitations: inv.invitations || [], invitationCounts: inv.counts || { out: 0, expiringSoon: 0, expired: 0 } };
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
    var ic = d.invitationCounts || { out: 0, expiringSoon: 0, expired: 0 };
    var invSub = ic.out
      ? (ic.expiringSoon ? (ic.expiringSoon + ' expiring soon') : (ic.expired ? (ic.expired + ' expired') : 'none accepted yet'))
      : (ic.expired ? (ic.expired + ' expired') : 'none out');
    // ★ Clients and Invitations are separate facts (row 254): the Clients figure counts rows in
    // the list below and never an invitation; "Invitations out" counts live invitations only.
    return [
      card('Clients', String(d.rows.length), s.active + ' active · ' + s.pendingApproval + ' pending approval'),
      card('Invitations out', String(ic.out), esc(invSub), ic.expiringSoon > 0),
      card('Assets under management', usd(s.aum), '<span class="' + aumCls + '">' + esc(aumSub) + '</span>' + unavailable),
      card('Awaiting your approval', String(s.pendingTotal),
        s.pendingTotal ? ('across ' + s.pendingClients + ' client' + (s.pendingClients === 1 ? '' : 's')) : 'nothing pending',
        s.pendingTotal > 0)
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
    state.data = d;
    state.rows = d.rows; state.strip = d.strip; state.dormantDays = d.dormantDays;
    D.getElementById('cl-strip').innerHTML = renderStrip(d);
    D.getElementById('cl-invitations').innerHTML = renderInvitations(d);
    D.getElementById('cl-filters').innerHTML = renderFilters();
    D.getElementById('cl-head').innerHTML = renderHead();
    D.getElementById('clients-list').innerHTML = renderRows();
  }
  function repaint() {
    D.getElementById('cl-filters').innerHTML = renderFilters();
    D.getElementById('cl-head').innerHTML = renderHead();
    D.getElementById('clients-list').innerHTML = renderRows();
  }

  // ---- invitations (register row 254) ------------------------------------------------------
  // Its own panel, its own read, its own strip card. A pending invitation is not a client:
  // it has no account behind it until the person completes signup themselves.
  var INV_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>';
  function dayShort(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    var d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000);
    if (d >= 1) return d + (d === 1 ? ' day ago' : ' days ago');
    if (h >= 1) return h + (h === 1 ? ' hour ago' : ' hours ago');
    if (m >= 1) return m + ' min ago';
    return 'just now';
  }
  function renderInvitations(d) {
    var list = d.invitations || [];
    var live = list.filter(function (i) { return i.status !== 'expired'; });
    var meta = list.length
      ? (live.length + ' sent' + (list.length - live.length ? ' \u00b7 ' + (list.length - live.length) + ' expired' : '') + ' \u00b7 none accepted yet')
      : '';
    var head = '<div class="cl-ih">' + INV_ICON + '<b>Pending invitations</b>' +
      (meta ? '<span class="cl-ih-meta">' + esc(meta) + '</span>' : '') + '</div>';
    if (!list.length) {
      return head + '<div class="cl-inv-empty" data-cl-inv-empty><p><b>No invitations out.</b><br>Invite someone and they\u2019ll appear here until they complete signup.</p></div>';
    }
    return head + list.map(function (i) {
      var expired = i.status === 'expired';
      var pill = expired ? '<span class="cl-istat cl-s-exp">Expired</span>'
        : i.status === 'opened' ? '<span class="cl-istat cl-s-open">Opened</span>'
        : '<span class="cl-istat cl-s-sent">Sent</span>';
      var when = expired
        ? '<span class="cl-isent-x">expired ' + esc(ago(i.expiresAt)) + '</span>'
        : (i.expiringSoon ? '<span class="cl-isent-x">expires ' + esc(dayShort(i.expiresAt)) + '</span>' : '<span>' + esc(ago(i.lastSentAt)) + '</span>');
      var acts = expired
        ? '<button type="button" class="mw-btn mw-btn-sm" data-cl-inv-again="' + esc(i.id) + '">Invite again</button>' +
          '<button type="button" class="mw-btn mw-btn-sm cl-inv-warn" data-cl-inv-revoke="' + esc(i.id) + '" data-mode="remove">Remove</button>'
        : '<button type="button" class="mw-btn mw-btn-sm" data-cl-inv-resend="' + esc(i.id) + '">Resend</button>' +
          '<button type="button" class="mw-btn mw-btn-sm cl-inv-warn" data-cl-inv-revoke="' + esc(i.id) + '" data-mode="revoke">Revoke</button>';
      return '<div class="cl-ir' + (expired ? ' is-expired' : '') + '" data-cl-inv="' + esc(i.id) + '" data-status="' + esc(i.status) + '">' +
        '<span class="cl-iav">' + esc(initials(i.fullName)) + '</span>' +
        '<div class="cl-inm"><b>' + esc(i.fullName) + '</b><span>' + esc(i.email) + '</span></div>' +
        '<div class="cl-isent">' + esc(dayShort(i.lastSentAt)) + when + '</div>' +
        '<div>' + pill + '</div>' +
        '<div class="cl-iacts">' + acts + '</div>' +
        '</div>';
    }).join('');
  }

  function toast(title, body) {
    var t = D.getElementById('admin-toast'); if (!t) return;
    D.getElementById('admin-toast-title').textContent = title;
    D.getElementById('admin-toast-body').textContent = body || '';
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.add('hidden'); }, 4500);
  }
  function invitationById(id) {
    var d = state.data; if (!d) return null;
    for (var k = 0; k < d.invitations.length; k++) if (d.invitations[k].id === id) return d.invitations[k];
    return null;
  }
  function afterInvitationChange() {
    return reload().then(function (d) {
      state.data = d;
      D.getElementById('cl-strip').innerHTML = renderStrip(d);
      D.getElementById('cl-invitations').innerHTML = renderInvitations(d);
    });
  }

  // the invite modal
  var inviteModal = D.getElementById('invite-modal');
  var inviteError = D.getElementById('invite-error');
  function openInvite(prefill) {
    inviteError.classList.add('hidden'); inviteError.textContent = '';
    D.getElementById('invite-name').value = prefill && prefill.fullName ? prefill.fullName : '';
    D.getElementById('invite-email').value = prefill && prefill.email ? prefill.email : '';
    D.getElementById('invite-note').value = '';
    inviteModal.classList.remove('hidden');
    D.getElementById('invite-name').focus();
  }
  function closeInvite() { inviteModal.classList.add('hidden'); }
  function submitInvite() {
    var fullName = (D.getElementById('invite-name').value || '').trim();
    var email = (D.getElementById('invite-email').value || '').trim();
    var note = (D.getElementById('invite-note').value || '').trim();
    inviteError.classList.add('hidden');
    if (!fullName) { inviteError.textContent = 'A full name is required.'; inviteError.classList.remove('hidden'); return; }
    if (!email) { inviteError.textContent = 'An email address is required.'; inviteError.classList.remove('hidden'); return; }
    var btn = D.getElementById('invite-submit');
    MarketswaveData.withButtonBusy(btn, 'Sending\u2026', function () {
      return MarketswaveData.callFunction('create-client-invitation', { fullName: fullName, email: email, note: note || null });
    }).then(function (res) {
      closeInvite();
      toast(res.emailSent ? 'Invitation sent' : 'Invitation created \u2014 email not sent',
        res.emailSent ? (fullName + ' has been emailed a signup link. It expires in 14 days.') : ('The email could not be sent: ' + (res.emailError || 'unknown error') + '. Use Resend to try again.'));
      return afterInvitationChange();
    }).catch(function (e) {
      // The server's own reason — an address that already belongs to a client, or a live
      // invitation already out — shown where the PM is looking, verbatim.
      inviteError.textContent = MarketswaveData.writeErrorMessage(e);
      inviteError.classList.remove('hidden');
    });
  }

  // the revoke / remove confirm
  var revokeModal = D.getElementById('invite-revoke-modal');
  var revokeTarget = null;
  function openRevoke(id, mode) {
    var inv = invitationById(id); if (!inv) return;
    revokeTarget = { id: id, mode: mode };
    var remove = mode === 'remove';
    D.getElementById('invite-revoke-title').textContent = remove ? 'Remove this expired invitation?' : 'Revoke this invitation?';
    D.getElementById('invite-revoke-body').textContent = remove
      ? (inv.fullName + '\u2019s link has already expired. Removing it clears it from this list; you can invite them again at any time.')
      : ('The link emailed to ' + inv.fullName + ' (' + inv.email + ') stops working immediately. You can invite them again later.');
    D.getElementById('invite-revoke-submit').textContent = remove ? 'Remove' : 'Revoke';
    revokeModal.classList.remove('hidden');
  }
  function closeRevoke() { revokeModal.classList.add('hidden'); revokeTarget = null; }

  D.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t.closest) return;
    if (t.closest('#open-invite-modal')) { openInvite(); return; }
    if (t.closest('#invite-cancel') || t.closest('#invite-modal-close') || t.closest('#invite-modal-backdrop')) { closeInvite(); return; }
    if (t.closest('#invite-submit')) { submitInvite(); return; }
    if (t.closest('#invite-revoke-cancel') || t.closest('#invite-revoke-backdrop')) { closeRevoke(); return; }
    if (t.closest('#invite-revoke-submit')) {
      if (!revokeTarget) return;
      var target = revokeTarget;
      MarketswaveData.withButtonBusy(t.closest('#invite-revoke-submit'), target.mode === 'remove' ? 'Removing\u2026' : 'Revoking\u2026', function () {
        return MarketswaveData.callFunction('revoke-client-invitation', { id: target.id });
      }).then(function () {
        closeRevoke();
        toast(target.mode === 'remove' ? 'Invitation removed' : 'Invitation revoked', target.mode === 'remove' ? '' : 'The emailed link no longer works.');
        return afterInvitationChange();
      }).catch(function (e) { closeRevoke(); toast('Could not do that', MarketswaveData.writeErrorMessage(e)); });
      return;
    }
    var again = t.closest('[data-cl-inv-again]');
    if (again) { openInvite(invitationById(again.getAttribute('data-cl-inv-again'))); return; }
    var resend = t.closest('[data-cl-inv-resend]');
    if (resend) {
      var rid = resend.getAttribute('data-cl-inv-resend');
      MarketswaveData.withButtonBusy(resend, 'Sending\u2026', function () {
        return MarketswaveData.callFunction('resend-client-invitation', { id: rid });
      }).then(function (res) {
        var inv = invitationById(rid);
        toast(res.emailSent ? 'Invitation resent' : 'Resent \u2014 email not sent',
          res.emailSent ? ('A fresh link went to ' + (inv ? inv.email : 'them') + '; the previous one no longer works.') : ('The email could not be sent: ' + (res.emailError || 'unknown error')));
        return afterInvitationChange();
      }).catch(function (e) { toast('Could not resend', MarketswaveData.writeErrorMessage(e)); });
      return;
    }
    var rv = t.closest('[data-cl-inv-revoke]');
    if (rv) { openRevoke(rv.getAttribute('data-cl-inv-revoke'), rv.getAttribute('data-mode')); return; }
  });
  D.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!revokeModal.classList.contains('hidden')) { closeRevoke(); return; }
    if (!inviteModal.classList.contains('hidden')) closeInvite();
  });

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
