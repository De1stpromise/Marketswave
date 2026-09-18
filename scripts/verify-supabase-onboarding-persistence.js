// Task A — make signup's data actually persist (2026-09-18, register row 242).
// Backend / API-level verification against the LOCAL Supabase stack.
//
// What this proves, each against the real tables/bucket and never from a UI:
//   0. The browser and Deno copies of the onboarding vocabulary are byte-identical.
//   1. submit-onboarding: auth, validation (enum, date, age, account-type groups), the
//      real row with every column, legal_name split server-side, ONCE ONLY (409), and the
//      reclaim shape (no date of birth, no country) accepted with honest nulls.
//   2. RLS on client_profiles: self read, cross-client read empty, NO client write path.
//   3. Identity documents: a client uploads into its own folder and records the row; every
//      cross-client and cross-folder attempt refused; the owner can read its own bytes back;
//      ★ A REAL ADMIN SESSION CANNOT SIGN A URL FOR, LIST, OR DOWNLOAD THE OBJECT — the Task B
//      enforcement is an absent policy, proven here rather than a hidden button; no client
//      DELETE of either the object or the row; one document per kind.
//   4. The change-request flow reused for the six groups: request → PM approve lands in the
//      real column; reject writes nothing; dateOfBirth is NOT requestable; entity/joint groups
//      refused for the wrong account type.
//   5. get-client-profile returns the onboarding block and identity-document METADATA only —
//      no url, no path, on any entry.
//   6. Gary (seeded before this existed) reads back correctly: legal name present, onboarding
//      honestly unsubmitted, no identity documents.
//
// Every test client is created and deleted here; storage objects are removed with the
// service role in the finally block (there is no client-side delete path by design).
const fs = require('fs');
const path = require('path');
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
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
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
function extractVocabBlock(file) {
  const s = fs.readFileSync(file, 'utf8');
  const a = s.indexOf('{', s.indexOf('VOCAB-START'));
  const b = s.lastIndexOf('};', s.indexOf('VOCAB-END')) + 2;
  return s.slice(a, b);
}

const FULL = {
  dateOfBirth: '1988-04-12',
  countryOfResidence: 'SE',
  financialProfile: { investableAssets: '250k-1m', sourceOfWealth: 'business', employment: 'Founder, logistics' },
  goalsPreferences: { investmentGoal: 'growth', timeHorizon: '7-15', riskComfort: 'moderate' },
  riskQuestionnaire: { knowledge: 'intermediate', reaction: 'hold', objective: 'balanced', horizon: '7-15', liquidity: 'somewhat', experience: 'occasionally' }
};

async function main() {
  console.log('Task A — onboarding persistence + identity documents: backend verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'OnboardingPersist-2026!';
  const created = [];
  const objects = [];
  const pm = await signIn(url, anonKey, 'pm@marketswave.local', 'MarketswavePM-Local-2026!');

  try {
    console.log('0. The vocabulary twins');
    const jsBlock = extractVocabBlock(path.join(__dirname, '..', 'onboarding-vocab.js'));
    const tsBlock = extractVocabBlock(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'onboarding-vocab.ts'));
    check('GUARD: both blocks were extracted (non-empty)', jsBlock.length > 1000 && tsBlock.length > 1000, jsBlock.length + '/' + tsBlock.length);
    check('★ onboarding-vocab.js and _shared/onboarding-vocab.ts carry a byte-identical VOCAB block', jsBlock === tsBlock);

    // ---- clients ----------------------------------------------------------------------------
    console.log('\n1. submit-onboarding');
    const A = await createUser(admin, 'onb-a-' + suffix + '@test.marketswave.local', password); created.push(A.id);
    const B = await createUser(admin, 'onb-b-' + suffix + '@test.marketswave.local', password); created.push(B.id);
    const C = await createUser(admin, 'onb-c-' + suffix + '@test.marketswave.local', password); created.push(C.id);
    const N = await createUser(admin, 'onb-n-' + suffix + '@test.marketswave.local', password); created.push(N.id); // no clients row
    await admin.from('clients').insert([
      { id: A.id, name: 'Astrid Lindqvist', email: A.email, phone: '+46 70 000 0001', account_type: 'Individual Account', status: 'pending_review' },
      { id: B.id, name: 'Riverstone Holdings LLC', email: B.email, phone: '+46 70 000 0002', account_type: 'Business Account', status: 'pending_review' },
      { id: C.id, name: 'Smith', email: C.email, phone: '+46 70 000 0003', account_type: 'Individual Account', status: 'active' }
    ]);
    const a = await signIn(url, anonKey, A.email, password);
    const b = await signIn(url, anonKey, B.email, password);
    const c = await signIn(url, anonKey, C.email, password);
    const n = await signIn(url, anonKey, N.email, password);

    let r = await invoke(url, anonKey, null, 'submit-onboarding', FULL);
    check('no session → 401', r.status === 401, r.status);
    r = await invoke(url, anonKey, n.session.access_token, 'submit-onboarding', FULL);
    check('a user with no clients row → 404', r.status === 404, r.status + ' ' + JSON.stringify(r.body));
    r = await invoke(url, anonKey, a.session.access_token, 'submit-onboarding', Object.assign({}, FULL, { financialProfile: { investableAssets: 'a-billion' } }));
    check('an enum value the form never offers → 400 with the field named', r.status === 400 && /investable assets/i.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
    r = await invoke(url, anonKey, a.session.access_token, 'submit-onboarding', Object.assign({}, FULL, { dateOfBirth: '2015-01-01' }));
    check('under 18 → 400', r.status === 400 && /18/.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
    r = await invoke(url, anonKey, a.session.access_token, 'submit-onboarding', Object.assign({}, FULL, { dateOfBirth: '12/04/1988' }));
    check('a non-ISO date → 400', r.status === 400, r.status);
    r = await invoke(url, anonKey, a.session.access_token, 'submit-onboarding', Object.assign({}, FULL, { entityDetails: { name: 'Nope AB' } }));
    check('entityDetails for an Individual account → 400', r.status === 400 && /account type/i.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
    let { data: none } = await admin.from('client_profiles').select('client_id').eq('client_id', A.id).maybeSingle();
    check('GUARD: none of the refused calls wrote a row', !none);

    r = await invoke(url, anonKey, a.session.access_token, 'submit-onboarding', FULL);
    check('★ a real full submission → 200', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
    const { data: rowA } = await admin.from('client_profiles').select('*').eq('client_id', A.id).single();
    check('★ every onboarding column landed in Postgres', rowA && rowA.date_of_birth === '1988-04-12' && rowA.country_of_residence === 'SE'
      && rowA.financial_profile && rowA.financial_profile.investableAssets === '250k-1m' && rowA.financial_profile.employment === 'Founder, logistics'
      && rowA.goals_preferences && rowA.goals_preferences.timeHorizon === '7-15'
      && rowA.risk_questionnaire && rowA.risk_questionnaire.liquidity === 'somewhat' && rowA.entity_details === null && rowA.joint_holder === null,
      JSON.stringify(rowA));
    check('★ legal_name was set server-side from clients.name, split (never from the caller)', rowA && rowA.legal_name && rowA.legal_name.firstName === 'Astrid' && rowA.legal_name.lastName === 'Lindqvist', JSON.stringify(rowA && rowA.legal_name));
    check('onboarding_submitted_at is set', rowA && !!rowA.onboarding_submitted_at);
    check('the response mirrors the row (camelCase)', r.body.countryOfResidence === 'SE' && r.body.riskQuestionnaire.knowledge === 'intermediate' && !!r.body.onboardingSubmittedAt);
    r = await invoke(url, anonKey, a.session.access_token, 'submit-onboarding', Object.assign({}, FULL, { countryOfResidence: 'NO' }));
    check('★ a second submission → 409, and the row is unchanged', r.status === 409, r.status);
    const { data: rowA2 } = await admin.from('client_profiles').select('country_of_residence').eq('client_id', A.id).single();
    check('  (country still SE)', rowA2.country_of_residence === 'SE');

    r = await invoke(url, anonKey, b.session.access_token, 'submit-onboarding', Object.assign({}, FULL, { entityDetails: { name: 'Riverstone Holdings', registrationNumber: '556-0001', incorporationCountry: 'Sweden', role: 'Director' } }));
    check('a Business account submits entityDetails → 200', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
    const { data: rowB } = await admin.from('client_profiles').select('entity_details, legal_name').eq('client_id', B.id).single();
    check('entity_details landed; legal_name split strips the LLC suffix (Riverstone / Holdings)', rowB.entity_details.role === 'Director' && rowB.legal_name.firstName === 'Riverstone' && rowB.legal_name.lastName === 'Holdings', JSON.stringify(rowB));

    // reclaim shape: no DOB, no country (pre-2026-09-18 local records never had them)
    r = await invoke(url, anonKey, c.session.access_token, 'submit-onboarding', { financialProfile: FULL.financialProfile, goalsPreferences: FULL.goalsPreferences, riskQuestionnaire: FULL.riskQuestionnaire });
    check('★ the reclaim shape (no date of birth, no country) → 200', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
    const { data: rowC } = await admin.from('client_profiles').select('*').eq('client_id', C.id).single();
    check('  date_of_birth and country stay genuinely null — never guessed', rowC.date_of_birth === null && rowC.country_of_residence === null && !!rowC.onboarding_submitted_at);
    check('  a one-word name splits to an empty first name, not a guess', rowC.legal_name.firstName === '' && rowC.legal_name.lastName === 'Smith', JSON.stringify(rowC.legal_name));
    r = await invoke(url, anonKey, n.session.access_token, 'submit-onboarding', {});
    check('an empty submission → 4xx (nothing to submit)', r.status === 400 || r.status === 404, r.status);

    // ---- RLS on client_profiles ----------------------------------------------------------
    console.log('\n2. RLS on client_profiles');
    let q = await a.client.from('client_profiles').select('client_id, country_of_residence, risk_questionnaire');
    check('A reads its own row with the onboarding columns', q.data && q.data.length === 1 && q.data[0].country_of_residence === 'SE' && q.data[0].risk_questionnaire.knowledge === 'intermediate', JSON.stringify(q.data));
    q = await b.client.from('client_profiles').select('client_id').eq('client_id', A.id);
    check("B cannot read A's row (empty, not an error)", !q.error && q.data.length === 0, JSON.stringify(q));
    q = await createClient(url, anonKey).from('client_profiles').select('client_id');
    check('anon sees nothing', !q.error && q.data.length === 0);
    q = await a.client.from('client_profiles').update({ country_of_residence: 'NO' }).eq('client_id', A.id).select();
    const { data: still } = await admin.from('client_profiles').select('country_of_residence').eq('client_id', A.id).single();
    check('★ A cannot UPDATE its own profile directly (a silent no-op — the row is provably unchanged)', still.country_of_residence === 'SE' && (!q.data || q.data.length === 0), JSON.stringify(q));
    q = await n.client.from('client_profiles').insert({ client_id: N.id, country_of_residence: 'SE' });
    check('★ no client-side INSERT path exists (refused by RLS)', !!q.error, JSON.stringify(q.data));

    // ---- identity documents -------------------------------------------------------------
    console.log('\n3. Identity documents — bucket + table');
    const bytes = Buffer.from('%PDF-1.4 fake passport ' + suffix);
    const idA = crypto.randomUUID();
    const pathA = A.id + '/id/' + idA + '/passport.pdf';
    let up = await a.client.storage.from('identity-documents').upload(pathA, bytes, { contentType: 'application/pdf' });
    check('★ A uploads into its own folder of the identity-documents bucket', !up.error, up.error && up.error.message);
    if (!up.error) objects.push(pathA);
    let ins = await a.client.from('identity_documents').insert({ id: idA, client_id: A.id, kind: 'id', document_type: 'Government-issued Photo ID', filename: 'passport.pdf', storage_path: pathA });
    check('★ A records the row', !ins.error, ins.error && ins.error.message);
    up = await b.client.storage.from('identity-documents').upload(A.id + '/id/' + crypto.randomUUID() + '/x.pdf', bytes);
    check("B cannot upload into A's folder", !!up.error, JSON.stringify(up.data));
    ins = await b.client.from('identity_documents').insert({ client_id: A.id, kind: 'address', document_type: 'x', filename: 'x', storage_path: A.id + '/address/x/x.pdf' });
    check("B cannot insert a row for A", !!ins.error);
    ins = await b.client.from('identity_documents').insert({ client_id: B.id, kind: 'address', document_type: 'x', filename: 'x', storage_path: A.id + '/address/x/x.pdf' });
    check("B cannot record a row pointing into A's folder", !!ins.error);
    ins = await a.client.from('identity_documents').insert({ client_id: A.id, kind: 'id', document_type: 'x', filename: 'second.pdf', storage_path: A.id + '/id/' + crypto.randomUUID() + '/second.pdf' });
    check('one document per kind per client (a second "id" row is refused)', !!ins.error && /unique|duplicate/i.test(ins.error.message), ins.error && ins.error.message);

    let su = await a.client.storage.from('identity-documents').createSignedUrl(pathA, 60);
    const back = su.error ? null : await (await fetch(su.data.signedUrl)).text();
    check('the owner reads its own bytes back, byte-identical', !su.error && back === bytes.toString(), su.error && su.error.message);
    su = await b.client.storage.from('identity-documents').createSignedUrl(pathA, 60);
    check("B cannot sign a URL for A's document", !!su.error);
    su = await createClient(url, anonKey).storage.from('identity-documents').createSignedUrl(pathA, 60);
    check('anon cannot either', !!su.error);
    // ★ THE TASK B ENFORCEMENT
    su = await pm.client.storage.from('identity-documents').createSignedUrl(pathA, 60);
    check('★★ A REAL ADMIN SESSION CANNOT SIGN A URL FOR AN IDENTITY DOCUMENT (no admin read policy — the Task B gate is an absent policy, not a hidden button)', !!su.error, JSON.stringify(su.data));
    let dl = await pm.client.storage.from('identity-documents').download(pathA);
    check('★★ ...nor download it', !!dl.error, dl.data ? 'got ' + dl.data.size + ' bytes' : '');
    let ls = await pm.client.storage.from('identity-documents').list(A.id + '/id');
    check("★★ ...nor list the client's folder (empty, not an error)", !ls.error && ls.data.length === 0, JSON.stringify(ls));
    const svc = await admin.storage.from('identity-documents').list(A.id + '/id');
    check('GUARD (non-vacuity): the object genuinely exists — service_role lists it', !svc.error && svc.data.length === 1, JSON.stringify(svc));
    let meta = await pm.client.from('identity_documents').select('kind, document_type, filename, uploaded_at').eq('client_id', A.id);
    check('a PM reads the METADATA row', !meta.error && meta.data.length === 1 && meta.data[0].document_type === 'Government-issued Photo ID');
    meta = await b.client.from('identity_documents').select('id').eq('client_id', A.id);
    check("B cannot read A's metadata", !meta.error && meta.data.length === 0);
    let rm = await a.client.storage.from('identity-documents').remove([pathA]);
    const svc2 = await admin.storage.from('identity-documents').list(A.id + '/id');
    check('★ the owner cannot delete its own identity document (object still present after the attempt)', svc2.data.length === 1, JSON.stringify(rm));
    let del = await a.client.from('identity_documents').delete().eq('id', idA).select();
    const { data: stillRow } = await admin.from('identity_documents').select('id').eq('id', idA).maybeSingle();
    check('★ ...nor its row', !!stillRow && (!del.data || del.data.length === 0));
    let upd = await a.client.from('identity_documents').update({ filename: 'renamed.pdf' }).eq('id', idA).select();
    const { data: stillName } = await admin.from('identity_documents').select('filename').eq('id', idA).single();
    check('...nor update it', stillName.filename === 'passport.pdf' && (!upd.data || upd.data.length === 0));

    // ---- change-request flow for the groups --------------------------------------------
    console.log('\n4. The existing change-request flow, reused for the six groups');
    r = await invoke(url, anonKey, a.session.access_token, 'request-profile-change', { field: 'dateOfBirth', requestedValue: '1990-01-01' });
    check('★ dateOfBirth is NOT requestable (400)', r.status === 400, r.status + ' ' + JSON.stringify(r.body));
    r = await invoke(url, anonKey, a.session.access_token, 'request-profile-change', { field: 'countryOfResidence', requestedValue: 'XX' });
    check('an unknown country → 400', r.status === 400, r.status);
    r = await invoke(url, anonKey, a.session.access_token, 'request-profile-change', { field: 'entityDetails', requestedValue: { name: 'X' } });
    check('entityDetails refused for an Individual account (400)', r.status === 400 && /account type/i.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
    const newFP = { investableAssets: '1m-5m', sourceOfWealth: 'investments', employment: 'Retired' };
    r = await invoke(url, anonKey, a.session.access_token, 'request-profile-change', { field: 'financialProfile', requestedValue: newFP, reason: 'Sold the company.' });
    check('★ a financialProfile change request → 200', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
    check('  current_value was snapshotted server-side from the real column', r.body.currentValue && r.body.currentValue.investableAssets === '250k-1m', JSON.stringify(r.body.currentValue));
    const reqId = r.body.id;
    let ar = await invoke(url, anonKey, pm.session.access_token, 'approve-profile-change', { requestId: reqId });
    check('  PM approves → 200', ar.status === 200, ar.status + ' ' + JSON.stringify(ar.body));
    const { data: afterFP } = await admin.from('client_profiles').select('financial_profile, country_of_residence').eq('client_id', A.id).single();
    // (jsonb does not preserve key order, so compare field by field, and count the keys so an
    // extra or missing one is caught.)
    const fp = afterFP.financial_profile || {};
    check('★ the approved value landed in the real column, wholesale', Object.keys(fp).length === 3 && fp.investableAssets === '1m-5m' && fp.sourceOfWealth === 'investments' && fp.employment === 'Retired', JSON.stringify(fp));
    r = await invoke(url, anonKey, a.session.access_token, 'request-profile-change', { field: 'countryOfResidence', requestedValue: 'NO' });
    check('a countryOfResidence (scalar) request → 200', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
    const { data: pendingRow } = await admin.from('profile_change_requests').select('current_value, requested_value').eq('id', r.body.id).single();
    check('  scalar current/requested stored as plain JSON strings', pendingRow.current_value === 'SE' && pendingRow.requested_value === 'NO', JSON.stringify(pendingRow));
    ar = await invoke(url, anonKey, pm.session.access_token, 'reject-profile-change', { requestId: r.body.id, resolutionNote: 'Please attach proof of the move.' });
    check('  PM rejects → 200', ar.status === 200, ar.status);
    const { data: afterRej } = await admin.from('client_profiles').select('country_of_residence').eq('client_id', A.id).single();
    check('★ a rejection writes nothing (country still SE)', afterRej.country_of_residence === 'SE');
    r = await invoke(url, anonKey, b.session.access_token, 'request-profile-change', { field: 'entityDetails', requestedValue: { name: 'Riverstone Holdings AB', registrationNumber: '556-0001', incorporationCountry: 'Sweden', role: 'Chair' } });
    check('a Business account may request entityDetails', r.status === 200, r.status + ' ' + JSON.stringify(r.body));
    ar = await invoke(url, anonKey, pm.session.access_token, 'approve-profile-change', { requestId: r.body.id });
    const { data: afterEnt } = await admin.from('client_profiles').select('entity_details').eq('client_id', B.id).single();
    check('  approved entityDetails replaces the group wholesale', ar.status === 200 && afterEnt.entity_details.role === 'Chair' && afterEnt.entity_details.name === 'Riverstone Holdings AB', JSON.stringify(afterEnt));

    // ---- get-client-profile ---------------------------------------------------------------
    console.log('\n5. get-client-profile (PM) — onboarding block + identity metadata only');
    r = await invoke(url, anonKey, pm.session.access_token, 'get-client-profile', { clientId: A.id });
    check('200', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
    const ob = r.body && r.body.onboarding;
    check('★ onboarding block carries the real record', ob && ob.dateOfBirth === '1988-04-12' && ob.countryOfResidence === 'SE' && ob.financialProfile.investableAssets === '1m-5m' && !!ob.submittedAt, JSON.stringify(ob));
    check('onboardingAvailable is true now', r.body.onboardingAvailable === true);
    const idd = r.body && r.body.identityDocuments;
    check('★ identityDocuments is metadata only — one entry, no url, no path', Array.isArray(idd) && idd.length === 1 && idd[0].filename === 'passport.pdf' && idd[0].kind === 'id'
      && !('url' in idd[0]) && !('storagePath' in idd[0]) && !('storage_path' in idd[0]) && !JSON.stringify(idd).includes(A.id), JSON.stringify(idd));

    // ---- Gary -------------------------------------------------------------------------------
    console.log('\n6. Gary (seeded before this existed)');
    const { data: gary } = await admin.from('clients').select('id, name').ilike('name', 'Gary Sizemore').maybeSingle();
    if (!gary) {
      console.log('  SKIP  Gary is not seeded on this stack (node seed-client-gary.mjs)');
    } else {
      r = await invoke(url, anonKey, pm.session.access_token, 'get-client-profile', { clientId: gary.id });
      check('Gary renders: legal name present from his seeded profile row', r.status === 200 && r.body.profile.legalName && r.body.profile.legalName.lastName === 'Sizemore', JSON.stringify(r.body.profile));
      check('★ Gary honestly has no onboarding record (submittedAt null, every group null) — nothing invented', r.body.onboarding.submittedAt === null && r.body.onboarding.dateOfBirth === null && r.body.onboarding.riskQuestionnaire === null, JSON.stringify(r.body.onboarding));
      check('Gary has no identity documents on file', Array.isArray(r.body.identityDocuments) && r.body.identityDocuments.length === 0);
    }

    // ---- the backfill helper ----------------------------------------------------------------
    console.log('\n7. split_client_legal_name (the migration backfill)');
    const { data: sp1 } = await admin.rpc('split_client_legal_name', { p_name: 'Diego Fernandez Ruiz' });
    const { data: sp2 } = await admin.rpc('split_client_legal_name', { p_name: 'Acme Corp Inc.' });
    check('a compound name keeps everything before the last word as the first name', sp1.firstName === 'Diego Fernandez' && sp1.lastName === 'Ruiz', JSON.stringify(sp1));
    check('trailing legal suffixes are stripped repeatedly (Acme Corp Inc. → "" / Acme)', sp2.firstName === '' && sp2.lastName === 'Acme', JSON.stringify(sp2));
  } finally {
    for (const o of objects) { const { error } = await admin.storage.from('identity-documents').remove([o]); if (error) console.log('  TEARDOWN WARNING  object ' + o + ': ' + error.message); }
    for (const id of created) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.log('  TEARDOWN WARNING  user ' + id + ': ' + error.message); }
    const { data: leftover } = await admin.storage.from('identity-documents').list('', { limit: 100 });
    const stray = (leftover || []).filter((f) => created.indexOf(f.name) !== -1);
    if (stray.length) console.log('  TEARDOWN WARNING  ' + stray.length + ' test folder(s) still in identity-documents');
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  console.log('ONBOARDING PERSISTENCE: ' + (failed === 0 ? 'PASS' : 'FAIL'));
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => { console.error('\nUNEXPECTED ERROR: ' + (err && err.stack || err)); process.exit(1); });
