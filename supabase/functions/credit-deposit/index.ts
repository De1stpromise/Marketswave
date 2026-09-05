// Backend Migration Phase B — Stage 2 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's creditDepositRequest(clientId, requestId,
// confirmedAmount) — read that function's real source in full before writing this, not
// reinvented. THE ONE DETAIL MOST LIKELY TO GET WRONG IN A CARELESS PORT, called out
// explicitly, same as execute-sell's own header: confirmedAmount (PM-entered at credit time)
// is authoritative and MAY DIFFER from the client's original requested_amount — real-world
// wire fees/FX/partial transfers. This is preserved exactly: the credited amount always comes
// from the request body's confirmedAmount, never from the stored requested_amount.
//
// AUTHORIZATION: admin-only, via the caller's own verified JWT (getClaims(jwt) —
// never getUser(), see execute-buy/execute-sell's own header for the real bug that
// distinction fixed on this project's very first Stage 3 Edge Functions). requestId alone is
// enough to resolve which client owns the request — the row itself already carries client_id,
// so no separate clientId parameter is needed in the request body (unlike
// request-deposit/request-withdrawal, which have no requestId to look one up from yet).
//
// Zero-balance default on a missing account_state row — a faithful port of
// writeAccountStateForClient()'s own real behavior (always upserts; localStorage.setItem
// creates-or-overwrites unconditionally). A client with no account_state row yet correctly
// gets one created here, seeded with exactly the confirmed deposit amount — see this stage's
// migration file header for the full "why."
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
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const body = await req.json();
    const requestId = body && body.requestId;
    const confirmedAmount = body && body.confirmedAmount;
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);
    if (typeof confirmedAmount !== 'number' || !isFinite(confirmedAmount) || confirmedAmount <= 0) {
      return jsonResponse({ error: 'confirmedAmount must be a positive number.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('deposit_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown deposit request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'Deposit request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    const clientId = request.client_id;
    const { data: accountState, error: accountErr } = await admin
      .from('account_state')
      .select('unallocated_capital')
      .eq('client_id', clientId)
      .maybeSingle();
    if (accountErr) return jsonResponse({ error: accountErr.message }, 500);
    const currentUnallocated = accountState ? accountState.unallocated_capital : 0;

    const { error: upsertErr } = await admin
      .from('account_state')
      .upsert(
        { client_id: clientId, unallocated_capital: round2(currentUnallocated + confirmedAmount), updated_at: new Date().toISOString() },
        { onConflict: 'client_id' }
      );
    if (upsertErr) return jsonResponse({ error: upsertErr.message }, 500);

    // A DEPOSIT transaction has no product_id/units/price — just total_value/method, same
    // shape as the local DEPOSIT transaction creditDepositRequest() itself produces.
    const { data: txn, error: txnErr } = await admin
      .from('transactions')
      .insert({
        client_id: clientId,
        product_id: null,
        type: 'DEPOSIT',
        units: null,
        price: null,
        total_value: round2(confirmedAmount),
        realized_return: null,
        status: 'Completed'
      })
      .select()
      .single();
    if (txnErr) return jsonResponse({ error: txnErr.message }, 500);

    const { data: updatedRequest, error: updateErr } = await admin
      .from('deposit_requests')
      .update({
        status: 'credited',
        resolved_at: new Date().toISOString(),
        credited_amount: round2(confirmedAmount),
        transaction_id: txn.id
      })
      .eq('id', requestId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    return jsonResponse(toClientShape(updatedRequest), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.client_id,
    method: row.method,
    requestedAmount: row.requested_amount,
    currency: row.currency,
    details: row.details,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    creditedAmount: row.credited_amount,
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
