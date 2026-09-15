#!/usr/bin/env node
/**
 * verify-allocation-donut-visual.mjs — the donut AS RENDERED, in real Chrome (row 226).
 *
 *   npm run verify-allocation-donut-visual     (from scripts/)
 *
 * The data half lives in verify-allocation-donut.mjs. This half exists for the three things
 * only a real browser can answer:
 *
 *   1. THE 360-DEGREE FULL RING. A single-class client is drawn by a different code path than
 *      every other case, because one 360deg SVG arc has identical start and end points and
 *      renders NOTHING. Asserting "one path exists" would pass on that bug — so this measures
 *      the path's real rendered BBOX and checks it is a genuine ring.
 *   2. CONTRAST ON THE IN-BAND LABELS, with the .glass::before sheen composited (row 204),
 *      via the already-hardened verify-contrast.mjs (its bracketing rect reads and non-vacuity
 *      guards are row 210's work — not worth reimplementing here and getting wrong).
 *   3. MOBILE at 320/375/390, where the legend stacks and the bars drop out.
 */
import { createClient } from '@supabase/supabase-js';
import { spawn, spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, trackChild, releaseTempDir, forwardChildTeardown } from './lib/harness-teardown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9347;
const PASSWORD = 'DonutVis-2026!';
let passed = 0, failed = 0; const fails = [];
const check = (l, c, d) => { if (c) { passed++; console.log('  PASS  ' + l); } else { failed++; fails.push(l + (d ? '  [' + d + ']' : '')); console.log('  FAIL  ' + l + (d ? '  [' + d + ']' : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localCreds() {
  const raw = execSync('npx --no-install supabase status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  return { url: j.API_URL, anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY };
}

const WAIT_DONUT = '(async()=>{for(let i=0;i<240;i++){const r=document.getElementById("allocation-ring");const l=document.getElementById("allocation-legend");if(r&&l&&(r.querySelectorAll("path").length>0||/No capital deployed/.test(l.textContent)))return true;await new Promise(x=>setTimeout(x,250));}return false;})()';

async function connect(profile) {
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  trackChild(profile, chrome);
  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(300);
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); ws = (t.find((x) => x.type === 'page') || {}).webSocketDebuggerUrl; } catch {}
  }
  const sock = new WebSocket(ws);
  await new Promise((r) => sock.addEventListener('open', r));
  let id = 0; const pend = new Map();
  sock.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); sock.send(JSON.stringify({ id: i, method: m, params: p })); });
  const evaluate = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result?.value;
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  return { send, evaluate, close: () => { try { sock.close(); } catch {} } };
}

/**
 * ★ A NARROW WINDOW IS NOT A PHONE (register row 229).
 * This used to emulate every width with `{ height: 900, deviceScaleFactor: 1, mobile: false }`
 * — a narrow DESKTOP window, which is a different device than the one the bug was reported on.
 * `mobile: false` leaves the page in desktop mode (no mobile viewport handling), and DPR 1 is
 * not what a phone renders text at. Anything that only misbehaves under real mobile emulation —
 * a label the browser drops at a fractional device pixel, a touch-only layout path — could not
 * be reproduced here at all. Below the page's own 760px legend breakpoint the profile is now a
 * real phone: mobile mode, DPR 3, touch enabled (the device-metrics override alone leaves
 * `hover: hover` / `pointer: fine` matching, row 175).
 */
async function load(cdp, bootstrap, width) {
  const phone = width < 760;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height: phone ? 844 : 900, deviceScaleFactor: phone ? 3 : 1, mobile: phone
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
  await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
  await sleep(500);
  await cdp.evaluate(bootstrap);
  await cdp.send('Page.navigate', { url: BASE + '/dashboard.html' });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await cdp.evaluate('document.readyState === "complete" && !!document.body')) break; }
  const w = await cdp.evaluate('window.innerWidth');
  if (w !== width) throw new Error('viewport integrity: asked ' + width + ', got ' + w);
  return cdp.evaluate(WAIT_DONUT);
}

function runContrast(bootstrap, label) {
  const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
    cwd: HERE, encoding: 'utf8',
    env: Object.assign({}, process.env, {
      CONTRAST_PROFILE: 'allocation-donut', CONTRAST_URL: BASE + '/dashboard.html',
      CONTRAST_BOOTSTRAP_JS: bootstrap, CONTRAST_PREPARE_JS: WAIT_DONUT,
      CONTRAST_SETTLE_MS: '4000', CONTRAST_WIDTHS: '1440', CONTRAST_PORT: '9348'
    })
  });
  forwardChildTeardown(res, 'verify-contrast');
  const out = (res.stdout || '') + (res.stderr || '');
  if (!out.trim()) { console.log('  ' + label + ' -> child printed nothing: status=' + res.status + ' error=' + (res.error ? res.error.message : 'none')); }
  const m = out.match(/(\d+) measurements, (\d+) below/);
  console.log('  ' + label + ' -> ' + out.trim().split('\n').slice(-2).join(' | '));
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0);
  check(label + ': every in-band label and legend row clears 4.5:1', /CONTRAST: PASS/.test(out));
  out.split('\n').filter((l) => /FAIL\s+\d|UNMEASURED\s/.test(l)).forEach((l) => console.log('      ' + l.trim()));
}

async function main() {
  const { url, anon, service } = localCreds();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const anonC = createClient(url, anon, { auth: { persistSession: false } });
  const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
  const suffix = Math.random().toString(36).slice(2, 8);
  const made = [];
  const profile = makeTempDir('mw-donut-');
  let cdp = null;

  async function makeClient(tag, holdings, unallocated, assetReturns) {
    const email = 'donutvis-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw new Error(error.message);
    const id = data.user.id; made.push(id);
    await admin.from('clients').insert({ id, name: 'Donut ' + tag, email, phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    await admin.from('account_state').insert({ client_id: id, unallocated_capital: unallocated, allocated_capital: 0, asset_returns: assetReturns || 0 });
    for (const h of holdings) await admin.from('holdings').insert({ client_id: id, product_id: h.id, units: h.units, cost_basis: h.cb });
    const { data: s, error: sErr } = await anonC.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error(sErr.message);
    const bootstrap = 'localStorage.setItem(' + JSON.stringify(storageKey) + ',' + JSON.stringify(JSON.stringify(s.session)) + ');sessionStorage.setItem("marketswave_authenticated_client_id",' + JSON.stringify(id) + ');sessionStorage.setItem("marketswave_current_client_id",' + JSON.stringify(id) + ');true';
    return { id, bootstrap };
  }

  try {
    const { data: prods } = await admin.from('products').select('id, ticker, asset_class').in('ticker', ['SPY', 'BTC', 'NVDA']);
    const P = Object.fromEntries(prods.map((p) => [p.ticker, p]));

    // FULL: all five bands present — two market-priced, cash, two appraisal-valued.
    const { data: appr } = await admin.from('products').select('id, ticker, asset_class').in('asset_class', ['Private Equity', 'Real Assets']).limit(4);
    const pe = appr.find((p) => p.asset_class === 'Private Equity');
    const ra = appr.find((p) => p.asset_class === 'Real Assets');
    const full = await makeClient('full', [
      { id: P.SPY.id, units: 12, cb: 6000 }, { id: P.BTC.id, units: 0.08, cb: 4000 },
      { id: pe.id, units: 60, cb: 3000 }, { id: ra.id, units: 40, cb: 1200 },
    ], 2400, 900);
    // A second client whose two appraisal bands are deliberately TINY (well under 3%), to
    // prove the in-band label is omitted rather than spilling across the separator.
    const tiny = await makeClient('tiny', [
      { id: P.SPY.id, units: 40, cb: 20000 }, { id: P.BTC.id, units: 0.3, cb: 18000 },
      { id: pe.id, units: 1, cb: 400 }, { id: ra.id, units: 1, cb: 300 },
    ], 8000, 0);
    const solo = await makeClient('solo', [{ id: P.BTC.id, units: 0.05, cb: 3000 }], 0, 0);
    const empty = await makeClient('empty', [], 0, 0);

    cdp = await connect(profile);

    console.log('\n1. FIVE SEGMENTS — real geometry, real percentages, empty centre\n');
    await load(cdp, full.bootstrap, 1440);
    const g = await cdp.evaluate(`(()=>{
      const paths=[...document.querySelectorAll('#allocation-ring path')];
      const vals=[...document.querySelectorAll('#allocation-vals text')];
      const rows=[...document.querySelectorAll('#allocation-legend .ad-row')];
      const svg=document.getElementById('allocation-donut');
      return {
        n:paths.length,
        fills:paths.map(p=>p.getAttribute('fill')),
        strokes:paths.map(p=>({s:p.getAttribute('stroke')||getComputedStyle(p).stroke,w:getComputedStyle(p).strokeWidth})),
        labels:vals.map(t=>({txt:t.textContent,fill:getComputedStyle(t).fill,d:t.getAttribute('data-fill')})),
        pcts:rows.map(r=>parseFloat(r.querySelector('.ad-amt span').textContent)),
        names:rows.map(r=>r.querySelector('.ad-nm b').textContent),
        subs:rows.map(r=>r.querySelector('.ad-nm span').textContent),
        aria:svg.getAttribute('aria-label'),
        centreText:[...svg.querySelectorAll('text')].filter(t=>{const b=t.getBBox();return Math.hypot(b.x+b.width/2-170,b.y+b.height/2-170)<80;}).map(t=>t.textContent),
        bboxes:paths.map(p=>{const b=p.getBBox();return {w:Math.round(b.width),h:Math.round(b.height)};})
      };})()`);
    check('five segments render for a client holding all five bands', g.n === 5, 'n=' + g.n);
    check('fills are exactly the approved palette in ramp order',
      JSON.stringify(g.fills) === JSON.stringify(['#4B2E83', '#8B7CB5', '#C4BEDA', '#E08B14', '#F5C377']), g.fills.join(','));
    check('every segment carries the 2.5px page-background separating stroke',
      g.strokes.every((s) => /FDFCFA|253,\s*252,\s*250/i.test(s.s) && parseFloat(s.w) === 2.5), JSON.stringify(g.strokes[0]));
    check('legend percentages sum to 100', Math.abs(g.pcts.reduce((a, b) => a + b, 0) - 100) < 0.15, g.pcts.join(' + ') + ' = ' + g.pcts.reduce((a, b) => a + b, 0).toFixed(2));
    check('legend states what prices each class', g.subs.filter((s) => /Market price|Valued by appraisal|Awaiting deployment/.test(s)).length === 5, g.subs.join(' | '));
    check('THE CENTRE IS EMPTY — no text inside the hole', g.centreText.length === 0, g.centreText.join(','));
    check('white ink ONLY on the deep purple — the one fill it clears 4.5:1 on',
      g.labels.filter((l) => l.d === '#4B2E83').every((l) => /255,\s*255,\s*255/.test(l.fill)));
    check('dark ink (#1A1206) on the other four, including the two the mockup marked white',
      g.labels.filter((l) => l.d !== '#4B2E83').every((l) => /26,\s*18,\s*6/.test(l.fill)),
      g.labels.map((l) => l.d + '=' + l.fill).join(' | '));
    check('the SVG aria-label names every class with its real percentage',
      g.names.every((n) => g.aria.includes(n)) && /percent/.test(g.aria), g.aria);

    console.log('\n2. ★ ONE CLASS — the 360-degree full ring actually draws\n');
    await load(cdp, solo.bootstrap, 1440);
    const s1 = await cdp.evaluate(`(()=>{
      const paths=[...document.querySelectorAll('#allocation-ring path')];
      const rows=[...document.querySelectorAll('#allocation-legend .ad-row')];
      const b=paths[0]?paths[0].getBBox():null;
      return {n:paths.length,bbox:b?{w:+b.width.toFixed(1),h:+b.height.toFixed(1)}:null,
        rule:paths[0]?paths[0].getAttribute('fill-rule'):null,
        pct:rows.length?rows[0].querySelector('.ad-amt span').textContent:null,
        label:document.querySelector('#allocation-vals text')?document.querySelector('#allocation-vals text').textContent:null,
        rows:rows.length};})()`);
    check('exactly one segment renders', s1.n === 1, 'n=' + s1.n);
    check('★ it is a REAL ring, not a degenerate empty path (bbox ~296x296, the full outer diameter)',
      !!s1.bbox && s1.bbox.w > 290 && s1.bbox.h > 290, JSON.stringify(s1.bbox));
    check('drawn as an even-odd annulus so the hole is genuinely cut', s1.rule === 'evenodd', String(s1.rule));
    check('it reads 100% in the legend and in the band', s1.pct === '100.0%' && s1.label === '100%', s1.pct + ' / ' + s1.label);
    check('the legend has exactly one row — no zero-value classes listed', s1.rows === 1, 'rows=' + s1.rows);

    console.log('\n3. ZERO-VALUE CLASSES — omitted from ring AND legend\n');
    check('the solo client holds one class, so four classes are absent entirely', s1.n === 1 && s1.rows === 1);

    console.log('\n3b. TINY BANDS — segment still drawn, in-band label omitted below 3%\n');
    await load(cdp, tiny.bootstrap, 1440);
    const t = await cdp.evaluate(`(()=>{
      const rows=[...document.querySelectorAll('#allocation-legend .ad-row')];
      const pcts=rows.map(r=>({name:r.querySelector('.ad-nm b').textContent,pct:parseFloat(r.querySelector('.ad-amt span').textContent)}));
      const labelled=[...document.querySelectorAll('#allocation-vals text')].map(x=>x.getAttribute('data-fill'));
      return {paths:document.querySelectorAll('#allocation-ring path').length,pcts,labelled};})()`);
    const tinyRows = t.pcts.filter((p) => p.pct < 3);
    const bigRows = t.pcts.filter((p) => p.pct >= 3);
    check('the client genuinely has at least one band under 3%', tinyRows.length > 0, JSON.stringify(t.pcts));
    check('every band still DRAWS — omitting a label never omits the segment',
      t.paths === t.pcts.length, t.paths + ' paths vs ' + t.pcts.length + ' legend rows');
    check('★ no in-band label on a sub-3% band (it would spill across the separator)',
      t.labelled.length === bigRows.length, t.labelled.length + ' labels for ' + bigRows.length + ' bands at/over 3%');
    check('the legend still carries every percentage, including the tiny ones',
      tinyRows.every((r) => r.pct > 0), JSON.stringify(tinyRows));

    console.log('\n4. EMPTY STATE — nothing allocated\n');
    await load(cdp, empty.bootstrap, 1440);
    const e = await cdp.evaluate(`(()=>{const l=document.getElementById('allocation-legend');
      return {paths:document.querySelectorAll('#allocation-ring path').length,
        txt:l.textContent.replace(/\\s+/g,' ').trim().slice(0,90),
        cta:!!l.querySelector('a[href="deploy-capital.html"]')};})()`);
    check('no ring is drawn at all', e.paths === 0, 'paths=' + e.paths);
    check('an honest empty state shows instead', /No capital deployed yet/.test(e.txt), e.txt);
    check('with a real Deploy Capital route out', e.cta);

    /* ══════════════════════════════════════════════════════════════════════════════════
     * 5. MOBILE — the legend stacks, the bars drop out, AND THE IN-BAND LABELS ARE THERE.
     *
     * ★ THE LABEL ASSERTION IS NEW (register row 229), AND ITS ABSENCE IS WHY "no labels on
     * mobile" was reported by a human rather than by this suite. This section used to read
     * exactly three things — gridTemplateColumns, .ad-bar's display, and scrollWidth — and
     * never once looked at #allocation-vals. A build that drew the ring, the legend and zero
     * percentage labels at 390px would have passed it cleanly.
     *
     * Every width now checks the labels against the SAME fixture the desktop run uses, so a
     * label count that is correct at 1440 and wrong at 390 cannot hide: the count must match
     * the desktop count, each label must be genuinely visible (not merely present in the DOM),
     * and each must match its own legend row so the ring and its key cannot disagree.
     * ═══════════════════════════════════════════════════════════════════════════════════ */
    console.log('\n5. MOBILE — legend stacks, bars drop out, in-band labels still drawn\n');

    // Read at 1440 first, so the mobile counts are compared against a real measured desktop
    // baseline rather than against a number this file decided on its own.
    await load(cdp, full.bootstrap, 1440);
    const baseline = await cdp.evaluate(`(()=>{
      const vals=[...document.querySelectorAll('#allocation-vals text')].map(t=>t.textContent.trim());
      const rows=[...document.querySelectorAll('#allocation-legend .ad-row')].map(r=>parseFloat(r.querySelector('.ad-amt span').textContent));
      return {vals,rows,over3:rows.filter(p=>p>=3).length};})()`);
    // The `full` fixture's five bands are ALL over 3% (smallest ~7%), so on this client every
    // band must carry a label at every width — which is exactly what makes "the labels are
    // missing on mobile" a checkable claim here. The suppression case has its own fixture
    // (`tiny`), exercised at phone width after the loop.
    check('BASELINE at 1440px: every band on this fixture is over 3%, so every band must carry a label',
      baseline.over3 === baseline.rows.length && baseline.rows.length >= 2,
      baseline.over3 + ' of ' + baseline.rows.length + ' bands over 3%: ' + baseline.rows.join(', ') + '%');
    check('BASELINE at 1440px: one in-band label per band',
      baseline.vals.length === baseline.rows.length && baseline.vals.length > 0, baseline.vals.join(', '));

    const MOBILE_PROBE = `(()=>{const b=document.querySelector('.ad-body');const bar=document.querySelector('.ad-bar');
      const vals=[...document.querySelectorAll('#allocation-vals text')];
      const rows=[...document.querySelectorAll('#allocation-legend .ad-row')].map(r=>parseFloat(r.querySelector('.ad-amt span').textContent));
      const ring=document.getElementById('allocation-ring');
      const rb=ring?ring.getBoundingClientRect():{width:0,height:0};
      return {cols:getComputedStyle(b).gridTemplateColumns.split(' ').length,
        bar:bar?getComputedStyle(bar).display:'none-present',ovf:document.body.scrollWidth,
        vals:vals.map(t=>t.textContent.trim()),
        visible:vals.filter(t=>{const s=getComputedStyle(t);const r=t.getBoundingClientRect();
          return s.display!=='none'&&s.visibility!=='hidden'&&parseFloat(s.fillOpacity||'1')>0&&r.width>0&&r.height>0;}).length,
        rows:rows,ringW:Math.round(rb.width),ringH:Math.round(rb.height),
        dpr:window.devicePixelRatio,touch:('ontouchstart' in window)||navigator.maxTouchPoints>0};})()`;

    for (const w of [390, 375, 320]) {
      if (w === 320) {
        // 320 through a real same-origin iframe: the top-level override floors at ~348px on
        // this build (row 211). The iframe is a real 320px layout viewport and inherits the
        // PARENT's device metrics, so the phone profile applies to it too.
        await load(cdp, full.bootstrap, 390);
        const r = await cdp.evaluate(`(async()=>{const f=document.createElement('iframe');f.style.cssText='width:320px;height:760px;border:0';f.src='${BASE}/dashboard.html';document.body.appendChild(f);
          await new Promise(r=>{f.onload=r;setTimeout(r,9000)});await new Promise(r=>setTimeout(r,5000));
          const d=f.contentDocument,W=f.contentWindow;if(!d)return {err:'no doc'};
          const body=d.querySelector('.ad-body');const bar=d.querySelector('.ad-bar');
          const vals=[...d.querySelectorAll('#allocation-vals text')];
          const rows=[...d.querySelectorAll('#allocation-legend .ad-row')].map(x=>parseFloat(x.querySelector('.ad-amt span').textContent));
          return {iw:W.innerWidth,cols:body?W.getComputedStyle(body).gridTemplateColumns.split(' ').length:-1,
            bar:bar?W.getComputedStyle(bar).display:'none-present',ovf:d.body.scrollWidth,
            vals:vals.map(t=>t.textContent.trim()),
            visible:vals.filter(t=>{const s=W.getComputedStyle(t);const rr=t.getBoundingClientRect();
              return s.display!=='none'&&s.visibility!=='hidden'&&parseFloat(s.fillOpacity||'1')>0&&rr.width>0&&rr.height>0;}).length,
            rows:rows};})()`);
        check('320px (real iframe): width really is 320', r.iw === 320, JSON.stringify({ iw: r.iw }));
        check('320px: legend stacks — one grid column', r.cols === 1, 'cols=' + r.cols);
        check('320px: proportional bars are hidden', r.bar === 'none' || r.bar === 'none-present', r.bar);
        check('320px: no horizontal overflow', r.ovf <= 320, 'scrollWidth=' + r.ovf);
        check('★ 320px: the in-band percentage labels are STILL DRAWN — same count as desktop',
          r.vals.length === baseline.vals.length && r.vals.length > 0,
          r.vals.length + ' labels (desktop had ' + baseline.vals.length + '): ' + r.vals.join(', '));
        check('★ 320px: every one of them is genuinely visible, not present-but-invisible',
          r.visible === r.vals.length && r.visible > 0, r.visible + ' of ' + r.vals.length + ' visible');
        check('320px: each label matches its own legend row, so the ring and the key agree',
          r.vals.every((v) => r.rows.some((p) => Math.abs(p - parseFloat(v)) < 1.5)),
          'labels ' + r.vals.join(', ') + ' vs rows ' + r.rows.join(', ') + '%');
      } else {
        await load(cdp, full.bootstrap, w);
        const r = await cdp.evaluate(MOBILE_PROBE);
        check(w + 'px: a REAL phone profile is in effect — DPR 3 and touch, not a narrow desktop window',
          r.dpr === 3 && r.touch === true, 'dpr=' + r.dpr + ' touch=' + r.touch);
        check(w + 'px: legend stacks — one grid column', r.cols === 1, 'cols=' + r.cols);
        check(w + 'px: proportional bars are hidden', r.bar === 'none' || r.bar === 'none-present', r.bar);
        check(w + 'px: no horizontal overflow', r.ovf <= w, 'scrollWidth=' + r.ovf);
        check(w + 'px: the ring is still drawn at a real size', r.ringW > 100 && r.ringH > 100, r.ringW + 'x' + r.ringH);
        check('★ ' + w + 'px: the in-band percentage labels are STILL DRAWN — same count as desktop',
          r.vals.length === baseline.vals.length && r.vals.length > 0,
          r.vals.length + ' labels (desktop had ' + baseline.vals.length + '): ' + r.vals.join(', '));
        check('★ ' + w + 'px: every one of them is genuinely visible, not present-but-invisible',
          r.visible === r.vals.length && r.visible > 0, r.visible + ' of ' + r.vals.length + ' visible');
        check(w + 'px: each label matches its own legend row, so the ring and the key agree',
          r.vals.every((v) => r.rows.some((p) => Math.abs(p - parseFloat(v)) < 1.5)),
          'labels ' + r.vals.join(', ') + ' vs rows ' + r.rows.join(', ') + '%');
      }
    }

    // ★ The suppression rule at PHONE width, on the fixture that actually has a sub-3% band.
    // The reported bug was "no labels on mobile"; the opposite failure — a rule that stops
    // suppressing once the ring is small — would be just as wrong, and only this fixture can
    // tell the two apart.
    await load(cdp, tiny.bootstrap, 390);
    const tinyPhone = await cdp.evaluate(MOBILE_PROBE);
    check('390px (sub-3% fixture): the fixture still genuinely has a band under 3% at phone width',
      tinyPhone.rows.some((p) => p < 3), tinyPhone.rows.join(', ') + '%');
    check('★ 390px (sub-3% fixture): labels are drawn for the bands over 3% — suppression did not swallow them all',
      tinyPhone.vals.length === tinyPhone.rows.filter((p) => p >= 3).length && tinyPhone.vals.length > 0,
      tinyPhone.vals.length + ' labels for ' + tinyPhone.rows.filter((p) => p >= 3).length + ' bands over 3%: ' + tinyPhone.vals.join(', '));
    check('★ 390px (sub-3% fixture): the sub-3% band is still a legend row, so nothing is lost to the reader',
      tinyPhone.rows.length > tinyPhone.vals.length, tinyPhone.rows.join(', ') + '%');

    await load(cdp, full.bootstrap, 1440);
    const wide = await cdp.evaluate(`(()=>{const b=document.querySelector('.ad-body');const bar=document.querySelector('.ad-bar');
      return {cols:getComputedStyle(b).gridTemplateColumns.split(' ').length,bar:bar?getComputedStyle(bar).display:'?'};})()`);
    check('1440px: two columns and the bars are back — no desktop regression', wide.cols === 2 && wide.bar === 'block', JSON.stringify(wide));

    cdp.close(); cdp = null;

    console.log('\n6. CONTRAST — in-band labels with the .glass::before sheen composited\n');
    runContrast(full.bootstrap, 'all five fills + legend');

    console.log('\n' + '='.repeat(66));
    console.log(passed + '/' + (passed + failed) + ' assertions passed.');
    if (failed) { console.log('\nFAILURES:'); fails.forEach((f) => console.log('  - ' + f)); }
    console.log(failed ? '\nVERIFY: FAIL' : '\nVERIFY: PASS');
  } finally {
    if (cdp) cdp.close();
    await releaseTempDir(profile);
    for (const id of made) {
      await admin.from('holdings').delete().eq('client_id', id);
      await admin.from('account_state').delete().eq('client_id', id);
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log('cleanup: removed ' + made.length + ' test client(s)');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
