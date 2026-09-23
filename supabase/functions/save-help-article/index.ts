// save-help-article (2026-09-23) — create or update an article's DRAFT side only.
//
// ★ THIS FUNCTION CAN NEVER CHANGE WHAT A CLIENT SEES. It writes the draft columns and nothing
// else; the pub_ columns and published_at are touched only by publish-help-article. That is the
// guarantee behind "Unpublished edits": a manager can edit a live article all day and the public
// view keeps serving the last published copy. `draft_dirty` is set here and cleared on publish,
// so "has unpublished edits" is an exact fact rather than a deep comparison of two jsonb blobs.
//
// AUTHORIZATION: admin-only, via getClaims(jwt) — never getUser(), which reads the live
// auth.users row rather than the token's own hook-injected claims.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  validateBlocks, publishChecklist, slugFromTitle,
  MAX_TITLE, MAX_QUESTION, MAX_LEDE, MAX_RELATED, MAX_MOST_ASKED, MAX_FEATURED_PER_TOPIC,
  PRODUCT_SLOTS, readingMinutes,
} from '../_shared/article-blocks.ts';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'You must be signed in to perform this action.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) return json({ error: 'You must be signed in to perform this action.' }, 401);
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return json({ error: 'This action requires Portfolio Manager access.' }, 403);
    }
    const adminId = claimsData.claims.sub as string;
    const adminEmail = claimsData.claims.email as string;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'A request body is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const id = str(body.id) || null;

    // ---- slug: from the title on a first save, never silently changed afterwards -------------
    let slug = str(body.slug) || slugFromTitle(str(body.title));
    if (!slug) return json({ error: 'A title or a web address is required.' }, 400);
    if (!SLUG_RE.test(slug) || slug.length < 3 || slug.length > 80) {
      return json({ error: 'The web address may use lower-case letters, numbers and hyphens only.' }, 400);
    }

    const title = str(body.title);
    const question = str(body.question);
    const lede = str(body.lede);
    if (title.length > MAX_TITLE) return json({ error: 'Title is at most ' + MAX_TITLE + ' characters.' }, 400);
    if (question.length > MAX_QUESTION) return json({ error: 'The question is at most ' + MAX_QUESTION + ' characters.' }, 400);
    if (lede.length > MAX_LEDE) return json({ error: 'The opening paragraph is at most ' + MAX_LEDE + ' characters.' }, 400);

    const blocks = body.blocks === undefined ? [] : body.blocks;
    const blockErr = validateBlocks(blocks);
    if (blockErr) return json({ error: blockErr }, 400);

    const related = Array.isArray(body.related_slugs) ? body.related_slugs.map((s: unknown) => str(s)).filter(Boolean) : [];
    if (related.length > MAX_RELATED) return json({ error: 'At most ' + MAX_RELATED + ' related articles.' }, 400);
    if (related.indexOf(slug) !== -1) return json({ error: 'An article cannot be related to itself.' }, 400);

    const topicId = str(body.topic_id) || null;
    if (topicId) {
      const { data: topic } = await admin.from('help_topics').select('id').eq('id', topicId).maybeSingle();
      if (!topic) return json({ error: 'That topic does not exist.' }, 400);
    }

    const productSlot = str(body.product_slot) || null;
    if (productSlot && (PRODUCT_SLOTS as readonly string[]).indexOf(productSlot) === -1) {
      return json({ error: 'That in-product placement does not exist.' }, 400);
    }

    const inMostAsked = body.in_most_asked === true;
    const featured = body.featured_on_topic === true;

    // ---- the two placement ceilings the landing depends on ----------------------------------
    // Counted against OTHER articles so re-saving an article that already holds a slot is fine.
    if (inMostAsked) {
      let q = admin.from('help_articles').select('id', { count: 'exact', head: true }).eq('in_most_asked', true);
      if (id) q = q.neq('id', id);
      const { count } = await q;
      if ((count || 0) >= MAX_MOST_ASKED) {
        return json({ error: '"Most asked" already holds ' + MAX_MOST_ASKED + ' articles. Turn one off first.' }, 409);
      }
    }
    if (featured && topicId) {
      let q = admin.from('help_articles').select('id', { count: 'exact', head: true })
        .eq('featured_on_topic', true).eq('topic_id', topicId);
      if (id) q = q.neq('id', id);
      const { count } = await q;
      if ((count || 0) >= MAX_FEATURED_PER_TOPIC) {
        return json({ error: 'That topic card already features ' + MAX_FEATURED_PER_TOPIC + ' articles. Turn one off first.' }, 409);
      }
    }

    const draft = {
      slug, topic_id: topicId, title, question, lede, blocks,
      related_slugs: related, in_most_asked: inMostAsked, featured_on_topic: featured,
      product_slot: productSlot,
      draft_dirty: true,
      updated_by: adminId, updated_by_email: adminEmail,
      updated_at: new Date().toISOString(),
    };

    let row;
    if (id) {
      const { data, error } = await admin.from('help_articles').update(draft).eq('id', id).select().maybeSingle();
      if (error) return json({ error: friendly(error) }, statusFor(error));
      if (!data) return json({ error: 'That article no longer exists.' }, 404);
      row = data;
    } else {
      const { data, error } = await admin.from('help_articles').insert(draft).select().single();
      if (error) return json({ error: friendly(error) }, statusFor(error));
      row = data;
    }

    return json({
      article: row,
      checklist: publishChecklist(row),
      readingMinutes: readingMinutes(row.lede || '', row.blocks),
    }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function statusFor(e: { code?: string }) { return e && e.code === '23505' ? 409 : 500; }
function friendly(e: { code?: string; message: string }) {
  if (e && e.code === '23505') return 'Another article already uses that web address.';
  return e.message;
}
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
