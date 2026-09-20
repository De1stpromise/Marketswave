// Task A — make signup's data actually persist (2026-09-18, register row 242).
// The end-to-end and visual half, in a REAL headless Chrome over CDP against the local stack.
//
//   PART A  A real signup through the real 9-step form with two real files, then EVERY field
//           read back from Postgres and BOTH files read back from Storage with the service
//           role — never from the UI. Includes the two fields that used to go nowhere (date
//           of birth, country of residence).
//   PART B  settings.html as that client: real data on the Onboarding card, no "not on file"
//           wording anywhere, the Request Change modal for a group built from the vocabulary;
//           then settings.html as a client who has NOT submitted: the honest empty state.
//   PART C  The PM profile: the Onboarding panel fills; identity documents render as metadata
//           with NO View, NO Request, NO disabled button — and a real admin session cannot
//           sign a URL for the file (the Task B enforcement, proven in the browser too).
//   PART D  The approval gate's application panel: real groups, real document metadata.
//   PART E  Gary, seeded before this existed, renders honestly on the profile.
//   PART F  Contrast (real composited pixels), the sheen audit, fonts, and 390/375 on a REAL
//           phone profile plus a real 320px iframe, on all three surfaces.
//
// Test data is created and removed here. Storage objects are removed with the service role
// (there is no client-side delete path by design); the test users cascade everything else.
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
const CHROME = process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
    .find((p) => fs.existsSync(p)) || 'chrome';

let passed = 0; const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing a non-local API_URL: ' + j.API_URL);
  return j;
}
function runChild(script, env, label) {
  const res = spawnSync(process.execPath, [script], { cwd: HERE, encoding: 'utf8', env: Object.assign({}, process.env, env), maxBuffer: 64 * 1024 * 1024 });
  forwardChildTeardown(res, label);
  if (!res.stdout && !res.stderr) console.log('  (child ' + label + ' printed nothing; status ' + res.status + ')');
  return (res.stdout || '') + (res.stderr || '');
}
function runContrast(profile, label, bootstrap, prepare, url) {
  const out = runChild('verify-contrast.mjs', {
    CONTRAST_PROFILE: profile, CONTRAST_URL: url, CONTRAST_BOOTSTRAP_JS: bootstrap,
    CONTRAST_PREPARE_JS: prepare || '', CONTRAST_WIDTHS: '1440', CONTRAST_SETTLE_MS: '4000', CONTRAST_PORT: String(9700 + Math.floor(Math.random() * 200))
  }, 'verify-contrast:' + profile);
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ');
  check(label + ': measured real elements (not an empty run)', m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
}
function runFonts(bootstrap, url) {
  const out = runChild('audit-fonts.mjs', { AUDIT_URL: url, AUDIT_BOOTSTRAP_JS: bootstrap }, 'audit-fonts');
  check('no font falls back', !/FALLBACK/.test(out), out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check('no monospace family anywhere', !/JetBrains|monospace/i.test(out));
}

// --- CDP ------------------------------------------------------------------------------------
async function connect(profile) {
  const PORT = 9400 + Math.floor(Math.random() * 300);
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); }
    catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const consoleLog = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'warning' || m.params.type === 'error')) {
      consoleLog.push(m.params.type + ': ' + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') consoleLog.push('exception: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
  });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('DOM.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { chrome, ws, send, evaluate, consoleLog };
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
  // A page whose own load-time guard redirects (settings.html without a session → login.html)
  // can navigate out from under an in-flight evaluate; that is not a failure of the page under
  // test, so the readiness poll tolerates it and simply polls again on the new document.
  for (let i = 0; i < 80; i++) {
    await sleep(200);
    // Row 231's shape, seen here 2026-09-20: the about:blank interstitial is itself "complete"
    // with a body, so a poll that does not ALSO check where it is can accept the blank page,
    // hand a long WAIT evaluate to it, and have the real navigation tear that evaluate down
    // ("Inspected target navigated or closed") after every assertion had already passed.
    try { if (await cdp.evaluate('document.readyState === "complete" && !!document.body && location.href !== "about:blank"')) break; } catch (_e) { /* navigated mid-poll */ }
  }
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
const PHONE_READ = (extra) => `(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const rects = [...document.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
  return Object.assign({
    inner: window.innerWidth, bodyScroll: document.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)),
    dpr: window.devicePixelRatio, coarse: window.matchMedia('(pointer: coarse)').matches, noHover: window.matchMedia('(hover: none)').matches, touchPoints: navigator.maxTouchPoints
  }, (${extra})(vis));
})()`;

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const storageKey = 'sb-' + new URL(st.API_URL).hostname.split('.')[0] + '-auth-token';
  const suffix = crypto.randomBytes(3).toString('hex');
  const email = 'taska-' + suffix + '@test.marketswave.local';
  const PASSWORD = 'TaskA-Persist-2026!';
  const idFile = path.join(os.tmpdir(), 'taska-passport-' + suffix + '.pdf');
  const addrFile = path.join(os.tmpdir(), 'taska-utility-' + suffix + '.pdf');
  fs.writeFileSync(idFile, '%PDF-1.4 TASK-A PASSPORT ' + suffix);
  fs.writeFileSync(addrFile, '%PDF-1.4 TASK-A UTILITY BILL ' + suffix);
  const cleanupIds = [];
  let server = null, profile = null, cdp = null;
  const admSigned = await anon().auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (admSigned.error) throw new Error('admin sign-in: ' + admSigned.error.message);
  const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(admSigned.data.session)) + '); true';

  try {
    server = spawn('python', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/signup.html'); break; } catch (_e) { await sleep(250); } }
    profile = makeTempDir('mw-taska-');
    cdp = await connect(profile);
    await desktop(cdp, 1440);

    // =========================================================================================
    console.log('\n=== PART A — a real signup, every field read back from Postgres and Storage ===\n');
    await goto(cdp, BASE + '/signup.html');
    check('signup.html loaded (step 1 active)', (await cdp.evaluate(ACTIVE_STEP)) === '1');
    // Step 1 is a card CLICK (the page's own handler sets accountType) and its own Continue
    // button, not the generic [data-next] the later steps use.
    await cdp.evaluate('(() => { document.querySelector(\'.account-type-card[data-value="individual"]\').click(); return true; })()');
    await sleep(200);
    await cdp.evaluate('(() => { document.getElementById("btn-continue-1").click(); return true; })()');
    await sleep(600);
    check('step 1 → 2', (await cdp.evaluate(ACTIVE_STEP)) === '2', await cdp.evaluate(ACTIVE_STEP));
    await cdp.evaluate(`(() => {
      const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
      set('full_name', 'Task A Verifier'); set('email', ${JSON.stringify(email)}); set('phone', '+47 400 00 000');
      set('password', ${JSON.stringify(PASSWORD)}); set('password_confirm', ${JSON.stringify(PASSWORD)});
      set('date_of_birth', '1988-04-12'); set('country', 'NO'); return true; })()`);
    check('step 2 → next (personal details accepted, incl. a real date of birth and country)', (await nextStep(cdp)) !== '2');
    // drive forward, answering every remaining step with DISTINCTIVE values
    const ANSWERS = {
      investable_assets: '1m-5m', source_of_wealth: 'inheritance', employment: 'Marine engineer',
      investment_goal: 'retirement', time_horizon: '15-plus', risk_comfort: 'high',
      risk_knowledge: 'advanced', risk_reaction: 'buy-more', risk_objective: 'aggressive', risk_horizon: '15-plus', risk_liquidity: 'not', risk_experience: 'regularly'
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
    check('reached step 8 (Document Upload)', (await cdp.evaluate(ACTIVE_STEP)) === '8');
    await setFile(cdp, '#signup-upload-id', idFile);
    await setFile(cdp, '#signup-upload-address', addrFile);
    check('step 8 → 9 with both real files chosen', (await nextStep(cdp)) === '9');
    await cdp.evaluate('(() => { ["consent-terms","consent-accuracy"].forEach(id => { const c = document.getElementById(id); c.checked = true; c.dispatchEvent(new Event("change", {bubbles:true})); }); document.getElementById("btn-submit").click(); return true; })()');
    let landed = '';
    for (let i = 0; i < 150; i++) { await sleep(300); landed = await cdp.evaluate('location.pathname').catch(() => ''); if (/thank-you/.test(landed)) break; }
    check('★ the real submit landed on thank-you.html', /thank-you/.test(landed), landed);
    const pageWarnings = cdp.consoleLog.filter((l) => /submit-onboarding|identity document|non-fatal/i.test(l));
    check('★ the page logged NO non-fatal persistence failure during signup (both writes genuinely succeeded)', pageWarnings.length === 0, pageWarnings.join(' || ').slice(0, 400));

    const { data: clientRow } = await admin.from('clients').select('id, name, status, account_type').eq('email', email).maybeSingle();
    check('a real clients row exists (pending_review)', clientRow && clientRow.status === 'pending_review', JSON.stringify(clientRow));
    if (!clientRow) throw new Error('signup did not create a clients row; nothing below can run');
    const uid = clientRow.id; cleanupIds.push(uid);

    const { data: prof } = await admin.from('client_profiles').select('*').eq('client_id', uid).maybeSingle();
    check('★ client_profiles row written at signup', !!prof, 'no row');
    check('★ DATE OF BIRTH reached Postgres — it used to be read for the age check and dropped', prof && prof.date_of_birth === '1988-04-12', prof && prof.date_of_birth);
    check('★ COUNTRY OF RESIDENCE reached Postgres — no script ever read it before', prof && prof.country_of_residence === 'NO', prof && prof.country_of_residence);
    check('financial profile: the exact values chosen', prof && prof.financial_profile && prof.financial_profile.investableAssets === '1m-5m' && prof.financial_profile.sourceOfWealth === 'inheritance' && prof.financial_profile.employment === 'Marine engineer', JSON.stringify(prof && prof.financial_profile));
    check('goals & preferences: the exact values chosen', prof && prof.goals_preferences && prof.goals_preferences.investmentGoal === 'retirement' && prof.goals_preferences.timeHorizon === '15-plus' && prof.goals_preferences.riskComfort === 'high', JSON.stringify(prof && prof.goals_preferences));
    check('risk questionnaire: all six exact answers', prof && prof.risk_questionnaire && ['advanced', 'buy-more', 'aggressive', '15-plus', 'not', 'regularly'].join() === [prof.risk_questionnaire.knowledge, prof.risk_questionnaire.reaction, prof.risk_questionnaire.objective, prof.risk_questionnaire.horizon, prof.risk_questionnaire.liquidity, prof.risk_questionnaire.experience].join(), JSON.stringify(prof && prof.risk_questionnaire));
    check('legal name set server-side from the typed full name', prof && prof.legal_name && prof.legal_name.firstName === 'Task A' && prof.legal_name.lastName === 'Verifier', JSON.stringify(prof && prof.legal_name));
    check('onboarding_submitted_at set; entity/joint null for an Individual', prof && !!prof.onboarding_submitted_at && prof.entity_details === null && prof.joint_holder === null);

    const { data: idds } = await admin.from('identity_documents').select('*').eq('client_id', uid).order('kind');
    check('★ two identity_documents rows (address, id)', idds && idds.length === 2 && idds.map((d) => d.kind).join() === 'address,id', JSON.stringify(idds));
    for (const d of (idds || [])) {
      const dl = await admin.storage.from('identity-documents').download(d.storage_path);
      const text = dl.error ? null : await dl.data.text();
      const expected = fs.readFileSync(d.kind === 'id' ? idFile : addrFile, 'utf8');
      check('★ REAL BYTES IN STORAGE for ' + d.kind + ' (' + d.filename + '), byte-identical to the file chosen', !dl.error && text === expected, dl.error ? dl.error.message : 'size ' + (text || '').length);
      check('  path is inside the client\'s own folder', d.storage_path.indexOf(uid + '/' + d.kind + '/') === 0, d.storage_path);
    }

    // =========================================================================================
    console.log('\n=== PART B — settings.html shows submitted data; a second client shows the honest empty state ===\n');
    await admin.from('clients').update({ status: 'active', application_resolved_at: new Date().toISOString() }).eq('id', uid);
    const cs = await anon().auth.signInWithPassword({ email, password: PASSWORD });
    if (cs.error) throw new Error('client sign-in: ' + cs.error.message);
    const clientBootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(cs.data.session)) + ');' +
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(uid) + ');sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(uid) + ');true';
    const SETTINGS_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { const c = document.getElementById('onboarding-card'); if (c && !/animate-pulse/.test(c.innerHTML) && document.getElementById('countryOfResidence-display').textContent.trim().replace(/^—$/, '') !== '' && document.readyState === 'complete') break; await nap(200); }
      await nap(800); return true; })()`;
    await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(clientBootstrap);
    await goto(cdp, BASE + '/settings.html'); await cdp.evaluate(SETTINGS_WAIT);
    const SETTINGS_READ = `(() => {
      const t = (id) => (document.getElementById(id) || {}).textContent || '';
      const hidden = (id) => { const el = document.getElementById(id); return !el || el.classList.contains('hidden'); };
      return {
        onLogin: /login/.test(location.pathname),
        legal: t('legalName-display').trim(), dob: t('dateOfBirth-display').trim(), country: t('countryOfResidence-display').trim(),
        fin: t('financialProfile-display').trim(), goals: t('goalsPreferences-display').trim(), risk: t('riskQuestionnaire-display').trim(),
        entityRowHidden: document.querySelector('[data-onboarding-group="entityDetails"]').classList.contains('hidden'),
        jointRowHidden: document.querySelector('[data-onboarding-group="jointHolder"]').classList.contains('hidden'),
        hintsShown: [...document.querySelectorAll('[id$="-empty-hint"]')].filter(e => !e.classList.contains('hidden')).map(e => e.id),
        noteHidden: hidden('onboarding-unsubmitted-note'),
        onFile: /not on file/i.test(document.body.innerText),
        reqButtons: [...document.querySelectorAll('#onboarding-card .request-change-btn')].filter(b => !b.closest('.hidden') && !b.classList.contains('hidden')).map(b => b.dataset.field),
        dobHasButton: !!document.querySelector('[data-field-row="dateOfBirth"] .request-change-btn')
      };
    })()`;
    let sr = await cdp.evaluate(SETTINGS_READ);
    check('settings.html rendered for the new client (not bounced to login)', !sr.onLogin);
    check('★ legal name shows the typed name — not "not on file"', sr.legal === 'Task A Verifier', sr.legal);
    check('★ date of birth shows the submitted date', /12 April 1988/.test(sr.dob), sr.dob);
    check('★ country of residence shows the form\'s own label (Norway)', sr.country === 'Norway', sr.country);
    check('★ financial profile shows the form\'s own option text', /\$1M – \$5M/.test(sr.fin) && /Inheritance \/ Gift/.test(sr.fin) && /Marine engineer/.test(sr.fin), sr.fin);
    check('goals show the form\'s own option text', /Retirement Planning/.test(sr.goals) && /More than 15 years/.test(sr.goals) && /Comfortable with larger swings/.test(sr.goals), sr.goals);
    check('risk questionnaire shows all six answers', /Advanced/.test(sr.risk) && /Buy more/.test(sr.risk) && /Aggressive growth/.test(sr.risk) && /Not important/.test(sr.risk) && /Regularly/.test(sr.risk), sr.risk);
    check('entity and joint rows are hidden for an Individual account', sr.entityRowHidden && sr.jointRowHidden);
    check('no not-submitted hint shows for the submitted groups', sr.hintsShown.filter((h) => !/address|idDocument/.test(h)).length === 0, JSON.stringify(sr.hintsShown));
    check('the unsubmitted note is hidden', sr.noteHidden === true);
    check('★ the words "not on file" appear NOWHERE on the page', sr.onFile === false);
    check('★ Request Change is offered for the four applicable groups and NOT for date of birth', sr.reqButtons.join() === 'countryOfResidence,financialProfile,goalsPreferences,riskQuestionnaire' && sr.dobHasButton === false, JSON.stringify(sr.reqButtons) + ' dob:' + sr.dobHasButton);

    // The group modal, built from the vocabulary; a real request through it.
    await cdp.evaluate('(() => { document.querySelector(\'.request-change-btn[data-field="goalsPreferences"]\').click(); return true; })()');
    await sleep(400);
    const modal = await cdp.evaluate(`(() => ({
      open: !document.getElementById('change-modal').classList.contains('hidden'),
      title: document.getElementById('change-modal-title').textContent,
      groupBodyShown: !document.querySelector('[data-body="group"]').classList.contains('hidden'),
      selects: [...document.querySelectorAll('#cm-group-fields select')].map(s => s.getAttribute('data-group-field') + ':' + s.options.length),
      current: document.getElementById('cm-group-current').textContent,
      labels: [...document.querySelectorAll('#cm-group-fields label')].map(l => l.textContent)
    }))()`);
    check('the Request Change modal opens the generic group body for Goals & Preferences', modal.open && modal.groupBodyShown && /Goals/.test(modal.title), JSON.stringify(modal));
    check('★ it is built from the vocabulary: three selects with the form\'s own options (+ a placeholder)', modal.selects.join() === 'investmentGoal:5,timeHorizon:5,riskComfort:4', JSON.stringify(modal.selects));
    check('  the current value is shown from the real record', /Retirement Planning/.test(modal.current), modal.current);
    await cdp.evaluate('(() => { document.getElementById("change-modal-submit").click(); return true; })()');
    await sleep(300);
    const preErr = await cdp.evaluate('document.getElementById("change-modal-error").textContent');
    check('an empty request is refused BEFORE the round trip, with the vocabulary\'s own message', /at least one field/i.test(preErr), preErr);
    await cdp.evaluate('(() => { const s = document.getElementById("cm-g-riskComfort"); s.value = "moderate"; s.dispatchEvent(new Event("change",{bubbles:true})); document.getElementById("change-modal-submit").click(); return true; })()');
    let req = null;
    for (let i = 0; i < 50; i++) { await sleep(300); const { data } = await admin.from('profile_change_requests').select('*').eq('client_id', uid).eq('field', 'goalsPreferences').maybeSingle(); if (data) { req = data; break; } }
    check('★ a real goalsPreferences change request landed in Postgres through the real modal', !!req && req.status === 'pending' && req.requested_value && req.requested_value.riskComfort === 'moderate', JSON.stringify(req));
    check('  current_value was snapshotted server-side from the real record', !!req && req.current_value && req.current_value.investmentGoal === 'retirement', JSON.stringify(req && req.current_value));
    await sleep(1500);
    sr = await cdp.evaluate(SETTINGS_READ);
    check('  the row now shows Pending Review and no Request Change button', sr.reqButtons.indexOf('goalsPreferences') === -1, JSON.stringify(sr.reqButtons));

    // a client who has NOT submitted — the honest empty state
    const e2 = 'taska-empty-' + suffix + '@test.marketswave.local';
    const cu = await admin.auth.admin.createUser({ email: e2, password: PASSWORD, email_confirm: true });
    if (cu.error) throw cu.error;
    const uid2 = cu.data.user.id; cleanupIds.push(uid2);
    await admin.from('clients').insert({ id: uid2, name: 'Before Persistence', email: e2, phone: '+1 555 0102', account_type: 'Joint Account', status: 'active' });
    await admin.from('client_profiles').insert({ client_id: uid2, legal_name: { firstName: 'Before', lastName: 'Persistence' } }); // exactly the backfill shape
    const cs2 = await anon().auth.signInWithPassword({ email: e2, password: PASSWORD });
    const client2Bootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(cs2.data.session)) + ');' +
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(uid2) + ');sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(uid2) + ');true';
    await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(client2Bootstrap);
    await goto(cdp, BASE + '/settings.html'); await cdp.evaluate(SETTINGS_WAIT);
    const se = await cdp.evaluate(SETTINGS_READ);
    check('the pre-persistence client renders', !se.onLogin);
    check('★ the backfilled legal name shows (the one recoverable piece)', se.legal === 'Before Persistence', se.legal);
    check('★ every onboarding group shows "—" with the NOT-SUBMITTED hint', se.country === '—' && se.fin === '—' && se.risk === '—' && ['countryOfResidence', 'financialProfile', 'goalsPreferences', 'riskQuestionnaire', 'jointHolder', 'dateOfBirth', 'address', 'idDocument'].every((k) => se.hintsShown.indexOf(k + '-empty-hint') !== -1), JSON.stringify(se.hintsShown));
    check('★ the unsubmitted note is shown, and the words "not on file" appear nowhere', se.noteHidden === false && se.onFile === false);
    check('a Joint account sees the joint-holder group (and not the entity one)', se.jointRowHidden === false && se.entityRowHidden === true);
    const hintText = await cdp.evaluate('document.getElementById("financialProfile-empty-hint").textContent');
    check('  the hint says "not submitted", never that something was lost', /not submitted/i.test(hintText) && !/on file/i.test(hintText), hintText);

    // =========================================================================================
    console.log('\n=== PART C — the PM profile: onboarding fills; identity documents are metadata with no control ===\n');
    const PROFILE_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { if (document.querySelector('#cp-onboarding .cp-kv') && document.querySelector('#cp-identity .cp-strip') && document.querySelectorAll('.an-item').length === 10 && document.readyState === 'complete') break; await nap(200); }
      await nap(800); return true; })()`;
    const PROFILE_READ = `(() => {
      const t = (s) => (document.querySelector(s) || {}).textContent || '';
      return {
        onLogin: /login/.test(location.pathname),
        text: document.getElementById('cp-onboarding').innerText,
        groups: [...document.querySelectorAll('#cp-onboarding [data-cp-group]')].map(g => g.dataset.cpGroup),
        unsub: [...document.querySelectorAll('#cp-onboarding .cp-unsub')].map(u => u.dataset.cpUnsubmitted),
        absent: !!document.querySelector('[data-cp-absent="onboarding"]'),
        idd: [...document.querySelectorAll('[data-cp-idd-row]')].map(r => r.innerText),
        iddButtons: document.querySelectorAll('[data-cp-idd] button, [data-cp-idd] a, [data-cp-idd] [disabled]').length,
        iddLocked: !!document.querySelector('[data-cp-idd] [data-cp-locked]'),
        iddEmpty: !!document.querySelector('[data-cp-idd-empty]'),
        docsSection: document.querySelector('#cp-documents') ? document.querySelector('#cp-documents').innerText : ''
      };
    })()`;
    await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(adminBootstrap);
    await goto(cdp, BASE + '/admin-client-profile.html?client=' + uid); await cdp.evaluate(PROFILE_WAIT);
    let pr = await cdp.evaluate(PROFILE_READ);
    check('the profile rendered for the new client', !pr.onLogin);
    check('★ the Onboarding panel fills: date of birth, country, and the three groups with the form\'s own labels', /12 April 1988/.test(pr.text) && /Norway/.test(pr.text) && /Inheritance \/ Gift/.test(pr.text) && /Retirement Planning/.test(pr.text) && /Buy more/.test(pr.text), pr.text.slice(0, 300));
    check('  groups render for the account type (no entity/joint for an Individual)', pr.groups.join() === 'countryOfResidence,financialProfile,goalsPreferences,riskQuestionnaire', JSON.stringify(pr.groups));
    check('  nothing reads "Not submitted" and no absence note shows for a client who submitted', pr.unsub.length === 0 && pr.absent === false, JSON.stringify(pr.unsub));
    check('★ both identity documents render as metadata (type · filename · upload date)', pr.idd.length === 2 && /Photo ID/.test(pr.idd.join()) && /Proof of address/.test(pr.idd.join()) && /taska-passport/.test(pr.idd.join()), JSON.stringify(pr.idd));
    // Task B (row 246): each identity document now carries exactly one control — "Open", which
    // goes through the reason-required, permanently-logged modal — and the note says so.
    const openCtl = await cdp.evaluate('({ open: document.querySelectorAll("[data-cp-idd-view]").length, direct: document.querySelectorAll("[data-cp-idd] a[href*=storage]").length, buttons: document.querySelectorAll("[data-cp-idd] button").length })');
    check('★ exactly one control per identity document (Open), and it is the logged path, not a direct link', openCtl.open === 2 && openCtl.buttons === 2 && openCtl.direct === 0, JSON.stringify(openCtl));
    check('★ the note states that every open is access-logged and cannot be edited or removed', pr.iddLocked === true && /access-logged/i.test(await cdp.evaluate('document.querySelector("[data-cp-idd] .cp-locked p").textContent')));
    // the Task B enforcement, proven from the PM's own real browser session
    const pmSign = await cdp.evaluate(`(async () => {
      const { supabase } = await import('./admin-supabase-config.js');
      const r = await supabase.storage.from('identity-documents').createSignedUrl(${JSON.stringify(idds[0].storage_path)}, 60);
      const l = await supabase.storage.from('identity-documents').list(${JSON.stringify(uid)});
      return { signErr: r.error ? r.error.message : null, listed: (l.data || []).length, listErr: l.error ? l.error.message : null };
    })()`).catch((e) => ({ signErr: 'threw: ' + e.message, listed: -1 }));
    check('★★ from the PM\'s own real browser session: a signed URL for the identity document is REFUSED and the client\'s folder lists as empty', !!pmSign.signErr && !/threw/.test(pmSign.signErr) && pmSign.listed === 0, JSON.stringify(pmSign));

    // =========================================================================================
    console.log('\n=== PART D — the approval gate\'s application panel ===\n');
    await admin.from('clients').update({ status: 'pending_review', application_resolved_at: null }).eq('id', uid);
    const GATE_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300; i++) { const q = document.getElementById('ag-queue'); if (q && !/animate-pulse/.test(q.innerHTML) && document.querySelectorAll('.an-item').length === 10 && (q.querySelectorAll('.ag-row').length > 0 || q.querySelector('.ag-empty'))) break; await nap(200); }
      await nap(600); return true; })()`;
    await goto(cdp, BASE + '/admin-approvals.html'); await cdp.evaluate(GATE_WAIT);
    const gate = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      const row = document.querySelector('#ag-queue .ag-row[data-kind="app"][data-id="${uid}"]');
      if (!row) return { found: false, rows: [...document.querySelectorAll('#ag-queue .ag-row')].map(r => r.dataset.kind + ':' + r.dataset.id).slice(0, 10) };
      row.click();
      for (let i = 0; i < 60; i++) { if (!document.getElementById('ag-scrim').hidden && document.getElementById('ag-pane').innerHTML.length > 0) break; await nap(100); }
      await nap(600);
      const pane = document.getElementById('ag-pane');
      return { found: true, text: pane.innerText, unsub: pane.querySelectorAll('.ag-unsub').length, onfile: pane.querySelectorAll('.ag-onfile').length,
        locked: !!pane.querySelector('[data-ag-idd-locked]'), iddControls: pane.querySelectorAll('[data-ag-idd-view]').length, iddDirect: pane.querySelectorAll('a[href*="storage"]').length,
        stale: /no server-side storage|register row 224/i.test(pane.innerText) };
    })()`);
    check('the new application is in the gate\'s queue', gate.found === true, JSON.stringify(gate.rows));
    check('★ the panel shows the real onboarding record with the form\'s own labels', gate.found && /12 April 1988/.test(gate.text) && /Norway/.test(gate.text) && /Marine engineer/.test(gate.text) && /Aggressive growth/.test(gate.text), (gate.text || '').slice(0, 300));
    check('  nothing on the panel reads "Not submitted" for this applicant', gate.unsub === 0, String(gate.unsub));
    check('★ both identity documents are listed "On file" with one Open control each (the logged path), and the access-logged note is present', gate.onfile === 2 && gate.iddControls === 2 && gate.iddDirect === 0 && gate.locked === true, JSON.stringify({ onfile: gate.onfile, c: gate.iddControls, d: gate.iddDirect, l: gate.locked }));
    check('★ the old "no server-side storage" copy is gone', gate.stale === false);

    // =========================================================================================
    console.log('\n=== PART E — Gary, seeded before this existed ===\n');
    const { data: gary } = await admin.from('clients').select('id').ilike('name', '%Gary Sizemore%').maybeSingle();
    if (!gary) { console.log('  SKIP  Gary is not seeded (node seed-client-gary.mjs)'); }
    else {
      await goto(cdp, BASE + '/admin-client-profile.html?client=' + gary.id); await cdp.evaluate(PROFILE_WAIT);
      pr = await cdp.evaluate(PROFILE_READ);
      check('Gary\'s profile renders', !pr.onLogin && /Sizemore/.test(pr.text));
      check('★ Gary shows "Not submitted" for every group and the honest absence note — nothing invented', pr.unsub.length >= 4 && pr.absent === true, JSON.stringify(pr.unsub));
      check('★ Gary has no identity documents on file, and the panel says so', pr.iddEmpty === true && pr.idd.length === 0);
      check('  the note says "not submitted"/"never asked", never "not on file"', !/not on file/i.test(pr.text));
    }

    // =========================================================================================
    console.log('\n=== PART F — contrast, sheen, fonts, and real phone widths ===\n');
    const PROF_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelector('#cp-onboarding .cp-kv') && document.querySelector('[data-cp-idd]')) break; await nap(200); } await nap(900); })()`;
    runContrast('client-profile-onboarding', 'the profile\'s onboarding + identity block (submitted client)', adminBootstrap, PROF_PREP, BASE + '/admin-client-profile.html?client=' + uid);
    if (gary) runContrast('client-profile-onboarding', 'the profile\'s onboarding block (Gary, unsubmitted)', adminBootstrap, `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelector('#cp-onboarding .cp-kv') && document.querySelector('[data-cp-idd-empty]')) break; await nap(200); } await nap(900); })()`, BASE + '/admin-client-profile.html?client=' + gary.id);
    const SET_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { const c = document.getElementById('onboarding-card'); if (c && !/animate-pulse/.test(c.innerHTML) && document.getElementById('countryOfResidence-display').textContent.trim().replace(/^—$/, '') !== '') break; await nap(200); } await nap(900); })()`;
    runContrast('settings-onboarding', 'settings (submitted client)', clientBootstrap, SET_PREP, BASE + '/settings.html');
    runContrast('settings-onboarding', 'settings (honest empty state)', client2Bootstrap, SET_PREP, BASE + '/settings.html');
    runContrast('settings-onboarding-modal', 'the group Request Change modal', clientBootstrap, SET_PREP + `.then(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); const real = (id) => { const e = document.getElementById(id); const t = e ? e.textContent.trim() : ''; return t !== '' && t !== '—'; }; for (let i = 0; i < 200; i++) { if (real('financialProfile-display')) break; await nap(100); } document.querySelector('.request-change-btn[data-field="financialProfile"]').click(); for (let i = 0; i < 80; i++) { if (real('cm-group-current')) break; await nap(100); } await nap(400); })`, BASE + '/settings.html');
    const GATE_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { const q = document.getElementById('ag-queue'); if (q && !/animate-pulse/.test(q.innerHTML) && q.querySelector('.ag-row[data-id="${uid}"]')) break; await nap(200); } document.querySelector('.ag-row[data-id="${uid}"]').click(); for (let i = 0; i < 60; i++) { if (!document.getElementById('ag-scrim').hidden && document.getElementById('ag-pane').innerHTML.length > 0) break; await nap(100); } await nap(800); })()`;
    runContrast('approval-gate-application', 'the approval gate application panel', adminBootstrap, GATE_PREP, BASE + '/admin-approvals.html');

    const sheen = runChild('audit-glass-sheen.mjs', { SHEEN_PAGES: 'admin-client-profile.html?client=' + uid, SHEEN_BOOTSTRAP_JS: adminBootstrap }, 'audit-glass-sheen');
    check('sheen audit (profile) passed with the sheen composited', /SHEEN SWEEP: PASS/.test(sheen), sheen.slice(-300));
    const sheen2 = runChild('audit-glass-sheen.mjs', { SHEEN_PAGES: 'settings.html', SHEEN_BOOTSTRAP_JS: clientBootstrap }, 'audit-glass-sheen');
    check('sheen audit (settings) passed with the sheen composited', /SHEEN SWEEP: PASS/.test(sheen2), sheen2.slice(-300));
    runFonts(clientBootstrap, BASE + '/settings.html');

    for (const w of [390, 375]) {
      await phone(cdp, w);
      await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(clientBootstrap);
      await goto(cdp, BASE + '/settings.html'); await cdp.evaluate(SETTINGS_WAIT);
      const m = await cdp.evaluate(PHONE_READ(`(vis) => ({
        onLogin: /login/.test(location.pathname),
        cardVis: vis(document.getElementById('onboarding-card')),
        rows: [...document.querySelectorAll('#onboarding-card [data-field-row]')].filter(r => !r.classList.contains('hidden')).map(r => ({ v: vis(r.querySelector('[id$="-display"]')), b: !r.querySelector('.request-change-btn') || vis(r.querySelector('.request-change-btn')) || vis(r.querySelector('.pending-badge')) })),
        fin: document.getElementById('financialProfile-display').textContent
      })`));
      check('★ ' + w + 'px settings: a REAL PHONE PROFILE (DPR 3, coarse pointer, no hover)', m.dpr === 3 && m.coarse && m.noHover, JSON.stringify({ dpr: m.dpr, c: m.coarse, h: m.noHover }));
      check(w + 'px settings: viewport is genuinely ' + w, m.inner === w, String(m.inner));
      check(w + 'px settings: nothing scrolls horizontally', m.bodyScroll <= w && m.maxRight <= w + 1, JSON.stringify({ b: m.bodyScroll, m: m.maxRight }));
      check('★ ' + w + 'px settings: every onboarding row keeps its value AND its control on screen', !m.onLogin && m.cardVis && m.rows.length >= 5 && m.rows.every((r) => r.v && r.b), JSON.stringify(m.rows));
      check(w + 'px settings: the group value still reads fully', /Marine engineer/.test(m.fin), m.fin);

      await goto(cdp, BASE + '/admin-client-profile.html?client=' + uid); await cdp.evaluate(PROFILE_WAIT);
      const p2 = await cdp.evaluate(PHONE_READ(`(vis) => ({
        groups: [...document.querySelectorAll('#cp-onboarding [data-cp-group]')].map(g => vis(g)),
        idd: [...document.querySelectorAll('[data-cp-idd-row]')].map(r => vis(r)),
        locked: vis(document.querySelector('[data-cp-idd] [data-cp-locked]')),
        nav: document.querySelectorAll('.an-item').length
      })`));
      check(w + 'px profile: nothing scrolls horizontally', p2.bodyScroll <= w && p2.maxRight <= w + 1, JSON.stringify({ b: p2.bodyScroll, m: p2.maxRight }));
      check('★ ' + w + 'px profile: every onboarding group, both identity rows and the not-available note survive', p2.groups.length === 4 && p2.groups.every(Boolean) && p2.idd.length === 2 && p2.idd.every(Boolean) && p2.locked, JSON.stringify(p2));
      check(w + 'px profile: the nav is mounted (ten items)', p2.nav === 10, String(p2.nav));

      await goto(cdp, BASE + '/admin-approvals.html'); await cdp.evaluate(GATE_WAIT);
      const g2 = await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
        const row = document.querySelector('#ag-queue .ag-row[data-id="${uid}"]'); if (!row) return { found: false };
        row.click(); for (let i = 0; i < 60; i++) { if (!document.getElementById('ag-scrim').hidden && document.getElementById('ag-pane').innerHTML.length > 0) break; await nap(100); } await nap(600);
        const pane = document.getElementById('ag-pane'); const r = pane.getBoundingClientRect();
        const rects = [...pane.querySelectorAll('*')].map(e => e.getBoundingClientRect());
        return { found: true, paneRight: Math.round(r.right), maxRight: Math.max(0, ...rects.map(x => x.right)), inner: innerWidth, onfile: pane.querySelectorAll('.ag-onfile').length, text: pane.innerText.slice(0, 200) };
      })()`);
      check('★ ' + w + 'px gate: the application panel opens with both documents on file and nothing escaping the panel', g2.found && g2.onfile === 2 && g2.maxRight <= g2.inner + 1, JSON.stringify(g2));
    }

    // 320px through a real same-origin iframe (the top-level override floors at ~348px here).
    await desktop(cdp, 1440);
    await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(clientBootstrap);
    await goto(cdp, BASE + '/settings.html'); await cdp.evaluate(SETTINGS_WAIT);
    const iframe = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelectorAll('#mw320').forEach(n => n.remove());
      const f = document.createElement('iframe'); f.id = 'mw320'; f.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:760px;border:0;z-index:99999'; f.src = '/settings.html'; document.body.appendChild(f);
      for (let i = 0; i < 300; i++) { try { const dd = f.contentDocument; const c = dd && dd.getElementById('onboarding-card'); if (c && !/animate-pulse/.test(c.innerHTML) && dd.getElementById('countryOfResidence-display').textContent.trim().replace(/^—$/, '') !== '') break; } catch (e) {} await nap(200); }
      await nap(1200);
      const dd = f.contentDocument, w = f.contentWindow;
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = w.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const rects = [...dd.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
      return { inner: w.innerWidth, bodyScroll: dd.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)),
        rows: [...dd.querySelectorAll('#onboarding-card [data-field-row]')].filter(r => !r.classList.contains('hidden')).map(r => vis(r.querySelector('[id$="-display"]'))),
        country: dd.getElementById('countryOfResidence-display').textContent.trim() };
    })()`);
    check('320px (real iframe): the viewport is genuinely 320', iframe.inner === 320, String(iframe.inner));
    check('★ 320px settings: nothing scrolls horizontally', iframe.bodyScroll <= 321 && iframe.maxRight <= 321, JSON.stringify({ b: iframe.bodyScroll, m: iframe.maxRight }));
    check('★ 320px settings: every onboarding value survives', iframe.rows.length >= 5 && iframe.rows.every(Boolean) && iframe.country === 'Norway', JSON.stringify(iframe));
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (_e) { /* closing anyway */ } try { cdp.chrome.kill(); } catch (_e) { /* already gone */ } }
    if (profile) await releaseTempDir(profile, cdp && cdp.chrome);
    if (server) { try { server.kill(); } catch (_e) { /* already gone */ } }
    for (const id of cleanupIds) {
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
    try { fs.unlinkSync(idFile); fs.unlinkSync(addrFile); } catch (_e) { /* fine */ }
  }

  console.log('\n' + passed + '/' + (passed + fails.length) + ' assertions passed.');
  console.log('ONBOARDING PERSISTENCE VISUAL: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 1200000 });
