// Branded HTML Emails (2026-09-07).
//
// New trigger, both audiences: a real client-side application receipt AND the first
// PM-facing "new application awaiting review" email in the system.
//
// WHY THIS IS ITS OWN FUNCTION, NOT FOLDED INTO AN EXISTING ONE: signup.html's real client
// creation is a DIRECT `supabase.from('clients').insert(...)` call from the browser (Phase B
// Stage 2/Supabase Migration Stage 2/3) — an RLS-authorized table write, not an Edge Function
// call, so there is no server-side hook point on the creation path itself to attach an email
// to (the exact same architectural gap this task's own investigation found for document
// uploads — see notify-new-document-upload/index.ts's own header for the identical reasoning
// applied there). This function is called by signup.html immediately AFTER that direct
// insert succeeds, mirroring the same "client calls a dedicated notify endpoint right after
// its own already-authorized write" pattern used for the document-upload case, rather than
// introducing a new architecture category (a Postgres trigger/webhook) this project has never
// used anywhere else.
//
// SECURITY NOTE, disclosed rather than assumed safe: this function performs NO state
// mutation of its own — it only reads the caller's own already-existing `clients` row (self-
// only, via getClaims(jwt).sub) and sends email. A client calling this without having
// actually just signed up is a structural impossibility (they'd need a real, already-issued
// JWT, which only exists after a real signUp() call already created their auth.users row);
// calling it twice, or out of order relative to their own real clients.insert(), produces at
// worst a duplicate or slightly-early-looking notification, never a data or access-control
// issue — the same "false notification, not a real vulnerability" risk profile already
// accepted for notify-new-document-upload.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail, renderEmail, getAdminEmails, siteLink } from '../_shared/send-email.ts';

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
    const { data: clientRow, error: fetchErr } = await admin.from('clients').select('name, email, account_type').eq('id', clientId).maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!clientRow) return jsonResponse({ error: 'No client record found for this account yet.' }, 404);

    // 1. Real client-facing receipt — closes the "submits a 9-step application and hears
    // nothing until a PM acts" gap named directly in this task's own instruction.
    {
      const { html, text } = renderEmail({
        heading: 'We received your application',
        introParagraphs: [
          'Hi ' + clientRow.name + ', thank you for applying to Marketswave. Your application has been received and is now awaiting review by our Portfolio Management team.',
          'You will receive another email as soon as a decision has been made. This usually takes 1-2 business days.'
        ],
        footerType: 'general'
      });
      await sendEmail(admin, {
        to: clientRow.email,
        subject: 'We received your Marketswave application',
        html,
        text,
        relatedEntityType: 'client_application',
        relatedEntityId: clientId
      });
    }

    // 2. The first PM-facing email in the system — notify every currently-registered PM.
    const adminEmails = await getAdminEmails(admin);
    if (adminEmails.length > 0) {
      const { html, text } = renderEmail({
        heading: 'New client application awaiting review',
        introParagraphs: ['A new client application has been submitted and is awaiting review.'],
        detailRows: [
          { label: 'Applicant', value: clientRow.name },
          { label: 'Account type', value: clientRow.account_type || 'Individual Account' }
        ],
        cta: { text: 'Review in the admin tool', href: siteLink('admin-client-applications.html') },
        footerType: 'general'
      });
      await sendEmail(admin, {
        to: adminEmails,
        subject: 'New Marketswave application: ' + clientRow.name,
        html,
        text,
        relatedEntityType: 'client_application',
        relatedEntityId: clientId
      });
    }

    return jsonResponse({ sent: true }, 200);
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
