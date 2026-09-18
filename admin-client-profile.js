// ★ PM tool revamp, part 4 (2026-09-15) — the client profile (register row 233).
//
// Two reads, composed: get-client-profile (identity, panels, counts) and the EXISTING
// get-returns-summary (the money split, per-position gain, capitalDeployed). The second is
// reused rather than reimplemented — this page formats figures and never computes them
// (row 185), and duplicating money math is the one thing this codebase refuses to do.
//
// Panels render through MarketswaveData.renderAsyncBundle, so every one paints a skeleton,
// then real content, or a real error card with a working retry — never a blank region.
(function () {
  'use strict';

  var D = document;
  var params = new URLSearchParams(location.search);
  var CLIENT_ID = params.get('client') || '';

  // ---- small formatters. The page formats; it does not compute. -----------------------------
  function usd(n) {
    if (n === null || n === undefined) return '—';
    return (n < 0 ? '−' : '') + '$' + Math.abs(Number(n)).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function usdSigned(n) {
    if (n === null || n === undefined) return '—';
    return (n < 0 ? '−' : '+') + '$' + Math.abs(Number(n)).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function pct(n) {
    if (n === null || n === undefined) return '';
    return (n < 0 ? '−' : '+') + Math.abs(Number(n)).toFixed(1) + '%';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function dateShort(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return '—'; }
  }
  function ago(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    var d = Math.floor(h / 24);
    if (d < 32) return d + 'd';
    return dateShort(iso);
  }
  function initials(name) {
    if (window.getClientInitials) { try { return window.getClientInitials(name); } catch (e) { /* fall through */ } }
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function toast(msg) {
    var t = D.getElementById('cp-toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(function () { t.classList.add('hidden'); }, 4000);
  }

  // ---- one load, shared by every panel -------------------------------------------------------
  var cache = null;
  function load() {
    if (cache) return cache;
    cache = (async function () {
      MarketswaveData.useAdminClient();
      var profile = await MarketswaveData.callFunction('get-client-profile', { clientId: CLIENT_ID });
      // get-returns-summary owns the money split and per-position gain. A client with no
      // holdings at all still returns a valid shape, so this needs no special-casing.
      var returns = null;
      try {
        returns = await MarketswaveData.callFunction('get-returns-summary', { clientId: CLIENT_ID });
      } catch (e) {
        returns = null; // the profile still renders; the money strip says what it cannot show
      }
      return { p: profile, r: returns };
    })();
    return cache;
  }
  function reload() { cache = null; return load(); }

  // ---- identity + money strip -----------------------------------------------------------------
  var STATUS = {
    active: ['cp-b-act', 'Active'],
    pending_review: ['cp-b-pend', 'Pending review'],
    rejected: ['cp-b-rej', 'Rejected']
  };

  function renderIdentity(d) {
    var c = d.p.client, m = d.p.money, r = d.r;
    var st = STATUS[c.status] || ['cp-b-pend', c.status];
    D.getElementById('cp-crumb-name').textContent = c.name;
    D.getElementById('cp-sub').textContent = c.email;
    D.title = c.name + ' — Marketswave PM Tool';

    var addr = d.p.profile.address;
    var place = addr && (addr.city || addr.country)
      ? [addr.city, addr.country].filter(Boolean).join(', ') : null;

    // The live dot is presence's own signal — a dot, never a number (§3).
    var dot = d.p.presence.live ? '<span class="cp-on" title="On the site now"></span>' : '';
    var liveWord = d.p.presence.live ? '<span class="cp-sep">·</span><b>Online now</b>' : '';

    // get-returns-summary puts these at the TOP LEVEL, not under a `totals` object — checked
    // against the function rather than assumed.
    var unreal = r ? r.unrealized : null;
    var realis = r ? r.realized : null;
    var totalVal = r ? r.total : null;

    return '' +
      '<div class="cp-idh">' +
        '<div class="cp-pfp">' + esc(initials(c.name)) + dot + '</div>' +
        '<div class="cp-idt">' +
          '<h1>' + esc(c.name) +
            ' <span class="cp-badge ' + st[0] + '">' + esc(st[1]) + '</span>' +
          '</h1>' +
          '<div class="cp-meta">' +
            '<b>' + esc(c.email) + '</b><span class="cp-sep">·</span>' + esc(c.phone || '—') +
            (place ? '<span class="cp-sep">·</span>' + esc(place) : '') +
            '<span class="cp-sep">·</span>Client since ' + esc(dateShort(c.createdAt)) +
            '<span class="cp-sep">·</span>' + esc(c.accountType) +
            liveWord +
          '</div>' +
        '</div>' +
        '<div class="cp-idacts">' +
          '<a class="mw-btn mw-btn-sm mw-btn-admin" id="cp-message" href="admin-inbox.html?client=' + encodeURIComponent(c.id) + '">Message</a>' +
          '<a class="mw-btn mw-btn-sm" id="cp-viewas" href="admin-clients.html?view=' + encodeURIComponent(c.id) + '">View as client</a>' +
        '</div>' +
      '</div>' +
      '<div class="cp-strip">' +
        st1('Portfolio value', usd(m.portfolioValue), (r && r.positions ? r.positions.length : 0) + ' holding' + ((r && r.positions && r.positions.length === 1) ? '' : 's')) +
        st1('Total return', totalVal === null ? '—' : usdSigned(totalVal),
            totalVal === null ? 'not available' : (usdSigned(unreal) + ' unreal · ' + usdSigned(realis) + ' real'),
            totalVal === null ? '' : (totalVal < 0 ? 'cp-dn' : 'cp-up')) +
        st1('Unallocated', usd(m.unallocated), 'available to deploy') +
        st1('Savings pockets', usd(m.pocketTotal),
            m.pocketCount === 0 ? 'no pockets' :
            (m.pocketCount + ' pocket' + (m.pocketCount === 1 ? '' : 's') +
             (m.nextMaturity ? ' · matures ' + esc(dateShort(m.nextMaturity.date)) : ''))) +
        st1('Capital deployed', r ? usd(r.capitalDeployed) : '—',
            'of ' + usd(m.deposited) + ' deposited') +
      '</div>';
  }
  function st1(k, v, x, cls) {
    return '<div class="cp-st"><div class="cp-k">' + esc(k) + '</div>' +
      '<div class="cp-v ' + (cls || '') + '">' + v + '</div>' +
      '<div class="cp-x">' + x + '</div></div>';
  }

  // ---- tabs ------------------------------------------------------------------------------------
  function renderTabs(d) {
    var n = d.p.counts;
    var holdings = d.r && d.r.positions ? d.r.positions.length : 0;
    var defs = [
      ['Overview', null, true],
      ['Holdings', holdings, false],
      ['Activity', null, false],
      ['Requests', n.requests, false],
      ['Documents', n.documents, false],
      ['Conversations', n.conversations, false],
      ['Onboarding', null, false],
      ['Notes', n.notes, false]
    ];
    return defs.map(function (t) {
      return '<button type="button" class="cp-tb' + (t[2] ? ' is-on' : '') + '" role="tab"' +
        ' aria-selected="' + (t[2] ? 'true' : 'false') + '" data-cp-tab="' + esc(t[0]) + '">' +
        esc(t[0]) + (t[1] !== null && t[1] !== undefined ? '<span class="cp-n">' + t[1] + '</span>' : '') +
        '</button>';
    }).join('');
  }

  // ---- panels ----------------------------------------------------------------------------------
  var ICONS = {
    allocation: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M18.7 8 12 14.7l-3.5-3.5L3 16.4"/></svg>',
    deposit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
    withdrawal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B4402C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    hys: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#92400E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    doc: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6D28D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>'
  };
  var KINDS = {
    allocation: ['Allocation', 'cp-i-alo', ICONS.allocation],
    sell: ['Sell', 'cp-i-alo', ICONS.allocation],
    deposit: ['Deposit', 'cp-i-dep', ICONS.deposit],
    withdrawal: ['Withdrawal', 'cp-i-wd', ICONS.withdrawal],
    hys_deposit: ['Savings pocket', 'cp-i-hys', ICONS.hys],
    hys_withdrawal: ['Pocket withdrawal', 'cp-i-hys', ICONS.hys],
    profile_change: ['Profile update', 'cp-i-doc', ICONS.doc]
  };

  function renderAttention(d) {
    var head = '<div class="cp-ch"><b>Needs your attention</b>' +
      (d.p.pending.length ? '<a href="admin-approvals.html">All requests →</a>' : '') + '</div>';
    if (!d.p.pending.length) {
      return head + '<div class="cp-empty">Nothing pending. Any request this client submits appears here and in the approval gate.</div>';
    }
    return head + d.p.pending.map(function (r) {
      var k = KINDS[r.kind] || ['Request', 'cp-i-alo', ICONS.allocation];
      var what = k[0] + (r.product ? ' · ' + r.product.name : (r.field ? ' · ' + r.field : ''));
      var amount = r.amount === null ? '' : (r.kind === 'sell' ? r.amount + ' units' : usd(r.amount));
      return '<div class="cp-r" data-cp-pending="' + esc(r.kind) + '">' +
        '<div class="cp-ic ' + k[1] + '">' + k[2] + '</div>' +
        '<div class="cp-rb"><div class="cp-rt">' + esc(what) + '</div>' +
          '<div class="cp-rs">Requested ' + esc(dateShort(r.requestedAt)) + (amount ? ' · ' + amount : '') + '</div></div>' +
        '<div class="cp-ra"><a class="mw-btn mw-btn-sm mw-btn-admin" href="admin-approvals.html">Review</a></div>' +
        '</div>';
    }).join('');
  }

  function renderHoldings(d) {
    var head = '<div class="cp-ch"><b>Holdings</b><a href="admin-approvals.html">Approval gate →</a></div>';
    var pos = d.r && d.r.positions ? d.r.positions : [];
    if (!pos.length) {
      return head + '<div class="cp-empty">No holdings. Capital this client deploys will appear here once an allocation is approved.</div>';
    }
    return head + pos.map(function (p) {
      // positions carry no ticker/logo (get-returns-summary owns the math, not presentation);
      // the profile's productMeta map supplies them.
      var meta = (d.p.productMeta || {})[p.productId] || {};
      var mark = window.AssetMark
        ? AssetMark.html({ name: p.name, ticker: meta.ticker, logoUrl: meta.logoUrl, size: 's' })
        : '';
      var unitsTxt = (window.formatUnits ? formatUnits(p.units, p.assetClass) : p.units);
      return '<div class="cp-hold" data-cp-holding="' + esc(p.productId || p.name) + '">' + mark +
        '<div class="cp-hn"><b>' + esc(p.name) + '</b>' +
          '<span>' + esc(unitsTxt) + ' units · ' + usd(p.costBasis) + ' in</span></div>' +
        '<div class="cp-hv"><b>' + usd(p.currentValue) + '</b>' +
          '<span class="' + (Number(p.unrealized) < 0 ? 'cp-dn' : 'cp-up') + '">' + pct(p.unrealizedPercent) + '</span></div>' +
        '</div>';
    }).join('');
  }

  var TXN_LABEL = {
    DEPOSIT: ['Deposit credited', 'cp-i-dep', ICONS.deposit],
    WITHDRAWAL: ['Withdrawal paid', 'cp-i-wd', ICONS.withdrawal],
    BUY: ['Allocation approved', 'cp-i-alo', ICONS.allocation],
    SELL: ['Sell executed', 'cp-i-alo', ICONS.allocation],
    HYS_DEPOSIT: ['Pocket funded', 'cp-i-hys', ICONS.hys],
    HYS_WITHDRAWAL: ['Pocket paid out', 'cp-i-hys', ICONS.hys],
    HYS_TRANSFER_IN: ['Transfer to savings', 'cp-i-hys', ICONS.hys]
  };

  function renderActivity(d) {
    var head = '<div class="cp-ch"><b>Recent activity</b><span class="cp-hint">newest first</span></div>';
    var a = d.p.activity;
    if (!a.length) return head + '<div class="cp-empty">No transactions yet.</div>';
    return head + a.map(function (t) {
      var l = TXN_LABEL[t.type] || [t.type, 'cp-i-alo', ICONS.allocation];
      var sub = dateShort(t.createdAt) + (t.product ? ' · ' + t.product.name : '');
      return '<div class="cp-r">' +
        '<div class="cp-ic ' + l[1] + '">' + l[2] + '</div>' +
        '<div class="cp-rb"><div class="cp-rt">' + esc(l[0]) + '</div><div class="cp-rs">' + esc(sub) + '</div></div>' +
        '<div class="cp-ra"><div class="cp-v">' + (t.totalValue === null ? '—' : usd(t.totalValue)) + '</div></div>' +
        '</div>';
    }).join('');
  }

  function renderAddresses(d) {
    var head = '<div class="cp-ch"><b>Crypto deposit addresses</b><a href="admin-deposit-addresses.html">Address book →</a></div>';
    var a = d.p.addresses;
    var rows = a.assigned.map(function (x) {
      return '<div class="cp-addr" data-cp-address="' + esc(x.currency + '/' + x.network) + '">' +
        (window.AssetMark ? AssetMark.html({ name: x.currency, ticker: x.currency, size: 's' }) : '') +
        '<div class="cp-an"><b>' + esc(x.currency) + (x.retired ? ' <span class="cp-pill cp-p-res">Retired</span>' : '') + '</b>' +
          '<span>' + esc(x.address || 'address unavailable') + '</span></div>' +
        '<span class="cp-netp">' + esc(x.network) + '</span>' +
        '</div>';
    }).join('');
    // The unassigned state is a real state, not an omission: the client can be given an address
    // for this route and has not been. It carries the action that fixes it.
    var un = a.unassigned.map(function (x) {
      // ★ NOT dimmed. The mockup signalled "no address" with opacity, which measured the
      // address line at 2.59:1 — dimming is the wrong way to say "absent", because it makes
      // the words saying so harder to read than the ones that are fine. The row says it in
      // text instead, at full contrast.
      return '<div class="cp-addr is-unassigned" data-cp-unassigned="' + esc(x.currency + '/' + x.network) + '">' +
        (window.AssetMark ? AssetMark.html({ name: x.currency, ticker: x.currency, size: 's' }) : '') +
        '<div class="cp-an"><b>' + esc(x.currency) + '</b><span>No address assigned</span></div>' +
        '<a class="mw-btn mw-btn-sm" href="admin-deposit-addresses.html">Assign</a>' +
        '</div>';
    }).join('');
    if (!rows && !un) return head + '<div class="cp-empty">No deposit routes are configured.</div>';
    return head + rows + un;
  }

  // ★ ONBOARDING — the record signup collects, from client_profiles (Task A, 2026-09-18,
  // register row 242), labelled through the shared vocabulary so this panel, settings.html and
  // the approval gate can never disagree about a value. Two honesty rules: an empty group says
  // "not submitted" (a client who applied before 2026-09-18 has no server record unless their
  // browser reclaimed it at a later login — nothing was lost, it was never sent), and the panel
  // shows what signup COLLECTS: country of residence, which is not tax residence.
  function renderOnboarding(d) {
    var p = d.p.profile;
    var o = d.p.onboarding || {};
    var V = window.OnboardingVocab;
    var legal = p.legalName ? [p.legalName.firstName, p.legalName.lastName].filter(Boolean).join(' ') : null;
    var addr = p.address ? formatFieldDisplay('address', p.address) : null;
    var idd = p.idDocument;
    var idTxt = idd ? [idd.documentType, idd.fileName].filter(Boolean).join(' · ') : null;
    var applicable = V ? V.groupsForAccountType(d.p.client.accountType) : [];

    var groups = applicable.map(function (key) {
      var value = o[key];
      var lines = V.describe(key, value).filter(function (x) { return x.text !== null; });
      var body;
      if (!lines.length) {
        body = '<span class="cp-unsub" data-cp-unsubmitted="' + esc(key) + '">Not submitted</span>';
      } else if (V.VOCAB[key].scalar) {
        body = esc(lines[0].text);
      } else {
        body = lines.map(function (x) { return '<span class="cp-ol"><span class="cp-olk">' + esc(x.label) + '</span> ' + esc(x.text) + '</span>'; }).join('');
      }
      return '<div class="cp-og" data-cp-group="' + esc(key) + '"><div class="cp-k">' + esc(V.VOCAB[key].label) + '</div><div class="cp-v">' + body + '</div></div>';
    }).join('');

    var dob = V ? V.dateOfBirthDisplay(o.dateOfBirth) : null;
    var submitted = o.submittedAt
      ? '<span class="cp-hint">submitted ' + esc(dateShort(o.submittedAt)) + '</span>'
      : '<span class="cp-hint">no onboarding record submitted</span>';

    return '<div class="cp-ch"><b>Onboarding</b>' + submitted + '</div>' +
      '<div class="cp-kv">' +
        kv('Legal name', legal) +
        kv('Address', addr) +
        kv('ID document', idTxt) +
        kv('Account type', d.p.client.accountType) +
        kvRaw('Date of birth', dob ? esc(dob) : '<span class="cp-unsub" data-cp-unsubmitted="dateOfBirth">Not submitted</span>') +
      '</div>' +
      '<div class="cp-kv cp-kv-groups">' + groups + '</div>' +
      (o.submittedAt ? '' :
        '<div class="cp-absent" data-cp-absent="onboarding">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
          '<p><b>No onboarding record has been submitted for this client.</b> ' +
          'Clients who applied before 18 September 2026 had their answers stored only in the browser they applied from; ' +
          'they are sent to the server the next time that client signs in from the same browser, or the client can add each section through Settings.</p>' +
        '</div>');
  }
  function kvRaw(k, html) {
    return '<div><div class="cp-k">' + esc(k) + '</div><div class="cp-v">' + html + '</div></div>';
  }
  function kv(k, v) {
    return '<div><div class="cp-k">' + esc(k) + '</div><div class="cp-v">' + (v ? esc(v) : '—') + '</div></div>';
  }

  // ★ IDENTITY DOCUMENTS (Task A, 2026-09-18) — METADATA ONLY, NO CONTROL. The bytes live in
  // the identity-documents bucket, whose SELECT policy grants a PM nothing; there is no logged
  // read yet (Task B). What is true now, and all that is rendered: a document of this type is
  // on file, its filename, and when it was uploaded. No View, no Request, no disabled button
  // implying a capability arriving later.
  function renderIdentityDocuments(ids) {
    if (!ids || !ids.length) {
      return '<div class="cp-idd-empty" data-cp-idd-empty>No identity documents on file. ' +
        'Signup uploads a photo ID and a proof of address; clients who applied before 18 September 2026 were never asked for the file itself.</div>';
    }
    var KIND = { id: 'Photo ID', address: 'Proof of address' };
    return '<div class="cp-idd" data-cp-idd>' + ids.map(function (x) {
      return '<div class="cp-doc" data-cp-idd-row="' + esc(x.id) + '">' +
        '<div class="cp-ic cp-i-doc">' + ICONS.doc + '</div>' +
        '<div class="cp-dn"><b>' + esc(x.documentType) + ' <span class="cp-pill cp-p-res">Identity</span></b>' +
          '<span>' + esc(KIND[x.kind] || x.kind) + ' · ' + esc(x.filename) + ' · uploaded ' + esc(dateShort(x.uploadedAt)) + '</span></div>' +
        '<span class="cp-pill" data-cp-idd-onfile>On file</span>' +
        '</div>';
    }).join('') +
      '<div class="cp-locked" data-cp-locked>' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        '<p><b>Viewing identity documents is not available.</b> Every view will be access-logged before any PM can open one; until that is in place there is no way to open these from the PM tool.</p>' +
      '</div></div>';
  }

  // ★ DOCUMENTS — the Documents & Reporting rows. (Identity documents used to be detected here
  // by a filename regex; they now come from their own table and render above these rows.)
  function renderDocuments(d) {
    var head = '<div class="cp-ch"><b>Documents</b><a href="admin-documents.html">All documents →</a></div>';
    var idd = renderIdentityDocuments(d.p.identityDocuments);
    var docs = d.p.documents;
    if (!docs.length) return head + idd + '<div class="cp-empty">No other documents yet.</div>';
    var anyRestricted = docs.some(function (x) { return x.restricted; });
    var rows = docs.slice(0, 6).map(function (x) {
      var sub = (x.direction === 'upload' ? 'Uploaded ' : 'Sent ') + dateShort(x.createdAt) +
        (x.status ? ' · ' + x.status : '');
      var action;
      if (x.restricted) {
        // The bytes may or may not exist; either way this control is Request, not Open.
        action = '<button type="button" class="mw-btn mw-btn-sm" data-cp-request-doc="' + esc(x.id) + '">Request</button>';
      } else if (!x.hasFile) {
        // Row 224: no bytes behind this row. A View button here would open nothing.
        action = '<span class="cp-pill cp-p-res" data-cp-nofile="' + esc(x.id) + '">No file</span>';
      } else {
        action = '<button type="button" class="mw-btn mw-btn-sm" data-cp-open-doc="' + esc(x.id) + '">Open</button>';
      }
      return '<div class="cp-doc" data-cp-doc="' + esc(x.id) + '">' +
        '<div class="cp-ic cp-i-doc">' + ICONS.doc + '</div>' +
        '<div class="cp-dn"><b>' + esc(x.filename) + (x.restricted ? ' <span class="cp-pill cp-p-res">Restricted</span>' : '') + '</b>' +
          '<span>' + esc(sub) + '</span></div>' + action +
        '</div>';
    }).join('');
    var warn = anyRestricted ? (
      '<div class="cp-locked" data-cp-locked>' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        '<p><b>Identity documents are access-logged.</b> Requesting one records who asked, when and why. ' +
        'The client is not notified, but the record is permanent.</p>' +
      '</div>') : '';
    return head + idd + rows + warn;
  }

  var CH = { chat: 'cp-c-chat', email: 'cp-c-email', ticket: 'cp-c-ticket' };
  function renderConversations(d) {
    var head = '<div class="cp-ch"><b>Conversations</b><a href="admin-inbox.html">Open in inbox →</a></div>';
    var cv = d.p.conversations;
    if (!cv.length) return head + '<div class="cp-empty">No conversations yet.</div>';
    return head + cv.slice(0, 5).map(function (c) {
      var title = c.kind === 'ticket' && c.displayId
        ? c.displayId + ' · ' + (c.subject || 'Ticket')
        : (c.subject || (c.kind === 'chat' ? 'Live chat' : 'Email'));
      return '<div class="cp-cv" data-cp-conv="' + esc(c.id) + '">' +
        '<span class="cp-cvch ' + (CH[c.kind] || 'cp-c-email') + '">' + esc(c.kind) + '</span>' +
        '<div class="cp-cvb"><b>' + esc(title) + '</b></div>' +
        (c.unread ? '<span class="cp-unread" title="Needs a reply"></span>' : '') +
        '<span class="cp-cvt">' + esc(ago(c.lastMessageAt)) + '</span>' +
        '</div>';
    }).join('');
  }

  function renderWatchlist(d) {
    var head = '<div class="cp-ch"><b>Watchlist</b><span class="cp-hint">tracking, not held</span></div>';
    var w = d.p.watchlist;
    if (!w.length) return head + '<div class="cp-empty">Nothing on the watchlist.</div>';
    return head + '<div class="cp-wl">' + w.map(function (x) {
      return '<span class="cp-wc" data-cp-watch="' + esc(x.symbol) + '">' + esc(x.symbol) + '</span>';
    }).join('') + '</div>';
  }

  // ★ PRIVATE NOTES — author-only, enforced by RLS on pm_client_notes, not by this filter.
  function renderNotes(d) {
    var head = '<div class="cp-ch"><b>Private notes</b><span class="cp-hint">Visible to you only</span></div>';
    var n = d.p.notes;
    var body = n.length
      ? n.map(function (x) {
          return '<div class="cp-pn" data-cp-note="' + esc(x.id) + '">' +
            '<div class="cp-pnh"><b>' + esc(dateShort(x.createdAt)) + '</b></div>' +
            '<p>' + esc(x.body) + '</p></div>';
        }).join('')
      : '<div class="cp-empty">No notes yet.</div>';
    return head + body +
      '<button type="button" class="mw-btn mw-btn-sm" id="cp-addnote" style="width:100%;margin-top:11px">+ Add a note</button>' +
      '<div class="cp-noteform" id="cp-noteform">' +
        '<label for="cp-notetext" class="sr-only">Note</label>' +
        '<textarea id="cp-notetext" placeholder="What should you remember about this client?"></textarea>' +
        '<div class="cp-noterow">' +
          '<button type="button" class="mw-btn mw-btn-sm mw-btn-admin" id="cp-savenote">Save note</button>' +
          '<button type="button" class="mw-btn mw-btn-sm" id="cp-cancelnote">Cancel</button>' +
        '</div>' +
      '</div>' +
      // Verbatim from the approved mockup — the label says what the interface does, this says
      // what the law does.
      '<div class="cp-absent" data-cp-disclosable>' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>Not shown to the client, but notes a firm holds about a person may be disclosable if they make a data access request. Write accordingly.</p>' +
      '</div>';
  }

  function renderHealth(d) {
    var h = d.p.health;
    var st = STATUS[h.status] || ['', h.status];
    return '<div class="cp-ch"><b>Account health</b></div>' +
      '<div class="cp-kv">' +
        kv('Application status', st[1]) +
        kv('Reviewed', h.lastReviewedAt ? dateShort(h.lastReviewedAt) : 'not recorded') +
        kv('Advisory fee rate', h.advisoryFeeRate === null ? '—' : (h.advisoryFeeRate + '% · platform-wide')) +
        kv('Last sign-in', h.lastSignInAt ? dateShort(h.lastSignInAt) : 'never') +
      '</div>' +
      '<div class="cp-absent" data-cp-absent="fee">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p><b>No fee has been billed and no statement has been issued.</b> The rate above is the platform-wide setting; ' +
        'this project has no invoicing and nothing that generates statements, so there is no amount charged to show.</p>' +
      '</div>';
  }

  // ★ SECURITY ACTIONS — moved here from the client list's expander (register row 235). They
  // were real actions with no other home once the row became navigation.
  //
  // Both are LOCAL-ONLY and the page says so rather than implying otherwise (row 128's own
  // finding, re-checked): resetClientPassword() sets a local forcePasswordReset flag that gates
  // settings.html, and this project has never persisted a real password anywhere — so for a
  // Supabase-authenticated client it does NOT change the credential they actually sign in with.
  // resetClient2FA() DOES achieve its full intended effect, because 2FA has always been a local
  // simulated feature. Warning the PM about both equally would be inaccurate.
  function renderSecurity(d) {
    var c = d.p.client;
    return '<div class="cp-ch"><b>Security</b><span class="cp-hint">logged, reason required</span></div>' +
      '<div class="cp-r"><div class="cp-rb"><div class="cp-rt">Reset password</div>' +
        '<div class="cp-rs">Forces a new password on next sign-in</div></div>' +
        '<div class="cp-ra"><button type="button" class="mw-btn mw-btn-sm" data-cp-sec="password" ' +
          'data-cp-name="' + esc(c.name) + '">Reset</button></div></div>' +
      '<div class="cp-r"><div class="cp-rb"><div class="cp-rt">Reset two-factor authentication</div>' +
        '<div class="cp-rs">Clears the client’s 2FA enrolment</div></div>' +
        '<div class="cp-ra"><button type="button" class="mw-btn mw-btn-sm" data-cp-sec="2fa" ' +
          'data-cp-name="' + esc(c.name) + '">Reset</button></div></div>' +
      '<div class="cp-absent" data-cp-absent="security">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p><b>Reset password does not change a real sign-in credential.</b> This project has never stored a ' +
        'password; the reset sets a local flag that forces a new one to be set on the client’s next visit. ' +
        'Reset two-factor authentication does take full effect, because 2FA is a local feature.</p>' +
      '</div>';
  }

  // ---- wire ------------------------------------------------------------------------------------
  function bundle(el, renderer) {
    MarketswaveData.renderAsyncBundle(el, {
      skeletonHTML: MarketswaveData.skeleton.lines(['w-1/3', 'w-full', 'w-5/6', 'w-full'], { gap: 'space-y-3' }),
      load: load,
      render: function (d) { el.innerHTML = renderer(d); }
    });
  }

  function start() {
    if (!CLIENT_ID) {
      D.getElementById('cp-identity').innerHTML =
        '<div class="cp-idh"><div class="cp-idt"><h1>No client selected</h1>' +
        '<div class="cp-meta">Open a client from the <a href="admin-clients.html" style="color:#B45309;font-weight:600">client list</a>.</div>' +
        '</div></div>';
      return;
    }
    bundle(D.getElementById('cp-identity'), renderIdentity);
    bundle(D.getElementById('cp-attention'), renderAttention);
    bundle(D.getElementById('cp-holdings'), renderHoldings);
    bundle(D.getElementById('cp-activity'), renderActivity);
    bundle(D.getElementById('cp-addresses'), renderAddresses);
    bundle(D.getElementById('cp-onboarding'), renderOnboarding);
    bundle(D.getElementById('cp-documents'), renderDocuments);
    bundle(D.getElementById('cp-conversations'), renderConversations);
    bundle(D.getElementById('cp-watchlist'), renderWatchlist);
    bundle(D.getElementById('cp-notes'), renderNotes);
    bundle(D.getElementById('cp-health'), renderHealth);
    bundle(D.getElementById('cp-security'), renderSecurity);
    load().then(function (d) { D.getElementById('cp-tabs').innerHTML = renderTabs(d); }).catch(function () { /* panels report it */ });
  }

  // delegated actions
  D.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.closest && t.closest('#cp-addnote')) {
      D.getElementById('cp-noteform').classList.add('is-open');
      D.getElementById('cp-notetext').focus();
      return;
    }
    if (t.closest && t.closest('#cp-cancelnote')) {
      D.getElementById('cp-noteform').classList.remove('is-open');
      return;
    }
    var save = t.closest && t.closest('#cp-savenote');
    if (save) {
      var ta = D.getElementById('cp-notetext');
      var body = (ta.value || '').trim();
      if (!body) { toast('A note needs some text.'); return; }
      MarketswaveData.withButtonBusy(save, 'Saving…', async function () {
        // Direct insert: RLS pins author_id to the caller, so the note cannot be attributed to
        // anyone else and cannot be read by anyone else.
        await MarketswaveData.insertRow('pm_client_notes', {
          client_id: CLIENT_ID,
          author_email: await MarketswaveData.getCurrentUserEmail(),
          body: body
        });
      }).then(function () {
        ta.value = '';
        D.getElementById('cp-noteform').classList.remove('is-open');
        toast('Note saved.');
        reload().then(function (d) {
          D.getElementById('cp-notes').innerHTML = renderNotes(d);
          D.getElementById('cp-tabs').innerHTML = renderTabs(d);
        });
      }).catch(function (e) { toast(MarketswaveData.writeErrorMessage(e)); });
      return;
    }
    var req = t.closest && t.closest('[data-cp-request-doc]');
    if (req) {
      toast('Identity documents are access-logged and requested through Documents. Opening the documents queue.');
      setTimeout(function () { location.href = 'admin-documents.html'; }, 900);
      return;
    }
    var nofile = t.closest && t.closest('[data-cp-nofile]');
    if (nofile) { toast('No file is stored against this record.'); }
  });

  // ---- security modal --------------------------------------------------------------------------
  var secKind = null;
  function openSec(kind, name) {
    secKind = kind;
    D.getElementById('cp-sec-title').textContent = kind === 'password' ? 'Reset password' : 'Reset two-factor authentication';
    D.getElementById('cp-sec-desc').textContent = (kind === 'password'
      ? 'Forces ' + name + ' to set a new password on their next visit.'
      : 'Clears ' + name + '’s 2FA enrolment so they can enrol again.');
    var warn = D.getElementById('cp-sec-warn');
    if (kind === 'password') {
      warn.textContent = 'This does not change the credential they actually sign in with — no password is stored by this project. It sets a local flag that gates their settings page until they set a new one.';
      warn.classList.remove('hidden');
    } else { warn.classList.add('hidden'); }
    D.getElementById('cp-sec-reason').value = '';
    D.getElementById('cp-sec-error').classList.add('hidden');
    D.getElementById('cp-sec-modal').classList.remove('hidden');
    D.getElementById('cp-sec-reason').focus();
  }
  function closeSec() { D.getElementById('cp-sec-modal').classList.add('hidden'); secKind = null; }

  D.addEventListener('click', function (ev) {
    var open = ev.target.closest && ev.target.closest('[data-cp-sec]');
    if (open) { openSec(open.getAttribute('data-cp-sec'), open.getAttribute('data-cp-name') || 'this client'); return; }
    if (ev.target.closest && (ev.target.closest('#cp-sec-cancel') || ev.target.closest('#cp-sec-close') || ev.target.closest('#cp-sec-backdrop'))) {
      closeSec(); return;
    }
    var go = ev.target.closest && ev.target.closest('#cp-sec-submit');
    if (go) {
      var reason = (D.getElementById('cp-sec-reason').value || '').trim();
      var err = D.getElementById('cp-sec-error');
      if (!reason) { err.textContent = 'A reason is required — no silent resets.'; err.classList.remove('hidden'); return; }
      MarketswaveData.getCurrentUserEmail().then(function (who) {
        try {
          if (secKind === 'password') resetClientPassword(CLIENT_ID, reason, who);
          else resetClient2FA(CLIENT_ID, reason, who);
          closeSec();
          toast(secKind === 'password' ? 'Password reset recorded.' : 'Two-factor authentication reset.');
        } catch (e) {
          err.textContent = (e && e.message) || String(e);
          err.classList.remove('hidden');
        }
      });
    }
  });

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();
})();
