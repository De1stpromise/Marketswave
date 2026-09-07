// Backend Migration Phase B — Stage 6 (2026-09-02).
//
// Real Edge Function port of engine-core.js's updateSupportRequestForClient(clientId,
// requestId, patch) — read that function's real source in full before writing this, not
// reinvented. Mirrors admin-support.html's own real call site exactly: sets status + pmNote
// + lastUpdated together, atomically — a client can never reach this (no client-side RLS
// write path exists on support_requests at all, see this stage's migration file header).
//
// requestId here refers to the human-readable display_id (e.g. "DISP-0001") — the identifier
// admin-support.html's own UI actually operates on — resolved against the given clientId
// (display_id is only unique PER CLIENT, never globally, so both are required together,
// exactly like admin-settings-changes.html's own data-client+data-id discipline for
// SETTING-XXXX ids).
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — same pattern as every other admin-only
// function in this project.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';

const STATUSES = ['Open', 'In Progress', 'Resolved'];

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
    const requestId = body && body.requestId; // the display_id, e.g. "DISP-0001"
    const status = body && body.status;
    const pmNote = (body && body.pmNote) || null;

    if (!clientId) return jsonResponse({ error: 'clientId is required.' }, 400);
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);
    if (STATUSES.indexOf(status) === -1) {
      return jsonResponse({ error: 'status must be one of: ' + STATUSES.join(', ') + '.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: existing, error: fetchErr } = await admin
      .from('support_requests')
      .select('id')
      .eq('client_id', clientId)
      .eq('display_id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!existing) return jsonResponse({ error: 'Unknown support request: ' + requestId + ' for client ' + clientId }, 404);

    const { data: updated, error: updateErr } = await admin
      .from('support_requests')
      .update({ status: status, pm_note: pmNote, last_updated: new Date().toISOString().slice(0, 10), resolved_by: adminId, resolved_by_email: adminEmail })
      .eq('id', existing.id)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    // Backend Migration Phase D — Stage 2 (2026-09-06): best-effort, genuinely awaited — see
    // approve-client-application/index.ts's own identical comment for the full "why." A ticket
    // update is not an approve/reject action, but the same "clear content per action type"
    // principle applies: Resolved reads differently from a plain in-progress status move.
    const { data: clientRow } = await admin.from('clients').select('name, email').eq('id', clientId).maybeSingle();
    if (clientRow) {
      const subject = status === 'Resolved'
        ? 'Your Marketswave support request has been resolved'
        : 'An update on your Marketswave support request';
      const statusLine = status === 'Resolved'
        ? 'Your support request has been marked resolved.'
        : 'Your support request has been updated to: ' + status + '.';
      const { html, text } = renderEmail({
        heading: status === 'Resolved' ? 'Your support request has been resolved' : 'An update on your support request',
        introParagraphs: ['Hi ' + clientRow.name + ', ' + statusLine.charAt(0).toLowerCase() + statusLine.slice(1)],
        detailRows: [{ label: 'Reference', value: requestId }],
        callout: pmNote ? { label: 'Note from your Portfolio Manager', text: pmNote } : undefined,
        cta: { text: 'View your request', href: siteLink('support.html') },
        footerType: 'general'
      });
      await sendEmail(admin, {
        to: clientRow.email,
        subject: subject,
        html,
        text,
        relatedEntityType: 'support_request',
        relatedEntityId: existing.id
      });
    }

    return jsonResponse(toClientShape(updated), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.display_id,
    dbId: row.id,
    clientId: row.client_id,
    reference: row.reference,
    category: row.category,
    description: row.description,
    status: row.status,
    dateOpened: row.date_opened,
    lastUpdated: row.last_updated,
    evidence: row.evidence,
    pmNote: row.pm_note,
    resolvedBy: row.resolved_by,
    resolvedByEmail: row.resolved_by_email
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
