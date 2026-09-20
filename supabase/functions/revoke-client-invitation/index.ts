// ★ REVOKE A CLIENT INVITATION (2026-09-20, register row 254) — ADMIN-ONLY.
//
// Sets status 'revoked'. The link in the mailed email stops working (get-invitation refuses
// a revoked row with a clear message), the row stays as history, and the address becomes free
// for a new invitation. Serves both controls on the pending list: "Revoke" on a live
// invitation and "Remove" on an expired one — the same state either way; the label differs
// because the PM's intent differs. An accepted invitation cannot be revoked: the person is a
// client now, and that is the client list's business.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { toClientShape } from '../_shared/invitations.ts';

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

    const body = await req.json().catch(() => ({}));
    const id = body?.id;
    if (!id || typeof id !== 'string') return jsonResponse({ error: 'An invitation id is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: row, error: fErr } = await admin.from('client_invitations').select('*').eq('id', id).maybeSingle();
    if (fErr) return jsonResponse({ error: fErr.message }, 500);
    if (!row) return jsonResponse({ error: 'Unknown invitation.' }, 404);
    if (row.status === 'accepted') return jsonResponse({ error: row.full_name + ' has already completed signup — the invitation cannot be revoked.' }, 409);
    if (row.status === 'revoked') return jsonResponse({ error: 'This invitation is already revoked.' }, 409);

    const { data: updated, error: uErr } = await admin.from('client_invitations')
      .update({ status: 'revoked' }).eq('id', id).select('*').single();
    if (uErr) return jsonResponse({ error: 'Could not revoke the invitation: ' + uErr.message }, 500);
    return jsonResponse({ invitation: toClientShape(updated) }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
