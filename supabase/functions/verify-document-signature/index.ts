// ★ Task C — real signing (2026-09-18, register row 249). THE RE-CHECK.
//
// The point of storing a hash at signing is that it can be checked again later. This
// function re-downloads the CURRENT bytes at the original's storage path (and the signed
// copy's), re-hashes them with the same helper sign-document used, and reports whether each
// still equals what was recorded. It never caches a verdict and never trusts a stored
// "verified" flag: every call is a fresh read of what is in Storage right now. If the
// original ever differs, the document was altered after signing — which is the whole point.
//
// ADMIN-ONLY via getClaims(jwt) — the PM panel is what asks. A client reads their own evidence
// row directly through RLS; the hash re-check is a PM's question. (Extending it to the owning
// client would be a one-line change to the authorisation below; it was not asked for.)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/signing.ts';

const BUCKET = 'documents';

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
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const body = (await req.json().catch(() => null)) || {};
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) return jsonResponse({ error: 'documentId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: sig, error: sigErr } = await admin.from('document_signatures').select('*').eq('document_id', documentId).maybeSingle();
    if (sigErr) return jsonResponse({ error: sigErr.message }, 500);
    if (!sig) return jsonResponse({ error: 'No signature evidence exists for that document.' }, 404);

    async function currentHash(path: string): Promise<{ sha256: string | null; size: number | null; error: string | null }> {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      if (error || !data) return { sha256: null, size: null, error: error ? error.message : 'no data' };
      const bytes = new Uint8Array(await data.arrayBuffer());
      return { sha256: await sha256Hex(bytes), size: bytes.length, error: null };
    }

    const original = await currentHash(sig.original_storage_path);
    const signedCopy = await currentHash(sig.signed_copy_storage_path);

    return jsonResponse({
      documentId,
      signature: {
        id: sig.id, typedName: sig.typed_name, consentText: sig.consent_text, signedAt: sig.signed_at,
        ipAddress: sig.ip_address, userAgent: sig.user_agent, clientName: sig.client_name, clientEmail: sig.client_email,
        filename: sig.filename, pageCount: sig.page_count,
        originalSha256: sig.original_sha256, originalSizeBytes: sig.original_size_bytes, originalStoragePath: sig.original_storage_path,
        signedCopySha256: sig.signed_copy_sha256, signedCopyStoragePath: sig.signed_copy_storage_path,
        clientReportedSha256: sig.client_reported_sha256, clientReportedPages: sig.client_reported_pages
      },
      original: {
        currentSha256: original.sha256, currentSizeBytes: original.size, readError: original.error,
        matches: original.sha256 !== null && original.sha256 === sig.original_sha256
      },
      signedCopy: {
        currentSha256: signedCopy.sha256, currentSizeBytes: signedCopy.size, readError: signedCopy.error,
        matches: signedCopy.sha256 !== null && signedCopy.sha256 === sig.signed_copy_sha256
      },
      checkedAt: new Date().toISOString()
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
