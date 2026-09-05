// Products Catalog Fix (2026-09-03).
//
// Real Edge Function port of engine-core.js's editProduct(id, patch) — read that function's
// real source in full before writing this, not reinvented. Validation and the editable-field
// allowlist both live in ../_shared/product-validation.ts, shared with add-product so the two
// functions can never drift apart.
//
// JUDGMENT CALL, re-confirmed still true by reading the real local source before porting it,
// per instruction — not assumed carried over from an earlier investigation: unitPrice edits
// are blocked here entirely (absent from PRODUCT_EDITABLE_FIELDS) — the returns engine's own
// deterministic tick mechanic (settleProduct(), Phase B Stage 1's own settleAllProducts()) is
// the only thing that should ever move a product's price; a manual admin overwrite through
// this general edit path could silently corrupt every client's unrealized-return math for
// that product. Same real gap the local engine already flags and leaves open: there is no way
// to correct a data-entry typo in a product's STARTING price after add-product has already
// run — a separate, deliberate, clearly-labeled "override" capability if that ever becomes a
// real operational need, not silently folded into this path.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — never getUser(), same pattern as every
// other admin-only function in this project.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { validateProductFields, toProductClientShape, PRODUCT_EDITABLE_FIELDS } from '../_shared/product-validation.ts';

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
    const id = body && body.id;
    const patch = (body && body.patch) || {};
    if (!id) return jsonResponse({ error: 'id is required.' }, 400);

    const patchKeys = Object.keys(patch);
    const disallowed = patchKeys.filter(function (k) { return PRODUCT_EDITABLE_FIELDS.indexOf(k) === -1; });
    if (disallowed.length > 0) {
      return jsonResponse({
        error: 'editProduct() cannot change: ' + disallowed.join(', ') + '. unitPrice moves only via the returns engine\'s own tick mechanic, never a manual override from this form; id/createdAt/lastTickDate/inceptionUnitPrice are immutable once a product exists.'
      }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: existing, error: fetchErr } = await admin.from('products').select('*').eq('id', id).maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!existing) return jsonResponse({ error: 'Unknown product: ' + id + '.' }, 404);

    // Validates the MERGED existing+patch object — a partial patch (e.g. only
    // minimumInvestment changing) still gets full-object validation against a real,
    // already-valid product rather than false-failing on fields the caller didn't touch,
    // mirroring the local editProduct()'s own exact behavior.
    const merged = {
      name: 'name' in patch ? patch.name : existing.name,
      assetClass: 'assetClass' in patch ? patch.assetClass : existing.asset_class,
      investmentType: 'investmentType' in patch ? patch.investmentType : existing.investment_type,
      riskTier: 'riskTier' in patch ? patch.riskTier : existing.risk_tier,
      minimumInvestment: 'minimumInvestment' in patch ? patch.minimumInvestment : existing.minimum_investment,
      description: 'description' in patch ? patch.description : existing.description,
      extendedDescription: 'extendedDescription' in patch ? patch.extendedDescription : existing.extended_description,
      logoUrl: 'logoUrl' in patch ? patch.logoUrl : existing.logo_url
    };
    const validationError = validateProductFields(merged, false);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    const updateRow: Record<string, unknown> = { updated_by: adminId, updated_by_email: adminEmail };
    if ('name' in patch) updateRow.name = String(patch.name).trim();
    if ('assetClass' in patch) updateRow.asset_class = patch.assetClass;
    if ('investmentType' in patch) updateRow.investment_type = String(patch.investmentType).trim();
    if ('riskTier' in patch) updateRow.risk_tier = patch.riskTier;
    if ('minimumInvestment' in patch) updateRow.minimum_investment = patch.minimumInvestment;
    if ('description' in patch) updateRow.description = typeof patch.description === 'string' ? patch.description.trim() : patch.description;
    if ('extendedDescription' in patch) updateRow.extended_description = typeof patch.extendedDescription === 'string' ? patch.extendedDescription.trim() : patch.extendedDescription;
    if ('logoUrl' in patch) updateRow.logo_url = typeof patch.logoUrl === 'string' ? patch.logoUrl.trim() : patch.logoUrl;

    const { data: updated, error: updateErr } = await admin.from('products').update(updateRow).eq('id', id).select().single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    return jsonResponse(toProductClientShape(updated), 200);
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
