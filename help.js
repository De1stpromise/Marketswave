// help.js — the public Help Center (2026-09-23).
//
// ★ ADDRESSING. Articles live in the database, and the site is static on GitHub Pages, which has
// no rewrite support — measured, not assumed: /help-center and /help-center?a=x both return 200,
// /help/depositing-crypto returns 404. A file per article would make every Publish a commit and
// a push, which is exactly what storing articles in the database exists to avoid, and a 404.html
// shim would serve the app for every unmatched path and turn the seven retired approval pages
// into soft 200s (row 256). So one page serves both views and the article is a query parameter:
//     /help                      the landing
//     /help?a=depositing-crypto  one article
//
// ★ THE ONLY PUBLIC READ IS help_articles_public — a view of PUBLISHED rows and pub_ columns
// only. The help_articles table itself has no anon grant, so a draft is unreachable from here by
// construction rather than by this file remembering to filter. See the migration header and
// Part 1 of verify-supabase-help-center.js, which fails if anyone ever opens that door.
//
// No Supabase SDK on this page: supabase-endpoint.js gives the project URL and anon key, and
// PostgREST is a plain fetch (row 174's precedent, the same one home-hero.js uses for the tape).
(function () {
  'use strict';

  var root = document.getElementById('hc-root');
  if (!root) return;

  var qs = new URLSearchParams(location.search);
  var slug = (qs.get('a') || '').trim();
  var state = { articles: [], topics: [], cfg: null };

  // ★ The DOM helpers, the icon set and the topic card itself live in help-topic-cards.js so
  // resources.html's Help Center preview renders the SAME card from the SAME source. Aliased
  // here so the rest of this file reads exactly as it did before the extraction.
  var HTC = window.HelpTopicCards;
  var el = HTC.el;
  var svg = HTC.svg;
  var ARROW = HTC.ARROW;
  var CHEV = HTC.CHEV;
  var TOPIC_ICONS = HTC.TOPIC_ICONS;

  function topicName(id) {
    var t = state.topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : '';
  }
  function bySlug(s) {
    return state.articles.filter(function (a) { return a.slug === s; })[0] || null;
  }
  function href(s) { return 'help.html?a=' + encodeURIComponent(s); }

  // ---------------------------------------------------------------- data
  function load() {
    return import('./supabase-endpoint.js').then(function (mod) {
      var cfg = mod.ACTIVE_CONFIG;
      state.cfg = cfg;
      var h = { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey };
      return Promise.all([
        fetch(cfg.url + '/rest/v1/help_topics?select=*&order=sort_order.asc', { headers: h }).then(okJson),
        fetch(cfg.url + '/rest/v1/help_articles_public?select=*&order=published_at.desc', { headers: h }).then(okJson),
      ]).then(function (r) {
        state.topics = r[0] || [];
        state.articles = r[1] || [];
      });
    });
  }
  function okJson(res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); }

  // ---------------------------------------------------------------- SEO
  // A static host cannot server-render, so the crawler gets these in its rendering pass. Google
  // honours JS-set title/description/canonical there; most others do not, which is why the
  // landing also renders a real <a href> to every published article — a crawlable link graph
  // costs nothing and does not depend on a sitemap.
  function meta(name, content, attr) {
    var sel = '[' + (attr || 'name') + '="' + name + '"]';
    var m = document.head.querySelector('meta' + sel);
    if (!m) { m = document.createElement('meta'); m.setAttribute(attr || 'name', name); document.head.appendChild(m); }
    m.setAttribute('content', content);
  }
  function canonical(url) {
    var l = document.head.querySelector('link[rel="canonical"]');
    if (!l) { l = document.createElement('link'); l.rel = 'canonical'; document.head.appendChild(l); }
    l.href = url;
  }
  function seoForArticle(a) {
    var desc = (a.lede || '').slice(0, 300);
    document.title = a.title + ' — Marketswave Help Center';
    meta('description', desc);
    meta('og:title', a.title, 'property');
    meta('og:description', desc, 'property');
    canonical(location.origin + '/help?a=' + encodeURIComponent(a.slug));
    var ld = document.getElementById('hc-ld');
    if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'hc-ld'; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [{
        '@type': 'Question', name: a.question || a.title,
        acceptedAnswer: { '@type': 'Answer', text: (a.lede || '') + ' ' + (window.ArticleRender ? window.ArticleRender.text(a.blocks) : '') },
      }],
    });
  }

  // ---------------------------------------------------------------- landing
  function renderLanding() {
    document.title = 'Help Center — Marketswave';
    meta('description', 'Answers to the questions clients actually ask, written around what you will see on screen.');
    canonical(location.origin + '/help');
    root.textContent = '';

    // hero
    var hero = el('div', 'hc-hero');
    var hw = el('div', 'hc-wrap');
    hw.appendChild(el('div', 'hc-eb', 'Help Center'));
    hw.appendChild(el('h1', null, 'How can we help?'));
    hw.appendChild(el('p', null, 'Answers to the questions clients actually ask, written around what you’ll see on screen.'));
    var sw = el('div', 'hc-search');
    sw.appendChild(svg([{ c: [11, 11, 7] }, 'm20 20-3.5-3.5'], '#6B7178', 18, { w: '2.2' }));
    var input = el('input');
    input.type = 'search'; input.id = 'hc-q';
    input.setAttribute('aria-label', 'Search the Help Center');
    input.placeholder = 'Search — try "pending deposit" or "minimum"';
    sw.appendChild(input);
    hw.appendChild(sw);

    var chips = el('div', 'hc-chips');
    state.articles.filter(function (a) { return a.in_most_asked; }).slice(0, 4).forEach(function (a) {
      var c = el('a', 'hc-chip', a.question || a.title);
      c.href = href(a.slug); chips.appendChild(c);
    });
    hw.appendChild(chips);
    hero.appendChild(hw); root.appendChild(hero);

    var wrap = el('div', 'hc-wrap');
    var results = el('div', 'hc-results glass glass-lift'); results.id = 'hc-results'; results.hidden = true;
    wrap.appendChild(results);
    var main = el('div'); main.id = 'hc-main';
    wrap.appendChild(main);
    root.appendChild(wrap);

    renderLandingBody(main);

    input.addEventListener('input', function () { runSearch(input.value, results, main); });
  }

  function renderLandingBody(main) {
    main.textContent = '';

    // "Getting to know Marketswave"
    var intro = el('div', 'glass glass-lift hc-intro');
    var ib = el('div', 'hc-ib');
    var k = el('div', 'hc-k');
    k.appendChild(svg([{ c: [12, 12, 9] }, 'M12 16v-4M12 8h.01'], 'currentColor', 14, { w: '2.2' }));
    k.appendChild(document.createTextNode('New here?'));
    ib.appendChild(k);
    ib.appendChild(el('h2', null, 'Getting to know Marketswave'));
    ib.appendChild(el('p', null, 'A managed account where a portfolio manager reviews every move. Start here to understand how it works, what you can invest in, and who looks after your money.'));
    intro.appendChild(ib);
    var ilist = el('div', 'hc-ilist');
    var intros = state.articles.filter(function (a) { return a.topic_id === 'getting-to-know'; }).slice(0, 5);
    if (intros.length) {
      intros.forEach(function (a) {
        var link = el('a'); link.href = href(a.slug);
        link.appendChild(svg(ARROW, 'currentColor', 14));
        link.appendChild(document.createTextNode(a.title));
        ilist.appendChild(link);
      });
    } else {
      ilist.appendChild(el('p', 'hc-soon', 'These introductions are being written.'));
    }
    intro.appendChild(ilist);
    main.appendChild(intro);

    // topic cards
    var sech = el('div', 'hc-sech');
    sech.appendChild(el('b', null, 'Browse by topic'));
    sech.appendChild(el('span', null, state.articles.length + (state.articles.length === 1 ? ' article' : ' articles')));
    main.appendChild(sech);

    var cats = el('div', 'hc-cats');
    // The card is rendered by the shared module (help-topic-cards.js) so resources.html's
    // preview cannot drift from it. getting-to-know is excluded here ONLY because it has its
    // own hero block above; the preview, which has no hero, shows all seven.
    HTC.renderTopicCards(cats, {
      topics: state.topics,
      articles: state.articles,
      exclude: ['getting-to-know'],
      showList: true,
      articleHref: href,
    });
    main.appendChild(cats);

    // most asked — at most 6
    var mostAsked = state.articles.filter(function (a) { return a.in_most_asked; }).slice(0, 6);
    if (mostAsked.length) {
      var h2 = el('div', 'hc-sech');
      h2.appendChild(el('b', null, 'Most asked'));
      h2.appendChild(el('span', null, 'the questions behind the articles'));
      main.appendChild(h2);
      var asked = el('div', 'glass glass-lift hc-asked');
      mostAsked.forEach(function (a) {
        var row = el('a', 'hc-aq'); row.href = href(a.slug);
        var qq = el('div', 'hc-qq');
        qq.appendChild(el('b', null, a.question || a.title));
        qq.appendChild(el('span', null, topicName(a.topic_id) + ' · ' + a.title));
        row.appendChild(qq);
        row.appendChild(svg(CHEV, 'currentColor', 16, { w: '2.2' }));
        asked.appendChild(row);
      });
      main.appendChild(asked);
    }

    main.appendChild(contactBand());
  }

  function runSearch(q, results, main) {
    q = (q || '').trim().toLowerCase();
    if (q.length < 2) { results.hidden = true; results.textContent = ''; main.hidden = false; return; }
    main.hidden = true; results.hidden = false; results.textContent = '';
    var hits = state.articles.filter(function (a) {
      return (a.title || '').toLowerCase().indexOf(q) !== -1 ||
        (a.question || '').toLowerCase().indexOf(q) !== -1 ||
        (a.lede || '').toLowerCase().indexOf(q) !== -1;
    });
    if (!hits.length) {
      var none = el('div', 'hc-empty');
      none.appendChild(document.createTextNode('Nothing matched “' + q + '”. Try a shorter phrase, or '));
      var a = el('a', null, 'ask us directly'); a.href = 'mailto:support@marketswave.net';
      none.appendChild(a); none.appendChild(document.createTextNode('.'));
      results.appendChild(none);
      return;
    }
    hits.forEach(function (a) {
      var row = el('a', 'hc-aq'); row.href = href(a.slug);
      var qq = el('div', 'hc-qq');
      qq.appendChild(el('b', null, a.title));
      qq.appendChild(el('span', null, topicName(a.topic_id) + (a.question ? ' · ' + a.question : '')));
      row.appendChild(qq);
      row.appendChild(svg(CHEV, 'currentColor', 16, { w: '2.2' }));
      results.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- "Still stuck?"
  // ★ A SIGNED-OUT VISITOR CANNOT OPEN A TICKET — request-support-ticket derives the client from
  // the caller's own verified JWT and 401s otherwise, and an anonymous user has no clients row.
  // What DOES work anonymously, verified in code rather than assumed: live chat (chat-widget.js
  // signs in anonymously and captures a name and email first, and the thread lands in the PM
  // inbox) and email to support@marketswave.net (receive-inbound-email is a real public webhook
  // that turns a cold email into a conversation). contact.html is deliberately NOT offered: its
  // form is action="#" with no fetch on the page at all, so it silently discards whatever is
  // typed into it.
  function signedIn() {
    try {
      if (sessionStorage.getItem('marketswave_authenticated_client_id')) return true;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^sb-.*-auth-token$/.test(k) && k.indexOf('admin') === -1) return true;
      }
    } catch (e) { /* private window: fall through to the signed-out card, which always works */ }
    return false;
  }

  function stillStuck(article) {
    var card = el('div', 'glass glass-lift hc-ask');
    var ab = el('div', 'hc-ab');
    ab.appendChild(el('b', null, 'Still stuck?'));
    var actions = el('div', 'hc-ask-actions');

    if (signedIn()) {
      ab.appendChild(el('span', null, 'Open a ticket and we’ll pick it up from here — we’ll know you were reading this article.'));
      var ask = el('a', 'btn btn-primary', 'Ask a question');
      ask.href = 'support.html' + (article ? '?article=' + encodeURIComponent(article.slug) : '');
      actions.appendChild(ask);
    } else {
      ab.appendChild(el('span', null, 'Start a chat and a portfolio manager will pick it up — you don’t need an account. You can email us instead, or call.'));
      var chat = el('button', 'btn btn-primary', 'Start a chat');
      chat.type = 'button';
      chat.addEventListener('click', function () {
        var mount = document.querySelector('#chat-widget-mount button, #chat-widget-mount [data-chat-open]');
        if (mount) mount.click();
        else location.href = 'mailto:support@marketswave.net';
      });
      actions.appendChild(chat);
      var mail = el('a', 'btn btn-outline', 'Email us');
      mail.href = 'mailto:support@marketswave.net';
      actions.appendChild(mail);
    }
    card.appendChild(ab); card.appendChild(actions);
    return card;
  }

  function contactBand() {
    var band = el('div', 'glass glass-lift hc-contact');
    var cb0 = el('div', 'hc-cb0');
    cb0.appendChild(el('b', null, 'Still need help?'));
    cb0.appendChild(el('span', null, 'If an article didn’t answer it, reach your portfolio manager directly.'));
    band.appendChild(cb0);

    var chat = el('button', 'hc-ch');
    chat.type = 'button';
    var ci1 = el('span', 'hc-ci'); ci1.style.background = 'rgba(22,129,95,.1)';
    ci1.appendChild(svg(['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'], '#137254', 16));
    chat.appendChild(ci1);
    chat.appendChild(el('b', null, 'Live chat'));
    chat.appendChild(el('span', null, 'A manager picks it up — no account needed'));
    chat.addEventListener('click', function () {
      var m = document.querySelector('#chat-widget-mount button, #chat-widget-mount [data-chat-open]');
      if (m) m.click(); else location.href = 'mailto:support@marketswave.net';
    });
    band.appendChild(chat);

    var mail = el('a', 'hc-ch'); mail.href = 'mailto:support@marketswave.net';
    var ci2 = el('span', 'hc-ci');
    ci2.appendChild(svg(['M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z'], '#1B3A4B', 16));
    mail.appendChild(ci2);
    mail.appendChild(el('b', null, 'Email us'));
    mail.appendChild(el('span', null, 'support@marketswave.net'));
    band.appendChild(mail);

    var call = el('a', 'hc-ch'); call.href = 'tel:+46766922906';
    var ci3 = el('span', 'hc-ci'); ci3.style.background = 'rgba(200,134,10,.11)';
    ci3.appendChild(svg(['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z'], '#B07908', 16));
    call.appendChild(ci3);
    call.appendChild(el('b', null, 'Call us'));
    call.appendChild(el('span', null, '+46 766 92 29 06 · Mon–Fri, 8am–8pm CET'));
    band.appendChild(call);
    return band;
  }

  // ---------------------------------------------------------------- article view
  function renderArticle(a) {
    seoForArticle(a);
    root.textContent = '';
    var wrap = el('div', 'hc-art-wrap');

    var crumb = el('div', 'hc-crumb');
    var home = el('a', null, 'Help Center'); home.href = 'help.html';
    crumb.appendChild(home);
    crumb.appendChild(el('span', null, '›'));
    var tname = topicName(a.topic_id);
    if (tname) {
      var tl = el('a', null, tname); tl.href = 'help.html?topic=' + encodeURIComponent(a.topic_id);
      crumb.appendChild(tl); crumb.appendChild(el('span', null, '›'));
    }
    crumb.appendChild(el('b', null, a.title));
    wrap.appendChild(crumb);

    var layout = el('div', 'hc-layout');

    // topic sidebar — every published article, grouped
    var side = el('nav', 'hc-side');
    side.setAttribute('aria-label', 'Help Center topics');
    state.topics.forEach(function (t) {
      var inTopic = state.articles.filter(function (x) { return x.topic_id === t.id; });
      if (!inTopic.length) return;
      var g = el('div', 'hc-scat');
      g.appendChild(el('b', null, t.name));
      inTopic.forEach(function (x) {
        var link = el('a', x.slug === a.slug ? 'is-on' : null, x.title);
        link.href = href(x.slug);
        if (x.slug === a.slug) link.setAttribute('aria-current', 'page');
        g.appendChild(link);
      });
      side.appendChild(g);
    });
    layout.appendChild(side);

    var col = el('div');
    var art = el('article', 'glass glass-lift hc-art');
    var tagrow = el('div', 'hc-tagrow');
    if (tname) tagrow.appendChild(el('span', 'hc-tag', tname));
    tagrow.appendChild(el('span', 'hc-rt', (a.reading_minutes || 1) + ' min read'));
    art.appendChild(tagrow);
    art.appendChild(el('h1', null, a.title));
    if (a.lede) art.appendChild(el('p', 'hc-lede', a.lede));
    art.appendChild(window.ArticleRender.render(a.blocks, { imageBase: imageBase() }));

    var rel = (a.related_slugs || []).map(bySlug).filter(Boolean);
    if (rel.length) {
      var rbox = el('div', 'hc-related');
      rbox.appendChild(el('b', null, 'Related'));
      rel.forEach(function (r) {
        var link = el('a', 'hc-rel'); link.href = href(r.slug);
        link.appendChild(svg(ARROW, 'currentColor', 14));
        link.appendChild(document.createTextNode(r.title));
        rbox.appendChild(link);
      });
      art.appendChild(rbox);
    }
    col.appendChild(art);
    col.appendChild(stillStuck(a));
    layout.appendChild(col);
    wrap.appendChild(layout);
    root.appendChild(wrap);
  }

  function imageBase() {
    return state.cfg ? state.cfg.url + '/storage/v1/object/public/help-images/' : '';
  }

  function renderTopic(id) {
    var t = state.topics.filter(function (x) { return x.id === id; })[0];
    document.title = (t ? t.name : 'Topic') + ' — Marketswave Help Center';
    root.textContent = '';
    var wrap = el('div', 'hc-art-wrap');
    var crumb = el('div', 'hc-crumb');
    var home = el('a', null, 'Help Center'); home.href = 'help.html';
    crumb.appendChild(home); crumb.appendChild(el('span', null, '›'));
    crumb.appendChild(el('b', null, t ? t.name : 'Topic'));
    wrap.appendChild(crumb);
    var box = el('div', 'glass glass-lift hc-asked');
    var inTopic = state.articles.filter(function (a) { return a.topic_id === id; });
    if (!inTopic.length) box.appendChild(el('div', 'hc-empty', 'No articles in this topic yet.'));
    inTopic.forEach(function (a) {
      var row = el('a', 'hc-aq'); row.href = href(a.slug);
      var qq = el('div', 'hc-qq');
      qq.appendChild(el('b', null, a.title));
      qq.appendChild(el('span', null, a.question || ''));
      row.appendChild(qq); row.appendChild(svg(CHEV, 'currentColor', 16, { w: '2.2' }));
      box.appendChild(row);
    });
    wrap.appendChild(box);
    root.appendChild(wrap);
  }

  function notFound() {
    document.title = 'Article not found — Marketswave Help Center';
    root.textContent = '';
    var wrap = el('div', 'hc-art-wrap');
    var box = el('div', 'glass glass-lift hc-art');
    box.appendChild(el('h1', null, 'We couldn’t find that article'));
    box.appendChild(el('p', 'hc-lede', 'It may have been renamed, or it may not be published yet.'));
    var back = el('a', 'btn btn-outline', 'Back to the Help Center');
    back.href = 'help.html';
    var row = el('p', 'ha-p'); row.appendChild(back);
    box.appendChild(row);
    wrap.appendChild(box);
    wrap.appendChild(stillStuck(null));
    root.appendChild(wrap);
  }

  function failed() {
    root.textContent = '';
    var wrap = el('div', 'hc-art-wrap');
    var box = el('div', 'glass glass-lift hc-art');
    box.appendChild(el('h1', null, 'The Help Center didn’t load'));
    box.appendChild(el('p', 'hc-lede', 'Something went wrong reaching our servers. You can try again, or reach us directly.'));
    var retry = el('button', 'btn btn-primary', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', function () { location.reload(); });
    var row = el('p', 'ha-p'); row.appendChild(retry);
    box.appendChild(row);
    wrap.appendChild(box); wrap.appendChild(stillStuck(null));
    root.appendChild(wrap);
  }

  root.appendChild(el('div', 'hc-loading', 'Loading the Help Center…'));
  load().then(function () {
    var topic = (qs.get('topic') || '').trim();
    if (slug) {
      var a = bySlug(slug);
      if (a) renderArticle(a); else notFound();
    } else if (topic) {
      renderTopic(topic);
    } else {
      renderLanding();
    }
  }).catch(function () { failed(); });
})();
