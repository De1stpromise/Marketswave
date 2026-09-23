// Task C — real signing (2026-09-18, register row 249). The browser half, in a REAL headless
// Chrome over CDP against the local stack, as the real seeded client Gary Sizemore.
//
//   SETUP   A real 3-page agreement is printed to PDF by Chrome itself and published to Gary
//           THROUGH the real publish-document with those real bytes — never a direct insert —
//           so the whole chain is exercised: published with bytes, rendered in-page, read,
//           signed with evidence, hash re-checked.
//   PART A  documents.html as Gary: Sign opens the modal; the sign control is DISABLED while
//           pdf.js (real, from cdnjs) renders; every page paints real pixels on a real canvas;
//           the control stays disabled until name + consent; a real click signs it. Then every
//           evidence field is read back INDEPENDENTLY from Postgres and Storage — the hash
//           recomputed here from the stored bytes, the signed copy parsed here as a PDF.
//   PART A2 The render gate under failure: with the pdf.js CDN blocked at the network layer
//           (Fetch.failRequest), a second document cannot be shown — status says so, the
//           control stays disabled even with name + consent typed and the disabled attribute
//           forced off, and Postgres proves nothing was signed.
//   PART B  admin-documents.html as the PM: the evidence panel is real — typed name, time,
//           address, device, the hash at signing, and a LIVE re-check that reads "matches";
//           then the stored original is overwritten out of band and the same panel reads
//           "DIFFERS — altered after signing". Original restored afterward.
//   PART C  Contrast on the modal, the signed row and the evidence panel (both states), the
//           sheen audit, fonts, the client nav and the PM nav present, 390/375 on a REAL phone
//           profile plus a real 320px iframe.
//
// The evidence rows this run writes are PERMANENT by design; typed_name names this suite.
// Gary's test documents and their storage objects are removed afterward; Gary's own row is
// restored exactly (his email is pointed at a malformed run-suffixed address for the duration
// so the real "signed copy is ready" email is refused synchronously by Resend rather than
// mailing a real inbox on every regression run — the established technique, row 153).
import { execSync, spawnSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FIXTURE_CLIENT, findFixtureClient } from './lib/fixture-client.mjs';
import { makeTempDir, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';
import { removeAllClientStorageObjects } from './lib/storage-test-cleanup.mjs';
import { adminNavItemCount } from './lib/admin-nav-count.mjs';

// ★ Derived from admin-sidebar.js's own NAV_ITEMS, never retyped — see lib/admin-nav-count.mjs.
const NAV_COUNT = adminNavItemCount();

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p)) || 'chrome';
const GARY_EMAIL = FIXTURE_CLIENT.email; // GARY_SEED_EMAIL via scripts/lib/fixture-client.mjs — never a literal here (row 256)
const CONSENT = 'I have read this document in full, I agree to be bound by it, and I accept that typing my name constitutes my signature.';

let passed = 0; const fails = [];
function check(label, cond, detail) { if (cond) { passed++; console.log('  PASS  ' + label); } else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function localStack() {
  const j = JSON.parse(execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, ''));
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing a non-local API_URL: ' + j.API_URL);
  return j;
}
function garyPassword() {
  if (process.env.GARY_SEED_PASSWORD) return process.env.GARY_SEED_PASSWORD;
  const f = path.join(ROOT, 'supabase', 'functions', '.env');
  const line = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith('GARY_SEED_PASSWORD=')) : null;
  if (!line) throw new Error('GARY_SEED_PASSWORD is not set (supabase/functions/.env) — seed Gary first: node seed-client-gary.mjs');
  return line.slice('GARY_SEED_PASSWORD='.length).trim().replace(/^["']|["']$/g, '');
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
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else if (m.method) listeners.forEach((l) => l(m)); });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { chrome, ws, send, evaluate, on: (fn) => listeners.push(fn) };
}
async function phone(cdp, width) { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true }); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
async function desktop(cdp, width) { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 }); }
async function goto(cdp, url) {
  await cdp.send('Page.navigate', { url: 'about:blank' }); await sleep(120);
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) { await sleep(200); try { if (await cdp.evaluate('document.readyState === "complete" && !!document.body')) break; } catch (_e) { /* navigated mid-poll */ } }
  await sleep(600);
}
async function printAgreementPdf(dir, title) {
  const html = path.join(dir, 'agreement.html'); const out = path.join(dir, 'agreement.pdf');
  fs.writeFileSync(html, '<html><body style="font-family:Georgia;padding:60px;line-height:1.7"><h1>' + title + '</h1><p>This Advisory Agreement is entered into between Marketswave AB and the Client named in the account record.</p><h2>1. Scope</h2><p>Discretionary management across five asset classes: Private Equity, Real Assets, Stocks and ETFs, Crypto, and Unallocated Cash.</p><div style="page-break-after:always"></div><h2>2. Fees</h2><p>An annual advisory fee accrues daily on allocated capital and is estimated monthly on the Transactions page.</p><div style="page-break-after:always"></div><h2>3. Risk</h2><p>Private placement investments are not bank deposits, are not insured, and may lose value, including the entire amount invested.</p><p>Signature: ______________________</p></body></html>');
  spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + out, 'file:///' + html.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 60000 });
  return fs.readFileSync(out);
}

const DOCS_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { const l = document.getElementById('from-list'); if (l && !/animate-pulse/.test(l.innerHTML) && document.querySelector('#sidebar-aside') && document.readyState === 'complete') break; await nap(200); }
  await nap(600); return true; })()`;
const ADMIN_DOCS_WAIT = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.doc-tr').length > 0 && document.querySelectorAll('.an-item').length === ${NAV_COUNT} && document.readyState === 'complete') break; await nap(200); }
  await nap(600); return true; })()`;
const CAPTURE_OPEN = `(() => { window.__opened = []; window.open = function (href) { window.__opened.push(String(href)); return { closed: false }; }; return true; })()`;
const MODAL_READ = `(() => { const m = document.getElementById('dsg-modal'); const sub = document.getElementById('dsg-submit'); const st = document.getElementById('dsg-status');
  const canv = [...document.querySelectorAll('#dsg-viewer canvas.dsg-page')].map(c => { const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++; return { page: c.dataset.page, w: c.width, h: c.height, dark }; });
  return { exists: !!m, open: !!m && !m.hidden, disabled: sub ? sub.disabled : null, ariaDisabled: sub ? sub.getAttribute('aria-disabled') : null, state: st ? st.dataset.state : null, status: (document.getElementById('dsg-status-text')||{}).textContent,
    fp: (document.getElementById('dsg-fp')||{}).textContent, canvases: canv, srPages: document.querySelectorAll('#dsg-viewer .dsg-sr').length, title: (document.getElementById('dsg-title')||{}).textContent,
    consent: (document.querySelector('.dsg-consent span')||{}).textContent, capture: (document.getElementById('dsg-capture')||{}).textContent, error: (document.getElementById('dsg-error')||{}).textContent, opened: window.__opened || [] }; })()`;
const WAIT_MODAL_SETTLED = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300; i++) { const st = document.getElementById('dsg-status'); if (st && st.dataset.state !== 'loading') break; await nap(200); } await nap(400); return (document.getElementById('dsg-status')||{}).dataset.state; })()`;

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const RUN = 'verify-document-signing-visual ' + suffix;
  const storageKey = 'sb-' + new URL(st.API_URL).hostname.split('.')[0] + '-auth-token';
  let server = null, profile = null, cdp = null, scratch = null;
  let garyBefore = null, docIds = [];
  const admSigned = await anon().auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (admSigned.error) throw new Error('admin sign-in: ' + admSigned.error.message);
  const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(admSigned.data.session)) + '); true';
  const pmToken = admSigned.data.session.access_token;
  const pmCall = async (fn, body) => { const r = await fetch(st.API_URL + '/functions/v1/' + fn, { method: 'POST', headers: { apikey: st.ANON_KEY, Authorization: 'Bearer ' + pmToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

  // ★ ENTRY SWEEP (row 201's pattern): a prior run that died hard skips every finally and
  // leaves Gary's email malformed and his test documents behind. It happened to this suite's
  // own first two runs — runVerifyMain's 90-second DEFAULT watchdog (every sibling visual suite
  // passes its own 15–20 minute budget; this one had not), which spawnSync children only let
  // land at a child boundary. Repair FIRST, from what is actually in the database.
  async function sweepGary() {
    const { data: rows } = await admin.from('clients').select('id, email').or('email.ilike.' + GARY_EMAIL + ',email.ilike.gary-signing-malformed-%');
    for (const c of rows || []) {
      // Two plain queries, not one .or(): PostgREST's filter grammar treats the "(" and ","
      // inside these VALUES as delimiters, and the combined form silently matched one of the two.
      const { data: d1 } = await admin.from('documents').select('id, storage_path').eq('client_id', c.id).ilike('filename', 'Advisory Agreement 2026 (%).pdf');
      const { data: d2 } = await admin.from('documents').select('id, storage_path').eq('client_id', c.id).ilike('filename', 'Second Agreement (%).pdf');
      const docs = [...(d1 || []), ...(d2 || [])];
      const ids = (docs || []).map((d) => d.id);
      if (ids.length) {
        const { data: sigs } = await admin.from('document_signatures').select('signed_copy_storage_path').in('document_id', ids);
        const paths = [...(docs || []).map((d) => d.storage_path), ...(sigs || []).map((x) => x.signed_copy_storage_path)].filter(Boolean);
        if (paths.length) await admin.storage.from('documents').remove(paths);
        await admin.from('documents').delete().in('id', ids);
        console.log('  (entry sweep) removed ' + ids.length + ' leftover test document(s) from a prior run');
      }
      if (/^gary-signing-malformed-/.test(c.email)) { await admin.from('clients').update({ email: GARY_EMAIL }).eq('id', c.id); console.log('  (entry sweep) restored Gary\'s email from a prior hard death'); }
    }
    await admin.from('email_log').delete().ilike('recipient', 'gary-signing-malformed-%');
  }
  await sweepGary();
  let emailRestored = false;
  async function restoreGaryEmail() {
    if (emailRestored || !garyBefore) return;
    const { error } = await admin.from('clients').update({ email: garyBefore.email }).eq('id', garyBefore.id);
    if (!error) emailRestored = true; else console.error('could not restore Gary\'s email: ' + error.message);
  }

  try {
    // ---- SETUP: Gary, a real Chrome-printed agreement, published through the real function ----
    const gary = await findFixtureClient(admin, '*');
    if (!gary) throw new Error('Gary is not seeded on this stack — run: node seed-client-gary.mjs');
    if (/^gary-signing-malformed-/.test(gary.email)) throw new Error('Gary\'s email is still malformed after the sweep: ' + gary.email);
    garyBefore = gary; const uid = gary.id;
    const runEmail = 'gary-signing-malformed-' + suffix; // no @ — refused synchronously by Resend, mails nobody
    await admin.from('clients').update({ email: runEmail }).eq('id', uid);
    scratch = makeTempDir('mw-sign-');
    const pdf = await printAgreementPdf(scratch, 'Advisory Agreement 2026');
    check('(setup) Chrome printed a real 3-page PDF', pdf.length > 5000 && pdf.slice(0, 5).toString() === '%PDF-' && (await PDFDocument.load(pdf)).getPageCount() === 3, pdf.length + ' bytes');
    const pub = await pmCall('publish-document', { clientId: uid, filename: 'Advisory Agreement 2026 (' + suffix + ').pdf', category: 'Contracts', signatureRequired: true, dueDate: null, fileBase64: pdf.toString('base64'), fileType: 'application/pdf' });
    check('★ (setup) the agreement is published to Gary THROUGH the real publish-document with real bytes', pub.status === 200 && pub.body && pub.body.status === 'Signature Required', JSON.stringify(pub.body).slice(0, 160));
    const docId = pub.body.id; docIds.push(docId);
    const pub2 = await pmCall('publish-document', { clientId: uid, filename: 'Second Agreement (' + suffix + ').pdf', category: 'Contracts', signatureRequired: true, fileBase64: pdf.toString('base64'), fileType: 'application/pdf' });
    const docId2 = pub2.body.id; docIds.push(docId2);
    const { data: docRow } = await admin.from('documents').select('*').eq('id', docId).single();
    const { data: storedBlob } = await admin.storage.from('documents').download(docRow.storage_path);
    const storedBytes = Buffer.from(await storedBlob.arrayBuffer());
    check('(setup) the stored bytes are the printed PDF, byte for byte', storedBytes.equals(pdf));
    const expectedHash = sha256(pdf);

    // The AUTH email is untouched (clients.email is the decoupled column) — Gary signs in as himself.
    const cs2 = await anon().auth.signInWithPassword({ email: gary.email, password: garyPassword() });
    if (cs2.error) throw new Error('Gary sign-in: ' + cs2.error.message);
    const clientBootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(cs2.data.session)) + ');' +
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(uid) + ');sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(uid) + ');true';

    server = spawn('python', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/documents.html'); break; } catch (_e) { await sleep(250); } }
    profile = makeTempDir('mw-signv-');
    cdp = await connect(profile);
    await desktop(cdp, 1440);
    await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(clientBootstrap);

    // =========================================================================================
    console.log('\n=== PART A — documents.html as Gary: render in-page, gate, sign, evidence read back ===\n');
    await goto(cdp, BASE + '/documents.html'); await cdp.evaluate(DOCS_WAIT); await cdp.evaluate(CAPTURE_OPEN);
    const nav = await cdp.evaluate(`(() => ({ aside: !!document.querySelector('#sidebar-aside'), items: document.querySelectorAll('#sidebar-aside a').length, active: (document.querySelector('#sidebar-aside a[aria-current], #sidebar-aside a.bg-navy-light, #sidebar-aside a[class*="bg-white/10"]')||{}).textContent }))()`);
    check('the client nav is present with its items', nav.aside && nav.items >= 9, JSON.stringify(nav));
    const rowInfo = await cdp.evaluate(`(() => { const r = document.querySelector('.doc-row[data-doc-id="${docId}"]'); return { found: !!r, sign: !!(r && r.querySelector('.sign-btn')), badge: r ? (r.querySelector('.signature-badge')||{}).textContent : null }; })()`);
    check('the published agreement renders as a row with a Sign button and the Signature Required badge', rowInfo.found && rowInfo.sign && rowInfo.badge === 'Signature Required', JSON.stringify(rowInfo));

    await cdp.evaluate(`document.querySelector('.doc-row[data-doc-id="${docId}"] .sign-btn').click(); true`);
    await sleep(150);
    let m = await cdp.evaluate(MODAL_READ);
    check('clicking Sign opens the signing modal naming the document', m.open && m.title.indexOf('Advisory Agreement 2026') === 0, JSON.stringify({ open: m.open, title: m.title }));
    check('★ the sign control is DISABLED while the document is still loading/rendering', m.disabled === true && m.ariaDisabled === 'true' && m.state === 'loading', JSON.stringify({ d: m.disabled, s: m.state }));
    check('the consent statement and the capture statement are on screen verbatim', m.consent === CONSENT && /Signing records the date and time, your name as typed, your device and network address, and a fingerprint of this exact document/.test(m.capture), m.capture);
    const finalState = await cdp.evaluate(WAIT_MODAL_SETTLED);
    m = await cdp.evaluate(MODAL_READ);
    check('★ pdf.js (real, from cdnjs) rendered every page in-page: 3 canvases, each with real dark pixels', finalState === 'ready' && m.canvases.length === 3 && m.canvases.every((c) => c.dark > 200 && c.w > 400), JSON.stringify({ state: finalState, status: m.status, canvases: m.canvases }));
    check('a visually-hidden text layer accompanies every page (assistive technology)', m.srPages === 3, String(m.srPages));
    check('the status line says how many pages and to scroll to read the whole document', /3 pages/.test(m.status) && /scroll/.test(m.status), m.status);
    check('★ the page shows the fingerprint it hashed itself — equal to the independent hash of the stored bytes', m.fp.indexOf(expectedHash) !== -1, m.fp);
    check('rendered, but with no name and no consent, the control is STILL disabled', m.disabled === true);
    await cdp.evaluate(`(() => { const n = document.getElementById('dsg-name'); n.value = 'Gary Sizemore'; n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    m = await cdp.evaluate(MODAL_READ);
    check('a typed name alone does not enable it (consent unchecked)', m.disabled === true);
    await cdp.evaluate(`(() => { const c = document.getElementById('dsg-consent'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    m = await cdp.evaluate(MODAL_READ);
    check('★ rendered + name + consent: the sign control is enabled', m.disabled === false && m.ariaDisabled === 'false');
    const submitBox = await cdp.evaluate(`(() => { const r = document.getElementById('dsg-submit').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
    check('the sign control is a real ≥44px target', submitBox.h >= 44 && submitBox.w >= 44, JSON.stringify(submitBox));

    const before = (await admin.from('document_signatures').select('id', { count: 'exact', head: true }).eq('document_id', docId)).count;
    check('GUARD: no evidence row exists before the click', before === 0, String(before));
    await cdp.evaluate(`document.getElementById('dsg-submit').click(); true`);
    await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) { const t = document.getElementById('doc-toast-title'); if (t && t.textContent === 'Signed' && document.getElementById('dsg-modal').hidden) break; await nap(200); } await nap(1500); return true; })()`);
    const after = await cdp.evaluate(`(() => { const r = document.querySelector('.doc-row[data-doc-id="${docId}"]'); return { toast: (document.getElementById('doc-toast-title')||{}).textContent, modalHidden: document.getElementById('dsg-modal').hidden, badge: r ? (r.querySelector('.signature-badge')||{}).textContent : null, signedCopy: !!(r && r.querySelector('.signed-copy-btn')), signBtn: !!(r && r.querySelector('.sign-btn')) }; })()`);
    check('★ a real click signs it: toast "Signed", modal closed, row now Signed with a Signed copy control and no Sign button', after.toast === 'Signed' && after.modalHidden && after.badge === 'Signed' && after.signedCopy && !after.signBtn, JSON.stringify(after));

    // ---- evidence read back INDEPENDENTLY from Postgres + Storage --------------------------
    const { data: ev } = await admin.from('document_signatures').select('*').eq('document_id', docId).maybeSingle();
    check('★ exactly one evidence row exists in Postgres', !!ev);
    check('typed name recorded as typed', ev && ev.typed_name === 'Gary Sizemore', ev && ev.typed_name);
    check('consent statement stored verbatim', ev && ev.consent_text === CONSENT);
    check('signed_at is a real UTC timestamp from the last minute', ev && Math.abs(Date.now() - new Date(ev.signed_at).getTime()) < 60000, ev && ev.signed_at);
    check('IP recorded from the request (the local stack sees loopback)', ev && /^(127\.|::1|10\.|172\.|192\.168\.)/.test(ev.ip_address || ''), ev && ev.ip_address);
    check('user agent recorded from the real browser request (HeadlessChrome)', ev && /HeadlessChrome/.test(ev.user_agent || ''), ev && ev.user_agent);
    check('★ original_sha256 equals the INDEPENDENT hash of the bytes in Storage', ev && ev.original_sha256 === sha256(storedBytes) && ev.original_sha256 === expectedHash, ev && ev.original_sha256);
    check('★ the browser\'s own reported hash equals the server\'s (the client rendered the exact stored bytes) and pages = 3', ev && ev.client_reported_sha256 === ev.original_sha256 && ev.client_reported_pages === 3 && ev.page_count === 3, ev && JSON.stringify({ c: ev.client_reported_sha256, s: ev.original_sha256, p: ev.client_reported_pages }));
    const { data: docAfter } = await admin.from('documents').select('status, is_new, deadline_label').eq('id', docId).single();
    check('the document is Signed in Postgres (status set by the function after the evidence row)', docAfter.status === 'Signed' && docAfter.is_new === false && docAfter.deadline_label === null);
    const { data: copyBlob, error: copyErr } = await admin.storage.from('documents').download(ev.signed_copy_storage_path);
    const copyBytes = copyErr ? null : Buffer.from(await copyBlob.arrayBuffer());
    check('★ the signed copy exists in Storage, is a PDF with one more page than the original, and its hash is recorded', !!copyBytes && copyBytes.slice(0, 5).toString() === '%PDF-' && (await PDFDocument.load(copyBytes)).getPageCount() === 4 && sha256(copyBytes) === ev.signed_copy_sha256, copyErr && copyErr.message);
    const { data: mail } = await admin.from('email_log').select('subject, status, recipient').eq('related_entity_id', ev.id).limit(1);
    check('the "signed copy is ready" email was attempted, logged, and refused for the malformed run address (mailed nobody)', mail && mail.length === 1 && /signed copy/i.test(mail[0].subject) && mail[0].status === 'failed' && mail[0].recipient === runEmail, JSON.stringify(mail));
    // The one real send is behind us — restore Gary's real email NOW, not in the finally, so a
    // hard death later in this run cannot leave him unreachable.
    await restoreGaryEmail();
    check('(restore) Gary\'s real email is back before anything else runs', emailRestored);

    // The client retrieves the signed copy through the real control.
    await cdp.evaluate(`document.querySelector('.doc-row[data-doc-id="${docId}"] .signed-copy-btn').click(); true`);
    await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 100; i++) { if ((window.__opened||[]).length) break; await nap(100); } return true; })()`);
    const opened = await cdp.evaluate(`window.__opened || []`);
    check('"Signed copy" opens a real signed URL (captured window.open)', opened.length === 1 && /signed/.test(decodeURIComponent(opened[0])), JSON.stringify(opened));
    if (opened.length) {
      const got = await fetch(opened[0]); const gotBytes = Buffer.from(await got.arrayBuffer());
      check('★ that URL serves the exact stored signed copy, byte for byte', got.ok && gotBytes.equals(copyBytes), got.status + ' ' + gotBytes.length);
    }

    // =========================================================================================
    console.log('\n=== PART A2 — the render gate under failure: pdf.js blocked at the network, nothing can be signed ===\n');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*cdnjs.cloudflare.com/ajax/libs/pdf.js/*' }] });
    cdp.on((msg) => { if (msg.method === 'Fetch.requestPaused') cdp.send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'ConnectionRefused' }).catch(() => {}); });
    await goto(cdp, BASE + '/documents.html'); await cdp.evaluate(DOCS_WAIT);
    await cdp.evaluate(`document.querySelector('.doc-row[data-doc-id="${docId2}"] .sign-btn').click(); true`);
    const st2 = await cdp.evaluate(WAIT_MODAL_SETTLED);
    m = await cdp.evaluate(MODAL_READ);
    check('★ with the CDN unreachable the status reports the failure honestly (no pages, no fake success)', st2 === 'error' && m.canvases.length === 0 && /could not be displayed/.test(m.status), JSON.stringify({ st2, status: m.status }));
    await cdp.evaluate(`(() => { const n = document.getElementById('dsg-name'); n.value = 'Gary Sizemore'; n.dispatchEvent(new Event('input', { bubbles: true })); const c = document.getElementById('dsg-consent'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    m = await cdp.evaluate(MODAL_READ);
    check('name + consent do NOT enable the control when nothing rendered', m.disabled === true);
    await cdp.evaluate(`(() => { const b = document.getElementById('dsg-submit'); b.disabled = false; b.removeAttribute('aria-disabled'); b.click(); return true; })()`);
    await sleep(2000);
    const { count: ev2 } = await admin.from('document_signatures').select('id', { count: 'exact', head: true }).eq('document_id', docId2);
    const { data: d2 } = await admin.from('documents').select('status').eq('id', docId2).single();
    check('★ forcing the disabled attribute off and clicking signs NOTHING: no evidence row, still Signature Required', ev2 === 0 && d2.status === 'Signature Required', ev2 + ' rows / ' + d2.status);
    await cdp.send('Fetch.disable');

    // =========================================================================================
    console.log('\n=== PART B — admin-documents.html as the PM: the evidence panel, matches, then DIFFERS ===\n');
    await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(adminBootstrap);
    await goto(cdp, BASE + '/admin-documents.html'); await cdp.evaluate(ADMIN_DOCS_WAIT); await cdp.evaluate(CAPTURE_OPEN);
    const pmNav = await cdp.evaluate(`(() => ({ items: document.querySelectorAll('.an-item').length, active: (document.querySelector('.an-item.is-on')||{}).textContent }))()`);
    check('the PM nav is present (every item) with Documents active', pmNav.items === NAV_COUNT && /Documents/.test(pmNav.active || ''), JSON.stringify(pmNav));
    const OPEN_ROW = (id) => `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); const r = [...document.querySelectorAll('.doc-tr')].find(x => x.dataset.id === '${id}'); if (!r) return 'no-row'; r.click(); for (let i = 0; i < 100; i++) { const h = document.getElementById('doc-hash-check'); if (h && !/checking/i.test(h.textContent)) break; await nap(150); } await nap(300); return 'ok'; })()`;
    const PANEL_READ = `(() => { const p = document.getElementById('doc-panel'); const t = (s) => (p.querySelector(s)||{}).textContent || ''; return { evd: t('#doc-evd .eb b') + ' | ' + t('#doc-evd .eb p'), hashTitle: (p.querySelector('.doc-hash')||{}).title, hashText: t('.doc-hash'), check: t('#doc-hash-check'), copy: t('#doc-copy-check'), bad: !!(p.querySelector('#doc-evd.is-bad')), original: t('.download-btn'), signedCopy: !!p.querySelector('.signed-copy-btn'), text: p.textContent.replace(/\\s+/g,' ') }; })()`;
    const rowSel = await cdp.evaluate(`(() => { const r = [...document.querySelectorAll('.doc-tr')].find(x => x.dataset.id === '${docId}'); return r ? r.dataset.id : null; })()`);
    check('Gary\'s signed agreement is a row in the PM table', rowSel === docId);
    let r = await cdp.evaluate(OPEN_ROW(docId)); let panel = await cdp.evaluate(PANEL_READ);
    check('the evidence panel shows the typed name, consent affirmed, address and device', r === 'ok' && /Gary Sizemore/.test(panel.evd) && /consent affirmed/.test(panel.evd) && /Chrome on/.test(panel.evd), panel.evd);
    check('★ the hash at signing is the real recorded hash (full value in the title)', panel.hashTitle === expectedHash && panel.hashText === expectedHash.slice(0, 8) + '…' + expectedHash.slice(-8), panel.hashTitle);
    check('★ the LIVE re-check reads "matches" and the signed copy "intact"', /^matches$/.test(panel.check.trim()) && /intact/.test(panel.copy) && !panel.bad, panel.check + ' / ' + panel.copy);
    check('the footer offers Original and Signed copy', panel.original === 'Original' && panel.signedCopy);
    check('the awaiting-signature health card reports the real oldest age for the still-pending second agreement', await cdp.evaluate(`/oldest sent .* ago|awaiting a signature/.test((document.querySelector('.doc-hc[data-filter="awaiting-signature"] .x')||{}).textContent)`));
    await cdp.evaluate(`document.getElementById('doc-close').click(); true`);

    // Alter the stored original out of band (service role — the only role that can write there).
    const altered = Buffer.concat([pdf, Buffer.from('\n% altered after signing ' + suffix + '\n')]);
    const { error: owErr } = await admin.storage.from('documents').upload(docRow.storage_path, altered, { contentType: 'application/pdf', upsert: true });
    check('(setup) the stored original was overwritten out of band', !owErr, owErr && owErr.message);
    r = await cdp.evaluate(OPEN_ROW(docId)); panel = await cdp.evaluate(PANEL_READ);
    check('★ the same panel now reads DIFFERS — altered after signing, and the evidence block turns red', /DIFFERS/.test(panel.check) && /altered after signing/.test(panel.check) && panel.bad, panel.check);
    check('...while the signed copy, untouched, still reads intact', /intact/.test(panel.copy), panel.copy);
    check('...and the recorded hash on screen did not move', panel.hashTitle === expectedHash);
    // The PM's own Original / Signed copy controls open real signed URLs.
    await cdp.evaluate(`document.querySelector('#doc-panel .signed-copy-btn').click(); true`);
    await sleep(1500);
    const pmOpened = await cdp.evaluate(`window.__opened || []`);
    check('the PM\'s "Signed copy" control opens a real signed URL', pmOpened.length >= 1 && /signed/.test(decodeURIComponent(pmOpened[0])), JSON.stringify(pmOpened));
    // Restore the real original so the rest of the run (and Gary's own retrieval) sees it intact.
    await admin.storage.from('documents').upload(docRow.storage_path, pdf, { contentType: 'application/pdf', upsert: true });
    const recheck = await pmCall('verify-document-signature', { documentId: docId });
    check('(restore) the original is back and the re-check matches again', recheck.status === 200 && recheck.body.original.matches === true);

    // =========================================================================================
    console.log('\n=== PART C — contrast, sheen, fonts, and phones ===\n');
    const OPEN_MODAL_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 200; i++) { const l = document.getElementById('from-list'); if (l && !/animate-pulse/.test(l.innerHTML)) break; await nap(150); }
      for (let i = 0; i < 400; i++) { if (document.querySelector('.doc-row[data-doc-id="${docId2}"] .sign-btn')) break; await nap(150); }
      const b = document.querySelector('.doc-row[data-doc-id="${docId2}"] .sign-btn'); if (!b) return false; b.click();
      for (let i = 0; i < 300; i++) { const st = document.getElementById('dsg-status'); if (st && st.dataset.state !== 'loading') break; await nap(200); }
      const n = document.getElementById('dsg-name'); n.value = 'Gary Sizemore'; n.dispatchEvent(new Event('input', { bubbles: true })); const c = document.getElementById('dsg-consent'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); await nap(300); return true; })()`;
    runContrast('document-signing-modal', 'signing modal (rendered, name + consent, Sign enabled)', clientBootstrap, OPEN_MODAL_PREP, BASE + '/documents.html');
    // The child's own tab loads this page slower than the suite's (cache disabled, fresh
    // profile) — wait for real ROWS, not merely for the skeleton to leave.
    const ROW_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 400; i++) { if (document.querySelectorAll('#from-list .doc-row').length > 0) break; await nap(150); } await nap(400); return true; })()`;
    runContrast('documents-signed-row', 'documents rows (Signed + Sign)', clientBootstrap, ROW_PREP, BASE + '/documents.html');
    const PANEL_PREP_OK = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 300; i++) { if (document.querySelectorAll('.doc-tr').length > 0) break; await nap(200); } await nap(400);
      const r = [...document.querySelectorAll('.doc-tr')].find(x => x.dataset.id === '${docId}'); if (!r) return false; r.click(); for (let i = 0; i < 100; i++) { const h = document.getElementById('doc-hash-check'); if (h && !/checking/i.test(h.textContent)) break; await nap(150); } await nap(300); return true; })()`;
    runContrast('documents-evidence-panel', 'evidence panel (matches)', adminBootstrap, PANEL_PREP_OK, BASE + '/admin-documents.html');
    await admin.storage.from('documents').upload(docRow.storage_path, altered, { contentType: 'application/pdf', upsert: true });
    runContrast('documents-evidence-panel', 'evidence panel (DIFFERS)', adminBootstrap, PANEL_PREP_OK, BASE + '/admin-documents.html');
    await admin.storage.from('documents').upload(docRow.storage_path, pdf, { contentType: 'application/pdf', upsert: true });
    const HEALTH_PREP = `(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 400; i++) { if (document.querySelectorAll('.doc-tr').length > 0) break; await nap(150); } await nap(400); return true; })()`;
    runContrast('admin-documents-health', 'health strip (evidence count, oldest age)', adminBootstrap, HEALTH_PREP, BASE + '/admin-documents.html');

    const sheen = runChild('verify-glass-sheen.mjs', { SHEEN_PAGES: 'documents.html', SHEEN_BOOTSTRAP_JS: clientBootstrap }, 'verify-glass-sheen');
    check('sheen audit on documents.html: nothing under a sheen falls below 4.5:1', /(\d+) measured/.test(sheen) && /SHEEN SWEEP: PASS/.test(sheen), sheen.split('\n').filter((l) => /measured|FAIL|UNMEASURED|SWEEP/.test(l)).join(' | '));
    const fonts = runChild('verify-fonts.mjs', { AUDIT_URL: BASE + '/documents.html', AUDIT_BOOTSTRAP_JS: clientBootstrap }, 'verify-fonts');
    check('fonts: every requested family genuinely loaded on documents.html (no fallbacks)', /FONT AUDIT: all requested families genuinely loaded/.test(fonts), fonts.split('\n').slice(-3).join(' | '));

    // phones — the modal on a REAL phone profile
    await goto(cdp, BASE + '/thank-you.html'); await cdp.evaluate(clientBootstrap);
    for (const w of [390, 375]) {
      await phone(cdp, w);
      await goto(cdp, BASE + '/documents.html'); await cdp.evaluate(DOCS_WAIT);
      const prof = await cdp.evaluate(`(() => ({ coarse: matchMedia('(pointer: coarse)').matches, hoverNone: matchMedia('(hover: none)').matches, dpr: devicePixelRatio, touch: navigator.maxTouchPoints, inner: innerWidth }))()`);
      check(w + 'px: a REAL phone profile (coarse pointer, no hover, DPR 3, touch points)', prof.coarse && prof.hoverNone && prof.dpr === 3 && prof.touch >= 5 && prof.inner === w, JSON.stringify(prof));
      await cdp.evaluate(`document.querySelector('.doc-row[data-doc-id="${docId2}"] .sign-btn').click(); true`);
      const stp = await cdp.evaluate(WAIT_MODAL_SETTLED);
      const ph = await cdp.evaluate(`(() => { const p = document.querySelector('.dsg-panel').getBoundingClientRect(); const s = document.getElementById('dsg-submit').getBoundingClientRect(); const c = document.getElementById('dsg-cancel').getBoundingClientRect(); const cv = document.querySelector('#dsg-viewer canvas'); const cvr = cv ? cv.getBoundingClientRect() : null;
        return { panelW: p.width, panelRight: p.right, inner: innerWidth, submitH: s.height, submitW: s.width, cancelH: c.height, canvasRight: cvr ? cvr.right : null, canvasW: cvr ? cvr.width : null, scrollW: document.documentElement.scrollWidth }; })()`);
      check(w + 'px: the modal fills the phone, the pages fit inside it, nothing scrolls horizontally', stp === 'ready' && ph.panelW === w && ph.panelRight <= w && ph.canvasRight <= w && ph.canvasW > 200 && ph.scrollW <= w, JSON.stringify(ph));
      check(w + 'px: Sign and Not now are ≥44px targets, Sign full-width', ph.submitH >= 44 && ph.cancelH >= 44 && ph.submitW >= w - 40, JSON.stringify({ sh: ph.submitH, sw: ph.submitW, ch: ph.cancelH }));
      await cdp.evaluate(`document.getElementById('dsg-cancel').click(); true`);
    }
    await desktop(cdp, 1440);
    await goto(cdp, BASE + '/documents.html'); await cdp.evaluate(DOCS_WAIT);
    const iframe = await cdp.evaluate(`(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));
      const f = document.createElement('iframe'); f.id = 'mw320'; f.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:760px;border:0;z-index:99999'; f.src = '/documents.html'; document.body.appendChild(f);
      for (let i = 0; i < 200; i++) { try { const d = f.contentDocument; const l = d && d.getElementById('from-list'); if (l && !/animate-pulse/.test(l.innerHTML) && d.readyState === 'complete') break; } catch (_e) {} await nap(200); }
      const d = f.contentDocument, w = f.contentWindow; const b = d.querySelector('.doc-row[data-doc-id="${docId2}"] .sign-btn'); if (!b) return { noBtn: true };
      b.click(); for (let i = 0; i < 300; i++) { const st = d.getElementById('dsg-status'); if (st && st.dataset.state !== 'loading') break; await nap(200); } await nap(400);
      const p = d.querySelector('.dsg-panel').getBoundingClientRect(); const cv = d.querySelector('#dsg-viewer canvas'); const s = d.getElementById('dsg-submit').getBoundingClientRect();
      return { inner: w.innerWidth, state: d.getElementById('dsg-status').dataset.state, panelRight: p.right, canvasRight: cv ? cv.getBoundingClientRect().right : null, submitH: s.height, bodyScroll: d.body.scrollWidth }; })()`);
    check('320px (real iframe): the viewport is genuinely 320 and the document renders', iframe.inner === 320 && iframe.state === 'ready', JSON.stringify(iframe));
    check('★ 320px: the modal and its pages fit, nothing scrolls horizontally, Sign ≥44px', iframe.panelRight <= 320 && iframe.canvasRight <= 320 && iframe.bodyScroll <= 321 && iframe.submitH >= 44, JSON.stringify(iframe));
  } finally {
    try { if (cdp) { cdp.ws.close(); cdp.chrome.kill(); } } catch (_e) { /* */ }
    if (server) server.kill();
    if (profile) await releaseTempDir(profile);
    if (scratch) await releaseTempDir(scratch);
    if (garyBefore) {
      for (const id of docIds) { const { data: sg } = await admin.from('document_signatures').select('signed_copy_storage_path').eq('document_id', id).maybeSingle(); const { data: d } = await admin.from('documents').select('storage_path').eq('id', id).maybeSingle(); const paths = [d && d.storage_path, sg && sg.signed_copy_storage_path].filter(Boolean); if (paths.length) await admin.storage.from('documents').remove(paths); }
      await admin.from('documents').delete().in('id', docIds);
      await admin.from('email_log').delete().ilike('recipient', 'gary-signing-malformed-%');
      await restoreGaryEmail();
      const { data: g } = await admin.from('clients').select('email').eq('id', garyBefore.id).single();
      console.log('\n  (cleanup) Gary\'s email restored: ' + (g && g.email === garyBefore.email) + '; his test documents and objects removed; the evidence rows are permanent by design and name "' + RUN + '" / typed_name "Gary Sizemore"');
    }
  }
  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log(fails.map((f) => '  - ' + f).join('\n')); process.exit(1); }
}

runVerifyMain(main, { watchdogMs: 1200000 });
