// Backend Migration Phase D — Stage 1 (2026-09-06).
//
// The single source of truth for sending a real email and logging it — mirrors
// hys-engine.ts's own "one shared module, every caller imports from here, never a second
// copy of the same logic" discipline exactly. Every Edge Function that ever needs to send a
// real email calls sendEmail() from here; none should ever call the Resend API directly or
// write to public.email_log itself.
//
// Accepts the CALLER's own already-constructed service_role client (every Edge Function in
// this project already builds one via createClient(supabaseUrl, serviceRoleKey) for its own
// primary work) rather than constructing a second one internally — avoids a redundant client
// instance per call, the same reasoning approve-allocation's own internal call to
// execute-buy avoids duplicating logic rather than creating a parallel implementation.
//
// FAILURE HANDLING, a deliberate design decision: a failed send (Resend rejects the request,
// a network error, a missing RESEND_API_KEY) is caught and logged with status: 'failed' —
// it does NOT throw back to the caller. The two real trigger points wired this stage
// (approve/reject-client-application, credit-deposit) are money/identity-moving actions
// whose own success must never depend on whether an email happened to send; a client being
// approved, or a deposit being credited, is real and final regardless of whether the
// notification email that SHOULD follow it actually arrived. This mirrors the "the log
// itself is not a queue, nothing there is pending or needs approval" discipline
// admin-security.html's own audit log already established for a different domain — this is
// a best-effort side effect with a real, honest record of what happened, not a transactional
// step the primary action can be blocked by.
export async function sendEmail(
  admin: any,
  params: {
    to: string;
    subject: string;
    html: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }
): Promise<{ sent: boolean; resendId: string | null; error: string | null }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');

  if (!apiKey) {
    await logEmail(admin, params, 'failed', null, 'RESEND_API_KEY is not configured on this server.');
    return { sent: false, resendId: null, error: 'RESEND_API_KEY is not configured on this server.' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Marketswave <onboarding@resend.dev>',
        to: params.to,
        subject: params.subject,
        html: params.html
      })
    });

    const body = await res.json();

    if (!res.ok) {
      const message = (body && body.message) || ('Resend request failed: HTTP ' + res.status);
      await logEmail(admin, params, 'failed', null, message);
      return { sent: false, resendId: null, error: message };
    }

    await logEmail(admin, params, 'sent', body.id || null, null);
    return { sent: true, resendId: body.id || null, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEmail(admin, params, 'failed', null, message);
    return { sent: false, resendId: null, error: message };
  }
}

async function logEmail(
  admin: any,
  params: { to: string; subject: string; relatedEntityType?: string; relatedEntityId?: string },
  status: 'sent' | 'failed',
  resendId: string | null,
  errorMessage: string | null
): Promise<void> {
  // A logging failure is swallowed, not thrown — the real email send (or real failure) has
  // already happened by this point; a broken audit-trail write must never retroactively
  // fail the caller's own primary action.
  try {
    await admin.from('email_log').insert({
      recipient: params.to,
      subject: params.subject,
      related_entity_type: params.relatedEntityType || null,
      related_entity_id: params.relatedEntityId || null,
      status: status,
      resend_id: resendId,
      error_message: errorMessage
    });
  } catch (_err) {
    // Deliberately silent — see this function's own caller-facing comment above.
  }
}
