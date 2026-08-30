// Supabase Migration — Stage 3 (Aug 30, 2026). Shared CORS headers for every Edge Function
// invoked directly from the browser (via supabase.functions.invoke()) — the JS client sends
// a real Authorization header and a JSON content-type, both non-simple headers, so a
// cross-origin browser call always triggers a real CORS preflight (OPTIONS) request first.
// No allowlist needed beyond `*` here: these functions are protected by a real auth check
// inside the handler itself (the caller's own JWT must carry app_metadata.is_admin === true,
// re-verified server-side, never trusted from the request body) — CORS only controls which
// origins may ASK, not what they're allowed to do once the request lands.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
