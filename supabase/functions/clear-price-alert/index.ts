// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — cancel the active alert on one
// watched symbol. Self-only, scoped by the caller's own verified JWT in the DELETE itself.
//
// An alert the client cancels is deleted rather than marked fired: it did not fire, and
// 'fired' is a real claim about what happened, not a tidy-up state.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }
    const clientId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const watchlistSymbolId = body?.watchlistSymbolId ? String(body.watchlistSymbolId) : '';
    if (!watchlistSymbolId) return jsonResponse({ error: 'watchlistSymbolId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: deleted, error: delErr } = await admin
      .from('price_alerts')
      .delete()
      .eq('watchlist_symbol_id', watchlistSymbolId)
      .eq('client_id', clientId)
      .eq('status', 'active')
      .select();
    if (delErr) return jsonResponse({ error: delErr.message }, 500);
    if (!deleted || deleted.length === 0) {
      return jsonResponse({ error: 'There is no active alert on that symbol.' }, 404);
    }

    return jsonResponse({ cleared: deleted[0].symbol }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
