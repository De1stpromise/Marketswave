// ★ The client's risk profile, from the server (2026-09-30, register row 292).
//
// It used to live only in this browser's localStorage (marketswave_risk_profile:<clientId>),
// invisible to the server, the PM and the client's other devices. It now lives on
// client_profiles.risk_profile, written only through the self-only set-risk-profile function.
//
// load() is the one read both client pages use (the dashboard's Risk metrics card and
// risk-management.html's Risk Meter). It also performs the ONE-TIME RECLAIM: if this browser
// still holds a pre-server value and the server holds none, it is sent once with reclaim:true.
// The "never overwrite a server value from the browser" rule is enforced by the FUNCTION, not
// here — this file only asks. Once the server holds a value, the browser copy is removed, so a
// stale local value can never resurface.
//
// Requires supabase-data.js (MarketswaveData) and engine-core.js (clientScopedKey), both of which
// load before this on every page that uses it.
(function () {
  var LEVELS = ['conservative', 'balanced', 'aggressive'];
  var LABELS = { conservative: 'Conservative', balanced: 'Balanced', aggressive: 'Aggressive' };
  var LOCAL_KEY_BASE = 'marketswave_risk_profile';

  function localKey() {
    return typeof clientScopedKey === 'function' ? clientScopedKey(LOCAL_KEY_BASE) : null;
  }
  function readLocal() {
    try { var k = localKey(); var v = k ? localStorage.getItem(k) : null; return LEVELS.indexOf(v) !== -1 ? v : null; }
    catch (e) { return null; }
  }
  function dropLocal() {
    try { var k = localKey(); if (k) localStorage.removeItem(k); } catch (e) { /* storage unavailable: nothing to drop */ }
  }

  // Resolves { riskProfile, setAt, reclaimed }. riskProfile is null when none is set anywhere.
  function load() {
    return MarketswaveData.selectTable('client_profiles').then(function (rows) {
      var row = (rows && rows[0]) || null;
      var server = row && row.risk_profile ? { riskProfile: row.risk_profile, setAt: row.risk_profile_set_at, reclaimed: false } : null;
      var local = readLocal();
      if (server) { if (local) dropLocal(); return server; }
      if (!local) return { riskProfile: null, setAt: null, reclaimed: false };
      return MarketswaveData.callFunction('set-risk-profile', { riskProfile: local, reclaim: true }).then(function (res) {
        dropLocal();
        return { riskProfile: res.riskProfile || null, setAt: res.riskProfileSetAt || null, reclaimed: !!res.saved };
      });
    });
  }

  // The client chose a level on the Risk Meter.
  function save(level) {
    return MarketswaveData.callFunction('set-risk-profile', { riskProfile: level }).then(function (res) {
      dropLocal();
      return { riskProfile: res.riskProfile, setAt: res.riskProfileSetAt };
    });
  }

  window.RiskProfile = { LEVELS: LEVELS, LABELS: LABELS, load: load, save: save };
})();
