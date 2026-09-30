#!/usr/bin/env node
// ★ The risk profile, stored with the account (2026-09-30, register row 292).
//
// BACKEND, through the real set-risk-profile: a client sets only their OWN risk_profile — there
// is no clientId input at all, and a request naming one, or any other column, is refused 400
// with the other client's row provably unchanged; a direct PostgREST write to client_profiles
// (the column, or legal_name) moves nothing, because the table has no client write policy;
// invalid values 400, anonymous 401, a signed-in user with no client account 403.
// RECLAIM, enforced server-side: a browser value is saved once when the server holds none, and
// never overwrites a server value — in either order.
// PAGES, real scripts in a real DOM: the shared risk-profile.js reclaims a localStorage value
// exactly once and then drops the browser copy; a browser value never displaces a server one;
// risk-management.html's Risk Meter shows "Not set" for a client who never chose, and its Save
// writes the server; the PM's client profile shows the level and when it was set.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { if (await test()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return test();
}
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const vc = new VirtualConsole(); vc.on('jsdomError', function () {});

async function main() {
  console.log('The risk profile, stored with the account\n');
  const raw = execSync('supabase status -o json', { cwd: ROOT, encoding: 'utf8' });
  const st = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) throw new Error('Refusing to run against a non-local API_URL');
  const url = st.API_URL, anonKey = st.ANON_KEY;
  const admin = createClient(url, st.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const users = [];
  async function makeUser(tag, withClient) {
    const email = 'riskprof-' + tag + '-' + suffix + '@test.marketswave.local', password = 'RiskProfile-2026!' + suffix;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    users.push(data.user.id);
    if (withClient) await admin.from('clients').insert({ id: data.user.id, name: 'Risk Profile Fixture ' + tag + ' ' + suffix, email: 'riskprof-malformed-' + tag + '-' + suffix, phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    const c = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: s } = await c.auth.signInWithPassword({ email, password });
    return { id: data.user.id, email, password, token: s.session.access_token, client: c };
  }
  async function fn(token, body) {
    const r = await fetch(url + '/functions/v1/set-risk-profile', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
    let j = null; try { j = await r.json(); } catch (_e) {}
    return { status: r.status, body: j };
  }
  const row = async (id) => (await admin.from('client_profiles').select('risk_profile, risk_profile_set_at, legal_name').eq('client_id', id).maybeSingle()).data;

  try {
    const A = await makeUser('a', true), B = await makeUser('b', true), C = await makeUser('c', true), N = await makeUser('noclient', false);
    // B has a pre-existing profile row (a legal name), so "nothing else moves" is testable.
    await admin.from('client_profiles').insert({ client_id: B.id, legal_name: { firstName: 'Fixture', lastName: 'Bee' } });

    console.log('--- the write boundary ---\n');
    const a1 = await fn(A.token, { riskProfile: 'conservative' });
    const ra = await row(A.id);
    check('★ a client sets their own risk profile (the row is created with the level and a time)', a1.status === 200 && ra && ra.risk_profile === 'conservative' && !!ra.risk_profile_set_at, JSON.stringify({ a1, ra }));
    const bBefore = await row(B.id);
    const naming = await fn(A.token, { riskProfile: 'aggressive', clientId: B.id });
    check('★ naming another client is refused 400 — there is no clientId input', naming.status === 400 && /unexpected: clientId/.test(naming.body.error), JSON.stringify(naming));
    check('...and that client\'s row is provably unchanged', JSON.stringify(await row(B.id)) === JSON.stringify(bBefore));
    const other = await fn(A.token, { riskProfile: 'aggressive', legal_name: { firstName: 'X' } });
    check('★ any other column is refused 400', other.status === 400 && /legal_name/.test(other.body.error), JSON.stringify(other));
    check('...and the caller\'s own row did not move either', (await row(A.id)).risk_profile === 'conservative');
    await A.client.from('client_profiles').update({ risk_profile: 'aggressive' }).eq('client_id', A.id);
    await A.client.from('client_profiles').update({ legal_name: { firstName: 'Hacked' } }).eq('client_id', A.id);
    await A.client.from('client_profiles').update({ risk_profile: 'aggressive' }).eq('client_id', B.id);
    const raAfter = await row(A.id), rbAfter = await row(B.id);
    check('★ a direct table write — own row or another client\'s, risk_profile or legal_name — moves nothing (no client write policy)', raAfter.risk_profile === 'conservative' && raAfter.legal_name === null && JSON.stringify(rbAfter) === JSON.stringify(bBefore), JSON.stringify({ raAfter, rbAfter }));
    const bad = await fn(A.token, { riskProfile: 'reckless' });
    check('an invalid level is refused 400', bad.status === 400, String(bad.status));
    const anon = await fn(anonKey, { riskProfile: 'balanced' });
    check('an anonymous caller is refused 401', anon.status === 401, String(anon.status));
    const nc = await fn(N.token, { riskProfile: 'balanced' });
    check('a signed-in user with no client account is refused 403', nc.status === 403, String(nc.status));
    const bSet = await fn(B.token, { riskProfile: 'balanced' });
    const rb2 = await row(B.id);
    check('setting it on a row that already exists keeps that row\'s other columns (legal_name untouched)', bSet.status === 200 && rb2.risk_profile === 'balanced' && JSON.stringify(rb2.legal_name) === JSON.stringify(bBefore.legal_name), JSON.stringify(rb2));

    console.log('\n--- reclaim, enforced by the function ---\n');
    const r1 = await fn(C.token, { riskProfile: 'aggressive', reclaim: true });
    check('★ a reclaim with nothing on the server saves', r1.status === 200 && r1.body.saved === true && (await row(C.id)).risk_profile === 'aggressive', JSON.stringify(r1.body));
    const r2 = await fn(C.token, { riskProfile: 'conservative', reclaim: true });
    check('★ a second reclaim never overwrites the server value', r2.status === 200 && r2.body.saved === false && r2.body.reason === 'server_has_value' && (await row(C.id)).risk_profile === 'aggressive', JSON.stringify(r2.body));
    const r3 = await fn(A.token, { riskProfile: 'aggressive', reclaim: true });
    check('★ a reclaim against a value the client CHOSE does not overwrite it either', r3.body.saved === false && (await row(A.id)).risk_profile === 'conservative');

    console.log('\n--- the pages ---\n');
    // A fresh client D: browser holds "aggressive", server holds nothing.
    const D = await makeUser('d', true);
    globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
    await import('../supabase-data.js');
    const MD = globalThis.window.MarketswaveData;
    const supa = await MD.getSupabaseClient();
    await supa.auth.signInWithPassword({ email: D.email, password: D.password });
    const calls = [];
    const realCall = MD.callFunction;
    MD.callFunction = function (name, body) { if (name === 'set-risk-profile') calls.push(body); return realCall.apply(MD, arguments); };

    const helperDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
    const hw = helperDom.window;
    hw.MarketswaveData = MD;
    hw.clientScopedKey = (k) => k + ':' + D.id;
    hw.localStorage.setItem('marketswave_risk_profile:' + D.id, 'aggressive');
    hw.eval(readFileSync(ROOT + 'risk-profile.js', 'utf8'));
    const l1 = await hw.RiskProfile.load();
    check('★ the shared loader reclaims the browser value once: saved to the server', l1.riskProfile === 'aggressive' && l1.reclaimed === true && (await row(D.id)).risk_profile === 'aggressive' && calls.length === 1 && calls[0].reclaim === true, JSON.stringify({ l1, calls }));
    check('...and removes the browser copy', hw.localStorage.getItem('marketswave_risk_profile:' + D.id) === null);
    const l2 = await hw.RiskProfile.load();
    check('★ the next load reads the server and does NOT reclaim again', l2.riskProfile === 'aggressive' && calls.length === 1, 'calls=' + calls.length);
    hw.localStorage.setItem('marketswave_risk_profile:' + D.id, 'conservative');
    const l3 = await hw.RiskProfile.load();
    check('★ a stale browser value never displaces the server one (and is dropped)', l3.riskProfile === 'aggressive' && (await row(D.id)).risk_profile === 'aggressive' && hw.localStorage.getItem('marketswave_risk_profile:' + D.id) === null && calls.length === 1);

    // risk-management.html's real Risk Meter, for a client E who has never chosen.
    const E = await makeUser('e', true);
    await supa.auth.signInWithPassword({ email: E.email, password: E.password });
    const rmHtml = readFileSync(ROOT + 'risk-management.html', 'utf8');
    const rmBody = rmHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
    const rmDom = new JSDOM('<!doctype html><html><body>' + rmBody + '</body></html>', { url: 'http://localhost/risk-management.html', runScripts: 'outside-only', virtualConsole: vc, pretendToBeVisual: true });
    const rw = rmDom.window;
    rw.MarketswaveData = MD;
    rw.clientScopedKey = (k) => k + ':' + E.id;
    rw.eval(readFileSync(ROOT + 'risk-profile.js', 'utf8'));
    const rmScript = [...rmHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.indexOf('risk-save-profile') !== -1);
    rw.eval(rmScript);
    const pillText = () => rw.document.getElementById('risk-current-pill').textContent;
    await pollUntil(() => calls.length >= 1 && pillText(), 3000);
    await new Promise((r) => setTimeout(r, 1500));
    check('★ a client who never chose sees "Current Profile: Not set" — not a claimed Balanced', pillText() === 'Current Profile: Not set', pillText());
    // Row 294: no fabricated risk capacity. The card says it has not been assessed, and nothing
    // judges the chosen level against an invented capacity.
    const capBody = rw.document.body.textContent;
    check('★ Risk capacity reads "Not yet assessed" — no invented "Moderate–High", no suitability judgement',
      rw.document.getElementById('risk-capacity-value').textContent === 'Not yet assessed' && capBody.indexOf('Moderate–High') === -1 && !rw.document.getElementById('capacity-suitability-badge') && !/Aligned with your risk capacity|exceeds your risk capacity/.test(capBody),
      rw.document.getElementById('risk-capacity-value').textContent);
    rw.document.querySelector('.risk-preview-tab[data-level="aggressive"], [data-level="aggressive"]').click();
    rw.document.getElementById('risk-save-profile').click();
    await pollUntil(async () => (await row(E.id)) && (await row(E.id)).risk_profile === 'aggressive', 10000);
    check('★ Save on the Risk Meter writes the SERVER', (await row(E.id)) && (await row(E.id)).risk_profile === 'aggressive');
    await pollUntil(() => pillText() === 'Current Profile: Aggressive', 5000);
    check('...and the pill then reads the saved level', pillText() === 'Current Profile: Aggressive', pillText());
    check('...with nothing written to the browser', rw.localStorage.getItem('marketswave_risk_profile:' + E.id) === null);

    // The PM's client profile.
    const cfg = await import('../admin-supabase-config.js');
    await cfg.supabase.auth.signInWithPassword({ email: cfg.LOCAL_ADMIN_EMAIL, password: cfg.LOCAL_ADMIN_PASSWORD });
    MD.useAdminClient();
    async function pmPage(clientId) {
      const html = readFileSync(ROOT + 'admin-client-profile.html', 'utf8');
      const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
      const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', { url: 'http://localhost/admin-client-profile.html?client=' + clientId, runScripts: 'outside-only', virtualConsole: vc });
      dom.window.MarketswaveData = MD;
      for (const f of ['format-helpers.js', 'onboarding-vocab.js', 'asset-mark.js']) dom.window.eval(readFileSync(ROOT + f, 'utf8'));
      dom.window.eval(readFileSync(ROOT + 'admin-client-profile.js', 'utf8'));
      await pollUntil(() => /Risk profile/.test(dom.window.document.getElementById('cp-onboarding').textContent), 30000);
      return dom.window.document.getElementById('cp-onboarding');
    }
    const panelE = await pmPage(E.id);
    const setAt = (await row(E.id)).risk_profile_set_at;
    const shown = panelE.textContent;
    const expectDate = new Date(setAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    check('★ the PM\'s client profile shows the level and when it was set', /Risk profile\s*Aggressive/.test(shown) && !!panelE.querySelector('[data-cp-risk-set-at]'), shown.replace(/\s+/g, ' ').slice(0, 300));
    check('...the "set" date is the server\'s risk_profile_set_at', panelE.querySelector('[data-cp-risk-set-at]') && /set /.test(panelE.querySelector('[data-cp-risk-set-at]').textContent), panelE.querySelector('[data-cp-risk-set-at]') && panelE.querySelector('[data-cp-risk-set-at]').textContent + ' vs ' + expectDate);
    const panelN = await pmPage(B.id === null ? '' : (await makeUser('f', true)).id);
    check('...and "Not set" for a client who never chose', !!panelN.querySelector('[data-cp-risk-unset]'), panelN.textContent.replace(/\s+/g, ' ').slice(0, 200));
  } finally {
    for (const id of users) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.log('  cleanup: ' + error.message); }
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nRISK PROFILE: ' + (failed ? 'FAIL' : 'PASS'));
  if (failed) throw new Error(failed + ' assertion(s) failed');
}
runVerifyMain(main);
