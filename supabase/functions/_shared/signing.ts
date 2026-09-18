// ★ Task C — real signing (2026-09-18, register row 249). Shared by sign-document and
// verify-document-signature, so the two can never disagree about how a fingerprint is
// computed or what the client affirmed.
//
// The CONSENT and CAPTURE statements live here AND, byte-identical, in document-signing.js
// (the browser component) between SIGNING-TEXT-START / SIGNING-TEXT-END markers — the same
// one-block-two-files discipline onboarding-vocab.ts/js already carry, and the signing suite
// asserts the two copies are identical. The server stores ITS OWN copy of the consent text on
// the evidence row; the client's copy is what it displayed. The client sends the text it
// showed and the server refuses the request if it is not this exact statement — a signature
// under a different sentence is not this consent.
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

/* SIGNING-TEXT-START */
export const CONSENT_TEXT = 'I have read this document in full, I agree to be bound by it, and I accept that typing my name constitutes my signature.';
export const CAPTURE_TEXT = 'Signing records the date and time, your name as typed, your device and network address, and a fingerprint of this exact document. You\'ll receive a signed copy by email.';
/* SIGNING-TEXT-END */

export const TYPED_NAME_MIN = 2;
export const TYPED_NAME_MAX = 120;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isPdf(bytes: Uint8Array): boolean {
  // %PDF- at the very start. A PDF is allowed a few bytes of leading junk by the spec, but a
  // document the firm publishes for signature is produced by a real generator and starts clean;
  // refusing the exception is the safe reading for something a client will be bound by.
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

export interface CertificateInput {
  filename: string;
  clientName: string;
  clientEmail: string;
  typedName: string;
  signedAtIso: string;
  ipAddress: string | null;
  userAgent: string | null;
  originalSha256: string;
  originalSizeBytes: number;
  pageCount: number;
  consentText: string;
  documentId: string;
}

// Appends ONE certificate page to the original and returns the new bytes. The original pages
// are untouched (pdf-lib copies them through byte-for-byte as objects; only a page is added
// and the file re-serialised). The certificate states the fingerprint of the ORIGINAL, so the
// signed copy carries the proof of what it was made from.
export async function appendSignatureCertificate(originalBytes: Uint8Array, input: CertificateInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const navy = rgb(27 / 255, 58 / 255, 75 / 255);
  const muted = rgb(0.36, 0.39, 0.42);
  const left = 56;
  let y = 780;

  page.drawText('MARKETSWAVE', { x: left, y, size: 10, font: bold, color: navy });
  y -= 30;
  page.drawText('Electronic signature certificate', { x: left, y, size: 20, font: bold, color: navy });
  y -= 22;
  page.drawText('This page was generated and appended by Marketswave at the moment of signing. It records the', { x: left, y, size: 9.5, font, color: muted });
  y -= 13;
  page.drawText('evidence captured for the signature on the preceding ' + input.pageCount + ' page' + (input.pageCount === 1 ? '' : 's') + '.', { x: left, y, size: 9.5, font, color: muted });
  y -= 30;

  const rows: Array<[string, string]> = [
    ['Document', input.filename],
    ['Document id', input.documentId],
    ['Signed by (as typed)', input.typedName],
    ['Account holder', input.clientName + ' <' + input.clientEmail + '>'],
    ['Signed at (UTC)', input.signedAtIso],
    ['Network address', input.ipAddress || 'not available'],
    ['Device / browser', input.userAgent || 'not available'],
    ['Original size', input.originalSizeBytes.toLocaleString('en-GB') + ' bytes, ' + input.pageCount + ' page' + (input.pageCount === 1 ? '' : 's')],
    ['SHA-256 of original', input.originalSha256]
  ];
  for (const [k, v] of rows) {
    page.drawText(k, { x: left, y, size: 9, font: bold, color: navy });
    // The fingerprint is drawn UNBROKEN on one line at a smaller size — a reader compares it
    // against the evidence row, and a hash split across two lines cannot be compared by eye.
    const isHash = /^[0-9a-f]{64}$/.test(v);
    const lines = isHash ? [v] : wrap(v, 62);
    for (let i = 0; i < lines.length; i++) {
      page.drawText(lines[i], { x: left + 150, y: y - i * 12, size: isHash ? 7.5 : 9, font, color: rgb(0.1, 0.11, 0.12) });
    }
    y -= 12 * Math.max(1, lines.length) + 8;
  }

  y -= 12;
  page.drawText('Consent affirmed', { x: left, y, size: 9, font: bold, color: navy });
  y -= 14;
  for (const line of wrap(input.consentText, 95)) {
    page.drawText(line, { x: left, y, size: 9, font, color: rgb(0.1, 0.11, 0.12) });
    y -= 12;
  }

  y -= 18;
  for (const line of wrap('The SHA-256 above is the fingerprint of the exact bytes the signer read and signed. Marketswave stores it separately in an append-only record; re-hashing the stored original and comparing it to this value proves whether the document has been altered since signing. This certificate page is not part of the signed document and is excluded from that fingerprint.', 95)) {
    page.drawText(line, { x: left, y, size: 8.5, font, color: muted });
    y -= 11.5;
  }

  return await doc.save();
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (word.length > width) {
      if (line) { out.push(line); line = ''; }
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      continue;
    }
    if ((line + ' ' + word).trim().length > width) { out.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
