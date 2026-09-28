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
import { isLive, classifyDeparture, LIVE_WINDOW_SECONDS, HEARTBEAT_SECONDS, MIN_SESSION_SECONDS_BEFORE_MESSAGE } from '../_shared/visitor-presence.ts';

// 30 days is the retention ceiling (purge_visitor_data), so it is also the furthest back any
// tab can honestly reach. Named once here rather than repeated as a literal.
const RETENTION_DAYS = 30;
const LIST_LIMIT = 2000;

// ★ EVERY LIST READ EXCLUDES `journey` — it is by far the heaviest column and no list row
// renders it. It is read only by the detail branch, for one session. This is also the
// privacy boundary for the payload: no IP is stored anywhere in the table, and the raw
// user-agent is never stored either (only the parsed `device` / `browser`), so neither can
// appear here. `invitation_token` is deliberately NOT selected — it is a live token.
const LIST_COLUMNS = 'id, visitor_id, client_id, client_name, visit_number, started_at, last_seen_at, ended_at, current_path, page_count, country_code, country, city, device, browser, referrer_label, search_term, notable_reason, invitation_sent_at, conversation_id';

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
    const now = new Date();
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const yesterdayStart = new Date(dayStart.getTime() - 86400000);
    const weekStart = new Date(dayStart.getTime() - 6 * 86400000);
    const monthStart = new Date(now.getTime() - RETENTION_DAYS * 86400000);
    const liveSince = new Date(now.getTime() - LIVE_WINDOW_SECONDS * 1000).toISOString();

    // ── DETAIL: one session's journey, plus that person's earlier visits ──────────────────
    // Journeys are the heaviest column and are needed for exactly one row at a time, so they
    // are fetched HERE and never in a list. Same gate, same table, same reader — this branch
    // is below the admin check above and adds no access of its own.
    if (body.detail) {
      // `as any`: supabase-js can only infer a row type from a LITERAL column list, and this
      // one is a named const so the privacy boundary above lives in exactly one place.
      const { data: oneRow, error: oneErr } = await admin.from('visitor_sessions')
        .select(LIST_COLUMNS + ', journey').eq('id', body.detail).maybeSingle();
      const one = oneRow as any;
      if (oneErr) throw new Error('visitor_sessions detail: ' + oneErr.message);
      if (!one) return json({ error: 'That visit is no longer on record. Visits are kept for ' + RETENTION_DAYS + ' days.' }, 404);

      // Earlier visits: across ALL of a client's devices when we know who they are, and only
      // from the same browser when we do not. An anonymous visitor cannot honestly be followed
      // across devices, and the page must not imply otherwise.
      const q = admin.from('visitor_sessions')
        .select('id, started_at, last_seen_at, ended_at, page_count, current_path, device, browser, visit_number, journey')
        .neq('id', one.id).gte('started_at', monthStart.toISOString())
        .order('started_at', { ascending: false }).limit(20);
      const { data: earlier } = one.client_id
        ? await q.eq('client_id', one.client_id)
        : await q.eq('visitor_id', one.visitor_id);

      return json({
        asOf: now.toISOString(),
        session: shape(one, now),
        journey: Array.isArray(one.journey) ? one.journey : [],
        groupedBy: one.client_id ? 'client' : 'browser',
        earlier: (earlier || []).map((r: any) => {
          const d = classifyDeparture(r, now);
          const endAt = d.at ? new Date(d.at) : new Date(r.last_seen_at);
          const steps = Array.isArray(r.journey) ? r.journey : [];
          return {
            id: r.id, startedAt: r.started_at, visitNumber: Number(r.visit_number),
            departureState: d.state,
            durationSeconds: d.state === 'unknown' ? null : Math.max(0, Math.round((endAt.getTime() - new Date(r.started_at).getTime()) / 1000)),
            pageCount: Number(r.page_count),
            device: r.device, browser: r.browser,
            trail: steps.map((x: any) => x.p).slice(0, 8)
          };
        }),
        retentionDays: RETENTION_DAYS
      }, 200);
    }

    // ── LIST ──────────────────────────────────────────────────────────────────────────────
    // One read, bounded by the tab. A heartbeat arrives every 15 s per visitor and the page
    // reloads on Realtime, so the live tab must never pull 30 days: it reads only what is
    // actually live. `journey` is excluded from every list read — it is the heaviest column
    // and the list does not render it.
    const tab = ['live', 'today', 'week', 'month', 'clients'].includes(body.tab) ? body.tab : 'live';

    // The live set is always needed: the strip, the header pill and the sidebar dot all count
    // it, on every tab. It is tiny by construction (sessions that heartbeated in the last 45 s).
    const { data: liveData, error: liveErr } = await admin.from('visitor_sessions')
      .select(LIST_COLUMNS).gte('last_seen_at', liveSince).is('ended_at', null);
    if (liveErr) throw new Error('visitor_sessions live: ' + liveErr.message);
    const liveRows = (liveData || []) as any[];
    const live = liveRows.map((r) => shape(r, now)).filter((s) => s.live);

    let listRows: any[] = [];
    if (tab === 'live') {
      listRows = liveRows;
    } else {
      const since = tab === 'today' ? dayStart : tab === 'week' ? weekStart : monthStart;
      let q = admin.from('visitor_sessions').select(LIST_COLUMNS)
        .gte('started_at', since.toISOString()).order('last_seen_at', { ascending: false }).limit(LIST_LIMIT);
      if (tab === 'clients') q = q.not('client_id', 'is', null);
      const { data, error } = await q;
      if (error) throw new Error('visitor_sessions list: ' + error.message);
      listRows = (data || []) as any[];
      // A session that began before the window but is still live belongs on screen.
      const seen = new Set(listRows.map((r: any) => r.id));
      for (const r of liveRows) if (!seen.has(r.id) && (tab !== 'clients' || r.client_id)) listRows.push(r);
    }
    const list = listRows.map((r) => shape(r, now));
    list.sort((a, b) => (b.live === a.live ? 0 : b.live ? 1 : -1) || new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

    // ── STATS: counts, never row pulls, except today — which is small and already bounded ──
    const countIn = async (from: Date, to?: Date, clientsOnly?: boolean) => {
      let q = admin.from('visitor_sessions').select('id', { count: 'exact', head: true }).gte('started_at', from.toISOString());
      if (to) q = q.lt('started_at', to.toISOString());
      if (clientsOnly) q = q.not('client_id', 'is', null);
      const { count } = await q;
      return count || 0;
    };
    // Today's rows carry journey because the most-viewed-page stat needs it. They are NOT
    // returned — the read is server-side and today is a small, bounded set.
    const { data: todayRows } = await admin.from('visitor_sessions')
      .select('id, client_id, started_at, last_seen_at, ended_at, journey').gte('started_at', dayStart.toISOString()).limit(LIST_LIMIT);
    const todayAll = (todayRows || []) as any[];

    const [countToday, countYesterday, countWeek, countMonth, countClients, countReturning] = await Promise.all([
      Promise.resolve(todayAll.length),
      countIn(yesterdayStart, dayStart),
      countIn(weekStart),
      countIn(monthStart),
      countIn(monthStart, undefined, true),
      (async () => {
        const { count } = await admin.from('visitor_sessions').select('id', { count: 'exact', head: true })
          .gte('started_at', monthStart.toISOString()).gte('visit_number', 2);
        return count || 0;
      })()
    ]);

    // ★ Average time on site counts ONLY visits whose departure is known (exact or approx).
    // Averaging in the sessions where departure was never recorded would quietly count them
    // as zero-second visits and drag the figure down with a number nobody measured.
    const known = todayAll
      .map((r: any) => ({ d: classifyDeparture(r, now), r }))
      .filter((x) => x.d.state === 'exact' || x.d.state === 'approx');
    const avgKnown = known.length
      ? Math.round(known.reduce((n, x) => n + Math.max(0, (new Date(x.d.at as string).getTime() - new Date(x.r.started_at).getTime()) / 1000), 0) / known.length)
      : null;

    const pageCounts = new Map<string, number>();
    for (const r of todayAll) {
      const seen = new Set<string>();
      for (const step of (Array.isArray(r.journey) ? r.journey : [])) {
        if (!seen.has(step.p)) { seen.add(step.p); pageCounts.set(step.p, (pageCounts.get(step.p) || 0) + 1); }
      }
    }
    let mostViewed: { path: string; sessions: number } | null = null;
    for (const [path, n] of pageCounts) if (!mostViewed || n > mostViewed.sessions) mostViewed = { path, sessions: n };

    const durationsToday = todayAll
      .map((r: any) => { const d = classifyDeparture(r, now); return d.state === 'unknown' ? null : Math.round(((d.at ? new Date(d.at) : new Date(r.last_seen_at)).getTime() - new Date(r.started_at).getTime()) / 1000); })
      .filter((n): n is number => n !== null).sort((a, b) => a - b);
    const median = durationsToday.length
      ? (durationsToday.length % 2 ? durationsToday[(durationsToday.length - 1) / 2] : (durationsToday[durationsToday.length / 2 - 1] + durationsToday[durationsToday.length / 2]) / 2)
      : null;

    return json({
      asOf: now.toISOString(),
      tab,
      stats: {
        liveNow: live.length,
        liveClients: live.filter((s) => !!s.clientId).length,
        liveAnonymous: live.filter((s) => !s.clientId).length,
        sessionsToday: countToday,
        sessionsYesterday: countYesterday,
        medianSecondsToday: median === null ? null : Math.round(median),
        // Average over KNOWN departures only, with the count it was taken over so the page can
        // say so rather than presenting it as an average over every visit.
        avgSecondsTodayKnown: avgKnown,
        avgKnownOf: known.length,
        avgKnownTotal: todayAll.length,
        returningPercent30: countMonth ? Math.round((countReturning / countMonth) * 100) : null,
        returningOf30: countMonth,
        mostViewedToday: mostViewed
      },
      counts: { live: live.length, today: countToday, week: countWeek, month: countMonth, clients: countClients },
      sessions: list,
      rules: { liveWindowSeconds: LIVE_WINDOW_SECONDS, heartbeatSeconds: HEARTBEAT_SECONDS, minSecondsBeforeMessage: MIN_SESSION_SECONDS_BEFORE_MESSAGE, retentionDays: RETENTION_DAYS }
    }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function shape(r: any, now: Date) {
  const endAt = r.ended_at ? new Date(r.ended_at) : new Date(r.last_seen_at);
  const durationSeconds = Math.max(0, Math.round((endAt.getTime() - new Date(r.started_at).getTime()) / 1000));
  // Which of the four departure states this visit is in, classified HERE so the page never
  // has to re-derive it from raw timestamps and reach a different answer.
  const dep = classifyDeparture(r, now);
  const ageSeconds = Math.max(0, Math.round((now.getTime() - new Date(r.started_at).getTime()) / 1000));
  return {
    id: r.id,
    live: isLive(r, now),
    // The browser cookie. It is the grouping key for a visitor we cannot name, and without
    // it "grouped by person" silently degrades to one group per visit for every anonymous
    // visitor, which is most of them. A random per-browser uuid, already stored in visitors.id.
    visitorId: r.visitor_id,
    clientId: r.client_id, clientName: r.client_name,
    visitNumber: Number(r.visit_number),
    startedAt: r.started_at, lastSeenAt: r.last_seen_at, endedAt: r.ended_at,
    departureState: dep.state, departureAt: dep.at, departureAccuracySeconds: dep.accuracySeconds,
    // null, not 0, when nothing was recorded after arrival — the page renders "Under 15 s".
    knownDurationSeconds: dep.state === 'unknown' ? null : durationSeconds,
    durationSeconds, ageSeconds,
    currentPath: r.current_path,
    journey: Array.isArray(r.journey) ? r.journey : [],   // present only via the detail branch
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
