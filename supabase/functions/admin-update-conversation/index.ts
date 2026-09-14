// Unified Communications Inbox — Stage 1 (2026-09-07); extended for the PM tool revamp,
// part 1 (2026-09-14), where it subsumes update-support-ticket's status half.
//
// Admin-only. Handles status changes (open / in_progress / resolved / archived) and marking a
// conversation read — the only two writes a PM ever makes against `conversations` itself
// (message SENDING is send-conversation-reply's job). No client-side UPDATE policy exists on
// `conversations` at all, so this function, running as service_role, is the only path either
// field can ever change through.
//
// A STATUS CHANGE IS VISIBLE IN THE THREAD: it inserts a `channel = 'system'` message
// ("Status changed to In progress by pm@…") so the thread stays one ordered list — the
// quiet system line the inbox renders inline. Rail placement and "most recent message" logic
// skip system rows; handle_new_message() does not flag them unread (direction is outbound).
//
// FOR A TICKET, THE CLIENT IS EMAILED — the exact content update-support-ticket used to send
// ("Your Marketswave support request has been resolved" / "An update on your Marketswave
// support request"), now with reply_to set to the support address and its Message-ID stored
// on the system row, so a client who replies to it lands in THIS ticket rather than in a
// new, unlinked conversation through the catch-all — the failure this consolidation exists
// to close. The old function's optional pmNote is gone: a PM's note is a real reply now
// (send-conversation-reply), which the client can answer.
//
// PM attribution (resolved_by / resolved_by_email / resolved_at) is recorded for a genuine
// move to resolved/archived, as before; marking read is a lighter-weight action that doesn't
// warrant it.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, siteLink, fetchResendMessageId, SUPPORT_REPLY_TO } from '../_shared/send-email.ts';

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'archived'];
const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', archived: 'Archived' };

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
    const conversationId = body && body.conversationId;
    const status = body && body.status;
    const markRead = body && body.markRead === true;

    if (!conversationId) return jsonResponse({ error: 'conversationId is required.' }, 400);
    if (status !== undefined && VALID_STATUSES.indexOf(status) === -1) {
      return jsonResponse({ error: 'status must be one of: ' + VALID_STATUSES.join(', ') + '.' }, 400);
    }
    if (status === undefined && !markRead) {
      return jsonResponse({ error: 'Provide at least one of status or markRead.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: current, error: currentErr } = await admin
      .from('conversations')
      .select('id, kind, status, display_id, category, contact_email, contact_name, client_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (currentErr) return jsonResponse({ error: currentErr.message }, 500);
    if (!current) return jsonResponse({ error: 'Unknown conversation.' }, 404);

    const patch: Record<string, unknown> = {};
    const statusChanged = status !== undefined && status !== current.status;
    if (status !== undefined) {
      patch.status = status;
      if (status === 'resolved' || status === 'archived') {
        patch.resolved_by = adminId;
        patch.resolved_by_email = adminEmail;
        patch.resolved_at = new Date().toISOString();
      }
    }
    if (markRead) {
      patch.unread_by_pm = false;
    }

    const { data: updated, error: updateErr } = await admin
      .from('conversations')
      .update(patch)
      .eq('id', conversationId)
      .select('id, status, unread_by_pm, resolved_by, resolved_by_email, resolved_at')
      .maybeSingle();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);
    if (!updated) return jsonResponse({ error: 'Unknown conversation.' }, 404);

    let systemMessageId: string | null = null;
    if (statusChanged) {
      const label = STATUS_LABELS[status] || status;
      const { data: sys, error: sysErr } = await admin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          channel: 'system',
          direction: 'outbound',
          body: 'Status changed to ' + label + ' by ' + adminEmail,
          sender_name: 'Portfolio Manager',
          sender_email: adminEmail
        })
        .select('id')
        .single();
      if (sysErr) return jsonResponse({ error: sysErr.message }, 500);
      systemMessageId = sys.id;

      // The ticket status email — update-support-ticket's own content, preserved.
      if (current.kind === 'ticket' && current.contact_email && status !== 'archived') {
        const reference = current.display_id || 'your ticket';
        const isResolved = status === 'resolved';
        const statusLine = isResolved ? 'Your support request has been marked resolved.' : 'Your support request has been updated to: ' + label + '.';
        const firstName = (current.contact_name || 'there').split(' ')[0];
        const { html, text } = renderEmail({
          heading: isResolved ? 'Your support request has been resolved' : 'An update on your support request',
          introParagraphs: ['Hi ' + firstName + ', ' + statusLine.charAt(0).toLowerCase() + statusLine.slice(1)],
          detailRows: [{ label: 'Reference', value: reference }],
          cta: { text: 'View your request', href: siteLink('support.html') },
          footerType: 'general',
          allowsReply: true
        });
        const sendResult = await sendEmail(admin, {
          to: current.contact_email,
          subject: isResolved ? 'Your Marketswave support request has been resolved' : 'An update on your Marketswave support request',
          html,
          text,
          replyTo: SUPPORT_REPLY_TO,
          relatedEntityType: 'conversation',
          relatedEntityId: conversationId
        });
        // A reply to this email carries its Message-ID as In-Reply-To; storing it on the
        // system row is what lets receive-inbound-email land that reply in this ticket.
        if (sendResult.sent) {
          const messageId = await fetchResendMessageId(sendResult.resendId);
          await admin.from('messages').update({ message_id: messageId, resend_id: sendResult.resendId, delivery_status: 'sent' }).eq('id', systemMessageId);
        }
      }
    }

    return jsonResponse({ ...updated, systemMessageId: systemMessageId }, 200);
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
