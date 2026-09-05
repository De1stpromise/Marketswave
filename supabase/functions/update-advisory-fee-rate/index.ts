// Admin UI Wiring — Final Stage (2026-09-03).
//
// Real Edge Function port of engine-core.js's setAdvisoryFeeRate(newRate) — read that
// function's real source in full before writing this, not reinvented. Validation is
// byte-for-byte identical: newRate must be a finite positive number.
//
// INVESTIGATED FIRST, PER INSTRUCTION: Phase B Stage 1's own migration
// (20260830182232_create_portfolio_engine_tables.sql) already created a real, genuinely
// global `advisory_fee_rate` singleton table (id boolean primary key default true, a second
// row is structurally impossible) with a real "authenticated can view" SELECT policy — but
// NO INSERT/UPDATE/DELETE policy for any client-side role, and no Edge Function anywhere
// calls it. The table exists; nothing writes to it yet. This function closes that gap —
// admin-only global config, exactly mirroring the local engine's own real fix (Aug 27, 2026)
// that made the rate genuinely platform-wide rather than per-client, carried forward into the
// real schema by giving the table its own singleton row instead of a column on account_state.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — never getUser(), same pattern as every
// other admin-only function in this project.
//
// Upserts onto the fixed `id: true` singleton row — first-ever call creates it, every
// subsequent call overwrites it in place. No clientId anywhere in this domain; there is
// exactly one rate for the whole platform.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

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
    const newRate = body && body.newRate;
    if (typeof newRate !== 'number' || !isFinite(newRate) || newRate <= 0) {
      return jsonResponse({ error: 'Advisory fee rate must be a positive number.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: updated, error: upsertErr } = await admin
      .from('advisory_fee_rate')
      .upsert({ id: true, rate: newRate, updated_at: new Date().toISOString(), updated_by: adminId, updated_by_email: adminEmail }, { onConflict: 'id' })
      .select()
      .single();
    if (upsertErr) return jsonResponse({ error: upsertErr.message }, 500);

    return jsonResponse({ rate: updated.rate, updatedBy: updated.updated_by, updatedByEmail: updated.updated_by_email }, 200);
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
