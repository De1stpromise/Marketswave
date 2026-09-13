// ★ Asset mark (2026-09-13, row 207) — the ONE way an asset's logo or monogram is rendered
// anywhere in this project. Plain global (window.AssetMark), same convention as
// dashboard-sidebar.js / format-helpers.js; pair it with asset-mark.css.
//
//   AssetMark.html({ name, ticker, logoUrl, size })  → markup for one circular well
//       size: 'l' 46px · 'm' 40px · 's' 34px · 'xs' 28px
//       logoUrl: a storage PATH (/storage/v1/object/public/asset-logos/…, what the backend
//                stores — see _shared/asset-logos.ts) or an absolute URL (a PM-typed one).
//                A path is prefixed with the project origin set by configure(); an absolute
//                URL is used as-is. Empty/null → the monogram straight away.
//   AssetMark.configure({ storageBase })  → called by supabase-data.js the moment the
//       Supabase client resolves, so a path-relative logo_url gets the right origin (the
//       backend cannot know it: its own SUPABASE_URL is the stack-internal address locally).
//   AssetMark.monogram(name, ticker)  → the text a monogram shows (exported for tests).
//   AssetMark.hue(text)               → 0..6, the deterministic hue index (exported for tests).
//   AssetMark.creditHTML()            → the Elbstream attribution line.
//
// THE MONOGRAM TEXT. For a market-priced product or a watchlist row it is the TICKER (SPY,
// VGK, NVDA). A Private Equity / Real Assets fund has no ticker and no provider will ever
// have a logo for it, so its monogram is INITIALS FROM THE NAME, by this rule:
//   • split the name into words on anything that is not a letter or digit;
//   • ALWAYS drop articles and connectives (the, of, and, a, an, for, in, on, &);
//   • drop the GENERIC vehicle words that carry no identity (fund, trust, partners,
//     holdings, group, capital, inc, llc, ltd, plc, corp, co, etf, shares, index, lp) —
//     but only when at least THREE characters remain without them. Three is the well's
//     natural width, so "European Real Estate Trust" → ERE (Trust dropped) while "Nordic
//     Growth Fund" → NGF and "Global Infrastructure Partners" → GIP (a two-letter mark would
//     be thinner than the name deserves, so the vehicle word is kept);
//   • a word of letters contributes its first letter; a word that is ALL DIGITS contributes
//     the whole number ("Real Estate Fund 3" → RE3; "Vintage 2024 Partners" → V2024, capped
//     to V202 below — a digit run is kept whole because "V2P" would read as nothing);
//   • upper-case, and cap at 4 characters (the longest a well is designed for);
//   • a ONE-WORD name — nothing to take initials from — uses that word's first three
//     letters ("Meridian" → MER; "The Fund" → FUN, the one word that survives the
//     article rule);
//   • if the rule still yields FEWER THAN 2 characters (a single one-letter word), fall
//     back to the first three letters/digits of the raw name; a name with none at all
//     shows "?" rather than an empty well.
//   Roman numerals are ordinary words ("Nordic Growth Fund III" → N, G, I → NGI, since
//   three characters remain once Fund is dropped).
//
// THE HUE. FNV-1a (32-bit) of the monogram text, mod 7 — a pure function of the text, so
// the same asset gets the same hue on every page, every load, forever; nothing is stored
// and nothing re-rolls. Deliberately hashed on the MONOGRAM TEXT rather than the product
// id: a PM re-creating a product keeps its mark, and the watchlist's SPY and the catalog's
// SPY (different rows, same ticker) agree.
//
// EAGER, NOT LAZY. The images are this project's own stored marks — a few KB each, cached
// for a week — so a catalog page loads all of them at once; a lazy well would sit empty
// until scrolled into view, which is the gap the brief rules out.
//
// A FAILED IMAGE. One capture-phase 'error' listener on the document (an image's error
// event does not bubble, but it does capture) swaps the <img> for the monogram that was
// computed at render time and carried on the well as data attributes — no per-page wiring,
// no inline onerror, and it covers markup rendered at any time by any script.
(function () {
  var CONNECTIVES = { the: 1, of: 1, and: 1, a: 1, an: 1, 'for': 1, 'in': 1, on: 1 };
  var GENERIC = {
    fund: 1, trust: 1, partners: 1, holdings: 1, group: 1, capital: 1,
    inc: 1, llc: 1, ltd: 1, plc: 1, corp: 1, co: 1, etf: 1, shares: 1, index: 1, lp: 1
  };
  var SIZES = { l: 'mk-l', m: 'mk-m', s: 'mk-s', xs: 'mk-xs' };
  var storageBase = '';

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function initialsOf(words) {
    return words.map(function (w) { return /^[0-9]+$/.test(w) ? w : w.charAt(0); }).join('');
  }

  function initials(name) {
    var raw = String(name || '');
    var words = raw.split(/[^A-Za-z0-9]+/).filter(function (w) { return w && !CONNECTIVES[w.toLowerCase()]; });
    var core = words.filter(function (w) { return !GENERIC[w.toLowerCase()]; });
    var chosen = (core.length && initialsOf(core).length >= 3) ? core : words;
    var out;
    if (chosen.length === 1) {
      out = chosen[0].slice(0, 3);
    } else {
      out = initialsOf(chosen);
    }
    if (out.length < 2) {
      var chars = raw.replace(/[^A-Za-z0-9]/g, '');
      out = chars.slice(0, 3);
    }
    out = out.toUpperCase().slice(0, 4);
    return out || '?';
  }

  function monogram(name, ticker) {
    var t = String(ticker || '').trim().toUpperCase();
    if (t) return t.slice(0, 4);
    return initials(name);
  }

  // FNV-1a, 32-bit, over the UTF-16 code units of the text.
  function hue(text) {
    var h = 0x811c9dc5;
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % 7;
  }

  function src(logoUrl) {
    var u = String(logoUrl || '').trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
    return storageBase + (u.charAt(0) === '/' ? u : '/' + u);
  }

  function monoInner(text) {
    var len = text.length;
    var cls = 'mk-t' + (len === 3 ? ' mk-len3' : (len >= 4 ? ' mk-len4' : ''));
    return '<span class="' + cls + '">' + escapeHTML(text) + '</span>';
  }

  // The well. `aria-hidden`: the asset's name is always adjacent in the markup, so the
  // mark itself is decorative and a screen reader should not hear "S P Y" twice.
  function html(opts) {
    opts = opts || {};
    var text = monogram(opts.name, opts.ticker);
    var h = 'mk-h' + hue(text);
    var size = SIZES[opts.size] || SIZES.m;
    var url = src(opts.logoUrl);
    var attrs = ' aria-hidden="true" data-mk-mono="' + escapeHTML(text) + '" data-mk-hue="' + h + '"';
    if (url) {
      return '<span class="mk ' + size + '"' + attrs + '>' +
        '<img src="' + escapeHTML(url) + '" alt="" decoding="async">' +
        '</span>';
    }
    return '<span class="mk ' + size + ' mk-mono ' + h + '"' + attrs + '>' + monoInner(text) + '</span>';
  }

  function swapToMonogram(well) {
    if (!well || well.classList.contains('mk-mono')) return;
    var text = well.getAttribute('data-mk-mono') || '?';
    var h = well.getAttribute('data-mk-hue') || ('mk-h' + hue(text));
    well.classList.add('mk-mono', h);
    well.innerHTML = monoInner(text);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('error', function (event) {
      var t = event.target;
      if (!t || t.tagName !== 'IMG') return;
      var well = t.parentNode;
      if (well && well.classList && well.classList.contains('mk')) swapToMonogram(well);
    }, true);
  }

  function configure(opts) {
    if (opts && typeof opts.storageBase === 'string') storageBase = opts.storageBase.replace(/\/$/, '');
  }

  function creditHTML() {
    return '<p class="asset-logo-credit">Logos provided by ' +
      '<a href="https://elbstream.com" target="_blank" rel="noopener">Elbstream</a></p>';
  }

  window.AssetMark = {
    html: html,
    configure: configure,
    monogram: monogram,
    initials: initials,
    hue: hue,
    src: src,
    creditHTML: creditHTML,
    swapToMonogram: swapToMonogram
  };
})();
