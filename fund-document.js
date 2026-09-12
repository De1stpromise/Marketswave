// fund-document.js — renders a fund document (2026-09-12). Shared by fund-document.html
// (what a client reads) and admin-fund-document.html's Preview (what a PM sees before
// publishing) — ONE renderer, so the preview IS the client render, not an approximation.
//
//   MarketswaveFundDocument.render(container, payload, options)
//     payload  — exactly what get-product-document returns: { product, document: { sections },
//                valuation: { points, count }, attachment }
//     options  — { storageBase }: the project URL to prepend to attachment.signedPath
//
// Every PM-authored string reaches the page through textContent (via rich-text.js's render()
// or createTextNode here). innerHTML is never given PM-authored content. The disclosure
// footer is EXISTING legal copy, verbatim — see DISCLOSURE_PARAGRAPHS.
//
// The Valuation history section is rendered only when the payload carries at least one
// point (a market-priced product carries none and the section is simply absent — see
// get-product-document's own header). With ONE point there is nothing to chart, so the
// section states the single valuation and its date; with two or more it charts them
// (Chart.js when loaded, the same library dashboard.html and transactions.html use; a
// plain table of the points otherwise, which is also what a screen reader gets).
(function () {
  'use strict';

  var RT = window.MarketswaveRichText;

  // Verbatim EXISTING disclosure copy, never new legal text:
  //   [0] the site footer's second condensed disclosure paragraph (index.html and the other
  //       seven marketing pages; paragraph 3 of the full text on legal.html#disclosures)
  //   [1] the alternative-investments risk paragraph every investment email carries
  //       (supabase/functions/_shared/send-email.ts, RISK_PARAGRAPH)
  // A verification asserts both are byte-identical to their sources.
  var DISCLOSURE_PARAGRAPHS = [
    'Private placement investments are NOT bank deposits (and thus NOT insured by the FDIC or by any other federal governmental agency), are NOT guaranteed by Marketswave or any other party, and MAY lose value. Neither the Securities and Exchange Commission nor any federal or state securities commission or regulatory authority has recommended or approved any investment or the accuracy or completeness of any of the information or materials provided by or through the website. Investors must be able to afford the loss of their entire investment.',
    'Alternative investments involve specific risks that may be greater than those associated with traditional investments; are not suitable for all clients; and intended for experienced and sophisticated investors who meet specific suitability requirements and are willing to bear the high economic risks of the investment. Investments of this type may engage in speculative investment practices; carry additional risk of loss, including possibility of partial or total loss of invested capital, due to the nature and volatility of the underlying investments; and are generally considered to be illiquid due to restrictive repurchase procedures. These investments may also involve different regulatory and reporting requirements, complex tax structures, and delays in distributing important tax information.'
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function formatUSD(n, decimals) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function formatDate(ymd) {
    if (!ymd) return '—';
    var d = new Date(String(ymd).slice(0, 10) + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function formatShortDate(ymd) {
    var d = new Date(String(ymd).slice(0, 10) + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  function formatAsOf(iso) {
    if (!iso) return 'awaiting refresh';
    var d = new Date(iso);
    var sameDay = d.toDateString() === new Date().toDateString();
    var time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return sameDay ? time : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ', ' + time;
  }
  function formatBytes(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function fileKind(contentType, name) {
    if (/pdf/i.test(contentType || '') || /\.pdf$/i.test(name || '')) return 'PDF';
    var m = (name || '').match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toUpperCase() : 'File';
  }

  function sectionEl(title) {
    var s = el('section', 'fd-section');
    s.appendChild(el('h2', null, title));
    return s;
  }
  function richInto(section, body) {
    section.appendChild(RT.render(body || { blocks: [] }));
  }

  function renderHero(product, terms) {
    var hero = el('div', 'fd-hero');
    hero.appendChild(el('div', 'fd-hero-tex'));
    hero.appendChild(el('div', 'fd-hero-glow'));
    var inner = el('div', 'fd-hero-inner');
    inner.appendChild(el('span', 'fd-class', product.assetClass));
    inner.appendChild(el('h1', null, product.name));
    var meta = el('div', 'fd-meta');
    function fig(label, value) {
      var d = el('div', null, label); d.appendChild(el('b', 'fd-fig', value)); meta.appendChild(d);
    }
    fig('Unit price', formatUSD(product.unitPrice, 2));
    if (product.pricingModel === 'market') fig('Price as of', formatAsOf(product.priceAsOf));
    else fig('Last valued', formatDate(product.lastTickDate));
    fig('Minimum', formatUSD(product.minimumInvestment, 0));
    fig('Horizon', terms && terms.horizon ? terms.horizon : '—');
    inner.appendChild(meta);
    hero.appendChild(inner);
    return hero;
  }

  function renderTerms(product, terms) {
    var s = sectionEl('Terms & liquidity');
    var grid = el('div', 'fd-terms');
    function cell(k, v) { var c = el('div'); c.appendChild(el('div', 'fd-term-k', k)); c.appendChild(el('div', 'fd-term-v', v || '—')); grid.appendChild(c); }
    cell('Minimum investment', formatUSD(product.minimumInvestment, 0));
    cell('Expected horizon', terms.horizon);
    cell('Valuation frequency', terms.valuationFrequency);
    cell('Fees', terms.fees);
    s.appendChild(grid);
    return s;
  }

  function renderValuation(valuation) {
    var points = (valuation && valuation.points) || [];
    if (!points.length) return null;
    var s = sectionEl('Valuation history');
    var box = el('div', 'fd-chart');
    var head = el('div', 'fd-chart-head');
    if (points.length === 1) {
      head.appendChild(el('span', 'fd-chart-a', 'One published valuation: ' + formatUSD(points[0].price, 2) + ' per unit, effective ' + formatDate(points[0].date) + '.'));
      box.appendChild(head);
      box.appendChild(el('p', 'fd-chart-note', 'A chart appears once a second valuation is published.'));
      s.appendChild(box);
      return s;
    }
    var first = points[0].price, last = points[points.length - 1].price;
    var pct = first > 0 ? ((last - first) / first) * 100 : 0;
    head.appendChild(el('span', 'fd-chart-a', 'Unit price since first valuation'));
    var b = el('span', 'fd-chart-b ' + (pct >= 0 ? 'is-gain' : 'is-loss'), (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '%');
    head.appendChild(b);
    box.appendChild(head);

    if (typeof window.Chart === 'function') {
      var wrap = el('div', 'fd-chart-canvas');
      var canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Unit price across ' + points.length + ' published valuations, from ' + formatUSD(first, 2) + ' on ' + formatDate(points[0].date) + ' to ' + formatUSD(last, 2) + ' on ' + formatDate(points[points.length - 1].date));
      wrap.appendChild(canvas);
      box.appendChild(wrap);
      s.appendChild(box);
      // Chart.js needs the canvas in the document for its layout; defer construction.
      setTimeout(function () {
        try {
          var ctx = canvas.getContext('2d');
          var fill = ctx.createLinearGradient(0, 0, 0, 160);
          fill.addColorStop(0, 'rgba(19,114,84,0.22)'); fill.addColorStop(1, 'rgba(19,114,84,0)');
          new window.Chart(ctx, {
            type: 'line',
            data: { labels: points.map(function (p) { return formatShortDate(p.date); }), datasets: [{ data: points.map(function (p) { return p.price; }), borderColor: '#137254', backgroundColor: fill, fill: true, tension: 0.15, borderWidth: 2, pointRadius: 3.5, pointBackgroundColor: '#fff', pointBorderColor: '#137254', pointBorderWidth: 2 }] },
            options: {
              responsive: true, maintainAspectRatio: false, animation: false,
              plugins: { legend: { display: false }, tooltip: { callbacks: { title: function (items) { return formatDate(points[items[0].dataIndex].date); }, label: function (item) { return formatUSD(item.parsed.y, 2) + ' per unit'; } } } },
              scales: {
                x: { grid: { display: false }, ticks: { color: '#5C6367', font: { family: 'Inter', size: 11 } } },
                y: { grid: { color: 'rgba(27,58,75,0.08)' }, ticks: { color: '#5C6367', font: { family: 'Inter', size: 11 }, callback: function (v) { return formatUSD(Number(v), 0); } } }
              }
            }
          });
        } catch (_e) { /* the table below is the fallback */ }
      }, 0);
    }
    // Always present: the points as a table — the fallback when Chart.js is not loaded, and
    // what assistive technology reads instead of a canvas.
    var table = el('table', 'fd-chart-table' + (typeof window.Chart === 'function' ? ' fd-visually-hidden' : ''));
    var thead = el('thead'); var hr = el('tr'); hr.appendChild(el('th', null, 'Effective date')); hr.appendChild(el('th', null, 'Unit price')); thead.appendChild(hr); table.appendChild(thead);
    var tbody = el('tbody');
    points.forEach(function (p) { var tr = el('tr'); tr.appendChild(el('td', null, formatDate(p.date))); tr.appendChild(el('td', 'fd-fig', formatUSD(p.price, 2))); tbody.appendChild(tr); });
    table.appendChild(tbody);
    box.appendChild(table);
    if (!s.contains(box)) s.appendChild(box);
    return s;
  }

  function renderRisks(body) {
    var s = sectionEl('Risks');
    var callout = el('div', 'fd-risk');
    richInto(callout, body);
    s.appendChild(callout);
    return s;
  }

  function renderDocuments(product, attachment, options) {
    if (!attachment) return null;
    var s = sectionEl('Documents');
    var row = el('div', 'fd-dl');
    var ic = el('div', 'fd-dl-ic'); ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8A5C07" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
    row.appendChild(ic);
    var nm = el('div', 'fd-dl-nm');
    nm.appendChild(el('b', null, attachment.name));
    nm.appendChild(el('span', null, fileKind(attachment.contentType, attachment.name) + (attachment.size ? ' · ' + formatBytes(attachment.size) : '')));
    row.appendChild(nm);
    var href = attachment.signedPath && options && options.storageBase ? options.storageBase + attachment.signedPath : (attachment.url || null);
    if (href) {
      var a = el('a', 'fd-dl-btn', 'Download');
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('download', attachment.name);
      row.appendChild(a);
    } else {
      row.appendChild(el('span', 'fd-dl-unavailable', 'Not available'));
    }
    s.appendChild(row);
    return s;
  }

  function renderFooter() {
    var f = el('div', 'fd-foot');
    DISCLOSURE_PARAGRAPHS.forEach(function (t) { f.appendChild(el('p', null, t)); });
    var more = el('p', 'fd-foot-more');
    var a = el('a', null, 'Full disclosures'); a.href = 'legal.html#disclosures';
    more.appendChild(a);
    f.appendChild(more);
    return f;
  }

  function render(container, payload, options) {
    while (container.firstChild) container.removeChild(container.firstChild);
    var product = payload.product;
    var sections = (payload.document && payload.document.sections) || [];
    var terms = sections.find(function (s) { return s.key === 'terms'; }) || { horizon: '', valuationFrequency: '', fees: '' };
    var docsSection = sections.find(function (s) { return s.key === 'documents'; });
    var attachment = payload.attachment || (docsSection && docsSection.attachment) || null;

    var doc = el('article', 'fd-doc');
    doc.appendChild(renderHero(product, terms));
    var body = el('div', 'fd-body');
    sections.forEach(function (sec) {
      var node = null;
      if (sec.key === 'overview') { node = sectionEl('Overview'); richInto(node, sec.body); }
      else if (sec.key === 'strategy') { node = sectionEl('Strategy'); richInto(node, sec.body); }
      else if (sec.key === 'terms') { node = renderTerms(product, sec); }
      else if (sec.key === 'valuation') { node = renderValuation(payload.valuation); }
      else if (sec.key === 'custom') { node = sectionEl(sec.heading); richInto(node, sec.body); }
      else if (sec.key === 'risks') { node = renderRisks(sec.body); }
      else if (sec.key === 'documents') { node = renderDocuments(product, attachment, options); }
      if (node) body.appendChild(node);
    });
    doc.appendChild(body);
    doc.appendChild(renderFooter());
    container.appendChild(doc);
    return doc;
  }

  window.MarketswaveFundDocument = { render: render, DISCLOSURE_PARAGRAPHS: DISCLOSURE_PARAGRAPHS, formatUSD: formatUSD, formatDate: formatDate };
})();
