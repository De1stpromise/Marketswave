// ★ Portfolio overview (2026-09-12) — THE SCHEDULED SNAPSHOT WRITER.
//
// Before this, portfolio_value_snapshots had exactly one writer: get-portfolio-monthly-change,
// which inserts a client's anchor for the CURRENT month lazily, on their first dashboard load
// in that month — and never for a client who does not visit. The investigation that opened
// this work found the table holding two rows in total on real staging (both $0, written the
// day those clients first opened an empty dashboard) and none locally. Nothing was scheduled,
// so no client could ever accumulate the history a value chart needs.
//
// This runs from pg_cron at 00:05 UTC on the 1st of every month (see the migration) and
// writes that month's anchor for EVERY client — the same (client_id, month_start_date) row
// the lazy writer would create, computed the same way (computeTotalPortfolioValue), so the
// two writers can never disagree: whichever gets there first wins the unique index and the
// other sees "exists". An anchor at 00:05 on the 1st is, to within minutes, the value at the
// end of the previous month.
//
// Also callable with a `monthStartDate` (YYYY-MM-01) to write a specific month — used by the
// verification to prove the writer idempotent, never to invent history: it always records the
// value NOW, whatever date it is filed under, and the chart labels every point by its stored
// date. There is no backfill, because there is nothing honest to backfill from.
//
// AUTHORIZATION: the scheduler's own (service_role) or a real admin — _shared/scheduler-auth.ts.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeScheduledCall } from '../_shared/scheduler-auth.ts';
import { writeMonthAnchor, monthStartIso } from '../_shared/portfolio-overview.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = await authorizeScheduledCall(req);
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
    let monthStartDate = monthStartIso();
    if (body && typeof body.monthStartDate === 'string') {
      if (!/^\d{4}-\d{2}-01$/.test(body.monthStartDate)) return jsonResponse({ error: 'monthStartDate must be the first of a month (YYYY-MM-01).' }, 400);
      monthStartDate = body.monthStartDate;
    }
    const onlyClientId = body && typeof body.clientId === 'string' ? body.clientId : null;

    // Active clients only: a pending or rejected application has no portfolio to record.
    let query = admin.from('clients').select('id').eq('status', 'active');
    if (onlyClientId) query = query.eq('id', onlyClientId);
    const { data: clients, error } = await query;
    if (error) return jsonResponse({ error: error.message }, 500);

    let inserted = 0, existing = 0;
    const failed: { clientId: string; error: string }[] = [];
    for (const c of clients || []) {
      try {
        const r = await writeMonthAnchor(admin, c.id, monthStartDate);
        if (r === 'inserted') inserted++; else existing++;
      } catch (e) {
        failed.push({ clientId: c.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return jsonResponse({ monthStartDate, clients: (clients || []).length, inserted, existing, failed, via: auth.via }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
