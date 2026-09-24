// Blog & Press — contrast, fonts and narrow widths (2026-09-24, register row 274).
//
// ★ THE SOLID PANELS ARE THE POINT. Every panel that overlaps the dark hero or a cover is
// .bp-glass.bp-solid. That was not a style preference: the translucent variant over navy measured
// far below 4.5:1 on the Help Center landing, and these runs are what prove the decision holds —
// with the sheen COMPOSITED, since .glass::before paints a radial highlight over a card's
// top-left corner and over in-flow text (row 204).
//
// ★ NARROW WIDTHS ARE A REAL PHONE PROFILE, not a narrow desktop window: mobile:true, DPR 3 and
// touch emulation, asserted through matchMedia rather than inferred from the width. 320px goes
// through a real same-origin iframe because the top-level metrics override floors at ~348px on
// this build.
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';
import { makeTempDir, releaseTempDir, forwardChildTeardown, reportSilentChild } from './lib/harness-teardown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'BlogVis-2026!';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 240))); }
}
function section(t) { console.log('\n' + t); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ★ RETRY ONCE ON A DEAD KEEP-ALIVE SOCKET (register row W). Every runContrast() is a blocking
// spawnSync, which stalls this process's event loop long enough for the server to close the
// supabase client's idle socket — so the FIRST write after a child reliably fails with a bare
// "fetch failed". A first run of this suite died exactly there, on a write that was perfectly
// valid. Takes a thunk rather than a promise so the retry can genuinely re-issue the request.
async function must(thunk, what) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await thunk();
      if (!error) return;
      if (attempt === 1) throw new Error('could not ' + what + ': ' + error.message);
    } catch (e) {
      if (attempt === 1) throw new Error('could not ' + what + ': ' + (e && e.message));
    }
    await sleep(400);
  }
}

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

function runChild(script, env, label) {
  const res = spawnSync(process.execPath, [script], { cwd: HERE, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 900000 });
  forwardChildTeardown(res, label);
  reportSilentChild(res, label, /CONTRAST: (PASS|FAIL)|FONT AUDIT: /);
  return (res.stdout || '') + (res.stderr || '');
}
function runContrast(profile, label, url, bootstrap, prepare) {
  const out = runChild('verify-contrast.mjs', {
    CONTRAST_PROFILE: profile, CONTRAST_URL: url,
    CONTRAST_BOOTSTRAP_JS: bootstrap || '', CONTRAST_PREPARE_JS: prepare || '',
    CONTRAST_WIDTHS: '1440',
  }, 'verify-contrast(' + profile + ')');
  const m = out.match(/(\d+) measurements/);
  const tail = out.split('\n').filter((l) => /measurements|CONTRAST:|FAIL|UNMEASURED/.test(l)).join(' | ');
  // ★ A profile that measured NOTHING would report a confident pass — the vacuity class (§V).
  check(label + ': measured real elements (not an empty run)', !!m && Number(m[1]) > 0, tail);
  check(label + ': every measured surface clears 4.5:1', /CONTRAST: PASS/.test(out), tail);
  return m ? Number(m[1]) : 0;
}
function runFonts(url, bootstrap) {
  const out = runChild('verify-fonts.mjs', { AUDIT_URL: url, AUDIT_BOOTSTRAP_JS: bootstrap || '' }, 'verify-fonts');
  check('no font falls back on ' + url.replace(BASE, ''), !/FALLBACK/.test(out),
    out.split('\n').filter((l) => /FALLBACK/.test(l)).join(' | '));
  check('no monospace family — the scheme is Inter (row 192) on ' + url.replace(BASE, ''),
    !/JetBrains|monospace/i.test(out), out.split('\n').filter((l) => /JetBrains|monospace/i.test(l)).join(' | '));
}
function runSheen(pages) {
  const out = runChild('verify-glass-sheen.mjs', { SHEEN_PAGES: pages, SHEEN_BASE: BASE }, 'verify-glass-sheen');
  const m = out.match(/(\d+) measured/);
  check('sheen audit measured real text under a .glass sheen on ' + pages, !!m && Number(m[1]) > 0,
    out.split('\n').slice(-6).join(' | '));
  check('no text under the sheen falls below 4.5:1 on ' + pages,
    !/FAIL|UNMEASURED/.test(out), out.split('\n').filter((l) => /FAIL|UNMEASURED/.test(l)).join(' | '));
}

// --- CDP ---------------------------------------------------------------------------------------
async function connect(profile) {
  const PORT = 9600 + Math.floor(Math.random() * 180);
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--disable-gpu', 'about:blank',
  ], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(250);
    } catch (_e) { await sleep(250); }
  }
  if (!wsUrl) throw new Error('Could not reach headless Chrome on port ' + PORT);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + String(expr).slice(0, 140));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { chrome, ws, send, evaluate };
}
async function phone(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function desktop(cdp, width) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}
async function go(cdp, url, waitSel, session) {
  await cdp.send('Page.navigate', { url: BASE + '/blog-press.html' });
  await cdp.evaluate('new Promise(r => { if (document.readyState !== "loading") r(1); else addEventListener("DOMContentLoaded", () => r(1)); })');
  await cdp.evaluate('localStorage.removeItem("sb-127-auth-token"); 1');
  if (session) {
    const key = session.__admin ? 'sb-marketswave-admin-auth-token' : 'sb-127-auth-token';
    await cdp.evaluate('localStorage.setItem(' + JSON.stringify(key) + ', ' + JSON.stringify(JSON.stringify(session)) + '); 1');
  }
  await cdp.send('Page.navigate', { url });
  return cdp.evaluate(`(async () => {
    const nap = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 300; i++) {
      if (document.querySelector(${JSON.stringify(waitSel)})) { await nap(400); return true; }
      await nap(150);
    }
    return false;
  })()`);
}

/** Does anything overflow the viewport horizontally? Decorative subtrees excluded (row 238). */
const OVERFLOW = `(() => {
  const w = document.documentElement.clientWidth;
  const worst = { right: 0, what: '' };
  document.querySelectorAll('body *').forEach((el) => {
    if (el.closest('[aria-hidden="true"]')) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > worst.right) { worst.right = Math.round(r.right); worst.what = el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/)[0] : ''); }
  });
  return { scrollWidth: document.body.scrollWidth, clientWidth: w, worst };
})()`;

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const pm = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: pmS, error: pmErr } = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('could not sign in the local bootstrap PM: ' + pmErr.message);
  const pmTok = pmS.session.access_token;
  const adminSession = Object.assign({}, pmS.session, { __admin: true });

  const callAs = async (fn, body, token) => {
    const res = await fetch(st.API_URL + '/functions/v1/' + fn, {
      method: 'POST', headers: { apikey: st.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const profile = makeTempDir('mw-blogvis-');
  let cdp = null;
  const made = { posts: [], users: [] };
  const P = {};

  try {
    section('Setup — real posts, a real cover, a real thread');
    const up = await callAs('upload-article-image', { filename: 'cover-' + SUF + '.png', contentType: 'image/png', scope: 'blog', fileBase64: PNG_1PX }, pmTok);
    const coverPath = up.body.path;
    for (const d of [
      { key: 'feat', title: 'Appraisal valuations, visually ' + SUF, cat: 'private-equity', featured: true },
      { key: 'news', title: 'A change worth knowing ' + SUF, cat: 'company-news' },
      { key: 'exp', title: 'Pockets, fixed or anytime ' + SUF, cat: 'explainer' },
      { key: 'art', title: 'Idle cash costs more ' + SUF, cat: 'article' },
    ]) {
      const r = await callAs('save-blog-post', {
        title: d.title, slug: 'vis-' + d.key + '-' + SUF, category: d.cat,
        lede: 'A summary that runs to a realistic length so the card clamps the way a real one does.',
        blocks: [
          { type: 'heading', text: 'The short version' },
          { type: 'p', runs: [{ t: 'A unit is one share of an investment. ' }, { t: 'Bold here', b: true }, { t: '.' }] },
          { type: 'tip', body: [{ t: 'Taking money out returns it to your available balance.' }] },
        ],
        cover_path: coverPath, cover_alt: 'A chart on a dark background', featured: !!d.featured,
      }, pmTok);
      P[d.key] = r.body; made.posts.push(r.body.id);
      await callAs('publish-blog-post', { id: r.body.id }, pmTok);
    }
    // one draft, so the PM list and editor have both states
    const dr = await callAs('save-blog-post', {
      title: 'Still being written ' + SUF, slug: 'vis-draft-' + SUF, category: 'article',
      lede: 'A draft summary.', blocks: [{ type: 'p', runs: [{ t: 'Body.' }] }],
    }, pmTok);
    P.draft = dr.body; made.posts.push(dr.body.id);

    const clients = {};
    for (const tag of ['a', 'b']) {
      const email = 'blogvis-' + tag + '-' + SUF + '@invalid.test';
      const { data: u } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      made.users.push(u.user.id);
      await must(() => admin.from('clients').insert({
        id: u.user.id, name: (tag === 'a' ? 'Ada Visual ' : 'Ben Visual ') + SUF, email,
        phone: '+46000000000', account_type: 'Individual Account', status: 'active',
      }), 'seed client');
      const c = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: s } = await c.auth.signInWithPassword({ email, password: PASSWORD });
      clients[tag] = { id: u.user.id, session: s.session, token: s.session.access_token };
    }
    const c1 = await callAs('post-blog-comment', { postId: P.exp.id, body: 'Clear and short. More of these, please.' }, clients.a.token);
    await callAs('post-blog-comment', { postId: P.exp.id, parentId: c1.body.id, body: 'Agreed, this answered my question.' }, clients.b.token);
    await callAs('post-blog-comment', { postId: P.exp.id, body: 'Made 38% on this, everyone should get in.' }, clients.b.token);
    await callAs('toggle-blog-like', { postId: P.exp.id, liked: true }, clients.a.token);
    check('(setup) real content exists to measure', made.posts.length === 5);

    const LIST = BASE + '/blog-press.html';
    const POST = BASE + '/blog-press.html?p=vis-exp-' + SUF;
    const ADMIN = BASE + '/admin-blog.html';
    const EDITOR = BASE + '/admin-blog-post.html?id=' + P.draft.id;

    const clientBoot = 'localStorage.setItem("sb-127-auth-token", ' + JSON.stringify(JSON.stringify(clients.a.session)) + ')';
    const adminBoot = 'localStorage.setItem("sb-marketswave-admin-auth-token", ' + JSON.stringify(JSON.stringify(pmS.session)) + ')';
    // ★ A PREPARE HOOK MUST WAIT FOR THE PAGE FIRST — verify-contrast runs it after a fixed
    // settle, and an async page can still be rendering then (row 238's finding).
    const READY = (sel) => '(async () => { const nap = (ms) => new Promise(r => setTimeout(r, ms));'
      + ' for (let i = 0; i < 200; i++) { if (document.querySelector(' + JSON.stringify(sel) + ')) break; await nap(150); } await nap(500); ';

    section('1. Contrast — the public listing, with the sheen composited');
    const n1 = runContrast('blogListing', 'listing', LIST, '', READY('.bp-card') + 'return 1; })()');

    section('2. Contrast — the post, signed in');
    const n2 = runContrast('blogPost', 'post (signed in)', POST, clientBoot, READY('.bp-compose') + 'return 1; })()');

    // The confirm step only exists after a click, so the prepare hook makes it exist.
    const CLICK_REMOVE = READY('.bp-cact') +
      ' const b = [...document.querySelectorAll(".bp-cact button")].find(x => x.textContent.trim() === "Remove");' +
      ' if (b) { b.click(); } for (let i = 0; i < 100; i++) { if (document.querySelector(".bp-cq")) break; await nap(100); }' +
      ' await nap(400); return !!document.querySelector(".bp-cq"); })()';
    const n2b = runContrast('blogRemoveConfirm', 'post (own comment, mid-confirm)', POST, clientBoot, CLICK_REMOVE);
    // *** runContrast's own guard only asks that SOMETHING was measured, and the comment body
    // behind the question is always there -- so this profile could report a confident pass with
    // the confirm step never opening at all. Four of its five selectors only exist mid-confirm,
    // so the COUNT is what proves the click landed.
    check('the confirm step genuinely opened (4 of its surfaces exist only mid-confirm)', n2b >= 5,
      'measured ' + n2b + ', expected at least 5');

    section('3. Contrast — the two states that refuse a writer');
    const n3 = runContrast('blogGates', 'post (signed out)', POST, '', READY('.bp-signin') + 'return 1; })()');
    // pending: flip the real status, measure, flip it back
    await must(() => admin.from('clients').update({ status: 'pending_review' }).eq('id', clients.b.id), 'set pending');
    const pendBoot = 'localStorage.setItem("sb-127-auth-token", ' + JSON.stringify(JSON.stringify(clients.b.session)) + ')';
    const n3b = runContrast('blogGates', 'post (pending client)', POST, pendBoot, READY('.bp-pending') + 'return 1; })()');
    await must(() => admin.from('clients').update({ status: 'active' }).eq('id', clients.b.id), 'restore active');

    section('4. Contrast — the PM tool');
    const n4 = runContrast('blogAdmin', 'PM posts tab', ADMIN, adminBoot, READY('.bl-tr') + 'return 1; })()');
    const n5 = runContrast('blogAdminComments', 'PM comments tab', ADMIN, adminBoot,
      READY('.bl-tr') + 'document.querySelector("#bl-tab-comments").click();'
      + ' for (let i = 0; i < 200; i++) { if (document.querySelector(".bl-qc")) break; await nap(150); } await nap(500); return 1; })()');
    const n6 = runContrast('blogEditor', 'PM editor', EDITOR, adminBoot, READY('.bl-chk') + 'return 1; })()');
    console.log('  (measured ' + (n1 + n2 + n2b + n3 + n3b + n4 + n5 + n6) + ' composited-pixel readings in total)');

    section('5. The sheen audit');
    runSheen('blog-press.html');

    section('6. Fonts');
    runFonts(LIST);
    runFonts(EDITOR, adminBoot);

    section('7. Narrow widths, on a REAL phone profile');
    cdp = await connect(profile);
    for (const w of [390, 375]) {
      await phone(cdp, w);
      await go(cdp, LIST, '.bp-card');
      const m = await cdp.evaluate('({ w: window.innerWidth, coarse: matchMedia("(pointer: coarse)").matches, nohover: matchMedia("(hover: none)").matches, dpr: devicePixelRatio, touch: navigator.maxTouchPoints })');
      check(w + 'px is a real phone profile, not a narrow window',
        m.w === w && m.coarse === true && m.nohover === true && m.dpr === 3 && m.touch > 0, m);
      const o = await cdp.evaluate(OVERFLOW);
      check(w + 'px listing: nothing overflows horizontally', o.scrollWidth <= o.clientWidth + 1, o);
      check(w + 'px listing: the grid is one column',
        (await cdp.evaluate('getComputedStyle(document.querySelector(".bp-grid")).gridTemplateColumns.split(" ").length')) === 1,
        await cdp.evaluate('getComputedStyle(document.querySelector(".bp-grid")).gridTemplateColumns'));
      check(w + 'px listing: the media band stacks',
        (await cdp.evaluate('getComputedStyle(document.querySelector(".bp-mtiles")).gridTemplateColumns.split(" ").length')) === 1);

      await go(cdp, POST, '.bp-compose', clients.a.session);
      const op = await cdp.evaluate(OVERFLOW);
      check(w + 'px post: nothing overflows horizontally', op.scrollWidth <= op.clientWidth + 1, op);
      // ★ Measured against its CONTAINER, not the viewport: the button sits four padded boxes
      // deep, so a fraction-of-viewport threshold measures the padding, not the button.
      const btnFull = await cdp.evaluate(`(() => {
        const b = document.querySelector('.bp-bA');
        const p = b.parentElement;
        const cs = getComputedStyle(p);
        const inner = p.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { btn: Math.round(b.getBoundingClientRect().width), inner: Math.round(inner) };
      })()`);
      check(w + 'px post: the comment box is full width of its container',
        Math.abs(btnFull.btn - btnFull.inner) <= 1, btnFull);
      check(w + 'px post: the comment box clears the 44px tap floor',
        (await cdp.evaluate('document.querySelector(".bp-bA").getBoundingClientRect().height')) >= 44,
        await cdp.evaluate('document.querySelector(".bp-bA").getBoundingClientRect().height'));

      // ★ THE COMMENT ACTIONS, WHICH NOTHING HAD EVER MEASURED. Reply / Remove / Yes / Cancel
      // are the only controls on this page that a shared stylesheet does not floor: blog-press.html
      // is a PUBLIC page and never loads tap-targets.css, and styles.css's own mobile block floors
      // footer links and the Get Access dismiss, not buttons generally. The rule carried
      // `min-height: 0`, which on the Tailwind pages is the documented trap and here was worse
      // than useless — it overrode nothing while making the absence of a floor look intended.
      // Measured on the REAL rendered box, and the count guards against passing on an empty set.
      const acts = await cdp.evaluate(`(() => {
        const b = [...document.querySelectorAll('.bp-cact button')];
        return { n: b.length, min: b.length ? Math.min(...b.map(x => Math.round(x.getBoundingClientRect().height))) : 0,
                 labels: b.map(x => x.textContent.trim()).join('|') };
      })()`);
      check(w + 'px post: the comment actions were actually found (non-vacuity)', acts.n > 0, acts);
      check(w + 'px post: ★ every comment action clears the 44px tap floor', acts.n > 0 && acts.min >= 44, acts);

      await go(cdp, ADMIN, '.bl-tr', adminSession);
      const oa = await cdp.evaluate(OVERFLOW);
      check(w + 'px PM posts: nothing overflows horizontally', oa.scrollWidth <= oa.clientWidth + 1, oa);
      check(w + 'px PM posts: the row still names the post AND its status (restack, not hide)',
        (await cdp.evaluate('getComputedStyle(document.querySelector(".bl-tr .bl-tn")).display')) !== 'none'
        && (await cdp.evaluate('getComputedStyle(document.querySelector(".bl-tr .bl-stat")).display')) !== 'none');
      check(w + 'px PM: every filter pill clears the 44px tap floor',
        await cdp.evaluate('[...document.querySelectorAll(".bl-fp")].every(p => p.getBoundingClientRect().height >= 44)'),
        await cdp.evaluate('[...document.querySelectorAll(".bl-fp")].map(p => Math.round(p.getBoundingClientRect().height))'));

      await go(cdp, EDITOR, '.bl-chk', adminSession);
      const oe = await cdp.evaluate(OVERFLOW);
      check(w + 'px editor: nothing overflows horizontally', oe.scrollWidth <= oe.clientWidth + 1, oe);
      check(w + 'px editor: the settings column drops below the form',
        (await cdp.evaluate('getComputedStyle(document.querySelector(".bl-edgrid")).gridTemplateColumns.split(" ").length')) === 1);
    }

    // 320px through a real same-origin iframe: the top-level override floors at ~348px here
    await desktop(cdp, 1200);
    await go(cdp, LIST, '.bp-card');
    const narrow = await cdp.evaluate(`(async () => {
      const nap = (ms) => new Promise(r => setTimeout(r, ms));
      const f = document.createElement('iframe');
      f.style.cssText = 'width:320px;height:700px;border:0;position:fixed;top:0;left:0;z-index:99999';
      f.src = ${JSON.stringify(LIST)};
      document.body.appendChild(f);
      for (let i = 0; i < 260; i++) {
        try { if (f.contentDocument && f.contentDocument.querySelector('.bp-card')) break; } catch (e) {}
        await nap(150);
      }
      await nap(900);
      const d = f.contentDocument;
      if (!d || !d.querySelector('.bp-card')) return { rendered: false };
      const cols = getComputedStyle(d.querySelector('.bp-grid')).gridTemplateColumns.split(' ').length;
      let worst = 0, what = '';
      d.querySelectorAll('body *').forEach((el) => {
        if (el.closest('[aria-hidden="true"]')) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > worst) { worst = Math.round(r.right); what = el.tagName + '.' + String(el.className || '').split(/\\s+/)[0]; }
      });
      return { rendered: true, width: d.documentElement.clientWidth, scrollWidth: d.body.scrollWidth, cols, worst, what };
    })()`);
    check('320px: the listing genuinely rendered in the iframe', narrow.rendered === true, narrow);
    check('320px: the viewport really is 320', narrow.width === 320, narrow);
    check('320px: nothing overflows horizontally', narrow.scrollWidth <= narrow.width + 1, narrow);
    check('320px: the grid is one column', narrow.cols === 1, narrow);

  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (_e) {} }
    for (const id of made.users) {
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const id of made.posts) await admin.from('blog_posts').delete().eq('id', id);
    const { data: leftP } = await admin.from('blog_posts').select('id').like('slug', '%' + SUF);
    console.log('\ncleanup: posts remaining ' + ((leftP || []).length));
    if (cdp && cdp.chrome) cdp.chrome.kill();
    await releaseTempDir(profile);
  }

  console.log('\n' + passed + ' passed, ' + fails.length + ' failed.');
  if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exitCode = 1; }
  console.log(fails.length ? 'BLOG PRESS VISUAL: FAIL' : 'BLOG PRESS VISUAL: PASS');
}

runVerifyMain(main, { watchdogMs: 30 * 60 * 1000 });
