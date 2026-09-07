// Unified Communications Inbox — Stage 2 (2026-09-07). Real Svix webhook signature
// verification for Resend's real inbound-email webhook (`receive-inbound-email`) — an
// unverified public POST endpoint accepting arbitrary payloads is a real security hole (a
// spoofed webhook call could inject fake "inbound emails" straight into any real
// conversation), so this is the actual security boundary that function relies on.
//
// ★ Investigated and confirmed directly against Resend's own docs and Svix's own manual-
// verification guide before writing this — Resend signs every webhook (not just inbound
// email) through Svix, using three headers: `svix-id`, `svix-timestamp`, `svix-signature`.
//
// ★ Implemented by hand via the Web Crypto API rather than pulling in the `svix` npm
// package — the algorithm is small, well-specified, and security-critical enough that full
// visibility into exactly what's being compared is worth more here than a dependency,
// mirroring this project's own established `_shared/send-email.ts` choice to call Resend's
// plain HTTP API directly rather than its SDK.
//
// THE ALGORITHM (confirmed against Svix's own "verifying webhooks manually" documentation):
//   1. signedContent = `${svix-id}.${svix-timestamp}.${rawBody}` — the RAW, unparsed request
//      body is required; re-serializing a parsed-then-stringified body will NOT reproduce a
//      byte-identical signature.
//   2. The webhook secret (`whsec_...`) has its `whsec_` prefix stripped, and the remainder
//      is base64-decoded to raw key bytes — that decoded value, not the raw secret string
//      itself, is the real HMAC key.
//   3. signature = base64(HMAC-SHA256(keyBytes, signedContent))
//   4. `svix-signature` may carry multiple space-separated `v1,<base64sig>` candidates (Svix
//      key rotation); this computed signature must match AT LEAST ONE of them, compared in
//      constant time to avoid a timing side-channel on a security check.
//   5. `svix-timestamp` is checked against the real current time with a tolerance window,
//      rejecting a payload that's too old (replay protection) — a genuinely re-played old
//      webhook body would otherwise pass signature verification forever, since the signature
//      itself never expires on its own.
export async function verifySvixWebhook(
  rawBody: string,
  headers: { svixId: string | null; svixTimestamp: string | null; svixSignature: string | null },
  secret: string
): Promise<{ valid: boolean; reason: string | null }> {
  const { svixId, svixTimestamp, svixSignature } = headers;

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: 'Missing one or more required svix-* headers.' };
  }

  const timestampSeconds = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return { valid: false, reason: 'svix-timestamp is not a valid integer.' };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const TOLERANCE_SECONDS = 5 * 60; // 5 minutes, the standard Svix-recommended replay window.
  if (Math.abs(nowSeconds - timestampSeconds) > TOLERANCE_SECONDS) {
    return { valid: false, reason: 'svix-timestamp is outside the allowed tolerance window (possible replay).' };
  }

  if (!secret.startsWith('whsec_')) {
    return { valid: false, reason: 'Configured webhook secret does not look like a real whsec_ value.' };
  }
  const secretBytes = base64Decode(secret.slice('whsec_'.length));

  const signedContent = svixId + '.' + svixTimestamp + '.' + rawBody;
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent)));
  const computedSignature = base64Encode(signatureBytes);

  const candidates = svixSignature.split(' ').map((entry) => {
    const commaIdx = entry.indexOf(',');
    return commaIdx === -1 ? entry : entry.slice(commaIdx + 1);
  });

  const matched = candidates.some((candidate) => constantTimeEqual(candidate, computedSignature));
  if (!matched) {
    return { valid: false, reason: 'Computed signature does not match any candidate in svix-signature.' };
  }
  return { valid: true, reason: null };
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Constant-time string comparison — a security-critical check must not leak timing
// information about how many leading characters matched.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
