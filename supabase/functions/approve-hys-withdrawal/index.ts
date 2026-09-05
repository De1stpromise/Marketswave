// Backend Migration Phase B — Stage 4 (2026-09-02).
//
// Real Edge Function port of engine-core.js's approveHYSWithdrawal(clientId, requestId) — read
// that function's real source in full before writing this, not reinvented. Re-validates
// against the pocket's CURRENT state at approval time (not just the snapshot taken at request
// time) — mirrors approve-withdrawal/approve-sell's own re-validation discipline, for the same
// reason: state can genuinely change between a request being submitted and a PM getting to it
// (e.g. the pocket was already withdrawn through some other resolved request).
//
// DELIBERATE DESIGN, decided with the user before the local engine's own equivalent was built
// (see engine-core.js's own HYS_WITHDRAWAL_REQUESTS_KEY comment) and preserved exactly here:
// an approved HYS withdrawal does NOT credit unallocated_capital — HYS is its own pool, funded
// and paid out externally. This function never touches account_state at all. Still lands in
// transactions (type HYS_WITHDRAWAL) so the activity is visible in one place.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — same pattern as every other admin-only
// function in this project.
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
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const body = await req.json();
    const requestId = body && body.requestId;
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('hys_withdrawal_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown HYS withdrawal request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'HYS withdrawal request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    // Re-validation-at-approval-time against the pocket's CURRENT state, not the snapshot
    // taken when the request was created — the core property this function must preserve.
    const { data: pocket, error: pocketErr } = await admin
      .from('hys_pockets')
      .select('*')
      .eq('id', request.pocket_id)
      .maybeSingle();
    if (pocketErr) return jsonResponse({ error: pocketErr.message }, 500);
    if (!pocket) return jsonResponse({ error: 'Pocket ' + request.pocket_id + ' no longer exists.' }, 404);
    if (pocket.status === 'withdrawn') {
      return jsonResponse({ error: 'Pocket ' + request.pocket_id + ' has already been withdrawn.' }, 409);
    }

    const clientId = request.client_id;

    const { error: pocketUpdateErr } = await admin
      .from('hys_pockets')
      .update({
        status: 'withdrawn',
        withdrawn_at: new Date().toISOString(),
        withdrawn_amount: request.receive_amount,
        withdrawal_method: request.method === 'crypto' ? 'crypto wallet' : 'bank account'
      })
      .eq('id', request.pocket_id);
    if (pocketUpdateErr) return jsonResponse({ error: pocketUpdateErr.message }, 500);

    // A HYS_WITHDRAWAL transaction has no product_id/units/price, just total_value — same
    // shape as HYS_DEPOSIT. realized_return stays null, matching HYS_DEPOSIT's own choice —
    // HYS interest earned/forfeited is fully visible via the pocket's own projected_interest
    // and this request's own forfeit/receive_amount fields, never wired into the portfolio-
    // side realized-return math, which HYS has never participated in.
    const { data: txn, error: txnErr } = await admin
      .from('transactions')
      .insert({
        client_id: clientId,
        product_id: null,
        type: 'HYS_WITHDRAWAL',
        units: null,
        price: null,
        total_value: request.receive_amount,
        realized_return: null,
        status: 'Completed'
      })
      .select()
      .single();
    if (txnErr) return jsonResponse({ error: txnErr.message }, 500);

    const { data: updatedRequest, error: updateErr } = await admin
      .from('hys_withdrawal_requests')
      .update({
        status: 'approved',
        resolved_at: new Date().toISOString(),
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
    pocketId: row.pocket_id,
    pocketType: row.pocket_type,
    termLabel: row.term_label,
    forfeit: row.forfeit,
    receiveAmount: row.receive_amount,
    method: row.method,
    destinationDetails: row.destination_details,
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
