// ★ CREATE A CLIENT INVITATION (2026-09-20, register row 254) — ADMIN-ONLY.
//
// The replacement for "+ Add Client": a PM enters a full name, an email address and an
// optional note; the person completes signup themselves through the link this function
// mails. INVITATION ONLY — nothing here creates a client, an auth user, or any declaration
// on the person's behalf.
//
// Refusals are SERVER-SIDE with a reason, never just the form:
//   * an address that already belongs to a client (clients.email, compared lowercase) → 409
//   * a duplicate LIVE invitation to the same address → 409 (and the partial unique index
//     behind it catches two concurrent creates that both passed this read)
// A time-expired invitation to the same address is settled to 'expired' first, so "Invite
// again" is this same call — the old row stays as history, a new live one is created.
//
// getClaims(jwt), never getUser() — see get-product-catalog's own header.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';
import { mintToken, hashToken, newExpiry, settleExpired, toClientShape, normaliseEmail, looksLikeEmail, invitationEmailInput } from '../_shared/invitations.ts';

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
    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json().catch(() => ({}));
    const fullName = String(body?.fullName ?? '').trim();
    const email = normaliseEmail(body?.email);
    const note = body?.note == null ? null : String(body.note).trim();

    if (!fullName) return jsonResponse({ error: 'A full name is required.' }, 400);
    if (fullName.length > 200) return jsonResponse({ error: 'The name is too long (200 characters at most).' }, 400);
    if (!email || !looksLikeEmail(email)) return jsonResponse({ error: 'A valid email address is required.' }, 400);
    if (note && note.length > 1000) return jsonResponse({ error: 'The note is too long (1,000 characters at most).' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Already a client at this address? Then there is nothing to invite them to.
    const { data: existing, error: cErr } = await admin.from('clients').select('id, name, status').ilike('email', email).maybeSingle();
    if (cErr) return jsonResponse({ error: 'Could not check existing clients: ' + cErr.message }, 500);
    if (existing) {
      return jsonResponse({
        error: email + ' already belongs to a client' + (existing.name ? ' (' + existing.name + ')' : '') + '. Open their profile instead of inviting them.',
        reason: 'existing_client', clientId: existing.id
      }, 409);
    }

    // 2. Settle any time-expired invitation at this address, then refuse a duplicate LIVE one.
    await settleExpired(admin, { email });
    const { data: live, error: lErr } = await admin.from('client_invitations')
      .select('id, status, expires_at, last_sent_at').eq('email', email).in('status', ['sent', 'opened']).maybeSingle();
    if (lErr) return jsonResponse({ error: 'Could not check existing invitations: ' + lErr.message }, 500);
    if (live) {
      return jsonResponse({
        error: 'An invitation to ' + email + ' is already out (sent ' + new Date(live.last_sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '). Resend or revoke that one instead.',
        reason: 'duplicate_live', invitationId: live.id
      }, 409);
    }

    // 3. Mint the token; store only its hash.
    const rawToken = mintToken();
    const tokenHash = await hashToken(rawToken);
    const { data: row, error: insErr } = await admin.from('client_invitations').insert({
      full_name: fullName, email, note: note || null, token_hash: tokenHash,
      invited_by: adminId, invited_by_email: adminEmail, expires_at: newExpiry()
    }).select('*').single();
    if (insErr) {
      // The partial unique index — a concurrent create won the race between the read above
      // and this insert. Reported as the same refusal the read gives, not as a 500.
      if (insErr.code === '23505') return jsonResponse({ error: 'An invitation to ' + email + ' is already out. Resend or revoke that one instead.', reason: 'duplicate_live' }, 409);
      return jsonResponse({ error: 'Could not create the invitation: ' + insErr.message }, 500);
    }

    // 4. The email, through the existing path. A failed send is logged in email_log and
    // reported back — the invitation row exists either way and Resend is the recovery.
    const { html, text } = renderEmail(invitationEmailInput(row, rawToken, siteLink));
    const sent = await sendEmail(admin, {
      to: row.email, subject: 'Your invitation to Marketswave', html, text,
      relatedEntityType: 'client_invitation', relatedEntityId: row.id
    });

    return jsonResponse({ invitation: toClientShape(row), emailSent: sent.sent, emailError: sent.error }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
