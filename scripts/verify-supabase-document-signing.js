// Task C — real signing (2026-09-18, register row 249): backend verification.
//
// Proves, against the real local stack:
//   1. publish-document refuses a signature-required document that is not a PDF (server-side).
//   2. A real client signs a real published PDF through sign-document, and EVERY evidence
//      field is read back independently from Postgres and Storage — never from the response.
//      The original's SHA-256 is recomputed here from the bytes fetched out of Storage and
//      compared to the row; the signed copy is fetched, parsed as a PDF, and has one more page
//      than the original.
//   3. THE HASH IS RE-CHECKABLE: verify-document-signature reports matches:true, the stored
//      original is then overwritten (service role, the only role that can), and the same call
//      reports matches:false with the current hash — the document was altered after signing.
//   4. APPEND-ONLY for every role: UPDATE and DELETE attempted as the client (silent no-op
//      under RLS, row unchanged), as an admin (same), as service_role (the trigger refuses),
//      and TRUNCATE as the Postgres superuser via psql (refused — statement-level trigger).
//      No client-side INSERT for anyone.
//   5. A client cannot sign another client's document (404 — not found, never a hint), cannot
//      sign a non-signature-required document, cannot sign twice, cannot sign with the wrong
//      consent text, and the OLD direct-UPDATE path is gone (the policy is dropped).
//   6. Ordering, both directions: (a) an evidence row planted out of band while the document
//      is still Signature Required — the state a crash between "insert evidence" and "flip
//      status" leaves — is COMPLETED by the next call (recovered:true, flipped, still one row,
//      the planted typed_name untouched), never re-signed; (b) a document whose bytes cannot
//      be read fails BEFORE any evidence is written: 502, no row, status unchanged.
//   7. Authorisation: 401 with no session; verify-document-signature 403 for a client.
//   0. (first) The consent/capture text block is byte-identical in signing.ts and
//      document-signing.js — one block, two files, guarded.
//
// The evidence rows this run writes are PERMANENT by design (append-only); typed_name names
// this suite so a reader knows what they are. The clients, documents and objects are removed.
//
// fixture-symbols-allow: none — this suite writes no symbol-keyed table.
'use strict';

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { buildMinimalPdf } = require('./lib/minimal-pdf.js');
const { PDFDocument, decodePDFRawStream, PDFRawStream, PDFName, PDFArray } = require('pdf-lib');

// The text a page's content streams draw, decoded — pdf-lib writes Flate-compressed streams
// (Contents may be one stream or an array of them) and hex-encoded string operands
// (<48656c6c6f> Tj), so both are unwrapped here. Good enough for the Helvetica/WinAnsi text
// the certificate page is drawn with; not a general text extractor.
function pageText(doc, page) {
  const ref = page.node.get(PDFName.of('Contents'));
  const obj = doc.context.lookup(ref);
  const streams = obj instanceof PDFArray ? obj.asArray().map((r) => doc.context.lookup(r)) : [obj];
  const pieces = [];
  for (const st of streams) {
    if (!(st instanceof PDFRawStream)) continue;
    const raw = Buffer.from(decodePDFRawStream(st).decode()).toString('latin1');
    const re = /<([0-9A-Fa-f]+)>\s*Tj/g; let m;
    while ((m = re.exec(raw))) pieces.push(Buffer.from(m[1], 'hex').toString('latin1'));
  }
  return pieces.join(String.fromCharCode(10)); // one drawn string per line, operators dropped
}

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY, dbUrl: status.DB_URL };
}
async function createUser(admin, email, password) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('createUser(' + email + '): ' + error.message);
  return data.user;
}
async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + '): ' + error.message);
  return { client, session: data.session };
}
async function invoke(url, anonKey, token, fn, body, extraHeaders) {
  const r = await fetch(url + '/functions/v1/' + fn, {
    method: 'POST',
    headers: Object.assign({ apikey: anonKey, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, extraHeaders || {}),
    body: JSON.stringify(body || {})
  });
  let json = null; try { json = await r.json(); } catch (_) { /* non-JSON */ }
  return { status: r.status, body: json };
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function psql(dbUrl, sql) {
  // Superuser path for the TRUNCATE probe (statement-level; PostgREST has no TRUNCATE).
  return execSync('docker exec -i supabase_db_Marketswave psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c ' + JSON.stringify(sql), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

const CONSENT = 'I have read this document in full, I agree to be bound by it, and I accept that typing my name constitutes my signature.';

async function main() {
  console.log('Task C — document signing: backend verification\n');
  const { url, anonKey, serviceRoleKey, dbUrl } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'DocSigning-2026!';
  const created = [];
  const RUN = 'verify-supabase-document-signing ' + suffix;
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  const { removeAllClientStorageObjects } = await import('./lib/storage-test-cleanup.mjs');

  try {
    // ---- fixtures ------------------------------------------------------------------------
    const A = await createUser(admin, 'sign-a-' + suffix + '@test.marketswave.local', password); created.push(A.id);
    const B = await createUser(admin, 'sign-b-' + suffix + '@test.marketswave.local', password); created.push(B.id);
    await admin.from('clients').insert([
      { id: A.id, name: 'Signing Client A', email: A.email, phone: '+46 70 000 0021', account_type: 'Individual Account', status: 'active' },
      { id: B.id, name: 'Signing Client B', email: B.email, phone: '+46 70 000 0022', account_type: 'Individual Account', status: 'active' }
    ]);
    const a = await signIn(url, anonKey, A.email, password);
    const b = await signIn(url, anonKey, B.email, password);
    const pdf = buildMinimalPdf(3, 'Advisory Agreement — ' + RUN);
    const pdfB64 = pdf.toString('base64');

    // ---- 0. the consent/capture text is ONE block in two files ----------------------------
    console.log('0. The consent and capture statements are byte-identical in signing.ts (Deno) and document-signing.js (browser)');
    const block = (src) => { const m = src.match(/SIGNING-TEXT-START \*\/([\s\S]*?)\/\* SIGNING-TEXT-END/); return m ? m[1].replace(/^\s*(export const|var) /gm, '').replace(/\r/g, '').trim() : null; };
    const fs = require('fs'); const path = require('path');
    const tsBlock = block(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'signing.ts'), 'utf8'));
    const jsBlock = block(fs.readFileSync(path.join(__dirname, '..', 'document-signing.js'), 'utf8'));
    check('both files carry the marked block', !!tsBlock && !!jsBlock);
    check('★ the two blocks are byte-identical (CONSENT_TEXT + CAPTURE_TEXT)', tsBlock === jsBlock, (tsBlock || '').slice(0, 80) + ' vs ' + (jsBlock || '').slice(0, 80));
    check("the server's CONSENT_TEXT is the sentence this suite signs with", (tsBlock || '').indexOf(CONSENT) !== -1);

    // ---- 1. publish-document refuses a non-PDF signature-required document ---------------
    console.log('1. publish-document: signature-required must be a PDF (server-side)');
    const notPdf = await invoke(url, anonKey, pm.session.access_token, 'publish-document', { clientId: A.id, filename: 'agreement.pdf', category: 'Contracts', signatureRequired: true, fileBase64: Buffer.from('not a pdf at all').toString('base64'), fileType: 'application/pdf' });
    check('text bytes named *.pdf with signatureRequired are refused 400', notPdf.status === 400 && /must be a PDF/.test(notPdf.body && notPdf.body.error), JSON.stringify(notPdf.body));
    const { data: noneA } = await admin.from('documents').select('id').eq('client_id', A.id);
    check('  ...and no document row was created', noneA.length === 0);
    const notPdfPlain = await invoke(url, anonKey, pm.session.access_token, 'publish-document', { clientId: A.id, filename: 'notes.txt', category: 'General', signatureRequired: false, fileBase64: Buffer.from('plain notes').toString('base64'), fileType: 'text/plain' });
    check('a plain (non-signature) document may still be any type', notPdfPlain.status === 200, JSON.stringify(notPdfPlain.body));

    // ---- 2. the real publish + sign round trip ---------------------------------------------
    console.log('\n2. Publish a real PDF with real bytes, sign it as the client, read every field back independently');
    const pub = await invoke(url, anonKey, pm.session.access_token, 'publish-document', { clientId: A.id, filename: 'Advisory Agreement.pdf', category: 'Contracts', signatureRequired: true, dueDate: null, fileBase64: pdfB64, fileType: 'application/pdf' });
    check('publish-document accepts the real PDF (signature required)', pub.status === 200 && pub.body && pub.body.status === 'Signature Required', JSON.stringify(pub.body));
    const docId = pub.body.id;
    const { data: docRow } = await admin.from('documents').select('*').eq('id', docId).single();
    const { data: storedBlob } = await admin.storage.from('documents').download(docRow.storage_path);
    const storedBytes = Buffer.from(await storedBlob.arrayBuffer());
    check('the stored original in Storage is byte-identical to what was published (read back from Storage, not the response)', storedBytes.equals(pdf), storedBytes.length + ' vs ' + pdf.length);
    const expectedHash = sha256(pdf);

    // A client-side "rendered and hashed" report rides along, deliberately with a WRONG hash so
    // the assertion below proves it is recorded but never trusted as the fingerprint.
    const UA = 'Mozilla/5.0 (Marketswave verification; ' + RUN + ')';
    const signed = await invoke(url, anonKey, a.session.access_token, 'sign-document',
      { documentId: docId, typedName: '  Signing   Client A  ', consentText: CONSENT, consentAffirmed: true, clientReportedSha256: 'f'.repeat(64), clientReportedPages: 3 },
      { 'User-Agent': UA, 'X-Forwarded-For': '203.0.113.77, 10.0.0.1' });
    check('sign-document succeeds for the owning client', signed.status === 200 && signed.body && signed.body.signature, JSON.stringify(signed.body));
    const sigId = signed.body.signature.id;

    const { data: ev } = await admin.from('document_signatures').select('*').eq('document_id', docId).single();
    check('★ evidence row exists in Postgres, one per document', !!ev && ev.id === sigId);
    check('typed name recorded as typed (whitespace normalised)', ev.typed_name === 'Signing Client A', ev.typed_name);
    check('consent statement stored VERBATIM on the row', ev.consent_text === CONSENT);
    check('signed_at is a real UTC timestamp within the last minute', Math.abs(Date.now() - new Date(ev.signed_at).getTime()) < 60000, ev.signed_at);
    check('IP recorded from the request (first X-Forwarded-For hop), never the body', ev.ip_address === '203.0.113.77', ev.ip_address);
    check('user agent recorded from the request header, verbatim', ev.user_agent === UA, ev.user_agent);
    check('★ original_sha256 equals an INDEPENDENT SHA-256 of the bytes in Storage', ev.original_sha256 === expectedHash, ev.original_sha256 + ' vs ' + expectedHash);
    check('original_size_bytes equals the stored object size', Number(ev.original_size_bytes) === pdf.length);
    check('page_count is the real page count (3)', ev.page_count === 3, String(ev.page_count));
    check('★ the client-reported hash is RECORDED but did not become the fingerprint', ev.client_reported_sha256 === 'f'.repeat(64) && ev.original_sha256 !== ev.client_reported_sha256);
    check('client snapshot denormalised onto the row (name, email, filename, original path)', ev.client_name === 'Signing Client A' && ev.client_email === A.email && ev.filename === 'Advisory Agreement.pdf' && ev.original_storage_path === docRow.storage_path);

    const { data: docAfter } = await admin.from('documents').select('status, is_new, deadline_label').eq('id', docId).single();
    check('the document is Signed, is_new cleared, deadline cleared', docAfter.status === 'Signed' && docAfter.is_new === false && docAfter.deadline_label === null, JSON.stringify(docAfter));

    const { data: copyBlob, error: copyErr } = await admin.storage.from('documents').download(ev.signed_copy_storage_path);
    check('★ the signed copy exists in Storage under <client>/signed/<doc>/', !copyErr && !!copyBlob, copyErr && copyErr.message);
    const copyBytes = Buffer.from(await copyBlob.arrayBuffer());
    check('signed_copy_sha256 equals an independent SHA-256 of the stored signed copy', sha256(copyBytes) === ev.signed_copy_sha256);
    check('the signed copy is a PDF', copyBytes.slice(0, 5).toString('latin1') === '%PDF-');
    // Parsed with a real PDF parser — pdf-lib writes object streams and Flate-compressed
    // content, so a plaintext regex finds neither the page objects nor the certificate text.
    const copyDoc = await PDFDocument.load(copyBytes);
    check('the signed copy has exactly one more page than the original (the certificate page)', copyDoc.getPageCount() === 4, copyDoc.getPageCount() + ' pages');
    const certPage = copyDoc.getPage(copyDoc.getPageCount() - 1);
    const certText = pageText(copyDoc, certPage);
    check('the certificate page (decoded content stream) carries the original fingerprint, the typed name and the consent', certText.includes(expectedHash) && certText.includes('Signing Client A') && certText.split(String.fromCharCode(10)).join(' ').replace(/ +/g, ' ').includes('typing my name constitutes my signature'), 'hash=' + certText.includes(expectedHash) + ' name=' + certText.includes('Signing Client A') + ' consent=' + certText.split(String.fromCharCode(10)).join(' ').replace(/ +/g, ' ').includes('typing my name constitutes my signature') + ' :: ' + certText.split(String.fromCharCode(10)).join(' | ').slice(0, 300));
    const origDoc = await PDFDocument.load(pdf);
    check('the original stored bytes still parse as the 3-page PDF that was published', origDoc.getPageCount() === 3);
    check('the signed copy is NOT the same bytes as the original (its own hash differs)', ev.signed_copy_sha256 !== ev.original_sha256);

    // Client-visible: their own evidence via RLS; the signed copy readable via their own folder.
    const { data: ownEv } = await a.client.from('document_signatures').select('typed_name, original_sha256').eq('document_id', docId);
    check('the client can read their own evidence row through RLS', ownEv && ownEv.length === 1 && ownEv[0].original_sha256 === expectedHash);
    const { data: ownUrl, error: ownUrlErr } = await a.client.storage.from('documents').createSignedUrl(ev.signed_copy_storage_path, 60);
    check('the client can retrieve their own signed copy (signed URL from their own session)', !ownUrlErr && ownUrl && ownUrl.signedUrl, ownUrlErr && ownUrlErr.message);
    const { data: pmUrl, error: pmUrlErr } = await pm.client.storage.from('documents').createSignedUrl(ev.signed_copy_storage_path, 60);
    check('the PM can retrieve the signed copy too', !pmUrlErr && pmUrl && pmUrl.signedUrl, pmUrlErr && pmUrlErr.message);
    const { data: bEv } = await b.client.from('document_signatures').select('id').eq('document_id', docId);
    check('another client sees no evidence row for it', bEv && bEv.length === 0);
    const { data: mail } = await admin.from('email_log').select('subject, status').eq('related_entity_id', sigId).order('sent_at', { ascending: false }).limit(1);
    check('a "signed copy is ready" email was attempted and logged (link, not attachment)', mail && mail.length === 1 && /signed copy/i.test(mail[0].subject), JSON.stringify(mail));

    // ---- 3. the hash is re-checkable, and an alteration surfaces --------------------------
    console.log('\n3. verify-document-signature: matches now; alter the stored file; mismatch surfaces');
    const v1 = await invoke(url, anonKey, pm.session.access_token, 'verify-document-signature', { documentId: docId });
    check('re-check reports the original matches (fresh hash of current bytes)', v1.status === 200 && v1.body.original.matches === true && v1.body.original.currentSha256 === expectedHash, JSON.stringify(v1.body && v1.body.original));
    check('re-check reports the signed copy matches', v1.body.signedCopy.matches === true);
    // Overwrite the stored ORIGINAL with different bytes — only service_role can (the client
    // policy is uploads-only; the PM has no write policy on this bucket at all).
    const altered = buildMinimalPdf(3, 'ALTERED after signing — ' + RUN);
    const { error: owErr } = await admin.storage.from('documents').upload(docRow.storage_path, altered, { contentType: 'application/pdf', upsert: true });
    check('(setup) the stored original was overwritten out of band', !owErr, owErr && owErr.message);
    const v2 = await invoke(url, anonKey, pm.session.access_token, 'verify-document-signature', { documentId: docId });
    check('★ re-check now reports MISMATCH, with the current hash differing from the hash at signing', v2.status === 200 && v2.body.original.matches === false && v2.body.original.currentSha256 === sha256(altered) && v2.body.signature.originalSha256 === expectedHash, JSON.stringify(v2.body && v2.body.original));
    check('  ...while the signed copy, untouched, still matches', v2.body.signedCopy.matches === true);
    check('  ...and the recorded hash on the evidence row did not move (append-only)', (await admin.from('document_signatures').select('original_sha256').eq('id', sigId).single()).data.original_sha256 === expectedHash);
    const v3 = await invoke(url, anonKey, a.session.access_token, 'verify-document-signature', { documentId: docId });
    check('verify-document-signature is admin-only (403 for the client)', v3.status === 403);
    const v4 = await invoke(url, anonKey, pm.session.access_token, 'verify-document-signature', { documentId: crypto.randomUUID() });
    check('re-check of a document with no evidence is 404', v4.status === 404);

    // ---- 4. append-only, every role -------------------------------------------------------
    console.log('\n4. Append-only: UPDATE / DELETE / TRUNCATE refused for every role');
    const before = JSON.stringify((await admin.from('document_signatures').select('*').eq('id', sigId).single()).data);
    const { data: cu } = await a.client.from('document_signatures').update({ typed_name: 'Forged' }).eq('id', sigId).select();
    check('client UPDATE is a silent no-op under RLS (no rows)', !cu || cu.length === 0);
    const { data: cd } = await a.client.from('document_signatures').delete().eq('id', sigId).select();
    check('client DELETE is a silent no-op under RLS (no rows)', !cd || cd.length === 0);
    const { error: ci } = await a.client.from('document_signatures').insert({ document_id: crypto.randomUUID(), client_id: A.id, filename: 'x', typed_name: 'Forged', consent_text: CONSENT, original_storage_path: 'x', original_sha256: 'a'.repeat(64), original_size_bytes: 1, signed_copy_storage_path: 'y', signed_copy_sha256: 'b'.repeat(64), signed_copy_size_bytes: 1 });
    check('client INSERT is refused (no client-side write policy)', !!ci, ci && ci.message);
    const { data: pu } = await pm.client.from('document_signatures').update({ typed_name: 'Forged' }).eq('id', sigId).select();
    check('admin UPDATE is a silent no-op under RLS (no rows)', !pu || pu.length === 0);
    const { data: pd } = await pm.client.from('document_signatures').delete().eq('id', sigId).select();
    check('admin DELETE is a silent no-op under RLS (no rows)', !pd || pd.length === 0);
    const { error: su } = await admin.from('document_signatures').update({ typed_name: 'Forged' }).eq('id', sigId);
    check('★ service_role UPDATE is refused by the trigger', !!su && /append-only/.test(su.message), su && su.message);
    const { error: sd } = await admin.from('document_signatures').delete().eq('id', sigId);
    check('★ service_role DELETE is refused by the trigger', !!sd && /append-only/.test(sd.message), sd && sd.message);
    let truncErr = null; try { psql(dbUrl, 'truncate public.document_signatures'); } catch (e) { truncErr = String(e.stderr || e.message); }
    check('★ TRUNCATE is refused even for the Postgres superuser', !!truncErr && /append-only/.test(truncErr), truncErr && truncErr.slice(0, 120));
    const after = JSON.stringify((await admin.from('document_signatures').select('*').eq('id', sigId).single()).data);
    check('the row is byte-for-byte unchanged after every attempt', before === after);

    // ---- 5. refusals ----------------------------------------------------------------------
    console.log('\n5. Refusals: another client, wrong consent, not required, twice, no session, the old direct path');
    const pub2 = await invoke(url, anonKey, pm.session.access_token, 'publish-document', { clientId: A.id, filename: 'Second Agreement.pdf', category: 'Contracts', signatureRequired: true, fileBase64: pdfB64, fileType: 'application/pdf' });
    const doc2 = pub2.body.id;
    const other = await invoke(url, anonKey, b.session.access_token, 'sign-document', { documentId: doc2, typedName: 'Signing Client B', consentText: CONSENT, consentAffirmed: true });
    check('★ a second real client cannot sign A\'s document (404, not found — no hint it exists)', other.status === 404, JSON.stringify(other.body));
    check('  ...and A\'s document is still Signature Required with no evidence row', (await admin.from('documents').select('status').eq('id', doc2).single()).data.status === 'Signature Required' && (await admin.from('document_signatures').select('id').eq('document_id', doc2)).data.length === 0);
    const wrongConsent = await invoke(url, anonKey, a.session.access_token, 'sign-document', { documentId: doc2, typedName: 'Signing Client A', consentText: 'I agree.', consentAffirmed: true });
    check('a different consent sentence is refused 400', wrongConsent.status === 400 && /consent statement/.test(wrongConsent.body.error));
    const noConsent = await invoke(url, anonKey, a.session.access_token, 'sign-document', { documentId: doc2, typedName: 'Signing Client A', consentText: CONSENT, consentAffirmed: false });
    check('consent not affirmed is refused 400', noConsent.status === 400);
    const shortName = await invoke(url, anonKey, a.session.access_token, 'sign-document', { documentId: doc2, typedName: 'A', consentText: CONSENT, consentAffirmed: true });
    check('a one-character name is refused 400', shortName.status === 400);
    const noSession = await invoke(url, anonKey, null, 'sign-document', { documentId: doc2, typedName: 'Signing Client A', consentText: CONSENT, consentAffirmed: true });
    check('no session is 401', noSession.status === 401);
    const notRequired = await invoke(url, anonKey, a.session.access_token, 'sign-document', { documentId: notPdfPlain.body.id, typedName: 'Signing Client A', consentText: CONSENT, consentAffirmed: true });
    check('a document that never required a signature is refused 409', notRequired.status === 409, JSON.stringify(notRequired.body));
    const again = await invoke(url, anonKey, a.session.access_token, 'sign-document', { documentId: docId, typedName: 'Signing Client A Again', consentText: CONSENT, consentAffirmed: true });
    check('signing an already-signed document returns the EXISTING evidence, never a second row', again.status === 200 && again.body.recovered === true && again.body.signature.id === sigId && again.body.signature.typedName === 'Signing Client A', JSON.stringify(again.body));
    check('  ...still exactly one evidence row for it', (await admin.from('document_signatures').select('id').eq('document_id', docId)).data.length === 1);
    const { data: oldPath, error: oldPathErr } = await a.client.from('documents').update({ status: 'Signed', is_new: false, deadline_label: null }).eq('id', doc2).select();
    check('★ the OLD direct-UPDATE Sign path is gone: the client\'s UPDATE affects no rows', (!oldPath || oldPath.length === 0) && (await admin.from('documents').select('status').eq('id', doc2).single()).data.status === 'Signature Required', oldPathErr && oldPathErr.message);
    const { data: upl } = await a.client.from('documents').insert({ client_id: A.id, filename: 'my-upload.pdf', category: 'General', direction: 'upload', status: 'Received', is_new: false, storage_path: A.id + '/uploads/' + crypto.randomUUID() + '/my-upload.pdf' }).select().single();
    const signUpload = await invoke(url, anonKey, a.session.access_token, 'sign-document', { documentId: upl.id, typedName: 'Signing Client A', consentText: CONSENT, consentAffirmed: true });
    check('a client\'s own upload cannot be "signed" (409)', signUpload.status === 409);

    // ---- 6. ordering: evidence before status; recovery of a lost flip --------------------
    console.log('\n6. Ordering: evidence is written before the status flips; a lost flip is recovered, never re-signed');
    // Inject: an evidence row for doc2 that exists while the status is still Signature Required
    // — exactly the state a crash between steps (3) and (4) leaves. sign-document must complete
    // the flip and return THAT row, not insert another (the unique index would refuse anyway).
    const { data: injected, error: injErr } = await admin.from('document_signatures').insert({
      document_id: doc2, client_id: A.id, client_name: 'Signing Client A', client_email: A.email, filename: 'Second Agreement.pdf',
      typed_name: 'Recovered Signature (' + RUN + ')', consent_text: CONSENT, ip_address: '203.0.113.5', user_agent: 'injected',
      original_storage_path: 'x/injected', original_sha256: sha256(pdf), original_size_bytes: pdf.length, page_count: 3,
      signed_copy_storage_path: 'x/injected-signed', signed_copy_sha256: 'c'.repeat(64), signed_copy_size_bytes: 10
    }).select().single();
    check('(setup) evidence row injected while the document is still Signature Required', !injErr && injected, injErr && injErr.message);
    const rec = await invoke(url, anonKey, a.session.access_token, 'sign-document', { documentId: doc2, typedName: 'Should Not Be Recorded', consentText: CONSENT, consentAffirmed: true });
    check('★ sign-document recovers: returns the existing row (recovered:true), flips the status', rec.status === 200 && rec.body.recovered === true && rec.body.signature.id === injected.id, JSON.stringify(rec.body));
    check('  ...the document is now Signed', (await admin.from('documents').select('status').eq('id', doc2).single()).data.status === 'Signed');
    check('  ...exactly one evidence row, the injected one, typed_name untouched', (await admin.from('document_signatures').select('typed_name').eq('document_id', doc2)).data.map((r) => r.typed_name).join('|') === 'Recovered Signature (' + RUN + ')');
    // And the forward direction: a document whose storage object is MISSING cannot be signed —
    // the hash step fails before any evidence is written, and the status stays put.
    const { data: ghost } = await admin.from('documents').insert({ client_id: A.id, filename: 'ghost.pdf', category: 'Contracts', direction: 'from', status: 'Signature Required', is_new: true, storage_path: A.id + '/published/' + crypto.randomUUID() + '/ghost.pdf' }).select().single();
    const ghostSign = await invoke(url, anonKey, a.session.access_token, 'sign-document', { documentId: ghost.id, typedName: 'Signing Client A', consentText: CONSENT, consentAffirmed: true });
    check('★ if the bytes cannot be read, nothing is signed: 502, no evidence row, status unchanged', ghostSign.status === 502 && (await admin.from('document_signatures').select('id').eq('document_id', ghost.id)).data.length === 0 && (await admin.from('documents').select('status').eq('id', ghost.id).single()).data.status === 'Signature Required', JSON.stringify(ghostSign.body));
  } finally {
    for (const id of created) {
      await removeAllClientStorageObjects(admin, 'documents', id);
      await admin.from('documents').delete().eq('client_id', id);
      await admin.from('email_log').delete().ilike('recipient', 'sign-%' + suffix + '%');
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log('  TEARDOWN WARNING  user ' + id + ': ' + error.message);
    }
    console.log('\n  (the document_signatures rows this run wrote are permanent by design; each typed_name/RUN names "' + RUN + '")');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  console.log('DOCUMENT SIGNING: ' + (failed === 0 ? 'PASS' : 'FAIL'));
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => { console.error('\nUNEXPECTED ERROR: ' + (err && err.stack || err)); process.exit(1); });
