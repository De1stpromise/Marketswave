// admin-help-page.js — the Help Center articles list in the PM tool (2026-09-23).
//
// Reads help_articles directly: the table's only select policy is admin-only, so a manager's own
// session is what makes this work and nobody else can run the same read. Everything else on this
// page is derived from those rows — the health strip, the filters and the status column all come
// from the same fetch rather than from separate counts that could disagree with the table below.
//
// ★ VIEWS AND TICKETS ARE PHASE 2 AND THE COLUMNS SAY SO. They render an em dash with a title
// explaining why, rather than a fabricated zero that would read as "nobody has opened this".
(function () {
  'use strict';

  var D = window.MarketswaveData;
  var state = { articles: [], topics: [], status: 'all', topic: 'all', sort: 'topic', q: '' };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // ---- status, derived once so every surface agrees ------------------------------------------
  function statusOf(a) {
    if (a.published_at) return 'published';
    var hasContent = (a.title && a.title.trim()) || (Array.isArray(a.blocks) && a.blocks.length);
    return hasContent ? 'draft' : 'not_started';
  }
  function hasEdits(a) { return !!a.published_at && a.draft_dirty === true; }

  function topicName(id) {
    var t = state.topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : '—';
  }

  function when(iso) {
    if (!iso) return '—';
    var d = new Date(iso), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return 'Today';
    var y = new Date(now.getTime() - 864e5);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // ---- health strip ---------------------------------------------------------------------------
  function renderHealth() {
    var host = document.getElementById('hl-health');
    host.textContent = '';
    var counts = { published: 0, draft: 0, not_started: 0, attention: 0 };
    state.articles.forEach(function (a) { counts[statusOf(a)]++; });

    [
      { key: 'published', label: 'Published', v: counts.published, x: 'live on the site' },
      { key: 'draft', label: 'Drafts', v: counts.draft, x: 'written, not yet published' },
      { key: 'not_started', label: 'Not started', v: counts.not_started, x: 'planned, nothing written' },
      { key: 'attention', label: 'Needs attention', v: counts.attention, x: '3+ tickets opened from it in 30 days', warn: true },
    ].forEach(function (c) {
      var b = el('button', 'hl-hc' + (c.warn ? ' is-warn' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.status === c.key));
      b.appendChild(el('div', 'hl-k', c.label));
      b.appendChild(el('div', 'hl-v', c.v));
      b.appendChild(el('div', 'hl-x', c.x));
      b.addEventListener('click', function () {
        state.status = (state.status === c.key) ? 'all' : c.key;
        renderHealth(); renderPills(); renderTable();
      });
      host.appendChild(b);
    });
  }

  // ---- filters --------------------------------------------------------------------------------
  function renderPills() {
    var host = document.getElementById('hl-status-pills');
    host.textContent = '';
    var counts = { all: state.articles.length, published: 0, draft: 0, not_started: 0, edits: 0, attention: 0 };
    state.articles.forEach(function (a) { counts[statusOf(a)]++; if (hasEdits(a)) counts.edits++; });
    [
      { key: 'all', label: 'All' }, { key: 'published', label: 'Published' },
      { key: 'draft', label: 'Draft' }, { key: 'not_started', label: 'Not started' },
      { key: 'edits', label: 'Unpublished edits' }, { key: 'attention', label: 'Needs attention' },
    ].forEach(function (p) {
      var b = el('button', 'mw-btn mw-btn-sm');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.status === p.key));
      b.appendChild(document.createTextNode(p.label + ' '));
      b.appendChild(el('span', 'hl-tk', counts[p.key]));
      b.addEventListener('click', function () { state.status = p.key; renderHealth(); renderPills(); renderTable(); });
      host.appendChild(b);
    });
  }

  function matches(a) {
    var s = statusOf(a);
    if (state.status === 'edits') { if (!hasEdits(a)) return false; }
    else if (state.status === 'attention') { return false; }   // Phase 2: no ticket data yet
    else if (state.status !== 'all' && s !== state.status) return false;
    if (state.topic !== 'all' && a.topic_id !== state.topic) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      if ((a.title || '').toLowerCase().indexOf(q) === -1 &&
        (a.question || '').toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }

  function sorted(rows) {
    var by = state.sort;
    var copy = rows.slice();
    if (by === 'title') copy.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
    else if (by === 'changed') copy.sort(function (a, b) { return new Date(b.updated_at || 0) - new Date(a.updated_at || 0); });
    else if (by === 'read' || by === 'tickets') copy.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
    else copy.sort(function (a, b) {
      var ta = topicName(a.topic_id), tb = topicName(b.topic_id);
      return ta === tb ? (a.title || '').localeCompare(b.title || '') : ta.localeCompare(tb);
    });
    return copy;
  }

  // ---- the table ------------------------------------------------------------------------------
  function renderTable() {
    var host = document.getElementById('hl-table');
    host.textContent = '';

    var head = el('div', 'hl-th');
    ['Article', 'Topic', 'Status', 'Last changed'].forEach(function (h) { head.appendChild(el('span', null, h)); });
    head.appendChild(el('span', 'hl-r', 'Views · 30d'));
    head.appendChild(el('span', 'hl-r', 'Tickets · 30d'));
    head.appendChild(el('span', null, ''));
    host.appendChild(head);

    var rows = sorted(state.articles.filter(matches));
    if (!rows.length) {
      host.appendChild(el('div', 'hl-empty',
        state.articles.length ? 'No articles match these filters.' : 'No articles yet. Press “+ New article” to write the first one.'));
      return;
    }

    var lastGroup = null;
    rows.forEach(function (a) {
      if (state.sort === 'topic') {
        var g = topicName(a.topic_id);
        if (g !== lastGroup) {
          var n = rows.filter(function (x) { return topicName(x.topic_id) === g; }).length;
          host.appendChild(el('div', 'hl-grp', g + ' · ' + n + (n === 1 ? ' article' : ' articles')));
          lastGroup = g;
        }
      }
      host.appendChild(row(a));
    });
  }

  function row(a) {
    var r = el('div', 'hl-tr');
    var tn = el('div', 'hl-tn');
    tn.setAttribute('data-label', 'Article');
    tn.appendChild(el('b', null, a.title || '(untitled)'));
    tn.appendChild(el('span', null, a.question ? '“' + a.question + '”' : 'No question written yet'));
    r.appendChild(tn);

    var tt = el('span', 'hl-tt', topicName(a.topic_id)); tt.setAttribute('data-label', 'Topic'); r.appendChild(tt);

    var st = el('span', 'hl-stk'); st.setAttribute('data-label', 'Status');
    var s = statusOf(a);
    st.appendChild(el('span', 'hl-stat ' + (s === 'published' ? 'hl-s-pub' : s === 'draft' ? 'hl-s-draft' : 'hl-s-none'),
      s === 'published' ? 'Published' : s === 'draft' ? 'Draft' : 'Not started'));
    if (hasEdits(a)) st.appendChild(el('span', 'hl-stat hl-s-edits', 'Unpublished edits'));
    r.appendChild(st);

    var td = el('span', 'hl-td', when(a.updated_at)); td.setAttribute('data-label', 'Last changed'); r.appendChild(td);

    // ★ Phase 2 data. An em dash with a reason, never a fabricated 0.
    ['Views · 30d', 'Tickets · 30d'].forEach(function (lbl) {
      var k = el('span', 'hl-tk is-zero hl-r', '—');
      k.setAttribute('data-label', lbl);
      k.title = 'Counting arrives in Phase 2 — this is not a zero.';
      r.appendChild(k);
    });

    var edit = el('a', 'mw-btn mw-btn-sm hl-r', a.title ? 'Edit' : 'Write');
    edit.href = 'admin-help-article.html?id=' + encodeURIComponent(a.id);
    r.appendChild(edit);
    return r;
  }

  // ---- boot ------------------------------------------------------------------------------------
  function wire() {
    document.getElementById('hl-q').addEventListener('input', function (e) {
      state.q = e.target.value.trim(); renderTable();
    });
    document.getElementById('hl-sort').addEventListener('change', function (e) {
      state.sort = e.target.value; renderTable();
    });
    document.getElementById('hl-topic').addEventListener('change', function (e) {
      state.topic = e.target.value; renderTable();
    });
  }

  D.useAdminClient();
  D.renderAsyncBundle(document.getElementById('hl-table'), {
    load: function () {
      return Promise.all([
        D.selectTable('help_articles'),
        D.selectTable('help_topics', function (q) { return q.order('sort_order', { ascending: true }); }),
      ]);
    },
    render: function (res) {
      state.articles = res[0] || [];
      state.topics = res[1] || [];
      var sel = document.getElementById('hl-topic');
      sel.textContent = '';
      var all = el('option', null, 'All topics'); all.value = 'all'; sel.appendChild(all);
      state.topics.forEach(function (t) { var o = el('option', null, t.name); o.value = t.id; sel.appendChild(o); });
      renderHealth(); renderPills(); renderTable(); wire();
    },
    skeletonHTML: D.skeleton.tableRows(6),
  });
})();
