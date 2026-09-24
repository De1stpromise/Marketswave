// moderate-blog-comment (2026-09-24) — the PM removes a comment, or replies as Marketswave.
//
// ★ REMOVAL IS A TIMESTAMP, NOT A DELETE, and the difference is visible to readers. A removed
// comment that has replies stays as a placeholder — no name, no body, "This comment was
// removed" — so the conversation underneath it still makes sense. One with no replies is gone
// from the public view entirely. That rule lives in blog_comments_public, not here: this
// function only records that removal happened, and the view decides what a reader sees.
//
// The row itself is kept either way, so the PM's Removed filter can still show it. Nothing is
// destroyed.
//
// ★ A MARKETSWAVE REPLY HAS NO CLIENT. It is written by the firm, so client_id and display_name
// are null and is_marketswave is true — the table's own CHECK enforces that shape, and the
// public page renders it distinctly from a client's reply.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { BODY_MAX, flagComment } from '../_shared/blog.ts';

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
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }
    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const action = typeof body.action === 'string' ? body.action : '';
    const commentId = typeof body.commentId === 'string' ? body.commentId : '';
    if (!commentId) return jsonResponse({ error: 'commentId is required.' }, 400);

    const { data: target } = await admin
      .from('blog_comments').select('id, post_id, parent_id, removed_at').eq('id', commentId).maybeSingle();
    if (!target) return jsonResponse({ error: 'That comment could not be found.' }, 404);

    // ---- REMOVE ------------------------------------------------------------------------------
    if (action === 'remove') {
      if (target.removed_at) return jsonResponse({ error: 'That comment has already been removed.' }, 409);
      const { data, error } = await admin.from('blog_comments').update({
        removed_at: new Date().toISOString(), removed_by: adminId, removed_by_email: adminEmail,
      }).eq('id', commentId).select('id, removed_at').single();
      if (error) return jsonResponse({ error: error.message }, 400);

      const { count } = await admin
        .from('blog_comments').select('id', { count: 'exact', head: true })
        .eq('parent_id', commentId).is('removed_at', null);
      return jsonResponse({ id: data.id, removed: true, keptAsPlaceholder: (count || 0) > 0 }, 200);
    }

    // ---- REPLY AS MARKETSWAVE ----------------------------------------------------------------
    if (action === 'reply') {
      const text = typeof body.body === 'string' ? body.body.trim() : '';
      if (!text) return jsonResponse({ error: 'Write a reply before posting it.' }, 400);
      if (text.length > BODY_MAX) {
        return jsonResponse({ error: 'A reply can be up to ' + BODY_MAX + ' characters.' }, 400);
      }
      // A reply attaches to the ORIGINAL comment: replying to a reply answers its parent.
      const parentId = target.parent_id || target.id;
      const flag = flagComment(text);
      const { data, error } = await admin.from('blog_comments').insert({
        post_id: target.post_id,
        parent_id: parentId,
        client_id: null,
        display_name: null,
        is_marketswave: true,
        body: text,
        flagged: flag.flagged,
        flag_reason: flag.reason,
      }).select('id, post_id, parent_id, body, created_at, is_marketswave').single();
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse(data, 200);
    }

    return jsonResponse({ error: 'action must be "remove" or "reply".' }, 400);
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
