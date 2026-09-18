// ★ PM tool revamp, part 9 (2026-09-18) — the Documents page, driven through its REAL script.
//
// The behaviours the SIX blast-radius suites (repointed, not dropped) do NOT cover — because
// they predate this page's rebuild — are the substance of part 9 and are what this suite adds:
//   - the three stacked sections became ONE table that merges `documents` AND `identity_documents`;
//   - a health strip that is also a filter set, and filter pills whose counts follow the search;
//   - search and sort over the unified table;
//   - the detail panel SHAPED BY THE OBJECT: a regular document states the honest ABSENCE of any
//     signature evidence (register row D — the mockup drew a full evidence panel with nothing
//     behind it), and an identity document reuses Task B's access record + the ONE logged Open
//     control (row 246), never a rebuilt second one.
//
// ★ THE PAGE'S OWN SCRIPT RUNS HERE, UNMODIFIED — admin-documents.html's <body> is extracted
// verbatim, its <script> tags stripped, and admin-documents-page.js evaluated into the window.
//
// ★ NAV IS ASSERTED (row 228). The rendered rail is the visual layer's job (admin-sidebar.js
// gates its render on a real getSession() jsdom cannot satisfy); this half asserts the call.
//
// ★ NO PERMANENT ROWS. identity_document_access_log is append-only for EVERY role, service_role
// included (Task B's trigger), so a seeded log row could never be cleaned and would accumulate
// on every pass run. This suite therefore verifies the access record's honest EMPTY/base state
// (no PM has opened it yet + the client's own upload as the base of the record), which needs no
// permanent write — the log-row rendering itself is covered by verify-identity-document-access.
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
const PAGE = path.join(ROOT, 'admin-documents.html');
const PAGE_JS = path.join(ROOT, 'admin-documents-page.js');
const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'DocsPage-2026!';

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
async function must(p, what) { const { error } = await p; if (error) throw new Error('could not ' + what + ': ' + error.message); }

const vc = new VirtualConsole();
function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

/** The REAL page body + the REAL external page script. */
function buildDom(MarketswaveData) {
  const html = readFileSync(PAGE, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    url: 'http://127.0.0.1:8765/admin-documents.html', runScripts: 'outside-only',
    virtualConsole: vc, pretendToBeVisual: true
  });
  dom.window.MarketswaveData = MarketswaveData;
  dom.window.eval(readFileSync(PAGE_JS, 'utf8'));
  return dom;
}
const rows = (dom) => [...dom.window.document.querySelectorAll('.doc-tr')];
const ready = (dom) => pollUntil(() => rows(dom).length > 0);
function q(dom, sel) { return dom.window.document.querySelector(sel); }
function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
function typeInto(dom, el, value) { el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }
function rowFor(dom, filename) { return rows(dom).find((r) => txt(r.querySelector('.doc-nm b')) === filename) || null; }
function pill(dom, key) { return q(dom, '.doc-pill[data-filter="' + key + '"]'); }
function pillCount(dom, key) { const p = pill(dom, key); const n = p && p.querySelector('.n'); return n ? Number(txt(n)) : -1; }

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  globalThis.document = { addEventListener() {} };
  await import('../supabase-data.js');
  const D = globalThis.window.MarketswaveData;
  const cfg = await import('../admin-supabase-config.js');
  const { error: pmErr } = await cfg.supabase.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  check('a real admin session is established', !pmErr, pmErr && pmErr.message);
  D.useAdminClient();

  // Names carry SUF so every assertion can scope to THIS client's own rows regardless of any
  // other test residue in the shared cross-client tables.
  const clientName = 'Docs Page Test ' + SUF;
  const F_SIGNED = 'Advisory Agreement ' + SUF + '.pdf';       // from Marketswave, Signed
  const F_UPLOAD = 'Client Upload ' + SUF + '.pdf';            // upload, Received (needs review)
  const F_SIG = 'Signature Needed ' + SUF + '.pdf';            // from Marketswave, Signature Required
  const F_IDD = 'passport-' + SUF + '.pdf';                    // identity document
  let uid = null;

  try {
    const email = 'docs-page-' + SUF + '@invalid.test';
    const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    check('a real throwaway client is created', !ce, ce && ce.message);
    uid = cu.user.id;
    await must(admin.from('clients').insert({ id: uid, name: clientName, email, phone: '+1 555 0142', account_type: 'Individual Account', status: 'active' }), 'seed client');
    await must(admin.from('documents').insert([
      { client_id: uid, direction: 'from', filename: F_SIGNED, category: 'Contracts', status: 'Signed', is_new: false },
      { client_id: uid, direction: 'upload', filename: F_UPLOAD, category: 'General', status: 'Received', is_new: false },
      { client_id: uid, direction: 'from', filename: F_SIG, category: 'Signature Required', status: 'Signature Required', is_new: false }
    ]), 'seed documents');
    await must(admin.from('identity_documents').insert({
      client_id: uid, kind: 'id', document_type: 'Passport', filename: F_IDD, storage_path: uid + '/id/' + F_IDD
    }), 'seed identity document');

    console.log('\n=== PART 1: navigation (row 228) ===\n');
    const src = readFileSync(PAGE, 'utf8');
    check("★ the page calls initAdminSidebar('documents')", /initAdminSidebar\(\s*['"]documents['"]\s*\)/.test(src));
    check('the page mounts the shared sidebar container', /id="admin-sidebar-mount"/.test(src));
    check('the page loads the shared identity-document-access.js component, not a rebuilt one', /identity-document-access\.js/.test(src));

    console.log('\n=== PART 2: the unified table merges documents AND identity documents ===\n');
    const dom = buildDom(D);
    check('GUARD: the page rendered real rows', await ready(dom), 'no .doc-tr appeared');
    check('the regular Signed document is a row', !!rowFor(dom, F_SIGNED));
    check('the client upload is a row', !!rowFor(dom, F_UPLOAD));
    check('★ the identity document appears in the SAME unified table (not a separate surface)', !!rowFor(dom, F_IDD),
      rows(dom).map((r) => txt(r.querySelector('.doc-nm b'))).filter((n) => n.indexOf(SUF) !== -1).join(' | '));
    const iddRow = rowFor(dom, F_IDD);
    check('the identity row is tagged data-source="identity"', iddRow && iddRow.getAttribute('data-source') === 'identity');
    check('the identity row reads a neutral "On file" status, NOT a fabricated review status', iddRow && /On file/i.test(txt(iddRow)), txt(iddRow));

    console.log('\n=== PART 3: filters — health cards, pills, counts-follow-search, sort ===\n');
    check('the Identity pill counts at least this client\'s identity document', pillCount(dom, 'Identity') >= 1, String(pillCount(dom, 'Identity')));
    const idCountAll = pillCount(dom, 'Identity');
    typeInto(dom, q(dom, '#doc-search'), SUF);
    await sleep(50);
    check('★ pill counts follow the search — Identity narrows to exactly this client\'s one identity doc', pillCount(dom, 'Identity') === 1, String(pillCount(dom, 'Identity')));
    check('search narrows the visible rows to only this client\'s four documents', rows(dom).length === 4, String(rows(dom).length));
    // Identity filter pill: only the identity row survives, the three regular docs drop out.
    pill(dom, 'Identity').click();
    await sleep(30);
    check('the Identity filter shows the identity document', !!rowFor(dom, F_IDD));
    check('the Identity filter hides the regular documents', !rowFor(dom, F_SIGNED) && !rowFor(dom, F_UPLOAD), 'regular docs still visible');
    // Needs-review health card: the upload shows, the Signed from-doc does not.
    q(dom, '.doc-hc[data-filter="needs-review"]').click();
    await sleep(30);
    check('the "Awaiting your review" health card filters to the un-reviewed upload', !!rowFor(dom, F_UPLOAD) && !rowFor(dom, F_SIGNED), 'needs-review filter wrong');
    check('an identity document is NOT counted as "awaiting review" (it has no review lifecycle)', !rowFor(dom, F_IDD));
    // back to all, still scoped by the search
    pill(dom, 'all').click();
    await sleep(30);
    check('the "All" pill restores all four of this client\'s documents (search still applied)', rows(dom).length === 4, String(rows(dom).length));
    // sort by name toggles order
    const before = rows(dom).map((r) => txt(r.querySelector('.doc-nm b')));
    q(dom, '.doc-th [data-sort="name"]').click();
    await sleep(30);
    const afterAsc = rows(dom).map((r) => txt(r.querySelector('.doc-nm b')));
    check('sorting by Document name genuinely re-orders the rows', JSON.stringify(afterAsc) !== JSON.stringify(before) || afterAsc.length < 2, afterAsc.join(' | '));

    console.log('\n=== PART 4: the regular-document detail states the honest ABSENCE of signature evidence (row D) ===\n');
    rowFor(dom, F_SIGNED).click();
    await sleep(30);
    const panel = q(dom, '#doc-panel');
    const ptext = txt(panel).toLowerCase();
    check('the Signed document\'s detail opens', txt(panel).indexOf(F_SIGNED) !== -1, txt(panel).slice(0, 120));
    check('★ it states plainly that NO signature evidence is captured', ptext.indexOf('no signature evidence is captured') !== -1, txt(panel).slice(0, 300));
    // Guard against fabricated VALUES, not against the honest note's own words — the note
    // legitimately SAYS "no typed name … or document hash", so forbidding those substrings
    // would flag the honesty itself. The mockup's evidence panel would show an IP, a device
    // string and a "hash at signing … matches" line; none of those can appear here.
    check('★ it does NOT fabricate a typed name / IP / device / document-hash VALUE (row D)',
      !/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(ptext) && ['chrome on', 'hash at signing', 'signed copy', 'safari on'].every((s) => ptext.indexOf(s) === -1), txt(panel).slice(0, 400));
    check('it shows the real status that IS on record', ptext.indexOf('signed') !== -1);
    q(dom, '#doc-close').click();
    await sleep(20);
    check('the detail closes', q(dom, '#doc-scrim').classList.contains('hidden'));

    console.log('\n=== PART 5: the identity-document detail reuses Task B\'s access record + logged Open ===\n');
    rowFor(dom, F_IDD).click();
    await sleep(30);
    await pollUntil(() => q(dom, '#doc-access-log') && txt(q(dom, '#doc-access-log')).indexOf('Loading') === -1, 8000);
    const idp = q(dom, '#doc-panel');
    const itext = txt(idp);
    check('the identity detail opens with an Access record section', itext.indexOf('Access record') !== -1, itext.slice(0, 160));
    check('★ the honest empty access record: no PM has opened it yet, with the client upload as the base', /No PM has opened this document yet/i.test(itext) && /uploaded it/i.test(itext), txt(q(dom, '#doc-access-log')));
    check('★ it carries the Task B disclosure: recorded permanently, client not notified, but disclosable on request',
      /records the account, the time and the reason permanently/i.test(itext) && /entitled to see it on request/i.test(itext), itext.slice(0, 400));
    check('★ the ONE control is Open (the logged path), and there is no direct download of identity bytes here',
      !!idp.querySelector('#doc-idd-open') && !idp.querySelector('.download-btn'), idp.querySelector('.doc-pf') ? txt(idp.querySelector('.doc-pf')) : 'no footer');

    console.log('\n=== PART 6: Publish to a client — the static modal ===\n');
    check('the publish modal is hidden until the header button opens it', q(dom, '#doc-publish-scrim').classList.contains('hidden'));
    check('the real client is populated into the Publish-to-Client dropdown at load', [...q(dom, '#publish-client').options].some((o) => o.value === uid),
      q(dom, '#publish-client').innerHTML.slice(0, 200));
    q(dom, '#doc-publish-open').click();
    await sleep(20);
    check('the header button opens the publish modal', !q(dom, '#doc-publish-scrim').classList.contains('hidden'));
    check('the publish form uses the accessible .mw-upload component', !!q(dom, '.mw-upload #publish-file'));
  } finally {
    if (uid) {
      await admin.from('documents').delete().eq('client_id', uid);
      await admin.from('identity_documents').delete().eq('client_id', uid);
      await admin.from('clients').delete().eq('id', uid);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.error('CLEANUP: ' + error.message);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('\nFAILURES:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('DOCUMENTS PAGE UI WIRING: PASS');
  process.exit(0);
}

runVerifyMain(main, { watchdogMs: 600000 });
