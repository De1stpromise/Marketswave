// Backend Migration Phase B — Stage 3 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's approveSellRequest(clientId, requestId) —
// read that function's real source in full before writing this, not reinvented.
//
// Same "real internal HTTP call, not a parallel reimplementation" design as
// approve-allocation/index.ts — see that file's own header for the full mechanism (forwards
// the original caller's own verified JWT to the already-deployed execute-sell Edge Function,
// so execute-sell's own independent admin check passes identically, with execute-sell's
// settlement/cost-basis logic running in exactly one file regardless of entry point).
//
// UNLIKE approve-allocation, this re-validation is a FAITHFUL PORT, not a new strengthening:
// the real local approveSellRequest() ALREADY re-validates against the client's CURRENT
// held units before calling executeSell() — "units could have shrunk since the request was
// made if another sell request on the same holding was approved in between," per that
// function's own comment. Ported here exactly: re-validates against the current holdings
// row (treating a missing/deleted holdings row as 0 units — the same zero-holdings default
// used throughout this stage), and only then calls execute-sell.
//
// AUTHORIZATION: admin-only, via getClaims(jwt).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';

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
      .from('sell_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown sell request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'Sell request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    const clientId = request.client_id;

    // Re-validates against the CURRENT holding before executing — a faithful port, see this
    // file's own header. A holding fully sold in between (deleted by execute-sell) is
    // correctly treated as 0 units, same as the local engine's own `holding ? holding.units : 0`.
    const { data: holding, error: holdingErr } = await admin
      .from('holdings')
      .select('units')
      .eq('client_id', clientId)
      .eq('product_id', request.product_id)
      .maybeSingle();
    if (holdingErr) return jsonResponse({ error: holdingErr.message }, 500);
    const currentUnits = holding ? holding.units : 0;

    if (request.units_to_sell > currentUnits + 1e-9) {
      return jsonResponse({
        error: 'Cannot approve sell request ' + requestId + ': only ' + currentUnits +
          ' units remain held, but ' + request.units_to_sell + ' were requested.'
      }, 409);
    }

    // The real internal call — execute-sell's own deployed code, not a copy of its logic.
    const executeSellResponse = await fetch(supabaseUrl + '/functions/v1/execute-sell', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': 'Bearer ' + jwt
      },
      body: JSON.stringify({ clientId: clientId, productId: request.product_id, unitsToSell: request.units_to_sell })
    });
    const executeSellResult = await executeSellResponse.json();
    if (!executeSellResponse.ok) {
      return jsonResponse({ error: 'execute-sell failed: ' + (executeSellResult && executeSellResult.error) }, executeSellResponse.status);
    }

    const { data: updatedRequest, error: updateErr } = await admin
      .from('sell_requests')
      .update({ status: 'approved', resolved_at: new Date().toISOString(), transaction_id: executeSellResult.id, resolved_by: adminId, resolved_by_email: adminEmail })
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
      const { html, text } = renderEmail({
        heading: 'Your sell request has been approved',
        introParagraphs: ['Hi ' + clientRow.name + ', your request to sell units of this holding has been reviewed and executed.'],
        detailRows: [
          { label: 'Product', value: productRow ? productRow.name : request.product_id },
          { label: 'Units sold', value: String(request.units_to_sell) },
          { label: 'Reference', value: executeSellResult.id }
        ],
        cta: { text: 'View your portfolio', href: siteLink('dashboard.html') },
        footerType: 'investment'
      });
      await sendEmail(admin, {
        to: clientRow.email,
        subject: 'Your Marketswave sell request has been approved',
        html,
        text,
        relatedEntityType: 'sell_request',
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
    unitsToSell: row.units_to_sell,
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
