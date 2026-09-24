// publish-blog-post (2026-09-24) — copy the draft across, and only then let readers see it.
// Also handles unpublishing, via { unpublish: true }.
//
// ★ THE CHECKLIST IS RE-DERIVED HERE, SERVER-SIDE. The editor disables Publish from the same
// publishChecklist() in the shared module, so a disabled button and a 400 cannot disagree —
// including the rule that a post needs a cover image and that every image carries a
// screen-reader description. Forcing the button back on from dev tools gets a refusal, not a
// published post.
//
// ★ ONE FEATURED POST AT A TIME. A partial unique index on pub_featured makes that structural;
// this function clears any other featured post FIRST so the PM meets a replaced feature rather
// than a constraint error. The index is what guarantees it; this is what makes it pleasant.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { publishBlocker, readingMinutes } from '../_shared/article-blocks.ts';

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
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return jsonResponse({ error: 'id is required.' }, 400);

    const { data: row } = await admin.from('blog_posts').select('*').eq('id', id).maybeSingle();
    if (!row) return jsonResponse({ error: 'That post could not be found.' }, 404);

    // ---- UNPUBLISH: clear published_at and the published copy; the draft is untouched -------
    if (body.unpublish === true) {
      const { data, error } = await admin.from('blog_posts').update({
        published_at: null, pub_featured: false, draft_dirty: true,
        updated_by: adminId, updated_by_email: adminEmail, updated_at: new Date().toISOString(),
      }).eq('id', id).select().single();
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ id: data.id, slug: data.slug, publishedAt: null }, 200);
    }

    // ---- PUBLISH ----------------------------------------------------------------------------
    const blocker = publishBlocker({
      kind: 'post',
      title: row.title, category: row.category, byline: row.byline, slug: row.slug,
      lede: row.lede, blocks: row.blocks, cover_path: row.cover_path, cover_alt: row.cover_alt,
    });
    if (blocker) return jsonResponse({ error: blocker }, 400);

    if (row.featured) {
      await admin.from('blog_posts').update({ pub_featured: false }).neq('id', id).eq('pub_featured', true);
    }

    const now = new Date().toISOString();
    const { data, error } = await admin.from('blog_posts').update({
      pub_category: row.category,
      pub_title: row.title,
      pub_question: row.question,
      pub_lede: row.lede,
      pub_blocks: row.blocks,
      pub_byline: row.byline,
      pub_cover_path: row.cover_path,
      pub_cover_alt: row.cover_alt,
      pub_featured: row.featured,
      pub_allow_comments: row.allow_comments,
      pub_allow_likes: row.allow_likes,
      pub_reading_minutes: readingMinutes(row.lede || '', row.blocks),
      published_at: now,
      first_published_at: row.first_published_at || now,
      draft_dirty: false,
      published_by: adminId, published_by_email: adminEmail,
      updated_by: adminId, updated_by_email: adminEmail, updated_at: now,
    }).eq('id', id).select().single();
    if (error) return jsonResponse({ error: error.message }, 400);

    return jsonResponse({
      id: data.id, slug: data.slug, publishedAt: data.published_at,
      featured: data.pub_featured, readingMinutes: data.pub_reading_minutes,
    }, 200);
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
