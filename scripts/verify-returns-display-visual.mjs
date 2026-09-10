// verify-returns-display-visual.mjs — Returns Display (2026-09-09), real-browser pass.
//
// jsdom has no layout and no paint, so the things that can only be checked in a real browser
// live here: composited contrast on every new coloured figure, and the narrow-viewport
// behaviour of a table that just gained three columns.
//
// Contrast itself is measured by verify-contrast.mjs — this script seeds a real portfolio,
// obtains a real session, and drives that tool against both pages via its CONTRAST_PROFILE /
// CONTRAST_BOOTSTRAP_JS hooks, rather than reimplementing the sampling.
//
// BOTH TONES ARE MEASURED. The seeded portfolio deliberately contains a winner AND a genuine
// loser, so the red state is measured for real rather than assumed to behave like the green
// one. A returns display that has only ever been measured green is only half measured.
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.RETURNS_VISUAL_PORT || 9344);
const BASE = process.env.RETURNS_BASE_URL || 'http://127.0.0.1:8765';
// Set RETURNS_SHOT_DIR to have each viewport's render written out for eyes-on comparison.
const SHOT_DIR = process.env.RETURNS_SHOT_DIR || '';
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail !== undefined ? '  [' + detail + ']' : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Residue sweep, run on ENTRY rather than only in the finally.
//
// The finally block below cleans up a normal run, but it cannot run if the process is KILLED
// mid-flight — which is exactly what happened during this task's own development (a suite
// runner was stopped part-way and left seven test accounts behind, cleaned up by hand). Row
// 178 already learned this for verify-products-catalog-fix: sweep by the script's own email
// SHAPE on entry, so residue from an older crashed run is collected automatically instead of
// waiting for somebody to notice it. listUsers is paged, so walk it rather than trusting
// page one.
async function sweepResidue(admin, re) {
  const ids = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error('SWEEP: listUsers failed: ' + error.message); return; }
    const users = (data && data.users) || [];
    for (const u of users) if (re.test(u.email || '')) ids.push(u.id);
    if (users.length < 200) break;
  }
  for (const id of ids) {
    await admin.from('transactions').delete().eq('client_id', id);
    await admin.from('holdings').delete().eq('client_id', id);
    await admin.from('account_state').delete().eq('client_id', id);
    await admin.from('clients').delete().eq('id', id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error('SWEEP: could not delete ' + id + ': ' + error.message);
  }
  if (ids.length) console.log('sweep: cleared ' + ids.length + ' leftover account(s) from an earlier interrupted run');
}


function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.replace(/^[^{]*/, ''));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('non-local API_URL');
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY, anonKey: status.ANON_KEY };
}

// ---- minimal CDP client (same shape verify-contrast.mjs uses) ------------------------------
async function connect() {
  const profile = mkdtempSync(join(tmpdir(), 'mw-returns-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--force-device-scale-factor=1', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(300);
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const tabs = await r.json();
      const page = tabs.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
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
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable');
  return { send, evaluate, close: () => { ws.close(); chrome.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch (e) {} } };
}

async function main() {
  console.log('Returns Display — real-browser visual pass\n');
  const { url, serviceRoleKey, anonKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  await sweepResidue(admin, /^returnsvis-[0-9a-f]{8}@test[.]marketswave[.]local$/);
  const suffix = crypto.randomBytes(4).toString('hex');
  const PASSWORD = 'ReturnsVisual-2026!';
  const email = 'returnsvis-' + suffix + '@test.marketswave.local';
  let clientId = null;
  let cdp = null;

  try {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (cErr) throw new Error('createUser: ' + cErr.message);
    clientId = created.user.id;
    await admin.from('clients').insert({
      id: clientId, name: 'Returns Visual ' + suffix, email, phone: '+1-555-0188',
      account_type: 'Individual Account', status: 'active'
    });

    const { data: prods } = await admin.from('products').select('*');
    const byId = Object.fromEntries(prods.map((p) => [p.id, p]));
    // A winner and a GENUINE loser, so both tones are on screen to be measured.
    await admin.from('account_state').insert({
      client_id: clientId, unallocated_capital: 20000, allocated_capital: 0, asset_returns: 3400
    });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0001', units: 500, cost_basis: 50000 });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0003', units: 300, cost_basis: 30000 });
    await admin.from('holdings').insert({ client_id: clientId, product_id: 'PROD-0004', units: 200, cost_basis: 40000 });
    // A realistic SELL row, not just a gain figure: the closed-positions panel recovers the
    // original capital as total_value - realized_return, so $1,000 of proceeds carrying a
    // $3,400 gain would imply a NEGATIVE original cost and quietly render nonsense. 200 units
    // at ~111 is $22,274 of proceeds against a $3,400 gain — an ordinary trade.
    const sellUnits = 200;
    await admin.from('transactions').insert({
      client_id: clientId, product_id: 'PROD-0003', type: 'SELL', units: sellUnits,
      price: byId['PROD-0003'].unit_price,
      total_value: Math.round(sellUnits * byId['PROD-0003'].unit_price * 100) / 100,
      realized_return: 3400, status: 'completed'
    });

    const anon = createClient(url, anonKey);
    const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (sErr) throw new Error('signIn: ' + sErr.message);

    // The SDK's default storageKey is derived from the project URL's own first hostname
    // label. A wrong key here cannot produce a false pass: the page would bounce to
    // login.html and the contrast run would report zero measurements, which it treats as a
    // hard failure rather than a clean sheet.
    const storageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    const bootstrap = [
      'localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(JSON.stringify(signed.session)) + ');',
      'sessionStorage.setItem("marketswave_authenticated_client_id", ' + JSON.stringify(clientId) + ');',
      'sessionStorage.setItem("marketswave_current_client_id", ' + JSON.stringify(clientId) + ');',
      'true'
    ].join('');

    function runContrast(profile, page, label) {
      const res = spawnSync(process.execPath, ['verify-contrast.mjs'], {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        encoding: 'utf8',
        env: Object.assign({}, process.env, {
          CONTRAST_PROFILE: profile,
          CONTRAST_URL: BASE + '/' + page,
          CONTRAST_BOOTSTRAP_JS: bootstrap,
          CONTRAST_SETTLE_MS: '15000',
          CONTRAST_PORT: String(PORT + 10)
        })
      });
      const out = res.stdout || '';
      const tail = out.trim().split('\n').slice(-2).join(' | ');
      const m = out.match(/(\d+) measurements, (\d+) below/);
      console.log('  ' + label + ' -> ' + tail);
      check(label + ': contrast measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
      check(label + ': every measured figure clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
      // Print any failing lines so a regression names itself.
      out.split('\n').filter((l) => /FAIL\s+\d/.test(l)).forEach((l) => console.log('      ' + l.trim()));
    }

    // ===================================================================================
    console.log('\n=== CONTRAST — every new coloured figure, real composited pixels ===\n');
    runContrast('returns-dashboard', 'dashboard.html', 'dashboard.html');
    runContrast('returns-holdings', 'asset-performance.html', 'asset-performance.html');

    // The empty state is what most clients see, so it is measured as a real state rather
    // than assumed to inherit a tone measured on a populated page. Removing the SELL row
    // turns this same client into one who has never sold.
    await admin.from('transactions').delete().eq('client_id', clientId).eq('type', 'SELL');
    runContrast('returns-holdings-empty', 'asset-performance.html', 'asset-performance.html (never sold)');
    await admin.from('transactions').insert({
      client_id: clientId, product_id: 'PROD-0003', type: 'SELL', units: sellUnits,
      price: byId['PROD-0003'].unit_price,
      total_value: Math.round(sellUnits * byId['PROD-0003'].unit_price * 100) / 100,
      realized_return: 3400, status: 'completed'
    });

    // ===================================================================================
    console.log('\n=== MOBILE — the table gained three columns ===\n');
    cdp = await connect();
    for (const width of [1440, 390, 375, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
      if (width === 1440) {
        await cdp.send('Page.navigate', { url: BASE + '/' });
        await sleep(600);
        await cdp.evaluate(bootstrap);
      }
      await cdp.send('Page.navigate', { url: BASE + '/asset-performance.html' });
      // Poll for the real render rather than sleeping a fixed amount: the FIRST navigation
      // of a run is much slower than later ones (cold module fetch + a real settle pass), and
      // a fixed wait that happens to suit the warm case reads the skeleton on the cold one.
      // Wait for the DERIVED data-labels too, not just the rendered rows:
      // responsive-tables.js applies them from a DEBOUNCED MutationObserver that fires after
      // the render, so checking the instant the tfoot appears races it. That race is real but
      // harness-only — it showed up at one width and not the two narrower ones purely on
      // timing, which is exactly the shape of a flaky assertion rather than a real bug.
      for (let i = 0; i < 60; i++) {
        const done = await cdp.evaluate(
          "(() => { const f = document.querySelector('#return-table-foot tr');" +
          " const c = document.querySelector('#return-table-body tr td:nth-child(2)');" +
          " const p = document.querySelector('#closed-positions-region tfoot tr');" +
          " const pc = document.querySelector('#closed-positions-region tbody tr td:nth-child(2)');" +
          " return !!f && !!c && c.hasAttribute('data-label')" +
          "        && !!p && !!pc && pc.hasAttribute('data-label'); })()"
        );
        if (done) break;
        await sleep(500);
      }

      const real = await cdp.evaluate('window.innerWidth');
      // Viewport-integrity guard — this project has had a run report a clean PASS while the
      // browser was silently clamped to a different width.
      check('viewport is genuinely ' + width + 'px', real === width, 'got ' + real);
      if (real !== width) continue;

      const r = await cdp.evaluate(`(() => {
        const rows = document.querySelectorAll('#return-table-body tr');
        const trendTh = [...document.querySelectorAll('.rt th')].find(x => x.textContent.trim() === 'Trend');
        const foot = document.querySelector('#return-table-foot tr');
        const cRows = document.querySelectorAll('#closed-positions-region tbody tr');
        const cFoot = document.querySelector('#closed-positions-region tfoot tr');
        const w = (el) => el ? Math.round(el.getBoundingClientRect().width) : 0;
        // A card label is PROSE. It is drawn by td::before, which inherits from its
        // originating cell — so a numeric (monospace) cell used to hand its family to its
        // own label. Read the real computed family rather than trusting the rule exists.
        const labelFamily = (el) => el ? getComputedStyle(el, '::before').fontFamily : '';
        const numericCell = rows.length ? rows[0].children[1] : null;   // Units: a mono cell
        // A cell with genuinely nothing in it should not be drawn as a blank bordered strip.
        const emptyVisible = [...document.querySelectorAll('.mw-card-table td')].filter(
          td => td.children.length === 0 && td.textContent.trim() === ''
                && getComputedStyle(td).display !== 'none').length;
        // The way IN to allocating capital, relative to the first table.
        const browse = document.querySelector('a[href="asset-collection.html"]');
        const firstTable = document.querySelector('table.rt');
        return {
          rendered: !!foot && rows.length > 0,
          bodyScrollW: document.body.scrollWidth,
          innerW: window.innerWidth,
          trendDisplay: trendTh ? getComputedStyle(trendTh).display : 'missing',
          rowDisplay: rows.length ? getComputedStyle(rows[0]).display : 'none',
          firstCellLabel: numericCell ? (getComputedStyle(numericCell, '::before').content || '') : '',
          numericCellLabelFamily: labelFamily(numericCell),
          legendVisible: !!document.querySelector('.rt-legend') && getComputedStyle(document.querySelector('.rt-legend')).display !== 'none',
          footLabelled: foot ? [...foot.children].every(td => td.hasAttribute('data-label')) : false,
          rowW: w(rows[0]), footW: w(foot),
          closedRendered: !!cFoot && cRows.length > 0,
          closedRowDisplay: cRows.length ? getComputedStyle(cRows[0]).display : 'none',
          closedCellLabel: cRows.length ? (getComputedStyle(cRows[0].children[1], '::before').content || '') : '',
          closedFootLabelled: cFoot ? [...cFoot.children].every(td => td.hasAttribute('data-label')) : false,
          closedRowW: w(cRows[0]), closedFootW: w(cFoot),
          emptyVisible: emptyVisible,
          browseBeforeTable: !!browse && !!firstTable &&
            (browse.compareDocumentPosition(firstTable) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        };
      })()`);

      // ---- TYPOGRAPHY: mono is FIGURES ONLY inside this table (2026-09-10) --------------
      // Read the real computed family, never the class list — the whole failure mode here is
      // a rule that matches and does nothing, or an inherited family nobody declared.
      const t = await cdp.evaluate(`(() => {
        const fam = (el) => el ? getComputedStyle(el).fontFamily : 'MISSING';
        const isMono = (f) => /JetBrains Mono/i.test(f);
        const isInter = (f) => /^["']?Inter/i.test(f);
        const q = (sel) => document.querySelector(sel);
        const rt = document.getElementById('return-table-body').closest('table');
        const panel = document.querySelector('#closed-positions-region table');
        return {
          head:        fam(rt.querySelector('thead th')),
          panelHead:   fam(panel && panel.querySelector('thead th')),
          meta:        fam(rt.querySelector('#return-table-body .rt-meta')),
          totalLab:    fam(q('.rt-total-lab')),
          legend:      fam(q('.rt-legend div')),
          holdingName: fam(rt.querySelector('#return-table-body b')),
          num:         fam(rt.querySelector('#return-table-body .rt-num')),
          val:         fam(rt.querySelector('#return-table-body .rt-val')),
          gainAmt:     fam(rt.querySelector('#return-table-body .rt-gain .a')),
          gainPct:     fam(rt.querySelector('#return-table-body .rt-gain .p')),
          // Surrounding page content the table is supposed to sit inside, not fight.
          pageH2:      fam(q('main h2')),
          cardLabel:   fam(q('.ret-k')),
          cardFigure:  fam(q('.ret-v')),
          cardSubFig:  fam(q('.ret-sub .ret-u')),
          headWeight:  q('.rt th') ? getComputedStyle(q('.rt th')).fontWeight : '',
          metaWeight:  q('.rt-meta') ? getComputedStyle(q('.rt-meta')).fontWeight : '',
          monoCount:   [...document.querySelectorAll('.rt *')]
                         .filter(el => isMono(getComputedStyle(el).fontFamily)).length,
          _isMono: null
        };
      })()`);
      const mono = (f) => /JetBrains Mono/i.test(f || '');
      const inter = (f) => /^["']?Inter/i.test(f || '');
      check(width + 'px: column heads are Inter, not mono', inter(t.head) && !mono(t.head), t.head);
      check(width + 'px: panel column heads are Inter too', inter(t.panelHead) && !mono(t.panelHead), t.panelHead);
      check(width + 'px: the asset-class label is Inter, not mono', inter(t.meta) && !mono(t.meta), t.meta);
      check(width + 'px: the TOTAL label is Inter, not mono', inter(t.totalLab) && !mono(t.totalLab), t.totalLab);
      check(width + 'px: the legend stayed Inter', inter(t.legend) && !mono(t.legend), t.legend);
      check(width + 'px: the holding name is Inter (prose, unchanged)', inter(t.holdingName), t.holdingName);
      // The other half of the rule: every figure genuinely stayed mono.
      check(width + 'px: numeric cells stayed mono', mono(t.num), t.num);
      check(width + 'px: value cells stayed mono', mono(t.val), t.val);
      check(width + 'px: the unrealised amount stayed mono', mono(t.gainAmt), t.gainAmt);
      check(width + 'px: the unrealised percentage stayed mono', mono(t.gainPct), t.gainPct);
      check(width + 'px: the card sub-line figure stayed mono', mono(t.cardSubFig), t.cardSubFig);
      // The table now shares its label typeface with the page around it.
      check(width + 'px: table heads match the page heading family', inter(t.pageH2) && inter(t.head), t.pageH2 + ' | ' + t.head);
      check(width + 'px: table heads match the summary card label family', inter(t.cardLabel) && inter(t.head), t.cardLabel + ' | ' + t.head);
      check(width + 'px: labels kept a real head weight after the family swap',
        Number(t.headWeight) >= 600 && Number(t.metaWeight) >= 600, t.headWeight + '/' + t.metaWeight);

      check(width + 'px: the Return Table rendered', r.rendered, JSON.stringify(r));
      check(width + 'px: the closed-positions panel rendered', r.closedRendered);
      check(width + 'px: no horizontal page overflow', r.bodyScrollW <= r.innerW + 1, r.bodyScrollW + ' vs ' + r.innerW);
      check(width + 'px: legend stays visible', r.legendVisible);
      check(width + 'px: Browse Asset Collection sits above the tables', r.browseBeforeTable);
      if (width >= 1024) {
        check(width + 'px: Trend column is shown on desktop', r.trendDisplay !== 'none', r.trendDisplay);
        check(width + 'px: rows stay real table rows on desktop', r.rowDisplay === 'table-row', r.rowDisplay);
        check(width + 'px: the panel stays a real table on desktop too', r.closedRowDisplay === 'table-row', r.closedRowDisplay);
      } else {
        check(width + 'px: Trend column is hidden rather than squeezing the figures', r.trendDisplay === 'none', r.trendDisplay);
        check(width + 'px: rows switch to the card layout from the mobile batches', r.rowDisplay === 'block', r.rowDisplay);
        check(width + 'px: cells still name their column in card mode', /Units/.test(r.firstCellLabel), r.firstCellLabel);
        check(width + 'px: the totals row keeps its labels too', r.footLabelled);
        // The two regressions this page has already had once, asserted rather than assumed
        // fixed: prose card labels rendered in the figures' monospace, and a totals card
        // laid out narrower than the holding cards above it.
        check(width + 'px: card labels are PROSE in Inter, not the cells figures monospace',
          /Inter/.test(r.numericCellLabelFamily) && !/JetBrains/.test(r.numericCellLabelFamily),
          r.numericCellLabelFamily);
        check(width + 'px: the totals card spans the same width as a holding card',
          r.footW === r.rowW, r.footW + ' vs ' + r.rowW);
        check(width + 'px: no blank cell is drawn as an empty bordered strip', r.emptyVisible === 0, r.emptyVisible);
        // The panel is a sibling table, so it has to earn all of that independently.
        check(width + 'px: panel rows switch to the card layout too', r.closedRowDisplay === 'block', r.closedRowDisplay);
        check(width + 'px: panel cells name their column', /Units sold/.test(r.closedCellLabel), r.closedCellLabel);
        check(width + 'px: the panel totals row keeps its labels', r.closedFootLabelled);
        check(width + 'px: the panel totals card matches its own rows width',
          r.closedFootW === r.closedRowW, r.closedFootW + ' vs ' + r.closedRowW);
      }

      if (SHOT_DIR) {
        // Framed from the summary cards down through the table, so the comparison the eye
        // needs to make — table labels against the page around them — is in one image.
        // Frame ON the table, with whatever page content sits directly above it still in
        // shot — the comparison being made is table labels against surrounding page text,
        // so a screenshot of the cards alone would prove nothing.
        await cdp.evaluate("(() => { const m = document.querySelector('main');"
          + " const t = document.getElementById('return-table-body').closest('table');"
          + " const card = t.closest('div.bg-white') || t;"
          + " m.scrollTop = Math.max(0, card.offsetTop - 140); return true; })()");
        await sleep(400);
        const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        if (png && png.result && png.result.data) {
          writeFileSync(join(SHOT_DIR, 'returns-table-' + width + '.png'), Buffer.from(png.result.data, 'base64'));
        }
      }
    }

    // ===================================================================================
    console.log('\n=== MOBILE — the empty state, at the narrowest real width ===\n');
    await admin.from('transactions').delete().eq('client_id', clientId).eq('type', 'SELL');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.navigate', { url: BASE + '/asset-performance.html' });
    for (let i = 0; i < 60; i++) {
      const done = await cdp.evaluate(
        "(() => { const r = document.getElementById('closed-positions-region');" +
        " return !!r && r.innerHTML.length > 0 && r.innerHTML.indexOf('animate-pulse') === -1; })()"
      );
      if (done) break;
      await sleep(500);
    }
    const e = await cdp.evaluate(`(() => {
      const region = document.getElementById('closed-positions-region');
      const copy = region.querySelector('.rt-empty-copy');
      return {
        realW: window.innerWidth,
        hasTable: !!region.querySelector('table'),
        copyVisible: !!copy && getComputedStyle(copy).display !== 'none',
        copyRight: copy ? Math.round(copy.getBoundingClientRect().right) : 0,
        bodyScrollW: document.body.scrollWidth,
        card: (document.getElementById('perf-realised-amount') || {}).textContent,
        sub: (document.getElementById('perf-realised-sub') || {}).textContent
      };
    })()`);
    check('320px: viewport is genuinely 320px', e.realW === 320, 'got ' + e.realW);
    check('320px: the empty state shows no table at all', !e.hasTable);
    check('320px: the empty-state copy is visible and inside the viewport',
      e.copyVisible && e.copyRight <= e.realW + 1, e.copyRight + ' vs ' + e.realW);
    check('320px: the empty state introduces no horizontal overflow',
      e.bodyScrollW <= e.realW + 1, e.bodyScrollW + ' vs ' + e.realW);
    check('320px: the Realised gains card reads a plain $0', e.card === '$0', e.card);
    check('320px: its sub-line explains the zero', /No positions sold yet/.test(e.sub || ''), e.sub);

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log(fail ? 'RETURNS DISPLAY VISUAL: FAIL' : 'RETURNS DISPLAY VISUAL: PASS');
    if (fail) process.exit(1);
  } finally {
    if (cdp) cdp.close();
    if (clientId) {
      await admin.from('transactions').delete().eq('client_id', clientId);
      await admin.from('holdings').delete().eq('client_id', clientId);
      await admin.from('account_state').delete().eq('client_id', clientId);
      await admin.from('clients').delete().eq('id', clientId);
      const { error } = await admin.auth.admin.deleteUser(clientId);
      if (error) console.error('CLEANUP: could not delete ' + clientId + ': ' + error.message);
      else console.log('cleanup: test account removed');
    }
  }
}

// Two full Chrome spawns for contrast plus four real viewport navigations —
// legitimately longer than the shared 90s default.
runVerifyMain(main, { watchdogMs: 900000 });
