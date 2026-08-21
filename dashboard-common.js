// Shared live-clock — extracted from the duplicated inline <script> block that used to
// run on every dashboard page. Targets the #live-day / #live-date-time elements in each
// page's header (those elements themselves were not moved, only this update logic).
// Runs immediately on load, same as the original inline version did.
(function () {
  function updateDateTime() {
    var now = new Date();
    var dayEl = document.getElementById('live-day');
    var dateTimeEl = document.getElementById('live-date-time');
    if (dayEl) {
      dayEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
    }
    if (dateTimeEl) {
      dateTimeEl.textContent = now.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    }
  }

  updateDateTime();
  setInterval(updateDateTime, 1000);

  window.initLiveClock = updateDateTime;
})();
