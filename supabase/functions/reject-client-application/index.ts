// Supabase Migration — Stage 3 (Aug 30, 2026).
//
// Real cloud Edge Function equivalent of functions/index.js's rejectClientApplication
// callable — see approve-client-application/index.ts's own header for the full "why" of this
// function existing and its two-client authorization design; this file mirrors it exactly,
// only differing in the specific business rule (status -> 'rejected', reason recorded) —
// same "a rejected application is KEPT, never deleted" principle this project uses
// everywhere else, and the same field this project's rejectClientApplication() (both the
// local engine-core.js version and the Firebase Cloud Function) already use:
// applicationReason, PM-supplied, optional.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // See approve-client-application/index.ts's own header for why getClaims(jwt) is used
    // here rather than getUser() — a real bug (getUser()'s app_metadata is the raw DB
    // record, not the hook-injected token claims) was caught and fixed there first, then
    // applied here from the start.
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    // Real per-PM attribution (Backend Migration Phase C — Stage 1, 2026-09-06): captured
    // directly from the caller's own already-verified JWT claims computed above — zero extra
    // DB round trip. Written into the resolved/created/updated row below.
    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json();
    const clientId = body && body.clientId;
    const reason = body && body.reason;
    if (!clientId) {
      return jsonResponse({ error: 'clientId is required.' }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: existing, error: fetchError } = await adminClient
      .from('clients')
      .select('status, name, email')
      .eq('id', clientId)
      .single();
    if (fetchError || !existing) {
      return jsonResponse({ error: 'Unknown client: ' + clientId }, 404);
    }
    if (existing.status !== 'pending_review') {
      return jsonResponse({
        error: 'Client ' + clientId + ' is not pending review (status: ' + existing.status + ').'
      }, 409);
    }

    const { error: updateError } = await adminClient
      .from('clients')
      .update({
        status: 'rejected',
        application_resolved_at: new Date().toISOString(),
        application_reason: reason || null,
        application_resolved_by: adminId,
        application_resolved_by_email: adminEmail
      })
      .eq('id', clientId);
    if (updateError) {
      return jsonResponse({ error: 'Update failed: ' + updateError.message }, 500);
    }

    // Backend Migration Phase D — Stage 1 (2026-09-06). Best-effort, genuinely awaited (not
    // fire-and-forget) — see approve-client-application/index.ts's own identical comment for
    // the full "why." Response shape unchanged.
    {
      const { html, text } = renderEmail({
        heading: 'An update on your Marketswave application',
        introParagraphs: ['Hi ' + existing.name + ', we were unable to approve your Marketswave account application. Please contact support if you have any questions.'],
        callout: reason ? { text: reason } : undefined,
        cta: { text: 'Contact us', href: siteLink('contact.html') },
        footerType: 'general'
      });
      await sendEmail(adminClient, {
        to: existing.email,
        subject: 'An update on your Marketswave application',
        html,
        text,
        relatedEntityType: 'client_application',
        relatedEntityId: clientId
      });
    }

    return jsonResponse({ id: clientId, status: 'rejected' }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
