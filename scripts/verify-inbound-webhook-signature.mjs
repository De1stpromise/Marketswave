#!/usr/bin/env node
// Unified Communications Inbox — Stage 2 (2026-09-07). Real, direct unit test of
// verifySvixWebhook() (_shared/webhook-verify.ts) — the actual security boundary in front of
// receive-inbound-email, a real unauthenticated public POST endpoint. Imports the REAL,
// unmodified .ts source directly (Node 24's own native type-stripping support, confirmed
// working — no transpile step, no Deno needed for this pure-crypto module with zero
// Deno-specific imports).
import crypto from 'node:crypto';
import { runVerifyMain } from './lib/run-verify.mjs';

const { verifySvixWebhook } = await import('../supabase/functions/_shared/webhook-verify.ts');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

function computeSignature(secret, svixId, svixTimestamp, body) {
  const keyBytes = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signedContent = svixId + '.' + svixTimestamp + '.' + body;
  const sig = crypto.createHmac('sha256', keyBytes).update(signedContent).digest('base64');
  return 'v1,' + sig;
}

async function main() {
  console.log('Real Svix webhook signature verification — direct unit test\n');

  const secret = 'whsec_' + crypto.randomBytes(24).toString('base64');
  const body = JSON.stringify({ type: 'email.received', data: { email_id: 'test-123', from: 'someone@example.com' } });
  const svixId = 'msg_' + crypto.randomBytes(8).toString('hex');
  const nowSeconds = Math.floor(Date.now() / 1000);

  console.log('--- 1. The real happy path ---\n');
  const validSig = computeSignature(secret, svixId, String(nowSeconds), body);
  const r1 = await verifySvixWebhook(body, { svixId, svixTimestamp: String(nowSeconds), svixSignature: validSig }, secret);
  check('a genuinely correctly-signed real payload verifies as valid', r1.valid === true, JSON.stringify(r1));

  console.log('\n--- 2. Real rejection cases — each must genuinely fail ---\n');

  const wrongSecret = 'whsec_' + crypto.randomBytes(24).toString('base64');
  const r2 = await verifySvixWebhook(body, { svixId, svixTimestamp: String(nowSeconds), svixSignature: validSig }, wrongSecret);
  check('a real signature computed with the WRONG secret is genuinely rejected', r2.valid === false);

  const tamperedBody = body.replace('someone@example.com', 'attacker@example.com');
  const r3 = await verifySvixWebhook(tamperedBody, { svixId, svixTimestamp: String(nowSeconds), svixSignature: validSig }, secret);
  check('★ a genuinely TAMPERED body (the real point of signing) is rejected even with the original valid-looking signature header', r3.valid === false);

  const wrongIdSig = computeSignature(secret, 'msg_someone_else', String(nowSeconds), body);
  const r4 = await verifySvixWebhook(body, { svixId, svixTimestamp: String(nowSeconds), svixSignature: wrongIdSig }, secret);
  check('a signature computed for a DIFFERENT svix-id is rejected', r4.valid === false);

  const oldTimestamp = String(nowSeconds - 10 * 60); // 10 minutes old — outside the 5-minute tolerance
  const oldSig = computeSignature(secret, svixId, oldTimestamp, body);
  const r5 = await verifySvixWebhook(body, { svixId, svixTimestamp: oldTimestamp, svixSignature: oldSig }, secret);
  check('★ a genuine REPLAY of an old, otherwise-validly-signed payload is rejected via the timestamp tolerance window', r5.valid === false, r5.reason);

  const futureTimestamp = String(nowSeconds + 10 * 60);
  const futureSig = computeSignature(secret, svixId, futureTimestamp, body);
  const r6 = await verifySvixWebhook(body, { svixId, svixTimestamp: futureTimestamp, svixSignature: futureSig }, secret);
  check('a timestamp too far in the FUTURE is also rejected (the same tolerance window, both directions)', r6.valid === false);

  const r7 = await verifySvixWebhook(body, { svixId: null, svixTimestamp: String(nowSeconds), svixSignature: validSig }, secret);
  check('a missing svix-id header is rejected', r7.valid === false);

  const r8 = await verifySvixWebhook(body, { svixId, svixTimestamp: String(nowSeconds), svixSignature: null }, secret);
  check('a missing svix-signature header is rejected', r8.valid === false);

  const r9 = await verifySvixWebhook(body, { svixId, svixTimestamp: 'not-a-number', svixSignature: validSig }, secret);
  check('a malformed (non-numeric) svix-timestamp is rejected, not crashed on', r9.valid === false);

  console.log('\n--- 3. Multiple space-separated signature candidates (real Svix key-rotation format) ---\n');
  const secondSecretSig = computeSignature(wrongSecret, svixId, String(nowSeconds), body);
  const multiSig = secondSecretSig + ' ' + validSig; // the real one is the SECOND candidate
  const r10 = await verifySvixWebhook(body, { svixId, svixTimestamp: String(nowSeconds), svixSignature: multiSig }, secret);
  check('★ verification checks EVERY space-separated candidate, not just the first — matches at least one', r10.valid === true);

  console.log('\n--- 4. A malformed configured secret fails closed, not silently ---\n');
  const r11 = await verifySvixWebhook(body, { svixId, svixTimestamp: String(nowSeconds), svixSignature: validSig }, 'not-a-real-whsec-value');
  check('a secret without the real whsec_ prefix is rejected outright, not silently mismatched', r11.valid === false);

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  if (failed > 0) {
    console.log('VERIFY: FAIL');
    process.exit(1);
  }
  console.log('VERIFY: PASS');
}

runVerifyMain(main);
