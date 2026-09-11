// Backend Migration Phase B — Stage 2 (Aug 30, 2026).
//
// Real Edge Function port of engine-core.js's requestDeposit(method, amount, currency,
// details) — read that function's real source in full before writing this, not reinvented.
// Same "request now, execute later" discipline as the local version and as this stage's own
// request-withdrawal: creates a pending row only, touches account_state/transactions not at
// all. Only credit-deposit (a separate, admin-only function) ever moves money.
//
// CLIENT-CALLABLE, SELF ONLY. Unlike credit-deposit/reject-deposit (admin-only, take an
// explicit requestId that already carries its own client_id), this function derives the
// owning client_id from the CALLER'S OWN verified JWT (getClaims(jwt).sub) — never from the
// request body — mirroring the local requestDeposit()'s own ambient
// (no-clientId-parameter) shape: a client can only ever request a deposit for themselves,
// the same way the real deploy-capital.html caller has no way to pass someone else's id
// either. This also means the real RLS "clients can insert their own pending deposit
// request" policy (client_id = auth.uid()) would already allow the identical insert directly
// from the client SDK with no Edge Function at all — this function exists to centralize the
// same validation the local engine already applies (method/amount/currency), not because RLS
// alone couldn't enforce ownership.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { round2 } from '../_shared/portfolio-engine.ts';
import { sendEmail, renderEmail, siteLink } from '../_shared/send-email.ts';

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
    const clientId = claimsData.claims.sub as string;

    const body = await req.json();
    const method = body && body.method;
    const amount = body && body.amount;
    const currency = body && body.currency;
    const details = (body && body.details) || null;

    if (method !== 'crypto' && method !== 'bank') {
      return jsonResponse({ error: 'method must be either "crypto" or "bank".' }, 400);
    }
    if (!currency) {
      return jsonResponse({ error: 'currency is required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // ★ Crypto deposit routing (2026-09-11): a crypto request CARRIES NO AMOUNT. The PM
    // determines what arrived from the chain, so the client is never asked for a figure
    // (an amount they type is at best a restatement of what their wallet showed, at worst a
    // guess a PM would then have to argue with). What the request carries instead is WHICH
    // assigned address the client was shown — resolved here, server-side, from the caller's
    // own active assignment for the route, never trusted from the body — plus an optional
    // transaction hash. A client with no assigned address for the route cannot submit at
    // all; the UI shows its own empty state before this is reachable, and this 409 is the
    // backstop for a call that bypasses it.
    //
    // The bank branch below is byte-for-byte the original validation and insert.
    let insertRow: Record<string, unknown>;
    let route: { currency: string; network: string; currency_name: string; network_label: string } | null = null;
    let txHash: string | null = null;
    if (method === 'crypto') {
      const network = body && body.network;
      if (typeof network !== 'string' || !network) {
        return jsonResponse({ error: 'network is required for a crypto deposit.' }, 400);
      }
      if (amount !== undefined && amount !== null) {
        return jsonResponse({ error: 'A crypto deposit request does not carry an amount; the amount received is determined from the chain.' }, 400);
      }
      const rawHash = body && body.txHash;
      if (rawHash !== undefined && rawHash !== null && rawHash !== '') {
        if (typeof rawHash !== 'string') return jsonResponse({ error: 'txHash must be a string.' }, 400);
        txHash = rawHash.trim();
        if (txHash.length < 10 || txHash.length > 128 || /\s/.test(txHash)) {
          return jsonResponse({ error: 'That does not look like a transaction hash. Copy the full transaction ID from your wallet, or leave it blank.' }, 400);
        }
      }

      const { data: routeRow, error: routeErr } = await admin
        .from('deposit_routes')
        .select('currency, network, currency_name, network_label')
        .eq('currency', currency)
        .eq('network', network)
        .maybeSingle();
      if (routeErr) return jsonResponse({ error: routeErr.message }, 500);
      if (!routeRow) return jsonResponse({ error: 'Unsupported currency/network: ' + currency + ' on ' + network + '.' }, 400);
      route = routeRow;

      const { data: assignment, error: assignErr } = await admin
        .from('deposit_address_assignments')
        .select('id, address_id')
        .eq('client_id', clientId)
        .eq('currency', route.currency)
        .eq('network', route.network)
        .is('removed_at', null)
        .maybeSingle();
      if (assignErr) return jsonResponse({ error: assignErr.message }, 500);
      if (!assignment) {
        return jsonResponse({ error: 'No ' + route.currency_name + ' (' + route.network_label + ') deposit address has been assigned to your account yet. Your Portfolio Manager assigns one per client.' }, 409);
      }

      insertRow = {
        client_id: clientId,
        method: 'crypto',
        requested_amount: null,
        currency: route.currency,
        network: route.network,
        deposit_address_id: assignment.address_id,
        tx_hash: txHash,
        details: details,
        status: 'pending'
      };
    } else {
      // Same validation as requestDeposit() itself, byte-for-byte.
      if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
        return jsonResponse({ error: 'Deposit amount must be a positive number.' }, 400);
      }
      insertRow = {
        client_id: clientId,
        method: method,
        requested_amount: round2(amount),
        currency: currency,
        details: details,
        status: 'pending'
      };
    }

    const { data: request, error: insertErr } = await admin
      .from('deposit_requests')
      .insert(insertRow)
      .select()
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    // Branded HTML Emails (2026-09-07): a receipt confirming the request was received —
    // closes the "submit and hear nothing back" gap this task's own instruction named for
    // deposit/withdrawal requests specifically. Best-effort, genuinely awaited — see
    // send-email.ts's own header for the full "why a failed send never fails the real
    // primary action" reasoning; a client's real pending deposit request already exists by
    // this point regardless of whether this receipt email arrives.
    const { data: clientRow } = await admin.from('clients').select('name, email').eq('id', clientId).maybeSingle();
    if (clientRow) {
      const { html, text } = renderEmail({
        heading: 'We received your deposit request',
        introParagraphs: [method === 'crypto'
          ? 'Hi ' + clientRow.name + ', we have recorded that you sent a crypto deposit. Your Portfolio Manager will confirm the transfer on-chain, credit the amount received to your account, and email you once that is done.'
          : 'Hi ' + clientRow.name + ', your deposit request has been received and is awaiting review by your Portfolio Manager. You will receive another email once it has been credited.'],
        // A crypto request has no amount to restate — the email says so rather than
        // printing a blank or a zero, the same rule the client's own pending view follows.
        detailRows: method === 'crypto' && route
          ? [
              { label: 'Method', value: 'Crypto — ' + route.currency_name + ' (' + route.network_label + ')' },
              { label: 'Amount', value: 'Determined from the chain once your transfer is confirmed' },
              { label: 'Transaction hash', value: txHash || 'Not provided' }
            ]
          : [
              { label: 'Amount requested', value: currency + ' ' + round2(amount).toLocaleString() },
              { label: 'Method', value: 'Bank Transfer' }
            ],
        cta: { text: 'View your requests', href: siteLink('deploy-capital.html') },
        footerType: 'investment'
      });
      await sendEmail(admin, {
        to: clientRow.email,
        subject: 'We received your Marketswave deposit request',
        html,
        text,
        relatedEntityType: 'deposit_request',
        relatedEntityId: request.id
      });
    }

    return jsonResponse(toClientShape(request), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.client_id,
    method: row.method,
    requestedAmount: row.requested_amount,
    currency: row.currency,
    network: row.network,
    depositAddressId: row.deposit_address_id,
    txHash: row.tx_hash,
    details: row.details,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    creditedAmount: row.credited_amount,
    transactionId: row.transaction_id,
    reason: row.reason
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
