// ★ Crypto deposit routing (2026-09-11).
//
// Removes one client from one address. Admin-only. Soft removal (removed_at) — the history
// of who was on an address survives, which is what "Previously N clients" on a retired row
// and any later reconciliation of funds that arrive at it both need.
//
// ★ If this was the LAST client on the address, the database retires it (the after-update
// trigger in the migration) — permanently. This function does not decide that and cannot
// prevent it; the response simply reports the address's status afterwards so the UI can
// say so.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { toAssignmentClientShape } from '../_shared/deposit-address-validation.ts';

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

    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json();
    const assignmentId = body && body.assignmentId;
    if (typeof assignmentId !== 'string' || !assignmentId) return jsonResponse({ error: 'assignmentId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: assignment, error: fetchErr } = await admin
      .from('deposit_address_assignments')
      .select('id, address_id, removed_at')
      .eq('id', assignmentId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!assignment) return jsonResponse({ error: 'Unknown assignment: ' + assignmentId }, 404);
    if (assignment.removed_at) {
      return jsonResponse({ error: 'This client has already been removed from this address.' }, 409);
    }

    const { data: row, error: updateErr } = await admin
      .from('deposit_address_assignments')
      .update({ removed_at: new Date().toISOString(), removed_by: adminId, removed_by_email: adminEmail })
      .eq('id', assignmentId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    const { data: address } = await admin
      .from('deposit_addresses')
      .select('id, status, retired_at')
      .eq('id', assignment.address_id)
      .single();

    return jsonResponse({
      assignment: toAssignmentClientShape(row),
      addressStatus: address ? address.status : null,
      addressRetired: !!(address && address.status === 'retired')
    }, 200);
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
