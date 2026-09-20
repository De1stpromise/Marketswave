// ★ THE PENDING INVITATIONS LIST (2026-09-20, register row 254) — ADMIN-ONLY.
//
// Returns every invitation that is still the PM's to act on — sent, opened, expired — newest
// first, plus the counts the strip needs ("Invitations out", "N expiring soon"). Accepted
// invitations have become clients and belong to the client list; revoked ones are history.
// Time-expired rows are settled to 'expired' on this read (settle-on-touch), so the stored
// status the list shows is the real one, not a display-only computation that could disagree
// with what create/resend would do.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { settleExpired, toClientShape } from '../_shared/invitations.ts';

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

    const admin = createClient(supabaseUrl, serviceRoleKey);
    await settleExpired(admin);
    const { data: rows, error } = await admin.from('client_invitations')
      .select('*').in('status', ['sent', 'opened', 'expired']).order('last_sent_at', { ascending: false });
    if (error) return jsonResponse({ error: 'Could not read invitations: ' + error.message }, 500);

    const invitations = (rows || []).map(toClientShape);
    const out = invitations.filter((i) => i.status !== 'expired').length;
    return jsonResponse({
      invitations,
      counts: {
        out,
        sent: invitations.filter((i) => i.status === 'sent').length,
        opened: invitations.filter((i) => i.status === 'opened').length,
        expired: invitations.filter((i) => i.status === 'expired').length,
        expiringSoon: invitations.filter((i) => i.expiringSoon).length
      }
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
