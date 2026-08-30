// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's getAccountState(clientId?) — same optional-
// clientId shape: omitted (or equal to the caller's own uid) reads the CALLER'S OWN account
// state (self-read, needs no privilege beyond being signed in — RLS's own "self or admin"
// SELECT policy on account_state would allow the exact same read via a direct table query;
// this Edge Function exists to mirror the local engine's named function-based API surface,
// not because RLS alone couldn't already do this). An explicit clientId for someone OTHER
// than the caller requires the real is_admin JWT claim — mirrors getAccountState(clientId?)'s
// own "arbitrary client, on demand, no session switch" admin use case from
// admin-clients.html, now genuinely privilege-checked server-side instead of just a client-
// side optional parameter.
//
// Settles every product first (settleAllProducts()) and recomputes the target client's
// allocated_capital before reading — mirrors the local engine's own "settleAllProducts() runs
// once per engine load, unconditionally, before any read" discipline (see
// _shared/portfolio-engine.ts's own header for why this is a per-Edge-Function-call
// adaptation of that same rule, not a different rule).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { settleAllProducts, recomputeAllocatedCapital } from '../_shared/portfolio-engine.ts';

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

    const products = await settleAllProducts(admin);
    const { data: holdings } = await admin.from('holdings').select('product_id, units').eq('client_id', targetClientId);
    if (holdings && holdings.length > 0) {
      await recomputeAllocatedCapital(admin, targetClientId, holdings, products);
    }

    const { data: state, error } = await admin.from('account_state').select('*').eq('client_id', targetClientId).maybeSingle();
    if (error) return jsonResponse({ error: error.message }, 500);
    if (!state) return jsonResponse({ error: 'No account state found for client ' + targetClientId }, 404);

    return jsonResponse({
      clientId: state.client_id,
      unallocatedCapital: state.unallocated_capital,
      allocatedCapital: state.allocated_capital,
      assetReturns: state.asset_returns
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
