#!/usr/bin/env node
// ★ Fired price alerts, shown to the client (2026-09-30, register row 291).
//
// Alerts are FIRED FOR REAL: client A sets a real alert through set-price-alert on a real
// watched symbol, and a real check-price-alerts sweep (a PM's token, as the scheduler's
// fallback path allows) fires it against the real cached price. Nothing is inserted as
// already-fired, except one deliberately back-dated row for the 30-day window check.
//
// Proves: get-watchlist returns the fired alert on the RIGHT symbol only; another client
// cannot see it (their get-watchlist, and a direct RLS read) nor dismiss it (404, row provably
// unchanged); dismissing keeps the row (status still fired, dismissed_at set — not deleted);
// setting a new alert dismisses the fired one it replaces; a fired alert older than 30 days is
// not returned. Then the REAL dashboard.html script in a real DOM: the triggered line is on
// the right card, the bell's link opens that card's drawer with Dismiss / Set a new alert, the
// REAL dashboard-notifications.js bell lists it with that link, and clicking Dismiss hides it
// from the card and the bell.
// Emails go to malformed addresses — no real mail is sent.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { runVerifyMain } from './lib/run-verify.mjs';

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
async function pollUntil(test, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { if (await test()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return test();
}
function creds() {
  const raw = execSync('supabase status -o json', { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
  const st = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) throw new Error('Refusing to run against a non-local API_URL');
  return { url: st.API_URL, anonKey: st.ANON_KEY, serviceRoleKey: st.SERVICE_ROLE_KEY };
}
async function fn(url, token, name, body) {
  const r = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  let json = null; try { json = await r.json(); } catch (_e) {}
  return { status: r.status, body: json };
}
const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function main() {
  console.log('Fired price alerts, shown to the client\n');
  const { url, anonKey, serviceRoleKey } = creds();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const users = [];
  async function makeClient(tag) {
    const email = 'firedalert-' + tag + '-' + suffix + '@test.marketswave.local', password = 'FiredAlert-2026!' + suffix;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    users.push(data.user.id);
    await admin.from('clients').insert({ id: data.user.id, name: 'Fired Alert Fixture ' + tag + ' ' + suffix, email: 'firedalert-malformed-' + tag + '-' + suffix, phone: '+46 70 000 0000', account_type: 'Individual Account', status: 'active' });
    const s = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: sd, error: se } = await s.auth.signInWithPassword({ email, password });
    if (se) throw new Error(se.message);
    return { id: data.user.id, email, password, token: sd.session.access_token, client: s };
  }
  const pm = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: pmS, error: pmE } = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmE) throw new Error('PM sign-in: ' + pmE.message);

  try {
    const A = await makeClient('a');
    const B = await makeClient('b');

    // ---------------------------------------------------------------- backend
    console.log('--- backend: a real alert, fired by a real sweep ---\n');
    const wlA = await fn(url, A.token, 'get-watchlist');
    check('client A\'s watchlist loads (the six defaults seed on first read)', wlA.status === 200 && wlA.body.symbols.length >= 6, JSON.stringify(wlA.body).slice(0, 120));
    const target = wlA.body.symbols.find((s) => s.price != null && s.symbol === 'BTC') || wlA.body.symbols.find((s) => s.price != null);
    const other = wlA.body.symbols.find((s) => s.id !== target.id);
    check('a watched symbol with a real cached price exists to fire against', !!target, JSON.stringify(wlA.body.symbols.map((s) => [s.symbol, s.price])));
    // "below" a target twice the current price is already crossed: the next sweep fires it.
    const t1 = Math.round(target.price * 2);
    const set1 = await fn(url, A.token, 'set-price-alert', { watchlistSymbolId: target.id, direction: 'below', targetPrice: t1 });
    check('set-price-alert accepts the alert', set1.status === 200, JSON.stringify(set1.body));
    const sweep = await fn(url, pmS.session.access_token, 'check-price-alerts');
    check('a real check-price-alerts sweep runs', sweep.status === 200, JSON.stringify(sweep.body).slice(0, 160));
    const { data: firedRow } = await admin.from('price_alerts').select('*').eq('id', set1.body.id).single();
    check('★ the alert genuinely FIRED (status fired, the real price it fired at, a time)', firedRow.status === 'fired' && firedRow.fired_price != null && !!firedRow.fired_at, JSON.stringify(firedRow));

    const wlA2 = await fn(url, A.token, 'get-watchlist');
    const tRow = wlA2.body.symbols.find((s) => s.id === target.id);
    check('★ get-watchlist returns the fired alert on the RIGHT symbol, with target, fired price and time', tRow.firedAlert && tRow.firedAlert.id === firedRow.id && tRow.firedAlert.targetPrice === t1 && tRow.firedAlert.firedPrice === Number(firedRow.fired_price) && tRow.firedAlert.direction === 'below' && !!tRow.firedAlert.firedAt, JSON.stringify(tRow.firedAlert));
    check('...and on no other symbol', wlA2.body.symbols.filter((s) => s.firedAlert).length === 1);
    check('...and the fired alert is not also reported as the active alert', tRow.alert === null, JSON.stringify(tRow.alert));

    // Isolation
    const wlB = await fn(url, B.token, 'get-watchlist');
    check('★ another client\'s get-watchlist carries no fired alert', wlB.status === 200 && wlB.body.symbols.every((s) => !s.firedAlert));
    const { data: bRead } = await B.client.from('price_alerts').select('id').eq('id', firedRow.id);
    check('★ another client cannot read it directly (RLS returns nothing)', Array.isArray(bRead) && bRead.length === 0, JSON.stringify(bRead));
    const bDis = await fn(url, B.token, 'clear-price-alert', { dismissAlertId: firedRow.id });
    const { data: afterB } = await admin.from('price_alerts').select('dismissed_at, status').eq('id', firedRow.id).single();
    check('★ another client cannot dismiss it: 404, and the row is provably unchanged', bDis.status === 404 && afterB.dismissed_at === null && afterB.status === 'fired', bDis.status + ' ' + JSON.stringify(afterB));
    const anonDis = await fn(url, anonKey, 'clear-price-alert', { dismissAlertId: firedRow.id });
    check('an anonymous caller is refused 401', anonDis.status === 401, String(anonDis.status));

    // 30-day window: a back-dated fired row on another symbol is not returned.
    const { data: old, error: oldErr } = await admin.from('price_alerts').insert({ client_id: A.id, watchlist_symbol_id: other.id, symbol: other.symbol, direction: 'above', target_price: 1, status: 'fired', fired_at: new Date(Date.now() - 31 * 86400000).toISOString(), fired_price: 2 }).select().single();
    if (oldErr) throw new Error(oldErr.message);
    const wlA3 = await fn(url, A.token, 'get-watchlist');
    check('a fired alert older than 30 days is not returned', !wlA3.body.symbols.find((s) => s.id === other.id).firedAlert);

    // ---------------------------------------------------------------- the real page
    console.log('\n--- the real dashboard.html card and the real bell ---\n');
    globalThis.window = { location: { hostname: '127.0.0.1', search: '' } };
    await import('../supabase-data.js');
    const MD = globalThis.window.MarketswaveData;
    const supa = await MD.getSupabaseClient();
    await supa.auth.signInWithPassword({ email: A.email, password: A.password });
    const html = readFileSync(ROOT + 'dashboard.html', 'utf8');
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
    const dom = new JSDOM('<!doctype html><html><body>' + body + '</body></html>', { url: 'http://localhost/dashboard.html#wl-alert-' + target.id, runScripts: 'outside-only' });
    const win = dom.window, doc = win.document;
    win.MarketswaveData = MD;
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.indexOf('MARKET SNAPSHOT + WATCHLIST') !== -1);
    win.eval(readFileSync(ROOT + 'asset-mark.js', 'utf8'));
    win.eval(script);
    const rows = doc.getElementById('wl-rows');
    await pollUntil(() => rows.querySelector('.wl-card[data-wl-card]'), 30000);
    const card = rows.querySelector('.wl-card[data-wl-card="' + target.id + '"]');
    const line = card && card.querySelector('.wl-fired');
    const expectText = 'Fell below ' + '$' + t1.toLocaleString('en-US');
    check('★ the triggered line is on the RIGHT card: "Fell below $<target> · at $<price> · <date>"', !!line && line.textContent.indexOf(expectText) !== -1 && / · at \$/.test(line.textContent) && / · \d{1,2} [A-Z][a-z]{2,3}$/.test(line.textContent), line && line.textContent);
    check('...and on no other card', rows.querySelectorAll('.wl-fired').length === 1);
    check('the line names itself for a screen reader', !!line && /Price alert triggered/.test(line.textContent));
    const drawer = rows.querySelector('.wl-drawer[data-wl-drawer="' + target.id + '"]');
    check('★ the bell link (#wl-alert-<id>) opened that card\'s drawer', !!drawer);
    const dismissBtn = drawer && drawer.querySelector('[data-wl-dismiss="' + firedRow.id + '"]');
    const renewBtn = drawer && [...drawer.querySelectorAll('[data-wl-bell]')].find((b) => /Set a new alert/.test(b.textContent));
    check('the drawer offers Dismiss and Set a new alert, as real buttons', !!dismissBtn && !!renewBtn && dismissBtn.tagName === 'BUTTON' && renewBtn.tagName === 'BUTTON');
    check('no button is nested inside the card (the card is itself a button)', card.querySelectorAll('button').length === 0);

    // The bell, real code, same page.
    const mount = doc.createElement('div'); mount.id = 'notif-bell-mount'; doc.body.appendChild(mount);
    // engine-core.js loads before the bell on every real page; its read-state key comes from here.
    win.clientScopedKey = function (k) { return k + ':' + A.id; };
    win.getAuthenticatedClientId = function () { return A.id; };
    win.eval(readFileSync(ROOT + 'dashboard-notifications.js', 'utf8'));
    win.initDashboardNotifications();
    doc.getElementById('notif-bell-btn').click();
    await pollUntil(() => doc.querySelector('#notif-bell-list a[href*="wl-alert-"]'), 15000);
    const bellItem = doc.querySelector('#notif-bell-list a[href*="wl-alert-"]');
    check('★ the bell lists it, linking to that symbol\'s card', !!bellItem && bellItem.getAttribute('href') === 'dashboard.html#wl-alert-' + target.id && bellItem.textContent.indexOf(target.symbol + ' fell below $') !== -1, bellItem && (bellItem.getAttribute('href') + ' | ' + bellItem.textContent.trim().slice(0, 90)));
    check('the bell lists only the in-window alert (the 31-day-old one is absent)', doc.querySelectorAll('#notif-bell-list a[href*="wl-alert-"]').length === 1);

    dismissBtn.click();
    await pollUntil(() => !rows.querySelector('.wl-fired') && rows.querySelector('.wl-card[data-wl-card]'), 15000);
    check('★ Dismiss hides it from the card', !rows.querySelector('.wl-fired'));
    const { data: afterDis } = await admin.from('price_alerts').select('status, dismissed_at').eq('id', firedRow.id).single();
    check('★ dismissing keeps the record — status still fired, dismissed_at set, not deleted', afterDis && afterDis.status === 'fired' && !!afterDis.dismissed_at, JSON.stringify(afterDis));
    doc.getElementById('notif-bell-btn').click(); await new Promise((r) => setTimeout(r, 300));
    doc.getElementById('notif-bell-btn').click();
    await pollUntil(() => doc.getElementById('notif-bell-list').textContent.length > 0 || !doc.getElementById('notif-bell-empty').classList.contains('hidden'), 15000);
    await new Promise((r) => setTimeout(r, 800));
    check('★ ...and from the bell', !doc.querySelector('#notif-bell-list a[href*="wl-alert-"]'));
    const again = await fn(url, A.token, 'clear-price-alert', { dismissAlertId: firedRow.id });
    check('dismissing twice is a 404, not a second write', again.status === 404, String(again.status));

    // Set a new alert replaces a fired one.
    const set2 = await fn(url, A.token, 'set-price-alert', { watchlistSymbolId: target.id, direction: 'below', targetPrice: t1 });
    await fn(url, pmS.session.access_token, 'check-price-alerts');
    const wlA4 = await fn(url, A.token, 'get-watchlist');
    check('a second real fire shows again on the card read', !!wlA4.body.symbols.find((s) => s.id === target.id).firedAlert);
    const set3 = await fn(url, A.token, 'set-price-alert', { watchlistSymbolId: target.id, direction: 'above', targetPrice: Math.round(target.price * 3) });
    const wlA5 = await fn(url, A.token, 'get-watchlist');
    const r5 = wlA5.body.symbols.find((s) => s.id === target.id);
    const { data: f2 } = await admin.from('price_alerts').select('status, dismissed_at').eq('id', set2.body.id).single();
    check('★ "Set a new alert" dismisses the fired one it replaces: the card shows the new live alert, no triggered line', set3.status === 200 && r5.alert && r5.alert.direction === 'above' && !r5.firedAlert && f2.status === 'fired' && !!f2.dismissed_at, JSON.stringify({ alert: r5.alert, fired: r5.firedAlert, f2 }));
  } finally {
    for (const id of users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log('  cleanup: ' + error.message);
    }
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nFIRED ALERTS: ' + (failed ? 'FAIL' : 'PASS'));
  if (failed) throw new Error(failed + ' assertion(s) failed');
}
runVerifyMain(main);
