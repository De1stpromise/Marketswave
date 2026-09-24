// admin-blog-page.js — Blog & Press in the PM tool: the Posts and Comments tabs
// (2026-09-24, register row 274).
//
// ★ ONE HEADER, ONE SET OF BUTTONS, ONE HEALTH STRIP, ABOVE BOTH TABS. Posts and Comments are
// two views of the same thing; a PM must not lose the counts or "New post" by switching. Only
// the panel below the tabs is swapped.
//
// ★ THE PM READS THE TABLES, NOT THE PUBLIC VIEWS. blog_comments_public deliberately carries no
// client id and hides a removed comment's text — correct for a reader, useless for moderation.
// The admin-read RLS policies on blog_posts and blog_comments are what let this page see a
// draft, a removed comment's original words, and who wrote it. Do not "reuse" the public view
// here to save a policy.
//
// ★ A FLAG IS A PROMPT, NOT A DECISION. A flagged comment is live the whole time it is counted,
// and nothing on this page hides one automatically — the PM decides. That is why the red rail
// count and the "Flagged comments" card both mean "waiting for your judgement".
(function () {
  'use strict';

  var D = window.MarketswaveData;
  var panel = document.getElementById('bl-panel');
  if (!panel || !D) return;

  var CATS = [
    { id: 'explainer', label: 'Explainers', one: 'Explainer' },
    { id: 'private-equity', label: 'Private equity', one: 'Private equity' },
    { id: 'article', label: 'Articles', one: 'Article' },
    { id: 'company-news', label: 'Company news', one: 'Company news' },
  ];
  var state = {
    tab: 'posts', posts: [], comments: [], likes: {}, counts: {},
    pStatus: 'all', pCat: 'all', pSort: 'newest', pQ: '',
    cStatus: 'all', cPost: 'all', cSort: 'newest', cQ: '',
    replyTo: null, cfg: null,
  };

  // ---------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // ★ text, never innerHTML — a comment is client-written
    return n;
  }
  function svg(paths, size, stroke, sw) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size || 13); s.setAttribute('height', size || 13);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', stroke || 'currentColor');
    s.setAttribute('stroke-width', sw || '2'); s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    paths.split('|').forEach(function (p) {
      var kind = p.charAt(0) === 'C' ? 'circle' : (p.charAt(0) === 'L' ? 'polyline' : 'path');
      var e = document.createElementNS('http://www.w3.org/2000/svg', kind);
      if (kind === 'circle') { var c = p.slice(1).split(','); e.setAttribute('cx', c[0]); e.setAttribute('cy', c[1]); e.setAttribute('r', c[2]); }
      else if (kind === 'polyline') e.setAttribute('points', p.slice(1));
      else e.setAttribute('d', p);
      s.appendChild(e);
    });
    return s;
  }
  var I_REPLY = 'L9 17 4 12 9 7|M20 18v-2a4 4 0 0 0-4-4H4';
  var I_INFO = 'C12,12,9|M12 16v-4|M12 8h.01';
  var I_WARN = 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z|M12 9v4|M12 17h.01';
  var I_SEARCH = 'C11,11,7|m20 20-3.5-3.5';

  function catLabel(id) { var c = CATS.filter(function (x) { return x.id === id; })[0]; return c ? c.one : id; }
  function initials(n) {
    var p = String(n || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso); if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function fmtWhen(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24); if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    return fmtDate(iso);
  }
  function postStatus(p) {
    if (!p.published_at) return { key: 'draft', label: 'Draft', cls: 'bl-s-draft' };
    if (p.draft_dirty) return { key: 'edits', label: 'Unpublished edits', cls: 'bl-s-edits' };
    return { key: 'published', label: 'Published', cls: 'bl-s-pub' };
  }
  function coverClass(p) {
    var h = 0, s = String(p.slug || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'bl-c' + ((h % 4) + 1);
  }
  function postById(id) { return state.posts.filter(function (p) { return p.id === id; })[0] || null; }
  function commentById(id) { return state.comments.filter(function (c) { return c.id === id; })[0] || null; }

  // ---------------------------------------------------------------- data
  function loadAll() {
    D.useAdminClient();
    return import('./supabase-endpoint.js').then(function (mod) {
      state.cfg = mod.ACTIVE_CONFIG;
      return Promise.all([
        D.selectTable('blog_posts', function (q) { return q.order('published_at', { ascending: false, nullsFirst: false }); }),
        D.selectTable('blog_comments', function (q) { return q.order('created_at', { ascending: false }); }),
        D.selectTable('blog_likes'),
      ]);
    }).then(function (r) {
      state.posts = r[0] || [];
      state.comments = r[1] || [];
      state.likes = {};
      var cutoff = Date.now() - 30 * 86400000;
      state.recentLikes = 0;
      (r[2] || []).forEach(function (l) {
        state.likes[l.post_id] = (state.likes[l.post_id] || 0) + 1;
        if (new Date(l.created_at).getTime() >= cutoff) state.recentLikes++;
      });
    });
  }

  function commentsOn(postId) { return state.comments.filter(function (c) { return c.post_id === postId; }); }
  function liveCommentsOn(postId) { return commentsOn(postId).filter(function (c) { return !c.removed_at; }); }
  function flaggedOn(postId) { return commentsOn(postId).filter(function (c) { return c.flagged && !c.removed_at; }); }

  // ---------------------------------------------------------------- health strip
  function renderHealth() {
    var host = document.getElementById('bl-health');
    host.textContent = '';
    var published = state.posts.filter(function (p) { return p.published_at; }).length;
    var drafts = state.posts.filter(function (p) { return !p.published_at; }).length;
    var flagged = state.comments.filter(function (c) { return c.flagged && !c.removed_at; }).length;

    [
      { k: 'Published', v: published, x: published === 1 ? 'live on the blog' : 'live on the blog' },
      { k: 'Drafts', v: drafts, x: 'written, not yet published' },
      { k: 'Flagged comments', v: flagged, x: flagged ? 'live now · worth a look' : 'nothing to look at', warn: flagged > 0 },
      { k: 'Likes · 30 days', v: state.recentLikes || 0, x: 'across ' + published + (published === 1 ? ' post' : ' posts') },
    ].forEach(function (c) {
      var box = el('div', 'bl-hc' + (c.warn ? ' bl-warn' : ''));
      box.appendChild(el('div', 'bl-k', c.k));
      box.appendChild(el('div', 'bl-v', String(c.v)));
      box.appendChild(el('div', 'bl-x', c.x));
      host.appendChild(box);
    });

    document.getElementById('bl-tab-posts-n').textContent = String(state.posts.length);
    var cn = document.getElementById('bl-tab-comments-n');
    cn.textContent = flagged ? (flagged + ' flagged') : String(state.comments.filter(function (c) { return !c.removed_at; }).length);
    cn.className = 'bl-n' + (flagged ? ' bl-hot' : '');
  }

  // ---------------------------------------------------------------- filter bar builders
  function pillRow(label, pills, current, onPick) {
    var row = el('div', 'bl-brow');
    var lbl = el('span', 'bl-blbl', label);
    var id = 'bl-lbl-' + label.toLowerCase().replace(/\W+/g, '-');
    lbl.id = id;
    row.appendChild(lbl);
    var grp = el('div', 'bl-brow');
    grp.style.padding = '0'; grp.style.gap = '7px';
    grp.setAttribute('role', 'group'); grp.setAttribute('aria-labelledby', id);
    pills.forEach(function (p) {
      var b = el('button', 'bl-fp' + (current === p.id ? ' bl-on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', current === p.id ? 'true' : 'false');
      b.appendChild(document.createTextNode(p.label));
      b.appendChild(el('span', 'bl-n', String(p.n)));
      b.addEventListener('click', function () { onPick(p.id); });
      grp.appendChild(b);
    });
    row.appendChild(grp);
    return row;
  }
  function showRow(selects, searchId, searchPlaceholder, value, onSearch) {
    var row = el('div', 'bl-brow');
    row.appendChild(el('span', 'bl-blbl', 'Show'));
    selects.forEach(function (s) {
      var lab = el('label', 'sr-only', s.label); lab.htmlFor = s.id; row.appendChild(lab);
      var sel = document.createElement('select');
      sel.id = s.id; sel.className = 'mw-field mw-btn-sm';
      sel.style.width = 'auto'; sel.style.minWidth = '160px';
      s.options.forEach(function (o) {
        var op = document.createElement('option'); op.value = o.v; op.textContent = o.t;
        if (o.v === s.value) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { s.onChange(sel.value); });
      row.appendChild(sel);
    });
    var box = el('div', 'bl-srch');
    box.appendChild(svg(I_SEARCH, 12, '#64748B'));
    var lab2 = el('label', 'sr-only', searchPlaceholder); lab2.htmlFor = searchId; box.appendChild(lab2);
    var inp = document.createElement('input');
    inp.id = searchId; inp.className = 'mw-field'; inp.type = 'search';
    inp.placeholder = searchPlaceholder; inp.value = value;
    inp.addEventListener('input', function () {
      var at = inp.selectionStart; onSearch(inp.value);
      var again = document.getElementById(searchId);
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (_) {} }
    });
    box.appendChild(inp); row.appendChild(box);
    return row;
  }

  // ---------------------------------------------------------------- posts tab
  function postMatches(p, status, cat, q) {
    var st = postStatus(p).key;
    if (status === 'published' && st !== 'published') return false;
    if (status === 'draft' && st !== 'draft') return false;
    if (status === 'edits' && st !== 'edits') return false;
    if (status === 'flagged' && !flaggedOn(p.id).length) return false;
    if (cat !== 'all' && p.category !== cat) return false;
    if (q) {
      var s = q.toLowerCase();
      if ((p.title || '').toLowerCase().indexOf(s) === -1 && (p.lede || '').toLowerCase().indexOf(s) === -1) return false;
    }
    return true;
  }
  function postCount(status) {
    return state.posts.filter(function (p) { return postMatches(p, status, state.pCat, state.pQ); }).length;
  }

  function renderPosts() {
    panel.textContent = '';

    var bar = el('div', 'bl-card bl-bar');
    bar.appendChild(pillRow('Status', [
      { id: 'all', label: 'All', n: postCount('all') },
      { id: 'published', label: 'Published', n: postCount('published') },
      { id: 'draft', label: 'Draft', n: postCount('draft') },
      { id: 'edits', label: 'Unpublished edits', n: postCount('edits') },
      { id: 'flagged', label: 'Has a flagged comment', n: postCount('flagged') },
    ], state.pStatus, function (id) { state.pStatus = id; renderPosts(); }));
    bar.appendChild(showRow([
      {
        id: 'bl-p-cat', label: 'Filter by category', value: state.pCat,
        options: [{ v: 'all', t: 'All categories' }].concat(CATS.map(function (c) { return { v: c.id, t: c.label }; })),
        onChange: function (v) { state.pCat = v; renderPosts(); },
      },
      {
        id: 'bl-p-sort', label: 'Sort posts', value: state.pSort,
        options: [
          { v: 'newest', t: 'Newest first' },
          { v: 'liked', t: 'Most liked' },
          { v: 'commented', t: 'Most commented' },
          { v: 'changed', t: 'Last changed' },
        ],
        onChange: function (v) { state.pSort = v; renderPosts(); },
      },
    ], 'bl-p-q', 'Search posts', state.pQ, function (v) { state.pQ = v; renderPosts(); }));
    panel.appendChild(bar);

    var list = state.posts.filter(function (p) { return postMatches(p, state.pStatus, state.pCat, state.pQ); });
    if (state.pSort === 'liked') list.sort(function (a, b) { return (state.likes[b.id] || 0) - (state.likes[a.id] || 0); });
    else if (state.pSort === 'commented') list.sort(function (a, b) { return liveCommentsOn(b.id).length - liveCommentsOn(a.id).length; });
    else if (state.pSort === 'changed') list.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });

    var table = el('div', 'bl-card'); table.style.overflow = 'hidden';
    var th = el('div', 'bl-th');
    ['Cover', 'Post', 'Category', 'Status', 'Published'].forEach(function (t) { th.appendChild(el('span', null, t)); });
    th.appendChild(el('span', 'bl-r', 'Likes'));
    th.appendChild(el('span', 'bl-r', 'Comments'));
    th.appendChild(el('span'));
    table.appendChild(th);

    if (!list.length) {
      var e = el('div', 'bl-empty');
      e.appendChild(el('b', null, state.posts.length ? 'No posts match' : 'No posts yet'));
      e.appendChild(el('p', null, state.posts.length
        ? 'Try a different filter, or clear the search.'
        : 'Press "New post" to write the first one. Nothing reaches the blog until you publish it.'));
      table.appendChild(e);
    }

    list.forEach(function (p) {
      var tr = el('div', 'bl-tr');

      var thumb = el('span', 'bl-thumb ' + (p.cover_path ? coverClass(p) : 'bl-none'));
      if (p.cover_path && state.cfg) {
        var img = document.createElement('img');
        img.src = state.cfg.url + '/storage/v1/object/public/article-images/' + p.cover_path;
        img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', function () { img.remove(); });
        thumb.appendChild(img);
      }
      tr.appendChild(thumb);

      var tn = el('div', 'bl-tn');
      tn.appendChild(el('b', null, p.title || 'Untitled post'));
      var mins = p.published_at ? p.pub_reading_minutes : null;
      tn.appendChild(el('span', null, 'By ' + (p.byline || 'Marketswave')
        + (mins ? ' · ' + mins + ' min read' : (p.cover_path ? '' : ' · no cover yet'))));
      tr.appendChild(tn);

      tr.appendChild(el('span', 'bl-tt', p.category ? catLabel(p.category) : '—'));
      var st = postStatus(p);
      var stWrap = el('span');
      stWrap.appendChild(el('span', 'bl-stat ' + st.cls, st.label));
      tr.appendChild(stWrap);
      tr.appendChild(el('span', 'bl-td', fmtDate(p.published_at)));

      var likes = state.likes[p.id] || 0;
      tr.appendChild(el('span', 'bl-tk bl-r' + (likes ? '' : ' bl-zero'), likes ? String(likes) : '—'));

      var live = liveCommentsOn(p.id).length, flag = flaggedOn(p.id).length;
      tr.appendChild(el('span', 'bl-tk bl-r' + (live ? (flag ? ' bl-hotk' : '') : ' bl-zero'),
        live ? (live + (flag ? ' · ' + flag + ' flagged' : '')) : '—'));

      var edit = el('a', 'mw-btn mw-btn-sm', 'Edit');
      edit.href = 'admin-blog-post.html?id=' + encodeURIComponent(p.id);
      tr.appendChild(edit);

      table.appendChild(tr);
    });
    panel.appendChild(table);
  }

  // ---------------------------------------------------------------- comments tab
  function commentMatches(c, status, postId, q) {
    if (status === 'live' && c.removed_at) return false;
    if (status === 'flagged' && (!c.flagged || c.removed_at)) return false;
    if (status === 'removed' && !c.removed_at) return false;
    if (status === 'replied' && !state.comments.some(function (r) { return r.parent_id === c.id && r.is_marketswave; })) return false;
    if (status === 'client-replies' && (!c.parent_id || c.is_marketswave)) return false;
    if (postId !== 'all' && c.post_id !== postId) return false;
    if (q) {
      var s = q.toLowerCase();
      var name = (c.display_name || (c.is_marketswave ? 'Marketswave' : '')).toLowerCase();
      if ((c.body || '').toLowerCase().indexOf(s) === -1 && name.indexOf(s) === -1) return false;
    }
    return true;
  }
  function commentCount(status) {
    return state.comments.filter(function (c) { return commentMatches(c, status, state.cPost, state.cQ); }).length;
  }

  function renderComments() {
    panel.textContent = '';

    var bar = el('div', 'bl-card bl-bar');
    bar.appendChild(pillRow('Status', [
      { id: 'all', label: 'All', n: commentCount('all') },
      { id: 'live', label: 'Live', n: commentCount('live') },
      { id: 'flagged', label: 'Flagged', n: commentCount('flagged') },
      { id: 'removed', label: 'Removed', n: commentCount('removed') },
      { id: 'replied', label: 'Replied to', n: commentCount('replied') },
      { id: 'client-replies', label: 'Client replies', n: commentCount('client-replies') },
    ], state.cStatus, function (id) { state.cStatus = id; renderComments(); }));
    bar.appendChild(showRow([
      {
        id: 'bl-c-post', label: 'Filter by post', value: state.cPost,
        options: [{ v: 'all', t: 'All posts' }].concat(state.posts.map(function (p) {
          return { v: p.id, t: (p.title || 'Untitled').slice(0, 46) };
        })),
        onChange: function (v) { state.cPost = v; renderComments(); },
      },
      {
        id: 'bl-c-sort', label: 'Sort comments', value: state.cSort,
        options: [
          { v: 'newest', t: 'Newest first' },
          { v: 'flagged', t: 'Flagged first' },
          { v: 'oldest', t: 'Oldest first' },
        ],
        onChange: function (v) { state.cSort = v; renderComments(); },
      },
    ], 'bl-c-q', 'Search comments or names', state.cQ, function (v) { state.cQ = v; renderComments(); }));
    panel.appendChild(bar);

    var list = state.comments.filter(function (c) { return commentMatches(c, state.cStatus, state.cPost, state.cQ); });
    if (state.cSort === 'oldest') list = list.slice().reverse();
    else if (state.cSort === 'flagged') {
      list = list.slice().sort(function (a, b) {
        var fa = (a.flagged && !a.removed_at) ? 0 : 1, fb = (b.flagged && !b.removed_at) ? 0 : 1;
        return fa - fb || (new Date(b.created_at) - new Date(a.created_at));
      });
    }

    if (!list.length) {
      var e = el('div', 'bl-card bl-empty');
      e.appendChild(el('b', null, state.comments.length ? 'No comments match' : 'No comments yet'));
      e.appendChild(el('p', null, state.comments.length
        ? 'Try a different filter, or clear the search.'
        : 'Comments from clients will appear here as soon as they are written — they go live straight away.'));
      panel.appendChild(e);
      return;
    }
    list.forEach(function (c) { panel.appendChild(commentCard(c)); });
  }

  function commentCard(c) {
    var card = el('div', 'bl-card bl-qc');
    card.setAttribute('data-comment', c.id);
    var post = postById(c.post_id);
    var parent = c.parent_id ? commentById(c.parent_id) : null;

    var h = el('div', 'bl-qh');
    h.appendChild(el('span', 'bl-qav' + (c.is_marketswave ? ' bl-mw' : ''), c.is_marketswave ? 'M' : initials(c.display_name)));
    var qn = el('div', 'bl-qn');
    qn.appendChild(el('b', null, c.is_marketswave ? 'Marketswave' : (c.display_name || 'Client')));
    qn.appendChild(el('span', null, c.is_marketswave ? 'Written by you, in the PM tool' : 'Client · signed in as the account holder'));
    h.appendChild(qn);

    var pillText = c.removed_at ? 'Removed'
      : (c.flagged ? 'Live · flagged' : (c.parent_id ? 'Live · reply' : 'Live'));
    var pillCls = 'bl-pill' + (c.removed_at ? ' bl-gone' : (c.flagged ? ' bl-flag' : ''));
    h.appendChild(el('span', pillCls, pillText));
    h.appendChild(el('span', 'bl-qwhen', fmtWhen(c.created_at)));
    card.appendChild(h);

    // ★ The ORIGINAL text, even for a removed comment — that is the whole point of the Removed
    // filter, and it is why this page reads the table rather than the public view, which
    // correctly blanks it for readers.
    card.appendChild(el('div', 'bl-qtext', c.body || ''));

    var on = el('div', 'bl-qon');
    if (parent) {
      on.appendChild(document.createTextNode('Replying to '));
      on.appendChild(el('b', null, parent.is_marketswave ? 'Marketswave' : (parent.display_name || 'a client')));
      on.appendChild(document.createTextNode(' on '));
    } else {
      on.appendChild(document.createTextNode('On '));
    }
    on.appendChild(el('b', null, post ? (post.title || 'Untitled post') : 'a post'));
    card.appendChild(on);

    var replies = state.comments.filter(function (r) { return r.parent_id === c.id && !r.removed_at; });
    if (replies.length && !c.removed_at) {
      var mine = replies.filter(function (r) { return r.is_marketswave; }).length;
      var theirs = replies.length - mine;
      var bits = [];
      if (mine) bits.push(mine === 1 ? 'yours' : mine + ' from you');
      if (theirs) bits.push(theirs === 1 ? 'one from a client' : theirs + ' from clients');
      var th = el('div', 'bl-qthread');
      th.appendChild(svg(I_REPLY, 13, 'currentColor', '2.2'));
      th.appendChild(document.createTextNode(replies.length + (replies.length === 1 ? ' reply' : ' replies')
        + (bits.length ? ' — ' + bits.join(' and ') : '')
        + '. Removing this comment keeps them, under "This comment was removed".'));
      card.appendChild(th);
    }

    // the public-visibility note: what a visitor sees right now, in plain words
    var pub = el('div', 'bl-qpub' + (c.flagged && !c.removed_at ? ' bl-danger' : ''));
    pub.appendChild(svg(c.flagged && !c.removed_at ? I_WARN : I_INFO, 14, c.flagged && !c.removed_at ? '#991B1B' : '#92400E'));
    var pp = el('p');
    if (c.removed_at) {
      pp.appendChild(document.createTextNode(replies.length
        ? 'Removed. Readers see "This comment was removed" with its replies still underneath.'
        : 'Removed. It is gone from the post entirely.'));
    } else if (c.flagged) {
      pp.appendChild(document.createTextNode((c.flag_reason || 'Worth a look.')
        + ' Public now — on your site, that reads as a performance claim from Marketswave. Consider removing.'));
    } else {
      pp.appendChild(document.createTextNode('Showing publicly as '));
      pp.appendChild(el('b', null, c.is_marketswave ? 'Marketswave' : (c.display_name || 'this client')));
      pp.appendChild(document.createTextNode(parent && !c.is_marketswave
        ? '. ' + (parent.display_name ? parent.display_name : 'The person replied to') + ' was told in their notification bell.'
        : '. Nothing in it about holdings, returns or an account.'));
    }
    pub.appendChild(pp);
    card.appendChild(pub);

    if (!c.removed_at) {
      var acts = el('div', 'bl-qacts');
      var rb = el('button', 'mw-btn mw-btn-sm', state.replyTo === c.id ? 'Cancel reply' : 'Reply');
      rb.type = 'button';
      rb.addEventListener('click', function () {
        state.replyTo = state.replyTo === c.id ? null : c.id;
        renderComments();
      });
      acts.appendChild(rb);

      var del = el('button', 'mw-btn mw-btn-danger mw-btn-sm', 'Remove');
      del.type = 'button';
      del.addEventListener('click', function () { confirmRemove(card, c); });
      acts.appendChild(del);
      card.appendChild(acts);

      if (state.replyTo === c.id) card.appendChild(replyBox(card, c));
    }
    return card;
  }

  function replyBox(card, c) {
    var box = el('div', 'bl-replybox');
    var f = el('div', 'bl-f');
    var lab = el('label', null, 'Your reply, as Marketswave'); lab.htmlFor = 'bl-reply-ta';
    f.appendChild(lab);
    f.appendChild(el('div', 'bl-help', 'It appears publicly under the original comment, marked as Marketswave. It cannot be edited afterwards.'));
    var ta = document.createElement('textarea');
    ta.id = 'bl-reply-ta'; ta.className = 'mw-field'; ta.rows = 3; ta.maxLength = 1500;
    ta.placeholder = 'Write a reply';
    f.appendChild(ta);
    box.appendChild(f);
    var acts = el('div', 'bl-qacts');
    var send = el('button', 'mw-btn mw-btn-admin mw-btn-sm', 'Post reply'); send.type = 'button';
    send.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      D.withButtonBusy(send, 'Posting…', function () {
        return D.callFunction('moderate-blog-comment', { action: 'reply', commentId: c.id, body: text });
      }).then(function () {
        state.replyTo = null;
        return refresh();
      }).catch(function (e) {
        var old = box.querySelector('.bl-werr'); if (old) old.remove();
        box.appendChild(el('div', 'bl-werr', D.writeErrorMessage(e)));
      });
    });
    acts.appendChild(send);
    box.appendChild(acts);
    setTimeout(function () { ta.focus(); }, 0);
    return box;
  }

  function confirmRemove(card, c) {
    var old = card.querySelector('.bl-werr'); if (old) old.remove();
    var box = el('div', 'bl-werr');
    var replies = state.comments.filter(function (r) { return r.parent_id === c.id && !r.removed_at; }).length;
    box.appendChild(el('div', null, replies
      ? 'Remove this comment? Its ' + replies + (replies === 1 ? ' reply stays' : ' replies stay') + ', under "This comment was removed". This cannot be undone.'
      : 'Remove this comment? It disappears from the post entirely. This cannot be undone.'));
    var acts = el('div', 'bl-qacts');
    var yes = el('button', 'mw-btn mw-btn-danger mw-btn-sm', 'Remove it'); yes.type = 'button';
    yes.addEventListener('click', function () {
      D.withButtonBusy(yes, 'Removing…', function () {
        return D.callFunction('moderate-blog-comment', { action: 'remove', commentId: c.id });
      }).then(refresh).catch(function (e) {
        box.appendChild(el('div', null, D.writeErrorMessage(e)));
      });
    });
    var no = el('button', 'mw-btn mw-btn-sm', 'Keep it'); no.type = 'button';
    no.addEventListener('click', function () { box.remove(); });
    acts.appendChild(yes); acts.appendChild(no);
    box.appendChild(acts);
    card.appendChild(box);
  }

  // ---------------------------------------------------------------- tabs & boot
  function paintTabs() {
    var tp = document.getElementById('bl-tab-posts'), tc = document.getElementById('bl-tab-comments');
    tp.className = 'bl-tab' + (state.tab === 'posts' ? ' bl-on' : '');
    tc.className = 'bl-tab' + (state.tab === 'comments' ? ' bl-on' : '');
    tp.setAttribute('aria-selected', state.tab === 'posts' ? 'true' : 'false');
    tc.setAttribute('aria-selected', state.tab === 'comments' ? 'true' : 'false');
    panel.setAttribute('aria-labelledby', state.tab === 'posts' ? 'bl-tab-posts' : 'bl-tab-comments');
  }
  function renderTab() {
    paintTabs();
    if (state.tab === 'posts') renderPosts(); else renderComments();
  }
  function refresh() {
    return loadAll().then(function () { renderHealth(); renderTab(); });
  }

  document.getElementById('bl-tab-posts').addEventListener('click', function () { state.tab = 'posts'; renderTab(); });
  document.getElementById('bl-tab-comments').addEventListener('click', function () { state.tab = 'comments'; renderTab(); });

  if (new URLSearchParams(location.search).get('tab') === 'comments') state.tab = 'comments';

  D.renderAsyncBundle(panel, {
    load: loadAll,
    render: function () { renderHealth(); renderTab(); },
    skeletonHTML: D.skeleton.card() + D.skeleton.card() + D.skeleton.card(),
  });
})();
