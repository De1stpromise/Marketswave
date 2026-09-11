// ★ Crypto deposit routing (2026-09-11).
//
// Adds one address to the shared deposit address book. Admin-only, via getClaims(jwt) —
// never getUser(), same as every other admin-only function here. The route (currency +
// network) must be one of the four seeded deposit_routes; the address must pass that
// route's structural validation (see _shared/deposit-address-validation.ts for what is and
// is not validated, and why). status is never written by this function — the database
// derives it (see the migration's trigger block).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { validateDepositAddress, toAddressClientShape } from '../_shared/deposit-address-validation.ts';

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
    const currency = body && body.currency;
    const network = body && body.network;
    const address = body && body.address;
    const label = body && typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;

    if (typeof currency !== 'string' || typeof network !== 'string') {
      return jsonResponse({ error: 'currency and network are required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: route, error: routeErr } = await admin
      .from('deposit_routes')
      .select('currency, network, currency_name, network_label, address_format')
      .eq('currency', currency)
      .eq('network', network)
      .maybeSingle();
    if (routeErr) return jsonResponse({ error: routeErr.message }, 500);
    if (!route) {
      return jsonResponse({ error: 'Unsupported currency/network: ' + currency + ' on ' + network + '.' }, 400);
    }

    const validationError = validateDepositAddress(route.address_format, address);
    if (validationError) {
      return jsonResponse({ error: 'Not a valid ' + route.currency_name + ' (' + route.network_label + ') address: ' + validationError }, 400);
    }

    const { data: row, error: insertErr } = await admin
      .from('deposit_addresses')
      .insert({
        currency: route.currency,
        network: route.network,
        address: address,
        label: label,
        created_by: adminId,
        created_by_email: adminEmail
      })
      .select()
      .single();
    if (insertErr) {
      if (insertErr.code === '23505') {
        return jsonResponse({ error: 'This address is already in the address book for ' + route.currency_name + ' (' + route.network_label + ').' }, 409);
      }
      return jsonResponse({ error: insertErr.message }, 500);
    }

    return jsonResponse(toAddressClientShape(row), 200);
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
