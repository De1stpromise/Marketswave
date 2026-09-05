// Backend Migration Phase B — Stage 3 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's requestSell(productId, unitsToSell) — read
// that function's real source in full before writing this, not reinvented. Same
// "request now, execute later" discipline as request-allocation: creates a pending row
// only. Only approve-sell (a separate, admin-only function) ever moves units.
//
// CLIENT-CALLABLE, SELF ONLY — clientId derived from the caller's own verified JWT
// (getClaims(jwt).sub), same reasoning as every other client-callable function in this
// project.
//
// INVESTIGATED PER INSTRUCTION, reported here rather than silently assumed either way: the
// real local requestSell() itself does NOT check the client's own OTHER pending sell
// requests on the same product — it only validates against the CURRENT holding
// (holdings.find(...).units). The "available to sell = holding.units minus this product's
// own pending sell requests" guard documented in this project's history (CLAUDE.md,
// asset-performance.html's Sell modal) lives ENTIRELY in that page's own client-side UI
// code, not inside requestSell() itself — confirmed by reading requestSell()'s real source
// above, which contains no such check. So there is nothing to port here beyond what
// requestSell() itself actually does: this function mirrors requestSell()'s real validation
// exactly (current holding only), not the UI-layer convenience guard. The real correctness
// backstop for a client submitting two sell requests that together oversell is
// approve-sell's own re-validation-at-approval-time check (this stage's own equivalent of
// approveSellRequest()'s real, already-existing re-validation) — the second approval
// attempt is refused there, exactly as it would be locally.
//
// Zero-holdings default on a missing holdings row for the requested product — the real
// local requestSell() throws "No holding exists for product X." when
// holdings.find(...) returns undefined; reproduced here identically via a plain SELECT that
// returns no row.
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

    const body = await req.json();
    const productId = body && body.productId;
    const unitsToSell = body && body.unitsToSell;
    if (!productId) return jsonResponse({ error: 'productId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: holding, error: holdingErr } = await admin
      .from('holdings')
      .select('units')
      .eq('client_id', clientId)
      .eq('product_id', productId)
      .maybeSingle();
    if (holdingErr) return jsonResponse({ error: holdingErr.message }, 500);
    if (!holding) return jsonResponse({ error: 'No holding exists for product ' + productId + '.' }, 404);

    if (typeof unitsToSell !== 'number' || !isFinite(unitsToSell) || unitsToSell <= 0) {
      return jsonResponse({ error: 'unitsToSell must be a positive number.' }, 400);
    }
    if (unitsToSell > holding.units + 1e-9) {
      return jsonResponse({ error: 'Cannot request to sell more units than are currently held.' }, 409);
    }

    const { data: request, error: insertErr } = await admin
      .from('sell_requests')
      .insert({
        client_id: clientId,
        product_id: productId,
        units_to_sell: unitsToSell,
        status: 'pending'
      })
      .select()
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    return jsonResponse(toClientShape(request), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.client_id,
    productId: row.product_id,
    unitsToSell: row.units_to_sell,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    transactionId: row.transaction_id,
    reason: row.reason
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
