// help-topic-cards.js — the Help Center topic card, defined ONCE (2026-09-23).
//
// ★ WHY THIS FILE EXISTS. resources.html previews the Help Center's topics and help.html's own
// landing renders them for real. Two copies of a card is how this project ended up with
// formatUSD() in twelve files and an onboarding vocabulary that needs a byte-identical guard to
// stay honest — so the card, its icon set and its DOM helpers live here and both pages call in.
// A change to the card lands on both surfaces at once, or on neither.
//
// Plain globals on window, one <script> tag, no build step — the same convention
// format-helpers.js / asset-mark.js / dashboard-sidebar.js already use. Deliberately NOT an ES
// module: help.js is a classic script and would need a dynamic import to reach it, which would
// make a synchronous render path asynchronous for no gain.
//
// ★ THE CARD IS NEVER A LINK. Only the "All N articles →" affordance inside it is, and only when
// the topic genuinely has something published. A topic with nothing published renders the same
// card with "Articles coming soon." instead — never a link to a page that would be empty.
(function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function svg(paths, stroke, size, extra) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', String(size)); s.setAttribute('height', String(size));
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', stroke); s.setAttribute('stroke-width', (extra && extra.w) || '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    paths.forEach(function (d) {
      var e;
      if (typeof d === 'object') { e = document.createElementNS(NS, 'circle'); e.setAttribute('cx', d.c[0]); e.setAttribute('cy', d.c[1]); e.setAttribute('r', d.c[2]); }
      else { e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); }
      s.appendChild(e);
    });
    return s;
  }

  var ARROW = ['M5 12h14M13 6l6 6-6 6'];
  var CHEV = ['M9 18l6-6-6-6'];

  var TOPIC_ICONS = {
    'getting-to-know': [{ c: [12, 12, 9] }, 'M12 16v-4M12 8h.01'],
    'opening-account': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', { c: [9, 7, 4] }, 'M19 8v6M22 11h-6'],
    'adding-money': ['M12 5v14M5 12l7 7 7-7'],
    'investing': ['M3 3v18h18', 'M18.7 8 12 14.7l-3.5-3.5L3 16.4'],
    'savings': ['M3 11h18v11H3zM7 11V7a5 5 0 0 1 10 0v4'],
    'portfolio': ['M3 3h18v18H3zM3 9h18M9 21V9'],
    'documents': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
  };

  // The count phrase is ONE function so the preview and the landing can never word it
  // differently — "All 1 article →" on one page and "All 1 articles →" on the other is exactly
  // the kind of drift a shared card is here to prevent.
  function countLabel(n) {
    return 'All ' + n + (n === 1 ? ' article' : ' articles') + ' →';
  }

  /**
   * Render one topic card into `frag`.
   *   topic     — a help_topics row ({ id, name, blurb })
   *   inTopic   — that topic's PUBLISHED articles (from help_articles_public)
   *   showList  — list up to 3 article links inside the card (the landing does; the preview does not)
   *   articleHref — (slug) => string, only needed when showList is true
   */
  function topicCard(topic, inTopic, showList, articleHref) {
    var card = el('div', 'glass glass-lift hc-cat');
    var ci = el('span', 'hc-ci');
    ci.appendChild(svg(TOPIC_ICONS[topic.id] || ARROW, '#1B3A4B', 19, { w: '1.9' }));
    card.appendChild(ci);
    card.appendChild(el('h3', null, topic.name));
    card.appendChild(el('div', 'hc-d', topic.blurb || ''));

    if (showList) {
      // each topic card features AT MOST 3
      var featured = inTopic.filter(function (a) { return a.featured_on_topic; });
      var show = (featured.length ? featured : inTopic).slice(0, 3);
      if (show.length) {
        var ul = el('ul');
        show.forEach(function (a) {
          var li = el('li'); var link = el('a', null, a.title); link.href = articleHref(a.slug);
          li.appendChild(link); ul.appendChild(li);
        });
        card.appendChild(ul);
      }
    }

    if (inTopic.length) {
      var all = el('a', 'hc-all', countLabel(inTopic.length));
      all.href = 'help.html?topic=' + encodeURIComponent(topic.id);
      card.appendChild(all);
    } else {
      card.appendChild(el('div', 'hc-soon', 'Articles coming soon.'));
    }
    return card;
  }

  /**
   * Fill `container` with one card per topic.
   *   opts.topics   — help_topics rows, already ordered
   *   opts.articles — help_articles_public rows (PUBLISHED only, by construction)
   *   opts.exclude  — topic ids to leave out (the landing promotes getting-to-know to its own
   *                   hero block, so it passes ['getting-to-know']; the preview has no hero and
   *                   passes nothing, showing all seven)
   *   opts.showList / opts.articleHref — see topicCard above
   */
  function renderTopicCards(container, opts) {
    var exclude = opts.exclude || [];
    var articles = opts.articles || [];
    (opts.topics || [])
      .filter(function (t) { return exclude.indexOf(t.id) === -1; })
      .forEach(function (t) {
        var inTopic = articles.filter(function (a) { return a.topic_id === t.id; });
        container.appendChild(topicCard(t, inTopic, !!opts.showList, opts.articleHref));
      });
    return container;
  }

  window.HelpTopicCards = {
    el: el,
    svg: svg,
    ARROW: ARROW,
    CHEV: CHEV,
    TOPIC_ICONS: TOPIC_ICONS,
    countLabel: countLabel,
    topicCard: topicCard,
    renderTopicCards: renderTopicCards,
  };
})();
