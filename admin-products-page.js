/* ★ PM tool revamp, part 6 (2026-09-16) — the product catalogue.
 *
 * ONE dense table over 331 products, a health strip that is also a filter set, and a detail
 * panel whose SHAPE depends on how the product is priced. Follows PM_TOOL_VOCABULARY.md.
 *
 * ★ EVERY READ THAT FEEDS A DISPLAY CHECKS ITS ERROR (register row 233's rule). On this page
 * an empty holder list and a failed holder query look identical, and "nobody holds this" is
 * the input to a retirement decision — so a swallowed error would hand a PM a false all-clear
 * on the most consequential action here. `get-product-catalog` throws rather than returning
 * partial data, and renderAsyncBundle paints a real error card with a retry.
 *
 * ★ THERE IS NO EXPORT CONTROL, and the mockup's was deliberately not carried over — the same
 * call row 208 made for the portfolio card. Nothing in this project generates a catalogue
 * export today, so the button would offer something that does not exist; and Documents &
 * Reporting owns getting data out of the platform, so a second, lesser export path in a
 * toolbar corner would compete with the real one.
 */
(function () {
  if (typeof MarketswaveData === 'undefined') return;
  MarketswaveData.useAdminClient();

  var D = MarketswaveData;
  var state = {
    products: [],
    strip: null,
    filter: 'all',
    health: null,          // one of livePriced|priceStale|quoteFailed|noLogo|noDocument
    search: '',
    sort: 'name',
    dir: 1,
    page: 1
  };
  var PAGE = 40;

  /* ---- formatting ------------------------------------------------------------------ */
  function usd(n) { return '$' + Math.round(Number(n)).toLocaleString('en-US'); }
  function usd2(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(n) { return (n >= 0 ? '+' : '−') + Math.abs(Number(n)).toFixed(2) + '%'; }
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
  function ageLabel(iso) {
    if (!iso) return 'awaiting refresh';
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    return Math.floor(hrs / 24) + ' days';
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }

  var CLASS_CLS = {
    'Stocks & ETFs': 'c-eq', 'Crypto': 'c-cr', 'Private Equity': 'c-pe',
    'Real Assets': 'c-ra', 'Unallocated / Cash': 'c-ca'
  };

  /* ---- flags ------------------------------------------------------------------------
   * The ADR substitution is recorded on the product's own extended description by the
   * catalogue seed ("US-listed NYSE ADR; the London listing (AZN.L) is not available on the
   * price feed") — 87 of the European names carry it. Read from there rather than inventing
   * a column: the note IS the record, and it already says which listing was substituted. */
  function isAdr(p) { return !!(p.extendedDescription && /US-listed/i.test(p.extendedDescription)); }

  function toast(msg, bad) {
    var el = document.getElementById('pr-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('bg-red-700', !!bad);
    el.classList.toggle('bg-slate-900', !bad);
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 4200);
  }

  /* ---- filtering --------------------------------------------------------------------- */
  function matchesFilter(p, filter) {
    if (filter === 'all') return p.status !== 'retired';
    if (filter === 'retired') return p.status === 'retired';
    if (filter === 'held') return p.holderCount > 0;
    if (filter === 'attention') return p.status !== 'retired' && (p.priceStale || p.priceStatus === 'quote_failed' || !p.logoUrl || (p.documentApplicable && !p.document));
    return p.status !== 'retired' && p.assetClass === filter;
  }
  function matchesHealth(p, health) {
    if (!health) return true;
    if (health === 'livePriced') return p.pricingModel === 'market' && p.priceStatus === 'ok' && !p.priceStale;
    if (health === 'priceStale') return p.priceStale;
    if (health === 'quoteFailed') return p.priceStatus === 'quote_failed';
    if (health === 'noLogo') return !p.logoUrl;
    if (health === 'noDocument') return p.documentApplicable && !p.document;
    return true;
  }
  function matchesSearch(p, q) {
    if (!q) return true;
    var s = q.trim().toLowerCase();
    return String(p.name).toLowerCase().indexOf(s) !== -1 ||
      (p.ticker ? String(p.ticker).toLowerCase().indexOf(s) !== -1 : false);
  }
  function visible() {
    var rows = state.products.filter(function (p) {
      return matchesFilter(p, state.filter) && matchesHealth(p, state.health) && matchesSearch(p, state.search);
    });
    var k = state.sort, d = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (k === 'price') { av = a.unitPrice; bv = b.unitPrice; }
      else if (k === 'change') { av = a.changePercent == null ? -Infinity : a.changePercent; bv = b.changePercent == null ? -Infinity : b.changePercent; }
      else if (k === 'holders') { av = a.heldValue; bv = b.heldValue; }
      else { return d * String(a.name).localeCompare(String(b.name)); }
      return d * (av - bv);
    });
    return rows;
  }

  /* ---- health strip ------------------------------------------------------------------ */
  function healthCard(key, label, value, sub, warn) {
    var on = state.health === key;
    return '<button type="button" class="pr-hc' + (warn ? ' is-warn' : '') + '" data-health="' + key + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="k">' + esc(label) + '</span>' +
      '<span class="v">' + value + '</span>' +
      '<span class="x">' + esc(sub) + '</span>' +
    '</button>';
  }
  function renderHealth() {
    var s = state.strip;
    var el = document.getElementById('pr-health');
    if (!s || !el) return;
    el.innerHTML =
      healthCard('livePriced', 'Live-priced', s.livePriced, 'within ' + s.staleAfterMinutes + ' min', false) +
      healthCard('priceStale', 'Price stale', s.priceStale, 'over ' + s.staleAfterMinutes + ' min old', s.priceStale > 0) +
      healthCard('quoteFailed', 'Quote failed', s.quoteFailed, s.quoteFailed ? 'last good price kept' : 'none flagged', s.quoteFailed > 0) +
      healthCard('noLogo', 'No logo', s.noLogo, 'monogram in use', s.noLogo > 0) +
      healthCard('noDocument', 'No fund document', s.noDocument, 'of ' + s.appraisalTotal + ' appraisal-valued', s.noDocument > 0);
  }

  function renderPills() {
    var el = document.getElementById('pr-pills');
    if (!el) return;
    var defs = [
      ['all', 'All'],
      ['Stocks & ETFs', 'Stocks & ETFs'],
      ['Crypto', 'Crypto'],
      ['Private Equity', 'Private Equity'],
      ['Real Assets', 'Real Assets'],
      ['held', 'Held'],
      ['attention', 'Needs attention'],
      ['retired', 'Retired']
    ];
    el.innerHTML = defs.map(function (d) {
      // The count is what this pill would actually show given the CURRENT search and health
      // card, not a static total — a count that ignores the other controls is a lie the
      // moment a PM types anything.
      var n = state.products.filter(function (p) {
        return matchesFilter(p, d[0]) && matchesHealth(p, state.health) && matchesSearch(p, state.search);
      }).length;
      return '<button type="button" class="pr-pill" data-filter="' + esc(d[0]) + '" aria-pressed="' + (state.filter === d[0] ? 'true' : 'false') + '">' +
        esc(d[1]) + ' <span class="n">' + n + '</span></button>';
    }).join('');
  }

  /* ---- table ------------------------------------------------------------------------- */
  function sourceCell(p) {
    if (p.priceStatus === 'quote_failed') return '<span class="pr-src s-fail"><i></i>Quote failed</span>';
    if (p.pricingModel === 'market') return '<span class="pr-src s-live"><i></i>Market</span>';
    if (p.pricingModel === 'appraisal') return '<span class="pr-src s-nav"><i></i>Appraisal</span>';
    if (p.pricingModel === 'fixed') return '<span class="pr-src s-par"><i></i>Par value</span>';
    return '<span class="pr-src s-par"><i></i>Simulated</span>';
  }
  function priceCell(p) {
    var sub, cls = '';
    if (p.priceStatus === 'quote_failed') { sub = 'last good ' + ageLabel(p.priceAsOf); cls = ' is-failed'; }
    else if (p.pricingModel === 'market') { sub = ageLabel(p.priceAsOf); if (p.priceStale) cls = ' is-stale'; }
    else if (p.pricingModel === 'appraisal') { sub = dayStr(p.lastTickDate); }
    else { sub = 'fixed'; }
    return '<div class="pr-px r pr-px-cell">' + usd2(p.unitPrice) + '<span class="' + cls.trim() + '">' + esc(sub) + '</span></div>';
  }
  function changeCell(p) {
    if (p.changePercent == null) return '<div class="pr-chg r pr-flat">—</div>';
    var tone = p.changePercent > 0 ? 'pr-up' : p.changePercent < 0 ? 'pr-dn' : 'pr-flat';
    return '<div class="pr-chg r ' + tone + '">' + pct(p.changePercent) + '</div>';
  }
  function holdersCell(p) {
    if (!p.holderCount) return '<div class="pr-hold r is-none"><b>—</b><span>none</span></div>';
    return '<div class="pr-hold r"><b>' + p.holderCount + '</b><span>' + usd(p.heldValue) + '</span></div>';
  }

  function rowHTML(p) {
    var flags = '';
    if (isAdr(p)) flags += '<span class="pr-flag f-adr">US listing</span>';
    if (!p.logoUrl) flags += '<span class="pr-flag f-mono">No logo</span>';
    if (p.status === 'retired') flags += '<span class="pr-flag f-ret">Retired</span>';
    var tail = p.status === 'retired' ? 'no new allocations' : 'Min ' + usd(p.minimumInvestment);

    return '<button type="button" class="pr-tr' + (p.status === 'retired' ? ' is-retired' : '') + '" data-id="' + esc(p.id) + '">' +
      '<span class="pr-mark">' + AssetMark.html({ name: p.name, ticker: p.ticker, logoUrl: p.logoUrl, size: 'xs' }) + '</span>' +
      '<span class="pr-nm"><b>' + esc(p.name) + '</b>' +
        '<span class="pr-meta">' + (p.ticker ? '<span class="pr-tk">' + esc(p.ticker) + '</span>' : '') + flags +
        '<span>' + esc(tail) + '</span></span></span>' +
      '<span class="pr-sub">' +
        '<span><span class="pr-cls ' + (CLASS_CLS[p.assetClass] || 'c-ca') + '">' + esc(p.assetClass) + '</span></span>' +
        changeCell(p) + holdersCell(p) + sourceCell(p) +
      '</span>' +
      priceCell(p) +
      '<span class="pr-chev" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></span>' +
    '</button>';
  }

  function sortBtn(key, label, right) {
    var on = state.sort === key;
    return '<span' + (right ? ' class="r"' : '') + '><button type="button" data-sort="' + key + '"' + (on ? ' class="is-sorted"' : '') + '>' +
      esc(label) + (on ? (state.dir === 1 ? ' ▴' : ' ▾') : '') + '</button></span>';
  }

  function renderTable() {
    var el = document.getElementById('pr-table');
    if (!el) return;
    var rows = visible();
    var shown = rows.slice(0, state.page * PAGE);

    var head = '<div class="pr-th"><span></span>' + sortBtn('name', 'Product') +
      '<span>Class</span>' + sortBtn('price', 'Price', true) + sortBtn('change', '24h', true) +
      sortBtn('holders', 'Holders', true) + '<span>Source</span><span></span></div>';

    if (!rows.length) {
      el.innerHTML = head + '<p class="pr-empty">No product matches this search and filter.</p>';
      return;
    }

    el.innerHTML = head + shown.map(rowHTML).join('') +
      (shown.length < rows.length
        ? '<div class="pr-more"><button type="button" id="pr-more" class="mw-btn mw-btn-sm">Continue browsing</button>' +
          '<span class="cnt">Showing ' + shown.length + ' of ' + rows.length + '</span></div>'
        : '<div class="pr-more"><span class="cnt">Showing all ' + rows.length + '</span></div>');
  }

  function renderSub() {
    var s = state.strip;
    var el = document.getElementById('pr-sub');
    if (!s || !el) return;
    var by = {};
    state.products.forEach(function (p) { by[p.assetClass] = (by[p.assetClass] || 0) + 1; });
    var parts = [s.total + ' in the catalogue'];
    ['Stocks & ETFs', 'Crypto', 'Private Equity', 'Real Assets'].forEach(function (c) {
      if (by[c]) parts.push(by[c] + ' ' + c.toLowerCase());
    });
    if (s.retired) parts.push(s.retired + ' retired');
    el.textContent = parts.join(' · ');
  }

  function renderAll() { renderSub(); renderHealth(); renderPills(); renderTable(); }

  /* ---- panel plumbing ---------------------------------------------------------------- */
  var scrim = document.getElementById('pr-scrim');
  var panel = document.getElementById('pr-panel');
  function openPanel(html) {
    panel.innerHTML = html;
    scrim.classList.remove('hidden');
  }
  function closePanel() { scrim.classList.add('hidden'); panel.innerHTML = ''; }
  scrim.addEventListener('click', function (e) { if (e.target === scrim) closePanel(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !scrim.classList.contains('hidden')) closePanel(); });

  function byId(id) { return state.products.filter(function (p) { return p.id === id; })[0] || null; }

  /* ---- detail panel — SHAPED BY PRICING MODEL ----------------------------------------
   * A market-priced product and an appraisal-valued one are genuinely different objects to a
   * PM: one's price is the market's and its only question is whether the feed is healthy;
   * the other's price is the firm's own and its questions are when it was last valued and
   * whether its fund document is written. Rendering one shape for both would put a dead
   * "publish valuation" next to a tracker and hide the overdue valuation that matters. */
  function holdersBlock(p) {
    if (!p.holderCount) {
      return '<p class="pr-sect">Holders</p><p style="font-size:12px;color:#475569">Nobody currently holds this product.</p>';
    }
    return '<p class="pr-sect">Held by ' + p.holderCount + ' client' + (p.holderCount === 1 ? '' : 's') + ' · ' + usd(p.heldValue) + '</p>' +
      p.holders.slice(0, 8).map(function (h) {
        return '<div class="pr-holder" data-holder="' + esc(h.clientId) + '">' +
          '<span class="pr-av">' + esc(initials(h.name)) + '</span>' +
          '<span class="hb">' + esc(h.name) + '</span>' +
          '<span class="hu">' + esc(formatUnits(h.units, p.assetClass)) + ' units</span>' +
          '<span class="hv">' + usd(h.value) + '</span>' +
        '</div>';
      }).join('') +
      (p.holders.length > 8 ? '<p class="pr-hint">and ' + (p.holders.length - 8) + ' more</p>' : '');
  }

  function docBlock(p) {
    if (!p.documentApplicable) return '';
    var d = p.document;
    var cls = !d ? 'd-none' : d.status === 'published' ? 'd-pub' : 'd-draft';
    var label = !d ? 'No fund document yet' : d.status === 'published' ? 'Fund document published' : 'Fund document in draft';
    var sub = !d
      ? 'Clients see the short description until one is written'
      : d.status === 'published' ? 'Published ' + dayStr(d.publishedAt) : 'Not visible to clients';
    return '<div class="pr-doc ' + cls + '" id="pr-doc">' +
      '<div class="db"><b>' + esc(label) + '</b><span>' + esc(sub) + '</span></div>' +
      '<a class="mw-btn mw-btn-sm" id="pr-doc-link" href="admin-fund-document.html?product=' + encodeURIComponent(p.id) + '">' +
      (d ? 'Edit document' : 'Write document') + '</a>' +
    '</div>';
  }

  function detailHTML(p) {
    var isMarket = p.pricingModel === 'market';
    var isAppraisal = p.pricingModel === 'appraisal';
    var body = '';

    body += '<div class="pr-kv"><span class="k">Unit price</span><span class="v">' + usd2(p.unitPrice) +
      (isMarket ? ' <em>· ' + esc(ageLabel(p.priceAsOf)) + '</em>' : '') + '</span></div>';

    if (isMarket) {
      body += '<div class="pr-kv"><span class="k">Pricing</span><span class="v">Market · ' + (p.priceSource === 'coingecko' ? 'CoinGecko' : 'Finnhub') + ' · ' + esc(p.ticker || '') + '</span></div>';
    } else if (isAppraisal) {
      var days = Math.floor((Date.now() - new Date(p.lastTickDate + 'T00:00:00Z').getTime()) / 86400000);
      body += '<div class="pr-kv"><span class="k">Last valued</span><span class="v' + (days > 120 ? ' is-overdue' : '') + '">' + dayStr(p.lastTickDate) + ' <em>· ' + days + ' days ago</em></span></div>';
      body += '<div class="pr-kv"><span class="k">Pricing</span><span class="v">Valued by appraisal</span></div>';
    } else {
      body += '<div class="pr-kv"><span class="k">Pricing</span><span class="v">' + (p.pricingModel === 'fixed' ? 'Fixed at par' : 'Simulated tick (legacy)') + '</span></div>';
    }

    body += '<div class="pr-kv"><span class="k">Minimum</span><span class="v">' + usd(p.minimumInvestment) + '</span></div>';
    if (p.maximumInvestment != null) body += '<div class="pr-kv"><span class="k">Maximum</span><span class="v">' + usd(p.maximumInvestment) + '</span></div>';
    body += '<div class="pr-kv"><span class="k">Created</span><span class="v">' + dayStr(p.createdAt) + '</span></div>';

    if (p.priceStatus === 'quote_failed') {
      body += '<div class="pr-note is-bad"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9F1239" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>Quote failed — the last good price is retained, not overwritten with a zero. ' + esc(p.priceFailureReason || 'The provider returned no usable price on the last refresh.') + '</p></div>';
    } else if (p.priceStale) {
      body += '<div class="pr-note is-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>This price is older than the refresh rotation’s own worst case (' + state.strip.staleAfterMinutes + ' minutes), so it has missed a turn rather than simply waiting for one.</p></div>';
    }

    body += holdersBlock(p);

    if (isAppraisal) {
      body += '<div class="pr-two" style="margin-top:12px">' +
        '<div class="mw-fld mw-fld--admin"><input type="number" id="pr-nav-pct" class="mw-field mw-field-admin" step="0.01" placeholder="4.2" /><label for="pr-nav-pct">Publish valuation — change (%)</label></div>' +
        '<div class="mw-fld mw-fld--static mw-fld--admin"><input type="date" id="pr-nav-date" class="mw-field mw-field-admin" /><label for="pr-nav-date">Effective date</label></div>' +
      '</div>' +
      '<div class="mw-fld mw-fld--admin" style="margin-top:10px"><textarea id="pr-nav-note" rows="2" class="mw-field mw-field-admin" placeholder="Q2 2026 appraisal"></textarea><label for="pr-nav-note">Rationale (recorded with the publication)</label></div>' +
      '<div class="pr-impact" id="pr-impact" hidden><div class="pr-impact-h" id="pr-impact-h">What this changes</div><div id="pr-impact-body"></div></div>';
    }

    body += docBlock(p);

    if (p.status === 'retired') {
      body += '<div class="pr-note is-warn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p><b>Retired' + (p.retiredAt ? ' ' + dayStr(p.retiredAt) : '') + '.</b> ' +
        (p.retiredReason ? esc(p.retiredReason) + ' ' : '') +
        'It accepts no new allocation. ' + (p.holderCount ? 'The ' + p.holderCount + ' existing holder' + (p.holderCount === 1 ? '' : 's') + ' keep their position' + (p.holderCount === 1 ? '' : 's') + ' and can still sell.' : 'Nobody holds it.') + '</p></div>';
    } else {
      body += '<div class="pr-note is-warn" id="pr-retire-note"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>' +
        '<p>Retiring stops new allocations. ' +
        (p.holderCount
          ? 'The ' + p.holderCount + ' existing holder' + (p.holderCount === 1 ? '' : 's') + ' keep their position' + (p.holderCount === 1 ? '' : 's') + ' and can still sell.'
          : 'Nobody holds it today, so nothing changes for any client.') +
        ' Products are never deleted.</p></div>';
    }

    var footer = '<div class="pr-pf">' +
      '<button type="button" class="mw-btn mw-btn-sm mw-btn-danger pr-danger" id="pr-retire">' + (p.status === 'retired' ? 'Reinstate' : 'Retire') + '</button>' +
      (isAppraisal ? '<button type="button" class="mw-btn mw-btn-sm mw-btn-admin" id="pr-publish">Publish valuation</button>' : '') +
      '<button type="button" class="mw-btn mw-btn-sm" id="pr-close">Close</button>' +
    '</div>';

    return '<div class="pr-ph">' + AssetMark.html({ name: p.name, ticker: p.ticker, logoUrl: p.logoUrl, size: 's' }) +
        '<div class="tx"><b id="pr-panel-title">' + esc(p.name) + '</b><span>' + esc([p.ticker, p.assetClass, p.id].filter(Boolean).join(' · ')) + '</span></div>' +
      '</div>' +
      '<div class="pr-pb" id="pr-pb">' + body + '<p class="pr-err hidden" id="pr-panel-err"></p></div>' + footer;
  }

  function openDetail(id) {
    var p = byId(id);
    if (!p) return;
    openPanel(detailHTML(p));
    panel.dataset.productId = id;
    var dateEl = document.getElementById('pr-nav-date');
    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
    if (p.pricingModel === 'appraisal') renderImpact(p);
  }

  /* ---- publish valuation: the impact table, built from the SAME holders the catalogue
   * already returned. No second read, so the preview and the row can never disagree. */
  function renderImpact(p) {
    var box = document.getElementById('pr-impact');
    var body = document.getElementById('pr-impact-body');
    var head = document.getElementById('pr-impact-h');
    if (!box || !body) return;
    var raw = document.getElementById('pr-nav-pct');
    var v = raw ? parseFloat(raw.value) : NaN;
    if (!isFinite(v) || v <= -100) { box.hidden = true; return; }
    box.hidden = false;
    var next = Math.round(p.unitPrice * (1 + v / 100) * 100) / 100;
    head.textContent = 'New unit price ' + usd2(next) + ' · ' + (p.holderCount === 1 ? '1 client holding' : p.holderCount + ' clients holding');
    if (!p.holderCount) {
      body.innerHTML = '<p style="padding:10px 12px;font-size:12px;color:#475569">No client holds this product. Publishing changes the unit price only.</p>';
      return;
    }
    var total = 0;
    body.innerHTML = p.holders.map(function (h) {
      var to = Math.round(h.units * next * 100) / 100;
      var delta = Math.round((to - h.value) * 100) / 100;
      total += delta;
      return '<div class="pr-impact-row"><span class="nm">' + esc(h.name) + '</span>' +
        '<span class="fr">' + usd(h.value) + '</span>' +
        '<span class="to">' + usd(to) + '</span>' +
        '<span class="dl ' + (delta < 0 ? 'pr-dn' : 'pr-up') + '">' + (delta < 0 ? '−' : '+') + usd(Math.abs(delta)) + '</span></div>';
    }).join('') +
      '<div class="pr-impact-total"><span>Total across all holders</span>' +
      '<span class="dl ' + (total < 0 ? 'pr-dn' : 'pr-up') + '">' + (total < 0 ? '−' : '+') + usd(Math.abs(total)) + '</span></div>';
  }

  /* ---- retire / reinstate ------------------------------------------------------------- */
  function retireHTML(p, retiring) {
    return '<div class="pr-ph"><div class="tx"><b id="pr-panel-title">' + (retiring ? 'Retire ' : 'Reinstate ') + esc(p.name) + '</b>' +
      '<span>' + esc(p.id) + '</span></div></div>' +
      '<div class="pr-pb">' +
        '<div class="pr-note ' + (retiring ? 'is-warn' : 'is-info') + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="' + (retiring ? '#B45309' : '#0369A1') + '" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg><p>' +
          (retiring
            ? 'The product stays in the catalogue and keeps being priced. ' +
              (p.holderCount ? 'Its ' + p.holderCount + ' holder' + (p.holderCount === 1 ? '' : 's') + ' keep their position' + (p.holderCount === 1 ? '' : 's') + ' and can still sell. ' : '') +
              'It accepts no new allocation — a client cannot request one, and a request already pending cannot be approved into it. Nothing is deleted.'
            : 'The product becomes available for new allocations again. Its holders and its price are unaffected either way.') +
        '</p></div>' +
        '<div class="mw-fld mw-fld--admin" style="margin-top:12px"><textarea id="pr-retire-reason" rows="3" class="mw-field mw-field-admin" placeholder="Why?"></textarea><label for="pr-retire-reason">Reason (required)</label></div>' +
        '<p class="pr-err hidden" id="pr-retire-err"></p>' +
      '</div>' +
      '<div class="pr-pf">' +
        '<button type="button" class="mw-btn mw-btn-sm ' + (retiring ? 'mw-btn-danger' : 'mw-btn-admin') + '" id="pr-retire-submit">' + (retiring ? 'Retire product' : 'Reinstate product') + '</button>' +
        '<button type="button" class="mw-btn mw-btn-sm" id="pr-retire-cancel">Cancel</button>' +
      '</div>';
  }

  /* ---- create ------------------------------------------------------------------------- */
  var addModel = 'market';
  var addPick = null;
  var addSeq = 0;
  var addTimer = null;

  function createHTML() {
    var market = addModel === 'market';
    return '<div class="pr-ph"><div class="tx"><b id="pr-panel-title">New product</b>' +
        '<span>Choose how it is priced. This cannot be changed later.</span></div></div>' +
      '<div class="pr-seg" role="radiogroup" aria-label="Pricing model">' +
        '<button type="button" data-model="market" role="radio" aria-checked="' + (market ? 'true' : 'false') + '"><b>Market-priced</b><span>Tracks a real symbol</span></button>' +
        '<button type="button" data-model="appraisal" role="radio" aria-checked="' + (!market ? 'true' : 'false') + '"><b>Appraisal-valued</b><span>You publish the price</span></button>' +
      '</div>' +
      '<p class="pr-lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        'Permanent once created — it determines how the product behaves everywhere.</p>' +
      '<div class="pr-pb">' + (market ? marketFormHTML() : appraisalFormHTML()) +
        '<p class="pr-err hidden" id="pr-create-err"></p></div>' +
      '<div class="pr-pf">' +
        '<button type="button" class="mw-btn mw-btn-sm mw-btn-admin" id="pr-create-submit">' + (market ? 'Create product' : 'Create &amp; write document') + '</button>' +
        '<button type="button" class="mw-btn mw-btn-sm" id="pr-create-cancel">Cancel</button>' +
      '</div>';
  }

  function marketFormHTML() {
    return '<div class="mw-fld mw-fld--admin"><input type="text" id="pr-symbol" class="mw-field mw-field-admin" placeholder="e.g. TSLA, BTC" autocomplete="off" spellcheck="false" /><label for="pr-symbol">Search symbol</label></div>' +
      '<div id="pr-results" class="pr-results" hidden></div>' +
      '<p class="pr-hint">Stocks and ETFs from Finnhub, coins from CoinGecko. Anything already in the catalogue is flagged and cannot be picked.</p>' +
      '<div class="pr-prev" id="pr-prev" hidden><span class="l" id="pr-prev-l"></span><span class="r" id="pr-prev-r"></span></div>' +
      '<div class="pr-two" style="margin-top:12px">' +
        '<div class="mw-fld mw-fld--admin"><input type="text" id="pr-name" class="mw-field mw-field-admin" placeholder="Tesla, Inc." /><label for="pr-name">Product name</label></div>' +
        '<div class="mw-fld mw-fld--admin"><input type="text" id="pr-class" class="mw-field mw-field-admin" readonly placeholder=" " /><label for="pr-class">Asset class — from the symbol</label></div>' +
      '</div>' +
      '<p class="pr-hint">The asset class is derived from the symbol’s provider and locked: Finnhub gives Stocks &amp; ETFs, CoinGecko gives Crypto. A remapped symbol would silently re-price every holder, which is why neither it nor the class can be edited afterwards.</p>' +
      commonFieldsHTML();
  }

  function appraisalFormHTML() {
    return '<div class="mw-fld mw-fld--admin"><input type="text" id="pr-name" class="mw-field mw-field-admin" placeholder="Baltic Infrastructure Partners II" /><label for="pr-name">Fund name</label></div>' +
      '<div class="pr-two" style="margin-top:10px">' +
        '<div class="mw-fld mw-fld--static mw-fld--admin"><select id="pr-class" class="mw-field mw-field-admin"><option value="Private Equity">Private Equity</option><option value="Real Assets">Real Assets</option></select><label for="pr-class">Asset class</label></div>' +
        '<div class="mw-fld mw-fld--admin"><input type="number" id="pr-unit-price" class="mw-field mw-field-admin" step="0.01" min="0.01" placeholder="500.00" /><label for="pr-unit-price">Opening unit price (USD)</label></div>' +
      '</div>' +
      '<p class="pr-hint">The opening valuation is dated today. A valuation effective as of an earlier date — a quarter-end appraisal published later — is published afterwards from the product itself, which takes its own effective date.</p>' +
      commonFieldsHTML() +
      '<div class="pr-doc d-none" style="margin-top:12px"><div class="db"><b>Fund document</b>' +
        '<span>Written after the fund exists. Valuation frequency and expected horizon live in its Terms section, not on the product — clients see the short description until it is published.</span></div></div>';
  }

  function commonFieldsHTML() {
    return '<div class="pr-two" style="margin-top:10px">' +
        '<div class="mw-fld mw-fld--admin"><input type="number" id="pr-min" class="mw-field mw-field-admin" step="1" min="0" placeholder="100" /><label for="pr-min">Minimum (USD)</label></div>' +
        '<div class="mw-fld mw-fld--admin"><input type="number" id="pr-max" class="mw-field mw-field-admin" step="1" min="0" placeholder="none" /><label for="pr-max">Maximum — optional</label></div>' +
      '</div>' +
      '<div class="pr-two" style="margin-top:10px">' +
        '<div class="mw-fld mw-fld--admin"><input type="text" id="pr-type" class="mw-field mw-field-admin" placeholder="ETF, Coin, Growth Fund" /><label for="pr-type">Investment type</label></div>' +
        '<div class="mw-fld mw-fld--static mw-fld--admin"><select id="pr-tier" class="mw-field mw-field-admin"><option value="conservative">Conservative</option><option value="balanced" selected>Balanced</option><option value="aggressive">Aggressive</option></select><label for="pr-tier">Risk tier</label></div>' +
      '</div>' +
      '<div class="mw-fld mw-fld--admin" style="margin-top:10px"><textarea id="pr-desc" rows="2" class="mw-field mw-field-admin" placeholder="One line shown on every client-facing card"></textarea><label for="pr-desc">Description</label></div>';
  }

  function openCreate() {
    addPick = null;
    openPanel(createHTML());
  }
  function reRenderCreate() {
    var keep = {
      name: val('pr-name'), min: val('pr-min'), max: val('pr-max'),
      type: val('pr-type'), desc: val('pr-desc')
    };
    openPanel(createHTML());
    setVal('pr-name', keep.name); setVal('pr-min', keep.min); setVal('pr-max', keep.max);
    setVal('pr-type', keep.type); setVal('pr-desc', keep.desc);
  }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function setVal(id, v) { var e = document.getElementById(id); if (e && v) e.value = v; }

  function renderResults(results, errors) {
    var box = document.getElementById('pr-results');
    if (!box) return;
    box.hidden = false;
    if (!results.length) {
      box.innerHTML = '<p style="padding:10px 12px;font-size:11.5px;color:#475569">No matches' + (errors && errors.length ? ' — ' + esc(errors.join(' ')) : '') + '.</p>';
      return;
    }
    box.innerHTML = results.map(function (r) {
      var picked = addPick && addPick.symbol === r.symbol && addPick.source === r.source;
      // ★ A symbol already in the catalogue is flagged AND disabled here — the duplicate is
      // caught at search time rather than after a PM has filled a whole form and add-product
      // returns a 409. The server still refuses it; this is the earlier, cheaper stop.
      return '<button type="button" class="pr-res" data-symbol="' + esc(r.symbol) + '" data-source="' + esc(r.source) + '" ' +
        'data-provider-id="' + esc(r.providerId || '') + '" data-name="' + esc(r.name) + '"' +
        (r.alreadyOffered ? ' disabled aria-disabled="true" title="Already in the catalogue"' : '') +
        ' aria-pressed="' + (picked ? 'true' : 'false') + '">' +
        '<span class="sy">' + esc(r.symbol) + '</span>' +
        '<span class="nm">' + esc(r.name) + '</span>' +
        (r.alreadyOffered ? '<span class="dupe">In catalogue</span>'
          : '<span class="px">' + (r.price != null ? usd2(r.price) : '—') + '</span>' +
            '<span class="ex">' + esc(r.exchange || '') + (r.exchangeVerified === false ? ' · unverified' : '') + '</span>') +
      '</button>';
    }).join('');
  }

  function runSearch(q) {
    var seq = ++addSeq;
    D.callFunction('lookup-product-symbol', { query: q }).then(function (res) {
      if (seq !== addSeq) return;
      renderResults(res.results || [], res.providerErrors || []);
    }).catch(function (err) {
      if (seq !== addSeq) return;
      var box = document.getElementById('pr-results');
      if (box) { box.hidden = false; box.innerHTML = '<p style="padding:10px 12px;font-size:11.5px;color:#B4402C">' + esc(D.writeErrorMessage(err)) + '</p>'; }
    });
  }

  /* ---- delegated events --------------------------------------------------------------- */
  document.getElementById('pr-health').addEventListener('click', function (e) {
    var b = e.target.closest('[data-health]');
    if (!b) return;
    state.health = state.health === b.dataset.health ? null : b.dataset.health;
    state.page = 1;
    renderAll();
  });

  document.getElementById('pr-pills').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    state.page = 1;
    renderAll();
  });

  document.getElementById('pr-search').addEventListener('input', function (e) {
    state.search = e.target.value;
    state.page = 1;
    renderPills();
    renderTable();
  });

  document.getElementById('pr-table').addEventListener('click', function (e) {
    var sortEl = e.target.closest('[data-sort]');
    if (sortEl) {
      var k = sortEl.dataset.sort;
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      state.page = 1;
      renderTable();
      return;
    }
    if (e.target.closest('#pr-more')) { state.page += 1; renderTable(); return; }
    var row = e.target.closest('[data-id]');
    if (row) openDetail(row.dataset.id);
  });

  document.getElementById('pr-add-open').addEventListener('click', openCreate);

  panel.addEventListener('input', function (e) {
    if (e.target.id === 'pr-nav-pct') {
      var p = byId(panel.dataset.productId);
      if (p) renderImpact(p);
    }
    if (e.target.id === 'pr-symbol') {
      var q = e.target.value.trim();
      clearTimeout(addTimer);
      addPick = null;
      var prev = document.getElementById('pr-prev');
      if (prev) prev.hidden = true;
      if (q.length < 1) { var box = document.getElementById('pr-results'); if (box) box.hidden = true; return; }
      addTimer = setTimeout(function () { runSearch(q); }, 400);
    }
  });

  panel.addEventListener('click', function (e) {
    var t = e.target;

    if (t.closest('#pr-close') || t.closest('#pr-retire-cancel') || t.closest('#pr-create-cancel')) { closePanel(); return; }

    var model = t.closest('[data-model]');
    if (model) { addModel = model.dataset.model; reRenderCreate(); return; }

    var res = t.closest('.pr-res');
    if (res && !res.disabled) { pickSymbol(res); return; }

    if (t.closest('#pr-retire')) {
      var p = byId(panel.dataset.productId);
      if (p) { var id = p.id; openPanel(retireHTML(p, p.status !== 'retired')); panel.dataset.productId = id; }
      return;
    }
    if (t.closest('#pr-retire-submit')) { submitRetire(); return; }
    if (t.closest('#pr-publish')) { submitPublish(); return; }
    if (t.closest('#pr-create-submit')) { submitCreate(); return; }
  });

  function pickSymbol(btn) {
    var pick = { symbol: btn.dataset.symbol, source: btn.dataset.source, providerId: btn.dataset.providerId || null, name: btn.dataset.name };
    var prev = document.getElementById('pr-prev');
    document.getElementById('pr-prev-l').textContent = 'Checking ' + pick.symbol + '…';
    document.getElementById('pr-prev-r').textContent = '';
    prev.hidden = false;
    D.callFunction('lookup-product-symbol', pick).then(function (res) {
      addPick = res;
      var nameEl = document.getElementById('pr-name');
      if (nameEl && !nameEl.value.trim()) nameEl.value = res.name;
      setVal('pr-class', res.assetClass);
      var cls = document.getElementById('pr-class');
      if (cls) cls.value = res.assetClass;
      document.getElementById('pr-prev-l').textContent =
        'Price will track ' + res.symbol + ' · refreshed by the 5-minute scheduler, in rotation · ' +
        (res.exchangeVerified ? res.exchange : res.exchange + ' (exchange unverified)');
      document.getElementById('pr-prev-r').textContent = usd2(res.price);
      Array.prototype.forEach.call(panel.querySelectorAll('.pr-res'), function (b) {
        b.setAttribute('aria-pressed', b.dataset.symbol === res.symbol && b.dataset.source === res.source ? 'true' : 'false');
      });
    }).catch(function (err) {
      addPick = null;
      document.getElementById('pr-prev-l').textContent = D.writeErrorMessage(err);
    });
  }

  function showErr(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function submitRetire() {
    var p = byId(panel.dataset.productId);
    if (!p) return;
    var retiring = p.status !== 'retired';
    var reason = (val('pr-retire-reason') || '').trim();
    var err = document.getElementById('pr-retire-err');
    if (err) err.classList.add('hidden');
    if (!reason) { showErr('pr-retire-err', 'A reason is required.'); return; }
    var btn = document.getElementById('pr-retire-submit');
    D.withButtonBusy(btn, retiring ? 'Retiring…' : 'Reinstating…', function () {
      return D.callFunction('retire-product', { productId: p.id, retired: retiring, reason: reason });
    }).then(function (res) {
      closePanel();
      toast(res.product.name + (retiring
        ? ' is retired. ' + (res.holderCount ? res.holderCount + ' holder' + (res.holderCount === 1 ? '' : 's') + ' keep their position and can still sell.' : 'Nobody held it.')
        : ' is available for new allocations again.'));
      reload();
    }).catch(function (e) { showErr('pr-retire-err', D.writeErrorMessage(e)); });
  }

  function submitPublish() {
    var p = byId(panel.dataset.productId);
    if (!p) return;
    var err = document.getElementById('pr-panel-err');
    if (err) err.classList.add('hidden');
    var v = parseFloat(val('pr-nav-pct'));
    if (!isFinite(v)) { showErr('pr-panel-err', 'Enter the change as a percentage.'); return; }
    var payload = { productId: p.id, changePercent: v, effectiveDate: val('pr-nav-date'), note: (val('pr-nav-note') || '').trim() };
    var btn = document.getElementById('pr-publish');
    D.withButtonBusy(btn, 'Publishing…', function () {
      return D.callFunction('publish-nav', payload);
    }).then(function (res) {
      closePanel();
      toast(res.product.name + ' is now valued at ' + usd2(res.product.unitPrice) + ' (' + (res.product.changePercent >= 0 ? '+' : '') + res.product.changePercent + '%) as of ' + dayStr(res.publication.effectiveDate) + '.');
      reload();
    }).catch(function (e) { showErr('pr-panel-err', D.writeErrorMessage(e)); });
  }

  function submitCreate() {
    var err = document.getElementById('pr-create-err');
    if (err) err.classList.add('hidden');
    var maxRaw = val('pr-max');
    var payload = {
      pricingModel: addModel,
      name: (val('pr-name') || '').trim(),
      investmentType: (val('pr-type') || '').trim(),
      riskTier: val('pr-tier'),
      minimumInvestment: parseFloat(val('pr-min')),
      description: (val('pr-desc') || '').trim()
    };
    if (maxRaw !== '') payload.maximumInvestment = parseFloat(maxRaw);
    if (addModel === 'market') {
      if (!addPick) { showErr('pr-create-err', 'Search for a symbol and pick one first.'); return; }
      payload.symbol = addPick.symbol;
      payload.source = addPick.source;
      payload.providerId = addPick.providerId;
      // assetClass is derived server-side from the symbol; never sent, never overridable.
    } else {
      payload.assetClass = val('pr-class');
      payload.unitPrice = parseFloat(val('pr-unit-price'));
    }
    var btn = document.getElementById('pr-create-submit');
    var wasAppraisal = addModel === 'appraisal';
    D.withButtonBusy(btn, 'Creating…', function () {
      return D.callFunction('add-product', payload);
    }).then(function (res) {
      closePanel();
      toast(res.name + ' (' + res.id + ') created.');
      // ★ The document is the deliberate SECOND act (row 200): the fund has to exist before
      // it can be documented, so this hands straight over to the authoring page rather than
      // pretending the two are one form.
      if (wasAppraisal) { window.location.href = 'admin-fund-document.html?product=' + encodeURIComponent(res.id); return; }
      reload();
    }).catch(function (e) { showErr('pr-create-err', D.writeErrorMessage(e)); });
  }

  /* ---- load --------------------------------------------------------------------------- */
  var dataPromise = null;
  function load() {
    if (dataPromise) return dataPromise;
    dataPromise = D.callFunction('get-product-catalog').catch(function (e) { dataPromise = null; throw e; });
    return dataPromise;
  }
  function reload() { dataPromise = null; render(true); }

  function render() {
    D.renderAsyncBundle(document.getElementById('pr-table'), {
      skeletonHTML: '<div class="p-4 space-y-3">' +
        D.skeleton.lines(['w-full', 'w-full', 'w-full', 'w-5/6', 'w-full', 'w-3/4']) + '</div>',
      load: load,
      render: function (data) {
        state.products = data.products || [];
        state.strip = data.strip || null;
        renderAll();
      }
    });
  }

  render();
})();
