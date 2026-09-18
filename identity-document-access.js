/* ★ Task B — access logging for identity documents (2026-09-18, register row 246).
 *
 * The ONE way a PM opens an identity document from the PM tool, shared by the client profile
 * and the approval gate so there is a single modal, a single call and a single set of rules:
 *
 *   IdentityDocumentAccess.open({ id, kind, documentType, filename, clientName }, { onToast })
 *
 * opens a reason-required modal (free text, minimum 10 characters, counted live and enforced
 * again server-side), calls the admin-only `open-identity-document` Edge Function — which
 * writes the append-only access-log row and only then returns a 60-second signed URL — and
 * opens that URL in a new tab. A refused request is logged too, and the server's own message
 * is shown verbatim (writeErrorMessage()).
 *
 * Mirrors this project's "shared component injects its own markup" precedent
 * (dashboard-notifications.js): the modal is appended to <body> on first use, styled in the
 * same Tailwind classes admin-client-profile.html's own reset modal uses, so it looks the same
 * on every page that loads it. Plain globals on window, one <script> tag, like format-helpers.
 *
 * The tab is opened with window.open() from the click's own task; a popup blocker that
 * refuses it is reported in the modal with the URL's remaining lifetime rather than silently
 * losing the (already logged) open.
 */
(function () {
  'use strict';

  var REASON_MIN = 10;
  var state = { doc: null, opts: null, busy: false };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(id) { return document.getElementById(id); }

  function ensureModal() {
    if (el('ida-modal')) return;
    var wrap = document.createElement('div');
    wrap.id = 'ida-modal';
    wrap.className = 'hidden fixed inset-0 z-50 flex items-center justify-center p-4';
    wrap.innerHTML =
      '<div class="absolute inset-0 bg-black/60" id="ida-backdrop"></div>' +
      '<div class="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="ida-title">' +
        '<div class="flex items-start justify-between mb-2">' +
          '<p class="text-lg font-semibold text-slate-900" id="ida-title">Open identity document</p>' +
          '<button type="button" id="ida-close" class="mw-btn mw-btn-sm" aria-label="Close">&times;</button>' +
        '</div>' +
        '<p class="text-sm text-slate-600 mb-3" id="ida-desc"></p>' +
        '<div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" id="ida-warn">' +
          '<b>This open is recorded permanently</b> — who asked, when, which document, and the reason below. ' +
          'The record cannot be edited or removed by anyone, and a client is entitled to see it on request. ' +
          'A refused attempt is recorded too.' +
        '</div>' +
        '<label for="ida-reason" class="block text-xs font-semibold text-slate-600 mb-1">Reason (required, at least ' + REASON_MIN + ' characters)</label>' +
        '<textarea id="ida-reason" rows="3" class="mw-field mw-field-admin w-full" placeholder="Why are you opening this document? e.g. Verifying the passport against the application before approval."></textarea>' +
        '<p class="text-xs text-slate-600 mt-1" id="ida-count" aria-live="polite">0 / ' + REASON_MIN + ' characters</p>' +
        '<p id="ida-error" class="hidden text-xs text-red-700 mt-2" role="alert"></p>' +
        '<div class="flex gap-2 mt-4">' +
          '<button type="button" id="ida-submit" class="mw-btn mw-btn-sm mw-btn-admin" disabled>Open and record</button>' +
          '<button type="button" id="ida-cancel" class="mw-btn mw-btn-sm">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    el('ida-close').addEventListener('click', close);
    el('ida-cancel').addEventListener('click', close);
    el('ida-backdrop').addEventListener('click', close);
    el('ida-reason').addEventListener('input', updateCount);
    el('ida-submit').addEventListener('click', submit);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !el('ida-modal').classList.contains('hidden')) close(); });
  }

  function trimmed() { return String(el('ida-reason').value || '').replace(/\s+/g, ' ').trim(); }

  function updateCount() {
    var n = trimmed().length;
    el('ida-count').textContent = n + ' / ' + REASON_MIN + ' characters' + (n >= REASON_MIN ? '' : ' — keep going');
    el('ida-submit').disabled = n < REASON_MIN || state.busy;
  }

  var KIND = { id: 'Photo ID', address: 'Proof of address' };

  function open(doc, opts) {
    ensureModal();
    state.doc = doc; state.opts = opts || {}; state.busy = false;
    el('ida-desc').innerHTML = '<b>' + esc(doc.documentType || KIND[doc.kind] || 'Identity document') + '</b> · ' + esc(doc.filename || '') +
      (doc.clientName ? ' · ' + esc(doc.clientName) : '') + '. The link you get is valid for 60 seconds and opens in a new tab.';
    el('ida-reason').value = '';
    el('ida-error').classList.add('hidden');
    el('ida-error').textContent = '';
    el('ida-submit').textContent = 'Open and record';
    updateCount();
    el('ida-modal').classList.remove('hidden');
    setTimeout(function () { el('ida-reason').focus(); }, 30);
  }

  function close() {
    if (!el('ida-modal')) return;
    el('ida-modal').classList.add('hidden');
    state.doc = null;
  }

  function showError(msg) {
    var e = el('ida-error');
    e.textContent = msg;
    e.classList.remove('hidden');
  }

  function submit() {
    var doc = state.doc;
    if (!doc) return;
    var reason = trimmed();
    if (reason.length < REASON_MIN) { showError('Give a reason of at least ' + REASON_MIN + ' characters.'); return; }
    if (typeof MarketswaveData === 'undefined') { showError('Could not reach the server.'); return; }
    state.busy = true;
    el('ida-error').classList.add('hidden');
    var btn = el('ida-submit');
    MarketswaveData.withButtonBusy(btn, 'Recording…', function () {
      return MarketswaveData.getSupabaseClient().then(function (client) {
        return MarketswaveData.callFunction('open-identity-document', { documentId: doc.id, reason: reason }).then(function (res) {
          // The function's own URL carries the stack-internal origin locally; rebuild it against
          // the project URL this page is configured with (row 200's finding, same fix).
          res.href = (res.signedPath && client && client.supabaseUrl) ? String(client.supabaseUrl).replace(/\/$/, '') + res.signedPath : res.url;
          return res;
        });
      });
    }).then(function (res) {
      state.busy = false;
      // Opened from the click's own task chain; a blocked popup is reported, never lost.
      var tab = null;
      try { tab = window.open(res.href, '_blank', 'noopener'); } catch (_e) { tab = null; }
      var toast = state.opts.onToast || function () {};
      if (tab) {
        close();
        toast('Opened ' + (doc.documentType || 'the document') + ' — this access is recorded.');
      } else {
        showError('The access was recorded, but the browser blocked the new tab. Allow pop-ups for this site and open it again (a fresh open records a fresh row).');
      }
      if (state.opts.onOpened) state.opts.onOpened(res);
    }).catch(function (err) {
      state.busy = false;
      showError(MarketswaveData.writeErrorMessage(err));
      updateCount();
      if (state.opts.onRefused) state.opts.onRefused(err);
    });
  }

  window.IdentityDocumentAccess = { open: open, close: close, REASON_MIN: REASON_MIN };
})();
