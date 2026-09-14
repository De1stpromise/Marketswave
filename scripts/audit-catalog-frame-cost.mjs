// Catalog frame cost — how expensive is the rendered asset-collection.html page, per frame,
// as the card count grows, and how much of that is backdrop-filter? (2026-09-14, the catalog
// expansion to ~250 products.)
//
// This is an INVESTIGATION tool, not a pass/fail suite: it prints numbers and exits 0. It
// exists because "do not render all 250 glass cards at once" is a claim about a cost that
// had never been measured on this page, and the right page size follows from the measured
// cost, not from a guess.
//
// METHOD. A real signed-in client loads the real page; once the real cards have rendered,
// the grid is filled to N cards by cloning the REAL rendered card nodes (same markup, same
// stylesheet, same images), so the cost measured is the cost of this page's own card, not a
// stand-in. Then the page is scrolled top to bottom by a fixed number of steps inside a
// requestAnimationFrame loop while every frame's duration is recorded from rAF timestamps
// — that is what a client actually experiences while browsing 250 rows. Reported per N:
// the mean and p95 frame time and the count of frames over 16.7ms (a dropped 60Hz frame).
//
// Three variants per N, so the suspect is isolated rather than assumed:
//   as-is      — the page exactly as shipped
//   no-blur    — every backdrop-filter on the page disabled (a `* { backdrop-filter:none }`
//                injection) — the difference is the whole cost of the blur layer(s)
//   card-blur  — a 22px backdrop-filter put ON EVERY CARD (the mockup's `.glass` recipe
//                applied per card) — what 250 genuinely-glass cards would cost
//
// CAVEATS, stated so the numbers are read correctly: headless Chrome on this machine with
// software or GPU compositing as the driver decides; absolute figures are this machine's,
// the RATIOS between variants and the growth with N are the transferable finding. Card
// images are real storage logos already cached by the first render, so N clones do not add
// network cost.
//
// Usage (from scripts/, with the local stack, functions serve and http.server 8765 up):
//   node audit-catalog-frame-cost.mjs               # N = 24, 48, 96, 247
//   FC_COUNTS=24,247 node audit-catalog-frame-cost.mjs
import { execSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTempDir, trackChild, releaseTempDir } from './lib/harness-teardown.mjs';

const BASE = process.env.FC_BASE || 'http://127.0.0.1:8765';
const PORT = Number(process.env.FC_PORT || 9511);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PASSWORD = 'AuditFrameCost-2026!';
const COUNTS = (process.env.FC_COUNTS || '24,48,96,247').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

async function connectChrome() {
  const profile = makeTempDir('mw-framecost-');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250); }
    catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '')); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { send, evaluate, close: () => releaseTempDir(profile) };
}

// Browser-side: fill the grid to N by cloning the real first card(s), then scroll the page
// in STEPS rAF-paced steps from top to bottom, recording each frame's duration.
const FILL_JS = (n) => '(() => { const g = document.getElementById("asset-cards-grid"); const cards = [...g.children]; if (!cards.length) return 0; let i = 0; while (g.children.length < ' + n + ') { g.appendChild(cards[i % cards.length].cloneNode(true)); i++; } while (g.children.length > ' + n + ') g.lastChild.remove(); return g.children.length; })()';
const MEASURE_JS = (FLOOR) => '(() => new Promise((resolve) => { const FLOOR = ' + FLOOR + '; const main = document.querySelector("main"); const el = (main && main.scrollHeight > main.clientHeight) ? main : document.scrollingElement; const total = el.scrollHeight - el.clientHeight; const STEPS = 90; const frames = []; let last = null, i = 0; el.scrollTop = 0; function tick(ts) { if (last !== null) frames.push(ts - last); last = ts; i++; el.scrollTop = Math.round(total * Math.min(1, i / STEPS)); if (i <= STEPS + 5) requestAnimationFrame(tick); else { frames.sort((a, b) => a - b); const mean = frames.reduce((a, b) => a + b, 0) / frames.length; resolve({ frames: frames.length, mean: +mean.toFixed(2), p95: +frames[Math.floor(frames.length * 0.95)].toFixed(2), max: +frames[frames.length - 1].toFixed(2), over16: frames.filter((f) => f > FLOOR * 1.25).length, scrollable: total }); } } requestAnimationFrame(tick); }))()';
const STYLE_JS = (css) => '(() => { let s = document.getElementById("__fc"); if (!s) { s = document.createElement("style"); s.id = "__fc"; document.head.appendChild(s); } s.textContent = ' + JSON.stringify(css) + '; return true; })()';

async function main() {
  console.log('Catalog frame cost — asset-collection.html, real card markup, real scroll\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'framecost-' + suffix + '@test.marketswave.local';
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (cErr) throw new Error('createUser: ' + cErr.message);
  const clientId = created.user.id;
  let cdp = null;
  try {
    await admin.from('clients').insert({ id: clientId, name: 'Frame Cost Probe', email: 'framecost-' + clientId, phone: '+1 555 0100', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 0 });
    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error('signIn: ' + sErr.message);
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const bootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');' +
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');' +
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + '); localStorage.setItem("mw_presence_local", "0"); true';

    cdp = await connectChrome();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: BASE + '/' }); await sleep(800);
    await cdp.evaluate(bootstrap);
    await cdp.send('Page.navigate', { url: BASE + '/asset-collection.html' });
    // Wait for real cards, and let the real logo images decode so N clones share a warm cache.
    let real = 0;
    for (let i = 0; i < 160 && !real; i++) { await sleep(250); real = await cdp.evaluate('document.querySelectorAll("#asset-cards-grid > [data-product-id]").length'); }
    if (!real) throw new Error('the catalog never rendered a card — ' + await cdp.evaluate('JSON.stringify({ href: location.href, grid: (document.getElementById("asset-cards-grid")||{}).innerHTML ? document.getElementById("asset-cards-grid").innerHTML.slice(0,300) : null })'));
    await cdp.evaluate('(async () => { const imgs = [...document.images]; await Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))); return true; })()');
    await sleep(500);
    const glassCount = await cdp.evaluate('[...document.querySelectorAll("*")].filter(e => getComputedStyle(e).backdropFilter !== "none").length');
    console.log('page as shipped: ' + real + ' real cards rendered; elements carrying a backdrop-filter: ' + glassCount + '\n');

    // The rAF cadence floor for THIS browser: an idle loop with no scrolling. Headless Chrome
    // paces rAF at 50Hz on this machine (20ms), so a dropped frame is > ~1.25 x the floor, not
    // > 16.7ms — every figure below is read against this measured floor.
    const floor = await cdp.evaluate('(() => new Promise((resolve) => { const f = []; let last = null, i = 0; function t(ts) { if (last !== null) f.push(ts - last); last = ts; if (++i < 40) requestAnimationFrame(t); else { f.sort((a,b)=>a-b); resolve(+f[Math.floor(f.length/2)].toFixed(2)); } } requestAnimationFrame(t); }))()');
    console.log('rAF floor (idle, no scroll): ' + floor + ' ms per frame — a frame above ' + (floor * 1.25).toFixed(1) + ' ms is a dropped frame here');
    console.log('');
    const variants = [
      ['as-is', ''],
      ['no-blur', '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }'],
      ['card-blur', '#asset-cards-grid > * { backdrop-filter: blur(22px) !important; -webkit-backdrop-filter: blur(22px) !important; background: linear-gradient(150deg,rgba(255,255,255,.72),rgba(255,255,255,.36)) !important; }']
    ];
    console.log('N cards   variant     mean ms   p95 ms   max ms   dropped / frames');
    for (const n of COUNTS) {
      const got = await cdp.evaluate(FILL_JS(n));
      for (const [name, css] of variants) {
        await cdp.evaluate(STYLE_JS(css));
        await sleep(250);
        // Two passes; the second is reported (the first warms layers/raster caches).
        await cdp.evaluate(MEASURE_JS(floor));
        const m = await cdp.evaluate(MEASURE_JS(floor));
        console.log(String(got).padEnd(9) + name.padEnd(11) + String(m.mean).padStart(8) + String(m.p95).padStart(9) + String(m.max).padStart(9) + '   ' + String(m.over16).padStart(4) + ' / ' + m.frames);
      }
      await cdp.evaluate(STYLE_JS(''));
    }
  } finally {
    if (cdp) await cdp.close();
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    const { error } = await admin.auth.admin.deleteUser(clientId);
    if (error) console.error('CLEANUP: ' + error.message);
  }
  process.exit(0);
}
main().catch((err) => { console.error('AUDIT FAILED: ' + (err && err.stack || err)); process.exit(1); });
