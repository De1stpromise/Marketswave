// =======================================================================================
// get-public-market-snapshot — Homepage design round 2 (2026-09-08).
//
// ★ THIS IS THE FIRST GENUINELY OPEN, UNAUTHENTICATED READ ENDPOINT IN THIS PROJECT.
// Everything else either requires a real JWT (checked in-handler via getClaims) or, in the
// single prior unauthenticated case (receive-inbound-email), verifies a Svix signature.
// That makes this worth stating plainly rather than treating as one more function:
//
//   WHAT IT SERVES  — only rows already sitting in public.market_data_cache, plus the latest
//                     published NAV per product. Public market prices and product-level fund
//                     values. No client data, no account data, no per-user anything.
//   WHAT MAKES IT SAFE — it is READ-ONLY against the cache and NEVER refreshes it. The
//                     authenticated get-market-snapshot is the only thing that ever calls
//                     Finnhub or CoinGecko. So no amount of traffic here can reach, bill, or
//                     rate-limit a third-party API: the blast radius of abuse is this
//                     project's own Supabase quota, not someone else's service.
//   WHY IT EXISTS   — the public homepage ticker cannot call the authenticated function; a
//                     visitor is anonymous by definition, and that function correctly returns
//                     401. Verified directly rather than assumed.
//
// NAV disclosure, flagged rather than slipped in: nav_publications is deliberately admin-only
// at the RLS layer. This function reads it via service_role and exposes ONLY the product name,
// its latest published unit price, and the effective date — no publisher identity, no history,
// no attribution columns. Publishing current fund values is normal practice for a manager, and
// this is product data rather than client data, but it IS a deliberate widening of what was
// previously admin-gated and is recorded as such in CLAUDE.md.
// =======================================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SYMBOL_LABELS: Record<string, string> = {
  // The honest ETF-proxy names the authenticated function already uses. Finnhub's free tier
  // refuses index quotes outright, so this project deliberately never captions these
  // "S&P 500" against an ETF's own price — see get-market-snapshot's header for the detail.
  SPY: 'SPY (S&P 500 ETF)',
  QQQ: 'QQQ (NASDAQ-100 ETF)',
  DIA: 'DIA (Dow Jones ETF)',
  BTC: 'BTC',
  ETH: 'ETH',
  SOL: 'SOL'
};

// ---- Best-effort per-IP rate limit ----------------------------------------------------
// Deliberately honest about what this is: Edge Function instances are ephemeral and there may
// be several, so an in-memory counter is per-instance and cannot be a hard global guarantee.
// It is still worth having — it stops a single client hammering one instance — but the REAL
// protection is architectural: this function never calls a third-party API, so the worst case
// is wasted Supabase reads against an already-cached table, not an external bill.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60; // 60 requests/minute/IP — far above any legitimate homepage use
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > RATE_LIMIT_WINDOW_MS) hits.delete(k);
    }
  }
  return recent.length > RATE_LIMIT_MAX;
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      // The data itself only changes every 15 minutes, so let any CDN or browser in front of
      // this hold it — that is another real layer of protection for an open endpoint.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      ...extra
    }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown';
    if (rateLimited(ip)) {
      return jsonResponse({ error: 'Too many requests. Please try again shortly.' }, 429, {
        'Retry-After': '60'
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ---- 1. cached market prices. READ ONLY — never refreshed from here. ----
    const { data: cachedRows, error: cacheErr } = await admin
      .from('market_data_cache')
      .select('symbol, value, change_percent, source, last_updated');
    if (cacheErr) return jsonResponse({ error: cacheErr.message }, 500);

    const markets = (cachedRows || [])
      .filter((row) => SYMBOL_LABELS[row.symbol as string])
      .map((row) => ({
        symbol: row.symbol,
        label: SYMBOL_LABELS[row.symbol as string],
        value: row.value,
        changePercent: row.change_percent,
        lastUpdated: row.last_updated
      }))
      // Stable, intentional order rather than whatever the table returns.
      .sort(
        (a, b) =>
          Object.keys(SYMBOL_LABELS).indexOf(a.symbol as string) -
          Object.keys(SYMBOL_LABELS).indexOf(b.symbol as string)
      );

    // ---- 2. latest published NAV per product (genuine PM-published data) ----
    const { data: navRows, error: navErr } = await admin
      .from('nav_publications')
      .select('product_id, published_unit_price, effective_date')
      .order('effective_date', { ascending: false })
      .limit(200);
    if (navErr) return jsonResponse({ error: navErr.message }, 500);

    const latestByProduct = new Map<string, { price: number; date: string }>();
    for (const row of navRows || []) {
      const pid = row.product_id as string;
      if (!latestByProduct.has(pid)) {
        latestByProduct.set(pid, {
          price: Number(row.published_unit_price),
          date: row.effective_date as string
        });
      }
    }

    let navs: Array<{ product: string; price: number; asOf: string }> = [];
    if (latestByProduct.size) {
      const { data: products } = await admin
        .from('products')
        .select('id, name')
        .in('id', [...latestByProduct.keys()]);
      navs = (products || []).map((p) => {
        const n = latestByProduct.get(p.id as string)!;
        return { product: p.name as string, price: n.price, asOf: n.date };
      });
    }

    return jsonResponse({ markets, navs, servedAt: new Date().toISOString() }, 200);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
