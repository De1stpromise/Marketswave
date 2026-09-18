/* ★ Task C — real signing (2026-09-18, register row 249).
 *
 * The client-facing signing flow, one shared component:
 *
 *   DocumentSigning.open({ id, filename, storagePath, deadlineLabel }, { onSigned, onToast })
 *
 * renders the document IN-PAGE (never a download), page by page, inside a scrollable viewer;
 * shows a typed-name field, the consent statement and a plain statement of what signing
 * captures; and calls the self-only `sign-document` Edge Function, which reads and hashes the
 * stored bytes ITSELF, writes the append-only evidence row and only then marks the document
 * Signed.
 *
 * ★ THE SIGN CONTROL IS NOT REACHABLE BEFORE THE DOCUMENT HAS RENDERED. A signature on
 * something the signer could not see is the thing this feature exists to prevent, so the
 * gate is not a disabled attribute alone (an attribute can be removed from devtools): the
 * button is disabled until every page's render promise has resolved AND submit() itself
 * re-checks state.rendered and refuses otherwise. If pdf.js cannot load or the file cannot
 * render, the status line says so, the control stays disabled, and the only way forward is
 * the Download control — the client is never invited to sign what they could not read.
 *
 * pdf.js 6.3.289 from cdnjs, pinned, imported dynamically HERE at open time — never at page
 * load (~506 KB gzipped, main + worker, paid only when a client actually opens a document
 * to sign). The worker is loaded cross-origin through pdf.js's own blob wrapper: proven on the
 * real marketswave.net origin to construct a genuine module Worker (row 249), not a
 * main-thread fallback that would freeze the page on a long agreement.
 *
 * The bytes are fetched here, hashed here (Web Crypto) and SHOWN as a fingerprint under the
 * viewer — and that client-side hash is sent along as `clientReportedSha256`, recorded for
 * dispute, NEVER used by the server as the fingerprint of what was signed. The server hashes
 * the bytes it reads itself. The two texts below are byte-identical to
 * supabase/functions/_shared/signing.ts between the same markers; the signing suite asserts
 * that, and the server refuses a consentText that is not its own.
 *
 * Mirrors identity-document-access.js: injects its own markup on first use, plain globals on
 * window, one <script> tag, every control a real .mw-btn / .mw-field.
 */
(function () {
  'use strict';

  /* SIGNING-TEXT-START */
  var CONSENT_TEXT = 'I have read this document in full, I agree to be bound by it, and I accept that typing my name constitutes my signature.';
  var CAPTURE_TEXT = 'Signing records the date and time, your name as typed, your device and network address, and a fingerprint of this exact document. You\'ll receive a signed copy by email.';
  /* SIGNING-TEXT-END */

  var PDFJS_VERSION = '6.3.289';
  var PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/';
  var TYPED_NAME_MIN = 2;

  var state = { doc: null, opts: null, rendered: false, busy: false, pages: 0, sha256: null, token: 0 };
  var pdfjsPromise = null;

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(id) { return document.getElementById(id); }

  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(PDFJS_BASE + 'pdf.min.mjs').then(function (m) {
        m.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
        return m;
      }).catch(function (err) { pdfjsPromise = null; throw err; });
    }
    return pdfjsPromise;
  }

  function ensureModal() {
    if (el('dsg-modal')) return;
    var wrap = document.createElement('div');
    wrap.id = 'dsg-modal';
    wrap.className = 'dsg-modal';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="dsg-backdrop" id="dsg-backdrop"></div>' +
      '<div class="dsg-panel" role="dialog" aria-modal="true" aria-labelledby="dsg-title" aria-describedby="dsg-sub">' +
        '<div class="dsg-head">' +
          '<span class="dsg-head-ic" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>' +
          '<div class="dsg-head-tx"><b id="dsg-title"></b><span id="dsg-sub"></span></div>' +
          '<button type="button" id="dsg-download" class="mw-btn mw-btn-sm mw-btn-secondary">Download</button>' +
          '<button type="button" id="dsg-close" class="mw-btn mw-btn-sm mw-btn-secondary" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="dsg-body">' +
          '<div class="dsg-viewer" id="dsg-viewer" aria-live="off"></div>' +
          '<div class="dsg-status" id="dsg-status" data-state="loading" role="status" aria-live="polite"><span class="dsg-spin" aria-hidden="true"></span><span id="dsg-status-text">Loading the document…</span></div>' +
          '<div class="dsg-sign">' +
            '<p class="dsg-fp" id="dsg-fp" hidden></p>' +
            '<label class="dsg-name-lbl" for="dsg-name">Type your full legal name to sign</label>' +
            '<input id="dsg-name" class="mw-field dsg-name" type="text" autocomplete="name" maxlength="120" placeholder="Your full legal name" />' +
            '<label class="dsg-consent" for="dsg-consent"><input type="checkbox" id="dsg-consent" /><span>' + esc(CONSENT_TEXT) + '</span></label>' +
            '<div class="dsg-capture"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg><p id="dsg-capture">' + esc(CAPTURE_TEXT) + '</p></div>' +
            '<p class="dsg-error" id="dsg-error" role="alert" hidden></p>' +
          '</div>' +
        '</div>' +
        '<div class="dsg-foot">' +
          '<button type="button" id="dsg-cancel" class="mw-btn mw-btn-secondary dsg-secondary">Not now</button>' +
          '<button type="button" id="dsg-submit" class="mw-btn mw-btn-primary dsg-primary" disabled aria-disabled="true">Sign document</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    el('dsg-close').addEventListener('click', close);
    el('dsg-cancel').addEventListener('click', close);
    el('dsg-backdrop').addEventListener('click', close);
    el('dsg-submit').addEventListener('click', submit);
    el('dsg-name').addEventListener('input', updateGate);
    el('dsg-consent').addEventListener('change', updateGate);
    el('dsg-download').addEventListener('click', function () {
      if (!state.doc || !state.doc.storagePath) return;
      MarketswaveData.getSignedDownloadUrl('documents', state.doc.storagePath, 60).then(function (url) { window.open(url, '_blank'); })
        .catch(function (err) { showError(MarketswaveData.writeErrorMessage(err)); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el('dsg-modal') && !el('dsg-modal').hidden) close(); });
  }

  function setStatus(stateName, text) {
    var s = el('dsg-status');
    s.setAttribute('data-state', stateName);
    var spin = s.querySelector('.dsg-spin');
    if (spin) spin.hidden = stateName !== 'loading';
    el('dsg-status-text').textContent = text;
  }

  function showError(msg) { var e = el('dsg-error'); e.textContent = msg; e.hidden = false; }
  function clearError() { var e = el('dsg-error'); e.textContent = ''; e.hidden = true; }

  function typedName() { return String(el('dsg-name').value || '').replace(/\s+/g, ' ').trim(); }

  // The gate: rendered AND named AND consented. Re-evaluated on every input; also enforced
  // again inside submit(), so a button forced enabled from devtools still cannot sign.
  function canSign() {
    return state.rendered === true && !state.busy && typedName().length >= TYPED_NAME_MIN && el('dsg-consent').checked === true;
  }
  function updateGate() {
    var ok = canSign();
    var b = el('dsg-submit');
    b.disabled = !ok;
    b.setAttribute('aria-disabled', ok ? 'false' : 'true');
  }

  function open(doc, opts) {
    ensureModal();
    state.doc = doc; state.opts = opts || {}; state.rendered = false; state.busy = false; state.pages = 0; state.sha256 = null;
    var token = ++state.token;
    el('dsg-title').textContent = doc.filename;
    el('dsg-sub').textContent = 'Please read it in full before signing' + (doc.deadlineLabel ? ' · ' + doc.deadlineLabel : '');
    el('dsg-viewer').innerHTML = '';
    el('dsg-fp').hidden = true; el('dsg-fp').textContent = '';
    el('dsg-name').value = ''; el('dsg-consent').checked = false;
    clearError();
    setStatus('loading', 'Loading the document…');
    updateGate();
    el('dsg-modal').hidden = false;
    document.body.style.overflow = 'hidden';
    renderDocument(doc, token);
  }

  function close() {
    var m = el('dsg-modal');
    if (!m || m.hidden) return;
    state.token++; // abandon any in-flight render
    m.hidden = true;
    document.body.style.overflow = '';
    state.rendered = false; state.doc = null;
  }

  function hex(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }

  async function renderDocument(doc, token) {
    try {
      if (!doc.storagePath) throw new Error('This document has no file attached, so it cannot be read or signed here.');
      var url = await MarketswaveData.getSignedDownloadUrl('documents', doc.storagePath, 300);
      var resp = await fetch(url);
      if (!resp.ok) throw new Error('The document could not be fetched (' + resp.status + ').');
      var bytes = new Uint8Array(await resp.arrayBuffer());
      if (token !== state.token) return;
      if (!(bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        throw new Error('This document is not a PDF and cannot be rendered here.');
      }
      try {
        state.sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
        el('dsg-fp').innerHTML = 'Fingerprint of this document (SHA-256): <code>' + state.sha256 + '</code>';
        el('dsg-fp').hidden = false;
      } catch (_e) { state.sha256 = null; }

      var pdfjs = await loadPdfJs();
      if (token !== state.token) return;
      // A copy: pdf.js transfers the buffer to its worker, and the hash above already read it.
      var pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
      if (token !== state.token) return;
      var total = pdf.numPages;
      state.pages = total;
      var viewer = el('dsg-viewer');
      var width = Math.max(240, viewer.clientWidth - 28);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);

      for (var p = 1; p <= total; p++) {
        setStatus('loading', 'Rendering page ' + p + ' of ' + total + '…');
        var page = await pdf.getPage(p);
        if (token !== state.token) return;
        var base = page.getViewport({ scale: 1 });
        var scale = width / base.width;
        var vp = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.className = 'dsg-page';
        canvas.setAttribute('data-page', String(p));
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Page ' + p + ' of ' + total);
        canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = Math.floor(vp.width) + 'px';
        var ctx = canvas.getContext('2d');
        var task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: scale * dpr }) });
        await task.promise;
        if (token !== state.token) return;
        // A text layer for assistive technology: the drawn text of the page, visually hidden.
        var text = '';
        try { var tc = await page.getTextContent(); text = tc.items.map(function (i) { return i.str; }).join(' '); } catch (_e) { text = ''; }
        var sr = document.createElement('p'); sr.className = 'dsg-sr'; sr.textContent = 'Page ' + p + ' of ' + total + '. ' + text;
        viewer.appendChild(canvas); viewer.appendChild(sr);
        var num = document.createElement('p'); num.className = 'dsg-page-num'; num.textContent = 'Page ' + p + ' of ' + total; num.setAttribute('aria-hidden', 'true');
        viewer.appendChild(num);
      }
      if (token !== state.token) return;
      state.rendered = true;
      setStatus('ready', total + ' page' + (total === 1 ? '' : 's') + ' — scroll to read the whole document, then sign below.');
      updateGate();
    } catch (err) {
      if (token !== state.token) return;
      state.rendered = false;
      setStatus('error', 'The document could not be displayed here: ' + (err && err.message ? err.message : String(err)) + ' Use Download to read it; signing is not available until it can be shown on this page.');
      updateGate();
    }
  }

  function submit() {
    if (!canSign()) { updateGate(); return; } // the real gate — re-checked here, not only the attribute
    clearError();
    var doc = state.doc;
    var name = typedName();
    var btn = el('dsg-submit');
    state.busy = true; updateGate();
    MarketswaveData.withButtonBusy(btn, 'Signing…', function () {
      return MarketswaveData.callFunction('sign-document', {
        documentId: doc.id, typedName: name, consentText: CONSENT_TEXT, consentAffirmed: true,
        clientReportedSha256: state.sha256 || undefined, clientReportedPages: state.pages || undefined
      });
    }).then(function (res) {
      state.busy = false;
      var sig = res && res.signature;
      close();
      var toast = state.opts && state.opts.onToast ? state.opts.onToast : function () {};
      toast('Signed', doc.filename + ' has been signed. Your signed copy is ready to download.');
      if (state.opts && state.opts.onSigned) state.opts.onSigned(sig, doc);
      state.opts = null;
    }).catch(function (err) {
      state.busy = false;
      showError(MarketswaveData.writeErrorMessage(err));
      updateGate();
    });
  }

  window.DocumentSigning = { open: open, close: close, CONSENT_TEXT: CONSENT_TEXT, CAPTURE_TEXT: CAPTURE_TEXT, PDFJS_VERSION: PDFJS_VERSION, _state: state };
})();
