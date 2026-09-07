// Unified Communications Inbox — Stage 1 (2026-09-07).
//
// Client-callable, both real registered clients AND anonymous chat visitors (a real Supabase
// Anonymous Sign-in session — see the migration's own header for the full "why
// signInAnonymously(), not a hand-rolled token" reasoning). Finds an existing conversation for
// the caller's real contact_email (the task's own grouping rule) or creates a new one —
// privileged, service_role, because a fresh caller (especially a brand-new anonymous session)
// structurally cannot safely run the "does a conversation already exist for this email" check
// itself: RLS correctly hides any conversation they don't yet own, so a client-side query would
// always report "none exists" even when one does, silently producing duplicate conversations.
//
// IDENTITY, never trusted from the request body for a real client: if the caller's own JWT is
// NOT is_anonymous, their contactEmail/contactName are read from their own real `clients` row
// server-side — a real client can never claim to be chatting as a different email. An
// anonymous caller's contactEmail/contactName come from the request body (untrusted, but that
// IS the point of anonymous chat — matching real-world live-chat products' own trust model).
//
// READ-ACCESS SCOPING for the "email already has a conversation" case, the real security
// decision this migration's own RLS comment already documented: visitor_auth_id is set ONLY
// the first time a conversation is created for a given email. A later, different anonymous
// session submitting the same email can still genuinely CONTINUE the thread (the conversation
// id is returned, and a subsequent message send succeeds via this project's own real RLS
// grouping-by-ownership check once messages exist) but does NOT receive the pre-existing
// message history back from this call — returning it would hand a stranger who merely typed a
// known email address someone else's real prior conversation, exactly what "do NOT make
// conversations publicly readable" was warning against.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const isAnonymous = claimsData.claims.is_anonymous === true;

    const admin = createClient(supabaseUrl, serviceRoleKey);

    let contactEmail: string;
    let contactName: string | null;
    let realClientId: string | null = null;

    if (isAnonymous) {
      const body = await req.json().catch(() => ({}));
      contactEmail = (body && typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '').toLowerCase();
      contactName = body && typeof body.contactName === 'string' && body.contactName.trim() ? body.contactName.trim() : null;
      if (!EMAIL_RE.test(contactEmail)) {
        return jsonResponse({ error: 'A valid email address is required to start a chat.' }, 400);
      }
      if (!contactName) {
        return jsonResponse({ error: 'Your name is required to start a chat.' }, 400);
      }
    } else {
      const { data: clientRow, error: clientErr } = await admin.from('clients').select('id, email, name').eq('id', callerId).maybeSingle();
      if (clientErr) return jsonResponse({ error: clientErr.message }, 500);
      if (!clientRow) return jsonResponse({ error: 'No client record found for this account.' }, 404);
      contactEmail = clientRow.email.toLowerCase();
      contactName = clientRow.name;
      realClientId = clientRow.id;
    }

    const { data: existing, error: findErr } = await admin
      .from('conversations')
      .select('id, client_id, visitor_auth_id, contact_email, contact_name, status')
      .ilike('contact_email', contactEmail)
      .maybeSingle();
    if (findErr) return jsonResponse({ error: findErr.message }, 500);

    let conversation = existing;
    let authorizedForHistory = false;

    if (conversation) {
      if (realClientId && !conversation.client_id) {
        // A real client's own conversation, created anonymously before they signed up, that
        // the retroactive-linking trigger hasn't already caught (e.g. they signed up under a
        // different flow, or this is belt-and-suspenders for the direct-chat-start path).
        const { data: updated, error: linkErr } = await admin
          .from('conversations')
          .update({ client_id: realClientId })
          .eq('id', conversation.id)
          .select('id, client_id, visitor_auth_id, contact_email, contact_name, status')
          .single();
        if (linkErr) return jsonResponse({ error: linkErr.message }, 500);
        conversation = updated;
      }
      if (isAnonymous && !conversation.visitor_auth_id) {
        // First anonymous session to ever claim this email — genuinely becomes the owner.
        const { data: updated, error: claimErr } = await admin
          .from('conversations')
          .update({ visitor_auth_id: callerId })
          .eq('id', conversation.id)
          .select('id, client_id, visitor_auth_id, contact_email, contact_name, status')
          .single();
        if (claimErr) return jsonResponse({ error: claimErr.message }, 500);
        conversation = updated;
      }
      authorizedForHistory = conversation.client_id === callerId || conversation.visitor_auth_id === callerId;
    } else {
      const { data: created, error: createErr } = await admin
        .from('conversations')
        .insert({
          client_id: realClientId,
          visitor_auth_id: isAnonymous ? callerId : null,
          contact_email: contactEmail,
          contact_name: contactName,
          status: 'open'
        })
        .select('id, client_id, visitor_auth_id, contact_email, contact_name, status')
        .single();
      if (createErr) return jsonResponse({ error: createErr.message }, 500);
      conversation = created;
      authorizedForHistory = true;
    }

    let messages: unknown[] = [];
    if (authorizedForHistory) {
      const { data: msgRows, error: msgErr } = await admin
        .from('messages')
        .select('id, channel, direction, body, sender_name, sender_email, sent_at')
        .eq('conversation_id', conversation!.id)
        .order('sent_at', { ascending: true });
      if (msgErr) return jsonResponse({ error: msgErr.message }, 500);
      messages = msgRows || [];
    }

    return jsonResponse({
      conversationId: conversation!.id,
      contactEmail: conversation!.contact_email,
      contactName: conversation!.contact_name,
      status: conversation!.status,
      authorizedForHistory: authorizedForHistory,
      messages: messages
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
