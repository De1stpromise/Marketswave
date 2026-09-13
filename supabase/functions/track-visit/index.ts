// ★ Visitor presence (2026-09-13) — the ONE endpoint a visitor's browser talks to. Called by
// site-presence.js on every page load ('page'), every 20 s ('heartbeat'), and once on
// pagehide ('leave', as a keepalive fetch or a text/plain beacon). No authentication is
// required — a public visitor has none — but when a real client session's JWT is present the
// caller's own real name is recorded, since the platform legitimately knows who they are.
//
// THE IP NEVER LEAVES THIS FUNCTION. It is read from the request once, handed to the
// geolocation chain on a session's first page, and dropped; nothing here writes it, logs
// it, or returns it. The verification asserts that no stored column contains anything shaped
// like an IP.
//
// NOTABLE-VISITOR EMAIL — at most one per session, and only for: a signed-in client
// browsing, a returning visitor (second session or later for this cookie), anyone on
// /signup, or a session past five minutes. Never on an ordinary first page view: dozens of
// unopened notification emails would damage the sending domain's reputation, which is shared
// with the transactional mail that actually matters. A burst guard on top: never two presence
// emails within two minutes across all sessions.
//
// A PENDING INVITATION (send-proactive-message) rides back on every response until the
// visitor has accepted it, so a missed Realtime broadcast still reaches them within one
// heartbeat.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, getAdminEmails, siteLink } from '../_shared/send-email.ts';
import { clientIpFrom, geolocate, parseUserAgent, parseReferrer, ENGAGED_SESSION_SECONDS, NOTABLE_BURST_GUARD_SECONDS } from '../_shared/visitor-presence.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // The leave beacon arrives as text/plain (a "simple" request needs no preflight, and a
    // beacon cannot run one); everything else is JSON. Parse either.
    let body: any = {};
    try { body = JSON.parse(await req.text() || '{}'); } catch (_e) { body = {}; }
    const event = String(body.event || '');
    const sessionId = String(body.sessionId || '');
    const visitorId = String(body.visitorId || '');
    const path = normalisePath(body.path);
    if (!['page', 'heartbeat', 'leave'].includes(event)) return json({ error: 'Unknown event.' }, 400);
    if (!UUID.test(sessionId) || !UUID.test(visitorId)) return json({ error: 'sessionId and visitorId must be uuids.' }, 400);

    // ---- who is this? A real client session's JWT, if one was sent. The anon key is also a
    // JWT but carries no user; getClaims refuses it, which is the anonymous case.
    let clientId: string | null = null;
    let clientName: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const jwt = authHeader.replace(/^Bearer\s+/i, '');
      const userClient = createClient(supabaseUrl, anonKey);
      const { data: claimsData } = await userClient.auth.getClaims(jwt);
      const sub = claimsData?.claims?.sub as string | undefined;
      const isAnon = claimsData?.claims?.is_anonymous === true;
      if (sub && !isAnon) {
        const { data: c } = await admin.from('clients').select('id, name').eq('id', sub).maybeSingle();
        if (c) { clientId = c.id; clientName = c.name; }
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const { data: existing } = await admin.from('visitor_sessions').select('*').eq('id', sessionId).maybeSingle();

    if (event === 'leave') {
      if (existing && !existing.ended_at) await admin.from('visitor_sessions').update({ ended_at: nowIso, last_seen_at: nowIso }).eq('id', sessionId);
      return json({ ok: true }, 200);
    }

    let session: any = existing;
    if (!session) {
      if (event !== 'page') return json({ ok: false, unknownSession: true }, 200); // a heartbeat for a purged/unknown session: start over on the next page
      // ---- new session. visit_number is the count of sessions this cookie has already
      // started (within the retained 30 days) plus one; visitors.visit_count is written to the
      // same figure only AFTER the session insert succeeds, so two page events racing to
      // create the same session cannot count it twice.
      const { error: vErr } = await admin.from('visitors').insert({ id: visitorId, first_seen_at: nowIso, last_seen_at: nowIso, visit_count: 0 });
      if (vErr && vErr.code !== '23505') throw new Error('visitors insert: ' + vErr.message);
      const { count: priorSessions } = await admin.from('visitor_sessions').select('id', { count: 'exact', head: true }).eq('visitor_id', visitorId);
      const visitNumber = (priorSessions || 0) + 1;
      // Geo from the IP — once, here, and the IP is not referenced again.
      const geo = await geolocate(clientIpFrom(req));
      const ua = parseUserAgent(req.headers.get('user-agent'));
      const siteHost = safeHost(req.headers.get('origin')) || safeHost(req.headers.get('referer'));
      const ref = parseReferrer(typeof body.referrer === 'string' ? body.referrer : null, siteHost);
      const row = {
        id: sessionId, visitor_id: visitorId, visit_number: visitNumber,
        client_id: clientId, client_name: clientName,
        started_at: nowIso, last_seen_at: nowIso, ended_at: null,
        current_path: path, journey: [{ p: path, t: clientTime(body, nowIso) }], page_count: 1,
        country_code: geo.countryCode, country: geo.country, city: geo.city,
        device: ua.device, browser: ua.browser,
        referrer_host: ref.host, referrer_label: ref.label, search_term: ref.searchTerm
      };
      const { data: inserted, error: insErr } = await admin.from('visitor_sessions').insert(row).select('*').single();
      if (insErr) {
        // Two page events racing on a cold start (measured on the live site: the first takes
        // ~4 s, a click-through sends the second before it lands): both find no session and
        // both insert; the loser must APPLY its own page to the row the winner created rather
        // than return it untouched — that dropped a page and reordered the journey once.
        if (insErr.code !== '23505') throw new Error('visitor_sessions insert: ' + insErr.message);
        const { data: raced } = await admin.from('visitor_sessions').select('*').eq('id', sessionId).single();
        session = await applyEvent(admin, raced, event, path, nowIso, clientTime(body, nowIso), clientId, clientName);
      } else {
        session = inserted;
        await admin.from('visitors').update({ visit_count: visitNumber, last_seen_at: nowIso }).eq('id', visitorId);
      }
    } else {
      session = await applyEvent(admin, session, event, path, nowIso, clientTime(body, nowIso), clientId, clientName);
    }

    // ---- notable-visitor email, at most once per session
    if (!session.notified_at) {
      const seconds = (now.getTime() - new Date(session.started_at).getTime()) / 1000;
      let reason: string | null = null;
      if (session.client_id) reason = 'client';
      else if (Number(session.visit_number) >= 2) reason = 'returning';
      else if (/^\/signup/.test(session.current_path)) reason = 'signup';
      else if (seconds >= ENGAGED_SESSION_SECONDS) reason = 'engaged';
      if (reason) await notifyNotable(admin, session, reason, now);
    }

    // ---- a pending invitation rides back until accepted
    let invitation: any = null;
    if (session.invitation_sent_at && session.conversation_id && session.invitation_token) {
      const { data: convo } = await admin.from('conversations').select('id, visitor_auth_id, client_id').eq('id', session.conversation_id).maybeSingle();
      if (convo && !convo.visitor_auth_id) {
        const { data: msg } = await admin.from('messages').select('body, sent_at').eq('conversation_id', convo.id).eq('direction', 'outbound').order('sent_at', { ascending: false }).limit(1).maybeSingle();
        invitation = { conversationId: convo.id, token: session.invitation_token, message: msg ? msg.body : '', sentAt: msg ? msg.sent_at : session.invitation_sent_at, forClient: !!convo.client_id };
      }
    }

    return json({ ok: true, sessionId: session.id, visitNumber: session.visit_number, invitation }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// The browser's own timestamp for a page event, when it is sane (within a minute of the
// server clock) — a page event that lost the cold-start race still lands in the journey at
// the moment it happened, not the moment it arrived.
function clientTime(body: any, nowIso: string): string {
  const t = typeof body.at === 'string' ? new Date(body.at).getTime() : NaN;
  const now = new Date(nowIso).getTime();
  return Number.isFinite(t) && Math.abs(now - t) < 60000 ? new Date(t).toISOString() : nowIso;
}

// A page or heartbeat event applied to an existing session row. Journey steps are kept in
// time order; a page that repeats its predecessor (a reload) is not a new step; the current
// page is the latest step.
async function applyEvent(admin: any, session: any, event: string, path: string, nowIso: string, atIso: string, clientId: string | null, clientName: string | null) {
  const patch: Record<string, unknown> = { last_seen_at: nowIso, ended_at: null };
  if (clientId && !session.client_id) { patch.client_id = clientId; patch.client_name = clientName; }
  if (event === 'page') {
    let journey = Array.isArray(session.journey) ? session.journey.slice() : [];
    journey.push({ p: path, t: atIso });
    journey.sort((a: any, b: any) => String(a.t).localeCompare(String(b.t)));
    journey = journey.filter((step: any, i: number) => i === 0 || step.p !== journey[i - 1].p);
    patch.current_path = journey[journey.length - 1].p;
    patch.journey = journey.slice(-60);
    patch.page_count = journey.length;
  }
  const { data: updated, error: updErr } = await admin.from('visitor_sessions').update(patch).eq('id', session.id).select('*').single();
  if (updErr) throw new Error('visitor_sessions update: ' + updErr.message);
  return updated;
}

const REASON_TEXT: Record<string, string> = {
  client: 'A signed-in client is browsing the site',
  returning: 'A returning visitor is on the site',
  signup: 'A visitor is on the signup page',
  engaged: 'A visitor has been on the site for over five minutes'
};

async function notifyNotable(admin: any, session: any, reason: string, now: Date) {
  // Burst guard across ALL sessions: the domain's reputation is shared with transactional mail.
  const since = new Date(now.getTime() - NOTABLE_BURST_GUARD_SECONDS * 1000).toISOString();
  const { count } = await admin.from('visitor_sessions').select('id', { count: 'exact', head: true }).gte('notified_at', since);
  if (count && count > 0) return;
  // Claim first (conditioned on still-null), so two racing heartbeats cannot both mail.
  const { data: claimed } = await admin.from('visitor_sessions').update({ notified_at: now.toISOString(), notable_reason: reason }).eq('id', session.id).is('notified_at', null).select('id');
  if (!claimed || !claimed.length) return;
  const adminEmails = await getAdminEmails(admin);
  if (!adminEmails.length) return;
  const where = [session.city, session.country].filter(Boolean).join(', ') || 'Unknown location';
  const who = session.client_name ? session.client_name + ' (client)' : (Number(session.visit_number) >= 2 ? 'Returning visitor (visit ' + session.visit_number + ')' : 'Anonymous visitor');
  const { html, text } = renderEmail({
    heading: REASON_TEXT[reason] || 'A notable visitor is on the site',
    introParagraphs: ['Hi, ' + (REASON_TEXT[reason] || 'a notable visitor is on the site').toLowerCase() + '. You can see where they are and open a conversation from the presence page.'],
    detailRows: [
      { label: 'Visitor', value: who },
      { label: 'Currently on', value: session.current_path },
      { label: 'Location', value: where },
      { label: 'Device', value: (session.device || '') + ' · ' + (session.browser || '') },
      { label: 'Came from', value: session.search_term ? session.referrer_label + ' · "' + session.search_term + '"' : (session.referrer_label || 'Direct') }
    ],
    cta: { text: "See who's on the site", href: siteLink('admin-presence.html') },
    footerType: 'general'
  });
  await sendEmail(admin, { to: adminEmails, subject: REASON_TEXT[reason] || 'A notable visitor is on the site', html, text, relatedEntityType: 'visitor_session', relatedEntityId: session.id });
}

function normalisePath(p: unknown): string {
  let s = typeof p === 'string' ? p : '/';
  s = s.split('?')[0].split('#')[0];
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (s === '') s = '/';
  return s.slice(0, 200);
}
function safeHost(u: string | null): string | null { try { return u ? new URL(u).hostname : null; } catch (_e) { return null; } }
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
