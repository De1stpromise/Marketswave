// admin-help-article-page.js — the Help Center article editor (2026-09-23).
//
// ★ NOTHING HERE CAN CHANGE WHAT CLIENTS SEE. Save writes the draft columns; only Publish copies
// them onto the published side. The badges say so and the note under the buttons says so, because
// it is the single most important thing for a manager to trust about this screen.
//
// ★ THE CHECKLIST HERE IS A COURTESY, NOT THE RULE. It ticks the same items publish-help-article
// re-derives server-side from _shared/article-blocks.ts, and both Publish buttons disable together
// while anything is missing — but the server refuses regardless, so a devtools-enabled button
// still cannot publish an article with an image missing its screen-reader description.
//
// BOLD. A paragraph, a step body, a warning body and a tip are plain textareas that take **bold**
// markers, exactly as the block's own help text says. They round-trip through runs: **x** becomes
// { t: 'x', b: true } on save and comes back as **x** on load, so nothing is lost by editing.
(function () {
  'use strict';

  var D = window.MarketswaveData;
  var qs = new URLSearchParams(location.search);
  var articleId = (qs.get('id') || '').trim();

  var state = { article: null, topics: [], all: [], blocks: [], dirty: false };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // ---- runs <-> **bold** text -----------------------------------------------------------------
  function runsToText(runs) {
    return (runs || []).map(function (r) {
      var t = (r && r.t) || '';
      return r && r.b ? '**' + t + '**' : t;
    }).join('');
  }
  function textToRuns(text) {
    var out = [], re = /\*\*([\s\S]+?)\*\*/g, last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      out.push({ t: m[1], b: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out.filter(function (r) { return r.t !== ''; });
  }

  // ---- the model the server will validate -------------------------------------------------------
  function draft() {
    return {
      id: articleId || undefined,
      title: $('hl-title').value.trim(),
      question: $('hl-question').value.trim(),
      topic_id: $('hl-topic-sel').value || null,
      slug: $('hl-slug').value.trim(),
      lede: $('hl-lede').value.trim(),
      blocks: state.blocks,
      related_slugs: relatedSlugs(),
      in_most_asked: $('hl-most-asked').checked,
      featured_on_topic: $('hl-featured').checked,
      product_slot: $('hl-slot').value || null,
    };
  }

  // Mirrors publishChecklist() in _shared/article-blocks.ts. If you change one, change both —
  // the server is the rule and this is the courtesy, and they must name the same items.
  function checklist(a) {
    var images = (a.blocks || []).filter(function (b) { return b.type === 'image'; });
    return [
      { label: 'Title', ok: !!a.title },
      { label: 'The question it answers', ok: !!a.question },
      { label: 'Topic and web address', ok: !!a.topic_id && !!a.slug },
      { label: 'Opening paragraph', ok: !!a.lede },
      { label: 'At least one body block', ok: (a.blocks || []).length > 0 },
      { label: 'Every image has a screen-reader description', ok: images.every(function (b) { return (b.alt || '').trim(); }) },
      { label: 'Related articles', ok: (a.related_slugs || []).length > 0, optional: true },
    ];
  }

  function renderChecklist() {
    var a = draft(), items = checklist(a), host = $('hl-checklist');
    host.textContent = '';
    var required = items.filter(function (i) { return !i.optional; });
    var done = required.filter(function (i) { return i.ok; }).length;
    $('hl-check-count').textContent = done + ' of ' + required.length + ' done';
    items.forEach(function (i) {
      var row = el('div', 'hl-chk' + (i.optional && !i.ok ? ' is-dim' : ''));
      var mark = el('i', i.optional && !i.ok ? 'hl-c-opt' : i.ok ? 'hl-c-ok' : 'hl-c-no');
      mark.textContent = i.ok ? '✓' : i.optional ? '–' : '✕';
      mark.style.fontSize = '10px';
      mark.style.fontWeight = '700';
      mark.style.color = i.ok ? '#14532D' : i.optional ? '#475569' : '#9A1C12';
      row.appendChild(mark);
      row.appendChild(el('span', null, i.label + (i.optional ? ' — optional' : '')));
      host.appendChild(row);
    });
    // ★ Both Publish buttons move together.
    var blocked = required.some(function (i) { return !i.ok; });
    [$('hl-publish'), $('hl-publish-top')].forEach(function (b) {
      b.disabled = blocked;
      b.title = blocked ? 'Something required is still missing — see “Ready to publish?”' : '';
    });
  }

  // ---- blocks -----------------------------------------------------------------------------------
  var BLOCK_META = {
    heading: { name: 'Heading', what: 'starts a new section' },
    p: { name: 'Paragraph', what: 'plain text · **bold** for emphasis' },
    steps: { name: 'Steps', what: 'a numbered walkthrough' },
    warning: { name: 'Warning', what: 'something that can go wrong · amber box' },
    tip: { name: 'Tip', what: 'helpful, not critical' },
    image: { name: 'Image', what: 'a screenshot, with a caption' },
  };

  function blank(type) {
    if (type === 'heading') return { type: 'heading', text: '' };
    if (type === 'p') return { type: 'p', runs: [] };
    if (type === 'steps') return { type: 'steps', steps: [{ title: '', body: [] }] };
    if (type === 'warning') return { type: 'warning', title: '', body: [] };
    if (type === 'tip') return { type: 'tip', body: [] };
    return { type: 'image', path: '', alt: '', caption: '' };
  }

  function field(labelText, value, onInput, opts) {
    var f = el('div', 'hl-f');
    var id = 'f' + Math.random().toString(36).slice(2, 9);
    var lab = el('label', null, labelText); lab.htmlFor = id; f.appendChild(lab);
    var input = (opts && opts.multiline) ? el('textarea', 'mw-field') : el('input', 'mw-field');
    input.id = id;
    if (opts && opts.multiline) input.rows = opts.rows || 2;
    input.value = value || '';
    input.addEventListener('input', function () { onInput(input.value); markDirty(); });
    f.appendChild(input);
    return f;
  }

  function renderBlocks() {
    var host = $('hl-blocks');
    host.textContent = '';
    state.blocks.forEach(function (b, i) {
      var meta = BLOCK_META[b.type] || { name: b.type, what: '' };
      var card = el('div', 'hl-blk' + (b.type === 'warning' ? ' is-warn' : b.type === 'tip' ? ' is-tip' : ''));
      card.setAttribute('role', 'listitem');

      var head = el('div', 'hl-bh');
      head.appendChild(el('span', 'hl-btype', meta.name));
      head.appendChild(el('span', 'hl-bwhat', b.type === 'steps' ? meta.what + ' · ' + b.steps.length + ' steps' : meta.what));
      head.appendChild(el('span', 'hl-sp'));
      var up = el('button', 'mw-btn mw-btn-sm', 'Move up'); up.type = 'button'; up.disabled = i === 0;
      up.addEventListener('click', function () { swap(i, i - 1); });
      var down = el('button', 'mw-btn mw-btn-sm', 'Move down'); down.type = 'button'; down.disabled = i === state.blocks.length - 1;
      down.addEventListener('click', function () { swap(i, i + 1); });
      var del = el('button', 'mw-btn mw-btn-sm mw-btn-danger', 'Remove'); del.type = 'button';
      del.addEventListener('click', function () { state.blocks.splice(i, 1); markDirty(); renderBlocks(); renderChecklist(); renderImages(); });
      head.appendChild(up); head.appendChild(down); head.appendChild(del);
      card.appendChild(head);

      var body = el('div', 'hl-bb');
      if (b.type === 'heading') {
        body.appendChild(field('Heading text', b.text, function (v) { b.text = v; renderChecklist(); }));
      } else if (b.type === 'p') {
        body.appendChild(field('Text', runsToText(b.runs), function (v) { b.runs = textToRuns(v); renderChecklist(); }, { multiline: true, rows: 3 }));
      } else if (b.type === 'tip') {
        body.appendChild(field('Text', runsToText(b.body), function (v) { b.body = textToRuns(v); renderChecklist(); }, { multiline: true, rows: 2 }));
      } else if (b.type === 'warning') {
        body.appendChild(field('Warning title', b.title, function (v) { b.title = v; renderChecklist(); }));
        body.appendChild(field('Explanation', runsToText(b.body), function (v) { b.body = textToRuns(v); renderChecklist(); }, { multiline: true, rows: 2 }));
      } else if (b.type === 'image') {
        body.appendChild(field('Stored file', b.path, function (v) { b.path = v; renderChecklist(); renderImages(); }));
        body.appendChild(field('Description for screen readers (required before publishing)', b.alt, function (v) { b.alt = v; renderChecklist(); renderImages(); }));
        body.appendChild(field('Caption shown under the image (optional)', b.caption || '', function (v) { b.caption = v; renderImages(); }));
      } else if (b.type === 'steps') {
        b.steps.forEach(function (s, si) {
          var row = el('div', 'hl-stepr');
          var n = el('span', 'hl-sn', si + 1); n.setAttribute('aria-hidden', 'true');
          var sb = el('div', 'hl-sb');
          sb.appendChild(field('Step title', s.title, function (v) { s.title = v; renderChecklist(); }));
          sb.appendChild(field('What to do', runsToText(s.body), function (v) { s.body = textToRuns(v); }, { multiline: true, rows: 2 }));
          if (b.steps.length > 1) {
            var rm = el('button', 'mw-btn mw-btn-sm mw-btn-danger', 'Remove step'); rm.type = 'button';
            rm.addEventListener('click', function () { b.steps.splice(si, 1); markDirty(); renderBlocks(); });
            sb.appendChild(rm);
          }
          row.appendChild(n); row.appendChild(sb); body.appendChild(row);
        });
        var add = el('button', 'mw-btn mw-btn-sm', '+ Add a step'); add.type = 'button';
        add.addEventListener('click', function () { b.steps.push({ title: '', body: [] }); markDirty(); renderBlocks(); });
        body.appendChild(add);
      }
      card.appendChild(body);
      host.appendChild(card);
    });
    if (!state.blocks.length) {
      host.appendChild(el('div', 'hl-help', 'No blocks yet — add the first one below.'));
    }
  }

  function swap(a, b) {
    var t = state.blocks[a]; state.blocks[a] = state.blocks[b]; state.blocks[b] = t;
    markDirty(); renderBlocks();
  }

  function renderImages() {
    var host = $('hl-images');
    host.textContent = '';
    var imgs = state.blocks.filter(function (b) { return b.type === 'image'; });
    if (!imgs.length) { host.appendChild(el('div', 'hl-help', 'No images in this article yet.')); return; }
    imgs.forEach(function (b) {
      var row = el('div', 'hl-imgrow');
      row.appendChild(el('div', 'hl-thumb'));
      var im = el('div', 'hl-im');
      im.appendChild(el('b', null, b.alt || '(no description yet)'));
      im.appendChild(el('div', 'hl-fn', b.path || '(no file yet)'));
      if (!(b.alt || '').trim()) {
        var warn = el('div', 'hl-fn', 'This article cannot be published until this image has a screen-reader description.');
        warn.style.color = '#9A1C12'; warn.style.fontWeight = '600';
        im.appendChild(warn);
      }
      row.appendChild(im);
      host.appendChild(row);
    });
  }

  // ---- related ----------------------------------------------------------------------------------
  var related = [];
  function relatedSlugs() { return related.slice(); }
  function renderRelated() {
    var host = $('hl-related'); host.textContent = '';
    related.forEach(function (s, i) {
      var a = state.all.filter(function (x) { return x.slug === s; })[0];
      var row = el('div', 'hl-rel');
      row.appendChild(el('span', null, a ? a.title : s));
      var rm = el('button', 'mw-btn mw-btn-sm', 'Remove'); rm.type = 'button';
      rm.addEventListener('click', function () { related.splice(i, 1); markDirty(); renderRelated(); renderChecklist(); });
      row.appendChild(rm);
      host.appendChild(row);
    });
    var sel = $('hl-related-add');
    sel.textContent = '';
    var ph = el('option', null, related.length >= 3 ? 'Three is the maximum' : '+ Add a related article');
    ph.value = ''; sel.appendChild(ph);
    sel.disabled = related.length >= 3;
    state.all.forEach(function (x) {
      if (x.slug === $('hl-slug').value.trim() || related.indexOf(x.slug) !== -1) return;
      var o = el('option', null, x.title || x.slug); o.value = x.slug; sel.appendChild(o);
    });
  }

  // ---- history ----------------------------------------------------------------------------------
  function renderHistory() {
    var a = state.article, host = $('hl-history');
    host.textContent = '';
    function kv(k, v) {
      var r = el('div', 'hl-kv');
      r.appendChild(el('span', 'hl-kk', k));
      r.appendChild(el('span', 'hl-vv', v));
      host.appendChild(r);
    }
    var d = function (iso) { return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
    kv('First published', a ? d(a.first_published_at) : '—');
    kv('Last published', a ? d(a.published_at) : '—');
    kv('Last saved', a && a.updated_at ? new Date(a.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
    kv('Views this month', '—');
    kv('Tickets opened from it', '—');
    $('hl-unpublish').disabled = !(a && a.published_at);
  }

  function renderBadges() {
    var host = $('hl-badges'); host.textContent = '';
    var a = state.article;
    if (!a) return;
    if (a.published_at) host.appendChild(el('span', 'hl-stat hl-s-pub', 'Published'));
    else if (a.title) host.appendChild(el('span', 'hl-stat hl-s-draft', 'Draft'));
    if (a.published_at && a.draft_dirty) host.appendChild(el('span', 'hl-stat hl-s-edits', 'Unpublished edits'));
  }

  function markDirty() { state.dirty = true; }

  function counter(inputId, cntId, max) {
    var i = $(inputId), c = $(cntId);
    function upd() {
      c.textContent = i.value.length + ' / ' + max;
      c.classList.toggle('is-over', i.value.length > max);
    }
    i.addEventListener('input', function () { upd(); markDirty(); renderChecklist(); });
    upd();
  }

  // ---- load / save ------------------------------------------------------------------------------
  function fill() {
    var a = state.article;
    var sel = $('hl-topic-sel'); sel.textContent = '';
    var ph = el('option', null, 'Choose a topic'); ph.value = ''; sel.appendChild(ph);
    state.topics.forEach(function (t) { var o = el('option', null, t.name); o.value = t.id; sel.appendChild(o); });

    if (a) {
      $('hl-title').value = a.title || '';
      $('hl-question').value = a.question || '';
      sel.value = a.topic_id || '';
      $('hl-slug').value = a.slug || '';
      $('hl-lede').value = a.lede || '';
      state.blocks = Array.isArray(a.blocks) ? JSON.parse(JSON.stringify(a.blocks)) : [];
      related = (a.related_slugs || []).slice();
      $('hl-most-asked').checked = !!a.in_most_asked;
      $('hl-featured').checked = !!a.featured_on_topic;
      $('hl-slot').value = a.product_slot || '';
      $('hl-title-head').childNodes[0].nodeValue = (a.title || 'Untitled article') + ' ';
      $('hl-crumb-title').textContent = a.title || 'Untitled article';
      $('hl-crumb-topic').textContent = a.topic_id ? topicName(a.topic_id) + ' › ' : '';
      var p = $('hl-preview');
      p.href = 'help.html?a=' + encodeURIComponent(a.slug);
      p.title = a.published_at ? 'Opens the published article' : 'Not published yet — this will not show the draft';
    }
    counter('hl-title', 'hl-title-cnt', 80);
    counter('hl-question', 'hl-question-cnt', 120);
    counter('hl-lede', 'hl-lede-cnt', 400);
    renderBadges(); renderBlocks(); renderImages(); renderRelated(); renderHistory(); renderChecklist();
  }

  function topicName(id) {
    var t = state.topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : '';
  }

  function wire() {
    // Slug follows the title until the article has been published once — after that, changing the
    // address would break every link anyone has already shared.
    $('hl-title').addEventListener('input', function () {
      if (state.article && state.article.published_at) return;
      if ($('hl-slug').dataset.touched === '1') return;
      $('hl-slug').value = $('hl-title').value.toLowerCase().normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    });
    $('hl-slug').addEventListener('input', function () { $('hl-slug').dataset.touched = '1'; markDirty(); renderChecklist(); });
    ['hl-question', 'hl-lede'].forEach(function (id) { $(id).addEventListener('input', renderChecklist); });
    $('hl-topic-sel').addEventListener('change', function () { markDirty(); renderChecklist(); });
    ['hl-most-asked', 'hl-featured', 'hl-slot'].forEach(function (id) {
      $(id).addEventListener('change', markDirty);
    });
    $('hl-related-add').addEventListener('change', function (e) {
      if (!e.target.value) return;
      if (related.length < 3) related.push(e.target.value);
      markDirty(); renderRelated(); renderChecklist();
    });
    document.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.blocks.push(blank(b.getAttribute('data-add')));
        markDirty(); renderBlocks(); renderImages(); renderChecklist();
        $('hl-blocks').lastElementChild.scrollIntoView({ block: 'nearest' });
      });
    });

    [$('hl-save'), $('hl-save-top')].forEach(function (btn) {
      btn.addEventListener('click', function () { doSave(btn); });
    });
    [$('hl-publish'), $('hl-publish-top')].forEach(function (btn) {
      btn.addEventListener('click', function () { doPublish(btn); });
    });
    $('hl-unpublish').addEventListener('click', function () { doUnpublish($('hl-unpublish')); });
  }

  function doSave(btn) {
    return D.withButtonBusy(btn, 'Saving…', function () {
      return D.callFunction('save-help-article', draft()).then(function (res) {
        state.article = res.article;
        articleId = res.article.id;
        history.replaceState({}, '', 'admin-help-article.html?id=' + encodeURIComponent(articleId));
        state.dirty = false;
        renderBadges(); renderHistory(); renderChecklist();
        toast('Draft saved. Clients still see the published version.');
      });
    }).catch(function (err) { toast(D.writeErrorMessage(err), true); });
  }

  function doPublish(btn) {
    return D.withButtonBusy(btn, 'Publishing…', function () {
      // Save first so the server publishes exactly what is on screen.
      return D.callFunction('save-help-article', draft()).then(function (res) {
        articleId = res.article.id;
        return D.callFunction('publish-help-article', { id: articleId });
      }).then(function (res) {
        state.article = res.article;
        state.dirty = false;
        renderBadges(); renderHistory(); renderChecklist();
        toast('Published. Clients can read it now.');
      });
    }).catch(function (err) { toast(D.writeErrorMessage(err), true); });
  }

  function doUnpublish(btn) {
    return D.withButtonBusy(btn, 'Unpublishing…', function () {
      return D.callFunction('unpublish-help-article', { id: articleId }).then(function (res) {
        state.article = res.article;
        renderBadges(); renderHistory(); renderChecklist();
        toast('Unpublished. It is off the site, and everything here is kept.');
      });
    }).catch(function (err) { toast(D.writeErrorMessage(err), true); });
  }

  function toast(msg, isError) {
    var t = document.getElementById('hl-toast');
    if (!t) {
      t = el('div'); t.id = 'hl-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:70;' +
        'padding:11px 16px;border-radius:10px;font:600 12.5px Inter,sans-serif;box-shadow:0 12px 30px -12px rgba(15,23,42,.5);';
      document.body.appendChild(t);
    }
    t.style.background = isError ? '#9A1C12' : '#0F172A';
    t.style.color = '#fff';
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.hidden = true; }, isError ? 9000 : 4000);
  }

  D.useAdminClient();
  D.renderAsyncBundle(document.getElementById('hl-blocks'), {
    load: function () {
      return Promise.all([
        D.selectTable('help_topics', function (q) { return q.order('sort_order', { ascending: true }); }),
        D.selectTable('help_articles'),
      ]);
    },
    render: function (res) {
      state.topics = res[0] || [];
      state.all = res[1] || [];
      state.article = articleId ? (state.all.filter(function (a) { return a.id === articleId; })[0] || null) : null;
      fill(); wire();
    },
    skeletonHTML: D.skeleton.lines([90, 70, 80]),
  });
})();
