// Backend Migration Phase B — Stage 4 (2026-09-02).
//
// Real Edge Function port of engine-core.js's requestHYSWithdrawal(clientId, pocketId, method,
// destinationDetails) — read that function's real source in full before writing this, not
// reinvented. Preserves exactly: the pocket must exist and belong to the caller, must not
// already be withdrawn, a locked-term Fixed Deposit still 'active' (not yet matured) cannot be
// withdrawn early, and only one pending withdrawal request may exist per pocket at a time.
// forfeit/receiveAmount are computed here, once, from the REAL stored pocket via the shared
// computeHysWithdrawalAmount() — never trusted from the caller.
//
// CLIENT-CALLABLE, SELF ONLY — clientId derived from the caller's own verified JWT
// (getClaims(jwt).sub), never trusted from the request body; the pocket lookup is filtered by
// that same clientId, so a caller can never even discover whether a pocketId belonging to
// someone else exists.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { computeHysWithdrawalAmount, resolveEffectivePocketStatus } from '../_shared/hys-engine.ts';

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
    const pocketId = body && body.pocketId;
    const method = body && body.method;
    const destinationDetails = (body && body.destinationDetails) || null;

    if (!pocketId) return jsonResponse({ error: 'pocketId is required.' }, 400);
    if (method !== 'crypto' && method !== 'bank') {
      return jsonResponse({ error: 'method must be either "crypto" or "bank".' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: pocket, error: pocketErr } = await admin
      .from('hys_pockets')
      .select('*')
      .eq('id', pocketId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (pocketErr) return jsonResponse({ error: pocketErr.message }, 500);
    if (!pocket) return jsonResponse({ error: 'Unknown pocket: ' + pocketId }, 404);
    if (pocket.status === 'withdrawn') {
      return jsonResponse({ error: 'Pocket ' + pocketId + ' has already been withdrawn.' }, 409);
    }

    // ★ Backend Requirements Register row 124 (2026-09-03): closes the real gap disclosed in UI
    // Wiring Stage 4 / Phase B Stage 4 — this is the one real money/access decision that reads a
    // pocket's status, so it's where the real maturity transition is resolved and self-healed,
    // lazily, on touch (see resolveEffectivePocketStatus()'s own header comment for the full
    // reasoning). Applied BEFORE the lockout check and BEFORE computeHysWithdrawalAmount() below,
    // so both correctly see a genuinely matured pocket regardless of whether its stored status
    // had already caught up.
    const effectiveStatus = resolveEffectivePocketStatus(pocket);
    if (effectiveStatus !== pocket.status) {
      const { error: healErr } = await admin.from('hys_pockets').update({ status: effectiveStatus }).eq('id', pocketId);
      if (healErr) return jsonResponse({ error: healErr.message }, 500);
      pocket.status = effectiveStatus;
    }

    // Mirrors the local engine's own button-visibility rule, now enforced server-side too:
    // a locked-term pocket still active shows no Withdraw path at all.
    if (pocket.pocket_type === 'fixed' && pocket.term_mode === 'locked' && pocket.status === 'active') {
      return jsonResponse({ error: 'Locked-term deposits cannot be withdrawn before maturity.' }, 409);
    }

    const { data: existingPending, error: pendingErr } = await admin
      .from('hys_withdrawal_requests')
      .select('id')
      .eq('pocket_id', pocketId)
      .eq('status', 'pending')
      .maybeSingle();
    if (pendingErr) return jsonResponse({ error: pendingErr.message }, 500);
    if (existingPending) {
      return jsonResponse({ error: 'A withdrawal request for this pocket is already pending.' }, 409);
    }

    const forfeit = pocket.pocket_type === 'fixed' && pocket.status === 'active';
    const receiveAmount = computeHysWithdrawalAmount(pocket);

    const { data: request, error: insertErr } = await admin
      .from('hys_withdrawal_requests')
      .insert({
        client_id: clientId,
        pocket_id: pocketId,
        pocket_type: pocket.pocket_type,
        term_label: pocket.term_label,
        forfeit: forfeit,
        receive_amount: receiveAmount,
        method: method,
        destination_details: destinationDetails,
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
