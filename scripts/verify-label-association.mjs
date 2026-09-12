/* verify-label-association.mjs — every form control must have a real accessible name.
 *
 * WHY THIS EXISTS
 * ---------------
 * Register row 190's floating-label conversion has to relocate ~72 `<label>` elements, several
 * of them inside JS template strings, to become their input's immediate next sibling. Breaking
 * a `for`/`id` association in that move has NO VISUAL SYMPTOM — the label still renders in the
 * right place and looks correct, while a screen reader announces the control as unnamed. That
 * is the same class of silent failure as the font fallback (row 180, where
 * `document.fonts.check()` returned true for a font that was provably not loaded) and the
 * cascade traps (rows 170/171, where a rule matched and did nothing).
 *
 * SO THIS DOES NOT CHECK FOR ATTRIBUTES. It reads the COMPUTED ACCESSIBLE NAME out of Chrome's
 * own accessibility tree, which is what a screen reader actually consumes. A `for`/`id` pair
 * that looks right in the markup but resolves to nothing — a duplicate id, an id that moved, a
 * label outside the form — produces an empty name here and fails, which attribute-presence
 * checking would sail straight past.
 *
 * A PLACEHOLDER IS NOT AN ACCEPTABLE NAME. Chrome will fall back to the placeholder when
 * nothing else names a control, so a placeholder-only control produces a non-empty accessible
 * name and would pass a naive "is the name empty" test. It is reported as a distinct failure
 * class: a placeholder disappears the moment the user types, so the control becomes unnamed
 * exactly when its value most needs explaining.
 *
 * USAGE
 *   node verify-label-association.mjs                     # all pages
 *   LABEL_BASELINE=write node verify-label-association.mjs # record the current state
 *   LABEL_BASELINE=compare node verify-label-association.mjs
 * The baseline file is how "nothing broke" is proven across a conversion: record before,
 * compare after, and any control that LOST its name is a hard failure regardless of whether
 * the absolute pass count happens to look similar.
 */
import { execSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { makeTempDir, trackChild, releaseTempDir } from './lib/harness-teardown.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.LABEL_PORT || 9388);
const BASE = process.env.LABEL_BASE_URL || 'http://127.0.0.1:8765';
const MODE = process.env.LABEL_BASELINE || '';
const BASELINE_PATH = fileURLToPath(new URL('./label-association-baseline.json', import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failures.push(label + (detail ? '  [' + detail + ']' : '')); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const PUBLIC_PAGES = ['signup.html', 'login.html', 'contact.html', 'reset-password.html'];
const CLIENT_PAGES = ['dashboard.html', 'asset-performance.html', 'asset-collection.html',
  'transactions.html', 'documents.html', 'deploy-capital.html', 'high-yield-savings.html',
  'risk-management.html', 'settings.html', 'support.html'];
const ADMIN_PAGES = ['admin.html', 'admin-advisory-fee.html', 'admin-allocations.html',
  'admin-client-applications.html', 'admin-clients.html', 'admin-deposits.html',
  'admin-documents.html', 'admin-hys.html', 'admin-inbox.html', 'admin-login.html',
  'admin-products.html', 'admin-profile-updates.html', 'admin-security.html',
  'admin-sells.html', 'admin-support.html', 'admin-withdrawals.html'];

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.replace(/^[^{]*/, ''));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('non-local API_URL');
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY, anonKey: status.ANON_KEY };
}

async function connect() {
  const profile = makeTempDir('mw-label-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(300);
    try {
      const tabs = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = tabs.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* not up */ }
  }
  if (!wsUrl) throw new Error('Chrome did not expose a debug target');
  const ws = new WebSocket(wsUrl);
  trackChild(profile, chrome, ws);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable');
  await send('DOM.enable');
  await send('Accessibility.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { send, evaluate, close: () => releaseTempDir(profile) };
}

async function goto(cdp, url, bootstrap) {
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(120);
  await cdp.send('Page.navigate', { url });
  await sleep(400);
  if (bootstrap) {
    await cdp.evaluate(bootstrap);
    await cdp.send('Page.navigate', { url });
  }
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    if (await cdp.evaluate('document.readyState === "complete" && !!document.body')) break;
  }
  await sleep(1100);
}

/* Tags each control with a stable key and with HOW the DOM believes it is named, so a
 * baseline diff can say "this control lost its label" rather than only "a count changed".
 * The DOM view is only a hint; the authoritative name comes from the AX tree below. */
const TAG = `(() => {
  if (!document.body) return { skipped: true };
  // Modal contents are display:none and would otherwise never be inspected — most of the
  // form controls in this project live inside modals.
  const restore = [];
  const hidden = new Set();
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    let n = el.parentElement;
    while (n && n !== document.body) { if (getComputedStyle(n).display === 'none') hidden.add(n); n = n.parentElement; }
  });
  hidden.forEach((n) => {
    restore.push([n, n.getAttribute('style'), n.className]);
    // NOT visibility:hidden. That is safe for a GEOMETRY probe (boxes still lay out, which
    // is why verify-control-patterns.mjs uses it) but it removes the element from the
    // ACCESSIBILITY TREE entirely, so every revealed control reports role=none, ignored=true
    // and no name at all. It made 221 of 246 controls look unnamed on the first two runs of
    // this script. Opacity keeps the node in the tree while keeping it invisible.
    n.classList.remove('hidden'); n.style.display = 'block'; n.style.opacity = '0';
  });
  const out = [];
  let i = 0;
  document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach((el) => {
    // Skip controls the page hides from EVERYONE on the element itself — a spam honeypot is
    // the real case here. Not an accessibility failure: no user is meant to reach it. An
    // ancestor-hidden control (a modal) is still in scope and was revealed above.
    if (el.style && el.style.display === 'none') return;
    const key = 'mwlbl-' + (i++);
    el.setAttribute('data-mwlbl', key);
    let how = [];
    if (el.getAttribute('aria-labelledby')) how.push('aria-labelledby');
    if (el.getAttribute('aria-label')) how.push('aria-label');
    if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) how.push('label[for]');
    if (el.closest('label')) how.push('wrapping-label');
    if (el.getAttribute('placeholder') && el.getAttribute('placeholder').trim()) how.push('placeholder');
    if (el.getAttribute('title')) how.push('title');
    out.push({
      key: key, page: location.pathname.replace(/^\\//, ''), tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '', id: el.id || '', name: el.getAttribute('name') || '',
      how: how, describedBy: el.getAttribute('aria-describedby') || '',
      disabled: el.disabled === true
    });
  });
  // DELIBERATELY NOT RESTORED HERE. The AX tree is queried in a separate CDP round trip,
  // and a control whose ancestor has gone back to display:none by then is IGNORED by the
  // accessibility tree and reports NO NAME — which made 221 of 246 controls look unnamed on
  // the first run of this script. RESTORE below is called after the AX pass instead.
  window.__mwlblRestore = restore;
  return { skipped: false, controls: out, revealed: restore.length };
})()`;

const RESTORE = `(() => {
  (window.__mwlblRestore || []).forEach(([n, style, cls]) => {
    if (style === null) n.removeAttribute('style'); else n.setAttribute('style', style);
    n.className = cls;
  });
  window.__mwlblRestore = [];
  return true;
})()`;

async function axNamesFor(cdp, keys) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: false });
  const rootId = doc.result.root.nodeId;
  const named = {};
  for (const key of keys) {
    const q = await cdp.send('DOM.querySelector', { nodeId: rootId, selector: '[data-mwlbl="' + key + '"]' });
    const nodeId = q.result && q.result.nodeId;
    if (!nodeId) { named[key] = { name: null, role: null, err: 'node not found' }; continue; }
    const desc = await cdp.send('DOM.describeNode', { nodeId });
    const backendId = desc.result && desc.result.node ? desc.result.node.backendNodeId : null;
    const ax = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: true });
    const nodes = (ax.result && ax.result.nodes) || [];
    // Match on backendNodeId rather than "the first node that happens to have a name" —
    // with fetchRelatives on, the returned set includes ancestors, and picking the wrong
    // one silently reports a container's name as the control's.
    const self = nodes.find((n) => n.backendDOMNodeId === backendId) || nodes[nodes.length - 1];
    named[key] = {
      name: self && self.name ? (self.name.value || '') : '',
      // `from` is Chrome's own record of WHICH mechanism produced the name — the only
      // reliable way to tell a real label from a placeholder fallback.
      from: self && self.name && self.name.sources
        ? (self.name.sources.filter((s) => s.value && s.value.value).map((s) => s.type + (s.attribute ? ':' + s.attribute : '')))
        : [],
      role: self && self.role ? self.role.value : '',
      ignored: self ? !!self.ignored : false
    };
  }
  return named;
}

async function main() {
  console.log('Label association — computed accessible names from the real AX tree\n');
  const { url, serviceRoleKey, anonKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'labels-' + suffix + '@test.marketswave.local';
  const PASSWORD = 'LabelAssoc-2026!';
  let clientId = null, cdp = null;
  const report = [];

  try {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (cErr) throw new Error('createUser: ' + cErr.message);
    clientId = created.user.id;
    await admin.from('clients').insert({
      id: clientId, name: 'Label Assoc ' + suffix, email, phone: '+1-555-0166',
      account_type: 'Individual Account', status: 'active'
    });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 30000, allocated_capital: 0, asset_returns: 0 });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0001', units: 200, cost_basis: 20000 });

    const anon = createClient(url, anonKey);
    const { data: signed } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const clientBootstrap = [
      'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');',
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');',
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + ');',
      'true'
    ].join('');
    const { data: pmSigned } = await anon.auth.signInWithPassword({
      email: 'pm@marketswave.local', password: process.env.LOCAL_PM_PASSWORD || 'MarketswavePM-Local-2026!'
    });
    const adminBootstrap = pmSigned && pmSigned.session
      ? 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(pmSigned.session)) + '); true'
      : null;

    cdp = await connect();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    for (const [pages, boot, group] of [[PUBLIC_PAGES, null, 'public'], [CLIENT_PAGES, clientBootstrap, 'client'], [ADMIN_PAGES, adminBootstrap, 'admin']]) {
      for (const page of pages) {
        await goto(cdp, BASE + '/' + page, boot);
        const tagged = await cdp.evaluate(TAG);
        if (!tagged || tagged.skipped) { report.push({ page, group, error: 'page never rendered' }); continue; }
        const ax = await axNamesFor(cdp, tagged.controls.map((c) => c.key));
        await cdp.evaluate(RESTORE);
        for (const c of tagged.controls) {
          const a = ax[c.key] || {};
          const nameText = (a.name || '').trim();
          const fromPlaceholderOnly = a.from && a.from.length > 0 &&
            a.from.every((f) => /placeholder|title/.test(f));
          report.push({
            page, group, id: c.id, name: c.name, tag: c.tag, type: c.type,
            how: c.how.join('+'), axName: nameText, axFrom: (a.from || []).join('+'),
            role: a.role || '', ok: nameText.length > 0 && !fromPlaceholderOnly,
            placeholderOnly: fromPlaceholderOnly
          });
        }
      }
    }
  } finally {
    if (cdp) await cdp.close();
    if (clientId) {
      await admin.from('holdings').delete().eq('client_id', clientId);
      await admin.from('account_state').delete().eq('client_id', clientId);
      await admin.from('clients').delete().eq('id', clientId);
      const { error } = await admin.auth.admin.deleteUser(clientId);
      if (error) console.error('CLEANUP: ' + error.message);
    }
  }

  const total = report.filter((r) => !r.error).length;
  const unnamed = report.filter((r) => !r.error && !r.ok && !r.placeholderOnly);
  const placeholderOnly = report.filter((r) => r.placeholderOnly);
  const pagesFailed = report.filter((r) => r.error);

  console.log('\n' + total + ' form controls inspected across ' +
    new Set(report.map((r) => r.page)).size + ' pages\n');

  if (unnamed.length) {
    console.log('UNNAMED (no accessible name at all):');
    unnamed.forEach((r) => console.log('  ' + r.page.padEnd(30) + (r.tag + (r.type ? '[' + r.type + ']' : '')).padEnd(16) +
      '#' + (r.id || r.name || '(none)').padEnd(26) + ' dom-hint=' + (r.how || 'none')));
  }
  if (placeholderOnly.length) {
    console.log('\nPLACEHOLDER-ONLY (named only by a placeholder, which vanishes on typing):');
    placeholderOnly.forEach((r) => console.log('  ' + r.page.padEnd(30) + (r.tag + (r.type ? '[' + r.type + ']' : '')).padEnd(16) +
      '#' + (r.id || r.name || '(none)').padEnd(26) + ' name="' + r.axName + '"'));
  }

  if (MODE === 'write') {
    const snap = {};
    report.filter((r) => !r.error).forEach((r) => { snap[r.page + '::' + (r.id || r.name || r.tag + ':' + r.type)] = { axName: r.axName, axFrom: r.axFrom, ok: r.ok }; });
    writeFileSync(BASELINE_PATH, JSON.stringify(snap, null, 1) + '\n');
    console.log('\nBaseline written: ' + Object.keys(snap).length + ' controls -> ' + BASELINE_PATH);
    process.exit(0);
  }

  if (MODE === 'compare') {
    if (!existsSync(BASELINE_PATH)) throw new Error('no baseline recorded — run with LABEL_BASELINE=write first');
    const base = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const now = {};
    report.filter((r) => !r.error).forEach((r) => { now[r.page + '::' + (r.id || r.name || r.tag + ':' + r.type)] = { axName: r.axName, axFrom: r.axFrom, ok: r.ok }; });
    const regressed = [];
    for (const k of Object.keys(base)) {
      if (!(k in now)) continue;   // a control that no longer exists is a separate concern
      if (base[k].ok && !now[k].ok) regressed.push(k + ': was "' + base[k].axName + '" (' + base[k].axFrom + ') -> now "' + now[k].axName + '" (' + now[k].axFrom + ')');
    }
    const gone = Object.keys(base).filter((k) => !(k in now));
    check('no control that HAD an accessible name lost it (' + Object.keys(base).length + ' in baseline)', regressed.length === 0, regressed.slice(0, 6).join(' | '));
    // A control disappearing only matters if it HAD a name. An unnamed one vanishing is the
    // fix working: keys here are id-based, so giving a previously id-less control an id —
    // which is how it gets a label at all — legitimately changes its key. Failing on that
    // would punish exactly the repair this check exists to encourage.
    const goneNamed = gone.filter((k) => base[k].ok);
    check('no control that HAD a name has disappeared (' + gone.length + ' absent, ' + goneNamed.length + ' of them named)',
      goneNamed.length === 0, goneNamed.slice(0, 8).join(' | '));
    if (gone.length) console.log('  absent, but unnamed in the baseline, so not a regression: ' + gone.join(', '));
    const fixed = Object.keys(base).filter((k) => k in now && !base[k].ok && now[k].ok);
    if (fixed.length) console.log('\n  ' + fixed.length + ' control(s) GAINED an accessible name since the baseline:\n    ' + fixed.join('\n    '));
  }

  check('every page rendered', pagesFailed.length === 0, pagesFailed.map((p) => p.page).join(', '));
  check('every form control has a real accessible name (' + total + ' inspected)', unnamed.length === 0, unnamed.length + ' unnamed');
  check('no control is named ONLY by its placeholder', placeholderOnly.length === 0, placeholderOnly.length + ' placeholder-only');

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('LABEL ASSOCIATION: PASS');
}

runVerifyMain(main, { watchdogMs: 1500000 });
