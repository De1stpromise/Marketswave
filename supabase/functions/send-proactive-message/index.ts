// ★ Visitor presence (2026-09-13) — a PM opens a conversation with someone browsing. Creates
// a REAL conversation in the unified inbox (the visitor's reply threads there like any other)
// and delivers the first message through the visitor's own heartbeat (track-visit returns a
// pending invitation until the visitor accepts it).
//
// ETIQUETTE, ENFORCED HERE — the page greys the button out with the same reasons, but the
// UI is not the constraint:
//   - not in the first 30 seconds of a session (409, with the seconds still to wait);
//   - not to a session that is not live (409);
//   - ONE invitation per session (409). The claim is a conditional update on
//     invitation_sent_at IS NULL, so two PMs clicking at once cannot both send. If the
//     visitor has replied, the thread is already open in the inbox and that is where the PM
//     continues — this function still refuses, and says so.
//
// A signed-in client's invitation goes into THEIR existing conversation (found or created by
// their real email, the same rule every other conversation follows), so nothing about them
// is duplicated. An anonymous visitor gets a conversation with no email yet — they supply
// name and email when they first reply (accept-chat-invitation).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { findOrCreateConversation } from '../_shared/conversations.ts';
import { isLive, MIN_SESSION_SECONDS_BEFORE_MESSAGE } from '../_shared/visitor-presence.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'You must be signed in to perform this action.' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) return json({ error: 'You must be signed in to perform this action.' }, 401);
    if (claimsData.claims.app_metadata?.is_admin !== true) return json({ error: 'This action requires Portfolio Manager access.' }, 403);
    const adminId = claimsData.claims.sub as string;
    const adminEmail = (claimsData.claims.email as string) || null;

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId || '');
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!sessionId) return json({ error: 'sessionId is required.' }, 400);
    if (!message) return json({ error: 'A message is required.' }, 400);
    if (message.length > 2000) return json({ error: 'Keep the message under 2,000 characters.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: session } = await admin.from('visitor_sessions').select('*').eq('id', sessionId).maybeSingle();
    if (!session) return json({ error: 'That session no longer exists.' }, 404);
    const now = new Date();
    if (!isLive(session, now)) return json({ error: 'This visitor is no longer on the site.' }, 409);
    const age = (now.getTime() - new Date(session.started_at).getTime()) / 1000;
    if (age < MIN_SESSION_SECONDS_BEFORE_MESSAGE) {
      return json({ error: 'Not yet — a visitor gets ' + MIN_SESSION_SECONDS_BEFORE_MESSAGE + ' seconds before a first message. Wait ' + Math.ceil(MIN_SESSION_SECONDS_BEFORE_MESSAGE - age) + 's.', waitSeconds: Math.ceil(MIN_SESSION_SECONDS_BEFORE_MESSAGE - age) }, 409);
    }
    if (session.invitation_sent_at) {
      let replied = false;
      if (session.conversation_id) {
        const { count } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', session.conversation_id).eq('direction', 'inbound').gt('sent_at', session.invitation_sent_at);
        replied = !!count;
      }
      return json({
        error: replied ? 'They replied — this conversation is open in the inbox; continue it there.' : 'One invitation per session: this visitor has already been messaged and has not replied.',
        replied, conversationId: session.conversation_id
      }, 409);
    }

    // ---- claim the one invitation first: a conditional update, so a race cannot double-send
    const token = crypto.randomUUID();
    const { data: claimed } = await admin.from('visitor_sessions')
      .update({ invitation_sent_at: now.toISOString(), invited_by: adminId, invited_by_email: adminEmail, invitation_token: token })
      .eq('id', sessionId).is('invitation_sent_at', null).select('id');
    if (!claimed || !claimed.length) return json({ error: 'One invitation per session: this visitor has already been messaged.' }, 409);

    // ---- the conversation
    let conversationId: string;
    if (session.client_id) {
      const { data: c } = await admin.from('clients').select('id, name, email').eq('id', session.client_id).single();
      const found = await findOrCreateConversation(admin, { email: c.email, name: c.name, subject: null, clientId: c.id });
      conversationId = found.conversationId;
    } else {
      const where = [session.city, session.country_code].filter(Boolean).join(', ');
      const { data: created, error } = await admin.from('conversations')
        .insert({ contact_email: null, contact_name: 'Visitor' + (where ? ' · ' + where : ''), status: 'open', unread_by_pm: false })
        .select('id').single();
      if (error) throw new Error('conversation insert: ' + error.message);
      conversationId = created.id;
    }
    const { data: msg, error: msgErr } = await admin.from('messages')
      .insert({ conversation_id: conversationId, channel: 'chat', direction: 'outbound', body: message, sender_name: 'Portfolio Manager', sender_email: adminEmail })
      .select('id, sent_at').single();
    if (msgErr) throw new Error('message insert: ' + msgErr.message);
    // The trigger marks unread_by_pm true only for INBOUND; an outbound first message must not
    // sit in the inbox as "unread" for the PM who just wrote it.
    await admin.from('conversations').update({ unread_by_pm: false }).eq('id', conversationId);
    await admin.from('visitor_sessions').update({ conversation_id: conversationId }).eq('id', sessionId);

    return json({ ok: true, conversationId, messageId: msg.id, sentAt: msg.sent_at }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
