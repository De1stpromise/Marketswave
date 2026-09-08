// =======================================================================================
// RESPONSIVE TABLES — Mobile fixes, Batch 3 (2026-09-08)
// Companion to responsive-tables.css. That stylesheet turns a `.mw-card-table` row into a
// stacked card at narrow widths and surfaces each cell's column name via
// `td::before { content: attr(data-label) }`. This file is what puts those data-labels
// there, by copying each column's own <th> text onto the <td>s beneath it by index.
//
// ── Why a helper rather than hand-written data-labels ─────────────────────────────────
// Batch 3 started by hand-labelling two tables. A full sweep of every client and admin page
// then found five MORE tables overflowing their wrapper at 390px (up to 939px inside 324px),
// which would have meant hand-labelling ~50 more cells across eight tables — every one of
// them built by string concatenation inside a render function, and every one of them a place
// for a typo or a stale label to hide after someone adds a column. Deriving the label from
// the table's own <th> means the label can never disagree with the heading, and a future
// column change needs no edit here at all.
//
// ── Why a MutationObserver ────────────────────────────────────────────────────────────
// Every one of these tables is re-rendered via innerHTML after an async load, and again on
// each filter/refresh. A one-shot pass at DOMContentLoaded would label the first render and
// silently miss every subsequent one — so the observer re-labels whenever a container's
// contents change. Labelling is idempotent and skips any cell that already carries an
// explicit data-label, so a hand-written label (the deliberately blank one on an action
// column, for instance) always wins over the derived one.
// =======================================================================================
(function () {
  var ATTR = 'data-label';

  function labelTable(table) {
    var heads = Array.prototype.map.call(
      table.querySelectorAll('thead th'),
      function (th) { return (th.textContent || '').trim(); }
    );
    if (!heads.length) return;
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
      Array.prototype.forEach.call(tr.children, function (cell, i) {
        if (cell.tagName !== 'TD') return;
        // A colspan cell is an empty state or an expanded detail panel, not a field.
        if (cell.hasAttribute('colspan')) return;
        // An explicit label always wins — see the note above.
        if (cell.hasAttribute(ATTR)) return;
        cell.setAttribute(ATTR, heads[i] != null ? heads[i] : '');
      });
    });
  }

  function labelAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    Array.prototype.forEach.call(
      scope.querySelectorAll('table.mw-card-table'),
      labelTable
    );
    // A re-render can replace the table itself, so also catch the case where `root` IS one.
    if (scope.matches && scope.matches('table.mw-card-table')) labelTable(scope);
  }

  function start() {
    labelAll(document);
    if (typeof MutationObserver !== 'function') return;
    var pending = false;
    var observer = new MutationObserver(function () {
      // Coalesce bursts (a full innerHTML swap fires many records) into one pass.
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; labelAll(document); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
