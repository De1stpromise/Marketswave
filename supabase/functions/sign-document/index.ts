// ★ Task C — real signing (2026-09-18, register row 249).
//
// THE ONLY WAY A DOCUMENT BECOMES SIGNED. The client UPDATE policy on documents is dropped
// by the same migration that creates document_signatures; a client has no write path on a
// firm-published document at all any more. This function, service_role, is what signs.
//
// SELF-ONLY: the document must belong to the caller — clientId is the verified JWT's own
// `sub`, never a body field. A client cannot sign another client's document: the lookup is
// keyed on (id, client_id = caller), so someone else's document simply reads as not found.
//
// ★ THE EVIDENCE IS THE GATE, NOT A SIDE EFFECT (Task B's ordering, row 246). The function
// (1) reads the ORIGINAL bytes itself with the service role and hashes them — the only hash
// that proves what was signed, since a client-computed hash is a value the client supplies;
// (2) generates the signed copy (original + certificate page) and stores it; (3) INSERTS the
// evidence row; and ONLY IF that insert succeeded (4) sets status='Signed'. A failure at (3)
// leaves the document unsigned and the stored signed copy orphaned (harmless, invisible — the
// same accepted non-atomicity publish-document records for its own upload-then-insert).
//
// ★ A FAILURE AT (4) — evidence row written, status flip lost — is recovered on the NEXT
// call: the unique document_id makes a second evidence row impossible, so the function sees
// the existing row, completes the status flip and returns that row. It never signs twice and
// never fabricates a second timestamp.
//
// WHAT THE CLIENT MAY SEND: typedName, consentText (must equal CONSENT_TEXT exactly — a
// signature under a different sentence is not this consent), and optionally what its own
// browser rendered and hashed (clientReportedPages / clientReportedSha256) — recorded for
// dispute, never used as the fingerprint. IP and user agent are read from the REQUEST, never
// from the body.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';
import { clientIpFrom } from '../_shared/visitor-presence.ts';
import { CONSENT_TEXT, TYPED_NAME_MIN, TYPED_NAME_MAX, sha256Hex, isPdf, appendSignatureCertificate } from '../_shared/signing.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

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
    const clientId = claimsData.claims.sub as string;

    const body = (await req.json().catch(() => null)) || {};
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    const typedName = typeof body.typedName === 'string' ? body.typedName.replace(/\s+/g, ' ').trim() : '';
    const consentText = typeof body.consentText === 'string' ? body.consentText : '';
    const consentAffirmed = body.consentAffirmed === true;
    const clientReportedSha256 = typeof body.clientReportedSha256 === 'string' && /^[0-9a-f]{64}$/.test(body.clientReportedSha256) ? body.clientReportedSha256 : null;
    const clientReportedPages = Number.isInteger(body.clientReportedPages) && body.clientReportedPages > 0 ? body.clientReportedPages : null;

    if (!/^[0-9a-f-]{36}$/i.test(documentId)) return jsonResponse({ error: 'documentId is required.' }, 400);
    if (typedName.length < TYPED_NAME_MIN || typedName.length > TYPED_NAME_MAX) {
      return jsonResponse({ error: 'Type your full legal name to sign (' + TYPED_NAME_MIN + ' to ' + TYPED_NAME_MAX + ' characters).' }, 400);
    }
    if (!consentAffirmed) return jsonResponse({ error: 'You must affirm the consent statement to sign.' }, 400);
    if (consentText !== CONSENT_TEXT) return jsonResponse({ error: 'The consent statement does not match the one this signature requires.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Own document only — someone else's simply is not found.
    const { data: doc, error: docErr } = await admin.from('documents')
      .select('id, client_id, filename, direction, status, storage_path')
      .eq('id', documentId).eq('client_id', clientId).maybeSingle();
    if (docErr) return jsonResponse({ error: docErr.message }, 500);
    if (!doc) return jsonResponse({ error: 'That document was not found.' }, 404);
    if (doc.direction !== 'from') return jsonResponse({ error: 'Only a document published by Marketswave can be signed.' }, 409);

    // Recovery path: evidence already exists (a prior call wrote it and lost the status flip).
    const { data: existing } = await admin.from('document_signatures').select('*').eq('document_id', documentId).maybeSingle();
    if (existing) {
      if (doc.status !== 'Signed') {
        const { error: flipErr } = await admin.from('documents').update({ status: 'Signed', is_new: false, deadline_label: null }).eq('id', documentId);
        if (flipErr) return jsonResponse({ error: 'Could not complete the signature: ' + flipErr.message }, 500);
      }
      return jsonResponse({ signature: toClientShape(existing), recovered: true }, 200);
    }
    if (doc.status !== 'Signature Required') return jsonResponse({ error: 'This document does not require a signature.' }, 409);
    if (!doc.storage_path) return jsonResponse({ error: 'This document has no file attached and cannot be signed.' }, 409);

    // (1) THE ORIGINAL BYTES, read by this function, hashed by this function.
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_path);
    if (dlErr || !blob) return jsonResponse({ error: 'Could not read the stored document: ' + (dlErr ? dlErr.message : 'no data') }, 502);
    const originalBytes = new Uint8Array(await blob.arrayBuffer());
    if (!isPdf(originalBytes)) return jsonResponse({ error: 'The stored document is not a PDF and cannot be signed.' }, 409);
    const originalSha256 = await sha256Hex(originalBytes);

    let pageCount: number | null = null;
    try { pageCount = (await PDFDocument.load(originalBytes)).getPageCount(); } catch (_e) { pageCount = null; }

    const { data: clientRow } = await admin.from('clients').select('name, email').eq('id', clientId).maybeSingle();
    const signedAt = new Date();
    const ipAddress = clientIpFrom(req);
    const userAgent = req.headers.get('user-agent');

    // (2) THE SIGNED COPY — original + certificate page — stored under the client's own folder
    // in a subfolder no client-side policy can write to.
    const signedBytes = await appendSignatureCertificate(originalBytes, {
      filename: doc.filename, documentId,
      clientName: clientRow?.name || '', clientEmail: clientRow?.email || '',
      typedName, signedAtIso: signedAt.toISOString(), ipAddress, userAgent,
      originalSha256, originalSizeBytes: originalBytes.length, pageCount: pageCount || 0,
      consentText: CONSENT_TEXT
    });
    const signedSha256 = await sha256Hex(signedBytes);
    const signedFilename = doc.filename.replace(/\.pdf$/i, '') + ' - signed.pdf';
    const signedPath = clientId + '/signed/' + documentId + '/' + signedFilename;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(signedPath, signedBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return jsonResponse({ error: 'Could not store the signed copy: ' + upErr.message }, 502);

    // (3) THE EVIDENCE — the gate.
    const { data: sig, error: sigErr } = await admin.from('document_signatures').insert({
      document_id: documentId, client_id: clientId,
      client_name: clientRow?.name || null, client_email: clientRow?.email || null,
      filename: doc.filename, typed_name: typedName, consent_text: CONSENT_TEXT,
      signed_at: signedAt.toISOString(), ip_address: ipAddress, user_agent: userAgent,
      original_storage_path: doc.storage_path, original_sha256: originalSha256, original_size_bytes: originalBytes.length,
      page_count: pageCount,
      signed_copy_storage_path: signedPath, signed_copy_sha256: signedSha256, signed_copy_size_bytes: signedBytes.length,
      client_reported_sha256: clientReportedSha256, client_reported_pages: clientReportedPages
    }).select().single();
    if (sigErr) return jsonResponse({ error: 'The signature could not be recorded, so the document has not been signed: ' + sigErr.message }, 500);

    // (4) ONLY NOW the status.
    const { error: flipErr } = await admin.from('documents').update({ status: 'Signed', is_new: false, deadline_label: null }).eq('id', documentId).eq('status', 'Signature Required');
    if (flipErr) return jsonResponse({ error: 'The signature was recorded but the document status could not be updated; signing again will complete it.', signature: toClientShape(sig) }, 500);

    // Best-effort, awaited, never blocking the signature (Phase D's discipline). The signed
    // copy is retrieved by link, not attached (row 249's decision).
    if (clientRow?.email) {
      const { html, text } = renderEmail({
        heading: 'Your signed copy is ready',
        introParagraphs: ['Hi ' + (clientRow.name || '') + ', you signed "' + doc.filename + '" on ' + signedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC. Your signed copy, with the signature certificate appended, is ready to download from your Documents page.'],
        detailRows: [
          { label: 'Document', value: doc.filename },
          { label: 'Signed as', value: typedName },
          { label: 'Document fingerprint (SHA-256)', value: originalSha256 }
        ],
        cta: { text: 'Download your signed copy', href: siteLink('documents.html') },
        footerType: 'general'
      });
      await sendEmail(admin, { to: clientRow.email, subject: 'Your signed copy of ' + doc.filename, html, text, relatedEntityType: 'document_signature', relatedEntityId: sig.id });
    }

    return jsonResponse({ signature: toClientShape(sig) }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export function toClientShape(r: Record<string, unknown>) {
  return {
    id: r.id, documentId: r.document_id, clientId: r.client_id, filename: r.filename,
    typedName: r.typed_name, consentText: r.consent_text, signedAt: r.signed_at,
    ipAddress: r.ip_address, userAgent: r.user_agent,
    originalSha256: r.original_sha256, originalSizeBytes: r.original_size_bytes, pageCount: r.page_count,
    signedCopyStoragePath: r.signed_copy_storage_path, signedCopySha256: r.signed_copy_sha256,
    clientReportedSha256: r.client_reported_sha256, clientReportedPages: r.client_reported_pages
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
