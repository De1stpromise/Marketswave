// ★ Visitor presence (2026-09-13) — an anonymous visitor accepts a PM's proactive message.
// The visitor's browser has signed in anonymously (the same real, RLS-enforceable identity
// the chat widget already uses, row 159) and presents the invitation token track-visit
// handed it. On success the conversation's visitor_auth_id becomes this caller, which is
// what lets the widget read the thread and subscribe to it under the existing conversation
// policies — no new policy, no Edge Function hop for the messages themselves.
//
// The token is the guard against a stray anonymous session claiming someone else's thread:
// it is a random uuid known only to the browser that heartbeated that session. Once claimed,
// visitor_auth_id is set exactly once and never reassigned — the same "set once" rule the
// original chat design records.
//
// Name and email are supplied here, at the first reply, because a proactive conversation
// starts with none. The email is recorded only if no other conversation already owns it (the
// grouping rule); otherwise the thread keeps the name and stays email-less rather than
// failing the reply.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

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
    if (claimsError || !claimsData || !claimsData.claims.sub) return json({ error: 'You must be signed in to perform this action.' }, 401);
    const callerId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId || '');
    const token = String(body.token || '');
    const contactName = typeof body.contactName === 'string' ? body.contactName.trim().slice(0, 120) : '';
    const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim().toLowerCase().slice(0, 200) : '';
    if (!sessionId || !token) return json({ error: 'sessionId and token are required.' }, 400);
    if (!contactName) return json({ error: 'Please enter your name.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return json({ error: 'Please enter a valid email address.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: session } = await admin.from('visitor_sessions').select('id, invitation_token, conversation_id').eq('id', sessionId).maybeSingle();
    if (!session || !session.conversation_id || !session.invitation_token || session.invitation_token !== token) {
      return json({ error: 'This invitation is not valid.' }, 403);
    }
    const { data: convo } = await admin.from('conversations').select('id, visitor_auth_id, client_id, contact_email, contact_name').eq('id', session.conversation_id).maybeSingle();
    if (!convo) return json({ error: 'This conversation no longer exists.' }, 404);
    if (convo.client_id) return json({ error: 'This conversation belongs to a signed-in client.' }, 403);
    if (convo.visitor_auth_id && convo.visitor_auth_id !== callerId) return json({ error: 'This invitation has already been accepted.' }, 409);

    const patch: Record<string, unknown> = { visitor_auth_id: callerId, contact_name: contactName };
    if (!convo.contact_email) {
      const { data: taken } = await admin.from('conversations').select('id').ilike('contact_email', contactEmail).neq('kind', 'ticket').maybeSingle();
      if (!taken) patch.contact_email = contactEmail;
    }
    // Set once: a conditional update on visitor_auth_id IS NULL (or already this caller).
    const { data: updated, error } = await admin.from('conversations').update(patch).eq('id', convo.id).or('visitor_auth_id.is.null,visitor_auth_id.eq.' + callerId).select('id, contact_name, contact_email');
    if (error) throw new Error('conversation update: ' + error.message);
    if (!updated || !updated.length) return json({ error: 'This invitation has already been accepted.' }, 409);

    const { data: messages } = await admin.from('messages').select('id, direction, body, sent_at, channel').eq('conversation_id', convo.id).order('sent_at', { ascending: true });
    return json({ ok: true, conversationId: convo.id, contactName: updated[0].contact_name, contactEmail: updated[0].contact_email, messages: messages || [] }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
