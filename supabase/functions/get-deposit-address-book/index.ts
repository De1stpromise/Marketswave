// ★ PM tool revamp, part 7 (2026-09-17) — the deposit address book, in one read.
//
// ADMIN-ONLY. The caller's JWT must carry a real is_admin claim, read with getClaims(jwt) and
// never getUser() — getUser() fetches the live auth.users DATABASE record, which is a
// different thing from the token's own hook-injected claims, and trusting it for authorization
// is a bug this project has already shipped once and caught (Supabase Migration Stage 3).
//
// A pure read with no side effect. Every read it makes is error-checked inside
// _shared/deposit-address-book.ts and the whole call throws rather than returning partial
// data — on this page a failed query and "nothing received" would otherwise render identically,
// and one of the figures it composes tells a PM which clients cannot deposit at all.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { buildDepositAddressBook } from '../_shared/deposit-address-book.ts';

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
    if (claimsData.claims.app_metadata?.is_admin !== true) return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const book = await buildDepositAddressBook(admin);
    return jsonResponse(book, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
