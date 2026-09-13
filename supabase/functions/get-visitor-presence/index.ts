// ★ Visitor presence (2026-09-13) — the PM page's one read: the stat strip and the rows for
// a tab (live / today / last 7 days / clients only). Admin-only (getClaims(jwt), never
// getUser()); RLS already restricts the tables to the admin claim, this function also
// computes the figures — median time on site, the most viewed page — server-side so the
// page only formats (row 185).
//
// "Live" is the shared rule in _shared/visitor-presence.ts: a heartbeat within 45 s and no
// leave beacon. A session's duration is (ended_at, else last_seen_at) − started_at — to the
// last thing the visitor's browser actually said, never padded to now.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isLive, LIVE_WINDOW_SECONDS, MIN_SESSION_SECONDS_BEFORE_MESSAGE } from '../_shared/visitor-presence.ts';

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
    if (claimsError || !claimsData) return json({ error: 'You must be signed in to perform this action.' }, 401);
    if (claimsData.claims.app_metadata?.is_admin !== true) return json({ error: 'This action requires Portfolio Manager access.' }, 403);

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    const tab = ['live', 'today', 'week', 'clients'].includes(body.tab) ? body.tab : 'live';
    const now = new Date();
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const yesterdayStart = new Date(dayStart.getTime() - 86400000);
    const weekStart = new Date(dayStart.getTime() - 6 * 86400000);
    const liveSince = new Date(now.getTime() - LIVE_WINDOW_SECONDS * 1000).toISOString();

    // One read of the last 7 days covers every tab and every stat; the live set is the
    // subset that heartbeated inside the window.
    const { data: rows, error } = await admin.from('visitor_sessions').select('*').gte('started_at', weekStart.toISOString()).order('last_seen_at', { ascending: false });
    if (error) throw new Error('visitor_sessions read: ' + error.message);
    // Sessions that started before the week window but are still live (a very long session).
    const { data: oldLive } = await admin.from('visitor_sessions').select('*').lt('started_at', weekStart.toISOString()).gte('last_seen_at', liveSince).is('ended_at', null);
    const all = (rows || []).concat(oldLive || []);

    const shaped = all.map((r) => shape(r, now));
    const live = shaped.filter((s) => s.live);
    const today = shaped.filter((s) => new Date(s.startedAt) >= dayStart);
    const yesterday = all.filter((r) => { const t = new Date(r.started_at); return t >= yesterdayStart && t < dayStart; });
    const week = shaped;
    const clients = shaped.filter((s) => !!s.clientId);

    const durations = today.map((s) => s.durationSeconds).sort((a, b) => a - b);
    const median = durations.length ? (durations.length % 2 ? durations[(durations.length - 1) / 2] : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2) : null;
    const pageCounts = new Map<string, number>();
    for (const s of today) { const seen = new Set<string>(); for (const step of s.journey) { if (!seen.has(step.p)) { seen.add(step.p); pageCounts.set(step.p, (pageCounts.get(step.p) || 0) + 1); } } }
    let mostViewed: { path: string; sessions: number } | null = null;
    for (const [path, n] of pageCounts) if (!mostViewed || n > mostViewed.sessions) mostViewed = { path, sessions: n };

    const list = tab === 'live' ? live : tab === 'today' ? today : tab === 'week' ? week : clients;
    list.sort((a, b) => (b.live === a.live ? 0 : b.live ? 1 : -1) || new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

    return json({
      asOf: now.toISOString(),
      tab,
      stats: {
        liveNow: live.length,
        liveClients: live.filter((s) => !!s.clientId).length,
        liveAnonymous: live.filter((s) => !s.clientId).length,
        sessionsToday: today.length,
        sessionsYesterday: yesterday.length,
        medianSecondsToday: median === null ? null : Math.round(median),
        mostViewedToday: mostViewed
      },
      counts: { live: live.length, today: today.length, week: week.length, clients: clients.length },
      sessions: list,
      rules: { liveWindowSeconds: LIVE_WINDOW_SECONDS, minSecondsBeforeMessage: MIN_SESSION_SECONDS_BEFORE_MESSAGE, retentionDays: 30 }
    }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function shape(r: any, now: Date) {
  const endAt = r.ended_at ? new Date(r.ended_at) : new Date(r.last_seen_at);
  const durationSeconds = Math.max(0, Math.round((endAt.getTime() - new Date(r.started_at).getTime()) / 1000));
  const ageSeconds = Math.max(0, Math.round((now.getTime() - new Date(r.started_at).getTime()) / 1000));
  return {
    id: r.id,
    live: isLive(r, now),
    clientId: r.client_id, clientName: r.client_name,
    visitNumber: Number(r.visit_number),
    startedAt: r.started_at, lastSeenAt: r.last_seen_at, endedAt: r.ended_at,
    durationSeconds, ageSeconds,
    currentPath: r.current_path,
    journey: Array.isArray(r.journey) ? r.journey : [],
    pageCount: Number(r.page_count),
    countryCode: r.country_code, country: r.country, city: r.city,
    device: r.device, browser: r.browser,
    referrerLabel: r.referrer_label, searchTerm: r.search_term,
    notableReason: r.notable_reason,
    invitationSentAt: r.invitation_sent_at,
    conversationId: r.conversation_id,
    // Etiquette, decided here so the page shows the same reason the server will refuse with.
    canMessage: isLive(r, now) && ageSeconds >= MIN_SESSION_SECONDS_BEFORE_MESSAGE && !r.invitation_sent_at,
    messageBlockedReason: !isLive(r, now) ? 'Not on the site' : ageSeconds < MIN_SESSION_SECONDS_BEFORE_MESSAGE ? 'Wait ' + (MIN_SESSION_SECONDS_BEFORE_MESSAGE - ageSeconds) + 's' : r.invitation_sent_at ? 'Already invited' : null
  };
}
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
