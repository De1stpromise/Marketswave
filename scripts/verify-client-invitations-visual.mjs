// ★ PM client creation by invitation — the real browser (register row 254).
//
//   A. THE END-TO-END, exactly as the brief specified: an invitation is opened from its link
//      (signup.html?invite=<token>), which pre-fills the name and email and SKIPS NOTHING ELSE;
//      the person completes every remaining step — date of birth, country, financial profile,
//      goals, the six-question risk questionnaire and BOTH identity documents as real files —
//      through the paths Task A built; and the result is checked by reading Postgres and
//      Storage directly: a clients row, a full client_profiles onboarding record, two
//      identity_documents rows whose bytes in the bucket are byte-identical to the files
//      chosen, and the invitation resolved as accepted against that client with the used
//      token then refused.
//   B. Every refusal rendered in the real page, not a broken form: expired, revoked, used,
//      unknown — the server's own sentence, the steps hidden, a plain signup one click away.
//   C. The admin page with every state on screen: nav (row 228), contrast with the sheen
//      composited on the panel / the Invite modal / the Revoke confirm, the sheen audit, fonts,
//      and a REAL phone at 390/375 (matchMedia-proven) plus a real 320px iframe — rows RESTACK,
//      nothing hides, every control at the 44px floor.
//
// The suite stands in for the mailer and the inbox for the flow itself: the invitation rows it
// drives are inserted with a token hash it computed, because the raw token exists only in the
// email (its whole design). The mailing path is proven by the two sibling suites through
// Resend's delivery sink; the one real-inbox invitation is sent on request, never by a
// regression run.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTempDir, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mint = () => crypto.randomBytes(32).toString('base64url');

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}
function runChild(script, env, label) {
  const res = spawnSync(process.execPath, [script], { cwd: HERE, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 900000 });
  forwardChildTeardown(res, label);
  return (res.stdout || '') + (res.stderr || '');
}
function runContrast(profile, label, bootstrap, prepare, url) {
  const out = runChild('verify-contrast.mjs', {
    CONTRAST_PROFILE: profile, CONTRAST_URL: url, CONTRAST_BOOTSTRAP_JS: bootstrap || '',
    CONTRAST_PREPARE_JS: prepare || '', CONTRAST_WIDTHS: '1440'
  }, 'verify-contrast(' + profile + ')');
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ');
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1 with the sheen composited', /CONTRAST: PASS/.test(out), tail);
  return m ? Number(m[1]) : 0;
}

// --- CDP ------------------------------------------------------------------------------------
async function connect(profile) {
  const PORT = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const consoleLog = []; const dialogs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    // signup.html's showError() is a native alert() (row 166): a dialog blocks every later
    // Runtime.evaluate and the run hangs with no output. Dismiss it at once and record it —
    // a step that alerted is a failed step, and the assertion below says which.
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.type + ': ' + m.params.message);
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'warning' || m.params.type === 'error')) {
      consoleLog.push(m.params.type + ': ' + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') consoleLog.push('exception: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('DOM.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { chrome, ws, send, evaluate, consoleLog, dialogs };
}
async function phone(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function desktop(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}
async function goto(cdp, url) {
  await cdp.send('Page.navigate', { url: 'about:blank' }); await sleep(120);
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) { await sleep(200); try { if (await cdp.evaluate('document.readyState === "complete" && !!document.body')) break; } catch (_e) { /* mid-nav */ } }
  await sleep(600);
}
async function setFile(cdp, selector, file) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId: q.nodeId });
  await sleep(250);
}
const ACTIVE_STEP = '(() => { const el = document.querySelector(".signup-step.is-active"); return el ? el.dataset.step : null; })()';
async function nextStep(cdp) {
  await cdp.evaluate('(() => { const a = document.querySelector(".signup-step.is-active"); const b = a && a.querySelector("[data-next]"); if (b) b.click(); return !!b; })()');
  await sleep(550);
  return cdp.evaluate(ACTIVE_STEP);
}
const NAV = `(() => {
  const aside = document.getElementById('admin-sidebar-aside');
  if (!aside) return { missing: true };
  const items = [...aside.querySelectorAll('.an-item')];
  return { missing: false, count: items.length, on: items.filter(i => i.classList.contains('is-on')).map(i => (i.querySelector('.an-lb') || {}).textContent), logout: !!document.getElementById('admin-logout-btn'), asideW: Math.round(aside.getBoundingClientRect().width) };
})()`;
const INV_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.cl-tr').length > 0 && document.querySelector('#cl-invitations .cl-ih') && document.readyState === 'complete') break; await nap(200); }
  await nap(700); return !!document.querySelector('#cl-invitations .cl-ih'); })()`;
const SIGNUP_INVITE_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 150; i++) { const b = document.getElementById('invite-banner'), r = document.getElementById('invite-refused'); if ((b && !b.hidden) || (r && !r.hidden)) break; await nap(200); }
  await nap(500); return true; })()`;

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const email = 'invited-' + suffix + '@test.marketswave.local';
  const PASSWORD = 'Invited-2026!';
  const idFile = path.join(os.tmpdir(), 'inv-passport-' + suffix + '.pdf');
  const addrFile = path.join(os.tmpdir(), 'inv-utility-' + suffix + '.pdf');
  fs.writeFileSync(idFile, '%PDF-1.4 INVITED PASSPORT ' + suffix);
  fs.writeFileSync(addrFile, '%PDF-1.4 INVITED UTILITY BILL ' + suffix);
  const cleanupUsers = [], cleanupInv = [];
  let server = null, profile = null, cdp = null;
  const admSigned = await anon().auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (admSigned.error) throw new Error('admin sign-in: ' + admSigned.error.message);
  const pmId = admSigned.data.user.id;
  const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(admSigned.data.session)) + '); true';

  // The invitation the person will accept — a real row with a token this suite knows.
  const token = mint();
  const { data: inv, error: invErr } = await admin.from('client_invitations').insert({
    full_name: 'Katarina Invited ' + suffix, email, token_hash: sha256(token), note: 'See you Thursday.',
    invited_by: pmId, invited_by_email: 'pm@marketswave.local', expires_at: new Date(Date.now() + 14 * 86400000).toISOString()
  }).select('*').single();
  if (invErr) throw new Error('seed invitation: ' + invErr.message);
  cleanupInv.push(inv.id);

  try {
    server = spawn('python', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/signup.html'); break; } catch (_e) { await sleep(250); } }
    profile = makeTempDir('mw-invite-');
    cdp = await connect(profile);
    await desktop(cdp, 1440);

    // =========================================================================================
    console.log('\n=== PART A — the invited signup, end to end, read back from Postgres and Storage ===\n');
    await goto(cdp, BASE + '/signup.html?invite=' + encodeURIComponent(token));
    await cdp.evaluate(SIGNUP_INVITE_WAIT);
    const pre = await cdp.evaluate(`(() => ({
      banner: !document.getElementById('invite-banner').hidden, refused: !document.getElementById('invite-refused').hidden,
      name: document.getElementById('full_name').value, email: document.getElementById('email').value,
      emailReadonly: document.getElementById('email').readOnly, step: (document.querySelector('.signup-step.is-active') || {}).dataset.step,
      steps: document.querySelectorAll('.signup-step').length, phoneEmpty: document.getElementById('phone').value === '', pwEmpty: document.getElementById('password').value === '' }))()`);
    check('★ the link opens signup with the invitation banner, the NAME and EMAIL pre-filled, the email read-only', pre.banner && !pre.refused && pre.name === 'Katarina Invited ' + suffix && pre.email === email && pre.emailReadonly, JSON.stringify(pre));
    check('★ ...and SKIPS NOTHING ELSE — step 1 is still the first step, every step still present, phone/password still the person\'s to enter', pre.step === '1' && pre.steps === 9 && pre.phoneEmpty && pre.pwEmpty, JSON.stringify(pre));
    const { data: openedRow } = await admin.from('client_invitations').select('status, opened_at').eq('id', inv.id).single();
    check('★ the PM\'s list would now read Opened — status flipped on the real open, opened_at set', openedRow.status === 'opened' && !!openedRow.opened_at, JSON.stringify(openedRow));

    await cdp.evaluate('(() => { document.querySelector(\'.account-type-card[data-value="individual"]\').click(); return true; })()');
    await sleep(200);
    await cdp.evaluate('(() => { document.getElementById("btn-continue-1").click(); return true; })()');
    await sleep(600);
    check('step 1 → 2', (await cdp.evaluate(ACTIVE_STEP)) === '2');
    await cdp.evaluate(`(() => {
      const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
      set('phone', '+46 70 123 45 67'); set('password', ${JSON.stringify(PASSWORD)}); set('password_confirm', ${JSON.stringify(PASSWORD)});
      set('date_of_birth', '1990-07-21'); set('country', 'SE'); return true; })()`);
    check('step 2 → next with the person\'s OWN phone, password, date of birth and country (the pre-filled name and email untouched)', (await nextStep(cdp)) !== '2');
    const ANSWERS = {
      // The form's OWN option values (read from signup.html's markup, not typed from memory — a
      // first draft guessed '5-10'/'medium'/'some', step 7's validation called alert(), and the
      // CDP session froze on the dialog with no output at all; see dialogs[] below).
      investable_assets: '250k-1m', source_of_wealth: 'employment', employment: 'Architect',
      investment_goal: 'growth', time_horizon: '3-7', risk_comfort: 'moderate',
      risk_knowledge: 'intermediate', risk_reaction: 'hold', risk_objective: 'balanced', risk_horizon: '3-7', risk_liquidity: 'somewhat', risk_experience: 'occasionally'
    };
    for (let guard = 0; guard < 8; guard++) {
      const step = await cdp.evaluate(ACTIVE_STEP);
      if (step === '8') break;
      await cdp.evaluate(`(() => {
        const A = ${JSON.stringify(ANSWERS)};
        const a = document.querySelector('.signup-step.is-active');
        a.querySelectorAll('input[type=radio]').forEach(r => { if (A[r.name] === r.value) { r.checked = true; r.dispatchEvent(new Event('change', {bubbles:true})); } });
        a.querySelectorAll('select').forEach(s => { if (A[s.name]) { s.value = A[s.name]; s.dispatchEvent(new Event('change', {bubbles:true})); } });
        a.querySelectorAll('input[type=text]').forEach(i => { if (A[i.name]) { i.value = A[i.name]; i.dispatchEvent(new Event('input', {bubbles:true})); } });
        return true; })()`);
      await nextStep(cdp);
    }
    check('reached step 8 (Document Upload) — the questionnaire was the person\'s to answer', (await cdp.evaluate(ACTIVE_STEP)) === '8', 'dialogs: ' + cdp.dialogs.join(' | '));
    check('no step raised a native dialog on the way (a validation alert would have frozen a real CDP run)', cdp.dialogs.length === 0, cdp.dialogs.join(' | '));
    await setFile(cdp, '#signup-upload-id', idFile);
    await setFile(cdp, '#signup-upload-address', addrFile);
    check('step 8 → 9 with both real files chosen', (await nextStep(cdp)) === '9');
    await cdp.evaluate('(() => { ["consent-terms","consent-accuracy"].forEach(id => { const c = document.getElementById(id); c.checked = true; c.dispatchEvent(new Event("change", {bubbles:true})); }); document.getElementById("btn-submit").click(); return true; })()');
    let landed = '';
    for (let i = 0; i < 150; i++) { await sleep(300); landed = await cdp.evaluate('location.pathname').catch(() => ''); if (/thank-you/.test(landed)) break; }
    check('★ the real submit landed on thank-you.html', /thank-you/.test(landed), landed);
    const pageWarnings = cdp.consoleLog.filter((l) => /submit-onboarding|identity document|non-fatal/i.test(l));
    check('★ NO non-fatal persistence failure was logged — both server writes genuinely succeeded', pageWarnings.length === 0, pageWarnings.join(' || ').slice(0, 300));

    const { data: clientRow } = await admin.from('clients').select('id, name, email, status').eq('email', email).maybeSingle();
    check('★ a real clients row exists at the invited address, pending_review, under the pre-filled name', clientRow && clientRow.status === 'pending_review' && clientRow.name === 'Katarina Invited ' + suffix, JSON.stringify(clientRow));
    if (!clientRow) throw new Error('signup did not create a clients row');
    const uid = clientRow.id; cleanupUsers.push(uid);
    const { data: prof } = await admin.from('client_profiles').select('*').eq('client_id', uid).maybeSingle();
    check('★ a FULL onboarding record: date of birth, country, financial profile, goals, all six risk answers — the person\'s own', !!prof && prof.date_of_birth === '1990-07-21' && prof.country_of_residence === 'SE' && prof.financial_profile && prof.financial_profile.employment === 'Architect' && prof.goals_preferences && prof.goals_preferences.investmentGoal === 'growth' && prof.risk_questionnaire && prof.risk_questionnaire.knowledge === 'intermediate' && prof.risk_questionnaire.reaction === 'hold' && !!prof.onboarding_submitted_at, JSON.stringify(prof && { dob: prof.date_of_birth, c: prof.country_of_residence, r: prof.risk_questionnaire }));
    check('legal name set server-side from the pre-filled name (split_client_legal_name: the LAST word is the last name)', prof && prof.legal_name && prof.legal_name.firstName === 'Katarina Invited' && prof.legal_name.lastName === suffix, JSON.stringify(prof && prof.legal_name));
    const { data: idds } = await admin.from('identity_documents').select('*').eq('client_id', uid).order('kind');
    check('★ two identity_documents rows (address, id)', idds && idds.length === 2 && idds.map((d) => d.kind).join() === 'address,id', JSON.stringify(idds));
    for (const d of (idds || [])) {
      const dl = await admin.storage.from('identity-documents').download(d.storage_path);
      const text = dl.error ? null : await dl.data.text();
      const expected = fs.readFileSync(d.kind === 'id' ? idFile : addrFile, 'utf8');
      check('★ REAL BYTES IN STORAGE for ' + d.kind + ' (' + d.filename + '), byte-identical to the file the person chose', !dl.error && text === expected, dl.error ? dl.error.message : 'size ' + (text || '').length);
    }
    const { data: acc } = await admin.from('client_invitations').select('status, accepted_at, accepted_client_id').eq('id', inv.id).single();
    check('★ the invitation records WHICH client it became and stops being live — accepted, accepted_client_id = the new client', acc.status === 'accepted' && !!acc.accepted_at && acc.accepted_client_id === uid, JSON.stringify(acc));

    // =========================================================================================
    console.log('\n=== PART B — every refusal, rendered in the real page ===\n');
    const readRefused = `(() => { const r = document.getElementById('invite-refused'); const steps = [...document.querySelectorAll('.signup-step')];
      return { shown: !r.hidden, reason: r.dataset.reason, msg: document.getElementById('invite-refused-message').textContent, stepsVisible: steps.filter(s => getComputedStyle(s).display !== 'none').length,
        kickerHidden: getComputedStyle(document.getElementById('step-label')).display === 'none', link: (document.getElementById('invite-refused-plain') || {}).getAttribute('href'), banner: !document.getElementById('invite-banner').hidden }; })()`;
    await goto(cdp, BASE + '/signup.html?invite=' + encodeURIComponent(token));
    await cdp.evaluate(SIGNUP_INVITE_WAIT);
    const used = await cdp.evaluate(readRefused);
    check('★ the USED token: refused in place of the form — "already been used", every step hidden, a plain-signup link', used.shown && used.reason === 'used' && /already been used/.test(used.msg) && used.stepsVisible === 0 && used.kickerHidden && used.link === 'signup.html' && !used.banner, JSON.stringify(used));

    const seedRefusal = async (tag, patch) => {
      const t = mint();
      const { data: r } = await admin.from('client_invitations').insert({ full_name: tag + ' ' + suffix, email: 'inv-' + tag + '-' + suffix + '@test.marketswave.local', token_hash: sha256(t), invited_by: pmId, invited_by_email: 'pm@marketswave.local', expires_at: new Date(Date.now() + 14 * 86400000).toISOString(), ...patch }).select('id').single();
      cleanupInv.push(r.id);
      return t;
    };
    const expiredTok = await seedRefusal('Expired', { expires_at: new Date(Date.now() - 3600000).toISOString() });
    await goto(cdp, BASE + '/signup.html?invite=' + encodeURIComponent(expiredTok));
    await cdp.evaluate(SIGNUP_INVITE_WAIT);
    const exp = await cdp.evaluate(readRefused);
    check('★ an EXPIRED token: "expired — valid for 14 days", steps hidden, plain signup offered', exp.shown && exp.reason === 'expired' && /expired/.test(exp.msg) && /14 days/.test(exp.msg) && exp.stepsVisible === 0, JSON.stringify(exp));
    const revokedTok = await seedRefusal('Revoked', { status: 'revoked' });
    await goto(cdp, BASE + '/signup.html?invite=' + encodeURIComponent(revokedTok));
    await cdp.evaluate(SIGNUP_INVITE_WAIT);
    const rvk = await cdp.evaluate(readRefused);
    check('★ a REVOKED token: "withdrawn", steps hidden', rvk.shown && rvk.reason === 'revoked' && /withdrawn/.test(rvk.msg) && rvk.stepsVisible === 0, JSON.stringify(rvk));
    await goto(cdp, BASE + '/signup.html?invite=' + encodeURIComponent(mint()));
    await cdp.evaluate(SIGNUP_INVITE_WAIT);
    const unk = await cdp.evaluate(readRefused);
    check('an UNKNOWN token: "not valid", steps hidden', unk.shown && unk.reason === 'unknown' && /not valid/.test(unk.msg) && unk.stepsVisible === 0, JSON.stringify(unk));
    await goto(cdp, BASE + '/signup.html');
    await sleep(800);
    const plain = await cdp.evaluate(`(() => ({ banner: !document.getElementById('invite-banner').hidden, refused: !document.getElementById('invite-refused').hidden, step: (document.querySelector('.signup-step.is-active') || {}).dataset.step, emailReadonly: document.getElementById('email').readOnly }))()`);
    check('a plain signup (no token) is completely unaffected — no banner, no refusal, step 1, email editable', !plain.banner && !plain.refused && plain.step === '1' && !plain.emailReadonly, JSON.stringify(plain));

    console.log('\n--- signup contrast: the invited banner + read-only address, and the refusal ---\n');
    const liveTok = await seedRefusal('Live', {});
    const invitedUrl = BASE + '/signup.html?invite=' + encodeURIComponent(liveTok);
    const SIGNUP_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 150; i++) { const b = document.getElementById('invite-banner'), r = document.getElementById('invite-refused'); if ((b && !b.hidden) || (r && !r.hidden)) break; await nap(200); } await nap(900); })()`;
    const SIGNUP_PREP_STEP2 = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 150; i++) { const b = document.getElementById('invite-banner'); if (b && !b.hidden) break; await nap(200); }
      document.querySelector('.account-type-card[data-value="individual"]').click(); await nap(200); document.getElementById('btn-continue-1').click(); await nap(900); })()`;
    runContrast('signup-invited', 'signup with a live invitation (step 2, the read-only address)', '', SIGNUP_PREP_STEP2, invitedUrl);
    runContrast('signup-refused', 'signup with an expired invitation (the refusal)', '', SIGNUP_PREP, BASE + '/signup.html?invite=' + encodeURIComponent(expiredTok));

    // =========================================================================================
    console.log('\n=== PART C — the admin page: every state on screen, nav, contrast, sheen, fonts, a real phone ===\n');
    // seed sent / opened / expired at this run's own addresses
    const seedInv = async (tag, patch) => {
      const { data: r } = await admin.from('client_invitations').insert({ full_name: tag + ' Person ' + suffix, email: 'invp-' + tag.toLowerCase() + '-' + suffix + '@test.marketswave.local', token_hash: sha256(mint()), invited_by: pmId, invited_by_email: 'pm@marketswave.local', expires_at: new Date(Date.now() + 14 * 86400000).toISOString(), ...patch }).select('id').single();
      cleanupInv.push(r.id); return r.id;
    };
    const sentId = await seedInv('Sent', {});
    const openedId = await seedInv('Opened', { status: 'opened', opened_at: new Date().toISOString(), expires_at: new Date(Date.now() + 20 * 3600000).toISOString() });
    const expiredId = await seedInv('Expired', { expires_at: new Date(Date.now() - 2 * 86400000).toISOString() });
    const URL_ = BASE + '/admin-clients.html';
    const PANEL_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.cl-tr').length > 0 && document.querySelectorAll('.cl-ir').length >= 3) break; await nap(200); } await nap(900); })()`;
    runContrast('client-invitations', 'the pending invitations panel (Sent, Opened, Expired)', adminBootstrap, PANEL_PREP, URL_);
    runContrast('client-list', 'the client list beneath it (unchanged)', adminBootstrap, PANEL_PREP, URL_);
    const MODAL_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.cl-tr').length > 0) break; await nap(200); }
      document.getElementById('open-invite-modal').click(); await nap(300);
      document.getElementById('invite-name').value = 'Katarina Holm'; document.getElementById('invite-email').value = 'k.holm@outlook.com';
      document.getElementById('invite-note').value = 'Lovely speaking today.';
      const e = document.getElementById('invite-error'); e.textContent = 'An invitation to k.holm@outlook.com is already out. Resend or revoke that one instead.'; e.classList.remove('hidden');
      await nap(900); })()`;
    runContrast('client-invitations-modal', 'the Invite modal (with a refusal shown)', adminBootstrap, MODAL_PREP, URL_);
    const REVOKE_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.cl-ir').length >= 3) break; await nap(200); }
      document.querySelector('[data-mode="revoke"]').click(); await nap(900); })()`;
    runContrast('client-invitations-revoke', 'the Revoke confirm', adminBootstrap, REVOKE_PREP, URL_);

    console.log('\n--- Sheen audit + fonts ---\n');
    const sheen = runChild('audit-glass-sheen.mjs', { SHEEN_PAGES: 'admin-clients.html', SHEEN_BOOTSTRAP_JS: adminBootstrap }, 'audit-glass-sheen');
    check('the sheen audit passed on the page with the panel present', /SHEEN SWEEP: PASS/.test(sheen), sheen.slice(-300));
    const fonts = runChild('audit-fonts.mjs', { AUDIT_URL: URL_, AUDIT_BOOTSTRAP_JS: adminBootstrap }, 'audit-fonts');
    check('no font falls back, no monospace (row 192)', !/FALLBACK/.test(fonts) && !/JetBrains|monospace/i.test(fonts), fonts.split('\n').filter((l) => /FALLBACK|mono/i.test(l)).join(' | '));

    console.log('\n--- Desktop 1440 ---\n');
    await desktop(cdp, 1440);
    await goto(cdp, BASE + '/admin-clients.html'); await cdp.evaluate(adminBootstrap);
    await goto(cdp, URL_);
    check('GUARD: the page rendered the panel', await cdp.evaluate(INV_WAIT));
    const nav = await cdp.evaluate(NAV);
    check('★ 1440px: THE PAGE MOUNTS THE SHARED ADMIN NAV — ten items, "Clients" active, Log out reachable', !nav.missing && nav.count === 10 && nav.on.join() === 'Clients' && nav.logout && nav.asideW > 0, JSON.stringify(nav));
    const READ = (w) => `(() => {
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const rects = [...document.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
      const rows = [...document.querySelectorAll('.cl-ir')].map(r => ({ status: r.dataset.status, name: vis(r.querySelector('.cl-inm b')), email: vis(r.querySelector('.cl-inm span')), pill: vis(r.querySelector('.cl-istat')), date: vis(r.querySelector('.cl-isent')),
        btns: [...r.querySelectorAll('button')].map(b => { const q = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(q.width), h: Math.round(q.height), inside: q.right <= r.getBoundingClientRect().right + 0.5 }; }) }));
      return { inner: window.innerWidth, bodyScroll: document.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)),
        dpr: window.devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches, noHover: matchMedia('(hover: none)').matches,
        strip: [...document.querySelectorAll('.cl-hc .cl-k')].map(k => k.textContent.trim()), rows, panelAboveList: document.getElementById('cl-invitations').getBoundingClientRect().bottom <= document.getElementById('cl-panel').getBoundingClientRect().top,
        inviteBtn: (() => { const b = document.getElementById('open-invite-modal'); const q = b.getBoundingClientRect(); return { w: Math.round(q.width), h: Math.round(q.height) }; })() };
    })()`;
    const d = await cdp.evaluate(READ(1440));
    check('1440px: viewport genuinely 1440, no horizontal overflow', d.inner === 1440 && d.bodyScroll <= 1440 && d.maxRight <= 1441, JSON.stringify({ b: d.bodyScroll, m: d.maxRight }));
    check('★ the strip: Clients | Invitations out | AUM | Awaiting approval — invitations separated from clients', d.strip.join('|') === 'Clients|Invitations out|Assets under management|Awaiting your approval', d.strip.join('|'));
    check('★ the pending panel sits ABOVE the client list, as its own panel', d.panelAboveList === true);
    const statuses = d.rows.map((r) => r.status);
    check('★ all three states are on screen — sent, opened, expired', ['sent', 'opened', 'expired'].every((s) => statuses.includes(s)), statuses.join(','));
    check('every row shows name, email, date and its status pill', d.rows.every((r) => r.name && r.email && r.pill && r.date));
    const expRow = d.rows.find((r) => r.status === 'expired'), liveRow = d.rows.find((r) => r.status === 'sent');
    check('an expired row offers Invite again + Remove; a live row Resend + Revoke', expRow && expRow.btns.map((b) => b.t).join('|') === 'Invite again|Remove' && liveRow && liveRow.btns.map((b) => b.t).join('|') === 'Resend|Revoke', JSON.stringify({ e: expRow && expRow.btns.map((b) => b.t), l: liveRow && liveRow.btns.map((b) => b.t) }));

    console.log('\n--- ★ A REAL phone at 390 / 375 ---\n');
    for (const w of [390, 375]) {
      await phone(cdp, w);
      await goto(cdp, URL_);
      await cdp.evaluate(INV_WAIT);
      const m = await cdp.evaluate(READ(w));
      check('★ ' + w + 'px: a REAL PHONE PROFILE (DPR 3, coarse pointer, no hover), viewport genuinely ' + w, m.dpr === 3 && m.coarse && m.noHover && m.inner === w, JSON.stringify({ dpr: m.dpr, coarse: m.coarse, inner: m.inner }));
      check(w + 'px: nothing scrolls horizontally', m.bodyScroll <= w && m.maxRight <= w + 1, JSON.stringify({ b: m.bodyScroll, m: m.maxRight }));
      check('★ ' + w + 'px: rows RESTACK — name, email, date and pill all survive on every row (nothing hidden)', m.rows.length >= 3 && m.rows.every((r) => r.name && r.email && r.pill && r.date), JSON.stringify(m.rows.map((r) => [r.name, r.email, r.pill, r.date])));
      check('★ ' + w + 'px: every row control meets the 44px floor and stays inside its row', m.rows.every((r) => r.btns.every((b) => b.h >= 44 && b.w >= 44 && b.inside)), JSON.stringify(m.rows.map((r) => r.btns)));
      check(w + 'px: the Invite a client button meets the floor', m.inviteBtn.h >= 44 && m.inviteBtn.w >= 44, JSON.stringify(m.inviteBtn));
      // the modal on a phone
      const modal = await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
        document.getElementById('open-invite-modal').click(); await nap(300);
        const md = document.querySelector('#invite-modal > div:last-child').getBoundingClientRect();
        const over = [...document.querySelectorAll('#invite-modal *')].filter(el => el.getBoundingClientRect().right > md.right + 0.5).length;
        const btns = [...document.querySelectorAll('#invite-modal .mw-btn')].map(b => Math.round(b.getBoundingClientRect().height));
        const fields = [...document.querySelectorAll('#invite-modal .mw-field')].map(f => Math.round(f.getBoundingClientRect().height));
        const r = { fits: md.right <= window.innerWidth + 0.5 && md.left >= -0.5, over, btns, fields, bodyScroll: document.body.scrollWidth };
        document.getElementById('invite-cancel').click(); return r; })()`);
      check('★ ' + w + 'px: the Invite modal fits the viewport, nothing escapes it, both buttons and every field at the floor', modal.fits && modal.over === 0 && modal.btns.length === 2 && modal.btns.every((h) => h >= 44) && modal.fields.every((h) => h >= 44) && modal.bodyScroll <= w, JSON.stringify(modal));
    }

    console.log('\n--- 320px through a real same-origin iframe ---\n');
    await desktop(cdp, 1440);
    await goto(cdp, URL_);
    await cdp.evaluate(INV_WAIT);
    const iframe = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelectorAll('#mw320').forEach(n => n.remove());
      const f = document.createElement('iframe'); f.id = 'mw320'; f.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:760px;border:0;z-index:99999'; f.src = '/admin-clients.html';
      document.body.appendChild(f);
      for (let i = 0; i < 300; i++) { try { const dd = f.contentDocument; if (dd && dd.querySelectorAll('.cl-ir').length >= 3 && dd.querySelectorAll('.cl-tr').length > 0) break; } catch (e) {} await nap(200); }
      await nap(1200);
      const dd = f.contentDocument, w = f.contentWindow;
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = w.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const rects = [...dd.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
      const rows = [...dd.querySelectorAll('.cl-ir')].map(r => ({ name: vis(r.querySelector('.cl-inm b')), pill: vis(r.querySelector('.cl-istat')), btns: [...r.querySelectorAll('button')].map(b => { const q = b.getBoundingClientRect(); return { h: Math.round(q.height), w: Math.round(q.width), inside: q.right <= r.getBoundingClientRect().right + 0.5 }; }) }));
      return { inner: w.innerWidth, bodyScroll: dd.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)), rows };
    })()`);
    check('320px (real iframe): the viewport is genuinely 320', iframe.inner === 320, String(iframe.inner));
    check('★ 320px: nothing scrolls horizontally', iframe.bodyScroll <= 321 && iframe.maxRight <= 321, JSON.stringify({ b: iframe.bodyScroll, m: iframe.maxRight }));
    check('★ 320px: every row keeps its name and pill, and every control meets the floor inside its row', iframe.rows.length >= 3 && iframe.rows.every((r) => r.name && r.pill && r.btns.every((b) => b.h >= 44 && b.w >= 44 && b.inside)), JSON.stringify(iframe.rows));

    // The empty state, measured for real: remove this run's rows, then confirm nothing else is out.
    for (const id of [sentId, openedId, expiredId]) await admin.from('client_invitations').delete().eq('id', id);
    const { count: othersOut } = await admin.from('client_invitations').select('*', { count: 'exact', head: true }).in('status', ['sent', 'opened', 'expired']);
    if (othersOut === 0) {
      const EMPTY_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelector('[data-cl-inv-empty]')) break; await nap(200); } await nap(900); })()`;
      runContrast('client-invitations-empty', 'the empty state ("No invitations out")', adminBootstrap, EMPTY_PREP, URL_);
    } else console.log('  (info) ' + othersOut + ' invitation(s) from other runs are out — the empty state is not measurable on this stack right now');
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (_e) { /* closing anyway */ } try { cdp.chrome.kill(); } catch (_e) { /* gone */ } }
    if (profile) await releaseTempDir(profile, cdp && cdp.chrome);
    if (server) { try { server.kill(); } catch (_e) { /* gone */ } }
    for (const id of cleanupInv) await admin.from('client_invitations').delete().eq('id', id);
    for (const id of cleanupUsers) {
      for (const kind of ['id', 'address']) {
        const { data: objs } = await admin.storage.from('identity-documents').list(id + '/' + kind, { limit: 100 });
        for (const o of (objs || [])) {
          const { data: inner } = await admin.storage.from('identity-documents').list(id + '/' + kind + '/' + o.name, { limit: 100 });
          const paths = (inner || []).map((f) => id + '/' + kind + '/' + o.name + '/' + f.name);
          if (paths.length) { const { error } = await admin.storage.from('identity-documents').remove(paths); if (error) console.log('  TEARDOWN WARNING  ' + error.message); }
        }
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log('  TEARDOWN WARNING  user ' + id + ': ' + error.message);
    }
    await admin.from('client_invitations').delete().like('email', '%' + suffix + '%');
    try { fs.unlinkSync(idFile); fs.unlinkSync(addrFile); } catch (_e) { /* fine */ }
  }

  console.log('\n' + passed + '/' + (passed + fails.length) + ' assertions passed.');
  console.log('CLIENT INVITATIONS VISUAL: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 1500000 });
