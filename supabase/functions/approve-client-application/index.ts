// Supabase Migration — Stage 3 (Aug 30, 2026).
//
// Real cloud Edge Function equivalent of functions/index.js's approveClientApplication
// callable (Firebase side) — this is the piece that stayed permanently blocked on Firebase's
// Blaze plan requirement; Supabase's free tier deploys real Edge Functions with no card
// needed, so this is the first time in this migration's history the real admin approve/
// reject flow works end to end, not a stand-in. Mirrors that Cloud Function's own business
// rules field-for-field (read directly from functions/index.js before writing this, not
// reinvented) — same not-pending-review guard, same status/applicationResolvedAt writes.
//
// AUTHORIZATION, the actual point of this function existing as a server-side boundary rather
// than a client-side check: replaced entirely by a real, re-verified check on the CALLER'S
// OWN JWT — never trusted from the request body, mirroring Firebase's own
// `request.auth.token.admin === true` check exactly, just expressed through Supabase's own
// mechanism (Stage 1's custom_access_token_hook, which stamps app_metadata.is_admin onto
// every issued JWT from public.user_roles).
//
// A real mistake was caught and fixed while first testing this locally, not shipped: the
// first draft called `userClient.auth.getUser()` and read `.app_metadata.is_admin` off its
// response — this is WRONG, confirmed directly against a real local admin sign-in (returned
// `undefined` for a genuine admin). `getUser()` fetches the live `auth.users` DATABASE
// RECORD, whose `app_metadata` is a completely different thing from the JWT's own injected
// claims — the custom_access_token_hook only ever modifies the TOKEN at issuance time, it
// never writes back to that row. The installed SDK's own source
// (auth-js/dist/main/GoTrueClient.js) explicitly warns exactly this: "the user object
// returned by [getUser()] must not be trusted [for authorization] — always verify the JWT
// using getClaims()". Fixed by using `getClaims(jwt)` instead, which decodes AND verifies
// the token (a real server round-trip for this project's symmetric-secret local/staging
// setup, not just a local decode) and returns the actual claims the hook injected — the
// same source RLS policies themselves read via `auth.jwt()`.
//
// Two Supabase clients are used deliberately, for two different jobs — conflating them
// would be a real security bug, not a style choice:
//   1. `userClient` — created with the ANON key. Used ONLY to call getClaims(jwt) on the
//      caller's own forwarded Authorization token (supabase.functions.invoke() sends this
//      automatically) — resolves "who is calling, and do they really carry the admin claim."
//   2. `adminClient` — created with the SERVICE_ROLE key (auto-injected into every Edge
//      Function's environment by the Supabase platform — never set manually, never committed
//      anywhere). This is the ONLY client that ever touches the `clients` table here, and
//      only after userClient has confirmed the caller is a real, currently-valid admin.
//      Bypasses RLS entirely, the exact same role the Admin SDK plays on the Firebase side.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail } from '../_shared/send-email.ts';

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

    // Real per-PM attribution (Backend Migration Phase C — Stage 1, 2026-09-06): captured
    // directly from the caller's own already-verified JWT claims computed above — zero extra
    // DB round trip. Written into the resolved/created/updated row below.
    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json();
    const clientId = body && body.clientId;
    if (!clientId) {
      return jsonResponse({ error: 'clientId is required.' }, 400);
    }

    // Only this privileged client ever reads/writes the clients table — bypasses RLS,
    // mirroring the Admin SDK's own bypass of Firestore security rules exactly.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: existing, error: fetchError } = await adminClient
      .from('clients')
      .select('status, name, email')
      .eq('id', clientId)
      .single();
    if (fetchError || !existing) {
      return jsonResponse({ error: 'Unknown client: ' + clientId }, 404);
    }
    if (existing.status !== 'pending_review') {
      return jsonResponse({
        error: 'Client ' + clientId + ' is not pending review (status: ' + existing.status + ').'
      }, 409);
    }

    const { error: updateError } = await adminClient
      .from('clients')
      .update({ status: 'active', application_resolved_at: new Date().toISOString(), application_resolved_by: adminId, application_resolved_by_email: adminEmail })
      .eq('id', clientId);
    if (updateError) {
      return jsonResponse({ error: 'Update failed: ' + updateError.message }, 500);
    }

    // Backend Migration Phase D — Stage 1 (2026-09-06): a real client's very first real
    // signal from the platform. Best-effort — see send-email.ts's own header for why a
    // failed/misconfigured send never fails this already-successful approval. Genuinely
    // awaited (not fire-and-forget) since a Deno Edge Function can be torn down the moment
    // its response is sent — an un-awaited send risks being cut off mid-flight. The
    // response shape below is completely unchanged either way: exactly the same
    // { id, status } this function has always returned.
    await sendEmail(adminClient, {
      to: existing.email,
      subject: 'Your Marketswave application has been approved',
      html: '<p>Hi ' + existing.name + ',</p><p>Your Marketswave account application has been approved. You can now sign in and access your dashboard.</p>',
      relatedEntityType: 'client_application',
      relatedEntityId: clientId
    });

    return jsonResponse({ id: clientId, status: 'active' }, 200);
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
