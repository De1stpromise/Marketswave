#!/usr/bin/env node
// ★ The inbox catches up after every SUBSCRIBED (row 286, open cause 8).
//
// admin-inbox.html loads conversations and messages first and subscribes afterwards, and
// Realtime can report SUBSCRIBED while its change capture is still restarting after an idle
// spell. Either way a message can land where no live event will ever describe it. The page
// now re-reads once after every SUBSCRIBED and merges by id.
//
// This cannot be proven with real Realtime, which delivers the event almost every time and
// would make the check pass for the wrong reason. So the page's client is wrapped: .channel()
// returns a channel that RECORDS the page's handlers, NEVER delivers a live event on its own,
// and reports SUBSCRIBED only when this suite says so. A message inserted between the page's
// first load and that SUBSCRIBED can then reach the screen by exactly one route — the
// catch-up read. Everything else is real: the page script, supabase-data.js, the admin
// session, RLS, and the rows in Postgres.
//
// Proves: the message is absent before SUBSCRIBED (non-vacuity), present after it, present
// exactly once when the recorded live INSERT handler later delivers the same row (the merge
// dedupes), and a reconnect (a second SUBSCRIBED) picks up a second missed message.
// Forced-failure control: MW_INBOX_CATCHUP_CONTROL=1 strips the page's catchUp() call before
// evaluating it; the "appears after SUBSCRIBED" checks must then fail by name.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(test, maxMs) {
  const start = Date.now();
  for (;;) { const r = await test(); if (r) return r; if (Date.now() - start > maxMs) return r; await sleep(150); }
}
function readLocalStackCredentials() {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const raw = execSync('supabase status -o json', { cwd: scriptsDir + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTROL = process.env.MW_INBOX_CATCHUP_CONTROL === '1';
// MW_INBOX_CATCHUP_CONTROL=identity swaps in the first cut of mergeById, which REPLACED objects.
const CONTROL_IDENTITY = process.env.MW_INBOX_CATCHUP_CONTROL === 'identity';
const tempFiles = [];

async function main() {
  console.log('The inbox catches up after SUBSCRIBED' + (CONTROL ? ' — FORCED-FAILURE CONTROL (catchUp() removed)' : '') + '\n');
  const { url, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  let convoId = null;
  try {
    const { data: c, error: ce } = await admin.from('conversations').insert({ kind: 'chat', contact_email: 'catchup-' + suffix + '@invalid.test', contact_name: 'Catch-up Fixture ' + suffix }).select('id').single();
    if (ce) throw new Error(ce.message);
    convoId = c.id;
    const { error: me } = await admin.from('messages').insert({ conversation_id: convoId, channel: 'chat', direction: 'inbound', body: 'seed-' + suffix, sender_name: 'Fixture', sent_at: new Date(Date.now() - 60000).toISOString() });
    if (me) throw new Error(me.message);

    const html = readFileSync(PROJECT_ROOT + 'admin-inbox.html', 'utf8');
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
    const vc = new VirtualConsole(); vc.on('jsdomError', function () {});
    const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', { url: 'http://127.0.0.1:8765/admin-inbox.html?c=' + convoId, runScripts: 'outside-only', virtualConsole: vc, pretendToBeVisual: true });
    globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;
    const tmp = PROJECT_ROOT + '.tmp-inbox-catchup-' + process.pid + '.mjs';
    writeFileSync(tmp, readFileSync(PROJECT_ROOT + 'supabase-data.js', 'utf8'), 'utf8'); tempFiles.push(tmp);
    await import('file://' + tmp.replace(/\\/g, '/'));
    const cfg = await import('../admin-supabase-config.js');
    const { error: se } = await cfg.supabase.auth.signInWithPassword({ email: cfg.LOCAL_ADMIN_EMAIL, password: cfg.LOCAL_ADMIN_PASSWORD });
    check('the real admin session signs in', !se, se && se.message);
    dom.window.currentEnvQuery = function () { return ''; };

    // The controllable channel. Everything the page asks of the client except .channel() is real.
    const handlers = []; let subscribeCb = null;
    const MD = dom.window.MarketswaveData;
    const realGet = MD.getSupabaseClient;
    MD.getSupabaseClient = function () {
      return realGet.apply(this, arguments).then(function (client) {
        return new Proxy(client, { get(t, k) {
          if (k !== 'channel') { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }
          return function () {
            const ch = { on(type, filter, fn) { handlers.push({ filter, fn }); return ch; }, subscribe(cb) { subscribeCb = cb; return ch; }, unsubscribe() {} };
            return ch;
          };
        } });
      });
    };

    let script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.indexOf('loadAndSubscribe') !== -1);
    if (CONTROL) {
      const n = (script.match(/if \(status === 'SUBSCRIBED'\) catchUp\(\);/g) || []).length;
      script = script.replace("if (status === 'SUBSCRIBED') catchUp();", '');
      console.log('  (control: removed ' + n + ' catchUp() call)');
    }
    if (CONTROL_IDENTITY) {
      const a = script.indexOf('      function mergeById('), b = script.indexOf('      function catchUp(');
      script = script.slice(0, a) + "      function mergeById(current, fresh) { var seen = {}; var merged = fresh.map(function (row) { seen[row.id] = true; return row; }); current.forEach(function (row) { if (!seen[row.id]) merged.push(row); }); return merged; }\n" + script.slice(b);
      console.log('  (control: mergeById replaced with the object-replacing first cut)');
    }
    // Hold admin-update-conversation before it reaches the server until the suite releases it,
    // so a catch-up can be made to run while an action holds a row.
    let gate = null;
    const realCall = MD.callFunction;
    MD.callFunction = function (name) { const args = arguments; if (name === 'admin-update-conversation' && gate) return gate.then(() => realCall.apply(MD, args)); return realCall.apply(MD, args); };
    dom.window.eval(script);
    const D = dom.window.document;
    const threadHas = (text) => (D.getElementById('thread-messages').textContent || '').indexOf(text) !== -1;
    const threadCount = (text) => (D.getElementById('thread-messages').textContent || '').split(text).length - 1;

    await waitFor(() => subscribeCb && threadHas('seed-' + suffix), 15000);
    check('the page loaded, opened the fixture thread and asked to subscribe', !!subscribeCb && threadHas('seed-' + suffix), 'subscribeCb=' + !!subscribeCb);
    check('the channel registered the live INSERT handler for messages', handlers.some((h) => h.filter && h.filter.table === 'messages' && h.filter.event === 'INSERT'));

    // A message lands after the first load and before SUBSCRIBED: no live event will describe it.
    const missed1 = 'missed-before-subscribed-' + suffix;
    const { data: m1, error: e1 } = await admin.from('messages').insert({ conversation_id: convoId, channel: 'chat', direction: 'inbound', body: missed1, sender_name: 'Fixture' }).select('*').single();
    if (e1) throw new Error(e1.message);
    await sleep(1500);
    check('NON-VACUITY: before SUBSCRIBED the missed message is not on screen (nothing else can deliver it)', !threadHas(missed1));

    subscribeCb('SUBSCRIBED');
    await waitFor(() => threadHas(missed1), 8000);
    check('★ after SUBSCRIBED the missed message appears — recovered by the catch-up read alone', threadHas(missed1));
    check('the status reads Live', D.getElementById('realtime-status').textContent === 'Live', D.getElementById('realtime-status').textContent);

    // The live feed later delivers the same row (capture came back and replayed it): no duplicate.
    const ins = handlers.find((h) => h.filter && h.filter.table === 'messages' && h.filter.event === 'INSERT');
    ins.fn({ new: m1 });
    await sleep(300);
    check('★ the same row arriving live afterwards is merged, not duplicated (shown exactly once)', threadCount(missed1) === 1, 'count=' + threadCount(missed1));

    // A reconnect: another missed message, then a second SUBSCRIBED.
    const missed2 = 'missed-during-reconnect-' + suffix;
    const { error: e2 } = await admin.from('messages').insert({ conversation_id: convoId, channel: 'chat', direction: 'inbound', body: missed2, sender_name: 'Fixture' });
    if (e2) throw new Error(e2.message);
    subscribeCb('CHANNEL_ERROR');
    await sleep(300);
    check('a dropped channel shows its status rather than Live', D.getElementById('realtime-status').textContent === 'CHANNEL_ERROR');
    subscribeCb('SUBSCRIBED');
    await waitFor(() => threadHas(missed2), 8000);
    check('★ after a reconnect SUBSCRIBED the message missed during the gap appears', threadHas(missed2));
    check('...and nothing earlier is duplicated by the second catch-up', threadCount(missed1) === 1 && threadCount('seed-' + suffix) === 1);

    // An action in flight across a catch-up: the row it holds must still be the one on screen.
    let release; gate = new Promise((r) => { release = r; });
    D.getElementById('thread-resolve-btn').click();
    await sleep(200);
    subscribeCb('SUBSCRIBED');                        // catch-up runs while the resolve is held
    await sleep(1500);
    release(); gate = null;                           // the resolve now reaches the server
    const badge = () => D.getElementById('thread-status-badge');
    await waitFor(() => badge() && /resolved/i.test(badge().textContent), 8000);
    const { data: row } = await admin.from('conversations').select('status').eq('id', convoId).single();
    check('the resolve genuinely landed in Postgres', row && row.status === 'resolved', row && row.status);
    check('★ a catch-up during an in-flight action does not orphan the row it holds: the header shows Resolved with no live event', badge() && /resolved/i.test(badge().textContent), badge() && badge().textContent);
  } finally {
    if (convoId) { await admin.from('messages').delete().eq('conversation_id', convoId); await admin.from('conversations').delete().eq('id', convoId); }
    for (const f of tempFiles) { try { unlinkSync(f); } catch (_e) {} }
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nINBOX CATCH-UP: ' + (failed ? 'FAIL' : 'PASS'));
  // runVerifyMain() exits 0 on any normal return (it ignores process.exitCode), so a
  // failing run must throw to reach its exit(1) path.
  if (failed) throw new Error(failed + ' assertion(s) failed');
}
runVerifyMain(main);
