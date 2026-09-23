// Backend Migration Phase B — Stage 4 (2026-09-02).
//
// Real Edge Function port of engine-core.js's approveHYSWithdrawal(clientId, requestId) — read
// that function's real source in full before writing this, not reinvented. Re-validates
// against the pocket's CURRENT state at approval time (not just the snapshot taken at request
// time) — mirrors approve-withdrawal/approve-sell's own re-validation discipline, for the same
// reason: state can genuinely change between a request being submitted and a PM getting to it
// (e.g. the pocket was already withdrawn through some other resolved request).
//
// ★ REVERSED 2026-09-23: AN APPROVED POCKET WITHDRAWAL NOW CREDITS unallocated_capital.
// This function used to end with the words "HYS is its own pool, funded and paid out
// externally" and never touched account_state at all — the money simply left the system and
// a payout was assumed to happen off-platform. It no longer does. A pocket returns its money
// to the available balance, and reaching a bank from there is a normal WITHDRAWAL, which is
// already a real, gated, audited flow. This is the exact mirror of HYS_TRANSFER_IN (row 197),
// which moves unallocated capital INTO a pocket.
//
// WHAT IS CREDITED is whatever the pocket genuinely returns, computed ONCE at request time by
// the shared computeHysWithdrawalAmount() and carried on the request as receive_amount:
//   As You Want                    principal
//   Short-Term fixed, early        principal only — accrued interest forfeited
//   Matured fixed                  principal + earned interest
//   Locked, before maturity        refused outright at request time
//
// ORDERING, and why it is this way round. There is no cross-statement transaction through
// supabase-js. Crediting first would mean a failed pocket update leaves the request PENDING
// with the money already paid — and a retry would credit it a SECOND time. So the pocket is
// claimed first (its own `status === 'withdrawn'` guard above is what makes a second pass
// refuse), then the balance is credited, and a failed credit COMPENSATES by restoring the
// pocket's prior status so the retry is clean. Same discipline, and same reasoning, as
// credit-hys-deposit's own compensating restore on the way in.
//
// Still lands in transactions (type HYS_WITHDRAWAL) so the activity is visible in one place.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — same pattern as every other admin-only
// function in this project.
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
    if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: request, error: fetchErr } = await admin
      .from('hys_withdrawal_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!request) return jsonResponse({ error: 'Unknown HYS withdrawal request: ' + requestId }, 404);
    if (request.status !== 'pending') {
      return jsonResponse({ error: 'HYS withdrawal request ' + requestId + ' is not pending (status: ' + request.status + ').' }, 409);
    }

    // Re-validation-at-approval-time against the pocket's CURRENT state, not the snapshot
    // taken when the request was created — the core property this function must preserve.
    const { data: pocket, error: pocketErr } = await admin
      .from('hys_pockets')
      .select('*')
      .eq('id', request.pocket_id)
      .maybeSingle();
    if (pocketErr) return jsonResponse({ error: pocketErr.message }, 500);
    if (!pocket) return jsonResponse({ error: 'Pocket ' + request.pocket_id + ' no longer exists.' }, 404);
    if (pocket.status === 'withdrawn') {
      return jsonResponse({ error: 'Pocket ' + request.pocket_id + ' has already been withdrawn.' }, 409);
    }

    const clientId = request.client_id;
    const priorPocketStatus = pocket.status;

    // ★ STEP 1 — CLAIM THE POCKET. Doing this before the credit is what makes a retry safe;
    // see the ordering note in this file's own header.
    const { error: pocketUpdateErr } = await admin
      .from('hys_pockets')
      .update({
        status: 'withdrawn',
        withdrawn_at: new Date().toISOString(),
        withdrawn_amount: request.receive_amount,
        withdrawal_method: 'unallocated capital'
      })
      .eq('id', request.pocket_id);
    if (pocketUpdateErr) return jsonResponse({ error: pocketUpdateErr.message }, 500);

    // ★ STEP 2 — CREDIT THE AVAILABLE BALANCE. The mirror of credit-hys-deposit's own debit:
    // read the current balance, add, upsert. upsert rather than update because a client whose
    // pocket was funded externally (HYS_DEPOSIT) may genuinely have no account_state row yet —
    // readAccountStateForClient()'s own "not found is not an error, it is zero" behaviour,
    // ported the same way Phase B Stage 2 ported it for deposits.
    const { data: accountState, error: accountErr } = await admin
      .from('account_state')
      .select('unallocated_capital')
      .eq('client_id', clientId)
      .maybeSingle();
    if (accountErr) {
      await restorePocket(admin, request.pocket_id, priorPocketStatus);
      return jsonResponse({ error: accountErr.message }, 500);
    }
    const currentUnallocated = accountState ? Number(accountState.unallocated_capital || 0) : 0;
    const { error: creditErr } = await admin
      .from('account_state')
      .upsert(
        {
          client_id: clientId,
          unallocated_capital: round2(currentUnallocated + Number(request.receive_amount)),
          updated_at: new Date().toISOString()
        },
        { onConflict: 'client_id' }
      );
    if (creditErr) {
      await restorePocket(admin, request.pocket_id, priorPocketStatus);
      return jsonResponse({ error: creditErr.message }, 500);
    }

    // A HYS_WITHDRAWAL transaction has no product_id/units/price, just total_value — same
    // shape as HYS_DEPOSIT. total_value is the amount credited to the available balance, which
    // is what capitalIn now reads (see _shared/portfolio-overview.ts).
    //
    // ★ realized_return STAYS NULL, and that is a decision rather than an omission. A matured
    // pocket returns principal + interest, so it is tempting to record the interest here and
    // have capitalIn add only the principal. That was considered and rejected: it would break
    // the property the value chart is built on (row 208 — the gap between the two lines IS the
    // return, exactly), because get-returns-summary computes realised from SELL rows only
    // (.eq('type','SELL')) and its total would no longer equal the gap. Pockets sit outside the
    // portfolio measure, so money arriving from one is capital arriving, the same as a deposit;
    // the interest a pocket earned stays visible where it already is — Total account value
    // counts a live pocket as amount + interestAccrued, so growth against accountDeposited has
    // reflected it since the day it accrued.
    const { data: txn, error: txnErr } = await admin
      .from('transactions')
      .insert({
        client_id: clientId,
        product_id: null,
        type: 'HYS_WITHDRAWAL',
        units: null,
        price: null,
        total_value: request.receive_amount,
        realized_return: null,
        status: 'Completed'
      })
      .select()
      .single();
    if (txnErr) return jsonResponse({ error: txnErr.message }, 500);

    const { data: updatedRequest, error: updateErr } = await admin
      .from('hys_withdrawal_requests')
      .update({
        status: 'approved',
        resolved_at: new Date().toISOString(),
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
      const forfeitNote = request.forfeit ? ' Since this pocket was withdrawn before maturity, projected interest was forfeited.' : '';
      const { html, text } = renderEmail({
        heading: 'Your savings pocket has been closed',
        introParagraphs: [
          'Hi ' + clientRow.name + ', your ' + (request.term_label || 'High Yield Savings') +
            ' pocket has been closed and the money is now in your available balance.' + forfeitNote,
          'You can invest it straight away, move it into another pocket, or request a withdrawal to your bank or wallet from Deploy Capital.'
        ],
        detailRows: [{ label: 'Returned to your available balance', value: '$' + request.receive_amount.toLocaleString() }],
        cta: { text: 'View your account', href: siteLink('high-yield-savings.html') },
        footerType: 'investment'
      });
      await sendEmail(admin, {
        to: clientRow.email,
        subject: 'Your Marketswave savings pocket has been closed',
        html,
        text,
        relatedEntityType: 'hys_withdrawal_request',
        relatedEntityId: requestId
      });
    }

    return jsonResponse(toClientShape(updatedRequest), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.client_id,
    pocketId: row.pocket_id,
    pocketType: row.pocket_type,
    termLabel: row.term_label,
    forfeit: row.forfeit,
    receiveAmount: row.receive_amount,
    method: row.method,
    destinationDetails: row.destination_details,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolvedByEmail: row.resolved_by_email,
    transactionId: row.transaction_id,
    reason: row.reason
  };
}

// Compensating restore for the one realistic failure between claiming the pocket and
// crediting the balance — puts the pocket back exactly as it was so the PM's retry is clean,
// rather than stranding a withdrawn pocket whose money was never paid.
async function restorePocket(admin: any, pocketId: string, priorStatus: string): Promise<void> {
  await admin
    .from('hys_pockets')
    .update({ status: priorStatus, withdrawn_at: null, withdrawn_amount: null, withdrawal_method: null })
    .eq('id', pocketId);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
