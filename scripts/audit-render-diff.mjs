// audit-render-diff.mjs — a rendered BEFORE/AFTER comparison of every logged-in page, on identical
// data, pixel-diffed. Built for app-feel stage 1.5 fix 2 (2026-09-21, row 260), where the real risk
// was visual regression; stages 2 and 3 carry the same risk and should use it the same way.
//
// METHOD. Two origins serve two versions of the static site against the SAME local stack and the
// SAME sessions (the fixture client, the local bootstrap PM): RD_BEFORE (default
// http://127.0.0.1:8766 — a `git worktree add <tmp> <commit>` served with `python -m http.server
// 8766`) and RD_AFTER (default http://127.0.0.1:8765, the working tree). Every page is loaded in
// both, settled (no visible skeleton), the legitimately-different things frozen (the live clock,
// "Updated ... ago", spinners, animations), screenshotted at 1440 and 390, and pixel-diffed
// (pixelmatch, threshold 0.1). Before/after/diff PNGs and results.json land in %TEMP%/mw-visual-diff.
//
// READ IT WITH THE DIFF IMAGES, NOT THE PERCENTAGE ALONE: on fix 2, the only pixels that differed
// on dashboard.html (0.54%) were inside the Chart.js canvas — the chart's own animation frame at
// capture time — and every Tailwind-styled element around it was identical. A chart canvas, a
// relative timestamp and a live price are expected to differ; a shifted card, a lost style or a
// wrapped label are not. The screenshot is the first viewport only: the app's <main> scrolls
// internally, so a document-height capture is one screen — combine with the CSS-rule
// equivalence check (row 260) for what lies below the fold.
//
// Usage (from scripts/, both servers and the local stack up):  npm run audit-render-diff
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { FIXTURE_CLIENT, fixtureClientPassword, findFixtureClient } from './lib/fixture-client.mjs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = JSON.parse((() => { const raw = execSync('supabase status -o json', { cwd: '..', encoding: 'utf8' }); return raw.slice(raw.indexOf('{')); })());
const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const gary = await findFixtureClient(admin, '*');
const { data: gs, error: ge } = await anon.auth.signInWithPassword({ email: gary.email, password: fixtureClientPassword() }); if (ge) throw ge;
const { data: ps, error: pe } = await anon.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' }); if (pe) throw pe;
const BEFORE = process.env.RD_BEFORE || 'http://127.0.0.1:8766', AFTER = process.env.RD_AFTER || 'http://127.0.0.1:8765';
const OUT = process.env.TEMP + '/mw-visual-diff'; mkdirSync(OUT, { recursive: true });

async function browser(port) {
  const profile = process.env.TEMP + '/mw-vdiff-' + port;
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let ws = null; for (let i = 0; i < 60 && !ws; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch (e) {} if (!ws) await sleep(250); }
  const s = new WebSocket(ws); await new Promise((r) => s.addEventListener('open', r)); let id = 0; const pend = new Map();
  s.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  return { send, ev, kill: () => chrome.kill() };
}
const boot = (role, origin) => {
  const key = 'sb-127-auth-token';   // the SDK's default key for http://127.0.0.1:54321
  const sess = role === 'client' ? gs.session : ps.session;
  return `try{ localStorage.setItem(${JSON.stringify(role === 'client' ? key : 'sb-marketswave-admin-auth-token')}, ${JSON.stringify(JSON.stringify(sess))}); ${role === 'client' ? `sessionStorage.setItem('marketswave_authenticated_client_id', ${JSON.stringify(gary.id)}); sessionStorage.setItem('marketswave_current_client_id', ${JSON.stringify(gary.id)}); localStorage.setItem('mw_presence_local','0');` : ''} }catch(e){}`;
};
// Freeze the things that legitimately differ between two loads: the live clock, "Updated just now", presence dots, spinners.
const FREEZE = `(() => { const s = document.createElement('style'); s.textContent = '#live-clock, [data-live-clock], .an-dot, .animate-spin, .animate-pulse { visibility: hidden !important; } * { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }'; document.head.appendChild(s); for (const el of document.querySelectorAll('*')) { if (el.children.length === 0 && /^(Updated|Last updated|Refreshed)\\b/.test(el.textContent || '')) el.textContent = 'Updated'; if (el.children.length === 0 && /^\\d{1,2}:\\d{2}(:\\d{2})?\\s*(AM|PM)?$/.test((el.textContent||'').trim())) el.textContent = '00:00'; } return true; })()`;
const CLIENT = ['dashboard.html', 'asset-performance.html', 'asset-collection.html', 'transactions.html', 'high-yield-savings.html', 'documents.html', 'risk-management.html', 'deploy-capital.html', 'settings.html', 'support.html', 'fund-document.html?product=PROD-0002'];
const ADMIN = ['admin.html', 'admin-approvals.html', 'admin-inbox.html', 'admin-clients.html', 'admin-client-profile.html?client=' + gary.id, 'admin-presence.html', 'admin-products.html', 'admin-fund-document.html?product=PROD-0002', 'admin-deposit-addresses.html', 'admin-documents.html', 'admin-advisory-fee.html', 'admin-security.html', 'admin-login.html'];
const results = [];
async function shoot(b, url, width) {
  await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
  await b.send('Page.navigate', { url }); await sleep(9000);
  for (let i = 0; i < 40; i++) { const n = await b.ev('[...document.querySelectorAll(".animate-pulse")].filter(e=>e.getClientRects().length).length'); if (!n) break; await sleep(500); }
  await b.ev(FREEZE); await sleep(400);
  const h = Math.min(await b.ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)'), 6000);
  await b.send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile: width < 500 }); await sleep(500);
  const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  return PNG.sync.read(Buffer.from(r.data, 'base64'));
}
const pairs = [];
try {
  for (const [role, pages] of [['client', CLIENT], ['admin', ADMIN]]) {
    const B = await browser(9611), A = await browser(9612);
    for (const [b, origin] of [[B, BEFORE], [A, AFTER]]) { await b.send('Page.addScriptToEvaluateOnNewDocument', { source: boot(role, origin) }); await b.send('Page.navigate', { url: origin + '/' + (role === 'client' ? 'dashboard.html' : 'admin.html') }); await sleep(4000); }
    if (role === 'client') for (const b of [B, A]) { for (let i = 0; i < 60 && !(await b.ev('typeof mirrorAuthenticatedClientLocally === "function"')); i++) await sleep(250); await b.ev('mirrorAuthenticatedClientLocally(' + JSON.stringify({ id: gary.id, name: gary.name, email: gary.email, phone: gary.phone, accountType: gary.account_type, status: gary.status, createdAt: null, applicationResolvedAt: null, applicationReason: null }) + '); setClientAuthenticated(' + JSON.stringify(gary.id) + '); true'); }
    for (const p of pages) for (const w of [1440, 390]) {
      const before = await shoot(B, BEFORE + '/' + p, w), after = await shoot(A, AFTER + '/' + p, w);
      const W = Math.min(before.width, after.width), H = Math.min(before.height, after.height);
      const crop = (img) => { const o = new PNG({ width: W, height: H }); PNG.bitblt(img, o, 0, 0, W, H, 0, 0); return o; };
      const b1 = crop(before), a1 = crop(after); const diff = new PNG({ width: W, height: H });
      const n = pixelmatch(b1.data, a1.data, diff.data, W, H, { threshold: 0.1, includeAA: true });
      const pct = (100 * n / (W * H));
      const name = p.replace(/[?=&/]/g, '_') + '-' + w;
      writeFileSync(OUT + '/' + name + '-before.png', PNG.sync.write(b1)); writeFileSync(OUT + '/' + name + '-after.png', PNG.sync.write(a1)); writeFileSync(OUT + '/' + name + '-diff.png', PNG.sync.write(diff));
      results.push({ page: p, w, W, H, hBefore: before.height, hAfter: after.height, pixels: n, pct: +pct.toFixed(3) });
      console.log(p.slice(0, 44).padEnd(46) + String(w).padStart(5) + '  ' + before.width + 'x' + before.height + ' → ' + after.width + 'x' + after.height + '  differing px ' + String(n).padStart(8) + '  ' + pct.toFixed(3) + '%');
    }
    B.kill(); A.kill(); await sleep(500);
  }
} finally { writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 1)); }
console.log('written ' + OUT); process.exit(0);
