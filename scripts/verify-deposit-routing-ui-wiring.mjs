#!/usr/bin/env node
// ★ Crypto deposit routing (2026-09-11) — UI verification.
//
// Drives the REAL, unmodified inline scripts of admin-deposit-addresses.html,
// the approval gate and deploy-capital.html inside real jsdom DOMs built from each page's
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

    // ★ PART 1's ADMIN-UI HALF IS RETIRED (2026-09-17). PM tool revamp part 7 rebuilt
    // admin-deposit-addresses.html onto an EXTERNAL admin-deposit-addresses-page.js with a
    // wholly different control set — blocked clients first, the book grouped by currency AND
    // network, one overlay panel instead of three modals — so the inline script and the
    // `.address-row` / `.expand-row` / `.assign-btn` markup this section drove no longer exist.
    // Every assertion it carried moved to verify-deposit-address-book-ui-wiring.mjs, and was
    // ported rather than dropped — the mapping, so a future reader can check:
    //
    //   the two-step review showing the address back        → its PART 6
    //   a structurally-bad address refused with the real     → its PART 6 (live, before submit,
    //     server message                                        AND through the real function)
    //   assign through the real UI, the row reading           → its PART 7
    //     "1 client" / Assigned
    //   a client already on the address disabled in the       → its assignHTML options, asserted
    //     picker                                                 in PART 7
    //   the sharing consequence stated for a shared address   → its PART 5 (the panel's own
    //                                                            "will not say who sent what")
    //   avatars rendering real initials                       → its PART 4
    //
    // What stays here is the SETUP those client-facing parts need — a real address, assigned to
    // two real clients — performed through the real Edge Functions rather than through a page
    // that no longer has those controls.
    console.log('(PART 1\'s admin-UI half is retired — see verify-deposit-address-book-ui-wiring.mjs)');
    const addedBtc = await MarketswaveData.callFunction('add-deposit-address', {
      currency: 'BTC', network: 'Bitcoin', address: BTC_ADDRESS, label: 'UI Test BTC ' + suffix
    });
    check('a real BTC address is created for the client-facing parts below',
      !!addedBtc && !!addedBtc.id && addedBtc.status === 'available', JSON.stringify(addedBtc).slice(0, 140));
    const btcRow = (await admin.from('deposit_addresses').select('*').eq('id', addedBtc.id).single()).data;
    addressIds.push(btcRow.id);

    let rejectedMsg = '';
    try {
      await MarketswaveData.callFunction('add-deposit-address', {
        currency: 'USDT', network: 'TRC-20', address: BTC_ADDRESS
      });
    } catch (e) { rejectedMsg = MarketswaveData.writeErrorMessage(e); }
    check('a Bitcoin address in the TRC-20 slot is still refused by the real server',
      /TRON|starts with T/i.test(rejectedMsg), rejectedMsg);

    await MarketswaveData.callFunction('assign-deposit-address', { addressId: btcRow.id, clientId: A.id });
    await MarketswaveData.callFunction('assign-deposit-address', { addressId: btcRow.id, clientId: B.id });
    const { data: bothAssigned } = await admin.from('deposit_address_assignments')
      .select('client_id').eq('address_id', btcRow.id).is('removed_at', null);
    check('both clients are genuinely assigned to it — the shared-address case these parts need',
      (bothAssigned || []).length === 2, String((bothAssigned || []).length));

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
    await pollUntil(() => P.querySelectorAll('.dep-choice').length >= 4 && !/animate-pulse/.test(P.getElementById('crypto-address-region').innerHTML), 30000);
    // ★ The count is read from the REAL deposit_routes table, never hardcoded. It was 4 until
    // PM tool revamp part 7 added PYUSD, and this assertion failing on a 5th was the feature
    // working — a client-facing picker that does NOT grow when a route is added is the bug.
    const { data: liveRoutes } = await admin.from('deposit_routes').select('currency, network');
    check('the crypto form offers one choice per real route (' + liveRoutes.length + ')',
      P.querySelectorAll('.dep-choice').length === liveRoutes.length,
      P.querySelectorAll('.dep-choice').length + ' vs ' + liveRoutes.length);
    check('★ ...including PayPal USD, which reached the client picker with no page change',
      [...P.querySelectorAll('.dep-choice')].some((c) => c.dataset.currency === 'PYUSD'),
      [...P.querySelectorAll('.dep-choice')].map((c) => c.dataset.currency).join(','));
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

    // ===== PART 3: the approval gate renders amount-less rows and credits at two figures =====
    // admin-deposits.html was deleted when the approval gate replaced all seven queue pages
    // (register row 228). These behaviours belong to deposit routing, not to the gate, so they
    // were repointed at the page that carries them now rather than moved: an amount-less
    // crypto row must render without breaking, must name the currency/network/hash/address a
    // PM needs to confirm it, must open with an EMPTY amount field, and two such requests must
    // credit at two different PM-entered figures onto two different accounts.
    console.log('\n=== PART 3: the approval gate — amount-less rows, PM credits two different amounts ===\n');
    await adminConfigMod.supabase.auth.signInWithPassword({ email: adminConfigMod.LOCAL_ADMIN_EMAIL, password: adminConfigMod.LOCAL_ADMIN_PASSWORD });
    const queuePath = fileURLToPath(new URL('../admin-approvals.html', import.meta.url));
    const queueDom = buildPageDom(queuePath);
    queueDom.window.MarketswaveData = MarketswaveData;
    const Q = queueDom.window.document;
    // The gate's logic is an external file, not an inline block.
    // The real page loads format-helpers.js before its own script (sortHeaderHTML(), row 252).
    queueDom.window.eval(readFileSync(fileURLToPath(new URL('../format-helpers.js', import.meta.url)), 'utf8'));
    queueDom.window.eval(readFileSync(fileURLToPath(new URL('../admin-approvals-page.js', import.meta.url)), 'utf8'));
    const pendingEl = Q.getElementById('ag-queue');
    const gateRow = (id) => pendingEl.querySelector('.ag-row[data-kind="dep"][data-id="' + id + '"]');
    await pollUntil(() => !/animate-pulse/.test(pendingEl.innerHTML) && gateRow(reqA.id) && gateRow(reqB.id), 30000);

    const cardA = gateRow(reqA.id);
    const textA = (cardA.textContent || '').replace(/\s+/g, ' ');
    check('the queue renders an amount-less crypto row without breaking', !/undefined|null|NaN/.test(textA), textA.slice(0, 200));
    check('...naming the currency, and saying the PM is the one who sets the amount',
      /Crypto · BTC/.test(textA) && /PM sets amount/.test(textA), textA.slice(0, 200));
    check('...and showing that A\'s transaction hash was provided', /Hash e3b0c4/.test(textA), textA.slice(0, 200));
    const textB = (gateRow(reqB.id).textContent || '').replace(/\s+/g, ' ');
    check('B\'s row says no hash was provided', /No hash provided/.test(textB), textB.slice(0, 200));

    const openDep = async (id) => {
      gateRow(id).click();
      await pollUntil(() => !Q.getElementById('ag-scrim').hidden && Q.getElementById('ag-pane').innerHTML.length > 0, 8000);
      return (Q.getElementById('ag-pane').textContent || '').replace(/\s+/g, ' ');
    };
    const paneA = await openDep(reqA.id);
    check('★ the panel opens with an EMPTY amount field — a crypto deposit has nothing to pre-fill',
      Q.getElementById('ag-amount').value === '' && /Amount received/i.test(paneA), Q.getElementById('ag-amount').value);
    check('...naming the currency AND the network, the address it was sent to, and the full hash',
      /BTC · Bitcoin/.test(paneA) && paneA.indexOf(BTC_ADDRESS) !== -1 && /e3b0c442/.test(paneA), paneA.slice(0, 400));
    check('...and how many clients share that address, since the PM must confirm the hash is THIS client\'s',
      /Shared with\s*2 clients/.test(paneA), paneA.slice(0, 400));

    Q.getElementById('ag-amount').value = '4250.5';
    Q.getElementById('ag-approve').click();
    await pollUntil(async () => (await admin.from('deposit_requests').select('status').eq('id', reqA.id).single()).data.status === 'credited', 30000);
    await pollUntil(() => !gateRow(reqA.id) && !/animate-pulse/.test(pendingEl.innerHTML), 30000);
    await openDep(reqB.id);
    Q.getElementById('ag-amount').value = '910';
    Q.getElementById('ag-approve').click();
    await pollUntil(async () => (await admin.from('deposit_requests').select('status').eq('id', reqB.id).single()).data.status === 'credited', 30000);
    const stA = (await admin.from('account_state').select('unallocated_capital').eq('client_id', A.id).single()).data;
    const stB = (await admin.from('account_state').select('unallocated_capital').eq('client_id', B.id).single()).data;
    check('★ both credited through the real UI at DIFFERENT PM-entered amounts, each landing on its own account',
      Number(stA.unallocated_capital) === 4250.5 && Number(stB.unallocated_capital) === 910, JSON.stringify([stA, stB]));

    Q.getElementById('ag-view-history').click();
    await pollUntil(() => Q.querySelectorAll('#ag-hrows .ag-hrow').length > 0
      && Q.getElementById('ag-hrows').textContent.indexOf('DEP-' + String(reqA.id).slice(0, 8)) !== -1, 30000);
    const histRowA = [...Q.querySelectorAll('#ag-hrows .ag-hrow')].find((tr) => tr.textContent.indexOf('DEP-' + String(reqA.id).slice(0, 8)) !== -1);
    check('★ History shows the credited figure WITHOUT a spurious "(differs)" — nothing was requested to differ from',
      histRowA && /4,251|4,250/.test(histRowA.textContent) && !histRowA.querySelector('.ag-differs'), histRowA && histRowA.textContent);

    // ★ RETIRED with the rest of PART 1's admin-UI half (2026-09-17). The same proof now runs
    // against the rebuilt page in verify-deposit-address-book-ui-wiring.mjs's PART 5, which
    // reads the panel's own per-client "last deposit" line. What is checked here instead is the
    // FACT that proof depends on: the book's own read genuinely reports a last-deposit date per
    // client once a deposit has been credited.
    const bookNow = await MarketswaveData.callFunction('get-deposit-address-book');
    const bookedRow = bookNow.addresses.filter(function (a) { return a.id === btcRow.id; })[0];
    const today = new Date().toISOString().slice(0, 10);
    check('the address book reports a real last-deposit date for both clients (never "no deposits yet")',
      !!bookedRow && bookedRow.clients.length === 2 &&
      bookedRow.clients.every(function (c) { return c.lastDepositAt && String(c.lastDepositAt).slice(0, 10) === today; }),
      bookedRow && JSON.stringify(bookedRow.clients.map(function (c) { return c.lastDepositAt; })));


    // ===== PART 4: retirement, enforced server-side =====
    // ★ PART 4's ADMIN-UI HALF IS RETIRED (2026-09-17), for the same reason as PART 1's. Where
    // each assertion now lives in verify-deposit-address-book-ui-wiring.mjs:
    //
    //   removing one of two clients does NOT warn about retirement → its PART 8 (the warning
    //     text branches on whether this is the LAST client, and both branches are asserted)
    //   removing the LAST client warns it will be retired            → its PART 8
    //   the row reading Retired / "Previously N clients"             → its PART 9
    //   no Assign control offered for a retired address              → its PART 9
    //
    // The DATABASE-level refusal below is NOT retired and stays here: it is the proof that the
    // guarantee is server-side rather than a UI convention, which is the whole point of it.
    console.log('(PART 4\'s admin-UI half is retired — see verify-deposit-address-book-ui-wiring.mjs)');
    const { data: asgRows } = await admin.from('deposit_address_assignments')
      .select('id, client_id').eq('address_id', btcRow.id).is('removed_at', null);
    check('GUARD: two live assignments to remove', (asgRows || []).length === 2, String((asgRows || []).length));
    for (const row of asgRows) {
      await MarketswaveData.callFunction('remove-deposit-address-assignment', { assignmentId: row.id });
    }
    const { data: retiredNow } = await admin.from('deposit_addresses').select('status').eq('id', btcRow.id).single();
    check('★ removing the last client RETIRES the address — a server-side trigger, not the UI',
      retiredNow.status === 'retired', retiredNow.status);
    const retireDirect = await admin.from('deposit_address_assignments')
      .insert({ address_id: btcRow.id, client_id: A.id });
    check('★★ and the DATABASE refuses a direct reassignment regardless of any UI',
      !!retireDirect.error && /DEPOSIT_ADDRESS_RETIRED|retired/i.test(retireDirect.error.message),
      retireDirect.error && retireDirect.error.message);

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
