#!/usr/bin/env node
// Renamed from audit-glass-sheen.mjs on 2026-09-21 (row 262): it exits non-zero on a failing surface, so it
// is a verification, and verify- is the prefix that runs in a pass; audit- is for investigations that do not.
// ★ .glass sheen contrast sweep (2026-09-12).
//
// `.glass::before` paints a radial white highlight (up to 0.8 alpha) over the top-left of
// every full-recipe glass card, and because it is POSITIONED it composites OVER the card's
// in-flow content. The portfolio overview found the consequence by measurement: navy text in
// that corner read 4.02:1 with the sheen and 11.48:1 without it. One shared surface, many
// pages — the same shape as row 151's 83 slate-500 failures — so this sweeps EVERY `.glass`
// element on every page rather than inferring from one card.
//
// Method: for each page, every `.glass` element is enumerated at runtime (so cards built by
// JS count too); for each, the sheen's own box is read from getComputedStyle(el, '::before')
// and every element carrying direct text whose glyph rect intersects that box is measured on
// real composited pixels — the darkest/lightest glyph pixel against the background median
// with the glyphs hidden, the technique verify-contrast.mjs established — first as rendered,
// then again with `.glass::before { display:none }` injected. The DELTA is the finding; a
// ratio under 4.5:1 WITH the sheen is a failure.
//
// Output: one line per measured element (page, card, element, with, without, delta, verdict)
// and a per-page summary; the full inventory is printed even where everything passes, so
// there is a record of what was measured rather than assumed.
//
// Requires: the local stack, `supabase functions serve`, and a static server on :8765.
// A temp client with content on every domain and the local PM session are seeded so that
// every card has real text; both are removed afterwards.
import { execSync, spawn } from 'node:child_process';
import { makeTempDir, trackChild, releaseTempDir } from './lib/harness-teardown.mjs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SHEEN_BASE || 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.SHEEN_PORT || 9447);
const WIDTH = Number(process.env.SHEEN_WIDTH || 1440);
const ONLY = process.env.SHEEN_PAGES ? process.env.SHEEN_PAGES.split(',') : null;
const PASSWORD = 'VerifySheen-2026!';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

const pixelsShifted = (a, b) => a.reduce((acc, v, i) => acc + Math.abs(v - b[i]), 0) / 2;
const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const p = [lum(a), lum(b)].sort((x, y) => y - x); return (p[0] + 0.05) / (p[1] + 0.05); };

// Browser-side helpers, installed once per page.
const HELPERS = `
window.__sheen = (() => {
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05; };
  const textRect = (el) => {
    let r = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const b of rg.getClientRects()) {
        if (b.width < 1 || b.height < 1) continue;
        r = r ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      }
    }
    return r;
  };
  const label = (el) => {
    const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').replace(/\\s+/g, ' ').slice(0, 28);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + t + '"';
  };
  const cardLabel = (c) => c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + '.' + (c.className || '').trim().split(/\\s+/).filter(x => x !== 'glass').slice(0, 2).join('.');
  function inventory() {
    const out = [];
    const cards = [...document.querySelectorAll('.glass')].filter(vis);
    cards.forEach((card, ci) => {
      const cr = card.getBoundingClientRect();
      if (cr.width < 8 || cr.height < 8) return;
      const b = getComputedStyle(card, '::before');
      const sheen = { left: cr.left + parseFloat(b.left), top: cr.top + parseFloat(b.top), width: parseFloat(b.width), height: parseFloat(b.height) };
      if (!(sheen.width > 0) || b.display === 'none' || b.content === 'none') return;
      const sr = { left: sheen.left, top: sheen.top, right: sheen.left + sheen.width, bottom: sheen.top + sheen.height };
      const els = [];
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT);
      let n = card;
      while (n) {
        if (n !== card && !n.matches('script,style,svg,canvas,path') && vis(n)) {
          // Text inside a NESTED .glass belongs to that card's own inventory.
          const owner = n.parentElement && n.parentElement.closest('.glass');
          if (owner === card) {
            const tr = textRect(n);
            if (tr && tr.left < sr.right && tr.right > sr.left && tr.top < sr.bottom && tr.bottom > sr.top) els.push(n);
          }
        }
        n = walker.nextNode();
      }
      if (!els.length) return;
      card.dataset.sheenCard = String(ci);
      els.forEach((el, ei) => { el.dataset.sheenEl = ci + '-' + ei; });
      // A lifted card sets position:relative on every direct child — a child that was
      // absolutely/fixed positioned would be re-flowed by that, so report any such child.
      const positioned = card.classList.contains('glass-lift') ? [...card.children].filter(c => /absolute|fixed|sticky/.test(getComputedStyle(c).position)).map(c => c.tagName.toLowerCase() + (c.id ? '#' + c.id : '')) : [];
      out.push({ ci, card: cardLabel(card), lifted: card.classList.contains('glass-lift'), positioned, cardBox: { w: Math.round(cr.width), h: Math.round(cr.height) }, els: els.map((el, ei) => ({ key: ci + '-' + ei, label: label(el) })) });
    });
    return out;
  }
  async function rect(key) {
    const el = document.querySelector('[data-sheen-el="' + key + '"]'); if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const tr = textRect(el); if (!tr) return null;
    return { x: tr.left, y: tr.top, w: tr.right - tr.left, h: tr.bottom - tr.top };
  }
  // The bracketing reads around each screenshot must NOT scroll: scrollIntoView re-centres the
  // element on every call, so four scrolling reads agree by construction even while the page
  // shifts underneath the screenshots taken between them (proven: SHEEN_CHAOS_SHIFT_MS=150
  // still produced 1.09:1 with four scrolling reads).
  function rectNoScroll(key) {
    const el = document.querySelector('[data-sheen-el="' + key + '"]'); if (!el) return null;
    const tr = textRect(el); if (!tr) return null;
    return { x: tr.left, y: tr.top, w: tr.right - tr.left, h: tr.bottom - tr.top };
  }
  function hideGlyphs(key) { const el = document.querySelector('[data-sheen-el="' + key + '"]'); el.dataset.saved = el.style.cssText; el.style.setProperty('color', 'transparent', 'important'); el.style.setProperty('-webkit-text-fill-color', 'transparent', 'important'); el.style.setProperty('text-shadow', 'none', 'important'); }
  function showGlyphs(key) { const el = document.querySelector('[data-sheen-el="' + key + '"]'); el.style.cssText = el.dataset.saved || ''; delete el.dataset.saved; }
  function sheen(on) { let st = document.getElementById('__sheen-off'); if (on) { if (st) st.remove(); } else if (!st) { st = document.createElement('style'); st.id = '__sheen-off'; st.textContent = '.glass::before{display:none !important}'; document.head.appendChild(st); } }
  const sample = (dataUri, r) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
      const w = Math.max(1, Math.min(Math.ceil(r.w), img.width - x)), h = Math.max(1, Math.min(Math.ceil(r.h), img.height - y));
      const d = g.getImageData(x, y, w, h).data; const px = [];
      for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
      const L = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      px.sort((a, b) => L(a) - L(b));
      const hist = new Array(16).fill(0); px.forEach((p) => { hist[Math.min(15, Math.floor(L(p) / 16))]++; });
      resolve({ darkest: px[0], lightest: px[px.length - 1], median: px[Math.floor(px.length / 2)], n: px.length, hist });
    };
    img.src = dataUri;
  });
  return { inventory, rect, rectNoScroll, hideGlyphs, showGlyphs, sheen, sample };
})();`;

async function connectChrome() {
  const profile = makeTempDir('mw-sheen-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + ((r.exceptionDetails.exception || {}).description || '')); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
  trackChild(profile, chrome, ws);
  return { send, evaluate, close: () => releaseTempDir(profile) };
}

// Wait for a page's async data: no Tailwind skeleton left anywhere and no `.glass` card that is
// still empty of text. Bounded — a page with no async content settles on the first check.
const WAIT = '(async()=>{const nap=(ms)=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<120;i++){const sk=document.querySelectorAll(".animate-pulse").length;if(sk===0&&document.readyState==="complete"){await nap(600);return true;}await nap(250);}return false;})()';

const PUBLIC_PAGES = ['index.html', 'services.html', 'resources.html', 'about.html', 'contact.html', 'legal.html', 'help.html', 'blog-press.html', 'signup.html', 'login.html', 'thank-you.html', 'reset-password.html'];
const CLIENT_PAGES = ['dashboard.html', 'asset-performance.html', 'asset-collection.html', 'high-yield-savings.html', 'transactions.html', 'documents.html', 'risk-management.html', 'deploy-capital.html', 'settings.html', 'support.html'];
// The seven per-type queue pages were deleted when the approval gate replaced them (row 228).
const ADMIN_PAGES = ['admin.html', 'admin-approvals.html', 'admin-clients.html', 'admin-documents.html', 'admin-advisory-fee.html', 'admin-security.html', 'admin-products.html', 'admin-deposit-addresses.html', 'admin-inbox.html', 'admin-presence.html'];
const NOAUTH_PAGES = ['admin-login.html'];

async function main() {
  console.log('.glass sheen contrast sweep — ' + WIDTH + 'px, real composited pixels, sheen ON vs OFF\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(3).toString('hex');
  const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';

  // ---- seed a client with content on every domain, so every card carries real text
  const email = 'sheen-' + suffix + '@test.marketswave.local';
  const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (cuErr) throw new Error(cuErr.message);
  const clientId = cu.user.id;
  const ids = { pockets: [], addr: null };
  const day = 86400000, now = Date.now();
  try {
    await admin.from('clients').insert({ id: clientId, name: 'Sheen Sweep', email: 'sheen-' + clientId, phone: '+1 555 0100', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 48000, allocated_capital: 0, asset_returns: 1250 });
    const { data: prod } = await admin.from('products').select('id,unit_price').eq('id', 'PROD-0003').single();
    await admin.from('holdings').insert({ client_id: clientId, product_id: prod.id, units: 100, cost_basis: 9000 });
    await admin.from('transactions').insert([
      { client_id: clientId, product_id: prod.id, type: 'BUY', units: 100, price: 90, total_value: 9000, status: 'completed', created_at: new Date(now - 40 * day).toISOString() },
      { client_id: clientId, product_id: null, type: 'DEPOSIT', units: null, price: null, total_value: 57000, status: 'completed', created_at: new Date(now - 45 * day).toISOString() }
    ]);
    await admin.from('deposit_requests').insert({ client_id: clientId, method: 'bank', requested_amount: 2000, currency: 'USD', details: { bank: 'Test Bank' }, status: 'pending' });
    await admin.from('withdrawal_requests').insert({ client_id: clientId, method: 'bank', requested_amount: 500, currency: 'USD', destination_details: { bank: 'Test Bank' }, status: 'pending' });
    await admin.from('allocation_requests').insert({ client_id: clientId, product_id: prod.id, dollar_amount: 1500, status: 'pending' });
    await admin.from('sell_requests').insert({ client_id: clientId, product_id: prod.id, units_to_sell: 10, status: 'pending' });
    await admin.from('hys_deposit_requests').insert({ client_id: clientId, pocket_type: 'ayw', requested_amount: 3000, method: 'bank', currency: 'USD', details: {}, status: 'pending', term_in_years: 0 });
    const { data: pk } = await admin.from('hys_pockets').insert([
      { client_id: clientId, pocket_type: 'fixed', amount: 12000, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5, maturity_date: new Date(now + 90 * day).toISOString(), projected_interest: 510, funding_method: 'bank account', created_at: new Date(now - 90 * day).toISOString() },
      { client_id: clientId, pocket_type: 'ayw', amount: 4000, status: 'active', funding_method: 'bank account', projected_interest: 0, created_at: new Date(now - 10 * day).toISOString() }
    ]).select('id');
    ids.pockets = pk.map((p) => p.id);
    await admin.from('hys_withdrawal_requests').insert({ client_id: clientId, pocket_id: ids.pockets[1], method: 'bank', destination_details: { bank: 'Test Bank' }, receive_amount: 4000, forfeit: false, status: 'pending' });
    await admin.from('profile_change_requests').insert({ client_id: clientId, field: 'address', current_value: null, requested_value: { street: '1 Test St', city: 'Testville', state: 'TS', postalCode: '00000', country: 'US' }, reason: 'Moved', status: 'pending' });
    await admin.from('documents').insert([
      { client_id: clientId, filename: 'Q3 Statement.pdf', category: 'Statements & Reports', direction: 'from', date: new Date().toISOString().slice(0, 10), status: 'Signature Required', is_new: true, deadline_label: 'Due in 7 days' },
      { client_id: clientId, filename: 'Proof of address.pdf', category: 'General', direction: 'upload', date: new Date().toISOString().slice(0, 10), status: 'Received', is_new: false, storage_path: null }
    ]);
    await admin.from('support_requests').insert({ client_id: clientId, display_id: 'TCK-0001', kind: 'ticket', category: 'Other', subject: 'Sheen sweep ticket', description: 'A real ticket so the list has a row.', status: 'Open' }).then(({ error }) => { if (error) console.log('  (support_requests seed skipped: ' + error.message + ')'); });

    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error(sErr.message);
    const clientBootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ',' + JSON.stringify(JSON.stringify(signed.session)) + ');sessionStorage.setItem("marketswave_authenticated_client_id",' + JSON.stringify(clientId) + ');sessionStorage.setItem("marketswave_current_client_id",' + JSON.stringify(clientId) + ');true';
    const { data: pm, error: pmErr } = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
    if (pmErr) throw new Error(pmErr.message);
    const adminBootstrap = 'localStorage.setItem("sb-marketswave-admin-auth-token",' + JSON.stringify(JSON.stringify(pm.session)) + ');true';

    const pages = [
      ...PUBLIC_PAGES.map((p) => ({ page: p, boot: null })),
      ...CLIENT_PAGES.map((p) => ({ page: p, boot: clientBootstrap })),
      ...ADMIN_PAGES.map((p) => ({ page: p, boot: adminBootstrap })),
      ...NOAUTH_PAGES.map((p) => ({ page: p, boot: null }))
    ].filter((p) => !ONLY || ONLY.includes(p.page));

    const cdp = await connectChrome();
    const results = [];
    try {
      const shot = async () => 'data:image/png;base64,' + (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
      // ★ NON-VACUITY (2026-09-13). A full-suite run once reported the dashboard near 1.4:1
      // both WITH and WITHOUT the sheen — identical readings, the signature of a box that held
      // no glyphs at all (row 190's assertDistinct lesson), not of a contrast failure. The
      // mechanism: the page was still laying out (a skeleton that never resolved kept the
      // settle wait from ever passing), the element's rect was read, async content then
      // pushed it, and both screenshots sampled empty background. Two guards, so the probe
      // can never hand back a confident wrong number: (1) the box is re-read around EACH
      // screenshot and must not have moved; (2) hiding the glyphs must CHANGE the sampled
      // pixels — if it does not, the box contained no glyphs. Either failure retries (the
      // page may settle), and a measurement that still cannot be made is reported as
      // UNMEASURED, a verdict of its own that fails the sweep, never as a ratio.
      async function measure(key) {
        let lastReason = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await sleep(700);
          // ★ EACH screenshot is bracketed by its own rect read. A before/after pair around BOTH
          // screenshots is not enough: a page toggling layout faster than one measurement
          // (~300ms) can be at the same position for both reads and elsewhere for a screenshot
          // in between — proven with SHEEN_CHAOS_SHIFT_MS=150, which handed back a confident
          // 1.09:1 for an element that measures 5.86:1. Four reads leave a window no wider than
          // one screenshot's own latency.
          const rd = () => cdp.evaluate('window.__sheen.rectNoScroll(' + JSON.stringify(key) + ')');
          const r = await cdp.evaluate('window.__sheen.rect(' + JSON.stringify(key) + ')');
          if (!r) return null;
          const s1 = await shot(); const r1 = await rd();
          const fg = await cdp.evaluate('window.__sheen.sample(' + JSON.stringify(s1) + ',' + JSON.stringify(r) + ')');
          await cdp.evaluate('window.__sheen.hideGlyphs(' + JSON.stringify(key) + ')');
          await sleep(80);
          const r2a = await rd(); const s2 = await shot(); const r2 = await rd();
          const bg = await cdp.evaluate('window.__sheen.sample(' + JSON.stringify(s2) + ',' + JSON.stringify(r) + ')');
          await cdp.evaluate('window.__sheen.showGlyphs(' + JSON.stringify(key) + ')');
          const differs = (q) => !q || Math.abs(q.x - r.x) > 1 || Math.abs(q.y - r.y) > 1 || Math.abs(q.w - r.w) > 1 || Math.abs(q.h - r.h) > 1;
          const moved = [r1, r2a, r2].some(differs);
          // "Changed" is a pixel-DISTRIBUTION test (pixels that moved between luminance bins),
          // not an extremes test — see verify-contrast.mjs for the two real elements an
          // extremes-only check wrongly calls vacuous.
          const shifted = pixelsShifted(fg.hist, bg.hist);
          const changed = shifted >= Math.max(6, fg.n * 0.005);
          if (moved) { lastReason = 'box moved during measurement (' + Math.round(r.x) + ',' + Math.round(r.y) + ' → ' + (r2 ? Math.round(r2.x) + ',' + Math.round(r2.y) : 'gone') + ')'; continue; }
          if (!changed) { lastReason = 'hiding the glyphs changed nothing in the box (' + shifted + ' of ' + fg.n + ' pixels moved) — no glyphs were sampled'; continue; }
          const bgc = bg.median;
          const dDark = Math.abs(lum(fg.darkest) - lum(bgc)), dLight = Math.abs(lum(fg.lightest) - lum(bgc));
          const fgc = dLight > dDark ? fg.lightest : fg.darkest;
          return { ratio: Math.round(ratio(fgc, bgc) * 100) / 100, fg: fgc, bg: bgc, attempts: attempt + 1 };
        }
        return { unmeasured: lastReason };
      }
      // Warm-up load: the first Edge Function invocations compile on first call.
      await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(500);
      await cdp.evaluate(clientBootstrap);
      await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' }); await cdp.evaluate(WAIT);

      for (const { page, boot } of pages) {
        await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(400);
        await cdp.evaluate('localStorage.clear(); sessionStorage.clear(); true');
        if (boot) await cdp.evaluate(boot);
        await cdp.send('Page.navigate', { url: BASE + '/' + page });
        const settled = await cdp.evaluate(WAIT);
        const where = await cdp.evaluate('location.pathname');
        if (!where.endsWith('/' + page)) { console.log('== ' + page + ': redirected to ' + where + ' — skipped'); continue; }
        await cdp.evaluate(HELPERS);
        // SHEEN_CHAOS_SHIFT_MS=<n>: a VERIFICATION-ONLY hook reproducing the page that never
        // settles (the full-suite run's own failure mode): <n> ms after settling a 300px block
        // is inserted at the top of the page, and from then on it toggles between 300px and 0
        // every <n> ms, so every retry also lands on a moving layout. The guard above must
        // report UNMEASURED for every element measured after the first shift, never a number.
        // A ONE-OFF shift is a different case, covered by the retry: it prints "(retried)" on
        // the line it recovered. Not for normal runs.
        if (process.env.SHEEN_CHAOS_SHIFT_MS) await cdp.evaluate('setTimeout(() => { const d = document.createElement("div"); d.style.height = "300px"; d.id = "__chaos"; (document.querySelector("main") || document.body).prepend(d); setInterval(() => { d.style.height = d.style.height === "0px" ? "300px" : "0px"; }, ' + Number(process.env.SHEEN_CHAOS_SHIFT_MS) + '); }, ' + Number(process.env.SHEEN_CHAOS_SHIFT_MS) + '); true');
        // SHEEN_CHAOS_BLANK=1: the other VERIFICATION-ONLY hook — every text under a sheen is
        // made transparent BEFORE measuring, the page whose glyphs never painted (a skeleton that
        // never resolved). Both passes then sample the same pixels and the distribution guard
        // must report every element UNMEASURED with 0 pixels moved, never a number.
        if (process.env.SHEEN_CHAOS_BLANK) await cdp.evaluate('document.head.appendChild(Object.assign(document.createElement("style"), { textContent: "[data-sheen-el], [data-sheen-el] * { color: transparent !important; -webkit-text-fill-color: transparent !important; }" })); true');
        const inv = await cdp.evaluate('window.__sheen.inventory()');
        const nCards = await cdp.evaluate('document.querySelectorAll(".glass").length');
        console.log('== ' + page + ' — ' + nCards + ' .glass element(s), ' + inv.length + ' with text under the sheen' + (settled ? '' : ' (page did not fully settle)'));
        for (const card of inv) {
          if (card.positioned.length) console.log('  WARN  ' + card.card + ' is lifted but has positioned direct children (re-flowed by the lift): ' + card.positioned.join(', '));
          for (const el of card.els) {
            await cdp.evaluate('window.__sheen.sheen(true)');
            const on = await measure(el.key);
            await cdp.evaluate('window.__sheen.sheen(false)'); await sleep(60);
            const off = await measure(el.key);
            await cdp.evaluate('window.__sheen.sheen(true)');
            if (!on || !off) continue;
            if (on.unmeasured || off.unmeasured) {
              results.push({ page, card: card.card, el: el.label, on: null, off: null, delta: 0, verdict: 'UNMEASURED', reason: on.unmeasured || off.unmeasured });
              console.log('  UNMEASURED  ' + (card.lifted ? '[lifted] ' : '') + card.card + '  ›  ' + el.label + '  — ' + (on.unmeasured || off.unmeasured));
              continue;
            }
            const delta = Math.round((off.ratio - on.ratio) * 100) / 100;
            const verdict = on.ratio < 4.5 ? 'FAIL' : 'pass';
            results.push({ page, card: card.card, el: el.label, on: on.ratio, off: off.ratio, delta, verdict });
            const retried = (on.attempts > 1 || off.attempts > 1) ? '  (retried — the box moved or held no glyphs on a first attempt, then settled)' : '';
            console.log('  ' + verdict.padEnd(4) + '  with ' + String(on.ratio).padStart(6) + ':1   without ' + String(off.ratio).padStart(6) + ':1   Δ ' + String(delta).padStart(6) + '   ' + (card.lifted ? '[lifted] ' : '') + card.card + '  ›  ' + el.label + retried);
          }
        }
      }
    } finally {
      await cdp.close();
    }

    console.log('\n=== SUMMARY ===');
    const byPage = {};
    for (const r of results) { (byPage[r.page] = byPage[r.page] || { n: 0, fail: 0, maxDelta: 0, unmeasured: 0 }); if (r.verdict === 'UNMEASURED') { byPage[r.page].unmeasured++; continue; } byPage[r.page].n++; if (r.verdict === 'FAIL') byPage[r.page].fail++; byPage[r.page].maxDelta = Math.max(byPage[r.page].maxDelta, r.delta); }
    for (const [p, s] of Object.entries(byPage)) console.log('  ' + p.padEnd(32) + s.n + ' measured, ' + s.fail + ' below 4.5:1 with the sheen, largest Δ ' + s.maxDelta + (s.unmeasured ? ', ' + s.unmeasured + ' unmeasured' : ''));
    const fails = results.filter((r) => r.verdict === 'FAIL');
    const unmeasured = results.filter((r) => r.verdict === 'UNMEASURED');
    console.log('\n' + (results.length - unmeasured.length) + ' measurements under the sheen across ' + Object.keys(byPage).length + ' pages, ' + fails.length + ' below 4.5:1 with the sheen composited' + (unmeasured.length ? ', ' + unmeasured.length + ' UNMEASURED (the box held no glyphs or moved — the page never settled; not a contrast result)' : '') + '.');
    fails.forEach((r) => console.log('  FAIL  ' + r.page + '  ' + r.card + '  ›  ' + r.el + '  with ' + r.on + ':1, without ' + r.off + ':1'));
    unmeasured.forEach((r) => console.log('  UNMEASURED  ' + r.page + '  ' + r.card + '  ›  ' + r.el + '  — ' + r.reason));
    console.log(fails.length || unmeasured.length ? '\nSHEEN SWEEP: FAIL' : '\nSHEEN SWEEP: PASS');
    process.exitCode = fails.length || unmeasured.length ? 1 : 0;
  } finally {
    for (const t of ['support_requests', 'documents', 'hys_withdrawal_requests', 'profile_change_requests', 'hys_pockets', 'hys_deposit_requests', 'sell_requests', 'allocation_requests', 'withdrawal_requests', 'deposit_requests', 'watchlist_symbols', 'portfolio_value_snapshots', 'holdings', 'transactions', 'account_state', 'conversations']) {
      const { error } = await admin.from(t).delete().eq('client_id', clientId);
      if (error) console.error('CLEANUP ' + t + ': ' + error.message);
    }
    await admin.from('clients').delete().eq('id', clientId);
    const { error: dErr } = await admin.auth.admin.deleteUser(clientId);
    if (dErr) console.error('CLEANUP deleteUser: ' + dErr.message);
  }
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}

main().catch((err) => { console.error('SWEEP FAILED WITH AN ERROR: ' + (err && err.stack || err)); process.exit(1); });
