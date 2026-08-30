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

  window.formatDateDisplay = formatDateDisplay;
  window.formatFieldDisplay = formatFieldDisplay;
})();
