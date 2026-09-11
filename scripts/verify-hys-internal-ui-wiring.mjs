#!/usr/bin/env node
// ★ Savings deposit from unallocated capital (2026-09-11) — UI verification.
//
// Drives the REAL, unmodified inline scripts of high-yield-savings.html AND admin-hys.html
// inside real jsdom DOMs built from each page's own <body> markup, against the REAL local
// Supabase stack and the REAL Edge Functions — the same harness every UI-wiring stage in this
// project has used since Stage 2, reused verbatim rather than re-derived.
//
// WHAT THIS PROVES THAT verify-hys-internal-funding.js CANNOT: that a client can actually
// REACH the new funding source through the real card/step flow and that the balance shown is
// the real one, and that a PM can tell an internal transfer apart in the real queue and is
// genuinely prevented from editing its amount. The other script proves the functions; this
// proves the two pages.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-hys-internal-ui-wiring.mjs
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
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
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  }
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

function extractInlineScript(htmlPath, marker) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const target = scripts.find((s) => s.indexOf(marker) !== -1);
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
  return new JSDOM('<!doctype html><html><body>' + extractBodyMarkup(htmlPath) + '</body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: forwardingConsole
  });
}

async function main() {
  console.log('Savings deposit from unallocated capital — real UI verification\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const email = 'hysintui-' + suffix + '@test.marketswave.local';
  const password = 'VerifyHysInternalUI-2026!';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error('createUser failed: ' + createErr.message);
  const clientId = created.user.id;
  await admin.from('clients').insert({
    id: clientId, name: 'HYS Internal UI', email: 'hysintui-verify-' + clientId,
    phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
  });
  await admin.from('account_state').insert({
    client_id: clientId, unallocated_capital: 45000, allocated_capital: 0, asset_returns: 0
  });

  try {
    const client = await MarketswaveData.getSupabaseClient();
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
    check('real client sign-in against the local stack succeeds', !signInErr, signInErr && signInErr.message);

    // ===== PART 1: high-yield-savings.html =====
    console.log('\n=== PART 1: the client can reach the new funding source ===\n');
    const engineCoreSource = readFileSync(fileURLToPath(new URL('../engine-core.js', import.meta.url)), 'utf8');
    const hysPath = fileURLToPath(new URL('../high-yield-savings.html', import.meta.url));
    const hysDom = buildPageDom(hysPath);
    hysDom.window.MarketswaveData = MarketswaveData;
    hysDom.window.eval(engineCoreSource);
    const H = hysDom.window.document;
    hysDom.window.eval(extractInlineScript(hysPath, 'UI Wiring — Stage 4'));

    await pollUntil(() => !/animate-pulse/.test(H.getElementById('pockets-grid').innerHTML), 30000);

    const fundingCards = [...H.querySelectorAll('.np-funding-card')];
    check('the funding step now offers three sources, not two', fundingCards.length === 3,
      String(fundingCards.length));
    const internalCard = fundingCards.find((c) => c.dataset.method === 'internal');
    check('...one of which is the new unallocated-capital source', !!internalCard);
    check('...labelled so a client knows it is their own money, not a payment rail',
      /Unallocated Capital/i.test(internalCard.textContent), internalCard.textContent.trim().slice(0, 80));

    // Drive the REAL flow: open the modal, choose AYW, enter an amount, continue to funding.
    H.getElementById('open-new-pocket-btn').click();
    [...H.querySelectorAll('.np-type-card')].find((c) => c.dataset.type === 'ayw').click();
    H.getElementById('np-ayw-amount').value = '12000';
    H.getElementById('np-ayw-continue').click();
    internalCard.click();

    check('choosing it opens the internal funding step',
      !H.querySelector('[data-step="funding-internal"]').classList.contains('hidden'));
    check('★ the REAL available unallocated balance is shown, not a placeholder',
      H.getElementById('np-internal-available').textContent === '$45,000.00',
      H.getElementById('np-internal-available').textContent);
    check('...alongside the amount being transferred',
      H.getElementById('np-internal-amount').textContent === '$12,000.00',
      H.getElementById('np-internal-amount').textContent);
    check('...and the genuine balance that would remain afterwards',
      H.getElementById('np-internal-remaining').textContent === '$33,000.00',
      H.getElementById('np-internal-remaining').textContent);
    check('the confirm button is enabled for an affordable transfer',
      H.getElementById('np-internal-confirm').disabled === false);

    // An unaffordable amount must be caught in the UI too, not only server-side.
    H.querySelector('[data-step="funding-internal"] .np-back').click();
    [...H.querySelectorAll('.np-type-card')].find((c) => c.dataset.type === 'ayw').click();
    H.getElementById('np-ayw-amount').value = '90000';
    H.getElementById('np-ayw-continue').click();
    internalCard.click();
    check('an amount beyond the real balance shows an inline error',
      !H.getElementById('np-internal-error').classList.contains('hidden'));
    check('...and the confirm button is genuinely disabled, not just styled',
      H.getElementById('np-internal-confirm').disabled === true);

    // Back to an affordable amount and submit for real.
    H.querySelector('[data-step="funding-internal"] .np-back').click();
    [...H.querySelectorAll('.np-type-card')].find((c) => c.dataset.type === 'ayw').click();
    H.getElementById('np-ayw-amount').value = '12000';
    H.getElementById('np-ayw-continue').click();
    internalCard.click();
    H.getElementById('np-internal-confirm').click();

    await pollUntil(async () => ((await admin.from('hys_deposit_requests').select('id').eq('client_id', clientId)).data || []).length > 0, 30000);
    const reqRows = (await admin.from('hys_deposit_requests').select('*').eq('client_id', clientId)).data || [];
    check('★ clicking Confirm creates a REAL pending request in Postgres',
      reqRows.length === 1, JSON.stringify(reqRows.length));
    check('...with method "internal"', reqRows[0] && reqRows[0].method === 'internal', reqRows[0] && reqRows[0].method);
    check('...for the real amount', reqRows[0] && Number(reqRows[0].requested_amount) === 12000);
    check('...and no capital has moved yet', (await admin.from('account_state').select('unallocated_capital').eq('client_id', clientId).single()).data.unallocated_capital === 45000);
    const requestId = reqRows[0].id;

    // ===== PART 2: admin-hys.html =====
    console.log('\n=== PART 2: the PM can tell it apart and cannot edit the amount ===\n');
    // Admin Auth Consolidation (2026-09-05): useAdminClient()'s own ensureSupabaseAdminSignedIn()
    // redirects to the login page when no session exists, so the PM must be signed in on
    // admin-supabase-config.js's own singleton FIRST — the exact order every other admin UI
    // script here already uses, reused rather than rediscovered.
    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({
      email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD
    });
    check('real PM sign-in succeeds', !adminSignInErr, adminSignInErr && adminSignInErr.message);
    await MarketswaveData.useAdminClient();

    const adminPath = fileURLToPath(new URL('../admin-hys.html', import.meta.url));
    const adminDom = buildPageDom(adminPath);
    adminDom.window.MarketswaveData = MarketswaveData;
    const A = adminDom.window.document;
    adminDom.window.eval(extractInlineScript(adminPath, 'Admin UI Wiring'));

    const pendingEl = A.getElementById('pending-list');
    await pollUntil(() => pendingEl.textContent.indexOf(requestId) !== -1, 30000);
    check('the internal transfer appears in the real admin deposit queue',
      pendingEl.textContent.indexOf(requestId) !== -1);
    check('★ badged INTERNAL TRANSFER so a PM can tell at a glance',
      /Internal Transfer/.test(pendingEl.textContent), pendingEl.textContent.slice(0, 200));
    check('...with an explicit note that there is no incoming payment to confirm',
      /No incoming payment to confirm/i.test(pendingEl.textContent));
    check('...and the action reads Approve Transfer rather than Credit',
      /Approve Transfer/.test(pendingEl.textContent));

    const creditBtn = [...pendingEl.querySelectorAll('.credit-btn')].find((b) => b.dataset.id === requestId);
    check('the approve control carries the method so the modal can adapt',
      creditBtn && creditBtn.dataset.method === 'internal', creditBtn && creditBtn.dataset.method);
    creditBtn.click();

    check('the modal opens retitled for a transfer', A.getElementById('credit-modal-title').textContent === 'Approve Internal Transfer',
      A.getElementById('credit-modal-title').textContent);
    check('★ the amount field is genuinely read-only, not merely pre-filled',
      A.getElementById('credit-amount-input').readOnly === true);
    check('...pre-filled with the exact requested amount',
      String(A.getElementById('credit-amount-input').value) === '12000', A.getElementById('credit-amount-input').value);
    check('the transfer copy is shown and the external fees/FX copy is hidden',
      !A.getElementById('credit-internal-copy').classList.contains('hidden') &&
      A.getElementById('credit-external-copy').classList.contains('hidden'));

    A.getElementById('credit-submit').click();
    await pollUntil(async () => ((await admin.from('hys_pockets').select('id').eq('client_id', clientId)).data || []).length > 0, 30000);

    const finalState = (await admin.from('account_state').select('unallocated_capital').eq('client_id', clientId).single()).data;
    check('★ approving through the REAL admin UI genuinely moved the capital — 45,000 -> 33,000',
      Number(finalState.unallocated_capital) === 33000, String(finalState.unallocated_capital));
    const finalPockets = (await admin.from('hys_pockets').select('*').eq('client_id', clientId)).data || [];
    check('...a real pocket exists for it, funded from unallocated capital',
      finalPockets.length === 1 && finalPockets[0].funding_method === 'unallocated capital');
    const finalTxns = (await admin.from('transactions').select('*').eq('client_id', clientId)).data || [];
    check('...and one real HYS_TRANSFER_IN ledger row',
      finalTxns.length === 1 && finalTxns[0].type === 'HYS_TRANSFER_IN', JSON.stringify(finalTxns.map(t => t.type)));

    // ===== PART 3: the ledger renders it, no "Capital allocated — null" =====
    console.log('\n=== PART 3: the ledger renders the new type ===\n');
    // useAdminClient() permanently redirected MarketswaveData's own cached client promise to
    // admin-supabase-config.js's singleton, so the ledger cannot simply be read "as the client"
    // by importing the other config. That same singleton is re-authenticated as the client
    // instead — the real session the page would run under, reached through the instance this
    // process has already committed to.
    await adminConfigMod.supabase.auth.signInWithPassword({ email, password });
    const txPath = fileURLToPath(new URL('../transactions.html', import.meta.url));
    const txDom = buildPageDom(txPath);
    txDom.window.MarketswaveData = MarketswaveData;
    txDom.window.Chart = function () { return { destroy() {} }; };
    txDom.window.Chart.getChart = () => null;
    const T = txDom.window.document;
    txDom.window.eval(extractInlineScript(txPath, 'UI Wiring — Stage 3'));
    const ledgerBody = T.getElementById('ledger-body');
    await pollUntil(() => /HYS/.test(ledgerBody.textContent), 30000);
    check('the transfer appears in the real ledger table', /HYS/.test(ledgerBody.textContent));
    check('★ named so both ends of the movement are legible in one row',
      /from Unallocated Capital/i.test(ledgerBody.textContent), ledgerBody.textContent.slice(0, 300));
    check('...and NOT rendered as the "null" bug this page has had to fix twice before',
      ledgerBody.textContent.indexOf('null') === -1 && !/Capital allocated —\s*$/.test(ledgerBody.textContent));
    check('the Type filter offers the new type so it can be isolated',
      [...T.querySelectorAll('#filter-type option')].some((o) => o.value === 'HYS Transfer'));
  } finally {
    await admin.from('hys_deposit_requests').delete().eq('client_id', clientId);
    await admin.from('hys_pockets').delete().eq('client_id', clientId);
    await admin.from('transactions').delete().eq('client_id', clientId);
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
  console.error(err && err.stack);
  process.exit(1);
});
