// Branded HTML Emails (2026-09-07).
//
// New client-side trigger: "HYS pocket matured." Investigated first, per the standing "read
// the real source before building" discipline: the real maturity transition
// (resolveEffectivePocketStatus(), _shared/hys-engine.ts) is currently only ever resolved
// lazily, on touch, inside request-hys-withdrawal — meaning a client would only ever learn a
// pocket had matured at the exact moment they tried to withdraw from it, which defeats the
// "time-sensitive, currently invisible unless they happen to log in" framing this task named:
// even logging in and LOOKING at high-yield-savings.html never itself triggered the self-heal
// or an email, since the client reads hys_pockets via a bare, RLS-authorized
// `selectTable('hys_pockets')` (Backend Migration Phase B Stage 4's own real client-side
// direct-write/read design) — there is no Edge Function in that read path at all to hang an
// email on.
//
// THIS FUNCTION closes that gap: client-callable, self-only, called by
// high-yield-savings.html once on every real page load (mirroring how get-account-state/
// get-holdings/etc. are already called on load elsewhere in this project). Reuses
// resolveEffectivePocketStatus() from _shared/hys-engine.ts directly — the same shared
// function request-hys-withdrawal already depends on — rather than re-deriving the maturity
// rule a second time. Only fixed-term pockets that are still stored 'active' but have a real
// past maturity_date are ever affected; a pocket already correctly stored 'matured' (healed
// by a real withdrawal attempt) or genuinely still active produces no email and no write.
//
// Self-heals the real stored status the same way request-hys-withdrawal already does (a real
// `.update({ status: 'matured' })` write, service_role, matching Phase B Stage 4's own "no
// client-side write path on hys_pockets at all" RLS design) — so the data itself becomes
// increasingly accurate the more this is called, not just a read-time illusion.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { resolveEffectivePocketStatus } from '../_shared/hys-engine.ts';
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

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: pockets, error: pocketsErr } = await admin
      .from('hys_pockets')
      .select('id, pocket_type, status, maturity_date, amount, term_label')
      .eq('client_id', clientId)
      .eq('pocket_type', 'fixed')
      .eq('status', 'active');
    if (pocketsErr) return jsonResponse({ error: pocketsErr.message }, 500);

    const newlyMatured: { id: string; amount: number; term_label: string | null }[] = [];
    for (const pocket of pockets || []) {
      const effectiveStatus = resolveEffectivePocketStatus(pocket);
      if (effectiveStatus !== pocket.status) {
        const { error: healErr } = await admin.from('hys_pockets').update({ status: effectiveStatus }).eq('id', pocket.id);
        if (healErr) return jsonResponse({ error: healErr.message }, 500);
        newlyMatured.push({ id: pocket.id, amount: pocket.amount, term_label: pocket.term_label });
      }
    }

    if (newlyMatured.length > 0) {
      const { data: clientRow } = await admin.from('clients').select('name, email').eq('id', clientId).maybeSingle();
      if (clientRow) {
        const detailRows = newlyMatured.map((p) => ({
          label: p.term_label || 'Fixed Deposit pocket',
          value: '$' + Number(p.amount).toLocaleString()
        }));
        const heading = newlyMatured.length === 1 ? 'Your pocket has matured' : newlyMatured.length + ' of your pockets have matured';
        const { html, text } = renderEmail({
          heading,
          introParagraphs: ['Hi ' + clientRow.name + ', ' + (newlyMatured.length === 1 ? 'your High Yield Savings pocket has reached maturity.' : 'the following High Yield Savings pockets have reached maturity.') + ' You can now withdraw the full balance and projected interest with no forfeiture.'],
          detailRows,
          cta: { text: 'View your pockets', href: siteLink('high-yield-savings.html') },
          footerType: 'investment'
        });
        await sendEmail(admin, {
          to: clientRow.email,
          subject: newlyMatured.length === 1 ? 'Your Marketswave High Yield Savings pocket has matured' : 'Your Marketswave High Yield Savings pockets have matured',
          html,
          text,
          relatedEntityType: 'hys_pocket',
          relatedEntityId: newlyMatured[0].id
        });
      }
    }

    return jsonResponse({ maturedCount: newlyMatured.length }, 200);
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
