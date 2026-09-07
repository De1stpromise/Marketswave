// Backend Migration Phase D — Stage 1 (2026-09-06). Extended for the Branded HTML Emails
// task (2026-09-07) — see renderEmail()'s own header comment below for the full template
// writeup. This remains the single source of truth for sending a real email and logging it;
// every Edge Function that ever needs to send a real email still calls sendEmail() from
// here, now via renderEmail() for its actual content — none should ever call the Resend API
// directly, write to public.email_log itself, or hand-build a second copy of the branded
// HTML shell.
//
// Accepts the CALLER's own already-constructed service_role client (every Edge Function in
// this project already builds one via createClient(supabaseUrl, serviceRoleKey) for its own
// primary work) rather than constructing a second one internally — avoids a redundant client
// instance per call, the same reasoning approve-allocation's own internal call to
// execute-buy avoids duplicating logic rather than creating a parallel implementation.
//
// FAILURE HANDLING, a deliberate design decision, unchanged since Stage 1: a failed send
// (Resend rejects the request, a network error, a missing RESEND_API_KEY) is caught and
// logged with status: 'failed' — it does NOT throw back to the caller. Every trigger point
// wired across this project is a money/identity/status-moving action (or a receipt/
// notification for one) whose own success must never depend on whether an email happened to
// send; a client being approved, or a deposit being credited, is real and final regardless
// of whether the notification email that SHOULD follow it actually arrived. This mirrors the
// "the log itself is not a queue, nothing there is pending or needs approval" discipline
// admin-security.html's own audit log already established for a different domain — this is
// a best-effort side effect with a real, honest record of what happened, not a transactional
// step the primary action can be blocked by.
export async function sendEmail(
  admin: any,
  params: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }
): Promise<{ sent: boolean; resendId: string | null; error: string | null }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');

  if (!apiKey) {
    await logEmail(admin, params, 'failed', null, 'RESEND_API_KEY is not configured on this server.');
    return { sent: false, resendId: null, error: 'RESEND_API_KEY is not configured on this server.' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: getFromAddress(),
        to: params.to,
        subject: params.subject,
        html: params.html,
        // Plain-text alternative (Branded HTML Emails, 2026-09-07): standard email practice —
        // improves deliverability (some spam filters penalize HTML-only messages) and covers
        // genuinely text-only mail clients. Optional here only because a handful of very old
        // call sites might not have migrated yet mid-refactor; every real call site in this
        // project passes it via renderEmail()'s own { html, text } pair.
        ...(params.text ? { text: params.text } : {})
      })
    });

    const body = await res.json();

    if (!res.ok) {
      const message = (body && body.message) || ('Resend request failed: HTTP ' + res.status);
      await logEmail(admin, params, 'failed', null, message);
      return { sent: false, resendId: null, error: message };
    }

    await logEmail(admin, params, 'sent', body.id || null, null);
    return { sent: true, resendId: body.id || null, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEmail(admin, params, 'failed', null, message);
    return { sent: false, resendId: null, error: message };
  }
}

async function logEmail(
  admin: any,
  params: { to: string | string[]; subject: string; relatedEntityType?: string; relatedEntityId?: string },
  status: 'sent' | 'failed',
  resendId: string | null,
  errorMessage: string | null
): Promise<void> {
  // A logging failure is swallowed, not thrown — the real email send (or real failure) has
  // already happened by this point; a broken audit-trail write must never retroactively
  // fail the caller's own primary action.
  try {
    // email_log.recipient is a single text column (pre-existing schema, Backend Migration
    // Phase D Stage 1) — a multi-recipient PM notification (Branded HTML Emails, 2026-09-07)
    // logs one row per real recipient rather than a comma-joined string, so each PM's own
    // delivery status/resend_id is independently visible, not conflated into one row.
    const recipients = Array.isArray(params.to) ? params.to : [params.to];
    for (const recipient of recipients) {
      await admin.from('email_log').insert({
        recipient: recipient,
        subject: params.subject,
        related_entity_type: params.relatedEntityType || null,
        related_entity_id: params.relatedEntityId || null,
        status: status,
        resend_id: resendId,
        error_message: errorMessage
      });
    }
  } catch (_err) {
    // Deliberately silent — see this function's own caller-facing comment above.
  }
}

// ============================================================================================
// ★ Branded HTML email template (2026-09-07) — the shared shell EVERY email in this project
// now renders through, built to the approved email_template_preview_v2.html reference
// (structure and reasoning matched; exact pixel values are this file's own, not a literal
// copy). Extends this same file rather than a parallel template system, per instruction.
//
// EMAIL CLIENT COMPATIBILITY, the reason this looks nothing like the site's own CSS: table-
// based layout and INLINE styles only, throughout — no flexbox, no CSS grid, no
// backdrop-filter/blur, none of the site's own glass aesthetic. Outlook (desktop, using the
// Word rendering engine) and a long tail of other real mail clients silently drop or
// mis-render flexbox/grid/backdrop-filter; nested <table>s with inline style="..." attributes
// are the one layout approach that reliably survives across all of them. This is a
// deliberate, disclosed departure from the site's own visual language, not an oversight.
//
// FOOTER TYPE, an explicit parameter every caller must declare, never inferred: 'investment'
// renders all three legal blocks including the alternative-investments risk paragraph;
// 'general' renders only the confidentiality + no-binding-agreement clauses (the risk
// paragraph is omitted entirely, not just visually hidden). See CLAUDE.md's own Tech Stack
// entry for the exact per-trigger mapping decided for every real call site in this project.
//
// ★ SENDER ADDRESS — RESOLVED (2026-09-07, same day as this template): marketswave.net is now
// a fully verified Resend sending domain (DKIM/SPF MX/SPF TXT all confirmed Verified).
// sendEmail()'s own `from` now defaults to `Marketswave <noreply@marketswave.net>` via
// getFromAddress() below (overridable per environment via an EMAIL_FROM_ADDRESS secret,
// mirroring SITE_URL's own pattern) — replacing the old Resend sandbox sender
// (`onboarding@resend.dev`), which also lifts that sandbox's real recipient restriction (it
// could previously only deliver to Resend's own fixed test address or the exact email
// registered to the Resend account). Deliberately a `noreply@` address, not `support@` or
// similar — this project has no real monitored inbox on marketswave.net yet (see the next
// paragraph), and a `noreply@` sender makes that honest rather than implying repliability.
//
// ★ PLACEHOLDER DOMAIN — STILL OPEN, a separate, distinct decision, confirmed directly rather
// than assumed: the footer's own displayed "support@marketswave.com" remains a placeholder,
// NOT a real, monitored inbox, even though marketswave.net itself is now real and verified.
// support@marketswave.net does not exist as a monitored mailbox yet — deliberately NOT
// switched to it, since doing so would point real clients at a real-looking address on a real
// domain that nobody reads, which is a worse failure mode than an already-obviously-fake
// .com placeholder. Logged as its own follow-up item (Backend Requirements Register) rather
// than silently left implied-resolved by the sender-address fix above — set up and confirm a
// real, monitored support@marketswave.net inbox, then update FOOTER_SUPPORT_EMAIL below.
//
// ★ SITE_URL — RESOLVED (2026-09-07, same day as the sender-address fix above): the project's
// custom domain, marketswave.net, is now fully live with HTTPS enforced (a real CNAME record
// pointing GitHub Pages at it, confirmed via a committed CNAME file at the repo root). Every
// CTA button now links to the real production domain instead of the old
// de1stpromise.github.io/Marketswave GitHub Pages URL — that old URL is retired as this
// project's own canonical address, though GitHub Pages itself may still resolve it as an
// alias; email links should never point there again. Still overridable via a real SITE_URL
// secret per environment if this ever needs to differ (local/staging never need real,
// clickable links the way a genuinely delivered email does, so the default is deliberately
// the one real, canonical production URL).
// ============================================================================================

const COLORS = {
  navy: '#1B3A4B',
  cream: '#F7F6F3',
  border: '#EDE8E1',
  mutedLabel: '#6B7178',
  bodyText: '#4A4A4A',
  legalText: '#8A8A8A',
  legalTextLight: '#A5A5A5',
  divider: '#E2DDD5',
  gold: '#C8860A',
  goldCalloutBg: '#FBF3E4',
  goldCalloutBorder: '#E9C77A'
};

// ★ Placeholder — STILL OPEN, deliberately not updated to the now-verified marketswave.net
// domain. See this file's own header comment above ("PLACEHOLDER DOMAIN — STILL OPEN") for
// why: no monitored support@marketswave.net inbox exists yet.
const FOOTER_SUPPORT_EMAIL = 'support@marketswave.com';

// ★ Resolved 2026-09-07 — see this file's own header comment above ("SENDER ADDRESS —
// RESOLVED"). Override per environment via an EMAIL_FROM_ADDRESS secret if this domain's own
// sending needs ever diverge from the one real, confirmed-verified default.
function getFromAddress(): string {
  return Deno.env.get('EMAIL_FROM_ADDRESS') || 'Marketswave <noreply@marketswave.net>';
}

// ★ Resolved 2026-09-07 — see this file's own header comment above ("SITE_URL — RESOLVED").
// Override with a real SITE_URL secret (`supabase secrets set SITE_URL=...`) per environment
// if this ever needs to differ from the one real, canonical production domain.
function getSiteUrl(): string {
  return Deno.env.get('SITE_URL') || 'https://marketswave.net';
}

export function siteLink(pagePath: string): string {
  const base = getSiteUrl().replace(/\/$/, '');
  return base + '/' + pagePath.replace(/^\//, '');
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailDetailRow {
  label: string;
  value: string;
}

export interface EmailCallout {
  label?: string;
  text: string;
}

export interface EmailCta {
  text: string;
  href: string;
}

export interface EmailTemplateInput {
  heading: string;
  // One or more plain-text paragraphs — escaped and wrapped automatically. The FIRST line
  // conventionally opens with "Hi <Name>," matching the approved preview's own structure
  // (a single flowing sentence, not a separate greeting paragraph).
  introParagraphs: string[];
  detailRows?: EmailDetailRow[];
  callout?: EmailCallout;
  cta?: EmailCta;
  footerType: 'investment' | 'general';
}

const RISK_PARAGRAPH =
  'Alternative investments involve specific risks that may be greater than those associated with traditional investments; are not suitable for all clients; and intended for experienced and sophisticated investors who meet specific suitability requirements and are willing to bear the high economic risks of the investment. Investments of this type may engage in speculative investment practices; carry additional risk of loss, including possibility of partial or total loss of invested capital, due to the nature and volatility of the underlying investments; and are generally considered to be illiquid due to restrictive repurchase procedures. These investments may also involve different regulatory and reporting requirements, complex tax structures, and delays in distributing important tax information.';

const DISCLAIMER_PARAGRAPH =
  'This e-mail, including attachments, is intended only for the addressee(s) indicated, and may contain non-public, proprietary, confidential or legally privileged information. If you are not an intended recipient or an authorized agent of an intended recipient, you are hereby notified that any dissemination, distribution or copying of the information contained in or transmitted with this email is unauthorized and strictly prohibited. If you received this in error, please advise us and then delete the e-mail and its contents.';

const NO_BINDING_AGREEMENT_PARAGRAPH =
  "Unless and until the material terms of any potential transaction, if any, are agreed upon and both parties sign a written agreement reflecting such terms, it is not the sender's intent for our e-mail exchange to constitute a binding agreement.";

const AUTOMATED_MESSAGE_LINE =
  'This is an automated message about your Marketswave account. Please do not reply to this email.';

function buildDetailRowsHtml(rows: EmailDetailRow[]): string {
  return rows
    .map((row, i) => {
      const isLast = i === rows.length - 1;
      const borderStyle = isLast ? '' : ' border-bottom:1px solid ' + COLORS.border + ';';
      return (
        '<tr>' +
        '<td style="padding:13px 18px; font-size:13px; color:' + COLORS.mutedLabel + ';' + borderStyle + '">' + escapeHtml(row.label) + '</td>' +
        '<td style="padding:13px 18px; font-size:14px; color:' + COLORS.navy + '; font-weight:600; text-align:right;' + borderStyle + '">' + escapeHtml(row.value) + '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function buildCalloutHtml(callout: EmailCallout): string {
  const label = callout.label ? escapeHtml(callout.label) : 'Reason';
  return (
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + COLORS.goldCalloutBg + '; border:1px solid ' + COLORS.goldCalloutBorder + '; border-radius:6px; margin-bottom:26px;">' +
    '<tr><td style="padding:14px 18px;">' +
    '<p style="margin:0 0 4px; font-size:11px; font-weight:700; color:' + COLORS.gold + '; text-transform:uppercase; letter-spacing:0.04em;">' + label + '</p>' +
    '<p style="margin:0; font-size:14px; color:' + COLORS.navy + '; line-height:1.55;">' + escapeHtml(callout.text) + '</p>' +
    '</td></tr>' +
    '</table>'
  );
}

function buildCtaHtml(cta: EmailCta): string {
  return (
    '<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">' +
    '<tr><td style="background:' + COLORS.navy + '; border-radius:7px;">' +
    '<a href="' + escapeHtml(cta.href) + '" style="display:inline-block; padding:13px 26px; font-size:14px; font-weight:600; color:' + COLORS.cream + '; text-decoration:none;">' + escapeHtml(cta.text) + '</a>' +
    '</td></tr>' +
    '</table>'
  );
}

function buildFooterHtml(footerType: 'investment' | 'general'): string {
  const legalBlocks: string[] = [];
  if (footerType === 'investment') {
    legalBlocks.push('<p style="margin:0 0 12px; font-size:10.5px; color:' + COLORS.legalText + '; line-height:1.65;">' + RISK_PARAGRAPH + '</p>');
  }
  legalBlocks.push(
    '<p style="margin:0 0 12px; font-size:10.5px; color:' + COLORS.legalText + '; line-height:1.65;"><strong style="color:' + COLORS.mutedLabel + ';">Disclaimer:</strong> ' + DISCLAIMER_PARAGRAPH + '</p>'
  );
  legalBlocks.push('<p style="margin:0 0 14px; font-size:10.5px; color:' + COLORS.legalText + '; line-height:1.65;">' + NO_BINDING_AGREEMENT_PARAGRAPH + '</p>');
  legalBlocks.push('<p style="margin:0; font-size:10.5px; color:' + COLORS.legalTextLight + '; line-height:1.6;">' + AUTOMATED_MESSAGE_LINE + '</p>');

  return (
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + COLORS.cream + '; border-top:1px solid ' + COLORS.border + '; margin-top:26px;">' +
    '<tr><td style="padding:26px 32px 20px;">' +
    '<p style="margin:0 0 4px; font-size:13px; color:' + COLORS.navy + '; font-weight:700;">Marketswave</p>' +
    '<p style="margin:0; font-size:12px; color:' + COLORS.mutedLabel + '; line-height:1.6;"><a href="mailto:' + FOOTER_SUPPORT_EMAIL + '" style="color:' + COLORS.navy + '; text-decoration:none;">' + FOOTER_SUPPORT_EMAIL + '</a></p>' +
    '</td></tr>' +
    '<tr><td style="padding:0 32px;"><div style="height:1px; background:' + COLORS.divider + '; font-size:0; line-height:0;">&nbsp;</div></td></tr>' +
    '<tr><td style="padding:18px 32px 26px;">' + legalBlocks.join('') + '</td></tr>' +
    '</table>'
  );
}

export function renderEmail(input: EmailTemplateInput): { html: string; text: string } {
  const introHtml = input.introParagraphs
    .map((p) => '<p style="margin:0 0 24px; font-size:15px; color:' + COLORS.bodyText + '; line-height:1.65;">' + escapeHtml(p) + '</p>')
    .join('');

  const detailTableHtml = input.detailRows && input.detailRows.length
    ? '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + COLORS.border + '; border-radius:6px; margin-bottom:26px;">' + buildDetailRowsHtml(input.detailRows) + '</table>'
    : '';

  const calloutHtml = input.callout ? buildCalloutHtml(input.callout) : '';
  const ctaHtml = input.cta ? buildCtaHtml(input.cta) : '';

  const html =
    '<!DOCTYPE html>' +
    '<html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>' + escapeHtml(input.heading) + '</title></head>' +
    '<body style="margin:0; padding:32px 16px; background:#E8E6E1; font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background:#FFFFFF; border-radius:8px; overflow:hidden;">' +
    // Header
    '<tr><td>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + COLORS.cream + ';">' +
    '<tr><td style="padding:26px 32px 22px;"><span style="font-size:19px; font-weight:800; color:' + COLORS.navy + '; letter-spacing:-0.01em;">MARKETSWAVE</span></td></tr>' +
    '<tr><td style="height:3px; background:' + COLORS.navy + '; line-height:3px; font-size:0;">&nbsp;</td></tr>' +
    '</table>' +
    '</td></tr>' +
    // Body
    '<tr><td>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:34px 32px 8px;">' +
    '<h1 style="margin:0 0 14px; font-size:21px; font-weight:700; color:' + COLORS.navy + '; line-height:1.3;">' + escapeHtml(input.heading) + '</h1>' +
    introHtml +
    detailTableHtml +
    calloutHtml +
    ctaHtml +
    '</td></tr></table>' +
    '</td></tr>' +
    // Footer
    '<tr><td>' + buildFooterHtml(input.footerType) + '</td></tr>' +
    '</table>' +
    '</td></tr></table>' +
    '</body></html>';

  const textLines: string[] = [];
  textLines.push(input.heading.toUpperCase());
  textLines.push('');
  input.introParagraphs.forEach((p) => { textLines.push(p); textLines.push(''); });
  if (input.detailRows && input.detailRows.length) {
    input.detailRows.forEach((row) => textLines.push(row.label + ': ' + row.value));
    textLines.push('');
  }
  if (input.callout) {
    textLines.push((input.callout.label || 'Reason') + ': ' + input.callout.text);
    textLines.push('');
  }
  if (input.cta) {
    textLines.push(input.cta.text + ': ' + input.cta.href);
    textLines.push('');
  }
  textLines.push('---');
  textLines.push('Marketswave');
  textLines.push(FOOTER_SUPPORT_EMAIL);
  textLines.push('');
  if (input.footerType === 'investment') {
    textLines.push(RISK_PARAGRAPH);
    textLines.push('');
  }
  textLines.push('Disclaimer: ' + DISCLAIMER_PARAGRAPH);
  textLines.push('');
  textLines.push(NO_BINDING_AGREEMENT_PARAGRAPH);
  textLines.push('');
  textLines.push(AUTOMATED_MESSAGE_LINE);

  return { html, text: textLines.join('\n') };
}

// ============================================================================================
// ★ PM-recipient helper (Branded HTML Emails, 2026-09-07) — this project moved to real,
// individually-distinguishable per-PM accounts in Backend Migration Phase C — Stage 1 (there
// is no longer a single shared PM identity/email to hardcode), so the first PM-facing emails
// in the system (new client application, new support ticket, new document upload) need a
// real way to reach EVERY currently-registered PM, not a guessed single address. Queries
// user_roles (the real source of truth for the admin claim, same table the custom access
// token hook itself reads) for every is_admin row, then resolves each to a real email via
// the Admin API (user_roles itself carries no email column by design — see that table's own
// migration comment). Returns an empty array (never throws) if no admin exists yet or the
// lookup fails — callers already treat a failed/empty send as a non-fatal, logged event, per
// this file's own standing FAILURE HANDLING discipline above.
export async function getAdminEmails(admin: any): Promise<string[]> {
  try {
    const { data: roles, error: rolesErr } = await admin.from('user_roles').select('user_id').eq('is_admin', true);
    if (rolesErr || !roles || roles.length === 0) return [];
    const adminIds = new Set(roles.map((r: { user_id: string }) => r.user_id));

    // ★ Real bug found and fixed (2026-09-07): listUsers() with no params defaults to
    // page 1 / 50 users per page, newest-first — this project's own real Auth store has
    // accumulated well over 50 real users (mostly leftover test accounts from this project's
    // own verify-* scripts across many sessions), which silently pushed the real, EARLIEST-
    // created bootstrap PM account (pm@marketswave.local) onto page 2, making
    // getAdminEmails() genuinely return [] the moment total real users crossed 50 — every
    // PM-facing notification in the app depends on this function, so this was a real,
    // user-facing regression waiting to happen at scale, not a hypothetical. Confirmed
    // directly against the real local stack (54 total users, pm@marketswave.local absent
    // from a bare listUsers() call, present once paginated through). Fixed by paging through
    // every page rather than assuming one call covers every real user, present or future —
    // the number of real PMs (adminIds) is always small, but the total user count is not
    // bounded, and never should have been assumed to be.
    const emails: string[] = [];
    let page = 1;
    for (;;) {
      const { data: usersPage, error: usersErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (usersErr || !usersPage || !usersPage.users) break;
      for (const u of usersPage.users as { id: string; email?: string }[]) {
        if (adminIds.has(u.id) && u.email) emails.push(u.email);
      }
      if (!usersPage.nextPage) break;
      page = usersPage.nextPage;
    }
    return emails;
  } catch (_err) {
    return [];
  }
}
