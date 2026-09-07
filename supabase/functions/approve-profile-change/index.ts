// Backend Migration Phase B — Stage 5 (2026-09-02).
//
// Real Edge Function port of engine-core.js's approveSettingsChangeRequest(clientId,
// requestId) — read that function's real source in full before writing this, not reinvented.
// Genuinely applies requested_value to the client's real client_profiles row (upserted —
// a client's first-ever approved change correctly creates their profile row for the first
// time, mirroring the local function's own `safeParse(...) || {}` fallback-to-empty-object
// behavior) rather than just flipping a status flag.
//
// requestId alone is enough to resolve which client owns the request (the row itself already
// carries client_id) — same shape as every other admin-only resolve-by-requestId function in
// this project (credit-deposit, approve-withdrawal, credit-hys-deposit, etc.).
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — never getUser(), same pattern as every
// other admin-only function in this project.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';

// Mirrors admin-profile-updates.html's own FIELD_LABELS exactly, so a client's email uses
// the identical human-readable label a PM sees in the admin UI.
const FIELD_LABELS: Record<string, string> = { legalName: 'Legal Name', address: 'Address', idDocument: 'ID / Document' };

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
    const requestId = body && body.requestId;
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('profile_change_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown profile change request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'Profile change request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    const column = toColumn(request.field);
    const { error: upsertErr } = await admin
      .from('client_profiles')
      .upsert(
        { client_id: request.client_id, [column]: request.requested_value, updated_at: new Date().toISOString() },
        { onConflict: 'client_id' }
      );
    if (upsertErr) return jsonResponse({ error: upsertErr.message }, 500);

    const { data: updatedRequest, error: updateErr } = await admin
      .from('profile_change_requests')
      .update({ status: 'approved', resolved_at: new Date().toISOString(), resolved_by: adminId, resolved_by_email: adminEmail })
      .eq('id', requestId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    // Backend Migration Phase D — Stage 2 (2026-09-06): best-effort, genuinely awaited — see
    // approve-client-application/index.ts's own identical comment for the full "why."
    const { data: clientRow } = await admin.from('clients').select('name, email').eq('id', request.client_id).maybeSingle();
    if (clientRow) {
      const { html, text } = renderEmail({
        heading: 'Your profile update has been approved',
        introParagraphs: ['Hi ' + clientRow.name + ', your requested change has been approved and is now reflected on your account.'],
        detailRows: [
          { label: 'Field updated', value: FIELD_LABELS[request.field] || request.field },
          { label: 'New value', value: String(request.requested_value) }
        ],
        cta: { text: 'Go to Settings', href: siteLink('settings.html') },
        footerType: 'general'
      });
      await sendEmail(admin, {
        to: clientRow.email,
        subject: 'Your Marketswave profile update has been approved',
        html,
        text,
        relatedEntityType: 'profile_change_request',
        relatedEntityId: requestId
      });
    }

    return jsonResponse(toClientShape(updatedRequest), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function toColumn(field: string): string {
  if (field === 'legalName') return 'legal_name';
  if (field === 'idDocument') return 'id_document';
  return field;
}

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.client_id,
    field: row.field,
    currentValue: row.current_value,
    requestedValue: row.requested_value,
    reason: row.reason,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolvedByEmail: row.resolved_by_email,
    resolutionNote: row.resolution_note
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
