// Backend Migration Phase B — Stage 1 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's getHoldings() — that function takes no
// clientId locally (it always reads the ambient current client), but this port adds the
// same optional-clientId/self-or-admin shape as get-account-state's own port, for a
// consistent API surface across all 4 read functions and because holdings.RLS already
// supports the identical self-or-admin read. See get-account-state/index.ts's own header
// for the full "why" of settling products first.
//
// ★ PRICE STATUS (2026-09-19, row 251). Each row now also carries the product's pricing
// model, status, as-of time and stale flag, derived by _shared/price-status.ts — the same
// derivation get-returns-summary and get-portfolio-overview use. The array shape is unchanged
// (an array, not an envelope): existing readers ignore the new fields.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { settleAllProducts, recomputeAllocatedCapital } from '../_shared/portfolio-engine.ts';
import { staleAfterMinutes, productPricing } from '../_shared/price-status.ts';

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
    const { data: holdings, error } = await admin.from('holdings').select('*').eq('client_id', targetClientId);
    if (error) return jsonResponse({ error: error.message }, 500);
    // ★ RECOMPUTE UNCONDITIONALLY, INCLUDING TO ZERO (2026-09-16). This was guarded by
    // `if (holdings.length > 0)`, so a client with no holdings kept whatever
    // account_state.allocated_capital last held — a stored aggregate trusted over derived
    // truth, and the same defect already fixed once inside computeTotalPortfolioValue()
    // (register row 235). Same class, three more call sites.
    await recomputeAllocatedCapital(admin, targetClientId, holdings || [], products);

    const staleAfter = await staleAfterMinutes(admin);
    const now = new Date();
    const shaped = (holdings || []).map((h: any) => {
      const product = products.find((p) => p.id === h.product_id);
      const pricing = product ? productPricing(product, staleAfter, now) : null;
      return {
        id: h.id,
        productId: h.product_id,
        units: h.units,
        costBasis: h.cost_basis,
        pricingModel: pricing ? pricing.pricingModel : null,
        priceStatus: pricing ? pricing.priceStatus : null,
        priceAsOf: pricing ? pricing.priceAsOf : null,
        priceStale: pricing ? pricing.priceStale : false,
        priceAgeMinutes: pricing ? pricing.priceAgeMinutes : null
      };
    });

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
