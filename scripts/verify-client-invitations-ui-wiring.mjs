// ★ PM client creation by invitation — the admin page, through the REAL page script in a real
// DOM (register row 254).
//
// The backend suite proves the functions; this proves the PM's surface drives them: the
// Invite modal creates a real invitation (a real row, a real email_log entry) and refuses the
// two refusals with the server's own sentence; the pending list renders every state (Sent,
// Opened, Expired) with the right controls (Resend / Revoke, Invite again / Remove) and the
// honest empty state; Resend rotates the real token; Revoke goes through a confirm step; the
// strip separates Clients from Invitations out; and the OLD proxy-creation path is gone from
// the page entirely — no addClient() call, no Add Client modal.
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = path.join(ROOT, 'admin-clients.html');
const PAGE_JS = path.join(ROOT, 'admin-client-list.js');
const SUF = crypto.randomBytes(3).toString('hex');
let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollUntil(fn, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (fn()) return true; await sleep(150); }
  return false;
}
const vc = new VirtualConsole();
function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sink = (tag) => 'delivered+invui-' + tag + '-' + SUF + '@resend.dev';

function buildDom(MarketswaveData) {
  const html = readFileSync(PAGE, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', {
    url: 'http://127.0.0.1:8765/admin-clients.html', runScripts: 'outside-only', virtualConsole: vc, pretendToBeVisual: true
  });
  dom.window.MarketswaveData = MarketswaveData;
  for (const f of ['engine-core.js', 'format-helpers.js']) dom.window.eval(readFileSync(path.join(ROOT, f), 'utf8'));
  dom.window.eval(readFileSync(PAGE_JS, 'utf8'));
  return dom;
}
const q = (dom, sel) => dom.window.document.querySelector(sel);
const qa = (dom, sel) => [...dom.window.document.querySelectorAll(sel)];
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const ready = (dom) => pollUntil(() => qa(dom, '.cl-tr').length > 0 && !!q(dom, '#cl-invitations .cl-ih'));
const invRow = (dom, id) => q(dom, '.cl-ir[data-cl-inv="' + id + '"]');
function fill(dom, id, v) { const el = q(dom, '#' + id); el.value = v; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY);
  const createdInv = [];
  globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
  globalThis.document = { addEventListener() {} };
  await import('../supabase-data.js');
  const MarketswaveData = globalThis.window.MarketswaveData;
  const cfg = await import('../admin-supabase-config.js');
  const { error: pmErr } = await cfg.supabase.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  check('a real admin session is established', !pmErr, pmErr && pmErr.message);
  MarketswaveData.useAdminClient();

  try {
    console.log('\n=== PART 1: the page — nav, no proxy creation left anywhere ===\n');
    const src = readFileSync(PAGE, 'utf8');
    check("★ the page calls initAdminSidebar('clients')", /initAdminSidebar\(\s*['"]clients['"]\s*\)/.test(src));
    const srcNoComments = src.replace(/<!--[\s\S]*?-->/g, '');
    check('★ NO addClient() call and NO Add Client modal remain on the page (comments aside) — invitation only', !/addClient\s*\(/.test(srcNoComments) && !/id="add-modal"/.test(srcNoComments) && !/id="open-add-modal"/.test(srcNoComments));
    check('the page script never calls addClient() either', !/addClient\s*\(/.test(readFileSync(PAGE_JS, 'utf8')));
    check('the header button is "Invite a client"', /id="open-invite-modal"/.test(src) && /Invite a client/.test(src));

    // A clean slate for THIS run's addresses; other runs' rows are untouched.
    console.log('\n=== PART 2: the empty state, then a real invitation through the real modal ===\n');
    const dom = buildDom(MarketswaveData);
    check('GUARD: the page rendered the list AND the invitations panel', await ready(dom));
    const before = qa(dom, '.cl-ir').length;
    const strip = qa(dom, '.cl-hc');
    check('★ the strip separates Clients from Invitations out — four cards, Invitations second',
      strip.length === 4 && txt(strip[1].querySelector('.cl-k')) === 'Invitations out', strip.map((s) => txt(s.querySelector('.cl-k'))).join('|'));
    const outBefore = Number(txt(strip[1].querySelector('.cl-v')));
    const clientsBefore = Number(txt(strip[0].querySelector('.cl-v')));
    if (before === 0) check('with no invitations the panel says so honestly', /No invitations out/.test(txt(q(dom, '#cl-invitations'))));
    else console.log('  (info) ' + before + ' pre-existing invitation row(s) from other runs — the empty state is asserted in the visual suite');

    q(dom, '#open-invite-modal').click();
    check('the Invite modal opens', !q(dom, '#invite-modal').classList.contains('hidden'));
    check('...it names what happens next (the person completes the rest themselves)', /They complete the rest themselves/.test(txt(q(dom, '#invite-modal'))) && /expires in 14 days/.test(txt(q(dom, '#invite-modal'))));
    q(dom, '#invite-submit').click();
    await sleep(50);
    check('an empty name is refused in the form', !q(dom, '#invite-error').classList.contains('hidden') && /name/i.test(txt(q(dom, '#invite-error'))));
    const name1 = 'Katarina Holm ' + SUF, email1 = sink('a');
    fill(dom, 'invite-name', name1); fill(dom, 'invite-email', email1); fill(dom, 'invite-note', 'Lovely speaking today, Katarina.');
    q(dom, '#invite-submit').click();
    const landed = await pollUntil(() => q(dom, '#invite-modal').classList.contains('hidden') && qa(dom, '.cl-ir').some((r) => txt(r).includes(name1)), 30000);
    check('★ the invitation is created through the real function and the panel re-renders with it', landed, txt(q(dom, '#cl-invitations')).slice(0, 200));
    const { data: row1 } = await admin.from('client_invitations').select('*').eq('email', email1).order('created_at', { ascending: false }).limit(1).maybeSingle();
    check('★ ...a real row exists, attributed to the real PM, with a hash and no raw token', !!row1 && row1.full_name === name1 && row1.invited_by_email === 'pm@marketswave.local' && /^[0-9a-f]{64}$/.test(row1.token_hash), JSON.stringify(row1 && { n: row1.full_name, by: row1.invited_by_email }));
    if (row1) createdInv.push(row1.id);
    const { data: log1 } = await admin.from('email_log').select('status, subject').eq('related_entity_id', row1.id).maybeSingle();
    check('★ ...and a real email_log row (the real email path)', !!log1 && log1.status === 'sent' && /invitation/i.test(log1.subject), JSON.stringify(log1));
    check('the toast confirms it was sent', /Invitation sent/.test(txt(q(dom, '#admin-toast'))), txt(q(dom, '#admin-toast')));
    const r1 = invRow(dom, row1.id);
    check('the row: dashed initials, name, email, "Sent" pill, Resend + Revoke', !!r1 && /^[A-Z]{2}$/.test(txt(r1.querySelector('.cl-iav'))) && /Sent/.test(txt(r1.querySelector('.cl-istat'))) && !!r1.querySelector('[data-cl-inv-resend]') && !!r1.querySelector('[data-cl-inv-revoke][data-mode="revoke"]'), r1 && txt(r1));
    const strip2 = qa(dom, '.cl-hc');
    check('★ "Invitations out" went up by one; "Clients" did NOT — separate facts', Number(txt(strip2[1].querySelector('.cl-v'))) === outBefore + 1 && Number(txt(strip2[0].querySelector('.cl-v'))) === clientsBefore, txt(strip2[1]) + ' / ' + txt(strip2[0]));

    console.log('\n=== PART 3: the two refusals, shown where the PM is looking ===\n');
    q(dom, '#open-invite-modal').click();
    fill(dom, 'invite-name', 'Katarina Again'); fill(dom, 'invite-email', email1.toUpperCase());
    q(dom, '#invite-submit').click();
    const dupShown = await pollUntil(() => !q(dom, '#invite-error').classList.contains('hidden') && /already out/.test(txt(q(dom, '#invite-error'))), 20000);
    check('★ a duplicate live invitation: the server\'s own "already out" sentence appears in the modal, modal stays open', dupShown && !q(dom, '#invite-modal').classList.contains('hidden'), txt(q(dom, '#invite-error')));
    const { data: gary } = await admin.from('clients').select('email, name').ilike('name', '%Gary%').maybeSingle();
    if (gary) {
      fill(dom, 'invite-name', 'Gary Again'); fill(dom, 'invite-email', gary.email);
      q(dom, '#invite-submit').click();
      const exShown = await pollUntil(() => /already belongs to a client/.test(txt(q(dom, '#invite-error'))), 20000);
      check('★ an address that already belongs to a client: refused with the server\'s sentence naming them', exShown && txt(q(dom, '#invite-error')).includes(gary.name), txt(q(dom, '#invite-error')));
    } else console.log('  SKIP  Gary is not seeded — existing-client refusal is covered by the backend suite');
    q(dom, '#invite-cancel').click();
    check('Cancel closes the modal', q(dom, '#invite-modal').classList.contains('hidden'));

    console.log('\n=== PART 4: Opened, Resend (token rotates), Revoke (confirm step) ===\n');
    // the person opens the link — the suite stands in for the inbox with a token it knows
    const tok = crypto.randomBytes(32).toString('base64url');
    await admin.from('client_invitations').update({ token_hash: sha256(tok) }).eq('id', row1.id);
    const opened = await fetch(st.API_URL + '/functions/v1/get-invitation', { method: 'POST', headers: { Authorization: 'Bearer ' + st.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok }) });
    check('GUARD: the link was opened for real (200)', opened.status === 200);
    await dom.window.MarketswaveClientList.reload();
    await pollUntil(() => invRow(dom, row1.id) && /Opened/.test(txt(invRow(dom, row1.id).querySelector('.cl-istat'))), 20000);
    check('★ the pending list now shows Opened', /Opened/.test(txt(invRow(dom, row1.id).querySelector('.cl-istat'))));
    const hashBefore = (await admin.from('client_invitations').select('token_hash').eq('id', row1.id).single()).data.token_hash;
    invRow(dom, row1.id).querySelector('[data-cl-inv-resend]').click();
    const resent = await pollUntil(() => /Invitation resent/.test(txt(q(dom, '#admin-toast'))), 30000);
    check('★ Resend through the real button: toast says a fresh link went out and the old one no longer works', resent && /no longer works/.test(txt(q(dom, '#admin-toast'))), txt(q(dom, '#admin-toast')));
    const hashAfter = (await admin.from('client_invitations').select('token_hash').eq('id', row1.id).single()).data.token_hash;
    check('★ ...the stored token hash genuinely rotated', hashAfter !== hashBefore);
    const reopen = await fetch(st.API_URL + '/functions/v1/get-invitation', { method: 'POST', headers: { Authorization: 'Bearer ' + st.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok }) });
    check('★ ...and the previously mailed link is refused (404)', reopen.status === 404);
    const { count: logs } = await admin.from('email_log').select('*', { count: 'exact', head: true }).eq('related_entity_id', row1.id);
    check('a second real email_log row for the resend', logs === 2, String(logs));

    await pollUntil(() => invRow(dom, row1.id), 10000);
    invRow(dom, row1.id).querySelector('[data-cl-inv-revoke]').click();
    check('★ Revoke opens a confirm step naming the person and the consequence — nothing revoked yet', !q(dom, '#invite-revoke-modal').classList.contains('hidden') && txt(q(dom, '#invite-revoke-body')).includes(name1) && /stops working/.test(txt(q(dom, '#invite-revoke-body'))) && (await admin.from('client_invitations').select('status').eq('id', row1.id).single()).data.status === 'opened');
    q(dom, '#invite-revoke-cancel').click();
    check('"Keep it" folds the confirm and revokes nothing', q(dom, '#invite-revoke-modal').classList.contains('hidden') && (await admin.from('client_invitations').select('status').eq('id', row1.id).single()).data.status === 'opened');
    invRow(dom, row1.id).querySelector('[data-cl-inv-revoke]').click();
    q(dom, '#invite-revoke-submit').click();
    const gone = await pollUntil(() => !invRow(dom, row1.id) && /Invitation revoked/.test(txt(q(dom, '#admin-toast'))), 30000);
    check('★ confirming revokes it for real — the row leaves the pending list and Postgres says revoked', gone && (await admin.from('client_invitations').select('status').eq('id', row1.id).single()).data.status === 'revoked');

    console.log('\n=== PART 5: an expired invitation — Invite again, Remove ===\n');
    const name2 = 'Lena Nystrom ' + SUF, email2 = sink('b');
    q(dom, '#open-invite-modal').click(); fill(dom, 'invite-name', name2); fill(dom, 'invite-email', email2); q(dom, '#invite-submit').click();
    await pollUntil(() => q(dom, '#invite-modal').classList.contains('hidden') && qa(dom, '.cl-ir').some((r) => txt(r).includes(name2)), 30000);
    const { data: row2 } = await admin.from('client_invitations').select('id').eq('email', email2).in('status', ['sent', 'opened']).maybeSingle();
    createdInv.push(row2.id);
    await admin.from('client_invitations').update({ expires_at: new Date(Date.now() - 86400000).toISOString() }).eq('id', row2.id);
    await dom.window.MarketswaveClientList.reload();
    await pollUntil(() => invRow(dom, row2.id) && invRow(dom, row2.id).classList.contains('is-expired'), 20000);
    const r2 = invRow(dom, row2.id);
    check('★ the list settles it to Expired: tinted row, Expired pill, "expired N ago", Invite again + Remove (no Resend)', !!r2 && /Expired/.test(txt(r2.querySelector('.cl-istat'))) && /expired/.test(txt(r2.querySelector('.cl-isent'))) && !!r2.querySelector('[data-cl-inv-again]') && !!r2.querySelector('[data-mode="remove"]') && !r2.querySelector('[data-cl-inv-resend]'), r2 && txt(r2));
    const strip3 = qa(dom, '.cl-hc');
    check('"Invitations out" does not count the expired one', Number(txt(strip3[1].querySelector('.cl-v'))) === outBefore, txt(strip3[1]));
    r2.querySelector('[data-cl-inv-again]').click();
    check('★ "Invite again" opens the modal PRE-FILLED with their name and address', !q(dom, '#invite-modal').classList.contains('hidden') && q(dom, '#invite-name').value === name2 && q(dom, '#invite-email').value === email2);
    q(dom, '#invite-submit').click();
    const again = await pollUntil(() => q(dom, '#invite-modal').classList.contains('hidden') && qa(dom, '.cl-ir[data-status="sent"]').some((r) => txt(r).includes(name2)), 30000);
    check('★ ...and creates a NEW live row beside the expired one', again && !!invRow(dom, row2.id), qa(dom, '.cl-ir').map((r) => r.dataset.status).join(','));
    const { data: row2b } = await admin.from('client_invitations').select('id').eq('email', email2).eq('status', 'sent').maybeSingle();
    if (row2b) createdInv.push(row2b.id);
    invRow(dom, row2.id).querySelector('[data-mode="remove"]').click();
    check('Remove opens the confirm with "Remove" wording', /Remove this expired invitation/.test(txt(q(dom, '#invite-revoke-title'))) && txt(q(dom, '#invite-revoke-submit')) === 'Remove');
    q(dom, '#invite-revoke-submit').click();
    const removed = await pollUntil(() => !invRow(dom, row2.id) && /Invitation removed/.test(txt(q(dom, '#admin-toast'))), 30000);
    check('★ Remove clears the expired row from the list; the new live one stays', removed && !!invRow(dom, row2b.id));
  } finally {
    for (const id of createdInv) await admin.from('client_invitations').delete().eq('id', id);
    await admin.from('client_invitations').delete().like('email', '%invui-%' + SUF + '%');
    const { count } = await admin.from('client_invitations').select('*', { count: 'exact', head: true }).like('email', '%' + SUF + '%');
    if (count) console.log('  TEARDOWN WARNING: ' + count + ' invitation(s) left behind');
  }

  console.log('\n' + '='.repeat(70));
  console.log(passed + ' passed, ' + fails.length + ' failed');
  console.log('CLIENT INVITATIONS UI: ' + (fails.length ? 'FAIL' : 'PASS'));
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 300000 });
