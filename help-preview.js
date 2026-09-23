// help-preview.js — the Help Center topic preview on resources.html (2026-09-23).
//
// ★ WHAT THIS REPLACED, AND WHY IT MATTERS. Until now this section held four hardcoded cards
// with no links in them at all — "Get started", "Investing with Us", "Security and Privacy" and
// "Promotion and referrals". Three named topics the Help Center does not have; the fourth
// promised a referral bonus programme that has never existed anywhere in this product. Cards
// written by hand go stale the moment the thing they describe changes, and nobody re-reads
// placeholder copy. These are read from the same view the Help Center itself reads, so they
// cannot describe a topic that is not there or a count that is not true.
//
// ★ THE ONLY PUBLIC READ IS help_articles_public — the view of PUBLISHED rows. A draft is not
// reachable from here, by construction, not by filtering: help_articles itself has no anon
// grant. Do not "optimise" this into a read of help_articles.
//
// A topic with nothing published renders its card UNLINKED with "Articles coming soon." — the
// same words help.html's own landing uses — rather than linking a visitor to an empty page.
(function () {
  'use strict';

  // ★ DELIBERATELY NOT named `grid`. Tailwind's content scanner reads every root .js file
  // as raw text, and a leading bang on a variable whose name is also a utility is read as
  // that utility's important-modifier form — so negating a variable called `grid` emits a
  // real display-grid-important rule into the shipped sheet.
  // `verify-tailwind-color-scoping` caught exactly that here, twice: once for the code and
  // again for a comment that spelled the token out. The scanner does not skip comments.
  // Avoid negating a variable named after a utility (grid, block, flex, table, hidden...).
  var mount = document.getElementById('hc-preview');
  if (!mount || !window.HelpTopicCards) return;

  // If the read fails there is nothing honest to draw: every card's content and count comes
  // from the response. The section keeps its heading, its description and its working
  // "Visit Help Center" button, and simply carries no cards — never a fabricated placeholder,
  // never an error box on a marketing page. Same for JS being off entirely.
  function giveUp() { mount.remove(); }

  import('./supabase-endpoint.js').then(function (mod) {
    var cfg = mod.ACTIVE_CONFIG;
    var h = { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey };
    return Promise.all([
      fetch(cfg.url + '/rest/v1/help_topics?select=id,name,blurb,sort_order&order=sort_order.asc', { headers: h }),
      fetch(cfg.url + '/rest/v1/help_articles_public?select=slug,topic_id', { headers: h }),
    ]).then(function (r) {
      if (!r[0].ok || !r[1].ok) throw new Error('HTTP ' + r[0].status + '/' + r[1].status);
      return Promise.all([r[0].json(), r[1].json()]);
    });
  }).then(function (data) {
    var topics = data[0] || [];
    var articles = data[1] || [];
    if (!topics.length) return giveUp();
    // No `exclude` and no `showList`: this preview has no hero block, so it shows every topic —
    // and it carries each topic's real published count rather than individual article links,
    // which belong on the Help Center itself.
    window.HelpTopicCards.renderTopicCards(mount, { topics: topics, articles: articles });
  }).catch(giveUp);
})();
