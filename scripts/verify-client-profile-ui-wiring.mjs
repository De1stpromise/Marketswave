// ★ PM tool revamp, part 4 — the client profile, rendered: the REAL page in a real DOM.
//
// The REAL admin-client-profile.html body and the REAL admin-client-profile.js are loaded —
// never a reimplementation — against a REAL admin session and REAL data. Two clients are
// exercised: Gary, who has four years of history and touches nearly every panel, and a
// genuinely empty client, who must render every empty state rather than a blank or a crash.
//
// ★ NAVIGATION IS ASSERTED EXPLICITLY, FIRST. Row 228: the approval gate shipped reachable and
// inescapable because every assertion in its own suite was about the feature and none about the
// chrome. A high assertion count is not coverage of the thing you forgot.
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
const PAGE_HTML = path.join(ROOT, 'admin-client-profile.html');
const PAGE_JS = path.join(ROOT, 'admin-client-profile.js');
const SUF = crypto.randomBytes(3).toString('hex');
const plantedDocs = [];
const PASSWORD = 'CliProfUI-2026!';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(fn, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { try { if (fn()) return true; } catch (e) { /* not ready */ } await sleep(120); }
  return false;
}
const vc = new VirtualConsole();

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

/** The REAL page body (scripts stripped) + the REAL external page script. */
function buildDom(MarketswaveData, clientId, extras) {
  const html = readFileSync(PAGE_HTML, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    url: 'http://localhost/admin-client-profile.html?client=' + encodeURIComponent(clientId),
    runScripts: 'outside-only', virtualConsole: vc
  });
  dom.window.MarketswaveData = MarketswaveData;
  // ★ The real page loads asset-mark.js via its own script tag; this harness strips scripts, so
  // it must load it explicitly. Row 207: each window gets its OWN copy and must be configured
  // per window, because the stored logo_url is a PATH and the base differs per environment.
  // The page's own script order (admin-client-profile.html): format-helpers and the onboarding
  // vocabulary come before the page script and it calls both (Task A, 2026-09-18, row 242).
  dom.window.eval(readFileSync(path.join(ROOT, 'format-helpers.js'), 'utf8'));
  dom.window.eval(readFileSync(path.join(ROOT, 'onboarding-vocab.js'), 'utf8'));
  dom.window.eval(readFileSync(path.join(ROOT, 'asset-mark.js'), 'utf8'));
  if (dom.window.AssetMark && dom.window.AssetMark.configure) {
    dom.window.AssetMark.configure({ storageBase: 'http://127.0.0.1:54321' });
  }
  Object.assign(dom.window, extras || {});
  dom.window.eval(readFileSync(PAGE_JS, 'utf8'));
  return dom;
}

/** Settled = the identity panel has painted real content, not a skeleton. */
async function ready(dom, maxMs = 40000) {
  const el = dom.window.document.getElementById('cp-identity');
  return pollUntil(() => !/animate-pulse/.test(el.innerHTML) && !!el.querySelector('.cp-strip'), maxMs);
}
const txt = (dom, sel) => {
  const el = dom.window.document.querySelector(sel);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
};

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);
  const created = [];

  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  globalThis.document = { addEventListener() {} };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  check('supabase-data.js loaded and defined window.MarketswaveData', !!MarketswaveData);

  // A real admin session on the real singleton, exactly as a real PM login establishes it.
  const adminConfig = await import('../admin-supabase-config.js');
  const { error: pmErr } = await adminConfig.supabase.auth.signInWithPassword({
    email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!'
  });
  check('a real admin session is established', !pmErr, pmErr && pmErr.message);

  try {
    // ---------------------------------------------------------------- PART 1: navigation
    console.log('\n=== PART 1: NAVIGATION IS PRESENT (row 228) ===\n');
    const pageSrc = readFileSync(PAGE_HTML, 'utf8');
    check("★ the page calls initAdminSidebar('clients') — the gate shipped without this exact line",
      /initAdminSidebar\(\s*['"]clients['"]\s*\)/.test(pageSrc), 'not found in admin-client-profile.html');
    check('the page mounts the shared sidebar container', /id="admin-sidebar-mount"/.test(pageSrc));
    check('the page loads admin-sidebar.js', /src="admin-sidebar\.js"/.test(pageSrc));
    check('the page carries the INTERNAL TOOL banner every admin page carries',
      /Internal Tool — Portfolio Manager Access Only/i.test(pageSrc));
    // The rendered rail, active item and Log out are asserted in the VISUAL suite against a
    // real browser, because admin-sidebar.js gates rendering on a real getSession() that jsdom
    // cannot satisfy. Both halves are needed: this one proves the call exists at all.

    // ---------------------------------------------------------------- PART 2: Gary
    console.log('\n=== PART 2: a REAL client with four years of history ===\n');
    const { data: gary } = await admin.from('clients').select('id, name, email').ilike('name', '%Gary%').maybeSingle();
    if (!gary) {
      console.log('  SKIP  Gary is not seeded — run `node seed-client-gary.mjs` first.');
    } else {
      // The identity-document panel keys `restricted` on a documents row's FILENAME. Gary's seed
      // carries no documents any more (the fake byteless catalogue was scrapped, row 247/D), so
      // this suite plants its own throwaway upload row for PART 4 rather than depending on
      // ambient seed state (the row-230 coupling class) — removed in the finally.
      // Two rows: a passport upload (the Restricted / request-and-log branch) and a plain
      // firm-published statement with no bytes (the honest "no file" branch, PART 4's other half).
      const { data: planted } = await admin.from('documents').insert([
        { client_id: gary.id, direction: 'upload', filename: 'passport-cpui-' + SUF + '.pdf', category: 'General', status: 'Received', is_new: false, storage_path: null },
        { client_id: gary.id, direction: 'from', filename: 'Statement-cpui-' + SUF + '.pdf', category: 'Statements & Reports', status: null, is_new: false, storage_path: null }
      ]).select('id');
      planted.forEach((d) => plantedDocs.push(d.id));
      const dom = buildDom(MarketswaveData, gary.id);
      const ok = await ready(dom);
      check('GUARD: the page actually rendered — otherwise every assertion below is vacuous', ok,
        dom.window.document.getElementById('cp-identity').innerHTML.slice(0, 160));

      const D = dom.window.document;
      check('the identity header names the real client', txt(dom, '.cp-idt h1').indexOf(gary.name) === 0, txt(dom, '.cp-idt h1'));
      check('the real email and account type are on screen',
        txt(dom, '.cp-meta').includes(gary.email) && /Individual Account/.test(txt(dom, '.cp-meta')), txt(dom, '.cp-meta').slice(0, 140));
      check('the breadcrumb names the client and links back to the list',
        D.getElementById('cp-crumb-name').textContent === gary.name && !!D.querySelector('.cp-crumb a[href="admin-clients.html"]'));
      check('Message links into the inbox for THIS client, and View as client exists',
        /admin-inbox\.html\?client=/.test(D.getElementById('cp-message').getAttribute('href')) && !!D.getElementById('cp-viewas'));

      const strip = [...D.querySelectorAll('.cp-st')];
      check('the money strip is five figures', strip.length === 5, String(strip.length));
      const labels = strip.map((s) => s.querySelector('.cp-k').textContent);
      check('...labelled portfolio value, total return, unallocated, savings pockets, capital deployed',
        labels.join('|') === 'Portfolio value|Total return|Unallocated|Savings pockets|Capital deployed', labels.join('|'));
      // Cross-checked against the endpoint, not against the page's own arithmetic.
      const prof = await MarketswaveData.callFunction('get-client-profile', { clientId: gary.id });
      const rets = await MarketswaveData.callFunction('get-returns-summary', { clientId: gary.id });
      const pvShown = strip[0].querySelector('.cp-v').textContent.replace(/[^0-9]/g, '');
      check('★ the portfolio value on screen is the endpoint\'s figure, not a recomputation',
        pvShown === String(Math.round(prof.money.portfolioValue)), pvShown + ' vs ' + Math.round(prof.money.portfolioValue));
      check('★ the return cell states the unrealised/realised split',
        /unreal/.test(strip[1].querySelector('.cp-x').textContent) && /real/.test(strip[1].querySelector('.cp-x').textContent),
        strip[1].querySelector('.cp-x').textContent);
      check('the deployed cell states it against what was deposited',
        /of \$[\d,]+ deposited/.test(strip[4].querySelector('.cp-x').textContent), strip[4].querySelector('.cp-x').textContent);

      const tabs = [...D.querySelectorAll('.cp-tb')].map((t) => t.getAttribute('data-cp-tab'));
      check('all eight tabs render, Overview first and active',
        tabs.length === 8 && tabs[0] === 'Overview' && D.querySelector('.cp-tb.is-on').getAttribute('data-cp-tab') === 'Overview',
        tabs.join(','));
      const reqTab = [...D.querySelectorAll('.cp-tb')].find((t) => t.getAttribute('data-cp-tab') === 'Requests');
      check('★ the Requests tab count equals the real pending count',
        reqTab.querySelector('.cp-n').textContent === String(prof.pending.length),
        reqTab.textContent + ' vs ' + prof.pending.length);

      check('★ Needs your attention lists his real pending request with a Review action into the gate',
        D.querySelectorAll('#cp-attention [data-cp-pending]').length === prof.pending.length &&
        !!D.querySelector('#cp-attention a[href="admin-approvals.html"]'),
        D.querySelectorAll('#cp-attention [data-cp-pending]').length + ' vs ' + prof.pending.length);

      const holds = [...D.querySelectorAll('#cp-holdings [data-cp-holding]')];
      check('★ every real holding renders', holds.length === rets.positions.length, holds.length + ' vs ' + rets.positions.length);
      check('★ each holding carries a real asset mark (logo or monogram), not a bare name',
        holds.length > 0 && holds.every((h) => !!h.querySelector('.mk')), 'marks: ' + holds.filter((h) => h.querySelector('.mk')).length);
      check('★ each holding shows a per-position gain with a direction tone',
        holds.every((h) => /[+−]\d/.test(h.querySelector('.cp-hv span').textContent) &&
          /cp-(up|dn)/.test(h.querySelector('.cp-hv span').className)),
        holds.map((h) => h.querySelector('.cp-hv span').textContent).join(' '));

      check('recent activity renders real transactions', D.querySelectorAll('#cp-activity .cp-r').length > 0);
      const addrs = [...D.querySelectorAll('#cp-addresses [data-cp-address]')];
      const unass = [...D.querySelectorAll('#cp-addresses [data-cp-unassigned]')];
      check('★ assigned crypto addresses render with their real address string',
        addrs.length === prof.addresses.assigned.length && addrs.every((a) => a.querySelector('.cp-an span').textContent.length > 10),
        addrs.length + ' vs ' + prof.addresses.assigned.length);
      check('★ an UNASSIGNED route is shown as a real state with an Assign action, not omitted',
        unass.length === prof.addresses.unassigned.length && unass.every((u) => /Assign/.test(u.textContent)),
        unass.length + ' vs ' + prof.addresses.unassigned.length);

      // ---- the three honest absences -------------------------------------------------------
      console.log('\n=== PART 3: what has no data source is stated, never faked ===\n');
      const onb = txt(dom, '#cp-onboarding');
      // Task A (2026-09-18, row 242): onboarding has real storage now. Gary was seeded before it
      // existed, so the honest rendering is his three profile fields, "Not submitted" for every
      // onboarding group, and the absence note explaining WHY (never "not on file").
      check('★ onboarding renders the three profile fields Gary genuinely has',
        /Legal name/.test(onb) && /Address/.test(onb) && /ID document/.test(onb), onb.slice(0, 120));
      check('★ ...every onboarding group reads "Not submitted" with the absence note explaining the pre-2026-09-18 case',
        !!D.querySelector('#cp-onboarding [data-cp-absent="onboarding"]') &&
        D.querySelectorAll('#cp-onboarding .cp-unsub').length >= 4 &&
        /No onboarding record has been submitted/i.test(onb) && !/not on file/i.test(onb), onb.slice(-260));
      check('★ NO fabricated onboarding value appears — no risk profile, no nationality, no tax residence as data',
        !/Balanced|Swedish|Employment \/ Salary|Intermediate|5–10 years/.test(onb), onb.slice(0, 200));
      check('★ identity documents: none on file for Gary, said in a sentence, with no control offered',
        !!D.querySelector('[data-cp-idd-empty]') && D.querySelectorAll('[data-cp-idd-row], [data-cp-idd] button').length === 0,
        txt(dom, '#cp-documents').slice(0, 160));
      const health = txt(dom, '#cp-health');
      check('★ account health shows the REAL advisory fee RATE', /Advisory fee rate/.test(health) && /%/.test(health), health.slice(0, 160));
      check('★ ...and states that nothing has been billed and no statement issued',
        /No fee has been billed/i.test(health) && /no invoicing/i.test(health), health.slice(-200));
      check('★ no "$284 charged"-style figure is invented anywhere in the panel',
        !/charged/i.test(health.replace(/no amount charged|been billed/gi, '')), health);
      check('★ NO "KYC verified" badge is rendered — clients has no KYC column',
        !/KYC/i.test(txt(dom, '#cp-identity')), txt(dom, '#cp-identity').slice(0, 160));
      check('the real application status IS rendered as what it is',
        /Active/.test(txt(dom, '.cp-idt h1')) && /Application status/.test(health), txt(dom, '.cp-idt h1'));
      check('no "next statement" date is invented', !/next statement/i.test(health), health.slice(0, 200));

      // ---- documents: request-and-log, and honest about missing bytes ------------------------
      console.log('\n=== PART 4: identity documents are request-and-log ===\n');
      const restricted = [...D.querySelectorAll('#cp-documents [data-cp-doc]')].filter((r) => /Restricted/.test(r.textContent));
      check('★ the passport is marked Restricted and offers REQUEST, never Open',
        restricted.length > 0 && restricted.every((r) => !!r.querySelector('[data-cp-request-doc]') && !r.querySelector('[data-cp-open-doc]')),
        restricted.map((r) => r.textContent.replace(/\s+/g, ' ').slice(0, 70)).join(' | '));
      check('★ the access-logging warning is on screen',
        !!D.querySelector('#cp-documents [data-cp-locked]') && /access-logged/i.test(txt(dom, '#cp-documents')));
      check('★ a document with NO stored bytes says so rather than offering a View that opens nothing',
        [...D.querySelectorAll('#cp-documents [data-cp-nofile]')].length > 0 ||
        prof.documents.every((x) => x.hasFile),
        'no-file rows: ' + D.querySelectorAll('#cp-documents [data-cp-nofile]').length);

      check('conversations render with a channel chip', D.querySelectorAll('#cp-conversations [data-cp-conv]').length === prof.conversations.length);
      check('★ the watchlist renders his real symbols — a swallowed read would show none here',
        [...D.querySelectorAll('#cp-watchlist [data-cp-watch]')].map((w) => w.textContent).sort().join(',') ===
        prof.watchlist.map((w) => w.symbol).sort().join(','),
        [...D.querySelectorAll('#cp-watchlist [data-cp-watch]')].map((w) => w.textContent).join(','));

      // ---- notes round trip ------------------------------------------------------------------
      console.log('\n=== PART 5: a private note, written through the real page ===\n');
      check('the notes panel is labelled "Visible to you only"', /Visible to you only/.test(txt(dom, '#cp-notes')));
      check('★ the disclosability line is present, verbatim',
        /may be disclosable if they make a data access request/.test(txt(dom, '#cp-notes')), txt(dom, '#cp-notes').slice(-180));
      check('notes are dated, and carry NO author signature — attribution is captured, not displayed',
        !/pm@marketswave\.local/.test(txt(dom, '#cp-notes')), txt(dom, '#cp-notes').slice(0, 200));

      D.getElementById('cp-addnote').click();
      check('the add-note form opens', D.getElementById('cp-noteform').classList.contains('is-open'));
      const noteBody = 'UI wiring note ' + SUF;
      D.getElementById('cp-notetext').value = noteBody;
      D.getElementById('cp-savenote').click();
      const landed = await pollUntil(() => /UI wiring note/.test(D.getElementById('cp-notes').textContent), 25000);
      check('★ a real note is written and the panel re-renders with it', landed, txt(dom, '#cp-notes').slice(0, 200));
      const { data: row } = await admin.from('pm_client_notes').select('author_id, author_email, body').eq('body', noteBody).maybeSingle();
      check('★ ...and it exists in Postgres attributed to the REAL signed-in PM',
        !!row && !!row.author_id && /pm@marketswave\.local/.test(row.author_email || ''), JSON.stringify(row));

      // ---- deletion, through the real page (2026-09-19, register row 252) -------------------
      console.log('\n=== PART 5b: deleting a note — two steps, author-only, proven by the refusal ===\n');
      const noteEl = () => [...D.querySelectorAll('.cp-pn')].find((n) => n.textContent.includes(noteBody));
      check('the note carries a quiet Delete control and a HIDDEN confirm row', !!noteEl() &&
        !!noteEl().querySelector('[data-cp-note-del]') && noteEl().querySelector('.cp-pnq').hidden === true);
      noteEl().querySelector('[data-cp-note-del]').click();
      check('★ Delete reveals the confirm row — nothing is deleted on the first click',
        noteEl().classList.contains('is-confirming') && noteEl().querySelector('.cp-pnq').hidden === false &&
        /Delete this note\?/.test(noteEl().textContent) && !!noteEl().querySelector('[data-cp-note-confirm]'),
        noteEl().textContent.slice(0, 120));
      const stillThere1 = await admin.from('pm_client_notes').select('id').eq('body', noteBody).maybeSingle();
      check('...and the row is still in Postgres after the first click', !!stillThere1.data);
      noteEl().querySelector('[data-cp-note-keep]').click();
      check('Keep folds the confirm row and the note survives', !noteEl().classList.contains('is-confirming') &&
        noteEl().querySelector('.cp-pnq').hidden === true && !!noteEl());
      noteEl().querySelector('[data-cp-note-del]').click();
      D.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      check('Escape folds it too', !noteEl().classList.contains('is-confirming'));

      // ★ THE REFUSAL, through the page's OWN delete path. A note by a DIFFERENT PM cannot be
      // shown by the page (RLS hides it), so it is exercised the way the page would do it —
      // MarketswaveData.deleteRow() from the signed-in PM's session against that note's id.
      const { data: otherPm } = await admin.auth.admin.createUser({ email: 'cp-other-pm-' + SUF + '@marketswave.local', password: PASSWORD, email_confirm: true });
      created.push(otherPm.user.id);
      await admin.from('user_roles').upsert({ user_id: otherPm.user.id, is_admin: true });
      const { data: otherNote, error: onErr } = await admin.from('pm_client_notes').insert({ client_id: gary.id, author_id: otherPm.user.id, author_email: otherPm.user.email, body: 'Other PM note ' + SUF }).select('id').single();
      if (onErr) throw new Error('other note: ' + onErr.message);
      let refused = null;
      try { await MarketswaveData.deleteRow('pm_client_notes', { id: otherNote.id }); } catch (e) { refused = e; }
      check('★ deleting a COLLEAGUE\'s note through deleteRow() is REFUSED (it throws, kind "client")',
        !!refused && refused.kind === 'client', refused ? refused.message : 'NO THROW — deleteRow reported success');
      const otherStill = await admin.from('pm_client_notes').select('id').eq('id', otherNote.id).maybeSingle();
      check('★ ...and the colleague\'s note genuinely still exists (service-role read)', !!otherStill.data);
      await admin.from('pm_client_notes').delete().eq('id', otherNote.id);

      // The real delete, for the PM's own note.
      noteEl().querySelector('[data-cp-note-del]').click();
      noteEl().querySelector('[data-cp-note-confirm]').click();
      const gone = await pollUntil(() => !D.getElementById('cp-notes').textContent.includes(noteBody) &&
        !/animate-pulse/.test(D.getElementById('cp-notes').innerHTML), 25000);
      check('★ confirming deletes the note and the panel re-renders without it', gone, txt(dom, '#cp-notes').slice(0, 160));
      const goneRow = await admin.from('pm_client_notes').select('id').eq('body', noteBody).maybeSingle();
      check('★ ...and it is genuinely gone from Postgres — a hard delete', !goneRow.data, JSON.stringify(goneRow.data));
      check('the toast says so', /Note deleted/.test(txt(dom, '#cp-toast') || D.body.textContent), '');
      await admin.from('pm_client_notes').delete().eq('body', noteBody);
    }

    // ---------------------------------------------------------------- PART 6: the empty client
    console.log('\n=== PART 6: a client with NOTHING renders every empty state ===\n');
    const email = 'cp-ui-empty-' + SUF + '@invalid.test';
    const { data: eu, error: euErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (euErr) throw new Error('create empty client: ' + euErr.message);
    created.push(eu.user.id);
    await admin.from('clients').insert({
      id: eu.user.id, name: 'Empty Testclient', email, phone: '+46 70 111 1111',
      account_type: 'Individual Account', status: 'active'
    });

    const dom2 = buildDom(MarketswaveData, eu.user.id);
    const ok2 = await ready(dom2);
    check('GUARD: the empty client\'s page rendered at all', ok2);
    const D2 = dom2.window.document;
    check('the identity header still names them and shows their status',
      /Empty Testclient/.test(txt(dom2, '.cp-idt h1')) && /Active/.test(txt(dom2, '.cp-idt h1')), txt(dom2, '.cp-idt h1'));
    check('the money strip still renders five cells, at zero', [...D2.querySelectorAll('.cp-st')].length === 5);
    check('★ no holdings → a real sentence, not a blank panel',
      /No holdings/i.test(txt(dom2, '#cp-holdings')), txt(dom2, '#cp-holdings').slice(0, 120));
    check('★ nothing pending → says so, and offers no Review action',
      /Nothing pending/i.test(txt(dom2, '#cp-attention')) && !D2.querySelector('#cp-attention [data-cp-pending]'));
    check('★ no documents → a real sentence (and no identity documents, likewise a sentence)',
      /No other documents yet/i.test(txt(dom2, '#cp-documents')) && /No identity documents on file/i.test(txt(dom2, '#cp-documents')), txt(dom2, '#cp-documents').slice(0, 200));
    check('★ no conversations → a real sentence', /No conversations/i.test(txt(dom2, '#cp-conversations')));
    check('★ no watchlist → a real sentence', /Nothing on the watchlist/i.test(txt(dom2, '#cp-watchlist')));
    check('★ no notes → a real sentence, and the add control is still offered',
      /No notes yet/i.test(txt(dom2, '#cp-notes')) && !!D2.getElementById('cp-addnote'));
    check('★ no transactions → a real sentence', /No transactions/i.test(txt(dom2, '#cp-activity')));
    check('★ every deposit route renders as UNASSIGNED with an Assign action',
      D2.querySelectorAll('#cp-addresses [data-cp-unassigned]').length > 0 &&
      D2.querySelectorAll('#cp-addresses [data-cp-address]').length === 0,
      D2.querySelectorAll('#cp-addresses [data-cp-unassigned]').length + ' unassigned');
    check('the onboarding absence note is shown for them too',
      !!D2.querySelector('#cp-onboarding [data-cp-absent="onboarding"]'));
    check('no panel rendered an error card instead of an empty state',
      !/Try Again/i.test(D2.body.textContent), 'an error card is on screen');

  } finally {
    await admin.from('pm_client_notes').delete().ilike('body', '%' + SUF + '%');
    if (plantedDocs.length) await admin.from('documents').delete().in('id', plantedDocs);
    for (const id of created.reverse()) {
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('CLIENT PROFILE UI: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main);
