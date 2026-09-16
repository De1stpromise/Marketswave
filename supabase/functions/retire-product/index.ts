// ★ RETIRE / REINSTATE A PRODUCT — never delete one (2026-09-16, PM tool revamp part 6).
//
// ADMIN-ONLY, getClaims(jwt), never getUser() — see get-product-catalog's own header.
//
// ★ WHAT RETIREMENT ACTUALLY DOES, and why it is a status rather than a delete:
//   * The product stays in the catalogue and stays priced. Its holders keep their positions
//     and their value keeps moving with the market (or with a published NAV).
//   * A holder can still SELL. execute-sell is deliberately NOT gated on this — retiring a
//     product must never trap capital.
//   * No NEW allocation is accepted. Enforced in request-allocation (a client cannot ask) AND
//     in execute-buy (an already-pending request cannot be approved into it either). The UI
//     hiding the control is not the enforcement; those two checks are.
//
// A reason is required in both directions, mirroring the reason-required discipline every
// other consequential admin action in this tool already carries (Reset Password / Reset 2FA).
// Attribution is recorded (retired_by / retired_by_email) and, per part 3's rule, never
// rendered back to a PM while the tool has a single shared identity.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    if (claimsData.claims.app_metadata?.is_admin !== true) return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);

    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json().catch(() => ({}));
    const productId = body && body.productId;
    const retired = body && body.retired;
    const reason = body && typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!productId || typeof productId !== 'string') return jsonResponse({ error: 'A productId is required.' }, 400);
    if (typeof retired !== 'boolean') return jsonResponse({ error: 'retired must be true or false.' }, 400);
    if (!reason) return jsonResponse({ error: 'A reason is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: product, error: fetchErr } = await admin
      .from('products').select('*').eq('id', productId).maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!product) return jsonResponse({ error: 'Unknown product: ' + productId + '.' }, 404);

    const already = (product.status || 'active') === (retired ? 'retired' : 'active');
    if (already) {
      return jsonResponse({
        error: retired
          ? product.name + ' is already retired.'
          : product.name + ' is already active.'
      }, 409);
    }

    // Cash is the Unallocated bucket itself, not something a client allocates into — retiring
    // it would be meaningless and would misrepresent the engine's own reserved class.
    if (retired && product.asset_class === 'Unallocated / Cash') {
      return jsonResponse({ error: 'Cash is the Unallocated bucket itself and cannot be retired.' }, 400);
    }

    const patch = retired
      ? { status: 'retired', retired_at: new Date().toISOString(), retired_by: adminId, retired_by_email: adminEmail, retired_reason: reason }
      : { status: 'active', retired_at: null, retired_by: adminId, retired_by_email: adminEmail, retired_reason: reason };

    const { data: updated, error: updateErr } = await admin
      .from('products').update(patch).eq('id', productId).select().single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    // Reported back so the PM sees the real consequence of what they just did rather than a
    // bare confirmation: these clients keep their positions and can still sell.
    const { data: holdings, error: hErr } = await admin
      .from('holdings').select('client_id').eq('product_id', productId);
    if (hErr) return jsonResponse({ error: 'Could not read holdings: ' + hErr.message }, 500);

    return jsonResponse({
      product: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        retiredAt: updated.retired_at,
        retiredReason: updated.retired_reason
      },
      holderCount: (holdings || []).length
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
