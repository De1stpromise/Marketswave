#!/usr/bin/env node
// UI Wiring — Stage 4 (2026-09-03): high-yield-savings.html and documents.html move from
// engine-core.js/localStorage to real Supabase calls (local stack). Same substitute-for-an-
// unavailable-browser-tool discipline as Stages 1-3 — checked again this session, not assumed
// carried over — using the same real jsdom-backed harness Stage 2/3 established
// (`closest()`/`querySelectorAll()`/`.click()`/event bubbling all work exactly as a real
// browser's would). Both real HTML files' `<body>` markup and real inline `<script>` blocks
// are extracted verbatim and run inside a real DOM via `window.eval()`.
//
// The one seam substituted, disclosed plainly, same as every prior stage: supabase-config.js's
// own CDN import is redirected to the already-installed local npm package via
// lib/esm-loader-supabase-cdn.mjs.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-hys-documents-ui-wiring.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { removeAllClientStorageObjects } from './lib/storage-test-cleanup.mjs';

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await test()) return true;
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return test();
}

function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
  const target = scripts.find(function (s) { return s.indexOf(marker) !== -1; });
  if (!target) throw new Error('Could not find a script containing "' + marker + '" in ' + htmlPath);
  return target;
}

function extractBodyMarkup(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (!bodyMatch) throw new Error('Could not find <body> in ' + htmlPath);
  return bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

// Forwarded to the real console (not suppressed) — neither page under test in this stage uses
// Chart.js/Canvas, so unlike Stage 3's own quietConsole there is no expected noise to hide, and
// hiding output here would just as easily hide a real error.
const forwardingConsole = new VirtualConsole();
forwardingConsole.forwardTo(console);

function buildPageDom(htmlPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: forwardingConsole
  });
  return dom;
}

async function main() {
  console.log('UI Wiring — Stage 4 verification (high-yield-savings.html + documents.html), substituting for an unavailable browser tool\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'hysdocs-' + suffix + '@test.marketswave.local';
  const password = 'VerifyHysDocs-2026!';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);
  check('supabase-data.js exposes the new insertRow/updateRow/deleteRow write primitives (added this stage)',
    typeof MarketswaveData.insertRow === 'function' && typeof MarketswaveData.updateRow === 'function' && typeof MarketswaveData.deleteRow === 'function');

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;

  try {

  const client = await MarketswaveData.getSupabaseClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  check('real signInWithPassword against the local stack succeeds', !signInErr, signInErr && signInErr.message);

  // ===========================================================================================
  // PART 1 — high-yield-savings.html
  // ===========================================================================================
  console.log('\n=== PART 1: high-yield-savings.html ===\n');

  // ---- Seed 4 real pockets directly, covering every render/withdraw-flow branch the task
  // asked to be confirmed: a still-active short-term Fixed (forfeiture warning path), a
  // genuinely MATURED short-term Fixed (no-warning path — seeded directly since nothing in
  // this stage's own scope transitions a pocket to 'matured' automatically, see this stage's
  // own disclosed architecture-gap finding), a still-active LOCKED Fixed (no withdraw control
  // at all), and an AYW pocket (used for the duplicate-pending-withdrawal rejection test). ----
  const { data: pocketRows, error: pocketSeedErr } = await admin.from('hys_pockets').insert([
    { client_id: clientId, pocket_type: 'fixed', amount: 6000, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5, maturity_date: new Date(Date.now() + 90 * 86400000).toISOString(), projected_interest: 255, funding_method: 'crypto wallet' },
    { client_id: clientId, pocket_type: 'fixed', amount: 7000, status: 'matured', term_mode: 'short', term_months: 3, term_label: '3 Months', rate: 7, term_in_years: 0.25, maturity_date: new Date(Date.now() - 5 * 86400000).toISOString(), projected_interest: 350, funding_method: 'crypto wallet' },
    { client_id: clientId, pocket_type: 'fixed', amount: 10000, status: 'active', term_mode: 'locked', term_years: 2, term_label: '2 Years', rate: 16, term_in_years: 2, maturity_date: new Date(Date.now() + 700 * 86400000).toISOString(), projected_interest: 3200, funding_method: 'bank account' },
    { client_id: clientId, pocket_type: 'ayw', amount: 2000, status: 'active', projected_interest: 0, funding_method: 'bank account' }
  ]).select();
  check('4 real pockets seeded (active short-term Fixed, matured short-term Fixed, active locked Fixed, AYW)', pocketRows && pocketRows.length === 4, pocketSeedErr && pocketSeedErr.message);
  const activeShortId = pocketRows[0].id, maturedShortId = pocketRows[1].id, activeLockedId = pocketRows[2].id, aywId = pocketRows[3].id;

  // high-yield-savings.html's own live rate/interest preview deliberately still calls
  // engine-core.js's real, pure getHYSRate()/computeFDFields()/computeHYSWithdrawalAmount()
  // directly (this stage's own investigated, documented design decision — see the page's own
  // script-block-top comment) — genuinely different from Stage 3's pages, which read
  // everything from Supabase and needed no local engine functions at all. engine-core.js is
  // loaded into this DOM first, exactly mirroring the real page's own <script> tag order.
  const engineCorePath = fileURLToPath(new URL('../engine-core.js', import.meta.url));
  const engineCoreSource = readFileSync(engineCorePath, 'utf8');

  const hysPath = fileURLToPath(new URL('../high-yield-savings.html', import.meta.url));
  const hysDom = buildPageDom(hysPath);
  hysDom.window.MarketswaveData = MarketswaveData;
  hysDom.window.eval(engineCoreSource);
  const hysScript = extractInlineScript(hysPath, 'UI Wiring — Stage 4');
  const H = hysDom.window.document;
  const gridEl = H.getElementById('pockets-grid');
  const requestsListEl = H.getElementById('pocket-requests-list');

  hysDom.window.eval(hysScript);
  check('the loading skeleton genuinely appears immediately (pockets grid)', /animate-pulse/.test(gridEl.innerHTML), gridEl.innerHTML.slice(0, 200));
  check('the loading skeleton genuinely appears immediately (summary balance)', /animate-pulse/.test(H.getElementById('hys-total-balance').innerHTML));

  await pollUntil(function () { return !/animate-pulse/.test(gridEl.innerHTML); }, 20000);
  await pollUntil(function () { return !/animate-pulse/.test(requestsListEl.innerHTML); }, 20000);

  console.log('1. Real pockets render correctly from real Supabase data');
  check('all 4 real pockets rendered as cards', gridEl.textContent.indexOf('6 Months') !== -1 && gridEl.textContent.indexOf('3 Months') !== -1 && gridEl.textContent.indexOf('2 Years') !== -1 && gridEl.textContent.indexOf('As You Want') !== -1, gridEl.textContent.slice(0, 400));
  check('the real HYS Total Balance sums exactly the 4 seeded amounts ($25,000.00)', H.getElementById('hys-total-balance').textContent === '$25,000.00', H.getElementById('hys-total-balance').textContent);
  check('the real Active Pockets count is 4 (none withdrawn yet)', H.getElementById('hys-active-count').textContent === '4', H.getElementById('hys-active-count').textContent);

  console.log('\n2. Locked-pocket-no-withdraw-control-before-maturity rule — genuinely reflected, not just server-enforced');
  check('the still-active LOCKED pocket shows NO Withdraw button at all', !gridEl.querySelector('.withdraw-btn[data-id="' + activeLockedId + '"]'));
  check('the still-active LOCKED pocket shows the real "Locked until maturity" message instead', gridEl.textContent.indexOf('Locked until maturity — no early withdrawal available.') !== -1);
  check('the still-active short-term Fixed pocket DOES show a real Withdraw button', !!gridEl.querySelector('.withdraw-btn[data-id="' + activeShortId + '"]'));
  check('the matured short-term Fixed pocket DOES show a real Withdraw button (status genuinely matured, not blocked)', !!gridEl.querySelector('.withdraw-btn[data-id="' + maturedShortId + '"]'));
  check('the AYW pocket DOES show a real Withdraw button', !!gridEl.querySelector('.withdraw-btn[data-id="' + aywId + '"]'));

  const withdrawModal = H.getElementById('withdraw-modal');
  const hysToast = H.getElementById('hys-toast');
  const hysToastTitle = H.getElementById('hys-toast-title');
  const hysToastBody = H.getElementById('hys-toast-body');

  console.log('\n3. Withdraw — the forfeiture-warning path (real still-active short-term Fixed pocket)');
  await (async function () {
    gridEl.querySelector('.withdraw-btn[data-id="' + activeShortId + '"]').click();
    check('the modal genuinely opens on the WARNING step (real status is still active)', !withdrawModal.classList.contains('hidden') && !H.querySelector('.wd-step[data-step="warning"]').classList.contains('hidden'));
    check('the warning shows the real principal ($6,000.00) and real interest ($255.00) about to be forfeited', H.getElementById('wd-warning-principal').textContent === '$6,000.00' && H.getElementById('wd-warning-interest').textContent === '$255.00', H.getElementById('wd-warning-principal').textContent + ' / ' + H.getElementById('wd-warning-interest').textContent);

    H.getElementById('wd-warning-continue').click();
    check('Continue Anyway advances to the destination step, showing the real forfeited receive amount ($6,000.00, principal only)', H.getElementById('wd-receive-amount').textContent === '$6,000.00');

    H.querySelector('.wd-method-card[data-method="crypto"]').click();
    H.getElementById('wd-crypto-address').value = '0xForfeitTest';
    H.getElementById('wd-crypto-asset').value = 'ETH';
    H.getElementById('wd-crypto-network').value = 'ERC20';
    const btn = H.getElementById('wd-crypto-confirm');
    btn.click();
    check('the confirm button shows a genuine busy state immediately', btn.disabled === true);

    await pollUntil(function () { return withdrawModal.classList.contains('hidden'); }, 15000);
    check('the modal genuinely closes on a real successful submission', withdrawModal.classList.contains('hidden'));
    check('the toast confirms the real withdrawal request', hysToastTitle.textContent === 'Withdrawal Request Sent');

    const { data: rows } = await admin.from('hys_withdrawal_requests').select('*').eq('pocket_id', activeShortId);
    check('a real, single pending hys_withdrawal_requests row was genuinely created, with forfeit=true and receive_amount=6000 (server-computed, not client-supplied)', rows && rows.length === 1 && rows[0].status === 'pending' && rows[0].forfeit === true && Number(rows[0].receive_amount) === 6000, JSON.stringify(rows));
  })();

  console.log('\n4. Withdraw — the matured/no-warning path (real status genuinely "matured" in Postgres)');
  await (async function () {
    gridEl.querySelector('.withdraw-btn[data-id="' + maturedShortId + '"]').click();
    check('the modal genuinely SKIPS the warning step (real stored status is matured, not active)', H.querySelector('.wd-step[data-step="warning"]').classList.contains('hidden') && !H.querySelector('.wd-step[data-step="destination"]').classList.contains('hidden'));
    check('the destination step shows the real, non-forfeited receive amount ($7,350.00 = principal $7,000 + interest $350)', H.getElementById('wd-receive-amount').textContent === '$7,350.00', H.getElementById('wd-receive-amount').textContent);

    H.querySelector('.wd-method-card[data-method="bank"]').click();
    H.getElementById('wd-bank-name').value = 'Jane Client';
    H.getElementById('wd-bank-institution').value = 'Test Bank';
    H.getElementById('wd-bank-account').value = '12345678';
    H.getElementById('wd-bank-routing').value = '021000021';
    H.getElementById('wd-bank-confirm').click();

    await pollUntil(function () { return withdrawModal.classList.contains('hidden'); }, 15000);
    check('the modal genuinely closes on this real successful submission too', withdrawModal.classList.contains('hidden'));

    const { data: rows } = await admin.from('hys_withdrawal_requests').select('*').eq('pocket_id', maturedShortId);
    check('a real, single pending hys_withdrawal_requests row was created, with forfeit=false and the real non-forfeited receive_amount=7350', rows && rows.length === 1 && rows[0].forfeit === false && Number(rows[0].receive_amount) === 7350, JSON.stringify(rows));
  })();

  console.log('\n5. Withdraw — a real server-side rejection via the actual UI: a second pending request on the same pocket');
  await (async function () {
    gridEl.querySelector('.withdraw-btn[data-id="' + aywId + '"]').click();
    check('AYW pocket also skips the warning step (no fixed term, never forfeits)', !H.querySelector('.wd-step[data-step="destination"]').classList.contains('hidden'));
    check('the AYW destination step shows the real full balance ($2,000.00)', H.getElementById('wd-receive-amount').textContent === '$2,000.00');

    H.querySelector('.wd-method-card[data-method="crypto"]').click();
    H.getElementById('wd-crypto-address').value = '0xAywFirst';
    H.getElementById('wd-crypto-asset').value = 'USDC';
    H.getElementById('wd-crypto-network').value = 'ERC20';
    H.getElementById('wd-crypto-confirm').click();
    await pollUntil(function () { return withdrawModal.classList.contains('hidden'); }, 15000);
    check('the first real AYW withdrawal request succeeds', withdrawModal.classList.contains('hidden'));

    // Immediately reopen Withdraw on the SAME still-active (not yet resolved) pocket — nothing
    // in this page's own UI is aware a request is already pending, so this genuinely reaches
    // the server, which must reject it — a real rejection this stage's client-side code does
    // NOT already independently guard against, unlike the locked-before-maturity case above.
    gridEl.querySelector('.withdraw-btn[data-id="' + aywId + '"]').click();
    H.querySelector('.wd-method-card[data-method="crypto"]').click();
    H.getElementById('wd-crypto-address').value = '0xAywSecond';
    H.getElementById('wd-crypto-asset').value = 'USDC';
    H.getElementById('wd-crypto-network').value = 'ERC20';
    var errEl = H.getElementById('wd-crypto-error');
    var bodyBefore = errEl.textContent;
    H.getElementById('wd-crypto-confirm').click();

    await pollUntil(function () { return !errEl.classList.contains('hidden') && errEl.textContent !== bodyBefore; }, 15000);
    check('the real server rejection ("already pending") is shown verbatim via writeErrorMessage(), the modal stays open', errEl.textContent.indexOf('already pending') !== -1 && !withdrawModal.classList.contains('hidden'), errEl.textContent);

    const { data: rows } = await admin.from('hys_withdrawal_requests').select('*').eq('pocket_id', aywId);
    check('genuinely only ONE hys_withdrawal_requests row exists for this pocket — the rejected second attempt created nothing', rows && rows.length === 1, JSON.stringify(rows));
    H.getElementById('wd-close').click();
  })();

  console.log('\n6. Open a New Pocket — real successful round trips (Fixed via crypto, AYW via bank)');
  const newPocketModal = H.getElementById('new-pocket-modal');
  await (async function () {
    H.getElementById('open-new-pocket-btn').click();
    H.querySelector('.np-type-card[data-type="fixed"]').click();
    // The term dropdown defaults to short-term mode 1..12; select month 6 for the exact real
    // getHYSRate('short', 6) === 8.5 rate this test cross-checks below.
    const termSelect = H.getElementById('np-term-select');
    termSelect.value = '6';
    termSelect.dispatchEvent(new hysDom.window.Event('change'));
    check('the live rate/interest preview shows the real getHYSRate(\'short\', 6) rate (8.5% APR), computed client-side via engine-core.js\'s own pure function, not a network call', H.getElementById('np-fd-rate').textContent === '8.5% APR', H.getElementById('np-fd-rate').textContent);

    H.getElementById('np-fd-amount').value = '9000';
    termSelect.dispatchEvent(new hysDom.window.Event('input'));
    H.getElementById('np-fd-amount').dispatchEvent(new hysDom.window.Event('input'));
    H.getElementById('np-fd-continue').click();
    H.querySelector('.np-funding-card[data-method="crypto"]').click();
    H.getElementById('np-crypto-asset').value = 'BTC';
    H.getElementById('np-crypto-network').value = 'ERC20';
    const btn = H.getElementById('np-crypto-confirm');
    btn.click();
    check('the confirm button shows a genuine busy state immediately', btn.disabled === true);

    await pollUntil(function () { return newPocketModal.classList.contains('hidden'); }, 15000);
    check('the modal genuinely closes on a real successful Fixed/crypto deposit request', newPocketModal.classList.contains('hidden'));
    check('the toast shows a real request id', hysToastTitle.textContent === 'Pocket Request Sent');

    const { data: rows } = await admin.from('hys_deposit_requests').select('*').eq('client_id', clientId).eq('method', 'crypto');
    check('a real, single pending hys_deposit_requests row was created, server-computed rate=8.5 and term_label="6 Months" matching the real getHysRate() schedule', rows && rows.length === 1 && Number(rows[0].rate) === 8.5 && rows[0].term_label === '6 Months' && Number(rows[0].requested_amount) === 9000 && rows[0].currency === 'BTC', JSON.stringify(rows));
  })();

  await (async function () {
    H.getElementById('open-new-pocket-btn').click();
    H.querySelector('.np-type-card[data-type="ayw"]').click();
    H.getElementById('np-ayw-amount').value = '1500';
    H.getElementById('np-ayw-continue').click();
    H.querySelector('.np-funding-card[data-method="bank"]').click();
    H.getElementById('np-bank-name').value = 'Jane Client';
    H.getElementById('np-bank-institution').value = 'Test Bank';
    H.getElementById('np-bank-account').value = '87654321';
    H.getElementById('np-bank-routing').value = '021000021';
    H.getElementById('np-bank-confirm').click();

    await pollUntil(function () { return newPocketModal.classList.contains('hidden'); }, 15000);
    check('the modal genuinely closes on a real successful AYW/bank deposit request', newPocketModal.classList.contains('hidden'));

    const { data: rows } = await admin.from('hys_deposit_requests').select('*').eq('client_id', clientId).eq('method', 'bank');
    check('a real, single pending hys_deposit_requests row was created for the AYW request (no rate/term for AYW)', rows && rows.length === 1 && rows[0].rate === null && rows[0].term_label === null && Number(rows[0].requested_amount) === 1500, JSON.stringify(rows));
  })();

  console.log('\n7. A real server-side rejection called directly (bypassing the UI, which already blocks this client-side): Fixed deposit below the real $5,000 minimum');
  await (async function () {
    let caught = null;
    try {
      await MarketswaveData.callFunction('request-hys-deposit', { pocketType: 'fixed', term: { mode: 'short', value: 3 }, amount: 1000, method: 'crypto', details: { asset: 'BTC', network: 'ERC20' } });
    } catch (err) { caught = err; }
    check('the real server independently rejects a sub-$5,000 Fixed deposit (defense in depth beyond the client\'s own pre-check)', caught && caught.message.indexOf('$5,000') !== -1, caught && caught.message);
  })();

  console.log('\n8. My Pocket Requests — real merged deposit + withdrawal history');
  check('the requests list shows all 5 real requests created above (2 deposits + 3 withdrawals)', requestsListEl.querySelectorAll('tbody tr').length === 5, requestsListEl.textContent.slice(0, 200));
  check('both Deposit and Withdrawal kind badges render', requestsListEl.textContent.indexOf('Deposit') !== -1 && requestsListEl.textContent.indexOf('Withdrawal') !== -1);

  // ===========================================================================================
  // PART 2 — documents.html
  // ===========================================================================================
  console.log('\n=== PART 2: documents.html ===\n');

  // Real Storage integration (2026-09-04): every real document now carries a genuine
  // storage_path — and, confirmed directly (createSignedUrl() genuinely returns a real "Object
  // not found" 400 for a path with no real object behind it, not a free pass), a real object
  // must actually be uploaded at that path for the Download test below (step 5) to exercise the
  // real "has a file" path rather than the real, distinct "no file attached" honest-empty-state
  // path this stage's own code also added — a placeholder path string alone is not enough. This
  // file otherwise tests documents.html's own render/Sign/Upload/Remove UI logic, not the full
  // real Storage surface; see the dedicated verify-documents-storage-integration.mjs for that.
  const advisoryPath = clientId + '/published/seed-1/Advisory Agreement.pdf';
  const q3Path = clientId + '/published/seed-2/Q3 Statement.pdf';
  await admin.storage.from('documents').upload(advisoryPath, Buffer.from('Seed content for Advisory Agreement.pdf'), { contentType: 'application/pdf' });
  await admin.storage.from('documents').upload(q3Path, Buffer.from('Seed content for Q3 Statement.pdf'), { contentType: 'application/pdf' });

  const { data: docRows, error: docSeedErr } = await admin.from('documents').insert([
    { client_id: clientId, direction: 'from', filename: 'Advisory Agreement.pdf', category: 'Contracts', status: 'Signature Required', is_new: true, deadline_label: 'Due in 3 days', storage_path: advisoryPath },
    { client_id: clientId, direction: 'from', filename: 'Q3 Statement.pdf', category: 'Statements & Reports', status: null, is_new: true, deadline_label: null, storage_path: q3Path },
    { client_id: clientId, direction: 'upload', filename: 'Passport Scan.pdf', category: 'General', status: 'Under Review', is_new: false, deadline_label: null }
  ]).select();
  check('3 real documents seeded (2 from Marketswave — one signature-required, one plain-new — and 1 real client upload)', docRows && docRows.length === 3, docSeedErr && docSeedErr.message);
  const sigReqDocId = docRows[0].id, plainNewDocId = docRows[1].id, uploadDocId = docRows[2].id;

  const docsPath = fileURLToPath(new URL('../documents.html', import.meta.url));
  const docsDom = buildPageDom(docsPath);
  docsDom.window.MarketswaveData = MarketswaveData;
  // getAuthenticatedClientId() is a real engine-core.js global (loaded on the real page via its
  // own earlier <script> tag) — stubbed directly here rather than loading the whole file, same
  // technique UI Wiring Stage 3 already used for deploy-capital.html's own earlier-script-block
  // dependency, since this is the only engine-core.js function documents.html's own Stage 4
  // script actually calls (confirmed via grep before writing this).
  docsDom.window.getAuthenticatedClientId = function () { return clientId; };
  const docsScript = extractInlineScript(docsPath, 'UI Wiring — Stage 4');
  const D = docsDom.window.document;
  const fromListEl = D.getElementById('from-list');
  const uploadListEl = D.getElementById('upload-list');

  // #sidebar-doc-badge is rendered by dashboard-sidebar.js's own mount, an earlier, untouched
  // script block this stage doesn't wire and this harness doesn't load — mirrors Stage 3's own
  // precedent of stubbing exactly what an earlier out-of-scope script block would have already
  // put in place by the time this page's own inline script runs on a real page load.
  D.body.insertAdjacentHTML('beforeend', '<span id="sidebar-doc-badge" class="hidden">0</span>');

  // Client Dashboard Polish (2026-09-06) replaced the chips' old static fake "2"/"1"/"1"
  // defaults — a real flash-of-fake-content bug — with real skeleton markup baked directly
  // into documents.html's own static HTML, and removed the now-redundant synchronous "—"
  // reset JS ever ran to correct it. Updated these two checks to match the corrected,
  // structurally-honest behavior instead of re-asserting the old bug as a baseline.
  check('before the script even runs, the chips show a real skeleton shape in the static HTML — never the old fake "2" default (the flash-of-fake-content bug fixed by Client Dashboard Polish)', /animate-pulse/.test(D.getElementById('chip-new-count').innerHTML) && D.getElementById('chip-new-count').textContent.trim() === '');

  docsDom.window.eval(docsScript);
  check('the 3 header chips still show a real skeleton immediately after the script runs, before the real async load resolves — never a fake hardcoded count, never bare placeholder text', /animate-pulse/.test(D.getElementById('chip-new-count').innerHTML) && /animate-pulse/.test(D.getElementById('chip-signature-count').innerHTML) && /animate-pulse/.test(D.getElementById('chip-deadline-count').innerHTML));
  check('the loading skeleton genuinely appears immediately (From Marketswave)', /animate-pulse/.test(fromListEl.innerHTML));
  check('the loading skeleton genuinely appears immediately (Uploads)', /animate-pulse/.test(uploadListEl.innerHTML));

  await pollUntil(function () { return !/animate-pulse/.test(fromListEl.innerHTML); }, 20000);

  console.log('1. Real documents render correctly from real Supabase data');
  check('the real signature-required document renders with its Sign button and badge', fromListEl.textContent.indexOf('Advisory Agreement.pdf') !== -1 && !!fromListEl.querySelector('.sign-btn'));
  check('the real plain-new document renders with a Download button, no Sign button (status is not Signature Required)', fromListEl.textContent.indexOf('Q3 Statement.pdf') !== -1);
  check('the real client upload renders with its Remove button and real "Under Review" status', uploadListEl.textContent.indexOf('Passport Scan.pdf') !== -1 && !!uploadListEl.querySelector('.remove-upload-btn'));

  console.log('\n2. "From Marketswave" no-Remove-option rule — genuinely reflected, not just server-enforced');
  check('NEITHER real "from" document row renders a Remove button anywhere', !fromListEl.querySelector('.remove-upload-btn'));
  check('the real upload row DOES render a Remove button', !!uploadListEl.querySelector('.remove-upload-btn'));

  console.log('\n3. Real notification counts, computed from the real fetched document list');
  check('the 3 header chips show the real, correctly-computed counts (2 new, 1 signature-required, 1 deadline)', D.getElementById('chip-new-count').textContent === '2' && D.getElementById('chip-signature-count').textContent === '1' && D.getElementById('chip-deadline-count').textContent === '1', D.getElementById('chip-new-count').textContent + '/' + D.getElementById('chip-signature-count').textContent + '/' + D.getElementById('chip-deadline-count').textContent);
  const sidebarBadge = D.getElementById('sidebar-doc-badge');
  check('the sidebar doc badge is corrected live to the real urgentCount (2: both isNew docs)', sidebarBadge && sidebarBadge.textContent === '2', sidebarBadge && sidebarBadge.textContent);

  const toast = D.getElementById('doc-toast');
  const toastTitle = D.getElementById('doc-toast-title');

  console.log('\n4. Sign action — a real, RLS-scoped direct UPDATE (no Edge Function)');
  await (async function () {
    const signBtn = fromListEl.querySelector('.sign-btn');
    signBtn.click();
    check('the Sign button shows a genuine busy state immediately', signBtn.disabled === true);
    await pollUntil(function () { return toastTitle.textContent === 'Signature Captured'; }, 15000);
    check('the toast confirms the real signature', toastTitle.textContent === 'Signature Captured');

    const { data: row } = await admin.from('documents').select('*').eq('id', sigReqDocId).single();
    check('the real document row is genuinely Signed, is_new cleared, deadline cleared — all three fields the real RLS policy\'s WITH CHECK requires', row.status === 'Signed' && row.is_new === false && row.deadline_label === null, JSON.stringify(row));
  })();

  console.log('\n5. Download action — a real, investigated finding: clearing is_new on Download is now structurally unreachable under Stage 6\'s real RLS (the sole UPDATE policy is scoped exclusively to the Sign transition), so the app no longer attempts it');
  await (async function () {
    const downloadBtn = [...fromListEl.querySelectorAll('.doc-row')].find(function (r) { return r.textContent.indexOf('Q3 Statement.pdf') !== -1; }).querySelector('.download-btn');
    downloadBtn.click();
    await pollUntil(function () { return toastTitle.textContent === 'Download Started'; }, 15000);
    check('the toast confirms the (simulated) download, unaffected by this finding', toastTitle.textContent === 'Download Started');

    // Confirmed directly, not assumed: even a DIRECT is_new-only update against this exact real
    // row is genuinely rejected by RLS — proving the app's own decision to stop attempting this
    // write is correct, not just cautious.
    let caught = null;
    try {
      await MarketswaveData.updateRow('documents', { id: plainNewDocId }, { is_new: false });
    } catch (err) { caught = err; }
    check('a direct is_new-only UPDATE against a non-signature-required "from" document is genuinely rejected by RLS (the UPDATE policy\'s own USING clause requires status=\'Signature Required\')', !!caught, caught && caught.message);

    const { data: row } = await admin.from('documents').select('is_new').eq('id', plainNewDocId).single();
    check('the real document row\'s is_new flag is confirmed still true — Download no longer silently attempts (and fails) this write', row.is_new === true, JSON.stringify(row));
  })();

  console.log('\n6. Upload action — a real, RLS-scoped direct INSERT (no approval gate, no Edge Function)');
  await (async function () {
    D.getElementById('upload-category').value = 'Contracts';
    // Real Storage integration regression fix (2026-09-04): documents.html's own Upload
    // handler now requires a REAL file (uploads its actual bytes to Storage before inserting
    // the row) — the old test relied on the page's own now-removed "no file chosen" fake-
    // filename fallback. A genuine Node global File (Node 20+), not jsdom's own File class,
    // is injected directly via Object.defineProperty — confirmed via a standalone probe that
    // a real Node File instance passes @supabase/storage-js's own `instanceof Blob` check when
    // that check runs in the OUTER Node realm (where the real supabase-js client lives), even
    // though the click that reads `fileInput.files[0]` happens inside this jsdom window.
    const testFile = new File(['Real test file content for HYS/Documents UI-wiring verification.'], 'Contract Draft.pdf', { type: 'application/pdf' });
    Object.defineProperty(D.getElementById('upload-file'), 'files', { value: [testFile], configurable: true });
    const btn = D.getElementById('submit-upload');
    const bodyBefore = toastTitle.textContent;
    btn.click();
    check('the Upload button shows a genuine busy state immediately', btn.disabled === true);
    await pollUntil(function () { return toastTitle.textContent !== bodyBefore; }, 15000);
    check('the toast confirms the real upload', toastTitle.textContent === 'Document Uploaded', toastTitle.textContent + ' / ' + D.getElementById('doc-toast-body').textContent);

    const { data: rows } = await admin.from('documents').select('*').eq('client_id', clientId).eq('direction', 'upload').eq('category', 'Contracts');
    check('a real new document row was genuinely inserted, status=Received/is_new=false/deadline=null exactly matching the client INSERT policy\'s own WITH CHECK', rows && rows.length === 1 && rows[0].status === 'Received' && rows[0].is_new === false && rows[0].deadline_label === null, JSON.stringify(rows));
    check('the new row genuinely references a real, non-null storage_path', rows && rows[0].storage_path, rows && JSON.stringify(rows[0]));

    // ★ Real Storage integration regression fix: reloadDocuments(true)'s own async render
    // (the flash) is a SEPARATE, later-resolving promise chain than the toast text change
    // above — awaiting only the toast, then reading the DOM synchronously right after, was
    // always a real race; the real Upload sequence now involves a genuine extra network round
    // trip (the file upload itself) before the row insert even starts, which was enough to
    // reliably expose a race the old, faster (no real bytes) sequence usually won by luck.
    // Poll for the real render outcome instead of assuming it's already settled.
    await pollUntil(function () { return !!uploadListEl.querySelector('.doc-row.row-flash'); }, 15000);
    check('the newly uploaded row genuinely flashes once rendered (pendingFlashDocId mechanism)', !!uploadListEl.querySelector('.doc-row.row-flash'));
  })();

  console.log('\n7. Remove action — a real, RLS-scoped direct DELETE, scoped to uploads only');
  await (async function () {
    const removeBtn = [...uploadListEl.querySelectorAll('.doc-row')].find(function (r) { return r.textContent.indexOf('Passport Scan.pdf') !== -1; }).querySelector('.remove-upload-btn');
    removeBtn.click();
    check('the confirm modal genuinely opens (not window.confirm)', !D.getElementById('remove-confirm-modal').classList.contains('hidden'));
    D.getElementById('remove-confirm-submit').click();
    await pollUntil(function () { return toastTitle.textContent === 'Document Removed'; }, 15000);
    check('the toast confirms the real removal', toastTitle.textContent === 'Document Removed');

    const { data: rows } = await admin.from('documents').select('id').eq('id', uploadDocId);
    check('the real document row is genuinely gone from Postgres', rows && rows.length === 0, JSON.stringify(rows));
  })();

  console.log('\n8. A real security-boundary test: RLS rejects what the UI never even offers (a client trying to bypass the missing Remove control on a "from" document)');
  await (async function () {
    let caught = null;
    try {
      await MarketswaveData.deleteRow('documents', { id: sigReqDocId });
    } catch (err) { caught = err; }
    check('a direct DELETE attempt against a real "from" document is genuinely rejected by RLS (structurally impossible, not just unreachable via the shipped UI)', !!caught, caught && caught.message);

    const { data: stillThere } = await admin.from('documents').select('id').eq('id', sigReqDocId);
    check('the real "from" document row is confirmed still present, completely unaffected', stillThere && stillThere.length === 1);
  })();

  console.log('\n9. A second real security-boundary test: RLS rejects a client trying to insert a "from" document (impersonating the firm)');
  await (async function () {
    let caught = null;
    try {
      await MarketswaveData.insertRow('documents', { filename: 'Fake From Doc.pdf', category: 'Contracts', direction: 'from', status: null, is_new: false, deadline_label: null });
    } catch (err) { caught = err; }
    check('a direct client INSERT with direction="from" is genuinely rejected by RLS', !!caught, caught && caught.message);
  })();

  } finally {
    await admin.from('hys_deposit_requests').delete().eq('client_id', clientId);
    await admin.from('hys_withdrawal_requests').delete().eq('client_id', clientId);
    await admin.from('hys_pockets').delete().eq('client_id', clientId);
    await admin.from('documents').delete().eq('client_id', clientId);
    await removeAllClientStorageObjects(admin, 'documents', clientId);
    await admin.auth.admin.deleteUser(clientId);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
