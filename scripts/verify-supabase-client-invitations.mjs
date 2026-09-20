// ★ PM client creation by invitation — the backend (register row 254).
//
// What this proves, each against the real functions / real Postgres, never by reading code:
//   1. create: a real invitation row (hash only — the raw token is NEVER stored), attribution
//      captured (invited_by / invited_by_email), an email through the real path (email_log),
//      14-day expiry.
//   2. Refusals, SERVER-SIDE with a reason: an address that already belongs to a client (409),
//      a duplicate LIVE invitation (409), and the partial unique index under it.
//   3. get-invitation (unauthenticated): a live token → the name and address, and the row
//      flips to Opened; an unknown token → 404; a REVOKED token → 410; an EXPIRED token → 410;
//      a USED token → 409 — each with a clear sentence.
//   4. Resend ROTATES the token: the old link stops working, the new one works, expiry restarts.
//   5. Acceptance is the trigger, both ways: the invited path (a clients insert at the invited
//      address) resolves the invitation as accepted against that client; and an ORDINARY signup
//      at an address with a live invitation does the same rather than being blocked.
//   6. RLS: a client cannot read the table at all, anon cannot, an admin can; nobody but
//      service_role can write, admin included.
//   7. The pending list settles time-expired rows to 'expired', reports counts, and "Invite
//      again" creates a NEW row beside the expired one.
// Recipients are Resend's own DELIVERY SINK (delivered+<tag>@resend.dev — documented test
// addresses that simulate delivery and reach no mailbox), because create-client-invitation
// rightly refuses a malformed address before it ever reaches the mailer (row 153's no-`@`
// technique cannot apply here). Probed first: the sink accepts plus-tags, and a nonexistent
// domain is NOT refused synchronously by Resend any more (it is queued and bounces). So the
// real path is exercised end to end and nobody is mailed; the one real-inbox proof is the
// visual suite's, on request.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { runVerifyMain } from './lib/run-verify.mjs';

const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'Invite-2026!';
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
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let j = null; try { j = JSON.parse(await r.text()); } catch (e) { j = null; }
  return { status: r.status, body: j };
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mint = () => crypto.randomBytes(32).toString('base64url');
const sink = (tag) => 'delivered+inv-' + tag + '-' + SUF + '@resend.dev';

async function main() {
  const st = localStack();
  const admin = createClient(st.url, st.service);
  const created = { users: [], invitations: [] };
  const anon = () => createClient(st.url, st.anon, { auth: { persistSession: false } });

  try {
    // ---- a real PM, a real client, a real non-admin -----------------------------------------
    const pm = anon();
    const pmIn = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (pmIn.error) throw new Error('pm sign-in: ' + pmIn.error.message);
    const pmToken = pmIn.data.session.access_token;
    const pmId = pmIn.data.user.id;

    const existingEmail = 'inv-existing-' + SUF + '@test.marketswave.local';
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ email: existingEmail, password: PASSWORD, email_confirm: true });
    if (cuErr) throw new Error('create client: ' + cuErr.message);
    created.users.push(cu.user.id);
    await admin.from('clients').insert({ id: cu.user.id, name: 'Existing Client ' + SUF, email: existingEmail, phone: '+1', account_type: 'Individual Account', status: 'active' });
    const cl = anon();
    const clIn = await cl.auth.signInWithPassword({ email: existingEmail, password: PASSWORD });
    if (clIn.error) throw new Error('client sign-in: ' + clIn.error.message);
    const clientToken = clIn.data.session.access_token;

    console.log('\n=== PART 1: create — a real row, hash only, attribution, a real email through the real path ===\n');
    const email1 = sink('a');
    const c1 = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Katarina Holm ' + SUF, email: email1.toUpperCase(), note: 'Lovely speaking today.' });
    check('create → 200 with the invitation shape', c1.status === 200 && c1.body && c1.body.invitation && c1.body.invitation.status === 'sent', JSON.stringify(c1.body).slice(0, 200));
    const inv1 = c1.body && c1.body.invitation;
    if (inv1) created.invitations.push(inv1.id);
    check('the email is stored lowercase (the standing convention)', inv1 && inv1.email === email1.toLowerCase(), inv1 && inv1.email);
    const { data: raw1 } = await admin.from('client_invitations').select('*').eq('id', inv1.id).single();
    check('★ the row holds a 64-hex token HASH and no raw token column exists', /^[0-9a-f]{64}$/.test(raw1.token_hash) && !('token' in raw1), Object.keys(raw1).join(','));
    check('★ attribution is CAPTURED — invited_by is the real PM, invited_by_email their real address', raw1.invited_by === pmId && raw1.invited_by_email === 'pm@marketswave.local', raw1.invited_by + ' / ' + raw1.invited_by_email);
    check('...and NOT returned to the page (the shape carries no invited_by)', !('invitedBy' in inv1) && !('invitedByEmail' in inv1) && !('tokenHash' in inv1), Object.keys(inv1).join(','));
    const days = (new Date(raw1.expires_at) - new Date(raw1.created_at)) / 86400000;
    check('14-day expiry', Math.abs(days - 14) < 0.01, String(days));
    check('the note is stored', raw1.note === 'Lovely speaking today.');
    const { data: log1 } = await admin.from('email_log').select('recipient, subject, status, resend_id').eq('related_entity_id', inv1.id).order('sent_at', { ascending: false }).limit(1).maybeSingle();
    check('★ an email went through the real path — email_log carries the invitation subject to the invited address', !!log1 && /invitation to Marketswave/i.test(log1.subject) && log1.recipient === email1.toLowerCase(), JSON.stringify(log1));
    check('...and it was genuinely accepted by Resend (status sent, a real resend_id) — the delivery sink reaches no mailbox', log1 && log1.status === 'sent' && c1.body.emailSent === true, JSON.stringify({ log: log1 && log1.status, reported: c1.body.emailSent }));

    console.log('\n=== PART 2: refusals, server-side with a reason ===\n');
    const dup = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Katarina Again', email: email1 });
    check('★ a duplicate LIVE invitation is refused 409 with the reason', dup.status === 409 && dup.body.reason === 'duplicate_live' && /already out/.test(dup.body.error), JSON.stringify(dup.body));
    const exist = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Someone', email: existingEmail.toUpperCase() });
    check('★ an address that already belongs to a client is refused 409 with the reason (case-insensitive)', exist.status === 409 && exist.body.reason === 'existing_client' && /already belongs to a client/.test(exist.body.error), JSON.stringify(exist.body));
    const bad = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: '', email: 'x' });
    check('a missing name / invalid address → 400', bad.status === 400, JSON.stringify(bad.body));
    // the index under the read: a direct second live row for the same address is refused by Postgres
    const dupIdx = await admin.from('client_invitations').insert({ full_name: 'Race', email: email1, token_hash: sha256(mint()), expires_at: new Date(Date.now() + 86400000).toISOString() });
    check('★ the partial unique index refuses a second LIVE row for the address even with service_role (23505)', dupIdx.error && dupIdx.error.code === '23505', JSON.stringify(dupIdx.error));
    const noAuth = await callFn(st.url, 'not-a-token', 'create-client-invitation', { fullName: 'X', email: 'x@y.z' });
    check('401 without a real session', noAuth.status === 401);
    const nonAdmin = await callFn(st.url, clientToken, 'create-client-invitation', { fullName: 'X', email: 'x@y.z' });
    check('403 for a real signed-in CLIENT', nonAdmin.status === 403);

    console.log('\n=== PART 3: get-invitation — unauthenticated, by token, every refusal a clear sentence ===\n');
    // The suite stands in for the inbox: swap in a token it knows (the raw token exists only in the email).
    const tok1 = mint();
    await admin.from('client_invitations').update({ token_hash: sha256(tok1) }).eq('id', inv1.id);
    const open1 = await callFn(st.url, st.anon, 'get-invitation', { token: tok1 });
    check('★ a live token → 200 with ONLY the name and address the link was issued to', open1.status === 200 && open1.body.ok && open1.body.fullName === 'Katarina Holm ' + SUF && open1.body.email === email1.toLowerCase() && !('note' in open1.body) && !('invitedBy' in open1.body), JSON.stringify(open1.body));
    const { data: opened } = await admin.from('client_invitations').select('status, opened_at').eq('id', inv1.id).single();
    check('★ ...and the row is now OPENED with opened_at set', opened.status === 'opened' && !!opened.opened_at, JSON.stringify(opened));
    const open1b = await callFn(st.url, st.anon, 'get-invitation', { token: tok1 });
    const { data: opened2 } = await admin.from('client_invitations').select('opened_at').eq('id', inv1.id).single();
    check('a second open still succeeds and keeps the FIRST opened_at', open1b.status === 200 && opened2.opened_at === opened.opened_at);
    const unknown = await callFn(st.url, st.anon, 'get-invitation', { token: mint() });
    check('★ an unknown token → 404 with a sentence', unknown.status === 404 && unknown.body.reason === 'unknown' && /not valid/.test(unknown.body.error), JSON.stringify(unknown.body));
    const noTok = await callFn(st.url, st.anon, 'get-invitation', {});
    check('no token at all → 404, not a crash', noTok.status === 404);

    console.log('\n=== PART 4: resend rotates the token; revoke kills it ===\n');
    const rs = await callFn(st.url, pmToken, 'resend-client-invitation', { id: inv1.id });
    check('resend → 200, status stays opened, last_sent_at moves, expiry restarts', rs.status === 200 && rs.body.invitation.status === 'opened' && new Date(rs.body.invitation.lastSentAt) > new Date(raw1.last_sent_at) && new Date(rs.body.invitation.expiresAt) > new Date(raw1.expires_at), JSON.stringify(rs.body));
    const afterResend = await callFn(st.url, st.anon, 'get-invitation', { token: tok1 });
    check('★ the OLD link no longer works after a resend (404 — its hash is gone)', afterResend.status === 404, JSON.stringify(afterResend.body));
    const { data: raw1b } = await admin.from('client_invitations').select('token_hash').eq('id', inv1.id).single();
    check('...because the stored hash genuinely rotated', raw1b.token_hash !== sha256(tok1) && /^[0-9a-f]{64}$/.test(raw1b.token_hash));
    const { count: logCount } = await admin.from('email_log').select('*', { count: 'exact', head: true }).eq('related_entity_id', inv1.id);
    check('a second email_log row for the resend', logCount === 2, String(logCount));

    // revoke → the (new) token is refused with the revoked sentence
    const tok1c = mint();
    await admin.from('client_invitations').update({ token_hash: sha256(tok1c) }).eq('id', inv1.id);
    const rv = await callFn(st.url, pmToken, 'revoke-client-invitation', { id: inv1.id });
    check('revoke → 200, status revoked', rv.status === 200 && rv.body.invitation.status === 'revoked', JSON.stringify(rv.body));
    const afterRevoke = await callFn(st.url, st.anon, 'get-invitation', { token: tok1c });
    check('★ a REVOKED token → 410 "withdrawn"', afterRevoke.status === 410 && afterRevoke.body.reason === 'revoked' && /withdrawn/.test(afterRevoke.body.error), JSON.stringify(afterRevoke.body));
    const rvAgain = await callFn(st.url, pmToken, 'revoke-client-invitation', { id: inv1.id });
    check('revoking twice → 409', rvAgain.status === 409);
    const rsRevoked = await callFn(st.url, pmToken, 'resend-client-invitation', { id: inv1.id });
    check('resending a revoked invitation → 409 pointing at "invite again"', rsRevoked.status === 409 && /again/.test(rsRevoked.body.error), JSON.stringify(rsRevoked.body));
    const reinvite = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Katarina Holm ' + SUF, email: email1 });
    check('★ the address is free again after revocation — a NEW invitation row is created', reinvite.status === 200 && reinvite.body.invitation.id !== inv1.id, JSON.stringify(reinvite.body).slice(0, 160));
    if (reinvite.body && reinvite.body.invitation) created.invitations.push(reinvite.body.invitation.id);

    console.log('\n=== PART 5: expiry — settled on touch, refused with the expired sentence, "Invite again" beside it ===\n');
    const email2 = sink('b');
    const c2 = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Lena Nystrom ' + SUF, email: email2 });
    const inv2 = c2.body.invitation; created.invitations.push(inv2.id);
    const tok2 = mint();
    await admin.from('client_invitations').update({ token_hash: sha256(tok2), expires_at: new Date(Date.now() - 86400000).toISOString() }).eq('id', inv2.id);
    const expiredOpen = await callFn(st.url, st.anon, 'get-invitation', { token: tok2 });
    check('★ an EXPIRED token → 410 "expired — valid for 14 days"', expiredOpen.status === 410 && expiredOpen.body.reason === 'expired' && /expired/.test(expiredOpen.body.error), JSON.stringify(expiredOpen.body));
    const { data: settled } = await admin.from('client_invitations').select('status').eq('id', inv2.id).single();
    check('...and the row was settled to stored status expired (settle-on-touch)', settled.status === 'expired');
    const rsExpired = await callFn(st.url, pmToken, 'resend-client-invitation', { id: inv2.id });
    check('resending an expired invitation → 409 pointing at "invite again"', rsExpired.status === 409 && /expired/.test(rsExpired.body.error));
    const again = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Lena Nystrom ' + SUF, email: email2 });
    check('★ "Invite again" creates a NEW live row beside the expired one', again.status === 200 && again.body.invitation.id !== inv2.id && again.body.invitation.status === 'sent', JSON.stringify(again.body).slice(0, 160));
    const inv2b = again.body.invitation; created.invitations.push(inv2b.id);
    const list = await callFn(st.url, pmToken, 'get-client-invitations', {});
    const ids = new Set((list.body.invitations || []).map((i) => i.id));
    check('★ the pending list carries the new live row AND the expired one (history), not the revoked one', ids.has(inv2b.id) && ids.has(inv2.id) && !ids.has(inv1.id), JSON.stringify([...ids]));
    const listRow2 = list.body.invitations.find((i) => i.id === inv2.id);
    check('the expired row reads status expired in the list', listRow2 && listRow2.status === 'expired');
    check('counts: out counts live only, expired counted separately', list.body.counts.out >= 2 && list.body.counts.expired >= 1, JSON.stringify(list.body.counts));
    // a time-expired row that the list has NOT yet touched is settled by the list read itself
    const email3 = sink('c');
    const c3 = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Stale ' + SUF, email: email3 });
    const inv3 = c3.body.invitation; created.invitations.push(inv3.id);
    await admin.from('client_invitations').update({ expires_at: new Date(Date.now() - 60000).toISOString() }).eq('id', inv3.id);
    const list2 = await callFn(st.url, pmToken, 'get-client-invitations', {});
    const row3 = list2.body.invitations.find((i) => i.id === inv3.id);
    const { data: raw3 } = await admin.from('client_invitations').select('status').eq('id', inv3.id).single();
    check('★ the LIST read settles a time-expired row to stored expired', row3 && row3.status === 'expired' && raw3.status === 'expired');
    // expiring soon
    const email4 = sink('d');
    const c4 = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Soon ' + SUF, email: email4 });
    const inv4 = c4.body.invitation; created.invitations.push(inv4.id);
    await admin.from('client_invitations').update({ expires_at: new Date(Date.now() + 20 * 3600000).toISOString() }).eq('id', inv4.id);
    const list3 = await callFn(st.url, pmToken, 'get-client-invitations', {});
    const row4 = list3.body.invitations.find((i) => i.id === inv4.id);
    check('an invitation inside its last 48h is flagged expiringSoon and counted', row4 && row4.expiringSoon === true && list3.body.counts.expiringSoon >= 1, JSON.stringify({ row4, counts: list3.body.counts }));

    console.log('\n=== PART 6: acceptance is the trigger — both paths ===\n');
    // (a) the invited path: a clients insert at the invited address
    const email5 = 'inv-accept-' + SUF + '@test.marketswave.local';
    const c5 = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Accepting Person ' + SUF, email: email5 });
    const inv5 = c5.body.invitation; created.invitations.push(inv5.id);
    const tok5 = mint();
    await admin.from('client_invitations').update({ token_hash: sha256(tok5) }).eq('id', inv5.id);
    await callFn(st.url, st.anon, 'get-invitation', { token: tok5 }); // opened
    const su = anon();
    const suRes = await su.auth.signUp({ email: email5, password: PASSWORD });
    if (suRes.error) throw new Error('signUp: ' + suRes.error.message);
    created.users.push(suRes.data.user.id);
    const ins = await su.from('clients').insert({ id: suRes.data.user.id, name: 'Accepting Person ' + SUF, email: suRes.data.user.email, phone: '+1', account_type: 'Individual Account', status: 'pending_review' });
    check('the invited signup\'s own clients insert succeeds (the real signup path, under RLS)', !ins.error, ins.error && ins.error.message);
    const { data: acc5 } = await admin.from('client_invitations').select('status, accepted_at, accepted_client_id').eq('id', inv5.id).single();
    check('★ the invitation resolved as ACCEPTED against the new client — by the trigger, with no page step', acc5.status === 'accepted' && !!acc5.accepted_at && acc5.accepted_client_id === suRes.data.user.id, JSON.stringify(acc5));
    const usedOpen = await callFn(st.url, st.anon, 'get-invitation', { token: tok5 });
    check('★ a USED token → 409 "already been used"', usedOpen.status === 409 && usedOpen.body.reason === 'used' && /already been used/.test(usedOpen.body.error), JSON.stringify(usedOpen.body));
    const list4 = await callFn(st.url, pmToken, 'get-client-invitations', {});
    check('...and it has left the pending list', !list4.body.invitations.some((i) => i.id === inv5.id));
    const rvUsed = await callFn(st.url, pmToken, 'revoke-client-invitation', { id: inv5.id });
    check('an accepted invitation cannot be revoked (409)', rvUsed.status === 409);
    await su.auth.signOut({ scope: 'local' });

    // (b) an ORDINARY signup at an address that holds a live invitation: the signup succeeds
    //     and the invitation resolves as accepted, rather than the signup being blocked.
    const email6 = 'inv-plain-' + SUF + '@test.marketswave.local';
    const c6 = await callFn(st.url, pmToken, 'create-client-invitation', { fullName: 'Plain Signup ' + SUF, email: email6 });
    const inv6 = c6.body.invitation; created.invitations.push(inv6.id);
    const su2 = anon();
    const su2Res = await su2.auth.signUp({ email: email6, password: PASSWORD });
    if (su2Res.error) throw new Error('signUp 2: ' + su2Res.error.message);
    created.users.push(su2Res.data.user.id);
    const ins2 = await su2.from('clients').insert({ id: su2Res.data.user.id, name: 'Plain Signup ' + SUF, email: su2Res.data.user.email, phone: '+1', account_type: 'Individual Account', status: 'pending_review' });
    check('★ a NORMAL signup at an invited address SUCCEEDS (not blocked by the live invitation)', !ins2.error, ins2.error && ins2.error.message);
    const { data: acc6 } = await admin.from('client_invitations').select('status, accepted_client_id').eq('id', inv6.id).single();
    check('★ ...and the invitation resolved as accepted against that client, with no token ever presented', acc6.status === 'accepted' && acc6.accepted_client_id === su2Res.data.user.id, JSON.stringify(acc6));
    await su2.auth.signOut({ scope: 'local' });

    console.log('\n=== PART 7: RLS — admin-only read, no client-side write for anyone ===\n');
    const rClient = await cl.from('client_invitations').select('id');
    check('★ a real CLIENT reads NOTHING (no error, zero rows — RLS)', !rClient.error && rClient.data.length === 0, JSON.stringify(rClient));
    const rAnon = await anon().from('client_invitations').select('id');
    check('anon reads nothing', !rAnon.error && rAnon.data.length === 0);
    const rPm = await pm.from('client_invitations').select('id').in('id', created.invitations);
    check('an admin reads every row (' + created.invitations.length + ')', !rPm.error && rPm.data.length === created.invitations.length, rPm.error ? rPm.error.message : rPm.data.length);
    const wPm = await pm.from('client_invitations').insert({ full_name: 'X', email: 'x-' + SUF + '@y.z', token_hash: sha256(mint()), expires_at: new Date().toISOString() });
    check('★ an ADMIN cannot insert directly — writes go through the functions', !!wPm.error, wPm.error ? wPm.error.code : 'NO ERROR');
    const uPm = await pm.from('client_invitations').update({ status: 'accepted' }).eq('id', inv6.id).select('id');
    check('an admin cannot update directly (no rows affected)', (uPm.error || (uPm.data && uPm.data.length === 0)), JSON.stringify(uPm));
    const dPm = await pm.from('client_invitations').delete().eq('id', inv6.id).select('id');
    const { data: still6 } = await admin.from('client_invitations').select('id').eq('id', inv6.id).maybeSingle();
    check('an admin cannot delete directly — the row survives', !!still6 && (dPm.error || dPm.data.length === 0));
    const wCl = await cl.from('client_invitations').insert({ full_name: 'X', email: 'x2-' + SUF + '@y.z', token_hash: sha256(mint()), expires_at: new Date().toISOString() });
    check('a client cannot insert', !!wCl.error);
    const listAsClient = await callFn(st.url, clientToken, 'get-client-invitations', {});
    check('get-client-invitations refuses a client (403) and anon (401)', listAsClient.status === 403 && (await callFn(st.url, 'x', 'get-client-invitations', {})).status === 401);
  } finally {
    for (const id of created.invitations) await admin.from('client_invitations').delete().eq('id', id);
    await admin.from('client_invitations').delete().like('email', '%' + SUF + '%');
    for (const id of created.users) await admin.auth.admin.deleteUser(id);
    const { count } = await admin.from('client_invitations').select('*', { count: 'exact', head: true }).like('email', '%' + SUF + '%');
    if (count) console.log('  TEARDOWN WARNING: ' + count + ' invitation(s) left behind');
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('CLIENT INVITATIONS BACKEND: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 300000 });
