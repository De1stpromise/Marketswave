// Backend Migration Phase B — Stage 2 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's approveWithdrawal(clientId, requestId,
// approvedAmount) — read that function's real source in full before writing this, not
// reinvented. THE ONE PROPERTY THIS PORT MUST PRESERVE EXACTLY, called out per instruction:
// re-validates against the client's CURRENT unallocated_capital AT APPROVAL TIME, not just
// what was true at request time — the original oversell-prevention property. Two pending
// withdrawal requests that each individually looked valid when requested (request-withdrawal
// only ever checks against unallocated_capital as it stood at THAT moment, never against
// other still-pending withdrawal requests) can still combine into an over-withdrawal if
// approved back-to-back; this throws (409) rather than driving the balance negative — proven
// by this stage's own verification test approving two such requests in sequence.
//
// approvedAmount stays PM-editable (may differ from request.requested_amount) — same
// interaction-consistency judgment call already made and reported for the local engine
// (see engine-core.js's own approveWithdrawal() header comment), carried forward unchanged
// by this port, not relitigated here.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — same pattern as credit-deposit.
//
// A WITHDRAWAL transaction has no product_id/units/price, just total_value/method — same
// shape as DEPOSIT, mirrored exactly.
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

    // Real per-PM attribution (Backend Migration Phase C — Stage 1, 2026-09-06): captured
    // directly from the caller's own already-verified JWT claims computed above — zero extra
    // DB round trip. Written into the resolved/created/updated row below.
    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json();
    const requestId = body && body.requestId;
    const approvedAmount = body && body.approvedAmount;
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);
    if (typeof approvedAmount !== 'number' || !isFinite(approvedAmount) || approvedAmount <= 0) {
      return jsonResponse({ error: 'approvedAmount must be a positive number.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('withdrawal_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown withdrawal request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'Withdrawal request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    const clientId = request.client_id;
    const { data: accountState, error: accountErr } = await admin
      .from('account_state')
      .select('unallocated_capital')
      .eq('client_id', clientId)
      .maybeSingle();
    if (accountErr) return jsonResponse({ error: accountErr.message }, 500);
    const currentUnallocated = accountState ? accountState.unallocated_capital : 0;

    // The core re-validation-at-approval-time property — checked against the CURRENT
    // balance, never the balance as it stood when the request was originally created.
    if (approvedAmount > currentUnallocated + 1e-9) {
      return jsonResponse({
        error: 'Cannot approve withdrawal ' + requestId + ': only ' + currentUnallocated +
          ' unallocated capital remains, but ' + approvedAmount + ' was requested to approve.'
      }, 409);
    }

    const { error: upsertErr } = await admin
      .from('account_state')
      .upsert(
        { client_id: clientId, unallocated_capital: round2(currentUnallocated - approvedAmount), updated_at: new Date().toISOString() },
        { onConflict: 'client_id' }
      );
    if (upsertErr) return jsonResponse({ error: upsertErr.message }, 500);

    const { data: txn, error: txnErr } = await admin
      .from('transactions')
      .insert({
        client_id: clientId,
        product_id: null,
        type: 'WITHDRAWAL',
        units: null,
        price: null,
        total_value: round2(approvedAmount),
        realized_return: null,
        status: 'Completed'
      })
      .select()
      .single();
    if (txnErr) return jsonResponse({ error: txnErr.message }, 500);

    const { data: updatedRequest, error: updateErr } = await admin
      .from('withdrawal_requests')
      .update({
        status: 'approved',
        resolved_at: new Date().toISOString(),
        approved_amount: round2(approvedAmount),
        transaction_id: txn.id,
        resolved_by: adminId,
        resolved_by_email: adminEmail
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
    destinationDetails: row.destination_details,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolvedByEmail: row.resolved_by_email,
    approvedAmount: row.approved_amount,
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
