// ★ PM tool revamp, part 4 (2026-09-15) — the client profile, in one read (register row 233).
//
// ADMIN-ONLY. The caller's JWT must carry a real is_admin claim, read with getClaims(jwt) and
// never getUser() — getUser() fetches the live auth.users DATABASE record, which is a
// different thing from the token's own hook-injected claims, and trusting it for authorization
// is a bug this project has already shipped once and caught (Supabase Migration Stage 3).
//
// Unlike get-pm-briefing this read has NO side effect: it does not touch pm_visits or any
// other clock. A PM opening a client's profile must never move a counter that another part of
// the tool reads as "since you last looked".
//
// The PM's own id is passed through to buildClientProfile so private notes can be scoped to
// their author. RLS on pm_client_notes enforces that independently; the scoping here means the
// service-role read cannot leak a colleague's note even by mistake.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { buildClientProfile } from '../_shared/client-profile.ts';

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

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const clientId = body.clientId;
    if (!clientId || typeof clientId !== 'string') {
      return jsonResponse({ error: 'A clientId is required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const profile = await buildClientProfile(admin, clientId, pmId);
    if (!profile) return jsonResponse({ error: 'No such client.' }, 404);
    return jsonResponse(profile, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
