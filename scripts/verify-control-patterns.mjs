/* verify-control-patterns.mjs — Button and Control Modernisation sweep (2026-09-10).
 *
 * WHAT THIS PROVES, AND WHY IT IS SHAPED THIS WAY
 * -----------------------------------------------
 * Three lessons from the mobile-fix batches are applied literally here, because each
 * of them caught a real failure that reading the CSS would not have:
 *
 *  1. EVERY assertion reads a REAL computed/rendered box. Never "the class is present"
 *     and never "the rule was written". Batch 2 shipped a rule that MATCHED and did
 *     nothing (identical specificity, later rule won) and only a measured box caught it.
 *  2. EVERY measurement is preceded by a VIEWPORT-INTEGRITY GUARD. Batch 1's first run
 *     reported a clean PASS "at 375px" while Emulation silently clamped to 492px, so
 *     nothing narrow was ever actually tested. The floor is 348px on this build, so
 *     320px goes through a real same-origin iframe and is labelled as such.
 *  3. Page.navigate runs with Network.setCacheDisabled. Batch 3's first re-sweep
 *     reported five tables still broken because the profile served cached copies of
 *     files that had already been fixed.
 *
 * THE REGRESSION THAT MATTERS MOST is not a wrong height — it is losing row 171's
 * guarantee that zero controls sit under 44x44 below lg. Tier C is 40px by design and
 * relies on tap-targets.css's own min-height to reach 44 on mobile; if that layering
 * ever breaks, this suite fails loudly rather than the sweep silently undoing a
 * shipped accessibility fix.
 */
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CONTROLS_PORT || 9366);
const BASE = process.env.CONTROLS_BASE_URL || 'http://127.0.0.1:8765';
const SHOT_DIR = process.env.CONTROLS_SHOT_DIR || '';

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failures.push(label + (detail ? '  [' + detail + ']' : '')); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.replace(/^[^{]*/, ''));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('non-local API_URL');
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY, anonKey: status.ANON_KEY };
}

async function sweepResidue(admin, re) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const ids = (data && data.users ? data.users : []).filter((u) => re.test(u.email || '')).map((u) => u.id);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  if (ids.length) console.log('sweep: cleared ' + ids.length + ' leftover account(s)\n');
}

async function connect() {
  const profile = mkdtempSync(join(tmpdir(), 'mw-controls-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });
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
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
  // Without this a headless page is not considered focused, so .focus() never matches
  // :focus and any focus-state assertion silently measures the RESTING state twice.
  // That is exactly what happened here first: rest and focused both read 4.77:1 when
  // the focused label is navy on white and should be far higher.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });  // lesson 3
  return { send, evaluate, close: () => { ws.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch (e) {} } };
}

// Lesson 2: never measure without proving the viewport is the one that was asked for.
async function setViewport(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
  await sleep(120);
  const real = await cdp.evaluate('document.documentElement.clientWidth');
  if (real !== width) throw new Error('VIEWPORT CLAMPED: asked ' + width + ', got ' + real);
  return real;
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
    // readyState alone is not enough: a page mid-redirect reports "complete" on an
    // empty document with a null body, and the probe then throws on document.body.
    const ready = await cdp.evaluate('document.readyState === "complete" && !!document.body');
    if (ready) break;
  }
  await sleep(900);   // let the async render bundles settle
}

async function shot(cdp, name) {
  if (!SHOT_DIR) return;
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (r.result && r.result.data) {
    mkdirSync(SHOT_DIR, { recursive: true });
    writeFileSync(join(SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'));
  }
}

/* Reads every control on the page as a REAL rendered box. Returns per-tier groups plus
 * the full undersized list, so one probe answers both "did the tiers land" and "did
 * row 171's floor survive". */
const PROBE = `(() => {
  if (!document.body) return { skipped: 'no body' };
  const out = { tierA: [], tierB: [], tierC: [], fields: [], undersized: [], overflow: null, revealed: 0 };
  const px = (v) => Math.round(parseFloat(v) * 10) / 10;

  // Overflow is measured in the page's NORMAL state, before anything is revealed —
  // a modal forced visible would report its own fixed overlay, not the real page.
  out.overflow = { body: document.body.scrollWidth, view: document.documentElement.clientWidth };

  // Most Tier A controls live inside modals, which ship display:none. Measuring only what
  // is on screen would silently skip the majority of the sweep and report a confident pass
  // over 7 buttons. Reveal every hidden ANCESTOR of a converted control, measure, restore.
  // Row 171's floor is measured in the page's NORMAL state, BEFORE anything is revealed.
  // A force-revealed modal child is laid out outside its real flex row, so its WIDTH would
  // be an artifact of this probe rather than the layout — height for those controls is
  // still covered by the tier checks in Parts 1 and 2.
  document.querySelectorAll('button, a.flex, a.inline-flex, select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), [role=button]').forEach((el) => {
    // A .mw-upload-input is deliberately clipped to 1px — that is exactly what keeps it
    // focusable while invisible (row 189). Its real tap target is the label face, which is
    // measured in its place rather than skipping the pair and losing the coverage.
    if (el.classList && el.classList.contains('mw-upload-input')) {
      const face = el.parentElement && el.parentElement.querySelector('label.mw-upload-face');
      if (face) {
        const fr = face.getBoundingClientRect();
        // A 0x0 face is inside a display:none modal at scan time — skipped like every other
        // hidden control, matching the guard the main branch already applies.
        if (fr.width === 0 && fr.height === 0) return;
        if (fr.height < 43.5 || fr.width < 43.5) {
          out.undersized.push({ cls: 'mw-upload-face (target for the clipped input)', tag: 'label', h: px(fr.height), w: px(fr.width) });
        }
      }
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (getComputedStyle(el).display === 'none') return;
    if (r.height < 43.5 || r.width < 43.5) {
      out.undersized.push({ cls: (el.className || '').toString().slice(0, 60), tag: el.tagName.toLowerCase(), h: px(r.height), w: px(r.width) });
    }
  });

  const hiddenAncestors = new Set();
  document.querySelectorAll('.mw-btn, .mw-field').forEach((el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      if (getComputedStyle(n).display === 'none') hiddenAncestors.add(n);
      n = n.parentElement;
    }
  });
  const restore = [];
  hiddenAncestors.forEach((n) => {
    restore.push([n, n.getAttribute('style') || null, n.className]);
    n.classList.remove('hidden');
    n.style.display = 'block';
    n.style.visibility = 'hidden';   // measured, never painted — no screenshot pollution
  });
  out.revealed = restore.length;

  try {
    document.querySelectorAll('.mw-btn').forEach((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const rec = {
        cls: (el.className || '').toString(), h: px(r.height), w: px(r.width),
        radius: px(cs.borderTopLeftRadius), weight: cs.fontWeight, overflow: cs.overflow
      };
      if (el.classList.contains('mw-btn-sm')) out.tierC.push(rec);
      else if (el.classList.contains('mw-btn-secondary') || el.classList.contains('mw-btn-outline')) out.tierB.push(rec);
      else out.tierA.push(rec);
    });
    document.querySelectorAll('.mw-field').forEach((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      out.fields.push({
        tag: el.tagName.toLowerCase(), cls: (el.className || '').toString(), h: px(r.height),
        radius: px(cs.borderTopLeftRadius), border: cs.borderTopWidth,
        chevron: el.tagName === 'SELECT' ? (cs.backgroundImage !== 'none') : null
      });
    });
  } finally {
    restore.forEach(([n, style, cls]) => {
      if (style === null) n.removeAttribute('style'); else n.setAttribute('style', style);
      n.className = cls;
    });
  }
  return out;
})()`;

async function main() {
  console.log('Button and Control Modernisation — measured control pass\n');
  const { url, serviceRoleKey, anonKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await sweepResidue(admin, /^controls-[0-9a-f]{8}@test[.]marketswave[.]local$/);

  const suffix = crypto.randomBytes(4).toString('hex');
  const PASSWORD = 'ControlPatterns-2026!';
  const email = 'controls-' + suffix + '@test.marketswave.local';
  let clientId = null, cdp = null;

  try {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (cErr) throw new Error('createUser: ' + cErr.message);
    clientId = created.user.id;
    await admin.from('clients').insert({
      id: clientId, name: 'Controls Sweep ' + suffix, email, phone: '+1-555-0199',
      account_type: 'Individual Account', status: 'active'
    });
    await admin.from('account_state').insert({
      client_id: clientId, unallocated_capital: 45000, allocated_capital: 0, asset_returns: 1200
    });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0001', units: 400, cost_basis: 40000 });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0003', units: 250, cost_basis: 25000 });
    // Real rows so table-row actions (Tier C's whole reason for existing) actually render.
    await admin.from('documents').insert({
      client_id: clientId, filename: 'Controls Sweep Statement.pdf', category: 'Statements & Reports',
      direction: 'from', status: 'Signature Required', is_new: true, storage_path: null
    });

    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error('signIn: ' + sErr.message);
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const clientBootstrap = [
      'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');',
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');',
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + ');',
      'true'
    ].join('');

    // Admin pages need a real PM session under the admin client's OWN distinct storageKey
    // (Admin Auth Consolidation gave it one specifically so the two personas cannot collide).
    const { data: pmSigned } = await anon.auth.signInWithPassword({
      email: 'pm@marketswave.local', password: process.env.LOCAL_PM_PASSWORD || 'MarketswavePM-Local-2026!'
    });
    const adminBootstrap = pmSigned && pmSigned.session
      ? 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(pmSigned.session)) + '); true'
      : null;

    cdp = await connect();

    // ---------------------------------------------------------------- PART 1: tier geometry
    console.log('PART 1 — tier geometry at desktop (the actual point of the sweep)\n');
    const CLIENT_PAGES = ['dashboard.html', 'asset-performance.html', 'asset-collection.html',
      'transactions.html', 'documents.html', 'deploy-capital.html',
      'high-yield-savings.html', 'risk-management.html', 'settings.html', 'support.html'];

    await setViewport(cdp, 1440);
    let totA = 0, totB = 0, totC = 0, totF = 0;
    const badA = [], badB = [], badC = [], badF = [];
    for (const page of CLIENT_PAGES) {
      await goto(cdp, BASE + '/' + page, clientBootstrap);
      const p = await cdp.evaluate(PROBE);
      if (p.skipped) throw new Error('page never rendered: ' + page);
      totA += p.tierA.length; totB += p.tierB.length; totC += p.tierC.length; totF += p.fields.length;
      p.tierA.forEach((r) => { if (r.h !== 54 || r.radius !== 12 || r.weight !== '600') badA.push(page + ' ' + JSON.stringify(r)); });
      p.tierB.forEach((r) => { if (r.h !== 54 || r.radius !== 12) badB.push(page + ' ' + JSON.stringify(r)); });
      p.tierC.forEach((r) => { if (r.h !== 40 || r.radius < 10) badC.push(page + ' ' + JSON.stringify(r)); });
      p.fields.forEach((r) => {
        const okH = (r.h === 54 || r.h === 40 || r.tag === 'textarea');
        if (!okH || (r.radius !== 12 && r.radius !== 10)) badF.push(page + ' ' + JSON.stringify(r));
      });
    }
    check('client: every Tier A control measures 54px / 12px radius / weight 600 (' + totA + ' measured)', badA.length === 0, badA.slice(0, 3).join(' | '));
    check('client: every Tier B control measures 54px / 12px radius (' + totB + ' measured)', badB.length === 0, badB.slice(0, 3).join(' | '));
    check('client: every Tier C control measures 40px at desktop (' + totC + ' measured)', badC.length === 0, badC.slice(0, 3).join(' | '));
    check('client: every form control took the .mw-field box (' + totF + ' measured)', badF.length === 0, badF.slice(0, 3).join(' | '));
    check('client: the sweep genuinely covers all three tiers, not one page', totA > 10 && totB > 10 && totC > 20, 'A=' + totA + ' B=' + totB + ' C=' + totC);

    // ---------------------------------------------------------------- PART 2: admin geometry + palette
    console.log('\nPART 2 — admin: same shape, its own locked palette\n');
    const ADMIN_PAGES = ['admin.html', 'admin-deposits.html', 'admin-withdrawals.html',
      'admin-allocations.html', 'admin-sells.html', 'admin-hys.html', 'admin-clients.html',
      'admin-products.html', 'admin-documents.html', 'admin-inbox.html', 'admin-profile-updates.html'];
    let aA = 0, aC = 0, aF = 0;
    const aBad = [], navyLeak = [];
    for (const page of ADMIN_PAGES) {
      await goto(cdp, BASE + '/' + page, adminBootstrap);
      const p = await cdp.evaluate(PROBE);
      if (p.skipped) throw new Error('page never rendered: ' + page);
      aA += p.tierA.length; aC += p.tierC.length; aF += p.fields.length;
      p.tierA.forEach((r) => { if (r.h !== 54 || r.radius !== 12) aBad.push(page + ' ' + JSON.stringify(r)); });
      p.tierC.forEach((r) => { if (r.h !== 40) aBad.push(page + ' C ' + JSON.stringify(r)); });
      // The locked rule: converge SHAPE, never the navy palette.
      const leak = await cdp.evaluate(`(() => {
        const bad = [];
        document.querySelectorAll('.mw-btn').forEach((el) => {
          const bg = getComputedStyle(el).backgroundImage + ' ' + getComputedStyle(el).backgroundColor;
          if (/34, 72, 92|27, 58, 75|21, 43, 59/.test(bg)) bad.push(el.className.slice(0, 50));
        });
        return bad;
      })()`);
      leak.forEach((l) => navyLeak.push(page + ': ' + l));
    }
    check('admin: Tier A/C geometry matches the client family exactly (' + (aA + aC) + ' measured)', aBad.length === 0, aBad.slice(0, 3).join(' | '));
    check('admin: NO control paints the client tool\'s navy — locked palette holds', navyLeak.length === 0, navyLeak.slice(0, 3).join(' | '));
    check('admin: form controls took the box too (' + aF + ' measured)', aF > 15, String(aF));

    // ---------------------------------------------------------------- PART 3: the row-171 floor
    console.log('\nPART 3 — row 171\'s 44x44 floor must survive (the real regression risk)\n');
    const undersizedAll = [];
    for (const width of [390, 375]) {
      await setViewport(cdp, width);
      for (const page of CLIENT_PAGES.concat(ADMIN_PAGES)) {
        const boot = page.startsWith('admin') ? adminBootstrap : clientBootstrap;
        await goto(cdp, BASE + '/' + page, boot);
        const p = await cdp.evaluate(PROBE);
        if (p.skipped) { undersizedAll.push('UNRENDERED ' + width + 'px ' + page); continue; }
        p.undersized.forEach((u) => undersizedAll.push(width + 'px ' + page + ' ' + JSON.stringify(u)));
        if (p.overflow.body > p.overflow.view + 1) {
          undersizedAll.push('OVERFLOW ' + width + 'px ' + page + ' body=' + p.overflow.body + ' view=' + p.overflow.view);
        }
      }
    }
    const under = undersizedAll.filter((u) => !u.startsWith('OVERFLOW') && !u.startsWith('UNRENDERED'));
    const unrendered = undersizedAll.filter((u) => u.startsWith('UNRENDERED'));
    check('every page actually rendered at 390px and 375px (a blank page cannot pass vacuously)', unrendered.length === 0, unrendered.slice(0, 4).join(' | '));
    check('0 controls under 44x44 across all 21 pages at 390px and 375px', under.length === 0, under.slice(0, 4).join(' | '));
    check('no horizontal overflow introduced at 390px or 375px (Tier A min-width released below 480)',
      undersizedAll.filter((u) => u.startsWith('OVERFLOW')).length === 0,
      undersizedAll.filter((u) => u.startsWith('OVERFLOW')).slice(0, 4).join(' | '));

    // 320px goes through a real same-origin iframe: the top-level override floors at 348.
    await setViewport(cdp, 375);
    await goto(cdp, BASE + '/settings.html', clientBootstrap);
    const iframe320 = await cdp.evaluate(`(async () => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:900px;border:0;z-index:99999';
      f.src = 'settings.html';
      document.body.appendChild(f);
      await new Promise((r) => { f.onload = r; setTimeout(r, 6000); });
      await new Promise((r) => setTimeout(r, 2500));
      const d = f.contentDocument;
      const w = d.documentElement.clientWidth;
      const small = [];
      d.querySelectorAll('button, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden])').forEach((el) => {
        if (!el.offsetParent) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.height < 43.5) small.push(el.tagName + '.' + (el.className || '').toString().slice(0, 40) + ' h=' + Math.round(r.height));
      });
      const res = { width: w, overflow: d.body.scrollWidth, small: small.slice(0, 5), count: d.querySelectorAll('.mw-btn,.mw-field').length };
      f.remove();
      return res;
    })()`);
    check('320px (real iframe): viewport is genuinely 320, not clamped', iframe320.width === 320, JSON.stringify(iframe320.width));
    check('320px: controls present and none under 44px tall', iframe320.count > 0 && iframe320.small.length === 0,
      JSON.stringify(iframe320.small));
    check('320px: no horizontal overflow', iframe320.overflow <= 321, 'scrollWidth=' + iframe320.overflow);

    // ---------------------------------------------------------------- PART 4: states
    console.log('\nPART 4 — the states, measured rather than assumed\n');
    await setViewport(cdp, 1440);
    await goto(cdp, BASE + '/deploy-capital.html', clientBootstrap);
    const states = await cdp.evaluate(`(() => {
      const btn = document.querySelector('.mw-btn-primary');
      if (!btn) return { err: 'no primary button found' };
      const before = getComputedStyle(btn, '::before');
      const cs = getComputedStyle(btn);
      // focus-visible is only assertable by genuinely focusing via keyboard semantics
      btn.focus();
      const focused = getComputedStyle(btn).boxShadow;
      return {
        sweepPaints: before.content !== 'none' && parseFloat(before.width) > 0,
        sweepWidth: before.width,
        gradient: /linear-gradient/.test(cs.backgroundImage),
        overflowHidden: cs.overflow === 'hidden',
        hasShadow: cs.boxShadow !== 'none',
        focusShadow: focused
      };
    })()`);
    check('Tier A actually paints a gradient (not a flat fill)', states.gradient === true, JSON.stringify(states));
    check('the light sweep pseudo-element genuinely exists and has width', states.sweepPaints === true, 'width=' + states.sweepWidth);
    check('Tier A clips the sweep (overflow:hidden present)', states.overflowHidden === true, states.overflowHidden);
    check('Tier A carries a real elevation shadow', states.hasShadow === true, states.hasShadow);
    check('Tier C suppresses the sweep (::before content none)', await cdp.evaluate(
      `(() => { const b = document.querySelector('.mw-btn-sm'); return b ? getComputedStyle(b, '::before').content === 'none' : true; })()`
    ) === true, 'tier C sweep');

    // Every Tier A gradient carries WHITE text, so BOTH ends of every ramp must clear
    // 4.5:1 against white — not just the dark end. This caught a real, pre-existing
    // failure: the old Approve/Credit buttons were emerald-600, which is 3.77:1, and a
    // gradient using it as its light stop would have preserved that under new paint.
    const gradStops = await cdp.evaluate([
      '(() => {',
      '  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };',
      '  const ratio = (a, b) => { const p = [lum(a), lum(b)].sort((x, y) => y - x); return (p[0] + 0.05) / (p[1] + 0.05); };',
      // No regex here: this expression crosses Python -> JS-string -> regex-literal, and an
      // over-escaped backslash silently parsed the RED channel as null while the other two
      // looked correct — a failure that reads like a real contrast problem but is not.
      '  const parseStops = (img) => {',
      '    const out = []; let i = 0;',
      '    while (true) {',
      '      const at = img.indexOf("rgb", i); if (at === -1) break;',
      '      const open = img.indexOf("(", at); const close = img.indexOf(")", open);',
      '      if (open === -1 || close === -1) break;',
      '      const parts = img.slice(open + 1, close).split(",").map((n) => parseFloat(n.trim()));',
      '      if (parts.length >= 3 && parts.every((n, k) => k > 2 || (typeof n === "number" && !isNaN(n)))) out.push(parts.slice(0, 3));',
      '      i = close + 1;',
      '    }',
      '    return out;',
      '  };',
      '  const probe = document.createElement("div");',
      '  document.body.appendChild(probe);',
      '  const out = [];',
      '  ["mw-btn-primary", "mw-btn-admin", "mw-btn-approve", "mw-btn-danger"].forEach((cls) => {',
      '    probe.className = "mw-btn " + cls;',
      '    parseStops(getComputedStyle(probe).backgroundImage).forEach((st, i) => {',
      '      out.push({ cls: cls, stop: i, rgb: st, vsWhite: Math.round(ratio([255,255,255], st) * 100) / 100 });',
      '    });',
      '  });',
      '  probe.remove();',
      '  return out;',
      '})()'
    ].join(String.fromCharCode(10)));
    const weakStops = (gradStops || []).filter((s) => s.vsWhite < 4.5);
    check('every Tier A gradient stop clears 4.5:1 against its own white label (' + (gradStops || []).length + ' stops)',
      (gradStops || []).length >= 6 && weakStops.length === 0,
      JSON.stringify(weakStops));

    // ---- Floating-label contrast (row 190), computed rather than sampled.
    // The label is ONE flat colour on ONE flat field ground, so the arithmetic is exact and
    // is not subject to the glyph-antialiasing and modal-overlap artifacts that make
    // screenshot sampling bounce on this particular surface (a stacked modal reads one
    // panel's white through another). Pixel sampling still covers it separately via
    // verify-contrast.mjs's controls-fields profile; this is the deterministic guard.
    await goto(cdp, BASE + '/documents.html', clientBootstrap);
    const fldContrast = await cdp.evaluate([
      '(async () => {',
      '  const settle = () => new Promise((r) => setTimeout(r, 320));',
      '  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };',
      '  const ratio = (a, b) => { const p = [lum(a), lum(b)].sort((x, y) => y - x); return Math.round(((p[0] + 0.05) / (p[1] + 0.05)) * 100) / 100; };',
      '  const rgb = (str) => String(str).split(/[^0-9]+/).filter(function (x) { return x !== ""; }).slice(0, 3).map(Number);',
      '  const wrap = document.createElement("div");',
      '  wrap.className = "mw-fld";',
      '  const probeInput = document.createElement("input");',
      '  probeInput.className = "mw-field"; probeInput.id = "__probe"; probeInput.setAttribute("placeholder", " ");',
      '  const probeLabel = document.createElement("label");',
      '  probeLabel.setAttribute("for", "__probe"); probeLabel.textContent = "Probe";',
      '  wrap.appendChild(probeInput); wrap.appendChild(probeLabel);',
      '  document.body.appendChild(wrap);',
      '  const field = wrap.querySelector(".mw-field");',
      '  const label = wrap.querySelector("label");',
      '  const ground = rgb(getComputedStyle(field).backgroundColor);',
      '  const rest = rgb(getComputedStyle(label).color);',
      '  await settle();',
      '  const restSettled = rgb(getComputedStyle(label).color);',
      '  field.focus();',
      '  await settle();',
      '  const focusedGround = rgb(getComputedStyle(field).backgroundColor);',
      '  const focused = rgb(getComputedStyle(label).color);',
      '  const out = { restStable: JSON.stringify(rest) === JSON.stringify(restSettled), restOnGround: ratio(rest, ground), focusedOnGround: ratio(focused, focusedGround), rest: rest, focused: focused, ground: ground, focusedGround: focusedGround, matchesFocus: field.matches(":focus"), docHasFocus: document.hasFocus(), isActive: document.activeElement === field };',
      '  wrap.remove();',
      '  return out;',
      '})()'
    ].join(String.fromCharCode(10)));
    check('floating label clears 4.5:1 at rest (' + fldContrast.restOnGround + ':1)',
      fldContrast.restOnGround >= 4.5, JSON.stringify(fldContrast));
    check('floating label clears 4.5:1 while FOCUSED, when its colour AND the ground both change (' + fldContrast.focusedOnGround + ':1, label rgb ' + fldContrast.focused.join() + ' on ' + fldContrast.focusedGround.join() + ', :focus matched=' + fldContrast.matchesFocus + ')',
      fldContrast.focusedOnGround >= 4.5, JSON.stringify(fldContrast));
    // ★ NON-VACUITY GUARD. The first two assertions above passed at an identical 4.77:1
    // for both states, which is impossible: focus repaints the label navy on white. The
    // probe was reading the RESTING colour twice, because `.mw-fld > label` carries
    // `transition: ... color 0.16s` and getComputedStyle immediately after .focus()
    // returns the pre-transition value. Same class as the mid-fade contrast trap in
    // row 176. Without this guard the pair would keep passing while measuring nothing.
    check('the focused reading is genuinely a DIFFERENT colour from rest, so the pair is not measuring one state twice',
      JSON.stringify(fldContrast.focused) !== JSON.stringify(fldContrast.rest) && fldContrast.matchesFocus === true,
      JSON.stringify(fldContrast));

    // ---------------------------------------------------------------- PART 5: still works
    console.log('\nPART 5 — every control still WORKS (real clicks, real state changes)\n');
    await goto(cdp, BASE + '/asset-collection.html', clientBootstrap);
    const tabWorks = await cdp.evaluate(`(() => {
      const tabs = [...document.querySelectorAll('.category-tab')];
      if (tabs.length < 2) return { err: 'tabs missing', n: tabs.length };
      const before = tabs[1].className;
      tabs[1].click();
      const after = tabs[1].className;
      return { moved: before !== after, activeNow: /bg-navy/.test(after), firstDeactivated: !/bg-navy/.test(tabs[0].className), keepsGeometry: /mw-btn-sm/.test(after) };
    })()`);
    check('category tabs: the JS class-toggle still fires and swaps the active pill', tabWorks.moved === true && tabWorks.activeNow === true, JSON.stringify(tabWorks));
    check('category tabs: the previously-active tab genuinely deactivated', tabWorks.firstDeactivated === true, JSON.stringify(tabWorks));
    check('category tabs: geometry class survives the JS rewrite', tabWorks.keepsGeometry === true, JSON.stringify(tabWorks));

    await goto(cdp, BASE + '/documents.html', clientBootstrap);
    const filterWorks = await cdp.evaluate(`(() => {
      const sel = document.getElementById('filter-category');
      const apply = document.getElementById('apply-filters');
      const reset = document.getElementById('reset-filters');
      if (!sel || !apply || !reset) return { err: 'filter bar missing' };
      const cs = getComputedStyle(sel);
      sel.value = 'Contracts';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      apply.click();
      return {
        selIsField: sel.classList.contains('mw-field'),
        chevron: cs.backgroundImage !== 'none',
        appearanceNone: cs.appearance === 'none',
        applyClickable: !apply.disabled,
        resetH: Math.round(reset.getBoundingClientRect().height),
        selH: Math.round(sel.getBoundingClientRect().height)
      };
    })()`);
    check('documents filter bar: the select is a real .mw-field with a custom chevron', filterWorks.chevron === true && filterWorks.appearanceNone === true, JSON.stringify(filterWorks));
    check('documents filter bar: Apply/Reset still clickable and sized as one row', filterWorks.applyClickable === true && filterWorks.resetH >= 40, JSON.stringify(filterWorks));

    await goto(cdp, BASE + '/high-yield-savings.html', clientBootstrap);
    const modalWorks = await cdp.evaluate(`(() => {
      const open = document.getElementById('open-pocket-btn') || document.querySelector('[id*="new-pocket"]');
      if (open) open.click();
      const modal = document.getElementById('new-pocket-modal');
      const vis = modal ? !modal.classList.contains('hidden') : false;
      const tabs = [...document.querySelectorAll('.np-term-mode-tab')];
      let toggled = false;
      if (tabs.length > 1) { const b = tabs[1].className; tabs[1].click(); toggled = tabs[1].className !== b; }
      return { modalOpened: vis, tabToggled: toggled, tabCount: tabs.length };
    })()`);
    check('HYS: New Pocket modal still opens from its converted trigger', modalWorks.modalOpened === true, JSON.stringify(modalWorks));
    check('HYS: term-mode tabs still toggle after conversion', modalWorks.tabToggled === true, JSON.stringify(modalWorks));

    // file input: the ::file-selector-button half is the part that IS stylable
    await goto(cdp, BASE + '/documents.html', clientBootstrap);
    // Row 189 replaced the bare native file input with the accessible .mw-upload component,
    // so `.mw-file` and its ::file-selector-button styling no longer exist. What matters now
    // is that the component's visible face is a real tap target and the input behind it is
    // still a genuine, focusable file input.
    const fileCtl = await cdp.evaluate(`(() => {
      const f = document.getElementById('upload-file');
      if (!f) return { err: 'no file input' };
      const root = f.closest('.mw-upload');
      const face = root && root.querySelector('label.mw-upload-face');
      const cs = getComputedStyle(f);
      const fr = face ? face.getBoundingClientRect() : null;
      return { type: f.type, usesComponent: !!root, faceH: fr ? Math.round(fr.height) : 0,
               faceRadius: face ? getComputedStyle(face).borderTopLeftRadius : '',
               notDisplayNone: cs.display !== 'none', notVisHidden: cs.visibility !== 'hidden' };
    })()`);
    check('file input: the component face is a real tap target at the minimum size',
      fileCtl.faceH >= 44 && fileCtl.faceRadius === '12px', JSON.stringify(fileCtl));
    check('file input: still a REAL native <input type=file>, focusable, not replaced by a proxy',
      fileCtl.type === 'file' && fileCtl.usesComponent === true && fileCtl.notDisplayNone && fileCtl.notVisHidden,
      JSON.stringify(fileCtl));

    // date input: box converged, native indicator deliberately kept
    await goto(cdp, BASE + '/transactions.html', clientBootstrap);
    const dateCtl = await cdp.evaluate(`(() => {
      const d = document.querySelector('input[type=date]');
      if (!d) return { err: 'no date input' };
      const cs = getComputedStyle(d);
      return { h: Math.round(d.getBoundingClientRect().height), radius: cs.borderTopLeftRadius, isField: d.classList.contains('mw-field'), type: d.type };
    })()`);
    check('date input: box converged, still a real native date control', dateCtl.isField === true && dateCtl.type === 'date' && (dateCtl.radius === '12px' || dateCtl.radius === '10px'), JSON.stringify(dateCtl));

    // ---------------------------------------------------------------- PART 6: leave-alone list
    console.log('\nPART 6 — what was deliberately NOT touched is provably untouched\n');
    await goto(cdp, BASE + '/risk-management.html', clientBootstrap);
    const rm = await cdp.evaluate(`(() => {
      const segs = [...document.querySelectorAll('.rm-segment')];
      return { count: segs.length, anyMw: segs.some((s) => s.className.includes('mw-btn')) };
    })()`);
    check('Risk Meter segmented control (locked palette) untouched', rm.count > 0 && rm.anyMw === false, JSON.stringify(rm));

    await goto(cdp, BASE + '/deploy-capital.html', clientBootstrap);
    const cards = await cdp.evaluate(`(() => {
      const c = [...document.querySelectorAll('.option-card')];
      return { count: c.length, anyMw: c.some((x) => x.className.includes('mw-btn')) };
    })()`);
    check('Deploy Capital selection cards untouched (choice surfaces, not buttons)', cards.count > 0 && cards.anyMw === false, JSON.stringify(cards));

    await goto(cdp, BASE + '/documents.html', clientBootstrap);
    const hold = await cdp.evaluate(`(() => {
      const b = document.getElementById('remove-confirm-submit');
      if (!b) return { err: 'press-and-hold button not found' };
      const cs = getComputedStyle(b);
      return { isMw: b.className.includes('mw-btn'), relative: cs.position === 'relative', clips: cs.overflow === 'hidden' };
    })()`);
    check('press-and-hold Remove (row 166) left alone — its progress overlay still has its containing block',
      hold.isMw === false && hold.relative === true && hold.clips === true, JSON.stringify(hold));

    // ---------------------------------------------------------------- PART 7: public site
    console.log('\nPART 7 — public site: radius converged, hero sweep added\n');
    await goto(cdp, BASE + '/index.html', null);
    const pub = await cdp.evaluate(`(() => {
      const btn = document.querySelector('.btn');
      const hero = document.querySelector('.hero-btn-primary');
      const r = {};
      if (btn) r.btnRadius = getComputedStyle(btn).borderTopLeftRadius;
      if (hero) {
        const b = getComputedStyle(hero, '::before');
        r.heroSweep = b.content !== 'none' && parseFloat(b.width) > 0;
        r.heroSweepWidth = b.width;
        r.heroRadius = getComputedStyle(hero).borderTopLeftRadius;
        r.heroClips = getComputedStyle(hero).overflow === 'hidden';
        r.heroLabelVisible = hero.textContent.trim().length > 0;
      }
      return r;
    })()`);
    check('public .btn radius converged to 12px', pub.btnRadius === '12px', JSON.stringify(pub));
    check('hero primary now carries the light sweep', pub.heroSweep === true, 'width=' + pub.heroSweepWidth);
    check('hero primary clips it and its label is still visible above it', pub.heroClips === true && pub.heroLabelVisible === true, JSON.stringify(pub));

    await goto(cdp, BASE + '/contact.html', null);
    const contact = await cdp.evaluate(`(() => {
      const i = document.querySelector('.form-group input');
      const t = document.querySelector('.custom-select-trigger');
      const out = {};
      if (i) out.inputRadius = getComputedStyle(i).borderTopLeftRadius;
      if (t) { out.triggerRadius = getComputedStyle(t).borderTopLeftRadius; t.click(); out.opens = t.closest('.custom-select').classList.contains('is-open'); }
      return out;
    })()`);
    check('contact form controls converged to 12px radius', contact.inputRadius === '12px' && contact.triggerRadius === '12px', JSON.stringify(contact));
    check('contact custom select still opens after the radius change', contact.opens === true, JSON.stringify(contact));

    // ---------------------------------------------------------------- screenshots
    if (SHOT_DIR) {
      console.log('\nCapturing before/after reference screenshots\n');
      for (const w of [1440, 390]) {
        await setViewport(cdp, w);
        for (const page of ['documents.html', 'settings.html', 'high-yield-savings.html', 'deploy-capital.html']) {
          await goto(cdp, BASE + '/' + page, clientBootstrap);
          await shot(cdp, 'after-' + page.replace('.html', '') + '-' + w);
        }
        for (const page of ['admin-deposits.html', 'admin-products.html']) {
          await goto(cdp, BASE + '/' + page, adminBootstrap);
          await shot(cdp, 'after-' + page.replace('.html', '') + '-' + w);
        }
      }
      console.log('  screenshots -> ' + SHOT_DIR);
    }

  } finally {
    if (cdp) cdp.close();
    if (clientId) {
      await admin.from('documents').delete().eq('client_id', clientId);
      await admin.from('holdings').delete().eq('client_id', clientId);
      await admin.from('account_state').delete().eq('client_id', clientId);
      await admin.from('clients').delete().eq('id', clientId);
      const { error } = await admin.auth.admin.deleteUser(clientId);
      if (error) console.error('CLEANUP: ' + error.message);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('CONTROL PATTERNS: PASS');
}

runVerifyMain(main, { watchdogMs: 1500000 });
