// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's getTotalPortfolioValue(clientId?) — "the ONLY
// place Total Portfolio Value should ever be computed," per that function's own comment. This
// port honors that rule server-side too: unallocatedCapital + allocatedCapital + assetReturns,
// nothing else, computed here and nowhere else in this Edge Function surface. Settles
// products first — see get-account-state/index.ts's own header for why.
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
    if (!state) return jsonResponse({ totalPortfolioValue: 0 }, 200);

    const total = state.unallocated_capital + state.allocated_capital + state.asset_returns;
    return jsonResponse({ totalPortfolioValue: total }, 200);
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
