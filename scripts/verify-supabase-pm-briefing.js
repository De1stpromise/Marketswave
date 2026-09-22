#!/usr/bin/env node
// verify-supabase-pm-briefing.js — PM tool revamp, part 2: the Overview as a daily briefing
// (2026-09-14). Backend/API level, against the local Supabase stack.
//
//   npm run supabase-verify-pm-briefing      (from scripts/; functions serve must be running)
//
// EVERY FIGURE CROSS-CHECKED AGAINST ITS SOURCE, not merely rendered: each panel's figures
// are re-derived here with independent queries against the seeded rows (and, where a figure
// is a count over the whole stack, against a direct count) — never from the payload's own
// logic. Seeded: an active funded client (A) holding one concentrated position and idle
// capital, an application awaiting review (B), an active client holding value with no
// activity on record (C, dormant by the stated rule), a second active client (D) with a
// deposit address assigned so "no address" is proven as a difference rather than an absence;
// pending requests of several types with ages on both sides of the 24-hour line; unread
// conversations on all three channels; a pocket that matured since the PM's last session and
// one maturing in four days; an appraised product with a quarterly frequency valued 100 days
// ago (overdue) and another with no stated frequency; an unsigned document ten days old; a
// fired price alert; a live visitor session; a yesterday session that reached /signup.
//
// COVERS: authorization (401 / 403 for a real non-admin); the visit record — first briefing,
// same session, a new session after a 30-minute gap, and recordVisit:false leaving the clock
// alone; every panel's figures; pm_visits and scheduler_health() unreachable by a client.
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let passed = 0, failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function readLocalStackCredentials() {
  const raw = execSync('supabase status -o json', { cwd: __dirname + '/..', encoding: 'utf8' });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) throw new Error('Refusing to run against a non-local API_URL: ' + status.API_URL);
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}
async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error('signIn(' + email + ') failed: ' + error.message);
  return { client, token: data.session.access_token, userId: data.user.id };
}
async function callFunction(url, token, name, body) {
  const res = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body || {}) });
  let parsed = null; try { parsed = await res.json(); } catch (_e) { /* non-JSON */ }
  return { status: res.status, body: parsed };
}

async function main() {
  console.log('PM tool revamp, part 2 — the briefing: backend verification\n');
  const { url, anonKey, serviceRoleKey } = readLocalStackCredentials();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomBytes(4).toString('hex');
  const password = 'Briefing-2026!';
  const users = []; const convoIds = []; const productIds = []; let visitorRowId = null; const sessionIds = []; let addressId = null;
  const now = Date.now(); const H = 3600e3; const DAY = 24 * H;
  const iso = (t) => new Date(t).toISOString();
  const pmEmail = 'pm@marketswave.local';
  const pm = await signIn(url, anonKey, pmEmail, 'MarketswavePM-Local-2026!');
  // The PM's own visit row is part of the surface under test: snapshot it so the run leaves
  // the real PM's "since you last looked" exactly as it found it.
  const { data: pmVisitBefore } = await admin.from('pm_visits').select('*').eq('user_id', pm.userId).maybeSingle();

  async function makeClient(name, status, opts) {
    const email = 'briefing-' + name.toLowerCase() + '-' + suffix + '@test.marketswave.local';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    users.push(data.user.id);
    const ins = await admin.from('clients').insert(Object.assign({ id: data.user.id, name: name + ' ' + suffix, email: 'briefing-malformed-' + name.toLowerCase() + '-' + suffix, phone: '+1-555-0100', account_type: 'Individual Account', status }, opts || {}));
    if (ins.error) throw new Error(ins.error.message);
    return { id: data.user.id, email, name: name + ' ' + suffix };
  }

  try {
    // ---------------------------------------------------------------- seed
    console.log('--- Seed ---\n');
    const A = await makeClient('Alpha', 'active');
    const B = await makeClient('Bravo', 'pending_review');
    const C = await makeClient('Charlie', 'active');
    const D = await makeClient('Delta', 'active');
    const { data: prods } = await admin.from('products').select('id, name, unit_price, pricing_model').eq('pricing_model', 'market').limit(2);
    const P = prods[0];
    // A: $60,000 in one market product, $50,000 unallocated — the top holding is ~55% of TPV.
    const unitsA = 60000 / Number(P.unit_price);
    await admin.from('account_state').insert({ client_id: A.id, unallocated_capital: 50000, allocated_capital: 60000, asset_returns: 0 });
    await admin.from('holdings').insert({ client_id: A.id, product_id: P.id, units: unitsA, cost_basis: 60000 });
    await admin.from('transactions').insert({ client_id: A.id, type: 'DEPOSIT', total_value: 110000, status: 'completed' });
    // C: holds value, never signed in, no requests, no visits → dormant by the stated rule.
    await admin.from('account_state').insert({ client_id: C.id, unallocated_capital: 27900, allocated_capital: 0, asset_returns: 0 });
    // D: a small balance and a deposit address assigned.
    await admin.from('account_state').insert({ client_id: D.id, unallocated_capital: 1200, allocated_capital: 0, asset_returns: 0 });
    const { data: addr, error: addrErr } = await admin.from('deposit_addresses').insert({ currency: 'BTC', network: 'Bitcoin', address: 'bc1q' + suffix + 'briefingaddr00000000000000000000', label: 'briefing ' + suffix }).select('id').single();
    if (addrErr) throw new Error(addrErr.message); addressId = addr.id;
    const asg = await admin.from('deposit_address_assignments').insert({ address_id: addressId, client_id: D.id });
    if (asg.error) throw new Error(asg.error.message);
    // Pending requests with ages: one 3 days old (overdue), one 2 days (overdue), two fresh.
    await admin.from('withdrawal_requests').insert({ client_id: A.id, method: 'bank', requested_amount: 40000, currency: 'USD', destination_details: {}, status: 'pending', requested_at: iso(now - 3 * DAY) });
    await admin.from('allocation_requests').insert({ client_id: A.id, product_id: P.id, requested_amount: 5000, status: 'pending', requested_at: iso(now - 2 * DAY) });
    await admin.from('deposit_requests').insert({ client_id: A.id, method: 'crypto', currency: 'BTC', network: 'Bitcoin', tx_hash: 'abc', details: {}, status: 'pending', requested_at: iso(now - 5 * H) });
    await admin.from('profile_change_requests').insert({ client_id: D.id, field: 'address', current_value: null, requested_value: { street: 'X' }, status: 'pending', requested_at: iso(now - 1 * H) });
    // Unread conversations on all three channels; a read one; an archived unread one.
    async function convo(row) { const { data, error } = await admin.from('conversations').insert(row).select('id').single(); if (error) throw new Error(error.message); convoIds.push(data.id); return data.id; }
    async function msg(row) { const { error } = await admin.from('messages').insert(row); if (error) throw new Error(error.message); }
    const t1 = await convo({ client_id: A.id, contact_email: 'briefing-malformed-alpha-' + suffix, contact_name: A.name, kind: 'ticket', category: 'Transaction Issue', display_id: 'DISP-0001', status: 'in_progress' });
    await msg({ conversation_id: t1, channel: 'chat', direction: 'inbound', body: 'Still showing pending this morning.', sent_at: iso(now - 12 * 60000) });
    const g1 = await convo({ client_id: A.id, contact_email: 'briefing-malformed-alpha-' + suffix, contact_name: A.name, kind: 'chat', status: 'open' });
    await msg({ conversation_id: g1, channel: 'chat', direction: 'inbound', body: 'Quick question.', sent_at: iso(now - 30 * 60000) });
    const e1 = await convo({ contact_email: 'briefing-cold-' + suffix + '@example.com', contact_name: 'Sofia Berg', kind: 'email', subject: 'Fees', status: 'open' });
    await msg({ conversation_id: e1, channel: 'email', direction: 'inbound', body: 'What are your fees?', sent_at: iso(now - 20 * 60000), message_id: '<brief-' + suffix + '@example.com>' });
    const e2 = await convo({ contact_email: 'briefing-read-' + suffix + '@example.com', contact_name: 'Read Already', kind: 'email', subject: 'Old', status: 'open' });
    await msg({ conversation_id: e2, channel: 'email', direction: 'inbound', body: 'Read already.', sent_at: iso(now - 3 * DAY) });
    await admin.from('conversations').update({ unread_by_pm: false }).eq('id', e2);
    const ar = await convo({ contact_email: 'briefing-arch-' + suffix + '@example.com', contact_name: 'Archived', kind: 'email', subject: 'Archived', status: 'open' });
    await msg({ conversation_id: ar, channel: 'email', direction: 'inbound', body: 'Archived thread.', sent_at: iso(now - 4 * DAY) });
    await admin.from('conversations').update({ status: 'archived' }).eq('id', ar);
    // Pockets: one matured 20 minutes ago (still stored active), one maturing in 4 days, one flexible.
    const pockIns = await admin.from('hys_pockets').insert([
      { client_id: A.id, pocket_type: 'fixed', amount: 52400, status: 'active', term_mode: 'short', term_months: 6, term_label: '6 Months', rate: 8.5, term_in_years: 0.5, maturity_date: iso(now - 20 * 60000), projected_interest: 2227, funding_method: 'bank account', created_at: iso(now - 182 * DAY) },
      { client_id: A.id, pocket_type: 'fixed', amount: 10000, status: 'active', term_mode: 'short', term_months: 3, term_label: '3 Months', rate: 6, term_in_years: 0.25, maturity_date: iso(now + 4 * DAY), projected_interest: 150, funding_method: 'bank account', created_at: iso(now - 88 * DAY) },
      { client_id: D.id, pocket_type: 'ayw', amount: 3000, status: 'active', funding_method: 'bank account', projected_interest: 0, created_at: iso(now - 10 * DAY) }
    ]);
    if (pockIns.error) throw new Error('pockets: ' + pockIns.error.message);
    // Appraised products: one quarterly, valued 100 days ago (8 days overdue); one with no frequency.
    const navOver = 'PROD-BRF-' + suffix.toUpperCase() + 'A'; const navNone = 'PROD-BRF-' + suffix.toUpperCase() + 'B';
    productIds.push(navOver, navNone);
    const lastValued = iso(now - 100 * DAY).slice(0, 10);
    const pins = await admin.from('products').insert([
      { id: navOver, name: 'Briefing Quarterly Fund ' + suffix, asset_class: 'Private Equity', investment_type: 'Fund', risk_tier: 'aggressive', minimum_investment: 10000, unit_price: 646.04, inception_unit_price: 500, pricing_model: 'appraisal', last_tick_date: lastValued, created_at: iso(now - 400 * DAY) },
      { id: navNone, name: 'Briefing Unstated Fund ' + suffix, asset_class: 'Real Assets', investment_type: 'Trust', risk_tier: 'balanced', minimum_investment: 10000, unit_price: 100, inception_unit_price: 100, pricing_model: 'appraisal', last_tick_date: lastValued, created_at: iso(now - 400 * DAY) }
    ]);
    if (pins.error) throw new Error(pins.error.message);
    const pd = await admin.from('product_documents').insert({ product_id: navOver, status: 'published', content: { sections: [{ key: 'terms', horizon: '5 years', valuationFrequency: 'Quarterly', fees: '2%' }] }, published_content: { sections: [{ key: 'terms', horizon: '5 years', valuationFrequency: 'Quarterly', fees: '2%' }] } });
    if (pd.error) throw new Error(pd.error.message);
    // An unsigned document sent 10 days ago; a signed one (must not appear).
    await admin.from('documents').insert([
      { client_id: A.id, filename: 'Advisory agreement.pdf', category: 'Contracts', direction: 'from', status: 'Signature Required', created_at: iso(now - 10 * DAY) },
      { client_id: A.id, filename: 'Signed.pdf', category: 'Contracts', direction: 'from', status: 'Signed', created_at: iso(now - 20 * DAY) }
    ]);
    // A fired price alert (yesterday) and an active one.
    const { data: ws } = await admin.from('watchlist_symbols').insert({ client_id: A.id, symbol: 'BRF' + suffix.toUpperCase().slice(0, 4), name: 'Briefing Sym', source: 'finnhub', asset_type: 'stock' }).select('id').single();
    await admin.from('price_alerts').insert({ client_id: A.id, watchlist_symbol_id: ws.id, symbol: 'BRF' + suffix.toUpperCase().slice(0, 4), direction: 'above', target_price: 10, status: 'fired', fired_at: iso(now - 1 * DAY), fired_price: 11 });
    // Presence: one live session now (a visitor in Munich), one yesterday that reached /signup.
    visitorRowId = crypto.randomUUID();
    await admin.from('visitors').insert({ id: visitorRowId, visit_count: 2, first_seen_at: iso(now - 2 * DAY), last_seen_at: iso(now) });
    const y = new Date(); y.setUTCDate(y.getUTCDate() - 1); y.setUTCHours(10, 0, 0, 0);
    const s1 = await admin.from('visitor_sessions').insert({ id: crypto.randomUUID(), visitor_id: visitorRowId, visit_number: 2, started_at: iso(now - 2 * 60000), last_seen_at: iso(now), current_path: '/services', page_count: 2, journey: [{ p: '/', t: iso(now - 2 * 60000) }, { p: '/services', t: iso(now - 60000) }], city: 'Munich', country: 'Germany', country_code: 'DE' }).select('id').single();
    const s2 = await admin.from('visitor_sessions').insert({ id: crypto.randomUUID(), visitor_id: visitorRowId, visit_number: 1, started_at: y.toISOString(), last_seen_at: new Date(y.getTime() + 5 * 60000).toISOString(), ended_at: new Date(y.getTime() + 5 * 60000).toISOString(), current_path: '/signup', page_count: 3, journey: [{ p: '/', t: y.toISOString() }, { p: '/signup', t: new Date(y.getTime() + 60000).toISOString() }], city: 'Munich', country: 'Germany', country_code: 'DE' }).select('id').single();
    sessionIds.push(s1.data.id, s2.data.id);
    console.log('  seeded 4 clients, 4 pending requests, 5 conversations, 3 pockets, 2 appraised products, 2 documents, 1 fired alert, 2 sessions');

    // ---------------------------------------------------------------- authorization
    console.log('\n--- Authorization ---\n');
    const noAuth = await callFunction(url, null, 'get-pm-briefing', {});
    check('no Authorization → 401', noAuth.status === 401, String(noAuth.status));
    const clientA = await signIn(url, anonKey, A.email, password);
    const asClient = await callFunction(url, clientA.token, 'get-pm-briefing', {});
    check('a real non-admin → 403', asClient.status === 403, String(asClient.status));
    const pmVisitsAsClient = await clientA.client.from('pm_visits').select('*');
    check('pm_visits is unreadable by a client (RLS, no policy)', !pmVisitsAsClient.error && pmVisitsAsClient.data.length === 0, JSON.stringify(pmVisitsAsClient.error || pmVisitsAsClient.data));
    const schedAsClient = await clientA.client.rpc('scheduler_health');
    check('scheduler_health() is not executable by a client', !!schedAsClient.error && /permission|denied|42501/i.test(schedAsClient.error.message + ' ' + schedAsClient.error.code), JSON.stringify(schedAsClient.error || 'ran'));
    const schedAsAnon = await createClient(url, anonKey, { auth: { persistSession: false } }).rpc('scheduler_health');
    check('...nor by anon', !!schedAsAnon.error, JSON.stringify(schedAsAnon.error || 'ran'));

    // ---------------------------------------------------------------- the visit record
    console.log('\n--- The visit record (since you last looked) ---\n');
    await admin.from('pm_visits').delete().eq('user_id', pm.userId);
    const r1 = await callFunction(url, pm.token, 'get-pm-briefing', {});
    check('the PM\'s first briefing reports firstBriefing with no lastLooked', r1.status === 200 && r1.body.visit.firstBriefing === true && r1.body.visit.lastLooked === null, JSON.stringify(r1.body && r1.body.visit));
    const r2 = await callFunction(url, pm.token, 'get-pm-briefing', {});
    check('a second read in the same session still has no previous session to compare against', r2.body.visit.firstBriefing === true && r2.body.visit.lastLooked === null, JSON.stringify(r2.body.visit));
    const { data: v2 } = await admin.from('pm_visits').select('*').eq('user_id', pm.userId).single();
    check('pm_visits carries the PM\'s id and email, last_seen_at moving with each read', v2.email === pmEmail && new Date(v2.last_seen_at) > new Date(v2.session_started_at) - 1, JSON.stringify(v2));
    // A 40-minute gap: the previous session ends at the backdated last read.
    const backdated = iso(now - 40 * 60000);
    await admin.from('pm_visits').update({ last_seen_at: backdated, session_started_at: iso(now - 50 * 60000) }).eq('user_id', pm.userId);
    const peek = await callFunction(url, pm.token, 'get-pm-briefing', { recordVisit: false });
    const { data: vPeek } = await admin.from('pm_visits').select('last_seen_at').eq('user_id', pm.userId).single();
    const same = (a, c) => new Date(a).getTime() === new Date(c).getTime();
    check('recordVisit:false reads without moving the clock', peek.status === 200 && same(vPeek.last_seen_at, backdated), vPeek.last_seen_at);
    const r3 = await callFunction(url, pm.token, 'get-pm-briefing', {});
    check('★ a read after a 30+ minute gap opens a new session; lastLooked is the previous session\'s last read', r3.status === 200 && r3.body.visit.firstBriefing === false && same(r3.body.visit.lastLooked, backdated), JSON.stringify(r3.body.visit));
    const r4 = await callFunction(url, pm.token, 'get-pm-briefing', {});
    check('...and a further read inside the new session keeps that same lastLooked (stable within a session)', same(r4.body.visit.lastLooked, backdated), JSON.stringify(r4.body.visit));
    const b = r4.body;

    // ---------------------------------------------------------------- 1. attention band
    console.log('\n--- 1. Attention band ---\n');
    const pendingAll = [];
    for (const [t, f] of [['deposit_requests', 'requested_at'], ['withdrawal_requests', 'requested_at'], ['allocation_requests', 'requested_at'], ['sell_requests', 'requested_at'], ['hys_deposit_requests', 'requested_at'], ['hys_withdrawal_requests', 'requested_at'], ['profile_change_requests', 'requested_at']]) {
      const { data } = await admin.from(t).select(f).eq('status', 'pending'); for (const r of data) pendingAll.push(r[f]);
    }
    const { data: pendApps } = await admin.from('clients').select('created_at').eq('status', 'pending_review'); for (const r of pendApps) pendingAll.push(r.created_at);
    const expectedOverdue = pendingAll.filter((at) => (now - new Date(at).getTime()) / H >= 24).length;
    check('waiting on you = every pending request + application, counted independently (' + pendingAll.length + ')', b.attention.waiting.count === pendingAll.length && b.approvals.length === pendingAll.length, b.attention.waiting.count + ' vs ' + pendingAll.length);
    check('overdue = those pending 24h+ (' + expectedOverdue + ', includes the seeded 3-day and 2-day ones)', b.attention.overdue.count === expectedOverdue && expectedOverdue >= 2, String(b.attention.overdue.count));
    const oldestExpected = Math.max.apply(null, pendingAll.map((at) => (now - new Date(at).getTime()) / H));
    check('the oldest age is the real oldest pending request (≈' + oldestExpected.toFixed(1) + 'h)', Math.abs(b.attention.overdue.oldestAgeHours - oldestExpected) < 0.1, String(b.attention.overdue.oldestAgeHours));
    const { data: unreadRows } = await admin.from('conversations').select('id, kind').eq('unread_by_pm', true).neq('status', 'archived');
    check('unread total = conversations with unread_by_pm outside archive (' + unreadRows.length + ')', b.attention.unread.total === unreadRows.length && b.attention.unread.chats + b.attention.unread.tickets + b.attention.unread.email === unreadRows.length, JSON.stringify(b.attention.unread));
    check('...the seeded ticket, chat and email each land in their own channel; the read email and the archived one do not count', b.attention.unread.tickets >= 1 && b.attention.unread.chats >= 1 && b.attention.unread.email >= 1);
    const { data: states } = await admin.from('account_state').select('client_id, unallocated_capital, allocated_capital, asset_returns');
    const { data: allClients } = await admin.from('clients').select('id');
    const known = new Set(allClients.map((c) => c.id));
    // Row 264: asset_returns is a reported tally, not a balance — a sale's proceeds are already
    // inside unallocated_capital, so summing it here would double-count every realised gain.
    const expectedAum = states.filter((s) => known.has(s.client_id)).reduce((s, r) => s + Number(r.unallocated_capital) + Number(r.allocated_capital), 0);
    check('AUM = Σ (unallocated + allocated) over real clients\' account_state, the tally excluded (' + expectedAum.toFixed(2) + ')', Math.abs(b.attention.aum.value - expectedAum) < 0.05, String(b.attention.aum.value));
    check('the month change is ABSENT with a reason while a client has no anchor this month (never a partial sum)', b.attention.aum.monthChange.change === null && /anchors exist for/i.test(b.attention.aum.monthChange.reason), JSON.stringify(b.attention.aum.monthChange));

    // ---------------------------------------------------------------- 2. needs you first
    console.log('\n--- 2. Needs you first ---\n');
    const ap = b.approvals;
    // ★ ORDERING IS THE PROPERTY, NOT "MY FIXTURE IS FIRST". This used to assert ap[0] IS the
    // 3-day withdrawal, which quietly assumed nothing older than 3 days existed anywhere on the
    // stack — true on a fresh stack, false the moment a seeded client's own pending request ages
    // past it. Gary's seeded allocation crossed that line four days after he was seeded and this
    // failed for a reason that was real data behaving correctly. Assert what is actually true:
    // the list is genuinely oldest-first, and this suite's own withdrawal is in it, correct.
    const ages = ap.map((a) => a.ageHours);
    check('approvals are ordered oldest first', ages.every((v, i) => i === 0 || ages[i - 1] >= v),
      JSON.stringify(ages.slice(0, 5)));
    const mine = ap.find((a) => a.type === 'withdrawal' && a.clientName === A.name && a.amount === 40000);
    check('...and the 3-day withdrawal is in it, hot, ahead of every younger request',
      !!mine && mine.hot === true && ap.indexOf(mine) <= ap.findIndex((a) => a.ageHours < mine.ageHours),
      JSON.stringify(mine));
    check('hot = older than 24h; the 5-hour crypto deposit is not hot and names its network and hash state', ap.some((a) => a.type === 'deposit' && a.hot === false && /BTC · Bitcoin · hash provided/.test(a.detail)), JSON.stringify(ap.filter((a) => a.type === 'deposit')));
    check('the pending application appears as an approval with its own href', ap.some((a) => a.type === 'application' && a.clientName === B.name && a.href === 'admin-approvals.html'));
    // Every approval now points at the ONE approval gate (register row 228) — the seven
    // per-type pages are deleted, so a per-type href would be a link to a 404.
    check('every approval links into the approval gate', ap.length > 0 && ap.every((a) => a.href === 'admin-approvals.html'),
      JSON.stringify([...new Set(ap.map((a) => a.href))]));

    // ---------------------------------------------------------------- 3. since you last looked
    console.log('\n--- 3. Since you last looked ---\n');
    const s = b.since;
    check('the ticket reply 12 minutes ago is listed, naming the client and the DISP id', s.items.some((i) => i.kind === 'reply' && i.title === A.name + ' replied on DISP-0001' && i.href === 'admin-inbox.html?c=' + t1), JSON.stringify(s.items));
    check('the general-thread message is listed once (one row per conversation)', s.items.filter((i) => i.href === 'admin-inbox.html?c=' + g1).length === 1);
    check('the 20-minute-old email is listed; the 3-day-old one is not (before the previous session ended)', s.items.some((i) => i.href === 'admin-inbox.html?c=' + e1) && !s.items.some((i) => i.href === 'admin-inbox.html?c=' + e2));
    check('the pocket that matured since is listed with its principal and interest', s.items.some((i) => i.kind === 'matured' && i.title === 'Savings pocket matured · ' + A.name && /52,400/.test(i.detail) && /2,227/.test(i.detail)));
    check('the new application (created after the previous session) is listed', s.items.some((i) => i.kind === 'application' && i.title === 'New application · ' + B.name));
    const { data: ySessions } = await admin.from('visitor_sessions').select('visitor_id, visit_number, journey').gte('started_at', new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate())).toISOString()).lt('started_at', new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate() + 1)).toISOString());
    const yVisitors = new Set(ySessions.map((r) => r.visitor_id)).size;
    check('yesterday\'s visitors = distinct visitors whose session started yesterday (' + yVisitors + ')', s.yesterday.visitors === yVisitors && yVisitors >= 1, JSON.stringify(s.yesterday));
    check('...and the one that reached /signup is counted', s.yesterday.reachedSignup >= 1);

    // ---------------------------------------------------------------- 4. coming up
    console.log('\n--- 4. Coming up ---\n');
    const cu = b.comingUp;
    const mat = cu.find((d) => d.kind === 'maturity' && d.amount === 10000);
    check('the pocket maturing in 4 days is listed, soon, with its amount', !!mat && mat.soon === true && /in 4 days/.test(mat.whenLabel), JSON.stringify(mat));
    check('the pocket that already matured is NOT in coming up', !cu.some((d) => d.kind === 'maturity' && d.amount === 52400));
    const navItem = cu.find((d) => d.kind === 'nav' && /Briefing Quarterly Fund/.test(d.title));
    check('★ the quarterly fund valued 100 days ago is OVERDUE against its stated frequency (92 days), by the real calendar gap', !!navItem && navItem.daysOverdue === Math.round((now - (Date.parse(lastValued + 'T00:00:00Z') + 92 * DAY)) / DAY) && /overdue/.test(navItem.title) && navItem.detail === 'Valued quarterly · last ' + lastValued, JSON.stringify(navItem));
    check('the appraised product with NO stated frequency is not listed as due (it cannot be told)', !cu.some((d) => d.kind === 'nav' && /Unstated/.test(d.title)) && b.look.navNoFrequency.some((p) => p.id === navNone));
    const uns = cu.find((d) => d.kind === 'unsigned' && /Advisory agreement/.test(d.detail));
    check('the unsigned document is listed at 10 days, soon; the signed one is not', !!uns && /^10 days unsigned$/.test(uns.whenLabel) && uns.soon === true && !cu.some((d) => d.kind === 'unsigned' && /Signed\.pdf/.test(d.detail)), JSON.stringify(uns));
    const snap = cu.find((d) => d.kind === 'snapshot');
    check('the monthly snapshot is listed as what it is (no statements are generated)', !snap || /no client statements are generated/.test(snap.detail));
    check('items are ordered by date', cu.every((d, i) => i === 0 || new Date(d.when) >= new Date(cu[i - 1].when)));

    // ---------------------------------------------------------------- 5. worth acting on
    console.log('\n--- 5. Worth acting on ---\n');
    const act = b.acting.items;
    const idleExpected = states.filter((r) => known.has(r.client_id)).reduce((s, r) => s + Number(r.unallocated_capital), 0);
    const idle = act.find((o) => o.kind === 'idle');
    const topIdle = states.filter((r) => known.has(r.client_id)).sort((x, z) => Number(z.unallocated_capital) - Number(x.unallocated_capital))[0];
    check('idle capital = Σ unallocated over real clients (' + Math.round(idleExpected) + ') and names the largest holder', !!idle && idle.title === '$' + Math.round(idleExpected).toLocaleString('en-US') + ' sitting unallocated' && idle.clientId === topIdle.client_id, JSON.stringify(idle));
    const conc = act.find((o) => o.kind === 'concentration' && o.clientId === A.id);
    const { data: hA } = await admin.from('holdings').select('units').eq('client_id', A.id).single();
    const { data: pNow } = await admin.from('products').select('unit_price').eq('id', P.id).single();
    const { data: stA } = await admin.from('account_state').select('*').eq('client_id', A.id).single();
    const shareA = (Number(hA.units) * Number(pNow.unit_price)) / (Number(stA.unallocated_capital) + Number(stA.allocated_capital) + Number(stA.asset_returns));
    check('★ concentration flags A: one holding = ' + Math.round(shareA * 100) + '% of TPV (≥ 40%, TPV ≥ $10k), naming the product', !!conc && conc.detail === Math.round(shareA * 100) + '% of portfolio in ' + P.name, JSON.stringify(conc));
    check('D ($1,200, one flexible pocket, no holdings) is not flagged for concentration', !act.some((o) => o.kind === 'concentration' && o.clientId === D.id));
    const alerts = act.find((o) => o.kind === 'alerts');
    const { data: firedRows } = await admin.from('price_alerts').select('id').eq('status', 'fired').gte('fired_at', iso(now - 7 * DAY));
    check('price alerts fired this week = the real count (' + firedRows.length + '), naming the client and symbol', !!alerts && alerts.title.indexOf(firedRows.length + ' price alert') === 0 && new RegExp(A.name.split(' ')[0] + ' on BRF').test(alerts.detail), JSON.stringify(alerts));
    const dormant = act.find((o) => o.kind === 'dormant' && o.clientId === C.id);
    check('★ C — holds $27,900, never signed in, no request, transaction or visit — is dormant, with the value held', !!dormant && /Never signed in/.test(dormant.detail) && /27,900/.test(dormant.detail), JSON.stringify(dormant));
    check('A (a deposit, requests, a live session) is NOT dormant; D (a 1-hour-old request) is not either', !act.some((o) => o.kind === 'dormant' && (o.clientId === A.id || o.clientId === D.id)));
    check('the thresholds are reported in the payload', b.acting.thresholds.concentrationShare === 0.4 && b.acting.thresholds.concentrationMinTpv === 10000 && b.acting.thresholds.dormantDays === 60 && b.acting.thresholds.overdueHours === 24);

    // ---------------------------------------------------------------- 6. on the site now
    console.log('\n--- 6. On the site now ---\n');
    const live = b.onSite.find((v) => v.id === s1.data.id);
    check('the live Munich session is listed: country code, page, duration, a 2nd visit', !!live && live.countryCode === 'DE' && live.path === '/services' && live.seconds >= 100 && live.kind === 'returning' && /Munich/.test(live.who), JSON.stringify(live));
    check('yesterday\'s ended session is not', !b.onSite.some((v) => v.id === s2.data.id));

    // ---------------------------------------------------------------- 7. the firm today
    console.log('\n--- 7. The firm today ---\n');
    const { data: cl } = await admin.from('clients').select('status');
    check('clients: active and pending counted from the real table', b.firm.clientsActive === cl.filter((c) => c.status === 'active').length && b.firm.clientsPending === cl.filter((c) => c.status === 'pending_review').length, JSON.stringify([b.firm.clientsActive, b.firm.clientsPending]));
    check('AUM in the panel equals the band', b.firm.aum === b.attention.aum.value);
    check('unallocated = the idle figure', Math.abs(b.firm.unallocated - idleExpected) < 0.05);
    const { data: pk } = await admin.from('hys_pockets').select('amount').in('status', ['active', 'matured']);
    const savingsExpected = pk.reduce((s, p) => s + Number(p.amount), 0);
    check('savings = Σ active/matured pockets (' + savingsExpected + ') — excluded from AUM', Math.abs(b.firm.savings - savingsExpected) < 0.05 && b.firm.savingsPockets === pk.length, String(b.firm.savings));
    const { data: rateRow } = await admin.from('advisory_fee_rate').select('rate').eq('id', true).maybeSingle();
    if (rateRow) {
      const allocated = states.filter((r) => known.has(r.client_id)).reduce((s, r) => s + Number(r.allocated_capital), 0);
      const feesExpected = Math.round(allocated * (Number(rateRow.rate) / 100) * (new Date().getUTCDate() / 365) * 100) / 100;
      check('fees this month = Σ allocated × rate × elapsed days / 365 (' + feesExpected + ')', Math.abs(b.firm.feesThisMonth - feesExpected) < 0.02 && b.firm.feeRate === Number(rateRow.rate), String(b.firm.feesThisMonth));
    } else {
      check('with no fee rate set, fees are absent with a reason', b.firm.feesThisMonth === null && !!b.firm.feesReason);
    }

    // ---------------------------------------------------------------- 8. needs a look
    console.log('\n--- 8. Needs a look ---\n');
    const { data: noLogo } = await admin.from('products').select('id').eq('pricing_model', 'market').is('logo_url', null);
    check('products without a logo = market products with logo_url null (' + noLogo.length + ')', b.look.productsWithoutLogo.length === noLogo.length, String(b.look.productsWithoutLogo.length));
    const { data: asgRows } = await admin.from('deposit_address_assignments').select('client_id').is('removed_at', null);
    const withAddr = new Set(asgRows.map((r) => r.client_id));
    const { data: activeClients } = await admin.from('clients').select('id').eq('status', 'active');
    const noAddrExpected = activeClients.filter((c) => !withAddr.has(c.id)).length;
    check('★ clients with no deposit address: A and C genuinely appear, D (assigned) does not, B (pending) is not counted (' + noAddrExpected + ')', b.look.clientsWithoutAddress.length === noAddrExpected && b.look.clientsWithoutAddress.some((c) => c.id === A.id) && b.look.clientsWithoutAddress.some((c) => c.id === C.id) && !b.look.clientsWithoutAddress.some((c) => c.id === D.id) && !b.look.clientsWithoutAddress.some((c) => c.id === B.id), JSON.stringify(b.look.clientsWithoutAddress.map((c) => c.name)));
    const { data: qf } = await admin.from('products').select('id').eq('price_status', 'quote_failed');
    check('quote-failed = the real count (' + qf.length + ')', b.look.quoteFailed.length === qf.length);

    // ---------------------------------------------------------------- 9. system health
    console.log('\n--- 9. System health ---\n');
    const hl = (k) => b.health.lines.find((l) => l.key === k);
    const { data: sched } = await admin.rpc('scheduler_health');
    const refreshJob = (sched.jobs || []).find((j) => j.jobname === 'marketswave-refresh-market-data');
    check('price refresh reports the real last cron run', !!hl('refresh') && (refreshJob && refreshJob.last_run ? /^Ran /.test(hl('refresh').value) : /Never run|Not scheduled/.test(hl('refresh').value)), JSON.stringify(hl('refresh')));
    const { data: stockRows } = await admin.from('market_data_cache').select('last_updated').eq('asset_type', 'stock');
    const oldestMin = Math.max.apply(null, stockRows.map((r) => (now - new Date(r.last_updated).getTime()) / 60000));
    check('oldest price = the real oldest stock cache row (' + Math.round(oldestMin) + ' min), amber/red past the rotation\'s allowance', Math.abs(parseInt(hl('oldest').value, 10) - Math.round(oldestMin)) <= 2 && (oldestMin > b.health.raw.worstCaseStalenessMinutes ? hl('oldest').state !== 'ok' : hl('oldest').state === 'ok'), JSON.stringify(hl('oldest')));
    check('quote failures line = ' + qf.length + ' of the market products', hl('quotes').value.indexOf(qf.length + ' of ') === 0);
    check('provider budget names the rotation share (30 of 60 per min) and the cycle count', /^30 of 60 per min · \d+ cycles$/.test(hl('budget').value), hl('budget').value);
    check('alert sweep reports the real last run', !!hl('sweep') && /Ran |Never run|Not scheduled/.test(hl('sweep').value));
    const { count: failedCount } = await admin.from('email_log').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('sent_at', iso(now - 7 * DAY));
    const { count: bouncedCount } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('delivery_status', 'bounced').gte('sent_at', iso(now - 7 * DAY));
    check('email = real 7-day send failures (' + failedCount + ', ±3: other suites write this log while this one runs) and bounces (' + bouncedCount + '), amber when any', (failedCount + bouncedCount) ? Math.abs(parseInt(hl('email').value, 10) - failedCount) <= 3 && new RegExp(' · ' + bouncedCount + ' bounced$').test(hl('email').value) && hl('email').state === 'warn' : /No failures reported/.test(hl('email').value), JSON.stringify(hl('email')));
    check('last backup is honestly "Not configured" (amber), never a fabricated time', hl('backup').value === 'Not configured' && hl('backup').state === 'warn');
    check('the health lines are the eight named ones', b.health.lines.map((l) => l.key).join(',') === 'refresh,oldest,quotes,budget,sweep,email,snapshot,backup', b.health.lines.map((l) => l.key).join(','));
  } finally {
    console.log('\n(cleanup)');
    if (pmVisitBefore) await admin.from('pm_visits').upsert(pmVisitBefore); else await admin.from('pm_visits').delete().eq('user_id', pm.userId);
    if (sessionIds.length) await admin.from('visitor_sessions').delete().in('id', sessionIds);
    if (visitorRowId) await admin.from('visitors').delete().eq('id', visitorRowId);
    if (convoIds.length) await admin.from('conversations').delete().in('id', convoIds);
    if (productIds.length) { await admin.from('product_documents').delete().in('product_id', productIds); await admin.from('products').delete().in('id', productIds); }
    for (const uid of users) {
      await admin.from('conversations').delete().eq('client_id', uid);
      await admin.from('deposit_address_assignments').delete().eq('client_id', uid);
      await admin.from('clients').delete().eq('id', uid);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.log('  cleanup: could not delete ' + uid + ': ' + error.message);
    }
    if (addressId) await admin.from('deposit_addresses').delete().eq('id', addressId);
  }

  console.log('\n' + passed + '/' + (passed + failed) + ' assertions passed.');
  console.log('\nVERIFY: ' + (failed ? 'FAIL' : 'PASS'));
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('VERIFY: FAIL — ' + (e.stack || e.message)); process.exitCode = 1; });
