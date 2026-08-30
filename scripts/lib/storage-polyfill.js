// Minimal Web Storage (localStorage/sessionStorage) polyfill for running engine-core.js
// outside a browser. engine-core.js talks to `localStorage`/`sessionStorage` directly (no
// `typeof window` guards — it's written to assume a browser), so a Node harness has to
// supply real Storage-shaped objects, not just a plain object with the same key names.
//
// Backed by a plain Map so callers (golden-path-regression.js) can hand the SAME instance
// across multiple `loadEngine()` calls, simulating what actually persists across a real
// page-to-page navigation (localStorage/sessionStorage survive; engine-core.js's own
// module-level variables do not — see engine-harness.js for why that distinction matters).
class StoragePolyfill {
  constructor() {
    this._map = new Map();
  }
  getItem(key) {
    return this._map.has(key) ? this._map.get(key) : null;
  }
  setItem(key, value) {
    this._map.set(key, String(value));
  }
  removeItem(key) {
    this._map.delete(key);
  }
  clear() {
    this._map.clear();
  }
  key(index) {
    return Array.from(this._map.keys())[index] ?? null;
  }
  get length() {
    return this._map.size;
  }
}

module.exports = { StoragePolyfill };
