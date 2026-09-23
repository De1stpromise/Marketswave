// article-render.js — turns an article's stored blocks into DOM (2026-09-23).
//
// ★ SHARED ON PURPOSE, like _shared/article-blocks.ts on the server: the Help Center is the
// first consumer, the blog is the second, and the PM tool's "Preview as a client" is the third.
// Nothing here says "help". Add a consumer, not a copy.
//
// ★ EVERY PIECE OF TEXT REACHES THE PAGE THROUGH createElement + textContent. innerHTML is never
// given stored content anywhere in this file. That is what makes a <script> typed into the
// editor render as eight literal characters rather than execute — the server already refuses to
// store anything that isn't a plain string in a `t` field (the allowlist in article-blocks.ts),
// and this is the other half of the same guarantee.
(function () {
  'use strict';

  function runsInto(runs, parent) {
    (runs || []).forEach(function (r) {
      if (!r || typeof r.t !== 'string' || r.t === '') return;
      var node = document.createTextNode(r.t);
      if (r.b) { var b = document.createElement('strong'); b.appendChild(node); node = b; }
      if (r.i) { var i = document.createElement('em'); i.appendChild(node); node = i; }
      parent.appendChild(node);
    });
  }

  function para(runs, cls) {
    var p = document.createElement('p');
    if (cls) p.className = cls;
    runsInto(runs, p);
    return p;
  }

  // A small inline icon, built as SVG nodes — no markup string, same discipline as the text.
  function icon(paths, stroke, size) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(size || 17)); svg.setAttribute('height', String(size || 17));
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', stroke); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    paths.forEach(function (d) {
      var el = document.createElementNS(NS, d.c ? 'circle' : 'path');
      if (d.c) { el.setAttribute('cx', d.c[0]); el.setAttribute('cy', d.c[1]); el.setAttribute('r', d.c[2]); }
      else el.setAttribute('d', d);
      svg.appendChild(el);
    });
    return svg;
  }

  var WARN_ICON = ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'];
  var TIP_ICON = [{ c: [12, 12, 9] }, 'M12 16v-4M12 8h.01'];

  function renderBlock(b, opts) {
    if (!b || typeof b.type !== 'string') return null;

    if (b.type === 'heading') {
      var h = document.createElement('h2');
      h.className = 'ha-h2';
      h.textContent = String(b.text || '');
      return h;
    }

    if (b.type === 'p') return para(b.runs, 'ha-p');

    if (b.type === 'steps') {
      var wrap = document.createElement('div');
      wrap.className = 'ha-steps';
      (b.steps || []).forEach(function (s, i) {
        var row = document.createElement('div'); row.className = 'ha-st';
        var n = document.createElement('span'); n.className = 'ha-stn';
        n.textContent = String(i + 1); n.setAttribute('aria-hidden', 'true');
        var body = document.createElement('div'); body.className = 'ha-stb';
        var t = document.createElement('b'); t.textContent = String((s && s.title) || '');
        body.appendChild(t);
        var sp = document.createElement('span'); runsInto(s && s.body, sp); body.appendChild(sp);
        row.appendChild(n); row.appendChild(body); wrap.appendChild(row);
      });
      return wrap;
    }

    if (b.type === 'warning') {
      var w = document.createElement('div'); w.className = 'ha-warn';
      w.appendChild(icon(WARN_ICON, '#B07908'));
      var wb = document.createElement('div'); wb.className = 'ha-wb';
      var wt = document.createElement('b'); wt.textContent = String(b.title || ''); wb.appendChild(wt);
      wb.appendChild(para(b.body));
      w.appendChild(wb);
      return w;
    }

    if (b.type === 'tip') {
      var tip = document.createElement('div'); tip.className = 'ha-tip';
      tip.appendChild(icon(TIP_ICON, '#5C6367', 16));
      tip.appendChild(para(b.body));
      return tip;
    }

    if (b.type === 'image') {
      var fig = document.createElement('figure'); fig.className = 'ha-fig';
      var img = document.createElement('img');
      img.src = (opts && opts.imageBase ? opts.imageBase : '') + String(b.path || '');
      img.alt = String(b.alt || '');          // required before publishing; never invented here
      img.loading = 'lazy';
      fig.appendChild(img);
      if (b.caption) {
        var cap = document.createElement('figcaption');
        cap.textContent = String(b.caption);
        fig.appendChild(cap);
      }
      return fig;
    }

    return null;   // an unknown type renders as nothing rather than guessing
  }

  /** blocks -> DocumentFragment. `opts.imageBase` prefixes stored image paths. */
  function renderArticle(blocks, opts) {
    var frag = document.createDocumentFragment();
    (Array.isArray(blocks) ? blocks : []).forEach(function (b) {
      var el = renderBlock(b, opts || {});
      if (el) frag.appendChild(el);
    });
    return frag;
  }

  /** Plain text of an article — used for the <noscript> fallback and meta descriptions. */
  function articleText(blocks) {
    var out = [];
    (Array.isArray(blocks) ? blocks : []).forEach(function (b) {
      if (!b) return;
      if (b.type === 'heading') out.push(String(b.text || ''));
      else if (b.type === 'p') out.push(runsText(b.runs));
      else if (b.type === 'tip') out.push(runsText(b.body));
      else if (b.type === 'warning') { out.push(String(b.title || '')); out.push(runsText(b.body)); }
      else if (b.type === 'steps') (b.steps || []).forEach(function (s) {
        out.push(String((s && s.title) || '')); out.push(runsText(s && s.body));
      });
    });
    return out.filter(Boolean).join(' ');
  }

  function runsText(runs) {
    return (runs || []).map(function (r) { return r && typeof r.t === 'string' ? r.t : ''; }).join('');
  }

  window.ArticleRender = {
    render: renderArticle,
    renderBlock: renderBlock,
    runsInto: runsInto,
    text: articleText,
  };
})();
