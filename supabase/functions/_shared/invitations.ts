// Client invitations — the pieces every invitation function shares (2026-09-20, row 254).
//
// One place for: how long a link lives, how a token is minted and hashed, how a stale row is
// settled to 'expired' on touch, and the one shape the admin page renders. The same
// drift-prevention discipline _shared/hys-engine.ts established: a second copy of the expiry
// rule or the hash would be a second place for the two to disagree.

export const INVITATION_TTL_DAYS = 14;
// "Expiring soon" on the pending list: inside the last two days of a fourteen-day link.
export const EXPIRING_SOON_HOURS = 48;

const LIVE = ['sent', 'opened'];

/** A fresh raw token — 32 random bytes, base64url, ~43 chars. Exists only in the email. */
export function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** sha256 hex of a raw token — what the table stores and what get-invitation looks up by. */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function isLive(row: any): boolean {
  return LIVE.includes(row.status) && new Date(row.expires_at).getTime() > Date.now();
}

/** A live-by-status row whose expiry has passed. Settled to 'expired' by whoever touches it. */
export function isTimeExpired(row: any): boolean {
  return LIVE.includes(row.status) && new Date(row.expires_at).getTime() <= Date.now();
}

/**
 * Settle-on-touch: flip every sent|opened row whose expires_at has passed to 'expired'.
 * Returns the number settled. The stored status then reflects reality for the partial
 * unique index (one live invitation per address) and for the list, without a sweep job.
 */
export async function settleExpired(admin: any, filter?: { email?: string; id?: string }): Promise<number> {
  let q = admin.from('client_invitations')
    .update({ status: 'expired' })
    .in('status', LIVE)
    .lte('expires_at', new Date().toISOString());
  if (filter?.email) q = q.eq('email', filter.email.toLowerCase().trim());
  if (filter?.id) q = q.eq('id', filter.id);
  const { data, error } = await q.select('id');
  if (error) throw new Error('Could not settle expired invitations: ' + error.message);
  return (data || []).length;
}

/** The one shape the admin page renders. Never includes the hash. */
export function toClientShape(row: any) {
  const expiresMs = new Date(row.expires_at).getTime();
  const live = isLive(row);
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    note: row.note,
    status: isTimeExpired(row) ? 'expired' : row.status,
    createdAt: row.created_at,
    lastSentAt: row.last_sent_at,
    expiresAt: row.expires_at,
    openedAt: row.opened_at,
    acceptedAt: row.accepted_at,
    acceptedClientId: row.accepted_client_id,
    expiringSoon: live && (expiresMs - Date.now()) <= EXPIRING_SOON_HOURS * 60 * 60 * 1000,
    // Attribution is CAPTURED, not displayed (row 228's rule until multi-PM). The page gets
    // no invited_by / invited_by_email at all, so there is nothing to render by accident.
  };
}

export function normaliseEmail(v: unknown): string {
  return String(v == null ? '' : v).trim().toLowerCase();
}

export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * The invitation email — one composition for create AND resend, so the two cannot drift.
 * `note` is the PM's optional message, rendered as a callout under the intro; the CTA is the
 * signup link carrying the RAW token (its only appearance anywhere).
 */
export function invitationEmailInput(row: any, rawToken: string, siteLink: (p: string) => string) {
  const first = String(row.full_name || '').trim().split(/\s+/)[0] || 'there';
  const input: any = {
    heading: 'You have been invited to Marketswave',
    introParagraphs: [
      'Hi ' + first + ', your Portfolio Manager at Marketswave has invited you to open an account.',
      'The link below opens signup with your name and email already filled in. Everything else — your details, financial profile, goals, the risk questionnaire and your identity documents — is yours to complete. It takes about ten minutes.',
      'This invitation expires in ' + INVITATION_TTL_DAYS + ' days.'
    ],
    cta: { text: 'Complete your signup', href: siteLink('signup.html?invite=' + encodeURIComponent(rawToken)) },
    footerType: 'general'
  };
  if (row.note && String(row.note).trim()) {
    input.callout = { label: 'A note from your Portfolio Manager', text: String(row.note).trim() };
  }
  return input;
}
