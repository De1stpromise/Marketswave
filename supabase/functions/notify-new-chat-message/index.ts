// Unified Communications Inbox — Stage 1 (2026-09-07).
//
// Client-callable, self-only, best-effort — called by the chat widget immediately AFTER a
// real inbound message insert succeeds (the exact same "client calls a dedicated notify
// endpoint right after its own already-authorized write" pattern already established by
// notify-new-document-upload/notify-new-client-application, since a direct RLS-authorized
// INSERT — chosen here for real-time chat's own low-latency requirement — has no server-side
// hook point of its own to attach a notification to).
//
// DEBOUNCE, investigated per instruction: "avoid notifying on every single message in an
// active back-and-forth." Tracking genuine PM presence (is an admin's inbox literally open
// right now) would need Realtime Presence — real, but real complexity and a second moving
// part (a presence channel a PM's own tab has to stay subscribed to, with its own
// disconnect/reconnect edge cases) for a problem a much simpler signal already solves well:
// conversations.last_notified_at. A notification fires only if enough real time (5 minutes)
// has passed since the LAST notification for this exact conversation, regardless of how many
// inbound messages arrived in between — a rapid back-and-forth naturally self-suppresses
// (every message after the first falls inside the debounce window), while a conversation
// that goes quiet and then resumes later correctly notifies again. This also self-adjusts for
// the "is a PM actively replying" case without needing to detect it directly: a PM who
// genuinely replies keeps the conversation moving quickly enough that the debounce window
// naturally covers it.
//
// NOTE (2026-09-07): Resend's real free-tier daily quota is exhausted as of this build.
// sendEmail()'s own existing failure-handling still logs a genuine 'failed' row with the
// real rejection reason — this function's own logic (the debounce decision, the recipient
// resolution) is verified independently of whether the actual send succeeds.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, getAdminEmails, siteLink } from '../_shared/send-email.ts';

const DEBOUNCE_MINUTES = 5;

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
    const callerId = claimsData.claims.sub as string;

    const body = await req.json();
    const conversationId = body && body.conversationId;
    if (!conversationId) return jsonResponse({ error: 'conversationId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: convo, error: convoErr } = await admin
      .from('conversations')
      .select('id, client_id, visitor_auth_id, contact_email, contact_name, last_notified_at')
      .eq('id', conversationId)
      .maybeSingle();
    if (convoErr) return jsonResponse({ error: convoErr.message }, 500);
    if (!convo) return jsonResponse({ error: 'Unknown conversation.' }, 404);

    // Self-only — the caller must genuinely own this conversation. Not a hard security
    // boundary (the debounce decision itself is server-side regardless), but keeps this
    // function's own real behavior consistent with every other self-only function in this
    // project rather than trusting an arbitrary conversationId from any caller.
    if (convo.client_id !== callerId && convo.visitor_auth_id !== callerId) {
      return jsonResponse({ error: 'You do not have access to this conversation.' }, 403);
    }

    const now = new Date();
    const debounceMs = DEBOUNCE_MINUTES * 60 * 1000;
    const shouldNotify = !convo.last_notified_at || (now.getTime() - new Date(convo.last_notified_at).getTime()) >= debounceMs;

    if (!shouldNotify) {
      return jsonResponse({ notified: false, reason: 'debounced' }, 200);
    }

    const adminEmails = await getAdminEmails(admin);
    let notified = false;
    if (adminEmails.length > 0) {
      const { html, text } = renderEmail({
        heading: 'New chat message',
        introParagraphs: [(convo.contact_name || 'A visitor') + ' (' + convo.contact_email + ') has sent a new message in Live Chat.'],
        cta: { text: 'Open the inbox', href: siteLink('admin-inbox.html') },
        footerType: 'general'
      });
      const result = await sendEmail(admin, {
        to: adminEmails,
        subject: 'New Marketswave chat message from ' + (convo.contact_name || convo.contact_email),
        html,
        text,
        relatedEntityType: 'conversation',
        relatedEntityId: convo.id
      });
      notified = result.sent;
    }

    // Recorded regardless of whether the real send succeeded (matching sendEmail()'s own
    // "log the real outcome, never block the primary action" discipline) — the debounce
    // window is about not re-attempting too often, not about only counting real successes.
    await admin.from('conversations').update({ last_notified_at: now.toISOString() }).eq('id', convo.id);

    return jsonResponse({ notified: notified }, 200);
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
