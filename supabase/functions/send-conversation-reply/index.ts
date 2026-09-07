// Unified Communications Inbox — Stage 2 (2026-09-07). Admin-only. Replaces admin-inbox.html's
// own Stage 1 direct client-side insert for a PM's reply — that worked when every reply was a
// 'chat' message (a plain RLS-authorized insert, no server-side work needed), but a real
// email reply needs a real server-side round trip to Resend BEFORE the row can be inserted
// (the real RFC822 message_id it needs to store only exists once Resend has actually sent the
// message) — messages has no client-side UPDATE policy at all (Stage 1's own design, "no
// client-side updates to message content, ever"), so patching message_id in after an async
// send from the client isn't possible either. One function now owns both channels so a PM
// never has to choose — see the channel-selection reasoning below, this stage's own real
// design question.
//
// ★ CHANNEL SELECTION FOR A MIXED CONVERSATION — investigated and recommended, per
// instruction, not assumed. Conversations has no `channel` field of its own (only individual
// messages do) — by design, since a real thread can genuinely mix channels (the exact
// scenario the task's own point 3 asks about: someone chats, then later emails, and the
// grouping rule puts both in the same conversation). The channel this function picks for a
// reply is the channel of the CONVERSATION'S OWN MOST RECENT MESSAGE — mirrors how a real
// person naturally continues a conversation: reply the same way the other party just reached
// you. A conversation with zero messages yet (should not really happen in practice — a
// conversation is only ever created alongside its first message) defaults to 'chat', the
// original Stage 1 behavior, as a safe fallback.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail } from '../_shared/send-email.ts';

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
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json();
    const conversationId = body && body.conversationId;
    const replyText = body && typeof body.body === 'string' ? body.body.trim() : '';

    if (!conversationId) return jsonResponse({ error: 'conversationId is required.' }, 400);
    if (!replyText) return jsonResponse({ error: 'A reply message is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: conversation, error: convoErr } = await admin
      .from('conversations')
      .select('id, contact_email, contact_name, subject')
      .eq('id', conversationId)
      .maybeSingle();
    if (convoErr) return jsonResponse({ error: convoErr.message }, 500);
    if (!conversation) return jsonResponse({ error: 'Unknown conversation.' }, 404);

    const { data: recentMessage, error: recentErr } = await admin
      .from('messages')
      .select('channel')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentErr) return jsonResponse({ error: recentErr.message }, 500);
    const channel: 'chat' | 'email' = recentMessage ? (recentMessage.channel as 'chat' | 'email') : 'chat';

    if (channel === 'chat') {
      const { data: inserted, error: insertErr } = await admin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          channel: 'chat',
          direction: 'outbound',
          body: replyText,
          sender_name: 'Portfolio Manager',
          sender_email: adminEmail
        })
        .select('id')
        .single();
      if (insertErr) return jsonResponse({ error: insertErr.message }, 500);
      return jsonResponse({ channel: 'chat', messageId: inserted.id }, 200);
    }

    // channel === 'email' — real threading headers, built from every prior real email
    // message_id in this conversation (both directions), oldest first.
    const { data: priorEmailMessages, error: priorErr } = await admin
      .from('messages')
      .select('message_id')
      .eq('conversation_id', conversationId)
      .eq('channel', 'email')
      .not('message_id', 'is', null)
      .order('sent_at', { ascending: true });
    if (priorErr) return jsonResponse({ error: priorErr.message }, 500);

    const priorMessageIds = (priorEmailMessages || []).map((m: { message_id: string }) => m.message_id).filter(Boolean);
    const inReplyTo = priorMessageIds.length ? priorMessageIds[priorMessageIds.length - 1] : null;
    const references = priorMessageIds.length ? priorMessageIds.join(' ') : null;

    const subject = conversation.subject
      ? (/^re:/i.test(conversation.subject) ? conversation.subject : 'Re: ' + conversation.subject)
      : 'Re: Your message to Marketswave';

    const { html, text } = renderEmail({
      heading: 'A reply from your Portfolio Manager',
      introParagraphs: replyText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
      footerType: 'general',
      allowsReply: true
    });

    const sendResult = await sendEmail(admin, {
      to: conversation.contact_email,
      subject: subject,
      html: html,
      text: text,
      relatedEntityType: 'conversation',
      relatedEntityId: conversationId,
      headers: {
        ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
        ...(references ? { 'References': references } : {})
      }
    });

    if (!sendResult.sent) {
      // Unlike sendEmail()'s own standing non-throwing convention for best-effort
      // notifications, a PM's own reply IS the primary action being taken here — its failure
      // must be visible, not silently logged and swallowed.
      return jsonResponse({ error: 'Could not send the email reply: ' + (sendResult.error || 'unknown error') }, 502);
    }

    // Real RFC822 Message-ID this specific outbound email was actually assigned — needed so a
    // FUTURE reply from the recipient threads back correctly (their own In-Reply-To will
    // reference this exact value). Best-effort: a failure here doesn't undo the real send
    // that already succeeded, it only means this one message's own message_id stays null
    // (a future reply from them would then thread as a reply to the last message that DID
    // capture one, still correct, just one link short of the real end).
    let realMessageId: string | null = null;
    if (sendResult.resendId) {
      try {
        const resendApiKey = Deno.env.get('RESEND_API_KEY')!;
        const sentRes = await fetch('https://api.resend.com/emails/' + sendResult.resendId, {
          headers: { 'Authorization': 'Bearer ' + resendApiKey }
        });
        if (sentRes.ok) {
          const sentBody = await sentRes.json();
          realMessageId = sentBody.message_id || null;
        }
      } catch (_err) {
        // Best-effort, per the comment above.
      }
    }

    const { data: inserted, error: insertErr } = await admin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        channel: 'email',
        direction: 'outbound',
        body: replyText,
        sender_name: 'Portfolio Manager',
        sender_email: adminEmail,
        message_id: realMessageId,
        in_reply_to: inReplyTo
      })
      .select('id')
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    return jsonResponse({ channel: 'email', messageId: inserted.id }, 200);
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
