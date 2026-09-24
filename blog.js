// blog.js — Blog & Press, public side (2026-09-24, register row 274).
//
// ★ ADDRESSING, the same decision help.js records and for the same measured reason: the site is
// static on GitHub Pages, which has no rewrites, so one page serves both views and the post is a
// query parameter.
//     /blog-press          the listing
//     /blog-press?p=<slug> one post
//
// ★ THE ONLY PUBLIC READS ARE THE THREE VIEWS — blog_posts_public, blog_comments_public and
// blog_like_counts. blog_posts and blog_comments have no anon grant at all, so a draft post is
// unreachable from here by construction rather than by this file remembering to filter, and a
// comment's client_id cannot reach a browser because the view does not carry it. Part 1 and 2 of
// verify-supabase-blog-press.js fail if either door is ever opened.
//
// ★ THE SDK IS LOADED LAZILY, AND ONLY FOR SOMEONE WHO MIGHT WRITE. Reads are plain fetch against
// PostgREST (help.js's precedent, and home-hero.js's before it), so a signed-out visitor reading
// a post downloads no Supabase bundle at all. The bundle arrives only when a session key is
// present in storage or the visitor actually tries to act — the same lazy import chat-widget.js
// uses, which is the existing public-page exception this follows rather than widens.
(function () {
  'use strict';

  var root = document.getElementById('bp-root');
  if (!root) return;

  var qs = new URLSearchParams(location.search);
  var slug = (qs.get('p') || '').trim();

  var PAGE = 6;                       // posts per "Continue reading" step, beyond the featured one
  var BODY_MAX = 1500;                // matches _shared/blog.ts; the server is still authoritative

  var CATS = [
    { id: 'explainer', label: 'Explainers', one: 'Explainer' },
    { id: 'private-equity', label: 'Private equity', one: 'Private equity' },
    { id: 'article', label: 'Articles', one: 'Article' },
    { id: 'company-news', label: 'Company news', one: 'Company news' },
  ];

  var state = {
    cfg: null, posts: [], likes: {}, comments: [],
    cat: 'all', q: '', shown: PAGE,
    session: null, me: null, liked: false, replyTo: null,
  };

  // ---------------------------------------------------------------- DOM helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;              // ★ TEXT, never innerHTML — see below
    return n;
  }
  // ★ EVERY PIECE OF WRITTEN CONTENT REACHES THE PAGE AS A TEXT NODE. A comment is the only
  // content on this site a stranger can write, and it is rendered with textContent, so a
  // <script> a client types is eight literal characters on screen. The post body is the shared
  // structured-block renderer, which builds DOM with createElement for the same reason — there
  // is no innerHTML anywhere in this file.
  function svg(d, size, stroke, fill) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size || 14); s.setAttribute('height', size || 14);
    s.setAttribute('fill', fill || 'none');
    s.setAttribute('stroke', stroke || 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    d.split('|').forEach(function (p) {
      var el2 = document.createElementNS('http://www.w3.org/2000/svg', p.charAt(0) === 'C' ? 'circle' : (p.charAt(0) === 'R' ? 'rect' : 'path'));
      if (p.charAt(0) === 'C') { var c = p.slice(1).split(','); el2.setAttribute('cx', c[0]); el2.setAttribute('cy', c[1]); el2.setAttribute('r', c[2]); }
      else if (p.charAt(0) === 'R') { var r = p.slice(1).split(','); el2.setAttribute('x', r[0]); el2.setAttribute('y', r[1]); el2.setAttribute('width', r[2]); el2.setAttribute('height', r[3]); el2.setAttribute('rx', r[4] || 2); }
      else el2.setAttribute('d', p);
      s.appendChild(el2);
    });
    return s;
  }
  var I_HEART = 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z';
  var I_CHAT = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';
  var I_REPLY = 'M9 17 4 12l5-5|M20 18v-2a4 4 0 0 0-4-4H4';
  var I_INFO = 'C12,12,9|M12 16v-4|M12 8h.01';
  var I_MAIL = 'R2,4,20,16,2.5|m3 7 9 6 9-6';
  var I_FILE = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M12 18v-6|M9 15l3 3 3-3';
  var I_SEARCH = 'C11,11,7|m20 20-3.5-3.5';

  function catOf(id) { return CATS.filter(function (c) { return c.id === id; })[0] || null; }
  function catLabel(id) { var c = catOf(id); return c ? c.one : id; }
  function href(s) { return 'blog-press.html?p=' + encodeURIComponent(s); }

  function fmtDate(iso, longForm) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', longForm
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24); if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    return fmtDate(iso);
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  // A cover with no uploaded image falls back to one of four tints, chosen from the slug so a
  // post keeps the same one everywhere it appears rather than changing between the card and the
  // post. Never a fabricated photograph.
  function coverClass(p) {
    var h = 0, s = String(p.slug || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'bp-c' + ((h % 4) + 1);
  }
  function coverNode(p, cls) {
    var c = el('div', 'bp-cover ' + coverClass(p) + (cls ? ' ' + cls : ''));
    if (p.cover_path && state.cfg) {
      var img = document.createElement('img');
      img.src = state.cfg.url + '/storage/v1/object/public/article-images/' + p.cover_path;
      img.alt = p.cover_alt || '';        // required before publishing; never invented here
      img.loading = 'lazy';
      img.addEventListener('error', function () { img.remove(); });   // fall back to the tint
      c.appendChild(img);
    } else {
      var ph = el('div', 'bp-ph');
      ph.appendChild(svg('M3 3v18h18|M18.7 8 12 14.7l-3.5-3.5L3 16.4', 64, '#fff'));
      c.appendChild(ph);
    }
    return c;
  }

  // ---------------------------------------------------------------- data
  function okJson(res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); }
  function rest(path) {
    var h = { apikey: state.cfg.anonKey, Authorization: 'Bearer ' + state.cfg.anonKey };
    return fetch(state.cfg.url + '/rest/v1/' + path, { headers: h }).then(okJson);
  }

  function load() {
    return import('./supabase-endpoint.js').then(function (mod) {
      state.cfg = mod.ACTIVE_CONFIG;
      return Promise.all([
        rest('blog_posts_public?select=*&order=published_at.desc'),
        rest('blog_like_counts?select=*'),
      ]).then(function (r) {
        state.posts = r[0] || [];
        (r[1] || []).forEach(function (row) { state.likes[row.post_id] = Number(row.likes) || 0; });
      });
    });
  }

  // ★ A SESSION IS DETECTED FROM STORAGE BEFORE THE SDK IS FETCHED. supabase-js keys its session
  // as sb-<project host>-auth-token; finding one tells us a client may be signed in, which is
  // enough to decide whether the bundle is worth downloading. It is never treated as proof —
  // the real session comes from the SDK, and every write is authorised server-side regardless.
  function looksSignedIn() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k) && k.indexOf('marketswave-admin') === -1) return true;
      }
    } catch (_) { /* private mode */ }
    return false;
  }
  var sdkPromise = null;
  function sdk() {
    if (!sdkPromise) sdkPromise = import('./supabase-config.js').then(function (m) { return m.supabase; });
    return sdkPromise;
  }
  function resolveMe() {
    if (!looksSignedIn()) return Promise.resolve(null);
    return sdk().then(function (c) {
      return c.auth.getSession().then(function (r) {
        var s = r.data && r.data.session;
        if (!s) return null;
        state.session = s;
        return c.from('clients').select('name, status').eq('id', s.user.id).maybeSingle()
          .then(function (q) {
            state.me = q.data ? { id: s.user.id, name: q.data.name, status: q.data.status } : null;
            return state.me;
          });
      });
    }).catch(function () { return null; });
  }
  function callFn(name, body) {
    return sdk().then(function (c) {
      return c.functions.invoke(name, { body: body }).then(function (r) {
        if (!r.error) return r.data;
        // supabase-js reports every non-2xx as the same generic string; the real message is in
        // the response body (the finding recorded for writeErrorMessage in supabase-data.js).
        if (r.error.context && typeof r.error.context.json === 'function') {
          return r.error.context.json().then(function (j) {
            throw new Error((j && j.error) || 'That did not go through. Try again.');
          }, function () { throw new Error('That did not go through. Try again.'); });
        }
        throw new Error('That did not go through. Try again.');
      });
    });
  }

  // ---------------------------------------------------------------- SEO
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

  // ---------------------------------------------------------------- listing
  function visible() {
    var q = state.q.trim().toLowerCase();
    return state.posts.filter(function (p) {
      if (state.cat !== 'all' && p.category !== state.cat) return false;
      if (!q) return true;
      return (p.title || '').toLowerCase().indexOf(q) !== -1 ||
             (p.lede || '').toLowerCase().indexOf(q) !== -1;
    });
  }
  function countFor(id) {
    var q = state.q.trim().toLowerCase();
    return state.posts.filter(function (p) {
      if (id !== 'all' && p.category !== id) return false;
      if (!q) return true;
      return (p.title || '').toLowerCase().indexOf(q) !== -1 ||
             (p.lede || '').toLowerCase().indexOf(q) !== -1;
    }).length;
  }

  function engNode(p) {
    var e = el('div', 'bp-eng');
    if (p.allow_likes) {
      var l = el('span'); l.appendChild(svg(I_HEART, 13, 'currentColor', 'none'));
      l.appendChild(document.createTextNode(String(state.likes[p.id] || 0)));
      l.setAttribute('aria-label', (state.likes[p.id] || 0) + ' likes');
      e.appendChild(l);
    }
    return e;
  }
  function metaNode(p, longForm) {
    var m = el('div', 'bp-meta');
    m.appendChild(el('b', null, p.byline || 'Marketswave'));
    m.appendChild(el('span', 'bp-dot'));
    m.appendChild(document.createTextNode(fmtDate(p.published_at, longForm)));
    if (p.reading_minutes) {
      m.appendChild(el('span', 'bp-dot'));
      m.appendChild(document.createTextNode(p.reading_minutes + ' min read'));
    }
    m.appendChild(engNode(p));
    return m;
  }

  function featuredNode(p) {
    var a = el('a', 'bp-link'); a.href = href(p.slug);
    var box = el('div', 'bp-glass bp-feat');
    box.appendChild(coverNode(p));
    var fb = el('div', 'bp-fb');
    fb.appendChild(el('span', 'bp-cat bp-k-' + p.category, catLabel(p.category)));
    fb.appendChild(el('h2', null, p.title));
    fb.appendChild(el('p', 'bp-ex', p.lede || ''));
    fb.appendChild(metaNode(p));
    box.appendChild(fb);
    a.appendChild(box);
    return a;
  }
  function cardNode(p) {
    var a = el('a', 'bp-link'); a.href = href(p.slug);
    var box = el('div', 'bp-glass bp-card');
    box.appendChild(coverNode(p));
    var cb = el('div', 'bp-cb');
    cb.appendChild(el('span', 'bp-cat bp-k-' + p.category, catLabel(p.category)));
    cb.appendChild(el('h3', null, p.title));
    cb.appendChild(el('p', 'bp-ex', p.lede || ''));
    cb.appendChild(metaNode(p));
    box.appendChild(cb);
    a.appendChild(box);
    return a;
  }

  function mediaBand() {
    var box = el('div', 'bp-glass bp-media');
    var m1 = el('div', 'bp-mb1');
    m1.appendChild(el('div', 'bp-k', 'For journalists'));
    m1.appendChild(el('h3', null, 'Media enquiries'));
    m1.appendChild(el('p', null, 'Writing about Marketswave or about private markets more broadly? Get in touch and we’ll help with background, facts about the platform, or a comment.'));
    box.appendChild(m1);

    var tiles = el('div', 'bp-mtiles');

    var t1 = el('div', 'bp-mtile');
    var i1 = el('span', 'bp-mi'); i1.appendChild(svg(I_MAIL, 20, '#137254')); t1.appendChild(i1);
    t1.appendChild(el('b', null, 'Press enquiries'));
    t1.appendChild(el('span', 'bp-md', 'Questions, interviews and comment requests'));
    var a1 = el('a', 'bp-mbtn', 'Email the press team');
    a1.href = 'mailto:support@marketswave.net?subject=' + encodeURIComponent('Press enquiry');
    t1.appendChild(a1);
    // ★ NO ADDRESS IS INVENTED. A postal address has not been supplied, so the tile says so in
    // the mockup's own words rather than carrying a plausible-looking one.
    t1.appendChild(el('span', 'bp-maddr', 'Address to be confirmed'));
    tiles.appendChild(t1);

    var t2 = el('div', 'bp-mtile');
    var i2 = el('span', 'bp-mi'); i2.appendChild(svg(I_FILE, 20, '#137254')); t2.appendChild(i2);
    t2.appendChild(el('b', null, 'Press kit'));
    t2.appendChild(el('span', 'bp-md', 'Logo, product screenshots and a fact sheet'));
    // ★ NO KIT EXISTS YET, so there is no button pointing at nothing. When a PM uploads one this
    // becomes a real download; until then the tile says plainly that it is not ready.
    var soon = el('span', 'bp-mbtn'); soon.style.cursor = 'default'; soon.style.color = '#5C6367';
    soon.textContent = 'Not available yet';
    t2.appendChild(soon);
    t2.appendChild(el('span', 'bp-maddr', 'The press kit is being put together'));
    tiles.appendChild(t2);

    box.appendChild(tiles);
    return box;
  }

  function renderListing() {
    document.title = 'Blog & Press — Marketswave';
    meta('description', 'Plain explanations of how investing works, a closer look at private equity, and what’s new at Marketswave.');
    canonical(location.origin + '/blog-press');
    root.textContent = '';

    var hero = el('div', 'bp-hero');
    var hw = el('div', 'bp-wrap');
    hw.appendChild(el('div', 'bp-eb', 'Blog & Press'));
    hw.appendChild(el('h1', null, 'Insights and news'));
    hw.appendChild(el('p', null, 'Plain explanations of how investing works, a closer look at private equity, and what’s new at Marketswave.'));
    hero.appendChild(hw); root.appendChild(hero);

    var wrap = el('div', 'bp-wrap'); root.appendChild(wrap);

    // ---- nothing published yet: an honest empty state, never "coming soon" cards ------------
    if (!state.posts.length) {
      var empty = el('div', 'bp-glass bp-solid bp-empty');
      empty.appendChild(el('h2', null, 'Nothing published yet'));
      empty.appendChild(el('p', null, 'We are writing the first posts now. In the meantime, the Help Center answers the questions clients ask most, and the press team is reachable below.'));
      var hl = el('a', 'bp-mbtn', 'Visit the Help Center');
      hl.href = 'help.html'; hl.style.maxWidth = '220px'; hl.style.margin = '18px auto 0';
      empty.appendChild(hl);
      wrap.appendChild(empty);
      wrap.appendChild(mediaBand());
      return;
    }

    // ---- filter ------------------------------------------------------------------------------
    var filt = el('div', 'bp-glass bp-solid bp-filt');
    filt.setAttribute('role', 'group');
    filt.setAttribute('aria-label', 'Filter posts by category');
    [{ id: 'all', label: 'All' }].concat(CATS).forEach(function (c) {
      var n = countFor(c.id);
      var b = el('button', 'bp-ft' + (state.cat === c.id ? ' bp-on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', state.cat === c.id ? 'true' : 'false');
      b.appendChild(document.createTextNode(c.label));
      b.appendChild(el('span', 'bp-n', String(n)));
      b.addEventListener('click', function () { state.cat = c.id; state.shown = PAGE; renderListing(); });
      filt.appendChild(b);
    });
    var fs = el('div', 'bp-fsearch');
    fs.appendChild(svg(I_SEARCH, 14, '#5C6367'));
    var inp = document.createElement('input');
    inp.type = 'search'; inp.placeholder = 'Search posts'; inp.value = state.q;
    inp.setAttribute('aria-label', 'Search posts');
    inp.addEventListener('input', function () {
      state.q = inp.value; state.shown = PAGE;
      var at = inp.selectionStart; renderListing();
      var again = document.querySelector('.bp-fsearch input');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (_) {} }
    });
    fs.appendChild(inp); filt.appendChild(fs);
    wrap.appendChild(filt);

    // ---- featured + grid ---------------------------------------------------------------------
    var list = visible();
    if (!list.length) {
      var none = el('div', 'bp-glass bp-empty');
      none.appendChild(el('h2', null, 'No posts match'));
      none.appendChild(el('p', null, 'Try a different category, or clear the search.'));
      wrap.appendChild(none);
      wrap.appendChild(mediaBand());
      return;
    }

    var feat = list.filter(function (p) { return p.featured; })[0] || list[0];
    var rest2 = list.filter(function (p) { return p.id !== feat.id; });
    wrap.appendChild(featuredNode(feat));

    if (rest2.length) {
      var grid = el('div', 'bp-grid');
      rest2.slice(0, state.shown).forEach(function (p) { grid.appendChild(cardNode(p)); });
      wrap.appendChild(grid);

      var more = el('div', 'bp-more');
      if (rest2.length > state.shown) {
        var mb = el('button', null, 'Continue reading'); mb.type = 'button';
        mb.addEventListener('click', function () { state.shown += PAGE; renderListing(); });
        more.appendChild(mb);
      }
      var total = list.length;
      var showing = Math.min(rest2.length, state.shown) + 1;
      more.appendChild(el('span', null, 'Showing ' + showing + ' of ' + total + (total === 1 ? ' post' : ' posts')));
      wrap.appendChild(more);
    }

    wrap.appendChild(mediaBand());
  }

  // ---------------------------------------------------------------- post
  function renderPost(p) {
    document.title = p.title + ' — Marketswave';
    var desc = (p.lede || '').slice(0, 300);
    meta('description', desc);
    meta('og:title', p.title, 'property');
    meta('og:description', desc, 'property');
    meta('og:type', 'article', 'property');
    canonical(location.origin + '/blog-press?p=' + encodeURIComponent(p.slug));

    root.textContent = '';
    var wrap = el('div', 'bp-wrap'); wrap.style.paddingTop = '34px'; root.appendChild(wrap);
    var post = el('div', 'bp-post'); wrap.appendChild(post);

    post.appendChild(coverNode(p, 'bp-pcover'));

    var body = el('div', 'bp-glass bp-solid bp-pbody');
    var crumb = el('div', 'bp-crumb');
    var c1 = el('a', null, 'Blog & Press'); c1.href = 'blog-press.html'; crumb.appendChild(c1);
    crumb.appendChild(el('span', null, '›'));
    var c2 = el('a', null, catOf(p.category) ? catOf(p.category).label : p.category);
    c2.href = 'blog-press.html'; crumb.appendChild(c2);
    body.appendChild(crumb);

    body.appendChild(el('span', 'bp-cat bp-k-' + p.category, catLabel(p.category)));
    body.appendChild(el('h1', null, p.title));
    if (p.lede) body.appendChild(el('p', 'bp-lede', p.lede));

    var byl = el('div', 'bp-byl');
    byl.appendChild(el('span', 'bp-av', initials(p.byline || 'Marketswave')));
    var bn = el('div', 'bp-bn');
    bn.appendChild(el('b', null, p.byline || 'Marketswave'));
    bn.appendChild(el('span', null, fmtDate(p.published_at, true) + (p.reading_minutes ? ' · ' + p.reading_minutes + ' min read' : '')));
    byl.appendChild(bn); body.appendChild(byl);

    var art = el('div', 'bp-art');
    if (window.ArticleRender) {
      art.appendChild(window.ArticleRender.render(p.blocks, {
        imageBase: state.cfg.url + '/storage/v1/object/public/article-images/',
      }));
    }
    body.appendChild(art);

    body.appendChild(likeBar(p));
    post.appendChild(body);

    if (p.allow_comments) post.appendChild(commentsPanel(p));
  }

  function likeBar(p) {
    var bar = el('div', 'bp-likebar');
    if (p.allow_likes) {
      var btn = el('button', 'bp-likebtn' + (state.liked ? ' bp-on' : ''));
      btn.type = 'button';
      btn.appendChild(svg(I_HEART, 15, 'currentColor', state.liked ? 'currentColor' : 'none'));
      btn.appendChild(document.createTextNode(state.liked ? 'Liked' : 'Like'));
      btn.setAttribute('aria-pressed', state.liked ? 'true' : 'false');
      var active = state.me && state.me.status === 'active';
      if (!active) {
        btn.disabled = true;
        btn.title = state.me ? 'Your account is not active yet.' : 'Sign in to like this post.';
      } else {
        btn.addEventListener('click', function () {
          btn.disabled = true;
          callFn('toggle-blog-like', { postId: p.id, liked: !state.liked }).then(function (r) {
            state.liked = !state.liked;
            state.likes[p.id] = (r && typeof r.likes === 'number') ? r.likes : (state.likes[p.id] || 0);
            renderPost(p);
          }).catch(function (e) {
            btn.disabled = false;
            var w = el('div', 'bp-werr', e.message); bar.appendChild(w);
          });
        });
      }
      bar.appendChild(btn);
      var n = state.likes[p.id] || 0;
      var txt = state.liked
        ? (n > 1 ? 'You and ' + (n - 1) + (n - 1 === 1 ? ' other' : ' others') + ' found this useful' : 'You found this useful')
        : (n ? n + (n === 1 ? ' person' : ' people') + ' found this useful' : 'Be the first to find this useful');
      bar.appendChild(el('span', 'bp-ct', txt));
    }
    var sh = el('button', 'bp-share', 'Copy link'); sh.type = 'button';
    sh.addEventListener('click', function () {
      var url = location.origin + '/blog-press?p=' + encodeURIComponent(p.slug);
      var done = function () { sh.textContent = 'Link copied'; setTimeout(function () { sh.textContent = 'Copy link'; }, 2200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
      else done();
    });
    bar.appendChild(sh);
    return bar;
  }

  // ---------------------------------------------------------------- comments
  function loadComments(p) {
    return rest('blog_comments_public?select=*&post_id=eq.' + encodeURIComponent(p.id) + '&order=created_at.asc')
      .then(function (r) { state.comments = r || []; });
  }

  function commentNode(p, c, isReply) {
    var cls = 'bp-cm' + (isReply ? ' bp-reply' : '') + (c.removed ? ' bp-removed' : '') + (c.is_marketswave ? ' bp-mw' : '');
    var n = el('div', cls);

    if (c.removed) {
      var av = el('span', 'bp-cav');
      av.appendChild(svg('C12,12,9|M5.7 5.7l12.6 12.6', 14, 'currentColor'));
      n.appendChild(av);
    } else {
      n.appendChild(el('span', 'bp-cav', c.is_marketswave ? 'M' : initials(c.display_name)));
    }

    var b = el('div', 'bp-cb2');
    var h = el('div', 'bp-ch');
    if (!c.removed) {
      h.appendChild(el('b', null, c.is_marketswave ? 'Marketswave' : (c.display_name || 'Client')));
      if (!c.is_marketswave) h.appendChild(el('span', 'bp-tag', 'Client'));
    }
    h.appendChild(el('span', null, ago(c.created_at)));
    b.appendChild(h);
    // ★ textContent: a comment is the only content on this site a stranger writes.
    b.appendChild(el('p', null, c.removed ? 'This comment was removed.' : (c.body || '')));

    if (!c.removed && p.allow_comments && state.me && state.me.status === 'active') {
      var act = el('div', 'bp-cact');
      var target = c.parent_id || c.id;                 // replies always attach to the original
      var replying = state.replyTo === target;
      var rb = el('button', replying ? 'bp-on' : null); rb.type = 'button';
      rb.appendChild(svg(I_REPLY, 13, 'currentColor'));
      rb.appendChild(document.createTextNode(replying ? 'Replying…' : 'Reply'));
      rb.addEventListener('click', function () {
        state.replyTo = replying ? null : target;
        refreshComments(p);
      });
      act.appendChild(rb);
      b.appendChild(act);
    }
    n.appendChild(b);
    return n;
  }

  function replyCompose(p, parentId) {
    var parent = state.comments.filter(function (c) { return c.id === parentId; })[0];
    var box = el('div', 'bp-rcompose');
    var lab = el('label');
    lab.htmlFor = 'bp-reply-ta';
    lab.appendChild(document.createTextNode('Replying to '));
    lab.appendChild(el('b', null, parent && !parent.removed ? (parent.is_marketswave ? 'Marketswave' : parent.display_name) : 'this comment'));
    box.appendChild(lab);
    var ta = document.createElement('textarea');
    ta.id = 'bp-reply-ta'; ta.placeholder = 'Write a reply'; ta.maxLength = BODY_MAX;
    box.appendChild(ta);
    var f = el('div', 'bp-rfoot');
    f.appendChild(el('span', 'bp-rnote', 'Your reply appears straight away, publicly, with your full name.'));
    var cancel = el('button', 'bp-rcancel', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', function () { state.replyTo = null; refreshComments(p); });
    var post = el('button', 'bp-rpost', 'Post reply'); post.type = 'button';
    post.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) return;
      post.disabled = true; post.textContent = 'Posting…';
      callFn('post-blog-comment', { postId: p.id, parentId: parentId, body: text }).then(function () {
        state.replyTo = null;
        return loadComments(p).then(function () { refreshComments(p); });
      }).catch(function (e) {
        post.disabled = false; post.textContent = 'Post reply';
        var old = box.querySelector('.bp-werr'); if (old) old.remove();
        box.appendChild(el('div', 'bp-werr', e.message));
      });
    });
    f.appendChild(cancel); f.appendChild(post);
    box.appendChild(f);
    return box;
  }

  function commentsPanel(p) {
    var panel = el('div', 'bp-glass bp-comments');
    panel.id = 'bp-comments';
    renderCommentsInto(panel, p);
    return panel;
  }
  function refreshComments(p) {
    var panel = document.getElementById('bp-comments');
    if (panel) renderCommentsInto(panel, p);
  }

  function renderCommentsInto(panel, p) {
    panel.textContent = '';
    var live = state.comments.filter(function (c) { return !c.removed; }).length;
    panel.appendChild(el('h3', null, 'Comments · ' + live));
    panel.appendChild(el('p', 'bp-sub', 'From Marketswave clients.'));

    var listBox = el('div'); listBox.style.marginTop = '14px';
    var tops = state.comments.filter(function (c) { return !c.parent_id; });
    tops.forEach(function (c) {
      listBox.appendChild(commentNode(p, c, false));
      state.comments.filter(function (r) { return r.parent_id === c.id; })
        .forEach(function (r) { listBox.appendChild(commentNode(p, r, true)); });
      // the box sits at the end of the thread it joins, which is where the reply will appear
      if (state.replyTo === c.id) listBox.appendChild(replyCompose(p, c.id));
    });
    if (!tops.length) {
      listBox.appendChild(el('p', 'bp-sub', 'No comments yet.'));
    }
    panel.appendChild(listBox);

    if (!p.allow_comments) return;

    // ---- who may write ----------------------------------------------------------------------
    if (!state.me) {
      var si = el('div', 'bp-signin');
      var pq = el('p');
      var a = el('a', null, 'Sign in'); a.href = 'login.html';
      pq.appendChild(a);
      pq.appendChild(document.createTextNode(' to like this post or join the conversation.'));
      si.appendChild(pq);
      panel.appendChild(si);
      return;
    }
    if (state.me.status !== 'active') {
      var pend = el('div', 'bp-pending');
      pend.appendChild(svg(I_INFO, 15, '#8A6A14'));
      var pp = el('p');
      pp.appendChild(el('b', null, state.me.status === 'rejected' ? 'Your account is not active.' : 'Your application is still under review.'));
      pp.appendChild(document.createTextNode(state.me.status === 'rejected'
        ? ' You can read everything here, but commenting and likes are for active clients. Support can help if you think this is wrong.'
        : ' You can read everything here. Once your account is approved you will be able to comment, reply and like.'));
      pend.appendChild(pp);
      panel.appendChild(pend);
      return;
    }

    var comp = el('div', 'bp-compose');
    var lab = el('label', null, 'Add a comment'); lab.htmlFor = 'bp-comment-ta';
    comp.appendChild(lab);
    var ta = document.createElement('textarea');
    ta.id = 'bp-comment-ta'; ta.placeholder = 'Share a thought or ask a question'; ta.maxLength = BODY_MAX;
    comp.appendChild(ta);
    var cnt = el('div', 'bp-cnt', '0 of ' + BODY_MAX);
    ta.addEventListener('input', function () {
      cnt.textContent = ta.value.length + ' of ' + BODY_MAX;
      cnt.className = 'bp-cnt' + (ta.value.length >= BODY_MAX ? ' bp-over' : '');
    });
    comp.appendChild(cnt);

    var f = el('div', 'bp-cfoot');
    var note = el('div', 'bp-note');
    note.appendChild(svg(I_INFO, 15, '#5C6367'));
    var ns = el('span');
    ns.appendChild(document.createTextNode('Your comment appears '));
    ns.appendChild(el('b', null, 'straight away, publicly, with your full name'));
    ns.appendChild(document.createTextNode('. Anyone visiting the site can read it. Marketswave may remove comments that break our guidelines.'));
    note.appendChild(ns);
    f.appendChild(note);
    var btn = el('button', 'bp-bA', 'Post comment'); btn.type = 'button';
    btn.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) return;
      btn.disabled = true; btn.textContent = 'Posting…';
      callFn('post-blog-comment', { postId: p.id, body: text }).then(function () {
        return loadComments(p).then(function () { refreshComments(p); });
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Post comment';
        var old = comp.querySelector('.bp-werr'); if (old) old.remove();
        comp.appendChild(el('div', 'bp-werr', e.message));
      });
    });
    f.appendChild(btn);
    comp.appendChild(f);
    panel.appendChild(comp);
  }

  // ---------------------------------------------------------------- boot
  function skeleton() {
    var wrap = el('div', 'bp-wrap'); wrap.style.paddingTop = '40px';
    var g = el('div', 'bp-grid');
    for (var i = 0; i < 3; i++) {
      var c = el('div', 'bp-glass bp-card');
      var sk = el('div', 'bp-sk'); sk.style.height = '150px'; sk.style.borderRadius = '0';
      c.appendChild(sk);
      var cb = el('div', 'bp-cb');
      [14, 20, 20, 12].forEach(function (h) {
        var s = el('div', 'bp-sk'); s.style.height = h + 'px'; s.style.marginTop = '10px'; cb.appendChild(s);
      });
      c.appendChild(cb); g.appendChild(c);
    }
    wrap.appendChild(g);
    root.textContent = ''; root.appendChild(wrap);
  }
  function failure() {
    root.textContent = '';
    var wrap = el('div', 'bp-wrap'); wrap.style.paddingTop = '40px';
    var box = el('div', 'bp-glass bp-err');
    box.appendChild(el('b', null, 'We could not load this just now'));
    box.appendChild(el('p', null, 'The connection did not come back. Try again in a moment — nothing on your account is affected.'));
    var again = el('button', 'bp-mbtn', 'Try again'); again.style.maxWidth = '160px'; again.style.marginTop = '14px';
    again.addEventListener('click', boot);
    box.appendChild(again);
    wrap.appendChild(box); root.appendChild(wrap);
  }

  function boot() {
    skeleton();
    load().then(function () {
      return resolveMe();
    }).then(function () {
      if (!slug) { renderListing(); return; }
      var p = state.posts.filter(function (x) { return x.slug === slug; })[0];
      if (!p) {
        // A draft, an unpublished post or a typo all land here — the view simply does not carry
        // it, and the page says so rather than implying it once existed.
        root.textContent = '';
        var wrap = el('div', 'bp-wrap'); wrap.style.paddingTop = '40px';
        var box = el('div', 'bp-glass bp-empty');
        box.appendChild(el('h2', null, 'That post is not available'));
        box.appendChild(el('p', null, 'It may have been moved or taken down. Everything we have published is on the main page.'));
        var back = el('a', 'bp-mbtn', 'Back to Blog & Press');
        back.href = 'blog-press.html'; back.style.maxWidth = '220px'; back.style.margin = '18px auto 0';
        box.appendChild(back);
        wrap.appendChild(box); root.appendChild(wrap);
        return;
      }
      var likedCheck = (state.me && state.me.status === 'active')
        ? sdk().then(function (c) {
            return c.from('blog_likes').select('post_id').eq('post_id', p.id).eq('client_id', state.me.id).maybeSingle()
              .then(function (r) { state.liked = !!r.data; }, function () {});
          })
        : Promise.resolve();
      return Promise.all([likedCheck, p.allow_comments ? loadComments(p) : Promise.resolve()])
        .then(function () { renderPost(p); });
    }).catch(failure);
  }

  boot();
})();
