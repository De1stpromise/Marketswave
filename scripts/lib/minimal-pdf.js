// A small, GENUINE PDF fixture for verification suites (Task C, 2026-09-18, register row 249).
//
// Until Task C the suites published "signature-required" documents as plain text bytes in a
// file called *.pdf — fine while nothing read them. publish-document now refuses a
// signature-required document that does not start with %PDF (a client must be able to read
// it in-page, and sign-document appends a certificate page to it), so a fixture has to be a
// real PDF: real header, real page objects, real content streams, a CORRECT xref table with
// computed byte offsets, and a trailer. pdf-lib and pdf.js both parse the result normally.
//
// CommonJS on purpose — the backend suites are .js/CJS; an .mjs caller uses
// createRequire(import.meta.url). Deterministic for a given (pages, title), so a hash
// comparison between runs is meaningful.
'use strict';

function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }

function buildMinimalPdf(pages, title) {
  const n = Math.max(1, pages | 0);
  const t = title || 'Marketswave test document';
  // Object numbering: 1 catalog, 2 pages root, 3 font, then per page: page object + content.
  const objs = [];
  const pageIds = [];
  for (let i = 0; i < n; i++) { pageIds.push(4 + i * 2); }
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + n + ' >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let i = 0; i < n; i++) {
    const pid = 4 + i * 2, cid = pid + 1;
    const lines = [
      'BT /F1 18 Tf 72 740 Td (' + esc(t) + ') Tj ET',
      'BT /F1 12 Tf 72 710 Td (Page ' + (i + 1) + ' of ' + n + ') Tj ET',
      'BT /F1 11 Tf 72 680 Td (This is a genuine PDF generated for verification. It exists so the signing flow) Tj ET',
      'BT /F1 11 Tf 72 664 Td (has real pages to render, real bytes to hash and a real file to append a certificate to.) Tj ET',
      i === n - 1 ? 'BT /F1 11 Tf 72 620 Td (Signature: ______________________) Tj ET' : ''
    ].filter(Boolean).join('\n');
    objs[pid] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + cid + ' 0 R >>';
    objs[cid] = '<< /Length ' + Buffer.byteLength(lines, 'latin1') + ' >>\nstream\n' + lines + '\nendstream';
  }
  // Pure ASCII on purpose: no binary-comment line, so the bytes survive a string round trip
  // (a jsdom suite hands this to new File([string]) and later compares fetched TEXT to it).
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += i + ' 0 obj\n' + objs[i] + '\nendobj\n';
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
  for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

const MINIMAL_PDF = buildMinimalPdf(2, 'Marketswave verification document');
const MINIMAL_PDF_BASE64 = MINIMAL_PDF.toString('base64');

module.exports = { buildMinimalPdf, MINIMAL_PDF, MINIMAL_PDF_BASE64 };
