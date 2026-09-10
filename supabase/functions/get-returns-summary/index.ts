// Returns Display (2026-09-09) — the one server-side source for every returns figure the
// dashboard's return card and asset-performance.html's holdings table show.
//
// WHY THIS EXISTS. The realised-only figure the dashboard used to show alone is CORRECT —
// realised-only is the locked accounting rule and nothing here changes it. What was wrong is
// that one number was carrying a job it cannot do: a client holding well-performing positions
// for two years genuinely saw $0. The fix is disclosure, not recalculation, so this function
// adds the unrealised side ALONGSIDE the realised one and never blends them into a single
// undifferentiated "returns" figure.
//
// WHY SERVER-SIDE. Unrealised was previously computed in the browser on both
// asset-performance.html and asset-collection.html (a deliberate, disclosed call at the time —
// UI Wiring Stage 2, row 121). Money figures shown to a client should not be assembled
// client-side, so asset-performance.html's copy moved here and its local port was deleted.
//
// STILL OPEN, stated rather than implied closed: asset-collection.html keeps its own
// client-side getUnrealizedReturnPercent() for the per-product card badge. That page is
// neither the dashboard cards nor the holdings table, so wiring it was outside this task's
// scope — but it is the last remaining place unrealised is computed in the browser, and it
// should read this endpoint when that page is next touched.
//
// THE MATHS IS THE ENGINE'S OWN, NOT A REINTERPRETATION. Confirmed by reading
// engine-core.js:3120-3137 directly:
//   unrealized(p)        = round2(units * unitPrice - costBasis)
//   unrealizedPercent(p) = costBasis === 0 ? 0 : round2((unrealized / costBasis) * 100)
//   unrealized total     = round2(SUM OF THE ALREADY-ROUNDED per-position values)
// That last detail is easy to get subtly wrong by summing raw values and rounding once at the
// end; it is reproduced exactly, and cross-checked against the real engine in verification.
//
// TOTAL RETURN PERCENTAGE — a disclosed choice, not an engine rule. The engine defines no
// "total return %", so a denominator had to be picked. This uses the cost basis of currently
// held positions: the same denominator the per-position and per-class percentages already
// use, so every percentage on both screens means the same thing. The known imperfection,
// stated rather than hidden: realised gains came from positions that are no longer held, so
// their own cost basis is not in that denominator. No available figure fixes this — the
// engine does not retain the cost basis of closed positions.
//
// ★ THAT IMPERFECTION IS A REAL, TRACKED DEFECT, NOT JUST A CAVEAT — Backend Requirements
// Register row 186. It OVERSTATES performance for any client who has sold: the numerator
// counts gains from closed positions while the denominator has forgotten the capital that
// produced them. $100,000 -> $115,000 across one closed and one open position reports
// +25% instead of +15%. The DOLLAR figures above are unaffected and always correct; only
// `totalPercent` is. No effect for a client who has never sold. Do not 'fix' it here by
// changing the denominator — the missing data is the cost basis of closed positions, which
// requires a schema change and a migration decision; see row 186 before touching this.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  settleAllProducts,
  recomputeAllocatedCapital,
  unitPriceSeries,
  round2
} from '../_shared/portfolio-engine.ts';

const TREND_DAYS = 30;

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

    // Settle first, exactly as every other read function does, so unit prices are current
    // before anything is computed against them.
    const products = await settleAllProducts(admin);
    const { data: holdings, error: hErr } = await admin
      .from('holdings').select('*').eq('client_id', targetClientId);
    if (hErr) return jsonResponse({ error: hErr.message }, 500);
    if (holdings && holdings.length > 0) {
      await recomputeAllocatedCapital(admin, targetClientId, holdings, products);
    }

    const { data: state } = await admin
      .from('account_state').select('*').eq('client_id', targetClientId).maybeSingle();

    // Per-product realised: the real sum of realized_return across this client's own SELL
    // transactions. A position never sold sums to exactly 0 and renders as an em dash.
    const { data: sells } = await admin
      .from('transactions')
      .select('product_id, realized_return')
      .eq('client_id', targetClientId)
      .eq('type', 'SELL');
    const realisedByProduct = new Map<string, number>();
    for (const t of sells || []) {
      realisedByProduct.set(
        t.product_id,
        (realisedByProduct.get(t.product_id) || 0) + (t.realized_return || 0)
      );
    }

    const { data: navs } = await admin
      .from('nav_publications')
      .select('product_id, effective_date, published_unit_price');
    const navsByProduct = new Map<string, any[]>();
    for (const n of navs || []) {
      if (!navsByProduct.has(n.product_id)) navsByProduct.set(n.product_id, []);
      navsByProduct.get(n.product_id)!.push(n);
    }

    const positions = (holdings || []).map((h: any) => {
      const product = products.find((p) => p.id === h.product_id);
      const unitPrice = product ? product.unit_price : 0;
      const currentValue = round2(h.units * unitPrice);
      const unrealized = round2(h.units * unitPrice - h.cost_basis);
      const unrealizedPercent =
        h.cost_basis === 0 ? 0 : round2((unrealized / h.cost_basis) * 100);
      return {
        productId: h.product_id,
        name: product ? product.name : h.product_id,
        assetClass: product ? product.asset_class : null,
        investmentType: product ? product.investment_type : null,
        units: h.units,
        unitPrice: unitPrice,
        costBasis: h.cost_basis,
        currentValue: currentValue,
        unrealized: unrealized,
        unrealizedPercent: unrealizedPercent,
        realized: round2(realisedByProduct.get(h.product_id) || 0),
        trend: product ? unitPriceSeries(product, TREND_DAYS, navsByProduct.get(h.product_id)) : []
      };
    });

    // Sum the ALREADY-ROUNDED per-position values, matching getTotalUnrealizedReturns().
    const unrealized = round2(positions.reduce((s, p) => s + p.unrealized, 0));
    const costBasis = round2(positions.reduce((s, p) => s + p.costBasis, 0));
    const currentValue = round2(positions.reduce((s, p) => s + p.currentValue, 0));

    // Realised total is account_state.asset_returns — the authoritative store the locked
    // rule is written against, not a re-derivation from the ledger.
    const realized = state ? state.asset_returns : 0;

    // realizedHeld is deliberately a DIFFERENT figure from `realized`, not a duplicate.
    // It sums only the positions the client still holds, which is what the holdings table's
    // own totals row must show: a totals row that does not add up to the column above it is
    // a visible arithmetic error to anyone who checks it. The two diverge exactly when a
    // position has been sold in full — its realised gain is real and still counted in
    // `realized`, but it has no row left in that table to sit on.
    const realizedHeld = round2(positions.reduce((s, p) => s + p.realized, 0));
    const total = round2(realized + unrealized);
    const totalPercent = costBasis > 0 ? round2((total / costBasis) * 100) : null;

    const classMap = new Map<string, { costBasis: number; currentValue: number; unrealized: number }>();
    for (const p of positions) {
      if (!p.assetClass) continue;
      const c = classMap.get(p.assetClass) || { costBasis: 0, currentValue: 0, unrealized: 0 };
      c.costBasis += p.costBasis;
      c.currentValue += p.currentValue;
      c.unrealized += p.unrealized;
      classMap.set(p.assetClass, c);
    }
    const byClass = Array.from(classMap.entries()).map(([assetClass, c]) => ({
      assetClass,
      costBasis: round2(c.costBasis),
      currentValue: round2(c.currentValue),
      unrealized: round2(c.unrealized),
      unrealizedPercent: c.costBasis === 0 ? 0 : round2((c.unrealized / c.costBasis) * 100)
    }));

    // A class with no real cost basis is excluded from "best" rather than reported at a
    // fabricated 0%; a client holding nothing anywhere gets an honest null.
    let bestClass: { assetClass: string; unrealizedPercent: number } | null = null;
    for (const c of byClass) {
      if (c.costBasis > 0 && (bestClass === null || c.unrealizedPercent > bestClass.unrealizedPercent)) {
        bestClass = { assetClass: c.assetClass, unrealizedPercent: c.unrealizedPercent };
      }
    }

    return jsonResponse({
      realized, realizedHeld, unrealized, total, totalPercent,
      costBasis, currentValue,
      positions, byClass, bestClass
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
