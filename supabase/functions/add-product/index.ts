// Products Catalog Fix (2026-09-03).
//
// Real Edge Function port of engine-core.js's addProduct(product) — read that function's
// real source (and its shared validateProductFields()) in full before writing this, not
// reinvented. Validation lives in ../_shared/product-validation.ts, shared with
// edit-product so the two functions can never drift apart.
//
// ID generation mirrors the real `products` table's own deliberate design choice (Phase B
// Stage 1's migration: "products.id keeps the human-readable PROD-XXXX scheme... since the
// product catalog is seeded once, deliberately, not created under concurrent write pressure
// the way transactions/holdings are") — a scan-and-increment, the same algorithm as the
// local engine's own addProduct(), not gen_random_uuid().
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — never getUser(), same pattern as every
// other admin-only function in this project.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { round2 } from '../_shared/portfolio-engine.ts';
import { validateProductFields, toProductClientShape } from '../_shared/product-validation.ts';
import { validateTicker, normalizeSymbol } from '../_shared/symbol-catalog.ts';

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
    const validationError = validateProductFields(body, true);
    if (validationError) return jsonResponse({ error: validationError }, 400);
    const tickerError = validateTicker(body.ticker);
    if (tickerError) return jsonResponse({ error: tickerError }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Scan-and-increment, matching the local engine's own addProduct() algorithm exactly —
    // safe here because the product catalog is deliberately not created under concurrent
    // write pressure (see this migration's own header for the full "why").
    const { data: existing, error: fetchErr } = await admin.from('products').select('id');
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    let maxNum = 0;
    (existing || []).forEach(function (p: { id: string }) {
      const match = /^PROD-(\d+)$/.exec(p.id);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    });
    const id = 'PROD-' + String(maxNum + 1).padStart(4, '0');
    const today = new Date().toISOString().slice(0, 10);
    const unitPrice = round2(body.unitPrice);

    // Only set a key when a real value is given — keeps a product created without these
    // fields byte-identical in shape to the pre-existing seeded ones, mirroring the local
    // addProduct()'s own "only set the key when a real value is given" comment exactly.
    const insertRow: Record<string, unknown> = {
      id: id,
      name: String(body.name).trim(),
      asset_class: body.assetClass,
      investment_type: String(body.investmentType).trim(),
      risk_tier: body.riskTier,
      minimum_investment: body.minimumInvestment,
      unit_price: unitPrice,
      inception_unit_price: unitPrice,
      created_at: today,
      last_tick_date: today,
      created_by: adminId,
      created_by_email: adminEmail
    };
    if (typeof body.description === 'string' && body.description.trim()) insertRow.description = body.description.trim();
    if (typeof body.extendedDescription === 'string' && body.extendedDescription.trim()) insertRow.extended_description = body.extendedDescription.trim();
    if (typeof body.logoUrl === 'string' && body.logoUrl.trim()) insertRow.logo_url = body.logoUrl.trim();
    // ticker (2026-09-11): stored uppercase, matching the unique index on upper(ticker) —
    // a product entered as 'eth' and a watchlist row stored as 'ETH' must be one mapping.
    if (typeof body.ticker === 'string' && body.ticker.trim()) insertRow.ticker = normalizeSymbol(body.ticker);

    const { data: created, error: insertErr } = await admin.from('products').insert(insertRow).select().single();
    if (insertErr) {
      if ((insertErr.code || '') === '23505') {
        return jsonResponse({ error: 'Another product already uses that ticker. A symbol can map to only one catalog product.' }, 409);
      }
      return jsonResponse({ error: insertErr.message }, 500);
    }

    return jsonResponse(toProductClientShape(created), 200);
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
