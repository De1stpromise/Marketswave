// post-blog-comment (2026-09-24) — a client writes a comment, or a reply to one.
//
// ★ ONLY A SIGNED-IN CLIENT WHOSE ACCOUNT IS ACTIVE MAY WRITE, and that is enforced HERE, not
// by hiding the box. requireActiveClient() refuses an anonymous caller, a pending-review
// application and a rejected one, each with its own words.
//
// ★ THE COMMENT GOES LIVE IMMEDIATELY. There is no approval queue: it is published the moment
// it is written, under the client's full name, and the compose box says so before they press
// the button. A flag (see _shared/blog.ts) raises a money-shaped comment to the PM but never
// holds it back and never hides it.
//
// ★ THE DISPLAY NAME IS READ FROM THE ACCOUNT, NEVER FROM THE REQUEST. A caller cannot choose
// the name their comment appears under - the same reason request-profile-change snapshots the
// current value server-side rather than trusting what was sent.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { BODY_MAX, RATE_MAX, RATE_WINDOW_MINUTES, flagComment, requireActiveClient, commentsInWindow } from '../_shared/blog.ts';

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
    if (claimsError || !claimsData) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const gate = await requireActiveClient(admin, claimsData.claims);
    if (!gate.ok) return jsonResponse({ error: gate.error }, gate.status);

    const body = await req.json();
    const postId = body && typeof body.postId === 'string' ? body.postId : '';
    const parentId = body && typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
    const text = body && typeof body.body === 'string' ? body.body.trim() : '';

    if (!postId) return jsonResponse({ error: 'postId is required.' }, 400);
    if (!text) return jsonResponse({ error: 'Write something before posting.' }, 400);
    if (text.length > BODY_MAX) {
      return jsonResponse({ error: 'A comment can be up to ' + BODY_MAX + ' characters. Yours is ' + text.length + '.' }, 400);
    }

    // The post must exist, be PUBLISHED, and have comments switched on. A draft has no public
    // page, so a comment on one could never be read — refusing is clearer than storing it.
    const { data: post } = await admin
      .from('blog_posts').select('id, published_at, pub_allow_comments, pub_title').eq('id', postId).maybeSingle();
    if (!post || !post.published_at) return jsonResponse({ error: 'That post could not be found.' }, 404);
    if (!post.pub_allow_comments) return jsonResponse({ error: 'Comments are closed on this post.' }, 409);

    // One level deep is enforced by a trigger too; this is the friendly version of the message.
    if (parentId) {
      const { data: parent } = await admin
        .from('blog_comments').select('id, post_id, parent_id, client_id, removed_at').eq('id', parentId).maybeSingle();
      if (!parent || parent.post_id !== postId) return jsonResponse({ error: 'That comment could not be found.' }, 404);
      if (parent.parent_id) return jsonResponse({ error: 'Replies attach to the original comment, not to another reply.' }, 400);
      if (parent.removed_at) return jsonResponse({ error: 'That comment has been removed.' }, 409);
    }

    const used = await commentsInWindow(admin, gate.clientId);
    if (used >= RATE_MAX) {
      return jsonResponse({
        error: 'You have posted ' + RATE_MAX + ' times in the last ' + RATE_WINDOW_MINUTES +
               ' minutes. Give it a few minutes and try again.',
      }, 429);
    }

    const flag = flagComment(text);

    const { data: row, error } = await admin.from('blog_comments').insert({
      post_id: postId,
      parent_id: parentId,
      client_id: gate.clientId,
      display_name: gate.name,
      is_marketswave: false,
      body: text,
      flagged: flag.flagged,
      flag_reason: flag.reason,
    }).select('id, post_id, parent_id, display_name, body, created_at, is_marketswave, flagged').single();
    if (error) return jsonResponse({ error: error.message }, 400);

    // ★ THE BELL, NOT AN EMAIL (requirement 12) — and NO notification table.
    // dashboard-notifications.js has always built its items from source rows with per-item read
    // state held locally; a blog reply is one more source, not a new mechanism. The client reads
    // their OWN comments (blog_comments_own_read) to learn their ids, then reads the replies to
    // them from blog_comments_public. Nothing needs writing here for the bell to work, which is
    // why this function writes nothing: a notification row would be a second copy of a fact the
    // comment itself already carries.

    return jsonResponse(row, 200);
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
