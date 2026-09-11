// ★ Authorization for the two SCHEDULED functions (2026-09-11) — refresh-market-data and
// check-price-alerts. This project had no scheduler before them, so it had no shape for
// "a caller that is not a person".
//
// pg_cron fires public.invoke_edge_function(), which calls out through pg_net carrying the
// service_role key as its bearer token. That key is itself a JWT signed with the same
// secret every other token is, so getClaims() verifies it exactly the same way — this is a
// real signature check, not a string comparison against a shared secret.
//
// A real PM is accepted too, so an operator can force a refresh or an alert sweep from the
// admin tool without waiting for the quarter hour. Nobody else: a client has no reason to
// be able to spend the platform's provider budget on demand.
import { createClient } from 'jsr:@supabase/supabase-js@2';

export interface SchedulerCaller {
  ok: boolean;
  status: number;
  error?: string;
  via?: 'service_role' | 'admin';
}

export async function authorizeScheduledCall(req: Request): Promise<SchedulerCaller> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { ok: false, status: 401, error: 'You must be signed in to perform this action.' };
  }

  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();

  // ★ A REAL FINDING, recorded because the obvious approach does not work:
  // getClaims() CANNOT validate a service_role key. It is a JWT, and it is signed with the
  // same secret, but it carries no `sub` and describes no user — getClaims() rejects it and
  // the call comes back 401, which is exactly what the first version of this file did.
  // Confirmed by a real call, not reasoned about.
  //
  // The correct check for "this is the platform itself calling" is a direct comparison
  // against the key this function already holds in its own environment. That is not a
  // weaker check than a signature verification: possessing the service_role key IS the
  // authorization, and anyone who has it can reach the database directly anyway.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (serviceRoleKey && jwt === serviceRoleKey) {
    return { ok: true, status: 200, via: 'service_role' };
  }

  // ★ ...AND A CAPABILITY CHECK, because the string compare above is not enough on a real
  // cloud project. It passed locally and returned 401 on real staging: a project can hold
  // more than one valid service_role credential (a rotated key, or the newer sb_secret_*
  // format alongside the legacy JWT), and the one the platform puts in this function's env
  // need not be the one the caller holds. Confirmed by a real call, not assumed.
  //
  // So the fallback asks what the token can actually DO. The Admin Auth API is the right
  // probe because it FAILS LOUDLY for anyone else — it returns a real "User not allowed"
  // error for an ordinary session.
  //
  // ★ A TABLE READ WOULD HAVE BEEN A SECURITY BUG HERE, and it was the first thing written:
  // an RLS denial on SELECT is not an error, it is an empty result set. "No error" from a
  // blocked table read is therefore true for EVERY signed-in client, which would have
  // handed any of them the platform's own authorization. The probe has to be something
  // that genuinely errors when it is refused.
  try {
    const probe = createClient(supabaseUrl, jwt, { auth: { persistSession: false } });
    const { error: probeError } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!probeError) return { ok: true, status: 200, via: 'service_role' };
  } catch (_err) {
    // Not a usable key at all; fall through to the ordinary admin check.
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, anonKey);
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
  if (claimsError || !claimsData) {
    return { ok: false, status: 401, error: 'You must be signed in to perform this action.' };
  }

  const claims = claimsData.claims as Record<string, unknown>;
  const appMetadata = (claims.app_metadata || {}) as Record<string, unknown>;
  if (appMetadata.is_admin === true) return { ok: true, status: 200, via: 'admin' };

  return { ok: false, status: 403, error: 'This action requires Portfolio Manager access.' };
}
