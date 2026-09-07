// Branded HTML Emails (2026-09-07).
//
// New client-side security trigger: "Password changed." settings.html's real self-service
// password-change flow (a real client.auth.signInWithPassword() re-check followed by a real
// client.auth.updateUser({password}) call — see settings.html's own real handler, read in
// full before writing this) is 100% client-side, calling the Supabase Auth SDK directly with
// no Edge Function in the loop at all — the identical architectural gap this task's other two
// notify-* functions found for signup/document-upload. Called by settings.html immediately
// AFTER its own real updateUser() call resolves successfully.
//
// CLIENT-CALLABLE, SELF ONLY — clientId/email derived from the caller's own verified JWT
// (getClaims(jwt).sub/.email), never trusted from the request body — there is nothing in the
// request body at all, by design, since this function has no legitimate reason to accept any
// caller-supplied data.
//
// SECURITY NOTE: no state mutation — the real password change already happened via the
// client's own direct Supabase Auth call before this is ever reached. Worst case of misuse
// (calling this without actually changing a password) is one misleading "your password was
// changed" email to the real account holder themselves, not a third party — the JWT already
// proves the caller IS that account.
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
    const clientId = claimsData.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: clientRow, error: fetchErr } = await admin.from('clients').select('name, email').eq('id', clientId).maybeSingle();
    if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);
    if (!clientRow) return jsonResponse({ error: 'No client record found for this account.' }, 404);

    const changedAt = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    const { html, text } = renderEmail({
      heading: 'Your password was changed',
      introParagraphs: ['Hi ' + clientRow.name + ', the password for your Marketswave account was changed on ' + changedAt + '. If this wasn\'t you, please contact us immediately.'],
      cta: { text: 'Go to your account', href: siteLink('dashboard.html') },
      footerType: 'general'
    });
    await sendEmail(admin, {
      to: clientRow.email,
      subject: 'Your Marketswave password was changed',
      html,
      text,
      relatedEntityType: 'client',
      relatedEntityId: clientId
    });

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
