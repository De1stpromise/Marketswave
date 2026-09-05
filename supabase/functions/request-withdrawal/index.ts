// Backend Migration Phase B — Stage 2 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's requestWithdrawal(clientId, method, amount,
// currency, destinationDetails) — read that function's real source in full before writing
// this, not reinvented. Same "request now, execute later" discipline as request-deposit:
// creates a pending row only. The one real validation requestWithdrawal() itself performs
// beyond method/amount/currency shape checks: the requested amount must not exceed the
// client's CURRENT unallocated_capital at request time — "can't withdraw money that isn't
// sitting liquid," ported verbatim, including the exact 1e-9 floating-point slack the local
// engine already uses.
//
// CLIENT-CALLABLE, SELF ONLY — same reasoning as request-deposit/index.ts: clientId is
// derived from the caller's own verified JWT (getClaims(jwt).sub), never trusted from the
// request body.
//
// Zero-balance default on a missing account_state row: mirrors readAccountStateForClient()'s
// own real behavior (defaults to unallocatedCapital: 0 rather than throwing "not found") —
// see this stage's migration file header for the full "why." A client with no account_state
// row yet correctly gets rejected for any amount > 0, exactly as a real $0 balance would.
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
    const method = body && body.method;
    const amount = body && body.amount;
    const currency = body && body.currency;
    const destinationDetails = (body && body.destinationDetails) || null;

    // Same validation as requestWithdrawal() itself, byte-for-byte.
    if (method !== 'crypto' && method !== 'bank') {
      return jsonResponse({ error: 'method must be either "crypto" or "bank".' }, 400);
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return jsonResponse({ error: 'Withdrawal amount must be a positive number.' }, 400);
    }
    if (!currency) {
      return jsonResponse({ error: 'currency is required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: accountState, error: accountErr } = await admin
      .from('account_state')
      .select('unallocated_capital')
      .eq('client_id', clientId)
      .maybeSingle();
    if (accountErr) return jsonResponse({ error: accountErr.message }, 500);
    const unallocatedCapital = accountState ? accountState.unallocated_capital : 0;

    if (amount > unallocatedCapital + 1e-9) {
      return jsonResponse({ error: 'Withdrawal amount exceeds current unallocated capital.' }, 409);
    }

    const { data: request, error: insertErr } = await admin
      .from('withdrawal_requests')
      .insert({
        client_id: clientId,
        method: method,
        requested_amount: round2(amount),
        currency: currency,
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
    method: row.method,
    requestedAmount: row.requested_amount,
    currency: row.currency,
    destinationDetails: row.destination_details,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
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
