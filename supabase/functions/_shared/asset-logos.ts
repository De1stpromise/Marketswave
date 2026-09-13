// ★ Asset logos (2026-09-13, row 207). The one place the project talks to a logo provider.
// The Brandfetch probe (below) and the provider CHAIN (the resolve half, further down) both
// live here, so adding or reordering a source is one file.
//
// BRANDFETCH HAS TWO PRODUCTS, AND THEY ARE NOT INTERCHANGEABLE — investigated against the
// real docs before a line of this was written:
//   • The Logo API — https://cdn.brandfetch.io/{domain|ticker|crypto|isin}/{id}?c=CLIENT_ID —
//     serves the image itself, looks up by TICKER directly, takes a public CLIENT ID
//     (designed for browser use), is free to ~1M requests/month and asks no attribution.
//     `/fallback/404` after the identifier turns "no logo" into a real HTTP 404 (cached up
//     to 7 days), which is what makes coverage measurable.
//   • The Brand API — https://api.brandfetch.io/v2/brands/{ticker|crypto}/{id} — returns
//     JSON (logo URLs, colours, company data), takes a SECRET Bearer key, and its free tier
//     is 100 LIFETIME requests before $99/month. Every call spends one.
// BRANDFETCH_API_KEY may be either. detectCredential() works out which with at most two
// requests; nothing here spends Brand API quota without the caller opting in.
//
// The key never reaches the browser: every Brandfetch call happens here, in Deno, and what
// the browser gets is a URL on this project's own storage (see the resolve half) — so a
// dashboard load makes zero Brandfetch requests and zero third-party image requests.

export type CredentialKind = 'logo-api-client-id' | 'brand-api-key' | 'invalid' | 'missing';

const LOGO_CDN = 'https://cdn.brandfetch.io';
const BRAND_API = 'https://api.brandfetch.io/v2/brands';

export function brandfetchKey(): string | null {
  const k = Deno.env.get('BRANDFETCH_API_KEY');
  return k && k.trim() ? k.trim() : null;
}

// One or two requests, against a symbol that certainly exists (AAPL), never the catalog:
//   1. HEAD the Logo API with the secret as ?c= — a 200 image means it is a client ID.
//   2. Otherwise GET the Brand API with it as a Bearer — a 200 JSON means it is an API key
//      (and that one call is the only quota this probe spends).
export async function detectCredential(): Promise<{ kind: CredentialKind; detail: string }> {
  const key = brandfetchKey();
  if (!key) return { kind: 'missing', detail: 'BRANDFETCH_API_KEY is not set in this environment' };

  const cdn = await fetch(`${LOGO_CDN}/ticker/AAPL/fallback/404?c=${encodeURIComponent(key)}`, { method: 'HEAD' });
  if (cdn.ok && /^image\//.test(cdn.headers.get('content-type') || '')) {
    return { kind: 'logo-api-client-id', detail: `Logo API answered ${cdn.status} ${cdn.headers.get('content-type')} for ticker/AAPL` };
  }
  const cdnNote = `Logo API answered ${cdn.status} ${cdn.headers.get('content-type') || ''}`.trim();

  const api = await fetch(`${BRAND_API}/ticker/AAPL`, { headers: { Authorization: `Bearer ${key}` } });
  if (api.ok) {
    return { kind: 'brand-api-key', detail: `${cdnNote}; Brand API answered ${api.status} (1 lifetime request spent)` };
  }
  return { kind: 'invalid', detail: `${cdnNote}; Brand API answered ${api.status}` };
}

export interface CoverageResult {
  symbol: string;
  kind: 'ticker' | 'crypto';
  hasLogo: boolean;
  status: number;
  contentType: string | null;
}

// Logo API only — free, so probing the whole catalog costs nothing. HEAD with fallback/404,
// so a real logo is a 200 image and "no logo" is a real 404, never a placeholder that
// would count as coverage it is not.
export async function probeLogoApiCoverage(
  key: string,
  items: Array<{ symbol: string; kind: 'ticker' | 'crypto' }>
): Promise<CoverageResult[]> {
  const out: CoverageResult[] = [];
  for (const it of items) {
    const res = await fetch(`${LOGO_CDN}/${it.kind}/${encodeURIComponent(it.symbol)}/fallback/404?c=${encodeURIComponent(key)}`, { method: 'HEAD' });
    const ct = res.headers.get('content-type');
    out.push({ symbol: it.symbol, kind: it.kind, hasLogo: res.ok && /^image\//.test(ct || ''), status: res.status, contentType: ct });
  }
  return out;
}

// ============================================================================
// RESOLVE + STORE — A PROVIDER CHAIN, NOT A HARDCODED SOURCE.
//
// The chain is tried in order for a symbol; the first provider that returns a real image
// wins, and if none does the record stores null and the page renders the monogram. Adding a
// source is one entry in PROVIDERS below — no rework anywhere else.
//
// WHY THIS ORDER, measured against the real catalog (row 207), not household names:
//   • CoinGecko (crypto only, first): the coin's own image from /coins/{id}, the API this
//     project already prices with; 250px; zero extra calls when the caller already has it.
//   • Elbstream (stocks/ETFs and crypto): 21/21 of the seeded ETFs and 8/8 coins return a
//     real image, and an unknown symbol is a genuine 404. For an ETF it returns the ISSUER's
//     mark (SPDR/State Street for SPY, XLF, GLD…; Vanguard for VGK; iShares for TLT) — what
//     every brokerage shows. Free with a visible "Logos provided by Elbstream" link (≥12pt)
//     on every page that shows one (the .asset-logo-credit element); that obligation is
//     about where logos are SHOWN and is unchanged by storing the bytes here.
//   • Brandfetch Logo API (stocks/ETFs and crypto, conditional): covered only 2/29 of THIS
//     catalog (SPY, BTC) because its index is company brands and 21 of the 29 products are
//     FUNDS — AAPL answered 200. For an equity-heavy catalog (Apple, Tesla, Nvidia) it is a
//     viable alternative: public client ID, no attribution, free to ~1M req/month. It is
//     enabled ONLY when BRANDFETCH_API_KEY detects as a Logo API client ID; with a Brand API
//     key (100 lifetime requests) it stays out of the chain, since spending lifetime quota
//     per resolve would be wrong. The correct client ID was the value originally set before
//     it was replaced with the Brand API key (2026-09-13).
// Every provider here is keyless or public-credential, so nothing secret is at stake; the
// bytes are still fetched here and stored in this project's own public `asset-logos` bucket
// so a dashboard load makes ZERO provider requests and a provider outage, rate limit or
// terms change cannot blank the marks.
const ELBSTREAM = 'https://api.elbstream.com/logos';
const BUCKET = 'asset-logos';
const LOGO_PX = 128; // 2× the largest 46px well, for crisp rendering on dense displays

export interface LogoSource {
  kind: 'ticker' | 'crypto';
  symbol: string;
  coingeckoImageUrl?: string | null; // already in hand (lookupCrypto) — no call needed
  coingeckoId?: string | null;       // otherwise, one /coins/{id} call fetches the image URL
}

export class ProviderRateLimited extends Error {}

interface LogoProvider {
  name: string;
  covers(src: LogoSource): boolean;
  // The candidate URL(s) for this symbol, or [] when the provider has nothing to offer. May
  // throw ProviderRateLimited, which stops the chain for this symbol ("try later").
  urls(src: LogoSource): Promise<string[]>;
}

// `large` (250px) rather than `small` (50px): the biggest well is 46px and renders at 2×.
// CoinGecko's public tier rate-limits a burst of coin lookups (the backfill's first run
// tripped it on the eighth coin and silently fell through to Elbstream), so a 429 is waited
// out once, then surfaced as "try later" — never treated as "no image".
async function coingeckoImage(id: string): Promise<string | null> {
  const url = 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(id) +
    '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 12000)); continue; }
      throw new ProviderRateLimited('CoinGecko rate-limited the lookup for ' + id);
    }
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.image?.large === 'string' ? data.image.large
      : (typeof data?.image?.small === 'string' ? data.image.small : null);
  }
  return null;
}

// Detected once per runtime, so a chain of 29 resolutions costs at most one probe.
let brandfetchClientId: string | null | undefined;
async function brandfetchLogoClientId(): Promise<string | null> {
  if (brandfetchClientId !== undefined) return brandfetchClientId;
  const detected = await detectCredential();
  brandfetchClientId = detected.kind === 'logo-api-client-id' ? brandfetchKey() : null;
  return brandfetchClientId;
}

export const PROVIDERS: LogoProvider[] = [
  {
    name: 'coingecko',
    covers: (src) => src.kind === 'crypto' && !!(src.coingeckoImageUrl || src.coingeckoId),
    urls: async (src) => {
      const url = src.coingeckoImageUrl || (src.coingeckoId ? await coingeckoImage(src.coingeckoId) : null);
      return url ? [url] : [];
    }
  },
  {
    name: 'elbstream',
    covers: () => true,
    urls: async (src) => {
      const sym = encodeURIComponent(src.symbol.toUpperCase());
      return [`${ELBSTREAM}/${src.kind === 'crypto' ? 'crypto' : 'symbol'}/${sym}?format=png&size=${LOGO_PX}`];
    }
  },
  {
    name: 'brandfetch-logo-api',
    covers: () => true,
    urls: async (src) => {
      const id = await brandfetchLogoClientId();
      if (!id) return [];
      return [`${LOGO_CDN}/${src.kind}/${encodeURIComponent(src.symbol.toUpperCase())}/w/${LOGO_PX}/h/${LOGO_PX}/fallback/404?c=${encodeURIComponent(id)}`];
    }
  }
];

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const res = await fetch(url, { redirect: 'follow' });
  // A rate-limited IMAGE fetch is "try later" too — the first DOT run had CoinGecko's lookup
  // succeed and its image CDN answer 429, and treating that as "no image" fell through to
  // Elbstream and stored the wrong provider's mark.
  if (res.status === 429) throw new ProviderRateLimited('Rate-limited fetching ' + url);
  if (!res.ok) return null;
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(contentType)) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 32) return null; // an empty body is not a logo
  return { bytes, contentType };
}

function extFor(contentType: string): string {
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/jpeg') return 'jpg';
  return 'png';
}

// Walks the chain: the first real image wins. Returns the image and the provider that
// supplied it, or null when every provider came up empty.
async function resolveImage(src: LogoSource): Promise<{ image: { bytes: Uint8Array; contentType: string }; provider: string } | null> {
  for (const provider of PROVIDERS) {
    if (!provider.covers(src)) continue;
    for (const url of await provider.urls(src)) {
      let image: { bytes: Uint8Array; contentType: string } | null = null;
      try { image = await fetchImage(url); } catch (e) { if (e instanceof ProviderRateLimited) throw e; image = null; }
      if (image) return { image, provider: provider.name };
    }
  }
  return null;
}

// Resolves one logo through the chain and stores it. Returns the STORAGE PATH of the stored
// image (/storage/v1/object/public/asset-logos/<kind>/<SYMBOL>.<ext>), or null when no
// provider has an image — the caller stores null and the page renders the monogram. A path,
// not an absolute URL, deliberately: this function's own SUPABASE_URL is the stack-internal
// address locally (http://kong:8000, unreachable from a browser) and the public one on real
// staging — the same finding fund documents recorded for signed URLs — so the page prepends
// the project origin it is itself configured with (asset-mark.js, configured by
// supabase-data.js). A PM-typed absolute logo_url is untouched by any of this.
// Never throws for a missing logo; throws ProviderRateLimited when CoinGecko is limiting
// (leave the row for a later call) or on a storage failure — the add paths treat both as
// best-effort (a product or symbol is still created without its logo).
export async function resolveAndStoreLogo(admin: any, src: LogoSource): Promise<string | null> {
  const found = await resolveImage(src);
  if (!found) return null;
  const path = `${src.kind}/${src.symbol.toUpperCase()}.${extFor(found.image.contentType)}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, found.image.bytes, {
    contentType: found.image.contentType,
    upsert: true,
    cacheControl: '604800' // a week: a logo changes rarely, and a re-resolve overwrites in place
  });
  if (error) throw new Error('Could not store the logo for ' + src.symbol + ': ' + error.message);
  // A re-resolve can change the extension (CoinGecko's polkadot image is a JPEG where
  // Elbstream's was a PNG); the previous file would otherwise sit in the bucket for ever.
  const stale = ['png', 'jpg', 'webp', 'svg'].filter((e) => e !== extFor(found.image.contentType))
    .map((e) => `${src.kind}/${src.symbol.toUpperCase()}.${e}`);
  await admin.storage.from(BUCKET).remove(stale).catch(() => {});
  return `/storage/v1/object/public/${BUCKET}/${path}`;
}

// Every step of one resolution, for the admin `diagnose` action — every provider in the
// chain, which URL it offered, what it answered — so a silent fallback (a crypto mark
// quietly coming from Elbstream because CoinGecko was rate-limited) is visible rather than
// inferred from bytes.
export async function diagnoseLogo(src: LogoSource): Promise<Array<Record<string, unknown>>> {
  const steps: Array<Record<string, unknown>> = [];
  for (const provider of PROVIDERS) {
    if (!provider.covers(src)) { steps.push({ provider: provider.name, skipped: 'does not cover this kind' }); continue; }
    let urls: string[] = [];
    try { urls = await provider.urls(src); } catch (e) { steps.push({ provider: provider.name, error: (e as Error).message }); continue; }
    if (urls.length === 0) { steps.push({ provider: provider.name, offered: 'nothing' }); continue; }
    for (const url of urls) {
      try {
        const res = await fetch(url, { redirect: 'follow' });
        const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
        const len = res.ok ? (await res.arrayBuffer()).byteLength : 0;
        steps.push({ provider: provider.name, url, status: res.status, contentType: ct, bytes: len });
      } catch (e) {
        steps.push({ provider: provider.name, url, error: (e as Error).message });
      }
    }
  }
  return steps;
}

