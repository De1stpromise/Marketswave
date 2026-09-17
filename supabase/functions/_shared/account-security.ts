// ★ PM tool revamp, part 8 (2026-09-17) — a PM's own account security, composed server-side.
//
// ★ WHAT IS REAL HERE AND WHAT IS NOT, established by querying the real tables before any of
// this was written rather than assumed from a mockup (register row 224's lesson — a designed
// feature with no backend behind it):
//
//   SESSIONS   — REAL. auth.sessions carries id, created_at, updated_at, refreshed_at,
//                not_after, user_agent, ip, aal. Device comes from the user agent and
//                location from the IP, both through the parsers visitor-presence.ts already
//                owns. "This device" is matched on the requester's OWN JWT session_id claim,
//                so it is identified by the token rather than by anything the browser said.
//   ACTIVITY   — PARTLY REAL, and thinner than a "recent sign-ins" panel implies. GoTrue
//                records successes (login, logout, token_refreshed, token_revoked,
//                user_updated_password) and records NO FAILED ATTEMPTS AT ALL. It also carries
//                NO device and NO location: ip_address was blank on all 62,564 rows on this
//                stack and the payload has no user agent. So this returns time + action +
//                provider, and reports failuresRecorded:false so the page can say so out loud.
//                A successes-only list under a "sign-ins" heading would read as "nobody has
//                failed to sign in", which is a claim this data cannot make.
//
// ★ EVERY READ CHECKS ITS ERROR (register row 233). On this page a swallowed read is worse
// than elsewhere: an empty sessions list reads as "you are signed in nowhere else", which is
// a reassuring statement about a security surface, made from no data at all. must() throws
// and the page paints a real error card with a retry.

import { geolocate, parseUserAgent } from './visitor-presence.ts';

// Geolocating is one network call per distinct public IP. A PM with many sessions (this
// project's own local stack has 75 for the bootstrap account, nearly all opened by
// verification scripts) would otherwise turn one page load into dozens of provider lookups.
// Distinct IPs only, and beyond this cap the location is honestly null rather than guessed.
const MAX_GEO_LOOKUPS = 12;
const MAX_SESSIONS_RETURNED = 50;

// deno-lint-ignore no-explicit-any
async function must<T>(p: Promise<{ data: T; error: any }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error('could not read ' + what + ': ' + error.message);
  return data;
}

// ★ A USER AGENT THAT IS NOT A BROWSER SHOULD SAY SO. parseUserAgent() answers "Unknown
// device · Unknown browser" for `node`, `curl/8.14.1`, a Deno runtime or a python client —
// accurate but unhelpful, and on a security panel "unknown" invites alarm where the honest
// answer is mundane. These are named for what they are. The list is deliberately short and
// anchored to the start of the string: anything genuinely unrecognised still says "Unknown".
const SCRIPT_AGENTS: [RegExp, string][] = [
  [/^node($|\/)/i, 'Node.js script'],
  [/^curl\//i, 'curl'],
  [/^wget\//i, 'wget'],
  [/^python-requests\//i, 'Python script'],
  [/^Deno\//i, 'Deno script'],
  [/^PostmanRuntime\//i, 'Postman'],
  [/^supabase-js/i, 'Supabase client'],
  [/^Go-http-client\//i, 'Go client'],
  [/^okhttp\//i, 'okhttp client']
];

export function describeAgent(ua: string | null): { device: string; browser: string; label: string; isScript: boolean } {
  const raw = (ua || '').trim();
  if (!raw) return { device: 'Unknown device', browser: 'Unknown client', label: 'Unknown client', isScript: false };
  for (const [re, name] of SCRIPT_AGENTS) {
    if (re.test(raw)) return { device: name, browser: name, label: name, isScript: true };
  }
  const parsed = parseUserAgent(raw);
  const known = parsed.device !== 'Unknown device' || parsed.browser !== 'Unknown browser';
  const label = known ? parsed.browser + ' on ' + parsed.device : 'Unknown client';
  return { device: parsed.device, browser: parsed.browser, label, isScript: false };
}

// Human-readable action names for the activity panel. An action this deployment has never
// produced is shown verbatim rather than mapped to a guess.
const ACTION_LABELS: Record<string, string> = {
  login: 'Signed in',
  logout: 'Signed out',
  token_refreshed: 'Session refreshed',
  token_revoked: 'Session revoked',
  user_updated_password: 'Password changed',
  user_recovery_requested: 'Password reset requested',
  user_modified: 'Account modified',
  user_updated: 'Account updated'
};

export function actionLabel(action: string | null): string {
  if (!action) return 'Unknown action';
  return ACTION_LABELS[action] || action.replace(/_/g, ' ');
}

export interface AccountSecurityOptions {
  userId: string;
  email: string | null;
  currentSessionId: string | null;
  activityDays?: number;
}

// deno-lint-ignore no-explicit-any
export async function buildAccountSecurity(admin: any, opts: AccountSecurityOptions) {
  const days = opts.activityDays && opts.activityDays > 0 ? opts.activityDays : 30;

  const [sessionRows, activityRows] = await Promise.all([
    must(admin.rpc('pm_auth_sessions', { p_user_id: opts.userId }), 'your sessions'),
    must(admin.rpc('pm_auth_activity', { p_user_id: opts.userId, p_days: days, p_limit: 50 }), 'your recent account activity')
  ]) as [Record<string, unknown>[], Record<string, unknown>[]];

  // ---- locations: one lookup per DISTINCT public IP, capped ---------------------------------
  const distinctIps: string[] = [];
  for (const s of sessionRows) {
    const ip = (s.ip as string | null) || null;
    if (ip && distinctIps.indexOf(ip) === -1) distinctIps.push(ip);
  }
  const geoByIp: Record<string, { city: string | null; country: string | null }> = {};
  let geoLookupsSkipped = 0;
  for (let i = 0; i < distinctIps.length; i++) {
    if (i >= MAX_GEO_LOOKUPS) { geoLookupsSkipped += 1; continue; }
    const g = await geolocate(distinctIps[i]);
    geoByIp[distinctIps[i]] = { city: g.city, country: g.country };
  }

  function locationFor(ip: string | null): string | null {
    if (!ip) return null;
    const g = geoByIp[ip];
    if (!g) return null;                       // private IP, provider miss, or past the cap
    if (g.city && g.country) return g.city + ', ' + g.country;
    return g.country || g.city || null;
  }

  const total = sessionRows.length;
  const sessions = sessionRows.slice(0, MAX_SESSIONS_RETURNED).map((s) => {
    const agent = describeAgent((s.user_agent as string | null) || null);
    const ip = (s.ip as string | null) || null;
    return {
      id: s.id as string,
      isCurrent: !!opts.currentSessionId && s.id === opts.currentSessionId,
      device: agent.device,
      browser: agent.browser,
      label: agent.label,
      isScript: agent.isScript,
      userAgent: (s.user_agent as string | null) || null,
      ip,
      location: locationFor(ip),
      createdAt: s.created_at as string,
      lastActiveAt: (s.refreshed_at || s.updated_at || s.created_at) as string,
      notAfter: (s.not_after as string | null) || null,
      aal: (s.aal as string | null) || null
    };
  });

  const activity = activityRows.map((a) => ({
    id: a.id as string,
    at: a.created_at as string,
    action: (a.action as string | null) || null,
    label: actionLabel((a.action as string | null) || null),
    provider: (a.provider as string | null) || null
  }));

  return {
    account: {
      userId: opts.userId,
      email: opts.email,
      role: 'Portfolio Manager'
    },
    sessions: {
      total,
      returned: sessions.length,
      currentSessionId: opts.currentSessionId,
      currentSessionListed: sessions.some((s) => s.isCurrent),
      geoLookupsSkipped,
      rows: sessions
    },
    activity: {
      days,
      total: activity.length,
      // ★ Stated in the payload, not only in the page's copy, so the fact travels with the
      // data: GoTrue records no failed sign-in attempts anywhere, and these rows carry no
      // device and no location because the audit table holds neither.
      failuresRecorded: false,
      devicesRecorded: false,
      locationsRecorded: false,
      rows: activity
    }
  };
}
