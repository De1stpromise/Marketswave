// toggle-blog-like (2026-09-24) — a client likes a post, or takes the like back.
//
// ★ ONE LIKE PER CLIENT PER POST IS THE PRIMARY KEY, not a check in this function. (post_id,
// client_id) is the table's own key, so a second like is refused by the database even if this
// code were bypassed entirely. What the function adds is the ACTIVE-account gate and a friendly
// answer; the uniqueness is structural.
//
// Unliking is deliberately allowed: a like is an opinion, and an opinion a reader cannot
// withdraw is a trap rather than a feature.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireActiveClient } from '../_shared/blog.ts';

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
    const wantLiked = body && body.liked === true;
    if (!postId) return jsonResponse({ error: 'postId is required.' }, 400);

    const { data: post } = await admin
      .from('blog_posts').select('id, published_at, pub_allow_likes').eq('id', postId).maybeSingle();
    if (!post || !post.published_at) return jsonResponse({ error: 'That post could not be found.' }, 404);
    if (!post.pub_allow_likes) return jsonResponse({ error: 'Likes are switched off on this post.' }, 409);

    if (wantLiked) {
      const { error } = await admin.from('blog_likes').insert({ post_id: postId, client_id: gate.clientId });
      // 23505 is the primary key doing its job: the client already liked this post. Saying so is
      // the honest answer, and the state the caller asked for is already true.
      if (error && error.code !== '23505') return jsonResponse({ error: error.message }, 400);
      if (error) return jsonResponse({ error: 'You have already liked this post.', liked: true }, 409);
    } else {
      const { error } = await admin.from('blog_likes').delete().eq('post_id', postId).eq('client_id', gate.clientId);
      if (error) return jsonResponse({ error: error.message }, 400);
    }

    const { count } = await admin
      .from('blog_likes').select('client_id', { count: 'exact', head: true }).eq('post_id', postId);

    return jsonResponse({ postId, liked: wantLiked, likes: count || 0 }, 200);
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
