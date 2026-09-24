// blog-preview.js — the Blog & Press teaser on resources.html (2026-09-24, register row 274).
//
// ★ WHAT THIS REPLACED. Two hardcoded "Article Coming Soon" cards and a paragraph promising that
// content "will be published here". Honest when written — nothing was published — but the moment
// a real post exists those cards are a lie about a page that has posts on it, and nobody
// re-reads placeholder copy. These are read from blog_posts_public, the same view blog.js reads,
// so this preview cannot name a post that does not exist or a date that is not true. It is the
// same decision, and the same shape, as help-preview.js beside it.
//
// ★ THE ONLY PUBLIC READ IS blog_posts_public — the view of PUBLISHED rows. A draft is not
// reachable from here by construction, not by filtering: blog_posts itself has no anon grant.
// Do not "optimise" this into a read of blog_posts.
(function () {
  'use strict';

  // ★ DELIBERATELY NOT named `grid` — see help-preview.js's own note. Tailwind's content scanner
  // reads every root .js file as raw text, and a leading bang on a variable named after a
  // utility emits that utility's important-modifier rule into the shipped sheet.
  var mount = document.getElementById('bp-preview');
  var lede = document.getElementById('bp-preview-lede');
  if (!mount) return;

  // If the read fails there is nothing honest to draw: every card's content comes from the
  // response. The section keeps its heading, its description and its working "View latest
  // updates" button, and simply carries no cards — never a fabricated placeholder, never an
  // error box on a marketing page. Same for JS being off entirely.
  function giveUp() { mount.remove(); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var LABEL = {
    'explainer': 'Explainer',
    'private-equity': 'Private equity',
    'article': 'Article',
    'company-news': 'Company news',
  };
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  import('./supabase-endpoint.js').then(function (mod) {
    var cfg = mod.ACTIVE_CONFIG;
    var h = { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey };
    return fetch(cfg.url + '/rest/v1/blog_posts_public?select=slug,title,lede,category,byline,published_at&order=published_at.desc&limit=2',
      { headers: h }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }).then(function (posts) {
    if (!posts || !posts.length) {
      // Genuinely nothing published. The honest thing is the section without cards, not two
      // cards saying an article is coming — the same call blog-press.html's own empty state makes.
      giveUp();
      if (lede) lede.textContent = 'The first posts are being written now. This is where they will appear.';
      return;
    }
    if (lede) {
      lede.textContent = posts.length === 1
        ? 'Our most recent post.'
        : 'The two most recent posts.';
    }
    posts.forEach(function (p) {
      var a = el('a', 'service-card glass');
      a.href = 'blog-press.html?p=' + encodeURIComponent(p.slug);
      a.style.textDecoration = 'none';
      a.style.color = 'inherit';
      a.style.display = 'block';

      var k = el('span', null, LABEL[p.category] || p.category);
      k.style.cssText = 'display:inline-block;font-size:10px;font-weight:700;letter-spacing:.09em;'
        + 'text-transform:uppercase;color:#0F5C44;margin-bottom:8px;';
      a.appendChild(k);

      a.appendChild(el('h3', null, p.title));
      if (p.lede) a.appendChild(el('p', null, p.lede));

      var m = el('p', null, (p.byline || 'Marketswave') + ' · ' + fmtDate(p.published_at));
      m.style.cssText = 'font-size:12px;color:#5C6367;margin-top:10px;';
      a.appendChild(m);

      mount.appendChild(a);
    });
  }).catch(giveUp);
})();
