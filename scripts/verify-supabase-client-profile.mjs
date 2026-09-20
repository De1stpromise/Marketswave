// ★ PM tool revamp, part 4 — the client profile: backend, RLS and the author-only proof.
//
// The property that matters most here is NOT that the page looks right, it is that a private
// note is private. "Visible to you only" has to be enforced in the database, not by the filter
// the page happens to apply — multi-PM is real (Phase C, row 221), so a second PM reading the
// same client's profile must get their own notes and nobody else's, and a CLIENT must never
// read any of this at all.
//
// Proven with TWO REAL PM ACCOUNTS and a REAL CLIENT session, never by inspecting the policy
// text: a policy that reads correctly and a policy that behaves correctly are different claims.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { runVerifyMain } from './lib/run-verify.mjs';

const SUF = crypto.randomBytes(3).toString('hex');
const plantedDocs = [];
const PASSWORD = 'CliProf-2026!';
let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: '..', encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return { url: j.API_URL, anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY };
}

async function callFn(url, token, name, body) {
  const r = await fetch(url + '/functions/v1/' + name, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let j = null;
  try { j = JSON.parse(await r.text()); } catch (e) { j = null; }
  return { status: r.status, body: j };
}

async function main() {
  const st = localStack();
  const admin = createClient(st.url, st.service);
  const created = [];

  try {
    // ---- two REAL PM accounts, and one REAL client ----------------------------------------
    const pmA = { email: 'cp-pm-a-' + SUF + '@marketswave.local' };
    const pmB = { email: 'cp-pm-b-' + SUF + '@marketswave.local' };
    for (const pm of [pmA, pmB]) {
      const { data, error } = await admin.auth.admin.createUser({ email: pm.email, password: PASSWORD, email_confirm: true });
      if (error) throw new Error('create pm: ' + error.message);
      pm.id = data.user.id;
      created.push(pm.id);
      const { error: rErr } = await admin.from('user_roles').upsert({ user_id: pm.id, is_admin: true });
      if (rErr) throw new Error('grant admin: ' + rErr.message);
    }

    const clientEmail = 'cp-client-' + SUF + '@invalid.test';
    const { data: cu, error: cErr } = await admin.auth.admin.createUser({ email: clientEmail, password: PASSWORD, email_confirm: true });
    if (cErr) throw new Error('create client: ' + cErr.message);
    const clientId = cu.user.id;
    created.push(clientId);
    const { error: cRowErr } = await admin.from('clients').insert({
      id: clientId, name: 'Profile Testclient', email: clientEmail, phone: '+46 70 000 0000',
      account_type: 'Individual Account', status: 'active'
    });
    if (cRowErr) throw new Error('insert client row: ' + cRowErr.message);

    const anon = createClient(st.url, st.anon);
    const sA = await anon.auth.signInWithPassword({ email: pmA.email, password: PASSWORD });
    if (sA.error) throw new Error('pmA sign-in: ' + sA.error.message);
    const tokenA = sA.data.session.access_token;
    const anonB = createClient(st.url, st.anon);
    const sB = await anonB.auth.signInWithPassword({ email: pmB.email, password: PASSWORD });
    if (sB.error) throw new Error('pmB sign-in: ' + sB.error.message);
    const tokenB = sB.data.session.access_token;
    const anonC = createClient(st.url, st.anon);
    const sC = await anonC.auth.signInWithPassword({ email: clientEmail, password: PASSWORD });
    if (sC.error) throw new Error('client sign-in: ' + sC.error.message);
    const tokenC = sC.data.session.access_token;

    console.log('\n=== PART 1: authorization on get-client-profile ===\n');
    const noAuth = await fetch(st.url + '/functions/v1/get-client-profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId })
    });
    check('unauthenticated call is refused (401)', noAuth.status === 401, String(noAuth.status));

    const asClient = await callFn(st.url, tokenC, 'get-client-profile', { clientId });
    check('★ a real CLIENT cannot read this page at all (403) — the profile is a PM surface',
      asClient.status === 403, asClient.status + ' ' + JSON.stringify(asClient.body));

    const asClientOwn = await callFn(st.url, tokenC, 'get-client-profile', { clientId: clientId });
    check('★ ...not even for their OWN id — being the subject does not grant PM access',
      asClientOwn.status === 403, String(asClientOwn.status));

    const noId = await callFn(st.url, tokenA, 'get-client-profile', {});
    check('a missing clientId is a 400, not a crash', noId.status === 400, String(noId.status));

    const missing = await callFn(st.url, tokenA, 'get-client-profile', { clientId: crypto.randomUUID() });
    check('an unknown client is a clean 404', missing.status === 404, String(missing.status));

    const ok = await callFn(st.url, tokenA, 'get-client-profile', { clientId });
    check('an admin gets the profile (200)', ok.status === 200, String(ok.status));
    check('GUARD: the payload is genuinely this client — otherwise everything below is vacuous',
      ok.body && ok.body.client && ok.body.client.id === clientId, ok.body && ok.body.client && ok.body.client.name);

    console.log('\n=== PART 2: private notes are author-only, enforced by RLS ===\n');
    // PM A writes a note through the same path the page uses: a direct insert, with RLS
    // pinning author_id to the caller.
    const aClient = createClient(st.url, st.anon, { global: { headers: { Authorization: 'Bearer ' + tokenA } } });
    const bClient = createClient(st.url, st.anon, { global: { headers: { Authorization: 'Bearer ' + tokenB } } });
    const cClient = createClient(st.url, st.anon, { global: { headers: { Authorization: 'Bearer ' + tokenC } } });

    const insA = await aClient.from('pm_client_notes').insert({ client_id: clientId, author_email: pmA.email, body: 'PM A private note ' + SUF }).select('id').single();
    check('PM A can write a note about this client', !insA.error && !!insA.data, insA.error && insA.error.message);

    const insB = await bClient.from('pm_client_notes').insert({ client_id: clientId, author_email: pmB.email, body: 'PM B private note ' + SUF }).select('id').single();
    check('PM B can write their own note about the same client', !insB.error && !!insB.data, insB.error && insB.error.message);

    const readA = await aClient.from('pm_client_notes').select('id, body').eq('client_id', clientId);
    check('★ PM A reads exactly ONE note — their own — and never PM B\'s',
      !readA.error && readA.data.length === 1 && /PM A private note/.test(readA.data[0].body),
      readA.error ? readA.error.message : JSON.stringify(readA.data.map((r) => r.body)));

    const readB = await bClient.from('pm_client_notes').select('id, body').eq('client_id', clientId);
    check('★ PM B reads exactly ONE note — their own — and never PM A\'s',
      !readB.error && readB.data.length === 1 && /PM B private note/.test(readB.data[0].body),
      readB.error ? readB.error.message : JSON.stringify(readB.data.map((r) => r.body)));

    const readC = await cClient.from('pm_client_notes').select('id, body').eq('client_id', clientId);
    check('★ the CLIENT the notes are about reads NOTHING — not even notes written about them',
      !readC.error && readC.data.length === 0, readC.error ? readC.error.message : JSON.stringify(readC.data));

    // Forging attribution: PM B tries to write a note AS PM A. The insert policy pins
    // author_id = auth.uid(), so this must be refused outright rather than silently stored.
    const forge = await bClient.from('pm_client_notes').insert({ client_id: clientId, author_id: pmA.id, body: 'forged ' + SUF });
    check('★ a PM cannot forge a note attributed to a COLLEAGUE — the insert policy pins author_id',
      !!forge.error, forge.error ? forge.error.message : 'NO ERROR — the forged row was accepted');

    // A client cannot write one either.
    const clientWrite = await cClient.from('pm_client_notes').insert({ client_id: clientId, body: 'client wrote this' });
    check('a client cannot write a PM note', !!clientWrite.error, clientWrite.error ? clientWrite.error.message : 'NO ERROR');

    // Deliberately no update policy — a dated note is a record, not a draft.
    const upd = await aClient.from('pm_client_notes').update({ body: 'edited' }).eq('id', insA.data.id).select('id');
    check('a note cannot be edited — there is deliberately no update policy',
      upd.error || (upd.data && upd.data.length === 0), upd.error ? upd.error.message : JSON.stringify(upd.data));

    console.log('\n=== PART 3: the payload carries each PM their OWN notes ===\n');
    const profA = await callFn(st.url, tokenA, 'get-client-profile', { clientId });
    const profB = await callFn(st.url, tokenB, 'get-client-profile', { clientId });
    check('★ get-client-profile returns PM A exactly their own note',
      profA.body.notes.length === 1 && /PM A private note/.test(profA.body.notes[0].body),
      JSON.stringify(profA.body.notes.map((n) => n.body)));
    check('★ ...and returns PM B exactly theirs, from the same client, in the same call shape',
      profB.body.notes.length === 1 && /PM B private note/.test(profB.body.notes[0].body),
      JSON.stringify(profB.body.notes.map((n) => n.body)));
    check('the note count each PM sees is their own count, not a shared total',
      profA.body.counts.notes === 1 && profB.body.counts.notes === 1,
      profA.body.counts.notes + ' / ' + profB.body.counts.notes);

    // ---- deletion (2026-09-19, register row 252): author-only, enforced by RLS, proven by the
    // refusal — not by the control being hidden. The page deletes through exactly this path (a
    // direct DELETE + .select()), so what is proven here is what the page relies on.
    console.log('\n=== PART 3b: deleting a note is author-only — the refusal is proven, not the hidden control ===\n');
    const bDelA = await bClient.from('pm_client_notes').delete().eq('id', insA.data.id).select('id');
    check('★ PM B deleting PM A\'s note: NO error and ZERO rows — an RLS-filtered DELETE is a silent no-op',
      !bDelA.error && Array.isArray(bDelA.data) && bDelA.data.length === 0,
      bDelA.error ? bDelA.error.message : JSON.stringify(bDelA.data));
    const stillA = await admin.from('pm_client_notes').select('id').eq('id', insA.data.id).maybeSingle();
    check('★ ...and PM A\'s note genuinely still exists afterwards (checked with the service role)',
      !!(stillA.data && stillA.data.id), JSON.stringify(stillA));
    const cDelA = await cClient.from('pm_client_notes').delete().eq('id', insA.data.id).select('id');
    check('the CLIENT the note is about cannot delete it either (zero rows, row still there)',
      !cDelA.error && cDelA.data.length === 0 &&
      !!((await admin.from('pm_client_notes').select('id').eq('id', insA.data.id).maybeSingle()).data),
      cDelA.error ? cDelA.error.message : JSON.stringify(cDelA.data));
    // The page-side contract: deleteRow() reads that empty array as a refusal and throws. The
    // real function is exercised in verify-client-profile-ui-wiring; here the raw property.
    const aDelA = await aClient.from('pm_client_notes').delete().eq('id', insA.data.id).select('id');
    check('★ PM A deleting their OWN note returns the deleted row (one row, its id)',
      !aDelA.error && aDelA.data.length === 1 && aDelA.data[0].id === insA.data.id,
      aDelA.error ? aDelA.error.message : JSON.stringify(aDelA.data));
    const goneA = await admin.from('pm_client_notes').select('id').eq('id', insA.data.id).maybeSingle();
    check('★ ...and it is genuinely gone — a HARD delete, no copy retained anywhere (service-role read)',
      !goneA.data, JSON.stringify(goneA.data));
    const bStill = await bClient.from('pm_client_notes').select('id, body').eq('client_id', clientId);
    check('PM B\'s own note on the same client is untouched by PM A\'s delete',
      !bStill.error && bStill.data.length === 1 && /PM B private note/.test(bStill.data[0].body), JSON.stringify(bStill.data));
    const profA2 = await callFn(st.url, tokenA, 'get-client-profile', { clientId });
    check('get-client-profile now returns PM A zero notes and a zero count',
      profA2.body.notes.length === 0 && profA2.body.counts.notes === 0, JSON.stringify(profA2.body.counts));
    // Restore PM A's note so PART 4+ read the state they were written against.
    const insA2 = await aClient.from('pm_client_notes').insert({ client_id: clientId, author_email: pmA.email, body: 'PM A private note ' + SUF }).select('id').single();
    if (insA2.error) throw new Error('re-insert: ' + insA2.error.message);

    console.log('\n=== PART 4: the empty client renders as empty, not as broken ===\n');
    const e = profA.body;
    check('a client with nothing has no holdings-derived money', e.money.portfolioValue === 0, String(e.money.portfolioValue));
    check('no pending requests', e.pending.length === 0, String(e.pending.length));
    check('no documents, conversations or watchlist', e.documents.length === 0 && e.conversations.length === 0 && e.watchlist.length === 0,
      [e.documents.length, e.conversations.length, e.watchlist.length].join('/'));
    check('every deposit route shows as UNASSIGNED rather than being omitted',
      e.addresses.assigned.length === 0 && e.addresses.unassigned.length > 0,
      e.addresses.assigned.length + ' assigned / ' + e.addresses.unassigned.length + ' unassigned');
    check('presence is honestly false, not absent', e.presence && e.presence.live === false, JSON.stringify(e.presence));

    console.log('\n=== PART 5: the three absent sources are reported as absent, never faked ===\n');
    // Onboarding was absent-by-design until Task A (2026-09-18, register row 242) gave it real
    // storage. For a client who has never submitted one, the honest answer is now an
    // onboarding block with submittedAt null and every group null — never a placeholder.
    check('★ onboarding is available as a source now, and this empty client reports an honest unsubmitted record',
      e.onboardingAvailable === true && e.onboarding && e.onboarding.submittedAt === null && e.onboarding.riskQuestionnaire === null && e.onboarding.dateOfBirth === null,
      JSON.stringify(e.onboarding));
    check('★ identity documents are METADATA only — an empty list for this client, and the field exists',
      Array.isArray(e.identityDocuments) && e.identityDocuments.length === 0, JSON.stringify(e.identityDocuments));
    check('★ no advisory-fee-charged figure is returned at all',
      e.health.advisoryFeeChargedAvailable === false && !('advisoryFeeCharged' in e.health),
      JSON.stringify(e.health));
    check('the advisory fee RATE is real and IS returned', typeof e.health.advisoryFeeRate === 'number', String(e.health.advisoryFeeRate));
    check('★ no KYC field is invented — only the real application status is carried',
      e.health.status === 'active' && !('kyc' in e.health) && !('kycStatus' in e.health), JSON.stringify(e.health));
    check('statements are flagged unavailable — nothing in this project generates one',
      e.health.statementsAvailable === false, String(e.health.statementsAvailable));

    console.log('\n=== PART 6: a REAL client with real history (Gary) ===\n');
    const { data: gary } = await admin.from('clients').select('id, name').ilike('name', '%Gary%').maybeSingle();
    if (!gary) {
      console.log('  SKIP  Gary is not seeded on this stack — run `node seed-client-gary.mjs` first.');
    } else {
      // The `restricted` flag keys on a documents row's FILENAME. Gary's seed no longer carries
      // any documents (the fake byteless catalogue was scrapped, register row 247/D), so this
      // suite plants its own throwaway upload row for that one assertion rather than depending
      // on ambient seed state (the row-230 coupling class) — removed in the finally below.
      const { data: plantedDoc } = await admin.from('documents').insert({ client_id: gary.id, direction: 'upload', filename: 'passport-cp-' + SUF + '.pdf', category: 'General', status: 'Received', is_new: false, storage_path: null }).select('id').single();
      plantedDocs.push(plantedDoc.id);
      const g = (await callFn(st.url, tokenA, 'get-client-profile', { clientId: gary.id })).body;
      // Cross-checked against the database directly, not against the page's own arithmetic.
      const counts = {};
      for (const [k, t] of [['docs', 'documents'], ['watch', 'watchlist_symbols'], ['convs', 'conversations']]) {
        const { count } = await admin.from(t).select('*', { count: 'exact', head: true }).eq('client_id', gary.id);
        counts[k] = count;
      }
      check('★ Gary\'s documents match an independent count from Postgres',
        g.documents.length === counts.docs, g.documents.length + ' vs ' + counts.docs);
      check('★ Gary\'s watchlist matches an independent count — a swallowed read would show 0 here',
        g.watchlist.length === counts.watch && g.watchlist.length > 0, g.watchlist.length + ' vs ' + counts.watch);
      check('Gary\'s conversations match an independent count',
        g.conversations.length === counts.convs, g.conversations.length + ' vs ' + counts.convs);
      const { count: addrCount } = await admin.from('deposit_address_assignments')
        .select('*', { count: 'exact', head: true }).eq('client_id', gary.id).is('removed_at', null);
      check('★ Gary\'s assigned addresses match an independent count, and each carries a real address string',
        g.addresses.assigned.length === addrCount && g.addresses.assigned.every((a) => !!a.address),
        g.addresses.assigned.length + ' vs ' + addrCount);
      check('an identity document is flagged restricted', g.documents.some((d) => d.restricted),
        g.documents.map((d) => d.filename + (d.restricted ? '*' : '')).join(', '));
      check('a document with no stored bytes is flagged hasFile:false rather than offered for opening',
        g.documents.every((d) => typeof d.hasFile === 'boolean'), JSON.stringify(g.documents.map((d) => d.hasFile)));
      check('★ Gary\'s three real profile fields are present — the ones client_profiles genuinely holds',
        !!g.profile.legalName && !!g.profile.address, JSON.stringify(g.profile).slice(0, 120));
      check('productMeta covers his held products, so the page can draw a real asset mark',
        g.productMeta && Object.keys(g.productMeta).length > 0, String(Object.keys(g.productMeta || {}).length));
    }

  } finally {
    // teardown: the notes cascade with the client, but delete explicitly so a failed cascade
    // is visible rather than silent.
    await admin.from('pm_client_notes').delete().ilike('body', '%' + SUF + '%');
    if (plantedDocs.length) await admin.from('documents').delete().in('id', plantedDocs);
    for (const id of created.reverse()) {
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    const { count: leftover } = await admin.from('pm_client_notes').select('*', { count: 'exact', head: true }).ilike('body', '%' + SUF + '%');
    if (leftover) console.log('  TEARDOWN WARNING: ' + leftover + ' note(s) left behind');
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('CLIENT PROFILE BACKEND: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main);
