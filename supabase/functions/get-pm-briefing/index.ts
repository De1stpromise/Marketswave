// ★ PM tool revamp, part 2 (2026-09-14) — the Overview as a daily briefing, in one read.
//
// admin.html calls this once per load and renders the payload; every figure is computed in
// _shared/pm-briefing.ts from the real tables (thresholds and omissions are documented in
// that file's header). ADMIN-ONLY: the caller's JWT must carry a real is_admin claim
// (getClaims(jwt), never getUser()). The read has one side effect, deliberately: it records
// the PM's visit in pm_visits, which is the only source of "since you last looked" — a
// verification caller can pass { recordVisit: false } to read without moving that clock.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { buildBriefing } from '../_shared/pm-briefing.ts';

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
    const pmId = claimsData.claims.sub as string;
    const pmEmail = (claimsData.claims.email as string) || null;

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const briefing = await buildBriefing(admin, { pmId, pmEmail, recordVisit: body.recordVisit !== false });
    return jsonResponse(briefing, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
