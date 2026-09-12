// rich-text.js — the browser half of the fund-document rich-text model (2026-09-12).
//
// The model is defined once, server-side, in supabase/functions/_shared/fund-document.ts:
//   { blocks: [ { type:'p', runs:[{t, b?, i?}] } | { type:'ul'|'ol', items:[ runs[] ] } ] }
// This file does three things with it and nothing else:
//   render(model)        -> a DocumentFragment built with createElement/textContent. Text is
//                           painted as text: "<script>" in a run is eight literal characters
//                           on screen. innerHTML is never used on PM-authored content.
//   fromEditor(el)       -> a model, walked out of a contenteditable's DOM. Only the shapes
//                           the model can hold survive: bold/italic marks, paragraphs, the two
//                           list kinds. Anything else (a pasted image, a link, a span with a
//                           style, a script) is unwrapped to its text or dropped. This is the
//                           first sanitisation step; the server's validator is the second and
//                           the one that actually decides.
//   mountEditor(...)     -> a minimal editor: contenteditable + a four-button toolbar (bold,
//                           italic, bullets, numbers) + a live character counter. Uses
//                           document.execCommand — deprecated in name, supported in every
//                           current engine, and the alternative (hand-rolled Range surgery)
//                           is several hundred lines for the same four commands. Paste is
//                           intercepted and inserted as PLAIN TEXT, so pasted HTML never
//                           reaches the DOM in the first place.
//
// plainLength() must agree with the server's — the counter a PM sees is the cap the server
// enforces. A verification asserts the two agree on the same content.
(function () {
  'use strict';

  function plainLength(model) {
    var n = 0, pieces = 0;
    (model && model.blocks || []).forEach(function (b) {
      if (b.type === 'p') { n += b.runs.reduce(function (s, r) { return s + r.t.length; }, 0); pieces++; }
      else (b.items || []).forEach(function (item) { n += item.reduce(function (s, r) { return s + r.t.length; }, 0); pieces++; });
    });
    return n + Math.max(0, pieces - 1);
  }
  function plainText(model) {
    var out = [];
    (model && model.blocks || []).forEach(function (b) {
      if (b.type === 'p') out.push(b.runs.map(function (r) { return r.t; }).join(''));
      else (b.items || []).forEach(function (item) { out.push(item.map(function (r) { return r.t; }).join('')); });
    });
    return out.join('\n');
  }
  function isEmpty(model) { return plainText(model).trim().length === 0; }

  // ---- render: model -> DOM, text nodes only ----
  function renderRuns(runs, into) {
    runs.forEach(function (r) {
      var node = document.createTextNode(r.t);
      if (r.i) { var em = document.createElement('em'); em.appendChild(node); node = em; }
      if (r.b) { var strong = document.createElement('strong'); strong.appendChild(node); node = strong; }
      into.appendChild(node);
    });
  }
  function render(model) {
    var frag = document.createDocumentFragment();
    (model && model.blocks || []).forEach(function (b) {
      if (b.type === 'p') {
        var p = document.createElement('p'); renderRuns(b.runs, p); frag.appendChild(p);
      } else if (b.type === 'ul' || b.type === 'ol') {
        var list = document.createElement(b.type);
        b.items.forEach(function (item) { var li = document.createElement('li'); renderRuns(item, li); list.appendChild(li); });
        frag.appendChild(list);
      }
    });
    return frag;
  }

  // ---- fromEditor: contenteditable DOM -> model ----
  function cleanText(s) { return s.replace(/[\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' '); }
  function pushRun(runs, text, marks) {
    if (!text) return;
    var last = runs[runs.length - 1];
    if (last && !!last.b === !!marks.b && !!last.i === !!marks.i) { last.t += text; return; }
    var run = { t: text }; if (marks.b) run.b = true; if (marks.i) run.i = true;
    runs.push(run);
  }
  // Walks inline content into `lines` — an array of run arrays; a <br> starts a new line.
  function collectInline(node, marks, lines) {
    if (node.nodeType === 3) { pushRun(lines[lines.length - 1], cleanText(node.nodeValue), marks); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === 'BR') { lines.push([]); return; }
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IMG' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED' || tag === 'SVG' || tag === 'TEMPLATE') return;
    var next = { b: marks.b, i: marks.i };
    if (tag === 'B' || tag === 'STRONG') next.b = true;
    if (tag === 'I' || tag === 'EM') next.i = true;
    var fw = node.style && node.style.fontWeight;
    if (fw && (fw === 'bold' || parseInt(fw, 10) >= 600)) next.b = true;
    if (node.style && node.style.fontStyle === 'italic') next.i = true;
    if (isBlock(tag)) lines.push([]);   // a nested block inside a block: treat as a line break
    for (var i = 0; i < node.childNodes.length; i++) collectInline(node.childNodes[i], next, lines);
    if (isBlock(tag)) lines.push([]);
  }
  function isBlock(tag) { return tag === 'P' || tag === 'DIV' || tag === 'LI' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'TABLE' || tag === 'TR' || tag === 'TD'; }
  function trimRuns(runs) {
    if (!runs.length) return runs;
    runs[0].t = runs[0].t.replace(/^\s+/, '');
    runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, '');
    return runs.filter(function (r) { return r.t.length > 0; });
  }
  function linesToParagraphs(lines, blocks) {
    lines.forEach(function (runs) { var t = trimRuns(runs); if (t.length) blocks.push({ type: 'p', runs: t }); });
  }
  function collectListItems(listEl, items) {
    for (var i = 0; i < listEl.childNodes.length; i++) {
      var child = listEl.childNodes[i];
      if (child.nodeType !== 1) continue;
      if (child.tagName === 'LI') {
        var lines = [[]];
        for (var j = 0; j < child.childNodes.length; j++) {
          var n = child.childNodes[j];
          if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) { collectListItems(n, items); continue; } // nested list: flatten
          collectInline(n, {}, lines);
        }
        var merged = [];
        lines.forEach(function (l) { l.forEach(function (r) { pushRun(merged, r.t, r); }); if (l.length) pushRun(merged, ' ', {}); });
        merged = trimRuns(merged);
        if (merged.length) items.push(merged);
      } else if (child.tagName === 'UL' || child.tagName === 'OL') {
        collectListItems(child, items);
      }
    }
  }
  function fromEditor(el) {
    var blocks = [];
    var pending = [[]];   // top-level inline content not wrapped in a block
    function flushPending() { linesToParagraphs(pending, blocks); pending = [[]]; }
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) {
        flushPending();
        var items = []; collectListItems(node, items);
        if (items.length) blocks.push({ type: node.tagName.toLowerCase(), items: items });
      } else if (node.nodeType === 1 && isBlock(node.tagName)) {
        flushPending();
        var lines = [[]];
        for (var j = 0; j < node.childNodes.length; j++) collectInline(node.childNodes[j], {}, lines);
        linesToParagraphs(lines, blocks);
      } else {
        collectInline(node, {}, pending);
      }
    }
    flushPending();
    return { blocks: blocks };
  }

  // ---- the editor ----
  function toEditor(el, model) {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(render(model));   // an empty model leaves the body :empty, which shows the placeholder
  }
  function mountEditor(container, options) {
    options = options || {};
    var wrap = document.createElement('div'); wrap.className = 'rte';
    var bar = document.createElement('div'); bar.className = 'rte-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Formatting');
    var body = document.createElement('div'); body.className = 'rte-body'; body.contentEditable = 'true';
    body.setAttribute('role', 'textbox'); body.setAttribute('aria-multiline', 'true');
    if (options.label) body.setAttribute('aria-label', options.label);
    if (options.placeholder) body.setAttribute('data-placeholder', options.placeholder);
    var counter = document.createElement('div'); counter.className = 'rte-counter'; counter.setAttribute('aria-live', 'polite');

    var buttons = [
      { cmd: 'bold', label: 'B', title: 'Bold (Ctrl+B)', cls: 'rte-b' },
      { cmd: 'italic', label: 'I', title: 'Italic (Ctrl+I)', cls: 'rte-i' },
      { sep: true },
      { cmd: 'insertUnorderedList', label: '•', title: 'Bulleted list', cls: 'rte-ul' },
      { cmd: 'insertOrderedList', label: '1.', title: 'Numbered list', cls: 'rte-ol' },
      { sep: true },
      { cmd: 'undo', label: '↩', title: 'Undo (Ctrl+Z)', cls: 'rte-undo' }
    ];
    buttons.forEach(function (b) {
      if (b.sep) { var s = document.createElement('div'); s.className = 'rte-sep'; s.setAttribute('aria-hidden', 'true'); bar.appendChild(s); return; }
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'rte-btn ' + b.cls; btn.title = b.title; btn.setAttribute('aria-label', b.title); btn.dataset.cmd = b.cmd;
      btn.textContent = b.label;
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the selection
      btn.addEventListener('click', function () { body.focus(); document.execCommand(b.cmd, false, null); notify(); });
      bar.appendChild(btn);
    });
    wrap.appendChild(bar); wrap.appendChild(body);
    container.appendChild(wrap); container.appendChild(counter);

    body.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
      notify();
    });
    body.addEventListener('input', notify);

    var cap = options.cap || null;
    function updateCounter() {
      var len = plainLength(fromEditor(body));
      if (cap) {
        counter.textContent = len.toLocaleString('en-US') + ' / ' + cap.toLocaleString('en-US') + ' characters';
        counter.classList.toggle('over', len > cap);
      } else {
        counter.textContent = len ? len.toLocaleString('en-US') + ' characters · no limit' : 'No limit';
      }
    }
    function notify() { updateCounter(); if (options.onChange) options.onChange(); }

    toEditor(body, options.model || { blocks: [] });
    updateCounter();
    return {
      el: body,
      getModel: function () { return fromEditor(body); },
      setModel: function (m) { toEditor(body, m); updateCounter(); },
      isOverCap: function () { return !!cap && plainLength(fromEditor(body)) > cap; }
    };
  }

  window.MarketswaveRichText = {
    render: render,
    fromEditor: fromEditor,
    toEditor: toEditor,
    mountEditor: mountEditor,
    plainLength: plainLength,
    plainText: plainText,
    isEmpty: isEmpty
  };
})();
