// Blog & Press — the REAL pages, in a REAL browser (2026-09-24, register row 274).
//
// The backend half is verify-supabase-blog-press.js. This is the half only a running page proves:
//   - the public listing: filter counts, search, the featured post, "Showing N of M", the empty state
//   - the public post: cover, byline, blocks, Like, comments, the reply box, and who may write
//   - ★ a <script> in a comment RENDERS AS LITERAL TEXT. The backend proves it is STORED as text;
//     only a real DOM proves no element is created from it and nothing executes.
//   - the PM tool: both tabs sharing one header and health strip, every filter, the editor's
//     server-derived checklist, and BOTH Publish buttons disabling together
//
// ★ A REAL BROWSER, NOT jsdom, AND THAT IS NOT A PREFERENCE. blog.js and admin-blog-page.js both
// reach their configuration through a dynamic import('./supabase-endpoint.js'). jsdom has no ESM
// module support at all, so under it the pages render nothing — a first draft of this suite failed
// exactly that way, with every assertion reporting an empty page rather than a real defect.
//
// ★ NAV IS ASSERTED (row 228): the approval gate shipped with no rail and neither a browser render
// nor a 69-assertion suite caught it, because everything looked at the feature and nothing at the
// chrome around it.
import { execSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyMain } from './lib/run-verify.mjs';
import { makeTempDir, releaseTempDir } from './lib/harness-teardown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SUF = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'BlogUI-2026!';
// a real, valid 1x1 PNG — enough for Storage to hold genuine bytes behind the cover path
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const XSS = '<script>window.__pwned = true;</script><img src=x onerror="window.__pwned=true">';

let passed = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 220))); }
}
function section(t) { console.log('\n' + t); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function must(p, what) { const { error } = await p; if (error) throw new Error('could not ' + what + ': ' + error.message); }

function localStack() {
  const raw = execSync('npx supabase status -o json', { cwd: ROOT, encoding: 'utf8' }).replace(/^[^{]*/, '');
  const j = JSON.parse(raw);
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

// --- CDP (the shape every visual suite in this project uses) ---------------------------------
async function connect(profile) {
  const PORT = 9800 + Math.floor(Math.random() * 180);
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

/** Navigate, optionally planting a real client session first, then wait for a real selector. */
async function go(cdp, url, waitSel, session) {
  await cdp.send('Page.navigate', { url: BASE + '/blog-press.html' });   // same origin, for storage
  await cdp.evaluate('new Promise(r => { if (document.readyState !== "loading") r(1); else addEventListener("DOMContentLoaded", () => r(1)); })');
  // ★ The two personas keep SEPARATE storage keys on purpose (Admin Auth Consolidation), so a
  // blanket localStorage.clear() here would sign the PM out and the admin pages would correctly
  // redirect to the gate — which is what a first run of this suite did.
  await cdp.evaluate('localStorage.removeItem("sb-127-auth-token"); 1');
  if (session) {
    const key = session.__admin ? 'sb-marketswave-admin-auth-token' : 'sb-127-auth-token';
    await cdp.evaluate('localStorage.setItem(' + JSON.stringify(key) + ', ' + JSON.stringify(JSON.stringify(session)) + '); 1');
  }
  await cdp.send('Page.navigate', { url });
  const ok = await cdp.evaluate(`(async () => {
    const nap = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 300; i++) {
      if (document.querySelector(${JSON.stringify(waitSel)})) { await nap(350); return true; }
      await nap(150);
    }
    return false;
  })()`);
  return ok;
}
async function waitFor(cdp, expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try { if (await cdp.evaluate('!!(' + expr + ')')) return true; } catch (_e) {}
    await sleep(160);
  }
  return false;
}
async function waitDb(fn, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn()) return true; await sleep(300); }
  return false;
}
const T = (sel) => `(document.querySelector(${JSON.stringify(sel)})||{}).textContent`;
const TRIM = (sel) => `((document.querySelector(${JSON.stringify(sel)})||{}).textContent||'').replace(/\\s+/g,' ').trim()`;
const N = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;
const BODY = 'document.body.textContent';

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // a real PM session, for the setup calls and for the PM pages
  const pm = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: pmS, error: pmErr } = await pm.auth.signInWithPassword({ email: 'pm@marketswave.local', password: 'MarketswavePM-Local-2026!' });
  if (pmErr) throw new Error('could not sign in the local bootstrap PM: ' + pmErr.message);

  const callAs = async (fn, body, token) => {
    const res = await fetch(st.API_URL + '/functions/v1/' + fn, {
      method: 'POST',
      headers: { apikey: st.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const profile = makeTempDir('mw-blogui-');
  let cdp = null;
  const made = { posts: [], users: [] };
  const P = {};

  try {
    // ===========================================================================================
    section('Setup — four real posts and two real clients, through the real functions');
    // ===========================================================================================
    const defs = [
      { key: 'feat', title: 'Appraisal valuations explained ' + SUF, cat: 'private-equity', featured: true, publish: true },
      { key: 'news', title: 'Savings withdrawals changed ' + SUF, cat: 'company-news', publish: true },
      { key: 'exp', title: 'Fixed or anytime pockets ' + SUF, cat: 'explainer', publish: true },
      { key: 'draft', title: 'Unfinished thought ' + SUF, cat: 'article', publish: false },
    ];
    // ★ A REAL uploaded image, not a made-up path. A path with nothing behind it makes the page
    // fall back to its tint — correct behaviour, but it means a cover assertion would be testing
    // the fallback rather than the cover. A first run of this suite failed exactly that way.
    const up = await callAs('upload-article-image', {
      filename: 'cover-' + SUF + '.png', contentType: 'image/png', scope: 'blog',
      fileBase64: PNG_1PX,
    }, pmS.session.access_token);
    if (up.status !== 200) throw new Error('upload-article-image: ' + JSON.stringify(up.body));
    const coverPath = up.body.path;

    for (const d of defs) {
      const body = {
        title: d.title, slug: 'ui-' + d.key + '-' + SUF, category: d.cat,
        lede: 'A summary for ' + d.key + ', long enough to read like a real one on a card.',
        blocks: [
          { type: 'heading', text: 'The short version' },
          { type: 'p', runs: [{ t: 'A unit is one share of an investment. ' }, { t: 'Bold here', b: true }, { t: '.' }] },
          { type: 'tip', body: [{ t: 'Taking money out returns it to your available balance.' }] },
        ],
        featured: !!d.featured,
      };
      if (d.publish) { body.cover_path = coverPath; body.cover_alt = 'A chart on a dark background'; }
      const r = await callAs('save-blog-post', body, pmS.session.access_token);
      if (r.status !== 200) throw new Error('save-blog-post: ' + JSON.stringify(r.body));
      P[d.key] = r.body; made.posts.push(r.body.id);
      if (d.publish) await callAs('publish-blog-post', { id: r.body.id }, pmS.session.access_token);
    }
    check('four posts exist, three published and one draft', made.posts.length === 4);

    const clients = {};
    for (const tag of ['a', 'b']) {
      const email = 'blogui-' + tag + '-' + SUF + '@invalid.test';
      const { data: u, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw new Error('createUser: ' + error.message);
      made.users.push(u.user.id);
      const name = (tag === 'a' ? 'Ada Blogreader ' : 'Ben Blogreader ') + SUF;
      await must(admin.from('clients').insert({
        id: u.user.id, name, email, phone: '+46000000000', account_type: 'Individual Account', status: 'active',
      }), 'seed client ' + tag);
      const c = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: s } = await c.auth.signInWithPassword({ email, password: PASSWORD });
      clients[tag] = { id: u.user.id, name, session: s.session, token: s.session.access_token };
    }

    const c1 = await callAs('post-blog-comment', { postId: P.exp.id, body: 'Clear and short. More of these, please.' }, clients.a.token);
    const r1 = await callAs('post-blog-comment', { postId: P.exp.id, parentId: c1.body.id, body: 'Agreed, this answered my question.' }, clients.b.token);
    const flag = await callAs('post-blog-comment', { postId: P.exp.id, body: 'Made 38% on this, everyone should get in.' }, clients.b.token);
    const xss = await callAs('post-blog-comment', { postId: P.exp.id, body: XSS }, clients.a.token);
    check('(setup) a real thread exists: comment, reply, a flagged one and a script probe',
      !!(c1.body.id && r1.body.id && flag.body.flagged && xss.body.id));
    await callAs('toggle-blog-like', { postId: P.exp.id, liked: true }, clients.a.token);

    cdp = await connect(profile);

    // ===========================================================================================
    section('1. The public listing');
    // ===========================================================================================
    let ok = await go(cdp, BASE + '/blog-press.html', '.bp-card, .bp-empty');
    check('the listing renders', ok);
    check('the hero renders', (await cdp.evaluate(TRIM('.bp-hero h1'))) === 'Insights and news', await cdp.evaluate(TRIM('.bp-hero h1')));
    check('★ the featured post is the one marked featured',
      (await cdp.evaluate(TRIM('.bp-feat h2'))) === P.feat.title, await cdp.evaluate(TRIM('.bp-feat h2')));
    check('★ the DRAFT is NOT on the page anywhere',
      !(await cdp.evaluate(BODY + '.indexOf(' + JSON.stringify(P.draft.title) + ') !== -1')));

    check('the filter offers All plus the four categories', (await cdp.evaluate(N('.bp-ft'))) === 5, await cdp.evaluate(N('.bp-ft')));
    const allCount = await cdp.evaluate('Number(document.querySelectorAll(".bp-ft")[0].querySelector(".bp-n").textContent)');
    const dbPublished = (await admin.from('blog_posts').select('id').not('published_at', 'is', null)).data.length;
    check('★ the All count equals the real number of published posts', allCount === dbPublished, allCount + ' vs ' + dbPublished);
    check('★ "Showing N of M" states the real total',
      await cdp.evaluate('/Showing \\d+ of ' + dbPublished + ' posts?/.test(' + TRIM('.bp-more span') + ')'),
      await cdp.evaluate(TRIM('.bp-more span')));

    await cdp.evaluate('(() => { const i = document.querySelector(".bp-fsearch input"); i.value = ' + JSON.stringify(P.exp.title) + '; i.dispatchEvent(new Event("input", {bubbles:true})); return 1; })()');
    await sleep(250);
    check('★ search narrows to the matching post', (await cdp.evaluate(TRIM('.bp-feat h2'))) === P.exp.title, await cdp.evaluate(TRIM('.bp-feat h2')));
    check('★ ...and the filter counts follow the search',
      (await cdp.evaluate('Number(document.querySelectorAll(".bp-ft")[0].querySelector(".bp-n").textContent)')) === 1);
    await cdp.evaluate('(() => { const i = document.querySelector(".bp-fsearch input"); i.value = "zzz-no-such-post"; i.dispatchEvent(new Event("input", {bubbles:true})); return 1; })()');
    await sleep(250);
    check('★ an empty result is an honest sentence, never "coming soon" cards',
      (await cdp.evaluate('/No posts match/.test(' + TRIM('.bp-empty') + ')'))
      && (await cdp.evaluate(N('.bp-card'))) === 0
      && !(await cdp.evaluate(BODY + '.indexOf("Coming Soon") !== -1')));
    check('...and the media band still stands on its own', (await cdp.evaluate(N('.bp-media'))) === 1);

    const media = await cdp.evaluate(TRIM('.bp-media'));
    check('★ the press address is not invented', media.indexOf('Address to be confirmed') !== -1, media);
    check('★ the press kit does not link to nothing',
      /Not available yet/.test(media) && (await cdp.evaluate(N('.bp-media a[href="#"]'))) === 0);
    check('the press email is a real mailto',
      (await cdp.evaluate('(document.querySelector(".bp-media a[href^=\'mailto:\']")||{}).href||""')).indexOf('support@marketswave.net') !== -1);

    // ===========================================================================================
    section('2. The public post, signed out');
    // ===========================================================================================
    ok = await go(cdp, BASE + '/blog-press.html?p=ui-exp-' + SUF, '.bp-pbody h1');
    check('the post renders', ok);
    check('the headline renders', (await cdp.evaluate(TRIM('.bp-pbody h1'))) === P.exp.title, await cdp.evaluate(TRIM('.bp-pbody h1')));
    check('the byline defaults to Marketswave', (await cdp.evaluate(TRIM('.bp-byl .bp-bn b'))) === 'Marketswave');
    check('the body renders through the shared block renderer',
      (await cdp.evaluate(N('.bp-art .ha-h2'))) === 1 && (await cdp.evaluate(N('.bp-art .ha-p'))) >= 1
      && (await cdp.evaluate(N('.bp-art .ha-tip'))) === 1);
    check('...including the bold run a PM typed', (await cdp.evaluate(N('.bp-art .ha-p strong'))) === 1);
    check('★ the renderer\'s own styles actually apply (article-render.css is linked)',
      (await cdp.evaluate('getComputedStyle(document.querySelector(".bp-art .ha-h2")).fontWeight')) === '600',
      await cdp.evaluate('getComputedStyle(document.querySelector(".bp-art .ha-h2")).fontWeight'));
    check('the cover carries its screen-reader description',
      (await cdp.evaluate('(document.querySelector(".bp-pcover img")||{}).alt||""')) === 'A chart on a dark background');

    await waitFor(cdp, 'document.querySelector("#bp-comments")');
    check('★ a signed-out visitor CAN read the comments',
      await cdp.evaluate(TRIM('#bp-comments') + '.indexOf("Clear and short") !== -1'));
    check('★ ...and is offered a sign-in instead of a comment box',
      (await cdp.evaluate(N('.bp-signin'))) === 1 && (await cdp.evaluate(N('.bp-compose'))) === 0);
    check('★ ...and the Like button is not usable', await cdp.evaluate('document.querySelector(".bp-likebtn").disabled === true'));

    // ★ THE RENDERING HALF OF THE XSS PROOF
    check('★ a comment containing a script tag is RENDERED AS LITERAL TEXT',
      await cdp.evaluate(BODY + '.indexOf("<script>window.__pwned") !== -1'));
    check('★ ...and created NO script element and NO img element from it',
      (await cdp.evaluate(N('#bp-comments script'))) === 0 && (await cdp.evaluate(N('#bp-comments img'))) === 0);
    check('★ ...and nothing executed', (await cdp.evaluate('window.__pwned === undefined')) === true);
    check('the flagged comment is PUBLIC, exactly like any other',
      await cdp.evaluate(BODY + '.indexOf("Made 38% on this") !== -1'));

    // ===========================================================================================
    section('3. The public post, signed in as an active client');
    // ===========================================================================================
    ok = await go(cdp, BASE + '/blog-press.html?p=ui-exp-' + SUF, '.bp-compose', clients.a.session);
    check('★ an active client gets a comment box', ok);
    check('...with the notice saying it is public, straight away, with their full name',
      await cdp.evaluate('/straight away, publicly, with your full name/.test(' + TRIM('.bp-cfoot .bp-note') + ')'));
    check('...and a character counter against the real limit',
      await cdp.evaluate('/0 of 1500/.test(' + TRIM('.bp-cnt') + ')'), await cdp.evaluate(TRIM('.bp-cnt')));
    check('...and the Like button is usable', await cdp.evaluate('document.querySelector(".bp-likebtn").disabled !== true'));
    check('★ the Like button shows their OWN like back to them',
      await cdp.evaluate('/Liked/.test(' + TRIM('.bp-likebtn') + ')'), await cdp.evaluate(TRIM('.bp-likebtn')));
    check('★ a comment shows the client tag and their real name',
      await cdp.evaluate(TRIM('#bp-comments') + '.indexOf(' + JSON.stringify(clients.a.name) + ') !== -1')
      && (await cdp.evaluate(N('.bp-tag'))) >= 1);

    await cdp.evaluate('(() => { const b = [...document.querySelectorAll(".bp-cact button")].find(x => x.textContent.trim() === "Reply"); b.click(); return 1; })()');
    await waitFor(cdp, 'document.querySelector(".bp-rcompose")');
    check('★ the reply box names who is being replied to',
      await cdp.evaluate('/Replying to/.test(' + TRIM('.bp-rcompose label') + ')'), await cdp.evaluate(TRIM('.bp-rcompose label')));
    check('...and repeats that a reply is public and named',
      await cdp.evaluate('/publicly, with your full name/.test(' + TRIM('.bp-rnote') + ')'));

    const replyText = 'A reply typed through the real page ' + SUF;
    await cdp.evaluate('(() => { const t = document.querySelector("#bp-reply-ta"); t.value = ' + JSON.stringify(replyText) + '; t.dispatchEvent(new Event("input",{bubbles:true})); document.querySelector(".bp-rpost").click(); return 1; })()');
    const landed = await waitDb(async () => {
      const { data } = await admin.from('blog_comments').select('id, parent_id').eq('body', replyText).maybeSingle();
      return data && data.parent_id === c1.body.id;
    });
    check('★ a real reply posts from the real page, attached to the ORIGINAL comment', landed);
    check('★ ...and appears without a reload',
      await waitFor(cdp, BODY + '.indexOf(' + JSON.stringify(replyText) + ') !== -1', 15000));

    // ---- the client's own Remove ---------------------------------------------------------
    // ★ OWNERSHIP IS NOT IN THE PUBLIC VIEW, AND MUST NOT BE. blog_comments_public carries no
    // client_id, so the page learns which comments are the viewer's by reading blog_comments
    // under the client's OWN RLS policy. That is what these assertions really test: if someone
    // later "simplifies" it by adding client_id to the view, the door in section 2 opens.
    const ownRemoveBtns = '(() => [...document.querySelectorAll(".bp-cm")].map(n => ({' +
      ' text: n.textContent, remove: [...n.querySelectorAll(".bp-cact button")].some(b => b.textContent.trim() === "Remove") })))()';
    let rows = await cdp.evaluate(ownRemoveBtns);
    const mineRow = rows.find((r) => r.text.indexOf(replyText) !== -1);
    const theirsRow = rows.find((r) => r.text.indexOf('Agreed, this answered my question') !== -1);
    check("★ Remove is offered on the client's OWN comment", !!mineRow && mineRow.remove === true, JSON.stringify(mineRow));
    check("★ ...and is NOT offered on another client's comment", !!theirsRow && theirsRow.remove === false, JSON.stringify(theirsRow));
    check('...so it appears on some comments and not others (non-vacuity)',
      rows.some((r) => r.remove) && rows.some((r) => !r.remove),
      rows.map((r) => r.remove).join(','));

    // First click asks; it must NOT remove.
    await cdp.evaluate('(() => { const n = [...document.querySelectorAll(".bp-cm")].find(x => x.textContent.indexOf(' +
      JSON.stringify(replyText) + ') !== -1); [...n.querySelectorAll(".bp-cact button")].find(b => b.textContent.trim() === "Remove").click(); return 1; })()');
    await waitFor(cdp, 'document.querySelector(".bp-cq")');
    check('★ the first click asks rather than acting — a real confirm step',
      await cdp.evaluate('/Remove this\?/.test(' + TRIM('.bp-cq') + ')'), await cdp.evaluate(TRIM('.bp-cq')));
    const { data: notYet } = await admin.from('blog_comments').select('removed_at').eq('body', replyText).maybeSingle();
    check('★ ...and nothing is removed while the question is on screen', notYet.removed_at === null, JSON.stringify(notYet));

    // Cancel puts it back, so a misclick costs nothing.
    await cdp.evaluate('(() => { [...document.querySelectorAll(".bp-cact button")].find(b => b.textContent.trim() === "Cancel").click(); return 1; })()');
    await waitFor(cdp, 'document.querySelectorAll(".bp-cq").length === 0');
    check('Cancel withdraws the question and leaves the comment alone',
      (await cdp.evaluate(N('.bp-cq'))) === 0 && (await cdp.evaluate(BODY + '.indexOf(' + JSON.stringify(replyText) + ') !== -1')));

    // Now really remove it.
    await cdp.evaluate('(() => { const n = [...document.querySelectorAll(".bp-cm")].find(x => x.textContent.indexOf(' +
      JSON.stringify(replyText) + ') !== -1); [...n.querySelectorAll(".bp-cact button")].find(b => b.textContent.trim() === "Remove").click(); return 1; })()');
    await waitFor(cdp, 'document.querySelector(".bp-cdanger")');
    await cdp.evaluate('document.querySelector(".bp-cdanger").click(); 1');
    const selfGone = await waitDb(async () => {
      const { data } = await admin.from('blog_comments').select('removed_at, removed_by').eq('body', replyText).maybeSingle();
      return data && data.removed_at !== null && data.removed_by === clients.a.id;
    });
    check('★ the second click really removes it, recorded against the AUTHOR', selfGone);
    check('★ ...and it leaves the page without a reload — it had no replies, so it is gone entirely',
      await waitFor(cdp, BODY + '.indexOf(' + JSON.stringify(replyText) + ') === -1', 15000));

    // ===========================================================================================
    section('4. The public post, signed in but NOT active');
    // ===========================================================================================
    await must(admin.from('clients').update({ status: 'pending_review' }).eq('id', clients.b.id), 'set pending');
    ok = await go(cdp, BASE + '/blog-press.html?p=ui-exp-' + SUF, '.bp-pending, .bp-compose', clients.b.session);
    check('the post renders for a pending client', ok);
    check('★ a pending-review client gets no comment box', (await cdp.evaluate(N('.bp-compose'))) === 0);
    check('★ ...and is told why, in their own words',
      await cdp.evaluate('/under review/i.test(' + TRIM('.bp-pending') + ')'), await cdp.evaluate(TRIM('.bp-pending')));
    check('★ ...and can still READ every comment', await cdp.evaluate(BODY + '.indexOf("Clear and short") !== -1'));
    check('★ ...and cannot like it either', await cdp.evaluate('document.querySelector(".bp-likebtn").disabled === true'));
    await must(admin.from('clients').update({ status: 'active' }).eq('id', clients.b.id), 'restore active');

    // ===========================================================================================
    section('5. The PM tool — one header above both tabs');
    // ===========================================================================================
    const pageSrc = readFileSync(path.join(ROOT, 'admin-blog.html'), 'utf8');
    check('★ admin-blog.html mounts the shared nav (row 228)', /initAdminSidebar\('blog'\)/.test(pageSrc));
    check('★ admin-blog-post.html mounts it too', /initAdminSidebar\('blog'\)/.test(readFileSync(path.join(ROOT, 'admin-blog-post.html'), 'utf8')));
    const railSrc = readFileSync(path.join(ROOT, 'admin-sidebar.js'), 'utf8');
    check('★ the rail item sits between Help Center and Advisory fee',
      railSrc.indexOf("key: 'help'") < railSrc.indexOf("key: 'blog'") &&
      railSrc.indexOf("key: 'blog'") < railSrc.indexOf("key: 'settings'"));
    check('★ ...and has its own icon', /\n    blog: '<path/.test(railSrc));

    // the PM pages sign themselves in through admin-supabase-config.js, which auto-signs in
    // against the local stack — nothing to plant.
    const adminSession = Object.assign({}, pmS.session, { __admin: true });
    ok = await go(cdp, BASE + '/admin-blog.html', '.bl-hc', adminSession);
    check('the PM page renders', ok);
    check('★ the rendered rail is actually there, with Blog & Press active',
      (await cdp.evaluate(N('#admin-sidebar-mount .an-item'))) > 0
      && (await cdp.evaluate('!!document.querySelector(\'.an-item.is-on[href="admin-blog.html"]\')')));
    // Log out is an icon-only control, so its accessible name is the assertion, not page text.
    check('★ ...and Log out is reachable',
      (await cdp.evaluate(N('#admin-logout-btn'))) === 1
      && (await cdp.evaluate('document.querySelector("#admin-logout-btn").getAttribute("aria-label")')) === 'Log out');

    check('the health strip has four cards', (await cdp.evaluate(N('.bl-hc'))) === 4);
    const strip = await cdp.evaluate('[...document.querySelectorAll(".bl-hc .bl-k")].map(e=>e.textContent).join("|")');
    check('★ ...Published, Drafts, Flagged comments and Likes',
      strip === 'Published|Drafts|Flagged comments|Likes · 30 days', strip);
    check('★ the Flagged comments card counts the real flagged, live ones and warns',
      (await cdp.evaluate('Number(document.querySelectorAll(".bl-hc")[2].querySelector(".bl-v").textContent)')) >= 1
      && (await cdp.evaluate('document.querySelectorAll(".bl-hc")[2].className.indexOf("bl-warn") !== -1')));
    check('the drafts card counts the real draft',
      (await cdp.evaluate('Number(document.querySelectorAll(".bl-hc")[1].querySelector(".bl-v").textContent)')) >= 1);

    check('★ the DRAFT appears in the PM list (the public page cannot see it)',
      await cdp.evaluate(BODY + '.indexOf(' + JSON.stringify(P.draft.title) + ') !== -1'));
    const drow = 'rowFor=' + JSON.stringify(P.draft.title);
    const draftInfo = await cdp.evaluate(`(() => {
      const r = [...document.querySelectorAll('.bl-tr')].find(x => (x.querySelector('.bl-tn b')||{}).textContent === ${JSON.stringify(P.draft.title)});
      if (!r) return null;
      return { stat: (r.querySelector('.bl-stat')||{}).textContent, txt: r.textContent.replace(/\\s+/g,' '), zeros: r.querySelectorAll('.bl-zero').length };
    })()`);
    check('...marked Draft', draftInfo && draftInfo.stat === 'Draft', draftInfo);
    check('...with no cover and no figures, shown as em dashes not zeros',
      draftInfo && draftInfo.txt.indexOf('no cover yet') !== -1 && draftInfo.zeros === 2, draftInfo);

    const expRow = await cdp.evaluate(`(() => {
      const r = [...document.querySelectorAll('.bl-tr')].find(x => (x.querySelector('.bl-tn b')||{}).textContent === ${JSON.stringify(P.exp.title)});
      if (!r) return null;
      return { likes: r.children[5].textContent.trim(), comments: r.children[6].textContent.trim() };
    })()`);
    check('a published row shows its real like and comment counts',
      expRow && Number(expRow.likes) >= 1 && /\d/.test(expRow.comments), expRow);
    check('★ ...and flags the post that has a flagged comment', expRow && /flagged/.test(expRow.comments), expRow);

    await cdp.evaluate('(() => { [...document.querySelectorAll(".bl-fp")].find(p => p.textContent.trim().indexOf("Draft") === 0).click(); return 1; })()');
    await sleep(250);
    check('★ the Draft filter narrows to drafts only',
      await cdp.evaluate('[...document.querySelectorAll(".bl-tr")].every(r => (r.querySelector(".bl-stat")||{}).textContent === "Draft")'));
    await cdp.evaluate('(() => { [...document.querySelectorAll(".bl-fp")].find(p => p.textContent.trim().indexOf("All") === 0).click(); return 1; })()');
    await sleep(250);

    await cdp.evaluate('(() => { const i = document.querySelector("#bl-p-q"); i.value = ' + JSON.stringify(P.news.title) + '; i.dispatchEvent(new Event("input",{bubbles:true})); return 1; })()');
    await sleep(250);
    check('★ PM search narrows the table',
      (await cdp.evaluate(N('.bl-tr'))) === 1
      && (await cdp.evaluate('document.querySelector(".bl-tr .bl-tn b").textContent')) === P.news.title);
    await cdp.evaluate('(() => { const i = document.querySelector("#bl-p-q"); i.value = ""; i.dispatchEvent(new Event("input",{bubbles:true})); return 1; })()');
    await sleep(250);

    // ===========================================================================================
    section('6. The PM tool — the Comments tab');
    // ===========================================================================================
    await cdp.evaluate('document.querySelector("#bl-tab-comments").click(); 1');
    check('the comments tab renders', await waitFor(cdp, 'document.querySelectorAll(".bl-qc").length > 0', 20000));
    check('★ the header and health strip survive the tab switch',
      (await cdp.evaluate(N('.bl-hc'))) === 4 && (await cdp.evaluate(N('.bl-mh h1'))) === 1
      && (await cdp.evaluate(N('a[href="admin-blog-post.html"]'))) === 1);

    const cardOf = (body) => `(() => {
      const c = [...document.querySelectorAll('.bl-qc')].find(x => (x.querySelector('.bl-qtext')||{}).textContent === ${JSON.stringify(body)});
      return c ? { pill: (c.querySelector('.bl-pill')||{}).textContent, pub: (c.querySelector('.bl-qpub')||{}).textContent.replace(/\\s+/g,' '),
        on: (c.querySelector('.bl-qon')||{}).textContent.replace(/\\s+/g,' '), thread: (c.querySelector('.bl-qthread')||{textContent:''}).textContent.replace(/\\s+/g,' '),
        acts: [...c.querySelectorAll('.bl-qacts button')].map(b => b.textContent.trim()) } : null;
    })()`;
    const flagCard = await cdp.evaluate(cardOf('Made 38% on this, everyone should get in.'));
    check('★ the flagged comment shows a flagged pill', flagCard && /Live · flagged/.test(flagCard.pill), flagCard && flagCard.pill);
    check('★ ...and says WHY, in words', flagCard && /return figure|percentage/i.test(flagCard.pub), flagCard && flagCard.pub);
    check('★ ...while remaining LIVE — nothing is auto-hidden', flagCard && flagCard.pill.indexOf('Removed') === -1);

    const replyCard = await cdp.evaluate(cardOf('Agreed, this answered my question.'));
    check('★ a reply says who it is "Replying to"', replyCard && /Replying to/.test(replyCard.on), replyCard && replyCard.on);
    check('...and names the post it is on', replyCard && replyCard.on.indexOf(P.exp.title) !== -1, replyCard && replyCard.on);

    const threadCard = await cdp.evaluate(cardOf('Clear and short. More of these, please.'));
    check('★ a comment WITH replies carries the thread note', threadCard && threadCard.thread.length > 0, threadCard && threadCard.thread);
    check('★ ...saying its replies are kept if it is removed',
      threadCard && /Removing this comment keeps them/.test(threadCard.thread), threadCard && threadCard.thread);
    // ★ LIVE cards only, and the filter is load-bearing. This once selected EVERY .bl-qc and
    // passed only because nothing had been removed by the time it ran; the moment a client
    // retraction landed earlier in the run it failed, correctly reporting that an ALREADY-REMOVED
    // card offers neither action. The assertion's own name was right and its selector was not.
    check('every live comment offers Reply and Remove (and a removed one offers neither)',
      await cdp.evaluate('(() => { const cards = [...document.querySelectorAll(".bl-qc")];' +
        ' const live = cards.filter(c => !c.querySelector(".bl-pill.bl-gone"));' +
        ' const gone = cards.filter(c => c.querySelector(".bl-pill.bl-gone"));' +
        ' const acts = c => [...c.querySelectorAll(".bl-qacts button")].map(b => b.textContent.trim());' +
        ' return live.length > 0 && live.every(c => acts(c).indexOf("Reply") !== -1 && acts(c).indexOf("Remove") !== -1)' +
        '   && gone.every(c => acts(c).indexOf("Remove") === -1); })()'),
      await cdp.evaluate('[...document.querySelectorAll(".bl-qc")].map(c => (c.querySelector(".bl-pill")||{}).textContent).join("|")'));

    check('★ the script probe is literal text in the PM tool as well',
      (await cdp.evaluate(BODY + '.indexOf("<script>window.__pwned") !== -1'))
      && (await cdp.evaluate(N('.bl-qtext script'))) === 0);
    check('...and nothing executed here either', (await cdp.evaluate('window.__pwned === undefined')) === true);

    await cdp.evaluate('(() => { [...document.querySelectorAll(".bl-fp")].find(p => p.textContent.trim().indexOf("Flagged") === 0).click(); return 1; })()');
    await sleep(300);
    check('★ the Flagged filter shows only flagged comments',
      (await cdp.evaluate(N('.bl-qc'))) >= 1
      && (await cdp.evaluate('[...document.querySelectorAll(".bl-qc")].every(c => /flagged/.test((c.querySelector(".bl-pill")||{}).textContent||""))')));
    await cdp.evaluate('(() => { [...document.querySelectorAll(".bl-fp")].find(p => p.textContent.trim().indexOf("Client replies") === 0).click(); return 1; })()');
    await sleep(300);
    check('★ the "Client replies" filter shows only client replies',
      await cdp.evaluate('[...document.querySelectorAll(".bl-qc")].every(c => /Replying to/.test((c.querySelector(".bl-qon")||{}).textContent||""))'));
    await cdp.evaluate('(() => { [...document.querySelectorAll(".bl-fp")].find(p => p.textContent.trim().indexOf("All") === 0).click(); return 1; })()');
    await sleep(300);

    // a real Marketswave reply, through the real UI
    const mwText = 'Thanks — the New Pocket screen shows each term. ' + SUF;
    await cdp.evaluate(`(() => {
      const c = [...document.querySelectorAll('.bl-qc')].find(x => (x.querySelector('.bl-qtext')||{}).textContent === 'Clear and short. More of these, please.');
      [...c.querySelectorAll('.bl-qacts button')].find(b => b.textContent.trim() === 'Reply').click(); return 1;
    })()`);
    await waitFor(cdp, 'document.querySelector("#bl-reply-ta")');
    await cdp.evaluate('(() => { const t = document.querySelector("#bl-reply-ta"); t.value = ' + JSON.stringify(mwText) + '; t.dispatchEvent(new Event("input",{bubbles:true})); [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Post reply").click(); return 1; })()');
    check('★ a real Marketswave reply posts from the PM tool, attached to the original comment',
      await waitDb(async () => {
        const { data } = await admin.from('blog_comments').select('is_marketswave, parent_id').eq('body', mwText).maybeSingle();
        return data && data.is_marketswave === true && data.parent_id === c1.body.id;
      }));

    // a real removal, with its confirm step
    await waitFor(cdp, '[...document.querySelectorAll(".bl-qtext")].some(t => t.textContent.indexOf("<script>window.__pwned") !== -1)', 20000);
    await cdp.evaluate(`(() => {
      const c = [...document.querySelectorAll('.bl-qc')].find(x => (x.querySelector('.bl-qtext')||{}).textContent.indexOf('<script>window.__pwned') !== -1);
      [...c.querySelectorAll('.bl-qacts button')].find(b => b.textContent.trim() === 'Remove').click(); return 1;
    })()`);
    await waitFor(cdp, 'document.querySelector(".bl-qc .bl-werr")');
    check('★ Remove asks first, and says what happens',
      await cdp.evaluate('/cannot be undone/.test(' + TRIM('.bl-qc .bl-werr') + ')'), await cdp.evaluate(TRIM('.bl-qc .bl-werr')));
    await cdp.evaluate('(() => { [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Remove it").click(); return 1; })()');
    check('★ confirming actually removes it', await waitDb(async () => {
      const { data } = await admin.from('blog_comments').select('removed_at').eq('id', xss.body.id).maybeSingle();
      return data && !!data.removed_at;
    }));

    // *** A RETRACTION AND A MODERATION ARE BOTH `removed_at`, AND THE REMOVED TAB WOULD READ AS
    // one moderation record if it showed them identically -- a PM reviewing their own record would
    // be misled by omission. Both now exist in this run: the client withdrew their own reply back
    // in section 3, and the PM removed the script probe a moment ago. The pair is the point; either
    // assertion alone would pass against a page that labelled every removal the same way.
    await waitFor(cdp, '[...document.querySelectorAll(".bl-pill")].some(p => /Withdrawn/.test(p.textContent))', 20000);
    const pmGone = await cdp.evaluate(`(() => {
      const c = [...document.querySelectorAll('.bl-qc')].find(x => (x.querySelector('.bl-qtext')||{}).textContent.indexOf('<script>window.__pwned') !== -1);
      return c ? { pill: (c.querySelector('.bl-pill')||{}).textContent, pub: (c.querySelector('.bl-qpub')||{}).textContent.replace(/\s+/g,' ') } : null;
    })()`);
    const authorGone = await cdp.evaluate(cardOf(replyText));
    check('★ a PM removal still reads "Removed"', pmGone && pmGone.pill === 'Removed', pmGone && pmGone.pill);
    check("★ ...while the client’s own retraction reads Withdrawn, not the same word",
      authorGone && authorGone.pill === 'Withdrawn', authorGone && authorGone.pill);
    check('★ ...and the note names the author rather than implying a PM acted',
      authorGone && /Withdrawn by the author/.test(authorGone.pub), authorGone && authorGone.pub);
    check("...and the PM’s own note does NOT claim the author withdrew it",
      pmGone && !/by the author/.test(pmGone.pub), pmGone && pmGone.pub);

    // ===========================================================================================
    section('7. The post editor');
    // ===========================================================================================
    ok = await go(cdp, BASE + '/admin-blog-post.html?id=' + P.draft.id, '.bl-sec', adminSession);
    check('the editor renders', ok);
    check('the editor has the three numbered sections', (await cdp.evaluate(N('.bl-sec'))) === 3);
    check('...numbered 1, 2, 3', (await cdp.evaluate('[...document.querySelectorAll(".bl-num")].map(n=>n.textContent).join("")')) === '123');
    check('...About this post, Cover image, The post',
      (await cdp.evaluate('[...document.querySelectorAll(".bl-sec .bl-sech b")].map(b=>b.textContent).join("|")'))
      === 'About this post|Cover image|The post');

    const labels = await cdp.evaluate('[...document.querySelectorAll(".bl-f label")].map(l=>l.textContent.replace(/\\s+/g," ").trim())');
    check('★ every field is marked Required or Optional',
      labels.filter((l) => /Required|Optional/.test(l)).length >= 6, labels.slice(0, 8));
    check('★ "The question it answers" is OPTIONAL for a post',
      labels.some((l) => /The question it answers\s*Optional/.test(l)), labels.filter((l) => /question/i.test(l)));
    check('every field carries its help text', (await cdp.evaluate(N('.bl-help'))) >= 6);
    check('★ the cover field warns against real client data in an image',
      await cdp.evaluate('[...document.querySelectorAll(".bl-help")].some(h => /Never a real client/i.test(h.textContent))'));

    const cl = await cdp.evaluate('[...document.querySelectorAll(".bl-chk")].map(r => ({ t: r.textContent.trim(), ok: !!r.querySelector(".bl-c-ok") }))');
    check('★ the checklist is the SERVER\'s six items', cl.length === 6, cl);
    check('★ ...and it has no "question it answers" item', !cl.some((r) => /question it answers/i.test(r.t)), cl);
    check('★ ...while it DOES require a cover image', cl.some((r) => /Cover image/i.test(r.t) && !r.ok), cl);

    check('★ BOTH Publish buttons are disabled while the cover is missing',
      (await cdp.evaluate('document.querySelector("#bl-publish-top").disabled === true'))
      && (await cdp.evaluate('document.querySelector("#bl-publish-side").disabled === true')));
    check('★ ...and say how many items are missing',
      await cdp.evaluate('/1 required item missing/.test(document.querySelector("#bl-publish-top").title)'),
      await cdp.evaluate('document.querySelector("#bl-publish-top").title'));

    const switches = await cdp.evaluate('[...document.querySelectorAll(".bl-sw")].map(s => ({ on: s.className.indexOf("bl-on") !== -1, role: s.getAttribute("role"), aria: s.hasAttribute("aria-checked") }))');
    check('the settings column has the three switches', switches.length === 3, switches);
    check('★ comments and likes are on by default, featuring is not',
      switches[0].on === false && switches[1].on === true && switches[2].on === true, switches);
    check('...and each is a real switch for assistive tech', switches.every((s) => s.role === 'switch' && s.aria));

    check('the four categories are offered as a radio group',
      (await cdp.evaluate(N('.bl-ro'))) === 4
      && (await cdp.evaluate('document.querySelector(".bl-radio").getAttribute("role")')) === 'radiogroup');
    check('★ the byline defaults to Marketswave', (await cdp.evaluate('document.querySelector("#bl-byline").value')) === 'Marketswave');
    check('★ the six block kinds are offered',
      (await cdp.evaluate('[...document.querySelectorAll(".bl-addbtns button")].map(b=>b.textContent).join("|")'))
      === 'Heading|Paragraph|Steps|Warning|Tip|Image');

    // give it a cover through the real save, reload, and watch BOTH buttons unlock together
    await callAs('save-blog-post', {
      id: P.draft.id, title: P.draft.title, slug: 'ui-draft-' + SUF, category: 'article',
      lede: 'A summary long enough to be a real one.',
      blocks: [{ type: 'p', runs: [{ t: 'Body.' }] }],
      cover_path: coverPath, cover_alt: 'A described cover',
    }, pmS.session.access_token);
    await go(cdp, BASE + '/admin-blog-post.html?id=' + P.draft.id, '#bl-publish-top', adminSession);
    await waitFor(cdp, 'document.querySelector("#bl-publish-top").disabled === false', 25000);
    check('★ once every item is ticked BOTH Publish buttons unlock together',
      (await cdp.evaluate('document.querySelector("#bl-publish-top").disabled === false'))
      && (await cdp.evaluate('document.querySelector("#bl-publish-side").disabled === false')));
    check('...and the checklist shows six ticks', (await cdp.evaluate(N('.bl-chk .bl-c-ok'))) === 6);

    await cdp.evaluate('document.querySelector("#bl-publish-top").click(); 1');
    check('★ pressing Publish genuinely publishes', await waitDb(async () => {
      const { data } = await admin.from('blog_posts').select('published_at').eq('id', P.draft.id).maybeSingle();
      return data && !!data.published_at;
    }, 40000));

    ok = await go(cdp, BASE + '/blog-press.html?p=ui-draft-' + SUF, '.bp-pbody h1, .bp-empty');
    check('★ the newly published post is readable on the public page',
      (await cdp.evaluate(TRIM('.bp-pbody h1'))) === P.draft.title, await cdp.evaluate(TRIM('.bp-pbody h1')));

    // ===========================================================================================
    section('8. The links into the section');
    // ===========================================================================================
    const pages = ['about.html', 'blog-press.html', 'contact.html', 'help.html', 'index.html',
      'legal.html', 'resources.html', 'services.html'];
    let n = 0;
    pages.forEach((p) => {
      if (/<li><a href="blog-press\.html">Blog &amp; Press<\/a><\/li>/.test(readFileSync(path.join(ROOT, p), 'utf8'))) n++;
    });
    check('★ all 8 marketing footers reach blog-press.html', n === 8, n + ' of 8');
    check('★ about.html\'s "Company Updates" reaches it too',
      /href="blog-press\.html"[^>]*>Company Updates/.test(readFileSync(path.join(ROOT, 'about.html'), 'utf8')));
    const res = readFileSync(path.join(ROOT, 'resources.html'), 'utf8');
    // The phrase survives in this file's own comment explaining what was removed, which is the
    // record of the change; what must be absent is the CARD.
    check('★ resources.html carries no hardcoded placeholder cards',
      !/<h3>\s*Article Coming Soon/.test(res) && /id="bp-preview"/.test(res) && /blog-preview\.js/.test(res));

    ok = await go(cdp, BASE + '/resources.html', '#bp-preview');
    await waitFor(cdp, 'document.querySelectorAll("#bp-preview a").length > 0', 20000);
    check('★ the resources teaser reads LIVE posts', (await cdp.evaluate(N('#bp-preview a'))) >= 1,
      await cdp.evaluate(N('#bp-preview a')));
    check('★ ...and every card links into the real post',
      await cdp.evaluate('[...document.querySelectorAll("#bp-preview a")].every(a => /blog-press\\.html\\?p=/.test(a.getAttribute("href")))'));
    check('★ ...and none of them is a placeholder',
      !(await cdp.evaluate('document.querySelector("#bp-preview").textContent.indexOf("Coming Soon") !== -1')));

  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (_e) {} }
    for (const id of made.users) {
      await admin.from('clients').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const id of made.posts) await admin.from('blog_posts').delete().eq('id', id);
    const { data: leftP } = await admin.from('blog_posts').select('id').like('slug', '%' + SUF);
    const { count: leftU } = await admin.from('clients').select('id', { count: 'exact', head: true }).like('email', '%' + SUF + '%');
    console.log('\ncleanup: posts remaining ' + ((leftP || []).length) + ', clients remaining ' + (leftU || 0));
    if (cdp && cdp.chrome) cdp.chrome.kill();
    await releaseTempDir(profile);
  }

  console.log('\n' + passed + ' passed, ' + fails.length + ' failed.');
  if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exitCode = 1; }
  console.log(fails.length ? 'BLOG PRESS UI: FAIL' : 'BLOG PRESS UI: PASS');
}

runVerifyMain(main, { watchdogMs: 25 * 60 * 1000 });
