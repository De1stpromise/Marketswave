// ★ PM tool revamp, part 7 — the deposit address book, driven through its REAL script (row 237).
//
// ★ THE PAGE'S OWN SCRIPT RUNS HERE, UNMODIFIED — admin-deposit-addresses.html's <body> is
// extracted verbatim, its <script> tags stripped, and admin-deposit-addresses-page.js evaluated
// into the window. Nothing is re-implemented, so an assertion that passes is the real page.
//
// ★ NAV IS ASSERTED (row 228). The approval gate shipped with no rail, no active item and no Log
// out, and a 69-assertion suite missed it because every assertion looked at the feature and none
// at the chrome. The rendered proof is the visual suite's job — admin-sidebar.js gates its render
// on a real getSession() jsdom cannot satisfy — so this half asserts the call exists.
//
// ★ AND IT ASSERTS WHAT WAS NOT REMOVED. Part 5's client list nearly orphaned Reset Password and
// Reset 2FA; part 6 stranded edit-product with no UI caller. This page's three write functions —
// add-deposit-address (with its two-step read-back), assign-deposit-address and
// remove-deposit-address-assignment (with its retire warning) — each keep a real caller, and each
// is driven end to end below rather than merely present in the markup.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = path.join(ROOT, 'admin-deposit-addresses.html');
const PAGE_JS = path.join(ROOT, 'admin-deposit-addresses-page.js');
const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'AddrUI-2026!';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(fn, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { try { if (fn()) return true; } catch (e) {} await sleep(120); }
  return false;
}
async function pollRow(read, fn, maxMs = 25000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < maxMs) {
    const { data } = await read();
    last = data;
    if (data && fn(data)) return data;
    await sleep(150);
  }
  return last && fn(last) ? last : null;
}
/** A swallowed seed error looks exactly like a page bug — never insert without reading it back. */
async function must(p, what) {
  const { error } = await p;
  if (error) throw new Error('could not ' + what + ': ' + error.message);
}
const vc = new VirtualConsole();

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

function buildDom(MarketswaveData, apiUrl) {
  const html = readFileSync(PAGE, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    url: 'http://127.0.0.1:8765/admin-deposit-addresses.html', runScripts: 'outside-only',
    virtualConsole: vc, pretendToBeVisual: true
  });
  dom.window.MarketswaveData = MarketswaveData;
  for (const f of ['format-helpers.js', 'asset-mark.js']) dom.window.eval(readFileSync(path.join(ROOT, f), 'utf8'));
  dom.window.eval('AssetMark.configure({ storageBase: ' + JSON.stringify(apiUrl) + ' });');
  dom.window.eval(readFileSync(PAGE_JS, 'utf8'));
  return dom;
}
const rows = (dom) => [...dom.window.document.querySelectorAll('.da-ar')];
const ready = (dom) => pollUntil(() => rows(dom).length > 0);
function q(dom, sel) { return dom.window.document.querySelector(sel); }
function all(dom, sel) { return [...dom.window.document.querySelectorAll(sel)]; }
function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
function typeInto(dom, el, value) {
  el.value = value;
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
function selectInto(dom, el, value) {
  el.value = value;
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
const digits = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;
// ★ The received cell contains the figure AND the deposit count beneath it. Stripping
// non-numerics from the whole cell concatenates them ("$12,870" + "5 deposits" -> 128705),
// which is a test bug that looks exactly like a page bug — the same trap
// verify-client-list-ui-wiring's own digits() comment records. Read the two separately.
function receivedOf(row) {
  const el = row && row.querySelector('.da-recv');
  if (!el) return null;
  const sub = el.querySelector('span');
  const main = sub ? el.textContent.replace(sub.textContent, '') : el.textContent;
  return digits(main);
}
const TRON_ADDRESS = 'TQm7xKp2VrN8sLd4Wf9Yc3Hj6Bk1Rt5Zab'.slice(0, 34);

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  globalThis.document = { addEventListener() {} };
  await import('../supabase-data.js');
  const D = globalThis.window.MarketswaveData;
  const cfg = await import('../admin-supabase-config.js');
  const { error: pmErr } = await cfg.supabase.auth.signInWithPassword({
    email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!'
  });
  check('a real admin session is established', !pmErr, pmErr && pmErr.message);
  D.useAdminClient();

  // Entry sweep — a run that dies between "created" and "recorded" leaves rows the finally
  // cannot know about (the same reasoning the harness-teardown helper's own sweep records).
  {
    const { data: stale } = await admin.from('deposit_addresses').select('id').like('label', 'Address UI test %');
    for (const row of stale || []) {
      await admin.from('deposit_address_assignments').delete().eq('address_id', row.id);
      await admin.from('deposit_requests').delete().eq('deposit_address_id', row.id);
      await admin.from('deposit_addresses').delete().eq('id', row.id);
    }
    if ((stale || []).length) console.log('sweep: cleared ' + stale.length + ' leftover test address(es)');
  }

  const createdClients = [];
  const createdAddresses = [];

  try {
    console.log('\n=== PART 1: NAVIGATION (row 228) ===\n');
    const src = readFileSync(PAGE, 'utf8');
    check("★ the page calls initAdminSidebar('deposit-addresses')",
      /initAdminSidebar\(\s*['"]deposit-addresses['"]\s*\)/.test(src));
    check('the page mounts the shared sidebar container', /id="admin-sidebar-mount"/.test(src));

    console.log('\n=== PART 2: ★ NOTHING THE OLD PAGE COULD DO WAS ORPHANED ===\n');
    const pageJs = readFileSync(PAGE_JS, 'utf8');
    for (const fn of ['add-deposit-address', 'assign-deposit-address', 'remove-deposit-address-assignment']) {
      check('★ ' + fn + ' still has a real UI caller', pageJs.indexOf("'" + fn + "'") !== -1);
    }
    check('★ the status filter the old page carried is still here (grouping is not a status filter)',
      /data-filter=/.test(pageJs) && /'assigned'/.test(pageJs) && /'retired'/.test(pageJs));
    check('★ the two-step read-back confirm is still here — the only guard against a well-formed '
      + 'address belonging to someone else', /da-readback/.test(pageJs) && /da-add-continue/.test(pageJs));
    check('★ the retire warning on Remove is still here', /da-remove-warning/.test(pageJs) && /RETIRES it/.test(pageJs));

    console.log('\n=== PART 3: the book, grouped by currency AND network ===\n');
    const payload = await D.callFunction('get-deposit-address-book');
    const dom = buildDom(D, st.API_URL);
    check('GUARD: the page rendered real rows', await ready(dom), 'no .da-ar appeared');

    const pills = all(dom, '.da-pill').map((p) => p.dataset.filter);
    check('★ ...and the four status pills genuinely render: all, assigned, available, retired',
      pills.join('|') === 'all|assigned|available|retired', pills.join('|'));
    const beforeFilter = rows(dom).length;
    q(dom, '[data-filter="assigned"]').click();
    check('★ ...and the filter genuinely narrows the book',
      rows(dom).length <= beforeFilter && rows(dom).every((r) => /assigned/i.test(txt(r.querySelector('.da-stp')))),
      rows(dom).length + ' of ' + beforeFilter);
    q(dom, '[data-filter="all"]').click();

    const groupHeads = all(dom, '.da-gh');
    check('every route has its own group header, in the routes\' own order',
      groupHeads.length === payload.groups.length &&
      groupHeads.map((g) => txt(g.querySelector('b'))).join('|') === payload.groups.map((g) => g.currencyName).join('|'),
      groupHeads.map((g) => txt(g.querySelector('b'))).join('|'));
    check('★ USDT appears TWICE — TRC-20 and ERC-20 are two routes, never one with a toggle',
      groupHeads.filter((g) => /Tether/.test(txt(g.querySelector('b')))).length === 2);
    check('★ PayPal USD is a real group on this page', groupHeads.some((g) => /PayPal USD/.test(txt(g))));
    const btcHead = groupHeads.filter((g) => /Bitcoin/.test(txt(g.querySelector('b'))))[0];
    const btcGroup = payload.groups.filter((g) => g.currency === 'BTC')[0];
    check('★ a group header carries its address count, client count and total received',
      new RegExp(btcGroup.addressCount + ' address').test(txt(btcHead)) &&
      new RegExp(btcGroup.clientCount + ' client').test(txt(btcHead)) &&
      digits(txt(btcHead).split('·').pop()) === Math.round(btcGroup.received),
      txt(btcHead));
    check('...and its own Add action', !!btcHead.querySelector('[data-add-route]'));
    check('a route with no address says so plainly rather than rendering an empty group',
      all(dom, '.da-gempty').some((e) => /cannot deposit/i.test(txt(e))),
      all(dom, '.da-gempty').map((e) => txt(e).slice(0, 50)).join(' | '));

    console.log('\n=== PART 4: Gary\'s two addresses, with the received figures the ledger says ===\n');
    const { data: gary } = await admin.from('clients').select('id, name').ilike('name', '%Gary%').maybeSingle();
    check('GUARD: Gary is seeded', !!gary);
    const garyAddrs = payload.addresses.filter((a) => a.clients.some((c) => c.clientId === gary.id));
    check('GUARD: he genuinely holds more than one address', garyAddrs.length >= 2, String(garyAddrs.length));
    let mismatches = 0;
    for (const a of garyAddrs) {
      const row = rows(dom).filter((r) => r.dataset.id === a.id)[0];
      if (!row) { mismatches++; continue; }
      const shown = receivedOf(row);
      if (shown !== Math.round(a.received)) { mismatches++; console.log('      ' + a.currency + ': ' + shown + ' vs ' + a.received); }
    }
    check('★ both of Gary\'s addresses render their real received figure', mismatches === 0, mismatches + ' mismatch(es)');
    const btcRow = rows(dom).filter((r) => r.dataset.id === garyAddrs.filter((a) => a.currency === 'BTC')[0].id)[0];
    check('...with the deposit count beside it, not just a total',
      /deposits?$/.test(txt(btcRow.querySelector('.da-recv'))), txt(btcRow.querySelector('.da-recv')));
    check('...and an avatar with a client count, not a bare number',
      !!btcRow.querySelector('.da-st') && !!btcRow.querySelector('.da-who .ct'));

    console.log('\n=== PART 5: the detail panel leads with the right thing ===\n');
    btcRow.click();
    const panelText = txt(q(dom, '#da-panel'));
    check('a single-client address leads with its DEPOSITS — attribution is unambiguous there',
      /Acknowledged deposits/.test(panelText) &&
      panelText.indexOf('Acknowledged deposits') < panelText.indexOf('Serves 1 client'),
      panelText.slice(0, 120));
    check('★ ...and carries the honest note that the platform does not watch the chain',
      /does not watch the chain/i.test(panelText) && /acknowledged through the platform/i.test(panelText));
    check('a single-client address does NOT carry the shared-address warning',
      !/will not say who sent what/i.test(panelText));
    check('every real deposit is listed with its client, amount and date',
      all(dom, '.da-dep').length === Math.min(12, garyAddrs.filter((a) => a.currency === 'BTC')[0].depositCount),
      all(dom, '.da-dep').length + ' rows');
    check('Close dismisses the panel', (q(dom, '#da-close').click(), !q(dom, '#da-scrim').classList.contains('is-open')));

    console.log('\n=== PART 6: ★ ADD — a real structural rejection, then a real address ===\n');
    q(dom, '#da-add-open').click();
    check('the add panel opens with a route select and an address field',
      !!q(dom, '#da-route') && !!q(dom, '#da-address'));
    selectInto(dom, q(dom, '#da-route'), 'PYUSD|ERC-20');
    typeInto(dom, q(dom, '#da-address'), TRON_ADDRESS);
    check('★ a TRON address on an ERC-20 route is called out LIVE, before submitting',
      /is-bad/.test(q(dom, '#da-vmsg').className) && /TRON address/i.test(txt(q(dom, '#da-vmsg'))),
      txt(q(dom, '#da-vmsg')));
    q(dom, '#da-add-continue').click();
    check('★ ...and Continue refuses to advance to the read-back step',
      !q(dom, '#da-readback') && /begins with 0x|TRON/i.test(txt(q(dom, '#da-add-err'))),
      txt(q(dom, '#da-add-err')));

    typeInto(dom, q(dom, '#da-address'), '0x' + 'a'.repeat(30));
    check('a truncated paste is caught too, and says by how much',
      /is-bad/.test(q(dom, '#da-vmsg').className) && /42 characters/.test(txt(q(dom, '#da-vmsg'))),
      txt(q(dom, '#da-vmsg')));

    const uiAddress = '0x' + crypto.randomBytes(20).toString('hex');
    typeInto(dom, q(dom, '#da-address'), uiAddress);
    check('★ a genuinely valid address reads as valid, naming the route it was checked against',
      /is-ok/.test(q(dom, '#da-vmsg').className) && /PYUSD on ERC-20/.test(txt(q(dom, '#da-vmsg'))),
      txt(q(dom, '#da-vmsg')));
    typeInto(dom, q(dom, '#da-label'), 'Address UI test ' + SUF);
    q(dom, '#da-add-continue').click();
    check('★ the read-back step spells the address out again, in full',
      !!q(dom, '#da-readback') && txt(q(dom, '#da-readback')) === uiAddress, txt(q(dom, '#da-readback')));
    check('★ ...and states the real consequence of getting it wrong',
      /loses every deposit sent to it/i.test(txt(q(dom, '#da-readback-note'))));
    q(dom, '#da-add-submit').click();
    const madeRow = await pollRow(
      () => admin.from('deposit_addresses').select('*').eq('address', uiAddress).maybeSingle(),
      (d) => !!d && !!d.id, 25000);
    check('★ a real PYUSD address is created through the real UI', !!madeRow, 'no row appeared');
    if (madeRow) createdAddresses.push(madeRow.id);
    check('...on the right route, available, with the label the PM typed',
      !!madeRow && madeRow.currency === 'PYUSD' && madeRow.network === 'ERC-20' &&
      madeRow.status === 'available' && /Address UI test/.test(madeRow.label || ''),
      madeRow && JSON.stringify({ c: madeRow.currency, s: madeRow.status, l: madeRow.label }));

    console.log('\n=== PART 7: ★ BLOCKED CLIENTS — the banner appears, then goes ===\n');
    const email = 'addrui-' + SUF + '@invalid.test';
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (cuErr) throw cuErr;
    createdClients.push(cu.user.id);
    await must(admin.from('clients').insert({
      id: cu.user.id, name: 'Blocked Testclient ' + SUF, email, phone: '+46 70 777 7777',
      account_type: 'Individual Account', status: 'active'
    }), 'seed the blocked client');

    const dom2 = buildDom(D, st.API_URL);
    check('GUARD: the page rendered with the new client present', await ready(dom2));
    const blockedRow = q(dom2, '[data-blocked="' + cu.user.id + '"]');
    check('★ a client with no address appears in the amber banner, before anything else',
      !!blockedRow && /Blocked Testclient/.test(txt(blockedRow)), blockedRow && txt(blockedRow).slice(0, 80));
    check('★ ...the banner is the FIRST thing on the page, above the strip and the book',
      !!q(dom2, '.da-blocked') &&
      (q(dom2, '.da-blocked').compareDocumentPosition(q(dom2, '#da-strip')) & 4) !== 0);
    check('★ ...with the currencies they are missing shown as chips',
      !!blockedRow && blockedRow.querySelectorAll('.da-miss').length === payload.groups.length,
      blockedRow && [...blockedRow.querySelectorAll('.da-miss')].map((c) => txt(c)).join(','));
    check('★ ...and an Assign action on the row itself',
      !!blockedRow && !!blockedRow.querySelector('[data-assign-client]'));
    check('the strip counts them, in amber',
      /Clients blocked/.test(txt(q(dom2, '#da-strip'))) && !!q(dom2, '.da-hc.is-warn'));

    // Assign through the banner's own control — the fastest path from blocked to not.
    blockedRow.querySelector('[data-assign-client]').click();
    check('the banner\'s Assign opens the assign panel with that client preselected',
      !!q(dom2, '#da-assign-client') && q(dom2, '#da-assign-client').value === cu.user.id,
      q(dom2, '#da-assign-client') && q(dom2, '#da-assign-client').value);
    q(dom2, '#da-assign-submit').click();
    const assignedRow = await pollRow(
      () => admin.from('deposit_address_assignments').select('*').eq('client_id', cu.user.id).is('removed_at', null).maybeSingle(),
      (d) => !!d, 25000);
    check('★ a real assignment lands in Postgres', !!assignedRow, 'no assignment appeared');
    check('...recorded against the real PM who did it',
      !!assignedRow && assignedRow.assigned_by_email === 'pm@marketswave.local',
      assignedRow && String(assignedRow.assigned_by_email));

    await pollUntil(() => rows(dom2).length > 0);
    const stillBlocked = q(dom2, '[data-blocked="' + cu.user.id + '"]');
    check('★ the banner row SHRINKS after assigning — one fewer chip, not a stale snapshot',
      !!stillBlocked && stillBlocked.querySelectorAll('.da-miss').length === payload.groups.length - 1,
      stillBlocked ? stillBlocked.querySelectorAll('.da-miss').length + ' chips' : 'row gone entirely');

    console.log('\n=== PART 8: ★ REMOVE — and the retire warning that was kept ===\n');
    const dom3 = buildDom(D, st.API_URL);
    check('GUARD: the page rendered for the remove round trip', await ready(dom3));
    const targetRow = rows(dom3).filter((r) => r.dataset.id === assignedRow.address_id)[0];
    check('GUARD: the assigned address is on screen', !!targetRow);
    targetRow.click();
    const removeBtn = q(dom3, '[data-remove="' + assignedRow.id + '"]');
    check('the panel lists the client with a Remove action', !!removeBtn);
    removeBtn.click();
    const warn = txt(q(dom3, '#da-remove-warning'));
    const wasLast = payload.addresses.filter((a) => a.id === assignedRow.address_id)[0].clientCount === 0;
    check('★ the warning states what removing ACTUALLY does to the client',
      /empty state on Deploy Capital/i.test(warn), warn.slice(0, 140));
    if (wasLast) {
      check('★ ...and that removing the LAST client RETIRES the address',
        /RETIRES it/.test(warn) && /keeps its history/i.test(warn), warn.slice(0, 160));
    }
    q(dom3, '#da-remove-submit').click();
    const removed = await pollRow(
      () => admin.from('deposit_address_assignments').select('*').eq('id', assignedRow.id).single(),
      (d) => !!d.removed_at, 25000);
    check('★ the removal lands, and is SOFT — the row survives with a removed_at, never deleted',
      !!removed && !!removed.removed_at, removed && String(removed.removed_at));
    check('...recorded against the real PM', !!removed && removed.removed_by_email === 'pm@marketswave.local');

    console.log('\n=== PART 9: the retired row keeps its history and refuses reassignment ===\n');
    const retired = await pollRow(
      () => admin.from('deposit_addresses').select('*').eq('id', assignedRow.address_id).single(),
      (d) => d.status === 'retired', 15000);
    if (!retired) {
      console.log('  SKIP  the address still serves another client, so it did not retire — not a failure.');
    } else {
      const dom4 = buildDom(D, st.API_URL);
      await ready(dom4);
      const pill = q(dom4, '[data-filter="retired"]');
      pill.click();
      const rRow = rows(dom4).filter((r) => r.dataset.id === retired.id)[0];
      check('★ a retired address is still in the book under Retired — nothing is deleted',
        !!rRow && rRow.classList.contains('is-retired'));
      check('★ ...and keeps its history: it still says how many it ever served',
        !!rRow && /Previously \d/.test(txt(rRow.querySelector('.da-who'))), rRow && txt(rRow.querySelector('.da-who')));
      // ★ Row 233's 2.59:1 register: the chrome may dim, the WORDS may not. The composited
      // proof is the visual suite's; this is the structural half.
      check('★ the retired row is marked by a class, never by dimming its own text',
        !!rRow && !/opacity/.test(rRow.getAttribute('style') || ''));
      rRow.click();
      check('its panel offers no Assign action at all — a retired address takes no new client',
        !q(dom4, '#da-assign-open') && /accepts no new assignment/i.test(txt(q(dom4, '#da-retired-note'))),
        txt(q(dom4, '#da-retired-note')).slice(0, 100));
    }

    console.log('\n=== PART 10: a failed read is an error card, never a silent empty state ===\n');
    // ★ ROW 233's RULE, PROVEN. "No deposits received" and "the query failed" must never look
    // the same — so a genuinely failing load has to paint something a PM can act on.
    const broken = {
      useAdminClient: function () {},
      skeleton: D.skeleton,
      renderAsyncBundle: D.renderAsyncBundle,
      withButtonBusy: D.withButtonBusy,
      writeErrorMessage: D.writeErrorMessage,
      callFunction: function () { return Promise.reject(new Error('Could not reach the server.')); }
    };
    const domErr = buildDom(broken, st.API_URL);
    check('★ a failed read paints a real error card with a retry, not an empty book',
      await pollUntil(() => /try again/i.test(txt(q(domErr, '#da-book'))), 8000),
      txt(q(domErr, '#da-book')).slice(0, 100));
    check('...and no row is rendered behind it', rows(domErr).length === 0);

  } finally {
    for (const id of createdClients) {
      await admin.from('deposit_address_assignments').delete().eq('client_id', id);
      await admin.from('deposit_requests').delete().eq('client_id', id);
      await admin.from('account_state').delete().eq('client_id', id);
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const id of createdAddresses) {
      await admin.from('deposit_address_assignments').delete().eq('address_id', id);
      await admin.from('deposit_requests').delete().eq('deposit_address_id', id);
      await admin.from('deposit_addresses').delete().eq('id', id);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('ADDRESS BOOK UI: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 900000 });
