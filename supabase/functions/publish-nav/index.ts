// Backend Migration Phase D — NAV feature (2026-09-06).
//
// Real PM-published NAV for Private Equity / Real Assets products — the ONE deliberate,
// explicitly-labeled override edit-product/index.ts's own header comment already
// anticipated ("a separate, deliberate, clearly-labeled 'override' capability if that ever
// becomes a real operational need, not silently folded into this path"). This is that path,
// scoped narrowly: it can only ever move a product's unit_price, and only for a product in
// one of the two carved-out asset classes — never Stocks & ETFs/Crypto/Cash, which keep
// moving exclusively via the simulated tick, and never through edit-product's own general
// form (unitPrice remains absent from PRODUCT_EDITABLE_FIELDS, untouched by this feature).
//
// Every real publication is recorded in nav_publications — product_id, the new price, real
// PM attribution (published_by/published_by_email, captured from the caller's own already-
// verified JWT claims, mirroring every other admin-write function in this project), when it
// was actually clicked (published_at) versus the real-world date it's effective as of
// (effective_date — may differ, e.g. publishing today a valuation effective as of quarter-
// end), and an optional rationale note.
//
// products.last_tick_date is updated to the same effective_date on every publish — this
// column already means "the last date this product's price genuinely changed" for the
// simulated-tick classes; reusing it here (rather than introducing a second, parallel
// "last valued" column) keeps that meaning consistent across both mechanisms, and is exactly
// what powers asset-performance.html's own "Last valued: [date]" client-facing indicator
// (see that file for the client-side half of this feature) with no extra join needed.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — never getUser(), same pattern as every
// other admin-only function in this project.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { round2 } from '../_shared/portfolio-engine.ts';

const ELIGIBLE_ASSET_CLASSES = ['Private Equity', 'Real Assets'];

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

    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json();
    const productId = body && body.productId;
    // ★ Product catalog — live pricing, part 1 (2026-09-11): TWO modes. An appraisal arrives
    // as "up 4.2%", so a PM may enter the percentage and let the system compute the price
    // (the default in the UI), or enter the unit price directly. Exactly one of the two.
    const changePercent = body && body.changePercent;
    let newUnitPrice = body && body.newUnitPrice;
    const hasPct = typeof changePercent === 'number' && isFinite(changePercent);
    const hasPrice = typeof newUnitPrice === 'number' && isFinite(newUnitPrice);
    if (hasPct && hasPrice) return jsonResponse({ error: 'Give either changePercent or newUnitPrice, not both.' }, 400);
    if (hasPct && changePercent <= -100) return jsonResponse({ error: 'changePercent must be greater than -100.' }, 400);
    const note = body && typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const effectiveDate = body && typeof body.effectiveDate === 'string' && body.effectiveDate
      ? body.effectiveDate
      : new Date().toISOString().slice(0, 10);

    if (!productId) return jsonResponse({ error: 'productId is required.' }, 400);
    if (!hasPct && !hasPrice) {
      return jsonResponse({ error: 'newUnitPrice must be a positive number, or give changePercent.' }, 400);
    }
    if (hasPrice && newUnitPrice <= 0) {
      return jsonResponse({ error: 'newUnitPrice must be a positive number.' }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return jsonResponse({ error: 'effectiveDate must be a YYYY-MM-DD date string.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: product, error: fetchErr } = await admin.from('products').select('*').eq('id', productId).maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!product) return jsonResponse({ error: 'Unknown product: ' + productId + '.' }, 404);

    if (product.pricing_model === 'market') {
      return jsonResponse({ error: product.name + ' is market-priced (' + product.ticker + ') — its price is the market\'s and cannot be published by hand. If a PM needs to control returns, that is what Private Equity and Real Assets are for.' }, 400);
    }
    // Percentage mode: the previous price is the one on the row RIGHT NOW, so the computed
    // figure is against the same value the impact table was built from.
    const previousUnitPrice = Number(product.unit_price);
    if (hasPct) newUnitPrice = round2(previousUnitPrice * (1 + changePercent / 100));
    if (!(newUnitPrice > 0)) return jsonResponse({ error: 'The computed unit price must be positive.' }, 400);
    const effectivePct = Math.round(((newUnitPrice - previousUnitPrice) / previousUnitPrice) * 10000) / 100;
    if (ELIGIBLE_ASSET_CLASSES.indexOf(product.asset_class) === -1) {
      return jsonResponse({
        error: 'Real NAV publication only applies to Private Equity / Real Assets products. ' +
          product.name + ' is ' + product.asset_class + ' — its price moves via the simulated returns engine, never a manual publish.'
      }, 400);
    }

    const { data: publication, error: insertErr } = await admin
      .from('nav_publications')
      .insert({
        product_id: productId,
        published_unit_price: newUnitPrice,
        published_by: adminId,
        published_by_email: adminEmail,
        effective_date: effectiveDate,
        note: note
      })
      .select()
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    const { data: updatedProduct, error: updateErr } = await admin
      .from('products')
      .update({ unit_price: newUnitPrice, last_tick_date: effectiveDate, price_change_percent: effectivePct, price_as_of: new Date().toISOString() })
      .eq('id', productId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    return jsonResponse({
      product: {
        id: updatedProduct.id,
        name: updatedProduct.name,
        assetClass: updatedProduct.asset_class,
        unitPrice: updatedProduct.unit_price,
        previousUnitPrice: previousUnitPrice,
        changePercent: effectivePct,
        lastTickDate: updatedProduct.last_tick_date
      },
      publication: {
        id: publication.id,
        productId: publication.product_id,
        publishedUnitPrice: publication.published_unit_price,
        publishedBy: publication.published_by,
        publishedByEmail: publication.published_by_email,
        publishedAt: publication.published_at,
        effectiveDate: publication.effective_date,
        note: publication.note
      }
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
