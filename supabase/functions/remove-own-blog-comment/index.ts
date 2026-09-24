// remove-own-blog-comment (2026-09-24) — a client retracts their own comment or reply.
//
// ★ THIS IS A SEPARATE FUNCTION FROM moderate-blog-comment ON PURPOSE. That one opens with
// `app_metadata.is_admin !== true → 403`; this one's whole authorization story is the opposite —
// the caller must NOT be an admin acting on someone else's words, they must be the author. Two
// gates that reject each other's callers do not belong behind one `action` switch, where a
// later edit to the shared preamble would quietly widen both. Same reasoning the project already
// uses for `request-*` (self-only) beside `approve-*` (admin-only).
//
// ★ OWNERSHIP IS THE GATE, NOT ACCOUNT STATUS — a deliberate divergence from posting, and the
// reason is directional. Writing adds words to a public page, so it requires an ACTIVE client
// (requireActiveClient). Removing takes the author's own words back off it, which can never harm
// the platform or another reader. Gating removal on `active` would mean a client whose status
// later changed could no longer retract something they had already said — the platform holding a
// person's words up in public after they asked for them down. So the test here is only: are you
// signed in, and is this yours.
//
// ★ REMOVAL IS A TIMESTAMP, NOT A DELETE, exactly as it is for the PM. The row is kept, so the
// PM's Removed filter still shows the original words and who took them down; blog_comments_public
// decides what a reader sees — placeholder if it has replies, gone if it does not. The rule lives
// in the view, so both removal paths get it for free and cannot drift apart.
//
// `removed_by` is set to the author's own id here, which is what lets the PM tool tell a client's
// retraction from a moderator's removal without a second column.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }
    // An anonymous visitor (the chat widget's own sign-in) carries a real JWT but authored nothing.
    if (claimsData.claims.is_anonymous === true) {
      return jsonResponse({ error: 'Sign in to your Marketswave account to manage your comments.' }, 403);
    }
    const callerId = claimsData.claims.sub as string;
    const callerEmail = (claimsData.claims.email as string) || null;

    const body = await req.json();
    const commentId = typeof body.commentId === 'string' ? body.commentId : '';
    if (!commentId) return jsonResponse({ error: 'commentId is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: target } = await admin
      .from('blog_comments')
      .select('id, client_id, is_marketswave, removed_at')
      .eq('id', commentId)
      .maybeSingle();
    if (!target) return jsonResponse({ error: 'That comment could not be found.' }, 404);

    // ★ THE ONE CHECK THIS FUNCTION EXISTS FOR. A Marketswave reply has a null client_id, so the
    // equality below already refuses it — but it is tested first and answered in its own words,
    // because "you can only remove your own comment" reads as a mistake when the thing you tried
    // to remove was written by the firm.
    if (target.is_marketswave) {
      return jsonResponse({ error: 'That reply was written by Marketswave. Only Marketswave can remove it.' }, 403);
    }
    if (target.client_id !== callerId) {
      return jsonResponse({ error: 'You can only remove your own comment.' }, 403);
    }
    if (target.removed_at) {
      return jsonResponse({ error: 'That comment has already been removed.' }, 409);
    }

    const { data, error } = await admin.from('blog_comments').update({
      removed_at: new Date().toISOString(),
      removed_by: callerId,
      removed_by_email: callerEmail,
    }).eq('id', commentId).select('id, removed_at').single();
    if (error) return jsonResponse({ error: error.message }, 400);

    // Whether the reader sees a placeholder or nothing at all — the same figure the PM's card
    // reports, computed the same way, so the two surfaces cannot describe one removal differently.
    const { count } = await admin
      .from('blog_comments').select('id', { count: 'exact', head: true })
      .eq('parent_id', commentId).is('removed_at', null);

    return jsonResponse({ id: data.id, removed: true, keptAsPlaceholder: (count || 0) > 0 }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
