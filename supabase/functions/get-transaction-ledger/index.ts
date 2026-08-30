// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's getTransactionLedger() — same self-or-admin
// shape as get-account-state/get-holdings. Does NOT settle products first (unlike those
// two) — the ledger is a historical record of already-executed transactions, each already
// stamped with the unit price at the moment it executed; re-settling products has no effect
// on rows that already exist, only on future ones, so there is nothing here for a settle
// pass to usefully change before reading.
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
    const callerId = claimsData.claims.sub as string;
    const isAdmin = claimsData.claims.app_metadata?.is_admin === true;

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const targetClientId = (body && body.clientId) || callerId;

    if (targetClientId !== callerId && !isAdmin) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: transactions, error } = await admin
      .from('transactions')
      .select('*')
      .eq('client_id', targetClientId)
      .order('created_at', { ascending: false });
    if (error) return jsonResponse({ error: error.message }, 500);

    const shaped = (transactions || []).map((t: any) => ({
      id: t.id,
      productId: t.product_id,
      type: t.type,
      units: t.units,
      price: t.price,
      totalValue: t.total_value,
      realizedReturn: t.realized_return,
      status: t.status,
      createdAt: t.created_at
    }));

    return jsonResponse(shaped, 200);
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
