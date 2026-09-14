// Backend Migration Phase B — Stage 6 (2026-09-02); rebuilt for the PM tool revamp, part 1
// (2026-09-14): tickets are conversations now.
//
// A thin creator: one `conversations` row (kind 'ticket', a category, a per-client DISP id,
// status 'open') plus its opening message — the client's own description, with the evidence
// they uploaded attached as a real Storage object reference. Still a client-callable, self-only,
// NO-GATE creation, exactly as before: a ticket exists the moment this returns, nothing to
// approve. Everything that used to happen on a ticket AFTER creation (a status change, a PM
// note) is now the inbox's own machinery — admin-update-conversation for status,
// send-conversation-reply for a real reply the client can answer.
//
// CLIENT-CALLABLE, SELF ONLY — clientId derived from the caller's own verified JWT
// (getClaims(jwt).sub), never trusted from the request body.
//
// EVIDENCE: support.html uploads the file's real bytes first, directly under the caller's own
// `<client_id>/uploads/<uuid>/<filename>` in the `documents` bucket (row 132's own policies —
// no new storage policy needed), then passes the path here. The path is checked to sit under
// the caller's OWN folder before it is stored: a client could otherwise attach any object
// path to their ticket and have the PM's download resolve it with admin rights.
//
// CALLBACK REQUESTS: the "Call Us" tile (category 'Callback Request') comes through the same
// path — support.html composes the opening message from name, phone and preferred window.
// It used to validate, toast, and persist nothing; now it is a ticket a PM can act on.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, getAdminEmails, siteLink } from '../_shared/send-email.ts';
import { nextTicketDisplayId } from '../_shared/conversations.ts';

const CATEGORIES = ['Transaction Issue', 'Account Access', 'Billing/Fees', 'Document/Signature Issue', 'Other', 'Callback Request'];

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
    if (claimsData.claims.is_anonymous === true) {
      return jsonResponse({ error: 'A support ticket needs a signed-in client account.' }, 403);
    }
    const clientId = claimsData.claims.sub as string;

    const body = await req.json();
    const category = body && body.category;
    const description = body && typeof body.description === 'string' ? body.description.trim() : '';
    const attachmentPath = body && typeof body.attachmentPath === 'string' && body.attachmentPath.trim() ? body.attachmentPath.trim() : null;
    const attachmentName = body && typeof body.attachmentName === 'string' && body.attachmentName.trim() ? body.attachmentName.trim() : null;
    // A name without a stored object would be a phantom attachment — only meaningful with a path.
    const attachmentNameForRow = attachmentPath ? attachmentName : null;
    const attachmentSize = body && Number.isFinite(Number(body.attachmentSize)) ? Math.max(0, Math.round(Number(body.attachmentSize))) : null;

    // Same validation as support.html's own submit handler ("Please select a category and
    // describe the issue").
    if (CATEGORIES.indexOf(category) === -1) {
      return jsonResponse({ error: 'category must be one of: ' + CATEGORIES.join(', ') + '.' }, 400);
    }
    if (!description) {
      return jsonResponse({ error: 'description is required.' }, 400);
    }
    if (attachmentPath && !attachmentPath.startsWith(clientId + '/uploads/')) {
      return jsonResponse({ error: 'attachmentPath must be under your own uploads folder.' }, 400);
    }
    if (attachmentPath && !attachmentName) {
      return jsonResponse({ error: 'attachmentName is required with attachmentPath.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: clientRowMaybe, error: clientErr } = await admin.from('clients').select('id, name, email').eq('id', clientId).maybeSingle();
    if (clientErr) return jsonResponse({ error: clientErr.message }, 500);
    // Every real client has a clients row (signup creates it); an account without one still
    // gets a ticket, addressed by its own verified JWT email rather than refused.
    const clientRow = clientRowMaybe || { id: clientId, name: 'Client', email: (claimsData.claims.email as string) || null };
    if (!clientRow.email) return jsonResponse({ error: 'No email address is known for this account.' }, 400);

    if (attachmentPath) {
      // The object must genuinely exist before its reference is stored — a path to nothing
      // would render as an attachment whose download fails.
      const folder = attachmentPath.slice(0, attachmentPath.lastIndexOf('/'));
      const filename = attachmentPath.slice(attachmentPath.lastIndexOf('/') + 1);
      const { data: objects, error: listErr } = await admin.storage.from('documents').list(folder, { search: filename });
      if (listErr) return jsonResponse({ error: 'Could not verify the uploaded evidence: ' + listErr.message }, 500);
      if (!(objects || []).some((o: { name: string }) => o.name === filename)) {
        return jsonResponse({ error: 'The evidence file was not found in storage. Upload it again.' }, 400);
      }
    }

    let displayId: string;
    try {
      displayId = await nextTicketDisplayId(admin, clientId);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
    }

    const { data: conversation, error: insertErr } = await admin
      .from('conversations')
      .insert({
        client_id: clientId,
        contact_email: clientRow.email,
        contact_name: clientRow.name,
        kind: 'ticket',
        category: category,
        display_id: displayId,
        subject: displayId + ' · ' + category,
        status: 'open'
      })
      .select('id, display_id, category, status, created_at')
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    // The opening description is the ticket's first message. channel 'chat' = it travelled
    // in-app (the support form), the same value the chat widget uses; the thread marks the
    // first message of a ticket as "Ticket opened" regardless.
    const { data: opening, error: msgErr } = await admin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        channel: 'chat',
        direction: 'inbound',
        body: description,
        sender_name: clientRow.name,
        sender_email: clientRow.email,
        attachment_path: attachmentPath,
        attachment_name: attachmentNameForRow,
        attachment_size: attachmentPath ? attachmentSize : null
      })
      .select('id, sent_at')
      .single();
    if (msgErr) return jsonResponse({ error: msgErr.message }, 500);

    // Branded HTML Emails (2026-09-07): notifies every registered PM. Best-effort, genuinely
    // awaited — a real ticket already exists by this point regardless of whether this
    // notification arrives. Content preserved; the CTA now opens the ticket in the inbox.
    const adminEmails = await getAdminEmails(admin);
    if (adminEmails.length > 0) {
      const isCallback = category === 'Callback Request';
      const { html, text } = renderEmail({
        heading: isCallback ? 'New callback request' : 'New support ticket filed',
        introParagraphs: [clientRow.name + (isCallback ? ' has asked to be called back.' : ' has filed a new support ticket.')],
        detailRows: [
          { label: 'Reference', value: displayId },
          { label: 'Category', value: category },
          { label: 'Description', value: description },
          ...(attachmentNameForRow ? [{ label: 'Evidence', value: attachmentNameForRow }] : [])
        ],
        cta: { text: 'Open in the inbox', href: siteLink('admin-inbox.html?c=' + conversation.id) },
        footerType: 'general'
      });
      await sendEmail(admin, {
        to: adminEmails,
        subject: (isCallback ? 'New Marketswave callback request: ' : 'New Marketswave support ticket: ') + displayId,
        html,
        text,
        relatedEntityType: 'conversation',
        relatedEntityId: conversation.id
      });
    }

    return jsonResponse({
      id: conversation.display_id,
      conversationId: conversation.id,
      clientId: clientId,
      category: conversation.category,
      description: description,
      status: conversation.status,
      dateOpened: conversation.created_at,
      openingMessageId: opening.id,
      evidence: attachmentNameForRow
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
