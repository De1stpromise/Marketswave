// Backend Migration Phase B — Stage 6 (2026-09-02).
//
// Real Edge Function port of engine-core.js's publishDocumentToClient(clientId, input) —
// read that function's real source in full before writing this, not reinvented. Delivers a
// new "From Marketswave" document directly into a specific client's own row set — the ONLY
// way a `direction = 'from'` document can ever be created (a client can never insert one
// themselves — see this stage's migration file header for the full RLS reasoning).
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — never getUser(), same pattern as every
// other admin-only function in this project.
//
// deadline_label computed from dueDate exactly as the local function does — relative to
// TODAY, so it stays accurate regardless of when it's later read, not baked in once at
// publish time as a static string.
//
// ★ Real Storage integration (2026-09-04): this function now uploads the actual file bytes
// (base64-encoded in the JSON request body — the request stays plain JSON, matching every
// other Edge Function in this project, rather than restructuring this one endpoint as
// multipart) into the client's `<clientId>/published/<docId>/<filename>` storage path via the
// SAME service_role client already used for the table insert — bypasses RLS entirely, same as
// the row write, so no separate admin-facing storage.objects INSERT policy is needed for this
// path (see the storage migration's own header, 20260904150000). The row's `id` is generated
// HERE, before the upload, so the storage path and the eventual row share the same id by
// construction. Upload happens BEFORE the row insert — if the upload fails, no row is created
// at all (no document ever exists pointing at a file that was never actually stored); if the
// row insert somehow fails after a successful upload, the uploaded object is orphaned but
// harmless (still scoped under the client's own folder, referenced by nothing) — an accepted,
// disclosed non-atomicity at the same risk level this project already accepts elsewhere for
// other real multi-step write sequences.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BUCKET = 'documents';

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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
    const filename = body && body.filename;
    const category = body && body.category;
    const signatureRequired = !!(body && body.signatureRequired);
    const dueDate = (body && body.dueDate) || null;
    const fileBase64 = body && body.fileBase64;
    const fileType = (body && body.fileType) || 'application/octet-stream';

    if (!clientId) return jsonResponse({ error: 'clientId is required.' }, 400);
    if (!filename || !category) {
      return jsonResponse({ error: 'publishDocumentToClient requires filename and category.' }, 400);
    }
    if (!fileBase64) {
      return jsonResponse({ error: 'A file is required to publish a document.' }, 400);
    }

    let deadlineLabel: string | null = null;
    if (dueDate) {
      const dueMs = new Date(dueDate + 'T00:00:00Z').getTime();
      const todayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
      const days = Math.round((dueMs - todayMs) / 86400000);
      deadlineLabel = days <= 0 ? 'Due today' : 'Due in ' + days + (days === 1 ? ' day' : ' days');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const docId = crypto.randomUUID();
    const storagePath = clientId + '/published/' + docId + '/' + filename;
    const bytes = decodeBase64(fileBase64);
    const { error: uploadErr } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: fileType,
      upsert: false
    });
    if (uploadErr) return jsonResponse({ error: 'Could not store the file: ' + uploadErr.message }, 500);

    const { data: doc, error: insertErr } = await admin
      .from('documents')
      .insert({
        id: docId,
        client_id: clientId,
        direction: 'from',
        filename: filename,
        category: category,
        status: signatureRequired ? 'Signature Required' : null,
        is_new: true,
        deadline_label: deadlineLabel,
        storage_path: storagePath
      })
      .select()
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    return jsonResponse(toClientShape(doc), 200);
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
