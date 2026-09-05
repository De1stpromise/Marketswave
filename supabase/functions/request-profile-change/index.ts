// Backend Migration Phase B — Stage 5 (2026-09-02).
//
// Real Edge Function port of engine-core.js's requestSettingsChange(field, requestedValue,
// reason) — read that function's real source in full before writing this, not reinvented.
//
// CLIENT-CALLABLE, SELF ONLY — clientId derived from the caller's own verified JWT
// (getClaims(jwt).sub), never trusted from the request body, mirroring the local function's
// own ambient (no-clientId-parameter) shape: a client can only ever request a change to their
// own profile.
//
// currentValue is snapshotted AUTOMATICALLY from the real client_profiles table — NEVER
// accepted as a caller-supplied parameter, preserved exactly from the local function's own
// documented reasoning ("so a client can't submit a request claiming a fabricated 'current'
// value"). A client with no client_profiles row yet (or no value stored for this specific
// field) genuinely has no current value on file — this reads back as real `null`, never a
// fabricated default (see this stage's migration file header for the full "why," including
// the real local-engine bug, row 80, this deliberately does not repeat).
//
// Rejects a second pending request for the same field, byte-for-byte the same guard the local
// function applies.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const REQUESTABLE_FIELDS = ['legalName', 'address', 'idDocument'];

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
    const clientId = claimsData.claims.sub as string;

    const body = await req.json();
    const field = body && body.field;
    const requestedValue = body && body.requestedValue;
    const reason = (body && body.reason) || null;

    if (REQUESTABLE_FIELDS.indexOf(field) === -1) {
      return jsonResponse({ error: 'field must be one of: ' + REQUESTABLE_FIELDS.join(', ') + '.' }, 400);
    }

    // Same per-field validation as validateSettingsFieldValue() itself, byte-for-byte.
    const validationError = validateFieldValue(field, requestedValue);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: existingPending, error: pendingErr } = await admin
      .from('profile_change_requests')
      .select('id')
      .eq('client_id', clientId)
      .eq('field', field)
      .eq('status', 'pending')
      .maybeSingle();
    if (pendingErr) return jsonResponse({ error: pendingErr.message }, 500);
    if (existingPending) {
      return jsonResponse({ error: 'A pending change request already exists for ' + field + '.' }, 409);
    }

    // Snapshot the REAL current value server-side — never trusted from the caller.
    const { data: profileRow, error: profileErr } = await admin
      .from('client_profiles')
      .select(toColumn(field))
      .eq('client_id', clientId)
      .maybeSingle();
    if (profileErr) return jsonResponse({ error: profileErr.message }, 500);
    const currentValue = profileRow ? (profileRow as Record<string, unknown>)[toColumn(field)] : null;

    const { data: request, error: insertErr } = await admin
      .from('profile_change_requests')
      .insert({
        client_id: clientId,
        field: field,
        current_value: currentValue,
        requested_value: requestedValue,
        reason: reason,
        status: 'pending'
      })
      .select()
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    return jsonResponse(toClientShape(request), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function validateFieldValue(field: string, value: any): string | null {
  if (field === 'legalName') {
    if (!value || !value.firstName || !value.lastName) {
      return 'legalName requires both firstName and lastName.';
    }
  } else if (field === 'address') {
    if (!value || !value.street || !value.city) {
      return 'address requires at least street and city.';
    }
  } else if (field === 'idDocument') {
    if (!value || !value.documentType) {
      return 'idDocument requires documentType.';
    }
  }
  return null;
}

function toColumn(field: string): string {
  if (field === 'legalName') return 'legal_name';
  if (field === 'idDocument') return 'id_document';
  return field; // 'address' is already the same in both cases
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
    resolutionNote: row.resolution_note
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
