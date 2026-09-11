// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — remove one symbol from the caller's
// own watchlist. Self-only; the row must genuinely belong to the caller, checked against
// their own verified JWT rather than trusting the id they sent.
//
// Deletes the row outright rather than soft-deleting it. This is the one place in the
// project where that is right: a watchlist entry records nothing that happened — no money
// moved, no request was resolved — it only records attention, and "show everything, never
// silently delete" exists to preserve history, of which this has none. Any ALERT attached
// to the row goes with it via the foreign key's own cascade, which is the honest outcome:
// an alert on a symbol you no longer watch has nothing left to watch.
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
    const id = body?.id ? String(body.id) : '';
    if (!id) return jsonResponse({ error: 'id is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // .eq('client_id', clientId) in the DELETE itself, not a separate ownership read
    // followed by an unscoped delete — one statement that cannot be raced between the two.
    // .select() is what makes a no-match visible: a DELETE that matches nothing succeeds
    // silently otherwise, and this would report a removal that never happened.
    const { data: deleted, error: delErr } = await admin
      .from('watchlist_symbols')
      .delete()
      .eq('id', id)
      .eq('client_id', clientId)
      .select();
    if (delErr) return jsonResponse({ error: delErr.message }, 500);
    if (!deleted || deleted.length === 0) {
      return jsonResponse({ error: 'That symbol is not on your watchlist.' }, 404);
    }

    return jsonResponse({ removed: deleted[0].symbol }, 200);
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
