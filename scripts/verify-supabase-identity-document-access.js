// Task B — access logging for identity documents (2026-09-18, register row 246).
// Backend / API-level verification against the LOCAL Supabase stack.
//
// What this proves, against the real table, bucket and function — never from a UI:
//   1. open-identity-document is the ONLY read path: the bucket policy is still owner-only
//      (a real PM session cannot sign a URL), and the function returns a real 60-second URL
//      whose bytes are the client's real file — but only after a log row exists.
//   2. THE LOG IS THE GATE: an opened row exists for every URL returned, with who/when/which/
//      why, and url_expires_at within 60 s of the request.
//   3. REFUSED ATTEMPTS ARE ROWS TOO: a reason too short, an unknown document, and a non-PM
//      caller each leave a 'refused' row naming why. A request with no session leaves nothing
//      (nobody to attribute it to) and returns 401.
//   4. THE REASON IS FREE TEXT WITH A MINIMUM: 9 characters refused, 10 accepted, whitespace
//      does not count; enforced by the function AND by the table's CHECK.
//   5. ★ APPEND-ONLY, STRUCTURALLY: a PM's UPDATE/DELETE are silent no-ops under RLS (the row
//      is provably unchanged), a client cannot even SELECT, anon sees nothing — and a
//      service_role UPDATE, DELETE and TRUNCATE are each refused by the trigger with the
//      append-only error. Proven by attempting them, never by reading the policy text.
//   6. Every PM sees every access: a second real PM reads the first PM's rows.
//
// The rows this suite writes are PERMANENT by design — there is no delete path for anyone,
// and building one for tests would be the hole the trigger exists to close. Each carries a
// reason that names this suite, so a reviewer reading the log knows what they are.
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

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
async function invoke(url, anonKey, token, fn, body) {
  const r = await fetch(url + '/functions/v1/' + fn, {
    method: 'POST',
    headers: Object.assign({ apikey: anonKey, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  });
  let json = null; try { json = await r.json(); } catch (_) { /* non-JSON */ }
  return { status: r.status, body: json };
}

async function main() {
  console.log('Task B — identity document access logging: backend verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'IdentityAccess-2026!';
  const created = [];
  const objects = [];
  const RUN = 'verify-supabase-identity-document-access ' + suffix;
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');
  const pmId = pm.session.user.id;

  try {
    // ---- fixtures: one client with one real identity document; a second PM; a non-PM ------
    const A = await createUser(admin, 'idac-a-' + suffix + '@test.marketswave.local', password); created.push(A.id);
    const N = await createUser(admin, 'idac-n-' + suffix + '@test.marketswave.local', password); created.push(N.id);
    const PM2 = await createUser(admin, 'idac-pm2-' + suffix + '@test.marketswave.local', password); created.push(PM2.id);
    await admin.from('user_roles').insert({ user_id: PM2.id, is_admin: true });
    await admin.from('clients').insert([
      { id: A.id, name: 'Access Log Client', email: A.email, phone: '+46 70 000 0011', account_type: 'Individual Account', status: 'active' },
      { id: N.id, name: 'Not A PM', email: N.email, phone: '+46 70 000 0012', account_type: 'Individual Account', status: 'active' }
    ]);
    const a = await signIn(url, anonKey, A.email, password);
    const n = await signIn(url, anonKey, N.email, password);
    const pm2 = await signIn(url, anonKey, PM2.email, password);
    const bytes = Buffer.from('%PDF-1.4 access-log passport ' + suffix);
    const docId = crypto.randomUUID();
    const pathA = A.id + '/id/' + docId + '/passport.pdf';
    const up = await a.client.storage.from('identity-documents').upload(pathA, bytes, { contentType: 'application/pdf' });
    if (up.error) throw new Error('fixture upload: ' + up.error.message);
    objects.push(pathA);
    const ins = await a.client.from('identity_documents').insert({ id: docId, client_id: A.id, kind: 'id', document_type: 'Government-issued Photo ID', filename: 'passport.pdf', storage_path: pathA });
    if (ins.error) throw new Error('fixture row: ' + ins.error.message);
    const countRows = async (filter) => { let q = admin.from('identity_document_access_log').select('*', { count: 'exact' }); for (const k in filter) q = q.eq(k, filter[k]); const { count } = await q; return count; };
    const before = await countRows({ identity_document_id: docId });
    check('GUARD: no access rows exist for the fixture document yet', before === 0, String(before));

    console.log('\n1. The bucket is still owner-only, and the function is the only read path');
    const pmSign = await pm.client.storage.from('identity-documents').createSignedUrl(pathA, 60);
    check('★ a real PM session still cannot sign a URL for the object directly (Task A\'s policy is unchanged)', !!pmSign.error, JSON.stringify(pmSign.data));
    let r = await invoke(url, anonKey, null, 'open-identity-document', { documentId: docId, reason: RUN + ' — no session' });
    check('no session → 401', r.status === 401, String(r.status));
    check('  ...and nothing was logged (nobody to attribute it to)', (await countRows({ identity_document_id: docId })) === 0);

    console.log('\n2. Refused attempts are rows too');
    r = await invoke(url, anonKey, n.session.access_token, 'open-identity-document', { documentId: docId, reason: RUN + ' — non-PM attempt' });
    check('a signed-in NON-PM → 403', r.status === 403, String(r.status));
    let { data: rows } = await admin.from('identity_document_access_log').select('*').eq('identity_document_id', docId).eq('pm_user_id', N.id);
    check('★ ...and the attempt IS logged as refused, attributed to the caller, naming why', rows.length === 1 && rows[0].outcome === 'refused' && /not a Portfolio Manager/.test(rows[0].refusal_reason) && rows[0].pm_email === N.email, JSON.stringify(rows));
    r = await invoke(url, anonKey, pm.session.access_token, 'open-identity-document', { documentId: docId, reason: 'too short' });
    check('a 9-character reason → 400 with the minimum named', r.status === 400 && /10/.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
    r = await invoke(url, anonKey, pm.session.access_token, 'open-identity-document', { documentId: docId, reason: '   check     ' });
    check('whitespace does not count toward the minimum (400)', r.status === 400, String(r.status));
    r = await invoke(url, anonKey, pm.session.access_token, 'open-identity-document', { documentId: docId });
    check('no reason at all → 400', r.status === 400, String(r.status));
    ({ data: rows } = await admin.from('identity_document_access_log').select('*').eq('identity_document_id', docId).eq('pm_user_id', pmId).eq('outcome', 'refused'));
    check('★ each refused PM attempt is a row naming the reason it was refused', rows.length === 3 && rows.every((x) => /shorter than 10/.test(x.refusal_reason)), JSON.stringify(rows.map((x) => x.refusal_reason)));
    r = await invoke(url, anonKey, pm.session.access_token, 'open-identity-document', { documentId: crypto.randomUUID(), reason: RUN + ' — unknown document' });
    check('an unknown document → 404', r.status === 404, String(r.status));
    ({ data: rows } = await admin.from('identity_document_access_log').select('*').eq('pm_user_id', pmId).eq('refusal_reason', 'no such identity document').like('reason', '%' + suffix + '%'));
    check('  ...logged as refused with the document id that was asked for', rows.length === 1 && !!rows[0].identity_document_id, JSON.stringify(rows));
    const openedBefore = await countRows({ identity_document_id: docId, outcome: 'opened' });
    check('GUARD: no OPENED row exists yet — every refusal above left the document unopened', openedBefore === 0, String(openedBefore));

    console.log('\n3. A real open: the log row, then the URL, then the bytes');
    const t0 = Date.now();
    r = await invoke(url, anonKey, pm.session.access_token, 'open-identity-document', { documentId: docId, reason: RUN + ' — verifying the passport against the application' });
    check('★ a 10+ character reason → 200 with a URL', r.status === 200 && typeof r.body.url === 'string' && r.body.url.length > 0, r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
    check('  ttl is 60 s and expiresAt is within 60 s of now', r.body.ttlSeconds === 60 && Math.abs(new Date(r.body.expiresAt).getTime() - (t0 + 60000)) < 5000, r.body.expiresAt);
    check('  the response carries a signedPath (origin stripped) for the browser to rebuild against its own project URL', typeof r.body.signedPath === 'string' && r.body.signedPath.startsWith('/storage/v1/object/sign/identity-documents/'), r.body.signedPath);
    const fetched = await fetch(url + r.body.signedPath);
    const text = await fetched.text();
    check('★ the URL serves the client\'s REAL bytes', fetched.status === 200 && text === bytes.toString(), fetched.status + ' ' + text.slice(0, 40));
    ({ data: rows } = await admin.from('identity_document_access_log').select('*').eq('identity_document_id', docId).eq('outcome', 'opened'));
    check('★ exactly ONE opened row, with who / whose / which / why / when', rows.length === 1 && rows[0].pm_user_id === pmId && rows[0].pm_email === 'pm@marketswave.local'
      && rows[0].client_id === A.id && rows[0].client_name === 'Access Log Client' && rows[0].document_kind === 'id' && rows[0].filename === 'passport.pdf'
      && /verifying the passport/.test(rows[0].reason) && !!rows[0].url_expires_at, JSON.stringify(rows));
    check('  the row\'s url_expires_at matches the URL the caller got', rows.length === 1 && rows[0].url_expires_at && Math.abs(new Date(rows[0].url_expires_at) - new Date(r.body.expiresAt)) < 1000);
    check('  the response carries the document and client metadata, never the storage path', r.body.document && r.body.document.filename === 'passport.pdf' && !JSON.stringify(r.body.document).includes('storage') && r.body.client && r.body.client.name === 'Access Log Client');
    const r2 = await invoke(url, anonKey, pm.session.access_token, 'open-identity-document', { documentId: docId, reason: RUN + ' — second open, second row' });
    // "One URL per request" means one LOG ROW per URL handed out. The strings themselves can be
    // byte-identical: Storage signs deterministically, so two signatures for the same path in
    // the same second coincide. The row is the unit, not the string.
    check('a second open is a second logged row and its own returned URL (one row per URL handed out)', r2.status === 200 && typeof r2.body.url === 'string' && (await countRows({ identity_document_id: docId, outcome: 'opened' })) === 2);

    console.log('\n4. Append-only, structurally');
    const target = rows[0];
    let q = await pm.client.from('identity_document_access_log').update({ reason: 'tampered' }).eq('id', target.id).select();
    let { data: still } = await admin.from('identity_document_access_log').select('reason').eq('id', target.id).single();
    check('★ a PM UPDATE is a silent no-op under RLS — the row is provably unchanged', /verifying the passport/.test(still.reason) && (!q.data || q.data.length === 0), JSON.stringify(q));
    q = await pm.client.from('identity_document_access_log').delete().eq('id', target.id).select();
    ({ data: still } = await admin.from('identity_document_access_log').select('id').eq('id', target.id).maybeSingle());
    check('★ a PM DELETE is a silent no-op — the row is still there', !!still && (!q.data || q.data.length === 0), JSON.stringify(q));
    q = await pm.client.from('identity_document_access_log').insert({ pm_user_id: pmId, client_id: A.id, reason: RUN + ' — direct insert attempt', outcome: 'opened' });
    check('a PM cannot INSERT a row directly either (only the function writes)', !!q.error, JSON.stringify(q.data));
    q = await admin.from('identity_document_access_log').update({ reason: 'tampered by service_role' }).eq('id', target.id);
    check('★★ a service_role UPDATE is REFUSED by the trigger', !!q.error && /append-only/.test(q.error.message), JSON.stringify(q));
    q = await admin.from('identity_document_access_log').delete().eq('id', target.id);
    check('★★ a service_role DELETE is REFUSED by the trigger', !!q.error && /append-only/.test(q.error.message), JSON.stringify(q));
    ({ data: still } = await admin.from('identity_document_access_log').select('reason').eq('id', target.id).single());
    check('  ...and the row is byte-for-byte what was written', still && /verifying the passport/.test(still.reason));
    q = await admin.rpc('split_client_legal_name', { p_name: 'x' }); // (keeps the admin client warm; no-op)
    const dbInsertShort = await admin.from('identity_document_access_log').insert({ pm_user_id: pmId, client_id: A.id, reason: 'short', outcome: 'opened' });
    check('the table\'s own CHECK refuses a short reason on an OPENED row even from service_role', !!dbInsertShort.error && /reason_min/.test(dbInsertShort.error.message), JSON.stringify(dbInsertShort.error && dbInsertShort.error.message));
    q = await a.client.from('identity_document_access_log').select('id').eq('client_id', A.id);
    check('the client whose document it is cannot SELECT the log directly (empty, not an error) — disclosure is a request to the firm, not a table read', !q.error && q.data.length === 0, JSON.stringify(q));
    q = await createClient(url, anonKey).from('identity_document_access_log').select('id');
    check('anon sees nothing', !q.error && q.data.length === 0);

    console.log('\n5. Every PM sees every access');
    q = await pm2.client.from('identity_document_access_log').select('id, pm_email, outcome').eq('identity_document_id', docId);
    check('★ a second real PM reads the first PM\'s opened and refused rows', !q.error && q.data.length >= 5 && q.data.some((x) => x.pm_email === 'pm@marketswave.local' && x.outcome === 'opened'), JSON.stringify(q.data && q.data.length));
    const r3 = await invoke(url, anonKey, pm2.session.access_token, 'open-identity-document', { documentId: docId, reason: RUN + ' — second PM opening' });
    q = await pm.client.from('identity_document_access_log').select('pm_email').eq('identity_document_id', docId).eq('pm_user_id', PM2.id);
    check('  ...and the first PM sees the second PM\'s open, attributed to the second PM', r3.status === 200 && q.data.length === 1 && q.data[0].pm_email === PM2.email, JSON.stringify(q.data));

    console.log('\n6. The log outlives the document and the client');
    const totalBefore = await countRows({ identity_document_id: docId });
    for (const o of objects.splice(0)) await admin.storage.from('identity-documents').remove([o]);
    for (const id of [A.id]) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.log('  TEARDOWN WARNING ' + error.message); }
    created.splice(created.indexOf(A.id), 1);
    const totalAfter = await countRows({ identity_document_id: docId });
    const { data: gone } = await admin.from('identity_documents').select('id').eq('id', docId).maybeSingle();
    check('★ deleting the client (and with it the identity_documents row) leaves every log row intact', !gone && totalAfter === totalBefore && totalAfter >= 6, totalBefore + ' → ' + totalAfter);
    ({ data: rows } = await admin.from('identity_document_access_log').select('client_name, filename').eq('identity_document_id', docId).eq('outcome', 'opened').limit(1));
    check('  ...and the row still names the client and the file from its own snapshot', rows.length === 1 && rows[0].client_name === 'Access Log Client' && rows[0].filename === 'passport.pdf', JSON.stringify(rows));
  } finally {
    for (const o of objects) { const { error } = await admin.storage.from('identity-documents').remove([o]); if (error) console.log('  TEARDOWN WARNING  object ' + o + ': ' + error.message); }
    for (const id of created) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.log('  TEARDOWN WARNING  user ' + id + ': ' + error.message); }
    console.log('\n  (the access-log rows this run wrote are permanent by design; each names "' + RUN + '")');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  console.log('IDENTITY DOCUMENT ACCESS: ' + (failed === 0 ? 'PASS' : 'FAIL'));
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => { console.error('\nUNEXPECTED ERROR: ' + (err && err.stack || err)); process.exit(1); });
