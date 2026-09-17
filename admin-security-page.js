/* ★ PM tool revamp, part 8 (2026-09-17) — Account security.
 *
 * Five panels about the signed-in PM's own account (identity, password, two-factor, sessions,
 * activity) plus the pre-existing client security-actions log, which was already on this page
 * and is deliberately kept — it is the only reader of getSecurityActionsLog() anywhere in the
 * project, and parts 5, 6 and 7 each nearly orphaned something by rebuilding a page without
 * first asking what it already did.
 *
 * ★ EVERY READ CHECKS ITS ERROR AND PAINTS A REAL ERROR CARD (register row 233). On a security
 * page a swallowed read is worse than a visible failure: an empty sessions list reads as "you
 * are signed in nowhere else" and an empty activity list as "nothing has happened" — two
 * reassuring statements made from no data at all. Both panels show the real message and a
 * retry instead.
 *
 * ★ TWO THINGS THIS PAGE DELIBERATELY DOES NOT OFFER, each because there is nothing behind it:
 * a display-name field (nothing renders a PM's name to anyone) and a two-factor toggle
 * (Supabase MFA is a Pro-plan feature; a real enrolment attempt returns 422). Both are stated
 * on the page rather than mocked up.
 */
(function () {
  'use strict';

  var state = { data: null };

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message) {
    var t = el('sec-toast');
    if (!t) return;
    t.textContent = message;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, 4200);
  }

  // ---- time ---------------------------------------------------------------------------------
  // A session's last-active time is the thing a PM actually reads a row for, so it gets both
  // forms: a relative one to judge by, and the exact timestamp in the title for when it matters.
  function absTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
  function relTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var secs = Math.round((Date.now() - d.getTime()) / 1000);
    if (secs < 0) secs = 0;
    if (secs < 60) return 'just now';
    var mins = Math.round(secs / 60);
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hours / 24);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
    return absTime(iso);
  }

  // ---- error cards --------------------------------------------------------------------------
  function showError(which, message) {
    var box = el('sec-' + which + '-err');
    var text = el('sec-' + which + '-err-text');
    if (!box || !text) return;
    text.textContent = message;
    box.classList.add('is-shown');
  }
  function clearError(which) {
    var box = el('sec-' + which + '-err');
    if (box) box.classList.remove('is-shown');
  }

  // ---- render -------------------------------------------------------------------------------
  // ★ THE IDENTITY IS RESOLVED INDEPENDENTLY OF THE SESSIONS READ, deliberately. Who you are
  // signed in as is knowable from the session itself and should not disappear because a
  // session/activity query failed — "Signed in as —" next to a red error card reads as "we do
  // not know who you are", which is a worse claim than the one that actually failed.
  function renderAccountFromSession() {
    if (typeof MarketswaveData === 'undefined' || !MarketswaveData.getCurrentUserEmail) return;
    MarketswaveData.getCurrentUserEmail().then(function (email) {
      if (email) el('sec-email').textContent = email;
    }).catch(function () { /* the payload below may still supply it */ });
  }

  function renderAccount(data) {
    var email = data && data.account && data.account.email;
    if (email) el('sec-email').textContent = email;
    el('sec-role').textContent = (data && data.account && data.account.role) || 'Portfolio Manager';
  }

  function sessionRowHTML(s) {
    var badges = '';
    if (s.isCurrent) badges += ' <span class="sec-pill sec-pill--now">This device</span>';
    else if (s.isScript) badges += ' <span class="sec-pill sec-pill--script">Script</span>';

    // Location is null for a private address, a provider miss, or a session past the geo cap.
    // "Unknown location" is the honest rendering of all three — never a guessed city.
    var where = s.location ? esc(s.location) : 'Unknown location';
    var meta = where + (s.ip ? ' &middot; ' + esc(s.ip) : '');

    // ★ NO "Sign out" ON THE CURRENT SESSION. Ending the session you are using is signing out,
    // which the sidebar's Log out already does properly (it clears the local session too);
    // doing it from a row would leave the page looking authenticated with a dead token. The
    // Edge Function refuses it as well — a control the UI does not render is not the same
    // guarantee as a server that will not do it.
    var action = s.isCurrent
      ? ''
      : '<button type="button" class="mw-btn mw-btn-admin mw-btn-sm" data-sec-revoke="' + esc(s.id) + '">Sign out</button>';

    return '<div class="sec-row" data-sec-session="' + esc(s.id) + '">' +
      '<div class="sec-cell">' +
        '<span class="sec-title">' + esc(s.label) + badges + '</span>' +
        '<span class="sec-meta">' + meta + '</span>' +
        '<span class="sec-ua">Last active ' + esc(relTime(s.lastActiveAt)) +
          ' &middot; signed in ' + esc(absTime(s.createdAt)) + '</span>' +
      '</div>' +
      '<div class="sec-actions">' + action + '</div>' +
    '</div>';
  }

  function renderSessions(data) {
    var box = el('sec-sessions');
    var sub = el('sec-sessions-sub');
    var others = el('sec-revoke-others');
    var s = data.sessions;

    var otherCount = s.rows.filter(function (r) { return !r.isCurrent; }).length;
    var hiddenCount = s.total - s.returned;

    if (s.total === 0) {
      sub.textContent = 'No active sessions are recorded for this account.';
    } else if (s.total === 1) {
      sub.textContent = 'One active session — this device.';
    } else {
      sub.textContent = s.total + ' active sessions' +
        (s.currentSessionListed ? ', including this device' : '') + '.' +
        (hiddenCount > 0 ? ' Showing the ' + s.returned + ' most recently active.' : '');
    }

    others.hidden = otherCount === 0;

    if (!s.rows.length) {
      box.innerHTML = '<p class="sec-empty">No active sessions are recorded.</p>';
      return;
    }
    box.innerHTML = s.rows.map(sessionRowHTML).join('');
  }

  function renderActivity(data) {
    var box = el('sec-activity');
    var sub = el('sec-activity-sub');
    var a = data.activity;

    sub.textContent = a.total === 0
      ? 'Nothing recorded in the last ' + a.days + ' days.'
      : a.total + (a.total === 1 ? ' entry' : ' entries') + ' in the last ' + a.days + ' days.';

    if (!a.rows.length) {
      box.innerHTML = '<p class="sec-empty">No account activity has been recorded in this period.</p>';
      return;
    }
    box.innerHTML = a.rows.map(function (r) {
      var via = r.provider ? ' &middot; ' + esc(r.provider) : '';
      return '<div class="sec-row">' +
        '<div class="sec-cell">' +
          '<span class="sec-title">' + esc(r.label) + '</span>' +
          '<span class="sec-meta">' + esc(absTime(r.at)) + via + '</span>' +
        '</div>' +
        '<div class="sec-actions"><span class="sec-ua">' + esc(relTime(r.at)) + '</span></div>' +
      '</div>';
    }).join('');
  }

  // ---- load ---------------------------------------------------------------------------------
  function loadingState() {
    el('sec-sessions').innerHTML = '<p class="sec-empty">Loading your sessions…</p>';
    el('sec-activity').innerHTML = '<p class="sec-empty">Loading recent activity…</p>';
  }

  function load() {
    if (typeof MarketswaveData === 'undefined') {
      showError('sessions', 'Could not reach the server.');
      showError('activity', 'Could not reach the server.');
      return Promise.resolve();
    }
    clearError('sessions');
    clearError('activity');
    loadingState();
    return MarketswaveData.callFunction('get-account-security', {}).then(function (data) {
      state.data = data;
      renderAccount(data);
      renderSessions(data);
      renderActivity(data);
    }).catch(function (err) {
      var message = MarketswaveData.writeErrorMessage(err);
      // One read feeds both panels, so one failure fails both — and both say so, rather than
      // one of them quietly rendering as empty.
      showError('sessions', message);
      showError('activity', message);
      el('sec-sessions').innerHTML = '';
      el('sec-activity').innerHTML = '';
      el('sec-sessions-sub').textContent = 'Could not be loaded.';
      el('sec-activity-sub').textContent = 'Could not be loaded.';
      el('sec-revoke-others').hidden = true;
    });
  }

  // ---- actions ------------------------------------------------------------------------------
  document.addEventListener('click', function (e) {
    var retry = e.target.closest && e.target.closest('[data-sec-retry]');
    if (retry) { load(); return; }

    var revoke = e.target.closest && e.target.closest('[data-sec-revoke]');
    if (revoke) {
      var sessionId = revoke.getAttribute('data-sec-revoke');
      MarketswaveData.withButtonBusy(revoke, 'Signing out…', function () {
        return MarketswaveData.callFunction('revoke-pm-session', { sessionId: sessionId });
      }).then(function () {
        toast('That session has been signed out.');
        return load();
      }).catch(function (err) {
        toast(MarketswaveData.writeErrorMessage(err));
      });
      return;
    }

    if (e.target.closest && e.target.closest('#sec-revoke-others')) {
      var btn = el('sec-revoke-others');
      MarketswaveData.withButtonBusy(btn, 'Signing out…', function () {
        return MarketswaveData.callFunction('revoke-pm-session', { scope: 'others' });
      }).then(function (res) {
        var n = (res && res.revoked) || 0;
        toast(n === 0 ? 'There were no other sessions to end.'
          : n + (n === 1 ? ' other session has' : ' other sessions have') + ' been signed out.');
        return load();
      }).catch(function (err) {
        toast(MarketswaveData.writeErrorMessage(err));
      });
    }
  });

  // ---- the client security-actions log (pre-existing; kept, not orphaned) --------------------
  // Backend Migration Phase C — Stage 3 added PM_PASSWORD_CHANGE here, a PM changing their OWN
  // password, via appendSelfSecurityLogEntry() — a deliberately separate engine function from
  // appendSecurityLogEntry() because a self-action has no clientId at all (the actor and the
  // subject are the same person), and a nullable clientId would render a bare null in the
  // Client column. Those rows show "(Own account)" instead.
  //
  // Admin UI Wiring — Final Stage confirmed, by a project-wide grep of every migration and
  // every supabase/functions directory, that NO real Supabase table or function exists for
  // this log. It is genuinely local, and wiring something fake would be worse than saying so.
  var TYPE_STYLES = {
    PASSWORD_RESET: { label: 'Password reset', cls: 'bg-amber-50 text-amber-800' },
    '2FA_RESET': { label: '2FA reset', cls: 'bg-purple-50 text-purple-800' },
    PM_PASSWORD_CHANGE: { label: 'PM password change', cls: 'bg-slate-100 text-slate-700' }
  };

  function renderLog() {
    if (typeof getSecurityActionsLog !== 'function') return;
    var log = getSecurityActionsLog().sort(function (a, b) {
      return new Date(b.performedAt) - new Date(a.performedAt) || (b.id > a.id ? 1 : -1);
    });
    el('log-count').textContent = log.length ? '(' + log.length + ')' : '';
    var listEl = el('log-list');

    if (log.length === 0) {
      listEl.innerHTML = '<p class="sec-empty px-6 py-8">No client security actions have been taken yet.</p>';
      return;
    }

    // ★ `mw-card-table` (row 172): five columns do not fit a phone, and without it the last
    // two — who performed the action and when — sit hundreds of pixels off-screen inside a
    // scroll container most people never scroll. Below `lg` each row becomes a self-labelling
    // card; responsive-tables.js derives every label from this table's own <th> text, so a
    // column added here needs no second edit.
    listEl.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-sm mw-card-table"><thead class="bg-slate-50 text-slate-600"><tr>' +
      '<th class="text-left font-semibold px-6 py-3">Client</th>' +
      '<th class="text-left font-semibold px-6 py-3">Action</th>' +
      '<th class="text-left font-semibold px-6 py-3">Reason</th>' +
      '<th class="text-left font-semibold px-6 py-3">Performed by</th>' +
      '<th class="text-left font-semibold px-6 py-3">When</th>' +
      '</tr></thead><tbody class="divide-y divide-slate-100">' +
      log.map(function (entry) {
        var typeInfo = TYPE_STYLES[entry.type] || { label: entry.type, cls: 'bg-slate-100 text-slate-700' };
        var clientCell = entry.clientId
          ? (esc(entry.clientName) + ' <span class="text-slate-500 font-normal">(' + esc(entry.clientId) + ')</span>')
          : '<span class="text-slate-600 italic">(Own account)</span>';
        return '<tr class="hover:bg-slate-50/50">' +
          '<td class="px-6 py-4 text-slate-900 font-medium">' + clientCell + '</td>' +
          '<td class="px-6 py-4"><span class="text-xs font-semibold px-2.5 py-1 rounded-full ' + typeInfo.cls + '">' + esc(typeInfo.label) + '</span></td>' +
          '<td class="px-6 py-4 text-slate-700 max-w-md">' + esc(entry.reason || '—') + '</td>' +
          '<td class="px-6 py-4 text-slate-600">' + esc(entry.performedBy) + '</td>' +
          '<td class="px-6 py-4 text-slate-600">' + esc(entry.performedAt) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---- password change ----------------------------------------------------------------------
  var LEVELS = [
    { width: '0%', color: '#E5E2DC', text: 'Enter a password', label: '#475569' },
    { width: '25%', color: '#B91C1C', text: 'Weak', label: '#B91C1C' },
    { width: '50%', color: '#B45309', text: 'Fair', label: '#B45309' },
    { width: '75%', color: '#047857', text: 'Good', label: '#047857' },
    { width: '100%', color: '#065F46', text: 'Strong', label: '#065F46' }
  ];

  function applyLevel(level) {
    var fill = el('strength-fill');
    var text = el('strength-text');
    fill.style.width = level.width;
    fill.style.background = level.color;
    text.textContent = level.text;
    // ★ The strength LABEL is body text on a light card and is measured as such — the old
    // palette used the same value for the bar and the words, and #F59E0B / #10B981 as text
    // measure well under 4.5:1. The bar keeps a saturated fill; the words get a legible one.
    text.style.color = level.label;
  }

  function wirePassword() {
    var passwordInput = el('new-password');
    if (!passwordInput) return;

    passwordInput.addEventListener('input', function () {
      var val = passwordInput.value;
      var score = 0;
      if (val.length >= 8) score++;
      if (val.length >= 12) score++;
      if (/[A-Z]/.test(val)) score++;
      if (/[0-9]/.test(val)) score++;
      if (/[^A-Za-z0-9]/.test(val)) score++;
      applyLevel(val.length === 0 ? LEVELS[0] : LEVELS[Math.min(score, 4)]);
    });

    el('password-submit').addEventListener('click', function () {
      var current = el('current-password').value;
      var next = passwordInput.value;
      var confirmVal = el('confirm-password').value;
      var errorEl = el('password-error');
      var btn = el('password-submit');

      function fail(message) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
      }

      if (!current) return fail('Enter your current password.');
      if (!next || next.length < 8) return fail('Your new password must be at least 8 characters.');
      if (next !== confirmVal) return fail('The two new passwords do not match.');
      if (typeof MarketswaveData === 'undefined') return fail('Password change is unavailable right now.');
      errorEl.classList.add('hidden');

      var realEmail = null;
      MarketswaveData.withButtonBusy(btn, 'Updating…', function () {
        return MarketswaveData.getSupabaseClient().then(function (client) {
          return client.auth.getSession().then(function (sessionResult) {
            var email = sessionResult.data.session && sessionResult.data.session.user && sessionResult.data.session.user.email;
            if (!email) throw new Error('Your session may have expired. Refresh the page and try again.');
            realEmail = email;
            // ★ THE RE-VERIFICATION IS REAL, and it is also what makes the current session
            // change: signInWithPassword() on this same client issues a NEW session, and the
            // updateUser() below then ends every other one — including the session this page
            // loaded with. That is why the reload afterwards is not cosmetic: without it, the
            // "This device" badge would be pinned to a session that no longer exists.
            return client.auth.signInWithPassword({ email: email, password: current }).then(function (signInResult) {
              if (signInResult.error) throw new Error('Your current password is incorrect.');
              return client.auth.updateUser({ password: next });
            });
          });
        }).then(function (updateResult) {
          if (updateResult.error) throw new Error(updateResult.error.message);
        });
      }).then(function () {
        el('current-password').value = '';
        passwordInput.value = '';
        el('confirm-password').value = '';
        applyLevel(LEVELS[0]);
        if (typeof appendSelfSecurityLogEntry === 'function') {
          appendSelfSecurityLogEntry('PM_PASSWORD_CHANGE', 'Self-service password change.', realEmail);
          renderLog();
        }
        toast('Password updated. Every other session has been signed out.');
        // Show the consequence rather than only claiming it: the sessions panel reloads, and
        // the other devices are gone from it.
        return load();
      }).catch(function (err) {
        fail((err && err.message) || 'Something went wrong. Try again.');
      });
    });
  }

  // ---- go -----------------------------------------------------------------------------------
  renderLog();
  wirePassword();
  renderAccountFromSession();
  load();

  // The verification drives a reload and a log re-render without synthesising a click on a
  // control the page does not have. Both are the page's own functions, not test-only paths.
  window.__secReload = load;
  window.__secRenderLog = renderLog;
})();
