// ★ PM tool revamp, part 5 — the client list, rendered (register row 235).
//
// ★★ THE ASSERTION THIS SUITE EXISTS FOR IS PART 2's: A CLIENT WHO EXISTS IN BOTH PLACES —
// mirrored into this browser's local registry AND real in Supabase — MUST RENDER THEIR SUPABASE
// VALUE. That is the exact condition that made the fixture client and a real client render $0
// while holding real value, and mirrorAuthenticatedClientLocally() re-creates it every time anyone signs in as a
// client in a PM's browser. Without this test the next mirror silently restores the bug.
//
// Every money assertion is cross-checked against get-returns-summary or get-total-portfolio-value
// — never against the list's own arithmetic, which is what was wrong in the first place.
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
const PAGE = path.join(ROOT, 'admin-clients.html');
const PAGE_JS = path.join(ROOT, 'admin-client-list.js');
const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'CliList-2026!';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(fn, maxMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { try { if (fn()) return true; } catch (e) {} await sleep(120); }
  return false;
}
const vc = new VirtualConsole();

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

/** The REAL page body + the REAL external list script, optionally with a client pre-mirrored. */
function buildDom(MarketswaveData, mirror) {
  const html = readFileSync(PAGE, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    url: 'http://127.0.0.1:8765/admin-clients.html', runScripts: 'outside-only',
    virtualConsole: vc, pretendToBeVisual: true
  });
  dom.window.MarketswaveData = MarketswaveData;
  for (const f of ['engine-core.js', 'format-helpers.js']) dom.window.eval(readFileSync(path.join(ROOT, f), 'utf8'));
  if (mirror) {
    // Exactly what login.html does when someone signs in as this client in this browser.
    dom.window.eval('mirrorAuthenticatedClientLocally(' + JSON.stringify(mirror) + ');');
  }
  dom.window.eval(readFileSync(PAGE_JS, 'utf8'));
  return dom;
}
const ready = (dom) => pollUntil(() => dom.window.document.querySelectorAll('.cl-tr').length > 0);
function rowFor(dom, id) { return dom.window.document.querySelector('.cl-tr[data-cl-row="' + id + '"]'); }
function cell(row, sel) { const e = row && row.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }
// ★ The value cell contains the figure AND the return beneath it. Stripping non-numerics from
// the whole cell concatenates them ("$31,996" + "+$18,726" + "142.3%" -> 3199618726142.3), which
// is a test bug that looks exactly like a page bug. Read the two separately.
const digits = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;
function moneyOf(row) {
  const el = row && row.querySelector('.cl-mny');
  if (!el) return 0;
  const span = el.querySelector('span');
  const txt = span ? el.textContent.replace(span.textContent, '') : el.textContent;
  return digits(txt);
}
function returnOf(row) {
  const span = row && row.querySelector('.cl-mny span');
  if (!span) return null;
  const m = span.textContent.match(/([+−-])\$([0-9,.]+)/);
  return m ? Number(m[2].replace(/,/g, '')) * (m[1] === '+' ? 1 : -1) : null;
}

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);
  const created = [];

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  globalThis.document = { addEventListener() {} };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  const cfg = await import('../admin-supabase-config.js');
  const { error: pmErr } = await cfg.supabase.auth.signInWithPassword({
    email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!'
  });
  check('a real admin session is established', !pmErr, pmErr && pmErr.message);
  // The page calls useAdminClient() itself; this suite's own direct calls run first, so it
  // must switch the shared client too or they go out on the client-facing singleton.
  MarketswaveData.useAdminClient();

  try {
    console.log('\n=== PART 1: NAVIGATION (row 228) ===\n');
    const src = readFileSync(PAGE, 'utf8');
    check("★ the page calls initAdminSidebar('clients')", /initAdminSidebar\(\s*['"]clients['"]\s*\)/.test(src));
    check('the page mounts the shared sidebar container', /id="admin-sidebar-mount"/.test(src));

    console.log('\n=== PART 2: ★ THE REGRESSION — a client in BOTH places renders SUPABASE ===\n');
    const { data: gary } = await admin.from('clients').select('*').ilike('name', '%Gary%').maybeSingle();
    if (!gary) { console.log('  SKIP  Gary is not seeded.'); }
    else {
      // The authoritative figure, from the endpoint the PROFILE uses — never the list's own maths.
      const tpv = await MarketswaveData.callFunction('get-total-portfolio-value', { clientId: gary.id });
      const rets = await MarketswaveData.callFunction('get-returns-summary', { clientId: gary.id });
      check('GUARD: Gary genuinely holds a non-zero portfolio — otherwise this test proves nothing',
        tpv.totalPortfolioValue > 1000 && rets.positions.length > 0,
        '$' + tpv.totalPortfolioValue + ' across ' + rets.positions.length + ' positions');

      const clean = buildDom(MarketswaveData, null);
      check('GUARD: the page rendered', await ready(clean));
      const cleanVal = moneyOf(rowFor(clean, gary.id));
      check('without a local mirror, Gary renders his real value',
        Math.abs(cleanVal - tpv.totalPortfolioValue) < 2, cleanVal + ' vs ' + tpv.totalPortfolioValue);

      // ★ THE ONE. Mirror him exactly as a real sign-in would, then re-render.
      const mirrored = buildDom(MarketswaveData, {
        id: gary.id, name: gary.name, email: gary.email, phone: gary.phone,
        accountType: gary.account_type, status: gary.status
      });
      check('GUARD: the page rendered with the mirror in place', await ready(mirrored));
      const row = rowFor(mirrored, gary.id);
      const mirroredVal = moneyOf(row);
      check('★★ MIRRORED LOCALLY AND REAL IN SUPABASE → the SUPABASE value renders, not $0',
        Math.abs(mirroredVal - tpv.totalPortfolioValue) < 2, mirroredVal + ' vs ' + tpv.totalPortfolioValue);
      check('★★ ...and the row is not duplicated — one row per client, not one per source',
        mirrored.window.document.querySelectorAll('.cl-tr[data-cl-row="' + gary.id + '"]').length === 1);
      check('★ his return is shown beside the value, cross-checked against get-returns-summary',
        /[+−]\$/.test(cell(row, '.cl-mny')) &&
        Math.abs(Math.abs(returnOf(row)) - Math.abs(rets.total)) < 2,
        cell(row, '.cl-mny'));
      check('the row navigates to his profile rather than expanding',
        row.tagName === 'A' && row.getAttribute('href') === 'admin-client-profile.html?client=' + gary.id,
        row.tagName + ' ' + row.getAttribute('href'));
    }

    console.log('\n=== PART 3: every client agrees with the authoritative source ===\n');
    const dom = buildDom(MarketswaveData, null);
    await ready(dom);
    const payload = await MarketswaveData.callFunction('get-client-list', {});
    let mismatches = 0, checked = 0;
    for (const c of payload.clients) {
      const r = rowFor(dom, c.id);
      if (!r) continue;
      const shown = cell(r, '.cl-mny');
      if (!c.valueAvailable || !c.funded) continue;
      const tpv = await MarketswaveData.callFunction('get-total-portfolio-value', { clientId: c.id });
      checked++;
      if (Math.abs(moneyOf(r) - tpv.totalPortfolioValue) > 2) { mismatches++; console.log('      ' + c.name + ': ' + shown + ' vs ' + tpv.totalPortfolioValue); }
    }
    check('GUARD: at least two funded clients were compared', checked >= 2, String(checked));
    check('★ every rendered value equals get-total-portfolio-value for that client',
      mismatches === 0, mismatches + ' mismatch(es)');

    console.log('\n=== PART 4: three states that used to be one ===\n');
    const email = 'cl-unfunded-' + SUF + '@invalid.test';
    const { data: eu } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    created.push(eu.user.id);
    await admin.from('clients').insert({
      id: eu.user.id, name: 'Unfunded Testclient ' + SUF, email, phone: '+46 70 222 2222',
      account_type: 'Individual Account', status: 'active'
    });
    const dom2 = buildDom(MarketswaveData, null);
    await ready(dom2);
    const ur = rowFor(dom2, eu.user.id);
    check('★ a client who has never been funded says "not yet funded", NOT $0',
      !!ur && /not yet funded/i.test(cell(ur, '.cl-mny')) && ur.querySelector('[data-cl-value="unfunded"]'),
      ur ? cell(ur, '.cl-mny') : 'row missing');
    check('★ ...and their row shows no fabricated $0 anywhere',
      !!ur && !/\$0\b/.test(cell(ur, '.cl-mny')), ur && cell(ur, '.cl-mny'));
    const funded = [...dom2.window.document.querySelectorAll('[data-cl-value="real"]')];
    check('a funded client renders a real figure', funded.length > 0, String(funded.length));
    check('the three value states are distinguishable in the DOM, not merged',
      dom2.window.document.querySelectorAll('[data-cl-value]').length === dom2.window.document.querySelectorAll('.cl-tr').length);

    console.log('\n=== PART 5: the strip ===\n');
    const strip = [...dom2.window.document.querySelectorAll('.cl-hc')];
    check('four figures', strip.length === 4, String(strip.length));
    const labels = strip.map((s) => s.querySelector('.cl-k').textContent);
    // Row 254: "Invitations out" is its own card — seven accounts and three maybes are
    // different facts — and took the fourth slot from "Unallocated across clients".
    check('...clients, invitations out, AUM, awaiting approval',
      labels.join('|') === 'Clients|Invitations out|Assets under management|Awaiting your approval', labels.join('|'));
    check('★ the AUM figure equals the endpoint\'s own sum, not a client-side re-add',
      Math.abs(digits(strip[2].querySelector('.cl-v').textContent) - payload.strip.aum) < 2,
      strip[2].querySelector('.cl-v').textContent + ' vs ' + payload.strip.aum);
    check('the clients figure counts every rendered row',
      Number(strip[0].querySelector('.cl-v').textContent) === dom2.window.document.querySelectorAll('.cl-tr').length);
    check('the approval figure equals an independent pending total',
      Number(strip[3].querySelector('.cl-v').textContent) === payload.strip.pendingTotal);

    console.log('\n=== PART 6: filters, search, sort ===\n');
    const D2 = dom2.window.document;
    const total = D2.querySelectorAll('.cl-tr').length;
    const allPill = D2.querySelector('[data-cl-filter="all"] .cl-n');
    check('the All pill counts every client', Number(allPill.textContent) === total, allPill.textContent + ' vs ' + total);
    D2.querySelector('[data-cl-filter="requests"]').click();
    const withReq = [...D2.querySelectorAll('.cl-tr')];
    check('★ "Has pending requests" narrows to exactly the clients with one',
      withReq.length === payload.clients.filter((c) => c.pendingCount > 0).length && withReq.every((r) => !/—/.test(cell(r, '.cl-pend'))),
      withReq.length + ' rows');
    D2.querySelector('[data-cl-filter="all"]').click();
    const search = D2.getElementById('client-search');
    search.value = 'gary';
    search.dispatchEvent(new dom2.window.Event('input', { bubbles: true }));
    const hits = [...D2.querySelectorAll('.cl-tr')];
    check('★ search by name narrows the list', hits.length >= 1 && hits.every((r) => /gary/i.test(cell(r, '.cl-cn'))),
      hits.map((r) => cell(r, '.cl-cn b')).join(','));
    search.value = 'invalid.test';
    search.dispatchEvent(new dom2.window.Event('input', { bubbles: true }));
    check('★ search reaches the EMAIL, not only the name',
      [...D2.querySelectorAll('.cl-tr')].length >= 1);
    search.value = 'zzzz-no-such-client';
    search.dispatchEvent(new dom2.window.Event('input', { bubbles: true }));
    check('a search with no hits shows a real empty state, not a blank panel',
      !!D2.querySelector('.cl-empty') && /No clients match/i.test(D2.querySelector('.cl-empty').textContent));
    search.value = '';
    search.dispatchEvent(new dom2.window.Event('input', { bubbles: true }));

    D2.querySelector('[data-cl-sort="name"]').click();
    const names = [...D2.querySelectorAll('.cl-tr')].map((r) => cell(r, '.cl-cn b'));
    const sorted = names.slice().sort((a, b) => a.localeCompare(b));
    check('★ sorting by name genuinely reorders the rows', names.join('|') === sorted.join('|'), names.slice(0, 3).join(','));

    console.log('\n=== PART 7: the three removals ===\n');
    const html = D2.getElementById('clients-list').innerHTML;
    check('★ no raw UUID is rendered as an identifier',
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![^<]*")/.test(
        html.replace(/href="[^"]*"/g, '').replace(/data-cl-row="[^"]*"/g, '')),
      'a uuid is visible in row text');
    check('★ no "Supabase" badge — a client is a client', !/Supabase/i.test(html));
    check('★ no expander: every row is a link, and no expand-row markup exists',
      [...D2.querySelectorAll('.cl-tr')].every((r) => r.tagName === 'A') && !D2.querySelector('.expand-row'));
    check('★ "View as this Client" is gone from the list', !/View as this Client/i.test(D2.body.innerHTML));
    // ★ Assert the CONTROLS are gone, not the words — the page carries a comment explaining
    // where they went, and matching source text would fail on the explanation itself.
    check('★ Reset Password / Reset 2FA controls are gone from the list (they moved to the profile)',
      !D2.querySelector('#security-modal') && !D2.querySelector('.security-btn') &&
      ![...D2.querySelectorAll('button, a')].some(function (b) { return /reset (password|2fa)/i.test(b.textContent); }),
      [...D2.querySelectorAll('button, a')].map(function (b) { return b.textContent.trim(); }).filter(Boolean).slice(0, 8).join(' | '));

  } finally {
    for (const id of created.reverse()) {
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('CLIENT LIST UI: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 600000 });
