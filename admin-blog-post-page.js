// admin-blog-post-page.js — writing a post (2026-09-24, register row 274).
//
// ★ THE CHECKLIST COMES FROM THE SERVER, and both Publish buttons read the same one. save-blog-post
// returns publishChecklist({kind:'post'}) from _shared/article-blocks.ts, and publish-blog-post
// re-derives it from that same module before writing anything. So a disabled button and a 400
// cannot disagree, and forcing the button back on from dev tools gets a refusal rather than a
// half-finished post on the blog. Never compute a second copy of this list in the browser.
//
// ★ THE BODY IS STRUCTURED BLOCKS, NEVER HTML. Same model as a Help Center article, so a post
// cannot carry a script tag — one is not representable in the block shape, only storable as
// literal text inside a paragraph run.
//
// ★ SAVING A DRAFT CANNOT CHANGE WHAT A READER SEES. save-blog-post writes the draft columns
// only; the pub_ twins move when, and only when, Publish is pressed.
(function () {
  'use strict';

  var D = window.MarketswaveData;
  var host = document.getElementById('bl-editor');
  if (!host || !D) return;

  var MAX_TITLE = 90, MAX_LEDE = 400;
  var CATS = [
    { id: 'explainer', label: 'Explainer', hint: 'How something on the platform works' },
    { id: 'private-equity', label: 'Private equity', hint: 'Private markets, funds and appraisal' },
    { id: 'article', label: 'Article', hint: 'General pieces on investing and money' },
    { id: 'company-news', label: 'Company news', hint: 'Announcements from Marketswave' },
  ];
  var BLOCK_KINDS = [
    { type: 'heading', label: 'Heading', what: 'starts a new section' },
    { type: 'p', label: 'Paragraph', what: 'plain text · **bold** for emphasis' },
    { type: 'steps', label: 'Steps', what: 'a numbered list of things to do' },
    { type: 'warning', label: 'Warning', what: 'something that could cost the reader' },
    { type: 'tip', label: 'Tip', what: 'a useful aside' },
    { type: 'image', label: 'Image', what: 'a picture, with a description for screen readers' },
  ];

  var id = (new URLSearchParams(location.search).get('id') || '').trim();
  var post = null, checklist = [], cfg = null, dirty = false;

  // ---------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(paths, size, stroke, sw) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size || 13); s.setAttribute('height', size || 13);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', stroke || 'currentColor');
    s.setAttribute('stroke-width', sw || '2'); s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    paths.split('|').forEach(function (p) {
      var kind = p.charAt(0) === 'C' ? 'circle' : (p.charAt(0) === 'R' ? 'rect' : 'path');
      var e = document.createElementNS('http://www.w3.org/2000/svg', kind);
      if (kind === 'circle') { var c = p.slice(1).split(','); e.setAttribute('cx', c[0]); e.setAttribute('cy', c[1]); e.setAttribute('r', c[2]); }
      else if (kind === 'rect') { var r = p.slice(1).split(','); e.setAttribute('x', r[0]); e.setAttribute('y', r[1]); e.setAttribute('width', r[2]); e.setAttribute('height', r[3]); e.setAttribute('rx', r[4] || 2); }
      else e.setAttribute('d', p);
      s.appendChild(e);
    });
    return s;
  }
  function slugify(t) {
    return String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  }
  // runs <-> plain text, with **bold** as the one mark a PM types. The same convention the Help
  // Center editor uses, so a writer moving between the two does not learn a second syntax.
  function textToRuns(t) {
    var out = [], re = /\*\*(.+?)\*\*/g, last = 0, m;
    while ((m = re.exec(t)) !== null) {
      if (m.index > last) out.push({ t: t.slice(last, m.index) });
      out.push({ t: m[1], b: true });
      last = re.lastIndex;
    }
    if (last < t.length) out.push({ t: t.slice(last) });
    return out.length ? out : [{ t: '' }];
  }
  function runsToText(runs) {
    return (runs || []).map(function (r) { return r && r.b ? '**' + (r.t || '') + '**' : (r && r.t) || ''; }).join('');
  }

  // ---------------------------------------------------------------- data
  function blankPost() {
    return {
      id: null, slug: '', title: '', category: null, byline: 'Marketswave', lede: '', question: null,
      cover_path: null, cover_alt: null, blocks: [], featured: false,
      allow_comments: true, allow_likes: true, published_at: null, draft_dirty: true,
    };
  }
  function load() {
    D.useAdminClient();
    return import('./supabase-endpoint.js').then(function (mod) {
      cfg = mod.ACTIVE_CONFIG;
      if (!id) { post = blankPost(); checklist = []; return; }
      return D.selectTable('blog_posts', function (q) { return q.eq('id', id); }).then(function (rows) {
        if (!rows.length) throw new Error('That post could not be found.');
        post = rows[0];
        if (!Array.isArray(post.blocks)) post.blocks = [];
      });
    });
  }

  function payload() {
    return {
      id: post.id || undefined,
      title: post.title, slug: post.slug, category: post.category, byline: post.byline,
      lede: post.lede, question: post.question || undefined,
      cover_path: post.cover_path || undefined, cover_alt: post.cover_alt || undefined,
      blocks: post.blocks,
      featured: !!post.featured, allow_comments: post.allow_comments !== false, allow_likes: post.allow_likes !== false,
    };
  }
  function save() {
    return D.callFunction('save-blog-post', payload()).then(function (r) {
      post.id = r.id;
      checklist = r.checklist || [];
      dirty = false;
      if (!id) {
        id = r.id;
        history.replaceState({}, '', 'admin-blog-post.html?id=' + encodeURIComponent(r.id) + location.hash);
      }
      return r;
    });
  }

  // ---------------------------------------------------------------- field builders
  function field(labelText, required, help, control, counter) {
    var f = el('div', 'bl-f');
    var lab = el('label');
    lab.htmlFor = control.id;
    lab.appendChild(document.createTextNode(labelText));
    lab.appendChild(el('span', required ? 'bl-req' : 'bl-opt', required ? 'Required' : 'Optional'));
    f.appendChild(lab);
    if (help) f.appendChild(el('div', 'bl-help', help));
    f.appendChild(control);
    if (counter) f.appendChild(counter);
    return f;
  }
  function input(idAttr, value, onInput) {
    var i = document.createElement('input');
    i.id = idAttr; i.className = 'mw-field'; i.type = 'text'; i.value = value || '';
    i.addEventListener('input', function () { dirty = true; onInput(i.value); });
    return i;
  }
  function textarea(idAttr, value, rows, max, onInput) {
    var t = document.createElement('textarea');
    t.id = idAttr; t.className = 'mw-field'; t.rows = rows || 3; t.value = value || '';
    if (max) t.maxLength = max;
    t.addEventListener('input', function () { dirty = true; onInput(t.value); });
    return t;
  }
  function counterFor(control, max, get) {
    var c = el('div', 'bl-cnt', (get().length) + ' / ' + max);
    control.addEventListener('input', function () {
      var n = get().length;
      c.textContent = n + ' / ' + max;
      c.className = 'bl-cnt' + (n > max ? ' bl-over' : '');
    });
    return c;
  }

  // ---------------------------------------------------------------- section 1
  function sectionAbout() {
    var card = el('div', 'bl-card bl-sec');
    var h = el('div', 'bl-sech');
    h.appendChild(el('span', 'bl-num', '1'));
    h.appendChild(el('b', null, 'About this post'));
    h.appendChild(el('span', null, 'What it is and who it’s from'));
    card.appendChild(h);
    var b = el('div', 'bl-secb');

    var title = input('bl-title', post.title, function (v) {
      post.title = v;
      if (!post.published_at && !post.slug) { /* nothing yet */ }
      if (!post.published_at) {
        var si = document.getElementById('bl-slug');
        if (si && (!si.dataset.touched || si.dataset.touched !== '1')) { post.slug = slugify(v); si.value = post.slug; }
      }
      repaintSettings();
    });
    b.appendChild(field('Title', true, 'The headline readers see on the blog and at the top of the post.',
      title, counterFor(title, MAX_TITLE, function () { return title.value; })));

    // category
    var cf = el('div', 'bl-f');
    var clab = el('label');
    clab.appendChild(document.createTextNode('Category'));
    clab.appendChild(el('span', 'bl-req', 'Required'));
    cf.appendChild(clab);
    cf.appendChild(el('div', 'bl-help', 'Which filter it appears under on the blog.'));
    var radio = el('div', 'bl-radio');
    radio.setAttribute('role', 'radiogroup');
    radio.setAttribute('aria-label', 'Category');
    CATS.forEach(function (c) {
      var btn = el('button', 'bl-ro' + (post.category === c.id ? ' bl-on' : ''));
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', post.category === c.id ? 'true' : 'false');
      btn.appendChild(el('i'));
      var d = el('div');
      d.appendChild(el('b', null, c.label));
      d.appendChild(el('span', null, c.hint));
      btn.appendChild(d);
      btn.addEventListener('click', function () { post.category = c.id; dirty = true; render(); });
      radio.appendChild(btn);
    });
    cf.appendChild(radio);
    b.appendChild(cf);

    // byline + slug
    var two = el('div', 'bl-two');

    var bylineWrap = el('div', 'bl-f');
    var blab = el('label'); blab.htmlFor = 'bl-byline';
    blab.appendChild(document.createTextNode('Byline'));
    blab.appendChild(el('span', 'bl-req', 'Required'));
    bylineWrap.appendChild(blab);
    bylineWrap.appendChild(el('div', 'bl-help', '"Marketswave" unless a named person actually wrote it.'));
    var isNamed = post.byline && post.byline !== 'Marketswave';
    var sel = document.createElement('select');
    sel.id = 'bl-byline'; sel.className = 'mw-field';
    [{ v: 'Marketswave', t: 'Marketswave' }, { v: '__named', t: 'A named author…' }].forEach(function (o) {
      var op = document.createElement('option'); op.value = o.v; op.textContent = o.t;
      if ((o.v === '__named') === !!isNamed) op.selected = true;
      sel.appendChild(op);
    });
    bylineWrap.appendChild(sel);
    var named = input('bl-byline-name', isNamed ? post.byline : '', function (v) { post.byline = v.trim() || 'Marketswave'; });
    named.placeholder = 'Who wrote it';
    named.style.marginTop = '8px';
    named.hidden = !isNamed;
    sel.addEventListener('change', function () {
      dirty = true;
      if (sel.value === '__named') { named.hidden = false; post.byline = named.value.trim() || ''; named.focus(); }
      else { named.hidden = true; post.byline = 'Marketswave'; }
      repaintSettings();
    });
    bylineWrap.appendChild(named);
    two.appendChild(bylineWrap);

    var slugWrap = el('div', 'bl-f');
    var slab = el('label'); slab.htmlFor = 'bl-slug';
    slab.appendChild(document.createTextNode('Web address'));
    slab.appendChild(el('span', 'bl-req', 'Required'));
    slugWrap.appendChild(slab);
    slugWrap.appendChild(el('div', 'bl-help', 'Filled in from the title. Change it only before publishing.'));
    var box = el('div', 'bl-slug');
    box.appendChild(el('span', null, '/blog-press.html?p='));
    var si = input('bl-slug', post.slug, function (v) { post.slug = v; repaintSettings(); });
    si.addEventListener('input', function () { si.dataset.touched = '1'; });
    box.appendChild(si);
    slugWrap.appendChild(box);
    two.appendChild(slugWrap);

    b.appendChild(two);
    card.appendChild(b);
    return card;
  }

  // ---------------------------------------------------------------- section 2 — cover
  function sectionCover() {
    var card = el('div', 'bl-card bl-sec');
    var h = el('div', 'bl-sech');
    h.appendChild(el('span', 'bl-num', '2'));
    h.appendChild(el('b', null, 'Cover image'));
    h.appendChild(el('span', null, 'Shown on the blog and at the top of the post'));
    card.appendChild(h);
    var b = el('div', 'bl-secb');

    var prev = el('div', 'bl-covprev');
    var img = el('div', 'bl-covimg' + (post.cover_path ? ' bl-has' : ''));
    if (post.cover_path && cfg) {
      var i = document.createElement('img');
      i.src = cfg.url + '/storage/v1/object/public/article-images/' + post.cover_path;
      i.alt = post.cover_alt || '';
      img.appendChild(i);
    } else {
      img.appendChild(svg('R3,3,18,18,2|C8.5,8.5,1.5|m21 15-5-5L5 21', 30, '#64748B', '1.8'));
    }
    prev.appendChild(img);

    var info = el('div', 'bl-covinfo');
    if (post.cover_path) info.appendChild(el('div', 'bl-fn', post.cover_path.split('/').pop()));

    var upf = el('div', 'bl-f');
    var ulab = el('label'); ulab.htmlFor = 'bl-cover-file';
    ulab.appendChild(document.createTextNode('Upload a cover'));
    ulab.appendChild(el('span', 'bl-req', 'Required'));
    upf.appendChild(ulab);
    // ★ The one rule nothing here can enforce, said where the PM is about to act on it.
    upf.appendChild(el('div', 'bl-help', 'PNG, JPG or WebP, up to 5 MB, at least 1600px wide. Landscape works best. '
      + 'Never a real client’s name, email or figures — nothing can check a picture for you.'));
    var file = document.createElement('input');
    file.type = 'file'; file.id = 'bl-cover-file'; file.className = 'mw-field';
    file.accept = 'image/png,image/jpeg,image/webp';
    var status = el('div', 'bl-help');
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      status.textContent = 'Uploading…';
      f.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf), bin = '';
        for (var k = 0; k < bytes.length; k += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 8192));
        return D.callFunction('upload-article-image', {
          filename: f.name, contentType: f.type, fileBase64: btoa(bin), scope: 'blog',
        });
      }).then(function (r) {
        post.cover_path = r.path; dirty = true; status.textContent = '';
        return save();
      }).then(render).catch(function (e) {
        status.textContent = '';
        var old = upf.querySelector('.bl-werr'); if (old) old.remove();
        upf.appendChild(el('div', 'bl-werr', D.writeErrorMessage(e)));
      });
    });
    upf.appendChild(file);
    upf.appendChild(status);
    info.appendChild(upf);

    var altf = el('div', 'bl-f');
    altf.style.marginTop = '14px';
    var alt = input('bl-cover-alt', post.cover_alt, function (v) { post.cover_alt = v; repaintSettings(); });
    alt.placeholder = 'Describe what the image shows';
    altf.appendChild((function () {
      var l = el('label'); l.htmlFor = 'bl-cover-alt';
      l.appendChild(document.createTextNode('Description for screen readers'));
      l.appendChild(el('span', 'bl-req', 'Required'));
      return l;
    })());
    altf.appendChild(el('div', 'bl-help', 'What someone would miss if they could not see it. Every image needs one before the post can publish.'));
    altf.appendChild(alt);
    info.appendChild(altf);

    prev.appendChild(info);
    b.appendChild(prev);
    card.appendChild(b);
    return card;
  }

  // ---------------------------------------------------------------- section 3 — the post
  function blockEditor(blk, idx) {
    var kind = BLOCK_KINDS.filter(function (k) { return k.type === blk.type; })[0] || { label: blk.type, what: '' };
    var wrap = el('div', 'bl-blk');
    var bh = el('div', 'bl-bh');
    bh.appendChild(el('span', 'bl-btype', kind.label));
    bh.appendChild(el('span', 'bl-bwhat', kind.what));
    bh.appendChild(el('span', 'bl-sp'));
    function mover(label, delta, disabled) {
      var b = el('button', 'bl-ib', label); b.type = 'button';
      b.disabled = disabled;
      b.addEventListener('click', function () {
        var t = post.blocks[idx]; post.blocks[idx] = post.blocks[idx + delta]; post.blocks[idx + delta] = t;
        dirty = true; render();
      });
      return b;
    }
    bh.appendChild(mover('Move up', -1, idx === 0));
    bh.appendChild(mover('Move down', 1, idx === post.blocks.length - 1));
    var del = el('button', 'bl-ib bl-del', 'Remove'); del.type = 'button';
    del.addEventListener('click', function () { post.blocks.splice(idx, 1); dirty = true; render(); });
    bh.appendChild(del);
    wrap.appendChild(bh);

    var bb = el('div', 'bl-bb');
    var uid = 'bl-b' + idx;
    if (blk.type === 'heading') {
      var f = el('div', 'bl-f');
      var l = el('label', null, 'Heading text'); l.htmlFor = uid; f.appendChild(l);
      f.appendChild(input(uid, blk.text, function (v) { blk.text = v; repaintSettings(); }));
      bb.appendChild(f);
    } else if (blk.type === 'p') {
      var f2 = el('div', 'bl-f');
      var l2 = el('label', null, 'Text'); l2.htmlFor = uid; f2.appendChild(l2);
      f2.appendChild(textarea(uid, runsToText(blk.runs), 3, null, function (v) { blk.runs = textToRuns(v); repaintSettings(); }));
      bb.appendChild(f2);
    } else if (blk.type === 'tip') {
      var f3 = el('div', 'bl-f');
      var l3 = el('label', null, 'Tip'); l3.htmlFor = uid; f3.appendChild(l3);
      f3.appendChild(textarea(uid, runsToText(blk.body), 2, null, function (v) { blk.body = textToRuns(v); repaintSettings(); }));
      bb.appendChild(f3);
    } else if (blk.type === 'warning') {
      var f4 = el('div', 'bl-f');
      var l4 = el('label', null, 'Warning title'); l4.htmlFor = uid + 't'; f4.appendChild(l4);
      f4.appendChild(input(uid + 't', blk.title, function (v) { blk.title = v; repaintSettings(); }));
      bb.appendChild(f4);
      var f5 = el('div', 'bl-f');
      var l5 = el('label', null, 'Warning text'); l5.htmlFor = uid; f5.appendChild(l5);
      f5.appendChild(textarea(uid, runsToText(blk.body), 2, null, function (v) { blk.body = textToRuns(v); repaintSettings(); }));
      bb.appendChild(f5);
    } else if (blk.type === 'steps') {
      if (!Array.isArray(blk.steps)) blk.steps = [];
      blk.steps.forEach(function (st, si) {
        var f6 = el('div', 'bl-f');
        var l6 = el('label', null, 'Step ' + (si + 1)); l6.htmlFor = uid + 's' + si; f6.appendChild(l6);
        f6.appendChild(input(uid + 's' + si, st.title, function (v) { st.title = v; repaintSettings(); }));
        f6.appendChild(textarea(uid + 's' + si + 'b', runsToText(st.body), 2, null, function (v) { st.body = textToRuns(v); repaintSettings(); }));
        var rm = el('button', 'bl-ib bl-del', 'Remove step'); rm.type = 'button';
        rm.style.marginTop = '6px';
        rm.addEventListener('click', function () { blk.steps.splice(si, 1); dirty = true; render(); });
        f6.appendChild(rm);
        bb.appendChild(f6);
      });
      var add = el('button', 'bl-ib', '+ Add a step'); add.type = 'button';
      add.addEventListener('click', function () { blk.steps.push({ title: '', body: [{ t: '' }] }); dirty = true; render(); });
      bb.appendChild(add);
    } else if (blk.type === 'image') {
      var f7 = el('div', 'bl-f');
      var l7 = el('label', null, 'Image'); l7.htmlFor = uid + 'f'; f7.appendChild(l7);
      f7.appendChild(el('div', 'bl-help', 'PNG, JPG or WebP, up to 5 MB. Never a real client’s name, email or figures.'));
      if (blk.path && cfg) {
        var pim = document.createElement('img');
        pim.src = cfg.url + '/storage/v1/object/public/article-images/' + blk.path;
        pim.alt = blk.alt || ''; pim.style.cssText = 'max-width:220px;border-radius:8px;display:block;margin-bottom:8px';
        f7.appendChild(pim);
      }
      var bf = document.createElement('input');
      bf.type = 'file'; bf.id = uid + 'f'; bf.className = 'mw-field';
      bf.accept = 'image/png,image/jpeg,image/webp';
      bf.addEventListener('change', function () {
        var fl = bf.files && bf.files[0]; if (!fl) return;
        fl.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf), bin = '';
          for (var k = 0; k < bytes.length; k += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 8192));
          return D.callFunction('upload-article-image', { filename: fl.name, contentType: fl.type, fileBase64: btoa(bin), scope: 'blog' });
        }).then(function (r) { blk.path = r.path; dirty = true; render(); })
          .catch(function (e) { f7.appendChild(el('div', 'bl-werr', D.writeErrorMessage(e))); });
      });
      f7.appendChild(bf);
      bb.appendChild(f7);
      var f8 = el('div', 'bl-f');
      var l8 = el('label'); l8.htmlFor = uid + 'a';
      l8.appendChild(document.createTextNode('Description for screen readers'));
      l8.appendChild(el('span', 'bl-req', 'Required'));
      f8.appendChild(l8);
      f8.appendChild(input(uid + 'a', blk.alt, function (v) { blk.alt = v; repaintSettings(); }));
      bb.appendChild(f8);
    }
    wrap.appendChild(bb);
    return wrap;
  }

  function sectionBody() {
    var card = el('div', 'bl-card bl-sec');
    var h = el('div', 'bl-sech');
    h.appendChild(el('span', 'bl-num', '3'));
    h.appendChild(el('b', null, 'The post'));
    h.appendChild(el('span', null, 'What readers read'));
    card.appendChild(h);
    var b = el('div', 'bl-secb');

    var lede = textarea('bl-lede', post.lede, 3, MAX_LEDE, function (v) { post.lede = v; repaintSettings(); });
    b.appendChild(field('Summary', true,
      'Two or three sentences. Shown on the blog card and in larger text under the headline.',
      lede, counterFor(lede, MAX_LEDE, function () { return lede.value; })));

    var q = input('bl-question', post.question, function (v) { post.question = v; });
    q.placeholder = 'e.g. How are units worked out?';
    b.appendChild(field('The question it answers', false,
      'Optional for a post. Help Center articles must have one — posts often answer nothing in particular.',
      q));

    var bf = el('div', 'bl-f');
    var bl = el('label');
    bl.appendChild(document.createTextNode('Body'));
    bl.appendChild(el('span', 'bl-req', 'Required'));
    bf.appendChild(bl);
    bf.appendChild(el('div', 'bl-blkintro',
      'Built from the same blocks as Help Center articles — Heading, Paragraph, Steps, Warning, Tip and Image — '
      + 'so posts look consistent. Use Move up and Move down to reorder.'));
    post.blocks.forEach(function (blk, i) { bf.appendChild(blockEditor(blk, i)); });

    var add = el('div', 'bl-addrow');
    add.appendChild(el('div', 'bl-k', '+ Add a block'));
    var btns = el('div', 'bl-addbtns');
    BLOCK_KINDS.forEach(function (k) {
      var btn = el('button', 'bl-ib', k.label); btn.type = 'button';
      btn.addEventListener('click', function () {
        var blk = { type: k.type };
        if (k.type === 'heading') blk.text = '';
        else if (k.type === 'p') blk.runs = [{ t: '' }];
        else if (k.type === 'tip') blk.body = [{ t: '' }];
        else if (k.type === 'warning') { blk.title = ''; blk.body = [{ t: '' }]; }
        else if (k.type === 'steps') blk.steps = [{ title: '', body: [{ t: '' }] }];
        else if (k.type === 'image') { blk.path = ''; blk.alt = ''; }
        post.blocks.push(blk); dirty = true; render();
      });
      btns.appendChild(btn);
    });
    add.appendChild(btns);
    bf.appendChild(add);
    b.appendChild(bf);

    card.appendChild(b);
    return card;
  }

  // ---------------------------------------------------------------- settings column
  function repaintSettings() {
    // The list is the SERVER's, refreshed on every save. Between saves the PM sees the last
    // one the server returned — never a browser-computed guess that could disagree with it.
    var col = document.getElementById('bl-setcol');
    if (col) { col.textContent = ''; col.appendChild(settingsInner()); }
  }
  function publishReady() {
    return checklist.length > 0 && checklist.every(function (c) { return c.ok; });
  }
  function settingsInner() {
    var frag = document.createDocumentFragment();

    var done = checklist.filter(function (c) { return c.ok; }).length;
    var c1 = el('div', 'bl-card bl-setcard');
    var h1 = el('div', 'bl-sech');
    h1.appendChild(el('b', null, 'Ready to publish?'));
    h1.appendChild(el('span', null, checklist.length ? (done + ' of ' + checklist.length + ' done') : 'save to check'));
    c1.appendChild(h1);
    var b1 = el('div', 'bl-secb');
    if (!checklist.length) {
      b1.appendChild(el('div', 'bl-help', 'Save the draft and this fills in. The list comes from the server, so it always matches what Publish will accept.'));
    }
    checklist.forEach(function (c) {
      var row = el('div', 'bl-chk');
      var i = el('i', c.ok ? 'bl-c-ok' : 'bl-c-no');
      i.appendChild(c.ok
        ? svg('M20 6 9 17l-5-5', 10, '#15803D', '3.2')
        : svg('M18 6 6 18|M6 6l12 12', 10, '#991B1B', '3.2'));
      row.appendChild(i);
      row.appendChild(document.createTextNode(c.label));
      b1.appendChild(row);
    });
    var acts = el('div', 'bl-pubacts');
    acts.appendChild(publishButton('bl-publish-side'));
    var sd = el('button', 'mw-btn mw-btn-sm', 'Save draft'); sd.type = 'button';
    sd.addEventListener('click', function () { doSave(sd); });
    acts.appendChild(sd);
    b1.appendChild(acts);
    b1.appendChild(el('div', 'bl-pubnote', post.published_at
      ? 'This post is live. Publishing again replaces what readers see with the current draft.'
      : 'Publish unlocks once every item is ticked. Saving a draft changes nothing readers see.'));
    c1.appendChild(b1);
    frag.appendChild(c1);

    // where it appears
    var on = [post.featured, post.allow_comments !== false, post.allow_likes !== false].filter(Boolean).length;
    var c2 = el('div', 'bl-card bl-setcard');
    var h2 = el('div', 'bl-sech');
    h2.appendChild(el('b', null, 'Where it appears'));
    h2.appendChild(el('span', null, on + ' of 3 on'));
    c2.appendChild(h2);
    var b2 = el('div', 'bl-secb');
    [
      { k: 'featured', b: 'Feature at the top of the blog', s: 'Replaces the current featured post. One at a time.', v: !!post.featured },
      { k: 'allow_comments', b: 'Allow comments', s: 'Clients’ comments appear straight away. You can remove any of them.', v: post.allow_comments !== false },
      { k: 'allow_likes', b: 'Allow likes', s: 'Signed-in clients can like it once each.', v: post.allow_likes !== false },
    ].forEach(function (t) {
      var row = el('div', 'bl-tog');
      var d = el('div');
      d.appendChild(el('b', null, t.b));
      d.appendChild(el('span', null, t.s));
      row.appendChild(d);
      var sw = el('button', 'bl-sw' + (t.v ? ' bl-on' : ''));
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', t.v ? 'true' : 'false');
      sw.setAttribute('aria-label', t.b);
      sw.addEventListener('click', function () { post[t.k] = !t.v; dirty = true; repaintSettings(); });
      row.appendChild(sw);
      b2.appendChild(row);
    });
    c2.appendChild(b2);
    frag.appendChild(c2);

    // history
    var c3 = el('div', 'bl-card bl-setcard');
    var h3 = el('div', 'bl-sech');
    h3.appendChild(el('b', null, 'History'));
    c3.appendChild(h3);
    var b3 = el('div', 'bl-secb');
    function kv(k, v) {
      var row = el('div', 'bl-kv');
      row.appendChild(el('span', 'bl-k', k));
      row.appendChild(el('span', 'bl-v', v));
      b3.appendChild(row);
    }
    kv('Reading time', post.id && post.pub_reading_minutes ? post.pub_reading_minutes + ' min · from length' : 'from length, at publish');
    kv('Created', post.created_at ? new Date(post.created_at).toLocaleString('en-GB') : 'not saved yet');
    kv('Last saved', post.updated_at ? new Date(post.updated_at).toLocaleString('en-GB') : '—');
    kv('Published', post.published_at ? new Date(post.published_at).toLocaleString('en-GB') : 'not yet');
    c3.appendChild(b3);
    frag.appendChild(c3);

    return frag;
  }

  // ---------------------------------------------------------------- actions
  function publishButton(domId) {
    var ready = publishReady();
    var b = el('button', 'mw-btn mw-btn-admin mw-btn-sm', post.published_at ? 'Publish changes' : 'Publish');
    b.type = 'button'; b.id = domId;
    if (!ready) {
      b.disabled = true;
      var missing = checklist.filter(function (c) { return !c.ok; });
      b.title = checklist.length
        ? missing.length + (missing.length === 1 ? ' required item missing' : ' required items missing') + ' — see "Ready to publish?"'
        : 'Save the draft first';
    }
    b.addEventListener('click', function () { doPublish(b); });
    return b;
  }
  function errorInto(node, e) {
    var old = document.querySelectorAll('.bl-werr');
    for (var i = 0; i < old.length; i++) old[i].remove();
    node.appendChild(el('div', 'bl-werr', D.writeErrorMessage(e)));
  }
  function doSave(btn) {
    return D.withButtonBusy(btn, 'Saving…', save)
      .then(render)
      .catch(function (e) { errorInto(host, e); });
  }
  function doPublish(btn) {
    return D.withButtonBusy(btn, 'Publishing…', function () {
      return (dirty || !post.id ? save() : Promise.resolve())
        .then(function () { return D.callFunction('publish-blog-post', { id: post.id }); });
    }).then(function () { return load(); }).then(function () {
      return save();                 // refresh the server's own checklist for the new state
    }).then(render).catch(function (e) { errorInto(host, e); });
  }
  function doUnpublish(btn) {
    return D.withButtonBusy(btn, 'Unpublishing…', function () {
      return D.callFunction('publish-blog-post', { id: post.id, unpublish: true });
    }).then(load).then(save).then(render).catch(function (e) { errorInto(host, e); });
  }

  // ---------------------------------------------------------------- render
  function render() {
    host.textContent = '';

    var crumb = el('div', 'bl-crumb');
    var a = el('a', null, 'Blog & Press'); a.href = 'admin-blog.html'; crumb.appendChild(a);
    crumb.appendChild(el('span', null, '›'));
    if (post.category) {
      var c = CATS.filter(function (x) { return x.id === post.category; })[0];
      crumb.appendChild(el('span', null, c ? c.label : post.category));
      crumb.appendChild(el('span', null, '›'));
    }
    crumb.appendChild(el('b', null, post.title || 'New post'));
    host.appendChild(crumb);

    var mh = el('div', 'bl-mh');
    var left = el('div');
    var h1 = el('h1', null, post.title || 'New post');
    var st = !post.published_at
      ? { label: 'Draft', cls: 'bl-s-draft' }
      : (post.draft_dirty ? { label: 'Unpublished edits', cls: 'bl-s-edits' } : { label: 'Published', cls: 'bl-s-pub' });
    var badge = el('span', 'bl-stat ' + st.cls, st.label);
    badge.style.cssText = 'vertical-align:3px;margin-left:8px';
    h1.appendChild(badge);
    left.appendChild(h1);
    left.appendChild(el('p', null, post.published_at
      ? 'Edits stay yours until you publish them. Readers still see the last published version.'
      : 'Nothing here reaches readers until you press Publish.'));
    mh.appendChild(left);

    var acts = el('div', 'bl-acts');
    if (post.published_at) {
      var view = el('a', 'mw-btn mw-btn-sm', 'View live');
      view.href = 'blog-press.html?p=' + encodeURIComponent(post.slug);
      view.target = '_blank'; view.rel = 'noopener';
      acts.appendChild(view);
      var un = el('button', 'mw-btn mw-btn-sm', 'Unpublish'); un.type = 'button';
      un.addEventListener('click', function () { doUnpublish(un); });
      acts.appendChild(un);
    }
    var sd2 = el('button', 'mw-btn mw-btn-sm', 'Save draft'); sd2.type = 'button';
    sd2.addEventListener('click', function () { doSave(sd2); });
    acts.appendChild(sd2);
    // ★ BOTH Publish buttons read publishReady(), which reads the SERVER's checklist, so they
    // disable and enable together by construction rather than by remembering to keep them
    // in step.
    acts.appendChild(publishButton('bl-publish-top'));
    mh.appendChild(acts);
    host.appendChild(mh);

    var grid = el('div', 'bl-edgrid');
    var main = el('div');
    main.appendChild(sectionAbout());
    main.appendChild(sectionCover());
    main.appendChild(sectionBody());
    grid.appendChild(main);

    var col = el('div', 'bl-setcol'); col.id = 'bl-setcol';
    col.appendChild(settingsInner());
    grid.appendChild(col);
    host.appendChild(grid);
  }

  D.renderAsyncBundle(host, {
    load: function () {
      return load().then(function () {
        // A saved post gets the server's own checklist immediately, so the Publish buttons are
        // correct on the very first paint rather than after the first edit.
        if (post.id) return save();
      });
    },
    render: render,
    skeletonHTML: D.skeleton.card() + D.skeleton.card(),
  });
})();
