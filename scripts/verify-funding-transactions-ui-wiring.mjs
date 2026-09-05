#!/usr/bin/env node
// UI Wiring — Stage 3 (2026-09-03): deploy-capital.html and transactions.html move from
// engine-core.js/localStorage to real Supabase calls (local stack). Same substitute-for-an-
// unavailable-browser-tool discipline as Stages 1-2 — checked again this session, not
// assumed carried over — using the same real jsdom-backed harness Stage 2 established
// (`closest()`/`querySelectorAll()`/`.click()`/event bubbling all work exactly as a real
// browser's would). Both real HTML files' `<body>` markup and real inline `<script>` blocks
// are extracted verbatim and run inside a real DOM via `window.eval()`.
//
// The one seam substituted, disclosed plainly, same as every prior stage:
// supabase-config.js's own CDN import is redirected to the already-installed local npm
// package via lib/esm-loader-supabase-cdn.mjs.
//
// A second, narrower substitution specific to this stage's own chart verification: Chart.js
// itself needs a real browser Canvas 2D context, which jsdom does not implement without the
// separate native `canvas` package (not installed, deliberately, to avoid a native-build
// dependency). A minimal FAKE `Chart` constructor is provided instead — it does not render
// any pixels (that's Chart.js's own concern, well outside this project's scope to test) — it
// only RECORDS the exact labels/datasets transactions.html's own real code passes to it, so
// this script can prove the real aggregation logic feeds the chart correct, real data,
// independently cross-checked against Postgres. `canvas.getContext('2d')` itself returns
// `null` under plain jsdom (confirmed directly, not assumed) rather than throwing, so this
// substitution is the only change needed to exercise that code path at all.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-funding-transactions-ui-wiring.mjs

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

// Silences jsdom's own "Not implemented: HTMLCanvasElement's getContext()" console noise —
// harmless (confirmed it returns null, not a throw) but not worth cluttering this script's
// own real assertion output with.
const quietConsole = new VirtualConsole();

function buildPageDom(htmlPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: quietConsole
  });
  return dom;
}

async function main() {
  console.log('UI Wiring — Stage 3 verification (deploy-capital.html + transactions.html), substituting for an unavailable browser tool\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'fundingtxn-' + suffix + '@test.marketswave.local';
  const password = 'VerifyFundingTxn-2026!';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;

  try {

  const { data: nordicFund } = await admin.from('products').select('id,name,unit_price').eq('name', 'Nordic Growth Fund').single();
  check('the real seeded product this test needs exists', !!nordicFund);

  const UNALLOCATED = 8432.10;
  await admin.from('account_state').insert({ client_id: clientId, unallocated_capital: UNALLOCATED, allocated_capital: 0, asset_returns: 0 });
  await admin.from('holdings').insert({ client_id: clientId, product_id: nordicFund.id, units: 10, cost_basis: 5000 });

  // Real transactions spanning 2 distinct months, one of each type this page must render
  // correctly (the task's own explicit DEPOSIT/WITHDRAWAL concern) — distinct, deliberately
  // chosen totalValues so summary sums/chart aggregation are unambiguous to cross-check.
  const now = new Date();
  const month1 = new Date(now.getFullYear(), now.getMonth() - 1, 10);
  const month2 = new Date(now.getFullYear(), now.getMonth(), 15);
  const { data: txnRows } = await admin.from('transactions').insert([
    { client_id: clientId, product_id: null, type: 'DEPOSIT', total_value: 3000, status: 'Completed', created_at: month1.toISOString() },
    { client_id: clientId, product_id: nordicFund.id, type: 'BUY', units: 10, price: 500, total_value: 5000, status: 'Completed', created_at: month1.toISOString() },
    { client_id: clientId, product_id: nordicFund.id, type: 'SELL', units: 2, price: 550, total_value: 1200, realized_return: 150, status: 'Completed', created_at: month2.toISOString() },
    { client_id: clientId, product_id: null, type: 'WITHDRAWAL', total_value: 800, status: 'Completed', created_at: month2.toISOString() }
  ]).select();
  check('4 real seeded transactions (DEPOSIT/BUY/SELL/WITHDRAWAL) created', txnRows && txnRows.length === 4, JSON.stringify(txnRows));

  const { data: rateRow } = await admin.from('advisory_fee_rate').select('rate').eq('id', true).single();
  const REAL_RATE = rateRow.rate;

  const client = await MarketswaveData.getSupabaseClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  check('real signInWithPassword against the local stack succeeds', !signInErr, signInErr && signInErr.message);

  // ===========================================================================================
  // PART 1 — deploy-capital.html
  // ===========================================================================================
  console.log('\n=== PART 1: deploy-capital.html ===\n');

  const deployPath = fileURLToPath(new URL('../deploy-capital.html', import.meta.url));
  const deployDom = buildPageDom(deployPath);
  deployDom.window.MarketswaveData = MarketswaveData;
  deployDom.window.getAuthenticatedClientId = function () { return clientId; }; // referenced by option-card wiring in an earlier, untouched script block on this page — not part of this stage's own scope, stubbed only so that block doesn't throw

  const deployScript = extractInlineScript(deployPath, 'UI Wiring — Stage 3');
  const fundingListEl = deployDom.window.document.getElementById('my-funding-requests-list');
  const D = deployDom.window.document;

  deployDom.window.eval(deployScript);
  check('the loading skeleton genuinely appears immediately (My Funding Requests)', /animate-pulse/.test(fundingListEl.innerHTML), fundingListEl.innerHTML.slice(0, 200));

  await pollUntil(function () { return !/animate-pulse/.test(fundingListEl.innerHTML); }, 20000);
  check('real, genuinely empty My Funding Requests renders correctly (no prior requests seeded)', fundingListEl.textContent.indexOf('No funding requests yet.') !== -1, fundingListEl.textContent);

  const fundingToastEl = D.getElementById('funding-toast');
  const fundingToastTitleEl = D.getElementById('funding-toast-title');
  const fundingToastBodyEl = D.getElementById('funding-toast-body');
  const formSuccessEl = D.getElementById('form-success');
  const formSuccessMessageEl = D.getElementById('form-success-message');

  // ---- WRITE TEST 1 — a real successful crypto deposit round trip. ----
  console.log('1. Deposit (crypto) — a real successful round trip');
  await (async function () {
    D.querySelector('.option-card[data-method="crypto"]').click();
    D.getElementById('crypto-asset').value = 'BTC';
    D.getElementById('crypto-amount').value = '2500';
    D.getElementById('crypto-network').value = 'ERC20'; // the real <select>'s actual option values are ERC20/TRC20/BEP20/Native — confirmed by reading the real markup, not assumed ("mainnet" was a wrong guess caught by this exact assertion on the first run)
    const btn = D.getElementById('submit-crypto');
    btn.click();
    check('the button shows a genuine busy state immediately after clicking (withButtonBusy)', btn.disabled === true);

    await pollUntil(function () { return formSuccessEl.classList.contains('is-active'); }, 15000);
    check('the success panel genuinely activates with a real deposit request id in its message', formSuccessMessageEl.textContent.indexOf('Your deposit request (') !== -1, formSuccessMessageEl.textContent);

    const { data: rows } = await admin.from('deposit_requests').select('*').eq('client_id', clientId).eq('method', 'crypto');
    check('a real, single pending deposit_requests row was genuinely created for the crypto deposit', rows && rows.length === 1 && rows[0].status === 'pending' && rows[0].requested_amount === 2500 && rows[0].currency === 'BTC', JSON.stringify(rows));
    check('the real details JSON preserves asset/network verbatim', rows[0].details.asset === 'BTC' && rows[0].details.network === 'ERC20', JSON.stringify(rows[0].details));
  })();

  // ---- WRITE TEST 2 — a real successful bank deposit round trip. ----
  console.log('\n2. Deposit (bank) — a real successful round trip');
  await (async function () {
    D.querySelector('.option-card[data-method="bank"]').click();
    D.getElementById('bank-name').value = 'Jane Client';
    D.getElementById('bank-address').value = '1 Test St';
    D.getElementById('bank-email').value = 'jane@example.com';
    D.getElementById('bank-amount').value = '4000';
    D.getElementById('bank-currency').value = 'USD';
    D.getElementById('bank-institution').value = 'Test Bank';
    D.getElementById('bank-account-number').value = '99999999';
    D.getElementById('bank-branch-address').value = '2 Branch Rd';
    D.getElementById('bank-routing').value = '021000021';
    const btn = D.getElementById('submit-bank');
    btn.click();

    await pollUntil(function () { return formSuccessEl.classList.contains('is-active'); }, 15000);
    check('the success panel genuinely activates for the bank deposit too', formSuccessMessageEl.textContent.indexOf('Your deposit request (') !== -1, formSuccessMessageEl.textContent);

    const { data: rows } = await admin.from('deposit_requests').select('*').eq('client_id', clientId).eq('method', 'bank');
    check('a real, single pending deposit_requests row was genuinely created for the bank deposit', rows && rows.length === 1 && rows[0].requested_amount === 4000 && rows[0].details.bankName === 'Test Bank', JSON.stringify(rows));
  })();

  // ---- WRITE TEST 3 — a real successful withdrawal round trip, plus the real "Available to
  // withdraw" figure. ----
  console.log('\n3. Withdraw — a real successful round trip');
  await (async function () {
    D.querySelector('.option-card[data-method="withdraw"]').click();
    check('"Available to withdraw" shows the real, correctly-computed figure (no pending withdrawals yet)', D.getElementById('withdraw-available-line').textContent.indexOf('$8,432') !== -1, D.getElementById('withdraw-available-line').textContent);

    D.getElementById('withdraw-amount').value = '1000';
    D.getElementById('withdraw-crypto-asset').value = 'ETH';
    D.getElementById('withdraw-crypto-address').value = '0xTestDestination';
    const btn = D.getElementById('submit-withdraw');
    btn.click();
    check('the withdraw submit button shows a genuine busy state immediately', btn.disabled === true);

    await pollUntil(function () { return formSuccessEl.classList.contains('is-active'); }, 15000);
    check('the success panel genuinely activates for the withdrawal', formSuccessMessageEl.textContent.indexOf('Your withdrawal request (') !== -1, formSuccessMessageEl.textContent);

    const { data: rows } = await admin.from('withdrawal_requests').select('*').eq('client_id', clientId);
    check('a real, single pending withdrawal_requests row was genuinely created, with the client’s own real JWT-derived clientId (no explicit clientId argument needed)', rows && rows.length === 1 && rows[0].status === 'pending' && rows[0].requested_amount === 1000 && rows[0].client_id === clientId, JSON.stringify(rows));
  })();

  // ---- WRITE TEST 4 — real server-side rejection: exceeds current unallocated capital. ----
  console.log('\n4. Withdraw — genuinely rejected server-side (exceeds unallocated capital)');
  await (async function () {
    D.querySelector('.option-card[data-method="withdraw"]').click();
    var bodyBefore = fundingToastBodyEl.textContent;
    D.getElementById('withdraw-amount').value = '999999';
    D.getElementById('withdraw-crypto-asset').value = 'ETH';
    D.getElementById('withdraw-crypto-address').value = '0xTestDestination2';
    D.getElementById('submit-withdraw').click();

    await pollUntil(function () { return !fundingToastEl.classList.contains('hidden') && fundingToastBodyEl.textContent !== bodyBefore; }, 15000);
    check('the toast shows "Withdrawal Request Failed"', fundingToastTitleEl.textContent === 'Withdrawal Request Failed', fundingToastTitleEl.textContent);
    check('the toast shows the REAL "exceeds current unallocated capital" server message', fundingToastBodyEl.textContent.indexOf('exceeds current unallocated capital') !== -1, fundingToastBodyEl.textContent);

    const { data: rows } = await admin.from('withdrawal_requests').select('*').eq('client_id', clientId).eq('requested_amount', 999999);
    check('genuinely ZERO withdrawal_requests rows were created for the rejected attempt', rows && rows.length === 0, JSON.stringify(rows));
  })();

  // ---- WRITE TEST 5 — real server-side rejection via a genuine concurrent-change race,
  // reusing UI Wiring Stage 2's own Sell-verification pattern: the Withdraw form's own
  // "Available to withdraw" line is purely informational (never caps the input or disables
  // Submit, confirmed by reading the real source directly before writing this test), so this
  // isn't strictly needed to prove server-side re-validation the way Stage 2's stale
  // sellState.available was — but it still exercises the exact real-world race
  // request-withdrawal's own check exists for, with the same rigor. ----
  console.log('\n5. Withdraw — genuinely rejected server-side (a real concurrent-change race)');
  await (async function () {
    D.querySelector('.option-card[data-method="withdraw"]').click();
    const staleAvailableText = D.getElementById('withdraw-available-line').textContent;
    check('the Withdraw form shows its own (about-to-become-stale) understanding of what’s available', staleAvailableText.indexOf('$') !== -1, staleAvailableText);

    // A genuine concurrent change — e.g. a real admin-approved withdrawal via a completely
    // separate path — reduces the REAL unallocated_capital out from under the client's own
    // already-open form, which still shows the STALE, now-too-high figure above.
    await admin.from('account_state').update({ unallocated_capital: 100 }).eq('client_id', clientId);

    var bodyBefore = fundingToastBodyEl.textContent;
    D.getElementById('withdraw-amount').value = '500'; // fits the STALE displayed figure, exceeds the real current $100 balance
    D.getElementById('withdraw-crypto-asset').value = 'ETH';
    D.getElementById('withdraw-crypto-address').value = '0xTestDestination3';
    D.getElementById('submit-withdraw').click();

    await pollUntil(function () { return !fundingToastEl.classList.contains('hidden') && fundingToastBodyEl.textContent !== bodyBefore; }, 15000);
    check('the toast shows the REAL server rejection for the real race (not a generic error)', fundingToastBodyEl.textContent.indexOf('exceeds current unallocated capital') !== -1, fundingToastBodyEl.textContent);

    const { data: rows } = await admin.from('withdrawal_requests').select('*').eq('client_id', clientId).eq('requested_amount', 500);
    check('genuinely ZERO withdrawal_requests rows were created for the rejected (raced) attempt', rows && rows.length === 0, JSON.stringify(rows));

    // Restore the real balance for Part 2's own independent expected-value checks below.
    await admin.from('account_state').update({ unallocated_capital: UNALLOCATED }).eq('client_id', clientId);
  })();

  // ===========================================================================================
  // PART 2 — transactions.html
  // ===========================================================================================
  console.log('\n=== PART 2: transactions.html ===\n');

  const txnPath = fileURLToPath(new URL('../transactions.html', import.meta.url));
  const txnDom = buildPageDom(txnPath);
  txnDom.window.MarketswaveData = MarketswaveData;
  const capturedCharts = [];
  txnDom.window.Chart = function (ctx, config) { capturedCharts.push(config); return {}; };

  const txnScript = extractInlineScript(txnPath, 'UI Wiring — Stage 3');
  const T = txnDom.window.document;
  const ledgerBody = T.getElementById('ledger-body');
  const totalBuysEl = T.getElementById('total-buys-amount');
  const activityListEl = T.getElementById('recent-activity-list');

  txnDom.window.eval(txnScript);
  check('the loading skeleton genuinely appears immediately (ledger)', /animate-pulse/.test(ledgerBody.innerHTML), ledgerBody.innerHTML.slice(0, 200));
  check('the loading skeleton genuinely appears immediately (summary cards)', /animate-pulse/.test(totalBuysEl.innerHTML));
  check('the loading skeleton genuinely appears immediately (Recent Activity)', /animate-pulse/.test(activityListEl.innerHTML));

  await pollUntil(function () { return !/animate-pulse/.test(ledgerBody.innerHTML); }, 20000);

  // ---- Real, independently-computed expected values. ----
  const expectedNetInvested = 5000; // the single seeded holding's own cost_basis
  const { data: liveAccount } = await admin.from('account_state').select('allocated_capital').eq('client_id', clientId).single();
  const expectedAccrued = Math.round(liveAccount.allocated_capital * (REAL_RATE / 100) * (30 / 365));

  console.log('\n6. Summary cards — real, independently-computed figures');
  check('Total Buys shows the real $5,000 (one real BUY)', totalBuysEl.textContent === '$5,000', totalBuysEl.textContent);
  check('Total Sells shows the real $1,200 (one real SELL)', T.getElementById('total-sells-amount').textContent === '$1,200', T.getElementById('total-sells-amount').textContent);
  check('Net Invested shows the real seeded holding’s own cost basis ($5,000)', T.getElementById('net-invested-amount').textContent === '$' + expectedNetInvested.toLocaleString('en-US'), T.getElementById('net-invested-amount').textContent);
  check('Advisory Fee card shows the real, independently-computed accrual against the real global rate', T.getElementById('advisory-fee-amount').textContent === '$' + expectedAccrued.toLocaleString('en-US'), T.getElementById('advisory-fee-amount').textContent + ' vs expected $' + expectedAccrued);
  check('Advisory Fee rate display shows the real global rate, not a hardcoded one', T.getElementById('advisory-fee-rate-display').textContent === String(REAL_RATE), T.getElementById('advisory-fee-rate-display').textContent + ' vs real rate ' + REAL_RATE);

  console.log('\n7. Recent Activity + Ledger — DEPOSIT/WITHDRAWAL render correctly against real data');
  check('Recent Activity shows real entries (not empty)', activityListEl.textContent.indexOf('No recent activity') === -1);
  check('the ledger shows all 4 real transactions', ledgerBody.querySelectorAll('tr[data-txn-id]').length === 4, ledgerBody.innerHTML.slice(0, 200));
  check('the real DEPOSIT row renders its own real label, not "null" or a crash (the historical bug class this page has hit before)', ledgerBody.textContent.indexOf('Cash Deposit (Crypto)') !== -1 || ledgerBody.textContent.indexOf('Cash Deposit') !== -1, ledgerBody.textContent);
  check('the real WITHDRAWAL row renders its own real label', ledgerBody.textContent.indexOf('Cash Withdrawal') !== -1, ledgerBody.textContent);
  check('the DEPOSIT row shows "—" for Quantity/Price (no units/price exist for a funding movement)', function () {
    var row = [...ledgerBody.querySelectorAll('tr[data-txn-id]')].find(function (r) { return r.textContent.indexOf('Cash Deposit') !== -1; });
    var cells = row.querySelectorAll('td');
    return cells[3].textContent === '—' && cells[4].textContent === '—';
  }());

  console.log('\n8. Filters — real async-loaded data, all 4 filter dimensions');
  await (async function () {
    T.getElementById('filter-type').value = 'Deposit';
    T.getElementById('apply-filters').click();
    check('Type=Deposit filter shows exactly the 1 real DEPOSIT row', ledgerBody.querySelectorAll('tr[data-txn-id]').length === 1 && ledgerBody.textContent.indexOf('Cash Deposit') !== -1, ledgerBody.textContent);

    T.getElementById('filter-type').value = 'Withdrawal';
    T.getElementById('apply-filters').click();
    check('Type=Withdrawal filter shows exactly the 1 real WITHDRAWAL row', ledgerBody.querySelectorAll('tr[data-txn-id]').length === 1 && ledgerBody.textContent.indexOf('Cash Withdrawal') !== -1);

    T.getElementById('reset-filters').click();
    check('Reset restores all 4 real rows', ledgerBody.querySelectorAll('tr[data-txn-id]').length === 4);

    const assetSelect = T.getElementById('filter-asset');
    check('the asset filter is populated from the real product catalog', [...assetSelect.options].some(function (o) { return o.value === 'Nordic Growth Fund'; }), [...assetSelect.options].map(function (o) { return o.value; }));
    assetSelect.value = 'Nordic Growth Fund';
    T.getElementById('apply-filters').click();
    check('Asset=Nordic Growth Fund filter shows exactly the real BUY + SELL rows (2)', ledgerBody.querySelectorAll('tr[data-txn-id]').length === 2);

    T.getElementById('reset-filters').click();
    const dateFrom = T.getElementById('filter-date-from');
    dateFrom.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    T.getElementById('apply-filters').click();
    check('Date-From filter (this month only) shows exactly the real SELL + WITHDRAWAL rows (2)', ledgerBody.querySelectorAll('tr[data-txn-id]').length === 2, ledgerBody.textContent);

    T.getElementById('reset-filters').click();
    check('Reset genuinely restores all 4 rows again after a date filter', ledgerBody.querySelectorAll('tr[data-txn-id]').length === 4);
  })();

  console.log('\n9. Charts — real aggregated monthly data fed to the real chart-drawing code');
  check('exactly 2 real charts were drawn (Transaction Volume + Net Cash Flow)', capturedCharts.length === 2, 'count=' + capturedCharts.length);
  const volumeConfig = capturedCharts.find(function (c) { return c.type === 'bar'; });
  const cashflowConfig = capturedCharts.find(function (c) { return c.type === 'line'; });
  check('the Volume chart has 2 real month labels (this test’s own seeded months)', volumeConfig && volumeConfig.data.labels.length === 2, volumeConfig && JSON.stringify(volumeConfig.data.labels));
  const month1Idx = 0; // month1 (BUY $5000) sorts before month2 (SELL/WITHDRAWAL) chronologically
  check('the Volume chart’s Buys dataset shows the real $5,000 BUY in month 1 (DEPOSIT correctly excluded from trading volume)', volumeConfig.data.datasets[0].data[month1Idx] === 5000, JSON.stringify(volumeConfig.data.datasets[0].data));
  check('the Volume chart’s Sells dataset shows the real $1,200 SELL in month 2, and $0 in month 1', volumeConfig.data.datasets[1].data[1] === 1200 && volumeConfig.data.datasets[1].data[0] === 0, JSON.stringify(volumeConfig.data.datasets[1].data));
  // Net Cash Flow: month1 = sells(0) + deposits(3000) - buys(5000) - withdrawals(0) = -2000;
  // month2 = sells(1200) + deposits(0) - buys(0) - withdrawals(800) = 400 — proving DEPOSIT
  // counts as a positive inflow and WITHDRAWAL as a negative outflow, the documented mirror-
  // image treatment, against REAL seeded data, not asserted from reading the code alone.
  check('the Net Cash Flow chart correctly includes DEPOSIT as a positive inflow (month 1: -$2,000)', cashflowConfig.data.datasets[0].data[0] === -2000, JSON.stringify(cashflowConfig.data.datasets[0].data));
  check('the Net Cash Flow chart correctly includes WITHDRAWAL as a negative outflow (month 2: +$400)', cashflowConfig.data.datasets[0].data[1] === 400, JSON.stringify(cashflowConfig.data.datasets[0].data));

  console.log('\n10. Drill-down modal — real per-transaction detail');
  await (async function () {
    const depositRow = [...ledgerBody.querySelectorAll('tr[data-txn-id]')].find(function (r) { return r.textContent.indexOf('Cash Deposit') !== -1; });
    depositRow.click();
    const modal = T.getElementById('txn-modal');
    check('the modal genuinely opens on a real row click', !modal.classList.contains('hidden'));
    check('the modal shows the real DEPOSIT amount', T.getElementById('txn-modal-total').textContent === '$3,000', T.getElementById('txn-modal-total').textContent);
    check('the modal shows "—" for Quantity on a DEPOSIT (no crash on null units)', T.getElementById('txn-modal-qty').textContent === '—');

    T.getElementById('txn-modal-close').click();
    check('the modal genuinely closes', modal.classList.contains('hidden'));

    const sellRow = [...ledgerBody.querySelectorAll('tr[data-txn-id]')].find(function (r) { return r.textContent.indexOf('Sell') !== -1; });
    sellRow.click();
    check('the Realized Return row is genuinely visible for a real SELL', !T.getElementById('txn-modal-realized-row').classList.contains('hidden'));
    check('the Realized Return shows the real +$150', T.getElementById('txn-modal-realized').textContent === '+$150', T.getElementById('txn-modal-realized').textContent);
  })();

  } finally {
    await admin.from('deposit_requests').delete().eq('client_id', clientId);
    await admin.from('withdrawal_requests').delete().eq('client_id', clientId);
    await admin.from('transactions').delete().eq('client_id', clientId);
    await admin.from('holdings').delete().eq('client_id', clientId);
    await admin.from('account_state').delete().eq('client_id', clientId);
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
