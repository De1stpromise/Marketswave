// ★ Task A — make signup's data actually persist (2026-09-18, register row 242).
//
// Writes a client's onboarding record — date of birth, country of residence, financial
// profile, goals & preferences, the six-question risk questionnaire, and entity/joint details
// where they apply — to client_profiles. Until this function existed the record went to the
// browser's own localStorage and two of those fields (date of birth, country) went nowhere.
//
// CLIENT-CALLABLE, SELF ONLY. clientId is derived from the caller's own verified JWT
// (getClaims(jwt).sub), never trusted from the body — the same shape as every request-*
// function in this project.
//
// ★ WHY AN EDGE FUNCTION AND NOT A CLIENT-SIDE INSERT POLICY. client_profiles also holds
// legal_name/address/id_document, which are request-and-approve only. An RLS INSERT/UPDATE
// policy cannot restrict WHICH COLUMNS a row write touches, so a client "submitting
// onboarding" through a policy could rewrite those three and bypass approval. This function
// writes exactly the onboarding columns and nothing else — and sets legal_name ONLY when the
// row has none, from clients.name split server-side (never from the caller).
//
// TWO CALLERS: signup.html, immediately after the clients row is inserted and before the
// trailing signOut(); and login.html's reclaim-on-login, which fires once when the browser
// still holds a pre-2026-09-18 local onboarding record for the signed-in client and the
// server has none. Reclaimed records never carry a date of birth or a country (signup never
// stored those anywhere), so both are OPTIONAL here — null is the honest value, not a guess.
//
// ONCE ONLY. A second submission is refused (409): onboarding_submitted_at is set exactly once
// and every later change goes through request-profile-change, where a PM approves it.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { VOCAB, GROUP_ORDER, validateGroup, groupAppliesTo } from '../_shared/onboarding-vocab.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    if (claimsError || !claimsData) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    const clientId = claimsData.claims.sub as string;

    const body = (await req.json().catch(() => null)) || {};
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: clientRow, error: clientErr } = await admin
      .from('clients').select('name, account_type').eq('id', clientId).maybeSingle();
    if (clientErr) return jsonResponse({ error: clientErr.message }, 500);
    if (!clientRow) return jsonResponse({ error: 'No client record exists for this account yet.' }, 404);

    // ---- validate ------------------------------------------------------------------------
    const dateOfBirth = body.dateOfBirth === undefined || body.dateOfBirth === null || body.dateOfBirth === '' ? null : body.dateOfBirth;
    if (dateOfBirth !== null) {
      if (typeof dateOfBirth !== 'string' || !ISO_DATE.test(dateOfBirth) || isNaN(Date.parse(dateOfBirth + 'T00:00:00Z'))) {
        return jsonResponse({ error: 'dateOfBirth must be a YYYY-MM-DD date.' }, 400);
      }
      const dob = new Date(dateOfBirth + 'T00:00:00Z');
      const now = new Date();
      let age = now.getUTCFullYear() - dob.getUTCFullYear();
      const m = now.getUTCMonth() - dob.getUTCMonth();
      if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
      if (age < 18) return jsonResponse({ error: 'Applicants must be at least 18 years old.' }, 400);
      if (age > 130) return jsonResponse({ error: 'dateOfBirth is not a plausible date.' }, 400);
    }

    const columns: Record<string, unknown> = { date_of_birth: dateOfBirth };
    let anyGroup = false;
    for (const key of GROUP_ORDER) {
      const g = VOCAB[key];
      const raw = body[key];
      if (raw === undefined || raw === null || raw === '') { columns[g.column] = null; continue; }
      if (!groupAppliesTo(key, clientRow.account_type as string)) {
        return jsonResponse({ error: g.label + ' does not apply to this account type.' }, 400);
      }
      const err = validateGroup(key, raw);
      if (err) return jsonResponse({ error: err }, 400);
      columns[g.column] = raw;
      anyGroup = true;
    }
    if (!anyGroup && dateOfBirth === null) {
      return jsonResponse({ error: 'Nothing to submit: no onboarding field was provided.' }, 400);
    }

    // ---- once only ------------------------------------------------------------------------
    const { data: existing, error: existingErr } = await admin
      .from('client_profiles').select('client_id, legal_name, onboarding_submitted_at').eq('client_id', clientId).maybeSingle();
    if (existingErr) return jsonResponse({ error: existingErr.message }, 500);
    if (existing && existing.onboarding_submitted_at) {
      return jsonResponse({ error: 'An onboarding record has already been submitted for this account. Changes go through Request Change.' }, 409);
    }

    // legal_name only when the row has none — from clients.name, split server-side, the same
    // rule the migration's own backfill applied (split_client_legal_name).
    if (!existing || !existing.legal_name) {
      const { data: split } = await admin.rpc('split_client_legal_name', { p_name: clientRow.name });
      if (split) columns.legal_name = split;
    }
    columns.onboarding_submitted_at = new Date().toISOString();
    columns.updated_at = columns.onboarding_submitted_at;
    columns.client_id = clientId;

    const { data: row, error: upsertErr } = await admin
      .from('client_profiles')
      .upsert(columns, { onConflict: 'client_id' })
      .select('client_id, legal_name, date_of_birth, country_of_residence, financial_profile, goals_preferences, risk_questionnaire, entity_details, joint_holder, onboarding_submitted_at')
      .single();
    if (upsertErr) return jsonResponse({ error: upsertErr.message }, 500);

    return jsonResponse({
      clientId: row.client_id,
      legalName: row.legal_name,
      dateOfBirth: row.date_of_birth,
      countryOfResidence: row.country_of_residence,
      financialProfile: row.financial_profile,
      goalsPreferences: row.goals_preferences,
      riskQuestionnaire: row.risk_questionnaire,
      entityDetails: row.entity_details,
      jointHolder: row.joint_holder,
      onboardingSubmittedAt: row.onboarding_submitted_at
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
