#!/usr/bin/env node
// ★ Crypto deposit routing (2026-09-11) — UI verification.
//
// Drives the REAL, unmodified inline scripts of admin-deposit-addresses.html,
// admin-deposits.html and deploy-capital.html inside real jsdom DOMs built from each page's
// own <body> markup, against the REAL local stack and the REAL Edge Functions — the harness
// every UI-wiring stage in this project has used since Stage 2, reused verbatim.
//
// WHAT THIS PROVES THAT verify-supabase-deposit-addresses.js CANNOT: that a PM can actually
// add / assign / remove through the real address book UI; that two real clients each see the
// address on the real Deploy Capital page and can submit (one with a hash, one without);
// that the real admin queue renders an amount-less request sensibly and credits it at a
// PM-entered figure; and that the empty state is a route to the PM, not a dead end.
//
// LOCAL STACK ONLY. Usage:
//   node --experimental-loader ./lib/esm-loader-supabase-cdn.mjs verify-deposit-routing-ui-wiring.mjs
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
    await new Promise((r) => setTimeout(r, 150));
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

const BTC_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TRON_ADDRESS = 'TJRyWwiGxN5ZM2YbqLdcUbvvqkaGgNpDnc';

async function main() {
  console.log('Crypto deposit routing — real UI verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'VerifyDepositRoutingUI-2026!';

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;

  async function makeClient(tag, name) {
    const email = 'deprtui-' + tag + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    await admin.from('clients').insert({
      id: data.user.id, name, email: 'deprtui-' + tag + '-' + data.user.id, // malformed: no real mail
      phone: '+1 555 0100', account_type: 'Individual Account', status: 'active'
    });
    return { id: data.user.id, name, email, password };
  }
  const A = await makeClient('a', 'Routing Client Alpha');
  const B = await makeClient('b', 'Routing Client Bravo');
  const C = await makeClient('c', 'Routing Client Charlie');
  const ids = [A.id, B.id, C.id];
  const addressIds = [];

  try {
    // ===== PART 1: the PM address book =====
    console.log('=== PART 1: admin-deposit-addresses.html — add, assign two clients, manage ===\n');
    const adminConfigMod = await import('../admin-supabase-config.js');
    const { error: adminSignInErr } = await adminConfigMod.supabase.auth.signInWithPassword({
      email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD
    });
    check('real PM sign-in succeeds', !adminSignInErr, adminSignInErr && adminSignInErr.message);
    await MarketswaveData.useAdminClient();

    const engineCoreSource = readFileSync(fileURLToPath(new URL('../engine-core.js', import.meta.url)), 'utf8');
    const bookPath = fileURLToPath(new URL('../admin-deposit-addresses.html', import.meta.url));
    let bookDom = buildPageDom(bookPath);
    bookDom.window.MarketswaveData = MarketswaveData;
    bookDom.window.eval(engineCoreSource);
    let D = bookDom.window.document;
    bookDom.window.eval(extractInlineScript(bookPath, 'the shared deposit address book'));
    const listEl = () => D.getElementById('addresses-list');
    // Wait for the real render, not merely the end of the skeleton: the route <select> is
    // populated inside render(), so four options is proof the data genuinely arrived.
    await pollUntil(() => D.querySelectorAll('#add-route option').length === 4, 30000);
    check('the address book loads (routes populated from the real table)', D.querySelectorAll('#add-route option').length === 4, listEl().innerHTML.slice(0, 200));

    // --- Add a BTC address through the real two-step modal ---
    D.getElementById('open-add-modal').click();
    check('Add modal opens with the four routes', D.querySelectorAll('#add-route option').length === 4, String(D.querySelectorAll('#add-route option').length));
    D.getElementById('add-route').value = 'BTC|Bitcoin';
    D.getElementById('add-address').value = BTC_ADDRESS;
    D.getElementById('add-label').value = 'UI Test BTC ' + suffix;
    D.getElementById('add-continue').click();
    check('the review step shows the full address back before saving',
      !D.getElementById('add-step-confirm').classList.contains('hidden') && D.getElementById('add-confirm-address').textContent === BTC_ADDRESS,
      D.getElementById('add-confirm-address').textContent);
    D.getElementById('add-submit').click();
    await pollUntil(async () => ((await admin.from('deposit_addresses').select('id').eq('label', 'UI Test BTC ' + suffix)).data || []).length === 1, 30000);
    const btcRow = (await admin.from('deposit_addresses').select('*').eq('label', 'UI Test BTC ' + suffix).single()).data;
    check('★ Confirm & add creates a REAL address row', !!btcRow && btcRow.address === BTC_ADDRESS && btcRow.status === 'available');
    addressIds.push(btcRow.id);
    await pollUntil(() => listEl().textContent.indexOf('UI Test BTC ' + suffix) !== -1 && !/animate-pulse/.test(listEl().innerHTML), 30000);
    check('...and it appears in the real list as Available / Unassigned',
      /Available/.test(listEl().textContent) && /Unassigned/.test(listEl().textContent), listEl().textContent.replace(/\s+/g, ' ').slice(0, 300));

    // A structurally-bad address through the same modal is refused with the server's message.
    D.getElementById('open-add-modal').click();
    D.getElementById('add-route').value = 'USDT|TRC-20';
    D.getElementById('add-address').value = BTC_ADDRESS; // a Bitcoin address in the TRON slot
    D.getElementById('add-continue').click();
    D.getElementById('add-submit').click();
    await pollUntil(() => !D.getElementById('add-confirm-error').classList.contains('hidden'), 30000);
    check('a Bitcoin address pasted into the TRC-20 slot shows the real server rejection',
      /TRON|TRC-20/.test(D.getElementById('add-confirm-error').textContent), D.getElementById('add-confirm-error').textContent);
    D.getElementById('add-modal-close').click();

    // --- Assign two clients through the real Assign modal ---
    const assignBtnFor = () => [...D.querySelectorAll('.assign-btn')].find((b) => b.dataset.address === btcRow.id);
    assignBtnFor().click();
    check('the Assign modal names the route and shows the full address',
      /Bitcoin/.test(D.getElementById('assign-route-label').textContent) && D.getElementById('assign-address-label').textContent === BTC_ADDRESS);
    D.getElementById('assign-client').value = A.id;
    D.getElementById('assign-submit').click();
    await pollUntil(async () => ((await admin.from('deposit_address_assignments').select('id').eq('address_id', btcRow.id).is('removed_at', null)).data || []).length === 1, 30000);
    await pollUntil(() => /1 client(?!s)/.test(listEl().textContent) && !/animate-pulse/.test(listEl().innerHTML), 30000);
    check('★ assigning client A through the real UI creates a real assignment and the row reads "1 client" / Assigned',
      /1 client(?!s)/.test(listEl().textContent) && /Assigned/.test(listEl().textContent), listEl().textContent.slice(0, 200));
    check('...the row is auto-expanded into the management view', !!D.querySelector('.expand-row'));
    check('...which lists A with an assignment date and "None yet" for last deposit',
      new RegExp(A.name).test(D.querySelector('.expand-row').textContent) && /None yet/.test(D.querySelector('.expand-row').textContent));

    // Second client on the SAME address.
    [...D.querySelectorAll('.expand-row .assign-btn')][0].click();
    const optionA = [...D.querySelectorAll('#assign-client option')].find((o) => o.value === A.id);
    check('the Assign modal disables a client already on this address', optionA && optionA.disabled === true);
    D.getElementById('assign-client').value = B.id;
    D.getElementById('assign-submit').click();
    await pollUntil(() => /2 clients/.test(listEl().textContent) && !/animate-pulse/.test(listEl().innerHTML), 30000);
    check('★ a second client on the same address: row reads "2 clients"', /2 clients/.test(listEl().textContent));
    check('★ the sharing consequence is stated in the management view',
      /Shared by 2 clients/.test(D.querySelector('.expand-row').textContent) && /chain alone will not say who sent what/.test(D.querySelector('.expand-row').textContent),
      D.querySelector('.expand-row').textContent.slice(0, 300));
    check('...avatars render real initials for both', /RA/.test(D.querySelector('.address-row').textContent) && /RB/.test(D.querySelector('.address-row').textContent),
      D.querySelector('.address-row').textContent.slice(0, 120));

    // ===== PART 2: both clients see it on deploy-capital.html; one submits with a hash, one without =====
    console.log('\n=== PART 2: deploy-capital.html — both clients see the address; submit with and without a hash ===\n');
    const dcPath = fileURLToPath(new URL('../deploy-capital.html', import.meta.url));
    async function loadDeployCapitalAs(client) {
      // useAdminClient() redirected MarketswaveData's cached client to admin-supabase-config's
      // singleton; re-authenticate THAT singleton as the client (same technique as
      // verify-hys-internal-ui-wiring.mjs Part 3).
      const { error } = await adminConfigMod.supabase.auth.signInWithPassword({ email: client.email, password: client.password });
      if (error) throw new Error('client sign-in: ' + error.message);
      const dom = buildPageDom(dcPath);
      dom.window.MarketswaveData = MarketswaveData;
      dom.window.QRCode = function (el, opts) { el.setAttribute('data-qr-text', opts.text); };
      dom.window.getAuthenticatedClientId = () => client.id;
      dom.window.refreshWithdrawAvailable = undefined;
      // ONE block: 'Deploy Capital logic' and 'UI Wiring — Stage 3' are markers in the SAME
      // inline script. Evaluating it once per marker registered every listener twice, with two
      // competing closures over the same DOM - a test-harness bug that first showed up as
      // "submit created no request", not a page bug.
      dom.window.eval(extractInlineScript(dcPath, 'UI Wiring — Stage 3'));
      return dom;
    }

    // Client A: with a hash.
    let domA = await loadDeployCapitalAs(A);
    let P = domA.window.document;
    [...P.querySelectorAll('.option-card')].find((c) => c.dataset.method === 'crypto').click();
    await pollUntil(() => P.querySelectorAll('.dep-choice').length === 4 && !/animate-pulse/.test(P.getElementById('crypto-address-region').innerHTML), 30000);
    check('the crypto form offers FOUR distinct currency choices', P.querySelectorAll('.dep-choice').length === 4, String(P.querySelectorAll('.dep-choice').length));
    const choiceLabels = [...P.querySelectorAll('.dep-choice')].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
    check('...USDT TRC-20 and USDT ERC-20 are two separate choices, no network toggle anywhere',
      choiceLabels.filter((l) => /Tether/.test(l)).length === 2 && !P.getElementById('crypto-network'), JSON.stringify(choiceLabels));
    check('...and no amount field exists on the crypto form', !P.getElementById('crypto-amount'));
    check('Bitcoin is selected by default and its address card is shown',
      P.querySelector('.dep-choice.is-selected') && P.querySelector('.dep-choice.is-selected').dataset.currency === 'BTC' && !P.getElementById('crypto-address-card').classList.contains('hidden'));
    check('★ client A sees the REAL assigned address', P.getElementById('crypto-address-value').textContent === BTC_ADDRESS, P.getElementById('crypto-address-value').textContent);
    const cardText = P.getElementById('crypto-address-card').textContent;
    check('the network is named in the label chip, the warning, and the address heading',
      /Bitcoin network/.test(P.getElementById('crypto-network-chip').textContent) && /Bitcoin network only/.test(P.getElementById('crypto-warning-title').textContent) && /Your Bitcoin deposit address/.test(cardText),
      cardText.slice(0, 200));
    check('the wrong-network warning says funds are permanently lost', /permanently lost/.test(P.getElementById('crypto-warning-body').textContent));
    check('a copy button and a QR code are rendered for the real address',
      !!P.getElementById('crypto-copy-btn') && P.getElementById('crypto-qr').getAttribute('data-qr-text') === BTC_ADDRESS);
    check('the transaction hash field is optional and nudged as strongly recommended',
      !!P.getElementById('crypto-tx-hash') && /Strongly recommended/.test(P.getElementById('crypto-hash-hint').textContent) && /match your transfer to you directly/.test(P.getElementById('crypto-hash-hint').textContent));

    // Switching to a route with no address shows the empty state, not a blank.
    [...P.querySelectorAll('.dep-choice')].find((c) => c.dataset.currency === 'USDT' && c.dataset.network === 'TRC-20').click();
    check('★ a route with NO assigned address shows the empty state (PM assigns per client) — not a dead end',
      !P.getElementById('crypto-empty-state').classList.contains('hidden') && /assigns a dedicated deposit address/.test(P.getElementById('crypto-empty-state').textContent),
      P.getElementById('crypto-empty-state').textContent.slice(0, 200));
    check('...with a real route into the support inbox and the submit control hidden',
      !!P.getElementById('crypto-empty-message-pm') && (!P.getElementById('crypto-submit-row') || P.getElementById('crypto-submit-row').classList.contains('hidden')));
    check('...and the empty state names the network too', /Tether \(TRC-20/.test(P.getElementById('crypto-empty-state').textContent), P.getElementById('crypto-empty-state').textContent.slice(0, 200));

    // Back to BTC and submit with a hash.
    [...P.querySelectorAll('.dep-choice')].find((c) => c.dataset.currency === 'BTC').click();
    P.getElementById('crypto-tx-hash').value = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    P.getElementById('submit-crypto').click();
    await pollUntil(async () => ((await admin.from('deposit_requests').select('id').eq('client_id', A.id)).data || []).length === 1, 30000);
    const reqA = (await admin.from('deposit_requests').select('*').eq('client_id', A.id).maybeSingle()).data;
    if (!reqA) console.log('      DIAG toast: ' + P.getElementById('funding-toast-title').textContent + ' — ' + P.getElementById('funding-toast-body').textContent);
    check('★ A submits through the real form: a real pending request with NO amount, the hash, and the address snapshot',
      reqA && reqA.status === 'pending' && reqA.requested_amount === null && /^e3b0/.test(reqA.tx_hash) && reqA.deposit_address_id === btcRow.id && reqA.network === 'Bitcoin', JSON.stringify(reqA));
    await pollUntil(() => !!P.getElementById('crypto-pending-card'), 30000); // the region is rebuilt after submit; the card exists only once the reload has rendered
    const pendText = P.getElementById('crypto-pending-card').textContent;
    check('the pending view names the currency + network, the submitted time, and the reference',
      /Bitcoin · Bitcoin network/.test(pendText) && /Submitted/.test(pendText) && pendText.indexOf(reqA.id) !== -1, pendText.slice(0, 300));
    check('...and says the amount is determined on receipt rather than leaving a blank',
      /amount received/i.test(pendText) && !/\$0/.test(pendText));
    await pollUntil(() => P.getElementById('my-funding-requests-list').textContent.indexOf(reqA.id) !== -1 && !/animate-pulse/.test(P.getElementById('my-funding-requests-list').innerHTML), 30000);
    const fundingRow = [...P.querySelectorAll('#my-funding-requests-list tr')].find((tr) => tr.textContent.indexOf(reqA.id) !== -1);
    check('My Funding Requests shows the crypto request with "Determined on receipt" in the amount column, not a blank or $0',
      fundingRow && /Determined on receipt/.test(fundingRow.textContent) && !/\$0\b/.test(fundingRow.textContent), fundingRow && fundingRow.textContent);
    check('...and names the currency and network in the method column', fundingRow && /BTC · Bitcoin/.test(fundingRow.textContent), fundingRow && fundingRow.textContent);

    // Client B: without a hash.
    let domB = await loadDeployCapitalAs(B);
    P = domB.window.document;
    [...P.querySelectorAll('.option-card')].find((c) => c.dataset.method === 'crypto').click();
    await pollUntil(() => !/animate-pulse/.test(P.getElementById('crypto-address-region').innerHTML) && P.getElementById('crypto-address-value').textContent === BTC_ADDRESS, 30000);
    check('★ client B (second real client on the SAME address) sees it too', P.getElementById('crypto-address-value').textContent === BTC_ADDRESS, P.getElementById('crypto-address-value').textContent);
    P.getElementById('submit-crypto').click();
    await pollUntil(async () => ((await admin.from('deposit_requests').select('id').eq('client_id', B.id)).data || []).length === 1, 30000);
    const reqB = (await admin.from('deposit_requests').select('*').eq('client_id', B.id).single()).data;
    check('★ B submits WITHOUT a hash: a real pending request, tx_hash null, no amount', reqB && reqB.status === 'pending' && reqB.tx_hash === null && reqB.requested_amount === null, JSON.stringify(reqB));

    // Client C: assigned nothing — every route shows the empty state; nothing leaks.
    let domC = await loadDeployCapitalAs(C);
    P = domC.window.document;
    [...P.querySelectorAll('.option-card')].find((c) => c.dataset.method === 'crypto').click();
    await pollUntil(() => !/animate-pulse/.test(P.getElementById('crypto-address-region').innerHTML), 30000);
    check('★ client C, assigned nothing, sees the empty state — and A/B\'s address never leaks into their page',
      !P.getElementById('crypto-empty-state').classList.contains('hidden') && P.body.textContent.indexOf(BTC_ADDRESS) === -1);

    // ===== PART 3: the admin queue renders amount-less rows and credits at two different figures =====
    console.log('\n=== PART 3: admin-deposits.html — amount-less rows, PM credits two different amounts ===\n');
    await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    const queuePath = fileURLToPath(new URL('../admin-deposits.html', import.meta.url));
    const queueDom = buildPageDom(queuePath);
    queueDom.window.MarketswaveData = MarketswaveData;
    const Q = queueDom.window.document;
    queueDom.window.eval(extractInlineScript(queuePath, 'Admin UI Wiring'));
    const pendingEl = Q.getElementById('pending-list');
    await pollUntil(() => pendingEl.textContent.indexOf(reqA.id) !== -1 && pendingEl.textContent.indexOf(reqB.id) !== -1, 30000);
    const cardA = [...pendingEl.querySelectorAll('.credit-btn')].find((b) => b.dataset.id === reqA.id).closest('.px-6');
    check('the queue renders an amount-less crypto row without breaking', !!cardA && !/undefined|null|NaN/.test(cardA.textContent), cardA && cardA.textContent.slice(0, 200));
    check('...saying the amount is determined from the chain, naming the currency + network',
      /Determined from the chain|determined from the chain/.test(cardA.textContent) && /BTC/.test(cardA.textContent) && /Bitcoin/.test(cardA.textContent), cardA.textContent.slice(0, 300));
    check('...showing A\'s transaction hash and the address it was sent to',
      /e3b0c442/.test(cardA.textContent) && cardA.textContent.indexOf(BTC_ADDRESS.slice(0, 8)) !== -1, cardA.textContent.slice(0, 300));
    const cardB = [...pendingEl.querySelectorAll('.credit-btn')].find((b) => b.dataset.id === reqB.id).closest('.px-6');
    check('B\'s row says no hash was provided (and why that matters)', /No transaction hash/.test(cardB.textContent), cardB.textContent.slice(0, 300));

    [...pendingEl.querySelectorAll('.credit-btn')].find((b) => b.dataset.id === reqA.id).click();
    check('the Credit modal for a crypto request asks for the amount received, with an EMPTY field (nothing to pre-fill)',
      Q.getElementById('credit-amount-input').value === '' && /received/i.test(Q.getElementById('credit-crypto-copy').textContent) && Q.getElementById('credit-external-copy').classList.contains('hidden'),
      Q.getElementById('credit-crypto-copy').textContent);
    Q.getElementById('credit-amount-input').value = '4250.5';
    Q.getElementById('credit-submit').click();
    await pollUntil(async () => (await admin.from('deposit_requests').select('status').eq('id', reqA.id).single()).data.status === 'credited', 30000);
    await pollUntil(() => pendingEl.textContent.indexOf(reqA.id) === -1 && !/animate-pulse/.test(pendingEl.innerHTML), 30000);
    [...pendingEl.querySelectorAll('.credit-btn')].find((b) => b.dataset.id === reqB.id).click();
    Q.getElementById('credit-amount-input').value = '910';
    Q.getElementById('credit-submit').click();
    await pollUntil(async () => (await admin.from('deposit_requests').select('status').eq('id', reqB.id).single()).data.status === 'credited', 30000);
    const stA = (await admin.from('account_state').select('unallocated_capital').eq('client_id', A.id).single()).data;
    const stB = (await admin.from('account_state').select('unallocated_capital').eq('client_id', B.id).single()).data;
    check('★ both credited through the real UI at DIFFERENT PM-entered amounts, each landing on its own account',
      Number(stA.unallocated_capital) === 4250.5 && Number(stB.unallocated_capital) === 910, JSON.stringify([stA, stB]));
    await pollUntil(() => Q.getElementById('history-list').textContent.indexOf(reqB.id) !== -1 && !/animate-pulse/.test(Q.getElementById('history-list').innerHTML), 30000);
    const histRowA = [...Q.querySelectorAll('#history-list tr')].find((tr) => tr.textContent.indexOf(reqA.id) !== -1);
    check('History shows "—" for the requested amount and the credited figure WITHOUT a spurious "(differs)"',
      histRowA && /—/.test(histRowA.textContent) && /4,251|4,250/.test(histRowA.textContent) && !/differs/.test(histRowA.textContent), histRowA && histRowA.textContent);

    // The address book now shows a real "last deposit" for both clients.
    bookDom = buildPageDom(bookPath);
    bookDom.window.MarketswaveData = MarketswaveData;
    bookDom.window.eval(engineCoreSource);
    D = bookDom.window.document;
    bookDom.window.eval(extractInlineScript(bookPath, 'the shared deposit address book'));
    await pollUntil(() => !/animate-pulse/.test(D.getElementById('addresses-list').innerHTML) && D.getElementById('addresses-list').textContent.indexOf('UI Test BTC ' + suffix) !== -1, 30000);
    [...D.querySelectorAll('.manage-btn')].find((b) => b.dataset.id === btcRow.id).click();
    const expanded = D.querySelector('.expand-row');
    const today = new Date().toISOString().slice(0, 10);
    check('the management view now shows today as "last deposit" for both clients (no "None yet")',
      expanded && (expanded.textContent.match(new RegExp(today, 'g')) || []).length >= 2 && !/None yet/.test(expanded.textContent), expanded && expanded.textContent.slice(0, 300));

    // ===== PART 4: remove both -> retired, and the retired address cannot be reassigned via the UI =====
    console.log('\n=== PART 4: retirement through the real UI ===\n');
    const removeBtns = [...expanded.querySelectorAll('.remove-btn')];
    removeBtns[0].click();
    check('removing the first of two clients does NOT warn about retirement', D.getElementById('remove-retire-warning').classList.contains('hidden'));
    D.getElementById('remove-submit').click();
    await pollUntil(() => !/animate-pulse/.test(D.getElementById('addresses-list').innerHTML) && /1 client(?!s)/.test(D.getElementById('addresses-list').textContent), 30000);
    const lastRemove = D.querySelector('.expand-row .remove-btn');
    lastRemove.click();
    check('★ removing the LAST client warns that the address will be retired permanently',
      !D.getElementById('remove-retire-warning').classList.contains('hidden') && /permanently/.test(D.getElementById('remove-retire-warning').textContent));
    D.getElementById('remove-submit').click();
    await pollUntil(async () => (await admin.from('deposit_addresses').select('status').eq('id', btcRow.id).single()).data.status === 'retired', 30000);
    await pollUntil(() => /Retired/.test(D.getElementById('addresses-list').textContent) && !/animate-pulse/.test(D.getElementById('addresses-list').innerHTML), 30000);
    check('the row now reads Retired / "Previously 2 clients"', /Previously 2 clients/.test(D.getElementById('addresses-list').textContent), D.getElementById('addresses-list').textContent.slice(0, 200));
    check('...and offers no Assign control anywhere for it', ![...D.querySelectorAll('.assign-btn')].some((b) => b.dataset.address === btcRow.id));
    const retireDirect = await admin.from('deposit_address_assignments').insert({ address_id: btcRow.id, client_id: C.id, currency: 'BTC', network: 'Bitcoin' });
    check('★★ and the DATABASE refuses a direct reassignment regardless of any UI', !!retireDirect.error && /DEPOSIT_ADDRESS_RETIRED/.test(retireDirect.error.message), JSON.stringify(retireDirect.error));

    // A's Deploy Capital page now shows the empty state for BTC again (no longer assigned).
    domA = await loadDeployCapitalAs(A);
    P = domA.window.document;
    [...P.querySelectorAll('.option-card')].find((c) => c.dataset.method === 'crypto').click();
    await pollUntil(() => !/animate-pulse/.test(P.getElementById('crypto-address-region').innerHTML), 30000);
    check('after removal, A\'s page shows the empty state and the retired address is gone from it',
      !P.getElementById('crypto-empty-state').classList.contains('hidden') && P.body.textContent.indexOf(BTC_ADDRESS) === -1);
  } finally {
    await admin.from('deposit_requests').delete().in('client_id', ids);
    await admin.from('transactions').delete().in('client_id', ids);
    await admin.from('account_state').delete().in('client_id', ids);
    await admin.from('email_log').delete().like('recipient', 'deprtui-%');
    if (addressIds.length) {
      await admin.from('deposit_address_assignments').delete().in('address_id', addressIds);
      await admin.from('deposit_addresses').delete().in('id', addressIds);
    }
    for (const id of ids) {
      await admin.from('clients').delete().eq('id', id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log('  cleanup: deleteUser -> ' + error.message);
    }
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  if (failed > 0) { console.log('\nVERIFY: FAIL (' + failed + ' assertion(s) failed)'); process.exit(1); }
  console.log('\nVERIFY: PASS');
  process.exit(0);
}

main().catch(function (err) {
  console.error('\nVERIFY FAILED WITH AN ERROR: ' + (err && err.message ? err.message : err));
  console.error(err && err.stack);
  process.exit(1);
});
