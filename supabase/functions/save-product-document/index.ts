// ★ Product catalog — fund documents, part 2 of 2 (2026-09-12).
//
// The ONLY write path for product_documents. Admin-only (getClaims(jwt), never getUser()).
//
//   { productId, content, action: 'save' | 'publish' | 'unpublish' }
//
//   save      — validate the content (shape, caps, ORDERING) and store it as the working copy.
//               A published document stays published with its existing snapshot; the draft is
//               invisible to clients until it is published.
//   publish   — validate STRICTLY (required sections non-empty), store the working copy, and
//               freeze it as published_content. Clients see it from this moment.
//   unpublish — clear published_content; clients see no document link. The working copy is
//               kept so the PM can return to it.
//
// Every rule lives in _shared/fund-document.ts. This function adds only what needs the
// database: that the product exists, and that a referenced attachment really is an object
// in this product's own folder of the fund-documents bucket (the path prefix is checked by
// the validator; that the object EXISTS is checked here, so a document cannot be published
// pointing at a file that was never stored).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { validateDocumentContent, toDocumentClientShape, emptyDocumentContent } from '../_shared/fund-document.ts';

const BUCKET = 'fund-documents';

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
    const productId = body && typeof body.productId === 'string' ? body.productId : '';
    const action = body && body.action;
    if (!productId) return jsonResponse({ error: 'productId is required.' }, 400);
    if (action !== 'save' && action !== 'publish' && action !== 'unpublish') {
      return jsonResponse({ error: 'action must be "save", "publish" or "unpublish".' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: product, error: productErr } = await admin.from('products').select('id, name').eq('id', productId).maybeSingle();
    if (productErr) return jsonResponse({ error: productErr.message }, 500);
    if (!product) return jsonResponse({ error: 'Unknown product: ' + productId + '.' }, 404);

    const { data: existing, error: existingErr } = await admin.from('product_documents').select('*').eq('product_id', productId).maybeSingle();
    if (existingErr) return jsonResponse({ error: existingErr.message }, 500);

    const now = new Date().toISOString();

    if (action === 'unpublish') {
      if (!existing || existing.status !== 'published') {
        return jsonResponse({ error: 'This product has no published document to unpublish.' }, 409);
      }
      const { data: row, error: upErr } = await admin.from('product_documents')
        .update({ published_content: null, status: 'draft', updated_at: now, updated_by: adminId, updated_by_email: adminEmail })
        .eq('product_id', productId).select().single();
      if (upErr) return jsonResponse({ error: upErr.message }, 500);
      return jsonResponse({ document: toDocumentClientShape(row) }, 200);
    }

    // save / publish: validate the content the PM sent (strictly when publishing).
    const input = body.content === undefined ? emptyDocumentContent() : body.content;
    const result = validateDocumentContent(input, productId, action === 'publish');
    if (result.error) return jsonResponse({ error: result.error }, 400);
    const content = result.content!;

    // A referenced attachment must genuinely exist in this product's folder.
    const docsSection = content.sections.find((s) => s.key === 'documents');
    const attachment = docsSection && docsSection.key === 'documents' ? docsSection.attachment : null;
    if (attachment) {
      const folder = attachment.path.slice(0, attachment.path.lastIndexOf('/'));
      const filename = attachment.path.slice(attachment.path.lastIndexOf('/') + 1);
      const { data: objects, error: listErr } = await admin.storage.from(BUCKET).list(folder, { search: filename });
      if (listErr) return jsonResponse({ error: 'Could not verify the attached file: ' + listErr.message }, 500);
      const found = (objects || []).some((o) => o.name === filename);
      if (!found) return jsonResponse({ error: 'The attached file was not found in storage. Upload it again before saving.' }, 400);
    }

    const patch: Record<string, unknown> = {
      product_id: productId,
      content: content,
      updated_at: now,
      updated_by: adminId,
      updated_by_email: adminEmail
    };
    if (action === 'publish') {
      patch.published_content = content;
      patch.status = 'published';
      patch.published_at = now;
      patch.published_by = adminId;
      patch.published_by_email = adminEmail;
    }
    const { data: row, error: saveErr } = await admin.from('product_documents')
      .upsert(patch, { onConflict: 'product_id' }).select().single();
    if (saveErr) return jsonResponse({ error: saveErr.message }, 500);

    return jsonResponse({ document: toDocumentClientShape(row) }, 200);
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
