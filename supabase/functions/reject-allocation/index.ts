// Backend Migration Phase B — Stage 3 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's rejectAllocationRequest(clientId, requestId,
// reason) — read that function's real source in full before writing this, not reinvented.
// Marks a pending allocation request rejected with a reason; moves nothing (no account_state
// or transactions write) — mirrors the local function exactly.
//
// AUTHORIZATION: admin-only, via getClaims(jwt).
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
    const reason = (body && body.reason) || null;
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('allocation_requests')
      .select('status, client_id, product_id, requested_amount')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown allocation request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'Allocation request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    const { data: updatedRequest, error: updateErr } = await admin
      .from('allocation_requests')
      .update({ status: 'rejected', resolved_at: new Date().toISOString(), reason: reason, resolved_by: adminId, resolved_by_email: adminEmail })
      .eq('id', requestId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    // Backend Migration Phase D — Stage 2 (2026-09-06): best-effort, genuinely awaited — see
    // approve-client-application/index.ts's own identical comment for the full "why."
    const [{ data: clientRow }, { data: productRow }] = await Promise.all([
      admin.from('clients').select('name, email').eq('id', request.client_id).maybeSingle(),
      admin.from('products').select('name').eq('id', request.product_id).maybeSingle()
    ]);
    if (clientRow) {
      await sendEmail(admin, {
        to: clientRow.email,
        subject: 'An update on your Marketswave allocation request',
        html: '<p>Hi ' + clientRow.name + ',</p><p>Your allocation request of $' + request.requested_amount.toLocaleString() + ' into ' +
          (productRow ? productRow.name : request.product_id) + ' could not be approved' + (reason ? ': ' + reason : '.') +
          ' Please contact support if you have any questions.</p>',
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
