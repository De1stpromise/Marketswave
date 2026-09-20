// ★ READ ONE INVITATION BY ITS TOKEN (2026-09-20, register row 254) — UNAUTHENTICATED.
//
// What signup.html?invite=<token> calls on load. The caller is, by definition, not signed in
// (they have no account yet), so this is the project's second genuinely open endpoint after
// get-public-market-snapshot — and, like receive-inbound-email, it is gated by a secret the
// caller must present: the token itself (32 random bytes, hashed before lookup; the table is
// admin-only and never reachable through this path by anything but an exact token).
//
// It answers ONE question — is this a live invitation, and to whom — and returns only the
// name and address that were in the email that carried the token. Nothing about the PM, the
// note, or any other invitation.
//
// Every refusal is a CLEAR MESSAGE with a reason code the page can act on, never a blank
// form: expired (410), revoked (410), already used (409), unknown (404). A live invitation is
// marked 'opened' on its first read — that is the "Opened" state on the PM's pending list.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { hashToken, settleExpired } from '../_shared/invitations.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token || token.length < 20 || token.length > 200) {
      return jsonResponse({ error: 'This invitation link is not valid. Check the link in your email, or ask your Portfolio Manager to send a new one.', reason: 'unknown' }, 404);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const tokenHash = await hashToken(token);
    const { data: row, error } = await admin.from('client_invitations').select('*').eq('token_hash', tokenHash).maybeSingle();
    if (error) return jsonResponse({ error: error.message }, 500);
    if (!row) {
      return jsonResponse({ error: 'This invitation link is not valid. Check the link in your email, or ask your Portfolio Manager to send a new one.', reason: 'unknown' }, 404);
    }

    await settleExpired(admin, { id: row.id });
    const { data: fresh } = await admin.from('client_invitations').select('*').eq('id', row.id).single();
    const r = fresh || row;

    if (r.status === 'accepted') {
      return jsonResponse({ error: 'This invitation has already been used to create an account. If that was you, sign in instead.', reason: 'used' }, 409);
    }
    if (r.status === 'revoked') {
      return jsonResponse({ error: 'This invitation has been withdrawn. Ask your Portfolio Manager to send a new one.', reason: 'revoked' }, 410);
    }
    if (r.status === 'expired') {
      return jsonResponse({ error: 'This invitation has expired — links are valid for 14 days. Ask your Portfolio Manager to send a new one.', reason: 'expired' }, 410);
    }

    // Live. First open marks it opened; a later open leaves opened_at as the FIRST time.
    if (r.status === 'sent') {
      await admin.from('client_invitations').update({ status: 'opened', opened_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'sent');
    }
    return jsonResponse({ ok: true, fullName: r.full_name, email: r.email, expiresAt: r.expires_at }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
