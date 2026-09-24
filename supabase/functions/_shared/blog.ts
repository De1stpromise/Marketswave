// blog.ts — the rules shared by every blog Edge Function (2026-09-24).
//
// Kept here rather than in each function for the reason _shared/hys-engine.ts already
// established: two copies of a rule are two rules the moment one is edited.

export const CATEGORIES = ['explainer', 'private-equity', 'article', 'company-news'] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  'explainer': 'Explainer',
  'private-equity': 'Private equity',
  'article': 'Article',
  'company-news': 'Company news',
};

export const DEFAULT_BYLINE = 'Marketswave';

// ★ THE LIMITS, AND WHY THESE NUMBERS.
//
// BODY_MAX 1500 characters — roughly 250 words. Long enough for a real question with context,
// short enough that a comment thread stays readable and that one person cannot fill a post's
// page. Enforced BOTH here and by the table's own CHECK, so a direct privileged insert cannot
// exceed it either.
//
// RATE_MAX 5 per RATE_WINDOW_MINUTES 10 — a person having a genuine exchange writes a comment
// and a couple of replies; five in ten minutes is well clear of that and well short of what
// makes a page unusable. It counts a client's comments ACROSS ALL POSTS, not per post, because
// the thing worth limiting is the person, not the page.
export const BODY_MAX = 1500;
export const RATE_MAX = 5;
export const RATE_WINDOW_MINUTES = 10;

// ★ THE FLAG IS A PROMPT, NOT A DECISION (requirement 14). A flagged comment publishes exactly
// like any other and is never hidden; the flag only raises it to the PM, because on a financial
// firm's own site a client's "made 38% on X" reads to a stranger as a performance claim from
// Marketswave. Three narrow triggers, each one a thing a reader could mistake for a figure we
// stand behind:
//   1. a percentage        — "38%", "38 percent"
//   2. a currency figure   — "$4,000", "4000 USD", "£250"
//   3. a return in words   — return, gain, profit, yield, "made ... on/from"
// Deliberately NOT a sentiment or keyword blocklist: the point is money-shaped claims, not
// opinions, and a rule that flags everything gets ignored like any alarm that never stops.
const RE_PERCENT = /\d+(?:[.,]\d+)?\s*(?:%|percent\b)/i;
const RE_CURRENCY = /(?:[$€£]\s?\d)|(?:\b\d[\d,.]*\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b)/i;
const RE_RETURN = /\b(?:returns?|gains?|profits?|yields?|roi)\b|\bmade\s+[^.!?]{0,20}\b(?:on|from)\b/i;

export type FlagResult = { flagged: boolean; reason: string | null };

export function flagComment(body: string): FlagResult {
  const reasons: string[] = [];
  if (RE_PERCENT.test(body)) reasons.push('a percentage');
  if (RE_CURRENCY.test(body)) reasons.push('a currency figure');
  if (RE_RETURN.test(body)) reasons.push('a return');
  if (reasons.length === 0) return { flagged: false, reason: null };
  const list = reasons.length === 1
    ? reasons[0]
    : reasons.slice(0, -1).join(', ') + ' and ' + reasons[reasons.length - 1];
  return { flagged: true, reason: 'Mentions ' + list + '. Public now — on your site that can read as a performance claim from Marketswave.' };
}

/** A slug from a title, matching the blog_posts CHECK. */
export function slugify(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/**
 * ★ THE ONE GATE EVERY CLIENT WRITE GOES THROUGH. Only a signed-in client whose account is
 * ACTIVE may like, comment or reply. Pending-review, rejected and anonymous callers are
 * refused here, server-side — the page hides the controls too, but a hidden control is not a
 * rule.
 *
 * Returns the client's row on success so the caller can denormalise the display name without a
 * second read.
 */
export async function requireActiveClient(
  admin: any,
  claims: any,
): Promise<{ ok: true; clientId: string; name: string } | { ok: false; status: number; error: string }> {
  if (claims.is_anonymous === true) {
    return { ok: false, status: 403, error: 'Sign in to your Marketswave account to join the conversation.' };
  }
  const clientId = claims.sub as string;
  const { data: row } = await admin
    .from('clients').select('id, name, status').eq('id', clientId).maybeSingle();
  if (!row) {
    return { ok: false, status: 403, error: 'Sign in to your Marketswave account to join the conversation.' };
  }
  if (row.status !== 'active') {
    return {
      ok: false, status: 403,
      error: row.status === 'pending_review'
        ? 'Your application is still under review. You can read the blog now, and join the conversation once your account is open.'
        : 'This account cannot post to the blog. Contact support if you think that is wrong.',
    };
  }
  return { ok: true, clientId, name: row.name };
}

/** Client comments in the window, for the rate limit. */
export async function commentsInWindow(admin: any, clientId: string): Promise<number> {
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString();
  const { count } = await admin
    .from('blog_comments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', since);
  return count || 0;
}
