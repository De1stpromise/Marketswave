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
// ★ RECOVERING THE COST BASIS OF A CLOSED POSITION — the identity everything below rests on.
// The engine discards a position's cost basis on sale (it is subtracted from the holding, and
// the holding row is deleted outright once fully sold). It is NOT lost, and it does not need
// reconstructing from BUY history: execute-sell computes
//     realized_return = round2(saleValue - costBasisPortion)
// and stores BOTH `total_value` (= saleValue) and `realized_return` on the SELL row. So
//
//     capital allocated to the units sold  =  total_value - realized_return
//
// Both operands are already rounded to 2dp when written, so that subtraction is EXACT, not an
// approximation — and because each partial sell records its own realized_return against the
// holding's own cost basis at that moment, it stays exact across a partial-sell chain. It is
// also immune to the average-cost-basis blending that would defeat a FIFO-style reconstruction
// from BUY rows, precisely because it never looks at BUY rows. Proven against a real 1000-unit
// position sold down in three real calls (250 / 300 / 450): each sell's reconstruction matched
// the holding row's own cost-basis delta to the cent, and the three summed back to the original
// $100,000 exactly. execute-sell is the only writer of SELL rows and has always written
// realized_return, so there is no legacy row this identity silently fails on.
//
// TOTAL RETURN PERCENTAGE — ★ row 186 is FIXED here, using exactly that identity.
// It previously divided total return by the cost basis of CURRENTLY HELD positions only, so
// the numerator counted gains from closed positions while the denominator had forgotten the
// capital that produced them — $100,000 -> $115,000 across one closed and one open position
// reported +25% instead of +15%. The denominator is now capital DEPLOYED, not capital STILL
// deployed:
//     capitalDeployed = costBasis (held) + costBasisClosed (recovered from the ledger)
// No schema change and no migration were needed: the figure was never lost, only unqueried.
//
// The per-POSITION and per-CLASS percentages deliberately keep their own held-only cost basis
// as a denominator — each describes a position you still hold, so capital you already took
// back out of a different, closed position is not part of what produced it. Only the
// portfolio-level `totalPercent` spans both, because only its numerator does.
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

    // The closed-position accumulator behind the panel.
    //
    // This used to ALSO produce a per-held-position realised figure, for a Realised column in
    // the Return Table. That column is gone (2026-09-09): for any client who has never sold —
    // most of them — every cell in it was an em dash, and a position that HAS been closed has
    // no row left in that table to sit on. Realised now lives in the closed-positions panel,
    // which can describe a closed position properly instead of hanging one number off a
    // holding that may no longer exist.
    //
    // Aggregated PER PRODUCT, not per SELL row: a position sold down over three sells is one
    // closed position a client would recognise, not three, and it matches how the rest of the
    // engine already treats a holding — one blended average-cost position, never discrete
    // lots. `closedAt` is therefore the MOST RECENT sell: the date that portion finished
    // closing.
    const { data: sells } = await admin
      .from('transactions')
      .select('product_id, units, total_value, realized_return, created_at')
      .eq('client_id', targetClientId)
      .eq('type', 'SELL');
    const closedByProduct = new Map<string, {
      unitsSold: number; capitalAllocated: number; proceeds: number;
      realised: number; closedAt: string | null;
    }>();
    for (const t of sells || []) {
      const realised = t.realized_return || 0;
      const proceeds = t.total_value || 0;
      const c = closedByProduct.get(t.product_id) ||
        { unitsSold: 0, capitalAllocated: 0, proceeds: 0, realised: 0, closedAt: null };
      c.unitsSold += t.units || 0;
      // The identity from this file's own header. Exact, not an estimate.
      c.capitalAllocated += proceeds - realised;
      c.proceeds += proceeds;
      c.realised += realised;
      if (!c.closedAt || t.created_at > c.closedAt) c.closedAt = t.created_at;
      closedByProduct.set(t.product_id, c);
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
        // A holding that ALSO has closed-position history: the client still holds part of it
        // and sold the rest, so it legitimately appears in both the Return Table and the
        // closed-positions panel. Keyed on the EXISTENCE of a SELL row, deliberately not on
        // `realized !== 0` — a sale can realise exactly $0 (sold at cost), which is a real
        // partial sale that a gain-based test would silently miss.
        partiallySold: closedByProduct.has(h.product_id),
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

    const total = round2(realized + unrealized);

    // Closed positions — one entry per product with any sell history, newest first.
    // `capitalAllocated` is the recovered original cost of the units sold; see this file's
    // header for the identity and the proof behind it.
    const closedPositions = Array.from(closedByProduct.entries()).map(([productId, c]) => {
      const product = products.find((p) => p.id === productId);
      const capitalAllocated = round2(c.capitalAllocated);
      const realisedAmount = round2(c.realised);
      return {
        productId,
        name: product ? product.name : productId,
        assetClass: product ? product.asset_class : null,
        investmentType: product ? product.investment_type : null,
        unitsSold: round2(c.unitsSold),
        capitalAllocated,
        proceeds: round2(c.proceeds),
        realised: realisedAmount,
        // Null rather than 0 when there is no real denominator: a position whose recovered
        // cost was genuinely $0 has no meaningful percentage, and printing 0.0% would state
        // something the data does not support.
        realisedPercent: capitalAllocated === 0
          ? null
          : round2((realisedAmount / capitalAllocated) * 100),
        closedAt: c.closedAt,
        // True when part of this position is still held — the Return Table shows the rest.
        stillHeld: positions.some((p) => p.productId === productId)
      };
    }).sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')));

    const closedCapital = round2(closedPositions.reduce((s, c) => s + c.capitalAllocated, 0));
    const closedProceeds = round2(closedPositions.reduce((s, c) => s + c.proceeds, 0));
    const closedRealised = round2(closedPositions.reduce((s, c) => s + c.realised, 0));
    const closedUnits = round2(closedPositions.reduce((s, c) => s + c.unitsSold, 0));

    // ★ row 186's fix. Capital DEPLOYED, not capital STILL deployed — the numerator spans
    // both held and closed positions, so the denominator must too. See the header.
    const capitalDeployed = round2(costBasis + closedCapital);
    const totalPercent = capitalDeployed > 0 ? round2((total / capitalDeployed) * 100) : null;

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
      realized, unrealized, total, totalPercent,
      costBasis, currentValue, capitalDeployed,
      positions, byClass, bestClass,
      closedPositions,
      closedTotals: {
        count: closedPositions.length,
        unitsSold: closedUnits,
        capitalAllocated: closedCapital,
        proceeds: closedProceeds,
        realised: closedRealised,
        realisedPercent: closedCapital === 0 ? null : round2((closedRealised / closedCapital) * 100)
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
