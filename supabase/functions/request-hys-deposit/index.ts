// Backend Migration Phase B — Stage 4 (2026-09-02).
//
// Real Edge Function port of engine-core.js's requestHYSDeposit(pocketType, term, amount,
// method, details) — read that function's real source in full before writing this, not
// reinvented. Same "request now, execute later" discipline as every other request-* function
// in this project: creates a pending row only, touches no pocket/transaction. Only
// credit-hys-deposit (a separate, admin-only function) ever creates the actual pocket.
//
// CLIENT-CALLABLE, SELF ONLY — same reasoning as request-deposit/request-withdrawal: clientId
// is derived from the caller's own verified JWT (getClaims(jwt).sub), never trusted from the
// request body, mirroring the local requestHYSDeposit()'s own ambient (no-clientId-parameter)
// shape.
//
// term is { mode: 'short'|'locked', value: number } for a Fixed Deposit pocket, or
// null/omitted for an As You Want pocket — identical shape to the real local function's own
// second parameter.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getHysRate } from '../_shared/hys-engine.ts';

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
    const pocketType = body && body.pocketType;
    const term = body && body.term;
    const amount = body && body.amount;
    const method = body && body.method;
    const details = (body && body.details) || null;

    // Same validation as requestHYSDeposit() itself, byte-for-byte.
    if (pocketType !== 'fixed' && pocketType !== 'ayw') {
      return jsonResponse({ error: 'pocketType must be either "fixed" or "ayw".' }, 400);
    }
    if (method !== 'crypto' && method !== 'bank') {
      return jsonResponse({ error: 'method must be either "crypto" or "bank".' }, 400);
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return jsonResponse({ error: 'Deposit amount must be a positive number.' }, 400);
    }

    let termMode: string | null = null, termValue: number | null = null, termLabel: string | null = null;
    let termMonths: number | null = null, termYears: number | null = null, rate: number | null = null, termInYears = 0;

    if (pocketType === 'fixed') {
      if (amount < 5000) {
        return jsonResponse({ error: 'Fixed Deposit pockets require a minimum of $5,000.' }, 400);
      }
      if (!term || (term.mode !== 'short' && term.mode !== 'locked')) {
        return jsonResponse({ error: 'term.mode must be either "short" or "locked" for a Fixed Deposit pocket.' }, 400);
      }
      termMode = term.mode;
      termValue = term.value;
      try {
        if (termMode === 'short') {
          if (!Number.isInteger(termValue) || termValue! < 1 || termValue! > 12) {
            return jsonResponse({ error: 'Short-term deposits must have a term between 1 and 12 months.' }, 400);
          }
          termMonths = termValue;
          rate = getHysRate('short', termMonths!);
          termInYears = termMonths! / 12;
          termLabel = termMonths + ' Month' + (termMonths! > 1 ? 's' : '');
        } else {
          if (!Number.isInteger(termValue) || termValue! < 1 || termValue! > 5) {
            return jsonResponse({ error: 'Locked deposits must have a term between 1 and 5 years.' }, 400);
          }
          termYears = termValue;
          rate = getHysRate('locked', termYears!);
          termInYears = termYears!;
          termLabel = termYears + ' Year' + (termYears! > 1 ? 's' : '');
        }
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }

    const currency = method === 'crypto' ? ((details && details.asset) || 'CRYPTO') : 'USD';

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: request, error: insertErr } = await admin
      .from('hys_deposit_requests')
      .insert({
        client_id: clientId,
        pocket_type: pocketType,
        term_mode: termMode,
        term_months: termMonths,
        term_years: termYears,
        term_label: termLabel,
        rate: rate,
        term_in_years: termInYears,
        requested_amount: round2(amount),
        method: method,
        currency: currency,
        details: details,
        status: 'pending'
      })
      .select()
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    return jsonResponse(toClientShape(request), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.client_id,
    pocketType: row.pocket_type,
    termMode: row.term_mode,
    termMonths: row.term_months,
    termYears: row.term_years,
    termLabel: row.term_label,
    rate: row.rate,
    termInYears: row.term_in_years,
    requestedAmount: row.requested_amount,
    method: row.method,
    currency: row.currency,
    details: row.details,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    creditedAmount: row.credited_amount,
    pocketId: row.pocket_id,
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
