// publish-help-article (2026-09-23) — copy the draft side onto the published side.
//
// ★ THE CHECKLIST IS ENFORCED HERE, NOT BY THE DISABLED BUTTON. The editor greys out Publish
// while an item is missing, but a greyed button is a courtesy, not a rule: this function
// re-derives the SAME list from _shared/article-blocks.ts and refuses with 400 naming what is
// missing. One definition of "ready", so the button and the server cannot disagree — including
// the rule that every image carries a screen-reader description, which is the one an editor is
// most likely to skip and the one a blind reader most depends on.
//
// Publishing is the ONLY thing that moves the pub_ columns, which is what makes editing a live
// article safe. It also clears draft_dirty, so "Unpublished edits" is exact.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { publishBlocker, publishChecklist, readingMinutes } from '../_shared/article-blocks.ts';

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
    const id = body && typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return json({ error: 'An article id is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: row, error: readErr } = await admin.from('help_articles').select('*').eq('id', id).maybeSingle();
    if (readErr) return json({ error: readErr.message }, 500);
    if (!row) return json({ error: 'That article no longer exists.' }, 404);

    // ★ The server-side gate. Same list the editor ticks.
    const blocker = publishBlocker(row);
    if (blocker) return json({ error: blocker, checklist: publishChecklist(row) }, 400);

    const now = new Date().toISOString();
    const { data: published, error: pubErr } = await admin
      .from('help_articles')
      .update({
        pub_topic_id: row.topic_id,
        pub_title: row.title,
        pub_question: row.question,
        pub_lede: row.lede,
        pub_blocks: row.blocks,
        pub_related_slugs: row.related_slugs,
        pub_in_most_asked: row.in_most_asked,
        pub_featured_on_topic: row.featured_on_topic,
        pub_product_slot: row.product_slot,
        pub_reading_minutes: readingMinutes(row.lede || '', row.blocks),
        published_at: now,
        first_published_at: row.first_published_at || now,
        draft_dirty: false,
        published_by: adminId,
        published_by_email: adminEmail,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single();
    if (pubErr) return json({ error: pubErr.message }, 500);

    return json({ article: published, checklist: publishChecklist(published) }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
