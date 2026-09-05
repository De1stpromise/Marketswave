// UI Wiring — Stage 1 (2026-09-03). Custom Node ESM loader hook, registered via
// node:module's register() — the same technique this project used once before (a prior
// admin-firebase-config.js Node verification) to test a real browser-only config file
// without a browser: intercept the ONE external CDN specifier a real project file imports
// and redirect it to the equivalent already-installed local npm package, so the REAL,
// unmodified supabase-config.js (and anything that imports it, e.g. the real
// supabase-data.js) can be loaded and executed for real inside Node, with only the network
// fetch substituted — every other line of both files runs completely unmodified.
// import.meta.url is already a file:// URL, so relative resolution against it produces
// another well-formed file:// URL directly — no pathToFileURL()/pathname round-trip needed
// (and that round-trip is actively wrong on Windows, where .pathname would yield
// "/C:/..." — not a valid raw filesystem path).
const LOCAL_SUPABASE_JS = new URL('../node_modules/@supabase/supabase-js/dist/index.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'https://esm.sh/@supabase/supabase-js@2.112.4') {
    return { url: LOCAL_SUPABASE_JS, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
