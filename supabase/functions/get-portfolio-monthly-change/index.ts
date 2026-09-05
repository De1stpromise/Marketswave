// Dashboard Real-Data Fixes (2026-09-03).
//
// Closes the fabricated "+4.2% this month" figure on dashboard.html. On each call: reads (or,
// on a client's first call in a given calendar month, CREATES) a real per-client monthly
// anchor row in portfolio_value_snapshots, using the real current Total Portfolio Value
// (computeTotalPortfolioValue(), the exact same shared computation get-total-portfolio-value
// itself uses — never a second, independently-derived figure) as the anchor the first time a
// client is seen in a month. % change is always computed against THAT anchor, not recomputed
// from scratch each time, so it stays stable and comparable across a real multi-day window.
//
// A client's very first call in a month necessarily returns changePercent: 0 — the anchor row
// is created USING that same call's own currentValue, so anchorValue === currentValue by
// construction, never a fabricated number.
//
// Deliberately built as its own function rather than folded into get-total-portfolio-value:
// that function is also called cross-client by admin-clients.html (browsing every client's
// portfolio value) — if snapshot creation were a side effect of ITS OWN call, an admin merely
// looking at a client's balance in Client List could silently set that client's real monthly
// anchor to whatever the portfolio happened to be worth at that moment, which may have nothing
// to do with when the client themselves actually looks at their own dashboard. This function is
// only ever called from the client's own dashboard load.
//
// AUTHORIZATION: self-or-admin, mirroring get-account-state/get-total-portfolio-value's own
// exact pattern — a caller may omit clientId (reads their own) or pass another client's id
// only with a real is_admin JWT claim (getClaims(jwt), never getUser()).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { computeTotalPortfolioValue, round2 } from '../_shared/portfolio-engine.ts';

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

    const currentValue = await computeTotalPortfolioValue(admin, targetClientId);
    const monthStartDate = monthStartDateUTC(new Date());

    const { data: existing, error: fetchErr } = await admin
      .from('portfolio_value_snapshots')
      .select('value_at_anchor')
      .eq('client_id', targetClientId)
      .eq('month_start_date', monthStartDate)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);

    let anchorValue: number;
    if (existing) {
      anchorValue = existing.value_at_anchor;
    } else {
      const { data: inserted, error: insertErr } = await admin
        .from('portfolio_value_snapshots')
        .insert({ client_id: targetClientId, month_start_date: monthStartDate, value_at_anchor: currentValue })
        .select('value_at_anchor')
        .single();
      if (insertErr) {
        // 23505 = unique_violation — a genuine race (two near-simultaneous first-calls in the
        // same month, e.g. two tabs). Re-select rather than fail: whichever call actually won
        // the insert is the real anchor for both.
        if (insertErr.code === '23505') {
          const { data: raced, error: raceErr } = await admin
            .from('portfolio_value_snapshots')
            .select('value_at_anchor')
            .eq('client_id', targetClientId)
            .eq('month_start_date', monthStartDate)
            .single();
          if (raceErr) return jsonResponse({ error: raceErr.message }, 500);
          anchorValue = raced.value_at_anchor;
        } else {
          return jsonResponse({ error: insertErr.message }, 500);
        }
      } else {
        anchorValue = inserted.value_at_anchor;
      }
    }

    const changeAmount = round2(currentValue - anchorValue);
    // A genuinely $0 anchor (the client had literally nothing on their first check this
    // month) has no sane percentage to report if they later deposit real money the same
    // month — reported as null (never a fabricated/Infinity/NaN value) rather than guessed.
    const changePercent = anchorValue !== 0 ? round2((changeAmount / anchorValue) * 100) : (currentValue === 0 ? 0 : null);

    return jsonResponse({
      monthStartDate: monthStartDate,
      anchorValue: anchorValue,
      currentValue: currentValue,
      changeAmount: changeAmount,
      changePercent: changePercent
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function monthStartDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return y + '-' + m + '-01';
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
