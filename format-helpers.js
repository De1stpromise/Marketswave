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

  window.formatDateDisplay = formatDateDisplay;
  window.formatFieldDisplay = formatFieldDisplay;
  window.formatUnits = formatUnits;
})();
