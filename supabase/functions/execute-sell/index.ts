// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's executeSell(clientId, productId, unitsToSell)
// — read that function's real source in full before writing this, not reinvented.
//
// ★ THE FULL SALE PROCEEDS ARE CREDITED TO unallocated_capital (changed 2026-09-22, row 264).
// asset_returns still accumulates realized_return on every sale, but as a REPORTED TALLY — a
// lifetime record of what has been made from sales — never as a balance anyone can spend.
//
// It used to credit only the COST-BASIS PORTION here and route the gain to asset_returns as a
// second pot. Nothing could ever spend or withdraw that pot: execute-buy debits
// unallocated_capital, request-allocation/approve-allocation validate against it, and
// request-withdrawal/approve-withdrawal validate against it — so a client who sold at a profit
// could see the gain in every total and reach none of it, permanently. The loss case was worse
// in the other direction: crediting the full cost basis back after a loss left the spendable
// balance OVERSTATING what the sale actually returned. Now spendable capital is exactly what
// the sale returned, gain or loss.
//
// ★ PAIRED CHANGE, SAME COMMIT: computeTotalPortfolioValue() no longer sums asset_returns.
// The realised amount is inside unallocated_capital from the moment of the sale; summing the
// tally as well would double-count it in every total (the dashboard headline, AUM, the monthly
// anchors). Total Portfolio Value stays exactly conserved through a buy/sell round trip — the
// property this stage's own round-trip test asserts, and it still holds: what the holding loses
// in allocated_capital, unallocated_capital gains in full.
//
// Cost basis for the sold portion is PROPORTIONAL to the fraction of the holding being sold —
// NOT FIFO/LIFO lot tracking, since holdings aren't tracked as discrete lots here (same as the
// local engine). Settles the ONE product being sold first, same as execute-buy.
//
// AUTHORIZATION: admin-only — see execute-buy/index.ts's own header for the full "why" (the
// real engine's executeSell() is likewise never called directly by client-facing code; the
// sell-request/approval gate is one of the seven Approval Gate queues still awaiting its own
// future Phase B stage).
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
    const unitsToSell = body && body.unitsToSell;
    if (!clientId) return jsonResponse({ error: 'clientId is required.' }, 400);
    if (!productId) return jsonResponse({ error: 'productId is required.' }, 400);
    if (typeof unitsToSell !== 'number' || !isFinite(unitsToSell) || unitsToSell <= 0) {
      return jsonResponse({ error: 'unitsToSell must be a positive number.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: holding, error: holdingErr } = await admin
      .from('holdings')
      .select('*')
      .eq('client_id', clientId)
      .eq('product_id', productId)
      .maybeSingle();
    if (holdingErr) return jsonResponse({ error: holdingErr.message }, 500);
    if (!holding) return jsonResponse({ error: 'No holding exists for product ' + productId + '.' }, 404);
    if (unitsToSell > holding.units + 1e-9) {
      return jsonResponse({ error: 'Cannot sell more units than are held.' }, 409);
    }

    let settled;
    try {
      settled = await settleOneProduct(admin, productId);
    } catch {
      return jsonResponse({ error: 'Unknown product: ' + productId }, 404);
    }
    const unitPrice = settled.unit_price;

    const saleValue = round2(unitsToSell * unitPrice);
    const costBasisPortion = round2(holding.cost_basis * (unitsToSell / holding.units));
    const realizedReturn = round2(saleValue - costBasisPortion);

    const { data: accountState, error: accountErr } = await admin
      .from('account_state')
      .select('*')
      .eq('client_id', clientId)
      .maybeSingle();
    if (accountErr) return jsonResponse({ error: accountErr.message }, 500);
    if (!accountState) return jsonResponse({ error: 'No account state found for client ' + clientId }, 404);

    const remainingUnits = holding.units - unitsToSell;
    if (remainingUnits < 1e-6) {
      const { error: deleteErr } = await admin.from('holdings').delete().eq('id', holding.id);
      if (deleteErr) return jsonResponse({ error: deleteErr.message }, 500);
    } else {
      const { error: updateErr } = await admin
        .from('holdings')
        .update({ units: remainingUnits, cost_basis: round2(holding.cost_basis - costBasisPortion) })
        .eq('id', holding.id);
      if (updateErr) return jsonResponse({ error: updateErr.message }, 500);
    }

    // Credits the FULL SALE VALUE to unallocated_capital (row 264). asset_returns accumulates
    // the same realized_return it always did, as the lifetime tally — never spent, never
    // withdrawn, and deliberately NOT summed into Total Portfolio Value any more.
    const { error: creditErr } = await admin
      .from('account_state')
      .update({
        unallocated_capital: round2(accountState.unallocated_capital + saleValue),
        asset_returns: round2(accountState.asset_returns + realizedReturn),
        updated_at: new Date().toISOString()
      })
      .eq('client_id', clientId);
    if (creditErr) return jsonResponse({ error: creditErr.message }, 500);

    // Recompute allocated_capital from ALL remaining holdings x current prices.
    const { data: allProducts } = await admin.from('products').select('*');
    const { data: allHoldings } = await admin.from('holdings').select('product_id, units').eq('client_id', clientId);
    await recomputeAllocatedCapital(admin, clientId, allHoldings || [], allProducts || []);

    const { data: txn, error: txnErr } = await admin
      .from('transactions')
      .insert({
        client_id: clientId,
        product_id: productId,
        type: 'SELL',
        units: unitsToSell,
        price: unitPrice,
        total_value: saleValue,
        realized_return: realizedReturn,
        status: 'Completed'
      })
      .select()
      .single();
    if (txnErr) return jsonResponse({ error: txnErr.message }, 500);

    return jsonResponse({
      id: txn.id,
      clientId: clientId,
      productId: productId,
      type: 'SELL',
      units: unitsToSell,
      price: unitPrice,
      totalValue: saleValue,
      realizedReturn: realizedReturn
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
