// Task B — access logging for identity documents (2026-09-18, register row 246).
// The browser half, in a REAL headless Chrome over CDP against the local stack.
//
//   PART A  The profile: the Open control on a real identity document opens the shared modal;
//           a short reason keeps Submit disabled with a live count; a real reason produces a
//           real window.open (captured), whose URL serves the client's REAL bytes; and a log
//           row exists in Postgres with who / whose / which / why / when.
//   PART B  The approval gate: the same control on the application panel, same modal, same
//           result — one shared component, proven from both surfaces.
//   PART C  admin-security.html: the access log renders every row — the opens from A and B,
//           and a refused non-PM attempt made directly — newest first, with the refusal reason.
//   PART D  Contrast on the modal and the log (real composited pixels), the sheen audit,
//           fonts, and 390/375 on a REAL phone profile plus a real 320px iframe.
//
// Rows written to the access log are PERMANENT by design (no delete path exists for anyone);
// each names this suite in its reason. The test client, its file and its rows in every other
// table are removed.
import { execSync, spawnSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTempDir, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';
import { adminNavItemCount } from './lib/admin-nav-count.mjs';

// ★ Derived from admin-sidebar.js's own NAV_ITEMS, never retyped — see lib/admin-nav-count.mjs.
const NAV_COUNT = adminNavItemCount();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p)) || 'chrome';

let passed = 0; const fails = [];
function check(label, cond, detail) { if (cond) { passed++; console.log('  PASS  ' + label); } else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function localStack() {
  const j = JSON.parse(execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, ''));
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
  const out = runChild('verify-contrast.mjs', { CONTRAST_PROFILE: profile, CONTRAST_URL: url, CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: prepare || '', CONTRAST_WIDTHS: '1440', CONTRAST_SETTLE_MS: '4000', CONTRAST_PORT: String(9700 + Math.floor(Math.random() * 200)) }, 'verify-contrast:' + profile);
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ');
  check(label + ': measured real elements (not an empty run)', m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
}
async function connect(profile) {
  const PORT = 9400 + Math.floor(Math.random() * 300);
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 80 && !wsUrl; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); } }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { chrome, ws, send, evaluate };
}
async function phone(cdp, width) { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true }); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
async function desktop(cdp, width) { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 }); }
async function goto(cdp, url) {
  await cdp.send('Page.navigate', { url: 'about:blank' }); await sleep(120);
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) { await sleep(200); try { if (await cdp.evaluate('document.readyState === "complete" && !!document.body')) break; } catch (_e) { /* navigated mid-poll */ } }
  await sleep(600);
}

const PROFILE_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { if (document.querySelector('[data-cp-idd-view]') && document.querySelectorAll('.an-item').length === ${NAV_COUNT} && document.readyState === 'complete') break; await nap(200); }
  await nap(700); return true; })()`;
const GATE_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { const q = document.getElementById('ag-queue'); if (q && !/animate-pulse/.test(q.innerHTML) && document.querySelectorAll('.an-item').length === ${NAV_COUNT} && (q.querySelectorAll('.ag-row').length > 0 || q.querySelector('.ag-empty'))) break; await nap(200); }
  await nap(600); return true; })()`;
const SEC_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { const l = document.getElementById('idac-list'); if (l && !/Loading/.test(l.textContent) && (l.querySelector('[data-idac-table]') || l.querySelector('[data-idac-empty]')) && document.querySelectorAll('.an-item').length === ${NAV_COUNT}) break; await nap(200); }
  await nap(600); return true; })()`;
// Captures window.open instead of opening a tab: returns the href the component tried to open.
const CAPTURE_OPEN = `(() => { window.__opened = []; window.open = function (href) { window.__opened.push(String(href)); return { closed: false }; }; return true; })()`;
const MODAL_READ = `(() => { const m = document.getElementById('ida-modal'); const sub = document.getElementById('ida-submit');
  return { exists: !!m, open: !!m && !m.classList.contains('hidden'), disabled: sub ? sub.disabled : null, count: (document.getElementById('ida-count')||{}).textContent,
    error: (document.getElementById('ida-error')||{}).textContent, errorShown: !!(document.getElementById('ida-error') && !document.getElementById('ida-error').classList.contains('hidden')),
    desc: (document.getElementById('ida-desc')||{}).textContent, warn: (document.getElementById('ida-warn')||{}).textContent, opened: window.__opened || [] }; })()`;

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const RUN = 'verify-identity-document-access-visual ' + suffix;
  const PASSWORD = 'IdAccess-Visual-2026!';
  const cleanupIds = []; const objects = [];
  let server = null, profile = null, cdp = null;
  const admSigned = await anon().auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (admSigned.error) throw new Error('admin sign-in: ' + admSigned.error.message);
  const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(admSigned.data.session)) + '); true';

  try {
    // ---- fixture: a pending applicant with one real identity document -------------------------
    const email = 'idav-' + suffix + '@test.marketswave.local';
    const cu = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true }); if (cu.error) throw cu.error;
    const uid = cu.data.user.id; cleanupIds.push(uid);
    await admin.from('clients').insert({ id: uid, name: 'Ida Viewtest', email, phone: '+46 70 000 0099', account_type: 'Individual Account', status: 'pending_review' });
    const bytes = Buffer.from('%PDF-1.4 visual passport ' + suffix);
    const docId = crypto.randomUUID(); const objPath = uid + '/id/' + docId + '/passport-ida.pdf';
    const cs = await anon().auth.signInWithPassword({ email, password: PASSWORD }); if (cs.error) throw cs.error;
    const c = anon(); await c.auth.setSession({ access_token: cs.data.session.access_token, refresh_token: cs.data.session.refresh_token });
    const up = await c.storage.from('identity-documents').upload(objPath, bytes, { contentType: 'application/pdf' }); if (up.error) throw new Error('fixture upload: ' + up.error.message); objects.push(objPath);
    const ins = await c.from('identity_documents').insert({ id: docId, client_id: uid, kind: 'id', document_type: 'Government-issued Photo ID', filename: 'passport-ida.pdf', storage_path: objPath }); if (ins.error) throw new Error('fixture row: ' + ins.error.message);
    // a refused attempt by the client themselves (not a PM), so Part C has a refused row to show
    await fetch(st.API_URL + '/functions/v1/open-identity-document', { method: 'POST', headers: { apikey: st.ANON_KEY, Authorization: 'Bearer ' + cs.data.session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: docId, reason: RUN + ' — refused non-PM attempt' }) });
    await c.auth.signOut({ scope: 'local' });

    server = spawn('python', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/admin-client-profile.html'); break; } catch (_e) { await sleep(250); } }
    profile = makeTempDir('mw-idav-');
    cdp = await connect(profile);
    await desktop(cdp, 1440);
    await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(adminBootstrap);

    // =========================================================================================
    console.log('\n=== PART A — the profile: Open → reason-required modal → logged → real bytes ===\n');
    await goto(cdp, BASE + '/admin-client-profile.html?client=' + uid); await cdp.evaluate(PROFILE_WAIT); await cdp.evaluate(CAPTURE_OPEN);
    const before = (await admin.from('identity_document_access_log').select('id', { count: 'exact' }).eq('identity_document_id', docId).eq('outcome', 'opened')).count;
    check('GUARD: no opened row exists yet for the fixture document', before === 0, String(before));
    const ctl = await cdp.evaluate(`(() => ({ btn: document.querySelectorAll('[data-cp-idd-view]').length, links: document.querySelectorAll('[data-cp-idd] a[href*="storage"]').length, note: (document.querySelector('[data-cp-idd] .cp-locked p')||{}).textContent }))()`);
    check('one Open control on the document, and no direct storage link anywhere', ctl.btn === 1 && ctl.links === 0, JSON.stringify(ctl));
    check('the note says every open is access-logged, the log cannot be edited or removed, and the client may see it', /access-logged/i.test(ctl.note) && /cannot be edited or removed/i.test(ctl.note) && /entitled to see/i.test(ctl.note), ctl.note);
    await cdp.evaluate('document.querySelector("[data-cp-idd-view]").click(); true'); await sleep(400);
    let m = await cdp.evaluate(MODAL_READ);
    check('★ the modal opens, naming the document and the client', m.open && /Photo ID/.test(m.desc) && /passport-ida\.pdf/.test(m.desc) && /Ida Viewtest/.test(m.desc), m.desc);
    check('  it states the open is recorded permanently, cannot be edited or removed, and is visible to the client on request', /recorded permanently/i.test(m.warn) && /cannot be edited or removed/i.test(m.warn) && /entitled to see/i.test(m.warn), m.warn);
    check('  Submit is disabled with an empty reason', m.disabled === true && /0 \/ 10/.test(m.count), m.count);
    await cdp.evaluate('(() => { const t = document.getElementById("ida-reason"); t.value = "  too   short "; t.dispatchEvent(new Event("input", {bubbles:true})); return true; })()'); await sleep(150);
    m = await cdp.evaluate(MODAL_READ);
    check('  a 9-character reason (whitespace collapsed) keeps Submit disabled, count shown live', m.disabled === true && /9 \/ 10/.test(m.count), m.count);
    // Force the disabled button on and click anyway: the component's OWN second check refuses
    // before any round trip (defence in depth inside the modal)...
    await cdp.evaluate('(() => { document.getElementById("ida-submit").disabled = false; document.getElementById("ida-submit").click(); return true; })()');
    for (let i = 0; i < 60; i++) { await sleep(200); m = await cdp.evaluate(MODAL_READ); if (m.errorShown) break; }
    check('with the disabled state bypassed, the modal\'s own check still refuses the short reason', m.open && m.errorShown && /at least 10 characters/.test(m.error), m.error);
    check('  nothing was opened', m.opened.length === 0, JSON.stringify(m.opened));
    // ...and with the MODAL bypassed entirely — the function called directly from the PM's own
    // real browser session — the SERVER refuses it and the refusal is a row in the log.
    const direct = await cdp.evaluate(`(async () => { try { await MarketswaveData.callFunction('open-identity-document', { documentId: ${JSON.stringify(docId)}, reason: 'short' }); return { ok: true }; } catch (e) { return { ok: false, msg: MarketswaveData.writeErrorMessage(e) }; } })()`);
    check('★ with the modal bypassed entirely, the SERVER refuses a short reason with its own message', direct.ok === false && /at least 10 characters/.test(direct.msg), JSON.stringify(direct));
    const refusedRows = (await admin.from('identity_document_access_log').select('refusal_reason').eq('identity_document_id', docId).eq('outcome', 'refused').like('refusal_reason', '%shorter%')).data;
    check('  ...and that refusal is a row in the log', refusedRows.length === 1, JSON.stringify(refusedRows));
    await cdp.evaluate('(() => { const t = document.getElementById("ida-reason"); t.value = ' + JSON.stringify(RUN + ' — checking the passport against the application') + '; t.dispatchEvent(new Event("input", {bubbles:true})); return true; })()'); await sleep(150);
    m = await cdp.evaluate(MODAL_READ);
    check('  a real reason enables Submit', m.disabled === false, m.count);
    await cdp.evaluate('document.getElementById("ida-submit").click(); true');
    for (let i = 0; i < 60; i++) { await sleep(200); m = await cdp.evaluate(MODAL_READ); if (m.opened.length || m.errorShown) break; }
    check('★ a real window.open happened with a signed URL built against the page\'s own project URL', m.opened.length === 1 && m.opened[0].startsWith(st.API_URL + '/storage/v1/object/sign/identity-documents/'), JSON.stringify(m.opened));
    check('  the modal closed and a toast reported the recorded open', !m.open && /recorded/i.test(await cdp.evaluate('(document.getElementById("cp-toast")||{}).textContent || ""')));
    const got = m.opened[0] ? await fetch(m.opened[0]) : null;
    const text = got ? await got.text() : '';
    check('★ the opened URL serves the client\'s REAL bytes', got && got.status === 200 && text === bytes.toString(), got ? got.status + ' ' + text.slice(0, 30) : 'no URL');
    const { data: opened } = await admin.from('identity_document_access_log').select('*').eq('identity_document_id', docId).eq('outcome', 'opened');
    check('★ exactly one OPENED row in Postgres: who, whose, which, why, when', opened.length === 1 && opened[0].pm_email === 'pm@marketswave.local' && opened[0].client_name === 'Ida Viewtest' && opened[0].filename === 'passport-ida.pdf' && /checking the passport/.test(opened[0].reason) && !!opened[0].url_expires_at, JSON.stringify(opened));
    check('  the URL expiry recorded is within 60 s of the request', opened.length === 1 && (new Date(opened[0].url_expires_at) - new Date(opened[0].requested_at)) <= 61000 && (new Date(opened[0].url_expires_at) - new Date(opened[0].requested_at)) >= 55000);
    // keyboard: Escape closes; the modal is a real dialog
    await cdp.evaluate('document.querySelector("[data-cp-idd-view]").click(); true'); await sleep(300);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(200);
    m = await cdp.evaluate(MODAL_READ);
    check('Escape closes the modal without opening or logging anything', !m.open && (await admin.from('identity_document_access_log').select('id', { count: 'exact' }).eq('identity_document_id', docId)).count === 3);
    check('the modal is a real dialog (role=dialog, aria-modal, labelled)', await cdp.evaluate('(() => { const d = document.querySelector("#ida-modal [role=dialog]"); return !!d && d.getAttribute("aria-modal") === "true" && d.getAttribute("aria-labelledby") === "ida-title"; })()'));

    // =========================================================================================
    console.log('\n=== PART B — the approval gate: the same control, the same modal ===\n');
    await goto(cdp, BASE + '/admin-approvals.html'); await cdp.evaluate(GATE_WAIT); await cdp.evaluate(CAPTURE_OPEN);
    const g = await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      const row = document.querySelector('#ag-queue .ag-row[data-kind="app"][data-id="${uid}"]'); if (!row) return { found: false };
      row.click(); for (let i = 0; i < 60; i++) { if (!document.getElementById('ag-scrim').hidden && document.getElementById('ag-pane').innerHTML.length > 0) break; await nap(100); } await nap(500);
      const pane = document.getElementById('ag-pane');
      return { found: true, open: pane.querySelectorAll('[data-ag-idd-view]').length, links: pane.querySelectorAll('a[href*="storage"]').length, note: (pane.querySelector('[data-ag-idd-locked] p')||{}).textContent }; })()`);
    check('the application panel shows one Open control on the document and no direct link', g.found && g.open === 1 && g.links === 0, JSON.stringify(g));
    check('  its note says the open is access-logged permanently and visible to the client on request', /access-logged permanently/i.test(g.note) && /can see it on request/i.test(g.note), g.note);
    await cdp.evaluate('document.querySelector("#ag-pane [data-ag-idd-view]").click(); true'); await sleep(400);
    m = await cdp.evaluate(MODAL_READ);
    check('★ the SAME shared modal opens from the gate, naming the client', m.open && /Ida Viewtest/.test(m.desc), m.desc);
    await cdp.evaluate('(() => { const t = document.getElementById("ida-reason"); t.value = ' + JSON.stringify(RUN + ' — reviewing the application from the gate') + '; t.dispatchEvent(new Event("input", {bubbles:true})); document.getElementById("ida-submit").click(); return true; })()');
    for (let i = 0; i < 60; i++) { await sleep(200); m = await cdp.evaluate(MODAL_READ); if (m.opened.length || m.errorShown) break; }
    check('★ a real open from the gate, logged as a second opened row with its own reason', m.opened.length === 1 && (await admin.from('identity_document_access_log').select('reason').eq('identity_document_id', docId).eq('outcome', 'opened')).data.some((r) => /from the gate/.test(r.reason)), JSON.stringify(m.opened));
    check('  the gate\'s own toast reported it', /recorded/i.test(await cdp.evaluate('(document.getElementById("ag-toast")||{}).textContent || ""')));

    // =========================================================================================
    console.log('\n=== PART C — admin-security.html: the log, every row, newest first ===\n');
    await goto(cdp, BASE + '/admin-security.html'); await cdp.evaluate(SEC_WAIT);
    const log = await cdp.evaluate(`(() => { const rows = [...document.querySelectorAll('[data-idac-row]')].map(r => ({ id: r.dataset.idacRow, outcome: r.dataset.outcome, text: r.innerText.replace(/\\s+/g, ' ') }));
      return { count: rows.length, heading: (document.getElementById('sec-idac-h')||{}).textContent, sub: (document.getElementById('idac-sub')||{}).textContent, rows: rows.filter(r => /${suffix}/.test(r.text)), first: rows[0], nav: document.querySelectorAll('.an-item').length, empty: !!document.querySelector('[data-idac-empty]') }; })()`);
    check('the log section renders with a real table and the shared nav', log.count > 0 && log.nav === NAV_COUNT && !log.empty, JSON.stringify({ c: log.count, nav: log.nav }));
    check('  its copy states every PM, every refusal, and permanence', /any Portfolio Manager/i.test(log.sub) && /refused attempt/i.test(log.sub) && /be edited or removed/i.test(log.sub), log.sub);
    check('★ all four of this run\'s rows render: two opened, two refused (the non-PM attempt and the short reason)', log.rows.length === 4 && log.rows.filter((r) => r.outcome === 'opened').length === 2 && log.rows.filter((r) => r.outcome === 'refused').length === 2, JSON.stringify(log.rows.map((r) => r.outcome)));
    check('  the refused rows show WHY they were refused', log.rows.filter((r) => r.outcome === 'refused').every((r) => /not a Portfolio Manager|shorter than 10/.test(r.text)), JSON.stringify(log.rows.filter((r) => r.outcome === 'refused').map((r) => r.text.slice(0, 160))));
    check('  each row names the client, the document, the reason and who asked', log.rows.every((r) => /Ida Viewtest/.test(r.text) && /passport-ida\.pdf/.test(r.text) && /pm@marketswave\.local|idav-/.test(r.text)), JSON.stringify(log.rows.map((r) => r.text.slice(0, 200))));
    check('  newest first: the most recent open (from the gate) is the first row', log.first && /from the gate/.test(log.first.text), log.first && log.first.text.slice(0, 160));
    const dbCount = (await admin.from('identity_document_access_log').select('id', { count: 'exact' })).count;
    check('  the table shows EVERY row in the table, not a window of them', log.count === dbCount, log.count + ' rendered vs ' + dbCount + ' in Postgres');

    // =========================================================================================
    console.log('\n=== PART D — contrast, sheen, fonts, real phone widths ===\n');
    const PROF_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelector('[data-cp-idd-view]')) break; await nap(200); } document.querySelector('[data-cp-idd-view]').click(); await nap(500); const t = document.getElementById('ida-reason'); t.value = 'short'; t.dispatchEvent(new Event('input', {bubbles:true})); document.getElementById('ida-submit').disabled = false; document.getElementById('ida-submit').click(); for (let i = 0; i < 60; i++) { if (document.getElementById('ida-error') && !document.getElementById('ida-error').classList.contains('hidden')) break; await nap(200); } await nap(600); })()`;
    runContrast('identity-access-modal', 'the access modal (with a live error)', adminBootstrap, PROF_PREP, BASE + '/admin-client-profile.html?client=' + uid);
    const SEC_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { const l = document.getElementById('idac-list'); if (l && l.querySelector('[data-idac-table]')) break; await nap(200); } await nap(800); })()`;
    runContrast('identity-access-log', 'the access log', adminBootstrap, SEC_PREP, BASE + '/admin-security.html');
    const sheen = runChild('verify-glass-sheen.mjs', { SHEEN_PAGES: 'admin-security.html', SHEEN_BOOTSTRAP_JS: adminBootstrap }, 'verify-glass-sheen');
    check('sheen audit (security page) passed with the sheen composited', /SHEEN SWEEP: PASS/.test(sheen), sheen.slice(-300));
    const fonts = runChild('verify-fonts.mjs', { AUDIT_URL: BASE + '/admin-security.html', AUDIT_BOOTSTRAP_JS: adminBootstrap }, 'verify-fonts');
    // (case-sensitive FALLBACK: the audit's own measurement lines say "vs fallback 244.4")
    check('no font falls back', !/FALLBACK/.test(fonts), fonts.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
    check('no monospace family anywhere', !/JetBrains|monospace/i.test(fonts));

    for (const w of [390, 375]) {
      await phone(cdp, w);
      await goto(cdp, BASE + '/admin-client-profile.html?client=' + uid); await cdp.evaluate(PROFILE_WAIT); await cdp.evaluate(CAPTURE_OPEN);
      await cdp.evaluate('document.querySelector("[data-cp-idd-view]").click(); true'); await sleep(400);
      const pm = await cdp.evaluate(`(() => { const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        const d = document.querySelector('#ida-modal [role=dialog]'); const r = d.getBoundingClientRect();
        return { inner: innerWidth, dpr: devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches, noHover: matchMedia('(hover: none)').matches,
          dialogRight: Math.round(r.right), dialogLeft: Math.round(r.left), reasonVis: vis(document.getElementById('ida-reason')), submitVis: vis(document.getElementById('ida-submit')), warnVis: vis(document.getElementById('ida-warn')), btnH: document.getElementById('ida-submit').getBoundingClientRect().height }; })()`);
      check('★ ' + w + 'px: a REAL phone profile (DPR 3, coarse pointer, no hover)', pm.dpr === 3 && pm.coarse && pm.noHover && pm.inner === w, JSON.stringify(pm));
      check(w + 'px: the modal fits the viewport with the reason field, warning and buttons all on screen', pm.dialogLeft >= 0 && pm.dialogRight <= w && pm.reasonVis && pm.submitVis && pm.warnVis, JSON.stringify(pm));
      check(w + 'px: the Submit control is a real tap target (≥44px)', pm.btnH >= 44, String(pm.btnH));
      await goto(cdp, BASE + '/admin-security.html'); await cdp.evaluate(SEC_WAIT);
      const ps = await cdp.evaluate(`(() => { const rects = [...document.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
        const row = document.querySelector('[data-idac-row]'); return { inner: innerWidth, bodyScroll: document.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)), rowDisplay: row ? getComputedStyle(row).display : null, cells: row ? row.querySelectorAll('td').length : 0, nav: document.querySelectorAll('.an-item').length }; })()`);
      check(w + 'px security: nothing scrolls horizontally', ps.bodyScroll <= w && ps.maxRight <= w + 1, JSON.stringify({ b: ps.bodyScroll, m: ps.maxRight }));
      check('★ ' + w + 'px security: the six-column log becomes self-labelling CARDS, not an off-screen scroller', ps.rowDisplay === 'block' && ps.cells === 6, JSON.stringify({ d: ps.rowDisplay, c: ps.cells }));
      check(w + 'px security: the nav is mounted', ps.nav === NAV_COUNT, String(ps.nav));
    }
    await desktop(cdp, 1440);
    await goto(cdp, BASE + '/admin-security.html'); await cdp.evaluate(SEC_WAIT);
    const iframe = await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelectorAll('#mw320').forEach(n => n.remove());
      const f = document.createElement('iframe'); f.id = 'mw320'; f.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:760px;border:0;z-index:99999'; f.src = '/admin-security.html'; document.body.appendChild(f);
      for (let i = 0; i < 300; i++) { try { const dd = f.contentDocument; if (dd && dd.querySelector('[data-idac-table]')) break; } catch (e) {} await nap(200); } await nap(1200);
      const dd = f.contentDocument, w = f.contentWindow; const rects = [...dd.querySelectorAll('body *')].filter(e => !e.closest('[aria-hidden="true"]')).map(e => e.getBoundingClientRect());
      const row = dd.querySelector('[data-idac-row]'); return { inner: w.innerWidth, bodyScroll: dd.body.scrollWidth, maxRight: Math.max(0, ...rects.map(r => r.right)), rowDisplay: row ? w.getComputedStyle(row).display : null, rows: dd.querySelectorAll('[data-idac-row]').length }; })()`);
    check('320px (real iframe): the viewport is genuinely 320', iframe.inner === 320, String(iframe.inner));
    check('★ 320px security: nothing scrolls horizontally and the log rows are cards', iframe.bodyScroll <= 321 && iframe.maxRight <= 321 && iframe.rowDisplay === 'block' && iframe.rows > 0, JSON.stringify(iframe));
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (_e) { /* closing anyway */ } try { cdp.chrome.kill(); } catch (_e) { /* already gone */ } }
    if (profile) await releaseTempDir(profile, cdp && cdp.chrome);
    if (server) { try { server.kill(); } catch (_e) { /* already gone */ } }
    for (const o of objects) { const { error } = await admin.storage.from('identity-documents').remove([o]); if (error) console.log('  TEARDOWN WARNING  ' + error.message); }
    for (const id of cleanupIds) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.log('  TEARDOWN WARNING  user ' + id + ': ' + error.message); }
    console.log('\n  (the access-log rows this run wrote are permanent by design; each names "' + RUN + '")');
  }
  console.log('\n' + passed + '/' + (passed + fails.length) + ' assertions passed.');
  console.log('IDENTITY DOCUMENT ACCESS VISUAL: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 900000 });
