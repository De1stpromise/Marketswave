// Branded HTML Emails (2026-09-07).
//
// New PM-facing trigger: "New client document uploaded awaiting review." See
// notify-new-client-application/index.ts's own header for the identical architectural
// reasoning — documents.html's real Upload action is a DIRECT `MarketswaveData.insertRow(
// 'documents', ...)` call from the browser (Phase B Stage 6's own real client-side direct-
// write design, confirmed by reading documents.html's actual upload handler before writing
// this), not an Edge Function call, so there is no server-side hook point on the upload path
// itself. This function is called by documents.html immediately AFTER that direct insert
// succeeds, the same "client calls a dedicated notify endpoint right after its own already-
// authorized write" pattern used for the new-client-application case.
//
// CLIENT-CALLABLE, SELF ONLY — clientId derived from the caller's own verified JWT
// (getClaims(jwt).sub), never trusted from the request body. Takes documentId and re-fetches
// the real row server-side (never trusts client-supplied filename/category) — verifies it
// genuinely belongs to this client AND is genuinely direction='upload' before sending
// anything, so this can never be used to generate a misleading "uploaded" notification for a
// document the firm itself published.
//
// SECURITY NOTE, same as notify-new-client-application's own: this performs no state
// mutation — worst case of any misuse is a duplicate or missing notification, never a data
// or access-control issue.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, getAdminEmails, siteLink } from '../_shared/send-email.ts';

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
    const documentId = body && body.documentId;
    if (!documentId) return jsonResponse({ error: 'documentId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: doc, error: docErr } = await admin
      .from('documents')
      .select('id, filename, category, direction, client_id')
      .eq('id', documentId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (docErr) return jsonResponse({ error: docErr.message }, 500);
    if (!doc) return jsonResponse({ error: 'Unknown document for this client.' }, 404);
    if (doc.direction !== 'upload') {
      return jsonResponse({ error: 'This document was not uploaded by the client.' }, 400);
    }

    const adminEmails = await getAdminEmails(admin);
    if (adminEmails.length > 0) {
      const { data: clientRow } = await admin.from('clients').select('name').eq('id', clientId).maybeSingle();
      const { html, text } = renderEmail({
        heading: 'New client document uploaded',
        introParagraphs: [(clientRow ? clientRow.name : 'A client') + ' has uploaded a new document awaiting review.'],
        detailRows: [
          { label: 'Document', value: doc.filename },
          { label: 'Category', value: doc.category }
        ],
        cta: { text: 'Review in the admin tool', href: siteLink('admin-documents.html') },
        footerType: 'general'
      });
      await sendEmail(admin, {
        to: adminEmails,
        subject: 'New Marketswave document upload: ' + doc.filename,
        html,
        text,
        relatedEntityType: 'document',
        relatedEntityId: documentId
      });
    }

    return jsonResponse({ sent: true }, 200);
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
