// Backend Migration Phase B — Stage 3 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's requestAllocation(productId, dollarAmount) —
// read that function's real source in full before writing this, not reinvented. Same
// "request now, execute later" discipline as every other request-* function in this
// project: creates a pending row only. Only approve-allocation (a separate, admin-only
// function) ever moves money or units.
//
// CLIENT-CALLABLE, SELF ONLY — same reasoning as request-deposit/request-withdrawal
// (Stage 2): clientId is derived from the caller's own verified JWT (getClaims(jwt).sub),
// never trusted from the request body. The real local requestAllocation() is AMBIENT (no
// clientId parameter at all, resolves via the ambient session) — deriving it from the JWT
// here is the server-side equivalent of that same ambient-self design, not a departure
// from it.
//
// Validation order mirrors requestAllocation() exactly: product must exist and not be the
// Cash/Unallocated bucket itself, amount must be a positive number, amount must be >= the
// product's own minimum_investment, and amount must be <= the client's CURRENT
// unallocated_capital.
//
// Zero-balance default on a missing account_state row — same faithful port as Stage 2's own
// request-withdrawal (readAccountStateForClient() never throws "not found," it defaults to
// unallocatedCapital: 0). By construction this means a client with no account_state row can
// never successfully create an allocation request: the amount must be both > 0 (a
// validation rule) and <= 0 (the zero-default balance) — a real contradiction, so the
// request is correctly and cleanly rejected rather than erroring out ungracefully.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { round2 } from '../_shared/portfolio-engine.ts';

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
    const dollarAmount = body && body.dollarAmount;
    if (!productId) return jsonResponse({ error: 'productId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: product, error: productErr } = await admin.from('products').select('*').eq('id', productId).maybeSingle();
    if (productErr) return jsonResponse({ error: productErr.message }, 500);
    if (!product) return jsonResponse({ error: 'Unknown product: ' + productId }, 404);
    if (product.asset_class === 'Unallocated / Cash') {
      return jsonResponse({ error: 'Cannot request an allocation into Cash — it represents the Unallocated bucket itself.' }, 400);
    }
    if (typeof dollarAmount !== 'number' || !isFinite(dollarAmount) || dollarAmount <= 0) {
      return jsonResponse({ error: 'Allocation amount must be a positive number.' }, 400);
    }
    if (dollarAmount < product.minimum_investment) {
      return jsonResponse({ error: 'Allocation amount is below ' + product.name + '\'s minimum investment of ' + product.minimum_investment + '.' }, 400);
    }

    const { data: accountState, error: accountErr } = await admin
      .from('account_state')
      .select('unallocated_capital')
      .eq('client_id', clientId)
      .maybeSingle();
    if (accountErr) return jsonResponse({ error: accountErr.message }, 500);
    const unallocatedCapital = accountState ? accountState.unallocated_capital : 0;

    if (dollarAmount > unallocatedCapital + 1e-9) {
      return jsonResponse({ error: 'Allocation amount exceeds current unallocated capital.' }, 409);
    }

    const { data: request, error: insertErr } = await admin
      .from('allocation_requests')
      .insert({
        client_id: clientId,
        product_id: productId,
        requested_amount: round2(dollarAmount),
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
    requestedAmount: row.requested_amount,
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
