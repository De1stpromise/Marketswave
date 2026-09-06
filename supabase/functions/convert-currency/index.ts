// Backend Migration Phase D — Stage 1 (2026-09-06).
//
// Real currency conversion for dashboard.html's Currency Converter card, replacing the
// static "$920.00"/whatever-was-hardcoded result. Uses Frankfurter (frankfurter.dev) — a
// real, free, no-key exchange-rate API backed by the European Central Bank's own published
// reference rates — confirmed directly with a real request before writing this function.
//
// Deliberately NOT cached the way get-market-snapshot's own data is: FX rates are queried
// on demand, once per real conversion request, since a currency converter's whole point is
// "convert THIS amount right now" rather than a background snapshot a dashboard card polls
// periodically — there's no equivalent "don't hit the API on every page load" concern here,
// since this only runs when a client actually submits a conversion.
//
// AUTHORIZATION: any authenticated caller (client or admin) — matches get-market-snapshot's
// own scope, since this is likewise not scoped to any one client's own data.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'SEK'];

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

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }

    const body = await req.json();
    const amount = body && body.amount;
    const from = body && typeof body.from === 'string' ? body.from.toUpperCase() : null;
    const to = body && typeof body.to === 'string' ? body.to.toUpperCase() : null;

    if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) {
      return jsonResponse({ error: 'amount must be a non-negative number.' }, 400);
    }
    if (!from || !SUPPORTED_CURRENCIES.includes(from)) {
      return jsonResponse({ error: 'from must be one of: ' + SUPPORTED_CURRENCIES.join(', ') }, 400);
    }
    if (!to || !SUPPORTED_CURRENCIES.includes(to)) {
      return jsonResponse({ error: 'to must be one of: ' + SUPPORTED_CURRENCIES.join(', ') }, 400);
    }

    if (from === to) {
      return jsonResponse({ amount: amount, from: from, to: to, rate: 1, result: round2(amount), asOf: null }, 200);
    }

    const url = 'https://api.frankfurter.dev/v1/latest?amount=' + encodeURIComponent(String(amount)) + '&from=' + from + '&to=' + to;
    const res = await fetch(url);
    if (!res.ok) return jsonResponse({ error: 'Frankfurter request failed: HTTP ' + res.status }, 502);
    const data = await res.json();
    if (!data.rates || typeof data.rates[to] !== 'number') {
      return jsonResponse({ error: 'Frankfurter returned an unexpected shape: ' + JSON.stringify(data) }, 502);
    }

    const result = data.rates[to];
    const rate = amount > 0 ? result / amount : null;

    return jsonResponse({
      amount: amount,
      from: from,
      to: to,
      rate: rate,
      result: round2(result),
      asOf: data.date
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
