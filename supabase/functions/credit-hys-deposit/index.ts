// Backend Migration Phase B — Stage 4 (2026-09-02).
//
// Real Edge Function port of engine-core.js's creditHYSDeposit(clientId, requestId,
// confirmedAmount) — read that function's real source in full before writing this, not
// reinvented. THE ONE DETAIL MOST LIKELY TO GET WRONG IN A CARELESS PORT, called out
// explicitly, same category as Stage 2's credit-deposit and Stage 1's execute-sell: confirmed
// amount (PM-entered at credit time) is authoritative and MAY DIFFER from the client's
// original requested_amount — preserved exactly, the credited amount always comes from the
// request body's confirmedAmount, never from the stored requested_amount.
//
// maturity_date is computed from NOW (credit time), not the original request date — a term
// deposit's clock starts when funds actually land, not when the client asked to open it —
// preserved exactly from the local function's own documented reasoning. projected_interest is
// computed from the CONFIRMED amount, not the requested one.
//
// HYS deliberately never touches account_state — see this stage's migration file header for
// the full "why" (HYS is its own pool, funded/paid out externally). Still lands in
// transactions (type HYS_DEPOSIT) so the activity is visible in one place, mirroring the local
// engine's own appendTransactionForClient() call exactly.
//
// ★ THE ONE EXCEPTION TO THAT, ADDED 2026-09-11: an INTERNAL TRANSFER (method 'internal')
// funds the pocket from the client's own unallocated capital, so it necessarily DOES move
// account_state — that movement is the entire feature. The "HYS never touches account_state"
// rule still holds for every externally-funded pocket, which is what it was always about:
// money arriving from outside the platform does not pass through unallocated on its way in.
//
// Three things differ on that path and each is enforced HERE, server-side, never trusted from
// the admin UI: the confirmed amount is not PM-editable, the client's CURRENT unallocated
// capital is re-validated, and the ledger row is HYS_TRANSFER_IN rather than HYS_DEPOSIT.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — never getUser(), same pattern as every
// other admin-only function in this project.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
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
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    // Real per-PM attribution (Backend Migration Phase C — Stage 1, 2026-09-06): captured
    // directly from the caller's own already-verified JWT claims computed above — zero extra
    // DB round trip. Written into the resolved/created/updated row below.
    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json();
    const requestId = body && body.requestId;
    const confirmedAmount = body && body.confirmedAmount;
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);
    if (typeof confirmedAmount !== 'number' || !isFinite(confirmedAmount) || confirmedAmount <= 0) {
      return jsonResponse({ error: 'confirmedAmount must be a positive number.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('hys_deposit_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown HYS deposit request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'HYS deposit request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }
    if (request.pocket_type === 'fixed' && confirmedAmount < 5000) {
      return jsonResponse({ error: 'Fixed Deposit pockets require a minimum of $5,000 — confirmedAmount is below that minimum.' }, 400);
    }

    const isInternal = request.method === 'internal';
    const clientId = request.client_id;

    // ★ A PM-EDITABLE AMOUNT IS MEANINGLESS FOR AN INTERNAL TRANSFER, so it is refused
    // rather than silently accepted. The editable confirmed amount exists because external
    // settlement is genuinely uncertain — wire fees, FX, a partial transfer — and the PM is
    // recording what actually landed. Nothing lands here: the capital is already in the
    // account, and the figure is exact. This mirrors approve-hys-withdrawal's own reasoning
    // for being a pure confirm ("a deterministic calculation, not real-world settlement
    // uncertainty"). The admin UI locks the field, but the rule is enforced here because a
    // UI control is not a constraint.
    if (isInternal && Math.abs(round2(confirmedAmount) - round2(request.requested_amount)) > 1e-9) {
      return jsonResponse({
        error: 'An internal transfer moves an exact amount and cannot be adjusted at approval. ' +
          'Approve $' + round2(request.requested_amount).toLocaleString() + ' as requested, or reject it.'
      }, 400);
    }

    // ★ RE-VALIDATION, END TWO OF TWO. Pattern reused from approve-withdrawal/index.ts:81-96
    // verbatim in shape — fetch the CURRENT balance, compare with the same 1e-9 epsilon, 409
    // with the real numbers in the message. This is the exact race that function already
    // guards: the client can commit $50k here and then allocate that same capital elsewhere
    // before a PM acts, so a balance checked only at request time is a balance that can go
    // stale into the negative.
    let currentUnallocated = 0;
    if (isInternal) {
      const { data: accountState, error: accountErr } = await admin
        .from('account_state')
        .select('unallocated_capital')
        .eq('client_id', clientId)
        .maybeSingle();
      if (accountErr) return jsonResponse({ error: accountErr.message }, 500);
      currentUnallocated = accountState ? accountState.unallocated_capital : 0;
      if (confirmedAmount > currentUnallocated + 1e-9) {
        return jsonResponse({
          error: 'Cannot approve internal transfer ' + requestId + ': only ' + currentUnallocated +
            ' unallocated capital remains, but ' + confirmedAmount + ' was requested to transfer.'
        }, 409);
      }
    }
    const now = new Date();
    let maturityDate: string | null = null;
    let projectedInterest = 0;
    if (request.pocket_type === 'fixed') {
      const maturity = new Date(now);
      if (request.term_mode === 'short') maturity.setMonth(maturity.getMonth() + request.term_months);
      else maturity.setFullYear(maturity.getFullYear() + request.term_years);
      maturityDate = maturity.toISOString();
      projectedInterest = round2(confirmedAmount * (request.rate / 100) * request.term_in_years);
    }

    // ★ THE DEBIT. Claimed BEFORE the pocket is created, deliberately: unallocated capital is
    // the scarce resource here, so it is taken first and the pocket built against it, rather
    // than creating a pocket and hoping the debit lands. There is no cross-statement
    // transaction available through supabase-js — the same non-atomicity every other
    // multi-write function in this project already carries — so the one realistic failure
    // (the pocket insert being refused) is COMPENSATED explicitly below rather than left to
    // strand a client's capital with nothing to show for it.
    if (isInternal) {
      const { error: debitErr } = await admin
        .from('account_state')
        .upsert(
          { client_id: clientId, unallocated_capital: round2(currentUnallocated - confirmedAmount), updated_at: new Date().toISOString() },
          { onConflict: 'client_id' }
        );
      if (debitErr) return jsonResponse({ error: debitErr.message }, 500);
    }

    // Same id format high-yield-savings.html's own local createPocket() convention was for —
    // here a real Postgres-native gen_random_uuid() default handles it, so no id is set
    // explicitly on insert.
    const { data: pocket, error: pocketErr } = await admin
      .from('hys_pockets')
      .insert({
        client_id: clientId,
        pocket_type: request.pocket_type,
        amount: round2(confirmedAmount),
        status: 'active',
        term_mode: request.term_mode,
        term_months: request.term_months,
        term_years: request.term_years,
        term_label: request.term_label,
        rate: request.rate,
        term_in_years: request.term_in_years,
        maturity_date: maturityDate,
        projected_interest: projectedInterest,
        funding_method: isInternal ? 'unallocated capital' : (request.method === 'crypto' ? 'crypto wallet' : 'bank account')
      })
      .select()
      .single();
    if (pocketErr) {
      // Put the capital back. Without this the client would have been debited for a pocket
      // that does not exist, with the request still pending — the worst of the three states.
      if (isInternal) {
        await admin
          .from('account_state')
          .upsert(
            { client_id: clientId, unallocated_capital: round2(currentUnallocated), updated_at: new Date().toISOString() },
            { onConflict: 'client_id' }
          );
      }
      return jsonResponse({ error: pocketErr.message }, 500);
    }

    // A HYS_DEPOSIT transaction has no product_id/units/price, just total_value/pocket
    // context — same shape as the local HYS_DEPOSIT transaction creditHYSDeposit() itself
    // produces. HYS_TRANSFER_IN is the internally-funded counterpart: see the migration's own
    // header for why reusing HYS_DEPOSIT here would leave an unexplained drop in unallocated
    // capital, and why this is one row rather than a debit/credit pair.
    const { data: txn, error: txnErr } = await admin
      .from('transactions')
      .insert({
        client_id: clientId,
        product_id: null,
        type: isInternal ? 'HYS_TRANSFER_IN' : 'HYS_DEPOSIT',
        units: null,
        price: null,
        total_value: round2(confirmedAmount),
        realized_return: null,
        status: 'Completed'
      })
      .select()
      .single();
    if (txnErr) return jsonResponse({ error: txnErr.message }, 500);

    const { data: updatedRequest, error: updateErr } = await admin
      .from('hys_deposit_requests')
      .update({
        status: 'credited',
        resolved_at: new Date().toISOString(),
        credited_amount: round2(confirmedAmount),
        pocket_id: pocket.id,
        transaction_id: txn.id,
        resolved_by: adminId,
        resolved_by_email: adminEmail
      })
      .eq('id', requestId)
      .select()
      .single();
    if (updateErr) return jsonResponse({ error: updateErr.message }, 500);

    // Backend Migration Phase D — Stage 2 (2026-09-06): best-effort, genuinely awaited — see
    // approve-client-application/index.ts's own identical comment for the full "why."
    const { data: clientRow } = await admin.from('clients').select('name, email').eq('id', clientId).maybeSingle();
    if (clientRow) {
      const pocketLabel = request.pocket_type === 'fixed'
        ? 'Fixed Deposit pocket' + (request.term_label ? ' (' + request.term_label + ')' : '')
        : 'As You Want pocket';
      // ★ An internal transfer email must not describe a deposit that never arrived. The
      // client moved their own capital; nothing was received from outside, and the figure
      // that changed is their unallocated balance — so the email says exactly that, and
      // reports the remaining balance, which is the number they will actually want.
      const detailRows = [
        { label: 'Pocket type', value: pocketLabel },
        { label: isInternal ? 'Amount transferred' : 'Amount credited', value: '$' + round2(confirmedAmount).toLocaleString() }
      ];
      if (isInternal) {
        detailRows.push({ label: 'Funded from', value: 'Your unallocated capital' });
        detailRows.push({ label: 'Unallocated capital remaining', value: '$' + round2(currentUnallocated - confirmedAmount).toLocaleString() });
      }
      if (maturityDate) detailRows.push({ label: 'Maturity date', value: new Date(maturityDate).toISOString().slice(0, 10) });
      const { html, text } = renderEmail({
        heading: isInternal
          ? 'Your transfer to High Yield Savings is complete'
          : 'Your High Yield Savings deposit has been credited',
        introParagraphs: [isInternal
          ? 'Hi ' + clientRow.name + ', your Portfolio Manager has approved the transfer of capital from your unallocated balance into a new savings pocket. The capital has moved within your account — no payment was taken from outside it.'
          : 'Hi ' + clientRow.name + ', your deposit has been credited to a new savings pocket, held separately from your main portfolio.'],
        detailRows,
        cta: { text: 'View your pocket', href: siteLink('high-yield-savings.html') },
        footerType: 'investment'
      });
      await sendEmail(admin, {
        to: clientRow.email,
        subject: isInternal
          ? 'Your Marketswave transfer to High Yield Savings is complete'
          : 'Your Marketswave High Yield Savings deposit has been credited',
        html,
        text,
        relatedEntityType: 'hys_deposit_request',
        relatedEntityId: requestId
      });
    }

    return jsonResponse(toClientShape(updatedRequest), 200);
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
    resolvedBy: row.resolved_by,
    resolvedByEmail: row.resolved_by_email,
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
