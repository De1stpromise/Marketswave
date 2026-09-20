// Shared plain-formatting helpers — extracted Aug 23, 2026 to close the structural debt
// flagged when admin-profile-updates.html was built (Aug 21, 2026): it duplicated
// settings.html's own formatFieldDisplay()/formatDateDisplay() instead of sharing them,
// since this project had no module system for plain (stateless) display-formatting
// helpers — only stateful logic gets a shared file (engine-core.js, the sidebar files).
// This is that module for the stateless case: plain global functions on window, one
// <script> tag, mirroring dashboard-sidebar.js/admin-sidebar.js's own convention rather
// than being folded into engine-core.js, since these functions hold no state and touch
// no storage — they don't belong in the data engine.
(function () {
  function formatDateDisplay(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  // A superset of both former copies. settings.html's own version never had a dateOfBirth
  // branch (the field was removed as requestable there, Aug 21, 2026, same day
  // admin-profile-updates.html's copy diverged to add one for a legacy pre-existing
  // record); admin-profile-updates.html's kept that branch. Including it here is inert
  // on settings.html — nothing there calls formatFieldDisplay('dateOfBirth', ...) since no
  // dateOfBirth UI element remains on that page, so this isn't a behavior change for either
  // caller, just one shared body instead of two hand-kept copies.
  function formatFieldDisplay(field, value) {
    if (!value) return '—';
    if (field === 'legalName') return value.firstName + ' ' + value.lastName;
    if (field === 'dateOfBirth') return formatDateDisplay(value);
    if (field === 'address') return value.street + ', ' + value.city + ', ' + value.state + ' ' + value.zip + ', ' + value.country;
    if (field === 'idDocument') return value.fileName ? value.documentType + ' — ' + value.fileName : value.documentType;
    // Task A (2026-09-18): the six onboarding groups render through the shared vocabulary
    // (onboarding-vocab.js) when it is loaded — one "Label: value" per answered field, the
    // form's own option text, never a raw enum key. Pages that load this file without the
    // vocabulary never pass a group field, so the fall-through below is unreachable for them.
    var V = typeof window !== 'undefined' && window.OnboardingVocab;
    if (V && V.VOCAB[field]) {
      var lines = V.describe(field, value).filter(function (d) { return d.text !== null; });
      if (!lines.length) return '—';
      if (V.VOCAB[field].scalar) return lines[0].text;
      return lines.map(function (d) { return d.label + ': ' + d.text; }).join('; ');
    }
    return '—';
  }

  // Product catalog — live pricing, part 1 (2026-09-11). Units are STORED at full precision
  // (Postgres numeric, never rounded at write) and DISPLAYED per asset: a $5,000 allocation
  // into BTC at $77,883 is 0.0642 units, and a holdings table reading "0.06420000" is noise.
  // Crypto shows up to 8 decimals, equities up to 4, everything else 2 — always at least 2,
  // with trailing zeros beyond the second decimal trimmed so 500 reads "500.00" and
  // 0.06420000 reads "0.0642".
  function formatUnits(units, assetClass) {
    var n = Number(units);
    if (!isFinite(n)) return '—';
    var max = assetClass === 'Crypto' ? 8 : assetClass === 'Stocks & ETFs' ? 4 : 2;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: max });
  }

  // ★ SORTABLE COLUMN HEADER (2026-09-19, register row 252) — the ONE builder for every
  // sortable table in the PM tool (the client list, the approval gate's history, the products
  // page), so the markup `.mw-sort` in control-patterns.css expects cannot drift per page.
  // That stylesheet's own header records what each page had got wrong on its own; the short
  // version is that three pages had three hand-rolled headers with three different defects.
  //   attr   the page's OWN dispatch attribute ('data-sort', 'data-cl-sort') — the click handler
  //          is untouched, only the markup inside the cell is shared
  //   key    the sort key that attribute carries
  //   label  the visible label
  //   dir    'asc' | 'desc' when this is the sorted column, anything else otherwise
  //   end    true for a right-aligned (figures) column — the indicator LEADS so the label
  //          stays flush with the numbers beneath it
  // The accessible name carries the state ("Price, sorted descending" / "Price, not sorted")
  // from the same `dir` the CSS keys on, rather than an aria-sort on the button, which is not
  // a valid attribute there (it belongs on a columnheader role a div-grid does not carry).
  function sortHeaderHTML(opts) {
    var esc = function (v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    var dir = opts.dir === 'asc' || opts.dir === 'desc' ? opts.dir : null;
    var state = dir ? 'sorted ' + (dir === 'asc' ? 'ascending' : 'descending') : 'not sorted';
    return '<button type="button" class="mw-sort' + (opts.end ? ' mw-sort-end' : '') + '" ' +
      opts.attr + '="' + esc(opts.key) + '"' + (dir ? ' data-dir="' + dir + '"' : '') +
      ' aria-label="' + esc(opts.label) + ', ' + state + '">' + esc(opts.label) + '</button>';
  }

  window.formatDateDisplay = formatDateDisplay;
  window.formatFieldDisplay = formatFieldDisplay;
  window.formatUnits = formatUnits;
  window.sortHeaderHTML = sortHeaderHTML;
})();
