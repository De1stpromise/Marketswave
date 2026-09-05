// Backend Migration Phase B — Stage 6 (2026-09-02).
//
// Real Edge Function port of engine-core.js's updateDocumentForClient(clientId, docId,
// patch) — read that function's real source in full before writing this, not reinvented. A
// generic admin-only patcher, mirroring the local function's own generic signature exactly —
// today's ONE real caller is admin-documents.html's "Mark Reviewed" action
// ({ status: 'Reviewed' }) on a client's own uploaded document, but this function accepts
// any of the same fields the local primitive does, not hardcoded to that single use.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — same pattern as every other admin-only
// function in this project. A client can never reach this — there is no client-callable
// equivalent for a general patch, only the two narrow self-service RLS policies (upload
// INSERT, Sign UPDATE) already covering everything the real client-side code actually does.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const PATCHABLE_FIELDS: Record<string, string> = {
  filename: 'filename',
  category: 'category',
  status: 'status',
  isNew: 'is_new',
  deadlineLabel: 'deadline_label'
};

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

    const body = await req.json();
    const clientId = body && body.clientId;
    const docId = body && body.docId;
    const patch = (body && body.patch) || {};

    if (!clientId) return jsonResponse({ error: 'clientId is required.' }, 400);
    if (!docId) return jsonResponse({ error: 'docId is required.' }, 400);

    const columnPatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      const column = PATCHABLE_FIELDS[key];
      if (!column) return jsonResponse({ error: 'Unknown patchable field: ' + key }, 400);
      columnPatch[column] = patch[key];
    }
    if (Object.keys(columnPatch).length === 0) {
      return jsonResponse({ error: 'patch must include at least one field.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: existing, error: fetchErr } = await admin
      .from('documents')
      .select('id')
      .eq('id', docId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!existing) return jsonResponse({ error: 'Unknown document: ' + docId + ' for client ' + clientId }, 404);

    const { data: updated, error: updateErr } = await admin
      .from('documents')
      .update(columnPatch)
      .eq('id', docId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    return jsonResponse(toClientShape(updated), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.client_id,
    direction: row.direction,
    filename: row.filename,
    category: row.category,
    status: row.status,
    isNew: row.is_new,
    deadlineLabel: row.deadline_label,
    date: row.created_at
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
