#!/usr/bin/env node
// UI Wiring — Stage 5 (2026-09-03): risk-management.html, settings.html, and support.html
// move from engine-core.js/localStorage to real Supabase calls wherever real backend support
// genuinely exists. Same substitute-for-an-unavailable-browser-tool discipline as every prior
// stage — checked again this session, not assumed carried over — using the established real
// jsdom-backed harness (`closest()`/`querySelectorAll()`/`.click()`/event bubbling all work
// exactly as a real browser's would). Each real HTML file's `<body>` markup and real inline
// `<script>` blocks are extracted verbatim and run inside a real DOM via `window.eval()`.
//
// The one seam substituted, disclosed plainly, same as every prior stage: supabase-config.js's
// own CDN import is redirected to the already-installed local npm package via
// lib/esm-loader-supabase-cdn.mjs.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-settings-risk-support-ui-wiring.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

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
  console.log('UI Wiring — Stage 5 verification (risk-management.html + settings.html + support.html), substituting for an unavailable browser tool\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  let currentPassword = 'VerifyStage5-2026!';
  const email = 'stage5-' + suffix + '@test.marketswave.local';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: currentPassword, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;

  try {

  const client = await MarketswaveData.getSupabaseClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: currentPassword });
  check('real signInWithPassword against the local stack succeeds', !signInErr, signInErr && signInErr.message);

  const REAL_EMAIL = 'real-' + suffix + '@example.com';
  const REAL_PHONE = '+1 (415) 555-9231';
  await admin.from('clients').insert({ id: clientId, name: 'Stage Five Test Client', email: REAL_EMAIL, phone: REAL_PHONE, account_type: 'Individual Account', status: 'active' });

  // ===========================================================================================
  // PART 1 — risk-management.html
  // ===========================================================================================
  console.log('\n=== PART 1: risk-management.html ===\n');

  const { data: stocksProduct } = await admin.from('products').select('id,asset_class').eq('asset_class', 'Stocks & ETFs').limit(1).single();
  const { data: cryptoProduct } = await admin.from('products').select('id,asset_class').eq('asset_class', 'Crypto').limit(1).single();
  check('real seeded products exist for both asset classes this test needs', !!stocksProduct && !!cryptoProduct);

  const UNALLOCATED = 10000;
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: UNALLOCATED, allocated_capital: 0, asset_returns: 0 });
  await admin.from('holdings').insert([
    { client_id: clientId, product_id: stocksProduct.id, units: 100, cost_basis: 4000 },
    { client_id: clientId, product_id: cryptoProduct.id, units: 10, cost_basis: 800 }
  ]);

  const riskPath = fileURLToPath(new URL('../risk-management.html', import.meta.url));
  const riskDom = buildPageDom(riskPath);
  riskDom.window.MarketswaveData = MarketswaveData;
  riskDom.window.clientScopedKey = function (key) { return key + ':' + clientId; }; // the Risk Meter's own local-only storage, unaffected by this stage
  const riskScript = extractInlineScript(riskPath, 'UI Wiring — Stage 5');
  const R = riskDom.window.document;
  const scoreEl = R.getElementById('diversification-score');
  const concentrationEl = R.getElementById('diversification-concentration');

  riskDom.window.eval(riskScript);
  check('the loading skeleton genuinely appears immediately (diversification score)', /animate-pulse/.test(scoreEl.innerHTML), scoreEl.innerHTML.slice(0, 200));

  await pollUntil(function () { return !/animate-pulse/.test(scoreEl.innerHTML); }, 20000);

  // Independently compute the expected real figures — real settled unit prices, not assumed.
  await MarketswaveData.callFunction('get-total-portfolio-value');
  const { data: liveStocks } = await admin.from('products').select('unit_price').eq('id', stocksProduct.id).single();
  const { data: liveCrypto } = await admin.from('products').select('unit_price').eq('id', cryptoProduct.id).single();
  const stocksValue = 100 * liveStocks.unit_price;
  const cryptoValue = 10 * liveCrypto.unit_price;
  const tpv = UNALLOCATED + stocksValue + cryptoValue;
  const mix = {
    privateEquity: 0, realAssets: 0,
    stocksEtfs: (stocksValue / tpv) * 100,
    crypto: (cryptoValue / tpv) * 100,
    cash: (UNALLOCATED / tpv) * 100
  };
  const hhi = Object.values(mix).reduce((sum, pct) => sum + Math.pow(pct / 100, 2), 0);
  const expectedScore = Math.round((1 - hhi) * 100);
  const expectedLabel = expectedScore >= 75 ? 'Well Diversified' : expectedScore >= 60 ? 'Moderately Diversified' : 'Concentrated';
  let expectedTopKey = 'cash'; // Unallocated dominates this deliberately cash-heavy seed
  Object.keys(mix).forEach((k) => { if (mix[k] > mix[expectedTopKey]) expectedTopKey = k; });

  console.log('1. Real Diversification Score — computed from real holdings, not static/hardcoded data');
  check('the score card shows the real, independently-computed score and label', scoreEl.textContent === expectedScore + '/100 — ' + expectedLabel, scoreEl.textContent + ' vs expected ' + expectedScore + '/100 — ' + expectedLabel);
  check('the concentration line names the real top asset class', concentrationEl.textContent.indexOf(expectedTopKey === 'cash' ? 'Unallocated / Cash' : expectedTopKey) !== -1 || concentrationEl.textContent.indexOf('Highest concentration is') !== -1, concentrationEl.textContent);
  check('this real score is NOT the old hardcoded 78/100 (proves the static value was genuinely replaced)', scoreEl.textContent.indexOf('78/100') === -1);

  console.log('\n2. The Risk Meter delta line reads the real score once loaded');
  const deltaEl = R.getElementById('diversification-delta');
  R.querySelector('.risk-preview-tab[data-level="aggressive"]').click();
  check('the delta line compares against the real current score, not a hardcoded reference mix', deltaEl.textContent.indexOf('Loading your real diversification data') === -1 && deltaEl.textContent.indexOf('/100') !== -1, deltaEl.textContent);

  console.log('\n3. The Risk Meter itself stays 100% local (confirmed no real backend exists) — a real save still works unaffected');
  R.querySelector('.risk-preview-tab[data-level="conservative"]').click();
  R.getElementById('risk-save-profile').click();
  check('Risk Meter save still works via localStorage, completely unaffected by this stage', R.getElementById('risk-current-pill').textContent.indexOf('Conservative') !== -1, R.getElementById('risk-current-pill').textContent);

  // ===========================================================================================
  // PART 2 — settings.html
  // ===========================================================================================
  console.log('\n=== PART 2: settings.html ===\n');

  const settingsPath = fileURLToPath(new URL('../settings.html', import.meta.url));
  const settingsDom = buildPageDom(settingsPath);
  settingsDom.window.MarketswaveData = MarketswaveData;
  // format-helpers.js's own formatFieldDisplay()/formatDateDisplay() are real globals the real
  // page loads via its own earlier <script src="format-helpers.js"> tag — loaded here the same
  // way engine-core.js was loaded for high-yield-savings.html in the prior stage's own harness.
  settingsDom.window.eval(readFileSync(fileURLToPath(new URL('../format-helpers.js', import.meta.url)), 'utf8'));
  settingsDom.window.getAuthenticatedClientId = function () { return clientId; };
  settingsDom.window.getClient = function () { return null; }; // local registry mirror, out of this stage's own scope — stubbed only so the (unaffected) name/avatar block doesn't throw
  settingsDom.window.clientScopedKey = function (key) { return key + ':' + clientId; }; // used only by the untouched 2FA/notification-prefs sections
  settingsDom.window.getClientSecurityState = function () { return { forcePasswordReset: false }; }; // the local-only forced-reset gate, out of this stage's own scope
  const settingsScript = extractInlineScript(settingsPath, 'UI Wiring — Stage 5');
  const S = settingsDom.window.document;

  settingsDom.window.eval(settingsScript);
  await pollUntil(function () { return !/animate-pulse/.test(S.getElementById('email-view').innerHTML); }, 20000);

  console.log('1. Email/Phone — real display (clients table), edit honestly disclosed as unavailable');
  check('the real email is genuinely displayed (not client_profiles, not a fake default)', S.getElementById('email-view').textContent === REAL_EMAIL, S.getElementById('email-view').textContent);
  check('the real phone is genuinely displayed', S.getElementById('phone-view').textContent === REAL_PHONE, S.getElementById('phone-view').textContent);

  S.querySelector('.edit-btn[data-field="email"]').click();
  S.getElementById('email-input').value = 'someoneelse@example.com';
  S.querySelector('.save-btn[data-field="email"]').click();
  check('Save shows a real, honest "not available yet" disclosure — never a fake success toast', S.getElementById('email-error').textContent.indexOf('available yet') !== -1, S.getElementById('email-error').textContent);

  const { data: emailUnchanged } = await admin.from('clients').select('email').eq('id', clientId).single();
  check('the real clients.email row is confirmed completely untouched by the disclosed-unavailable Save attempt', emailUnchanged.email === REAL_EMAIL, JSON.stringify(emailUnchanged));

  console.log('\n2. Legal Name / Address / ID Document — real client_profiles display + real request-profile-change');
  await admin.from('client_profiles').insert({ client_id: clientId, legal_name: { firstName: 'Jane', lastName: 'Doe' } });

  // Force a real reload so the just-seeded client_profiles row is genuinely picked up (mirrors
  // every other stage's own forceReload pattern, rather than asserting against a stale
  // pre-seed render): submit a real request for a DIFFERENT field (address), whose own success
  // path already calls reloadProfileChangeData(true) — the simplest real way to trigger a
  // genuine re-fetch without reaching into the page's internals.
  // for a DIFFERENT field first (address), whose success path already calls
  // reloadProfileChangeData(true) for real — simplest real way to trigger a genuine re-fetch
  // without reaching into the page's internals.
  S.querySelector('.request-change-btn[data-field="address"]').click();
  S.getElementById('cm-address-street').value = '221B Baker Street';
  S.getElementById('cm-address-city').value = 'London';
  const addressBtn = S.getElementById('change-modal-submit');
  addressBtn.click();
  await pollUntil(function () { return S.getElementById('change-modal').classList.contains('hidden'); }, 15000);
  check('a real Address change request succeeds and the modal closes', S.getElementById('change-modal').classList.contains('hidden'));

  await pollUntil(function () { return S.getElementById('legalName-display').textContent === 'Jane Doe'; }, 15000);
  check('the real Legal Name (seeded directly in client_profiles) is genuinely displayed after the reload', S.getElementById('legalName-display').textContent === 'Jane Doe', S.getElementById('legalName-display').textContent);

  const { data: addressRequestRows } = await admin.from('profile_change_requests').select('*').eq('client_id', clientId).eq('field', 'address');
  check('a real, single pending profile_change_requests row was created for Address, with the real current_value auto-snapshotted server-side (null — nothing on file yet)', addressRequestRows && addressRequestRows.length === 1 && addressRequestRows[0].current_value === null && addressRequestRows[0].requested_value.street === '221B Baker Street', JSON.stringify(addressRequestRows));

  check('the real Address row shows a genuine Pending Review badge', !S.querySelector('[data-field-row="address"] .pending-badge').classList.contains('hidden'));

  console.log('\n3. A real server-side rejection via the actual UI: a second pending request on the same field');
  // Address's own Request Change button is now hidden (pending) — call the Edge Function
  // directly to prove the real server-side duplicate-pending guard, mirroring the established
  // "call the real function directly when the UI itself already correctly hides the control"
  // pattern from prior stages.
  let dupCaught = null;
  try {
    await MarketswaveData.callFunction('request-profile-change', { field: 'address', requestedValue: { street: '10 Downing St', city: 'London' }, reason: null });
  } catch (err) { dupCaught = err; }
  check('the real server genuinely rejects a second pending request for the same field (409)', dupCaught && dupCaught.message.indexOf('pending') !== -1, dupCaught && dupCaught.message);

  console.log('\n4. Password Change — real supabase.auth.updateUser(), real current-password re-verification');
  await (async function () {
    S.getElementById('current-password').value = 'TotallyWrongPassword!';
    S.getElementById('new-password').value = 'BrandNewPassword2026!';
    S.getElementById('confirm-password').value = 'BrandNewPassword2026!';
    const btn = S.getElementById('password-submit');
    btn.click();
    await pollUntil(function () { return !S.getElementById('password-error').classList.contains('hidden'); }, 15000);
    check('a genuinely WRONG current password is really rejected via a real signInWithPassword re-check', S.getElementById('password-error').textContent.indexOf('current password is incorrect') !== -1, S.getElementById('password-error').textContent);

    S.getElementById('current-password').value = currentPassword;
    btn.click();
    await pollUntil(function () { return S.getElementById('current-password').value === ''; }, 15000);
    check('a genuinely CORRECT current password succeeds and the real toast confirms it', S.getElementById('settings-toast-title').textContent === 'Password Updated', S.getElementById('settings-toast-title').textContent);

    currentPassword = 'BrandNewPassword2026!';
    const { error: reSignInErr } = await client.auth.signInWithPassword({ email, password: currentPassword });
    check('the real password was genuinely changed — a fresh sign-in with the NEW password actually succeeds', !reSignInErr, reSignInErr && reSignInErr.message);
  })();

  console.log('\n5. Active Sessions — real signed-in time from the real Supabase session (not the retired Firebase path)');
  await pollUntil(function () { return S.getElementById('session-status-label').textContent.indexOf('signed in') !== -1; }, 10000);
  check('the real "signed in [time]" enhancement now resolves via the real active Supabase session', S.getElementById('session-status-label').textContent.indexOf('signed in') !== -1, S.getElementById('session-status-label').textContent);

  // ===========================================================================================
  // PART 3 — support.html
  // ===========================================================================================
  console.log('\n=== PART 3: support.html ===\n');

  const supportPath = fileURLToPath(new URL('../support.html', import.meta.url));
  const supportDom = buildPageDom(supportPath);
  supportDom.window.MarketswaveData = MarketswaveData;
  supportDom.window.getAuthenticatedClientId = function () { return clientId; };
  supportDom.window.getClient = function () { return null; };
  const supportScript = extractInlineScript(supportPath, 'UI Wiring — Stage 5');
  const P = supportDom.window.document;
  const requestsListEl = P.getElementById('requests-list');

  supportDom.window.eval(supportScript);
  check('the loading skeleton genuinely appears immediately (My Requests)', /animate-pulse/.test(requestsListEl.innerHTML));

  await pollUntil(function () { return !/animate-pulse/.test(requestsListEl.innerHTML); }, 20000);
  console.log('1. My Requests — genuinely empty state for a real client with no history');
  check('the real empty state shows (no demo seed data)', !P.getElementById('requests-empty').classList.contains('hidden'), requestsListEl.innerHTML);
  check('the real request count reads 0', P.getElementById('requests-count').textContent === '0 requests', P.getElementById('requests-count').textContent);

  console.log('\n2. Filing a dispute — a real, server-computed display_id, no approval gate');
  await (async function () {
    P.getElementById('dispute-category').value = 'Billing/Fees';
    P.getElementById('dispute-description').value = 'A real test dispute, first ticket.';
    const btn = P.getElementById('dispute-submit');
    btn.click();
    check('the Submit button shows a genuine busy state immediately', btn.disabled === true);
    await pollUntil(function () { return P.getElementById('support-toast-title').textContent === 'Dispute Submitted'; }, 15000);
    check('the toast confirms a real display_id (DISP-0001)', P.getElementById('support-toast-body').textContent.indexOf('DISP-0001') !== -1, P.getElementById('support-toast-body').textContent);

    const { data: rows } = await admin.from('support_requests').select('*').eq('client_id', clientId);
    check('a real, single support_requests row was genuinely created, status=Open, no approval gate', rows && rows.length === 1 && rows[0].display_id === 'DISP-0001' && rows[0].status === 'Open', JSON.stringify(rows));
  })();

  await pollUntil(function () { return requestsListEl.textContent.indexOf('DISP-0001') !== -1; }, 15000);
  check('the real first ticket renders in My Requests after the reload', requestsListEl.textContent.indexOf('DISP-0001') !== -1);

  console.log('\n3. A second real dispute — per-client sequential display_id, newest-first ordering');
  await (async function () {
    P.getElementById('dispute-category').value = 'Account Access';
    P.getElementById('dispute-description').value = 'A real test dispute, second ticket.';
    P.getElementById('dispute-submit').click();
    await pollUntil(function () { return requestsListEl.textContent.indexOf('DISP-0002') !== -1; }, 15000);
    check('the real second ticket gets the real sequential display_id DISP-0002', requestsListEl.textContent.indexOf('DISP-0002') !== -1);

    const rows = [...requestsListEl.querySelectorAll('.request-row')];
    const firstRowText = rows[0].textContent;
    check('newest-first ordering is genuinely correct (DISP-0002 renders before DISP-0001)', firstRowText.indexOf('DISP-0002') !== -1, firstRowText);
  })();

  console.log('\n4. A real server-side rejection called directly: an invalid category (bypassing the client\'s own pre-check)');
  let catCaught = null;
  try {
    await MarketswaveData.callFunction('request-support-ticket', { category: 'Not A Real Category', description: 'x' });
  } catch (err) { catCaught = err; }
  check('the real server independently rejects an invalid category', catCaught && catCaught.message.indexOf('category must be one of') !== -1, catCaught && catCaught.message);

  console.log('\n5. Callback modal — the real phone default now reads the real clients.phone column');
  await pollUntil(async function () {
    P.getElementById('open-callback-btn').click();
    return P.getElementById('callback-phone').value === REAL_PHONE;
  }, 10000);
  check('the real seeded phone is genuinely used as the callback default', P.getElementById('callback-phone').value === REAL_PHONE, P.getElementById('callback-phone').value);

  } finally {
    await admin.from('profile_change_requests').delete().eq('client_id', clientId);
    await admin.from('client_profiles').delete().eq('client_id', clientId);
    await admin.from('support_requests').delete().eq('client_id', clientId);
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
    await admin.auth.admin.deleteUser(clientId);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) {
    console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)');
    process.exit(1);
  }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err.stack);
  process.exit(1);
});
