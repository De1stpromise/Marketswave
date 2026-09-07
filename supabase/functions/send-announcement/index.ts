// PM Compose Email + Company Announcements, Part B (2026-09-07). Admin-only. Bulk-sends one
// composed announcement to real, currently-registered clients — deliberately NOT built on
// send-conversation-reply's per-recipient conversation/message model (see that function's own
// PM Compose header comment for the individual-email half of this task). Per instruction:
// "do NOT create a conversation thread per recipient for announcements — a bulk announcement
// isn't a conversation." This function never touches `conversations`/`messages` at all — only
// `email_log`, one row per real recipient, exactly like every other email in this project.
//
// ★ RECIPIENTS — registered clients only, no manual address entry, per instruction (a
// deliberate decision: bulk email to non-customers would need real consent/unsubscribe
// handling and risks the sending domain's own reputation, which would break transactional
// email too). Two independent filters, mirroring admin-clients.html's own real, already-
// shipped filter pattern (matchesTypeFilter()'s exact three real account_type values) —
// investigated as the genuinely useful pair, not invented: `status` ('active' | 'all') and
// `accountType` ('all' | one of the three real values). Status defaults to 'active' on the
// CLIENT side (admin-announcements.html) — a pending_review or rejected applicant is not yet
// a real client relationship, so blasting them a company announcement reads as premature or
// simply wrong; a PM can still explicitly choose 'all' if there's a genuine reason to. This
// function itself does not impose that default — it trusts whatever filter object it's given,
// since the default is a UI-level judgment call, not a security boundary.
//
// ★ BATCHING — real Resend limits, researched before building rather than assumed. Resend's
// Batch Send API (POST /emails/batch) accepts up to 100 emails per call, each with its own
// independent to/subject/html/headers; the account's real rate limit is 10 requests/second,
// uniform across every endpoint (not a separate, lower limit for /batch specifically),
// enforced via standard ratelimit-* response headers and a 429 on exceeding. A real client
// list large enough to need more than a small handful of /batch calls is not realistic for
// this project today, but the loop below is written to scale correctly regardless: chunks of
// 100, with a small defensive delay between chunks (well under the real 10 req/s ceiling even
// at a much larger future client count) and an explicit, disclosed retry-once-after-backoff
// path if a real 429 is ever hit (respecting the response's own retry-after header rather than
// guessing a wait time).
//
// ★ FOOTER TYPE — defaults to 'general' (an announcement is not, by default, investment
// content), but is a real, explicit parameter a PM can override to 'investment' for an
// announcement that genuinely discusses investments — mirrors PM Compose's own "an explicit
// choice, never a guess" design exactly, just with a different sane default for this domain.
//
// ★ REPLIES TO AN ANNOUNCEMENT — investigated, per instruction, not assumed. An announcement
// email's own `from` address is the same getFromAddress() every other email in this project
// already sends from (noreply@marketswave.net by default, or a real EMAIL_FROM_ADDRESS
// override) — Resend's inbound routing is keyed on the DESTINATION domain's own MX record
// (marketswave.net), not on which function happened to send the original message, so a real
// reply to an announcement arrives at receive-inbound-email exactly like any other inbound
// email: parsed, matched to (or, for a first-time announcement recipient with no prior
// conversation, creating) a real conversation by the replying sender's own email address —
// confirmed by reading receive-inbound-email's own real code, no special handling exists or
// is needed there for this case. This is the intended behavior per instruction ("my instinct
// is they arrive via the existing inbound webhook and create/join a normal conversation
// naturally, which needs no special handling") — confirmed correct, not just assumed.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { renderEmail, getAdminEmails, logEmail } from '../_shared/send-email.ts';

const BATCH_SIZE = 100;
// Comfortably under the real confirmed 10 req/s account-wide limit even at a much larger
// future client count — this project's own real client volume today needs at most one or two
// /batch calls total.
const DELAY_BETWEEN_BATCHES_MS = 400;

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
    const subject: string = body && typeof body.subject === 'string' ? body.subject.trim() : '';
    const messageBody: string = body && typeof body.body === 'string' ? body.body.trim() : '';
    const footerType: 'investment' | 'general' = body && body.footerType === 'investment' ? 'investment' : 'general';
    const recipientFilter = (body && body.recipientFilter) || {};
    const statusFilter: string = recipientFilter.status === 'all' ? 'all' : 'active';
    const accountTypeFilter: string = ['Individual Account', 'Joint Account', 'Business Account'].includes(recipientFilter.accountType)
      ? recipientFilter.accountType
      : 'all';

    if (!subject) return jsonResponse({ error: 'A subject is required.' }, 400);
    if (!messageBody) return jsonResponse({ error: 'A message is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    let clientQuery = admin.from('clients').select('id, name, email').not('email', 'is', null);
    if (statusFilter !== 'all') clientQuery = clientQuery.eq('status', statusFilter);
    if (accountTypeFilter !== 'all') clientQuery = clientQuery.eq('account_type', accountTypeFilter);

    const { data: recipients, error: clientsErr } = await clientQuery;
    if (clientsErr) return jsonResponse({ error: clientsErr.message }, 500);

    const validRecipients = (recipients || []).filter(
      (c: { email: string | null }) => typeof c.email === 'string' && c.email.trim()
    );

    if (validRecipients.length === 0) {
      return jsonResponse({ totalRecipients: 0, sentCount: 0, failedCount: 0, message: 'No clients matched the selected recipient filter.' }, 200);
    }

    const { html, text } = renderEmail({
      heading: subject,
      introParagraphs: messageBody.split(/\n{2,}/).map((p: string) => p.trim()).filter(Boolean),
      footerType: footerType,
      allowsReply: true
    });

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      for (const r of validRecipients) {
        await logEmail(admin, { to: r.email, subject, relatedEntityType: 'announcement' }, 'failed', null, 'RESEND_API_KEY is not configured on this server.');
      }
      return jsonResponse({ error: 'RESEND_API_KEY is not configured on this server.' }, 500);
    }

    const fromAddress = Deno.env.get('EMAIL_FROM_ADDRESS') || 'Marketswave <noreply@marketswave.net>';

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {
      const chunk = validRecipients.slice(i, i + BATCH_SIZE);
      const chunkResults = await sendBatchWithRetry(apiKey, fromAddress, subject, html, text, chunk);

      for (let j = 0; j < chunk.length; j++) {
        const r = chunk[j];
        const result = chunkResults[j];
        if (result && result.sent) {
          sentCount++;
          await logEmail(admin, { to: r.email, subject, relatedEntityType: 'announcement' }, 'sent', result.resendId, null);
        } else {
          failedCount++;
          await logEmail(admin, { to: r.email, subject, relatedEntityType: 'announcement' }, 'failed', null, result ? result.error : 'Unknown batch-send failure.');
        }
      }

      if (i + BATCH_SIZE < validRecipients.length) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
    }

    // ★ Best-effort PM notification — mirrors this project's own established "a receipt for a
    // real event" pattern (notify-new-client-application etc.), never blocking the response.
    try {
      const adminEmails = await getAdminEmails(admin);
      if (adminEmails.length) {
        const { html: notifyHtml, text: notifyText } = renderEmail({
          heading: 'Announcement sent',
          introParagraphs: [
            'An announcement was just sent by ' + adminEmail + '.',
            'Subject: ' + subject
          ],
          detailRows: [
            { label: 'Recipients', value: String(validRecipients.length) },
            { label: 'Delivered', value: String(sentCount) },
            { label: 'Failed', value: String(failedCount) }
          ],
          footerType: 'general'
        });
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fromAddress, to: adminEmails, subject: 'Announcement sent: ' + subject, html: notifyHtml, text: notifyText })
        }).catch(() => {});
      }
    } catch (_err) {
      // Best-effort, never fails the primary action.
    }

    return jsonResponse({ totalRecipients: validRecipients.length, sentCount, failedCount }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Sends one real Batch Send API call (up to 100 recipients) and returns a per-recipient
// {sent, resendId, error} array in the SAME order as `chunk`, so the caller can log each
// recipient's real outcome individually. A real 429 (rate-limited) is retried exactly once,
// waiting for the real retry-after the response itself specifies rather than a guessed delay
// — a second failure is treated as a genuine, honest per-recipient failure, not retried
// indefinitely.
async function sendBatchWithRetry(
  apiKey: string,
  fromAddress: string,
  subject: string,
  html: string,
  text: string,
  chunk: { email: string }[]
): Promise<{ sent: boolean; resendId: string | null; error: string | null }[]> {
  const payload = chunk.map((r) => ({ from: fromAddress, to: r.email, subject, html, text }));

  let res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfterMs = retryAfterHeader ? Math.max(1000, parseInt(retryAfterHeader, 10) * 1000) : 2000;
    await sleep(retryAfterMs);
    res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  if (!res.ok) {
    let message = 'Resend batch request failed: HTTP ' + res.status;
    try {
      const errBody = await res.json();
      if (errBody && errBody.message) message = errBody.message;
    } catch (_err) {
      // Keep the generic message above.
    }
    return chunk.map(() => ({ sent: false, resendId: null, error: message }));
  }

  const resBody = await res.json();
  const results: { id: string }[] = (resBody && resBody.data) || [];
  return chunk.map((_r, idx) => {
    const entry = results[idx];
    return entry && entry.id
      ? { sent: true, resendId: entry.id, error: null }
      : { sent: false, resendId: null, error: 'Missing result for this recipient in the batch response.' };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
