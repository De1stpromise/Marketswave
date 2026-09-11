// ★ Product catalog — fund documents, part 2 of 2 (2026-09-12).
//
// The ONLY way a client ever reads a fund document. Any signed-in caller.
//
//   {}                              → { published: [{ productId, publishedAt }] }
//                                     which products carry a published document (the card
//                                     link on asset-collection.html). Never the content.
//   { productId }                   → the PUBLISHED document, composed for rendering:
//                                       product   — the hero figures, read from the PRODUCT
//                                                   row at request time (unit price, as-of /
//                                                   last valued, minimum) so they cannot
//                                                   drift from reality
//                                       sections  — published_content.sections, verbatim
//                                       valuation — the series the Valuation history chart
//                                                   is built from (see below)
//                                       attachment— name/size/type + a signed download URL,
//                                                   created here with the service role, only
//                                                   because the document is published
//                                     404 when nothing is published — a draft is never
//                                     returned to a client, even one who guesses the id.
//   { productId, draft: true }      → ADMIN ONLY: the working copy + the same product /
//                                     valuation composition, for the authoring page and its
//                                     preview (which renders the draft through the exact
//                                     renderer a client will get).
//
// VALUATION HISTORY, decided and reported (brief item 6): the series comes from
// nav_publications — a real, dated appraisal each. A market-priced product has no such
// series: market_data_cache holds ONE value per symbol and unitPriceSeries() is honestly
// flat for market products (row 199). Charting that would fabricate a history, so for a
// market-priced product `valuation.points` is EMPTY and the renderer OMITS the section
// entirely — no empty chart, no placeholder. The payload shape is deliberately the same for
// every model: the day a stored price series exists, this function fills `points` from it
// (source: 'market') and the section appears with zero renderer changes.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { toDocumentClientShape } from '../_shared/fund-document.ts';

const BUCKET = 'fund-documents';
const SIGNED_URL_SECONDS = 10 * 60;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) {
      return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    }
    const isAdmin = claimsData.claims.app_metadata?.is_admin === true;

    const body = await req.json().catch(() => ({}));
    const productId = body && typeof body.productId === 'string' ? body.productId : '';
    const wantDraft = !!(body && body.draft);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (!productId) {
      const { data: rows, error } = await admin.from('product_documents')
        .select('product_id, published_at').eq('status', 'published');
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ published: (rows || []).map((r) => ({ productId: r.product_id, publishedAt: r.published_at })) }, 200);
    }

    if (wantDraft && !isAdmin) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const { data: product, error: productErr } = await admin.from('products').select('*').eq('id', productId).maybeSingle();
    if (productErr) return jsonResponse({ error: productErr.message }, 500);
    if (!product) return jsonResponse({ error: 'Unknown product: ' + productId + '.' }, 404);

    const { data: doc, error: docErr } = await admin.from('product_documents').select('*').eq('product_id', productId).maybeSingle();
    if (docErr) return jsonResponse({ error: docErr.message }, 500);

    // The series — real published NAVs only. See the header for why a market product's is empty.
    let points: { date: string; price: number }[] = [];
    let source: 'nav' | 'none' = 'none';
    if (product.pricing_model === 'appraisal') {
      const { data: navs, error: navErr } = await admin.from('nav_publications')
        .select('effective_date, published_unit_price, published_at')
        .eq('product_id', productId)
        .order('effective_date', { ascending: true }).order('published_at', { ascending: true });
      if (navErr) return jsonResponse({ error: navErr.message }, 500);
      points = (navs || []).map((n) => ({ date: n.effective_date, price: Number(n.published_unit_price) }));
      source = 'nav';
    }
    const valuation = {
      source,
      points,
      count: points.length,
      from: points.length ? points[0].date : null,
      to: points.length ? points[points.length - 1].date : null
    };

    const productShape = {
      id: product.id,
      name: product.name,
      assetClass: product.asset_class,
      investmentType: product.investment_type,
      pricingModel: product.pricing_model,
      ticker: product.ticker,
      unitPrice: Number(product.unit_price),
      priceAsOf: product.price_as_of,
      lastTickDate: product.last_tick_date,
      minimumInvestment: Number(product.minimum_investment),
      maximumInvestment: product.maximum_investment == null ? null : Number(product.maximum_investment)
    };

    if (wantDraft) {
      return jsonResponse({
        product: productShape,
        document: doc ? toDocumentClientShape(doc) : null,
        valuation
      }, 200);
    }

    if (!doc || doc.status !== 'published' || !doc.published_content) {
      return jsonResponse({ error: 'No published document for this product.' }, 404);
    }

    // The attachment's download URL — created with the service role, only reachable through
    // this branch, i.e. only for a PUBLISHED document's own attachment.
    const sections = (doc.published_content.sections || []) as Array<Record<string, unknown>>;
    const docsSection = sections.find((s) => s.key === 'documents');
    const att = docsSection && (docsSection.attachment as Record<string, unknown> | null);
    let attachment: Record<string, unknown> | null = null;
    if (att && typeof att.path === 'string') {
      const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(att.path, SIGNED_URL_SECONDS);
      // `signedPath` is the URL with the origin removed. The function's own SUPABASE_URL is
      // the INTERNAL address on the local stack (http://kong:8000, unreachable from a
      // browser) and the public one on real cloud staging; the page prepends the project
      // URL it is itself configured with, which is right in both environments.
      const full = signErr || !signed ? null : signed.signedUrl;
      attachment = {
        name: att.name, size: att.size, contentType: att.contentType,
        url: full,
        signedPath: full ? full.replace(/^https?:\/\/[^/]+/, '') : null
      };
    }

    return jsonResponse({
      product: productShape,
      document: { publishedAt: doc.published_at, sections },
      valuation,
      attachment
    }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
