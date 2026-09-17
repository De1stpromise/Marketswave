// ★ PM tool revamp, part 8 (2026-09-17) — ending a PM's own Auth sessions.
//
// Two actions, one endpoint, because they are the same decision at two scopes and a PM should
// not have to reason about two different mechanisms:
//   { sessionId }        end that one session
//   { scope: 'others' }  end every session except the one making this request
//
// ADMIN-ONLY and SELF-ONLY, for the same reasons as get-account-security: the user id comes
// from the verified token's `sub` and the kept session from its `session_id`, never from the
// body. There is no way to name another user here at all.
//
// ★ REFUSING TO REVOKE THE CURRENT SESSION IS DELIBERATE, not an oversight. Ending the session
// you are using is signing out, which the sidebar's Log out already does properly (it clears
// the local session too); doing it from a row labelled "This device" would leave the page
// authenticated-looking with a dead token until the next call failed. The page does not render
// that control, and this refuses it regardless — a UI that does not offer something is not the
// same guarantee as a server that will not do it.
//
// ★ WHAT REVOCATION ACTUALLY MEANS, and what the page is told to say. Deleting the session row
// cascades to auth.refresh_tokens (refresh_tokens_session_id_fkey is ON DELETE CASCADE), so
// that device can never mint another access token. Its CURRENT access token stays valid until
// it expires — one hour — because that is how bearer tokens work. Measured directly on a real
// second device rather than assumed: after a revoke its refresh returned "Invalid Refresh
// Token: Refresh Token Not Found".
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

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
    const userId = claims.sub as string;
    const currentSessionId = (claims.session_id as string | null) || null;

    const body = await req.json().catch(() => ({}));
    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (body && body.scope === 'others') {
      const { data, error } = await admin.rpc('pm_revoke_other_sessions', {
        p_user_id: userId, p_keep_session_id: currentSessionId
      });
      if (error) return jsonResponse({ error: 'Could not sign out your other sessions: ' + error.message }, 500);
      return jsonResponse({ revoked: Number(data || 0), scope: 'others', keptSessionId: currentSessionId }, 200);
    }

    const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId) return jsonResponse({ error: 'A session must be named, or scope "others" used.' }, 400);
    if (currentSessionId && sessionId === currentSessionId) {
      return jsonResponse({ error: 'This is the session you are using. Use Log out to end it.' }, 409);
    }

    const { data, error } = await admin.rpc('pm_revoke_session', { p_user_id: userId, p_session_id: sessionId });
    if (error) return jsonResponse({ error: 'Could not sign out that session: ' + error.message }, 500);
    // false means the id matched no session of THIS user's — either already gone, or someone
    // else's. Both are a 404 to the caller; distinguishing them would leak whose it was.
    if (data !== true) return jsonResponse({ error: 'That session no longer exists.' }, 404);
    return jsonResponse({ revoked: 1, sessionId }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
