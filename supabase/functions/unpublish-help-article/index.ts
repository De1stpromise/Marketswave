// unpublish-help-article (2026-09-23) — take an article off the public site, keep everything.
//
// Only `published_at` is cleared. The pub_ columns are deliberately LEFT IN PLACE: the public
// view filters on `published_at is not null`, so nulling it is enough to remove the article from
// every public surface immediately, and keeping the published copy means re-publishing restores
// exactly what clients saw before rather than whatever the draft has drifted to since. That is
// what the editor's own note promises — "takes it off the site immediately but keeps everything
// here" — and it is also why this is not a delete.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { publishChecklist } from '../_shared/article-blocks.ts';

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

    const body = await req.json().catch(() => null);
    const id = body && typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return json({ error: 'An article id is required.' }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: row, error } = await admin
      .from('help_articles')
      .update({ published_at: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: 'That article no longer exists.' }, 404);

    return json({ article: row, checklist: publishChecklist(row) }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
