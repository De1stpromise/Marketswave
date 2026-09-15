/* admin-approvals-page.js — the approval gate (PM tool revamp, part 3, 2026-09-15).
 *
 * One pending queue for all seven request types, one history, seven panel shapes. Replaces the
 * interim landing and the seven separate queue pages.
 *
 * ── WHY THE PANEL IS NOT GENERIC ──────────────────────────────────────────────────────────
 * The QUEUE unifies *seeing*: one list, oldest first, so "what needs me" has a single answer.
 * The PANEL is shaped by the type so *doing* stays correct. A generic "approve this" panel
 * would drop the fields a PM actually decides on — the sharing count on a deposit address, the
 * price drift on an allocation, the forfeiture on an early HYS withdrawal.
 *
 * ── THE TYPE TABLE IS THE EXTENSION POINT ────────────────────────────────────────────────
 * Everything that differs between types lives in one entry in TYPES: where the rows come from,
 * how a row summarises itself, which panel it opens, which functions resolve it. An eighth
 * type is one entry, not a new page.
 *
 * ── RE-VALIDATION ────────────────────────────────────────────────────────────────────────
 * Every money-moving approve re-reads the CURRENT state server-side and refuses with a real
 * 409 rather than trusting the request (allocation: unallocated; withdrawal: unallocated vs
 * the PM-entered amount; sell: held units; HYS internal transfer: unallocated; HYS withdrawal:
 * the pocket still exists and is not already withdrawn). credit-deposit is the one exception
 * and correctly so — crediting a deposit is money ARRIVING, so there is no balance to exceed;
 * it guards against double-crediting only. The panel says which check ran, so a PM can see the
 * difference rather than assume it.
 *
 * ── ATTRIBUTION ──────────────────────────────────────────────────────────────────────────
 * resolved_by / resolved_by_email keep being written by every Edge Function and are NEVER
 * rendered while there is one manager — not in a row, not in a title, not in a visually-hidden
 * span. A hidden field is still a displayed field to someone using a screen reader, and this
 * would be the only place in the product where a PM's email surfaces. It returns with multi-PM.
 */
(function () {
  'use strict';

  var D = window.MarketswaveData;
  var OVERDUE_MS = 24 * 60 * 60 * 1000;

  var ICON = {
    app:  '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    dep:  '<path d="M12 5v14M5 12l7 7 7-7"/>',
    wd:   '<path d="M12 19V5M5 12l7-7 7 7"/>',
    alo:  '<path d="M3 3v18h18"/><path d="M18.7 8 12 14.7l-3.5-3.5L3 16.4"/>',
    sell: '<path d="M3 21V3h18"/><path d="M18.7 16 12 9.3l-3.5 3.5L3 7.6"/>',
    hys:  '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    prof: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
  };
  var STROKE = { app: '#5B21B6', dep: '#15803D', wd: '#B4402C', alo: '#334155', sell: '#92400E', hys: '#9A3412', prof: '#075985' };
  var CHIP = { app: 'Application', dep: 'Deposit', wd: 'Withdrawal', alo: 'Allocation', sell: 'Sell', hys: 'HYS', prof: 'Profile update' };
  var LABEL = { app: 'Applications', dep: 'Deposits', wd: 'Withdrawals', alo: 'Allocations', sell: 'Sells', hys: 'HYS', prof: 'Profile updates' };
  var ORDER = ['app', 'dep', 'wd', 'alo', 'sell', 'hys', 'prof'];

  var state = {
    view: 'pending', filter: 'all', hfilter: 'all', q: '', hq: '',
    sortKey: 'when', sortDir: 'desc',
    pending: [], history: [], sel: null, busy: false, ready: false
  };

  /* ── helpers ──────────────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function initials(name) {
    if (typeof window.getClientInitials === 'function') return window.getClientInitials(name || '');
    return String(name || '?').trim().slice(0, 2).toUpperCase();
  }
  function usd(n) {
    if (n == null) return '—';
    if (typeof window.formatUSD === 'function') return window.formatUSD(n);
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function icon(tone, size) {
    return '<svg width="' + (size || 15) + '" height="' + (size || 15) + '" viewBox="0 0 24 24" fill="none" stroke="' +
      STROKE[tone] + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[tone] + '</svg>';
  }
  function ageOf(ms) {
    var h = ms / 36e5;
    if (h < 1) return { t: Math.max(1, Math.round(ms / 6e4)) + 'm', hot: false };
    if (h < 24) return { t: Math.round(h) + 'h', hot: false };
    var d = Math.floor(h / 24);
    return { t: d + (d === 1 ? ' day' : ' days'), hot: true };
  }
  function hhmm(iso) { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function dmon(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function whenFull(iso) { return dmon(iso) + ', ' + hhmm(iso); }
  function shorten(s, head, tail) {
    s = String(s || '');
    if (s.length <= head + tail + 1) return s;
    return s.slice(0, head) + '…' + s.slice(-tail);
  }
  /* Renders an opaque details object as humanised label:value pairs. Kept GENERIC on purpose:
   * a withdrawal's destination is crypto address+network OR bank fields, and hardcoding one
   * shape breaks the moment the other appears. Carried over from admin-withdrawals.html. */
  function humanizeKey(k) {
    return String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function detailRows(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return Object.keys(obj).filter(function (k) { return obj[k] !== null && obj[k] !== ''; })
      .map(function (k) {
        var v = String(obj[k]);
        return kv(humanizeKey(k), esc(v), v.length > 22 ? 'is-mono' : '');
      }).join('');
  }
  function kv(k, vHtml, cls) {
    return '<div class="ag-kv"><span class="ag-k">' + esc(k) + '</span><span class="ag-v ' + (cls || '') + '">' + vHtml + '</span></div>';
  }

  /* ── loading ──────────────────────────────────────────────────────────────────────── */
  var cache = null;
  function load(force) {
    if (cache && !force) return cache;
    cache = (async function () {
      D.useAdminClient();
      var rows = await Promise.all([
        D.selectTable('clients'),
        D.selectTable('deposit_requests'),
        D.selectTable('withdrawal_requests'),
        D.selectTable('allocation_requests'),
        D.selectTable('sell_requests'),
        D.selectTable('hys_deposit_requests'),
        D.selectTable('hys_withdrawal_requests'),
        D.selectTable('profile_change_requests'),
        D.selectTable('products'),
        D.selectTable('account_state'),
        D.selectTable('holdings'),
        D.selectTable('deposit_addresses'),
        D.selectTable('deposit_address_assignments'),
        D.selectTable('hys_pockets'),
        D.selectTable('client_profiles')
      ]);
      return {
        clients: rows[0], dep: rows[1], wd: rows[2], alo: rows[3], sell: rows[4],
        hysDep: rows[5], hysWd: rows[6], prof: rows[7], products: rows[8],
        state: rows[9], holdings: rows[10], addresses: rows[11], assignments: rows[12],
        pockets: rows[13], profiles: rows[14]
      };
    })();
    return cache;
  }

  /* ── normalising: every type becomes the same row shape ───────────────────────────── */
  function build(d) {
    var byId = {};
    d.clients.forEach(function (c) { byId[c.id] = c; });
    var prod = {};
    d.products.forEach(function (p) { prod[p.id] = p; });
    var st = {};
    d.state.forEach(function (s) { st[s.client_id] = s; });
    var pocket = {};
    d.pockets.forEach(function (p) { pocket[p.id] = p; });
    var addr = {};
    d.addresses.forEach(function (a) { addr[a.id] = a; });
    // How many clients an address currently serves — a PM crediting a shared address needs it.
    var shareCount = {};
    d.assignments.filter(function (a) { return !a.removed_at; })
      .forEach(function (a) { shareCount[a.address_id] = (shareCount[a.address_id] || 0) + 1; });
    var held = {};
    d.holdings.forEach(function (h) { held[h.client_id + '|' + h.product_id] = h; });

    function who(clientId) {
      var c = byId[clientId];
      return { id: clientId, name: c ? c.name : 'Unknown client', email: c ? c.email : null };
    }
    function unalloc(clientId) { return st[clientId] ? Number(st[clientId].unallocated_capital) : 0; }

    var out = [];

    // 1. CLIENT APPLICATIONS. The Client Registry IS the queue — there is no separate table,
    //    so a pending application is a clients row at status 'pending_review'.
    d.clients.filter(function (c) { return c.status === 'pending_review'; }).forEach(function (c) {
      out.push({
        kind: 'app', id: c.id, clientId: c.id, ref: 'APP-' + String(c.id).slice(0, 8),
        at: c.created_at, client: who(c.id),
        title: 'New client · ' + (c.account_type || 'Individual Account').replace(' Account', ''),
        sub: 'Applied ' + dmon(c.created_at),
        context: c.email || '',
        amount: null, amountSub: 'no money yet', raw: c
      });
    });

    // 2. DEPOSITS. A crypto deposit has NO requested amount by design — the PM enters what
    //    actually landed. A bank deposit states one to confirm.
    d.dep.filter(function (r) { return r.status === 'pending'; }).forEach(function (r) {
      var a = r.deposit_address_id ? addr[r.deposit_address_id] : null;
      out.push({
        kind: 'dep', id: r.id, clientId: r.client_id, ref: 'DEP-' + String(r.id).slice(0, 8),
        at: r.requested_at, client: who(r.client_id),
        title: r.method === 'crypto' ? ('Crypto · ' + (r.currency || '')) : 'Bank transfer',
        sub: r.method === 'crypto'
          ? (r.tx_hash ? 'Hash ' + shorten(r.tx_hash, 6, 4) + ' provided' : 'No hash provided')
          : ((r.currency || 'USD') + ' transfer'),
        context: 'Client since ' + dmon((byId[r.client_id] || {}).created_at || r.requested_at),
        amount: r.requested_amount, amountSub: r.requested_amount == null ? 'PM sets amount' : 'stated',
        address: a, shared: a ? (shareCount[a.id] || 0) : 0, raw: r
      });
    });

    // 3. WITHDRAWALS. Context is the AVAILABLE BALANCE, because that is what decides it.
    d.wd.filter(function (r) { return r.status === 'pending'; }).forEach(function (r) {
      var avail = unalloc(r.client_id);
      out.push({
        kind: 'wd', id: r.id, clientId: r.client_id, ref: 'WDR-' + String(r.id).slice(0, 8),
        at: r.requested_at, client: who(r.client_id),
        title: r.method === 'crypto' ? 'Crypto transfer' : 'Bank transfer',
        sub: firstDetail(r.destination_details),
        context: usd(avail) + ' available',
        amount: r.requested_amount, amountSub: 'leaves ' + usd(avail - Number(r.requested_amount)),
        available: avail, raw: r
      });
    });

    // 4. ALLOCATIONS. Context is unallocated capital; the amount line says what it leaves.
    d.alo.filter(function (r) { return r.status === 'pending'; }).forEach(function (r) {
      var p = prod[r.product_id];
      var avail = unalloc(r.client_id);
      var price = p ? Number(p.unit_price) : 0;
      out.push({
        kind: 'alo', id: r.id, clientId: r.client_id, ref: 'ALC-' + String(r.id).slice(0, 8),
        at: r.requested_at, client: who(r.client_id),
        title: p ? p.name : 'Unknown product',
        sub: price ? ('≈' + (Number(r.requested_amount) / price).toFixed(5) + ' units at ' + usd(price)) : 'No live price',
        context: usd(avail) + ' unallocated',
        amount: r.requested_amount, amountSub: 'leaves ' + usd(avail - Number(r.requested_amount)),
        product: p, available: avail, raw: r
      });
    });

    // 5. SELLS. Context is the POSITION SIZE. The estimate uses the live price and is marked
    //    approximate: the executed figure can differ if time passes or the holding shrinks.
    d.sell.filter(function (r) { return r.status === 'pending'; }).forEach(function (r) {
      var p = prod[r.product_id];
      var h = held[r.client_id + '|' + r.product_id];
      var units = h ? Number(h.units) : 0;
      var price = p ? Number(p.unit_price) : 0;
      out.push({
        kind: 'sell', id: r.id, clientId: r.client_id, ref: 'SLL-' + String(r.id).slice(0, 8),
        at: r.requested_at, client: who(r.client_id),
        title: p ? p.name : 'Unknown product',
        sub: Number(r.units_to_sell).toFixed(2) + ' of ' + units.toFixed(2) + ' units · ' +
             (Math.abs(units - Number(r.units_to_sell)) < 1e-9 ? 'full close' : 'partial'),
        context: usd(units * price) + ' position',
        amount: price ? units2value(r.units_to_sell, price) : null,
        amountSub: price ? ('at ' + usd(price)) : 'no live price',
        approx: true, product: p, holdingUnits: units, raw: r
      });
    });

    // 6. HYS DEPOSITS + WITHDRAWALS share one filter pill: to a PM both are "the savings
    //    queue", and splitting them would make two pills that are each almost always empty.
    d.hysDep.filter(function (r) { return r.status === 'pending'; }).forEach(function (r) {
      var internal = r.method === 'internal';
      var avail = unalloc(r.client_id);
      out.push({
        kind: 'hys', sub_kind: 'deposit', id: r.id, clientId: r.client_id, ref: 'HYS-' + String(r.id).slice(0, 8),
        at: r.requested_at, client: who(r.client_id),
        title: (r.term_label || r.pocket_type) + ' pocket',
        sub: internal ? 'Internal transfer from unallocated' : ('External · ' + (r.method || '')),
        context: internal ? (usd(avail) + ' unallocated') : ((byId[r.client_id] || {}).email || ''),
        amount: r.requested_amount,
        // hys_deposit_requests.rate is stored as a PERCENT, not a fraction: getHysRate()
        // returns 12 for a 12-month pocket and credit-hys-deposit computes
        // amount * (rate/100) * years. Multiplying by 100 here rendered a real 12%
        // pocket as 1200.0%. high-yield-savings.html and the retired admin-hys.html
        // both render it bare, and this now matches them.
        amountSub: (r.rate ? Number(r.rate).toFixed(1) + '%' : 'no fixed rate'),
        internal: internal, available: avail, raw: r
      });
    });
    d.hysWd.filter(function (r) { return r.status === 'pending'; }).forEach(function (r) {
      var pk = pocket[r.pocket_id];
      out.push({
        kind: 'hys', sub_kind: 'withdrawal', id: r.id, clientId: r.client_id, ref: 'HYW-' + String(r.id).slice(0, 8),
        at: r.requested_at, client: who(r.client_id),
        title: 'Withdraw ' + (r.term_label || r.pocket_type) + ' pocket',
        sub: r.forfeit ? 'Early — interest forfeited' : 'At or after maturity',
        context: pk ? (usd(pk.amount) + ' pocket') : 'pocket missing',
        amount: r.receive_amount, amountSub: r.forfeit ? 'after forfeiture' : 'incl. interest',
        pocket: pk, raw: r
      });
    });

    // 7. PROFILE UPDATES.
    d.prof.filter(function (r) { return r.status === 'pending'; }).forEach(function (r) {
      out.push({
        kind: 'prof', id: r.id, clientId: r.client_id, ref: 'PRF-' + String(r.id).slice(0, 8),
        at: r.requested_at, client: who(r.client_id),
        title: fieldLabel(r.field) + ' change',
        sub: fmtField(r.field, r.current_value) + ' → ' + fmtField(r.field, r.requested_value),
        context: (byId[r.client_id] || {}).email || '',
        amount: null, amountSub: 'no money', raw: r
      });
    });

    out.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });   // OLDEST FIRST
    return out;
  }

  function units2value(units, price) { return Number(units) * price; }
  function firstDetail(obj) {
    if (!obj || typeof obj !== 'object') return '';
    var k = Object.keys(obj).filter(function (x) { return obj[x]; });
    if (!k.length) return '';
    return k.slice(0, 2).map(function (x) { return String(obj[x]); }).join(' · ');
  }
  function fieldLabel(f) {
    return ({ legalName: 'Legal name', address: 'Address', idDocument: 'ID document', dateOfBirth: 'Date of birth' })[f] || humanizeKey(f);
  }
  /* Reuses format-helpers.js's shared formatter so the PM sees a requested value in the exact
   * field-specific shape the client themselves saw (register row 65). */
  function fmtField(field, value) {
    if (typeof window.formatFieldDisplay === 'function') {
      try { return String(window.formatFieldDisplay(field, value)).replace(/<[^>]*>/g, ''); } catch (e) { /* fall through */ }
    }
    if (value == null || value === '') return '—';
    if (typeof value === 'object') return Object.keys(value).map(function (k) { return value[k]; }).filter(Boolean).join(', ');
    return String(value);
  }


  /* ── queue rendering ──────────────────────────────────────────────────────────────── */
  function matches(it, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return (it.client.name || '').toLowerCase().indexOf(q) !== -1 ||
           (it.ref || '').toLowerCase().indexOf(q) !== -1 ||
           (it.title || '').toLowerCase().indexOf(q) !== -1;
  }
  function visible() {
    return state.pending.filter(function (it) {
      return (state.filter === 'all' || it.kind === state.filter) && matches(it, state.q);
    });
  }

  function rowHTML(it) {
    var now = Date.now();
    var ms = now - new Date(it.at).getTime();
    var a = ageOf(ms);
    var urgent = ms >= OVERDUE_MS;
    var amt = it.amount == null ? '—' : ((it.approx ? '≈' : '') + usd(it.amount));
    return '<button type="button" class="ag-row' + (urgent ? ' is-urgent' : '') + (state.sel === it.kind + ':' + it.id ? ' is-sel' : '') +
      '" data-kind="' + esc(it.kind) + '" data-id="' + esc(it.id) + '">' +
      '<span class="ag-ti ag-t-' + it.kind + '">' + icon(it.kind) + '</span>' +
      '<span class="ag-what"><b><span class="ag-kind ag-k-' + it.kind + '">' + esc(CHIP[it.kind]) + '</span>' + esc(it.title) + '</b>' +
        '<span>' + esc(it.sub) + (it.sub ? ' · ' : '') + esc(it.ref) + '</span></span>' +
      '<span class="ag-who"><span class="ag-av">' + esc(initials(it.client.name)) + '</span>' +
        '<span class="ag-nm"><b>' + esc(it.client.name) + '</b><span>' + esc(it.context) + '</span></span></span>' +
      '<span class="ag-amt"><b>' + amt + '</b><span>' + esc(it.amountSub) + '</span></span>' +
      '<span class="ag-age' + (a.hot ? ' is-hot' : '') + '"><b>' + a.t + '</b>' + (urgent ? dmon(it.at) : hhmm(it.at)) + '</span>' +
      '<span class="ag-chev"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></span>' +
      '</button>';
  }

  function renderQueue() {
    var list = visible();
    var now = Date.now();
    var over = list.filter(function (i) { return now - new Date(i.at).getTime() >= OVERDUE_MS; });
    var rest = list.filter(function (i) { return now - new Date(i.at).getTime() < OVERDUE_MS; });
    var el = document.getElementById('ag-queue');
    if (!list.length) {
      el.innerHTML = '<div class="ag-empty"><b>Nothing waiting.</b><span>' +
        (state.q || state.filter !== 'all' ? 'No pending request matches this filter.' : 'Every request has been decided.') +
        '</span></div>';
      return;
    }
    var html = '';
    if (over.length) html += '<div class="ag-grp is-urgent">Waiting more than a day</div>' + over.map(rowHTML).join('');
    if (rest.length) html += '<div class="ag-grp">Today</div>' + rest.map(rowHTML).join('');
    el.innerHTML = html;
  }

  function renderFilters() {
    var counts = { all: state.pending.length };
    ORDER.forEach(function (k) { counts[k] = state.pending.filter(function (i) { return i.kind === k; }).length; });
    var pills = [{ k: 'all', l: 'All' }].concat(ORDER.map(function (k) { return { k: k, l: LABEL[k] }; }));
    document.getElementById('ag-filters').innerHTML =
      pills.map(function (p) {
        return '<button type="button" class="ag-fp' + (state.filter === p.k ? ' is-on' : '') + '" data-f="' + p.k + '">' +
          esc(p.l) + ' <span class="ag-n">' + counts[p.k] + '</span></button>';
      }).join('') +
      '<span class="ag-srch"><span class="ag-ic"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>' +
      '<input id="ag-q" type="search" placeholder="Search client or reference" aria-label="Search pending requests" value="' + esc(state.q) + '" /></span>';
    document.getElementById('ag-pending-count').textContent = state.pending.length;

    var oldest = state.pending[0];
    var badge = document.getElementById('ag-oldest');
    if (oldest && Date.now() - new Date(oldest.at).getTime() >= OVERDUE_MS) {
      document.getElementById('ag-oldest-text').textContent = 'Oldest waiting ' + ageOf(Date.now() - new Date(oldest.at).getTime()).t;
      badge.hidden = false;
    } else { badge.hidden = true; }
  }

  /* ── the seven panel shapes ───────────────────────────────────────────────────────── */
  function panelBody(it) {
    var b = '';
    if (it.kind === 'app') {
      var c = it.raw;
      var p = (state.data.profiles || []).filter(function (x) { return x.client_id === c.id; })[0];
      b += kv('Account type', esc(c.account_type || 'Individual Account'));
      b += kv('Email', esc(c.email || '—'));
      b += kv('Applied', esc(whenFull(c.created_at)));
      b += kv('Legal name', esc(p && p.legal_name ? [p.legal_name.firstName, p.legal_name.lastName].filter(Boolean).join(' ') : '—'));
      b += kv('Address', esc(p && p.address ? [p.address.city, p.address.country].filter(Boolean).join(', ') : '—'));
      b += kv('ID document', esc(p && p.id_document ? (p.id_document.documentType || 'Provided') : '—'));
      // ★ The onboarding record (tax residence, risk profile, source of funds, experience,
      // horizon) has NO server-side column anywhere — it lives in per-device localStorage.
      // Register row 224. Saying so is better than an empty row a PM reads as "none given".
      b += '<div class="ag-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>Tax residence, risk profile and source of funds are collected at signup but have no server-side storage yet (register row 224), so they cannot be shown here.</p></div>';
      b += '<div class="ag-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        '<p>Viewing an identity document is access-logged permanently.</p></div>';
    } else if (it.kind === 'dep') {
      var r = it.raw;
      b += kv('Method', esc(r.method === 'crypto' ? 'Crypto' : 'Bank transfer'));
      b += kv('Currency', esc((r.currency || '—') + (r.network ? ' · ' + r.network : '')));
      if (it.address) {
        b += kv('Sent to', esc(it.address.address), 'is-mono');
        // ★ How many clients share this address. A PM crediting a shared address must confirm
        // the hash belongs to THIS client. Carried from admin-deposits.html.
        b += kv('Shared with', it.shared + (it.shared === 1 ? ' client' : ' clients'));
        if (it.address.status === 'retired') {
          b += '<div class="ag-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg><p>This address has since been retired.</p></div>';
        }
      }
      if (r.tx_hash) {
        b += kv('Hash', esc(r.tx_hash), 'is-mono');
        b += '<a class="ag-link" href="https://www.blockchain.com/explorer/search?search=' + encodeURIComponent(r.tx_hash) + '" target="_blank" rel="noopener noreferrer">Open in block explorer <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a>';
      }
      b += detailRows(r.details);
      b += '<div class="ag-fld"><label for="ag-amount">Amount received (USD)</label>' +
           '<input id="ag-amount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00" value="' +
           (r.requested_amount == null ? '' : esc(r.requested_amount)) + '" /></div>';
      if (it.shared > 1) {
        b += '<div class="ag-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
          '<p>This address serves ' + it.shared + ' clients — confirm the hash belongs to ' + esc(it.client.name) + ' before crediting.</p></div>';
      }
      b += '<div class="ag-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>Crediting adds money, so there is no balance to re-validate against — only a guard against crediting twice.</p></div>';
    } else if (it.kind === 'wd') {
      var w = it.raw;
      b += kv('Requested', usd(w.requested_amount));
      b += kv('Available now', usd(it.available));
      b += kv('Leaves', usd(it.available - Number(w.requested_amount)));
      b += detailRows(w.destination_details);
      b += '<div class="ag-fld"><label for="ag-amount">Approved amount (USD)</label>' +
           '<input id="ag-amount" type="number" step="0.01" min="0" inputmode="decimal" value="' + esc(w.requested_amount) + '" /></div>';
      b += revalNote('Available balance is re-read at approval and the request is refused if it no longer covers the amount.');
    } else if (it.kind === 'alo') {
      var al = it.raw, pr = it.product;
      var live = pr ? Number(pr.unit_price) : 0;
      b += kv('Product', esc(pr ? pr.name : 'Unknown'));
      b += kv('Amount requested', usd(al.requested_amount));
      b += kv('Price now', live ? ('<span class="ag-up">' + usd(live) + '</span>') : '—');
      b += kv('Units at approval', live ? (Number(al.requested_amount) / live).toFixed(5) : '—');
      b += kv('Unallocated now', usd(it.available));
      b += kv('Unallocated after', usd(it.available - Number(al.requested_amount)));
      b += revalNote('Balance is re-read at approval, and units are calculated at the price on approval — not the price at request.');
    } else if (it.kind === 'sell') {
      var s = it.raw, sp = it.product;
      var lp = sp ? Number(sp.unit_price) : 0;
      b += kv('Product', esc(sp ? sp.name : 'Unknown'));
      b += kv('Units to sell', Number(s.units_to_sell).toFixed(8));
      b += kv('Units held now', Number(it.holdingUnits).toFixed(8));
      b += kv('Price now', lp ? usd(lp) : '—');
      b += kv('Estimated proceeds', lp ? ('≈' + usd(Number(s.units_to_sell) * lp)) : '—');
      b += revalNote('Held units are re-read at approval. The executed price and proceeds can differ from this estimate if the price moves.');
    } else if (it.kind === 'hys' && it.sub_kind === 'deposit') {
      var hd = it.raw;
      b += kv('Pocket', esc(hd.term_label || hd.pocket_type));
      b += kv('Rate', hd.rate ? Number(hd.rate).toFixed(1) + '%' : 'No fixed rate');   // a percent already — see the queue row's own note
      b += kv('Funding', esc(it.internal ? 'Internal transfer from unallocated' : 'External · ' + (hd.method || '')));
      if (it.internal) {
        b += kv('Unallocated now', usd(it.available));
        b += kv('Unallocated after', usd(it.available - Number(hd.requested_amount)));
      }
      b += detailRows(hd.details);
      b += '<div class="ag-fld"><label for="ag-amount">Confirmed amount (USD)</label>' +
           '<input id="ag-amount" type="number" step="0.01" min="0" inputmode="decimal" value="' + esc(hd.requested_amount) + '"' +
           (it.internal ? ' readonly' : '') + ' /></div>';
      b += revalNote(it.internal
        ? 'An internal transfer must match the requested amount exactly and is re-validated against unallocated capital at approval.'
        : 'Externally funded, so the confirmed amount may differ from what was requested. High Yield Savings is its own pool and does not touch unallocated capital.');
    } else if (it.kind === 'hys') {
      var hw = it.raw;
      b += kv('Pocket', esc(hw.term_label || hw.pocket_type));
      b += kv('Receives', usd(hw.receive_amount));
      b += kv('Interest forfeited', hw.forfeit ? '<span class="ag-dn">Yes — withdrawn early</span>' : 'No');
      b += kv('Method', esc(hw.method === 'crypto' ? 'Crypto wallet' : 'Bank account'));
      b += detailRows(hw.destination_details);
      b += revalNote('The pocket is re-read at approval and refused if it has already been withdrawn. This does not affect unallocated capital — savings is paid out externally.');
    } else if (it.kind === 'prof') {
      var pc = it.raw;
      b += kv('Field', esc(fieldLabel(pc.field)));
      b += kv('Current', esc(fmtField(pc.field, pc.current_value)));
      b += kv('Requested', esc(fmtField(pc.field, pc.requested_value)));
      if (pc.reason) b += kv('Client’s reason', esc(pc.reason));
      b += revalNote('The current value was snapshotted server-side from the real profile at request time, never supplied by the client.');
    }
    b += '<div class="ag-fld" id="ag-reason-wrap" hidden><label for="ag-reason">Reason for rejecting</label>' +
         '<textarea id="ag-reason" placeholder="Why is this being rejected?"></textarea></div>';
    b += '<div class="ag-err" id="ag-err" role="alert"></div>';
    return b;
  }
  function revalNote(text) {
    return '<div class="ag-warn is-ok"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><p>' + esc(text) + '</p></div>';
  }
  var GO = { app: 'Approve client', dep: 'Credit', wd: 'Approve', alo: 'Approve', sell: 'Approve', hys: 'Approve', prof: 'Approve' };

  function openPanel(it) {
    state.sel = it.kind + ':' + it.id;
    var goLabel = it.kind === 'hys' && it.sub_kind === 'deposit' ? 'Credit' : GO[it.kind];
    document.getElementById('ag-pane').innerHTML =
      '<div class="ag-ph"><span class="ag-ti ag-t-' + it.kind + '">' + icon(it.kind) + '</span>' +
        '<span class="ag-tx"><b id="ag-pane-title">' + esc(CHIP[it.kind]) + ' · ' + esc(it.title) + '</b>' +
        '<span>' + esc(it.client.name) + ' · ' + esc(it.ref) + '</span></span>' +
        '<button type="button" class="ag-x" id="ag-close" aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '<div class="ag-pb">' + panelBody(it) + '</div>' +
      '<div class="ag-pf"><button type="button" class="mw-btn mw-btn-danger" id="ag-reject">Reject</button>' +
        '<button type="button" class="mw-btn mw-btn-approve" id="ag-approve" style="flex:1">' + esc(goLabel) + '</button></div>';
    document.getElementById('ag-scrim').hidden = false;
    renderQueue();
    var f = document.getElementById('ag-amount') || document.getElementById('ag-approve');
    if (f) f.focus();
  }
  function closePanel() {
    document.getElementById('ag-scrim').hidden = true;
    document.getElementById('ag-pane').innerHTML = '';
    state.sel = null;
    renderQueue();
  }

  /* ── resolving ────────────────────────────────────────────────────────────────────── */
  function fnFor(it, approve) {
    if (it.kind === 'app') return approve ? ['approve-client-application', { clientId: it.clientId }] : ['reject-client-application', { clientId: it.clientId, reason: reasonVal() }];
    if (it.kind === 'dep') return approve ? ['credit-deposit', { requestId: it.id, confirmedAmount: amountVal() }] : ['reject-deposit', { requestId: it.id, reason: reasonVal() }];
    if (it.kind === 'wd') return approve ? ['approve-withdrawal', { requestId: it.id, approvedAmount: amountVal() }] : ['reject-withdrawal', { requestId: it.id, reason: reasonVal() }];
    if (it.kind === 'alo') return approve ? ['approve-allocation', { requestId: it.id }] : ['reject-allocation', { requestId: it.id, reason: reasonVal() }];
    if (it.kind === 'sell') return approve ? ['approve-sell', { requestId: it.id }] : ['reject-sell', { requestId: it.id, reason: reasonVal() }];
    if (it.kind === 'hys' && it.sub_kind === 'deposit') return approve ? ['credit-hys-deposit', { requestId: it.id, confirmedAmount: amountVal() }] : ['reject-hys-deposit', { requestId: it.id, reason: reasonVal() }];
    if (it.kind === 'hys') return approve ? ['approve-hys-withdrawal', { requestId: it.id }] : ['reject-hys-withdrawal', { requestId: it.id, reason: reasonVal() }];
    return approve ? ['approve-profile-change', { requestId: it.id }] : ['reject-profile-change', { requestId: it.id, resolutionNote: reasonVal() }];
  }
  function amountVal() {
    var el = document.getElementById('ag-amount');
    return el ? Number(el.value) : undefined;
  }
  function reasonVal() {
    var el = document.getElementById('ag-reason');
    return el && el.value.trim() ? el.value.trim() : undefined;
  }
  function showErr(msg) {
    var e = document.getElementById('ag-err');
    if (!e) return;
    e.textContent = msg;
    e.classList.add('is-on');
  }
  function currentItem() {
    if (!state.sel) return null;
    var k = state.sel.split(':')[0], id = state.sel.slice(k.length + 1);
    return state.pending.filter(function (i) { return i.kind === k && String(i.id) === id; })[0] || null;
  }

  async function resolve(approve) {
    var it = currentItem();
    if (!it || state.busy) return;
    // Rejecting asks for a reason first — one click reveals the field, the second sends.
    var wrap = document.getElementById('ag-reason-wrap');
    if (!approve && wrap && wrap.hidden) {
      wrap.hidden = false;
      document.getElementById('ag-reason').focus();
      document.getElementById('ag-reject').textContent = 'Confirm rejection';
      return;
    }
    var pair = fnFor(it, approve);
    var btn = document.getElementById(approve ? 'ag-approve' : 'ag-reject');
    state.busy = true;
    try {
      await D.withButtonBusy(btn, approve ? 'Working…' : 'Rejecting…', function () {
        return D.callFunction(pair[0], pair[1]);
      });
      closePanel();
      await refresh(true);
    } catch (e) {
      // A genuine server-side refusal (a re-validation 409) shows verbatim — it names the real
      // current balance or unit count, which is exactly what the PM needs to see.
      showErr(D.writeErrorMessage(e));
    } finally { state.busy = false; }
  }

  /* ── history ──────────────────────────────────────────────────────────────────────── */
  function buildHistory(d) {
    var byId = {};
    d.clients.forEach(function (c) { byId[c.id] = c; });
    var prod = {};
    d.products.forEach(function (p) { prod[p.id] = p; });
    function who(id) { var c = byId[id]; return c ? c.name : 'Unknown client'; }
    var out = [];
    function push(kind, id, clientId, title, sub, amount, outcome, when, differs) {
      out.push({ kind: kind, id: id, client: who(clientId), title: title, sub: sub,
                 amount: amount, outcome: outcome, when: when, differs: !!differs });
    }
    d.clients.filter(function (c) { return c.application_resolved_at; }).forEach(function (c) {
      push('app', c.id, c.id, 'Application · ' + (c.account_type || '').replace(' Account', ''),
        'APP-' + String(c.id).slice(0, 8), null, c.status === 'active' ? 'Approved' : 'Rejected', c.application_resolved_at);
    });
    d.dep.filter(function (r) { return r.status !== 'pending'; }).forEach(function (r) {
      push('dep', r.id, r.client_id, 'Deposit · ' + (r.method === 'crypto' ? 'Crypto' : 'Bank transfer'),
        'DEP-' + String(r.id).slice(0, 8), r.credited_amount, r.status === 'credited' ? 'Credited' : 'Rejected', r.resolved_at,
        r.credited_amount != null && r.requested_amount != null && Math.round(r.credited_amount) !== Math.round(r.requested_amount));
    });
    d.wd.filter(function (r) { return r.status !== 'pending'; }).forEach(function (r) {
      push('wd', r.id, r.client_id, 'Withdrawal · ' + (r.method === 'crypto' ? 'Crypto' : 'Bank transfer'),
        'WDR-' + String(r.id).slice(0, 8), r.approved_amount, r.status === 'approved' ? 'Approved' : 'Rejected', r.resolved_at,
        r.approved_amount != null && Math.round(r.approved_amount) !== Math.round(r.requested_amount));
    });
    d.alo.filter(function (r) { return r.status !== 'pending'; }).forEach(function (r) {
      var p = prod[r.product_id];
      push('alo', r.id, r.client_id, 'Allocation · ' + (p ? p.name : 'Unknown'),
        'ALC-' + String(r.id).slice(0, 8), r.requested_amount, r.status === 'approved' ? 'Approved' : 'Rejected', r.resolved_at);
    });
    d.sell.filter(function (r) { return r.status !== 'pending'; }).forEach(function (r) {
      var p = prod[r.product_id];
      push('sell', r.id, r.client_id, 'Sell · ' + (p ? p.name : 'Unknown'),
        'SLL-' + String(r.id).slice(0, 8) + ' · ' + Number(r.units_to_sell).toFixed(2) + ' units',
        null, r.status === 'approved' ? 'Approved' : 'Rejected', r.resolved_at);
    });
    d.hysDep.filter(function (r) { return r.status !== 'pending'; }).forEach(function (r) {
      push('hys', r.id, r.client_id, 'HYS · ' + (r.term_label || r.pocket_type) + ' pocket',
        'HYS-' + String(r.id).slice(0, 8), r.credited_amount, r.status === 'credited' ? 'Credited' : 'Rejected', r.resolved_at,
        r.credited_amount != null && Math.round(r.credited_amount) !== Math.round(r.requested_amount));
    });
    d.hysWd.filter(function (r) { return r.status !== 'pending'; }).forEach(function (r) {
      push('hys', r.id, r.client_id, 'HYS withdrawal · ' + (r.term_label || r.pocket_type),
        'HYW-' + String(r.id).slice(0, 8), r.receive_amount, r.status === 'approved' ? 'Approved' : 'Rejected', r.resolved_at);
    });
    d.prof.filter(function (r) { return r.status !== 'pending'; }).forEach(function (r) {
      push('prof', r.id, r.client_id, 'Profile update · ' + fieldLabel(r.field),
        'PRF-' + String(r.id).slice(0, 8), null, r.status === 'approved' ? 'Approved' : 'Rejected', r.resolved_at);
    });
    return out;
  }

  var COLS = [
    { k: 'kind', l: '' }, { k: 'title', l: 'Request' }, { k: 'client', l: 'Client' },
    { k: 'amount', l: 'Amount' }, { k: 'outcome', l: 'Outcome' }, { k: 'when', l: 'Decided' }
  ];
  function renderHistory() {
    var rows = state.history.filter(function (r) {
      if (state.hfilter !== 'all' && r.kind !== state.hfilter) return false;
      if (!state.hq) return true;
      var q = state.hq.toLowerCase();
      return (r.client || '').toLowerCase().indexOf(q) !== -1 || (r.title || '').toLowerCase().indexOf(q) !== -1 ||
             (r.sub || '').toLowerCase().indexOf(q) !== -1 || String(r.amount || '').indexOf(q) !== -1;
    });
    var dir = state.sortDir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var x = a[state.sortKey], y = b[state.sortKey];
      if (state.sortKey === 'when') return (new Date(x) - new Date(y)) * dir;
      if (state.sortKey === 'amount') return ((Number(x) || 0) - (Number(y) || 0)) * dir;
      return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)) * dir;
    });

    var counts = { all: state.history.length };
    ORDER.forEach(function (k) { counts[k] = state.history.filter(function (r) { return r.kind === k; }).length; });
    document.getElementById('ag-hfilters').innerHTML =
      [{ k: 'all', l: 'All' }].concat(ORDER.map(function (k) { return { k: k, l: LABEL[k] }; })).map(function (p) {
        return '<button type="button" class="ag-fp' + (state.hfilter === p.k ? ' is-on' : '') + '" data-hf="' + p.k + '">' +
          esc(p.l) + ' <span class="ag-n">' + counts[p.k] + '</span></button>';
      }).join('') +
      '<span class="ag-srch"><span class="ag-ic"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>' +
      '<input id="ag-hq" type="search" placeholder="Search client, reference or amount" aria-label="Search history" value="' + esc(state.hq) + '" /></span>';

    document.getElementById('ag-hhead').innerHTML = COLS.map(function (c) {
      if (!c.l) return '<span></span>';
      var on = state.sortKey === c.k;
      return '<span><button type="button" data-sort="' + c.k + '" class="' + (on ? 'is-srt' : '') + '">' + esc(c.l) +
        ' <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">' +
        (on && state.sortDir === 'asc' ? '<polyline points="18 15 12 9 6 15"/>' : '<polyline points="6 9 12 15 18 9"/>') +
        '</svg></button></span>';
    }).join('');

    document.getElementById('ag-hrows').innerHTML = rows.length ? rows.map(function (r) {
      var ok = r.outcome !== 'Rejected';
      return '<div class="ag-hrow">' +
        '<span class="ag-ti ag-t-' + r.kind + '" style="width:30px;height:30px">' + icon(r.kind, 13) + '</span>' +
        '<span class="ag-what"><b>' + esc(r.title) + '</b><span>' + esc(r.sub) + '</span></span>' +
        '<span class="ag-who"><span class="ag-av">' + esc(initials(r.client)) + '</span><span class="ag-nm"><b>' + esc(r.client) + '</b></span></span>' +
        '<span class="ag-amt"><b>' + (r.amount == null ? '—' : usd(r.amount)) +
          (r.differs ? ' <span class="ag-differs">(differs)</span>' : '') + '</b></span>' +
        '<span><span class="ag-outc ' + (ok ? 'ag-o-ok' : 'ag-o-no') + '">' + esc(r.outcome) + '</span></span>' +
        // Attribution is captured on every decision and deliberately NOT rendered — see the
        // file header. This column is a timestamp only.
        '<span class="ag-when">' + (r.when ? esc(whenFull(r.when)) : '—') + '</span>' +
        '</div>';
    }).join('') : '<div class="ag-empty" style="border:none"><b>Nothing decided yet.</b><span>Resolved requests appear here.</span></div>';
  }

  /* ── wiring ───────────────────────────────────────────────────────────────────────── */
  async function refresh(force) {
    var d = await load(force);
    state.data = d;
    state.pending = build(d);
    state.history = buildHistory(d);
    renderFilters();
    renderQueue();
    if (state.view === 'history') renderHistory();
    if (typeof window.refreshApprovalsCount === 'function') window.refreshApprovalsCount();
  }

  function setView(v) {
    state.view = v;
    document.getElementById('ag-pending-view').hidden = v !== 'pending';
    document.getElementById('ag-history-view').hidden = v !== 'history';
    document.getElementById('ag-view-pending').classList.toggle('is-on', v === 'pending');
    document.getElementById('ag-view-history').classList.toggle('is-on', v === 'history');
    document.getElementById('ag-view-pending').setAttribute('aria-selected', String(v === 'pending'));
    document.getElementById('ag-view-history').setAttribute('aria-selected', String(v === 'history'));
    if (v === 'history') renderHistory();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var row = t.closest && t.closest('.ag-row');
    var fp = t.closest && t.closest('[data-f]');
    var hf = t.closest && t.closest('[data-hf]');
    var sc = t.closest && t.closest('[data-sort]');
    if (t.closest && t.closest('#ag-view-pending')) return setView('pending');
    if (t.closest && t.closest('#ag-view-history')) return setView('history');
    if (t.closest && t.closest('#ag-close')) return closePanel();
    if (t.closest && t.closest('#ag-approve')) return resolve(true);
    if (t.closest && t.closest('#ag-reject')) return resolve(false);
    if (t.id === 'ag-scrim') return closePanel();
    if (fp) { state.filter = fp.getAttribute('data-f'); renderFilters(); renderQueue(); return; }
    if (hf) { state.hfilter = hf.getAttribute('data-hf'); renderHistory(); return; }
    if (sc) {
      var k = sc.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = k; state.sortDir = k === 'when' ? 'desc' : 'asc'; }
      renderHistory(); return;
    }
    if (row) {
      var k2 = row.getAttribute('data-kind'), id = row.getAttribute('data-id');
      var it = state.pending.filter(function (i) { return i.kind === k2 && String(i.id) === id; })[0];
      if (it) openPanel(it);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'ag-q') { state.q = e.target.value; renderQueue(); }
    if (e.target.id === 'ag-hq') { state.hq = e.target.value; var v = e.target.value; renderHistory();
      var n = document.getElementById('ag-hq'); if (n) { n.focus(); n.setSelectionRange(v.length, v.length); } }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !document.getElementById('ag-scrim').hidden) closePanel();
  });

  D.renderAsyncBundle(document.getElementById('ag-queue'), {
    skeletonHTML: D.skeleton.lines(['w-full', 'w-full', 'w-5/6', 'w-full'], { gap: 'space-y-2' }),
    load: function () { return load(false); },
    render: function (d) {
      state.data = d;
      state.pending = build(d);
      state.history = buildHistory(d);
      state.ready = true;
      renderFilters();
      renderQueue();
    }
  });

  window.__agInternals = { build: build, buildHistory: buildHistory, detailRows: detailRows, humanizeKey: humanizeKey, ageOf: ageOf, state: state };
})();
