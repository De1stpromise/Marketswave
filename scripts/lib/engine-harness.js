// Loads the REAL engine-core.js source (from the project root, not a copy) into a fresh
// Node `vm` context — the same "load the real file against a minimal fake DOM" pattern this
// project's prior Node-verification scripts used (see CLAUDE.md's Tech Stack log, e.g.
// verify-client-auth-phase3.js), reconstructed here because those scripts were themselves
// kept scratchpad-only and don't survive between sessions.
//
// WHY A FRESH CONTEXT PER CALL, NOT ONE SHARED CONTEXT: engine-core.js is a single IIFE that
// loads every store into module-level variables ONCE when it runs, then serves reads from
// those in-memory variables rather than re-reading localStorage on every call (see
// engine-core.js's own "Client context" comments — this is exactly the documented
// "reload-to-switch" design: switching which client's data is active requires a fresh page
// load, not just calling setCurrentClientId()). `loadEngine()` below re-runs the IIFE from
// scratch every time it's called — simulating a real page navigation/reload — while the
// localStorage/sessionStorage instances passed in are REUSED across calls, exactly like a
// real browser tab's storage survives a navigation even though the page's JS variables don't.
//
// A caller that needs to simulate "the client's session gets pinned, THEN the page loads
// engine-core.js" (dashboard-sidebar.js's own file-load-time ordering, and the exact ordering
// bug documented in CLAUDE.md's §4.44/§4.45 history) must set the relevant sessionStorage key
// BEFORE calling loadEngine() for that step, not after.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { StoragePolyfill } = require('./storage-polyfill');

const ENGINE_PATH = path.join(__dirname, '..', '..', 'engine-core.js');

function createSharedStorage() {
  return {
    localStorage: new StoragePolyfill(),
    sessionStorage: new StoragePolyfill()
  };
}

// storages: { localStorage, sessionStorage } — typically from createSharedStorage(), reused
// across every loadEngine() call in one script run so data written in an earlier "page load"
// is still there for a later one, exactly as real Web Storage would behave.
function loadEngine(storages) {
  const source = fs.readFileSync(ENGINE_PATH, 'utf8');

  const sandbox = {
    localStorage: storages.localStorage,
    sessionStorage: storages.sessionStorage,
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    crypto: globalThis.crypto // Web Crypto (SubtleCrypto) — Node >=19 provides this natively
  };
  // engine-core.js assigns every export as `window.foo = foo`. Making `window` the sandbox
  // object itself (not a nested property) means those assignments land directly on
  // `sandbox`, so `sandbox.getAccountState` etc. are callable after the script runs — no
  // separate export list to keep in sync with engine-core.js's own bottom-of-file block.
  sandbox.window = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'engine-core.js' });
  return sandbox;
}

module.exports = { loadEngine, createSharedStorage, ENGINE_PATH };
