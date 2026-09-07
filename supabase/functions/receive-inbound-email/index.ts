// Unified Communications Inbox — Stage 2 (2026-09-07). Real inbound-email receiver — Resend's
// own webhook for `email.received`, POSTed to this function's real public URL whenever a real
// email arrives at marketswave.net's real inbound MX (support@marketswave.net and any other
// address on the domain). `verify_jwt = false` in config.toml (this is a real, unauthenticated
// public endpoint by necessity — Resend has no Supabase session), so THIS FILE'S OWN Svix
// signature check (verifySvixWebhook(), _shared/webhook-verify.ts) is the real security
// boundary, not a Supabase Auth check. An unverified public POST endpoint accepting arbitrary
// bodies would be a real hole — anyone could inject a fake "inbound email" into any real
// conversation without ever having sent anything.
//
// ★ INVESTIGATED FIRST, PER INSTRUCTION, BEFORE BUILDING — Resend's real webhook payload
// shape, confirmed against Resend's own API reference docs (not assumed): the `email.received`
// event's own webhook body carries only `data.email_id`/`from`/`to`/`cc`/`bcc`/`subject` —
// it deliberately does NOT include the email body or full headers. The real message content
// (text/html), the real RFC822 `message_id`, and the full parsed `headers` object (needed to
// read a real `In-Reply-To` for threading) are fetched separately via a real, authenticated
// follow-up call to `GET https://api.resend.com/emails/receiving/{email_id}`.
//
// ★ SECURITY MODEL, point 4 of this stage's own task — confirmed, not assumed: this function
// runs entirely as `service_role`, the same privileged pattern every other Edge Function in
// this project already uses for a write no client-side RLS policy permits — it never reads OR
// writes through RLS at all. Stage 1's `visitor_auth_id` read-access asymmetry is a real
// Supabase Auth SESSION concept (which anonymous/real session is allowed to read a
// conversation's prior history back); a real inbound email has no Supabase session behind it
// at all, so that asymmetry is structurally irrelevant to this path, not bypassed by it. What
// a spoofed "From" address CAN do — a real, generic property of email as a protocol, not a
// gap this function introduces — is get a fake message WRITTEN into an existing conversation
// (the same as anyone can send a real email claiming any From address, subject to the
// destination mail server's own SPF/DKIM/DMARC checks, which already ran before this webhook
// ever fired). It grants NO read access to that conversation's prior history: reading requires
// a real Supabase session with a matching client_id/visitor_auth_id, which spoofing an SMTP
// From header does not grant. This function does NOT attempt to gate on authentication-results
// itself — Resend's parsed `headers` object was not confirmed via docs to reliably expose a
// structured SPF/DKIM/DMARC verdict field, and building a gate on an unconfirmed field would
// be worse than not gating at all; the real, load-bearing security boundary here is the Svix
// signature check above, not sender-authentication inspection.
//
// ★ IDEMPOTENCY — Svix retries a webhook delivery on a failure/timeout, which could otherwise
// create a duplicate message for the same real inbound email. Guarded by checking whether a
// message with this exact real `message_id` already exists before inserting (message_id has
// no unique DB constraint — Stage 1 deliberately didn't reshape the schema for this — so this
// is an explicit existence check, not a database-enforced one).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { verifySvixWebhook } from '../_shared/webhook-verify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const rawBody = await req.text();

  try {
    const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');
    if (!webhookSecret) {
      // Fails closed — a missing secret must never silently accept unverified webhooks.
      return jsonResponse({ error: 'RESEND_WEBHOOK_SECRET is not configured on this server.' }, 500);
    }

    const verification = await verifySvixWebhook(
      rawBody,
      {
        svixId: req.headers.get('svix-id'),
        svixTimestamp: req.headers.get('svix-timestamp'),
        svixSignature: req.headers.get('svix-signature')
      },
      webhookSecret
    );
    if (!verification.valid) {
      return jsonResponse({ error: 'Webhook signature verification failed: ' + verification.reason }, 401);
    }

    const payload = JSON.parse(rawBody);
    if (payload.type !== 'email.received') {
      // Not an event this function cares about — acknowledge with 200 so Svix doesn't retry.
      return jsonResponse({ ignored: true, type: payload.type }, 200);
    }

    const emailId = payload.data && payload.data.email_id;
    if (!emailId) {
      return jsonResponse({ error: 'Webhook payload is missing data.email_id.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return jsonResponse({ error: 'RESEND_API_KEY is not configured on this server.' }, 500);
    }

    const fullEmailRes = await fetch('https://api.resend.com/emails/receiving/' + emailId, {
      headers: { 'Authorization': 'Bearer ' + resendApiKey }
    });
    if (!fullEmailRes.ok) {
      const errBody = await fullEmailRes.text();
      return jsonResponse({ error: 'Could not retrieve the full received email from Resend: ' + errBody }, 502);
    }
    const fullEmail = await fullEmailRes.json();

    const realMessageId: string | null = fullEmail.message_id || null;

    // Idempotency guard — a real Svix retry of an already-processed message must not create
    // a duplicate row.
    if (realMessageId) {
      const { data: alreadyProcessed } = await admin
        .from('messages')
        .select('id')
        .eq('message_id', realMessageId)
        .maybeSingle();
      if (alreadyProcessed) {
        return jsonResponse({ alreadyProcessed: true, messageId: alreadyProcessed.id }, 200);
      }
    }

    const { email: fromEmail, name: fromName } = parseFromAddress(fullEmail.from || payload.data.from);
    if (!fromEmail) {
      return jsonResponse({ error: 'Could not parse a sender email address from the received message.' }, 400);
    }

    const inReplyTo = extractHeader(fullEmail.headers, 'in-reply-to');

    // Real body text — prefer the real plain-text part; a real HTML-only inbound email (no
    // separate text part) falls back to a simple tag-stripped rendering of the HTML, matching
    // the admin inbox's own plain-text message bubble display (chat messages are plain text
    // too — no HTML rendering path exists there for either channel).
    const body = (typeof fullEmail.text === 'string' && fullEmail.text.trim())
      ? fullEmail.text.trim()
      : stripHtmlToText(fullEmail.html || '');

    // A real client on file for this email, if one exists — mirrors start-chat-conversation's
    // own realClientId concept, derived here from the real sender address instead of an
    // authenticated caller (there is no Supabase session behind a real inbound email).
    const { data: matchingClient } = await admin
      .from('clients')
      .select('id')
      .ilike('email', fromEmail)
      .maybeSingle();
    const realClientId: string | null = matchingClient ? matchingClient.id : null;

    const rawSubject: string | null = typeof fullEmail.subject === 'string' && fullEmail.subject.trim() ? fullEmail.subject.trim() : null;

    const { data: existing, error: findErr } = await admin
      .from('conversations')
      .select('id, client_id, subject')
      .ilike('contact_email', fromEmail)
      .maybeSingle();
    if (findErr) return jsonResponse({ error: findErr.message }, 500);

    let conversationId: string;
    if (existing) {
      conversationId = existing.id;
      const patch: Record<string, unknown> = {};
      if (realClientId && !existing.client_id) patch.client_id = realClientId;
      // A chat-started (or otherwise subject-less) conversation receiving its first real
      // email — capture the real subject now, so a PM's later reply can thread correctly
      // (see this migration's own header for why Gmail specifically requires this).
      if (rawSubject && !existing.subject) patch.subject = rawSubject;
      if (Object.keys(patch).length) {
        await admin.from('conversations').update(patch).eq('id', existing.id);
      }
    } else {
      // A cold email from an unknown sender starts a real thread, per this stage's own
      // instruction — never dropped.
      const { data: created, error: createErr } = await admin
        .from('conversations')
        .insert({
          client_id: realClientId,
          contact_email: fromEmail,
          contact_name: fromName || fromEmail,
          subject: rawSubject,
          status: 'open'
        })
        .select('id')
        .single();
      if (createErr) return jsonResponse({ error: createErr.message }, 500);
      conversationId = created.id;
    }

    // unread_by_pm/last_message_at are updated automatically by handle_new_message() — no
    // separate update needed here, matching Stage 1's own "single source of truth" design.
    const { data: insertedMessage, error: insertErr } = await admin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        channel: 'email',
        direction: 'inbound',
        body: body || '(No message content)',
        sender_name: fromName,
        sender_email: fromEmail,
        message_id: realMessageId,
        in_reply_to: inReplyTo
      })
      .select('id')
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    return jsonResponse({ conversationId: conversationId, messageId: insertedMessage.id }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Resend's `from` field may be a bare address ("someone@example.com") or a display-name form
// ("Someone <someone@example.com>") — handle both.
function parseFromAddress(raw: string | undefined | null): { email: string | null; name: string | null } {
  if (!raw) return { email: null, name: null };
  const match = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '');
    return { email: match[2].trim().toLowerCase(), name: name || null };
  }
  return { email: raw.trim().toLowerCase(), name: null };
}

// Resend's `headers` object shape wasn't fully confirmed via docs (only a few example keys
// were shown) — a case-insensitive lookup across whatever real shape it turns out to have is
// the safest way to find a real In-Reply-To value without over-trusting an unconfirmed schema.
function extractHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
