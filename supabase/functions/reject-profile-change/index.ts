// Backend Migration Phase B — Stage 5 (2026-09-02).
//
// Real Edge Function port of engine-core.js's rejectSettingsChangeRequest(clientId,
// requestId, resolutionNote) — read that function's real source in full before writing this,
// not reinvented. Marks a pending profile change request rejected; moves nothing (no
// client_profiles write) — mirrors the local function exactly.
//
// resolutionNote is DELIBERATELY a separate field from the client's own `reason` — the
// client's reason is "why I want this change," the PM's resolutionNote is "why I'm rejecting
// it." Conflating them would silently discard the client's original context, same as the
// local function's own documented reasoning.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — same pattern as approve-profile-change.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail } from '../_shared/send-email.ts';

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
    const resolutionNote = (body && body.resolutionNote) || null;
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('profile_change_requests')
      .select('status, client_id, field')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown profile change request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'Profile change request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    const { data: updatedRequest, error: updateErr } = await admin
      .from('profile_change_requests')
      .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolution_note: resolutionNote, resolved_by: adminId, resolved_by_email: adminEmail })
      .eq('id', requestId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    // Backend Migration Phase D — Stage 2 (2026-09-06): best-effort, genuinely awaited — see
    // approve-client-application/index.ts's own identical comment for the full "why."
    const { data: clientRow } = await admin.from('clients').select('name, email').eq('id', request.client_id).maybeSingle();
    if (clientRow) {
      await sendEmail(admin, {
        to: clientRow.email,
        subject: 'An update on your Marketswave profile update request',
        html: '<p>Hi ' + clientRow.name + ',</p><p>Your requested change to your ' + (FIELD_LABELS[request.field] || request.field) +
          ' could not be approved' + (resolutionNote ? ': ' + resolutionNote : '.') + ' Please contact support if you have any questions.</p>',
        relatedEntityType: 'profile_change_request',
        relatedEntityId: requestId
      });
    }

    return jsonResponse(toClientShape(updatedRequest), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

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
