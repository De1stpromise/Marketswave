#!/usr/bin/env node
/* ★ PM tool revamp, part 8 (2026-09-17) — Account security, backend.
 *
 * LOCAL STACK ONLY. Node/API-level, per the standing convention.
 *
 * What this proves, and why each one is here rather than assumed:
 *
 *   1. AUTHORIZATION on both new functions — 401 with no token, 403 for a real signed-in
 *      client. Both are driven with real sessions, not constructed tokens.
 *   2. ★ THE SECURITY DEFINER FUNCTIONS ARE UNREACHABLE by anon and by authenticated, proven
 *      by CALLING them with a real client session and with a real ADMIN session rather than by
 *      reading the GRANT. They each take a user id as an argument, so a function reachable by
 *      `authenticated` would let any signed-in user read or end anyone else's sessions — that
 *      is the escalation the REVOKE exists to stop, and a test that reads the grant would not
 *      notice the day someone widens it.
 *   3. SESSIONS ARE REAL — a second real sign-in appears, "This device" is the caller's own
 *      session and no other, and a script user agent is named rather than left "Unknown".
 *   4. ★ REVOCATION IS REAL, MEASURED ON THE OTHER DEVICE. After a revoke, that device's
 *      refresh genuinely fails ("Invalid Refresh Token") — the cascade to auth.refresh_tokens
 *      doing its job. A "the row is gone" assertion would not prove the session was ended.
 *   5. THE SELF-REVOKE REFUSAL is server-side (409), and a session belonging to someone else
 *      is a 404 — proven by passing another real user's real session id, which is the only way
 *      to show the `and user_id = p_user_id` clause is load-bearing.
 *   6. ★ THE PASSWORD-CHANGE CONSEQUENCE the page prints, measured end to end: two devices,
 *      change on one, the other's refresh dead and this one's alive.
 *   7. ★ THE ACTIVITY INVESTIGATION, LOCKED IN. GoTrue records no failed sign-in attempts and
 *      no device or location — the page says so out loud, so the day that stops being true the
 *      page is wrong. These assertions fail if GoTrue ever starts recording either, which is
 *      the point: a claim about absent data has to be re-checked, not remembered.
 */

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

function readLocalStackCredentials() {
  const raw = execSync('npx supabase status -o json', { cwd: '..', encoding: 'utf8' }).replace(/^[^{]*/, '');
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

const fresh = (url, anonKey) => createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function callFn(url, name, token, body) {
  const res = await fetch(url + '/functions/v1/' + name, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* a body-less response is still a status */ }
  return { status: res.status, body: json };
}

async function main() {
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');

  const pmEmail = 'accsec-pm-' + suffix + '@test.marketswave.local';
  const pmPassword = 'AccountSecurity2026!A';
  const otherPmEmail = 'accsec-pm2-' + suffix + '@test.marketswave.local';
  const otherPmPassword = 'AccountSecurity2026!B';
  const clientEmail = 'accsec-client-' + suffix + '@test.marketswave.local';
  const clientPassword = 'AccountSecurity2026!C';

  const created = [];
  try {
    // ---- real accounts ---------------------------------------------------------------------
    async function makeUser(email, password, isAdmin) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw new Error('could not create ' + email + ': ' + error.message);
      created.push(data.user.id);
      if (isAdmin) {
        const { error: roleErr } = await admin.from('user_roles').upsert({ user_id: data.user.id, is_admin: true });
        if (roleErr) throw new Error('could not grant admin to ' + email + ': ' + roleErr.message);
      }
      return data.user;
    }

    const pm = await makeUser(pmEmail, pmPassword, true);
    const otherPm = await makeUser(otherPmEmail, otherPmPassword, true);
    const clientUser = await makeUser(clientEmail, clientPassword, false);
    check('GUARD: three genuinely different real accounts exist', new Set([pm.id, otherPm.id, clientUser.id]).size === 3);

    console.log('\n1. Authorization on both new functions\n');

    for (const fn of ['get-account-security', 'revoke-pm-session']) {
      const anonCall = await callFn(url, fn, null, {});
      check(fn + ': an unauthenticated call is refused 401', anonCall.status === 401, String(anonCall.status));
    }

    const clientSession = fresh(url, anonKey);
    const clientSignIn = await clientSession.auth.signInWithPassword({ email: clientEmail, password: clientPassword });
    if (clientSignIn.error) throw new Error('client sign-in failed: ' + clientSignIn.error.message);
    const clientToken = clientSignIn.data.session.access_token;

    for (const fn of ['get-account-security', 'revoke-pm-session']) {
      const call = await callFn(url, fn, clientToken, { scope: 'others' });
      check(fn + ': a real signed-in CLIENT is refused 403', call.status === 403, String(call.status) + ' ' + JSON.stringify(call.body));
    }

    console.log('\n2. ★ The SECURITY DEFINER functions are unreachable by anon and by authenticated\n');

    // ★ CALLED, not read off the GRANT. Each of these takes a user id, so reachability by
    // `authenticated` would be a real privilege escalation: any signed-in user could read or
    // end another user's sessions by passing their id. The ADMIN is tested too — being a PM
    // does not make the raw function callable; only the Edge Function's service role does.
    const anonClient = fresh(url, anonKey);
    const pmDirect = fresh(url, anonKey);
    const pmDirectSignIn = await pmDirect.auth.signInWithPassword({ email: pmEmail, password: pmPassword });
    if (pmDirectSignIn.error) throw new Error('PM sign-in failed: ' + pmDirectSignIn.error.message);

    const rpcs = [
      ['pm_auth_sessions', { p_user_id: pm.id }],
      ['pm_auth_activity', { p_user_id: pm.id, p_days: 30, p_limit: 10 }],
      ['pm_revoke_session', { p_user_id: pm.id, p_session_id: pm.id }],
      ['pm_revoke_other_sessions', { p_user_id: pm.id, p_keep_session_id: null }]
    ];
    for (const [name, args] of rpcs) {
      const asAnon = await anonClient.rpc(name, args);
      check('anon cannot execute public.' + name + '()', !!asAnon.error, JSON.stringify(asAnon.data));
      const asPm = await pmDirect.rpc(name, args);
      check('a real signed-in ADMIN cannot execute public.' + name + '() directly either', !!asPm.error, JSON.stringify(asPm.data));
    }
    // Non-vacuity: service_role genuinely CAN, so the four refusals above are about the grant
    // and not about the functions being broken or absent.
    const asService = await admin.rpc('pm_auth_sessions', { p_user_id: pm.id });
    check('NON-VACUITY: service_role genuinely can execute it, so the refusals are the grant and not a broken function',
      !asService.error && Array.isArray(asService.data), asService.error && asService.error.message);

    console.log('\n3. Sessions are real, and "This device" is the caller\'s own\n');

    // A second real "device" for this same PM.
    const deviceB = fresh(url, anonKey);
    const bSignIn = await deviceB.auth.signInWithPassword({ email: pmEmail, password: pmPassword });
    if (bSignIn.error) throw new Error('device B sign-in failed: ' + bSignIn.error.message);

    const pmToken = pmDirectSignIn.data.session.access_token;
    const pmClaims = JSON.parse(Buffer.from(pmToken.split('.')[1], 'base64').toString());
    const bClaims = JSON.parse(Buffer.from(bSignIn.data.session.access_token.split('.')[1], 'base64').toString());
    check('GUARD: the two devices hold genuinely different sessions', pmClaims.session_id !== bClaims.session_id);

    const view = await callFn(url, 'get-account-security', pmToken, {});
    check('the PM can read their own account security', view.status === 200, String(view.status) + ' ' + JSON.stringify(view.body));
    const payload = view.body;
    check('both real sessions are listed', payload.sessions.total >= 2, String(payload.sessions.total));
    const currentRows = payload.sessions.rows.filter((r) => r.isCurrent);
    check('exactly ONE row is marked "This device"', currentRows.length === 1, String(currentRows.length));
    check('and it is the caller\'s own session, from their own token\'s session_id claim',
      currentRows[0] && currentRows[0].id === pmClaims.session_id, currentRows[0] && currentRows[0].id);
    const bRow = payload.sessions.rows.find((r) => r.id === bClaims.session_id);
    check('the OTHER device is listed and is not marked "This device"', !!bRow && bRow.isCurrent === false);
    check('the payload names the account being read', payload.account.email === pmEmail, payload.account.email);

    // ★ A non-browser user agent is NAMED. "Unknown device · Unknown browser" for a `node`
    // session is accurate and useless, and on a security panel "unknown" invites alarm where
    // the honest answer is mundane.
    check('a script user agent is named as a script rather than left "Unknown"',
      payload.sessions.rows.every((r) => r.label && r.label !== 'Unknown client' ? true : r.userAgent === null),
      JSON.stringify(payload.sessions.rows.map((r) => [r.userAgent, r.label])));
    check('the sessions in this run are recognised as scripts', bRow && bRow.isScript === true, bRow && JSON.stringify([bRow.userAgent, bRow.label]));

    console.log('\n4. ★ Revocation is real — measured on the other device, not inferred from a missing row\n');

    const bRefreshToken = bSignIn.data.session.refresh_token;
    const revoke = await callFn(url, 'revoke-pm-session', pmToken, { sessionId: bClaims.session_id });
    check('revoking the other device returns 200', revoke.status === 200 && revoke.body.revoked === 1, JSON.stringify(revoke.body));

    const bAfter = fresh(url, anonKey);
    const bRefresh = await bAfter.auth.refreshSession({ refresh_token: bRefreshToken });
    check('★ the revoked device genuinely cannot refresh — its refresh token is gone with the session',
      !!bRefresh.error, bRefresh.error && bRefresh.error.message);

    const aStillAlive = fresh(url, anonKey);
    const aRefresh = await aStillAlive.auth.refreshSession({ refresh_token: pmDirectSignIn.data.session.refresh_token });
    check('this device is untouched and can still refresh', !aRefresh.error, aRefresh.error && aRefresh.error.message);

    console.log('\n5. Refusals: the current session, and a session that is not yours\n');

    const selfRevoke = await callFn(url, 'revoke-pm-session', pmToken, { sessionId: pmClaims.session_id });
    check('revoking the session you are USING is refused 409 by the server, not only hidden in the UI',
      selfRevoke.status === 409 && /Log out/i.test(selfRevoke.body.error || ''), JSON.stringify(selfRevoke.body));

    // ★ Another real user's real session id. This is the only way to show that
    // `and user_id = p_user_id` is load-bearing rather than decoration.
    const otherSession = fresh(url, anonKey);
    const otherSignIn = await otherSession.auth.signInWithPassword({ email: otherPmEmail, password: otherPmPassword });
    if (otherSignIn.error) throw new Error('other PM sign-in failed: ' + otherSignIn.error.message);
    const otherClaims = JSON.parse(Buffer.from(otherSignIn.data.session.access_token.split('.')[1], 'base64').toString());
    const foreign = await callFn(url, 'revoke-pm-session', pmToken, { sessionId: otherClaims.session_id });
    check('★ a session belonging to ANOTHER user is a 404 — the user-id clause is load-bearing',
      foreign.status === 404, String(foreign.status) + ' ' + JSON.stringify(foreign.body));
    const otherStillAlive = await fresh(url, anonKey).auth.refreshSession({ refresh_token: otherSignIn.data.session.refresh_token });
    check('...and that other user\'s session is provably untouched', !otherStillAlive.error, otherStillAlive.error && otherStillAlive.error.message);

    const noArgs = await callFn(url, 'revoke-pm-session', pmToken, {});
    check('a call naming no session and no scope is refused 400', noArgs.status === 400, String(noArgs.status));

    console.log('\n6. "Sign out everywhere else"\n');

    const deviceC = fresh(url, anonKey);
    const cSignIn = await deviceC.auth.signInWithPassword({ email: pmEmail, password: pmPassword });
    if (cSignIn.error) throw new Error('device C sign-in failed: ' + cSignIn.error.message);
    const deviceD = fresh(url, anonKey);
    const dSignIn = await deviceD.auth.signInWithPassword({ email: pmEmail, password: pmPassword });
    if (dSignIn.error) throw new Error('device D sign-in failed: ' + dSignIn.error.message);

    const others = await callFn(url, 'revoke-pm-session', pmToken, { scope: 'others' });
    check('signing out everywhere else reports the real number ended', others.status === 200 && others.body.revoked >= 2, JSON.stringify(others.body));
    const cRefresh = await fresh(url, anonKey).auth.refreshSession({ refresh_token: cSignIn.data.session.refresh_token });
    const dRefresh = await fresh(url, anonKey).auth.refreshSession({ refresh_token: dSignIn.data.session.refresh_token });
    check('both other devices are genuinely ended', !!cRefresh.error && !!dRefresh.error);
    const afterOthers = await callFn(url, 'get-account-security', pmToken, {});
    check('only this device remains, and it is still marked "This device"',
      afterOthers.body.sessions.total === 1 && afterOthers.body.sessions.rows[0].isCurrent === true,
      JSON.stringify(afterOthers.body.sessions.rows.map((r) => [r.id, r.isCurrent])));

    console.log('\n7. ★ The password-change consequence the page prints, measured\n');

    // Two devices again, then change the password on one.
    const pw1 = fresh(url, anonKey);
    const pw1SignIn = await pw1.auth.signInWithPassword({ email: pmEmail, password: pmPassword });
    const pw2 = fresh(url, anonKey);
    const pw2SignIn = await pw2.auth.signInWithPassword({ email: pmEmail, password: pmPassword });
    if (pw1SignIn.error || pw2SignIn.error) throw new Error('password-consequence sign-ins failed');

    const before = await admin.rpc('pm_auth_sessions', { p_user_id: pm.id });
    check('GUARD: more than one session exists before the change', before.data.length >= 2, String(before.data.length));

    const newPassword = 'AccountSecurity2026!Changed';
    const { error: updateErr } = await pw1.auth.updateUser({ password: newPassword });
    check('the real password change succeeds', !updateErr, updateErr && updateErr.message);

    const after = await admin.rpc('pm_auth_sessions', { p_user_id: pm.id });
    check('★ every other session is ended by the change', after.data.length === 1, String(after.data.length));
    const pw2Refresh = await fresh(url, anonKey).auth.refreshSession({ refresh_token: pw2SignIn.data.session.refresh_token });
    check('★ the other device genuinely cannot refresh after the change — the sentence the page prints',
      !!pw2Refresh.error, pw2Refresh.error && pw2Refresh.error.message);
    const pw1Refresh = await fresh(url, anonKey).auth.refreshSession({ refresh_token: pw1SignIn.data.session.refresh_token });
    check('★ ...and THIS device stays signed in, which is the other half of that sentence',
      !pw1Refresh.error, pw1Refresh.error && pw1Refresh.error.message);

    console.log('\n8. ★ The activity panel is GONE (register row 239) — and why it is gone stays under test\n');

    // ★ Removed 2026-09-17. Its only source, auth.audit_log_entries, is populated on the local
    // stack and NOT AT ALL on the hosted project (a raw count(*) there is 0 in total, still 0
    // seconds after a real sign-in), so the panel was permanently empty in production while every
    // assertion about it passed here. The assertions below are what replaces the old ones: the
    // payload no longer carries the field at all, the sessions list is the sign-in history that
    // DOES exist on the deployment target, and the local-only investigation that motivates row
    // 240 (GoTrue records no failed attempts even where it records anything) is kept as a guard
    // on the raw RPC — which still exists in the database, unused, and must stay unreachable.
    const pwToken = pw1SignIn.data.session.access_token;
    // The change above reissued the session, so read with a token the change did not invalidate.
    const pwAfter = await pw1.auth.getSession();
    const liveToken = (pwAfter.data.session && pwAfter.data.session.access_token) || pwToken;
    const secView = await callFn(url, 'get-account-security', liveToken, {});
    check('the payload reads back for this account', secView.status === 200, String(secView.status) + ' ' + JSON.stringify(secView.body));
    check('★ the payload carries NO activity field — the source does not exist on the deployment target',
      !('activity' in secView.body), JSON.stringify(Object.keys(secView.body)));
    check('...and the sessions list is the sign-in history that DOES exist there: this account\'s own live sign-in, with its moment',
      secView.body.sessions.rows.some((r) => r.isCurrent && typeof r.createdAt === 'string' && !isNaN(Date.parse(r.createdAt))),
      JSON.stringify(secView.body.sessions.rows.map((r) => [r.isCurrent, r.createdAt])));

    // The investigation behind row 240, kept live on the raw (service_role-only) RPC: even on
    // the one stack where GoTrue writes this table at all, a failed attempt leaves nothing.
    const { data: failRows, error: failErr } = await admin.rpc('pm_auth_activity', { p_user_id: pm.id, p_days: 30, p_limit: 100 });
    check('GUARD: the raw activity RPC still works for service_role (it was left in place, not dropped)', !failErr && Array.isArray(failRows), failErr && failErr.message);
    check('GUARD: on the LOCAL stack the audit table is genuinely written — this account\'s own sign-in is in it (if this fails, the local/hosted split this section documents has changed)',
      failRows.some((r) => r.action === 'login'), JSON.stringify(failRows.slice(0, 3).map((r) => r.action)));
    check('★ GoTrue records NO failed/invalid/denied action for this account — the row-240 motivation, still true',
      failRows.every((r) => !/fail|invalid|denied/i.test(r.action || '')),
      JSON.stringify(failRows.map((r) => r.action).filter((a) => /fail|invalid|denied/i.test(a || ''))));
    const wrong = await fresh(url, anonKey).auth.signInWithPassword({ email: pmEmail, password: 'definitely-not-the-password' });
    check('GUARD: a real wrong-password attempt genuinely failed', !!wrong.error, wrong.error && wrong.error.message);
    const { data: afterWrong } = await admin.rpc('pm_auth_activity', { p_user_id: pm.id, p_days: 30, p_limit: 100 });
    check('★ ...and it left NO trace even here — the failed attempts only a self-recorded history (row 240) could capture',
      afterWrong.length === failRows.length, JSON.stringify({ before: failRows.length, after: afterWrong.length }));

  } finally {
    // Teardown: the auth user goes first, so its sessions and audit rows cascade with it.
    for (const id of created) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log('  TEARDOWN WARNING  could not delete ' + id + ': ' + error.message);
    }
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.\n');
  console.log('ACCOUNT SECURITY: ' + (failed === 0 ? 'PASS' : 'FAIL'));
  // ★ An explicit exit, on BOTH paths. A real Supabase client schedules an auto-refresh
  // timer that Node's "exit when the event loop empties" never reaches, so a suite without
  // this hangs indefinitely AFTER printing a clean result (register row 182).
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('VERIFY FAILED WITH AN ERROR: ' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
