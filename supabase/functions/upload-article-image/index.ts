// upload-article-image (2026-09-24) — ONE image upload, shared by the blog and the Help Center.
//
// ★ BUILT ONCE ON PURPOSE. The `image` block already lives in _shared/article-blocks.ts with its
// own validation and its own accessibility rule (every image carries a screen-reader
// description), and the Help Center's image upload was deferred rather than designed away. A
// second implementation would mean two buckets, two policy sets and two alt-text rules for one
// block type that is already shared — so this serves blog covers AND Help Center image blocks,
// and closes the Help Center's deferred item in the same stroke.
//
// ★ PUBLIC-READ BUCKET, FOLLOWING asset-logos. A blog cover must be readable by an anonymous
// visitor, so a private bucket with signed URLs is the wrong shape here: it would mean a signed
// URL per card per page load, expiring behind anyone who left the tab open. Writes are
// admin-only and go through this function; there is no client-side INSERT policy at all.
//
// ★ NO REAL CLIENT DATA IN AN IMAGE. The editor says so beside the upload control. Nothing here
// can enforce what a PNG contains — what this can do is keep the surface small: admin-only,
// one bucket, one size limit, and a content type that must genuinely be an image.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BUCKET = 'article-images';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

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

    const body = await req.json();
    const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
    // 'blog' or 'help' — a folder, so the two consumers' images are separable later without
    // either needing to know about the other.
    const scope = body.scope === 'help' ? 'help' : 'blog';

    if (!filename) return jsonResponse({ error: 'Choose a file to upload.' }, 400);
    if (ALLOWED.indexOf(contentType) === -1) {
      return jsonResponse({ error: 'Images must be PNG, JPG or WebP.' }, 400);
    }
    if (!fileBase64) return jsonResponse({ error: 'The file did not arrive. Try choosing it again.' }, 400);

    let bytes: Uint8Array;
    try {
      const bin = atob(fileBase64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (_) {
      return jsonResponse({ error: 'The file could not be read.' }, 400);
    }
    if (bytes.length === 0) return jsonResponse({ error: 'That file is empty.' }, 400);
    if (bytes.length > MAX_BYTES) {
      return jsonResponse({ error: 'Images can be up to 5 MB. That one is ' + (bytes.length / 1048576).toFixed(1) + ' MB.' }, 400);
    }

    const safe = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'image';
    const path = scope + '/' + crypto.randomUUID() + '/' + safe;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
    if (upErr) return jsonResponse({ error: 'Could not store the image: ' + upErr.message }, 502);

    // The bucket is public, so the path IS the address. Returned as a path rather than a full
    // URL for the reason row 200 recorded: this function's own SUPABASE_URL is the stack's
    // INTERNAL address locally and the public one on staging, so a URL built here would be
    // unreachable from a browser in local development. The page prepends its own project URL.
    return jsonResponse({
      path,
      publicPath: '/storage/v1/object/public/' + BUCKET + '/' + path,
      bytes: bytes.length,
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
