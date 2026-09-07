// Client-Facing Password Reset flow (2026-09-07) — verify-password-reset-flow.mjs's own
// loader. Extends esm-loader-supabase-cdn.mjs's exact technique (redirect the one real CDN
// specifier both login.html/reset-password.html need) with stubs for the RETIRED Firebase
// imports login.html's own module script still carries statically (harmless in the real
// browser — no network call happens unless IS_SUPABASE_BACKEND is false, which it never is
// in this test — but Node's static import resolution still needs every specifier to resolve
// to SOMETHING). Every stub export is a no-op/null — none of them are ever actually called
// by the real code path this script exercises, confirmed by reading login.html's own control
// flow (it returns before reaching the Firebase branch whenever IS_SUPABASE_BACKEND is true).
const LOCAL_SUPABASE_JS = new URL('../node_modules/@supabase/supabase-js/dist/index.mjs', import.meta.url).href;

const FIREBASE_CONFIG_STUB = 'data:text/javascript,export const auth = null; export const db = null;';
const FIREBASE_AUTH_STUB = 'data:text/javascript,' + encodeURIComponent(
  'export function signInWithEmailAndPassword() { throw new Error("stubbed — retired Firebase path not under test"); }\n' +
  'export function signOut() { throw new Error("stubbed — retired Firebase path not under test"); }\n'
);
const FIREBASE_FIRESTORE_STUB = 'data:text/javascript,' + encodeURIComponent(
  'export function doc() { throw new Error("stubbed — retired Firebase path not under test"); }\n' +
  'export function getDoc() { throw new Error("stubbed — retired Firebase path not under test"); }\n'
);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'https://esm.sh/@supabase/supabase-js@2.112.4') {
    return { url: LOCAL_SUPABASE_JS, shortCircuit: true };
  }
  if (specifier.endsWith('firebase-config.js')) {
    return { url: FIREBASE_CONFIG_STUB, shortCircuit: true };
  }
  if (specifier.endsWith('firebase-auth.js')) {
    return { url: FIREBASE_AUTH_STUB, shortCircuit: true };
  }
  if (specifier.endsWith('firebase-firestore.js')) {
    return { url: FIREBASE_FIRESTORE_STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
