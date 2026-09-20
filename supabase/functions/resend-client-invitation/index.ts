// ★ RESEND A CLIENT INVITATION (2026-09-20, register row 254) — ADMIN-ONLY.
//
// Only a LIVE invitation (sent|opened, not past its expiry) can be resent: an expired one is
// re-issued through create-client-invitation ("Invite again" — a new row, the old one stays as
// history), and an accepted or revoked one has nothing to resend. The token is ROTATED, never
// re-read: the table holds only a hash, so a resend mints a new raw token, mails it, and the
// previously mailed link stops working — a resend is also a revocation of the old link. The
// 14-day clock restarts from now.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';
import { mintToken, hashToken, newExpiry, settleExpired, toClientShape, invitationEmailInput } from '../_shared/invitations.ts';

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
    await settleExpired(admin, { id });
    const { data: row, error: fErr } = await admin.from('client_invitations').select('*').eq('id', id).maybeSingle();
    if (fErr) return jsonResponse({ error: fErr.message }, 500);
    if (!row) return jsonResponse({ error: 'Unknown invitation.' }, 404);
    if (row.status === 'accepted') return jsonResponse({ error: row.full_name + ' has already completed signup — there is nothing to resend.' }, 409);
    if (row.status === 'revoked') return jsonResponse({ error: 'This invitation was revoked. Invite ' + row.full_name + ' again instead.' }, 409);
    if (row.status === 'expired') return jsonResponse({ error: 'This invitation has expired. Invite ' + row.full_name + ' again instead.' }, 409);

    const rawToken = mintToken();
    const tokenHash = await hashToken(rawToken);
    const { data: updated, error: uErr } = await admin.from('client_invitations')
      .update({ token_hash: tokenHash, expires_at: newExpiry(), last_sent_at: new Date().toISOString() })
      .eq('id', id).select('*').single();
    if (uErr) return jsonResponse({ error: 'Could not rotate the invitation: ' + uErr.message }, 500);

    const { html, text } = renderEmail(invitationEmailInput(updated, rawToken, siteLink));
    const sent = await sendEmail(admin, {
      to: updated.email, subject: 'Your invitation to Marketswave', html, text,
      relatedEntityType: 'client_invitation', relatedEntityId: updated.id
    });
    return jsonResponse({ invitation: toClientShape(updated), emailSent: sent.sent, emailError: sent.error }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
