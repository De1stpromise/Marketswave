// ★★ Merged Market Snapshot + Watchlist (2026-09-11) — set (or replace) the one price
// alert on one watched symbol.
//
// AUTHORIZATION: self-only, and the watchlist row must genuinely belong to the caller.
//
// ONE ACTIVE ALERT PER SYMBOL, and this function is not the only thing enforcing it — a
// partial unique index on (watchlist_symbol_id) where status = 'active' is, because two
// near-simultaneous submits would both pass an application-level check. Setting a new
// alert on a symbol that already has one REPLACES it (the old active alert is deleted, not
// marked fired — it never fired, and recording it as though it had would be a lie in the
// client's own alert history).
//
// ALERTS FIRE ONCE AND CLEAR. That is stated in the UI, and it is the whole design: a
// repeating alert on a symbol oscillating around its target is a spam machine, and this
// project sends real email.
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
    const direction = body?.direction;
    const targetPrice = typeof body?.targetPrice === 'number' ? body.targetPrice : Number(body?.targetPrice);

    if (!watchlistSymbolId) return jsonResponse({ error: 'watchlistSymbolId is required.' }, 400);
    if (direction !== 'above' && direction !== 'below') {
      return jsonResponse({ error: "direction must be 'above' or 'below'." }, 400);
    }
    if (!isFinite(targetPrice) || targetPrice <= 0) {
      return jsonResponse({ error: 'Target price must be a positive number.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: row, error: rowErr } = await admin
      .from('watchlist_symbols')
      .select('id, symbol, client_id')
      .eq('id', watchlistSymbolId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (rowErr) return jsonResponse({ error: rowErr.message }, 500);
    if (!row) return jsonResponse({ error: 'That symbol is not on your watchlist.' }, 404);

    // Replace any existing ACTIVE alert. Fired alerts are left exactly where they are —
    // they are history, and this is a new one.
    const { error: clearErr } = await admin
      .from('price_alerts')
      .delete()
      .eq('watchlist_symbol_id', watchlistSymbolId)
      .eq('status', 'active');
    if (clearErr) return jsonResponse({ error: clearErr.message }, 500);

    const { data: alert, error: insertErr } = await admin
      .from('price_alerts')
      .insert({
        client_id: clientId,
        watchlist_symbol_id: watchlistSymbolId,
        symbol: row.symbol,
        direction,
        target_price: targetPrice,
        status: 'active'
      })
      .select()
      .single();
    if (insertErr) {
      if ((insertErr.code || '') === '23505') {
        return jsonResponse({ error: 'An alert is already set on this symbol.' }, 409);
      }
      return jsonResponse({ error: insertErr.message }, 500);
    }

    return jsonResponse({
      id: alert.id,
      symbol: alert.symbol,
      direction: alert.direction,
      targetPrice: Number(alert.target_price)
    }, 200);
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
