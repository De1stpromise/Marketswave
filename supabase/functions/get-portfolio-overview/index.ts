// ★ Portfolio overview (2026-09-12) — one read for dashboard.html's overview row: the value
// history (real monthly anchors from portfolio_value_snapshots plus the live current value —
// and, since the bundled card of 2026-09-13, the capital-in reference series from the ledger,
// the this-month change and per-range period stats), every request of every type awaiting PM
// review, and the savings-pocket maturities. Every
// figure is computed in _shared/portfolio-overview.ts; nothing here is a client-side money
// computation (row 185).
//
// AUTHORIZATION: self-or-admin, the get-account-state pattern — a caller reads their own
// overview, or another client's only with a real is_admin claim (getClaims(jwt), never
// getUser()).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { valueHistory, pendingRequests, pocketMaturities, writeMonthAnchor, monthStartIso } from '../_shared/portfolio-overview.ts';

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

    // ★ Bundled card (2026-09-13): the band's "this month" figure needs the current month's
    // anchor, which get-portfolio-monthly-change used to write lazily on a client's first
    // dashboard visit of the month. That lazy write now happens here — but ONLY for the
    // caller's OWN read. Row 130's reason for keeping it out of get-total-portfolio-value
    // holds for this function too: an admin browsing a client's overview must never set that
    // client's real monthly anchor as a side effect of looking. The scheduled run
    // (snapshot-portfolio-values) covers every client regardless; this is the first-visit
    // gap-filler, idempotent on the same unique index.
    if (targetClientId === callerId) {
      await writeMonthAnchor(admin, callerId, monthStartIso(new Date()));
    }

    const [history, pending, maturities] = await Promise.all([
      valueHistory(admin, targetClientId),
      pendingRequests(admin, targetClientId),
      pocketMaturities(admin, targetClientId)
    ]);

    return jsonResponse({ clientId: targetClientId, history, pending, maturities, asOf: new Date().toISOString() }, 200);
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
