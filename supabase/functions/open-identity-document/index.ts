// ★ Task B — access logging for identity documents (2026-09-18, register row 246).
//
// THE ONLY WAY A PM OPENS AN IDENTITY DOCUMENT. The identity-documents bucket's own SELECT
// policy is owner-only with no admin clause (Task A, row 242), so no client-side path exists
// for a PM at all; this function reads with the service role — which bypasses that policy by
// construction — and hands back a 60-second signed URL, ONE per request, only after the access
// has been written to identity_document_access_log.
//
// ★ THE LOG IS THE GATE, NOT A SIDE EFFECT. Order matters: the signed URL is generated first
// (service role, no visible effect until returned), then the log row is inserted, and the URL
// is returned ONLY IF that insert succeeded. A generated-but-never-returned URL simply expires;
// a returned URL with no log row is the thing this function exists to make impossible. The
// log is append-only at the database (a trigger refuses UPDATE/DELETE for every role), so the
// row cannot be "opened" first and corrected later.
//
// ★ REFUSED ATTEMPTS ARE LOGGED TOO — a reason too short, a document that does not exist, a
// caller who is not a Portfolio Manager. Only a request with no session at all is not logged,
// because there is nobody to attribute it to.
//
// ★ THE REASON IS FREE TEXT, MINIMUM 10 CHARACTERS after trimming, enforced HERE (and by the
// table's own CHECK) — never only in the modal. A picker invites clicking the first option.
//
// ADMIN-ONLY via getClaims(jwt) — never getUser(), which reads the live auth.users record
// rather than the token's own hook-injected claims (the authorization bug this project has
// already shipped and caught once).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

export const REASON_MIN_LENGTH = 10;
export const URL_TTL_SECONDS = 60;

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
    const claims = claimsData.claims as Record<string, unknown>;
    const callerId = claims.sub as string;
    const callerEmail = (claims.email as string | null) || null;
    const isAdmin = (claims.app_metadata as Record<string, unknown> | undefined)?.is_admin === true;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = (await req.json().catch(() => null)) || {};
    const documentId = typeof body.documentId === 'string' ? body.documentId : null;
    const reasonRaw = typeof body.reason === 'string' ? body.reason : '';
    const reason = reasonRaw.replace(/\s+/g, ' ').trim();

    // The document, if it exists — read early so a refused attempt still names what was asked
    // for. A malformed or unknown id simply reads as no row.
    let doc: Record<string, unknown> | null = null;
    if (documentId && /^[0-9a-f-]{36}$/i.test(documentId)) {
      const { data } = await admin.from('identity_documents').select('id, client_id, kind, document_type, filename, storage_path').eq('id', documentId).maybeSingle();
      doc = data as Record<string, unknown> | null;
    }
    let client: Record<string, unknown> | null = null;
    if (doc) {
      const { data } = await admin.from('clients').select('id, name, email').eq('id', doc.client_id as string).maybeSingle();
      client = data as Record<string, unknown> | null;
    }

    async function logRow(outcome: 'opened' | 'refused', refusalReason: string | null, expiresAt: string | null) {
      const row = {
        pm_user_id: callerId,
        pm_email: callerEmail,
        client_id: (doc && (doc.client_id as string)) || (body.clientId && typeof body.clientId === 'string' && /^[0-9a-f-]{36}$/i.test(body.clientId) ? body.clientId : '00000000-0000-0000-0000-000000000000'),
        client_name: client ? (client.name as string) : null,
        client_email: client ? (client.email as string) : null,
        identity_document_id: doc ? (doc.id as string) : (documentId && /^[0-9a-f-]{36}$/i.test(documentId) ? documentId : null),
        document_kind: doc ? (doc.kind as string) : null,
        document_type: doc ? (doc.document_type as string) : null,
        filename: doc ? (doc.filename as string) : null,
        reason: reason || '(no reason given)',
        outcome,
        refusal_reason: refusalReason,
        url_expires_at: expiresAt
      };
      const { error } = await admin.from('identity_document_access_log').insert(row);
      return error ? error.message : null;
    }

    // ---- refusals, each logged --------------------------------------------------------------
    if (!isAdmin) {
      await logRow('refused', 'caller is not a Portfolio Manager', null);
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }
    if (reason.length < REASON_MIN_LENGTH) {
      await logRow('refused', 'reason shorter than ' + REASON_MIN_LENGTH + ' characters', null);
      return jsonResponse({ error: 'Give a reason of at least ' + REASON_MIN_LENGTH + ' characters — it is recorded permanently with your name and the time.' }, 400);
    }
    if (!doc) {
      await logRow('refused', 'no such identity document', null);
      return jsonResponse({ error: 'No such identity document.' }, 404);
    }

    // ---- the open: URL first (no visible effect), then the row, then — only then — the URL ----
    const { data: signed, error: signErr } = await admin.storage.from('identity-documents').createSignedUrl(doc.storage_path as string, URL_TTL_SECONDS);
    if (signErr || !signed) {
      await logRow('refused', 'the stored file could not be read: ' + (signErr ? signErr.message : 'no URL'), null);
      return jsonResponse({ error: 'The stored file could not be read. The attempt has been logged.' }, 502);
    }
    const expiresAt = new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString();
    const logErr = await logRow('opened', null, expiresAt);
    if (logErr) {
      // No row, no URL. The generated URL is never returned and expires on its own.
      return jsonResponse({ error: 'The access could not be logged, so the document was not opened: ' + logErr }, 500);
    }
    // `signedPath` is the URL with the origin removed: the function's own SUPABASE_URL is the
    // stack-INTERNAL address locally (http://kong:8000, unreachable from a browser) and the
    // public one on real staging, so the caller prepends the project URL IT is configured
    // with (the same finding get-product-document already recorded for fund documents).
    return jsonResponse({
      url: signed.signedUrl,
      signedPath: signed.signedUrl.replace(/^https?:\/\/[^/]+/, ''),
      expiresAt,
      ttlSeconds: URL_TTL_SECONDS,
      document: { id: doc.id, kind: doc.kind, documentType: doc.document_type, filename: doc.filename },
      client: client ? { id: client.id, name: client.name } : { id: doc.client_id, name: null }
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
