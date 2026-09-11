// ★ Crypto deposit routing (2026-09-11).
//
// Assigns one client to one address. Admin-only. Many clients may share an address; a
// client may hold at most one address per currency+network. Both rules — and retirement —
// are enforced by the database (a partial unique index and a before-insert trigger), not
// here: this function's own checks exist only to turn those failures into readable
// messages. Removing them would change the error text, not the guarantee.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { toAssignmentClientShape } from '../_shared/deposit-address-validation.ts';

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
    const addressId = body && body.addressId;
    const clientId = body && body.clientId;
    if (typeof addressId !== 'string' || !addressId) return jsonResponse({ error: 'addressId is required.' }, 400);
    if (typeof clientId !== 'string' || !clientId) return jsonResponse({ error: 'clientId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: address, error: addrErr } = await admin
      .from('deposit_addresses')
      .select('id, currency, network, status')
      .eq('id', addressId)
      .maybeSingle();
    if (addrErr) return jsonResponse({ error: addrErr.message }, 500);
    if (!address) return jsonResponse({ error: 'Unknown deposit address: ' + addressId }, 404);
    if (address.status === 'retired') {
      return jsonResponse({ error: 'This address has been retired and cannot be assigned to anyone new. Funds may still arrive at it from a wallet that saved it, so reusing it would misattribute them.' }, 409);
    }

    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('id, name')
      .eq('id', clientId)
      .maybeSingle();
    if (clientErr) return jsonResponse({ error: clientErr.message }, 500);
    if (!client) return jsonResponse({ error: 'Unknown client: ' + clientId }, 404);

    const { data: existing } = await admin
      .from('deposit_address_assignments')
      .select('id, address_id')
      .eq('client_id', clientId)
      .eq('currency', address.currency)
      .eq('network', address.network)
      .is('removed_at', null)
      .maybeSingle();
    if (existing) {
      const message = existing.address_id === addressId
        ? client.name + ' is already assigned to this address.'
        : client.name + ' already has a ' + address.currency + ' (' + address.network + ') address. Remove them from it first: a client holds one address per currency and network.';
      return jsonResponse({ error: message }, 409);
    }

    const { data: row, error: insertErr } = await admin
      .from('deposit_address_assignments')
      .insert({
        address_id: addressId,
        client_id: clientId,
        // currency/network are overwritten by the before-insert trigger from the address
        // itself; supplied here only so the NOT NULL constraint is satisfied at parse time.
        currency: address.currency,
        network: address.network,
        assigned_by: adminId,
        assigned_by_email: adminEmail
      })
      .select()
      .single();
    if (insertErr) {
      if (/DEPOSIT_ADDRESS_RETIRED/.test(insertErr.message)) {
        return jsonResponse({ error: 'This address has been retired and cannot be assigned to anyone new.' }, 409);
      }
      if (insertErr.code === '23505') {
        return jsonResponse({ error: client.name + ' already has an address on ' + address.currency + ' (' + address.network + ').' }, 409);
      }
      return jsonResponse({ error: insertErr.message }, 500);
    }

    return jsonResponse(toAssignmentClientShape(row), 200);
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
