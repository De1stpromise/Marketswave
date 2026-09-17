/* ★ PM tool revamp, part 7 (2026-09-17) — the deposit address book.
 *
 * Blocked clients first, then the book grouped by currency AND network, then a detail panel
 * whose EMPHASIS depends on how many clients an address serves. Follows PM_TOOL_VOCABULARY.md.
 *
 * ★ EVERY READ THAT FEEDS A DISPLAY CHECKS ITS ERROR (register row 233's rule). The read is one
 * admin-only function, `get-deposit-address-book`, which must()-wraps every query and throws
 * rather than returning partial data — on this page "no deposits received" and "the query
 * failed" would otherwise render as the same em dash, and "this client has no address" is the
 * input to the amber banner. renderAsyncBundle paints a real error card with a retry.
 *
 * ★ NOTHING THAT EXISTED HERE WAS ORPHANED. All three write functions keep a caller:
 * add-deposit-address (its two-step read-back confirm, kept — see addConfirmHTML),
 * assign-deposit-address, and remove-deposit-address-assignment (its retire warning, kept).
 * The status filter pills the previous page carried are kept too: grouping by route is not a
 * status filter, and losing one would be a removal nobody asked for.
 */
(function () {
  if (typeof MarketswaveData === 'undefined') return;
  MarketswaveData.useAdminClient();

  var D = MarketswaveData;
  var state = { book: null, filter: 'all' };

  /* ---- formatting ------------------------------------------------------------------ */
  function usd(n) { return '$' + Math.round(Number(n)).toLocaleString('en-US'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dayStr(iso) {
    if (!iso) return '—';
    var d = new Date(String(iso).length === 10 ? iso + 'T00:00:00Z' : iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function shortDay(iso) {
    if (!iso) return '—';
    var d = new Date(String(iso).length === 10 ? iso + 'T00:00:00Z' : iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function toast(msg, bad) {
    var el = document.getElementById('da-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('bg-red-700', !!bad);
    el.classList.toggle('bg-slate-900', !bad);
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 4600);
  }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  /* ---- the coin mark ------------------------------------------------------------------
   * AssetMark with the currency's own ticker. A currency with no resolved logo renders its
   * monogram — which is what PYUSD does today, honestly, because nothing in the asset-logos
   * chain has ever resolved a mark for it (it is not a product and not a watchlist symbol). */
  function coinMark(currency, size) {
    return AssetMark.html({ name: currency, ticker: currency, logoUrl: null, size: size || 'xs' });
  }

  /* ---- blocked clients ------------------------------------------------------------------ */
  function renderBlocked() {
    var el = document.getElementById('da-blocked');
    if (!el) return;
    var blocked = state.book.blocked || [];
    if (!blocked.length) {
      el.innerHTML = '<div class="da-blocked" style="background:#F0FDF4;border-color:#BBF7D0">' +
        '<div class="da-bh"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
        '<b style="color:#14532D">Every client can deposit every currency</b></div>' +
        '<p class="da-none">All ' + state.book.strip.routeCount + ' routes are assigned for every active client.</p></div>';
      return;
    }
    el.innerHTML = '<div class="da-blocked">' +
      '<div class="da-bh">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>' +
        '<b>' + blocked.length + ' client' + (blocked.length === 1 ? '' : 's') + ' can\'t deposit every currency</b>' +
        '<span>No address assigned — they see an empty state where an address should be</span>' +
      '</div>' +
      blocked.map(function (b) {
        return '<div class="da-bl" data-blocked="' + esc(b.clientId) + '">' +
          '<span class="da-av">' + esc(initials(b.name)) + '</span>' +
          '<span class="da-bn"><b>' + esc(b.name) + '</b><span>' +
            (b.hasAny ? 'Has some routes · missing the rest' : 'No crypto address at all') +
            ' · client since ' + dayStr(b.createdAt) + '</span></span>' +
          '<span class="da-chips">' + b.missing.map(function (m) {
            return '<span class="da-miss">' + esc(m.currency + (m.network === 'Bitcoin' ? '' : ' ' + m.network)) + '</span>';
          }).join('') + '</span>' +
          '<button type="button" class="mw-btn mw-btn-approve mw-btn-sm" data-assign-client="' + esc(b.clientId) + '">Assign</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  /* ---- strip ---------------------------------------------------------------------------- */
  function renderStrip() {
    var s = state.book.strip;
    var el = document.getElementById('da-strip');
    if (!el) return;
    function card(k, v, x, warn) {
      return '<div class="da-hc' + (warn ? ' is-warn' : '') + '"><div class="k">' + esc(k) + '</div>' +
        '<div class="v">' + v + '</div><div class="x">' + esc(x) + '</div></div>';
    }
    el.innerHTML =
      card('Addresses', s.addresses, 'across ' + s.networks + ' of ' + s.routeCount + ' routes', false) +
      card('Assigned', s.assigned, 'serving ' + s.servedClients + ' client' + (s.servedClients === 1 ? '' : 's'), false) +
      card('Acknowledged deposits', usd(s.received), s.depositCount + ' across all addresses', false) +
      (s.blockedClients
        ? card('Clients blocked', s.blockedClients, 'missing at least one route', true)
        : card('Retired', s.retired, s.retired ? 'history kept, never reassigned' : 'none', false));
  }

  /* ---- filter pills ---------------------------------------------------------------------- */
  function matchesFilter(a) {
    if (state.filter === 'all') return true;
    return a.status === state.filter;
  }
  function renderPills() {
    var el = document.getElementById('da-pills');
    if (!el) return;
    var defs = [['all', 'All'], ['assigned', 'Assigned'], ['available', 'Available'], ['retired', 'Retired']];
    el.innerHTML = defs.map(function (d) {
      var n = state.book.addresses.filter(function (a) { return d[0] === 'all' || a.status === d[0]; }).length;
      return '<button type="button" class="da-pill" data-filter="' + d[0] + '" aria-pressed="' +
        (state.filter === d[0] ? 'true' : 'false') + '">' + d[1] + ' <span class="n">' + n + '</span></button>';
    }).join('');
  }

  /* ---- the book -------------------------------------------------------------------------- */
  function whoCell(a) {
    if (a.status === 'retired') {
      return '<span class="da-who"><span class="ct" style="margin-left:0">' +
        (a.everClientCount ? 'Previously ' + a.everClientCount : 'Never assigned') + '</span></span>';
    }
    if (!a.clientCount) return '<span class="da-who"><span class="ct" style="margin-left:0">Unassigned</span></span>';
    return '<span class="da-who">' +
      a.clients.slice(0, 3).map(function (c) { return '<span class="da-st">' + esc(initials(c.name)) + '</span>'; }).join('') +
      '<span class="ct">' + a.clientCount + '</span></span>';
  }
  function recvCell(a) {
    if (!a.depositCount) return '<span class="da-recv r is-none">—<span>none</span></span>';
    return '<span class="da-recv r">' + usd(a.received) +
      '<span>' + a.depositCount + ' deposit' + (a.depositCount === 1 ? '' : 's') + '</span></span>';
  }
  function rowHTML(a, i) {
    return '<button type="button" class="da-ar' + (a.status === 'retired' ? ' is-retired' : '') + '" data-id="' + esc(a.id) + '">' +
      '<span class="idx">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="da-cell"><span class="da-addr">' + esc(a.address) + '</span>' +
        (a.label ? '<span class="da-lab">' + esc(a.label) + '</span>' : '') + '</span>' +
      whoCell(a) + recvCell(a) +
      '<span class="r da-status"><span class="da-stp s-' + esc(a.status) + '">' + esc(a.status) + '</span></span>' +
      '<span class="da-chev" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></span>' +
    '</button>';
  }
  function renderBook() {
    var el = document.getElementById('da-book');
    if (!el) return;
    var any = false;
    var html = state.book.groups.map(function (g) {
      var rows = g.addresses.filter(matchesFilter);
      if (rows.length) any = true;
      var head = '<div class="da-gh">' +
        '<span class="mk-wrap">' + coinMark(g.currency, 'xs') + '</span>' +
        '<b>' + esc(g.currencyName) + '</b>' +
        '<span class="da-net">' + esc(g.networkLabel) + '</span>' +
        '<span class="cnt">' + g.addressCount + ' address' + (g.addressCount === 1 ? '' : 'es') +
          ' · ' + g.clientCount + ' client' + (g.clientCount === 1 ? '' : 's') +
          ' · ' + usd(g.received) + ' received</span>' +
        '<button type="button" class="addb" data-add-route="' + esc(g.currency + '|' + g.network) + '">+ Add</button>' +
      '</div>';
      if (!rows.length) {
        return head + '<p class="da-gempty">' +
          (g.addressCount ? 'No ' + esc(state.filter) + ' address on this route.' : 'No address yet — a client cannot deposit ' + esc(g.currency) + ' on ' + esc(g.network) + ' until one is added.') +
        '</p>';
      }
      return head + rows.map(rowHTML).join('');
    }).join('');
    if (!any) html += '<p class="da-empty">No address matches this filter.</p>';
    el.innerHTML = html;
  }

  function renderSub() {
    var s = state.book.strip;
    var el = document.getElementById('da-sub');
    if (!el) return;
    el.textContent = s.addresses + ' address' + (s.addresses === 1 ? '' : 'es') + ' across ' +
      s.routeCount + ' routes · one address can serve several clients';
  }

  function renderAll() { renderSub(); renderBlocked(); renderStrip(); renderPills(); renderBook(); }

  /* ---- panel plumbing --------------------------------------------------------------------- */
  var scrim = document.getElementById('da-scrim');
  var panel = document.getElementById('da-panel');
  function openPanel(html) { panel.innerHTML = html; scrim.classList.add('is-open'); }
  function closePanel() { scrim.classList.remove('is-open'); panel.innerHTML = ''; }
  scrim.addEventListener('click', function (e) { if (e.target === scrim) closePanel(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && scrim.classList.contains('is-open')) closePanel(); });
  function byId(id) { return state.book.addresses.filter(function (a) { return a.id === id; })[0] || null; }
  function routeOf(a) {
    return state.book.groups.filter(function (g) { return g.currency === a.currency && g.network === a.network; })[0] || null;
  }
  function showErr(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-shown');
  }

  /* ---- detail panel — EMPHASIS SHAPED BY HOW MANY CLIENTS IT SERVES -----------------------
   * ★ A shared address and a single-client address are different objects to a PM. On a shared
   * one the first question is who is on it, because the chain alone will not say who sent what;
   * on a single-client one attribution is unambiguous, so the deposits themselves are what a PM
   * came to see. Leading with the wrong one buries the question that is actually open. */
  function clientsBlock(a) {
    if (!a.clientCount) {
      return '<p class="da-lbl">Clients</p><p style="font-size:12px;color:#475569">' +
        (a.status === 'retired'
          ? 'Retired. ' + (a.everClientCount ? 'It served ' + a.everClientCount + ' client' + (a.everClientCount === 1 ? '' : 's') + ' and keeps their history.' : 'It was never assigned.')
          : 'Nobody is assigned to this address yet.') + '</p>';
    }
    return '<p class="da-lbl">Serves ' + a.clientCount + ' client' + (a.clientCount === 1 ? '' : 's') + '</p>' +
      a.clients.map(function (c) {
        return '<div class="da-cl" data-holder="' + esc(c.clientId) + '">' +
          '<span class="da-av">' + esc(initials(c.name)) + '</span>' +
          '<span class="da-cb"><b>' + esc(c.name) + '</b><span>Assigned ' + dayStr(c.assignedAt) +
            (c.lastDepositAt ? ' · last deposit ' + dayStr(c.lastDepositAt) : ' · no deposits yet') + '</span></span>' +
          '<span class="da-cv">' + (c.received ? usd(c.received) : '—') + '</span>' +
          '<button type="button" class="mw-btn mw-btn-sm" data-remove="' + esc(c.assignmentId) + '">Remove</button>' +
        '</div>';
      }).join('');
  }
  function depositsBlock(a) {
    if (!a.depositCount) {
      return '<p class="da-lbl">Acknowledged deposits</p>' +
        '<p style="font-size:12px;color:#475569">None acknowledged on this address yet.</p>';
    }
    return '<p class="da-lbl">Acknowledged deposits · ' + usd(a.received) + ' across ' + a.depositCount + '</p>' +
      a.deposits.map(function (d) {
        return '<div class="da-dep">' +
          '<span class="da-dd"><b>' + esc(d.clientName) + '</b>' +
            (d.txHash ? '<span>' + esc(d.txHash) + '</span>' : '<span>no transaction hash given</span>') + '</span>' +
          '<span class="da-dv">' + usd(d.amount) + '</span>' +
          '<span class="da-dt">' + shortDay(d.at) + '</span>' +
        '</div>';
      }).join('') +
      (a.depositCount > a.deposits.length
        ? '<p class="da-hint">Showing the ' + a.deposits.length + ' most recent of ' + a.depositCount + '.</p>' : '');
  }

  function detailHTML(a) {
    var route = routeOf(a);
    var shared = a.clientCount > 1;
    var body = shared
      ? clientsBlock(a) + depositsBlock(a)
      : depositsBlock(a) + clientsBlock(a);

    // ★ BOTH panels carry the same honest note: the platform does not watch the chain.
    body += '<div class="da-note is-info">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
      '<p>Only deposits a client acknowledged through the platform are listed. Marketswave does not watch the chain, so anything sent without acknowledging it will not appear here.</p></div>';

    if (shared) {
      body += '<div class="da-note is-warn">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>Shared by ' + a.clientCount + ' clients, so the chain alone will not say who sent what. Reconcile by transaction hash where one was given, or by amount and timing.</p></div>';
    }
    if (a.status === 'retired') {
      body += '<div class="da-note is-warn" id="da-retired-note">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p><b>Retired ' + dayStr(a.retiredAt) + '.</b> Its history is kept and nothing is deleted, but it accepts no new assignment — funds already sent to it are unaffected.</p></div>';
    }

    var footer = '<div class="da-pf">' +
      (a.status === 'retired'
        ? '<button type="button" class="mw-btn mw-btn-sm" id="da-close">Close</button>'
        : '<button type="button" class="mw-btn mw-btn-admin mw-btn-sm" id="da-assign-open">Assign client</button>' +
          '<button type="button" class="mw-btn mw-btn-sm da-secondary" id="da-close">Close</button>') +
    '</div>';

    return '<div class="da-ph">' + coinMark(a.currency, 's') +
        '<div class="tx"><b id="da-panel-title">' + esc(route ? route.currencyName : a.currency) + ' · ' + esc(route ? route.networkLabel : a.network) + '</b>' +
        '<span>' + esc(a.address) + '</span></div>' +
        '<button type="button" class="mw-btn mw-btn-sm" id="da-copy">Copy</button>' +
      '</div>' +
      '<div class="da-pb">' + body + '<p class="da-err" id="da-panel-err"></p></div>' + footer;
  }

  function openDetail(id) {
    var a = byId(id);
    if (!a) return;
    openPanel(detailHTML(a));
    panel.dataset.addressId = id;
  }

  /* ---- assign ----------------------------------------------------------------------------- */
  function assignHTML(a, preselectClientId) {
    var route = routeOf(a);
    // A client already on THIS address cannot be added twice; one already on another address
    // for this route is refused server-side by the partial unique index, and the panel says so
    // rather than letting a PM discover it at submit time.
    var onThis = {};
    a.clients.forEach(function (c) { onThis[c.clientId] = true; });
    var taken = {};
    state.book.addresses.forEach(function (o) {
      if (o.currency !== a.currency || o.network !== a.network) return;
      o.clients.forEach(function (c) { if (!onThis[c.clientId]) taken[c.clientId] = o.address; });
    });
    var candidates = (state.book.blocked || []).concat([]);
    // Every active client, not only blocked ones — the blocked list is a subset.
    var seen = {};
    var all = [];
    state.book.blocked.forEach(function (b) { if (!seen[b.clientId]) { seen[b.clientId] = 1; all.push({ id: b.clientId, name: b.name }); } });
    state.book.addresses.forEach(function (o) {
      o.clients.forEach(function (c) { if (!seen[c.clientId]) { seen[c.clientId] = 1; all.push({ id: c.clientId, name: c.name }); } });
    });
    all.sort(function (x, y) { return String(x.name).localeCompare(String(y.name)); });

    var opts = all.map(function (c) {
      var why = onThis[c.id] ? ' — already on this address' : (taken[c.id] ? ' — already has another ' + a.currency + ' ' + a.network + ' address' : '');
      return '<option value="' + esc(c.id) + '"' + (onThis[c.id] || taken[c.id] ? ' disabled' : '') +
        (c.id === preselectClientId ? ' selected' : '') + '>' + esc(c.name) + esc(why) + '</option>';
    }).join('');

    return '<div class="da-ph">' + coinMark(a.currency, 's') +
        '<div class="tx"><b id="da-panel-title">Assign a client</b><span>' + esc(a.address) + '</span></div></div>' +
      '<div class="da-pb">' +
        '<div class="da-note is-info"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>They will see this address on Deploy Capital for ' + esc(route ? route.currencyName : a.currency) + ' on ' + esc(route ? route.networkLabel : a.network) + '. A client may hold one address per route.</p></div>' +
        '<div class="mw-fld mw-fld--static mw-fld--admin" style="margin-top:12px">' +
          '<select id="da-assign-client" class="mw-field mw-field-admin">' + opts + '</select>' +
          '<label for="da-assign-client">Client</label></div>' +
        '<p class="da-err" id="da-assign-err"></p>' +
      '</div>' +
      '<div class="da-pf">' +
        '<button type="button" class="mw-btn mw-btn-admin mw-btn-sm" id="da-assign-submit">Assign address</button>' +
        '<button type="button" class="mw-btn mw-btn-sm da-secondary" id="da-assign-cancel">Cancel</button>' +
      '</div>';
  }

  function submitAssign() {
    var a = byId(panel.dataset.addressId);
    if (!a) return;
    var clientId = val('da-assign-client');
    var err = document.getElementById('da-assign-err');
    if (err) err.classList.remove('is-shown');
    if (!clientId) { showErr('da-assign-err', 'Choose a client.'); return; }
    var btn = document.getElementById('da-assign-submit');
    D.withButtonBusy(btn, 'Assigning…', function () {
      return D.callFunction('assign-deposit-address', { addressId: a.id, clientId: clientId });
    }).then(function () {
      closePanel();
      toast('Address assigned. They can deposit ' + a.currency + ' now.');
      reload();
    }).catch(function (e) { showErr('da-assign-err', D.writeErrorMessage(e)); });
  }

  /* ---- remove an assignment ---------------------------------------------------------------
   * ★ THE RETIRE WARNING IS KEPT FROM THE PAGE THIS REPLACED. Removing the LAST client retires
   * the address — a server-side trigger owns that transition, and a PM who does not know it is
   * about to happen has lost an address they may have meant to reassign. */
  function removeHTML(a, holder) {
    var last = a.clientCount === 1;
    return '<div class="da-ph"><div class="tx"><b id="da-panel-title">Remove ' + esc(holder.name) + '</b>' +
      '<span>' + esc(a.address) + '</span></div></div>' +
      '<div class="da-pb">' +
        '<div class="da-note ' + (last ? 'is-warn' : 'is-info') + '" id="da-remove-warning">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="' + (last ? '#B45309' : '#475569') + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg><p>' +
          (last
            ? 'This is the last client on this address, so removing them RETIRES it. A retired address keeps its history and accepts no new assignment. ' +
              esc(holder.name) + ' will see an empty state on Deploy Capital until another address is assigned.'
            : esc(holder.name) + ' will see an empty state on Deploy Capital for this route until another address is assigned. The address stays with its other ' +
              (a.clientCount - 1) + ' client' + (a.clientCount - 1 === 1 ? '' : 's') + '.') +
          (holder.received ? ' Their ' + usd(holder.received) + ' of acknowledged deposits is kept either way.' : '') +
        '</p></div>' +
        '<p class="da-err" id="da-remove-err"></p>' +
      '</div>' +
      '<div class="da-pf">' +
        '<button type="button" class="mw-btn mw-btn-danger mw-btn-sm" id="da-remove-submit">' + (last ? 'Remove and retire' : 'Remove client') + '</button>' +
        '<button type="button" class="mw-btn mw-btn-sm da-secondary" id="da-remove-cancel">Cancel</button>' +
      '</div>';
  }

  function submitRemove() {
    var assignmentId = panel.dataset.assignmentId;
    var err = document.getElementById('da-remove-err');
    if (err) err.classList.remove('is-shown');
    var btn = document.getElementById('da-remove-submit');
    D.withButtonBusy(btn, 'Removing…', function () {
      return D.callFunction('remove-deposit-address-assignment', { assignmentId: assignmentId });
    }).then(function (res) {
      closePanel();
      // remove-deposit-address-assignment returns { assignment, addressStatus, addressRetired }.
      toast(res && res.addressRetired
        ? 'Removed. The address is retired — its history is kept.'
        : 'Client removed from the address.');
      reload();
    }).catch(function (e) { showErr('da-remove-err', D.writeErrorMessage(e)); });
  }

  /* ---- add an address ----------------------------------------------------------------------
   * ★ THE MOST VALUABLE CHECK ON THE PAGE. A wrong address loses every deposit sent to it, and
   * nothing recovers it. Two things guard against that, and they catch different mistakes:
   *   STRUCTURAL VALIDATION against the route's own address_format — catches a TRON address in
   *     an ERC-20 slot, a truncated paste, an 0x with a character missing. Live, per keystroke.
   *   THE READ-BACK — the address spelled out again on a second step before it is saved, which
   *     is the only defence against a well-formed address belonging to someone else. Nothing
   *     client-side can validate that; a human reading it against their wallet can.
   * Both were on the page this replaced, and both are kept. */
  var addRoute = null;

  function formatOf(currency, network) {
    var g = state.book.groups.filter(function (x) { return x.currency === currency && x.network === network; })[0];
    return g ? g.addressFormat : null;
  }

  /* A browser-side mirror of _shared/deposit-address-validation.ts. It exists to tell a PM
   * BEFORE they submit; the server runs the real check regardless and is the authority, which
   * the suite proves by driving a rejection through the real function. The two must agree —
   * this is the same small, deliberate duplication getHYSRate() once carried, and the rules are
   * simple enough that drift would be visible immediately. */
  function checkAddress(format, address) {
    if (!address) return 'Paste the address from the wallet that generated it.';
    if (address !== address.trim()) return 'The address has leading or trailing whitespace — paste it again.';
    if (/\s/.test(address)) return 'An address cannot contain spaces.';
    if (format === 'btc') {
      if (/^bc1/i.test(address)) {
        if (address !== address.toLowerCase() && address !== address.toUpperCase()) return 'A bech32 Bitcoin address must be all lower-case.';
        if (address.length !== 42 && address.length !== 62) return 'A bc1 address is 42 or 62 characters — this one is ' + address.length + '.';
        if (!/^[02-9ac-hj-np-z]+$/.test(address.slice(3).toLowerCase())) return 'Invalid characters for bech32.';
        return null;
      }
      if (/^[13]/.test(address)) {
        if (address.length < 26 || address.length > 35) return 'A legacy Bitcoin address is 26–35 characters.';
        if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return 'Invalid characters for a Bitcoin address.';
        return null;
      }
      return 'A Bitcoin address starts with bc1, 1, or 3. This one starts with "' + address.charAt(0) + '".';
    }
    if (format === 'evm') {
      if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return 'This is a TRON address — an ERC-20 address begins with 0x.';
      if (!/^0x/i.test(address)) return 'An ERC-20 address starts with 0x.';
      if (address.length !== 42) return 'An ERC-20 address is exactly 42 characters (0x + 40) — this one is ' + address.length + '.';
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return 'An ERC-20 address is hexadecimal after 0x.';
      return null;
    }
    if (format === 'tron') {
      if (/^0x/i.test(address)) return 'This is an Ethereum address — TRC-20 addresses begin with T.';
      if (!/^T/.test(address)) return 'A TRC-20 address starts with T.';
      if (address.length !== 34) return 'A TRC-20 address is exactly 34 characters — this one is ' + address.length + '.';
      if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return 'Invalid characters for a TRON address.';
      return null;
    }
    return 'Unknown address format for this route.';
  }

  function addHTML() {
    var groups = state.book.groups;
    var sel = addRoute || (groups[0] ? groups[0].currency + '|' + groups[0].network : '');
    var g = groups.filter(function (x) { return x.currency + '|' + x.network === sel; })[0] || groups[0];
    return '<div class="da-ph">' + coinMark(g ? g.currency : 'BTC', 's') +
        '<div class="tx"><b id="da-panel-title">New deposit address</b><span>Paste it from the wallet that generated it</span></div></div>' +
      '<div class="da-pb">' +
        '<div class="mw-fld mw-fld--static mw-fld--admin">' +
          '<select id="da-route" class="mw-field mw-field-admin">' +
            groups.map(function (x) {
              var v = x.currency + '|' + x.network;
              return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' +
                esc(x.currencyName + ' (' + x.currency + ') · ' + x.networkLabel) + '</option>';
            }).join('') +
          '</select><label for="da-route">Currency and network</label></div>' +
        '<div class="mw-fld mw-fld--admin" style="margin-top:12px">' +
          '<input type="text" id="da-address" class="mw-field mw-field-admin" autocomplete="off" spellcheck="false" placeholder=" " />' +
          '<label for="da-address">Address</label></div>' +
        '<p class="da-vmsg" id="da-vmsg"></p>' +
        '<p class="da-hint">Format only — we cannot confirm you control this wallet. Paste it, do not type it, and check it reads back correctly on the next step.</p>' +
        '<div class="mw-fld mw-fld--admin" style="margin-top:12px">' +
          '<input type="text" id="da-label" class="mw-field mw-field-admin" placeholder=" " />' +
          '<label for="da-label">Label — optional</label></div>' +
        '<p class="da-err" id="da-add-err"></p>' +
      '</div>' +
      '<div class="da-pf">' +
        '<button type="button" class="mw-btn mw-btn-admin mw-btn-sm" id="da-add-continue">Continue</button>' +
        '<button type="button" class="mw-btn mw-btn-sm da-secondary" id="da-add-cancel">Cancel</button>' +
      '</div>';
  }

  function addConfirmHTML(currency, network, address, label) {
    var g = state.book.groups.filter(function (x) { return x.currency === currency && x.network === network; })[0];
    return '<div class="da-ph">' + coinMark(currency, 's') +
        '<div class="tx"><b id="da-panel-title">Check it reads back correctly</b><span>' + esc(g ? g.currencyName + ' · ' + g.networkLabel : currency) + '</span></div></div>' +
      '<div class="da-pb">' +
        '<div class="da-note is-warn" id="da-readback-note">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
          '<p>Reads back as <b class="da-readback" id="da-readback">' + esc(address) + '</b> — confirm this matches your wallet exactly before saving. A wrong address loses every deposit sent to it, and nothing recovers them.</p></div>' +
        (label ? '<p class="da-hint">Label: ' + esc(label) + '</p>' : '') +
        '<p class="da-err" id="da-confirm-err"></p>' +
      '</div>' +
      '<div class="da-pf">' +
        '<button type="button" class="mw-btn mw-btn-admin mw-btn-sm" id="da-add-submit">Add address</button>' +
        '<button type="button" class="mw-btn mw-btn-sm da-secondary" id="da-add-back">Back</button>' +
      '</div>';
  }

  function renderValidation() {
    var msg = document.getElementById('da-vmsg');
    var field = document.getElementById('da-address');
    if (!msg || !field) return;
    var parts = (val('da-route') || '').split('|');
    var format = formatOf(parts[0], parts[1]);
    var address = field.value;
    if (!address) { msg.className = 'da-vmsg'; msg.textContent = ''; return; }
    var problem = checkAddress(format, address);
    if (problem) {
      msg.className = 'da-vmsg is-bad';
      msg.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' + esc(problem);
    } else {
      msg.className = 'da-vmsg is-ok';
      msg.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Valid format for ' + esc(parts[0] + ' on ' + parts[1]);
    }
  }

  function continueAdd() {
    var parts = (val('da-route') || '').split('|');
    var format = formatOf(parts[0], parts[1]);
    var address = val('da-address');
    var err = document.getElementById('da-add-err');
    if (err) err.classList.remove('is-shown');
    var problem = checkAddress(format, address);
    if (problem) { showErr('da-add-err', problem); return; }
    var label = (val('da-label') || '').trim();
    openPanel(addConfirmHTML(parts[0], parts[1], address, label));
    panel.dataset.addCurrency = parts[0];
    panel.dataset.addNetwork = parts[1];
    panel.dataset.addAddress = address;
    panel.dataset.addLabel = label;
  }

  function submitAdd() {
    var err = document.getElementById('da-confirm-err');
    if (err) err.classList.remove('is-shown');
    var btn = document.getElementById('da-add-submit');
    var payload = {
      currency: panel.dataset.addCurrency,
      network: panel.dataset.addNetwork,
      address: panel.dataset.addAddress
    };
    if (panel.dataset.addLabel) payload.label = panel.dataset.addLabel;
    D.withButtonBusy(btn, 'Adding…', function () {
      return D.callFunction('add-deposit-address', payload);
    }).then(function () {
      closePanel();
      toast(payload.currency + ' address added on ' + payload.network + '. Assign it to a client to make it usable.');
      reload();
    }).catch(function (e) { showErr('da-confirm-err', D.writeErrorMessage(e)); });
  }

  /* ---- delegated events --------------------------------------------------------------------- */
  document.getElementById('da-pills').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    renderPills();
    renderBook();
  });

  document.getElementById('da-blocked').addEventListener('click', function (e) {
    var b = e.target.closest('[data-assign-client]');
    if (!b) return;
    // Open the first address on the first route this client is missing — the fastest path from
    // "this client is blocked" to "this client can deposit".
    var clientId = b.dataset.assignClient;
    var blocked = state.book.blocked.filter(function (x) { return x.clientId === clientId; })[0];
    if (!blocked || !blocked.missing.length) return;
    var want = blocked.missing[0];
    var candidate = state.book.addresses.filter(function (a) {
      return a.currency === want.currency && a.network === want.network && a.status !== 'retired';
    })[0];
    if (!candidate) {
      toast('No ' + want.currency + ' address on ' + want.network + ' exists yet — add one first.', true);
      addRoute = want.currency + '|' + want.network;
      openPanel(addHTML());
      return;
    }
    openPanel(assignHTML(candidate, clientId));
    panel.dataset.addressId = candidate.id;
  });

  document.getElementById('da-book').addEventListener('click', function (e) {
    var addBtn = e.target.closest('[data-add-route]');
    if (addBtn) {
      addRoute = addBtn.dataset.addRoute;
      openPanel(addHTML());
      return;
    }
    var row = e.target.closest('[data-id]');
    if (row) openDetail(row.dataset.id);
  });

  document.getElementById('da-add-open').addEventListener('click', function () {
    addRoute = null;
    openPanel(addHTML());
  });

  panel.addEventListener('input', function (e) {
    if (e.target.id === 'da-address') renderValidation();
  });
  panel.addEventListener('change', function (e) {
    if (e.target.id === 'da-route') renderValidation();
  });

  panel.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#da-close') || t.closest('#da-add-cancel')) { closePanel(); return; }
    if (t.closest('#da-assign-cancel') || t.closest('#da-remove-cancel')) { openDetail(panel.dataset.addressId); return; }
    if (t.closest('#da-copy')) {
      var a0 = byId(panel.dataset.addressId);
      if (a0 && navigator.clipboard) navigator.clipboard.writeText(a0.address).then(function () { toast('Address copied.'); }, function () {});
      return;
    }
    if (t.closest('#da-assign-open')) {
      var a1 = byId(panel.dataset.addressId);
      if (a1) { var id1 = a1.id; openPanel(assignHTML(a1, null)); panel.dataset.addressId = id1; }
      return;
    }
    if (t.closest('#da-assign-submit')) { submitAssign(); return; }
    var rm = t.closest('[data-remove]');
    if (rm) {
      var a2 = byId(panel.dataset.addressId);
      if (!a2) return;
      var holder = a2.clients.filter(function (c) { return c.assignmentId === rm.dataset.remove; })[0];
      if (!holder) return;
      var id2 = a2.id;
      openPanel(removeHTML(a2, holder));
      panel.dataset.addressId = id2;
      panel.dataset.assignmentId = rm.dataset.remove;
      return;
    }
    if (t.closest('#da-remove-submit')) { submitRemove(); return; }
    if (t.closest('#da-add-continue')) { continueAdd(); return; }
    if (t.closest('#da-add-back')) { openPanel(addHTML()); return; }
    if (t.closest('#da-add-submit')) { submitAdd(); return; }
  });

  /* ---- load ---------------------------------------------------------------------------------- */
  var dataPromise = null;
  function load() {
    if (dataPromise) return dataPromise;
    dataPromise = D.callFunction('get-deposit-address-book').catch(function (e) { dataPromise = null; throw e; });
    return dataPromise;
  }
  function reload() { dataPromise = null; render(); }

  function render() {
    D.renderAsyncBundle(document.getElementById('da-book'), {
      skeletonHTML: '<div class="p-4 space-y-3">' +
        D.skeleton.lines(['w-full', 'w-full', 'w-5/6', 'w-full']) + '</div>',
      load: load,
      render: function (data) {
        state.book = data;
        renderAll();
      }
    });
  }

  render();
})();
