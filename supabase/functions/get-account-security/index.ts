// ★ PM tool revamp, part 8 (2026-09-17) — a PM's own sessions, in one read. (Account activity was read
// here too until 2026-09-17, register row 239 — see _shared/account-security.ts for why it is gone.)
//
// ADMIN-ONLY, and SELF-ONLY. The caller's JWT must carry a real is_admin claim, read with
// getClaims(jwt) and never getUser() — getUser() fetches the live auth.users DATABASE record,
// which is a different thing from the token's own hook-injected claims, and trusting it for
// authorization is a bug this project has already shipped once and caught (Supabase Migration
// Stage 3).
//
// ★ THE USER ID COMES FROM THE VERIFIED TOKEN AND IS NEVER TAKEN FROM THE BODY. The database
// functions this calls take a user id as an argument and are SECURITY DEFINER, so a body
// parameter here would be a way for any admin to read any other user's sessions. There is no
// clientId/userId input on this endpoint at all, deliberately — reading a CLIENT's sessions is
// a different action with a different audit story and is not built.
//
// The session id likewise comes from the token's own session_id claim (confirmed present on a
// real issued JWT before being relied on), which is what makes "This device" a fact rather
// than a guess about which row the browser is sitting in.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { buildAccountSecurity } from '../_shared/account-security.ts';

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
    const claims = claimsData.claims as Record<string, unknown>;
    if ((claims.app_metadata as Record<string, unknown> | undefined)?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const payload = await buildAccountSecurity(admin, {
      userId: claims.sub as string,
      email: (claims.email as string | null) || null,
      currentSessionId: (claims.session_id as string | null) || null
    });
    return jsonResponse(payload, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
