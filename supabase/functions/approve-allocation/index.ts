// Backend Migration Phase B — Stage 3 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's approveAllocationRequest(clientId, requestId)
// — read that function's real source in full before writing this, not reinvented.
//
// THE ACTUAL POINT OF THIS FUNCTION, per instruction: this does NOT duplicate execute-buy's
// money-moving logic. It makes a REAL, LIVE HTTP CALL to Stage 1's already-deployed
// execute-buy Edge Function — the literal same code path verify-supabase-portfolio-engine.js
// already proved correct — forwarding the ORIGINAL CALLER'S OWN JWT as the Authorization
// header. Since this function has already verified (via getClaims(jwt)) that the caller
// carries app_metadata.is_admin === true, forwarding that identical JWT to execute-buy
// satisfies execute-buy's own independent admin check exactly, with no need to invent a
// service-role bypass or duplicate its authorization logic either. This is what "a real
// internal call to the already-verified function, not a parallel reimplementation" means in
// practice: execute-buy's settlement math, holding-merge logic, and transaction-append logic
// run exactly once, in exactly one file, regardless of which entry point reached it.
//
// A REAL, DELIBERATE STRENGTHENING BEYOND THE LOCAL ENGINE, FLAGGED PER INSTRUCTION, NOT
// SILENTLY ADDED: the real local approveAllocationRequest() does NOT re-validate against the
// client's current unallocatedCapital before calling executeBuy() — it calls executeBuy()
// unconditionally once the request is confirmed pending. This is a genuine asymmetry with
// approveSellRequest(), which DOES re-validate against current holdings before calling
// executeSell(). Per this stage's own explicit instruction ("re-validates against the
// client's CURRENT unallocated_capital at approval time, same re-validation discipline Stage
// 2 proved matters"), approve-allocation ADDS this re-validation — a real behavioral
// strengthening over the local engine's current (arguably under-guarded) behavior, not a
// faithful-to-a-fault port of a gap. If two pending allocation requests together exceed the
// client's current unallocated_capital, only the first can be approved here; the local
// engine, unchanged, would let both through and drive unallocatedCapital negative.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — same pattern as every other admin-only
// function in this project.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail } from '../_shared/send-email.ts';

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
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('allocation_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown allocation request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'Allocation request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    const clientId = request.client_id;

    // Re-validation-at-approval-time — see this file's own header for why this is a real,
    // deliberate strengthening beyond the local engine's current behavior.
    const { data: accountState, error: accountErr } = await admin
      .from('account_state')
      .select('unallocated_capital')
      .eq('client_id', clientId)
      .maybeSingle();
    if (accountErr) return jsonResponse({ error: accountErr.message }, 500);
    const currentUnallocated = accountState ? accountState.unallocated_capital : 0;

    if (request.requested_amount > currentUnallocated + 1e-9) {
      return jsonResponse({
        error: 'Cannot approve allocation request ' + requestId + ': only ' + currentUnallocated +
          ' unallocated capital remains, but ' + request.requested_amount + ' was requested to approve.'
      }, 409);
    }

    // The real internal call — execute-buy's own deployed code, not a copy of its logic.
    // The original caller's JWT is forwarded verbatim so execute-buy's own independent
    // admin check passes identically, with no service-role bypass needed.
    const executeBuyResponse = await fetch(supabaseUrl + '/functions/v1/execute-buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': 'Bearer ' + jwt
      },
      body: JSON.stringify({ clientId: clientId, productId: request.product_id, dollarAmount: request.requested_amount })
    });
    const executeBuyResult = await executeBuyResponse.json();
    if (!executeBuyResponse.ok) {
      return jsonResponse({ error: 'execute-buy failed: ' + (executeBuyResult && executeBuyResult.error) }, executeBuyResponse.status);
    }

    const { data: updatedRequest, error: updateErr } = await admin
      .from('allocation_requests')
      .update({ status: 'approved', resolved_at: new Date().toISOString(), transaction_id: executeBuyResult.id, resolved_by: adminId, resolved_by_email: adminEmail })
      .eq('id', requestId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    // Backend Migration Phase D — Stage 2 (2026-09-06): best-effort, genuinely awaited — see
    // approve-client-application/index.ts's own identical comment for the full "why."
    const [{ data: clientRow }, { data: productRow }] = await Promise.all([
      admin.from('clients').select('name, email').eq('id', clientId).maybeSingle(),
      admin.from('products').select('name').eq('id', request.product_id).maybeSingle()
    ]);
    if (clientRow) {
      await sendEmail(admin, {
        to: clientRow.email,
        subject: 'Your Marketswave allocation request has been approved',
        html: '<p>Hi ' + clientRow.name + ',</p><p>Your allocation of $' + request.requested_amount.toLocaleString() + ' into ' +
          (productRow ? productRow.name : request.product_id) + ' has been approved and executed.</p>',
        relatedEntityType: 'allocation_request',
        relatedEntityId: requestId
      });
    }

    return jsonResponse(toClientShape(updatedRequest), 200);
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
    resolvedBy: row.resolved_by,
    resolvedByEmail: row.resolved_by_email,
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
