// save-blog-post (2026-09-24) — create or update a post's DRAFT side only.
//
// ★ THIS FUNCTION CAN NEVER CHANGE WHAT A READER SEES. It writes the draft columns and nothing
// else; the pub_ columns and published_at are touched only by publish-blog-post. That is the
// same separation save-help-article already has, and it is what lets a PM keep editing a live
// post without the edits reaching the blog until they press Publish.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { validateBlocks, readingMinutes, publishChecklist, MAX_TITLE, MAX_LEDE } from '../_shared/article-blocks.ts';
import { CATEGORIES, DEFAULT_BYLINE, slugify } from '../_shared/blog.ts';

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
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

    const id = str(body.id) || null;
    const title = str(body.title);
    let slug = str(body.slug) || slugify(title);
    const category = str(body.category) || null;
    const byline = str(body.byline) || DEFAULT_BYLINE;
    const lede = str(body.lede);
    const question = str(body.question) || null;
    const coverPath = str(body.cover_path) || null;
    const coverAlt = str(body.cover_alt) || null;
    const blocks = body.blocks === undefined ? [] : body.blocks;

    if (title.length > MAX_TITLE) return jsonResponse({ error: 'The title can be up to ' + MAX_TITLE + ' characters.' }, 400);
    if (lede.length > MAX_LEDE) return jsonResponse({ error: 'The summary can be up to ' + MAX_LEDE + ' characters.' }, 400);
    if (category && CATEGORIES.indexOf(category as any) === -1) {
      return jsonResponse({ error: 'category must be one of: ' + CATEGORIES.join(', ') + '.' }, 400);
    }
    if (!slug) slug = 'post-' + Date.now();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return jsonResponse({ error: 'The web address may use lower-case letters, numbers and hyphens only.' }, 400);
    }
    const blockErr = validateBlocks(blocks, 'body');
    if (blockErr) return jsonResponse({ error: blockErr }, 400);

    // A cover image must describe itself, for the same reason a body image must: it is the one
    // image every reader meets. Enforced at publish by the checklist; refused here too when a
    // path is given without one, so the pair can never drift apart in storage.
    if (coverPath && !coverAlt) {
      return jsonResponse({ error: 'A cover image needs a description for screen readers.' }, 400);
    }

    const draft = {
      slug, title: title || null, category, byline, lede: lede || null, question,
      cover_path: coverPath, cover_alt: coverAlt,
      blocks,
      featured: body.featured === true,
      allow_comments: body.allow_comments !== false,
      allow_likes: body.allow_likes !== false,
      draft_dirty: true,
      updated_by: adminId, updated_by_email: adminEmail,
      updated_at: new Date().toISOString(),
    };

    if (id) {
      const { data, error } = await admin.from('blog_posts').update(draft).eq('id', id).select().maybeSingle();
      if (error) return jsonResponse({ error: friendly(error) }, 400);
      if (!data) return jsonResponse({ error: 'That post could not be found.' }, 404);
      return jsonResponse(shape(data), 200);
    }
    const { data, error } = await admin.from('blog_posts').insert(draft).select().single();
    if (error) return jsonResponse({ error: friendly(error) }, 400);
    return jsonResponse(shape(data), 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function friendly(error: any): string {
  if (error && error.code === '23505' && String(error.message || '').includes('slug')) {
    return 'Another post already uses that web address. Change it and save again.';
  }
  return error && error.message ? error.message : 'Could not save the post.';
}

// ★ THE CHECKLIST COMES BACK FROM THE SERVER, exactly as save-help-article returns it.
// That is what makes "a disabled button and a 400 cannot disagree" true: the editor greys out
// Publish from THIS list, and publish-blog-post re-derives the same list from the same module.
// If the editor computed its own copy in the browser, the two could drift apart silently —
// which is the whole failure this shared module exists to prevent.
function shape(row: any) {
  return {
    id: row.id, slug: row.slug, title: row.title, category: row.category, byline: row.byline,
    lede: row.lede, question: row.question, blocks: row.blocks,
    coverPath: row.cover_path, coverAlt: row.cover_alt,
    featured: row.featured, allowComments: row.allow_comments, allowLikes: row.allow_likes,
    publishedAt: row.published_at, draftDirty: row.draft_dirty,
    readingMinutes: readingMinutes(row.lede || '', row.blocks),
    updatedAt: row.updated_at,
    checklist: publishChecklist({
      kind: 'post',
      title: row.title, category: row.category, byline: row.byline, slug: row.slug,
      lede: row.lede, blocks: row.blocks, cover_path: row.cover_path, cover_alt: row.cover_alt,
    }),
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
