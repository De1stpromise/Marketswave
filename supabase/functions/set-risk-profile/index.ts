// ★ set-risk-profile (2026-09-30, register row 292) — the ONLY write path for a client's risk
// profile.
//
// SELF-ONLY: the client is the caller's own verified JWT subject; there is no clientId input at
// all, so there is no shape in which one client writes another's record. It writes exactly two
// columns — risk_profile and risk_profile_set_at — on client_profiles, and nothing else: the table
// has no client write policy (RLS cannot limit which columns a row write touches), so this
// function is the boundary.
//
// TWO MODES:
//   { riskProfile }                  — the client chose a level on the Risk Meter. Overwrites.
//   { riskProfile, reclaim: true }   — a value found in the client's BROWSER (the pre-server
//                                      localStorage home). Saved ONLY IF the server holds none;
//                                      a server value is never overwritten from a browser. The
//                                      page cannot bypass this: the rule lives here.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const LEVELS = ['conservative', 'balanced', 'aggressive'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData || !claimsData.claims.sub) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }
    const clientId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const extra = Object.keys(body || {}).filter((k) => k !== 'riskProfile' && k !== 'reclaim');
    if (extra.length) {
      return jsonResponse({ error: 'Only the risk profile can be set here (unexpected: ' + extra.join(', ') + ').' }, 400);
    }
    const riskProfile = typeof body.riskProfile === 'string' ? body.riskProfile : '';
    if (LEVELS.indexOf(riskProfile) === -1) {
      return jsonResponse({ error: 'riskProfile must be one of: ' + LEVELS.join(', ') + '.' }, 400);
    }
    const reclaim = body.reclaim === true;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: client, error: clientErr } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle();
    if (clientErr) return jsonResponse({ error: clientErr.message }, 500);
    if (!client) return jsonResponse({ error: 'No client account exists for this sign-in.' }, 403);

    const { data: existing, error: readErr } = await admin
      .from('client_profiles').select('client_id, risk_profile, risk_profile_set_at').eq('client_id', clientId).maybeSingle();
    if (readErr) return jsonResponse({ error: readErr.message }, 500);

    if (reclaim && existing && existing.risk_profile) {
      return jsonResponse({ saved: false, reason: 'server_has_value', riskProfile: existing.risk_profile, riskProfileSetAt: existing.risk_profile_set_at }, 200);
    }

    const setAt = new Date().toISOString();
    let row;
    if (existing) {
      let q = admin.from('client_profiles').update({ risk_profile: riskProfile, risk_profile_set_at: setAt, updated_at: setAt }).eq('client_id', clientId);
      // A reclaim that races a real choice must still lose: only write where the server is empty.
      if (reclaim) q = q.is('risk_profile', null);
      const { data, error } = await q.select('risk_profile, risk_profile_set_at');
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!data || !data.length) {
        const { data: now } = await admin.from('client_profiles').select('risk_profile, risk_profile_set_at').eq('client_id', clientId).single();
        return jsonResponse({ saved: false, reason: 'server_has_value', riskProfile: now && now.risk_profile, riskProfileSetAt: now && now.risk_profile_set_at }, 200);
      }
      row = data[0];
    } else {
      const { data, error } = await admin.from('client_profiles')
        .insert({ client_id: clientId, risk_profile: riskProfile, risk_profile_set_at: setAt })
        .select('risk_profile, risk_profile_set_at').single();
      if (error) {
        // Unique violation: a row appeared between the read and the insert. Re-run as an update.
        if ((error.code || '') === '23505') return jsonResponse({ error: 'Please try again.' }, 409);
        return jsonResponse({ error: error.message }, 500);
      }
      row = data;
    }
    return jsonResponse({ saved: true, reclaimed: reclaim, riskProfile: row.risk_profile, riskProfileSetAt: row.risk_profile_set_at }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
