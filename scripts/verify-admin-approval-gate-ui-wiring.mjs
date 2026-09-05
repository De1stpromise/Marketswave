#!/usr/bin/env node
// Admin UI Wiring — Stage 1 (2026-09-03): the five Approval Gate admin queue pages
// (admin-deposits.html, admin-withdrawals.html, admin-allocations.html, admin-sells.html,
// admin-hys.html) move from engine-core.js/localStorage to real Supabase calls (local
// stack). Same substitute-for-an-unavailable-browser-tool discipline as every prior UI
// Wiring stage — NO BROWSER AUTOMATION TOOL IS AVAILABLE IN THIS SESSION (checked again,
// not assumed carried over from Stage 5) — and the same jsdom-based real-DOM harness
// (verbatim <body>/<script> extraction, window.eval(), real delegated-click/closest()
// support) established in UI Wiring Stage 2 and reused unchanged through Stage 5.
//
// The one genuinely new wrinkle for THIS stage: the caller here is an ADMIN session, not a
// client session. Each of the five real page scripts calls MarketswaveData.useAdminClient()
// as its own first statement — the small, clearly-scoped extension added to supabase-data.js
// this stage (see that file's own header comment for the investigation/design). No manual
// admin sign-in is performed by this script itself; each page's own real script does it,
// exactly as a real PM's browser would, via the local-stack branch added to
// admin-supabase-config.js this stage (auto-signs in as pm@marketswave.local, no prompt).
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-admin-approval-gate-ui-wiring.mjs

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

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

// Extracts a real inline <script> block verbatim by a unique marker string inside it — not
// retyped, not paraphrased. Same technique every prior UI-wiring verification script uses.
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

function buildPageDom(htmlPath) {
  const bodyMarkup = extractBodyMarkup(htmlPath);
  const dom = new JSDOM('<!doctype html><html><body>' + bodyMarkup + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only'
  });
  return dom;
}

async function createTestClient(admin, label, suffix, unallocated) {
  const email = 'adminwiring-' + label.toLowerCase() + '-' + suffix + '@test.marketswave.local';
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: email, password: 'VerifyAdminWiring-2026!', email_confirm: true
  });
  if (createErr) throw new Error('createUser (' + label + ') failed: ' + createErr.message);
  const id = created.user.id;
  const name = 'Admin Wiring Test Client ' + label + ' ' + suffix;
  await admin.from('clients').insert({
    id: id, name: name, email: email, phone: '+1-555-0100', account_type: 'Individual Account', status: 'active'
  });
  await admin.from('account_state').insert({ client_id: id, unallocated_capital: unallocated, allocated_capital: 0, asset_returns: 0 });
  return { id: id, name: name, email: email };
}

async function main() {
  console.log('Admin UI Wiring — Stage 1 verification (5 Approval Gate admin pages), substituting for an unavailable browser tool\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  console.log('API URL: ' + url + '\n');

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // ---- Load the real supabase-data.js ONCE, exactly as every prior stage does — reused
  // (reassigned onto each page's own jsdom window below) across all five page tests without
  // re-running its module code a second time. ----
  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded for real and defined window.MarketswaveData', !!MarketswaveData);
  check('useAdminClient() is defined (the Stage-1 extension under test)', typeof MarketswaveData.useAdminClient === 'function');

  const suffix = crypto.randomBytes(4).toString('hex');
  const clientA = await createTestClient(admin, 'A', suffix, 50000);
  const clientB = await createTestClient(admin, 'B', suffix, 50000);

  const productsRes = await admin.from('products').select('id,name').in('name', ['Global Equity ETF', 'Ethereum']);
  const equityEtf = productsRes.data.find(function (p) { return p.name === 'Global Equity ETF'; });
  const ethereum = productsRes.data.find(function (p) { return p.name === 'Ethereum'; });
  check('both real seeded products this test needs exist', !!equityEtf && !!ethereum, JSON.stringify(productsRes.data));

  try {

  // =============================================================================================
  // DOMAIN 1 — admin-deposits.html
  // =============================================================================================
  console.log('\n=== DOMAIN 1: admin-deposits.html ===\n');
  await (async function () {
    const { data: depReqA1 } = await admin.from('deposit_requests').insert({
      client_id: clientA.id, method: 'crypto', requested_amount: 2000, currency: 'USD', details: { asset: 'BTC', network: 'Bitcoin' }
    }).select().single();
    const { data: depReqB1 } = await admin.from('deposit_requests').insert({
      client_id: clientB.id, method: 'bank', requested_amount: 750, currency: 'USD', details: { accountHolderName: 'Test Client B' }
    }).select().single();
    const { data: depReqRace } = await admin.from('deposit_requests').insert({
      client_id: clientA.id, method: 'bank', requested_amount: 300, currency: 'USD'
    }).select().single();

    const path = fileURLToPath(new URL('../admin-deposits.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    const script = extractInlineScript(path, 'Admin UI Wiring — Stage 1');
    const pendingList = dom.window.document.getElementById('pending-list');
    const historyList = dom.window.document.getElementById('history-list');

    dom.window.eval(script);
    check('the loading skeleton genuinely appears immediately (Deposits pending-list)', /animate-pulse/.test(pendingList.innerHTML), pendingList.innerHTML.slice(0, 150));

    await pollUntil(function () { return !/animate-pulse/.test(pendingList.innerHTML); }, 20000);
    check('real cross-client pending deposits render — BOTH clients present, not just one', pendingList.textContent.indexOf(clientA.name) !== -1 && pendingList.textContent.indexOf(clientB.name) !== -1, pendingList.textContent.slice(0, 400));
    check('pending count shows all 3 real seeded requests', dom.window.document.getElementById('pending-count').textContent.indexOf('3') !== -1);

    const toast = dom.window.document.getElementById('admin-toast');
    const toastTitle = dom.window.document.getElementById('admin-toast-title');
    const toastBody = dom.window.document.getElementById('admin-toast-body');

    console.log('\n1. Credit — a real successful round trip with a PM-EDITED confirmed amount');
    await (async function () {
      const creditBtn = pendingList.querySelector('.credit-btn[data-id="' + depReqA1.id + '"]');
      check('a real Credit button exists for clientA\'s pending deposit', !!creditBtn);
      creditBtn.click();
      const modal = dom.window.document.getElementById('credit-modal');
      check('the Credit modal genuinely opens, pre-filled with the requested amount', !modal.classList.contains('hidden') && dom.window.document.getElementById('credit-amount-input').value === '2000');

      const input = dom.window.document.getElementById('credit-amount-input');
      input.value = '1950'; // PM-EDITED — deliberately different from the $2000 requested
      const submitBtn = dom.window.document.getElementById('credit-submit');
      var bodyBefore = toastBody.textContent;
      submitBtn.click();
      check('the submit button shows a genuine busy state immediately (withButtonBusy)', submitBtn.disabled === true);

      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real success message', toastTitle.textContent === 'Deposit Credited', toastTitle.textContent + ' / ' + toastBody.textContent);
      check('the Credit modal genuinely closes on success', modal.classList.contains('hidden'));

      const { data: row } = await admin.from('deposit_requests').select('*').eq('id', depReqA1.id).single();
      check('the real row shows status=credited with the PM-ENTERED amount ($1950), NOT the originally-requested $2000', row.status === 'credited' && Math.abs(row.credited_amount - 1950) < 1e-9, JSON.stringify(row));
      const { data: acctA } = await admin.from('account_state').select('unallocated_capital').eq('client_id', clientA.id).single();
      check('clientA\'s real unallocated_capital increased by the PM-entered $1950 (50000 -> 51950)', Math.abs(acctA.unallocated_capital - 51950) < 1e-9, acctA.unallocated_capital);
    })();

    console.log('\n2. Reject — a real successful round trip');
    await (async function () {
      const rejectBtn = pendingList.querySelector('.reject-btn[data-id="' + depReqB1.id + '"]');
      check('a real Reject button exists for clientB\'s pending deposit', !!rejectBtn);
      rejectBtn.click();
      const modal = dom.window.document.getElementById('reject-modal');
      check('the Reject modal genuinely opens', !modal.classList.contains('hidden'));
      dom.window.document.getElementById('reject-reason-input').value = 'Unable to verify sender identity.';
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('reject-submit').click();

      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real rejection confirmation', toastTitle.textContent === 'Deposit Rejected', toastTitle.textContent);

      const { data: row } = await admin.from('deposit_requests').select('*').eq('id', depReqB1.id).single();
      check('the real row shows status=rejected with the real reason text', row.status === 'rejected' && row.reason === 'Unable to verify sender identity.', JSON.stringify(row));
    })();

    console.log('\n3. Credit — genuinely rejected server-side (a real concurrent-resolution race, via the actual admin UI)');
    await (async function () {
      const creditBtn = pendingList.querySelector('.credit-btn[data-id="' + depReqRace.id + '"]');
      check('a real Credit button exists for the race-test deposit', !!creditBtn);
      creditBtn.click();
      check('the Credit modal genuinely opens', !dom.window.document.getElementById('credit-modal').classList.contains('hidden'));

      // A real concurrent actor (another PM tab, or a scheduled job) resolves the SAME
      // request via a completely separate path while this admin's modal is still open with
      // its own now-stale understanding that the request is pending.
      await admin.from('deposit_requests').update({ status: 'rejected', resolved_at: new Date().toISOString(), reason: 'Resolved by a different PM.' }).eq('id', depReqRace.id);

      const errorEl = dom.window.document.getElementById('credit-error');
      dom.window.document.getElementById('credit-submit').click();
      await pollUntil(function () { return !errorEl.classList.contains('hidden'); }, 15000);
      check('the real server-side 409 rejection surfaces verbatim in the modal\'s own error element', /not pending/i.test(errorEl.textContent), errorEl.textContent);
      check('the Credit modal stays OPEN on a genuine failure (not silently closed)', !dom.window.document.getElementById('credit-modal').classList.contains('hidden'));

      const { data: row } = await admin.from('deposit_requests').select('*').eq('id', depReqRace.id).single();
      check('the real row is untouched by this admin\'s failed attempt (still the concurrent actor\'s own resolution)', row.status === 'rejected' && row.reason === 'Resolved by a different PM.' && row.credited_amount === null, JSON.stringify(row));
    })();

    console.log('\n4. History — real cross-client resolved data');
    await (async function () {
      await pollUntil(function () { return !/animate-pulse/.test(historyList.innerHTML); }, 20000);
      check('History shows clientA\'s real credited row', historyList.textContent.indexOf(clientA.name) !== -1 && historyList.textContent.indexOf('Credited') !== -1, historyList.textContent.slice(0, 500));
      check('History shows clientB\'s real rejected row', historyList.textContent.indexOf(clientB.name) !== -1 && historyList.textContent.indexOf('Rejected') !== -1);
    })();
  })();

  // =============================================================================================
  // DOMAIN 2 — admin-withdrawals.html
  // =============================================================================================
  console.log('\n=== DOMAIN 2: admin-withdrawals.html ===\n');
  await (async function () {
    await admin.from('account_state').update({ unallocated_capital: 1000 }).eq('client_id', clientA.id);

    const { data: wdReqA1 } = await admin.from('withdrawal_requests').insert({
      client_id: clientA.id, method: 'bank', requested_amount: 700, currency: 'USD', destination_details: { accountHolderName: 'Client A' }
    }).select().single();
    const { data: wdReqA2 } = await admin.from('withdrawal_requests').insert({
      client_id: clientA.id, method: 'bank', requested_amount: 700, currency: 'USD', destination_details: { accountHolderName: 'Client A' }
    }).select().single();
    const { data: wdReqB1 } = await admin.from('withdrawal_requests').insert({
      client_id: clientB.id, method: 'crypto', requested_amount: 300, currency: 'USD', destination_details: { asset: 'ETH', network: 'Ethereum', walletAddress: '0xabc' }
    }).select().single();

    const path = fileURLToPath(new URL('../admin-withdrawals.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    const script = extractInlineScript(path, 'Admin UI Wiring — Stage 1');
    const pendingList = dom.window.document.getElementById('pending-list');
    const historyList = dom.window.document.getElementById('history-list');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(pendingList.innerHTML); }, 20000);
    check('real cross-client pending withdrawals render — both clients present', pendingList.textContent.indexOf(clientA.name) !== -1 && pendingList.textContent.indexOf(clientB.name) !== -1, pendingList.textContent.slice(0, 400));
    check('pending count shows all 3 real seeded requests', dom.window.document.getElementById('pending-count').textContent.indexOf('3') !== -1);

    const toast = dom.window.document.getElementById('admin-toast');
    const toastTitle = dom.window.document.getElementById('admin-toast-title');
    const toastBody = dom.window.document.getElementById('admin-toast-body');

    console.log('\n1. Approve — a real successful round trip with a PM-EDITED approved amount');
    await (async function () {
      const btn = pendingList.querySelector('.approve-btn[data-id="' + wdReqA1.id + '"]');
      check('a real Approve button exists for clientA\'s first pending withdrawal', !!btn);
      btn.click();
      const modal = dom.window.document.getElementById('approve-modal');
      check('the Approve modal genuinely opens, pre-filled with the requested amount', !modal.classList.contains('hidden') && dom.window.document.getElementById('approve-amount-input').value === '700');

      dom.window.document.getElementById('approve-amount-input').value = '650'; // PM-EDITED
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('approve-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real success message', toastTitle.textContent === 'Withdrawal Approved', toastTitle.textContent + ' / ' + toastBody.textContent);
      check('the Approve modal genuinely closes on success', modal.classList.contains('hidden'));

      const { data: row } = await admin.from('withdrawal_requests').select('*').eq('id', wdReqA1.id).single();
      check('the real row shows status=approved with the PM-ENTERED amount ($650), NOT the originally-requested $700', row.status === 'approved' && Math.abs(row.approved_amount - 650) < 1e-9, JSON.stringify(row));
      const { data: acctA } = await admin.from('account_state').select('unallocated_capital').eq('client_id', clientA.id).single();
      check('clientA\'s real unallocated_capital was debited by the PM-entered $650 (1000 -> 350)', Math.abs(acctA.unallocated_capital - 350) < 1e-9, acctA.unallocated_capital);
    })();

    console.log('\n2. Reject — a real successful round trip');
    await (async function () {
      const btn = pendingList.querySelector('.reject-btn[data-id="' + wdReqB1.id + '"]');
      btn.click();
      dom.window.document.getElementById('reject-reason-input').value = 'Destination wallet failed verification.';
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('reject-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real rejection confirmation', toastTitle.textContent === 'Withdrawal Rejected', toastTitle.textContent);

      const { data: row } = await admin.from('withdrawal_requests').select('*').eq('id', wdReqB1.id).single();
      check('the real row shows status=rejected with the real reason text', row.status === 'rejected' && row.reason === 'Destination wallet failed verification.', JSON.stringify(row));
    })();

    console.log('\n3. Approve — genuinely rejected server-side (a real TWO-COMPETING-REQUESTS overdraft race, via the actual admin UI)');
    await (async function () {
      const btn = pendingList.querySelector('.approve-btn[data-id="' + wdReqA2.id + '"]');
      check('a real Approve button still exists for clientA\'s second pending withdrawal', !!btn);
      btn.click();
      check('the Approve modal genuinely opens, still showing the original $700 request (the modal has no idea request 1 already consumed most of the balance)', dom.window.document.getElementById('approve-amount-input').value === '700');

      const errorEl = dom.window.document.getElementById('approve-error');
      dom.window.document.getElementById('approve-submit').click(); // submits the prefilled $700 — only $350 genuinely remains
      await pollUntil(function () { return !errorEl.classList.contains('hidden'); }, 15000);
      check('the real server-side overdraft rejection surfaces verbatim (re-validated against CURRENT capital, not the stale request-time balance)', /350/.test(errorEl.textContent) && /700/.test(errorEl.textContent), errorEl.textContent);
      check('the Approve modal stays OPEN on a genuine failure', !dom.window.document.getElementById('approve-modal').classList.contains('hidden'));

      const { data: row } = await admin.from('withdrawal_requests').select('*').eq('id', wdReqA2.id).single();
      check('the second competing request genuinely stays pending — not silently resolved', row.status === 'pending' && row.approved_amount === null, JSON.stringify(row));
      const { data: acctA } = await admin.from('account_state').select('unallocated_capital').eq('client_id', clientA.id).single();
      check('clientA\'s real unallocated_capital is UNCHANGED by the rejected attempt (still $350, not driven negative)', Math.abs(acctA.unallocated_capital - 350) < 1e-9, acctA.unallocated_capital);
    })();

    console.log('\n4. History — real cross-client resolved data, and the second competing request still shown in Pending');
    await (async function () {
      await pollUntil(function () { return !/animate-pulse/.test(historyList.innerHTML); }, 20000);
      check('History shows clientA\'s real approved row', historyList.textContent.indexOf(clientA.name) !== -1 && historyList.textContent.indexOf('Approved') !== -1);
      check('History shows clientB\'s real rejected row', historyList.textContent.indexOf(clientB.name) !== -1 && historyList.textContent.indexOf('Rejected') !== -1);
      check('the still-pending, unresolved second withdrawal request is still genuinely visible in Pending after the reload', pendingList.textContent.indexOf(wdReqA2.id) !== -1, pendingList.textContent.slice(0, 400));
    })();
  })();

  // =============================================================================================
  // DOMAIN 3 — admin-allocations.html
  // =============================================================================================
  console.log('\n=== DOMAIN 3: admin-allocations.html ===\n');
  await (async function () {
    await admin.from('account_state').update({ unallocated_capital: 2000 }).eq('client_id', clientA.id);

    const { data: allocReqA1 } = await admin.from('allocation_requests').insert({
      client_id: clientA.id, product_id: equityEtf.id, requested_amount: 1500
    }).select().single();
    const { data: allocReqA2 } = await admin.from('allocation_requests').insert({
      client_id: clientA.id, product_id: equityEtf.id, requested_amount: 1500
    }).select().single();
    const { data: allocReqB1 } = await admin.from('allocation_requests').insert({
      client_id: clientB.id, product_id: ethereum.id, requested_amount: 500
    }).select().single();

    const path = fileURLToPath(new URL('../admin-allocations.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    const script = extractInlineScript(path, 'Admin UI Wiring — Stage 1');
    const pendingList = dom.window.document.getElementById('pending-list');
    const historyList = dom.window.document.getElementById('history-list');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(pendingList.innerHTML); }, 20000);
    check('real cross-client pending allocations render — both clients present', pendingList.textContent.indexOf(clientA.name) !== -1 && pendingList.textContent.indexOf(clientB.name) !== -1, pendingList.textContent.slice(0, 400));
    check('real product names render (not raw ids)', pendingList.textContent.indexOf('Global Equity ETF') !== -1 && pendingList.textContent.indexOf('Ethereum') !== -1);

    const toast = dom.window.document.getElementById('admin-toast');
    const toastTitle = dom.window.document.getElementById('admin-toast-title');
    const toastBody = dom.window.document.getElementById('admin-toast-body');

    console.log('\n1. Approve — a real successful round trip (no editable amount — executes exactly as requested)');
    await (async function () {
      const btn = pendingList.querySelector('.approve-btn[data-id="' + allocReqA1.id + '"]');
      check('a real Approve button exists for clientA\'s first pending allocation', !!btn);
      btn.click();
      check('the Approve modal genuinely opens', !dom.window.document.getElementById('approve-modal').classList.contains('hidden'));

      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('approve-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real success message with a real transaction id', toastTitle.textContent === 'Allocation Approved' && /executed as transaction/.test(toastBody.textContent), toastTitle.textContent + ' / ' + toastBody.textContent);

      const { data: row } = await admin.from('allocation_requests').select('*').eq('id', allocReqA1.id).single();
      check('the real row shows status=approved with a real transaction_id', row.status === 'approved' && !!row.transaction_id, JSON.stringify(row));
      const { data: acctA } = await admin.from('account_state').select('unallocated_capital').eq('client_id', clientA.id).single();
      check('clientA\'s real unallocated_capital was debited via the real internal execute-buy call (2000 -> 500)', Math.abs(acctA.unallocated_capital - 500) < 1e-9, acctA.unallocated_capital);
      const { data: holding } = await admin.from('holdings').select('*').eq('client_id', clientA.id).eq('product_id', equityEtf.id).maybeSingle();
      check('a real holding was genuinely created via the real internal execute-buy call (proving this is a real chain, not a status-only stub)', !!holding && holding.cost_basis > 0, JSON.stringify(holding));
    })();

    console.log('\n2. Reject — a real successful round trip');
    await (async function () {
      const btn = pendingList.querySelector('.reject-btn[data-id="' + allocReqB1.id + '"]');
      btn.click();
      dom.window.document.getElementById('reject-reason-input').value = 'Minimum holding period not yet satisfied.';
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('reject-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real rejection confirmation', toastTitle.textContent === 'Allocation Rejected', toastTitle.textContent);
      const { data: row } = await admin.from('allocation_requests').select('*').eq('id', allocReqB1.id).single();
      check('the real row shows status=rejected with the real reason text', row.status === 'rejected' && row.reason === 'Minimum holding period not yet satisfied.', JSON.stringify(row));
    })();

    console.log('\n3. Approve — genuinely rejected server-side (a real TWO-COMPETING-REQUESTS overdraft race, via the actual admin UI)');
    await (async function () {
      const btn = pendingList.querySelector('.approve-btn[data-id="' + allocReqA2.id + '"]');
      check('a real Approve button still exists for clientA\'s second pending allocation', !!btn);
      btn.click();
      const errorEl = dom.window.document.getElementById('approve-error');
      dom.window.document.getElementById('approve-submit').click();
      await pollUntil(function () { return !errorEl.classList.contains('hidden'); }, 15000);
      check('the real server-side overdraft rejection surfaces verbatim (re-validated against CURRENT capital)', /500/.test(errorEl.textContent) && /1500/.test(errorEl.textContent), errorEl.textContent);
      check('the Approve modal stays OPEN on a genuine failure', !dom.window.document.getElementById('approve-modal').classList.contains('hidden'));

      const { data: row } = await admin.from('allocation_requests').select('*').eq('id', allocReqA2.id).single();
      check('the second competing request genuinely stays pending', row.status === 'pending' && row.transaction_id === null, JSON.stringify(row));
    })();

    console.log('\n4. History — real cross-client resolved data');
    await (async function () {
      await pollUntil(function () { return !/animate-pulse/.test(historyList.innerHTML); }, 20000);
      check('History shows clientA\'s real approved row', historyList.textContent.indexOf(clientA.name) !== -1 && historyList.textContent.indexOf('Approved') !== -1);
      check('History shows clientB\'s real rejected row', historyList.textContent.indexOf(clientB.name) !== -1 && historyList.textContent.indexOf('Rejected') !== -1);
    })();
  })();

  // =============================================================================================
  // DOMAIN 4 — admin-sells.html
  // =============================================================================================
  console.log('\n=== DOMAIN 4: admin-sells.html ===\n');
  await (async function () {
    await admin.from('holdings').update({ units: 10, cost_basis: 1000 }).eq('client_id', clientA.id).eq('product_id', equityEtf.id);
    await admin.from('holdings').insert({ client_id: clientB.id, product_id: ethereum.id, units: 5, cost_basis: 400 });

    const { data: sellReqA1 } = await admin.from('sell_requests').insert({ client_id: clientA.id, product_id: equityEtf.id, units_to_sell: 7 }).select().single();
    const { data: sellReqA2 } = await admin.from('sell_requests').insert({ client_id: clientA.id, product_id: equityEtf.id, units_to_sell: 7 }).select().single();
    const { data: sellReqB1 } = await admin.from('sell_requests').insert({ client_id: clientB.id, product_id: ethereum.id, units_to_sell: 2 }).select().single();

    const path = fileURLToPath(new URL('../admin-sells.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    const script = extractInlineScript(path, 'Admin UI Wiring — Stage 1');
    const pendingList = dom.window.document.getElementById('pending-list');
    const historyList = dom.window.document.getElementById('history-list');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(pendingList.innerHTML); }, 20000);
    check('real cross-client pending sells render — both clients present', pendingList.textContent.indexOf(clientA.name) !== -1 && pendingList.textContent.indexOf(clientB.name) !== -1, pendingList.textContent.slice(0, 400));

    const toast = dom.window.document.getElementById('admin-toast');
    const toastTitle = dom.window.document.getElementById('admin-toast-title');
    const toastBody = dom.window.document.getElementById('admin-toast-body');

    console.log('\n1. Approve — a real successful round trip (no editable amount — executes exactly as requested)');
    await (async function () {
      const btn = pendingList.querySelector('.approve-btn[data-id="' + sellReqA1.id + '"]');
      check('a real Approve button exists for clientA\'s first pending sell', !!btn);
      btn.click();
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('approve-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real success message with a real transaction id', toastTitle.textContent === 'Sell Approved' && /executed as transaction/.test(toastBody.textContent), toastTitle.textContent + ' / ' + toastBody.textContent);

      const { data: row } = await admin.from('sell_requests').select('*').eq('id', sellReqA1.id).single();
      check('the real row shows status=approved with a real transaction_id', row.status === 'approved' && !!row.transaction_id, JSON.stringify(row));
      const { data: holding } = await admin.from('holdings').select('units').eq('client_id', clientA.id).eq('product_id', equityEtf.id).single();
      check('clientA\'s real held units were genuinely reduced via the real internal execute-sell call (10 -> 3)', Math.abs(holding.units - 3) < 1e-9, holding.units);
    })();

    console.log('\n2. Reject — a real successful round trip');
    await (async function () {
      const btn = pendingList.querySelector('.reject-btn[data-id="' + sellReqB1.id + '"]');
      btn.click();
      dom.window.document.getElementById('reject-reason-input').value = 'Client requested to cancel via support ticket.';
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('reject-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real rejection confirmation', toastTitle.textContent === 'Sell Rejected', toastTitle.textContent);
      const { data: row } = await admin.from('sell_requests').select('*').eq('id', sellReqB1.id).single();
      check('the real row shows status=rejected with the real reason text', row.status === 'rejected' && row.reason === 'Client requested to cancel via support ticket.', JSON.stringify(row));
    })();

    console.log('\n3. Approve — genuinely rejected server-side (a real TWO-COMPETING-REQUESTS oversell race, via the actual admin UI)');
    await (async function () {
      const btn = pendingList.querySelector('.approve-btn[data-id="' + sellReqA2.id + '"]');
      check('a real Approve button still exists for clientA\'s second pending sell', !!btn);
      btn.click();
      const errorEl = dom.window.document.getElementById('approve-error');
      dom.window.document.getElementById('approve-submit').click();
      await pollUntil(function () { return !errorEl.classList.contains('hidden'); }, 15000);
      check('the real server-side oversell rejection surfaces verbatim (re-validated against CURRENT held units)', /3/.test(errorEl.textContent) && /7/.test(errorEl.textContent), errorEl.textContent);
      check('the Approve modal stays OPEN on a genuine failure', !dom.window.document.getElementById('approve-modal').classList.contains('hidden'));

      const { data: row } = await admin.from('sell_requests').select('*').eq('id', sellReqA2.id).single();
      check('the second competing request genuinely stays pending', row.status === 'pending' && row.transaction_id === null, JSON.stringify(row));
      const { data: holding } = await admin.from('holdings').select('units').eq('client_id', clientA.id).eq('product_id', equityEtf.id).single();
      check('clientA\'s real held units are UNCHANGED by the rejected attempt (still 3, not driven negative)', Math.abs(holding.units - 3) < 1e-9, holding.units);
    })();

    console.log('\n4. History — real cross-client resolved data, including a real Realized Return');
    await (async function () {
      await pollUntil(function () { return !/animate-pulse/.test(historyList.innerHTML); }, 20000);
      check('History shows clientA\'s real approved row', historyList.textContent.indexOf(clientA.name) !== -1 && historyList.textContent.indexOf('Approved') !== -1);
      check('History shows clientB\'s real rejected row', historyList.textContent.indexOf(clientB.name) !== -1 && historyList.textContent.indexOf('Rejected') !== -1);
      const { data: sellRow } = await admin.from('sell_requests').select('transaction_id').eq('id', sellReqA1.id).single();
      const { data: txn } = await admin.from('transactions').select('realized_return').eq('id', sellRow.transaction_id).single();
      check('History renders a real, non-dash Realized Return value read directly from the real transactions row (not the old getTransactionForClient() local lookup)', txn.realized_return !== null && historyList.textContent.indexOf(String(Math.round(txn.realized_return))) !== -1, 'realized_return=' + txn.realized_return);
    })();
  })();

  // =============================================================================================
  // DOMAIN 5 — admin-hys.html (both Deposit and Withdrawal sub-sections)
  // =============================================================================================
  console.log('\n=== DOMAIN 5: admin-hys.html ===\n');
  await (async function () {
    // ---- HYS Deposit Requests setup ----
    const { data: hysDepA1 } = await admin.from('hys_deposit_requests').insert({
      client_id: clientA.id, pocket_type: 'ayw', requested_amount: 800, method: 'bank', currency: 'USD'
    }).select().single();
    const { data: hysDepB1 } = await admin.from('hys_deposit_requests').insert({
      client_id: clientB.id, pocket_type: 'ayw', requested_amount: 400, method: 'crypto', currency: 'USD'
    }).select().single();
    const { data: hysDepRace } = await admin.from('hys_deposit_requests').insert({
      client_id: clientA.id, pocket_type: 'ayw', requested_amount: 300, method: 'bank', currency: 'USD'
    }).select().single();

    // ---- HYS Withdrawal Requests setup — TWO competing requests against the SAME real pocket ----
    const { data: pocketA } = await admin.from('hys_pockets').insert({
      client_id: clientA.id, pocket_type: 'ayw', amount: 1000, status: 'active', funding_method: 'bank account'
    }).select().single();
    const { data: pocketB } = await admin.from('hys_pockets').insert({
      client_id: clientB.id, pocket_type: 'ayw', amount: 600, status: 'active', funding_method: 'crypto wallet'
    }).select().single();
    const { data: hysWdA1 } = await admin.from('hys_withdrawal_requests').insert({
      client_id: clientA.id, pocket_id: pocketA.id, pocket_type: 'ayw', forfeit: false, receive_amount: 1000, method: 'bank'
    }).select().single();
    const { data: hysWdA2 } = await admin.from('hys_withdrawal_requests').insert({
      client_id: clientA.id, pocket_id: pocketA.id, pocket_type: 'ayw', forfeit: false, receive_amount: 1000, method: 'bank'
    }).select().single();
    const { data: hysWdB1 } = await admin.from('hys_withdrawal_requests').insert({
      client_id: clientB.id, pocket_id: pocketB.id, pocket_type: 'ayw', forfeit: false, receive_amount: 600, method: 'crypto'
    }).select().single();

    const path = fileURLToPath(new URL('../admin-hys.html', import.meta.url));
    const dom = buildPageDom(path);
    dom.window.MarketswaveData = MarketswaveData;
    const script = extractInlineScript(path, 'Admin UI Wiring — Stage 1');
    const pendingList = dom.window.document.getElementById('pending-list');
    const historyList = dom.window.document.getElementById('history-list');
    const wdPendingList = dom.window.document.getElementById('wd-pending-list');
    const wdHistoryList = dom.window.document.getElementById('wd-history-list');

    dom.window.eval(script);
    await pollUntil(function () { return !/animate-pulse/.test(pendingList.innerHTML); }, 20000);
    await pollUntil(function () { return !/animate-pulse/.test(wdPendingList.innerHTML); }, 20000);
    check('real cross-client pending HYS deposits render — both clients present', pendingList.textContent.indexOf(clientA.name) !== -1 && pendingList.textContent.indexOf(clientB.name) !== -1, pendingList.textContent.slice(0, 400));
    check('real cross-client pending HYS withdrawals render — both clients present', wdPendingList.textContent.indexOf(clientA.name) !== -1 && wdPendingList.textContent.indexOf(clientB.name) !== -1, wdPendingList.textContent.slice(0, 400));

    const toast = dom.window.document.getElementById('admin-toast');
    const toastTitle = dom.window.document.getElementById('admin-toast-title');
    const toastBody = dom.window.document.getElementById('admin-toast-body');

    console.log('\n--- 5a. HYS Deposit Requests ---');

    console.log('\n1. Credit — a real successful round trip with a PM-EDITED confirmed amount');
    await (async function () {
      const btn = pendingList.querySelector('.credit-btn[data-id="' + hysDepA1.id + '"]');
      check('a real Credit button exists for clientA\'s pending HYS deposit', !!btn);
      btn.click();
      const input = dom.window.document.getElementById('credit-amount-input');
      check('the Credit modal genuinely opens, pre-filled with the requested amount', input.value === '800');
      input.value = '750'; // PM-EDITED
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('credit-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real success message', toastTitle.textContent === 'Pocket Opened', toastTitle.textContent + ' / ' + toastBody.textContent);

      const { data: row } = await admin.from('hys_deposit_requests').select('*').eq('id', hysDepA1.id).single();
      check('the real row shows status=credited with the PM-ENTERED amount ($750), NOT the originally-requested $800', row.status === 'credited' && Math.abs(row.credited_amount - 750) < 1e-9 && !!row.pocket_id, JSON.stringify(row));
      const { data: newPocket } = await admin.from('hys_pockets').select('*').eq('id', row.pocket_id).single();
      check('a real new hys_pockets row was genuinely created with the PM-confirmed amount', Math.abs(newPocket.amount - 750) < 1e-9 && newPocket.status === 'active', JSON.stringify(newPocket));
    })();

    console.log('\n2. Reject — a real successful round trip');
    await (async function () {
      const btn = pendingList.querySelector('.reject-btn[data-id="' + hysDepB1.id + '"]');
      btn.click();
      dom.window.document.getElementById('reject-reason-input').value = 'Funding source could not be verified.';
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('reject-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real rejection confirmation', toastTitle.textContent === 'HYS Deposit Rejected', toastTitle.textContent);
      const { data: row } = await admin.from('hys_deposit_requests').select('*').eq('id', hysDepB1.id).single();
      check('the real row shows status=rejected with the real reason text', row.status === 'rejected' && row.reason === 'Funding source could not be verified.', JSON.stringify(row));
    })();

    console.log('\n3. Credit — genuinely rejected server-side (a real concurrent-resolution race, via the actual admin UI)');
    await (async function () {
      const btn = pendingList.querySelector('.credit-btn[data-id="' + hysDepRace.id + '"]');
      check('a real Credit button exists for the race-test HYS deposit', !!btn);
      btn.click();
      check('the Credit modal genuinely opens', !dom.window.document.getElementById('credit-modal').classList.contains('hidden'));

      await admin.from('hys_deposit_requests').update({ status: 'rejected', resolved_at: new Date().toISOString(), reason: 'Resolved by a different PM.' }).eq('id', hysDepRace.id);

      const errorEl = dom.window.document.getElementById('credit-error');
      dom.window.document.getElementById('credit-submit').click();
      await pollUntil(function () { return !errorEl.classList.contains('hidden'); }, 15000);
      check('the real server-side 409 rejection surfaces verbatim in the modal\'s own error element', /not pending/i.test(errorEl.textContent), errorEl.textContent);
      check('the Credit modal stays OPEN on a genuine failure', !dom.window.document.getElementById('credit-modal').classList.contains('hidden'));

      const { data: row } = await admin.from('hys_deposit_requests').select('*').eq('id', hysDepRace.id).single();
      check('the real row is untouched by this admin\'s failed attempt', row.status === 'rejected' && row.reason === 'Resolved by a different PM.' && row.credited_amount === null, JSON.stringify(row));
    })();

    console.log('\n--- 5b. HYS Withdrawal Requests ---');

    console.log('\n4. Approve — a real successful round trip (no editable amount — deterministic receive amount)');
    await (async function () {
      // Captured fresh, not hardcoded — Domains 3 (allocation debit) and 4 (a real sell's
      // cost-basis credit) both legitimately moved clientA's real unallocated_capital earlier
      // in this same script run, so "unchanged" must be judged against whatever it actually
      // is right now, not a stale figure from a different domain's own end state.
      const { data: acctBefore } = await admin.from('account_state').select('unallocated_capital').eq('client_id', clientA.id).single();

      const btn = wdPendingList.querySelector('.wd-approve-btn[data-id="' + hysWdA1.id + '"]');
      check('a real Approve button exists for clientA\'s first pending HYS withdrawal', !!btn);
      btn.click();
      check('the wd-Approve modal genuinely opens', !dom.window.document.getElementById('wd-approve-modal').classList.contains('hidden'));
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('wd-approve-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real success message', toastTitle.textContent === 'Withdrawal Approved', toastTitle.textContent + ' / ' + toastBody.textContent);

      const { data: row } = await admin.from('hys_withdrawal_requests').select('*').eq('id', hysWdA1.id).single();
      check('the real row shows status=approved with a real transaction_id', row.status === 'approved' && !!row.transaction_id, JSON.stringify(row));
      const { data: pocket } = await admin.from('hys_pockets').select('status').eq('id', pocketA.id).single();
      check('the real pocket is genuinely marked withdrawn', pocket.status === 'withdrawn', pocket.status);
      const { data: acctA } = await admin.from('account_state').select('unallocated_capital').eq('client_id', clientA.id).single();
      check('unallocated_capital is genuinely UNCHANGED — HYS is its own pool, funded/paid out externally (a deliberate design property, not a gap)', Math.abs(acctA.unallocated_capital - acctBefore.unallocated_capital) < 1e-9, acctBefore.unallocated_capital + ' -> ' + acctA.unallocated_capital);
    })();

    console.log('\n5. Reject — a real successful round trip');
    await (async function () {
      const btn = wdPendingList.querySelector('.wd-reject-btn[data-id="' + hysWdB1.id + '"]');
      btn.click();
      dom.window.document.getElementById('wd-reject-reason-input').value = 'Pocket flagged for manual review.';
      var bodyBefore = toastBody.textContent;
      dom.window.document.getElementById('wd-reject-submit').click();
      await pollUntil(function () { return !toast.classList.contains('hidden') && toastBody.textContent !== bodyBefore; }, 15000);
      check('the toast shows the real rejection confirmation', toastTitle.textContent === 'HYS Withdrawal Rejected', toastTitle.textContent);
      const { data: row } = await admin.from('hys_withdrawal_requests').select('*').eq('id', hysWdB1.id).single();
      check('the real row shows status=rejected with the real reason text', row.status === 'rejected' && row.reason === 'Pocket flagged for manual review.', JSON.stringify(row));
    })();

    console.log('\n6. Approve — genuinely rejected server-side (a real TWO-COMPETING-REQUESTS race against the SAME already-withdrawn pocket, via the actual admin UI)');
    await (async function () {
      const btn = wdPendingList.querySelector('.wd-approve-btn[data-id="' + hysWdA2.id + '"]');
      check('a real Approve button still exists for clientA\'s second pending HYS withdrawal (same pocket, already withdrawn by test 4)', !!btn);
      btn.click();
      const errorEl = dom.window.document.getElementById('wd-approve-error');
      dom.window.document.getElementById('wd-approve-submit').click();
      await pollUntil(function () { return !errorEl.classList.contains('hidden'); }, 15000);
      check('the real server-side rejection surfaces verbatim (re-validated against the pocket\'s CURRENT state, not the request-time snapshot)', /already been withdrawn/i.test(errorEl.textContent), errorEl.textContent);
      check('the wd-Approve modal stays OPEN on a genuine failure', !dom.window.document.getElementById('wd-approve-modal').classList.contains('hidden'));

      const { data: row } = await admin.from('hys_withdrawal_requests').select('*').eq('id', hysWdA2.id).single();
      check('the second competing request genuinely stays pending', row.status === 'pending' && row.transaction_id === null, JSON.stringify(row));
    })();

    console.log('\n7. History — real cross-client resolved data, both sub-sections');
    await (async function () {
      await pollUntil(function () { return !/animate-pulse/.test(historyList.innerHTML); }, 20000);
      await pollUntil(function () { return !/animate-pulse/.test(wdHistoryList.innerHTML); }, 20000);
      check('HYS Deposit History shows clientA\'s real credited row and clientB\'s real rejected row', historyList.textContent.indexOf(clientA.name) !== -1 && historyList.textContent.indexOf('Credited') !== -1 && historyList.textContent.indexOf(clientB.name) !== -1 && historyList.textContent.indexOf('Rejected') !== -1);
      check('HYS Withdrawal History shows clientA\'s real approved row and clientB\'s real rejected row', wdHistoryList.textContent.indexOf(clientA.name) !== -1 && wdHistoryList.textContent.indexOf('Approved') !== -1 && wdHistoryList.textContent.indexOf(clientB.name) !== -1 && wdHistoryList.textContent.indexOf('Rejected') !== -1);
    })();
  })();

  } finally {
    // ---- Cleanup — every table this test touched cascades from the real auth users via
    // `on delete cascade` (confirmed by reading every migration's own FK definition before
    // relying on this), so deleting both test users cleans up everything in one shot. ----
    await admin.auth.admin.deleteUser(clientA.id);
    await admin.auth.admin.deleteUser(clientB.id);
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
