// ★ Visitor presence (2026-09-13) — the shared pieces of track-visit that are pure functions
// of a request: geolocation from an IP (the IP is an argument here and is never returned or
// stored — the caller discards it), user-agent parsing, referrer parsing, and the live-window
// rule the PM page and the notable-visitor thresholds share. Kept out of the function so the
// verification can exercise the parsers directly and so send-proactive-message can share the
// same "is this session live" definition.

// A session is LIVE when its last heartbeat is within this window and it has not sent a
// leave beacon. The page heartbeats every 20 s, so a closed laptop lid or a dropped
// connection — no beacon — drops out of "live" within 45 s of its last heartbeat, and its
// duration is measured to that last heartbeat, never padded.
export const LIVE_WINDOW_SECONDS = 45;
export const HEARTBEAT_SECONDS = 20;

// Proactive chat etiquette, enforced server-side by send-proactive-message.
export const MIN_SESSION_SECONDS_BEFORE_MESSAGE = 30;

// Notable-visitor email thresholds (one email per session, at most).
export const ENGAGED_SESSION_SECONDS = 5 * 60;
export const NOTABLE_BURST_GUARD_SECONDS = 120; // never two presence emails within this window

export interface GeoResult { countryCode: string | null; country: string | null; city: string | null; provider: string | null; }

function isPrivateIp(ip: string): boolean {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|fc|fd|fe80)/i.test(ip) || ip === 'localhost';
}

export function clientIpFrom(req: Request): string | null {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  return real ? real.trim() : null;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// Provider chain — first answer wins, none means "Unknown location" (never a guess).
//   ipwho.is  keyless, city-level, ~10k lookups/month free
//   ipinfo.io keyless ~1k/day; 50k/month with a free token (IPINFO_TOKEN)
// One lookup per SESSION START, so 10k/month is ~330 new sessions a day before the second
// provider carries the rest. City accuracy is "usually right on fixed broadband"; a VPN or a
// mobile carrier resolves to its exit/gateway city, which is what the PM will see.
const GEO_PROVIDERS: { name: string; lookup: (ip: string) => Promise<GeoResult | null> }[] = [
  {
    name: 'ipwho.is',
    lookup: async (ip) => {
      const r = await withTimeout(fetch('https://ipwho.is/' + encodeURIComponent(ip)), 3500);
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || j.success === false || !j.country_code) return null;
      return { countryCode: j.country_code, country: j.country || null, city: j.city || null, provider: 'ipwho.is' };
    }
  },
  {
    name: 'ipinfo.io',
    lookup: async (ip) => {
      const token = Deno.env.get('IPINFO_TOKEN');
      const r = await withTimeout(fetch('https://ipinfo.io/' + encodeURIComponent(ip) + '/json' + (token ? '?token=' + encodeURIComponent(token) : '')), 3500);
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || !j.country) return null;
      return { countryCode: j.country, country: countryName(j.country), city: j.city || null, provider: 'ipinfo.io' };
    }
  }
];

export async function geolocate(ip: string | null): Promise<GeoResult> {
  const none: GeoResult = { countryCode: null, country: null, city: null, provider: null };
  if (!ip || isPrivateIp(ip)) return none;
  for (const p of GEO_PROVIDERS) {
    try {
      const r = await p.lookup(ip);
      if (r) return r;
    } catch (_e) { /* next provider */ }
  }
  return none;
}

function countryName(code: string): string | null {
  try {
    const dn = new (Intl as any).DisplayNames(['en'], { type: 'region' });
    return dn.of(code) || null;
  } catch (_e) { return null; }
}

// Device + browser from the User-Agent, coarse on purpose ("Mac · Chrome"). Order matters —
// Edge, Opera and Samsung all carry "Chrome" and Chrome carries "Safari" (the same nesting
// settings.html's own parser records).
export function parseUserAgent(ua: string | null): { device: string; browser: string } {
  const s = ua || '';
  let device = 'Unknown device';
  if (/iPad/i.test(s) || (/Macintosh/.test(s) && /Mobile/.test(s))) device = 'iPad';
  else if (/iPhone/i.test(s)) device = 'iPhone';
  else if (/Android/i.test(s)) device = 'Android';
  else if (/Windows/i.test(s)) device = 'Windows';
  else if (/Macintosh|Mac OS/i.test(s)) device = 'Mac';
  else if (/CrOS/i.test(s)) device = 'ChromeOS';
  else if (/Linux/i.test(s)) device = 'Linux';
  let browser = 'Unknown browser';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';
  return { device, browser };
}

const REFERRER_LABELS: [RegExp, string][] = [
  [/(^|\.)google\./i, 'Google'], [/(^|\.)bing\.com$/i, 'Bing'], [/(^|\.)duckduckgo\.com$/i, 'DuckDuckGo'],
  [/(^|\.)yahoo\./i, 'Yahoo'], [/(^|\.)linkedin\.com$/i, 'LinkedIn'], [/(^|\.)(twitter\.com|x\.com|t\.co)$/i, 'X'],
  [/(^|\.)facebook\.com$/i, 'Facebook'], [/(^|\.)instagram\.com$/i, 'Instagram'], [/(^|\.)youtube\.com$/i, 'YouTube'],
  [/(^|\.)reddit\.com$/i, 'Reddit']
];

// The referrer as sent by the browser on the FIRST page of the session. A search engine's
// query is read from its own `q`/`p` parameter when the referrer carries one — Google has
// not passed the term for years, so "Google" without a term is the normal case; the field
// is honest, not decorative.
export function parseReferrer(referrer: string | null, siteHost: string | null): { host: string | null; label: string; searchTerm: string | null } {
  if (!referrer) return { host: null, label: 'Direct', searchTerm: null };
  let u: URL;
  try { u = new URL(referrer); } catch (_e) { return { host: null, label: 'Direct', searchTerm: null }; }
  const host = u.hostname.toLowerCase();
  if (siteHost && (host === siteHost.toLowerCase() || host.endsWith('.' + siteHost.toLowerCase()))) return { host: null, label: 'Direct', searchTerm: null };
  let label = host.replace(/^www\./, '');
  for (const [re, name] of REFERRER_LABELS) { if (re.test(host)) { label = name; break; } }
  const term = u.searchParams.get('q') || u.searchParams.get('p') || null;
  return { host, label, searchTerm: term ? term.slice(0, 120) : null };
}

export function isLive(row: { last_seen_at: string; ended_at: string | null }, now = new Date()): boolean {
  if (row.ended_at) return false;
  return now.getTime() - new Date(row.last_seen_at).getTime() <= LIVE_WINDOW_SECONDS * 1000;
}
