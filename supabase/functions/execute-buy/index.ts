// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's executeBuy(clientId, productId, dollarAmount)
// — read that function's real source in full before writing this, not reinvented. The real
// money-moving primitive: settles the ONE product being bought (not the whole catalog —
// see _shared/portfolio-engine.ts's settleOneProduct() header for why that distinction
// matters), computes units at the fresh price, merges into an existing holding or creates a
// new one, debits unallocated_capital, recomputes allocated_capital from ALL current
// holdings, and appends a real BUY transaction. Every formula below is copied verbatim from
// the real source — same order of operations, same rounding points (round2() only where the
// original rounds, nowhere else).
//
// AUTHORIZATION: admin-only, no client self-service path. This mirrors the real engine's own
// effective design, not an invented restriction — executeBuy() in engine-core.js is never
// called directly from client-facing code; it's only ever invoked via approveAllocationRequest()
// (a PM-approval action). This stage ports the raw execution primitive itself; the
// request/approval GATING layer (allocationRequests, requestAllocation(),
// approveAllocationRequest()) is explicitly one of the seven Approval Gate queues still
// awaiting its own future Phase B stage — see CLAUDE.md's Tech Stack entry for this stage.
// Until that gate exists server-side, only a real admin-claimed caller may invoke this
// directly, the same getClaims(jwt)-verified check Stage 3's approve-client-application
// function already established.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { settleOneProduct, recomputeAllocatedCapital, round2 } from '../_shared/portfolio-engine.ts';

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
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const body = await req.json();
    const clientId = body && body.clientId;
    const productId = body && body.productId;
    const dollarAmount = body && body.dollarAmount;
    if (!clientId) return jsonResponse({ error: 'clientId is required.' }, 400);
    if (!productId) return jsonResponse({ error: 'productId is required.' }, 400);
    if (typeof dollarAmount !== 'number' || !isFinite(dollarAmount) || dollarAmount <= 0) {
      return jsonResponse({ error: 'dollarAmount must be a positive number.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Settles the ONE product being bought first — the buy always executes at a current
    // unit price, never a stale one left over from before today's tick.
    let settled;
    try {
      settled = await settleOneProduct(admin, productId);
    } catch {
      return jsonResponse({ error: 'Unknown product: ' + productId }, 404);
    }
    const unitPrice = settled.unit_price;
    const units = dollarAmount / unitPrice;

    const { data: existingHolding } = await admin
      .from('holdings')
      .select('*')
      .eq('client_id', clientId)
      .eq('product_id', productId)
      .maybeSingle();

    if (existingHolding) {
      const { error: updateErr } = await admin
        .from('holdings')
        .update({
          units: existingHolding.units + units,
          cost_basis: round2(existingHolding.cost_basis + dollarAmount)
        })
        .eq('id', existingHolding.id);
      if (updateErr) return jsonResponse({ error: updateErr.message }, 500);
    } else {
      const { error: insertErr } = await admin.from('holdings').insert({
        client_id: clientId,
        product_id: productId,
        units: units,
        cost_basis: round2(dollarAmount)
      });
      if (insertErr) return jsonResponse({ error: insertErr.message }, 500);
    }

    const { data: accountState, error: accountErr } = await admin
      .from('account_state')
      .select('*')
      .eq('client_id', clientId)
      .maybeSingle();
    if (accountErr) return jsonResponse({ error: accountErr.message }, 500);
    if (!accountState) return jsonResponse({ error: 'No account state found for client ' + clientId }, 404);

    const { error: debitErr } = await admin
      .from('account_state')
      .update({ unallocated_capital: round2(accountState.unallocated_capital - dollarAmount), updated_at: new Date().toISOString() })
      .eq('client_id', clientId);
    if (debitErr) return jsonResponse({ error: debitErr.message }, 500);

    // Recompute allocated_capital from ALL current holdings x current prices — needs every
    // product's price, not just the one just settled, since a client may hold several.
    const { data: allProducts } = await admin.from('products').select('*');
    const { data: allHoldings } = await admin.from('holdings').select('product_id, units').eq('client_id', clientId);
    await recomputeAllocatedCapital(admin, clientId, allHoldings || [], allProducts || []);

    const { data: txn, error: txnErr } = await admin
      .from('transactions')
      .insert({
        client_id: clientId,
        product_id: productId,
        type: 'BUY',
        units: units,
        price: unitPrice,
        total_value: round2(dollarAmount),
        realized_return: null,
        status: 'Completed'
      })
      .select()
      .single();
    if (txnErr) return jsonResponse({ error: txnErr.message }, 500);

    return jsonResponse({
      id: txn.id,
      clientId: clientId,
      productId: productId,
      type: 'BUY',
      units: units,
      price: unitPrice,
      totalValue: round2(dollarAmount)
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
