// Unified Communications Inbox — Stage 1 (2026-09-07).
//
// Admin-only. Handles both status changes (open/resolved/archived) and marking a
// conversation read — the only two writes a PM ever makes against `conversations` itself
// (message SENDING is a separate, direct RLS-authorized insert — see the migration's own RLS
// section for why that one doesn't need an Edge Function). No client-side UPDATE policy
// exists on `conversations` at all (per instruction: "No client-side updates to
// status/unread flags — those are PM actions only"), so this function, running as
// service_role, is the only path either field can ever change through.
//
// PM attribution (mirrors approve-allocation's own real resolved_by/resolved_by_email
// pattern, applied here from the start) is recorded only for a genuine status change to
// resolved/archived — marking read is a much lighter-weight, high-frequency action (a PM
// opening the inbox) that doesn't warrant its own attribution row.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const VALID_STATUSES = ['open', 'resolved', 'archived'];

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
    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json();
    const conversationId = body && body.conversationId;
    const status = body && body.status;
    const markRead = body && body.markRead === true;

    if (!conversationId) return jsonResponse({ error: 'conversationId is required.' }, 400);
    if (status !== undefined && VALID_STATUSES.indexOf(status) === -1) {
      return jsonResponse({ error: 'status must be one of: ' + VALID_STATUSES.join(', ') + '.' }, 400);
    }
    if (status === undefined && !markRead) {
      return jsonResponse({ error: 'Provide at least one of status or markRead.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const patch: Record<string, unknown> = {};
    if (status !== undefined) {
      patch.status = status;
      if (status === 'resolved' || status === 'archived') {
        patch.resolved_by = adminId;
        patch.resolved_by_email = adminEmail;
        patch.resolved_at = new Date().toISOString();
      }
    }
    if (markRead) {
      patch.unread_by_pm = false;
    }

    const { data: updated, error: updateErr } = await admin
      .from('conversations')
      .update(patch)
      .eq('id', conversationId)
      .select('id, status, unread_by_pm, resolved_by, resolved_by_email, resolved_at')
      .maybeSingle();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);
    if (!updated) return jsonResponse({ error: 'Unknown conversation.' }, 404);

    return jsonResponse(updated, 200);
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
