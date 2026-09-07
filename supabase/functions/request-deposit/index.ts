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

    // Same validation as requestDeposit() itself, byte-for-byte.
    if (method !== 'crypto' && method !== 'bank') {
      return jsonResponse({ error: 'method must be either "crypto" or "bank".' }, 400);
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return jsonResponse({ error: 'Deposit amount must be a positive number.' }, 400);
    }
    if (!currency) {
      return jsonResponse({ error: 'currency is required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: request, error: insertErr } = await admin
      .from('deposit_requests')
      .insert({
        client_id: clientId,
        method: method,
        requested_amount: round2(amount),
        currency: currency,
        details: details,
        status: 'pending'
      })
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
        introParagraphs: ['Hi ' + clientRow.name + ', your deposit request has been received and is awaiting review by your Portfolio Manager. You will receive another email once it has been credited.'],
        detailRows: [
          { label: 'Amount requested', value: currency + ' ' + round2(amount).toLocaleString() },
          { label: 'Method', value: method === 'crypto' ? 'Crypto' : 'Bank Transfer' }
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
