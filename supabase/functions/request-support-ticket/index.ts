// Backend Migration Phase B — Stage 6 (2026-09-02).
//
// Real Edge Function port of support.html's own dispute-submit handler (nextDisputeId() +
// requests.push()) — read that code in full before writing this, not reinvented. Creates a
// ticket IMMEDIATELY, unconditionally, with status 'Open' — there is NO pending/approved/
// rejected gate on creation, faithfully preserving the real local "file a dispute, no
// approval needed" behavior. This is a client-callable, self-only, NO-GATE creation
// function — the same category as documents' own direct-INSERT upload path, just
// implemented as a thin function instead of a raw RLS INSERT, because display_id (unlike a
// document's plain UUID) must be genuinely server-computed and displayed prominently — see
// this stage's migration file header for the full "why."
//
// CLIENT-CALLABLE, SELF ONLY — clientId derived from the caller's own verified JWT
// (getClaims(jwt).sub), never trusted from the request body.
//
// display_id generation mirrors nextDisputeId() exactly: scans THIS CLIENT'S OWN existing
// tickets (never a global scan — the real local function only ever sees the current client's
// own scoped array, so the id is genuinely unique PER CLIENT, not globally; the table's own
// `unique(client_id, display_id)` constraint enforces this same guarantee server-side, and
// also protects against a rare concurrent-double-submit race the local single-threaded
// version never had to worry about — a collision here fails the insert outright rather than
// silently reusing a number, which a retry would resolve).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const CATEGORIES = ['Transaction Issue', 'Account Access', 'Billing/Fees', 'Document/Signature Issue', 'Other'];

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
    const category = body && body.category;
    const description = body && typeof body.description === 'string' ? body.description.trim() : '';
    const evidence = (body && body.evidence) || null;

    // Same validation as support.html's own submit handler, byte-for-byte ("Please select a
    // category and describe the issue").
    if (CATEGORIES.indexOf(category) === -1) {
      return jsonResponse({ error: 'category must be one of: ' + CATEGORIES.join(', ') + '.' }, 400);
    }
    if (!description) {
      return jsonResponse({ error: 'description is required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: existing, error: fetchErr } = await admin
      .from('support_requests')
      .select('display_id')
      .eq('client_id', clientId);
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);

    let maxNum = 0;
    const re = /^DISP-(\d+)$/;
    (existing || []).forEach((r: { display_id: string }) => {
      const match = re.exec(r.display_id);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    });
    const displayId = 'DISP-' + String(maxNum + 1).padStart(4, '0');

    const { data: request, error: insertErr } = await admin
      .from('support_requests')
      .insert({
        client_id: clientId,
        display_id: displayId,
        reference: null,
        category: category,
        description: description,
        status: 'Open',
        evidence: evidence
      })
      .select()
      .single();
    if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

    return jsonResponse(toClientShape(request), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function toClientShape(row: Record<string, unknown>) {
  return {
    id: row.display_id,
    dbId: row.id,
    clientId: row.client_id,
    reference: row.reference,
    category: row.category,
    description: row.description,
    status: row.status,
    dateOpened: row.date_opened,
    lastUpdated: row.last_updated,
    evidence: row.evidence,
    pmNote: row.pm_note
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
