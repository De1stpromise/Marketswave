// verify-help-center-ui-wiring.mjs — the Help Center's two PM pages and two public views, driven
// in a real browser (2026-09-23, Phase 1).
//
// ★ THE HEADLINE IS PART 2: an article created, drafted, published and edited, with the LIVE
// version proven unchanged until Publish is pressed again. That is the promise the separate
// draft/published columns exist to keep, and the only way to prove it is to edit a live article
// and then go and look at what a visitor sees.
//
// ★ PART 4 IS THE OTHER ONE THAT MATTERS: a draft is unreadable anonymously through the PAGE.
// The table and the function are covered by verify-supabase-help-center.js Part 1; this is the
// third door, checked in a genuinely separate browser with no admin session.
//
// Usage (from scripts/):  npm run verify-help-center-ui-wiring
import { spawn, spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { makeTempDir, releaseTempDir } from './lib/harness-teardown.mjs';
import { runVerifyMain } from './lib/run-verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'http://127.0.0.1:8765';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0; const fails = [];
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { fails.push(label); console.log('  FAIL  ' + label + (detail === undefined ? '' : ' — ' + detail)); }
}
function section(t) { console.log('\n' + t); }

const SUF = Math.random().toString(36).slice(2, 7);
const NEW_TITLE = 'Probe article ' + SUF;
const NEW_SLUG = 'probe-article-' + SUF;

function localStack() {
  const raw = execSync('supabase status -o json', { cwd: ROOT, encoding: 'utf8' });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!/127\.0\.0\.1|localhost/.test(j.API_URL)) throw new Error('refusing to run against ' + j.API_URL);
  return j;
}

async function connect(profile) {
  const PORT = 9300 + Math.floor(Math.random() * 600);
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--disable-gpu', 'about:blank',
  ], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const p = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) wsUrl = p.webSocketDebuggerUrl; else await sleep(250);
    } catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('could not reach headless Chrome on ' + PORT);
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + String(expr).slice(0, 110));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const go = async (url, waitFor, seconds = 30) => {
    await send('Page.navigate', { url: BASE + url });
    return evaluate(`(async()=>{const nap=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<${seconds * 7};i++){ if(document.querySelector(${JSON.stringify(waitFor)})) return true; await nap(150);} return false;})()`);
  };
  return { chrome, send, evaluate, go };
}

// The admin login page has no <form>: the control is #admin-login-submit, type="button", and its
// handler does not attach immediately (row 184). Click, poll, retry.
async function signInAsPm(cdp) {
  await cdp.go('/admin-login.html', '#admin-login-submit', 20);
  for (let attempt = 1; attempt <= 6; attempt++) {
    let r;
    try {
      r = await cdp.evaluate(`(async()=>{const nap=ms=>new Promise(r=>setTimeout(r,ms));
        const e=document.getElementById('admin-email-input'), p=document.getElementById('admin-password-input'),
              b=document.getElementById('admin-login-submit');
        if(!e||!p||!b) return 'controls missing';
        e.value='pm@marketswave.local'; e.dispatchEvent(new Event('input',{bubbles:true}));
        p.value='MarketswavePM-Local-2026!'; p.dispatchEvent(new Event('input',{bubbles:true}));
        b.click();
        for(let i=0;i<40;i++){ if(!/admin-login/.test(location.pathname)) return 'ok'; await nap(250);} return 'still on login';})()`);
    } catch (e) { r = /navigated|closed/.test(e.message) ? 'ok' : e.message; }
    if (r === 'ok') { await sleep(700); return true; }
    await sleep(1200);
  }
  return false;
}

// ★ The editor's fields are in the static markup, so a selector wait returns before the article
// has loaded. The checklist count is only written once renderChecklist() has run against real
// data, which makes it the honest readiness signal (row 253).
async function editorReady(cdp) {
  return cdp.evaluate(`(async()=>{const nap=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<200;i++){ const c=document.getElementById('hl-check-count');
      if(c && c.textContent.trim()) return true; await nap(150);} return false;})()`);
}

async function main() {
  const st = localStack();
  const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anonGet = async (p) => {
    const r = await fetch(st.API_URL + '/rest/v1/' + p, { headers: { apikey: st.ANON_KEY } });
    return r.ok ? r.json() : null;
  };

  const pmProfile = await makeTempDir('mw-hc-pm-');
  const visitorProfile = await makeTempDir('mw-hc-anon-');
  let pm = null, visitor = null;

  try {
    pm = await connect(pmProfile);
    check('GUARD: signed in as the local bootstrap PM', await signInAsPm(pm));

    // =========================================================================================
    section('1. THE ARTICLES LIST');
    // =========================================================================================
    const listOk = await pm.go('/admin-help.html', '.hl-tr, .hl-empty');
    const list = await pm.evaluate(`({
      nav: !!document.querySelector('#admin-sidebar-mount a'),
      active: [...document.querySelectorAll('#admin-sidebar-mount a')].filter(a=>/admin-help\\.html$/.test(a.getAttribute('href')||'')).length,
      logout: !!document.getElementById('admin-logout-btn'),
      health: [...document.querySelectorAll('.hl-hc .hl-k')].map(e=>e.textContent),
      pills: [...document.querySelectorAll('#hl-status-pills .mw-btn')].map(e=>e.textContent.replace(/\\s+/g,' ').trim()),
      head: [...document.querySelectorAll('.hl-th span')].map(e=>e.textContent).filter(Boolean),
      seeded: [...document.querySelectorAll('.hl-tr .hl-tn b')].map(e=>e.textContent).includes('Depositing crypto'),
      sorts: [...document.querySelectorAll('#hl-sort option')].length
    })`);
    check('the list renders', listOk, String(listOk));
    // ★ row 228: the approval gate shipped with no nav at all and a 69-assertion suite missed it.
    check('★ the PM nav rail mounts, carries a Help Center item, and Log out is reachable',
      list.nav && list.active === 1 && list.logout, JSON.stringify({ nav: list.nav, item: list.active, logout: list.logout }));
    check('the health strip shows all four cards',
      JSON.stringify(list.health) === JSON.stringify(['Published', 'Drafts', 'Not started', 'Needs attention']), JSON.stringify(list.health));
    check('the status filter row carries all six pills', list.pills.length === 6, JSON.stringify(list.pills));
    check('the table head carries Views and Tickets over 30 days',
      list.head.indexOf('Views \u00b7 30d') !== -1 && list.head.indexOf('Tickets \u00b7 30d') !== -1, JSON.stringify(list.head));
    check('sort offers all five orderings', list.sorts === 5, String(list.sorts));
    check('the seeded article is listed', list.seeded, String(list.seeded));

    // =========================================================================================
    section('2. CREATE \u2192 DRAFT \u2192 PUBLISH \u2192 EDIT, with the live version proven unchanged');
    // =========================================================================================
    await pm.go('/admin-help-article.html', '#hl-title');
    await editorReady(pm);
    const blank = await pm.evaluate(`({
      publish: document.getElementById('hl-publish').disabled,
      publishTop: document.getElementById('hl-publish-top').disabled,
      count: document.getElementById('hl-check-count').textContent
    })`);
    check('★ on a blank article BOTH Publish buttons are disabled together',
      blank.publish === true && blank.publishTop === true, JSON.stringify(blank));

    // Fill it in, exactly as a manager would.
    await pm.evaluate(`(()=>{
      const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));};
      set('hl-title', ${JSON.stringify(NEW_TITLE)});
      set('hl-question','Does the draft stay private until I publish?');
      const t=document.getElementById('hl-topic-sel'); t.value='adding-money'; t.dispatchEvent(new Event('change',{bubbles:true}));
      set('hl-lede','ORIGINAL LEDE ${SUF}');
      document.querySelector('[data-add="p"]').click();
      const ta=document.querySelector('#hl-blocks textarea');
      ta.value='ORIGINAL BODY ${SUF} with **bold** in it'; ta.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await sleep(300);
    const filled = await pm.evaluate(`({
      slug: document.getElementById('hl-slug').value,
      publish: document.getElementById('hl-publish').disabled,
      publishTop: document.getElementById('hl-publish-top').disabled,
      count: document.getElementById('hl-check-count').textContent
    })`);
    check('the web address is derived from the title', filled.slug === NEW_SLUG, filled.slug);
    check('★ once every required item is filled in, BOTH Publish buttons enable together',
      filled.publish === false && filled.publishTop === false, JSON.stringify(filled));

    // Save as a draft.
    await pm.evaluate(`document.getElementById('hl-save').click()`);
    await sleep(2500);
    const afterSave = await admin.from('help_articles').select('id,slug,published_at,draft_dirty,lede').eq('slug', NEW_SLUG).maybeSingle();
    check('Save draft creates the article, unpublished',
      !!afterSave.data && afterSave.data.published_at === null, JSON.stringify(afterSave.data && { pub: afterSave.data.published_at }));
    const probeId = afterSave.data && afterSave.data.id;

    const draftInView = await anonGet('help_articles_public?slug=eq.' + NEW_SLUG + '&select=slug');
    check('★ the DRAFT is not in the public view', Array.isArray(draftInView) && draftInView.length === 0, JSON.stringify(draftInView));

    // Publish.
    await pm.evaluate(`document.getElementById('hl-publish').click()`);
    await sleep(3000);
    const published = await anonGet('help_articles_public?slug=eq.' + NEW_SLUG + '&select=slug,lede,blocks');
    check('★ after Publish the article is live, with the text as written',
      Array.isArray(published) && published[0] && published[0].lede === 'ORIGINAL LEDE ' + SUF,
      JSON.stringify(published && published[0] && published[0].lede));

    // Edit the LIVE article and save a draft.
    await pm.evaluate(`(()=>{
      const e=document.getElementById('hl-lede'); e.value='EDITED LEDE ${SUF}'; e.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await pm.evaluate(`document.getElementById('hl-save').click()`);
    await sleep(2500);

    const stillOld = await anonGet('help_articles_public?slug=eq.' + NEW_SLUG + '&select=lede');
    check('★★ THE PROMISE: after editing a LIVE article and saving, a visitor still sees the ' +
      'PUBLISHED text \u2014 the edit has not reached anyone',
      Array.isArray(stillOld) && stillOld[0] && stillOld[0].lede === 'ORIGINAL LEDE ' + SUF,
      JSON.stringify(stillOld && stillOld[0]));

    const badges = await pm.evaluate(`[...document.querySelectorAll('#hl-badges .hl-stat')].map(e=>e.textContent)`);
    check('...and the editor shows both Published and Unpublished edits',
      badges.indexOf('Published') !== -1 && badges.indexOf('Unpublished edits') !== -1, JSON.stringify(badges));

    // And the list agrees.
    await pm.go('/admin-help.html', '.hl-tr');
    const rowBadges = await pm.evaluate(`(()=>{const r=[...document.querySelectorAll('.hl-tr')]
      .find(x=>/Probe article/.test(x.textContent)); return r? [...r.querySelectorAll('.hl-stat')].map(e=>e.textContent):[];})()`);
    check('the list marks it as having unpublished edits too',
      rowBadges.indexOf('Unpublished edits') !== -1, JSON.stringify(rowBadges));

    // Publish again.
    await pm.go('/admin-help-article.html?id=' + probeId, '#hl-blocks .hl-blk');
    await editorReady(pm);
    await pm.evaluate(`document.getElementById('hl-publish').click()`);
    await sleep(3000);
    const nowNew = await anonGet('help_articles_public?slug=eq.' + NEW_SLUG + '&select=lede');
    check('★ pressing Publish again is what moves it \u2014 the visitor now sees the edit',
      Array.isArray(nowNew) && nowNew[0] && nowNew[0].lede === 'EDITED LEDE ' + SUF, JSON.stringify(nowNew && nowNew[0]));

    // =========================================================================================
    section('3. THE PUBLISH CHECKLIST, refused server-side even with the button forced');
    // =========================================================================================
    await pm.evaluate(`(()=>{
      document.getElementById('hl-add-image').click();
      const inputs=[...document.querySelectorAll('#hl-blocks .hl-blk')].pop().querySelectorAll('input');
      inputs[0].value='help/probe.png'; inputs[0].dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await sleep(400);
    const withImage = await pm.evaluate(`({
      publish: document.getElementById('hl-publish').disabled,
      publishTop: document.getElementById('hl-publish-top').disabled,
      altLine: [...document.querySelectorAll('#hl-checklist .hl-chk')].map(e=>e.textContent).join('|')
    })`);
    check('★ an image with no screen-reader description disables BOTH Publish buttons',
      withImage.publish === true && withImage.publishTop === true, JSON.stringify(withImage));

    // Force the button back on, the way devtools would, and press it.
    // ★ Poll for the toast to CHANGE from what was already on screen, never for "a toast is
    // visible": the previous publish's toast is still up from two seconds ago, and a probe that
    // accepts any visible toast reads it and reports a pass for the wrong reason (row 121).
    const forced = await pm.evaluate(`(async()=>{const nap=ms=>new Promise(r=>setTimeout(r,ms));
      const t0=document.getElementById('hl-toast');
      const before = t0 && !t0.hidden ? t0.textContent : '';
      document.getElementById('hl-publish').disabled=false;
      document.getElementById('hl-publish').click();
      for(let i=0;i<80;i++){ const t=document.getElementById('hl-toast');
        if(t && !t.hidden && t.textContent && t.textContent !== before) return t.textContent; await nap(250);}
      return '(toast never changed from: ' + before + ')';})()`);
    check('★★ the SERVER refuses the publish and names the screen-reader description, even though ' +
      'the button was re-enabled by hand', /screen-reader description/i.test(forced), JSON.stringify(forced));

    const stillLive = await anonGet('help_articles_public?slug=eq.' + NEW_SLUG + '&select=lede');
    check('...and the live article is untouched by the refused publish',
      Array.isArray(stillLive) && stillLive[0] && stillLive[0].lede === 'EDITED LEDE ' + SUF, JSON.stringify(stillLive && stillLive[0]));

    // =========================================================================================
    section('4. A DRAFT IS UNREADABLE ANONYMOUSLY THROUGH THE PAGE');
    // =========================================================================================
    // A genuinely separate browser: its own profile, no admin session, nothing shared.
    const { data: hidden } = await admin.from('help_articles').insert({
      slug: 'anon-probe-' + SUF, topic_id: 'adding-money', title: 'Draft nobody may read',
      lede: 'ANON-SECRET-' + SUF, blocks: [{ type: 'p', runs: [{ t: 'ANON-SECRET-BODY-' + SUF }] }],
    }).select().single();

    visitor = await connect(visitorProfile);
    await visitor.go('/help.html?a=anon-probe-' + SUF, '.hc-art h1');
    const anonPage = await visitor.evaluate(`({
      heading: (document.querySelector('.hc-art h1')||{}).textContent,
      body: document.body.innerText,
      hasAdminSession: (()=>{try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(/admin/.test(k||'')) return true;} }catch(e){} return false;})()
    })`);
    check('★★ an anonymous visitor asking for the draft by name gets an honest not-found, not the draft',
      /couldn\u2019t find that article|couldn't find that article/i.test(anonPage.heading || ''), JSON.stringify(anonPage.heading));
    check('★★ ...and no draft text appears anywhere on the rendered page',
      (anonPage.body || '').indexOf('ANON-SECRET-') === -1, 'secret found in page text');
    check('GUARD: the visitor browser genuinely has no admin session (so the check is not vacuous)',
      anonPage.hasAdminSession === false, String(anonPage.hasAdminSession));

    // The same browser CAN read the published one — proves the door works, not that it is shut.
    await visitor.go('/help.html?a=depositing-crypto', '.hc-art h1');
    const anonPub = await visitor.evaluate(`({
      h1: (document.querySelector('.hc-art h1')||{}).textContent,
      blocks: document.querySelectorAll('.ha-h2,.ha-p,.ha-steps,.ha-warn,.ha-tip').length,
      steps: document.querySelectorAll('.ha-st').length,
      bold: document.querySelectorAll('.ha-p strong').length,
      stuck: (document.querySelector('.hc-ask .hc-ab b')||{}).textContent,
      actions: [...document.querySelectorAll('.hc-ask-actions .btn')].map(e=>e.textContent)
    })`);
    check('NON-VACUITY: the same anonymous browser CAN read a PUBLISHED article',
      anonPub.h1 === 'Depositing crypto' && anonPub.blocks >= 8, JSON.stringify({ h1: anonPub.h1, blocks: anonPub.blocks }));
    check('the article renders its steps and bold runs', anonPub.steps === 4 && anonPub.bold >= 2, JSON.stringify(anonPub));
    check('★ "Still stuck?" offers a signed-out visitor chat and email, never a ticket',
      anonPub.stuck === 'Still stuck?' && anonPub.actions.join(',') === 'Start a chat,Email us', JSON.stringify(anonPub.actions));

    // =========================================================================================
    section('5. THE LANDING');
    // =========================================================================================
    await visitor.go('/help.html', '.hc-cats');
    const landing = await visitor.evaluate(`({
      topics: document.querySelectorAll('.hc-cat').length,
      mostAsked: document.querySelectorAll('.hc-asked .hc-aq').length,
      crawlable: document.querySelectorAll('a[href^="help.html?a="]').length,
      contact: [...document.querySelectorAll('.hc-contact .hc-ch b')].map(e=>e.textContent),
      noscript: !!document.querySelector('noscript')
    })`);
    check('the landing renders all six topic cards', landing.topics === 6, String(landing.topics));
    check('"Most asked" holds at most 6', landing.mostAsked <= 6 && landing.mostAsked >= 1, String(landing.mostAsked));
    check('every published article is a real crawlable link', landing.crawlable >= 1, String(landing.crawlable));
    check('the contact band offers chat, email and phone',
      JSON.stringify(landing.contact) === JSON.stringify(['Live chat', 'Email us', 'Call us']), JSON.stringify(landing.contact));
    check('a <noscript> index is present for a visitor with JavaScript off', landing.noscript, String(landing.noscript));

    // cleanup of the two probe articles
    await admin.from('help_articles').delete().in('slug', [NEW_SLUG, 'anon-probe-' + SUF]);
    void hidden;
  } finally {
    if (pm) { try { pm.chrome.kill(); } catch { /* already gone */ } }
    if (visitor) { try { visitor.chrome.kill(); } catch { /* already gone */ } }
    await releaseTempDir(pmProfile);
    await releaseTempDir(visitorProfile);
    await admin.from('help_articles').delete().in('slug', [NEW_SLUG, 'anon-probe-' + SUF]);
  }

  console.log('\n' + passed + ' passed, ' + fails.length + ' failed');
  if (fails.length) fails.forEach((f) => console.log('  - ' + f));
  console.log(fails.length === 0 ? 'HELP CENTER UI: PASS' : 'HELP CENTER UI: FAIL');
  if (fails.length) process.exit(1);
}

runVerifyMain(main, { watchdogMs: 15 * 60 * 1000 });
