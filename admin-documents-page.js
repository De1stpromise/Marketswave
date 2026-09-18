/* ★ PM tool revamp, part 9 (2026-09-18) — the Documents page.
 *
 * ONE table over every document a client has sent or been sent — regular uploads, documents
 * published from Marketswave, AND identity documents — a health strip that is also a filter
 * set (PM_TOOL_VOCABULARY.md §14), and a detail panel shaped by the object.
 *
 * ★ PRESENTATION ONLY. No new schema, no new Edge Function. Reads the real `documents`,
 * `identity_documents` and (lazily, per identity document) `identity_document_access_log`
 * tables; writes via the already-deployed publish-document / update-document Edge Functions,
 * getSignedDownloadUrl, and — for an identity document — the shared identity-document-access.js
 * component (Task B, row 246), which owns the ONE logged `open-identity-document` path.
 *
 * ★ WHAT IS DELIBERATELY NOT BUILT (register row D, the absent-source pattern). The mockup
 * drew a "signature evidence" panel — typed name, timestamp, IP, device, document hash, a
 * generated signed copy — and a client signing flow. NONE of that is recorded anywhere: the
 * `documents` table has a `status` and a `created_at` and no signing timestamp, no evidence
 * column. Rendering that panel would show fabricated data as if real. Where a document is
 * "Signed" or awaiting a signature, this page shows only what is actually on record — the
 * status — and says plainly that no signature evidence is captured. Real signing is its own
 * task, with its own data layer, and comes next.
 *
 * ★ EVERY READ THAT FEEDS A DISPLAY CHECKS ITS ERROR (register row 233). loadPageData throws
 * on any failed read rather than rendering an empty table that a PM would read as "no
 * documents" — renderAsyncBundle then paints a real error card with a retry.
 */
(function () {
  if (typeof MarketswaveData === 'undefined') return;
  MarketswaveData.useAdminClient();
  var D = MarketswaveData;

  var state = {
    docs: [],            // unified rows (regular documents + identity documents)
    clientsById: {},
    filter: 'all',       // all | needs-review | awaiting-signature | signed | Contracts | Statements | General | Identity
    search: '',
    sort: 'date',        // date | name | client
    dir: -1,
    page: 1
  };
  var PAGE = 30;

  /* ---- formatting ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dayStr(iso) {
    if (!iso) return '—';
    var d = new Date(String(iso).length === 10 ? iso + 'T00:00:00Z' : iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function dateTimeStr(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  }
  function daysAgo(iso) {
    if (!iso) return null;
    var d = new Date(String(iso).length === 10 ? iso + 'T00:00:00Z' : iso);
    if (isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }

  function toast(title, body, bad) {
    var el = document.getElementById('admin-toast');
    if (!el) return;
    document.getElementById('admin-toast-title').textContent = title;
    document.getElementById('admin-toast-body').textContent = body || '';
    el.classList.toggle('bg-red-700', !!bad);
    el.classList.toggle('bg-slate-900', !bad);
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 4200);
  }

  /* ---- icons ------------------------------------------------------------------------ */
  var ICON = {
    con: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6D28D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    sta: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M18.7 8 12 14.7l-3.5-3.5L3 16.4"/></svg>',
    gen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    kyc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#92400E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    up: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7"/></svg>'
  };
  function iconFor(row) {
    if (row.source === 'identity') return { box: 'i-kyc', svg: ICON.kyc };
    if (row.category === 'Contracts' || row.category === 'Signature Required') return { box: 'i-con', svg: ICON.con };
    if (row.category === 'Statements & Reports') return { box: 'i-sta', svg: ICON.sta };
    return { box: 'i-gen', svg: ICON.gen };
  }

  /* ---- status ------------------------------------------------------------------------
   * The raw `documents.status` (null|Received|Under Review|Reviewed|Signature Required|Signed)
   * plus, for a `from` document with no status yet, an honest "Delivered". An identity
   * document has no review lifecycle at all — no status column — so it is "On file", not a
   * fabricated "Needs review". */
  function statusInfo(row) {
    if (row.source === 'identity') return { label: 'On file', cls: 'st-onfile' };
    var s = row.status;
    if (s === 'Signed') return { label: 'Signed', cls: 'st-signed' };
    if (s === 'Signature Required') return { label: 'Awaiting signature', cls: 'st-sig' };
    if (s === 'Reviewed') return { label: 'Reviewed', cls: 'st-reviewed' };
    if (s === 'Under Review') return { label: 'Under review', cls: 'st-review' };
    if (s === 'Received') return { label: 'Received', cls: 'st-received' };
    // null status: a delivered "from Marketswave" document, or a bare upload.
    return row.direction === 'from' ? { label: 'Delivered', cls: 'st-delivered' } : { label: 'Received', cls: 'st-received' };
  }
  // "Direction" reads from the client's point of view, matching the mockup: a published
  // document goes TO the client; an upload and an identity document come FROM the client.
  function directionInfo(row) {
    if (row.direction === 'from') return { label: 'To client', icon: ICON.down };
    return { label: 'From client', icon: ICON.up };
  }
  function categoryLabel(row) {
    if (row.source === 'identity') return 'Identity';
    return row.category || 'General';
  }

  /* ---- filtering --------------------------------------------------------------------- */
  function matchesFilter(row, f) {
    if (f === 'all') return true;
    if (f === 'needs-review') return row.source === 'doc' && row.direction === 'upload' && row.status !== 'Reviewed';
    if (f === 'awaiting-signature') return row.source === 'doc' && row.status === 'Signature Required';
    if (f === 'signed') return row.source === 'doc' && row.status === 'Signed';
    if (f === 'Identity') return row.source === 'identity';
    if (f === 'Contracts') return row.category === 'Contracts';
    if (f === 'Statements') return row.category === 'Statements & Reports';
    if (f === 'General') return row.category === 'General';
    return true;
  }
  function matchesSearch(row, q) {
    if (!q) return true;
    var s = q.trim().toLowerCase();
    return String(row.filename).toLowerCase().indexOf(s) !== -1 ||
      String(row.clientName).toLowerCase().indexOf(s) !== -1;
  }
  function visible() {
    var rows = state.docs.filter(function (r) { return matchesFilter(r, state.filter) && matchesSearch(r, state.search); });
    var k = state.sort, d = state.dir;
    rows.sort(function (a, b) {
      if (k === 'name') return d * String(a.filename).localeCompare(String(b.filename));
      if (k === 'client') return d * String(a.clientName).localeCompare(String(b.clientName));
      // date — the row's own timestamp (created_at for documents, uploaded_at for identity).
      var av = a.date || '', bv = b.date || '';
      return av === bv ? 0 : d * (av < bv ? -1 : 1);
    });
    return rows;
  }

  /* ---- health strip — each card is a filter ------------------------------------------ */
  function counts() {
    var c = { review: 0, signature: 0, signed: 0, total: state.docs.length, oldestSig: null };
    state.docs.forEach(function (r) {
      if (r.source === 'doc' && r.direction === 'upload' && r.status !== 'Reviewed') c.review++;
      if (r.source === 'doc' && r.status === 'Signature Required') {
        c.signature++;
        var ago = daysAgo(r.date);
        if (ago != null && (c.oldestSig == null || ago > c.oldestSig)) c.oldestSig = ago;
      }
      if (r.source === 'doc' && r.status === 'Signed') c.signed++;
    });
    return c;
  }
  function healthCard(key, label, value, sub, warn) {
    var on = state.filter === key;
    return '<button type="button" class="doc-hc' + (warn ? ' is-warn' : '') + '" data-filter="' + key + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="k">' + esc(label) + '</span>' +
      '<span class="v">' + value + '</span>' +
      '<span class="x">' + esc(sub) + '</span>' +
    '</button>';
  }
  function renderHealth() {
    var el = document.getElementById('doc-health');
    if (!el) return;
    var c = counts();
    var clientCount = Object.keys(state.docs.reduce(function (acc, r) { acc[r.clientId] = 1; return acc; }, {})).length;
    var sigSub = c.signature ? (c.oldestSig != null ? 'oldest sent ' + c.oldestSig + (c.oldestSig === 1 ? ' day ago' : ' days ago') : 'awaiting a signature') : 'none awaiting';
    el.innerHTML =
      healthCard('needs-review', 'Awaiting your review', c.review, 'client uploads', c.review > 0) +
      healthCard('awaiting-signature', 'Awaiting signature', c.signature, sigSub, c.signature > 0) +
      healthCard('signed', 'Signed', c.signed, 'status only — no signing evidence recorded', false) +
      healthCard('all', 'Total documents', c.total, 'across ' + clientCount + ' client' + (clientCount === 1 ? '' : 's'), false);
  }

  function renderPills() {
    var el = document.getElementById('doc-pills');
    if (!el) return;
    var defs = [
      ['all', 'All'], ['needs-review', 'Needs review'], ['awaiting-signature', 'Awaiting signature'],
      ['Contracts', 'Contracts'], ['Statements', 'Statements'], ['Identity', 'Identity'], ['General', 'General']
    ];
    el.innerHTML = defs.map(function (d) {
      // The count is what this pill would show given the CURRENT search — a count that
      // ignores the search is a lie the moment a PM types (§14).
      var n = state.docs.filter(function (r) { return matchesFilter(r, d[0]) && matchesSearch(r, state.search); }).length;
      return '<button type="button" class="doc-pill" data-filter="' + esc(d[0]) + '" aria-pressed="' + (state.filter === d[0] ? 'true' : 'false') + '">' +
        esc(d[1]) + ' <span class="n">' + n + '</span></button>';
    }).join('');
  }

  /* ---- table ------------------------------------------------------------------------- */
  function rowHTML(row) {
    var ic = iconFor(row);
    var st = statusInfo(row);
    var dir = directionInfo(row);
    var sub = row.source === 'identity'
      ? 'Identity · ' + esc(row.documentType || 'Document')
      : esc(categoryLabel(row)) + (row.deadlineLabel ? ' · ' + esc(row.deadlineLabel) : '');
    return '<button type="button" class="doc-tr" data-id="' + esc(row.id) + '" data-source="' + esc(row.source) + '">' +
      '<span class="doc-ic ' + ic.box + '">' + ic.svg + '</span>' +
      '<span class="doc-nm"><b>' + esc(row.filename) + '</b><span>' + sub + '</span></span>' +
      '<span class="doc-sub">' +
        '<span class="doc-who"><span class="doc-av">' + esc(initials(row.clientName)) + '</span><b>' + esc(row.clientName) + '</b></span>' +
        '<span class="doc-dir">' + dir.icon + esc(dir.label) + '</span>' +
        '<span class="doc-st-cell"><span class="doc-st ' + st.cls + '">' + esc(st.label) + '</span></span>' +
        '<span class="doc-dt r">' + dayStr(row.date) + '</span>' +
      '</span>' +
      '<span class="doc-chev" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></span>' +
    '</button>';
  }
  function sortBtn(key, label, right) {
    var on = state.sort === key;
    return '<span' + (right ? ' class="r"' : '') + '><button type="button" data-sort="' + key + '"' + (on ? ' class="is-sorted"' : '') + '>' +
      esc(label) + (on ? (state.dir === 1 ? ' ▴' : ' ▾') : '') + '</button></span>';
  }
  function renderTable() {
    var el = document.getElementById('doc-table');
    if (!el) return;
    var rows = visible();
    var shown = rows.slice(0, state.page * PAGE);
    var head = '<div class="doc-th"><span></span>' + sortBtn('name', 'Document') +
      sortBtn('client', 'Client') + '<span>Direction</span><span>Status</span>' + sortBtn('date', 'Date', true) + '<span></span></div>';
    if (!rows.length) {
      el.innerHTML = head + '<p class="doc-empty">No document matches this search and filter.</p>';
      return;
    }
    el.innerHTML = head + shown.map(rowHTML).join('') +
      (shown.length < rows.length
        ? '<div class="doc-more"><button type="button" id="doc-more" class="mw-btn mw-btn-sm">Continue browsing</button><span class="cnt">Showing ' + shown.length + ' of ' + rows.length + '</span></div>'
        : '<div class="doc-more"><span class="cnt">Showing all ' + rows.length + '</span></div>');
  }
  function renderSub() {
    var el = document.getElementById('doc-sub');
    if (!el) return;
    var c = counts();
    var idc = state.docs.filter(function (r) { return r.source === 'identity'; }).length;
    var parts = [c.total + ' document' + (c.total === 1 ? '' : 's') + ' across every client'];
    if (c.review) parts.push(c.review + ' awaiting review');
    if (idc) parts.push(idc + ' identity');
    el.textContent = parts.join(' · ');
  }
  function renderAll() { renderSub(); renderHealth(); renderPills(); renderTable(); }

  /* ---- detail overlay ---------------------------------------------------------------- */
  var scrim = document.getElementById('doc-scrim');
  var panel = document.getElementById('doc-panel');
  function openPanel(html) { panel.innerHTML = html; scrim.classList.remove('hidden'); }
  function closePanel() { scrim.classList.add('hidden'); panel.innerHTML = ''; }
  scrim.addEventListener('click', function (e) { if (e.target === scrim) closePanel(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!scrim.classList.contains('hidden')) closePanel();
    else if (!publishScrim.classList.contains('hidden')) closePublish();
  });
  function byId(id, source) { return state.docs.filter(function (r) { return r.id === id && r.source === source; })[0] || null; }

  function panelHead(row) {
    var ic = iconFor(row);
    var meta = row.source === 'identity' ? esc(row.clientName) + ' · Identity document' : esc(row.clientName) + ' · ' + esc(categoryLabel(row));
    return '<div class="doc-ph"><span class="doc-ic ' + ic.box + '">' + ic.svg + '</span>' +
      '<div class="tx"><b id="doc-panel-title">' + esc(row.filename) + '</b><span>' + meta + '</span></div>' +
      '<button type="button" id="doc-close" class="mw-btn mw-btn-sm x" aria-label="Close">&times;</button></div>';
  }

  /* Regular document: STATUS + the honest absence of signature evidence (row D). */
  function regularDetailHTML(row) {
    var st = statusInfo(row);
    var dir = directionInfo(row);
    var body = '<div class="doc-pb">' +
      '<div class="doc-kv"><span class="k">Status</span><span class="v">' + esc(st.label) + '</span></div>' +
      '<div class="doc-kv"><span class="k">Direction</span><span class="v">' + esc(dir.label) + '</span></div>' +
      '<div class="doc-kv"><span class="k">Category</span><span class="v">' + esc(categoryLabel(row)) + '</span></div>' +
      (row.deadlineLabel ? '<div class="doc-kv"><span class="k">Due</span><span class="v">' + esc(row.deadlineLabel) + '</span></div>' : '') +
      '<div class="doc-kv"><span class="k">Date</span><span class="v">' + dayStr(row.date) + '</span></div>';

    // ★ Where the mockup drew a signature-evidence panel, state the truth instead. Nothing is
    // recorded beyond the status, so there is no signing time, name, address, device or hash
    // to show — and inventing one would be register row D. Real signing is a separate task.
    if (row.status === 'Signed') {
      body += '<div class="doc-note is-info"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0369A1" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p><b>No signature evidence is captured.</b> The status was set to Signed, but no typed name, timestamp, address, device or document hash is on record. Verifiable signing — with captured evidence — is a separate, upcoming feature.</p></div>';
    } else if (row.status === 'Signature Required') {
      body += '<div class="doc-note is-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>Awaiting the client\'s signature. Signing today only flips this status — no signature evidence is captured yet; that is a separate, upcoming feature.</p></div>';
    }
    body += '</div>';

    var actions = '<button type="button" class="download-btn mw-btn mw-btn-secondary" data-doc="' + esc(row.id) + '">Download</button>';
    if (row.source === 'doc' && row.direction === 'upload' && row.status !== 'Reviewed') {
      actions += '<button type="button" class="review-btn mw-btn mw-btn-approve" data-client="' + esc(row.clientId) + '" data-doc="' + esc(row.id) + '">Mark reviewed</button>';
    }
    return panelHead(row) + body + '<div class="doc-pf">' + actions + '</div>';
  }

  /* Identity document: the Task B access record (row 246) + the one logged Open control. */
  function identityDetailHTML(row) {
    var KIND = { id: 'Photo ID', address: 'Proof of address' };
    var body = '<div class="doc-pb">' +
      '<p class="doc-sect">Access record</p>' +
      '<div id="doc-access-log"><p class="doc-log-empty">Loading the access record…</p></div>' +
      '<p class="doc-sect">Details</p>' +
      '<div class="doc-kv"><span class="k">Type</span><span class="v">' + esc(row.documentType || KIND[row.kind] || 'Identity document') + '</span></div>' +
      '<div class="doc-kv"><span class="k">Kind</span><span class="v">' + esc(KIND[row.kind] || row.kind || '—') + '</span></div>' +
      '<div class="doc-kv"><span class="k">Uploaded</span><span class="v">' + dayStr(row.date) + '</span></div>' +
      '<div class="doc-note is-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        '<p>Opening this records the account, the time and the reason permanently. The client isn\'t notified, but the record can\'t be removed — and a client is entitled to see it on request.</p></div>' +
    '</div>';
    return panelHead(row) + body +
      '<div class="doc-pf"><button type="button" id="doc-idd-open" class="mw-btn mw-btn-admin">Open</button></div>';
  }

  function renderAccessLog(rows, uploadedIso, clientName) {
    var el = document.getElementById('doc-access-log');
    if (!el) return;
    var html = (rows || []).map(function (r) {
      var opened = r.outcome === 'opened';
      var who = r.pm_email || 'A Portfolio Manager';
      var main = opened ? '<b>' + esc(who) + '</b> opened it' : '<b>' + esc(who) + '</b> was refused';
      var detail = opened
        ? (r.reason ? '<span class="rr" style="color:#475569">' + esc(r.reason) + '</span>' : '')
        : (r.refusal_reason ? '<span class="rr">' + esc(r.refusal_reason) + '</span>' : '');
      return '<div class="doc-log"><span class="lo ' + (opened ? 'lo-opened' : 'lo-refused') + '">' + (opened ? 'Opened' : 'Refused') + '</span>' +
        '<span class="lw">' + main + detail + '</span>' +
        '<span class="lt">' + esc(dateTimeStr(r.requested_at)) + '</span></div>';
    }).join('');
    // The upload itself is a real event the log does not carry — shown as the base of the record.
    html += '<div class="doc-log"><span class="lo" style="background:#F1F5F9;color:#475569">Uploaded</span>' +
      '<span class="lw"><b>' + esc(clientName) + '</b> uploaded it</span>' +
      '<span class="lt">' + esc(dateTimeStr(uploadedIso)) + '</span></div>';
    if (!(rows || []).length) {
      html = '<p class="doc-log-empty">No PM has opened this document yet.</p>' + html;
    }
    el.innerHTML = html;
  }

  function loadAccessLog(row) {
    D.selectTable('identity_document_access_log', function (q) {
      return q.eq('identity_document_id', row.id).order('requested_at', { ascending: false });
    }).then(function (rows) {
      renderAccessLog(rows || [], row.date, row.clientName);
    }).catch(function () {
      var el = document.getElementById('doc-access-log');
      if (el) el.innerHTML = '<p class="doc-log-empty">Could not load the access record.</p>';
    });
  }

  function openDetail(id, source) {
    var row = byId(id, source);
    if (!row) return;
    if (source === 'identity') {
      openPanel(identityDetailHTML(row));
      loadAccessLog(row);
    } else {
      openPanel(regularDetailHTML(row));
    }
  }

  /* ---- publish overlay (static form) ------------------------------------------------- */
  var publishScrim = document.getElementById('doc-publish-scrim');
  function openPublish() { publishScrim.classList.remove('hidden'); setTimeout(function () { var s = document.getElementById('publish-client'); if (s) s.focus(); }, 30); }
  function closePublish() { publishScrim.classList.add('hidden'); }
  publishScrim.addEventListener('click', function (e) { if (e.target === publishScrim) closePublish(); });
  document.getElementById('doc-publish-open').addEventListener('click', openPublish);
  document.getElementById('doc-publish-close').addEventListener('click', closePublish);
  document.getElementById('doc-publish-cancel').addEventListener('click', closePublish);

  function populateClientSelect(clients) {
    document.getElementById('publish-client').innerHTML = clients.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + ' (' + esc(c.id) + ')</option>';
    }).join('');
  }

  // Chunked base64 (not a spread of a large typed array, which can overflow the call stack) —
  // publish-document's body stays plain JSON, matching every other Edge Function here.
  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var chunkSize = 0x8000, chunks = [];
    for (var i = 0; i < bytes.length; i += chunkSize) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
    }
    return btoa(chunks.join(''));
  }

  document.getElementById('publish-submit').addEventListener('click', function () {
    var errorEl = document.getElementById('publish-error');
    errorEl.classList.add('hidden');
    var clientId = document.getElementById('publish-client').value;
    var category = document.getElementById('publish-category').value;
    var fileInput = document.getElementById('publish-file');
    var file = fileInput.files && fileInput.files[0];
    var dueDate = document.getElementById('publish-due-date').value || null;
    var signatureRequired = document.getElementById('publish-signature-required').checked;
    var sel = document.getElementById('publish-client');
    var clientLabel = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : clientId;

    if (!file) { errorEl.textContent = 'Choose a file to publish.'; errorEl.classList.remove('hidden'); return; }

    var btn = document.getElementById('publish-submit');
    D.withButtonBusy(btn, 'Publishing…', function () {
      return file.arrayBuffer().then(function (buffer) {
        return D.callFunction('publish-document', {
          clientId: clientId, filename: file.name, category: category,
          signatureRequired: signatureRequired, dueDate: dueDate,
          fileBase64: arrayBufferToBase64(buffer), fileType: file.type || 'application/octet-stream'
        });
      });
    }).then(function (result) {
      toast('Document Published', result.filename + ' delivered to ' + clientLabel + '.');
      fileInput.value = '';
      document.getElementById('publish-due-date').value = '';
      document.getElementById('publish-signature-required').checked = false;
      if (window.MarketswaveUpload) MarketswaveUpload.refresh(fileInput.closest('.mw-upload'));
      closePublish();
      reload();
    }).catch(function (err) {
      errorEl.textContent = D.writeErrorMessage(err);
      errorEl.classList.remove('hidden');
    });
  });

  /* ---- detail-panel actions ---------------------------------------------------------- */
  panel.addEventListener('click', function (e) {
    if (e.target.closest('#doc-close')) { closePanel(); return; }

    var reviewBtn = e.target.closest('.review-btn');
    if (reviewBtn) {
      D.withButtonBusy(reviewBtn, 'Reviewing…', function () {
        return D.callFunction('update-document', { clientId: reviewBtn.dataset.client, docId: reviewBtn.dataset.doc, patch: { status: 'Reviewed' } });
      }).then(function (result) {
        toast('Document Reviewed', result.filename + ' marked as reviewed.');
        closePanel();
        reload();
      }).catch(function (err) { toast('Error', D.writeErrorMessage(err), true); });
      return;
    }

    var dlBtn = e.target.closest('.download-btn');
    if (dlBtn) {
      var doc = state.docs.filter(function (r) { return r.id === dlBtn.dataset.doc; })[0];
      if (!doc) return;
      if (!doc.storagePath) { toast('No File Attached', doc.filename + ' has no file on record yet.'); return; }
      D.getSignedDownloadUrl('documents', doc.storagePath, 60).then(function (url) {
        window.open(url, '_blank');
        toast('Download Started', doc.filename + ' is downloading.');
      }).catch(function (err) { toast('Download Failed', D.writeErrorMessage(err), true); });
      return;
    }

    var openBtn = e.target.closest('#doc-idd-open');
    if (openBtn) {
      var idRow = byId(panel.dataset.docId, 'identity');
      if (!idRow) return;
      if (!window.IdentityDocumentAccess) { toast('Error', 'Could not reach the server.', true); return; }
      IdentityDocumentAccess.open(
        { id: idRow.id, kind: idRow.kind, documentType: idRow.documentType, filename: idRow.filename, clientName: idRow.clientName },
        { onToast: function (m) { toast('Opened', m); }, onOpened: function () { loadAccessLog(idRow); } }
      );
      return;
    }
  });

  /* ---- delegated toolbar/table events ------------------------------------------------ */
  document.getElementById('doc-health').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    state.page = 1;
    renderAll();
  });
  document.getElementById('doc-pills').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    state.page = 1;
    renderAll();
  });
  document.getElementById('doc-search').addEventListener('input', function (e) {
    state.search = e.target.value;
    state.page = 1;
    renderPills();
    renderTable();
  });
  document.getElementById('doc-table').addEventListener('click', function (e) {
    var sortEl = e.target.closest('[data-sort]');
    if (sortEl) {
      var k = sortEl.dataset.sort;
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'date' ? -1 : 1; }
      state.page = 1;
      renderTable();
      return;
    }
    if (e.target.closest('#doc-more')) { state.page += 1; renderTable(); return; }
    var row = e.target.closest('[data-id]');
    if (row) { panel.dataset.docId = row.dataset.id; openDetail(row.dataset.id, row.dataset.source); }
  });

  /* ---- load -------------------------------------------------------------------------- */
  var dataPromise = null;
  function loadPageData() {
    if (dataPromise) return dataPromise;
    dataPromise = Promise.all([
      D.selectTable('documents'),
      D.selectTable('identity_documents'),
      D.selectTable('clients')
    ]).then(function (results) {
      var documents = results[0], identity = results[1], clients = results[2];
      state.clientsById = {};
      clients.forEach(function (c) { state.clientsById[c.id] = c.name; });
      populateClientSelect(clients);
      var byName = function (cid) { return state.clientsById[cid] || cid; };
      var docRows = documents.map(function (d) {
        return {
          source: 'doc', id: d.id, clientId: d.client_id, clientName: byName(d.client_id),
          direction: d.direction, filename: d.filename, category: d.category,
          status: d.status, deadlineLabel: d.deadline_label, date: d.created_at, storagePath: d.storage_path
        };
      });
      var idRows = identity.map(function (d) {
        return {
          source: 'identity', id: d.id, clientId: d.client_id, clientName: byName(d.client_id),
          direction: 'upload', filename: d.filename, category: 'Identity', status: null,
          kind: d.kind, documentType: d.document_type, date: d.uploaded_at, storagePath: d.storage_path
        };
      });
      return docRows.concat(idRows);
    }).catch(function (err) { dataPromise = null; throw err; });
    return dataPromise;
  }
  function reload() { dataPromise = null; render(); }
  function render() {
    D.renderAsyncBundle(document.getElementById('doc-table'), {
      skeletonHTML: '<div class="p-4 space-y-3">' +
        (D.skeleton ? D.skeleton.lines(['w-full', 'w-full', 'w-5/6', 'w-full', 'w-3/4']) :
          '<div class="animate-pulse h-8 bg-slate-100 rounded"></div>') + '</div>',
      load: loadPageData,
      render: function (data) { state.docs = data; renderAll(); }
    });
  }

  render();
})();
