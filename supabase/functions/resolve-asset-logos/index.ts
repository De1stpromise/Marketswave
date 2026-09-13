// ★ Asset logos (2026-09-13) — admin-only. The server-side home for every Brandfetch call
// (see _shared/asset-logos.ts for why the key can never be used from the browser).
//
// Actions:
//   { action: 'backfill', force?: boolean, limit?: number }
//     Resolves and stores a logo for every market-priced product (products.ticker) and every
//     cached symbol (market_data_cache) that has none yet — the one-time catch-up for rows
//     that predate this feature; add-product / add-watchlist-symbol resolve new ones at
//     creation. RESUMABLE: at most `limit` (default 12) symbols per call, and the response
//     carries `remaining` — call again until it is 0. Sized so one call stays well inside a
//     function's wall clock with CoinGecko's pacing (a coin every 5s). A CoinGecko rate limit
//     reports `rate-limited` and leaves the row for the next call, never an Elbstream
//     fallback. `force` re-resolves rows that already carry a STORED logo (a PM-typed
//     absolute URL is never overwritten). `symbols: ['DOT','LINK']` restricts the run to those.
//   { action: 'probe', symbols?: [{symbol, kind}] }  (Brandfetch — kept as the record of
//     the coverage investigation; the resolve path above does not use Brandfetch at all)
//     READ-ONLY. Reports which credential kind BRANDFETCH_API_KEY is (≤2 requests), and —
//     only when it is the free Logo API client ID — the real per-symbol coverage of the
//     given list (one HEAD each, zero Brand API quota). With a Brand API key it stops after
//     detection and says so, because a 29-symbol probe would spend 29 of that key's 100
//     lifetime requests; pass { confirmSpend: true } to do it anyway.
//
// AUTHORIZATION: admin-only via getClaims(jwt) — never getUser() — the same pattern as every
// other admin-only function in this project.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { brandfetchKey, detectCredential, probeLogoApiCoverage, resolveAndStoreLogo, diagnoseLogo, ProviderRateLimited } from '../_shared/asset-logos.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(jwt);
    if (claimsError || !claimsData) return jsonResponse({ error: 'You must be signed in to perform this action.' }, 401);
    if (claimsData.claims.app_metadata?.is_admin !== true) {
      return jsonResponse({ error: 'This action requires Portfolio Manager access.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body && body.action;

    if (action === 'backfill') {
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const admin = createClient(supabaseUrl, serviceRoleKey);
      const force = body.force === true;
      const isStored = (u: unknown) => typeof u === 'string' && u.indexOf('/storage/v1/object/public/asset-logos/') === 0;

      // One resolution per DISTINCT symbol, written to every row that carries it (a product
      // and the cache row for the same ticker share one image) — half the provider calls,
      // and the crypto pacing below then fits comfortably inside a function's wall clock.
      const { data: products, error: pErr } = await admin.from('products').select('id, ticker, price_source, provider_id, logo_url').not('ticker', 'is', null);
      if (pErr) return jsonResponse({ error: pErr.message }, 500);
      const { data: cached, error: cErr } = await admin.from('market_data_cache').select('symbol, asset_type, provider_id, logo_url');
      if (cErr) return jsonResponse({ error: cErr.message }, 500);

      type Target = { kind: 'ticker' | 'crypto'; coingeckoId: string | null; products: Array<Record<string, unknown>>; cache: Array<Record<string, unknown>> };
      const targets: Record<string, Target> = {};
      const target = (symbol: string, kind: 'ticker' | 'crypto', coingeckoId: string | null) => {
        const key = symbol.toUpperCase();
        if (!targets[key]) targets[key] = { kind, coingeckoId, products: [], cache: [] };
        if (!targets[key].coingeckoId && coingeckoId) targets[key].coingeckoId = coingeckoId;
        return targets[key];
      };
      for (const p of products || []) target(p.ticker, p.price_source === 'coingecko' ? 'crypto' : 'ticker', p.price_source === 'coingecko' ? p.provider_id : null).products.push(p);
      for (const c of cached || []) target(c.symbol, c.asset_type === 'crypto' ? 'crypto' : 'ticker', c.asset_type === 'crypto' ? c.provider_id : null).cache.push(c);

      const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : 12;
      const report: Array<Record<string, unknown>> = [];
      let processed = 0;
      let remaining = 0;
      const only = Array.isArray(body.symbols) ? body.symbols.map((x: unknown) => String(x).toUpperCase()) : null;
      for (const symbol of Object.keys(targets).sort()) {
        if (only && only.indexOf(symbol) === -1) continue;
        const t = targets[symbol];
        // Rows that need a value: none yet, or (force) a stored one to re-resolve. A PM-typed
        // absolute logo_url on a product is never overwritten.
        const needProducts = t.products.filter((p) => !p.logo_url || (force && isStored(p.logo_url)));
        const needCache = t.cache.filter((c) => !c.logo_url || force);
        if (needProducts.length === 0 && needCache.length === 0) { report.push({ symbol, outcome: 'kept' }); continue; }
        if (processed >= limit) { remaining++; continue; }
        processed++;
        try {
          const path = await resolveAndStoreLogo(admin, { kind: t.kind, symbol, coingeckoId: t.coingeckoId });
          if (path) {
            for (const p of needProducts) await admin.from('products').update({ logo_url: path }).eq('id', p.id);
            for (const c of needCache) await admin.from('market_data_cache').update({ logo_url: path }).eq('symbol', c.symbol);
          }
          report.push({ symbol, kind: t.kind, outcome: path ? 'resolved' : 'monogram', logoUrl: path, products: needProducts.map((p) => p.id), cacheRows: needCache.length });
        } catch (e) {
          if (e instanceof ProviderRateLimited) { report.push({ symbol, kind: t.kind, outcome: 'rate-limited' }); remaining++; }
          else report.push({ symbol, kind: t.kind, outcome: 'error', error: (e as Error).message });
        }
        // CoinGecko's public tier rate-limits a burst of coin lookups (the catalog seed script
        // measured ~6 picks in 9s tripping it); pace them so the crypto marks genuinely come
        // from CoinGecko rather than silently falling through to Elbstream.
        if (t.kind === 'crypto') await new Promise((r) => setTimeout(r, 5000));
      }
      return jsonResponse({ symbols: report, processed, remaining });
    }

    if (action === 'diagnose') {
      // { action: 'diagnose', kind, symbol, coingeckoId? } — every step of one resolution, no write.
      return jsonResponse({ steps: await diagnoseLogo({ kind: body.kind === 'crypto' ? 'crypto' : 'ticker', symbol: String(body.symbol || ''), coingeckoId: body.coingeckoId || null }) });
    }

    if (action === 'probe') {
      const credential = await detectCredential();
      const items = Array.isArray(body.symbols) ? body.symbols : [];
      if (credential.kind !== 'logo-api-client-id') {
        return jsonResponse({
          credential,
          coverage: null,
          note: credential.kind === 'brand-api-key'
            ? 'Brand API key detected — coverage probe skipped to avoid spending lifetime quota. Pass confirmSpend: true to run it via the Brand API.'
            : 'No usable Brandfetch credential — nothing probed.'
        });
      }
      const coverage = await probeLogoApiCoverage(brandfetchKey()!, items);
      return jsonResponse({ credential, coverage, note: 'Logo API — free, no quota spent.' });
    }

    return jsonResponse({ error: 'Unknown action.' }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message || 'Unexpected error.' }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
