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
import { validateProductFields, toProductClientShape, PRICING_MODELS, APPRAISAL_ASSET_CLASSES, assetClassForSource, validateMaximumInvestment } from '../_shared/product-validation.ts';
import { validateTicker, normalizeSymbol } from '../_shared/symbol-catalog.ts';
import { lookupStockQuote, fetchCryptoQuotes, RateLimitedError } from '../_shared/market-providers.ts';
import { refreshSymbols } from '../_shared/market-refresh.ts';

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

    // ★ Product catalog — live pricing, part 1 (2026-09-11): the pricing model is chosen
    // FIRST and is immutable afterwards (edit-product refuses it). Two models a PM can
    // choose; the legacy 'simulated' tick is not creatable.
    const pricingModel = body && body.pricingModel;
    if (PRICING_MODELS.indexOf(pricingModel) === -1) {
      return jsonResponse({ error: 'pricingModel must be "market" (priced from a real symbol) or "appraisal" (valued by published NAV). It cannot be changed after creation.' }, 400);
    }

    let marketFirstPrice: { price: number; changePercent: number | null } | null = null;
    let marketSymbol: string | null = null;
    let marketSource: 'finnhub' | 'coingecko' | null = null;
    let marketProviderId: string | null = null;

    if (pricingModel === 'market') {
      // Asset class is DERIVED from the symbol's provider — the request's own assetClass,
      // if any, is ignored rather than trusted, so BTC cannot be filed under Real Assets.
      marketSource = body.source === 'finnhub' || body.source === 'coingecko' ? body.source : null;
      if (!marketSource) return jsonResponse({ error: 'A market-priced product needs a symbol chosen from the search (source must be finnhub or coingecko).' }, 400);
      const tickerError = validateTicker(body.symbol);
      if (tickerError || !body.symbol) return jsonResponse({ error: tickerError || 'symbol is required for a market-priced product.' }, 400);
      marketSymbol = normalizeSymbol(body.symbol);
      body.assetClass = assetClassForSource(marketSource);
      if (marketSource === 'coingecko') {
        if (typeof body.providerId !== 'string' || !body.providerId) return jsonResponse({ error: 'providerId (the CoinGecko id) is required for a crypto product.' }, 400);
        marketProviderId = body.providerId;
        // The FIRST price is taken live, right now: a product must never be created with a
        // PM-typed placeholder that the next refresh would then "correct".
        const quotes = await fetchCryptoQuotes([marketProviderId]);
        const coin = quotes[marketProviderId];
        if (!coin) return jsonResponse({ error: 'CoinGecko returned no price for ' + marketProviderId + ' — the product was not created.' }, 400);
        marketFirstPrice = coin;
      } else {
        const quote = await lookupStockQuote(marketSymbol);
        if (!quote) return jsonResponse({ error: 'Finnhub returned no price for ' + marketSymbol + ' (an unknown symbol comes back as a zero, which is refused) — the product was not created.' }, 400);
        marketFirstPrice = quote;
      }
      body.unitPrice = marketFirstPrice.price;
    } else {
      if (APPRAISAL_ASSET_CLASSES.indexOf(body.assetClass) === -1) {
        return jsonResponse({ error: 'A product valued by appraisal must be Private Equity or Real Assets. Stocks & ETFs and Crypto are market-priced.' }, 400);
      }
      if (body.symbol || body.ticker) return jsonResponse({ error: 'A product valued by appraisal does not carry a market symbol.' }, 400);
    }

    const validationError = validateProductFields(body, true);
    if (validationError) return jsonResponse({ error: validationError }, 400);
    const maxError = validateMaximumInvestment(body);
    if (maxError) return jsonResponse({ error: maxError }, 400);

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
      created_by_email: adminEmail,
      pricing_model: pricingModel
    };
    if (typeof body.maximumInvestment === 'number') insertRow.maximum_investment = body.maximumInvestment;
    if (pricingModel === 'market') {
      insertRow.ticker = marketSymbol;
      insertRow.price_source = marketSource;
      insertRow.provider_id = marketProviderId;
      insertRow.price_as_of = new Date().toISOString();
      insertRow.price_change_percent = marketFirstPrice ? marketFirstPrice.changePercent : null;
      insertRow.unit_price = marketFirstPrice ? marketFirstPrice.price : unitPrice; // full precision, not round2'd: the market's own figure
      insertRow.inception_unit_price = insertRow.unit_price;
    }
    if (typeof body.description === 'string' && body.description.trim()) insertRow.description = body.description.trim();
    if (typeof body.extendedDescription === 'string' && body.extendedDescription.trim()) insertRow.extended_description = body.extendedDescription.trim();
    if (typeof body.logoUrl === 'string' && body.logoUrl.trim()) insertRow.logo_url = body.logoUrl.trim();

    const { data: created, error: insertErr } = await admin.from('products').insert(insertRow).select().single();
    if (insertErr) {
      if ((insertErr.code || '') === '23505') {
        return jsonResponse({ error: 'Another product already uses that ticker. A symbol can map to only one catalog product.' }, 409);
      }
      return jsonResponse({ error: insertErr.message }, 500);
    }

    // Seed the cache row for the new symbol too (best-effort), so the very next read-through
    // and the scheduled refresh both already know it — mirrors get-watchlist's own top-up.
    if (pricingModel === 'market' && marketSymbol && marketSource) {
      try {
        await refreshSymbols(admin, [{ symbol: marketSymbol, name: String(body.name).trim(), source: marketSource, provider_id: marketProviderId, asset_type: marketSource === 'coingecko' ? 'crypto' : 'stock' }]);
      } catch (_e) { /* the product already carries its real first price; the scheduler catches up */ }
    }

    return jsonResponse(toProductClientShape(created), 200);
  } catch (err) {
    if (err instanceof RateLimitedError) return jsonResponse({ error: err.message + ' The product was not created.' }, 503);
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
